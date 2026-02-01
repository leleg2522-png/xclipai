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
const { HttpsProxyAgent } = require('https-proxy-agent');
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

// ============ PERFORMANCE MONITORING ============
app.use((req, res, next) => {
  const start = Date.now();
  // Set cache control for better performance
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 2000) {
      console.log(`[VERY SLOW REQUEST] ${req.method} ${req.originalUrl} took ${duration}ms`);
    }
  });
  next();
});

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
    
    // Update active_users in rooms table (Video Gen)
    await pool.query(`
      UPDATE rooms r SET active_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE s.room_id = r.id
        AND s.status = 'active' 
        AND s.expired_at > NOW()
      )
    `);
    
    // Update active_users in vidgen2_rooms table
    await pool.query(`
      UPDATE vidgen2_rooms r SET active_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE s.vidgen2_room_id = r.id
        AND s.status = 'active' 
        AND s.expired_at > NOW()
      )
    `);
    
    const totalCleaned = inactiveVideoGen.rowCount;
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
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  acceptRanges: true,
  setHeaders: (res) => {
    res.set('Accept-Ranges', 'bytes');
  }
}));
app.use('/processed', express.static(path.join(__dirname, 'processed')));

// Handle common HTTP errors gracefully
app.use((err, req, res, next) => {
  // Range error for missing/deleted files - don't spam logs
  if (err.status === 416 || err.name === 'RangeNotSatisfiableError') {
    console.log('File not found or range error (normal for deleted clips)');
    if (!res.headersSent) {
      return res.status(404).json({ error: 'File tidak ditemukan atau sudah dihapus' });
    }
    return;
  }
  
  // Request aborted - this is normal when client cancels, don't log as error
  if (err.type === 'request.aborted' || err.code === 'ECONNRESET' || err.message === 'request aborted') {
    console.log('Request aborted by client (normal)');
    return; // Don't send response, connection is already closed
  }
  
  next(err);
});

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

// Storage for video processing jobs
const jobs = new Map();

// ============ WEBSHARE PROXY SUPPORT ============
let webshareProxies = [];
let webshareProxyIndex = 0;
let webshareLastFetch = 0;

async function fetchWebshareProxies() {
  const apiKey = process.env.WEBSHARE_API_KEY;
  if (!apiKey) {
    console.log('WEBSHARE_API_KEY not configured');
    return [];
  }
  
  if (webshareProxies.length > 0 && Date.now() - webshareLastFetch < 300000) {
    return webshareProxies;
  }
  
  try {
    const response = await axios.get('https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page_size=100', {
      headers: { 'Authorization': `Token ${apiKey}` },
      timeout: 10000
    });
    
    webshareProxies = response.data.results || [];
    webshareLastFetch = Date.now();
    console.log(`Fetched ${webshareProxies.length} proxies from Webshare`);
    return webshareProxies;
  } catch (error) {
    console.error('Failed to fetch Webshare proxies:', error.message);
    return [];
  }
}

function getNextWebshareProxy() {
  if (webshareProxies.length === 0) return null;
  const proxy = webshareProxies[webshareProxyIndex % webshareProxies.length];
  webshareProxyIndex++;
  return proxy;
}

// Helper to make Freepik API calls with optional Webshare proxy
async function makeFreepikRequest(method, url, apiKey, body = null, useProxy = true) {
  const config = {
    method,
    url,
    headers: {
      'x-freepik-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    timeout: 60000
  };
  
  if (body) config.data = body;
  
  // Try Webshare proxy if available and enabled
  const hasWebshareKey = !!process.env.WEBSHARE_API_KEY;
  console.log(`[PROXY DEBUG] useProxy=${useProxy}, hasWebshareKey=${hasWebshareKey}, proxyCount=${webshareProxies.length}`);
  
  if (useProxy && hasWebshareKey) {
    await fetchWebshareProxies();
    const proxy = getNextWebshareProxy();
    
    if (proxy) {
      const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.proxy_address}:${proxy.port}`;
      console.log(`[PROXY] Using Webshare: ${proxy.proxy_address}:${proxy.port}`);
      config.httpsAgent = new HttpsProxyAgent(proxyUrl);
      config.proxy = false; // Disable axios built-in proxy when using agent
    } else {
      console.log(`[PROXY] No proxy available, using direct connection`);
    }
  } else {
    console.log(`[PROXY] Skipped - useProxy=${useProxy}, hasKey=${hasWebshareKey}`);
  }
  
  return axios(config);
}

// ============ DROPLET PROXY SUPPORT ============
async function requestViaProxy(roomId, endpoint, method, body, apiKey) {
  try {
    const roomResult = await pool.query(
      'SELECT droplet_ip, droplet_port, proxy_secret, use_proxy, use_webshare FROM rooms WHERE id = $1',
      [roomId]
    );
    
    const room = roomResult.rows[0];
    const useDropletProxy = room && room.use_proxy && room.droplet_ip && room.proxy_secret;
    const useWebshare = room && room.use_webshare && process.env.WEBSHARE_API_KEY;
    
    const freepikUrl = `https://api.freepik.com/${endpoint}`;
    
    if (useWebshare) {
      await fetchWebshareProxies();
      const proxy = getNextWebshareProxy();
      
      if (proxy) {
        console.log(`Using Webshare proxy: ${proxy.proxy_address}:${proxy.port}`);
        const response = await axios({
          method,
          url: freepikUrl,
          headers: {
            'x-freepik-api-key': apiKey,
            'Content-Type': 'application/json'
          },
          data: body,
          timeout: 120000,
          proxy: {
            host: proxy.proxy_address,
            port: proxy.port,
            auth: {
              username: proxy.username,
              password: proxy.password
            }
          }
        });
        return response.data;
      }
    }
    
    if (useDropletProxy) {
      const port = room.droplet_port || 3000;
      const proxyUrl = `http://${room.droplet_ip}:${port}/proxy/freepik`;
      
      const response = await axios({
        method: 'POST',
        url: proxyUrl,
        headers: { 
          'x-proxy-secret': room.proxy_secret,
          'Content-Type': 'application/json'
        },
        data: {
          url: freepikUrl,
          method: method,
          headers: {
            'x-freepik-api-key': apiKey,
            'Content-Type': 'application/json'
          },
          data: body
        },
        timeout: 120000
      });
      
      return response.data.data || response.data;
    }
    
    const response = await axios({
      method,
      url: freepikUrl,
      headers: {
        'x-freepik-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      data: body,
      timeout: 120000
    });
    return response.data;
  } catch (error) {
    console.error(`Proxy Request Error [${endpoint}]:`, error.response?.data || error.message);
    throw error;
  }
}

// Chunked upload storage
const chunkedUploads = new Map();

// Initialize chunked upload
app.post('/api/upload/init', async (req, res) => {
  try {
    const { filename, fileSize, totalChunks } = req.body;
    const uploadId = uuidv4();
    const ext = path.extname(filename);
    const tempFilename = `${uploadId}${ext}`;
    const uploadDir = path.join(__dirname, 'uploads');
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    chunkedUploads.set(uploadId, {
      filename,
      tempFilename,
      fileSize,
      totalChunks,
      receivedChunks: new Set(),
      filePath: path.join(uploadDir, tempFilename),
      createdAt: Date.now()
    });
    
    console.log(`[CHUNK] Init upload: ${uploadId}, size: ${(fileSize/1024/1024).toFixed(2)}MB, chunks: ${totalChunks}`);
    
    res.json({ uploadId });
  } catch (error) {
    console.error('Chunk init error:', error);
    res.status(500).json({ error: 'Failed to initialize upload' });
  }
});

// Receive chunk
app.post('/api/upload/chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.body;
    const upload = chunkedUploads.get(uploadId);
    
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No chunk data' });
    }
    
    // Read chunk and append to file
    const chunkData = fs.readFileSync(req.file.path);
    const chunkNum = parseInt(chunkIndex);
    
    // Write chunk at correct position
    const fd = fs.openSync(upload.filePath, chunkNum === 0 ? 'w' : 'r+');
    const chunkSize = 5 * 1024 * 1024; // 5MB
    fs.writeSync(fd, chunkData, 0, chunkData.length, chunkNum * chunkSize);
    fs.closeSync(fd);
    
    // Delete temp chunk file
    fs.unlinkSync(req.file.path);
    
    upload.receivedChunks.add(chunkNum);
    
    console.log(`[CHUNK] Received ${chunkNum + 1}/${upload.totalChunks} for ${uploadId}`);
    
    res.json({ 
      received: chunkNum,
      total: upload.totalChunks,
      progress: Math.round((upload.receivedChunks.size / upload.totalChunks) * 100)
    });
  } catch (error) {
    console.error('Chunk upload error:', error);
    res.status(500).json({ error: 'Failed to upload chunk' });
  }
});

// Complete chunked upload
app.post('/api/upload/complete', async (req, res) => {
  try {
    const { uploadId } = req.body;
    const upload = chunkedUploads.get(uploadId);
    
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    
    if (upload.receivedChunks.size !== upload.totalChunks) {
      return res.status(400).json({ 
        error: `Missing chunks: ${upload.receivedChunks.size}/${upload.totalChunks}` 
      });
    }
    
    // Truncate file to actual size (remove padding from last chunk)
    fs.truncateSync(upload.filePath, upload.fileSize);
    
    const jobId = uuidv4();
    const videoUrl = `/uploads/${upload.tempFilename}`;
    
    const metadata = await getVideoMetadata(upload.filePath);
    
    jobs.set(jobId, {
      id: jobId,
      status: 'uploaded',
      videoPath: upload.filePath,
      videoUrl,
      filename: upload.filename,
      metadata,
      clips: [],
      progress: 0
    });
    
    chunkedUploads.delete(uploadId);
    
    console.log(`[CHUNK] Complete: ${uploadId} -> job ${jobId}`);
    
    res.json({
      jobId,
      videoUrl,
      filename: upload.filename,
      metadata
    });
  } catch (error) {
    console.error('Chunk complete error:', error);
    res.status(500).json({ error: 'Failed to complete upload: ' + error.message });
  }
});

// Cleanup old chunked uploads (older than 1 hour)
setInterval(() => {
  const now = Date.now();
  for (const [uploadId, upload] of chunkedUploads) {
    if (now - upload.createdAt > 3600000) {
      try {
        if (fs.existsSync(upload.filePath)) {
          fs.unlinkSync(upload.filePath);
        }
      } catch (e) {}
      chunkedUploads.delete(uploadId);
      console.log(`[CHUNK] Cleaned up stale upload: ${uploadId}`);
    }
  }
}, 300000);

// Original single upload (kept for small files)
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
    // Skip viral analysis - use basic scoring instead (saves API credits)
    console.log('Using basic viral scoring (OpenRouter disabled to save credits)');
    viralScores = segments.map((_, i) => ({ index: i, score: 50 + Math.random() * 50 }));
    
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
  
  console.log(`[Job Status] ${req.params.jobId}: status=${job.status}, progress=${job.progress}, clips=${job.clips?.length || 0}`);
  
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

