import { authView, portalView, curlExample, requestBody, apiBaseUrl, apiEndpointUrl, generationHistoryContent, modelsView, paymentButtonState } from './developer-views.js';

const root = document.getElementById('developer-app');
const state = {
  user: null, authMode: 'login', authDraft: { username: '', email: '' },
  overview: null, subscription: null, wallet: null, walletError: '', payments: [], topupAmount: '100000',
  models: [], modelError: '',
  paymentConfig: null, checkout: null, checkoutError: '', paymentAttempt: null,
  paymentCreating: false, paymentLoading: false,
  paymentBusy: false, paymentChecking: false, paymentStatusError: '', paymentNotice: '',
  actionBusy: false,
  generationTasks: [], generationError: '', generationPage: 1, generationHasMore: false,
  generationLoading: false, generationUpdatedAt: null,
  error: '', notice: '', subscriptionError: '', topupError: '', historyError: '',
  docTab: 'generate', docModelId: 'wan-3.0', showPayload: true, keyVisible: false, confirmRevoke: false, renaming: false,
};
let busy = false;
let paymentTimer;
let generationTimer;
let generationEpoch = 0;
let generationInFlight = false;
let generationRequestToken = 0;
let modelRequestToken = 0;
let paymentCheckInFlight = false;
let paymentCheckPromise = null;
let paymentDataToken = 0;
let paymentReadyTimer, paymentReadyRetries = 0;

function resetAccountData() {
  clearTimeout(paymentReadyTimer);
  paymentReadyRetries = 0;
  paymentDataToken += 1;
  state.overview = state.subscription = state.wallet = null;
  state.checkout = state.paymentConfig = state.paymentAttempt = null;
  state.paymentCreating = state.paymentLoading = false;
  state.paymentChecking = false;
  state.paymentStatusError = state.paymentNotice = '';
  state.payments = [];
  state.walletError = state.historyError = state.checkoutError = '';
  state.models = [];
  state.modelError = '';
}

async function api(path, options = {}) {
  const { timeoutMs = 20000, ...fetchOptions } = options;
  const requestUserId = state.user?.id;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store', ...fetchOptions, signal: controller.signal,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Respons server tidak dapat dibaca (HTTP ${response.status}). Muat ulang Preview atau buka di tab baru.`);
    }
    if (!response.ok) {
      if (response.status === 401 && state.user && state.user.id === requestUserId) {
        state.user = null;
        resetAccountData();
        state.keyVisible = false;
      }
      const reference = /^[-a-f0-9]{36}$/.test(data.reference || '') ? ` (Referensi: ${data.reference})` : '';
      const error = new Error((data.error || `Request gagal (${response.status})`) + reference);
      if (data.code === 'PAYMENT_INITIALIZING') error.code = data.code;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Server terlalu lama merespons. Coba lagi.');
    if (error.name === 'TypeError') {
      console.warn('Xclip: koneksi API gagal.', { method: options.method || 'GET', path });
      throw new Error('Tidak dapat terhubung ke server. Muat ulang Preview atau buka Preview di tab baru, lalu coba lagi.');
    }
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
  schedulePaymentCheck();
  clearTimeout(generationTimer);
  if (state.user) {
    generationTimer = setTimeout(() => loadGenerationHistory({ poll: true }), 10000);
    generationTimer?.unref?.();
  }
}

function schedulePaymentCheck() {
  clearTimeout(paymentTimer);
  if (state.user && state.checkout?.status === 'pending') {
    paymentTimer = setTimeout(() => checkPayment(true), 15000);
    paymentTimer?.unref?.();
  }
}

function updatePaymentButton() {
  const button = document.querySelector('#payment-form button[type=submit]');
  if (!button) return;
  const view = paymentButtonState(state);
  button.disabled = view.disabled;
  button.textContent = view.label;
  button.setAttribute('aria-busy', String(view.busy));
  const status = document.getElementById('payment-button-status');
  if (status) {
    status.textContent = view.reason;
    status.hidden = !view.reason;
  }
  root.querySelectorAll('[data-action="payment-refresh"], [data-action="payment-check"]').forEach(control => {
    const checking = control.dataset.action === 'payment-check' && state.paymentChecking;
    control.disabled = state.paymentBusy || checking;
    control.setAttribute('aria-busy', String(checking));
    if (control.dataset.action === 'payment-check') control.textContent = checking
      ? 'Memeriksa status…' : 'Cek status pembayaran';
  });
}

