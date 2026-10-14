const express = require('express');
const { PaymentError, sameSignature } = require('./klikqris-provider');
const { publicInvoice } = require('./klikqris-service');

function paymentRoutes({ service, provider, pool, wallet }) {
  const router = express.Router();
  function failure(res, error) {
    if (!(error instanceof PaymentError)) console.error('KlikQRIS request failed:', error.code || error.name);
    return res.status(error instanceof PaymentError ? error.status : 503).json({
      error: error instanceof PaymentError ? error.message : 'Layanan pembayaran sementara tidak tersedia.',
    });
  }
  function owner(req) {
    if (!req.session?.userId) throw new PaymentError(401, 'Silakan login terlebih dahulu.');
    return req.session.userId;
  }
  const route = fn => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { await fn(req, res); } catch (error) { failure(res, error); }
  };
  router.get('/api/developer/wallet', route(async (req, res) => {
    const userId = owner(req);
    if (!wallet) throw new PaymentError(503, 'Saldo API belum tersedia.');
    res.json(await wallet.get(userId));
  }));
  router.get('/api/payments/klikqris/config', route(async (req, res) => {
    owner(req);
    res.json(service.config());
  }));
  router.get('/api/payments/klikqris/current', route(async (req, res) => {
    res.json({ invoice: publicInvoice(await service.current(owner(req))) });
  }));
  router.post('/api/payments/klikqris/create', route(async (req, res) => {
    const row = await service.create(owner(req), Number(req.body?.amount), req.headers['idempotency-key']);
    res.json({ success: true, invoice: publicInvoice(row) });
  }));
  router.get('/api/payments/klikqris/:id/qr', route(async (req, res) => {
    const row = await service.find(req.params.id, owner(req));
    if (row.status !== 'pending' || Date.parse(row.expires_at) <= Date.now()) {
      throw new PaymentError(410, 'QRIS tidak aktif. Periksa status tagihan.');
    }
    const image = await provider.image(row);
    res.type('png').set('Content-Security-Policy', "default-src 'none'").send(image);
  }));
  router.get('/api/payments/klikqris/:id', route(async (req, res) => {
    const row = await service.find(req.params.id, owner(req));
    res.json({ invoice: publicInvoice(await service.synchronize(row)) });
  }));
  router.post('/api/payments/klikqris/webhook', route(async (req, res) => {
    const body = req.body?.data && typeof req.body.data === 'object' ? req.body.data : req.body;
    if (typeof body?.order_id !== 'string' || !/^XCWEB-[a-f0-9]{32}$/.test(body.order_id)) {
      throw new PaymentError(400, 'Identitas tagihan tidak valid.');
    }
    // Callback is not a claim of payment. Authenticate its original signature,
    // then fetch status and amount independently from the authenticated API.
    const { rows } = await pool.query('SELECT id FROM portal_qris_invoices WHERE order_id = $1', [body.order_id]);
    if (!rows.length) throw new PaymentError(404, 'Tagihan tidak ditemukan.');
    const row = await service.find(rows[0].id);
    if (!row.signature) throw new PaymentError(503, 'Tagihan belum siap untuk diverifikasi.');
    if (!sameSignature(body.signature, row.signature)) throw new PaymentError(403, 'Callback tidak valid.');
    // Bypass only the short polling cache, never authentication or amount validation.
    await service.synchronize({ ...row, last_checked_at: null });
    res.json({ success: true });
  }));
  router.get('/api/payments/my', route(async (req, res) => {
    res.json({ payments: await service.history(owner(req)) });
  }));
  // Stop new manual proof uploads; leave existing approvals and historical data intact.
  router.post('/api/payments/submit', route(async (req) => {
    owner(req);
    throw new PaymentError(410, 'Gunakan pembayaran KlikQRIS dari menu Top up. Unggah bukti manual tidak lagi digunakan.');
  }));
  return router;
}
module.exports = paymentRoutes;