// Helper function to save base64 data to file and return public URL
async function saveBase64ToFile(base64Data, type, baseUrl) {
  const uploadsDir = path.join(__dirname, 'uploads', 'motion');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  
  // Strip data URI prefix if present
  let cleanData = base64Data;
  let ext = type === 'image' ? 'png' : 'mp4';
  
  if (base64Data.includes(',')) {
    const parts = base64Data.split(',');
    cleanData = parts[1];
    // Extract extension from data URI
    const mimeMatch = parts[0].match(/data:(\w+)\/(\w+)/);
    if (mimeMatch) {
      ext = mimeMatch[2] === 'jpeg' ? 'jpg' : mimeMatch[2];
    }
  }
  
  const filename = `${uuidv4()}.${ext}`;
  const filepath = path.join(uploadsDir, filename);
  
  // Save file
  fs.writeFileSync(filepath, Buffer.from(cleanData, 'base64'));
  
  // Return public URL
  const publicUrl = `${baseUrl}/uploads/motion/${filename}`;
  return { filepath, publicUrl, filename };
}

// Cleanup old motion files (older than 1 hour)
function cleanupMotionFiles() {
  const uploadsDir = path.join(__dirname, 'uploads', 'motion');
  if (!fs.existsSync(uploadsDir)) return;
  
  const files = fs.readdirSync(uploadsDir);
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  files.forEach(file => {
    const filepath = path.join(uploadsDir, file);
    const stats = fs.statSync(filepath);
    if (stats.mtimeMs < oneHourAgo) {
      fs.unlinkSync(filepath);
    }
  });
}

// Run cleanup every 30 minutes
setInterval(cleanupMotionFiles, 30 * 60 * 1000);

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
    
    // Model configs - based on Freepik API docs (verified January 2026)
    const modelConfigs = {
      // Kling 2.6 (with audio support)
      'kling-v2.6-pro': { api: 'kling26', endpoint: '/v1/ai/image-to-video/kling-v2-6-pro' },
      'kling-v2.6-std': { api: 'kling26', endpoint: '/v1/ai/image-to-video/kling-v2-6-std' },
      // Kling O1
      'kling-o1-pro': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-o1-pro' },
      'kling-o1-std': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-o1-std' },
      // Kling 2.5 (turbo is same as pro according to docs)
      'kling-v2.5-turbo': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2-5-pro' },
      'kling-v2.5-pro': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2-5-pro' },
      // Kling 2.1
      'kling-v2.1-master': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2-1-master' },
      'kling-v2.1-pro': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2-1-pro' },
      'kling-v2.1-std': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2-1-std' },
      // Kling v2 (older)
      'kling-v2': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-v2' },
      // Kling Elements
      'kling-elements-pro': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-elements-pro' },
      'kling-elements-std': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-elements-std' },
      // Kling 1.6 (uses kling-pro/kling-std)
      'kling-v1.6-pro': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-pro' },
      'kling-v1.6-std': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-std' },
      'kling-pro': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-pro' },
      'kling-std': { api: 'kling-ai', endpoint: '/v1/ai/image-to-video/kling-std' },
      // Wan 2.6 (uses 'size' parameter) - naming: wan-v2-6 (with 'v')
      'wan-v2.6-1080p': { api: 'wan26', endpoint: '/v1/ai/image-to-video/wan-v2-6-1080p' },
      'wan-v2.6-720p': { api: 'wan26', endpoint: '/v1/ai/image-to-video/wan-v2-6-720p' },
      // Wan 2.2 (uses 'aspect_ratio' parameter)
      'wan-v2.2-720p': { api: 'wan22', endpoint: '/v1/ai/image-to-video/wan-v2-2-720p' },
      'wan-v2.2-580p': { api: 'wan22', endpoint: '/v1/ai/image-to-video/wan-v2-2-580p' },
      'wan-v2.2-480p': { api: 'wan22', endpoint: '/v1/ai/image-to-video/wan-v2-2-480p' },
      // MiniMax Hailuo 2.3
      'minimax-hailuo-2.3-1080p': { api: 'minimax', endpoint: '/v1/ai/image-to-video/minimax-hailuo-2-3-1080p' },
      'minimax-hailuo-2.3-1080p-fast': { api: 'minimax', endpoint: '/v1/ai/image-to-video/minimax-hailuo-2-3-1080p-fast' },
      'minimax-hailuo-2.3-768p': { api: 'minimax', endpoint: '/v1/ai/image-to-video/minimax-hailuo-2-3-768p' },
      'minimax-hailuo-2.3-768p-fast': { api: 'minimax', endpoint: '/v1/ai/image-to-video/minimax-hailuo-2-3-768p-fast' },
      // MiniMax Hailuo 02
      'minimax-hailuo-1080p': { api: 'minimax', endpoint: '/v1/ai/image-to-video/minimax-hailuo-02-1080p' },
      'minimax-hailuo-768p': { api: 'minimax', endpoint: '/v1/ai/image-to-video/minimax-hailuo-02-768p' },
      'minimax-hailuo-02-1080p': { api: 'minimax', endpoint: '/v1/ai/image-to-video/minimax-hailuo-02-1080p' },
      'minimax-hailuo-02-768p': { api: 'minimax', endpoint: '/v1/ai/image-to-video/minimax-hailuo-02-768p' },
      // Seedance
      'seedance-pro-1080p': { api: 'seedance', endpoint: '/v1/ai/image-to-video/seedance-pro-1080p' },
      'seedance-pro-720p': { api: 'seedance', endpoint: '/v1/ai/image-to-video/seedance-pro-720p' },
      'seedance-lite-1080p': { api: 'seedance', endpoint: '/v1/ai/image-to-video/seedance-lite-1080p' },
      'seedance-lite-720p': { api: 'seedance', endpoint: '/v1/ai/image-to-video/seedance-lite-720p' },
      // PixVerse
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
    
    if (config.api === 'kling26') {
      // Kling 2.6 Pro with native audio support
      requestBody = {
        image: image,
        prompt: prompt || '',
        duration: duration || '5',
        aspect_ratio: mappedAspectRatio,
        negative_prompt: 'blurry, low quality, distorted, ugly, bad anatomy',
        cfg_scale: 0.5,
        generate_audio: true
      };
    } else if (config.api === 'kling-ai') {
      requestBody = {
        image: image,
        prompt: prompt || '',
        duration: duration || '5',
        aspect_ratio: mappedAspectRatio,
        cfg_scale: 0.6
      };
    } else if (config.api === 'minimax') {
      requestBody = {
        image: image,
        prompt: prompt || '',
        prompt_optimizer: true,
        negative_prompt: 'blurry, low quality, distorted, ugly, bad anatomy'
      };
    } else if (config.api === 'seedance') {
      requestBody = {
        image: image,
        prompt: prompt || '',
        duration: duration || '5',
        resolution: model.includes('1080p') ? '1080p' : '720p',
        seed: Math.floor(Math.random() * 1000000),
        motion_strength: 0.7
      };
    } else if (config.api === 'pixverse') {
      requestBody = {
        image: image,
        prompt: prompt || '',
        duration: duration || '5',
        quality: 'high',
        aspect_ratio: mappedAspectRatio,
        negative_prompt: 'blurry, low quality, distorted, ugly, bad anatomy',
        seed: Math.floor(Math.random() * 1000000),
        motion_mode: 'normal',
        reference_strength: 0.8
      };
    } else if (config.api === 'wan26') {
      // Wan 2.6 uses 'size' parameter with format like '1920*1080'
      let wanSize;
      if (model.includes('1080p')) {
        // 1080p sizes
        wanSize = mappedAspectRatio === 'social_story_9_16' ? '1080*1920' : '1920*1080';
      } else {
        // 720p sizes
        wanSize = mappedAspectRatio === 'social_story_9_16' ? '720*1280' : '1280*720';
      }
      requestBody = {
        image: image,
        prompt: prompt || '',
        duration: duration || '5',
        size: wanSize,
        negative_prompt: 'blurry, low quality, distorted, ugly, bad anatomy',
        enable_prompt_expansion: false,
        shot_type: 'single',
        seed: -1,
        generate_audio: true  // Enable native audio generation
      };
    } else if (config.api === 'wan22') {
      // Wan 2.2 uses 'aspect_ratio' parameter
      requestBody = {
        image: image,
        prompt: prompt || '',
        duration: duration || '5',
        aspect_ratio: mappedAspectRatio || 'auto',
        seed: Math.floor(Math.random() * 1000000)
      };
    }
    
    // Add webhook callback URL for instant notifications
    if (webhookUrl) {
      requestBody.webhook_url = webhookUrl;
    }
    
    const startTime = Date.now();
    
    // Get all available keys for retry on 429
    const allKeys = [];
    if (keySource === 'room' && keyInfo.room_id) {
      const keyNames = [keyInfo.key_name_1, keyInfo.key_name_2, keyInfo.key_name_3].filter(k => k);
      keyNames.forEach((name, idx) => {
        const key = process.env[name];
        if (key) allKeys.push({ key, index: idx, name });
      });
    } else if (keySource === 'admin') {
      const roomKeys = ['ROOM1_FREEPIK_KEY_1', 'ROOM1_FREEPIK_KEY_2', 'ROOM1_FREEPIK_KEY_3',
                       'ROOM2_FREEPIK_KEY_1', 'ROOM2_FREEPIK_KEY_2', 'ROOM2_FREEPIK_KEY_3',
                       'ROOM3_FREEPIK_KEY_1', 'ROOM3_FREEPIK_KEY_2', 'ROOM3_FREEPIK_KEY_3'];
      roomKeys.forEach((name, idx) => {
        const key = process.env[name];
        if (key) allKeys.push({ key, index: idx, name });
      });
    } else {
      allKeys.push({ key: freepikApiKey, index: 0, name: keySource });
    }
    
    let lastError = null;
    let successResponse = null;
    let finalKeyIndex = usedKeyIndex;
    
    // Try each key until success or all exhausted (with Webshare proxy rotation)
    for (let attempt = 0; attempt < allKeys.length; attempt++) {
      const currentKey = allKeys[attempt];
      console.log(`[TIMING] Attempt ${attempt + 1}/${allKeys.length} - Using key: ${currentKey.name} | Model: ${model}`);
      
      try {
        const response = await makeFreepikRequest(
          'POST',
          `${baseUrl}${config.endpoint}`,
          currentKey.key,
          requestBody,
          true
        );
        
        successResponse = { data: response.data };
        finalKeyIndex = currentKey.index;
        console.log(`[SUCCESS] Key ${currentKey.name} worked!`);
        break;
        
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        
        if (status === 429) {
          console.log(`[RETRY] Key ${currentKey.name} hit budget limit (429), trying next key...`);
          continue;
        } else {
          console.error(`[ERROR] Key ${currentKey.name} failed with status ${status}:`, error.response?.data?.message || error.message);
          break;
        }
      }
    }
    
    if (!successResponse) {
      console.error('All API keys exhausted or failed');
      console.error('Last error:', JSON.stringify(lastError?.response?.data, null, 2) || lastError?.message);
      const errorMsg = lastError?.response?.data?.detail || lastError?.response?.data?.message || lastError?.response?.data?.error || lastError?.message;
      return res.status(500).json({ error: 'Semua API key sudah mencapai limit bulanan. ' + errorMsg });
    }
    
    const taskId = successResponse.data.data?.task_id || successResponse.data.task_id;
    const requestTime = new Date().toISOString();
    const createLatency = Date.now() - startTime;
    
    console.log(`[TIMING] Task ${taskId} created in ${createLatency}ms at ${requestTime} | Model: ${model}`);
    
    // Get the key name that was actually used
    const usedKeyName = allKeys.find(k => k.index === finalKeyIndex)?.name || keySource;
    
    if (taskId) {
      await pool.query(
        'INSERT INTO video_generation_tasks (xclip_api_key_id, user_id, room_id, task_id, model, key_index, used_key_name) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [keyInfo.id, keyInfo.user_id, keyInfo.room_id, taskId, model, finalKeyIndex, usedKeyName]
      );
      console.log(`[SAVED] Task ${taskId} saved with key_name: ${usedKeyName}`);
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
    
    let keyInfo = null;
    let taskResult = null;
    
    // Try API key authentication first
    if (xclipApiKey) {
      keyInfo = await validateXclipApiKey(xclipApiKey);
      if (keyInfo) {
        taskResult = await pool.query(
          'SELECT * FROM video_generation_tasks WHERE task_id = $1 AND xclip_api_key_id = $2',
          [taskId, keyInfo.id]
        );
      }
    }
    
    // Fallback to session authentication (for resumed polling after refresh)
    if (!taskResult || taskResult.rows.length === 0) {
      if (req.session.userId) {
        taskResult = await pool.query(
          'SELECT * FROM video_generation_tasks WHERE task_id = $1 AND user_id = $2',
          [taskId, req.session.userId]
        );
      }
    }
    
    if (!taskResult || taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task tidak ditemukan' });
    }
    
    const savedTask = taskResult.rows[0];
    let freepikApiKey = null;
    let keySource = 'unknown';
    
    // PRIORITY 1: Use the EXACT key name that was saved when task was created
    if (savedTask.used_key_name && process.env[savedTask.used_key_name]) {
      freepikApiKey = process.env[savedTask.used_key_name];
      keySource = savedTask.used_key_name;
    }
    
    // PRIORITY 2: Fallback to room keys using saved index (only if keyInfo available)
    if (!freepikApiKey && keyInfo && keyInfo.room_id) {
      const keyNames = [keyInfo.key_name_1, keyInfo.key_name_2, keyInfo.key_name_3].filter(k => k);
      const keys = keyNames.map(name => ({ key: process.env[name], name })).filter(k => k.key);
      
      if (savedTask.key_index !== null && keys[savedTask.key_index]) {
        freepikApiKey = keys[savedTask.key_index].key;
        keySource = keys[savedTask.key_index].name;
      } else if (keys.length > 0) {
        freepikApiKey = keys[0].key;
        keySource = keys[0].name + '_fallback';
      }
    }
    
    // PRIORITY 3: User's personal API key
    if (!freepikApiKey) {
      const userId = keyInfo?.user_id || savedTask.user_id || req.session.userId;
      if (userId) {
        const userResult = await pool.query('SELECT freepik_api_key FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length > 0 && userResult.rows[0].freepik_api_key) {
          freepikApiKey = userResult.rows[0].freepik_api_key;
          keySource = 'personal';
        }
      }
    }
    
    // PRIORITY 4: Global default
    if (!freepikApiKey) {
      freepikApiKey = process.env.FREEPIK_API_KEY;
      keySource = 'global';
    }
    
    console.log(`[STATUS] Checking task ${taskId} with key: ${keySource}, saved_key_name: ${savedTask.used_key_name}`);
    
    // Status endpoints - based on Freepik API docs (verified January 2026)
    // https://docs.freepik.com/llms.txt
    const statusEndpoints = {
      // Kling 2.6 - shared endpoint for all 2.6 models
      'kling-v2.6-pro': '/v1/ai/image-to-video/kling-v2-6/',
      'kling-v2.6-std': '/v1/ai/image-to-video/kling-v2-6/',
      // Kling O1 - shared endpoint
      'kling-o1-pro': '/v1/ai/image-to-video/kling-o1/',
      'kling-o1-std': '/v1/ai/image-to-video/kling-o1/',
      // Kling 2.5 - uses kling-v2-5-pro (turbo is same as pro)
      'kling-v2.5-turbo': '/v1/ai/image-to-video/kling-v2-5-pro/',
      'kling-v2.5-pro': '/v1/ai/image-to-video/kling-v2-5-pro/',
      // Kling 2.1 - pro/std use shared kling-v2-1, master has own endpoint
      'kling-v2.1-master': '/v1/ai/image-to-video/kling-v2-1-master/',
      'kling-v2.1-pro': '/v1/ai/image-to-video/kling-v2-1/',
      'kling-v2.1-std': '/v1/ai/image-to-video/kling-v2-1/',
      // Kling v2 (older)
      'kling-v2': '/v1/ai/image-to-video/kling-v2/',
      // Kling Elements - SHARED status endpoint (kling-elements)
      'kling-elements-pro': '/v1/ai/image-to-video/kling-elements/',
      'kling-elements-std': '/v1/ai/image-to-video/kling-elements/',
      // Kling 1.6 - SHARED status endpoint (kling)
      'kling-v1.6-pro': '/v1/ai/image-to-video/kling/',
      'kling-v1.6-std': '/v1/ai/image-to-video/kling/',
      'kling-pro': '/v1/ai/image-to-video/kling/',
      'kling-std': '/v1/ai/image-to-video/kling/',
      // Wan 2.6 (naming: wan-v2-6 with 'v')
      'wan-v2.6-1080p': '/v1/ai/image-to-video/wan-v2-6-1080p/',
      'wan-v2.6-720p': '/v1/ai/image-to-video/wan-v2-6-720p/',
      // Wan 2.2
      'wan-v2.2-720p': '/v1/ai/image-to-video/wan-v2-2-720p/',
      'wan-v2.2-580p': '/v1/ai/image-to-video/wan-v2-2-580p/',
      'wan-v2.2-480p': '/v1/ai/image-to-video/wan-v2-2-480p/',
      // MiniMax Hailuo 2.3
      'minimax-hailuo-2.3-1080p': '/v1/ai/image-to-video/minimax-hailuo-2-3-1080p/',
      'minimax-hailuo-2.3-1080p-fast': '/v1/ai/image-to-video/minimax-hailuo-2-3-1080p-fast/',
      'minimax-hailuo-2.3-768p': '/v1/ai/image-to-video/minimax-hailuo-2-3-768p/',
      'minimax-hailuo-2.3-768p-fast': '/v1/ai/image-to-video/minimax-hailuo-2-3-768p-fast/',
      // MiniMax Hailuo 02
      'minimax-hailuo-1080p': '/v1/ai/image-to-video/minimax-hailuo-02-1080p/',
      'minimax-hailuo-768p': '/v1/ai/image-to-video/minimax-hailuo-02-768p/',
      'minimax-hailuo-02-1080p': '/v1/ai/image-to-video/minimax-hailuo-02-1080p/',
      'minimax-hailuo-02-768p': '/v1/ai/image-to-video/minimax-hailuo-02-768p/',
      // Seedance
      'seedance-pro-1080p': '/v1/ai/image-to-video/seedance-pro-1080p/',
      'seedance-pro-720p': '/v1/ai/image-to-video/seedance-pro-720p/',
      'seedance-lite-1080p': '/v1/ai/image-to-video/seedance-lite-1080p/',
      'seedance-lite-720p': '/v1/ai/image-to-video/seedance-lite-720p/',
      // PixVerse
      'pixverse-v5': '/v1/ai/image-to-video/pixverse-v5/'
    };
    
    const endpoint = statusEndpoints[model] || statusEndpoints['kling-v2.5-pro'];
    
    const pollStart = Date.now();
    const response = await makeFreepikRequest(
      'GET',
      `https://api.freepik.com${endpoint}${taskId}`,
      freepikApiKey,
      null,
      true
    );
    const pollLatency = Date.now() - pollStart;
    
    const data = response.data?.data || response.data;
    console.log(`[TIMING] Poll ${taskId} | Status: ${data.status} | Latency: ${pollLatency}ms`);
    console.log(`[DEBUG] Full response:`, JSON.stringify(data, null, 2));
    
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
    const responseData = error.response?.data;
    const isHtmlError = typeof responseData === 'string' && responseData.includes('<!DOCTYPE');
    
    if (isHtmlError) {
      console.error('Freepik server error (HTML response) - server may be down');
      return res.status(503).json({ 
        error: 'Freepik server sedang bermasalah. Coba lagi dalam beberapa saat.',
        retryable: true
      });
    }
    
    console.error('Get task status error:', responseData || error.message);
    res.status(500).json({ error: 'Gagal mengambil status task' });
  }
});

