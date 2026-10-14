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
- Portal API keys, request totals, subscription status, and QRIS payments use account data. Top up currently buys/renews access with proof uploaded for admin approval, not a separate wallet.
- Railway contains Picsart/Flora configuration, but this imported backend has no adapters for them. Generation remains Freepik; do not claim integration is complete.
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

## Internal provider privacy
Developer overview returns only account-scoped key and request information. Video results use protected Xclip media paths; streams are served through Xclip without upstream redirects. Media responses allow only video content and standard range headers. API callers must send `X-Xclip-Key` when retrieving media; browser playback uses the existing session. Streaming increases application bandwidth compared with direct CDN redirects.
