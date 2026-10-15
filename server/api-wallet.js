const { PaymentError } = require('./klikqris-provider');
const { modelPrices } = require('./video-models');

const VIDEO_PRICE = 6000;
const MIN_TOPUP = 100000;
const MAX_TOPUP = 100000000;
class WalletError extends PaymentError {}
const safeMoney = value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new WalletError(503, 'Data saldo perlu diperiksa.');
  return number;
};

function createApiWallet(pool) {
  let ready = false;
  const requireReady = () => {
    if (!ready) throw new WalletError(503, 'Saldo API sedang disiapkan. Coba lagi nanti.', false, 'PAYMENT_INITIALIZING');
  };
  async function lock(client, userId) {
    requireReady();
    await client.query(`INSERT INTO portal_api_wallets (user_id) VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING`, [userId]);
    const row = (await client.query(
      'SELECT balance FROM portal_api_wallets WHERE user_id = $1 FOR UPDATE', [userId])).rows[0];
    if (!row) throw new WalletError(404, 'Akun saldo tidak ditemukan.');
    return safeMoney(row.balance);
  }
  return {
    assertReady: requireReady,
    async initialize() {
      await pool.query(`CREATE TABLE IF NOT EXISTS portal_api_wallets (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS portal_api_wallet_credits (
        invoice_id TEXT PRIMARY KEY REFERENCES portal_qris_invoices(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount BIGINT NOT NULL CHECK (amount > 0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS portal_api_wallet_charges (
        task_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        amount BIGINT NOT NULL CHECK (amount > 0),
        status TEXT NOT NULL CHECK (status IN ('held','spent','refunded')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS portal_api_wallet_charges_owner_status
        ON portal_api_wallet_charges (user_id, status)`);
      ready = true;
    },
    async get(userId) {
      requireReady();
      const row = (await pool.query(`SELECT COALESCE(w.balance, 0)::text AS balance,
        COALESCE((SELECT SUM(c.amount) FROM portal_api_wallet_charges c
          WHERE c.user_id = u.id AND c.status = 'held'), 0)::text AS reserved
        FROM users u LEFT JOIN portal_api_wallets w ON w.user_id = u.id WHERE u.id = $1`, [userId])).rows[0];
      if (!row) throw new WalletError(404, 'Akun tidak ditemukan.');
      return { balance: safeMoney(row.balance), reserved: safeMoney(row.reserved),
        videoPrice: VIDEO_PRICE, modelPrices, minimumTopup: MIN_TOPUP, maximumTopup: MAX_TOPUP,
        currency: 'IDR', expires: false };
    },
    // Called inside the same transaction that marks the verified invoice paid.
    async credit(client, invoice) {
      await lock(client, invoice.user_id);
      const amount = safeMoney(invoice.amount);
      if (!amount) throw new WalletError(503, 'Nominal saldo tidak valid.');
      const inserted = await client.query(`INSERT INTO portal_api_wallet_credits (invoice_id, user_id, amount)
        VALUES ($1,$2,$3) ON CONFLICT (invoice_id) DO NOTHING RETURNING invoice_id`,
      [invoice.id, invoice.user_id, amount]);
      if (!inserted.rows.length) return;
      const update = await client.query(`UPDATE portal_api_wallets SET balance = balance + $2, updated_at = NOW()
        WHERE user_id = $1 AND balance + COALESCE((SELECT SUM(amount) FROM portal_api_wallet_charges
          WHERE user_id = $1 AND status = 'held'), 0) <= $3 RETURNING balance`,
      [invoice.user_id, amount, Number.MAX_SAFE_INTEGER - amount]);
      if (!update.rows.length) throw new WalletError(503, 'Saldo memerlukan pemeriksaan admin.');
    },
    // Caller stores the task and this reservation in ONE transaction, before dispatch.
    async reserve(client, userId, taskId, price = VIDEO_PRICE) {
      if (!Object.values(modelPrices).includes(price)) throw new WalletError(503, 'Tarif model tidak valid.');
      const balance = await lock(client, userId);
      const existing = (await client.query(
        'SELECT * FROM portal_api_wallet_charges WHERE task_id = $1', [taskId])).rows[0];
      if (existing) throw new WalletError(409, 'Reservasi task sudah tercatat. Jangan kirim ulang.');
      if (balance < price) throw new WalletError(402, `Saldo API tidak cukup. Biaya satu video Rp${price.toLocaleString('id-ID')}.`);
      await client.query(`UPDATE portal_api_wallets SET balance = balance - $2, updated_at = NOW()
        WHERE user_id = $1`, [userId, price]);
      await client.query(`INSERT INTO portal_api_wallet_charges (task_id, user_id, amount, status)
        VALUES ($1,$2,$3,'held')`, [taskId, userId, price]);
    },
    // Terminal results and financial state commit together; later polls cannot reverse them.
    async finish(row, result, existingClient) {
      requireReady();
      const client = existingClient || await pool.connect();
      try {
        await client.query('BEGIN');
        if (row.retry_data?.billing === 'wallet') await lock(client, row.user_id);
        const current = (await client.query(
          'SELECT * FROM video_generation_tasks WHERE task_id = $1 FOR UPDATE', [row.task_id])).rows[0];
        if (!current) throw new WalletError(404, 'Task tidak ditemukan.');
        if (['completed', 'failed'].includes(current.status)) {
          await client.query('COMMIT'); return current;
        }
        if (current.retry_data?.billing === 'wallet') {
          const charge = (await client.query(
            'SELECT * FROM portal_api_wallet_charges WHERE task_id = $1 FOR UPDATE', [row.task_id])).rows[0];
          if (!charge || charge.user_id !== current.user_id || charge.status !== 'held') {
            throw new WalletError(503, 'Reservasi saldo memerlukan pemeriksaan.');
          }
          if (['completed', 'failed'].includes(result.status)) {
            if (result.status === 'failed') {
              await client.query(`UPDATE portal_api_wallets SET balance = balance + $2, updated_at = NOW()
                WHERE user_id = $1`, [current.user_id, safeMoney(charge.amount)]);
            }
            await client.query(`UPDATE portal_api_wallet_charges SET status = $2, updated_at = NOW()
              WHERE task_id = $1`, [row.task_id, result.status === 'completed' ? 'spent' : 'refunded']);
          }
        }
        const updated = (await client.query(`UPDATE video_generation_tasks SET status = $1::text, video_url = $2,
          completed_at = CASE WHEN $1::text IN ('completed','failed') THEN NOW() ELSE completed_at END,
          error_message = CASE WHEN $1::text = 'failed' THEN 'Generasi video gagal.' ELSE NULL END
          WHERE task_id = $3 RETURNING *`,
        [result.status, result.videoUrl || null, row.task_id])).rows[0];
        await client.query('COMMIT');
        return updated;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { if (!existingClient) client.release(); }
    },
  };
}
module.exports = { createApiWallet, WalletError, VIDEO_PRICE, MIN_TOPUP, MAX_TOPUP };
