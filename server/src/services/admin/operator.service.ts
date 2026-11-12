import type { Pool } from "pg";
import { CreditLedgerService, type CreditCategory } from "../billing/credit-ledger.service.js";
import { ApiError } from "../../utils/ApiError.js";

export interface OperatorTenantSummary {
  id: string;
  name: string;
  region: string;
  status: "active" | "paused" | "archived";
  createdAt: string;
  planTier: string;
  subscriptionStatus: string;
  availableCredits: number;
  availableCrawlCredits: number;
  projectCount: number;
  memberCount: number;
  primaryDomain?: string | null;
}

export interface QueueHealthStats {
  queueName: string;
  waiting: number;
  active: number;
  failed: number;
  completedToday: number;
  status: "healthy" | "congested" | "degraded";
}

export interface OperatorAuditLogRecord {
  id: string;
  operatorId: string;
  action: string;
  targetTenantId?: string | null;
  targetTenantName?: string | null;
  details: Record<string, unknown>;
  ipAddress?: string | null;
  createdAt: string;
}

export class OperatorService {
  private ledgerService: CreditLedgerService;

  constructor(private pool: Pool) {
    this.ledgerService = new CreditLedgerService(pool);
  }

  /**
   * Cross-tenant search and overview (ADM-FR-008)
   */
  async searchTenants(params: {
    query?: string;
    planTier?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ tenants: OperatorTenantSummary[]; totalCount: number }> {
    const limit = Math.min(100, Math.max(1, params.limit || 25));
    const offset = Math.max(0, params.offset || 0);

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.query && params.query.trim()) {
      conditions.push(
        `(t.name ILIKE $${idx} OR t.id::text ILIKE $${idx} OR p.domain ILIKE $${idx})`,
      );
      values.push(`%${params.query.trim()}%`);
      idx++;
    }

    if (params.status && params.status !== "all") {
      conditions.push(`t.status = $${idx}`);
      values.push(params.status);
      idx++;
    }

    if (params.planTier && params.planTier !== "all") {
      conditions.push(`s.plan_tier = $${idx}`);
      values.push(params.planTier);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countQuery = `
      SELECT COUNT(DISTINCT t.id) as total
      FROM tenants t
      LEFT JOIN projects p ON p.tenant_id = t.id
      LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
      ${whereClause}
    `;
    const countRes = await this.pool.query(countQuery, values);
    const totalCount = parseInt(countRes.rows[0]?.total || "0", 10);

    const query = `
      SELECT
        t.id,
        t.name,
        t.region,
        t.status,
        t.created_at,
        coalesce(s.plan_tier, 'starter') as plan_tier,
        coalesce(s.status, 'active') as sub_status,
        coalesce(c.available, 0) as available_credits,
        coalesce(cc.available, 500) as available_crawl_credits,
        count(DISTINCT p.id) as project_count,
        count(DISTINCT m.user_id) as member_count,
        min(p.domain) as primary_domain
      FROM tenants t
      LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
      LEFT JOIN monitoring_credits c ON c.tenant_id = t.id
      LEFT JOIN crawl_credits cc ON cc.tenant_id = t.id
      LEFT JOIN projects p ON p.tenant_id = t.id
      LEFT JOIN memberships m ON m.tenant_id = t.id
      ${whereClause}
      GROUP BY t.id, t.name, t.region, t.status, t.created_at, s.plan_tier, s.status, c.available, cc.available
      ORDER BY t.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    values.push(limit, offset);
    const res = await this.pool.query(query, values);

    const tenants: OperatorTenantSummary[] = res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      region: row.region,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      planTier: row.plan_tier,
      subscriptionStatus: row.sub_status,
      availableCredits: Number(row.available_credits),
      availableCrawlCredits: Number(row.available_crawl_credits),
      projectCount: Number(row.project_count),
      memberCount: Number(row.member_count),
      primaryDomain: row.primary_domain,
    }));

    return { tenants, totalCount };
  }

  /**
   * Detailed Tenant Information
   */
  async getTenantDetail(targetTenantId: string): Promise<Record<string, unknown>> {
    const [tenantRes, projectsRes, subRes, balances, ledger] = await Promise.all([
      this.pool.query(`SELECT * FROM tenants WHERE id = $1`, [targetTenantId]),
      this.pool.query(
        `SELECT id, brand_name, domain, status, created_at FROM projects WHERE tenant_id = $1`,
        [targetTenantId],
      ),
      this.pool.query(`SELECT * FROM tenant_subscriptions WHERE tenant_id = $1`, [targetTenantId]),
      this.ledgerService.getBalances(targetTenantId),
      this.ledgerService.getLedgerHistory(targetTenantId, { limit: 20 }),
    ]);

    if (tenantRes.rowCount === 0) {
      throw new ApiError(404, "Tenant not found", "TENANT_NOT_FOUND");
    }

    return {
      tenant: tenantRes.rows[0],
      projects: projectsRes.rows,
      subscription: subRes.rows[0] || null,
      balances,
      ledger,
    };
  }

  /**
   * Pause / Resume / Archive Tenant controls (ADM-FR-009)
   */
  async updateTenantStatus(params: {
    operatorId: string;
    targetTenantId: string;
    status: "active" | "paused" | "archived";
    reason: string;
    ipAddress?: string;
  }): Promise<{ status: string }> {
    const currentRes = await this.pool.query(`SELECT name, status FROM tenants WHERE id = $1`, [
      params.targetTenantId,
    ]);

    if (currentRes.rowCount === 0) {
      throw new ApiError(404, "Tenant not found", "TENANT_NOT_FOUND");
    }

    const prevStatus = currentRes.rows[0].status;

    await this.pool.query(`UPDATE tenants SET status = $1 WHERE id = $2`, [
      params.status,
      params.targetTenantId,
    ]);

    // Record Immutable Operator Audit Log (ADM-FR-012)
    await this.pool.query(
      `INSERT INTO operator_audit_logs (
        operator_id, action, target_tenant_id, details, ip_address
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        params.operatorId,
        `tenant.${params.status}`,
        params.targetTenantId,
        JSON.stringify({
          prevStatus,
          newStatus: params.status,
          reason: params.reason,
          tenantName: currentRes.rows[0].name,
        }),
        params.ipAddress || null,
      ],
    );

    return { status: params.status };
  }

