import { expect, test, type Page } from "@playwright/test";

const projectId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const project = {
  id: projectId,
  tenantId,
  brandName: "Sample Brand",
  domain: "sample.example",
  status: "active",
  description: "",
  aliases: [],
  markets: [{ country: "US", language: "en" }],
};

async function mockWorkspace(page: Page) {
  const state = { comparisons: 0, competitorQueries: [] as string[] };
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const url = new URL(request.url());
    if (path.includes("/competitors")) {
      state.competitorQueries.push(url.searchParams.toString());
    }
    let data: unknown = {};

    if (path === "/v1/auth/me") {
      data = {
        user: {
          id: "33333333-3333-4333-8333-333333333333",
          email: "preview@example.test",
          name: "Preview User",
        },
      };
    } else if (path === "/v1/auth/csrf") {
      data = { csrfToken: "test-csrf" };
    } else if (path === "/v1/projects") {
      data = { projects: [project], nextCursor: null };
    } else if (path.endsWith("/competitors/topics")) {
      data = { topics: ["Visibility", "Research"] };
    } else if (path.endsWith("/competitors/leaderboard")) {
      data = {
        items: [
          {
            rank: 1,
            rankDelta: 0,
            entityId: projectId,
            name: "Sample Brand",
            domain: "sample.example",
            isBrand: true,
            competitorType: null,
            visibilityRate: 0.75,
            ciLow: 0.6,
            ciHigh: 0.85,
            shareOfVoice: 60,
            fairShare: 50,
            positionScore: 0.8,
            avgPosition: 1.5,
            sentimentScore: 0.8,
            citationShare: 0.6,
            headToHeadWinRate: 1,
          },
          {
            rank: 2,
            rankDelta: -1,
            entityId: "44444444-4444-4444-8444-444444444444",
            name: "ApexScale",
            domain: "apexscale.example",
            isBrand: false,
            competitorType: "direct",
            visibilityRate: 0.5,
            ciLow: 0.35,
            ciHigh: 0.65,
            shareOfVoice: 40,
            fairShare: 50,
            positionScore: 0.5,
            avgPosition: 2,
            sentimentScore: 0.7,
            citationShare: 0.4,
            headToHeadWinRate: 50,
          },
        ],
      };
    } else if (path.endsWith("/competitors/gaps")) {
      data = {
        items: [
          {
            promptId: "55555555-5555-4555-8555-555555555555",
            promptText: "Which visibility tools are best?",
            priority: 3,
            competitorId: "44444444-4444-4444-8444-444444444444",
            competitorName: "ApexScale",
            competitorVis: 0.7,
            brandVis: 0.4,
            gapScore: 6,
            promptWeight: 0.2,
            demandIndex: 50,
            reasons: ["Brand visibility trails competitor"],
            engines: ["openai"],
          },
        ],
      };
    } else if (path.endsWith("/competitors/candidates")) {
      data = { items: [] };
    } else if (
      path.endsWith(
        "/competitors/44444444-4444-4444-8444-444444444444/head-to-head",
      )
    ) {
      data = {
        competitor: {
          id: "44444444-4444-4444-8444-444444444444",
          name: "ApexScale",
          domain: "apexscale.example",
          competitorType: "direct",
        },
        summary: {
          wins: 3,
          losses: 2,
          ties: 1,
          totalPrompts: 6,
          winRate: 50,
          brandVisibilityRate: 0.7,
          competitorVisibilityRate: 0.5,
        },
        prompts: [],
      };
    } else if (path.endsWith("/competitors")) {
      data = {
        items: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            name: "ApexScale",
            domain: "apexscale.example",
            aliases: [],
            competitorType: "direct",
            discoveredVia: "manual",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metrics: {
              visibilityRate: 0.5,
              shareOfVoice: 40,
              avgPosition: 2,
              sentimentScore: 0.7,
              citationsCount: 2,
              headToHead: { wins: 3, losses: 2, ties: 1, winRate: 60 },
            },
          },
        ],
      };
    } else if (path.includes("/monitoring/")) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "UNAVAILABLE",
          detail: "Monitoring is offline",
        }),
      });
      return;
    } else if (path.endsWith("/axo/policy")) {
      data = {
        id: "policy-1",
        tenantId,
        projectId,
        policyPreset: "search_only",
        robotsTxtContent: "User-agent: *\nAllow: /",
        botRules: {},
        trainingBotsDisallowed: true,
        searchBotsAllowed: true,
        customDirectives: null,
        llmsTxtDraft: null,
        llmsFullTxtDraft: null,
        llmsValidation: {
          score: 82,
          status: "warning",
          title: "Sample",
          summary: "A sample file",
          sections: [],
          totalLinks: 8,
          internalLinksCount: 6,
          externalLinksCount: 2,
          brokenLinksCount: 1,
          byteLength: 80,
          lineCount: 10,
          issues: [
            {
              severity: "high",
              code: "INVALID_URL",
              message: "A listed URL could not be parsed.",
              line: 4,
            },
            {
              severity: "low",
              code: "MULTIPLE_H1",
              message: "A single H1 is recommended.",
              line: 8,
            },
          ],
        },
        schemaTemplates: {},
      };
    } else if (path.endsWith("/content/inventory")) {
      data = {
        items: [
          {
            id: "page-1",
            tenantId,
            projectId,
            url: "https://sample.example/guides/overview",
            path: "/guides/overview",
            title: "A sample guide",
            metaDescription: "Sample summary.",
            wordCount: 860,
            contentScore: 74,
            answerFirstScore: 19,
            entityClarityScore: 14,
            schemaScore: 7,
            structureScore: 8,
            credibilityScore: 9,
            mappedPromptIds: ["prompt-1"],
            promptClusters: ["Getting started"],
            lastModified: null,
            isStale: true,
            cannibalizedPromptIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      };
    } else if (path.endsWith("/content/gaps")) {
      data = [];
    } else if (path.endsWith("/content/briefs")) {
      data = [];
    } else if (
      path.endsWith("/content/compare") &&
      request.method() === "POST"
    ) {
      state.comparisons += 1;
      data = {
        ownedUrl: "https://sample.example/guides/overview",
        ownedScore: 74,
        competitorUrl: "https://competitor.example/guide",
        competitorScore: 78,
        structuralDifferences: [],
        missingEntities: [],
        schemaGaps: [],
        actionableSummary: "Review the compared page structure.",
      };
    } else if (path.endsWith("/actions") && request.method() === "GET") {
      data = {
        items: [
          {
            id: "action-1",
            tenantId,
            projectId,
            title: "Review the page structure",
            description: "The page may be difficult to scan.",
            category: "content",
            sourceModule: "content",
            dedupKey: "action-1",
            status: "todo",
            priorityScore: 68,
            impact: 5,
            confidence: 0.8,
            effort: "M",
            evidence: [{ url: "https://sample.example/guides/overview" }],
            fixGuidance: {
              title: "Improve page outline",
              instructions: "Review the headings and their order.",
              label: "Estimated",
              disclaimer: "Review before applying.",
            },
            verificationStatus: "pending",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        total: 1,
        stats: {
          total: 1,
          todo: 1,
          inProgress: 0,
          done: 0,
          dismissed: 0,
          backlog: 0,
          avgPriority: 68,
          byCategory: { content: 1 },
        },
      };
    } else if (path.endsWith("/comments")) {
      data = [];
    } else if (path.endsWith("/monitoring/health")) {
      data = { credits: { available: 100, reserved: 0, used: 0 } };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data }),
    });
  });
  return state;
}

