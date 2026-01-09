const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL
});

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

function isAllowedOrigin(origin) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    
    // Allow localhost
    if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '127.0.0.1') {
      return true;
    }
    
    // Allow common hosting platforms
    const trustedDomains = [
      'railway.app',
      'up.railway.app', 
      'replit.dev',
      'replit.app',
      'replit.co',
      'render.com',
      'onrender.com',
      'vercel.app',
      'netlify.app',
      'fly.dev'
    ];
    
    for (const domain of trustedDomains) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return true;
      }
    }
    
    // Check custom allowed origins
    for (const allowed of allowedOrigins) {
      if (hostname === allowed || hostname.endsWith('.' + allowed)) {
        return true;
      }
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

// Trust proxy for Railway/production HTTPS
app.set('trust proxy', 1);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) {
      callback(null, true);
    } else if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      console.log('CORS rejected origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'xclip-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

const INACTIVE_TIMEOUT_MINUTES = 5;

async function cleanupInactiveUsers() {
  try {
    const cutoffTime = new Date(Date.now() - INACTIVE_TIMEOUT_MINUTES * 60 * 1000);
    
    const inactiveVideoGen = await pool.query(`
      UPDATE subscriptions 
      SET room_id = NULL 
      WHERE room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, room_id
    `, [cutoffTime]);
    
    const inactiveXMaker = await pool.query(`
      UPDATE subscriptions 
      SET xmaker_room_id = NULL 
      WHERE xmaker_room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, xmaker_room_id
    `, [cutoffTime]);
    
    await pool.query(`
      UPDATE rooms r SET active_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE (s.room_id = r.id OR s.xmaker_room_id = r.id) 
        AND s.status = 'active' 
        AND s.expired_at > NOW()
      )
    `);
    
    const totalCleaned = inactiveVideoGen.rowCount + inactiveXMaker.rowCount;
    if (totalCleaned > 0) {
      console.log(`Cleaned up ${totalCleaned} inactive users from rooms`);
    }
  } catch (error) {
    console.error('Cleanup inactive users error:', error);
  }
}

app.use(async (req, res, next) => {
  if (req.session && req.session.userId) {
    try {
      await pool.query(
        'UPDATE subscriptions SET last_active = NOW() WHERE user_id = $1 AND status = $2',
        [req.session.userId, 'active']
      );
    } catch (error) {
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'client')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/processed', express.static(path.join(__dirname, 'processed')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }
});

// Storage for payment proof images
const paymentProofStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const proofDir = path.join(__dirname, 'uploads', 'payment_proofs');
    if (!fs.existsSync(proofDir)) {
      fs.mkdirSync(proofDir, { recursive: true });
    }
    cb(null, proofDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `proof-${uuidv4()}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const uploadPaymentProof = multer({
  storage: paymentProofStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max for proof images
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar (JPG, PNG, WEBP) yang diperbolehkan'));
    }
  }
});

const jobs = new Map();

app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    
    const jobId = uuidv4();
    const videoPath = req.file.path;
    const videoUrl = `/uploads/${req.file.filename}`;
    
    const metadata = await getVideoMetadata(videoPath);
    
    jobs.set(jobId, {
      id: jobId,
      status: 'uploaded',
      videoPath,
      videoUrl,
      filename: req.file.originalname,
      metadata,
      clips: [],
      progress: 0
    });
    
    res.json({
      jobId,
      videoUrl,
      filename: req.file.originalname,
      metadata
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      
      resolve({
        duration: metadata.format.duration,
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        fps: eval(videoStream?.r_frame_rate || '30/1'),
        hasAudio: !!audioStream,
        format: metadata.format.format_name,
        size: metadata.format.size
      });
    });
  });
}

app.post('/api/process', async (req, res) => {
  const { jobId, settings } = req.body;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  job.status = 'processing';
  job.settings = settings;
  job.progress = 0;
  
  res.json({ status: 'processing', jobId });
  
  processVideoAsync(job);
});

async function processVideoAsync(job) {
  try {
    const { settings } = job;
    
    job.progress = 10;
    job.status = 'extracting_audio';
    
    const audioPath = job.videoPath.replace(/\.[^/.]+$/, '.wav');
    await extractAudio(job.videoPath, audioPath);
    
    job.progress = 25;
    job.status = 'transcribing';
    
    let transcript = null;
    let segments = [];
    
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        transcript = await transcribeWithElevenLabs(audioPath);
        segments = transcript.segments || [];
      } catch (e) {
        console.log('ElevenLabs transcription failed:', e.message);
        segments = await createBasicSegments(job.metadata.duration, settings.clipDuration);
      }
    } else {
      segments = await createBasicSegments(job.metadata.duration, settings.clipDuration);
    }
    
    job.progress = 40;
    job.status = 'analyzing_viral';
    
    let viralScores = [];
    if (process.env.OPENROUTER_API_KEY && segments.length > 0) {
      try {
        viralScores = await analyzeViralPotential(segments, settings.targetLanguage);
      } catch (e) {
        console.log('Viral analysis failed:', e.message);
        viralScores = segments.map((_, i) => ({ index: i, score: 50 + Math.random() * 50 }));
      }
    } else {
      viralScores = segments.map((_, i) => ({ index: i, score: 50 + Math.random() * 50 }));
    }
    
    const sortedSegments = segments.map((seg, i) => ({
      ...seg,
      viralScore: viralScores.find(v => v.index === i)?.score || 50
    })).sort((a, b) => b.viralScore - a.viralScore);
    
    const clipCount = Math.min(settings.clipCount, sortedSegments.length);
    const selectedSegments = sortedSegments.slice(0, clipCount);
    
    job.progress = 50;
    job.status = 'generating_clips';
    
    const processedDir = path.join(__dirname, 'processed', job.id);
    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir, { recursive: true });
    }
    
    const clips = [];
    for (let i = 0; i < selectedSegments.length; i++) {
      const segment = selectedSegments[i];
      const clipPath = path.join(processedDir, `clip_${i + 1}.mp4`);
      
      await createClip(job.videoPath, clipPath, segment, settings);
      
      let translatedSubtitle = segment.text || '';
      if (settings.targetLanguage !== 'original' && process.env.OPENROUTER_API_KEY && segment.text) {
        try {
          translatedSubtitle = await translateText(segment.text, settings.targetLanguage);
        } catch (e) {
          console.log('Translation failed');
        }
      }
      
      clips.push({
        id: i + 1,
        path: `/processed/${job.id}/clip_${i + 1}.mp4`,
        startTime: segment.start,
        endTime: segment.end,
        duration: segment.end - segment.start,
        viralScore: segment.viralScore,
        subtitle: translatedSubtitle,
        originalText: segment.text || ''
      });
      
      job.progress = 50 + Math.floor((i + 1) / selectedSegments.length * 45);
    }
    
    try {
      fs.unlinkSync(audioPath);
    } catch (e) {}
    
    job.clips = clips;
    job.progress = 100;
    job.status = 'completed';
    
  } catch (error) {
    console.error('Processing error:', error);
    job.status = 'error';
    job.error = error.message;
  }
}

function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function transcribeWithElevenLabs(audioPath) {
  const formData = new FormData();
  const audioStream = fs.createReadStream(audioPath);
  formData.append('audio', audioStream, {
    filename: 'audio.wav',
    contentType: 'audio/wav'
  });
  formData.append('model_id', 'scribe_v1');
  
  const response = await axios.post(
    'https://api.elevenlabs.io/v1/speech-to-text',
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );
  
  const data = response.data;
  const segments = [];
  
  if (data.words && data.words.length > 0) {
    let currentSegment = { text: '', start: data.words[0].start, words: [] };
    let segmentDuration = 0;
    const maxSegmentDuration = 30;
    
    for (const word of data.words) {
      currentSegment.words.push(word);
      currentSegment.text += (currentSegment.text ? ' ' : '') + word.text;
      segmentDuration = word.end - currentSegment.start;
      
      if (segmentDuration >= maxSegmentDuration || word === data.words[data.words.length - 1]) {
        currentSegment.end = word.end;
        segments.push({
          text: currentSegment.text.trim(),
          start: currentSegment.start,
          end: currentSegment.end
        });
        if (data.words.indexOf(word) < data.words.length - 1) {
          const nextWord = data.words[data.words.indexOf(word) + 1];
          currentSegment = { text: '', start: nextWord.start, words: [] };
        }
      }
    }
  }
  
  return { ...data, segments };
}

async function createBasicSegments(duration, clipDuration) {
  const segments = [];
  const clipLength = parseInt(clipDuration) || 30;
  const numSegments = Math.floor(duration / clipLength);
  
  for (let i = 0; i < Math.min(numSegments, 10); i++) {
    segments.push({
      start: i * clipLength,
      end: Math.min((i + 1) * clipLength, duration),
      text: `Segment ${i + 1}`
    });
  }
  
  return segments;
}

async function analyzeViralPotential(segments, targetLanguage) {
  const prompt = `Analyze these video segments for viral potential. Rate each from 0-100 based on engagement potential.
  
Segments:
${segments.map((s, i) => `${i}: "${s.text || 'No text'}" (${s.start}s - ${s.end}s)`).join('\n')}

Return JSON array: [{"index": 0, "score": 85}, ...]`;

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  try {
    const content = response.data.choices[0].message.content;
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {}
  
  return segments.map((_, i) => ({ index: i, score: Math.floor(50 + Math.random() * 50) }));
}

async function translateText(text, targetLanguage) {
  const langMap = {
    'id': 'Indonesian',
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'pt': 'Portuguese',
    'ru': 'Russian'
  };
  
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: 'openai/gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Translate to ${langMap[targetLanguage] || targetLanguage}: "${text}". Return only the translation.`
      }]
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  return response.data.choices[0].message.content.trim();
}

