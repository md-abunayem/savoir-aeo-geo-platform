import { describe, it, expect } from "vitest";
import {
  normalizeDomain,
  isPrivateOrRestrictedIp,
  validateDomainSecurity,
} from "../src/services/domain-security.service.js";

describe("Domain Normalization & Security", () => {
  describe("normalizeDomain", () => {
    it("normalizes URLs with scheme, trailing slash and uppercase", () => {
      expect(normalizeDomain("https://example.com/")).toBe("example.com");
      expect(normalizeDomain("HTTP://WWW.EXAMPLE.COM/path?foo=bar#hash")).toBe("example.com");
      expect(normalizeDomain("  WWW.Sub.Domain.COM/  ")).toBe("sub.domain.com");
      expect(normalizeDomain("app.service.co.uk")).toBe("app.service.co.uk");
    });

    it("rejects invalid, empty or non-domain inputs", () => {
      expect(() => normalizeDomain("")).toThrowError(/Domain URL is required/);
      expect(() => normalizeDomain("not-a-domain")).toThrowError(/Domain format is invalid/);
      expect(() => normalizeDomain("-startwithhyphen.com")).toThrowError(
        /Domain format is invalid/,
      );
      expect(() => normalizeDomain("endwithhyphen-.com")).toThrowError(/Domain format is invalid/);
    });

    it("rejects localhost and restricted TLDs directly", () => {
      expect(() => normalizeDomain("localhost")).toThrowError(/Localhost/);
      expect(() => normalizeDomain("service.local")).toThrowError(/Localhost/);
      expect(() => normalizeDomain("api.internal")).toThrowError(/Localhost/);
    });

    it("rejects IP address literals directly", () => {
      expect(() => normalizeDomain("127.0.0.1")).toThrowError(/forbidden/);
      expect(() => normalizeDomain("169.254.169.254")).toThrowError(/forbidden/);
      expect(() => normalizeDomain("10.0.0.1")).toThrowError(/forbidden/);
      expect(() => normalizeDomain("192.168.1.1")).toThrowError(/forbidden/);
      expect(() => normalizeDomain("::1")).toThrowError(/forbidden/);
      expect(() => normalizeDomain("8.8.8.8")).toThrowError(/IP address literals/);
    });
  });

  describe("isPrivateOrRestrictedIp", () => {
    it("flags private and restricted IPv4 ranges", () => {
      expect(isPrivateOrRestrictedIp("127.0.0.1")).toBe(true);
      expect(isPrivateOrRestrictedIp("127.255.255.255")).toBe(true);
      expect(isPrivateOrRestrictedIp("10.0.0.5")).toBe(true);
      expect(isPrivateOrRestrictedIp("172.16.0.1")).toBe(true);
      expect(isPrivateOrRestrictedIp("172.31.255.255")).toBe(true);
      expect(isPrivateOrRestrictedIp("192.168.1.1")).toBe(true);
      expect(isPrivateOrRestrictedIp("169.254.169.254")).toBe(true); // AWS / Cloud metadata
      expect(isPrivateOrRestrictedIp("169.254.1.1")).toBe(true);
      expect(isPrivateOrRestrictedIp("100.64.0.1")).toBe(true);
      expect(isPrivateOrRestrictedIp("224.0.0.1")).toBe(true); // Multicast
      expect(isPrivateOrRestrictedIp("240.0.0.1")).toBe(true); // Reserved
      expect(isPrivateOrRestrictedIp("0.0.0.0")).toBe(true);
    });

    it("allows public IPv4 addresses", () => {
      expect(isPrivateOrRestrictedIp("8.8.8.8")).toBe(false);
      expect(isPrivateOrRestrictedIp("1.1.1.1")).toBe(false);
      expect(isPrivateOrRestrictedIp("93.184.216.34")).toBe(false);
      expect(isPrivateOrRestrictedIp("142.250.190.46")).toBe(false);
    });

    it("flags restricted IPv6 ranges", () => {
      expect(isPrivateOrRestrictedIp("::1")).toBe(true); // Loopback
      expect(isPrivateOrRestrictedIp("::")).toBe(true); // Unspecified
      expect(isPrivateOrRestrictedIp("fe80::1")).toBe(true); // Link-local
      expect(isPrivateOrRestrictedIp("fc00::1")).toBe(true); // Unique local
      expect(isPrivateOrRestrictedIp("fd12:3456:789a::1")).toBe(true); // Unique local
      expect(isPrivateOrRestrictedIp("::ffff:127.0.0.1")).toBe(true); // IPv4-mapped localhost
      expect(isPrivateOrRestrictedIp("::ffff:169.254.169.254")).toBe(true); // IPv4-mapped AWS metadata
    });
  });

  describe("validateDomainSecurity", () => {
    it("allows test domains with allowLocalTest option", async () => {
      const result = await validateDomainSecurity("https://example.test", { allowLocalTest: true });
      expect(result.normalizedDomain).toBe("example.test");
      expect(result.resolvedIps).toEqual(["93.184.216.34"]);
    });

    it("rejects domains that do not exist or resolve", async () => {
      await expect(
        validateDomainSecurity("nonexistent-domain-xyz-123456789.com", { allowLocalTest: false }),
      ).rejects.toThrowError(/cannot be resolved in public DNS/);
    });
  });
});
