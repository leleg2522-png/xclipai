const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json({ limit: '50mb' }));

const PROXY_SECRET = process.env.PROXY_SECRET;
const FREEPIK_API_KEY = process.env.FREEPIK_API_KEY;

app.use((req, res, next) => {
  if (req.headers['x-proxy-secret'] !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', ip: req.ip });
});

app.all('/proxy/freepik/*', async (req, res) => {
  try {
    const freepikPath = req.params[0];
    const freepikUrl = `https://api.freepik.com/${freepikPath}`;
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${freepikPath}`);
    
    const response = await axios({
      method: req.method,
      url: freepikUrl,
      headers: {
        'x-freepik-api-key': FREEPIK_API_KEY,
        'Content-Type': 'application/json'
      },
      data: req.method !== 'GET' ? req.body : undefined,
      timeout: 120000
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`[ERROR] ${error.response?.status}: ${JSON.stringify(error.response?.data || error.message)}`);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || { message: error.message }
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy running on port ${PORT}`);
  console.log(`Freepik API Key: ${FREEPIK_API_KEY ? 'SET' : 'NOT SET'}`);
});