function createClip(inputPath, outputPath, segment, settings) {
  return new Promise((resolve, reject) => {
    const { resolution, aspectRatio } = settings;
    
    let width, height;
    switch (resolution) {
      case '1080p':
        height = 1080;
        break;
      case '720p':
        height = 720;
        break;
      case '480p':
        height = 480;
        break;
      default:
        height = 720;
    }
    
    let aspectWidth, aspectHeight;
    switch (aspectRatio) {
      case '9:16':
        aspectWidth = 9;
        aspectHeight = 16;
        break;
      case '1:1':
        aspectWidth = 1;
        aspectHeight = 1;
        break;
      case '4:5':
        aspectWidth = 4;
        aspectHeight = 5;
        break;
      default:
        aspectWidth = 16;
        aspectHeight = 9;
    }
    
    width = Math.round(height * (aspectWidth / aspectHeight));
    if (width % 2 !== 0) width++;
    
    ffmpeg(inputPath)
      .setStartTime(segment.start)
      .setDuration(segment.end - segment.start)
      .videoFilters([
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

app.get('/api/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    clips: job.clips,
    error: job.error,
    metadata: job.metadata
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============ SSE & WEBHOOK FOR REAL-TIME VIDEO UPDATES ============

// Store SSE connections by user ID
const sseConnections = new Map();

// SSE endpoint for real-time video updates
app.get('/api/video-events', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login required' });
  }
  
  const userId = req.session.userId;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Don't override CORS - let the existing middleware handle it
  res.flushHeaders();
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`);
  
  // Store connection
  if (!sseConnections.has(userId)) {
    sseConnections.set(userId, new Set());
  }
  sseConnections.get(userId).add(res);
  
  console.log(`SSE connected: user ${userId}, total connections: ${sseConnections.get(userId).size}`);
  
  // Keep-alive ping every 30 seconds
  const pingInterval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
  }, 30000);
  
  // Cleanup on close
  req.on('close', () => {
    clearInterval(pingInterval);
    const userConnections = sseConnections.get(userId);
    if (userConnections) {
      userConnections.delete(res);
      if (userConnections.size === 0) {
        sseConnections.delete(userId);
      }
    }
    console.log(`SSE disconnected: user ${userId}`);
  });
});

// Function to send SSE event to user
function sendSSEToUser(userId, data) {
  const connections = sseConnections.get(userId);
  if (connections && connections.size > 0) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    connections.forEach(res => {
      try {
        res.write(message);
      } catch (e) {
        console.error('SSE write error:', e);
      }
    });
    return true;
  }
  return false;
}

// Webhook endpoint for Freepik notifications
// Uses internal task ID verification for security (only accepts known task IDs)
app.post('/api/webhook/freepik', async (req, res) => {
  try {
    // Basic validation: must have a task_id that exists in our database
    // This prevents arbitrary injection since only our tasks are accepted
    const data = req.body.data || req.body;
    const taskId = data.task_id || req.body.task_id;
    
    if (!taskId) {
      console.log('Webhook rejected: No task_id in payload');
      return res.status(200).json({ received: true, error: 'No task_id' });
    }
    
    // Verify task exists in our database before processing
    const taskCheck = await pool.query(
      'SELECT id FROM video_generation_tasks WHERE task_id = $1',
      [taskId]
    );
    
    if (taskCheck.rows.length === 0) {
      console.log('Webhook rejected: Unknown task_id:', taskId);
      return res.status(200).json({ received: true, error: 'Unknown task' });
    }
    
    const webhookReceivedAt = new Date().toISOString();
    console.log(`[TIMING] Webhook received for task ${taskId} at ${webhookReceivedAt}`);
    
    const status = (data.status || req.body.status || '').toLowerCase();
    
    // Find the task in database (already verified above, now get full details)
    const taskResult = await pool.query(
      `SELECT t.*, k.user_id 
       FROM video_generation_tasks t 
       JOIN xclip_api_keys k ON k.id = t.xclip_api_key_id
       WHERE t.task_id = $1`,
      [taskId]
    );
    
    const task = taskResult.rows[0];
    
    // Extract video URL
    let videoUrl = null;
    if (data.generated && data.generated.length > 0) {
      videoUrl = data.generated[0];
    } else if (data.video_url) {
      videoUrl = data.video_url;
    } else if (data.video?.url) {
      videoUrl = data.video.url;
    } else if (data.result?.video_url) {
      videoUrl = data.result.video_url;
    } else if (data.url) {
      videoUrl = data.url;
    }
    
    const isCompleted = status === 'completed' || status === 'success' || 
                       (videoUrl && status !== 'processing' && status !== 'pending');
    const isFailed = status === 'failed' || status === 'error';
    
    if (isCompleted && videoUrl) {
      // Update database
      await pool.query(
        'UPDATE video_generation_tasks SET status = $1, video_url = $2, completed_at = CURRENT_TIMESTAMP WHERE task_id = $3',
        ['completed', videoUrl, taskId]
      );
      
      // Send SSE to user for instant notification
      const sent = sendSSEToUser(task.user_id, {
        type: 'video_completed',
        taskId: taskId,
        videoUrl: videoUrl,
        model: task.model
      });
      
      console.log(`Webhook: Video completed! Task ${taskId}, SSE sent: ${sent}`);
    } else if (isFailed) {
      await pool.query(
        'UPDATE video_generation_tasks SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE task_id = $2',
        ['failed', taskId]
      );
      
      sendSSEToUser(task.user_id, {
        type: 'video_failed',
        taskId: taskId,
        error: data.error || 'Video generation failed'
      });
      
      console.log(`Webhook: Video failed! Task ${taskId}`);
    } else {
      // Progress update
      sendSSEToUser(task.user_id, {
        type: 'video_progress',
        taskId: taskId,
        status: status,
        progress: data.progress || 0
      });
    }
    
    res.status(200).json({ received: true });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ received: true, error: error.message });
  }
});

// Get webhook URL for current environment
function getWebhookUrl() {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS;
  if (domain) {
    return `https://${domain}/api/webhook/freepik`;
  }
  if (process.env.APP_URL) {
    return `${process.env.APP_URL}/api/webhook/freepik`;
  }
  return null;
}

// ============ END SSE & WEBHOOK ============

// Live Statistics API
let onlineUsers = new Set();
let recentPurchases = [];

app.get('/api/stats/live', async (req, res) => {
  try {
    const sessionId = req.sessionID;
    onlineUsers.add(sessionId);
    
    setTimeout(() => {
      onlineUsers.delete(sessionId);
    }, 60000);
    
    const baseOnline = 280 + Math.floor(Math.random() * 150);
    const totalOnline = baseOnline + onlineUsers.size;
    
    const last5Purchases = recentPurchases.slice(-5);
    
    res.json({
      onlineCount: totalOnline,
      recentPurchases: last5Purchases
    });
  } catch (error) {
    res.json({ onlineCount: 300, recentPurchases: [] });
  }
});

app.get('/api/stats/purchases', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, u.username, sp.name as plan_name, sp.price_idr, s.created_at
      FROM subscriptions s
      JOIN users u ON s.user_id = u.id
      JOIN subscription_plans sp ON s.plan_id = sp.id
      WHERE s.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY s.created_at DESC
      LIMIT 20
    `);
    
    const purchases = result.rows.map(row => ({
      username: row.username.substring(0, 2) + '***' + row.username.slice(-1),
      planName: row.plan_name,
      price: row.price_idr,
      time: row.created_at
    }));
    
    res.json({ purchases });
  } catch (error) {
    res.json({ purchases: [] });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, dan password diperlukan' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }
    
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email atau username sudah terdaftar' });
    }
    
    const passwordHash = await bcrypt.hash(password, 12);
    
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, passwordHash]
    );
    
    const user = result.rows[0];
    req.session.userId = user.id;
    
    res.json({ 
      success: true, 
      user: { id: user.id, username: user.username, email: user.email }
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registrasi gagal' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt for:', email);
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan password diperlukan' });
    }
    
    const result = await pool.query(
      'SELECT id, username, email, password_hash, freepik_api_key FROM users WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      console.log('User not found:', email);
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      console.log('Invalid password for:', email);
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    
    req.session.userId = user.id;
    
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Login gagal - session error' });
      }
      
      console.log('Login successful for:', user.username, 'Session ID:', req.sessionID);
      res.json({ 
        success: true, 
        user: { 
          id: user.id, 
          username: user.username, 
          email: user.email,
          hasApiKey: !!user.freepik_api_key
        }
      });
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login gagal' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout gagal' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  
  try {
    const result = await pool.query(
      'SELECT id, username, email, freepik_api_key FROM users WHERE id = $1',
      [req.session.userId]
    );
    
    if (result.rows.length === 0) {
      return res.json({ user: null });
    }
    
    const user = result.rows[0];
    res.json({ 
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email,
        hasApiKey: !!user.freepik_api_key
      }
    });
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Gagal mengambil data user' });
  }
});

app.post('/api/auth/update-api-key', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  try {
    const { apiKey } = req.body;
    
    await pool.query(
      'UPDATE users SET freepik_api_key = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [apiKey || null, req.session.userId]
    );
    
    res.json({ success: true, hasApiKey: !!apiKey });
    
  } catch (error) {
    console.error('Update API key error:', error);
    res.status(500).json({ error: 'Gagal menyimpan API key' });
  }
});

app.get('/api/auth/get-api-key', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ apiKey: null });
  }
  
  try {
    const result = await pool.query(
      'SELECT freepik_api_key FROM users WHERE id = $1',
      [req.session.userId]
    );
    
    if (result.rows.length === 0) {
      return res.json({ apiKey: null });
    }
    
    res.json({ apiKey: result.rows[0].freepik_api_key });
    
  } catch (error) {
    console.error('Get API key error:', error);
    res.status(500).json({ error: 'Gagal mengambil API key' });
  }
});

function generateXclipApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'xclip_';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

app.post('/api/xclip-keys/create', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  try {
    // Check if user already has any API key (active or revoked)
    const existingKey = await pool.query(
      'SELECT id FROM xclip_api_keys WHERE user_id = $1 LIMIT 1',
      [req.session.userId]
    );
    
    if (existingKey.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Anda sudah memiliki Xclip API Key. Setiap user hanya bisa memiliki 1 API key seumur hidup.' 
      });
    }
    
    const { label } = req.body;
    const apiKey = generateXclipApiKey();
    
    const result = await pool.query(
      'INSERT INTO xclip_api_keys (user_id, api_key, label) VALUES ($1, $2, $3) RETURNING id, api_key, label, created_at',
      [req.session.userId, apiKey, label || 'Default Key']
    );
    
    res.json({
      success: true,
      key: result.rows[0]
    });
    
  } catch (error) {
    console.error('Create Xclip API key error:', error);
    res.status(500).json({ error: 'Gagal membuat Xclip API key' });
  }
});

app.get('/api/xclip-keys', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  try {
    const result = await pool.query(
      'SELECT id, api_key, label, status, requests_count, last_used_at, created_at FROM xclip_api_keys WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC',
      [req.session.userId, 'active']
    );
    
    res.json({ keys: result.rows });
    
  } catch (error) {
    console.error('Get Xclip API keys error:', error);
    res.status(500).json({ error: 'Gagal mengambil Xclip API keys' });
  }
});

app.post('/api/xclip-keys/:id/revoke', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'UPDATE xclip_api_keys SET status = $1, revoked_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING id',
      ['revoked', id, req.session.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'API key tidak ditemukan' });
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Revoke Xclip API key error:', error);
    res.status(500).json({ error: 'Gagal menonaktifkan API key' });
  }
});

app.post('/api/xclip-keys/:id/rename', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  try {
    const { id } = req.params;
    const { label } = req.body;
    
    const result = await pool.query(
      'UPDATE xclip_api_keys SET label = $1 WHERE id = $2 AND user_id = $3 RETURNING id, label',
      [label, id, req.session.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'API key tidak ditemukan' });
    }
    
    res.json({ success: true, key: result.rows[0] });
    
  } catch (error) {
    console.error('Rename Xclip API key error:', error);
    res.status(500).json({ error: 'Gagal mengubah nama API key' });
  }
});

async function validateXclipApiKey(apiKey) {
  // First check if the API key exists and is active
  const keyResult = await pool.query(
    `SELECT k.id, k.user_id, k.status, u.is_admin
     FROM xclip_api_keys k
     JOIN users u ON u.id = k.user_id
     WHERE k.api_key = $1 AND k.status = 'active'`,
    [apiKey]
  );
  
  if (keyResult.rows.length === 0) {
    return null;
  }
  
  const keyInfo = keyResult.rows[0];
  
  // Check for active subscription (but don't fail if none - admin bypass)
  const subResult = await pool.query(
    `SELECT s.room_id, r.key_name_1, r.key_name_2, r.key_name_3, r.provider_key_name
     FROM subscriptions s
     LEFT JOIN rooms r ON r.id = s.room_id
     WHERE s.user_id = $1 AND s.status = 'active' AND s.expired_at > CURRENT_TIMESTAMP
     ORDER BY s.expired_at DESC
     LIMIT 1`,
    [keyInfo.user_id]
  );
  
  if (subResult.rows.length > 0) {
    // User has active subscription
    return {
      ...keyInfo,
      room_id: subResult.rows[0].room_id,
      key_name_1: subResult.rows[0].key_name_1,
      key_name_2: subResult.rows[0].key_name_2,
      key_name_3: subResult.rows[0].key_name_3,
      provider_key_name: subResult.rows[0].provider_key_name
    };
  }
  
  // No active subscription - allow if admin, otherwise still return key info
  // (the getRotatedApiKey will handle fallback to user's personal key or default)
  return {
    ...keyInfo,
    room_id: null,
    key_name_1: null,
    key_name_2: null,
    key_name_3: null,
    provider_key_name: null
  };
}

function getRotatedApiKey(keyInfo, forceKeyIndex = null) {
  const keyNames = [keyInfo.key_name_1, keyInfo.key_name_2, keyInfo.key_name_3].filter(k => k);
  const keys = keyNames.map(name => process.env[name]).filter(k => k);
  
  if (keys.length === 0) {
    if (keyInfo.provider_key_name) {
      return { key: process.env[keyInfo.provider_key_name] || process.env.FREEPIK_API_KEY, keyIndex: 0 };
    }
    return { key: null, keyIndex: 0 };
  }
  
  let keyIndex;
  if (forceKeyIndex !== null && forceKeyIndex >= 0 && forceKeyIndex < keys.length) {
    keyIndex = forceKeyIndex;
    console.log(`Using saved key index: ${keyIndex + 1} of ${keys.length}`);
  } else {
    const rotationMinutes = 3;
    const currentMinute = Math.floor(Date.now() / (rotationMinutes * 60 * 1000));
    keyIndex = currentMinute % keys.length;
    console.log(`API key rotation: using key ${keyIndex + 1} of ${keys.length}`);
  }
  
  return { key: keys[keyIndex], keyIndex };
}

app.post('/api/videogen/proxy', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan. Tambahkan header X-Xclip-Key' });
    }
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid atau sudah tidak aktif' });
    }
    
    let freepikApiKey = null;
    let usedKeyIndex = null;
    let keySource = 'none';
    
    // PRIORITY 1: User's personal API key (FASTEST - no queue!)
    const userResult = await pool.query('SELECT freepik_api_key FROM users WHERE id = $1', [keyInfo.user_id]);
    if (userResult.rows.length > 0 && userResult.rows[0].freepik_api_key) {
      freepikApiKey = userResult.rows[0].freepik_api_key;
      keySource = 'personal';
      console.log(`[SPEED] Using user's personal API key - no queue delay!`);
    }
    
    // PRIORITY 2: Room's rotated key if user has subscription (shared pool)
    if (!freepikApiKey && keyInfo.room_id) {
      const rotated = getRotatedApiKey(keyInfo);
      freepikApiKey = rotated.key;
      usedKeyIndex = rotated.keyIndex;
      keySource = 'room';
    }
    
    // PRIORITY 3: For admins without subscription, use any available room key
    if (!freepikApiKey && keyInfo.is_admin) {
      const roomKeys = ['ROOM1_FREEPIK_KEY_1', 'ROOM1_FREEPIK_KEY_2', 'ROOM1_FREEPIK_KEY_3',
                       'ROOM2_FREEPIK_KEY_1', 'ROOM2_FREEPIK_KEY_2', 'ROOM2_FREEPIK_KEY_3',
                       'ROOM3_FREEPIK_KEY_1', 'ROOM3_FREEPIK_KEY_2', 'ROOM3_FREEPIK_KEY_3'];
      for (const keyName of roomKeys) {
        if (process.env[keyName]) {
          freepikApiKey = process.env[keyName];
          keySource = 'admin';
          console.log(`Admin using fallback key: ${keyName}`);
          break;
        }
      }
    }
    
    // PRIORITY 4: Global default key
    if (!freepikApiKey) {
      freepikApiKey = process.env.FREEPIK_API_KEY;
      keySource = 'global';
    }
    
    if (!freepikApiKey) {
      return res.status(500).json({ error: 'Tidak ada API key yang tersedia. Silakan beli paket langganan.' });
    }
    
    const { model, image, prompt, duration, aspectRatio } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: 'Image diperlukan' });
    }
    
    await pool.query(
      'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [keyInfo.id]
    );
    
    const modelConfigs = {
      'kling-v2.5-turbo': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2.5-turbo-pro' },
      'kling-v2.5-pro': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2-5-pro' },
      'kling-v2.1-master': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2-1-master' },
      'kling-v2.1-pro': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2-1-pro' },
      'kling-v2.1-std': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2-1-std' },
      'kling-v1.6-pro': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v1-6-pro' },
      'minimax-hailuo-1080p': { api: 'minimax', endpoint: '/v1/ai/image-to-video/minimax-hailuo-1080p' },
      'minimax-hailuo-768p': { api: 'minimax', endpoint: '/v1/ai/image-to-video/minimax-hailuo-768p' },
      'seedance-pro-1080p': { api: 'seedance', endpoint: '/v1/ai/image-to-video/seedance-1-0-pro-1080p' },
      'seedance-pro-720p': { api: 'seedance', endpoint: '/v1/ai/image-to-video/seedance-1-0-pro-720p' },
      'pixverse-v5': { api: 'pixverse', endpoint: '/v1/ai/image-to-video/pixverse-v5' }
    };
    
    const config = modelConfigs[model] || modelConfigs['kling-v2.5-pro'];
    const baseUrl = 'https://api.freepik.com';
    
    // Map aspect ratio to Freepik format
    const aspectRatioMap = {
      '1:1': 'square_1_1',
      '9:16': 'social_story_9_16',
      '16:9': 'widescreen_16_9',
      'square_1_1': 'square_1_1',
      'social_story_9_16': 'social_story_9_16',
      'widescreen_16_9': 'widescreen_16_9'
    };
    const mappedAspectRatio = aspectRatioMap[aspectRatio] || 'widescreen_16_9';
    
    // Get webhook URL for instant notifications
    const webhookUrl = getWebhookUrl();
    console.log(`Using webhook callback: ${webhookUrl}`);
    
    let requestBody = {};
    
    if (config.api === 'kling-ai') {
      requestBody = {
        image: image,
        prompt: prompt || '',
        duration: duration || '5',
        aspect_ratio: mappedAspectRatio,
        cfg_scale: 0.3
      };
    } else if (config.api === 'minimax') {
      requestBody = {
        image: image,
        prompt: prompt || '',
        prompt_optimizer: true
      };
    } else if (config.api === 'seedance') {
      requestBody = {
        image: image,
        prompt: prompt || '',
        duration: duration || '5',
        resolution: model.includes('1080p') ? '1080p' : '720p',
        seed: Math.floor(Math.random() * 1000000)
      };
    } else if (config.api === 'pixverse') {
      requestBody = {
        image: image,
        prompt: prompt || '',
        duration: duration || '5',
        quality: 'high',
        aspect_ratio: mappedAspectRatio,
        negative_prompt: '',
        seed: Math.floor(Math.random() * 1000000),
        motion_mode: 'normal',
        template_id: null
      };
    } else if (config.api === 'wan') {
      requestBody = {
        image: image,
        prompt: prompt || '',
        duration: duration || '5',
        aspect_ratio: mappedAspectRatio
      };
    }
    
    // Add webhook callback URL for instant notifications
    if (webhookUrl) {
      requestBody.webhook_url = webhookUrl;
    }
    
    const startTime = Date.now();
    console.log(`[TIMING] Starting Freepik request at ${new Date().toISOString()} | Model: ${model} | KeySource: ${keySource}`);
    
    const response = await axios.post(
      `${baseUrl}${config.endpoint}`,
      requestBody,
      {
        headers: {
          'x-freepik-api-key': freepikApiKey,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );
    
    const taskId = response.data.data?.task_id || response.data.task_id;
    const requestTime = new Date().toISOString();
    const createLatency = Date.now() - startTime;
    
    console.log(`[TIMING] Task ${taskId} created in ${createLatency}ms at ${requestTime} | Model: ${model}`);
    
    if (taskId) {
      await pool.query(
        'INSERT INTO video_generation_tasks (xclip_api_key_id, user_id, room_id, task_id, model, key_index) VALUES ($1, $2, $3, $4, $5, $6)',
        [keyInfo.id, keyInfo.user_id, keyInfo.room_id, taskId, model, usedKeyIndex]
      );
    }
    
    res.json({
      success: true,
      taskId: taskId,
      model: model,
      createdAt: requestTime
    });
    
  } catch (error) {
    console.error('Xclip proxy error:', JSON.stringify(error.response?.data, null, 2) || error.message);
    console.error('Full error details:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    const errorMsg = error.response?.data?.detail || error.response?.data?.message || error.response?.data?.error || error.message;
    res.status(500).json({ error: 'Gagal memproses permintaan: ' + errorMsg });
  }
});

app.get('/api/videogen/tasks/:taskId', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    const { taskId } = req.params;
    const { model } = req.query;
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    const taskResult = await pool.query(
      'SELECT * FROM video_generation_tasks WHERE task_id = $1 AND xclip_api_key_id = $2',
      [taskId, keyInfo.id]
    );
    
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task tidak ditemukan atau bukan milik API key ini' });
    }
    
    const savedTask = taskResult.rows[0];
    let freepikApiKey = null;
    
    // PRIORITY 1: User's personal API key (FASTEST)
    const userResult = await pool.query('SELECT freepik_api_key FROM users WHERE id = $1', [keyInfo.user_id]);
    if (userResult.rows.length > 0 && userResult.rows[0].freepik_api_key) {
      freepikApiKey = userResult.rows[0].freepik_api_key;
    }
    
    // PRIORITY 2: Room's rotated key
    if (!freepikApiKey && keyInfo.room_id) {
      const rotated = getRotatedApiKey(keyInfo, savedTask.key_index);
      freepikApiKey = rotated.key;
    }
    
    // PRIORITY 3: Global default
    if (!freepikApiKey) {
      freepikApiKey = process.env.FREEPIK_API_KEY;
    }
    
    const statusEndpoints = {
      'kling-v2.5-turbo': '/v1/ai/image-to-video/kling-v2-5-pro/',
      'kling-v2.5-pro': '/v1/ai/image-to-video/kling-v2-5-pro/',
      'kling-v2.1-master': '/v1/ai/image-to-video/kling-v2-1/',
      'kling-v2.1-pro': '/v1/ai/image-to-video/kling-v2-1/',
      'kling-v2.1-std': '/v1/ai/image-to-video/kling-v2-1/',
      'kling-v1.6-pro': '/v1/ai/image-to-video/kling-pro/',
      'minimax-hailuo-1080p': '/v1/ai/image-to-video/minimax-hailuo-1080p/',
      'minimax-hailuo-768p': '/v1/ai/image-to-video/minimax-hailuo-768p/',
      'seedance-pro-1080p': '/v1/ai/image-to-video/seedance-1-0-pro-1080p/',
      'seedance-pro-720p': '/v1/ai/image-to-video/seedance-1-0-pro-720p/',
      'pixverse-v5': '/v1/ai/image-to-video/pixverse-v5/'
    };
    
    const endpoint = statusEndpoints[model] || statusEndpoints['kling-v2.5-pro'];
    
    const pollStart = Date.now();
    const response = await axios.get(
      `https://api.freepik.com${endpoint}${taskId}`,
      {
        headers: {
          'x-freepik-api-key': freepikApiKey
        },
        timeout: 10000
      }
    );
    const pollLatency = Date.now() - pollStart;
    
    const data = response.data.data || response.data;
    console.log(`[TIMING] Poll ${taskId} | Status: ${data.status} | Latency: ${pollLatency}ms`);
    
    // Enhanced video URL extraction - check all possible locations
    let videoUrl = null;
    if (data.generated && data.generated.length > 0) {
      videoUrl = data.generated[0];
    } else if (data.video_url) {
      videoUrl = data.video_url;
    } else if (data.video?.url) {
      videoUrl = data.video.url;
    } else if (data.result?.video_url) {
      videoUrl = data.result.video_url;
    } else if (data.output?.video_url) {
      videoUrl = data.output.video_url;
    } else if (data.result?.url) {
      videoUrl = data.result.url;
    } else if (data.output?.url) {
      videoUrl = data.output.url;
    } else if (data.url) {
      videoUrl = data.url;
    }
    
    // Check multiple completion status formats
    const isCompleted = data.status === 'COMPLETED' || data.status === 'completed' || 
                       data.status === 'SUCCESS' || data.status === 'success' ||
                       (videoUrl && data.status !== 'PROCESSING' && data.status !== 'processing' && data.status !== 'PENDING');
    
    if (isCompleted && videoUrl) {
      pool.query(
        'UPDATE video_generation_tasks SET status = $1, video_url = $2, completed_at = CURRENT_TIMESTAMP WHERE task_id = $3',
        ['completed', videoUrl, taskId]
      ).catch(e => console.error('DB update error:', e));
      
      return res.json({
        status: 'completed',
        progress: 100,
        videoUrl: videoUrl,
        taskId: taskId
      });
    }
    
    // Return current status
    const normalizedStatus = (data.status || 'processing').toLowerCase();
    res.json({
      status: normalizedStatus === 'completed' || normalizedStatus === 'success' ? 'completed' : normalizedStatus,
      progress: data.progress || 0,
      videoUrl: videoUrl,
      taskId: taskId
    });
    
  } catch (error) {
    console.error('Get task status error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Gagal mengambil status task' });
  }
});

