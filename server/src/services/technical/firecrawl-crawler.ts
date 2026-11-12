import { validateDomainSecurity } from "../domain-security.service.js";

export interface CrawlerConfig {
  firecrawlApiKey?: string;
  firecrawlApiUrl?: string;
  userAgent?: string;
  maxRequestsPerSecond?: number; // default 2 req/s (TEC-FR-002)
  maxPagesPerCrawl?: number; // default 500 (TEC-FR-002)
  requestTimeoutMs?: number; // default 10000ms
  allowLocalTest?: boolean;
}

export interface CrawledPageResult {
  url: string;
  finalUrl: string | null;
  path: string;
  statusCode: number;
  headers: Record<string, string>;
  rawHtml: string;
  renderedHtml?: string;
  source?: "firecrawl" | "direct";
  fallbackReason?: string;
  loadTimeMs: number;
  discoveredLinks: string[];
  error?: string;
}

export interface CrawlDomainResult {
  pages: CrawledPageResult[];
  attemptedUrls: number;
  queuedUrlsRemaining: number;
}

class CrawlFetchError extends Error {
  constructor(
    message: string,
    readonly finalUrl: string | null,
  ) {
    super(message);
  }
}

export class FirecrawlCrawler {
  private userAgent: string;
  private minIntervalMs: number;
  private maxPages: number;
  private timeoutMs: number;
  private lastRequestTimeByHost = new Map<string, number>();

  constructor(private config: CrawlerConfig = {}) {
    this.userAgent = config.userAgent || "Savoir-Bot/1.0 (+https://savoir.io/bot)";
    const rps = config.maxRequestsPerSecond || 2;
    this.minIntervalMs = Math.ceil(1000 / rps); // 500ms for 2 req/s
    this.maxPages = config.maxPagesPerCrawl || 500;
    this.timeoutMs = config.requestTimeoutMs || 10000;
  }

  /**
   * Enforce politeness delay for host (max 2 req/s / crawl-delay)
   */
  private async enforcePoliteness(
    hostname: string,
    customCrawlDelaySeconds?: number,
  ): Promise<void> {
    const minDelay = customCrawlDelaySeconds
      ? Math.max(this.minIntervalMs, customCrawlDelaySeconds * 1000)
      : this.minIntervalMs;

    const lastTime = this.lastRequestTimeByHost.get(hostname) || 0;
    const elapsed = Date.now() - lastTime;

    if (elapsed < minDelay) {
      const waitTime = minDelay - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTimeByHost.set(hostname, Date.now());
  }

  private async fetchPublicUrl(
    url: URL,
    init: RequestInit,
    timeoutMs = this.timeoutMs,
  ): Promise<{ response: Response; finalUrl: string }> {
    let current = new URL(url.href);
    for (let redirects = 0; ; redirects++) {
      if (!this.config.allowLocalTest) {
        try {
          await validateDomainSecurity(current.hostname);
        } catch (error) {
          throw new CrawlFetchError(
            error instanceof Error ? error.message : "Restricted domain",
            redirects === 0 ? null : current.href,
          );
        }
      }

      let response: Response;
      try {
        response = await fetch(current.href, {
          ...init,
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new CrawlFetchError(
          error instanceof Error ? error.message : "FETCH_ERROR",
          redirects === 0 ? null : current.href,
        );
      }

      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        return { response, finalUrl: current.href };
      }
      if (redirects >= 5) {
        throw new CrawlFetchError("Too many redirects", current.href);
      }

      const next = new URL(location, current);
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new CrawlFetchError("Redirected to a non-HTTP URL", current.href);
      }
      await response.body?.cancel();
      await this.enforcePoliteness(next.hostname);
      current = next;
    }
  }

  /**
   * Crawl a single page with SSRF protection, politeness delay, and timing
   */
  async crawlPage(urlStr: string, customCrawlDelaySeconds?: number): Promise<CrawledPageResult> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      return {
        url: urlStr,
        finalUrl: null,
        path: "/",
        statusCode: 0,
        headers: {},
        rawHtml: "",
        loadTimeMs: 0,
        discoveredLinks: [],
        error: "INVALID_URL",
      };
    }

    // Validate before sending a URL to a crawl provider.
    if (!this.config.allowLocalTest) {
      try {
        await validateDomainSecurity(parsedUrl.hostname);
      } catch (err) {
        return {
          url: urlStr,
          finalUrl: null,
          path: parsedUrl.pathname,
          statusCode: 0,
          headers: {},
          rawHtml: "",
          loadTimeMs: 0,
          discoveredLinks: [],
          error: `BLOCKED_SSRF: ${err instanceof Error ? err.message : "Restricted domain"}`,
        };
      }
    }

