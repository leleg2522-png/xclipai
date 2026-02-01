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
- **Motion Control**: Transfers motion from reference videos to character images using Freepik's Kling 2.6 Motion Control API, with options for character and video orientation. Uses a separate room-based API key system (independent from Video Gen rooms) where users must join a Motion Room via Xclip API key to access the feature. Motion rooms have their own set of Freepik API keys (MOTION_ROOM1_KEY_1/2/3, etc.).
- **AI Chat**: Integrates with multiple LLM models from OpenRouter, offering file and image upload support, real-time typing indicators, and code syntax highlighting.
- **User Authentication**: Secure user registration and login with bcrypt hashing, session management using PostgreSQL-backed sessions, and personal API key storage.
- **Subscription System**: A tiered subscription model with feature locking, countdown timers, and manual QRIS payment verification.
- **Admin Dashboard**: Provides functionalities for managing payments and user subscriptions.

## External Dependencies
- **Database**: PostgreSQL
- **AI/ML APIs**:
    - ElevenLabs API (for speech-to-text transcription)
    - OpenRouter API (for viral content analysis, image generation, translation, and AI chat with various LLMs like GPT-4o, Claude 3.5 Sonnet, Gemini Pro, Llama 3.1)
    - Freepik API (for image-to-video generation and motion control with Kling models)
    - GeminiGen.AI API (for X Maker image generation with Nano Banana and Imagen 4 models)
    - Poyo.ai API (for Vidgen2 video generation with Sora 2, Sora 2 Pro, Hailuo models and X Image generation with GPT Image, Nano Banana, Seedream, FLUX, Z-Image, Grok models)
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