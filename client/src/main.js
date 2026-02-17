const API_URL = '';

// Debounce render to prevent too many updates
let renderTimeout = null;
let lastRenderTime = 0;
const RENDER_THROTTLE = 150; // ms - increased for better performance

// Countdown timer for subscription
let countdownInterval = null;

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
  videogen: {
    sourceImage: null,
    prompt: '',
    selectedModel: 'kling-pro',
    duration: '5',
    aspectRatio: '16:9',
    isGenerating: false,
    isPolling: false,
    tasks: [],
    generatedVideos: [],
    error: null,
    customApiKey: ''
  },
  motion: {
    characterImage: null,
    referenceVideo: null,
    prompt: '',
    selectedModel: 'kling-v2.6-pro',
    characterOrientation: 'video',
    isGenerating: false,
    isPolling: false,
    tasks: [],
    generatedVideos: [],
    error: null,
    customApiKey: '',
    selectedRoom: 1,
    roomUsage: { 1: 0, 2: 0, 3: 0 }
  },
  roomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
  },
  motionRoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
  },
  vidgen2: {
    sourceImage: null,
    prompt: '',
    selectedModel: 'sora-2-10s',
    aspectRatio: '16:9',
    grokMode: 'normal',
    isGenerating: false,
    isPolling: false,
    tasks: [],
    generatedVideos: [],
    error: null,
    customApiKey: '',
    selectedRoom: null,
    cooldownEndTime: parseInt(localStorage.getItem('vidgen2_cooldown') || '0'),
    cooldownRemaining: 0
  },
  vidgen2RoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
  },
  vidgen3: {
    sourceImage: null,
    audioFile: null,
    prompt: '',
    selectedModel: 'seedance-1.5-pro-1080p',
    aspectRatio: 'widescreen_16_9',
    duration: 5,
    resolution: '1080p',
    fps: 25,
    generateAudio: true,
    cameraFixed: false,
    turboMode: false,
    ratio: '1280:720',
    isGenerating: false,
    isPolling: false,
    tasks: [],
    generatedVideos: [],
    error: null,
    customApiKey: '',
    selectedRoom: null,
    cooldownEndTime: parseInt(localStorage.getItem('vidgen3_cooldown') || '0'),
    cooldownRemaining: 0
  },
  vidgen3RoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
  },
  vidgen4: {
    sourceImage: null,
    startFrame: null,
    endFrame: null,
    generationType: 'reference',
    prompt: '',
    selectedModel: 'sora-2',
    aspectRatio: '16:9',
    duration: 10,
    resolution: '720p',
    watermark: false,
    thumbnail: false,
    isPrivate: false,
    style: 'none',
    storyboard: false,
    enableGif: false,
    isGenerating: false,
    isPolling: false,
    tasks: [],
    generatedVideos: [],
    error: null,
    customApiKey: '',
    selectedRoom: null,
    cooldownEndTime: parseInt(localStorage.getItem('vidgen4_cooldown') || '0'),
    cooldownRemaining: 0,
    _historyLoaded: false
  },
  vidgen4RoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
  },
  ximageRoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
  },
  ximage: {
    sourceImage: null,
    sourceImage2: null,
    prompt: '',
    selectedModel: 'gpt-image-1.5',
    aspectRatio: '1:1',
    mode: 'text-to-image',
    isGenerating: false,
    isPolling: false,
    tasks: [],
    generatedImages: [],
    error: null,
    customApiKey: '',
    selectedRoom: null,
    models: [],
    _historyLoaded: false,
    resolution: '1K',
    numberOfImages: 1
  },
  ximageRoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
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
  },
  xmaker: {
    selectedModel: 'nano-banana',
    style: 'photorealistic',
    aspectRatio: '1:1',
    referenceImage: null,
    scenes: [{ id: 1, description: '' }],
    generatedImages: [],
    isGenerating: false,
    currentSceneIndex: 0,
    multiSceneMode: false
  },
  xmakerRoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
  }
};

const PERSIST_KEYS = {
  vidgen2: ['prompt', 'selectedModel', 'aspectRatio', 'grokMode', 'customApiKey'],
  vidgen3: ['prompt', 'selectedModel', 'aspectRatio', 'duration', 'resolution', 'fps', 'generateAudio', 'cameraFixed', 'turboMode', 'ratio', 'customApiKey'],
  videogen: ['prompt', 'selectedModel', 'duration', 'aspectRatio', 'customApiKey'],
  motion: ['prompt', 'selectedModel', 'characterOrientation'],
  ximage: ['prompt', 'selectedModel', 'aspectRatio', 'mode', 'customApiKey', 'resolution', 'numberOfImages'],
  xmaker: ['selectedModel', 'style', 'aspectRatio', 'multiSceneMode'],
  chat: ['selectedModel'],
  vidgen2RoomManager: ['xclipApiKey'],
  vidgen3RoomManager: ['xclipApiKey'],
  vidgen4: ['prompt', 'selectedModel', 'aspectRatio', 'duration', 'resolution', 'watermark', 'thumbnail', 'isPrivate', 'style', 'storyboard', 'enableGif', 'generationType', 'customApiKey'],
  vidgen4RoomManager: ['xclipApiKey'],
  xmakerRoomManager: ['xclipApiKey'],
  ximageRoomManager: ['xclipApiKey'],
  motionRoomManager: ['xclipApiKey']
};

function saveUserInputs(section) {
  const keys = PERSIST_KEYS[section];
  if (!keys || !state[section]) return;
  const data = {};
  keys.forEach(k => {
    if (state[section][k] !== undefined && state[section][k] !== null) {
      data[k] = state[section][k];
    }
  });
  try {
    localStorage.setItem('xclip_inputs_' + section, JSON.stringify(data));
  } catch (e) {}
}

function restoreAllUserInputs() {
  Object.keys(PERSIST_KEYS).forEach(section => {
    try {
      const saved = localStorage.getItem('xclip_inputs_' + section);
      if (saved && state[section]) {
        const data = JSON.parse(saved);
        PERSIST_KEYS[section].forEach(k => {
          if (data[k] !== undefined) {
            state[section][k] = data[k];
          }
        });
      }
    } catch (e) {}
  });
}

restoreAllUserInputs();

const MOTION_MODELS = [
  { id: 'kling-v2.6-pro', name: 'Kling V2.6 Pro Motion', desc: 'Transfer motion berkualitas tinggi', icon: '🔥' },
  { id: 'kling-v2.6-std', name: 'Kling V2.6 Std Motion', desc: 'Transfer motion hemat biaya', icon: '💰' }
];

const VIDEO_MODELS = [
  { id: 'kling-v2.6-pro', name: 'Kling V2.6 Pro', desc: '1080p HD + Audio, model terbaru', icon: '🔥' },
  { id: 'kling-o1-pro', name: 'Kling O1 Pro', desc: 'Model AI terbaru, premium', icon: '🧠' },
  { id: 'kling-o1-std', name: 'Kling O1 Std', desc: 'Model AI baru, hemat', icon: '💡' },
  { id: 'kling-v2.5-pro', name: 'Kling V2.5 Pro', desc: '1080p HD, kualitas terbaik', icon: '👑' },
  { id: 'kling-v2.1-master', name: 'Kling V2.1 Master', desc: 'Kontrol motion lanjutan', icon: '🎬' },
  { id: 'kling-v2.1-pro', name: 'Kling V2.1 Pro', desc: 'Kualitas profesional', icon: '⭐' },
  { id: 'kling-v2.1-std', name: 'Kling V2.1 Std', desc: 'Budget friendly', icon: '💰' },
  { id: 'kling-elements-pro', name: 'Kling Elements Pro', desc: 'Kontrol elemen detail', icon: '🎨' },
  { id: 'kling-elements-std', name: 'Kling Elements Std', desc: 'Kontrol elemen hemat', icon: '🖌️' },
  { id: 'kling-v1.6-pro', name: 'Kling 1.6 Pro', desc: 'Model stabil klasik', icon: '🌟' },
  { id: 'wan-v2.6-1080p', name: 'Wan V2.6 1080p', desc: 'Model terbaru Alibaba, 1080p HD', icon: '🐉' },
  { id: 'wan-v2.6-720p', name: 'Wan V2.6 720p', desc: 'Model terbaru Alibaba, cepat', icon: '🐲' },
  { id: 'wan-v2.2-720p', name: 'Wan V2.2 720p', desc: 'Model Alibaba HD', icon: '🦎' },
  { id: 'wan-v2.2-580p', name: 'Wan V2.2 580p', desc: 'Model Alibaba cepat', icon: '🦕' },
  { id: 'wan-v2.2-480p', name: 'Wan V2.2 480p', desc: 'Model Alibaba hemat', icon: '🐍' },
  { id: 'minimax-hailuo-2.3-1080p', name: 'MiniMax Hailuo 2.3 1080p', desc: 'Terbaru HD + Audio', icon: '🔊' },
  { id: 'minimax-hailuo-2.3-1080p-fast', name: 'MiniMax Hailuo 2.3 Fast', desc: 'HD cepat + Audio', icon: '⚡' },
  { id: 'minimax-hailuo-2.3-768p-fast', name: 'MiniMax Hailuo 2.3 768p', desc: 'Cepat + Audio', icon: '🔉' },
  { id: 'minimax-hailuo-1080p', name: 'MiniMax Hailuo 1080p', desc: 'HD dengan audio', icon: '🎵' },
  { id: 'minimax-hailuo-768p', name: 'MiniMax Hailuo 768p', desc: 'Standar dengan audio', icon: '🎶' },
  { id: 'seedance-pro-1080p', name: 'Seedance Pro 1080p', desc: 'Durasi panjang HD', icon: '🌱' },
  { id: 'seedance-pro-720p', name: 'Seedance Pro 720p', desc: 'Keseimbangan kualitas', icon: '🌿' },
  { id: 'pixverse-v5', name: 'PixVerse V5', desc: 'Efek transisi', icon: '✨' }
];

const IMAGE_MODELS = [
  { id: 'nano-banana', name: 'Nano Banana', provider: 'GeminiGen AI', icon: '🍌', desc: 'Gratis, tercepat, support Image Reference', supportsReference: true },
  { id: 'imagen-4-fast', name: 'Imagen 4 Fast', provider: 'GeminiGen AI', icon: '⚡', desc: 'Cepat dengan detail bagus' },
  { id: 'imagen-4', name: 'Imagen 4 Standard', provider: 'GeminiGen AI', icon: '🎨', desc: 'Kualitas seimbang untuk semua kebutuhan' },
  { id: 'imagen-4-ultra', name: 'Imagen 4 Ultra', provider: 'GeminiGen AI', icon: '👑', desc: 'Kualitas tertinggi, 2K resolution, text rendering' }
];

const IMAGE_STYLES = [
  { id: 'photorealistic', name: 'Fotorealistis', desc: 'Foto nyata berkualitas tinggi' },
  { id: 'anime', name: 'Anime', desc: 'Gaya ilustrasi Jepang' },
  { id: 'cinematic', name: 'Sinematik', desc: 'Seperti adegan film Hollywood' },
  { id: 'digital-art', name: 'Digital Art', desc: 'Ilustrasi digital modern' },
  { id: '3d-render', name: '3D Render', desc: 'Gaya render 3D realistis' },
  { id: 'oil-painting', name: 'Lukisan Minyak', desc: 'Gaya lukisan klasik' },
  { id: 'watercolor', name: 'Cat Air', desc: 'Gaya cat air artistik' },
  { id: 'sketch', name: 'Sketsa', desc: 'Gaya sketsa pensil' },
  { id: 'fantasy', name: 'Fantasi', desc: 'Magis dan imajinatif' },
  { id: 'cyberpunk', name: 'Cyberpunk', desc: 'Futuristik neon' }
];

const ASPECT_RATIOS = [
  { id: '1:1', name: '1:1', desc: 'Persegi' },
  { id: '16:9', name: '16:9', desc: 'Landscape lebar' },
  { id: '9:16', name: '9:16', desc: 'Portrait/Story' },
  { id: '4:3', name: '4:3', desc: 'Landscape standar' },
  { id: '3:4', name: '3:4', desc: 'Portrait standar' },
  { id: '3:2', name: '3:2', desc: 'Foto landscape' },
  { id: '2:3', name: '2:3', desc: 'Foto portrait' },
  { id: '21:9', name: '21:9', desc: 'Ultrawide/Cinematic' }
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
      // Load essential data first, then others in background
      // Use .finally() so other fetches run even if subscription fails
      fetchSubscriptionStatus().finally(() => {
        fetchSubscriptionPlans();
        fetchRooms();
        fetchXclipKeys();
        checkAdminStatus();
        loadMotionSubscriptionStatus();
        loadMotionRoomUsage();
      });
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
  }, 15000 + Math.random() * 15000);
  
  setTimeout(() => {
    showRandomPurchaseAnimation();
  }, 8000);
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
    state.roomManager.currentRoom = null;
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
      saveUserInputs('videogen');
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

async function fetchRooms() {
  try {
    const response = await fetch(`${API_URL}/api/rooms`, { credentials: 'include' });
    const data = await response.json();
    state.roomManager.rooms = data.rooms || [];
  } catch (error) {
    console.error('Fetch rooms error:', error);
  }
}

async function fetchSubscriptionStatus() {
  try {
    const response = await fetch(`${API_URL}/api/subscription/status`, { credentials: 'include' });
    if (!response.ok) {
      state.roomManager.hasSubscription = false;
      state.roomManager.subscription = null;
      state.pricing.remainingSeconds = 0;
      return;
    }
    const data = await response.json();
    state.roomManager.hasSubscription = data.hasSubscription || false;
    state.roomManager.subscription = data.subscription || null;
    if (data.subscription?.remainingSeconds) {
      state.pricing.remainingSeconds = data.subscription.remainingSeconds;
      startCountdownTimer();
    } else {
      state.pricing.remainingSeconds = 0;
    }
  } catch (error) {
    // Only log actual errors, not network timeouts during SSE reconnection
    if (error && error.message) {
      console.error('Fetch subscription error:', error.message);
    }
    state.roomManager.hasSubscription = false;
    state.roomManager.subscription = null;
    state.pricing.remainingSeconds = 0;
  }
}


async function fetchSubscriptionPlans() {
  try {
    const response = await fetch(`${API_URL}/api/subscription/plans`, { credentials: 'include' });
    if (!response.ok) return;
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

// ==================== MOTION ROOM MANAGER FUNCTIONS ====================

async function loadMotionRooms() {
  try {
    state.motionRoomManager.isLoading = true;
    render();
    
    const response = await fetch(`${API_URL}/api/motion/rooms`, { credentials: 'include' });
    const data = await response.json();
    state.motionRoomManager.rooms = data.rooms || [];
  } catch (error) {
    console.error('Load motion rooms error:', error);
    state.motionRoomManager.rooms = [];
  } finally {
    state.motionRoomManager.isLoading = false;
    render();
  }
}

async function loadMotionSubscriptionStatus() {
  try {
    const response = await fetch(`${API_URL}/api/motion/subscription/status`, { credentials: 'include' });
    if (!response.ok) {
      state.motionRoomManager.hasSubscription = false;
      state.motionRoomManager.subscription = null;
      return;
    }
    const data = await response.json();
    state.motionRoomManager.hasSubscription = data.hasSubscription || false;
    state.motionRoomManager.subscription = data.subscription || null;
  } catch (error) {
    console.error('Load motion subscription error:', error);
    state.motionRoomManager.hasSubscription = false;
    state.motionRoomManager.subscription = null;
  }
}

async function loadMotionRoomUsage() {
  try {
    const response = await fetch(`${API_URL}/api/motion/room-usage`, { credentials: 'include' });
    const data = await response.json();
    if (data.usage) {
      state.motion.roomUsage = data.usage;
      render();
    }
  } catch (error) {
    console.error('Load motion room usage error:', error);
  }
}

async function joinMotionRoom(roomId) {
  const apiKey = state.motionRoomManager.xclipApiKey;
  
  if (!apiKey) {
    showToast('Masukkan Xclip API key terlebih dahulu', 'error');
    return;
  }
  
  try {
    state.motionRoomManager.isLoading = true;
    render();
    
    const response = await fetch(`${API_URL}/api/motion/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ xclipApiKey: apiKey })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(data.message || 'Berhasil bergabung ke motion room!', 'success');
      state.motionRoomManager.showRoomModal = false;
      await loadMotionSubscriptionStatus();
      await loadMotionRooms();
    } else {
      showToast(data.error || 'Gagal bergabung ke room', 'error');
    }
  } catch (error) {
    console.error('Join motion room error:', error);
    showToast('Gagal bergabung ke room', 'error');
  } finally {
    state.motionRoomManager.isLoading = false;
    render();
  }
}

async function leaveMotionRoom() {
  const apiKey = state.motionRoomManager.xclipApiKey;
  
  if (!apiKey) {
    showToast('Masukkan Xclip API key untuk keluar dari room', 'error');
    return;
  }
  
  if (!confirm('Apakah Anda yakin ingin keluar dari motion room ini?')) {
    return;
  }
  
  try {
    state.motionRoomManager.isLoading = true;
    render();
    
    const response = await fetch(`${API_URL}/api/motion/rooms/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ xclipApiKey: apiKey })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(data.message || 'Berhasil keluar dari motion room', 'success');
      await loadMotionSubscriptionStatus();
      await loadMotionRooms();
    } else {
      showToast(data.error || 'Gagal keluar dari room', 'error');
    }
  } catch (error) {
    console.error('Leave motion room error:', error);
    showToast('Gagal keluar dari room', 'error');
  } finally {
    state.motionRoomManager.isLoading = false;
    render();
  }
}

// ==================== X IMAGE ROOM MANAGER FUNCTIONS ====================

async function loadXImageRooms() {
  try {
    state.ximageRoomManager.isLoading = true;
    const response = await fetch(`${API_URL}/api/ximage/rooms`, { credentials: 'include' });
    const data = await response.json();
    state.ximageRoomManager.rooms = data.rooms || [];
  } catch (error) {
    console.error('Load ximage rooms error:', error);
    state.ximageRoomManager.rooms = [];
  } finally {
    state.ximageRoomManager.isLoading = false;
    render();
  }
}

async function loadXImageSubscriptionStatus() {
  try {
    const response = await fetch(`${API_URL}/api/ximage/subscription-status`, { credentials: 'include' });
    if (!response.ok) {
      state.ximageRoomManager.hasSubscription = false;
      state.ximageRoomManager.subscription = null;
      return;
    }
    const data = await response.json();
    state.ximageRoomManager.hasSubscription = data.hasSubscription || false;
    state.ximageRoomManager.subscription = data.subscription || null;
  } catch (error) {
    console.error('Load ximage subscription error:', error);
    state.ximageRoomManager.hasSubscription = false;
    state.ximageRoomManager.subscription = null;
  }
}

async function joinXImageRoom(roomId) {
  const apiKey = state.ximageRoomManager.xclipApiKey;
  
  if (!apiKey) {
    showToast('Masukkan Xclip API key terlebih dahulu', 'error');
    return;
  }
  
  try {
    state.ximageRoomManager.isLoading = true;
    render();
    
    const response = await fetch(`${API_URL}/api/ximage/join-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ xclipApiKey: apiKey, roomId: roomId })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(data.message || 'Berhasil bergabung ke X Image room!', 'success');
      state.ximageRoomManager.showRoomModal = false;
      state.ximage.customApiKey = apiKey;
      saveUserInputs('ximage');
      await loadXImageSubscriptionStatus();
      await loadXImageRooms();
    } else {
      showToast(data.error || 'Gagal bergabung ke room', 'error');
    }
  } catch (error) {
    console.error('Join ximage room error:', error);
    showToast('Gagal bergabung ke room', 'error');
  } finally {
    state.ximageRoomManager.isLoading = false;
    render();
  }
}

// ==================== VIDGEN2 ROOM MANAGER FUNCTIONS ====================

async function loadVidgen2Rooms() {
  try {
    state.vidgen2RoomManager.isLoading = true;
    const response = await fetch(`${API_URL}/api/vidgen2/rooms`, { credentials: 'include' });
    const data = await response.json();
    state.vidgen2RoomManager.rooms = data.rooms || [];
  } catch (error) {
    console.error('Load vidgen2 rooms error:', error);
    state.vidgen2RoomManager.rooms = [];
  } finally {
    state.vidgen2RoomManager.isLoading = false;
  }
}

async function loadVidgen2History() {
  try {
    const response = await fetch(`${API_URL}/api/vidgen2/history`, { credentials: 'include' });
    const data = await response.json();
    
    // Load completed videos
    if (data.videos) {
      state.vidgen2.generatedVideos = data.videos.map(v => ({
        id: v.id,
        taskId: v.task_id,
        url: v.video_url,
        model: v.model,
        prompt: v.prompt,
        createdAt: new Date(v.created_at)
      }));
    }
    
    // Load and resume polling for processing videos
    if (data.processing && data.processing.length > 0) {
      data.processing.forEach(task => {
        // Check if already in tasks list
        const existingTask = state.vidgen2.tasks.find(t => t.taskId === task.task_id);
        if (!existingTask) {
          // Add to tasks and resume polling
          state.vidgen2.tasks.push({
            taskId: task.task_id,
            model: task.model,
            prompt: task.prompt,
            createdAt: new Date(task.created_at)
          });
          // Resume polling for this task
          pollVidgen2Task(task.task_id);
        }
      });
    }
  } catch (error) {
    console.error('Load vidgen2 history error:', error);
  }
}

// Load Video Gen history from database
async function loadVideoGenHistory() {
  try {
    const response = await fetch(`${API_URL}/api/videogen/history`, { credentials: 'include' });
    const data = await response.json();
    
    // Load completed videos (merge with existing, avoid duplicates)
    if (data.videos && data.videos.length > 0) {
      const existingTaskIds = new Set(state.videogen.generatedVideos.map(v => v.taskId));
      data.videos.forEach(v => {
        if (!existingTaskIds.has(v.taskId)) {
          state.videogen.generatedVideos.push({
            taskId: v.taskId,
            url: v.url,
            model: v.model,
            createdAt: new Date(v.createdAt).getTime()
          });
        }
      });
      // Sort by createdAt desc
      state.videogen.generatedVideos.sort((a, b) => b.createdAt - a.createdAt);
    }
    
    // Load and resume polling for processing videos
    if (data.processing && data.processing.length > 0) {
      console.log('[HISTORY] Found processing tasks:', data.processing);
      data.processing.forEach(task => {
        // Check if already in tasks list
        const existingTask = state.videogen.tasks.find(t => t.taskId === task.taskId);
        if (!existingTask) {
          console.log('[HISTORY] Resuming poll for task:', task.taskId, task.model);
          // Add to tasks
          const newTask = {
            taskId: task.taskId,
            model: task.model,
            status: 'processing',
            progress: 0,
            createdAt: new Date(task.createdAt).getTime()
          };
          state.videogen.tasks.push(newTask);
          // Resume polling for this task
          pollVideoStatus(task.taskId, task.model);
        }
      });
    } else {
      console.log('[HISTORY] No processing tasks to resume');
    }
  } catch (error) {
    console.error('Load videogen history error:', error);
  }
}

// Load Motion history from database
async function loadMotionHistory() {
  try {
    const response = await fetch(`${API_URL}/api/motion/history`, { credentials: 'include' });
    const data = await response.json();
    
    if (data.videos && data.videos.length > 0) {
      const existingTaskIds = new Set(state.motion.generatedVideos.map(v => v.taskId));
      data.videos.forEach(v => {
        if (!existingTaskIds.has(v.taskId)) {
          state.motion.generatedVideos.push({
            taskId: v.taskId,
            url: v.url,
            model: v.model,
            createdAt: new Date(v.createdAt).getTime()
          });
        }
      });
      state.motion.generatedVideos.sort((a, b) => b.createdAt - a.createdAt);
    }
    
    if (data.processing && data.processing.length > 0) {
      data.processing.forEach(task => {
        const existingTask = state.motion.tasks.find(t => t.taskId === task.taskId);
        if (!existingTask) {
          const motionApiKey = state.motion.customApiKey || state.motionRoomManager?.xclipApiKey;
          state.motion.tasks.push({
            taskId: task.taskId,
            model: task.model,
            status: 'processing',
            progress: 0,
            createdAt: new Date(task.createdAt).getTime(),
            apiKey: motionApiKey
          });
          pollMotionStatus(task.taskId, task.model, motionApiKey);
        }
      });
    }
  } catch (error) {
    console.error('Load motion history error:', error);
  }
}

async function joinVidgen2Room(roomId) {
  try {
    state.vidgen2RoomManager.isLoading = true;
    render();
    
    const response = await fetch(`${API_URL}/api/vidgen2/join-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ roomId })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Berhasil bergabung ke Vidgen2 room!', 'success');
      state.vidgen2RoomManager.showRoomModal = false;
    } else {
      showToast(data.error || 'Gagal bergabung ke room', 'error');
    }
  } catch (error) {
    console.error('Join vidgen2 room error:', error);
    showToast('Gagal bergabung ke room', 'error');
  } finally {
    state.vidgen2RoomManager.isLoading = false;
    render();
  }
}