app.get('/api/xclip-keys/tasks', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  try {
    const result = await pool.query(
      `SELECT t.*, k.label as key_label, k.api_key
       FROM video_generation_tasks t
       JOIN xclip_api_keys k ON k.id = t.xclip_api_key_id
       WHERE k.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [req.session.userId]
    );
    
    res.json({ tasks: result.rows });
    
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Gagal mengambil daftar task' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { model, messages } = req.body;
    
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'OpenRouter API key not configured' });
    }
    
    const formattedMessages = messages.map(msg => {
      const content = [];
      
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          if (att.type && att.type.startsWith('image/')) {
            content.push({
              type: 'image_url',
              image_url: { url: att.data }
            });
          } else if (att.data) {
            const textContent = att.data.includes('base64,') 
              ? Buffer.from(att.data.split('base64,')[1], 'base64').toString('utf-8').slice(0, 5000)
              : att.data.slice(0, 5000);
            content.push({
              type: 'text',
              text: `[File: ${att.name}]\n${textContent}`
            });
          }
        }
      }
      
      return {
        role: msg.role,
        content: content.length === 1 && content[0].type === 'text' ? content[0].text : content
      };
    });
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: model || 'openai/gpt-4o-mini',
        messages: formattedMessages
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const assistantMessage = response.data.choices[0].message.content;
    res.json({ content: assistantMessage });
    
  } catch (error) {
    console.error('Chat error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to process chat request' });
  }
});

app.post('/api/generate-image', async (req, res) => {
  try {
    const { model, prompt, imageCount, style, aspectRatio, referenceImage } = req.body;
    const xclipKey = req.headers['x-xclip-key'];
    
    let apiKey = null;
    
    if (xclipKey) {
      const keyResult = await pool.query(`
        SELECT xk.id, xk.user_id, s.xmaker_room_id, r.key_name_1, r.key_name_2, r.key_name_3, r.provider_key_name
        FROM xclip_api_keys xk
        JOIN users u ON xk.user_id = u.id
        LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active' AND s.expired_at > NOW()
        LEFT JOIN rooms r ON s.xmaker_room_id = r.id
        WHERE xk.api_key = $1 AND xk.status = 'active'
      `, [xclipKey]);
      
      if (keyResult.rows.length === 0) {
        return res.status(401).json({ error: 'Xclip API key tidak valid atau sudah tidak aktif' });
      }
      
      const keyData = keyResult.rows[0];
      if (!keyData.xmaker_room_id) {
        return res.status(403).json({ error: 'Belum pilih XMaker Room. Silakan pilih room di X Maker terlebih dahulu.' });
      }
      
      apiKey = getRotatedApiKey(keyData);
    } else if (req.session.userId) {
      const roomKey = await getRoomApiKey(req.session.userId, 'xmaker');
      if (roomKey) {
        apiKey = roomKey;
      }
    }
    
    if (!apiKey) {
      apiKey = process.env.FREEPIK_API_KEY;
    }
    
    if (!apiKey) {
      return res.status(500).json({ error: 'API key tidak tersedia. Hubungi admin.' });
    }
    
    const sceneDescription = prompt || 'portrait shot';
    const totalImages = Math.min(Math.max(imageCount || 1, 1), 15);
    
    if (!sceneDescription && !referenceImage) {
      return res.status(400).json({ error: 'Scene description is required' });
    }
    
    const stylePrompts = {
      realistic: ', photorealistic, high quality, detailed, 8k',
      anime: ', anime style, vibrant colors, japanese animation',
      cartoon: ', cartoon style, colorful, illustrated, pixar style',
      cinematic: ', cinematic lighting, dramatic, movie scene, film grain',
      fantasy: ', fantasy art, magical, ethereal, mystical',
      portrait: ', portrait photography, studio lighting, professional'
    };
    
    const styleModifier = stylePrompts[style] || stylePrompts.realistic;
    
    const aspectRatioMap = {
      '1:1': 'square_1_1',
      '16:9': 'widescreen_16_9',
      '9:16': 'social_story_9_16',
      '4:3': 'classic_4_3',
      '3:4': 'traditional_3_4'
    };
    
    const freepikAspect = aspectRatioMap[aspectRatio] || 'square_1_1';
    
    const modelConfig = {
      'mystic': { 
        endpoint: 'https://api.freepik.com/v1/ai/mystic',
        statusEndpoint: 'https://api.freepik.com/v1/ai/mystic',
        isAsync: true,
        supportsReference: true,
        engine: 'magnific_sharpy'
      },
      'classic-fast': { 
        endpoint: 'https://api.freepik.com/v1/ai/text-to-image/classic-fast',
        isAsync: false,
        supportsReference: false
      },
      'flux-dev': { 
        endpoint: 'https://api.freepik.com/v1/ai/text-to-image/flux-dev',
        isAsync: false,
        supportsReference: false
      },
      'flux-pro': { 
        endpoint: 'https://api.freepik.com/v1/ai/text-to-image/flux-pro-v1-1',
        isAsync: false,
        supportsReference: false
      },
      'hyperflux': { 
        endpoint: 'https://api.freepik.com/v1/ai/text-to-image/hyperflux',
        isAsync: false,
        supportsReference: false
      },
      'seedream': { 
        endpoint: 'https://api.freepik.com/v1/ai/text-to-image/seedream-4',
        isAsync: false,
        supportsReference: false
      }
    };
    
    const selectedModel = modelConfig[model] || modelConfig['flux-pro'];
    
    const images = [];
    console.log(`Generating ${totalImages} images with model: ${model} for: "${sceneDescription.substring(0, 50)}..."`);
    
    for (let i = 0; i < totalImages; i++) {
      try {
        console.log(`Image ${i + 1}/${totalImages}`);
        
        const fullPrompt = sceneDescription + styleModifier;
        
        let requestBody = {
          prompt: fullPrompt,
          aspect_ratio: freepikAspect
        };
        
        if (model === 'mystic') {
          requestBody.resolution = '2k';
          requestBody.engine = selectedModel.engine;
          if (referenceImage) {
            const base64Data = referenceImage.replace(/^data:image\/[^;]+;base64,/, '');
            requestBody.structure_reference = base64Data;
            requestBody.structure_strength = 60;
          }
        } else {
          requestBody.num_images = 1;
          requestBody.guidance_scale = 3.5;
        }
        
        const response = await axios.post(
          selectedModel.endpoint,
          requestBody,
          {
            headers: {
              'x-freepik-api-key': apiKey,
              'Content-Type': 'application/json'
            },
            timeout: 120000
          }
        );
        
        let imageUrl = null;
        
        if (selectedModel.isAsync) {
          const taskId = response.data?.data?.task_id;
          if (!taskId) {
            throw new Error('No task ID received');
          }
          
          let attempts = 0;
          const maxAttempts = 60;
          
          while (!imageUrl && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            attempts++;
            
            try {
              const statusResponse = await axios.get(
                `${selectedModel.statusEndpoint}/${taskId}`,
                {
                  headers: {
                    'x-freepik-api-key': apiKey
                  }
                }
              );
              
              const status = statusResponse.data?.data?.status;
              
              if (status === 'COMPLETED') {
                const generated = statusResponse.data?.data?.generated;
                if (generated && generated.length > 0) {
                  imageUrl = generated[0].url || generated[0];
                }
              } else if (status === 'FAILED') {
                throw new Error('Image generation failed');
              }
            } catch (pollError) {
              console.log(`Poll attempt ${attempts} error:`, pollError.message);
            }
          }
        } else {
          const data = response.data?.data || response.data;
          if (data && data.length > 0) {
            imageUrl = data[0].base64 ? `data:image/png;base64,${data[0].base64}` : data[0].url || data[0];
          } else if (data?.base64) {
            imageUrl = `data:image/png;base64,${data.base64}`;
          } else if (typeof data === 'string') {
            imageUrl = data;
          }
        }
        
        if (imageUrl) {
          images.push({ url: imageUrl, index: i, scene: sceneDescription });
          console.log(`Image ${i + 1} generated successfully`);
        } else {
          images.push({ 
            url: `https://placehold.co/512x512/6366f1/ffffff?text=Timeout`, 
            index: i,
            placeholder: true,
            message: 'Generation timeout'
          });
        }
        
      } catch (imgError) {
        console.error(`Image ${i + 1} generation error:`, imgError.response?.data || imgError.message);
        images.push({ 
          url: `https://placehold.co/512x512/ef4444/ffffff?text=Error`, 
          index: i,
          error: true,
          message: imgError.response?.data?.error?.message || imgError.message
        });
      }
    }
    
    res.json({ images, count: images.length });
    
  } catch (error) {
    console.error('Generate image error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate images: ' + (error.response?.data?.error?.message || error.message) });
  }
});

