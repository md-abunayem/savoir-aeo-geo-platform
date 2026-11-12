import crypto from "node:crypto";
import { ApiError } from "../../utils/ApiError.js";

export type PlanTier = "starter" | "growth" | "enterprise";

export interface PlanConfig {
  id: PlanTier;
  name: string;
  priceUsdMonthly: number;
  monthlyCredits: number;
  monthlyCrawlCredits: number;
  maxPrompts: number;
  stripePriceId?: string;
}

export const PLAN_CONFIGS: Record<PlanTier, PlanConfig> = {
  starter: {
    id: "starter",
    name: "Starter",
    priceUsdMonthly: 99,
    monthlyCredits: 2000,
    monthlyCrawlCredits: 500,
    maxPrompts: 100,
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceUsdMonthly: 299,
    monthlyCredits: 8000,
    monthlyCrawlCredits: 2000,
    maxPrompts: 500,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    priceUsdMonthly: 899,
    monthlyCredits: 30000,
    monthlyCrawlCredits: 10000,
    maxPrompts: 5000,
  },
};

export interface StripeAdapterConfig {
  secretKey?: string;
  webhookSecret?: string;
  starterPriceId?: string;
  growthPriceId?: string;
  enterprisePriceId?: string;
}

export class StripeAdapter {
  private secretKey?: string;
  private webhookSecret?: string;
  private priceIds: Record<PlanTier, string>;

  constructor(config: StripeAdapterConfig = {}) {
    this.secretKey = config.secretKey;
    this.webhookSecret = config.webhookSecret;
    this.priceIds = {
      starter: config.starterPriceId || "price_starter_default",
      growth: config.growthPriceId || "price_growth_default",
      enterprise: config.enterprisePriceId || "price_enterprise_default",
    };
  }

  planForPrice(priceId?: string): PlanTier | undefined {
    if (!priceId) return undefined;
    return (Object.keys(this.priceIds) as PlanTier[]).find(
      (plan) => this.priceIds[plan] === priceId,
    );
  }

  /**
   * Verifies Stripe HMAC-SHA256 signature header:
   * Header format: `t=timestamp,v1=signature`
   */
  verifyWebhookSignature(
    rawPayload: string | Buffer,
    signatureHeader: string,
    secret = this.webhookSecret,
    toleranceSeconds = 300,
  ): boolean {
    if (!secret) {
      throw new ApiError(500, "Stripe webhook secret is not configured", "STRIPE_NOT_CONFIGURED");
    }

    if (!signatureHeader) {
      return false;
    }

    const parts = signatureHeader.split(",").reduce<Record<string, string>>((acc, item) => {
      const [k, v] = item.trim().split("=");
      if (k && v) acc[k] = v;
      return acc;
    }, {});

    const timestampStr = parts["t"];
    const signature = parts["v1"];

    if (!timestampStr || !signature) {
      return false;
    }

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > toleranceSeconds) {
      return false;
    }

    const payloadBuffer = Buffer.isBuffer(rawPayload)
      ? rawPayload
      : Buffer.from(rawPayload, "utf-8");
    const signedPayload = `${timestamp}.${payloadBuffer.toString("utf-8")}`;

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signedPayload, "utf-8")
      .digest("hex");

    try {
      const a = Buffer.from(signature, "hex");
      const b = Buffer.from(expectedSignature, "hex");
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * Generates a Stripe Checkout Session for subscription or top-up
   */
  async createCheckoutSession(params: {
    tenantId: string;
    userId: string;
    planTier: PlanTier | "topup_1000";
    returnUrl: string;
    stripeCustomerId?: string | null;
  }): Promise<{ sessionId: string; url: string }> {
    const isTopup = params.planTier === "topup_1000";

    if (!this.secretKey) {
      throw new ApiError(503, "Billing payments are not configured", "STRIPE_NOT_CONFIGURED");
    }

    // Call real Stripe API via fetch
    const bodyParams = new URLSearchParams();
    bodyParams.append("client_reference_id", params.tenantId);
    bodyParams.append("mode", isTopup ? "payment" : "subscription");
    const successUrl = new URL(params.returnUrl);
    successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
    successUrl.searchParams.set("success", "true");
    const cancelUrl = new URL(params.returnUrl);
    cancelUrl.searchParams.set("canceled", "true");
    bodyParams.append(
      "success_url",
      successUrl.toString().replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}"),
    );
    bodyParams.append("cancel_url", cancelUrl.toString());
    bodyParams.append("metadata[tenantId]", params.tenantId);
    bodyParams.append("metadata[userId]", params.userId);
    bodyParams.append("metadata[planTier]", params.planTier);

    if (params.stripeCustomerId) {
      bodyParams.append("customer", params.stripeCustomerId);
    }

    if (isTopup) {
      bodyParams.append("line_items[0][price_data][currency]", "usd");
      bodyParams.append("line_items[0][price_data][unit_amount]", "5000"); // $50.00
      bodyParams.append(
        "line_items[0][price_data][product_data][name]",
        "1,000 Monitoring Credits Pack",
      );
      bodyParams.append("line_items[0][quantity]", "1");
    } else {
      const priceId = this.priceIds[params.planTier as PlanTier];
      bodyParams.append("subscription_data[metadata][tenantId]", params.tenantId);
      bodyParams.append("subscription_data[metadata][planTier]", params.planTier);
      bodyParams.append("line_items[0][price]", priceId);
      bodyParams.append("line_items[0][quantity]", "1");
    }

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new ApiError(
        502,
        `Stripe checkout creation failed: ${(err as { error?: { message?: string } })?.error?.message || response.statusText}`,
        "STRIPE_API_ERROR",
      );
    }

    const data = (await response.json()) as { id: string; url: string };
    return { sessionId: data.id, url: data.url };
  }

  /**
   * Generates a Stripe Customer Portal Session for managing subscriptions
   */
  async createPortalSession(params: {
    stripeCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    if (!this.secretKey) {
      throw new ApiError(503, "Billing payments are not configured", "STRIPE_NOT_CONFIGURED");
    }

    const bodyParams = new URLSearchParams();
    bodyParams.append("customer", params.stripeCustomerId);
    bodyParams.append("return_url", params.returnUrl);

    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new ApiError(
        502,
        `Stripe billing portal creation failed: ${(err as { error?: { message?: string } })?.error?.message || response.statusText}`,
        "STRIPE_API_ERROR",
      );
    }

    const data = (await response.json()) as { url: string };
    return { url: data.url };
  }
}
