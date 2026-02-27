# Xclip - AI-Powered Creative Suite

## Overview
Xclip is an AI-powered creative suite designed to transform content creation. It features tools for video clipping, consistent character image generation, image-to-video conversion, motion transfer, voice over, and AI chat. The project aims to provide users with a comprehensive platform for leveraging AI in visual content production and communication.

## User Preferences
- Clean, premium UI with white theme and gradient accents
- Indonesian language support prioritized
- MANAZIL credit prominently displayed
- Animated elements and glassmorphism effects
- Navigation menu for switching between Video Clipper, X Image, and AI Chat

## System Architecture
The application is built on a Node.js Express.js server, combining frontend and API functionalities. It uses FFmpeg for video processing and Multer for handling file uploads. The UI/UX features a modern SaaS-style design with a dark theme, neon glow effects, cyber grid background, and animated components. Key features include:

- **Video Clipper**: AI-driven viral content detection, speech-to-text transcription, multi-language subtitle translation, and customizable video output settings (resolution, aspect ratio, clip duration).
- **Video Gen (Image to Video)**: Converts static images to dynamic videos with real-time updates via Webhooks and Server-Sent Events (SSE). It offers multiple AI models and control over duration and aspect ratios. Uses Freepik API with room-based key rotation.
- **X Image (kie.ai Image Generator)**: AI-powered image generation with text-to-image and image-to-image modes. Migrated from Poyo.ai to kie.ai. Uses room-based API key system (XIMAGE_ROOM{N}_KEY_{1-3}) or XIMAGE_API_KEY fallback. Features include:
  - 12 AI models via kie.ai APIs:
    - seedream-4.5: Seedream 4.5 (ByteDance) via Market API, supports I2I, quality (basic/high)
    - flux-2-flex: FLUX.2 Flex (Black Forest Labs) via Market API, supports I2I, 1K/2K resolution
    - flux-2-pro: FLUX.2 Pro (Black Forest Labs) via Market API, supports I2I, 1K/2K resolution
    - google-nano-banana: Nano Banana (Google) via Market API, supports I2I
    - seedream-api: Seedream API/V4 (ByteDance) via Market API, supports I2I, named sizes, 1K/2K/4K resolution
    - gpt-image-1.5: 4o Image (OpenAI) via 4o-image API, supports I2I, N variants
    - flux-1-kontext: Flux.1 Kontext (Black Forest Labs) via Flux Kontext API, supports I2I, variant (pro/max)
    - imagen-4: Imagen 4 (Google) via Market API, text-only, N images, variant (fast/ultra/standard → google/imagen4-fast/ultra/imagen4)
    - ideogram-v3: Ideogram V3 (Ideogram) via Market API, supports I2I, named sizes, rendering_speed (TURBO/BALANCED/QUALITY), style (AUTO/GENERAL/REALISTIC/DESIGN)
    - ideogram-character: Ideogram Character (Ideogram) via Market API, supports I2I via image_url, N images, rendering_speed, style (AUTO/REALISTIC/FICTION)
    - qwen-image: Qwen Image Edit (Alibaba) via Market API, supports I2I via image_url, acceleration (none/regular/high)
    - z-image: Z-Image (Tongyi-MAI) via Market API, text-only
  - Three kie.ai API paths:
    - 4o-image: POST https://api.kie.ai/api/v1/gpt4o-image/generate, poll /record-info?taskId=
    - Market: POST https://api.kie.ai/api/v1/jobs/createTask, poll /jobs/recordInfo?taskId=
    - Flux Kontext: POST https://api.kie.ai/api/v1/flux/kontext/generate, poll /flux/kontext/record-info?taskId=
  - Market API size formats: aspect_ratio (ratio string), image_size (ratio string), or named sizes (square/portrait_4_3/landscape_16_9 etc.)
  - Base64 images converted to public URLs via local file storage for kie.ai I2I
  - Background polling types: kie-4o-image, kie-market, kie-flux-kontext
  - Auto model selection when switching to image-to-image mode
  - Image history persistence in database (ximage_history table)
  - Room assignment via Xclip API key (ximage_room_id in subscriptions table)