test("the three intelligence sections stay readable across themes and viewport sizes", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.addInitScript(() => localStorage.setItem("savoir-theme", "light"));
  const sections = [
    {
      path: "axo",
      heading: "Agent Experience Optimization",
      nav: "Agent Experience (AXO)",
    },
    {
      path: "content",
      heading: "Content Intelligence",
      nav: "Content Intelligence",
    },
    {
      path: "actions",
      heading: "Prioritize and manage recommendations",
      nav: "Action Center",
    },
  ];

  for (const section of sections) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/${section.path}?project=${projectId}`);
    await expect(
      page.getByRole("heading", { name: section.heading }),
    ).toBeVisible();
    await expect(page.getByLabel("Select project")).toHaveValue(projectId);
    await expect(
      page.getByRole("link", { name: section.nav, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await page.screenshot({
      path: test.info().outputPath(`${section.path}-desktop-light.png`),
      fullPage: true,
    });

    await page.evaluate(() => {
      localStorage.setItem("savoir-theme", "dark");
      document.documentElement.classList.add("dark");
    });
    await page.screenshot({
      path: test.info().outputPath(`${section.path}-desktop-dark.png`),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`${section.path}-mobile-dark.png`),
      fullPage: true,
    });
    await page.evaluate(() => {
      localStorage.setItem("savoir-theme", "light");
      document.documentElement.classList.remove("dark");
    });
    await page.screenshot({
      path: test.info().outputPath(`${section.path}-mobile-light.png`),
      fullPage: true,
    });
  }

  await page.goto(`/content?project=${projectId}`);
  await expect(
    page.getByRole("heading", { name: "A sample guide" }),
  ).toBeVisible();
  await expect(page.getByLabel("Sort inventory")).toBeVisible();
  await page.getByRole("button", { name: /Compare A sample guide/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Compare content pages" }),
  ).toBeVisible();
  expect(state.comparisons).toBe(0);
  await page
    .getByLabel("Competitor page URL")
    .fill("https://competitor.example/guide");
  await page.getByRole("button", { name: "Run comparison" }).click();
  await expect(
    page.getByRole("heading", { name: "Owned vs Competitor Page Comparison" }),
  ).toBeVisible();
  expect(state.comparisons).toBe(1);

  await page.goto(`/actions?project=${projectId}`);
  await page
    .getByRole("button", {
      name: "Open recommendation: Review the page structure",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Why it matters" }),
  ).toBeVisible();
  await expect(
    page.getByText("Recommended fix", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Affected page", { exact: true })).toBeVisible();

  await page.goto(`/axo?project=${projectId}`);
  await page.getByRole("tab", { name: /LLMS.txt Validator/ }).click();
  await expect(
    page.getByText("Verified finding", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Suggestion", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Technical evidence", { exact: true }).first(),
  ).toBeVisible();
});

test("competitor intelligence filters, custom periods, and trend reports stay connected", async ({
  page,
}) => {
  const state = await mockWorkspace(page);
  await page.goto(`/competitors?project=${projectId}`);

  await expect(
    page.getByRole("heading", {
      name: "Competitor Intelligence & Gap Analysis",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Competitor Leaderboard/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Filter by topic")).toHaveValue("all");

  await page.getByLabel("Filter by topic").selectOption("Research");
  await page.getByLabel("Non-branded prompts only").check();
  await page.getByRole("button", { name: "Custom" }).click();

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  await page
    .getByLabel("Custom date range start")
    .fill(start.toISOString().slice(0, 10));
  await page
    .getByLabel("Custom date range end")
    .fill(end.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Apply dates" }).click();

  await page.getByRole("tab", { name: "Trends & Reports" }).click();
  await expect(
    page.getByRole("heading", { name: "Visibility Trends & Reports" }),
  ).toBeVisible();
  await page.getByLabel("Compare to previous period").check();

  await expect
    .poll(() =>
      state.competitorQueries.some(
        (query) =>
          query.includes("topic=Research") &&
          query.includes("nonBrandedOnly=true") &&
          query.includes("dateFrom="),
      ),
    )
    .toBe(true);
});