  /**
   * Manual credit adjustment (ADM-FR-010)
   */
  async adjustCredits(params: {
    operatorId: string;
    targetTenantId: string;
    category: CreditCategory;
    amount: number;
    reason: string;
    ipAddress?: string;
  }): Promise<{ balanceAfter: number }> {
    if (params.amount === 0) {
      throw new ApiError(400, "Adjustment amount cannot be zero", "INVALID_AMOUNT");
    }

    const { balanceAfter } = await this.ledgerService.grantCredits({
      tenantId: params.targetTenantId,
      category: params.category,
      amount: params.amount,
      entryType: "operator_adjustment",
      description: `Operator credit adjustment: ${params.reason} (${params.amount > 0 ? "+" : ""}${params.amount})`,
      metadata: {
        operatorId: params.operatorId,
        reason: params.reason,
      },
    });

    // Record Operator Audit Log
    await this.pool.query(
      `INSERT INTO operator_audit_logs (
        operator_id, action, target_tenant_id, details, ip_address
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        params.operatorId,
        "credits.adjust",
        params.targetTenantId,
        JSON.stringify({
          category: params.category,
          amount: params.amount,
          balanceAfter,
          reason: params.reason,
        }),
        params.ipAddress || null,
      ],
    );

    return { balanceAfter };
  }

  /**
   * Platform queue health and worker status (ADM-FR-011)
   */
  async getQueueHealth(): Promise<QueueHealthStats[]> {
    const [runsRes, emailRes, auditsRes] = await Promise.all([
      this.pool.query(`
        SELECT
          count(*) FILTER (WHERE status = 'queued') as waiting,
          count(*) FILTER (WHERE status = 'running') as active,
          count(*) FILTER (WHERE status = 'failed') as failed,
          count(*) FILTER (WHERE status = 'succeeded' AND completed_at >= CURRENT_DATE) as completed_today
        FROM monitoring_runs
      `),
      this.pool.query(`
        SELECT
          count(*) FILTER (WHERE lease_id IS NULL) as waiting,
          count(*) FILTER (WHERE lease_id IS NOT NULL) as active,
          count(*) FILTER (WHERE attempts >= 5) as failed,
          count(*) FILTER (WHERE lease_id IS NULL AND created_at >= CURRENT_DATE) as completed_today
        FROM email_outbox
      `),
      this.pool.query(`
        SELECT
          count(*) FILTER (WHERE status = 'running') as active,
          count(*) FILTER (WHERE status = 'failed') as failed,
          count(*) FILTER (WHERE status = 'completed' AND completed_at >= CURRENT_DATE) as completed_today
        FROM technical_audits
      `),
    ]);

    const mon = runsRes.rows[0];
    const email = emailRes.rows[0];
    const audits = auditsRes.rows[0];

    const monFailed = Number(mon.failed || 0);
    const monWaiting = Number(mon.waiting || 0);

    return [
      {
        queueName: "monitoring-runs",
        waiting: monWaiting,
        active: Number(mon.active || 0),
        failed: monFailed,
        completedToday: Number(mon.completed_today || 0),
        status: monFailed > 50 ? "degraded" : monWaiting > 200 ? "congested" : "healthy",
      },
      {
        queueName: "crawler-audits",
        waiting: 0,
        active: Number(audits.active || 0),
        failed: Number(audits.failed || 0),
        completedToday: Number(audits.completed_today || 0),
        status: "healthy",
      },
      {
        queueName: "email-outbox",
        waiting: Number(email.waiting || 0),
        active: Number(email.active || 0),
        failed: Number(email.failed || 0),
        completedToday: Number(email.completed_today || 0),
        status: Number(email.failed || 0) > 10 ? "degraded" : "healthy",
      },
    ];
  }

  /**
   * Immutable Operator Audit Logs query (ADM-FR-012)
   */
  async getAuditLogs(params: {
    limit?: number;
    offset?: number;
    targetTenantId?: string;
  }): Promise<OperatorAuditLogRecord[]> {
    const limit = Math.min(100, Math.max(1, params.limit || 50));
    const offset = Math.max(0, params.offset || 0);

    const values: unknown[] = [limit, offset];
    let whereClause = "";

    if (params.targetTenantId) {
      whereClause = "WHERE a.target_tenant_id = $3";
      values.push(params.targetTenantId);
    }

    const query = `
      SELECT
        a.id,
        a.operator_id,
        a.action,
        a.target_tenant_id,
        t.name as target_tenant_name,
        a.details,
        a.ip_address,
        a.created_at
      FROM operator_audit_logs a
      LEFT JOIN tenants t ON t.id = a.target_tenant_id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const res = await this.pool.query(query, values);
    return res.rows.map((row) => ({
      id: row.id,
      operatorId: row.operator_id,
      action: row.action,
      targetTenantId: row.target_tenant_id,
      targetTenantName: row.target_tenant_name,
      details: row.details,
      ipAddress: row.ip_address,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}
