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
const https = require('https');
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
    
    // Clean inactive users from Video Gen rooms
    const inactiveVideoGen = await pool.query(`
      UPDATE subscriptions 
      SET room_id = NULL 
      WHERE room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, room_id
    `, [cutoffTime]);
    
    // Clean inactive users from Vidgen2 rooms
    const inactiveVidgen2 = await pool.query(`
      UPDATE subscriptions 
      SET vidgen2_room_id = NULL 
      WHERE vidgen2_room_id IS NOT NULL 
      AND (last_active IS NULL OR last_active < $1)
      RETURNING user_id, vidgen2_room_id
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
    
    // Update active_users in vidgen3_rooms table
    await pool.query(`
      UPDATE vidgen3_rooms r SET active_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE s.vidgen3_room_id = r.id
        AND s.status = 'active' 
        AND s.expired_at > NOW()
      )
    `).catch(() => {});
    
    // Update current_users in ximage_rooms table
    await pool.query(`
      UPDATE ximage_rooms r SET current_users = (
        SELECT COUNT(*) FROM subscriptions s 
        WHERE s.ximage_room_id = r.id
        AND s.status = 'active' 
        AND (s.expired_at IS NULL OR s.expired_at > NOW())
      )
    `);
    
    const totalCleaned = inactiveVideoGen.rowCount + inactiveVidgen2.rowCount + inactiveVidgen3.rowCount + inactiveXimage.rowCount;
    if (totalCleaned > 0) {
      console.log(`Cleaned up inactive users: VideoGen=${inactiveVideoGen.rowCount}, Vidgen2=${inactiveVidgen2.rowCount}, Vidgen3=${inactiveVidgen3.rowCount}, XImage=${inactiveXimage.rowCount}`);
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

// ============ MULTI-PROVIDER PROXY SUPPORT ============
const IPROYAL_PROXY = { configured: false };
const PROXYING_IO_PROXIES = [];
let proxyIndex = 0;
const taskProxyMap = new Map();
const blockedProxies = new Map();
let webshareProxy = null;
let webshareFailCount = 0;
let webshareBlockedUntil = 0;
let iproyalFailCount = 0;
let iproyalBlockedUntil = 0;
let proxyProviderToggle = 0;

function initIpRoyalProxy() {
  if (IPROYAL_PROXY.configured) return;
  const host = process.env.IPROYAL_HOST;
  const port = process.env.IPROYAL_PORT;
  const username = process.env.IPROYAL_USERNAME;
  const password = process.env.IPROYAL_PASSWORD;
  if (!host || !port || !username || !password) {
    console.log('[PROXY] IPRoyal ISP not configured (missing IPROYAL_* env vars)');
    return;
  }
  IPROYAL_PROXY.proxy_address = host;
  IPROYAL_PROXY.port = parseInt(port);
  IPROYAL_PROXY.username = username;
  IPROYAL_PROXY.password = password;
  IPROYAL_PROXY.provider = 'iproyal';
  IPROYAL_PROXY.configured = true;
  console.log(`[PROXY] Initialized IPRoyal ISP proxy: ${host}:${port} (PRIMARY)`);
}

function initProxyingIoProxies() {
  if (PROXYING_IO_PROXIES.length > 0) return;
  const host = process.env.GOPROXY_HOST;
  const port = process.env.GOPROXY_PORT;
  const username = process.env.GOPROXY_USERNAME;
  const password = process.env.GOPROXY_PASSWORD;
  if (!host || !port || !username || !password) {
    console.log('[PROXY] Proxying.io not configured (missing GOPROXY_* env vars)');
    return;
  }
  for (let i = 1; i <= 50; i++) {
    PROXYING_IO_PROXIES.push({
      proxy_address: `${i}.${host}`,
      port: parseInt(port),
      username: username,
      password: password,
      provider: 'proxying.io'
    });
  }
  console.log(`[PROXY] Initialized ${PROXYING_IO_PROXIES.length} Proxying.io residential proxies`);
}

const WEBSHARE_PROXIES = [];
let webshareIndex = 0;
let webshareInitialized = false;

async function initWebshareProxy() {
  if (webshareInitialized) return;
  webshareInitialized = true;
  
  const apiKey = process.env.WEBSHARE_API_KEY;
  if (!apiKey) {
    console.log('[PROXY] Webshare not configured (missing WEBSHARE_API_KEY)');
    return;
  }
  
  try {
    console.log('[PROXY] Fetching Webshare proxy list via API...');
    const response = await axios.get('https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100', {
      headers: { 'Authorization': `Token ${apiKey}` },
      timeout: 15000
    });
    
    const proxies = response.data?.results || [];
    if (proxies.length === 0) {
      console.log('[PROXY] Webshare API returned 0 proxies');
      return;
    }
    
    for (const p of proxies) {
      if (p.valid) {
        WEBSHARE_PROXIES.push({
          proxy_address: p.proxy_address,
          port: p.port,
          username: p.username,
          password: p.password,
          provider: 'webshare',
          country: p.country_code
        });
      }
    }
    
    console.log(`[PROXY] Initialized ${WEBSHARE_PROXIES.length} Webshare proxies from API (${proxies.length} total, countries: ${[...new Set(WEBSHARE_PROXIES.map(p => p.country))].join(', ')})`);
  } catch (err) {
    console.log(`[PROXY] Failed to fetch Webshare proxies: ${err.message}`);
  }
}

async function ensureProxiesInitialized() {
  initIpRoyalProxy();
  initProxyingIoProxies();
  await initWebshareProxy();
}

function isProxyConfigured() {
  initIpRoyalProxy();
  initProxyingIoProxies();
  return IPROYAL_PROXY.configured || PROXYING_IO_PROXIES.length > 0 || WEBSHARE_PROXIES.length > 0;
}

function isIpRoyalAvailable() {
  if (!IPROYAL_PROXY.configured) return false;
  if (Date.now() < iproyalBlockedUntil) return false;
  return true;
}

function isWebshareAvailable() {
  if (WEBSHARE_PROXIES.length === 0) return false;
  if (Date.now() < webshareBlockedUntil) return false;
  return true;
}

function markProxyBlocked(proxy) {
  if (!proxy) return;
  if (proxy.provider === 'iproyal') {
    iproyalFailCount++;
    if (iproyalFailCount >= 5) {
      iproyalBlockedUntil = Date.now() + 120000;
      console.log(`[PROXY] IPRoyal ISP blocked ${iproyalFailCount}x, cooldown 2min`);
      iproyalFailCount = 0;
    }
    return;
  }
  if (proxy.provider === 'webshare') {
    webshareFailCount++;
    if (webshareFailCount >= 3) {
      webshareBlockedUntil = Date.now() + 60000;
      console.log(`[PROXY] Webshare blocked ${webshareFailCount}x, cooldown 1min`);
      webshareFailCount = 0;
    }
    return;
  }
  const ip = proxy.proxy_address;
  const entry = blockedProxies.get(ip);
  const count = entry ? entry.count + 1 : 1;
  blockedProxies.set(ip, { blockedAt: Date.now(), count });
  if (count >= 3) {
    console.log(`[PROXY] ${ip} blocked ${count}x, cooldown 3min`);
  }
}

function isProxyBlocked(proxy) {
  if (!proxy) return false;
  if (proxy.provider === 'iproyal') return !isIpRoyalAvailable();
  if (proxy.provider === 'webshare') return !isWebshareAvailable();
  const ip = proxy.proxy_address;
  const entry = blockedProxies.get(ip);
  if (!entry) return false;
  if (entry.count < 3) return false;
  const cooldown = 3 * 60 * 1000;
  if (Date.now() - entry.blockedAt > cooldown) {
    blockedProxies.delete(ip);
    return false;
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of blockedProxies) {
    if (now - entry.blockedAt > 3 * 60 * 1000) {
      blockedProxies.delete(ip);
    }
  }
}, 60000);

function getNextProxy() {
  initIpRoyalProxy();
  initProxyingIoProxies();
  
  const hasIpRoyal = isIpRoyalAvailable();
  const hasWebshare = isWebshareAvailable();
  const hasProxyingIo = PROXYING_IO_PROXIES.length > 0;
  
  if (!hasIpRoyal && !hasWebshare && !hasProxyingIo) return null;
  
  // Priority: IPRoyal ISP (primary) > Webshare > Proxying.io
  if (hasIpRoyal) {
    // IPRoyal is always primary - use it for most requests
    proxyProviderToggle++;
    // 80% IPRoyal, 20% fallback to others for load distribution
    if (proxyProviderToggle % 5 !== 0) {
      return IPROYAL_PROXY;
    }
    // Occasionally use fallback to keep connections warm
    if (hasWebshare) {
      const wp = WEBSHARE_PROXIES[webshareIndex % WEBSHARE_PROXIES.length];
      webshareIndex++;
      return wp;
    }
    if (hasProxyingIo) {
      const totalProxies = PROXYING_IO_PROXIES.length;
      const proxy = PROXYING_IO_PROXIES[proxyIndex % totalProxies];
      proxyIndex++;
      return proxy;
    }
    return IPROYAL_PROXY;
  }
  
  // Fallback when IPRoyal not available
  if (hasWebshare && hasProxyingIo) {
    proxyProviderToggle++;
    if (proxyProviderToggle % 3 !== 0) {
      const wp = WEBSHARE_PROXIES[webshareIndex % WEBSHARE_PROXIES.length];
      webshareIndex++;
      return wp;
    }
    const totalProxies = PROXYING_IO_PROXIES.length;
    for (let i = 0; i < totalProxies; i++) {
      const proxy = PROXYING_IO_PROXIES[proxyIndex % totalProxies];
      proxyIndex++;
      if (!isProxyBlocked(proxy)) return proxy;
    }
    const wp = WEBSHARE_PROXIES[webshareIndex % WEBSHARE_PROXIES.length];
    webshareIndex++;
    return wp;
  }
  
  if (hasWebshare) {
    const wp = WEBSHARE_PROXIES[webshareIndex % WEBSHARE_PROXIES.length];
    webshareIndex++;
    return wp;
  }
  
  const totalProxies = PROXYING_IO_PROXIES.length;
  for (let i = 0; i < totalProxies; i++) {
    const proxy = PROXYING_IO_PROXIES[proxyIndex % totalProxies];
    proxyIndex++;
    if (!isProxyBlocked(proxy)) return proxy;
  }
  const proxy = PROXYING_IO_PROXIES[proxyIndex % totalProxies];
  proxyIndex++;
  return proxy;
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

function applyProxyToConfig(config, proxy) {
  if (proxy) {
    const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.proxy_address}:${proxy.port}`;
    const providerName = proxy.provider === 'iproyal' ? 'IPRoyal ISP (PRIMARY)' : proxy.provider === 'webshare' ? 'Webshare (80M+ IPs)' : 'Proxying.io';
    console.log(`[PROXY] Using ${providerName}: ${proxy.proxy_address}:${proxy.port}`);
    config.httpsAgent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
    config.proxy = false;
  }
  return config;
}