app.post('/api/motion/generate', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    const { model, characterImage, referenceVideo, prompt, characterOrientation, roomId } = req.body;
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    // Get the selected room's API keys (default to room 1)
    const selectedRoomId = roomId || 1;
    let freepikApiKey = null;
    let usedKeyName = null;
    
    // Check room capacity (max 3 users per room in last 30 minutes)
    const usageResult = await pool.query(`
      SELECT COUNT(DISTINCT xclip_api_key_id) as active_users
      FROM video_generation_tasks 
      WHERE model LIKE 'motion-%' 
        AND room_id = $1
        AND created_at > NOW() - INTERVAL '30 minutes'
    `, [selectedRoomId]);
    
    const currentUsers = parseInt(usageResult.rows[0]?.active_users) || 0;
    
    // Check if this user already used this room (allow them to continue)
    const userInRoomResult = await pool.query(`
      SELECT 1 FROM video_generation_tasks 
      WHERE model LIKE 'motion-%' 
        AND room_id = $1 
        AND xclip_api_key_id = $2
        AND created_at > NOW() - INTERVAL '30 minutes'
      LIMIT 1
    `, [selectedRoomId, keyInfo.id]);
    
    const isUserAlreadyInRoom = userInRoomResult.rows.length > 0;
    
    if (currentUsers >= 3 && !isUserAlreadyInRoom) {
      return res.status(400).json({ 
        error: `Room ${selectedRoomId} sudah penuh (3/3 user). Coba room lain.`,
        roomFull: true 
      });
    }
    
    // Get room's API keys from environment
    const roomKeyPrefix = `MOTION_ROOM${selectedRoomId}_KEY_`;
    const allPossibleKeys = [1, 2, 3].map(i => `${roomKeyPrefix}${i}`);
    const roomKeys = allPossibleKeys.filter(k => process.env[k]);
    
    console.log(`[MOTION] Room ${selectedRoomId} available keys: ${roomKeys.length > 0 ? roomKeys.join(', ') : 'NONE'}`);
    console.log(`[MOTION] Checking env vars: ${allPossibleKeys.map(k => `${k}=${process.env[k] ? 'SET' : 'NOT SET'}`).join(', ')}`);
    
    if (roomKeys.length > 0) {
      // Round-robin selection
      const randomKey = roomKeys[Math.floor(Math.random() * roomKeys.length)];
      freepikApiKey = process.env[randomKey];
      usedKeyName = randomKey;
      console.log(`[MOTION] Selected key: ${randomKey}`);
    }
    
    if (!freepikApiKey) {
      return res.status(500).json({ error: `Motion Room ${selectedRoomId} belum dikonfigurasi. Coba room lain atau hubungi admin.` });
    }
    
    if (!characterImage) {
      return res.status(400).json({ error: 'Gambar karakter diperlukan' });
    }
    
    if (!referenceVideo) {
      return res.status(400).json({ error: 'Video referensi diperlukan' });
    }
    
    await pool.query(
      'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [keyInfo.id]
    );
    
    const isPro = model === 'kling-v2.6-pro';
    const endpoint = isPro 
      ? '/v1/ai/video/kling-v2-6-motion-control-pro' 
      : '/v1/ai/video/kling-v2-6-motion-control-std';
    
    // Get base URL for public file access
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    
    console.log(`[MOTION] Saving files to public storage, base URL: ${baseUrl}`);
    
    // Save image and video to public files
    const imageFile = await saveBase64ToFile(characterImage, 'image', baseUrl);
    const videoFile = await saveBase64ToFile(referenceVideo, 'video', baseUrl);
    
    console.log(`[MOTION] Image URL: ${imageFile.publicUrl}`);
    console.log(`[MOTION] Video URL: ${videoFile.publicUrl}`);
    
    // Get webhook URL for instant notifications
    const webhookUrl = getWebhookUrl();
    console.log(`[MOTION] Using webhook: ${webhookUrl}`);
    
    const requestBody = {
      image_url: imageFile.publicUrl,
      video_url: videoFile.publicUrl,
      character_orientation: characterOrientation || 'video'
    };
    
    // Add webhook for instant completion notification
    if (webhookUrl) {
      requestBody.webhook_url = webhookUrl;
    }
    
    if (prompt && prompt.trim()) {
      requestBody.prompt = prompt.trim();
    }
    
    console.log(`[MOTION] Generating motion video with model: ${model}`);
    console.log(`[MOTION] Request body:`, JSON.stringify(requestBody));
    
    const response = await makeFreepikRequest(
      'POST',
      `https://api.freepik.com${endpoint}`,
      freepikApiKey,
      requestBody,
      true
    );
    
    console.log(`[MOTION] Freepik response:`, JSON.stringify(response.data));
    
    const taskId = response.data?.data?.task_id || response.data?.task_id || response.data?.data?.id || response.data?.id;
    
    console.log(`[MOTION] Task created: ${taskId}`);
    
    if (taskId) {
      await pool.query(
        `INSERT INTO video_generation_tasks (xclip_api_key_id, user_id, room_id, task_id, model, used_key_name) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [keyInfo.id, keyInfo.user_id, selectedRoomId, taskId, 'motion-' + model, usedKeyName]
      );
      console.log(`[MOTION] Task ${taskId} saved with key_name: ${usedKeyName}, motion_room: ${selectedRoomId}`);
    }
    
    res.json({
      success: true,
      taskId: taskId,
      model: model,
      createdAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Motion generation error:', error.response?.data || error.message);
    const errorMsg = error.response?.data?.detail || error.response?.data?.message || error.message;
    res.status(500).json({ error: 'Gagal memproses motion: ' + errorMsg });
  }
});

app.get('/api/motion/tasks/:taskId', async (req, res) => {
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
    
    // First try to use the exact key that was used for generation
    if (savedTask.used_key_name && savedTask.used_key_name !== 'personal' && savedTask.used_key_name !== 'global') {
      freepikApiKey = process.env[savedTask.used_key_name];
      console.log(`[MOTION] Using saved key: ${savedTask.used_key_name}, found: ${!!freepikApiKey}`);
    }
    
    if (!freepikApiKey && savedTask.used_key_name === 'personal') {
      const userResult = await pool.query('SELECT freepik_api_key FROM users WHERE id = $1', [keyInfo.user_id]);
      if (userResult.rows.length > 0 && userResult.rows[0].freepik_api_key) {
        freepikApiKey = userResult.rows[0].freepik_api_key;
      }
    }
    
    // For motion tasks, try motion room keys (motion tasks store room_id as the motion room number)
    if (!freepikApiKey && savedTask.room_id && savedTask.model?.startsWith('motion-')) {
      const motionRoomKeys = [
        `MOTION_ROOM${savedTask.room_id}_KEY_1`,
        `MOTION_ROOM${savedTask.room_id}_KEY_2`,
        `MOTION_ROOM${savedTask.room_id}_KEY_3`
      ];
      for (const keyName of motionRoomKeys) {
        if (process.env[keyName]) {
          freepikApiKey = process.env[keyName];
          console.log(`[MOTION] Using motion room key: ${keyName}`);
          break;
        }
      }
    }
    
    if (!freepikApiKey && keyInfo.room_id) {
      const rotated = getRotatedApiKey(keyInfo, savedTask.key_index);
      freepikApiKey = rotated.key;
    }
    
    if (!freepikApiKey && keyInfo.is_admin) {
      const roomKeys = ['MOTION_ROOM1_KEY_1', 'MOTION_ROOM2_KEY_1', 'MOTION_ROOM3_KEY_1', 'ROOM1_FREEPIK_KEY_1', 'ROOM2_FREEPIK_KEY_1', 'ROOM3_FREEPIK_KEY_1'];
      for (const keyName of roomKeys) {
        if (process.env[keyName]) {
          freepikApiKey = process.env[keyName];
          break;
        }
      }
    }
    
    if (!freepikApiKey) {
      freepikApiKey = process.env.FREEPIK_API_KEY;
    }
    
    if (!freepikApiKey) {
      return res.status(500).json({ error: 'Tidak ada API key yang tersedia' });
    }
    
    // Try multiple polling endpoints
    // Docs say /v1/ai/image-to-video/kling-v2-6/{task-id} but task created via /v1/ai/video/
    const storedModel = savedTask.model || '';
    const isPro = storedModel.includes('pro');
    
    const pollEndpoints = [
      `/v1/ai/image-to-video/kling-v2-6/${taskId}`,
      isPro ? `/v1/ai/video/kling-v2-6-motion-control-pro/${taskId}` : `/v1/ai/video/kling-v2-6-motion-control-std/${taskId}`,
      `/v1/ai/video/kling-v2-6/${taskId}`
    ];
    
    let response = null;
    let successEndpoint = null;
    
    for (const endpoint of pollEndpoints) {
      try {
        console.log(`[MOTION] Trying poll endpoint: ${endpoint}`);
        const pollResponse = await makeFreepikRequest(
          'GET',
          `https://api.freepik.com${endpoint}`,
          freepikApiKey,
          null,
          true
        );
        
        if (pollResponse.data && !pollResponse.data?.message?.includes('Not found')) {
          response = pollResponse;
          successEndpoint = endpoint;
          console.log(`[MOTION] Poll success with: ${endpoint}`);
          
          // If this endpoint shows different status than CREATED, use it
          const status = pollResponse.data?.data?.status || pollResponse.data?.status;
          if (status && status !== 'CREATED') {
            console.log(`[MOTION] Found active status ${status} on ${endpoint}`);
            break;
          }
        }
      } catch (err) {
        console.log(`[MOTION] Poll endpoint ${endpoint} failed:`, err.response?.data?.message || err.message);
      }
    }
    
    if (!response || !response.data) {
      return res.status(404).json({ error: 'Task tidak ditemukan di Freepik' });
    }
    
    console.log(`[MOTION] Using endpoint: ${successEndpoint}`)
    
    console.log(`[MOTION] Poll response:`, JSON.stringify(response.data));
    const data = response.data?.data || response.data;
    console.log(`[MOTION] Poll ${taskId} | Status: ${data?.status || 'unknown'} | Generated: ${JSON.stringify(data?.generated || [])}`);
    
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
    
    const normalizedStatus = (data.status || 'processing').toLowerCase();
    res.json({
      status: normalizedStatus === 'completed' || normalizedStatus === 'success' ? 'completed' : normalizedStatus,
      progress: data.progress || 0,
      videoUrl: videoUrl,
      taskId: taskId
    });
    
  } catch (error) {
    console.error('Motion poll error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Gagal mengambil status motion task' });
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

