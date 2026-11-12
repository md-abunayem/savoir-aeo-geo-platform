// Citation Extraction and Classification Service (ANS & M5 & CIT)
// Complies with ANS-FR-001..003, CIT-FR-001, CIT-FR-002, NFR-QUAL-002

export type SourceType =
  | "brand"
  | "competitor"
  | "news_media"
  | "review_comparison"
  | "forum_ugc"
  | "social"
  | "encyclopedia"
  | "government_education"
  | "marketplace"
  | "documentation_blog"
  | "other";

export interface ExtractedCitation {
  url: string;
  normalizedUrl: string;
  domain: string;
  sourceType: SourceType;
  anchorText?: string;
  orderIndex: number;
}

export interface CitationContext {
  brandDomain?: string;
  brandAliases?: string[];
  competitorDomains?: string[];
}

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_source_platform",
  "utm_creative_format",
  "utm_marketing_tactic",
  "gclid",
  "gclsrc",
  "dclid",
  "wbraid",
  "gbraid",
  "fbclid",
  "msclkid",
  "ref",
  "referrer",
  "ref_src",
  "source",
  "mc_cid",
  "mc_eid",
  "igshid",
  "_hsenc",
  "_hsmi",
  "hsctatracking",
  "mkt_tok",
]);

const REVIEW_DOMAINS = new Set([
  "g2.com",
  "capterra.com",
  "trustpilot.com",
  "trustradius.com",
  "softwareadvice.com",
  "getapp.com",
  "yelp.com",
  "tripadvisor.com",
  "consumerreports.org",
  "wirecutter.com",
  "slant.co",
  "producthunt.com",
  "crozdesk.com",
  "saasworthy.com",
  "financesonline.com",
]);

const FORUM_UGC_DOMAINS = new Set([
  "reddit.com",
  "quora.com",
  "stackoverflow.com",
  "stackexchange.com",
  "news.ycombinator.com",
  "medium.com",
  "substack.com",
  "discourse.org",
  "dev.to",
  "hashnode.dev",
]);

const SOCIAL_DOMAINS = new Set([
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "pinterest.com",
  "threads.net",
  "mastodon.social",
]);

const ENCYCLOPEDIA_DOMAINS = new Set([
  "wikipedia.org",
  "wikimedia.org",
  "britannica.com",
  "investopedia.com",
  "wiktionary.org",
  "wikihow.com",
]);

const MARKETPLACE_DOMAINS = new Set([
  "amazon.com",
  "ebay.com",
  "walmart.com",
  "target.com",
  "etsy.com",
  "aliexpress.com",
  "appsumo.com",
  "shopify.com",
  "bestbuy.com",
]);

const NEWS_MEDIA_DOMAINS = new Set([
  "nytimes.com",
  "wsj.com",
  "forbes.com",
  "bloomberg.com",
  "reuters.com",
  "techcrunch.com",
  "theverge.com",
  "wired.com",
  "bbc.com",
  "bbc.co.uk",
  "cnn.com",
  "theguardian.com",
  "cnbc.com",
  "venturebeat.com",
  "zdnet.com",
  "arstechnica.com",
  "businessinsider.com",
  "huffpost.com",
  "apnews.com",
  "axios.com",
]);

/**
 * Strips tracking parameters, lowercases host, standardizes ports and trailing slashes.
 */
export function normalizeUrl(rawUrl: string): { normalizedUrl: string; domain: string } | null {
  try {
    let clean = rawUrl.trim();
    // Reject other protocols like ftp://, javascript:, mailto:
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean) && !/^https?:\/\//i.test(clean)) {
      return null;
    }
    if (!/^https?:\/\//i.test(clean)) {
      clean = "https://" + clean;
    }

    const parsed = new URL(clean);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    // Lowercase host and strip www.
    const domain = parsed.hostname.toLowerCase().replace(/^www\./i, "");
    parsed.hostname = domain;

    // Remove default ports
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }

    // Strip tracking query parameters
    const keysToDelete: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      parsed.searchParams.delete(key);
    }

    // Sort remaining query params for canonical consistency
    parsed.searchParams.sort();

    // Strip hash fragment unless needed
    parsed.hash = "";

    // Normalize path
    let pathname = parsed.pathname.replace(/\/+/g, "/");
    if (pathname === "/") {
      pathname = "";
    } else if (pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    let normalizedUrl = parsed.toString();
    if (normalizedUrl.endsWith("/")) {
      normalizedUrl = normalizedUrl.slice(0, -1);
    }

    return { normalizedUrl, domain };
  } catch {
    return null;
  }
}

/**
 * Checks if a domain matches or is a subdomain of a target base domain.
 */
