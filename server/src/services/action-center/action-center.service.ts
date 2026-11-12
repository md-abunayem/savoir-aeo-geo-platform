/**
 * Action Center Service (M10 / ACT-FR-001 to ACT-FR-008)
 * Core business logic for action harvesting, deduplication, priority management,
 * verification loops, collaboration comments, and RFC 4180 CSV export.
 */

import type { Pool } from "pg";
import { ActionHarvester } from "./action-harvester.js";
import { ActionVerifier, type VerificationResult } from "./action-verifier.js";
import type { FixGuidance } from "./fix-generator.js";
import { ApiError } from "../../utils/ApiError.js";

export interface ActionItemRecord {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string;
  category: "technical" | "content" | "citation" | "agent_readiness" | "accuracy" | "competitor";
  sourceModule: "M5" | "M6" | "M7" | "M8" | "M9" | "M16" | "manual";
  sourceId?: string | null;
  dedupKey: string;
  status: "backlog" | "todo" | "in_progress" | "done" | "dismissed";
  dismissReason?: string | null;
  priorityScore: number;
  impact: number;
  confidence: number;
  effort: "S" | "M" | "L";
  owner?: string | null;
  dueDate?: string | null;
  evidence: Array<{
    url?: string;
    promptId?: string;
    quote?: string;
    source?: string;
    date?: string;
    findingType?: string;
  }>;
  fixGuidance?: FixGuidance | null;
  verificationStatus: "pending" | "verified" | "not_verified" | "inconclusive";
  verificationNotes?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActionCommentRecord {
  id: string;
  actionId: string;
  tenantId: string;
  userId?: string | null;
  userName: string;
  body: string;
  createdAt: string;
}

export interface ActionStats {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  dismissed: number;
  backlog: number;
  avgPriority: number;
  byCategory: Record<string, number>;
}

export class ActionCenterService {
  private readonly harvester: ActionHarvester;

  constructor(private readonly pool: Pool) {
    this.harvester = new ActionHarvester(pool);
  }

  /**
   * Harvest actions from all underlying intelligence streams (M5-M16)
   */
  async harvestActions(
    projectId: string,
    tenantId: string,
  ): Promise<{ harvestedCount: number; createdCount: number; deduplicatedCount: number }> {
    const projectRes = await this.pool.query(
      `SELECT domain, name FROM projects WHERE id = $1 AND tenant_id = $2`,
      [projectId, tenantId],
    );
    if (projectRes.rows.length === 0) {
      throw new ApiError(404, "Project not found");
    }

    const { domain, name } = projectRes.rows[0];
    const brandName = name || domain;

    const candidates = await this.harvester.harvest(projectId, tenantId, domain, brandName);

    let createdCount = 0;
    let deduplicatedCount = 0;

    for (const cand of candidates) {
      // Check existing action with dedupKey
      const existing = await this.pool.query(
        `SELECT id, evidence, status FROM action_items
         WHERE project_id = $1 AND tenant_id = $2 AND dedup_key = $3
         LIMIT 1`,
        [projectId, tenantId, cand.dedupKey],
      );

      if (existing.rows.length > 0) {
        // Deduplicate: merge evidence if not already marked done or dismissed
        deduplicatedCount++;
        const row = existing.rows[0];
        if (row.status !== "done" && row.status !== "dismissed") {
          const currentEvidence = Array.isArray(row.evidence) ? row.evidence : [];
          const existingQuotes = new Set(
            currentEvidence.map((e: { quote?: string; url?: string }) => e.quote || e.url),
          );
          const newEvidence = [...currentEvidence];
          for (const ev of cand.evidence) {
            if (!existingQuotes.has(ev.quote || ev.url)) {
              newEvidence.push(ev);
            }
          }

          await this.pool.query(
            `UPDATE action_items
             SET evidence = $1, priority_score = $2, updated_at = NOW()
             WHERE id = $3 AND tenant_id = $4`,
            [JSON.stringify(newEvidence), cand.priorityScore, row.id, tenantId],
          );
        }
      } else {
        // Insert new candidate
        createdCount++;
        await this.pool.query(
          `INSERT INTO action_items (
            project_id, tenant_id, title, description, category, source_module,
            source_id, dedup_key, status, priority_score, impact, confidence,
            effort, evidence, fix_guidance, verification_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'todo', $9, $10, $11, $12, $13, $14, 'pending')`,
          [
            projectId,
            tenantId,
            cand.title,
            cand.description,
            cand.category,
            cand.sourceModule,
            cand.sourceId || null,
            cand.dedupKey,
            cand.priorityScore,
            cand.impact,
            cand.confidence,
            cand.effort,
            JSON.stringify(cand.evidence),
            cand.fixGuidance ? JSON.stringify(cand.fixGuidance) : null,
          ],
        );
      }
    }

    return {
      harvestedCount: candidates.length,
      createdCount,
      deduplicatedCount,
    };
  }

