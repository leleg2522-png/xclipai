const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.PROXY_SECRET) {
  console.error('ERROR: PROXY_SECRET environment variable is required!');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
const PROXY_SECRET = process.env.PROXY_SECRET;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/proxy/freepik', async (req, res) => {
  const authHeader = req.headers['x-proxy-secret'];
  if (authHeader !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { url, method, headers, data } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const response = await axios({
      method: method || 'POST',
      url: url,
      headers: headers || {},
      data: data,
      timeout: 120000
    });

    res.json({
      status: response.status,
      data: response.data,
      headers: response.headers
    });
  } catch (error) {
    console.error('Proxy error:', error.message);
    
    if (error.response) {
      res.status(error.response.status).json({
        error: error.message,
        data: error.response.data
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Droplet proxy running on port ${PORT}`);
});
