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
      const { rows: tables } = await pool.query(
        `SELECT to_regclass('public.picsart_credentials') IS NOT NULL AS picsart,
                to_regclass('public.flora_key_pool') IS NOT NULL AS flora`
      );
      const providers = [];
      if (tables[0].picsart) {
        const { rows } = await pool.query(
          `SELECT EXISTS(SELECT 1 FROM picsart_credentials
            WHERE NULLIF(refresh_token, '') IS NOT NULL) AS configured`
        );
        providers.push({ name: 'Picsart', configured: rows[0].configured, connected: false });
      } else {
        providers.push({ name: 'Picsart', configured: false, connected: false });
      }
      if (tables[0].flora) {
        const { rows } = await pool.query(
          `SELECT EXISTS(SELECT 1 FROM flora_key_pool
            WHERE NULLIF(api_key, '') IS NOT NULL) AS configured`
        );
        providers.push({ name: 'Flora AI', configured: rows[0].configured, connected: false });
      } else {
        providers.push({ name: 'Flora AI', configured: false, connected: false });
      }
      res.json({
        keys,
        hasLifetimeKey: keys.length > 0,
        totalRequests: keys.reduce((sum, key) => sum + Number(key.requests_count || 0), 0),
        providers,
        generationProvider: 'Freepik',
      });
    } catch (error) {
      console.error('Developer overview failed:', error.code || error.name);
      res.status(503).json({ error: 'Data portal belum dapat diambil. Silakan coba lagi.' });
    }
  });
  return router;
};
