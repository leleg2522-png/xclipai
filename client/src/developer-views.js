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
        <p class="xp-login-intro">${registering ? 'Buat akun, lalu login sebelum membuka menu API.' : 'Gunakan akun Xclip terdaftar untuk membuka portal.'}</p>
        <form id="auth-form" class="xp-login-form">
          ${registering ? `<label for="auth-username">Username developer</label><div class="xp-login-input-wrap">${i('User')}<input id="auth-username" name="username" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" autocomplete="username" placeholder="developer_xclip" value="${e(s.authDraft.username)}"></div>` : ''}
          <label class="xp-auth-secondary-label" for="auth-email">Email</label><div class="xp-login-input-wrap">${i('Mail')}<input id="auth-email" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="nama@perusahaan.com" value="${e(s.authDraft.email)}"></div>
          <div class="xp-password-label-row"><label for="auth-password">Kata sandi</label><span>Minimal 6 karakter</span></div>
          <div class="xp-login-input-wrap">${i('LockKeyhole')}<input id="auth-password" name="password" type="password" required minlength="6" maxlength="128" autocomplete="${registering ? 'new-password' : 'current-password'}"><button class="xp-password-toggle" type="button" data-action="toggle-password" aria-label="Tampilkan kata sandi">${i('Eye')}</button></div>
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

