const API_URL = '';

// Debounce render to prevent too many updates
let renderTimeout = null;
let lastRenderTime = 0;
const RENDER_THROTTLE = 50; // ms

const state = {
  currentPage: 'video',
  video: null,
  jobId: null,
  status: 'idle',
  progress: 0,
  statusDetail: '',
  clips: [],
  isUploading: false,
  uploadProgress: 0,
  settings: {
    resolution: '720p',
    clipCount: 3,
    aspectRatio: '9:16',
    clipDuration: 30,
    targetLanguage: 'original'
  },
  chat: {
    messages: [],
    isLoading: false,
    selectedModel: 'openai/gpt-4o-mini',
    attachments: []
  },
  xmaker: {
    characterDescription: '',
    style: 'realistic',
    imageCount: 1,
    aspectRatio: '1:1',
    isGenerating: false,
    generatedImages: [],
    selectedModel: 'flux-pro',
    referenceImage: null,
    xclipApiKey: ''
  },
  videogen: {
    sourceImage: null,
    prompt: '',
    selectedModel: 'kling-pro',
    duration: '5',
    aspectRatio: '16:9',
    isGenerating: false,
    tasks: [],
    generatedVideos: [],
    error: null,
    customApiKey: ''
  },
  roomManager: {
    rooms: [],
    xmakerRooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    showXmakerRoomModal: false
  },
  pricing: {
    plans: [],
    isLoading: false,
    showModal: false,
    selectedPlan: null,
    remainingSeconds: 0
  },
  xclipKeys: {
    keys: [],
    isLoading: false,
    showModal: false,
    newKeyLabel: ''
  },
  auth: {
    user: null,
    isLoading: true,
    showModal: false,
    modalMode: 'login'
  },
  liveStats: {
    onlineCount: 0,
    recentPurchases: [],
    showPurchaseAnimation: false,
    currentPurchase: null
  },
  payment: {
    showModal: false,
    selectedPlan: null,
    proofFile: null,
    isSubmitting: false,
    myPayments: [],
    pendingPayment: null
  },
  admin: {
    isAdmin: false,
    payments: [],
    isLoading: false,
    filter: 'pending'
  }
};

const VIDEO_MODELS = [
  { id: 'kling-v2.5-pro', name: 'Kling V2.5 Pro', desc: '1080p HD, kualitas terbaik', icon: '👑' },
  { id: 'kling-v2.1-master', name: 'Kling V2.1 Master', desc: 'Kontrol motion lanjutan', icon: '🎬' },
  { id: 'kling-v2.1-pro', name: 'Kling V2.1 Pro', desc: 'Kualitas profesional', icon: '⭐' },
  { id: 'kling-v2.1-std', name: 'Kling V2.1 Std', desc: 'Budget friendly', icon: '💰' },
  { id: 'kling-v1.6-pro', name: 'Kling 1.6 Pro', desc: 'Model stabil klasik', icon: '🌟' },
  { id: 'minimax-hailuo-1080p', name: 'MiniMax Hailuo 1080p', desc: 'HD dengan audio', icon: '🔊' },
  { id: 'minimax-hailuo-768p', name: 'MiniMax Hailuo 768p', desc: 'Cepat dengan audio', icon: '🔉' },
  { id: 'seedance-pro-1080p', name: 'Seedance Pro 1080p', desc: 'Durasi panjang HD', icon: '🌱' },
  { id: 'seedance-pro-720p', name: 'Seedance Pro 720p', desc: 'Keseimbangan kualitas', icon: '🌿' },
  { id: 'pixverse-v5', name: 'PixVerse V5', desc: 'Efek transisi', icon: '✨' }
];

const IMAGE_MODELS = [
  { id: 'flux-pro', name: 'Flux Pro v1.1', provider: 'Xclip AI', icon: '⚡', desc: 'Tercepat & kualitas terbaik (6x lebih cepat)' },
  { id: 'flux-dev', name: 'Flux Dev', provider: 'Xclip AI', icon: '🛠️', desc: 'Iterasi cepat, bagus untuk testing' },
  { id: 'hyperflux', name: 'Hyperflux', provider: 'Xclip AI', icon: '🚀', desc: 'Konsisten untuk karakter & objek' },
  { id: 'seedream', name: 'Seedream 4', provider: 'Xclip AI', icon: '🌱', desc: 'Kreatif dengan kualitas seimbang' },
  { id: 'classic-fast', name: 'Classic Fast', provider: 'Xclip AI', icon: '💨', desc: 'Prototipe cepat, low latency' },
  { id: 'mystic', name: 'Mystic', provider: 'Xclip AI', icon: '✨', desc: 'Fotorealistik 4K, support referensi gambar' }
];

const IMAGE_STYLES = [
  { id: 'realistic', name: 'Realistis', desc: 'Foto nyata berkualitas tinggi' },
  { id: 'anime', name: 'Anime', desc: 'Gaya ilustrasi Jepang' },
  { id: 'cartoon', name: 'Kartun', desc: 'Gaya kartun colorful' },
  { id: 'cinematic', name: 'Sinematik', desc: 'Seperti adegan film' },
  { id: 'fantasy', name: 'Fantasi', desc: 'Magis dan imajinatif' },
  { id: 'portrait', name: 'Potret', desc: 'Fokus pada wajah/karakter' }
];

const LLM_MODELS = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', icon: '🟢' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI', icon: '🟢' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', icon: '🟣' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic', icon: '🟣' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', provider: 'Google', icon: '🔵' },
  { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5', provider: 'Google', icon: '🔵' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'Meta', icon: '🟠' },
  { id: 'mistralai/mixtral-8x7b-instruct', name: 'Mixtral 8x7B', provider: 'Mistral', icon: '🔴' },
  { id: 'qwen/qwen-2-72b-instruct', name: 'Qwen 2 72B', provider: 'Alibaba', icon: '🟡' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', icon: '⚫' }
];

function renderAuthModal() {
  if (!state.auth.showModal) return '';
  
  const isLogin = state.auth.modalMode === 'login';
  const isApiKey = state.auth.modalMode === 'apikey';
  
  if (isApiKey) {
    return `
      <div class="modal-overlay" id="authModalOverlay">
        <div class="auth-modal">
          <button class="modal-close" id="closeAuthModal">&times;</button>
          <div class="auth-header">
            <h2>Kelola API Key</h2>
            <p>Kelola Xclip API Key untuk Video Gen</p>
          </div>
          <form id="apiKeyForm" class="auth-form">
            <div class="form-group">
              <label>API Key</label>
              <input type="password" id="userApiKey" placeholder="Masukkan API key Anda..." class="form-input">
              <p class="form-hint">Kosongkan untuk menghapus API key tersimpan</p>
            </div>
            <button type="submit" class="auth-submit-btn">Simpan</button>
          </form>
        </div>
      </div>
    `;
  }
  
  return `
    <div class="modal-overlay" id="authModalOverlay">
      <div class="auth-modal">
        <button class="modal-close" id="closeAuthModal">&times;</button>
        <div class="auth-header">
          <h2>${isLogin ? 'Login' : 'Daftar'}</h2>
          <p>${isLogin ? 'Masuk ke akun Anda' : 'Buat akun baru'}</p>
        </div>
        <form id="authForm" class="auth-form">
          ${!isLogin ? `
            <div class="form-group">
              <label>Username</label>
              <input type="text" id="authUsername" placeholder="Username Anda" class="form-input" required>
            </div>
          ` : ''}
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="authEmail" placeholder="email@contoh.com" class="form-input" required>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="authPassword" placeholder="Password (min 6 karakter)" class="form-input" required>
          </div>
          <button type="submit" class="auth-submit-btn">${isLogin ? 'Login' : 'Daftar'}</button>
        </form>
        <div class="auth-switch">
          ${isLogin ? 
            `Belum punya akun? <a href="#" id="switchToRegister">Daftar</a>` : 
            `Sudah punya akun? <a href="#" id="switchToLogin">Login</a>`
          }
        </div>
      </div>
    </div>
  `;
}

async function checkAuth() {
  try {
    const response = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' });
    const data = await response.json();
    state.auth.user = data.user;
    state.auth.isLoading = false;
    
    if (data.user) {
      // Load all data in parallel for faster performance
      await Promise.all([
        fetchSubscriptionPlans(),
        fetchRooms(),
        fetchSubscriptionStatus(),
        fetchXclipKeys(),
        checkAdminStatus()
      ]);
    }
    
    render();
  } catch (error) {
    console.error('Auth check error:', error);
    state.auth.isLoading = false;
    render();
  }
}

async function checkAdminStatus() {
  try {
    const response = await fetch(`${API_URL}/api/admin/check`, { credentials: 'include' });
    const data = await response.json();
    state.admin.isAdmin = data.isAdmin || false;
    
    // If admin, treat as having subscription to bypass UI locks
    if (state.admin.isAdmin) {
      state.roomManager.hasSubscription = true;
    }
  } catch (error) {
    console.error('Admin check error:', error);
    state.admin.isAdmin = false;
  }
}

async function fetchMyPayments() {
  try {
    const response = await fetch(`${API_URL}/api/payments/my`, { credentials: 'include' });
    const data = await response.json();
    state.payment.myPayments = data.payments || [];
  } catch (error) {
    console.error('Fetch payments error:', error);
    state.payment.myPayments = [];
  }
}

async function submitPayment() {
  if (!state.payment.proofFile || !state.payment.selectedPlan) return;
  
  try {
    state.payment.isSubmitting = true;
    render();
    
    const formData = new FormData();
    formData.append('proof', state.payment.proofFile);
    formData.append('planId', state.payment.selectedPlan);
    
    const response = await fetch(`${API_URL}/api/payments/submit`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Pembayaran berhasil disubmit! Menunggu verifikasi admin.', 'success');
      state.payment.showModal = false;
      state.payment.proofFile = null;
      state.payment.selectedPlan = null;
    } else {
      showToast(data.error || 'Gagal submit pembayaran', 'error');
    }
  } catch (error) {
    console.error('Submit payment error:', error);
    showToast('Gagal submit pembayaran', 'error');
  } finally {
    state.payment.isSubmitting = false;
    render();
  }
}

async function fetchAdminPayments() {
  try {
    state.admin.isLoading = true;
    render();
    
    const filter = state.admin.filter === 'all' ? '' : `?status=${state.admin.filter}`;
    const response = await fetch(`${API_URL}/api/admin/payments${filter}`, { credentials: 'include' });
    const data = await response.json();
    state.admin.payments = data.payments || [];
  } catch (error) {
    console.error('Fetch admin payments error:', error);
    state.admin.payments = [];
  } finally {
    state.admin.isLoading = false;
    render();
  }
}

async function approvePayment(paymentId) {
  try {
    const response = await fetch(`${API_URL}/api/admin/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Pembayaran berhasil di-approve!', 'success');
      await fetchAdminPayments();
    } else {
      showToast(data.error || 'Gagal approve pembayaran', 'error');
    }
  } catch (error) {
    console.error('Approve payment error:', error);
    showToast('Gagal approve pembayaran', 'error');
  }
}

async function rejectPayment(paymentId, reason) {
  try {
    const response = await fetch(`${API_URL}/api/admin/payments/${paymentId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ reason })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Pembayaran ditolak', 'success');
      await fetchAdminPayments();
    } else {
      showToast(data.error || 'Gagal reject pembayaran', 'error');
    }
  } catch (error) {
    console.error('Reject payment error:', error);
    showToast('Gagal reject pembayaran', 'error');
  }
}

async function fetchLiveStats() {
  try {
    const response = await fetch(`${API_URL}/api/stats/live`, { credentials: 'include' });
    const data = await response.json();
    state.liveStats.onlineCount = data.onlineCount;
    updateOnlineCounter();
  } catch (error) {
    console.error('Stats error:', error);
  }
}

async function fetchRecentPurchases() {
  try {
    const response = await fetch(`${API_URL}/api/stats/purchases`, { credentials: 'include' });
    const data = await response.json();
    state.liveStats.recentPurchases = data.purchases || [];
  } catch (error) {
    console.error('Purchases error:', error);
  }
}

function updateOnlineCounter() {
  const counter = document.getElementById('onlineCounter');
  if (counter) {
    counter.textContent = state.liveStats.onlineCount.toLocaleString();
  }
}

const FAKE_NAMES = ['Ar***a', 'Bu***i', 'De***k', 'Fi***a', 'Gi***t', 'Ha***n', 'Ir***i', 'Ja***l', 'Ki***a', 'Li***n', 'Ma***d', 'Na***a', 'Om***r', 'Pa***i', 'Qu***n', 'Ra***a', 'Sa***i', 'Ti***o', 'Ul***a', 'Vi***o'];
const FAKE_PLANS = ['1 Hari', '3 Hari', '1 Minggu', '1 Bulan'];
const FAKE_PRICES = [15000, 35000, 65000, 199000];

function showRandomPurchaseAnimation() {
  const randomName = FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)];
  const planIndex = Math.floor(Math.random() * FAKE_PLANS.length);
  const planName = FAKE_PLANS[planIndex];
  const price = FAKE_PRICES[planIndex];
  
  state.liveStats.currentPurchase = {
    username: randomName,
    planName: planName,
    price: price
  };
  state.liveStats.showPurchaseAnimation = true;
  
  renderPurchaseToast();
  
  setTimeout(() => {
    state.liveStats.showPurchaseAnimation = false;
    const toast = document.getElementById('purchaseToast');
    if (toast) {
      toast.classList.remove('show');
    }
  }, 4000);
}

function renderPurchaseToast() {
  let toast = document.getElementById('purchaseToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'purchaseToast';
    toast.className = 'purchase-toast';
    document.body.appendChild(toast);
  }
  
  if (state.liveStats.showPurchaseAnimation && state.liveStats.currentPurchase) {
    const p = state.liveStats.currentPurchase;
    toast.innerHTML = `
      <div class="purchase-toast-content">
        <div class="purchase-icon">🎉</div>
        <div class="purchase-info">
          <span class="purchase-user">${p.username}</span>
          <span class="purchase-text">baru saja membeli</span>
          <span class="purchase-plan">${p.planName}</span>
        </div>
      </div>
    `;
    toast.classList.add('show');
  }
}

