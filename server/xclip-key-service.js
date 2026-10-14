const { randomBytes } = require('node:crypto');

async function createUserKey(pool, userId, label) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One lock per user also protects against simultaneous browser/API requests.
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [73491, userId]);
    const existing = await client.query(
      'SELECT id FROM xclip_api_keys WHERE user_id = $1 LIMIT 1', [userId]
    );
    if (existing.rows.length) {
      const error = new Error('Anda sudah memiliki Xclip API Key. Setiap user hanya bisa memiliki 1 API key seumur hidup.');
      error.code = 'KEY_ALREADY_EXISTS';
      throw error;
    }
    const apiKey = 'xclip_' + randomBytes(24).toString('hex');
    const result = await client.query(
      `INSERT INTO xclip_api_keys (user_id, api_key, label) VALUES ($1, $2, $3)
       RETURNING id, api_key, label, created_at`,
      [userId, apiKey, label]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createUserKey };