// Get video generation history for current user
app.get('/api/videogen/history', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ videos: [], processing: [] });
  }
  
  try {
    // Get completed videos (exclude deleted)
    const completedResult = await pool.query(
      `SELECT task_id, model, status, video_url, created_at, completed_at
       FROM video_generation_tasks 
       WHERE user_id = $1 AND video_url IS NOT NULL AND status = 'completed'
       ORDER BY completed_at DESC NULLS LAST, created_at DESC
       LIMIT 20`,
      [req.session.userId]
    );
    
    // Get processing videos (within last 30 minutes, exclude deleted)
    const processingResult = await pool.query(
      `SELECT task_id, model, status, created_at
       FROM video_generation_tasks 
       WHERE user_id = $1 AND status = 'processing'
       AND created_at > NOW() - INTERVAL '30 minutes'
       ORDER BY created_at DESC`,
      [req.session.userId]
    );
    
    res.json({ 
      videos: completedResult.rows.map(row => ({
        taskId: row.task_id,
        model: row.model,
        url: row.video_url,
        createdAt: row.completed_at || row.created_at
      })),
      processing: processingResult.rows.map(row => ({
        taskId: row.task_id,
        model: row.model,
        createdAt: row.created_at
      }))
    });
    
  } catch (error) {
    console.error('Get video history error:', error);
    res.status(500).json({ error: 'Gagal mengambil history video' });
  }
});

// Proxy download endpoint for iOS (streams video through server with proper headers)
app.get('/api/download-video', async (req, res) => {
  const { url, filename } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL diperlukan' });
  }
  
  let streamClosed = false;
  
  // Handle client disconnect gracefully
  req.on('close', () => {
    streamClosed = true;
  });
  
  res.on('close', () => {
    streamClosed = true;
  });
  
  try {
    const axios = require('axios');
    const response = await axios({
      method: 'GET',
      url: decodeURIComponent(url),
      responseType: 'stream',
      timeout: 120000, // 2 minutes for large videos
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
      }
    });
    
    const safeName = (filename || 'video').replace(/[^a-zA-Z0-9_-]/g, '_') + '.mp4';
    
    // Set headers for download
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    
    // Pipe the video stream to response
    response.data.pipe(res);
    
    response.data.on('error', (err) => {
      // Ignore ECONNRESET - it's normal when client cancels download
      if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || streamClosed) {
        console.log('Download cancelled by client (normal)');
        return;
      }
      console.error('Stream error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Gagal download video' });
      }
    });
    
    response.data.on('end', () => {
      if (!streamClosed) {
        console.log('Download completed successfully');
      }
    });
    
  } catch (error) {
    // Ignore connection reset errors
    if (error.code === 'ECONNRESET' || error.code === 'EPIPE' || streamClosed) {
      console.log('Download request cancelled');
      return;
    }
    console.error('Download proxy error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Gagal download video: ' + error.message });
    }
  }
});

