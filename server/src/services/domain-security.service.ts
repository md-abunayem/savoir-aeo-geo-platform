import dns from "node:dns/promises";
import net from "node:net";
import { ApiError } from "../utils/ApiError.js";

// Restricted IPv4 CIDR ranges
const RESTRICTED_IPV4_RANGES: Array<{ network: number; mask: number; name: string }> = [
  { network: ip4ToNumber("0.0.0.0"), mask: 0xff000000, name: "Current network" }, // 0.0.0.0/8
  { network: ip4ToNumber("10.0.0.0"), mask: 0xff000000, name: "Private 10/8" }, // 10.0.0.0/8
  { network: ip4ToNumber("100.64.0.0"), mask: 0xffc00000, name: "Carrier NAT" }, // 100.64.0.0/10
  { network: ip4ToNumber("127.0.0.0"), mask: 0xff000000, name: "Loopback" }, // 127.0.0.0/8
  { network: ip4ToNumber("169.254.0.0"), mask: 0xffff0000, name: "Link-local / Cloud metadata" }, // 169.254.0.0/16
  { network: ip4ToNumber("172.16.0.0"), mask: 0xfff00000, name: "Private 172.16/12" }, // 172.16.0.0/12
  { network: ip4ToNumber("192.0.0.0"), mask: 0xffffff00, name: "IETF protocol" }, // 192.0.0.0/24
  { network: ip4ToNumber("192.0.2.0"), mask: 0xffffff00, name: "TEST-NET-1" }, // 192.0.2.0/24
  { network: ip4ToNumber("192.168.0.0"), mask: 0xffff0000, name: "Private 192.168/16" }, // 192.168.0.0/16
  { network: ip4ToNumber("198.18.0.0"), mask: 0xfffe0000, name: "Benchmarking" }, // 198.18.0.0/15
  { network: ip4ToNumber("198.51.100.0"), mask: 0xffffff00, name: "TEST-NET-2" }, // 198.51.100.0/24
  { network: ip4ToNumber("203.0.113.0"), mask: 0xffffff00, name: "TEST-NET-3" }, // 203.0.113.0/24
  { network: ip4ToNumber("224.0.0.0"), mask: 0xf0000000, name: "Multicast" }, // 224.0.0.0/4
  { network: ip4ToNumber("240.0.0.0"), mask: 0xf0000000, name: "Reserved" }, // 240.0.0.0/4
  { network: ip4ToNumber("255.255.255.255"), mask: 0xffffffff, name: "Broadcast" }, // 255.255.255.255/32
];

function ip4ToNumber(ip: string): number {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

/** Check if an IPv4 address is in any restricted/private range */
export function isRestrictedIpv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;
  const num = ip4ToNumber(ip);
  return RESTRICTED_IPV4_RANGES.some((range) => (num & range.mask) >>> 0 === range.network);
}

/** Check if an IPv6 address is in any restricted/private range */
export function isRestrictedIpv6(ip: string): boolean {
  if (!net.isIPv6(ip)) return false;
  const lower = ip.toLowerCase();

  // IPv4-mapped IPv6 (::ffff:192.0.2.128)
  if (lower.startsWith("::ffff:") || lower.includes(":ffff:")) {
    const parts = lower.split(":");
    const lastPart = parts[parts.length - 1];
    if (net.isIPv4(lastPart!)) {
      return isRestrictedIpv4(lastPart!);
    }
  }

  // Loopback (::1) and unspecified (::)
  if (lower === "::1" || lower === "::") return true;

  // Unique local addresses (fc00::/7 -> fc00 to fdff)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;

  // Link-local unicast (fe80::/10 -> fe80 to febf)
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return true;
  }

  // Documentation (2001:db8::/32)
  if (lower.startsWith("2001:db8:") || lower.startsWith("2001:0db8:")) return true;

  // Multicast (ff00::/8)
  if (lower.startsWith("ff")) return true;

  return false;
}

/** Check if any IP address (IPv4 or IPv6) is private or restricted */
export function isPrivateOrRestrictedIp(ip: string): boolean {
  return isRestrictedIpv4(ip) || isRestrictedIpv6(ip);
}

/**
 * Normalizes user-supplied domain string per ONB-FR-003:
 * - Trims whitespace
 * - Strips scheme (http/https)
 * - Strips trailing slashes, paths, and query parameters
 * - Strips leading 'www.'
 * - Lowercases
 * - Validates length and hostname structure
 */
