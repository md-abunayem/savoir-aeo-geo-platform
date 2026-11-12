import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { createEmailOutbox } from "../../src/services/email/outbox.service.js";
import { EmailDeliveryError, type EmailProvider } from "../../src/services/email/brevo.adapter.js";

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let outbox: ReturnType<typeof createEmailOutbox>;
const userId = randomUUID();
const message = {
  to: "recipient@test.invalid",
  subject: "Verification",
  text: "Secret one-time token: test-token",
};
const expiry = () => new Date(Date.now() + 3600000);
beforeAll(async () => {
  fixture = await createDatabaseFixture();
  await fixture.database.query(
    "INSERT INTO users(id,name,email) VALUES($1,'Mail User','mail@test.invalid')",
    [userId],
  );
  outbox = createEmailOutbox(fixture.runtime, "a".repeat(64));
});
afterAll(async () => {
  await fixture?.close();
});

describe("durable encrypted transactional email outbox", () => {
  it("deduplicates enqueues, denies raw runtime access, claims once concurrently and clears accepted payloads", async () => {
    const id = randomUUID();
    await outbox.enqueue(id, userId, message, expiry());
    await outbox.enqueue(id, userId, message, expiry());
    await expect(fixture.runtime.query("SELECT * FROM email_outbox")).rejects.toThrow();
    const raw = await fixture.database.query("SELECT * FROM email_outbox WHERE id=$1", [id]);
    expect(raw.rowCount).toBe(1);
    expect(raw.rows[0].encrypted_payload).not.toContain("test-token");
    const send = vi
      .fn<EmailProvider["send"]>()
      .mockResolvedValue({ messageId: "test-accepted", deduplicated: false });
    const results = await Promise.all([outbox.processNext({ send }), outbox.processNext({ send })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(message, id);
    const accepted = await fixture.database.query(
      "SELECT status,encrypted_payload,provider_message_id FROM email_outbox WHERE id=$1",
      [id],
    );
    expect(accepted.rows[0]).toMatchObject({
      status: "accepted",
      encrypted_payload: null,
      provider_message_id: "test-accepted",
    });
  });
  it("persists retry delays and reuses the same provider idempotency key", async () => {
    const id = randomUUID();
    await outbox.enqueue(id, userId, message, expiry());
    const send = vi
      .fn<EmailProvider["send"]>()
      .mockRejectedValueOnce(new EmailDeliveryError("RATE_LIMITED", true, 45))
      .mockResolvedValueOnce({ messageId: "retry-accepted", deduplicated: false });
    await outbox.processNext({ send });
    const pending = await fixture.database.query(
      "SELECT status,available_at FROM email_outbox WHERE id=$1",
      [id],
    );
    expect(pending.rows[0].status).toBe("pending");
    expect(pending.rows[0].available_at.getTime()).toBeGreaterThan(Date.now() + 40000);
    await fixture.database.query("UPDATE email_outbox SET available_at=now() WHERE id=$1", [id]);
    await outbox.processNext({ send });
    expect(send.mock.calls.map((call) => call[1])).toEqual([id, id]);
  });
  it("recovers a stale lease within the deduplication window without inventing a new ID", async () => {
    const id = randomUUID();
    await outbox.enqueue(id, userId, message, expiry());
    const claim = await fixture.runtime.query("SELECT * FROM savoir_email_claim()");
    expect(claim.rows[0].id).toBe(id);
    await fixture.database.query(
      "UPDATE email_outbox SET locked_at=now()-interval '2 minutes' WHERE id=$1",
      [id],
    );
    const send = vi
      .fn<EmailProvider["send"]>()
      .mockResolvedValue({ messageId: null, deduplicated: true });
    await outbox.processNext({ send });
    expect(send.mock.calls[0][1]).toBe(id);
    expect(
      (await fixture.database.query("SELECT status,error_code FROM email_outbox WHERE id=$1", [id]))
        .rows[0],
    ).toMatchObject({ status: "accepted", error_code: "PROVIDER_DEDUPLICATED" });
  });
  it("stops ambiguous retries outside the provider window and drops expired payloads", async () => {
    const id = randomUUID();
    await outbox.enqueue(id, userId, message, expiry());
    await fixture.database.query(
      "UPDATE email_outbox SET status='processing',first_attempt_at=now()-interval '21 minutes',locked_at=now()-interval '2 minutes' WHERE id=$1",
      [id],
    );
    const send = vi.fn<EmailProvider["send"]>();
    expect(await outbox.processNext({ send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(
      (await fixture.database.query("SELECT status FROM email_outbox WHERE id=$1", [id])).rows[0]
        .status,
    ).toBe("uncertain");
    await fixture.database.query(
      "UPDATE email_outbox SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [id],
    );
    await outbox.processNext({ send });
    expect(
      (await fixture.database.query("SELECT encrypted_payload FROM email_outbox WHERE id=$1", [id]))
        .rows[0].encrypted_payload,
    ).toBeNull();
  });
});