function startLiveStatsPolling() {
  fetchLiveStats();
  fetchRecentPurchases();
  
  setInterval(fetchLiveStats, 30000);
  
  setInterval(() => {
    showRandomPurchaseAnimation();
  }, 5000 + Math.random() * 5000);
  
  setTimeout(() => {
    showRandomPurchaseAnimation();
  }, 3000);
}

async function handleLogin(email, password) {
  try {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      state.auth.user = data.user;
      state.auth.showModal = false;
      showToast(`Selamat datang, ${data.user.username}!`, 'success');
      
      // Load all data in parallel for faster performance
      await Promise.all([
        fetchRooms(),
        fetchSubscriptionStatus(),
        fetchXclipKeys(),
        checkAdminStatus()
      ]);
      
      // Connect SSE for real-time video updates
      if (typeof connectSSE === 'function') {
        connectSSE();
      }
      
      render();
    } else {
      showToast(data.error || 'Login gagal', 'error');
    }
  } catch (error) {
    console.error('Login error:', error);
    showToast('Login gagal', 'error');
  }
}

async function handleRegister(username, email, password) {
  try {
    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, email, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      state.auth.user = data.user;
      state.auth.showModal = false;
      showToast(`Akun berhasil dibuat! Selamat datang, ${data.user.username}!`, 'success');
      
      // Load all data in parallel for faster performance
      await Promise.all([
        fetchRooms(),
        fetchSubscriptionStatus(),
        fetchXclipKeys(),
        checkAdminStatus()
      ]);
      
      render();
    } else {
      showToast(data.error || 'Registrasi gagal', 'error');
    }
  } catch (error) {
    console.error('Register error:', error);
    showToast('Registrasi gagal', 'error');
  }
}

async function handleLogout() {
  try {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });
    
    // Reset ALL state to initial values
    state.auth.user = null;
    state.auth.showModal = false;
    state.auth.isLogin = true;
    state.videogen.customApiKey = '';
    state.videogen.tasks = [];
    state.roomManager.hasSubscription = false;
    state.roomManager.subscription = null;
    state.roomManager.rooms = [];
    state.roomManager.xmakerRooms = [];
    state.roomManager.currentRoom = null;
    state.roomManager.xmakerCurrentRoom = null;
    state.pricing.remainingSeconds = 0;
    state.xclipKeys.keys = [];
    state.xclipKeys.tasks = [];
    state.admin.isAdmin = false;
    state.admin.payments = [];
    state.admin.filter = 'pending';
    state.payment.myPayments = [];
    state.payment.selectedPlan = null;
    state.payment.proofFile = null;
    state.chat.messages = [];
    state.xmaker.generatedImages = [];
    state.currentPage = 'video';
    
    // Clear countdown timer
    if (typeof countdownInterval !== 'undefined' && countdownInterval) {
      clearInterval(countdownInterval);
    }
    
    showToast('Logout berhasil', 'success');
    
    // Force immediate render (bypass throttle)
    lastRenderTime = 0;
    render();
  } catch (error) {
    console.error('Logout error:', error);
    showToast('Logout gagal', 'error');
  }
}

async function handleSaveApiKey(apiKey) {
  try {
    const response = await fetch(`${API_URL}/api/auth/update-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ apiKey })
    });
    
    const data = await response.json();
    
    if (data.success) {
      state.videogen.customApiKey = apiKey;
      state.auth.showModal = false;
      showToast(apiKey ? 'API key berhasil disimpan' : 'API key berhasil dihapus', 'success');
      render();
    } else {
      showToast(data.error || 'Gagal menyimpan API key', 'error');
    }
  } catch (error) {
    console.error('Save API key error:', error);
    showToast('Gagal menyimpan API key', 'error');
  }
}

// ==================== ROOM MANAGER FUNCTIONS ====================

async function fetchRooms(feature = 'videogen') {
  try {
    const response = await fetch(`${API_URL}/api/rooms?feature=${feature}`, { credentials: 'include' });
    const data = await response.json();
    if (feature === 'xmaker') {
      state.roomManager.xmakerRooms = data.rooms || [];
    } else {
      state.roomManager.rooms = data.rooms || [];
    }
  } catch (error) {
    console.error('Fetch rooms error:', error);
  }
}

async function fetchSubscriptionStatus() {
  try {
    const response = await fetch(`${API_URL}/api/subscription/status`, { credentials: 'include' });
    const data = await response.json();
    state.roomManager.hasSubscription = data.hasSubscription;
    state.roomManager.subscription = data.subscription || null;
    if (data.subscription?.remainingSeconds) {
      state.pricing.remainingSeconds = data.subscription.remainingSeconds;
      startCountdownTimer();
    }
    
  } catch (error) {
    console.error('Fetch subscription error:', error);
  }
}


async function fetchSubscriptionPlans() {
  try {
    const response = await fetch(`${API_URL}/api/subscription/plans`, { credentials: 'include' });
    const data = await response.json();
    state.pricing.plans = data.plans || [];
  } catch (error) {
    console.error('Fetch plans error:', error);
  }
}

function startCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  
  // Initial display update
  updateCountdownDisplay();
  
  countdownInterval = setInterval(() => {
    if (state.pricing.remainingSeconds > 0) {
      state.pricing.remainingSeconds--;
      updateCountdownDisplay();
      
      // Every 30 seconds, sync with server just in case
      if (state.pricing.remainingSeconds % 30 === 0) {
        fetchSubscriptionStatus();
      }
    } else {
      clearInterval(countdownInterval);
      state.roomManager.hasSubscription = false;
      state.roomManager.subscription = null;
      render();
    }
  }, 1000);
}

function updateCountdownDisplay() {
  const timerEl = document.getElementById('subscriptionTimer');
  if (timerEl) {
    const newTime = formatRemainingTime(state.pricing.remainingSeconds);
    if (timerEl.textContent !== newTime) {
      timerEl.textContent = newTime;
    }
  }
  
  // Also update room manager displays if they exist
  const roomSubTimes = document.querySelectorAll('.sub-time');
  roomSubTimes.forEach(el => {
    if (!el.textContent.includes('Unlimited')) {
      const newTime = formatRemainingTime(state.pricing.remainingSeconds);
      if (el.textContent !== newTime) {
        el.textContent = newTime;
      }
    }
  });
}

function formatRemainingTime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) {
    return `${days}h ${hours}j ${mins}m`;
  }
  return `${hours}j ${mins}m ${secs}d`;
}

function formatPrice(price) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(price);
}

async function buySubscription(planId) {
  try {
    state.pricing.isLoading = true;
    render();
    
    const response = await fetch(`${API_URL}/api/subscription/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ planId })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(data.message || 'Langganan berhasil diaktifkan!', 'success');
      state.pricing.showModal = false;
      await fetchSubscriptionStatus();
      await fetchRooms();
    } else {
      showToast(data.error || 'Gagal membeli paket', 'error');
    }
  } catch (error) {
    console.error('Buy subscription error:', error);
    showToast('Gagal membeli paket', 'error');
  } finally {
    state.pricing.isLoading = false;
    render();
  }
}

async function selectRoom(roomId, feature = 'videogen') {
  try {
    state.roomManager.isLoading = true;
    render();
    
    const response = await fetch(`${API_URL}/api/room/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ roomId, feature })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(data.message || 'Berhasil bergabung ke room', 'success');
      state.roomManager.showRoomModal = false;
      state.roomManager.showXmakerRoomModal = false;
      await fetchSubscriptionStatus();
      await fetchRooms(feature);
    } else {
      showToast(data.error || 'Gagal bergabung ke room', 'error');
    }
  } catch (error) {
    console.error('Select room error:', error);
    showToast('Gagal bergabung ke room', 'error');
  } finally {
    state.roomManager.isLoading = false;
    render();
  }
}

async function leaveRoom() {
  try {
    const response = await fetch(`${API_URL}/api/room/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Berhasil keluar dari room', 'success');
      await fetchSubscriptionStatus();
      await fetchRooms();
    }
  } catch (error) {
    console.error('Leave room error:', error);
  }
}

