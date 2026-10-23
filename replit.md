# Xclip - AI Video Clipper & Chat

## Overview

### Retired video model

Normal Wan 3.0 now requires **720p / 30 seconds** at the existing Rp6.500/video price, per the user's request. Its upstream request uses `720P`; omitted resolution defaults to 720p, other resolutions are rejected. Catalog and copied cURL must agree. Previously completed Wan videos retain their original resolution. Seedance's upstream generation remains 480p, but new public requests now require a verified 1080p upscale before completion, at their existing durations/prices. Quote validation remains mandatory before reserving funds/submitting; never silently deliver 480p for a new 1080p request.

Developer quickstarts use the current portal origin, prompt for the developer's key in Bash, and create a valid request ID. Postman JSON and authenticated status/download examples are included. Never embed the user's key in rendered docs. A 202/processing response is not a completed video; retain the request ID/body for retries rather than running the whole new-ID block again. Preview verification does not update or verify Railway's deployed version.

Wan 720p/30s readiness uses the live-confirmed 90-credit backend floor; the actual quote remains authoritative. If a selected account is underfunded for the quote, bounded read-only reselection may choose a funded account before dispatch. Backend credits and developer wallet balance are different. Never retry/fail over a paid submission, and never expose backend credit or credential details to developer users.

Wan 3.0 Uncensored is retired at the user's request. Only normal Wan 3.0, Seedance 2.5 and Seedance 2.0 are advertised by the API video catalog and docs. New public Uncensored submissions return HTTP 410 `MODEL_RETIRED` before any provider call or wallet mutation. Historical registry/pricing, task polling, reconciliation, refunds, history and protected media remain intact; earlier sections describing Uncensored availability are historical, not permission to offer new jobs.

### Kling Motion Control backend

New `/api/motion/generate` calls use Alriz `mc-kling-2.6-pro` only, with server-side `ALRIZ_API_KEY`. Public model `kling-v2.6-pro` and legacy fields `characterImage`, `referenceVideo`, optional `prompt` and `roomId` remain accepted; HTTPS URLs, media data URIs and legacy raw base64 are supported. Supply image JPG/PNG/WebP and video MP4/MOV no longer than 30 seconds. Custom character orientation is rejected unless `video`; no undocumented upstream orientation or webhook fields are sent.

Wan, Seedance and their Picsart `p500` routing/prices are unchanged. Motion retains its existing authentication/cooldown/access behavior; this migration does not invent a wallet price or alter user balances. Standard motion submissions are explicitly rejected instead of silently billing them as Pro.

Local `xmc_...` task IDs hide upstream IDs. Optional `Idempotency-Key` deduplicates per Xclip API key and rejects changed inputs. A committed reservation plus per-user PostgreSQL transaction lock prevents competing submits; ambiguous delivery remains pending for operator review, never automatically resubmitted or sent to Freepik. Polling/reconciliation handles only accepted jobs and resumes after restart. Previous-provider jobs keep their existing status path. Media/history use authenticated same-origin routes, not CDN links. `[XCLIP_GENERATION]` motion events report sanitized status and upstream HTTP status without keys or provider payloads.

Alriz key validation is read-only `GET /api/account`; `GET /api/models` being successful alone does not prove valid credentials. Railway must receive `ALRIZ_API_KEY` separately; adding it in Replit does not update Railway. No paid generation should be claimed tested on the basis of unit tests or catalog reads.
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
`server/klikqris-provider.js`, `klikqris-service.js`, and `klikqris-routes.js` implement dynamic QRIS. Credentials stay server-side in `KLIKQRIS_API_KEY` and `KLIKQRIS_MERCHANT_ID`. The merchant owner confirmed PG KlikQRIS, so the application explicitly supplies `defaultMode: 'pg'` when `KLIKQRIS_MODE` is missing or blank. An explicit `pg`, `my_pg`, or `sandbox` environment value overrides that project setting; invalid nonempty values fail rather than silently change destinations. The standalone provider still requires an explicit mode from either source; do not infer it from credentials. Sandbox never grants real subscription time. Set `KLIKQRIS_CALLBACK_URL` to the actual published `/api/payments/klikqris/webhook` URL for per-invoice callbacks in PG mode. MY PG uses its dashboard webhook setting. When no callback URL is configured, server reconciliation polls every 30 seconds and the open portal checks its invoice every 15 seconds.

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

### Separate Wan 3.0 model

Public `wan-3.0` is **Wan 3.0**, priced **Rp6.500/video**, separate from the retired `wan-3.0-uncensored` (Rp6.000/video). Its current configuration is 720p, fixed 30 seconds, 16:9/9:16, audio on/off, prompt with optional PNG/JPEG/WebP data URI. It does not inherit an Uncensored claim. New-model requests always use API wallet balance; existing legacy access remains limited to the previously available model.

