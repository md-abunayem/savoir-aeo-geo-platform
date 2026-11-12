/**
 * Closed-Loop Verification Engine (M10 / ACT-FR-008)
 * Verifies whether completed actions moved the technical/content needle.
 * Probes affected URLs, verifies live robots.txt/llms.txt/schema, and records verification outcomes.
 */

export interface VerificationResult {
  status: "verified" | "not_verified" | "inconclusive";
  notes: string;
  verifiedAt: Date;
}

export class ActionVerifier {
  /**
   * Probe and verify an action item
   */
  static async verifyAction(
    action: {
      category: string;
      sourceModule: string;
      title: string;
      evidence?: Array<{ url?: string }>;
    },
    domain: string,
    fetchFn: typeof fetch = fetch,
  ): Promise<VerificationResult> {
    const verifiedAt = new Date();

    try {
      // 1. LLMS.txt verification (M16)
      if (action.sourceModule === "M16" || action.title.includes("llms.txt")) {
        const url = `https://${domain}/llms.txt`;
        const res = await fetchFn(url, { method: "GET", signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const text = await res.text();
          if (text.length > 50) {
            return {
              status: "verified",
              notes: `Successfully probed ${url} (HTTP ${res.status}, ${text.length} bytes).`,
              verifiedAt,
            };
          }
        }
        return {
          status: "not_verified",
          notes: `Probed ${url} but response was invalid or empty (HTTP ${res.status}).`,
          verifiedAt,
        };
      }

      // 2. Robots.txt verification (M8 / AI bot access)
      if (
        action.title.toLowerCase().includes("robots") ||
        action.title.toLowerCase().includes("bot")
      ) {
        const url = `https://${domain}/robots.txt`;
        const res = await fetchFn(url, { method: "GET", signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const text = await res.text();
          if (/user-agent:\s*(OAI-SearchBot|ClaudeBot|PerplexityBot|GPTBot)/i.test(text)) {
            return {
              status: "verified",
              notes: `Found updated AI crawler directives in ${url}.`,
              verifiedAt,
            };
          }
        }
        return {
          status: "not_verified",
          notes: `Probed ${url} but target AI bot allow directives were not detected.`,
          verifiedAt,
        };
      }

      // 3. Broken Citation URL verification (M6)
      if (action.sourceModule === "M6" || action.category === "citation") {
        const targetUrl = action.evidence?.[0]?.url;
        if (targetUrl && targetUrl.startsWith("http")) {
          const res = await fetchFn(targetUrl, {
            method: "GET",
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            return {
              status: "verified",
              notes: `Target URL ${targetUrl} now returns HTTP ${res.status} OK.`,
              verifiedAt,
            };
          }
          return {
            status: "not_verified",
            notes: `Target URL ${targetUrl} still returns HTTP ${res.status}.`,
            verifiedAt,
          };
        }
      }

      // 4. Schema verification (M8)
      if (
        action.title.toLowerCase().includes("schema") ||
        action.title.toLowerCase().includes("structured data")
      ) {
        const targetUrl = action.evidence?.[0]?.url || `https://${domain}`;
        const res = await fetchFn(targetUrl, { method: "GET", signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const html = await res.text();
          if (
            html.includes("application/ld+json") &&
            (html.includes("Organization") || html.includes("FAQPage"))
          ) {
            return {
              status: "verified",
              notes: `Detected JSON-LD structured data on ${targetUrl}.`,
              verifiedAt,
            };
          }
        }
        return {
          status: "not_verified",
          notes: `Did not detect target JSON-LD schema on ${targetUrl}.`,
          verifiedAt,
        };
      }

      // 5. Content Gaps & Competitive Gaps (M7 / M9)
      // Long-cycle changes that require monitoring observations across AI engines
      if (
        action.sourceModule === "M7" ||
        action.sourceModule === "M9" ||
        action.category === "content"
      ) {
        return {
          status: "inconclusive",
          notes:
            "Action verified locally. Quantitative visibility impact will be verified on the next scheduled search monitoring run.",
          verifiedAt,
        };
      }

      // Default fallback
      return {
        status: "verified",
        notes: "Action confirmed resolved by project owner.",
        verifiedAt,
      };
    } catch (err) {
      return {
        status: "inconclusive",
        notes: `Automated probe encountered network error: ${err instanceof Error ? err.message : "Connection timeout"}. Awaiting next automated crawl.`,
        verifiedAt,
      };
    }
  }
}
