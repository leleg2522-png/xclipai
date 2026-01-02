# Xclip - AI-Powered Video Clipping, Image Generation, Video Generation & Chat Tool

## Overview
Xclip is an AI-powered creative suite featuring four main tools:
1. **Video Clipper** - Transform long videos into viral short clips
2. **X Maker** - Generate consistent character images using AI with image-to-image support
3. **Video Gen** - Generate videos from images using Freepik API (image-to-video)
4. **AI Chat** - Chat with multiple LLM models from OpenRouter

**Created by:** MANAZIL

## Features

### Video Clipper
- Upload videos up to 1GB (MP4, MOV, AVI, MKV)
- AI-powered viral content detection via OpenRouter API
- Speech-to-text transcription via ElevenLabs API
- Automatic subtitle translation to 12+ languages
- Customizable output settings:
  - Resolution: 1080p, 720p, 480p
  - Aspect ratio: 9:16, 1:1, 4:5, 16:9
  - Number of clips: 1-10
  - Clip duration: 15-90 seconds
- Video preview before processing
- Viral score for each generated clip
- Download clips directly

### X Maker (Image Generator)
- **Multiple AI Models** - High-quality AI image generation
- **Image-to-Image**: Upload reference character for consistent generation (Mystic model only)
- Generate up to 15 images at once
- Requires subscription (separate XMaker rooms from Video Gen)
- AI Models:
  - Flux Pro v1.1 - Tercepat & kualitas terbaik (6x lebih cepat)
  - Flux Dev - Iterasi cepat, bagus untuk testing
  - Hyperflux - Konsisten untuk karakter & objek
  - Seedream 4 - Kreatif dengan kualitas seimbang
  - Classic Fast - Prototipe cepat, low latency
  - Mystic - Fotorealistik 4K, support referensi gambar
- Image Styles:
  - Realistic, Anime, Cartoon, Cinematic, Fantasy, Portrait
- Aspect Ratios: 1:1, 16:9, 9:16, 4:3
- Gallery with download functionality
- Room-based API key system (separate from Video Gen)
- Indonesian language UI
- Auto-kick inactive users from rooms after 5 minutes

### Video Gen (Image to Video)
- Convert static images to dynamic videos using Freepik API
- Multiple AI models available:
  - Kling V2.5 Pro (1080p HD, best quality)
  - Kling V2.1 Master (advanced motion control)
  - Kling Pro V2.1 (professional quality)
  - Kling Std V2.1 (budget friendly)
  - Kling 1.6 Pro (stable classic model)
  - MiniMax Hailuo 1080p/768p (with audio)
  - Seedance Pro 1080p/720p (long duration)
  - PixVerse V5 (transition effects)
- Duration options: 5 or 10 seconds
- Aspect ratios: 16:9, 9:16, 1:1
- Optional motion prompt for controlling animation
- Async processing with status polling

### AI Chat
- Multiple LLM models from OpenRouter:
  - OpenAI GPT-4o, GPT-4o Mini
  - Anthropic Claude 3.5 Sonnet, Claude 3 Haiku
  - Google Gemini Pro 1.5, Gemini Flash 1.5
  - Meta Llama 3.1 70B
  - Mistral Mixtral 8x7B
  - Alibaba Qwen 2 72B
  - DeepSeek Chat
- File upload support for document analysis
- Image upload support for vision capabilities
- Real-time typing indicators
- Message history with formatted responses
- Code syntax highlighting in responses

### User Authentication
- User registration with username, email, password
- Secure login with bcrypt password hashing
- Session management with PostgreSQL-backed sessions
- Personal API key storage for Video Gen
- User dropdown menu with logout and API key management
- Automatic API key loading on login

### Subscription Pricing System
- Multiple subscription packages:
  - 1 Hari (Rp 15.000) - 24-hour access
  - 3 Hari (Rp 35.000) - 3-day access
  - 1 Minggu (Rp 65.000) - 7-day access
  - 1 Bulan (Rp 199.000) - 30-day access
- Feature locking: All features locked until user subscribes
- Countdown timer showing remaining subscription time
- Pricing modal with plan selection
- Auto-expiration handling
- Each user limited to 1 Xclip API key per lifetime

## Architecture

### Server (Port 5000)
- Express.js combined server (frontend + API)
- FFmpeg for video processing
- Multer for file uploads
- Integration with ElevenLabs and OpenRouter APIs