app.post('/api/generate-image-legacy', async (req, res) => {
  try {
    const { model, prompt, imageCount, style, aspectRatio, referenceImage } = req.body;
    
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'OpenRouter API key not configured' });
    }
    
    const sceneDescription = prompt || 'portrait shot';
    const totalImages = Math.min(Math.max(imageCount || 1, 1), 15);
    
    if (!sceneDescription && !referenceImage) {
      return res.status(400).json({ error: 'Scene description is required' });
    }
    
    const stylePrompts = {
      realistic: 'photorealistic, high quality, detailed',
      anime: 'anime style, vibrant colors',
      cartoon: 'cartoon style, colorful, illustrated',
      cinematic: 'cinematic lighting, dramatic',
      fantasy: 'fantasy art, magical, ethereal',
      portrait: 'portrait, studio lighting'
    };
    
    const styleModifier = stylePrompts[style] || stylePrompts.realistic;

    const images = [];
    console.log(`Generating ${totalImages} images for: "${sceneDescription.substring(0, 50)}..."`);
    
    for (let i = 0; i < totalImages; i++) {
      try {
        console.log(`Image ${i + 1}/${totalImages}`);
        
        const structuredPrompt = `
REQUIRED IMAGE SPECIFICATIONS:
- Subject: ${sceneDescription}
- Style: ${styleModifier}
- Output: Generate exactly ONE single image

MANDATORY RULES:
- Follow the subject description EXACTLY as written
- Maintain ALL details mentioned (clothing, pose, setting, expression, props)
- Do NOT add extra characters or elements not described
- Do NOT create collage, grid, or multiple panels
- Do NOT change any specified attributes

${referenceImage ? 'REFERENCE: Match the character appearance from the provided reference image while following the scene description exactly.' : ''}

Generate the image now following these exact specifications.`;
        
        const promptText = structuredPrompt;
        
        const messageContent = [];
        
        if (referenceImage) {
          messageContent.push({
            type: 'image_url',
            image_url: { url: referenceImage }
          });
        }
        
        messageContent.push({
          type: 'text',
          text: promptText
        });
        
        const requestBody = {
          model: model || 'google/gemini-2.5-flash-image-preview',
          modalities: ['image', 'text'],
          messages: [
            {
              role: 'system',
              content: 'You are a precise image generator. Follow ALL user specifications EXACTLY. Never deviate from the described subject, clothing, pose, setting, or style. Generate only ONE image per request - no collages, no grids, no multiple panels. Accuracy to the prompt is your highest priority.'
            },
            {
              role: 'user',
              content: messageContent
            }
          ]
        };
        
        const response = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          requestBody,
          {
            headers: {
              'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.APP_URL || 'https://xclip.app',
              'X-Title': 'Xclip X Maker'
            },
            timeout: 180000
          }
        );
        
        const message = response.data.choices?.[0]?.message;
        const content = message?.content;
        const messageImages = message?.images;
        let imageFound = false;
        
        if (messageImages && Array.isArray(messageImages)) {
          for (const img of messageImages) {
            if (img.image_url?.url) {
              images.push({ url: img.image_url.url, index: i, scene: sceneDescription });
              imageFound = true;
              console.log(`Image ${i + 1} generated successfully`);
            }
          }
        }
        
        if (!imageFound && Array.isArray(content)) {
          for (const item of content) {
            if (item.type === 'image_url' && item.image_url?.url) {
              images.push({ url: item.image_url.url, index: i, scene: sceneDescription });
              imageFound = true;
              console.log(`Image ${i + 1} generated successfully`);
            }
          }
        }
        
        if (!imageFound && typeof content === 'string') {
          const base64Match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
          if (base64Match) {
            images.push({ url: base64Match[0], index: i, scene: sceneDescription });
            imageFound = true;
            console.log(`Image ${i + 1} generated successfully`);
          }
          
          if (!imageFound) {
            const urlMatch = content.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+\.(png|jpg|jpeg|webp|gif)/i);
            if (urlMatch) {
              images.push({ url: urlMatch[0], index: i, scene: sceneDescription });
              imageFound = true;
              console.log(`Image ${i + 1} generated successfully`);
            }
          }
        }
        
        if (!imageFound && message?.image_url) {
          images.push({ url: message.image_url, index: i, scene: sceneDescription });
          imageFound = true;
        }
        
        if (!imageFound) {
          console.log('No image found in response:', JSON.stringify(response.data, null, 2).slice(0, 500));
          images.push({ 
            url: `https://placehold.co/512x512/6366f1/ffffff?text=No+Image`, 
            index: i,
            placeholder: true,
            message: typeof content === 'string' ? content.slice(0, 300) : 'No image generated'
          });
        }
        
      } catch (imgError) {
        console.error(`Image ${i + 1} generation error:`, imgError.response?.data || imgError.message);
        images.push({ 
          url: `https://placehold.co/512x512/ef4444/ffffff?text=Error`, 
          index: i,
          error: true,
          message: imgError.response?.data?.error?.message || imgError.message
        });
      }
    }
    
    res.json({ images, count: images.length });
    
  } catch (error) {
    console.error('Generate image error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate images: ' + (error.response?.data?.error?.message || error.message) });
  }
});

