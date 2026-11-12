# Platform review — 10 November 2026

## Changes implemented

- Enabled Tailwind 4 through PostCSS. Existing utility classes now compile, semantic colors follow the light/dark palette, and the existing CSS reset is preserved.
- Added `/help`, including setup steps, measurement explanations, troubleshooting, and links to relevant pages. Workspace help and search link to it.
- Added route loading and recoverable error screens.
- Removed the monitoring API dependency from unrelated workspace pages. Project switches remount feature views, and manual refresh reloads their data without background polling resetting active forms.
- Protected billing routes with authentication, CSRF on writes, owner authorization, application-origin return URL validation, and no-store responses. Reads run inside the restricted tenant database context.
- Added migration `0038_billing_runtime_access` for owner-scoped billing access.
- Added migration `0039_billing_webhook_fulfillment`: a narrow database capability handles verified Stripe events atomically, deduplicates event IDs and paid invoice/checkout objects, grants both monitoring and crawl credits, defers out-of-order invoices for retry, and prevents stale subscription events from undoing cancellation. Recurring credits come only from paid cycle/initial invoices; unpaid checkouts and proration invoices do not receive a full monthly allocation. Existing subscriptions use the billing portal for plan changes.
- Preserved exact Stripe webhook bytes for signature verification. Unconfigured payments now return a clear error instead of simulated checkout success. Checkout redirects preserve existing query parameters.
- Implemented live Search Console and GA4 imports using Google's APIs, with bounded pagination, a 30-day window ending yesterday, encrypted credentials, optional refresh-token renewal, connection locking, atomic replacement, and failure status recording. Imports cannot delete the previous snapshot when a provider request fails.
- Fixed the integration form's incorrect `externalPropertyId` and `scopes` fields, removed fabricated account/property defaults, and made credential requirements explicit. Saving a connection does not claim that Google property access has been verified; Sync verifies access.
- Fixed `questionOnly=false` being coerced to true.
- Replaced simulated webhook delivery with signed HTTPS POST requests, validated/pinned public IPv4 DNS destinations, no redirects, a request deadline, and actual response status tracking.
- Added `/v1/public/projects/:projectId/traffic` and `/actions` with bearer API keys, read scopes, expiry/revocation checks, per-key/IP limits, tenant isolation, OpenAPI entries, and `/help/api` documentation. Migration `0040_public_api_key_access` exposes only the identity lookup capability to the runtime role.

## Deployment

1. Install frontend dependencies from the updated lockfile (`cd client`, then `npm ci`).
2. Apply backend migrations (`cd server`, then `npm run db:migrate`), including 0038–0040. The configured application database was not changed during this review.
3. Restart the API and rebuild/restart the frontend.
4. Reconnect old Google integrations. Production integration encryption now derives a dedicated key from `AUTH_JWT_SECRET`; records encrypted with the former public fallback key cannot be reused. Rotating that secret also requires reconnecting integrations.
5. Supply a Google OAuth access token with `webmasters.readonly` or `analytics.readonly` and the matching property ID. The current UI supports manual tokens, not an interactive consent redirect. The API additionally accepts `refresh_token` and `expires_at` (Unix milliseconds); renewal requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## Verification

- Backend unit tests, frontend unit tests, type checks, lint, and production builds were run.
- Disposable PostgreSQL tests cover workspace tenant isolation, billing initialization/access, and repeated Google imports without duplicate rows.
- Browser checks cover help, overview, prompts, reporting, and AXO/content/action pages in light/dark and mobile/desktop layouts. Feature-page fixtures explicitly return 503 for monitoring requests.
- Screenshots of help and content were visually inspected. Google, Stripe, and webhook external services were not exercised with real customer credentials or payments.

## Remaining work identified

This review is not a claim that every platform flow is production-complete.

- Google connection setup would benefit from an interactive OAuth consent flow and property picker. Manual access tokens expire; the current UI explains this limitation.
- Stripe fulfillment now has a restricted atomic write path and replay tests. An end-to-end Stripe test-mode payment still needs to be run with configured product prices and a registered snapshot webhook endpoint. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Refund/dispute credit reversals and proration credit policy remain product work.
- Public API keys now support read-only traffic/actions. Old `write:actions` and `read:audit` scopes do not authorize the new endpoints; generate a key with supported scopes. Mutation/audit APIs would need additional explicit capabilities.
- Webhook test delivery is now real; automatic event publication/retries are separate work. HTTPS endpoints must have public IPv4 DNS records.
- Google sync imports at most 100,000 rows per request and reports an explicit limit error instead of silently truncating. Large accounts need background jobs and date-window controls. Search Console itself returns top rows and does not guarantee exhaustive data.
- The repository still lists International & Local AEO and legal/privacy/compliance as incomplete. These require product requirements and accurate organization-specific policies rather than invented pages or promises.

API references used: [Search Console query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [GA4 runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport).
