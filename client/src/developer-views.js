import { icons } from './developer-icons.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const e = escapeHtml;
const i = name => icons[name] || '';
const mark = '<span class="xp-mark"><span></span><span></span><span></span></span>';
const brand = `<a class="xp-brand" href="/">${mark}<span class="xp-brand-name">xclip<span> / developers</span></span></a>`;
const date = value => value ? new Date(value).toLocaleString('id-ID') : '—';
const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value));

export function authView(s) {
  const registering = s.authMode === 'register';
  return `<div class="xp-portal xp-auth-screen">
    <header class="xp-topbar xp-auth-topbar">${brand}<span class="xp-auth-topnote">${i('LockKeyhole')} RUANG DEVELOPER XCLIP</span></header>
    <main class="xp-auth-main" id="login">
      <section class="xp-auth-story">
        <div class="xp-auth-kicker"><span></span> PORTAL DEVELOPER</div>
        <h1>${registering ? 'API video,<br><em>dimulai dari sini.</em>' : 'Selamat<br><em>datang kembali.</em>'}</h1>
        <p>${registering ? 'Daftarkan akun developer terlebih dahulu, lalu masuk untuk mengelola API key, membaca quickstart, dan memeriksa akses.' : 'Masuk dengan akun Xclip Anda untuk membuka menu developer dan mengelola integrasi.'}</p>
        <div class="xp-auth-promise"><span class="xp-auth-promise-icon">${i('ShieldCheck')}</span><span><strong>Akses terpusat</strong><small>Satu akun untuk mengakses layanan API Xclip.</small></span></div>
      </section>
      <section class="xp-login-card" aria-labelledby="auth-title">
        <div class="xp-login-icon">${i(registering ? 'UserPlus' : 'KeyRound')}</div>
        <span class="xp-login-kicker">${registering ? 'AKUN DEVELOPER BARU' : 'AKUN XCLIP'}</span>
        <h2 id="auth-title">${registering ? 'Daftar developer' : 'Masuk ke portal'}</h2>
        <p class="xp-login-intro">${registering ? 'Buat akun, lalu login sebelum membuka menu API.' : 'Sudah pernah daftar? Masuk dengan email dan password akun Xclip lama Anda—tidak perlu daftar ulang.'}</p>
        <form id="auth-form" class="xp-login-form">
          ${registering ? `<label for="auth-username">Username developer</label><div class="xp-login-input-wrap">${i('User')}<input id="auth-username" name="username" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" autocomplete="username" placeholder="developer_xclip" value="${e(s.authDraft.username)}"></div>` : ''}
          <label class="xp-auth-secondary-label" for="auth-email">Email</label><div class="xp-login-input-wrap">${i('Mail')}<input id="auth-email" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="nama@perusahaan.com" value="${e(s.authDraft.email)}"></div>
          <div class="xp-password-label-row"><label for="auth-password">Kata sandi</label><span>${registering ? 'Minimal 6 karakter' : 'Password akun Anda'}</span></div>
          <div class="xp-login-input-wrap">${i('LockKeyhole')}<input id="auth-password" name="password" type="password" required minlength="${registering ? '6' : '1'}" maxlength="128" autocomplete="${registering ? 'new-password' : 'current-password'}"><button class="xp-password-toggle" type="button" data-action="toggle-password" aria-label="Tampilkan kata sandi">${i('Eye')}</button></div>
          ${registering ? `<label class="xp-confirm-label" for="auth-confirm">Konfirmasi kata sandi</label><div class="xp-login-input-wrap">${i('LockKeyhole')}<input id="auth-confirm" name="confirm" type="password" required minlength="6" maxlength="128" autocomplete="new-password"></div>` : ''}
          ${s.error ? `<div class="xp-login-error" role="alert">${i('CircleHelp')}${e(s.error)}</div>` : ''}
          ${s.notice ? `<div class="xp-login-notice" role="status">${i('Check')}${e(s.notice)}</div>` : ''}
          <button class="xp-login-submit" type="submit">${registering ? 'Daftar developer' : 'Masuk ke portal'} ${i(registering ? 'UserPlus' : 'LogIn')}</button>
        </form>
        <div class="xp-login-foot">${i('LockKeyhole')}<span>Jangan bagikan kata sandi atau API key Anda. Akun tersimpan pada sistem Xclip.</span></div>
        <div class="xp-auth-switch"><span>${registering ? 'Sudah punya akun?' : 'Developer baru?'}</span><button data-action="switch-auth">${registering ? 'Masuk' : 'Daftar dulu'}</button></div>
      </section>
    </main>
    <footer class="xp-auth-footer"><a class="xp-footer-brand" href="/">${mark} xclip</a><span>PORTAL DEVELOPER</span></footer>
  </div>`;
}

const modelSpecs = {
  'wan-3.0': {
    name: 'Wan 3.0', price: 6500, duration: '30 detik (tetap)',
    resolution: '720p (tetap)', requestResolution: '720p', ratios: '16:9 atau 9:16', defaultRatio: '16:9',
    audio: 'Boolean, default true',
  },
  'seedance-2.5': {
    name: 'Seedance 2.5', price: 11000, duration: '30 detik (tetap)',
    resolution: '1080p (upscale)', requestResolution: '1080p', upscaled: true, ratios: '16:9 atau 9:16', defaultRatio: '16:9',
    audio: 'Boolean, default true',
  },
  'seedance-2.0': {
    name: 'Seedance 2.0', price: 5000, duration: '15 detik (tetap)',
    requestDuration: 15, fixedDuration: true, resolution: '1080p (upscale)', requestResolution: '1080p', upscaled: true,
    ratios: '16:9 atau 9:16', defaultRatio: '16:9',
    audio: 'Boolean, default true',
  },
};
modelSpecs['wan-3.0'].requestDuration = 30;
modelSpecs['wan-3.0'].fixedDuration = true;
modelSpecs['seedance-2.5'].requestDuration = 30;
modelSpecs['seedance-2.5'].fixedDuration = true;
const modelSpec = (id, s) => {
  const spec = modelSpecs[id] || modelSpecs['wan-3.0'];
  const catalog = s.models?.find(model => model.id === id);
  return { ...spec, id, status: catalog?.status || 'unknown',
    price: Number.isSafeInteger(catalog?.pricePerVideo) ? catalog.pricePerVideo : spec.price };
};
const modelLabel = id => modelSpecs[id]?.name || id || 'Model video';
const selectedModelId = s => modelSpecs[s.docModelId] ? s.docModelId : 'wan-3.0';

const productionApiOrigin = 'https://web-production-0531a.up.railway.app';

export function apiBaseUrl(origin = productionApiOrigin) {
  return /^https?:\/\/[a-z0-9.[\]:-]+$/i.test(origin || '') ? origin : '';
}

export function apiEndpointUrl(tab = 'generate', origin) {
  const base = apiBaseUrl(origin);
  return `${base}${tab === 'download' ? '/api/videogen/proxy-video?taskId={taskId}'
    : tab === 'status' ? '/api/videogen/tasks/{taskId}' : '/api/videogen/proxy'}`;
}

export function requestBody(modelId = 'wan-3.0') {
  const id = modelSpecs[modelId] ? modelId : 'wan-3.0';
  return { model: id, prompt: 'Kamera bergerak perlahan melewati lanskap',
    resolution: modelSpecs[id].requestResolution, duration: modelSpecs[id].requestDuration,
    aspectRatio: '16:9', audio: true };
}

export function curlExample(tab, modelId = 'wan-3.0', origin) {
  const base = apiBaseUrl(origin);
  const setup = `${base ? `export XCLIP_BASE_URL='${base}'` : ': "${XCLIP_BASE_URL:?Isi alamat server Xclip terlebih dahulu}"'}
# Jalankan di Bash. Key dimasukkan di terminal, tidak ditampilkan.
if [ -z "\${XCLIP_API_KEY:-}" ]; then
  read -r -s -p "API key Xclip: " XCLIP_API_KEY
  printf '\\n'
  export XCLIP_API_KEY
fi
: "\${XCLIP_API_KEY:?API key Xclip wajib diisi}"
`;
  if (tab === 'status' || tab === 'download') {
    return `${setup}
if [ -z "\${XCLIP_TASK_ID:-}" ]; then
  read -r -p "taskId dari respons generate: " XCLIP_TASK_ID
  export XCLIP_TASK_ID
fi
: "\${XCLIP_TASK_ID:?taskId wajib diisi}"
${tab === 'download'
    ? 'curl --fail --silent --show-error "$XCLIP_BASE_URL/api/videogen/proxy-video?taskId=$XCLIP_TASK_ID" \\\n  -H "X-Xclip-Key: $XCLIP_API_KEY" \\\n  --output xclip-video.mp4'
    : 'curl --silent --show-error --include "$XCLIP_BASE_URL/api/videogen/tasks/$XCLIP_TASK_ID" \\\n  -H "X-Xclip-Key: $XCLIP_API_KEY"'}`;
  }
  return `${setup}
# Simpan ID ini. Untuk retry request yang sama, gunakan ID dan body yang sama.
XCLIP_REQUEST_ID="xclip-$(date +%s)-$RANDOM-$RANDOM"
printf 'Idempotency-Key: %s\\n' "$XCLIP_REQUEST_ID"
curl --silent --show-error --include -X POST "$XCLIP_BASE_URL/api/videogen/proxy" \\
  -H "X-Xclip-Key: $XCLIP_API_KEY" \\
  -H "Idempotency-Key: $XCLIP_REQUEST_ID" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(requestBody(modelId), null, 2)}'`;
}

