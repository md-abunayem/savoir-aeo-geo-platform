import type { TenantContext } from "../../db/tenant.js";
import { withTenantClient } from "../../db/tenant.js";
import type { StudioDocument } from "../content/content-studio.schema.js";
import { TokenCrypto } from "../integrations/token-crypto.js";
import { ApprovalService, validateTargetMedia } from "./approval.service.js";
import { PublishingError, type MediaRecord } from "./publishing.validation.js";
import type { WordPressCredentials } from "./wordpress.service.js";

interface Delivery {
  id: string;
  draft_id: string;
  project_id: string;
  revision: number;
  platform: string;
  channel_id: string;
  state: string;
  remote_id: string | null;
  media_ids: string[];
  scheduling_type: "automatic" | "notification";
  attempts: number;
  document: StudioDocument;
}
export class PublishingProcessor {
  constructor(private readonly service: ApprovalService) {}

  async process(id: string, context: TenantContext) {
    const service = this.service;
    const delivery = await withTenantClient(service.pool, context, async (client) => {
      const row = (
        await client.query<Delivery>(
          `SELECT d.*,a.document FROM publishing_deliveries d
        JOIN studio_drafts a ON a.id=d.draft_id AND a.project_id=d.project_id AND a.tenant_id=d.tenant_id
        WHERE d.id=$1 AND d.state IN ('queued','accepted','manual_action') AND d.next_attempt_at<=now()
        AND a.status IN ('scheduled','failed') AND a.approved_revision=a.revision AND d.revision=a.revision
        AND a.approved_by=$2 AND a.scheduled_time<=now()
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=$2 AND u.disabled_at IS NULL)
        FOR UPDATE OF d`,
          [id, context.userId],
        )
      ).rows[0];
      if (!row) return null;
      await client.query(
        "UPDATE publishing_deliveries SET state='dispatching',locked_at=now(),attempts=attempts+1,updated_at=now() WHERE id=$1",
        [id],
      );
      return { ...row, attempts: row.attempts + 1 };
    });
    if (!delivery) return;
    let state = "failed",
      remoteId = delivery.remote_id,
      remoteUrl: string | null = null,
      notice: string | null = null;
    let delaySeconds = 60;
    const renewClaim = async () => {
      const result = await withTenantClient(service.pool, context, (client) =>
        client.query(
          "UPDATE publishing_deliveries SET locked_at=now() WHERE id=$1 AND state='dispatching' AND attempts=$2 RETURNING id",
          [id, delivery.attempts],
        ),
      );
      if (result.rowCount === 0) throw new PublishingError("DISPATCH_LEASE_LOST");
    };
    try {
      const connection = await withTenantClient(
        service.pool,
        context,
        async (client) =>
          (
            await client.query<{ encrypted_credentials: string }>(
              "SELECT encrypted_credentials FROM publishing_connections WHERE project_id=$1 AND provider=$2",
              [delivery.project_id, delivery.platform === "wordpress" ? "wordpress" : "buffer"],
            )
          ).rows[0],
      );
      if (!connection) throw new PublishingError("PUBLISHING_CONNECTION_MISSING");
      const credentials = TokenCrypto.decrypt<Record<string, string>>(
        connection.encrypted_credentials,
        service.key(),
      );
      if (!delivery.remote_id) {
        const report = await service.verify(context, delivery.document);
        if (!report.passed) {
          await withTenantClient(service.pool, context, (client) =>
            client.query("UPDATE studio_drafts SET validation=$2 WHERE id=$1 AND revision=$3", [
              delivery.draft_id,
              JSON.stringify(report),
              delivery.revision,
            ]),
          );
          throw new PublishingError("FACT_CHECK_FAILED_AT_DISPATCH");
        }
      }
      if (delivery.platform === "wordpress") {
        await renewClaim();
        const result = await service.wordpress.publish(
          credentials as unknown as WordPressCredentials,
          delivery.document,
          delivery.id,
        );
        remoteId = String(result.id);
        remoteUrl = result.link;
        state = "published";
      } else {
        let result;
        if (delivery.remote_id)
          result = await service.buffer.outcome(credentials.accessToken!, delivery.remote_id);
        else {
          const channel = (await service.buffer.channels(credentials.accessToken!)).find(
            (c) => c.id === delivery.channel_id && c.platform === delivery.platform,
          );
          if (!channel) throw new PublishingError("BUFFER_CHANNEL_MISSING");
          const media = await withTenantClient(
            service.pool,
            context,
            async (client) =>
              (
                await client.query<MediaRecord>(
                  "SELECT * FROM studio_media WHERE project_id=$1 AND id=ANY($2::uuid[]) AND ready",
                  [delivery.project_id, delivery.media_ids],
                )
              ).rows,
          );
          if (media.length !== delivery.media_ids.length)
            throw new PublishingError("MEDIA_NO_LONGER_READY");
          validateTargetMedia(delivery.platform, media, delivery.document);
          for (const asset of media) await service.media.complete(asset);
          // Preserve the reviewer's media order, particularly for carousels.
          media.sort((a, b) => delivery.media_ids.indexOf(a.id) - delivery.media_ids.indexOf(b.id));
          await renewClaim();
          result = await service.buffer.createPost(credentials.accessToken!, {
            channel,
            document: delivery.document,
            media,
            schedulingType: delivery.scheduling_type,
          });
        }
        remoteId = result.id;
        remoteUrl = result.externalLink ?? null;
        state =
          result.status === "sent"
            ? "published"
            : result.status === "error"
              ? "failed"
              : result.schedulingType === "notification" || result.notificationStatus === "notified"
                ? "manual_action"
                : "accepted";
        if (state === "manual_action") {
          notice =
            "Mobile approval required. Open the Buffer mobile app to finish publishing. A reminder is not confirmation of publication.";
          delaySeconds = 300;
        } else if (state === "failed")
          notice = "Buffer reported a publishing error. Review the post in Buffer.";
        else if (result.status === "needs_approval") {
          state = "manual_action";
          notice = "This post requires approval in Buffer before it can publish.";
          delaySeconds = 300;
        }
      }
    } catch (error) {
      if (error instanceof PublishingError && error.retryAfter && delivery.attempts < 8) {
        state = delivery.remote_id ? "accepted" : "queued";
        delaySeconds = error.retryAfter + Math.ceil(Math.random() * 5);
        notice =
          "Provider rate limit reached. Delivery will retry after the provider's retry window.";
      } else if (delivery.remote_id) {
        state = "accepted";
        delaySeconds = 300;
        notice =
          "Unable to refresh the remote outcome. Check the connected account; the existing post will not be recreated.";
      } else if (error instanceof PublishingError && error.uncertain) {
        state = "uncertain";
        notice =
          "Publication outcome is uncertain. Reconcile with the provider before creating another post.";
      } else notice = error instanceof PublishingError ? error.code : "ELIGIBILITY_CHECK_FAILED";
    }
    // A persistence error here intentionally propagates. The stale-dispatch audit will require
    // reconciliation instead of reissuing an ambiguous external write.
    await withTenantClient(service.pool, context, async (client) => {
      const saved = await client.query(
        `UPDATE publishing_deliveries SET state=$2,remote_id=$3,remote_url=COALESCE($4,remote_url),notice=$5,
        locked_at=NULL,next_attempt_at=now()+($6 * interval '1 second'),updated_at=now() WHERE id=$1 AND state='dispatching' AND attempts=$7`,
        [id, state, remoteId, remoteUrl, notice, delaySeconds, delivery.attempts],
      );
      if (saved.rowCount === 0) return;
      await client.query("SELECT id FROM studio_drafts WHERE id=$1 FOR UPDATE", [
        delivery.draft_id,
      ]);
      const states = (
        await client.query<{ state: string }>(
          "SELECT state FROM publishing_deliveries WHERE draft_id=$1 AND revision=$2",
          [delivery.draft_id, delivery.revision],
        )
      ).rows;
      const overall = states.every((d) => d.state === "published")
        ? "published"
        : states.some((d) => ["failed", "uncertain"].includes(d.state))
          ? "failed"
          : "scheduled";
      await client.query(
        "UPDATE studio_drafts SET status=$2,updated_at=now() WHERE id=$1 AND revision=$3",
        [delivery.draft_id, overall, delivery.revision],
      );
    });
  }
}
