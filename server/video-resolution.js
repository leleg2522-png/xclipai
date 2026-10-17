const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const axios = require('axios');
const { checkedUrl, httpAgent, httpsAgent } = require('./public-video');

// Download through DNS-checked transport, then probe a local file. ffprobe must
// never fetch an arbitrary upstream URL or nested playlist itself.
async function verify1080p(value, request = axios.get, probe = promisify(execFile)) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xclip-resolution-'));
  try {
    let url = checkedUrl(value), saved = false;
    for (let redirects = 0; redirects < 4; redirects++) {
      const response = await request(url.href, {
        responseType: 'stream', timeout: 120000, proxy: false, maxRedirects: 0,
        httpAgent, httpsAgent,
        validateStatus: status => status === 200 || [301, 302, 303, 307, 308].includes(status),
      });
      if (response.status !== 200) {
        response.data.destroy();
        url = checkedUrl(new URL(response.headers.location, url).href);
        continue;
      }
      if (!['video/mp4', 'video/webm', 'application/octet-stream'].includes(
        String(response.headers['content-type'] || '').split(';')[0])) {
        response.data.destroy(); throw new Error('Invalid video response');
      }
      let bytes = 0;
      const limit = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(bytes > 250 * 1024 * 1024 ? new Error('Video too large') : null, chunk);
      } });
      await pipeline(response.data, limit, createWriteStream(path.join(dir, 'video.bin')), {
        signal: AbortSignal.timeout(120000),
      });
      saved = true; break;
    }
    if (!saved) throw new Error('Video unavailable');
    let stdout;
    try {
      ({ stdout } = await probe('ffprobe', [
        '-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'json', path.join(dir, 'video.bin'),
      ], { timeout: 15000, maxBuffer: 20000 }));
    } catch (error) {
      if (error.code === 1 && !error.killed) return false; // Complete download, but invalid/unplayable media.
      throw error; // Tooling or timeout failure is not proof of a failed upscale.
    }
    const stream = JSON.parse(stdout).streams?.[0];
    return !!stream && Number.isSafeInteger(stream.width) && Number.isSafeInteger(stream.height) &&
      Math.min(stream.width, stream.height) >= 1080;
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
module.exports = { verify1080p };
