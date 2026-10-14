import { authView, portalView, curlExample } from './developer-views.js';

const root = document.getElementById('developer-app');
const state = {
  user: null, authMode: 'register', authDraft: { username: '', email: '' },
  overview: null, subscription: null, plans: [], payments: [], selectedPlan: '',
  error: '', notice: '', subscriptionError: '', topupError: '', historyError: '',
  docTab: 'generate', showPayload: true, keyVisible: false, confirmRevoke: false, renaming: false,
};
let busy = false;

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && state.user) {
        state.user = null;
        state.overview = null;
        state.keyVisible = false;
      }
      throw new Error(data.error || `Request gagal (${response.status})`);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Server terlalu lama merespons. Coba lagi.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
const post = (path, data) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});

function render() {
  root.innerHTML = state.user ? portalView(state) : authView(state);
  const image = document.getElementById('qris-image');
  if (image) image.addEventListener('error', () => {
    document.getElementById('qris-error').hidden = false;
    const submit = document.querySelector('#payment-form button[type=submit]');
    if (submit) submit.disabled = true;
  });
}

async function loadData() {
  state.subscriptionError = state.topupError = state.historyError = '';
  // Do not replace failed data with fake zeros or an invented balance.
  state.overview = null;
  await Promise.all([
    api('/api/developer/overview').then(data => { state.overview = data; }),
    api('/api/subscription/status').then(data => { state.subscription = data; })
      .catch(error => { state.subscription = null; state.subscriptionError = error.message; }),
    api('/api/subscription/plans').then(data => {
      state.plans = data.plans;
      if (!state.plans.some(p => String(p.id) === String(state.selectedPlan))) {
        state.selectedPlan = state.plans.length ? String(state.plans[0].id) : '';
      }
    }).catch(error => { state.plans = []; state.topupError = error.message; }),
    api('/api/payments/my').then(data => { state.payments = data.payments; })
      .catch(error => { state.payments = []; state.historyError = error.message; }),
  ]);
}

async function perform(work) {
  if (busy) return;
  busy = true;
  root.querySelectorAll('button').forEach(button => { button.disabled = true; });
  state.error = state.notice = '';
  try { await work(); }
  catch (error) { state.error = error.message || 'Terjadi kesalahan. Coba lagi.'; }
  finally { busy = false; render(); }
}

root.addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  const data = new FormData(form);
  if (form.id === 'auth-form') {
    const email = String(data.get('email')).trim().toLowerCase();
    const username = String(data.get('username') || '').trim();
    const password = String(data.get('password'));
    state.authDraft = { email, username };
    const registering = state.authMode === 'register';
    perform(async () => {
      if (registering) {
        if (password !== data.get('confirm')) throw new Error('Konfirmasi kata sandi tidak cocok.');
        await post('/api/auth/register', { username, email, password, portal: true });
        state.authMode = 'login';
        state.notice = 'Pendaftaran berhasil. Silakan login untuk membuka portal.';
      } else {
        const result = await post('/api/auth/login', { email, password });
        state.user = result.user;
        await loadData();
      }
    });
  } else if (form.id === 'key-form') {
    perform(async () => {
      await post('/api/xclip-keys/create', { label: String(data.get('label')).trim() });
      await loadData();
      state.notice = 'API key berhasil dibuat. Simpan dengan aman di server Anda.';
    });
  } else if (form.id === 'rename-form') {
    perform(async () => {
      const key = state.overview?.keys.find(k => k.status === 'active');
      if (!key) throw new Error('API key aktif tidak ditemukan.');
      await post(`/api/xclip-keys/${key.id}/rename`, { label: String(data.get('label')).trim() });
      state.renaming = false;
      await loadData();
      state.notice = 'Nama key diperbarui.';
    });
  } else if (form.id === 'payment-form') {
    perform(async () => {
      const file = data.get('proof');
      if (!file || !file.size) throw new Error('Pilih bukti pembayaran.');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        throw new Error('Bukti harus berupa gambar JPG, PNG, atau WebP.');
      }
      if (file.size > 5 * 1024 * 1024) throw new Error('Bukti maksimal 5 MB.');
      const result = await api('/api/payments/submit', { method: 'POST', body: data });
      await loadData();
      state.notice = result.message || 'Bukti terkirim. Menunggu verifikasi admin.';
    });
  }
});