async function loadVidgen3Rooms() {
  try {
    state.vidgen3RoomManager.isLoading = true;
    const response = await fetch(`${API_URL}/api/vidgen3/rooms`, { credentials: 'include' });
    const data = await response.json();
    state.vidgen3RoomManager.rooms = data.rooms || [];
  } catch (error) {
    console.error('Load vidgen3 rooms error:', error);
    state.vidgen3RoomManager.rooms = [];
  } finally {
    state.vidgen3RoomManager.isLoading = false;
  }
}

async function loadVidgen3History() {
  try {
    const response = await fetch(`${API_URL}/api/vidgen3/history`, { credentials: 'include' });
    const data = await response.json();
    if (data.videos) {
      state.vidgen3.generatedVideos = data.videos.map(v => ({
        id: v.id,
        url: v.video_url,
        model: v.model,
        prompt: v.prompt,
        createdAt: v.created_at,
        taskId: v.task_id
      }));
    }
    if (data.processing) {
      data.processing.forEach(task => {
        if (!state.vidgen3.tasks.find(t => t.taskId === task.task_id)) {
          state.vidgen3.tasks.push({
            taskId: task.task_id,
            model: task.model,
            status: 'processing',
            progress: 0
          });
          pollVidgen3Task(task.task_id, task.model);
        }
      });
    }
  } catch (error) {
    console.error('Load vidgen3 history error:', error);
  }
}

async function loadVidgen4Rooms() {
  state.vidgen4RoomManager.isLoading = true;
  try {
    const res = await fetch(`${API_URL}/api/vidgen4/rooms`, { credentials: 'include' });
    const data = await res.json();
    state.vidgen4RoomManager.rooms = data.rooms || [];
  } catch (e) {
    state.vidgen4RoomManager.rooms = [];
  }
  state.vidgen4RoomManager.isLoading = false;
}

async function joinVidgen4Room(roomId) {
  state.vidgen4RoomManager.isLoading = true;
  render();
  try {
    const res = await fetch(`${API_URL}/api/vidgen4/join-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ roomId })
    });
    const data = await res.json();
    if (data.success) {
      state.vidgen4.selectedRoom = roomId;
      state.vidgen4RoomManager.showRoomModal = false;
      showToast(`Bergabung ke ${data.roomName}`, 'success');
      await loadVidgen4Rooms();
    } else {
      showToast(data.error || 'Gagal join room', 'error');
    }
  } catch (e) {
    showToast('Gagal join room', 'error');
  }
  state.vidgen4RoomManager.isLoading = false;
  render();
}

async function loadVidgen4History() {
  try {
    if (!state.vidgen4.customApiKey) return;
    const res = await fetch(`${API_URL}/api/vidgen4/history`, {
      headers: { 'X-Xclip-Key': state.vidgen4.customApiKey }
    });
    const data = await res.json();
    if (data.videos) {
      state.vidgen4.generatedVideos = data.videos.map(v => ({
        id: v.task_id,
        url: v.video_url,
        model: v.model,
        prompt: v.prompt,
        createdAt: new Date(v.completed_at || v.created_at)
      }));
    }
  } catch (e) {
    console.error('Load vidgen4 history error:', e);
  }
}

async function joinVidgen3Room(roomId) {
  try {
    state.vidgen3RoomManager.isLoading = true;
    const response = await fetch(`${API_URL}/api/vidgen3/join-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ roomId })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Berhasil join Vidgen3 room!', 'success');
      state.vidgen3RoomManager.showRoomModal = false;
      await loadVidgen3Rooms();
    } else {
      showToast(data.error || 'Gagal join room', 'error');
    }
  } catch (error) {
    showToast('Gagal join room', 'error');
  } finally {
    state.vidgen3RoomManager.isLoading = false;
    render();
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
  // Method 1: Modern Clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('API Key disalin ke clipboard!', 'success'))
      .catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}

function fallbackCopy(text) {
  // Method 2: Create a visible but non-disturbing input for the browser to allow copy
  const input = document.createElement('input');
  input.value = text;
  input.style.position = 'fixed';
  input.style.bottom = '0';
  input.style.left = '0';
  input.style.opacity = '0.01';
  input.style.zIndex = '10000';
  document.body.appendChild(input);
  
  input.focus();
  input.select();
  input.setSelectionRange(0, 99999);

  try {
    const successful = document.execCommand('copy');
    if (successful) {
      showToast('API Key disalin ke clipboard!', 'success');
    } else {
      throw new Error('execCommand failed');
    }
  } catch (err) {
    // Method 3: Final fallback - prompt the user
    window.prompt('Browser memblokir salin otomatis. Silakan salin manual dari kotak ini:', text);
  }
  
  document.body.removeChild(input);
}

// Global function for inline onclick handlers
window.copyApiKey = function(text) {
  copyToClipboard(text);
};

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
                <code id="apikey-${key.id}">${key.api_key}</code>
                <button class="btn btn-sm btn-icon copy-key-btn" onclick="window.copyApiKey('${key.api_key}')" title="Salin">
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

// Download video function that works on all devices
window.downloadVideo = async function(url, filename) {
  try {
    // Check if iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const safeName = (filename || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
    
    if (isIOS) {
      // iOS: Use server proxy with proper download headers
      showToast('Mempersiapkan download...', 'info');
      const proxyUrl = `${API_URL}/api/download-video?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeName)}`;
      
      // Create invisible iframe to trigger download without leaving page
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = proxyUrl;
      document.body.appendChild(iframe);
      
      // Also open in new tab as backup
      setTimeout(() => {
        window.open(proxyUrl, '_blank');
        showToast('File sedang diunduh. Cek folder Downloads.', 'success');
      }, 500);
      
      // Clean up iframe after delay
      setTimeout(() => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      }, 10000);
      return;
    }
    
    // Desktop/Android: Try multiple download methods
    showToast('Memulai download...', 'info');
    
    // Method 1: Try fetch + blob (works for same-origin and CORS-enabled URLs)
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.ok) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = safeName + '.mp4';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        }, 100);
        showToast('Download berhasil!', 'success');
        return;
      }
    } catch (fetchError) {
      console.log('Fetch failed, trying proxy method:', fetchError);
    }
    
    // Method 2: Use server proxy (for CORS-restricted URLs)
    const proxyUrl = `${API_URL}/api/download-video?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeName)}`;
    const a = document.createElement('a');
    a.href = proxyUrl;
    a.download = safeName + '.mp4';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
    showToast('Download dimulai!', 'success');
    
  } catch (error) {
    console.error('Download error:', error);
    // Final fallback: use proxy in new tab
    const safeName = (filename || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
    const proxyUrl = `${API_URL}/api/download-video?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeName)}`;
    window.open(proxyUrl, '_blank');
    showToast('Cek folder Downloads', 'info');
  }
};

const cooldownTimers = {};

