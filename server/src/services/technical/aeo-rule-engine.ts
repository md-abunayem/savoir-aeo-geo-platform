/**
 * M8 Technical AEO Auditing Rule Engine (TEC-FR-001 to TEC-FR-016)
 *
 * Evaluates:
 * 1. AI Bot Access (25%): 9 key bots (GPTBot, OAI-SearchBot, ChatGPT-User, Google-Extended, Googlebot, PerplexityBot, ClaudeBot, Bingbot, CCBot)
 * 2. Indexability & Rendering (25%): HTTP status, canonical tags, meta robots, raw vs JS-rendered DOM diff
 * 3. Schema.org Structured Data (20%): Organization, Product, Article, FAQPage, HowTo, LocalBusiness
 * 4. On-Page Answer Structure (15%): heading hierarchy, answer-first pattern, FAQ blocks, author/date metadata
 * 5. Response Time (10%): measured response duration for successfully fetched pages
 * 6. Agent-Readability & Discovery (5%): llms.txt, OpenGraph, content-to-code ratio
 */

export type TechnicalGrade = "A" | "B" | "C" | "D" | "F";
export type IssueSeverity = "critical" | "high" | "medium" | "low" | "info";
export type IssueCategory =
  | "bot_access"
  | "indexability"
  | "schema"
  | "answer_structure"
  | "performance_trust"
  | "agent_readability";

export type BotAccessStatus =
  "declared_allowed" | "declared_partial" | "declared_disallowed" | "unknown";
export type RobotsFetchStatus = "available" | "missing" | "inaccessible" | "failed";
export type CrawlStatus = "fetched" | "http_error" | "failed";
export type CanonicalStatus =
  | "match"
  | "mismatch"
  | "missing"
  | "cross_domain"
  | "conflict"
  | "host_alias_unverified"
  | "unavailable";

export interface BotEvaluation {
  bot: string;
  name: string;
  status: BotAccessStatus;
  score: number | null; // A declaration score is unavailable when robots.txt could not be inspected.
  ruleSource: string;
  impact: string;
  fixSnippet?: string;
}

export interface BotMatrixResult {
  bots: Record<string, BotEvaluation>;
  score: number | null; // null when robots.txt was not available.
  declaredAllowedCount: number;
  declaredPartialCount: number;
  declaredDisallowedCount: number;
}

export interface SchemaValidationResult {
  type: string;
  status: "valid" | "warning" | "error";
  missingRequired: string[];
  missingRecommended: string[];
  raw?: Record<string, unknown>;
}

export interface PageEvaluationInput {
  source?: "firecrawl" | "direct";
  url: string;
  finalUrl?: string;
  path: string;
  statusCode: number;
  fetchError?: string;
  crawlStatus?: CrawlStatus;
  verifiedHostAliases?: string[];
  headers?: Record<string, string>;
  rawHtml: string;
  renderedHtml?: string;
  loadTimeMs?: number;
}

export interface TechnicalIssue {
  category: IssueCategory;
  severity: IssueSeverity;
  code: string;
  title: string;
  description: string;
  recommendation: string;
  fixSnippet?: string;
  affectedUrl?: string;
}

export interface PageEvaluationResult {
  source?: "firecrawl" | "direct";
  url: string;
  finalUrl: string | null;
  path: string;
  statusCode: number;
  crawlStatus: CrawlStatus;
  fetchError: string | null;
  excluded: boolean;
  exclusionReason: string | null;
  isIndexable: boolean;
  canonicalUrl: string | null;
  canonicalStatus: CanonicalStatus;
  pageScore: number | null;
  wordCount: number;
  headingCounts: { h1: number; h2: number; h3: number; h4: number };
  answerFirstDetected: boolean;
  faqBlocksDetected: boolean;
  schemasDetected: SchemaValidationResult[];
  hasJsDomDiff: boolean;
  domDiffMetrics: {
    rawWordCount: number;
    renderedWordCount: number;
    contentShiftRatio: number;
    clientRenderedSchema: boolean;
  };
  loadTimeMs: number;
  issues: TechnicalIssue[];
}

export interface CategoryScores {
  botAccess: number | null; // 25%
  indexability: number | null; // 25%
  schema: number | null; // 20%
  answerStructure: number | null; // 15%
  performanceTrust: number | null; // 10%
  agentReadability: number | null; // 5%
}

export interface OverallTechnicalResult {
  overallScore: number;
  grade: TechnicalGrade;
  categoryScores: CategoryScores;
  botMatrix: BotMatrixResult;
  issuesSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  issues: TechnicalIssue[];
  pagesScored: number;
}

