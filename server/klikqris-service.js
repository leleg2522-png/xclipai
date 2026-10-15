const { randomUUID } = require('node:crypto');
const { PaymentError } = require('./klikqris-provider');
const { MIN_TOPUP, MAX_TOPUP } = require('./api-wallet');

const OPEN = ['creating', 'pending', 'uncertain'];
function publicInvoice(row) {
  if (!row) return null;
  return {
    id: row.id, provider: 'klikqris', package: row.package, planId: row.plan_id,
    billing_type: row.billing_type || 'subscription',
    amount: Number(row.amount), total_amount: row.total_amount == null ? null : Number(row.total_amount),
    status: row.status, created_at: row.created_at, expires_at: row.expires_at, paid_at: row.paid_at,
    qr_url: row.status === 'pending' && (row.qr_image || row.qr_url)
      ? `/api/payments/klikqris/${row.id}/qr` : null,
  };
}
function createPaymentService(pool, provider, wallet) {
  let ready = false, reconciling = false;
  const checks = new Map();
  function requireReady() {
    if (!ready) throw new PaymentError(503, 'Layanan pembayaran sedang disiapkan. Coba lagi nanti.', false, 'PAYMENT_INITIALIZING');
  }
  async function find(id, userId) {
    requireReady();
    const { rows } = await pool.query('SELECT * FROM portal_qris_invoices WHERE id = $1' +
      (userId == null ? '' : ' AND user_id = $2'), userId == null ? [id] : [id, userId]);
    if (!rows[0]) throw new PaymentError(404, 'Tagihan tidak ditemukan.');
    return rows[0];
  }
  async function settle(invoice) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Always lock user before invoice, including callbacks in different processes.
      const user = (await client.query(
        'SELECT subscription_expired_at FROM users WHERE id = $1 FOR UPDATE', [invoice.user_id])).rows[0];
      const row = (await client.query(
        'SELECT * FROM portal_qris_invoices WHERE id = $1 FOR UPDATE', [invoice.id])).rows[0];
      if (!user || !row) throw new PaymentError(404, 'Akun atau tagihan tidak ditemukan.');
      if (row.status === 'paid') { await client.query('COMMIT'); return row; }
      if (!row.signature || !row.total_amount || row.status === 'failed') {
        throw new PaymentError(409, 'Tagihan memerlukan pemeriksaan admin.');
      }
      // Sandbox payments must never grant real subscription time.
      if (row.mode !== 'sandbox' && row.billing_type === 'wallet') {
        if (!wallet) throw new PaymentError(503, 'Saldo API belum tersedia.');
        await wallet.credit(client, row);
      } else if (row.mode !== 'sandbox') {
        const subscriptions = (await client.query(
          'SELECT id, expired_at FROM subscriptions WHERE user_id = $1 FOR UPDATE', [row.user_id])).rows;
        const dates = [Date.now(), user.subscription_expired_at, ...subscriptions.map(s => s.expired_at)]
          .map(value => value instanceof Date ? value.getTime()
            : typeof value === 'number' ? value : Date.parse(value)).filter(Number.isFinite);
        const until = new Date(Math.max(...dates) + row.duration_days * 86400000);
        await client.query('UPDATE users SET subscription_expired_at = $1 WHERE id = $2', [until, row.user_id]);
        if (subscriptions.length) {
          await client.query(`UPDATE subscriptions SET status = 'active', expired_at = $1, plan_id = $2
            WHERE user_id = $3`, [until, row.plan_id, row.user_id]);
        } else {
          await client.query(`INSERT INTO subscriptions (user_id, status, expired_at, plan_id)
            VALUES ($1, 'active', $2, $3)`, [row.user_id, until, row.plan_id]);
        }
      }
      const paid = (await client.query(`UPDATE portal_qris_invoices
        SET status = 'paid', paid_at = NOW(), updated_at = NOW(), last_checked_at = NOW(),
            qr_image = NULL, qr_url = NULL WHERE id = $1 RETURNING *`, [row.id])).rows[0];
      await client.query('COMMIT');
      return paid;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  async function synchronize(row) {
    if (['paid', 'failed'].includes(row.status)) return row;
    // A crash or an ambiguous POST is never retried automatically. Without the
    // original signature/total we cannot safely display a QR or grant access.
    if (!row.signature || !row.total_amount) return row;
    if (checks.has(row.id)) return checks.get(row.id);
    if (row.last_checked_at && Date.now() - Date.parse(row.last_checked_at) < 10000) return row;
    const work = (async () => {
      const result = await provider.status(row);
      if (result.status === 'paid') return settle(row);
      const next = result.status === 'expired' ? 'expired' : row.status;
      return (await pool.query(`UPDATE portal_qris_invoices SET status = $2,
        last_checked_at = NOW(), updated_at = NOW(),
        qr_image = CASE WHEN $2 = 'expired' THEN NULL ELSE qr_image END,
        qr_url = CASE WHEN $2 = 'expired' THEN NULL ELSE qr_url END
        WHERE id = $1 AND status <> 'paid' RETURNING *`, [row.id, next])).rows[0] || find(row.id);
    })();
    checks.set(row.id, work);
    try { return await work; } finally { checks.delete(row.id); }
  }
  return {
    async initialize() {
      await pool.query(`CREATE TABLE IF NOT EXISTS portal_qris_invoices (
        id TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL, plan_id INTEGER NOT NULL,
        package TEXT NOT NULL, duration_days INTEGER NOT NULL CHECK (duration_days > 0),
        amount BIGINT NOT NULL CHECK (amount > 0), total_amount BIGINT,
        mode TEXT NOT NULL CHECK (mode IN ('pg', 'my_pg', 'sandbox')), merchant_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('creating','pending','uncertain','paid','expired','failed')),
        signature TEXT, qr_image BYTEA, qr_url TEXT, expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paid_at TIMESTAMPTZ, last_checked_at TIMESTAMPTZ, UNIQUE (user_id, idempotency_key)
      )`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS portal_qris_one_open_per_user
        ON portal_qris_invoices (user_id) WHERE status IN ('creating','pending','uncertain')`);
      // Additive transition: existing invoices keep their original subscription entitlement.
      await pool.query(`ALTER TABLE portal_qris_invoices
        ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'subscription'
        CHECK (billing_type IN ('subscription','wallet'))`);
      await pool.query(`ALTER TABLE portal_qris_invoices
        ALTER COLUMN plan_id DROP NOT NULL, ALTER COLUMN duration_days DROP NOT NULL`);
      ready = true;
    },
    config() {
      requireReady();
      if (!wallet) throw new PaymentError(503, 'Saldo API belum tersedia.');
      wallet.assertReady();
      const { mode, callbackConfigured } = provider.configuration();
      return { available: true, provider: 'klikqris', sandbox: mode === 'sandbox', callbackConfigured };
    },
    async create(userId, amount, idem) {
      requireReady();
      if (!Number.isSafeInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP ||
          typeof idem !== 'string' || !/^[\w.-]{1,128}$/.test(idem)) {
        throw new PaymentError(400, 'Nominal top up harus rupiah bulat, minimal Rp100.000 dan maksimal Rp100.000.000. Idempotency-Key wajib.');
      }
      if (!wallet) throw new PaymentError(503, 'Saldo API belum tersedia.');
      wallet.assertReady();
      const config = provider.configuration();
      const client = await pool.connect();
      let locked = false, invoice;
      try {
        await client.query('SELECT pg_advisory_lock($1, $2)', [73493, userId]);
        locked = true;
        const existing = (await client.query(
          'SELECT * FROM portal_qris_invoices WHERE user_id = $1 AND idempotency_key = $2', [userId, idem])).rows[0];
        if (existing) {
          if (existing.billing_type !== 'wallet' || Number(existing.amount) !== amount) {
            throw new PaymentError(409, 'Idempotency-Key sudah digunakan untuk nominal atau jenis tagihan lain.');
          }
          return existing;
        }
        const active = (await client.query(
          'SELECT id FROM portal_qris_invoices WHERE user_id = $1 AND status = ANY($2::text[]) LIMIT 1', [userId, OPEN])).rows[0];
        if (active) throw new PaymentError(409, 'Masih ada tagihan aktif. Perbarui data dan periksa statusnya.');
        const id = 'xq_' + randomUUID().replaceAll('-', '');
        invoice = (await client.query(`INSERT INTO portal_qris_invoices
          (id, order_id, user_id, idempotency_key, plan_id, package, duration_days, amount, mode, merchant_id, status, billing_type)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'creating','wallet') RETURNING *`,
        [id, 'XCWEB-' + id.slice(3), userId, idem, null, 'Top up saldo API', null, amount,
          config.mode, config.merchantId])).rows[0];
        let created;
        try { created = await provider.create(invoice.order_id, amount, 'Xclip — top up saldo API'); }
        catch (error) {
          await client.query(`UPDATE portal_qris_invoices SET status = $2, updated_at = NOW() WHERE id = $1`,
            [id, error.definite ? 'failed' : 'uncertain']);
          throw error;
        }
        return (await client.query(`UPDATE portal_qris_invoices SET status = 'pending',
          total_amount = $2, signature = $3, qr_image = $4, qr_url = $5, expires_at = $6,
          updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, created.total, created.signature, created.qrImage, created.qrUrl, created.expiresAt])).rows[0];
      } finally {
        if (locked) await client.query('SELECT pg_advisory_unlock($1, $2)', [73493, userId]).catch(() => {});
        client.release();
      }
    },
    find, synchronize,
    async current(userId) {
      requireReady();
      return (await pool.query(
        'SELECT * FROM portal_qris_invoices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId])).rows[0] || null;
    },
    async history(userId) {
      requireReady();
      const legacy = (await pool.query(
        'SELECT id, package, amount, status, created_at FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [userId])).rows;
      const invoices = (await pool.query(
        'SELECT * FROM portal_qris_invoices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [userId])).rows;
      return [...legacy, ...invoices.map(publicInvoice)]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 100);
    },
    async reconcile() {
      if (!ready || reconciling) return;
      try { provider.configuration(); } catch { return; }
      reconciling = true;
      try {
        const { rows } = await pool.query(`SELECT * FROM portal_qris_invoices
          WHERE status = 'pending' AND signature IS NOT NULL
          AND (last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '30 seconds')
          ORDER BY COALESCE(last_checked_at, created_at) LIMIT 20`);
        for (const row of rows) {
          try { await synchronize(row); }
          catch {
            // Back off transient failures without inventing a payment outcome.
            await pool.query('UPDATE portal_qris_invoices SET last_checked_at = NOW() WHERE id = $1', [row.id]).catch(() => {});
          }
        }
      } catch (error) { console.warn('KlikQRIS reconciliation unavailable:', error.code || error.name); }
      finally { reconciling = false; }
    },
  };
}
module.exports = { createPaymentService, publicInvoice };
