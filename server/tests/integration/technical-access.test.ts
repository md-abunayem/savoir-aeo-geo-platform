import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { FirecrawlCrawler } from "../../src/services/technical/firecrawl-crawler.js";
import { createDatabaseFixture } from "./database-fixture.js";
import { TechnicalAuditService } from "../../src/services/technical/technical-audit.service.js";
let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
const owner = randomUUID(),
  outsider = randomUUID(),
  tenant = randomUUID(),
  project = randomUUID();
let auditId: string;
beforeAll(async () => {
  f = await createDatabaseFixture();
  await f.database.query(
    "INSERT INTO users(id,email,name) VALUES($1,'audit-owner@test.invalid','Owner'),($2,'audit-other@test.invalid','Other')",
    [owner, outsider],
  );
  await f.database.query("INSERT INTO tenants(id,name) VALUES($1,'Audit tenant')", [tenant]);
  await f.database.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [
    tenant,
    owner,
  ]);
  await f.database.query(
    "INSERT INTO projects(id,tenant_id,brand_name,domain,status) VALUES($1,$2,'Nike','nike.com','active')",
    [project, tenant],
  );
  const inserted = await f.database.query(
    "INSERT INTO technical_audits(tenant_id,project_id,status,crawl_type,target_domain,pages_limit) VALUES($1,$2,'completed','single_page','nike.com',1) RETURNING id",
    [tenant, project],
  );
  auditId = inserted.rows[0].id;
  await f.database.query(
    `INSERT INTO technical_audit_pages(
      audit_id,tenant_id,project_id,url,path,status_code,is_indexable,page_score
    ) VALUES($1,$2,$3,'https://nike.com/','/',200,true,90)`,
    [auditId, tenant, project],
  );
  await f.database.query(
    `INSERT INTO technical_audit_issues(
      audit_id,tenant_id,project_id,category,severity,code,title,description,recommendation
    ) VALUES($1,$2,$3,'schema','medium','TEST_ISSUE','Test issue','Fixture evidence','Fixture recommendation')`,
    [auditId, tenant, project],
  );
}, 180000);
afterAll(async () => {
  await f?.close();
}, 60000);
it("lets an authenticated owner read audits and rejects another account", async () => {
  const service = new TechnicalAuditService(f.runtime);
  const ownerService = service.forOwner({ userId: owner, tenantId: tenant });
  const outsiderService = service.forOwner({ userId: outsider, tenantId: tenant });
  expect((await ownerService.getLatestAudit(tenant, project))?.targetDomain).toBe("nike.com");
  expect((await ownerService.getAuditPages(tenant, project, auditId)).total).toBe(1);
  const issues = await ownerService.getAuditIssues(tenant, project, auditId);
  expect(issues).toHaveLength(1);
  expect(issues[0]?.findingType).toBe("suggestion");
  expect(
    await ownerService.getAuditIssues(tenant, project, auditId, {
      findingType: "suggestion",
    }),
  ).toHaveLength(1);
  expect(
    await ownerService.getAuditIssues(tenant, project, auditId, {
      findingType: "problem",
    }),
  ).toHaveLength(0);
  expect(await ownerService.exportAuditCsv(tenant, project, auditId, "pages")).toContain(
    "https://nike.com/",
  );
  const issuesCsv = await ownerService.exportAuditCsv(tenant, project, auditId, "issues", {
    findingType: "suggestion",
  });
  expect(issuesCsv).toContain("Finding Type,Severity");
  expect(issuesCsv).toContain("suggestion,medium");
  expect(issuesCsv).toContain("Test issue");
  expect(issues[0]?.status).toBe("open");
  await ownerService.updateIssueStatus(tenant, project, auditId, issues[0]!.id, "fixed");
  expect((await ownerService.getAuditIssues(tenant, project, auditId))[0]?.status).toBe("fixed");
  const schedule = await ownerService.saveSchedule(tenant, project, owner, "weekly");
  expect(schedule).toMatchObject({
    tenantId: tenant,
    projectId: project,
    frequency: "weekly",
    isActive: true,
  });
  expect((await ownerService.getSchedule(tenant, project))?.id).toBe(schedule.id);
  await ownerService.deleteSchedule(tenant, project);
  expect(await ownerService.getSchedule(tenant, project)).toBeNull();
  await expect(
    outsiderService.updateIssueStatus(tenant, project, auditId, issues[0]!.id, "dismissed"),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    outsiderService.saveSchedule(tenant, project, outsider, "daily"),
  ).rejects.toMatchObject({
    statusCode: 404,
  });
  expect(
    await ownerService.exportAuditCsv(tenant, project, auditId, "issues", {
      findingType: "problem",
    }),
  ).not.toContain("Test issue");

  await expect(outsiderService.getLatestAudit(tenant, project)).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(outsiderService.getAuditPages(tenant, project, auditId)).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(outsiderService.getAuditIssues(tenant, project, auditId)).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(
    outsiderService.exportAuditCsv(tenant, project, auditId, "pages"),
  ).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(
    outsiderService.exportAuditCsv(tenant, project, auditId, "issues"),
  ).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(outsiderService.triggerAudit(tenant, project)).rejects.toMatchObject({
    statusCode: 404,
  });
  expect((await f.runtime.query("SELECT * FROM technical_audits")).rows).toHaveLength(0);
});

