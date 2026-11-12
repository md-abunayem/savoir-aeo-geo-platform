# Content approval and publishing (Phase 4)

The local UI is `/content/studio`, linked from Content Intelligence. It uses the
existing authenticated session, owner-scoped project selection and signed CSRF
protection. New REST operations are documented at `/v1/openapi.json` under
`/v1/projects/{projectId}/studio`.

## Setup

1. Apply migration `0043_content_publishing` with `npm run db:migrate` from `server`.
   This creates tenant-isolated drafts, publisher credentials, public media records,
   per-target deliveries and the durable outbox-discovery function. Existing
   Phase 1–3 tables and pgvector are required.
2. Configure `GEMINI_API_KEY` / `GEMINI_MODEL` for generation and fresh fact checking.
3. Set an independent `PUBLISHING_TOKEN_KEY` to 64 random hexadecimal characters.
   Buffer access tokens and WordPress Application Passwords use AES-256-GCM with
   this key, never the legacy token helper's default key. Preserve it across API
   and worker deployments; changing it requires reconnecting accounts.
4. Set `PUBLISHING_ENABLED=true`, `DATABASE_APP_URL` to the restricted runtime
   connection, and `REDIS_URL`. Publishing is independent of monitoring.
5. Run `npm run publishing:dev` locally, or build and run
   `npm run publishing:start` in production. The API alone does not dispatch posts.

The UI can create/import drafts and review them while publishing is disabled.
No external content is published merely by opening the UI, connecting an account,
uploading a file or approving a draft. Scheduling is the explicit publishing action.

## Approval and state transitions

`draft → in_review → approved → scheduled → published`

`failed` is a failure branch from scheduled delivery, not a prerequisite requiring
successful publication first. An accepted Buffer post remains `scheduled` locally
until Buffer confirms `sent`. Multiple destinations publish independently; the
draft is `published` only when all deliveries confirm publication, or `failed`
when any delivery fails or has an uncertain outcome. Remaining known-safe queued
targets and outcome polls continue even if another target failed.

- Importing a document always creates an unapproved draft; the API rejects supplied
  approval/status/validation fields.
- Saving edits increments the revision, resets to draft and clears validation and
  human approval. Optimistic revision checks reject stale edits/actions with 409.
- Submit for review runs Phase 3 checks against current memory and saves the report
  for the exact revision. Only a passed report can be approved by the owner.
- Scheduling locks the approved revision and creates all target deliveries in one
  PostgreSQL transaction. Dates are explicit ISO timestamps, from 30 seconds to
  one year ahead. The UI converts the reviewer's browser-local time to UTC.
- Scheduled/published/failed revisions are immutable through the edit API. Create
  a new draft for corrections; reconcile uncertain remote writes before resubmitting.
- Immediately before external creation the worker repeats fact checking, verifies
  current channel eligibility and checks media. A now-invalid fact prevents dispatch.

## Public MinIO/S3/CDN media

Configure a **separate bucket** and stable HTTPS base URL:

```dotenv
S3_PUBLIC_BUCKET=savoir-public-media
S3_PUBLIC_BASE_URL=https://media.example.com
```

The base URL must map directly to the public bucket root (or include its path if
your reverse proxy uses a bucket prefix). It must be reachable from Buffer's
servers and stay available until actual delivery. An expiring signed GET URL or
localhost endpoint is unsuitable.

The application rejects using `S3_BUCKET` (private evidence) as the public bucket.
`npm run storage:public:init` explicitly creates/configures only the named media
bucket: anonymous `s3:GetObject`, no anonymous writes or listing, and upload CORS
for `CORS_ORIGIN`. Run it with storage administration credentials. It never changes
the private evidence bucket policy. For AWS with Block Public Access, use a CDN
with bucket-origin access instead of this public-policy script; configure the same
stable public base URL. MinIO requires an externally reachable HTTPS proxy/CDN.

Grant the runtime storage credentials access to put/get/copy objects in this bucket.
Images support JPEG/PNG/WebP; videos support MP4, up to 100 MiB per file. The upload
flow signs a 15-minute PUT for a pending object. Completion checks object type and
size, then copies it with an ETag precondition to a permanent key that the client
upload URL cannot overwrite. Add a bucket lifecycle rule expiring `pending/` after
one day to clean up abandoned uploads. Keep finalized media while scheduled or
published posts may still fetch it; do not expire it with the pending uploads.

Uploads are intended for public distribution. The UI explicitly labels that fact.
Instagram image posts require one rendered image per carousel slide; a text
mockup is not an image asset. Alternatively upload one MP4 reel. TikTok and YouTube
require a single MP4. The application validates uploaded metadata and media counts;
it does not transcode videos or inspect codec, dimensions or actual duration.
The UI chooses attachments independently per destination, allowing a carousel and
a video to be scheduled in the same campaign without sharing incompatible assets.
Upload finished media satisfying the platform's short-form requirements. Buffer
may reject incompatible media during ingestion or publication.

## Buffer

