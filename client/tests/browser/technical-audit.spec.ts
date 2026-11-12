import { expect, test } from "@playwright/test";

test("technical audit presents scoped crawl results at desktop and mobile sizes", async ({
  page,
}) => {
  const monitoringRequests: string[] = [];
  let issueStatus = "open";
  let scheduledFrequency: "daily" | "weekly" | "monthly" | null = null;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/v1/") && path.includes("/monitoring")) {
      monitoringRequests.push(request.url());
    }
  });

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname.endsWith("/auth/csrf")) {
      data = { csrfToken: "test-csrf-token" };
    } else if (url.pathname.endsWith("/auth/me")) {
      data = {
        user: { id: "owner", name: "Alex Morgan", email: "audit@example.test" },
      };
    } else if (url.pathname.endsWith("/technical/audits/schedule")) {
      if (route.request().method() === "PUT") {
        scheduledFrequency = route.request().postDataJSON().frequency;
      } else if (route.request().method() === "DELETE") {
        scheduledFrequency = null;
      }
      data =
        route.request().method() === "DELETE"
          ? { deleted: true }
          : scheduledFrequency
            ? {
                id: "schedule-a",
                tenantId: "tenant-a",
                projectId: "project-a",
                frequency: scheduledFrequency,
                isActive: true,
                lastRunAt: null,
                nextRunAt: "2026-11-15T10:00:00.000Z",
                createdAt: "2026-11-08T10:00:00.000Z",
                updatedAt: "2026-11-08T10:00:00.000Z",
              }
            : null;
    } else if (
      url.pathname.endsWith("/technical/audits/audit-a/issues/issue-a") &&
      route.request().method() === "PATCH"
    ) {
      issueStatus = route.request().postDataJSON().status;
      data = { id: "issue-a", status: issueStatus };
    } else if (url.pathname === "/v1/projects") {
      data = {
        projects: [
          {
            id: "project-a",
            tenantId: "tenant-a",
            tenantName: "Example workspace",
            brandName: "Example",
            domain: "example.test",
            status: "active",
          },
        ],
        nextCursor: null,
      };
    } else if (url.pathname.endsWith("/technical/audits/latest")) {
      data = {
        id: "audit-a",
        tenantId: "tenant-a",
        projectId: "project-a",
        status: "partial",
        crawlType: "full_site",
        targetDomain: "example.test",
        attemptedUrls: 4,
        fetchedPages: 2,
        failedRequests: 1,
        httpErrorPages: 1,
        excludedPages: 1,
        pagesScored: 1,
        queuedUrlsRemaining: 2,
        pagesCrawled: 2,
        pagesLimit: 500,
        scoringVersion: 3,
        completionReason:
          "Partial crawl: one request failure and one HTTP error.",
        siteWideChecks: { robotsStatus: "available" },
        overallScore: 74,
        grade: "B",
        categoryScores: {
          botAccess: 90,
          indexability: 70,
          schema: 60,
          answerStructure: 80,
          performanceTrust: null,
          agentReadability: 50,
        },
        botMatrix: {
          score: 90,
          declaredAllowedCount: 8,
          declaredPartialCount: 1,
          declaredDisallowedCount: 0,
          bots: {
            GPTBot: {
              bot: "GPTBot",
              name: "GPTBot (OpenAI)",
              status: "declared_allowed",
              score: 100,
              ruleSource:
                "robots.txt User-agent: * or default -> no matching rule for /",
              impact: "robots.txt declares no root restriction.",
            },
          },
        },
        issuesSummary: {
          critical: 0,
          high: 1,
          medium: 1,
          low: 0,
          info: 1,
          total: 3,
        },
        durationMs: 1200,
        errorMessage: null,
        startedAt: "2026-11-08T10:00:00.000Z",
        completedAt: "2026-11-08T10:00:01.200Z",
        createdAt: "2026-11-08T10:00:00.000Z",
        updatedAt: "2026-11-08T10:00:01.200Z",
      };
    } else if (url.pathname.endsWith("/technical/audits/audit-a/issues")) {
      data = [
        {
          id: "issue-a",
          pageId: "page-a",
          category: "indexability",
          severity: "info",
          findingType: "information",
          code: "UTILITY_PAGE_NOINDEX",
          title: "Intentional noindex on utility page",
          description: "Account login is not public search content.",
          recommendation: "Keep noindex for account access pages.",
          fixSnippet: null,
          affectedUrl: "https://example.test/account/login",
          status: issueStatus,
          createdAt: "2026-11-08T10:00:01.000Z",
        },
      ];
    } else if (url.pathname.endsWith("/technical/audits/audit-a/pages")) {
      data = {
        pages: [
          {
            id: "page-a",
            crawlSource: "firecrawl",
            fallbackReason: null,
            duplicateOf: null,
            url: "https://example.test/account/login",
            finalUrl: "https://example.test/account/login",
            path: "/account/login",
            statusCode: 200,
            crawlStatus: "fetched",
            fetchError: null,
            excluded: true,
            exclusionReason:
              'Utility route segment "/account" is not public search content.',
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
            loadTimeMs: 50,
            issuesCount: 1,
            createdAt: "2026-11-08T10:00:00.000Z",
          },
          {
            id: "page-b",
            crawlSource: "direct",
            fallbackReason: "FIRECRAWL_HTTP_402",
            duplicateOf: null,
            url: "https://example.test/article",
            finalUrl: null,
            path: "/article",
            statusCode: 0,
            crawlStatus: "failed",
            fetchError: "ECONNRESET",
            excluded: false,
            exclusionReason: null,
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
            loadTimeMs: 0,
            issuesCount: 1,
            createdAt: "2026-11-08T10:00:00.000Z",
          },
        ],
        total: 4,
        page: 1,
        limit: 100,
      };
    }
    await route.fulfill({ json: { success: true, data } });
  });

  await page.goto("/technical?project=project-a");
  await expect(
    page.getByRole("heading", { name: "Technical Audit", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Partial crawl: one request failure and one HTTP error."),
  ).toBeVisible();
  await expect(
    page.getByText("robots.txt declared crawl permissions"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Robots declarations" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add prompt" })).toHaveCount(0);
  await expect(page.getByText("Keep a pulse on your presence.")).toHaveCount(0);
  expect(monitoringRequests).toEqual([]);
  await page.screenshot({
    path: "test-results/technical-audit-desktop.png",
    fullPage: true,
  });

  await page.getByRole("tab", { name: "Robots declarations" }).click();
  await expect(
    page.getByRole("heading", {
      name: "robots.txt declared crawl permissions",
    }),
  ).toBeVisible();
  await expect(page.getByText(/no evidence that a bot accessed/)).toBeVisible();
  await page.getByRole("tab", { name: "Pages" }).click();
  await expect(page.getByText("ECONNRESET")).toBeVisible();
  await expect(page.getByText("Firecrawl", { exact: true })).toBeVisible();
  await expect(page.getByText("Fallback: FIRECRAWL_HTTP_402")).toBeVisible();
  await expect(page.getByText("Excluded pages", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Overview" }).click();
  await page
    .getByRole("button", { name: /Intentional noindex on utility page/ })
    .click();
  await page.getByRole("button", { name: "Mark as fixed" }).click();
  await expect(page.getByText("fixed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Schedule audits" }).click();
  await page.getByLabel("Repeat").selectOption("monthly");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(
    page.getByRole("button", { name: "Manage recurring audit" }),
  ).toBeVisible();
  expect(scheduledFrequency).toBe("monthly");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/technical-audit-mobile.png",
    fullPage: true,
  });
  expect(monitoringRequests).toEqual([]);
});
