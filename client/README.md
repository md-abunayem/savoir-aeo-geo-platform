# Savoir frontend

Next.js App Router, React and TypeScript. Visual direction follows the supplied design package: pale green canvas, forest green accents, compact navigation and white cards. The product is named Savoir; prototype metrics are not used as live results.

## Run locally

Use Node 22.14 or later in the Node 22 family. From `client/`, run `npm ci`, then `npm run dev`. Open http://localhost:3000. The backend must be running separately on port 8000 with authentication enabled and migrations applied through 0009. Restart an already running backend after updating its code.

`API_ORIGIN` is server-only and defaults to http://127.0.0.1:8000. To override it, copy `.env.example` to `.env.local` and edit that value. `/v1/*` is proxied without changing cookie paths. Add the exact browser origin to the backend's `CORS_ORIGIN` list. For example, `http://localhost:3000` and `http://127.0.0.1:3000` are separate origins. Restart the API after editing its environment file and use the same hostname throughout signup and sign-in. Configure HTTPS and secure backend cookies for production. Set API_ORIGIN before building a production deployment because rewrites are resolved during the build.

## Deploy to Cloudflare Workers

The API must already be deployed to a public HTTPS origin. Workers cannot reach the backend running on your computer. From `client/`, set the real backend origin before building (PowerShell):

```powershell
$env:API_ORIGIN = "https://YOUR_BACKEND_HOST"
npm.cmd run deploy
```

Alternatively put `API_ORIGIN=https://YOUR_BACKEND_HOST` in the ignored `.env.production.local` file. A shell variable overrides values in `.env.local`. For Cloudflare Workers Builds, set `API_ORIGIN` under **Build variables and secrets** and use `npm run build:cloudflare` as the build command. The deploy, upload and preview scripts reject missing, HTTP or localhost API targets. Ordinary Next.js development and builds retain the local backend default.

Next.js embeds the `/v1/*` rewrite destination during the build. Adding only a runtime `vars.API_ORIGIN` in `wrangler.jsonc` or changing a dashboard runtime variable does not update that destination; rebuild and redeploy after changing it. See [OpenNext environment variables](https://opennext.js.org/cloudflare/howtos/env-vars).

Set the backend's `CORS_ORIGIN` to include the exact frontend HTTPS origin and enable secure production cookies. Verify `/v1/health/live` through the deployed frontend as well as the backend; a working HTML page does not establish API connectivity.

Use the authenticated account's deployment URL printed by Wrangler (the reported URL is `https://savoir-client.sabbirhossainnde.workers.dev`). Do not reuse an old preview hostname. If requests fail, inspect the HTTP status and Worker logs (`npx wrangler tail`) before attributing the failure to DNS. The frontend also displays “The request could not be completed” for API errors without a detailed response. Flush DNS only after confirming a resolver problem; a browser refresh cannot fix an unreachable backend.

For the current temporary deployment, `.env.production.local` points to a Cloudflare Quick Tunnel. A separate API process listens on `127.0.0.1:8002` with `NODE_ENV=production` (secure cookies) and the frontend HTTPS origin in `CORS_ORIGIN`. The original development API stays on port 8000. Process IDs and diagnostic logs are under the ignored `.wrangler/` directory. Keep the computer, API and tunnel running. A new Quick Tunnel gets a new hostname; update `API_ORIGIN` and rebuild/redeploy when that happens. Replace this setup with a hosted API or a named tunnel for a persistent deployment. See [Quick Tunnel lifecycle and limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Create a local account

1. Open `/signup` and enter your name, email address and chosen password.
2. With real mail disabled, run `npm run email:preview -- you@example.com` from `server/`, substituting the address you entered. For live delivery, the backend needs configured Brevo credentials and a running email worker. See [server setup](../server/README.md#local-signup-and-email-verification).
3. Enter the 64-character code and your signup password at `/verify-email`. If the code expired, request a resend and use the newest code.
4. Sign in at `/login`. The dashboard shows projects you already own. Workspace and project creation are pending.

## Completed

- **Signup and verification.** Registration with password validation and confirmation, email-code verification, resend, and a return to sign-in after verification.
- **Password recovery.** Request a reset code at `/forgot-password`, then enter the emailed code and a new password at `/reset-password`. Reset invalidates existing sessions; the backend queues notification email when delivery is configured.
- **Session handling.** Email/password sign-in, password visibility toggle, logout, HttpOnly session cookies and CSRF protection. Refresh is shared within a tab and coordinated across tabs where Web Locks are supported.
- **Dashboard.** Paginated Owner project discovery, operational health, available credits, engine availability, recent runs and plain-text answer details.
- **Prompts.** Create prompts from the page action, search the latest 100 loaded prompts, review active and paused counts, follow schedules to monitoring, and pause or resume prompts.
- **Monitoring.** Create daily, weekly and custom schedules with country, language and sample settings. Pause or resume schedules, pause at the project level, delete schedules after confirmation, and queue manual runs. Retrying an unchanged manual request after a lost response reuses its idempotency key.
- **Common UI.** Responsive navigation and loading, empty and error states.

## Pending

- Workspace member management and invitations; project creation and new-account onboarding are available.
- Advanced prompt editing and import.
- Live collection requires a configured backend worker. Gemini, OpenRouter, ChatGPT, AI Overviews and AI Mode are available when their providers are configured.

## Checks

`npm run check` runs strict type checking, ESLint, unit tests and a production build. The frontend GitHub Actions definition runs these checks; hosted CI has not yet been observed.

Browser tests use a disposable local database and synthetic account, not real users:

1. Start local PostgreSQL and configure `server/.env` as documented by the backend.
2. From `server/`, run `node --import tsx tests/preview-server.ts` in an interactive terminal. It creates a uniquely named temporary database/role and listens on 127.0.0.1:8001. No external provider worker runs; the initial answer is a fake fixture and manual runs only reserve synthetic credits.
3. From `client/`, set `API_ORIGIN=http://127.0.0.1:8001` in that terminal and run `npm run dev`. This is a temporary process override; do not save it as your normal API origin.
4. Run `npm run test:e2e` from another client terminal. Windows uses installed Microsoft Edge; on other systems install Playwright Chromium first.
5. Type `stop` in the fixture terminal to drop its temporary database/role. Stop the test frontend too. The fixture also cleans up on SIGINT/SIGTERM or after 60 minutes.

The synthetic login is `frontend-test@test.invalid` / `Savoir-local-test-2026!`, and exists only in that temporary database. Test screenshots and traces are ignored under test-results/. Never run this fixture against a production database.

## Verified integration checkpoint — 6 November 2026

Backend: 28 unit/API tests and 64 integration tests passed. Frontend: 8 unit tests and 4 browser workflows passed, covering JWT sign-in/refresh/logout, project discovery, prompt changes, schedules, lost-response manual-run replay without duplicate reservation, unavailable providers, mobile navigation, and empty/error states. Type checks, lint, backend formatting and both production builds passed. Migration 0009 is applied locally. Browser tests used only a disposable database and synthetic provider results; no live Gemini calls or real email sends were made. Frontend production dependency audit reported zero findings; eight moderate development dependency findings remain, and no forced breaking dependency update was applied.

After signup was added, frontend type checks, lint, all 10 unit tests and the production build passed. The signup browser suite did not complete because the local test frontend was unreachable.