function readAttribute(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(
    new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function normalizedPath(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function wwwAlias(hostA: string, hostB: string) {
  const withoutWww = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return hostA.toLowerCase() !== hostB.toLowerCase() && withoutWww(hostA) === withoutWww(hostB);
}

const UTILITY_PATH_SEGMENTS = new Set([
  "account",
  "accounts",
  "admin",
  "auth",
  "callback",
  "cart",
  "checkout",
  "checkouts",
  "confirmation",
  "login",
  "logout",
  "oauth",
  "order-confirmation",
  "password-reset",
  "payment",
  "payments",
  "register",
  "registration",
  "reset-password",
  "session",
  "sessions",
  "sign-in",
  "sign-up",
  "signup",
  "verify-email",
  "wp-admin",
]);

export const MONITORED_BOTS: Array<{ id: string; name: string; owner: string; purpose: string }> = [
  {
    id: "GPTBot",
    name: "GPTBot",
    owner: "OpenAI",
    purpose: "AI model training and knowledge ingestion",
  },
  {
    id: "OAI-SearchBot",
    name: "OAI-SearchBot",
    owner: "OpenAI",
    purpose: "ChatGPT Search indexer and live search queries",
  },
  {
    id: "ChatGPT-User",
    name: "ChatGPT-User",
    owner: "OpenAI",
    purpose: "Live user browsing triggered directly in ChatGPT chat",
  },
  {
    id: "Google-Extended",
    name: "Google-Extended",
    owner: "Google",
    purpose: "Gemini and Vertex AI model grounding",
  },
  {
    id: "Googlebot",
    name: "Googlebot",
    owner: "Google",
    purpose: "Google Search indexer and AI Overviews retrieval",
  },
  {
    id: "PerplexityBot",
    name: "PerplexityBot",
    owner: "Perplexity AI",
    purpose: "Perplexity search crawler and real-time citations",
  },
  {
    id: "ClaudeBot",
    name: "ClaudeBot",
    owner: "Anthropic",
    purpose: "Claude model training and citation verification",
  },
  {
    id: "Bingbot",
    name: "Bingbot",
    owner: "Microsoft",
    purpose: "Microsoft Bing and Copilot answer synthesis",
  },
  {
    id: "CCBot",
    name: "CCBot",
    owner: "Common Crawl",
    purpose: "Open crawl repository powering frontier LLM pre-training",
  },
];

export class AeoRuleEngine {
  isUtilityPage(url: string, html = ""): { excluded: boolean; reason: string | null } {
    let pathSegments: string[];
    try {
      pathSegments = new URL(url).pathname
        .split("/")
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment).toLowerCase());
    } catch {
      return { excluded: false, reason: null };
    }

    const utilitySegment = pathSegments.find((segment) => UTILITY_PATH_SEGMENTS.has(segment));
    if (utilitySegment) {
      return {
        excluded: true,
        reason: `Utility route segment "/${utilitySegment}" is not public search content.`,
      };
    }

    if (/<input\b(?=[^>]*\btype\s*=\s*["']?password\b)[^>]*>/i.test(html)) {
      return { excluded: true, reason: "Password form detected; this is account-access content." };
    }
    if (/\bautocomplete\s*=\s*["']?cc-(?:number|exp|csc)\b/i.test(html)) {
      return { excluded: true, reason: "Payment form detected; this is checkout content." };
    }
    return { excluded: false, reason: null };
  }

  /**
   * 1. Evaluate AI Bot Access (TEC-FR-003)
   */
  evaluateBotAccess(
    robotsTxtContent: string,
    fetchStatus: RobotsFetchStatus = "available",
  ): BotMatrixResult {
    const groups: Array<{
      agents: string[];
      rules: Array<{ type: "allow" | "disallow"; path: string }>;
    }> = [];
    let agents: string[] = [];
    let rules: Array<{ type: "allow" | "disallow"; path: string }> = [];
    const flush = () => {
      if (agents.length) groups.push({ agents, rules });
      agents = [];
      rules = [];
    };

    for (const rawLine of robotsTxtContent.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) {
        flush();
        continue;
      }
      const directive = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
      if (!directive) continue;
      const [, name, rawValue] = directive;
      const value = rawValue.trim();
      if (name.toLowerCase() === "user-agent") {
        if (rules.length) flush();
        agents.push(value.toLowerCase());
      } else if (agents.length && value) {
        rules.push({ type: name.toLowerCase() as "allow" | "disallow", path: value });
      }
    }
    flush();

    const available = fetchStatus === "available";
    const resultBots: Record<string, BotEvaluation> = {};
    let totalScore = 0;
    let declaredAllowedCount = 0;
    let declaredPartialCount = 0;
    let declaredDisallowedCount = 0;

    for (const bot of MONITORED_BOTS) {
      let status: BotAccessStatus = "unknown";
      let ruleSource = `robots.txt ${fetchStatus}; declared permissions could not be inspected`;
      let score: number | null = null;
      let impact = `robots.txt ${fetchStatus}; no conclusion about actual bot access, indexing, or citations can be made`;

      if (available) {
        const botToken = bot.id.toLowerCase();
        const matches = groups
          .map((group) => ({
            ...group,
            specificity: group.agents.reduce(
              (longest, agent) =>
                agent !== "*" && botToken.includes(agent)
                  ? Math.max(longest, agent.length)
                  : longest,
              0,
            ),
          }))
          .filter((group) => group.specificity > 0);
        const specific = matches.length > 0;
        const matchingGroups = specific
          ? matches.filter(
              (group) => group.specificity === Math.max(...matches.map((g) => g.specificity)),
            )
          : groups.filter((group) => group.agents.includes("*"));
        const rulesToEvaluate = matchingGroups.flatMap((group) => group.rules);
        const matchesPath = (pattern: string, path: string) => {
          const anchored = pattern.endsWith("$");
          const source = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
          return new RegExp(`^${source}${anchored ? "" : ".*"}$`).test(path);
        };
        const matchingRule = (path: string) =>
          rulesToEvaluate
            .filter((rule) => rule.path && matchesPath(rule.path, path))
            .sort((a, b) => {
              const aLength = a.path.replace(/[*$]/g, "").length;
              const bLength = b.path.replace(/[*$]/g, "").length;
              return bLength - aLength || Number(b.type === "allow") - Number(a.type === "allow");
            })[0];
        const rootRule = matchingRule("/");
        const blockedPaths = rulesToEvaluate
          .filter((rule) => rule.type === "disallow" && rule.path)
          .map((rule) => rule.path.replace(/\*|\$$/g, "") || "/")
          .some((path) => matchingRule(path)?.type === "disallow");
        const rootBlocked = rootRule?.type === "disallow";
        status = rootBlocked
          ? "declared_disallowed"
          : blockedPaths
            ? "declared_partial"
            : "declared_allowed";
        score = rootBlocked ? 0 : blockedPaths ? 50 : 100;
        const source = specific ? `User-agent: ${bot.id}` : "User-agent: * or default";
        ruleSource = rootRule
          ? `${source} -> ${rootRule.type}: ${rootRule.path}`
          : `${source} -> no matching rule for /`;
        impact =
          status === "declared_disallowed"
            ? `robots.txt declares that ${bot.id} is disallowed at the site root`
            : status === "declared_partial"
              ? `robots.txt declares restrictions for some URL paths; this is not evidence that the bot has accessed them`
              : `robots.txt declares no matching restriction for the tested site root; this does not prove that the bot accessed or indexed the site`;
      }

      if (status === "declared_allowed") declaredAllowedCount++;
      else if (status === "declared_partial") declaredPartialCount++;
      else if (status === "declared_disallowed") declaredDisallowedCount++;
      if (score !== null) totalScore += score;

      const fixSnippet =
        status === "declared_partial" || status === "declared_disallowed"
          ? `# Allow ${bot.id} access for AI search visibility\nUser-agent: ${bot.id}\nAllow: /\n`
          : undefined;

      resultBots[bot.id] = {
        bot: bot.id,
        name: `${bot.name} (${bot.owner})`,
        status,
        score,
        ruleSource,
        impact,
        fixSnippet,
      };
    }

    const avgScore = available ? Math.round(totalScore / MONITORED_BOTS.length) : null;

    return {
      bots: resultBots,
      score: avgScore,
      declaredAllowedCount,
      declaredPartialCount,
      declaredDisallowedCount,
    };
  }

  /**
   * 2. Evaluate On-Page HTML (TEC-FR-004 to TEC-FR-008)
   */
  evaluatePage(input: PageEvaluationInput): PageEvaluationResult {
    const issues: TechnicalIssue[] = [];
    const html = input.rawHtml || "";
    const renderedHtml = input.renderedHtml || html;

    // --- A. Status Code & Indexability (TEC-FR-004) ---
    const is2xx = input.statusCode >= 200 && input.statusCode < 300;
    const is4xx = input.statusCode >= 400 && input.statusCode < 500;
    const is5xx = input.statusCode >= 500;
    const finalUrl = input.finalUrl || input.url;

    let isIndexable = is2xx;
    const failed = Boolean(input.fetchError);
    const httpError = !failed && !is2xx;
    const utility = this.isUtilityPage(finalUrl, input.rawHtml);
    const robotsMeta = input.rawHtml.matchAll(/<meta\b[^>]*>/gi);
    const noindexMeta = Array.from(robotsMeta).some((match) => {
      const name = readAttribute(match[0], "name")?.toLowerCase();
      const content = readAttribute(match[0], "content") ?? "";
      return (
        (name === "robots" || name === "googlebot" || name === "bingbot") &&
        /(?:^|[\s,;])noindex(?:$|[\s,;])/i.test(content)
      );
    });
    const noindexHeader = /(?:^|[\s,;])noindex(?:$|[\s,;])/i.test(
      input.headers?.["x-robots-tag"] || "",
    );
    const hasNoindex = noindexMeta || noindexHeader;

    if (failed) {
      issues.push({
        category: "indexability",
        severity: "high",
        code: "FETCH_FAILED",
        title: "Page request failed",
        description: `The page could not be fetched: ${input.fetchError}.`,
        recommendation: "Verify that the URL is publicly reachable and retry the audit.",
        affectedUrl: input.url,
      });
    } else if (is4xx || is5xx) {
      isIndexable = false;
      issues.push({
        category: "indexability",
        severity: is5xx ? "critical" : "high",
        code: `HTTP_${input.statusCode}`,
        title: `Page returned HTTP ${input.statusCode}`,
        description: `AI search crawlers encountered a client or server error (${input.statusCode}) when fetching this page.`,
        recommendation: `Ensure the URL returns a clean HTTP 200 OK status code.`,
        affectedUrl: input.url,
      });
    }

    if (httpError && input.statusCode >= 300 && input.statusCode < 400) {
      issues.push({
        category: "indexability",
        severity: "medium",
        code: `HTTP_REDIRECT_${input.statusCode}`,
        title: `Page redirects with HTTP ${input.statusCode}`,
        description: `This URL redirects to another destination, adding hop latency for AI crawlers.`,
        recommendation: `Update internal links and sitemaps directly to the canonical target URL.`,
        affectedUrl: input.url,
      });
    }

    if (hasNoindex) {
      isIndexable = false;
      issues.push({
        category: "indexability",
        severity: utility.excluded ? "info" : "critical",
        code: utility.excluded ? "UTILITY_PAGE_NOINDEX" : "META_ROBOTS_NOINDEX",
        title: utility.excluded
          ? "Intentional noindex on utility page"
          : "Public page is marked noindex",
        description: utility.excluded
          ? `This utility page is marked noindex and excluded from scoring. ${utility.reason}`
          : "The public page has a meta robots tag or X-Robots-Tag containing noindex and is excluded from search indexing.",
        recommendation: utility.excluded
          ? "Keep the noindex directive if this page is intended only for account, authentication, payment, or other utility tasks."
          : "Remove the noindex directive if this public page should be eligible for search discovery.",
        fixSnippet: utility.excluded ? undefined : '<meta name="robots" content="index, follow" />',
        affectedUrl: finalUrl,
      });
    }

    if (failed || httpError) {
      return this.unusablePageResult(input, finalUrl, issues, failed ? "failed" : "http_error");
    }
    if (utility.excluded) {
      if (!hasNoindex) {
        issues.push({
          category: "indexability",
          severity: "info",
          code: "UTILITY_PAGE_EXCLUDED",
          title: "Utility page excluded from score",
          description: `${utility.reason} The page remains visible in crawl results but does not affect public-content scores.`,
          recommendation:
            "No action is needed unless this URL is meant to be public search content.",
          affectedUrl: finalUrl,
        });
      }
      return this.unusablePageResult(input, finalUrl, issues, "fetched", utility.reason);
    }

    // Canonical Tag Check
    const canonicalLinks = Array.from(html.matchAll(/<link\b[^>]*>/gi))
      .filter((match) =>
        (readAttribute(match[0], "rel") || "").toLowerCase().split(/\s+/).includes("canonical"),
      )
      .map((match) => readAttribute(match[0], "href")?.trim())
      .filter((href): href is string => Boolean(href));
    const canonicalTargets = Array.from(new Set(canonicalLinks));
    let canonicalUrl = canonicalTargets[0] ?? null;

    let canonicalStatus: CanonicalStatus = "match";

    if (canonicalTargets.length > 1) {
      canonicalStatus = "conflict";
      issues.push({
        category: "indexability",
        severity: "high",
        code: "CANONICAL_CONFLICT",
        title: "Conflicting canonical URLs detected",
        description:
          "The page declares more than one distinct canonical target, so the preferred URL is ambiguous.",
        recommendation: "Keep one canonical link and point it to the intended authoritative URL.",
        affectedUrl: finalUrl,
      });
    } else if (!canonicalUrl) {
      canonicalStatus = "missing";
      issues.push({
        category: "indexability",
        severity: "medium",
        code: "CANONICAL_MISSING",
        title: "Missing canonical URL tag",
        description:
          "Without a canonical tag, AI engines may split citation authority across query variants or protocols.",
        recommendation: `Add a self-referential canonical tag pointing to ${finalUrl}.`,
        fixSnippet: `<link rel="canonical" href="${finalUrl}" />`,
        affectedUrl: finalUrl,
      });
    } else {
      try {
        const parsedCurrent = new URL(finalUrl);
        const parsedCanonical = new URL(canonicalUrl, finalUrl);
        canonicalUrl = parsedCanonical.href;
        const verifiedAliases = new Set(
          (input.verifiedHostAliases || []).map((host) => host.toLowerCase()),
        );
        const verifiedSameHost =
          parsedCanonical.hostname === parsedCurrent.hostname ||
          (verifiedAliases.has(parsedCanonical.hostname.toLowerCase()) &&
            verifiedAliases.has(parsedCurrent.hostname.toLowerCase()));
        const sameWwwAlias = wwwAlias(parsedCurrent.hostname, parsedCanonical.hostname);

        if (sameWwwAlias && !verifiedSameHost) {
          canonicalStatus = "host_alias_unverified";
          issues.push({
            category: "indexability",
            severity: "medium",
            code: "CANONICAL_HOST_ALIAS_UNVERIFIED",
            title: "Canonical uses an unverified www hostname alias",
            description: `The canonical uses ${parsedCanonical.hostname} while the fetched page resolves to ${parsedCurrent.hostname}; no www/non-www redirect between them was observed.`,
            recommendation:
              "Verify the preferred host with a redirect and use it consistently in canonical URLs.",
            affectedUrl: finalUrl,
          });
        } else if (!verifiedSameHost) {
          canonicalStatus = "cross_domain";
          issues.push({
            category: "indexability",
            severity: "high",
            code: "CANONICAL_CROSS_DOMAIN",
            title: "Cross-domain canonical URL detected",
            description: `This page points its canonical authority to an external domain (${parsedCanonical.hostname}).`,
            recommendation:
              "Verify whether this page is intentionally syndicated or if the canonical should be self-referential.",
            affectedUrl: finalUrl,
          });
        } else if (
          normalizedPath(parsedCanonical.pathname) !== normalizedPath(parsedCurrent.pathname)
        ) {
          canonicalStatus = "mismatch";
          issues.push({
            category: "indexability",
            severity: "medium",
            code: "CANONICAL_MISMATCH",
            title: "Canonical URL does not match current page URL",
            description: `Page path (${parsedCurrent.pathname}) differs from canonical path (${parsedCanonical.pathname}).`,
            recommendation:
              "Ensure canonical tags accurately reflect the authoritative version of the content.",
            affectedUrl: finalUrl,
          });
        }
      } catch {
        canonicalStatus = "mismatch";
        issues.push({
          category: "indexability",
          severity: "medium",
          code: "CANONICAL_INVALID",
          title: "Canonical URL is invalid",
          description: "The canonical target could not be resolved against the final fetched URL.",
          recommendation:
            "Use a valid absolute URL or a resolvable relative path in the canonical link.",
          affectedUrl: finalUrl,
        });
      }
    }

    // --- B. Heading Hierarchy & Answer-First Structure (TEC-FR-007) ---
    const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];
    const h2Matches = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [];
    const h3Matches = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/gi) || [];
    const h4Matches = html.match(/<h4[^>]*>([\s\S]*?)<\/h4>/gi) || [];

    const headingCounts = {
      h1: h1Matches.length,
      h2: h2Matches.length,
      h3: h3Matches.length,
      h4: h4Matches.length,
    };

    if (headingCounts.h1 === 0) {
      issues.push({
        category: "answer_structure",
        severity: "high",
        code: "HEADING_H1_MISSING",
        title: "Missing <h1> primary heading",
        description:
          "AI search engines use the <h1> tag as the primary topical anchor for intent extraction.",
        recommendation:
          "Add a single, descriptive <h1> heading summarizing the main subject of the page.",
        affectedUrl: finalUrl,
      });
    } else if (headingCounts.h1 > 1) {
      issues.push({
        category: "answer_structure",
        severity: "low",
        code: "HEADING_H1_MULTIPLE",
        title: "Multiple <h1> headings found",
        description: `Found ${headingCounts.h1} <h1> tags. Multiple primary headings can diffuse topical clarity for AI parsers.`,
        recommendation:
          "Use exactly one <h1> per page and structure subtopics with <h2> and <h3> tags.",
        affectedUrl: finalUrl,
      });
    }

    if (headingCounts.h1 > 0 && headingCounts.h2 === 0 && headingCounts.h3 > 0) {
      issues.push({
        category: "answer_structure",
        severity: "medium",
        code: "HEADING_LEVEL_SKIPPED",
        title: "Skipped heading level detected (h1 directly to h3)",
        description:
          "Skipping heading levels creates broken hierarchical document outlines for LLM parsers.",
        recommendation: "Maintain sequential heading levels (h1 -> h2 -> h3).",
        affectedUrl: finalUrl,
      });
    }

    // Word Count & Clean Text Extraction
    const cleanText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;

    if (wordCount < 100 && isIndexable) {
      issues.push({
        category: "answer_structure",
        severity: "high",
        code: "THIN_CONTENT",
        title: "Very low word count (< 100 words)",
        description:
          "Pages with minimal text offer insufficient depth for AI models to extract answers or generate citations.",
        recommendation:
          "Provide comprehensive context, direct definitions, and key data points on this topic.",
        affectedUrl: finalUrl,
      });
    }

    // Answer-First Pattern Check
    // Checks if the first 150 words contain concise factual answers or direct definitions
    const first150Words = cleanText.split(/\s+/).slice(0, 150).join(" ").toLowerCase();
    const answerFirstKeywords = [
      "is a",
      "is the",
      "refers to",
      "provides",
      "designed to",
      "enables",
      "helps",
      "allows",
    ];
    const answerFirstDetected = answerFirstKeywords.some((kw) => first150Words.includes(kw));

    if (!answerFirstDetected && wordCount >= 150) {
      issues.push({
        category: "answer_structure",
        severity: "low",
        code: "NO_ANSWER_FIRST_PATTERN",
        title: "Review introductory answer clarity",
        description:
          "A keyword heuristic found no common definition pattern in the first 150 words. This is a content review suggestion; it does not prove the introduction is unclear or predict AI citations.",
        recommendation:
          "Place the core definition or direct solution immediately under the primary heading.",
        affectedUrl: finalUrl,
      });
    }

    // FAQ Blocks Check
    const faqBlocksDetected =
      /faq|frequently\s+asked\s+questions/i.test(html) ||
      /<details[\s\S]*?<summary/i.test(html) ||
      /"@type":\s*"FAQPage"/i.test(html);

    // E-E-A-T & Author Metadata Check
    const hasAuthor =
      /<meta\s+[^>]*name=["']author["'][^>]*content=["'][^"']+["']/i.test(html) ||
      /rel=["']author["']/i.test(html) ||
      /"author":\s*\{/i.test(html);

    const hasDate =
      /<meta\s+[^>]*property=["']article:published_time["']/i.test(html) ||
      /<meta\s+[^>]*name=["']date["']/i.test(html) ||
      /"datePublished":/i.test(html);

    const isArticle =
      /"@type"\s*:\s*(?:"(?:Article|BlogPosting|NewsArticle)"|\[[^\]]*"(?:Article|BlogPosting|NewsArticle)")/i.test(
        html,
      ) ||
      /<meta\b(?=[^>]*\bproperty=["']og:type["'])(?=[^>]*\bcontent=["']article["'])[^>]*>/i.test(
        html,
      );
    if (isArticle && !hasAuthor && !hasDate && wordCount > 300) {
      issues.push({
        category: "answer_structure",
        severity: "low",
        code: "EEAT_METADATA_MISSING",
        title: "Missing author and publication date metadata",
        description:
          "Article-like content has no detected author or publication metadata. Review whether authorship and dates are appropriate for this content; this check does not establish its authority.",
        recommendation:
          "Include explicit author bylines and ISO 8601 publication/modification timestamps.",
        affectedUrl: finalUrl,
      });
    }

    // --- C. Schema.org Structured Data Extraction & Validation (TEC-FR-006) ---
    const schemasDetected = this.extractAndValidateSchemas(html);

    if (schemasDetected.length === 0) {
      issues.push({
        category: "schema",
        severity: "high",
        code: "SCHEMA_MISSING",
        title: "No Schema.org structured data detected",
        description:
          "Structured JSON-LD data enables AI models to parse entities, products, and Q&A relationships deterministically.",
        recommendation:
          "Add appropriate Schema.org JSON-LD (e.g. Organization, Product, Article, or FAQPage).",
        fixSnippet: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "WebPage",\n  "name": "Page Title"\n}\n</script>`,
        affectedUrl: finalUrl,
      });
    } else {
      for (const s of schemasDetected) {
        if (s.status === "error") {
          issues.push({
            category: "schema",
            severity: "high",
            code: `SCHEMA_${s.type.toUpperCase()}_INCOMPLETE`,
            title: `Schema ${s.type} is missing required fields`,
            description: `The ${s.type} structured data is missing: ${s.missingRequired.join(", ")}.`,
            recommendation: `Add the missing required properties to make the schema valid for AI ingestors.`,
            affectedUrl: finalUrl,
          });
        } else if (s.status === "warning") {
          issues.push({
            category: "schema",
            severity: "low",
            code: `SCHEMA_${s.type.toUpperCase()}_RECOMMENDED`,
            title: `Schema ${s.type} lacks recommended fields`,
            description: `Consider adding recommended properties: ${s.missingRecommended.join(", ")}.`,
            recommendation: `Providing rich schema properties improves entity disambiguation in AI answer generation.`,
            affectedUrl: finalUrl,
          });
        }
      }
    }

    // --- D. Raw vs JS-Rendered DOM Diffing (TEC-FR-005) ---
    const rawCleanText = cleanText;
    const renderedCleanText = renderedHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const rawWords = rawCleanText ? rawCleanText.split(/\s+/).length : 0;
    const renderedWords = renderedCleanText ? renderedCleanText.split(/\s+/).length : 0;

    const rawSchemaCount = schemasDetected.length;
    const renderedSchemaCount = this.extractAndValidateSchemas(renderedHtml).length;
    const clientRenderedSchema = renderedSchemaCount > rawSchemaCount;

    const contentShiftRatio = rawWords > 0 ? Math.abs(renderedWords - rawWords) / rawWords : 0;
    const hasJsDomDiff = contentShiftRatio > 0.3 || clientRenderedSchema;

    if (contentShiftRatio > 0.4 && renderedWords > rawWords) {
      issues.push({
        category: "indexability",
        severity: "high",
        code: "CSR_CONTENT_GAP",
        title: "Substantial content rendered only via client-side JavaScript",
        description: `Over 40% of page content appears only after JavaScript execution. Non-rendering AI bots may miss this content.`,
        recommendation:
          "Ensure critical text and definitions are server-side rendered (SSR) or statically generated (SSG).",
        affectedUrl: finalUrl,
      });
    }

    if (clientRenderedSchema) {
      issues.push({
        category: "schema",
        severity: "medium",
        code: "SCHEMA_CLIENT_RENDERED",
        title: "Schema.org structured data is injected only via client-side JS",
        description: "Static crawlers inspecting raw HTML will not discover this structured data.",
        recommendation:
          "Render Schema.org JSON-LD scripts server-side in the initial HTML payload.",
        affectedUrl: input.url,
      });
    }

    // --- E. Performance & Latency (TEC-FR-009) ---
    const loadTimeMs = input.loadTimeMs || 0;
    if (input.source !== "firecrawl" && loadTimeMs > 1200) {
      issues.push({
        category: "performance_trust",
        severity: "medium",
        code: "HIGH_RESPONSE_TIME",
        title: `High response duration (${loadTimeMs}ms)`,
        description:
          "The audit measured a long response duration for this request; this measurement does not establish how quickly another crawler receives the page.",
        recommendation:
          "Review server response and page delivery performance; the audit duration includes the response body download.",
        affectedUrl: input.url,
      });
    }

    // --- Compute Individual Page Score ---
    const pageScore = this.computePageScore({
      isIndexable,
      statusCode: input.statusCode,
      canonicalStatus,
      headingCounts,
      wordCount,
      answerFirstDetected,
      schemasDetected,
      hasJsDomDiff,
      loadTimeMs: input.source === "firecrawl" ? 0 : loadTimeMs,
      issuesCount: issues.length,
    });

    return {
      url: input.url,
      finalUrl,
      source: input.source,
      path: input.path,
      statusCode: input.statusCode,
      crawlStatus: "fetched",
      fetchError: null,
      excluded: false,
      exclusionReason: null,
      isIndexable,
      canonicalUrl,
      canonicalStatus,
      pageScore,
      wordCount,
      headingCounts,
      answerFirstDetected,
      faqBlocksDetected,
      schemasDetected,
      hasJsDomDiff,
      domDiffMetrics: {
        rawWordCount: rawWords,
        renderedWordCount: renderedWords,
        contentShiftRatio: parseFloat(contentShiftRatio.toFixed(2)),
        clientRenderedSchema,
      },
      loadTimeMs,
      issues,
    };
  }

  private unusablePageResult(
    input: PageEvaluationInput,
    finalUrl: string,
    issues: TechnicalIssue[],
    crawlStatus: CrawlStatus,
    exclusionReason: string | null = null,
  ): PageEvaluationResult {
    return {
      url: input.url,
      finalUrl: input.finalUrl || (crawlStatus === "failed" ? null : finalUrl),
      path: input.path,
      statusCode: input.statusCode,
      crawlStatus,
      fetchError: input.fetchError || null,
      excluded: crawlStatus === "fetched" && exclusionReason !== null,
      exclusionReason,
      isIndexable: false,
      canonicalUrl: null,
      canonicalStatus: "unavailable",
      pageScore: null,
      wordCount: 0,
      headingCounts: { h1: 0, h2: 0, h3: 0, h4: 0 },
      answerFirstDetected: false,
      faqBlocksDetected: false,
      schemasDetected: [],
      hasJsDomDiff: false,
      domDiffMetrics: {
        rawWordCount: 0,
        renderedWordCount: 0,
        contentShiftRatio: 0,
        clientRenderedSchema: false,
      },
      loadTimeMs: input.loadTimeMs || 0,
      issues,
    };
  }

  /**
   * 3. Extract and Validate Schema.org types (TEC-FR-006)
   */
  extractAndValidateSchemas(html: string): SchemaValidationResult[] {
    const results: SchemaValidationResult[] = [];
    const scriptMatches = html.matchAll(
      /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    );

    for (const match of scriptMatches) {
      const rawText = match[1]?.trim();
      if (!rawText) continue;

      try {
        const parsed = JSON.parse(rawText) as
          Record<string, unknown> | Array<Record<string, unknown>>;
        const items = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of items) {
          if (!item || typeof item !== "object") continue;

          // Check if "@graph" array is present
          if (Array.isArray(item["@graph"])) {
            for (const graphItem of item["@graph"]) {
              if (graphItem && typeof graphItem === "object") {
                this.validateSingleSchema(graphItem as Record<string, unknown>, results);
              }
            }
          } else {
            this.validateSingleSchema(item, results);
          }
        }
      } catch {
        results.push({
          type: "Invalid_JSON_LD",
          status: "error",
          missingRequired: ["valid_json_syntax"],
          missingRecommended: [],
        });
      }
    }

    return results;
  }

  private validateSingleSchema(item: Record<string, unknown>, results: SchemaValidationResult[]) {
    const rawType = item["@type"];
    if (!rawType || typeof rawType !== "string") return;

    const type = rawType.trim();
    const missingRequired: string[] = [];
    const missingRecommended: string[] = [];

    switch (type.toLowerCase()) {
      case "organization":
      case "corporation":
        if (!item.name) missingRequired.push("name");
        if (!item.url) missingRequired.push("url");
        if (!item.logo) missingRecommended.push("logo");
        if (!item.sameAs) missingRecommended.push("sameAs");
        break;

      case "product":
        if (!item.name) missingRequired.push("name");
        if (!item.description) missingRecommended.push("description");
        if (!item.brand) missingRecommended.push("brand");
        if (!item.offers) missingRecommended.push("offers");
        if (!item.aggregateRating) missingRecommended.push("aggregateRating");
        break;

      case "article":
      case "blogposting":
      case "newsarticle":
        if (!item.headline) missingRequired.push("headline");
        if (!item.author) missingRecommended.push("author");
        if (!item.datePublished) missingRecommended.push("datePublished");
        if (!item.publisher) missingRecommended.push("publisher");
        break;

      case "faqpage":
        if (!Array.isArray(item.mainEntity) || item.mainEntity.length === 0) {
          missingRequired.push("mainEntity (Question array)");
        }
        break;

      case "howto":
        if (!item.name) missingRequired.push("name");
        if (!Array.isArray(item.step) || item.step.length === 0) {
          missingRequired.push("step (HowToStep array)");
        }
        break;

      case "localbusiness":
        if (!item.name) missingRequired.push("name");
        if (!item.address) missingRequired.push("address");
        if (!item.telephone) missingRecommended.push("telephone");
        break;

      default:
        // Generic schema object
        break;
    }

    let status: "valid" | "warning" | "error" = "valid";
    if (missingRequired.length > 0) status = "error";
    else if (missingRecommended.length > 0) status = "warning";

    results.push({
      type,
      status,
      missingRequired,
      missingRecommended,
      raw: item,
    });
  }

  /**
   * 4. Compute Technical AEO Score (0-100) & Grade (TEC-FR-010)
   *
   * Weighted formula:
   * Score = 0.25 * botAccess + 0.25 * indexability + 0.20 * schema + 0.15 * answerStructure + 0.10 * performanceTrust + 0.05 * agentReadability
   */
  calculateOverallAuditResult(
    botMatrix: BotMatrixResult,
    pages: PageEvaluationResult[],
    siteWideChecks: {
      hasLlmsTxt: boolean | null;
      hasSitemap: boolean | null;
      robotsStatus: RobotsFetchStatus;
      robotsHttpStatus?: number | null;
      robotsError?: string | null;
    },
  ): OverallTechnicalResult {
    const scoredPages = pages.filter(
      (page) => page.crawlStatus === "fetched" && !page.excluded && page.pageScore !== null,
    );
    const pageCount = scoredPages.length;

    // 1. Bot Access Score (25%)
    const botAccessScore = botMatrix.score;

    // 2. Indexability Score (25%)
    const indexablePages = scoredPages.filter((p) => p.isIndexable).length;
    const cleanCanonicalPages = scoredPages.filter((p) => p.canonicalStatus === "match").length;
    const noJsGapPages = scoredPages.filter((p) => !p.hasJsDomDiff).length;
    const indexabilityScore =
      pageCount > 0
        ? Math.round(
            (indexablePages / pageCount) * 50 +
              (cleanCanonicalPages / pageCount) * 30 +
              (noJsGapPages / pageCount) * 20,
          )
        : null;

    // 3. Schema Score (20%)
    const pagesWithSchema = scoredPages.filter((p) => p.schemasDetected.length > 0).length;
    const pagesWithValidSchema = scoredPages.filter(
      (p) => p.schemasDetected.length > 0 && p.schemasDetected.every((s) => s.status !== "error"),
    ).length;
    const schemaScore =
      pageCount > 0
        ? Math.round((pagesWithSchema / pageCount) * 40 + (pagesWithValidSchema / pageCount) * 60)
        : null;

    // 4. Answer Structure Score (15%)
    const pagesWithValidH1 = scoredPages.filter((p) => p.headingCounts.h1 === 1).length;
    const pagesWithAnswerFirst = scoredPages.filter((p) => p.answerFirstDetected).length;
    const pagesWithFaq = scoredPages.filter((p) => p.faqBlocksDetected).length;
    const answerStructureScore =
      pageCount > 0
        ? Math.round(
            (pagesWithValidH1 / pageCount) * 40 +
              (pagesWithAnswerFirst / pageCount) * 40 +
              (pagesWithFaq / pageCount) * 20,
          )
        : null;

    // HTTPS is not assessed here; the crawl always starts over HTTPS and cannot prove redirect enforcement.
    const measuredPages = scoredPages.filter((p) => p.source !== "firecrawl" && p.loadTimeMs > 0);
    const fastPages = measuredPages.filter((p) => p.loadTimeMs <= 1000).length;
    const performanceTrustScore =
      measuredPages.length > 0 ? Math.round((fastPages / measuredPages.length) * 100) : null;

    // 6. Agent-Readability & Discovery (5%)
    const knownDiscoveryChecks = [siteWideChecks.hasLlmsTxt, siteWideChecks.hasSitemap].filter(
      (value): value is boolean => value !== null,
    );
    const agentReadabilityScore =
      knownDiscoveryChecks.length > 0
        ? Math.round(
            (knownDiscoveryChecks.filter(Boolean).length / knownDiscoveryChecks.length) * 100,
          )
        : null;

    // Normalize across categories with evidence. Unavailable checks do not count as zero.
    const categoryEntries: Array<[keyof CategoryScores, number | null, number]> = [
      ["botAccess", botAccessScore, 25],
      ["indexability", indexabilityScore, 25],
      ["schema", schemaScore, 20],
      ["answerStructure", answerStructureScore, 15],
      ["performanceTrust", performanceTrustScore, 10],
      ["agentReadability", agentReadabilityScore, 5],
    ];
    const availableWeight = categoryEntries.reduce(
      (weight, [, score, categoryWeight]) => weight + (score === null ? 0 : categoryWeight),
      0,
    );
    const overallScore =
      pageCount === 0
        ? 0
        : Math.min(
            100,
            Math.max(
              0,
              availableWeight > 0
                ? Math.round(
                    categoryEntries.reduce(
                      (score, [, categoryScore, weight]) =>
                        score + (categoryScore === null ? 0 : categoryScore * weight),
                      0,
                    ) / availableWeight,
                  )
                : 0,
            ),
          );

    const grade: TechnicalGrade =
      overallScore >= 85
        ? "A"
        : overallScore >= 70
          ? "B"
          : overallScore >= 55
            ? "C"
            : overallScore >= 40
              ? "D"
              : "F";

    // Collect all issues across site-wide checks and pages
    const allIssues: TechnicalIssue[] = [];

    if (siteWideChecks.robotsStatus !== "available") {
      const label =
        siteWideChecks.robotsStatus === "missing"
          ? "not found"
          : siteWideChecks.robotsStatus === "inaccessible"
            ? "inaccessible"
            : "request failed";
      allIssues.push({
        category: "bot_access",
        severity: "info",
        code: `ROBOTS_TXT_${siteWideChecks.robotsStatus.toUpperCase()}`,
        title: `robots.txt ${label}`,
        description: `Declared crawl permissions could not be inspected${siteWideChecks.robotsHttpStatus ? ` (HTTP ${siteWideChecks.robotsHttpStatus})` : ""}${siteWideChecks.robotsError ? `: ${siteWideChecks.robotsError}` : ""}. This does not establish whether bots accessed, indexed, or cited the site.`,
        recommendation:
          "Make robots.txt publicly available if you want to publish crawl-permission directives.",
      });
    }

    // Site-wide declared bot permissions, not observed bot activity.
    for (const bot of Object.values(botMatrix.bots)) {
      if (bot.status === "declared_disallowed") {
        allIssues.push({
          category: "bot_access",
          severity: "high",
          code: `BOT_${bot.bot.toUpperCase()}_DECLARED_DISALLOW`,
          title: `robots.txt declares ${bot.bot} disallowed at the site root`,
          description: bot.impact,
          recommendation: `If this bot should be allowed to fetch public pages, review the matching robots.txt rules for ${bot.bot}.`,
          fixSnippet: bot.fixSnippet,
        });
      }
    }

    // Site-wide discovery file issues
    if (siteWideChecks.hasLlmsTxt === false) {
      allIssues.push({
        category: "agent_readability",
        severity: "info",
        code: "LLMS_TXT_MISSING",
        title: "Optional /llms.txt discovery file not found",
        description:
          "No /llms.txt file was found. A curated discovery file is optional; this does not establish an indexing error or prove that AI systems cannot read the website.",
        recommendation:
          "Create a /llms.txt file containing a curated overview of your key documentation and pages.",
        fixSnippet:
          "# My Brand\n\n> Concise summary of what the brand does.\n\n## Core Documentation\n- [Product Overview](/products)\n- [API Reference](/docs)\n",
      });
    }
    if (siteWideChecks.hasLlmsTxt === null) {
      allIssues.push({
        category: "agent_readability",
        severity: "info",
        code: "LLMS_TXT_CHECK_UNAVAILABLE",
        title: "Could not inspect /llms.txt",
        description: "The request did not establish whether an /llms.txt file exists.",
        recommendation: "Retry the audit when the site is reachable.",
      });
    }

    if (siteWideChecks.hasSitemap === false) {
      allIssues.push({
        category: "indexability",
        severity: "medium",
        code: "SITEMAP_MISSING",
        title: "No sitemap declaration or /sitemap.xml response found",
        description:
          "The audit found no sitemap URL in accessible robots.txt and no successful response from /sitemap.xml. A sitemap at another location may still exist.",
        recommendation:
          "Generate an XML sitemap and reference it in robots.txt via 'Sitemap: https://yourdomain.com/sitemap.xml'.",
      });
    }
    if (siteWideChecks.hasSitemap === null) {
      allIssues.push({
        category: "indexability",
        severity: "info",
        code: "SITEMAP_CHECK_UNAVAILABLE",
        title: "Could not inspect sitemap availability",
        description: "A request failure is not evidence that the site has no sitemap.",
        recommendation: "Retry the audit when the site is reachable.",
      });
    }

    // Add page-level issues
    for (const page of pages) {
      allIssues.push(...page.issues);
    }

    const issuesSummary = {
      critical: allIssues.filter((i) => i.severity === "critical").length,
      high: allIssues.filter((i) => i.severity === "high").length,
      medium: allIssues.filter((i) => i.severity === "medium").length,
      low: allIssues.filter((i) => i.severity === "low").length,
      info: allIssues.filter((i) => i.severity === "info").length,
      total: allIssues.length,
    };

    return {
      overallScore,
      grade,
      categoryScores: {
        botAccess: botAccessScore,
        indexability: indexabilityScore,
        schema: schemaScore,
        answerStructure: answerStructureScore,
        performanceTrust: performanceTrustScore,
        agentReadability: agentReadabilityScore,
      },
      botMatrix,
      issuesSummary,
      issues: allIssues,
      pagesScored: pageCount,
    };
  }

  private computePageScore(params: {
    isIndexable: boolean;
    statusCode: number;
    canonicalStatus: string;
    headingCounts: { h1: number };
    wordCount: number;
    answerFirstDetected: boolean;
    schemasDetected: SchemaValidationResult[];
    hasJsDomDiff: boolean;
    loadTimeMs: number;
    issuesCount: number;
  }): number {
    let score = 100;

    if (!params.isIndexable) score -= 40;
    if (params.statusCode >= 400) score -= 30;
    if (params.canonicalStatus !== "match") score -= 15;
    if (params.headingCounts.h1 !== 1) score -= 10;
    if (params.wordCount < 100) score -= 15;
    if (!params.answerFirstDetected) score -= 10;
    if (params.schemasDetected.length === 0) score -= 15;
    if (params.hasJsDomDiff) score -= 10;
    if (params.loadTimeMs > 1500) score -= 10;

    score -= Math.min(25, params.issuesCount * 4);

    return Math.max(0, Math.min(100, Math.round(score)));
  }
}
