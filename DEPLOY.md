# Xclip - Railway Deployment Guide

## Quick Deploy to Railway

### 1. Prerequisites
- GitHub account
- Railway account (https://railway.app)

### 2. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/xclip.git
git push -u origin main
```

### 3. Deploy on Railway
1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your xclip repository
5. Railway will auto-detect Node.js and deploy

### 4. Add PostgreSQL Database
1. In Railway dashboard, click "+ New"
2. Select "Database" → "PostgreSQL"
3. Railway auto-sets `DATABASE_URL`

### 5. Set Environment Variables
In Railway dashboard → Variables, add:

**Required:**
- `SESSION_SECRET` - Random string for sessions (e.g., generate with: `openssl rand -hex 32`)

**For AI Features:**
- `OPENROUTER_API_KEY` - For AI Chat & viral analysis
- `ELEVENLABS_API_KEY` - For video transcription

**For Room System (Image/Video Gen) - 5 Rooms x 3 Keys = 15 Keys:**

Room 1:
- `ROOM1_FREEPIK_KEY_1` - Room 1 API key 1
- `ROOM1_FREEPIK_KEY_2` - Room 1 API key 2
- `ROOM1_FREEPIK_KEY_3` - Room 1 API key 3

Room 2:
- `ROOM2_FREEPIK_KEY_1` - Room 2 API key 1
- `ROOM2_FREEPIK_KEY_2` - Room 2 API key 2
- `ROOM2_FREEPIK_KEY_3` - Room 2 API key 3

Room 3:
- `ROOM3_FREEPIK_KEY_1` - Room 3 API key 1
- `ROOM3_FREEPIK_KEY_2` - Room 3 API key 2
- `ROOM3_FREEPIK_KEY_3` - Room 3 API key 3

Room 4:
- `ROOM4_FREEPIK_KEY_1` - Room 4 API key 1
- `ROOM4_FREEPIK_KEY_2` - Room 4 API key 2
- `ROOM4_FREEPIK_KEY_3` - Room 4 API key 3

Room 5:
- `ROOM5_FREEPIK_KEY_1` - Room 5 API key 1
- `ROOM5_FREEPIK_KEY_2` - Room 5 API key 2
- `ROOM5_FREEPIK_KEY_3` - Room 5 API key 3

**Optional:**
- `ALLOWED_ORIGINS` - Your domain (e.g., `xclip.up.railway.app`)
- `PORT` - Usually auto-set by Railway

### 6. Done!
Railway will provide a URL like: `https://xclip-production.up.railway.app`

## Files for Railway
These files are already configured:
- `Procfile` - Start command for Railway
- `railway.toml` - Railway configuration
- `nixpacks.toml` - FFmpeg installation

## Troubleshooting

### npm "Exit handler never called!" / missing Express
The Docker build uses Node 22 and pinned npm 10.9.2, then installs production
dependencies with `npm ci --omit=dev`. The image build checks every declared
dependency before and after copying application files. Missing Express or any
other required module now fails the build rather than producing a broken image.

The workspace lockfile can contain Replit-only registry URLs. The Docker build
normalizes those URLs to the public npm registry while preserving package
versions and integrity hashes. This normalization happens inside the image;
the Replit-managed workspace lockfile is left unchanged.

Make sure the updated Dockerfile, package.json, package-lock.json, and scripts/
are included in the Railway build source. If Railway deploys a GitHub branch,
push these changes to that branch before redeploying; redeploying the old source
alone will not apply this fix. Verify `/api/health` after the new build.

### FFmpeg not found
FFmpeg is auto-installed via `nixpacks.toml`. If issues persist, Railway's nixpacks builder includes FFmpeg by default.

### Database connection error
Make sure PostgreSQL addon is added and `DATABASE_URL` is set.

### CORS errors
Set `ALLOWED_ORIGINS` to your Railway domain.

---
Created by MANAZIL
