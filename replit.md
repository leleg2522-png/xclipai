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
- **X Maker (Image Generator)**: Supports multiple AI models for high-quality image generation, including image-to-image consistency for characters, with various styles and aspect ratios. It includes a room-based API key system.
- **Video Gen (Image to Video)**: Converts static images to dynamic videos with real-time updates via Webhooks and Server-Sent Events (SSE). It offers multiple AI models and control over duration and aspect ratios.
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
- **Deployment & Utilities**:
    - Multer (for file uploads)
    - FFmpeg (for video processing)
    - bcrypt (for password hashing)