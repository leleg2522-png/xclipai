const axios = require('axios');
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

function isPrivateAddress(address) {
  const ip = address.toLowerCase().split('%')[0];
  if (ip.startsWith('::ffff:')) return isPrivateAddress(ip.slice(7));
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIP(ip) === 6) {
    return ip === '::' || ip === '::1' || /^(fc|fd|fe[89ab]|ff)/.test(ip) ||
      ip.startsWith('2001:db8:') || ip.startsWith('2002:') || ip.startsWith('64:ff9b:');
  }
  return true;
}

function checkedUrl(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) ||
      host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') && !net.isIP(host) ||
      net.isIP(host) && isPrivateAddress(host)) {
    throw new Error('Media address rejected');
  }
  return url;
}

function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) {
      return callback(new Error('Media address rejected'));
    }
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}
const httpAgent = new http.Agent({ lookup: publicLookup });
const httpsAgent = new https.Agent({ lookup: publicLookup });

const publicVideoUrl = taskId => `/api/videogen/proxy-video?taskId=${encodeURIComponent(taskId)}`;
const publicTask = row => ({
  id: row.id, task_id: row.task_id, model: row.model, status: row.status,
  video_url: row.video_url ? publicVideoUrl(row.task_id) : null,
  created_at: row.created_at, completed_at: row.completed_at, key_label: row.key_label,
});

// Follow upstream redirects only on the server. Never forward Location, CDN headers,
// signed URLs, or upstream error bodies to a caller.
async function streamVideo(req, res, value, request = axios.get) {
  let url = checkedUrl(value);
  const range = req.headers.range;
  if (range && !/^bytes=\d*-\d*$/.test(range)) {
    return res.status(416).json({ error: 'Rentang video tidak valid' });
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const upstream = await request(url.href, {
      responseType: 'stream', timeout: 120000, maxRedirects: 0, proxy: false,
      httpAgent, httpsAgent, headers: range ? { Range: range } : {},
      validateStatus: status => status >= 200 && status < 300 ||
        [301, 302, 303, 307, 308, 416].includes(status),
    });
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      upstream.data.destroy();
      url = checkedUrl(new URL(upstream.headers.location, url).href);
      continue;
    }
    if (upstream.status === 416) {
      upstream.data.destroy();
      return res.status(416).json({ error: 'Rentang video tidak tersedia' });
    }
    const contentType = String(upstream.headers['content-type'] || '').split(';')[0];
    if (!['video/mp4', 'video/webm', 'application/octet-stream'].includes(contentType)) {
      upstream.data.destroy();
      throw new Error('Invalid media response');
    }
    res.status(upstream.status);
    res.setHeader('Content-Type', contentType === 'video/webm' ? 'video/webm' : 'video/mp4');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (/^\d+$/.test(String(upstream.headers['content-length'] || ''))) {
      res.setHeader('Content-Length', upstream.headers['content-length']);
    }
    if (/^bytes \d+-\d+\/(?:\d+|\*)$/.test(String(upstream.headers['content-range'] || ''))) {
      res.setHeader('Content-Range', upstream.headers['content-range']);
    }
    if (upstream.headers['accept-ranges'] === 'bytes') res.setHeader('Accept-Ranges', 'bytes');
    upstream.data.on('error', () => res.destroy());
    res.on('close', () => upstream.data.destroy());
    return upstream.data.pipe(res);
  }
  throw new Error('Media unavailable');
}

module.exports = { publicVideoUrl, publicTask, streamVideo, checkedUrl, isPrivateAddress, httpAgent, httpsAgent };