function isFreepikBlocked(response) {
  if (!response) return false;
  const data = response.data;
  if (typeof data === 'string' && (data.includes('Access denied') || data.includes('<!DOCTYPE'))) return true;
  return response.status === 403;
}

async function makeFreepikRequest(method, url, apiKey, body = null, useProxy = true, taskId = null) {
  function buildConfig() {
    const cfg = {
      method,
      url,
      headers: {
        'x-freepik-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    };
    if (body) cfg.data = body;
    return cfg;
  }

  function isSocketError(err) {
    const msg = (err.message || '').toLowerCase();
    return msg.includes('socket hang up') || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('etimedout') || msg.includes('timeout') || msg.includes('ssl') || msg.includes('bad record mac') || msg.includes('ssl3_read_bytes') || msg.includes('epipe') || msg.includes('write epipe') || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || err.code === 'EPIPE' || err.code === 'ERR_SSL_SSLV3_ALERT_BAD_RECORD_MAC';
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
    console.log(`[FREEPIK] ${method} ${url.split('/').slice(-2).join('/')} → direct (no proxy)`);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await axios(directConfig);
        if (isFreepikBlocked(resp)) throw { response: resp, isProxyBlocked: true };
        return resp;
      } catch (err) {
        if (isRateLimited(err) && attempt < 2) {
          const delay = (attempt + 1) * 3000;
          console.log(`[FREEPIK] Rate limited (429), waiting ${delay/1000}s before retry #${attempt + 1}...`);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
  }

  console.log(`[FREEPIK] ${method} ${url.split('/').slice(-2).join('/')} → proxy first, direct fallback`);

  const maxProxyAttempts = 3;
  for (let proxyAttempt = 0; proxyAttempt < maxProxyAttempts; proxyAttempt++) {
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

    console.log(`[PROXY] Attempt ${proxyAttempt + 1}/${maxProxyAttempts} via ${usedProxy.provider}: ${usedProxy.proxy_address}:${usedProxy.port}`);
    try {
      const resp = await axios(proxyConfig);
      if (isFreepikBlocked(resp)) throw { response: resp, isProxyBlocked: true };
      console.log(`[PROXY] Success via ${usedProxy.proxy_address}`);
      return resp;
    } catch (proxyErr) {
      const blocked = isBlocked(proxyErr);
      const socketErr = isSocketError(proxyErr);
      const rateLimited = isRateLimited(proxyErr);

      if (blocked || socketErr || rateLimited) {
        console.log(`[PROXY] ${rateLimited ? '429 rate limited' : socketErr ? 'Socket error' : 'IP blocked'} on ${usedProxy.proxy_address}. Trying next proxy...`);
        if (blocked || socketErr) markProxyBlocked(usedProxy);
        if (taskId) releaseProxyForTask(taskId);
        if (rateLimited) await sleep(3000);
        continue;
      }
      throw proxyErr;
    }
  }

  console.log(`[FREEPIK] All proxies failed, trying direct connection...`);
  const directConfig = buildConfig();
  const retryDelays = [5000, 10000, 15000, 20000];

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await axios(directConfig);
      if (isFreepikBlocked(resp)) throw { response: resp, isProxyBlocked: true };
      console.log(`[FREEPIK] Direct connection success`);
      return resp;
    } catch (err) {
      if (isRateLimited(err) && attempt < 3) {
        const delay = retryDelays[attempt];
        console.log(`[FREEPIK] Rate limited (429), waiting ${delay/1000}s before retry #${attempt + 1}...`);
        await sleep(delay);
        continue;
      }
      if (isSocketError(err) && attempt < 3) {
        console.log(`[FREEPIK] Socket error on direct, retry #${attempt + 1}...`);
        await sleep(3000);
        continue;
      }
      console.log(`[FREEPIK] Direct connection failed: ${err.message}`);
      throw err;
    }
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
        console.log(`Using Proxying.io proxy: ${proxy.proxy_address}:${proxy.port}`);
        const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.proxy_address}:${proxy.port}`;
        const response = await axios({
          method,
          url: freepikUrl,
          headers: {
            'x-freepik-api-key': apiKey,
            'Content-Type': 'application/json'
          },
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
        await pool.query(
          'UPDATE vidgen3_tasks SET status = $1, error_message = $2, completed_at = NOW() WHERE task_id = $3',
          ['failed', data.error || 'Generation failed', taskId]
        );
        sendSSEToUser(v3Task.user_id, {
          type: 'vidgen3_failed',
          taskId: taskId,
          error: data.error || 'Video generation failed'
        });
        console.log(`[VIDGEN3] Webhook: Video failed! Task ${taskId}`);
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
      releaseProxyForTask(taskId);
      await pool.query(
        'UPDATE video_generation_tasks SET status = $1, video_url = $2, completed_at = CURRENT_TIMESTAMP WHERE task_id = $3',
        ['completed', videoUrl, taskId]
      );
      
      const isMotionTask = task.model && task.model.startsWith('motion-');
      const sent = sendSSEToUser(task.user_id, {
        type: isMotionTask ? 'motion_completed' : 'video_completed',
        taskId: taskId,
        videoUrl: videoUrl,
        model: task.model
      });
      
      console.log(`Webhook: ${isMotionTask ? 'Motion' : 'Video'} completed! Task ${taskId}, SSE sent: ${sent}`);
    } else if (isFailed) {
      releaseProxyForTask(taskId);
      await pool.query(
        'UPDATE video_generation_tasks SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE task_id = $2',
        ['failed', taskId]
      );
      
      const isMotionFailed = task.model && task.model.startsWith('motion-');
      sendSSEToUser(task.user_id, {
        type: isMotionFailed ? 'motion_failed' : 'video_failed',
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
    
    const { proxy: pendingProxy, pendingId } = await getOrAssignProxyForPendingTask();
    
    for (let attempt = 0; attempt < allKeys.length; attempt++) {
      const currentKey = allKeys[attempt];
      console.log(`[TIMING] Attempt ${attempt + 1}/${allKeys.length} - Using key: ${currentKey.name} | Model: ${model}`);
      
      try {
        const response = await makeFreepikRequest(
          'POST',
          `${baseUrl}${config.endpoint}`,
          currentKey.key,
          requestBody,
          true,
          pendingId
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
    
    console.log(`[TIMING] Task ${taskId} created in ${createLatency}ms at ${requestTime} | Model: ${model}`);
    
    if (taskId && pendingId) {
      promoteProxyToTask(pendingId, taskId);
    } else if (pendingId) {
      releaseProxyForTask(pendingId);
    }
    
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
      true,
      taskId
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
    
    // Build list of all available Motion keys: current room first, then other rooms
    const allMotionKeys = [];
    
    // Current room's keys first
    const roomKeyPrefix = `MOTION_ROOM${selectedRoomId}_KEY_`;
    [1, 2, 3].forEach(i => {
      const keyName = `${roomKeyPrefix}${i}`;
      if (process.env[keyName]) {
        allMotionKeys.push({ key: process.env[keyName], name: keyName, roomId: selectedRoomId });
      }
    });
    
    // Then keys from other rooms as fallback
    const totalRooms = 5;
    for (let r = 1; r <= totalRooms; r++) {
      if (r === selectedRoomId) continue;
      [1, 2, 3].forEach(i => {
        const keyName = `MOTION_ROOM${r}_KEY_${i}`;
        if (process.env[keyName]) {
          allMotionKeys.push({ key: process.env[keyName], name: keyName, roomId: r });
        }
      });
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
    
    console.log(`[MOTION] Generating motion video with model: ${model} (using proxy)`);
    
    let successResponse = null;
    let lastError = null;
    usedKeyName = null;
    
    for (let attempt = 0; attempt < allMotionKeys.length; attempt++) {
      const currentKey = allMotionKeys[attempt];
      console.log(`[MOTION] Attempt ${attempt + 1}/${allMotionKeys.length} - Key: ${currentKey.name} (room ${currentKey.roomId})`);
      
      try {
        const response = await makeFreepikRequest(
          'POST',
          `https://api.freepik.com${endpoint}`,
          currentKey.key,
          requestBody,
          true,
          null
        );
        
        successResponse = response;
        usedKeyName = currentKey.name;
        freepikApiKey = currentKey.key;
        console.log(`[MOTION] Key ${currentKey.name} worked!`);
        break;
        
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const errorMsg = error.response?.data?.message || error.response?.data?.detail || error.message || '';
        const isDailyLimit = status === 429 || errorMsg.toLowerCase().includes('daily limit') || errorMsg.toLowerCase().includes('limit');
        const isNetworkError = !status && (errorMsg.includes('socket hang up') || errorMsg.includes('timeout') || errorMsg.includes('ECONNRESET') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('ssl') || errorMsg.includes('bad record mac'));
        
        if (isDailyLimit) {
          console.log(`[MOTION] Key ${currentKey.name} hit daily limit (${status}), trying next key...`);
          continue;
        } else if (isNetworkError) {
          console.log(`[MOTION] Key ${currentKey.name} network error: ${errorMsg}, trying next key...`);
          continue;
        } else {
          console.error(`[MOTION] Key ${currentKey.name} failed with status ${status}:`, errorMsg);
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
    
    const taskId = successResponse.data?.data?.task_id || successResponse.data?.task_id || successResponse.data?.data?.id || successResponse.data?.id;
    
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
      console.log(`[MOTION] Task ${taskId} already failed (via webhook), returning from DB`);
      return res.json({
        status: 'failed',
        error: 'Task gagal diproses',
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
      const roomKeys = ['MOTION_ROOM1_KEY_1', 'MOTION_ROOM2_KEY_1', 'MOTION_ROOM3_KEY_1', 'MOTION_ROOM4_KEY_1', 'MOTION_ROOM5_KEY_1', 'ROOM1_FREEPIK_KEY_1', 'ROOM2_FREEPIK_KEY_1', 'ROOM3_FREEPIK_KEY_1'];
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
          true,
          null
        );
        
        if (pollResponse.data && typeof pollResponse.data === 'object' && !pollResponse.data?.message?.includes('Not found')) {
          response = pollResponse;
          successEndpoint = endpoint;
          console.log(`[MOTION] Poll success with: ${endpoint}`);
          
          const status = pollResponse.data?.data?.status || pollResponse.data?.status;
          if (status && status !== 'CREATED') {
            console.log(`[MOTION] Found active status ${status} on ${endpoint}`);
            break;
          }
        } else if (typeof pollResponse.data === 'string') {
          console.log(`[MOTION] Endpoint ${endpoint} returned HTML/text, skipping`);
        }
      } catch (err) {
        console.log(`[MOTION] Poll endpoint ${endpoint} failed:`, err.response?.data?.message || err.message);
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
    }
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

// Delete motion from history
app.delete('/api/motion/history/:taskId', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  
  try {
    const { taskId } = req.params;
    await pool.query(
      `UPDATE video_generation_tasks 
       SET status = 'deleted' 
       WHERE task_id = $1 AND user_id = $2 AND model LIKE 'motion-%'`,
      [taskId, req.session.userId]
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
    
    const usage = { 1: 0, 2: 0, 3: 0 };
    result.rows.forEach(row => {
      if (row.room_id && usage.hasOwnProperty(row.room_id)) {
        usage[row.room_id] = parseInt(row.active_users) || 0;
      }
    });
    
    res.json({ usage });
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

// Helper: Get Vidgen3 room API key (Freepik-based)
async function getVidgen3RoomApiKey(xclipApiKey) {
  const keyInfo = await validateXclipApiKey(xclipApiKey);
  if (!keyInfo) {
    return { error: 'Xclip API key tidak valid' };
  }
  
  const subResult = await pool.query(`
    SELECT s.vidgen3_room_id 
    FROM subscriptions s 
    WHERE s.user_id = $1 AND s.status = 'active' 
    AND (s.expired_at IS NULL OR s.expired_at > NOW())
    ORDER BY s.created_at DESC LIMIT 1
  `, [keyInfo.user_id]);
  
  const vidgen3RoomId = subResult.rows[0]?.vidgen3_room_id || 1;
  
  const roomKeyPrefix = `VIDGEN3_ROOM${vidgen3RoomId}_KEY_`;
  const availableKeys = [1, 2, 3].map(i => `${roomKeyPrefix}${i}`).filter(k => process.env[k]);
  
  if (availableKeys.length === 0) {
    for (let r = 1; r <= 3; r++) {
      for (let k = 1; k <= 3; k++) {
        const keyName = `VIDGEN3_ROOM${r}_KEY_${k}`;
        if (process.env[keyName]) {
          return { 
            apiKey: process.env[keyName], 
            keyName,
            roomId: vidgen3RoomId,
            userId: keyInfo.user_id,
            keyInfoId: keyInfo.id,
            isAdmin: keyInfo.is_admin
          };
        }
      }
    }
    if (process.env.FREEPIK_API_KEY) {
      return { 
        apiKey: process.env.FREEPIK_API_KEY, 
        keyName: 'FREEPIK_API_KEY',
        roomId: vidgen3RoomId,
        userId: keyInfo.user_id,
        keyInfoId: keyInfo.id,
        isAdmin: keyInfo.is_admin
      };
    }
    return { error: 'Tidak ada API key Vidgen3 yang tersedia. Hubungi admin.' };
  }
  
  const randomKeyName = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  return { 
    apiKey: process.env[randomKeyName], 
    keyName: randomKeyName,
    roomId: vidgen3RoomId,
    userId: keyInfo.user_id,
    keyInfoId: keyInfo.id,
    isAdmin: keyInfo.is_admin
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
            timeout: 120000
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
    // Models: sora-2-stable, veo3.1-fast, grok-imagine
    // Endpoint: https://api.poyo.ai/api/generate/submit
    const modelConfig = {
      'sora-2-10s': { apiModel: 'sora-2-stable', duration: 10, type: 'video' },
      'sora-2-15s': { apiModel: 'sora-2-stable', duration: 15, type: 'video' },
      'veo-3.1-fast': { apiModel: 'veo3.1-fast', duration: 8, type: 'video' },
      'grok-imagine': { apiModel: 'grok-imagine', duration: 6, type: 'grok' }
    };
    const config = modelConfig[model] || modelConfig['sora-2-10s'];
    const poyoModel = config.apiModel;
    const apiEndpoint = 'https://api.poyo.ai/api/generate/submit';
    
    // Duration based on model selection
    const videoDuration = config.duration;
    
    // Aspect ratio
    const poyoAspectRatio = aspectRatio || '16:9';
    
    // Grok Imagine mode (fun/normal/spicy)
    const grokMode = req.body.grokMode || 'normal';
    
    console.log(`[VIDGEN2] Generating with Poyo.ai model: ${poyoModel}, duration: ${videoDuration}s, aspect: ${poyoAspectRatio}${config.type === 'grok' ? ', mode: ' + grokMode : ''}`);
    
    // Prepare request to Poyo.ai
    const effectivePrompt = prompt || 'Generate a cinematic video with smooth motion';
    
    let requestBody;
    
    if (config.type === 'grok') {
      // Grok Imagine has different request format
      requestBody = {
        model: poyoModel,
        input: {
          prompt: effectivePrompt,
          aspect_ratio: poyoAspectRatio,
          mode: grokMode
        }
      };
      
      // Add image for image-to-video
      if (imageUrl) {
        requestBody.input.imageUrls = [imageUrl];
        console.log(`[VIDGEN2] Grok Imagine image-to-video mode with image: ${imageUrl}`);
      }
    } else if (poyoModel.includes('sora')) {
      // Sora 2 format - uses image_url (singular) and image_urls (plural) for reference
      requestBody = {
        model: poyoModel,
        input: {
          prompt: effectivePrompt,
          duration: videoDuration,
          aspect_ratio: poyoAspectRatio
        }
      };
      
      if (imageUrl) {
        requestBody.input.image_url = imageUrl;
        requestBody.input.image_urls = [imageUrl];
        
        const charConsistencyPrompt = 'This is an image-to-video generation. The uploaded reference image must be used as the starting frame. Maintain exact character appearance, facial features, clothing, hairstyle, body proportions, skin tone, eye color, hair color and style, and facial structure from the reference image throughout every frame of the video. The character must look identical to the reference image at all times. Do not alter, morph, or change the character face or body in any frame.';
        requestBody.input.prompt = charConsistencyPrompt + ' ' + effectivePrompt;
        
        console.log(`[VIDGEN2] Sora 2 image-to-video with character consistency - image: ${imageUrl}`);
      }
    } else {
      // Veo 3.1 format
      requestBody = {
        model: poyoModel,
        input: {
          prompt: effectivePrompt,
          duration: videoDuration,
          aspect_ratio: poyoAspectRatio
        }
      };
      
      if (imageUrl) {
        requestBody.input.image_urls = [imageUrl];
        requestBody.input.imageUrls = [imageUrl];
        
        const charConsistencyPrompt = 'Maintain exact character appearance, facial features, clothing, hairstyle, and body proportions from the reference image throughout the entire video. The character must look identical to the reference image. Preserve skin tone, eye color, hair color and style, facial structure, and all distinctive features exactly as shown in the source image.';
        requestBody.input.prompt = effectivePrompt + '. ' + charConsistencyPrompt;
        
        console.log(`[VIDGEN2] Veo 3.1 image-to-video with character consistency - image: ${imageUrl}`);
      }
    }
    
    console.log(`[VIDGEN2] Request body:`, JSON.stringify(requestBody));
    
    const requestConfig = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${roomKeyResult.apiKey}`
      },
      timeout: 60000
    };
    
    // Vidgen2 uses direct connection (no proxy)
    let response;
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
      try {
        response = await axios.post(apiEndpoint, requestBody, requestConfig);
        break;
      } catch (retryError) {
        const isRateLimit = retryError.response?.status === 429 || 
                            retryError.response?.data?.message?.includes('Too many requests');
        
        if (isRateLimit && retries < maxRetries - 1) {
          retries++;
          const waitTime = Math.pow(2, retries) * 10000;
          console.log(`[VIDGEN2] Rate limited, waiting ${waitTime/1000}s before retry ${retries}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw retryError;
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
        
        // Setup request config with optional proxy
        const statusConfig = {
          headers: {
            'Authorization': `Bearer ${roomKeyResult.apiKey}`
          },
          timeout: 30000
        };
        
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

// Delete vidgen2 video permanently
app.delete('/api/vidgen2/video/:id', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const videoId = req.params.id;
  
  try {
    // Verify ownership and delete
    const result = await pool.query(
      'DELETE FROM vidgen2_tasks WHERE id = $1 AND user_id = $2 RETURNING id',
      [videoId, req.session.userId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Video tidak ditemukan' });
    }
    
    console.log(`[VIDGEN2] Video ${videoId} deleted by user ${req.session.userId}`);
    res.json({ success: true, message: 'Video berhasil dihapus' });
  } catch (error) {
    console.error('[VIDGEN2] Delete video error:', error);
    res.status(500).json({ error: 'Gagal menghapus video' });
  }
});

// Delete all vidgen2 videos for user
app.delete('/api/vidgen2/videos/all', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const result = await pool.query(
      'DELETE FROM vidgen2_tasks WHERE user_id = $1 RETURNING id',
      [req.session.userId]
    );
    
    console.log(`[VIDGEN2] Deleted ${result.rowCount} videos for user ${req.session.userId}`);
    res.json({ success: true, deleted: result.rowCount, message: `${result.rowCount} video berhasil dihapus` });
  } catch (error) {
    console.error('[VIDGEN2] Delete all videos error:', error);
    res.status(500).json({ error: 'Gagal menghapus semua video' });
  }
});

// ============ VIDGEN3 (Freepik Video Generation) API ============

const VIDGEN3_MODEL_CONFIGS = {
  'minimax-live': { 
    endpoint: '/v1/ai/image-to-video/minimax-live',
    pollEndpoint: '/v1/ai/image-to-video/minimax-live',
    type: 'i2v',
    buildBody: (params) => ({
      prompt: params.prompt || '',
      image_url: params.image,
      prompt_optimizer: true
    })
  },
  'seedance-1.5-pro-1080p': {
    endpoint: '/v1/ai/video/seedance-1-5-pro-1080p',
    pollEndpoint: '/v1/ai/video/seedance-1-5-pro-1080p',
    type: 'both',
    buildBody: (params) => ({
      prompt: params.prompt || '',
      ...(params.image ? { image: params.image } : {}),
      duration: parseInt(params.duration) || 5,
      generate_audio: params.generateAudio !== false,
      camera_fixed: params.cameraFixed || false,
      aspect_ratio: params.aspectRatio || 'widescreen_16_9',
      seed: -1
    })
  },
  'seedance-1.5-pro-720p': {
    endpoint: '/v1/ai/video/seedance-1-5-pro-720p',
    pollEndpoint: '/v1/ai/video/seedance-1-5-pro-720p',
    type: 'both',
    buildBody: (params) => ({
      prompt: params.prompt || '',
      ...(params.image ? { image: params.image } : {}),
      duration: parseInt(params.duration) || 5,
      generate_audio: params.generateAudio !== false,
      camera_fixed: params.cameraFixed || false,
      aspect_ratio: params.aspectRatio || 'widescreen_16_9',
      seed: -1
    })
  },
  'ltx-2-pro-t2v': {
    endpoint: '/v1/ai/text-to-video/ltx-2-pro',
    pollEndpoint: '/v1/ai/text-to-video/ltx-2-pro',
    type: 't2v',
    buildBody: (params) => ({
      prompt: params.prompt || '',
      generate_audio: params.generateAudio || false,
      seed: Math.floor(Math.random() * 4294967295),
      resolution: params.resolution || '1080p',
      duration: parseInt(params.duration) || 6,
      fps: parseInt(params.fps) || 25
    })
  },
  'ltx-2-pro-i2v': {
    endpoint: '/v1/ai/image-to-video/ltx-2-pro',
    pollEndpoint: '/v1/ai/image-to-video/ltx-2-pro',
    type: 'i2v',
    buildBody: (params) => ({
      prompt: params.prompt || '',
      image_url: params.image,
      generate_audio: params.generateAudio || false,
      seed: Math.floor(Math.random() * 4294967295),
      resolution: params.resolution || '1080p',
      duration: parseInt(params.duration) || 6,
      fps: parseInt(params.fps) || 25
    })
  },
  'ltx-2-fast-t2v': {
    endpoint: '/v1/ai/text-to-video/ltx-2-fast',
    pollEndpoint: '/v1/ai/text-to-video/ltx-2-fast',
    type: 't2v',
    buildBody: (params) => ({
      prompt: params.prompt || '',
      generate_audio: params.generateAudio || false,
      seed: Math.floor(Math.random() * 4294967295),
      resolution: params.resolution || '1080p',
      duration: parseInt(params.duration) || 6,
      fps: parseInt(params.fps) || 25
    })
  },
  'ltx-2-fast-i2v': {
    endpoint: '/v1/ai/image-to-video/ltx-2-fast',
    pollEndpoint: '/v1/ai/image-to-video/ltx-2-fast',
    type: 'i2v',
    buildBody: (params) => ({
      prompt: params.prompt || '',
      image_url: params.image,
      generate_audio: params.generateAudio || false,
      seed: Math.floor(Math.random() * 4294967295),
      resolution: params.resolution || '1080p',
      duration: parseInt(params.duration) || 6,
      fps: parseInt(params.fps) || 25
    })
  },
  'runway-4.5-t2v': {
    endpoint: '/v1/ai/text-to-video/runway-4-5',
    pollEndpoint: '/v1/ai/text-to-video/runway-4-5',
    type: 't2v',
    buildBody: (params) => ({
      prompt: params.prompt || '',
      ratio: params.ratio || '1280:720',
      duration: parseInt(params.duration) || 5
    })
  },
  'runway-4.5-i2v': {
    endpoint: '/v1/ai/image-to-video/runway-4-5',
    pollEndpoint: '/v1/ai/image-to-video/runway-4-5',
    type: 'i2v',
    buildBody: (params) => ({
      image: params.image,
      prompt: params.prompt || '',
      ratio: params.ratio || '1280:720',
      duration: parseInt(params.duration) || 5,
      seed: Math.floor(Math.random() * 4294967295)
    })
  },
  'runway-gen4-turbo': {
    endpoint: '/v1/ai/image-to-video/runway-gen4-turbo',
    pollEndpoint: '/v1/ai/image-to-video/runway-gen4-turbo',
    type: 'i2v',
    buildBody: (params) => ({
      image: params.image,
      prompt: params.prompt || '',
      ratio: params.ratio || '1280:720',
      duration: parseInt(params.duration) || 10,
      seed: Math.floor(Math.random() * 4294967295)
    })
  },
  'omnihuman-1.5': {
    endpoint: '/v1/ai/video/omni-human-1-5',
    pollEndpoint: '/v1/ai/video/omni-human-1-5',
    type: 'omnihuman',
    buildBody: (params) => ({
      image_url: params.image,
      audio_url: params.audioUrl,
      prompt: params.prompt || '',
      turbo_mode: params.turboMode || false,
      resolution: params.resolution || '1080p'
    })
  }
};

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
    
    const { model, prompt, image, audioUrl, duration, aspectRatio, generateAudio, cameraFixed, ratio, resolution, fps, turboMode } = req.body;
    
    const config = VIDGEN3_MODEL_CONFIGS[model];
    if (!config) {
      return res.status(400).json({ error: `Model tidak didukung: ${model}` });
    }
    
    if (config.type === 'i2v' && !image) {
      return res.status(400).json({ error: 'Image diperlukan untuk model ini' });
    }
    if (config.type === 'omnihuman' && (!image || !audioUrl)) {
      return res.status(400).json({ error: 'Image dan audio URL diperlukan untuk OmniHuman' });
    }
    if (config.type === 't2v' && !prompt) {
      return res.status(400).json({ error: 'Prompt diperlukan untuk text-to-video' });
    }
    if (config.type === 'both' && !prompt && !image) {
      return res.status(400).json({ error: 'Prompt atau image diperlukan' });
    }
    
    const requestBody = config.buildBody({ prompt, image, audioUrl, duration, aspectRatio, generateAudio, cameraFixed, ratio, resolution, fps, turboMode });
    
    const webhookUrl = getWebhookUrl();
    if (webhookUrl) {
      requestBody.webhook_url = webhookUrl;
    }
    
    console.log(`[VIDGEN3] Generating with model: ${model}, endpoint: ${config.endpoint}`);
    console.log(`[VIDGEN3] Request body:`, JSON.stringify(requestBody));
    
    const { proxy: preProxy, pendingId } = await getOrAssignProxyForPendingTask();
    
    const response = await makeFreepikRequest(
      'POST',
      `https://api.freepik.com${config.endpoint}`,
      roomKeyResult.apiKey,
      requestBody,
      true,
      pendingId
    );
    
    console.log(`[VIDGEN3] Freepik response:`, JSON.stringify(response.data));
    
    const data = response.data?.data || response.data;
    const taskId = data.task_id || data.id || response.data?.task_id || response.data?.id;
    
    if (!taskId) {
      if (pendingId) releaseProxyForTask(pendingId);
      console.error('[VIDGEN3] No task_id in response:', JSON.stringify(response.data));
      return res.status(500).json({ error: 'Tidak mendapat task_id dari Freepik' });
    }
    
    if (pendingId) {
      promoteProxyToTask(pendingId, taskId);
    }
    
    await pool.query(`
      INSERT INTO vidgen3_tasks (xclip_api_key_id, user_id, room_id, task_id, model, prompt, used_key_name, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
    `, [roomKeyResult.keyInfoId, roomKeyResult.userId, roomKeyResult.roomId, taskId, model, prompt || '', roomKeyResult.keyName]);
    
    await pool.query(
      'UPDATE xclip_api_keys SET requests_count = requests_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [roomKeyResult.keyInfoId]
    );
    
    console.log(`[VIDGEN3] Task created: ${taskId}`);
    
    res.json({
      taskId: taskId,
      model: model,
      status: 'processing'
    });
    
  } catch (error) {
    console.error('[VIDGEN3] Generate error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: error.response?.data?.message || error.response?.data?.detail || 'Gagal generate video' 
    });
  }
});

// Check Vidgen3 task status
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
      console.log(`[VIDGEN3] Task ${taskId} already completed, returning from DB`);
      return res.json({
        status: 'completed',
        progress: 100,
        videoUrl: task.video_url,
        taskId: taskId,
        model: task.model
      });
    }
    
    if (task.status === 'failed') {
      console.log(`[VIDGEN3] Task ${taskId} already failed, returning from DB`);
      return res.json({
        status: 'failed',
        error: task.error_message || 'Video generation failed',
        taskId: taskId
      });
    }
    
    let freepikApiKey = null;
    if (task.used_key_name && process.env[task.used_key_name]) {
      freepikApiKey = process.env[task.used_key_name];
      console.log(`[VIDGEN3] Using saved key: ${task.used_key_name}`);
    }
    
    if (!freepikApiKey) {
      const roomKeyResult = await getVidgen3RoomApiKey(xclipApiKey);
      if (!roomKeyResult.error) {
        freepikApiKey = roomKeyResult.apiKey;
      }
    }
    
    if (!freepikApiKey) {
      freepikApiKey = process.env.FREEPIK_API_KEY;
    }
    
    if (!freepikApiKey) {
      return res.status(500).json({ error: 'Tidak ada API key yang tersedia' });
    }
    
    const modelConfig = VIDGEN3_MODEL_CONFIGS[task.model];
    if (!modelConfig) {
      return res.json({ status: 'processing', progress: 0, taskId });
    }
    
    const pollUrl = `https://api.freepik.com${modelConfig.pollEndpoint}/${taskId}`;
    console.log(`[VIDGEN3] Polling: ${pollUrl}`);
    
    try {
      const pollResponse = await makeFreepikRequest(
        'GET',
        pollUrl,
        freepikApiKey,
        null,
        true,
        taskId
      );
      
      if (typeof pollResponse.data === 'string') {
        console.log(`[VIDGEN3] Poll returned HTML/text, Freepik may be blocking`);
        return res.json({ status: 'processing', progress: 0, taskId });
      }
      
      console.log(`[VIDGEN3] Poll response:`, JSON.stringify(pollResponse.data));
      const data = pollResponse.data?.data || pollResponse.data;
      
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
          'UPDATE vidgen3_tasks SET status = $1, video_url = $2, completed_at = NOW() WHERE task_id = $3',
          ['completed', videoUrl, taskId]
        ).catch(e => console.error('[VIDGEN3] DB update error:', e));
        
        return res.json({
          status: 'completed',
          progress: 100,
          videoUrl: videoUrl,
          taskId: taskId,
          model: task.model
        });
      }
      
      const normalizedStatus = (data.status || 'processing').toLowerCase();
      if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
        releaseProxyForTask(taskId);
        const errorMsg = data.error_message || data.error || data.message || 'Generation failed';
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
      
      return res.json({
        status: normalizedStatus === 'completed' || normalizedStatus === 'success' ? 'completed' : 'processing',
        progress: data.progress || 0,
        taskId: taskId
      });
      
    } catch (pollError) {
      console.error('[VIDGEN3] Poll error:', pollError.response?.data || pollError.message);
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

// ============ X IMAGE (Poyo.ai Image Generation) ============

// X Image model configuration
const XIMAGE_MODELS = {
  'gpt-image-1.5': { name: 'GPT Image 1.5', provider: 'OpenAI', price: 0.01, supportsI2I: true, apiModel: 'gpt-image-1.5', editModel: 'gpt-image-1.5-edit' },
  'gpt-4o-image': { name: 'GPT-4o Image', provider: 'OpenAI', price: 0.02, supportsI2I: true, apiModel: 'gpt-4o-image', editModel: 'gpt-4o-image-edit' },
  'nano-banana': { name: 'Nano Banana', provider: 'Google', price: 0.03, supportsI2I: true, apiModel: 'nano-banana', editModel: 'nano-banana-edit' },
  'nano-banana-2': { name: 'Nano Banana Pro', provider: 'Google', price: 0.03, supportsI2I: true, apiModel: 'nano-banana-2', editModel: 'nano-banana-2-edit', supportsResolution: true },
  'seedream-4.5': { name: 'Seedream 4.5', provider: 'ByteDance', price: 0.03, supportsI2I: true, apiModel: 'seedream-4.5', editModel: 'seedream-4.5-edit' },
  'flux-2-pro': { name: 'FLUX.2', provider: 'Black Forest', price: 0.03, supportsI2I: true, apiModel: 'flux-2-pro', editModel: 'flux-2-pro-edit', supportsResolution: true },
  'z-image': { name: 'Z-Image', provider: 'Alibaba', price: 0.01, supportsI2I: false, apiModel: 'z-image' },
  'grok-imagine-image': { name: 'Grok Imagine', provider: 'xAI', price: 0.03, supportsI2I: true, apiModel: 'grok-imagine-image' }
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
  
  // Get room keys from environment
  const roomKeyPrefix = `XIMAGE_ROOM${ximageRoomId}_KEY_`;
  const availableKeys = [1, 2, 3].map(i => `${roomKeyPrefix}${i}`).filter(k => process.env[k]);
  
  if (availableKeys.length === 0) {
    // Fallback to global Poyo.ai key
    if (process.env.POYO_API_KEY) {
      return { 
        apiKey: process.env.POYO_API_KEY, 
        keyName: 'POYO_API_KEY',
        roomId: ximageRoomId,
        userId: keyInfo.user_id,
        keyInfoId: keyInfo.id
      };
    }
    return { error: 'Tidak ada API key X Image yang tersedia. Hubungi admin.' };
  }
  
  // Random key rotation
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
    
    const { model, prompt, image, image2, aspectRatio, mode, resolution, numberOfImages } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt diperlukan' });
    }
    
    if (!XIMAGE_MODELS[model]) {
      return res.status(400).json({ error: 'Model tidak valid' });
    }
    
    // For image-to-image mode, check if model supports it
    if (mode === 'image-to-image' && !XIMAGE_MODELS[model].supportsI2I) {
      return res.status(400).json({ error: `Model ${XIMAGE_MODELS[model].name} tidak mendukung image-to-image` });
    }
    
    console.log(`[XIMAGE] Generating with model: ${model}, mode: ${mode || 'text-to-image'}, resolution: ${resolution || 'default'}, n: ${numberOfImages || 1}`);
    
    // Helper to upload a base64 image to Poyo storage
    async function uploadImageToPoyo(imageData, label) {
      if (!imageData) return null;
      if (!imageData.startsWith('data:')) return imageData;
      console.log(`[XIMAGE] Uploading ${label} base64 image to Poyo.ai storage...`);
      const uploadResponse = await axios.post(
        'https://api.poyo.ai/api/common/upload/base64',
        { base64_data: imageData, upload_path: 'xclip-ximage' },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${roomKeyResult.apiKey}`
          },
          timeout: 60000
        }
      );
      if (uploadResponse.data?.data?.file_url) {
        console.log(`[XIMAGE] ${label} uploaded: ${uploadResponse.data.data.file_url}`);
        return uploadResponse.data.data.file_url;
      }
      throw new Error(`Failed to get ${label} URL`);
    }

    // If image-to-image mode, upload images to Poyo storage
    let imageUrls = [];
    if (mode === 'image-to-image' && image) {
      try {
        const url1 = await uploadImageToPoyo(image, 'Reference image 1');
        if (url1) imageUrls.push(url1);
        if (image2) {
          const url2 = await uploadImageToPoyo(image2, 'Reference image 2');
          if (url2) imageUrls.push(url2);
        }
      } catch (uploadError) {
        console.error('[XIMAGE] Image upload error:', uploadError.response?.data || uploadError.message);
        return res.status(500).json({ error: 'Gagal upload image' });
      }
    }
    
    // Prepare request to Poyo.ai with correct model and format
    const modelConfig = XIMAGE_MODELS[model];
    const isI2I = mode === 'image-to-image' && imageUrls.length > 0;
    const apiModelId = isI2I && modelConfig.editModel ? modelConfig.editModel : modelConfig.apiModel;
    
    const requestBody = {
      model: apiModelId,
      input: {
        prompt: prompt,
        size: aspectRatio || '1:1'
      }
    };
    
    // Add n parameter for models that support it (GPT, Nano Banana, Seedream)
    if (['gpt-image-1.5', 'gpt-4o-image', 'nano-banana', 'nano-banana-2', 'seedream-4.5'].includes(model)) {
      requestBody.input.n = numberOfImages || 1;
    }
    
    // Add resolution for models that support it (nano-banana-2, flux-2-pro)
    if (modelConfig.supportsResolution && resolution) {
      requestBody.input.resolution = resolution;
    }
    
    // Add images for image-to-image mode
    if (imageUrls.length > 0) {
      requestBody.input.image_urls = imageUrls;
    }
    
    console.log('[XIMAGE] Request body:', JSON.stringify(requestBody));
    
    // Setup request config
    const requestConfig = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${roomKeyResult.apiKey}`
      },
      timeout: 60000
    };
    
    // X Image uses direct connection (no proxy)
    const response = await axios.post(
      'https://api.poyo.ai/api/generate/submit',
      requestBody,
      requestConfig
    );
    
    console.log('[XIMAGE] Poyo.ai response:', JSON.stringify(response.data));
    
    const taskId = response.data?.data?.task_id || 
                   response.data?.task_id || 
                   response.data?.data?.id || 
                   response.data?.id;
    
    if (!taskId) {
      console.error('[XIMAGE] No task ID in response:', response.data);
      return res.status(500).json({ error: 'Gagal mendapatkan task ID' });
    }
    
    // Save to history
    await pool.query(`
      INSERT INTO ximage_history (user_id, task_id, model, prompt, mode, aspect_ratio, reference_image, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
    `, [roomKeyResult.userId, taskId, model, prompt, mode || 'text-to-image', aspectRatio || '1:1', imageUrls.length > 0 ? imageUrls[0] : null]);
    
    res.json({ 
      taskId, 
      model,
      message: 'Image generation started' 
    });
    
  } catch (error) {
    console.error('[XIMAGE] Generate error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Gagal generate image: ' + (error.response?.data?.message || error.message) });
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
    
    // X Image status uses direct connection (no proxy) with retry
    const statusConfig = {
      headers: {
        'Authorization': `Bearer ${roomKeyResult.apiKey}`
      },
      timeout: 30000
    };
    
    let statusResponse;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        statusResponse = await axios.get(
          `https://api.poyo.ai/api/generate/status/${taskId}`,
          statusConfig
        );
        break;
      } catch (retryErr) {
        const msg = (retryErr.message || '').toLowerCase();
        const isNetErr = !retryErr.response && (msg.includes('socket hang up') || msg.includes('econnreset') || msg.includes('etimedout'));
        if (isNetErr && attempt < 2) {
          console.log(`[XIMAGE] Status poll network error, retry ${attempt + 1}/3: ${retryErr.message}`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        throw retryErr;
      }
    }
    
    console.log('[XIMAGE] Status response:', JSON.stringify(statusResponse.data));
    
    // Keep raw response for proper parsing
    const raw = statusResponse.data;
    
    // Status can be at outer level or in data
    const status = raw.status || raw.data?.status || raw.state || raw.to_status;
    
    if (status === 'finished' || status === 'completed' || status === 'success') {
      // Poyo.ai documented format: { status: 'completed', data: { images: [{ url }] } }
      let imageUrl = null;
      
      // Priority 1: Poyo.ai format - raw.data.files[0].url
      if (raw.data?.files && raw.data.files.length > 0) {
        const file = raw.data.files[0];
        imageUrl = typeof file === 'string' ? file : (file.url || file.file_url || file.image_url);
        console.log('[XIMAGE] Found image in files array:', imageUrl);
      }
      // Priority 2: Documented format - raw.data.images[0].url
      else if (raw.data?.images && raw.data.images.length > 0) {
        imageUrl = raw.data.images[0].url || raw.data.images[0];
      }
      // Priority 3: Direct files/images array at root
      else if (raw.files && raw.files.length > 0) {
        const file = raw.files[0];
        imageUrl = typeof file === 'string' ? file : (file.url || file.file_url || file.image_url);
      }
      else if (raw.images && raw.images.length > 0) {
        imageUrl = raw.images[0].url || raw.images[0];
      }
      // Priority 4: Legacy output formats
      else if (raw.data?.output?.images && raw.data.output.images.length > 0) {
        imageUrl = raw.data.output.images[0].url || raw.data.output.images[0];
      }
      else if (raw.output?.images && raw.output.images.length > 0) {
        imageUrl = raw.output.images[0].url || raw.output.images[0];
      }
      else if (raw.data?.output?.image_url) {
        imageUrl = raw.data.output.image_url;
      }
      else if (raw.output?.image_url) {
        imageUrl = raw.output.image_url;
      }
      else if (raw.data?.media_url) {
        imageUrl = raw.data.media_url;
      }
      else if (raw.media_url) {
        imageUrl = raw.media_url;
      }
      else if (raw.data?.url) {
        imageUrl = raw.data.url;
      }
      else if (raw.url) {
        imageUrl = raw.url;
      }
      
      console.log('[XIMAGE] Extracted image URL:', imageUrl);
      
      // Defensive check - if completed but no URL, return error
      if (!imageUrl) {
        console.error('[XIMAGE] Status completed but no image URL found in response:', raw);
        return res.status(500).json({ 
          status: 'failed', 
          error: 'Image generation completed but no URL returned' 
        });
      }
      
      // Update history
      await pool.query(`
        UPDATE ximage_history 
        SET status = 'completed', image_url = $1, completed_at = NOW()
        WHERE task_id = $2
      `, [imageUrl, taskId]);
      
      return res.json({
        status: 'completed',
        imageUrl
      });
    }
    
    if (status === 'failed' || status === 'error') {
      const errorMsg = raw.error || raw.data?.error || raw.error_message || 'Generation failed';
      
      await pool.query(`
        UPDATE ximage_history 
        SET status = 'failed', completed_at = NOW()
        WHERE task_id = $1
      `, [taskId]);
      
      return res.json({
        status: 'failed',
        error: errorMsg
      });
    }
    
    // Still processing
    const progress = raw.progress || raw.data?.progress || raw.percent || 0;
    res.json({
      status: 'processing',
      progress,
      message: status === 'running' ? 'Image sedang diproses...' : 'Menunggu antrian...'
    });
    
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

// Catch-all route - must be last
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

async function initDatabase() {
  try {
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        room_id INTEGER REFERENCES rooms(id),
        key_index INTEGER
      )
    `);

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
          ('Motion Room 1', 10, 'OPEN', 'MOTION_ROOM1_KEY_1', 'MOTION_ROOM1_KEY_2', 'MOTION_ROOM1_KEY_3'),
          ('Motion Room 2', 10, 'OPEN', 'MOTION_ROOM2_KEY_1', 'MOTION_ROOM2_KEY_2', 'MOTION_ROOM2_KEY_3'),
          ('Motion Room 3', 10, 'OPEN', 'MOTION_ROOM3_KEY_1', 'MOTION_ROOM3_KEY_2', 'MOTION_ROOM3_KEY_3')
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    
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
    
    console.log('Database initialized');
  } catch (error) {
    console.error('Database init error:', error.message);
  }
}

initDatabase().then(async () => {
  await ensureProxiesInitialized();
  setInterval(cleanupExpiredSubscriptions, 60000);
  cleanupExpiredSubscriptions();
  setInterval(cleanupInactiveUsers, 60000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Xclip server running on http://0.0.0.0:${PORT}`);
  });
});