app.post('/api/generate-video', async (req, res) => {
  try {
    const { model, image, prompt, duration, aspectRatio, customApiKey } = req.body;
    
    let apiKey = null;
    
    // Priority 1: If user is logged in and has subscription with room, use room's API key
    if (req.session.userId) {
      const roomKey = await getRoomApiKey(req.session.userId);
      if (roomKey) {
        apiKey = roomKey;
      }
    }
    
    // Priority 2: User's custom API key (only if no room key)
    if (!apiKey && customApiKey) {
      apiKey = customApiKey;
    }
    
    // Priority 3: Fallback to default API key
    if (!apiKey) {
      apiKey = process.env.FREEPIK_API_KEY;
    }
    
    if (!apiKey) {
      return res.status(500).json({ error: 'Xclip API key not configured. Please add your API key or buy a subscription package.' });
    }
    
    if (!image) {
      return res.status(400).json({ error: 'Image is required' });
    }
    
    const modelEndpoints = {
      'kling-v2-5-pro': 'kling-v2-5-pro',
      'kling-v2-1-master': 'kling-v2-1-master',
      'kling-v2-1-pro': 'kling-v2-1-pro',
      'kling-v2-1-std': 'kling-v2-1-std',
      'kling-v2': 'kling-v2',
      'kling-pro': 'kling-pro',
      'kling-std': 'kling-std',
      'minimax-hailuo-02-1080p': 'minimax-hailuo-02-1080p',
      'minimax-hailuo-02-768p': 'minimax-hailuo-02-768p',
      'seedance-lite-1080p': 'seedance-lite-1080p',
      'seedance-lite-720p': 'seedance-lite-720p',
      'pixverse-v5': 'pixverse-v5'
    };
    
    const endpoint = modelEndpoints[model] || 'kling-pro';
    const isMinimax = model.includes('minimax');
    
    const aspectRatioMap = {
      '16:9': 'widescreen_16_9',
      '9:16': 'social_story_9_16',
      '1:1': 'square_1_1'
    };
    const mappedAspectRatio = aspectRatioMap[aspectRatio] || 'widescreen_16_9';
    
    let requestBody;
    if (isMinimax) {
      requestBody = {
        prompt: prompt || 'Gentle natural motion',
        first_frame_image: image
      };
    } else {
      requestBody = {
        image: image,
        prompt: prompt || 'Gentle natural motion',
        duration: duration || '5',
        aspect_ratio: mappedAspectRatio
      };
    }
    
    console.log(`Generating video with ${endpoint}...`);
    
    const response = await axios.post(
      `https://api.freepik.com/v1/ai/image-to-video/${endpoint}`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-freepik-api-key': apiKey
        },
        timeout: 60000
      }
    );
    
    const taskId = response.data.data?.task_id || response.data.task_id || response.data.id;
    
    if (taskId) {
      console.log(`Video task created: ${taskId}`);
      res.json({ taskId, model: endpoint });
    } else {
      console.log('Freepik response:', JSON.stringify(response.data, null, 2));
      res.status(500).json({ error: 'No task ID returned from API' });
    }
    
  } catch (error) {
    console.error('Generate video error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate video: ' + (error.response?.data?.message || error.message) });
  }
});