export function curlExample(tab) {
  return tab === 'status'
    ? 'curl "$XCLIP_BASE_URL/api/videogen/tasks/<taskId>" \\\n  -H "X-Xclip-Key: <API_KEY_ANDA>"'
    : `curl -X POST "$XCLIP_BASE_URL/api/videogen/proxy" \\
  -H "X-Xclip-Key: <API_KEY_ANDA>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kling-v2.6-pro",
    "image": "<gambar_base64_atau_data_uri>",
    "prompt": "Kamera bergerak perlahan melewati lanskap",
    "duration": 5,
    "aspectRatio": "16:9"
  }'`;
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

function docsView(s) {
  const generate = s.docTab === 'generate';
  return `<section class="xp-docs-section" id="dokumentasi">
    <div class="xp-section-heading xp-doc-heading"><div><span class="xp-kicker">02 / QUICKSTART</span><h2>Request pertama Anda</h2></div><span class="xp-doc-meta">${i('BookOpen')} REST · JSON</span></div>
    <div class="xp-doc-layout"><aside class="xp-doc-nav"><span class="xp-nav-caption">ENDPOINT</span><button data-action="doc-generate" class="xp-endpoint-button ${generate ? 'active' : ''}"><span class="xp-method post">POST</span> Generate video</button><button data-action="doc-status" class="xp-endpoint-button ${!generate ? 'active' : ''}"><span class="xp-method get">GET</span> Status tugas</button><div class="xp-doc-nav-note">${i('LockKeyhole')}<span>Kedua endpoint memakai header <code>X-Xclip-Key</code>.</span></div></aside>
    <div class="xp-endpoint"><div class="xp-endpoint-head"><span class="xp-method ${generate ? 'post' : 'get'}">${generate ? 'POST' : 'GET'}</span><code>${generate ? '/api/videogen/proxy' : '/api/videogen/tasks/:taskId'}</code><button class="xp-copy-inline" data-action="copy-curl">${i('Copy')} Salin cURL</button></div>
    <p class="xp-endpoint-desc">${generate ? 'Kirim gambar Base64, prompt, dan parameter model. Simpan taskId dari respons untuk mengecek status.' : 'Gunakan taskId hasil generasi. Hanya task milik akun/key Anda yang dapat diakses.'}</p>
    <div class="xp-data-note">Tetapkan <code>XCLIP_BASE_URL</code> ke alamat server Xclip tempat Anda menjalankan API. Ganti seluruh placeholder sebelum mengirim request. <code>videoUrl</code> adalah path relatif terhadap server Xclip; gunakan header <code>X-Xclip-Key</code> saat mengambil hasil video.</div>
    ${generate ? `<div class="xp-parameter-box"><div class="xp-param-title"><span>BODY · APPLICATION/JSON</span><button data-action="toggle-payload">${s.showPayload ? 'Sembunyikan' : 'Tampilkan'} ${i('ChevronDown')}</button></div>${s.showPayload ? `<div class="xp-param-grid"><div><code>model</code><span>string</span><p>Model video yang digunakan.</p></div><div><code>image</code><span>string</span><p>Gambar Base64 atau data URI, wajib.</p></div><div><code>prompt</code><span>string</span><p>Deskripsi video yang diinginkan.</p></div><div><code>duration</code><span>number</span><p>Durasi dalam detik.</p></div><div><code>aspectRatio</code><span>string</span><p>Rasio aspek, misalnya 16:9.</p></div></div>` : ''}</div>` : ''}
    <div class="xp-code-window"><div class="xp-code-title"><span>${i('Terminal')} CONTOH cURL</span><span class="xp-lang-tag">SHELL</span></div><pre><code>${e(curlExample(s.docTab))}</code></pre><div class="xp-code-foot"><span>${i('ShieldCheck')} Key tidak disertakan otomatis di contoh ini.</span><button data-action="copy-curl">Salin cURL</button></div></div>
    <div class="xp-data-note"><strong>Parameter:</strong> ${generate ? '<code>model</code>, <code>image</code> (Base64/data URI, wajib), <code>prompt</code>, <code>duration</code> (detik), <code>aspectRatio</code>. Model tersedia mengikuti backend Xclip yang berjalan.' : '<code>taskId</code> pada URL. Status dan output mengikuti respons API. Request tanpa key yang sah ditolak; task yang tidak dapat diakses menghasilkan 404.'}</div>
    <div class="xp-data-note"><strong>Layanan Xclip:</strong> Seluruh proses generasi dan hasil video diakses melalui API Xclip. Aplikasi Anda hanya membutuhkan API key Xclip.</div></div></div></section>`;
}

function modelsView() {
  return `<section class="xp-model-section" id="model" aria-labelledby="model-heading">
    <div class="xp-section-heading"><div><span class="xp-kicker">KATALOG / VIDEO</span><h2 id="model-heading">Model video</h2></div></div>
    <article class="xp-model-card"><div class="xp-model-title"><div><span class="xp-model-category">VIDEO · UNCENSORED</span><h3>Wan 3.0 Uncensored</h3></div><span class="xp-model-status">Segera tersedia</span></div><p>Model video dalam katalog Xclip. Belum aktif untuk request API; parameter integrasi akan ditampilkan saat model tersedia.</p></article>
  </section>`;
}

function topupView(s) {
  const selected = s.plans.find(p => String(p.id) === String(s.selectedPlan));
  const pending = s.payments.some(p => p.status === 'pending');
  return `<section class="xp-topup-section" id="topup"><div class="xp-section-heading"><div><span class="xp-kicker">04 / TOP UP</span><h2>Top up akses Xclip</h2></div>${i('Wallet')}</div>
    <div class="xp-topup-card"><div class="xp-topup-main"><div class="xp-topup-icon">${i('Wallet')}</div><div><span class="xp-access-label">QRIS · VERIFIKASI ADMIN</span><h3>Pilih paket dan unggah bukti pembayaran</h3><p>Pembayaran ini memperpanjang langganan Xclip, bukan menambah saldo rupiah atau kredit API terpisah. Akses diaktifkan setelah admin menyetujui bukti.</p></div></div></div>
    ${s.topupError ? `<div class="xp-data-note" role="alert">${e(s.topupError)} <button data-action="refresh">Coba lagi</button></div>` : ''}
    ${s.plans.length ? `<form id="payment-form" class="xp-payment-form xp-key-card"><label for="payment-plan">Paket</label><select name="planId" id="payment-plan" required>${s.plans.map(p => `<option value="${e(p.id)}" ${String(p.id) === String(s.selectedPlan) ? 'selected' : ''}>${e(p.name)} — ${money(p.price_idr)}</option>`).join('')}</select>${selected ? `<p>Nominal tepat: <strong>${money(selected.price_idr)}</strong> · ${e(selected.duration_days)} hari.</p>` : ''}
    <img id="qris-image" class="xp-qris" src="/assets/qris.jpg" alt="Kode QRIS pembayaran Xclip"><p id="qris-error" hidden role="alert">QRIS tidak dapat ditampilkan. Jangan melakukan pembayaran; hubungi admin Xclip.</p>
    <label for="proof">Bukti pembayaran (gambar)</label><input id="proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp" required>
    <button type="submit" ${pending ? 'disabled' : ''}>${pending ? 'Menunggu verifikasi pembayaran sebelumnya' : 'Saya sudah bayar — kirim bukti'}</button></form>` : !s.topupError ? '<div class="xp-data-note">Belum ada paket aktif yang dapat dibeli.</div>' : ''}
    <div class="xp-data-note"><strong>Riwayat pembayaran</strong>${s.historyError ? `<p role="alert">${e(s.historyError)}</p>` : s.payments.length ? `<div style="overflow:auto"><table class="xp-history"><thead><tr><th>Paket</th><th>Nominal</th><th>Status</th><th>Tanggal</th></tr></thead><tbody>${s.payments.map(p => `<tr><td>${e(p.package)}</td><td>${money(p.amount)}</td><td>${e(({pending:'Menunggu verifikasi',approved:'Disetujui',rejected:'Ditolak'})[p.status] || p.status)}</td><td>${e(date(p.created_at))}</td></tr>`).join('')}</tbody></table></div>` : '<p>Belum ada pembayaran.</p>'}</div></section>`;
}

export function portalView(s) {
  return `<div class="xp-portal"><header class="xp-topbar">${brand}<nav class="xp-top-links" aria-label="Navigasi utama"><a href="#kunci">API key</a><a href="#model">Model</a><a href="#dokumentasi">Dokumentasi</a><a href="#akses">Akses & paket</a><a href="#topup">Top up</a></nav><button class="xp-signout" data-action="logout">Keluar</button></header>
    <nav class="xp-mobile-menu" aria-label="Menu developer"><a href="#kunci">API key</a><a href="#model">Model</a><a href="#dokumentasi">Dokumentasi</a><a href="#akses">Akses & paket</a><a href="#topup">Top up</a></nav>
    ${s.error || s.notice ? `<div class="xp-alert" role="${s.error ? 'alert' : 'status'}">${e(s.error || s.notice)} <button data-action="dismiss" aria-label="Tutup pemberitahuan">×</button></div>` : ''}
    <main id="home" class="xp-main"><section class="xp-intro"><div class="xp-eyebrow"><span>PORTAL DEVELOPER</span><i></i> API VIDEO XCLIP</div><div class="xp-intro-row"><div><h1>Mulai bangun<br><em>dengan video AI.</em></h1><p class="xp-lede">Halo, ${e(s.user.username)}. Kelola integrasi Xclip melalui satu portal yang terhubung ke akun Anda.</p></div><div class="xp-intro-aside"><div class="xp-aside-icon">${i('Code2')}</div><span>DIRANCANG UNTUK INTEGRASI</span><p>Gunakan API key Xclip di server aplikasi Anda.</p><a href="#dokumentasi">Lihat quickstart ${i('ArrowDownRight')}</a></div></div><div class="xp-step-line"><span><b>01</b> Buat kunci</span><i></i><span><b>02</b> Kirim request</span><i></i><span><b>03</b> Cek status tugas</span></div></section>
    <section class="xp-overview" aria-label="Penggunaan API"><div class="xp-overview-title"><span class="xp-overview-icon">${i('Activity')}</span><span>AKTIVITAS PORTAL</span></div><div class="xp-overview-number">${s.overview ? Number(s.overview.totalRequests).toLocaleString('id-ID') : '—'}</div><div class="xp-overview-caption">total request API akun Anda</div><div class="xp-overview-foot"><button class="xp-copy-button" data-action="refresh">Perbarui data</button></div></section>
    <section class="xp-key-section" id="kunci"><div class="xp-section-heading"><div><span class="xp-kicker">01 / KREDENSIAL</span><h2>API key Anda</h2></div><span class="xp-single-rule">${i('LockKeyhole')} Satu kunci seumur hidup</span></div><div class="xp-key-card">${keyView(s)}<div class="xp-key-footnote"><span>i</span> Maksimal satu API key per pengguna, termasuk setelah dinonaktifkan.</div></div></section>
    ${modelsView()}
    ${docsView(s)}
    <section class="xp-access-section" id="akses"><div class="xp-section-heading"><div><span class="xp-kicker">03 / AKSES</span><h2>Akses mengikuti akun Xclip</h2></div></div><div class="xp-access-card"><div class="xp-access-main"><div class="xp-access-icon">${i('ShieldCheck')}</div><div><span class="xp-access-label">LANGGANAN ANDA</span><h3>${s.subscriptionError ? 'Status belum tersedia' : s.subscription?.hasSubscription ? 'Langganan aktif' : 'Belum ada langganan aktif'}</h3><p>${s.subscriptionError ? e(s.subscriptionError) : s.subscription?.subscription?.expiredAt ? 'Berakhir: '+e(date(s.subscription.subscription.expiredAt)) : 'Lihat pilihan paket untuk mengaktifkan akses akun.'}</p></div></div><div class="xp-access-divider"></div><div class="xp-access-side"><a href="#topup">Lihat paket & Top up ${i('ArrowRight')}</a></div></div></section>
    ${topupView(s)}
    <footer class="xp-footer"><a class="xp-footer-brand" href="/">${mark} xclip</a><span>PORTAL DEVELOPER</span></footer></main></div>`;
}