function renderRoomModal() {
  if (!state.roomManager.showRoomModal) return '';
  
  return `
    <div class="modal-overlay" id="roomModalOverlay">
      <div class="auth-modal room-modal">
        <button class="modal-close" id="closeRoomModal">&times;</button>
        <div class="auth-header">
          <h2>Pilih Room</h2>
          <p>Pilih room yang tersedia untuk generate video</p>
        </div>
        <div class="room-list">
          ${state.roomManager.rooms.map(room => `
            <div class="room-card ${room.status === 'FULL' ? 'room-full' : ''} ${room.status === 'MAINTENANCE' ? 'room-maintenance' : ''}" 
                 data-room-id="${room.id}" ${room.status !== 'OPEN' ? 'disabled' : ''}>
              <div class="room-header">
                <span class="room-name">${room.name}</span>
                <span class="room-status status-${room.status.toLowerCase()}">${room.status}</span>
              </div>
              <div class="room-slots">
                <span class="slot-icon">👥</span>
                <span>${room.active_users}/${room.max_users} Users</span>
              </div>
              ${room.status === 'OPEN' ? `<button class="btn btn-primary btn-sm select-room-btn" data-room-id="${room.id}">Pilih</button>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderXmakerRoomModal() {
  if (!state.roomManager.showXmakerRoomModal) return '';
  
  return `
    <div class="modal-overlay" id="xmakerRoomModalOverlay">
      <div class="auth-modal room-modal">
        <button class="modal-close" id="closeXmakerRoomModal">&times;</button>
        <div class="auth-header">
          <h2>Pilih XMaker Room</h2>
          <p>Pilih room yang tersedia untuk generate gambar</p>
        </div>
        <div class="room-list">
          ${state.roomManager.xmakerRooms.map(room => `
            <div class="room-card ${room.status === 'FULL' ? 'room-full' : ''} ${room.status === 'MAINTENANCE' ? 'room-maintenance' : ''}" 
                 data-room-id="${room.id}" ${room.status !== 'OPEN' ? 'disabled' : ''}>
              <div class="room-header">
                <span class="room-name">${room.name}</span>
                <span class="room-status status-${room.status.toLowerCase()}">${room.status}</span>
              </div>
              <div class="room-slots">
                <span class="slot-icon">👥</span>
                <span>${room.active_users}/${room.max_users} Users</span>
              </div>
              ${room.status === 'OPEN' ? `<button class="btn btn-primary btn-sm select-xmaker-room-btn" data-room-id="${room.id}">Pilih</button>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function formatTimeRemaining(expiredAt) {
  const now = new Date();
  const expired = new Date(expiredAt);
  const diff = expired - now;
  
  if (diff <= 0) return 'Expired';
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${hours}j ${minutes}m tersisa`;
}

function renderPricingModal() {
  if (!state.pricing.showModal) return '';
  
  return `
    <div class="modal-overlay" id="pricingModalOverlay">
      <div class="auth-modal pricing-modal">
        <button class="modal-close" id="closePricingModal">&times;</button>
        <div class="auth-header">
          <h2>Pilih Paket Berlangganan</h2>
          <p>Berlangganan untuk mengakses semua fitur Xclip</p>
        </div>
        <div class="pricing-grid">
          ${state.pricing.plans.map(plan => `
            <div class="pricing-card ${state.pricing.selectedPlan === plan.id ? 'selected' : ''}" data-plan-id="${plan.id}">
              <div class="plan-duration">${plan.name}</div>
              <div class="plan-price">${formatPrice(plan.price_idr)}</div>
              <div class="plan-desc">${plan.description}</div>
              <ul class="plan-features">
                <li>Video Clipper</li>
                <li>X Maker Image Gen</li>
                <li>Video Gen AI</li>
                <li>AI Chat Multi Model</li>
              </ul>
              <button class="btn btn-primary buy-plan-btn" data-plan-id="${plan.id}" ${state.pricing.isLoading ? 'disabled' : ''}>
                ${state.pricing.isLoading && state.pricing.selectedPlan === plan.id ? 'Memproses...' : 'Pilih Paket'}
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderFeatureLock() {
  // Admin bypasses all locks
  if (state.admin.isAdmin) return '';
  
  // User logged in with subscription - no lock
  if (state.auth.user && state.roomManager.hasSubscription) return '';
  
  // Not logged in - show login prompt
  if (!state.auth.user) {
    return `
      <div class="feature-lock-overlay">
        <div class="lock-content">
          <div class="xclip-ai-animation">
            <div class="ai-logo-container">
              <div class="ai-ring ring-1"></div>
              <div class="ai-ring ring-2"></div>
              <div class="ai-ring ring-3"></div>
              <div class="ai-core">X</div>
            </div>
            <div class="ai-particles">
              <span></span><span></span><span></span><span></span><span></span><span></span>
            </div>
          </div>
          <h3 class="lock-title">Xclip AI</h3>
          <p class="lock-subtitle">Platform AI Creative Suite Terlengkap</p>
          <p class="lock-desc">Login atau daftar untuk mengakses semua fitur AI canggih</p>
          <button class="btn btn-primary btn-lg pulse-btn" id="openLoginBtn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              <polyline points="10 17 15 12 10 7"/>
              <line x1="15" y1="12" x2="3" y2="12"/>
            </svg>
            Login / Daftar
          </button>
        </div>
      </div>
    `;
  }
  
  // Logged in but no subscription - show subscription prompt
  return `
    <div class="feature-lock-overlay">
      <div class="lock-content">
        <div class="xclip-ai-animation">
          <div class="ai-logo-container">
            <div class="ai-ring ring-1"></div>
            <div class="ai-ring ring-2"></div>
            <div class="ai-ring ring-3"></div>
            <div class="ai-core">X</div>
          </div>
          <div class="ai-particles">
            <span></span><span></span><span></span><span></span><span></span><span></span>
          </div>
        </div>
        <h3 class="lock-title">Fitur Premium Terkunci</h3>
        <p class="lock-subtitle">Halo, ${state.auth.user?.username || 'User'}!</p>
        <p class="lock-desc">Berlangganan untuk mengakses semua fitur AI Xclip</p>
        <button class="btn btn-primary btn-lg pulse-btn" id="openPricingBtn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
          </svg>
          Lihat Paket Berlangganan
        </button>
      </div>
    </div>
  `;
}

function renderPaymentModal() {
  if (!state.payment.showModal || !state.payment.selectedPlan) return '';
  
  const plan = state.pricing.plans.find(p => p.id === state.payment.selectedPlan);
  if (!plan) return '';
  
  return `
    <div class="modal-overlay" id="paymentModalOverlay">
      <div class="auth-modal payment-modal">
        <button class="modal-close" id="closePaymentModal">&times;</button>
        <div class="auth-header">
          <h2>Pembayaran QRIS</h2>
          <p>Scan QRIS untuk melakukan pembayaran</p>
        </div>
        
        <div class="payment-details">
          <div class="payment-plan-info">
            <h3>${plan.name}</h3>
            <div class="payment-amount">${formatPrice(plan.price_idr)}</div>
          </div>
          
          <div class="qris-container">
            <img src="/assets/qris.jpg" alt="QRIS" class="qris-image" onerror="this.src='https://via.placeholder.com/300x300?text=QRIS+Not+Found'">
            <p class="qris-note">Scan menggunakan aplikasi e-wallet atau mobile banking</p>
          </div>
          
          <div class="payment-instructions">
            <h4>Instruksi Pembayaran:</h4>
            <ol>
              <li>Scan QRIS di atas menggunakan aplikasi pembayaran Anda</li>
              <li>Pastikan nominal sesuai: <strong>${formatPrice(plan.price_idr)}</strong></li>
              <li>Selesaikan pembayaran</li>
              <li>Screenshot bukti pembayaran</li>
              <li>Upload bukti pembayaran di bawah</li>
            </ol>
          </div>
          
          <div class="proof-upload-section">
            <label class="upload-label">
              <input type="file" id="paymentProofInput" accept="image/*" hidden>
              <div class="upload-box ${state.payment.proofFile ? 'has-file' : ''}">
                ${state.payment.proofFile ? `
                  <img src="${URL.createObjectURL(state.payment.proofFile)}" alt="Proof" class="proof-preview">
                  <span class="file-name">${state.payment.proofFile.name}</span>
                ` : `
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>Upload Bukti Pembayaran</span>
                `}
              </div>
            </label>
          </div>
          
          <button class="btn btn-primary btn-lg" id="submitPaymentBtn" 
            ${!state.payment.proofFile || state.payment.isSubmitting ? 'disabled' : ''}>
            ${state.payment.isSubmitting ? 'Mengirim...' : 'Saya Sudah Bayar'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderMyPaymentsModal() {
  if (!state.payment.pendingPayment && state.payment.myPayments.length === 0) return '';
  
  const showModal = state.payment.pendingPayment !== null;
  if (!showModal) return '';
  
  return `
    <div class="modal-overlay" id="myPaymentsModalOverlay">
      <div class="auth-modal my-payments-modal">
        <button class="modal-close" id="closeMyPaymentsModal">&times;</button>
        <div class="auth-header">
          <h2>Riwayat Pembayaran</h2>
          <p>Lihat status pembayaran Anda</p>
        </div>
        
        <div class="payments-list">
          ${state.payment.myPayments.length === 0 ? `
            <p class="no-payments">Belum ada riwayat pembayaran.</p>
          ` : state.payment.myPayments.map(payment => `
            <div class="payment-card status-${payment.status}">
              <div class="payment-header">
                <span class="payment-package">${payment.package}</span>
                <span class="payment-status status-badge-${payment.status}">
                  ${payment.status === 'pending' ? 'Menunggu Verifikasi' : 
                    payment.status === 'approved' ? 'Berhasil' : 'Ditolak'}
                </span>
              </div>
              <div class="payment-info">
                <span class="payment-amount">${formatPrice(payment.amount)}</span>
                <span class="payment-date">${new Date(payment.created_at).toLocaleDateString('id-ID')}</span>
              </div>
              ${payment.admin_notes ? `<p class="payment-notes">${payment.admin_notes}</p>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderAdminPage() {
  if (!state.admin.isAdmin) return '';
  
  return `
    <div class="container admin-page">
      <div class="admin-header">
        <h1>Admin Dashboard</h1>
        <p>Verifikasi pembayaran user</p>
        <button class="btn btn-secondary" id="backToMainBtn">Kembali</button>
      </div>
      
      <div class="admin-filters">
        <button class="filter-btn ${state.admin.filter === 'all' ? 'active' : ''}" data-filter="all">Semua</button>
        <button class="filter-btn ${state.admin.filter === 'pending' ? 'active' : ''}" data-filter="pending">Menunggu</button>
        <button class="filter-btn ${state.admin.filter === 'approved' ? 'active' : ''}" data-filter="approved">Approved</button>
        <button class="filter-btn ${state.admin.filter === 'rejected' ? 'active' : ''}" data-filter="rejected">Rejected</button>
        <button class="btn btn-secondary refresh-btn" id="refreshAdminPayments">Refresh</button>
      </div>
      
      <div class="admin-payments-list">
        ${state.admin.isLoading ? `
          <div class="loading-spinner">Loading...</div>
        ` : state.admin.payments.length === 0 ? `
          <div class="no-payments">Tidak ada pembayaran ${state.admin.filter !== 'all' ? 'dengan status ini' : ''}</div>
        ` : state.admin.payments.map(payment => `
          <div class="admin-payment-card">
            <div class="payment-user-info">
              <strong>${payment.username}</strong>
              <span>${payment.email}</span>
            </div>
            <div class="payment-details">
              <span class="package">${payment.package}</span>
              <span class="amount">${formatPrice(payment.amount)}</span>
              <span class="date">${new Date(payment.created_at).toLocaleString('id-ID')}</span>
            </div>
            <div class="payment-proof">
              <a href="${payment.proof_image}" target="_blank" class="view-proof-btn">
                <img src="${payment.proof_image}" alt="Bukti" class="proof-thumbnail">
                Lihat Bukti
              </a>
            </div>
            <div class="payment-status">
              <span class="status-badge-${payment.status}">
                ${payment.status === 'pending' ? 'Menunggu' : 
                  payment.status === 'approved' ? 'Approved' : 'Rejected'}
              </span>
            </div>
            ${payment.status === 'pending' ? `
              <div class="payment-actions">
                <button class="btn btn-success approve-btn" data-payment-id="${payment.id}">ACC</button>
                <button class="btn btn-danger reject-btn" data-payment-id="${payment.id}">Tolak</button>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function fetchXclipKeys() {
  try {
    const response = await fetch(`${API_URL}/api/xclip-keys`, { credentials: 'include' });
    const data = await response.json();
    state.xclipKeys.keys = data.keys || [];
  } catch (error) {
    console.error('Fetch Xclip keys error:', error);
  }
}

async function createXclipKey(label) {
  try {
    state.xclipKeys.isLoading = true;
    render();
    
    const response = await fetch(`${API_URL}/api/xclip-keys/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ label: label || 'Default Key' })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Xclip API Key berhasil dibuat!', 'success');
      await fetchXclipKeys();
      state.xclipKeys.showModal = false;
      state.xclipKeys.newKeyLabel = '';
      
      navigator.clipboard.writeText(data.key.api_key).then(() => {
        showToast('API Key disalin ke clipboard!', 'success');
      });
    } else {
      showToast(data.error || 'Gagal membuat API key', 'error');
    }
  } catch (error) {
    console.error('Create Xclip key error:', error);
    showToast('Gagal membuat API key', 'error');
  } finally {
    state.xclipKeys.isLoading = false;
    render();
  }
}

async function revokeXclipKey(keyId) {
  try {
    const response = await fetch(`${API_URL}/api/xclip-keys/${keyId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('API Key berhasil dinonaktifkan', 'success');
      await fetchXclipKeys();
    } else {
      showToast(data.error || 'Gagal menonaktifkan API key', 'error');
    }
  } catch (error) {
    console.error('Revoke Xclip key error:', error);
    showToast('Gagal menonaktifkan API key', 'error');
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('API Key disalin ke clipboard!', 'success');
  }).catch(() => {
    showToast('Gagal menyalin API key', 'error');
  });
}

function renderXclipKeysModal() {
  if (!state.xclipKeys.showModal) return '';
  
  return `
    <div class="modal-overlay" id="xclipKeysModalOverlay">
      <div class="auth-modal xclip-keys-modal">
        <button class="modal-close" id="closeXclipKeysModal">&times;</button>
        <div class="auth-header">
          <h2>Xclip API Keys</h2>
          <p>Kelola API key untuk akses Video Generator</p>
        </div>
        
        ${state.xclipKeys.keys.length === 0 ? `
        <div class="create-key-section">
          <div class="form-group">
            <label>Label Key (opsional)</label>
            <input type="text" id="newKeyLabel" placeholder="e.g. Production Key" class="form-input" value="${state.xclipKeys.newKeyLabel}">
          </div>
          <button class="btn btn-primary" id="createXclipKeyBtn" ${state.xclipKeys.isLoading ? 'disabled' : ''}>
            ${state.xclipKeys.isLoading ? 'Membuat...' : '+ Buat API Key Baru'}
          </button>
          <p class="key-limit-notice">Setiap user hanya bisa membuat 1 API key seumur hidup.</p>
        </div>
        ` : ''}
        
        <div class="keys-list">
          <h3>API Keys Aktif</h3>
          ${state.xclipKeys.keys.length === 0 ? `
            <p class="no-keys">Belum ada API key. Buat satu untuk memulai.</p>
          ` : state.xclipKeys.keys.map(key => `
            <div class="key-card">
              <div class="key-header">
                <span class="key-label">${key.label}</span>
                <span class="key-stats">${key.requests_count || 0} requests</span>
              </div>
              <div class="key-value">
                <code>${key.api_key.substring(0, 20)}...</code>
                <button class="btn btn-sm btn-icon copy-key-btn" data-key="${key.api_key}" title="Salin">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
              <div class="key-actions">
                <span class="key-created">Dibuat: ${new Date(key.created_at).toLocaleDateString('id-ID')}</span>
                <button class="btn btn-sm btn-danger revoke-key-btn" data-key-id="${key.id}">Nonaktifkan</button>
              </div>
            </div>
          `).join('')}
        </div>
        
        <div class="api-docs-section">
          <h3>Cara Penggunaan</h3>
          <p>Gunakan API key di header request:</p>
          <code class="code-block">X-Xclip-Key: xclip_xxxxx...</code>
          <p style="margin-top: 8px;">Endpoint: POST /api/videogen/proxy</p>
        </div>
      </div>
    </div>
  `;
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb < 1000 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 4000);
}

function render() {
  // Throttle renders to prevent performance issues
  const now = Date.now();
  if (now - lastRenderTime < RENDER_THROTTLE) {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(render, RENDER_THROTTLE);
    return;
  }
  lastRenderTime = now;
  
  const app = document.getElementById('app');
  
  app.innerHTML = `
    <div class="bg-animation">
      <div class="bg-blob blob-1"></div>
      <div class="bg-blob blob-2"></div>
      <div class="bg-blob blob-3"></div>
    </div>
    
    <div class="particles" id="particles"></div>
    
    <header class="header">
      <div class="container header-content">
        <div class="logo">
          <div class="logo-icon">X</div>
          <span class="logo-text">Xclip</span>
          <span class="logo-badge">AI</span>
        </div>
        
        <nav class="nav-menu">
          <button class="nav-btn ${state.currentPage === 'video' ? 'active' : ''}" data-page="video">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="23 7 16 12 23 17 23 7"/>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            Video Clipper
          </button>
          <button class="nav-btn ${state.currentPage === 'xmaker' ? 'active' : ''}" data-page="xmaker">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            X Maker
          </button>
          <button class="nav-btn ${state.currentPage === 'videogen' ? 'active' : ''}" data-page="videogen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
              <line x1="7" y1="2" x2="7" y2="22"/>
              <line x1="17" y1="2" x2="17" y2="22"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <line x1="2" y1="7" x2="7" y2="7"/>
              <line x1="2" y1="17" x2="7" y2="17"/>
              <line x1="17" y1="17" x2="22" y2="17"/>
              <line x1="17" y1="7" x2="22" y2="7"/>
            </svg>
            Video Gen
          </button>
          <button class="nav-btn ${state.currentPage === 'chat' ? 'active' : ''}" data-page="chat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            AI Chat
          </button>
        </nav>
        
        <div class="header-right">
          <div class="credit">
            <span class="credit-label">Created by</span>
            <span class="credit-name">MANAZIL</span>
          </div>
          
          ${state.auth.user && state.roomManager.hasSubscription ? `
            <div class="subscription-timer">
              <span class="timer-icon">⏱️</span>
              <span id="subscriptionTimer">${formatRemainingTime(state.pricing.remainingSeconds)}</span>
            </div>
          ` : ''}
          
          ${state.auth.user ? `
            <div class="user-menu">
              <button class="user-btn" id="userMenuBtn">
                <div class="user-avatar">${state.auth.user.username.charAt(0).toUpperCase()}</div>
                <span class="user-name">${state.auth.user.username}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <div class="user-dropdown" id="userDropdown">
                <div class="dropdown-header">
                  <strong>${state.auth.user.username}</strong>
                  <span>${state.auth.user.email}</span>
                </div>
                <div class="dropdown-divider"></div>
                <button class="dropdown-item" id="manageApiKeyBtn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  Kelola API Key
                </button>
                <button class="dropdown-item" id="openXclipKeysDropdownBtn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                  </svg>
                  Xclip API Keys
                </button>
                <button class="dropdown-item" id="myPaymentsBtn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                    <line x1="1" y1="10" x2="23" y2="10"/>
                  </svg>
                  Riwayat Pembayaran
                </button>
                ${state.admin.isAdmin ? `
                <button class="dropdown-item admin" id="adminDashboardBtn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                  Admin Dashboard
                </button>
                ` : ''}
                <button class="dropdown-item logout" id="logoutBtn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  Logout
                </button>
              </div>
            </div>
          ` : `
            <button class="auth-btn" id="loginBtn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              Login
            </button>
          `}
        </div>
      </div>
    </header>
    
    ${renderAuthModal()}
    ${renderRoomModal()}
    ${renderXmakerRoomModal()}
    ${renderXclipKeysModal()}
    ${renderPricingModal()}
    ${renderPaymentModal()}
    ${renderMyPaymentsModal()}
    
    <main class="main-content">
      ${state.currentPage === 'admin' ? renderAdminPage() : renderFeatureLock()}
      ${state.currentPage === 'video' ? renderVideoPage() : 
        state.currentPage === 'xmaker' ? renderXMakerPage() : 
        state.currentPage === 'videogen' ? renderVideoGenPage() : 
        state.currentPage === 'admin' ? '' :
        state.currentPage === 'chat' ? renderChatPage() : renderVideoPage()}
    </main>
    
    <footer class="footer">
      <div class="container">
        <div class="footer-content">
          <div class="footer-logo">
            <div class="logo-icon small">X</div>
            <span>Xclip</span>
          </div>
          <p>AI Creative Suite | Crafted with passion by <a href="#">MANAZIL</a></p>
        </div>
      </div>
    </footer>
  `;
  
  attachEventListeners();
  // createParticles(); // Disabled - particles hidden for cleaner look
  
  if (state.currentPage === 'chat') {
    scrollChatToBottom();
  }
}

function renderVideoPage() {
  return `
    <div class="container">
      <div class="hero">
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
          Powered by AI
        </div>
        <h1 class="hero-title">
          <span class="gradient-text">AI-Powered</span> Video Clipping
        </h1>
        <p class="hero-subtitle">Transform your long videos into viral short clips with AI-powered scene detection, speech-to-text, and smart translations</p>
        
        <div class="hero-stats">
          <div class="stat-item">
            <div class="stat-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <div class="stat-text">
              <span class="stat-value">1GB</span>
              <span class="stat-label">Max Upload</span>
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                <line x1="9" y1="9" x2="9.01" y2="9"/>
                <line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
            </div>
            <div class="stat-text">
              <span class="stat-value">12+</span>
              <span class="stat-label">Languages</span>
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div class="stat-text">
              <span class="stat-value">Fast</span>
              <span class="stat-label">Processing</span>
            </div>
          </div>
        </div>
      </div>
      
      <div class="app-grid">
        <div class="left-panel">
          ${renderVideoSection()}
          ${state.clips.length > 0 ? renderClipsSection() : ''}
        </div>
        
        <div class="right-panel">
          ${renderSettingsSection()}
        </div>
      </div>
    </div>
  `;
}

function renderChatPage() {
  const currentModel = LLM_MODELS.find(m => m.id === state.chat.selectedModel);
  
  return `
    <div class="container chat-container">
      <div class="chat-hero">
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Multi-Model AI Chat
        </div>
        <h1 class="hero-title">
          <span class="gradient-text">AI Chat</span> Assistant
        </h1>
        <p class="hero-subtitle">Chat dengan berbagai model AI terbaik. Upload file dan gambar untuk analisis.</p>
      </div>
      
      <div class="chat-layout">
        <div class="chat-sidebar">
          <div class="sidebar-section">
            <h3 class="sidebar-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Pilih Model AI
            </h3>
            <div class="model-list">
              ${LLM_MODELS.map(model => `
                <div class="model-item ${model.id === state.chat.selectedModel ? 'active' : ''}" data-model="${model.id}">
                  <span class="model-icon">${model.icon}</span>
                  <div class="model-info">
                    <span class="model-name">${model.name}</span>
                    <span class="model-provider">${model.provider}</span>
                  </div>
                  ${model.id === state.chat.selectedModel ? '<span class="model-check">✓</span>' : ''}
                </div>
              `).join('')}
            </div>
          </div>
          
          <button class="btn btn-secondary btn-full" id="clearChat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Hapus Chat
          </button>
        </div>
        
        <div class="chat-main">
          <div class="chat-header">
            <div class="chat-model-info">
              <span class="model-icon-large">${currentModel?.icon || '🤖'}</span>
              <div>
                <h3>${currentModel?.name || 'AI Assistant'}</h3>
                <span>${currentModel?.provider || 'AI'}</span>
              </div>
            </div>
          </div>
          
          <div class="chat-messages" id="chatMessages">
            ${state.chat.messages.length === 0 ? `
              <div class="chat-welcome">
                <div class="welcome-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <h3>Selamat datang di AI Chat!</h3>
                <p>Mulai percakapan dengan ${currentModel?.name || 'AI'}. Anda bisa mengirim teks, file, atau gambar.</p>
                <div class="welcome-tips">
                  <div class="tip">
                    <span class="tip-icon">💬</span>
                    <span>Tanyakan apapun</span>
                  </div>
                  <div class="tip">
                    <span class="tip-icon">📎</span>
                    <span>Upload file untuk analisis</span>
                  </div>
                  <div class="tip">
                    <span class="tip-icon">🖼️</span>
                    <span>Kirim gambar untuk deskripsi</span>
                  </div>
                </div>
              </div>
            ` : state.chat.messages.map(msg => renderMessage(msg)).join('')}
            
            ${state.chat.isLoading ? `
              <div class="message assistant">
                <div class="message-avatar">
                  <span>${currentModel?.icon || '🤖'}</span>
                </div>
                <div class="message-content">
                  <div class="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
          
          <div class="chat-input-area">
            ${state.chat.attachments.length > 0 ? `
              <div class="attachments-preview">
                ${state.chat.attachments.map((att, i) => `
                  <div class="attachment-item">
                    ${att.type.startsWith('image/') ? `
                      <img src="${att.preview}" alt="Preview">
                    ` : `
                      <div class="file-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                          <polyline points="13 2 13 9 20 9"/>
                        </svg>
                      </div>
                    `}
                    <span class="attachment-name">${att.name}</span>
                    <button class="attachment-remove" data-index="${i}">×</button>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            
            <div class="chat-input-wrapper">
              <button class="input-btn attach-btn" id="attachBtn" title="Lampirkan file">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>
              <button class="input-btn image-btn" id="imageBtn" title="Upload gambar">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </button>
              <textarea 
                id="chatInput" 
                placeholder="Ketik pesan Anda..."
                rows="1"
                ${state.chat.isLoading ? 'disabled' : ''}
              ></textarea>
              <button class="input-btn send-btn" id="sendBtn" ${state.chat.isLoading ? 'disabled' : ''}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
            <input type="file" id="fileInput" style="display: none" multiple>
            <input type="file" id="imageInput" accept="image/*" style="display: none" multiple>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMessage(msg) {
  const isUser = msg.role === 'user';
  const currentModel = LLM_MODELS.find(m => m.id === state.chat.selectedModel);
  
  return `
    <div class="message ${isUser ? 'user' : 'assistant'}">
      <div class="message-avatar">
        ${isUser ? '👤' : `<span>${currentModel?.icon || '🤖'}</span>`}
      </div>
      <div class="message-content">
        ${msg.attachments && msg.attachments.length > 0 ? `
          <div class="message-attachments">
            ${msg.attachments.map(att => `
              ${att.type.startsWith('image/') ? `
                <img src="${att.preview}" alt="Attachment" class="message-image">
              ` : `
                <div class="message-file">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                    <polyline points="13 2 13 9 20 9"/>
                  </svg>
                  ${att.name}
                </div>
              `}
            `).join('')}
          </div>
        ` : ''}
        <div class="message-text">${formatMessageContent(msg.content)}</div>
        <div class="message-time">${formatTime(msg.timestamp)}</div>
      </div>
    </div>
  `;
}

function formatMessageContent(content) {
  let formatted = content
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
  return formatted;
}

function renderXMakerPage() {
  const currentModel = IMAGE_MODELS.find(m => m.id === state.xmaker.selectedModel);
  const currentStyle = IMAGE_STYLES.find(s => s.id === state.xmaker.style);
  
  return `
    <div class="container xmaker-container">
      <div class="hero">
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          AI Image Generator
        </div>
        <h1 class="hero-title">
          <span class="gradient-text">X Maker</span> Image Generator
        </h1>
        <p class="hero-subtitle">Generate gambar dengan karakter konsisten menggunakan AI. Buat multiple gambar sekaligus!</p>
      </div>
      
      ${state.auth.user ? `
      <div class="room-manager-panel glass-card xmaker-room-panel">
        <div class="room-manager-header">
          <div class="room-manager-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span>Room Manager - X Maker</span>
          </div>
          ${state.roomManager.hasSubscription && state.roomManager.subscription ? `
            <div class="subscription-info">
              <span class="sub-badge active">Aktif</span>
              <span class="sub-time">${formatTimeRemaining(state.roomManager.subscription.expiredAt)}</span>
            </div>
          ` : ''}
        </div>
        
        <div class="room-manager-content">
          ${!state.roomManager.hasSubscription ? `
            <div class="no-subscription">
              <p>Anda belum memiliki paket aktif untuk generate gambar</p>
              <button class="btn btn-primary" id="buyXmakerPackageBtn" ${state.roomManager.isLoading ? 'disabled' : ''}>
                ${state.roomManager.isLoading ? 'Memproses...' : 'Beli Paket Langganan'}
              </button>
            </div>
          ` : state.roomManager.subscription && !state.roomManager.subscription.xmakerRoomId ? `
            <div class="select-room-prompt">
              <p>Pilih XMaker Room untuk mulai generate gambar</p>
              <button class="btn btn-primary" id="openXmakerRoomModalBtn">Pilih XMaker Room</button>
            </div>
          ` : `
            <div class="current-room">
              <div class="room-info">
                <span class="room-label">XMaker Room:</span>
                <span class="room-value">${state.roomManager.subscription?.xmakerRoomName || 'Unknown'}</span>
                <span class="room-status-badge status-${(state.roomManager.subscription?.xmakerRoomStatus || 'open').toLowerCase()}">${state.roomManager.subscription?.xmakerRoomStatus || 'OPEN'}</span>
              </div>
              <button class="btn btn-secondary btn-sm" id="changeXmakerRoomBtn">Ganti Room</button>
            </div>
          `}
        </div>
        
        ${state.roomManager.hasSubscription && state.roomManager.subscription?.xmakerRoomId ? `
        <div class="api-key-section">
          <div class="api-key-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            <span>Xclip API Key</span>
          </div>
          <p class="api-key-desc">Masukkan Xclip API Key untuk generate gambar.</p>
          <div class="api-key-input-group">
            <input type="password" 
              id="xmakerXclipKeyInput" 
              class="api-key-input" 
              placeholder="Masukkan Xclip API Key..."
              value="${state.xmaker.xclipApiKey || ''}"
            >
          </div>
        </div>
        ` : ''}
      </div>
      ` : `
      <div class="room-manager-panel glass-card login-prompt-panel">
        <p>Login untuk menggunakan Room Manager dan fitur generate gambar</p>
        <button class="btn btn-primary" id="loginForXmakerBtn">Login</button>
      </div>
      `}
      
      <div class="xmaker-layout">
        <div class="xmaker-sidebar">
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
              <h3 class="card-title">Pengaturan</h3>
            </div>
            <div class="card-body">
              <div class="setting-group">
                <label class="setting-label">Model AI</label>
                <div class="model-select-mini">
                  ${IMAGE_MODELS.map(model => `
                    <div class="model-option ${model.id === state.xmaker.selectedModel ? 'active' : ''}" data-model="${model.id}">
                      <span class="model-icon">${model.icon}</span>
                      <span>${model.name}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
              
              <div class="setting-group">
                <label class="setting-label">Gaya Gambar</label>
                <div class="style-grid">
                  ${IMAGE_STYLES.map(style => `
                    <div class="style-option ${style.id === state.xmaker.style ? 'active' : ''}" data-style="${style.id}">
                      <span class="style-name">${style.name}</span>
                      <span class="style-desc">${style.desc}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
              
              <div class="setting-group">
                <label class="setting-label">Jumlah Gambar: <span class="count-value">${state.xmaker.imageCount || 1}</span></label>
                <input type="range" id="imageCountSlider" class="slider" min="1" max="15" value="${state.xmaker.imageCount || 1}">
                <p class="setting-hint">Pilih 1-15 gambar yang akan digenerate</p>
              </div>
              
              <div class="setting-group">
                <label class="setting-label">Aspect Ratio</label>
                <div class="aspect-grid">
                  ${['1:1', '16:9', '9:16', '4:3'].map(ratio => `
                    <div class="aspect-option ${ratio === state.xmaker.aspectRatio ? 'active' : ''}" data-ratio="${ratio}">
                      ${ratio}
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="xmaker-main">
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon pulse">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                  <path d="M2 2l7.586 7.586"/>
                  <circle cx="11" cy="11" r="2"/>
                </svg>
              </div>
              <h3 class="card-title">Deskripsi Karakter</h3>
            </div>
            <div class="card-body">
              <div class="reference-upload-section">
                <label class="setting-label">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  Upload Karakter Referensi (Opsional)
                </label>
                <div class="reference-upload-area" id="referenceUploadArea">
                  ${state.xmaker.referenceImage ? `
                    <div class="reference-preview">
                      <img src="${state.xmaker.referenceImage.preview}" alt="Reference">
                      <button class="reference-remove" id="removeReference">×</button>
                      <span class="reference-label">Karakter Referensi</span>
                    </div>
                  ` : `
                    <div class="upload-placeholder">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      <span>Klik untuk upload gambar karakter</span>
                      <span class="upload-hint">Karakter akan konsisten di semua hasil generate</span>
                    </div>
                  `}
                </div>
                <input type="file" id="referenceImageInput" accept="image/*" style="display: none">
              </div>
              
              <div class="character-input-section">
                <label class="setting-label">Deskripsi Scene</label>
                <textarea 
                  id="characterDescription" 
                  class="character-textarea"
                  placeholder="Tulis deskripsi scene yang ingin digenerate.

Contoh:
Karakter wanita cantik dengan rambut panjang, berdiri di taman bunga yang indah, tersenyum bahagia"
                  rows="4"
                >${state.xmaker.characterDescription}</textarea>
                
                <div class="prompt-tips">
                  <div class="tip-item">
                    <span class="tip-icon">💡</span>
                    <span>Semakin detail deskripsi, semakin konsisten hasilnya</span>
                  </div>
                </div>
              </div>
              
              <button class="btn btn-primary btn-full btn-generate" id="generateBtn" ${state.xmaker.isGenerating ? 'disabled' : ''}>
                ${state.xmaker.isGenerating ? `
                  <div class="spinner"></div>
                  <span>Generating...</span>
                ` : `
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                  <span>Generate ${state.xmaker.imageCount || 1} Gambar</span>
                `}
              </button>
            </div>
          </div>
          
          ${state.xmaker.generatedImages.length > 0 ? `
            <div class="card glass-card">
              <div class="card-header">
                <div class="card-icon success">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                </div>
                <h3 class="card-title">Hasil Generate</h3>
                <span class="card-badge">${state.xmaker.generatedImages.length} gambar</span>
              </div>
              <div class="card-body">
                <div class="generated-gallery">
                  ${state.xmaker.generatedImages.map((img, i) => `
                    <div class="gallery-item">
                      <img src="${img.url}" alt="Generated image ${i + 1}">
                      ${img.scene ? `<div class="scene-label">${img.scene.substring(0, 50)}${img.scene.length > 50 ? '...' : ''}</div>` : ''}
                      <div class="gallery-overlay">
                        <a href="${img.url}" download="xmaker-${Date.now()}-${i}.png" class="btn btn-small btn-download">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          Download
                        </a>
                      </div>
                    </div>
                  `).join('')}
                </div>
                
                <button class="btn btn-secondary btn-full" id="clearGallery">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                  Hapus Semua Gambar
                </button>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderVideoGenPage() {
  return `
    <div class="container">
      <div class="hero">
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="23 7 16 12 23 17 23 7"/>
          </svg>
          Image to Video
        </div>
        <h1 class="hero-title">
          <span class="gradient-text">AI Video</span> Generator
        </h1>
        <p class="hero-subtitle">Ubah gambar menjadi video menakjubkan dengan Xclip AI</p>
      </div>
      
      ${state.auth.user ? `
      <div class="room-manager-panel glass-card">
        <div class="room-manager-header">
          <div class="room-manager-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span>Room Manager</span>
          </div>
          ${(state.roomManager.hasSubscription || state.admin.isAdmin) ? `
            <div class="subscription-info">
              <span class="sub-badge active">${state.admin.isAdmin ? 'Admin' : 'Aktif'}</span>
              <span class="sub-time">${state.admin.isAdmin ? 'Unlimited' : formatTimeRemaining(state.roomManager.subscription?.expiredAt)}</span>
            </div>
          ` : ''}
        </div>
        
        <div class="room-manager-content">
          ${(!state.roomManager.hasSubscription && !state.admin.isAdmin) ? `
            <div class="no-subscription">
              <p>Anda belum memiliki paket aktif</p>
              <button class="btn btn-primary" id="buyPackageBtn" ${state.roomManager.isLoading ? 'disabled' : ''}>
                ${state.roomManager.isLoading ? 'Memproses...' : 'Beli Paket 24 Jam'}
              </button>
            </div>
          ` : (state.roomManager.subscription && !state.roomManager.subscription.roomId && !state.admin.isAdmin) ? `
            <div class="select-room-prompt">
              <p>Pilih room untuk mulai generate</p>
              <button class="btn btn-primary" id="openRoomModalBtn">Pilih Room</button>
            </div>
          ` : `
            <div class="current-room">
              <div class="room-info">
                <span class="room-label">Room:</span>
                <span class="room-value">${state.admin.isAdmin ? 'Admin Access' : (state.roomManager.subscription?.roomName || 'Unknown')}</span>
                <span class="room-status-badge status-${(state.roomManager.subscription?.roomStatus || 'open').toLowerCase()}">${state.admin.isAdmin ? 'OPEN' : (state.roomManager.subscription?.roomStatus || 'OPEN')}</span>
              </div>
              <button class="btn btn-secondary btn-sm" id="changeRoomBtn">Ganti Room</button>
            </div>
          `}
        </div>
      </div>
      ` : `
      <div class="room-manager-panel glass-card login-prompt-panel">
        <p>Login untuk menggunakan Room Manager dan fitur subscription</p>
        <button class="btn btn-primary" id="loginForRoomBtn">Login</button>
      </div>
      `}
      
      <div class="xmaker-layout">
        <div class="xmaker-settings">
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
              <h2 class="card-title">Upload Gambar</h2>
            </div>
            <div class="card-body">
              <div class="reference-upload ${state.videogen.sourceImage ? 'has-image' : ''}" id="videoGenUploadZone">
                ${state.videogen.sourceImage ? `
                  <img src="${state.videogen.sourceImage.data}" alt="Source" class="reference-preview">
                  <button class="remove-reference" id="removeVideoGenImage">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                ` : `
                  <div class="reference-placeholder">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>Klik untuk upload gambar</span>
                    <span class="upload-hint">JPG, PNG (max 10MB)</span>
                  </div>
                `}
                <input type="file" id="videoGenImageInput" accept="image/*" style="display: none">
              </div>
            </div>
          </div>
          
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
              <h2 class="card-title">Pengaturan Video</h2>
            </div>
            <div class="card-body">
              <div class="setting-group">
                <label class="setting-label">Model AI</label>
                <div class="model-grid">
                  ${VIDEO_MODELS.map(model => `
                    <div class="model-option ${state.videogen.selectedModel === model.id ? 'active' : ''}" data-videogen-model="${model.id}">
                      <span class="model-icon">${model.icon}</span>
                      <div class="model-info">
                        <span class="model-name">${model.name}</span>
                        <span class="model-desc">${model.desc}</span>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
              
              <div class="setting-group">
                <label class="setting-label">Durasi Video</label>
                <div class="duration-options">
                  <button class="duration-btn ${state.videogen.duration === '5' ? 'active' : ''}" data-videogen-duration="5">5 Detik</button>
                  <button class="duration-btn ${state.videogen.duration === '10' ? 'active' : ''}" data-videogen-duration="10">10 Detik</button>
                </div>
              </div>
              
              <div class="setting-group">
                <label class="setting-label">Aspect Ratio</label>
                <div class="aspect-grid">
                  ${['16:9', '9:16', '1:1'].map(ratio => `
                    <button class="aspect-btn ${state.videogen.aspectRatio === ratio ? 'active' : ''}" data-videogen-ratio="${ratio}">
                      <div class="aspect-preview ${ratio.replace(':', 'x')}"></div>
                      <span>${ratio}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
              
              <div class="character-input-section">
                <label class="setting-label">Prompt Motion (opsional)</label>
                <textarea 
                  id="videoGenPrompt" 
                  class="character-textarea"
                  placeholder="Deskripsikan gerakan yang diinginkan...

Contoh: Rambut bertiup tertiup angin, mata berkedip perlahan, tersenyum"
                  rows="3"
                >${state.videogen.prompt}</textarea>
              </div>
              
              <div class="setting-group" style="margin-top: 16px;">
                <label class="setting-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  Xclip API Key (opsional)
                </label>
                <input 
                  type="password" 
                  id="videoGenApiKey" 
                  class="api-key-input"
                  placeholder="Masukkan Xclip API key Anda..."
                  value="${state.videogen.customApiKey}"
                >
                <p class="setting-hint" style="margin-top:4px;font-size:11px;">Buat Xclip API key di panel "Xclip Keys" untuk akses video generation</p>
              </div>
            </div>
          </div>
          
          <div class="card glass-card">
            <div class="card-body">
              <button class="btn btn-primary btn-full btn-generate" id="generateVideoBtn" ${state.videogen.isGenerating || !state.videogen.sourceImage || state.videogen.tasks.length >= 3 ? 'disabled' : ''}>
                ${state.videogen.isGenerating ? `
                  <div class="btn-loader"></div>
                  <span>Mengirim...</span>
                ` : `
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  <span>Generate Video ${state.videogen.tasks.length > 0 ? `(${state.videogen.tasks.length}/3 aktif)` : ''}</span>
                `}
              </button>
              ${!state.videogen.sourceImage ? '<p class="setting-hint" style="text-align:center;margin-top:8px;">Upload gambar terlebih dahulu</p>' : ''}
              ${state.videogen.tasks.length >= 3 ? '<p class="setting-hint" style="text-align:center;margin-top:8px;color:var(--warning);">Maks 3 video bersamaan. Tunggu salah satu selesai.</p>' : ''}
            </div>
          </div>
        </div>
        
        <div class="xmaker-preview">
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </div>
              <h2 class="card-title">Hasil Video</h2>
            </div>
            <div class="card-body">
              ${state.videogen.tasks.length > 0 ? `
                <div class="active-tasks">
                  <p class="tasks-header">Sedang diproses (${state.videogen.tasks.length}/3):</p>
                  ${state.videogen.tasks.map((task, idx) => `
                    <div class="task-item">
                      <div class="task-info">
                        <span class="task-number">Video ${idx + 1}</span>
                        <span class="task-time">${Math.floor(task.elapsed / 60)}m ${task.elapsed % 60}s</span>
                      </div>
                      <div class="video-progress-bar"></div>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              
              ${state.videogen.generatedVideos.length > 0 ? `
                <div class="generated-videos-list">
                  ${state.videogen.generatedVideos.map((video, idx) => `
                    <div class="video-result">
                      <video src="${video.url}" controls class="generated-video" ${idx === 0 ? 'autoplay' : ''} loop></video>
                      <div class="video-actions">
                        <a href="${video.url}" download="xclip-video-${video.createdAt}.mp4" class="btn btn-primary btn-sm">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          Download
                        </a>
                        <button class="btn btn-secondary btn-sm" onclick="removeGeneratedVideo(${idx})">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                          Hapus
                        </button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : state.videogen.tasks.length === 0 ? `
                <div class="empty-gallery">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <polygon points="23 7 16 12 23 17 23 7"/>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                  </svg>
                  <p>Video yang di-generate akan muncul di sini</p>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function createParticles() {
  const container = document.getElementById('particles');
  if (!container || container.children.length > 0) return;
  
  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.animationDelay = Math.random() * 15 + 's';
    particle.style.animationDuration = (15 + Math.random() * 10) + 's';
    container.appendChild(particle);
  }
}

function renderVideoSection() {
  if (state.isUploading) {
    return `
      <div class="card glass-card fade-in">
        <div class="card-header">
          <div class="card-icon pulse">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <h2 class="card-title">Uploading Video...</h2>
        </div>
        <div class="card-body">
          <div class="upload-progress-container">
            <div class="upload-progress-bar">
              <div class="upload-progress-fill" style="width: ${state.uploadProgress}%"></div>
            </div>
            <div class="upload-progress-info">
              <span class="upload-progress-text">${state.uploadProgress}%</span>
              <span class="upload-status-text">Uploading to server...</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  if (!state.video) {
    return `
      <div class="card glass-card fade-in">
        <div class="card-header">
          <div class="card-icon pulse">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <h2 class="card-title">Upload Video</h2>
        </div>
        <div class="card-body">
          <div class="upload-zone" id="uploadZone">
            <div class="upload-icon-wrapper">
              <div class="upload-icon-bg"></div>
              <div class="upload-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
            </div>
            <h3 class="upload-title">Drop your video here</h3>
            <p class="upload-subtitle">or click to browse files</p>
            <div class="upload-formats">
              <span class="format-badge">MP4</span>
              <span class="format-badge">MOV</span>
              <span class="format-badge">AVI</span>
              <span class="format-badge">MKV</span>
            </div>
            <p class="upload-limit">Maximum file size: 1GB</p>
            <input type="file" id="videoFileInput" accept="video/*" style="display: none">
          </div>
        </div>
      </div>
    `;
  }
  
  return `
    <div class="card glass-card fade-in">
      <div class="card-header">
        <div class="card-icon success">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
            <line x1="7" y1="2" x2="7" y2="22"/>
            <line x1="17" y1="2" x2="17" y2="22"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <line x1="2" y1="7" x2="7" y2="7"/>
            <line x1="2" y1="17" x2="7" y2="17"/>
            <line x1="17" y1="7" x2="22" y2="7"/>
            <line x1="17" y1="17" x2="22" y2="17"/>
          </svg>
        </div>
        <h2 class="card-title">Video Preview</h2>
        <span class="card-badge">Ready</span>
      </div>
      <div class="card-body">
        <div class="video-preview">
          <video id="videoPlayer" controls src="${state.video.url}"></video>
          <div class="video-overlay">
            <div class="play-button">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </div>
          </div>
        </div>
        
        <div class="video-info">
          <div class="video-info-item">
            <div class="video-info-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
            </div>
            <div>
              <div class="video-info-label">Filename</div>
              <div class="video-info-value">${state.video.filename}</div>
            </div>
          </div>
          <div class="video-info-item">
            <div class="video-info-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div>
              <div class="video-info-label">Duration</div>
              <div class="video-info-value">${formatDuration(state.video.metadata?.duration || 0)}</div>
            </div>
          </div>
          <div class="video-info-item">
            <div class="video-info-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            </div>
            <div>
              <div class="video-info-label">Resolution</div>
              <div class="video-info-value">${state.video.metadata?.width || 0}x${state.video.metadata?.height || 0}</div>
            </div>
          </div>
          <div class="video-info-item">
            <div class="video-info-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              </svg>
            </div>
            <div>
              <div class="video-info-label">Size</div>
              <div class="video-info-value">${formatSize(state.video.metadata?.size || 0)}</div>
            </div>
          </div>
        </div>
        
        ${state.status === 'processing' ? `
          <div class="progress-section">
            <div class="progress-header">
              <span class="processing-status-text">${getStatusText(state.statusDetail)}</span>
              <span class="progress-percent">${state.progress}%</span>
            </div>
            <div class="progress-bar">
              <div class="processing-progress-fill" style="width: ${state.progress}%">
                <div class="progress-glow"></div>
              </div>
            </div>
            <div class="progress-steps">
              <div class="step ${state.progress >= 10 ? 'active' : ''}">Extract</div>
              <div class="step ${state.progress >= 25 ? 'active' : ''}">Transcribe</div>
              <div class="step ${state.progress >= 40 ? 'active' : ''}">Analyze</div>
              <div class="step ${state.progress >= 50 ? 'active' : ''}">Generate</div>
              <div class="step ${state.progress >= 100 ? 'active' : ''}">Done</div>
            </div>
          </div>
        ` : ''}
        
        <div style="margin-top: 16px;">
          <button class="btn btn-secondary btn-with-icon" id="changeVideo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Change Video
          </button>
        </div>
      </div>
    </div>
  `;
}

function getStatusText(status) {
  const statusMap = {
    'extracting_audio': 'Extracting audio from video...',
    'transcribing': 'Transcribing speech with AI...',
    'analyzing_viral': 'Analyzing viral potential...',
    'generating_clips': 'Generating your clips...',
    'completed': 'Processing complete!'
  };
  return statusMap[status] || 'Processing your video...';
}

function renderSettingsSection() {
  const isProcessing = state.status === 'processing';
  const hasVideo = !!state.video;
  
  return `
    <div class="card glass-card fade-in sticky-card">
      <div class="card-header">
        <div class="card-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </div>
        <h2 class="card-title">Clip Settings</h2>
      </div>
      <div class="card-body">
        <div class="settings-section">
          <label class="settings-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            Output Resolution
          </label>
          <div class="select-wrapper">
            <select id="resolution" ${isProcessing ? 'disabled' : ''}>
              <option value="1080p" ${state.settings.resolution === '1080p' ? 'selected' : ''}>1080p (Full HD)</option>
              <option value="720p" ${state.settings.resolution === '720p' ? 'selected' : ''}>720p (HD)</option>
              <option value="480p" ${state.settings.resolution === '480p' ? 'selected' : ''}>480p (SD)</option>
            </select>
          </div>
        </div>
        
        <div class="settings-section">
          <label class="settings-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            </svg>
            Aspect Ratio
          </label>
          <div class="aspect-options">
            <div class="aspect-option ${state.settings.aspectRatio === '9:16' ? 'active' : ''}" data-ratio="9:16">
              <div class="aspect-preview" style="width: 22px; height: 40px;"></div>
              <span class="aspect-label">9:16</span>
              <span class="aspect-desc">TikTok</span>
            </div>
            <div class="aspect-option ${state.settings.aspectRatio === '1:1' ? 'active' : ''}" data-ratio="1:1">
              <div class="aspect-preview" style="width: 32px; height: 32px;"></div>
              <span class="aspect-label">1:1</span>
              <span class="aspect-desc">Instagram</span>
            </div>
            <div class="aspect-option ${state.settings.aspectRatio === '4:5' ? 'active' : ''}" data-ratio="4:5">
              <div class="aspect-preview" style="width: 28px; height: 35px;"></div>
              <span class="aspect-label">4:5</span>
              <span class="aspect-desc">Feed</span>
            </div>
            <div class="aspect-option ${state.settings.aspectRatio === '16:9' ? 'active' : ''}" data-ratio="16:9">
              <div class="aspect-preview" style="width: 40px; height: 22px;"></div>
              <span class="aspect-label">16:9</span>
              <span class="aspect-desc">YouTube</span>
            </div>
          </div>
        </div>
        
        <div class="settings-section">
          <label class="settings-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
            </svg>
            Number of Clips
          </label>
          <div class="range-slider">
            <input type="range" id="clipCount" min="1" max="10" value="${state.settings.clipCount}" ${isProcessing ? 'disabled' : ''}>
            <div class="range-track">
              <div class="range-fill" style="width: ${(state.settings.clipCount - 1) / 9 * 100}%"></div>
            </div>
          </div>
          <div class="range-value">
            <span>1</span>
            <span class="range-current">${state.settings.clipCount} clips</span>
            <span>10</span>
          </div>
        </div>
        
        <div class="settings-section">
          <label class="settings-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Clip Duration
          </label>
          <div class="range-slider">
            <input type="range" id="clipDuration" min="15" max="90" step="5" value="${state.settings.clipDuration}" ${isProcessing ? 'disabled' : ''}>
            <div class="range-track">
              <div class="range-fill" style="width: ${(state.settings.clipDuration - 15) / 75 * 100}%"></div>
            </div>
          </div>
          <div class="range-value">
            <span>15s</span>
            <span class="range-current">${state.settings.clipDuration} seconds</span>
            <span>90s</span>
          </div>
        </div>
        
        <div class="settings-section">
          <label class="settings-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Subtitle Language
          </label>
          <p class="settings-description">AI will translate subtitles to your chosen language</p>
          <div class="select-wrapper">
            <select id="targetLanguage" ${isProcessing ? 'disabled' : ''}>
              <option value="original" ${state.settings.targetLanguage === 'original' ? 'selected' : ''}>Original (No Translation)</option>
              <option value="id" ${state.settings.targetLanguage === 'id' ? 'selected' : ''}>Indonesian</option>
              <option value="en" ${state.settings.targetLanguage === 'en' ? 'selected' : ''}>English</option>
              <option value="es" ${state.settings.targetLanguage === 'es' ? 'selected' : ''}>Spanish</option>
              <option value="fr" ${state.settings.targetLanguage === 'fr' ? 'selected' : ''}>French</option>
              <option value="de" ${state.settings.targetLanguage === 'de' ? 'selected' : ''}>German</option>
              <option value="ja" ${state.settings.targetLanguage === 'ja' ? 'selected' : ''}>Japanese</option>
              <option value="ko" ${state.settings.targetLanguage === 'ko' ? 'selected' : ''}>Korean</option>
              <option value="zh" ${state.settings.targetLanguage === 'zh' ? 'selected' : ''}>Chinese</option>
              <option value="ar" ${state.settings.targetLanguage === 'ar' ? 'selected' : ''}>Arabic</option>
              <option value="hi" ${state.settings.targetLanguage === 'hi' ? 'selected' : ''}>Hindi</option>
              <option value="pt" ${state.settings.targetLanguage === 'pt' ? 'selected' : ''}>Portuguese</option>
              <option value="ru" ${state.settings.targetLanguage === 'ru' ? 'selected' : ''}>Russian</option>
            </select>
          </div>
        </div>
        
        <button 
          class="btn btn-primary btn-full btn-glow" 
          id="processBtn"
          ${!hasVideo || isProcessing ? 'disabled' : ''}
        >
          ${isProcessing ? `
            <div class="spinner"></div>
            <span>Processing...</span>
          ` : `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            <span>Generate Viral Clips</span>
          `}
        </button>
      </div>
    </div>
  `;
}

function renderClipsSection() {
  return `
    <div class="card glass-card fade-in" style="margin-top: 24px;">
      <div class="card-header">
        <div class="card-icon success">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
            <circle cx="12" cy="13" r="3"/>
          </svg>
        </div>
        <h2 class="card-title">Generated Clips</h2>
        <span class="card-badge success">${state.clips.length} clips</span>
      </div>
      <div class="card-body">
        <div class="clips-grid">
          ${state.clips.map((clip, index) => `
            <div class="clip-card" style="animation-delay: ${index * 0.1}s">
              <div class="clip-preview">
                <video controls src="${clip.path}"></video>
                <div class="clip-badge viral">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                  </svg>
                  ${Math.round(clip.viralScore)}%
                </div>
                <div class="clip-number">#${clip.id}</div>
              </div>
              <div class="clip-info">
                <div class="clip-header">
                  <h3 class="clip-title">Clip ${clip.id}</h3>
                  <div class="viral-meter">
                    <div class="viral-fill" style="width: ${clip.viralScore}%"></div>
                  </div>
                </div>
                <div class="clip-meta">
                  <span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    ${formatDuration(clip.duration)}
                  </span>
                  <span class="viral-score">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                    </svg>
                    Viral: ${Math.round(clip.viralScore)}%
                  </span>
                </div>
                ${clip.subtitle ? `
                  <div class="clip-subtitle">${clip.subtitle}</div>
                ` : ''}
                <div class="clip-actions">
                  <a href="${clip.path}" download class="btn btn-primary btn-small">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download
                  </a>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function scrollChatToBottom() {
  setTimeout(() => {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }, 100);
}

function attachEventListeners() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentPage = btn.dataset.page;
      render();
    });
  });

  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      state.auth.showModal = true;
      state.auth.modalMode = 'login';
      render();
    });
  }
  
  const userMenuBtn = document.getElementById('userMenuBtn');
  const userDropdown = document.getElementById('userDropdown');
  if (userMenuBtn && userDropdown) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('show');
    });
    
    document.addEventListener('click', () => {
      userDropdown.classList.remove('show');
    });
  }
  
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  
  const manageApiKeyBtn = document.getElementById('manageApiKeyBtn');
  if (manageApiKeyBtn) {
    manageApiKeyBtn.addEventListener('click', () => {
      state.auth.showModal = true;
      state.auth.modalMode = 'apikey';
      render();
    });
  }
  
  const closeAuthModal = document.getElementById('closeAuthModal');
  const authModalOverlay = document.getElementById('authModalOverlay');
  if (closeAuthModal) {
    closeAuthModal.addEventListener('click', () => {
      state.auth.showModal = false;
      render();
    });
  }
  if (authModalOverlay) {
    authModalOverlay.addEventListener('click', (e) => {
      if (e.target === authModalOverlay) {
        state.auth.showModal = false;
        render();
      }
    });
  }
  
  const switchToRegister = document.getElementById('switchToRegister');
  const switchToLogin = document.getElementById('switchToLogin');
  if (switchToRegister) {
    switchToRegister.addEventListener('click', (e) => {
      e.preventDefault();
      state.auth.modalMode = 'register';
      render();
    });
  }
  if (switchToLogin) {
    switchToLogin.addEventListener('click', (e) => {
      e.preventDefault();
      state.auth.modalMode = 'login';
      render();
    });
  }
  
  const authForm = document.getElementById('authForm');
  if (authForm) {
    authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('authEmail').value;
      const password = document.getElementById('authPassword').value;
      
      if (state.auth.modalMode === 'login') {
        handleLogin(email, password);
      } else {
        const username = document.getElementById('authUsername').value;
        handleRegister(username, email, password);
      }
    });
  }
  
  const apiKeyForm = document.getElementById('apiKeyForm');
  if (apiKeyForm) {
    apiKeyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const apiKey = document.getElementById('userApiKey').value;
      handleSaveApiKey(apiKey);
    });
  }
  
  // Room Manager event listeners
  const buyPackageBtn = document.getElementById('buyPackageBtn');
  if (buyPackageBtn) {
    buyPackageBtn.addEventListener('click', buySubscription);
  }
  
  const openRoomModalBtn = document.getElementById('openRoomModalBtn');
  if (openRoomModalBtn) {
    openRoomModalBtn.addEventListener('click', async () => {
      await fetchRooms();
      state.roomManager.showRoomModal = true;
      render();
    });
  }
  
  const changeRoomBtn = document.getElementById('changeRoomBtn');
  if (changeRoomBtn) {
    changeRoomBtn.addEventListener('click', async () => {
      await fetchRooms();
      state.roomManager.showRoomModal = true;
      render();
    });
  }
  
  const loginForRoomBtn = document.getElementById('loginForRoomBtn');
  if (loginForRoomBtn) {
    loginForRoomBtn.addEventListener('click', () => {
      state.auth.showModal = true;
      state.auth.modalMode = 'login';
      render();
    });
  }
  
  const loginForXmakerBtn = document.getElementById('loginForXmakerBtn');
  if (loginForXmakerBtn) {
    loginForXmakerBtn.addEventListener('click', () => {
      state.auth.showModal = true;
      state.auth.modalMode = 'login';
      render();
    });
  }
  
  const buyXmakerPackageBtn = document.getElementById('buyXmakerPackageBtn');
  if (buyXmakerPackageBtn) {
    buyXmakerPackageBtn.addEventListener('click', () => {
      state.pricing.showModal = true;
      render();
    });
  }
  
  const openXmakerRoomModalBtn = document.getElementById('openXmakerRoomModalBtn');
  if (openXmakerRoomModalBtn) {
    openXmakerRoomModalBtn.addEventListener('click', async () => {
      await fetchRooms('xmaker');
      state.roomManager.showXmakerRoomModal = true;
      render();
    });
  }
  
  const changeXmakerRoomBtn = document.getElementById('changeXmakerRoomBtn');
  if (changeXmakerRoomBtn) {
    changeXmakerRoomBtn.addEventListener('click', async () => {
      await fetchRooms('xmaker');
      state.roomManager.showXmakerRoomModal = true;
      render();
    });
  }
  
  const xmakerXclipKeyInput = document.getElementById('xmakerXclipKeyInput');
  if (xmakerXclipKeyInput) {
    xmakerXclipKeyInput.addEventListener('input', (e) => {
      state.xmaker.xclipApiKey = e.target.value;
    });
  }
  
  const closeRoomModal = document.getElementById('closeRoomModal');
  const roomModalOverlay = document.getElementById('roomModalOverlay');
  if (closeRoomModal) {
    closeRoomModal.addEventListener('click', () => {
      state.roomManager.showRoomModal = false;
      render();
    });
  }
  if (roomModalOverlay) {
    roomModalOverlay.addEventListener('click', (e) => {
      if (e.target === roomModalOverlay) {
        state.roomManager.showRoomModal = false;
        render();
      }
    });
  }
  
  document.querySelectorAll('.select-room-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const roomId = parseInt(e.currentTarget.dataset.roomId);
      selectRoom(roomId, 'videogen');
    });
  });
  
  // XMaker Room Modal event listeners
  const closeXmakerRoomModal = document.getElementById('closeXmakerRoomModal');
  const xmakerRoomModalOverlay = document.getElementById('xmakerRoomModalOverlay');
  if (closeXmakerRoomModal) {
    closeXmakerRoomModal.addEventListener('click', () => {
      state.roomManager.showXmakerRoomModal = false;
      render();
    });
  }
  if (xmakerRoomModalOverlay) {
    xmakerRoomModalOverlay.addEventListener('click', (e) => {
      if (e.target === xmakerRoomModalOverlay) {
        state.roomManager.showXmakerRoomModal = false;
        render();
      }
    });
  }
  
  document.querySelectorAll('.select-xmaker-room-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const roomId = parseInt(e.currentTarget.dataset.roomId);
      selectRoom(roomId, 'xmaker');
    });
  });
  
  // Xclip API Keys event listeners
  const openXclipKeysDropdownBtn = document.getElementById('openXclipKeysDropdownBtn');
  if (openXclipKeysDropdownBtn) {
    openXclipKeysDropdownBtn.addEventListener('click', async () => {
      await fetchXclipKeys();
      state.xclipKeys.showModal = true;
      render();
    });
  }
  
  const closeXclipKeysModal = document.getElementById('closeXclipKeysModal');
  const xclipKeysModalOverlay = document.getElementById('xclipKeysModalOverlay');
  if (closeXclipKeysModal) {
    closeXclipKeysModal.addEventListener('click', () => {
      state.xclipKeys.showModal = false;
      render();
    });
  }
  if (xclipKeysModalOverlay) {
    xclipKeysModalOverlay.addEventListener('click', (e) => {
      if (e.target === xclipKeysModalOverlay) {
        state.xclipKeys.showModal = false;
        render();
      }
    });
  }
  
  const createXclipKeyBtn = document.getElementById('createXclipKeyBtn');
  if (createXclipKeyBtn) {
    createXclipKeyBtn.addEventListener('click', () => {
      const labelInput = document.getElementById('newKeyLabel');
      createXclipKey(labelInput?.value || '');
    });
  }
  
  document.querySelectorAll('.copy-key-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const key = e.currentTarget.dataset.key;
      copyToClipboard(key);
    });
  });
  
  document.querySelectorAll('.revoke-key-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const keyId = parseInt(e.currentTarget.dataset.keyId);
      if (confirm('Apakah Anda yakin ingin menonaktifkan API key ini?')) {
        revokeXclipKey(keyId);
      }
    });
  });

  // Feature lock login button
  const openLoginBtn = document.getElementById('openLoginBtn');
  if (openLoginBtn) {
    openLoginBtn.addEventListener('click', () => {
      state.auth.showModal = true;
      state.auth.isLogin = true;
      render();
    });
  }

  // Pricing modal event listeners
  const openPricingBtn = document.getElementById('openPricingBtn');
  if (openPricingBtn) {
    openPricingBtn.addEventListener('click', async () => {
      await fetchSubscriptionPlans();
      state.pricing.showModal = true;
      render();
    });
  }
  
  const closePricingModal = document.getElementById('closePricingModal');
  const pricingModalOverlay = document.getElementById('pricingModalOverlay');
  if (closePricingModal) {
    closePricingModal.addEventListener('click', () => {
      state.pricing.showModal = false;
      render();
    });
  }
  if (pricingModalOverlay) {
    pricingModalOverlay.addEventListener('click', (e) => {
      if (e.target === pricingModalOverlay) {
        state.pricing.showModal = false;
        render();
      }
    });
  }
  
  document.querySelectorAll('.buy-plan-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const planId = parseInt(e.currentTarget.dataset.planId);
      state.pricing.selectedPlan = planId;
      state.payment.selectedPlan = planId;
      state.pricing.showModal = false;
      state.payment.showModal = true;
      state.payment.proofFile = null;
      render();
    });
  });

  // Payment modal event listeners
  const closePaymentModal = document.getElementById('closePaymentModal');
  const paymentModalOverlay = document.getElementById('paymentModalOverlay');
  if (closePaymentModal) {
    closePaymentModal.addEventListener('click', () => {
      state.payment.showModal = false;
      state.payment.proofFile = null;
      render();
    });
  }
  if (paymentModalOverlay) {
    paymentModalOverlay.addEventListener('click', (e) => {
      if (e.target === paymentModalOverlay) {
        state.payment.showModal = false;
        state.payment.proofFile = null;
        render();
      }
    });
  }
  
  const paymentProofInput = document.getElementById('paymentProofInput');
  if (paymentProofInput) {
    paymentProofInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        state.payment.proofFile = file;
        render();
      }
    });
  }
  
  const submitPaymentBtn = document.getElementById('submitPaymentBtn');
  if (submitPaymentBtn) {
    submitPaymentBtn.addEventListener('click', submitPayment);
  }
  
  // My Payments event listeners
  const myPaymentsBtn = document.getElementById('myPaymentsBtn');
  if (myPaymentsBtn) {
    myPaymentsBtn.addEventListener('click', async () => {
      await fetchMyPayments();
      state.payment.pendingPayment = true;
      render();
    });
  }
  
  const closeMyPaymentsModal = document.getElementById('closeMyPaymentsModal');
  const myPaymentsModalOverlay = document.getElementById('myPaymentsModalOverlay');
  if (closeMyPaymentsModal) {
    closeMyPaymentsModal.addEventListener('click', () => {
      state.payment.pendingPayment = null;
      render();
    });
  }
  if (myPaymentsModalOverlay) {
    myPaymentsModalOverlay.addEventListener('click', (e) => {
      if (e.target === myPaymentsModalOverlay) {
        state.payment.pendingPayment = null;
        render();
      }
    });
  }
  
  // Admin dashboard event listeners
  const adminDashboardBtn = document.getElementById('adminDashboardBtn');
  if (adminDashboardBtn) {
    adminDashboardBtn.addEventListener('click', async () => {
      state.currentPage = 'admin';
      await fetchAdminPayments();
      render();
    });
  }
  
  const backToMainBtn = document.getElementById('backToMainBtn');
  if (backToMainBtn) {
    backToMainBtn.addEventListener('click', () => {
      state.currentPage = 'video';
      render();
    });
  }
  
  const refreshAdminPayments = document.getElementById('refreshAdminPayments');
  if (refreshAdminPayments) {
    refreshAdminPayments.addEventListener('click', fetchAdminPayments);
  }
  
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      state.admin.filter = e.currentTarget.dataset.filter;
      fetchAdminPayments();
    });
  });
  
  document.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const paymentId = parseInt(e.currentTarget.dataset.paymentId);
      approvePayment(paymentId);
    });
  });
  
  document.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const paymentId = parseInt(e.currentTarget.dataset.paymentId);
      const reason = prompt('Alasan penolakan (opsional):');
      rejectPayment(paymentId, reason);
    });
  });

  if (state.currentPage === 'video') {
    attachVideoEventListeners();
  } else if (state.currentPage === 'chat') {
    attachChatEventListeners();
  } else if (state.currentPage === 'xmaker') {
    attachXMakerEventListeners();
  } else if (state.currentPage === 'videogen') {
    attachVideoGenEventListeners();
  }
}