export function normalizeDomain(input: string): string {
  if (!input || typeof input !== "string") {
    throw new ApiError(400, "Domain URL is required", "INVALID_DOMAIN");
  }

  let cleaned = input.trim().toLowerCase();

  // Strip scheme if present
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    try {
      const parsed = new URL(cleaned);
      cleaned = parsed.hostname;
    } catch {
      throw new ApiError(400, "Invalid domain URL format", "INVALID_DOMAIN");
    }
  } else {
    // If entered without protocol, strip path/query/fragment if any
    const firstSlash = cleaned.indexOf("/");
    if (firstSlash !== -1) {
      cleaned = cleaned.substring(0, firstSlash);
    }
    const firstQuestion = cleaned.indexOf("?");
    if (firstQuestion !== -1) {
      cleaned = cleaned.substring(0, firstQuestion);
    }
    const firstHash = cleaned.indexOf("#");
    if (firstHash !== -1) {
      cleaned = cleaned.substring(0, firstHash);
    }
  }

  // Check if it's an IP literal before port stripping
  if (net.isIP(cleaned)) {
    if (isPrivateOrRestrictedIp(cleaned)) {
      throw new ApiError(
        400,
        "Private IP, localhost and cloud metadata addresses are forbidden",
        "SSRF_DETECTED",
      );
    }
    throw new ApiError(
      400,
      "IP address literals cannot be registered as project domains",
      "INVALID_DOMAIN",
    );
  }

  // Strip port if present on non-IPv6
  if (cleaned.includes(":") && !cleaned.includes("]:") && !cleaned.startsWith("[")) {
    const colonIndex = cleaned.indexOf(":");
    if (colonIndex !== -1) {
      cleaned = cleaned.substring(0, colonIndex);
    }
  }

  // Strip leading www.
  if (cleaned.startsWith("www.")) {
    cleaned = cleaned.substring(4);
  }

  // Strip trailing dot
  if (cleaned.endsWith(".")) {
    cleaned = cleaned.slice(0, -1);
  }

  // Validate overall length
  if (cleaned.length < 3 || cleaned.length > 253) {
    throw new ApiError(400, "Domain length must be between 3 and 253 characters", "INVALID_DOMAIN");
  }

  // Disallow localhost and reserved test domains unless explicitly configured
  if (
    cleaned === "localhost" ||
    cleaned.endsWith(".localhost") ||
    cleaned.endsWith(".local") ||
    cleaned.endsWith(".internal")
  ) {
    throw new ApiError(
      400,
      "Localhost, .local and .internal domains are rejected for security",
      "SSRF_DETECTED",
    );
  }

  // Standard domain regex check
  const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
  if (!domainRegex.test(cleaned)) {
    throw new ApiError(400, "Domain format is invalid", "INVALID_DOMAIN");
  }

  // Validate TLD has at least 2 characters and is not pure numbers
  const labels = cleaned.split(".");
  const tld = labels[labels.length - 1]!;
  if (tld.length < 2 || /^\d+$/.test(tld)) {
    throw new ApiError(400, "Domain top-level domain is invalid", "INVALID_DOMAIN");
  }

  return cleaned;
}

export interface DomainValidationOptions {
  allowLocalTest?: boolean;
  dnsTimeoutMs?: number;
}

/**
 * Validates domain and performs SSRF protection via DNS resolution.
 * Rejects private IPs, link-local metadata (169.254.169.254), and unresolvable domains.
 */
export async function validateDomainSecurity(
  rawInput: string,
  options?: DomainValidationOptions,
): Promise<{ normalizedDomain: string; resolvedIps: string[] }> {
  const normalizedDomain = normalizeDomain(rawInput);

  // In test environments or when mock test domains ending in .invalid or .test are used
  if (
    options?.allowLocalTest &&
    (normalizedDomain.endsWith(".test") ||
      normalizedDomain.endsWith(".invalid") ||
      normalizedDomain.endsWith(".example"))
  ) {
    return { normalizedDomain, resolvedIps: ["93.184.216.34"] };
  }

  // Resolve domain IPs with timeout
  const resolvedIps: string[] = [];
  try {
    const timeoutMs = options?.dnsTimeoutMs ?? 4000;
    const lookupPromise = dns.lookup(normalizedDomain, { all: true });
    const timerPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs),
    );

    const addresses = await Promise.race([lookupPromise, timerPromise]);
    for (const entry of addresses) {
      resolvedIps.push(entry.address);
    }
  } catch (err: unknown) {
    // For local development and test suites, support test and offline domains if allowLocalTest is enabled
    if (options?.allowLocalTest) {
      return { normalizedDomain, resolvedIps: ["93.184.216.34"] };
    }
    if (err instanceof Error && err.message === "DNS_TIMEOUT") {
      throw new ApiError(408, "Domain resolution timed out", "DOMAIN_RESOLUTION_TIMEOUT");
    }
    throw new ApiError(
      400,
      `Domain "${normalizedDomain}" cannot be resolved in public DNS`,
      "DOMAIN_NOT_RESOLVED",
    );
  }

  if (resolvedIps.length === 0) {
    throw new ApiError(
      400,
      `Domain "${normalizedDomain}" returned no IP addresses`,
      "DOMAIN_NOT_RESOLVED",
    );
  }

  // Verify that NONE of the resolved IPs are in private/restricted ranges (SSRF protection)
  for (const ip of resolvedIps) {
    if (isPrivateOrRestrictedIp(ip)) {
      throw new ApiError(
        400,
        `Domain "${normalizedDomain}" resolves to restricted IP ${ip} (SSRF blocked)`,
        "SSRF_DETECTED",
      );
    }
  }

  return { normalizedDomain, resolvedIps };
}
