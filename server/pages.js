const express = require('express');
const path = require('node:path');

module.exports = function pageRoutes() {
  const router = express.Router();
  const client = path.join(__dirname, '..', 'client');
  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(client, 'developer.html'));
  });
  router.get(['/generator', '/admin', '/index.html', '/manifest.json', '/src/main.js', '/styles/main.css'], (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(410).type('text/plain').send('UI lama telah dihapus. Buka portal API di /.');
  });
  return router;
};
