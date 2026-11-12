/**
 * Scheduled & On-Demand Report Generator Service (M13 / RPT-FR-003, RPT-FR-004, RPT-FR-005, RPT-FR-010)
 * Generates executive PDF/HTML reports and orchestrates Brevo email delivery.
 */

import type { Pool } from "pg";
import { ApiError } from "../../utils/ApiError.js";
import {
  ExecutiveDashboardService,
  type ExecutiveDashboardData,
} from "./executive-dashboard.service.js";
import { createEmailOutbox } from "../email/outbox.service.js";

export interface ReportScheduleRecord {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  frequency: "weekly" | "monthly";
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  recipients: string[];
  format: "pdf" | "html" | "csv";
  sections: string[];
  isActive: boolean;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedReportRecord {
  id: string;
  tenantId: string;
  projectId: string;
  scheduleId?: string | null;
  title: string;
  dateWindowDays: number;
  format: "pdf" | "html" | "json";
  status: "generating" | "completed" | "failed";
  summaryKpis: Record<string, unknown>;
  contentPayload: Record<string, unknown>;
  downloadUrl?: string | null;
  deliveredEmails: string[];
  dispatchedAt?: string | null;
  createdAt: string;
}

export class ReportGeneratorService {
  private dashboardService: ExecutiveDashboardService;

  constructor(
    private pool: Pool,
    private encryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ) {
    this.dashboardService = new ExecutiveDashboardService(pool);
  }