function keyView(s) {
  if (!s.overview) return '<div class="xp-empty-key">Data key belum tersedia. <button class="xp-primary-button" data-action="refresh">Coba lagi</button></div>';
  const key = s.overview.keys.find(k => k.status === 'active');
  if (!key) {
    return `<div class="xp-empty-key"><div class="xp-empty-icon">${i('KeyRound')}</div><div class="xp-empty-copy"><strong>${s.overview.hasLifetimeKey ? 'API key telah dinonaktifkan' : 'Mulai dengan satu API key'}</strong><p>${s.overview.hasLifetimeKey ? 'Sesuai kebijakan Xclip, key pengganti tidak dapat dibuat.' : 'Buat satu kunci untuk menghubungkan aplikasi Anda.'}</p></div>${!s.overview.hasLifetimeKey ? `<form id="key-form" class="xp-create-control"><input class="xp-key-name-input" name="label" aria-label="Nama API key" required maxlength="80" value="Kunci integrasi"><button class="xp-primary-button" type="submit">${i('KeyRound')} Buat API key</button></form>` : ''}</div>`;
  }
  return `<div class="xp-key-top"><div class="xp-key-identity"><div class="xp-key-symbol">${i('KeyRound')}</div><div><div class="xp-key-label">${e(key.label)}</div><div class="xp-key-sub"><span class="xp-status-dot"></span> Aktif <i></i> Dibuat ${e(date(key.created_at))}</div></div></div><span class="xp-key-badge">${i('ShieldCheck')} KEY AKTIF</span></div>
    <div class="xp-key-value-row"><code>${e(s.keyVisible ? key.api_key : key.api_key.slice(0, 10) + '••••••••••••')}</code><button class="xp-icon-button" data-action="toggle-key" aria-label="${s.keyVisible ? 'Sembunyikan' : 'Tampilkan'} API key">${i(s.keyVisible ? 'EyeOff' : 'Eye')}</button><button class="xp-copy-button" data-action="copy-key">${i('Copy')} Salin key</button></div>
    <div class="xp-key-bottom"><p>${i('LockKeyhole')} Simpan key di server Anda, bukan kode sisi klien.</p><button class="xp-revoke-link" data-action="rename-key">Ubah nama</button><button class="xp-revoke-link" data-action="confirm-revoke">Nonaktifkan key</button></div>
    ${s.renaming ? `<form id="rename-form" class="xp-create-control" style="padding:20px"><input class="xp-key-name-input" name="label" required maxlength="80" value="${e(key.label)}" aria-label="Nama baru"><button class="xp-primary-button" type="submit">Simpan</button><button type="button" class="xp-copy-button" data-action="cancel-rename">Batal</button></form>` : ''}
    ${s.confirmRevoke ? `<div class="xp-confirm"><div><strong>Nonaktifkan API key ini?</strong><p>Permanen. Aplikasi yang memakai key ini akan kehilangan akses dan Anda tidak dapat membuat key pengganti.</p></div><div class="xp-confirm-actions"><button data-action="cancel-revoke">Batal</button><button class="xp-danger-button" data-action="revoke-key">Ya, nonaktifkan</button></div></div>` : ''}`;
}

