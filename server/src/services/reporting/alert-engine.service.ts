/**
 * Real-Time Alert Engine Service (M13 / RPT-FR-006 to RPT-FR-009)
 * Evaluates visibility drops, competitor overtakes, lost citations, and crawl blockages.
 */

import type { Pool } from "pg";
import { ApiError } from "../../utils/ApiError.js";
import type { EmailProvider } from "../email/brevo.adapter.js";
import { createEmailOutbox } from "../email/outbox.service.js";

export type AlertRuleType =
  "visibility_drop" | "competitor_overtake" | "lost_citation" | "crawl_blockage";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertIncidentStatus = "active" | "acknowledged" | "resolved" | "dismissed";

export interface AlertRuleRecord {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  ruleType: AlertRuleType;
  threshold: Record<string, unknown>;
  severity: AlertSeverity;
  channels: string[]; // ["in_app", "email", "webhook"]
  emailRecipients: string[];
  cooldownHours: number;
  isActive: boolean;
  lastTriggeredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertIncidentRecord {
  id: string;
  tenantId: string;
  projectId: string;
  ruleId?: string | null;
  ruleType: AlertRuleType;
  severity: AlertSeverity;
  title: string;
  message: string;
  details: Record<string, unknown>;
  status: AlertIncidentStatus;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  resolvedAt?: string | null;
  resolvedNotes?: string | null;
  notifiedChannels: string[];
  createdAt: string;
}

export class AlertEngineService {
  constructor(
    private pool: Pool,
    private emailProvider?: EmailProvider,
    private encryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ) {}

  /**
   * List configured alert rules
   */
  async listRules(projectId: string, tenantId: string): Promise<AlertRuleRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM alert_rules
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC`,
      [projectId, tenantId],
    );
    return res.rows.map(this.mapRuleRow);
  }

  /**
   * Create alert rule (RPT-FR-006)
   */
  async createRule(
    projectId: string,
    tenantId: string,
    payload: {
      name: string;
      ruleType: AlertRuleType;
      threshold: Record<string, unknown>;
      severity?: AlertSeverity;
      channels?: string[];
      emailRecipients?: string[];
      cooldownHours?: number;
    },
  ): Promise<AlertRuleRecord> {
    const res = await this.pool.query(
      `INSERT INTO alert_rules (
        project_id, tenant_id, name, rule_type, threshold, severity,
        channels, email_recipients, cooldown_hours, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
      RETURNING *`,
      [
        projectId,
        tenantId,
        payload.name,
        payload.ruleType,
        JSON.stringify(payload.threshold),
        payload.severity || "warning",
        JSON.stringify(payload.channels || ["in_app", "email"]),
        JSON.stringify(payload.emailRecipients || []),
        payload.cooldownHours ?? 24,
      ],
    );
    return this.mapRuleRow(res.rows[0]);
  }

  /**
   * Delete alert rule
   */
  async deleteRule(
    ruleId: string,
    projectId: string,
    tenantId: string,
  ): Promise<{ deleted: boolean }> {
    const res = await this.pool.query(
      `DELETE FROM alert_rules
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3
       RETURNING id`,
      [ruleId, projectId, tenantId],
    );
    if (res.rows.length === 0) throw new ApiError(404, "Alert rule not found");
    return { deleted: true };
  }

  /**
   * List incidents with filters (RPT-FR-008, RPT-FR-009)
   */
  async listIncidents(
    projectId: string,
    tenantId: string,
    options: { status?: AlertIncidentStatus; severity?: AlertSeverity; limit?: number } = {},
  ): Promise<AlertIncidentRecord[]> {
    const limit = Math.min(options.limit || 50, 100);
    const conditions: string[] = ["project_id = $1", "tenant_id = $2"];
    const params: unknown[] = [projectId, tenantId];

    if (options.status) {
      params.push(options.status);
      conditions.push(`status = $${params.length}`);
    }
    if (options.severity) {
      params.push(options.severity);
      conditions.push(`severity = $${params.length}`);
    }

    params.push(limit);
    const res = await this.pool.query(
      `SELECT * FROM alert_incidents
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return res.rows.map(this.mapIncidentRow);
  }

