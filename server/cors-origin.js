const trustedDomains = [
  'railway.app', 'up.railway.app', 'replit.dev', 'replit.app', 'replit.co',
  'render.com', 'onrender.com', 'vercel.app', 'netlify.app', 'fly.dev',
];

module.exports = function isAllowedOrigin(origin, {
  allowedOrigins = [], production = process.env.NODE_ENV === 'production',
} = {}) {
  // The workspace preview parent is trusted only in development.
  if (!production && origin === 'https://replit.com') return true;
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return false;
    const hostname = url.hostname;
    if (['localhost', '0.0.0.0', '127.0.0.1'].includes(hostname)) return true;
    if (trustedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) return true;
    return allowedOrigins.some(allowed => {
      if (allowed.includes('://')) return origin === allowed;
      return hostname === allowed || hostname.endsWith(`.${allowed}`);
    });
  } catch {
    return false;
  }
};