app.post('/api/video-status/:model/:taskId', async (req, res) => {
  try {
    const { model, taskId } = req.params;
    const { customApiKey } = req.body || {};
    
    const apiKey = customApiKey || process.env.FREEPIK_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'API key tidak tersedia' });
    }
    
    const statusEndpointMap = {
      'kling-v2-5-pro': 'kling-v2-5-pro',
      'kling-v2-1-master': 'kling-v2-1-master',
      'kling-v2-1-pro': 'kling-v2-1',
      'kling-v2-1-std': 'kling-v2-1',
      'kling-v2': 'kling-v2',
      'kling-pro': 'kling',
      'kling-std': 'kling',
      'minimax-hailuo-02-1080p': 'minimax-hailuo-02-1080p',
      'minimax-hailuo-02-768p': 'minimax-hailuo-02-768p',
      'seedance-lite-1080p': 'seedance-lite-1080p',
      'seedance-lite-720p': 'seedance-lite-720p',
      'pixverse-v5': 'pixverse-v5'
    };
    
    const statusEndpoint = statusEndpointMap[model] || model;
    const statusUrl = `https://api.freepik.com/v1/ai/image-to-video/${statusEndpoint}/${taskId}`;
    
    console.log(`Checking status: ${statusUrl}`);
    
    const response = await axios.get(statusUrl, {
      headers: {
        'x-freepik-api-key': apiKey
      }
    });
    
    console.log('Status response:', JSON.stringify(response.data, null, 2));
    
    const data = response.data.data || response.data;
    const status = data.status?.toLowerCase();
    
    if (status === 'completed' || status === 'complete' || status === 'success') {
      const videoUrl = data.generated?.[0] || data.video?.url || data.video_url || data.result?.video_url || data.output?.video;
      if (videoUrl) {
        res.json({ status: 'completed', videoUrl });
      } else {
        console.log('No video URL in completed response');
        res.json({ status: 'processing' });
      }
    } else if (status === 'failed' || status === 'error') {
      res.json({ status: 'failed', error: data.error || data.message || 'Generation failed' });
    } else {
      res.json({ status: 'processing' });
    }
    
  } catch (error) {
    console.error('Video status error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to check video status' });
  }
});

// ==================== SUBSCRIPTION PLANS API ====================