// Delete video from history (mark as deleted)
app.delete('/api/videogen/history/:taskId', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  try {
    const { taskId } = req.params;
    
    // Mark as deleted instead of actually deleting (soft delete)
    await pool.query(
      `UPDATE video_generation_tasks 
       SET status = 'deleted' 
       WHERE task_id = $1 AND user_id = $2`,
      [taskId, req.session.userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete video history error:', error);
    res.status(500).json({ error: 'Gagal menghapus video' });
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

// X Maker route removed - will be rebuilt

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

// Get room droplet config (admin only)
app.get('/api/admin/rooms/droplets', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, droplet_ip, droplet_port, use_proxy 
      FROM rooms ORDER BY id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get droplet config error:', error);
    res.status(500).json({ error: 'Gagal mengambil konfigurasi droplet' });
  }
});

// Update room droplet config (admin only)
app.post('/api/admin/rooms/:id/droplet', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { droplet_ip, droplet_port, proxy_secret, use_proxy } = req.body;
    
    await pool.query(`
      UPDATE rooms SET 
        droplet_ip = $1,
        droplet_port = $2,
        proxy_secret = $3,
        use_proxy = $4
      WHERE id = $5
    `, [droplet_ip, droplet_port || 3000, proxy_secret, use_proxy || false, id]);
    
    res.json({ success: true, message: 'Konfigurasi droplet berhasil diupdate' });
  } catch (error) {
    console.error('Update droplet config error:', error);
    res.status(500).json({ error: 'Gagal update konfigurasi droplet' });
  }
});

// Test droplet connection (admin only)
app.post('/api/admin/rooms/:id/test-droplet', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const roomResult = await pool.query(
      'SELECT droplet_ip, droplet_port, proxy_secret FROM rooms WHERE id = $1',
      [id]
    );
    
    const room = roomResult.rows[0];
    if (!room || !room.droplet_ip) {
      return res.status(400).json({ error: 'Droplet belum dikonfigurasi' });
    }
    
    const port = room.droplet_port || 3000;
    const healthUrl = `http://${room.droplet_ip}:${port}/health`;
    
    const response = await axios.get(healthUrl, { timeout: 5000 });
    
    res.json({ 
      success: true, 
      message: 'Droplet aktif dan bisa diakses',
      data: response.data
    });
  } catch (error) {
    console.error('Test droplet error:', error.message);
    res.status(500).json({ 
      error: 'Tidak bisa terhubung ke droplet',
      details: error.message
    });
  }
});

// ==================== ROOM MANAGER API ====================

// Get all rooms with status (filter by feature: videogen or xmaker)
app.get('/api/rooms', async (req, res) => {
  try {
    await cleanupInactiveUsers();
    
    // Only videogen rooms (freepik provider), not xmaker rooms
    const result = await pool.query(`
      SELECT id, name, provider, max_users, active_users, status,
             key_name_1, key_name_2, key_name_3, provider_key_name,
             (max_users - active_users) as available_slots
      FROM rooms 
      WHERE provider = 'freepik'
      ORDER BY id
    `);
    
    const rooms = result.rows.map(room => {
      // Determine status based on active_users vs max_users
      let roomStatus = room.status;
      if (room.active_users >= room.max_users && roomStatus === 'OPEN') {
        roomStatus = 'FULL';
      } else if (room.active_users < room.max_users && roomStatus === 'FULL') {
        roomStatus = 'OPEN';
      }
      
      return {
        id: room.id,
        name: room.name,
        provider: room.provider,
        max_users: room.max_users,
        active_users: room.active_users,
        status: roomStatus,
        available_slots: room.available_slots
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
             p.name as plan_name, p.duration_days, p.price_idr,
             EXTRACT(EPOCH FROM (s.expired_at - NOW())) as remaining_seconds
      FROM subscriptions s
      LEFT JOIN rooms r ON s.room_id = r.id
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

// Select/join a room (for videogen - xmaker will be rebuilt separately)
app.post('/api/room/select', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }
    
    const { roomId } = req.body;
    
    // Check if user is admin (admin can bypass subscription)
    const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
    const isAdmin = adminCheck.rows[0]?.is_admin || false;
    
    // Check active subscription
    let subResult = await pool.query(`
      SELECT id, room_id FROM subscriptions 
      WHERE user_id = $1 AND status = 'active' AND expired_at > NOW()
    `, [req.session.userId]);
    
    // If admin has no subscription, create a temporary one
    if (subResult.rows.length === 0 && isAdmin) {
      const tempSub = await pool.query(`
        INSERT INTO subscriptions (user_id, status, expired_at)
        VALUES ($1, 'active', NOW() + INTERVAL '1 year')
        RETURNING id, room_id
      `, [req.session.userId]);
      subResult = tempSub;
    }
    
    if (subResult.rows.length === 0) {
      return res.status(403).json({ error: 'No active subscription. Please buy a package first.' });
    }
    
    const subscription = subResult.rows[0];
    const currentRoomId = subscription.room_id;
    
    // If already in a room, leave it first
    if (currentRoomId) {
      await pool.query(`
        UPDATE rooms SET active_users = GREATEST(active_users - 1, 0) WHERE id = $1
      `, [currentRoomId]);
    }
    
    // Check room availability
    const roomResult = await pool.query(`
      SELECT id, name, max_users, active_users, status, key_name_1
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
      UPDATE subscriptions SET room_id = $1 WHERE id = $2
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

// Leave current room (for videogen - xmaker will be rebuilt separately)
app.post('/api/room/leave', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }
    
    const subResult = await pool.query(`
      SELECT id, room_id FROM subscriptions 
      WHERE user_id = $1 AND status = 'active' AND expired_at > NOW()
    `, [req.session.userId]);
    
    const currentRoomId = subResult.rows[0]?.room_id;
    
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
      UPDATE subscriptions SET room_id = NULL WHERE id = $1
    `, [subscription.id]);
    
    res.json({ success: true, message: 'Left room successfully' });
  } catch (error) {
    console.error('Leave room error:', error);
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

// Helper: Get API key for user's room with 3-minute rotation (videogen only)
async function getRoomApiKey(userId) {
  const result = await pool.query(`
    SELECT r.key_name_1, r.key_name_2, r.key_name_3 
    FROM subscriptions s
    JOIN rooms r ON s.room_id = r.id
    WHERE s.user_id = $1 AND s.status = 'active' AND s.expired_at > NOW() AND s.room_id IS NOT NULL
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

// ==================== MOTION ROOM MANAGER API ====================

// Get motion room usage (active users per room)
app.get('/api/motion/room-usage', async (req, res) => {
  try {
    // Count active tasks per room in the last 30 minutes (considered active)
    const result = await pool.query(`
      SELECT room_id, COUNT(DISTINCT xclip_api_key_id) as active_users
      FROM video_generation_tasks 
      WHERE model LIKE 'motion-%' 
        AND created_at > NOW() - INTERVAL '30 minutes'
        AND room_id IS NOT NULL
      GROUP BY room_id
    `);
    
    const usage = { 1: 0, 2: 0, 3: 0 };
    result.rows.forEach(row => {
      if (row.room_id && usage.hasOwnProperty(row.room_id)) {
        usage[row.room_id] = parseInt(row.active_users) || 0;
      }
    });
    
    res.json({ usage });
  } catch (error) {
    console.error('Get motion room usage error:', error);
    res.json({ usage: { 1: 0, 2: 0, 3: 0 } });
  }
});

// Get all motion rooms
app.get('/api/motion/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, max_users, active_users, status,
             key_name_1, key_name_2, key_name_3,
             (max_users - active_users) as available_slots
      FROM motion_rooms 
      ORDER BY id
    `);
    
    const rooms = result.rows.map(room => {
      const keyNames = [room.key_name_1, room.key_name_2, room.key_name_3].filter(k => k);
      const hasApiKeys = keyNames.some(name => process.env[name]);
      
      return {
        id: room.id,
        name: room.name,
        max_users: room.max_users,
        active_users: room.active_users,
        status: hasApiKeys ? room.status : 'maintenance',
        available_slots: room.available_slots,
        maintenance_reason: hasApiKeys ? null : 'API key belum dikonfigurasi'
      };
    });
    
    res.json({ rooms });
  } catch (error) {
    console.error('Get motion rooms error:', error);
    res.status(500).json({ error: 'Failed to get motion rooms' });
  }
});

// Get user motion subscription status
app.get('/api/motion/subscription/status', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ hasSubscription: false, message: 'Not logged in' });
    }
    
    const result = await pool.query(`
      SELECT ms.*, mr.name as room_name, mr.status as room_status,
             EXTRACT(EPOCH FROM (ms.expired_at - NOW())) as remaining_seconds
      FROM motion_subscriptions ms
      JOIN motion_rooms mr ON ms.motion_room_id = mr.id
      WHERE ms.user_id = $1 AND ms.is_active = true AND ms.expired_at > NOW()
      ORDER BY ms.expired_at DESC
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
        roomId: sub.motion_room_id,
        roomName: sub.room_name,
        roomStatus: sub.room_status,
        startedAt: sub.started_at,
        expiredAt: sub.expired_at,
        remainingSeconds: Math.max(0, Math.floor(sub.remaining_seconds))
      }
    });
  } catch (error) {
    console.error('Motion subscription status error:', error);
    res.status(500).json({ error: 'Failed to get motion subscription status' });
  }
});

// Join a motion room (via Xclip API key)
app.post('/api/motion/rooms/:roomId/join', async (req, res) => {
  try {
    const { xclipApiKey } = req.body;
    const { roomId } = req.params;
    
    if (!xclipApiKey) {
      return res.status(400).json({ error: 'Xclip API key diperlukan' });
    }
    
    // Validate Xclip API key
    const keyResult = await pool.query(
      'SELECT xk.*, u.username FROM xclip_api_keys xk JOIN users u ON xk.user_id = u.id WHERE xk.api_key = $1 AND xk.is_active = true',
      [xclipApiKey]
    );
    
    if (keyResult.rows.length === 0) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    const keyOwner = keyResult.rows[0];
    const userId = keyOwner.user_id;
    
    // Check if room exists and has space
    const roomResult = await pool.query(
      'SELECT * FROM motion_rooms WHERE id = $1',
      [roomId]
    );
    
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Motion room tidak ditemukan' });
    }
    
    const room = roomResult.rows[0];
    
    if (room.status !== 'open') {
      return res.status(400).json({ error: 'Motion room sedang dalam maintenance' });
    }
    
    if (room.active_users >= room.max_users) {
      return res.status(400).json({ error: 'Motion room sudah penuh' });
    }
    
    // Check if user already has active subscription
    const existingSub = await pool.query(`
      SELECT ms.*, mr.name as room_name FROM motion_subscriptions ms
      JOIN motion_rooms mr ON ms.motion_room_id = mr.id
      WHERE ms.user_id = $1 AND ms.is_active = true AND ms.expired_at > NOW()
    `, [userId]);
    
    if (existingSub.rows.length > 0) {
      return res.status(400).json({ 
        error: `Anda sudah bergabung di ${existingSub.rows[0].room_name}. Leave room dulu sebelum join room lain.`
      });
    }
    
    // Create subscription (30 days by default)
    const expiredAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    
    await pool.query(`
      INSERT INTO motion_subscriptions (user_id, motion_room_id, expired_at, is_active)
      VALUES ($1, $2, $3, true)
    `, [userId, roomId, expiredAt]);
    
    // Increment active users
    await pool.query(
      'UPDATE motion_rooms SET active_users = active_users + 1 WHERE id = $1',
      [roomId]
    );
    
    res.json({
      success: true,
      message: `Berhasil bergabung ke ${room.name}`,
      subscription: {
        roomId: room.id,
        roomName: room.name,
        expiredAt: expiredAt
      }
    });
  } catch (error) {
    console.error('Join motion room error:', error);
    res.status(500).json({ error: 'Gagal bergabung ke room' });
  }
});

// Leave motion room
app.post('/api/motion/rooms/leave', async (req, res) => {
  try {
    const { xclipApiKey } = req.body;
    
    if (!xclipApiKey) {
      return res.status(400).json({ error: 'Xclip API key diperlukan' });
    }
    
    // Validate Xclip API key
    const keyResult = await pool.query(
      'SELECT user_id FROM xclip_api_keys WHERE api_key = $1 AND is_active = true',
      [xclipApiKey]
    );
    
    if (keyResult.rows.length === 0) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    const userId = keyResult.rows[0].user_id;
    
    // Find active subscription
    const subResult = await pool.query(`
      SELECT ms.*, mr.name as room_name FROM motion_subscriptions ms
      JOIN motion_rooms mr ON ms.motion_room_id = mr.id
      WHERE ms.user_id = $1 AND ms.is_active = true AND ms.expired_at > NOW()
    `, [userId]);
    
    if (subResult.rows.length === 0) {
      return res.status(400).json({ error: 'Anda tidak memiliki subscription motion room aktif' });
    }
    
    const sub = subResult.rows[0];
    
    // Deactivate subscription
    await pool.query(
      'UPDATE motion_subscriptions SET is_active = false WHERE id = $1',
      [sub.id]
    );
    
    // Decrement active users
    await pool.query(
      'UPDATE motion_rooms SET active_users = GREATEST(0, active_users - 1) WHERE id = $1',
      [sub.motion_room_id]
    );
    
    res.json({
      success: true,
      message: `Berhasil keluar dari ${sub.room_name}`
    });
  } catch (error) {
    console.error('Leave motion room error:', error);
    res.status(500).json({ error: 'Gagal keluar dari room' });
  }
});

// Get motion room API key for user (internal use)
async function getMotionRoomApiKey(xclipApiKey) {
  // Validate Xclip API key and get user
  const keyResult = await pool.query(
    'SELECT user_id FROM xclip_api_keys WHERE api_key = $1 AND is_active = true',
    [xclipApiKey]
  );
  
  if (keyResult.rows.length === 0) {
    return { error: 'Xclip API key tidak valid' };
  }
  
  const userId = keyResult.rows[0].user_id;
  
  // Get user's motion subscription
  const subResult = await pool.query(`
    SELECT ms.motion_room_id, mr.key_name_1, mr.key_name_2, mr.key_name_3
    FROM motion_subscriptions ms
    JOIN motion_rooms mr ON ms.motion_room_id = mr.id
    WHERE ms.user_id = $1 AND ms.is_active = true AND ms.expired_at > NOW()
  `, [userId]);
  
  if (subResult.rows.length === 0) {
    return { error: 'Anda belum bergabung ke motion room manapun' };
  }
  
  const room = subResult.rows[0];
  const keyNames = [room.key_name_1, room.key_name_2, room.key_name_3].filter(k => k && process.env[k]);
  
  if (keyNames.length === 0) {
    return { error: 'Motion room tidak memiliki API key yang valid' };
  }
  
  // Round-robin key selection
  const randomKey = keyNames[Math.floor(Math.random() * keyNames.length)];
  return { 
    apiKey: process.env[randomKey], 
    keyName: randomKey,
    roomId: room.motion_room_id
  };
}

// ==================== X MAKER ROUTES ====================

// Get all X Maker rooms
app.get('/api/xmaker/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, max_users, current_users, is_active
      FROM xmaker_rooms 
      WHERE is_active = true
      ORDER BY id
    `);
    
    const rooms = result.rows.map(room => ({
      ...room,
      availableSlots: room.max_users - room.current_users
    }));
    
    res.json({ rooms });
  } catch (error) {
    console.error('Get xmaker rooms error:', error);
    res.status(500).json({ error: 'Failed to get xmaker rooms' });
  }
});