function updateGenerationSection() {
  const target = document.getElementById('generation-history-content');
  if (!target || !state.user) return;
  target.innerHTML = generationHistoryContent(state);
  const refresh = document.querySelector('.xp-generation-refresh');
  if (refresh) {
    refresh.disabled = state.generationLoading;
    refresh.textContent = state.generationLoading ? 'Memperbarui…' : 'Perbarui riwayat';
  }
  const updated = document.getElementById('generation-updated');
  if (updated) updated.textContent = state.generationUpdatedAt
    ? `Terakhir diperbarui ${new Date(state.generationUpdatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })} WIB`
    : 'Belum diperbarui';
}

async function loadGenerationHistory({ page = 1, append = false, poll = false } = {}) {
  const userId = state.user?.id;
  const epoch = generationEpoch;
  if (!userId || generationInFlight) return;
  const requestToken = ++generationRequestToken;
  const requestedPage = poll ? 1 : page;
  generationInFlight = true;
  state.generationLoading = true;
  state.generationError = '';
  updateGenerationSection();
  try {
    let data, tasks = [];
    // Refresh all loaded pages, not just the newest: older active tasks can finish too.
    const lastPage = poll ? state.generationPage : requestedPage;
    for (let current = requestedPage; current <= lastPage; current++) {
      data = await api(`/api/developer/generations?page=${current}`);
      if (state.user?.id !== userId || generationEpoch !== epoch) return;
      if (!Array.isArray(data.tasks) || data.page !== current || typeof data.hasMore !== 'boolean') {
        throw new Error('Respons riwayat generasi tidak valid. Coba lagi.');
      }
      tasks.push(...data.tasks);
      if (!data.hasMore) break;
    }
    state.generationTasks = [...new Map((append ? [...state.generationTasks, ...tasks] : tasks)
      .map(task => [task.taskId, task])).values()];
    state.generationPage = data.page;
    state.generationHasMore = data.hasMore;
    state.generationUpdatedAt = new Date().toISOString();
  } catch (error) {
    if (state.user?.id === userId && generationEpoch === epoch) {
      const message = error.message || '';
      state.generationError = [
        'Tidak dapat terhubung ke server.',
        'Server terlalu lama merespons.',
        'Respons server tidak dapat dibaca',
        'Respons riwayat generasi tidak valid.',
      ].some(prefix => message.startsWith(prefix))
        ? message
        : 'Riwayat generasi gagal dimuat. Periksa koneksi, lalu coba lagi.';
    }
    if (!state.user) render();
  } finally {
    if (requestToken === generationRequestToken) generationInFlight = false;
    if (requestToken === generationRequestToken && state.user?.id === userId && generationEpoch === epoch) {
      state.generationLoading = false;
      updateGenerationSection();
      clearTimeout(generationTimer);
      generationTimer = setTimeout(() => loadGenerationHistory({ poll: true }), 10000);
      generationTimer?.unref?.();
    }
  }
}

async function loadPaymentData() {
  const userId = state.user?.id, epoch = generationEpoch;
  const token = ++paymentDataToken;
  const current = () => state.user?.id === userId && generationEpoch === epoch && token === paymentDataToken;
  clearTimeout(paymentReadyTimer);
  let initializing = false;
  const failed = (key, error) => {
    if (!current()) return;
    state[key] = error.message + (error.code === 'PAYMENT_INITIALIZING' && paymentReadyRetries < 6
      ? ' Portal akan memeriksa ulang otomatis.' : '');
    if (error.code === 'PAYMENT_INITIALIZING') initializing = true;
  };
  state.walletError = state.historyError = state.checkoutError = '';
  state.paymentLoading = true;
  updatePaymentButton();
  try {
  await Promise.all([
    api('/api/developer/wallet').then(data => {
      if (!current()) return;
      if (!Number.isSafeInteger(data.balance) || !Number.isSafeInteger(data.reserved)) throw new Error('Data saldo tidak valid.');
      state.wallet = data;
    }).catch(error => failed('walletError', error)),
    api('/api/payments/my').then(data => { if (current()) state.payments = data.payments; })
      .catch(error => failed('historyError', error)),
    api('/api/payments/klikqris/config').then(data => { if (current()) state.paymentConfig = data; })
      .catch(error => failed('checkoutError', error)),
    api('/api/payments/klikqris/current', { timeoutMs: 12000 }).then(data => {
      if (!current()) return;
      state.checkout = data.invoice;
      if (data.invoice && ['paid', 'expired', 'failed'].includes(data.invoice.status)) state.paymentAttempt = null;
    }).catch(error => failed('checkoutError', error)),
  ]);
  } finally {
    if (current()) {
      state.paymentLoading = false;
      updatePaymentButton();
      if (initializing && paymentReadyRetries < 6) {
        paymentReadyRetries += 1;
        paymentReadyTimer = setTimeout(() => {
          if (current() && !state.paymentBusy) void performPayment(loadPaymentData);
        }, 5000);
        paymentReadyTimer?.unref?.();
      } else if (!initializing) paymentReadyRetries = 0;
    }
  }
}