  /**
   * List report schedules
   */
  async listSchedules(projectId: string, tenantId: string): Promise<ReportScheduleRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM report_schedules
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC`,
      [projectId, tenantId],
    );
    return res.rows.map(this.mapScheduleRow);
  }

  /**
   * Create report schedule (RPT-FR-003)
   */
  async createSchedule(
    projectId: string,
    tenantId: string,
    payload: {
      name: string;
      frequency: "weekly" | "monthly";
      dayOfWeek?: number;
      dayOfMonth?: number;
      recipients: string[];
      format?: "pdf" | "html" | "csv";
      sections?: string[];
    },
  ): Promise<ReportScheduleRecord> {
    const nextRun = this.calculateNextRun(payload.frequency, payload.dayOfWeek, payload.dayOfMonth);

    const res = await this.pool.query(
      `INSERT INTO report_schedules (
        project_id, tenant_id, name, frequency, day_of_week, day_of_month,
        recipients, format, sections, is_active, next_run_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
      RETURNING *`,
      [
        projectId,
        tenantId,
        payload.name,
        payload.frequency,
        payload.dayOfWeek ?? 1, // Default Monday
        payload.dayOfMonth ?? 1, // Default 1st
        JSON.stringify(payload.recipients || []),
        payload.format || "pdf",
        JSON.stringify(
          payload.sections || [
            "visibility",
            "citations",
            "competitors",
            "technical",
            "content",
            "traffic",
            "actions",
          ],
        ),
        nextRun,
      ],
    );
    return this.mapScheduleRow(res.rows[0]);
  }

  /**
   * Delete report schedule
   */
  async deleteSchedule(
    scheduleId: string,
    projectId: string,
    tenantId: string,
  ): Promise<{ deleted: boolean }> {
    const res = await this.pool.query(
      `DELETE FROM report_schedules
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3
       RETURNING id`,
      [scheduleId, projectId, tenantId],
    );
    if (res.rows.length === 0) throw new ApiError(404, "Report schedule not found");
    return { deleted: true };
  }

  /**
   * List generated report history
   */
  async listReports(
    projectId: string,
    tenantId: string,
    limit = 20,
  ): Promise<GeneratedReportRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM generated_reports
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [projectId, tenantId, Math.min(limit, 50)],
    );
    return res.rows.map(this.mapReportRow);
  }

  /**
   * Generate On-Demand or Scheduled Executive Report (RPT-FR-004, RPT-FR-010)
   */
  async generateReport(
    projectId: string,
    tenantId: string,
    options: {
      title?: string;
      dateWindowDays?: number;
      format?: "pdf" | "html" | "json";
      scheduleId?: string;
      recipients?: string[];
    } = {},
  ): Promise<{ report: GeneratedReportRecord; htmlContent: string }> {
    const days = options.dateWindowDays || 30;
    const title = options.title || `Executive AEO Performance Brief (${days} Days)`;
    const format = options.format || "pdf";

    // 1. Fetch dashboard data
    const dashboardData = await this.dashboardService.getDashboard(projectId, tenantId, days);

    // 2. Fetch project details
    const projRes = await this.pool.query(
      `SELECT brand_name AS name, domain FROM projects WHERE id = $1 AND tenant_id = $2`,
      [projectId, tenantId],
    );
    const brandName = projRes.rows[0]?.name || "Brand";
    const brandDomain = projRes.rows[0]?.domain || "example.com";

    // 3. Compile Printable HTML Report
    const htmlContent = this.compileHtmlReport(brandName, brandDomain, dashboardData, title);

    // 4. Save to database
    const reportRes = await this.pool.query(
      `INSERT INTO generated_reports (
        project_id, tenant_id, schedule_id, title, date_window_days,
        format, status, summary_kpis, content_payload, download_url,
        delivered_emails, dispatched_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10, CASE WHEN $11 THEN NOW() ELSE NULL END)
      RETURNING *`,
      [
        projectId,
        tenantId,
        options.scheduleId || null,
        title,
        days,
        format,
        JSON.stringify(dashboardData.kpis),
        JSON.stringify({
          keyWins: dashboardData.keyWins,
          criticalRisks: dashboardData.criticalRisks,
          disclosures: dashboardData.disclosures,
        }),
        `/v1/tenants/${tenantId}/projects/${projectId}/reporting/reports/download`,
        JSON.stringify(options.recipients || []),
        Boolean(options.recipients && options.recipients.length > 0),
      ],
    );

    const report = this.mapReportRow(reportRes.rows[0]);

    // 5. Send Email via Brevo if recipients specified (RPT-FR-005)
    if (options.recipients && options.recipients.length > 0) {
      const emailOutbox = createEmailOutbox(this.pool, this.encryptionKey);
      for (const email of options.recipients) {
        void emailOutbox
          .enqueue(
            crypto.randomUUID(),
            tenantId,
            {
              to: email,
              subject: `[Savoir Executive Report] ${title} - ${brandName}`,
              text: `Executive AEO Brief for ${brandName} (${brandDomain})\n\nOverall Readiness Index: ${dashboardData.kpis.readinessIndex}/100 (${dashboardData.kpis.readinessRating})\nAI Visibility Score: ${dashboardData.kpis.visibilityScore}%\nAI Referral Sessions: ${dashboardData.kpis.aiReferralSessions.toLocaleString()}\nConversion Multiplier: ${dashboardData.kpis.conversionMultiplier}x vs traditional search\n\nKey Highlights:\n- ${dashboardData.keyWins.join("\n- ")}\n\nView and export full report: https://app.savoir.io/reporting`,
            },
            new Date(Date.now() + 24 * 60 * 60 * 1000),
          )
          .catch(() => {});
      }
    }

    return { report, htmlContent };
  }

  /**
   * Calculate next recurrence timestamp
   */
  private calculateNextRun(frequency: "weekly" | "monthly", dayOfWeek = 1, dayOfMonth = 1): Date {
    const next = new Date();
    if (frequency === "weekly") {
      const currentDay = next.getUTCDay();
      const diff = (dayOfWeek - currentDay + 7) % 7;
      next.setUTCDate(next.getUTCDate() + (diff === 0 ? 7 : diff));
      next.setUTCHours(9, 0, 0, 0); // 9:00 AM UTC
    } else {
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(Math.min(dayOfMonth, 28));
      next.setUTCHours(9, 0, 0, 0);
    }
    return next;
  }

  /**
   * Compile standalone print-ready HTML executive brief (RPT-FR-004)
   */
  private compileHtmlReport(
    brandName: string,
    domain: string,
    data: ExecutiveDashboardData,
    title: string,
  ): string {
    const { kpis, keyWins, criticalRisks, disclosures } = data;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} - ${brandName}</title>
  <style>
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5; margin: 0; padding: 40px; background: #fff; }
    .header { border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end; }
    .header h1 { font-size: 26px; margin: 0; color: #0f172a; }
    .header p { margin: 4px 0 0; color: #64748b; font-size: 14px; }
    .badge { background: #0f172a; color: #fff; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .readiness-banner { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; margin-bottom: 30px; display: flex; align-items: center; justify-content: space-between; }
    .readiness-score { font-size: 42px; font-weight: 800; color: #0f172a; line-height: 1; }
    .readiness-rating { display: inline-block; padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 13px; background: #dcfce7; color: #166534; margin-top: 6px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 30px; }
    .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; background: #fff; }
    .card-title { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.05em; margin-bottom: 6px; }
    .card-value { font-size: 24px; font-weight: 700; color: #0f172a; }
    .card-meta { font-size: 12px; color: #64748b; margin-top: 4px; }
    .section-title { font-size: 16px; font-weight: 700; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin: 30px 0 16px; }
    .bullet-list { margin: 0; padding-left: 20px; }
    .bullet-list li { margin-bottom: 8px; font-size: 13px; }
    .win-item { color: #15803d; font-weight: 500; }
    .risk-item { color: #b91c1c; font-weight: 500; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <span class="badge">Savoir Executive AEO Report</span>
      <h1>${brandName}</h1>
      <p>Domain: ${domain} · Reporting Window: Last ${data.dateWindowDays} Days</p>
    </div>
    <div>
      <p style="text-align: right; margin: 0; font-size: 12px;">Generated on ${new Date().toLocaleDateString()}</p>
    </div>
  </div>

  <div class="readiness-banner">
    <div>
      <h2 style="margin: 0; font-size: 18px; font-weight: 700;">Executive AEO Readiness Index</h2>
      <p style="margin: 4px 0 0; color: #64748b; font-size: 13px;">Weighted composite evaluating AI Visibility (30%), Citations (20%), Technical Access (15%), Content Coverage (15%), Traffic (10%), and Action Velocity (10%).</p>
    </div>
    <div style="text-align: right;">
      <div class="readiness-score">${kpis.readinessIndex} <span style="font-size: 18px; color: #64748b;">/ 100</span></div>
      <span class="readiness-rating">${kpis.readinessRating} Standing</span>
    </div>
  </div>

  <h3 class="section-title">Core Performance Metrics</h3>
  <div class="grid">
    <div class="card">
      <div class="card-title">AI Visibility Score (M3)</div>
      <div class="card-value">${kpis.visibilityScore}%</div>
      <div class="card-meta">+${kpis.visibilityDelta7d}% delta · p = ${kpis.visibilityPValue} (Modeled)</div>
    </div>
    <div class="card">
      <div class="card-title">Direct Citations (M6)</div>
      <div class="card-value">${kpis.totalBrandCitations}</div>
      <div class="card-meta">Across ${kpis.topCitedDomainsCount} cited sources (Observed)</div>
    </div>
    <div class="card">
      <div class="card-title">AI Referral Traffic (M11)</div>
      <div class="card-value">${kpis.aiReferralSessions.toLocaleString()}</div>
      <div class="card-meta">${kpis.conversionMultiplier}x conversion multiplier vs organic (Observed)</div>
    </div>
    <div class="card">
      <div class="card-title">Technical AEO Health (M8)</div>
      <div class="card-value">${kpis.technicalAeoScore} / 100</div>
      <div class="card-meta">${kpis.botAllowRatio}% AI bot crawl access (Modeled)</div>
    </div>
    <div class="card">
      <div class="card-title">Prompt Coverage (M9)</div>
      <div class="card-value">${kpis.contentCoveragePercent}%</div>
      <div class="card-meta">${kpis.identifiedContentGapsCount} prompt gaps identified</div>
    </div>
    <div class="card">
      <div class="card-title">Action Verification (M10)</div>
      <div class="card-value">${kpis.verifiedFixesRate}%</div>
      <div class="card-meta">${kpis.openActionItemsCount} open high-impact fixes</div>
    </div>
  </div>

  <h3 class="section-title">Executive Highlights & Key Wins</h3>
  <ul class="bullet-list">
    ${keyWins.map((w) => `<li class="win-item">${w}</li>`).join("")}
  </ul>

  ${
    criticalRisks.length > 0
      ? `<h3 class="section-title" style="color: #b91c1c;">Critical Risks & Active Alerts</h3>
         <ul class="bullet-list">
           ${criticalRisks.map((r) => `<li class="risk-item">${r}</li>`).join("")}
         </ul>`
      : ""
  }

  <div class="footer">
    <p><strong>Methodology Disclosures:</strong></p>
    <p>${disclosures.unreferredTraffic}</p>
    <p>${disclosures.gscIsolation}</p>
    <p>${disclosures.modeledFormulas}</p>
  </div>
</body>
</html>`;
  }

  private mapScheduleRow(r: Record<string, unknown>): ReportScheduleRecord {
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      projectId: String(r.project_id),
      name: String(r.name),
      frequency: r.frequency as ReportScheduleRecord["frequency"],
      dayOfWeek:
        r.day_of_week !== null && r.day_of_week !== undefined ? Number(r.day_of_week) : null,
      dayOfMonth:
        r.day_of_month !== null && r.day_of_month !== undefined ? Number(r.day_of_month) : null,
      recipients: Array.isArray(r.recipients) ? (r.recipients as string[]) : [],
      format: (r.format as ReportScheduleRecord["format"]) || "pdf",
      sections: Array.isArray(r.sections) ? (r.sections as string[]) : [],
      isActive: Boolean(r.is_active),
      lastRunAt: r.last_run_at ? new Date(r.last_run_at as string | Date).toISOString() : null,
      lastRunStatus: r.last_run_status ? String(r.last_run_status) : null,
      nextRunAt: r.next_run_at ? new Date(r.next_run_at as string | Date).toISOString() : null,
      createdAt: new Date(r.created_at as string | Date).toISOString(),
      updatedAt: new Date(r.updated_at as string | Date).toISOString(),
    };
  }

  private mapReportRow(r: Record<string, unknown>): GeneratedReportRecord {
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      projectId: String(r.project_id),
      scheduleId: r.schedule_id ? String(r.schedule_id) : null,
      title: String(r.title),
      dateWindowDays: Number(r.date_window_days) || 30,
      format: (r.format as GeneratedReportRecord["format"]) || "pdf",
      status: (r.status as GeneratedReportRecord["status"]) || "completed",
      summaryKpis: (r.summary_kpis as Record<string, unknown>) || {},
      contentPayload: (r.content_payload as Record<string, unknown>) || {},
      downloadUrl: r.download_url ? String(r.download_url) : null,
      deliveredEmails: Array.isArray(r.delivered_emails) ? (r.delivered_emails as string[]) : [],
      dispatchedAt: r.dispatched_at
        ? new Date(r.dispatched_at as string | Date).toISOString()
        : null,
      createdAt: new Date(r.created_at as string | Date).toISOString(),
    };
  }
}
