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
const { SocksProxyAgent } = require('socks-proxy-agent');
const { google } = require('googleapis');
const https = require('https');
require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception (non-fatal):', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection (non-fatal):', reason);
});

function sanitizeApiKey(key) {
  return key.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '').trim();
}

const FREEPIK_HEADERS_BASE = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

function freepikHeaders(apiKey) {
  return { ...FREEPIK_HEADERS_BASE, 'x-freepik-api-key': sanitizeApiKey(apiKey) };
}

function getMotionRoomKeys(roomId) {
  const keys = [];
  const bulkVar = process.env[`MOTION_ROOM${roomId}_KEYS`];
  if (bulkVar) {
    bulkVar.split(',').forEach((k, i) => {
      const trimmed = sanitizeApiKey(k);
      if (trimmed) keys.push({ key: trimmed, name: `MOTION_ROOM${roomId}_KEYS[${i}]`, roomId });
    });
  }
  for (let i = 1; i <= 100; i++) {
    const envName = `MOTION_ROOM${roomId}_KEY_${i}`;
    if (process.env[envName]) {
      const val = sanitizeApiKey(process.env[envName]);
      if (val && !keys.some(k => k.key === val)) {
        keys.push({ key: val, name: envName, roomId });
      }
    }
  }
  return keys;
}

function getAllMotionRoomKeys(maxRooms = 5) {
  const keys = [];
  for (let r = 1; r <= maxRooms; r++) {
    keys.push(...getMotionRoomKeys(r));
  }
  return keys;
}

const motionKeyRateLimited = new Map();
const motionKeyExpired = new Set();
const motionKeyFailures = new Map();
const MOTION_KEY_MAX_CONSECUTIVE_FAILURES = 10;

const motionKeyStats = new Map();

function recordMotionKeyStat(keyName, success) {
  if (!keyName) return;
  let stats = motionKeyStats.get(keyName);
  if (!stats) {
    stats = { success: 0, fail: 0, total: 0 };
    motionKeyStats.set(keyName, stats);
  }
  stats.total++;
  if (success) {
    stats.success++;
  } else {
    stats.fail++;
  }
}

function getMotionKeySuccessRate(keyName) {
  const stats = motionKeyStats.get(keyName);
  if (!stats || stats.total < 2) return 0.5;
  return stats.success / stats.total;
}

function markMotionKeyRateLimited(keyName) {
  motionKeyRateLimited.set(keyName, Date.now());
  console.log(`[MOTION-RATE] Key ${keyName} kena rate limit (429), ditandai dan skip ke key berikutnya`);
}

function markMotionKeyExpired(keyName) {
  motionKeyExpired.add(keyName);
  console.log(`[MOTION-EXPIRED] Key ${keyName} free trial habis, diblacklist permanen (tidak akan dipakai lagi)`);
}

function recordMotionKeyResult(keyName, success) {
  if (!keyName) return;
  if (success) {
    motionKeyFailures.delete(keyName);
    return;
  }
  const current = motionKeyFailures.get(keyName) || 0;
  const newCount = current + 1;
  motionKeyFailures.set(keyName, newCount);
  console.log(`[MOTION-FAIL] Key ${keyName} consecutive failures: ${newCount}/${MOTION_KEY_MAX_CONSECUTIVE_FAILURES}`);
  if (newCount >= MOTION_KEY_MAX_CONSECUTIVE_FAILURES) {
    motionKeyRateLimited.set(keyName, Date.now());
    console.log(`[MOTION-FAIL] Key ${keyName} disabled (${newCount} consecutive failures), cooldown 10 menit`);
  }
}

function isFreepikTrialExpired(errorMsg) {
  if (!errorMsg) return false;
  const msg = errorMsg.toLowerCase();
  return msg.includes('free trial') || msg.includes('limit of the free') || msg.includes('upgrade to a paid plan');
}

function isMotionKeyRateLimited(keyName) {
  if (motionKeyExpired.has(keyName)) return true;
  const limitedAt = motionKeyRateLimited.get(keyName);
  if (!limitedAt) return false;
  const failures = motionKeyFailures.get(keyName) || 0;
  const cooldown = failures >= MOTION_KEY_MAX_CONSECUTIVE_FAILURES ? 10 * 60 * 1000 : 5 * 60 * 1000;
  if (Date.now() - limitedAt > cooldown) {
    motionKeyRateLimited.delete(keyName);
    console.log(`[MOTION-RATE] Key ${keyName} cooldown selesai, tersedia kembali`);
    return false;
  }
  return true;
}

const motionKeyActiveTasks = new Map();

function markMotionKeyBusy(keyName) {
  const count = motionKeyActiveTasks.get(keyName) || 0;
  motionKeyActiveTasks.set(keyName, count + 1);
}

function markMotionKeyFree(keyName) {
  const count = motionKeyActiveTasks.get(keyName) || 0;
  if (count <= 1) {
    motionKeyActiveTasks.delete(keyName);
  } else {
    motionKeyActiveTasks.set(keyName, count - 1);
  }
}

function getMotionKeyActiveCount(keyName) {
  return motionKeyActiveTasks.get(keyName) || 0;
}

function getAvailableMotionKeys(keys) {
  const nonExpired = keys.filter(k => !motionKeyExpired.has(k.name));
  if (nonExpired.length === 0 && keys.length > 0) {
    console.log(`[MOTION-EXPIRED] Semua key sudah expired (free trial habis). Tidak ada key yang tersedia.`);
    return [];
  }
  const available = nonExpired.filter(k => !isMotionKeyRateLimited(k.name));
  if (available.length === 0 && nonExpired.length > 0) {
    console.log(`[MOTION-RATE] Semua key aktif sedang rate limited, mencoba key dengan cooldown terlama...`);
    let oldest = nonExpired[0];
    let oldestTime = motionKeyRateLimited.get(oldest.name) || Date.now();
    for (const k of nonExpired) {
      const t = motionKeyRateLimited.get(k.name) || Date.now();
      if (t < oldestTime) {
        oldest = k;
        oldestTime = t;
      }
    }
    motionKeyRateLimited.delete(oldest.name);
    return [oldest, ...nonExpired.filter(k => k.name !== oldest.name)];
  }
  available.sort((a, b) => getMotionKeyActiveCount(a.name) - getMotionKeyActiveCount(b.name));
  const idleKeys = available.filter(k => getMotionKeyActiveCount(k.name) === 0);
  const busyKeys = available.filter(k => getMotionKeyActiveCount(k.name) > 0);
  if (busyKeys.length > 0) {
    console.log(`[MOTION-CONCURRENCY] ${idleKeys.length} idle keys, ${busyKeys.length} busy keys: ${busyKeys.map(k => `${k.name}(${getMotionKeyActiveCount(k.name)})`).join(', ')}`);
  }
  return available;
}

const app = express();
const PORT = process.env.PORT || 5000;

console.log(`[STARTUP] Xclip server starting... PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV || 'development'}`);
console.log(`[STARTUP] Database URL configured: ${!!(process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL)}`);

const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: dbUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: dbUrl && (dbUrl.includes('railway') || dbUrl.includes('neon') || dbUrl.includes('supabase') || dbUrl.includes('render')) ? { rejectUnauthorized: false } : false
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', uptime: process.uptime(), db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', uptime: process.uptime(), db: 'disconnected' });
  }
});

pool.on('error', (err) => {
  console.error('Database pool error (non-fatal):', err.message);
});

app.set('trust proxy', 1);

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

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.ip || 'unknown';
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ============ PERFORMANCE MONITORING ============
app.use((req, res, next) => {
  const start = Date.now();
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

let sessionStore;
try {
  sessionStore = new pgSession({
    pool: pool,
    tableName: 'sessions',
    createTableIfMissing: true,
    errorLog: (err) => {
      console.error('Session store error (non-fatal):', err.message);
    }
  });
  console.log('[STARTUP] Session store initialized');
} catch (e) {
  console.error('[STARTUP] Session store init error:', e.message);
  sessionStore = new pgSession({
    pool: pool,
    tableName: 'sessions',
    createTableIfMissing: true,
    errorLog: () => {}
  });
}

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'xclip-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
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
    
    // Clean inactive users from Video Gen rooms
    const inactiveVideoGen = await pool.query(`
      UPDATE subscriptions 
      SET room_id = NULL 
      WHERE room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, room_id
    `, [cutoffTime]);
    
    // Clean inactive users from Vidgen3 rooms
    const inactiveVidgen3 = await pool.query(`
      UPDATE subscriptions 
      SET vidgen3_room_id = NULL 
      WHERE vidgen3_room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, vidgen3_room_id
    `, [cutoffTime]);
    
    // Clean inactive users from X Image rooms
    const inactiveXimage = await pool.query(`
      UPDATE subscriptions 
      SET ximage_room_id = NULL 
      WHERE ximage_room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, ximage_room_id
    `, [cutoffTime]);
    
    // Clean inactive users from Vidgen2 rooms
    const inactiveVidgen2 = await pool.query(`
      UPDATE subscriptions 
      SET vidgen2_room_id = NULL 
      WHERE vidgen2_room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, vidgen2_room_id
    `, [cutoffTime]);
    
    // Clean inactive users from Vidgen4 rooms
    const inactiveVidgen4 = await pool.query(`
      UPDATE subscriptions 
      SET vidgen4_room_id = NULL 
      WHERE vidgen4_room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, vidgen4_room_id
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
    
    // Update active_users in vidgen3_rooms table
    await pool.query(`
      UPDATE vidgen3_rooms r SET active_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE s.vidgen3_room_id = r.id
        AND s.status = 'active' 
        AND s.expired_at > NOW()
      )
    `).catch(() => {});
    
    // Update active_users in vidgen2_rooms table
    await pool.query(`
      UPDATE vidgen2_rooms r SET active_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE s.vidgen2_room_id = r.id
        AND s.status = 'active' 
        AND s.expired_at > NOW()
      )
    `).catch(() => {});
    
    // Update active_users in vidgen4_rooms table
    await pool.query(`
      UPDATE vidgen4_rooms r SET active_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE s.vidgen4_room_id = r.id
        AND s.status = 'active' 
        AND s.expired_at > NOW()
      )
    `).catch(() => {});
    
    // Clean inactive users from X Image2 rooms
    await pool.query(`
      UPDATE subscriptions 
      SET ximage2_room_id = NULL 
      WHERE ximage2_room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, ximage2_room_id
    `, [cutoffTime]).catch(() => {});
    
    // Clean inactive users from X Image3 rooms
    await pool.query(`
      UPDATE subscriptions 
      SET ximage3_room_id = NULL 
      WHERE ximage3_room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, ximage3_room_id
    `, [cutoffTime]).catch(() => {});
    
    // Update current_users in ximage_rooms table
    await pool.query(`
      UPDATE ximage_rooms r SET current_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE s.ximage_room_id = r.id
        AND s.status = 'active' 
        AND (s.expired_at IS NULL OR s.expired_at > NOW())
      )
    `);
    
    // Update current_users in ximage2_rooms table
    await pool.query(`
      UPDATE ximage2_rooms r SET current_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE s.ximage2_room_id = r.id
        AND s.status = 'active' 
        AND (s.expired_at IS NULL OR s.expired_at > NOW())
      )
    `).catch(() => {});
    
    // Update current_users in ximage3_rooms table
    await pool.query(`
      UPDATE ximage3_rooms r SET current_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE s.ximage3_room_id = r.id
        AND s.status = 'active' 
        AND (s.expired_at IS NULL OR s.expired_at > NOW())
      )
    `).catch(() => {});
    
    const totalCleaned = inactiveVideoGen.rowCount + inactiveVidgen2.rowCount + inactiveVidgen3.rowCount + inactiveXimage.rowCount + inactiveVidgen4.rowCount;
    if (totalCleaned > 0) {
      console.log(`Cleaned up inactive users: VideoGen=${inactiveVideoGen.rowCount}, Vidgen2=${inactiveVidgen2.rowCount}, Vidgen3=${inactiveVidgen3.rowCount}, Vidgen4=${inactiveVidgen4.rowCount}, XImage=${inactiveXimage.rowCount}`);
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
    res.set('X-Content-Type-Options', 'nosniff');
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

function cleanErrorForUser(errorMessage) {
  if (!errorMessage) return 'Konten tidak dapat diproses oleh AI. Coba gunakan gambar/video yang berbeda.';
  const cleaned = errorMessage.split(' | Debug:')[0].split(' | Webhook:')[0].trim();
  if (!cleaned || cleaned === 'Video generation failed' || cleaned.includes('"status":"FAILED"') || cleaned.includes('"generated":[]')) {
    return 'Konten tidak dapat diproses oleh AI. Coba gunakan gambar/video yang berbeda.';
  }
  return cleaned;
}

// ============ PROXY SUPPORT (Decodo only) ============
const taskProxyMap = new Map();

// VPS Proxy Pool
const VPS_PROXIES = [];
let vpsIndex = 0;
let vpsInitialized = false;
let vpsFailCount = 0;
let vpsBlockedUntil = 0;

function initVpsProxy() {
  if (vpsInitialized) return;
  vpsInitialized = true;

  // Format: VPS_PROXIES=IP:PORT:user:pass,IP2:PORT2:user2:pass2
  // Or no-auth: VPS_PROXIES=IP:PORT,IP2:PORT2
  const bulkVar = process.env.VPS_PROXIES;
  if (bulkVar) {
    bulkVar.split(',').map(e => e.trim()).filter(Boolean).forEach(entry => {
      const parts = entry.split(':');
      if (parts.length >= 2) {
        VPS_PROXIES.push({
          proxy_address: parts[0],
          port: parseInt(parts[1]),
          username: parts[2] || null,
          password: parts[3] || null,
          provider: 'vps',
          configured: true
        });
      }
    });
  }

  // Single VPS env vars
  const host = process.env.VPS_PROXY_HOST;
  const port = process.env.VPS_PROXY_PORT;
  if (host && port && !VPS_PROXIES.some(p => p.proxy_address === host)) {
    VPS_PROXIES.push({
      proxy_address: host,
      port: parseInt(port),
      username: process.env.VPS_PROXY_USER || null,
      password: process.env.VPS_PROXY_PASS || null,
      provider: 'vps',
      configured: true
    });
  }

  if (VPS_PROXIES.length > 0) {
    console.log(`[PROXY] Initialized ${VPS_PROXIES.length} VPS proxy/proxies (HIGHEST PRIORITY)`);
    VPS_PROXIES.forEach((p, i) => console.log(`  [VPS-${i+1}] ${p.proxy_address}:${p.port}`));
  }
}

function getNextVpsProxy() {
  const proxy = VPS_PROXIES[vpsIndex % VPS_PROXIES.length];
  vpsIndex++;
  return proxy;
}

function isVpsAvailable() {
  if (VPS_PROXIES.length === 0) return false;
  return true;
}

// ============ PER-PROXY RATE LIMITER ============
// Prevents proxy IPs from getting banned by external APIs
const proxyRateLimiter = {
  usage: new Map(), // key: "ip:port" -> { count, windowStart, lastUsed }
  MAX_PER_MINUTE: 12,   // max outbound requests per proxy per minute
  MIN_INTERVAL_MS: 2500 // minimum 2.5s between requests through same proxy
};

function canUseProxy(proxy) {
  if (!proxy) return true;
  const key = `${proxy.proxy_address}:${proxy.port}`;
  const now = Date.now();
  const rec = proxyRateLimiter.usage.get(key);
  if (!rec) return true;
  if (now - rec.lastUsed < proxyRateLimiter.MIN_INTERVAL_MS) return false;
  if (now - rec.windowStart < 60000 && rec.count >= proxyRateLimiter.MAX_PER_MINUTE) return false;
  return true;
}

function recordProxyUsage(proxy) {
  if (!proxy) return;
  const key = `${proxy.proxy_address}:${proxy.port}`;
  const now = Date.now();
  const rec = proxyRateLimiter.usage.get(key) || { count: 0, windowStart: now, lastUsed: 0 };
  if (now - rec.windowStart > 60000) { rec.count = 0; rec.windowStart = now; }
  rec.count++;
  rec.lastUsed = now;
  proxyRateLimiter.usage.set(key, rec);
}

// Wait up to maxWaitMs for a proxy slot to become available
async function waitForProxySlot(proxy, maxWaitMs = 8000) {
  if (!proxy) return;
  const start = Date.now();
  while (!canUseProxy(proxy)) {
    if (Date.now() - start > maxWaitMs) {
      console.log(`[PROXY] Rate limit wait exceeded for ${proxy.proxy_address}:${proxy.port}`);
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  recordProxyUsage(proxy);
}

// Cleanup old proxy usage records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of proxyRateLimiter.usage) {
    if (now - rec.lastUsed > 300000) proxyRateLimiter.usage.delete(key);
  }
}, 300000);

function isProxyConfigured() {
  initVpsProxy();
  return VPS_PROXIES.length > 0;
}

function getNextProxy() {
  initVpsProxy();
  if (VPS_PROXIES.length > 0) return getNextVpsProxy();
  return null;
}

async function assignProxyForTask(taskId) {
  if (!isProxyConfigured()) return null;
  const proxy = getNextProxy();
  if (proxy) {
    taskProxyMap.set(taskId, { proxy, assignedAt: Date.now() });
    console.log(`[PROXY] Assigned ${proxy.proxy_address}:${proxy.port} to task ${taskId}`);
  }
  return proxy;
}

function getProxyForTask(taskId) {
  const entry = taskProxyMap.get(taskId);
  return entry ? entry.proxy : null;
}

function releaseProxyForTask(taskId) {
  const entry = taskProxyMap.get(taskId);
  if (entry) {
    console.log(`[PROXY] Released ${entry.proxy.proxy_address}:${entry.proxy.port} from task ${taskId}`);
    taskProxyMap.delete(taskId);
  }
}

setInterval(() => {
  const maxAge = 30 * 60 * 1000;
  const now = Date.now();
  for (const [taskId, entry] of taskProxyMap) {
    if (now - entry.assignedAt > maxAge) {
      console.log(`[PROXY] Evicting stale proxy for task ${taskId} (age: ${Math.round((now - entry.assignedAt) / 60000)}min)`);
      taskProxyMap.delete(taskId);
    }
  }
}, 300000);

async function getOrAssignProxyForPendingTask() {
  if (!isProxyConfigured()) return { proxy: null, pendingId: null };
  const proxy = getNextProxy();
  if (!proxy) return { proxy: null, pendingId: null };
  const pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  taskProxyMap.set(pendingId, { proxy, assignedAt: Date.now() });
  console.log(`[PROXY] Pre-assigned ${proxy.proxy_address}:${proxy.port} as pending ${pendingId}`);
  return { proxy, pendingId };
}

function promoteProxyToTask(pendingId, taskId) {
  const entry = taskProxyMap.get(pendingId);
  if (entry) {
    taskProxyMap.delete(pendingId);
    taskProxyMap.set(taskId, entry);
    console.log(`[PROXY] Promoted pending ${pendingId} -> task ${taskId} (IP: ${entry.proxy.proxy_address}:${entry.proxy.port})`);
  }
}

function buildProxyUrl(proxy) {
  if (proxy.username && proxy.password) {
    return `http://${proxy.username}:${proxy.password}@${proxy.proxy_address}:${proxy.port}`;
  }
  return `http://${proxy.proxy_address}:${proxy.port}`;
}

function getProviderLabel(proxy) {
  if (proxy.provider === 'vps') return `Decodo (${proxy.proxy_address})`;
  return 'Decodo';
}

function applyProxyToConfig(config, proxy) {
  if (proxy) {
    const proxyUrl = buildProxyUrl(proxy);
    console.log(`[PROXY] Using ${getProviderLabel(proxy)}: ${proxy.proxy_address}:${proxy.port}`);
    config.httpsAgent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
    config.proxy = false;
  }
  return config;
}

function isFreepikBlocked(response) {
  if (!response) return false;
  const data = response.data;
  if (typeof data === 'string' && (data.includes('Access denied') || data.includes('<!DOCTYPE') || data.includes('edgesuite') || data.includes('AkamaiGHost'))) return true;
  if (response.status === 403 && typeof data === 'string') return true;
  return false;
}

async function makeFreepikRequest(method, url, apiKey, body = null, useProxy = true, taskId = null, preferredProvider = null) {
  const cleanKey = sanitizeApiKey(apiKey);
  function buildConfig() {
    const cfg = {
      method,
      url,
      headers: freepikHeaders(cleanKey),
      timeout: 120000
    };
    if (body) cfg.data = body;
    return cfg;
  }

  function isSocketError(err) {
    const msg = (err.message || '').toLowerCase();
    const bodyStr = typeof err.response?.data === 'string' ? err.response.data.toLowerCase() : JSON.stringify(err.response?.data || '').toLowerCase();
    return msg.includes('socket hang up') || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('etimedout') || msg.includes('timeout') || msg.includes('ssl') || msg.includes('bad record mac') || msg.includes('ssl3_read_bytes') || msg.includes('epipe') || msg.includes('write epipe') || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || err.code === 'EPIPE' || err.code === 'ERR_SSL_SSLV3_ALERT_BAD_RECORD_MAC' || msg.includes('bad gateway') || msg.includes('exit node') || bodyStr.includes('bad gateway') || bodyStr.includes('exit node') || bodyStr.includes('session has ended') || err.response?.status === 502;
  }

  function isProxyBandwidthError(err) {
    // Webshare / proxy bandwidth exhausted — treat as proxy error, switch to next proxy
    const msg = (err.message || '').toLowerCase();
    const bodyStr = JSON.stringify(err.response?.data || '').toLowerCase();
    return msg.includes('bandwidth limit') || bodyStr.includes('bandwidth limit') ||
           msg.includes('bandwidth exceeded') || bodyStr.includes('bandwidth exceeded') ||
           msg.includes('please upgrade') || bodyStr.includes('please upgrade') ||
           err.response?.status === 509 || err.response?.status === 407;
  }

  function isRateLimited(err) {
    return err.response && err.response.status === 429;
  }

  function isBlocked(err) {
    return err.isProxyBlocked || isFreepikBlocked(err.response);
  }

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const hasProxy = isProxyConfigured();

  if (!useProxy || !hasProxy) {
    const directConfig = buildConfig();
    try {
      const resp = await axios(directConfig);
      if (isFreepikBlocked(resp)) throw new Error('Freepik blocked direct request');
      return resp;
    } catch (err) {
      if (isRateLimited(err)) throw err;
      throw err;
    }
  }

  console.log(`[FREEPIK] ${method} ${url.split('/').slice(-2).join('/')} → proxy`);

  const MAX_PROXY_ATTEMPTS = 10;
  let proxyAttempt = 0;
  while (proxyAttempt < MAX_PROXY_ATTEMPTS) {
    let usedProxy = null;
    const proxyConfig = buildConfig();
    
    if (proxyAttempt === 0 && taskId) {
      let proxy = getProxyForTask(taskId);
      if (!proxy) proxy = await assignProxyForTask(taskId);
      if (proxy) {
        usedProxy = proxy;
        applyProxyToConfig(proxyConfig, proxy);
      }
    }
    if (!usedProxy) {
      const proxy = getNextProxy();
      if (proxy) {
        usedProxy = proxy;
        applyProxyToConfig(proxyConfig, proxy);
      }
    }

    if (!usedProxy) break;

    await waitForProxySlot(usedProxy);

    proxyAttempt++;
    console.log(`[PROXY] Attempt ${proxyAttempt} via Decodo: ${usedProxy.proxy_address}:${usedProxy.port}`);
    try {
      const resp = await axios(proxyConfig);
      if (isFreepikBlocked(resp)) throw { response: resp, isProxyBlocked: true };
      console.log(`[PROXY] Success via ${usedProxy.proxy_address}`);
      return resp;
    } catch (proxyErr) {
      const blocked = isBlocked(proxyErr);
      const socketErr = isSocketError(proxyErr);
      const rateLimited = isRateLimited(proxyErr);
      const bandwidthErr = isProxyBandwidthError(proxyErr);

      if (rateLimited) {
        console.log(`[PROXY] 429 rate limited on ${getProviderLabel(usedProxy)} — API key quota, skip proxy retry, try next key`);
        if (taskId) releaseProxyForTask(taskId);
        throw proxyErr;
      }

      const httpStatus = proxyErr.response?.status;
      const respData = proxyErr.response?.data;
      if (httpStatus === 403 && respData && typeof respData === 'object') {
        console.log(`[PROXY] 403 from Freepik API (JSON response) — key/permission issue, not IP blocked. Stop retry.`);
        if (taskId) releaseProxyForTask(taskId);
        throw proxyErr;
      }

      if (bandwidthErr) {
        // Bandwidth habis di proxy (Webshare) — mark blocked, ganti ke proxy berikutnya (VPS)
        console.log(`[PROXY] Bandwidth exhausted on ${getProviderLabel(usedProxy)}, switching to next proxy (VPS)...`);
        markProxyBlocked(usedProxy);
        if (taskId) releaseProxyForTask(taskId);
        continue;
      }

      if (blocked || socketErr) {
        console.log(`[PROXY] ${socketErr ? 'Socket error' : 'IP blocked'} on Decodo. Rotating IP... (attempt ${proxyAttempt}/${MAX_PROXY_ATTEMPTS})`);
        if (taskId) releaseProxyForTask(taskId);
        await sleep(1500);
        continue;
      }
      throw proxyErr;
    }
  }

  if (proxyAttempt >= MAX_PROXY_ATTEMPTS) {
    console.error(`[PROXY] Max attempts (${MAX_PROXY_ATTEMPTS}) reached for ${url.split('/').slice(-2).join('/')}`);
    throw new Error(`Proxy failed after ${MAX_PROXY_ATTEMPTS} attempts`);
  }

}

// ============ DROPLET PROXY SUPPORT ============
async function requestViaProxy(roomId, endpoint, method, body, apiKey, taskId = null) {
  try {
    const roomResult = await pool.query(
      'SELECT droplet_ip, droplet_port, proxy_secret, use_proxy, use_webshare FROM rooms WHERE id = $1',
      [roomId]
    );
    
    const room = roomResult.rows[0];
    const useDropletProxy = room && room.use_proxy && room.droplet_ip && room.proxy_secret;
    const useResidentialProxy = isProxyConfigured();
    
    const freepikUrl = `https://api.freepik.com/${endpoint}`;
    
    if (useResidentialProxy) {
      let proxy = null;
      if (taskId) {
        proxy = getProxyForTask(taskId);
        if (!proxy) {
          proxy = await assignProxyForTask(taskId);
        }
        if (proxy) {
          console.log(`[PROXY] Task ${taskId} using fixed IP via requestViaProxy: ${proxy.proxy_address}:${proxy.port}`);
        }
      } else {
        proxy = getNextProxy();
      }
      
      if (proxy) {
        // Per-proxy rate limit: wait for available slot
        await waitForProxySlot(proxy);
        console.log(`[PROXY] Using ${getProviderLabel(proxy)}: ${proxy.proxy_address}:${proxy.port}`);
        const proxyUrl = buildProxyUrl(proxy);
        const response = await axios({
          method,
          url: freepikUrl,
          headers: freepikHeaders(apiKey),
          data: body,
          timeout: 120000,
          httpsAgent: new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false }),
          proxy: false
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
          headers: freepikHeaders(apiKey),
          data: body
        },
        timeout: 120000
      });
      
      return response.data.data || response.data;
    }
    
    const response = await axios({
      method,
      url: freepikUrl,
      headers: freepikHeaders(apiKey),
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
    
    // Check if task is in vidgen3_tasks
    const vidgen3TaskCheck = await pool.query(
      'SELECT id, user_id, model FROM vidgen3_tasks WHERE task_id = $1',
      [taskId]
    );
    
    if (vidgen3TaskCheck.rows.length > 0) {
      const v3Task = vidgen3TaskCheck.rows[0];
      const status = ((req.body.data || req.body).status || req.body.status || '').toLowerCase();
      const data = req.body.data || req.body;
      
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
        releaseProxyForTask(taskId);
        await pool.query(
          'UPDATE vidgen3_tasks SET status = $1, video_url = $2, completed_at = NOW() WHERE task_id = $3',
          ['completed', videoUrl, taskId]
        );
        sendSSEToUser(v3Task.user_id, {
          type: 'vidgen3_completed',
          taskId: taskId,
          videoUrl: videoUrl,
          model: v3Task.model
        });
        console.log(`[VIDGEN3] Webhook: Video completed! Task ${taskId}`);
      } else if (isFailed) {
        releaseProxyForTask(taskId);
        const v3FailReason = data.error_message || data.error || data.message || data.detail || req.body.error_message || req.body.error || 'Generation failed';
        console.log(`[VIDGEN3] Webhook: Video failed! Task ${taskId} | Reason: ${v3FailReason} | Full payload: ${JSON.stringify(req.body)}`);
        await pool.query(
          'UPDATE vidgen3_tasks SET status = $1, error_message = $2, completed_at = NOW() WHERE task_id = $3',
          ['failed', v3FailReason, taskId]
        );
        sendSSEToUser(v3Task.user_id, {
          type: 'vidgen3_failed',
          taskId: taskId,
          error: v3FailReason
        });
      }
      
      return res.status(200).json({ received: true });
    }
    
    if (taskCheck.rows.length === 0) {
      console.log('Webhook rejected: Unknown task_id:', taskId);
      return res.status(200).json({ received: true, error: 'Unknown task' });
    }
    
    const webhookReceivedAt = new Date().toISOString();
    console.log(`[TIMING] Webhook received for task ${taskId} at ${webhookReceivedAt}`);
    
    const status = (data.status || req.body.status || '').toLowerCase();
    
    // Find the task in database (already verified above, now get full details)
    const taskResult = await pool.query(
      `SELECT t.*, t.retry_data, t.retry_count, k.user_id 
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
      releaseProxyForTask(taskId);
      await pool.query(
        'UPDATE video_generation_tasks SET status = $1, video_url = $2, completed_at = CURRENT_TIMESTAMP WHERE task_id = $3',
        ['completed', videoUrl, taskId]
      );
      
      const isMotionTask = task.model && task.model.startsWith('motion-');
      if (isMotionTask && task.used_key_name) {
        recordMotionKeyResult(task.used_key_name, true);
        recordMotionKeyStat(task.used_key_name, true);
      }
      const ssePayload = {
        type: isMotionTask ? 'motion_completed' : 'video_completed',
        taskId: taskId,
        videoUrl: videoUrl,
        model: task.model
      };
      if (isMotionTask && task.original_task_id) {
        ssePayload.originalTaskId = task.original_task_id;
      }
      const sent = sendSSEToUser(task.user_id, ssePayload);
      
      console.log(`Webhook: ${isMotionTask ? 'Motion' : 'Video'} completed! Task ${taskId}${task.original_task_id ? ' (original: ' + task.original_task_id + ')' : ''}, SSE sent: ${sent}`);
    } else if (isFailed) {
      releaseProxyForTask(taskId);
      const fullPayload = JSON.stringify(req.body);
      const failReason = data.error_message || data.error || data.message || data.detail || data.reason || data.fail_reason || req.body.error_message || req.body.error || '';
      const userFriendlyReason = failReason && failReason !== 'Video generation failed' ? failReason : 'Konten tidak dapat diproses oleh AI. Coba gunakan gambar/video yang berbeda.';
      const detailedReason = `${userFriendlyReason} | Debug: ${fullPayload.slice(0, 300)}`;
      const isMotionFail = task.model && task.model.startsWith('motion-');
      if (isMotionFail && task.used_key_name) {
        recordMotionKeyResult(task.used_key_name, false);
        recordMotionKeyStat(task.used_key_name, false);
      }
      console.log(`Webhook: Video failed! Task ${taskId} | Key: ${task.used_key_name || 'unknown'} | Reason: ${detailedReason}`);
      console.log(`Webhook: Full payload: ${fullPayload}`);
      
      if (isMotionFail) {
        if (task.used_key_name) markMotionKeyFree(task.used_key_name);
        
        let bgPollTask = serverBgPolls.get(taskId);
        let retryData = bgPollTask?.motionRetryData;
        let retryCount = retryData?.retryCount || 0;
        let maxRetries = retryData?.maxRetries || 2;
        
        if (!retryData) {
          const dbRetryData = task.retry_data;
          retryCount = task.retry_count || 0;
          
          if (dbRetryData && dbRetryData.requestBody) {
            retryData = {
              requestBody: dbRetryData.requestBody,
              endpoint: dbRetryData.endpoint,
              roomId: dbRetryData.roomId || task.room_id || 1,
              xclipKeyId: dbRetryData.xclipKeyId || task.xclip_api_key_id,
              retryCount: retryCount,
              maxRetries: maxRetries
            };
            console.log(`[WEBHOOK] Loaded retry_data from DB for task ${taskId} (retry ${retryCount}/${maxRetries})`);
          } else {
            console.log(`[WEBHOOK] No retry_data in DB for task ${taskId}, cannot retry`);
          }
        }
        
        if (retryData && retryCount < maxRetries) {
          console.log(`[WEBHOOK] Motion task ${taskId} failed (retry ${retryCount}/${maxRetries}), attempting auto-retry...`);
          if (bgPollTask) serverBgPolls.delete(taskId);
          
          const lastUsedKeyValue = task.used_key_name ? (() => {
            const allKeys = getMotionRoomKeys(task.room_id || 1);
            const found = allKeys.find(k => k.name === task.used_key_name);
            return found?.key || null;
          })() : null;
          
          const webhookRetryTask = bgPollTask || {
            model: task.model,
            userId: task.user_id,
            usedKeyName: task.used_key_name,
            apiKey: lastUsedKeyValue,
            motionRetryData: retryData
          };
          if (!webhookRetryTask.motionRetryData) webhookRetryTask.motionRetryData = retryData;
          
          const retried = await retryMotionTask(taskId, webhookRetryTask);
          if (retried) {
            console.log(`[WEBHOOK] Motion task ${taskId} auto-retry submitted successfully`);
            return res.status(200).json({ received: true, retried: true });
          }
          console.log(`[WEBHOOK] Motion task ${taskId} auto-retry failed, all keys exhausted`);
        } else if (!retryData) {
          console.log(`[WEBHOOK] Motion task ${taskId} failed, no retry data available`);
          if (bgPollTask) serverBgPolls.delete(taskId);
        } else {
          console.log(`[WEBHOOK] Motion task ${taskId} failed, max retries (${maxRetries}) already reached`);
          if (bgPollTask) serverBgPolls.delete(taskId);
        }
      }
      
      await pool.query(
        'UPDATE video_generation_tasks SET status = $1, error_message = $2, completed_at = CURRENT_TIMESTAMP WHERE task_id = $3',
        ['failed', detailedReason, taskId]
      );
      
      const isMotionFailed = task.model && task.model.startsWith('motion-');
      sendSSEToUser(task.user_id, {
        type: isMotionFailed ? 'motion_failed' : 'video_failed',
        taskId: taskId,
        error: userFriendlyReason
      });
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

const registerTracker = new Map();
const REGISTER_COOLDOWN = 86400000;
const REGISTER_MAX_PER_DAY = 1;
const registerDaily = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of registerTracker) {
    if (now - ts > REGISTER_COOLDOWN) registerTracker.delete(ip);
  }
  for (const [ip, data] of registerDaily) {
    if (now - data.start > 86400000) registerDaily.delete(ip);
  }
}, 120000);

app.post('/api/auth/register', async (req, res) => {
  try {
    const ip = getClientIP(req);
    const now = Date.now();

    const lastRegister = registerTracker.get(ip);
    if (lastRegister && now - lastRegister < REGISTER_COOLDOWN) {
      const waitSec = Math.ceil((REGISTER_COOLDOWN - (now - lastRegister)) / 1000);
      return res.status(429).json({ error: `Terlalu cepat. Tunggu ${waitSec} detik sebelum mendaftar lagi.` });
    }

    let dayData = registerDaily.get(ip);
    if (!dayData || now - dayData.start > 86400000) {
      dayData = { count: 0, start: now };
      registerDaily.set(ip, dayData);
    }
    if (dayData.count >= REGISTER_MAX_PER_DAY) {
      return res.status(429).json({ error: 'Batas pendaftaran tercapai. Hanya 1 akun per hari dari IP ini.' });
    }

    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, dan password diperlukan' });
    }

    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (trimmedUsername.length < 3 || trimmedUsername.length > 30) {
      return res.status(400).json({ error: 'Username harus 3-30 karakter' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      return res.status(400).json({ error: 'Username hanya boleh huruf, angka, dan underscore' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedEmail)) {
      return res.status(400).json({ error: 'Format email tidak valid' });
    }

    const disposableDomains = ['tempmail.com','throwaway.email','guerrillamail.com','mailinator.com','yopmail.com','sharklasers.com','guerrillamail.info','grr.la','tempail.com','dispostable.com','fakeinbox.com','trashmail.com','10minutemail.com','temp-mail.org','getnada.com','mohmal.com'];
    const emailDomain = trimmedEmail.split('@')[1];
    if (disposableDomains.includes(emailDomain)) {
      return res.status(400).json({ error: 'Email temporary/disposable tidak diperbolehkan' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }

    if (password.length > 128) {
      return res.status(400).json({ error: 'Password terlalu panjang' });
    }
    
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2',
      [trimmedEmail, trimmedUsername.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email atau username sudah terdaftar' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [trimmedUsername, trimmedEmail, passwordHash]
    );
    
    const user = result.rows[0];
    req.session.userId = user.id;

    registerTracker.set(ip, now);
    dayData.count++;

    console.log(`[REGISTER] New user: ${trimmedUsername} (${trimmedEmail}) from IP: ${ip}`);
    
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

async function uploadToYunwuImageHost(imageBuffer, apiKey, filename = 'image.png') {
  const FormData = require('form-data');
  try {
    const form = new FormData();
    const contentType = filename.endsWith('.jpg') || filename.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
    form.append('file', imageBuffer, { filename, contentType });
    const res = await axios.post('https://imageproxy.zhongzhuan.chat/api/upload', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 30000
    });
    if (res.data && typeof res.data === 'object') {
      const url = res.data.url || res.data.data?.url || res.data.image_url || res.data.link;
      if (url) {
        console.log(`[CDN] Yunwu image host upload success: ${url}`);
        return url;
      }
      console.log(`[CDN] Yunwu image host response:`, JSON.stringify(res.data).substring(0, 500));
      const jsonStr = JSON.stringify(res.data);
      const urlMatch = jsonStr.match(/https?:\/\/[^\s"',}]+\.(png|jpg|jpeg|gif|webp)/i);
      if (urlMatch) {
        console.log(`[CDN] Yunwu image host extracted URL: ${urlMatch[0]}`);
        return urlMatch[0];
      }
    } else if (typeof res.data === 'string' && res.data.startsWith('http')) {
      console.log(`[CDN] Yunwu image host upload success (string): ${res.data}`);
      return res.data.trim();
    }
    console.warn(`[CDN] Yunwu image host returned unexpected format:`, typeof res.data, JSON.stringify(res.data).substring(0, 200));
  } catch (e) {
    console.warn(`[CDN] Yunwu image host failed: ${e.response?.status || ''} ${e.message}`);
  }
  return null;
}

async function reuploadToCDN(imageUrl) {
  if (!imageUrl || imageUrl.includes('filesystem.site') || imageUrl.includes('catbox.moe') || imageUrl.includes('0x0.st') || imageUrl.includes('imgbb.com')) {
    return null;
  }
  
  console.log(`[CDN] Downloading image from: ${imageUrl}`);
  const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const buffer = Buffer.from(imgResponse.data);
  const contentType = imgResponse.headers['content-type'] || 'image/png';
  const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
  
  const FormData = require('form-data');
  
  try {
    const form1 = new FormData();
    form1.append('reqtype', 'fileupload');
    form1.append('fileToUpload', buffer, { filename: `image.${ext}`, contentType });
    const catboxRes = await axios.post('https://catbox.moe/user/api.php', form1, {
      headers: form1.getHeaders(),
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024
    });
    if (catboxRes.data && catboxRes.data.startsWith('http')) {
      console.log(`[CDN] Catbox upload success: ${catboxRes.data}`);
      return catboxRes.data.trim();
    }
  } catch (e1) {
    console.warn(`[CDN] Catbox failed: ${e1.message}`);
  }
  
  try {
    const form2 = new FormData();
    form2.append('file', buffer, { filename: `image.${ext}`, contentType });
    const zeroRes = await axios.post('https://0x0.st', form2, {
      headers: form2.getHeaders(),
      timeout: 60000
    });
    if (zeroRes.data && zeroRes.data.startsWith('http')) {
      console.log(`[CDN] 0x0.st upload success: ${zeroRes.data}`);
      return zeroRes.data.trim();
    }
  } catch (e2) {
    console.warn(`[CDN] 0x0.st failed: ${e2.message}`);
  }
  
  console.warn('[CDN] All CDN uploads failed, using original URL');
  return null;
}

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

// ============ RATE LIMITING: Random Jitter, Daily Quota, User Cooldown ============

const RATE_LIMIT_CONFIG = {
  videogen: {
    cooldownMs: 180 * 1000,
    dailyQuotaPerKey: 50,
    jitterMinMs: 1000,
    jitterMaxMs: 3000,
    label: 'Video Gen'
  },
  motion: {
    cooldownMs: 30 * 1000,
    dailyQuotaPerKey: 50,
    jitterMinMs: 500,
    jitterMaxMs: 1500,
    label: 'Motion'
  },
  vidgen2: {
    cooldownMs: 240 * 1000,
    dailyQuotaPerKey: 50,
    jitterMinMs: 1000,
    jitterMaxMs: 3000,
    label: 'Vidgen2'
  },
  vidgen4: {
    cooldownMs: 300 * 1000,
    dailyQuotaPerKey: 50,
    jitterMinMs: 1000,
    jitterMaxMs: 3000,
    label: 'Vidgen4'
  },
  ximage2: {
    cooldownMs: 300 * 1000,
    dailyQuotaPerKey: 50,
    jitterMinMs: 1000,
    jitterMaxMs: 3000,
    label: 'X Image2'
  },
  ximage3: { cooldownMs: 300 * 1000, dailyQuotaPerKey: 50, jitterMinMs: 1000, jitterMaxMs: 3000, label: 'X Image3' },
  voiceover: {
    cooldownMs: 120 * 1000,
    label: 'Voice Over'
  }
};

const userCooldowns = new Map();
const dailyKeyUsage = new Map();
let dailyQuotaResetDate = new Date().toDateString();

function resetDailyQuotaIfNeeded() {
  const today = new Date().toDateString();
  if (today !== dailyQuotaResetDate) {
    dailyKeyUsage.clear();
    dailyQuotaResetDate = today;
    console.log('[RATE-LIMIT] Daily quota reset for new day');
  }
}

function getDailyKeyUsage(keyName, feature) {
  resetDailyQuotaIfNeeded();
  const id = `${feature}:${keyName}`;
  return dailyKeyUsage.get(id) || 0;
}

function incrementDailyKeyUsage(keyName, feature) {
  resetDailyQuotaIfNeeded();
  const id = `${feature}:${keyName}`;
  const current = dailyKeyUsage.get(id) || 0;
  dailyKeyUsage.set(id, current + 1);
  return current + 1;
}

function isKeyOverDailyQuota(keyName, feature) {
  const config = RATE_LIMIT_CONFIG[feature];
  if (!config) return false;
  const usage = getDailyKeyUsage(keyName, feature);
  return usage >= config.dailyQuotaPerKey;
}

function getUserCooldownRemaining(userId, feature) {
  const id = `${feature}:${userId}`;
  const lastGenerate = userCooldowns.get(id);
  if (!lastGenerate) return 0;
  const config = RATE_LIMIT_CONFIG[feature];
  if (!config) return 0;
  const elapsed = Date.now() - lastGenerate;
  const remaining = config.cooldownMs - elapsed;
  return remaining > 0 ? remaining : 0;
}

function setUserCooldown(userId, feature) {
  const id = `${feature}:${userId}`;
  userCooldowns.set(id, Date.now());
}

async function applyRandomJitter(feature) {
  const config = RATE_LIMIT_CONFIG[feature];
  if (!config) return;
  const delay = config.jitterMinMs + Math.random() * (config.jitterMaxMs - config.jitterMinMs);
  console.log(`[RATE-LIMIT] ${config.label} jitter: ${Math.round(delay)}ms`);
  return new Promise(resolve => setTimeout(resolve, delay));
}

function filterKeysByDailyQuota(keys, feature) {
  return keys.filter(k => {
    const keyName = k.name || k;
    if (isKeyOverDailyQuota(keyName, feature)) {
      console.log(`[RATE-LIMIT] Key ${keyName} over daily quota for ${feature}, skipping`);
      return false;
    }
    return true;
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [id, timestamp] of userCooldowns) {
    if (now - timestamp > 300000) {
      userCooldowns.delete(id);
    }
  }
}, 60000);

// ============ END RATE LIMITING ============

// ============ SERVER-SIDE BACKGROUND POLLING ============
const serverBgPolls = new Map();

const motionRetryLocks = new Set();

async function retryMotionTask(oldTaskId, task) {
  if (motionRetryLocks.has(oldTaskId)) {
    console.log(`[MOTION-RETRY] Already retrying ${oldTaskId}, skipping duplicate`);
    return false;
  }
  motionRetryLocks.add(oldTaskId);
  
  try {
    const retryData = task.motionRetryData;
    if (!retryData || retryData.retryCount >= retryData.maxRetries) {
      console.log(`[MOTION-RETRY] No more retries for ${oldTaskId} (${retryData?.retryCount || 0}/${retryData?.maxRetries || 3})`);
      return false;
    }
    
    retryData.retryCount++;
    const lastUsedKey = task.apiKey;
    console.log(`[MOTION-RETRY] Retry ${retryData.retryCount}/${retryData.maxRetries} for failed task ${oldTaskId} (excluding last key)`);
    
    const retryBody = { ...retryData.requestBody };
    let retryEndpoint = retryData.endpoint;
    
    if (retryData.retryCount === 2) {
      retryBody.cfg_scale = 0.3;
      console.log(`[MOTION-RETRY] Retry #2: using cfg_scale=0.3 for more flexibility`);
    } else if (retryData.retryCount >= 3) {
      if (retryEndpoint.includes('-pro')) {
        retryEndpoint = retryEndpoint.replace('-pro', '-std');
        console.log(`[MOTION-RETRY] Retry #${retryData.retryCount}: switching to Standard mode`);
      }
      retryBody.cfg_scale = 0.2;
    }
    
    const allMotionKeys = getMotionRoomKeys(retryData.roomId);
    for (let r = 1; r <= 5; r++) {
      if (r === retryData.roomId) continue;
      allMotionKeys.push(...getMotionRoomKeys(r));
    }
    
    const quotaFiltered = filterKeysByDailyQuota(allMotionKeys, 'motion');
    let available = getAvailableMotionKeys(quotaFiltered);
    
    const differentKeys = available.filter(k => k.key !== lastUsedKey);
    if (differentKeys.length > 0) {
      available = differentKeys;
    }
    
    if (available.length === 0) {
      console.log(`[MOTION-RETRY] No available keys for retry`);
      return false;
    }
    
    available.sort((a, b) => {
      const rateA = getMotionKeySuccessRate(a.name);
      const rateB = getMotionKeySuccessRate(b.name);
      if (Math.abs(rateA - rateB) > 0.1) return rateB - rateA;
      return getMotionKeyActiveCount(a.name) - getMotionKeyActiveCount(b.name);
    });
    
    for (const currentKey of available) {
      try {
        console.log(`[MOTION-RETRY] Trying key ${currentKey.name} (active: ${getMotionKeyActiveCount(currentKey.name)}, success rate: ${(getMotionKeySuccessRate(currentKey.name) * 100).toFixed(0)}%)...`);
        markMotionKeyBusy(currentKey.name);
        const response = await makeFreepikRequest(
          'POST',
          `https://api.freepik.com${retryEndpoint}`,
          currentKey.key,
          retryBody,
          true,
          null,
          'decodo'
        );
        
        const newTaskId = response.data?.data?.task_id || response.data?.task_id || response.data?.data?.id || response.data?.id;
        if (!newTaskId) {
          markMotionKeyFree(currentKey.name);
          console.log(`[MOTION-RETRY] No task ID in response`);
          continue;
        }
        
        console.log(`[MOTION-RETRY] New task created: ${newTaskId} (replacing ${oldTaskId})`);
        
        const dbResult = await pool.query(
          `UPDATE video_generation_tasks SET task_id = $1, used_key_name = $2, status = 'pending', error_message = NULL, completed_at = NULL, retry_count = COALESCE(retry_count, 0) + 1, original_task_id = COALESCE(original_task_id, $3) WHERE task_id = $3 AND status IN ('pending', 'processing', 'failed')`,
          [newTaskId, currentKey.name, oldTaskId]
        );
        
        if (dbResult.rowCount === 0) {
          markMotionKeyFree(currentKey.name);
          console.log(`[MOTION-RETRY] DB update failed (task ${oldTaskId} already handled), skipping`);
          return false;
        }
        
        if (task.userId) {
          sendSSEToUser(task.userId, { 
            type: 'motion_retry', 
            oldTaskId, 
            newTaskId, 
            retryCount: retryData.retryCount,
            maxRetries: retryData.maxRetries
          });
        }
        
        const newRetryData = { ...retryData };
        startServerBgPoll(newTaskId, 'freepik-motion', currentKey.key, {
          dbTable: 'video_generation_tasks',
          urlColumn: 'video_url',
          model: task.model,
          userId: task.userId,
          usedKeyName: currentKey.name,
          motionRetryData: newRetryData
        });
        
        incrementDailyKeyUsage(currentKey.name, 'motion');
        return true;
        
      } catch (error) {
        markMotionKeyFree(currentKey.name);
        const status = error.response?.status;
        const errMsg = error.response?.data?.message || error.message || '';
        console.log(`[MOTION-RETRY] Key ${currentKey.name} failed (${status}): ${errMsg}`);
        
        if (isFreepikTrialExpired(errMsg)) {
          markMotionKeyExpired(currentKey.name);
        } else if (status === 429) {
          markMotionKeyRateLimited(currentKey.name);
        }
        continue;
      }
    }
    
    console.log(`[MOTION-RETRY] All keys failed for retry of ${oldTaskId}`);
    return false;
  } finally {
    motionRetryLocks.delete(oldTaskId);
  }
}

function startServerBgPoll(taskId, apiType, apiKey, extraData = {}) {
  if (serverBgPolls.has(taskId)) return;
  serverBgPolls.set(taskId, {
    taskId,
    apiType,
    apiKey,
    startTime: Date.now(),
    attempts: 0,
    maxAttempts: 360,
    ...extraData
  });
  console.log(`[BG-POLL] Started background polling for ${apiType} task: ${taskId}`);
}

async function pollPoyoTask(taskId, apiKey) {
  const statusResponse = await axios.get(
    `https://api.poyo.ai/api/generate/status/${taskId}`,
    { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 30000 }
  );
  const raw = statusResponse.data;
  const data = raw.data || raw;
  const status = data.status || data.state || data.to_status || raw.status;
  
  if (status === 'finished' || status === 'completed' || status === 'success') {
    let url = null;
    if (data.files && data.files.length > 0) {
      const f = data.files[0];
      url = typeof f === 'string' ? f : (f.url || f.file_url || f.video_url || f.image_url);
    } else if (data.images && data.images.length > 0) {
      url = typeof data.images[0] === 'string' ? data.images[0] : (data.images[0].url || data.images[0].image_url);
    } else if (raw.files && raw.files.length > 0) {
      const f = raw.files[0];
      url = typeof f === 'string' ? f : (f.url || f.file_url || f.image_url);
    } else if (raw.images && raw.images.length > 0) {
      url = typeof raw.images[0] === 'string' ? raw.images[0] : (raw.images[0].url || raw.images[0].image_url);
    } else if (data.output?.video_url) {
      url = data.output.video_url;
    } else if (data.video_url) {
      url = data.video_url;
    } else if (data.result?.video_url) {
      url = data.result.video_url;
    } else if (data.output?.images?.[0]) {
      const oi = data.output.images[0];
      url = typeof oi === 'string' ? oi : (oi.url || oi.image_url);
    } else if (data.output?.image_url) {
      url = data.output.image_url;
    } else if (data.output?.url) {
      url = data.output.url;
    } else if (data.result?.images?.[0]) {
      const ri = data.result.images[0];
      url = typeof ri === 'string' ? ri : (ri.url || ri.image_url);
    } else if (data.result?.image_url) {
      url = data.result.image_url;
    } else if (data.result?.url) {
      url = data.result.url;
    } else if (data.image_url) {
      url = data.image_url;
    } else if (data.media_url) {
      url = data.media_url;
    } else if (data.url) {
      url = data.url;
    }
    if (!url) {
      console.error(`[BG-POLL] Poyo task ${taskId} completed but no URL found. Raw keys:`, Object.keys(raw), 'data keys:', Object.keys(data), 'Full:', JSON.stringify(raw).substring(0, 500));
    }
    return { status: 'completed', url };
  }
  
  if (status === 'failed' || status === 'error') {
    return { status: 'failed', error: data.error_message || data.error || 'Generation failed' };
  }
  
  return { status: 'processing' };
}

async function pollApimodelsImageTask(taskId, apiKey) {
  console.log(`[BG-POLL] Polling apimodels IMAGE task=${taskId}`);
  const statusResponse = await axios.get(
    `https://apimodels.app/api/v1/images/generations?task_id=${encodeURIComponent(taskId)}`,
    { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 30000 }
  );
  const raw = statusResponse.data;
  const data = raw.data || raw;
  const status = data.state || data.status;
  console.log(`[BG-POLL] Apimodels image status=${status}, keys=${Object.keys(data).join(',')}`);

  if (status === 'completed') {
    let url = null;
    if (data.resultUrls && data.resultUrls.length > 0) {
      url = data.resultUrls[0];
    } else if (data.url) {
      url = data.url;
    } else if (data.image_url) {
      url = data.image_url;
    }
    if (!url) {
      console.log(`[BG-POLL] Apimodels image ${taskId} completed but no URL yet`);
      return { status: 'processing' };
    }
    return { status: 'completed', url };
  }
  if (status === 'failed') {
    return { status: 'failed', error: data.failMsg || data.error || 'Image generation failed' };
  }
  return { status: 'processing' };
}

async function pollApimodelsTask(taskId, apiKey, model) {
  console.log(`[BG-POLL] Polling apimodels task=${taskId}, key=${apiKey ? apiKey.substring(0,10)+'...' : 'NONE'}`);
  const statusResponse = await axios.get(
    `https://apimodels.app/api/v1/video/generations?task_id=${encodeURIComponent(taskId)}`,
    { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 30000 }
  );
  const raw = statusResponse.data;
  console.log(`[BG-POLL] Full apimodels response for ${taskId}:`, JSON.stringify(raw));
  const data = raw.data || raw;
  const status = data.state || data.status;
  console.log(`[BG-POLL] Parsed status=${status}, videos=${JSON.stringify(data.videos || [])}, keys=${Object.keys(data).join(',')}`);

  if (status === 'completed') {
    let url = null;
    if (data.videos && data.videos.length > 0) {
      url = data.videos[0];
    } else if (data.resultUrls && data.resultUrls.length > 0) {
      url = data.resultUrls[0];
    } else if (data.video_url) {
      url = data.video_url;
    } else if (data.url) {
      url = data.url;
    } else if (data.thumbnailUrl) {
      url = data.thumbnailUrl;
    }
    if (!url) {
      console.log(`[BG-POLL] Apimodels task ${taskId} completed but no URL yet - will wait for callback`);
      return { status: 'processing' };
    }
    return { status: 'completed', url };
  }

  if (status === 'failed') {
    return { status: 'failed', error: data.error || data.message || 'Generation failed' };
  }

  return { status: 'processing' };
}

async function pollApimartTask(taskId, apiKey) {
  const statusResponse = await axios.get(
    `https://api.apimart.ai/v1/tasks/${taskId}`,
    { headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 30000 }
  );
  const rawData = statusResponse.data;
  const data = rawData.data || rawData;
  const status = data.status || data.state;
  
  if (status === 'completed' || status === 'finished' || status === 'success') {
    let url = data.result?.video?.url ||
              data.result?.videos?.[0]?.url ||
              data.result?.video_url ||
              data.result?.url ||
              data.result?.outputs?.[0]?.url ||
              data.result?.outputs?.[0]?.video_url ||
              data.result?.output?.url ||
              data.result?.output?.video_url ||
              data.result?.images?.[0]?.url ||
              data.result?.image_url ||
              data.images?.[0]?.url ||
              data.image_url ||
              data.video_url ||
              data.url ||
              data.output?.url ||
              data.output?.video_url ||
              data.output?.images?.[0]?.url ||
              data.output?.image_url ||
              data.media_url;
    
    if (Array.isArray(url)) url = url[0];
    if (!url && data.result?.images?.[0]) {
      url = typeof data.result.images[0] === 'string' ? data.result.images[0] : null;
    }
    console.log(`[APIMART] Completed task URL extracted: ${url ? url.substring(0, 80) : 'NULL'}`);
    console.log(`[APIMART] Raw data keys: ${JSON.stringify(Object.keys(data))}, result keys: ${data.result ? JSON.stringify(Object.keys(data.result)) : 'no result'}`);
    return { status: 'completed', url };
  }
  
  if (status === 'failed' || status === 'error') {
    return { status: 'failed', error: data.error?.message || data.error_message || data.message || 'Generation failed' };
  }
  
  return { status: 'processing' };
}

async function pollKie4oImageTask(taskId, apiKey) {
  const statusResponse = await axios.get(
    `https://api.kie.ai/api/v1/gpt4o-image/record-info`,
    { params: { taskId }, headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 30000 }
  );
  const data = statusResponse.data?.data || statusResponse.data;
  const successFlag = data?.successFlag;
  if (successFlag === 1) {
    const url = data?.response?.result_urls?.[0];
    return { status: 'completed', url };
  }
  if (successFlag === 2) {
    return { status: 'failed', error: data?.errorMessage || 'Generation failed' };
  }
  return { status: 'processing' };
}

async function pollKieMarketImageTask(taskId, apiKey) {
  const statusResponse = await axios.get(
    `https://api.kie.ai/api/v1/jobs/recordInfo`,
    { params: { taskId }, headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 30000 }
  );
  const data = statusResponse.data?.data || statusResponse.data;
  const state = data?.state;
  if (state === 'success' || state === 'succeeded' || state === 'completed') {
    let url = null;
    try {
      const resultObj = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : data.resultJson;
      url = resultObj?.resultUrls?.[0] || resultObj?.image_url || resultObj?.imageUrl;
    } catch (e) {
      url = data?.result?.image_url;
    }
    return { status: 'completed', url };
  }
  if (state === 'failed' || state === 'error') {
    return { status: 'failed', error: data?.failMsg || 'Generation failed' };
  }
  return { status: 'processing' };
}

async function pollKieFluxKontextTask(taskId, apiKey) {
  const statusResponse = await axios.get(
    `https://api.kie.ai/api/v1/flux/kontext/record-info`,
    { params: { taskId }, headers: { 'Authorization': `Bearer ${apiKey}` }, timeout: 30000 }
  );
  const data = statusResponse.data?.data || statusResponse.data;
  const successFlag = data?.successFlag;
  if (successFlag === 1) {
    const url = data?.response?.resultImageUrl || data?.response?.originImageUrl;
    return { status: 'completed', url };
  }
  if (successFlag === 2) {
    return { status: 'failed', error: data?.errorMessage || 'Generation failed' };
  }
  return { status: 'processing' };
}

async function pollFreepikMotionTask(taskId, apiKey, model, usedKeyName) {
  const primaryEndpoint = `/v1/ai/image-to-video/kling-v2-6/${taskId}`;

  try {
    const pollResponse = await makeFreepikRequest(
      'GET',
      `https://api.freepik.com${primaryEndpoint}`,
      apiKey,
      null,
      true,
      taskId,
      'decodo'
    );
    
    if (pollResponse.data && typeof pollResponse.data === 'object') {
      const taskData = pollResponse.data.data || pollResponse.data;
      const status = taskData.status || '';
      
      console.log(`[MOTION] Poll ${taskId} | Status: ${status}`);
      
      if (status === 'COMPLETED' || status === 'completed') {
        const videoUrl = (taskData.generated && taskData.generated.length > 0 ? taskData.generated[0] : null)
          || taskData.video?.url
          || taskData.result?.url
          || taskData.url;
        if (videoUrl) return { status: 'completed', url: videoUrl };
        return { status: 'processing' };
      }
      if (status === 'FAILED' || status === 'failed') {
        const fullData = JSON.stringify(taskData);
        const errMsg = taskData.error_message || taskData.error || taskData.message || taskData.detail || taskData.reason || taskData.fail_reason || 'Generation failed';
        console.log(`[MOTION] Poll ${taskId} FAILED: ${errMsg}`);
        try {
          await pool.query(
            'UPDATE video_generation_tasks SET error_message = $1 WHERE task_id = $2 AND error_message IS NULL',
            [errMsg === 'Generation failed' ? `Generation failed | Raw: ${fullData.slice(0, 500)}` : errMsg, taskId]
          );
        } catch (dbErr) {}
        return { status: 'failed', error: errMsg };
      }
      return { status: 'processing' };
    }
  } catch (e) {
    const httpStatus = e.response?.status;
    const errMsg = e.response?.data?.message || e.response?.data?.detail || e.message || '';
    
    if (isFreepikTrialExpired(errMsg) || isFreepikTrialExpired(JSON.stringify(e.response?.data || ''))) {
      const keyName = usedKeyName || (apiKey ? `key_${apiKey.slice(-6)}` : 'unknown');
      console.log(`[MOTION-EXPIRED] Key ${keyName} free trial habis (detected during poll), blacklisting`);
      markMotionKeyExpired(keyName);
      return { status: 'failed', error: 'API key free trial habis' };
    }
    if (httpStatus === 403) {
      const respStr = (e.response?.data || '').toString();
      if (respStr.includes('Access Denied') || respStr.includes('edgesuite')) {
        return { status: 'processing' };
      }
      console.log(`[MOTION] Poll ${taskId} → 403 Forbidden. Relying on webhook.`);
      return { status: 'forbidden' };
    }
    if (httpStatus === 404) {
      return { status: 'processing' };
    }
    if (e.message && e.message.match(/socket|tls|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|ssl/i)) {
      return { status: 'processing' };
    }
    console.log(`[MOTION] Poll ${taskId} error (${httpStatus || 'network'}): ${errMsg}`);
  }
  
  return { status: 'processing' };
}

async function pollFreepikVideoTask(taskId, apiKey, model) {
  const vidgen3Endpoints = {
    'minimax-live': '/v1/ai/image-to-video/minimax-live',
    'seedance-1.5-pro-1080p': '/v1/ai/video/seedance-1-5-pro-1080p',
    'seedance-1.5-pro-720p': '/v1/ai/video/seedance-1-5-pro-720p',
    'ltx-2-pro-t2v': '/v1/ai/text-to-video/ltx-2-pro',
    'ltx-2-pro-i2v': '/v1/ai/image-to-video/ltx-2-pro',
    'ltx-2-fast-t2v': '/v1/ai/text-to-video/ltx-2-fast',
    'ltx-2-fast-i2v': '/v1/ai/image-to-video/ltx-2-fast',
    'runway-4.5-t2v': '/v1/ai/text-to-video/runway-4-5',
    'runway-4.5-i2v': '/v1/ai/image-to-video/runway-4-5',
    'runway-gen4-turbo': '/v1/ai/image-to-video/runway-gen4-turbo',
    'omnihuman-1.5': '/v1/ai/video/omni-human-1-5'
  };
  
  const videogenEndpoints = {
    'kling-v2-5-pro': '/v1/ai/image-to-video/kling-v2-5-pro',
    'kling-v2-1-master': '/v1/ai/image-to-video/kling-v2-1-master',
    'kling-v2-1-pro': '/v1/ai/image-to-video/kling-v2-1-pro',
    'kling-v2-1-std': '/v1/ai/image-to-video/kling-v2-1-std',
    'kling-v2': '/v1/ai/image-to-video/kling-v2',
    'kling-pro': '/v1/ai/image-to-video/kling-pro',
    'kling-std': '/v1/ai/image-to-video/kling-std',
    'minimax-hailuo-02-1080p': '/v1/ai/image-to-video/minimax-hailuo-02-1080p',
    'minimax-hailuo-02-768p': '/v1/ai/image-to-video/minimax-hailuo-02-768p',
    'seedance-lite-1080p': '/v1/ai/image-to-video/seedance-lite-1080p',
    'seedance-lite-720p': '/v1/ai/image-to-video/seedance-lite-720p',
    'pixverse-v5': '/v1/ai/image-to-video/pixverse-v5'
  };
  
  const basePath = vidgen3Endpoints[model] || videogenEndpoints[model] || `/v1/ai/image-to-video/${model}`;
  const endpoint = `${basePath}/${taskId}`;
  
  function parseResponse(data) {
    if (data && typeof data === 'object') {
      const taskData = data.data || data;
      const status = (taskData.status || '').toUpperCase();
      if (status === 'COMPLETED') {
        const videoUrl = taskData.video?.url || taskData.result?.url || taskData.url;
        if (videoUrl) return { status: 'completed', url: videoUrl };
      }
      if (status === 'FAILED') {
        return { status: 'failed', error: taskData.error || 'Generation failed' };
      }
    }
    return null;
  }

  try {
    const pollResponse = await makeFreepikRequest(
      'GET',
      `https://api.freepik.com${endpoint}`,
      apiKey,
      null,
      true,
      taskId,
      'decodo'
    );
    const result = parseResponse(pollResponse.data);
    if (result) return result;
  } catch (e) {}
  return { status: 'processing' };
}

setInterval(async () => {
  if (serverBgPolls.size === 0) return;
  
  for (const [taskId, task] of serverBgPolls) {
    task.attempts++;
    
    if (task.attempts > task.maxAttempts || (Date.now() - task.startTime > 3600000)) {
      console.log(`[BG-POLL] Task ${taskId} timed out after ${task.attempts} attempts`);
      const isMotionTimeout = (task.model || '').startsWith('motion-');
      if (isMotionTimeout && task.usedKeyName) markMotionKeyFree(task.usedKeyName);
      serverBgPolls.delete(taskId);
      try {
        const table = task.dbTable || 'vidgen4_tasks';
        const urlCol = task.urlColumn || 'video_url';
        if (table === 'ximage_history' || table === 'ximage2_history' || table === 'ximage3_history') {
          await pool.query(`UPDATE ${table} SET status = 'failed', completed_at = NOW() WHERE task_id = $1 AND status != 'completed'`, [taskId]);
        } else {
          await pool.query(`UPDATE ${table} SET status = 'failed', error_message = 'Timeout', completed_at = NOW() WHERE task_id = $1 AND status != 'completed'`, [taskId]);
        }
      } catch (e) {}
      continue;
    }
    
    try {
      let result;
      if (task.apiType === 'poyo') {
        result = await pollPoyoTask(taskId, task.apiKey);
      } else if (task.apiType === 'apimodels') {
        result = await pollApimodelsTask(taskId, task.apiKey, task.model);
      } else if (task.apiType === 'apimodels-image') {
        result = await pollApimodelsImageTask(taskId, task.apiKey);
      } else if (task.apiType === 'apimart') {
        result = await pollApimartTask(taskId, task.apiKey);
      } else if (task.apiType === 'kie-4o-image') {
        result = await pollKie4oImageTask(taskId, task.apiKey);
      } else if (task.apiType === 'kie-market') {
        result = await pollKieMarketImageTask(taskId, task.apiKey);
      } else if (task.apiType === 'kie-flux-kontext') {
        result = await pollKieFluxKontextTask(taskId, task.apiKey);
      } else if (task.apiType === 'freepik-motion') {
        result = await pollFreepikMotionTask(taskId, task.apiKey, task.model, task.usedKeyName);
      } else if (task.apiType === 'freepik-video') {
        result = await pollFreepikVideoTask(taskId, task.apiKey, task.model);
      }
      
      if (!result) continue;
      
      const table = task.dbTable || 'vidgen4_tasks';
      const urlCol = task.urlColumn || 'video_url';
      
      if (result.status === 'completed' && !result.url) {
        console.error(`[BG-POLL] Task ${taskId} completed but no URL - marking as failed`);
        const isMotionNoUrl = (task.model || '').startsWith('motion-');
        if (isMotionNoUrl && task.usedKeyName) markMotionKeyFree(task.usedKeyName);
        await pool.query(`UPDATE ${table} SET status = 'failed', completed_at = NOW() WHERE task_id = $1 AND status IN ('pending', 'processing')`, [taskId]);
        if (task.userId) {
          {
            const isImage = table === 'ximage_history' || table === 'ximage2_history' || table === 'ximage3_history';
            let sseType = table === 'ximage3_history' ? 'ximage3_failed' : isImage ? (table === 'ximage2_history' ? 'ximage2_failed' : 'ximage_failed') : 'video_failed';
            sendSSEToUser(task.userId, { type: sseType, taskId, error: 'No result URL from API' });
          }
        }
        serverBgPolls.delete(taskId);
      } else if (result.status === 'completed' && result.url) {
        console.log(`[BG-POLL] Task ${taskId} completed! URL: ${result.url.substring(0, 80)}...`);
        const isMotionCompleted = (task.model || '').startsWith('motion-');
        if (isMotionCompleted && task.usedKeyName) markMotionKeyFree(task.usedKeyName);
        await pool.query(
          `UPDATE ${table} SET status = 'completed', ${urlCol} = $1, completed_at = NOW() WHERE task_id = $2 AND status IN ('pending', 'processing')`,
          [result.url, taskId]
        );
        if (task.userId) {
          const isImage = table === 'ximage_history' || table === 'ximage2_history' || table === 'ximage3_history';
          const isMotion = isMotionCompleted;
          let sseType = 'video_completed';
          if (table === 'ximage3_history') sseType = 'ximage3_completed';
          else if (isImage) sseType = table === 'ximage2_history' ? 'ximage2_completed' : 'ximage_completed';
          else if (isMotion) sseType = 'motion_completed';
          else if (table === 'vidgen2_tasks') sseType = 'vidgen2_completed';
          else if (table === 'vidgen3_tasks') sseType = 'vidgen3_completed';
          else if (table === 'vidgen4_tasks') sseType = 'vidgen4_completed';
          const sseData = { type: sseType, taskId: taskId, model: task.model, prompt: task.prompt };
          sseData[isImage ? 'imageUrl' : 'videoUrl'] = result.url;
          if (isMotion) {
            try {
              const origResult = await pool.query('SELECT original_task_id FROM video_generation_tasks WHERE task_id = $1', [taskId]);
              if (origResult.rows[0]?.original_task_id) {
                sseData.originalTaskId = origResult.rows[0].original_task_id;
              }
            } catch(e) {}
          }
          sendSSEToUser(task.userId, sseData);
          console.log(`[BG-POLL] SSE sent to user ${task.userId}: ${sseType}${sseData.originalTaskId ? ' (original: ' + sseData.originalTaskId + ')' : ''}`);
        }
        serverBgPolls.delete(taskId);
      } else if (result.status === 'failed') {
        console.log(`[BG-POLL] Task ${taskId} failed: ${result.error}`);
        const isMotion = (task.model || '').startsWith('motion-');
        
        if (isMotion && task.usedKeyName) markMotionKeyFree(task.usedKeyName);
        
        if (isMotion && task.motionRetryData && task.motionRetryData.retryCount < task.motionRetryData.maxRetries) {
          const dbCheck = await pool.query(
            `SELECT status, task_id FROM video_generation_tasks WHERE task_id = $1`,
            [taskId]
          ).catch(() => ({ rows: [] }));
          
          if (dbCheck.rows.length === 0 || dbCheck.rows[0].task_id !== taskId) {
            console.log(`[BG-POLL] Task ${taskId} already retried by webhook, skipping bgPoll retry`);
            serverBgPolls.delete(taskId);
            continue;
          }
          
          console.log(`[BG-POLL] Motion task ${taskId} failed, attempting auto-retry...`);
          serverBgPolls.delete(taskId);
          const retried = await retryMotionTask(taskId, task);
          if (retried) {
            console.log(`[BG-POLL] Motion task ${taskId} auto-retry submitted`);
            continue;
          }
          console.log(`[BG-POLL] Motion task ${taskId} auto-retry failed, marking as failed`);
        }
        
        if (table === 'ximage_history' || table === 'ximage2_history' || table === 'ximage3_history') {
          await pool.query(`UPDATE ${table} SET status = 'failed', completed_at = NOW() WHERE task_id = $1 AND status IN ('pending', 'processing')`, [taskId]);
        } else {
          await pool.query(`UPDATE ${table} SET status = 'failed', error_message = $1, completed_at = NOW() WHERE task_id = $2 AND status IN ('pending', 'processing')`, [result.error, taskId]);
        }
        if (task.userId) {
          {
            const isImage = table === 'ximage_history' || table === 'ximage2_history' || table === 'ximage3_history';
            let sseType = 'video_failed';
            if (table === 'ximage3_history') sseType = 'ximage3_failed';
            else if (isImage) sseType = table === 'ximage2_history' ? 'ximage2_failed' : 'ximage_failed';
            else if (isMotion) sseType = 'motion_failed';
            else if (table === 'vidgen2_tasks') sseType = 'vidgen2_failed';
            else if (table === 'vidgen3_tasks') sseType = 'vidgen3_failed';
            else if (table === 'vidgen4_tasks') sseType = 'vidgen4_failed';
            sendSSEToUser(task.userId, { type: sseType, taskId: taskId, error: result.error });
          }
        }
        serverBgPolls.delete(taskId);
      } else if (result.status === 'forbidden') {
        const isMotionForbidden = (task.model || '').startsWith('motion-');
        if (isMotionForbidden && task.usedKeyName) markMotionKeyFree(task.usedKeyName);
        console.log(`[BG-POLL] Task ${taskId} → 403 API key mismatch, stopping BG-POLL. Relying on webhook.`);
        serverBgPolls.delete(taskId);
      }
    } catch (e) {
      if (task.attempts % 10 === 0) {
        console.log(`[BG-POLL] Poll error for ${taskId} (attempt ${task.attempts}):`, e.message);
      }
    }
  }
}, 30000);

async function resumePendingTaskPolling() {
  try {
    const tables = [
      { table: 'vidgen2_tasks', apiType: 'apimodels', urlCol: 'video_url', keyCol: 'used_key_name' },
      { table: 'vidgen4_tasks', apiType: 'apimart', urlCol: 'video_url', keyCol: 'used_key_name' },
      { table: 'ximage_history', apiType: 'apimodels-image', urlCol: 'image_url', keyCol: null },
      { table: 'ximage2_history', apiType: 'apimart', urlCol: 'image_url', keyCol: null },
      { table: 'ximage3_history', apiType: 'poyo', urlCol: 'image_url', keyCol: null },
      { table: 'video_generation_tasks', apiType: 'freepik-auto', urlCol: 'video_url', keyCol: 'used_key_name' }
    ];
    
    let resumed = 0;
    for (const { table, apiType, urlCol, keyCol } of tables) {
      try {
        const result = await pool.query(
          `SELECT task_id, model, user_id ${keyCol ? ', ' + keyCol : ''} ${table === 'video_generation_tasks' ? ', retry_data, retry_count, room_id, xclip_api_key_id' : ''} FROM ${table} WHERE status IN ('pending', 'processing') AND created_at > NOW() - INTERVAL '1 hour'`
        );
        
        for (const row of result.rows) {
          let apiKey = null;
          const isMotionTask = (row.model || '').startsWith('motion-');

          if (keyCol && row[keyCol]) {
            const keyName = row[keyCol];
            const bulkMatch = keyName.match(/^(.+)\[(\d+)\]$/);
            if (bulkMatch) {
              const envVal = process.env[bulkMatch[1]];
              if (envVal) {
                const idx = parseInt(bulkMatch[2]);
                const parts = envVal.split(',');
                if (parts[idx]) apiKey = sanitizeApiKey(parts[idx]);
              }
            } else {
              const envVal = process.env[keyName];
              if (envVal) apiKey = sanitizeApiKey(envVal);
            }
          }
          if (!apiKey && isMotionTask) {
            const mKeys = getAllMotionRoomKeys(5);
            if (mKeys.length > 0) apiKey = mKeys[0].key;
          }
          if (!apiKey && (apiType === 'poyo')) {
            outer_poyo: for (let r = 1; r <= 3; r++) {
              for (let k = 1; k <= 3; k++) {
                const pk = process.env[`VIDGEN2_ROOM${r}_KEY_${k}`];
                if (pk) { apiKey = sanitizeApiKey(pk); break outer_poyo; }
              }
            }
            if (!apiKey && process.env.POYO_API_KEY) apiKey = sanitizeApiKey(process.env.POYO_API_KEY);
          }
          if (!apiKey && (apiType === 'apimodels' || apiType === 'apimodels-image')) {
            outer_apimodels: for (let r = 1; r <= 3; r++) {
              for (let k = 1; k <= 3; k++) {
                const pk = process.env[`VIDGEN2_ROOM${r}_KEY_${k}`];
                if (pk) { apiKey = sanitizeApiKey(pk); break outer_apimodels; }
              }
            }
            if (!apiKey && process.env.APIMODELS_API_KEY) apiKey = sanitizeApiKey(process.env.APIMODELS_API_KEY);
          }
          if (!apiKey && (apiType === 'apimart')) {
            if (process.env.APIMART_API_KEY) apiKey = sanitizeApiKey(process.env.APIMART_API_KEY);
          }
          if (!apiKey && (apiType === 'kie-ximage')) {
            outer2: for (let r = 1; r <= 5; r++) {
              for (let k = 1; k <= 3; k++) {
                const xk = process.env[`XIMAGE_ROOM${r}_KEY_${k}`];
                if (xk) { apiKey = sanitizeApiKey(xk); break outer2; }
              }
            }
            if (!apiKey && process.env.XIMAGE_API_KEY) apiKey = sanitizeApiKey(process.env.XIMAGE_API_KEY);
          }
          if (!apiKey && (apiType === 'freepik-auto' || apiType === 'freepik-motion' || apiType === 'freepik-video')) {
            if (process.env.FREEPIK_API_KEY) apiKey = sanitizeApiKey(process.env.FREEPIK_API_KEY);
          }
          if (apiKey) {
            let resolvedType = apiType;
            if (apiType === 'freepik-auto') {
              resolvedType = isMotionTask ? 'freepik-motion' : 'freepik-video';
            }
            const bgPollOpts = {
              dbTable: table,
              urlColumn: urlCol,
              model: row.model,
              userId: row.user_id || null,
              usedKeyName: keyCol ? row[keyCol] : null
            };
            if (isMotionTask && row.retry_data) {
              const dbRetry = row.retry_data;
              bgPollOpts.motionRetryData = {
                requestBody: dbRetry.requestBody,
                endpoint: dbRetry.endpoint,
                roomId: dbRetry.roomId || row.room_id || 1,
                xclipKeyId: dbRetry.xclipKeyId || row.xclip_api_key_id,
                retryCount: row.retry_count || 0,
                maxRetries: 2
              };
            }
            if (isMotionTask && row[keyCol]) {
              markMotionKeyBusy(row[keyCol]);
            }
            startServerBgPoll(row.task_id, resolvedType, apiKey, bgPollOpts);
            resumed++;
          }
        }
      } catch (e) {
        console.log(`[BG-POLL] Could not resume tasks from ${table}:`, e.message);
      }
    }
    
    if (resumed > 0) {
      console.log(`[BG-POLL] Resumed ${resumed} pending tasks from database`);
    }
  } catch (e) {
    console.error('[BG-POLL] Resume error:', e.message);
  }
}

// ============ END BACKGROUND POLLING ============

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

function getFreepikKeysForRoom(roomId, keyInfo = null) {
  if (roomId) {
    const bulkVar = process.env[`ROOM${roomId}_FREEPIK_KEYS`];
    if (bulkVar) {
      const keys = bulkVar.split(',').map(k => k.trim()).filter(Boolean);
      if (keys.length > 0) {
        console.log(`[ROOM${roomId}] Loaded ${keys.length} Freepik keys from ROOM${roomId}_FREEPIK_KEYS`);
        return keys;
      }
    }
  }
  if (keyInfo) {
    const keyNames = [keyInfo.key_name_1, keyInfo.key_name_2, keyInfo.key_name_3].filter(k => k);
    return keyNames.map(name => process.env[name]).filter(k => k);
  }
  return [];
}

const userKeyMap = new Map();
const globalKeyCounter = new Map();

function getRotatedApiKey(keyInfo, forceKeyIndex = null, userId = null) {
  const keys = getFreepikKeysForRoom(keyInfo.room_id, keyInfo);
  
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
    const counterKey = `room${keyInfo.room_id || 0}`;
    const current = globalKeyCounter.get(counterKey) || 0;
    keyIndex = current % keys.length;
    globalKeyCounter.set(counterKey, current + 1);
    console.log(`API key rotation: task → key ${keyIndex + 1} of ${keys.length} (round-robin, user ${userId || 'unknown'})`);
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
    
    const cooldownRemaining = getUserCooldownRemaining(keyInfo.user_id, 'videogen');
    if (cooldownRemaining > 0) {
      const cooldownSec = Math.ceil(cooldownRemaining / 1000);
      return res.status(429).json({ 
        error: `Mohon tunggu ${cooldownSec} detik sebelum generate video berikutnya`,
        cooldown: cooldownSec,
        cooldownMs: cooldownRemaining
      });
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
      const rotated = getRotatedApiKey(keyInfo, null, keyInfo.user_id);
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
    
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const imgBaseUrl = `${protocol}://${host}`;
    const imageFile = await saveBase64ToFile(image, 'image', imgBaseUrl);
    const imageUrl = imageFile.publicUrl;
    console.log(`[VIDEOGEN] Image saved to public URL: ${imageUrl} (saved ${(Buffer.byteLength(image) / 1024 / 1024).toFixed(1)}MB proxy bandwidth)`);
    
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
      requestBody = {
        image: imageUrl,
        prompt: prompt || '',
        duration: duration || '5',
        aspect_ratio: mappedAspectRatio,
        negative_prompt: 'blurry, low quality, distorted, ugly, bad anatomy',
        cfg_scale: 0.5,
        generate_audio: true
      };
    } else if (config.api === 'kling-ai') {
      requestBody = {
        image: imageUrl,
        prompt: prompt || '',
        duration: duration || '5',
        aspect_ratio: mappedAspectRatio,
        cfg_scale: 0.6
      };
    } else if (config.api === 'minimax') {
      requestBody = {
        first_frame_image: imageUrl,
        prompt: prompt || '',
        prompt_optimizer: true,
        duration: 6
      };
    } else if (config.api === 'seedance') {
      requestBody = {
        image: imageUrl,
        prompt: prompt || '',
        duration: duration || '5',
        resolution: model.includes('1080p') ? '1080p' : '720p',
        seed: Math.floor(Math.random() * 1000000),
        motion_strength: 0.7
      };
    } else if (config.api === 'pixverse') {
      requestBody = {
        image: imageUrl,
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
      let wanSize;
      if (model.includes('1080p')) {
        wanSize = mappedAspectRatio === 'social_story_9_16' ? '1080*1920' : '1920*1080';
      } else {
        wanSize = mappedAspectRatio === 'social_story_9_16' ? '720*1280' : '1280*720';
      }
      requestBody = {
        image: imageUrl,
        prompt: prompt || '',
        duration: duration || '5',
        size: wanSize,
        negative_prompt: 'blurry, low quality, distorted, ugly, bad anatomy',
        enable_prompt_expansion: false,
        shot_type: 'single',
        seed: -1,
        generate_audio: true
      };
    } else if (config.api === 'wan22') {
      requestBody = {
        image: imageUrl,
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
      const bulkVar = process.env[`ROOM${keyInfo.room_id}_FREEPIK_KEYS`];
      if (bulkVar) {
        bulkVar.split(',').map(k => k.trim()).filter(Boolean).forEach((key, idx) => {
          allKeys.push({ key, index: idx, name: `ROOM${keyInfo.room_id}_FREEPIK_KEYS[${idx}]` });
        });
      } else {
        const keyNames = [keyInfo.key_name_1, keyInfo.key_name_2, keyInfo.key_name_3].filter(k => k);
        keyNames.forEach((name, idx) => {
          const key = process.env[name];
          if (key) allKeys.push({ key, index: idx, name });
        });
      }
    } else if (keySource === 'admin') {
      for (let r = 1; r <= 5; r++) {
        const bulkVar = process.env[`ROOM${r}_FREEPIK_KEYS`];
        if (bulkVar) {
          bulkVar.split(',').map(k => k.trim()).filter(Boolean).forEach((key, idx) => {
            allKeys.push({ key, index: allKeys.length, name: `ROOM${r}_FREEPIK_KEYS[${idx}]` });
          });
        } else {
          ['ROOM1_FREEPIK_KEY_1', 'ROOM1_FREEPIK_KEY_2', 'ROOM1_FREEPIK_KEY_3',
           'ROOM2_FREEPIK_KEY_1', 'ROOM2_FREEPIK_KEY_2', 'ROOM2_FREEPIK_KEY_3',
           'ROOM3_FREEPIK_KEY_1', 'ROOM3_FREEPIK_KEY_2', 'ROOM3_FREEPIK_KEY_3'].forEach((name, idx) => {
            const key = process.env[name];
            if (key) allKeys.push({ key, index: idx, name });
          });
          break;
        }
      }
    } else {
      allKeys.push({ key: freepikApiKey, index: 0, name: keySource });
    }
    
    const availableKeys = filterKeysByDailyQuota(allKeys, 'videogen');
    if (availableKeys.length === 0 && allKeys.length > 0) {
      return res.status(429).json({ error: 'Semua API key sudah mencapai batas harian. Coba lagi besok.' });
    }
    
    await applyRandomJitter('videogen');
    
    let lastError = null;
    let successResponse = null;
    let finalKeyIndex = usedKeyIndex;
    
    const { proxy: pendingProxy, pendingId } = await getOrAssignProxyForPendingTask();
    const maxKeyAttempts = Math.min(availableKeys.length, 5);
    const loopDeadline = Date.now() + 30000;
    
    for (let attempt = 0; attempt < maxKeyAttempts; attempt++) {
      if (Date.now() > loopDeadline) {
        console.warn(`[VIDEOGEN] Key rotation time budget exceeded (30s), stopping after ${attempt} attempts`);
        break;
      }
      const currentKey = availableKeys[attempt];
      console.log(`[TIMING] Attempt ${attempt + 1}/${availableKeys.length} - Using key: ${currentKey.name} | Model: ${model}`);
      
      try {
        const response = await makeFreepikRequest(
          'POST',
          `${baseUrl}${config.endpoint}`,
          currentKey.key,
          requestBody,
          true,
          pendingId,
          'decodo'
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
      if (pendingId) releaseProxyForTask(pendingId);
      console.error('All API keys exhausted or failed');
      console.error('Last error:', JSON.stringify(lastError?.response?.data, null, 2) || lastError?.message);
      const errorMsg = lastError?.response?.data?.detail || lastError?.response?.data?.message || lastError?.response?.data?.error || lastError?.message;
      return res.status(500).json({ error: 'Semua API key sudah mencapai limit bulanan. ' + errorMsg });
    }
    
    const taskId = successResponse.data.data?.task_id || successResponse.data.task_id;
    const requestTime = new Date().toISOString();
    const createLatency = Date.now() - startTime;
    
    setUserCooldown(keyInfo.user_id, 'videogen');
    const usedKeyForQuota = availableKeys.find(k => k.index === finalKeyIndex);
    if (usedKeyForQuota) {
      const newCount = incrementDailyKeyUsage(usedKeyForQuota.name, 'videogen');
      console.log(`[RATE-LIMIT] Video Gen key ${usedKeyForQuota.name} daily usage: ${newCount}/${RATE_LIMIT_CONFIG.videogen.dailyQuotaPerKey}`);
    }
    
    console.log(`[TIMING] Task ${taskId} created in ${createLatency}ms at ${requestTime} | Model: ${model}`);
    
    if (taskId && pendingId) {
      promoteProxyToTask(pendingId, taskId);
    } else if (pendingId) {
      releaseProxyForTask(pendingId);
    }
    
    const usedKeyName = availableKeys.find(k => k.index === finalKeyIndex)?.name || keySource;
    
    if (taskId) {
      await pool.query(
        'INSERT INTO video_generation_tasks (xclip_api_key_id, user_id, room_id, task_id, model, key_index, used_key_name) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [keyInfo.id, keyInfo.user_id, keyInfo.room_id, taskId, model, finalKeyIndex, usedKeyName]
      );
      console.log(`[SAVED] Task ${taskId} saved with key_name: ${usedKeyName}`);
      
      startServerBgPoll(taskId, 'freepik-video', freepikApiKey, {
        dbTable: 'video_generation_tasks',
        urlColumn: 'video_url',
        model: model,
        userId: keyInfo.user_id
      });
    }
    
    res.json({
      success: true,
      taskId: taskId,
      model: model,
      createdAt: requestTime,
      cooldown: Math.ceil(RATE_LIMIT_CONFIG.videogen.cooldownMs / 1000)
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
    if (savedTask.used_key_name) {
      if (process.env[savedTask.used_key_name]) {
        freepikApiKey = process.env[savedTask.used_key_name];
        keySource = savedTask.used_key_name;
      } else {
        const bulkMatch = savedTask.used_key_name.match(/^ROOM(\d+)_FREEPIK_KEYS\[(\d+)\]$/);
        if (bulkMatch) {
          const bulkVar = process.env[`ROOM${bulkMatch[1]}_FREEPIK_KEYS`];
          if (bulkVar) {
            const bulkKeys = bulkVar.split(',').map(k => k.trim()).filter(Boolean);
            if (bulkKeys[parseInt(bulkMatch[2])]) {
              freepikApiKey = bulkKeys[parseInt(bulkMatch[2])];
              keySource = savedTask.used_key_name;
            }
          }
        }
      }
    }
    
    // PRIORITY 2: Fallback to room keys using saved index (only if keyInfo available)
    if (!freepikApiKey && keyInfo && keyInfo.room_id) {
      const rawKeys = getFreepikKeysForRoom(keyInfo.room_id, keyInfo);
      const keys = rawKeys.map((key, idx) => ({ key, name: `ROOM${keyInfo.room_id}_KEY_${idx + 1}` }));
      
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
    
    if (!freepikApiKey) {
      console.error(`[STATUS] No API key found for task ${taskId}, used_key_name: ${savedTask.used_key_name}`);
      return res.status(503).json({ error: 'API key tidak ditemukan untuk task ini. Pastikan ROOM_FREEPIK_KEYS sudah dikonfigurasi.' });
    }

    const pollStart = Date.now();
    const response = await makeFreepikRequest(
      'GET',
      `https://api.freepik.com${endpoint}${taskId}`,
      freepikApiKey,
      null,
      true,
      null,
      'decodo'
    );
    const pollLatency = Date.now() - pollStart;
    
    if (typeof response.data === 'string') {
      console.log(`[VIDEOGEN] Poll returned HTML/text instead of JSON, Freepik may be blocking`);
      return res.json({ status: 'processing', progress: 0, taskId });
    }
    
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
      releaseProxyForTask(taskId);
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
    if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
      releaseProxyForTask(taskId);
    }
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
    
    const motionCooldownRemaining = getUserCooldownRemaining(keyInfo.user_id, 'motion');
    if (motionCooldownRemaining > 0) {
      const cooldownSec = Math.ceil(motionCooldownRemaining / 1000);
      return res.status(429).json({ 
        error: `Mohon tunggu ${cooldownSec} detik sebelum generate motion berikutnya`,
        cooldown: cooldownSec,
        cooldownMs: motionCooldownRemaining
      });
    }
    
    // Get the selected room's API keys (default to room 1)
    const selectedRoomId = roomId || 1;
    let freepikApiKey = null;
    let usedKeyName = null;
    
    const roomInfoResult = await pool.query('SELECT max_users FROM motion_rooms WHERE id = $1', [selectedRoomId]);
    const roomMaxUsers = roomInfoResult.rows[0]?.max_users || 100;
    
    const usageResult = await pool.query(`
      SELECT COUNT(DISTINCT xclip_api_key_id) as active_users
      FROM video_generation_tasks 
      WHERE model LIKE 'motion-%' 
        AND room_id = $1
        AND created_at > NOW() - INTERVAL '30 minutes'
    `, [selectedRoomId]);
    
    const currentUsers = parseInt(usageResult.rows[0]?.active_users) || 0;
    
    const userInRoomResult = await pool.query(`
      SELECT 1 FROM video_generation_tasks 
      WHERE model LIKE 'motion-%' 
        AND room_id = $1 
        AND xclip_api_key_id = $2
        AND created_at > NOW() - INTERVAL '30 minutes'
      LIMIT 1
    `, [selectedRoomId, keyInfo.id]);
    
    const isUserAlreadyInRoom = userInRoomResult.rows.length > 0;
    
    if (currentUsers >= roomMaxUsers && !isUserAlreadyInRoom) {
      return res.status(400).json({ 
        error: `Room ${selectedRoomId} sudah penuh (${currentUsers}/${roomMaxUsers} user). Coba room lain.`,
        roomFull: true 
      });
    }
    
    const allMotionKeys = getMotionRoomKeys(selectedRoomId);
    for (let r = 1; r <= 5; r++) {
      if (r === selectedRoomId) continue;
      allMotionKeys.push(...getMotionRoomKeys(r));
    }
    
    console.log(`[MOTION] Available keys: ${allMotionKeys.length} (room ${selectedRoomId} first, then fallback rooms)`);
    
    if (allMotionKeys.length === 0) {
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
    
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    
    const imageFile = await saveBase64ToFile(characterImage, 'image', baseUrl);
    const videoFile = await saveBase64ToFile(referenceVideo, 'video', baseUrl);
    
    console.log(`[MOTION] Image URL: ${imageFile.publicUrl}`);
    console.log(`[MOTION] Video URL: ${videoFile.publicUrl}`);
    
    const webhookUrl = getWebhookUrl();
    
    const requestBody = {
      image_url: imageFile.publicUrl,
      video_url: videoFile.publicUrl,
      character_orientation: characterOrientation || 'video'
    };
    
    if (webhookUrl) {
      requestBody.webhook_url = webhookUrl;
    }
    
    if (prompt && prompt.trim()) {
      requestBody.prompt = prompt.trim();
    }
    
    console.log(`[MOTION] Generating motion video with model: ${model} (via Decodo proxy)`);
    
    const quotaFilteredKeys = filterKeysByDailyQuota(allMotionKeys, 'motion');
    if (quotaFilteredKeys.length === 0 && allMotionKeys.length > 0) {
      return res.status(429).json({ error: 'Semua API key Motion sudah mencapai batas harian. Coba lagi besok.' });
    }
    
    const availableMotionKeys = getAvailableMotionKeys(quotaFilteredKeys);
    if (availableMotionKeys.length === 0) {
      return res.status(429).json({ error: 'Semua API key Motion sedang rate limited. Coba lagi dalam beberapa menit.' });
    }
    
    await applyRandomJitter('motion');
    
    let successResponse = null;
    let lastError = null;
    usedKeyName = null;
    
    availableMotionKeys.sort((a, b) => {
      const activeA = getMotionKeyActiveCount(a.name);
      const activeB = getMotionKeyActiveCount(b.name);
      if (activeA !== activeB) return activeA - activeB;
      const rateA = getMotionKeySuccessRate(a.name);
      const rateB = getMotionKeySuccessRate(b.name);
      if (Math.abs(rateA - rateB) > 0.1) return rateB - rateA;
      return 0;
    });

    for (let attempt = 0; attempt < availableMotionKeys.length; attempt++) {
      const currentKey = availableMotionKeys[attempt];
      console.log(`[MOTION] Attempt ${attempt + 1}/${availableMotionKeys.length} - Key: ${currentKey.name} (room ${currentKey.roomId}), active: ${getMotionKeyActiveCount(currentKey.name)}, success: ${(getMotionKeySuccessRate(currentKey.name) * 100).toFixed(0)}%`);
      markMotionKeyBusy(currentKey.name);
      
      try {
        const response = await makeFreepikRequest(
          'POST',
          `https://api.freepik.com${endpoint}`,
          currentKey.key,
          requestBody,
          true,
          null,
          'decodo'
        );
        
        successResponse = response;
        usedKeyName = currentKey.name;
        freepikApiKey = currentKey.key;
        console.log(`[MOTION] Key ${currentKey.name} worked!`);
        break;
        
      } catch (error) {
        markMotionKeyFree(currentKey.name);
        lastError = error;
        const status = error.response?.status;
        const rawErrMsg = error.response?.data?.message || error.response?.data?.detail || error.message || '';
        const errorMsg = typeof rawErrMsg === 'string' ? rawErrMsg : JSON.stringify(rawErrMsg);
        const isDailyLimit = status === 429 || errorMsg.toLowerCase().includes('daily limit') || errorMsg.toLowerCase().includes('limit');
        const isNetworkError = !status && (errorMsg.includes('socket hang up') || errorMsg.includes('timeout') || errorMsg.includes('ECONNRESET') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('ssl') || errorMsg.includes('bad record mac'));
        
        if (isFreepikTrialExpired(errorMsg)) {
          markMotionKeyExpired(currentKey.name);
          continue;
        } else if (isDailyLimit) {
          markMotionKeyRateLimited(currentKey.name);
          console.log(`[MOTION] Key ${currentKey.name} hit rate limit (${status}), trying next key...`);
          continue;
        } else if (isNetworkError) {
          console.log(`[MOTION] Key ${currentKey.name} network error: ${errorMsg}, trying next key...`);
          continue;
        } else if (status === 403) {
          const fullErr = JSON.stringify(error.response?.data || {});
          if (isFreepikTrialExpired(fullErr)) {
            markMotionKeyExpired(currentKey.name);
            continue;
          }
          console.warn(`[MOTION] Key ${currentKey.name} got 403 (invalid/no access), trying next key... | Detail: ${fullErr}`);
          continue;
        } else {
          const fullErr = JSON.stringify(error.response?.data || {});
          console.error(`[MOTION] Key ${currentKey.name} failed with status ${status}: ${errorMsg} | Full: ${fullErr}`);
          break;
        }
      }
    }
    
    if (!successResponse) {
      console.error('[MOTION] All API keys exhausted or failed');
      const errorMsg = lastError?.response?.data?.detail || lastError?.response?.data?.message || lastError?.message;
      return res.status(500).json({ error: 'Semua API key Motion sudah mencapai daily limit. Coba lagi besok atau hubungi admin. ' + errorMsg });
    }
    
    console.log(`[MOTION] Freepik response:`, JSON.stringify(successResponse.data));
    
    setUserCooldown(keyInfo.user_id, 'motion');
    if (usedKeyName) {
      const motionUsageCount = incrementDailyKeyUsage(usedKeyName, 'motion');
      console.log(`[RATE-LIMIT] Motion key ${usedKeyName} daily usage: ${motionUsageCount}/${RATE_LIMIT_CONFIG.motion.dailyQuotaPerKey}`);
    }
    
    const taskId = successResponse.data?.data?.task_id || successResponse.data?.task_id || successResponse.data?.data?.id || successResponse.data?.id;
    
    console.log(`[MOTION] Task created: ${taskId}`);
    
    if (!taskId) {
      if (usedKeyName) markMotionKeyFree(usedKeyName);
      return res.status(500).json({ error: 'Freepik tidak mengembalikan task ID' });
    }
    
    if (taskId) {
      const retryDataForDb = JSON.stringify({
        requestBody,
        endpoint,
        roomId: selectedRoomId,
        xclipKeyId: keyInfo.id
      });
      await pool.query(
        `INSERT INTO video_generation_tasks (xclip_api_key_id, user_id, room_id, task_id, model, used_key_name, retry_data, retry_count) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
        [keyInfo.id, keyInfo.user_id, selectedRoomId, taskId, 'motion-' + model, usedKeyName, retryDataForDb]
      );
      console.log(`[MOTION] Task ${taskId} saved with key_name: ${usedKeyName}, motion_room: ${selectedRoomId}`);
      
      startServerBgPoll(taskId, 'freepik-motion', freepikApiKey, {
        dbTable: 'video_generation_tasks',
        urlColumn: 'video_url',
        model: 'motion-' + model,
        userId: keyInfo.user_id,
        usedKeyName: usedKeyName,
        motionRetryData: {
          requestBody,
          endpoint,
          roomId: selectedRoomId,
          xclipKeyId: keyInfo.id,
          retryCount: 0,
          maxRetries: 2
        }
      });
    }
    
    res.json({
      success: true,
      taskId: taskId,
      model: model,
      createdAt: new Date().toISOString(),
      cooldown: Math.ceil(RATE_LIMIT_CONFIG.motion.cooldownMs / 1000)
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
      const retryLookup = await pool.query(
        'SELECT * FROM video_generation_tasks WHERE original_task_id = $1 AND xclip_api_key_id = $2',
        [taskId, keyInfo.id]
      );
      if (retryLookup.rows.length > 0) {
        const retried = retryLookup.rows[0];
        console.log(`[MOTION] Client polled old task ${taskId}, found retried task ${retried.task_id}`);
        if (retried.status === 'completed' && retried.video_url) {
          return res.json({
            status: 'completed',
            progress: 100,
            videoUrl: retried.video_url,
            taskId: retried.task_id,
            model: retried.model
          });
        }
        if (retried.status === 'failed') {
          const retryCount = retried.retry_count || 0;
          const maxRetries = retried.retry_data?.maxRetries || 2;
          const retryDataExists = retried.retry_data && retried.retry_data.requestBody;
          if (retryDataExists && retryCount < maxRetries) {
            return res.json({
              status: 'processing',
              progress: 10,
              taskId: retried.task_id,
              message: `Auto-retry sedang berjalan (${retryCount + 1}/${maxRetries})...`
            });
          }
          return res.json({
            status: 'failed',
            error: cleanErrorForUser(retried.error_message),
            taskId: retried.task_id
          });
        }
        return res.json({
          status: 'processing',
          progress: 30,
          taskId: retried.task_id,
          message: `Auto-retry ke-${retried.retry_count || 1} sedang berjalan...`
        });
      }
      return res.status(404).json({ error: 'Task tidak ditemukan atau bukan milik API key ini' });
    }
    
    const savedTask = taskResult.rows[0];
    
    // If webhook already updated this task to completed/failed, return from DB directly
    // This prevents assigning a new proxy after webhook already released the old one
    if (savedTask.status === 'completed' && savedTask.video_url) {
      console.log(`[MOTION] Task ${taskId} already completed (via webhook), returning from DB`);
      return res.json({
        status: 'completed',
        progress: 100,
        videoUrl: savedTask.video_url,
        taskId: taskId,
        model: savedTask.model
      });
    }
    if (savedTask.status === 'failed') {
      const retryCount = savedTask.retry_count || 0;
      const retryDataExists = savedTask.retry_data && savedTask.retry_data.requestBody;
      const maxRetries = savedTask.retry_data?.maxRetries || 2;
      if (retryDataExists && retryCount < maxRetries) {
        console.log(`[MOTION] Task ${taskId} failed in DB but retry still possible (${retryCount}/${maxRetries}), returning processing`);
        return res.json({
          status: 'processing',
          progress: 10,
          taskId: taskId,
          message: `Auto-retry sedang berjalan (${retryCount + 1}/${maxRetries})...`
        });
      }
      console.log(`[MOTION] Task ${taskId} already failed (via webhook), returning from DB`);
      const cleanError = cleanErrorForUser(savedTask.error_message);
      return res.json({
        status: 'failed',
        error: cleanError,
        taskId: taskId
      });
    }
    
    let freepikApiKey = null;
    
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
    
    if (!freepikApiKey && savedTask.room_id && savedTask.model?.startsWith('motion-')) {
      const motionKeys = getMotionRoomKeys(savedTask.room_id);
      if (motionKeys.length > 0) {
        freepikApiKey = motionKeys[0].key;
        console.log(`[MOTION] Using motion room key: ${motionKeys[0].name}`);
      }
    }
    
    if (!freepikApiKey && keyInfo.room_id) {
      const rotated = getRotatedApiKey(keyInfo, savedTask.key_index, keyInfo.user_id);
      freepikApiKey = rotated.key;
    }
    
    if (!freepikApiKey && keyInfo.is_admin) {
      const mKeys = getAllMotionRoomKeys(5);
      if (mKeys.length > 0) freepikApiKey = mKeys[0].key;
      if (!freepikApiKey) {
        const roomKeys = ['ROOM1_FREEPIK_KEY_1', 'ROOM2_FREEPIK_KEY_1', 'ROOM3_FREEPIK_KEY_1'];
        for (const kn of roomKeys) {
          if (process.env[kn]) { freepikApiKey = process.env[kn]; break; }
        }
      }
    }
    
    if (!freepikApiKey) {
      freepikApiKey = process.env.FREEPIK_API_KEY;
    }
    
    if (!freepikApiKey) {
      return res.status(500).json({ error: 'Tidak ada API key yang tersedia' });
    }
    
    const storedModel = savedTask.model || '';
    const isPro = storedModel.includes('pro');
    
    const pollEndpoints = [
      `/v1/ai/image-to-video/kling-v2-6/${taskId}`
    ];
    
    let response = null;
    let successEndpoint = null;
    
    for (const endpoint of pollEndpoints) {
      try {
        console.log(`[MOTION] Polling via proxy: ${endpoint}`);
        const pollResponse = await makeFreepikRequest(
          'GET',
          `https://api.freepik.com${endpoint}`,
          freepikApiKey,
          null,
          true,
          taskId,
          'decodo'
        );
        
        if (pollResponse.data && typeof pollResponse.data === 'object' && !pollResponse.data?.message?.includes('Not found')) {
          response = pollResponse;
          successEndpoint = endpoint;
          console.log(`[MOTION] Poll success with: ${endpoint}`);
          
          const status = pollResponse.data?.data?.status || pollResponse.data?.status;
          if (status && status !== 'CREATED') {
            console.log(`[MOTION] Found active status ${status} on ${endpoint}`);
          }
        } else if (typeof pollResponse.data === 'string') {
          console.log(`[MOTION] Endpoint ${endpoint} returned HTML/text, skipping`);
        }
      } catch (err) {
        console.log(`[MOTION] Poll endpoint ${endpoint} failed:`, err.response?.data?.message || err.message);
      }
      if (response && successEndpoint) {
        const foundStatus = response.data?.data?.status || response.data?.status;
        if (foundStatus && foundStatus !== 'CREATED') break;
      }
    }
    
    if (!response || !response.data) {
      const taskAge = savedTask.created_at ? (Date.now() - new Date(savedTask.created_at).getTime()) / 1000 : 0;
      if (taskAge < 120) {
        console.log(`[MOTION] Task ${taskId} not found on Freepik yet (age: ${Math.round(taskAge)}s), returning processing status`);
        return res.json({
          status: 'processing',
          progress: 5,
          taskId: taskId,
          message: 'Task sedang diproses oleh Freepik...'
        });
      }
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
      releaseProxyForTask(taskId);
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
    if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
      releaseProxyForTask(taskId);
      
      const retryCount = savedTask.retry_count || 0;
      const retryDataExists = savedTask.retry_data && savedTask.retry_data.requestBody;
      const maxRetries = savedTask.retry_data?.maxRetries || 2;
      if (retryDataExists && retryCount < maxRetries) {
        console.log(`[MOTION] Task ${taskId} failed on Freepik but retry available (${retryCount}/${maxRetries}), hiding failure from client`);
        return res.json({
          status: 'processing',
          progress: 10,
          taskId: taskId,
          message: `Auto-retry sedang berjalan (${retryCount + 1}/${maxRetries})...`
        });
      }
    }
    res.json({
      status: normalizedStatus === 'completed' || normalizedStatus === 'success' ? 'completed' : normalizedStatus,
      progress: data.progress || 0,
      videoUrl: videoUrl,
      taskId: taskId
    });
    
  } catch (error) {
    const status = error.response?.status;
    console.error('Motion poll error:', status, error.response?.data || error.message);
    if (status === 503 || status === 502 || status === 504) {
      return res.status(status).json({ error: 'Server Freepik sedang tidak tersedia sementara. Polling akan mencoba lagi otomatis.' });
    }
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
    // Get completed videos (exclude deleted and motion tasks)
    const completedResult = await pool.query(
      `SELECT task_id, model, status, video_url, created_at, completed_at
       FROM video_generation_tasks 
       WHERE user_id = $1 AND video_url IS NOT NULL AND status = 'completed'
       AND model NOT LIKE 'motion-%'
       ORDER BY completed_at DESC NULLS LAST, created_at DESC
       LIMIT 20`,
      [req.session.userId]
    );
    
    // Get processing videos (within last 30 minutes, exclude deleted and motion tasks)
    const processingResult = await pool.query(
      `SELECT task_id, model, status, created_at
       FROM video_generation_tasks 
       WHERE user_id = $1 AND status = 'processing'
       AND model NOT LIKE 'motion-%'
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

const videoRefreshCache = new Map();
const videoRefreshFailed = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of videoRefreshCache) {
    if (now - v.at > 10 * 60 * 1000) videoRefreshCache.delete(k);
  }
  for (const [k, v] of videoRefreshFailed) {
    if (now - v > 30 * 60 * 1000) videoRefreshFailed.delete(k);
  }
}, 60000);

app.get('/api/videogen/proxy-video', async (req, res) => {
  try {
    const { taskId } = req.query;
    if (!taskId) {
      return res.status(400).json({ error: 'taskId diperlukan' });
    }

    if (!req.session.userId) {
      return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
    }

    let taskResult = await pool.query(
      'SELECT task_id, model, video_url, used_key_name, room_id FROM video_generation_tasks WHERE task_id = $1 AND status = $2 AND user_id = $3',
      [taskId, 'completed', req.session.userId]
    );
    if (taskResult.rows.length === 0) {
      taskResult = await pool.query(
        'SELECT task_id, model, video_url, used_key_name, room_id FROM vidgen3_tasks WHERE task_id = $1 AND status = $2 AND user_id = $3',
        [taskId, 'completed', req.session.userId]
      );
    }
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video tidak ditemukan' });
    }

    const task = taskResult.rows[0];
    let videoUrl = task.video_url;

    const cached = videoRefreshCache.get(taskId);
    if (cached) videoUrl = cached.url;

    async function tryStream(url) {
      const resp = await axios.get(url, {
        responseType: 'stream',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.freepik.com/',
          'Accept': 'video/mp4,video/*,*/*'
        }
      });
      const ct = resp.headers['content-type'] || 'video/mp4';
      res.setHeader('Content-Type', ct);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      if (resp.headers['content-length']) res.setHeader('Content-Length', resp.headers['content-length']);
      resp.data.pipe(res);
      return true;
    }

    try {
      await tryStream(videoUrl);
      return;
    } catch (firstErr) {
      const status = firstErr.response?.status;
      if (status !== 403 && status !== 410 && status !== 401) {
        console.error('[VIDEOGEN] Proxy video error:', firstErr.message);
        if (!res.headersSent) return res.status(500).json({ error: 'Gagal memuat video' });
        return;
      }
    }

    if (videoRefreshFailed.has(taskId)) {
      return res.status(410).json({ error: 'Video sudah tidak tersedia' });
    }

    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      console.log(`[VIDEOGEN] Task ${taskId} already refreshed recently but still 403, marking failed`);
      videoRefreshFailed.set(taskId, Date.now());
      return res.status(410).json({ error: 'Video sudah tidak tersedia' });
    }

    console.log(`[VIDEOGEN] Video URL expired for task ${taskId}, re-fetching from Freepik...`);

    let apiKey = null;
    if (task.used_key_name && process.env[task.used_key_name]) {
      apiKey = process.env[task.used_key_name];
    }
    if (!apiKey && task.room_id) {
      if ((task.model || '').startsWith('motion-')) {
        const mk = getMotionRoomKeys(task.room_id);
        if (mk.length > 0) apiKey = mk[0].key;
      } else {
        const prefixes = [`VIDGEN3_ROOM${task.room_id}_KEY_`, `ROOM${task.room_id}_FREEPIK_KEY_`];
        for (const prefix of prefixes) {
          for (let i = 1; i <= 3; i++) {
            if (process.env[`${prefix}${i}`]) { apiKey = process.env[`${prefix}${i}`]; break; }
          }
          if (apiKey) break;
        }
      }
    }
    if (!apiKey) apiKey = process.env.FREEPIK_API_KEY;

    if (!apiKey) {
      videoRefreshFailed.set(taskId, Date.now());
      return res.status(410).json({ error: 'Video sudah tidak tersedia' });
    }

    const model = task.model || '';
    const isMotion = model.startsWith('motion-');
    const isPro = model.includes('pro');

    const vidgen3Endpoints = {
      'minimax-live': '/v1/ai/image-to-video/minimax-live',
      'seedance-1.5-pro-1080p': '/v1/ai/video/seedance-1-5-pro-1080p',
      'seedance-1.5-pro-720p': '/v1/ai/video/seedance-1-5-pro-720p',
      'ltx-2-pro-t2v': '/v1/ai/text-to-video/ltx-2-pro',
      'ltx-2-pro-i2v': '/v1/ai/image-to-video/ltx-2-pro',
      'ltx-2-fast-t2v': '/v1/ai/text-to-video/ltx-2-fast',
      'ltx-2-fast-i2v': '/v1/ai/image-to-video/ltx-2-fast',
      'runway-4.5-t2v': '/v1/ai/text-to-video/runway-4-5',
      'runway-4.5-i2v': '/v1/ai/image-to-video/runway-4-5',
      'runway-gen4-turbo': '/v1/ai/image-to-video/runway-gen4-turbo',
      'omnihuman-1.5': '/v1/ai/video/omni-human-1-5'
    };
    const videogenEndpoints = {
      'kling-v2-5-pro': '/v1/ai/image-to-video/kling-v2-5-pro',
      'kling-v2-1-master': '/v1/ai/image-to-video/kling-v2-1-master',
      'kling-v2-1-pro': '/v1/ai/image-to-video/kling-v2-1-pro',
      'kling-v2-1-std': '/v1/ai/image-to-video/kling-v2-1-std',
      'kling-v2': '/v1/ai/image-to-video/kling-v2',
      'kling-v2.6-pro': '/v1/ai/image-to-video/kling-v2-6',
      'kling-v2.6-std': '/v1/ai/image-to-video/kling-v2-6'
    };

    let pollEndpoints = [];
    if (isMotion) {
      pollEndpoints = [
        `/v1/ai/image-to-video/kling-v2-6/${taskId}`
      ];
    } else {
      const allEndpoints = { ...vidgen3Endpoints, ...videogenEndpoints };
      const matched = allEndpoints[model];
      if (matched) {
        pollEndpoints.push(`${matched}/${taskId}`);
      }
      pollEndpoints.push(`/v1/ai/image-to-video/kling-v2-6/${taskId}`);
      pollEndpoints = [...new Set(pollEndpoints)];
    }

    let freshUrl = null;
    for (const ep of pollEndpoints) {
      try {
        const pollResp = await makeFreepikRequest(
          'GET',
          `https://api.freepik.com${ep}`,
          apiKey,
          null,
          true,
          taskId,
          'decodo'
        );
        const d = pollResp.data?.data || pollResp.data;
        freshUrl = (d.generated && d.generated.length > 0 ? d.generated[0] : null)
          || d.video?.url || d.result?.url || d.url;
        if (freshUrl) break;
      } catch (e) {
        if (e.response?.status === 429) {
          console.log(`[VIDEOGEN] Rate limited during refresh for ${taskId}, skipping`);
          videoRefreshFailed.set(taskId, Date.now());
          return res.status(429).json({ error: 'Rate limited, coba lagi nanti' });
        }
        continue;
      }
    }

    if (!freshUrl) {
      videoRefreshFailed.set(taskId, Date.now());
      return res.status(410).json({ error: 'Video sudah tidak tersedia di Freepik' });
    }

    videoRefreshCache.set(taskId, { url: freshUrl, at: Date.now() });
    await pool.query('UPDATE video_generation_tasks SET video_url = $1 WHERE task_id = $2', [freshUrl, taskId]);
    await pool.query('UPDATE vidgen3_tasks SET video_url = $1 WHERE task_id = $2', [freshUrl, taskId]);
    console.log(`[VIDEOGEN] Refreshed video URL for task ${taskId}`);

    try {
      await tryStream(freshUrl);
    } catch (e) {
      console.error('[VIDEOGEN] Fresh URL also failed:', e.message);
      videoRefreshFailed.set(taskId, Date.now());
      if (!res.headersSent) res.status(410).json({ error: 'Video sudah tidak tersedia' });
    }
  } catch (error) {
    console.error('[VIDEOGEN] Proxy video error:', error.message);
    if (!res.headersSent) res.status(500).json({ error: 'Gagal memuat video' });
  }
});

// Proxy download endpoint for iOS (streams video through server with proper headers)
app.get('/api/download-video', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }

  const { url, filename } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL diperlukan' });
  }

  const downloadAllowedDomains = ['apimart.ai', 'cdn.apimart.ai', 'apimodels.app', 'cdn.apimodels.app', 'poyo.ai', 'cdn.poyo.ai', 'storage.googleapis.com', 'replicate.delivery', 'pbxt.replicate.delivery', 'fal.media', 'v3.fal.media', 'freepik.com', 'cdn.freepik.com', 'elevenlabs.io', 'api.elevenlabs.io'];
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:' || !downloadAllowedDomains.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith('.' + d))) {
      return res.status(400).json({ error: 'URL tidak diizinkan' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'URL tidak valid' });
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

app.delete('/api/videogen/history/:taskId', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  try {
    const { taskId } = req.params;
    await pool.query(
      'DELETE FROM video_generation_tasks WHERE task_id = $1 AND user_id = $2',
      [taskId, req.session.userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Delete video history error:', error);
    res.status(500).json({ error: 'Gagal menghapus video' });
  }
});

// Get motion history for current user (only motion tasks)
app.get('/api/motion/history', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ videos: [], processing: [] });
  }
  
  try {
    const completedResult = await pool.query(
      `SELECT task_id, model, status, video_url, created_at, completed_at
       FROM video_generation_tasks 
       WHERE user_id = $1 AND video_url IS NOT NULL AND status = 'completed'
       AND model LIKE 'motion-%'
       ORDER BY completed_at DESC NULLS LAST, created_at DESC
       LIMIT 20`,
      [req.session.userId]
    );
    
    const processingResult = await pool.query(
      `SELECT task_id, model, status, created_at
       FROM video_generation_tasks 
       WHERE user_id = $1 AND status = 'processing'
       AND model LIKE 'motion-%'
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
    console.error('Get motion history error:', error);
    res.status(500).json({ error: 'Gagal mengambil history motion' });
  }
});

app.delete('/api/motion/history/:taskId', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  try {
    const { taskId } = req.params;
    await pool.query(
      'DELETE FROM video_generation_tasks WHERE task_id = $1 AND user_id = $2 AND model LIKE $3',
      [taskId, req.session.userId, 'motion-%']
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Delete motion history error:', error);
    res.status(500).json({ error: 'Gagal menghapus motion video' });
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
          ...freepikHeaders(apiKey)
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
      headers: freepikHeaders(apiKey)
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

app.get('/api/admin/ddos/blocked', requireAdmin, (req, res) => {
  const blocked = [];
  const now = Date.now();
  for (const [ip, expiry] of ddos.blocked) {
    const strike = ddos.strikes.get(ip);
    blocked.push({
      ip,
      remaining: Math.ceil((expiry - now) / 1000),
      strikes: strike ? strike.count : 0,
      expiresAt: new Date(expiry).toISOString()
    });
  }
  res.json({ blocked, total: blocked.length });
});

app.post('/api/admin/ddos/unblock', requireAdmin, (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP diperlukan' });
  
  ddos.blocked.delete(ip);
  ddos.strikes.delete(ip);
  ddos.requests.delete(ip);
  console.log(`[DDOS] Admin unblocked IP: ${ip}`);
  res.json({ success: true, message: `IP ${ip} berhasil di-unblock` });
});

app.post('/api/admin/ddos/unblock-all', requireAdmin, (req, res) => {
  const count = ddos.blocked.size;
  ddos.blocked.clear();
  ddos.strikes.clear();
  console.log(`[DDOS] Admin unblocked ALL IPs (${count} total)`);
  res.json({ success: true, message: `${count} IP berhasil di-unblock` });
});

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
    SELECT s.room_id, r.key_name_1, r.key_name_2, r.key_name_3, r.provider_key_name
    FROM subscriptions s
    JOIN rooms r ON s.room_id = r.id
    WHERE s.user_id = $1 AND s.status = 'active' AND s.expired_at > NOW() AND s.room_id IS NOT NULL
  `, [userId]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const room = result.rows[0];
  const keys = getFreepikKeysForRoom(room.room_id, room);
  
  if (keys.length === 0) {
    return process.env[room.provider_key_name] || process.env.FREEPIK_API_KEY;
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
  const keys = getFreepikKeysForRoom(roomId, room);
  
  if (keys.length === 0) {
    return process.env[room.provider_key_name] || process.env.FREEPIK_API_KEY;
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

// Cleanup is started after database initialization (see initDatabase().then())

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
    
    const roomsResult = await pool.query('SELECT id, max_users FROM motion_rooms ORDER BY id');
    const usage = {};
    const maxUsers = {};
    roomsResult.rows.forEach(r => {
      usage[r.id] = 0;
      maxUsers[r.id] = r.max_users;
    });
    if (Object.keys(usage).length === 0) {
      for (let i = 1; i <= 5; i++) { usage[i] = 0; maxUsers[i] = 100; }
    }
    result.rows.forEach(row => {
      if (row.room_id && usage.hasOwnProperty(row.room_id)) {
        usage[row.room_id] = parseInt(row.active_users) || 0;
      }
    });
    
    res.json({ usage, maxUsers });
  } catch (error) {
    console.error('Get motion room usage error:', error);
    res.json({ usage: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
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
  const keys = getMotionRoomKeys(room.motion_room_id);
  [room.key_name_1, room.key_name_2, room.key_name_3].forEach(k => {
    if (k && process.env[k] && !keys.some(x => x.key === process.env[k])) {
      keys.push({ key: process.env[k], name: k, roomId: room.motion_room_id });
    }
  });
  
  if (keys.length === 0) {
    return { error: 'Motion room tidak memiliki API key yang valid' };
  }
  
  const picked = keys[Math.floor(Math.random() * keys.length)];
  return { 
    apiKey: picked.key, 
    keyName: picked.name,
    roomId: room.motion_room_id
  };
}

// ============ VIDGEN3 (Yunwu AI Video Generation) API ============

const VIDGEN3_MODEL_CONFIGS = {
  'grok-15s': {
    yunwuModel: 'grok-video-3',
    type: 'grok',
    duration: 15,
    label: 'Grok 15s',
    buildBody: (params) => {
      const arMap = {'16:9':'3:2','9:16':'2:3','1:1':'1:1','4:3':'3:2','3:4':'2:3','3:2':'3:2','2:3':'2:3','portrait':'2:3','landscape':'3:2'};
      const body = {
        model: 'grok-video-3',
        prompt: params.prompt || '',
        aspect_ratio: arMap[params.aspectRatio] || '3:2',
        size: '720P',
        duration: 15
      };
      if (params.image) body.images = [params.image];
      return body;
    }
  },
  'grok-10s': {
    yunwuModel: 'grok-video-3',
    type: 'grok',
    duration: 10,
    label: 'Grok 10s',
    buildBody: (params) => {
      const arMap = {'16:9':'3:2','9:16':'2:3','1:1':'1:1','4:3':'3:2','3:4':'2:3','3:2':'3:2','2:3':'2:3','portrait':'2:3','landscape':'3:2'};
      const body = {
        model: 'grok-video-3',
        prompt: params.prompt || '',
        aspect_ratio: arMap[params.aspectRatio] || '3:2',
        size: '720P',
        duration: 10
      };
      if (params.image) body.images = [params.image];
      return body;
    }
  },
  'sora-2-pro': {
    yunwuModel: 'sora-2-pro',
    type: 'text2video',
    duration: 15,
    label: 'Sora 2 Pro',
    buildBody: (params) => ({
      images: params.image ? [params.image] : [],
      model: 'sora-2-pro',
      orientation: (params.aspectRatio === 'portrait' || params.aspectRatio === '9:16') ? 'portrait' : 'landscape',
      prompt: params.prompt || '',
      size: 'large',
      duration: 15,
      watermark: false,
      private: true
    })
  },
  'veo3.1-fast-4k': {
    yunwuModel: 'veo3.1-fast',
    type: 'text2video',
    useReferenceImages: true,
    label: 'Veo 3.1 Fast 4K',
    buildBody: (params) => ({
      model: 'veo3.1-fast',
      prompt: params.prompt || '',
      aspect_ratio: (params.aspectRatio === 'portrait' || params.aspectRatio === '9:16') ? '9:16' : '16:9',
      enable_upsample: true,
      enhance_prompt: true
    })
  },
  'veo3.1-4k': {
    yunwuModel: 'veo3.1-4k',
    type: 'text2video',
    useReferenceImages: true,
    label: 'Veo 3.1 4K',
    buildBody: (params) => ({
      model: 'veo3.1-4k',
      prompt: params.prompt || '',
      aspect_ratio: (params.aspectRatio === 'portrait' || params.aspectRatio === '9:16') ? '9:16' : '16:9',
      enable_upsample: true,
      enhance_prompt: true
    })
  },
};

const YUNWU_API_BASE = 'https://yunwu.ai/v1';
const YUNWU_API_FALLBACK_BASES = [];

function yunwuHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
}

async function makeYunwuRequest(method, url, apiKey, body = null, timeoutMs = 120000) {
  const config = {
    method,
    url,
    headers: yunwuHeaders(apiKey),
    timeout: timeoutMs
  };
  if (body) config.data = body;
  
  try {
    return await axios(config);
  } catch (err) {
    const isTimeout = err.code === 'ECONNABORTED' || (err.message || '').includes('timeout');
    const isConnErr = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND';
    if ((isTimeout || isConnErr) && YUNWU_API_FALLBACK_BASES.length > 0) {
      for (const fallbackBase of YUNWU_API_FALLBACK_BASES) {
        const fallbackUrl = url.replace(YUNWU_API_BASE, fallbackBase);
        if (fallbackUrl === url) continue;
        try {
          console.log(`[YUNWU] Primary ${url} failed (${isTimeout ? 'timeout' : err.code}), trying fallback: ${fallbackUrl}`);
          return await axios({ ...config, url: fallbackUrl });
        } catch (fbErr) {
          console.warn(`[YUNWU] Fallback ${fallbackUrl} also failed: ${fbErr.code || fbErr.message}`);
        }
      }
    }
    throw err;
  }
}

// ============ VIDGEN2 (Poyo AI) ============

async function getVidgen2RoomApiKey(xclipApiKey) {
  const keyInfo = await validateXclipApiKey(xclipApiKey);
  if (!keyInfo) {
    return { error: 'Xclip API key tidak valid' };
  }
  
  const subResult = await pool.query(`
    SELECT s.vidgen2_room_id 
    FROM subscriptions s 
    WHERE s.user_id = $1 AND s.status = 'active' 
    AND (s.expired_at IS NULL OR s.expired_at > NOW())
    ORDER BY s.created_at DESC LIMIT 1
  `, [keyInfo.user_id]);
  
  const vidgen2RoomId = subResult.rows[0]?.vidgen2_room_id || 1;
  
  const roomKeyPrefix = `VIDGEN2_ROOM${vidgen2RoomId}_KEY_`;
  const availableKeys = [1, 2, 3].map(i => `${roomKeyPrefix}${i}`).filter(k => process.env[k]);
  
  if (availableKeys.length === 0) {
    if (process.env.APIMODELS_API_KEY) {
      return { 
        apiKey: process.env.APIMODELS_API_KEY, 
        keyName: 'APIMODELS_API_KEY',
        roomId: vidgen2RoomId,
        userId: keyInfo.user_id,
        keyInfoId: keyInfo.id
      };
    }
    return { error: 'Tidak ada API key Vidgen2 yang tersedia. Hubungi admin.' };
  }
  
  const randomKeyName = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  return { 
    apiKey: process.env[randomKeyName], 
    keyName: randomKeyName,
    roomId: vidgen2RoomId,
    userId: keyInfo.user_id,
    keyInfoId: keyInfo.id
  };
}

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

app.post('/api/vidgen2/join-room', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    const { roomId } = req.body;
    const targetRoom = roomId || 1;
    
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
    
    await pool.query(`
      UPDATE subscriptions SET vidgen2_room_id = $1
      WHERE user_id = $2 AND status = 'active'
    `, [targetRoom, req.session.userId]);
    
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

app.post('/api/vidgen2/generate', async (req, res) => {
  try {
    console.log('[VIDGEN2] Generate request received');
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const roomKeyResult = await getVidgen2RoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      console.log('[VIDGEN2] Room key error:', roomKeyResult.error);
      return res.status(400).json({ error: roomKeyResult.error });
    }
    console.log('[VIDGEN2] Got room API key:', roomKeyResult.keyName);
    
    const vidgen2Cooldown = getUserCooldownRemaining(roomKeyResult.userId, 'vidgen2');
    if (vidgen2Cooldown > 0) {
      const cooldownSec = Math.ceil(vidgen2Cooldown / 1000);
      return res.status(429).json({
        error: `Mohon tunggu ${cooldownSec} detik sebelum generate video berikutnya`,
        cooldown: cooldownSec,
        cooldownMs: vidgen2Cooldown
      });
    }
    
    const { model, prompt, image, startFrame, endFrame, referenceImage,
            generationType, aspectRatio, duration, resolution, enableGif,
            watermark, style, storyboard } = req.body;
    
    if (!prompt && !image) {
      return res.status(400).json({ error: 'Prompt atau image diperlukan' });
    }
    
    const modelConfig = {
      'grok-video-3-10s': { 
        apiModel: 'grok-video-3-10s', 
        supportedDurations: [10],
        defaultDuration: 10,
        supportedResolutions: ['720P'],
        defaultResolution: '720P',
        type: 'grok',
        desc: 'Grok 3 (10s) 720P Audio+Video'
      },
      'veo-3.1-fast': { 
        apiModel: 'veo-3.1-fast', 
        supportedDurations: [5, 8],
        defaultDuration: 8,
        supportedResolutions: ['4K'],
        defaultResolution: '4K',
        type: 'veo',
        desc: 'Veo 3.1 Fast 4K'
      },
      'veo-3.1': { 
        apiModel: 'veo-3.1', 
        supportedDurations: [5, 8],
        defaultDuration: 8,
        supportedResolutions: ['4K'],
        defaultResolution: '4K',
        type: 'veo',
        desc: 'Veo 3.1 4K'
      },
      'vidu-q3-turbo': {
        apiModel: 'vidu-q3-turbo',
        supportedDurations: [4, 8, 10],
        defaultDuration: 8,
        supportedResolutions: ['720P', '1080P'],
        defaultResolution: '1080P',
        type: 'vidu',
        desc: 'Vidu Q3 Turbo'
      },
      'kling-v3': {
        apiModel: 'kling-v3',
        supportedDurations: [5, 10, 15],
        defaultDuration: 10,
        supportedResolutions: ['720P', '1080P'],
        defaultResolution: '1080P',
        type: 'kling',
        desc: 'Kling V3'
      }
    };
    
    const config = modelConfig[model];
    if (!config) {
      return res.status(400).json({ error: 'Model tidak valid' });
    }
    
    const videoDuration = config.supportedDurations.includes(duration) ? duration : config.defaultDuration;
    const videoResolution = config.supportedResolutions.includes(resolution) ? resolution : config.defaultResolution;
    const videoAspectRatio = aspectRatio || '16:9';
    
    console.log(`[VIDGEN2] Generating with ApiModels model: ${config.apiModel}, duration: ${videoDuration}s, resolution: ${videoResolution}, aspect: ${videoAspectRatio}`);
    
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const isKlingModel = config.type === 'kling';

    const imageUrls = [];
    if (image) {
      let imageUrl = image;
      if (image.startsWith('data:')) {
        const imageFile = await saveBase64ToFile(image, 'image', baseUrl);
        imageUrl = imageFile.publicUrl;
        console.log(`[VIDGEN2] Image uploaded: ${imageUrl}`);
      }
      imageUrls.push(imageUrl);
    }
    if (startFrame) {
      let startUrl = startFrame;
      if (startFrame.startsWith('data:')) {
        const sf = await saveBase64ToFile(startFrame, 'image', baseUrl);
        startUrl = sf.publicUrl;
        console.log(`[VIDGEN2] Start frame uploaded: ${startUrl}`);
      }
      imageUrls.push(startUrl);
    }
    if (endFrame) {
      let endUrl = endFrame;
      if (endFrame.startsWith('data:')) {
        const ef = await saveBase64ToFile(endFrame, 'image', baseUrl);
        endUrl = ef.publicUrl;
        console.log(`[VIDGEN2] End frame uploaded: ${endUrl}`);
      }
      imageUrls.push(endUrl);
    }

    const requestBody = {
      model: config.apiModel,
      prompt: prompt || 'Generate a cinematic video with smooth motion',
      aspect_ratio: videoAspectRatio,
      duration: videoDuration
    };

    if (isKlingModel) {
      requestBody.mode = videoResolution === '1080P' ? 'pro' : 'std';
      requestBody.sound = 'on';
      requestBody.cfg_scale = 0.9;
      requestBody.negative_prompt = 'blur, distort, low quality, change face, different person, different character';
      if (imageUrls.length > 0) {
        requestBody.image = imageUrls[0];
        console.log(`[VIDGEN2] Kling image URL: ${imageUrls[0]}`);
        if (imageUrls.length > 1) requestBody.image_tail = imageUrls[imageUrls.length - 1];
      }
    } else {
      requestBody.size = videoResolution;
      if (imageUrls.length > 0) {
        requestBody.images = imageUrls;
        if (generationType) requestBody.generation_type = generationType;
      }
    }

    const callbackBaseUrl = baseUrl.includes('localhost') ? null : baseUrl;
    if (callbackBaseUrl) {
      requestBody.callback_url = `${callbackBaseUrl}/api/vidgen2/callback`;
    }
    
    console.log(`[VIDGEN2] Request body:`, JSON.stringify({ ...requestBody, images: requestBody.images ? ['[IMAGE]'] : undefined, image: requestBody.image ? '[IMAGE_URL]' : undefined }));
    
    const response = await axios.post(
      'https://apimodels.app/api/v1/video/generations',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${roomKeyResult.apiKey}`
        },
        timeout: 60000
      }
    );
    
    console.log(`[VIDGEN2] ApiModels response:`, JSON.stringify(response.data));
    
    const taskId = response.data?.data?.taskId ||
                   response.data?.data?.[0]?.task_id ||
                   response.data?.data?.[0]?.taskId ||
                   response.data?.data?.task_id || 
                   response.data?.data?.id ||
                   response.data?.taskId ||
                   response.data?.task_id || 
                   response.data?.id;
    
    if (!taskId) {
      console.error('[VIDGEN2] No task ID in response:', response.data);
      return res.status(500).json({ error: 'Tidak mendapat task ID dari ApiModels' });
    }
    
    await pool.query(`
      INSERT INTO vidgen2_tasks (xclip_api_key_id, user_id, room_id, task_id, model, prompt, used_key_name, status, metadata, api_key_used)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
    `, [roomKeyResult.keyInfoId, roomKeyResult.userId, roomKeyResult.roomId, taskId, model, prompt, roomKeyResult.keyName,
        JSON.stringify({ duration: videoDuration, aspectRatio: videoAspectRatio, resolution: videoResolution, style: style || null }),
        roomKeyResult.apiKey]);
    
    await pool.query(
      'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [roomKeyResult.keyInfoId]
    );
    
    setUserCooldown(roomKeyResult.userId, 'vidgen2');
    
    console.log(`[VIDGEN2] Task created: ${taskId}, key: ${roomKeyResult.apiKey.substring(0,10)}..., model: ${model}`);
    
    startServerBgPoll(taskId, 'apimodels', roomKeyResult.apiKey, {
      dbTable: 'vidgen2_tasks',
      urlColumn: 'video_url',
      model: model,
      userId: roomKeyResult.userId
    });
    
    res.json({
      success: true,
      taskId: taskId,
      model: model,
      cooldown: Math.ceil(RATE_LIMIT_CONFIG.vidgen2.cooldownMs / 1000),
      message: 'Video generation dimulai'
    });
    
  } catch (error) {
    console.error('[VIDGEN2] Generate error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: error.response?.data?.error?.message || error.response?.data?.message || 'Gagal generate video' 
    });
  }
});

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
    
    let pollApiKey = task.api_key_used;
    if (!pollApiKey) {
      const bgTask = serverBgPolls.get(taskId);
      if (bgTask) {
        pollApiKey = bgTask.apiKey;
      }
    }
    if (!pollApiKey) {
      const roomKeyResult = await getVidgen2RoomApiKey(xclipApiKey);
      if (!roomKeyResult.error) pollApiKey = roomKeyResult.apiKey;
    }
    
    if (pollApiKey) {
      try {
        console.log(`[VIDGEN2] Polling status for task: ${taskId} (key: ${pollApiKey.substring(0,10)}...)`);
        
        const statusResponse = await axios.get(
          `https://apimodels.app/api/v1/video/generations?task_id=${encodeURIComponent(taskId)}`,
          {
            headers: { 'Authorization': `Bearer ${pollApiKey}` },
            timeout: 30000
          }
        );
        
        console.log(`[VIDGEN2] Status response:`, JSON.stringify(statusResponse.data));
        
        const rawData = statusResponse.data;
        const data = rawData.data || rawData;
        const status = data.state || data.status;
        
        if (status === 'completed' || status === 'success') {
          let videoUrl = null;
          if (data.videos && data.videos.length > 0) {
            videoUrl = data.videos[0];
          } else if (data.resultUrls && data.resultUrls.length > 0) {
            videoUrl = data.resultUrls[0];
          } else if (data.video_url) {
            videoUrl = data.video_url;
          } else if (data.url) {
            videoUrl = data.url;
          } else if (data.thumbnailUrl) {
            videoUrl = data.thumbnailUrl;
          }
          
          if (videoUrl) {
            console.log(`[VIDGEN2] Video URL found: ${videoUrl}`);
            
            await pool.query(
              'UPDATE vidgen2_tasks SET status = $1, video_url = $2, completed_at = NOW() WHERE task_id = $3',
              ['completed', videoUrl, taskId]
            );
            
            if (serverBgPolls.has(taskId)) {
              serverBgPolls.delete(taskId);
              console.log(`[VIDGEN2] Removed bg poll for completed task ${taskId}`);
            }
            
            return res.json({
              status: 'completed',
              videoUrl: videoUrl,
              model: task.model
            });
          }
        }
        
        if (status === 'failed' || status === 'error') {
          const errorMsg = data.error?.message || data.error_message || data.message || 'Generation failed';
          console.log(`[VIDGEN2] Task failed: ${errorMsg}`);
          
          await pool.query(
            'UPDATE vidgen2_tasks SET status = $1, error_message = $2, completed_at = NOW() WHERE task_id = $3',
            ['failed', errorMsg, taskId]
          );
          
          if (serverBgPolls.has(taskId)) {
            serverBgPolls.delete(taskId);
            console.log(`[VIDGEN2] Removed bg poll for failed task ${taskId}`);
          }
          
          return res.json({
            status: 'failed',
            error: errorMsg
          });
        }
        
        const progress = data.progress || 0;
        return res.json({
          status: 'processing',
          progress: progress,
          message: status === 'processing' ? 'Video sedang diproses...' : 'Menunggu antrian...'
        });
        
      } catch (pollError) {
        console.error('[VIDGEN2] Poll error:', pollError.response?.data || pollError.message);
      }
    }
    
    res.json({
      status: 'pending',
      message: 'Menunggu status dari ApiModels...'
    });
    
  } catch (error) {
    console.error('[VIDGEN2] Task status error:', error.message);
    res.status(500).json({ error: 'Gagal cek status task' });
  }
});

app.post('/api/vidgen2/callback', async (req, res) => {
  try {
    const rawBody = req.body;
    const data = rawBody.data || rawBody;
    const taskId = data.task_id || rawBody.task_id || data.taskId || rawBody.taskId;
    console.log(`[VIDGEN2-CALLBACK] Received callback for task: ${taskId}`, JSON.stringify(rawBody).substring(0, 800));
    
    if (!taskId) {
      console.log(`[VIDGEN2-CALLBACK] No task_id found in callback. Full body keys:`, Object.keys(rawBody), 'data keys:', Object.keys(data));
      return res.json({ received: true });
    }

    // Lookup user_id from vidgen2_tasks
    let userId = null;
    try {
      const taskRow = await pool.query(`SELECT user_id FROM vidgen2_tasks WHERE task_id = $1 LIMIT 1`, [taskId]);
      if (taskRow.rows.length > 0) userId = taskRow.rows[0].user_id;
    } catch (e) {
      console.error(`[VIDGEN2-CALLBACK] DB lookup error:`, e.message);
    }
    
    const status = data.state || data.status;
    
    if (status === 'completed') {
      let videoUrl = null;
      if (data.videos && data.videos.length > 0) {
        videoUrl = data.videos[0];
      } else if (data.resultUrls && data.resultUrls.length > 0) {
        videoUrl = data.resultUrls[0];
      } else if (data.video_url) {
        videoUrl = data.video_url;
      } else if (data.url) {
        videoUrl = data.url;
      } else if (data.thumbnailUrl) {
        videoUrl = data.thumbnailUrl;
      }
      
      console.log(`[VIDGEN2-CALLBACK] Task ${taskId} COMPLETED, URL: ${videoUrl}`);
      
      if (videoUrl) {
        try {
          await pool.query(
            `UPDATE vidgen2_tasks SET status = 'completed', video_url = $1, completed_at = NOW() WHERE task_id = $2`,
            [videoUrl, taskId]
          );
        } catch (dbErr) {
          console.error(`[VIDGEN2-CALLBACK] DB update error:`, dbErr.message);
        }
      }
      
      if (serverBgPolls.has(taskId)) {
        serverBgPolls.delete(taskId);
        console.log(`[VIDGEN2-CALLBACK] Removed task ${taskId} from bg polling`);
      }

      if (userId) {
        sendSSEToUser(userId, {
          type: 'vidgen2_completed',
          taskId: taskId,
          videoUrl: videoUrl,
          source: 'vidgen2'
        });
      }
      
    } else if (status === 'failed') {
      const error = data.error || 'Generation failed';
      console.log(`[VIDGEN2-CALLBACK] Task ${taskId} FAILED: ${error}`);
      
      try {
        await pool.query(
          `UPDATE vidgen2_tasks SET status = 'failed', completed_at = NOW() WHERE task_id = $1`,
          [taskId]
        );
      } catch (dbErr) {
        console.error(`[VIDGEN2-CALLBACK] DB update error:`, dbErr.message);
      }
      
      if (serverBgPolls.has(taskId)) {
        serverBgPolls.delete(taskId);
      }

      if (userId) {
        sendSSEToUser(userId, {
          type: 'vidgen2_failed',
          taskId: taskId,
          error: error,
          source: 'vidgen2'
        });
      }
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('[VIDGEN2-CALLBACK] Error:', error.message);
    res.status(500).json({ error: 'Callback processing failed' });
  }
});

app.get('/api/vidgen2/history', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    const result = await pool.query(
      `SELECT task_id, model, prompt, status, video_url, created_at, completed_at 
       FROM vidgen2_tasks 
       WHERE user_id = $1 AND status = 'completed' AND video_url IS NOT NULL
       ORDER BY completed_at DESC LIMIT 20`,
      [keyInfo.user_id]
    );
    
    res.json({ videos: result.rows });
  } catch (error) {
    console.error('[VIDGEN2] History error:', error.message);
    res.status(500).json({ error: 'Gagal load history' });
  }
});

app.get('/api/vidgen2/proxy-video', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'] || req.query.key;
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }

    const videoUrl = req.query.url;
    if (!videoUrl) {
      return res.status(400).json({ error: 'URL diperlukan' });
    }

    const allowedDomains = ['apimodels.app', 'cdn.apimodels.app', 'poyo.ai', 'cdn.poyo.ai', 'storage.googleapis.com', 'replicate.delivery', 'pbxt.replicate.delivery', 'fal.media', 'v3.fal.media'];
    try {
      const parsed = new URL(videoUrl);
      if (!allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
        return res.status(400).json({ error: 'URL video tidak diizinkan' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'URL video tidak valid' });
    }

    const ownerCheck = await pool.query(
      'SELECT task_id FROM vidgen2_tasks WHERE user_id = $1 AND video_url = $2 LIMIT 1',
      [keyInfo.user_id, videoUrl]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Video bukan milik Anda' });
    }
    
    const response = await axios.get(videoUrl, {
      responseType: 'stream',
      timeout: 600000
    });
    
    const contentType = response.headers['content-type'] || 'video/mp4';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    
    response.data.pipe(res);
  } catch (error) {
    console.error('[VIDGEN2] Video proxy error:', error.message);
    res.status(500).json({ error: 'Gagal memuat video' });
  }
});

app.get('/api/vidgen2/download', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'] || req.query.key;
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }

    const videoUrl = req.query.url;
    if (!videoUrl) {
      return res.status(400).json({ error: 'URL diperlukan' });
    }

    const allowedDomains = ['apimodels.app', 'cdn.apimodels.app', 'poyo.ai', 'cdn.poyo.ai', 'storage.googleapis.com', 'replicate.delivery', 'pbxt.replicate.delivery', 'fal.media', 'v3.fal.media'];
    try {
      const parsed = new URL(videoUrl);
      if (!allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
        return res.status(400).json({ error: 'URL video tidak diizinkan' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'URL video tidak valid' });
    }

    const ownerCheck = await pool.query(
      'SELECT task_id FROM vidgen2_tasks WHERE user_id = $1 AND video_url = $2 LIMIT 1',
      [keyInfo.user_id, videoUrl]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Video bukan milik Anda' });
    }
    
    const response = await axios.get(videoUrl, {
      responseType: 'stream',
      timeout: 600000
    });
    
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="vidgen2_video.mp4"');
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    
    response.data.pipe(res);
  } catch (error) {
    console.error('[VIDGEN2] Download proxy error:', error.message);
    res.status(500).json({ error: 'Gagal download video' });
  }
});

app.delete('/api/vidgen2/history/:taskId', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    const { taskId } = req.params;
    const result = await pool.query(
      'DELETE FROM vidgen2_tasks WHERE task_id = $1 AND user_id = $2',
      [taskId, keyInfo.user_id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Video tidak ditemukan' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('[VIDGEN2] Delete error:', error.message);
    res.status(500).json({ error: 'Gagal hapus video' });
  }
});

app.delete('/api/vidgen2/history', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    await pool.query(
      'DELETE FROM vidgen2_tasks WHERE user_id = $1',
      [keyInfo.user_id]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[VIDGEN2] Clear history error:', error.message);
    res.status(500).json({ error: 'Gagal hapus semua history' });
  }
});

// ============ VIDGEN4 (Apimart.ai) ============

async function getVidgen4RoomApiKey(xclipApiKey) {
  const keyInfo = await validateXclipApiKey(xclipApiKey);
  if (!keyInfo) {
    return { error: 'Xclip API key tidak valid' };
  }
  
  const subResult = await pool.query(`
    SELECT s.vidgen4_room_id 
    FROM subscriptions s 
    WHERE s.user_id = $1 AND s.status = 'active' 
    AND (s.expired_at IS NULL OR s.expired_at > NOW())
    ORDER BY s.created_at DESC LIMIT 1
  `, [keyInfo.user_id]);
  
  const vidgen4RoomId = subResult.rows[0]?.vidgen4_room_id || 1;
  
  const roomKeyPrefix = `VIDGEN4_ROOM${vidgen4RoomId}_KEY_`;
  const availableKeys = [1, 2, 3].map(i => `${roomKeyPrefix}${i}`).filter(k => process.env[k]);
  
  if (availableKeys.length === 0) {
    if (process.env.APIMART_API_KEY) {
      return { 
        apiKey: process.env.APIMART_API_KEY, 
        keyName: 'APIMART_API_KEY',
        roomId: vidgen4RoomId,
        userId: keyInfo.user_id,
        keyInfoId: keyInfo.id
      };
    }
    return { error: 'Tidak ada API key Vidgen4 yang tersedia. Hubungi admin.' };
  }
  
  const randomKeyName = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  return { 
    apiKey: process.env[randomKeyName], 
    keyName: randomKeyName,
    roomId: vidgen4RoomId,
    userId: keyInfo.user_id,
    keyInfoId: keyInfo.id
  };
}

// Get available Vidgen4 rooms
app.get('/api/vidgen4/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, max_users, active_users, status 
      FROM vidgen4_rooms 
      ORDER BY id
    `);
    res.json({ rooms: result.rows });
  } catch (error) {
    console.error('[VIDGEN4] Get rooms error:', error);
    res.status(500).json({ error: 'Gagal load rooms' });
  }
});

// Join Vidgen4 Room
app.post('/api/vidgen4/join-room', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    const { roomId } = req.body;
    const targetRoom = roomId || 1;
    
    const roomResult = await pool.query(
      'SELECT * FROM vidgen4_rooms WHERE id = $1',
      [targetRoom]
    );
    
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room tidak ditemukan' });
    }
    
    const room = roomResult.rows[0];
    if (room.status !== 'OPEN' || room.active_users >= room.max_users) {
      return res.status(400).json({ error: 'Room penuh atau tutup' });
    }
    
    await pool.query(`
      UPDATE subscriptions SET vidgen4_room_id = $1
      WHERE user_id = $2 AND status = 'active'
    `, [targetRoom, req.session.userId]);
    
    await pool.query(
      'UPDATE vidgen4_rooms SET active_users = active_users + 1 WHERE id = $1',
      [targetRoom]
    );
    
    res.json({ success: true, roomId: targetRoom, roomName: room.name });
  } catch (error) {
    console.error('[VIDGEN4] Join room error:', error);
    res.status(500).json({ error: 'Gagal join room' });
  }
});

// Generate video with Vidgen4 (Apimart.ai)
app.post('/api/vidgen4/generate', async (req, res) => {
  try {
    console.log('[VIDGEN4] Generate request received');
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const roomKeyResult = await getVidgen4RoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      console.log('[VIDGEN4] Room key error:', roomKeyResult.error);
      return res.status(400).json({ error: roomKeyResult.error });
    }
    console.log('[VIDGEN4] Got room API key:', roomKeyResult.keyName);
    
    const vidgen4Cooldown = getUserCooldownRemaining(roomKeyResult.userId, 'vidgen4');
    if (vidgen4Cooldown > 0) {
      const cooldownSec = Math.ceil(vidgen4Cooldown / 1000);
      return res.status(429).json({
        error: `Mohon tunggu ${cooldownSec} detik sebelum generate video berikutnya`,
        cooldown: cooldownSec,
        cooldownMs: vidgen4Cooldown
      });
    }
    
    const { model, prompt, image, startFrame, endFrame, referenceImage,
            generationType, aspectRatio, duration, resolution, enableGif,
            watermark, thumbnail, isPrivate, style, storyboard } = req.body;
    
    if (!prompt && !image && !startFrame && !referenceImage) {
      return res.status(400).json({ error: 'Prompt atau image diperlukan' });
    }
    
    // Model config for Apimart.ai
    const modelConfig = {
      'sora-2-vip': { 
        apiModel: 'sora-2-vip', 
        supportedDurations: [10, 15],
        defaultDuration: 10,
        supportedResolutions: ['720p'],
        defaultResolution: '720p',
        type: 'sora',
        desc: 'Sora 2 VIP Premium'
      },
      'veo3.1-fast': { 
        apiModel: 'veo3.1-fast', 
        supportedDurations: [8],
        defaultDuration: 8,
        supportedResolutions: ['720p', '1080p'],
        defaultResolution: '720p',
        type: 'veo',
        desc: 'Veo 3.1 Fast max 1080p'
      },
      'grok-video': {
        apiModel: 'grok-imagine-1.0-video-apimart',
        supportedDurations: [6, 10],
        defaultDuration: 6,
        supportedResolutions: ['480p', '720p'],
        defaultResolution: '480p',
        type: 'grok',
        desc: 'Grok Imagine Video'
      }
    };
    
    const config = modelConfig[model];
    if (!config) {
      return res.status(400).json({ error: 'Model tidak valid' });
    }
    
    const videoDuration = config.supportedDurations.includes(duration) ? duration : config.defaultDuration;
    const videoResolution = config.supportedResolutions.includes(resolution) ? resolution : config.defaultResolution;
    const videoAspectRatio = aspectRatio || '16:9';
    
    console.log(`[VIDGEN4] Generating with Apimart.ai model: ${config.apiModel}, duration: ${videoDuration}s, resolution: ${videoResolution}, aspect: ${videoAspectRatio}`);
    
    // Build Apimart.ai request body
    const requestBody = {
      model: config.apiModel,
      prompt: prompt || 'Generate a cinematic video with smooth motion',
      duration: videoDuration,
      aspect_ratio: videoAspectRatio
    };
    
    // Model-specific playground parameters
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    if (config.type === 'sora') {
      // Sora 2 - official API: prompt, duration, aspect_ratio, image_urls
      if (watermark !== undefined) requestBody.watermark = watermark;
      if (thumbnail !== undefined) requestBody.thumbnail = thumbnail;
      if (isPrivate !== undefined) requestBody.private = isPrivate;
      if (style && style !== 'none') requestBody.style = style;
      if (storyboard !== undefined) requestBody.storyboard = storyboard;
      
      if (image) {
        let imageUrl = image;
        if (image.startsWith('data:')) {
          const imageFile = await saveBase64ToFile(image, 'image', baseUrl);
          imageUrl = imageFile.publicUrl;
          console.log(`[VIDGEN4] Sora image uploaded: ${imageUrl}`);
        }
        requestBody.image_urls = [imageUrl];
        const soraConsistency = '[CHARACTER LOCK] Reproduce the person from the reference image with pixel-perfect accuracy. Preserve exact clothing: same fabric texture, same pattern, same decorative elements (bows, buttons, embroidery, prints), same colors, same fit and silhouette. Preserve exact face, hair, accessories, glasses, jewelry. Zero deviation allowed. ';
        requestBody.prompt = soraConsistency + requestBody.prompt;
        requestBody.negative_prompt = 'different clothes, outfit change, different fabric, different pattern, different texture, simplified clothing, abstract pattern, missing details, missing decorations, different buttons, different collar, wardrobe change, costume change, different face, different person, inconsistent appearance';
      }
    } else if (config.type === 'veo') {
      // Veo 3.1 Fast - official API: resolution, generation_type, image_urls (start/end frame), enable_gif
      requestBody.resolution = videoResolution;
      if (enableGif !== undefined) requestBody.enable_gif = enableGif;
      
      if (generationType === 'frame') {
        // Frame-to-video mode: image_urls[0] = start frame, image_urls[1] = end frame
        const frameUrls = [];
        if (startFrame) {
          let startUrl = startFrame;
          if (startFrame.startsWith('data:')) {
            const sf = await saveBase64ToFile(startFrame, 'image', baseUrl);
            startUrl = sf.publicUrl;
            console.log(`[VIDGEN4] Start frame uploaded: ${startUrl}`);
          }
          frameUrls.push(startUrl);
        }
        if (endFrame) {
          let endUrl = endFrame;
          if (endFrame.startsWith('data:')) {
            const ef = await saveBase64ToFile(endFrame, 'image', baseUrl);
            endUrl = ef.publicUrl;
            console.log(`[VIDGEN4] End frame uploaded: ${endUrl}`);
          }
          frameUrls.push(endUrl);
        }
        if (frameUrls.length > 0) {
          requestBody.image_urls = frameUrls;
          requestBody.generation_type = 'frame';
          const frameConsistency = '[EXACT FRAME PRESERVATION] Animate starting from the exact first frame provided. The person\'s clothing must remain pixel-identical throughout: preserve exact fabric texture, pattern details, decorative elements (bows, ribbons, buttons, embroidery), colors, and fit. Do not simplify, alter, or reinterpret any clothing detail. ';
          requestBody.prompt = frameConsistency + requestBody.prompt;
          requestBody.negative_prompt = 'different clothes, outfit change, different fabric, different pattern, different texture, simplified clothing, abstract pattern, missing decorative details, missing bows, missing buttons, wardrobe change, costume change, morphing clothes';
        }
      } else if (generationType === 'reference') {
        // Reference image mode - enhance prompt for character consistency
        const refImg = referenceImage || image;
        if (refImg) {
          let refUrl = refImg;
          if (refImg.startsWith('data:')) {
            const rf = await saveBase64ToFile(refImg, 'image', baseUrl);
            refUrl = rf.publicUrl;
            console.log(`[VIDGEN4] Reference image uploaded: ${refUrl}`);
          }
          requestBody.image_urls = [refUrl];
          requestBody.generation_type = 'reference';
          
          const consistencyBoost = '[STRICT VISUAL CLONE] Clone the exact person from the reference image with forensic-level accuracy. CLOTHING LOCK: Reproduce the exact same garment — same fabric weave/texture, same color shade, same pattern, same decorative elements (bows, ribbons, lace, buttons, embroidery, appliqués, pleats, ruffles), same collar style, same sleeve style, same fit/silhouette. Do NOT simplify, stylize, or reinterpret any clothing detail. APPEARANCE LOCK: Same face, same glasses, same hairstyle, same hair color, same skin tone, same jewelry/accessories. Every frame must show the identical outfit with zero variation. ';
          requestBody.prompt = consistencyBoost + requestBody.prompt;
          requestBody.negative_prompt = 'different clothes, outfit change, wardrobe change, different fabric, different texture, different pattern, simplified pattern, abstract pattern, plain fabric replacing detailed fabric, missing decorative details, missing bows, missing ribbons, missing buttons, missing embroidery, different collar, different sleeves, costume change, different hairstyle, different hair color, different face, different person, inconsistent appearance, morphing, transformation';
        }
      }
    } else if (config.type === 'grok') {
      requestBody.size = videoAspectRatio;
      requestBody.quality = videoResolution;
      delete requestBody.aspect_ratio;
      
      const refImg = image || referenceImage;
      if (refImg) {
        let refUrl = refImg;
        if (refImg.startsWith('data:')) {
          const rf = await saveBase64ToFile(refImg, 'image', baseUrl);
          refUrl = rf.publicUrl;
          console.log(`[VIDGEN4] Grok reference image uploaded: ${refUrl}`);
        }
        requestBody.image_urls = [refUrl];
        const grokConsistency = '[CHARACTER LOCK] Reproduce the exact person from the reference image. Preserve exact clothing: same fabric texture, same pattern, same decorative elements (bows, ribbons, buttons, embroidery), same colors, same fit. Preserve exact face, glasses, hairstyle, accessories. Do not simplify or alter any clothing detail. ';
        requestBody.prompt = grokConsistency + requestBody.prompt;
        requestBody.negative_prompt = 'different clothes, outfit change, different fabric, different pattern, different texture, simplified clothing, abstract pattern, missing decorative details, missing bows, missing buttons, wardrobe change, costume change, different face, different person';
      }
    }
    
    console.log(`[VIDGEN4] Request body:`, JSON.stringify({ ...requestBody, image_urls: requestBody.image_urls ? ['[IMAGE]'] : undefined }));
    
    const response = await axios.post(
      'https://api.apimart.ai/v1/videos/generations',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${roomKeyResult.apiKey}`
        },
        timeout: 600000
      }
    );
    
    console.log(`[VIDGEN4] Apimart.ai response:`, JSON.stringify(response.data));
    
    // Parse response: { code: 200, data: [{ status: "submitted", task_id: "..." }] }
    const taskId = response.data?.data?.[0]?.task_id || 
                   response.data?.data?.task_id || 
                   response.data?.task_id || 
                   response.data?.id;
    
    if (!taskId) {
      console.error('[VIDGEN4] No task ID in response:', response.data);
      return res.status(500).json({ error: 'Tidak mendapat task ID dari Apimart.ai' });
    }
    
    // Save task to database
    await pool.query(`
      INSERT INTO vidgen4_tasks (xclip_api_key_id, user_id, room_id, task_id, model, prompt, used_key_name, status, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
    `, [roomKeyResult.keyInfoId, roomKeyResult.userId, roomKeyResult.roomId, taskId, model, prompt, roomKeyResult.keyName, 
        JSON.stringify({ duration: videoDuration, aspectRatio: videoAspectRatio, style: style || null, watermark: !!watermark })]);
    
    // Update request count
    await pool.query(
      'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [roomKeyResult.keyInfoId]
    );
    
    setUserCooldown(roomKeyResult.userId, 'vidgen4');
    
    console.log(`[VIDGEN4] Task created: ${taskId}`);
    
    startServerBgPoll(taskId, 'apimart', roomKeyResult.apiKey, {
      dbTable: 'vidgen4_tasks',
      urlColumn: 'video_url',
      model: model,
      prompt: prompt,
      userId: roomKeyResult.userId
    });
    
    res.json({
      success: true,
      taskId: taskId,
      model: model,
      cooldown: Math.ceil(RATE_LIMIT_CONFIG.vidgen4.cooldownMs / 1000),
      message: 'Video generation dimulai'
    });
    
  } catch (error) {
    console.error('[VIDGEN4] Generate error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: error.response?.data?.error?.message || error.response?.data?.message || 'Gagal generate video' 
    });
  }
});

// Check Vidgen4 task status
app.get('/api/vidgen4/tasks/:taskId', async (req, res) => {
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
      'SELECT * FROM vidgen4_tasks WHERE task_id = $1 AND xclip_api_key_id = $2',
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
        model: task.model,
        prompt: task.prompt
      });
    }
    
    if (task.status === 'failed') {
      return res.json({
        status: 'failed',
        error: task.error_message || 'Video generation failed'
      });
    }
    
    // Poll Apimart.ai for status
    const roomKeyResult = await getVidgen4RoomApiKey(xclipApiKey);
    if (!roomKeyResult.error) {
      try {
        console.log(`[VIDGEN4] Polling status for task: ${taskId}`);
        
        const statusResponse = await axios.get(
          `https://api.apimart.ai/v1/tasks/${taskId}`,
          {
            headers: {
              'Authorization': `Bearer ${roomKeyResult.apiKey}`
            },
            timeout: 30000
          }
        );
        
        console.log(`[VIDGEN4] Status response:`, JSON.stringify(statusResponse.data));
        
        const rawData = statusResponse.data;
        const data = rawData.data || rawData;
        const status = data.status || data.state;
        
        if (status === 'completed' || status === 'finished' || status === 'success') {
          let videoUrl = data.result?.video?.url ||
                         data.result?.videos?.[0]?.url ||
                         data.result?.video_url ||
                         data.result?.url ||
                         data.result?.outputs?.[0]?.url ||
                         data.result?.outputs?.[0]?.video_url ||
                         data.result?.output?.url ||
                         data.result?.output?.video_url ||
                         data.video_url || 
                         data.url || 
                         data.output?.url ||
                         data.output?.video_url;
          
          if (Array.isArray(videoUrl)) videoUrl = videoUrl[0];
          if (videoUrl && typeof videoUrl === 'object') videoUrl = videoUrl.url || videoUrl.video_url || null;
          if (videoUrl && typeof videoUrl !== 'string') videoUrl = String(videoUrl);
          console.log(`[VIDGEN4] Status URL extracted: ${videoUrl ? videoUrl.substring(0,80) : 'NULL'}`);
          console.log(`[VIDGEN4] Data keys: ${JSON.stringify(Object.keys(data))}, result: ${JSON.stringify(data.result)?.substring(0,200)}`);
          
          if (videoUrl) {
            console.log(`[VIDGEN4] Video URL found: ${videoUrl}`);
            
            await pool.query(
              'UPDATE vidgen4_tasks SET status = $1, video_url = $2, completed_at = NOW() WHERE task_id = $3',
              ['completed', videoUrl, taskId]
            );
            
            return res.json({
              status: 'completed',
              videoUrl: videoUrl,
              model: task.model
            });
          }
        }
        
        if (status === 'failed' || status === 'error') {
          const errorMsg = data.error?.message || data.error_message || data.message || 'Generation failed';
          console.log(`[VIDGEN4] Task failed: ${errorMsg}`);
          
          await pool.query(
            'UPDATE vidgen4_tasks SET status = $1, error_message = $2, completed_at = NOW() WHERE task_id = $3',
            ['failed', errorMsg, taskId]
          );
          
          return res.json({
            status: 'failed',
            error: errorMsg
          });
        }
        
        // Still processing
        const progress = data.progress || 0;
        return res.json({
          status: 'processing',
          progress: progress,
          message: status === 'processing' ? 'Video sedang diproses...' : 'Menunggu antrian...'
        });
        
      } catch (pollError) {
        console.error('[VIDGEN4] Poll error:', pollError.response?.data || pollError.message);
      }
    }
    
    res.json({
      status: 'pending',
      message: 'Menunggu status dari Apimart.ai...'
    });
    
  } catch (error) {
    console.error('[VIDGEN4] Task status error:', error.message);
    res.status(500).json({ error: 'Gagal cek status task' });
  }
});

// Get Vidgen4 video history
app.get('/api/vidgen4/history', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    const result = await pool.query(
      `SELECT task_id, model, prompt, status, video_url, created_at, completed_at 
       FROM vidgen4_tasks 
       WHERE user_id = $1 AND status = 'completed' AND video_url IS NOT NULL
       ORDER BY completed_at DESC LIMIT 20`,
      [keyInfo.user_id]
    );
    
    res.json({ videos: result.rows });
  } catch (error) {
    console.error('[VIDGEN4] History error:', error.message);
    res.status(500).json({ error: 'Gagal load history' });
  }
});

app.get('/api/vidgen4/proxy-video', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'] || req.query.key;
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }

    const videoUrl = req.query.url;
    if (!videoUrl || videoUrl === 'null' || videoUrl === 'undefined') {
      return res.status(400).json({ error: 'URL video tidak valid' });
    }

    const allowedDomains = ['apimart.ai', 'cdn.apimart.ai', 'storage.googleapis.com', 'replicate.delivery', 'pbxt.replicate.delivery', 'fal.media', 'v3.fal.media'];
    try {
      const parsed = new URL(videoUrl);
      if (!allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
        return res.status(400).json({ error: 'URL video tidak diizinkan' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'URL video tidak valid' });
    }

    const ownerCheck = await pool.query(
      'SELECT task_id FROM vidgen4_tasks WHERE user_id = $1 AND video_url = $2 LIMIT 1',
      [keyInfo.user_id, videoUrl]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Video bukan milik Anda' });
    }
    
    console.log(`[VIDGEN4-PROXY] Redirecting to CDN for user ${keyInfo.user_id}: ${videoUrl.substring(0, 80)}`);
    return res.redirect(302, videoUrl);
  } catch (error) {
    console.error(`[VIDGEN4-PROXY] ERROR: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Gagal memuat video' });
    }
  }
});

app.get('/api/vidgen4/download', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'] || req.query.key;
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }

    const videoUrl = req.query.url;
    if (!videoUrl) {
      return res.status(400).json({ error: 'URL diperlukan' });
    }

    const allowedDomains = ['apimart.ai', 'cdn.apimart.ai', 'storage.googleapis.com', 'replicate.delivery', 'pbxt.replicate.delivery', 'fal.media', 'v3.fal.media'];
    try {
      const parsed = new URL(videoUrl);
      if (!allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
        return res.status(400).json({ error: 'URL video tidak diizinkan' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'URL video tidak valid' });
    }

    const ownerCheck = await pool.query(
      'SELECT task_id FROM vidgen4_tasks WHERE user_id = $1 AND video_url = $2 LIMIT 1',
      [keyInfo.user_id, videoUrl]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Video bukan milik Anda' });
    }
    
    const response = await axios.get(videoUrl, {
      responseType: 'stream',
      timeout: 600000
    });
    
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="vidgen4_video.mp4"');
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    
    response.data.pipe(res);
  } catch (error) {
    console.error('[VIDGEN4] Download proxy error:', error.message);
    res.status(500).json({ error: 'Gagal download video' });
  }
});

app.delete('/api/vidgen4/history/:taskId', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(401).json({ error: 'Xclip API key tidak valid' });
    }
    
    const { taskId } = req.params;
    const result = await pool.query(
      'DELETE FROM vidgen4_tasks WHERE task_id = $1 AND user_id = $2',
      [taskId, keyInfo.user_id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Video tidak ditemukan' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('[VIDGEN4] Delete error:', error.message);
    res.status(500).json({ error: 'Gagal hapus video' });
  }
});

// Get available Vidgen3 rooms
app.get('/api/vidgen3/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, max_users, active_users, status 
      FROM vidgen3_rooms 
      ORDER BY id
    `);
    res.json({ rooms: result.rows });
  } catch (error) {
    console.error('[VIDGEN3] Get rooms error:', error);
    res.status(500).json({ error: 'Gagal load rooms' });
  }
});

// Join Vidgen3 Room
app.post('/api/vidgen3/join-room', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    const { roomId } = req.body;
    const targetRoom = roomId || 1;
    
    const roomResult = await pool.query(
      'SELECT * FROM vidgen3_rooms WHERE id = $1',
      [targetRoom]
    );
    
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room tidak ditemukan' });
    }
    
    const room = roomResult.rows[0];
    if (room.status !== 'OPEN' || room.active_users >= room.max_users) {
      return res.status(400).json({ error: 'Room penuh atau tutup' });
    }
    
    await pool.query(`
      UPDATE subscriptions SET vidgen3_room_id = $1
      WHERE user_id = $2 AND status = 'active'
    `, [targetRoom, req.session.userId]);
    
    await pool.query(
      'UPDATE vidgen3_rooms SET active_users = active_users + 1 WHERE id = $1',
      [targetRoom]
    );
    
    res.json({ success: true, roomId: targetRoom, roomName: room.name });
  } catch (error) {
    console.error('[VIDGEN3] Join room error:', error);
    res.status(500).json({ error: 'Gagal join room' });
  }
});

async function getVidgen3RoomApiKey(xclipApiKey) {
  const keyInfo = await validateXclipApiKey(xclipApiKey);
  if (!keyInfo) return { error: 'Xclip API key tidak valid' };
  const subResult = await pool.query(`
    SELECT s.vidgen3_room_id FROM subscriptions s 
    WHERE s.user_id = $1 AND s.status = 'active' AND (s.expired_at IS NULL OR s.expired_at > NOW())
    ORDER BY s.created_at DESC LIMIT 1
  `, [keyInfo.user_id]);
  const vidgen3RoomId = subResult.rows[0]?.vidgen3_room_id || 1;
  const roomKeyPrefix = `VIDGEN3_ROOM${vidgen3RoomId}_KEY_`;
  const availableKeys = [1, 2, 3].map(i => `${roomKeyPrefix}${i}`).filter(k => process.env[k]);
  if (availableKeys.length === 0) {
    if (process.env.FREEPIK_API_KEY) return { apiKey: process.env.FREEPIK_API_KEY, keyName: 'FREEPIK_API_KEY', roomId: vidgen3RoomId, userId: keyInfo.user_id, keyInfoId: keyInfo.id };
    return { error: 'Tidak ada API key Vidgen3 yang tersedia. Hubungi admin.' };
  }
  const randomKeyName = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  return { apiKey: process.env[randomKeyName], keyName: randomKeyName, roomId: vidgen3RoomId, userId: keyInfo.user_id, keyInfoId: keyInfo.id };
}

// Generate video with Vidgen3 (Freepik)
app.post('/api/vidgen3/proxy', async (req, res) => {
  try {
    console.log('[VIDGEN3] Generate request received');
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      console.log('[VIDGEN3] No API key provided');
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    console.log('[VIDGEN3] Getting room API key...');
    const roomKeyResult = await getVidgen3RoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      console.log('[VIDGEN3] Room key error:', roomKeyResult.error);
      return res.status(400).json({ error: roomKeyResult.error });
    }
    console.log('[VIDGEN3] Got room API key:', roomKeyResult.keyName);
    
    const { model, prompt, image, videoUrl, resolution, aspectRatio } = req.body;
    
    const config = VIDGEN3_MODEL_CONFIGS[model];
    if (!config) {
      return res.status(400).json({ error: `Model tidak didukung: ${model}` });
    }
    
    if (!prompt && !image) {
      return res.status(400).json({ error: 'Prompt atau gambar referensi diperlukan' });
    }
    
    let imageUrlForApi = image;
    let imageBase64ForRef = null;
    let imageMimeType = 'image/jpeg';
    
    console.log(`[VIDGEN3] Image input: ${image ? (image.length > 200 ? image.substring(0, 100) + '...[' + image.length + ' chars]' : image) : 'NONE'}, model=${model}, useReferenceImages=${config.useReferenceImages}`);
    
    if (image && image.includes('base64')) {
      const b64Match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (b64Match) {
        imageMimeType = b64Match[1];
        imageBase64ForRef = b64Match[2];
      } else {
        imageBase64ForRef = image.replace(/^data:[^;]+;base64,/, '');
      }
      
      const v3protocol = req.headers['x-forwarded-proto'] || 'https';
      const v3host = req.headers['x-forwarded-host'] || req.headers.host;
      const v3baseUrl = `${v3protocol}://${v3host}`;
      const imgFile = await saveBase64ToFile(image, 'image', v3baseUrl);
      imageUrlForApi = imgFile.publicUrl;
      console.log(`[VIDGEN3] Image saved to public URL: ${imageUrlForApi}`);
    } else if (image) {
      try {
        const dlResp = await axios.get(image, { responseType: 'arraybuffer', timeout: 30000 });
        const buf = Buffer.from(dlResp.data);
        imageBase64ForRef = buf.toString('base64');
        imageMimeType = dlResp.headers['content-type'] || 'image/jpeg';
      } catch (dlErr) {
        console.warn(`[VIDGEN3] Could not download image for base64: ${dlErr.message}`);
      }
    }
    
    if (imageUrlForApi && !config.useReferenceImages) {
      if (config.type === 'grok') {
        try {
          const yunwuKey = process.env.YUNWU_API_KEY;
          if (yunwuKey) {
            console.log(`[VIDGEN3] Grok model: uploading image to Yunwu image host for China accessibility`);
            let imgBuffer;
            if (imageBase64ForRef) {
              imgBuffer = Buffer.from(imageBase64ForRef, 'base64');
            } else {
              const dlResp = await axios.get(imageUrlForApi, { responseType: 'arraybuffer', timeout: 30000 });
              imgBuffer = Buffer.from(dlResp.data);
            }
            const ext = (imageMimeType || '').includes('jpeg') || (imageMimeType || '').includes('jpg') ? 'jpg' : 'png';
            const yunwuImgUrl = await uploadToYunwuImageHost(imgBuffer, yunwuKey, `grok_ref.${ext}`);
            if (yunwuImgUrl) {
              console.log(`[VIDGEN3] Grok image uploaded to Yunwu host: ${yunwuImgUrl}`);
              imageUrlForApi = yunwuImgUrl;
            } else {
              console.warn(`[VIDGEN3] Yunwu image host returned null, trying catbox/0x0 fallback`);
              const cdnUrl = await reuploadToCDN(imageUrlForApi);
              if (cdnUrl) imageUrlForApi = cdnUrl;
            }
          }
        } catch (grokImgErr) {
          console.warn(`[VIDGEN3] Grok image upload failed: ${grokImgErr.message}, trying CDN fallback`);
          try {
            const cdnUrl = await reuploadToCDN(imageUrlForApi);
            if (cdnUrl) imageUrlForApi = cdnUrl;
          } catch (e) {}
        }
      } else {
        try {
          const cdnUrl = await reuploadToCDN(imageUrlForApi);
          if (cdnUrl) {
            console.log(`[VIDGEN3] Image re-uploaded to CDN: ${cdnUrl}`);
            imageUrlForApi = cdnUrl;
          }
        } catch (cdnErr) {
          console.warn(`[VIDGEN3] CDN re-upload failed, using original URL: ${cdnErr.message}`);
        }
      }
    }
    
    let videoUrlForApi = videoUrl;
    if (videoUrl && videoUrl.includes('base64')) {
      const v3protocol = req.headers['x-forwarded-proto'] || 'https';
      const v3host = req.headers['x-forwarded-host'] || req.headers.host;
      const v3baseUrl = `${v3protocol}://${v3host}`;
      const vidFile = await saveBase64ToFile(videoUrl, 'video', v3baseUrl);
      videoUrlForApi = vidFile.publicUrl;
      console.log(`[VIDGEN3] Video saved to public URL: ${videoUrlForApi}`);
    }
    
    const requestBody = config.buildBody({ prompt, image: imageUrlForApi, videoUrl: videoUrlForApi, resolution, aspectRatio });
    
    if (config.useReferenceImages && image) {
      if (imageBase64ForRef) {
        requestBody.reference_images = [{
          bytesBase64Encoded: imageBase64ForRef,
          mimeType: imageMimeType
        }];
        console.log(`[VIDGEN3] Using reference_images format (mimeType: ${imageMimeType}, size: ${imageBase64ForRef.length} chars)`);
      } else {
        console.error('[VIDGEN3] Failed to convert image to base64 for reference_images');
        return res.status(400).json({ error: 'Gagal memproses gambar referensi. Coba upload ulang.' });
      }
      if (imageUrlForApi) {
        try {
          let cdnUrl = imageUrlForApi;
          const cdnResult = await reuploadToCDN(imageUrlForApi);
          if (cdnResult) cdnUrl = cdnResult;
          requestBody.images = [cdnUrl];
          console.log(`[VIDGEN3] Also added images URL as fallback: ${cdnUrl}`);
        } catch (cdnErr) {
          requestBody.images = [imageUrlForApi];
          console.log(`[VIDGEN3] Also added images URL as fallback (no CDN): ${imageUrlForApi}`);
        }
      }
    } else if (!config.useReferenceImages && config.type !== 'grok' && imageUrlForApi) {
      if (!requestBody.images) {
        requestBody.images = [imageUrlForApi];
      }
    }
    
    const yunwuApiKey = process.env.YUNWU_API_KEY;
    if (!yunwuApiKey) {
      return res.status(500).json({ error: 'Yunwu API key belum dikonfigurasi' });
    }
    
    console.log(`[VIDGEN3] Generating with model: ${model} via Yunwu AI (${config.yunwuModel})`);
    console.log(`[VIDGEN3] Request body:`, JSON.stringify(requestBody));
    
    let response;
    let usedFormat = 'unified';
    
    let modelFallbacks;
    if (model === 'sora-2-pro') {
      modelFallbacks = [
        { modelName: 'sora-2-pro', format: 'unified' },
        { modelName: 'new-sora-2-pro', format: 'unified' },
        { modelName: 'sora-2-all', format: 'unified' },
        { modelName: 'sora-2-pro', format: 'openai' },
      ];
    } else if (model === 'veo3.1-fast-4k') {
      modelFallbacks = [
        { modelName: 'veo3.1-fast', format: 'unified' },
        { modelName: 'veo3.1', format: 'unified' },
        { modelName: 'veo3-fast', format: 'unified' },
        { modelName: 'veo_3_1', format: 'openai' },
      ];
    } else if (model === 'veo3.1-4k') {
      modelFallbacks = [
        { modelName: 'veo3.1-4k', format: 'unified' },
        { modelName: 'veo3.1', format: 'unified' },
        { modelName: 'veo3.1-fast', format: 'unified' },
        { modelName: 'veo_3_1', format: 'openai' },
      ];
    } else if (model === 'grok-15s' || model === 'grok-10s') {
      modelFallbacks = [
        { modelName: 'grok-video-3', format: 'grok' },
      ];
    } else {
      modelFallbacks = [{ modelName: config.yunwuModel, format: 'unified' }];
    }
    
    let fallbackIdx = 0;
    const isGrokRequest = config.type === 'grok';
    const maxRetries = isGrokRequest ? 2 : 6;
    
    function isSaturatedError(str) {
      return str.includes('upstream_saturated') || str.includes('No available channel') || str.includes('saturated') || str.includes('饱和') || str.includes('负载') || str.includes('上游');
    }
    
    async function tryOpenAIFormat(apiKey, modelName, params) {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('model', modelName);
      form.append('prompt', params.prompt || '');
      if (modelName.includes('veo')) {
        form.append('size', (params.aspectRatio === 'portrait' || params.aspectRatio === '9:16') ? '9x16' : '16x9');
        form.append('seconds', '8');
        form.append('watermark', 'false');
      } else {
        const isSoraPro = modelName.includes('sora-2-pro');
        if (params.aspectRatio === 'portrait' || params.aspectRatio === '9:16') {
          form.append('size', isSoraPro ? '1024x1792' : '720x1280');
        } else {
          form.append('size', isSoraPro ? '1792x1024' : '1280x720');
        }
        form.append('seconds', '15');
      }
      if (params.image) {
        try {
          const imgResp = await axios.get(params.image, { responseType: 'arraybuffer', timeout: 30000 });
          const imgBuf = Buffer.from(imgResp.data);
          const imgType = imgResp.headers['content-type'] || 'image/png';
          const imgExt = imgType.includes('jpeg') || imgType.includes('jpg') ? 'jpg' : 'png';
          form.append('input_reference', imgBuf, { filename: `ref.${imgExt}`, contentType: imgType });
        } catch (dlErr) {
          console.warn('[VIDGEN3] Could not download image for OpenAI format, sending URL:', dlErr.message);
          form.append('input_reference', params.image);
        }
      }
      const headers = {
        ...form.getHeaders(),
        'Authorization': `Bearer ${apiKey}`
      };
      return axios({
        method: 'POST',
        url: `${YUNWU_API_BASE}/videos`,
        headers,
        data: form,
        timeout: 300000
      });
    }
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const currentFallback = modelFallbacks[fallbackIdx];
      try {
        if (currentFallback.format === 'grok') {
          usedFormat = 'grok';
          const grokBody = { ...requestBody, model: currentFallback.modelName };
          console.log(`[VIDGEN3] Sending Grok request:`, JSON.stringify(grokBody));
          const grokStartTime = Date.now();
          const grokUrls = [
            `${YUNWU_API_BASE}/video/create`,
            ...YUNWU_API_FALLBACK_BASES.map(b => `${b}/video/create`)
          ];
          let grokSuccess = false;
          for (const grokUrl of grokUrls) {
            try {
              console.log(`[VIDGEN3] Trying Grok URL: ${grokUrl}`);
              response = await makeYunwuRequest('POST', grokUrl, yunwuApiKey, grokBody, 30000);
              console.log(`[VIDGEN3] Grok response from ${grokUrl} in ${Date.now() - grokStartTime}ms, status=${response.status}`);
              grokSuccess = true;
              break;
            } catch (grokUrlErr) {
              const isTimeout = grokUrlErr.code === 'ECONNABORTED' || (grokUrlErr.message || '').includes('timeout');
              const isConnErr = grokUrlErr.code === 'ECONNREFUSED' || grokUrlErr.code === 'ENOTFOUND';
              console.warn(`[VIDGEN3] Grok URL ${grokUrl} failed: ${isTimeout ? 'TIMEOUT(30s)' : grokUrlErr.response?.status || grokUrlErr.code || grokUrlErr.message}`);
              if (!isTimeout && !isConnErr) throw grokUrlErr;
            }
          }
          if (!grokSuccess) {
            throw new Error('Semua server Yunwu timeout untuk Grok. Model mungkin sedang maintenance.');
          }
        } else if (currentFallback.format === 'openai') {
          usedFormat = 'openai';
          response = await tryOpenAIFormat(yunwuApiKey, currentFallback.modelName, { prompt, image: imageUrlForApi, aspectRatio: requestBody.orientation || requestBody.aspect_ratio || aspectRatio });
        } else {
          usedFormat = 'unified';
          const body = { ...requestBody, model: currentFallback.modelName };
          const logBody = { ...body };
          if (logBody.reference_images) logBody.reference_images = `[${logBody.reference_images.length} items, base64 ${logBody.reference_images[0]?.bytesBase64Encoded?.length || 0} chars]`;
          console.log(`[VIDGEN3] Sending unified request:`, JSON.stringify(logBody));
          response = await makeYunwuRequest('POST', `${YUNWU_API_BASE}/video/create`, yunwuApiKey, body);
        }
        
        const respData = response.data || {};
        const respError = respData.error || '';
        const respStatus = (respData.status || '').toLowerCase();
        if (respStatus === 'error' || respError) {
          const errStr = typeof respError === 'string' ? respError : JSON.stringify(respError);
          const saturated = isSaturatedError(errStr);
          
          if (saturated && fallbackIdx < modelFallbacks.length - 1) {
            fallbackIdx++;
            const next = modelFallbacks[fallbackIdx];
            console.warn(`[VIDGEN3] Model ${currentFallback.modelName} (${currentFallback.format}) saturated → trying ${next.modelName} (${next.format})`);
            continue;
          }
          
          if ((saturated || errStr.includes('rate_limit')) && attempt < maxRetries) {
            const delay = attempt * 6000;
            console.warn(`[VIDGEN3] Yunwu API error: ${errStr}, retrying in ${delay/1000}s (attempt ${attempt}/${maxRetries})`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
        }
        
        break;
      } catch (retryErr) {
        const errMsg = retryErr.response?.data?.error?.message || retryErr.response?.data?.message || retryErr.response?.data?.error || retryErr.message || '';
        const errStr = typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg);
        const saturated = isSaturatedError(errStr);
        
        if (saturated && fallbackIdx < modelFallbacks.length - 1) {
          fallbackIdx++;
          const next = modelFallbacks[fallbackIdx];
          console.warn(`[VIDGEN3] Model ${currentFallback.modelName} (${currentFallback.format}) saturated → trying ${next.modelName} (${next.format})`);
          continue;
        }
        
        const isTimeout = retryErr.code === 'ECONNABORTED' || errStr.includes('timeout');
        const isRetryable = saturated || isTimeout || errStr.includes('rate_limit') || (retryErr.response?.status === 429) || (retryErr.response?.status === 503);
        if (isRetryable && attempt < maxRetries) {
          const delay = attempt * 6000;
          console.warn(`[VIDGEN3] Yunwu request error: ${errStr}, retrying in ${delay/1000}s (attempt ${attempt}/${maxRetries})`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw retryErr;
        }
      }
    }
    
    console.log(`[VIDGEN3] Yunwu response (format=${usedFormat}, model=${modelFallbacks[fallbackIdx]?.modelName}):`, JSON.stringify(response.data));
    
    const respData = response.data || {};
    if (respData.status === 'error' && respData.error) {
      console.error('[VIDGEN3] Yunwu API returned error after retries:', respData.error);
      return res.status(503).json({ error: 'Server video sedang sibuk, coba lagi dalam beberapa menit.' });
    }
    
    let taskId = respData.task_id || respData.request_id || respData.id;
    if (config.useChatCompletions && !taskId) {
      const content = respData.choices?.[0]?.message?.content || '';
      const idMatch = content.match(/task[_-][\w-]+/) || content.match(/video[_-][\w-]+/);
      if (idMatch) taskId = idMatch[0];
      if (!taskId && respData.id) taskId = respData.id;
    }
    
    if (!taskId) {
      console.error('[VIDGEN3] No task id in Yunwu response:', JSON.stringify(respData));
      return res.status(500).json({ error: 'Tidak mendapat task id dari Yunwu AI' });
    }
    
    await pool.query(`
      INSERT INTO vidgen3_tasks (xclip_api_key_id, user_id, room_id, task_id, model, prompt, used_key_name, status, original_params)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', $8)
    `, [roomKeyResult.keyInfoId, roomKeyResult.userId, roomKeyResult.roomId, taskId, model, prompt || '', roomKeyResult.keyName, JSON.stringify(requestBody)]);
    
    await pool.query(
      'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [roomKeyResult.keyInfoId]
    );
    
    console.log(`[VIDGEN3] Yunwu job created: ${taskId}`);
    
    res.json({
      taskId: taskId,
      model: model,
      status: 'processing',
      estimatedCost: response.data?.estimated_cost || null
    });
    
  } catch (error) {
    const errData = error.response?.data;
    const rawErr = errData?.error || errData?.message || error.message || 'Gagal generate video';
    const errStr = typeof rawErr === 'object' ? (rawErr.message || JSON.stringify(rawErr)) : String(rawErr);
    console.error('[VIDGEN3] Generate error:', errStr);
    
    const isChannelError = errStr.includes('No available channel') || errStr.includes('available channel');
    const statusCode = isChannelError ? 503 : (error.response?.status || 500);
    const userMsg = isChannelError 
      ? `Model ${model} sedang tidak tersedia di Yunwu. Coba lagi nanti atau gunakan model lain.`
      : errStr;
    
    res.status(statusCode).json({ error: userMsg });
  }
});

app.get('/api/vidgen3/tasks/:taskId', async (req, res) => {
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
    
    const localTask = await pool.query(
      'SELECT * FROM vidgen3_tasks WHERE task_id = $1 AND xclip_api_key_id = $2',
      [taskId, keyInfo.id]
    );
    
    if (localTask.rows.length === 0) {
      return res.status(404).json({ error: 'Task tidak ditemukan' });
    }
    
    const task = localTask.rows[0];
    
    if (task.status === 'completed' && task.video_url) {
      return res.json({
        status: 'completed',
        progress: 100,
        videoUrl: task.video_url,
        taskId: taskId,
        model: task.model
      });
    }
    
    if (task.status === 'failed') {
      return res.json({
        status: 'failed',
        error: task.error_message || 'Video generation failed',
        taskId: taskId
      });
    }
    
    const yunwuApiKey = process.env.YUNWU_API_KEY;
    if (!yunwuApiKey) {
      return res.status(500).json({ error: 'Yunwu API key belum dikonfigurasi' });
    }
    
    try {
      const isOpenAIFormatTask = taskId.startsWith('video_');
      
      const dbTask = await pool.query('SELECT model FROM vidgen3_tasks WHERE task_id = $1', [taskId]).catch(() => null);
      const taskModel = dbTask?.rows?.[0]?.model || '';
      const isGrokModel = taskModel.startsWith('grok-');
      
      let pollUrl;
      if (isOpenAIFormatTask) {
        pollUrl = `${YUNWU_API_BASE}/videos/${taskId}`;
      } else {
        pollUrl = `${YUNWU_API_BASE}/video/query?id=${taskId}`;
      }
      
      const pollResponse = await makeYunwuRequest(
        'GET',
        pollUrl,
        yunwuApiKey
      );
      
      console.log(`[VIDGEN3] Yunwu poll response:`, JSON.stringify(pollResponse.data));
      const data = pollResponse.data;
      const status = (data.status || '').toLowerCase();
      
      const detailStatus = (data.detail?.status || '').toLowerCase();
      const upsampleStatus = (data.detail?.upsample_status || '').toUpperCase();
      const isUpsampling = status === 'video_upsampling' || detailStatus === 'video_upsampling';
      const isUpsampleDone = upsampleStatus === 'MEDIA_GENERATION_STATUS_SUCCESSFUL' || upsampleStatus === 'MEDIA_GENERATION_STATUS_COMPLETED';
      
      const isCompleted = status === 'completed' || status === 'success' || status === 'done' || detailStatus === 'completed' 
        || (isUpsampling && isUpsampleDone)
        || (data.video_url && data.video_url !== null);
      
      if (isCompleted) {
        let videoUrl = data.video?.url || data.detail?.upsample_video_url || data.video_url || data.detail?.video_url || data.url || null;
        if (!videoUrl && isOpenAIFormatTask) {
          try {
            const dlResponse = await makeYunwuRequest('GET', `${YUNWU_API_BASE}/videos/${taskId}/content`, yunwuApiKey);
            videoUrl = dlResponse.data?.video_url || dlResponse.data?.url || dlResponse.request?.res?.responseUrl || null;
          } catch (dlErr) {
            console.warn('[VIDGEN3] Download endpoint failed:', dlErr.message);
          }
        }
        if (!videoUrl && data.final_result) {
          videoUrl = data.final_result.url || (data.final_result.urls && data.final_result.urls[0]) || null;
        }
        if (!videoUrl && data.data && data.data[0]) {
          videoUrl = data.data[0].url || null;
        }
        
        if (videoUrl) {
          pool.query(
            'UPDATE vidgen3_tasks SET status = $1, video_url = $2, completed_at = NOW() WHERE task_id = $3',
            ['completed', videoUrl, taskId]
          ).catch(e => console.error('[VIDGEN3] DB update error:', e));
          
          return res.json({
            status: 'completed',
            progress: 100,
            videoUrl: videoUrl,
            taskId: taskId,
            model: task.model,
            cost: data.cost || data.cost_usd || null
          });
        }
      }
      
      const hasErrorObj = data.error && (typeof data.error === 'object' ? data.error.message : data.error);
      if (status === 'failed' || detailStatus === 'failed' || (hasErrorObj && status !== 'completed' && status !== 'success' && status !== 'done' && status !== 'in_progress' && status !== 'queued' && status !== 'processing')) {
        const rawErr = data.error;
        const rawErrorMsg = (typeof rawErr === 'object' && rawErr?.message) ? rawErr.message : (rawErr || data.detail?.error_message || data.detail || data.message || 'Generation failed');
        const errorMsg = typeof rawErrorMsg === 'string' ? rawErrorMsg : JSON.stringify(rawErrorMsg);
        
        const isQueueTimeout = errorMsg.includes('请稍后重试') || errorMsg.includes('排队') || errorMsg.includes('queue') || errorMsg.includes('retry later') || errorMsg.includes('超时') || errorMsg.includes('重新发起请求') || errorMsg.includes('生成过程中出现异常') || errorMsg.includes('请重新');
        if (isQueueTimeout) {
          console.log(`[VIDGEN3] Queue timeout detected (${errorMsg}), auto-resubmitting...`);
          try {
            const retryTaskResult = await pool.query('SELECT * FROM vidgen3_tasks WHERE task_id = $1', [taskId]);
            const origTask = retryTaskResult.rows[0];
            if (origTask) {
              const retryCount = origTask.retry_count || 0;
              if (retryCount < 3) {
                const origModel = origTask.model;
                const origConfig = VIDGEN3_MODEL_CONFIGS[origModel];
                if (origConfig) {
                  let retryBody;
                  if (origTask.original_params) {
                    retryBody = typeof origTask.original_params === 'string' ? JSON.parse(origTask.original_params) : origTask.original_params;
                    retryBody.model = origConfig.yunwuModel;
                  } else {
                    retryBody = origConfig.buildBody({ prompt: origTask.prompt || '' });
                  }
                  const retryResponse = await makeYunwuRequest('POST', `${YUNWU_API_BASE}/video/create`, yunwuApiKey, retryBody);
                  const retryData = retryResponse.data;
                  const newTaskId = retryData?.request_id || retryData?.task_id || retryData?.id;
                  if (newTaskId) {
                    await pool.query(
                      `UPDATE vidgen3_tasks SET task_id = $1, status = 'processing', retry_count = $2, error_message = $3 WHERE task_id = $4`,
                      [newTaskId, retryCount + 1, `Queue retry ${retryCount + 1}/3`, taskId]
                    ).catch(e => console.error('[VIDGEN3] DB queue retry error:', e));
                    console.log(`[VIDGEN3] Queue retry ${retryCount + 1}/3 → new task: ${newTaskId}`);
                    return res.json({
                      status: 'retrying',
                      progress: 5,
                      taskId: taskId,
                      newTaskId: newTaskId,
                      message: `Antrian penuh, retry otomatis ${retryCount + 1}/3`
                    });
                  }
                }
              }
            }
          } catch (qRetryErr) {
            console.error('[VIDGEN3] Queue retry failed:', qRetryErr.message);
          }
        }
        
        const isGoogleSafetyError = errorMsg.includes('UNSAFE_GENERATION') || errorMsg.includes('AUDIO_FILTERED') || errorMsg.includes('SAFETY') || errorMsg.includes('FILTERED');
        const isVeo3Model = taskId.startsWith('veo3');
        
        if (isGoogleSafetyError && isVeo3Model) {
          console.log(`[VIDGEN3] Veo3 safety filter error (${errorMsg}), auto-retrying...`);
          try {
            const retryTaskResult = await pool.query('SELECT * FROM vidgen3_tasks WHERE task_id = $1', [taskId]);
            const origTask = retryTaskResult.rows[0];
            const retryPrompt = origTask?.prompt || '';
            const retryCount = origTask?.retry_count || 0;
            
            if (retryCount < 2) {
              const retryModel = retryCount === 0 ? 'veo3.1-fast' : 'veo2-fast';
              const retryBody = {
                model: retryModel,
                prompt: retryPrompt,
                enable_upsample: true,
                enhance_prompt: true
              };
              
              const origImages = data.detail?.req?.images;
              if (origImages && origImages.length > 0) {
                retryBody.images = origImages;
              }
              
              const retryResponse = await makeYunwuRequest('POST', `${YUNWU_API_BASE}/video/create`, yunwuApiKey, retryBody);
              const retryData = retryResponse.data;
              
              if (retryData && retryData.id) {
                const newTaskId = retryData.id;
                await pool.query(
                  `UPDATE vidgen3_tasks SET task_id = $1, status = 'processing', retry_count = $2, 
                   error_message = $3 WHERE task_id = $4`,
                  [newTaskId, retryCount + 1, `Retry ${retryCount + 1}/2 → ${retryModel}`, taskId]
                ).catch(e => console.error('[VIDGEN3] DB retry update error:', e));
                
                console.log(`[VIDGEN3] Auto-retry ${retryCount + 1}/2 success! New task: ${newTaskId} (${retryModel})`);
                return res.json({
                  status: 'retrying',
                  progress: 5,
                  taskId: taskId,
                  newTaskId: newTaskId,
                  retryModel: retryModel,
                  message: `Safety filter → retry ${retryCount + 1}/2 (${retryModel})`
                });
              }
            }
          } catch (retryErr) {
            console.error('[VIDGEN3] Auto-retry failed:', retryErr.message);
          }
        }
        
        pool.query(
          'UPDATE vidgen3_tasks SET status = $1, error_message = $2, completed_at = NOW() WHERE task_id = $3',
          ['failed', errorMsg, taskId]
        ).catch(e => console.error('[VIDGEN3] DB update error:', e));
        
        return res.json({
          status: 'failed',
          error: errorMsg,
          taskId: taskId
        });
      }
      
      const progress = data.progress || (isUpsampling ? 85 : (status === 'in_progress' ? 50 : (status === 'queued' ? 10 : 5)));
      return res.json({
        status: 'processing',
        progress: progress,
        taskId: taskId,
        yunwuStatus: status,
        ...(isUpsampling ? { message: 'Video berhasil, sedang upscale ke 4K...' } : {})
      });
      
    } catch (pollError) {
      console.error('[VIDGEN3] Yunwu poll error:', pollError.response?.data || pollError.message);
      return res.json({
        status: 'processing',
        progress: 0,
        taskId: taskId,
        message: 'Video sedang diproses...'
      });
    }
    
  } catch (error) {
    console.error('[VIDGEN3] Status check error:', error);
    res.status(500).json({ error: 'Gagal check status' });
  }
});

// Get Vidgen3 history
app.get('/api/vidgen3/history', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ videos: [], processing: [] });
  }
  
  try {
    const completedResult = await pool.query(`
      SELECT * FROM vidgen3_tasks 
      WHERE user_id = $1 AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.session.userId]);
    
    const processingResult = await pool.query(`
      SELECT * FROM vidgen3_tasks 
      WHERE user_id = $1 AND status IN ('processing', 'pending')
      AND created_at > NOW() - INTERVAL '30 minutes'
      ORDER BY created_at DESC
    `, [req.session.userId]);
    
    res.json({ 
      videos: completedResult.rows,
      processing: processingResult.rows
    });
  } catch (error) {
    console.error('[VIDGEN3] Get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// Delete vidgen3 video permanently
app.delete('/api/vidgen3/video/:id', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const videoId = req.params.id;
  
  try {
    const result = await pool.query(
      'DELETE FROM vidgen3_tasks WHERE id = $1 AND user_id = $2 RETURNING id',
      [videoId, req.session.userId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Video tidak ditemukan' });
    }
    
    console.log(`[VIDGEN3] Video ${videoId} deleted by user ${req.session.userId}`);
    res.json({ success: true, message: 'Video berhasil dihapus' });
  } catch (error) {
    console.error('[VIDGEN3] Delete video error:', error);
    res.status(500).json({ error: 'Gagal menghapus video' });
  }
});

// Delete all vidgen3 videos for user
app.delete('/api/vidgen3/videos/all', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const result = await pool.query(
      'DELETE FROM vidgen3_tasks WHERE user_id = $1 RETURNING id',
      [req.session.userId]
    );
    
    console.log(`[VIDGEN3] Deleted ${result.rowCount} videos for user ${req.session.userId}`);
    res.json({ success: true, deleted: result.rowCount, message: `${result.rowCount} video berhasil dihapus` });
  } catch (error) {
    console.error('[VIDGEN3] Delete all videos error:', error);
    res.status(500).json({ error: 'Gagal menghapus semua video' });
  }
});

// ============ X IMAGE (ApiModels.app Image Generation) ============

// X Image model configuration
const XIMAGE_MODELS = {
  'gemini-3-pro-image': { name: 'Gemini 3 Pro Image', provider: 'Google', supportsI2I: true, supportsQuality: true, apiType: 'apimodels', apiModel: 'gemini-3-pro-image', i2iModel: 'gemini-3-pro-image' },
  'gemini-3-pro-image-lite': { name: 'Gemini 3 Pro Lite', provider: 'Google', supportsI2I: true, supportsQuality: true, apiType: 'apimodels', apiModel: 'gemini-3-pro-image-lite', i2iModel: 'gemini-3-pro-image-lite' },
  'gemini-2.5-flash-image': { name: 'Gemini 2.5 Flash', provider: 'Google', supportsI2I: true, supportsQuality: true, apiType: 'apimodels', apiModel: 'gemini-2.5-flash-image', i2iModel: 'gemini-2.5-flash-image' },
  'nanobanana2': { name: 'Nanobanana 2', provider: 'Google', supportsI2I: true, supportsQuality: true, apiType: 'apimodels', apiModel: 'nanobanana2', i2iModel: 'nanobanana2' },
  'nanobanana2-beta': { name: 'Nanobanana 2 Beta', provider: 'Google', supportsI2I: true, supportsQuality: true, apiType: 'apimodels', apiModel: 'nanobanana-2-beta', i2iModel: 'nanobanana-2-beta' },
  'seedream-5.0': { name: 'Seedream 5.0 Lite', provider: 'ByteDance', supportsI2I: true, supportsQuality: true, apiType: 'apimodels', apiModel: 'doubao-seedream-5-0-260128', i2iModel: 'doubao-seedream-5-0-260128' },
  'seedream-4.5': { name: 'Seedream 4.5', provider: 'ByteDance', supportsI2I: true, supportsQuality: true, apiType: 'apimodels', apiModel: 'doubao-seedream-4-5-251128', i2iModel: 'doubao-seedream-4-5-251128' },
  'grok-4.2-image': { name: 'Grok 4.2 Image', provider: 'xAI', supportsI2I: true, apiType: 'apimodels', apiModel: 'grok-4.2-image', i2iModel: 'grok-4.2-image' },
  'grok-imagine': { name: 'Grok Imagine', provider: 'xAI', supportsI2I: true, apiType: 'apimodels', apiModel: 'grok-imagine-image', i2iModel: 'grok-imagine-image' },
  'grok-imagine-pro': { name: 'Grok Imagine Pro', provider: 'xAI', supportsI2I: true, apiType: 'apimodels', apiModel: 'grok-imagine-pro', i2iModel: 'grok-imagine-pro' },
  'kling-omni-image': { name: 'Kling Omni-Image', provider: 'Kling', supportsI2I: true, supportsQuality: true, apiType: 'apimodels', apiModel: 'kling-image-o1', i2iModel: 'kling-image-o1' },
  'p-image': { name: 'P-Image', provider: 'Pruna AI', supportsI2I: false, apiType: 'apimodels-sync', apiModel: 'p-image' },
  'p-image-edit': { name: 'P-Image Edit', provider: 'Pruna AI', supportsI2I: true, apiType: 'apimodels-edit', apiModel: 'p-image-edit', i2iModel: 'p-image-edit' },
};

// Get X Image room API key
async function getXImageRoomApiKey(xclipApiKey) {
  const keyInfo = await validateXclipApiKey(xclipApiKey);
  if (!keyInfo) {
    return { error: 'Xclip API key tidak valid' };
  }
  
  // Get user's ximage room from subscription
  const subResult = await pool.query(`
    SELECT s.ximage_room_id 
    FROM subscriptions s 
    WHERE s.user_id = $1 AND s.status = 'active' 
    AND (s.expired_at IS NULL OR s.expired_at > NOW())
    ORDER BY s.created_at DESC LIMIT 1
  `, [keyInfo.user_id]);
  
  const ximageRoomId = subResult.rows[0]?.ximage_room_id || 1;
  
  const roomKeyPrefix = `XIMAGE_ROOM${ximageRoomId}_KEY_`;
  const availableKeys = [1, 2, 3].map(i => `${roomKeyPrefix}${i}`).filter(k => process.env[k]);
  
  if (availableKeys.length === 0) {
    if (process.env.XIMAGE_API_KEY) {
      return { 
        apiKey: process.env.XIMAGE_API_KEY, 
        keyName: 'XIMAGE_API_KEY',
        roomId: ximageRoomId,
        userId: keyInfo.user_id,
        keyInfoId: keyInfo.id
      };
    }
    return { error: 'Tidak ada API key X Image yang tersedia. Hubungi admin.' };
  }
  
  const randomKeyName = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  return { 
    apiKey: process.env[randomKeyName], 
    keyName: randomKeyName,
    roomId: ximageRoomId,
    userId: keyInfo.user_id,
    keyInfoId: keyInfo.id
  };
}

// Get X Image models
app.get('/api/ximage/models', (req, res) => {
  const models = Object.entries(XIMAGE_MODELS).map(([id, info]) => ({
    id,
    ...info
  }));
  res.json({ models });
});

// Get X Image rooms
app.get('/api/ximage/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, max_users, current_users, status 
      FROM ximage_rooms 
      ORDER BY id
    `);
    res.json({ rooms: result.rows });
  } catch (error) {
    console.error('[XIMAGE] Get rooms error:', error);
    res.status(500).json({ error: 'Gagal mendapatkan daftar room' });
  }
});

// X Image Subscription Status
app.get('/api/ximage/subscription-status', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    const result = await pool.query(`
      SELECT s.ximage_room_id, r.name as room_name
      FROM subscriptions s
      LEFT JOIN ximage_rooms r ON r.id = s.ximage_room_id
      WHERE s.user_id = $1 AND s.status = 'active'
      AND (s.expired_at IS NULL OR s.expired_at > NOW())
      ORDER BY s.created_at DESC LIMIT 1
    `, [req.session.userId]);
    
    if (result.rows.length > 0 && result.rows[0].ximage_room_id) {
      res.json({
        hasSubscription: true,
        subscription: {
          roomId: result.rows[0].ximage_room_id,
          roomName: result.rows[0].room_name
        }
      });
    } else {
      res.json({ hasSubscription: false, subscription: null });
    }
  } catch (error) {
    console.error('[XIMAGE] Subscription status error:', error);
    res.status(500).json({ error: 'Gagal mendapatkan status subscription' });
  }
});

// Join X Image Room
app.post('/api/ximage/join-room', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    const { roomId, xclipApiKey } = req.body;
    
    // Validate Xclip API key
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(400).json({ error: 'Xclip API key tidak valid' });
    }
    
    // Check room availability
    const roomResult = await pool.query(
      'SELECT * FROM ximage_rooms WHERE id = $1', 
      [roomId]
    );
    
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room tidak ditemukan' });
    }
    
    const room = roomResult.rows[0];
    if (room.status !== 'OPEN') {
      return res.status(400).json({ error: 'Room sedang tidak tersedia' });
    }
    
    if (room.current_users >= room.max_users) {
      return res.status(400).json({ error: 'Room sudah penuh' });
    }
    
    // Update subscription with room assignment
    await pool.query(`
      UPDATE subscriptions SET ximage_room_id = $1 
      WHERE user_id = $2 AND status = 'active'
    `, [roomId, req.session.userId]);
    
    // Increment room users
    await pool.query(`
      UPDATE ximage_rooms SET current_users = current_users + 1 WHERE id = $1
    `, [roomId]);
    
    res.json({ 
      success: true, 
      message: `Berhasil bergabung ke ${room.name}`,
      roomId 
    });
  } catch (error) {
    console.error('[XIMAGE] Join room error:', error);
    res.status(500).json({ error: 'Gagal bergabung ke room' });
  }
});

// Generate X Image
app.post('/api/ximage/generate', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const roomKeyResult = await getXImageRoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      return res.status(400).json({ error: roomKeyResult.error });
    }
    
    const { model, prompt, image, image2, aspectRatio, mode, resolution, numberOfImages, quality, modelVariant, renderingSpeed, imageStyle, acceleration, googleSearch, outputFormat } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt diperlukan' });
    }
    
    const modelConfig = XIMAGE_MODELS[model];
    if (!modelConfig) {
      return res.status(400).json({ error: 'Model tidak valid' });
    }
    
    if (mode === 'image-to-image' && !modelConfig.supportsI2I) {
      return res.status(400).json({ error: `Model ${modelConfig.name} tidak mendukung image-to-image` });
    }
    
    console.log(`[XIMAGE] Generating with model: ${model}, mode: ${mode || 'text-to-image'}, resolution: ${resolution || 'default'}, n: ${numberOfImages || 1}`);
    
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    
    // Upload base64 images to local storage for public URLs
    let imageUrls = [];
    if (mode === 'image-to-image' && image) {
      try {
        if (image.startsWith('data:')) {
          const saved = await saveBase64ToFile(image, 'image', baseUrl);
          imageUrls.push(saved.publicUrl);
          console.log(`[XIMAGE] Reference image 1 saved: ${saved.publicUrl}`);
        } else {
          imageUrls.push(image);
        }
        if (image2) {
          if (image2.startsWith('data:')) {
            const saved2 = await saveBase64ToFile(image2, 'image', baseUrl);
            imageUrls.push(saved2.publicUrl);
            console.log(`[XIMAGE] Reference image 2 saved: ${saved2.publicUrl}`);
          } else {
            imageUrls.push(image2);
          }
        }
      } catch (uploadError) {
        console.error('[XIMAGE] Image upload error:', uploadError.message);
        return res.status(500).json({ error: 'Gagal memproses gambar referensi' });
      }
    }
    
    const isI2I = mode === 'image-to-image' && imageUrls.length > 0;
    
    let taskId;
    let bgPollType;
    let lastResponse;

    if (modelConfig.apiType === 'apimodels' || modelConfig.apiType === 'apimodels-sync' || modelConfig.apiType === 'apimodels-edit') {
      const apimodelsKey = process.env.APIMODELS_API_KEY || process.env.VIDGEN2_ROOM1_KEY_1;
      if (!apimodelsKey) {
        return res.status(500).json({ error: 'ApiModels API key tidak tersedia. Hubungi admin.' });
      }
      const amHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apimodelsKey}` };
      let amModel = isI2I && modelConfig.i2iModel ? modelConfig.i2iModel : modelConfig.apiModel;
      if (modelConfig.variantModels && modelVariant && modelConfig.variantModels[modelVariant]) {
        amModel = modelConfig.variantModels[modelVariant];
      }

      if (modelConfig.apiType === 'apimodels-sync') {
        const body = { model: amModel, prompt, aspect_ratio: aspectRatio || '1:1' };
        console.log('[XIMAGE] ApiModels sync request:', JSON.stringify(body));
        lastResponse = await axios.post(
          'https://apimodels.app/api/v1/images/generations-sync',
          body,
          { headers: amHeaders, timeout: 60000 }
        );
        console.log('[XIMAGE] ApiModels sync response:', JSON.stringify(lastResponse.data).substring(0, 500));
        const syncData = lastResponse.data?.data || lastResponse.data;
        const syncUrl = syncData?.url || syncData?.resultUrls?.[0];
        if (syncUrl) {
          const syncTaskId = `am-sync-${Date.now()}`;
          await pool.query(`
            INSERT INTO ximage_history (user_id, task_id, model, prompt, mode, aspect_ratio, reference_image, status, image_url, completed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, NOW())
          `, [roomKeyResult.userId, syncTaskId, model, prompt, mode || 'text-to-image', aspectRatio || '1:1', null, syncUrl]);
          sendSSEToUser(roomKeyResult.userId, { type: 'ximage_completed', taskId: syncTaskId, imageUrl: syncUrl });
          return res.json({ taskId: syncTaskId, model, imageUrl: syncUrl, message: 'Image generated' });
        }
        return res.status(500).json({ error: 'Tidak ada URL dari P-Image' });
      } else if (modelConfig.apiType === 'apimodels-edit') {
        const body = { model: amModel, prompt, aspect_ratio: aspectRatio || 'match_input_image' };
        if (imageUrls.length > 0) body.images = imageUrls;
        console.log('[XIMAGE] ApiModels edit request:', JSON.stringify({ ...body, images: body.images ? ['[IMAGES]'] : undefined }));
        lastResponse = await axios.post(
          'https://apimodels.app/api/v1/images/edit',
          body,
          { headers: amHeaders, timeout: 60000 }
        );
        console.log('[XIMAGE] ApiModels edit response:', JSON.stringify(lastResponse.data).substring(0, 500));
        const editData = lastResponse.data?.data || lastResponse.data;
        const editUrl = editData?.url || editData?.resultUrls?.[0];
        if (editUrl) {
          const editTaskId = `am-edit-${Date.now()}`;
          await pool.query(`
            INSERT INTO ximage_history (user_id, task_id, model, prompt, mode, aspect_ratio, reference_image, status, image_url, completed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, NOW())
          `, [roomKeyResult.userId, editTaskId, model, prompt, mode || 'image-to-image', aspectRatio || '1:1', imageUrls[0] || null, editUrl]);
          sendSSEToUser(roomKeyResult.userId, { type: 'ximage_completed', taskId: editTaskId, imageUrl: editUrl });
          return res.json({ taskId: editTaskId, model, imageUrl: editUrl, message: 'Image edited' });
        }
        return res.status(500).json({ error: 'Tidak ada URL dari P-Image-Edit' });
      } else {
        const body = { model: amModel, prompt, aspect_ratio: aspectRatio || '1:1' };
        if (modelConfig.supportsQuality && (resolution || quality)) body.resolution = resolution || quality;
        if (isI2I && imageUrls.length > 0) {
          if (imageUrls.length === 1) {
            body.image_url = imageUrls[0];
          } else {
            body.image_urls = imageUrls;
          }
        }
        console.log('[XIMAGE] ApiModels async request:', JSON.stringify({ ...body, image_url: body.image_url ? '[IMAGE]' : undefined, image_urls: body.image_urls ? ['[IMAGES]'] : undefined }));
        lastResponse = await axios.post(
          'https://apimodels.app/api/v1/images/generations',
          body,
          { headers: amHeaders, timeout: 60000 }
        );
        console.log('[XIMAGE] ApiModels async response:', JSON.stringify(lastResponse.data).substring(0, 500));
        const amData = lastResponse.data?.data || lastResponse.data;
        taskId = amData?.taskId || amData?.task_id || amData?.id;
        bgPollType = 'apimodels-image';
      }
    } else {
      return res.status(400).json({ error: 'API type tidak dikenal: ' + modelConfig.apiType });
    }
    
    if (!taskId) {
      const respBody = typeof lastResponse?.data === 'object' ? lastResponse.data : {};
      console.error('[XIMAGE] No taskId found in response:', JSON.stringify(respBody));
      const apiCode = respBody.code || respBody.status;
      const apiError = respBody.msg || respBody.message || respBody.error?.message || respBody.error || '';
      if (apiCode === 401 || apiCode === 403) {
        return res.status(500).json({ error: 'API key tidak valid atau expired. Hubungi admin untuk update key.' });
      }
      return res.status(500).json({ error: apiError ? `API: ${apiError}` : 'Gagal mendapatkan task ID' });
    }
    
    await pool.query(`
      INSERT INTO ximage_history (user_id, task_id, model, prompt, mode, aspect_ratio, reference_image, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
    `, [roomKeyResult.userId, taskId, model, prompt, mode || 'text-to-image', aspectRatio || '1:1', imageUrls.length > 0 ? imageUrls[0] : null]);
    
    const pollApiKey = process.env.APIMODELS_API_KEY || process.env.VIDGEN2_ROOM1_KEY_1;
    startServerBgPoll(taskId, bgPollType, pollApiKey, {
      dbTable: 'ximage_history',
      urlColumn: 'image_url',
      model,
      userId: roomKeyResult.userId
    });
    
    res.json({ taskId, model, message: 'Image generation started' });
    
  } catch (error) {
    const errData = error.response?.data;
    const statusCode = error.response?.status;
    console.error('[XIMAGE] Generate error:', statusCode, typeof errData === 'string' ? errData.substring(0, 200) : JSON.stringify(errData));
    let errMsg;
    if (typeof errData === 'string' && errData.includes('<html')) {
      errMsg = `API returned HTTP ${statusCode || 'error'}. Coba lagi nanti.`;
    } else if (errData && typeof errData === 'object') {
      errMsg = errData.msg || errData.message || errData.error?.message || errData.error || error.message;
    } else {
      errMsg = error.message;
    }
    if (statusCode === 401 || statusCode === 403) {
      errMsg = 'API key tidak valid atau expired. Hubungi admin untuk update key.';
    } else if (statusCode === 404) {
      errMsg = 'Model atau endpoint tidak ditemukan (404). Kemungkinan model belum tersedia.';
    }
    res.status(error.response?.status || 500).json({ error: errMsg });
  }
});

// Get X Image status
app.get('/api/ximage/status/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const roomKeyResult = await getXImageRoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      return res.status(400).json({ error: roomKeyResult.error });
    }
    
    // Check DB first for cached completed/failed status
    const dbResult = await pool.query(
      `SELECT status, image_url, model FROM ximage_history WHERE task_id = $1`,
      [taskId]
    );
    
    if (dbResult.rows.length > 0) {
      const row = dbResult.rows[0];
      if (row.status === 'completed' && row.image_url) {
        return res.json({ status: 'completed', imageUrl: row.image_url });
      }
      if (row.status === 'failed') {
        return res.json({ status: 'failed', error: 'Image generation gagal' });
      }
      
      const model = row.model;
      const apimodelsKey = process.env.APIMODELS_API_KEY || process.env.VIDGEN2_ROOM1_KEY_1;
      
      let result;
      if (taskId.startsWith('am-sync-') || taskId.startsWith('am-edit-')) {
        return res.json({ status: 'completed', imageUrl: row.image_url });
      }
      result = await pollApimodelsImageTask(taskId, apimodelsKey);
      
      if (result.status === 'completed' && result.url) {
        await pool.query(
          `UPDATE ximage_history SET status = 'completed', image_url = $1, completed_at = NOW() WHERE task_id = $2`,
          [result.url, taskId]
        );
        return res.json({ status: 'completed', imageUrl: result.url });
      }
      
      if (result.status === 'failed') {
        await pool.query(
          `UPDATE ximage_history SET status = 'failed', completed_at = NOW() WHERE task_id = $1`,
          [taskId]
        );
        return res.json({ status: 'failed', error: result.error || 'Generation failed' });
      }
      
      return res.json({ status: 'processing', message: 'Image sedang diproses...' });
    }
    
    return res.json({ status: 'processing', message: 'Menunggu antrian...' });
    
  } catch (error) {
    console.error('[XIMAGE] Status check error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Gagal check status' });
  }
});

// Get X Image history
app.get('/api/ximage/history', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ images: [] });
  }
  
  try {
    const result = await pool.query(`
      SELECT * FROM ximage_history 
      WHERE user_id = $1 AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.session.userId]);
    
    res.json({ 
      images: result.rows.map(row => ({
        id: row.id,
        taskId: row.task_id,
        model: row.model,
        prompt: row.prompt,
        mode: row.mode,
        aspectRatio: row.aspect_ratio,
        imageUrl: row.image_url,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    console.error('[XIMAGE] Get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

app.delete('/api/ximage/history/:id', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  try {
    await pool.query('DELETE FROM ximage_history WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('[XIMAGE] Delete history error:', error);
    res.status(500).json({ error: 'Gagal hapus gambar' });
  }
});

app.delete('/api/ximage/history', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  try {
    await pool.query('DELETE FROM ximage_history WHERE user_id = $1', [req.session.userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('[XIMAGE] Delete all history error:', error);
    res.status(500).json({ error: 'Gagal hapus semua gambar' });
  }
});

// ============ X IMAGE2 (Apimart.ai Image Generation) ============

const XIMAGE2_MODELS = {
  'gpt-4o-image': { 
    name: 'GPT-4o Image', provider: 'OpenAI', supportsI2I: true, 
    sizes: ['1:1', '2:3', '3:2'], maxN: 4, maxRefs: 5,
    desc: 'OpenAI GPT-4o image generation'
  },
  'gemini-2.5-flash-image-preview': { 
    name: 'Nano Banana', provider: 'Google', supportsI2I: true,
    sizes: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], maxN: 1, maxRefs: 14,
    desc: 'Google Gemini 2.5 Flash'
  },
  'doubao-seedance-4-0': { 
    name: 'Seedream 4.0', provider: 'ByteDance', supportsI2I: true,
    sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', 'auto'], maxN: 15, maxRefs: 10,
    resolutions: ['1K', '2K', '4K'],
    hasWatermark: true, hasSequential: true,
    desc: 'ByteDance Seedream 4.0'
  },
  'doubao-seedance-4-5': { 
    name: 'Seedream 4.5', provider: 'ByteDance', supportsI2I: true,
    sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', 'auto'], maxN: 15, maxRefs: 10,
    resolutions: ['2K', '4K'], defaultResolution: '2K',
    hasWatermark: true, hasSequential: true,
    desc: 'ByteDance Seedream 4.5 latest (no 1K support)'
  },
  'seedream-5-0-lite': { 
    name: 'Seedream 5.0 Lite', provider: 'ByteDance', supportsI2I: true,
    sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'], maxN: 15, maxRefs: 10,
    resolutions: ['1K', '2K', '3K', '4K'], defaultResolution: '2K',
    hasWatermark: true, hasSequential: true,
    desc: 'ByteDance Seedream 5.0 Lite - 4K output, perfect text rendering'
  },
  'flux-kontext-pro': { 
    name: 'Flux Kontext Pro', provider: 'Black Forest Labs', supportsI2I: true,
    sizes: ['match_input_image', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'], maxN: 1, maxRefs: 1,
    hasSafetyTolerance: true, hasPromptUpsampling: true, noBase64: true,
    desc: 'FLUX Kontext Pro - only public image URLs'
  },
  'flux-kontext-max': { 
    name: 'Flux Kontext Max', provider: 'Black Forest Labs', supportsI2I: true,
    sizes: ['match_input_image', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'], maxN: 1, maxRefs: 1,
    hasSafetyTolerance: true, hasPromptUpsampling: true, noBase64: true,
    desc: 'FLUX Kontext Max highest quality - only public URLs'
  },
  'flux-2-flex': { 
    name: 'Flux 2.0 Flex', provider: 'Black Forest Labs', supportsI2I: true,
    sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], maxN: 1, maxRefs: 8,
    resolutions: ['1K', '2K'], noBase64: true,
    desc: 'FLUX 2.0 Flex - only public image URLs'
  },
  'flux-2-pro': { 
    name: 'Flux 2.0 Pro', provider: 'Black Forest Labs', supportsI2I: true,
    sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], maxN: 1, maxRefs: 8,
    resolutions: ['1K', '2K'], noBase64: true,
    desc: 'FLUX 2.0 Pro higher quality - only public URLs'
  }
};

async function getXImage2RoomApiKey(xclipApiKey) {
  const keyInfo = await validateXclipApiKey(xclipApiKey);
  if (!keyInfo) {
    return { error: 'Xclip API key tidak valid' };
  }
  
  const subResult = await pool.query(`
    SELECT s.ximage2_room_id 
    FROM subscriptions s 
    WHERE s.user_id = $1 AND s.ximage2_room_id IS NOT NULL
    ORDER BY s.created_at DESC LIMIT 1
  `, [keyInfo.user_id]);
  
  const ximage2RoomId = subResult.rows[0]?.ximage2_room_id || 1;
  
  const roomKeyPrefix = `XIMAGE2_ROOM${ximage2RoomId}_KEY_`;
  const availableKeys = [1, 2, 3].map(i => `${roomKeyPrefix}${i}`).filter(k => process.env[k]);
  
  if (availableKeys.length === 0) {
    if (process.env.APIMART_API_KEY) {
      return { 
        apiKey: process.env.APIMART_API_KEY, 
        keyName: 'APIMART_API_KEY',
        roomId: ximage2RoomId,
        userId: keyInfo.user_id,
        keyInfoId: keyInfo.id
      };
    }
    return { error: 'Tidak ada API key X Image2 yang tersedia. Hubungi admin.' };
  }
  
  const randomKeyName = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  return { 
    apiKey: process.env[randomKeyName], 
    keyName: randomKeyName,
    roomId: ximage2RoomId,
    userId: keyInfo.user_id,
    keyInfoId: keyInfo.id
  };
}

app.get('/api/ximage2/models', (req, res) => {
  const models = Object.entries(XIMAGE2_MODELS).map(([id, info]) => ({
    id, ...info
  }));
  res.json({ models });
});

app.get('/api/ximage2/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, max_users, current_users, status 
      FROM ximage2_rooms 
      ORDER BY id
    `);
    res.json({ rooms: result.rows });
  } catch (error) {
    console.error('[XIMAGE2] Get rooms error:', error);
    res.status(500).json({ error: 'Gagal mendapatkan daftar room' });
  }
});

app.get('/api/ximage2/subscription-status', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    const result = await pool.query(`
      SELECT s.ximage2_room_id, r.name as room_name
      FROM subscriptions s
      LEFT JOIN ximage2_rooms r ON r.id = s.ximage2_room_id
      WHERE s.user_id = $1 AND s.ximage2_room_id IS NOT NULL
      ORDER BY s.created_at DESC LIMIT 1
    `, [req.session.userId]);
    
    if (result.rows.length > 0 && result.rows[0].ximage2_room_id) {
      res.json({
        hasSubscription: true,
        subscription: {
          roomId: result.rows[0].ximage2_room_id,
          roomName: result.rows[0].room_name
        }
      });
    } else {
      res.json({ hasSubscription: false, subscription: null });
    }
  } catch (error) {
    console.error('[XIMAGE2] Subscription status error:', error);
    res.status(500).json({ error: 'Gagal mendapatkan status subscription' });
  }
});

app.post('/api/ximage2/join-room', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    const { roomId, xclipApiKey } = req.body;
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(400).json({ error: 'Xclip API key tidak valid' });
    }
    
    const roomResult = await pool.query(
      'SELECT * FROM ximage2_rooms WHERE id = $1', 
      [roomId]
    );
    
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room tidak ditemukan' });
    }
    
    const room = roomResult.rows[0];
    if (room.status !== 'OPEN') {
      return res.status(400).json({ error: 'Room sedang tidak tersedia' });
    }
    
    if (room.current_users >= room.max_users) {
      return res.status(400).json({ error: 'Room sudah penuh' });
    }
    
    const updateResult = await pool.query(`
      UPDATE subscriptions SET ximage2_room_id = $1 
      WHERE user_id = $2 AND status = 'active'
    `, [roomId, keyInfo.user_id]);
    
    if (updateResult.rowCount === 0) {
      const existingSub = await pool.query(
        'SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
        [keyInfo.user_id]
      );
      if (existingSub.rows.length > 0) {
        await pool.query(
          'UPDATE subscriptions SET ximage2_room_id = $1 WHERE id = $2',
          [roomId, existingSub.rows[0].id]
        );
      }
    }
    
    await pool.query(`
      UPDATE ximage2_rooms SET current_users = current_users + 1 WHERE id = $1
    `, [roomId]);
    
    res.json({ 
      success: true, 
      message: `Berhasil bergabung ke ${room.name}`,
      roomId 
    });
  } catch (error) {
    console.error('[XIMAGE2] Join room error:', error);
    res.status(500).json({ error: 'Gagal bergabung ke room' });
  }
});

app.post('/api/ximage2/generate', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const roomKeyResult = await getXImage2RoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      return res.status(400).json({ error: roomKeyResult.error });
    }
    
    const ximage2Cooldown = getUserCooldownRemaining(roomKeyResult.userId, 'ximage2');
    if (ximage2Cooldown > 0) {
      const cooldownSec = Math.ceil(ximage2Cooldown / 1000);
      return res.status(429).json({
        error: `Mohon tunggu ${cooldownSec} detik sebelum generate gambar berikutnya`,
        cooldown: cooldownSec,
        cooldownMs: ximage2Cooldown
      });
    }
    
    const { model, prompt, images, size, resolution, 
            watermark, sequentialGeneration, safetyTolerance, inputMode, promptUpsampling, maskImage } = req.body;
    const n = req.body.numberOfImages || req.body.n || 1;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt diperlukan' });
    }
    
    const modelConfig = XIMAGE2_MODELS[model];
    if (!modelConfig) {
      return res.status(400).json({ error: 'Model tidak valid' });
    }
    
    const isI2I = images && images.length > 0;
    if (isI2I && !modelConfig.supportsI2I) {
      return res.status(400).json({ error: `Model ${modelConfig.name} tidak mendukung image-to-image` });
    }
    
    console.log(`[XIMAGE2] Generating with model: ${model}, size: ${size || 'default'}, n: ${n || 1}, i2i: ${isI2I}`);
    
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    
    let imageUrls = [];
    if (isI2I) {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img && img.startsWith('data:')) {
          const uploaded = await saveBase64ToFile(img, 'image', baseUrl);
          imageUrls.push(uploaded.publicUrl);
          console.log(`[XIMAGE2] Image ${i + 1} uploaded: ${uploaded.publicUrl}`);
        } else if (img) {
          imageUrls.push(img);
        }
      }
    }
    
    const requestBody = {
      model: model,
      prompt: prompt
    };
    
    if (size) requestBody.size = size;
    requestBody.n = Math.min(parseInt(n) || 1, modelConfig.maxN || 1);
    if (imageUrls.length > 0) requestBody.image_urls = imageUrls.slice(0, modelConfig.maxRefs);
    
    if (modelConfig.resolutions && resolution) {
      requestBody.resolution = resolution;
    }
    if (modelConfig.hasWatermark && watermark !== undefined) {
      requestBody.watermark = watermark;
    }
    if (modelConfig.hasSequential && sequentialGeneration !== undefined) {
      requestBody.sequential_image_generation = sequentialGeneration ? 'auto' : 'disabled';
    }
    if (modelConfig.hasSafetyTolerance && safetyTolerance !== undefined) {
      requestBody.safety_tolerance = parseInt(safetyTolerance);
    }
    if (modelConfig.hasPromptUpsampling && promptUpsampling !== undefined) {
      requestBody.prompt_upsampling = promptUpsampling;
    }
    if (modelConfig.hasMask && maskImage) {
      let maskUrl = maskImage;
      if (maskImage.startsWith('data:')) {
        const maskUploaded = await saveBase64ToFile(maskImage, 'image', baseUrl);
        maskUrl = maskUploaded.publicUrl;
        console.log(`[XIMAGE2] Mask image uploaded: ${maskUrl}`);
      }
      requestBody.mask_url = maskUrl;
    }
    
    console.log('[XIMAGE2] Request body:', JSON.stringify({ ...requestBody, image_urls: requestBody.image_urls ? ['[IMAGES]'] : undefined }));
    
    const response = await axios.post(
      'https://api.apimart.ai/v1/images/generations',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${roomKeyResult.apiKey}`
        },
        timeout: 600000
      }
    );
    
    console.log('[XIMAGE2] Apimart.ai response:', JSON.stringify(response.data));
    
    const respData = response.data;
    
    let directImageUrl = null;
    if (respData.data && Array.isArray(respData.data) && respData.data.length > 0) {
      if (respData.data[0].url) {
        directImageUrl = respData.data[0].url;
      } else if (respData.data[0].b64_json) {
        directImageUrl = `data:image/png;base64,${respData.data[0].b64_json}`;
      }
    }
    
    if (directImageUrl) {
      await pool.query(`
        INSERT INTO ximage2_history (user_id, task_id, model, prompt, mode, size, image_url, status, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', NOW())
      `, [roomKeyResult.userId, 'direct-' + Date.now(), model, prompt, isI2I ? 'image-to-image' : 'text-to-image', size || '1:1', directImageUrl]);
      
      setUserCooldown(roomKeyResult.userId, 'ximage2');
      
      await pool.query(
        'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
        [roomKeyResult.keyInfoId]
      );
      
      return res.json({
        success: true,
        direct: true,
        imageUrl: directImageUrl,
        model: model,
        cooldown: Math.ceil(RATE_LIMIT_CONFIG.ximage2.cooldownMs / 1000)
      });
    }
    
    const taskId = respData.data?.[0]?.task_id || 
                   respData.task_id || 
                   respData.id;
    
    if (!taskId) {
      console.error('[XIMAGE2] No task ID or direct image in response:', respData);
      return res.status(500).json({ error: 'Tidak mendapat task ID dari Apimart.ai' });
    }
    
    await pool.query(`
      INSERT INTO ximage2_history (user_id, task_id, model, prompt, mode, size, reference_image, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
    `, [roomKeyResult.userId, taskId, model, prompt, isI2I ? 'image-to-image' : 'text-to-image', size || '1:1', imageUrls.length > 0 ? imageUrls[0] : null]);
    
    await pool.query(
      'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [roomKeyResult.keyInfoId]
    );
    
    setUserCooldown(roomKeyResult.userId, 'ximage2');
    
    startServerBgPoll(taskId, 'apimart', roomKeyResult.apiKey, {
      dbTable: 'ximage2_history',
      urlColumn: 'image_url',
      model: model,
      userId: roomKeyResult.userId
    });
    
    res.json({
      success: true,
      taskId: taskId,
      model: model,
      cooldown: Math.ceil(RATE_LIMIT_CONFIG.ximage2.cooldownMs / 1000),
      message: 'Image generation dimulai'
    });
    
  } catch (error) {
    const errData = error.response?.data;
    const rawMsg = errData?.error?.message || errData?.message || errData?.error || error.message;
    const errCode = errData?.error?.code || errData?.code || '';
    console.error('[XIMAGE2] Generate error:', JSON.stringify(errData || error.message));
    console.error('[XIMAGE2] Status:', error.response?.status, 'Model:', req.body?.model);
    
    let userMsg = typeof rawMsg === 'string' ? rawMsg : 'Gagal generate image';
    if (userMsg.includes('OOM') || userMsg.includes('maxmemory') || userMsg.includes('redis')) {
      userMsg = 'Server Apimart.ai sedang overload. Silakan coba lagi dalam beberapa menit.';
    } else if (userMsg.includes('timeout') || userMsg.includes('ETIMEDOUT')) {
      userMsg = 'Request timeout. Server Apimart.ai terlalu lama merespon, coba lagi.';
    } else if (errCode === 'enqueue_task_failed') {
      userMsg = 'Server Apimart.ai gagal memproses request. Silakan coba lagi.';
    }
    
    res.status(error.response?.status || 500).json({ error: userMsg });
  }
});

app.get('/api/ximage2/status/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const roomKeyResult = await getXImage2RoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      return res.status(400).json({ error: roomKeyResult.error });
    }
    
    const localTask = await pool.query(
      'SELECT * FROM ximage2_history WHERE task_id = $1 AND user_id = $2',
      [taskId, roomKeyResult.userId]
    );
    
    if (localTask.rows.length > 0 && localTask.rows[0].status === 'completed') {
      return res.json({
        status: 'completed',
        imageUrl: localTask.rows[0].image_url
      });
    }
    
    if (localTask.rows.length > 0 && localTask.rows[0].status === 'failed') {
      return res.json({
        status: 'failed',
        error: 'Image generation failed'
      });
    }
    
    let statusResponse;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        statusResponse = await axios.get(
          `https://api.apimart.ai/v1/tasks/${taskId}`,
          {
            headers: { 'Authorization': `Bearer ${roomKeyResult.apiKey}` },
            timeout: 30000
          }
        );
        break;
      } catch (retryErr) {
        const msg = (retryErr.message || '').toLowerCase();
        const isNetErr = !retryErr.response && (msg.includes('socket hang up') || msg.includes('econnreset') || msg.includes('etimedout'));
        if (isNetErr && attempt < 2) {
          console.log(`[XIMAGE2] Status poll network error, retry ${attempt + 1}/3`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        throw retryErr;
      }
    }
    
    console.log('[XIMAGE2] Status response:', JSON.stringify(statusResponse.data));
    
    const rawData = statusResponse.data;
    const data = rawData.data || rawData;
    const status = data.status || data.state;
    
    if (status === 'completed' || status === 'finished' || status === 'success') {
      let imageUrl = data.result?.images?.[0]?.url || 
                     data.result?.image_url ||
                     data.images?.[0]?.url ||
                     data.image_url ||
                     data.url ||
                     data.output?.images?.[0]?.url ||
                     data.output?.image_url ||
                     data.media_url;
      
      if (!imageUrl && data.result?.images?.[0]) {
        imageUrl = typeof data.result.images[0] === 'string' ? data.result.images[0] : null;
      }
      
      if (!imageUrl) {
        console.error('[XIMAGE2] Completed but no image URL:', rawData);
        return res.status(500).json({ status: 'failed', error: 'No image URL in response' });
      }
      
      await pool.query(`
        UPDATE ximage2_history 
        SET status = 'completed', image_url = $1, completed_at = NOW()
        WHERE task_id = $2
      `, [imageUrl, taskId]);
      
      return res.json({ status: 'completed', imageUrl });
    }
    
    if (status === 'failed' || status === 'error') {
      const errorMsg = data.error?.message || data.error_message || data.message || 'Generation failed';
      
      await pool.query(`
        UPDATE ximage2_history 
        SET status = 'failed', completed_at = NOW()
        WHERE task_id = $1
      `, [taskId]);
      
      return res.json({ status: 'failed', error: errorMsg });
    }
    
    const progress = data.progress || data.percent || 0;
    res.json({
      status: 'processing',
      progress,
      message: 'Image sedang diproses...'
    });
    
  } catch (error) {
    console.error('[XIMAGE2] Status check error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Gagal check status' });
  }
});

app.get('/api/ximage2/history', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ images: [] });
  }
  
  try {
    const result = await pool.query(`
      SELECT * FROM ximage2_history 
      WHERE user_id = $1 AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.session.userId]);
    
    res.json({ 
      images: result.rows.map(row => ({
        id: row.id,
        taskId: row.task_id,
        model: row.model,
        prompt: row.prompt,
        mode: row.mode,
        size: row.size,
        imageUrl: row.image_url,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    console.error('[XIMAGE2] Get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

app.delete('/api/ximage2/history/:id', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    await pool.query(
      'DELETE FROM ximage2_history WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('[XIMAGE2] Delete history error:', error);
    res.status(500).json({ error: 'Gagal menghapus' });
  }
});

app.delete('/api/ximage2/history', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    await pool.query(
      'DELETE FROM ximage2_history WHERE user_id = $1',
      [req.session.userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('[XIMAGE2] Delete all history error:', error);
    res.status(500).json({ error: 'Gagal menghapus semua' });
  }
});

app.get('/api/ximage2/download', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).json({ error: 'URL diperlukan' });
    }
    
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'User-Agent': 'Xclip/1.0' }
    });
    
    const contentType = response.headers['content-type'] || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="ximage2-${Date.now()}.png"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(Buffer.from(response.data));
  } catch (error) {
    console.error('[XIMAGE2] Download error:', error.message);
    res.status(500).json({ error: 'Gagal download image' });
  }
});

// ============ VOICE OVER (ELEVENLABS) API ============

const voiceCache = new Map(); // apiKey -> { voices, fetchedAt }

async function getVoiceoverRoomKey(xclipApiKey) {
  const keyInfo = await validateXclipApiKey(xclipApiKey);
  if (!keyInfo) return { error: 'Xclip API key tidak valid' };

  const subResult = await pool.query(
    `SELECT vs.voiceover_room_id, vr.key_name_1, vr.key_name_2, vr.key_name_3
     FROM voiceover_subscriptions vs
     JOIN voiceover_rooms vr ON vr.id = vs.voiceover_room_id
     WHERE vs.user_id = $1 AND vs.is_active = true
       AND (vs.expired_at IS NULL OR vs.expired_at > NOW())
     ORDER BY vs.created_at DESC LIMIT 1`,
    [keyInfo.user_id]
  );

  if (subResult.rows.length === 0) return { error: 'Tidak ada subscription Voice Over aktif', keyInfo };

  const room = subResult.rows[0];
  const keys = [room.key_name_1, room.key_name_2, room.key_name_3]
    .filter(Boolean)
    .map(n => ({ name: n, key: process.env[n] }))
    .filter(k => k.key);

  if (keys.length === 0) return { error: 'Voice Room belum dikonfigurasi', keyInfo };

  const idx = Math.floor(Date.now() / (3 * 60 * 1000)) % keys.length;
  return { apiKey: keys[idx].key, keyName: keys[idx].name, roomId: room.voiceover_room_id, keyInfo, allKeys: keys };
}

app.get('/api/voiceover/rooms', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, max_users, active_users, status,
              (max_users - active_users) as available_slots
       FROM voiceover_rooms ORDER BY id`
    );
    res.json({ rooms: result.rows.map(r => ({ ...r, status: r.status.toLowerCase() })) });
  } catch (e) {
    res.status(500).json({ error: 'Gagal memuat rooms' });
  }
});

app.get('/api/voiceover/subscription/status', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) return res.json({ hasSubscription: false });
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) return res.json({ hasSubscription: false });

    const subResult = await pool.query(
      `SELECT vs.*, vr.name as room_name, vr.status as room_status
       FROM voiceover_subscriptions vs
       JOIN voiceover_rooms vr ON vr.id = vs.voiceover_room_id
       WHERE vs.user_id = $1 AND vs.is_active = true
         AND (vs.expired_at IS NULL OR vs.expired_at > NOW())
       ORDER BY vs.created_at DESC LIMIT 1`,
      [keyInfo.user_id]
    );

    if (subResult.rows.length === 0) return res.json({ hasSubscription: false });
    const sub = subResult.rows[0];
    res.json({
      hasSubscription: true,
      subscription: {
        roomId: sub.voiceover_room_id,
        roomName: sub.room_name,
        expiredAt: sub.expired_at
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Gagal cek status' });
  }
});

app.post('/api/voiceover/rooms/:roomId/join', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) return res.status(401).json({ error: 'Xclip API key diperlukan' });
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) return res.status(401).json({ error: 'Xclip API key tidak valid' });

    const roomId = parseInt(req.params.roomId);
    const roomResult = await pool.query('SELECT * FROM voiceover_rooms WHERE id = $1', [roomId]);
    if (roomResult.rows.length === 0) return res.status(404).json({ error: 'Room tidak ditemukan' });

    const room = roomResult.rows[0];
    if (room.status !== 'OPEN') return res.status(400).json({ error: 'Room sedang maintenance' });
    if (room.active_users >= room.max_users) return res.status(400).json({ error: 'Room sudah penuh' });

    const existing = await pool.query(
      'SELECT * FROM voiceover_subscriptions WHERE user_id = $1 AND is_active = true AND (expired_at IS NULL OR expired_at > NOW()) LIMIT 1',
      [keyInfo.user_id]
    );

    if (existing.rows.length > 0) {
      const oldRoomId = existing.rows[0].voiceover_room_id;
      await pool.query('UPDATE voiceover_subscriptions SET is_active = false WHERE id = $1', [existing.rows[0].id]);
      await pool.query('UPDATE voiceover_rooms SET active_users = GREATEST(0, active_users - 1) WHERE id = $1', [oldRoomId]);
    }

    const expiredAt = req.body.expiredAt || null;
    await pool.query(
      'INSERT INTO voiceover_subscriptions (user_id, voiceover_room_id, expired_at, is_active) VALUES ($1, $2, $3, true)',
      [keyInfo.user_id, roomId, expiredAt]
    );
    await pool.query('UPDATE voiceover_rooms SET active_users = active_users + 1 WHERE id = $1', [roomId]);

    res.json({ success: true, message: `Berhasil join ${room.name}`, subscription: { roomId, roomName: room.name } });
  } catch (e) {
    console.error('Voiceover join room error:', e);
    res.status(500).json({ error: 'Gagal join room' });
  }
});

app.post('/api/voiceover/rooms/leave', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) return res.status(401).json({ error: 'Xclip API key diperlukan' });
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) return res.status(401).json({ error: 'Xclip API key tidak valid' });

    const subResult = await pool.query(
      'SELECT * FROM voiceover_subscriptions WHERE user_id = $1 AND is_active = true LIMIT 1',
      [keyInfo.user_id]
    );
    if (subResult.rows.length === 0) return res.json({ success: true });

    const sub = subResult.rows[0];
    await pool.query('UPDATE voiceover_subscriptions SET is_active = false WHERE id = $1', [sub.id]);
    await pool.query('UPDATE voiceover_rooms SET active_users = GREATEST(0, active_users - 1) WHERE id = $1', [sub.voiceover_room_id]);
    res.json({ success: true, message: 'Berhasil keluar room' });
  } catch (e) {
    res.status(500).json({ error: 'Gagal leave room' });
  }
});

const KIE_BUILTIN_VOICES = [
  { voice_id: 'Rachel', name: 'Rachel', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'narration' }, description: 'Professional female, calm & clear' },
  { voice_id: 'Drew', name: 'Drew', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'news' }, description: 'Well-rounded male, relaxed' },
  { voice_id: 'Clyde', name: 'Clyde', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'video-games' }, description: 'War veteran, confident' },
  { voice_id: 'Paul', name: 'Paul', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'news' }, description: 'Newscaster, authoritative' },
  { voice_id: 'Domi', name: 'Domi', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'narration' }, description: 'Strong, energetic female' },
  { voice_id: 'Dave', name: 'Dave', category: 'premade', labels: { gender: 'male', accent: 'british-essex', age: 'young', use_case: 'video-games' }, description: 'Conversational British male' },
  { voice_id: 'Fin', name: 'Fin', category: 'premade', labels: { gender: 'male', accent: 'irish', age: 'old', use_case: 'video-games' }, description: 'Sailor, old Irish accent' },
  { voice_id: 'Sarah', name: 'Sarah', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'news' }, description: 'Soft, empathetic female' },
  { voice_id: 'Antoni', name: 'Antoni', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'young', use_case: 'narration' }, description: 'Well-rounded male voice' },
  { voice_id: 'Thomas', name: 'Thomas', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'young', use_case: 'meditation' }, description: 'Calm, meditative male' },
  { voice_id: 'Charlie', name: 'Charlie', category: 'premade', labels: { gender: 'male', accent: 'australian', age: 'middle-aged', use_case: 'conversational' }, description: 'Casual Australian male' },
  { voice_id: 'George', name: 'George', category: 'premade', labels: { gender: 'male', accent: 'british', age: 'middle-aged', use_case: 'narration' }, description: 'Warm, authoritative British' },
  { voice_id: 'Emily', name: 'Emily', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'meditation' }, description: 'Calm, meditation female' },
  { voice_id: 'Elli', name: 'Elli', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'narration' }, description: 'Emotional, youthful female' },
  { voice_id: 'Callum', name: 'Callum', category: 'premade', labels: { gender: 'male', accent: 'transatlantic', age: 'middle-aged', use_case: 'video-games' }, description: 'Intense, hoarse male' },
  { voice_id: 'Patrick', name: 'Patrick', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'video-games' }, description: 'Shouty, aggressive male' },
  { voice_id: 'Harry', name: 'Harry', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'young', use_case: 'video-games' }, description: 'Anxious, whisper male' },
  { voice_id: 'Liam', name: 'Liam', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'young', use_case: 'narration' }, description: 'Articulate, clear male' },
  { voice_id: 'Dorothy', name: 'Dorothy', category: 'premade', labels: { gender: 'female', accent: 'british', age: 'young', use_case: 'children-stories' }, description: 'Pleasant, evocative British' },
  { voice_id: 'Josh', name: 'Josh', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'young', use_case: 'narration' }, description: 'Deep, resonant male' },
  { voice_id: 'Arnold', name: 'Arnold', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'narration' }, description: 'Crisp, authoritative male' },
  { voice_id: 'Charlotte', name: 'Charlotte', category: 'premade', labels: { gender: 'female', accent: 'swedish', age: 'young', use_case: 'video-games' }, description: 'Seductive, confident female' },
  { voice_id: 'Matilda', name: 'Matilda', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'narration' }, description: 'Warm, nurturing female' },
  { voice_id: 'Matthew', name: 'Matthew', category: 'premade', labels: { gender: 'male', accent: 'british', age: 'middle-aged', use_case: 'narration' }, description: 'Audiobook, warm British' },
  { voice_id: 'James', name: 'James', category: 'premade', labels: { gender: 'male', accent: 'australian', age: 'old', use_case: 'news' }, description: 'Calm, Australian news' },
  { voice_id: 'Joseph', name: 'Joseph', category: 'premade', labels: { gender: 'male', accent: 'british', age: 'middle-aged', use_case: 'news' }, description: 'Grounded, British news' },
  { voice_id: 'Jeremy', name: 'Jeremy', category: 'premade', labels: { gender: 'male', accent: 'american-irish', age: 'young', use_case: 'narration' }, description: 'Excited, male narrator' },
  { voice_id: 'Michael', name: 'Michael', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'old', use_case: 'narration' }, description: 'Orotund, authoritative' },
  { voice_id: 'Ethan', name: 'Ethan', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'young', use_case: 'ASMR' }, description: 'Soft, ASMR male' },
  { voice_id: 'Chris', name: 'Chris', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'conversational' }, description: 'Conversational, friendly' },
  { voice_id: 'Gigi', name: 'Gigi', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'children-stories' }, description: 'Childlike, playful female' },
  { voice_id: 'Freya', name: 'Freya', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'video-games' }, description: 'Overhyped, expressive female' },
  { voice_id: 'Grace', name: 'Grace', category: 'premade', labels: { gender: 'female', accent: 'southern-american', age: 'young', use_case: 'audiobook' }, description: 'Gentle southern female' },
  { voice_id: 'Daniel', name: 'Daniel', category: 'premade', labels: { gender: 'male', accent: 'british', age: 'middle-aged', use_case: 'news' }, description: 'Deep, authoritative British' },
  { voice_id: 'Lily', name: 'Lily', category: 'premade', labels: { gender: 'female', accent: 'british', age: 'young', use_case: 'narration' }, description: 'Warm, British female' },
  { voice_id: 'Serena', name: 'Serena', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'middle-aged', use_case: 'interactive' }, description: 'Polished, interactive AI' },
  { voice_id: 'Adam', name: 'Adam', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'narration' }, description: 'Deep, professional male' },
  { voice_id: 'Nicole', name: 'Nicole', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'audiobook' }, description: 'Whispery, intimate female' },
  { voice_id: 'Bill', name: 'Bill', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'old', use_case: 'documentary' }, description: 'Trustworthy documentary' },
  { voice_id: 'Jessie', name: 'Jessie', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'old', use_case: 'video-games' }, description: 'Raspy, old-fashioned male' },
  { voice_id: 'Ryan', name: 'Ryan', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'young', use_case: 'audiobook' }, description: 'Soldier, intense audiobook' },
  { voice_id: 'Sam', name: 'Sam', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'young', use_case: 'narration' }, description: 'Raspy, strong male' },
  { voice_id: 'Glinda', name: 'Glinda', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'middle-aged', use_case: 'video-games' }, description: 'Witch, dramatic female' },
  { voice_id: 'Giovanni', name: 'Giovanni', category: 'premade', labels: { gender: 'male', accent: 'english-italian', age: 'young', use_case: 'audiobook' }, description: 'Foreigner, Italian accent' },
  { voice_id: 'Mimi', name: 'Mimi', category: 'premade', labels: { gender: 'female', accent: 'english-swedish', age: 'young', use_case: 'video-games' }, description: 'Childlike, Swedish accent' },
  { voice_id: 'Brian', name: 'Brian', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'narration' }, description: 'Deep, broadcast male' },
  { voice_id: 'Jessica', name: 'Jessica', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'conversational' }, description: 'Expressive, lively female' },
  { voice_id: 'Eric', name: 'Eric', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'conversational' }, description: 'Friendly, conversational' },
  { voice_id: 'Chris', name: 'Chris', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'conversational' }, description: 'Casual male, versatile' },
  { voice_id: 'Laura', name: 'Laura', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'social-media' }, description: 'Upbeat, social media' },
  { voice_id: 'Aria', name: 'Aria', category: 'premade', labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'social-media' }, description: 'Expressive, modern female' },
  { voice_id: 'Roger', name: 'Roger', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'middle-aged', use_case: 'news' }, description: 'Confident, professional' },
  { voice_id: 'Will', name: 'Will', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'young', use_case: 'social-media' }, description: 'Friendly, social media' },
  { voice_id: 'Alice', name: 'Alice', category: 'premade', labels: { gender: 'female', accent: 'british', age: 'middle-aged', use_case: 'news' }, description: 'Mature, British news' },
  { voice_id: 'Marcus', name: 'Marcus', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'young', use_case: 'conversational' }, description: 'Confident, casual male' },
  { voice_id: 'Valentino', name: 'Valentino', category: 'premade', labels: { gender: 'male', accent: 'american', age: 'old', use_case: 'narration' }, description: 'Great storytelling male' },
];

app.get('/api/voiceover/voices', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) return res.status(401).json({ error: 'Xclip API key diperlukan' });
    const roomKeyData = await getVoiceoverRoomKey(xclipApiKey);
    if (roomKeyData.error && !roomKeyData.keyInfo) return res.status(401).json({ error: roomKeyData.error });
    res.json({ voices: KIE_BUILTIN_VOICES });
  } catch (e) {
    console.error('[VOICEOVER] Fetch voices error:', e.message);
    res.status(500).json({ error: 'Gagal memuat daftar suara' });
  }
});

app.post('/api/voiceover/generate', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) return res.status(401).json({ error: 'Xclip API key diperlukan' });

    const { text, voiceId, voiceName, modelId, stability, similarityBoost, style, useSpeakerBoost, dialogue } = req.body;
    const kieModel = modelId || 'elevenlabs/text-to-speech-multilingual-v2';
    const isDialogue = kieModel === 'elevenlabs/text-to-dialogue-v3';

    if (isDialogue) {
      if (!dialogue || !Array.isArray(dialogue) || dialogue.length === 0) return res.status(400).json({ error: 'Dialogue array diperlukan untuk model v3' });
    } else {
      if (!text || !voiceId) return res.status(400).json({ error: 'Teks dan voice diperlukan' });
      if (text.length > 5000) return res.status(400).json({ error: 'Teks maksimal 5000 karakter' });
    }

    const roomKeyData = await getVoiceoverRoomKey(xclipApiKey);
    if (roomKeyData.error && !roomKeyData.keyInfo) return res.status(401).json({ error: roomKeyData.error });
    if (roomKeyData.error) return res.status(403).json({ error: roomKeyData.error });

    const keyInfo = roomKeyData.keyInfo;
    const allKeys = roomKeyData.allKeys || [{ name: roomKeyData.keyName, key: roomKeyData.apiKey }];

    const cooldownRemaining = getUserCooldownRemaining(keyInfo.user_id, 'voiceover');
    if (cooldownRemaining > 0) {
      const cooldownSec = Math.ceil(cooldownRemaining / 1000);
      return res.status(429).json({
        error: `Mohon tunggu ${cooldownSec} detik sebelum generate voice over berikutnya`,
        cooldown: cooldownSec,
        cooldownMs: cooldownRemaining
      });
    }

    console.log(`[VOICEOVER] Generating via kie.ai | user: ${keyInfo.user_id} | voice: ${voiceId || 'dialogue'} | model: ${kieModel} | chars: ${text ? text.length : 'n/a'} | keys: ${allKeys.length}`);

    const kieInput = isDialogue
      ? { dialogue, stability: stability ?? 0.5 }
      : {
          text,
          voice: voiceId,
          stability: stability ?? 0.5,
          similarity_boost: similarityBoost ?? 0.75,
          style: style ?? 0,
          use_speaker_boost: useSpeakerBoost ?? true,
          speed: 1
        };

    let taskId = null;
    let lastAuthError = null;
    let usedKeyName = null;
    
    for (const keyEntry of allKeys) {
      try {
        console.log(`[VOICEOVER] Trying key: ${keyEntry.name}`);
        const createRes = await axios.post(
          'https://api.kie.ai/api/v1/jobs/createTask',
          { model: kieModel, input: kieInput },
          {
            headers: {
              'Authorization': `Bearer ${keyEntry.key}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );

        const respData = createRes.data;
        console.log(`[VOICEOVER] kie.ai response (${keyEntry.name}):`, JSON.stringify(respData).substring(0, 300));
        
        if (respData.code && respData.code !== 200) {
          const isAuthErr = respData.code === 401 || respData.code === 403 || (respData.msg && /unauthorized|auth|forbidden/i.test(respData.msg));
          if (isAuthErr) {
            console.warn(`[VOICEOVER] Key ${keyEntry.name} auth failed: ${respData.msg}`);
            lastAuthError = respData.msg;
            continue;
          }
          return res.status(400).json({ error: `kie.ai: ${respData.msg}` });
        }
        
        taskId = respData?.data?.taskId || respData?.data?.task_id || respData?.taskId || respData?.task_id || respData?.data?.id || respData?.id;
        if (taskId) {
          usedKeyName = keyEntry.name;
          break;
        }
        console.error(`[VOICEOVER] No taskId from ${keyEntry.name}. Keys:`, respData.data ? Object.keys(respData.data) : 'N/A');
      } catch (keyErr) {
        const status = keyErr.response?.status;
        if (status === 401 || status === 403) {
          console.warn(`[VOICEOVER] Key ${keyEntry.name} HTTP ${status} auth error`);
          lastAuthError = keyErr.response?.data?.msg || keyErr.response?.data?.message || `HTTP ${status}`;
          continue;
        }
        throw keyErr;
      }
    }
    
    if (!taskId) {
      if (lastAuthError) {
        return res.status(401).json({ error: `Semua API key voiceover expired/invalid. Error terakhir: ${lastAuthError}` });
      }
      return res.status(500).json({ error: 'Tidak mendapat taskId dari kie.ai setelah mencoba semua key' });
    }

    console.log(`[VOICEOVER] Task submitted: ${taskId} (key: ${usedKeyName})`);

    const workingKey = allKeys.find(k => k.name === usedKeyName)?.key || allKeys[0]?.key;
    let audioKieUrl = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await axios.get(
        `https://api.kie.ai/api/v1/jobs/recordInfo`,
        {
          params: { taskId },
          headers: { 'Authorization': `Bearer ${workingKey}` },
          timeout: 15000
        }
      );
      const taskData = statusRes.data?.data || statusRes.data;
      const state = taskData?.state;
      console.log(`[VOICEOVER] Poll ${attempt + 1} | state: ${state} | taskId: ${taskId}`);
      if (state === 'success' || state === 'succeeded' || state === 'completed') {
        try {
          const resultObj = typeof taskData.resultJson === 'string' ? JSON.parse(taskData.resultJson) : taskData.resultJson;
          audioKieUrl = resultObj?.resultUrls?.[0] || resultObj?.audio_url || resultObj?.audioUrl;
        } catch (e) {
          audioKieUrl = taskData?.result?.audio_url || taskData?.audioUrl;
        }
        if (!audioKieUrl) throw new Error(`kie.ai task selesai tapi tidak ada URL audio: ${JSON.stringify(taskData)}`);
        break;
      }
      if (state === 'failed' || state === 'error') {
        throw new Error(`kie.ai task gagal: ${taskData?.failMsg || JSON.stringify(taskData)}`);
      }
    }

    if (!audioKieUrl) throw new Error('Timeout menunggu audio dari kie.ai');

    const audioDownload = await axios.get(audioKieUrl, { responseType: 'arraybuffer', timeout: 60000 });
    const audioBuffer = Buffer.from(audioDownload.data);
    const filename = `voiceover_${Date.now()}_${Math.random().toString(36).substr(2, 8)}.mp3`;
    const uploadDir = path.join(__dirname, 'uploads');
    if (!require('fs').existsSync(uploadDir)) require('fs').mkdirSync(uploadDir, { recursive: true });
    require('fs').writeFileSync(path.join(uploadDir, filename), audioBuffer);

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const audioUrl = `${protocol}://${host}/uploads/${filename}`;

    const charsUsed = text ? text.length : (dialogue || []).reduce((sum, d) => sum + (d.text || '').length, 0);
    const displayVoice = isDialogue ? (dialogue.map(d => d.voice).join(', ')) : (voiceId || 'unknown');

    const historyResult = await pool.query(
      `INSERT INTO voiceover_history (user_id, xclip_api_key_id, voice_id, voice_name, model_id, text_input, audio_url, characters_used, room_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [keyInfo.user_id, keyInfo.id, displayVoice, voiceName || displayVoice, kieModel, (text || '').substring(0, 500), audioUrl, charsUsed, roomKeyData.roomId]
    );

    setUserCooldown(keyInfo.user_id, 'voiceover');
    console.log(`[VOICEOVER] Generated successfully | URL: ${audioUrl}`);

    res.json({
      success: true,
      audioUrl,
      historyId: historyResult.rows[0].id,
      charactersUsed: charsUsed,
      cooldown: 120
    });
  } catch (e) {
    console.error('[VOICEOVER] Generate error:', e.response?.data ? JSON.stringify(e.response.data) : e.message);
    const status = e.response?.status;
    if (status === 401 || status === 403) return res.status(500).json({ error: 'kie.ai API key tidak valid atau tidak punya akses' });
    if (status === 429) return res.status(429).json({ error: 'Rate limit kie.ai tercapai. Coba lagi nanti.' });
    res.status(500).json({ error: e.message || 'Gagal generate voice over' });
  }
});

app.get('/api/voiceover/history', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) return res.status(401).json({ error: 'Xclip API key diperlukan' });
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) return res.status(401).json({ error: 'Xclip API key tidak valid' });

    const result = await pool.query(
      `SELECT id, voice_id, voice_name, model_id, text_input, audio_url, characters_used, created_at
       FROM voiceover_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [keyInfo.user_id]
    );
    res.json({ history: result.rows });
  } catch (e) {
    res.status(500).json({ error: 'Gagal ambil history' });
  }
});

app.delete('/api/voiceover/history/:id', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) return res.status(401).json({ error: 'Xclip API key diperlukan' });
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) return res.status(401).json({ error: 'Xclip API key tidak valid' });

    await pool.query('DELETE FROM voiceover_history WHERE id = $1 AND user_id = $2', [req.params.id, keyInfo.user_id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Gagal hapus history' });
  }
});

// Admin: Subscribe user to voiceover room
app.post('/api/admin/voiceover/subscribe', requireAdmin, async (req, res) => {
  try {
    const { userId, roomId, expiredAt } = req.body;
    if (!userId || !roomId) return res.status(400).json({ error: 'userId dan roomId diperlukan' });

    const existing = await pool.query(
      'SELECT * FROM voiceover_subscriptions WHERE user_id = $1 AND is_active = true LIMIT 1',
      [userId]
    );
    if (existing.rows.length > 0) {
      await pool.query('UPDATE voiceover_subscriptions SET is_active = false WHERE id = $1', [existing.rows[0].id]);
      await pool.query('UPDATE voiceover_rooms SET active_users = GREATEST(0, active_users - 1) WHERE id = $1', [existing.rows[0].voiceover_room_id]);
    }

    await pool.query(
      'INSERT INTO voiceover_subscriptions (user_id, voiceover_room_id, expired_at, is_active) VALUES ($1, $2, $3, true)',
      [userId, roomId, expiredAt || null]
    );
    await pool.query('UPDATE voiceover_rooms SET active_users = active_users + 1 WHERE id = $1', [roomId]);
    res.json({ success: true, message: 'User berhasil di-subscribe ke voice room' });
  } catch (e) {
    res.status(500).json({ error: 'Gagal subscribe user' });
  }
});

// ============ END VOICE OVER API ============

// ============ X IMAGE3 (POYO AI) API ============

const XIMAGE3_MODELS = {
  'gpt-4o-image': { name: 'GPT-4o Image', provider: 'OpenAI', supportsI2I: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxN: 4, maxRefs: 1, desc: 'OpenAI GPT-4o image generation' },
  'gpt-image-1.5': { name: 'GPT Image 1.5', provider: 'OpenAI', supportsI2I: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxN: 4, maxRefs: 1, desc: 'OpenAI GPT Image 1.5 - 4x faster, precision editing' },
  'nano-banana-2-new': { name: 'Nano Banana 2', provider: 'Google', supportsI2I: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxN: 1, maxRefs: 14, resolutions: ['1K', '2K', '4K'], defaultResolution: '2K', desc: 'Google Gemini 3.1 Flash - native 2K/4K' },
  'nano-banana-2': { name: 'Nano Banana Pro', provider: 'Google', supportsI2I: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxN: 1, maxRefs: 14, resolutions: ['1K', '2K', '4K'], defaultResolution: '1K', desc: 'Google Gemini 3 Pro - advanced text & character consistency' },
  'grok-imagine-image': { name: 'Grok Imagine', provider: 'xAI', supportsI2I: true, sizes: ['1:1', '2:3', '3:2'], maxN: 1, maxRefs: 1, desc: 'xAI Aurora - creative modes (Fun/Normal/Spicy)' },
  'seedream-5.0-lite': { name: 'Seedream 5.0 Lite', provider: 'ByteDance', supportsI2I: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxN: 4, maxRefs: 14, resolutions: ['1K', '2K', '3K'], defaultResolution: '2K', desc: 'ByteDance Seedream 5.0 - web search, reasoning, 3K' },
  'seedream-4.5': { name: 'Seedream 4.5', provider: 'ByteDance', supportsI2I: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxN: 4, maxRefs: 14, desc: 'ByteDance Seedream 4.5 - ultra 4K cinematic' },
  'flux-kontext-pro': { name: 'Flux Kontext Pro', provider: 'Black Forest Labs', supportsI2I: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxN: 1, maxRefs: 4, desc: 'FLUX Kontext Pro - character consistency' },
  'flux-2-pro': { name: 'Flux 2 Pro', provider: 'Black Forest Labs', supportsI2I: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'], maxN: 1, maxRefs: 8, resolutions: ['1K', '2K'], defaultResolution: '1K', desc: 'FLUX 2 Pro - 32B param, photoreal, typography' },
  'flux-2-flex': { name: 'Flux 2 Flex', provider: 'Black Forest Labs', supportsI2I: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'], maxN: 1, maxRefs: 8, resolutions: ['1K', '2K'], defaultResolution: '1K', desc: 'FLUX 2 Flex - adjustable speed vs quality' }
};

async function getXImage3RoomApiKey(xclipApiKey) {
  const keyInfo = await validateXclipApiKey(xclipApiKey);
  if (!keyInfo) return { error: 'Xclip API key tidak valid' };
  const subResult = await pool.query('SELECT s.ximage3_room_id FROM subscriptions s WHERE s.user_id = $1 AND s.ximage3_room_id IS NOT NULL ORDER BY s.created_at DESC LIMIT 1', [keyInfo.user_id]);
  const roomId = subResult.rows[0]?.ximage3_room_id || 1;
  const roomKeyPrefix = 'XIMAGE3_ROOM' + roomId + '_KEY_';
  const availableKeys = [1, 2, 3].map(i => roomKeyPrefix + i).filter(k => process.env[k]);
  if (availableKeys.length === 0) {
    if (process.env.POYO_API_KEY) return { apiKey: process.env.POYO_API_KEY, keyName: 'POYO_API_KEY', roomId, userId: keyInfo.user_id, keyInfoId: keyInfo.id };
    return { error: 'Tidak ada API key X Image3 yang tersedia. Hubungi admin.' };
  }
  const randomKeyName = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  return { apiKey: process.env[randomKeyName], keyName: randomKeyName, roomId, userId: keyInfo.user_id, keyInfoId: keyInfo.id };
}

app.get('/api/ximage3/subscription-status', async (req, res) => {
  let userId = req.session.userId;
  
  if (!userId) {
    const xclipApiKey = req.headers['x-xclip-key'] || req.query.apiKey;
    if (xclipApiKey) {
      const keyInfo = await validateXclipApiKey(xclipApiKey);
      if (keyInfo) userId = keyInfo.user_id;
    }
  }
  
  if (!userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  try {
    const result = await pool.query(`
      SELECT s.ximage3_room_id, r.name as room_name
      FROM subscriptions s
      LEFT JOIN ximage3_rooms r ON r.id = s.ximage3_room_id
      WHERE s.user_id = $1 AND s.ximage3_room_id IS NOT NULL
      ORDER BY s.created_at DESC LIMIT 1
    `, [userId]);
    if (result.rows.length > 0 && result.rows[0].ximage3_room_id) {
      res.json({
        hasSubscription: true,
        subscription: {
          roomId: result.rows[0].ximage3_room_id,
          roomName: result.rows[0].room_name
        }
      });
    } else {
      res.json({ hasSubscription: false, subscription: null });
    }
  } catch (error) {
    console.error('[XIMAGE3] Subscription status error:', error);
    res.status(500).json({ error: 'Gagal mendapatkan status subscription' });
  }
});

app.get('/api/ximage3/models', (req, res) => {
  const models = Object.entries(XIMAGE3_MODELS).map(([id, info]) => ({
    id, ...info
  }));
  res.json({ models });
});

app.get('/api/ximage3/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, max_users, current_users, status 
      FROM ximage3_rooms 
      ORDER BY id
    `);
    res.json({ rooms: result.rows });
  } catch (error) {
    console.error('[XIMAGE3] Get rooms error:', error);
    res.status(500).json({ error: 'Gagal mendapatkan daftar room' });
  }
});

app.post('/api/ximage3/join-room', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  
  try {
    const { roomId, xclipApiKey } = req.body;
    
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) {
      return res.status(400).json({ error: 'Xclip API key tidak valid' });
    }
    
    const roomResult = await pool.query(
      'SELECT * FROM ximage3_rooms WHERE id = $1', 
      [roomId]
    );
    
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room tidak ditemukan' });
    }
    
    const room = roomResult.rows[0];
    if (room.status !== 'OPEN') {
      return res.status(400).json({ error: 'Room sedang tidak tersedia' });
    }
    
    if (room.current_users >= room.max_users) {
      return res.status(400).json({ error: 'Room sudah penuh' });
    }
    
    const userId = keyInfo.user_id;
    
    const oldRoomResult = await pool.query(
      'SELECT ximage3_room_id FROM subscriptions WHERE user_id = $1 AND ximage3_room_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    const oldRoomId = oldRoomResult.rows[0]?.ximage3_room_id;

    const updateResult = await pool.query(`
      UPDATE subscriptions SET ximage3_room_id = $1 
      WHERE user_id = $2 AND status = 'active'
    `, [roomId, userId]);
    
    if (updateResult.rowCount === 0) {
      const existingSub = await pool.query(
        'SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
        [userId]
      );
      if (existingSub.rows.length > 0) {
        await pool.query(
          'UPDATE subscriptions SET ximage3_room_id = $1 WHERE id = $2',
          [roomId, existingSub.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO subscriptions (user_id, status, ximage3_room_id, created_at, expired_at) 
           VALUES ($1, 'active', $2, NOW(), NOW() + INTERVAL '365 days')`,
          [userId, roomId]
        );
        console.log(`[XIMAGE3] Created new subscription for user ${userId} with room ${roomId}`);
      }
    }
    
    if (oldRoomId && oldRoomId !== roomId) {
      await pool.query(
        'UPDATE ximage3_rooms SET current_users = GREATEST(0, current_users - 1) WHERE id = $1',
        [oldRoomId]
      );
    }
    
    if (!oldRoomId || oldRoomId !== roomId) {
      await pool.query(
        'UPDATE ximage3_rooms SET current_users = current_users + 1 WHERE id = $1',
        [roomId]
      );
    }
    
    console.log(`[XIMAGE3] User ${userId} joined room ${roomId} (${room.name}), old room: ${oldRoomId || 'none'}`);
    
    res.json({ 
      success: true, 
      message: `Berhasil bergabung ke ${room.name}`,
      roomId,
      roomName: room.name
    });
  } catch (error) {
    console.error('[XIMAGE3] Join room error:', error);
    res.status(500).json({ error: 'Gagal bergabung ke room' });
  }
});

app.post('/api/ximage3/generate', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const roomKeyResult = await getXImage3RoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      return res.status(400).json({ error: roomKeyResult.error });
    }
    
    const ximage3Cooldown = getUserCooldownRemaining(roomKeyResult.userId, 'ximage3');
    if (ximage3Cooldown > 0) {
      const cooldownSec = Math.ceil(ximage3Cooldown / 1000);
      return res.status(429).json({
        error: `Mohon tunggu ${cooldownSec} detik sebelum generate gambar berikutnya`,
        cooldown: cooldownSec,
        cooldownMs: ximage3Cooldown
      });
    }
    
    const { model, prompt, images, size, resolution } = req.body;
    const n = req.body.numberOfImages || req.body.n || 1;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt diperlukan' });
    }
    
    const modelConfig = XIMAGE3_MODELS[model];
    if (!modelConfig) {
      return res.status(400).json({ error: 'Model tidak valid' });
    }
    
    const isI2I = images && images.length > 0;
    if (isI2I && !modelConfig.supportsI2I) {
      return res.status(400).json({ error: `Model ${modelConfig.name} tidak mendukung image-to-image` });
    }
    
    console.log(`[XIMAGE3] Generating with model: ${model}, size: ${size || 'default'}, n: ${n || 1}, i2i: ${isI2I}`);
    
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    
    let imageUrls = [];
    if (isI2I) {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img && img.startsWith('data:')) {
          const uploaded = await saveBase64ToFile(img, 'image', baseUrl);
          imageUrls.push(uploaded.publicUrl);
          console.log(`[XIMAGE3] Image ${i + 1} uploaded: ${uploaded.publicUrl}`);
        } else if (img) {
          imageUrls.push(img);
        }
      }
    }
    
    const inputObj = { prompt };
    if (size) inputObj.size = size;
    inputObj.n = Math.min(parseInt(n) || 1, modelConfig.maxN || 1);
    if (imageUrls.length > 0) inputObj.image_urls = imageUrls.slice(0, modelConfig.maxRefs);
    if (modelConfig.resolutions && resolution) {
      const normalizedRes = resolution.toUpperCase();
      if (!modelConfig.resolutions.includes(normalizedRes)) {
        return res.status(400).json({ error: `Invalid resolution, must be one of ${modelConfig.resolutions.map(r => "'" + r + "'").join(', ')} (uppercase K)` });
      }
      inputObj.resolution = normalizedRes;
    }
    
    const webhookUrl = `${baseUrl}/api/ximage3/webhook`;
    
    const requestBody = {
      model: model,
      callback_url: webhookUrl,
      input: inputObj
    };
    
    console.log('[XIMAGE3] Request body:', JSON.stringify({ ...requestBody, input: { ...requestBody.input, image_urls: requestBody.input.image_urls ? ['[IMAGES]'] : undefined } }));
    
    const response = await axios.post(
      'https://api.poyo.ai/api/generate/submit',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${roomKeyResult.apiKey}`
        },
        timeout: 600000
      }
    );
    
    console.log('[XIMAGE3] Poyo API response status:', response.status);
    console.log('[XIMAGE3] Poyo API response data:', JSON.stringify(response.data));
    
    const respData = response.data;
    
    if (respData.code && respData.code !== 200 && respData.error) {
      const errMsg = respData.error?.message || respData.error || 'Poyo API error';
      console.error('[XIMAGE3] Poyo API returned error in 200 response:', errMsg);
      return res.status(400).json({ error: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg) });
    }
    
    const taskId = respData.data?.task_id || 
                   respData.task_id || 
                   respData.data?.id ||
                   respData.id ||
                   respData.data?.request_id ||
                   respData.request_id;
    
    if (!taskId) {
      console.error('[XIMAGE3] No task ID in response. Full response keys:', Object.keys(respData), 'data keys:', respData.data ? Object.keys(respData.data) : 'N/A');
      console.error('[XIMAGE3] Full response:', JSON.stringify(respData));
      return res.status(500).json({ error: 'Tidak mendapat task ID dari Poyo AI. Response: ' + JSON.stringify(respData).substring(0, 200) });
    }
    
    await pool.query(`
      INSERT INTO ximage3_history (user_id, task_id, model, prompt, mode, size, reference_image, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
    `, [roomKeyResult.userId, taskId, model, prompt, isI2I ? 'image-to-image' : 'text-to-image', size || '1:1', imageUrls.length > 0 ? imageUrls[0] : null]);
    
    await pool.query(
      'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [roomKeyResult.keyInfoId]
    );
    
    setUserCooldown(roomKeyResult.userId, 'ximage3');
    
    startServerBgPoll(taskId, 'poyo', roomKeyResult.apiKey, {
      dbTable: 'ximage3_history',
      urlColumn: 'image_url',
      model: model,
      userId: roomKeyResult.userId
    });
    
    res.json({
      success: true,
      taskId: taskId,
      model: model,
      cooldown: Math.ceil(RATE_LIMIT_CONFIG.ximage3.cooldownMs / 1000),
      message: 'Image generation dimulai'
    });
    
  } catch (error) {
    const errData = error.response?.data;
    const rawMsg = errData?.error?.message || errData?.message || errData?.error || error.message;
    console.error('[XIMAGE3] Generate error:', JSON.stringify(errData || error.message));
    console.error('[XIMAGE3] Status:', error.response?.status, 'Model:', req.body?.model);
    
    let userMsg = typeof rawMsg === 'string' ? rawMsg : 'Gagal generate image';
    if (userMsg.includes('timeout') || userMsg.includes('ETIMEDOUT')) {
      userMsg = 'Request timeout. Server Poyo AI terlalu lama merespon, coba lagi.';
    }
    
    res.status(error.response?.status || 500).json({ error: userMsg });
  }
});

app.get('/api/ximage3/status/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const xclipApiKey = req.headers['x-xclip-key'];
    
    if (!xclipApiKey) {
      return res.status(401).json({ error: 'Xclip API key diperlukan' });
    }
    
    const roomKeyResult = await getXImage3RoomApiKey(xclipApiKey);
    if (roomKeyResult.error) {
      return res.status(400).json({ error: roomKeyResult.error });
    }
    
    const localTask = await pool.query(
      'SELECT * FROM ximage3_history WHERE task_id = $1 AND user_id = $2',
      [taskId, roomKeyResult.userId]
    );
    
    if (localTask.rows.length > 0 && localTask.rows[0].status === 'completed') {
      return res.json({
        status: 'completed',
        imageUrl: localTask.rows[0].image_url
      });
    }
    
    if (localTask.rows.length > 0 && localTask.rows[0].status === 'failed') {
      return res.json({
        status: 'failed',
        error: 'Image generation failed'
      });
    }
    
    let statusResponse;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        statusResponse = await axios.get(
          `https://api.poyo.ai/api/generate/status/${taskId}`,
          {
            headers: { 'Authorization': `Bearer ${roomKeyResult.apiKey}` },
            timeout: 30000
          }
        );
        break;
      } catch (retryErr) {
        const msg = (retryErr.message || '').toLowerCase();
        const isNetErr = !retryErr.response && (msg.includes('socket hang up') || msg.includes('econnreset') || msg.includes('etimedout'));
        if (isNetErr && attempt < 2) {
          console.log(`[XIMAGE3] Status poll network error, retry ${attempt + 1}/3`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        throw retryErr;
      }
    }
    
    console.log('[XIMAGE3] Status response:', JSON.stringify(statusResponse.data));
    
    const raw = statusResponse.data;
    const data = raw.data || raw;
    const status = data.status || data.state || data.to_status || raw.status;
    
    if (status === 'finished' || status === 'completed' || status === 'success') {
      let imageUrl = null;
      if (data.files && data.files.length > 0) {
        const f = data.files[0];
        imageUrl = typeof f === 'string' ? f : (f.url || f.file_url || f.image_url);
      } else if (data.images && data.images.length > 0) {
        imageUrl = typeof data.images[0] === 'string' ? data.images[0] : (data.images[0].url || data.images[0].image_url);
      } else if (raw.files && raw.files.length > 0) {
        const f = raw.files[0];
        imageUrl = typeof f === 'string' ? f : (f.url || f.file_url || f.image_url);
      } else if (raw.images && raw.images.length > 0) {
        imageUrl = typeof raw.images[0] === 'string' ? raw.images[0] : (raw.images[0].url || raw.images[0].image_url);
      } else if (data.output?.images?.[0]) {
        const oi = data.output.images[0];
        imageUrl = typeof oi === 'string' ? oi : (oi.url || oi.image_url);
      } else if (data.output?.image_url) {
        imageUrl = data.output.image_url;
      } else if (data.output?.url) {
        imageUrl = data.output.url;
      } else if (data.result?.images?.[0]) {
        const ri = data.result.images[0];
        imageUrl = typeof ri === 'string' ? ri : (ri.url || ri.image_url);
      } else if (data.result?.image_url) {
        imageUrl = data.result.image_url;
      } else if (data.result?.url) {
        imageUrl = data.result.url;
      } else if (data.image_url) {
        imageUrl = data.image_url;
      } else if (data.media_url) {
        imageUrl = data.media_url;
      } else if (data.url) {
        imageUrl = data.url;
      }
      
      if (!imageUrl) {
        console.error('[XIMAGE3] Completed but no image URL. Keys:', Object.keys(raw), 'data keys:', Object.keys(data), 'Full:', JSON.stringify(raw).substring(0, 500));
        return res.status(500).json({ status: 'failed', error: 'No image URL in response' });
      }
      
      await pool.query(`
        UPDATE ximage3_history 
        SET status = 'completed', image_url = $1, completed_at = NOW()
        WHERE task_id = $2
      `, [imageUrl, taskId]);
      
      return res.json({ status: 'completed', imageUrl });
    }
    
    if (status === 'failed' || status === 'error') {
      const errorMsg = data.error?.message || data.error_message || data.message || 'Generation failed';
      
      await pool.query(`
        UPDATE ximage3_history 
        SET status = 'failed', completed_at = NOW()
        WHERE task_id = $1
      `, [taskId]);
      
      return res.json({ status: 'failed', error: errorMsg });
    }
    
    const progress = data.progress || data.percent || 0;
    res.json({
      status: 'processing',
      progress,
      message: 'Image sedang diproses...'
    });
    
  } catch (error) {
    console.error('[XIMAGE3] Status check error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Gagal check status' });
  }
});

app.get('/api/ximage3/history', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ images: [] });
  }
  
  try {
    const result = await pool.query(`
      SELECT * FROM ximage3_history 
      WHERE user_id = $1 AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.session.userId]);
    
    res.json({ 
      images: result.rows.map(row => ({
        id: row.id,
        taskId: row.task_id,
        model: row.model,
        prompt: row.prompt,
        mode: row.mode,
        size: row.size,
        imageUrl: row.image_url,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    console.error('[XIMAGE3] Get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

app.delete('/api/ximage3/history/:id', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login diperlukan' });
  }
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) return res.status(401).json({ error: 'Xclip API key diperlukan' });
    const keyInfo = await validateXclipApiKey(xclipApiKey);
    if (!keyInfo) return res.status(401).json({ error: 'Xclip API key tidak valid' });
    await pool.query('DELETE FROM ximage3_history WHERE id = $1 AND user_id = $2', [req.params.id, keyInfo.user_id]);
    res.json({ success: true });
  } catch (error) {
    console.error('[XIMAGE3] Delete history error:', error);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

app.get('/api/ximage3/proxy-image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).json({ error: 'URL diperlukan' });
    }
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'User-Agent': 'Xclip/1.0' }
    });
    const contentType = response.headers['content-type'] || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(response.data));
  } catch (error) {
    const status = error.response?.status || 500;
    if (status === 404) {
      console.warn('[XIMAGE3] Image expired/not found:', (req.query.url || '').substring(0, 80));
    } else {
      console.error('[XIMAGE3] Proxy image error:', error.message);
    }
    res.status(status).json({ error: status === 404 ? 'Gambar sudah expired' : 'Gagal load image' });
  }
});

app.get('/api/ximage3/download', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).json({ error: 'URL diperlukan' });
    }
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'User-Agent': 'Xclip/1.0' }
    });
    const contentType = response.headers['content-type'] || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="ximage3-${Date.now()}.png"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(Buffer.from(response.data));
  } catch (error) {
    console.error('[XIMAGE3] Download error:', error.message);
    res.status(500).json({ error: 'Gagal download image' });
  }
});

// ============ END X IMAGE3 API ============

// Unified image download proxy for X Image (kie.ai)
app.get('/api/ximage/download', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).json({ error: 'URL diperlukan' });
    }
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'User-Agent': 'Xclip/1.0' }
    });
    const contentType = response.headers['content-type'] || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="ximage-${Date.now()}.png"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(Buffer.from(response.data));
  } catch (error) {
    console.error('[XIMAGE] Download error:', error.message);
    res.status(500).json({ error: 'Gagal download image' });
  }
});

// ============ AUTOMATION (Fully Automated Content Creation) ============

app.get('/api/automation/projects', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  try {
    const result = await pool.query(
      `SELECT project_id, title, niche, format, video_model, scene_count, language, status, error_message, created_at, updated_at, completed_at
       FROM automation_projects WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.session.userId]
    );
    res.json({ projects: result.rows });
  } catch (error) {
    console.error('[AUTOMATION] List projects error:', error.message);
    res.status(500).json({ error: 'Gagal memuat projects' });
  }
});

app.get('/api/automation/projects/:projectId', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  try {
    const project = await pool.query(
      `SELECT * FROM automation_projects WHERE project_id = $1 AND user_id = $2`,
      [req.params.projectId, req.session.userId]
    );
    if (project.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const scenes = await pool.query(
      `SELECT * FROM automation_scenes WHERE project_id = $1 ORDER BY scene_index ASC`,
      [req.params.projectId]
    );
    res.json({ project: project.rows[0], scenes: scenes.rows });
  } catch (error) {
    console.error('[AUTOMATION] Get project error:', error.message);
    res.status(500).json({ error: 'Gagal memuat project' });
  }
});

app.delete('/api/automation/projects/:projectId', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  try {
    const result = await pool.query(
      `DELETE FROM automation_projects WHERE project_id = $1 AND user_id = $2 RETURNING id`,
      [req.params.projectId, req.session.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('[AUTOMATION] Delete project error:', error.message);
    res.status(500).json({ error: 'Gagal menghapus project' });
  }
});

app.post('/api/automation/projects', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  const { niche, format, videoModel, sceneCount, language } = req.body;
  if (!niche || !niche.trim()) return res.status(400).json({ error: 'Niche/topik wajib diisi' });
  const projectId = `auto-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const validFormats = ['shorts', 'landscape'];
  const validModels = ['grok-video-3-10s', 'veo-3.1-fast', 'veo-3.1'];
  const fmt = validFormats.includes(format) ? format : 'shorts';
  const model = validModels.includes(videoModel) ? videoModel : 'veo-3.1-fast';
  const scenes = Math.min(Math.max(parseInt(sceneCount) || 3, 2), 8);
  const lang = language || 'id';
  try {
    await pool.query(
      `INSERT INTO automation_projects (user_id, project_id, niche, format, video_model, scene_count, language, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')`,
      [req.session.userId, projectId, niche.trim(), fmt, model, scenes, lang]
    );
    res.json({ projectId, message: 'Project created' });
  } catch (error) {
    console.error('[AUTOMATION] Create project error:', error.message);
    res.status(500).json({ error: 'Gagal membuat project' });
  }
});

app.post('/api/automation/projects/:projectId/generate-script', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  const { projectId } = req.params;
  try {
    const projResult = await pool.query(
      `SELECT * FROM automation_projects WHERE project_id = $1 AND user_id = $2`,
      [projectId, req.session.userId]
    );
    if (projResult.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const project = projResult.rows[0];
    if (project.status !== 'draft' && project.status !== 'script_failed') {
      return res.status(400).json({ error: 'Project sudah dalam proses atau selesai' });
    }
    await pool.query(
      `UPDATE automation_projects SET status = 'generating_script', updated_at = NOW() WHERE project_id = $1`,
      [projectId]
    );
    sendSSEToUser(req.session.userId, { type: 'automation_update', projectId, status: 'generating_script' });

    const formatDesc = project.format === 'shorts' ? 'YouTube Shorts (vertical 9:16, 30-60 detik total)' : 'YouTube video (landscape 16:9, 1-2 menit total)';
    const langName = project.language === 'en' ? 'English' : project.language === 'id' ? 'Bahasa Indonesia' : project.language;
    const systemPrompt = `You are a professional content creator and scriptwriter. Create engaging video scripts for social media.
Always respond with valid JSON only, no markdown formatting.`;
    const userPrompt = `Create a ${formatDesc} video script about "${project.niche}".
The script must have exactly ${project.scene_count} scenes.
Language: ${langName}

Return ONLY valid JSON with this structure:
{
  "title": "catchy video title",
  "scenes": [
    {
      "narration": "voiceover text for this scene (${project.format === 'shorts' ? '1-2 sentences' : '2-3 sentences'})",
      "visual_prompt": "detailed visual description for AI video generation, cinematic, high quality, ${project.format === 'shorts' ? '9:16 vertical' : '16:9 landscape'} format"
    }
  ]
}

Rules:
- Each scene narration should be concise and engaging
- Visual prompts should be detailed, cinematic descriptions suitable for AI video generation
- Visual prompts must be in English regardless of narration language
- Make the content viral-worthy and attention-grabbing
- The visual_prompt should describe the scene visually, not repeat the narration`;

    const apimodelsKey = process.env.APIMODELS_API_KEY || process.env.XIMAGE_ROOM1_KEY_1;
    if (!apimodelsKey) {
      await pool.query(
        `UPDATE automation_projects SET status = 'script_failed', error_message = 'ApiModels API key not configured', updated_at = NOW() WHERE project_id = $1`,
        [projectId]
      );
      return res.status(500).json({ error: 'ApiModels API key not configured' });
    }

    const chatModels = [
      { url: 'https://api.apimodels.app/v1/chat/completions', model: 'gpt-5', key: apimodelsKey },
      { url: 'https://api.apimodels.app/v1/chat/completions', model: 'gpt-4.1', key: apimodelsKey },
      { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'google/gemini-2.5-flash-preview', key: process.env.OPENROUTER_API_KEY }
    ].filter(m => m.key);

    let chatResponse = null;
    let lastChatErr = null;
    for (const chatModel of chatModels) {
      try {
        console.log(`[AUTOMATION] Trying chat model: ${chatModel.model} at ${chatModel.url}`);
        chatResponse = await axios.post(
          chatModel.url,
          {
            model: chatModel.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.8
          },
          {
            headers: {
              'Authorization': `Bearer ${chatModel.key}`,
              'Content-Type': 'application/json'
            },
            timeout: 120000
          }
        );
        if (chatResponse.data?.choices?.[0]?.message?.content) {
          console.log(`[AUTOMATION] Chat success with model: ${chatModel.model}`);
          break;
        }
        console.log(`[AUTOMATION] Model ${chatModel.model} returned empty content, trying next...`);
        chatResponse = null;
      } catch (chatErr) {
        lastChatErr = chatErr;
        const errMsg = chatErr.response?.data?.error?.message || chatErr.response?.data?.message || chatErr.message;
        console.error(`[AUTOMATION] Chat model ${chatModel.model} failed:`, errMsg);
        chatResponse = null;
      }
    }

    if (!chatResponse || !chatResponse.data?.choices?.[0]?.message?.content) {
      const errMsg = lastChatErr?.response?.data?.error?.message || lastChatErr?.message || 'All chat models failed';
      await pool.query(
        `UPDATE automation_projects SET status = 'script_failed', error_message = $2, updated_at = NOW() WHERE project_id = $1`,
        [projectId, 'Chat API error: ' + errMsg]
      );
      sendSSEToUser(req.session.userId, { type: 'automation_update', projectId, status: 'script_failed' });
      return res.status(500).json({ error: 'Gagal generate script: ' + errMsg });
    }

    const aiContent = chatResponse.data.choices[0].message.content;
    let scriptData;
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in AI response');
      scriptData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('[AUTOMATION] Script parse error:', parseErr.message, 'Raw:', aiContent.substring(0, 500));
      await pool.query(
        `UPDATE automation_projects SET status = 'script_failed', error_message = $2, updated_at = NOW() WHERE project_id = $1`,
        [projectId, 'Failed to parse AI script: ' + parseErr.message]
      );
      sendSSEToUser(req.session.userId, { type: 'automation_update', projectId, status: 'script_failed' });
      return res.status(500).json({ error: 'Gagal parsing script dari AI' });
    }

    if (!scriptData.scenes || !Array.isArray(scriptData.scenes) || scriptData.scenes.length === 0) {
      await pool.query(
        `UPDATE automation_projects SET status = 'script_failed', error_message = 'AI returned no scenes', updated_at = NOW() WHERE project_id = $1`,
        [projectId]
      );
      return res.status(500).json({ error: 'AI tidak menghasilkan scenes' });
    }

    const targetCount = project.scene_count;
    if (scriptData.scenes.length > targetCount) {
      scriptData.scenes = scriptData.scenes.slice(0, targetCount);
    }

    await pool.query(
      `UPDATE automation_projects SET title = $2, script = $3, status = 'script_ready', updated_at = NOW() WHERE project_id = $1`,
      [projectId, scriptData.title || project.niche, JSON.stringify(scriptData)]
    );

    await pool.query(`DELETE FROM automation_scenes WHERE project_id = $1`, [projectId]);
    for (let i = 0; i < scriptData.scenes.length; i++) {
      const scene = scriptData.scenes[i];
      await pool.query(
        `INSERT INTO automation_scenes (project_id, scene_index, narration, visual_prompt, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [projectId, i, scene.narration || '', scene.visual_prompt || '']
      );
    }

    sendSSEToUser(req.session.userId, { type: 'automation_update', projectId, status: 'script_ready' });
    res.json({ success: true, title: scriptData.title, sceneCount: scriptData.scenes.length });
  } catch (error) {
    console.error('[AUTOMATION] Generate script error:', error.response?.data || error.message);
    await pool.query(
      `UPDATE automation_projects SET status = 'script_failed', error_message = $2, updated_at = NOW() WHERE project_id = $1`,
      [projectId, error.message]
    ).catch(() => {});
    sendSSEToUser(req.session.userId, { type: 'automation_update', projectId, status: 'script_failed' });
    res.status(500).json({ error: 'Gagal generate script: ' + error.message });
  }
});

app.post('/api/automation/projects/:projectId/update-scene', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  const { projectId } = req.params;
  const { sceneIndex, narration, visualPrompt } = req.body;
  try {
    const projCheck = await pool.query(
      `SELECT status FROM automation_projects WHERE project_id = $1 AND user_id = $2`,
      [projectId, req.session.userId]
    );
    if (projCheck.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    if (projCheck.rows[0].status !== 'script_ready') {
      return res.status(400).json({ error: 'Script belum ready atau sudah dalam proses' });
    }
    const updateFields = [];
    const updateValues = [projectId, sceneIndex];
    let paramIdx = 3;
    if (narration !== undefined) { updateFields.push(`narration = $${paramIdx}`); updateValues.push(narration); paramIdx++; }
    if (visualPrompt !== undefined) { updateFields.push(`visual_prompt = $${paramIdx}`); updateValues.push(visualPrompt); paramIdx++; }
    if (updateFields.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    updateFields.push('updated_at = NOW()');
    const updateResult = await pool.query(
      `UPDATE automation_scenes SET ${updateFields.join(', ')} WHERE project_id = $1 AND scene_index = $2`,
      updateValues
    );
    if (updateResult.rowCount === 0) return res.status(404).json({ error: 'Scene not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('[AUTOMATION] Update scene error:', error.message);
    res.status(500).json({ error: 'Gagal update scene' });
  }
});

app.post('/api/automation/projects/:projectId/start', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  const { projectId } = req.params;
  try {
    const projResult = await pool.query(
      `SELECT * FROM automation_projects WHERE project_id = $1 AND user_id = $2`,
      [projectId, req.session.userId]
    );
    if (projResult.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const project = projResult.rows[0];
    if (project.status !== 'script_ready' && project.status !== 'production_failed') {
      return res.status(400).json({ error: 'Script harus ready sebelum mulai produksi' });
    }

    const apimodelsKey = process.env.APIMODELS_API_KEY || process.env.VIDGEN2_ROOM1_KEY_1;
    if (!apimodelsKey) {
      return res.status(500).json({ error: 'Video generation API key tidak tersedia' });
    }

    const lockResult = await pool.query(
      `UPDATE automation_projects SET status = 'producing', error_message = NULL, updated_at = NOW() WHERE project_id = $1 AND status IN ('script_ready', 'production_failed') RETURNING project_id`,
      [projectId]
    );
    if (lockResult.rowCount === 0) {
      return res.status(409).json({ error: 'Production sudah berjalan' });
    }
    sendSSEToUser(req.session.userId, { type: 'automation_update', projectId, status: 'producing' });

    const scenes = await pool.query(
      `SELECT * FROM automation_scenes WHERE project_id = $1 ORDER BY scene_index ASC`,
      [projectId]
    );

    const aspectRatio = project.format === 'shorts' ? '9:16' : '16:9';
    const modelConfig = {
      'grok-video-3-10s': { apiModel: 'grok-video-3-10s', duration: 10 },
      'veo-3.1-fast': { apiModel: 'veo-3.1-fast', duration: 8 },
      'veo-3.1': { apiModel: 'veo-3.1', duration: 8 }
    };
    const vidModel = modelConfig[project.video_model] || modelConfig['veo-3.1-fast'];

    res.json({ success: true, message: 'Produksi dimulai', sceneCount: scenes.rows.length });

    const imageModel = project.image_model || 'gemini-2.5-flash-image';

    (async () => {
      try {
        for (const scene of scenes.rows) {
          if (scene.status === 'completed' && scene.video_url) continue;

          if (!scene.image_url) {
            await pool.query(
              `UPDATE automation_scenes SET status = 'generating_image', updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
              [projectId, scene.scene_index]
            );
            sendSSEToUser(project.user_id, { type: 'automation_scene_update', projectId, sceneIndex: scene.scene_index, status: 'generating_image' });

            try {
              const imgBody = {
                model: imageModel,
                prompt: scene.visual_prompt,
                aspect_ratio: aspectRatio
              };
              console.log(`[AUTOMATION] Generating image for ${projectId} scene ${scene.scene_index}:`, JSON.stringify(imgBody));
              const imgResponse = await axios.post(
                'https://apimodels.app/api/v1/images/generations',
                imgBody,
                {
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apimodelsKey}` },
                  timeout: 60000
                }
              );

              const imgData = imgResponse.data?.data || imgResponse.data;
              const imgTaskId = imgData?.taskId || imgData?.task_id;

              let imageUrl = imgData?.url || imgData?.resultUrls?.[0];
              if (!imageUrl && imgTaskId) {
                await pool.query(
                  `UPDATE automation_scenes SET image_task_id = $3, updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
                  [projectId, scene.scene_index, imgTaskId]
                );
                for (let attempt = 0; attempt < 60; attempt++) {
                  await new Promise(r => setTimeout(r, 5000));
                  try {
                    const pollResp = await axios.get(
                      `https://apimodels.app/api/v1/images/generations?task_id=${encodeURIComponent(imgTaskId)}`,
                      { headers: { 'Authorization': `Bearer ${apimodelsKey}` }, timeout: 30000 }
                    );
                    const pData = pollResp.data?.data || pollResp.data;
                    const pStatus = pData?.state || pData?.status;
                    if (pStatus === 'completed' || pStatus === 'success') {
                      imageUrl = pData?.url || pData?.resultUrls?.[0] || pData?.image_url;
                      break;
                    }
                    if (pStatus === 'failed' || pStatus === 'error') {
                      throw new Error(pData?.failMsg || pData?.error || 'Image generation failed');
                    }
                  } catch (pollErr) {
                    if (pollErr.message.includes('failed') || pollErr.message.includes('Image generation')) throw pollErr;
                  }
                }
              }

              if (!imageUrl) throw new Error('Image generation failed or timed out');

              await pool.query(
                `UPDATE automation_scenes SET image_url = $3, updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
                [projectId, scene.scene_index, imageUrl]
              );
              scene.image_url = imageUrl;
              sendSSEToUser(project.user_id, { type: 'automation_scene_update', projectId, sceneIndex: scene.scene_index, status: 'image_ready', imageUrl });
              console.log(`[AUTOMATION] Scene ${scene.scene_index} image ready: ${imageUrl}`);
            } catch (imgErr) {
              console.error(`[AUTOMATION] Scene ${scene.scene_index} image failed:`, imgErr.message);
              await pool.query(
                `UPDATE automation_scenes SET status = 'failed', error_message = $3, updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
                [projectId, scene.scene_index, 'Image: ' + imgErr.message]
              );
              sendSSEToUser(project.user_id, { type: 'automation_scene_update', projectId, sceneIndex: scene.scene_index, status: 'failed', error: imgErr.message });
              continue;
            }
          }

          await pool.query(
            `UPDATE automation_scenes SET status = 'generating_video', updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
            [projectId, scene.scene_index]
          );
          sendSSEToUser(project.user_id, { type: 'automation_scene_update', projectId, sceneIndex: scene.scene_index, status: 'generating_video' });

          try {
            const videoBody = {
              model: vidModel.apiModel,
              prompt: scene.visual_prompt,
              aspect_ratio: aspectRatio,
              duration: vidModel.duration,
              images: [scene.image_url]
            };
            console.log(`[AUTOMATION] Generating video (i2v) for ${projectId} scene ${scene.scene_index}:`, JSON.stringify({ ...videoBody, images: ['[IMAGE]'] }));
            const videoResponse = await axios.post(
              'https://apimodels.app/api/v1/video/generations',
              videoBody,
              {
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apimodelsKey}` },
                timeout: 60000
              }
            );

            const videoData = videoResponse.data?.data || videoResponse.data;
            const taskId = videoData?.taskId || videoData?.task_id;
            if (!taskId) {
              throw new Error('No task ID returned from video API: ' + JSON.stringify(videoResponse.data));
            }

            await pool.query(
              `UPDATE automation_scenes SET video_task_id = $3, updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
              [projectId, scene.scene_index, taskId]
            );

            let videoUrl = null;
            for (let attempt = 0; attempt < 120; attempt++) {
              await new Promise(r => setTimeout(r, 5000));
              try {
                const statusResp = await axios.get(
                  `https://apimodels.app/api/v1/video/generations?task_id=${encodeURIComponent(taskId)}`,
                  { headers: { 'Authorization': `Bearer ${apimodelsKey}` }, timeout: 30000 }
                );
                const sData = statusResp.data?.data || statusResp.data;
                const sStatus = sData?.state || sData?.status;
                if (sStatus === 'completed' || sStatus === 'success') {
                  videoUrl = sData?.videos?.[0] || sData?.resultUrls?.[0] || sData?.video_url || sData?.url;
                  break;
                }
                if (sStatus === 'failed' || sStatus === 'error') {
                  throw new Error(sData?.failMsg || sData?.error || 'Video generation failed');
                }
              } catch (pollErr) {
                if (pollErr.message.includes('failed') || pollErr.message.includes('Video generation')) throw pollErr;
                console.log(`[AUTOMATION] Poll error (retry): ${pollErr.message}`);
              }
            }

            if (!videoUrl) throw new Error('Video generation timed out after 10 minutes');

            await pool.query(
              `UPDATE automation_scenes SET status = 'completed', video_url = $3, updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
              [projectId, scene.scene_index, videoUrl]
            );
            sendSSEToUser(project.user_id, { type: 'automation_scene_update', projectId, sceneIndex: scene.scene_index, status: 'completed', videoUrl });
            console.log(`[AUTOMATION] Scene ${scene.scene_index} completed: ${videoUrl}`);

          } catch (sceneErr) {
            console.error(`[AUTOMATION] Scene ${scene.scene_index} video failed:`, sceneErr.message);
            await pool.query(
              `UPDATE automation_scenes SET status = 'failed', error_message = $3, updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
              [projectId, scene.scene_index, 'Video: ' + sceneErr.message]
            );
            sendSSEToUser(project.user_id, { type: 'automation_scene_update', projectId, sceneIndex: scene.scene_index, status: 'failed', error: sceneErr.message });
          }
        }

        const completedScenes = await pool.query(
          `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'completed') as completed, COUNT(*) FILTER (WHERE status = 'failed') as failed
           FROM automation_scenes WHERE project_id = $1`,
          [projectId]
        );
        const stats = completedScenes.rows[0];
        const allDone = parseInt(stats.completed) + parseInt(stats.failed) === parseInt(stats.total);

        if (allDone) {
          if (parseInt(stats.failed) === parseInt(stats.total)) {
            await pool.query(
              `UPDATE automation_projects SET status = 'production_failed', error_message = 'Semua scene gagal', updated_at = NOW() WHERE project_id = $1`,
              [projectId]
            );
            sendSSEToUser(project.user_id, { type: 'automation_update', projectId, status: 'production_failed' });
          } else {
            await pool.query(
              `UPDATE automation_projects SET status = 'completed', updated_at = NOW(), completed_at = NOW() WHERE project_id = $1`,
              [projectId]
            );
            sendSSEToUser(project.user_id, { type: 'automation_update', projectId, status: 'completed' });
          }
        }
      } catch (pipelineErr) {
        console.error(`[AUTOMATION] Pipeline error for ${projectId}:`, pipelineErr.message);
        await pool.query(
          `UPDATE automation_projects SET status = 'production_failed', error_message = $2, updated_at = NOW() WHERE project_id = $1`,
          [projectId, pipelineErr.message]
        ).catch(() => {});
        sendSSEToUser(project.user_id, { type: 'automation_update', projectId, status: 'production_failed' });
      }
    })();

  } catch (error) {
    console.error('[AUTOMATION] Start production error:', error.message);
    res.status(500).json({ error: 'Gagal memulai produksi' });
  }
});

app.post('/api/automation/projects/:projectId/retry-scene', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  const { projectId } = req.params;
  const { sceneIndex } = req.body;
  try {
    const projResult = await pool.query(
      `SELECT * FROM automation_projects WHERE project_id = $1 AND user_id = $2`,
      [projectId, req.session.userId]
    );
    if (projResult.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const project = projResult.rows[0];

    const sceneResult = await pool.query(
      `SELECT * FROM automation_scenes WHERE project_id = $1 AND scene_index = $2`,
      [projectId, sceneIndex]
    );
    if (sceneResult.rows.length === 0) return res.status(404).json({ error: 'Scene not found' });
    const scene = sceneResult.rows[0];
    if (scene.status !== 'failed') return res.status(400).json({ error: 'Hanya scene yang gagal bisa di-retry' });

    const apimodelsKey = process.env.APIMODELS_API_KEY || process.env.VIDGEN2_ROOM1_KEY_1;
    if (!apimodelsKey) return res.status(500).json({ error: 'Video API key tidak tersedia' });

    const retryInitStatus = scene.image_url ? 'generating_video' : 'generating_image';
    await pool.query(
      `UPDATE automation_scenes SET status = $3, error_message = NULL, updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
      [projectId, sceneIndex, retryInitStatus]
    );
    if (project.status === 'production_failed' || project.status === 'completed') {
      await pool.query(
        `UPDATE automation_projects SET status = 'producing', error_message = NULL, updated_at = NOW() WHERE project_id = $1`,
        [projectId]
      );
    }
    sendSSEToUser(req.session.userId, { type: 'automation_scene_update', projectId, sceneIndex, status: retryInitStatus });
    res.json({ success: true, message: 'Retrying scene...' });

    const aspectRatio = project.format === 'shorts' ? '9:16' : '16:9';
    const modelConfig = {
      'grok-video-3-10s': { apiModel: 'grok-video-3-10s', duration: 10 },
      'veo-3.1-fast': { apiModel: 'veo-3.1-fast', duration: 8 },
      'veo-3.1': { apiModel: 'veo-3.1', duration: 8 }
    };
    const vidModel = modelConfig[project.video_model] || modelConfig['veo-3.1-fast'];
    const imageModel = project.image_model || 'gemini-2.5-flash-image';

    (async () => {
      try {
        let sceneImageUrl = scene.image_url;

        if (!sceneImageUrl) {
          const imgBody = { model: imageModel, prompt: scene.visual_prompt, aspect_ratio: aspectRatio };
          const imgResponse = await axios.post(
            'https://apimodels.app/api/v1/images/generations', imgBody,
            { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apimodelsKey}` }, timeout: 60000 }
          );
          const imgData = imgResponse.data?.data || imgResponse.data;
          const imgTaskId = imgData?.taskId || imgData?.task_id;
          sceneImageUrl = imgData?.url || imgData?.resultUrls?.[0];

          if (!sceneImageUrl && imgTaskId) {
            for (let a = 0; a < 60; a++) {
              await new Promise(r => setTimeout(r, 5000));
              const pr = await axios.get(
                `https://apimodels.app/api/v1/images/generations?task_id=${encodeURIComponent(imgTaskId)}`,
                { headers: { 'Authorization': `Bearer ${apimodelsKey}` }, timeout: 30000 }
              );
              const pd = pr.data?.data || pr.data;
              const ps = pd?.state || pd?.status;
              if (ps === 'completed' || ps === 'success') { sceneImageUrl = pd?.url || pd?.resultUrls?.[0]; break; }
              if (ps === 'failed' || ps === 'error') throw new Error(pd?.failMsg || 'Image failed');
            }
          }
          if (!sceneImageUrl) throw new Error('Image generation failed');

          await pool.query(
            `UPDATE automation_scenes SET image_url = $3, status = 'generating_video', updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
            [projectId, sceneIndex, sceneImageUrl]
          );
          sendSSEToUser(project.user_id, { type: 'automation_scene_update', projectId, sceneIndex, status: 'generating_video', imageUrl: sceneImageUrl });
        }

        const videoBody = { model: vidModel.apiModel, prompt: scene.visual_prompt, aspect_ratio: aspectRatio, duration: vidModel.duration, images: [sceneImageUrl] };
        const videoResponse = await axios.post(
          'https://apimodels.app/api/v1/video/generations', videoBody,
          { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apimodelsKey}` }, timeout: 60000 }
        );
        const videoData = videoResponse.data?.data || videoResponse.data;
        const taskId = videoData?.taskId || videoData?.task_id;
        if (!taskId) throw new Error('No task ID returned');

        await pool.query(
          `UPDATE automation_scenes SET video_task_id = $3, updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
          [projectId, sceneIndex, taskId]
        );

        let videoUrl = null;
        for (let attempt = 0; attempt < 120; attempt++) {
          await new Promise(r => setTimeout(r, 5000));
          const statusResp = await axios.get(
            `https://apimodels.app/api/v1/video/generations?task_id=${encodeURIComponent(taskId)}`,
            { headers: { 'Authorization': `Bearer ${apimodelsKey}` }, timeout: 30000 }
          );
          const sData = statusResp.data?.data || statusResp.data;
          const sStatus = sData?.state || sData?.status;
          if (sStatus === 'completed' || sStatus === 'success') {
            videoUrl = sData?.videos?.[0] || sData?.resultUrls?.[0] || sData?.video_url || sData?.url;
            break;
          }
          if (sStatus === 'failed' || sStatus === 'error') throw new Error(sData?.failMsg || 'Failed');
        }
        if (!videoUrl) throw new Error('Timed out');

        await pool.query(
          `UPDATE automation_scenes SET status = 'completed', video_url = $3, error_message = NULL, updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
          [projectId, sceneIndex, videoUrl]
        );
        sendSSEToUser(project.user_id, { type: 'automation_scene_update', projectId, sceneIndex, status: 'completed', videoUrl });

        const stats = await pool.query(
          `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'completed') as completed, COUNT(*) FILTER (WHERE status = 'failed') as failed
           FROM automation_scenes WHERE project_id = $1`, [projectId]
        );
        const s = stats.rows[0];
        if (parseInt(s.completed) + parseInt(s.failed) === parseInt(s.total)) {
          const finalStatus = parseInt(s.failed) === 0 ? 'completed' : (parseInt(s.completed) > 0 ? 'completed' : 'production_failed');
          await pool.query(
            `UPDATE automation_projects SET status = $2, updated_at = NOW(), completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END WHERE project_id = $1`,
            [projectId, finalStatus]
          );
          sendSSEToUser(project.user_id, { type: 'automation_update', projectId, status: finalStatus });
        }
      } catch (err) {
        console.error(`[AUTOMATION] Retry scene ${sceneIndex} failed:`, err.message);
        await pool.query(
          `UPDATE automation_scenes SET status = 'failed', error_message = $3, updated_at = NOW() WHERE project_id = $1 AND scene_index = $2`,
          [projectId, sceneIndex, err.message]
        ).catch(() => {});
        sendSSEToUser(project.user_id, { type: 'automation_scene_update', projectId, sceneIndex, status: 'failed', error: err.message });
      }
    })();
  } catch (error) {
    console.error('[AUTOMATION] Retry scene error:', error.message);
    res.status(500).json({ error: 'Gagal retry scene' });
  }
});

// ============ YOUTUBE INTEGRATION ============

function getYouTubeOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const redirectUri = process.env.NODE_ENV === 'production'
    ? `https://${process.env.REPL_SLUG || ''}.${process.env.REPL_OWNER || ''}.repl.co/api/youtube/callback`
    : `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5000'}/api/youtube/callback`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

app.get('/api/youtube/status', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  try {
    const configured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    const tokenResult = await pool.query(
      `SELECT channel_name, channel_id FROM youtube_tokens WHERE user_id = $1`,
      [req.session.userId]
    );
    const connected = tokenResult.rows.length > 0;
    res.json({
      configured,
      connected,
      channelName: connected ? tokenResult.rows[0].channel_name : null,
      channelId: connected ? tokenResult.rows[0].channel_id : null
    });
  } catch (error) {
    console.error('[YOUTUBE] Status error:', error.message);
    res.status(500).json({ error: 'Failed to check YouTube status' });
  }
});

app.get('/api/youtube/auth', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  const oauth2Client = getYouTubeOAuth2Client();
  if (!oauth2Client) return res.status(500).json({ error: 'Google OAuth belum di-setup. Set GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET.' });
  const nonce = require('crypto').randomBytes(32).toString('hex');
  req.session.youtubeOAuthState = nonce;
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ],
    state: nonce
  });
  res.json({ authUrl });
});

function escapeHtmlServer(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

app.get('/api/youtube/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('Missing code or state');
  if (!req.session.userId || !req.session.youtubeOAuthState || req.session.youtubeOAuthState !== state) {
    return res.status(403).send('Invalid or expired OAuth state. Please try connecting again.');
  }
  delete req.session.youtubeOAuthState;
  const userId = req.session.userId;

  const oauth2Client = getYouTubeOAuth2Client();
  if (!oauth2Client) return res.status(500).send('OAuth not configured');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    let channelName = 'YouTube Channel';
    let channelId = '';
    try {
      const yt = google.youtube({ version: 'v3', auth: oauth2Client });
      const channelResp = await yt.channels.list({ part: 'snippet', mine: true });
      if (channelResp.data.items && channelResp.data.items.length > 0) {
        channelName = channelResp.data.items[0].snippet.title;
        channelId = channelResp.data.items[0].id;
      }
    } catch (e) {
      console.error('[YOUTUBE] Channel fetch error:', e.message);
    }

    await pool.query(`
      INSERT INTO youtube_tokens (user_id, access_token, refresh_token, expiry_date, channel_name, channel_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        access_token = $2, refresh_token = COALESCE($3, youtube_tokens.refresh_token),
        expiry_date = $4, channel_name = $5, channel_id = $6, updated_at = NOW()
    `, [userId, tokens.access_token, tokens.refresh_token, tokens.expiry_date, channelName, channelId]);

    res.send(`<html><body style="background:#0a0a0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <div style="text-align:center"><h2 style="color:#4ade80">YouTube Connected!</h2><p>Channel: ${escapeHtmlServer(channelName)}</p><p>Kamu bisa tutup tab ini.</p>
      <script>setTimeout(()=>{window.close()},2000)</script></div></body></html>`);
  } catch (error) {
    console.error('[YOUTUBE] Callback error:', error.message);
    res.status(500).send(`<html><body style="background:#0a0a0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <div style="text-align:center"><h2 style="color:#f87171">Gagal Connect</h2><p>Terjadi kesalahan saat menghubungkan YouTube. Silakan coba lagi.</p></div></body></html>`);
  }
});

app.delete('/api/youtube/disconnect', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  try {
    await pool.query(`DELETE FROM youtube_tokens WHERE user_id = $1`, [req.session.userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

function downloadFileToPath(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? require('https') : require('http');
    const doDownload = (downloadUrl) => {
      proto.get(downloadUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const proto2 = response.headers.location.startsWith('https') ? require('https') : require('http');
          proto2.get(response.headers.location, (r2) => {
            const ws = require('fs').createWriteStream(destPath);
            r2.pipe(ws);
            ws.on('finish', () => resolve(destPath));
            ws.on('error', reject);
          }).on('error', reject);
        } else if (response.statusCode >= 200 && response.statusCode < 300) {
          const ws = require('fs').createWriteStream(destPath);
          response.pipe(ws);
          ws.on('finish', () => resolve(destPath));
          ws.on('error', reject);
        } else {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        }
      }).on('error', reject);
    };
    doDownload(url);
  });
}

function concatVideosFFmpeg(inputPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const listContent = inputPaths.map(p => `file '${p}'`).join('\n');
    const listPath = outputPath + '.txt';
    require('fs').writeFileSync(listPath, listContent);
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(outputPath)
      .on('end', () => {
        try { require('fs').unlinkSync(listPath); } catch (e) {}
        resolve(outputPath);
      })
      .on('error', (err) => {
        try { require('fs').unlinkSync(listPath); } catch (e) {}
        reject(err);
      })
      .run();
  });
}

app.post('/api/automation/projects/:projectId/upload-youtube', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  const { projectId } = req.params;
  const { title, description, tags, privacy } = req.body;

  try {
    const projResult = await pool.query(
      `SELECT * FROM automation_projects WHERE project_id = $1 AND user_id = $2`,
      [projectId, req.session.userId]
    );
    if (projResult.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const project = projResult.rows[0];

    const scenesResult = await pool.query(
      `SELECT * FROM automation_scenes WHERE project_id = $1 AND status = 'completed' AND video_url IS NOT NULL ORDER BY scene_index ASC`,
      [projectId]
    );
    if (scenesResult.rows.length === 0) return res.status(400).json({ error: 'Tidak ada video scene yang selesai' });

    const tokenResult = await pool.query(
      `SELECT * FROM youtube_tokens WHERE user_id = $1`, [req.session.userId]
    );
    if (tokenResult.rows.length === 0) return res.status(400).json({ error: 'YouTube belum terkoneksi. Connect dulu.' });

    const oauth2Client = getYouTubeOAuth2Client();
    if (!oauth2Client) return res.status(500).json({ error: 'Google OAuth belum di-setup' });

    const tokenData = tokenResult.rows[0];
    oauth2Client.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date: parseInt(tokenData.expiry_date)
    });

    oauth2Client.on('tokens', async (newTokens) => {
      try {
        await pool.query(
          `UPDATE youtube_tokens SET access_token = $2, expiry_date = $3, updated_at = NOW() WHERE user_id = $1`,
          [req.session.userId, newTokens.access_token, newTokens.expiry_date]
        );
      } catch (e) { console.error('[YOUTUBE] Token refresh save error:', e.message); }
    });

    const userId = req.session.userId;
    res.json({ success: true, message: 'Upload dimulai' });

    sendSSEToUser(userId, { type: 'youtube_upload_start', projectId, totalScenes: scenesResult.rows.length });

    (async () => {
      const fs = require('fs');
      const tmpDir = require('os').tmpdir();
      const jobId = `yt_${projectId}_${Date.now()}`;
      const downloadedFiles = [];

      try {
        sendSSEToUser(userId, { type: 'youtube_upload_progress', projectId, step: 'downloading', message: 'Downloading scene videos...' });

        for (let i = 0; i < scenesResult.rows.length; i++) {
          const scene = scenesResult.rows[i];
          const ext = scene.video_url.includes('.webm') ? '.webm' : '.mp4';
          const destPath = require('path').join(tmpDir, `${jobId}_scene${i}${ext}`);
          await downloadFileToPath(scene.video_url, destPath);
          downloadedFiles.push(destPath);
          console.log(`[YOUTUBE] Downloaded scene ${i} -> ${destPath}`);
        }

        sendSSEToUser(userId, { type: 'youtube_upload_progress', projectId, step: 'merging', message: 'Menggabungkan video...' });

        const outputPath = require('path').join(tmpDir, `${jobId}_merged.mp4`);

        let needsReencode = false;
        const formats = new Set();
        for (const f of downloadedFiles) {
          const ext = require('path').extname(f).toLowerCase();
          formats.add(ext);
        }
        needsReencode = formats.size > 1;

        let mergedPath;
        if (needsReencode) {
          mergedPath = await new Promise((resolve, reject) => {
            let cmd = ffmpeg();
            downloadedFiles.forEach(f => { cmd = cmd.input(f); });
            const filterParts = downloadedFiles.map((_, i) => `[${i}:v:0][${i}:a:0]`).join('');
            cmd
              .complexFilter([`${filterParts}concat=n=${downloadedFiles.length}:v=1:a=1[outv][outa]`], ['outv', 'outa'])
              .outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k'])
              .output(outputPath)
              .on('end', () => resolve(outputPath))
              .on('error', (err) => {
                const fallbackPath = outputPath.replace('.mp4', '_fallback.mp4');
                let cmd2 = ffmpeg();
                downloadedFiles.forEach(f => { cmd2 = cmd2.input(f); });
                const fp2 = downloadedFiles.map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`).join(';');
                const fp3 = downloadedFiles.map((_, i) => `[v${i}][${i}:a:0]`).join('');
                cmd2
                  .complexFilter([`${fp2};${fp3}concat=n=${downloadedFiles.length}:v=1:a=1[outv][outa]`], ['outv', 'outa'])
                  .outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac'])
                  .output(fallbackPath)
                  .on('end', () => resolve(fallbackPath))
                  .on('error', reject)
                  .run();
              })
              .run();
          });
        } else {
          mergedPath = await concatVideosFFmpeg(downloadedFiles, outputPath);
        }

        console.log(`[YOUTUBE] Merged video -> ${mergedPath}`);
        sendSSEToUser(userId, { type: 'youtube_upload_progress', projectId, step: 'uploading', message: 'Uploading ke YouTube...' });

        const yt = google.youtube({ version: 'v3', auth: oauth2Client });
        const videoTitle = title || project.title || project.niche || 'Untitled';

        const allNarrations = scenesResult.rows.map((s, i) => `Scene ${i + 1}: ${s.narration || ''}`).join('\n');
        const videoDesc = description || `Generated by Xclip AI Automation\nNiche: ${project.niche}\n\n${allNarrations}`;

        const uploadResponse = await yt.videos.insert({
          part: 'snippet,status',
          requestBody: {
            snippet: {
              title: videoTitle.substring(0, 100),
              description: videoDesc.substring(0, 5000),
              tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [project.niche],
              categoryId: '22'
            },
            status: {
              privacyStatus: privacy || 'private',
              selfDeclaredMadeForKids: false
            }
          },
          media: {
            body: fs.createReadStream(mergedPath)
          }
        });

        console.log(`[YOUTUBE] Uploaded merged video -> ${uploadResponse.data.id}`);

        sendSSEToUser(userId, {
          type: 'youtube_upload_complete', projectId,
          videoId: uploadResponse.data.id,
          videoUrl: `https://youtu.be/${uploadResponse.data.id}`,
          success: true
        });

        try { fs.unlinkSync(mergedPath); } catch (e) {}
      } catch (err) {
        console.error('[YOUTUBE] Upload pipeline error:', err.message);
        sendSSEToUser(userId, {
          type: 'youtube_upload_complete', projectId,
          success: false, error: err.message
        });
      } finally {
        for (const f of downloadedFiles) {
          try { require('fs').unlinkSync(f); } catch (e) {}
        }
      }
    })();
  } catch (error) {
    console.error('[YOUTUBE] Upload error:', error.message);
    res.status(500).json({ error: 'Gagal upload ke YouTube: ' + error.message });
  }
});

// ============ SCENE STUDIO (Simple Batch Image Generation) ============

const SCENE_STUDIO_MODELS = { ...XIMAGE2_MODELS };

function safeParseJsonb(val, fallback = []) {
  if (Array.isArray(val)) return val;
  if (val && typeof val === 'object') return val;
  if (typeof val === 'string') { try { return JSON.parse(val); } catch(e) { return fallback; } }
  return fallback;
}

async function getSceneStudioApiKey(xclipApiKey) {
  const keyInfo = await validateXclipApiKey(xclipApiKey);
  if (!keyInfo) return { error: 'Xclip API key tidak valid' };
  const subResult = await pool.query(`
    SELECT s.ximage2_room_id FROM subscriptions s 
    WHERE s.user_id = $1 AND s.ximage2_room_id IS NOT NULL
    ORDER BY s.created_at DESC LIMIT 1
  `, [keyInfo.user_id]);
  const roomId = subResult.rows[0]?.ximage2_room_id || 1;
  const roomKeyPrefix = `XIMAGE2_ROOM${roomId}_KEY_`;
  const availableKeys = [1, 2, 3].map(i => `${roomKeyPrefix}${i}`).filter(k => process.env[k]);
  if (availableKeys.length === 0) {
    if (process.env.APIMART_API_KEY) {
      return { apiKey: process.env.APIMART_API_KEY, keyName: 'APIMART_API_KEY', roomId, userId: keyInfo.user_id, keyInfoId: keyInfo.id };
    }
    return { error: 'Tidak ada API key yang tersedia untuk Scene Studio.' };
  }
  const randomKeyName = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  return { apiKey: process.env[randomKeyName], keyName: randomKeyName, roomId, userId: keyInfo.user_id, keyInfoId: keyInfo.id };
}

app.get('/api/scene-studio/models', (req, res) => {
  const models = Object.entries(SCENE_STUDIO_MODELS).map(([id, info]) => ({ id, ...info }));
  res.json({ models });
});

app.get('/api/scene-studio/history', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login diperlukan' });
  try {
    const result = await pool.query(
      `SELECT * FROM scene_studio_batches WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.session.userId]
    );
    res.json({ batches: result.rows });
  } catch (error) {
    console.error('[SCENE-STUDIO] Get history error:', error);
    res.status(500).json({ error: 'Gagal mendapatkan history' });
  }
});

app.delete('/api/scene-studio/history/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Login diperlukan' });
  try {
    await pool.query('DELETE FROM scene_studio_batches WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('[SCENE-STUDIO] Delete history error:', error);
    res.status(500).json({ error: 'Gagal menghapus' });
  }
});

app.post('/api/scene-studio/generate', async (req, res) => {
  try {
    const xclipApiKey = req.headers['x-xclip-key'];
    if (!xclipApiKey) return res.status(401).json({ error: 'Xclip API key diperlukan' });
    const roomKeyResult = await getSceneStudioApiKey(xclipApiKey);
    if (roomKeyResult.error) return res.status(400).json({ error: roomKeyResult.error });

    const { prompts, characterDesc, characterRefImages, bgRefImages, stylePreset, model, size, resolution } = req.body;
    if (!prompts || !Array.isArray(prompts) || prompts.length === 0) return res.status(400).json({ error: 'Minimal 1 prompt diperlukan' });
    if (prompts.length > 20) return res.status(400).json({ error: 'Maksimal 20 prompt per batch' });

    const modelConfig = SCENE_STUDIO_MODELS[model];
    if (!modelConfig) return res.status(400).json({ error: 'Model tidak valid' });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    let refImageUrls = [];
    let bgImageUrls = [];

    if (Array.isArray(characterRefImages) && characterRefImages.length > 0) {
      for (const refImg of characterRefImages.slice(0, 4)) {
        try {
          if (refImg.startsWith('data:')) {
            const uploaded = await saveBase64ToFile(refImg, 'image', baseUrl);
            refImageUrls.push(uploaded.publicUrl);
            console.log(`[SCENE-STUDIO] Char ref uploaded: ${uploaded.publicUrl}`);
          } else if (refImg.startsWith('http')) {
            refImageUrls.push(refImg);
          }
        } catch (ue) {
          console.error('[SCENE-STUDIO] Failed to upload char ref:', ue.message);
        }
      }
    }

    if (Array.isArray(bgRefImages) && bgRefImages.length > 0) {
      for (const bgImg of bgRefImages.slice(0, 2)) {
        try {
          if (bgImg.startsWith('data:')) {
            const uploaded = await saveBase64ToFile(bgImg, 'image', baseUrl);
            bgImageUrls.push(uploaded.publicUrl);
            console.log(`[SCENE-STUDIO] BG ref uploaded: ${uploaded.publicUrl}`);
          } else if (bgImg.startsWith('http')) {
            bgImageUrls.push(bgImg);
          }
        } catch (ue) {
          console.error('[SCENE-STUDIO] Failed to upload bg ref:', ue.message);
        }
      }
    }

    const batchId = uuidv4();
    const batchRow = await pool.query(
      `INSERT INTO scene_studio_batches (user_id, batch_id, model, character_desc, prompts, status, total) VALUES ($1, $2, $3, $4, $5, 'processing', $6) RETURNING *`,
      [roomKeyResult.userId, batchId, model, characterDesc || '', JSON.stringify(prompts), prompts.length]
    );

    const STYLE_PROMPTS = {
      'realistic': 'Ultra realistic photography style, photorealistic, natural lighting, high detail, 8K resolution.',
      'anime': 'Anime art style, vibrant colors, clean lines, expressive characters, Japanese animation aesthetic.',
      'manga': 'Black and white manga style, ink drawing, screentones, dramatic shading, Japanese comic art.',
      'comic': 'Western comic book style, bold outlines, dynamic colors, action-oriented, graphic novel aesthetic.',
      'webtoon': 'Korean webtoon style, clean digital art, soft colors, vertical scroll format aesthetic, manhwa style.',
      'pixar': 'Pixar 3D animation style, cute characters, smooth rendering, vibrant colors, CGI quality.',
      'ghibli': 'Studio Ghibli style, hand-drawn animation, soft watercolor tones, detailed backgrounds, whimsical atmosphere.',
      'watercolor': 'Watercolor painting style, soft edges, transparent layers, flowing colors, artistic brushstrokes.',
      'oil-painting': 'Oil painting style, rich textures, deep colors, visible brushstrokes, classical art technique.',
      'pencil-sketch': 'Pencil sketch style, graphite drawing, detailed shading, hand-drawn lines, monochrome artwork.',
      'digital-art': 'High quality digital art, polished illustration, vivid colors, professional concept art.',
      'cinematic': 'Cinematic style, dramatic lighting, film color grading, wide angle shot, movie scene quality, anamorphic lens.',
      'fantasy': 'Fantasy art style, epic magical atmosphere, detailed world-building, mythical elements, dramatic lighting.',
      'chibi': 'Chibi style, super deformed cute characters, big head small body, kawaii aesthetic, adorable expressions.',
      'pop-art': 'Pop art style, bold colors, Ben-Day dots, graphic shapes, Andy Warhol / Roy Lichtenstein inspired.',
      'pixel-art': 'Pixel art style, retro game aesthetic, 16-bit/32-bit graphics, clean pixels, nostalgic gaming look.',
      'storybook': 'Children\'s storybook illustration style, warm soft colors, gentle whimsical art, picture book quality.',
    };
    const stylePrefix = stylePreset && STYLE_PROMPTS[stylePreset] ? STYLE_PROMPTS[stylePreset] : '';

    console.log(`[SCENE-STUDIO] Batch generate: ${prompts.length} prompts, model: ${model}, style: ${stylePreset || 'default'}, charRefs: ${refImageUrls.length}, bgRefs: ${bgImageUrls.length}`);

    res.json({ success: true, batchId, batchDbId: batchRow.rows[0].id, total: prompts.length });

    (async () => {
      const results = [];
      try {
        for (let i = 0; i < prompts.length; i++) {
          const promptText = prompts[i];
          let fullPrompt = promptText;
          if (stylePrefix) {
            fullPrompt = `${stylePrefix}\n\n${fullPrompt}`;
          }
          if (characterDesc && characterDesc.trim()) {
            fullPrompt = `${characterDesc.trim()}\n\n${fullPrompt}`;
          }

          const requestBody = { model, prompt: fullPrompt, n: 1 };
          if (size) requestBody.size = size;
          if (modelConfig.resolutions && resolution) requestBody.resolution = resolution;
          if (modelConfig.hasSequential) requestBody.sequential_image_generation = 'auto';

          const imageRefs = [...refImageUrls, ...bgImageUrls];
          if (i > 0 && modelConfig.supportsI2I) {
            const prevCompleted = results.filter(r => r.status === 'completed' && r.imageUrl);
            if (prevCompleted.length > 0) {
              imageRefs.push(prevCompleted[prevCompleted.length - 1].imageUrl);
            }
          }
          if (imageRefs.length > 0) {
            requestBody.image_urls = imageRefs;
          }

          console.log(`[SCENE-STUDIO] Generating ${i+1}/${prompts.length}: "${promptText.substring(0, 50)}..."`);

          try {
            const response = await axios.post(
              'https://api.apimart.ai/v1/images/generations',
              requestBody,
              { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${roomKeyResult.apiKey}` }, timeout: 600000 }
            );

            const respData = response.data;
            console.log(`[SCENE-STUDIO] Prompt ${i+1} API response keys:`, Object.keys(respData), respData.data ? `data[0] keys: ${Object.keys(respData.data[0] || {})}` : 'no data array');
            let directImageUrl = null;
            if (respData.data && Array.isArray(respData.data) && respData.data.length > 0) {
              const item = respData.data[0];
              if (item.url) directImageUrl = item.url;
              else if (item.b64_json) directImageUrl = `data:image/png;base64,${item.b64_json}`;
              else if (item.image_url) directImageUrl = item.image_url;
            }

            if (directImageUrl) {
              results.push({ index: i, prompt: promptText, status: 'completed', imageUrl: directImageUrl });
              sendSSEToUser(roomKeyResult.userId, { type: 'scene_studio_progress', batchId, index: i, status: 'completed', imageUrl: directImageUrl, current: i + 1, total: prompts.length });
            } else {
              const taskId = respData.data?.[0]?.task_id || respData.task_id || respData.id;
              if (taskId) {
                sendSSEToUser(roomKeyResult.userId, { type: 'scene_studio_progress', batchId, index: i, status: 'processing', taskId, current: i + 1, total: prompts.length });
                let polled = false;
                for (let attempt = 0; attempt < 60; attempt++) {
                  await new Promise(r => setTimeout(r, 5000));
                  try {
                    const pollRes = await axios.get(`https://api.apimart.ai/v1/tasks/${taskId}`, { headers: { 'Authorization': `Bearer ${roomKeyResult.apiKey}` }, timeout: 30000 });
                    const rawPd = pollRes.data;
                    const pd = rawPd.data || rawPd;
                    const ts = pd.status || pd.state || rawPd.status;
                    console.log(`[SCENE-STUDIO] Poll ${taskId} attempt ${attempt+1}: status=${ts}, keys=${Object.keys(pd)}, result keys: ${pd.result ? Object.keys(pd.result) : 'none'}`);
                    if (ts === 'completed' || ts === 'success' || ts === 'succeeded' || ts === 'finished') {
                      let url = pd.result?.images?.[0]?.url ||
                                pd.result?.image_url ||
                                pd.result?.url ||
                                pd.result?.outputs?.[0]?.url ||
                                pd.result?.output?.url ||
                                pd.result?.output?.image_url ||
                                pd.images?.[0]?.url ||
                                pd.image_url ||
                                pd.url ||
                                pd.output?.url ||
                                pd.output?.image_url ||
                                pd.output?.images?.[0]?.url ||
                                pd.media_url ||
                                rawPd.data?.url ||
                                rawPd.data?.image_url;
                      if (Array.isArray(url)) url = url[0];
                      if (!url && pd.result?.images?.[0]) {
                        url = typeof pd.result.images[0] === 'string' ? pd.result.images[0] : null;
                      }
                      if (!url && Array.isArray(pd.images) && pd.images[0]) {
                        url = typeof pd.images[0] === 'string' ? pd.images[0] : (pd.images[0].url || pd.images[0].image_url);
                      }
                      if (url) {
                        results.push({ index: i, prompt: promptText, status: 'completed', imageUrl: url });
                        sendSSEToUser(roomKeyResult.userId, { type: 'scene_studio_progress', batchId, index: i, status: 'completed', imageUrl: url, current: i + 1, total: prompts.length });
                        polled = true; break;
                      } else {
                        console.log(`[SCENE-STUDIO] Task ${taskId} completed but no URL found. Full response:`, JSON.stringify(rawPd).substring(0, 800));
                        results.push({ index: i, prompt: promptText, status: 'failed', error: 'Task completed but no image URL found' });
                        sendSSEToUser(roomKeyResult.userId, { type: 'scene_studio_progress', batchId, index: i, status: 'failed', error: 'Gambar selesai tapi URL tidak ditemukan', current: i + 1, total: prompts.length });
                        polled = true; break;
                      }
                    }
                    if (ts === 'failed' || ts === 'error') {
                      const failErr = pd.error || pd.message || pd.result?.error || 'Task failed';
                      results.push({ index: i, prompt: promptText, status: 'failed', error: failErr });
                      sendSSEToUser(roomKeyResult.userId, { type: 'scene_studio_progress', batchId, index: i, status: 'failed', error: failErr, current: i + 1, total: prompts.length });
                      polled = true; break;
                    }
                  } catch (pe) {}
                }
                if (!polled) {
                  results.push({ index: i, prompt: promptText, status: 'failed', error: 'Timeout' });
                  sendSSEToUser(roomKeyResult.userId, { type: 'scene_studio_progress', batchId, index: i, status: 'failed', error: 'Timeout', current: i + 1, total: prompts.length });
                }
              } else {
                results.push({ index: i, prompt: promptText, status: 'failed', error: 'No result' });
                sendSSEToUser(roomKeyResult.userId, { type: 'scene_studio_progress', batchId, index: i, status: 'failed', error: 'No result from API', current: i + 1, total: prompts.length });
              }
            }
          } catch (genErr) {
            const errMsg = genErr.response?.data?.error?.message || genErr.response?.data?.message || genErr.message || 'Generation failed';
            console.error(`[SCENE-STUDIO] Prompt ${i+1} error:`, errMsg);
            results.push({ index: i, prompt: promptText, status: 'failed', error: errMsg });
            sendSSEToUser(roomKeyResult.userId, { type: 'scene_studio_progress', batchId, index: i, status: 'failed', error: errMsg, current: i + 1, total: prompts.length });
          }

          if (i < prompts.length - 1) await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } finally {
        const completed = results.filter(r => r.status === 'completed').length;
        const failed = results.filter(r => r.status === 'failed').length;
        const finalStatus = failed === prompts.length ? 'failed' : completed === prompts.length ? 'completed' : 'partial';

        try {
          await pool.query(
            `UPDATE scene_studio_batches SET results = $1, status = $2, completed = $3, failed = $4, completed_at = NOW() WHERE batch_id = $5`,
            [JSON.stringify(results), finalStatus, completed, failed, batchId]
          );
          await pool.query(
            'UPDATE xclip_api_keys SET requests_count = requests_count + $1, last_used_at = CURRENT_TIMESTAMP WHERE id = $2',
            [prompts.length, roomKeyResult.keyInfoId]
          );
        } catch (dbErr) {
          console.error(`[SCENE-STUDIO] DB finalize error for batch ${batchId}:`, dbErr.message);
        }

        sendSSEToUser(roomKeyResult.userId, { type: 'scene_studio_progress', batchId, status: 'batch_done', results, completed, failed, total: prompts.length });
      }
    })();
  } catch (error) {
    console.error('[SCENE-STUDIO] Batch generate error:', error.message);
    res.status(500).json({ error: 'Gagal batch generate: ' + (error.message || 'Unknown error') });
  }
});

// Catch-all route - must be last after all API routes
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

async function initDatabase() {
  try {
    console.log('[DB] Starting database initialization...');
    
    // Test database connection first
    try {
      await pool.query('SELECT 1');
      console.log('[DB] Database connection successful');
    } catch (connErr) {
      console.error('[DB] Database connection FAILED:', connErr.message);
      throw connErr;
    }
    
    // Create core tables first
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        freepik_api_key TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_admin BOOLEAN DEFAULT false,
        subscription_expired_at TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        max_users INTEGER DEFAULT 10,
        active_users INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'OPEN',
        provider_key_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        provider VARCHAR(50) DEFAULT 'freepik',
        key_name_1 VARCHAR(100),
        key_name_2 VARCHAR(100),
        key_name_3 VARCHAR(100),
        droplet_ip VARCHAR(100),
        droplet_port INTEGER,
        proxy_secret VARCHAR(255),
        use_proxy BOOLEAN DEFAULT false,
        use_webshare BOOLEAN DEFAULT false
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        plan_id INTEGER,
        room_id INTEGER REFERENCES rooms(id),
        xmaker_room_id INTEGER REFERENCES rooms(id),
        room_locked BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'active',
        expired_at TIMESTAMP,
        last_active TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        package VARCHAR(50) NOT NULL,
        amount INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        proof_image TEXT,
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS xclip_api_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        api_key VARCHAR(255) NOT NULL UNIQUE,
        label VARCHAR(100),
        status VARCHAR(20) DEFAULT 'active',
        requests_count INTEGER DEFAULT 0,
        last_used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS video_generation_tasks (
        id SERIAL PRIMARY KEY,
        task_id VARCHAR(255) NOT NULL,
        xclip_api_key_id INTEGER REFERENCES xclip_api_keys(id),
        user_id INTEGER REFERENCES users(id),
        model VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        video_url TEXT,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        room_id INTEGER REFERENCES rooms(id),
        key_index INTEGER
      )
    `);

    // Migration: add error_message column to video_generation_tasks if missing
    await pool.query(`ALTER TABLE video_generation_tasks ADD COLUMN IF NOT EXISTS error_message TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE video_generation_tasks ADD COLUMN IF NOT EXISTS used_key_name VARCHAR(255)`).catch(() => {});
    await pool.query(`ALTER TABLE video_generation_tasks ADD COLUMN IF NOT EXISTS retry_data JSONB`).catch(() => {});
    await pool.query(`ALTER TABLE video_generation_tasks ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0`).catch(() => {});
    await pool.query(`ALTER TABLE video_generation_tasks ADD COLUMN IF NOT EXISTS original_task_id VARCHAR(255)`).catch(() => {});

    // Seed rooms if empty
    const existingRooms = await pool.query('SELECT COUNT(*) FROM rooms');
    if (parseInt(existingRooms.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO rooms (name, max_users, status, provider_key_name, provider, key_name_1, key_name_2, key_name_3) VALUES
          ('Room 1', 5, 'OPEN', 'FREEPIK_API_KEY_1', 'freepik', 'ROOM1_FREEPIK_KEY_1', 'ROOM1_FREEPIK_KEY_2', 'ROOM1_FREEPIK_KEY_3'),
          ('Room 2', 5, 'OPEN', 'FREEPIK_API_KEY_2', 'freepik', 'ROOM2_FREEPIK_KEY_1', 'ROOM2_FREEPIK_KEY_2', 'ROOM2_FREEPIK_KEY_3'),
          ('Room 3', 5, 'OPEN', 'FREEPIK_API_KEY_3', 'freepik', 'ROOM3_FREEPIK_KEY_1', 'ROOM3_FREEPIK_KEY_2', 'ROOM3_FREEPIK_KEY_3')
      `);
      console.log('Rooms seeded');
    }

    // Create motion_rooms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS motion_rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        max_users INTEGER DEFAULT 10,
        active_users INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'OPEN',
        key_name_1 VARCHAR(100),
        key_name_2 VARCHAR(100),
        key_name_3 VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed motion rooms if empty
    const existingMotionRooms = await pool.query('SELECT COUNT(*) FROM motion_rooms');
    if (parseInt(existingMotionRooms.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO motion_rooms (name, max_users, status, key_name_1, key_name_2, key_name_3) VALUES
          ('Motion Room 1', 100, 'OPEN', 'MOTION_ROOM1_KEY_1', 'MOTION_ROOM1_KEY_2', 'MOTION_ROOM1_KEY_3'),
          ('Motion Room 2', 100, 'OPEN', 'MOTION_ROOM2_KEY_1', 'MOTION_ROOM2_KEY_2', 'MOTION_ROOM2_KEY_3'),
          ('Motion Room 3', 100, 'OPEN', 'MOTION_ROOM3_KEY_1', 'MOTION_ROOM3_KEY_2', 'MOTION_ROOM3_KEY_3')
      `);
      console.log('Motion rooms seeded');
    }

    // Create motion_subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS motion_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        motion_room_id INTEGER REFERENCES motion_rooms(id),
        expired_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create xmaker_rooms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS xmaker_rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        max_users INTEGER DEFAULT 10,
        current_users INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'OPEN',
        is_active BOOLEAN DEFAULT true,
        key_name VARCHAR(100),
        key_name_1 VARCHAR(100),
        key_name_2 VARCHAR(100),
        key_name_3 VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed xmaker rooms if empty
    const existingXmakerRooms = await pool.query('SELECT COUNT(*) FROM xmaker_rooms');
    if (parseInt(existingXmakerRooms.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO xmaker_rooms (name, max_users, status, is_active, key_name, key_name_1, key_name_2, key_name_3) VALUES
          ('X Maker Room 1', 10, 'OPEN', true, 'XMAKER_ROOM1_KEY', 'XMAKER_ROOM1_KEY_1', 'XMAKER_ROOM1_KEY_2', 'XMAKER_ROOM1_KEY_3'),
          ('X Maker Room 2', 10, 'OPEN', true, 'XMAKER_ROOM2_KEY', 'XMAKER_ROOM2_KEY_1', 'XMAKER_ROOM2_KEY_2', 'XMAKER_ROOM2_KEY_3'),
          ('X Maker Room 3', 10, 'OPEN', true, 'XMAKER_ROOM3_KEY', 'XMAKER_ROOM3_KEY_1', 'XMAKER_ROOM3_KEY_2', 'XMAKER_ROOM3_KEY_3')
      `);
      console.log('X Maker rooms seeded');
    }

    // Create xmaker_subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS xmaker_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        xmaker_room_id INTEGER REFERENCES xmaker_rooms(id),
        expired_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
          ('1 Hari', 1, 30000, 'Akses semua fitur selama 1 hari'),
          ('3 Hari', 3, 65000, 'Akses semua fitur selama 3 hari'),
          ('1 Minggu', 7, 100000, 'Akses semua fitur selama 7 hari'),
          ('1 Bulan', 30, 200000, 'Akses semua fitur selama 30 hari')
      `);
      console.log('Subscription plans seeded');
    } else {
      await pool.query(`UPDATE subscription_plans SET price_idr = 30000 WHERE name = '1 Hari' AND price_idr != 30000`);
      await pool.query(`UPDATE subscription_plans SET price_idr = 65000 WHERE name = '3 Hari' AND price_idr != 65000`);
      await pool.query(`UPDATE subscription_plans SET name = '1 Minggu', price_idr = 100000 WHERE name = '7 Hari'`);
      await pool.query(`UPDATE subscription_plans SET price_idr = 100000 WHERE name = '1 Minggu' AND price_idr != 100000`);
      await pool.query(`UPDATE subscription_plans SET price_idr = 200000 WHERE name = '1 Bulan' AND price_idr != 200000`);
      const has3Hari = await pool.query(`SELECT id FROM subscription_plans WHERE name = '3 Hari'`);
      if (has3Hari.rows.length === 0) {
        await pool.query(`INSERT INTO subscription_plans (name, duration_days, price_idr, description) VALUES ('3 Hari', 3, 65000, 'Akses semua fitur selama 3 hari')`);
      }
      const has1Minggu = await pool.query(`SELECT id FROM subscription_plans WHERE name = '1 Minggu'`);
      if (has1Minggu.rows.length === 0) {
        await pool.query(`INSERT INTO subscription_plans (name, duration_days, price_idr, description) VALUES ('1 Minggu', 7, 100000, 'Akses semua fitur selama 7 hari')`);
      }
      console.log('Subscription plans prices synced');
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
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    
    await pool.query(`
      ALTER TABLE vidgen2_tasks ADD COLUMN IF NOT EXISTS api_key_used TEXT
    `).catch(() => {});
    
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
    
    // Create vidgen3_rooms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vidgen3_rooms (
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
    
    // Create vidgen3_tasks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vidgen3_tasks (
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
        retry_count INTEGER DEFAULT 0,
        original_params JSONB DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE vidgen3_tasks ADD COLUMN IF NOT EXISTS original_params JSONB DEFAULT NULL`).catch(() => {});
    
    // Add vidgen3_room_id to subscriptions
    await pool.query(`
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS vidgen3_room_id INTEGER
    `).catch(() => {});
    
    // Seed vidgen3 rooms if empty
    const existingVidgen3Rooms = await pool.query('SELECT COUNT(*) FROM vidgen3_rooms');
    if (parseInt(existingVidgen3Rooms.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO vidgen3_rooms (name, max_users, status, key_name_1, key_name_2, key_name_3) VALUES
          ('Vidgen3 Room 1', 10, 'OPEN', 'VIDGEN3_ROOM1_KEY_1', 'VIDGEN3_ROOM1_KEY_2', 'VIDGEN3_ROOM1_KEY_3'),
          ('Vidgen3 Room 2', 10, 'OPEN', 'VIDGEN3_ROOM2_KEY_1', 'VIDGEN3_ROOM2_KEY_2', 'VIDGEN3_ROOM2_KEY_3'),
          ('Vidgen3 Room 3', 10, 'OPEN', 'VIDGEN3_ROOM3_KEY_1', 'VIDGEN3_ROOM3_KEY_2', 'VIDGEN3_ROOM3_KEY_3')
      `);
      console.log('Vidgen3 rooms seeded');
    }
    
    // Create vidgen4_rooms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vidgen4_rooms (
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
    
    // Create vidgen4_tasks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vidgen4_tasks (
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
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    
    // Add vidgen4_room_id to subscriptions
    await pool.query(`
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS vidgen4_room_id INTEGER
    `).catch(() => {});
    
    // Seed vidgen4 rooms if empty
    const existingVidgen4Rooms = await pool.query('SELECT COUNT(*) FROM vidgen4_rooms');
    if (parseInt(existingVidgen4Rooms.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO vidgen4_rooms (name, max_users, status, key_name_1, key_name_2, key_name_3) VALUES
          ('Vidgen4 Room 1', 10, 'OPEN', 'VIDGEN4_ROOM1_KEY_1', 'VIDGEN4_ROOM1_KEY_2', 'VIDGEN4_ROOM1_KEY_3'),
          ('Vidgen4 Room 2', 10, 'OPEN', 'VIDGEN4_ROOM2_KEY_1', 'VIDGEN4_ROOM2_KEY_2', 'VIDGEN4_ROOM2_KEY_3'),
          ('Vidgen4 Room 3', 10, 'OPEN', 'VIDGEN4_ROOM3_KEY_1', 'VIDGEN4_ROOM3_KEY_2', 'VIDGEN4_ROOM3_KEY_3')
      `);
      console.log('Vidgen4 rooms seeded');
    }
    
    // Create ximage_rooms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ximage_rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        max_users INTEGER DEFAULT 10,
        current_users INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'OPEN',
        key_name_1 VARCHAR(100),
        key_name_2 VARCHAR(100),
        key_name_3 VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create ximage_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ximage_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_id VARCHAR(255),
        model VARCHAR(100),
        prompt TEXT,
        mode VARCHAR(50),
        aspect_ratio VARCHAR(20),
        image_url TEXT,
        reference_image TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    
    // Add ximage_room_id to subscriptions
    await pool.query(`
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ximage_room_id INTEGER
    `).catch(() => {});
    
    // Seed ximage rooms if empty
    const existingXimageRooms = await pool.query('SELECT COUNT(*) FROM ximage_rooms');
    if (parseInt(existingXimageRooms.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO ximage_rooms (name, max_users, status, key_name_1, key_name_2, key_name_3) VALUES
          ('X Image Room 1', 10, 'OPEN', 'XIMAGE_ROOM1_KEY_1', 'XIMAGE_ROOM1_KEY_2', 'XIMAGE_ROOM1_KEY_3'),
          ('X Image Room 2', 10, 'OPEN', 'XIMAGE_ROOM2_KEY_1', 'XIMAGE_ROOM2_KEY_2', 'XIMAGE_ROOM2_KEY_3'),
          ('X Image Room 3', 10, 'OPEN', 'XIMAGE_ROOM3_KEY_1', 'XIMAGE_ROOM3_KEY_2', 'XIMAGE_ROOM3_KEY_3')
      `);
      console.log('X Image rooms seeded');
    }
    
    // Create ximage2_rooms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ximage2_rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        max_users INTEGER DEFAULT 10,
        current_users INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'OPEN',
        key_name_1 VARCHAR(100),
        key_name_2 VARCHAR(100),
        key_name_3 VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create ximage2_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ximage2_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_id VARCHAR(255),
        model VARCHAR(100),
        prompt TEXT,
        mode VARCHAR(50),
        size VARCHAR(50),
        image_url TEXT,
        reference_image TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    
    // Add ximage2_room_id to subscriptions
    await pool.query(`
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ximage2_room_id INTEGER
    `).catch(() => {});
    
    // Seed ximage2 rooms if empty
    const existingXimage2Rooms = await pool.query('SELECT COUNT(*) FROM ximage2_rooms');
    if (parseInt(existingXimage2Rooms.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO ximage2_rooms (name, max_users, status, key_name_1, key_name_2, key_name_3) VALUES
          ('X Image2 Room 1', 10, 'OPEN', 'XIMAGE2_ROOM1_KEY_1', 'XIMAGE2_ROOM1_KEY_2', 'XIMAGE2_ROOM1_KEY_3'),
          ('X Image2 Room 2', 10, 'OPEN', 'XIMAGE2_ROOM2_KEY_1', 'XIMAGE2_ROOM2_KEY_2', 'XIMAGE2_ROOM2_KEY_3'),
          ('X Image2 Room 3', 10, 'OPEN', 'XIMAGE2_ROOM3_KEY_1', 'XIMAGE2_ROOM3_KEY_2', 'XIMAGE2_ROOM3_KEY_3')
      `);
      console.log('X Image2 rooms seeded');
    }
    
    // Create ximage3_rooms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ximage3_rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        max_users INTEGER DEFAULT 10,
        current_users INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'OPEN',
        key_name_1 VARCHAR(100),
        key_name_2 VARCHAR(100),
        key_name_3 VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create ximage3_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ximage3_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        task_id VARCHAR(255),
        model VARCHAR(100),
        prompt TEXT,
        mode VARCHAR(50),
        size VARCHAR(50),
        image_url TEXT,
        reference_image TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    
    // Add ximage3_room_id to subscriptions
    await pool.query(`
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ximage3_room_id INTEGER
    `).catch(() => {});
    
    // Seed ximage3 rooms if empty
    const existingXimage3Rooms = await pool.query('SELECT COUNT(*) FROM ximage3_rooms');
    if (parseInt(existingXimage3Rooms.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO ximage3_rooms (name, max_users, status, key_name_1, key_name_2, key_name_3) VALUES
          ('X Image3 Room 1', 10, 'OPEN', 'XIMAGE3_ROOM1_KEY_1', 'XIMAGE3_ROOM1_KEY_2', 'XIMAGE3_ROOM1_KEY_3'),
          ('X Image3 Room 2', 10, 'OPEN', 'XIMAGE3_ROOM2_KEY_1', 'XIMAGE3_ROOM2_KEY_2', 'XIMAGE3_ROOM2_KEY_3'),
          ('X Image3 Room 3', 10, 'OPEN', 'XIMAGE3_ROOM3_KEY_1', 'XIMAGE3_ROOM3_KEY_2', 'XIMAGE3_ROOM3_KEY_3')
      `);
      console.log('X Image3 rooms seeded');
    }
    
    // Create voiceover_rooms table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS voiceover_rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        max_users INTEGER DEFAULT 10,
        active_users INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'OPEN',
        key_name_1 VARCHAR(100),
        key_name_2 VARCHAR(100),
        key_name_3 VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const existingVoiceoverRooms = await pool.query('SELECT COUNT(*) FROM voiceover_rooms');
    if (parseInt(existingVoiceoverRooms.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO voiceover_rooms (name, max_users, status, key_name_1, key_name_2, key_name_3) VALUES
          ('Voice Room 1', 10, 'OPEN', 'VOICEOVER_ROOM1_KEY_1', 'VOICEOVER_ROOM1_KEY_2', 'VOICEOVER_ROOM1_KEY_3'),
          ('Voice Room 2', 10, 'OPEN', 'VOICEOVER_ROOM2_KEY_1', 'VOICEOVER_ROOM2_KEY_2', 'VOICEOVER_ROOM2_KEY_3'),
          ('Voice Room 3', 10, 'OPEN', 'VOICEOVER_ROOM3_KEY_1', 'VOICEOVER_ROOM3_KEY_2', 'VOICEOVER_ROOM3_KEY_3')
      `);
      console.log('Voiceover rooms seeded');
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS voiceover_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        voiceover_room_id INTEGER REFERENCES voiceover_rooms(id),
        expired_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS voiceover_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        xclip_api_key_id INTEGER REFERENCES xclip_api_keys(id),
        voice_id VARCHAR(100),
        voice_name VARCHAR(200),
        model_id VARCHAR(100),
        text_input TEXT,
        audio_url TEXT,
        duration_ms INTEGER,
        characters_used INTEGER,
        room_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scene_studio_batches (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        batch_id VARCHAR(255) UNIQUE,
        model VARCHAR(100),
        character_desc TEXT DEFAULT '',
        prompts JSONB DEFAULT '[]',
        results JSONB DEFAULT '[]',
        status VARCHAR(50) DEFAULT 'pending',
        total INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    console.log('Scene Studio tables created');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_projects (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        project_id VARCHAR(255) UNIQUE,
        title VARCHAR(500),
        niche VARCHAR(500) NOT NULL,
        format VARCHAR(20) DEFAULT 'shorts',
        video_model VARCHAR(100) DEFAULT 'veo-3.1-fast',
        scene_count INTEGER DEFAULT 3,
        language VARCHAR(50) DEFAULT 'id',
        status VARCHAR(50) DEFAULT 'draft',
        script TEXT,
        final_video_url TEXT,
        error_message TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_scenes (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255) REFERENCES automation_projects(project_id) ON DELETE CASCADE,
        scene_index INTEGER NOT NULL,
        narration TEXT,
        visual_prompt TEXT,
        image_url TEXT,
        image_task_id VARCHAR(255),
        video_task_id VARCHAR(255),
        video_url TEXT,
        audio_url TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        error_message TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Automation tables created');
    try {
      await pool.query(`ALTER TABLE automation_scenes ADD COLUMN IF NOT EXISTS image_url TEXT`);
      await pool.query(`ALTER TABLE automation_scenes ADD COLUMN IF NOT EXISTS image_task_id VARCHAR(255)`);
    } catch (e) {}

    await pool.query(`
      CREATE TABLE IF NOT EXISTS youtube_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        access_token TEXT,
        refresh_token TEXT,
        expiry_date BIGINT,
        channel_name VARCHAR(255),
        channel_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);
    console.log('YouTube tokens table created');

    console.log('[DB] Database initialized successfully');
    
    try {
      const keyStatsResult = await pool.query(`
        SELECT used_key_name, 
          COUNT(*) FILTER (WHERE status='completed') as ok,
          COUNT(*) FILTER (WHERE status='failed') as fail
        FROM video_generation_tasks 
        WHERE model LIKE 'motion-%' 
          AND created_at > NOW() - INTERVAL '48 hours'
          AND status IN ('completed','failed')
          AND used_key_name IS NOT NULL
        GROUP BY used_key_name
      `);
      for (const row of keyStatsResult.rows) {
        motionKeyStats.set(row.used_key_name, {
          success: parseInt(row.ok) || 0,
          fail: parseInt(row.fail) || 0,
          total: (parseInt(row.ok) || 0) + (parseInt(row.fail) || 0)
        });
      }
      console.log(`[STARTUP] Loaded key stats for ${keyStatsResult.rows.length} keys from DB`);
      for (const [name, stats] of motionKeyStats) {
        const rate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(0) : '?';
        console.log(`  [KEY-STAT] ${name}: ${stats.success}/${stats.total} (${rate}%)`);
      }
    } catch (e) {
      console.log('[STARTUP] Could not load key stats:', e.message);
    }

    setTimeout(() => {
      resumePendingTaskPolling();
    }, 5000);
  } catch (error) {
    console.error('[DB] Database init error:', error.message);
    console.error('[DB] Stack:', error.stack);
  }
}

// Start listening IMMEDIATELY so Railway health check passes
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[STARTUP] Xclip server running on http://0.0.0.0:${PORT}`);
  
  // Initialize database in background AFTER server is already listening
  initDatabase().then(async () => {
    console.log('[STARTUP] Database init completed');
    try {
      initVpsProxy();
      console.log(`[STARTUP] Proxy initialized: ${isProxyConfigured() ? 'Decodo ready' : 'No proxy configured'}`);
    } catch (e) {
      console.error('Proxy init error (non-fatal):', e.message);
    }
    try {
      setInterval(cleanupExpiredSubscriptions, 60000);
      cleanupExpiredSubscriptions();
      setInterval(cleanupInactiveUsers, 60000);
    } catch (e) {
      console.error('Cleanup scheduler error (non-fatal):', e.message);
    }
  }).catch(err => {
    console.error('[STARTUP] Database init failed (non-fatal):', err.message);
  });
});
