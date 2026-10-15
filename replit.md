# Xclip - AI Video Clipper & Chat

## Overview
Xclip is an AI-powered platform for video clipping, image generation, and chat built by MANAZIL. It enables users to generate AI videos (using models like Kling, Veo, Seedance via Freepik API), create AI images, analyze videos for virality, and interact with AI chat models (via OpenRouter/OpenAI).

## Architecture
- **Runtime**: Node.js (>=18.0.0)
- **Backend**: Express.js v5 serving both API and frontend static files from a single process
- **Frontend**: Vanilla JavaScript (no build step) served from `client/` directory
- **Database**: PostgreSQL via Railway (`RAILWAY_DATABASE_URL` on Replit; `DATABASE_URL` in Railway). The server also accepts `DATABASE_PUBLIC_URL` and falls back to `DATABASE_URL`.
- **Sessions**: `connect-pg-simple` storing sessions in `sessions` table
- **Media Processing**: `fluent-ffmpeg` for video/audio manipulation
- **Port**: 5000 (both frontend and backend served together)

## Project Structure
```
├── server.js          # Main Express server (~15k lines) - API + static file serving
├── client/            # Frontend assets
│   ├── developer.html # Portal entry point
│   ├── src/developer.js # Developer portal behavior
│   └── styles/        # CSS
├── droplet-proxy/     # DigitalOcean droplet proxy sub-project (optional)
├── database_backup.sql # Original DB schema reference
└── package.json
```

## Key Features
- Developer portal is the homepage `/`, with `/developer` retained as an alias. Legacy generator and admin UI files are removed; old entry points return 410. Uses existing session authentication and Railway storage; new portal accounts register first and then log in.
- Backend generation and admin/payment APIs remain intact. There is currently no admin UI for approving Top up payments. The retirement service worker and portal startup remove legacy offline caches.
- Portal API keys, request totals, and QRIS payments use account data. Top up now adds non-expiring API wallet balance: minimum Rp100.000, Wan 3.0 480p Rp6.000 per video (2–30 seconds). Balance is separate from bots' `users.saldo`. New manual proof submissions are retired; old records and approval APIs remain available.
- Railway's internal provider configuration is not shown to developer users. Wan generation uses the internal provider-pool adapter; legacy generation APIs remain intact.
- AI Video Generation (Text-to-Video, Image-to-Video) via Freepik API
- AI Image Generation (X Image 2) via Freepik Nano Banana Pro API
- Pool-based API key management for image generation (Freepik key pool)
- Subscription and credit system
- Session-based authentication with bcrypt
- PWA support with service worker

## Environment Variables Required
- `RAILWAY_DATABASE_URL` - Railway PostgreSQL connection string when running this imported project on Replit; stored as a Replit Secret. In Railway itself, the server reads Railway's `DATABASE_URL`.
- `SESSION_SECRET` - Express session secret (optional, has default)
- Various API keys for AI features (FREEPIK_API_KEY, OPENROUTER_API_KEY, etc.)

## Database Tables
- `users` - User accounts with admin flag
- `rooms` - API key management rooms
- `subscriptions` - User subscription records
- `subscription_plans` - Available plans
- `sessions` - Express sessions (managed by connect-pg-simple)
- `video_generation_tasks` - AI video generation job tracking
- `xclip_api_keys` - Per-user API keys
- `payments` - Payment records

## Running
```bash
npm start  # or: node server.js
```
The server runs on port 5000, serving both the API and static frontend files. On Replit, add the Railway Postgres `DATABASE_URL` value as the `RAILWAY_DATABASE_URL` secret before starting the app.

## Portal verification
Run `npm test`. Tests use fake sessions, provider responses, and database clients; they do not create Railway accounts, submit real payments, or perform paid generation.

## KlikQRIS payments
`server/klikqris-provider.js`, `klikqris-service.js`, and `klikqris-routes.js` implement dynamic QRIS. Credentials stay server-side in `KLIKQRIS_API_KEY` and `KLIKQRIS_MERCHANT_ID`. `KLIKQRIS_MODE` must be explicitly set to `pg`, `my_pg`, or `sandbox`; do not guess between the two merchant modes. Sandbox never grants real subscription time. Set `KLIKQRIS_CALLBACK_URL` to the actual published `/api/payments/klikqris/webhook` URL for per-invoice callbacks in PG mode. MY PG uses its dashboard webhook setting. When no callback URL is configured, server reconciliation polls every 30 seconds and the open portal checks its invoice every 15 seconds.

