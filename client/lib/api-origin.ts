export function apiOrigin(value: string | undefined, cloudflare = false): string {
  const origin = new URL(value ?? "http://127.0.0.1:8000");
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username || origin.password || origin.pathname !== "/" ||
    origin.search || origin.hash
  ) {
    throw new Error("API_ORIGIN must be an HTTP(S) origin without credentials or a path");
  }
  const host = origin.hostname.replace(/\.$/, "");
  if (cloudflare && (
    !value || origin.protocol !== "https:" ||
    host === "localhost" || host.endsWith(".localhost") ||
    host.startsWith("127.") || host === "0.0.0.0" || host === "[::1]"
  )) {
    throw new Error(
      "Cloudflare builds require API_ORIGIN to be the public HTTPS backend origin. " +
      "Set it in the build environment or .env.production.local, then rebuild. " +
      "Wrangler runtime vars alone do not configure Next.js rewrites.",
    );
  }
  return origin.origin;
}
