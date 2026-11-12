import { describe, it, expect } from "vitest";
import { normalizeBillingEvent } from "../src/services/billing/billing-event.js";
import { StripeAdapter } from "../src/services/billing/stripe.adapter.js";

const adapter = new StripeAdapter({ growthPriceId: "price_growth" });
describe("Stripe event normalization", () => {
  it("handles nested invoice subscription and pricing fields", () => {
    const event = normalizeBillingEvent(
      {
        id: "evt_paid",
        type: "invoice.paid",
        created: 1000,
        data: {
          object: {
            id: "in_paid",
            customer: { id: "cus_owner" },
            status: "paid",
            parent: { subscription_details: { subscription: "sub_owner" } },
            lines: {
              data: [
                {
                  pricing: { price_details: { price: "price_growth" } },
                  period: { start: 1000, end: 2000 },
                },
              ],
            },
          },
        },
      },
      adapter,
    );
    expect(event.data).toMatchObject({
      subscriptionId: "sub_owner",
      customerId: "cus_owner",
      planTier: "growth",
      paid: true,
      periodStart: 1000,
      periodEnd: 2000,
    });
  });
  it("does not treat an unpaid checkout completion as payment", () => {
    const event = normalizeBillingEvent(
      {
        id: "evt_unpaid",
        type: "checkout.session.completed",
        created: 1000,
        data: { object: { id: "cs_pending", payment_status: "unpaid" } },
      },
      adapter,
    );
    expect(event.data?.paid).toBe(false);
  });
  it("ignores unsupported signed event types", () => {
    expect(
      normalizeBillingEvent(
        { id: "evt_other", type: "customer.created", created: 1000, data: { object: {} } },
        adapter,
      ).data,
    ).toBeNull();
  });
});
