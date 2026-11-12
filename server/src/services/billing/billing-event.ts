import { z } from "zod";
import type { StripeAdapter } from "./stripe.adapter.js";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const id = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof record(value).id === "string"
      ? String(record(value).id)
      : undefined;
const seconds = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const eventSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9_]+$/),
  type: z.string(),
  created: z.number().int().nonnegative(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});
const supported = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export function normalizeBillingEvent(payload: unknown, stripe: StripeAdapter) {
  const event = eventSchema.parse(payload);
  if (!supported.has(event.type)) return { type: event.type, data: null };
  const object = event.data.object;
  const metadata = record(object.metadata);
  const subscriptionDetails = record(record(object.parent).subscription_details);
  const items = record(object.items).data;
  const item = record(Array.isArray(items) ? items[0] : undefined);
  const lines = record(object.lines).data;
  const line = record(Array.isArray(lines) ? lines[0] : undefined);
  const period = record(line.period);
  const subscriptionEvent = event.type.startsWith("customer.subscription.");
  const data = {
    eventId: event.id,
    eventType: event.type,
    created: event.created,
    objectId: z.string().min(1).max(120).parse(object.id),
    tenantId: metadata.tenantId ?? object.client_reference_id,
    customerId: id(object.customer),
    subscriptionId: subscriptionEvent
      ? id(object.id)
      : (id(object.subscription) ?? id(subscriptionDetails.subscription)),
    planTier: subscriptionEvent
      ? stripe.planForPrice(id(item.price))
      : event.type.startsWith("invoice.")
        ? stripe.planForPrice(
            id(line.price) ?? id(record(record(line.pricing).price_details).price),
          )
        : metadata.planTier,
    paid:
      event.type === "invoice.paid" ? object.status === "paid" : object.payment_status === "paid",
    status: object.status,
    billingReason: object.billing_reason,
    cancelAtPeriodEnd: object.cancel_at_period_end === true,
    periodStart:
      seconds(object.current_period_start) ??
      seconds(item.current_period_start) ??
      seconds(period.start) ??
      seconds(object.period_start),
    periodEnd:
      seconds(object.current_period_end) ??
      seconds(item.current_period_end) ??
      seconds(period.end) ??
      seconds(object.period_end),
  };
  return { type: event.type, data };
}