function startCooldownTimer(feature, seconds) {
  if (cooldownTimers[feature]) {
    clearInterval(cooldownTimers[feature].interval);
  }
  
  let remaining = seconds;
  
  const updateCooldownDisplay = () => {
    const btn = document.querySelector(`[data-cooldown="${feature}"]`);
    if (btn) {
      btn.disabled = true;
      if (!btn.getAttribute('data-original-html')) {
        btn.setAttribute('data-original-html', btn.innerHTML);
      }
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Tunggu ${remaining}s`;
      btn.style.opacity = '0.6';
    }
    
    const cooldownEl = document.getElementById(`${feature}-cooldown`);
    if (cooldownEl) {
      cooldownEl.textContent = `Cooldown: ${remaining}s`;
      cooldownEl.style.display = 'block';
    }
  };
  
  updateCooldownDisplay();
  
  cooldownTimers[feature] = {
    interval: setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(cooldownTimers[feature].interval);
        delete cooldownTimers[feature];
        
        const btn = document.querySelector(`[data-cooldown="${feature}"]`);
        if (btn) {
          btn.disabled = false;
          const originalHtml = btn.getAttribute('data-original-html');
          if (originalHtml) {
            btn.innerHTML = originalHtml;
            btn.removeAttribute('data-original-html');
          }
          btn.style.opacity = '1';
        }
        
        const cooldownEl = document.getElementById(`${feature}-cooldown`);
        if (cooldownEl) {
          cooldownEl.style.display = 'none';
        }
        
        showToast(`${feature === 'motion' ? 'Motion' : 'Video Gen'} siap digunakan kembali!`, 'success');
      } else {
        updateCooldownDisplay();
      }
    }, 1000)
  };
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

function render(force = false) {
  if (state.videogen.isPolling && !force && state.currentPage === 'videogen') {
    return;
  }
  if (state.motion.isPolling && state.currentPage === 'motion') {
    return;
  }
  
  // Throttle renders to prevent performance issues
  const now = Date.now();
  if (now - lastRenderTime < RENDER_THROTTLE) {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => render(force), RENDER_THROTTLE);
    return;
  }
  lastRenderTime = now;
  
  // Synchronous render to ensure DOM is available for subsequent operations
  const navMenu = document.getElementById('navMenu');
  const headerRight = document.getElementById('headerRight');
  const mainContent = document.getElementById('mainContent');
  const modalsContainer = document.getElementById('modals');
  
  if (!navMenu || !headerRight || !mainContent) return;
  
  // Update nav menu (only active states change)
  navMenu.innerHTML = renderNavMenu();
  
  // Update header right (user menu, timer)
  headerRight.innerHTML = renderHeaderRight();
  
  // Update main content
  mainContent.innerHTML = renderMainContent();
  
  // Update modals
  if (modalsContainer) modalsContainer.innerHTML = renderModals();
  
  attachEventListeners();
  
  Object.keys(cooldownTimers).forEach(feature => {
    const btn = document.querySelector(`[data-cooldown="${feature}"]`);
    if (btn && cooldownTimers[feature]) {
      btn.disabled = true;
      btn.style.opacity = '0.6';
    }
  });
  
  if (state.currentPage === 'chat') {
    scrollChatToBottom();
  }
}

function renderNavMenu() {
  return `
    <button class="nav-btn ${state.currentPage === 'video' ? 'active' : ''}" data-page="video">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="23 7 16 12 23 17 23 7"/>
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
      </svg>
      Video Clipper
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
    <button class="nav-btn ${state.currentPage === 'vidgen2' ? 'active' : ''}" data-page="vidgen2">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
        <circle cx="19" cy="12" r="2" fill="currentColor"/>
      </svg>
      Vidgen2
    </button>
    <button class="nav-btn ${state.currentPage === 'ximage' ? 'active' : ''}" data-page="ximage">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
        <path d="M14 3l7 7" stroke-width="3"/>
      </svg>
      X Image
    </button>
    <button class="nav-btn ${state.currentPage === 'xmaker' ? 'active' : ''}" data-page="xmaker">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      X Maker
    </button>
    <button class="nav-btn ${state.currentPage === 'motion' ? 'active' : ''}" data-page="motion">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M8 12h8"/>
        <path d="M12 16l4-4-4-4"/>
      </svg>
      Motion
    </button>
    <button class="nav-btn ${state.currentPage === 'vidgen3' ? 'active' : ''}" data-page="vidgen3">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
        <line x1="19" y1="5" x2="19" y2="19" stroke-width="3"/>
      </svg>
      Vidgen3
    </button>
    <button class="nav-btn ${state.currentPage === 'vidgen4' ? 'active' : ''}" data-page="vidgen4">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
        <circle cx="19" cy="12" r="3"/>
      </svg>
      Vidgen4
    </button>
    <button class="nav-btn ${state.currentPage === 'chat' ? 'active' : ''}" data-page="chat">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      AI Chat
    </button>
  `;
}

function renderHeaderRight() {
  return `
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
  `;
}

function renderMainContent() {
  return `
    ${state.currentPage === 'admin' ? renderAdminPage() : renderFeatureLock()}
    ${state.currentPage === 'video' ? renderVideoPage() : 
      state.currentPage === 'videogen' ? renderVideoGenPage() : 
      state.currentPage === 'vidgen2' ? renderVidgen2Page() :
      state.currentPage === 'vidgen3' ? renderVidgen3Page() :
      state.currentPage === 'vidgen4' ? renderVidgen4Page() :
      state.currentPage === 'ximage' ? renderXImagePage() :
      state.currentPage === 'xmaker' ? renderXMakerPage() :
      state.currentPage === 'motion' ? renderMotionPage() :
      state.currentPage === 'admin' ? '' :
      state.currentPage === 'chat' ? renderChatPage() : renderVideoPage()}
  `;
}

function renderModals() {
  return `
    ${renderAuthModal()}
    ${renderRoomModal()}
    ${renderMotionRoomModal()}
    ${renderXImageRoomModal()}
    ${renderXMakerRoomModal()}
    ${renderXclipKeysModal()}
    ${renderPricingModal()}
    ${renderPaymentModal()}
    ${renderMyPaymentsModal()}
  `;
}

function renderMotionRoomModal() {
  if (!state.motionRoomManager.showRoomModal) return '';
  
  return `
    <div class="modal-overlay" id="motionRoomModalOverlay">
      <div class="modal room-modal">
        <div class="modal-header">
          <h2>Pilih Motion Room</h2>
          <button class="modal-close" id="closeMotionRoomModal">×</button>
        </div>
        <div class="modal-body">
          <div class="api-key-input-section" style="margin-bottom: 20px;">
            <label class="setting-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Xclip API Key
            </label>
            <input 
              type="password" 
              id="motionRoomApiKeyInput" 
              class="form-input"
              placeholder="Masukkan Xclip API key Anda..."
              value="${state.motionRoomManager.xclipApiKey}"
            >
            <p class="setting-hint" style="margin-top:4px;font-size:11px;">Buat Xclip API key di panel "Xclip Keys" untuk akses Motion Room</p>
          </div>
          
          <div class="rooms-list">
            ${state.motionRoomManager.isLoading ? `
              <div class="loading-rooms">
                <div class="spinner"></div>
                <p>Memuat rooms...</p>
              </div>
            ` : state.motionRoomManager.rooms.length === 0 ? `
              <div class="empty-rooms">
                <p>Tidak ada motion room tersedia</p>
              </div>
            ` : state.motionRoomManager.rooms.map(room => `
              <div class="room-item ${room.status !== 'open' ? 'maintenance' : ''}" data-motion-room-id="${room.id}">
                <div class="room-info">
                  <div class="room-name">${room.name}</div>
                  <div class="room-stats">
                    <span class="room-users">${room.active_users}/${room.max_users} users</span>
                    <span class="room-slots">${room.available_slots} slot tersedia</span>
                  </div>
                </div>
                <div class="room-status">
                  ${room.status === 'open' ? `
                    <span class="status-badge open">OPEN</span>
                    ${room.available_slots > 0 ? `
                      <button class="btn btn-sm btn-primary join-motion-room-btn" data-room-id="${room.id}">
                        Join
                      </button>
                    ` : `
                      <span class="status-badge full">FULL</span>
                    `}
                  ` : `
                    <span class="status-badge maintenance">MAINTENANCE</span>
                    ${room.maintenance_reason ? `<span class="maintenance-reason">${room.maintenance_reason}</span>` : ''}
                  `}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderXImageRoomModal() {
  if (!state.ximageRoomManager.showRoomModal) return '';
  
  return `
    <div class="modal-overlay" id="ximageRoomModalOverlay">
      <div class="modal room-modal">
        <div class="modal-header">
          <h2>Pilih X Image Room</h2>
          <button class="modal-close" id="closeXimageRoomModal">×</button>
        </div>
        <div class="modal-body">
          <div class="api-key-input-section" style="margin-bottom: 20px;">
            <label class="setting-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Xclip API Key
            </label>
            <input 
              type="password" 
              id="ximageRoomApiKeyInput" 
              class="form-input"
              placeholder="Masukkan Xclip API key Anda..."
              value="${state.ximageRoomManager.xclipApiKey}"
            >
            <p class="setting-hint" style="margin-top:4px;font-size:11px;">Buat Xclip API key di panel "Xclip Keys" untuk akses X Image Room</p>
          </div>
          
          <div class="rooms-list">
            ${state.ximageRoomManager.isLoading ? `
              <div class="loading-rooms">
                <div class="spinner"></div>
                <p>Memuat rooms...</p>
              </div>
            ` : state.ximageRoomManager.rooms.length === 0 ? `
              <div class="empty-rooms">
                <p>Tidak ada X Image room tersedia</p>
              </div>
            ` : state.ximageRoomManager.rooms.map(room => `
              <div class="room-item ${room.status !== 'OPEN' ? 'maintenance' : ''}" data-ximage-room-id="${room.id}">
                <div class="room-info">
                  <div class="room-name">${room.name}</div>
                  <div class="room-stats">
                    <span class="room-users">${room.current_users || 0}/${room.max_users} users</span>
                    <span class="room-slots">${(room.max_users - (room.current_users || 0))} slot tersedia</span>
                  </div>
                </div>
                <div class="room-status">
                  ${room.status === 'OPEN' ? `
                    <span class="status-badge open">OPEN</span>
                    ${(room.max_users - (room.current_users || 0)) > 0 ? `
                      <button class="btn btn-sm btn-primary join-ximage-room-btn" data-room-id="${room.id}">
                        Join
                      </button>
                    ` : `
                      <span class="status-badge full">FULL</span>
                    `}
                  ` : `
                    <span class="status-badge maintenance">MAINTENANCE</span>
                  `}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
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

// ============ VIDGEN2 PAGE ============
function renderVidgen2Page() {
  const isGrokModel = state.vidgen2.selectedModel === 'grok-imagine';
  const models = [
    { id: 'sora-2-10s', name: 'Sora 2 Stable (10s)', desc: 'Video 10 detik, 720p', badge: 'POPULAR', icon: '🎬' },
    { id: 'sora-2-15s', name: 'Sora 2 Stable (15s)', desc: 'Video 15 detik, 720p', badge: 'LONGER', icon: '🎥' },
    { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', desc: 'Google Veo, cepat & berkualitas', badge: 'FAST', icon: '⚡' },
    { id: 'grok-imagine', name: 'Grok Imagine', desc: 'xAI Aurora, 6s video + audio', badge: 'NEW', icon: '🧠' }
  ];
  
  return `
    <div class="container">
      <div class="hero">
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Vidgen2 - AI Video
        </div>
        <h1 class="hero-title">
          <span class="gradient-text">AI Video</span> Generator
        </h1>
        <p class="hero-subtitle">Generate video menakjubkan dengan AI models terbaik</p>
      </div>

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
              <div class="reference-upload ${state.vidgen2.sourceImage ? 'has-image' : ''}" id="vidgen2UploadZone">
                ${state.vidgen2.sourceImage ? `
                  <img src="${state.vidgen2.sourceImage.data}" alt="Source" class="reference-preview">
                  <button class="remove-reference" id="removeVidgen2Image">
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
              </div>
              <input type="file" id="vidgen2ImageInput" accept="image/*" style="display: none">
            </div>
          </div>

          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </div>
              <h2 class="card-title">Pilih Model</h2>
            </div>
            <div class="card-body">
              <div class="model-selector-grid">
                ${models.map(model => `
                  <div class="model-card ${state.vidgen2.selectedModel === model.id ? 'active' : ''}" data-vidgen2-model="${model.id}">
                    <div class="model-card-icon">${model.icon}</div>
                    <div class="model-card-info">
                      <div class="model-card-name">${model.name}</div>
                      <div class="model-card-desc">${model.desc}</div>
                    </div>
                    ${model.badge ? `<span class="model-card-badge ${model.badge.toLowerCase()}">${model.badge}</span>` : ''}
                  </div>
                `).join('')}
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
                <label class="setting-label">Aspect Ratio</label>
                <div class="aspect-ratio-selector">
                  ${(isGrokModel ? ['1:1', '2:3', '3:2'] : ['16:9', '9:16', '1:1']).map(ratio => `
                    <button class="aspect-btn ${state.vidgen2.aspectRatio === ratio ? 'active' : ''}" data-vidgen2-ratio="${ratio}">
                      <div class="aspect-preview aspect-${ratio.replace(':', '-')}"></div>
                      <span>${ratio}</span>
                    </button>
                  `).join('')}
                </div>
              </div>

              ${isGrokModel ? `
              <div class="setting-group">
                <label class="setting-label">Creative Mode</label>
                <div class="grok-mode-selector" style="display:flex;gap:8px;">
                  ${[
                    { id: 'normal', label: 'Normal', desc: 'Balanced & professional', color: '#3b82f6' },
                    { id: 'fun', label: 'Fun', desc: 'Playful & whimsical', color: '#10b981' },
                    { id: 'spicy', label: 'Spicy', desc: 'Edgy & vibrant', color: '#ef4444' }
                  ].map(mode => `
                    <button class="aspect-btn ${state.vidgen2.grokMode === mode.id ? 'active' : ''}" data-grok-mode="${mode.id}" style="flex:1;${state.vidgen2.grokMode === mode.id ? 'border-color:' + mode.color + ';' : ''}">
                      <span style="font-size:13px;font-weight:600;">${mode.label}</span>
                      <span style="font-size:10px;opacity:0.7;display:block;margin-top:2px;">${mode.desc}</span>
                    </button>
                  `).join('')}
                </div>
              </div>

              <div class="setting-group" style="background:rgba(139,92,246,0.08);border-radius:10px;padding:10px 12px;border:1px solid rgba(139,92,246,0.15);">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                  <span style="font-size:14px;">🧠</span>
                  <span style="font-size:12px;font-weight:600;color:#8b5cf6;">Grok Imagine Info</span>
                </div>
                <p style="font-size:11px;color:var(--text-secondary);margin:0;line-height:1.5;">
                  Video 6 detik + audio sinkronisasi otomatis. Mendukung text-to-video & image-to-video. Powered by xAI Aurora engine.
                </p>
              </div>
              ` : ''}
              
              <div class="setting-group">
                <label class="setting-label">Prompt ${isGrokModel ? '' : '(Opsional)'}</label>
                <textarea 
                  class="form-textarea" 
                  id="vidgen2Prompt" 
                  placeholder="${isGrokModel ? 'Deskripsikan video yang ingin dibuat...' : 'Deskripsikan gerakan atau aksi yang diinginkan...'}"
                  rows="3"
                >${state.vidgen2.prompt}</textarea>
              </div>

              <div class="setting-group">
                <label class="setting-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  Room
                </label>
                <select class="form-select" id="vidgen2RoomSelect">
                  <option value="">-- Pilih Room --</option>
                  ${state.vidgen2RoomManager.rooms.map(room => `
                    <option value="${room.id}" ${state.vidgen2.selectedRoom == room.id ? 'selected' : ''}>
                      ${room.name} (${room.active_users}/${room.max_users} users)
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="setting-group">
                <label class="setting-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  Xclip API Key
                </label>
                <input 
                  type="password" 
                  class="form-input" 
                  id="vidgen2ApiKey" 
                  placeholder="Masukkan Xclip API key..."
                  value="${state.vidgen2.customApiKey}"
                >
                <p class="setting-hint">Buat Xclip API key di panel "Xclip Keys"</p>
              </div>

              ${(() => {
                const now = Date.now();
                const isOnCooldown = state.vidgen2.cooldownEndTime > now;
                const cooldownSecs = isOnCooldown ? Math.ceil((state.vidgen2.cooldownEndTime - now) / 1000) : 0;
                const cooldownMins = Math.floor(cooldownSecs / 60);
                const cooldownRemSecs = cooldownSecs % 60;
                const grokTextMode = state.vidgen2.selectedModel === 'grok-imagine' && !state.vidgen2.sourceImage;
                const needsImage = !state.vidgen2.sourceImage && state.vidgen2.selectedModel !== 'grok-imagine';
                const isDisabled = state.vidgen2.isGenerating || needsImage || (grokTextMode && !state.vidgen2.prompt.trim()) || state.vidgen2.tasks.length >= 3 || isOnCooldown;
                
                return `<button class="btn btn-primary btn-lg btn-full" id="generateVidgen2Btn" ${isDisabled ? 'disabled' : ''}>
                ${state.vidgen2.isGenerating ? `
                  <div class="spinner"></div>
                  <span>Generating...</span>
                ` : isOnCooldown ? `
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>Cooldown ${cooldownMins}:${cooldownRemSecs.toString().padStart(2, '0')}</span>
                ` : `
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  <span>Generate Video${state.vidgen2.tasks.length > 0 ? ' (' + state.vidgen2.tasks.length + '/3)' : ''}</span>
                `}
              </button>`;
              })()}
              ${!state.vidgen2.sourceImage && state.vidgen2.selectedModel !== 'grok-imagine' ? '<p class="setting-hint" style="text-align:center;margin-top:12px;opacity:0.7;">Upload gambar terlebih dahulu</p>' : ''}
              ${state.vidgen2.selectedModel === 'grok-imagine' && !state.vidgen2.sourceImage && !state.vidgen2.prompt.trim() ? '<p class="setting-hint" style="text-align:center;margin-top:12px;opacity:0.7;">Masukkan prompt atau upload gambar</p>' : ''}
              ${state.vidgen2.tasks.length >= 3 ? '<p class="setting-hint warning" style="text-align:center;margin-top:12px;">Maks 3 video bersamaan. Tunggu salah satu selesai.</p>' : ''}
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
              ${renderVidgen2Tasks()}
              ${renderVidgen2Videos()}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderVidgen2Tasks() {
  if (state.vidgen2.tasks.length === 0) return '';
  
  let html = '<div class="processing-tasks">';
  html += '<div class="tasks-header"><span class="pulse-dot"></span> Sedang Diproses (' + state.vidgen2.tasks.length + '/3)</div>';
  html += '<div class="tasks-list">';
  
  state.vidgen2.tasks.forEach(function(task) {
    html += '<div class="task-card">';
    html += '<div class="task-card-header">';
    html += '<span class="task-model-badge">' + task.model.toUpperCase() + '</span>';
    html += '<span class="task-status-badge processing">Processing</span>';
    html += '</div>';
    html += '<div class="task-progress-bar"><div class="task-progress-fill indeterminate"></div></div>';
    html += '</div>';
  });
  
  html += '</div></div>';
  return html;
}

function renderVidgen2Videos() {
  if (state.vidgen2.generatedVideos.length > 0) {
    let html = '<div class="generated-videos-section">';
    html += '<div class="videos-header">';
    html += '<span>Video yang Dihasilkan (' + state.vidgen2.generatedVideos.length + ')</span>';
    html += '<button class="btn btn-sm btn-danger" id="clearAllVidgen2">Hapus Semua</button>';
    html += '</div>';
    html += '<div class="videos-grid">';
    
    state.vidgen2.generatedVideos.forEach(function(video, index) {
      html += '<div class="video-card">';
      html += '<div class="video-wrapper"><video src="' + video.url + '" controls playsinline></video></div>';
      html += '<div class="video-card-footer">';
      html += '<span class="video-model-tag">' + (video.model || 'AI').toUpperCase() + '</span>';
      html += '<div class="video-actions">';
      html += '<button onclick="downloadVideo(\'' + video.url + '\', \'vidgen2-' + index + '.mp4\')" class="btn btn-sm btn-secondary">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      html += '</button>';
      html += '<button class="btn btn-sm btn-danger vidgen2-delete-btn" data-video-id="' + video.id + '">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
      html += '</button>';
      html += '</div>';
      html += '</div></div>';
    });
    
    html += '</div></div>';
    return html;
  } else if (state.vidgen2.tasks.length === 0) {
    return '<div class="empty-preview"><div class="empty-preview-icon"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><polygon points="5 3 19 12 5 21 5 3"/></svg></div><h3>Belum Ada Video</h3><p>Upload gambar dan klik Generate untuk membuat video AI</p></div>';
  }
  return '';
}

// ============ VIDGEN3 PAGE ============

function renderVidgen3Page() {
  const models = [
    { id: 'minimax-live', name: 'MiniMax Live', desc: 'Animasi ilustrasi, camera movements', badge: 'LIVE', icon: '🎭', type: 'i2v' },
    { id: 'seedance-1.5-pro-1080p', name: 'Seedance 1.5 Pro', desc: '1080p, audio, T2V + I2V', badge: 'NEW', icon: '🌱', type: 'both' },
    { id: 'ltx-2-pro-i2v', name: 'LTX Pro', desc: 'Sampai 2160p, 50fps', badge: 'PRO', icon: '🎬', type: 'both' },
    { id: 'ltx-2-fast-i2v', name: 'LTX Fast', desc: 'Ultra-cepat, sampai 20s', badge: 'FAST', icon: '⚡', type: 'both' },
    { id: 'runway-4.5-i2v', name: 'RunWay Gen 4.5', desc: 'Cinematic quality', badge: 'NEW', icon: '🎥', type: 'both' },
    { id: 'runway-gen4-turbo', name: 'RunWay Gen4 Turbo', desc: 'Fast video generation', badge: 'TURBO', icon: '🚀', type: 'i2v' },
    { id: 'omnihuman-1.5', name: 'OmniHuman 1.5', desc: 'Animasi manusia dari audio', badge: 'HUMAN', icon: '🧑', type: 'omnihuman' }
  ];

  const selectedModelInfo = models.find(m => m.id === state.vidgen3.selectedModel);
  const isImageOptional = selectedModelInfo && selectedModelInfo.type === 'both';

  return `
    <div class="container">
      <div class="hero">
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Vidgen3 - AI Video Playground
        </div>
        <h1 class="hero-title">
          <span class="gradient-text">Vidgen3</span> AI Video Playground
        </h1>
        <p class="hero-subtitle">Generate video dengan berbagai AI model terbaik</p>
      </div>

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
              <h2 class="card-title">Upload Gambar ${isImageOptional ? '<span style="font-size:12px;opacity:0.7;font-weight:normal;">(Opsional - T2V jika kosong)</span>' : ''}</h2>
            </div>
            <div class="card-body">
              <div class="reference-upload ${state.vidgen3.sourceImage ? 'has-image' : ''}" id="vidgen3UploadZone">
                ${state.vidgen3.sourceImage ? `
                  <img src="${state.vidgen3.sourceImage.data}" alt="Source" class="reference-preview">
                  <button class="remove-reference" id="removeVidgen3Image">
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
              </div>
              <input type="file" id="vidgen3ImageInput" accept="image/*" style="display: none">
            </div>
          </div>

          ${state.vidgen3.selectedModel === 'omnihuman-1.5' ? `
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="16" r="3"/>
                </svg>
              </div>
              <h2 class="card-title">Audio URL <span style="font-size:12px;opacity:0.7;font-weight:normal;">(Wajib)</span></h2>
            </div>
            <div class="card-body">
              <div class="setting-group">
                <input 
                  type="text" 
                  class="form-input" 
                  id="vidgen3AudioUrl" 
                  placeholder="Paste URL audio publik (mp3/wav)..."
                  value="${state.vidgen3.audioFile?.url || ''}"
                >
                <p class="setting-hint">URL audio harus bisa diakses publik</p>
              </div>
            </div>
          </div>
          ` : ''}

          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </div>
              <h2 class="card-title">Pilih Model</h2>
            </div>
            <div class="card-body">
              <div class="model-selector-grid">
                ${models.map(model => `
                  <div class="model-card ${state.vidgen3.selectedModel === model.id ? 'active' : ''}" data-vidgen3-model="${model.id}">
                    <div class="model-card-icon">${model.icon}</div>
                    <div class="model-card-info">
                      <div class="model-card-name">${model.name}</div>
                      <div class="model-card-desc">${model.desc}</div>
                    </div>
                    ${model.badge ? `<span class="model-card-badge ${model.badge.toLowerCase()}">${model.badge}</span>` : ''}
                  </div>
                `).join('')}
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
              ${renderVidgen3ModelSettings()}

              <div class="setting-group">
                <label class="setting-label">Prompt ${state.vidgen3.selectedModel === 'omnihuman-1.5' ? '(Opsional)' : ''}</label>
                <textarea 
                  class="form-textarea" 
                  id="vidgen3Prompt" 
                  placeholder="Deskripsikan gerakan atau aksi yang diinginkan..."
                  rows="3"
                >${state.vidgen3.prompt}</textarea>
              </div>

              <div class="setting-group">
                <label class="setting-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  Room
                </label>
                <select class="form-select" id="vidgen3RoomSelect">
                  <option value="">-- Pilih Room --</option>
                  ${state.vidgen3RoomManager.rooms.map(room => `
                    <option value="${room.id}" ${state.vidgen3.selectedRoom == room.id ? 'selected' : ''}>
                      ${room.name} (${room.active_users}/${room.max_users} users)
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="setting-group">
                <label class="setting-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  Xclip API Key
                </label>
                <input 
                  type="password" 
                  class="form-input" 
                  id="vidgen3ApiKey" 
                  placeholder="Masukkan Xclip API key..."
                  value="${state.vidgen3.customApiKey}"
                >
                <p class="setting-hint">Buat Xclip API key di panel "Xclip Keys"</p>
              </div>

              ${(() => {
                const now = Date.now();
                const isOnCooldown = state.vidgen3.cooldownEndTime > now;
                const cooldownSecs = isOnCooldown ? Math.ceil((state.vidgen3.cooldownEndTime - now) / 1000) : 0;
                const cooldownMins = Math.floor(cooldownSecs / 60);
                const cooldownRemSecs = cooldownSecs % 60;
                const model = state.vidgen3.selectedModel;
                const isOmniHuman = model === 'omnihuman-1.5';
                const isI2VOnly = model === 'minimax-live' || model === 'runway-gen4-turbo';
                const needsImage = isOmniHuman || isI2VOnly;
                const isDisabled = state.vidgen3.isGenerating || (needsImage && !state.vidgen3.sourceImage) || state.vidgen3.tasks.length >= 3 || isOnCooldown;
                
                return `<button class="btn btn-primary btn-lg btn-full" id="generateVidgen3Btn" ${isDisabled ? 'disabled' : ''}>
                ${state.vidgen3.isGenerating ? `
                  <div class="spinner"></div>
                  <span>Generating...</span>
                ` : isOnCooldown ? `
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>Cooldown ${cooldownMins}:${cooldownRemSecs.toString().padStart(2, '0')}</span>
                ` : `
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  <span>Generate Video${state.vidgen3.tasks.length > 0 ? ' (' + state.vidgen3.tasks.length + '/3)' : ''}</span>
                `}
              </button>`;
              })()}
              ${state.vidgen3.tasks.length >= 3 ? '<p class="setting-hint warning" style="text-align:center;margin-top:12px;">Maks 3 video bersamaan. Tunggu salah satu selesai.</p>' : ''}
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
              ${renderVidgen3Tasks()}
              ${renderVidgen3Videos()}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderVidgen3ModelSettings() {
  const model = state.vidgen3.selectedModel;
  let html = '';

  if (model === 'seedance-1.5-pro-1080p') {
    html += `
      <div class="setting-group">
        <label class="setting-label">Durasi (detik)</label>
        <div class="aspect-ratio-selector">
          ${[4, 5, 6, 8, 10, 12].map(d => `
            <button class="aspect-btn ${state.vidgen3.duration === d ? 'active' : ''}" data-vidgen3-duration="${d}">
              <span>${d}s</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="setting-group">
        <label class="setting-label">Aspect Ratio</label>
        <div class="aspect-ratio-selector">
          ${[{id:'widescreen_16_9',label:'16:9'},{id:'portrait_9_16',label:'9:16'},{id:'square_1_1',label:'1:1'}].map(ar => `
            <button class="aspect-btn ${state.vidgen3.aspectRatio === ar.id ? 'active' : ''}" data-vidgen3-aspect="${ar.id}">
              <span>${ar.label}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="setting-group">
        <label class="setting-label" style="display:flex;align-items:center;justify-content:space-between;">
          Generate Audio
          <label class="toggle-switch">
            <input type="checkbox" id="vidgen3AudioToggle" ${state.vidgen3.generateAudio ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </label>
      </div>
      <div class="setting-group">
        <label class="setting-label" style="display:flex;align-items:center;justify-content:space-between;">
          Camera Fixed
          <label class="toggle-switch">
            <input type="checkbox" id="vidgen3CameraToggle" ${state.vidgen3.cameraFixed ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </label>
      </div>
    `;
  } else if (model === 'ltx-2-pro-i2v' || model === 'ltx-2-fast-i2v') {
    const isFast = model === 'ltx-2-fast-i2v';
    const durations = isFast ? [5, 8, 10, 15, 20] : [5, 8, 10];
    html += `
      <div class="setting-group">
        <label class="setting-label">Durasi (detik)</label>
        <div class="aspect-ratio-selector">
          ${durations.map(d => `
            <button class="aspect-btn ${state.vidgen3.duration === d ? 'active' : ''}" data-vidgen3-duration="${d}">
              <span>${d}s</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="setting-group">
        <label class="setting-label">Resolution</label>
        <div class="aspect-ratio-selector">
          ${['1080p', '1440p', '2160p'].map(r => `
            <button class="aspect-btn ${state.vidgen3.resolution === r ? 'active' : ''}" data-vidgen3-resolution="${r}">
              <span>${r}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="setting-group">
        <label class="setting-label">FPS</label>
        <div class="aspect-ratio-selector">
          ${[25, 50].map(f => `
            <button class="aspect-btn ${state.vidgen3.fps === f ? 'active' : ''}" data-vidgen3-fps="${f}">
              <span>${f} fps</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="setting-group">
        <label class="setting-label" style="display:flex;align-items:center;justify-content:space-between;">
          Generate Audio
          <label class="toggle-switch">
            <input type="checkbox" id="vidgen3AudioToggle" ${state.vidgen3.generateAudio ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </label>
      </div>
    `;
  } else if (model === 'runway-4.5-i2v' || model === 'runway-gen4-turbo') {
    const isTurbo = model === 'runway-gen4-turbo';
    const durations = isTurbo ? [5, 10] : [5, 8, 10];
    const ratios = ['1280:720', '720:1280', '1104:832', '960:960', '832:1104'];
    html += `
      <div class="setting-group">
        <label class="setting-label">Durasi (detik)</label>
        <div class="aspect-ratio-selector">
          ${durations.map(d => `
            <button class="aspect-btn ${state.vidgen3.duration === d ? 'active' : ''}" data-vidgen3-duration="${d}">
              <span>${d}s</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="setting-group">
        <label class="setting-label">Ratio</label>
        <div class="aspect-ratio-selector" style="flex-wrap:wrap;">
          ${ratios.map(r => `
            <button class="aspect-btn ${state.vidgen3.ratio === r ? 'active' : ''}" data-vidgen3-ratio="${r}">
              <span>${r}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  } else if (model === 'omnihuman-1.5') {
    html += `
      <div class="setting-group">
        <label class="setting-label" style="display:flex;align-items:center;justify-content:space-between;">
          Turbo Mode
          <label class="toggle-switch">
            <input type="checkbox" id="vidgen3TurboToggle" ${state.vidgen3.turboMode ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </label>
      </div>
      <div class="setting-group">
        <label class="setting-label">Resolution</label>
        <div class="aspect-ratio-selector">
          ${['720p', '1080p'].map(r => `
            <button class="aspect-btn ${state.vidgen3.resolution === r ? 'active' : ''}" data-vidgen3-resolution="${r}">
              <span>${r}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  } else if (model === 'minimax-live') {
    html += `<p class="setting-hint" style="text-align:center;opacity:0.7;">MiniMax Live memerlukan gambar sebagai input</p>`;
  }

  return html;
}

function renderVidgen3Tasks() {
  if (state.vidgen3.tasks.length === 0) return '';
  
  let html = '<div class="processing-tasks">';
  html += '<div class="tasks-header"><span class="pulse-dot"></span> Sedang Diproses (' + state.vidgen3.tasks.length + '/3)</div>';
  html += '<div class="tasks-list">';
  
  state.vidgen3.tasks.forEach(function(task) {
    html += '<div class="task-card">';
    html += '<div class="task-card-header">';
    html += '<span class="task-model-badge">' + task.model.toUpperCase() + '</span>';
    html += '<span class="task-status-badge processing">Processing</span>';
    html += '</div>';
    html += '<div class="task-progress-bar"><div class="task-progress-fill indeterminate"></div></div>';
    html += '</div>';
  });
  
  html += '</div></div>';
  return html;
}

function renderVidgen3Videos() {
  if (state.vidgen3.generatedVideos.length > 0) {
    let html = '<div class="generated-videos-section">';
    html += '<div class="videos-header">';
    html += '<span>Video yang Dihasilkan (' + state.vidgen3.generatedVideos.length + ')</span>';
    html += '<button class="btn btn-sm btn-danger" id="clearAllVidgen3">Hapus Semua</button>';
    html += '</div>';
    html += '<div class="videos-grid">';
    
    state.vidgen3.generatedVideos.forEach(function(video, index) {
      html += '<div class="video-card">';
      html += '<div class="video-wrapper"><video src="' + video.url + '" controls playsinline></video></div>';
      html += '<div class="video-card-footer">';
      html += '<span class="video-model-tag">' + (video.model || 'AI').toUpperCase() + '</span>';
      html += '<div class="video-actions">';
      html += '<button onclick="downloadVideo(\'' + video.url + '\', \'vidgen3-' + index + '.mp4\')" class="btn btn-sm btn-secondary">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      html += '</button>';
      html += '<button class="btn btn-sm btn-danger vidgen3-delete-btn" data-video-id="' + video.id + '">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
      html += '</button>';
      html += '</div>';
      html += '</div></div>';
    });
    
    html += '</div></div>';
    return html;
  } else if (state.vidgen3.tasks.length === 0) {
    return '<div class="empty-preview"><div class="empty-preview-icon"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><polygon points="5 3 19 12 5 21 5 3"/></svg></div><h3>Belum Ada Video</h3><p>Pilih model dan klik Generate untuk membuat video AI</p></div>';
  }
  return '';
}

// ============ X IMAGE PAGE ============
function getModelIcon(iconType) {
  var icons = {
    openai: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.392.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.612-1.5z"/></svg>',
    google: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>',
    bytedance: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12.53.02C6.44.02 1.5 4.97 1.5 11.06c0 4.56 2.79 8.48 6.76 10.14v-7.17H6.15V11.1h2.11V8.7c0-2.08 1.24-3.23 3.13-3.23.91 0 1.86.16 1.86.16v2.04h-1.05c-1.03 0-1.35.64-1.35 1.3v1.56h2.3l-.37 2.93h-1.93v7.17c3.97-1.66 6.76-5.58 6.76-10.14 0-6.09-4.94-11.04-11.03-11.04h-.05z"/></svg>',
    flux: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    alibaba: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    xai: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>'
  };
  return icons[iconType] || '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
}

function renderXImagePage() {
  var ximageModels = [
    { id: 'gpt-image-1.5', name: 'GPT Image 1.5', icon: 'openai', supportsI2I: true, badge: 'POPULAR', hasN: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
    { id: 'gpt-4o-image', name: 'GPT-4o Image', icon: 'openai', supportsI2I: true, badge: 'PRO', hasN: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
    { id: 'nano-banana', name: 'Nano Banana', icon: 'google', supportsI2I: true, hasN: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
    { id: 'nano-banana-2', name: 'Nano Banana Pro', icon: 'google', supportsI2I: true, badge: '4K', hasN: true, hasResolution: true, resolutions: ['1K', '2K', '4K'], maxRefs: 2, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
    { id: 'seedream-4.5', name: 'Seedream 4.5', icon: 'bytedance', supportsI2I: true, badge: '4K', hasN: true, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
    { id: 'flux-2-pro', name: 'FLUX.2 Pro', icon: 'flux', supportsI2I: true, badge: 'ULTRA', hasResolution: true, resolutions: ['1K', '2K'], maxRefs: 8, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
    { id: 'z-image', name: 'Z-Image', icon: 'alibaba', supportsI2I: false, badge: 'FAST', sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
    { id: 'grok-imagine-image', name: 'Grok Imagine', icon: 'xai', supportsI2I: true, badge: 'NEW', sizes: ['1:1', '16:9', '9:16', '2:3', '3:2'] }
  ];
  
  var currentModelConfig = ximageModels.find(function(m) { return m.id === state.ximage.selectedModel; }) || ximageModels[0];
  var aspectRatios = currentModelConfig.sizes || ['1:1', '16:9', '9:16', '4:3', '3:4'];
  
  var html = '<div class="container">';
  html += '<div class="hero ximage-hero">';
  html += '<div class="hero-badge gradient-badge"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg> AI Image Generator</div>';
  html += '<h1 class="gradient-title">X Image</h1>';
  html += '<p class="hero-subtitle">Generate gambar menakjubkan dengan berbagai model AI terbaik</p>';
  html += '</div>';
  
  html += '<div class="ximage-content">';
  
  // Mode Selection
  html += '<div class="section-card">';
  html += '<h3 class="section-title">Mode</h3>';
  html += '<div class="mode-selector">';
  html += '<button class="mode-btn ' + (state.ximage.mode === 'text-to-image' ? 'active' : '') + '" data-ximage-mode="text-to-image">';
  html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Text to Image</button>';
  html += '<button class="mode-btn ' + (state.ximage.mode === 'image-to-image' ? 'active' : '') + '" data-ximage-mode="image-to-image">';
  html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> Image to Image</button>';
  html += '</div></div>';
  
  // Reference Image (for image-to-image mode)
  if (state.ximage.mode === 'image-to-image') {
    var showSecondRef = currentModelConfig.maxRefs && currentModelConfig.maxRefs >= 2;
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Reference Image' + (showSecondRef ? ' 1' : '') + '</h3>';
    html += '<div class="reference-upload ' + (state.ximage.sourceImage ? 'has-image' : '') + '" id="ximageUploadZone">';
    if (state.ximage.sourceImage) {
      html += '<img src="' + state.ximage.sourceImage.data + '" alt="Reference" class="preview-image"/>';
      html += '<button class="remove-image-btn" id="removeXimageImage"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
    } else {
      html += '<div class="upload-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><p>Klik atau drop gambar referensi</p></div>';
    }
    html += '<input type="file" id="ximageFileInput" accept="image/*" style="display:none"/>';
    html += '</div></div>';

    if (showSecondRef) {
      html += '<div class="section-card">';
      html += '<h3 class="section-title">Reference Image 2 <span style="font-size:12px;color:#888;font-weight:normal">(opsional)</span></h3>';
      html += '<div class="reference-upload ' + (state.ximage.sourceImage2 ? 'has-image' : '') + '" id="ximageUploadZone2">';
      if (state.ximage.sourceImage2) {
        html += '<img src="' + state.ximage.sourceImage2.data + '" alt="Reference 2" class="preview-image"/>';
        html += '<button class="remove-image-btn" id="removeXimageImage2"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
      } else {
        html += '<div class="upload-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><p>Klik atau drop gambar referensi ke-2</p></div>';
      }
      html += '<input type="file" id="ximageFileInput2" accept="image/*" style="display:none"/>';
      html += '</div></div>';
    }
  }
  
  // Model Selection
  html += '<div class="section-card">';
  html += '<h3 class="section-title">Pilih Model AI</h3>';
  html += '<div class="ximage-models-grid">';
  ximageModels.forEach(function(model) {
    var isDisabled = state.ximage.mode === 'image-to-image' && !model.supportsI2I;
    var iconSvg = getModelIcon(model.icon);
    html += '<div class="ximage-model-card ' + (state.ximage.selectedModel === model.id ? 'active' : '') + ' ' + (isDisabled ? 'disabled' : '') + '" data-ximage-model="' + model.id + '"' + (isDisabled ? ' title="Tidak support Image-to-Image"' : '') + '>';
    html += '<div class="ximage-model-icon">' + iconSvg + '</div>';
    html += '<div class="ximage-model-name">' + model.name + '</div>';
    if (model.badge) html += '<span class="ximage-model-badge badge-' + model.badge.toLowerCase() + '">' + model.badge + '</span>';
    if (isDisabled) html += '<div class="ximage-model-disabled-text">Text Only</div>';
    html += '</div>';
  });
  html += '</div></div>';
  
  // Prompt
  html += '<div class="section-card">';
  html += '<h3 class="section-title">Prompt</h3>';
  html += '<textarea id="ximagePrompt" class="prompt-input" placeholder="' + (state.ximage.mode === 'image-to-image' ? 'Deskripsikan perubahan yang diinginkan...' : 'Deskripsikan gambar yang ingin dibuat...') + '" rows="4">' + state.ximage.prompt + '</textarea>';
  html += '</div>';
  
  // Size (Aspect Ratio) - like Poyo Playground
  html += '<div class="section-card">';
  html += '<h3 class="section-title">Size</h3>';
  html += '<div class="aspect-buttons">';
  aspectRatios.forEach(function(ratio) {
    html += '<button class="aspect-btn ' + (state.ximage.aspectRatio === ratio ? 'active' : '') + '" data-ximage-ratio="' + ratio + '">' + ratio + '</button>';
  });
  html += '</div></div>';
  
  // Resolution - only for models that support it (nano-banana-2, flux-2-pro)
  if (currentModelConfig.hasResolution) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Resolution</h3>';
    html += '<div class="aspect-buttons">';
    currentModelConfig.resolutions.forEach(function(res) {
      html += '<button class="aspect-btn ' + (state.ximage.resolution === res ? 'active' : '') + '" data-ximage-resolution="' + res + '">' + res + '</button>';
    });
    html += '</div></div>';
  }
  
  // Number of Images - only for models that support it
  if (currentModelConfig.hasN) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Number of Images</h3>';
    html += '<div class="number-input-wrapper">';
    html += '<button class="num-btn" data-ximage-num-action="decrease" ' + (state.ximage.numberOfImages <= 1 ? 'disabled' : '') + '>-</button>';
    html += '<span class="num-value">' + state.ximage.numberOfImages + '</span>';
    html += '<button class="num-btn" data-ximage-num-action="increase" ' + (state.ximage.numberOfImages >= 4 ? 'disabled' : '') + '>+</button>';
    html += '</div></div>';
  }
  
  // Room & API Key Section
  html += '<div class="section-card">';
  html += '<h3 class="section-title">X Image Room</h3>';
  if (state.ximageRoomManager.subscription && state.ximageRoomManager.subscription.roomName) {
    html += '<div class="room-status-card active">';
    html += '<div class="room-status-info">';
    html += '<span class="room-status-label">Room Aktif:</span>';
    html += '<span class="room-status-name">' + state.ximageRoomManager.subscription.roomName + '</span>';
    html += '</div>';
    html += '<button class="btn btn-sm btn-outline" id="changeXimageRoom" onclick="window.openXimageRoomModalFn && window.openXimageRoomModalFn()">Ganti Room</button>';
    html += '</div>';
  } else {
    html += '<div class="room-status-card">';
    html += '<p class="room-status-text">Belum bergabung ke room. Pilih room untuk menggunakan X Image.</p>';
    html += '<button class="btn btn-primary" id="openXimageRoomModal" onclick="window.openXimageRoomModalFn && window.openXimageRoomModalFn()">Pilih Room</button>';
    html += '</div>';
  }
  html += '</div>';
  
  // API Key (shown when room is selected)
  html += '<div class="section-card">';
  html += '<h3 class="section-title">Xclip API Key</h3>';
  html += '<input type="password" id="ximageApiKey" class="api-key-input" placeholder="Masukkan Xclip API Key" value="' + state.ximage.customApiKey + '"/>';
  html += '</div>';
  
  // Generate Button
  var btnDisabled = state.ximage.isGenerating || (state.ximage.mode === 'image-to-image' && !state.ximage.sourceImage) || state.ximage.tasks.length >= 3;
  html += '<button class="btn btn-primary btn-lg btn-full" id="generateXimageBtn" ' + (btnDisabled ? 'disabled' : '') + '>';
  if (state.ximage.isGenerating) {
    html += '<span class="loading-spinner"></span><span>Generating...</span>';
  } else {
    html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
    html += '<span>Generate Image' + (state.ximage.tasks.length > 0 ? ' (' + state.ximage.tasks.length + '/3)' : '') + '</span>';
  }
  html += '</button>';
  
  // Error Message
  if (state.ximage.error) {
    html += '<div class="error-message">' + state.ximage.error + '</div>';
  }
  
  // Tasks & Results
  html += '<div class="ximage-results">';
  html += renderXImageTasks();
  html += renderXImageGallery();
  html += '</div>';
  
  html += '</div></div>';
  return html;
}

function renderXImageTasks() {
  if (state.ximage.tasks.length === 0) return '';
  
  var html = '<div class="tasks-section"><h3>Sedang Diproses</h3><div class="tasks-list">';
  
  state.ximage.tasks.forEach(function(task) {
    var elapsed = Math.floor((Date.now() - task.startTime) / 1000);
    var minutes = Math.floor(elapsed / 60);
    var seconds = elapsed % 60;
    
    html += '<div class="task-card">';
    html += '<div class="task-info"><span class="task-model">' + task.model + '</span>';
    html += '<span class="task-time">' + minutes + ':' + seconds.toString().padStart(2, '0') + '</span></div>';
    html += '<div class="task-progress"><div class="progress-bar"><div class="progress-fill" style="width: ' + (task.progress || 30) + '%"></div></div>';
    html += '<span class="task-status">' + (task.status || 'Processing...') + '</span></div></div>';
  });
  
  html += '</div></div>';
  return html;
}

function renderXImageGallery() {
  if (state.ximage.generatedImages.length > 0) {
    var html = '<div class="gallery-section">';
    html += '<div class="gallery-header">Gambar yang Dihasilkan (' + state.ximage.generatedImages.length + ')</div>';
    html += '<div class="images-grid">';
    
    state.ximage.generatedImages.forEach(function(image, index) {
      html += '<div class="image-card">';
      html += '<div class="image-wrapper"><img src="' + image.url + '" alt="Generated" loading="lazy"/></div>';
      html += '<div class="image-card-footer">';
      html += '<span class="image-model-tag">' + (image.model || 'AI').toUpperCase() + '</span>';
      html += '<button class="btn btn-sm btn-secondary ximage-download-btn" data-url="' + encodeURIComponent(image.url) + '" data-filename="ximage-' + index + '.png">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      html += ' Download</button>';
      html += '</div></div>';
    });
    
    html += '</div></div>';
    return html;
  } else if (state.ximage.tasks.length === 0) {
    return '<div class="empty-preview"><div class="empty-preview-icon"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div><h3>Belum Ada Gambar</h3><p>Masukkan prompt dan klik Generate untuk membuat gambar AI</p></div>';
  }
  return '';
}

async function downloadImage(url, filename) {
  try {
    // Try fetch + blob approach for cross-origin images
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
    showToast('Gambar berhasil diunduh', 'success');
  } catch (err) {
    console.error('Download error:', err);
    // Fallback: open in new tab
    window.open(url, '_blank');
    showToast('Membuka gambar di tab baru', 'info');
  }
}

function renderXMakerPage() {
  const hasRoom = state.xmakerRoomManager.subscription !== null;
  
  return `
    <div class="container">
      <div class="hero">
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          AI Image Generator
        </div>
        <h1>X Maker - Multi-Scene Image Gen</h1>
        <p>Generate konsisten karakter di berbagai scene dengan AI</p>
      </div>
      
      ${!hasRoom ? `
        <div class="room-required-notice">
          <div class="notice-icon">🔑</div>
          <h3>Join Room Diperlukan</h3>
          <p>Untuk menggunakan X Maker, Anda perlu bergabung ke salah satu room terlebih dahulu.</p>
          <button class="btn-primary" id="showXMakerRoomModal">
            <span>Pilih Room</span>
          </button>
        </div>
      ` : `
        <div class="room-status-bar">
          <div class="room-info">
            <span class="room-badge">🏠 ${state.xmakerRoomManager.subscription.roomName}</span>
            <span class="room-expiry">Expired: ${new Date(state.xmakerRoomManager.subscription.expiredAt).toLocaleDateString('id-ID')}</span>
          </div>
          <button class="btn-outline btn-small" id="leaveXMakerRoom">Keluar Room</button>
        </div>
      `}
      
      <div class="xmaker-layout">
        <div class="xmaker-settings">
          <div class="settings-section">
            <h3>📷 Karakter Referensi</h3>
            <p class="section-desc">Upload gambar karakter untuk konsistensi</p>
            <div class="reference-upload-area" id="xmakerReferenceUpload">
              ${state.xmaker.referenceImage ? `
                <div class="reference-preview">
                  <img src="${state.xmaker.referenceImage.preview}" alt="Reference">
                  <button class="btn-remove-ref" id="removeXMakerReference">×</button>
                </div>
              ` : `
                <div class="upload-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <span>Klik untuk upload karakter</span>
                </div>
              `}
              <input type="file" id="xmakerReferenceInput" accept="image/*" hidden>
            </div>
          </div>
          
          <div class="settings-section">
            <h3>🤖 Model AI</h3>
            <div class="model-grid">
              ${IMAGE_MODELS.map(model => `
                <div class="model-option ${state.xmaker.selectedModel === model.id ? 'selected' : ''}" data-model="${model.id}">
                  <span class="model-icon">${model.icon}</span>
                  <div class="model-info">
                    <span class="model-name">${model.name}</span>
                    <span class="model-desc">${model.desc}</span>
                  </div>
                  ${model.supportsReference ? '<span class="badge-ref">Ref</span>' : ''}
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="settings-section">
            <h3>🎨 Style</h3>
            <div class="style-grid">
              ${IMAGE_STYLES.map(style => `
                <div class="style-option ${state.xmaker.style === style.id ? 'selected' : ''}" data-style="${style.id}">
                  <span class="style-name">${style.name}</span>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="settings-section">
            <h3>📐 Aspect Ratio</h3>
            <div class="aspect-grid">
              ${ASPECT_RATIOS.slice(0, 5).map(ar => `
                <div class="aspect-option ${state.xmaker.aspectRatio === ar.id ? 'selected' : ''}" data-ratio="${ar.id}">
                  <span>${ar.name}</span>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="settings-section">
            <h3>🎬 Scene Descriptions</h3>
            <p class="section-desc">Masukkan deskripsi untuk setiap scene yang ingin di-generate</p>
            <div class="scenes-container">
              ${state.xmaker.scenes.map((scene, idx) => `
                <div class="scene-item">
                  <div class="scene-header">
                    <span class="scene-number">Scene ${idx + 1}</span>
                    ${state.xmaker.scenes.length > 1 ? `
                      <button class="btn-remove-scene" data-scene-id="${scene.id}">×</button>
                    ` : ''}
                  </div>
                  <textarea class="scene-textarea" data-scene-id="${scene.id}" placeholder="Contoh: Karakter sedang duduk di kafe sambil minum kopi...">${scene.description}</textarea>
                </div>
              `).join('')}
            </div>
            <button class="btn-add-scene" id="addXMakerScene">
              <span>+ Tambah Scene</span>
            </button>
          </div>
          
          <button class="btn-generate ${state.xmaker.isGenerating || !hasRoom ? 'disabled' : ''}" id="generateXMakerImages" ${state.xmaker.isGenerating || !hasRoom ? 'disabled' : ''}>
            ${state.xmaker.isGenerating ? `
              <span class="spinner"></span>
              <span>Generating Scene ${state.xmaker.currentSceneIndex + 1}/${state.xmaker.scenes.length}...</span>
            ` : `
              <span>🚀 Generate ${state.xmaker.scenes.filter(s => s.description.trim()).length} Scene</span>
            `}
          </button>
        </div>
        
        <div class="xmaker-preview">
          <div class="preview-header">
            <h3>🖼️ Generated Images</h3>
            ${state.xmaker.generatedImages.length > 0 ? `
              <button class="btn-clear-gallery" id="clearXMakerGallery">Clear All</button>
            ` : ''}
          </div>
          <div class="image-gallery">
            ${state.xmaker.generatedImages.length === 0 ? `
              <div class="empty-gallery">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <p>Hasil generate akan muncul di sini</p>
              </div>
            ` : `
              ${state.xmaker.generatedImages.map((img, idx) => `
                <div class="gallery-item">
                  <img src="${img.imageUrl || img.result_image_url}" alt="Generated ${idx + 1}" loading="lazy">
                  <div class="gallery-overlay">
                    <span class="scene-label">Scene ${img.sceneNumber || img.scene_number || idx + 1}</span>
                    <div class="gallery-actions">
                      <a href="${img.imageUrl || img.result_image_url}" download class="btn-download">⬇️</a>
                    </div>
                  </div>
                </div>
              `).join('')}
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderXMakerRoomModal() {
  if (!state.xmakerRoomManager.showRoomModal) return '';
  
  return `
    <div class="modal-overlay" id="xmakerRoomModalOverlay">
      <div class="modal room-modal">
        <div class="modal-header">
          <h2>Pilih X Maker Room</h2>
          <button class="modal-close" id="closeXMakerRoomModal">×</button>
        </div>
        <div class="modal-body">
          <div class="api-key-input-section">
            <label>Xclip API Key</label>
            <input type="password" id="xmakerXclipApiKey" placeholder="Masukkan Xclip API Key..." 
                   value="${state.xmakerRoomManager.xclipApiKey}" class="form-input">
            <p class="input-hint">Dapatkan API key dari menu Kelola API Key</p>
          </div>
          
          <div class="rooms-grid">
            ${state.xmakerRoomManager.rooms.map(room => `
              <div class="room-card ${room.current_users >= room.max_users ? 'room-full' : ''}">
                <div class="room-header">
                  <span class="room-name">${room.name}</span>
                  <span class="room-slots">${room.availableSlots}/${room.max_users} slot</span>
                </div>
                <div class="room-status">
                  <div class="status-bar">
                    <div class="status-fill" style="width: ${(room.current_users / room.max_users) * 100}%"></div>
                  </div>
                </div>
                <button class="btn-join-room" data-room-id="${room.id}" 
                        ${room.current_users >= room.max_users ? 'disabled' : ''}>
                  ${room.current_users >= room.max_users ? 'Penuh' : 'Join Room'}
                </button>
              </div>
            `).join('')}
          </div>
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
              <button class="btn btn-primary btn-full btn-generate" id="generateVideoBtn" data-cooldown="videogen" ${state.videogen.isGenerating || !state.videogen.sourceImage || state.videogen.tasks.length >= 3 ? 'disabled' : ''}>
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
              <span id="videogen-cooldown" style="display:none;text-align:center;color:var(--warning);font-size:13px;margin-top:6px;"></span>
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
                    <div class="task-item" data-task-id="${task.taskId}">
                      <div class="task-info">
                        <span class="task-number">Video ${idx + 1}</span>
                        <span class="task-time task-elapsed">${task.elapsed || 0}s</span>
                      </div>
                      <div class="video-progress-bar">
                        <div class="task-progress-fill" style="width: ${task.progress || 0}%"></div>
                      </div>
                      <span class="task-progress-text">${task.progress || 0}%</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              
              ${state.videogen.generatedVideos.length > 0 ? `
                <div class="generated-videos-list">
                  ${state.videogen.generatedVideos.map((video, idx) => `
                    <div class="video-result">
                      <video src="${video.url}" controls playsinline class="generated-video" ${idx === 0 ? 'autoplay' : ''} loop></video>
                      <div class="video-actions">
                        <button onclick="downloadVideo('${video.url}', 'xclip-video-${idx}.mp4')" class="btn btn-primary btn-sm">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          Download
                        </button>
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

function renderMotionPage() {
  return `
    <div class="container">
      <div class="hero">
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
          </svg>
          Motion Control
        </div>
        <h1 class="hero-title">
          <span class="gradient-text">Kling 2.6</span> Motion Control
        </h1>
        <p class="hero-subtitle">Transfer gerakan dari video referensi ke gambar karakter Anda dengan AI</p>
      </div>
      
      ${state.auth.user ? `
      <div class="room-manager-panel glass-card">
        <div class="room-manager-header">
          <div class="room-manager-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 12h8"/>
              <path d="M12 16l4-4-4-4"/>
            </svg>
            <span>Motion Room</span>
          </div>
          <div class="subscription-info">
            <span class="sub-badge active">Room ${state.motion.selectedRoom}</span>
          </div>
        </div>
        
        <div class="room-manager-content" style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
          <div class="room-selection" style="flex: 1; min-width: 280px;">
            <label class="setting-label" style="margin-bottom: 8px; display: block;">Pilih Room (Maks 3 user/room)</label>
            <div class="room-buttons" style="display: flex; gap: 6px; flex-wrap: wrap;">
              ${[1, 2, 3, 4, 5].map(roomId => {
                const usage = state.motion.roomUsage[roomId] || 0;
                const isFull = usage >= 3;
                const isSelected = state.motion.selectedRoom === roomId;
                return `<button 
                  class="btn ${isSelected ? 'btn-primary' : isFull ? 'btn-disabled' : 'btn-outline'}" 
                  data-motion-room="${roomId}" 
                  style="min-width: 70px; position: relative;" 
                  ${isFull && !isSelected ? 'disabled' : ''}>
                  Room ${roomId}
                  <span style="display: block; font-size: 10px; opacity: 0.8;">${usage}/3</span>
                </button>`;
              }).join('')}
            </div>
          </div>
          <div class="api-key-section" style="flex: 2; min-width: 280px;">
            <label class="setting-label" style="margin-bottom: 8px; display: block;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Xclip API Key
            </label>
            <input 
              type="password" 
              id="motionApiKey" 
              class="api-key-input"
              placeholder="Masukkan Xclip API key Anda..."
              value="${state.motion.customApiKey}"
              style="width: 100%;"
            >
            <p class="setting-hint" style="margin-top:4px;font-size:11px;">Buat Xclip API key di panel "Xclip Keys" untuk akses motion control</p>
          </div>
        </div>
      </div>
      ` : `
      <div class="room-manager-panel glass-card login-prompt-panel">
        <div class="login-prompt">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <h3>Login Diperlukan</h3>
          <p>Silakan login untuk menggunakan Motion Control</p>
          <button class="btn btn-primary" id="loginPromptBtn">Login Sekarang</button>
        </div>
      </div>
      `}
      
      <div class="videogen-workspace">
        <div class="videogen-left">
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
              <h2 class="card-title">Pengaturan Motion</h2>
            </div>
            <div class="card-body">
              <div class="settings-group">
                <label class="setting-label">Model AI</label>
                <div class="model-select-grid">
                  ${MOTION_MODELS.map(model => `
                    <div class="model-option ${state.motion.selectedModel === model.id ? 'selected' : ''}" data-model="${model.id}">
                      <span class="model-icon">${model.icon}</span>
                      <div class="model-info">
                        <span class="model-name">${model.name}</span>
                        <span class="model-desc">${model.desc}</span>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
              
              <div class="settings-group">
                <label class="setting-label">Orientasi Karakter</label>
                <div class="option-buttons">
                  <button class="option-btn ${state.motion.characterOrientation === 'video' ? 'active' : ''}" data-orientation="video">
                    <span class="option-icon">🎬</span>
                    <span class="option-label">Video</span>
                    <span class="option-desc">Ikuti orientasi video (max 30s)</span>
                  </button>
                  <button class="option-btn ${state.motion.characterOrientation === 'image' ? 'active' : ''}" data-orientation="image">
                    <span class="option-icon">🖼️</span>
                    <span class="option-label">Image</span>
                    <span class="option-desc">Ikuti orientasi gambar (max 10s)</span>
                  </button>
                </div>
              </div>
              
              <div class="character-input-section">
                <label class="setting-label">Prompt Motion (opsional)</label>
                <textarea 
                  id="motionPrompt" 
                  class="character-textarea"
                  placeholder="Deskripsikan gerakan yang diinginkan...

Contoh: Orang berjalan perlahan, tangan melambai, kepala menoleh ke kanan, tersenyum dengan mata berkedip"
                  rows="4"
                >${state.motion.prompt}</textarea>
              </div>
            </div>
          </div>
          
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
              <h2 class="card-title">Gambar Karakter</h2>
            </div>
            <div class="card-body">
              <div class="upload-zone small-upload" id="motionImageUploadZone">
                ${state.motion.characterImage ? `
                  <div class="uploaded-preview">
                    <img src="${state.motion.characterImage.preview}" alt="Character">
                    <button class="remove-upload" id="removeMotionImage">×</button>
                  </div>
                ` : `
                  <div class="upload-content">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>Upload gambar karakter</span>
                    <span class="upload-hint">JPG, PNG, WEBP (max 10MB)</span>
                  </div>
                `}
                <input type="file" id="motionImageInput" accept="image/*" style="display: none">
              </div>
            </div>
          </div>
          
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </div>
              <h2 class="card-title">Video Referensi Motion</h2>
            </div>
            <div class="card-body">
              <div class="upload-zone small-upload" id="motionVideoUploadZone">
                ${state.motion.referenceVideo ? `
                  <div class="uploaded-preview video-preview-thumb">
                    <video src="${state.motion.referenceVideo.preview}" muted></video>
                    <div class="video-overlay-info">
                      <span class="video-duration">${state.motion.referenceVideo.name}</span>
                    </div>
                    <button class="remove-upload" id="removeMotionVideo">×</button>
                  </div>
                ` : `
                  <div class="upload-content">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <polygon points="23 7 16 12 23 17 23 7"/>
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                    </svg>
                    <span>Upload video referensi</span>
                    <span class="upload-hint">MP4, MOV, WEBM (3-30 detik)</span>
                  </div>
                `}
                <input type="file" id="motionVideoInput" accept="video/*" style="display: none">
              </div>
            </div>
          </div>
          
          <button class="btn btn-primary btn-lg btn-full" id="generateMotionBtn" data-cooldown="motion" ${state.motion.isGenerating ? 'disabled' : ''}>
            ${state.motion.isGenerating ? `
              <svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"/>
              </svg>
              Generating...
            ` : `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M8 12h8"/>
                <path d="M12 16l4-4-4-4"/>
              </svg>
              Generate Motion Video
            `}
          </button>
          <span id="motion-cooldown" style="display:none;text-align:center;color:var(--warning);font-size:13px;margin-top:6px;"></span>
          
          ${state.motion.error ? `
            <div class="error-message">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              ${state.motion.error}
            </div>
          ` : ''}
        </div>
        
        <div class="videogen-right">
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </div>
              <h2 class="card-title">Hasil Motion Video</h2>
              ${state.motion.tasks.length > 0 ? `<span class="badge">${state.motion.tasks.length}</span>` : ''}
            </div>
            <div class="card-body">
              ${state.motion.tasks.length > 0 ? `
                <div class="task-list">
                  ${state.motion.tasks.map((task, idx) => `
                    <div class="task-item ${task.status}" data-motion-task="${task.taskId}">
                      <div class="task-header">
                        <span class="task-model">${MOTION_MODELS.find(m => m.id === task.model)?.name || task.model}</span>
                        <span class="task-status status-${task.status}">${task.status === 'processing' ? 'Processing...' : task.status === 'completed' ? 'Selesai' : task.status === 'failed' ? 'Gagal' : task.status}</span>
                      </div>
                      ${task.status === 'processing' ? `
                        <div class="task-progress">
                          <div class="progress-bar">
                            <div class="progress-fill task-progress-bar pulse" style="width: ${task.progress || 30}%"></div>
                          </div>
                          <span class="progress-text task-progress-text">${task.statusText || 'Generating motion video...'}</span>
                        </div>
                      ` : task.status === 'completed' && task.videoUrl ? `
                        <div class="task-result">
                          <video src="${task.videoUrl}" controls class="result-video"></video>
                          <div class="task-actions">
                            <a href="${task.videoUrl}" download="motion-${Date.now()}.mp4" class="btn btn-primary btn-sm">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                              </svg>
                              Download
                            </a>
                          </div>
                        </div>
                      ` : task.status === 'failed' ? `
                        <div class="task-error">${task.error || 'Generation failed'}</div>
                      ` : ''}
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              ${state.motion.generatedVideos.length > 0 ? `
                <div class="card-header" style="margin-top: 16px; padding: 0;">
                  <h3 style="font-size: 14px; opacity: 0.7;">History</h3>
                </div>
                <div class="video-gallery">
                  ${state.motion.generatedVideos.map((video, idx) => `
                    <div class="video-item">
                      <video src="${video.url}" controls class="result-video"></video>
                      <div class="task-actions" style="display: flex; gap: 8px; margin-top: 8px;">
                        <a href="${video.url}" download="motion-${video.taskId}.mp4" class="btn btn-primary btn-sm" style="flex:1">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          Download
                        </a>
                        <button class="btn btn-sm" style="opacity:0.6" onclick="deleteMotionHistory(${idx})">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-2 14H7L5 6"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              ${state.motion.tasks.length === 0 && state.motion.generatedVideos.length === 0 ? `
                <div class="empty-gallery">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M8 12h8"/>
                    <path d="M12 16l4-4-4-4"/>
                  </svg>
                  <p>Motion video yang di-generate akan muncul di sini</p>
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
      render(true); // Force render when switching pages
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
    buyPackageBtn.addEventListener('click', async () => {
      await fetchSubscriptionPlans();
      state.pricing.showModal = true;
      render();
    });
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
  
  // Use event delegation for dynamically created modal buttons
  document.body.addEventListener('click', (e) => {
    // Handle copy button clicks
    const copyBtn = e.target.closest('.copy-key-btn');
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const key = copyBtn.dataset.key;
      if (key) {
        copyToClipboard(key);
      }
      return;
    }
    
    // Handle revoke button clicks
    const revokeBtn = e.target.closest('.revoke-key-btn');
    if (revokeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const keyId = parseInt(revokeBtn.dataset.keyId);
      if (keyId && confirm('Apakah Anda yakin ingin menonaktifkan API key ini?')) {
        revokeXclipKey(keyId);
      }
      return;
    }
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
  } else if (state.currentPage === 'videogen') {
    attachVideoGenEventListeners();
  } else if (state.currentPage === 'vidgen2') {
    attachVidgen2EventListeners();
  } else if (state.currentPage === 'vidgen4') {
    attachVidgen4EventListeners();
  } else if (state.currentPage === 'vidgen3') {
    attachVidgen3EventListeners();
  } else if (state.currentPage === 'ximage') {
    attachXImageEventListeners();
  } else if (state.currentPage === 'xmaker') {
    attachXMakerEventListeners();
  } else if (state.currentPage === 'motion') {
    attachMotionEventListeners();
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
      saveUserInputs('chat');
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
  const showRoomModalBtn = document.getElementById('showXMakerRoomModal');
  if (showRoomModalBtn) {
    showRoomModalBtn.addEventListener('click', async () => {
      await fetchXMakerRooms();
      state.xmakerRoomManager.showRoomModal = true;
      render();
    });
  }
  
  const closeRoomModal = document.getElementById('closeXMakerRoomModal');
  const roomModalOverlay = document.getElementById('xmakerRoomModalOverlay');
  if (closeRoomModal) {
    closeRoomModal.addEventListener('click', () => {
      state.xmakerRoomManager.showRoomModal = false;
      render();
    });
  }
  if (roomModalOverlay) {
    roomModalOverlay.addEventListener('click', (e) => {
      if (e.target === roomModalOverlay) {
        state.xmakerRoomManager.showRoomModal = false;
        render();
      }
    });
  }
  
  const apiKeyInput = document.getElementById('xmakerXclipApiKey');
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (e) => {
      state.xmakerRoomManager.xclipApiKey = e.target.value;
      saveUserInputs('xmakerRoomManager');
    });
  }
  
  document.querySelectorAll('#xmakerRoomModalOverlay .btn-join-room').forEach(btn => {
    btn.addEventListener('click', async () => {
      const roomId = btn.dataset.roomId;
      await joinXMakerRoom(roomId);
    });
  });
  
  const leaveRoomBtn = document.getElementById('leaveXMakerRoom');
  if (leaveRoomBtn) {
    leaveRoomBtn.addEventListener('click', leaveXMakerRoom);
  }
  
  const refUpload = document.getElementById('xmakerReferenceUpload');
  const refInput = document.getElementById('xmakerReferenceInput');
  if (refUpload && refInput) {
    refUpload.addEventListener('click', (e) => {
      if (!e.target.closest('.btn-remove-ref')) {
        refInput.click();
      }
    });
    refInput.addEventListener('change', handleXMakerReferenceUpload);
  }
  
  const removeRef = document.getElementById('removeXMakerReference');
  if (removeRef) {
    removeRef.addEventListener('click', (e) => {
      e.stopPropagation();
      state.xmaker.referenceImage = null;
      render();
    });
  }
  
  document.querySelectorAll('.xmaker-settings .model-option').forEach(item => {
    item.addEventListener('click', () => {
      state.xmaker.selectedModel = item.dataset.model;
      saveUserInputs('xmaker');
      render();
    });
  });
  
  document.querySelectorAll('.xmaker-settings .style-option').forEach(item => {
    item.addEventListener('click', () => {
      state.xmaker.style = item.dataset.style;
      saveUserInputs('xmaker');
      render();
    });
  });
  
  document.querySelectorAll('.xmaker-settings .aspect-option').forEach(item => {
    item.addEventListener('click', () => {
      state.xmaker.aspectRatio = item.dataset.ratio;
      saveUserInputs('xmaker');
      render();
    });
  });
  
  document.querySelectorAll('.scene-textarea').forEach(textarea => {
    textarea.addEventListener('input', (e) => {
      const sceneId = parseInt(e.target.dataset.sceneId);
      const scene = state.xmaker.scenes.find(s => s.id === sceneId);
      if (scene) scene.description = e.target.value;
    });
  });
  
  document.querySelectorAll('.btn-remove-scene').forEach(btn => {
    btn.addEventListener('click', () => {
      const sceneId = parseInt(btn.dataset.sceneId);
      state.xmaker.scenes = state.xmaker.scenes.filter(s => s.id !== sceneId);
      render();
    });
  });
  
  const addSceneBtn = document.getElementById('addXMakerScene');
  if (addSceneBtn) {
    addSceneBtn.addEventListener('click', () => {
      const newId = Math.max(...state.xmaker.scenes.map(s => s.id), 0) + 1;
      state.xmaker.scenes.push({ id: newId, description: '' });
      render();
    });
  }
  
  const generateBtn = document.getElementById('generateXMakerImages');
  if (generateBtn) {
    generateBtn.addEventListener('click', generateXMakerImages);
  }
  
  const clearGallery = document.getElementById('clearXMakerGallery');
  if (clearGallery) {
    clearGallery.addEventListener('click', () => {
      state.xmaker.generatedImages = [];
      render();
    });
  }
}

function handleXMakerReferenceUpload(e) {
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

async function fetchXMakerRooms() {
  try {
    const response = await fetch(`${API_URL}/api/xmaker/rooms`, { credentials: 'include' });
    const data = await response.json();
    state.xmakerRoomManager.rooms = data.rooms || [];
  } catch (error) {
    console.error('Fetch xmaker rooms error:', error);
  }
}

async function fetchXMakerSubscription() {
  try {
    const response = await fetch(`${API_URL}/api/xmaker/subscription`, { credentials: 'include' });
    const data = await response.json();
    state.xmakerRoomManager.subscription = data.subscription;
    state.xmakerRoomManager.hasSubscription = data.subscription !== null;
  } catch (error) {
    console.error('Fetch xmaker subscription error:', error);
  }
}

async function joinXMakerRoom(roomId) {
  const apiKey = state.xmakerRoomManager.xclipApiKey;
  if (!apiKey) {
    showToast('Masukkan Xclip API Key terlebih dahulu', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/api/xmaker/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Xclip-Key': apiKey
      },
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      showToast(data.error || 'Gagal join room', 'error');
      return;
    }
    
    state.xmakerRoomManager.subscription = data.subscription;
    state.xmakerRoomManager.hasSubscription = true;
    state.xmakerRoomManager.showRoomModal = false;
    showToast(data.message, 'success');
    render();
  } catch (error) {
    console.error('Join xmaker room error:', error);
    showToast('Gagal join room', 'error');
  }
}

async function leaveXMakerRoom() {
  const apiKey = state.xmakerRoomManager.xclipApiKey;
  if (!apiKey) {
    showToast('Xclip API Key diperlukan', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/api/xmaker/rooms/leave`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Xclip-Key': apiKey
      },
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      showToast(data.error || 'Gagal keluar room', 'error');
      return;
    }
    
    state.xmakerRoomManager.subscription = null;
    state.xmakerRoomManager.hasSubscription = false;
    showToast(data.message, 'success');
    render();
  } catch (error) {
    console.error('Leave xmaker room error:', error);
    showToast('Gagal keluar room', 'error');
  }
}

async function generateXMakerImages() {
  const validScenes = state.xmaker.scenes.filter(s => s.description.trim());
  
  if (validScenes.length === 0) {
    showToast('Masukkan minimal 1 deskripsi scene', 'error');
    return;
  }
  
  if (!state.xmakerRoomManager.xclipApiKey) {
    showToast('Xclip API Key diperlukan', 'error');
    return;
  }
  
  state.xmaker.isGenerating = true;
  state.xmaker.currentSceneIndex = 0;
  render();
  
  for (let i = 0; i < validScenes.length; i++) {
    state.xmaker.currentSceneIndex = i;
    render();
    
    const scene = validScenes[i];
    showToast(`Generating scene ${i + 1}/${validScenes.length}...`, 'info');
    
    try {
      const response = await fetch(`${API_URL}/api/xmaker/generate`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Xclip-Key': state.xmakerRoomManager.xclipApiKey
        },
        credentials: 'include',
        body: JSON.stringify({
          prompt: scene.description,
          model: state.xmaker.selectedModel,
          style: state.xmaker.style,
          aspectRatio: state.xmaker.aspectRatio,
          referenceImage: state.xmaker.referenceImage?.data,
          sceneNumber: i + 1
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Gagal generate');
      }
      
      showToast(`Scene ${i + 1} submitted! Task ID: ${data.taskId}`, 'success');
      
    } catch (error) {
      console.error(`Scene ${i + 1} error:`, error);
      showToast(`Scene ${i + 1} gagal: ${error.message}`, 'error');
    }
  }
  
  state.xmaker.isGenerating = false;
  render();
  showToast('Semua scene telah disubmit. Hasil akan muncul ketika selesai.', 'success');
}

function attachVideoGenEventListeners() {
  // Load history if not loaded yet
  if (!state.videogen._historyLoaded) {
    state.videogen._historyLoaded = true;
    loadVideoGenHistory().then(() => render());
  }
  
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
      saveUserInputs('videogen');
      render();
    });
  });
  
  document.querySelectorAll('[data-videogen-duration]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.videogen.duration = btn.dataset.videogenDuration;
      saveUserInputs('videogen');
      render();
    });
  });
  
  document.querySelectorAll('[data-videogen-ratio]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.videogen.aspectRatio = btn.dataset.videogenRatio;
      saveUserInputs('videogen');
      render();
    });
  });
  
  if (promptInput) {
    promptInput.addEventListener('input', (e) => {
      state.videogen.prompt = e.target.value;
      saveUserInputs('videogen');
    });
  }
  
  const apiKeyInput = document.getElementById('videoGenApiKey');
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (e) => {
      state.videogen.customApiKey = e.target.value;
      saveUserInputs('videogen');
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

// ============ VIDGEN2 EVENT LISTENERS ============
// Vidgen2 cooldown timer
let vidgen2CooldownInterval = null;

function startVidgen2CooldownTimer() {
  if (vidgen2CooldownInterval) clearInterval(vidgen2CooldownInterval);
  
  vidgen2CooldownInterval = setInterval(() => {
    const now = Date.now();
    if (state.vidgen2.cooldownEndTime <= now) {
      clearInterval(vidgen2CooldownInterval);
      vidgen2CooldownInterval = null;
      state.vidgen2.cooldownEndTime = 0;
      localStorage.removeItem('vidgen2_cooldown');
      if (state.currentPage === 'vidgen2') render();
    } else if (state.currentPage === 'vidgen2') {
      render();
    }
  }, 1000);
}

function attachVidgen2EventListeners() {
  // Load rooms if not loaded yet
  if (state.vidgen2RoomManager.rooms.length === 0 && !state.vidgen2RoomManager.isLoading) {
    loadVidgen2Rooms().then(() => render());
  }
  
  // Load history if not loaded yet
  if (state.vidgen2.generatedVideos.length === 0 && !state.vidgen2._historyLoaded) {
    state.vidgen2._historyLoaded = true;
    loadVidgen2History().then(() => render());
  }
  
  // Start cooldown timer if active
  if (state.vidgen2.cooldownEndTime > Date.now() && !vidgen2CooldownInterval) {
    startVidgen2CooldownTimer();
  }
  
  const uploadZone = document.getElementById('vidgen2UploadZone');
  const imageInput = document.getElementById('vidgen2ImageInput');
  const removeImageBtn = document.getElementById('removeVidgen2Image');
  const generateBtn = document.getElementById('generateVidgen2Btn');
  const promptInput = document.getElementById('vidgen2Prompt');
  const apiKeyInput = document.getElementById('vidgen2ApiKey');
  
  if (uploadZone && imageInput) {
    uploadZone.addEventListener('click', () => imageInput.click());
    
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
      if (e.dataTransfer.files.length > 0) {
        handleVidgen2ImageUpload({ target: { files: e.dataTransfer.files } });
      }
    });
    
    imageInput.addEventListener('change', handleVidgen2ImageUpload);
  }
  
  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.vidgen2.sourceImage = null;
      render();
    });
  }
  
  if (generateBtn) {
    generateBtn.addEventListener('click', generateVidgen2Video);
  }
  
  if (promptInput) {
    promptInput.addEventListener('input', (e) => {
      state.vidgen2.prompt = e.target.value;
      saveUserInputs('vidgen2');
    });
  }
  
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (e) => {
      state.vidgen2.customApiKey = e.target.value;
      saveUserInputs('vidgen2');
    });
  }
  
  // Model selection and aspect ratio - use event delegation (only attach once)
  if (!window._vidgen2DelegationAttached) {
    window._vidgen2DelegationAttached = true;
    
    document.addEventListener('click', function(e) {
      // Model selection
      const modelCard = e.target.closest('[data-vidgen2-model]');
      if (modelCard && state.currentPage === 'vidgen2') {
        const newModel = modelCard.dataset.vidgen2Model;
        const wasGrok = state.vidgen2.selectedModel === 'grok-imagine';
        const isGrok = newModel === 'grok-imagine';
        state.vidgen2.selectedModel = newModel;
        if (wasGrok !== isGrok) {
          state.vidgen2.aspectRatio = isGrok ? '1:1' : '16:9';
        }
        saveUserInputs('vidgen2');
        render();
        return;
      }
      
      // Aspect ratio selection
      const ratioBtn = e.target.closest('[data-vidgen2-ratio]');
      if (ratioBtn && state.currentPage === 'vidgen2') {
        state.vidgen2.aspectRatio = ratioBtn.dataset.vidgen2Ratio;
        saveUserInputs('vidgen2');
        render();
        return;
      }
      
      // Grok mode selection
      const grokModeBtn = e.target.closest('[data-grok-mode]');
      if (grokModeBtn && state.currentPage === 'vidgen2') {
        state.vidgen2.grokMode = grokModeBtn.dataset.grokMode;
        saveUserInputs('vidgen2');
        render();
        return;
      }
    });
  }
  
  // Room selection
  const roomSelect = document.getElementById('vidgen2RoomSelect');
  if (roomSelect) {
    roomSelect.addEventListener('change', async (e) => {
      const roomId = e.target.value;
      if (roomId) {
        state.vidgen2.selectedRoom = parseInt(roomId);
        await joinVidgen2Room(parseInt(roomId));
      } else {
        state.vidgen2.selectedRoom = null;
      }
    });
  }
  
  // Delete video buttons
  document.querySelectorAll('.vidgen2-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const videoId = btn.dataset.videoId;
      if (!videoId) return;
      
      if (!confirm('Hapus video ini secara permanen?')) return;
      
      try {
        const response = await fetch(`${API_URL}/api/vidgen2/video/${videoId}`, {
          method: 'DELETE',
          credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
          state.vidgen2.generatedVideos = state.vidgen2.generatedVideos.filter(v => v.id != videoId);
          showToast('Video berhasil dihapus', 'success');
          render();
        } else {
          showToast(data.error || 'Gagal menghapus video', 'error');
        }
      } catch (error) {
        console.error('Delete video error:', error);
        showToast('Gagal menghapus video', 'error');
      }
    });
  });
  
  // Clear all videos button
  const clearAllBtn = document.getElementById('clearAllVidgen2');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (!confirm('Hapus semua video secara permanen? Tindakan ini tidak bisa dibatalkan.')) return;
      
      try {
        const response = await fetch(`${API_URL}/api/vidgen2/videos/all`, {
          method: 'DELETE',
          credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
          state.vidgen2.generatedVideos = [];
          showToast(data.message || 'Semua video berhasil dihapus', 'success');
          render();
        } else {
          showToast(data.error || 'Gagal menghapus video', 'error');
        }
      } catch (error) {
        console.error('Clear all videos error:', error);
        showToast('Gagal menghapus semua video', 'error');
      }
    });
  }
}

function handleVidgen2ImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    alert('Hanya file gambar yang diperbolehkan');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    state.vidgen2.sourceImage = {
      file: file,
      data: event.target.result,
      name: file.name
    };
    render();
  };
  reader.readAsDataURL(file);
}

async function generateVidgen2Video() {
  const isGrok = state.vidgen2.selectedModel === 'grok-imagine';
  if (!isGrok && !state.vidgen2.sourceImage) {
    alert('Upload gambar terlebih dahulu');
    return;
  }
  if (isGrok && !state.vidgen2.sourceImage && !state.vidgen2.prompt.trim()) {
    alert('Masukkan prompt atau upload gambar');
    return;
  }
  
  if (!state.vidgen2.customApiKey) {
    alert('Masukkan Xclip API Key');
    return;
  }
  
  if (state.vidgen2.tasks.length >= 3) {
    alert('Maks 3 video bersamaan. Tunggu salah satu selesai.');
    return;
  }
  
  // Check cooldown
  const now = Date.now();
  if (state.vidgen2.cooldownEndTime > now) {
    const remaining = Math.ceil((state.vidgen2.cooldownEndTime - now) / 1000);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    alert(`Cooldown aktif. Tunggu ${mins}:${secs.toString().padStart(2, '0')} lagi.`);
    return;
  }
  
  state.vidgen2.isGenerating = true;
  state.vidgen2.error = null;
  render();
  
  try {
    const response = await fetch(`${API_URL}/api/vidgen2/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Xclip-Key': state.vidgen2.customApiKey
      },
      body: JSON.stringify({
        model: state.vidgen2.selectedModel,
        prompt: state.vidgen2.prompt,
        image: state.vidgen2.sourceImage ? state.vidgen2.sourceImage.data : null,
        aspectRatio: state.vidgen2.aspectRatio,
        roomId: state.vidgen2.selectedRoom,
        grokMode: state.vidgen2.selectedModel === 'grok-imagine' ? state.vidgen2.grokMode : undefined
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Gagal generate video');
    }
    
    // Add task to tracking
    state.vidgen2.tasks.push({
      taskId: data.taskId,
      model: state.vidgen2.selectedModel,
      startTime: Date.now()
    });
    
    // Set 5 minute cooldown
    const cooldownEnd = Date.now() + (5 * 60 * 1000);
    state.vidgen2.cooldownEndTime = cooldownEnd;
    localStorage.setItem('vidgen2_cooldown', cooldownEnd.toString());
    startVidgen2CooldownTimer();
    
    // Start polling for this task
    pollVidgen2Task(data.taskId);
    
  } catch (error) {
    console.error('Vidgen2 error:', error);
    state.vidgen2.error = error.message;
    alert(error.message);
  } finally {
    state.vidgen2.isGenerating = false;
    render();
  }
}

async function pollVidgen2Task(taskId) {
  const maxAttempts = 720; // ~1 jam dengan interval 5 detik
  let attempts = 0;
  
  const poll = async () => {
    if (attempts >= maxAttempts) {
      // Timeout - mark as failed
      state.vidgen2.tasks = state.vidgen2.tasks.filter(t => t.taskId !== taskId);
      state.vidgen2.error = 'Timeout - video generation terlalu lama';
      showToast('Timeout - video generation terlalu lama', 'error');
      render();
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/api/vidgen2/tasks/${taskId}`, {
        headers: {
          'X-Xclip-Key': state.vidgen2.customApiKey
        }
      });
      
      const data = await response.json();
      
      if (data.status === 'completed' && data.videoUrl) {
        // Remove from tasks, add to generated videos
        state.vidgen2.tasks = state.vidgen2.tasks.filter(t => t.taskId !== taskId);
        state.vidgen2.generatedVideos.unshift({
          url: data.videoUrl,
          model: data.model,
          createdAt: new Date()
        });
        render();
        return;
      }
      
      if (data.status === 'failed') {
        state.vidgen2.tasks = state.vidgen2.tasks.filter(t => t.taskId !== taskId);
        state.vidgen2.error = data.error || 'Video generation failed';
        showToast(data.error || 'Video generation failed', 'error');
        render();
        return;
      }
      
      // Update task progress
      const task = state.vidgen2.tasks.find(t => t.taskId === taskId);
      if (task && data.progress) {
        task.progress = data.progress;
        render();
      }
      
      // Still processing, poll again
      attempts++;
      console.log(`[VIDGEN2] Poll attempt ${attempts}/${maxAttempts}, status: ${data.status}`);
      setTimeout(poll, 5000);
      
    } catch (error) {
      console.error('[VIDGEN2] Poll error:', error);
      attempts++;
      setTimeout(poll, 5000);
    }
  };
  
  poll();
}

function renderVidgen4Page() {
  const isSora2 = state.vidgen4.selectedModel === 'sora-2';
  const isVeo = state.vidgen4.selectedModel === 'veo3.1-fast';
  const models = [
    { id: 'sora-2', name: 'Sora 2', desc: 'Video hingga 15 detik, 720p', badge: 'STD', icon: '🎬' },
    { id: 'veo3.1-fast', name: 'Veo 3.1 Fast', desc: 'Video 8 detik, max 4K, start/end frame', badge: 'FAST', icon: '⚡' }
  ];
  
  const durationOptions = isSora2 ? [10, 15] : [8];
  const resolutionOptions = isVeo ? ['720p', '1080p', '4k'] : ['720p'];
  
  const styleOptions = [
    { value: 'none', label: 'None' },
    { value: 'thanksgiving', label: 'Thanksgiving' },
    { value: 'comic', label: 'Comic' },
    { value: 'news', label: 'News' },
    { value: 'selfie', label: 'Selfie' },
    { value: 'nostalgic', label: 'Nostalgic' },
    { value: 'anime', label: 'Anime' }
  ];
  
  return `
    <div class="container">
      <div class="hero">
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Vidgen4 - Apimart AI
        </div>
        <h1 class="hero-title">
          <span class="gradient-text">Vidgen4</span> AI Video
        </h1>
        <p class="hero-subtitle">Generate video dengan Sora 2 & Veo 3.1 Fast via Apimart.ai</p>
      </div>

      <div class="xmaker-layout">
        <div class="xmaker-settings">
          ${isSora2 ? `
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
              <h2 class="card-title">Reference Image</h2>
            </div>
            <div class="card-body">
              <div class="reference-upload ${state.vidgen4.sourceImage ? 'has-image' : ''}" id="vidgen4UploadZone">
                ${state.vidgen4.sourceImage ? `
                  <img src="${state.vidgen4.sourceImage.data}" alt="Source" class="reference-preview">
                  <button class="remove-reference" id="removeVidgen4Image">
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
                    <span>Klik untuk upload gambar (opsional)</span>
                    <span class="upload-hint">JPG, PNG, WebP (max 10MB)</span>
                  </div>
                `}
              </div>
              <input type="file" id="vidgen4ImageInput" accept="image/*" style="display: none">
            </div>
          </div>
          ` : `
          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
              <h2 class="card-title">Image to Video</h2>
            </div>
            <div class="card-body">
              <div class="setting-group">
                <label class="setting-label">Generation Type</label>
                <div class="aspect-ratio-selector">
                  <button class="aspect-btn ${state.vidgen4.generationType === 'frame' ? 'active' : ''}" data-vidgen4-gentype="frame">
                    <span>🎞️ Start/End Frame</span>
                  </button>
                  <button class="aspect-btn ${state.vidgen4.generationType === 'reference' ? 'active' : ''}" data-vidgen4-gentype="reference">
                    <span>🖼️ Reference</span>
                  </button>
                </div>
                <p class="setting-hint">${state.vidgen4.generationType === 'frame' ? 'Upload start frame dan end frame untuk mengontrol awal & akhir video' : 'Upload gambar referensi untuk gaya video (max 3)'}</p>
              </div>

              ${state.vidgen4.generationType === 'frame' ? `
              <div style="display:flex;gap:12px;margin-top:8px;">
                <div style="flex:1;">
                  <label class="setting-label" style="font-size:12px;margin-bottom:6px;">Start Frame</label>
                  <div class="reference-upload ${state.vidgen4.startFrame ? 'has-image' : ''}" id="vidgen4StartFrameZone" style="min-height:120px;">
                    ${state.vidgen4.startFrame ? `
                      <img src="${state.vidgen4.startFrame.data}" alt="Start" class="reference-preview">
                      <button class="remove-reference" id="removeVidgen4StartFrame">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    ` : `
                      <div class="reference-placeholder" style="padding:12px;">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2"/>
                          <polyline points="8 12 12 8 16 12"/>
                          <line x1="12" y1="16" x2="12" y2="8"/>
                        </svg>
                        <span style="font-size:11px;">Start Frame</span>
                      </div>
                    `}
                  </div>
                  <input type="file" id="vidgen4StartFrameInput" accept="image/jpeg,image/png,image/webp" style="display:none">
                </div>
                <div style="flex:1;">
                  <label class="setting-label" style="font-size:12px;margin-bottom:6px;">End Frame</label>
                  <div class="reference-upload ${state.vidgen4.endFrame ? 'has-image' : ''}" id="vidgen4EndFrameZone" style="min-height:120px;">
                    ${state.vidgen4.endFrame ? `
                      <img src="${state.vidgen4.endFrame.data}" alt="End" class="reference-preview">
                      <button class="remove-reference" id="removeVidgen4EndFrame">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    ` : `
                      <div class="reference-placeholder" style="padding:12px;">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2"/>
                          <polyline points="8 12 12 16 16 12"/>
                          <line x1="12" y1="8" x2="12" y2="16"/>
                        </svg>
                        <span style="font-size:11px;">End Frame</span>
                      </div>
                    `}
                  </div>
                  <input type="file" id="vidgen4EndFrameInput" accept="image/jpeg,image/png,image/webp" style="display:none">
                </div>
              </div>
              ` : `
              <div style="margin-top:8px;">
                <div class="reference-upload ${state.vidgen4.sourceImage ? 'has-image' : ''}" id="vidgen4UploadZone">
                  ${state.vidgen4.sourceImage ? `
                    <img src="${state.vidgen4.sourceImage.data}" alt="Source" class="reference-preview">
                    <button class="remove-reference" id="removeVidgen4Image">
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
                      <span>Klik untuk upload referensi (opsional, max 3)</span>
                      <span class="upload-hint">JPG, PNG, WebP (max 10MB)</span>
                    </div>
                  `}
                </div>
                <input type="file" id="vidgen4ImageInput" accept="image/*" style="display: none">
              </div>
              `}
            </div>
          </div>
          `}

          <div class="card glass-card">
            <div class="card-header">
              <div class="card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </div>
              <h2 class="card-title">Pilih Model</h2>
            </div>
            <div class="card-body">
              <div class="model-selector-grid">
                ${models.map(model => `
                  <div class="model-card ${state.vidgen4.selectedModel === model.id ? 'active' : ''}" data-vidgen4-model="${model.id}">
                    <div class="model-card-icon">${model.icon}</div>
                    <div class="model-card-info">
                      <div class="model-card-name">${model.name}</div>
                      <div class="model-card-desc">${model.desc}</div>
                    </div>
                    ${model.badge ? `<span class="model-card-badge ${model.badge.toLowerCase()}">${model.badge}</span>` : ''}
                  </div>
                `).join('')}
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
                <label class="setting-label">Aspect Ratio</label>
                <div class="aspect-ratio-selector">
                  ${['16:9', '9:16'].map(ratio => `
                    <button class="aspect-btn ${state.vidgen4.aspectRatio === ratio ? 'active' : ''}" data-vidgen4-ratio="${ratio}">
                      <div class="aspect-preview aspect-${ratio.replace(':', '-')}"></div>
                      <span>${ratio}</span>
                    </button>
                  `).join('')}
                </div>
              </div>

              <div class="setting-group">
                <label class="setting-label">Duration</label>
                <div class="aspect-ratio-selector">
                  ${durationOptions.map(d => `
                    <button class="aspect-btn ${state.vidgen4.duration === d ? 'active' : ''}" data-vidgen4-duration="${d}">
                      <span>${d}s</span>
                    </button>
                  `).join('')}
                </div>
              </div>

              ${isVeo ? `
              <div class="setting-group">
                <label class="setting-label">Resolution</label>
                <div class="aspect-ratio-selector">
                  ${resolutionOptions.map(r => `
                    <button class="aspect-btn ${state.vidgen4.resolution === r ? 'active' : ''}" data-vidgen4-resolution="${r}">
                      <span>${r}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
              ` : ''}

              ${isSora2 ? `
              <div class="setting-group">
                <label class="setting-label">Video Style</label>
                <select class="form-select" id="vidgen4StyleSelect">
                  ${styleOptions.map(s => `
                    <option value="${s.value}" ${state.vidgen4.style === s.value ? 'selected' : ''}>${s.label}</option>
                  `).join('')}
                </select>
              </div>

              <div class="setting-group">
                <label class="setting-label">Sora 2 Options</label>
                <div style="display:flex;flex-direction:column;gap:10px;">
                  <label class="toggle-switch-label" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px;cursor:pointer;">
                    <span style="font-size:13px;opacity:0.85;">Watermark</span>
                    <div class="toggle-switch-wrapper">
                      <input type="checkbox" id="vidgen4Watermark" ${state.vidgen4.watermark ? 'checked' : ''} style="display:none;">
                      <div class="toggle-track ${state.vidgen4.watermark ? 'active' : ''}" data-vidgen4-toggle="watermark" style="width:40px;height:22px;border-radius:11px;background:${state.vidgen4.watermark ? 'var(--primary, #6366f1)' : 'rgba(255,255,255,0.15)'};position:relative;cursor:pointer;transition:background 0.3s;">
                        <div style="width:18px;height:18px;border-radius:50%;background:white;position:absolute;top:2px;${state.vidgen4.watermark ? 'right:2px' : 'left:2px'};transition:all 0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
                      </div>
                    </div>
                  </label>
                  <label class="toggle-switch-label" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px;cursor:pointer;">
                    <span style="font-size:13px;opacity:0.85;">Video Thumbnail</span>
                    <div class="toggle-switch-wrapper">
                      <input type="checkbox" id="vidgen4Thumbnail" ${state.vidgen4.thumbnail ? 'checked' : ''} style="display:none;">
                      <div class="toggle-track ${state.vidgen4.thumbnail ? 'active' : ''}" data-vidgen4-toggle="thumbnail" style="width:40px;height:22px;border-radius:11px;background:${state.vidgen4.thumbnail ? 'var(--primary, #6366f1)' : 'rgba(255,255,255,0.15)'};position:relative;cursor:pointer;transition:background 0.3s;">
                        <div style="width:18px;height:18px;border-radius:50%;background:white;position:absolute;top:2px;${state.vidgen4.thumbnail ? 'right:2px' : 'left:2px'};transition:all 0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
                      </div>
                    </div>
                  </label>
                  <label class="toggle-switch-label" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px;cursor:pointer;">
                    <span style="font-size:13px;opacity:0.85;">Private Mode</span>
                    <div class="toggle-switch-wrapper">
                      <input type="checkbox" id="vidgen4Private" ${state.vidgen4.isPrivate ? 'checked' : ''} style="display:none;">
                      <div class="toggle-track ${state.vidgen4.isPrivate ? 'active' : ''}" data-vidgen4-toggle="isPrivate" style="width:40px;height:22px;border-radius:11px;background:${state.vidgen4.isPrivate ? 'var(--primary, #6366f1)' : 'rgba(255,255,255,0.15)'};position:relative;cursor:pointer;transition:background 0.3s;">
                        <div style="width:18px;height:18px;border-radius:50%;background:white;position:absolute;top:2px;${state.vidgen4.isPrivate ? 'right:2px' : 'left:2px'};transition:all 0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
                      </div>
                    </div>
                  </label>
                  <label class="toggle-switch-label" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px;cursor:pointer;">
                    <span style="font-size:13px;opacity:0.85;">Storyboard</span>
                    <div class="toggle-switch-wrapper">
                      <input type="checkbox" id="vidgen4Storyboard" ${state.vidgen4.storyboard ? 'checked' : ''} style="display:none;">
                      <div class="toggle-track ${state.vidgen4.storyboard ? 'active' : ''}" data-vidgen4-toggle="storyboard" style="width:40px;height:22px;border-radius:11px;background:${state.vidgen4.storyboard ? 'var(--primary, #6366f1)' : 'rgba(255,255,255,0.15)'};position:relative;cursor:pointer;transition:background 0.3s;">
                        <div style="width:18px;height:18px;border-radius:50%;background:white;position:absolute;top:2px;${state.vidgen4.storyboard ? 'right:2px' : 'left:2px'};transition:all 0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
                      </div>
                    </div>
                  </label>
                </div>
              </div>
              ` : ''}

              ${isVeo ? `
              <div class="setting-group">
                <label class="setting-label">Veo 3.1 Options</label>
                <div style="display:flex;flex-direction:column;gap:10px;">
                  <label class="toggle-switch-label" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px;cursor:pointer;">
                    <span style="font-size:13px;opacity:0.85;">Enable GIF</span>
                    <div class="toggle-switch-wrapper">
                      <input type="checkbox" id="vidgen4EnableGif" ${state.vidgen4.enableGif ? 'checked' : ''} style="display:none;">
                      <div class="toggle-track ${state.vidgen4.enableGif ? 'active' : ''}" data-vidgen4-toggle="enableGif" style="width:40px;height:22px;border-radius:11px;background:${state.vidgen4.enableGif ? 'var(--primary, #6366f1)' : 'rgba(255,255,255,0.15)'};position:relative;cursor:pointer;transition:background 0.3s;">
                        <div style="width:18px;height:18px;border-radius:50%;background:white;position:absolute;top:2px;${state.vidgen4.enableGif ? 'right:2px' : 'left:2px'};transition:all 0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
                      </div>
                    </div>
                  </label>
                </div>
                ${state.vidgen4.enableGif ? `<p class="setting-hint" style="color:#f59e0b;margin-top:4px;">⚠️ GIF tidak bisa digunakan dengan resolusi 1080p/4K</p>` : ''}
              </div>
              ` : ''}

              <div class="setting-group">
                <label class="setting-label">Prompt</label>
                <textarea 
                  class="form-textarea" 
                  id="vidgen4Prompt" 
                  placeholder="Deskripsikan video yang ingin dibuat..."
                  rows="3"
                >${state.vidgen4.prompt}</textarea>
              </div>

              <div class="setting-group">
                <label class="setting-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  Room
                </label>
                <select class="form-select" id="vidgen4RoomSelect">
                  <option value="">-- Pilih Room --</option>
                  ${state.vidgen4RoomManager.rooms.map(room => `
                    <option value="${room.id}" ${state.vidgen4.selectedRoom == room.id ? 'selected' : ''}>
                      ${room.name} (${room.active_users}/${room.max_users} users)
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="setting-group">
                <label class="setting-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:6px;">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  Xclip API Key
                </label>
                <input 
                  type="password" 
                  class="form-input" 
                  id="vidgen4ApiKey" 
                  placeholder="Masukkan Xclip API key..."
                  value="${state.vidgen4.customApiKey}"
                >
                <p class="setting-hint">Buat Xclip API key di panel "Xclip Keys"</p>
              </div>

              ${(() => {
                const now = Date.now();
                const isOnCooldown = state.vidgen4.cooldownEndTime > now;
                const cooldownSecs = isOnCooldown ? Math.ceil((state.vidgen4.cooldownEndTime - now) / 1000) : 0;
                const cooldownMins = Math.floor(cooldownSecs / 60);
                const cooldownRemSecs = cooldownSecs % 60;
                const hasImage = state.vidgen4.sourceImage || state.vidgen4.startFrame || state.vidgen4.endFrame;
                const needsPrompt = !state.vidgen4.prompt.trim() && !hasImage;
                const isDisabled = state.vidgen4.isGenerating || needsPrompt || state.vidgen4.tasks.length >= 3 || isOnCooldown;
                
                return `<button class="btn btn-primary btn-lg btn-full" id="generateVidgen4Btn" ${isDisabled ? 'disabled' : ''}>
                ${state.vidgen4.isGenerating ? `
                  <div class="spinner"></div>
                  <span>Generating...</span>
                ` : isOnCooldown ? `
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>Cooldown ${cooldownMins}:${cooldownRemSecs.toString().padStart(2, '0')}</span>
                ` : `
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  <span>Generate Video${state.vidgen4.tasks.length > 0 ? ' (' + state.vidgen4.tasks.length + '/3)' : ''}</span>
                `}
              </button>`;
              })()}
              ${!state.vidgen4.prompt.trim() && !state.vidgen4.sourceImage ? '<p class="setting-hint" style="text-align:center;margin-top:12px;opacity:0.7;">Masukkan prompt atau upload gambar</p>' : ''}
              ${state.vidgen4.tasks.length >= 3 ? '<p class="setting-hint warning" style="text-align:center;margin-top:12px;">Maks 3 video bersamaan. Tunggu salah satu selesai.</p>' : ''}
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
              ${renderVidgen4Tasks()}
              ${renderVidgen4Videos()}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderVidgen4Tasks() {
  if (state.vidgen4.tasks.length === 0) return '';
  
  let html = '<div class="processing-tasks">';
  html += '<div class="tasks-header"><span class="pulse-dot"></span> Sedang Diproses (' + state.vidgen4.tasks.length + '/3)</div>';
  html += '<div class="tasks-list">';
  
  state.vidgen4.tasks.forEach(task => {
    const elapsed = Math.floor((Date.now() - task.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    html += '<div class="task-item">';
    html += '<div class="task-info">';
    html += '<span class="task-model">' + task.model + '</span>';
    html += '<span class="task-time">' + mins + ':' + secs.toString().padStart(2, '0') + '</span>';
    html += '</div>';
    html += '<div class="task-progress"><div class="task-progress-bar" style="width:' + (task.progress || 0) + '%"></div></div>';
    html += '</div>';
  });
  
  html += '</div></div>';
  return html;
}

function renderVidgen4Videos() {
  if (state.vidgen4.generatedVideos.length === 0) {
    return '<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></div><p>Belum ada video yang dihasilkan</p></div>';
  }
  
  let html = '<div class="video-grid">';
  state.vidgen4.generatedVideos.forEach(video => {
    html += '<div class="video-result-card">';
    html += '<video controls playsinline preload="metadata" class="result-video">';
    html += '<source src="' + video.url + '" type="video/mp4">';
    html += '</video>';
    html += '<div class="video-meta">';
    html += '<span class="video-model-tag">' + video.model + '</span>';
    if (video.prompt) html += '<p class="video-prompt-text" style="font-size:11px;opacity:0.7;margin:4px 0 0;">' + (video.prompt.length > 80 ? video.prompt.substring(0, 80) + '...' : video.prompt) + '</p>';
    html += '</div></div>';
  });
  html += '</div>';
  return html;
}

// ============ VIDGEN4 EVENT HANDLERS ============

let vidgen4CooldownInterval = null;

function startVidgen4CooldownTimer() {
  if (vidgen4CooldownInterval) clearInterval(vidgen4CooldownInterval);
  vidgen4CooldownInterval = setInterval(() => {
    const now = Date.now();
    if (state.vidgen4.cooldownEndTime <= now) {
      clearInterval(vidgen4CooldownInterval);
      vidgen4CooldownInterval = null;
      state.vidgen4.cooldownEndTime = 0;
      localStorage.removeItem('vidgen4_cooldown');
      if (state.currentPage === 'vidgen4') render();
    } else if (state.currentPage === 'vidgen4') {
      render();
    }
  }, 1000);
}

function attachVidgen4EventListeners() {
  if (state.vidgen4RoomManager.rooms.length === 0 && !state.vidgen4RoomManager.isLoading) {
    loadVidgen4Rooms().then(() => render());
  }
  
  if (state.vidgen4.generatedVideos.length === 0 && !state.vidgen4._historyLoaded) {
    state.vidgen4._historyLoaded = true;
    loadVidgen4History().then(() => render());
  }
  
  if (state.vidgen4.cooldownEndTime > Date.now() && !vidgen4CooldownInterval) {
    startVidgen4CooldownTimer();
  }
  
  const uploadZone = document.getElementById('vidgen4UploadZone');
  const imageInput = document.getElementById('vidgen4ImageInput');
  const removeImageBtn = document.getElementById('removeVidgen4Image');
  const generateBtn = document.getElementById('generateVidgen4Btn');
  const promptInput = document.getElementById('vidgen4Prompt');
  const apiKeyInput = document.getElementById('vidgen4ApiKey');
  
  if (uploadZone && imageInput) {
    uploadZone.addEventListener('click', () => imageInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
    uploadZone.addEventListener('dragleave', () => { uploadZone.classList.remove('drag-over'); });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        handleVidgen4ImageUpload({ target: { files: e.dataTransfer.files } });
      }
    });
    imageInput.addEventListener('change', handleVidgen4ImageUpload);
  }
  
  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.vidgen4.sourceImage = null;
      render();
    });
  }

  const startFrameZone = document.getElementById('vidgen4StartFrameZone');
  const startFrameInput = document.getElementById('vidgen4StartFrameInput');
  const removeStartFrame = document.getElementById('removeVidgen4StartFrame');
  if (startFrameZone && startFrameInput) {
    startFrameZone.addEventListener('click', () => startFrameInput.click());
    startFrameInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.vidgen4.startFrame = { file, data: ev.target.result, name: file.name };
        render();
      };
      reader.readAsDataURL(file);
    });
  }
  if (removeStartFrame) {
    removeStartFrame.addEventListener('click', (e) => {
      e.stopPropagation();
      state.vidgen4.startFrame = null;
      render();
    });
  }

  const endFrameZone = document.getElementById('vidgen4EndFrameZone');
  const endFrameInput = document.getElementById('vidgen4EndFrameInput');
  const removeEndFrame = document.getElementById('removeVidgen4EndFrame');
  if (endFrameZone && endFrameInput) {
    endFrameZone.addEventListener('click', () => endFrameInput.click());
    endFrameInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.vidgen4.endFrame = { file, data: ev.target.result, name: file.name };
        render();
      };
      reader.readAsDataURL(file);
    });
  }
  if (removeEndFrame) {
    removeEndFrame.addEventListener('click', (e) => {
      e.stopPropagation();
      state.vidgen4.endFrame = null;
      render();
    });
  }
  
  if (generateBtn) {
    generateBtn.addEventListener('click', generateVidgen4Video);
  }
  
  if (promptInput) {
    promptInput.addEventListener('input', (e) => {
      state.vidgen4.prompt = e.target.value;
      saveUserInputs('vidgen4');
    });
  }
  
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (e) => {
      state.vidgen4.customApiKey = e.target.value;
      saveUserInputs('vidgen4');
    });
  }

  const vidgen4StyleSelect = document.getElementById('vidgen4StyleSelect');
  if (vidgen4StyleSelect) {
    vidgen4StyleSelect.addEventListener('change', (e) => {
      state.vidgen4.style = e.target.value;
    });
  }

  document.querySelectorAll('[data-vidgen4-toggle]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const field = toggle.getAttribute('data-vidgen4-toggle');
      state.vidgen4[field] = !state.vidgen4[field];
      render();
    });
  });

  
  if (!window._vidgen4DelegationAttached) {
    window._vidgen4DelegationAttached = true;
    
    document.addEventListener('click', function(e) {
      const modelCard = e.target.closest('[data-vidgen4-model]');
      if (modelCard && state.currentPage === 'vidgen4') {
        const newModel = modelCard.dataset.vidgen4Model;
        state.vidgen4.selectedModel = newModel;
        const validDurations = newModel === 'sora-2' ? [10, 15] : [8];
        if (!validDurations.includes(state.vidgen4.duration)) {
          state.vidgen4.duration = validDurations[0];
        }
        const validResolutions = newModel === 'veo3.1-fast' ? ['720p', '1080p', '4k'] : ['720p'];
        if (!validResolutions.includes(state.vidgen4.resolution)) {
          state.vidgen4.resolution = validResolutions[0];
        }
        saveUserInputs('vidgen4');
        render();
        return;
      }
      
      const ratioBtn = e.target.closest('[data-vidgen4-ratio]');
      if (ratioBtn && state.currentPage === 'vidgen4') {
        state.vidgen4.aspectRatio = ratioBtn.dataset.vidgen4Ratio;
        saveUserInputs('vidgen4');
        render();
        return;
      }
      
      const durationBtn = e.target.closest('[data-vidgen4-duration]');
      if (durationBtn && state.currentPage === 'vidgen4') {
        state.vidgen4.duration = parseInt(durationBtn.dataset.vidgen4Duration);
        saveUserInputs('vidgen4');
        render();
        return;
      }

      const resolutionBtn = e.target.closest('[data-vidgen4-resolution]');
      if (resolutionBtn && state.currentPage === 'vidgen4') {
        state.vidgen4.resolution = resolutionBtn.dataset.vidgen4Resolution;
        saveUserInputs('vidgen4');
        render();
        return;
      }

      const genTypeBtn = e.target.closest('[data-vidgen4-gentype]');
      if (genTypeBtn && state.currentPage === 'vidgen4') {
        state.vidgen4.generationType = genTypeBtn.dataset.vidgen4Gentype;
        render();
        return;
      }
      
    });
  }
  
  const roomSelect = document.getElementById('vidgen4RoomSelect');
  if (roomSelect) {
    roomSelect.addEventListener('change', async (e) => {
      const roomId = e.target.value;
      if (roomId) {
        state.vidgen4.selectedRoom = parseInt(roomId);
        await joinVidgen4Room(parseInt(roomId));
      } else {
        state.vidgen4.selectedRoom = null;
      }
    });
  }
}

function handleVidgen4ImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Hanya file gambar yang diperbolehkan');
    return;
  }
  const reader = new FileReader();
  reader.onload = (event) => {
    state.vidgen4.sourceImage = {
      file: file,
      data: event.target.result,
      name: file.name
    };
    render();
  };
  reader.readAsDataURL(file);
}

async function generateVidgen4Video() {
  const hasAnyImage = state.vidgen4.sourceImage || state.vidgen4.startFrame || state.vidgen4.endFrame;
  if (!state.vidgen4.prompt.trim() && !hasAnyImage) {
    alert('Masukkan prompt atau upload gambar');
    return;
  }
  
  if (!state.vidgen4.customApiKey) {
    alert('Masukkan Xclip API Key');
    return;
  }
  
  if (state.vidgen4.tasks.length >= 3) {
    alert('Maks 3 video bersamaan. Tunggu salah satu selesai.');
    return;
  }
  
  const now = Date.now();
  if (state.vidgen4.cooldownEndTime > now) {
    const remaining = Math.ceil((state.vidgen4.cooldownEndTime - now) / 1000);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    alert(`Cooldown aktif. Tunggu ${mins}:${secs.toString().padStart(2, '0')} lagi.`);
    return;
  }
  
  state.vidgen4.isGenerating = true;
  state.vidgen4.error = null;
  render();
  
  try {
    const response = await fetch(`${API_URL}/api/vidgen4/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Xclip-Key': state.vidgen4.customApiKey
      },
      body: JSON.stringify({
        model: state.vidgen4.selectedModel,
        prompt: state.vidgen4.prompt,
        image: state.vidgen4.selectedModel === 'sora-2' && state.vidgen4.sourceImage ? state.vidgen4.sourceImage.data : null,
        startFrame: state.vidgen4.selectedModel === 'veo3.1-fast' && state.vidgen4.generationType === 'frame' && state.vidgen4.startFrame ? state.vidgen4.startFrame.data : null,
        endFrame: state.vidgen4.selectedModel === 'veo3.1-fast' && state.vidgen4.generationType === 'frame' && state.vidgen4.endFrame ? state.vidgen4.endFrame.data : null,
        referenceImage: state.vidgen4.selectedModel === 'veo3.1-fast' && state.vidgen4.generationType === 'reference' && state.vidgen4.sourceImage ? state.vidgen4.sourceImage.data : null,
        generationType: state.vidgen4.selectedModel === 'veo3.1-fast' ? state.vidgen4.generationType : undefined,
        aspectRatio: state.vidgen4.aspectRatio,
        duration: state.vidgen4.duration,
        resolution: state.vidgen4.resolution,
        enableGif: state.vidgen4.enableGif,
        watermark: state.vidgen4.watermark,
        thumbnail: state.vidgen4.thumbnail,
        isPrivate: state.vidgen4.isPrivate,
        style: state.vidgen4.style,
        storyboard: state.vidgen4.storyboard,
        roomId: state.vidgen4.selectedRoom
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Gagal generate video');
    }
    
    state.vidgen4.tasks.push({
      taskId: data.taskId,
      model: state.vidgen4.selectedModel,
      startTime: Date.now()
    });
    
    const cooldownEnd = Date.now() + (5 * 60 * 1000);
    state.vidgen4.cooldownEndTime = cooldownEnd;
    localStorage.setItem('vidgen4_cooldown', cooldownEnd.toString());
    startVidgen4CooldownTimer();
    
    pollVidgen4Task(data.taskId);
    
  } catch (error) {
    console.error('Vidgen4 error:', error);
    state.vidgen4.error = error.message;
    alert(error.message);
  } finally {
    state.vidgen4.isGenerating = false;
    render();
  }
}

async function pollVidgen4Task(taskId) {
  const maxAttempts = 720;
  let attempts = 0;
  
  const poll = async () => {
    if (attempts >= maxAttempts) {
      state.vidgen4.tasks = state.vidgen4.tasks.filter(t => t.taskId !== taskId);
      state.vidgen4.error = 'Timeout - video generation terlalu lama';
      showToast('Timeout - video generation terlalu lama', 'error');
      render();
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/api/vidgen4/tasks/${taskId}`, {
        headers: { 'X-Xclip-Key': state.vidgen4.customApiKey }
      });
      
      const data = await response.json();
      
      if (data.status === 'completed' && data.videoUrl) {
        state.vidgen4.tasks = state.vidgen4.tasks.filter(t => t.taskId !== taskId);
        state.vidgen4.generatedVideos.unshift({
          url: data.videoUrl,
          model: data.model,
          createdAt: new Date()
        });
        showToast('Video berhasil digenerate!', 'success');
        render();
        return;
      }
      
      if (data.status === 'failed') {
        state.vidgen4.tasks = state.vidgen4.tasks.filter(t => t.taskId !== taskId);
        state.vidgen4.error = data.error || 'Video generation failed';
        showToast(data.error || 'Video generation failed', 'error');
        render();
        return;
      }
      
      const task = state.vidgen4.tasks.find(t => t.taskId === taskId);
      if (task && data.progress) {
        task.progress = data.progress;
        render();
      }
      
      attempts++;
      console.log(`[VIDGEN4] Poll attempt ${attempts}/${maxAttempts}, status: ${data.status}`);
      setTimeout(poll, 5000);
      
    } catch (error) {
      console.error('[VIDGEN4] Poll error:', error);
      attempts++;
      setTimeout(poll, 5000);
    }
  };
  
  poll();
}

// ============ VIDGEN3 EVENT HANDLERS ============

let vidgen3CooldownInterval = null;

function startVidgen3CooldownTimer() {
  if (vidgen3CooldownInterval) clearInterval(vidgen3CooldownInterval);
  vidgen3CooldownInterval = setInterval(() => {
    const now = Date.now();
    if (state.vidgen3.cooldownEndTime <= now) {
      clearInterval(vidgen3CooldownInterval);
      vidgen3CooldownInterval = null;
      state.vidgen3.cooldownEndTime = 0;
      localStorage.removeItem('vidgen3_cooldown');
      if (state.currentPage === 'vidgen3') render();
    } else if (state.currentPage === 'vidgen3') {
      render();
    }
  }, 1000);
}

function attachVidgen3EventListeners() {
  if (state.vidgen3RoomManager.rooms.length === 0 && !state.vidgen3RoomManager.isLoading) {
    loadVidgen3Rooms().then(() => render());
  }

  if (state.vidgen3.generatedVideos.length === 0 && !state.vidgen3._historyLoaded) {
    state.vidgen3._historyLoaded = true;
    loadVidgen3History().then(() => render());
  }

  if (state.vidgen3.cooldownEndTime > Date.now() && !vidgen3CooldownInterval) {
    startVidgen3CooldownTimer();
  }

  const uploadZone = document.getElementById('vidgen3UploadZone');
  const imageInput = document.getElementById('vidgen3ImageInput');
  const removeImageBtn = document.getElementById('removeVidgen3Image');
  const generateBtn = document.getElementById('generateVidgen3Btn');
  const promptInput = document.getElementById('vidgen3Prompt');
  const apiKeyInput = document.getElementById('vidgen3ApiKey');
  const audioUrlInput = document.getElementById('vidgen3AudioUrl');

  if (uploadZone && imageInput) {
    uploadZone.addEventListener('click', () => imageInput.click());

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
      if (e.dataTransfer.files.length > 0) {
        handleVidgen3ImageUpload({ target: { files: e.dataTransfer.files } });
      }
    });

    imageInput.addEventListener('change', handleVidgen3ImageUpload);
  }

  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.vidgen3.sourceImage = null;
      render();
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', generateVidgen3Video);
  }

  if (promptInput) {
    promptInput.addEventListener('input', (e) => {
      state.vidgen3.prompt = e.target.value;
      saveUserInputs('vidgen3');
    });
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (e) => {
      state.vidgen3.customApiKey = e.target.value;
      saveUserInputs('vidgen3');
    });
  }

  if (audioUrlInput) {
    audioUrlInput.addEventListener('input', (e) => {
      state.vidgen3.audioFile = e.target.value ? { url: e.target.value } : null;
    });
  }

  const audioToggle = document.getElementById('vidgen3AudioToggle');
  if (audioToggle) {
    audioToggle.addEventListener('change', (e) => {
      state.vidgen3.generateAudio = e.target.checked;
      saveUserInputs('vidgen3');
    });
  }

  const cameraToggle = document.getElementById('vidgen3CameraToggle');
  if (cameraToggle) {
    cameraToggle.addEventListener('change', (e) => {
      state.vidgen3.cameraFixed = e.target.checked;
      saveUserInputs('vidgen3');
    });
  }

  const turboToggle = document.getElementById('vidgen3TurboToggle');
  if (turboToggle) {
    turboToggle.addEventListener('change', (e) => {
      state.vidgen3.turboMode = e.target.checked;
      saveUserInputs('vidgen3');
    });
  }

  if (!window._vidgen3DelegationAttached) {
    window._vidgen3DelegationAttached = true;

    document.addEventListener('click', function(e) {
      const modelCard = e.target.closest('[data-vidgen3-model]');
      if (modelCard && state.currentPage === 'vidgen3') {
        state.vidgen3.selectedModel = modelCard.dataset.vidgen3Model;
        saveUserInputs('vidgen3');
        render();
        return;
      }

      const aspectBtn = e.target.closest('[data-vidgen3-aspect]');
      if (aspectBtn && state.currentPage === 'vidgen3') {
        state.vidgen3.aspectRatio = aspectBtn.dataset.vidgen3Aspect;
        saveUserInputs('vidgen3');
        render();
        return;
      }

      const durationBtn = e.target.closest('[data-vidgen3-duration]');
      if (durationBtn && state.currentPage === 'vidgen3') {
        state.vidgen3.duration = parseInt(durationBtn.dataset.vidgen3Duration);
        saveUserInputs('vidgen3');
        render();
        return;
      }

      const resolutionBtn = e.target.closest('[data-vidgen3-resolution]');
      if (resolutionBtn && state.currentPage === 'vidgen3') {
        state.vidgen3.resolution = resolutionBtn.dataset.vidgen3Resolution;
        saveUserInputs('vidgen3');
        render();
        return;
      }

      const fpsBtn = e.target.closest('[data-vidgen3-fps]');
      if (fpsBtn && state.currentPage === 'vidgen3') {
        state.vidgen3.fps = parseInt(fpsBtn.dataset.vidgen3Fps);
        saveUserInputs('vidgen3');
        render();
        return;
      }

      const ratioBtn = e.target.closest('[data-vidgen3-ratio]');
      if (ratioBtn && state.currentPage === 'vidgen3') {
        state.vidgen3.ratio = ratioBtn.dataset.vidgen3Ratio;
        saveUserInputs('vidgen3');
        render();
        return;
      }
    });
  }

  const roomSelect = document.getElementById('vidgen3RoomSelect');
  if (roomSelect) {
    roomSelect.addEventListener('change', async (e) => {
      const roomId = e.target.value;
      if (roomId) {
        state.vidgen3.selectedRoom = parseInt(roomId);
        await joinVidgen3Room(parseInt(roomId));
      } else {
        state.vidgen3.selectedRoom = null;
      }
    });
  }

  document.querySelectorAll('.vidgen3-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const videoId = btn.dataset.videoId;
      if (!videoId) return;

      if (!confirm('Hapus video ini secara permanen?')) return;

      try {
        const response = await fetch(`${API_URL}/api/vidgen3/video/${videoId}`, {
          method: 'DELETE',
          credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
          state.vidgen3.generatedVideos = state.vidgen3.generatedVideos.filter(v => v.id != videoId);
          showToast('Video berhasil dihapus', 'success');
          render();
        } else {
          showToast(data.error || 'Gagal menghapus video', 'error');
        }
      } catch (error) {
        console.error('Delete video error:', error);
        showToast('Gagal menghapus video', 'error');
      }
    });
  });

  const clearAllBtn = document.getElementById('clearAllVidgen3');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (!confirm('Hapus semua video secara permanen? Tindakan ini tidak bisa dibatalkan.')) return;

      try {
        const response = await fetch(`${API_URL}/api/vidgen3/videos/all`, {
          method: 'DELETE',
          credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
          state.vidgen3.generatedVideos = [];
          showToast(data.message || 'Semua video berhasil dihapus', 'success');
          render();
        } else {
          showToast(data.error || 'Gagal menghapus video', 'error');
        }
      } catch (error) {
        console.error('Clear all videos error:', error);
        showToast('Gagal menghapus semua video', 'error');
      }
    });
  }
}

function handleVidgen3ImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Hanya file gambar yang diperbolehkan');
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    state.vidgen3.sourceImage = {
      file: file,
      data: event.target.result,
      name: file.name
    };
    render();
  };
  reader.readAsDataURL(file);
}

async function generateVidgen3Video() {
  const model = state.vidgen3.selectedModel;
  const isOmniHuman = model === 'omnihuman-1.5';
  const isI2VOnly = model === 'minimax-live' || model === 'runway-gen4-turbo';

  if (isOmniHuman) {
    if (!state.vidgen3.sourceImage) { alert('Upload gambar terlebih dahulu'); return; }
    if (!state.vidgen3.audioFile) { alert('Masukkan audio URL terlebih dahulu'); return; }
  } else if (isI2VOnly) {
    if (!state.vidgen3.sourceImage) { alert('Upload gambar terlebih dahulu'); return; }
  }

  if (!state.vidgen3.customApiKey) { alert('Masukkan Xclip API Key'); return; }
  if (state.vidgen3.tasks.length >= 3) { alert('Maks 3 video bersamaan'); return; }

  if (state.vidgen3.cooldownEndTime > Date.now()) {
    const remaining = Math.ceil((state.vidgen3.cooldownEndTime - Date.now()) / 1000);
    alert(`Cooldown aktif. Tunggu ${Math.floor(remaining/60)}:${(remaining%60).toString().padStart(2,'0')} lagi.`);
    return;
  }

  state.vidgen3.isGenerating = true;
  state.vidgen3.error = null;
  render();

  try {
    let actualModel = model;
    if (!state.vidgen3.sourceImage) {
      if (model === 'ltx-2-pro-i2v') actualModel = 'ltx-2-pro-t2v';
      else if (model === 'ltx-2-fast-i2v') actualModel = 'ltx-2-fast-t2v';
      else if (model === 'runway-4.5-i2v') actualModel = 'runway-4.5-t2v';
    }

    const body = {
      model: actualModel,
      prompt: state.vidgen3.prompt,
      image: state.vidgen3.sourceImage?.data || null,
      duration: state.vidgen3.duration,
      aspectRatio: state.vidgen3.aspectRatio,
      resolution: state.vidgen3.resolution,
      fps: state.vidgen3.fps,
      generateAudio: state.vidgen3.generateAudio,
      cameraFixed: state.vidgen3.cameraFixed,
      ratio: state.vidgen3.ratio,
      turboMode: state.vidgen3.turboMode,
      audioUrl: state.vidgen3.audioFile?.url || null
    };

    const response = await fetch(`${API_URL}/api/vidgen3/proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Xclip-Key': state.vidgen3.customApiKey
      },
      body: JSON.stringify(body)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Gagal generate video');
    }

    state.vidgen3.tasks.push({
      taskId: result.taskId,
      model: actualModel,
      status: 'processing',
      progress: 0
    });

    state.vidgen3.cooldownEndTime = Date.now() + 60000;
    localStorage.setItem('vidgen3_cooldown', state.vidgen3.cooldownEndTime.toString());
    startVidgen3CooldownTimer();

    pollVidgen3Task(result.taskId, actualModel);
    showToast('Video sedang diproses...', 'success');

  } catch (error) {
    console.error('Vidgen3 generate error:', error);
    showToast(error.message, 'error');
  } finally {
    state.vidgen3.isGenerating = false;
    render();
  }
}

function pollVidgen3Task(taskId, model) {
  const maxAttempts = 600;
  let attempts = 0;

  setTimeout(() => poll(), 5000);

  const poll = async () => {
    try {
      const task = state.vidgen3.tasks.find(t => t.taskId === taskId);
      if (!task) return;

      const response = await fetch(`${API_URL}/api/vidgen3/tasks/${taskId}?model=${encodeURIComponent(model)}`, {
        headers: { 'X-Xclip-Key': state.vidgen3.customApiKey }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 404) {
          task.status = 'failed';
          task.error = 'Task tidak ditemukan';
          render();
          return;
        }
        throw new Error(errorData.error || 'Gagal cek status');
      }

      const data = await response.json();
      task.status = data.status;
      task.progress = data.progress || 0;

      if (data.status === 'completed' && data.videoUrl) {
        task.videoUrl = data.videoUrl;

        const exists = state.vidgen3.generatedVideos.some(v => v.taskId === taskId);
        if (!exists) {
          state.vidgen3.generatedVideos.unshift({
            url: data.videoUrl,
            model: model,
            taskId: taskId,
            createdAt: new Date().toISOString()
          });
        }
        state.vidgen3.tasks = state.vidgen3.tasks.filter(t => t.taskId !== taskId);
        showToast('Video berhasil di-generate!', 'success');
        render();
        return;
      }

      if (data.status === 'failed') {
        task.error = data.error || 'Generation gagal';
        state.vidgen3.tasks = state.vidgen3.tasks.filter(t => t.taskId !== taskId);
        showToast('Gagal generate video', 'error');
        render();
        return;
      }

      render();
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(poll, 5000);
      } else {
        task.status = 'failed';
        task.error = 'Timeout';
        render();
      }
    } catch (error) {
      console.error('Poll vidgen3 error:', error);
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(poll, 5000);
      }
    }
  };
}

// ============ X IMAGE EVENT HANDLERS ============
// Global function for inline onclick handlers
window.openXimageRoomModalFn = async function() {
  console.log('[XIMAGE] Global room modal function called');
  state.ximageRoomManager.showRoomModal = true;
  render();
  await loadXImageRooms();
};

function attachXImageEventListeners() {
  console.log('[XIMAGE] attachXImageEventListeners called');
  
  // Load history and subscription status on first visit
  if (state.ximage.generatedImages.length === 0 && !state.ximage._historyLoaded) {
    loadXImageHistory().then(function() { render(); });
  }
  
  // Load subscription status
  if (!state.ximageRoomManager._statusLoaded) {
    state.ximageRoomManager._statusLoaded = true;
    loadXImageSubscriptionStatus().then(function() { render(); });
  }
  
  var uploadZone = document.getElementById('ximageUploadZone');
  var imageInput = document.getElementById('ximageFileInput');
  var removeImageBtn = document.getElementById('removeXimageImage');
  var generateBtn = document.getElementById('generateXimageBtn');
  var promptInput = document.getElementById('ximagePrompt');
  var apiKeyInput = document.getElementById('ximageApiKey');
  
  if (uploadZone && imageInput) {
    uploadZone.addEventListener('click', function() { imageInput.click(); });
    
    uploadZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      uploadZone.classList.add('drag-over');
    });
    
    uploadZone.addEventListener('dragleave', function() {
      uploadZone.classList.remove('drag-over');
    });
    
    uploadZone.addEventListener('drop', function(e) {
      e.preventDefault();
      uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        handleXImageUpload({ target: { files: e.dataTransfer.files } });
      }
    });
    
    imageInput.addEventListener('change', handleXImageUpload);
  }
  
  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      state.ximage.sourceImage = null;
      render();
    });
  }

  var uploadZone2 = document.getElementById('ximageUploadZone2');
  var imageInput2 = document.getElementById('ximageFileInput2');
  var removeImageBtn2 = document.getElementById('removeXimageImage2');

  if (uploadZone2 && imageInput2) {
    uploadZone2.addEventListener('click', function() { imageInput2.click(); });
    uploadZone2.addEventListener('dragover', function(e) {
      e.preventDefault();
      uploadZone2.classList.add('drag-over');
    });
    uploadZone2.addEventListener('dragleave', function() {
      uploadZone2.classList.remove('drag-over');
    });
    uploadZone2.addEventListener('drop', function(e) {
      e.preventDefault();
      uploadZone2.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        handleXImageUpload2({ target: { files: e.dataTransfer.files } });
      }
    });
    imageInput2.addEventListener('change', handleXImageUpload2);
  }

  if (removeImageBtn2) {
    removeImageBtn2.addEventListener('click', function(e) {
      e.stopPropagation();
      state.ximage.sourceImage2 = null;
      render();
    });
  }
  
  if (generateBtn) {
    generateBtn.addEventListener('click', generateXImage);
  }
  
  if (promptInput) {
    promptInput.addEventListener('input', function(e) {
      state.ximage.prompt = e.target.value;
      saveUserInputs('ximage');
    });
  }
  
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', function(e) {
      state.ximage.customApiKey = e.target.value;
      saveUserInputs('ximage');
    });
  }
  
  // Event delegation for mode, model, and aspect ratio selection
  if (!window._ximageDelegationAttached) {
    window._ximageDelegationAttached = true;
    
    document.addEventListener('click', function(e) {
      // Mode selection
      var modeBtn = e.target.closest('[data-ximage-mode]');
      if (modeBtn && state.currentPage === 'ximage') {
        var newMode = modeBtn.dataset.ximageMode;
        state.ximage.mode = newMode;
        state.ximage.sourceImage2 = null;
        
        // Auto-select compatible model when switching to image-to-image
        if (newMode === 'image-to-image') {
          var ximageModels = [
            { id: 'gpt-image-1.5', supportsI2I: true },
            { id: 'gpt-4o-image', supportsI2I: true },
            { id: 'nano-banana', supportsI2I: true },
            { id: 'nano-banana-2', supportsI2I: true },
            { id: 'seedream-4.5', supportsI2I: true },
            { id: 'flux-2-pro', supportsI2I: true },
            { id: 'z-image', supportsI2I: false },
            { id: 'grok-imagine-image', supportsI2I: true }
          ];
          var currentModel = ximageModels.find(function(m) { return m.id === state.ximage.selectedModel; });
          if (!currentModel || !currentModel.supportsI2I) {
            var compatibleModel = ximageModels.find(function(m) { return m.supportsI2I; });
            if (compatibleModel) state.ximage.selectedModel = compatibleModel.id;
          }
        }
        
        saveUserInputs('ximage');
        render();
        return;
      }
      
      // Model selection
      var modelCard = e.target.closest('[data-ximage-model]');
      if (modelCard && state.currentPage === 'ximage' && !modelCard.classList.contains('disabled')) {
        var newModelId = modelCard.dataset.ximageModel;
        var modelsWithMultiRef = ['nano-banana-2', 'flux-2-pro'];
        if (!modelsWithMultiRef.includes(newModelId)) {
          state.ximage.sourceImage2 = null;
        }
        state.ximage.selectedModel = newModelId;
        saveUserInputs('ximage');
        render();
        return;
      }
      
      // Aspect ratio selection
      var ratioBtn = e.target.closest('[data-ximage-ratio]');
      if (ratioBtn && state.currentPage === 'ximage') {
        state.ximage.aspectRatio = ratioBtn.dataset.ximageRatio;
        saveUserInputs('ximage');
        render();
        return;
      }
      
      // Resolution selection
      var resBtn = e.target.closest('[data-ximage-resolution]');
      if (resBtn && state.currentPage === 'ximage') {
        state.ximage.resolution = resBtn.dataset.ximageResolution;
        saveUserInputs('ximage');
        render();
        return;
      }
      
      // Number of images
      var numBtn = e.target.closest('[data-ximage-num-action]');
      if (numBtn && state.currentPage === 'ximage') {
        var action = numBtn.dataset.ximageNumAction;
        if (action === 'increase' && state.ximage.numberOfImages < 4) {
          state.ximage.numberOfImages++;
        } else if (action === 'decrease' && state.ximage.numberOfImages > 1) {
          state.ximage.numberOfImages--;
        }
        saveUserInputs('ximage');
        render();
        return;
      }
    });
  }
  
  // X Image Room modal event listeners
  var openXimageRoomModal = document.getElementById('openXimageRoomModal');
  var changeXimageRoom = document.getElementById('changeXimageRoom');
  console.log('[XIMAGE] Room buttons:', { openBtn: !!openXimageRoomModal, changeBtn: !!changeXimageRoom });
  if (openXimageRoomModal) {
    openXimageRoomModal.onclick = async function(e) {
      e.preventDefault();
      console.log('[XIMAGE] Open room modal clicked');
      state.ximageRoomManager.showRoomModal = true;
      render();
      await loadXImageRooms();
    };
  }
  if (changeXimageRoom) {
    changeXimageRoom.onclick = async function(e) {
      e.preventDefault();
      console.log('[XIMAGE] Change room clicked');
      state.ximageRoomManager.showRoomModal = true;
      render();
      await loadXImageRooms();
    };
  }
  
  var closeXimageRoomModal = document.getElementById('closeXimageRoomModal');
  var ximageRoomModalOverlay = document.getElementById('ximageRoomModalOverlay');
  if (closeXimageRoomModal) {
    closeXimageRoomModal.addEventListener('click', function() {
      state.ximageRoomManager.showRoomModal = false;
      render();
    });
  }
  if (ximageRoomModalOverlay) {
    ximageRoomModalOverlay.addEventListener('click', function(e) {
      if (e.target === ximageRoomModalOverlay) {
        state.ximageRoomManager.showRoomModal = false;
        render();
      }
    });
  }
  
  var ximageRoomApiKeyInput = document.getElementById('ximageRoomApiKeyInput');
  if (ximageRoomApiKeyInput) {
    ximageRoomApiKeyInput.addEventListener('input', function(e) {
      state.ximageRoomManager.xclipApiKey = e.target.value;
      saveUserInputs('ximageRoomManager');
    });
  }
  
  // X Image room join buttons
  document.querySelectorAll('.join-ximage-room-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var roomId = parseInt(btn.dataset.roomId);
      joinXImageRoom(roomId);
    });
  });
  
  // X Image download buttons
  document.querySelectorAll('.ximage-download-btn').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.preventDefault();
      var url = decodeURIComponent(btn.dataset.url);
      var filename = btn.dataset.filename;
      console.log('[XIMAGE] Download clicked:', url, filename);
      await downloadImage(url, filename);
    });
  });
}

function handleXImageUpload(e) {
  var file = e.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    alert('Pilih file gambar');
    return;
  }
  
  var reader = new FileReader();
  reader.onload = function(event) {
    state.ximage.sourceImage = {
      file: file,
      data: event.target.result,
      name: file.name
    };
    render();
  };
  reader.readAsDataURL(file);
}

function handleXImageUpload2(e) {
  var file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Pilih file gambar');
    return;
  }

  var reader = new FileReader();
  reader.onload = function(event) {
    state.ximage.sourceImage2 = {
      file: file,
      data: event.target.result,
      name: file.name
    };
    render();
  };
  reader.readAsDataURL(file);
}

async function generateXImage() {
  if (state.ximage.mode === 'image-to-image' && !state.ximage.sourceImage) {
    alert('Upload gambar referensi terlebih dahulu');
    return;
  }
  
  if (!state.ximage.prompt) {
    alert('Masukkan prompt');
    return;
  }
  
  if (!state.ximage.customApiKey) {
    alert('Masukkan Xclip API Key');
    return;
  }
  
  if (state.ximage.tasks.length >= 3) {
    alert('Maks 3 gambar bersamaan. Tunggu salah satu selesai.');
    return;
  }
  
  // Validate model compatibility with mode
  var modelsNotSupportingI2I = ['z-image'];
  if (state.ximage.mode === 'image-to-image' && modelsNotSupportingI2I.includes(state.ximage.selectedModel)) {
    alert('Model ini tidak mendukung mode Image-to-Image. Pilih model lain.');
    return;
  }
  
  state.ximage.isGenerating = true;
  state.ximage.error = null;
  render();
  
  try {
    var requestBody = {
      model: state.ximage.selectedModel,
      prompt: state.ximage.prompt,
      aspectRatio: state.ximage.aspectRatio,
      mode: state.ximage.mode,
      resolution: state.ximage.resolution,
      numberOfImages: state.ximage.numberOfImages
    };
    
    if (state.ximage.mode === 'image-to-image' && state.ximage.sourceImage) {
      requestBody.image = state.ximage.sourceImage.data;
      var multiRefModels = ['nano-banana-2', 'flux-2-pro'];
      if (state.ximage.sourceImage2 && multiRefModels.includes(state.ximage.selectedModel)) {
        requestBody.image2 = state.ximage.sourceImage2.data;
      }
    }
    
    var response = await fetch(API_URL + '/api/ximage/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Xclip-Key': state.ximage.customApiKey
      },
      body: JSON.stringify(requestBody)
    });
    
    var data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Gagal generate image');
    }
    
    // Add task to tracking
    state.ximage.tasks.push({
      taskId: data.taskId,
      model: state.ximage.selectedModel,
      startTime: Date.now()
    });
    
    // Start polling for this task
    pollXImageTask(data.taskId);
    
  } catch (error) {
    console.error('X Image error:', error);
    state.ximage.error = error.message;
    alert(error.message);
  } finally {
    state.ximage.isGenerating = false;
    render();
  }
}

async function pollXImageTask(taskId) {
  var maxAttempts = 120; // ~10 minutes with 5s interval (image is faster than video)
  var attempts = 0;
  
  var poll = async function() {
    if (attempts >= maxAttempts) {
      state.ximage.tasks = state.ximage.tasks.filter(function(t) { return t.taskId !== taskId; });
      state.ximage.error = 'Timeout: Image generation terlalu lama';
      render();
      return;
    }
    
    attempts++;
    
    try {
      var response = await fetch(API_URL + '/api/ximage/status/' + taskId, {
        headers: { 'X-Xclip-Key': state.ximage.customApiKey }
      });
      
      var data = await response.json();
      
      if (data.status === 'completed' && data.imageUrl) {
        state.ximage.tasks = state.ximage.tasks.filter(function(t) { return t.taskId !== taskId; });
        state.ximage.generatedImages.unshift({
          url: data.imageUrl,
          model: state.ximage.selectedModel,
          prompt: state.ximage.prompt,
          createdAt: new Date().toISOString()
        });
        render();
        return;
      }
      
      if (data.status === 'failed') {
        state.ximage.tasks = state.ximage.tasks.filter(function(t) { return t.taskId !== taskId; });
        state.ximage.error = data.error || 'Image generation failed';
        render();
        return;
      }
      
      // Update task progress
      var task = state.ximage.tasks.find(function(t) { return t.taskId === taskId; });
      if (task) {
        task.progress = data.progress || Math.min(90, attempts * 3);
        task.status = data.message || 'Processing...';
      }
      render();
      
      console.log('[XIMAGE] Poll attempt ' + attempts + '/' + maxAttempts + ', status: ' + data.status);
      setTimeout(poll, 5000);
      
    } catch (error) {
      console.error('[XIMAGE] Poll error:', error);
      attempts++;
      setTimeout(poll, 5000);
    }
  };
  
  poll();
}

async function loadXImageHistory() {
  try {
    var response = await fetch(API_URL + '/api/ximage/history', { credentials: 'include' });
    var data = await response.json();
    
    if (data.images) {
      state.ximage.generatedImages = data.images.map(function(img) {
        return {
          url: img.imageUrl,
          model: img.model,
          prompt: img.prompt,
          createdAt: img.createdAt
        };
      });
    }
    state.ximage._historyLoaded = true;
  } catch (error) {
    console.error('Failed to load X Image history:', error);
  }
}

function attachMotionEventListeners() {
  if (!state.motion._historyLoaded) {
    state.motion._historyLoaded = true;
    loadMotionHistory().then(() => render());
  }
  
  const imageUploadZone = document.getElementById('motionImageUploadZone');
  const imageInput = document.getElementById('motionImageInput');
  const videoUploadZone = document.getElementById('motionVideoUploadZone');
  const videoInput = document.getElementById('motionVideoInput');
  const removeImageBtn = document.getElementById('removeMotionImage');
  const removeVideoBtn = document.getElementById('removeMotionVideo');
  const generateBtn = document.getElementById('generateMotionBtn');
  const promptInput = document.getElementById('motionPrompt');
  
  if (imageUploadZone && imageInput) {
    imageUploadZone.addEventListener('click', (e) => {
      if (!e.target.closest('.remove-upload')) {
        imageInput.click();
      }
    });
    
    imageInput.addEventListener('change', handleMotionImageUpload);
  }
  
  if (videoUploadZone && videoInput) {
    videoUploadZone.addEventListener('click', (e) => {
      if (!e.target.closest('.remove-upload')) {
        videoInput.click();
      }
    });
    
    videoInput.addEventListener('change', handleMotionVideoUpload);
  }
  
  if (removeImageBtn) {
    removeImageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.motion.characterImage = null;
      render();
    });
  }
  
  if (removeVideoBtn) {
    removeVideoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.motion.referenceVideo = null;
      render();
    });
  }
  
  document.querySelectorAll('.model-option[data-model]').forEach(option => {
    option.addEventListener('click', () => {
      const model = option.dataset.model;
      if (MOTION_MODELS.find(m => m.id === model)) {
        state.motion.selectedModel = model;
        saveUserInputs('motion');
        render();
      }
    });
  });
  
  document.querySelectorAll('.option-btn[data-orientation]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.motion.characterOrientation = btn.dataset.orientation;
      saveUserInputs('motion');
      render();
    });
  });
  
  if (promptInput) {
    promptInput.addEventListener('input', (e) => {
      state.motion.prompt = e.target.value;
      saveUserInputs('motion');
    });
  }
  
  if (generateBtn) {
    generateBtn.addEventListener('click', generateMotion);
  }
  
  const loginPromptBtn = document.getElementById('loginPromptBtn');
  if (loginPromptBtn) {
    loginPromptBtn.addEventListener('click', () => {
      state.auth.showModal = true;
      state.auth.modalMode = 'login';
      render();
    });
  }
  
  // Motion room event listeners
  const openMotionRoomModalBtn = document.getElementById('openMotionRoomModalBtn');
  if (openMotionRoomModalBtn) {
    openMotionRoomModalBtn.addEventListener('click', async () => {
      state.motionRoomManager.showRoomModal = true;
      await loadMotionRooms();
      render();
    });
  }
  
  const closeMotionRoomModal = document.getElementById('closeMotionRoomModal');
  const motionRoomModalOverlay = document.getElementById('motionRoomModalOverlay');
  if (closeMotionRoomModal) {
    closeMotionRoomModal.addEventListener('click', () => {
      state.motionRoomManager.showRoomModal = false;
      render();
    });
  }
  if (motionRoomModalOverlay) {
    motionRoomModalOverlay.addEventListener('click', (e) => {
      if (e.target === motionRoomModalOverlay) {
        state.motionRoomManager.showRoomModal = false;
        render();
      }
    });
  }
  
  const motionRoomApiKeyInput = document.getElementById('motionRoomApiKeyInput');
  if (motionRoomApiKeyInput) {
    motionRoomApiKeyInput.addEventListener('input', (e) => {
      state.motionRoomManager.xclipApiKey = e.target.value;
      saveUserInputs('motionRoomManager');
    });
  }
  
  // Motion room selection buttons
  document.querySelectorAll('[data-motion-room]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.motion.selectedRoom = parseInt(btn.dataset.motionRoom);
      render();
    });
  });
  
  // Motion API key input
  const motionApiKey = document.getElementById('motionApiKey');
  if (motionApiKey) {
    motionApiKey.addEventListener('input', (e) => {
      state.motion.customApiKey = e.target.value;
    });
  }
}

function handleMotionImageUpload(e) {
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
    state.motion.characterImage = {
      name: file.name,
      type: file.type,
      data: event.target.result,
      preview: event.target.result
    };
    render();
    showToast('Gambar karakter berhasil diupload!', 'success');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function handleMotionVideoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('video/')) {
    showToast('Silakan upload file video', 'error');
    return;
  }
  
  if (file.size > 100 * 1024 * 1024) {
    showToast('Ukuran video maksimal 100MB', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    state.motion.referenceVideo = {
      name: file.name,
      type: file.type,
      data: event.target.result,
      preview: URL.createObjectURL(file)
    };
    render();
    showToast('Video referensi berhasil diupload!', 'success');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

async function generateMotion() {
  if (!state.motion.characterImage) {
    showToast('Silakan upload gambar karakter terlebih dahulu', 'error');
    return;
  }
  
  if (!state.motion.referenceVideo) {
    showToast('Silakan upload video referensi terlebih dahulu', 'error');
    return;
  }
  
  if (!state.auth.user) {
    showToast('Silakan login terlebih dahulu', 'error');
    state.auth.showModal = true;
    state.auth.modalMode = 'login';
    render();
    return;
  }
  
  const motionApiKey = state.motion.customApiKey || state.motionRoomManager.xclipApiKey;
  if (!motionApiKey && !state.admin.isAdmin) {
    showToast('Masukkan Xclip API key terlebih dahulu', 'error');
    return;
  }
  
  const activeTasks = state.motion.tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
  if (activeTasks.length >= 2) {
    showToast('Maksimal 2 motion task dapat diproses bersamaan', 'error');
    return;
  }
  
  state.motion.isGenerating = true;
  state.motion.error = null;
  render();
  
  try {
    const requestBody = {
      model: state.motion.selectedModel,
      characterImage: state.motion.characterImage.data,
      referenceVideo: state.motion.referenceVideo.data,
      prompt: state.motion.prompt || '',
      characterOrientation: state.motion.characterOrientation,
      roomId: state.motion.selectedRoom
    };
    
    const headers = { 
      'Content-Type': 'application/json',
      'X-Xclip-Key': motionApiKey
    };
    
    const response = await fetch(`${API_URL}/api/motion/generate`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const error = await response.json();
      if (response.status === 429 && error.cooldown) {
        startCooldownTimer('motion', error.cooldown);
      }
      throw new Error(error.error || 'Gagal generate motion');
    }
    
    const result = await response.json();
    
    if (result.cooldown) {
      startCooldownTimer('motion', result.cooldown);
    }
    
    state.motion.tasks.unshift({
      taskId: result.taskId,
      model: state.motion.selectedModel,
      status: 'processing',
      progress: 0,
      statusText: 'Memulai motion generation...',
      createdAt: new Date().toISOString(),
      apiKey: motionApiKey  // Store API key with task for polling
    });
    
    state.motion.isGenerating = false;
    render();
    
    showToast('Motion generation dimulai!', 'success');
    
    pollMotionStatus(result.taskId, state.motion.selectedModel, motionApiKey);
    
  } catch (error) {
    console.error('Motion generation error:', error);
    state.motion.isGenerating = false;
    state.motion.error = error.message;
    render();
    showToast(error.message, 'error');
  }
}

function updateMotionTaskUI(taskId) {
  const task = state.motion.tasks.find(t => t.taskId === taskId);
  if (!task) return;
  
  const taskEl = document.querySelector(`[data-motion-task="${taskId}"]`);
  if (!taskEl) return;
  
  const statusEl = taskEl.querySelector('.task-status');
  const progressEl = taskEl.querySelector('.task-progress-bar');
  const progressTextEl = taskEl.querySelector('.task-progress-text');
  
  if (statusEl) {
    if (task.status === 'completed') {
      statusEl.textContent = 'Selesai';
      statusEl.className = 'task-status completed';
    } else if (task.status === 'failed') {
      statusEl.textContent = task.error || 'Gagal';
      statusEl.className = 'task-status failed';
    } else {
      statusEl.textContent = task.statusText || 'Processing...';
      statusEl.className = 'task-status processing';
    }
  }
  if (progressEl) {
    progressEl.style.width = `${task.progress || 0}%`;
  }
  if (progressTextEl) {
    progressTextEl.textContent = `${task.progress || 0}%`;
  }
}

function pollMotionStatus(taskId, model, apiKey) {
  console.log('[MOTION POLL] Starting polling for task:', taskId, 'with apiKey:', apiKey ? 'present' : 'missing');
  
  const maxAttempts = 1200;
  let attempts = 0;
  state.motion.isPolling = true;
  
  console.log('[MOTION POLL] Waiting 5 seconds before first poll...');
  setTimeout(() => poll(), 5000);
  
  const stopPolling = () => {
    const hasActiveTasks = state.motion.tasks.some(t => t.taskId !== taskId && t.status !== 'completed' && t.status !== 'failed');
    if (!hasActiveTasks) {
      state.motion.isPolling = false;
    }
  };
  
  const poll = async () => {
    try {
      const task = state.motion.tasks.find(t => t.taskId === taskId);
      if (!task) {
        console.log('[MOTION POLL] Task not found in state, stopping poll');
        stopPolling();
        return;
      }
      
      const xclipKey = apiKey || task.apiKey || state.motion.customApiKey || state.motionRoomManager.xclipApiKey || state.videogen.customApiKey;
      
      if (!xclipKey) {
        console.error('[MOTION POLL] No API key available');
        task.status = 'failed';
        task.error = 'Xclip API key diperlukan';
        stopPolling();
        render();
        return;
      }
      
      const headers = { 
        'Content-Type': 'application/json',
        'X-Xclip-Key': xclipKey
      };
      
      const response = await fetch(`${API_URL}/api/motion/tasks/${taskId}?model=${encodeURIComponent(model)}`, {
        method: 'GET',
        headers: headers
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Motion status error:', response.status, errorData);
        
        if (response.status === 404 || errorData.message === 'Not found' || errorData.error?.includes('tidak ditemukan')) {
          if (!task._notFoundCount) task._notFoundCount = 0;
          task._notFoundCount++;
          console.log(`[MOTION POLL] 404 count: ${task._notFoundCount}/10 for task ${taskId}`);
          if (task._notFoundCount >= 10) {
            task.status = 'failed';
            task.error = 'Task expired atau tidak ditemukan';
            stopPolling();
            render();
            return;
          }
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(poll, 5000);
          }
          return;
        }
        
        throw new Error(errorData.error || `Gagal mengambil status task (${response.status})`);
      }
      
      const data = await response.json();
      
      task.status = data.status;
      task.progress = data.progress || 0;
      task.statusText = data.status === 'processing' ? 'Generating motion video...' : data.status;
      
      if (data.status === 'completed' && data.videoUrl) {
        task.videoUrl = data.videoUrl;
        showToast('Motion video selesai!', 'success');
        stopPolling();
        render();
        return;
      }
      
      if (data.status === 'failed') {
        task.error = 'Motion generation gagal';
        showToast('Motion generation gagal', 'error');
        stopPolling();
        render();
        return;
      }
      
      updateMotionTaskUI(taskId);
      
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(poll, 5000);
      } else {
        task.status = 'failed';
        task.error = 'Timeout - motion generation terlalu lama';
        stopPolling();
        render();
      }
      
    } catch (error) {
      console.error('Poll motion error:', error);
      const task = state.motion.tasks.find(t => t.taskId === taskId);
      if (task) {
        task.status = 'failed';
        task.error = error.message;
        stopPolling();
        render();
      }
    }
  };
  
  poll();
}

async function deleteMotionHistory(index) {
  const video = state.motion.generatedVideos[index];
  if (!video) return;
  
  state.motion.generatedVideos.splice(index, 1);
  render();
  
  if (video.taskId) {
    try {
      await fetch(`${API_URL}/api/motion/history/${video.taskId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
    } catch (error) {
      console.error('Failed to delete motion history:', error);
    }
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
      if (response.status === 429 && error.cooldown) {
        startCooldownTimer('videogen', error.cooldown);
      }
      throw new Error(error.error || 'Failed to generate video');
    }
    
    const data = await response.json();
    
    if (data.cooldown) {
      startCooldownTimer('videogen', data.cooldown);
    }
    
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
  
  // Set polling flag to prevent render glitches
  state.videogen.isPolling = true;
  
  const poll = async () => {
    try {
      const task = state.videogen.tasks.find(t => t.taskId === taskId);
      if (!task) {
        console.log(`[POLL] Task ${taskId} not found in state, stopping polling`);
        return;
      }
      
      console.log(`[POLL] Checking task ${taskId}, attempt ${attempts + 1}/${maxAttempts}`);
      
      const headers = { 
        'Content-Type': 'application/json'
      };
      
      // Add API key if available
      if (state.videogen.customApiKey) {
        headers['X-Xclip-Key'] = state.videogen.customApiKey;
      }
      
      const response = await fetch(`${API_URL}/api/videogen/tasks/${taskId}?model=${encodeURIComponent(model)}`, {
        method: 'GET',
        headers: headers,
        credentials: 'include' // Allow session-based auth as fallback
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
      console.log(`[POLL] Response for ${taskId}:`, data);
      
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      task.elapsed = elapsedSec;
      
      // Check for completion FIRST (priority)
      const isCompleted = data.status === 'completed' || data.status === 'COMPLETED';
      if (isCompleted && data.videoUrl) {
        task.status = 'completed';
        task.videoUrl = data.videoUrl;
        // Check if video with this taskId already exists (prevent duplicates from SSE)
        const alreadyExists = state.videogen.generatedVideos.some(v => v.taskId === taskId);
        if (!alreadyExists) {
          state.videogen.generatedVideos.unshift({ url: data.videoUrl, createdAt: Date.now(), taskId });
        }
        state.videogen.tasks = state.videogen.tasks.filter(t => t.taskId !== taskId);
        // Clear polling flag if no more active tasks
        if (state.videogen.tasks.length === 0) {
          state.videogen.isPolling = false;
        }
        showToast('Video berhasil di-generate!', 'success');
        render(true); // Force render on completion
        return;
      }
      
      // Check for failure
      if (data.status === 'failed' || data.status === 'FAILED') {
        throw new Error(data.error || 'Video generation failed');
      }
      
      // Update progress display (partial DOM update - no full re-render)
      const newProgress = data.progress || Math.min(95, Math.floor(elapsedSec / 3));
      task.status = 'processing';
      task.progress = newProgress;
      
      // Partial update: only update progress elements without full re-render
      const progressEl = document.querySelector(`[data-task-id="${taskId}"] .task-progress-fill`);
      const progressText = document.querySelector(`[data-task-id="${taskId}"] .task-progress-text`);
      const elapsedEl = document.querySelector(`[data-task-id="${taskId}"] .task-elapsed`);
      if (progressEl) progressEl.style.width = `${newProgress}%`;
      if (progressText) progressText.textContent = `${newProgress}%`;
      if (elapsedEl) elapsedEl.textContent = `${elapsedSec}s`;
      
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(poll, 5000);
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
      // Clear polling flag if no more active tasks
      if (state.videogen.tasks.length === 0) {
        state.videogen.isPolling = false;
      }
      showToast('Gagal generate video: ' + error.message, 'error');
      render(true); // Force render on error
    }
  };
  
  setTimeout(poll, 5000);
}

async function removeGeneratedVideo(index) {
  const video = state.videogen.generatedVideos[index];
  
  // Remove from local state immediately
  state.videogen.generatedVideos.splice(index, 1);
  render();
  
  // Also delete from database if has taskId
  if (video && video.taskId) {
    try {
      await fetch(`${API_URL}/api/videogen/history/${video.taskId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
    } catch (error) {
      console.error('Failed to delete video from database:', error);
    }
  }
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

async function fetchVideoHistory() {
  try {
    const response = await fetch(`${API_URL}/api/videogen/history`, { credentials: 'include' });
    if (!response.ok) return;
    
    const data = await response.json();
    if (data.videos && data.videos.length > 0) {
      const existingTaskIds = new Set(state.videogen.generatedVideos.map(v => v.taskId));
      
      data.videos.forEach(video => {
        if (!existingTaskIds.has(video.taskId)) {
          state.videogen.generatedVideos.push({
            url: video.url,
            taskId: video.taskId,
            createdAt: new Date(video.createdAt).getTime()
          });
        }
      });
      
      state.videogen.generatedVideos.sort((a, b) => b.createdAt - a.createdAt);
      saveGeneratedVideosToStorage();
      render();
    }
  } catch (error) {
    console.log('Failed to fetch video history:', error);
  }
}

window.removeGeneratedVideo = removeGeneratedVideo;

// X Maker generate functions removed - will be rebuilt

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
  
  const fileSizeMB = file.size / 1024 / 1024;
  console.log('[UPLOAD] Starting upload:', file.name, 'size:', fileSizeMB.toFixed(2) + 'MB');
  
  state.uploadProgress = 0;
  state.isUploading = true;
  render();
  
  try {
    // Use chunked upload for files > 20MB
    if (file.size > 20 * 1024 * 1024) {
      console.log('[UPLOAD] Using chunked upload');
      await uploadVideoChunked(file);
    } else {
      console.log('[UPLOAD] Using single upload');
      await uploadVideoSingle(file);
    }
  } catch (error) {
    console.error('[UPLOAD] Error:', error);
    state.isUploading = false;
    state.uploadProgress = 0;
    showToast('Gagal upload: ' + error.message, 'error');
    render();
  }
}

async function uploadVideoChunked(file) {
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  
  console.log('[CHUNK] Total chunks:', totalChunks);
  
  // Initialize upload
  const initRes = await fetch(`${API_URL}/api/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      filename: file.name,
      fileSize: file.size,
      totalChunks
    })
  });
  
  if (!initRes.ok) {
    throw new Error('Gagal memulai upload');
  }
  
  const { uploadId } = await initRes.json();
  console.log('[CHUNK] Upload ID:', uploadId);
  
  // Upload chunks sequentially
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    
    const formData = new FormData();
    formData.append('chunk', chunk, `chunk_${i}`);
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', i.toString());
    
    let retries = 3;
    while (retries > 0) {
      try {
        const res = await fetch(`${API_URL}/api/upload/chunk`, {
          method: 'POST',
          credentials: 'include',
          body: formData
        });
        
        if (!res.ok) {
          throw new Error(`Chunk ${i} gagal`);
        }
        
        const result = await res.json();
        state.uploadProgress = result.progress;
        console.log('[CHUNK] Progress:', result.progress + '%');
        updateUploadProgressUI();
        break;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        console.log(`[CHUNK] Retry chunk ${i}, remaining:`, retries);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  
  // Complete upload
  const completeRes = await fetch(`${API_URL}/api/upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ uploadId })
  });
  
  if (!completeRes.ok) {
    const err = await completeRes.json();
    throw new Error(err.error || 'Gagal menyelesaikan upload');
  }
  
  const data = await completeRes.json();
  console.log('[CHUNK] Complete:', data);
  
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
}

async function uploadVideoSingle(file) {
  const formData = new FormData();
  formData.append('video', file);
  
  const xhr = new XMLHttpRequest();
  xhr.timeout = 60000; // 1 minute for small files
  
  const uploadPromise = new Promise((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        state.uploadProgress = Math.round((e.loaded / e.total) * 100);
        console.log('[UPLOAD] Progress:', state.uploadProgress + '%');
        updateUploadProgressUI();
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let errorMsg = 'Upload failed';
        try {
          const errData = JSON.parse(xhr.responseText);
          errorMsg = errData.error || errorMsg;
        } catch (e) {}
        reject(new Error(errorMsg));
      }
    });
    
    xhr.addEventListener('error', () => reject(new Error('Koneksi terputus')));
    xhr.addEventListener('abort', () => reject(new Error('Upload dibatalkan')));
    xhr.addEventListener('timeout', () => reject(new Error('Timeout')));
  });
  
  xhr.open('POST', `${API_URL}/api/upload`);
  xhr.withCredentials = true;
  xhr.send(formData);
  
  const data = await uploadPromise;
  console.log('[UPLOAD] Success:', data);
  
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
      state.clips = data.clips || [];
      console.log('=== JOB COMPLETED ===');
      console.log('Raw data.clips:', JSON.stringify(data.clips));
      console.log('state.clips after assign:', JSON.stringify(state.clips));
      console.log('Clips count:', state.clips.length);
      if (state.clips.length > 0) {
        console.log('First clip path:', state.clips[0].path);
      }
      showToast(`${state.clips.length} clips generated!`, 'success');
      
      // Force scroll to clips section after render
      render(true);
      setTimeout(() => {
        const clipsSection = document.querySelector('.clips-grid');
        if (clipsSection) {
          clipsSection.scrollIntoView({ behavior: 'smooth' });
          console.log('Scrolled to clips section');
        } else {
          console.log('WARNING: Clips grid not found in DOM after render!');
          console.log('Current state.clips:', state.clips.length);
        }
      }, 500);
    } else if (data.status === 'error') {
      state.status = 'error';
      showToast(data.error || 'Processing failed', 'error');
      render();
    } else {
      if (prevProgress !== data.progress || prevStatus !== data.status) {
        updateProcessingProgressUI();
      }
      setTimeout(pollJobStatus, 5000);
    }
  } catch (error) {
    console.error('Polling error:', error);
    setTimeout(pollJobStatus, 5000);
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
      console.log('[SSE] Video completed event received:', data.taskId, data.videoUrl);
      const videoExists = state.videogen.generatedVideos.some(v => v.taskId === data.taskId);
      if (!videoExists && data.videoUrl) {
        state.videogen.generatedVideos.unshift({ 
          url: data.videoUrl, 
          createdAt: Date.now(), 
          taskId: data.taskId,
          model: data.model || 'unknown'
        });
      }
      
      const completedTask = state.videogen.tasks.find(t => t.taskId === data.taskId);
      if (completedTask) {
        completedTask.status = 'completed';
        completedTask.videoUrl = data.videoUrl;
        state.videogen.tasks = state.videogen.tasks.filter(t => t.taskId !== data.taskId);
      }
      
      if (state.videogen.tasks.length === 0) {
        state.videogen.isPolling = false;
      }
      
      showToast('Video berhasil di-generate!', 'success');
      render(true);
      break;
    
    case 'motion_completed':
      console.log('[SSE] Motion completed event received:', data.taskId, data.videoUrl);
      const motionExists = state.motion.generatedVideos.some(v => v.taskId === data.taskId);
      if (!motionExists && data.videoUrl) {
        state.motion.generatedVideos.unshift({ 
          url: data.videoUrl, 
          createdAt: Date.now(), 
          taskId: data.taskId,
          model: data.model || 'unknown'
        });
      }
      
      const completedMotionTask = state.motion.tasks.find(t => t.taskId === data.taskId);
      if (completedMotionTask) {
        completedMotionTask.status = 'completed';
        completedMotionTask.videoUrl = data.videoUrl;
        state.motion.tasks = state.motion.tasks.filter(t => t.taskId !== data.taskId);
      }
      
      state.motion.isPolling = !state.motion.tasks.some(t => t.status !== 'completed' && t.status !== 'failed');
      showToast('Motion video berhasil di-generate!', 'success');
      render();
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
    
    case 'motion_failed':
      const failedMotionTask = state.motion.tasks.find(t => t.taskId === data.taskId);
      if (failedMotionTask) {
        failedMotionTask.status = 'failed';
        failedMotionTask.error = data.error;
        state.motion.tasks = state.motion.tasks.filter(t => t.taskId !== data.taskId);
        state.motion.isPolling = !state.motion.tasks.some(t => t.status !== 'completed' && t.status !== 'failed');
        showToast('Gagal generate motion: ' + data.error, 'error');
        render();
      }
      break;

    case 'vidgen3_completed':
      console.log('[SSE] Vidgen3 completed:', data.taskId, data.videoUrl);
      const vidgen3Exists = state.vidgen3.generatedVideos.some(v => v.taskId === data.taskId);
      if (!vidgen3Exists && data.videoUrl) {
        state.vidgen3.generatedVideos.unshift({
          url: data.videoUrl,
          model: data.model || 'unknown',
          taskId: data.taskId,
          createdAt: new Date().toISOString()
        });
      }
      const completedVidgen3Task = state.vidgen3.tasks.find(t => t.taskId === data.taskId);
      if (completedVidgen3Task) {
        completedVidgen3Task.status = 'completed';
        completedVidgen3Task.videoUrl = data.videoUrl;
        state.vidgen3.tasks = state.vidgen3.tasks.filter(t => t.taskId !== data.taskId);
      }
      showToast('Vidgen3 video berhasil di-generate!', 'success');
      render(true);
      break;

    case 'vidgen3_failed':
      const failedVidgen3Task = state.vidgen3.tasks.find(t => t.taskId === data.taskId);
      if (failedVidgen3Task) {
        failedVidgen3Task.status = 'failed';
        failedVidgen3Task.error = data.error;
        state.vidgen3.tasks = state.vidgen3.tasks.filter(t => t.taskId !== data.taskId);
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
    // Fetch video history from database
    fetchVideoHistory();
    // Fetch X Maker subscription
    fetchXMakerSubscription();
  }
}

// Start the app
initApp();
