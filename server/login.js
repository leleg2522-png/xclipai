const bcrypt = require('bcryptjs');

// Reuse existing users and password hashes; login never creates or changes an account.
module.exports = function loginHandler(pool, compare = bcrypt.compare) {
  return async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' ||
        !email.trim() || email.length > 254 || !password || password.length > 128) {
      return res.status(400).json({ error: 'Email dan password diperlukan.' });
    }
    let renewedSession = false;
    try {
      const { rows } = await pool.query(
        `SELECT id, username, email, password_hash,
                (freepik_api_key IS NOT NULL AND freepik_api_key <> '') AS has_api_key
         FROM users WHERE LOWER(BTRIM(email)) = $1 LIMIT 2`,
        [email.trim().toLowerCase()]
      );
      // Do not guess which account to use if legacy emails differ only by case.
      if (rows.length !== 1 || typeof rows[0].password_hash !== 'string' ||
          !rows[0].password_hash || !await compare(password, rows[0].password_hash)) {
        return res.status(401).json({ error: 'Email atau password salah' });
      }
      const user = rows[0];
      await new Promise((resolve, reject) => {
        req.session.regenerate(error => error ? reject(error) : resolve());
      });
      renewedSession = true;
      req.session.userId = user.id;
      await new Promise((resolve, reject) => {
        req.session.save(error => error ? reject(error) : resolve());
      });
      res.json({ success: true, user: {
        id: user.id, username: user.username, email: user.email, hasApiKey: !!user.has_api_key,
      } });
    } catch (error) {
      if (renewedSession && req.session) delete req.session.userId;
      console.error('Login failed:', error.code || error.name);
      res.status(503).json({ error: 'Login sementara tidak tersedia. Silakan coba lagi.' });
    }
  };
};
