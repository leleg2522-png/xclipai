#!/bin/bash

echo "========================================"
echo "   XCLIP PROXY - AUTO INSTALLER"
echo "========================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "ERROR: Jalankan dengan sudo!"
  echo "Ketik: sudo bash install.sh"
  exit 1
fi

# Generate random secret
PROXY_SECRET=$(openssl rand -hex 32)
echo "Generated Secret: $PROXY_SECRET"
echo ""
echo ">>> SIMPAN SECRET INI! Kamu butuh untuk setting di Xclip <<<"
echo ""

# Install Node.js
echo "[1/5] Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
apt-get install -y nodejs > /dev/null 2>&1
echo "      Node.js installed: $(node -v)"

# Create directory
echo "[2/5] Creating directory..."
mkdir -p /opt/xclip-proxy
cd /opt/xclip-proxy

# Create server.js
echo "[3/5] Creating proxy server..."
cat > /opt/xclip-proxy/server.js << 'SERVEREOF'
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.PROXY_SECRET) {
  console.error('ERROR: PROXY_SECRET environment variable is required!');
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
  console.log('Xclip proxy running on port ' + PORT);
});
SERVEREOF

# Create package.json
cat > /opt/xclip-proxy/package.json << 'PKGEOF'
{
  "name": "xclip-droplet-proxy",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "express": "^4.18.2"
  }
}
PKGEOF

# Install dependencies
echo "[4/5] Installing dependencies..."
cd /opt/xclip-proxy
npm install > /dev/null 2>&1

# Create systemd service
echo "[5/5] Creating auto-start service..."
cat > /etc/systemd/system/xclip-proxy.service << SERVICEEOF
[Unit]
Description=Xclip Proxy Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/xclip-proxy
Environment=PORT=3000
Environment=PROXY_SECRET=$PROXY_SECRET
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICEEOF

# Enable and start service
systemctl daemon-reload
systemctl enable xclip-proxy > /dev/null 2>&1
systemctl start xclip-proxy

# Open firewall
ufw allow 3000 > /dev/null 2>&1

# Get IP
MYIP=$(curl -s ifconfig.me)

echo ""
echo "========================================"
echo "   INSTALASI SELESAI!"
echo "========================================"
echo ""
echo "IP Droplet  : $MYIP"
echo "Port        : 3000"
echo "Secret      : $PROXY_SECRET"
echo ""
echo "Simpan info di atas untuk setting Xclip!"
echo ""
echo "Test: curl http://$MYIP:3000/health"
echo "========================================"