  /**
   * Update incident lifecycle (acknowledged, resolved, dismissed)
   */
  async updateIncident(
    incidentId: string,
    projectId: string,
    tenantId: string,
    payload: {
      status: AlertIncidentStatus;
      notes?: string;
      userId?: string;
    },
  ): Promise<AlertIncidentRecord> {
    const isAck = payload.status === "acknowledged";
    const isResolved = payload.status === "resolved" || payload.status === "dismissed";

    const res = await this.pool.query(
      `UPDATE alert_incidents
       SET status = $1,
           acknowledged_at = CASE WHEN $2 THEN NOW() ELSE acknowledged_at END,
           acknowledged_by = CASE WHEN $2 THEN $3 ELSE acknowledged_by END,
           resolved_at = CASE WHEN $4 THEN NOW() ELSE resolved_at END,
           resolved_notes = COALESCE($5, resolved_notes)
       WHERE id = $6 AND project_id = $7 AND tenant_id = $8
       RETURNING *`,
      [
        payload.status,
        isAck,
        payload.userId || "operator",
        isResolved,
        payload.notes || null,
        incidentId,
        projectId,
        tenantId,
      ],
    );

    if (res.rows.length === 0) throw new ApiError(404, "Alert incident not found");
    return this.mapIncidentRow(res.rows[0]);
  }

  /**
   * Evaluate Visibility Drop Rule (RPT-FR-006)
   * Formula: z = (p1 - p2) / sqrt(p_pool * (1 - p_pool) * (1/n1 + 1/n2))
   */
  static evaluateVisibilityDrop(
    currentVis: number,
    prevVis: number,
    sampleSize: number,
    dropPercentThreshold = 10,
  ): { triggered: boolean; dropPercent: number; pValue: number; isSignificant: boolean } {
    const delta = prevVis - currentVis;
    const dropPercent = prevVis > 0 ? (delta / prevVis) * 100 : 0;

    // Normal approximation for two-proportion z-test
    const p1 = Math.max(0.01, Math.min(0.99, prevVis / 100));
    const p2 = Math.max(0.01, Math.min(0.99, currentVis / 100));
    const n = Math.max(30, sampleSize);
    const pPool = (p1 + p2) / 2;
    const se = Math.sqrt(pPool * (1 - pPool) * (2 / n));
    const zScore = se > 0 ? Math.abs(p1 - p2) / se : 0;

    // Two-tailed p-value approximation
    const pValue = Number((2 * (1 - AlertEngineService.approxPhi(zScore))).toFixed(4));
    const isSignificant = pValue < 0.05 || zScore >= 1.96;
    const triggered = dropPercent >= dropPercentThreshold && isSignificant;

    return {
      triggered,
      dropPercent: Number(dropPercent.toFixed(1)),
      pValue,
      isSignificant,
    };
  }

  /**
   * Standard normal cumulative distribution function (CDF) approximation
   */
  private static approxPhi(z: number): number {
    const t = 1.0 / (1.0 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2.0);
    const p =
      d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1.0 - p : p;
  }

  /**
   * Evaluate Competitor Overtake Rule (RPT-FR-006)
   */
  static evaluateCompetitorOvertake(
    brandScore: number,
    competitorScore: number,
    _competitorName?: string,
  ): { triggered: boolean; gap: number } {
    const gap = competitorScore - brandScore;
    const triggered = gap > 0 && competitorScore >= 50;
    return { triggered, gap: Number(gap.toFixed(1)) };
  }

  /**
   * Evaluate Lost Citation Rule (RPT-FR-006)
   */
  static evaluateLostCitation(
    httpStatus: number | null,
    wasPreviouslyCited: boolean,
    isCurrentlyCited: boolean,
  ): { triggered: boolean; reason: string } {
    if (wasPreviouslyCited && (httpStatus === 404 || (httpStatus !== null && httpStatus >= 500))) {
      return { triggered: true, reason: `Cited page returns HTTP status ${httpStatus}` };
    }
    if (wasPreviouslyCited && !isCurrentlyCited) {
      return { triggered: true, reason: "Owned citation dropped from answer references" };
    }
    return { triggered: false, reason: "" };
  }

  /**
   * Evaluate Crawl Blockage Rule (RPT-FR-006)
   */
  static evaluateCrawlBlockage(
    botName: string,
    isDisallowed: boolean,
    httpStatus?: number,
  ): { triggered: boolean; message: string } {
    if (isDisallowed) {
      return { triggered: true, message: `Bot ${botName} disallowed in robots.txt` };
    }
    if (httpStatus === 403) {
      return { triggered: true, message: `Bot ${botName} received HTTP 403 Forbidden` };
    }
    return { triggered: false, message: "" };
  }