// Get user's X Maker subscription
app.get('/api/xmaker/subscription', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ subscription: null });
  }
  
  try {
    const result = await pool.query(`
      SELECT xs.*, xr.name as room_name
      FROM xmaker_subscriptions xs
      JOIN xmaker_rooms xr ON xs.xmaker_room_id = xr.id
      WHERE xs.user_id = $1 AND xs.is_active = true AND xs.expired_at > NOW()
      ORDER BY xs.created_at DESC
      LIMIT 1
    `, [req.session.userId]);
    
    if (result.rows.length === 0) {
      return res.json({ subscription: null });
    }
    
    const sub = result.rows[0];
    res.json({
      subscription: {
        roomId: sub.xmaker_room_id,
        roomName: sub.room_name,
        expiredAt: sub.expired_at
      }
    });
  } catch (error) {
    console.error('Get xmaker subscription error:', error);
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Join X Maker room
app.post('/api/xmaker/rooms/:roomId/join', async (req, res) => {
  const { roomId } = req.params;
  const xclipApiKey = req.headers['x-xclip-key'];
  
  if (!xclipApiKey) {
    return res.status(400).json({ error: 'Xclip API key diperlukan' });
  }
  
  try {
    // Validate Xclip API key
    const keyResult = await pool.query(
      'SELECT user_id FROM xclip_api_keys WHERE api_key = $1 AND is_active = true',
      [xclipApiKey]
    );
    
    if (keyResult.rows.length === 0) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    const userId = keyResult.rows[0].user_id;
    
    // Check room exists and has capacity
    const roomResult = await pool.query(
      'SELECT * FROM xmaker_rooms WHERE id = $1',
      [roomId]
    );
    
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room tidak ditemukan' });
    }
    
    const room = roomResult.rows[0];
    
    if (room.current_users >= room.max_users) {
      return res.status(400).json({ error: 'Room sudah penuh, silakan pilih room lain' });
    }
    
    // Check existing subscription
    const existingSub = await pool.query(`
      SELECT xs.*, xr.name as room_name
      FROM xmaker_subscriptions xs
      JOIN xmaker_rooms xr ON xs.xmaker_room_id = xr.id
      WHERE xs.user_id = $1 AND xs.is_active = true AND xs.expired_at > NOW()
    `, [userId]);
    
    if (existingSub.rows.length > 0) {
      return res.status(400).json({ 
        error: `Anda sudah bergabung di ${existingSub.rows[0].room_name}. Keluar dulu sebelum pindah room.`
      });
    }
    
    // Create subscription (30 days)
    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + 30);
    
    await pool.query(
      'INSERT INTO xmaker_subscriptions (user_id, xmaker_room_id, expired_at, is_active) VALUES ($1, $2, $3, true)',
      [userId, roomId, expiredAt]
    );
    
    // Increment room users
    await pool.query(
      'UPDATE xmaker_rooms SET current_users = current_users + 1 WHERE id = $1',
      [roomId]
    );
    
    res.json({
      success: true,
      message: `Berhasil bergabung ke ${room.name}`,
      subscription: {
        roomId: room.id,
        roomName: room.name,
        expiredAt: expiredAt
      }
    });
  } catch (error) {
    console.error('Join xmaker room error:', error);
    res.status(500).json({ error: 'Gagal bergabung ke room' });
  }
});

// Leave X Maker room
app.post('/api/xmaker/rooms/leave', async (req, res) => {
  const xclipApiKey = req.headers['x-xclip-key'];
  
  if (!xclipApiKey) {
    return res.status(400).json({ error: 'Xclip API key diperlukan' });
  }
  
  try {
    const keyResult = await pool.query(
      'SELECT user_id FROM xclip_api_keys WHERE api_key = $1 AND is_active = true',
      [xclipApiKey]
    );
    
    if (keyResult.rows.length === 0) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    const userId = keyResult.rows[0].user_id;
    
    const subResult = await pool.query(`
      SELECT xs.*, xr.name as room_name
      FROM xmaker_subscriptions xs
      JOIN xmaker_rooms xr ON xs.xmaker_room_id = xr.id
      WHERE xs.user_id = $1 AND xs.is_active = true AND xs.expired_at > NOW()
    `, [userId]);
    
    if (subResult.rows.length === 0) {
      return res.status(400).json({ error: 'Anda tidak memiliki subscription X Maker aktif' });
    }
    
    const sub = subResult.rows[0];
    
    await pool.query(
      'UPDATE xmaker_subscriptions SET is_active = false WHERE id = $1',
      [sub.id]
    );
    
    await pool.query(
      'UPDATE xmaker_rooms SET current_users = GREATEST(0, current_users - 1) WHERE id = $1',
      [sub.xmaker_room_id]
    );
    
    res.json({
      success: true,
      message: `Berhasil keluar dari ${sub.room_name}`
    });
  } catch (error) {
    console.error('Leave xmaker room error:', error);
    res.status(500).json({ error: 'Gagal keluar dari room' });
  }
});

// Get X Maker room API key (internal helper)
async function getXMakerRoomApiKey(xclipApiKey) {
  const keyResult = await pool.query(
    'SELECT user_id FROM xclip_api_keys WHERE api_key = $1 AND is_active = true',
    [xclipApiKey]
  );
  
  if (keyResult.rows.length === 0) {
    return { error: 'Xclip API key tidak valid' };
  }
  
  const userId = keyResult.rows[0].user_id;
  
  const subResult = await pool.query(`
    SELECT xs.xmaker_room_id, xr.key_name
    FROM xmaker_subscriptions xs
    JOIN xmaker_rooms xr ON xs.xmaker_room_id = xr.id
    WHERE xs.user_id = $1 AND xs.is_active = true AND xs.expired_at > NOW()
  `, [userId]);
  
  if (subResult.rows.length === 0) {
    return { error: 'Anda belum bergabung ke X Maker room. Silakan join room terlebih dahulu.' };
  }
  
  const room = subResult.rows[0];
  const keyName = room.key_name;
  
  if (!keyName || !process.env[keyName]) {
    return { error: 'Room tidak memiliki API key yang valid' };
  }
  
  return { 
    apiKey: process.env[keyName], 
    keyName: keyName,
    roomId: room.xmaker_room_id
  };
}

// Generate image with GeminiGen.AI
app.post('/api/xmaker/generate', async (req, res) => {
  const xclipApiKey = req.headers['x-xclip-key'];
  const { prompt, model, style, aspectRatio, referenceImage, sceneNumber } = req.body;
  
  if (!xclipApiKey) {
    return res.status(400).json({ error: 'Xclip API key diperlukan' });
  }
  
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt diperlukan' });
  }
  
  try {
    // Get room API key
    const roomKeyResult = await getXMakerRoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      return res.status(400).json({ error: roomKeyResult.error });
    }
    
    const geminiGenApiKey = roomKeyResult.apiKey;
    
    // Build form data for GeminiGen API
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('model', model || 'nano-banana');
    
    if (style) formData.append('style', style);
    if (aspectRatio) formData.append('aspect_ratio', aspectRatio);
    
    // Handle reference image (base64)
    if (referenceImage && model === 'nano-banana') {
      // Convert base64 to buffer
      const base64Data = referenceImage.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      formData.append('reference_image', imageBuffer, {
        filename: 'reference.png',
        contentType: 'image/png'
      });
    }
    
    console.log(`[XMAKER] Generating image with model: ${model || 'nano-banana'}, room: ${roomKeyResult.roomId}`);
    
    // Call GeminiGen API
    const response = await axios.post(
      'https://api.geminigen.ai/uapi/v1/generate_image',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Accept': 'application/json',
          'x-api-key': geminiGenApiKey
        },
        timeout: 120000
      }
    );
    
    console.log('[XMAKER] API Response:', response.data);
    
    // Save task to database
    const keyResult = await pool.query(
      'SELECT user_id FROM xclip_api_keys WHERE api_key = $1',
      [xclipApiKey]
    );
    const userId = keyResult.rows[0]?.user_id;
    
    if (userId) {
      await pool.query(`
        INSERT INTO xmaker_tasks (user_id, room_id, task_uuid, prompt, model, style, aspect_ratio, status, scene_number)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
      `, [userId, roomKeyResult.roomId, response.data.uuid, prompt, model || 'nano-banana', style, aspectRatio, sceneNumber || 1]);
    }
    
    res.json({
      success: true,
      taskId: response.data.uuid,
      status: 'pending',
      message: 'Gambar sedang di-generate. Tunggu beberapa saat...'
    });
    
  } catch (error) {
    console.error('[XMAKER] Generate error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: error.response?.data?.message || 'Gagal generate gambar' 
    });
  }
});

