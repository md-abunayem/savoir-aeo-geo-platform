/**
 * Integrations Service (M14 / ITG-FR-001 to ITG-FR-012)
 * Manages OAuth connections (GSC, GA4), automated syncs, API keys, and outbound webhooks.
 */

import type { Pool } from "pg";
import { TokenCrypto } from "./token-crypto.js";
import { GscAnalyzer } from "./gsc-analyzer.js";
import { AiReferrerClassifier } from "./ai-referrer-classifier.js";
import { ApiError } from "../../utils/ApiError.js";
import type { GoogleSync } from "./google-sync.js";
import { deliverWebhook } from "./webhook-delivery.js";

export interface IntegrationConnectionRecord {
  id: string;
  tenantId: string;
  projectId: string;
  provider: "google_search_console" | "google_analytics_4" | "slack" | "hubspot";
  status: "connected" | "paused" | "error" | "disconnected";
  accountEmail?: string | null;
  propertyId?: string | null;
  propertyName?: string | null;
  scopesGranted: string[];
  lastSyncAt?: string | null;
  lastSyncStatus: "pending" | "success" | "failed";
  lastSyncError?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TenantApiKeyRecord {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  secretKey?: string; // only returned upon initial creation
  scopes: string[];
  rateLimitRpm: number;
  rateLimitBurst: number;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export interface WebhookEndpointRecord {
  id: string;
  tenantId: string;
  projectId: string;
  url: string;
  description?: string | null;
  secret: string;
  events: string[];
  isActive: boolean;
  failureCount: number;
  lastDispatchedAt?: string | null;
  lastResponseCode?: number | null;
  createdAt: string;
  updatedAt: string;
}

export class IntegrationsService {
  constructor(
    private readonly pool: Pool,
    private readonly allowSampleData = false,
    private readonly google?: GoogleSync,
    private readonly tokenKey?: Buffer,
  ) {}

  /**
   * List configured integration connections
   */
  async listConnections(
    projectId: string,
    tenantId: string,
  ): Promise<IntegrationConnectionRecord[]> {
    const res = await this.pool.query(
      `SELECT id, tenant_id, project_id, provider, status, account_email,
              property_id, property_name, scopes_granted, last_sync_at,
              last_sync_status, last_sync_error, metadata, created_at, updated_at
       FROM integration_connections
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC`,
      [projectId, tenantId],
    );

    return res.rows.map(this.mapConnectionRow);
  }

  /**
   * Connect or update a provider OAuth connection
   */
  async connectProvider(
    projectId: string,
    tenantId: string,
    payload: {
      provider: "google_search_console" | "google_analytics_4" | "slack" | "hubspot";
      accountEmail?: string;
      propertyId?: string;
      propertyName?: string;
      scopesGranted?: string[];
      tokens?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    },
  ): Promise<IntegrationConnectionRecord> {
    if (this.google && (!payload.tokens?.access_token || !payload.propertyId?.trim())) {
      throw new ApiError(
        400,
        "A Google access token and property ID are required",
        "GOOGLE_CREDENTIALS_REQUIRED",
      );
    }
    const encryptedTokens = payload.tokens
      ? TokenCrypto.encrypt(payload.tokens, this.tokenKey)
      : null;
    const scopes = payload.scopesGranted || [];
    const meta = payload.metadata || {};

    // Check existing connection for provider
    const existing = await this.pool.query(
      `SELECT id FROM integration_connections
       WHERE project_id = $1 AND tenant_id = $2 AND provider = $3
       LIMIT 1`,
      [projectId, tenantId, payload.provider],
    );

    let res;
    if (existing.rows.length > 0) {
      res = await this.pool.query(
        `UPDATE integration_connections
         SET status = 'connected',
             account_email = COALESCE($1, account_email),
             property_id = COALESCE($2, property_id),
             property_name = COALESCE($3, property_name),
             scopes_granted = $4,
             encrypted_tokens = COALESCE($5, encrypted_tokens),
             metadata = $6,
             last_sync_status = 'pending',
             updated_at = NOW()
         WHERE id = $7 AND tenant_id = $8
         RETURNING *`,
        [
          payload.accountEmail || null,
          payload.propertyId || null,
          payload.propertyName || null,
          JSON.stringify(scopes),
          encryptedTokens,
          JSON.stringify(meta),
          existing.rows[0].id,
          tenantId,
        ],
      );
    } else {
      res = await this.pool.query(
        `INSERT INTO integration_connections (
          project_id, tenant_id, provider, status, account_email,
          property_id, property_name, scopes_granted, encrypted_tokens,
          metadata, last_sync_status
        ) VALUES ($1, $2, $3, 'connected', $4, $5, $6, $7, $8, $9, 'pending')
        RETURNING *`,
        [
          projectId,
          tenantId,
          payload.provider,
          payload.accountEmail || null,
          payload.propertyId || null,
          payload.propertyName || null,
          JSON.stringify(scopes),
          encryptedTokens,
          JSON.stringify(meta),
        ],
      );
    }

    const connection = this.mapConnectionRow(res.rows[0]);

    // Sync is explicit so the caller can show its result and retry failures.

    return connection;
  }

  /**
   * Disconnect integration and optionally purge imported facts (ITG-FR-010)
   */
  async disconnectProvider(
    connectionId: string,
    projectId: string,
    tenantId: string,
    purgeData = false,
  ): Promise<{ success: boolean; purged: boolean }> {
    const conn = await this.pool.query(
      `SELECT id, provider FROM integration_connections
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
      [connectionId, projectId, tenantId],
    );

    if (conn.rows.length === 0) {
      throw new ApiError(404, "Connection not found");
    }

    const { provider } = conn.rows[0];

    // Remove or mark disconnected
    await this.pool.query(`DELETE FROM integration_connections WHERE id = $1 AND tenant_id = $2`, [
      connectionId,
      tenantId,
    ]);

    if (purgeData) {
      if (provider === "google_search_console") {
        await this.pool.query(
          `DELETE FROM gsc_performance_facts WHERE project_id = $1 AND tenant_id = $2`,
          [projectId, tenantId],
        );
      } else if (provider === "google_analytics_4") {
        await this.pool.query(
          `DELETE FROM traffic_analytics_facts WHERE project_id = $1 AND tenant_id = $2`,
          [projectId, tenantId],
        );
      }
    }

    return { success: true, purged: purgeData };
  }

  /**
   * Sync Google Search Console facts (ITG-FR-001, ITG-F1)
   */
  async syncGsc(
    projectId: string,
    tenantId: string,
    connectionId: string,
  ): Promise<{ syncedCount: number; questionsCount: number }> {
    if (this.google)
      return this.google.sync(projectId, tenantId, connectionId, "google_search_console");
    if (!this.allowSampleData) {
      throw new ApiError(
        501,
        "Live Google Search Console sync is not implemented; sample data is disabled",
        "LIVE_SYNC_UNAVAILABLE",
      );
    }
    const projRes = await this.pool.query(
      `SELECT domain, name FROM projects WHERE id = $1 AND tenant_id = $2`,
      [projectId, tenantId],
    );
    if (projRes.rows.length === 0) throw new ApiError(404, "Project not found");
    const { domain, name } = projRes.rows[0];
    const brand = name || domain;

    // Generate or fetch query performance facts
    const sampleQueries = [
      {
        q: `how to use ${brand} for search intelligence`,
        page: `https://${domain}/docs/start`,
        imp: 1420,
        clk: 240,
        pos: 2.4,
      },
      {
        q: `what is ${brand} pricing`,
        page: `https://${domain}/pricing`,
        imp: 3800,
        clk: 410,
        pos: 1.8,
      },
      {
        q: `is ${brand} better than competitors`,
        page: `https://${domain}/compare`,
        imp: 2100,
        clk: 180,
        pos: 4.1,
      },
      {
        q: `${brand} vs alternative tools`,
        page: `https://${domain}/alternatives`,
        imp: 1950,
        clk: 155,
        pos: 3.9,
      },
      {
        q: `best aeo platform for ai search visibility`,
        page: `https://${domain}/features`,
        imp: 5400,
        clk: 320,
        pos: 5.2,
      },
      {
        q: `how does gemini search grounding cite sources`,
        page: `https://${domain}/blog/gemini-grounding`,
        imp: 4200,
        clk: 290,
        pos: 3.1,
      },
      { q: `${brand} login`, page: `https://${domain}/login`, imp: 2800, clk: 1200, pos: 1.0 },
      {
        q: `what are the top aeo strategies in 2026`,
        page: `https://${domain}/guide/aeo-strategy`,
        imp: 6100,
        clk: 480,
        pos: 4.8,
      },
    ];

    const todayStr = new Date().toISOString().slice(0, 10);
    let syncedCount = 0;
    let questionsCount = 0;

    for (const item of sampleQueries) {
      const isQuestion = GscAnalyzer.isQuestionQuery(item.q);
      if (isQuestion) questionsCount++;
      const ctr = (item.clk / Math.max(1, item.imp)).toFixed(4);

      await this.pool.query(
        `INSERT INTO gsc_performance_facts (
          project_id, tenant_id, query, page, date, device, country,
          impressions, clicks, ctr, position, is_question_query
        ) VALUES ($1, $2, $3, $4, $5, 'DESKTOP', 'usa', $6, $7, $8, $9, $10)`,
        [
          projectId,
          tenantId,
          item.q,
          item.page,
          todayStr,
          item.imp,
          item.clk,
          ctr,
          item.pos,
          isQuestion,
        ],
      );
      syncedCount++;
    }

    await this.pool.query(
      `UPDATE integration_connections
       SET last_sync_at = NOW(), last_sync_status = 'success', last_sync_error = NULL
       WHERE id = $1 AND tenant_id = $2`,
      [connectionId, tenantId],
    );

    return { syncedCount, questionsCount };
  }

  /**
   * Sync GA4 Traffic Facts & classify AI referrers (ITG-FR-002, TRF-FR-001, TRF-FR-002)
   */
  async syncGa4(
    projectId: string,
    tenantId: string,
    connectionId: string,
  ): Promise<{ totalSessions: number; aiSessions: number }> {
    if (this.google)
      return this.google.sync(projectId, tenantId, connectionId, "google_analytics_4");
    if (!this.allowSampleData) {
      throw new ApiError(
        501,
        "Live Google Analytics sync is not implemented; sample data is disabled",
        "LIVE_SYNC_UNAVAILABLE",
      );
    }
    const projRes = await this.pool.query(
      `SELECT domain FROM projects WHERE id = $1 AND tenant_id = $2`,
      [projectId, tenantId],
    );
    if (projRes.rows.length === 0) throw new ApiError(404, "Project not found");
    const { domain } = projRes.rows[0];

    const sampleTraffic = [
      {
        src: "chatgpt.com",
        med: "referral",
        path: `https://${domain}/pricing`,
        sess: 380,
        eng: 310,
        usr: 340,
        conv: 24,
        rev: 4800,
      },
      {
        src: "chatgpt.com",
        med: "referral",
        path: `https://${domain}/features`,
        sess: 290,
        eng: 230,
        usr: 260,
        conv: 16,
        rev: 3200,
      },
      {
        src: "gemini.google.com",
        med: "referral",
        path: `https://${domain}/guide/aeo-strategy`,
        sess: 220,
        eng: 180,
        usr: 195,
        conv: 12,
        rev: 2400,
      },
      {
        src: "perplexity.ai",
        med: "referral",
        path: `https://${domain}/compare`,
        sess: 190,
        eng: 165,
        usr: 175,
        conv: 18,
        rev: 3600,
      },
      {
        src: "claude.ai",
        med: "referral",
        path: `https://${domain}/docs/start`,
        sess: 110,
        eng: 95,
        usr: 100,
        conv: 8,
        rev: 1600,
      },
      {
        src: "copilot.microsoft.com",
        med: "referral",
        path: `https://${domain}/`,
        sess: 95,
        eng: 70,
        usr: 85,
        conv: 5,
        rev: 1000,
      },
      {
        src: "google",
        med: "organic",
        path: `https://${domain}/`,
        sess: 1850,
        eng: 1200,
        usr: 1600,
        conv: 55,
        rev: 11000,
      },
      {
        src: "(direct)",
        med: "(none)",
        path: `https://${domain}/`,
        sess: 1400,
        eng: 950,
        usr: 1250,
        conv: 42,
        rev: 8400,
      },
    ];

    const todayStr = new Date().toISOString().slice(0, 10);
    let totalSessions = 0;
    let aiSessions = 0;

    for (const t of sampleTraffic) {
      const classified = AiReferrerClassifier.classify(t.src, t.med);
      totalSessions += t.sess;
      if (classified.isAiReferral) {
        aiSessions += t.sess;
      }

      await this.pool.query(
        `INSERT INTO traffic_analytics_facts (
          project_id, tenant_id, date, source, medium, landing_page,
          is_ai_referral, ai_engine, sessions, engaged_sessions, users,
          conversions, revenue
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          projectId,
          tenantId,
          todayStr,
          t.src,
          t.med,
          t.path,
          classified.isAiReferral,
          classified.aiEngine || null,
          t.sess,
          t.eng,
          t.usr,
          t.conv,
          t.rev,
        ],
      );
    }

    await this.pool.query(
      `UPDATE integration_connections
       SET last_sync_at = NOW(), last_sync_status = 'success', last_sync_error = NULL
       WHERE id = $1 AND tenant_id = $2`,
      [connectionId, tenantId],
    );

    return { totalSessions, aiSessions };
  }

  /**
   * Create public API key for tenant (ITG-FR-005, ITG-FR-012)
   */
  async createApiKey(
    projectId: string,
    tenantId: string,
    name: string,
    scopes: string[] = ["read"],
    rateLimitRpm = 60,
  ): Promise<TenantApiKeyRecord> {
    const { secretKey, keyPrefix, keyHash } = TokenCrypto.generateApiKey();

    const res = await this.pool.query(
      `INSERT INTO tenant_api_keys (
        project_id, tenant_id, name, key_prefix, key_hash, scopes,
        rate_limit_rpm, rate_limit_burst
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, tenant_id, project_id, name, key_prefix, scopes,
                rate_limit_rpm, rate_limit_burst, last_used_at, revoked_at,
                expires_at, created_at`,
      [
        projectId,
        tenantId,
        name,
        keyPrefix,
        keyHash,
        JSON.stringify(scopes),
        rateLimitRpm,
        rateLimitRpm * 2,
      ],
    );

    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      projectId: r.project_id,
      name: r.name,
      keyPrefix: r.key_prefix,
      secretKey, // only visible upon generation
      scopes: Array.isArray(r.scopes) ? r.scopes : [],
      rateLimitRpm: r.rate_limit_rpm,
      rateLimitBurst: r.rate_limit_burst,
      lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  /**
   * List API keys
   */
  async listApiKeys(projectId: string, tenantId: string): Promise<TenantApiKeyRecord[]> {
    const res = await this.pool.query(
      `SELECT id, tenant_id, project_id, name, key_prefix, scopes,
              rate_limit_rpm, rate_limit_burst, last_used_at, revoked_at,
              expires_at, created_at
       FROM tenant_api_keys
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC`,
      [projectId, tenantId],
    );

    return res.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      projectId: r.project_id,
      name: r.name,
      keyPrefix: r.key_prefix,
      scopes: Array.isArray(r.scopes) ? r.scopes : [],
      rateLimitRpm: r.rate_limit_rpm,
      rateLimitBurst: r.rate_limit_burst,
      lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(
    keyId: string,
    projectId: string,
    tenantId: string,
  ): Promise<{ revoked: boolean }> {
    const res = await this.pool.query(
      `UPDATE tenant_api_keys
       SET revoked_at = NOW()
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3
       RETURNING id`,
      [keyId, projectId, tenantId],
    );

    if (res.rows.length === 0) throw new ApiError(404, "API key not found");
    return { revoked: true };
  }

  /**
   * Register outbound webhook endpoint (ITG-FR-006)
   */
  async createWebhook(
    projectId: string,
    tenantId: string,
    url: string,
    events: string[] = ["run.completed", "action.verified"],
    description?: string,
  ): Promise<WebhookEndpointRecord> {
    const secret = TokenCrypto.generateWebhookSecret();

    const res = await this.pool.query(
      `INSERT INTO webhook_endpoints (
        project_id, tenant_id, url, description, secret, events, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING *`,
      [projectId, tenantId, url, description || null, secret, JSON.stringify(events)],
    );

    return this.mapWebhookRow(res.rows[0]);
  }

  /**
   * List webhook endpoints
   */
  async listWebhooks(projectId: string, tenantId: string): Promise<WebhookEndpointRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM webhook_endpoints
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC`,
      [projectId, tenantId],
    );

    return res.rows.map(this.mapWebhookRow);
  }

  /**
   * Delete webhook endpoint
   */
  async deleteWebhook(
    webhookId: string,
    projectId: string,
    tenantId: string,
  ): Promise<{ deleted: boolean }> {
    const res = await this.pool.query(
      `DELETE FROM webhook_endpoints
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3
       RETURNING id`,
      [webhookId, projectId, tenantId],
    );

    if (res.rows.length === 0) throw new ApiError(404, "Webhook not found");
    return { deleted: true };
  }

  /**
   * Deliver a signed test payload and record the actual HTTP response.
   */
  async testDispatchWebhook(
    webhookId: string,
    projectId: string,
    tenantId: string,
  ): Promise<{ delivered: boolean; signatureHeader: string; timestamp: number }> {
    const res = await this.pool.query(
      `SELECT secret, url FROM webhook_endpoints
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
      [webhookId, projectId, tenantId],
    );

    if (res.rows.length === 0) throw new ApiError(404, "Webhook not found");
    const { secret, url } = res.rows[0];

    const timestamp = Math.floor(Date.now() / 1000);
    const testPayload = JSON.stringify({
      event: "test.ping",
      timestamp,
      data: {
        message: "Webhook configuration verified successfully",
        projectId,
      },
    });

    const signatureHeader = TokenCrypto.signWebhookPayload(secret, timestamp, testPayload);

    const status = await deliverWebhook(url, testPayload, signatureHeader);
    await this.pool.query(
      `UPDATE webhook_endpoints
       SET last_dispatched_at = NOW(), last_response_code = $2,
           failure_count = CASE WHEN $2 BETWEEN 200 AND 299 THEN 0 ELSE failure_count + 1 END
       WHERE id = $1 AND tenant_id = $3 AND project_id = $4`,
      [webhookId, status, tenantId, projectId],
    );

    if (status < 200 || status >= 300)
      throw new ApiError(
        502,
        `Webhook endpoint returned HTTP ${status}`,
        "WEBHOOK_DELIVERY_FAILED",
      );

    return {
      delivered: true,
      signatureHeader,
      timestamp,
    };
  }

  private mapConnectionRow(r: Record<string, unknown>): IntegrationConnectionRecord {
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      projectId: String(r.project_id),
      provider: r.provider as IntegrationConnectionRecord["provider"],
      status: r.status as IntegrationConnectionRecord["status"],
      accountEmail: r.account_email ? String(r.account_email) : null,
      propertyId: r.property_id ? String(r.property_id) : null,
      propertyName: r.property_name ? String(r.property_name) : null,
      scopesGranted: Array.isArray(r.scopes_granted) ? (r.scopes_granted as string[]) : [],
      lastSyncAt: r.last_sync_at
        ? new Date(r.last_sync_at as string | number | Date).toISOString()
        : null,
      lastSyncStatus:
        (r.last_sync_status as IntegrationConnectionRecord["lastSyncStatus"]) || "pending",
      lastSyncError: r.last_sync_error ? String(r.last_sync_error) : null,
      metadata: (r.metadata as Record<string, unknown>) || {},
      createdAt: r.created_at
        ? new Date(r.created_at as string | number | Date).toISOString()
        : new Date().toISOString(),
      updatedAt: r.updated_at
        ? new Date(r.updated_at as string | number | Date).toISOString()
        : new Date().toISOString(),
    };
  }

  private mapWebhookRow(r: Record<string, unknown>): WebhookEndpointRecord {
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      projectId: String(r.project_id),
      url: String(r.url),
      description: r.description ? String(r.description) : null,
      secret: String(r.secret),
      events: Array.isArray(r.events) ? (r.events as string[]) : [],
      isActive: Boolean(r.is_active),
      failureCount: Number(r.failure_count) || 0,
      lastDispatchedAt: r.last_dispatched_at
        ? new Date(r.last_dispatched_at as string | number | Date).toISOString()
        : null,
      lastResponseCode: r.last_response_code ? Number(r.last_response_code) : null,
      createdAt: r.created_at
        ? new Date(r.created_at as string | number | Date).toISOString()
        : new Date().toISOString(),
      updatedAt: r.updated_at
        ? new Date(r.updated_at as string | number | Date).toISOString()
        : new Date().toISOString(),
    };
  }
}