  /**
   * Trigger Incident & Dispatch Notifications across Channels (RPT-FR-007, RPT-FR-008)
   */
  async triggerIncident(
    projectId: string,
    tenantId: string,
    params: {
      ruleId?: string;
      ruleType: AlertRuleType;
      severity: AlertSeverity;
      title: string;
      message: string;
      details?: Record<string, unknown>;
      channels?: string[];
      emailRecipients?: string[];
    },
  ): Promise<AlertIncidentRecord> {
    // 1. Check Cooldown Window (RPT-FR-007)
    if (params.ruleId) {
      const ruleRes = await this.pool.query(
        `SELECT cooldown_hours, last_triggered_at FROM alert_rules
         WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
        [params.ruleId, projectId, tenantId],
      );
      if (ruleRes.rows.length > 0) {
        const { cooldown_hours, last_triggered_at } = ruleRes.rows[0];
        if (last_triggered_at) {
          const hoursSince =
            (Date.now() - new Date(last_triggered_at).getTime()) / (1000 * 60 * 60);
          if (hoursSince < cooldown_hours) {
            // Cooldown active: fetch existing active incident
            const existing = await this.pool.query(
              `SELECT * FROM alert_incidents
               WHERE rule_id = $1 AND status = 'active'
               ORDER BY created_at DESC LIMIT 1`,
              [params.ruleId],
            );
            if (existing.rows.length > 0) {
              return this.mapIncidentRow(existing.rows[0]);
            }
          }
        }
      }
    }

    // 2. Insert incident
    const notifiedChannels = params.channels || ["in_app"];
    const res = await this.pool.query(
      `INSERT INTO alert_incidents (
        project_id, tenant_id, rule_id, rule_type, severity,
        title, message, details, status, notified_channels
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
      RETURNING *`,
      [
        projectId,
        tenantId,
        params.ruleId || null,
        params.ruleType,
        params.severity,
        params.title,
        params.message,
        JSON.stringify(params.details || {}),
        JSON.stringify(notifiedChannels),
      ],
    );

    const incident = this.mapIncidentRow(res.rows[0]);

    // 3. Update rule last_triggered_at
    if (params.ruleId) {
      await this.pool.query(`UPDATE alert_rules SET last_triggered_at = NOW() WHERE id = $1`, [
        params.ruleId,
      ]);
    }

    // 4. Dispatch Email via Brevo if configured (RPT-FR-008)
    if (
      notifiedChannels.includes("email") &&
      params.emailRecipients &&
      params.emailRecipients.length > 0
    ) {
      const emailOutbox = createEmailOutbox(this.pool, this.encryptionKey);
      for (const email of params.emailRecipients) {
        void emailOutbox
          .enqueue(
            crypto.randomUUID(),
            tenantId,
            {
              to: email,
              subject: `[Savoir Alert - ${params.severity.toUpperCase()}] ${params.title}`,
              text: `Critical AEO Alert Notification\n\nTitle: ${params.title}\nSeverity: ${params.severity.toUpperCase()}\nDetails: ${params.message}\n\nView details in Savoir: https://app.savoir.io/alerts`,
            },
            new Date(Date.now() + 24 * 60 * 60 * 1000),
          )
          .catch(() => {});
      }
    }

    return incident;
  }

  private mapRuleRow(r: Record<string, unknown>): AlertRuleRecord {
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      projectId: String(r.project_id),
      name: String(r.name),
      ruleType: r.rule_type as AlertRuleType,
      threshold: (r.threshold as Record<string, unknown>) || {},
      severity: r.severity as AlertSeverity,
      channels: Array.isArray(r.channels) ? (r.channels as string[]) : ["in_app"],
      emailRecipients: Array.isArray(r.email_recipients) ? (r.email_recipients as string[]) : [],
      cooldownHours: Number(r.cooldown_hours) || 24,
      isActive: Boolean(r.is_active),
      lastTriggeredAt: r.last_triggered_at
        ? new Date(r.last_triggered_at as string | Date).toISOString()
        : null,
      createdAt: new Date(r.created_at as string | Date).toISOString(),
      updatedAt: new Date(r.updated_at as string | Date).toISOString(),
    };
  }

  private mapIncidentRow(r: Record<string, unknown>): AlertIncidentRecord {
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      projectId: String(r.project_id),
      ruleId: r.rule_id ? String(r.rule_id) : null,
      ruleType: r.rule_type as AlertRuleType,
      severity: r.severity as AlertSeverity,
      title: String(r.title),
      message: String(r.message),
      details: (r.details as Record<string, unknown>) || {},
      status: r.status as AlertIncidentStatus,
      acknowledgedAt: r.acknowledged_at
        ? new Date(r.acknowledged_at as string | Date).toISOString()
        : null,
      acknowledgedBy: r.acknowledged_by ? String(r.acknowledged_by) : null,
      resolvedAt: r.resolved_at ? new Date(r.resolved_at as string | Date).toISOString() : null,
      resolvedNotes: r.resolved_notes ? String(r.resolved_notes) : null,
      notifiedChannels: Array.isArray(r.notified_channels) ? (r.notified_channels as string[]) : [],
      createdAt: new Date(r.created_at as string | Date).toISOString(),
    };
  }
}