Storage initialization adds isolated portal invoice/wallet/credit/charge tables to the external Railway DB; it does not migrate/delete bot top ups or legacy payments. New invoices store billing_type=wallet with no plan/duration, accept integer amount >=100000, and credit the requested deposit, not unique gateway codes/fees. Existing subscription invoices retain their original entitlement; schema relaxation only permits null plan/duration for new wallet invoices. One open invoice per user, stable idempotency keys, and no automatic create retry prevent duplicate billing. Webhooks compare the original private signature and independently fetch authenticated gateway status/order/amount. Wallet credit, its unique invoice receipt, and marking paid commit atomically. Sandbox never credits real balance. Only owner-scoped public projections and authenticated QR images reach the browser. PG per-invoice callbacks preserve the shared merchant's existing bot webhook.

`server/api-wallet.js` owns separate portal balances and per-task reservations. GET `/api/developer/wallet` requires the user's session and returns available/reserved balance plus tariff/minimum. Each new billable Wan task reserves Rp6.000 in the same transaction that stores the task, before the upstream generation POST. Completed tasks consume that reservation; definite failures refund once. Unconfirmed delivery stays reserved and must not be retried or automatically refunded. Financial transitions and task terminal state commit together; late polls cannot reverse a completed/failed task. Existing active legacy subscriptions remain honored until expiry without rewriting them; new deposits never extend subscriptions. The server polls confirmed in-flight Wan tasks every 30 seconds even if the caller stops polling. This does not recover unknown upstream run IDs.

## Existing account login
The portal opens in login mode, with registration available for new users. `server/login.js` authenticates existing Railway `users` using their original bcrypt hashes and IDs, without account creation or password changes. Email lookup ignores casing and outer whitespace. Existing keys/subscriptions remain attached to the original user ID. Legacy passwordless accounts cannot use password login; linked Telegram authentication or verified email recovery requires a separate implementation, never an authentication bypass.

## Internal provider privacy
Developer overview returns only account-scoped key and request information. Video results use protected Xclip media paths; streams are served through Xclip without upstream redirects. Media responses allow only video content and standard range headers. API callers must send `X-Xclip-Key` when retrieving media; browser playback uses the existing session. Streaming increases application bandwidth compared with direct CDN redirects.

## Wan API
Generation logs use structured stdout/stderr records prefixed `[XCLIP_GENERATION]`. View these in the Railway **web service** logs, not just PostgreSQL logs. Events cover received/replayed requests, queued tasks, dispatch acceptance/uncertainty/failure, status polls, progress when supplied, completion/failure, and refunds after definite submission failure. The existing 30-second reconciler emits `worker_heartbeat` even when idle, with checkedTasks/failedChecks; per-task failures are no longer silently swallowed. Failures include the public taskId, safe stage/category, HTTP/upstream status and PostgreSQL/network code where available, plus fixed Indonesian explanations. No prompts, API keys, headers, private run IDs, signed media URLs, provider payloads, SQL details, or raw Error objects are logged. Public API error responses remain sanitized. Monitoring never submits or retries a generation.

`server/wan-provider.js` discovers Wan 3.0 text/image model IDs and parameter options from the authenticated catalog. Runtime credentials come from existing Railway `flora_key_pool` rows with available/active status, not from the browser. If multiple workspaces/projects exist, configure `FLORA_WORKSPACE_ID` and `FLORA_PROJECT_ID`; a single accessible workspace with a single project is selected automatically. No upstream project or workspace is created.

The public model ID is `wan-3.0-uncensored`. POST `/api/videogen/proxy` requires an active Xclip key, sufficient API balance (or still-active legacy subscription), a prompt, and an `Idempotency-Key`. Insufficient funds returns 402. Resolution is 480p; duration is 2–30 seconds (default 30), at one fixed Rp6.000 price per video. Optional `image` is a PNG/JPEG/WebP data URI. GET `/api/videogen/tasks/:taskId` polls; completed video streams through Xclip. Status/download calls do not charge another generation. The portal reads the account-protected `/api/developer/models` catalog before showing availability.

Jobs use existing `video_generation_tasks` storage, with provider run/key references only in internal `retry_data`. Per-user and per-provider-key PostgreSQL advisory locks protect idempotency, the existing 180-second cooldown, and the existing 50-per-key daily service quota. No production DDL or data migration is needed. A generation POST is never automatically retried. Uncertain delivery is retained as pending for manual reconciliation and blocks new Wan requests for that user; do not manually clear it before checking whether the upstream run was accepted. Legacy callbacks and background workers do not process Wan tasks.

Developer generation history: GET `/api/developer/generations?page=1` accepts a portal session or `X-Xclip-Key`, scopes results to the authenticated user/key, and returns `{tasks,page,hasMore}` (20 tasks per page, newest first). Tasks expose only public ID/model/status/timestamps, protected Xclip video paths, and safe failure/uncertain notices. The portal's Riwayat generasi refreshes every 10 seconds, including loaded older pages, without dispatching generations or exposing upstream logs. Read failures must not be presented as an empty or failed generation. No schema migration or new billing operation is involved.
