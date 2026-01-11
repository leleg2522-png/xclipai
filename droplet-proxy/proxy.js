const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json({ limit: '50mb' }));

const PROXY_SECRET = process.env.PROXY_SECRET || 'change-this-secret';

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.headers['x-proxy-secret'] !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.all('/proxy/freepik/*', async (req, res) => {
  try {
    const freepikPath = req.params[0];
    const freepikUrl = `https://api.freepik.com/${freepikPath}`;
    
    const apiKey = req.headers['x-freepik-api-key'];
    if (!apiKey) {
      return res.status(400).json({ error: 'Missing x-freepik-api-key header' });
    }
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${freepikPath}`);
    
    const response = await axios({
      method: req.method,
      url: freepikUrl,
      headers: {
        'x-freepik-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      data: req.method !== 'GET' ? req.body : undefined,
      timeout: 120000
    });
    
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    console.error(`[ERROR] ${status}: ${JSON.stringify(error.response?.data || error.message)}`);
    res.status(status).json({
      error: error.response?.data || { message: error.message }
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy running on port ${PORT}`);
});
