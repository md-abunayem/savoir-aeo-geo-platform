import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createPasswordSafetyCheck } from "../src/services/password-safety.service.js";
import { registrationSchema } from "../src/validations/registration.validation.js";
const password = "test-password-for-range-check";
const digest = createHash("sha1").update(password).digest("hex").toUpperCase();
it("sends only the five-character prefix, requests padding and rejects positive matches", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(digest.slice(5) + ":42\r\n"));
  await expect(createPasswordSafetyCheck(transport)(password)).rejects.toMatchObject({
    code: "PASSWORD_COMPROMISED",
  });
  const [url, options] = transport.mock.calls[0]!;
  expect(url).toBe("https://api.pwnedpasswords.com/range/" + digest.slice(0, 5));
  expect(options?.headers).toMatchObject({ "Add-Padding": "true" });
  expect(JSON.stringify(transport.mock.calls)).not.toContain(password);
  expect(JSON.stringify(transport.mock.calls)).not.toContain(digest);
});
it("ignores zero-count padding and accepts an absent suffix", async () => {
  for (const body of [digest.slice(5) + ":0", "A".repeat(35) + ":12"]) {
    await expect(
      createPasswordSafetyCheck(vi.fn<typeof fetch>().mockResolvedValue(new Response(body)))(
        password,
      ),
    ).resolves.toBeUndefined();
  }
});
it("fails closed on errors and malformed responses", async () => {
  for (const response of [
    new Response("", { status: 503 }),
    new Response(""),
    new Response("bad data"),
  ]) {
    await expect(
      createPasswordSafetyCheck(vi.fn<typeof fetch>().mockResolvedValue(response))(password),
    ).rejects.toMatchObject({ code: "PASSWORD_CHECK_UNAVAILABLE" });
  }
  await expect(
    createPasswordSafetyCheck(vi.fn<typeof fetch>().mockRejectedValue(new Error("network")))(
      password,
    ),
  ).rejects.toMatchObject({ code: "PASSWORD_CHECK_UNAVAILABLE" });
});
it("normalizes email and rejects short or bcrypt-truncated passwords and unknown fields", () => {
  const base = { name: " Person ", email: " PERSON@EXAMPLE.COM ", password };
  expect(registrationSchema.parse(base)).toMatchObject({
    name: "Person",
    email: "person@example.com",
  });
  for (const bad of [
    { ...base, password: "short" },
    { ...base, password: "\u754c".repeat(25) },
    { ...base, role: "admin" },
  ])
    expect(registrationSchema.safeParse(bad).success).toBe(false);
});