Connect using an access token in the studio's Publishing Accounts panel. Tokens
are verified against account/organization/channel discovery before being encrypted;
only channel metadata is returned to the browser. This implements the requested
access-token connection option; it does not add a separate Buffer OAuth callback.

The client uses `POST https://api.buffer.com` with Bearer authentication. Buffer's
current GraphQL API schedules through `createPost` with `mode: customScheduled`
and `dueAt`; `BufferService.schedulePost` wraps that operation. There is no invented
`schedulePost` GraphQL mutation. The worker's locally scheduled jobs use
`createPost` with `mode: shareNow` when due.

Supported destinations: Facebook, Instagram, X (`twitter` in Buffer), TikTok and
YouTube. X threads include every generated thread item and repeat the first in
top-level text. YouTube sends a title, Education category, public privacy and
`madeForKids=false`; video eligibility determines whether YouTube treats it as a
Short. No unsupported Shorts boolean is sent.

Channels that default to reminders (including personal Instagram), and Facebook
groups, use notification scheduling. An active Buffer member device is required.
The UI can explicitly request reminders on other supported channels. A successful
reminder/`notified` response creates a persistent `manual_action` notice visible in
Delivery Activity; it is **not** marked published. Open the Buffer mobile app to
complete the post. Only a confirmed `sent` outcome finishes the delivery.
The UI refreshes active deliveries every 15 seconds while there are no unsaved edits
or pending actions, making newly required mobile approvals visible in the open studio.

Official contracts: [authentication](https://developers.buffer.com/guides/authentication.html),
[createPost input](https://developers.buffer.com/types/CreatePostInput.html),
[media hosting](https://developers.buffer.com/guides/hosting-media.html),
[X threads](https://developers.buffer.com/examples/create-threaded-post.html),
[YouTube metadata](https://developers.buffer.com/types/YoutubePostMetadataInput.html),
[post outcomes](https://developers.buffer.com/types/Post.md).

## Durable scheduling, retries and reconciliation

PostgreSQL is the outbox of record. Every 10 seconds the publishing worker scans
eligible records through a restricted discovery function and adds deterministic-ID
jobs to BullMQ `publishing-queue`. Redis contains only delivery/user/tenant IDs,
never tokens or full content. Failed queue jobs that never claimed a delivery can
be redispatched. The worker checks owner membership, approved revision, schedule
time and claim state before dispatch; parallel claims cannot both create a post.

Provider-confirmed HTTP 429 responses honor Retry-After plus small jitter, with
bounded create attempts. Existing remote IDs are polled without repeating create.
BullMQ does not multiply provider retries. Stale workers must still own their
attempt claim before starting an external mutation or recording its outcome.

Buffer does not document an idempotency key. A network timeout, ambiguous mutation
error, or crash after dispatch may have created a post. Such jobs become
`uncertain`, stop automatic creation retries, and show a persistent reconciliation
notice. Inspect Buffer/WordPress and database delivery records before any new
submission. A dispatch claim interrupted for five minutes is audited by the outbox
scan: known remote IDs resume outcome polling; unknown outcomes require review.
No exactly-once external-delivery guarantee is claimed. See Buffer's official
[retry/idempotency guidance](https://developers.buffer.com/guides/efficient-api-usage.html)
and [rate limits](https://developers.buffer.com/guides/api-limits.html).

## WordPress JSON-LD

Install and activate `server/integrations/wordpress/savoir-schema.php` as a
WordPress plugin, then connect a public HTTPS site with an editor's username and
Application Password. The connector checks authenticated REST access and the
registered REST-visible `savoir_schema_json` meta field before publication.

Articles publish through `/wp-json/wp/v2/posts`. HTML is escaped from the reviewed
blog text. Article JSON-LD is stored through the plugin's typed post meta and
rendered safely in `wp_head`; it does not rely on a script tag surviving WordPress
content sanitization. The response is checked for the stored schema. A stable
delivery-derived slug helps reconcile an existing post; an existing post with
missing/mismatched schema is flagged for review instead of silently accepted.

The connector pins DNS-validated public IPs to HTTPS requests, blocks private and
mapped loopback destinations, enforces response-size/time limits, and never follows
credential-bearing redirects. Provider credentials/messages are not stored in notices.
Official references: [WordPress posts REST API](https://developer.wordpress.org/rest-api/reference/posts/),
[Application Passwords](https://developer.wordpress.org/advanced-administration/security/application-passwords/),
[REST metadata](https://developer.wordpress.org/rest-api/extending-the-rest-api/modifying-responses/).

## Verification

Automated tests cover optimistic approvals, validation gates, media finalization,
Buffer request contracts, manual reminders, delayed rate-limit retries, uncertain
outcomes, WordPress schema requirements and HTTP authentication/CSRF. The browser
test uses explicit mocked APIs and never publishes externally. Live deployment
still requires PostgreSQL/Redis/MinIO, actual publishing accounts, public HTTPS
media hosting and the WordPress plugin.