  /**
   * List actions with filters, sorting, and summary metrics
   */
  async listActions(
    projectId: string,
    tenantId: string,
    options: {
      category?: string;
      sourceModule?: string;
      status?: string;
      effort?: string;
      owner?: string;
      search?: string;
      minPriority?: number;
      limit?: number;
      offset?: number;
      sortBy?: "priority" | "dueDate" | "created";
    } = {},
  ): Promise<{ items: ActionItemRecord[]; total: number; stats: ActionStats }> {
    const conditions = [`project_id = $1`, `tenant_id = $2`];
    const params: (string | number)[] = [projectId, tenantId];

    if (options.category) {
      params.push(options.category);
      conditions.push(`category = $${params.length}`);
    }
    if (options.sourceModule) {
      params.push(options.sourceModule);
      conditions.push(`source_module = $${params.length}`);
    }
    if (options.status) {
      params.push(options.status);
      conditions.push(`status = $${params.length}`);
    }
    if (options.effort) {
      params.push(options.effort);
      conditions.push(`effort = $${params.length}`);
    }
    if (options.owner) {
      params.push(options.owner);
      conditions.push(`owner = $${params.length}`);
    }
    if (options.minPriority !== undefined) {
      params.push(options.minPriority);
      conditions.push(`priority_score >= $${params.length}`);
    }
    if (options.search) {
      params.push(`%${options.search}%`);
      conditions.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }

    const whereClause = conditions.join(" AND ");

    // Sorting
    let orderClause = `priority_score DESC, created_at DESC`;
    if (options.sortBy === "dueDate") {
      orderClause = `due_date ASC NULLS LAST, priority_score DESC`;
    } else if (options.sortBy === "created") {
      orderClause = `created_at DESC`;
    }

    const limit = options.limit || 50;
    const offset = options.offset || 0;

    // Fetch items
    const query = `
      SELECT id, tenant_id, project_id, title, description, category,
             source_module, source_id, dedup_key, status, dismiss_reason,
             priority_score, impact, confidence, effort, owner, due_date,
             evidence, fix_guidance, verification_status, verification_notes,
             verified_at, created_at, updated_at
      FROM action_items
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const res = await this.pool.query(query, params);

    // Fetch total count matching filters
    const countRes = await this.pool.query(
      `SELECT COUNT(*)::int as total FROM action_items WHERE ${whereClause}`,
      params,
    );
    const total = countRes.rows[0]?.total || 0;

    // Fetch aggregate project stats
    const statsRes = await this.pool.query(
      `SELECT
         COUNT(*)::int as total,
         COUNT(CASE WHEN status = 'todo' THEN 1 END)::int as todo_count,
         COUNT(CASE WHEN status = 'in_progress' THEN 1 END)::int as in_progress_count,
         COUNT(CASE WHEN status = 'done' THEN 1 END)::int as done_count,
         COUNT(CASE WHEN status = 'dismissed' THEN 1 END)::int as dismissed_count,
         COUNT(CASE WHEN status = 'backlog' THEN 1 END)::int as backlog_count,
         COALESCE(AVG(priority_score), 0)::float as avg_priority,
         category,
         COUNT(*)::int as cat_count
       FROM action_items
       WHERE project_id = $1 AND tenant_id = $2
       GROUP BY category`,
      [projectId, tenantId],
    );

    const stats: ActionStats = {
      total: 0,
      todo: 0,
      inProgress: 0,
      done: 0,
      dismissed: 0,
      backlog: 0,
      avgPriority: 0,
      byCategory: {},
    };

    let totalPriorityAccum = 0;
    for (const r of statsRes.rows) {
      stats.total += r.cat_count;
      stats.todo += r.todo_count;
      stats.inProgress += r.in_progress_count;
      stats.done += r.done_count;
      stats.dismissed += r.dismissed_count;
      stats.backlog += r.backlog_count;
      stats.byCategory[r.category] = r.cat_count;
      totalPriorityAccum += r.avg_priority * r.cat_count;
    }
    if (stats.total > 0) {
      stats.avgPriority = Math.round(totalPriorityAccum / stats.total);
    }

    return {
      items: res.rows.map(this.mapActionRow),
      total,
      stats,
    };
  }

  /**
   * Get single action item
   */
  async getAction(id: string, projectId: string, tenantId: string): Promise<ActionItemRecord> {
    const res = await this.pool.query(
      `SELECT id, tenant_id, project_id, title, description, category,
              source_module, source_id, dedup_key, status, dismiss_reason,
              priority_score, impact, confidence, effort, owner, due_date,
              evidence, fix_guidance, verification_status, verification_notes,
              verified_at, created_at, updated_at
       FROM action_items
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
      [id, projectId, tenantId],
    );