function integrationReadinessView(s, model) {
  const activeKey = s.overview?.keys?.some(key => key.status === 'active');
  const balance = s.wallet && Number.isSafeInteger(s.wallet.balance) ? s.wallet.balance : null;
  const enough = balance !== null && balance >= model.price;
  return `<div class="xp-data-note" aria-label="Kesiapan integrasi">
    <strong>Cek sebelum generate · ${e(model.name)}</strong>
    <p>API key: ${!s.overview ? 'belum diperiksa' : activeKey ? 'aktif' : 'belum ada key aktif — buka menu API key'}.
    Saldo: ${s.walletError ? e(s.walletError) : balance === null ? 'belum dapat diperiksa' : enough ? `${money(balance)} — cukup untuk satu video` : `${money(balance)} — belum cukup; perlu ${money(model.price)} per video`}.
    Layanan: ${model.status === 'available' ? 'tersedia menurut katalog' : model.status === 'unavailable' ? 'sementara tidak tersedia' : 'belum dapat diperiksa'}.</p>
    ${balance !== null && !enough ? '<p><a href="#topup">Isi saldo API</a> sebelum mengirim request. API key aktif dan langganan lama bukan saldo API; saldo tidak diisi otomatis.</p>' : ''}
    <p>Katalog tersedia bukan jaminan generasi berhasil. Respons request tetap menjadi acuan; HTTP 202 baru berarti tugas diterima.</p>
  </div>`;
}

