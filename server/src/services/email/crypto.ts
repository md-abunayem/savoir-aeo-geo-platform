import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function createPayloadCipher(keyHex: string) {
  if (!/^[a-f0-9]{64}$/i.test(keyHex))
    throw new Error("Email payload encryption requires a 256-bit hex key");
  const key = Buffer.from(keyHex, "hex");
  return {
    encrypt(value: unknown) {
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
    },
    decrypt(value: string): unknown {
      const [version, iv, tag, ciphertext, extra] = value.split(".");
      if (version !== "v1" || !iv || !tag || !ciphertext || extra)
        throw new Error("Invalid encrypted email payload");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      );
    },
  };
}