async function loadModels() {
  const userId = state.user?.id, epoch = generationEpoch, token = ++modelRequestToken;
  const current = () => state.user?.id === userId && generationEpoch === epoch && token === modelRequestToken;
  state.modelError = '';
  try {
    const data = await api('/api/developer/models');
    if (!Array.isArray(data.models)) throw new Error('Data katalog model tidak valid.');
    if (current()) state.models = data.models;
  } catch (error) {
    if (current()) state.modelError = error.message;
  } finally {
    // Never redraw the payment form or QR image for a video-provider response.
    if (current()) {
      const section = document.getElementById('model');
      if (section) section.outerHTML = modelsView(state);
    }
  }
}

async function loadData() {
  const userId = state.user?.id, epoch = generationEpoch;
  state.subscriptionError = '';
  // Video providers and history cannot block financial actions.
  void loadModels();
  void loadGenerationHistory({ page: 1 });
  await Promise.all([
    api('/api/developer/overview').then(data => {
      if (state.user?.id === userId && generationEpoch === epoch) state.overview = data;
    }),
    api('/api/subscription/status').then(data => {
      if (state.user?.id === userId && generationEpoch === epoch) state.subscription = data;
    }).catch(error => {
      if (state.user?.id === userId && generationEpoch === epoch) state.subscriptionError = error.message;
    }),
    state.paymentBusy ? Promise.resolve() : loadPaymentData(),
  ]);
}

async function checkPayment(automatic = false) {
  const invoiceId = state.checkout?.id, userId = state.user?.id, epoch = generationEpoch;
  if (!invoiceId || !userId) return;
  if (paymentCheckInFlight) {
    await paymentCheckPromise;
    if (!automatic && !state.paymentStatusError && state.user?.id === userId && generationEpoch === epoch) {
      state.paymentNotice = paymentStatusMessage(state.checkout);
      render();
    }
    return;
  }
  if (automatic && (state.paymentBusy || state.paymentLoading)) { schedulePaymentCheck(); return; }
  paymentCheckInFlight = true;
  state.paymentChecking = true;
  updatePaymentButton();
  const previous = JSON.stringify(state.checkout), previousError = state.paymentStatusError;
  state.paymentStatusError = '';
  paymentCheckPromise = (async () => {
  try {
    const { invoice } = await api(`/api/payments/klikqris/${encodeURIComponent(invoiceId)}`);
    if (state.user?.id !== userId || generationEpoch !== epoch || state.checkout?.id !== invoiceId) return;
    state.checkout = invoice;
    state.payments = state.payments.map(row => row.id === invoice.id ? invoice : row);
    if (!automatic) state.paymentNotice = paymentStatusMessage(invoice);
    if (['paid', 'expired', 'failed'].includes(invoice.status)) {
      await loadPaymentData();
      if (state.user?.id !== userId || generationEpoch !== epoch) return;
      state.notice = invoice.status === 'paid'
        ? state.paymentConfig?.sandbox ? 'Simulasi pembayaran berhasil. Saldo nyata tidak diubah.'
          : invoice.billing_type === 'subscription' ? 'Pembayaran langganan lama dikonfirmasi.'
            : 'Pembayaran dikonfirmasi. Saldo API sudah ditambahkan.'
        : invoice.status === 'expired' ? 'Tagihan kedaluwarsa. Buat QRIS baru jika ingin melanjutkan.' : 'Tagihan gagal.';
    }
  } catch (error) {
    if (state.user?.id === userId && generationEpoch === epoch) state.paymentStatusError = error.message;
  } finally {
    paymentCheckInFlight = false;
    state.paymentChecking = false;
    if (state.user?.id === userId && generationEpoch === epoch) {
      updatePaymentButton();
      if (!automatic || previous !== JSON.stringify(state.checkout) || previousError !== state.paymentStatusError) render();
      else schedulePaymentCheck();
    }
  }
  })();
  await paymentCheckPromise;
}