Internally, `server/picsart-wan-provider.js` follows the supplied browser-capture workflow: temporary image upload when needed, non-generating options quote, one submit, then result polling. The user explicitly allows shared use of available `p500` credentials even when assigned to legacy users. Assignment mappings must stay intact; assignment alone no longer disqualifies a credential. Tokens must still be present/unexpired, the pool must be `p500`, and status must be `available`. This permission does not extend to sharing assigned Renderful keys or reviving dead accounts. Quotes, credit checks and shared per-account locking/quota still apply; no generation retries, provider fallback, captured bearer tokens, cookie replay, subscription manipulation, or token refresh contract is invented. If access expires, polling fails safely without treating the job as failed or refunding unconfirmed delivery. Existing account-maintenance tooling must refresh expiring credentials.

Both models share owner-scoped history, idempotency protection, non-expiring API wallet and protected Xclip media streaming. The wallet charge stores the actual model price; a confirmed failure refunds that stored amount once. The catalog reports each model's availability independently. Public content, API errors and result URLs must not identify internal providers. HAR uploads can contain live credentials and are excluded from Git and deployment.

### Seedance 2.5

Public `seedance-2.5` is a separate **Rp11.000/video** API-wallet model: fixed 30 seconds, final 1080p through upscale, 16:9/9:16, optional reference image, audio boolean. Existing Wan models and prices are unchanged. Generation remains 480p/30 seconds as demonstrated by the capture, not native 1080p.

`server/picsart-seedance-provider.js` supplies its distinct private contract to the shared Picsart transport: `/gw-v2/workflows/seedance`, `seedance_2_5`, `content[]` with nested image URL/reference role and text entries, `generate_audio`, `output_format`, and completed `result.video_url`. Wan keeps its own endpoint, params and result parser. Seedance's observed quote is 120 credits; readiness filters insufficient accounts and the actual request is quoted again before any wallet reservation or paid submission. Both shared-pool models use the same account advisory-lock namespace and combined daily per-account service quota. No provider fallback, retries of uncertain paid submits, or captured-token reuse is permitted.

### Seedance 2.0

Public `seedance-2.0` is an additional **Rp5.000/video** wallet model, fixed **15 seconds, final 1080p through upscale**, with optional reference image and audio boolean. Its upstream generation remains 480p. Existing prices and durations do not change. API defaults, catalog defaults and copied cURL must all use 15 seconds for this model.

### Mandatory Seedance output enhancement

New Seedance requests use public `resolution: "1080p"` and durable `retry_data.upscale` metadata. Both source-generation quote and Renderful key/balance readiness must succeed before reserving funds and dispatching generation. `renderful_key_pool` supplies only available, unassigned, non-dead keys for new jobs; use the recorded key ID for subsequent polling, never publish credentials.

The private Renderful contract is `POST https://api.renderful.ai/api/v1/generations` with `type: "video-to-video"`, `model: "bytedance-video-upscaler"`, `video_url`, `resolution: "1080p"` and original `duration`. Poll `GET /api/v1/generations/:id`; use its generated OpenAPI schema, not the model page's legacy predictions FAQ.

`server/seedance-upscale.js` serializes per task with PostgreSQL advisory locks and persists submit intent before the paid POST. A restart/ambiguous response must not cause a second paid submission. Stage/job/source/result references stay in private task metadata. Public status/history exposes only generic `generating`/`upscaling` stages and protected Xclip media paths. Definite failure uses the original wallet reservation's idempotent refund; ambiguous delivery or transient verification failure keeps the task processing and funds held.

Only verified final output can set `completed`/publish video: download through DNS-checked transport, follow redirects safely without provider headers, bound size/time, then run ffprobe on a temporary local file. Both orientations must have at least 1080 pixels on the short edge. Never strip AI provenance or return the original 480p as a success. Old jobs without the new enhancement marker retain their purchased contract: do not create retroactive paid upscales. No paid end-to-end test is implied by read-only account/catalog checks or local fixture tests.

Its successful HAR uses the same private Seedance workflow with `model: seedance_2_0`, image/text `content[]`, `generate_audio: true`, ratio 9:16 and completed `result.video_url`; the completed usage is 45 credits. Do not copy the 2.5-specific `output_format` or `omni_reference_task_type` flags into 2.0 requests. The capture does not contain an options quote: the adapter must still obtain a non-estimated live quote matching the requested duration before reserving wallet funds or submitting, and reject unavailable/unsupported settings rather than guessing or falling back. Text-only, 16:9 and disabled audio use this same preflight validation; the successful capture itself only demonstrates image input, 9:16 and enabled audio. Shared-pool concurrency, owner-scoped history, protected media and original-charge refunds apply to this model too.