// Poll task status
app.get('/api/xmaker/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const xclipApiKey = req.headers['x-xclip-key'];
  
  if (!xclipApiKey) {
    return res.status(400).json({ error: 'Xclip API key diperlukan' });
  }
  
  try {
    const roomKeyResult = await getXMakerRoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      return res.status(400).json({ error: roomKeyResult.error });
    }
    
    // Check local database first
    const localTask = await pool.query(
      'SELECT * FROM xmaker_tasks WHERE task_uuid = $1',
      [taskId]
    );
    
    if (localTask.rows.length > 0 && localTask.rows[0].status === 'completed') {
      return res.json({
        status: 'completed',
        imageUrl: localTask.rows[0].result_image_url
      });
    }
    
    // Poll GeminiGen API for status
    // Note: GeminiGen uses webhooks, so we might need to implement that
    // For now, return pending status
    res.json({
      status: 'pending',
      message: 'Gambar masih dalam proses...'
    });
    
  } catch (error) {
    console.error('[XMAKER] Poll error:', error);
    res.status(500).json({ error: 'Gagal check status' });
  }
});

// Webhook for GeminiGen.AI callbacks
app.post('/api/xmaker/webhook', async (req, res) => {
  try {
    const { event_name, event_uuid, data } = req.body;
    
    console.log('[XMAKER WEBHOOK] Received:', event_name, data?.uuid);
    
    if (event_name === 'IMAGE_GENERATION_COMPLETED' && data) {
      // Update task in database
      await pool.query(`
        UPDATE xmaker_tasks 
        SET status = 'completed', result_image_url = $1, updated_at = NOW()
        WHERE task_uuid = $2
      `, [data.media_url, data.uuid]);
      
      // Get user_id for SSE notification
      const taskResult = await pool.query(
        'SELECT user_id FROM xmaker_tasks WHERE task_uuid = $1',
        [data.uuid]
      );
      
      if (taskResult.rows.length > 0) {
        const userId = taskResult.rows[0].user_id;
        // Send SSE notification
        const userConnections = sseConnections.get(userId);
        if (userConnections) {
          userConnections.forEach(res => {
            res.write(`data: ${JSON.stringify({
              type: 'xmaker_complete',
              taskId: data.uuid,
              imageUrl: data.media_url
            })}\n\n`);
          });
        }
      }
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('[XMAKER WEBHOOK] Error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Get X Maker history
app.get('/api/xmaker/history', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ images: [] });
  }
  
  try {
    const result = await pool.query(`
      SELECT * FROM xmaker_tasks 
      WHERE user_id = $1 AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.session.userId]);
    
    res.json({ images: result.rows });
  } catch (error) {
    console.error('Get xmaker history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// ============ VIDGEN2 (GEMINIGEN.AI) API ============

// Helper: Get Vidgen2 room API key
async function getVidgen2RoomApiKey(xclipApiKey) {
  const keyInfo = await validateXclipApiKey(xclipApiKey);
  if (!keyInfo) {
    return { error: 'Xclip API key tidak valid' };
  }
  
  // Get user's vidgen2 room from subscription
  const subResult = await pool.query(`
    SELECT s.vidgen2_room_id 
    FROM subscriptions s 
    WHERE s.user_id = $1 AND s.status = 'active' 
    AND (s.expired_at IS NULL OR s.expired_at > NOW())
    ORDER BY s.created_at DESC LIMIT 1
  `, [keyInfo.user_id]);
  
  const vidgen2RoomId = subResult.rows[0]?.vidgen2_room_id || 1;
  
  // Get room keys from environment
  const roomKeyPrefix = `VIDGEN2_ROOM${vidgen2RoomId}_KEY_`;
  const availableKeys = [1, 2, 3].map(i => `${roomKeyPrefix}${i}`).filter(k => process.env[k]);
  
  if (availableKeys.length === 0) {
    // Fallback to global Poyo.ai key
    if (process.env.POYO_API_KEY) {
      return { 
        apiKey: process.env.POYO_API_KEY, 
        keyName: 'POYO_API_KEY',
        roomId: vidgen2RoomId,
        userId: keyInfo.user_id,
        keyInfoId: keyInfo.id
      };
    }
    return { error: 'Tidak ada API key Vidgen2 yang tersedia. Hubungi admin.' };
  }
  
  // Random key rotation
  const randomKeyName = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  return { 
    apiKey: process.env[randomKeyName], 
    keyName: randomKeyName,
    roomId: vidgen2RoomId,
    userId: keyInfo.user_id,
    keyInfoId: keyInfo.id
  };
}

// Join Vidgen2 Room
app.post('/api/vidgen2/join-room', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    const { roomId } = req.body;
    const targetRoom = roomId || 1;
    
    // Check room availability
    const roomResult = await pool.query(
      'SELECT * FROM vidgen2_rooms WHERE id = $1',
      [targetRoom]
    );
    
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room tidak ditemukan' });
    }
    
    const room = roomResult.rows[0];
    if (room.status !== 'OPEN' || room.active_users >= room.max_users) {
      return res.status(400).json({ error: 'Room penuh atau tutup' });
    }
    
    // Update user subscription with vidgen2_room_id
    await pool.query(`
      UPDATE subscriptions SET vidgen2_room_id = $1
      WHERE user_id = $2 AND status = 'active'
    `, [targetRoom, req.session.userId]);
    
    // Update room active users
    await pool.query(
      'UPDATE vidgen2_rooms SET active_users = active_users + 1 WHERE id = $1',
      [targetRoom]
    );
    
    res.json({ success: true, roomId: targetRoom, roomName: room.name });
  } catch (error) {
    console.error('[VIDGEN2] Join room error:', error);
    res.status(500).json({ error: 'Gagal join room' });
  }
});

// Get available Vidgen2 rooms
app.get('/api/vidgen2/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, max_users, active_users, status 
      FROM vidgen2_rooms 
      ORDER BY id
    `);
    res.json({ rooms: result.rows });
  } catch (error) {
    console.error('[VIDGEN2] Get rooms error:', error);
    res.status(500).json({ error: 'Gagal load rooms' });
  }
});

// Generate video with Vidgen2 (GeminiGen.ai)
app.post('/api/vidgen2/generate', async (req, res) => {
  try {
    console.log('[VIDGEN2] Generate request received');
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      console.log('[VIDGEN2] No API key provided');
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    console.log('[VIDGEN2] Getting room API key...');
    const roomKeyResult = await getVidgen2RoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      console.log('[VIDGEN2] Room key error:', roomKeyResult.error);
      return res.status(400).json({ error: roomKeyResult.error });
    }
    console.log('[VIDGEN2] Got room API key:', roomKeyResult.keyName);
    
    const { model, prompt, image, aspectRatio, duration } = req.body;
    
    if (!prompt && !image) {
      return res.status(400).json({ error: 'Prompt atau image diperlukan' });
    }
    
    // If image is base64, upload to Poyo.ai storage first
    let imageUrl = image;
    if (image && image.startsWith('data:')) {
      console.log('[VIDGEN2] Uploading base64 image to Poyo.ai storage...');
      try {
        const uploadResponse = await axios.post(
          'https://api.poyo.ai/api/common/upload/base64',
          {
            base64_data: image,
            upload_path: 'xclip-vidgen2'
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${roomKeyResult.apiKey}`
            },
            timeout: 60000
          }
        );
        
        if (uploadResponse.data?.data?.file_url) {
          imageUrl = uploadResponse.data.data.file_url;
          console.log(`[VIDGEN2] Image uploaded successfully: ${imageUrl}`);
        } else {
          console.log('[VIDGEN2] Upload response:', JSON.stringify(uploadResponse.data));
          throw new Error('Failed to get image URL from upload response');
        }
      } catch (uploadError) {
        console.error('[VIDGEN2] Image upload error:', uploadError.response?.data || uploadError.message);
        return res.status(500).json({ error: 'Gagal upload image ke Poyo.ai: ' + (uploadError.response?.data?.msg || uploadError.message) });
      }
    }
    
    // Model mapping for Poyo.ai
    // Models: sora-2, sora-2-pro, veo3.1, veo3.1-fast
    // Endpoint: https://api.poyo.ai/api/generate/submit
    const modelConfig = {
      'sora-2-10s': { apiModel: 'sora-2', duration: 10 },
      'sora-2-15s': { apiModel: 'sora-2', duration: 15 },
      'veo-3.1-fast': { apiModel: 'veo3.1-fast', duration: 8 }
    };
    const config = modelConfig[model] || modelConfig['sora-2-10s'];
    const poyoModel = config.apiModel;
    const apiEndpoint = 'https://api.poyo.ai/api/generate/submit';
    
    // Duration based on model selection
    const videoDuration = config.duration;
    
    // Aspect ratio: 16:9 or 9:16
    const poyoAspectRatio = aspectRatio || '16:9';
    
    console.log(`[VIDGEN2] Generating with Poyo.ai model: ${poyoModel}, duration: ${videoDuration}s, aspect: ${poyoAspectRatio}`);
    
    // Prepare request to Poyo.ai
    // VEO 3.1 image-to-video: image_urls inside input, generation_type: 'reference'
    // Sora 2: also supports image-to-video via image_urls
    const requestBody = {
      model: poyoModel,
      input: {
        prompt: prompt || 'Generate a cinematic video with smooth motion',
        duration: videoDuration,
        aspect_ratio: poyoAspectRatio
      }
    };
    
    // Add image for image-to-video generation
    if (imageUrl) {
      // Both Sora 2 and Veo 3.1 use image_urls inside input object
      requestBody.input.image_urls = [imageUrl];
      requestBody.input.generation_type = 'reference';
      console.log(`[VIDGEN2] Image-to-video mode enabled with image URL: ${imageUrl}`);
    }
    
    console.log(`[VIDGEN2] Request body:`, JSON.stringify(requestBody));
    
    // Setup request config with optional Webshare proxy
    const requestConfig = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${roomKeyResult.apiKey}`
      },
      timeout: 60000
    };
    
    // Add Webshare proxy if available
    if (process.env.WEBSHARE_API_KEY) {
      await fetchWebshareProxies();
      const proxy = getNextWebshareProxy();
      if (proxy) {
        const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.proxy_address}:${proxy.port}`;
        console.log(`[VIDGEN2] Using Webshare proxy: ${proxy.proxy_address}:${proxy.port}`);
        requestConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
        requestConfig.proxy = false;
      }
    }
    
    // Retry logic for rate limiting
    let response;
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
      try {
        response = await axios.post(apiEndpoint, requestBody, requestConfig);
        break; // Success, exit loop
      } catch (retryError) {
        const isRateLimit = retryError.response?.status === 429 || 
                            retryError.response?.data?.message?.includes('Too many requests');
        
        if (isRateLimit && retries < maxRetries - 1) {
          retries++;
          const waitTime = Math.pow(2, retries) * 10000; // 20s, 40s, 80s
          console.log(`[VIDGEN2] Rate limited, waiting ${waitTime/1000}s before retry ${retries}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          // Rotate to different proxy for retry
          if (process.env.WEBSHARE_API_KEY) {
            const newProxy = getNextWebshareProxy();
            if (newProxy) {
              const proxyUrl = `http://${newProxy.username}:${newProxy.password}@${newProxy.proxy_address}:${newProxy.port}`;
              requestConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
              console.log(`[VIDGEN2] Rotated to proxy: ${newProxy.proxy_address}:${newProxy.port}`);
            }
          }
        } else {
          throw retryError; // Not rate limit or max retries reached
        }
      }
    }
    
    console.log(`[VIDGEN2] Poyo.ai response:`, JSON.stringify(response.data));
    
    // Handle various response formats from Poyo.ai
    const taskId = response.data?.data?.task_id || 
                   response.data?.task_id || 
                   response.data?.data?.id || 
                   response.data?.id ||
                   response.data?.data?.uuid ||
                   response.data?.uuid;
    
    // Save task to database
    await pool.query(`
      INSERT INTO vidgen2_tasks (xclip_api_key_id, user_id, room_id, task_id, model, prompt, used_key_name, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
    `, [roomKeyResult.keyInfoId, roomKeyResult.userId, roomKeyResult.roomId, taskId, model, prompt, roomKeyResult.keyName]);
    
    // Update request count
    await pool.query(
      'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [roomKeyResult.keyInfoId]
    );
    
    console.log(`[VIDGEN2] Task created: ${taskId}`);
    
    res.json({
      success: true,
      taskId: taskId,
      model: model,
      message: 'Video generation dimulai'
    });
    
  } catch (error) {
    console.error('[VIDGEN2] Generate error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: error.response?.data?.message || 'Gagal generate video' 
    });
  }
});