function paymentStatusMessage(invoice) {
  return ({
    pending: 'Status berhasil diperiksa: belum ada pembayaran yang terkonfirmasi. Jika sudah membayar, tunggu sebentar lalu periksa lagi.',
    paid: 'Status berhasil diperiksa: pembayaran lunas.',
    expired: 'Status berhasil diperiksa: tagihan kedaluwarsa. Buat QRIS baru; jangan bayar QRIS lama.',
    failed: 'Status berhasil diperiksa: tagihan gagal. Anda dapat mencoba membuat QRIS baru.',
    creating: 'Tagihan masih disiapkan. Jangan membuat ulang; hubungi admin jika status tidak berubah.',
    uncertain: 'Pembuatan tagihan belum terkonfirmasi. Jangan membuat ulang; diperlukan pemeriksaan admin.',
  })[invoice?.status] || 'Belum ada tagihan untuk diperiksa.';
}

async function performPayment(work) {
  if (state.paymentBusy) return;
  state.paymentBusy = true;
  state.error = state.notice = '';
  state.paymentStatusError = state.paymentNotice = '';
  updatePaymentButton();
  try { await work(); }
  catch (error) { state.paymentStatusError = error.message || 'Pembayaran gagal diproses. Coba periksa kembali.'; }
  finally { state.paymentBusy = false; render(); }
}

async function perform(work) {
  if (busy) return;
  busy = true;
  state.actionBusy = true;
  updatePaymentButton();
  state.error = state.notice = '';
  try { await work(); }
  catch (error) { state.error = error.message || 'Terjadi kesalahan. Coba lagi.'; }
  finally { busy = false; state.actionBusy = false; render(); }
}

root.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  if ((busy && form.id !== 'payment-form') || (form.id === 'payment-form' && state.paymentBusy)) return;
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
        generationEpoch += 1;
        generationRequestToken += 1;
        generationInFlight = false;
        state.generationTasks = [];
        state.generationPage = 1;
        state.generationHasMore = false;
        state.generationError = '';
        state.generationUpdatedAt = null;
        resetAccountData();
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
    performPayment(async () => {
      const amount = Number(data.get('amount'));
      state.topupAmount = String(data.get('amount'));
      if (!state.wallet || !Number.isSafeInteger(amount) || amount < state.wallet.minimumTopup || amount > state.wallet.maximumTopup) {
        throw new Error('Nominal top up harus rupiah bulat sesuai batas yang ditampilkan.');
      }
      if (!state.paymentConfig?.available || state.checkoutError) throw new Error('Pembayaran belum siap. Perbarui data terlebih dahulu.');
      // A slower account refresh must not overwrite the newly created invoice
      // with the snapshot it fetched before this POST.
      paymentDataToken += 1;
      state.paymentLoading = false;
      if (!state.paymentAttempt || state.paymentAttempt.amount !== amount) {
        state.paymentAttempt = { amount, key: typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID() : `web_${Date.now()}_${Math.random().toString(36).slice(2)}` };
      }
      let result;
      state.paymentCreating = true;
      updatePaymentButton();
      try {
        result = await api('/api/payments/klikqris/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': state.paymentAttempt.key },
          body: JSON.stringify({ amount }),
        });
      } catch (error) {
        // Recover the persisted invoice even if the browser missed the POST response.
        try {
          const recovered = await api('/api/payments/klikqris/current', { timeoutMs: 10000 });
          state.checkout = recovered.invoice;
        } catch {
          state.checkoutError = 'Pembuatan tagihan belum terkonfirmasi. Perbarui pembayaran sebelum mencoba lagi; jangan membuat pembayaran ganda.';
        }
        throw error;
      } finally {
        state.paymentCreating = false;
        updatePaymentButton();
      }
      state.checkout = result.invoice;
      state.payments = [result.invoice, ...state.payments.filter(invoice => invoice.id !== result.invoice.id)];
      if (['paid', 'expired', 'failed'].includes(result.invoice.status)) state.paymentAttempt = null;
      state.paymentNotice = result.invoice.status === 'pending'
        ? 'QRIS siap. Bayar sesuai nominal akhir yang ditampilkan; status diperiksa otomatis.'
        : 'Tagihan sudah tercatat. Periksa status sebelum melakukan pembayaran.';
    });
  }
});

root.addEventListener('change', event => {
  if (event.target.id === 'payment-amount') state.topupAmount = event.target.value;
});