    // Enforce politeness (max 2 req/s)
    await this.enforcePoliteness(parsedUrl.hostname, customCrawlDelaySeconds);

    const startTime = Date.now();
    let fallbackReason: string | undefined;

    // If Firecrawl API is available and configured, query Firecrawl scrape for JS rendering
    if (this.config.firecrawlApiKey) {
      try {
        const firecrawlRes = await this.scrapeViaFirecrawl(urlStr);
        if (firecrawlRes) {
          const finalUrl = firecrawlRes.finalUrl || urlStr;
          const finalParsedUrl = new URL(finalUrl);
          if (!this.config.allowLocalTest) {
            await validateDomainSecurity(finalParsedUrl.hostname);
          }
          const loadTimeMs = Date.now() - startTime;
          return {
            url: urlStr,
            finalUrl,
            path: finalParsedUrl.pathname,
            statusCode: firecrawlRes.statusCode,
            headers: firecrawlRes.headers,
            rawHtml: firecrawlRes.rawHtml,
            renderedHtml: firecrawlRes.renderedHtml,
            source: "firecrawl",
            loadTimeMs,
            discoveredLinks: this.extractLinks(
              firecrawlRes.renderedHtml || firecrawlRes.rawHtml,
              finalUrl,
            ),
          };
        }
      } catch (error) {
        fallbackReason =
          error instanceof Error && /^FIRECRAWL_[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : error instanceof Error && error.name === "AbortError"
              ? "FIRECRAWL_TIMEOUT"
              : "FIRECRAWL_REQUEST_FAILED";
        // Fall back to the public direct-fetch path if provider rendering fails.
      }
    }

    // Direct Polite HTTP Fetch
    const directStartTime = Date.now();
    let finalUrl: string | null = null;
    let statusCode = 0;
    try {
      const { response, finalUrl: fetchedUrl } = await this.fetchPublicUrl(parsedUrl, {
        method: "GET",
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });
      finalUrl = fetchedUrl;
      statusCode = response.status;

      const headers: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        headers[key.toLowerCase()] = val;
      });

      const rawHtml = await response.text();
      const loadTimeMs = Date.now() - directStartTime;

      const discoveredLinks = this.extractLinks(rawHtml, fetchedUrl);

