import https from "node:https";
import dns from "node:dns/promises";
import { isPrivateOrRestrictedIp } from "../domain-security.service.js";
import { PublishingError } from "./publishing.validation.js";

/** Pin the checked DNS address to the TLS request; never follow credential-bearing redirects. */
export async function publicHttpsRequest(
  url: URL,
  init: { method?: string; headers: Record<string, string>; body?: string },
): Promise<Response> {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443"))
    throw new PublishingError("INVALID_PUBLIC_URL");
  const addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
  if (
    !addresses.length ||
    addresses.some((a) => {
      const normalized =
        a.family === 6 ? new URL(`https://[${a.address}]/`).hostname.slice(1, -1) : a.address;
      return normalized.startsWith("::") || isPrivateOrRestrictedIp(normalized);
    })
  )
    throw new PublishingError("PRIVATE_ADDRESS_BLOCKED");
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            request.destroy();
            reject(
              new PublishingError("CMS_RESPONSE_TOO_LARGE", undefined, init.method === "POST"),
            );
          } else chunks.push(chunk);
        });
        response.on("error", () =>
          reject(new PublishingError("CMS_NETWORK_ERROR", undefined, init.method === "POST")),
        );
        response.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          resolve(
            new Response(Buffer.concat(chunks), { status: response.statusCode ?? 502, headers }),
          );
        });
      },
    );
    request.setTimeout(30000, () => request.destroy());
    request.on("error", () =>
      reject(new PublishingError("CMS_NETWORK_ERROR", undefined, init.method === "POST")),
    );
    request.end(init.body);
  });
}
