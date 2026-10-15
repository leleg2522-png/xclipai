const { timingSafeEqual } = require('node:crypto');

class PaymentError extends Error {
  constructor(status, message, definite = false, code) {
    super(message);
    this.status = status;
    this.definite = definite;
    if (code) this.code = code;
  }
}
function sameSignature(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b ||
      a.length > 4096 || b.length > 4096 || a.length !== b.length) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function rupiah(value) {
  if (!/^\d+(?:\.0{1,2})?$/.test(String(value))) throw new PaymentError(502, 'Nominal dari gateway tidak valid.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new PaymentError(502, 'Nominal dari gateway tidak valid.');
  return number;
}
function expiry(value) {
  if (typeof value !== 'string') throw new PaymentError(502, 'Masa berlaku tagihan tidak valid.');
  // KlikQRIS's Indonesian local timestamps are displayed in WIB.
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? value.replace(' ', 'T') + '+07:00' : value;
  if (!/(Z|[+-]\d\d:\d\d)$/.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    throw new PaymentError(502, 'Masa berlaku tagihan tidak valid.');
  }
  return new Date(normalized).toISOString();
}
function qrImage(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,') || value.length > 1500000) return null;
  const encoded = value.slice(22);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const buffer = Buffer.from(encoded, 'base64');
  return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? buffer : null;
}
function qrUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['klikqris.com', 'www.klikqris.com'].includes(url.hostname) ||
        url.username || url.password || (url.port && url.port !== '443') ||
        !url.pathname.startsWith('/storage/')) return null;
    return url.href;
  } catch { return null; }
}

function createKlikQrisProvider({ env = process.env, fetcher = fetch } = {}) {
  function settings() {
    const apiKey = env.KLIKQRIS_API_KEY?.trim();
    const merchantId = env.KLIKQRIS_MERCHANT_ID?.trim();
    const mode = env.KLIKQRIS_MODE;
    if (!apiKey || !merchantId) throw new PaymentError(503, 'Kredensial pembayaran KlikQRIS belum tersedia.');
    if (!['pg', 'my_pg', 'sandbox'].includes(mode)) {
      throw new PaymentError(503, 'Mode pembayaran KlikQRIS belum dikonfigurasi. Hubungi admin Xclip.');
    }
    let callbackUrl;
    if (env.KLIKQRIS_CALLBACK_URL) {
      const url = new URL(env.KLIKQRIS_CALLBACK_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
        throw new PaymentError(503, 'Konfigurasi webhook pembayaran tidak valid.');
      }
      callbackUrl = url.href;
    }
    return { apiKey, merchantId, mode, callbackUrl };
  }
  async function request(path, method, body, merchantId) {
    const config = settings();
    if (merchantId && merchantId !== config.merchantId) {
      throw new PaymentError(503, 'Konfigurasi merchant tagihan lama perlu diperiksa admin.');
    }
    let response, payload;
    try {
      response = await fetcher(`https://klikqris.com/api${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { 'x-api-key': config.apiKey, id_merchant: config.merchantId,
          Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      payload = await response.json();
    } catch {
      throw new PaymentError(502, method === 'POST'
        ? 'Pembuatan tagihan belum terkonfirmasi. Jangan membuat ulang; periksa status atau hubungi admin.'
        : 'Status pembayaran belum dapat diperiksa. Coba lagi nanti.');
    }
    if (!response.ok || payload?.status !== true || !payload.data) {
      const definite = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status);
      throw new PaymentError(502, 'Gateway pembayaran belum dapat memproses permintaan. Hubungi admin Xclip.', definite);
    }
    return payload.data;
  }
  function normalizeCreated(data, orderId, amount) {
    if (data.order_id !== orderId || rupiah(data.amount ?? amount) !== amount ||
        typeof data.signature !== 'string' || !data.signature || data.signature.length > 4096) {
      throw new PaymentError(502, 'Tagihan dari gateway belum dapat diverifikasi.');
    }
    const total = rupiah(data.total_amount);
    if (total < amount) throw new PaymentError(502, 'Nominal tagihan dari gateway tidak sesuai.');
    const image = qrImage(data.qris_image);
    const url = qrUrl(data.qris_url);
    if (!image && !url) throw new PaymentError(502, 'QRIS dari gateway belum dapat ditampilkan.');
    return { total, signature: data.signature, qrImage: image, qrUrl: url, expiresAt: expiry(data.expired_at) };
  }
  return {
    configuration() {
      const { mode, merchantId, callbackUrl } = settings();
      return { mode, merchantId, callbackConfigured: !!callbackUrl };
    },
    async create(orderId, amount, description) {
      const { mode, merchantId, callbackUrl } = settings();
      const path = mode === 'my_pg' ? '/qrisv2/create' : mode === 'sandbox' ? '/sandbox/qris/create' : '/qris/create';
      const data = await request(path, 'POST', {
        order_id: orderId, amount, id_merchant: merchantId, keterangan: description,
        // MY PG uses the webhook configured in its dashboard; reconciliation also polls.
        ...(callbackUrl && mode !== 'my_pg' ? { callback_url: callbackUrl } : {}),
      });
      return normalizeCreated(data, orderId, amount);
    },
    async status(invoice) {
      const { merchantId } = settings();
      const id = encodeURIComponent(invoice.order_id);
      const path = invoice.mode === 'my_pg' ? `/qrisv2/status/${encodeURIComponent(merchantId)}/${id}`
        : invoice.mode === 'sandbox' ? `/sandbox/qris/status/${id}` : `/qris/status/${id}`;
      const data = await request(path, 'GET', null, invoice.merchant_id);
      if (data.order_id !== invoice.order_id) throw new PaymentError(502, 'Identitas tagihan tidak sesuai.');
      const status = String(data.status || '').toUpperCase();
      if (!['PENDING', 'SUCCESS', 'PAID', 'EXPIRED'].includes(status)) {
        throw new PaymentError(502, 'Status tagihan belum dapat diverifikasi.');
      }
      if (rupiah(data.total_amount) !== Number(invoice.total_amount) ||
          (data.amount != null && rupiah(data.amount) !== Number(invoice.amount)) ||
          (data.signature != null && !sameSignature(data.signature, invoice.signature)) ||
          (data.merchant_id != null && String(data.merchant_id) !== invoice.merchant_id)) {
        throw new PaymentError(502, 'Data pembayaran dari gateway tidak sesuai.');
      }
      return { status: ['SUCCESS', 'PAID'].includes(status) ? 'paid' : status.toLowerCase() };
    },
    async image(invoice) {
      if (invoice.qr_image) return Buffer.from(invoice.qr_image);
      const url = qrUrl(invoice.qr_url);
      if (!url) throw new PaymentError(404, 'QRIS tidak tersedia.');
      try {
        // Public image endpoint: never forward the merchant's API credentials.
        const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw new Error();
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 1100000) throw new Error();
            chunks.push(Buffer.from(value));
          }
        } finally { await reader.cancel().catch(() => {}); }
        const image = Buffer.concat(chunks);
        if (!image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error();
        return image;
      } catch { throw new PaymentError(502, 'QRIS belum dapat ditampilkan. Jangan membayar sebelum kode terlihat.'); }
    },
  };
}
module.exports = { createKlikQrisProvider, PaymentError, sameSignature, rupiah };
