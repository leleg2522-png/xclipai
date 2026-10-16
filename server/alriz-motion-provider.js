const { checkedUrl } = require('./public-video');

const MODEL = 'mc-kling-2.6-pro';
class MotionError extends Error {
  constructor(status, message, { upstreamStatus, uncertain = false } = {}) {
    super(message);
    this.status = status;
    this.diagnostic = { upstreamStatus };
    this.uncertain = uncertain;
  }
}

function createAlrizMotionProvider({ env = process.env, fetcher = fetch } = {}) {
  const base = 'https://alrizmotion.my.id/api';
  async function request(path, body) {
    if (!env.ALRIZ_API_KEY?.trim()) {
      throw new MotionError(503, 'Layanan Kling Motion Control belum dikonfigurasi.');
    }
    let response;
    try {
      response = await fetcher(base + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          'X-API-Key': env.ALRIZ_API_KEY.trim(),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new MotionError(503, 'Koneksi layanan generasi belum terkonfirmasi.', { uncertain: !!body });
    }
    if (!response.ok) {
      const upstreamStatus = response.status;
      const status = [400, 422].includes(upstreamStatus) ? 400 : upstreamStatus === 429 ? 429 : 503;
      const message = upstreamStatus === 401 || upstreamStatus === 403
        ? 'Kredensial layanan Kling Motion Control ditolak. Hubungi admin Xclip.'
        : status === 400 ? 'Input motion control ditolak. Gunakan gambar JPG/PNG/WebP dan video MP4/MOV maksimal 30 detik.'
          : status === 429 ? 'Layanan motion control sedang penuh. Coba lagi nanti.'
            : 'Layanan Kling Motion Control sementara tidak tersedia.';
      throw new MotionError(status, message, { upstreamStatus,
        uncertain: !!body && (upstreamStatus >= 500 || upstreamStatus === 408) });
    }
    try {
      return await response.json();
    } catch {
      throw new MotionError(503, 'Respons layanan generasi belum dapat diverifikasi.', { uncertain: !!body });
    }
  }
  return {
    async preflight() {
      // Read-only credential validation, before any billable submit.
      await request('/account');
    },
    async submit({ imageUrl, videoUrl, prompt }) {
      const data = await request('/jobs', {
        model: MODEL, image_url: imageUrl, video_url: videoUrl,
        ...(prompt ? { prompt } : {}),
      });
      if (typeof data.job_id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(data.job_id)) {
        throw new MotionError(503, 'Pengiriman generasi belum terkonfirmasi.', { uncertain: true });
      }
      return data.job_id;
    },
    async poll(jobId) {
      if (!/^[a-zA-Z0-9_-]{1,150}$/.test(jobId || '')) throw new MotionError(503, 'ID generasi internal tidak valid.');
      const data = await request('/jobs/' + encodeURIComponent(jobId));
      if (data.status === 'DONE') {
        if (data.result_expired) throw new MotionError(410, 'Video sudah melewati batas penyimpanan.');
        const result = data.result_url ? data : await request('/jobs/' + encodeURIComponent(jobId) + '/result');
        let url;
        try { url = checkedUrl(result.result_url); } catch {
          throw new MotionError(503, 'Video hasil belum dapat diverifikasi.');
        }
        if (url.protocol !== 'https:') throw new MotionError(503, 'Video hasil belum dapat diverifikasi.');
        return { status: 'completed', videoUrl: url.href };
      }
      if (['FAILED', 'NO_STOCK'].includes(data.status)) return { status: 'failed' };
      if (['QUEUED', 'PROCESSING'].includes(data.status)) return { status: 'processing' };
      throw new MotionError(503, 'Status generasi belum dapat diverifikasi.');
    },
  };
}

module.exports = { MODEL, MotionError, createAlrizMotionProvider };