    if (res.rows.length === 0) {
      throw new ApiError(404, "Action item not found");
    }

    return this.mapActionRow(res.rows[0]);
  }

  /**
   * Create custom action item manually
   */
  async createAction(
    projectId: string,
    tenantId: string,
    data: {
      title: string;
      description: string;
      category:
        "technical" | "content" | "citation" | "agent_readiness" | "accuracy" | "competitor";
      impact?: number;
      confidence?: number;
      effort?: "S" | "M" | "L";
      owner?: string;
      dueDate?: string;
      evidence?: Array<Record<string, unknown>>;
      fixGuidance?: FixGuidance | Record<string, unknown>;
    },
  ): Promise<ActionItemRecord> {
    const impact = data.impact ?? 5;
    const confidence = data.confidence ?? 0.8;
    const effort = data.effort ?? "M";
    const priorityScore = ActionHarvester.calculatePriorityScore(impact, confidence, effort);
    const dedupKey = `manual:${data.category}:${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const res = await this.pool.query(
      `INSERT INTO action_items (
        project_id, tenant_id, title, description, category, source_module,
        dedup_key, status, priority_score, impact, confidence, effort,
        owner, due_date, evidence, fix_guidance, verification_status
      ) VALUES ($1, $2, $3, $4, $5, 'manual', $6, 'todo', $7, $8, $9, $10, $11, $12, $13, $14, 'pending')
      RETURNING *`,
      [
        projectId,
        tenantId,
        data.title,
        data.description,
        data.category,
        dedupKey,
        priorityScore,
        impact,
        confidence,
        effort,
        data.owner || null,
        data.dueDate ? new Date(data.dueDate) : null,
        JSON.stringify(data.evidence || []),
        data.fixGuidance ? JSON.stringify(data.fixGuidance) : null,
      ],
    );

    return this.mapActionRow(res.rows[0]);
  }

  /**
   * Update action item details
   */
  async updateAction(
    id: string,
    projectId: string,
    tenantId: string,
    updates: {
      status?: "backlog" | "todo" | "in_progress" | "done" | "dismissed";
      dismissReason?: string;
      owner?: string;
      dueDate?: string | null;
      impact?: number;
      confidence?: number;
      effort?: "S" | "M" | "L";
    },
  ): Promise<ActionItemRecord> {
    const current = await this.getAction(id, projectId, tenantId);

    const impact = updates.impact !== undefined ? updates.impact : current.impact;
    const confidence = updates.confidence !== undefined ? updates.confidence : current.confidence;
    const effort = updates.effort !== undefined ? updates.effort : current.effort;
    const priorityScore = ActionHarvester.calculatePriorityScore(impact, confidence, effort);

    const status = updates.status || current.status;
    let verificationStatus = current.verificationStatus;
    let verificationNotes = current.verificationNotes;
    let verifiedAt = current.verifiedAt;

    // Trigger verification loop if transition to "done"
    if (status === "done" && current.status !== "done") {
      const proj = await this.pool.query(`SELECT domain FROM projects WHERE id = $1`, [projectId]);
      const domain = proj.rows[0]?.domain || "";
      const verification = await ActionVerifier.verifyAction(current, domain);
      verificationStatus = verification.status;
      verificationNotes = verification.notes;
      verifiedAt = verification.verifiedAt.toISOString();
    }

    const res = await this.pool.query(
      `UPDATE action_items
       SET status = $1, dismiss_reason = $2, owner = $3, due_date = $4,
           impact = $5, confidence = $6, effort = $7, priority_score = $8,
           verification_status = $9, verification_notes = $10, verified_at = $11,
           updated_at = NOW()
       WHERE id = $12 AND project_id = $13 AND tenant_id = $14
       RETURNING *`,
      [
        status,
        updates.dismissReason !== undefined ? updates.dismissReason : current.dismissReason,
        updates.owner !== undefined ? updates.owner : current.owner,
        updates.dueDate !== undefined
          ? updates.dueDate
            ? new Date(updates.dueDate)
            : null
          : current.dueDate,
        impact,
        confidence,
        effort,
        priorityScore,
        verificationStatus,
        verificationNotes,
        verifiedAt,
        id,
        projectId,
        tenantId,
      ],
    );

    return this.mapActionRow(res.rows[0]);
  }

  /**
   * Bulk update action items (status, owner, dismissReason)
   */
  async bulkUpdateActions(
    projectId: string,
    tenantId: string,
    payload: {
      ids: string[];
      status?: "backlog" | "todo" | "in_progress" | "done" | "dismissed";
      dismissReason?: string;
      owner?: string;
    },
  ): Promise<{ updatedCount: number }> {
    if (!payload.ids || payload.ids.length === 0) {
      return { updatedCount: 0 };
    }

    let updatedCount = 0;
    for (const id of payload.ids) {
      try {
        await this.updateAction(id, projectId, tenantId, {
          status: payload.status,
          dismissReason: payload.dismissReason,
          owner: payload.owner,
        });
        updatedCount++;
      } catch {
        // Continue processing remaining IDs
      }
    }

    return { updatedCount };
  }

  /**
   * Trigger explicit verification re-check
   */
  async verifyAction(id: string, projectId: string, tenantId: string): Promise<VerificationResult> {
    const action = await this.getAction(id, projectId, tenantId);
    const proj = await this.pool.query(`SELECT domain FROM projects WHERE id = $1`, [projectId]);
    const domain = proj.rows[0]?.domain || "";

    const result = await ActionVerifier.verifyAction(action, domain);

    await this.pool.query(
      `UPDATE action_items
       SET verification_status = $1, verification_notes = $2, verified_at = $3, updated_at = NOW()
       WHERE id = $4 AND project_id = $5 AND tenant_id = $6`,
      [result.status, result.notes, result.verifiedAt, id, projectId, tenantId],
    );

    return result;
  }

  /**
   * Add comment to an action item
   */
  async addComment(
    actionId: string,
    projectId: string,
    tenantId: string,
    userId: string | null,
    userName: string,
    body: string,
  ): Promise<ActionCommentRecord> {
    // Verify action exists
    await this.getAction(actionId, projectId, tenantId);

    const res = await this.pool.query(
      `INSERT INTO action_comments (action_id, tenant_id, user_id, user_name, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [actionId, tenantId, userId, userName, body],
    );

    return {
      id: res.rows[0].id,
      actionId: res.rows[0].action_id,
      tenantId: res.rows[0].tenant_id,
      userId: res.rows[0].user_id,
      userName: res.rows[0].user_name,
      body: res.rows[0].body,
      createdAt: res.rows[0].created_at.toISOString(),
    };
  }

