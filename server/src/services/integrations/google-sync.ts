import type { Pool } from "pg";
import { z } from "zod";
import { withTenantClient } from "../../db/tenant.js";
import { getRequestTenantContext } from "../../db/tenant-query.js";
import { ApiError } from "../../utils/ApiError.js";
import { TokenCrypto } from "./token-crypto.js";
import { GscAnalyzer } from "./gsc-analyzer.js";
import { AiReferrerClassifier } from "./ai-referrer-classifier.js";

const gscResponse = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()).length(5),
        clicks: z.number().nonnegative(),
        impressions: z.number().nonnegative(),
        ctr: z.number().min(0).max(1),
        position: z.number().nonnegative(),
      }),
    )
    .default([]),
});
const gaResponse = z.object({
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string() })).length(4),
        metricValues: z
          .array(z.object({ value: z.string().refine((v) => Number.isFinite(Number(v))) }))
          .length(6),
      }),
    )
    .default([]),
  rowCount: z.number().int().nonnegative().default(0),
});

/** Imports a bounded 30-day snapshot atomically. Credentials never leave Google's fixed hosts. */
export class GoogleSync {
  constructor(
    private pool: Pool,
    private key: Buffer,
    private oauth: { clientId?: string; clientSecret?: string } = {},
    private fetcher: typeof fetch = fetch,
  ) {}