function docsView(s) {
  const generate = s.docTab === 'generate';
  const download = s.docTab === 'download';
  const modelId = selectedModelId(s);
  const model = modelSpec(modelId, s);
  const isFixedDuration = model.fixedDuration;
  const base = apiBaseUrl();
  const endpoint = apiEndpointUrl(s.docTab);
  const pageOrigin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
  const preview = /https?:\/\/(?:[^/]+\.replit\.dev|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)(?:$|\/)/i.test(pageOrigin);
  return `<section class="xp-docs-section" id="dokumentasi">
    <div class="xp-section-heading xp-doc-heading"><div><span class="xp-kicker">02 / QUICKSTART</span><h2>Request pertama Anda</h2></div><span class="xp-doc-meta">${i('BookOpen')} REST · JSON</span></div>
    ${integrationReadinessView(s, model)}
    <div class="xp-data-note"><strong>Integrasi wajib melalui backend/server Anda.</strong>
      <p>Alur: browser pengguna → backend Anda → API Xclip. Simpan API key di environment server. Jangan memakai fetch langsung dari frontend publik, memasukkan key ke JavaScript browser, atau membuka videoUrl tanpa autentikasi.</p>
      <p>Gunakan cURL di terminal server atau Postman untuk mencoba contoh ini. Membuka Base URL di browser hanya membuka portal, bukan menjalankan generasi. Jika browser menampilkan Failed to fetch/CORS, pindahkan request ke backend Anda; jangan membagikan API key atau memakai proxy publik.</p>
    </div>
    <div class="xp-data-note xp-api-address">
      <strong>Base URL — alamat server API Xclip</strong>
      <div class="xp-api-address-row"><code>${e(base || 'Buka docs melalui alamat server Xclip.')}</code>${base ? '<button type="button" class="xp-copy-inline" data-action="copy-base-url">Salin Base URL</button>' : ''}</div>
      <p>Base URL bukan API key dan tidak diakhiri <code>/api</code>. Untuk Postman, salin <strong>URL endpoint lengkap</strong> di bawah langsung ke kolom URL. Tidak perlu mengetik variabel <code>XCLIP_BASE_URL</code> atau menambahkan <code>/api</code> lagi.</p>
      ${preview ? '<p><strong>Anda sedang membuka Preview.</strong> Base URL dan seluruh contoh request tetap mengarah ke API production di Railway, bukan backend Preview. Perubahan backend di Preview baru tersedia di Railway setelah deploy.</p>' : '<p>Gunakan Base URL Railway yang sama untuk generate, cek status, dan unduh video.</p>'}
      <strong>URL endpoint lengkap · ${generate ? 'POST' : 'GET'}</strong>
      <div class="xp-api-address-row"><code>${e(endpoint)}</code>${base ? '<button type="button" class="xp-copy-inline" data-action="copy-endpoint-url">Salin URL endpoint</button>' : ''}</div>
      ${!generate ? '<p>Ganti <code>{taskId}</code> dengan taskId dari respons generate, tanpa tanda kurung kurawal.</p>' : ''}
    </div>
    <div class="xp-doc-layout"><aside class="xp-doc-nav"><span class="xp-nav-caption">ENDPOINT</span><button data-action="doc-generate" class="xp-endpoint-button ${generate ? 'active' : ''}"><span class="xp-method post">POST</span> Generate video</button><button data-action="doc-status" class="xp-endpoint-button ${!generate && !download ? 'active' : ''}"><span class="xp-method get">GET</span> Status tugas</button><button data-action="doc-download" class="xp-endpoint-button ${download ? 'active' : ''}"><span class="xp-method get">GET</span> Unduh video</button><div class="xp-doc-nav-note">${i('LockKeyhole')}<span>Semua endpoint memakai header <code>X-Xclip-Key</code>. Gunakan dari server Anda, bukan frontend publik.</span></div></aside>
    <div class="xp-endpoint"><div class="xp-endpoint-head"><span class="xp-method ${generate ? 'post' : 'get'}">${generate ? 'POST' : 'GET'}</span><code>${generate ? '/api/videogen/proxy' : download ? '/api/videogen/proxy-video?taskId=…' : '/api/videogen/tasks/:taskId'}</code><button class="xp-copy-inline" data-action="copy-curl">${i('Copy')} Salin cURL</button></div>
     <p class="xp-endpoint-desc">${generate ? `${e(model.name)} (${e(model.id)}): kirim prompt untuk text-to-video. Tambahkan image berupa data URI untuk image-to-video. Simpan taskId dari respons untuk mengecek status.` : download ? 'Jalankan hanya setelah status completed. File disimpan sebagai xclip-video.mp4. Link hasil membutuhkan header API key; bukan link publik untuk dibuka langsung.' : 'Gunakan taskId hasil generasi. Hanya task milik akun/key Anda yang dapat diakses. Ulangi pengecekan setiap 10–20 detik sampai completed atau failed; jangan generate ulang saat menunggu.'}</p>
     ${generate && model.upscaled ? '<div class="xp-data-note"><strong>Output 1080p melalui upscale.</strong> Video diproses dalam dua tahap: generasi, lalu peningkatan resolusi. Status tetap processing dan videoUrl belum tersedia sampai hasil 1080p terverifikasi. Pantau stage generating atau upscaling. Jika tahap akhir gagal, task gagal dan reservasi saldo dikembalikan; video resolusi rendah tidak dikirim sebagai hasil akhir. Request yang dibuat sebelum perubahan ini tetap memakai kontrak resolusi lamanya dan tidak otomatis ditingkatkan.</div>' : ''}
    <div class="xp-data-note"><strong>Persiapan:</strong> daftar/masuk, buat API key aktif di menu key, dan isi saldo sebelum generate. Gunakan akun, API key, dan saldo yang tersedia pada layanan Railway tujuan. Gunakan Bash dengan cURL (Windows: Git Bash atau WSL). Alamat API selalu memakai Railway dan sudah diisi dalam contoh, termasuk saat docs dibuka dari Preview. Masukkan API key saat terminal meminta; key tidak disisipkan otomatis atau ditampilkan. <code>videoUrl</code> adalah path relatif ke Base URL Railway di atas.</div>
    ${generate ? `<div class="xp-data-note"><strong>Postman:</strong> gunakan method <code>POST</code> ke <code>${e(endpoint)}</code>. Headers: <code>Content-Type: application/json</code>, <code>X-Xclip-Key: API key Anda</code>, <code>Idempotency-Key: wan-test-001</code> (contoh ID valid; ganti untuk video baru, pertahankan untuk retry body yang sama). Body → raw → JSON. <button class="xp-copy-inline" data-action="copy-json">Salin body JSON</button><pre><code>${e(JSON.stringify(requestBody(modelId), null, 2))}</code></pre></div>` : ''}
     ${generate ? `<div class="xp-model-choice" role="group" aria-label="Pilih model untuk dokumentasi"><span class="xp-nav-caption">MODEL UNTUK CONTOH REQUEST</span>${Object.keys(modelSpecs).map(id => {
       const item = modelSpec(id, s);
       return `<button type="button" data-action="doc-model" data-model-id="${e(id)}" class="${id === modelId ? 'active' : ''}" aria-pressed="${id === modelId}"><span>${e(item.name)}</span><code>${e(id)}</code><strong>${money(item.price)} / video</strong></button>`;
     }).join('')}</div>
      <div class="xp-parameter-box"><div class="xp-param-title"><span>BODY · APPLICATION/JSON</span><button data-action="toggle-payload">${s.showPayload ? 'Sembunyikan' : 'Tampilkan'} ${i('ChevronDown')}</button></div>${s.showPayload ? `<div class="xp-param-grid"><div><code>model</code><span>string</span><p>${e(model.id)}</p></div><div><code>image</code><span>string · opsional</span><p>Data URI PNG, JPEG, atau WebP untuk image-to-video.</p></div><div><code>prompt</code><span>string · wajib</span><p>Deskripsi video, maksimal 10000 karakter.</p></div><div><code>duration</code><span>number</span><p>${e(model.duration)}${isFixedDuration ? '; durasi lain ditolak dengan HTTP 400' : ''}.</p></div><div><code>resolution</code><span>string</span><p>${e(model.resolution)}.</p></div><div><code>aspectRatio</code><span>string</span><p>${e(model.ratios)}; default ${e(model.defaultRatio)}.${modelId === 'seedance-2.5' ? ' Rasio divalidasi oleh quote sebelum generasi berbayar.' : ''}</p></div><div><code>audio</code><span>boolean</span><p>${e(model.audio)}.</p></div></div>` : ''}</div>` : ''}
     <div class="xp-code-window"><div class="xp-code-title"><span>${i('Terminal')} CONTOH cURL</span><span class="xp-lang-tag">SHELL</span></div><pre><code>${e(curlExample(s.docTab, modelId))}</code></pre><div class="xp-code-foot"><span>${i('ShieldCheck')} Key tidak disertakan otomatis di contoh ini.</span><button data-action="copy-curl">Salin cURL</button></div></div>
      <div class="xp-data-note"><strong>Request:</strong> ${generate ? `Biaya ${money(model.price)} per video. ${isFixedDuration ? `Durasi hanya ${model.requestDuration} detik; durasi lain ditolak dengan HTTP 400.` : 'Durasi 2–30 detik.'} Model ini memakai saldo API, termasuk untuk akun dengan langganan lama. Saldo dicadangkan sebelum generasi. Contoh membuat Idempotency-Key valid dan mencetaknya untuk disimpan. Retry hanya perintah curl dengan ID dan body yang sama, bukan seluruh blok pembuat ID. Jeda request baru 180 detik. HTTP 202 berarti tugas diterima, bukan video sudah selesai. Simpan taskId dari respons, lalu buka Status tugas. Pending dengan notice pengiriman belum terkonfirmasi: jangan membuat request baru.` : download ? 'HTTP 200 berisi video, bukan JSON. Cek status dan unduh hasil tidak dikenakan biaya generasi tambahan. Untuk video berikutnya, ganti XCLIP_TASK_ID ke taskId baru. Key tidak valid menghasilkan 401; task yang tidak dapat diakses 404.' : 'Status: pending, processing, completed, atau failed. HTTP 200 dapat berarti pending atau processing, bukan berarti generasi selesai. Saat completed, videoUrl terisi dan Anda dapat membuka tab Unduh video. Saat failed, periksa error dan jangan unduh. Untuk task baru, ganti XCLIP_TASK_ID. Jika pending disertai notice, simpan taskId dan jangan membuat generasi baru.'}</div>
      <div class="xp-data-note"><strong>Jika gagal:</strong> <code>400</code> body/model/resolusi/Idempotency-Key tidak sesuai; <code>401</code> key tidak valid/nonaktif; <code>402</code> saldo kurang; <code>409</code> ID request dipakai dengan body berbeda; <code>429</code> cooldown/kuota; <code>503</code> layanan belum siap, bukan tanda generasi berhasil. Simpan header <code>X-Xclip-Request-Id</code> jika tersedia. Jangan membuat ID request baru untuk mengatasi timeout. Versi Preview dan Railway dapat berbeda sebelum deploy; contoh ini menargetkan Railway. Pastikan perubahan backend sudah di-deploy ke Railway sebelum memakai konfigurasi baru.</div>
      <div class="xp-data-note"><strong>Membaca error dan kendala status:</strong>
        <p><code>401 AUTH_REQUIRED</code>: gunakan header <code>X-Xclip-Key</code>, bukan hanya Authorization: Bearer.
        <code>402 INSUFFICIENT_BALANCE</code>: isi saldo API.
        <code>403 ORIGIN_NOT_ALLOWED</code>: domain browser ditolak; panggil dari backend/server Anda.
        <code>400 INVALID_REQUEST</code>: periksa body dan header Idempotency-Key.
        <code>503 SERVICE_UNAVAILABLE</code>: layanan perlu diperiksa; jangan menganggap video sudah dibuat.</p>
        <p>Respons error memuat <code>error</code>, <code>code</code>, dan <code>requestId</code>. Kirim requestId, kode HTTP, endpoint, dan waktu kejadian ke dukungan; jangan kirim API key.</p>
        <p>Jika cek status mengembalikan <code>statusCheck.state: unavailable</code>, HTTP 200 hanya menampilkan status terakhir yang tersimpan, bukan konfirmasi bahwa proses masih berjalan. Baca <code>notice</code>, simpan taskId dan requestId, lalu cek ulang setelah 30 detik. Jangan generate ulang. Jika lebih dari 30 menit, minta pemeriksaan; saldo tidak otomatis dikembalikan tanpa konfirmasi kegagalan.</p>
      </div>
    <div class="xp-data-note"><strong>Layanan Xclip:</strong> Seluruh proses generasi dan hasil video diakses melalui API Xclip. Aplikasi Anda hanya membutuhkan API key Xclip.</div></div></div></section>`;
}