      return {
        url: urlStr,
        finalUrl: fetchedUrl,
        path: new URL(fetchedUrl).pathname,
        statusCode,
        headers,
        rawHtml,
        source: "direct",
        fallbackReason,
        loadTimeMs,
        discoveredLinks,
      };
    } catch (err) {
      const loadTimeMs = Date.now() - startTime;
      return {
        url: urlStr,
        finalUrl: err instanceof CrawlFetchError ? err.finalUrl : finalUrl,
        path: finalUrl ? new URL(finalUrl).pathname : parsedUrl.pathname,
        statusCode,
        headers: {},
        rawHtml: "",
        loadTimeMs,
        discoveredLinks: [],
        error: err instanceof Error ? err.message : "FETCH_ERROR",
        source: "direct",
        fallbackReason,
      };
    }
  }

  /**
   * Scrape via Firecrawl API (providing JS-rendered HTML and metadata)
   */
  private async scrapeViaFirecrawl(url: string): Promise<{
    statusCode: number;
    finalUrl: string | null;
    headers: Record<string, string>;
    rawHtml: string;
    renderedHtml?: string;
  } | null> {
    const apiUrl = (this.config.firecrawlApiUrl || "https://api.firecrawl.dev").replace(/\/$/, "");
    const endpoint = `${apiUrl}/v1/scrape`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.firecrawlApiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ["html", "rawHtml"],
          waitFor: 1000,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`FIRECRAWL_HTTP_${response.status}`);
    }

    const data = (await response.json()) as {
      success?: boolean;
      data?: {
        html?: string;
        rawHtml?: string;
        metadata?: { statusCode?: number; url?: string };
      };
    };

    if (!data?.success || !data.data || !(data.data.html || data.data.rawHtml))
      throw new Error("FIRECRAWL_EMPTY_RESPONSE");

    return {
      statusCode: data.data.metadata?.statusCode || 200,
      finalUrl: data.data.metadata?.url || url,
      headers: {},
      rawHtml: data.data.rawHtml || data.data.html || "",
      renderedHtml: data.data.html,
    };
  }

  /**
   * Fetch site-wide metadata (robots.txt, llms.txt, sitemap references)
   */
  async fetchSiteWideFiles(targetDomain: string): Promise<{
    robotsTxt: string;
    robotsStatus: "available" | "missing" | "inaccessible" | "failed";
    robotsHttpStatus: number | null;
    robotsError: string | null;
    hasLlmsTxt: boolean | null;
    llmsStatus: "available" | "missing" | "inaccessible" | "failed";
    llmsTxtContent: string;
    hasSitemap: boolean | null;
    sitemapStatus: "declared" | "found" | "missing" | "inaccessible" | "failed";
    sitemapUrls: string[];
    crawlDelaySeconds?: number;
  }> {
    const cleanDomain = targetDomain
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
    const baseUrl = `https://${cleanDomain}`;

    let robotsTxt = "";
    let robotsStatus: "available" | "missing" | "inaccessible" | "failed" = "failed";
    let robotsHttpStatus: number | null = null;
    let robotsError: string | null = null;
    let crawlDelaySeconds: number | undefined;
    const sitemapUrls: string[] = [];

    // 1. Fetch robots.txt
    try {
      const { response: robotsRes } = await this.fetchPublicUrl(
        new URL(`${baseUrl}/robots.txt`),
        {
          headers: { "User-Agent": this.userAgent },
        },
        5000,
      );
      robotsHttpStatus = robotsRes.status;
      if (robotsRes.ok) {
        robotsStatus = "available";
        robotsTxt = await robotsRes.text();

        // Extract crawl-delay if present
        const delayMatch = robotsTxt.match(/Crawl-delay:\s*(\d+(?:\.\d+)?)/i);
        if (delayMatch && delayMatch[1]) {
          crawlDelaySeconds = parseFloat(delayMatch[1]);
        }

        // Extract sitemaps referenced in robots.txt
        const sitemapMatches = robotsTxt.matchAll(/Sitemap:\s*(https?:\/\/[^\s\r\n]+)/gi);
        for (const m of sitemapMatches) {
          if (m[1]) sitemapUrls.push(m[1].trim());
        }
      } else if (robotsRes.status === 404) {
        robotsStatus = "missing";
      } else if (robotsRes.status === 401 || robotsRes.status === 403) {
        robotsStatus = "inaccessible";
      } else {
        robotsStatus = "failed";
        robotsError = `robots.txt returned HTTP ${robotsRes.status}`;
      }
    } catch (error) {
      robotsError = error instanceof Error ? error.message : "robots.txt request failed";
    }

    // 2. Fetch /llms.txt
    let hasLlmsTxt: boolean | null = null;
    let llmsStatus: "available" | "missing" | "inaccessible" | "failed" = "failed";
    let llmsTxtContent = "";
    try {
      const { response: llmsRes } = await this.fetchPublicUrl(
        new URL(`${baseUrl}/llms.txt`),
        {
          headers: { "User-Agent": this.userAgent },
        },
        5000,
      );
      if (llmsRes.ok) {
        hasLlmsTxt = true;
        llmsStatus = "available";
        llmsTxtContent = await llmsRes.text();
      } else if (llmsRes.status === 404) {
        hasLlmsTxt = false;
        llmsStatus = "missing";
      } else if (llmsRes.status === 401 || llmsRes.status === 403) {
        llmsStatus = "inaccessible";
      } else {
        llmsStatus = "failed";
      }
    } catch {
      hasLlmsTxt = null;
      llmsTxtContent = "";
    }

    let sitemapStatus: "declared" | "found" | "missing" | "inaccessible" | "failed" = "failed";
    let hasSitemap: boolean | null = null;
    // A sitemap declaration is evidence of a published URL, not proof it is reachable.
    if (sitemapUrls.length === 0) {
      try {
        const { response: sitemapRes } = await this.fetchPublicUrl(
          new URL(`${baseUrl}/sitemap.xml`),
          {
            method: "HEAD",
            headers: { "User-Agent": this.userAgent },
          },
          4000,
        );
        if (sitemapRes.ok) {
          sitemapUrls.push(`${baseUrl}/sitemap.xml`);
          sitemapStatus = "found";
          hasSitemap = true;
        } else if (sitemapRes.status === 404) {
          sitemapStatus = "missing";
          hasSitemap = false;
        } else if (sitemapRes.status === 401 || sitemapRes.status === 403) {
          sitemapStatus = "inaccessible";
        } else {
          sitemapStatus = "failed";
        }
      } catch {
        // A failed request is unknown, not evidence that the sitemap is missing.
      }
    } else {
      sitemapStatus = "declared";
      hasSitemap = true;
    }

    return {
      robotsTxt,
      robotsStatus,
      robotsHttpStatus,
      robotsError,
      hasLlmsTxt,
      llmsStatus,
      llmsTxtContent,
      hasSitemap,
      sitemapStatus,
      sitemapUrls,
      crawlDelaySeconds,
    };
  }

  /**
   * Discover and crawl up to maxPages on targetDomain
   */
  async crawlDomain(
    targetDomain: string,
    options: {
      crawlType?: "single_page" | "key_pages" | "full_site";
      pageLimit?: number;
      customCrawlDelaySeconds?: number;
      onPageCrawled?: (page: CrawledPageResult, index: number, total: number) => void;
    } = {},
  ): Promise<CrawledPageResult[]> {
    return (await this.crawlDomainWithStats(targetDomain, options)).pages;
  }

  async crawlDomainWithStats(
    targetDomain: string,
    options: {
      crawlType?: "single_page" | "key_pages" | "full_site";
      pageLimit?: number;
      customCrawlDelaySeconds?: number;
      onPageCrawled?: (page: CrawledPageResult, index: number, total: number) => void;
    } = {},
  ): Promise<CrawlDomainResult> {
    const cleanDomain = targetDomain
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
    const startUrl = `https://${cleanDomain}`;
    const cleanHost = new URL(startUrl).hostname.toLowerCase();
    const withoutWww = cleanHost.replace(/^www\./, "");
    const allowedHosts = new Set([withoutWww, `www.${withoutWww}`]);
    const limit = Math.min(options.pageLimit || this.maxPages, this.maxPages);

    const visited = new Set<string>();
    const queue: string[] = [startUrl];
    const results: CrawledPageResult[] = [];

    // If single_page crawl, only crawl root
    if (options.crawlType === "single_page") {
      const page = await this.crawlPage(startUrl, options.customCrawlDelaySeconds);
      results.push(page);
      options.onPageCrawled?.(page, 1, 1);
      return {
        pages: results,
        attemptedUrls: results.length,
        queuedUrlsRemaining: 0,
      };
    }

    while (queue.length > 0 && results.length < limit) {
      const currentUrl = queue.shift()!;
      const normalizedUrl = this.normalizeUrl(currentUrl);

      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);

      const page = await this.crawlPage(currentUrl, options.customCrawlDelaySeconds);
      results.push(page);
      options.onPageCrawled?.(page, results.length, limit);
      if (!page.error && page.statusCode >= 200 && page.statusCode < 300 && page.finalUrl)
        visited.add(this.normalizeUrl(page.finalUrl));

      // Retain remaining discovered URLs when the page limit is reached so completion is explicit.
      for (const link of page.discoveredLinks) {
        const normLink = this.normalizeUrl(link);
        try {
          const parsed = new URL(normLink);
          if (allowedHosts.has(parsed.hostname.toLowerCase())) {
            if (!visited.has(normLink) && !queue.includes(normLink)) {
              queue.push(normLink);
            }
          }
        } catch {
          // Ignore malformed links.
        }
      }
    }

    return {
      pages: results,
      attemptedUrls: results.length,
      queuedUrlsRemaining: queue.filter((url) => !visited.has(this.normalizeUrl(url))).length,
    };
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const links: string[] = [];
    const hrefMatches = html.matchAll(/<a\s+[^>]*href=["']([^"'#\s>]+)["']/gi);

    for (const match of hrefMatches) {
      const rawHref = match[1]?.trim();
      if (!rawHref) continue;
      if (
        rawHref.startsWith("mailto:") ||
        rawHref.startsWith("tel:") ||
        rawHref.startsWith("javascript:")
      ) {
        continue;
      }

      try {
        const resolved = new URL(rawHref, baseUrl);
        if (resolved.protocol === "http:" || resolved.protocol === "https:") {
          links.push(resolved.href);
        }
      } catch {
        // ignore invalid URL
      }
    }

    return Array.from(new Set(links));
  }

  private normalizeUrl(urlStr: string): string {
    try {
      const u = new URL(urlStr);
      u.hash = "";
      // remove common tracking query params
      u.searchParams.delete("utm_source");
      u.searchParams.delete("utm_medium");
      u.searchParams.delete("utm_campaign");
      u.searchParams.delete("utm_term");
      u.searchParams.delete("utm_content");
      u.searchParams.delete("ref");
      return u.href.replace(/\/$/, "");
    } catch {
      return urlStr;
    }
  }
}
