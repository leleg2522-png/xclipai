# Xclip - AI-Powered Creative Suite

## Overview
Xclip is an AI-powered creative suite designed to transform content creation. It features tools for video clipping, consistent character image generation, image-to-video conversion, motion transfer, and AI chat. The project aims to provide users with a comprehensive platform for leveraging AI in visual content production and communication.

## User Preferences
- Clean, premium UI with white theme and gradient accents
- Indonesian language support prioritized
- MANAZIL credit prominently displayed
- Animated elements and glassmorphism effects
- Navigation menu for switching between Video Clipper, X Maker, and AI Chat

## System Architecture
The application is built on a Node.js Express.js server, combining frontend and API functionalities. It uses FFmpeg for video processing and Multer for handling file uploads. The UI/UX features a modern SaaS-style design with a dark theme, neon glow effects, cyber grid background, and animated components. Key features include:

- **Video Clipper**: AI-driven viral content detection, speech-to-text transcription, multi-language subtitle translation, and customizable video output settings (resolution, aspect ratio, clip duration).
- **X Maker (Image Generator)**: Powered by GeminiGen.AI with models including Nano Banana (free, supports image reference for character consistency), Imagen 4 Fast, Imagen 4 Standard, and Imagen 4 Ultra (highest quality 2K). Uses a 3-room system (XMaker Room 1-3) with hidden GeminiGen API keys, accessed via Xclip API key as proxy.
- **Video Gen (Image to Video)**: Converts static images to dynamic videos with real-time updates via Webhooks and Server-Sent Events (SSE). It offers multiple AI models and control over duration and aspect ratios. Uses Freepik API with room-based key rotation.
- **Vidgen2 (Poyo.ai Video Generator)**: Video generation feature using Poyo.ai API with Sora 2, Sora 2 Pro, and Hailuo 02 models. Uses POYO_API_KEY or room-based API key system (VIDGEN2_ROOM{N}_KEY_{1-3}). Features include:
  - Image-to-video conversion with AI models (text-to-video and image reference support)
  - Models: Sora 2 (10s), Sora 2 (15s), Veo 3.1 Fast (8s)
  - Aspect ratios: 16:9 (landscape), 9:16 (portrait)
  - Video history persistence in database
  - Real-time task status polling via Poyo.ai status API
- **X Image (Poyo.ai Image Generator)**: AI-powered image generation with text-to-image and image-to-image modes. Uses room-based API key system (XIMAGE_ROOM{N}_KEY_{1-3}). Features include:
  - 8 AI models with Poyo.ai-compatible IDs:
    - gpt-image-1.5 / gpt-image-1.5-edit (OpenAI GPT Image 1.5)
    - gpt-4o-image / gpt-4o-image-edit (OpenAI GPT-4o)
    - nano-banana / nano-banana-edit (Google Gemini 2.5 Flash)
    - nano-banana-2 / nano-banana-2-edit (Google Gemini 3 Pro, supports 1K/2K/4K resolution)
    - seedream-4.5 / seedream-4.5-edit (ByteDance, 4K)
    - flux-2-pro / flux-2-pro-edit (Black Forest Labs FLUX.2, supports resolution)
    - z-image (Alibaba, text-to-image only)
    - grok-imagine-image (xAI Grok)
  - Request format: `{ model, input: { prompt, size, n, resolution, image_urls } }`
  - Size parameter: 1:1, 16:9, 9:16, 4:3, 3:4
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
- **X Image2 (Apimart.ai Image Generator)**: AI-powered image generation using Apimart.ai API with 9 models. Uses room-based API key system (XIMAGE2_ROOM{N}_KEY_{1-3}) or APIMART_API_KEY fallback. Features include:
  - 9 AI models:
    - GPT-4o Image (OpenAI, sizes: 1024x1024/1536x1024/1024x1536/auto, n: 1-4)
    - Nano Banana (Google Gemini 2.5 Flash, sizes: 1:1/16:9/9:16/4:3/3:4)
    - Nano Banana 2 (Google Gemini 3 Pro, sizes: 1:1/16:9/9:16/4:3/3:4, resolution: 1K/2K/4K, max 14 refs)
    - Seedream 4.0 (ByteDance, sizes: 1:1/16:9/9:16/4:3/3:4/3:2/2:3, n: 1-4, watermark, sequential_generation)
    - Seedream 4.5 (ByteDance, same as 4.0 but latest version)
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

## External Dependencies
- **Database**: PostgreSQL
- **AI/ML APIs**:
    - ElevenLabs API (for speech-to-text transcription)
    - OpenRouter API (for viral content analysis, image generation, translation, and AI chat with various LLMs like GPT-4o, Claude 3.5 Sonnet, Gemini Pro, Llama 3.1)
    - Freepik API (for image-to-video generation and motion control with Kling models)
    - GeminiGen.AI API (for X Maker image generation with Nano Banana and Imagen 4 models)
    - Poyo.ai API (for Vidgen2 video generation with Sora 2, Sora 2 Pro, Hailuo models and X Image generation with GPT Image, Nano Banana, Seedream, FLUX, Z-Image, Grok models)
    - Apimart.ai API (for Vidgen4 video generation with Sora 2 and Veo 3.1 Fast models, and X Image2 image generation with GPT-4o, Nano Banana, Seedream, Flux Kontext, Flux 2.0 models)
- **Deployment & Utilities**:
    - Multer (for file uploads)
    - FFmpeg (for video processing)
    - bcrypt (for password hashing)

## Replit Environment Setup
- **Runtime**: Node.js 20
- **Database**: PostgreSQL (Replit built-in via DATABASE_URL)
- **Port**: 5000 (Express server serves both API and static frontend)
- **Workflow**: `npm start` runs server.js
- **Deployment**: Configured for autoscale deployment

## Running the Application
The application starts with `npm start` which runs `node server.js`. The server:
- Listens on 0.0.0.0:5000
- Serves static files from the `client/` directory
- Provides API endpoints for all features
- Uses PostgreSQL for sessions, users, subscriptions, and payments