  /**
   * List comments for an action item
   */
  async listComments(actionId: string, tenantId: string): Promise<ActionCommentRecord[]> {
    const res = await this.pool.query(
      `SELECT id, action_id, tenant_id, user_id, user_name, body, created_at
       FROM action_comments
       WHERE action_id = $1 AND tenant_id = $2
       ORDER BY created_at ASC`,
      [actionId, tenantId],
    );

    return res.rows.map((r) => ({
      id: r.id,
      actionId: r.action_id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      userName: r.user_name,
      body: r.body,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /**
   * Export action items as RFC 4180 CSV
   */
  async exportCsv(
    projectId: string,
    tenantId: string,
    options: {
      category?: string;
      status?: string;
    } = {},
  ): Promise<string> {
    const { items } = await this.listActions(projectId, tenantId, {
      ...options,
      limit: 1000,
      offset: 0,
    });

    const headers = [
      "ID",
      "Title",
      "Category",
      "Source Module",
      "Status",
      "Priority Score (Modeled)",
      "Impact",
      "Confidence",
      "Effort",
      "Owner",
      "Due Date",
      "Verification Status",
      "Created At",
    ];

    const escapeCsv = (val: unknown): string => {
      if (val === null || val === undefined) return '""';
      let str = String(val);
      // Escape CSV injection formula characters (=, +, -, @)
      if (/^[=+\-@]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = items.map((it) => [
      escapeCsv(it.id),
      escapeCsv(it.title),
      escapeCsv(it.category),
      escapeCsv(it.sourceModule),
      escapeCsv(it.status),
      escapeCsv(it.priorityScore),
      escapeCsv(it.impact),
      escapeCsv(it.confidence),
      escapeCsv(it.effort),
      escapeCsv(it.owner || ""),
      escapeCsv(it.dueDate || ""),
      escapeCsv(it.verificationStatus),
      escapeCsv(it.createdAt),
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
  }

  private mapActionRow(r: Record<string, unknown>): ActionItemRecord {
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      projectId: String(r.project_id),
      title: String(r.title),
      description: String(r.description),
      category: r.category as ActionItemRecord["category"],
      sourceModule: r.source_module as ActionItemRecord["sourceModule"],
      sourceId: r.source_id ? String(r.source_id) : null,
      dedupKey: String(r.dedup_key),
      status: r.status as ActionItemRecord["status"],
      dismissReason: r.dismiss_reason ? String(r.dismiss_reason) : null,
      priorityScore: Number(r.priority_score) || 0,
      impact: Number(r.impact) || 5,
      confidence: Number(r.confidence) || 0.8,
      effort: r.effort as ActionItemRecord["effort"],
      owner: r.owner ? String(r.owner) : null,
      dueDate: r.due_date ? new Date(r.due_date as string | number | Date).toISOString() : null,
      evidence: Array.isArray(r.evidence) ? (r.evidence as ActionItemRecord["evidence"]) : [],
      fixGuidance: (r.fix_guidance as FixGuidance) || null,
      verificationStatus:
        (r.verification_status as ActionItemRecord["verificationStatus"]) || "pending",
      verificationNotes: r.verification_notes ? String(r.verification_notes) : null,
      verifiedAt: r.verified_at
        ? new Date(r.verified_at as string | number | Date).toISOString()
        : null,
      createdAt: r.created_at
        ? new Date(r.created_at as string | number | Date).toISOString()
        : new Date().toISOString(),
      updatedAt: r.updated_at
        ? new Date(r.updated_at as string | number | Date).toISOString()
        : new Date().toISOString(),
    };
  }
}
