import { randomUUID, createHmac } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { BillingService } from "../../src/services/billing/billing.service.js";
import { StripeAdapter } from "../../src/services/billing/stripe.adapter.js";

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let billing: BillingService;
const secret = "whsec_test_fulfillment";
const eventId = () => "evt_" + randomUUID().replaceAll("-", "");
beforeAll(async () => {
  fixture = await createDatabaseFixture();
  billing = new BillingService(
    fixture.runtime,
    new StripeAdapter({ webhookSecret: secret, growthPriceId: "price_growth_test" }),
  );
});
afterAll(async () => {
  await fixture?.close();
});

async function tenant() {
  const id = randomUUID();
  await fixture.database.query("INSERT INTO tenants(id,name) VALUES($1,'Billing test')", [id]);
  return id;
}
function event(type: string, object: Record<string, unknown>, created = 1000, id = eventId()) {
  const body = JSON.stringify({ id, type, created, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return () => billing.handleWebhook(body, `t=${timestamp},v1=${signature}`);
}
const checkout = (id: string) => ({
  id: "cs_" + id,
  customer: "cus_" + id,
  subscription: "sub_" + id,
  client_reference_id: id,
  metadata: { tenantId: id, planTier: "growth" },
  payment_status: "paid",
});
const invoice = (id: string) => ({
  id: "in_" + id,
  customer: "cus_" + id,
  parent: { subscription_details: { subscription: "sub_" + id } },
  status: "paid",
  billing_reason: "subscription_create",
  period_start: 1000,
  period_end: 2000,
});

describe("Stripe fulfillment with the restricted runtime role", () => {
  it("credits the paid invoice once across concurrent duplicate events and both categories", async () => {
    const id = await tenant();
    await event("checkout.session.completed", checkout(id))();
    expect(
      (await fixture.database.query("SELECT * FROM monitoring_credits WHERE tenant_id=$1", [id]))
        .rows,
    ).toHaveLength(0);
    const paid = event("invoice.paid", invoice(id), 1001);
    await Promise.all([paid(), paid(), event("invoice.paid", invoice(id), 1001)()]);
    expect(
      (
        await fixture.database.query(
          "SELECT available FROM monitoring_credits WHERE tenant_id=$1",
          [id],
        )
      ).rows[0].available,
    ).toBe(8000);
    expect(
      (await fixture.database.query("SELECT available FROM crawl_credits WHERE tenant_id=$1", [id]))
        .rows[0].available,
    ).toBe(2000);
    expect(
      (await fixture.database.query("SELECT * FROM credit_ledger_entries WHERE tenant_id=$1", [id]))
        .rows,
    ).toHaveLength(2);
  });
  it("defers an invoice that arrives before checkout without losing the retry", async () => {
    const id = await tenant();
    const paid = event("invoice.paid", invoice(id), 1001);
    await expect(paid()).rejects.toMatchObject({ code: "BILLING_EVENT_PENDING" });
    await event("checkout.session.completed", checkout(id))();
    await paid();
    expect(
      (
        await fixture.database.query(
          "SELECT available FROM monitoring_credits WHERE tenant_id=$1",
          [id],
        )
      ).rows[0].available,
    ).toBe(8000);
  });
  it("waits for delayed top-up payment and deduplicates the checkout object", async () => {
    const id = await tenant();
    const object = {
      ...checkout(id),
      subscription: null,
      metadata: { tenantId: id, planTier: "topup_1000" },
      payment_status: "unpaid",
    };
    await event("checkout.session.completed", object)();
    expect(
      (await fixture.database.query("SELECT * FROM monitoring_credits WHERE tenant_id=$1", [id]))
        .rows,
    ).toHaveLength(0);
    await event(
      "checkout.session.async_payment_succeeded",
      { ...object, payment_status: "paid" },
      1001,
    )();
    await event("checkout.session.completed", { ...object, payment_status: "paid" }, 1001)();
    expect(
      (
        await fixture.database.query(
          "SELECT available FROM monitoring_credits WHERE tenant_id=$1",
          [id],
        )
      ).rows[0].available,
    ).toBe(1000);
  });
  it("does not reactivate a canceled subscription with an older event", async () => {
    const id = await tenant();
    await event("checkout.session.completed", checkout(id))();
    await event(
      "customer.subscription.deleted",
      { id: "sub_" + id, customer: "cus_" + id },
      2000,
    )();
    await event(
      "customer.subscription.updated",
      { id: "sub_" + id, customer: "cus_" + id, status: "active" },
      1500,
    )();
    expect(
      (
        await fixture.database.query("SELECT status FROM tenant_subscriptions WHERE tenant_id=$1", [
          id,
        ])
      ).rows[0].status,
    ).toBe("canceled");
  });
  it("does not grant a full monthly quota for a proration invoice", async () => {
    const id = await tenant();
    await event("checkout.session.completed", checkout(id))();
    await event("invoice.paid", { ...invoice(id), billing_reason: "subscription_update" }, 1001)();
    expect(
      (await fixture.database.query("SELECT * FROM monitoring_credits WHERE tenant_id=$1", [id]))
        .rows,
    ).toHaveLength(0);
  });
  it("does not expose direct billing writes or receipts to the runtime role", async () => {
    await expect(
      fixture.runtime.query("UPDATE tenant_subscriptions SET monthly_credits=999999"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(fixture.runtime.query("DELETE FROM billing_webhook_events")).rejects.toMatchObject(
      { code: "42501" },
    );
  });
});
