import { createHash } from "node:crypto";
import { ApiError } from "../utils/ApiError.js";

export type PasswordSafetyCheck = (password: string) => Promise<void>;

// SHA-1 is only the provider's range lookup format; stored passwords use bcrypt.
export function createPasswordSafetyCheck(transport: typeof fetch = fetch): PasswordSafetyCheck {
  return async (password) => {
    const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    let breached = false;
    try {
      const response = await transport(
        "https://api.pwnedpasswords.com/range/" + digest.slice(0, 5),
        {
          headers: { "Add-Padding": "true", "User-Agent": "Savoir-Password-Safety" },
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        },
      );
      if (!response.ok) throw new Error("Password safety unavailable");
      const text = await response.text();
      if (!text.trim() || text.length > 2000000) throw new Error("Invalid range response");
      for (const line of text.trim().split(/\r?\n/)) {
        const match = /^([A-F0-9]{35}):(\d+)$/.exec(line);
        if (!match) throw new Error("Invalid range response");
        if (match[1] === digest.slice(5) && Number(match[2]) > 0) breached = true;
      }
    } catch {
      throw new ApiError(
        503,
        "Password safety check temporarily unavailable",
        "PASSWORD_CHECK_UNAVAILABLE",
      );
    }
    if (breached)
      throw new ApiError(
        400,
        "Choose a password that has not appeared in a data breach",
        "PASSWORD_COMPROMISED",
      );
  };
}