export function modelsView(s) {
  const ids = ['wan-3.0', 'seedance-2.5', 'seedance-2.0'];
  return `<section class="xp-model-section" id="model" aria-labelledby="model-heading">
    <div class="xp-section-heading"><div><span class="xp-kicker">KATALOG / VIDEO</span><h2 id="model-heading">Model video</h2></div></div>
    <div class="xp-model-catalog">${ids.map(id => {
      const model = modelSpec(id, s);
      const statusLabel = model.status === 'available' ? 'Tersedia'
        : model.status === 'unavailable' ? 'Belum tersedia' : 'Belum terkonfirmasi';
      const config = model.fixedDuration
        ? `Text-to-video dan image-to-video · ${model.resolution.replace(' (tetap', '').replace(')', '')} · ${model.requestDuration} detik tetap · rasio ${model.ratios}${id === 'seedance-2.5' ? ' · rasio divalidasi saat quote sebelum generasi berbayar' : ''} · audio default aktif.`
        : 'Text-to-video dan image-to-video · 480p · 2–30 detik · rasio 16:9, 9:16, 1:1, 4:3, atau 3:4.';
      return `<article class="xp-model-card"><div class="xp-model-title"><div><span class="xp-model-category">VIDEO</span><h3>${e(model.name)}</h3></div><span class="xp-model-status">${statusLabel}</span></div><p>${e(config)}</p><div class="xp-model-meta"><code>${e(id)}</code><strong>${money(model.price)} <span>/ video</span></strong></div></article>`;
    }).join('')}</div>
    ${s.modelError ? `<p class="xp-model-error" role="status">${e(s.modelError)} Katalog tetap menampilkan konfigurasi dan harga yang tersedia.</p>` : ''}
  </section>`;
}