function attachVideoEventListeners() {
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('videoFileInput');
  const changeVideo = document.getElementById('changeVideo');
  const processBtn = document.getElementById('processBtn');
  
  if (uploadZone && fileInput) {
    uploadZone.addEventListener('click', () => fileInput.click());
    
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('drag-over');
    });
    
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('drag-over');
    });
    
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('video/')) {
        uploadVideo(file);
      } else {
        showToast('Please upload a valid video file', 'error');
      }
    });
    
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        uploadVideo(file);
      }
    });
  }
  
  if (changeVideo) {
    changeVideo.addEventListener('click', () => {
      state.video = null;
      state.jobId = null;
      state.status = 'idle';
      state.clips = [];
      render();
    });
  }
  
  if (processBtn) {
    processBtn.addEventListener('click', startProcessing);
  }
  
  document.querySelectorAll('.aspect-option').forEach(option => {
    option.addEventListener('click', () => {
      if (state.status !== 'processing') {
        state.settings.aspectRatio = option.dataset.ratio;
        render();
      }
    });
  });
  
  const resolution = document.getElementById('resolution');
  if (resolution) {
    resolution.addEventListener('change', (e) => {
      state.settings.resolution = e.target.value;
    });
  }
  
  const clipCount = document.getElementById('clipCount');
  if (clipCount) {
    clipCount.addEventListener('input', (e) => {
      state.settings.clipCount = parseInt(e.target.value);
      render();
    });
  }
  
  const clipDuration = document.getElementById('clipDuration');
  if (clipDuration) {
    clipDuration.addEventListener('input', (e) => {
      state.settings.clipDuration = parseInt(e.target.value);
      render();
    });
  }
  
  const targetLanguage = document.getElementById('targetLanguage');
  if (targetLanguage) {
    targetLanguage.addEventListener('change', (e) => {
      state.settings.targetLanguage = e.target.value;
    });
  }
}