  async sync(
    projectId: string,
    tenantId: string,
    connectionId: string,
    provider: "google_search_console" | "google_analytics_4",
  ) {
    const context = getRequestTenantContext();
    if (context.tenantId !== tenantId) throw new ApiError(404, "Connection not found");
    try {
      return await withTenantClient(this.pool, context, async (client) => {
        const result = await client.query(
          `SELECT property_id, encrypted_tokens FROM integration_connections
          WHERE id=$1 AND project_id=$2 AND tenant_id=$3 AND provider=$4 AND status='connected' FOR UPDATE NOWAIT`,
          [connectionId, projectId, tenantId, provider],
        );
        const connection = result.rows[0];
        if (!connection) throw new ApiError(404, "Connected integration not found");
        if (!connection.encrypted_tokens || !connection.property_id)
          throw new ApiError(
            400,
            "Reconnect with a property and Google access token",
            "GOOGLE_CREDENTIALS_REQUIRED",
          );
        let tokens: { access_token?: string; refresh_token?: string; expires_at?: number };
        try {
          tokens = TokenCrypto.decrypt(connection.encrypted_tokens, this.key);
        } catch {
          throw new ApiError(
            400,
            "Reconnect this integration to update its credentials",
            "GOOGLE_RECONNECT_REQUIRED",
          );
        }
        const signal = AbortSignal.timeout(60000);
        const send = async (url: string, body: unknown) =>
          this.fetcher(url, {
            method: "POST",
            redirect: "error",
            signal,
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
        let refreshed = false;
        const refresh = async () => {
          if (!tokens.refresh_token || !this.oauth.clientId || !this.oauth.clientSecret) {
            throw new ApiError(
              400,
              "Google access expired. Reconnect with a valid access token.",
              "GOOGLE_RECONNECT_REQUIRED",
            );
          }
          const response = await this.fetcher("https://oauth2.googleapis.com/token", {
            method: "POST",
            redirect: "error",
            signal,
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: tokens.refresh_token,
              client_id: this.oauth.clientId,
              client_secret: this.oauth.clientSecret,
            }),
          });
          if (!response.ok)
            throw new ApiError(
              400,
              "Google authorization expired. Reconnect this integration.",
              "GOOGLE_RECONNECT_REQUIRED",
            );
          const data = z
            .object({ access_token: z.string().min(1), expires_in: z.number().positive() })
            .parse(await response.json());
          tokens = {
            ...tokens,
            access_token: data.access_token,
            expires_at: Date.now() + data.expires_in * 1000,
          };
          refreshed = true;
          await client.query(
            "UPDATE integration_connections SET encrypted_tokens=$1 WHERE id=$2 AND tenant_id=$3",
            [TokenCrypto.encrypt(tokens, this.key), connectionId, tenantId],
          );
        };
        if (!tokens.access_token || (tokens.expires_at && tokens.expires_at <= Date.now()))
          await refresh();
        const request = async (url: string, body: unknown) => {
          let response = await send(url, body);
          if (response.status === 401 && !refreshed) {
            await refresh();
            response = await send(url, body);
          }
          if (!response.ok)
            throw new ApiError(
              502,
              `Google sync failed (HTTP ${response.status}). Check property access and API quota.`,
              "GOOGLE_SYNC_FAILED",
            );
          return response.json();
        };
        const end = new Date();
        end.setUTCDate(end.getUTCDate() - 1);
        const start = new Date(end);
        start.setUTCDate(start.getUTCDate() - 29);
        const startDate = start.toISOString().slice(0, 10),
          endDate = end.toISOString().slice(0, 10);
        let syncedCount = 0,
          questionsCount = 0,
          totalSessions = 0,
          aiSessions = 0;
        if (provider === "google_search_console") {
          const rows: z.infer<typeof gscResponse>["rows"] = [];
          for (let offset = 0; ; offset += 25000) {
            if (offset >= 100000)
              throw new ApiError(
                422,
                "This property exceeds the 100,000-row sync limit",
                "SYNC_TOO_LARGE",
              );
            const data = gscResponse.parse(
              await request(
                `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(connection.property_id)}/searchAnalytics/query`,
                {
                  startDate,
                  endDate,
                  dimensions: ["query", "page", "date", "device", "country"],
                  rowLimit: 25000,
                  startRow: offset,
                  dataState: "final",
                },
              ),
            );
            rows.push(...data.rows);
            if (data.rows.length < 25000) break;
          }
          await client.query(
            "DELETE FROM gsc_performance_facts WHERE project_id=$1 AND tenant_id=$2 AND date BETWEEN $3 AND $4",
            [projectId, tenantId, startDate, endDate],
          );
          const facts = rows.map((row) => {
            const question = GscAnalyzer.isQuestionQuery(row.keys[0]);
            if (question) questionsCount++;
            return {
              query: row.keys[0],
              page: row.keys[1],
              date: row.keys[2],
              device: row.keys[3],
              country: row.keys[4],
              clicks: row.clicks,
              impressions: row.impressions,
              ctr: row.ctr,
              position: row.position,
              question,
            };
          });
          await client.query(
            `INSERT INTO gsc_performance_facts (project_id,tenant_id,query,page,date,device,country,clicks,impressions,ctr,position,is_question_query)
            SELECT $1,$2,x.query,x.page,x.date,x.device,x.country,x.clicks,x.impressions,x.ctr,x.position,x.question FROM jsonb_to_recordset($3::jsonb)
            AS x(query text,page text,date text,device text,country text,clicks integer,impressions integer,ctr numeric,position numeric,question boolean)`,
            [projectId, tenantId, JSON.stringify(facts)],
          );
          syncedCount = rows.length;
        } else {
          const propertyId = String(connection.property_id).replace(/^properties\//, "");
          if (!/^\d+$/.test(propertyId))
            throw new ApiError(400, "Use a numeric GA4 property ID", "INVALID_PROPERTY");
          const rows: z.infer<typeof gaResponse>["rows"] = [];
          for (let offset = 0; ; offset += 10000) {
            const data = gaResponse.parse(
              await request(
                `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
                {
                  dateRanges: [{ startDate, endDate }],
                  dimensions: [
                    "date",
                    "sessionSource",
                    "sessionMedium",
                    "landingPagePlusQueryString",
                  ].map((name) => ({ name })),
                  metrics: [
                    "sessions",
                    "engagedSessions",
                    "totalUsers",
                    "keyEvents",
                    "totalRevenue",
                    "screenPageViews",
                  ].map((name) => ({ name })),
                  limit: "10000",
                  offset: String(offset),
                },
              ),
            );
            if (data.rowCount > 100000)
              throw new ApiError(
                422,
                "This property exceeds the 100,000-row sync limit",
                "SYNC_TOO_LARGE",
              );
            rows.push(...data.rows);
            if (rows.length >= data.rowCount) break;
            if (!data.rows.length || offset >= 90000)
              throw new ApiError(502, "Google returned an incomplete report", "GOOGLE_SYNC_FAILED");
          }
          const facts = rows.map((row) => {
            const [date, source, medium, page] = row.dimensionValues.map((v) => v.value);
            const [sessions, engaged, users, conversions, revenue] = row.metricValues.map((v) =>
              Number(v.value),
            );
            if (!/^\d{8}$/.test(date))
              throw new ApiError(502, "Invalid Google report date", "GOOGLE_SYNC_FAILED");
            const classification = AiReferrerClassifier.classify(source, medium);
            totalSessions += sessions;
            if (classification.isAiReferral) aiSessions += sessions;
            return {
              date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`,
              source,
              medium,
              page,
              sessions,
              engaged,
              users,
              conversions: Math.round(conversions),
              revenue,
              ai: classification.isAiReferral,
              engine: classification.aiEngine ?? null,
            };
          });
          await client.query(
            "DELETE FROM traffic_analytics_facts WHERE project_id=$1 AND tenant_id=$2 AND date BETWEEN $3 AND $4",
            [projectId, tenantId, startDate, endDate],
          );
          await client.query(
            `INSERT INTO traffic_analytics_facts (project_id,tenant_id,date,source,medium,landing_page,sessions,engaged_sessions,users,conversions,revenue,is_ai_referral,ai_engine)
            SELECT $1,$2,x.date,x.source,x.medium,x.page,x.sessions,x.engaged,x.users,x.conversions,x.revenue,x.ai,x.engine FROM jsonb_to_recordset($3::jsonb)
            AS x(date text,source text,medium text,page text,sessions integer,engaged integer,users integer,conversions integer,revenue numeric,ai boolean,engine text)`,
            [projectId, tenantId, JSON.stringify(facts)],
          );
        }
        await client.query(
          "UPDATE integration_connections SET last_sync_at=NOW(), last_sync_status='success', last_sync_error=NULL, updated_at=NOW() WHERE id=$1 AND tenant_id=$2",
          [connectionId, tenantId],
        );
        return { syncedCount, questionsCount, totalSessions, aiSessions };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "55P03")
        throw new ApiError(409, "A sync is already running", "SYNC_IN_PROGRESS");
      const safeError =
        error instanceof ApiError
          ? error
          : new ApiError(
              502,
              "Google sync could not complete. Try again or reconnect the integration.",
              "GOOGLE_SYNC_FAILED",
            );
      await withTenantClient(this.pool, context, async (client) => {
        await client.query(
          "UPDATE integration_connections SET last_sync_status='failed', last_sync_error=$1 WHERE id=$2 AND project_id=$3 AND tenant_id=$4",
          [safeError.message, connectionId, projectId, tenantId],
        );
      }).catch(() => {});
      throw safeError;
    }
  }
}