export function paymentButtonState(s) {
  if (s.paymentCreating) return { disabled: true, busy: true, label: 'Sedang membuat QRIS…',
    reason: 'Menunggu respons pembayaran. Jangan klik ulang; jika respons terputus, tagihan akan diperiksa terlebih dahulu.' };
  if (s.paymentLoading) return { disabled: true, busy: true, label: 'Memeriksa pembayaran…',
    reason: 'Sedang memeriksa saldo dan tagihan aktif.' };
  if (s.checkout && ['creating', 'pending', 'uncertain'].includes(s.checkout.status)) {
    return { disabled: true, busy: false,
      label: s.checkout.status === 'uncertain' ? 'Tagihan perlu diperiksa' : 'Masih ada tagihan aktif',
      reason: 'Periksa tagihan di bawah sebelum membuat pembayaran baru. Tidak ada pembuatan QRIS baru yang sedang berjalan.' };
  }
  if (s.checkoutError || !s.paymentConfig?.available) return {
    disabled: true, busy: false, label: 'Pembayaran belum siap',
    reason: s.checkoutError || 'Konfigurasi pembayaran belum tersedia. Tekan Perbarui pembayaran untuk memeriksa ulang.',
  };
  if (!s.wallet || s.walletError) return { disabled: true, busy: false, label: 'Saldo belum dapat diperiksa',
    reason: s.walletError || 'Data saldo belum tersedia. Perbarui data sebelum membuat pembayaran.' };
  if (s.paymentBusy) return { disabled: true, busy: true, label: 'Memproses pembayaran…',
    reason: 'Tunggu sampai proses pembayaran ini selesai.' };
  return { disabled: false, busy: false, label: 'Buat QRIS pembayaran', reason: '' };
}

function topupView(s) {
  // Closed subscription invoices belong in history, not the wallet checkout.
  // Keep open legacy invoices visible so users cannot accidentally pay twice.
  const invoice = s.checkout?.billing_type === 'subscription'
    && ['paid', 'expired', 'failed'].includes(s.checkout.status) ? null : s.checkout;
  const paymentLabel = row => row.billing_type === 'wallet' ? 'Top up saldo API' : 'Pembayaran lama';
  const button = paymentButtonState(s);
  const expires = invoice?.expires_at ? new Date(invoice.expires_at).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short',
  }) : '';
  return `<section class="xp-topup-section" id="topup"><div class="xp-section-heading"><div><span class="xp-kicker">04 / TOP UP</span><h2>Top up saldo API</h2></div>${i('Wallet')}</div>
     <div class="xp-topup-card"><div class="xp-topup-main"><div class="xp-topup-icon">${i('Wallet')}</div><div><span class="xp-access-label">KLIKQRIS · VERIFIKASI OTOMATIS</span><h3>Isi saldo, tanpa masa aktif</h3><p>Saldo API tidak kedaluwarsa dan terpisah dari saldo bot. Harga per video berbeda menurut model; lihat katalog model untuk rincian harga dan konfigurasi. Saldo ditambahkan setelah pembayaran diverifikasi server.</p></div></div></div>
    ${s.paymentConfig?.sandbox ? '<div class="xp-data-note" role="status"><strong>Mode sandbox.</strong> Ini simulasi, bukan pembayaran nyata. Saldo nyata tidak ditambahkan.</div>' : ''}
    <button type="button" class="xp-copy-button" data-action="payment-refresh" ${s.paymentBusy || s.paymentLoading ? 'disabled' : ''}>Perbarui pembayaran</button>
    ${s.paymentNotice ? `<div class="xp-data-note" role="status">${e(s.paymentNotice)}</div>` : ''}
    ${s.paymentStatusError ? `<div class="xp-data-note" role="alert">${e(s.paymentStatusError)}</div>` : ''}
    ${s.walletError ? `<div class="xp-data-note" role="alert">${e(s.walletError)}</div>` : ''}
    ${s.checkoutError ? `<div class="xp-data-note" role="alert">${e(s.checkoutError)}</div>` : ''}
    ${s.wallet ? `<form id="payment-form" class="xp-payment-form xp-key-card"><label for="payment-amount">Nominal top up (Rp)</label><input type="number" id="payment-amount" name="amount" min="${e(s.wallet.minimumTopup)}" max="${e(s.wallet.maximumTopup)}" step="1" value="${e(s.topupAmount)}" required>
    <p>Minimum ${money(s.wallet.minimumTopup)}. Saldo bertambah sesuai nominal top up; kode unik/biaya gateway tidak menjadi saldo. Bayar <strong>nominal akhir pada tagihan QRIS</strong>.</p>
    <button type="submit" aria-busy="${button.busy}" aria-describedby="payment-button-status" ${button.disabled ? 'disabled' : ''}>${e(button.label)}</button>
    <p id="payment-button-status" role="status" ${button.reason ? '' : 'hidden'}>${e(button.reason)}</p>
    </form>` : ''}
    ${invoice ? `<div class="xp-payment-form xp-key-card" aria-label="Tagihan KlikQRIS"><strong>${paymentLabel(invoice)}</strong><p>ID tagihan: <code>${e(invoice.id)}</code></p>
      ${invoice.billing_type === 'subscription' ? '<p role="note"><strong>Tagihan langganan lama, bukan top up saldo API.</strong> Tagihan ini dibuat sebelum perubahan sistem dan tidak menambah saldo API. Jika masih aktif, tunggu pembayaran terkonfirmasi atau tagihan kedaluwarsa sebelum membuat top up saldo baru.</p>' : ''}
      ${invoice.total_amount != null ? `<p>Nominal akhir: <strong>${money(invoice.total_amount)}</strong></p>` : ''}
      ${invoice.billing_type === 'wallet' ? `<p>Saldo yang ditambahkan: <strong>${money(invoice.amount)}</strong> · tanpa masa aktif.</p>` : ''}
      ${expires ? `<p>QRIS berlaku sampai ${e(expires)} WIB. Ini batas pembayaran, bukan masa aktif saldo.</p>` : ''}
      ${invoice.status === 'pending' ? `${invoice.qr_url ? `<img id="qris-image" class="xp-qris" src="${e(invoice.qr_url)}" alt="QRIS dinamis untuk tagihan ini"><p id="qris-error" hidden role="alert">QRIS belum dapat ditampilkan. Jangan membayar sebelum kode terlihat; periksa status tagihan atau hubungi admin.</p>` : '<p>QRIS belum tersedia. Jangan melakukan pembayaran.</p>'}<p>Status diperiksa otomatis setiap 15 detik. Setelah membayar, Anda juga bisa menekan tombol di bawah.</p>` : invoice.status === 'paid' ? `<p>${s.paymentConfig?.sandbox ? 'Simulasi telah dikonfirmasi; saldo nyata tidak diubah.' : invoice.billing_type === 'subscription' ? 'Pembayaran langganan lama dikonfirmasi.' : 'Pembayaran telah dikonfirmasi. Saldo API ditambahkan otomatis.'}</p>` : invoice.status === 'expired' ? '<p>Tagihan kedaluwarsa. Jangan scan QRIS lama; buat tagihan baru.</p>' : invoice.status === 'failed' ? '<p>Tagihan gagal dibuat. Periksa konfigurasi dengan admin sebelum mencoba lagi.</p>' : '<p>Pembuatan tagihan belum terkonfirmasi. Jangan membuat ulang atau membayar; periksa status dan hubungi admin bila tetap belum terkonfirmasi.</p>'}
      ${invoice.status !== 'paid' && invoice.status !== 'failed' ? `<button type="button" data-action="payment-check" aria-busy="${!!s.paymentChecking}" ${s.paymentBusy || s.paymentChecking ? 'disabled' : ''}>${s.paymentChecking ? 'Memeriksa status…' : 'Cek status pembayaran'}</button>` : ''}</div>` : ''}
    <div class="xp-data-note"><strong>Riwayat pembayaran</strong>${s.historyError ? `<p role="alert">${e(s.historyError)}</p>` : s.payments.length ? `<div style="overflow:auto"><table class="xp-history"><thead><tr><th>Jenis pembayaran</th><th>Nominal</th><th>Status</th><th>Tanggal</th></tr></thead><tbody>${s.payments.map(p => `<tr><td>${paymentLabel(p)}</td><td>${money(p.total_amount ?? p.amount)}</td><td>${e(({pending:p.provider === 'klikqris' ? 'Menunggu pembayaran' : 'Menunggu verifikasi lama',paid:'Lunas',approved:'Disetujui',expired:'Kedaluwarsa',creating:'Menyiapkan QRIS',uncertain:'Belum terkonfirmasi',failed:'Gagal',rejected:'Ditolak'})[p.status] || p.status)}</td><td>${e(date(p.created_at))}</td></tr>`).join('')}</tbody></table></div>` : '<p>Belum ada pembayaran.</p>'}</div></section>`;
}