- **Vidgen3 (Freepik Video Playground)**: Advanced video generation using Freepik API with premium models. Uses its own separate room-based API key system (VIDGEN3_ROOM{N}_KEY_{1-3}). Features include:
  - 7 AI models with per-model playground settings:
    - MiniMax Live (I2V, animation, camera movements)
    - Seedance 1.5 Pro 1080p/720p (T2V + I2V, audio generation, 4-12s duration)
    - LTX 2.0 Pro (T2V + I2V, up to 2160p, 50fps)
    - LTX 2.0 Fast (T2V + I2V, ultra-fast, up to 20s duration)
    - RunWay Gen 4.5 (T2V + I2V, cinematic quality, multiple aspect ratios)
    - RunWay Gen4 Turbo (I2V, fast generation)
    - OmniHuman 1.5 (human animation from image + audio URL)
  - Database tables: vidgen3_rooms, vidgen3_tasks
  - Room assignment via vidgen3_room_id in subscriptions
  - SSE events: vidgen3_completed, vidgen3_failed
  - Video history persistence in database
  - Webhook integration for real-time task completion
- **Vidgen4 (Apimart.ai Video Generator)**: Video generation using Apimart.ai API. Uses room-based API key system (VIDGEN4_ROOM{N}_KEY_{1-3}) or APIMART_API_KEY fallback. Features include:
  - 2 AI models:
    - Sora 2 VIP (720p, 10/15 seconds, text-to-video + image-to-video, premium quality)
    - Veo 3.1 Fast (max 1080p, 8 seconds, text-to-video + start/end frame + reference image, GIF output)
  - Sora 2 playground: aspect_ratio (16:9/9:16), duration (10/15s), watermark, thumbnail, private, style (thanksgiving/comic/news/selfie/nostalgic/anime), storyboard
  - Veo 3.1 Fast playground: aspect_ratio (16:9/9:16), duration (8s fixed), resolution (720p/1080p), generation_type (frame/reference), enable_gif
  - Veo 3.1 frame mode: image_urls[0]=start frame, image_urls[1]=end frame
  - Veo 3.1 reference mode: image_urls for style reference (max 3)
  - Image reference via `image_urls` array
  - Database tables: vidgen4_rooms, vidgen4_tasks
  - Room assignment via vidgen4_room_id in subscriptions
  - Apimart.ai API: POST /v1/videos/generations to create, GET /v1/videos/{task_id} to poll
  - Response format: `{ code: 200, data: [{ task_id, status }] }`, poll: `{ code: 200, data: { status, result: { videos } } }`
  - Video history persistence in database
  - 5-minute cooldown timer between generations
- **X Image2 (Apimart.ai Image Generator)**: AI-powered image generation using Apimart.ai API with 11 models. Uses room-based API key system (XIMAGE2_ROOM{N}_KEY_{1-3}) or APIMART_API_KEY fallback. Features include:
  - 11 AI models:
    - GPT-4o Image (OpenAI, sizes: 1024x1024/1536x1024/1024x1536/auto, n: 1-4)
    - Nano Banana (Google Gemini 2.5 Flash, sizes: 1:1/16:9/9:16/4:3/3:4)
    - Nano Banana 2 (Google Gemini 3 Pro Preview, sizes: 1:1/4:3/3:4/16:9/9:16/3:2/2:3/21:9/9:21, resolution: 1K/2K/3K/4K, n: 1-4, max 5 refs, mask image support (PNG only, max 4MB))
    - Seedream 4.0 (ByteDance, sizes: 1:1/16:9/9:16/4:3/3:4/3:2/2:3, n: 1-4, watermark, sequential_generation)
    - Seedream 4.5 (ByteDance, same as 4.0 but latest version)
    - Seedream 5.0 Lite (ByteDance, sizes: 1:1/4:3/3:4/16:9/9:16/3:2/2:3/21:9/9:21, resolution: 1K/2K/3K/4K, n: 1-15, watermark, sequential, 4K output, perfect text rendering)
    - Flux Kontext Pro (Black Forest Labs, sizes: 1:1/16:9/9:16/4:3/3:4/3:2/2:3, safety_tolerance: 0-6, input_mode: auto/image/text, max 4 refs)
    - Flux Kontext Max (Black Forest Labs, same as Pro but highest quality)
    - Flux 2.0 Flex (Black Forest Labs, sizes: 1:1/16:9/9:16/4:3/3:4/3:2/2:3, resolution: 1K/2K)
    - Flux 2.0 Pro (Black Forest Labs, same as Flex plus prompt_upsampling)
  - Text-to-image and image-to-image modes with model-specific reference image limits
  - Per-model playground settings (watermark, sequential, safety tolerance, input mode, prompt upsampling)
  - Database tables: ximage2_rooms, ximage2_history
  - Room assignment via ximage2_room_id in subscriptions
  - Apimart.ai API: POST /v1/images/generations, GET /v1/tasks/{task_id}
  - Supports both synchronous (direct URL) and asynchronous (task polling) responses
  - 2-minute cooldown timer between generations
  - Image history persistence in database
