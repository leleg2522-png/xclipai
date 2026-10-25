const crypto = require('node:crypto');
const cors = require('cors');

// Keep the existing origin allowlist. Reject before body parsing or authentication.
module.exports = function corsPolicy(isAllowedOrigin, log = record => console.warn('[XCLIP_ACCESS]', JSON.stringify(record))) {
  const allow = cors({ credentials: true, origin: true,
    exposedHeaders: ['X-Xclip-Request-Id', 'Retry-After'] });
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      const requestId = crypto.randomUUID();
      res.set('X-Xclip-Request-Id', requestId);
      log({ event: 'origin_rejected', requestId, status: 403 });
      return res.status(403).json({
        error: 'Akses browser dari domain ini tidak diizinkan. Panggil API Xclip melalui backend/server Anda, bukan frontend publik.',
        code: 'ORIGIN_NOT_ALLOWED', requestId,
      });
    }
    return allow(req, res, next);
  };
};