const generationStatus = {
  pending: 'Menunggu',
  processing: 'Sedang diproses',
  completed: 'Selesai',
  failed: 'Gagal',
};
const generationDate = value => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short',
  }) + ' WIB';
};

function generationResultUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin || !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.pathname !== '/api/videogen/proxy-video' || !parsed.searchParams.get('taskId')) return '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '';
  }
}

export function generationHistoryContent(s) {
  const tasks = s.generationTasks || [];
  if (s.generationError) {
    return `<div class="xp-generation-state xp-generation-error" role="alert"><div><strong>Riwayat belum dapat dimuat</strong><p>${e(s.generationError)}</p></div><button class="xp-copy-button" data-action="generations-refresh" ${s.generationLoading ? 'disabled' : ''}>Coba lagi</button></div>`;
  }
  if (s.generationLoading && !tasks.length) {
    return `<div class="xp-generation-skeleton" aria-label="Memuat riwayat generasi"><span></span><span></span><span></span></div>`;
  }
  if (!tasks.length) {
    return `<div class="xp-generation-state"><div class="xp-generation-empty-mark">${i('Activity')}</div><div><strong>Belum ada tugas generasi</strong><p>Request yang dikirim melalui API Xclip akan muncul di sini.</p></div></div>`;
  }
  return `<div class="xp-generation-list">${tasks.map(task => {
    const status = generationStatus[task.status] || 'Status diperiksa';
    const resultUrl = task.status === 'completed' ? generationResultUrl(task.videoUrl) : '';
    return `<article class="xp-generation-row">
      <div class="xp-generation-status xp-generation-${e(generationStatus[task.status] ? task.status : 'pending')}"><span></span>${e(status)}</div>
        <div class="xp-generation-details"><div class="xp-generation-id-line"><code>${e(task.taskId || 'ID tidak tersedia')}</code><span>${e(modelLabel(task.model))}</span></div>
        <div class="xp-generation-times"><span>Dibuat ${e(generationDate(task.createdAt))}</span>${task.completedAt ? `<span>· Selesai ${e(generationDate(task.completedAt))}</span>` : ''}</div>
        ${task.status === 'failed' && task.error ? `<p class="xp-generation-message xp-generation-message-error">${e(task.error)}</p>` : ''}
        ${task.stage === 'upscaling' && task.status === 'processing' ? '<p class="xp-generation-message">Meningkatkan kualitas ke 1080p. Hasil tersedia setelah verifikasi selesai.</p>' : ''}
        ${task.notice ? `<p class="xp-generation-message">${e(task.notice)}</p>` : ''}
      </div>
      ${resultUrl ? `<a class="xp-generation-download" href="${e(resultUrl)}" download>${i('Download')} Unduh video</a>` : ''}
    </article>`;
  }).join('')}</div>
  ${s.generationHasMore ? `<div class="xp-generation-more-wrap"><button class="xp-copy-button" data-action="generations-more" ${s.generationLoading ? 'disabled' : ''}>${s.generationLoading ? 'Memuat…' : 'Muat tugas sebelumnya'}</button></div>` : ''}`;
}

