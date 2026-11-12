import type { Pool } from "pg";
import { ApiError } from "../../utils/ApiError.js";

export type CreditCategory = "monitoring" | "crawl";

export type LedgerEntryType =
  | "plan_allocation"
  | "credit_topup"
  | "monitoring_run"
  | "crawl_page"
  | "operator_adjustment"
  | "refund";

export interface CreditBalances {
  monitoring: {
    available: number;
    reserved: number;
    used: number;
  };
  crawl: {
    available: number;
    used: number;
  };
}

export interface CreditLedgerRecord {
  id: string;
  tenantId: string;
  entryType: LedgerEntryType;
  category: CreditCategory;
  amount: number;
  balanceAfter: number;
  referenceId?: string | null;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export class CreditLedgerService {
  constructor(private pool: Pool) {}

  /**
   * Retrieves current credit balances for both monitoring runs and website crawls
   */
  async getBalances(tenantId: string): Promise<CreditBalances> {
    const [monRes, crawlRes] = await Promise.all([
      this.pool.query(
        `SELECT available, reserved, used FROM monitoring_credits WHERE tenant_id = $1`,
        [tenantId],
      ),
      this.pool.query(`SELECT available, used FROM crawl_credits WHERE tenant_id = $1`, [tenantId]),
    ]);

    const mon = monRes.rows[0] || { available: 0, reserved: 0, used: 0 };
    const crawl = crawlRes.rows[0] || { available: 500, used: 0 };

    return {
      monitoring: {
        available: Number(mon.available),
        reserved: Number(mon.reserved),
        used: Number(mon.used),
      },
      crawl: {
        available: Number(crawl.available),
        used: Number(crawl.used),
      },
    };
  }

  /**
   * Atomically deducts monitoring run credit (1 run = 1 credit)
   * Enforces ADM-FR-002
   */
  async deductMonitoringRun(
    tenantId: string,
    runId: string,
    count = 1,
    metadata: Record<string, unknown> = {},
  ): Promise<{ balanceAfter: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const res = await client.query(
        `SELECT available, used FROM monitoring_credits WHERE tenant_id = $1 FOR UPDATE`,
        [tenantId],
      );

      if (res.rowCount === 0) {
        throw new ApiError(402, "Credit balance not initialized for tenant", "CREDITS_EXHAUSTED");
      }

      const available = Number(res.rows[0].available);
      if (available < count) {
        throw new ApiError(
          402,
          `Insufficient monitoring credits: available ${available}, requested ${count}`,
          "CREDITS_EXHAUSTED",
        );
      }

      const newAvailable = available - count;
      const newUsed = Number(res.rows[0].used) + count;

      await client.query(
        `UPDATE monitoring_credits SET available = $1, used = $2 WHERE tenant_id = $3`,
        [newAvailable, newUsed, tenantId],
      );

      await client.query(
        `INSERT INTO credit_ledger_entries (
          tenant_id, entry_type, category, amount, balance_after, reference_id, description, metadata
        ) VALUES ($1, 'monitoring_run', 'monitoring', $2, $3, $4, $5, $6)`,
        [
          tenantId,
          -count,
          newAvailable,
          runId,
          `Execution of monitoring run ${runId}`,
          JSON.stringify(metadata),
        ],
      );

      await client.query("COMMIT");
      return { balanceAfter: newAvailable };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically deducts crawl page credit (1 crawled page = 1 crawl credit)
   * Enforces ADM-FR-003 separate metering for crawls
   */
  async deductCrawlPage(
    tenantId: string,
    auditId: string,
    pageUrl: string,
    count = 1,
  ): Promise<{ balanceAfter: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Ensure crawl_credits record exists
      await client.query(
        `INSERT INTO crawl_credits (tenant_id, available, used)
         VALUES ($1, 500, 0)
         ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId],
      );

      const res = await client.query(
        `SELECT available, used FROM crawl_credits WHERE tenant_id = $1 FOR UPDATE`,
        [tenantId],
      );

      const available = Number(res.rows[0].available);
      if (available < count) {
        throw new ApiError(
          402,
          `Insufficient crawl credits: available ${available}, requested ${count}`,
          "CRAWL_CREDITS_EXHAUSTED",
        );
      }

      const newAvailable = available - count;
      const newUsed = Number(res.rows[0].used) + count;

      await client.query(
        `UPDATE crawl_credits SET available = $1, used = $2, updated_at = NOW() WHERE tenant_id = $3`,
        [newAvailable, newUsed, tenantId],
      );

      await client.query(
        `INSERT INTO credit_ledger_entries (
          tenant_id, entry_type, category, amount, balance_after, reference_id, description, metadata
        ) VALUES ($1, 'crawl_page', 'crawl', $2, $3, $4, $5, $6)`,
        [
          tenantId,
          -count,
          newAvailable,
          auditId,
          `Crawled technical audit page: ${pageUrl}`,
          JSON.stringify({ auditId, pageUrl }),
        ],
      );

      await client.query("COMMIT");
      return { balanceAfter: newAvailable };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically grants credits to a tenant (e.g. Plan Allocation, Top-up, Operator Adjustment, Refund)
   */
  async grantCredits(params: {
    tenantId: string;
    category: CreditCategory;
    amount: number;
    entryType: LedgerEntryType;
    description: string;
    referenceId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ balanceAfter: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      let balanceAfter = 0;

      if (params.category === "monitoring") {
        await client.query(
          `INSERT INTO monitoring_credits (tenant_id, available, reserved, used)
           VALUES ($1, $2, 0, 0)
           ON CONFLICT (tenant_id) DO UPDATE SET available = monitoring_credits.available + $2`,
          [params.tenantId, params.amount],
        );

        const res = await client.query(
          `SELECT available FROM monitoring_credits WHERE tenant_id = $1`,
          [params.tenantId],
        );
        balanceAfter = Number(res.rows[0]?.available ?? params.amount);
      } else {
        await client.query(
          `INSERT INTO crawl_credits (tenant_id, available, used)
           VALUES ($1, $2, 0)
           ON CONFLICT (tenant_id) DO UPDATE SET available = crawl_credits.available + $2`,
          [params.tenantId, params.amount],
        );

        const res = await client.query(`SELECT available FROM crawl_credits WHERE tenant_id = $1`, [
          params.tenantId,
        ]);
        balanceAfter = Number(res.rows[0]?.available ?? params.amount);
      }

      await client.query(
        `INSERT INTO credit_ledger_entries (
          tenant_id, entry_type, category, amount, balance_after, reference_id, description, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          params.tenantId,
          params.entryType,
          params.category,
          params.amount,
          balanceAfter,
          params.referenceId || null,
          params.description,
          JSON.stringify(params.metadata || {}),
        ],
      );

      await client.query("COMMIT");
      return { balanceAfter };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Query credit ledger history with pagination and category filtering
   */
  async getLedgerHistory(
    tenantId: string,
    options: { limit?: number; offset?: number; category?: CreditCategory } = {},
  ): Promise<CreditLedgerRecord[]> {
    const limit = Math.min(100, Math.max(1, options.limit || 50));
    const offset = Math.max(0, options.offset || 0);

    const values: unknown[] = [tenantId, limit, offset];
    let query = `SELECT * FROM credit_ledger_entries WHERE tenant_id = $1`;

    if (options.category) {
      values.push(options.category);
      query += ` AND category = $4`;
    }

    query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;

    const res = await this.pool.query(query, values);
    return res.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      entryType: row.entry_type,
      category: row.category,
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      referenceId: row.reference_id,
      description: row.description,
      metadata: row.metadata,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}
