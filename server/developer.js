const express = require('express');
const path = require('path');

module.exports = function developerPortal(pool) {
  const router = express.Router();
  router.get('/developer', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '..', 'client', 'developer.html'));
  });

  router.get('/api/developer/overview', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
    }
    try {
      // Only return this user's Xclip keys. Never return upstream credentials.
      const { rows: keys } = await pool.query(
        `SELECT id, api_key, label, status, requests_count, created_at, last_used_at
         FROM xclip_api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
        [req.session.userId]
      );
      res.json({
        keys,
        hasLifetimeKey: keys.length > 0,
        totalRequests: keys.reduce((sum, key) => sum + Number(key.requests_count || 0), 0),
      });
    } catch (error) {
      console.error('Developer overview failed:', error.code || error.name);
      res.status(503).json({ error: 'Data portal belum dapat diambil. Silakan coba lagi.' });
    }
  });
  return router;
};