root.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'payment-refresh' || action === 'payment-check') {
    performPayment(async () => {
      if (action === 'payment-check') await checkPayment();
      else {
        await loadPaymentData();
        if (!state.checkoutError && !state.walletError) state.paymentNotice = 'Data pembayaran berhasil diperbarui.';
      }
    });
    return;
  }
  if ((busy && !action.startsWith('generations-')) || (action === 'logout' && state.paymentBusy)) return;
  if (action === 'toggle-password') {
    const input = document.getElementById('auth-password');
    input.type = input.type === 'password' ? 'text' : 'password';
    button.setAttribute('aria-label', input.type === 'password' ? 'Tampilkan kata sandi' : 'Sembunyikan kata sandi');
    return;
  }
  if (action === 'generations-refresh') {
    if (!generationInFlight) {
      state.generationTasks = [];
      state.generationPage = 1;
      state.generationHasMore = false;
      loadGenerationHistory({ page: 1 });
    }
    return;
  }
  if (action === 'generations-more') {
    if (!generationInFlight && state.generationHasMore) {
      loadGenerationHistory({ page: state.generationPage + 1, append: true });
    }
    return;
  }
  if (action === 'switch-auth') {
    state.authDraft.email = document.getElementById('auth-email')?.value || '';
    state.authMode = state.authMode === 'register' ? 'login' : 'register';
    state.error = state.notice = '';
  } else if (action === 'doc-generate' || action === 'doc-status' || action === 'doc-download') {
    state.docTab = action === 'doc-generate' ? 'generate' : action === 'doc-download' ? 'download' : 'status';
  } else if (action === 'doc-model') {
    if (['wan-3.0', 'seedance-2.5', 'seedance-2.0'].includes(button.dataset.modelId)) {
      state.docModelId = button.dataset.modelId;
    }
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
        generationEpoch += 1;
        generationRequestToken += 1;
        generationInFlight = false;
        clearTimeout(generationTimer);
        generationTimer = null;
        state.generationTasks = [];
        state.generationError = '';
        state.generationPage = 1;
        state.generationHasMore = false;
        state.generationLoading = false;
        state.generationUpdatedAt = null;
        state.user = state.overview = state.subscription = null;
        state.payments = [];
        state.wallet = null;
        state.checkout = state.paymentConfig = state.paymentAttempt = null;
        state.checkoutError = '';
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
      if (['copy-key', 'copy-curl', 'copy-json', 'copy-base-url', 'copy-endpoint-url'].includes(action)) {
        const text = action === 'copy-base-url' ? apiBaseUrl()
          : action === 'copy-endpoint-url' ? apiEndpointUrl(state.docTab)
          : action === 'copy-json' ? JSON.stringify(requestBody(state.docModelId), null, 2)
          : action === 'copy-curl' ? curlExample(state.docTab, state.docModelId)
          : state.overview?.keys.find(k => k.status === 'active')?.api_key;
        if (!text) throw new Error('Tidak ada teks yang dapat disalin.');
        if (!navigator.clipboard) throw new Error('Clipboard tidak tersedia. Tampilkan dan salin teks secara manual.');
        await navigator.clipboard.writeText(text);
        state.notice = action === 'copy-base-url' ? 'Base URL tersalin.'
          : action === 'copy-endpoint-url' ? 'URL endpoint tersalin.'
          : action === 'copy-key' ? 'API key tersalin.'
          : action === 'copy-json' ? 'Body JSON tersalin.' : 'Contoh cURL tersalin.';
      }
    });
    return;
  }
  render();
});

async function retireLegacyFrontend() {
  let controlledByLegacy = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const controller = navigator.serviceWorker.controller;
      controlledByLegacy = !!controller && new URL(controller.scriptURL).pathname === '/sw.js';
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
  return controlledByLegacy;
}

async function start() {
  const controlledByLegacy = await retireLegacyFrontend();
  // Unregistering a worker does not release its current page. Navigate once
  // before sending login requests, while guarding against a reload loop.
  if (typeof sessionStorage !== 'undefined' && typeof location !== 'undefined') {
    try {
      const marker = 'xclip-legacy-worker-reload';
      if (controlledByLegacy && !sessionStorage.getItem(marker)) {
        sessionStorage.setItem(marker, '1');
        location.reload();
        return;
      }
      if (!controlledByLegacy) sessionStorage.removeItem(marker);
    } catch {
      console.warn('Preview perlu dimuat ulang secara manual untuk melepas service worker lama.');
    }
  }
  try {
    const { user } = await api('/api/auth/me');
    generationEpoch += 1;
    generationRequestToken += 1;
    generationInFlight = false;
    state.user = user;
    if (user) await loadData();
  } catch (error) {
    state.error = error.message;
  }
  render();
}
start();