function attachChatEventListeners() {
  document.querySelectorAll('.model-item').forEach(item => {
    item.addEventListener('click', () => {
      state.chat.selectedModel = item.dataset.model;
      render();
    });
  });
  
  const clearChat = document.getElementById('clearChat');
  if (clearChat) {
    clearChat.addEventListener('click', () => {
      state.chat.messages = [];
      state.chat.attachments = [];
      render();
    });
  }
  
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const attachBtn = document.getElementById('attachBtn');
  const imageBtn = document.getElementById('imageBtn');
  const fileInput = document.getElementById('fileInput');
  const imageInput = document.getElementById('imageInput');
  
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
    });
  }
  
  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
  }
  
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileAttachment);
  }
  
  if (imageBtn && imageInput) {
    imageBtn.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', handleImageAttachment);
  }
  
  document.querySelectorAll('.attachment-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      state.chat.attachments.splice(index, 1);
      render();
    });
  });
}

function attachXMakerEventListeners() {
  document.querySelectorAll('.model-option').forEach(item => {
    item.addEventListener('click', () => {
      state.xmaker.selectedModel = item.dataset.model;
      render();
    });
  });
  
  document.querySelectorAll('.style-option').forEach(item => {
    item.addEventListener('click', () => {
      state.xmaker.style = item.dataset.style;
      render();
    });
  });
  
  document.querySelectorAll('.aspect-option').forEach(item => {
    item.addEventListener('click', () => {
      state.xmaker.aspectRatio = item.dataset.ratio;
      render();
    });
  });
  
  const characterDesc = document.getElementById('characterDescription');
  if (characterDesc) {
    characterDesc.addEventListener('input', (e) => {
      state.xmaker.characterDescription = e.target.value;
    });
  }
  
  const generateBtn = document.getElementById('generateBtn');
  if (generateBtn) {
    generateBtn.addEventListener('click', generateImages);
  }
  
  const imageCountSlider = document.getElementById('imageCountSlider');
  if (imageCountSlider) {
    imageCountSlider.addEventListener('input', (e) => {
      state.xmaker.imageCount = parseInt(e.target.value);
      render();
    });
  }
  
  const clearGallery = document.getElementById('clearGallery');
  if (clearGallery) {
    clearGallery.addEventListener('click', () => {
      state.xmaker.generatedImages = [];
      render();
    });
  }
  
  const referenceUploadArea = document.getElementById('referenceUploadArea');
  const referenceImageInput = document.getElementById('referenceImageInput');
  
  if (referenceUploadArea && referenceImageInput) {
    referenceUploadArea.addEventListener('click', (e) => {
      if (e.target.id !== 'removeReference') {
        referenceImageInput.click();
      }
    });
    
    referenceImageInput.addEventListener('change', handleReferenceUpload);
  }
  
  const removeReference = document.getElementById('removeReference');
  if (removeReference) {
    removeReference.addEventListener('click', (e) => {
      e.stopPropagation();
      state.xmaker.referenceImage = null;
      render();
    });
  }
}

function handleReferenceUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    showToast('Silakan upload file gambar', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    state.xmaker.referenceImage = {
      name: file.name,
      type: file.type,
      data: event.target.result,
      preview: event.target.result
    };
    render();
    showToast('Karakter referensi berhasil diupload!', 'success');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function attachVideoGenEventListeners() {
  const uploadZone = document.getElementById('videoGenUploadZone');
  const fileInput = document.getElementById('videoGenImageInput');
  const removeBtn = document.getElementById('removeVideoGenImage');
  const generateBtn = document.getElementById('generateVideoBtn');
  const promptInput = document.getElementById('videoGenPrompt');
  const clearResult = document.getElementById('clearVideoResult');
  const retryBtn = document.getElementById('retryVideoGen');
  
  if (uploadZone && fileInput) {
    uploadZone.addEventListener('click', (e) => {
      if (!e.target.closest('.remove-reference')) {
        fileInput.click();
      }
    });
    
    fileInput.addEventListener('change', handleVideoGenImageUpload);
  }
  
  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.videogen.sourceImage = null;
      render();
    });
  }
  
  document.querySelectorAll('[data-videogen-model]').forEach(option => {
    option.addEventListener('click', () => {
      state.videogen.selectedModel = option.dataset.videogenModel;
      render();
    });
  });
  
  document.querySelectorAll('[data-videogen-duration]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.videogen.duration = btn.dataset.videogenDuration;
      render();
    });
  });
  
  document.querySelectorAll('[data-videogen-ratio]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.videogen.aspectRatio = btn.dataset.videogenRatio;
      render();
    });
  });
  
  if (promptInput) {
    promptInput.addEventListener('input', (e) => {
      state.videogen.prompt = e.target.value;
    });
  }
  
  const apiKeyInput = document.getElementById('videoGenApiKey');
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (e) => {
      state.videogen.customApiKey = e.target.value;
    });
  }
  
  if (generateBtn) {
    generateBtn.addEventListener('click', generateVideo);
  }
  
  if (clearResult) {
    clearResult.addEventListener('click', () => {
      state.videogen.generatedVideo = null;
      state.videogen.error = null;
      render();
    });
  }
  
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      state.videogen.error = null;
      render();
    });
  }
}

function handleVideoGenImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    showToast('Silakan upload file gambar', 'error');
    return;
  }
  
  if (file.size > 10 * 1024 * 1024) {
    showToast('Ukuran gambar maksimal 10MB', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    state.videogen.sourceImage = {
      name: file.name,
      type: file.type,
      data: event.target.result
    };
    render();
    showToast('Gambar berhasil diupload!', 'success');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

async function generateVideo() {
  if (!state.videogen.sourceImage) {
    showToast('Silakan upload gambar terlebih dahulu', 'error');
    return;
  }
  
  // Admin bypass API key requirement for testing if needed, 
  // but usually they use the room key which is handled by proxy.
  // However, the error here is likely the subscription check.
  
  if (!state.auth.user) {
    showToast('Silakan login terlebih dahulu', 'error');
    state.auth.showModal = true;
    state.auth.modalMode = 'login';
    render();
    return;
  }

  if (!state.roomManager.hasSubscription && !state.admin.isAdmin) {
    showToast('Anda perlu berlangganan untuk generate video', 'error');
    state.pricing.showModal = true;
    render();
    return;
  }
  
  const activeTasks = state.videogen.tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
  if (activeTasks.length >= 3) {
    showToast('Maksimal 3 video dapat diproses bersamaan. Tunggu salah satu selesai.', 'error');
    return;
  }
  
  state.videogen.isGenerating = true;
  state.videogen.error = null;
  render();
  
  try {
    const requestBody = {
      model: state.videogen.selectedModel,
      image: state.videogen.sourceImage.data,
      prompt: state.videogen.prompt || 'Gentle motion, natural movement',
      duration: state.videogen.duration,
      aspectRatio: state.videogen.aspectRatio
    };
    
    const headers = { 
      'Content-Type': 'application/json',
      'X-Xclip-Key': state.videogen.customApiKey
    };
    
    const response = await fetch(`${API_URL}/api/videogen/proxy`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate video');
    }
    
    const data = await response.json();
    
    if (data.taskId) {
      const newTask = {
        taskId: data.taskId,
        model: data.model || state.videogen.selectedModel,
        status: 'processing',
        elapsed: 0,
        videoUrl: null,
        createdAt: Date.now()
      };
      state.videogen.tasks.push(newTask);
      state.videogen.isGenerating = false;
      render();
      pollVideoStatus(data.taskId, newTask.model);
      showToast('Video sedang diproses. Anda bisa generate video lagi (maks 3).', 'success');
    } else if (data.videoUrl) {
      state.videogen.generatedVideos.unshift({ url: data.videoUrl, createdAt: Date.now() });
      // Video not persisted to localStorage
      state.videogen.isGenerating = false;
      showToast('Video berhasil di-generate!', 'success');
      render();
    }
    
  } catch (error) {
    console.error('Generate video error:', error);
    state.videogen.error = error.message;
    state.videogen.isGenerating = false;
    showToast('Gagal generate video: ' + error.message, 'error');
    render();
  }
}

async function pollVideoStatus(taskId, model) {
  const maxAttempts = 300; // ~15 minutes with aggressive polling
  let attempts = 0;
  const startTime = Date.now();
  
  const poll = async () => {
    try {
      const task = state.videogen.tasks.find(t => t.taskId === taskId);
      if (!task) return;
      
      const headers = { 
        'Content-Type': 'application/json',
        'X-Xclip-Key': state.videogen.customApiKey || state.xmaker.xclipApiKey
      };
      
      const response = await fetch(`${API_URL}/api/videogen/tasks/${taskId}?model=${encodeURIComponent(model)}`, {
        method: 'GET',
        headers: headers
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.warn('Polling error response:', errorData);
        if (response.status >= 500 && attempts < maxAttempts) {
          attempts++;
          setTimeout(poll, 5000);
          return;
        }
      }
      
      const data = await response.json();
      
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      task.elapsed = elapsedSec;
      
      // Check for completion FIRST (priority)
      const isCompleted = data.status === 'completed' || data.status === 'COMPLETED';
      if (isCompleted && data.videoUrl) {
        task.status = 'completed';
        task.videoUrl = data.videoUrl;
        state.videogen.generatedVideos.unshift({ url: data.videoUrl, createdAt: Date.now(), taskId });
        state.videogen.tasks = state.videogen.tasks.filter(t => t.taskId !== taskId);
        showToast('Video berhasil di-generate!', 'success');
        render();
        return;
      }
      
      // Check for failure
      if (data.status === 'failed' || data.status === 'FAILED') {
        throw new Error(data.error || 'Video generation failed');
      }
      
      // Update progress display (minimal re-renders)
      const newProgress = data.progress || Math.min(95, Math.floor(elapsedSec / 3));
      if (task.status !== 'processing' || Math.abs((task.progress || 0) - newProgress) >= 20) {
        task.status = 'processing';
        task.progress = newProgress;
        if (state.currentPage === 'videogen') {
          render();
        }
      }
      
      attempts++;
      if (attempts < maxAttempts) {
        // Aggressive polling: 2s for first 60 attempts (~2 min), then 3s
        const nextInterval = attempts < 60 ? 2000 : 3000;
        setTimeout(poll, nextInterval);
      } else {
        throw new Error('Timeout: Video generation took too long (15+ menit)');
      }
      
    } catch (error) {
      const task = state.videogen.tasks.find(t => t.taskId === taskId);
      if (task) {
        task.status = 'failed';
        task.error = error.message;
      }
      state.videogen.tasks = state.videogen.tasks.filter(t => t.taskId !== taskId);
      showToast('Gagal generate video: ' + error.message, 'error');
      render();
    }
  };
  
  // Start polling immediately (1 second delay)
  setTimeout(poll, 1000);
}

function removeGeneratedVideo(index) {
  state.videogen.generatedVideos.splice(index, 1);
  render();
}

function saveGeneratedVideosToStorage() {
  try {
    localStorage.setItem('xclip_generated_videos', JSON.stringify(state.videogen.generatedVideos));
  } catch (e) {
    console.log('Failed to save videos to localStorage:', e);
  }
}

function loadGeneratedVideosFromStorage() {
  try {
    const saved = localStorage.getItem('xclip_generated_videos');
    if (saved) {
      const videos = JSON.parse(saved);
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      state.videogen.generatedVideos = videos.filter(v => v.createdAt > oneHourAgo);
      if (state.videogen.generatedVideos.length !== videos.length) {
        // Video not persisted to localStorage
      }
    }
  } catch (e) {
    console.log('Failed to load videos from localStorage:', e);
  }
}

window.removeGeneratedVideo = removeGeneratedVideo;

async function generateImages() {
  const description = state.xmaker.characterDescription.trim();
  
  if (!description && !state.xmaker.referenceImage) {
    showToast('Silakan upload karakter referensi atau masukkan deskripsi', 'error');
    return;
  }
  
  if (!state.auth.user) {
    showToast('Silakan login terlebih dahulu', 'error');
    state.auth.showModal = true;
    state.auth.modalMode = 'login';
    render();
    return;
  }
  
  if (!state.roomManager.hasSubscription && !state.admin.isAdmin) {
    showToast('Anda perlu berlangganan untuk generate gambar', 'error');
    state.pricing.showModal = true;
    render();
    return;
  }
  
  if (!state.xmaker.xclipApiKey) {
    showToast('Masukkan Xclip API Key terlebih dahulu', 'error');
    return;
  }
  
  state.xmaker.isGenerating = true;
  render();
  
  try {
    const response = await fetch(`${API_URL}/api/generate-image`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Xclip-Key': state.xmaker.xclipApiKey
      },
      credentials: 'include',
      body: JSON.stringify({
        model: state.xmaker.selectedModel,
        prompt: description || 'portrait shot',
        imageCount: state.xmaker.imageCount || 1,
        style: state.xmaker.style,
        aspectRatio: state.xmaker.aspectRatio,
        referenceImage: state.xmaker.referenceImage ? state.xmaker.referenceImage.data : null
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to generate images');
    }
    
    const data = await response.json();
    
    state.xmaker.generatedImages = [...state.xmaker.generatedImages, ...data.images];
    showToast(`Berhasil generate ${data.images.length} gambar!`, 'success');
    
  } catch (error) {
    console.error('Generate error:', error);
    showToast('Gagal generate gambar: ' + error.message, 'error');
  }
  
  state.xmaker.isGenerating = false;
  render();
}

function handleFileAttachment(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      state.chat.attachments.push({
        name: file.name,
        type: file.type,
        size: file.size,
        data: event.target.result,
        preview: file.type.startsWith('image/') ? event.target.result : null
      });
      render();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
}

function handleImageAttachment(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      state.chat.attachments.push({
        name: file.name,
        type: file.type,
        size: file.size,
        data: event.target.result,
        preview: event.target.result
      });
      render();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
}

async function sendMessage() {
  const chatInput = document.getElementById('chatInput');
  const content = chatInput?.value?.trim();
  
  if (!content && state.chat.attachments.length === 0) return;
  
  const userMessage = {
    role: 'user',
    content: content || 'Analyze these attachments',
    timestamp: Date.now(),
    attachments: [...state.chat.attachments]
  };
  
  state.chat.messages.push(userMessage);
  state.chat.attachments = [];
  state.chat.isLoading = true;
  
  render();
  scrollChatToBottom();
  
  try {
    const response = await fetch(`${API_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.chat.selectedModel,
        messages: state.chat.messages.map(m => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments?.map(a => ({
            type: a.type,
            data: a.data,
            name: a.name
          }))
        }))
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to get response');
    }
    
    const data = await response.json();
    
    state.chat.messages.push({
      role: 'assistant',
      content: data.content,
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('Chat error:', error);
    state.chat.messages.push({
      role: 'assistant',
      content: 'Maaf, terjadi kesalahan. Silakan coba lagi.',
      timestamp: Date.now()
    });
    showToast('Failed to get response', 'error');
  }
  
  state.chat.isLoading = false;
  render();
  scrollChatToBottom();
}

async function uploadVideo(file) {
  if (file.size > 1024 * 1024 * 1024) {
    showToast('File size exceeds 1GB limit', 'error');
    return;
  }
  
  const formData = new FormData();
  formData.append('video', file);
  
  state.uploadProgress = 0;
  state.isUploading = true;
  render();
  
  try {
    const xhr = new XMLHttpRequest();
    
    const uploadPromise = new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          state.uploadProgress = Math.round((e.loaded / e.total) * 100);
          updateUploadProgressUI();
        }
      });
      
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(xhr.responseText || 'Upload failed'));
        }
      });
      
      xhr.addEventListener('error', () => reject(new Error('Upload failed')));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
    });
    
    xhr.open('POST', `${API_URL}/api/upload`);
    xhr.send(formData);
    
    const data = await uploadPromise;
    
    state.video = {
      url: data.videoUrl,
      filename: data.filename,
      metadata: data.metadata
    };
    state.jobId = data.jobId;
    state.status = 'uploaded';
    state.isUploading = false;
    state.uploadProgress = 0;
    
    showToast('Video uploaded successfully!', 'success');
    render();
  } catch (error) {
    console.error('Upload error:', error);
    state.isUploading = false;
    state.uploadProgress = 0;
    showToast('Failed to upload video: ' + error.message, 'error');
    render();
  }
}

function updateUploadProgressUI() {
  const progressBar = document.querySelector('.upload-progress-fill');
  const progressText = document.querySelector('.upload-progress-text');
  if (progressBar) {
    progressBar.style.width = `${state.uploadProgress}%`;
  }
  if (progressText) {
    progressText.textContent = `${state.uploadProgress}%`;
  }
}

async function startProcessing() {
  if (!state.jobId) return;
  
  state.status = 'processing';
  state.progress = 0;
  state.clips = [];
  render();
  
  try {
    await fetch(`${API_URL}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: state.jobId,
        settings: state.settings
      })
    });
    
    pollJobStatus();
  } catch (error) {
    console.error('Processing error:', error);
    state.status = 'error';
    showToast('Failed to start processing', 'error');
    render();
  }
}

async function pollJobStatus() {
  try {
    const response = await fetch(`${API_URL}/api/job/${state.jobId}`);
    const data = await response.json();
    
    const prevProgress = state.progress;
    const prevStatus = state.statusDetail;
    
    state.progress = data.progress;
    state.statusDetail = data.status;
    
    if (data.status === 'completed') {
      state.status = 'completed';
      state.clips = data.clips;
      showToast('Clips generated successfully!', 'success');
      render();
    } else if (data.status === 'error') {
      state.status = 'error';
      showToast(data.error || 'Processing failed', 'error');
      render();
    } else {
      if (prevProgress !== data.progress || prevStatus !== data.status) {
        updateProcessingProgressUI();
      }
      setTimeout(pollJobStatus, 2000);
    }
  } catch (error) {
    console.error('Polling error:', error);
    setTimeout(pollJobStatus, 3000);
  }
}

function updateProcessingProgressUI() {
  const progressFill = document.querySelector('.processing-progress-fill');
  const progressPercent = document.querySelector('.progress-percent');
  const statusText = document.querySelector('.processing-status-text');
  
  if (progressFill) {
    progressFill.style.width = `${state.progress}%`;
  }
  if (progressPercent) {
    progressPercent.textContent = `${state.progress}%`;
  }
  if (statusText) {
    const statusMap = {
      'extracting_audio': 'Extracting audio...',
      'transcribing': 'Transcribing speech...',
      'analyzing_viral': 'Analyzing viral potential...',
      'selecting_clips': 'Selecting best clips...',
      'processing_clips': 'Processing clips...',
      'adding_subtitles': 'Adding subtitles...'
    };
    statusText.textContent = statusMap[state.statusDetail] || state.statusDetail;
  }
}

// ============ SSE for Real-Time Video Updates ============
let sseConnection = null;

function connectSSE() {
  if (sseConnection) {
    sseConnection.close();
  }
  
  if (!state.auth.user) {
    return;
  }
  
  console.log('Connecting to SSE for real-time video updates...');
  
  sseConnection = new EventSource(`${API_URL}/api/video-events`, { withCredentials: true });
  
  sseConnection.onopen = () => {
    console.log('SSE connected!');
  };
  
  sseConnection.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSSEEvent(data);
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };
  
  sseConnection.onerror = (error) => {
    console.error('SSE error:', error);
    // Reconnect after 5 seconds
    setTimeout(() => {
      if (state.auth.user) {
        connectSSE();
      }
    }, 5000);
  };
}

