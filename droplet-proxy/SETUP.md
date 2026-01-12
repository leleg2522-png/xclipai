# Setup Droplet Proxy untuk Xclip

Panduan setup proxy server di DigitalOcean untuk menghindari banned dari Freepik.

## Arsitektur

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Railway   │────▶│ Droplet Room 1  │────▶│  Freepik    │
│   (Xclip)   │     │  IP: xxx.1      │     │    API      │
└─────────────┘     └─────────────────┘     └─────────────┘
       │            ┌─────────────────┐            ▲
       │───────────▶│ Droplet Room 2  │────────────┤
       │            │  IP: xxx.2      │            │
       │            └─────────────────┘            │
       │            ┌─────────────────┐            │
       └───────────▶│ Droplet Room 3  │────────────┘
                    │  IP: xxx.3      │
                    └─────────────────┘
```

## Langkah Setup per Droplet

### 1. Buat Droplet di DigitalOcean

1. Login ke DigitalOcean
2. Create Droplet:
   - **Image:** Ubuntu 22.04 LTS
   - **Size:** Basic $4/bulan (1GB RAM cukup)
   - **Region:** Singapore (terdekat ke Freepik)
   - **Authentication:** SSH Key (recommended)

3. Catat IP address droplet

### 2. Setup Server di Droplet

SSH ke droplet:
```bash
ssh root@YOUR_DROPLET_IP
```

Install Node.js:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs
```

Buat folder dan file:
```bash
mkdir -p /opt/xclip-proxy
cd /opt/xclip-proxy
```

Upload file `server.js` dan `package.json` dari folder `droplet-proxy/` ke `/opt/xclip-proxy/`

Atau copy-paste langsung:
```bash
nano server.js
# Paste isi file droplet-proxy/server.js

nano package.json
# Paste isi file droplet-proxy/package.json
```

Install dependencies:
```bash
npm install
```

### 3. Generate Secret Key

Di droplet, jalankan:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Simpan output ini - ini adalah PROXY_SECRET untuk room.

### 4. Setup Systemd Service

```bash
nano /etc/systemd/system/xclip-proxy.service
```

Isi dengan:
```ini
[Unit]
Description=Xclip Proxy Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/xclip-proxy
Environment=PORT=3000
Environment=PROXY_SECRET=YOUR_GENERATED_SECRET_HERE
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Ganti `YOUR_GENERATED_SECRET_HERE` dengan secret yang digenerate di langkah 3.

Aktifkan service:
```bash
systemctl daemon-reload
systemctl enable xclip-proxy
systemctl start xclip-proxy
systemctl status xclip-proxy
```

### 5. Setup Firewall

Buka port 3000 hanya untuk IP Railway:
```bash
ufw allow ssh
ufw allow from YOUR_RAILWAY_IP to any port 3000
ufw enable
```

Atau jika Railway IP dinamis, buka untuk semua (kurang aman):
```bash
ufw allow 3000
```

### 6. Test Koneksi

Dari komputer lokal:
```bash
curl http://YOUR_DROPLET_IP:3000/health
```

Harus return: `{"status":"ok","timestamp":...}`

### 7. Konfigurasi di Xclip

Jalankan SQL ini di database Xclip:
```sql
UPDATE rooms 
SET 
  droplet_ip = 'YOUR_DROPLET_IP',
  droplet_port = 3000,
  proxy_secret = 'YOUR_GENERATED_SECRET',
  use_proxy = true
WHERE id = 1;  -- Ganti dengan room ID
```

Ulangi untuk setiap room dengan droplet berbeda.

## Monitoring

Cek log di droplet:
```bash
journalctl -u xclip-proxy -f
```

Restart service:
```bash
systemctl restart xclip-proxy
```

## Biaya Estimasi

- 3 Droplet x $4/bulan = **$12/bulan**
- Bandwidth: $0.01/GB setelah 500GB gratis

## Troubleshooting

### Connection Refused
- Cek firewall: `ufw status`
- Cek service: `systemctl status xclip-proxy`

### Timeout
- Cek apakah Freepik API bisa diakses dari droplet
- Test: `curl https://api.freepik.com` dari droplet

### 401 Unauthorized
- Pastikan PROXY_SECRET sama persis di droplet dan database