export function portalView(s) {
  return `<div class="xp-portal"><header class="xp-topbar">${brand}<nav class="xp-top-links" aria-label="Navigasi utama"><a href="#kunci">API key</a><a href="#model">Model</a><a href="#generasi">Riwayat generasi</a><a href="#dokumentasi">Dokumentasi</a><a href="#akses">Saldo API</a><a href="#topup">Top up</a></nav><button class="xp-signout" data-action="logout">Keluar</button></header>
    <nav class="xp-mobile-menu" aria-label="Menu developer"><a href="#kunci">API key</a><a href="#model">Model</a><a href="#generasi">Riwayat generasi</a><a href="#dokumentasi">Dokumentasi</a><a href="#akses">Saldo API</a><a href="#topup">Top up</a></nav>
    ${s.error || s.notice ? `<div class="xp-alert" role="${s.error ? 'alert' : 'status'}">${e(s.error || s.notice)} <button data-action="dismiss" aria-label="Tutup pemberitahuan">×</button></div>` : ''}
    <main id="home" class="xp-main"><section class="xp-intro"><div class="xp-eyebrow"><span>PORTAL DEVELOPER</span><i></i> API VIDEO XCLIP</div><div class="xp-intro-row"><div><h1>Mulai bangun<br><em>dengan video AI.</em></h1><p class="xp-lede">Halo, ${e(s.user.username)}. Kelola integrasi Xclip melalui satu portal yang terhubung ke akun Anda.</p></div><div class="xp-intro-aside"><div class="xp-aside-icon">${i('Code2')}</div><span>DIRANCANG UNTUK INTEGRASI</span><p>Gunakan API key Xclip di server aplikasi Anda.</p><a href="#dokumentasi">Lihat quickstart ${i('ArrowDownRight')}</a></div></div><div class="xp-step-line"><span><b>01</b> Buat kunci</span><i></i><span><b>02</b> Kirim request</span><i></i><span><b>03</b> Cek status tugas</span></div></section>
    <section class="xp-overview" aria-label="Penggunaan API"><div class="xp-overview-title"><span class="xp-overview-icon">${i('Activity')}</span><span>AKTIVITAS PORTAL</span></div><div class="xp-overview-number">${s.overview ? Number(s.overview.totalRequests).toLocaleString('id-ID') : '—'}</div><div class="xp-overview-caption">total request API akun Anda</div><div class="xp-overview-foot"><button class="xp-copy-button" data-action="refresh">Perbarui data</button></div></section>
    <section class="xp-generation-section" id="generasi" aria-labelledby="generation-heading"><div class="xp-section-heading"><div><span class="xp-kicker">AKTIVITAS / VIDEO</span><h2 id="generation-heading">Riwayat generasi</h2></div><button class="xp-copy-button xp-generation-refresh" data-action="generations-refresh" ${s.generationLoading ? 'disabled' : ''}>${i('RefreshCw')} ${s.generationLoading ? 'Memperbarui…' : 'Perbarui riwayat'}</button></div>
      <div class="xp-generation-card"><div class="xp-generation-info"><span>${i('Clock3')} Status diperbarui otomatis setiap 10 detik.</span><span>Pending berarti request diterima dan belum selesai—bukan kegagalan.</span><span class="xp-generation-updated" id="generation-updated">${s.generationUpdatedAt ? `Terakhir diperbarui ${e(generationDate(s.generationUpdatedAt))}` : 'Belum diperbarui'}</span></div><div id="generation-history-content" aria-live="polite">${generationHistoryContent(s)}</div></div>
    </section>
    <section class="xp-key-section" id="kunci"><div class="xp-section-heading"><div><span class="xp-kicker">01 / KREDENSIAL</span><h2>API key Anda</h2></div><span class="xp-single-rule">${i('LockKeyhole')} Satu kunci seumur hidup</span></div><div class="xp-key-card">${keyView(s)}<div class="xp-key-footnote"><span>i</span> Maksimal satu API key per pengguna, termasuk setelah dinonaktifkan.</div></div></section>
    ${modelsView(s)}
    ${docsView(s)}
     <section class="xp-access-section" id="akses"><div class="xp-section-heading"><div><span class="xp-kicker">03 / SALDO</span><h2>Saldo API tanpa masa aktif</h2></div></div><div class="xp-access-card"><div class="xp-access-main"><div class="xp-access-icon">${i('Wallet')}</div><div><span class="xp-access-label">SALDO TERSEDIA</span><h3>${s.wallet ? money(s.wallet.balance) : 'Saldo belum tersedia'}</h3><p>${s.walletError ? e(s.walletError) : s.wallet ? `Dicadangkan untuk task: ${money(s.wallet.reserved)}. Harga per video mengikuti model yang dipilih; lihat katalog model.` : 'Perbarui data untuk melihat saldo.'}</p><p>Saldo dicadangkan saat generasi dimulai; kegagalan terkonfirmasi mengembalikan saldo. Request yang belum terkonfirmasi tetap dicadangkan untuk mencegah tagihan ganda.</p>${s.subscription?.hasSubscription ? '<p>Akses langganan lama tetap dihormati sampai berakhir. Top up baru menambah saldo, bukan memperpanjangnya.</p>' : ''}</div></div><div class="xp-access-divider"></div><div class="xp-access-side"><a href="#topup">Isi saldo API ${i('ArrowRight')}</a><p>Saldo terpisah dari saldo bot dan tidak kedaluwarsa.</p></div></div></section>
    ${topupView(s)}
    <footer class="xp-footer"><a class="xp-footer-brand" href="/">${mark} xclip</a><span>PORTAL DEVELOPER</span></footer></main></div>`;
}