// Check Vidgen2 task status
app.get('/api/vidgen2/tasks/:taskId', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    const { taskId } = req.params;
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    // Check local database first
    const localTask = await pool.query(
      'SELECT * FROM vidgen2_tasks WHERE task_id = $1 AND xclip_api_key_id = $2',
      [taskId, keyInfo.id]
    );
    
    if (localTask.rows.length === 0) {
      return res.status(404).json({ error: 'Task tidak ditemukan' });
    }
    
    const task = localTask.rows[0];
    
    if (task.status === 'completed') {
      return res.json({
        status: 'completed',
        videoUrl: task.video_url,
        model: task.model
      });
    }
    
    if (task.status === 'failed') {
      return res.json({
        status: 'failed',
        error: task.error_message || 'Video generation failed'
      });
    }
    
    // Poll Poyo.ai for status
    // Docs: https://docs.poyo.ai/api-manual/overview
    const roomKeyResult = await getVidgen2RoomApiKey(xclipApiKey);
    if (!roomKeyResult.error) {
      try {
        console.log(`[VIDGEN2] Polling status for task: ${taskId}`);
        
        // Setup request config with optional Webshare proxy
        const statusConfig = {
          headers: {
            'Authorization': `Bearer ${roomKeyResult.apiKey}`
          },
          timeout: 30000
        };
        
        // Add Webshare proxy if available
        if (process.env.WEBSHARE_API_KEY) {
          await fetchWebshareProxies();
          const proxy = getNextWebshareProxy();
          if (proxy) {
            const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.proxy_address}:${proxy.port}`;
            statusConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
            statusConfig.proxy = false;
          }
        }
        
        const statusResponse = await axios.get(
          `https://api.poyo.ai/api/generate/status/${taskId}`,
          statusConfig
        );
        
        console.log(`[VIDGEN2] Status response:`, JSON.stringify(statusResponse.data));
        
        const data = statusResponse.data.data || statusResponse.data;
        // Poyo.ai can return status in different fields: status, state, to_status
        const status = data.status || data.state || data.to_status;
        
        console.log(`[VIDGEN2] Parsed status: ${status}, stage: ${data.stage}, data keys:`, Object.keys(data));
        
        // Status: not_started, running, finished, failed, completed, success
        if (status === 'finished' || status === 'completed' || status === 'success') {
          // Get video URL from various possible fields
          let videoUrl = null;
          if (data.files && data.files.length > 0) {
            videoUrl = data.files[0].file_url || data.files[0].url || data.files[0].video_url;
          } else if (data.output?.video_url) {
            videoUrl = data.output.video_url;
          } else if (data.video_url) {
            videoUrl = data.video_url;
          } else if (data.result?.video_url) {
            videoUrl = data.result.video_url;
          } else if (data.media_url) {
            videoUrl = data.media_url;
          }
          
          console.log(`[VIDGEN2] Video URL found: ${videoUrl}`);
          
          // Update local database
          await pool.query(
            'UPDATE vidgen2_tasks SET status = $1, video_url = $2, completed_at = NOW() WHERE task_id = $3',
            ['completed', videoUrl, taskId]
          );
          
          return res.json({
            status: 'completed',
            videoUrl: videoUrl,
            model: task.model
          });
        }
        
        if (status === 'failed' || status === 'error') {
          const errorMsg = data.error_message || data.error || data.message || 'Generation failed';
          console.log(`[VIDGEN2] Task failed: ${errorMsg}`);
          
          await pool.query(
            'UPDATE vidgen2_tasks SET status = $1, error_message = $2, completed_at = NOW() WHERE task_id = $3',
            ['failed', errorMsg, taskId]
          );
          
          return res.json({
            status: 'failed',
            error: errorMsg
          });
        }
        
        // Status: not_started, running, pending, processing
        const progress = data.progress || data.percent || 0;
        return res.json({
          status: 'processing',
          progress: progress,
          message: status === 'running' ? 'Video sedang diproses...' : 'Menunggu antrian...'
        });
        
      } catch (pollError) {
        console.error('[VIDGEN2] Poll error:', pollError.response?.data || pollError.message);
      }
    }
    
    res.json({
      status: 'pending',
      message: 'Video sedang diproses...'
    });
    
  } catch (error) {
    console.error('[VIDGEN2] Status check error:', error);
    res.status(500).json({ error: 'Gagal check status' });
  }
});

// Webhook for Vidgen2 (GeminiGen.ai) callbacks
app.post('/api/vidgen2/webhook', async (req, res) => {
  try {
    const { event_name, event_uuid, data } = req.body;
    
    console.log('[VIDGEN2 WEBHOOK] Received:', event_name, data?.uuid);
    
    if (event_name === 'VIDEO_GENERATION_COMPLETED' && data) {
      // Update task in database
      await pool.query(`
        UPDATE vidgen2_tasks 
        SET status = 'completed', video_url = $1, completed_at = NOW()
        WHERE task_id = $2
      `, [data.media_url || data.video_url, data.uuid]);
      
      // Get user_id for SSE notification
      const taskResult = await pool.query(
        'SELECT user_id FROM vidgen2_tasks WHERE task_id = $1',
        [data.uuid]
      );
      
      if (taskResult.rows.length > 0) {
        const userId = taskResult.rows[0].user_id;
        const userConnections = sseConnections.get(userId);
        if (userConnections) {
          userConnections.forEach(res => {
            res.write(`data: ${JSON.stringify({
              type: 'vidgen2_complete',
              taskId: data.uuid,
              videoUrl: data.media_url || data.video_url
            })}\n\n`);
          });
        }
      }
    }
    
    if (event_name === 'VIDEO_GENERATION_FAILED' && data) {
      await pool.query(`
        UPDATE vidgen2_tasks 
        SET status = 'failed', error_message = $1, completed_at = NOW()
        WHERE task_id = $2
      `, [data.error_message || 'Generation failed', data.uuid]);
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('[VIDGEN2 WEBHOOK] Error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Get Vidgen2 history
app.get('/api/vidgen2/history', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ videos: [], processing: [] });
  }
  
  try {
    // Get completed videos
    const completedResult = await pool.query(`
      SELECT * FROM vidgen2_tasks 
      WHERE user_id = $1 AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.session.userId]);
    
    // Get processing videos (within last 30 minutes to avoid stale entries)
    const processingResult = await pool.query(`
      SELECT * FROM vidgen2_tasks 
      WHERE user_id = $1 AND status = 'processing' 
      AND created_at > NOW() - INTERVAL '30 minutes'
      ORDER BY created_at DESC
    `, [req.session.userId]);
    
    res.json({ 
      videos: completedResult.rows,
      processing: processingResult.rows
    });
  } catch (error) {
    console.error('[VIDGEN2] Get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// Catch-all route - must be last
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

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
    
    // Create vidgen2_rooms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vidgen2_rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        max_users INTEGER DEFAULT 10,
        active_users INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'OPEN',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        key_name_1 VARCHAR(100),
        key_name_2 VARCHAR(100),
        key_name_3 VARCHAR(100)
      )
    `);
    
    // Create vidgen2_tasks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vidgen2_tasks (
        id SERIAL PRIMARY KEY,
        xclip_api_key_id INTEGER,
        user_id INTEGER,
        room_id INTEGER,
        task_id VARCHAR(255) UNIQUE,
        model VARCHAR(100),
        prompt TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        video_url TEXT,
        error_message TEXT,
        key_index INTEGER,
        used_key_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    
    // Add vidgen2_room_id to subscriptions
    await pool.query(`
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS vidgen2_room_id INTEGER
    `).catch(() => {});
    
    // Seed vidgen2 rooms if empty
    const existingVidgen2Rooms = await pool.query('SELECT COUNT(*) FROM vidgen2_rooms');
    if (parseInt(existingVidgen2Rooms.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO vidgen2_rooms (name, max_users, status, key_name_1, key_name_2, key_name_3) VALUES
          ('Vidgen2 Room 1', 10, 'OPEN', 'VIDGEN2_ROOM1_KEY_1', 'VIDGEN2_ROOM1_KEY_2', 'VIDGEN2_ROOM1_KEY_3'),
          ('Vidgen2 Room 2', 10, 'OPEN', 'VIDGEN2_ROOM2_KEY_1', 'VIDGEN2_ROOM2_KEY_2', 'VIDGEN2_ROOM2_KEY_3'),
          ('Vidgen2 Room 3', 10, 'OPEN', 'VIDGEN2_ROOM3_KEY_1', 'VIDGEN2_ROOM3_KEY_2', 'VIDGEN2_ROOM3_KEY_3')
      `);
      console.log('Vidgen2 rooms seeded');
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
