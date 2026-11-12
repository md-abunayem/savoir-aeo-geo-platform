import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

// Default internal secret key derived if not supplied
const DEFAULT_KEY = Buffer.from(
  createHash("sha256").update("savoir-oauth-token-encryption-fallback-key-2026").digest(),
);

export class TokenCrypto {
  /**
   * Encrypt arbitrary OAuth payload to v1.iv.tag.ciphertext
   */
  static encrypt(value: unknown, key: Buffer = DEFAULT_KEY): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  /**
   * Decrypt v1.iv.tag.ciphertext back to object
   */
  static decrypt<T = unknown>(encrypted: string, key: Buffer = DEFAULT_KEY): T {
    const [version, iv, tag, ciphertext, extra] = encrypted.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra) {
      throw new Error("Invalid encrypted token format");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(decrypted) as T;
  }

  /**
   * Generate customer API key (sk_live_...) and its SHA-256 hash
   */
  static generateApiKey(): { secretKey: string; keyPrefix: string; keyHash: string } {
    const randomHex = randomBytes(24).toString("hex");
    const secretKey = `sk_live_${randomHex}`;
    const keyPrefix = `sk_live_${randomHex.slice(0, 6)}`;
    const keyHash = createHash("sha256").update(secretKey).digest("hex");
    return { secretKey, keyPrefix, keyHash };
  }

  /**
   * Verify an API key against stored SHA-256 hash
   */
  static verifyApiKey(key: string, expectedHash: string): boolean {
    const computed = createHash("sha256").update(key).digest("hex");
    return computed === expectedHash;
  }

  /**
   * Compute HMAC-SHA256 signature for outbound webhooks
   */
  static signWebhookPayload(arg1: string, arg2: number | string, arg3?: string): string {
    let secret: string;
    let timestamp: number;
    let payloadString: string;

    if (typeof arg2 === "number") {
      secret = arg1;
      timestamp = arg2;
      payloadString = arg3 || "";
    } else {
      payloadString = arg1;
      secret = arg2;
      timestamp = typeof arg3 === "number" ? arg3 : Math.floor(Date.now() / 1000);
    }

    const toSign = `${timestamp}.${payloadString}`;
    const hmac = createHmac("sha256", secret).update(toSign).digest("hex");
    return `t=${timestamp},v1=${hmac}`;
  }

  /**
   * Verify HMAC-SHA256 signature header against payload
   */
  static verifyWebhookSignature(
    arg1: string,
    arg2: string,
    arg3: string,
    toleranceSec = 300,
  ): boolean {
    // Can be called as (payload, signatureHeader, secret, toleranceSec)
    // or (secret, signatureHeader, payload, toleranceSec)
    let secret = arg1;
    let signatureHeader = arg2;
    let payload = arg3;

    if (arg2.startsWith("t=") && arg1.startsWith("{")) {
      payload = arg1;
      signatureHeader = arg2;
      secret = arg3;
    }

    const parts = signatureHeader.split(",");
    const tPart = parts.find((p) => p.startsWith("t="));
    const v1Part = parts.find((p) => p.startsWith("v1="));
    if (!tPart || !v1Part) return false;

    const timestamp = parseInt(tPart.slice(2), 10);
    if (isNaN(timestamp)) return false;

    const now = Math.floor(Date.now() / 1000);
    const tsSec = timestamp > 1e11 ? Math.floor(timestamp / 1000) : timestamp;
    if (Math.abs(now - tsSec) > toleranceSec) return false;

    const expectedSig = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    return v1Part.slice(3) === expectedSig;
  }

  /**
   * Generate 32-byte webhook secret
   */
  static generateWebhookSecret(): string {
    return `whsec_${randomBytes(24).toString("hex")}`;
  }
}