function disconnectSSE() {
  if (sseConnection) {
    sseConnection.close();
    sseConnection = null;
    console.log('SSE disconnected');
  }
}

// Video results will be cleared on page refresh (not persisted)
// checkAuth will be called below after SSE setup

function handleSSEEvent(data) {
  console.log('SSE event received:', data);
  
  switch (data.type) {
    case 'connected':
      console.log('SSE connected for user:', data.userId);
      break;
      
    case 'video_completed':
      // Instantly update UI when video is ready
      const completedTask = state.videogen.tasks.find(t => t.taskId === data.taskId);
      if (completedTask) {
        completedTask.status = 'completed';
        completedTask.videoUrl = data.videoUrl;
        state.videogen.generatedVideos.unshift({ 
          url: data.videoUrl, 
          createdAt: Date.now(), 
          taskId: data.taskId 
        });
        state.videogen.tasks = state.videogen.tasks.filter(t => t.taskId !== data.taskId);
        showToast('Video berhasil di-generate! (via webhook)', 'success');
        render();
      }
      break;
      
    case 'video_failed':
      const failedTask = state.videogen.tasks.find(t => t.taskId === data.taskId);
      if (failedTask) {
        failedTask.status = 'failed';
        failedTask.error = data.error;
        state.videogen.tasks = state.videogen.tasks.filter(t => t.taskId !== data.taskId);
        showToast('Gagal generate video: ' + data.error, 'error');
        render();
      }
      break;
      
    case 'video_progress':
      const progressTask = state.videogen.tasks.find(t => t.taskId === data.taskId);
      if (progressTask && data.progress) {
        progressTask.progress = data.progress;
        progressTask.status = data.status || 'processing';
        // Don't render on every progress update to avoid glitches
      }
      break;
      
    case 'ping':
      // Keep-alive ping, ignore
      break;
      
    default:
      console.log('Unknown SSE event type:', data.type);
  }
}

// Disconnect SSE on page unload
window.addEventListener('beforeunload', () => {
  disconnectSSE();
});

// Wrap checkAuth to connect SSE after auth is verified
async function initApp() {
  await checkAuth();
  // Connect SSE after auth check completes
  if (state.auth.user) {
    connectSSE();
  }
}

// Start the app
initApp();