it("scores final URLs once and exports crawler provenance without provider latency warnings", async () => {
  const inserted = await f.database.query(
    "INSERT INTO technical_audits(tenant_id,project_id,status,crawl_type,target_domain,pages_limit) VALUES($1,$2,'running','full_site','nike.com',10) RETURNING id",
    [tenant, project],
  );
  const id = inserted.rows[0].id;
  const site = vi.spyOn(FirecrawlCrawler.prototype, "fetchSiteWideFiles").mockResolvedValue({
    robotsTxt: "User-agent: *\nAllow: /",
    robotsStatus: "available",
    robotsHttpStatus: 200,
    robotsError: null,
    hasLlmsTxt: false,
    llmsStatus: "missing",
    llmsTxtContent: "",
    hasSitemap: true,
    sitemapStatus: "found",
    sitemapUrls: [],
  });
  const page = {
    finalUrl: "https://www.nike.com/",
    path: "/",
    statusCode: 200,
    headers: {},
    rawHtml:
      '<html><head><link rel="canonical" href="https://www.nike.com/"></head><body><h1>Nike</h1><p>Sports shoes.</p></body></html>',
    loadTimeMs: 9000,
    discoveredLinks: [],
    source: "firecrawl" as const,
  };
  const crawl = vi.spyOn(FirecrawlCrawler.prototype, "crawlDomainWithStats").mockResolvedValue({
    attemptedUrls: 2,
    queuedUrlsRemaining: 0,
    pages: [
      { ...page, url: "https://nike.com/" },
      { ...page, url: "https://www.nike.com/" },
    ],
  });
  try {
    const service = new TechnicalAuditService(f.runtime).forOwner({
      userId: owner,
      tenantId: tenant,
    });
    await service.executeAudit(id, tenant, project, "nike.com", "full_site", 10);
    const audit = await service.getAuditById(tenant, project, id);
    expect(audit).toMatchObject({
      status: "completed",
      scoringVersion: 3,
      pagesScored: 1,
      excludedPages: 1,
    });
    expect(audit.categoryScores.performanceTrust).toBeNull();
    const result = await service.getAuditPages(tenant, project, id);
    expect(result.pages.filter((p) => p.duplicateOf)).toHaveLength(1);
    expect(result.pages.every((p) => p.crawlSource === "firecrawl")).toBe(true);
    const issues = await service.getAuditIssues(tenant, project, id);
    expect(issues.some((i) => i.code === "HIGH_RESPONSE_TIME")).toBe(false);
    const csv = await service.exportAuditCsv(tenant, project, id, "pages");
    expect(csv).toContain("Crawler,Fallback Reason,Duplicate Of");
    expect(csv).toContain("firecrawl");
    expect(csv).toContain("Duplicate of https://www.nike.com/");
  } finally {
    site.mockRestore();
    crawl.mockRestore();
  }
});