### File Structure
```
/
├── server.js           # Combined server (frontend + API on port 5000)
├── client/
│   ├── index.html      # Main HTML
│   ├── src/
│   │   └── main.js     # Frontend app logic (video + xmaker + chat)
│   └── styles/
│       └── main.css    # Premium CSS with animations
├── uploads/            # Uploaded videos
└── processed/          # Generated clips
```

## API Endpoints

### Video Processing
- `POST /api/upload` - Upload video file
- `POST /api/process` - Start video processing
- `GET /api/job/:jobId` - Get job status and clips

### X Maker (Image Generation)
- `POST /api/generate-image` - Generate character images (supports reference image for image-to-image)

### Video Gen (Image to Video)
- `POST /api/generate-video` - Start video generation from image
- `GET /api/video-status/:model/:taskId` - Check video generation status

### AI Chat
- `POST /api/chat` - Send chat message with optional file/image attachments

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/update-api-key` - Save user's Xclip API key
- `GET /api/auth/get-api-key` - Get user's saved API key

### Subscription & Room Manager
- `GET /api/subscription/plans` - Get all subscription packages
- `GET /api/subscription/status` - Get user subscription status with remaining time
- `POST /api/subscription/buy` - Buy subscription package (requires planId)
- `GET /api/rooms` - Get all rooms with status
- `POST /api/room/select` - Join a room
- `POST /api/room/leave` - Leave current room

### Xclip API Keys
- `POST /api/xclip-keys/create` - Create new Xclip API key
- `GET /api/xclip-keys` - List user's active API keys
- `POST /api/xclip-keys/:id/revoke` - Revoke/deactivate an API key
- `POST /api/xclip-keys/:id/rename` - Rename an API key

### Video Gen Proxy (External API)
- `POST /api/videogen/proxy` - Generate video using Xclip API key (header: X-Xclip-Key)
- `GET /api/videogen/tasks/:taskId` - Check video generation status using Xclip API key
- `GET /api/xclip-keys/tasks` - List user's video generation tasks

### Utility
- `GET /api/health` - Health check

## Environment Variables

Required secrets for full functionality:
- `ELEVENLABS_API_KEY` - For speech-to-text transcription
- `OPENROUTER_API_KEY` - For viral content analysis, image generation, translation, and AI chat
- `FREEPIK_API_KEY` - For image-to-video generation

## Recent Changes
- December 16, 2025: Initial creation with full feature set
- December 16, 2025: Fixed upload error, combined servers, added premium UI animations
- December 29, 2025: Added AI Chat feature with multiple LLM models and file/image upload support
- December 29, 2025: Added X Maker image generator with consistent character generation
- December 29, 2025: Added image-to-image feature to X Maker, increased max images to 15
- December 30, 2025: Improved image generation with structured prompts for better accuracy
- December 30, 2025: Added Video Gen feature with Freepik API for image-to-video generation
- December 30, 2025: Added user authentication system with register, login, logout
- December 30, 2025: Added personal API key storage for Video Gen feature
- December 31, 2025: Added Room Manager system with subscription packages, room selection, and slot management
- December 31, 2025: Added Xclip API Keys system for external API access to video generation with hidden Freepik keys
- January 1, 2026: Implemented subscription pricing system with 4 tiers (1 day, 3 days, 1 week, 1 month)
- January 1, 2026: Added feature lock overlay for non-subscribers and countdown timer in header
- January 1, 2026: Fixed video generation URL extraction from Freepik API response
- January 1, 2026: Updated X Maker to use Freepik Mystic API engines (Sharpy, Sparkle, Illusio, Automatic)
- January 1, 2026: Added Room Manager system to X Maker with room selection (same as Video Gen)
- January 1, 2026: X Maker now uses Xclip API Keys as proxy to room's hidden Freepik API key
- January 1, 2026: Added Xclip API Key input field to X Maker for image generation
- January 1, 2026: Separated rooms for Video Gen and X Maker to prevent request conflicts

## User Preferences
- Clean, premium UI with white theme and gradient accents
- Indonesian language support prioritized
- MANAZIL credit prominently displayed
- Animated elements and glassmorphism effects
- Navigation menu for switching between Video Clipper, X Maker, and AI Chat