- **Motion Control**: Transfers motion from reference videos to character images using Freepik's Kling 2.6 Motion Control API, with options for character and video orientation. Uses a separate room-based API key system (independent from Video Gen rooms) where users must join a Motion Room via Xclip API key to access the feature. Motion rooms have their own set of Freepik API keys (MOTION_ROOM1_KEY_1/2/3, etc.).
- **AI Chat**: Integrates with multiple LLM models from OpenRouter, offering file and image upload support, real-time typing indicators, and code syntax highlighting.
- **User Authentication**: Secure user registration and login with bcrypt hashing, session management using PostgreSQL-backed sessions, and personal API key storage.
- **Subscription System**: A tiered subscription model with feature locking, countdown timers, and manual QRIS payment verification.
- **Admin Dashboard**: Provides functionalities for managing payments and user subscriptions.
- **Rate Limiting System** (Video Gen & Motion): Three-layer API protection:
  - **Random Jitter**: Random delay (1-3s Video Gen, 2-5s Motion) between requests to avoid rate limiting patterns
  - **Daily Quota**: Max requests per API key per day (50/key Video Gen, 30/key Motion) with automatic daily reset
  - **User Cooldown**: Per-user wait time after generate (75s Video Gen, 180s Motion) with frontend countdown timer
- **Server-Side Background Polling**: All generation tasks (vidgen3, vidgen4, ximage, ximage2, videogen, motion) are polled server-side every 15 seconds. Tasks continue processing even when users switch apps or close browser. On server restart, pending tasks from the last hour are automatically resumed from database. Uses `serverBgPolls` Map with polling functions for kie.ai, Apimart.ai, and Freepik APIs.

## External Dependencies
- **Database**: PostgreSQL
- **AI/ML APIs**:
    - ElevenLabs API (for speech-to-text transcription)
    - OpenRouter API (for viral content analysis, image generation, translation, and AI chat with various LLMs like GPT-4o, Claude 3.5 Sonnet, Gemini Pro, Llama 3.1)
    - Freepik API (for image-to-video generation and motion control with Kling models)
    - Apimart.ai API (for Vidgen4 video generation with Sora 2 and Veo 3.1 Fast models, and X Image2 image generation with GPT-4o, Nano Banana, Seedream, Flux Kontext, Flux 2.0 models)
- **Deployment & Utilities**:
    - Multer (for file uploads)
    - FFmpeg (for video processing)
    - bcrypt (for password hashing)

## Replit Environment Setup
- **Runtime**: Node.js 20
- **Database**: PostgreSQL Railway (via DATABASE_PUBLIC_URL secret)
- **Port**: 5000 (Express server serves both API and static frontend)
- **Workflow**: `npm start` runs server.js
- **Deployment**: Configured for autoscale deployment

## Known Fixes Applied
- **Loading Stuck Issue**: Changed `client/src/main.js` script tag from `type="module"` to `defer`. ES module loading caused silent failures in some environments (Railway, mobile), resulting in the page stuck at "Loading Xclip..." indefinitely.
- **X-Frame-Options Removed**: Removed `X-Frame-Options: SAMEORIGIN` header from server.js that was blocking the Replit preview iframe.
- **render() Error Handling**: Added try-catch in `render()` function with a `showFallbackLoginUI()` fallback to prevent silent render failures.
- **checkAuth() Timeout**: Added 8-second AbortController timeout to the auth check fetch to prevent indefinite hanging.
- **initApp() Fallback**: Added 10-second timeout fallback in `initApp()` to force-show the login UI if loading takes too long.
- **Service Worker Cache**: Updated CACHE_NAME to 'xclip-v2' to bust old cached JS files.

## Running the Application
The application starts with `npm start` which runs `node server.js`. The server:
- Listens on 0.0.0.0:5000
- Serves static files from the `client/` directory
- Provides API endpoints for all features
- Connects to Railway PostgreSQL via DATABASE_PUBLIC_URL
- Uses PostgreSQL for sessions, users, subscriptions, and payments