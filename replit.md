# Xclip - AI Video Clipper & Chat

## Overview
Xclip is an AI-powered platform for video clipping, image generation, and chat built by MANAZIL. It enables users to generate AI videos (using models like Kling, Veo, Seedance via Freepik API), create AI images, analyze videos for virality, and interact with AI chat models (via OpenRouter/OpenAI).

## Architecture
- **Runtime**: Node.js (>=18.0.0)
- **Backend**: Express.js v5 serving both API and frontend static files from a single process
- **Frontend**: Vanilla JavaScript (no build step) served from `client/` directory
- **Database**: PostgreSQL via Replit's built-in database (`DATABASE_URL`)
- **Sessions**: `connect-pg-simple` storing sessions in `sessions` table
- **Media Processing**: `fluent-ffmpeg` for video/audio manipulation
- **Port**: 5000 (both frontend and backend served together)

## Project Structure
```
├── server.js          # Main Express server (~15k lines) - API + static file serving
├── client/            # Frontend assets
│   ├── index.html     # Main entry point
│   ├── src/main.js    # Frontend JS logic (~14k lines)
│   └── styles/        # CSS
├── droplet-proxy/     # DigitalOcean droplet proxy sub-project (optional)
├── database_backup.sql # Original DB schema reference
└── package.json
```

## Key Features
- AI Video Generation (Text-to-Video, Image-to-Video) via Freepik API
- AI Image Generation (X Image 2) via Freepik Nano Banana Pro API
- Pool-based API key management for image generation (Freepik key pool)
- Subscription and credit system
- Session-based authentication with bcrypt
- PWA support with service worker

## Environment Variables Required
- `DATABASE_URL` - PostgreSQL connection string (set automatically by Replit)
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
The server runs on port 5000, serving both the API and static frontend files.