function isDomainMatch(targetDomain: string, candidateDomain: string): boolean {
  const normTarget = targetDomain
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "");
  const normCandidate = candidateDomain.toLowerCase().replace(/^www\./i, "");

  return normCandidate === normTarget || normCandidate.endsWith("." + normTarget);
}

/**
 * Classifies a domain into one of the 11 defined source types.
 */
export function classifySourceType(domain: string, context?: CitationContext): SourceType {
  const normDomain = domain.toLowerCase().replace(/^www\./i, "");

  // 1. Brand match
  if (context?.brandDomain && isDomainMatch(context.brandDomain, normDomain)) {
    return "brand";
  }
  if (context?.brandAliases) {
    for (const alias of context.brandAliases) {
      if (alias.includes(".") && isDomainMatch(alias, normDomain)) {
        return "brand";
      }
    }
  }

  // 2. Competitor match
  if (context?.competitorDomains) {
    for (const compDomain of context.competitorDomains) {
      if (isDomainMatch(compDomain, normDomain)) {
        return "competitor";
      }
    }
  }

  // 3. Government / Education
  if (
    normDomain.endsWith(".gov") ||
    normDomain.endsWith(".mil") ||
    normDomain.endsWith(".edu") ||
    normDomain.endsWith(".ac.uk") ||
    normDomain === "who.int" ||
    normDomain === "un.org" ||
    normDomain === "europa.eu"
  ) {
    return "government_education";
  }

  // 4. Encyclopedia
  for (const d of ENCYCLOPEDIA_DOMAINS) {
    if (isDomainMatch(d, normDomain)) return "encyclopedia";
  }

  // 5. Review & Comparison
  for (const d of REVIEW_DOMAINS) {
    if (isDomainMatch(d, normDomain)) return "review_comparison";
  }

  // 6. Forum & UGC
  for (const d of FORUM_UGC_DOMAINS) {
    if (isDomainMatch(d, normDomain)) return "forum_ugc";
  }

  // 7. Social Media
  for (const d of SOCIAL_DOMAINS) {
    if (isDomainMatch(d, normDomain)) return "social";
  }

  // 8. Marketplace
  for (const d of MARKETPLACE_DOMAINS) {
    if (isDomainMatch(d, normDomain)) return "marketplace";
  }

  // 9. News Media
  for (const d of NEWS_MEDIA_DOMAINS) {
    if (isDomainMatch(d, normDomain)) return "news_media";
  }

  // 10. Documentation & Blog
  if (
    normDomain === "github.com" ||
    normDomain === "gitlab.com" ||
    normDomain === "developer.mozilla.org" ||
    normDomain === "w3schools.com" ||
    normDomain.startsWith("docs.") ||
    normDomain.startsWith("developer.") ||
    normDomain.startsWith("api.") ||
    normDomain.startsWith("blog.")
  ) {
    return "documentation_blog";
  }

  // 11. Other
  return "other";
}

/**
 * Extracts citations from:
 * 1) Explicit provider citations array [{ url, title }]
 * 2) Markdown links in text [title](url)
 * 3) Plain URLs in text https://...
 * Normalizes each URL and classifies by domain source type.
 */
export function extractCitations(
  text: string,
  providerCitations: { url: string; title?: string }[] = [],
  context?: CitationContext,
): ExtractedCitation[] {
  const seenUrls = new Set<string>();
  const results: ExtractedCitation[] = [];
  let orderIndex = 1;

  const tryAdd = (rawUrl: string, anchorText?: string) => {
    const norm = normalizeUrl(rawUrl);
    if (!norm) return;

    if (seenUrls.has(norm.normalizedUrl)) return;
    seenUrls.add(norm.normalizedUrl);

    const sourceType = classifySourceType(norm.domain, context);

    results.push({
      url: rawUrl.trim(),
      normalizedUrl: norm.normalizedUrl,
      domain: norm.domain,
      sourceType,
      anchorText: anchorText?.trim() || undefined,
      orderIndex: orderIndex++,
    });
  };

  // 1. Process explicit provider citations first
  for (const item of providerCitations) {
    if (item?.url) {
      tryAdd(item.url, item.title);
    }
  }

  // 2. Extract markdown links: [anchor](url)
  const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let mdMatch: RegExpExecArray | null;
  while ((mdMatch = mdLinkRegex.exec(text)) !== null) {
    tryAdd(mdMatch[2], mdMatch[1]);
  }

  // 3. Extract plain URLs: https://...
  const urlRegex = /(?<!\()(https?:\/\/[^\s)\],<>"']+)/g;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(text)) !== null) {
    tryAdd(urlMatch[1]);
  }

  return results;
}
