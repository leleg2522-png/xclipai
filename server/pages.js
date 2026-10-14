const express = require('express');
const path = require('node:path');

module.exports = function pageRoutes() {
  const router = express.Router();
  const client = path.join(__dirname, '..', 'client');
  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(client, 'developer.html'));
  });
  router.get('/generator', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(client, 'index.html'));
  });
  return router;
};
