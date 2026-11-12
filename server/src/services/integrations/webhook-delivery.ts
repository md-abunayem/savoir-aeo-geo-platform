import { resolve4 } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { isPrivateOrRestrictedIp } from "../domain-security.service.js";
import { ApiError } from "../../utils/ApiError.js";

export function webhookUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost")
  ) {
    throw new ApiError(
      400,
      "Use a public HTTPS hostname on port 443 for webhooks",
      "INVALID_WEBHOOK_URL",
    );
  }
  return url;
}

export async function deliverWebhook(
  value: string,
  payload: string,
  signature: string,
): Promise<number> {
  const url = webhookUrl(value);
  const addresses = await resolve4(url.hostname);
  if (!addresses.length || addresses.some(isPrivateOrRestrictedIp)) {
    throw new ApiError(
      400,
      "Webhook hostname must resolve to public addresses",
      "INVALID_WEBHOOK_URL",
    );
  }
  // Pin the validated address, preserve TLS hostname verification, and never follow redirects.
  return new Promise<number>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        family: 4,
        signal: AbortSignal.timeout(10000),
        lookup: (_hostname, _options, callback) => callback(null, addresses[0], 4),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "X-Savoir-Signature": signature,
        },
      },
      (response) => {
        const status = response.statusCode ?? 502;
        response.destroy();
        resolve(status);
      },
    );
    req.on("error", () =>
      reject(new ApiError(502, "Could not reach the webhook endpoint", "WEBHOOK_DELIVERY_FAILED")),
    );
    req.end(payload);
  });
}
