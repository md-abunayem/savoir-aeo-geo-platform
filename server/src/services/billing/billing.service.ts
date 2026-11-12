import type { Pool } from "pg";
import { StripeAdapter, PLAN_CONFIGS, type PlanTier } from "./stripe.adapter.js";
import {
  CreditLedgerService,
  type CreditBalances,
  type CreditLedgerRecord,
} from "./credit-ledger.service.js";
import { ApiError } from "../../utils/ApiError.js";
import { withTenantClient } from "../../db/tenant.js";
import { normalizeBillingEvent } from "./billing-event.js";

export interface TenantSubscriptionRecord {
  id: string;
  tenantId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  planTier: PlanTier;
  status: "active" | "past_due" | "canceled" | "trialing" | "incomplete";
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  monthlyCredits: number;
  monthlyCrawlCredits: number;
  createdAt: string;
  updatedAt: string;
}

export interface BillingOverview {
  subscription: TenantSubscriptionRecord;
  balances: CreditBalances;
  plans: typeof PLAN_CONFIGS;
  recentLedger: CreditLedgerRecord[];
}

export class BillingService {
  private ledgerService: CreditLedgerService;

  constructor(
    private pool: Pool,
    private stripeAdapter: StripeAdapter,
  ) {
    this.ledgerService = new CreditLedgerService(pool);
  }

  async authorizeOwner(tenantId: string, userId: string): Promise<void> {
    await withTenantClient(this.pool, { tenantId, userId }, async () => {});
  }

  async forOwner<T>(
    tenantId: string,
    userId: string,
    operation: (billing: BillingService, ledger: CreditLedgerService) => Promise<T>,
  ): Promise<T> {
    return withTenantClient(this.pool, { tenantId, userId }, async (client) => {
      const scoped = client as unknown as Pool;
      return operation(
        new BillingService(scoped, this.stripeAdapter),
        new CreditLedgerService(scoped),
      );
    });
  }

  /**
   * Retrieves full billing overview for a tenant, initializing defaults if needed
   */
  async getBillingOverview(tenantId: string): Promise<BillingOverview> {
    let subRes = await this.pool.query(`SELECT * FROM tenant_subscriptions WHERE tenant_id = $1`, [
      tenantId,
    ]);

    if (subRes.rowCount === 0) {
      // Default initial Starter plan for existing/new tenants
      await this.pool.query(
        `INSERT INTO tenant_subscriptions (
          tenant_id, plan_tier, status, monthly_credits, monthly_crawl_credits, current_period_start, current_period_end
        ) VALUES ($1, 'starter', 'active', 2000, 500, NOW(), NOW() + INTERVAL '30 days')
        ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId],
      );

      subRes = await this.pool.query(`SELECT * FROM tenant_subscriptions WHERE tenant_id = $1`, [
        tenantId,
      ]);
    }

    const sub = subRes.rows[0];
    const subscription: TenantSubscriptionRecord = {
      id: sub.id,
      tenantId: sub.tenant_id,
      stripeCustomerId: sub.stripe_customer_id,
      stripeSubscriptionId: sub.stripe_subscription_id,
      planTier: sub.plan_tier as PlanTier,
      status: sub.status,
      currentPeriodStart: sub.current_period_start
        ? new Date(sub.current_period_start).toISOString()
        : null,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end).toISOString()
        : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      monthlyCredits: Number(sub.monthly_credits),
      monthlyCrawlCredits: Number(sub.monthly_crawl_credits),
      createdAt: new Date(sub.created_at).toISOString(),
      updatedAt: new Date(sub.updated_at).toISOString(),
    };

    const balances = await this.ledgerService.getBalances(tenantId);
    const recentLedger = await this.ledgerService.getLedgerHistory(tenantId, { limit: 10 });

    return {
      subscription,
      balances,
      plans: PLAN_CONFIGS,
      recentLedger,
    };
  }

  /**
   * Creates a Stripe Checkout Session for subscription upgrade/downgrade or topup pack
   */
  async createCheckoutSession(params: {
    tenantId: string;
    userId: string;
    planTier: PlanTier | "topup_1000";
    returnUrl: string;
  }): Promise<{ sessionId: string; url: string }> {
    const subRes = await this.pool.query(
      `SELECT stripe_customer_id, stripe_subscription_id, status FROM tenant_subscriptions WHERE tenant_id = $1`,
      [params.tenantId],
    );
    const stripeCustomerId = subRes.rows[0]?.stripe_customer_id || null;

    if (
      params.planTier !== "topup_1000" &&
      subRes.rows[0]?.stripe_subscription_id &&
      !["canceled", "incomplete_expired"].includes(subRes.rows[0].status)
    ) {
      throw new ApiError(
        409,
        "Manage your existing subscription through the billing portal",
        "SUBSCRIPTION_EXISTS",
      );
    }

    return this.stripeAdapter.createCheckoutSession({
      tenantId: params.tenantId,
      userId: params.userId,
      planTier: params.planTier,
      returnUrl: params.returnUrl,
      stripeCustomerId,
    });
  }

  /**
   * Creates a Stripe Customer Portal Session for managing payment methods
   */
  async createPortalSession(tenantId: string, returnUrl: string): Promise<{ url: string }> {
    const subRes = await this.pool.query(
      `SELECT stripe_customer_id FROM tenant_subscriptions WHERE tenant_id = $1`,
      [tenantId],
    );
    const stripeCustomerId = subRes.rows[0]?.stripe_customer_id;

    if (!stripeCustomerId) {
      throw new ApiError(
        400,
        "No active Stripe customer found. Please subscribe to a plan first.",
        "NO_STRIPE_CUSTOMER",
      );
    }

    return this.stripeAdapter.createPortalSession({
      stripeCustomerId,
      returnUrl,
    });
  }

  /**
   * Handles Stripe Webhooks idempotently (ADM-FR-004, ADM-FR-006)
   */
  async handleWebhook(
    rawBody: string | Buffer,
    signatureHeader: string,
  ): Promise<{ received: boolean; event: string }> {
    const isValid = this.stripeAdapter.verifyWebhookSignature(rawBody, signatureHeader);
    if (!isValid) {
      throw new ApiError(400, "Invalid Stripe webhook signature", "INVALID_SIGNATURE");
    }

    const payloadStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf-8") : rawBody;
    let payload: unknown;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      throw new ApiError(400, "Invalid webhook JSON", "INVALID_PAYLOAD");
    }
    const event = normalizeBillingEvent(payload, this.stripeAdapter);
    if (event.data) {
      try {
        await this.pool.query("SELECT public.savoir_apply_billing_event($1::jsonb)", [
          JSON.stringify(event.data),
        ]);
      } catch (error) {
        if ((error as { code?: string })?.code === "P0001") {
          throw new ApiError(
            409,
            "Subscription is not linked yet; retry this event",
            "BILLING_EVENT_PENDING",
          );
        }
        if (["22023", "22P02"].includes((error as { code?: string })?.code ?? "")) {
          throw new ApiError(400, "Invalid billing event data", "INVALID_BILLING_EVENT");
        }
        throw error;
      }
    }

    return { received: true, event: event.type };
  }
}
