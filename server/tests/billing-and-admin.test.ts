import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import type { Pool } from "pg";
import { StripeAdapter } from "../src/services/billing/stripe.adapter.js";
import { CreditLedgerService } from "../src/services/billing/credit-ledger.service.js";
import { BillingService } from "../src/services/billing/billing.service.js";
import { OperatorService } from "../src/services/admin/operator.service.js";

function createMockPool() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const mockResults: Array<{
    pattern: RegExp;
    result: { rows: Record<string, unknown>[]; rowCount: number };
  }> = [];

  const handleQuery = vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    for (const item of mockResults) {
      if (item.pattern.test(sql)) {
        return Promise.resolve(item.result);
      }
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  const client = {
    query: handleQuery,
    release: vi.fn(),
  };

  return {
    queries,
    addMockResult(pattern: RegExp, result: { rows: Record<string, unknown>[]; rowCount: number }) {
      mockResults.push({ pattern, result });
    },
    query: handleQuery,
    connect: vi.fn().mockResolvedValue(client),
  };
}

describe("M15 Platform Administration & Stripe Billing (ADM)", () => {
  const webhookSecret = "whsec_test_secret_for_unit_tests_2026";
  let stripeAdapter: StripeAdapter;
  let ledgerService: CreditLedgerService;
  let billingService: BillingService;
  let operatorService: OperatorService;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    mockPool = createMockPool();
    stripeAdapter = new StripeAdapter({
      webhookSecret,
      starterPriceId: "price_starter_test",
      growthPriceId: "price_growth_test",
      enterprisePriceId: "price_enterprise_test",
    });
    ledgerService = new CreditLedgerService(mockPool as unknown as Pool);
    billingService = new BillingService(mockPool as unknown as Pool, stripeAdapter);
    operatorService = new OperatorService(mockPool as unknown as Pool);
  });

  describe("Stripe Adapter & Webhook Signatures (ADM-FR-004, ADM-FR-006)", () => {
    it("validates authentic Stripe HMAC-SHA256 signature headers", () => {
      const payload = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(`${timestamp}.${payload}`, "utf-8")
        .digest("hex");

      const header = `t=${timestamp},v1=${signature}`;
      const valid = stripeAdapter.verifyWebhookSignature(payload, header);
      expect(valid).toBe(true);
    });

    it("rejects tampered payloads and forged signatures", () => {
      const payload = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
      const tamperedPayload = JSON.stringify({
        id: "evt_123",
        type: "customer.subscription.deleted",
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(`${timestamp}.${payload}`, "utf-8")
        .digest("hex");

      const header = `t=${timestamp},v1=${signature}`;
      const valid = stripeAdapter.verifyWebhookSignature(tamperedPayload, header);
      expect(valid).toBe(false);
    });

    it("rejects expired webhook timestamps beyond tolerance window", () => {
      const payload = JSON.stringify({ id: "evt_123" });
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(`${oldTimestamp}.${payload}`, "utf-8")
        .digest("hex");

      const header = `t=${oldTimestamp},v1=${signature}`;
      const valid = stripeAdapter.verifyWebhookSignature(payload, header, webhookSecret, 300);
      expect(valid).toBe(false);
    });

    it("fails explicitly when billing credentials are unconfigured", async () => {
      await expect(
        stripeAdapter.createCheckoutSession({
          tenantId: "00000000-0000-0000-0000-000000000001",
          userId: "00000000-0000-0000-0000-000000000002",
          planTier: "growth",
          returnUrl: "http://localhost:3000/billing",
        }),
      ).rejects.toMatchObject({ statusCode: 503, code: "STRIPE_NOT_CONFIGURED" });

      await expect(
        stripeAdapter.createPortalSession({
          stripeCustomerId: "cus_123",
          returnUrl: "http://localhost:3000/billing",
        }),
      ).rejects.toMatchObject({ statusCode: 503, code: "STRIPE_NOT_CONFIGURED" });
    });
  });

  describe("Atomic Credit Ledger Enforcement (ADM-FR-001, ADM-FR-002, ADM-FR-003)", () => {
    it("deducts 1 credit per monitoring run and records ledger entry", async () => {
      const tenantId = "00000000-0000-0000-0000-000000000001";
      const runId = "00000000-0000-0000-0000-000000000010";

      // Seed available credits
      mockPool.addMockResult(/SELECT available, used FROM monitoring_credits/, {
        rows: [{ available: 100, used: 25 }],
        rowCount: 1,
      });

      const res = await ledgerService.deductMonitoringRun(tenantId, runId, 1);
      expect(res.balanceAfter).toBe(99);

      // Verify UPDATE was called with new balance 99 and used 26
      const updateCall = mockPool.queries.find((q) => q.sql.includes("UPDATE monitoring_credits"));
      expect(updateCall).toBeDefined();
      expect(updateCall?.params).toEqual([99, 26, tenantId]);

      // Verify INSERT into credit_ledger_entries was called
      const ledgerInsert = mockPool.queries.find((q) =>
        q.sql.includes("INSERT INTO credit_ledger_entries"),
      );
      expect(ledgerInsert).toBeDefined();
      expect(ledgerInsert?.params?.[1]).toBe(-1); // amount
      expect(ledgerInsert?.params?.[2]).toBe(99); // balance_after
    });

    it("throws CREDITS_EXHAUSTED when balance is insufficient for run", async () => {
      const tenantId = "00000000-0000-0000-0000-000000000001";
      const runId = "00000000-0000-0000-0000-000000000011";

      mockPool.addMockResult(/SELECT available, used FROM monitoring_credits/, {
        rows: [{ available: 0, used: 2000 }],
        rowCount: 1,
      });

      await expect(ledgerService.deductMonitoringRun(tenantId, runId, 1)).rejects.toThrow(
        "Insufficient monitoring credits",
      );
    });

    it("meters crawl operations separately from monitoring runs (ADM-FR-003)", async () => {
      const tenantId = "00000000-0000-0000-0000-000000000001";
      const auditId = "00000000-0000-0000-0000-000000000020";

      mockPool.addMockResult(/SELECT available, used FROM crawl_credits/, {
        rows: [{ available: 500, used: 40 }],
        rowCount: 1,
      });

      const res = await ledgerService.deductCrawlPage(
        tenantId,
        auditId,
        "https://brand.com/pricing",
        1,
      );
      expect(res.balanceAfter).toBe(499);

      const updateCall = mockPool.queries.find((q) => q.sql.includes("UPDATE crawl_credits"));
      expect(updateCall).toBeDefined();
      expect(updateCall?.params).toEqual([499, 41, tenantId]);

      const ledgerInsert = mockPool.queries.find((q) =>
        q.sql.includes("INSERT INTO credit_ledger_entries"),
      );
      expect(ledgerInsert).toBeDefined();
      expect(ledgerInsert?.params?.[0]).toBe(tenantId);
    });

    it("atomically grants top-up credits and updates balance", async () => {
      const tenantId = "00000000-0000-0000-0000-000000000001";

      mockPool.addMockResult(/SELECT available FROM monitoring_credits/, {
        rows: [{ available: 2500 }],
        rowCount: 1,
      });

      const res = await ledgerService.grantCredits({
        tenantId,
        category: "monitoring",
        amount: 1000,
        entryType: "credit_topup",
        description: "Purchased 1,000 credit top-up pack",
      });

      expect(res.balanceAfter).toBe(2500);
      const ledgerCall = mockPool.queries.find((q) =>
        q.sql.includes("INSERT INTO credit_ledger_entries"),
      );
      expect(ledgerCall?.params?.[1]).toBe("credit_topup");
      expect(ledgerCall?.params?.[3]).toBe(1000);
    });
  });

  describe("Billing Service & Subscription Webhook Lifecycle (ADM-FR-004, ADM-FR-006)", () => {
    it("provisions starter tier if tenant has no existing subscription record", async () => {
      const tenantId = "00000000-0000-0000-0000-000000000001";

      // 1st query returns empty, after insert 2nd query returns starter
      mockPool.addMockResult(/SELECT \* FROM tenant_subscriptions WHERE tenant_id/, {
        rows: [
          {
            id: "sub-1",
            tenant_id: tenantId,
            plan_tier: "starter",
            status: "active",
            monthly_credits: 2000,
            monthly_crawl_credits: 500,
            cancel_at_period_end: false,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        rowCount: 1,
      });

      const overview = await billingService.getBillingOverview(tenantId);
      expect(overview.subscription.planTier).toBe("starter");
      expect(overview.subscription.status).toBe("active");
      expect(overview.subscription.monthlyCredits).toBe(2000);
      expect(overview.plans.growth.priceUsdMonthly).toBe(299);
    });

    it("processes checkout.session.completed webhook and activates plan", async () => {
      const tenantId = "00000000-0000-0000-0000-000000000001";
      const payload = JSON.stringify({
        id: "evt_checkout_1",
        created: Math.floor(Date.now() / 1000),
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_123",
            client_reference_id: tenantId,
            customer: "cus_stripe_1",
            subscription: "sub_stripe_1",
            metadata: { tenantId, planTier: "growth" },
          },
        },
      });

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(`${timestamp}.${payload}`, "utf-8")
        .digest("hex");
      const header = `t=${timestamp},v1=${signature}`;

      const res = await billingService.handleWebhook(payload, header);
      expect(res.received).toBe(true);
      expect(res.event).toBe("checkout.session.completed");

      // The verified event is delegated to the restricted atomic database function.
      const subUpsert = mockPool.queries.find((q) => q.sql.includes("savoir_apply_billing_event"));
      expect(subUpsert).toBeDefined();
      expect(JSON.parse(String(subUpsert?.params?.[0]))).toMatchObject({
        planTier: "growth",
        tenantId,
        subscriptionId: "sub_stripe_1",
      });
    });
  });

  describe("Internal Operator Console (ADM-FR-008 to ADM-FR-014)", () => {
    it("searches and filters customer tenants with aggregated metrics", async () => {
      mockPool.addMockResult(/SELECT COUNT\(DISTINCT t\.id\)/, {
        rows: [{ total: "1" }],
        rowCount: 1,
      });

      mockPool.addMockResult(/SELECT\s+t\.id,\s+t\.name/i, {
        rows: [
          {
            id: "00000000-0000-0000-0000-000000000001",
            name: "Acme Corp",
            region: "us",
            status: "active",
            created_at: new Date(),
            plan_tier: "growth",
            sub_status: "active",
            available_credits: 4500,
            available_crawl_credits: 1200,
            project_count: 3,
            member_count: 4,
            primary_domain: "acme.com",
          },
        ],
        rowCount: 1,
      });

      const res = await operatorService.searchTenants({ query: "Acme", planTier: "growth" });
      expect(res.totalCount).toBe(1);
      expect(res.tenants[0].name).toBe("Acme Corp");
      expect(res.tenants[0].planTier).toBe("growth");
      expect(res.tenants[0].availableCredits).toBe(4500);
    });

    it("pauses tenant and writes immutable operator audit log (ADM-FR-009, ADM-FR-012)", async () => {
      const tenantId = "00000000-0000-0000-0000-000000000001";

      mockPool.addMockResult(/SELECT name, status FROM tenants/, {
        rows: [{ name: "Acme Corp", status: "active" }],
        rowCount: 1,
      });

      const res = await operatorService.updateTenantStatus({
        operatorId: "op-sarah",
        targetTenantId: tenantId,
        status: "paused",
        reason: "Suspected credit misuse under investigation",
        ipAddress: "192.168.1.1",
      });

      expect(res.status).toBe("paused");

      const updateCall = mockPool.queries.find((q) =>
        q.sql.includes("UPDATE tenants SET status = $1"),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.params).toEqual(["paused", tenantId]);

      const auditCall = mockPool.queries.find((q) =>
        q.sql.includes("INSERT INTO operator_audit_logs"),
      );
      expect(auditCall).toBeDefined();
      expect(auditCall?.params?.[0]).toBe("op-sarah");
      expect(auditCall?.params?.[1]).toBe("tenant.paused");
    });

    it("performs manual credit adjustment with audit trail (ADM-FR-010)", async () => {
      const tenantId = "00000000-0000-0000-0000-000000000001";

      mockPool.addMockResult(/SELECT available FROM monitoring_credits/, {
        rows: [{ available: 5000 }],
        rowCount: 1,
      });

      const res = await operatorService.adjustCredits({
        operatorId: "op-sarah",
        targetTenantId: tenantId,
        category: "monitoring",
        amount: 500,
        reason: "Customer service compensation for provider outage",
      });

      expect(res.balanceAfter).toBe(5000);

      const auditCall = mockPool.queries.find((q) =>
        q.sql.includes("INSERT INTO operator_audit_logs"),
      );
      expect(auditCall).toBeDefined();
      expect(auditCall?.params?.[1]).toBe("credits.adjust");
    });

    it("reports platform queue health statistics (ADM-FR-011)", async () => {
      mockPool.addMockResult(/SELECT.*FROM monitoring_runs/s, {
        rows: [{ waiting: 5, active: 2, failed: 1, completed_today: 120 }],
        rowCount: 1,
      });
      mockPool.addMockResult(/SELECT.*FROM email_outbox/s, {
        rows: [{ waiting: 0, active: 0, failed: 0, completed_today: 45 }],
        rowCount: 1,
      });
      mockPool.addMockResult(/SELECT.*FROM technical_audits/s, {
        rows: [{ active: 1, failed: 0, completed_today: 8 }],
        rowCount: 1,
      });

      const queues = await operatorService.getQueueHealth();
      expect(queues).toHaveLength(3);
      expect(queues[0].queueName).toBe("monitoring-runs");
      expect(queues[0].status).toBe("healthy");
      expect(queues[0].waiting).toBe(5);
    });
  });
});