root.addEventListener('change', event => {
  if (event.target.id === 'payment-plan') {
    state.selectedPlan = event.target.value;
    render();
  }
});

root.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || busy) return;
  const action = button.dataset.action;
  if (action === 'toggle-password') {
    const input = document.getElementById('auth-password');
    input.type = input.type === 'password' ? 'text' : 'password';
    button.setAttribute('aria-label', input.type === 'password' ? 'Tampilkan kata sandi' : 'Sembunyikan kata sandi');
    return;
  }
  if (action === 'switch-auth') {
    state.authDraft.email = document.getElementById('auth-email')?.value || '';
    state.authMode = state.authMode === 'register' ? 'login' : 'register';
    state.error = state.notice = '';
  } else if (action === 'doc-generate' || action === 'doc-status') {
    state.docTab = action === 'doc-generate' ? 'generate' : 'status';
  } else if (action === 'toggle-key') {
    state.keyVisible = !state.keyVisible;
  } else if (action === 'toggle-payload') {
    state.showPayload = !state.showPayload;
  } else if (action === 'confirm-revoke' || action === 'cancel-revoke') {
    state.confirmRevoke = action === 'confirm-revoke';
  } else if (action === 'rename-key' || action === 'cancel-rename') {
    state.renaming = action === 'rename-key';
  } else if (action === 'dismiss') {
    state.error = state.notice = '';
  } else {
    perform(async () => {
      if (action === 'refresh') await loadData();
      if (action === 'logout') {
        await post('/api/auth/logout', {});
        state.user = state.overview = state.subscription = null;
        state.payments = state.plans = [];
        state.keyVisible = state.confirmRevoke = state.renaming = false;
        state.authMode = 'login';
        state.notice = 'Anda sudah keluar.';
      }
      if (action === 'revoke-key') {
        const key = state.overview?.keys.find(k => k.status === 'active');
        if (!key) throw new Error('API key aktif tidak ditemukan.');
        await post(`/api/xclip-keys/${key.id}/revoke`, {});
        state.keyVisible = state.confirmRevoke = false;
        await loadData();
        state.notice = 'API key dinonaktifkan permanen.';
      }
      if (action === 'copy-key' || action === 'copy-curl') {
        const text = action === 'copy-curl' ? curlExample(state.docTab)
          : state.overview?.keys.find(k => k.status === 'active')?.api_key;
        if (!text) throw new Error('Tidak ada teks yang dapat disalin.');
        if (!navigator.clipboard) throw new Error('Clipboard tidak tersedia. Tampilkan dan salin teks secara manual.');
        await navigator.clipboard.writeText(text);
        state.notice = action === 'copy-key' ? 'API key tersalin.' : 'Contoh cURL tersalin.';
      }
    });
    return;
  }
  render();
});

async function retireLegacyFrontend() {
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.filter(registration =>
        [registration.active, registration.waiting, registration.installing].some(worker =>
          worker && new URL(worker.scriptURL).pathname === '/sw.js'
        )
      ).map(registration => registration.unregister()));
    }
  } catch {
    console.warn('Service worker lama belum dapat dibersihkan; muat ulang portal saat online.');
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => /^xclip-v\d+$/.test(key)).map(key => caches.delete(key)));
    }
  } catch {
    console.warn('Cache UI lama belum dapat dibersihkan oleh browser.');
  }
}

async function start() {
  await retireLegacyFrontend();
  try {
    const { user } = await api('/api/auth/me');
    state.user = user;
    if (user) await loadData();
  } catch (error) {
    state.error = error.message;
  }
  render();
}
start();
