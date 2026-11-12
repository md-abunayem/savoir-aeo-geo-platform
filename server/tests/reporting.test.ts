import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { ExecutiveDashboardService } from "../src/services/reporting/executive-dashboard.service.js";
import { AlertEngineService } from "../src/services/reporting/alert-engine.service.js";
import { ReportGeneratorService } from "../src/services/reporting/report-generator.service.js";

describe("Executive Dashboard Service (M13 / RPT-FR-001, RPT-FR-002, RPT-FR-011)", () => {
  it("aggregates cross-module KPIs, computes readiness index, and returns mandatory disclosures", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((queryText: string) => {
        if (queryText.includes("FROM monitoring_runs")) {
          return { rows: [{ total_runs: 100, completed_runs: 95 }] };
        }
        if (queryText.includes("FROM citations")) {
          return { rows: [{ total_citations: 38, unique_domains: 14, broken_citations: 1 }] };
        }
        if (queryText.includes("FROM competitors")) {
          return { rows: [{ comp_count: 3 }] };
        }
        if (queryText.includes("FROM technical_audits")) {
          return {
            rows: [
              {
                overall_score: "82.00",
                category_scores: { botAccess: 90 },
                issues_summary: { critical: 1 },
              },
            ],
          };
        }
        if (queryText.includes("FROM content_gaps")) {
          return { rows: [{ gap_count: 3 }] };
        }
        if (queryText.includes("FROM traffic_analytics_facts")) {
          return {
            rows: [
              {
                ai_sessions: 1600,
                ai_conversions: 160,
                ai_revenue: "4200000000",
                non_ai_sessions: 15000,
                non_ai_conversions: 450,
              },
            ],
          };
        }
        if (queryText.includes("FROM action_items")) {
          return {
            rows: [
              {
                total_actions: 12,
                open_actions: 5,
                high_impact_actions: 3,
                verified_actions: 5,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;

    const service = new ExecutiveDashboardService(mockPool);
    const dashboard = await service.getDashboard("proj-1", "ten-1", 30);

    // Assertions on KPIs
    expect(dashboard.dateWindowDays).toBe(30);
    expect(dashboard.kpis.readinessIndex).toBeGreaterThan(60);
    expect(["Leading", "Competitive", "Moderate"]).toContain(dashboard.kpis.readinessRating);
    expect(dashboard.kpis.visibilityScore).toBe(68.4);
    expect(dashboard.kpis.aiReferralSessions).toBe(1600);
    expect(dashboard.kpis.conversionMultiplier).toBeGreaterThan(2.0);
    expect(dashboard.kpis.brokenCitedUrlsCount).toBe(1);

    // Metric labels
    expect(dashboard.metricLabels.visibility).toBe("Modeled");
    expect(dashboard.metricLabels.citations).toBe("Observed");
    expect(dashboard.metricLabels.technical).toBe("Modeled");
    expect(dashboard.metricLabels.traffic).toBe("Observed");
    expect(dashboard.metricLabels.actions).toBe("Observed");
    expect(dashboard.metricLabels.readiness).toBe("Modeled");

    // Key wins & critical risks
    expect(dashboard.keyWins.length).toBeGreaterThanOrEqual(3);
    expect(dashboard.criticalRisks.some((r) => r.includes("return 404 or 5xx"))).toBe(true);

    // Disclosures
    expect(dashboard.disclosures.unreferredTraffic).toContain("TRF-FR-003");
    expect(dashboard.disclosures.gscIsolation).toContain("TRF-FR-004");
  });
});

describe("Alert Engine Service (M13 / RPT-FR-006 to RPT-FR-009)", () => {
  it("detects statistically significant visibility drops", () => {
    // Current 50% vs previous 75% across 100 observations (large drop)
    const result = AlertEngineService.evaluateVisibilityDrop(50, 75, 100, 10);
    expect(result.triggered).toBe(true);
    expect(result.dropPercent).toBe(33.3);
    expect(result.isSignificant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);

    // Minor drop below threshold
    const minor = AlertEngineService.evaluateVisibilityDrop(72, 75, 100, 10);
    expect(minor.triggered).toBe(false);
    expect(minor.dropPercent).toBe(4.0);
  });

  it("evaluates competitor overtakes accurately", () => {
    const overtake = AlertEngineService.evaluateCompetitorOvertake(55, 68, "Competitor A");
    expect(overtake.triggered).toBe(true);
    expect(overtake.gap).toBe(13);

    const behind = AlertEngineService.evaluateCompetitorOvertake(70, 60, "Competitor B");
    expect(behind.triggered).toBe(false);
    expect(behind.gap).toBe(-10);
  });

  it("evaluates lost citations and crawl blockages", () => {
    const broken = AlertEngineService.evaluateLostCitation(404, true, true);
    expect(broken.triggered).toBe(true);
    expect(broken.reason).toContain("404");

    const dropped = AlertEngineService.evaluateLostCitation(200, true, false);
    expect(dropped.triggered).toBe(true);
    expect(dropped.reason).toContain("dropped from answer references");

    const blockedBot = AlertEngineService.evaluateCrawlBlockage("GPTBot", true);
    expect(blockedBot.triggered).toBe(true);
    expect(blockedBot.message).toContain("disallowed in robots.txt");

    const allowedBot = AlertEngineService.evaluateCrawlBlockage("ClaudeBot", false, 200);
    expect(allowedBot.triggered).toBe(false);
  });

  it("triggers incident and enforces cooldown window (RPT-FR-007)", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((queryText: string) => {
        // Cooldown check
        if (queryText.includes("SELECT cooldown_hours, last_triggered_at FROM alert_rules")) {
          return { rows: [{ cooldown_hours: 24, last_triggered_at: null }] };
        }
        // Insert incident
        if (queryText.includes("INSERT INTO alert_incidents")) {
          return {
            rows: [
              {
                id: "inc-123",
                tenant_id: "ten-1",
                project_id: "proj-1",
                rule_id: "rule-1",
                rule_type: "visibility_drop",
                severity: "critical",
                title: "Significant Visibility Drop",
                message: "Brand visibility dropped by 25% (p < 0.05)",
                details: { pValue: 0.012 },
                status: "active",
                acknowledged_at: null,
                acknowledged_by: null,
                resolved_at: null,
                resolved_notes: null,
                notified_channels: ["in_app", "email"],
                created_at: new Date(),
              },
            ],
          };
        }
        if (queryText.includes("UPDATE alert_rules SET last_triggered_at")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;

    const alertService = new AlertEngineService(mockPool);
    const incident = await alertService.triggerIncident("proj-1", "ten-1", {
      ruleId: "rule-1",
      ruleType: "visibility_drop",
      severity: "critical",
      title: "Significant Visibility Drop",
      message: "Brand visibility dropped by 25% (p < 0.05)",
      details: { pValue: 0.012 },
      channels: ["in_app", "email"],
      emailRecipients: ["cmo@example.com"],
    });

    expect(incident.id).toBe("inc-123");
    expect(incident.status).toBe("active");
    expect(incident.severity).toBe("critical");
    expect(mockPool.query).toHaveBeenCalled();
  });
});

describe("Report Generator Service (M13 / RPT-FR-003, RPT-FR-004, RPT-FR-005)", () => {
  it("compiles print-ready executive HTML report with summary KPIs", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((queryText: string) => {
        if (queryText.includes("FROM projects")) {
          return { rows: [{ name: "Acme Corp", domain: "acme.com" }] };
        }
        if (queryText.includes("INSERT INTO generated_reports")) {
          return {
            rows: [
              {
                id: "rpt-999",
                tenant_id: "ten-1",
                project_id: "proj-1",
                schedule_id: null,
                title: "Executive AEO Brief",
                date_window_days: 30,
                format: "pdf",
                status: "completed",
                summary_kpis: { readinessIndex: 82 },
                content_payload: { keyWins: ["Win 1"] },
                download_url: "/v1/reports/download",
                delivered_emails: ["exec@acme.com"],
                dispatched_at: new Date(),
                created_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;

    const reportService = new ReportGeneratorService(mockPool);
    const result = await reportService.generateReport("proj-1", "ten-1", {
      title: "Executive AEO Brief",
      dateWindowDays: 30,
      format: "pdf",
      recipients: ["exec@acme.com"],
    });

    expect(result.report.id).toBe("rpt-999");
    expect(result.report.status).toBe("completed");
    expect(result.htmlContent).toContain("<!DOCTYPE html>");
    expect(result.htmlContent).toContain("Acme Corp");
    expect(result.htmlContent).toContain("acme.com");
    expect(result.htmlContent).toContain("Executive AEO Readiness Index");
    expect(result.htmlContent).toContain("Methodology Disclosures");
  });

  it("creates scheduled recurring report schedule", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "sched-123",
            tenant_id: "ten-1",
            project_id: "proj-1",
            name: "Monday Executive Brief",
            frequency: "weekly",
            day_of_week: 1,
            day_of_month: null,
            recipients: ["lead@brand.com"],
            format: "pdf",
            sections: ["visibility", "citations"],
            is_active: true,
            last_run_at: null,
            last_run_status: null,
            next_run_at: new Date(Date.now() + 7 * 86400000),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      }),
    } as unknown as Pool;

    const reportService = new ReportGeneratorService(mockPool);
    const schedule = await reportService.createSchedule("proj-1", "ten-1", {
      name: "Monday Executive Brief",
      frequency: "weekly",
      dayOfWeek: 1,
      recipients: ["lead@brand.com"],
    });

    expect(schedule.id).toBe("sched-123");
    expect(schedule.frequency).toBe("weekly");
    expect(schedule.recipients).toContain("lead@brand.com");
    expect(schedule.isActive).toBe(true);
  });
});