// Get all subscription plans
app.get('/api/subscription/plans', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, duration_days, price_idr, description
      FROM subscription_plans 
      WHERE is_active = true
      ORDER BY duration_days ASC
    `);
    res.json({ plans: result.rows });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Gagal mengambil daftar paket' });
  }
});

// ==================== QRIS PAYMENT API ====================

// Submit payment with proof
app.post('/api/payments/submit', uploadPaymentProof.single('proof'), async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Bukti pembayaran wajib diupload' });
    }
    
    const { planId } = req.body;
    if (!planId) {
      return res.status(400).json({ error: 'Pilih paket langganan' });
    }
    
    // Get plan details
    const planResult = await pool.query(
      'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true',
      [planId]
    );
    
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paket tidak ditemukan' });
    }
    
    const plan = planResult.rows[0];
    const proofImage = `/uploads/payment_proofs/${req.file.filename}`;
    
    // Check if user has pending payment
    const pendingCheck = await pool.query(
      'SELECT id FROM payments WHERE user_id = $1 AND status = $2',
      [req.session.userId, 'pending']
    );
    
    if (pendingCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Anda masih memiliki pembayaran yang menunggu verifikasi' });
    }
    
    // Create payment record
    const result = await pool.query(`
      INSERT INTO payments (user_id, package, amount, status, proof_image)
      VALUES ($1, $2, $3, 'pending', $4)
      RETURNING *
    `, [req.session.userId, plan.name, plan.price_idr, proofImage]);
    
    res.json({
      success: true,
      message: 'Pembayaran berhasil disubmit. Menunggu verifikasi admin.',
      payment: result.rows[0]
    });
  } catch (error) {
    console.error('Submit payment error:', error);
    res.status(500).json({ error: 'Gagal submit pembayaran' });
  }
});

// Get user's payment history
app.get('/api/payments/my', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
    }
    
    const result = await pool.query(`
      SELECT * FROM payments 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `, [req.session.userId]);
    
    res.json({ payments: result.rows });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ error: 'Gagal mengambil riwayat pembayaran' });
  }
});

// Get user's current subscription status (simplified)
app.get('/api/subscription/my-status', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ hasSubscription: false });
    }
    
    const result = await pool.query(
      'SELECT subscription_expired_at FROM users WHERE id = $1',
      [req.session.userId]
    );
    
    if (result.rows.length === 0) {
      return res.json({ hasSubscription: false });
    }
    
    const user = result.rows[0];
    const expiredAt = user.subscription_expired_at;
    
    if (!expiredAt || new Date(expiredAt) < new Date()) {
      return res.json({ hasSubscription: false });
    }
    
    const remainingMs = new Date(expiredAt) - new Date();
    res.json({
      hasSubscription: true,
      expiredAt: expiredAt,
      remainingSeconds: Math.floor(remainingMs / 1000)
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({ error: 'Gagal mengambil status langganan' });
  }
});

// ==================== ADMIN PAYMENT API ====================

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
    }
    
    const result = await pool.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [req.session.userId]
    );
    
    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.status(403).json({ error: 'Akses ditolak. Anda bukan admin.' });
    }
    
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ error: 'Gagal verifikasi admin' });
  }
};

// Get all pending payments (admin only)
app.get('/api/admin/payments', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let whereClause = '';
    
    if (status) {
      whereClause = 'WHERE p.status = $1';
    }
    
    const query = `
      SELECT p.*, u.username, u.email
      FROM payments p
      JOIN users u ON p.user_id = u.id
      ${status ? 'WHERE p.status = $1' : ''}
      ORDER BY p.created_at DESC
    `;
    
    const result = status 
      ? await pool.query(query, [status])
      : await pool.query(query);
    
    res.json({ payments: result.rows });
  } catch (error) {
    console.error('Get admin payments error:', error);
    res.status(500).json({ error: 'Gagal mengambil daftar pembayaran' });
  }
});

// Approve payment (admin only)
app.post('/api/admin/payments/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get payment details
    const paymentResult = await pool.query(
      'SELECT * FROM payments WHERE id = $1',
      [id]
    );
    
    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pembayaran tidak ditemukan' });
    }
    
    const payment = paymentResult.rows[0];
    
    if (payment.status !== 'pending') {
      return res.status(400).json({ error: 'Pembayaran sudah diproses sebelumnya' });
    }
    
    // Get plan duration based on package name
    const planResult = await pool.query(
      'SELECT duration_days FROM subscription_plans WHERE name = $1',
      [payment.package]
    );
    
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paket tidak ditemukan' });
    }
    
    const durationDays = planResult.rows[0].duration_days;
    
    // Calculate new expiry date
    // If user already has active subscription, extend from current expiry
    const userResult = await pool.query(
      'SELECT subscription_expired_at FROM users WHERE id = $1',
      [payment.user_id]
    );
    
    let baseDate = new Date();
    if (userResult.rows[0]?.subscription_expired_at) {
      const currentExpiry = new Date(userResult.rows[0].subscription_expired_at);
      if (currentExpiry > baseDate) {
        baseDate = currentExpiry;
      }
    }
    
    const newExpiry = new Date(baseDate.getTime() + (durationDays * 24 * 60 * 60 * 1000));
    
    // Update payment status
    await pool.query(
      'UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2',
      ['approved', id]
    );
    
    // Update user subscription
    await pool.query(
      'UPDATE users SET subscription_expired_at = $1 WHERE id = $2',
      [newExpiry, payment.user_id]
    );
    
    // Also create/update subscriptions table entry (for room selection)
    const existingSub = await pool.query(
      'SELECT id FROM subscriptions WHERE user_id = $1',
      [payment.user_id]
    );
    
    if (existingSub.rows.length > 0) {
      await pool.query(
        'UPDATE subscriptions SET status = $1, expired_at = $2 WHERE user_id = $3',
        ['active', newExpiry, payment.user_id]
      );
    } else {
      await pool.query(
        'INSERT INTO subscriptions (user_id, status, expired_at) VALUES ($1, $2, $3)',
        [payment.user_id, 'active', newExpiry]
      );
    }
    
    res.json({
      success: true,
      message: 'Pembayaran berhasil di-approve',
      expiredAt: newExpiry
    });
  } catch (error) {
    console.error('Approve payment error:', error);
    res.status(500).json({ error: 'Gagal approve pembayaran' });
  }
});

// Reject payment (admin only)
app.post('/api/admin/payments/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Get payment details
    const paymentResult = await pool.query(
      'SELECT * FROM payments WHERE id = $1',
      [id]
    );
    
    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pembayaran tidak ditemukan' });
    }
    
    const payment = paymentResult.rows[0];
    
    if (payment.status !== 'pending') {
      return res.status(400).json({ error: 'Pembayaran sudah diproses sebelumnya' });
    }
    
    // Update payment status
    await pool.query(
      'UPDATE payments SET status = $1, admin_notes = $2, updated_at = NOW() WHERE id = $3',
      ['rejected', reason || 'Ditolak oleh admin', id]
    );
    
    res.json({
      success: true,
      message: 'Pembayaran ditolak'
    });
  } catch (error) {
    console.error('Reject payment error:', error);
    res.status(500).json({ error: 'Gagal reject pembayaran' });
  }
});

// Check if current user is admin
app.get('/api/admin/check', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ isAdmin: false });
    }
    
    const result = await pool.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [req.session.userId]
    );
    
    res.json({ isAdmin: result.rows[0]?.is_admin || false });
  } catch (error) {
    console.error('Admin check error:', error);
    res.json({ isAdmin: false });
  }
});

// ==================== ROOM MANAGER API ====================

// Get all rooms with status (filter by feature: videogen or xmaker)
app.get('/api/rooms', async (req, res) => {
  try {
    await cleanupInactiveUsers();
    
    const { feature } = req.query;
    let whereClause = '';
    
    if (feature === 'xmaker') {
      whereClause = "WHERE name LIKE 'XMaker%'";
    } else if (feature === 'videogen') {
      whereClause = "WHERE name NOT LIKE 'XMaker%'";
    }
    
    const result = await pool.query(`
      SELECT id, name, provider, max_users, active_users, status,
             key_name_1, key_name_2, key_name_3, provider_key_name,
             (max_users - active_users) as available_slots
      FROM rooms 
      ${whereClause}
      ORDER BY id
    `);
    
    const rooms = result.rows.map(room => {
      const keyNames = [room.key_name_1, room.key_name_2, room.key_name_3].filter(k => k);
      const hasApiKeys = keyNames.some(name => process.env[name]) || 
                         (room.provider_key_name && process.env[room.provider_key_name]);
      
      return {
        id: room.id,
        name: room.name,
        provider: room.provider,
        max_users: room.max_users,
        active_users: room.active_users,
        status: hasApiKeys ? room.status : 'MAINTENANCE',
        available_slots: room.available_slots,
        maintenance_reason: hasApiKeys ? null : 'API key belum dikonfigurasi'
      };
    });
    
    res.json({ rooms });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: 'Failed to get rooms' });
  }
});

// Get user subscription status
app.get('/api/subscription/status', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ hasSubscription: false, message: 'Not logged in' });
    }
    
    // Check subscription_expired_at from users table (QRIS payment system)
    const userResult = await pool.query(
      'SELECT subscription_expired_at FROM users WHERE id = $1',
      [req.session.userId]
    );
    
    if (userResult.rows.length > 0 && userResult.rows[0].subscription_expired_at) {
      const expiredAt = new Date(userResult.rows[0].subscription_expired_at);
      if (expiredAt > new Date()) {
        const remainingSeconds = Math.floor((expiredAt - new Date()) / 1000);
        return res.json({
          hasSubscription: true,
          subscription: {
            expiredAt: expiredAt,
            remainingSeconds: remainingSeconds,
            planName: 'QRIS Subscription',
            status: 'active'
          }
        });
      }
    }
    
    // Fallback: Check old subscriptions table
    const result = await pool.query(`
      SELECT s.*, 
             r.name as room_name, r.status as room_status,
             xr.name as xmaker_room_name, xr.status as xmaker_room_status,
             p.name as plan_name, p.duration_days, p.price_idr,
             EXTRACT(EPOCH FROM (s.expired_at - NOW())) as remaining_seconds
      FROM subscriptions s
      LEFT JOIN rooms r ON s.room_id = r.id
      LEFT JOIN rooms xr ON s.xmaker_room_id = xr.id
      LEFT JOIN subscription_plans p ON s.plan_id = p.id
      WHERE s.user_id = $1 AND s.status = 'active' AND s.expired_at > NOW()
      ORDER BY s.expired_at DESC
      LIMIT 1
    `, [req.session.userId]);
    
    if (result.rows.length === 0) {
      return res.json({ hasSubscription: false });
    }
    
    const sub = result.rows[0];
    res.json({
      hasSubscription: true,
      subscription: {
        id: sub.id,
        roomId: sub.room_id,
        roomName: sub.room_name,
        roomStatus: sub.room_status,
        xmakerRoomId: sub.xmaker_room_id,
        xmakerRoomName: sub.xmaker_room_name,
        xmakerRoomStatus: sub.xmaker_room_status,
        planName: sub.plan_name,
        durationDays: sub.duration_days,
        startedAt: sub.started_at,
        expiredAt: sub.expired_at,
        remainingSeconds: Math.max(0, Math.floor(sub.remaining_seconds)),
        status: sub.status
      }
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

// Buy subscription package
app.post('/api/subscription/buy', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
    }
    
    const { planId } = req.body;
    
    if (!planId) {
      return res.status(400).json({ error: 'Pilih paket berlangganan terlebih dahulu' });
    }
    
    // Get plan details
    const planResult = await pool.query(
      'SELECT id, name, duration_days, price_idr FROM subscription_plans WHERE id = $1 AND is_active = true',
      [planId]
    );
    
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Paket tidak ditemukan' });
    }
    
    const plan = planResult.rows[0];
    
    // Check if already has active subscription
    const existing = await pool.query(`
      SELECT id FROM subscriptions 
      WHERE user_id = $1 AND status = 'active' AND expired_at > NOW()
    `, [req.session.userId]);
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Anda sudah memiliki langganan aktif' });
    }
    
    // Create subscription based on plan
    const expiredAt = new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000);
    const result = await pool.query(`
      INSERT INTO subscriptions (user_id, plan_id, expired_at, status, started_at)
      VALUES ($1, $2, $3, 'active', NOW())
      RETURNING id, started_at, expired_at
    `, [req.session.userId, planId, expiredAt]);
    
    res.json({
      success: true,
      subscription: {
        ...result.rows[0],
        planName: plan.name,
        durationDays: plan.duration_days
      },
      message: `Langganan ${plan.name} berhasil diaktifkan!`
    });
  } catch (error) {
    console.error('Buy subscription error:', error);
    res.status(500).json({ error: 'Gagal membeli langganan' });
  }
});

// Select/join a room (feature: videogen or xmaker)
app.post('/api/room/select', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }
    
    const { roomId, feature } = req.body;
    const roomColumn = feature === 'xmaker' ? 'xmaker_room_id' : 'room_id';
    
    // Check if user is admin (admin can bypass subscription)
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
    const isAdmin = adminCheck.rows[0]?.is_admin || false;
    
    // Check active subscription
    let subResult = await pool.query(`
      SELECT id, room_id, xmaker_room_id FROM subscriptions 
      WHERE user_id = $1 AND status = 'active' AND expired_at > NOW()
    `, [req.session.userId]);
    
    // If admin has no subscription, create a temporary one
    if (subResult.rows.length === 0 && isAdmin) {
      const tempSub = await pool.query(`
        INSERT INTO subscriptions (user_id, status, expired_at)
        VALUES ($1, 'active', NOW() + INTERVAL '1 year')
        RETURNING id, room_id, xmaker_room_id
      `, [req.session.userId]);
      subResult = tempSub;
    }
    
    if (subResult.rows.length === 0) {
      return res.status(403).json({ error: 'No active subscription. Please buy a package first.' });
    }
    
    const subscription = subResult.rows[0];
    const currentRoomId = feature === 'xmaker' ? subscription.xmaker_room_id : subscription.room_id;
    
    // If already in a room, leave it first
    if (currentRoomId) {
      await pool.query(`
        UPDATE rooms SET active_users = GREATEST(active_users - 1, 0) WHERE id = $1
      `, [currentRoomId]);
    }
    
    // Check room availability
    const roomResult = await pool.query(`
      SELECT id, name, max_users, active_users, status, provider_key_name
      FROM rooms WHERE id = $1
    `, [roomId]);
    
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const room = roomResult.rows[0];
    
    if (room.status === 'MAINTENANCE') {
      return res.status(400).json({ error: 'Room is under maintenance. Please select another room.' });
    }
    
    if (room.active_users >= room.max_users) {
      return res.status(400).json({ error: 'Room is full. Please select another room.' });
    }
    
    // Join the room
    await pool.query(`
      UPDATE rooms SET active_users = active_users + 1,
                       status = CASE WHEN active_users + 1 >= max_users THEN 'FULL' ELSE status END
      WHERE id = $1
    `, [roomId]);
    
    await pool.query(`
      UPDATE subscriptions SET ${roomColumn} = $1 WHERE id = $2
    `, [roomId, subscription.id]);
    
    res.json({
      success: true,
      room: {
        id: room.id,
        name: room.name,
        slots: `${room.active_users + 1}/${room.max_users}`
      },
      message: `Joined ${room.name} successfully`
    });
  } catch (error) {
    console.error('Select room error:', error);
    res.status(500).json({ error: 'Failed to select room' });
  }
});

// Leave current room (feature: videogen or xmaker)
app.post('/api/room/leave', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }
    
    const { feature } = req.body;
    const roomColumn = feature === 'xmaker' ? 'xmaker_room_id' : 'room_id';
    
    const subResult = await pool.query(`
      SELECT id, room_id, xmaker_room_id FROM subscriptions 
      WHERE user_id = $1 AND status = 'active' AND expired_at > NOW()
    `, [req.session.userId]);
    
    const currentRoomId = feature === 'xmaker' ? subResult.rows[0]?.xmaker_room_id : subResult.rows[0]?.room_id;
    
    if (subResult.rows.length === 0 || !currentRoomId) {
      return res.json({ success: true, message: 'Not in any room' });
    }
    
    const subscription = subResult.rows[0];
    
    // Leave the room
    await pool.query(`
      UPDATE rooms SET active_users = GREATEST(active_users - 1, 0),
                       status = CASE WHEN status = 'FULL' THEN 'OPEN' ELSE status END
      WHERE id = $1
    `, [currentRoomId]);
    
    await pool.query(`
      UPDATE subscriptions SET ${roomColumn} = NULL WHERE id = $1
    `, [subscription.id]);
    
    res.json({ success: true, message: 'Left room successfully' });
  } catch (error) {
    console.error('Leave room error:', error);
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

// Helper: Get API key for user's room with 3-minute rotation
async function getRoomApiKey(userId, feature = 'videogen') {
  const roomColumn = feature === 'xmaker' ? 'xmaker_room_id' : 'room_id';
  
  const result = await pool.query(`
    SELECT r.key_name_1, r.key_name_2, r.key_name_3, r.provider_key_name 
    FROM subscriptions s
    JOIN rooms r ON s.${roomColumn} = r.id
    WHERE s.user_id = $1 AND s.status = 'active' AND s.expired_at > NOW() AND s.${roomColumn} IS NOT NULL
  `, [userId]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const room = result.rows[0];
  const keyNames = [room.key_name_1, room.key_name_2, room.key_name_3].filter(k => k);
  const keys = keyNames.map(name => process.env[name]).filter(k => k);
  
  if (keys.length === 0) {
    const keyName = room.provider_key_name;
    return process.env[keyName] || process.env.FREEPIK_API_KEY;
  }
  
  const rotationMinutes = 3;
  const currentMinute = Math.floor(Date.now() / (rotationMinutes * 60 * 1000));
  const keyIndex = currentMinute % keys.length;
  
  console.log(`Room API key rotation: using key ${keyIndex + 1} of ${keys.length}`);
  return keys[keyIndex];
}

// Helper: Get API key for room by room ID with rotation
async function getRoomApiKeyByRoomId(roomId) {
  const result = await pool.query(`
    SELECT key_name_1, key_name_2, key_name_3, provider_key_name FROM rooms WHERE id = $1
  `, [roomId]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const room = result.rows[0];
  const keyNames = [room.key_name_1, room.key_name_2, room.key_name_3].filter(k => k);
  const keys = keyNames.map(name => process.env[name]).filter(k => k);
  
  if (keys.length === 0) {
    const keyName = room.provider_key_name;
    return process.env[keyName] || process.env.FREEPIK_API_KEY;
  }
  
  const rotationMinutes = 3;
  const currentMinute = Math.floor(Date.now() / (rotationMinutes * 60 * 1000));
  const keyIndex = currentMinute % keys.length;
  
  console.log(`Room ${roomId} API key rotation: using key ${keyIndex + 1} of ${keys.length}`);
  return keys[keyIndex];
}

// Cleanup expired subscriptions (run periodically)
async function cleanupExpiredSubscriptions() {
  try {
    // Get expired subscriptions with rooms
    const expired = await pool.query(`
      SELECT id, room_id FROM subscriptions 
      WHERE status = 'active' AND expired_at <= NOW() AND room_id IS NOT NULL
    `);
    
    // Release room slots
    for (const sub of expired.rows) {
      await pool.query(`
        UPDATE rooms SET active_users = GREATEST(active_users - 1, 0),
                         status = CASE WHEN status = 'FULL' THEN 'OPEN' ELSE status END
        WHERE id = $1
      `, [sub.room_id]);
    }
    
    // Mark subscriptions as expired
    await pool.query(`
      UPDATE subscriptions SET status = 'expired', room_id = NULL, room_locked = false
      WHERE status = 'active' AND expired_at <= NOW()
    `);
    
    if (expired.rows.length > 0) {
      console.log(`Cleaned up ${expired.rows.length} expired subscriptions`);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredSubscriptions, 60000);
cleanupExpiredSubscriptions();

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// Initialize database tables
async function initDatabase() {
  try {
    // Create sessions table for express-session (required for login)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR NOT NULL COLLATE "default",
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL,
        CONSTRAINT sessions_pkey PRIMARY KEY (sid)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions (expire)`);
    
    // Create subscription_plans table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        duration_days INTEGER NOT NULL,
        price_idr INTEGER NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add plan_id column to subscriptions if not exists
    await pool.query(`
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES subscription_plans(id)
    `).catch(() => {});
    
    // Seed plans if empty
    const existingPlans = await pool.query('SELECT COUNT(*) FROM subscription_plans');
    if (parseInt(existingPlans.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO subscription_plans (name, duration_days, price_idr, description) VALUES
          ('1 Hari', 1, 15000, 'Akses semua fitur selama 1 hari'),
          ('3 Hari', 3, 35000, 'Akses semua fitur selama 3 hari'),
          ('1 Minggu', 7, 65000, 'Akses semua fitur selama 7 hari'),
          ('1 Bulan', 30, 199000, 'Akses semua fitur selama 30 hari')
      `);
      console.log('Subscription plans seeded');
    }
    
    console.log('Database initialized');
  } catch (error) {
    console.error('Database init error:', error.message);
  }
}

initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Xclip server running on http://0.0.0.0:${PORT}`);
  });
});
