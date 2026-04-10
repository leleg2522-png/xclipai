const API_URL = '';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state.auth.user) {
      console.log('[VISIBILITY] Page visible again, reconnecting SSE and recovering tasks...');
      connectSSE();
      recoverPendingTasks();
      refreshSubscriptionSilent();
    }
  }
});

async function refreshSubscriptionSilent() {
  try {
    const response = await fetch(`${API_URL}/api/subscription/status`, { credentials: 'include' });
    if (response.ok) {
      const data = await response.json();
      state.roomManager.hasSubscription = data.hasSubscription || false;
      state.roomManager.subscription = data.subscription || null;
      if (data.subscription?.remainingSeconds) {
        state.pricing.remainingSeconds = data.subscription.remainingSeconds;
        startCountdownTimer();
      }
      render();
    }
  } catch (e) {
    console.log('[VISIBILITY] Subscription refresh failed, keeping current state');
  }
}

function getUserStorageKey(base) {
  var uid = state.auth && state.auth.user ? state.auth.user.id : '';
  return uid ? base + '_u' + uid : base;
}

function savePendingTasks() {
  try {
    const pending = {};
    const features = ['vidgen2', 'vidgen3', 'vidgen4', 'ximage', 'ximage2', 'ximage3', 'videogen', 'motion'];
    features.forEach(f => {
      if (state[f] && state[f].tasks && state[f].tasks.length > 0) {
        pending[f] = state[f].tasks.filter(t => t.status !== 'completed' && t.status !== 'failed').map(t => ({
          taskId: t.taskId,
          model: t.model || '',
          status: t.status || 'pending',
          apiKey: t.apiKey || '',
          startTime: t.startTime || Date.now(),
          savedAt: Date.now()
        }));
      }
    });
    const activeIds = new Set();
    Object.values(pending).forEach(tasks => tasks.forEach(t => activeIds.add(t.taskId)));
    _activePolls.forEach(id => { if (!activeIds.has(id)) _activePolls.delete(id); });
    
    var storageKey = getUserStorageKey('xclip_pending_tasks');
    if (Object.keys(pending).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(pending));
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch (e) {}
}

const _activePolls = new Set();

function recoverPendingTasks() {
  try {
    var storageKey = getUserStorageKey('xclip_pending_tasks');
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;
    const pending = JSON.parse(saved);
    let recovered = false;
    
    const tryRecover = (feature, tasks, pollFn) => {
      if (!tasks || tasks.length === 0) return;
      const now = Date.now();
      tasks.forEach(t => {
        if (_activePolls.has(t.taskId)) return;
        const savedAt = t.savedAt || now;
        if (now - savedAt > 30 * 60 * 1000) return;
        if (!state[feature].tasks.some(x => x.taskId === t.taskId)) {
          state[feature].tasks.push({ taskId: t.taskId, model: t.model, status: 'processing', apiKey: t.apiKey || '', startTime: t.startTime || savedAt });
        }
        _activePolls.add(t.taskId);
        recovered = true;
        pollFn(t);
      });
    };
    
    tryRecover('vidgen2', pending.vidgen2, (t) => pollVidgen2Task(t.taskId));
    tryRecover('vidgen3', pending.vidgen3, (t) => pollVidgen3Task(t.taskId, t.model));
    tryRecover('vidgen4', pending.vidgen4, (t) => pollVidgen4Task(t.taskId));
    tryRecover('ximage', pending.ximage, (t) => pollXImageTask(t.taskId));
    tryRecover('ximage2', pending.ximage2, (t) => pollXImage2Task(t.taskId));
    tryRecover('ximage3', pending.ximage3, (t) => pollXImage3Task(t.taskId));
    tryRecover('videogen', pending.videogen, (t) => pollVideoStatus(t.taskId, t.model));
    tryRecover('motion', pending.motion, (t) => pollMotionStatus(t.taskId, t.model, t.apiKey || undefined));
    
    if (recovered) {
      render();
      console.log('[RECOVERY] Recovered pending tasks:', pending);
    }
  } catch (e) {
    console.error('[RECOVERY] Error recovering tasks:', e);
  }
}

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
    roomUsage: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    roomMaxUsers: { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100 },
    _handledTaskIds: new Set()
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
  vidgen3: {
    sourceImage: null,
    referenceVideo: null,
    prompt: '',
    selectedModel: 'sora-2',
    resolution: '720p',
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
  vidgen2: {
    sourceImage: null,
    startFrame: null,
    endFrame: null,
    generationType: 'reference',
    prompt: '',
    selectedModel: 'grok-video-3-10s',
    aspectRatio: '16:9',
    duration: 10,
    resolution: '720p',
    watermark: false,
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
    cooldownEndTime: parseInt(localStorage.getItem('vidgen2_cooldown') || '0'),
    cooldownRemaining: 0,
    _historyLoaded: false
  },
  vidgen2RoomManager: {
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
    selectedModel: 'sora-2-vip',
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
    selectedModel: 'gemini-3-pro-image',
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
    numberOfImages: 1,
    quality: 'basic',
    modelVariant: '',
    renderingSpeed: 'BALANCED',
    imageStyle: 'AUTO',
    acceleration: 'none',
    googleSearch: false,
    outputFormat: 'png'
  },
  ximageRoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
  },
  ximage2RoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
  },
  ximage3RoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
  },
  ximage3: {
    sourceImages: [],
    prompt: '',
    selectedModel: 'mystic-sparkle',
    size: '1:1',
    mode: 'text-to-image',
    isGenerating: false,
    tasks: [],
    generatedImages: [],
    error: null,
    customApiKey: '',
    _historyLoaded: false,
    resolution: '1K',
    numberOfImages: 1,
    cooldownEnd: 0
  },
  ximage2: {
    sourceImages: [],
    prompt: '',
    selectedModel: 'gpt-4o-image',
    size: '1:1',
    mode: 'text-to-image',
    isGenerating: false,
    tasks: [],
    generatedImages: [],
    error: null,
    customApiKey: '',
    _historyLoaded: false,
    resolution: '1K',
    numberOfImages: 1,
    watermark: false,
    sequentialGeneration: false,
    safetyTolerance: 2,
    inputMode: 'auto',
    promptUpsampling: false,
    maskImage: null,
    cooldownEnd: 0
  },
  automation: {
    projects: [],
    currentProject: null,
    currentScenes: [],
    isLoading: false,
    isCreating: false,
    isGeneratingScript: false,
    isProducing: false,
    newProject: {
      niche: '',
      format: 'shorts',
      videoModel: 'kling-v2.6-pro',
      videoDuration: 5,
      sceneCount: 3,
      language: 'id',
      referenceImage: null,
      referenceImagePreview: null
    },
    view: 'list',
    _loaded: false,
    youtube: {
      configured: false,
      connected: false,
      channelName: null,
      isUploading: false,
      uploadProgress: null
    }
  },
  adsStudio: {
    projects: [],
    currentProject: null,
    currentScenes: [],
    isLoading: false,
    isCreating: false,
    isGeneratingScript: false,
    isProducing: false,
    newProject: {
      productName: '',
      productDescription: '',
      adType: 'soft_selling',
      format: 'shorts',
      videoModel: 'wan-v2.7-pro',
      videoDuration: 5,
      sceneCount: 4,
      language: 'id',
      voiceOverEnabled: false,
      characterImage: null,
      characterImagePreview: null,
      productImage: null,
      productImagePreview: null
    },
    view: 'list',
    _loaded: false
  },
  sceneStudio: {
    prompts: [''],
    characterDesc: '',
    characterRefImages: [],
    bgRefImages: [],
    selectedStyle: '',
    models: [],
    selectedModel: 'doubao-seedance-4-5',
    selectedSize: '1:1',
    selectedResolution: '2K',
    isGenerating: false,
    batchProgress: { current: 0, total: 0, batchId: null },
    batchResults: [],
    history: [],
    error: null,
    _modelsLoaded: false
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
    filter: 'pending',
    blockedIPs: [],
    blockedLoading: false,
    activeTab: 'payments',
    keyPool: { keys: [], stats: {}, isLoading: false }
  },
  voiceover: {
    text: '',
    selectedVoiceId: '',
    selectedVoiceName: '',
    selectedModel: 'elevenlabs/text-to-speech-multilingual-v2',
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0,
    useSpeakerBoost: true,
    customApiKey: '',
    dialogueSegments: [{ voice: 'Rachel', text: '' }],
    isGenerating: false,
    history: [],
    voices: [],
    voicesLoading: false,
    currentAudioUrl: null,
    isPlaying: false,
    voiceSearch: '',
    showVoicePanel: false,
    cooldownEnd: 0
  },
  voiceoverRoomManager: {
    rooms: [],
    subscription: null,
    hasSubscription: false,
    isLoading: false,
    showRoomModal: false,
    xclipApiKey: ''
  }
};

const PERSIST_KEYS = {
  vidgen3: ['prompt', 'selectedModel', 'resolution', 'customApiKey'],
  videogen: ['prompt', 'selectedModel', 'duration', 'aspectRatio', 'customApiKey'],
  motion: ['prompt', 'selectedModel', 'characterOrientation'],
  ximage: ['prompt', 'selectedModel', 'aspectRatio', 'mode', 'customApiKey', 'resolution', 'numberOfImages', 'quality', 'modelVariant', 'renderingSpeed', 'imageStyle', 'acceleration', 'googleSearch', 'outputFormat'],
  chat: ['selectedModel'],
  vidgen3RoomManager: ['xclipApiKey'],
  vidgen2: ['prompt', 'selectedModel', 'aspectRatio', 'duration', 'resolution', 'watermark', 'style', 'storyboard', 'enableGif', 'generationType', 'customApiKey'],
  vidgen2RoomManager: ['xclipApiKey'],
  vidgen4: ['prompt', 'selectedModel', 'aspectRatio', 'duration', 'resolution', 'watermark', 'thumbnail', 'isPrivate', 'style', 'storyboard', 'enableGif', 'generationType', 'customApiKey'],
  vidgen4RoomManager: ['xclipApiKey'],
  ximageRoomManager: ['xclipApiKey'],
  ximage2: ['prompt', 'selectedModel', 'size', 'mode', 'customApiKey', 'resolution', 'numberOfImages', 'watermark', 'sequentialGeneration', 'safetyTolerance', 'inputMode', 'promptUpsampling'],
  ximage2RoomManager: ['xclipApiKey'],
  ximage3: ['prompt', 'selectedModel', 'size', 'mode', 'customApiKey', 'resolution', 'numberOfImages'],
  ximage3RoomManager: ['xclipApiKey'],
  motionRoomManager: ['xclipApiKey'],
  voiceover: ['selectedModel', 'stability', 'similarityBoost', 'style', 'useSpeakerBoost', 'customApiKey'],
  voiceoverRoomManager: ['xclipApiKey']
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
    localStorage.setItem(getUserStorageKey('xclip_inputs_' + section), JSON.stringify(data));
  } catch (e) {}
}

function restoreAllUserInputs() {
  Object.keys(PERSIST_KEYS).forEach(section => {
    try {
      const saved = localStorage.getItem(getUserStorageKey('xclip_inputs_' + section));
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include', signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await response.json();
    state.auth.user = data.user;
    state.auth.isLoading = false;
    
    if (data.user) {
      restoreAllUserInputs();
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
    try { render(); } catch(e) { showFallbackLoginUI(); }
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
const FAKE_PRICES = [30000, 65000, 100000, 200000];

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
      restoreAllUserInputs();
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
      restoreAllUserInputs();
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
    state.auth.modalMode = 'login';
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
    state.sceneStudio.prompts = [''];
    state.sceneStudio.characterDesc = '';
    state.sceneStudio.characterRefImages = [];
    state.sceneStudio.bgRefImages = [];
    state.sceneStudio.selectedStyle = '';
    state.sceneStudio.batchResults = [];
    state.sceneStudio.isGenerating = false;
    state.sceneStudio.batchProgress = { current: 0, total: 0, batchId: null };
    state.sceneStudio.history = [];
    state.sceneStudio._historyLoaded = false;
    state.vidgen2.customApiKey = '';
    state.vidgen2.generatedVideos = [];
    state.vidgen2.tasks = [];
    state.vidgen2._historyLoaded = false;
    state.vidgen3.customApiKey = '';
    state.vidgen3.generatedVideos = [];
    state.vidgen3.tasks = [];
    state.vidgen4.customApiKey = '';
    state.vidgen4.generatedVideos = [];
    state.vidgen4.tasks = [];
    state.vidgen4._historyLoaded = false;
    state.ximage.customApiKey = '';
    state.ximage.generatedImages = [];
    state.ximage.tasks = [];
    state.ximage2.customApiKey = '';
    state.ximage2.generatedImages = [];
    state.ximage2.tasks = [];
    state.ximage3.customApiKey = '';
    state.ximage3.generatedImages = [];
    state.ximage3.tasks = [];
    state.motion.generatedVideos = [];
    state.motion.tasks = [];
    state.voiceover.customApiKey = '';
    state.voiceover.history = [];
    state.vidgen2RoomManager.xclipApiKey = '';
    state.vidgen3RoomManager.xclipApiKey = '';
    state.vidgen4RoomManager.xclipApiKey = '';
    state.ximageRoomManager.xclipApiKey = '';
    state.ximage2RoomManager.xclipApiKey = '';
    state.ximage3RoomManager.xclipApiKey = '';
    state.motionRoomManager.xclipApiKey = '';
    state.voiceoverRoomManager.xclipApiKey = '';
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
  const hadSubscription = state.roomManager.hasSubscription;
  try {
    const response = await fetch(`${API_URL}/api/subscription/status`, { credentials: 'include' });
    if (!response.ok) {
      if (response.status === 401) {
        state.roomManager.hasSubscription = false;
        state.roomManager.subscription = null;
        state.pricing.remainingSeconds = 0;
      }
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
    if (error && error.message) {
      console.error('Fetch subscription error:', error.message);
    }
    if (hadSubscription) {
      console.log('[SUB] Keeping existing subscription state due to network error');
    } else {
      state.roomManager.hasSubscription = false;
      state.roomManager.subscription = null;
      state.pricing.remainingSeconds = 0;
    }
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
      if (data.maxUsers) state.motion.roomMaxUsers = data.maxUsers;
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

// ==================== X IMAGE2 ROOM MANAGER FUNCTIONS ====================

async function loadXImage2Rooms() {
  try {
    state.ximage2RoomManager.isLoading = true;
    const response = await fetch(`${API_URL}/api/ximage2/rooms`, { credentials: 'include' });
    const data = await response.json();
    state.ximage2RoomManager.rooms = data.rooms || [];
  } catch (error) {
    console.error('Load ximage2 rooms error:', error);
    state.ximage2RoomManager.rooms = [];
  } finally {
    state.ximage2RoomManager.isLoading = false;
    render();
  }
}

async function loadXImage2SubscriptionStatus() {
  try {
    const response = await fetch(`${API_URL}/api/ximage2/subscription-status`, { credentials: 'include' });
    if (!response.ok) {
      state.ximage2RoomManager.hasSubscription = false;
      state.ximage2RoomManager.subscription = null;
      return;
    }
    const data = await response.json();
    state.ximage2RoomManager.hasSubscription = data.hasSubscription || false;
    state.ximage2RoomManager.subscription = data.subscription || null;
  } catch (error) {
    console.error('Load ximage2 subscription error:', error);
    state.ximage2RoomManager.hasSubscription = false;
    state.ximage2RoomManager.subscription = null;
  }
}

async function joinXImage2Room(roomId) {
  const apiKey = state.ximage2RoomManager.xclipApiKey;
  
  if (!apiKey) {
    showToast('Masukkan Xclip API key terlebih dahulu', 'error');
    return;
  }
  
  try {
    state.ximage2RoomManager.isLoading = true;
    render();
    
    const response = await fetch(`${API_URL}/api/ximage2/join-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ xclipApiKey: apiKey, roomId: roomId })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast(data.message || 'Berhasil bergabung ke X Image2 room!', 'success');
      state.ximage2RoomManager.showRoomModal = false;
      state.ximage2.customApiKey = apiKey;
      saveUserInputs('ximage2');
      await loadXImage2SubscriptionStatus();
      await loadXImage2Rooms();
    } else {
      showToast(data.error || 'Gagal bergabung ke room', 'error');
    }
  } catch (error) {
    console.error('Join ximage2 room error:', error);
    showToast('Gagal bergabung ke room', 'error');
  } finally {
    state.ximage2RoomManager.isLoading = false;
    render();
  }
}

// ==================== XIMAGE3 ROOM MANAGER FUNCTIONS ====================

async function loadXImage3Rooms() {
  try {
    state.ximage3RoomManager.isLoading = true;
    const response = await fetch(`${API_URL}/api/ximage3/rooms`, { credentials: 'include' });
    const data = await response.json();
    state.ximage3RoomManager.rooms = data.rooms || [];
  } catch (error) {
    console.error('Load ximage3 rooms error:', error);
    state.ximage3RoomManager.rooms = [];
  } finally {
    state.ximage3RoomManager.isLoading = false;
    if (state.ximage3RoomManager.showRoomModal) {
      var modalContent = document.querySelector('#ximage3RoomModalOverlay .rooms-list');
      if (modalContent) {
        var roomsHtml = '';
        if (state.ximage3RoomManager.rooms.length === 0) {
          roomsHtml = '<div class="empty-state"><p>Tidak ada room tersedia</p></div>';
        } else {
          state.ximage3RoomManager.rooms.forEach(function(room) {
            roomsHtml += '<div class="room-item ' + (room.status !== 'OPEN' ? 'maintenance' : '') + '" data-ximage3-room-id="' + room.id + '">';
            roomsHtml += '<div class="room-info"><h4>' + room.name + '</h4>';
            roomsHtml += '<p>' + room.current_users + '/' + room.max_users + ' users</p></div>';
            roomsHtml += '<div class="room-actions">';
            if (room.status === 'OPEN' && room.current_users < room.max_users) {
              roomsHtml += '<button class="btn btn-sm btn-primary join-ximage3-room-btn" data-room-id="' + room.id + '">Join</button>';
            } else if (room.status !== 'OPEN') {
              roomsHtml += '<span class="badge badge-warning">Maintenance</span>';
            } else {
              roomsHtml += '<span class="badge badge-danger">Penuh</span>';
            }
            roomsHtml += '</div></div>';
          });
        }
        modalContent.innerHTML = roomsHtml;
        document.querySelectorAll('.join-ximage3-room-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            joinXImage3Room(parseInt(btn.dataset.roomId));
          });
        });
      }
    }
  }
}

async function loadXImage3SubscriptionStatus() {
  try {
    var headers = {};
    var apiKey = state.ximage3.customApiKey || state.ximage3RoomManager.xclipApiKey;
    if (apiKey) headers['x-xclip-key'] = apiKey;
    const response = await fetch(`${API_URL}/api/ximage3/subscription-status`, { credentials: 'include', headers: headers });
    if (!response.ok) {
      state.ximage3RoomManager.hasSubscription = false;
      state.ximage3RoomManager.subscription = null;
      return;
    }
    const data = await response.json();
    state.ximage3RoomManager.hasSubscription = data.hasSubscription || false;
    state.ximage3RoomManager.subscription = data.subscription || null;
  } catch (error) {
    console.error('Load ximage3 subscription error:', error);
    state.ximage3RoomManager.hasSubscription = false;
    state.ximage3RoomManager.subscription = null;
  }
}

async function joinXImage3Room(roomId) {
  const apiKey = state.ximage3RoomManager.xclipApiKey;
  if (!apiKey) {
    showToast('Masukkan Xclip API key terlebih dahulu', 'error');
    return;
  }
  try {
    state.ximage3RoomManager.isLoading = true;
    render();
    const response = await fetch(`${API_URL}/api/ximage3/join-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ xclipApiKey: apiKey, roomId: roomId })
    });
    const data = await response.json();
    if (data.success) {
      showToast(data.message || 'Berhasil bergabung ke X Image3 room!', 'success');
      state.ximage3RoomManager.showRoomModal = false;
      state.ximage3.customApiKey = apiKey;
      state.ximage3RoomManager.xclipApiKey = apiKey;
      saveUserInputs('ximage3');
      if (data.roomId && data.roomName) {
        state.ximage3RoomManager.hasSubscription = true;
        state.ximage3RoomManager.subscription = { roomId: data.roomId, roomName: data.roomName };
      }
      await loadXImage3SubscriptionStatus();
      await loadXImage3Rooms();
    } else {
      showToast(data.error || 'Gagal bergabung ke room', 'error');
    }
  } catch (error) {
    console.error('Join ximage3 room error:', error);
    showToast('Gagal bergabung ke room', 'error');
  } finally {
    state.ximage3RoomManager.isLoading = false;
    render();
  }
}

// ==================== VIDGEN2 ROOM MANAGER FUNCTIONS ====================

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
            createdAt: new Date(task.createdAt).getTime(),
            startTime: new Date(task.createdAt).getTime() || Date.now()
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
            progress: 0,
            startTime: new Date(task.created_at).getTime() || Date.now()
          });
          pollVidgen3Task(task.task_id, task.model);
        }
      });
    }
  } catch (error) {
    console.error('Load vidgen3 history error:', error);
  }
}

async function loadVidgen2Rooms() {
  state.vidgen2RoomManager.isLoading = true;
  try {
    const res = await fetch(`${API_URL}/api/vidgen2/rooms`, { credentials: 'include' });
    const data = await res.json();
    state.vidgen2RoomManager.rooms = data.rooms || [];
  } catch (e) {
    state.vidgen2RoomManager.rooms = [];
  }
  state.vidgen2RoomManager.isLoading = false;
}

async function joinVidgen2Room(roomId) {
  state.vidgen2RoomManager.isLoading = true;
  render();
  try {
    const res = await fetch(`${API_URL}/api/vidgen2/join-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ roomId })
    });
    const data = await res.json();
    if (data.success) {
      state.vidgen2.selectedRoom = roomId;
      state.vidgen2RoomManager.showRoomModal = false;
      showToast(`Bergabung ke ${data.roomName}`, 'success');
      await loadVidgen2Rooms();
    } else {
      showToast(data.error || 'Gagal join room', 'error');
    }
  } catch (e) {
    showToast('Gagal join room', 'error');
  }
  state.vidgen2RoomManager.isLoading = false;
  render();
}

async function loadVidgen2History() {
  try {
    if (!state.vidgen2.customApiKey) return;
    const res = await fetch(`${API_URL}/api/vidgen2/history`, {
      headers: { 'X-Xclip-Key': state.vidgen2.customApiKey }
    });
    const data = await res.json();
    if (data.videos) {
      state.vidgen2.generatedVideos = data.videos.map(v => ({
        id: v.task_id,
        url: v.video_url,
        model: v.model,
        prompt: v.prompt,
        createdAt: new Date(v.completed_at || v.created_at)
      }));
    }
  } catch (e) {
    console.error('Load vidgen2 history error:', e);
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

async function fetchKeyPool() {
  try {
    state.admin.keyPool.isLoading = true;
    render();
    var resp = await fetch(API_URL + '/api/admin/key-pool', { credentials: 'include' });
    var data = await resp.json();
    state.admin.keyPool.keys = data.keys || [];
    var keys = state.admin.keyPool.keys;
    state.admin.keyPool.stats = {
      total: keys.length,
      available: keys.filter(function(k) { return k.status === 'available'; }).length,
      assigned: keys.filter(function(k) { return k.status === 'assigned'; }).length,
      exhausted: keys.filter(function(k) { return k.status === 'exhausted'; }).length
    };
  } catch (e) {
    console.error('Fetch key pool error:', e);
    state.admin.keyPool.keys = [];
  } finally {
    state.admin.keyPool.isLoading = false;
    render();
  }
}

function renderAdminKeyPool() {
  var kp = state.admin.keyPool;
  var statsHtml = '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">' +
    '<div style="padding:8px 16px;background:#1a1a2e;border-radius:8px;"><b>Total:</b> ' + (kp.stats.total || 0) + '</div>' +
    '<div style="padding:8px 16px;background:#1a1a2e;border-radius:8px;color:#4ade80;"><b>Available:</b> ' + (kp.stats.available || 0) + '</div>' +
    '<div style="padding:8px 16px;background:#1a1a2e;border-radius:8px;color:#60a5fa;"><b>Assigned:</b> ' + (kp.stats.assigned || 0) + '</div>' +
    '<div style="padding:8px 16px;background:#1a1a2e;border-radius:8px;color:#f87171;"><b>Exhausted:</b> ' + (kp.stats.exhausted || 0) + '</div>' +
    '</div>';

  var addHtml = '<div style="margin-bottom:16px;">' +
    '<textarea id="kpNewKeys" class="form-input" rows="3" placeholder="Paste Freepik API keys (comma or newline separated)" style="width:100%;margin-bottom:8px;"></textarea>' +
    '<div style="display:flex;gap:8px;">' +
    '<button class="btn btn-primary" id="kpAddKeysBtn">Add Keys</button>' +
    '<button class="btn btn-secondary" id="kpResetAllExhausted">Reset All Exhausted</button>' +
    '<button class="btn btn-secondary" id="kpUnassignAll" style="background:#ef4444;">Unassign All</button>' +
    '</div></div>';

  if (kp.isLoading) {
    return statsHtml + addHtml + '<div class="loading-spinner">Loading...</div>';
  }

  var listHtml = '<div style="max-height:400px;overflow-y:auto;">';
  if (kp.keys.length === 0) {
    listHtml += '<div style="padding:16px;text-align:center;color:#888;">No keys in pool</div>';
  } else {
    kp.keys.forEach(function(key) {
      var maskedKey = key.api_key.substring(0, 8) + '...' + key.api_key.substring(key.api_key.length - 4);
      var statusColor = key.status === 'available' ? '#4ade80' : key.status === 'assigned' ? '#60a5fa' : '#f87171';
      listHtml += '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1a1a2e;border-radius:6px;margin-bottom:4px;font-size:13px;">' +
        '<span style="font-family:monospace;flex:1;">' + maskedKey + '</span>' +
        '<span style="color:' + statusColor + ';min-width:70px;">' + key.status + '</span>' +
        '<span style="min-width:80px;color:#888;">' + (key.feature || '-') + '</span>' +
        '<span style="min-width:60px;color:#888;">' + (key.assigned_user_id ? 'User ' + key.assigned_user_id : '-') + '</span>';
      if (key.status === 'exhausted') {
        listHtml += '<button class="btn btn-secondary kp-reset-btn" data-id="' + key.id + '" style="padding:2px 8px;font-size:11px;">Reset</button>';
      }
      listHtml += '<button class="btn btn-secondary kp-delete-btn" data-id="' + key.id + '" style="padding:2px 8px;font-size:11px;background:#ef4444;">Del</button>';
      listHtml += '</div>';
    });
  }
  listHtml += '</div>';

  return statsHtml + addHtml + listHtml;
}

async function fetchBlockedIPs() {
  try {
    state.admin.blockedLoading = true;
    render();
    const response = await fetch(`${API_URL}/api/admin/ddos/blocked`, { credentials: 'include' });
    const data = await response.json();
    state.admin.blockedIPs = data.blocked || [];
  } catch (error) {
    console.error('Fetch blocked IPs error:', error);
    state.admin.blockedIPs = [];
  } finally {
    state.admin.blockedLoading = false;
    render();
  }
}

async function unblockIP(ip) {
  try {
    const response = await fetch(`${API_URL}/api/admin/ddos/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ip })
    });
    const data = await response.json();
    if (data.success) {
      showToast(`IP ${ip} berhasil di-unblock`, 'success');
      await fetchBlockedIPs();
    } else {
      showToast(data.error || 'Gagal unblock IP', 'error');
    }
  } catch (error) {
    showToast('Gagal unblock IP', 'error');
  }
}

async function unblockAllIPs() {
  try {
    const response = await fetch(`${API_URL}/api/admin/ddos/unblock-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    const data = await response.json();
    if (data.success) {
      showToast(data.message, 'success');
      await fetchBlockedIPs();
    } else {
      showToast('Gagal unblock semua IP', 'error');
    }
  } catch (error) {
    showToast('Gagal unblock semua IP', 'error');
  }
}

function formatDuration(seconds) {
  if (seconds <= 0) return 'Expired';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function renderAdminPage() {
  if (!state.admin.isAdmin) return '';
  
  const tab = state.admin.activeTab;
  
  return `
    <div class="container admin-page">
      <div class="admin-header">
        <h1>Admin Dashboard</h1>
        <button class="btn btn-secondary" id="backToMainBtn">Kembali</button>
      </div>
      
      <div class="admin-tabs" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
        <button class="btn ${tab === 'payments' ? 'btn-primary' : 'btn-secondary'}" id="adminTabPayments">Pembayaran</button>
        <button class="btn ${tab === 'ddos' ? 'btn-primary' : 'btn-secondary'}" id="adminTabDdos">IP Blocked</button>
        <button class="btn ${tab === 'keypool' ? 'btn-primary' : 'btn-secondary'}" id="adminTabKeypool">Key Pool</button>
      </div>
      
      ${tab === 'payments' ? renderAdminPayments() : tab === 'keypool' ? renderAdminKeyPool() : renderAdminDdos()}
    </div>
  `;
}

function renderAdminPayments() {
  return `
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
  `;
}

function renderAdminDdos() {
  const ips = state.admin.blockedIPs;
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
      <h3 style="margin:0;color:#fff;">IP yang Diblokir (${ips.length})</h3>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" id="refreshBlockedIPs">Refresh</button>
        ${ips.length > 0 ? `<button class="btn btn-danger" id="unblockAllIPs">Unblock Semua</button>` : ''}
      </div>
    </div>
    
    ${state.admin.blockedLoading ? `
      <div class="loading-spinner">Loading...</div>
    ` : ips.length === 0 ? `
      <div class="no-payments" style="text-align:center;padding:40px;color:#aaa;">
        Tidak ada IP yang diblokir saat ini
      </div>
    ` : `
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${ips.map(item => `
          <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
            <div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;">
              <span style="font-family:monospace;font-size:14px;color:#fff;word-break:break-all;">${item.ip}</span>
              <div style="display:flex;gap:12px;flex-wrap:wrap;">
                <span style="font-size:12px;color:#f59e0b;">Strike: ${item.strikes}x</span>
                <span style="font-size:12px;color:#ef4444;">Sisa: ${formatDuration(item.remaining)}</span>
                <span style="font-size:12px;color:#888;">Expires: ${new Date(item.expiresAt).toLocaleString('id-ID')}</span>
              </div>
            </div>
            <button class="btn btn-success unblock-ip-btn" data-ip="${item.ip}" style="white-space:nowrap;padding:6px 14px;font-size:13px;">Unblock</button>
          </div>
        `).join('')}
      </div>
    `}
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
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const safeName = (filename || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
    
    showToast('Mempersiapkan file...', 'info');

    let blob;
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.ok) blob = await response.blob();
    } catch (e) {}

    if (!blob) {
      try {
        const proxyUrl = `${API_URL}/api/download-video?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeName)}`;
        const response = await fetch(proxyUrl, { credentials: 'include' });
        if (response.ok) blob = await response.blob();
      } catch (e) {}
    }

    if (!blob) {
      const proxyUrl = `${API_URL}/api/download-video?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeName)}`;
      window.open(proxyUrl, '_blank');
      showToast('Membuka video di tab baru. Tekan lama untuk simpan ke galeri.', 'info');
      return;
    }

    const videoFile = new File([blob], safeName + '.mp4', { type: blob.type || 'video/mp4' });

    if (isMobile && navigator.canShare && navigator.canShare({ files: [videoFile] })) {
      try {
        await navigator.share({
          files: [videoFile],
          title: safeName
        });
        showToast('Video berhasil disimpan!', 'success');
        return;
      } catch (shareErr) {
        if (shareErr.name === 'AbortError') {
          showToast('Dibatalkan', 'info');
          return;
        }
      }
    }

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
    
  } catch (error) {
    console.error('Download error:', error);
    const safeName = (filename || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
    const proxyUrl = `${API_URL}/api/download-video?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(safeName)}`;
    window.open(proxyUrl, '_blank');
    showToast('Membuka video di tab baru. Tekan lama untuk simpan.', 'info');
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

function showFallbackLoginUI() {
  const mainContent = document.getElementById('mainContent');
  if (mainContent) {
    mainContent.innerHTML = `
      <div style="display:flex;justify-content:center;align-items:center;min-height:80vh;">
        <div style="text-align:center;padding:40px;">
          <div style="font-size:48px;margin-bottom:16px;">✦</div>
          <h2 style="color:#fff;margin-bottom:8px;">Xclip AI</h2>
          <p style="color:#aaa;margin-bottom:24px;">Platform AI Creative Suite Terlengkap</p>
          <button id="fallbackLoginBtn" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;padding:14px 32px;border-radius:12px;font-size:16px;cursor:pointer;">
            Login / Daftar
          </button>
        </div>
      </div>
    `;
    const btn = document.getElementById('fallbackLoginBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        state.auth.showModal = true;
        state.auth.modalMode = 'login';
        state.auth.isLoading = false;
        render(true);
      });
    }
  }
}

function render(force = false) {
  if (state.videogen.isPolling && !force && state.currentPage === 'videogen') {
    return;
  }
  if (state.motion.isPolling && !force && state.currentPage === 'motion') {
    return;
  }
  if (state.vidgen3.isPolling && !force && state.currentPage === 'vidgen3') {
    return;
  }
  if (state.vidgen4.isPolling && !force && state.currentPage === 'vidgen4') {
    return;
  }
  
  const now = Date.now();
  if (!force && now - lastRenderTime < RENDER_THROTTLE) {
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
  
  try {
    navMenu.innerHTML = renderNavMenu();
  } catch(e) { console.error('renderNavMenu error:', e); navMenu.innerHTML = ''; }
  
  try {
    headerRight.innerHTML = renderHeaderRight();
  } catch(e) { console.error('renderHeaderRight error:', e); headerRight.innerHTML = ''; }
  
  try {
    mainContent.innerHTML = renderMainContent();
  } catch(e) {
    console.error('renderMainContent error:', e);
    showFallbackLoginUI();
    return;
  }
  
  try {
    if (modalsContainer) modalsContainer.innerHTML = renderModals();
  } catch(e) { console.error('renderModals error:', e); }
  
  try {
    attachEventListeners();
  } catch(e) { console.error('attachEventListeners error:', e); }
  
  try {
    Object.keys(cooldownTimers).forEach(feature => {
      const btn = document.querySelector(`[data-cooldown="${feature}"]`);
      if (btn && cooldownTimers[feature]) {
        btn.disabled = true;
        btn.style.opacity = '0.6';
      }
    });
  } catch(e) {}
  
  if (state.currentPage === 'chat') {
    try { scrollChatToBottom(); } catch(e) {}
  }
}

function renderNavMenu() {
  return `
    <button class="mobile-close-btn" id="mobileCloseBtn">×</button>
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
    <button class="nav-btn ${state.currentPage === 'ximage' ? 'active' : ''}" data-page="ximage">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
        <path d="M14 3l7 7" stroke-width="3"/>
      </svg>
      X Image
    </button>
    <button class="nav-btn ${state.currentPage === 'ximage2' ? 'active' : ''}" data-page="ximage2">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
        <path d="M16 3l5 5" stroke-width="3"/>
        <circle cx="18" cy="18" r="3" fill="currentColor"/>
      </svg>
      X Image2
    </button>
    <button class="nav-btn ${state.currentPage === 'ximage3' ? 'active' : ''}" data-page="ximage3">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
        <path d="M15 3l8 8" stroke-width="3"/>
        <circle cx="19" cy="19" r="3" fill="currentColor"/>
        <circle cx="15" cy="19" r="2" fill="currentColor" opacity="0.5"/>
      </svg>
      X Image3
    </button>
    <button class="nav-btn ${state.currentPage === 'motion' ? 'active' : ''}" data-page="motion">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M8 12h8"/>
        <path d="M12 16l4-4-4-4"/>
      </svg>
      Motion
    </button>
    <button class="nav-btn ${state.currentPage === 'voiceover' ? 'active' : ''}" data-page="voiceover">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
        <line x1="8" y1="22" x2="16" y2="22"/>
      </svg>
      Voice Over
    </button>
    <button class="nav-btn ${state.currentPage === 'vidgen2' ? 'active' : ''}" data-page="vidgen2">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
        <line x1="19" y1="8" x2="19" y2="16" stroke-width="2"/>
        <line x1="22" y1="6" x2="22" y2="18" stroke-width="2"/>
      </svg>
      Vidgen2
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
    <button class="nav-btn ${state.currentPage === 'adsStudio' ? 'active' : ''}" data-page="adsStudio">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M8 21h8"/>
        <path d="M12 17v4"/>
        <polygon points="10 7 10 13 15 10 10 7"/>
      </svg>
      Ads Studio
    </button>
    <button class="nav-btn ${state.currentPage === 'automation' ? 'active' : ''}" data-page="automation">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4"/>
        <path d="M12 18v4"/>
        <path d="M4.93 4.93l2.83 2.83"/>
        <path d="M16.24 16.24l2.83 2.83"/>
        <path d="M2 12h4"/>
        <path d="M18 12h4"/>
        <path d="M4.93 19.07l2.83-2.83"/>
        <path d="M16.24 7.76l2.83-2.83"/>
        <circle cx="12" cy="12" r="4"/>
      </svg>
      Automation
    </button>
    <button class="nav-btn ${state.currentPage === 'sceneStudio' ? 'active' : ''}" data-page="sceneStudio">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M8 21h8"/>
        <path d="M12 17v4"/>
        <circle cx="8" cy="10" r="2"/>
        <circle cx="16" cy="10" r="2"/>
        <path d="M6 10h12"/>
      </svg>
      Scene Studio
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
      state.currentPage === 'ximage2' ? renderXImage2Page() :
      state.currentPage === 'ximage3' ? renderXImage3Page() :
      state.currentPage === 'motion' ? renderMotionPage() :
      state.currentPage === 'voiceover' ? renderVoiceoverPage() :
      state.currentPage === 'admin' ? '' :
      state.currentPage === 'adsStudio' ? renderAdsStudioPage() :
      state.currentPage === 'automation' ? renderAutomationPage() :
      state.currentPage === 'sceneStudio' ? renderSceneStudioPage() :
      state.currentPage === 'chat' ? renderChatPage() : renderVideoPage()}
  `;
}

function renderModals() {
  return `
    ${renderAuthModal()}
    ${renderRoomModal()}
    ${renderMotionRoomModal()}
    ${renderXImageRoomModal()}
    ${renderXImage2RoomModal()}
    ${renderXImage3RoomModal()}
    ${renderVoiceoverRoomModal()}
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

function renderXImage2RoomModal() {
  if (!state.ximage2RoomManager.showRoomModal) return '';
  
  return `
    <div class="modal-overlay" id="ximage2RoomModalOverlay">
      <div class="modal room-modal">
        <div class="modal-header">
          <h2>Pilih X Image2 Room</h2>
          <button class="modal-close" id="closeXimage2RoomModal">×</button>
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
              id="ximage2RoomApiKeyInput" 
              class="form-input"
              placeholder="Masukkan Xclip API key Anda..."
              value="${state.ximage2RoomManager.xclipApiKey}"
            >
            <p class="setting-hint" style="margin-top:4px;font-size:11px;">Buat Xclip API key di panel "Xclip Keys" untuk akses X Image2 Room</p>
          </div>
          
          <div class="rooms-list">
            ${state.ximage2RoomManager.isLoading ? `
              <div class="loading-rooms">
                <div class="spinner"></div>
                <p>Memuat rooms...</p>
              </div>
            ` : state.ximage2RoomManager.rooms.length === 0 ? `
              <div class="empty-rooms">
                <p>Tidak ada X Image2 room tersedia</p>
              </div>
            ` : state.ximage2RoomManager.rooms.map(room => `
              <div class="room-item ${room.status !== 'OPEN' ? 'maintenance' : ''}" data-ximage2-room-id="${room.id}">
                <div class="room-info">
                  <div class="room-name">${room.name}</div>
                  <div class="room-stats">
                    <span class="room-users">${room.current_users || 0}/${room.max_users} users</span>
                    <span class="room-slots">${(room.max_users - (room.current_users || 0))} slot tersedia</span>
                  </div>
                </div>
                <div class="room-status">
                  ${room.status === 'OPEN' ? `
                    ${(room.max_users - (room.current_users || 0)) > 0 ? `
                      <span class="status-badge open">OPEN</span>
                      <button class="btn btn-sm btn-primary join-ximage2-room-btn" data-room-id="${room.id}">
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

function renderXImage3RoomModal() {
  if (!state.ximage3RoomManager.showRoomModal) return '';
  return `
    <div class="modal-overlay" id="ximage3RoomModalOverlay">
      <div class="modal room-modal">
        <div class="modal-header">
          <h2>Pilih X Image3 Room</h2>
          <button class="modal-close" id="closeXimage3RoomModal">&times;</button>
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
            <input type="password" id="ximage3RoomApiKeyInput" class="form-input" placeholder="Masukkan Xclip API key Anda..." value="${state.ximage3RoomManager.xclipApiKey}">
            <p class="setting-hint" style="margin-top:4px;font-size:11px;">Buat Xclip API key di panel "Xclip Keys" untuk akses X Image3 Room</p>
          </div>
          <div class="rooms-list">
            ${state.ximage3RoomManager.isLoading ? `
              <div class="loading-rooms"><div class="spinner"></div><p>Memuat rooms...</p></div>
            ` : state.ximage3RoomManager.rooms.length === 0 ? `
              <div class="empty-rooms"><p>Tidak ada X Image3 room tersedia</p></div>
            ` : state.ximage3RoomManager.rooms.map(room => `
              <div class="room-item ${room.status !== 'OPEN' ? 'maintenance' : ''}" data-ximage3-room-id="${room.id}">
                <div class="room-info">
                  <div class="room-name">${room.name}</div>
                  <div class="room-stats">
                    <span class="room-users">${room.current_users || 0}/${room.max_users} users</span>
                    <span class="room-slots">${(room.max_users - (room.current_users || 0))} slot tersedia</span>
                  </div>
                </div>
                <div class="room-status">
                  ${room.status === 'OPEN' ? `
                    ${(room.max_users - (room.current_users || 0)) > 0 ? `
                      <span class="status-badge open">OPEN</span>
                      <button class="btn btn-sm btn-primary join-ximage3-room-btn" data-room-id="${room.id}">Join</button>
                    ` : `<span class="status-badge full">FULL</span>`}
                  ` : `<span class="status-badge maintenance">MAINTENANCE</span>`}
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
function renderVidgen3Page() {
  const models = [
    { id: 'sora-2', name: 'Sora 2', desc: 'Video 8 detik, OpenAI Sora 2', badge: 'SORA', icon: '🎯', type: 'text2video' },
    { id: 'sora-2-pro', name: 'Sora 2 Pro', desc: 'Video 12 detik, kualitas tinggi', badge: 'PRO', icon: '🎬', type: 'text2video' },
    { id: 'grok-video', name: 'Grok Video', desc: 'Video 10 detik, audio native, xAI', badge: 'NEW', icon: '🚀', type: 'text2video' },
    { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', desc: 'Video 8 detik, 4K, cepat & audio native', badge: 'BEST', icon: '⚡', type: 'text2video' },
    { id: 'veo-3.1-lite', name: 'Veo 3.1 Lite', desc: 'Video 8 detik, hemat biaya, 720p/1080p', badge: 'LITE', icon: '💰', type: 'text2video' },
    { id: 'veo-3.1', name: 'Veo 3.1 Standard', desc: 'Video 8 detik, kualitas tertinggi, 4K', badge: '4K', icon: '🎥', type: 'text2video' }
  ];

  const selectedModelInfo = models.find(m => m.id === state.vidgen3.selectedModel) || models[0];

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
        <p class="hero-subtitle">Generate video dengan Grok AI & Sora 2 Pro</p>
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
              <h2 class="card-title">Gambar Referensi (Opsional)</h2>
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
                    <span>Klik untuk upload gambar referensi</span>
                    <span class="upload-hint">JPEG, PNG, WEBP (max 10MB) - Opsional, untuk image-to-video</span>
                  </div>
                `}
                <input type="file" id="vidgen3ImageInput" accept="image/*" style="display:none">
              </div>
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
                <label class="setting-label">Prompt</label>
                <textarea 
                  class="form-textarea" 
                  id="vidgen3Prompt" 
                  placeholder="Deskripsikan video yang ingin dibuat... contoh: A cat walking on the beach at sunset"
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
                const needsPrompt = !state.vidgen3.prompt && !state.vidgen3.sourceImage;
                const isDisabled = state.vidgen3.isGenerating || needsPrompt || state.vidgen3.tasks.length >= 3 || isOnCooldown;
                
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

  html += `
    <div class="setting-group">
      <label class="setting-label">Orientasi</label>
      <div class="aspect-ratio-selector">
        ${['landscape', 'portrait'].map(o => `
          <button class="aspect-btn ${(state.vidgen3.aspectRatio || 'landscape') === o ? 'active' : ''}" data-vidgen3-aspect="${o}">
            <span>${o === 'landscape' ? '🖥 Landscape' : '📱 Portrait'}</span>
          </button>
        `).join('')}
      </div>
    </div>
    <p class="setting-hint" style="text-align:center;opacity:0.7;">
      ${model === 'sora-2' ? 'OpenAI Sora 2 - Video 10 detik' : model === 'sora-2-pro' ? 'OpenAI Sora 2 Pro - Video 15 detik, kualitas tinggi' : model === 'grok-video' ? 'xAI Grok Video - Video 10 detik, audio native' : model === 'veo-3.1-fast' ? 'Google Veo 3.1 Fast - Video 8 detik, 4K' : model === 'veo-3.1-lite' ? 'Google Veo 3.1 Lite - Video 8 detik, hemat' : 'Google Veo 3.1 Standard - Video 8 detik, 4K'}
    </p>
  `;

  return html;
}

function renderVidgen3Tasks() {
  if (state.vidgen3.tasks.length === 0) return '';
  
  let html = '<div class="processing-tasks">';
  html += '<div class="tasks-header"><span class="pulse-dot"></span> Sedang Diproses (' + state.vidgen3.tasks.length + '/3)</div>';
  html += '<div class="tasks-list">';
  
  state.vidgen3.tasks.forEach(function(task) {
    const isFailed = task.status === 'failed';
    html += '<div class="task-card" data-task-id="' + task.taskId + '">';
    html += '<div class="task-card-header">';
    html += '<span class="task-model-badge">' + task.model.toUpperCase() + '</span>';
    if (isFailed) {
      html += '<span class="task-status-badge failed" style="background:rgba(239,68,68,0.2);color:#ef4444;">Failed</span>';
      html += '<button class="btn btn-sm btn-danger vidgen3-dismiss-task" data-dismiss-task="' + task.taskId + '" style="margin-left:auto;padding:2px 8px;font-size:11px;">✕</button>';
    } else {
      html += '<span class="task-status-badge processing">Processing</span>';
    }
    html += '</div>';
    if (isFailed) {
      html += '<div style="color:#ef4444;font-size:12px;padding:6px 0;word-break:break-word;">' + (task.error || 'Generation gagal') + '</div>';
    } else {
      html += '<div class="task-progress-bar"><div class="task-progress-fill indeterminate"></div></div>';
    }
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
      html += '<div class="video-wrapper"><video src="' + (video.taskId ? API_URL + '/api/videogen/proxy-video?taskId=' + encodeURIComponent(video.taskId) : video.url) + '" controls playsinline></video></div>';
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
    xai: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    kling: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-2-11l6 3-6 3V9z"/></svg>',
    ideogram: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
    tongyi: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    freepik: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 7h10v10H7z" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    runway: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18v2H3V4zm2 4h14v2H5V8zm3 4h8v2H8v-2zm4 4h4v2h-4v-2z"/></svg>'
  };
  return icons[iconType] || '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
}

function renderXImagePage() {
  var ximageModels = [
    { id: 'gemini-3-pro-image', name: 'Gemini 3 Pro', icon: 'google', supportsI2I: true, badge: 'NEW', hasResolution: true, resolutions: ['1K', '2K', '4K'], maxRefs: 2, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16', '3:4', '4:3'] },
    { id: 'gemini-3-pro-image-lite', name: 'Gemini 3 Pro Lite', icon: 'google', supportsI2I: true, badge: 'FAST', hasResolution: true, resolutions: ['1K', '2K', '4K'], maxRefs: 2, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16', '3:4', '4:3'] },
    { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash', icon: 'google', supportsI2I: true, hasResolution: true, resolutions: ['1K', '2K', '4K'], maxRefs: 2, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16', '3:4', '4:3'] },
    { id: 'nanobanana2', name: 'Nanobanana 2', icon: 'google', supportsI2I: true, hasResolution: true, resolutions: ['1K', '2K', '4K'], maxRefs: 2, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16', '3:4', '4:3'] },
    { id: 'nanobanana2-beta', name: 'Nanobanana 2 Beta', icon: 'google', supportsI2I: true, badge: 'BUDGET', hasResolution: true, resolutions: ['1K', '2K', '4K'], maxRefs: 2, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16', '3:4', '4:3'] },
    { id: 'seedream-5.0', name: 'Seedream 5.0 Lite', icon: 'bytedance', supportsI2I: true, hasResolution: true, resolutions: ['2K', '3K'], maxRefs: 2, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16', '3:4', '4:3'] },
    { id: 'seedream-4.5', name: 'Seedream 4.5', icon: 'bytedance', supportsI2I: true, hasResolution: true, resolutions: ['2K', '4K'], maxRefs: 2, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16', '3:4', '4:3'] },
    { id: 'grok-4.2-image', name: 'Grok 4.2 Image', icon: 'xai', supportsI2I: true, maxRefs: 1, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16'] },
    { id: 'grok-imagine', name: 'Grok Imagine', icon: 'xai', supportsI2I: true, maxRefs: 1, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16'] },
    { id: 'grok-imagine-pro', name: 'Grok Imagine Pro', icon: 'xai', supportsI2I: true, badge: 'PRO', maxRefs: 1, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16'] },
    { id: 'kling-omni-image', name: 'Kling Omni-Image', icon: 'kling', supportsI2I: true, hasResolution: true, resolutions: ['1K', '2K'], maxRefs: 2, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16', '3:4', '4:3'] },
    { id: 'p-image', name: 'P-Image', icon: 'flux', supportsI2I: false, badge: 'FAST', sizes: ['1:1', '2:3', '3:2', '16:9', '9:16'] },
    { id: 'p-image-edit', name: 'P-Image Edit', icon: 'flux', supportsI2I: true, badge: 'FAST', maxRefs: 2, sizes: ['1:1', '2:3', '3:2', '16:9', '9:16'] }
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
  
  // Size (Aspect Ratio)
  html += '<div class="section-card">';
  html += '<h3 class="section-title">Size</h3>';
  html += '<div class="aspect-buttons">';
  aspectRatios.forEach(function(ratio) {
    html += '<button class="aspect-btn ' + (state.ximage.aspectRatio === ratio ? 'active' : '') + '" data-ximage-ratio="' + ratio + '">' + ratio + '</button>';
  });
  html += '</div></div>';
  
  if (currentModelConfig.hasResolution) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Resolution</h3>';
    html += '<div class="aspect-buttons">';
    currentModelConfig.resolutions.forEach(function(res) {
      html += '<button class="aspect-btn ' + (state.ximage.resolution === res ? 'active' : '') + '" data-ximage-resolution="' + res + '">' + res + '</button>';
    });
    html += '</div></div>';
  }
  
  if (currentModelConfig.hasQuality) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Quality</h3>';
    html += '<div class="aspect-buttons">';
    currentModelConfig.qualities.forEach(function(q) {
      html += '<button class="aspect-btn ' + (state.ximage.quality === q ? 'active' : '') + '" data-ximage-quality="' + q + '">' + q.charAt(0).toUpperCase() + q.slice(1) + '</button>';
    });
    html += '</div></div>';
  }
  
  if (currentModelConfig.hasVariant) {
    var currentVariant = state.ximage.modelVariant || currentModelConfig.variants[0].id;
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Model Variant</h3>';
    html += '<div class="aspect-buttons">';
    currentModelConfig.variants.forEach(function(v) {
      html += '<button class="aspect-btn ' + (currentVariant === v.id ? 'active' : '') + '" data-ximage-variant="' + v.id + '">' + v.name + '</button>';
    });
    html += '</div></div>';
  }
  
  if (currentModelConfig.hasRenderingSpeed) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Rendering Speed</h3>';
    html += '<div class="aspect-buttons">';
    currentModelConfig.renderingSpeeds.forEach(function(s) {
      html += '<button class="aspect-btn ' + (state.ximage.renderingSpeed === s ? 'active' : '') + '" data-ximage-speed="' + s + '">' + s.charAt(0) + s.slice(1).toLowerCase() + '</button>';
    });
    html += '</div></div>';
  }
  
  if (currentModelConfig.hasStyle) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Style</h3>';
    html += '<div class="aspect-buttons">';
    currentModelConfig.styles.forEach(function(s) {
      html += '<button class="aspect-btn ' + (state.ximage.imageStyle === s ? 'active' : '') + '" data-ximage-style="' + s + '">' + s.charAt(0) + s.slice(1).toLowerCase() + '</button>';
    });
    html += '</div></div>';
  }
  
  if (currentModelConfig.hasAcceleration) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Acceleration</h3>';
    html += '<div class="aspect-buttons">';
    currentModelConfig.accelerations.forEach(function(a) {
      html += '<button class="aspect-btn ' + (state.ximage.acceleration === a ? 'active' : '') + '" data-ximage-accel="' + a + '">' + a.charAt(0).toUpperCase() + a.slice(1) + '</button>';
    });
    html += '</div></div>';
  }
  
  if (currentModelConfig.hasGoogleSearch) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Google Search</h3>';
    html += '<p class="setting-hint" style="margin-bottom:8px;font-size:11px;">Gunakan web search grounding untuk generate gambar berdasarkan informasi real-time</p>';
    html += '<label class="toggle-switch" style="display:flex;align-items:center;gap:10px;cursor:pointer;">';
    html += '<input type="checkbox" id="ximageGoogleSearch" ' + (state.ximage.googleSearch ? 'checked' : '') + ' style="width:18px;height:18px;cursor:pointer;">';
    html += '<span>' + (state.ximage.googleSearch ? 'Aktif' : 'Nonaktif') + '</span>';
    html += '</label>';
    html += '</div>';
  }
  
  if (currentModelConfig.hasOutputFormat) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Output Format</h3>';
    html += '<div class="aspect-buttons">';
    currentModelConfig.outputFormats.forEach(function(f) {
      html += '<button class="aspect-btn ' + (state.ximage.outputFormat === f ? 'active' : '') + '" data-ximage-format="' + f + '">' + f.toUpperCase() + '</button>';
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
    var elapsed = task.startTime ? Math.floor((Date.now() - task.startTime) / 1000) : 0;
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
      html += '<div style="display:flex;gap:4px;flex-shrink:0;">';
      html += '<button class="btn btn-sm btn-secondary ximage-download-btn" data-url="' + encodeURIComponent(image.url) + '" data-filename="ximage-' + index + '.png">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      html += ' Download</button>';
      html += '<button class="btn btn-sm btn-danger ximage-delete-btn" data-index="' + index + '">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      html += '</button>';
      html += '</div>';
      html += '</div></div>';
    });
    
    html += '</div></div>';
    return html;
  } else if (state.ximage.tasks.length === 0) {
    return '<div class="empty-preview"><div class="empty-preview-icon"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div><h3>Belum Ada Gambar</h3><p>Masukkan prompt dan klik Generate untuk membuat gambar AI</p></div>';
  }
  return '';
}

function renderXImage2Page() {
  var ximage2Models = [
    { id: 'gpt-4o-image', name: 'GPT-4o Image', icon: 'openai', supportsI2I: true, badge: 'POPULAR', hasN: true, maxN: 4, sizes: ['1:1', '2:3', '3:2'], maxRefs: 5, group: 'openai' },
    { id: 'gemini-2.5-flash-image-preview', name: 'Nano Banana', icon: 'google', supportsI2I: true, hasN: false, sizes: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], maxRefs: 14, group: 'google' },
    { id: 'doubao-seedance-4-0', name: 'Seedream 4.0', icon: 'bytedance', supportsI2I: true, hasN: true, maxN: 15, sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', 'auto'], hasResolution: true, resolutions: ['1K', '2K', '4K'], maxRefs: 10, hasWatermark: true, hasSequential: true, group: 'bytedance' },
    { id: 'doubao-seedance-4-5', name: 'Seedream 4.5', icon: 'bytedance', supportsI2I: true, badge: 'NEW', hasN: true, maxN: 15, sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', 'auto'], hasResolution: true, resolutions: ['2K', '4K'], maxRefs: 10, hasWatermark: true, hasSequential: true, group: 'bytedance' },
    { id: 'seedream-5-0-lite', name: 'Seedream 5.0 Lite', icon: 'bytedance', supportsI2I: true, badge: 'NEW', hasN: true, maxN: 15, sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'], hasResolution: true, resolutions: ['1K', '2K', '3K', '4K'], maxRefs: 10, hasWatermark: true, hasSequential: true, group: 'bytedance' },
    { id: 'flux-kontext-pro', name: 'FLUX Kontext Pro', icon: 'flux', supportsI2I: true, hasN: false, sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', 'match_input_image'], hasSafetyTolerance: true, hasPromptUpsampling: true, maxRefs: 1, group: 'flux' },
    { id: 'flux-kontext-max', name: 'FLUX Kontext Max', icon: 'flux', supportsI2I: true, badge: 'MAX', hasN: false, sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', 'match_input_image'], hasSafetyTolerance: true, hasPromptUpsampling: true, maxRefs: 1, group: 'flux' },
    { id: 'flux-2-flex', name: 'FLUX 2.0 Flex', icon: 'flux', supportsI2I: true, hasN: false, sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], hasResolution: true, resolutions: ['1K', '2K'], maxRefs: 8, group: 'flux' },
    { id: 'flux-2-pro', name: 'FLUX 2.0 Pro', icon: 'flux', supportsI2I: true, badge: 'PRO', hasN: false, sizes: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], hasResolution: true, resolutions: ['1K', '2K'], maxRefs: 8, group: 'flux' }
  ];

  var currentModelConfig = ximage2Models.find(function(m) { return m.id === state.ximage2.selectedModel; }) || ximage2Models[0];
  var sizeOptions = currentModelConfig.sizes || ['1:1'];
  var maxRefs = currentModelConfig.maxRefs || 1;

  var html = '<div class="container">';
  html += '<div class="hero ximage-hero">';
  html += '<div class="hero-badge gradient-badge"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg> AI Image Generator V2</div>';
  html += '<h1 class="gradient-title">X Image2</h1>';
  html += '<p class="hero-subtitle">Generate gambar menakjubkan dengan model AI generasi terbaru</p>';
  html += '</div>';

  html += '<div class="ximage-content">';

  html += '<div class="section-card">';
  html += '<h3 class="section-title">Mode</h3>';
  html += '<div class="mode-selector">';
  html += '<button class="mode-btn ' + (state.ximage2.mode === 'text-to-image' ? 'active' : '') + '" data-ximage2-mode="text-to-image">';
  html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Text to Image</button>';
  html += '<button class="mode-btn ' + (state.ximage2.mode === 'image-to-image' ? 'active' : '') + '" data-ximage2-mode="image-to-image">';
  html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> Image to Image</button>';
  html += '</div></div>';

  if (state.ximage2.mode === 'image-to-image') {
    var numUploadZones = Math.min(maxRefs, 4);
    for (var zi = 0; zi < numUploadZones; zi++) {
      var hasImg = state.ximage2.sourceImages[zi];
      html += '<div class="section-card">';
      html += '<h3 class="section-title">Reference Image ' + (numUploadZones > 1 ? (zi + 1) : '') + (zi > 0 ? ' <span style="font-size:12px;color:#888;font-weight:normal">(opsional)</span>' : '') + '</h3>';
      html += '<div class="reference-upload ' + (hasImg ? 'has-image' : '') + '" id="ximage2UploadZone' + zi + '">';
      if (hasImg) {
        html += '<img src="' + hasImg.data + '" alt="Reference" class="preview-image"/>';
        html += '<button class="remove-image-btn ximage2-remove-ref" data-ref-index="' + zi + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
      } else {
        html += '<div class="upload-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><p>Klik atau drop gambar referensi' + (numUploadZones > 1 ? ' ke-' + (zi + 1) : '') + '</p></div>';
      }
      html += '<input type="file" id="ximage2FileInput' + zi + '" accept="image/*" style="display:none"/>';
      html += '</div></div>';
    }
  }

  html += '<div class="section-card">';
  html += '<h3 class="section-title">Pilih Model AI</h3>';
  html += '<div class="ximage-models-grid">';
  ximage2Models.forEach(function(model) {
    var isDisabled = state.ximage2.mode === 'image-to-image' && !model.supportsI2I;
    var iconSvg = getModelIcon(model.icon);
    html += '<div class="ximage-model-card ' + (state.ximage2.selectedModel === model.id ? 'active' : '') + ' ' + (isDisabled ? 'disabled' : '') + '" data-ximage2-model="' + model.id + '"' + (isDisabled ? ' title="Tidak support Image-to-Image"' : '') + '>';
    html += '<div class="ximage-model-icon">' + iconSvg + '</div>';
    html += '<div class="ximage-model-name">' + model.name + '</div>';
    if (model.badge) html += '<span class="ximage-model-badge badge-' + model.badge.toLowerCase() + '">' + model.badge + '</span>';
    if (isDisabled) html += '<div class="ximage-model-disabled-text">Text Only</div>';
    html += '</div>';
  });
  html += '</div></div>';

  html += '<div class="section-card">';
  html += '<h3 class="section-title">Prompt</h3>';
  html += '<textarea id="ximage2Prompt" class="prompt-input" placeholder="' + (state.ximage2.mode === 'image-to-image' ? 'Deskripsikan perubahan yang diinginkan...' : 'Deskripsikan gambar yang ingin dibuat...') + '" rows="4">' + state.ximage2.prompt + '</textarea>';
  html += '</div>';

  html += '<div class="section-card">';
  html += '<h3 class="section-title">Size</h3>';
  html += '<div class="aspect-buttons">';
  sizeOptions.forEach(function(size) {
    html += '<button class="aspect-btn ' + (state.ximage2.size === size ? 'active' : '') + '" data-ximage2-size="' + size + '">' + size + '</button>';
  });
  html += '</div></div>';

  if (currentModelConfig.hasResolution) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Resolution</h3>';
    html += '<div class="aspect-buttons">';
    currentModelConfig.resolutions.forEach(function(res) {
      html += '<button class="aspect-btn ' + (state.ximage2.resolution === res ? 'active' : '') + '" data-ximage2-resolution="' + res + '">' + res + '</button>';
    });
    html += '</div></div>';
  }

  if (currentModelConfig.hasN) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Number of Images</h3>';
    html += '<div class="number-input-wrapper">';
    html += '<button class="num-btn" data-ximage2-num-action="decrease" ' + (state.ximage2.numberOfImages <= 1 ? 'disabled' : '') + '>-</button>';
    html += '<span class="num-value">' + state.ximage2.numberOfImages + '</span>';
    html += '<button class="num-btn" data-ximage2-num-action="increase" ' + (state.ximage2.numberOfImages >= (currentModelConfig.maxN || 4) ? 'disabled' : '') + '>+</button>';
    html += '</div></div>';
  }

  if (currentModelConfig.hasMask) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Mask Image <span style="font-size:12px;color:#888;font-weight:normal">(opsional, PNG only, max 4MB)</span></h3>';
    html += '<div class="reference-upload ' + (state.ximage2.maskImage ? 'has-image' : '') + '" id="ximage2MaskUploadZone">';
    if (state.ximage2.maskImage) {
      html += '<img src="' + state.ximage2.maskImage.data + '" alt="Mask" class="preview-image"/>';
      html += '<button class="remove-image-btn" id="ximage2RemoveMask"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
    } else {
      html += '<div class="upload-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9z"/><path d="M8 12h8"/><path d="M12 8v8"/></svg><p>Klik atau drop mask image (PNG)</p></div>';
    }
    html += '<input type="file" id="ximage2MaskFileInput" accept="image/png" style="display:none"/>';
    html += '</div></div>';
  }

  if (currentModelConfig.hasWatermark || currentModelConfig.hasSequential || currentModelConfig.hasSafetyTolerance || currentModelConfig.hasInputMode || currentModelConfig.hasPromptUpsampling) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Playground Settings</h3>';

    if (currentModelConfig.hasWatermark) {
      html += '<div class="setting-row" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
      html += '<span class="setting-label">Watermark</span>';
      html += '<label class="toggle-switch"><input type="checkbox" id="ximage2Watermark" ' + (state.ximage2.watermark ? 'checked' : '') + '><span class="toggle-slider"></span></label>';
      html += '</div>';
    }

    if (currentModelConfig.hasSequential) {
      html += '<div class="setting-row" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
      html += '<span class="setting-label">Sequential Generation</span>';
      html += '<label class="toggle-switch"><input type="checkbox" id="ximage2Sequential" ' + (state.ximage2.sequentialGeneration ? 'checked' : '') + '><span class="toggle-slider"></span></label>';
      html += '</div>';
    }

    if (currentModelConfig.hasSafetyTolerance) {
      html += '<div class="setting-row" style="margin-bottom:12px;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;"><span class="setting-label">Safety Tolerance</span><span class="setting-value">' + state.ximage2.safetyTolerance + '</span></div>';
      html += '<input type="range" id="ximage2SafetyTolerance" min="0" max="6" value="' + state.ximage2.safetyTolerance + '" class="range-slider" style="width:100%;">';
      html += '</div>';
    }

    if (currentModelConfig.hasInputMode) {
      html += '<div class="setting-row" style="margin-bottom:12px;">';
      html += '<span class="setting-label" style="margin-bottom:6px;display:block;">Input Mode</span>';
      html += '<div class="aspect-buttons">';
      ['auto', 'image', 'text'].forEach(function(mode) {
        html += '<button class="aspect-btn ' + (state.ximage2.inputMode === mode ? 'active' : '') + '" data-ximage2-input-mode="' + mode + '">' + mode.charAt(0).toUpperCase() + mode.slice(1) + '</button>';
      });
      html += '</div></div>';
    }

    if (currentModelConfig.hasPromptUpsampling) {
      html += '<div class="setting-row" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
      html += '<span class="setting-label">Prompt Upsampling</span>';
      html += '<label class="toggle-switch"><input type="checkbox" id="ximage2PromptUpsampling" ' + (state.ximage2.promptUpsampling ? 'checked' : '') + '><span class="toggle-slider"></span></label>';
      html += '</div>';
    }

    html += '</div>';
  }

  html += '<div class="section-card">';
  html += '<h3 class="section-title">X Image2 Room</h3>';
  if (state.ximage2RoomManager.subscription && state.ximage2RoomManager.subscription.roomName) {
    html += '<div class="room-status-card active">';
    html += '<div class="room-status-info">';
    html += '<span class="room-status-label">Room Aktif:</span>';
    html += '<span class="room-status-name">' + state.ximage2RoomManager.subscription.roomName + '</span>';
    html += '</div>';
    html += '<button class="btn btn-sm btn-outline" id="changeXimage2Room">Ganti Room</button>';
    html += '</div>';
  } else {
    html += '<div class="room-status-card">';
    html += '<p class="room-status-text">Belum bergabung ke room. Pilih room untuk menggunakan X Image2.</p>';
    html += '<button class="btn btn-primary" id="openXimage2RoomModal">Pilih Room</button>';
    html += '</div>';
  }
  html += '</div>';

  html += '<div class="section-card">';
  html += '<h3 class="section-title">Xclip API Key</h3>';
  html += '<input type="password" id="ximage2ApiKey" class="api-key-input" placeholder="Masukkan Xclip API Key" value="' + state.ximage2.customApiKey + '"/>';
  html += '</div>';

  var now = Date.now();
  var cooldownRemaining = Math.max(0, Math.ceil((state.ximage2.cooldownEnd - now) / 1000));
  var btnDisabled = state.ximage2.isGenerating || (state.ximage2.mode === 'image-to-image' && state.ximage2.sourceImages.length === 0) || state.ximage2.tasks.length >= 3 || cooldownRemaining > 0;
  html += '<button class="btn btn-primary btn-lg btn-full" id="ximage2GenerateBtn" ' + (btnDisabled ? 'disabled' : '') + '>';
  if (state.ximage2.isGenerating) {
    html += '<span class="loading-spinner"></span><span>Generating...</span>';
  } else if (cooldownRemaining > 0) {
    html += '<span>Cooldown ' + cooldownRemaining + 's</span>';
  } else {
    html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
    html += '<span>Generate Image' + (state.ximage2.tasks.length > 0 ? ' (' + state.ximage2.tasks.length + '/3)' : '') + '</span>';
  }
  html += '</button>';

  if (state.ximage2.error) {
    html += '<div class="error-message">' + state.ximage2.error + '</div>';
  }

  html += '<div class="ximage-results">';
  html += renderXImage2Tasks();
  html += renderXImage2Gallery();
  html += '</div>';

  html += '</div></div>';
  return html;
}

function renderXImage2Tasks() {
  if (state.ximage2.tasks.length === 0) return '';

  var html = '<div class="tasks-section"><h3>Sedang Diproses</h3><div class="tasks-list">';

  state.ximage2.tasks.forEach(function(task) {
    var elapsed = task.startTime ? Math.floor((Date.now() - task.startTime) / 1000) : 0;
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

function renderXImage2Gallery() {
  if (state.ximage2.generatedImages.length > 0) {
    var html = '<div class="gallery-section">';
    html += '<div class="gallery-header">Gambar yang Dihasilkan (' + state.ximage2.generatedImages.length + ')</div>';
    html += '<div class="images-grid">';

    state.ximage2.generatedImages.forEach(function(image, index) {
      html += '<div class="image-card">';
      html += '<div class="image-wrapper"><img src="' + image.url + '" alt="Generated" loading="lazy"/></div>';
      html += '<div class="image-card-footer">';
      html += '<span class="image-model-tag">' + (image.model || 'AI').toUpperCase() + '</span>';
      html += '<div style="display:flex;gap:4px;flex-shrink:0;">';
      html += '<button class="btn btn-sm btn-secondary ximage2-download-btn" data-url="' + encodeURIComponent(image.url) + '" data-filename="ximage2-' + index + '.png">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      html += ' Download</button>';
      html += '<button class="btn btn-sm btn-danger ximage2-delete-btn" data-index="' + index + '">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      html += '</button>';
      html += '</div>';
      html += '</div></div>';
    });

    html += '</div></div>';
    return html;
  } else if (state.ximage2.tasks.length === 0) {
    return '<div class="empty-preview"><div class="empty-preview-icon"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div><h3>Belum Ada Gambar</h3><p>Masukkan prompt dan klik Generate untuk membuat gambar AI</p></div>';
  }
  return '';
}

function renderXImage3Page() {
  var ximage3Models = [
    { id: 'mystic-sparkle', name: 'Mystic Sparkle', icon: 'freepik', supportsI2I: true, badge: 'POPULAR', hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxRefs: 1, group: 'freepik' },
    { id: 'mystic-sharpy', name: 'Mystic Sharpy', icon: 'freepik', supportsI2I: true, badge: 'PRO', hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxRefs: 1, group: 'freepik' },
    { id: 'mystic-illusio', name: 'Mystic Illusio', icon: 'freepik', supportsI2I: true, hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxRefs: 1, group: 'freepik' },
    { id: 'flux-kontext-pro', name: 'Flux Kontext Pro', icon: 'flux', supportsI2I: true, badge: 'PRO', hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2'], maxRefs: 1, group: 'flux' },
    { id: 'flux-pro-v1-1', name: 'Flux Pro v1.1', icon: 'flux', supportsI2I: false, badge: 'PREMIUM', hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2'], group: 'flux' },
    { id: 'flux-2-pro', name: 'Flux 2 Pro', icon: 'flux', supportsI2I: true, badge: 'PRO', hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'], maxRefs: 4, group: 'flux' },
    { id: 'flux-2-klein', name: 'Flux 2 Klein', icon: 'flux', supportsI2I: true, badge: 'FAST', hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], maxRefs: 4, group: 'flux' },
    { id: 'hyperflux', name: 'Hyperflux', icon: 'flux', supportsI2I: false, badge: 'FASTEST', hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], group: 'flux' },
    { id: 'seedream-v5-lite', name: 'Seedream V5 Lite', icon: 'bytedance', supportsI2I: false, badge: 'NEW', hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], group: 'bytedance' },
    { id: 'seedream-v4-5', name: 'Seedream 4.5', icon: 'bytedance', supportsI2I: false, hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], group: 'bytedance' },
    { id: 'z-image-turbo', name: 'Z-Image Turbo', icon: 'freepik', supportsI2I: false, badge: 'FAST', hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], group: 'freepik' },
    { id: 'runway-t2i', name: 'RunWay', icon: 'runway', supportsI2I: false, hasN: false, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], group: 'runway' },
    { id: 'classic-fast', name: 'Classic Fast', icon: 'freepik', supportsI2I: false, badge: 'INSTANT', hasN: true, maxN: 4, sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'], group: 'freepik' }
  ];

  var currentModelConfig = ximage3Models.find(function(m) { return m.id === state.ximage3.selectedModel; }) || ximage3Models[0];
  var sizeOptions = currentModelConfig.sizes || ['1:1'];
  var maxRefs = currentModelConfig.maxRefs || 1;

  var html = '<div class="container">';
  html += '<div class="hero ximage-hero">';
  html += '<div class="hero-badge gradient-badge"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg> AI Image Generator V3</div>';
  html += '<h1 class="gradient-title">X Image3</h1>';
  html += '<p class="hero-subtitle">Generate gambar menakjubkan dengan Mystic, Flux, Seedream & lainnya</p>';
  html += '</div>';

  html += '<div class="ximage-content">';

  html += '<div class="section-card">';
  html += '<h3 class="section-title">Mode</h3>';
  html += '<div class="mode-selector">';
  html += '<button class="mode-btn ' + (state.ximage3.mode === 'text-to-image' ? 'active' : '') + '" data-ximage3-mode="text-to-image">';
  html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Text to Image</button>';
  html += '<button class="mode-btn ' + (state.ximage3.mode === 'image-to-image' ? 'active' : '') + '" data-ximage3-mode="image-to-image">';
  html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> Image to Image</button>';
  html += '</div></div>';

  if (state.ximage3.mode === 'image-to-image') {
    var numUploadZones = Math.min(maxRefs, 4);
    for (var zi = 0; zi < numUploadZones; zi++) {
      var hasImg = state.ximage3.sourceImages[zi];
      html += '<div class="section-card">';
      html += '<h3 class="section-title">Reference Image ' + (numUploadZones > 1 ? (zi + 1) : '') + (zi > 0 ? ' <span style="font-size:12px;color:#888;font-weight:normal">(opsional)</span>' : '') + '</h3>';
      html += '<div class="reference-upload ' + (hasImg ? 'has-image' : '') + '" id="ximage3UploadZone' + zi + '">';
      if (hasImg) {
        html += '<img src="' + hasImg.data + '" alt="Reference" class="preview-image"/>';
        html += '<button class="remove-image-btn ximage3-remove-ref" data-ref-index="' + zi + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
      } else {
        html += '<div class="upload-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><p>Klik atau drop gambar referensi' + (numUploadZones > 1 ? ' ke-' + (zi + 1) : '') + '</p></div>';
      }
      html += '<input type="file" id="ximage3FileInput' + zi + '" accept="image/*" style="display:none"/>';
      html += '</div></div>';
    }
  }

  html += '<div class="section-card">';
  html += '<h3 class="section-title">Pilih Model AI</h3>';
  html += '<div class="ximage-models-grid">';
  ximage3Models.forEach(function(model) {
    var isDisabled = state.ximage3.mode === 'image-to-image' && !model.supportsI2I;
    var iconSvg = getModelIcon(model.icon);
    html += '<div class="ximage-model-card ' + (state.ximage3.selectedModel === model.id ? 'active' : '') + ' ' + (isDisabled ? 'disabled' : '') + '" data-ximage3-model="' + model.id + '"' + (isDisabled ? ' title="Tidak support Image-to-Image"' : '') + '>';
    html += '<div class="ximage-model-icon">' + iconSvg + '</div>';
    html += '<div class="ximage-model-name">' + model.name + '</div>';
    if (model.badge) html += '<span class="ximage-model-badge badge-' + model.badge.toLowerCase() + '">' + model.badge + '</span>';
    if (isDisabled) html += '<div class="ximage-model-disabled-text">Text Only</div>';
    html += '</div>';
  });
  html += '</div></div>';

  html += '<div class="section-card">';
  html += '<h3 class="section-title">Prompt</h3>';
  html += '<textarea id="ximage3Prompt" class="prompt-input" placeholder="' + (state.ximage3.mode === 'image-to-image' ? 'Deskripsikan perubahan yang diinginkan...' : 'Deskripsikan gambar yang ingin dibuat...') + '" rows="4">' + state.ximage3.prompt + '</textarea>';
  html += '</div>';

  html += '<div class="section-card">';
  html += '<h3 class="section-title">Size</h3>';
  html += '<div class="aspect-buttons">';
  sizeOptions.forEach(function(size) {
    html += '<button class="aspect-btn ' + (state.ximage3.size === size ? 'active' : '') + '" data-ximage3-size="' + size + '">' + size + '</button>';
  });
  html += '</div></div>';

  if (currentModelConfig.hasResolution) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Resolution</h3>';
    html += '<div class="aspect-buttons">';
    currentModelConfig.resolutions.forEach(function(res) {
      html += '<button class="aspect-btn ' + (state.ximage3.resolution === res ? 'active' : '') + '" data-ximage3-resolution="' + res + '">' + res + '</button>';
    });
    html += '</div></div>';
  }

  if (currentModelConfig.hasN) {
    html += '<div class="section-card">';
    html += '<h3 class="section-title">Number of Images</h3>';
    html += '<div class="number-input-wrapper">';
    html += '<button class="num-btn" data-ximage3-num-action="decrease" ' + (state.ximage3.numberOfImages <= 1 ? 'disabled' : '') + '>-</button>';
    html += '<span class="num-value">' + state.ximage3.numberOfImages + '</span>';
    html += '<button class="num-btn" data-ximage3-num-action="increase" ' + (state.ximage3.numberOfImages >= (currentModelConfig.maxN || 4) ? 'disabled' : '') + '>+</button>';
    html += '</div></div>';
  }

  html += '<div class="section-card">';
  html += '<h3 class="section-title">X Image3 Room</h3>';
  if (state.ximage3RoomManager.subscription && state.ximage3RoomManager.subscription.roomName) {
    html += '<div class="room-status-card active">';
    html += '<div class="room-status-info">';
    html += '<span class="room-status-label">Room Aktif:</span>';
    html += '<span class="room-status-name">' + state.ximage3RoomManager.subscription.roomName + '</span>';
    html += '</div>';
    html += '<button class="btn btn-sm btn-outline" id="changeXimage3Room">Ganti Room</button>';
    html += '</div>';
  } else {
    html += '<div class="room-status-card">';
    html += '<p class="room-status-text">Belum bergabung ke room. Pilih room untuk menggunakan X Image3.</p>';
    html += '<button class="btn btn-primary" id="openXimage3RoomModal">Pilih Room</button>';
    html += '</div>';
  }
  html += '</div>';

  html += '<div class="section-card">';
  html += '<h3 class="section-title">Xclip API Key</h3>';
  html += '<input type="password" id="ximage3ApiKey" class="api-key-input" placeholder="Masukkan Xclip API Key" value="' + state.ximage3.customApiKey + '"/>';
  html += '</div>';

  var now = Date.now();
  var cooldownRemaining = Math.max(0, Math.ceil((state.ximage3.cooldownEnd - now) / 1000));
  var btnDisabled = state.ximage3.isGenerating || (state.ximage3.mode === 'image-to-image' && state.ximage3.sourceImages.filter(Boolean).length === 0) || state.ximage3.tasks.length >= 3 || cooldownRemaining > 0;
  html += '<button class="btn btn-primary btn-lg btn-full" id="ximage3GenerateBtn" ' + (btnDisabled ? 'disabled' : '') + '>';
  if (state.ximage3.isGenerating) {
    html += '<span class="loading-spinner"></span><span>Generating...</span>';
  } else if (cooldownRemaining > 0) {
    html += '<span>Cooldown ' + cooldownRemaining + 's</span>';
  } else {
    html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
    html += '<span>Generate Image' + (state.ximage3.tasks.length > 0 ? ' (' + state.ximage3.tasks.length + '/3)' : '') + '</span>';
  }
  html += '</button>';

  if (state.ximage3.error) {
    html += '<div class="error-message">' + state.ximage3.error + '</div>';
  }

  html += '<div class="ximage-results">';
  html += renderXImage3Tasks();
  html += renderXImage3Gallery();
  html += '</div>';

  html += '</div></div>';
  return html;
}

function renderXImage3Tasks() {
  if (state.ximage3.tasks.length === 0) return '';
  var html = '<div class="tasks-section"><h3>Sedang Diproses</h3><div class="tasks-list">';
  state.ximage3.tasks.forEach(function(task) {
    var elapsed = task.startTime ? Math.floor((Date.now() - task.startTime) / 1000) : 0;
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

function renderXImage3Gallery() {
  if (state.ximage3.generatedImages.length > 0) {
    var html = '<div class="gallery-section">';
    html += '<div class="gallery-header">Gambar yang Dihasilkan (' + state.ximage3.generatedImages.length + ')</div>';
    html += '<div class="images-grid">';
    state.ximage3.generatedImages.forEach(function(image, index) {
      var displayUrl = API_URL + '/api/ximage3/proxy-image?url=' + encodeURIComponent(image.url);
      html += '<div class="image-card">';
      html += '<div class="image-wrapper"><img src="' + displayUrl + '" alt="Generated" loading="lazy"/></div>';
      html += '<div class="image-card-footer">';
      html += '<span class="image-model-tag">' + (image.model || 'AI').toUpperCase() + '</span>';
      html += '<div style="display:flex;gap:4px;flex-shrink:0;">';
      html += '<button class="btn btn-sm btn-secondary ximage3-download-btn" data-url="' + encodeURIComponent(image.url) + '" data-filename="ximage3-' + index + '.png">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      html += ' Download</button>';
      html += '<button class="btn btn-sm btn-danger ximage3-delete-btn" data-index="' + index + '">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      html += '</button>';
      html += '</div>';
      html += '</div></div>';
    });
    html += '</div></div>';
    return html;
  } else if (state.ximage3.tasks.length === 0) {
    return '<div class="empty-preview"><div class="empty-preview-icon"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div><h3>Belum Ada Gambar</h3><p>Masukkan prompt dan klik Generate untuk membuat gambar AI</p></div>';
  }
  return '';
}

async function downloadImage(url, filename) {
  try {
    var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    var safeName = filename || 'image-' + Date.now() + '.png';
    var proxyPath = '/api/ximage/download';
    if (filename && filename.indexOf('ximage2') === 0) {
      proxyPath = '/api/ximage2/download';
    } else if (filename && filename.indexOf('ximage3') === 0) {
      proxyPath = '/api/ximage3/download';
    }

    showToast('Mempersiapkan file...', 'info');

    var blob;
    try {
      var proxyUrl = API_URL + proxyPath + '?url=' + encodeURIComponent(url);
      var response = await fetch(proxyUrl, { credentials: 'include' });
      if (response.ok) blob = await response.blob();
    } catch (e) {}

    if (!blob) {
      try {
        var response2 = await fetch(url, { mode: 'cors' });
        if (response2.ok) blob = await response2.blob();
      } catch (e) {}
    }

    if (!blob) {
      window.open(url, '_blank');
      showToast('Membuka gambar di tab baru. Tekan lama untuk simpan ke galeri.', 'info');
      return;
    }

    var ext = safeName.split('.').pop() || 'png';
    var mimeType = blob.type || ('image/' + (ext === 'jpg' ? 'jpeg' : ext));
    var imageFile = new File([blob], safeName, { type: mimeType });

    if (isMobile && navigator.canShare && navigator.canShare({ files: [imageFile] })) {
      try {
        await navigator.share({
          files: [imageFile],
          title: safeName.replace(/\.[^.]+$/, '')
        });
        showToast('Gambar berhasil disimpan!', 'success');
        return;
      } catch (shareErr) {
        if (shareErr.name === 'AbortError') {
          showToast('Dibatalkan', 'info');
          return;
        }
      }
    }

    var blobUrl = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
    showToast('Gambar berhasil diunduh', 'success');
  } catch (err) {
    console.error('Download error:', err);
    window.open(url, '_blank');
    showToast('Membuka gambar di tab baru. Tekan lama untuk simpan.', 'info');
  }
}

function renderVoiceoverRoomModal() {
  if (!state.voiceoverRoomManager.showRoomModal) return '';
  return `
    <div class="modal-overlay" id="voiceoverRoomModalOverlay">
      <div class="modal room-modal">
        <div class="modal-header">
          <h2>Pilih Voice Room</h2>
          <button class="modal-close" id="closeVoiceoverRoomModal">×</button>
        </div>
        <div class="modal-body">
          <div class="api-key-input-section" style="margin-bottom:20px;">
            <label class="setting-label">Xclip API Key</label>
            <input type="password" id="voiceoverRoomApiKeyInput" class="form-input"
                   placeholder="Masukkan Xclip API Key..." value="${state.voiceoverRoomManager.xclipApiKey}">
            <p class="setting-hint" style="margin-top:4px;font-size:11px;">Buat Xclip API key di panel "Xclip Keys"</p>
          </div>
          <div class="rooms-list">
            ${state.voiceoverRoomManager.isLoading ? `
              <div class="loading-rooms"><div class="spinner"></div><p>Memuat rooms...</p></div>
            ` : state.voiceoverRoomManager.rooms.length === 0 ? `
              <div class="empty-rooms"><p>Tidak ada voice room tersedia</p></div>
            ` : state.voiceoverRoomManager.rooms.map(room => `
              <div class="room-item ${room.status !== 'open' ? 'maintenance' : ''}">
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
                      <button class="btn btn-sm btn-primary join-voiceover-room-btn" data-room-id="${room.id}">Join</button>
                    ` : `<span class="status-badge full">FULL</span>`}
                  ` : `<span class="status-badge maintenance">MAINTENANCE</span>`}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderVoiceoverPage() {
  const vo = state.voiceover;
  const rm = state.voiceoverRoomManager;
  const ELEVENLABS_MODELS = [
    { id: 'elevenlabs/text-to-speech-multilingual-v2', name: 'Multilingual v2', desc: 'Kualitas terbaik, 70+ bahasa', badge: '' },
    { id: 'elevenlabs/text-to-speech-turbo-2-5', name: 'Turbo v2.5', desc: 'Tercepat, ultra low latency', badge: '⚡' },
    { id: 'elevenlabs/text-to-dialogue-v3', name: 'Eleven v3 Dialogue', desc: 'Paling ekspresif, multi-speaker', badge: '🆕' }
  ];
  const isDialogueMode = vo.selectedModel === 'elevenlabs/text-to-dialogue-v3';
  const availableVoiceNames = vo.voices.map(v => v.name);
  const filteredVoices = vo.voices.filter(v =>
    !vo.voiceSearch || v.name.toLowerCase().includes(vo.voiceSearch.toLowerCase()) ||
    (v.labels?.accent || '').toLowerCase().includes(vo.voiceSearch.toLowerCase()) ||
    (v.labels?.gender || '').toLowerCase().includes(vo.voiceSearch.toLowerCase())
  );
  return `
    <div class="container">
      <div class="hero">
        <div class="hero-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="currentColor" stroke-width="2"/>
          </svg>
          ElevenLabs TTS
        </div>
        <h1 class="hero-title"><span class="gradient-text">AI Voice</span> Over</h1>
        <p class="hero-subtitle">Ubah teks menjadi suara natural dengan ElevenLabs</p>
      </div>

      ${state.auth.user ? `
      <div class="room-manager-panel glass-card" style="margin-bottom:20px;">
        <div class="room-manager-header">
          <div class="room-manager-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
            </svg>
            <span>Voice Room</span>
          </div>
          ${rm.hasSubscription ? `
            <div class="subscription-info">
              <span class="sub-badge active">Aktif</span>
              <span class="sub-time">${rm.subscription?.roomName || 'Voice Room'}</span>
            </div>
          ` : ''}
        </div>
        <div class="room-manager-content">
          <div class="api-key-row" style="margin-bottom:12px;">
            <label class="setting-label" style="font-size:12px;">Xclip API Key</label>
            <input type="password" id="voiceoverApiKeyInput" class="form-input" style="font-size:13px;"
                   placeholder="Masukkan Xclip API key..." value="${vo.customApiKey}">
          </div>
          ${rm.hasSubscription ? `
            <div class="room-info-bar" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <span style="font-size:13px;color:var(--text-secondary);">
                Room: <strong style="color:var(--text-primary);">${rm.subscription?.roomName}</strong>
              </span>
              <button class="btn btn-sm btn-secondary" id="changeVoiceRoomBtn">Ganti Room</button>
            </div>
          ` : `
            <button class="btn btn-primary" id="openVoiceoverRoomModalBtn" style="width:100%;">
              Pilih Voice Room untuk Mulai
            </button>
          `}
        </div>
      </div>
      ` : ''}

      <div class="voiceover-layout" style="display:grid;grid-template-columns:1fr 340px;gap:20px;">
        
        <div class="voiceover-main">
          ${isDialogueMode ? `
          <div class="glass-card" style="padding:24px;margin-bottom:20px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
              <label class="setting-label">Dialogue Segments</label>
              <button class="btn btn-sm btn-secondary" id="addDialogueSegmentBtn">+ Tambah Segment</button>
            </div>
            <div id="dialogueSegmentsContainer">
              ${(vo.dialogueSegments || []).map((seg, idx) => `
                <div class="dialogue-segment" data-seg-idx="${idx}" style="border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px;background:var(--surface);">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <span style="font-size:12px;color:var(--text-muted);min-width:70px;">Speaker ${idx + 1}</span>
                    <select class="form-input dialogue-voice-select" data-seg-idx="${idx}" style="flex:1;font-size:13px;padding:6px 10px;height:36px;">
                      ${vo.voices.length > 0 ? vo.voices.map(v => `<option value="${v.name}" ${seg.voice === v.name ? 'selected' : ''}>${v.name}</option>`).join('') : `<option value="${seg.voice}">${seg.voice}</option>`}
                    </select>
                    ${(vo.dialogueSegments || []).length > 1 ? `
                      <button class="btn btn-sm remove-dialogue-seg-btn" data-seg-idx="${idx}" 
                              style="background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.3);padding:4px 8px;">✕</button>
                    ` : ''}
                  </div>
                  <textarea class="form-input dialogue-text-input" data-seg-idx="${idx}" rows="3" 
                            placeholder="Teks untuk Speaker ${idx + 1}..."
                            style="resize:vertical;font-size:13px;">${seg.text}</textarea>
                </div>
              `).join('')}
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">Eleven v3 Dialogue mendukung multi-speaker dalam satu audio.</p>
          </div>
          ` : `
          <div class="glass-card" style="padding:24px;margin-bottom:20px;">
            <label class="setting-label" style="margin-bottom:8px;display:block;">
              Teks
              <span style="float:right;font-size:12px;color:var(--text-muted);">${vo.text.length}/5000</span>
            </label>
            <textarea id="voiceoverText" class="form-input" rows="8" maxlength="5000"
                      placeholder="Masukkan teks yang ingin diubah menjadi suara..." 
                      style="resize:vertical;min-height:160px;">${vo.text}</textarea>
          </div>
          `}

          <div class="glass-card" style="padding:24px;margin-bottom:20px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
              <label class="setting-label">Pilih Suara</label>
              ${rm.hasSubscription || state.admin.isAdmin ? `
                <button class="btn btn-sm btn-secondary" id="refreshVoicesBtn" ${vo.voicesLoading ? 'disabled' : ''}>
                  ${vo.voicesLoading ? '...' : 'Muat Suara'}
                </button>
              ` : ''}
            </div>
            
            ${vo.voices.length > 0 ? `
              <input type="text" id="voiceSearchInput" class="form-input" style="margin-bottom:12px;font-size:13px;"
                     placeholder="Cari suara..." value="${vo.voiceSearch}">
              <div class="voices-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;max-height:320px;overflow-y:auto;">
                ${filteredVoices.map(v => `
                  <div class="voice-card ${vo.selectedVoiceId === v.voice_id ? 'selected' : ''}"
                       data-voice-id="${v.voice_id}" data-voice-name="${v.name}"
                       style="padding:12px;border:1px solid ${vo.selectedVoiceId === v.voice_id ? 'var(--primary)' : 'var(--border)'};
                              border-radius:10px;cursor:pointer;transition:all 0.2s;background:${vo.selectedVoiceId === v.voice_id ? 'rgba(99,102,241,0.1)' : 'var(--surface)'};
                              position:relative;">
                    <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${v.name}</div>
                    <div style="font-size:11px;color:var(--text-muted);">
                      ${[v.labels?.gender, v.labels?.accent, v.labels?.age].filter(Boolean).join(' • ') || v.category || 'Voice'}
                    </div>
                    ${v.preview_url ? `
                      <button class="preview-voice-btn" data-preview="${v.preview_url}" data-name="${v.name}"
                              style="position:absolute;top:8px;right:8px;background:none;border:none;cursor:pointer;
                                     color:var(--text-muted);padding:4px;" title="Preview">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      </button>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
              ${vo.selectedVoiceId ? `
                <div style="margin-top:12px;padding:10px;background:rgba(99,102,241,0.08);border-radius:8px;font-size:13px;">
                  Suara dipilih: <strong>${vo.selectedVoiceName}</strong>
                </div>
              ` : ''}
            ` : `
              <div style="text-align:center;padding:32px;color:var(--text-muted);">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px;opacity:0.4;">
                  <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                </svg>
                <p>${rm.hasSubscription || state.admin.isAdmin ? 'Klik "Muat Suara" untuk melihat daftar suara ElevenLabs' : 'Join Voice Room terlebih dahulu untuk melihat suara'}</p>
              </div>
            `}
          </div>

          ${(() => {
            const now = Date.now();
            const cooldownSecs = vo.cooldownEnd > now ? Math.ceil((vo.cooldownEnd - now) / 1000) : 0;
            const isOnCooldown = cooldownSecs > 0;
            const isDisabled = vo.isGenerating || isOnCooldown ||
              (isDialogueMode ? !(vo.dialogueSegments || []).some(s => s.text.trim()) : (!vo.text.trim() || !vo.selectedVoiceId));
            return `
          <button class="btn btn-primary btn-generate" id="generateVoiceoverBtn" style="width:100%;height:52px;font-size:16px;" ${isDisabled ? 'disabled' : ''}>
            ${vo.isGenerating ? `
              <div class="spinner" style="width:18px;height:18px;margin-right:8px;"></div> Generating...
            ` : isOnCooldown ? `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px;">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Tunggu ${cooldownSecs}s
            ` : `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-right:8px;">
                <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
              </svg>
              Generate Voice Over
            `}
          </button>`;
          })()}

          ${vo.currentAudioUrl ? `
            <div class="glass-card" style="padding:20px;margin-top:20px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <span class="setting-label">Hasil</span>
                <a href="${vo.currentAudioUrl}" download class="btn btn-sm btn-secondary">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download
                </a>
              </div>
              <audio controls style="width:100%;" src="${vo.currentAudioUrl}"></audio>
            </div>
          ` : ''}
        </div>

        <div class="voiceover-sidebar">
          <div class="glass-card" style="padding:20px;margin-bottom:16px;">
            <label class="setting-label" style="margin-bottom:12px;display:block;">Model</label>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${ELEVENLABS_MODELS.map(m => `
                <div class="model-option ${vo.selectedModel === m.id ? 'selected' : ''}" data-vo-model="${m.id}"
                     style="padding:12px;border:1px solid ${vo.selectedModel === m.id ? 'var(--primary)' : 'var(--border)'};
                            border-radius:8px;cursor:pointer;transition:all 0.2s;
                            background:${vo.selectedModel === m.id ? 'rgba(99,102,241,0.1)' : 'var(--surface)'};">
                  <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;">
                    ${m.badge ? `<span>${m.badge}</span>` : ''}${m.name}
                  </div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${m.desc}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="glass-card" style="padding:20px;margin-bottom:16px;">
            <label class="setting-label" style="margin-bottom:16px;display:block;">Voice Settings</label>
            
            <div style="margin-bottom:16px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <label style="font-size:13px;">Stability</label>
                <span style="font-size:13px;color:var(--primary);">${(vo.stability * 100).toFixed(0)}%</span>
              </div>
              <input type="range" id="voStability" min="0" max="1" step="0.01" value="${vo.stability}"
                     style="width:100%;accent-color:var(--primary);">
              <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Rendah = lebih ekspresif, Tinggi = lebih konsisten</p>
            </div>
            
            ${!isDialogueMode ? `
            <div style="margin-bottom:16px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <label style="font-size:13px;">Clarity</label>
                <span style="font-size:13px;color:var(--primary);">${(vo.similarityBoost * 100).toFixed(0)}%</span>
              </div>
              <input type="range" id="voSimilarity" min="0" max="1" step="0.01" value="${vo.similarityBoost}"
                     style="width:100%;accent-color:var(--primary);">
            </div>
            
            <div style="margin-bottom:16px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <label style="font-size:13px;">Style Exaggeration</label>
                <span style="font-size:13px;color:var(--primary);">${(vo.style * 100).toFixed(0)}%</span>
              </div>
              <input type="range" id="voStyle" min="0" max="1" step="0.01" value="${vo.style}"
                     style="width:100%;accent-color:var(--primary);">
            </div>

            <div style="display:flex;align-items:center;gap:10px;">
              <input type="checkbox" id="voSpeakerBoost" ${vo.useSpeakerBoost ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--primary);">
              <label for="voSpeakerBoost" style="font-size:13px;cursor:pointer;">Speaker Boost</label>
            </div>
            ` : `<p style="font-size:12px;color:var(--text-muted);">Eleven v3 Dialogue hanya mendukung Stability.</p>`}
          </div>

          ${vo.history.length > 0 ? `
            <div class="glass-card" style="padding:20px;">
              <label class="setting-label" style="margin-bottom:12px;display:block;">Riwayat</label>
              <div style="display:flex;flex-direction:column;gap:10px;max-height:360px;overflow-y:auto;">
                ${vo.history.map(h => `
                  <div style="padding:10px;background:var(--surface);border-radius:8px;border:1px solid var(--border);">
                    <div style="font-size:12px;font-weight:600;margin-bottom:4px;">${h.voice_name} • ${h.model_id.replace('eleven_','').replace('_',' ')}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${h.text_input}">${h.text_input || ''}</div>
                    <audio controls style="width:100%;height:32px;" src="${h.audio_url}"></audio>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
                      <span style="font-size:11px;color:var(--text-muted);">${new Date(h.created_at).toLocaleDateString('id-ID')}</span>
                      <div style="display:flex;gap:8px;align-items:center;">
                        <a href="${h.audio_url}" download style="font-size:11px;color:var(--primary);">Download</a>
                        <button class="voiceover-delete-btn" data-vo-id="${h.id}" style="font-size:11px;color:#ef4444;background:none;border:none;cursor:pointer;padding:0;">Hapus</button>
                      </div>
                    </div>
                  </div>
                `).join('')}
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
                    <span class="upload-hint">JPG, PNG, WebP (max 50MB)</span>
                  </div>
                `}
                <input type="file" id="videoGenImageInput" accept="image/*" style="display:none">
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
                      <video src="${video.taskId ? API_URL + '/api/videogen/proxy-video?taskId=' + encodeURIComponent(video.taskId) : video.url}" controls playsinline class="generated-video" ${idx === 0 ? 'autoplay' : ''} loop></video>
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
            <label class="setting-label" style="margin-bottom: 8px; display: block;">Pilih Room</label>
            <div class="room-buttons" style="display: flex; gap: 6px; flex-wrap: wrap;">
              ${[1, 2, 3, 4, 5].map(roomId => {
                const usage = state.motion.roomUsage[roomId] || 0;
                const maxU = state.motion.roomMaxUsers[roomId] || 100;
                const isFull = usage >= maxU;
                const isSelected = state.motion.selectedRoom === roomId;
                return `<button 
                  class="btn ${isSelected ? 'btn-primary' : isFull ? 'btn-disabled' : 'btn-outline'}" 
                  data-motion-room="${roomId}" 
                  style="min-width: 70px; position: relative;" 
                  ${isFull && !isSelected ? 'disabled' : ''}>
                  Room ${roomId}
                  <span style="display: block; font-size: 10px; opacity: 0.8;">${usage}/${maxU}</span>
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
                    <span class="upload-hint">JPG, PNG, WEBP (max 50MB)</span>
                  </div>
                `}
              </div>
              <input type="file" id="motionImageInput" accept="image/*" style="display:none;position:absolute;left:-9999px">
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
                    <video src="${state.motion.referenceVideo.preview}" muted autoplay loop playsinline preload="auto" poster="${state.motion.referenceVideo.thumbnail || ''}"></video>
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
              </div>
              <input type="file" id="motionVideoInput" accept="video/*" style="display:none;position:absolute;left:-9999px">
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
                          <video src="${task.taskId ? API_URL + '/api/videogen/proxy-video?taskId=' + encodeURIComponent(task.taskId) : task.videoUrl}" controls class="result-video"></video>
                          <div class="task-actions" style="display: flex; gap: 8px; margin-top: 8px;">
                            <button onclick="downloadVideo('${task.videoUrl}', 'motion-${Date.now()}.mp4')" class="btn btn-primary btn-sm" style="flex:1">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                              </svg>
                              Download
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="deleteMotionTask('${task.taskId}')">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      ` : task.status === 'failed' ? `
                        <div class="task-error">${cleanMotionError(task.error)}</div>
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
                      <video src="${video.taskId ? API_URL + '/api/videogen/proxy-video?taskId=' + encodeURIComponent(video.taskId) : video.url}" controls class="result-video"></video>
                      <div class="task-actions" style="display: flex; gap: 8px; margin-top: 8px;">
                        <button onclick="downloadVideo('${video.url}', 'motion-${video.taskId}.mp4')" class="btn btn-primary btn-sm" style="flex:1">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          Download
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteMotionHistory(${idx})">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
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

function cleanMotionError(err) {
  if (!err) return 'Konten tidak dapat diproses oleh AI. Coba gambar/video berbeda.';
  const cleaned = err.split(' | Debug:')[0].split(' | Webhook:')[0].trim();
  if (!cleaned || cleaned === 'Video generation failed' || cleaned.includes('"status":"FAILED"') || cleaned.includes('"generated":[]') || cleaned.includes('request_id')) {
    return 'Konten tidak dapat diproses oleh AI. Coba gambar/video berbeda.';
  }
  return cleaned;
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

// ============ SCENE STUDIO ============

function safeJsonbArray(val) {
  if (Array.isArray(val)) return val;
  if (val && typeof val === 'object') return Object.values(val);
  if (typeof val === 'string') { try { return JSON.parse(val); } catch(e) { return []; } }
  return [];
}

async function loadSceneStudioModels() {
  if (state.sceneStudio._modelsLoaded) return;
  try {
    const response = await fetch(`${API_URL}/api/scene-studio/models`);
    const data = await response.json();
    state.sceneStudio.models = data.models || [];
    state.sceneStudio._modelsLoaded = true;
    render(true);
  } catch (e) { console.error('Load scene studio models error:', e); }
}

async function loadSceneStudioHistory() {
  try {
    const response = await fetch(`${API_URL}/api/scene-studio/history`, { credentials: 'include' });
    const data = await response.json();
    state.sceneStudio.history = (data.batches || []).map(b => {
      b.prompts = safeJsonbArray(b.prompts);
      b.results = safeJsonbArray(b.results);
      return b;
    });
  } catch (e) { console.error('Load scene studio history error:', e); }
  render(true);
}

async function deleteSceneStudioBatch(id) {
  if (!confirm('Hapus batch ini?')) return;
  try {
    await fetch(`${API_URL}/api/scene-studio/history/${id}`, { method: 'DELETE', credentials: 'include' });
    await loadSceneStudioHistory();
  } catch (e) { alert('Error: ' + e.message); }
}

async function generateSceneStudioBatch() {
  const ss = state.sceneStudio;
  const validPrompts = ss.prompts.filter(p => p.trim());
  if (validPrompts.length === 0) return alert('Minimal 1 prompt diperlukan');
  
  const apiKey = ss.customApiKey || state.ximage2.customApiKey;
  if (!apiKey) return alert('Xclip API key diperlukan. Masukkan di X Image2 terlebih dahulu.');
  
  ss.isGenerating = true;
  ss.error = null;
  ss.batchResults = [];
  ss.batchProgress = { current: 0, total: validPrompts.length, batchId: null };
  render();

  try {
    const response = await fetch(`${API_URL}/api/scene-studio/generate`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-xclip-key': apiKey },
      body: JSON.stringify({
        prompts: validPrompts,
        characterDesc: ss.characterDesc,
        characterRefImages: ss.characterRefImages,
        bgRefImages: ss.bgRefImages,
        stylePreset: ss.selectedStyle,
        model: ss.selectedModel,
        size: ss.selectedSize,
        resolution: ss.selectedResolution
      })
    });
    const data = await response.json();
    if (data.success) {
      ss.batchProgress.batchId = data.batchId;
    } else {
      ss.error = data.error || 'Gagal generate batch';
      ss.isGenerating = false;
    }
  } catch (e) {
    ss.error = e.message;
    ss.isGenerating = false;
  }
  render();
}

// ============ ADS STUDIO PAGE ============

async function loadAdsStudioProjects() {
  if (state.adsStudio.isLoading) return;
  state.adsStudio.isLoading = true;
  try {
    var response = await fetch(API_URL + '/api/ads-studio/projects', { credentials: 'include' });
    var data = await response.json();
    state.adsStudio.projects = data.projects || [];
  } catch (err) {
    console.error('Failed to load ads studio projects:', err);
  }
  state.adsStudio._loaded = true;
  state.adsStudio.isLoading = false;
  if (state.currentPage === 'adsStudio' && state.adsStudio.view !== 'detail') {
    var listContainer = document.querySelector('.auto-project-list');
    if (listContainer) {
      var listHtml = '';
      state.adsStudio.projects.forEach(function(p) {
        listHtml += '<div class="auto-project-card" data-ads-project="' + p.project_id + '">';
        listHtml += '<div class="auto-project-left">';
        listHtml += '<div class="auto-project-title">' + escapeHtml(p.title || p.product_name) + '</div>';
        listHtml += '<div class="auto-project-sub">' + escapeHtml(p.ad_type === 'hard_selling' ? 'Hard Sell' : 'Soft Sell') + ' &middot; ' + (p.format === 'shorts' ? 'Shorts' : 'Landscape') + ' &middot; ' + p.scene_count + ' scene &middot; ' + new Date(p.created_at).toLocaleDateString() + '</div>';
        listHtml += '</div>';
        listHtml += getAdsStudioStatusBadge(p.status);
        listHtml += '</div>';
      });
      listContainer.innerHTML = listHtml;
      attachAdsStudioProjectCardListeners();
    }
  }
}

async function loadAdsStudioProjectDetail(projectId) {
  try {
    var response = await fetch(API_URL + '/api/ads-studio/projects/' + projectId, { credentials: 'include' });
    var data = await response.json();
    state.adsStudio.currentProject = data.project;
    state.adsStudio.currentScenes = data.scenes || [];
    state.adsStudio.view = 'detail';
    render();
  } catch (err) {
    console.error('Failed to load ads studio project:', err);
  }
}

function showAdsError(msg) {
  var el = document.getElementById('adsErrorMsg');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(function() { el.style.display = 'none'; }, 8000);
  }
}

function resetAdsCreateBtn() {
  var btn = document.getElementById('adsCreateBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  }
}

async function createAdsStudioProject() {
  var nameEl = document.getElementById('adsProductName');
  var descEl = document.getElementById('adsProductDesc');
  var adTypeEl = document.getElementById('adsAdType');
  var formatEl = document.getElementById('adsFormat');
  var modelEl = document.getElementById('adsVideoModel');
  var durEl = document.getElementById('adsDuration');
  var sceneEl = document.getElementById('adsSceneCount');
  var langEl = document.getElementById('adsLanguage');
  var voEl = document.getElementById('adsVoiceOver');
  var btn = document.getElementById('adsCreateBtn');

  var productName = (nameEl ? nameEl.value : '') || '';
  productName = productName.trim();
  if (!productName) {
    showAdsError('Masukkan nama produk!');
    return;
  }

  var productDesc = (descEl ? descEl.value : '') || '';
  var adType = (adTypeEl ? adTypeEl.value : '') || 'soft_selling';
  var format = (formatEl ? formatEl.value : '') || 'shorts';
  var videoModel = (modelEl ? modelEl.value : '') || 'wan-v2.7-pro';
  var videoDuration = (durEl ? parseInt(durEl.value) : 5) || 5;
  var sceneCount = (sceneEl ? parseInt(sceneEl.value) : 4) || 4;
  var language = (langEl ? langEl.value : '') || 'id';
  var voiceOverEnabled = voEl ? voEl.checked : false;

  var charImage = state.adsStudio.newProject.characterImage;
  var prodImage = state.adsStudio.newProject.productImage;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
  }

  try {
    var formData = new FormData();
    formData.append('productName', productName);
    formData.append('productDescription', productDesc.trim());
    formData.append('adType', adType);
    formData.append('format', format);
    formData.append('videoModel', videoModel);
    formData.append('videoDuration', String(videoDuration));
    formData.append('sceneCount', String(sceneCount));
    formData.append('language', language);
    formData.append('voiceOverEnabled', String(voiceOverEnabled));

    if (charImage) formData.append('characterImage', charImage);
    if (prodImage) formData.append('productImage', prodImage);

    var response = await fetch(API_URL + '/api/ads-studio/projects', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    if (!response.ok) {
      var errText = '';
      try { var errData = await response.json(); errText = errData.error || ''; } catch(e) { errText = response.statusText; }
      showAdsError('Error ' + response.status + ': ' + (errText || 'Server error'));
      resetAdsCreateBtn();
      return;
    }

    var data = await response.json();
    if (data.success) {
      state.adsStudio.newProject = { productName: '', productDescription: '', adType: 'soft_selling', format: 'shorts', videoModel: 'wan-v2.7-pro', videoDuration: 5, sceneCount: 4, language: 'id', voiceOverEnabled: false, characterImage: null, characterImagePreview: null, productImage: null, productImagePreview: null };
      state.adsStudio.isCreating = false;
      state.adsStudio._loaded = false;
      await loadAdsStudioProjects();
      loadAdsStudioProjectDetail(data.projectId);
    } else {
      showAdsError(data.error || 'Gagal membuat project');
      resetAdsCreateBtn();
    }
  } catch (err) {
    showAdsError('Gagal: ' + err.message);
    resetAdsCreateBtn();
  }
}

async function generateAdsStudioScript(projectId) {
  state.adsStudio.isGeneratingScript = true;
  render();
  try {
    var response = await fetch(API_URL + '/api/ads-studio/projects/' + projectId + '/generate-script', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    var data = await response.json();
    if (!data.success) alert(data.error || 'Gagal generate script');
  } catch (err) {
    alert('Gagal generate script: ' + err.message);
  }
  state.adsStudio.isGeneratingScript = false;
  render();
}

async function startAdsStudioProduction(projectId) {
  var scenes = state.adsStudio.currentScenes;
  for (var i = 0; i < scenes.length; i++) {
    var narrationEl = document.querySelector('.ads-scene-narration[data-scene="' + scenes[i].scene_index + '"]');
    var visualEl = document.querySelector('.ads-scene-visual[data-scene="' + scenes[i].scene_index + '"]');
    var updates = {};
    if (narrationEl && narrationEl.value !== scenes[i].narration) updates.narration = narrationEl.value;
    if (visualEl && visualEl.value !== scenes[i].visual_prompt) updates.visualPrompt = visualEl.value;
    if (Object.keys(updates).length > 0) {
      try {
        await fetch(API_URL + '/api/ads-studio/projects/' + projectId + '/scenes/' + scenes[i].scene_index, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
      } catch (e) { console.error('Failed to save scene edit:', e); }
    }
  }

  state.adsStudio.isProducing = true;
  render();
  try {
    var response = await fetch(API_URL + '/api/ads-studio/projects/' + projectId + '/start', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    var data = await response.json();
    if (!data.success) alert(data.error || 'Gagal memulai produksi');
  } catch (err) {
    alert('Gagal memulai produksi: ' + err.message);
  }
  state.adsStudio.isProducing = false;
  render();
}

async function retryAdsStudioScene(projectId, sceneIndex, retryMode) {
  try {
    showToast('Retry scene ' + (sceneIndex + 1) + '...', 'info');
    var body = { sceneIndex: sceneIndex };
    if (retryMode) body.retryMode = retryMode;
    var response = await fetch(API_URL + '/api/ads-studio/projects/' + projectId + '/retry-scene', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await response.json();
    if (!data.success) {
      showToast(data.error || 'Gagal retry scene', 'error');
    }
  } catch (err) {
    showToast('Gagal retry: ' + err.message, 'error');
  }
}

async function mergeAdsStudioProject(projectId) {
  try {
    var response = await fetch(API_URL + '/api/ads-studio/projects/' + projectId + '/merge', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    var data = await response.json();
    if (!data.success) alert(data.error || 'Gagal merge');
  } catch (err) {
    alert('Gagal merge: ' + err.message);
  }
}

async function deleteAdsStudioProject(projectId) {
  if (!confirm('Hapus project ads ini?')) return;
  try {
    await fetch(API_URL + '/api/ads-studio/projects/' + projectId, { method: 'DELETE', credentials: 'include' });
    state.adsStudio.view = 'list';
    state.adsStudio.currentProject = null;
    state.adsStudio.currentScenes = [];
    state.adsStudio._loaded = false;
    loadAdsStudioProjects();
  } catch (err) {
    alert('Gagal menghapus: ' + err.message);
  }
}

function _adsCreateClickHandler() {
  createAdsStudioProject();
}
window._adsCreateClick = _adsCreateClickHandler;

function attachAdsStudioProjectCardListeners() {
  document.querySelectorAll('[data-ads-project]').forEach(function(card) {
    card.onclick = function() {
      loadAdsStudioProjectDetail(card.dataset.adsProject);
    };
  });
}

function attachAdsStudioListeners() {
  var createBtn = document.getElementById('adsCreateBtn');
  if (createBtn) {
    createBtn.onclick = function(e) {
      e.preventDefault();
      _adsCreateClickHandler();
    };
  }

  var charBtn = document.getElementById('adsCharBtn');
  if (charBtn) charBtn.addEventListener('click', function() { document.getElementById('adsCharImage').click(); });
  var charInput = document.getElementById('adsCharImage');
  if (charInput) charInput.addEventListener('change', function(e) {
    if (e.target.files && e.target.files[0]) {
      state.adsStudio.newProject.characterImage = e.target.files[0];
      var reader = new FileReader();
      reader.onload = function(ev) { state.adsStudio.newProject.characterImagePreview = ev.target.result; render(); };
      reader.readAsDataURL(e.target.files[0]);
    }
  });
  var charRemove = document.getElementById('adsCharRemove');
  if (charRemove) charRemove.addEventListener('click', function() {
    state.adsStudio.newProject.characterImage = null;
    state.adsStudio.newProject.characterImagePreview = null;
    render();
  });

  var prodBtn = document.getElementById('adsProdBtn');
  if (prodBtn) prodBtn.addEventListener('click', function() { document.getElementById('adsProdImage').click(); });
  var prodInput = document.getElementById('adsProdImage');
  if (prodInput) prodInput.addEventListener('change', function(e) {
    if (e.target.files && e.target.files[0]) {
      state.adsStudio.newProject.productImage = e.target.files[0];
      var reader = new FileReader();
      reader.onload = function(ev) { state.adsStudio.newProject.productImagePreview = ev.target.result; render(); };
      reader.readAsDataURL(e.target.files[0]);
    }
  });
  var prodRemove = document.getElementById('adsProdRemove');
  if (prodRemove) prodRemove.addEventListener('click', function() {
    state.adsStudio.newProject.productImage = null;
    state.adsStudio.newProject.productImagePreview = null;
    render();
  });

  var adsAdType = document.getElementById('adsAdType');
  if (adsAdType) adsAdType.addEventListener('change', function() { state.adsStudio.newProject.adType = adsAdType.value; });
  var adsFormat = document.getElementById('adsFormat');
  if (adsFormat) adsFormat.addEventListener('change', function() { state.adsStudio.newProject.format = adsFormat.value; });
  var adsVideoModel = document.getElementById('adsVideoModel');
  if (adsVideoModel) adsVideoModel.addEventListener('change', function() { state.adsStudio.newProject.videoModel = adsVideoModel.value; });
  var adsDuration = document.getElementById('adsDuration');
  if (adsDuration) adsDuration.addEventListener('change', function() { state.adsStudio.newProject.videoDuration = parseInt(adsDuration.value); });
  var adsSceneCount = document.getElementById('adsSceneCount');
  if (adsSceneCount) adsSceneCount.addEventListener('change', function() { state.adsStudio.newProject.sceneCount = parseInt(adsSceneCount.value); });
  var adsLanguage = document.getElementById('adsLanguage');
  if (adsLanguage) adsLanguage.addEventListener('change', function() { state.adsStudio.newProject.language = adsLanguage.value; });
  var adsVoiceOver = document.getElementById('adsVoiceOver');
  if (adsVoiceOver) adsVoiceOver.addEventListener('change', function() { state.adsStudio.newProject.voiceOverEnabled = adsVoiceOver.checked; });
  var adsProductNameInput = document.getElementById('adsProductName');
  if (adsProductNameInput) adsProductNameInput.addEventListener('input', function() { state.adsStudio.newProject.productName = adsProductNameInput.value; });
  var adsProductDescInput = document.getElementById('adsProductDesc');
  if (adsProductDescInput) adsProductDescInput.addEventListener('input', function() { state.adsStudio.newProject.productDescription = adsProductDescInput.value; });

  var backBtn = document.getElementById('adsBackBtn');
  if (backBtn) backBtn.addEventListener('click', function() {
    state.adsStudio.view = 'list';
    state.adsStudio.currentProject = null;
    state.adsStudio.currentScenes = [];
    render();
  });

  var genScriptBtn = document.getElementById('adsGenScriptBtn');
  if (genScriptBtn) genScriptBtn.addEventListener('click', function() {
    generateAdsStudioScript(genScriptBtn.dataset.projectId);
  });

  var startBtn = document.getElementById('adsStartProductionBtn');
  if (startBtn) startBtn.addEventListener('click', function() {
    startAdsStudioProduction(startBtn.dataset.projectId);
  });

  var deleteBtn = document.getElementById('adsDeleteBtn');
  if (deleteBtn) deleteBtn.addEventListener('click', function() {
    deleteAdsStudioProject(deleteBtn.dataset.projectId);
  });

  document.querySelectorAll('[data-ads-project]').forEach(function(card) {
    card.addEventListener('click', function() {
      loadAdsStudioProjectDetail(card.dataset.adsProject);
    });
  });

  document.querySelectorAll('.ads-merge-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      mergeAdsStudioProject(btn.dataset.projectId);
    });
  });

  document.querySelectorAll('.ads-retry-scene-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var mode = btn.dataset.mode;
      var retryMode = mode === 'full' ? 'full' : (mode === 'video' ? 'video_only' : undefined);
      retryAdsStudioScene(btn.dataset.projectId, parseInt(btn.dataset.scene), retryMode);
    });
  });
}

// ============ AUTOMATION PAGE ============

async function loadAutomationProjects() {
  if (state.automation.isLoading) return;
  state.automation.isLoading = true;
  render();
  try {
    var response = await fetch(API_URL + '/api/automation/projects', { credentials: 'include' });
    var data = await response.json();
    state.automation.projects = data.projects || [];
    state.automation._loaded = true;
  } catch (err) {
    console.error('Load automation projects error:', err);
    showToast('Gagal memuat projects', 'error');
  }
  state.automation.isLoading = false;
  render();
}

async function loadAutomationProjectDetail(projectId) {
  try {
    var response = await fetch(API_URL + '/api/automation/projects/' + projectId, { credentials: 'include' });
    var data = await response.json();
    if (data.project) {
      state.automation.currentProject = data.project;
      state.automation.currentScenes = data.scenes || [];
      state.automation.view = 'detail';
    }
  } catch (err) {
    console.error('Load project detail error:', err);
    showToast('Gagal memuat detail project', 'error');
  }
  render();
  checkYouTubeStatus().then(function() { render(); });
}

async function checkYouTubeStatus() {
  try {
    var resp = await fetch(API_URL + '/api/youtube/status', { credentials: 'include' });
    var data = await resp.json();
    state.automation.youtube.configured = data.configured;
    state.automation.youtube.connected = data.connected;
    state.automation.youtube.channelName = data.channelName;
  } catch (e) {}
}

async function connectYouTube() {
  try {
    var resp = await fetch(API_URL + '/api/youtube/auth', { credentials: 'include' });
    var data = await resp.json();
    if (data.authUrl) {
      var popup = window.open(data.authUrl, 'youtube_auth', 'width=500,height=600');
      if (!popup || popup.closed) {
        showToast('Popup diblokir browser. Izinkan popup untuk connect YouTube.', 'error');
        return;
      }
      var checker = setInterval(function() {
        if (popup.closed) {
          clearInterval(checker);
          checkYouTubeStatus().then(function() { render(); });
        }
      }, 1000);
      setTimeout(function() { clearInterval(checker); }, 300000);
    } else if (data.error) {
      showToast(data.error, 'error');
    }
  } catch (e) {
    showToast('Gagal connect YouTube', 'error');
  }
}

async function disconnectYouTube() {
  try {
    await fetch(API_URL + '/api/youtube/disconnect', { method: 'DELETE', credentials: 'include' });
    state.automation.youtube.connected = false;
    state.automation.youtube.channelName = null;
    showToast('YouTube disconnected', 'success');
    render();
  } catch (e) {}
}

async function uploadToYouTube(projectId) {
  var titleInput = document.getElementById('ytTitle');
  var descInput = document.getElementById('ytDesc');
  var tagsInput = document.getElementById('ytTags');
  var privacySelect = document.getElementById('ytPrivacy');

  state.automation.youtube.isUploading = true;
  state.automation.youtube.uploadProgress = { uploaded: 0, total: 0, status: 'starting' };
  render();

  try {
    var resp = await fetch(API_URL + '/api/automation/projects/' + projectId + '/upload-youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        title: titleInput ? titleInput.value : '',
        description: descInput ? descInput.value : '',
        tags: tagsInput ? tagsInput.value : '',
        privacy: privacySelect ? privacySelect.value : 'private'
      })
    });
    var data = await resp.json();
    if (!data.success) {
      showToast(data.error || 'Upload gagal', 'error');
      state.automation.youtube.isUploading = false;
      render();
    }
  } catch (e) {
    showToast('Gagal upload ke YouTube', 'error');
    state.automation.youtube.isUploading = false;
    render();
  }
}

async function createAutomationProject() {
  var np = state.automation.newProject;
  if (!np.niche.trim()) { showToast('Niche/topik wajib diisi', 'error'); return; }
  state.automation.isCreating = true;
  render();
  try {
    var response = await fetch(API_URL + '/api/automation/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ niche: np.niche, format: np.format, videoModel: np.videoModel, videoDuration: np.videoDuration, sceneCount: np.sceneCount, language: np.language, referenceImage: np.referenceImage })
    });
    var data = await response.json();
    if (data.projectId) {
      state.automation.newProject = { niche: '', format: 'shorts', videoModel: 'kling-v2.6-pro', videoDuration: 5, sceneCount: 3, language: 'id', referenceImage: null, referenceImagePreview: null };
      showToast('Project dibuat!', 'success');
      await loadAutomationProjects();
      loadAutomationProjectDetail(data.projectId);
    } else {
      showToast(data.error || 'Gagal membuat project', 'error');
    }
  } catch (err) {
    showToast('Gagal membuat project: ' + err.message, 'error');
  }
  state.automation.isCreating = false;
  render();
}

async function generateAutomationScript(projectId) {
  state.automation.isGeneratingScript = true;
  render();
  try {
    var response = await fetch(API_URL + '/api/automation/projects/' + projectId + '/generate-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    var data = await response.json();
    if (data.success) {
      showToast('Script berhasil di-generate! ' + data.sceneCount + ' scenes', 'success');
      await loadAutomationProjectDetail(projectId);
    } else {
      showToast(data.error || 'Gagal generate script', 'error');
    }
  } catch (err) {
    showToast('Gagal generate script: ' + err.message, 'error');
  }
  state.automation.isGeneratingScript = false;
  render();
}

async function startAutomationProduction(projectId) {
  state.automation.isProducing = true;
  render();
  try {
    var response = await fetch(API_URL + '/api/automation/projects/' + projectId + '/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    var data = await response.json();
    if (data.success) {
      showToast('Produksi dimulai! ' + data.sceneCount + ' scenes', 'success');
      await loadAutomationProjectDetail(projectId);
    } else {
      showToast(data.error || 'Gagal memulai produksi', 'error');
    }
  } catch (err) {
    showToast('Gagal memulai produksi: ' + err.message, 'error');
  }
  state.automation.isProducing = false;
  render();
}

async function retryAutomationScene(projectId, sceneIndex, retryMode) {
  try {
    var response = await fetch(API_URL + '/api/automation/projects/' + projectId + '/retry-scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sceneIndex: sceneIndex, retryMode: retryMode || 'video' })
    });
    var data = await response.json();
    if (data.success) {
      showToast('Retrying scene ' + (sceneIndex + 1) + '...', 'info');
    } else {
      showToast(data.error || 'Gagal retry scene', 'error');
    }
  } catch (err) {
    showToast('Gagal retry: ' + err.message, 'error');
  }
}

async function mergeAutomationVideos(projectId) {
  try {
    var response = await fetch(API_URL + '/api/automation/projects/' + projectId + '/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    var data = await response.json();
    if (data.success) {
      showToast('Menggabungkan video...', 'info');
    } else {
      showToast(data.error || 'Gagal merge', 'error');
    }
  } catch (err) {
    showToast('Gagal merge: ' + err.message, 'error');
  }
}

async function deleteAutomationProject(projectId) {
  if (!confirm('Hapus project ini?')) return;
  try {
    var response = await fetch(API_URL + '/api/automation/projects/' + projectId, {
      method: 'DELETE',
      credentials: 'include'
    });
    var data = await response.json();
    if (data.success) {
      showToast('Project dihapus', 'success');
      state.automation.view = 'list';
      state.automation.currentProject = null;
      state.automation.currentScenes = [];
      await loadAutomationProjects();
    }
  } catch (err) {
    showToast('Gagal menghapus: ' + err.message, 'error');
  }
}

function getAutomationStatusBadge(status) {
  var map = {
    'draft': { label: 'Draft', cls: 'badge-draft' },
    'generating_script': { label: 'Generating Script...', cls: 'badge-processing' },
    'script_ready': { label: 'Script Ready', cls: 'badge-ready' },
    'script_failed': { label: 'Script Failed', cls: 'badge-failed' },
    'producing': { label: 'Producing...', cls: 'badge-processing' },
    'generating_image': { label: 'Generating Image...', cls: 'badge-processing' },
    'image_ready': { label: 'Image Ready', cls: 'badge-ready' },
    'generating_video': { label: 'Generating Video...', cls: 'badge-processing' },
    'merging': { label: 'Merging Videos...', cls: 'badge-processing' },
    'completed': { label: 'Completed', cls: 'badge-completed' },
    'production_failed': { label: 'Production Failed', cls: 'badge-failed' },
    'failed': { label: 'Failed', cls: 'badge-failed' }
  };
  var info = map[status] || { label: status, cls: 'badge-draft' };
  return '<span class="auto-badge ' + info.cls + '">' + info.label + '</span>';
}

function getAdsStudioStatusBadge(status) {
  var map = {
    'draft': { label: 'Draft', cls: 'badge-draft' },
    'generating_script': { label: 'Generating...', cls: 'badge-processing' },
    'script_ready': { label: 'Script Ready', cls: 'badge-ready' },
    'script_failed': { label: 'Script Failed', cls: 'badge-failed' },
    'producing': { label: 'Producing...', cls: 'badge-processing' },
    'merging': { label: 'Merging...', cls: 'badge-processing' },
    'completed': { label: 'Completed', cls: 'badge-completed' },
    'production_failed': { label: 'Failed', cls: 'badge-failed' }
  };
  var info = map[status] || { label: status, cls: 'badge-draft' };
  return '<span class="auto-badge ' + info.cls + '">' + info.label + '</span>';
}

function renderAdsStudioPage() {
  if (!state.adsStudio._loaded && !state.adsStudio.isLoading) {
    loadAdsStudioProjects();
  }

  if (state.adsStudio.view === 'detail' && state.adsStudio.currentProject) {
    return renderAdsStudioDetailPage();
  }

  var html = '<div class="container">';
  html += '<div class="hero">';
  html += '<div class="hero-badge gradient-badge"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="10 7 10 13 15 10 10 7"/></svg> Ads Creator</div>';
  html += '<h1 class="gradient-title">Ads Studio</h1>';
  html += '<p class="hero-subtitle">Buat iklan produk affiliate otomatis dengan AI.</p>';
  html += '</div>';

  html += '<div class="section-card">';
  html += '<div class="ads-create-form">';
  html += '<input type="text" class="form-input" id="adsProductName" placeholder="Nama produk... contoh: Serum Vitamin C, Sepatu Running Nike" value="' + escapeHtml(state.adsStudio.newProject.productName || '') + '"/>';
  html += '<textarea class="form-input" id="adsProductDesc" rows="2" placeholder="Deskripsi produk (keunggulan, target market, harga...)">' + escapeHtml(state.adsStudio.newProject.productDescription || '') + '</textarea>';

  html += '<div class="ads-image-row">';
  html += '<div class="ads-image-upload">';
  html += '<input type="file" id="adsCharImage" accept="image/*" style="display:none"/>';
  if (state.adsStudio.newProject.characterImagePreview) {
    html += '<div class="ads-ref-preview" id="adsCharPreviewWrap">';
    html += '<img src="' + state.adsStudio.newProject.characterImagePreview + '" class="ads-ref-thumb"/>';
    html += '<button class="ads-ref-remove" id="adsCharRemove">&times;</button>';
    html += '</div>';
  } else {
    html += '<button class="btn-secondary ads-ref-btn" id="adsCharBtn">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    html += ' Karakter';
    html += '</button>';
  }
  html += '</div>';

  html += '<div class="ads-image-upload">';
  html += '<input type="file" id="adsProdImage" accept="image/*" style="display:none"/>';
  if (state.adsStudio.newProject.productImagePreview) {
    html += '<div class="ads-ref-preview" id="adsProdPreviewWrap">';
    html += '<img src="' + state.adsStudio.newProject.productImagePreview + '" class="ads-ref-thumb"/>';
    html += '<button class="ads-ref-remove" id="adsProdRemove">&times;</button>';
    html += '</div>';
  } else {
    html += '<button class="btn-secondary ads-ref-btn" id="adsProdBtn">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    html += ' Produk';
    html += '</button>';
  }
  html += '</div>';
  html += '</div>';

  html += '<div class="ads-settings-row">';
  html += '<select class="form-input ads-select" id="adsAdType">';
  html += '<option value="soft_selling"' + (state.adsStudio.newProject.adType === 'soft_selling' ? ' selected' : '') + '>Soft Selling</option>';
  html += '<option value="hard_selling"' + (state.adsStudio.newProject.adType === 'hard_selling' ? ' selected' : '') + '>Hard Selling</option>';
  html += '</select>';
  html += '<select class="form-input ads-select" id="adsFormat">';
  html += '<option value="shorts"' + (state.adsStudio.newProject.format === 'shorts' ? ' selected' : '') + '>Shorts</option>';
  html += '<option value="landscape"' + (state.adsStudio.newProject.format === 'landscape' ? ' selected' : '') + '>Landscape</option>';
  html += '</select>';
  html += '<select class="form-input ads-select" id="adsVideoModel">';
  html += '<option value="wan-v2.7-pro"' + (state.adsStudio.newProject.videoModel === 'wan-v2.7-pro' || !state.adsStudio.newProject.videoModel ? ' selected' : '') + '>Wan 2.7 Pro</option>';
  html += '<option value="wan-v2.6-pro"' + (state.adsStudio.newProject.videoModel === 'wan-v2.6-pro' ? ' selected' : '') + '>Wan 2.6 Pro</option>';
  html += '</select>';
  html += '<select class="form-input ads-select" id="adsDuration">';
  html += '<option value="5"' + (state.adsStudio.newProject.videoDuration === 5 ? ' selected' : '') + '>5 detik</option>';
  html += '<option value="10"' + (state.adsStudio.newProject.videoDuration === 10 ? ' selected' : '') + '>10 detik</option>';
  html += '</select>';
  html += '<select class="form-input ads-select" id="adsSceneCount">';
  var scnOpts = [3, 4, 5, 6];
  for (var si = 0; si < scnOpts.length; si++) {
    html += '<option value="' + scnOpts[si] + '"' + (state.adsStudio.newProject.sceneCount === scnOpts[si] ? ' selected' : '') + '>' + scnOpts[si] + ' scene</option>';
  }
  html += '</select>';
  html += '<select class="form-input ads-select" id="adsLanguage">';
  html += '<option value="id"' + (state.adsStudio.newProject.language === 'id' ? ' selected' : '') + '>ID</option>';
  html += '<option value="en"' + (state.adsStudio.newProject.language === 'en' ? ' selected' : '') + '>EN</option>';
  html += '</select>';
  html += '</div>';

  html += '<div class="ads-settings-row">';
  html += '<label class="ads-vo-toggle"><input type="checkbox" id="adsVoiceOver"' + (state.adsStudio.newProject.voiceOverEnabled ? ' checked' : '') + '/> Voice Over</label>';
  html += '<button class="btn-primary ads-go-btn" id="adsCreateBtn" type="button" onclick="window._adsCreateClick && window._adsCreateClick()"' + (state.adsStudio.isCreating ? ' disabled' : '') + '>';
  html += state.adsStudio.isCreating ? '<span class="spinner"></span>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  html += '</button>';
  html += '</div>';
  html += '<div id="adsErrorMsg" style="display:none;color:#ff6b6b;background:rgba(255,50,50,0.15);padding:10px 14px;border-radius:10px;margin-top:10px;font-size:14px;text-align:center;"></div>';
  html += '</div></div>';

  html += '<div class="auto-project-list">';
  if (state.adsStudio.isLoading) {
    html += '<div class="loading-state"><span class="spinner"></span> Memuat...</div>';
  } else if (state.adsStudio.projects.length > 0) {
    state.adsStudio.projects.forEach(function(p) {
      html += '<div class="auto-project-card" data-ads-project="' + p.project_id + '">';
      html += '<div class="auto-project-left">';
      html += '<div class="auto-project-title">' + escapeHtml(p.title || p.product_name) + '</div>';
      html += '<div class="auto-project-sub">' + escapeHtml(p.ad_type === 'hard_selling' ? 'Hard Sell' : 'Soft Sell') + ' &middot; ' + (p.format === 'shorts' ? 'Shorts' : 'Landscape') + ' &middot; ' + p.scene_count + ' scene &middot; ' + new Date(p.created_at).toLocaleDateString() + '</div>';
      html += '</div>';
      html += getAdsStudioStatusBadge(p.status);
      html += '</div>';
    });
  }
  html += '</div>';
  html += '</div>';
  return html;
}

function renderAdsStudioDetailPage() {
  var project = state.adsStudio.currentProject;
  var scenes = state.adsStudio.currentScenes;

  var html = '<div class="container">';
  html += '<div class="auto-detail-top">';
  html += '<button class="auto-back-link" id="adsBackBtn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>';
  html += '<div class="auto-detail-top-info">';
  html += '<h2 class="auto-detail-name">' + escapeHtml(project.title || project.product_name) + '</h2>';
  var detailSub = (project.ad_type === 'hard_selling' ? 'Hard Sell' : 'Soft Sell') + ' &middot; ' + (project.format === 'shorts' ? 'Shorts' : 'Landscape') + ' &middot; ' + escapeHtml(project.video_model) + ' &middot; ' + (project.language === 'id' ? 'ID' : 'EN');
  if (project.voice_over_enabled) detailSub += ' &middot; <span style="color:var(--accent)">&#127908; Voice Over</span>';
  if (project.character_image_url) detailSub += ' &middot; <span style="color:var(--accent)">&#128100; Karakter</span>';
  if (project.product_image_url) detailSub += ' &middot; <span style="color:var(--accent)">&#128230; Produk</span>';
  html += '<span class="auto-detail-sub">' + detailSub + '</span>';
  html += '</div>';
  html += '<div class="auto-detail-top-actions">';
  html += getAdsStudioStatusBadge(project.status);
  html += '<button class="btn-danger-sm" id="adsDeleteBtn" data-project-id="' + project.project_id + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
  html += '</div></div>';

  if (project.status === 'draft' || project.status === 'script_failed') {
    html += '<div class="section-card auto-action-simple">';
    if (project.status === 'script_failed' && project.error_message) {
      html += '<div class="error-box">' + escapeHtml(project.error_message) + '</div>';
    }
    html += '<p>AI akan generate script iklan ' + project.scene_count + ' scene untuk produk ini.</p>';
    html += '<button class="btn-primary" id="adsGenScriptBtn" data-project-id="' + project.project_id + '"' + (state.adsStudio.isGeneratingScript ? ' disabled' : '') + '>';
    html += state.adsStudio.isGeneratingScript ? '<span class="spinner"></span> Generating...' : 'Generate Script';
    html += '</button>';
    html += '</div>';
  }

  if (project.status === 'generating_script') {
    html += '<div class="section-card auto-action-simple">';
    html += '<div class="processing-indicator"><span class="spinner"></span> AI sedang menulis script iklan...</div>';
    html += '</div>';
  }

  if (scenes.length > 0) {
    var completedCount = scenes.filter(function(s) { return s.status === 'completed'; }).length;
    var failedCount = scenes.filter(function(s) { return s.status === 'failed'; }).length;
    var processingCount = scenes.filter(function(s) { return s.status === 'generating_video' || s.status === 'generating_image'; }).length;

    if (project.status === 'producing' || project.status === 'completed' || project.status === 'production_failed') {
      html += '<div class="auto-progress-wrap">';
      html += '<div class="auto-progress-bar"><div class="auto-progress-fill" style="width: ' + (scenes.length > 0 ? (completedCount / scenes.length * 100) : 0) + '%"></div></div>';
      html += '<span class="auto-progress-label">' + completedCount + '/' + scenes.length;
      if (failedCount > 0) html += ' &middot; ' + failedCount + ' gagal';
      if (processingCount > 0) html += ' &middot; ' + processingCount + ' proses';
      html += '</span></div>';
    }

    if (project.status === 'script_ready') {
      html += '<div class="auto-start-bar">';
      html += '<span>Script siap. Review lalu mulai produksi.</span>';
      html += '<button class="btn-primary" id="adsStartProductionBtn" data-project-id="' + project.project_id + '"' + (state.adsStudio.isProducing ? ' disabled' : '') + '>';
      html += state.adsStudio.isProducing ? '<span class="spinner"></span>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start';
      html += '</button></div>';
    }

    if (project.status === 'production_failed') {
      html += '<div class="auto-start-bar">';
      html += '<span>Ada scene gagal. Retry produksi.</span>';
      html += '<button class="btn-primary" id="adsStartProductionBtn" data-project-id="' + project.project_id + '">Restart</button>';
      html += '</div>';
    }

    html += '<div class="auto-scenes-list">';
    scenes.forEach(function(scene) {
      html += '<div class="auto-scene-item scene-status-' + scene.status + '">';
      html += '<div class="auto-scene-top">';
      html += '<span class="auto-scene-num">Scene ' + (scene.scene_index + 1) + '</span>';
      html += getAdsStudioStatusBadge(scene.status);
      html += '</div>';

      if (scene.image_url && !scene.video_url) {
        html += '<div class="auto-scene-image"><img src="' + escapeHtml(scene.image_url) + '" alt="Scene ' + (scene.scene_index + 1) + '"/></div>';
      }
      if (scene.video_url) {
        html += '<div class="auto-scene-video"><video src="' + scene.video_url + '" controls preload="metadata"></video></div>';
      }

      if (scene.narration) {
        if (project.status === 'script_ready') {
          html += '<textarea class="form-input auto-scene-ta ads-scene-narration" data-project="' + project.project_id + '" data-scene="' + scene.scene_index + '" rows="2" placeholder="Narration">' + escapeHtml(scene.narration) + '</textarea>';
        } else {
          html += '<p class="auto-scene-text"><strong>Narasi:</strong> ' + escapeHtml(scene.narration) + '</p>';
        }
      }
      if (scene.visual_prompt) {
        if (project.status === 'script_ready') {
          html += '<textarea class="form-input auto-scene-ta ads-scene-visual" data-project="' + project.project_id + '" data-scene="' + scene.scene_index + '" rows="2" placeholder="Visual prompt">' + escapeHtml(scene.visual_prompt) + '</textarea>';
        } else {
          html += '<p class="auto-scene-text auto-scene-vp"><strong>Visual:</strong> ' + escapeHtml(scene.visual_prompt) + '</p>';
        }
      }
      if (scene.status === 'failed' && scene.error_message) {
        html += '<div class="error-box">' + escapeHtml(scene.error_message) + '</div>';
      }
      if ((scene.status === 'failed' || scene.status === 'completed' || scene.status === 'generating_video' || scene.status === 'generating_image') && scene.image_url) {
        html += '<div class="auto-scene-retry-bar">';
        html += '<button class="btn-secondary ads-retry-scene-btn" data-project-id="' + project.project_id + '" data-scene="' + scene.scene_index + '" data-mode="video">Retry Video</button>';
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  var hasCompletedVideos = scenes.filter(function(s) { return s.status === 'completed' && s.video_url; }).length;
  if (hasCompletedVideos >= 2 && (project.status === 'completed' || project.status === 'production_failed' || project.status === 'producing')) {
    html += '<div class="section-card" style="text-align:center;padding:16px;">';
    html += '<button class="btn-primary ads-merge-btn" data-project-id="' + project.project_id + '">Gabungkan Semua Video (' + hasCompletedVideos + ' scene)</button>';
    html += '</div>';
  }
  if (project.final_video_url) {
    html += '<div class="section-card">';
    html += '<h3 style="margin-bottom:8px;">Video Iklan Final</h3>';
    html += '<video src="' + escapeHtml(project.final_video_url) + '" controls style="width:100%;max-height:400px;border-radius:8px;"></video>';
    html += '<div style="margin-top:8px;display:flex;gap:8px;justify-content:center;">';
    html += '<a href="' + escapeHtml(project.final_video_url) + '" download class="btn-secondary" style="text-decoration:none;">Download</a>';
    html += '<button class="btn-secondary ads-merge-btn" data-project-id="' + project.project_id + '">Re-merge</button>';
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function renderAutomationPage() {
  if (!state.automation._loaded && !state.automation.isLoading) {
    loadAutomationProjects();
  }

  if (state.automation.view === 'detail' && state.automation.currentProject) {
    return renderAutomationDetailPage();
  }

  var html = '<div class="container">';
  html += '<div class="hero">';
  html += '<div class="hero-badge gradient-badge"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Auto Create</div>';
  html += '<h1 class="gradient-title">Automation</h1>';
  html += '<p class="hero-subtitle">Ketik topik, AI buatkan video otomatis.</p>';
  html += '</div>';

  html += '<div class="section-card">';
  html += '<div class="auto-create-form">';
  html += '<input type="text" class="form-input auto-niche-input" id="autoNiche" placeholder="Ketik topik video... contoh: tips memasak, fakta unik, motivasi" value="' + escapeHtml(state.automation.newProject.niche || '') + '"/>';
  html += '<div class="auto-ref-image-row">';
  html += '<input type="file" id="autoRefImage" accept="image/*" style="display:none"/>';
  if (state.automation.newProject.referenceImagePreview) {
    html += '<div class="auto-ref-preview" id="autoRefPreviewWrap">';
    html += '<img src="' + state.automation.newProject.referenceImagePreview + '" class="auto-ref-thumb"/>';
    html += '<button class="auto-ref-remove" id="autoRefRemove" title="Hapus">&times;</button>';
    html += '</div>';
  } else {
    html += '<button class="btn-secondary auto-ref-btn" id="autoRefBtn">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    html += ' Gambar Referensi';
    html += '</button>';
  }
  html += '</div>';
  html += '<div class="auto-settings-row">';
  html += '<select class="form-input auto-select" id="autoFormat">';
  html += '<option value="shorts"' + (state.automation.newProject.format === 'shorts' ? ' selected' : '') + '>Shorts</option>';
  html += '<option value="landscape"' + (state.automation.newProject.format === 'landscape' ? ' selected' : '') + '>Landscape</option>';
  html += '</select>';
  html += '<select class="form-input auto-select" id="autoVideoModel">';
  html += '<option value="kling-v2.6-pro"' + (state.automation.newProject.videoModel === 'kling-v2.6-pro' ? ' selected' : '') + '>Kling 2.6 Pro</option>';
  html += '<option value="kling-v3"' + (state.automation.newProject.videoModel === 'kling-v3' ? ' selected' : '') + '>Kling V3</option>';
  html += '<option value="wan-v2.7-r2v"' + (state.automation.newProject.videoModel === 'wan-v2.7-r2v' ? ' selected' : '') + '>Wan 2.7 R2V</option>';
  html += '</select>';
  html += '<select class="form-input auto-select" id="autoDuration">';
  html += '<option value="5"' + (state.automation.newProject.videoDuration === 5 ? ' selected' : '') + '>5 detik</option>';
  html += '<option value="10"' + (state.automation.newProject.videoDuration === 10 ? ' selected' : '') + '>10 detik</option>';
  html += '</select>';
  html += '<select class="form-input auto-select" id="autoSceneCount">';
  var sceneOptions = [2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 30, 40, 50, 60, 80, 100, 120, 150, 180];
  for (var si = 0; si < sceneOptions.length; si++) {
    var sc = sceneOptions[si];
    html += '<option value="' + sc + '"' + (state.automation.newProject.sceneCount === sc ? ' selected' : '') + '>' + sc + ' scene</option>';
  }
  html += '</select>';
  html += '<select class="form-input auto-select" id="autoLanguage">';
  html += '<option value="id"' + (state.automation.newProject.language === 'id' ? ' selected' : '') + '>ID</option>';
  html += '<option value="en"' + (state.automation.newProject.language === 'en' ? ' selected' : '') + '>EN</option>';
  html += '</select>';
  html += '<button class="btn-primary auto-go-btn" id="autoCreateBtn"' + (state.automation.isCreating ? ' disabled' : '') + '>';
  html += state.automation.isCreating ? '<span class="spinner"></span>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
  html += '</button>';
  html += '</div>';
  html += '</div></div>';

  if (state.automation.isLoading) {
    html += '<div class="loading-state"><span class="spinner"></span> Memuat...</div>';
  } else if (state.automation.projects.length > 0) {
    html += '<div class="auto-project-list">';
    state.automation.projects.forEach(function(p) {
      html += '<div class="auto-project-card" data-auto-project="' + p.project_id + '">';
      html += '<div class="auto-project-left">';
      html += '<div class="auto-project-title">' + escapeHtml(p.title || p.niche) + '</div>';
      html += '<div class="auto-project-sub">' + (p.format === 'shorts' ? 'Shorts' : 'Landscape') + ' &middot; ' + p.scene_count + ' scene &middot; ' + new Date(p.created_at).toLocaleDateString() + '</div>';
      html += '</div>';
      html += getAutomationStatusBadge(p.status);
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderAutomationDetailPage() {
  var project = state.automation.currentProject;
  var scenes = state.automation.currentScenes;

  var html = '<div class="container">';
  html += '<div class="auto-detail-top">';
  html += '<button class="auto-back-link" id="autoBackBtn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>';
  html += '<div class="auto-detail-top-info">';
  html += '<h2 class="auto-detail-name">' + escapeHtml(project.title || project.niche) + '</h2>';
  var detailSub = (project.format === 'shorts' ? 'Shorts' : 'Landscape') + ' &middot; ' + escapeHtml(project.video_model) + ' &middot; ' + (project.language === 'id' ? 'ID' : 'EN');
  if (project.reference_image_url) detailSub += ' &middot; <span style="color:var(--accent)">&#128247; Ref Image</span>';
  html += '<span class="auto-detail-sub">' + detailSub + '</span>';
  html += '</div>';
  html += '<div class="auto-detail-top-actions">';
  html += getAutomationStatusBadge(project.status);
  html += '<button class="btn-danger-sm" id="autoDeleteBtn" data-project-id="' + project.project_id + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
  html += '</div></div>';

  if (project.status === 'draft' || project.status === 'script_failed') {
    html += '<div class="section-card auto-action-simple">';
    if (project.status === 'script_failed' && project.error_message) {
      html += '<div class="error-box">' + escapeHtml(project.error_message) + '</div>';
    }
    html += '<p>AI akan generate script ' + project.scene_count + ' scene untuk topik ini.</p>';
    html += '<button class="btn-primary" id="autoGenScriptBtn" data-project-id="' + project.project_id + '"' + (state.automation.isGeneratingScript ? ' disabled' : '') + '>';
    html += state.automation.isGeneratingScript ? '<span class="spinner"></span> Generating...' : 'Generate Script';
    html += '</button>';
    html += '</div>';
  }

  if (project.status === 'generating_script') {
    html += '<div class="section-card auto-action-simple">';
    html += '<div class="processing-indicator"><span class="spinner"></span> AI sedang menulis script...</div>';
    html += '</div>';
  }

  if (scenes.length > 0) {
    var completedCount = scenes.filter(function(s) { return s.status === 'completed'; }).length;
    var failedCount = scenes.filter(function(s) { return s.status === 'failed'; }).length;
    var processingCount = scenes.filter(function(s) { return s.status === 'generating_video'; }).length;

    if (project.status === 'producing' || project.status === 'completed' || project.status === 'production_failed') {
      html += '<div class="auto-progress-wrap">';
      html += '<div class="auto-progress-bar"><div class="auto-progress-fill" style="width: ' + (scenes.length > 0 ? (completedCount / scenes.length * 100) : 0) + '%"></div></div>';
      html += '<span class="auto-progress-label">' + completedCount + '/' + scenes.length;
      if (failedCount > 0) html += ' &middot; ' + failedCount + ' gagal';
      if (processingCount > 0) html += ' &middot; ' + processingCount + ' proses';
      html += '</span></div>';
    }

    if (project.status === 'script_ready') {
      html += '<div class="auto-start-bar">';
      html += '<span>Script siap. Review lalu mulai produksi.</span>';
      html += '<button class="btn-primary" id="autoStartProductionBtn" data-project-id="' + project.project_id + '"' + (state.automation.isProducing ? ' disabled' : '') + '>';
      html += state.automation.isProducing ? '<span class="spinner"></span>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start';
      html += '</button></div>';
    }

    if (project.status === 'production_failed') {
      html += '<div class="auto-start-bar">';
      html += '<span>Ada scene gagal. Retry atau restart.</span>';
      html += '<button class="btn-primary" id="autoStartProductionBtn" data-project-id="' + project.project_id + '">Restart</button>';
      html += '</div>';
    }

    html += '<div class="auto-scenes-list">';
    scenes.forEach(function(scene) {
      html += '<div class="auto-scene-item scene-status-' + scene.status + '">';
      html += '<div class="auto-scene-top">';
      html += '<span class="auto-scene-num">Scene ' + (scene.scene_index + 1) + '</span>';
      html += getAutomationStatusBadge(scene.status);
      if (scene.status === 'failed') {
        html += '<button class="auto-retry-link auto-retry-btn" data-project="' + project.project_id + '" data-scene="' + scene.scene_index + '" data-mode="video">Retry</button>';
      }
      if (scene.status === 'completed') {
        html += '<button class="auto-retry-link auto-retry-btn" data-project="' + project.project_id + '" data-scene="' + scene.scene_index + '" data-mode="video" title="Retry video saja">Retry Video</button>';
        html += '<button class="auto-retry-link auto-retry-btn" data-project="' + project.project_id + '" data-scene="' + scene.scene_index + '" data-mode="full" title="Retry image + video">Retry All</button>';
      }
      html += '</div>';

      if (scene.image_url && !scene.video_url) {
        html += '<div class="auto-scene-image"><img src="' + escapeHtml(scene.image_url) + '" alt="Scene ' + (scene.scene_index + 1) + '"/></div>';
      }
      if (scene.video_url) {
        html += '<div class="auto-scene-video"><video src="' + scene.video_url + '" controls preload="metadata"></video></div>';
      }

      if (scene.narration) {
        if (project.status === 'script_ready') {
          html += '<textarea class="form-input auto-scene-ta auto-scene-narration" data-project="' + project.project_id + '" data-scene="' + scene.scene_index + '" rows="2" placeholder="Narration">' + escapeHtml(scene.narration) + '</textarea>';
        } else {
          html += '<p class="auto-scene-text"><strong>Narasi:</strong> ' + escapeHtml(scene.narration) + '</p>';
        }
      }
      var sceneDialogue = (scene.metadata && scene.metadata.dialogue) ? scene.metadata.dialogue : '';
      if (project.status === 'script_ready') {
        html += '<textarea class="form-input auto-scene-ta auto-scene-dialogue" data-project="' + project.project_id + '" data-scene="' + scene.scene_index + '" rows="2" placeholder="Dialog karakter (kosongkan jika tidak bicara)">' + escapeHtml(sceneDialogue) + '</textarea>';
      } else if (sceneDialogue) {
        html += '<p class="auto-scene-text auto-scene-dlg"><strong>&#128172; Dialog:</strong> ' + escapeHtml(sceneDialogue) + '</p>';
      }
      if (scene.visual_prompt) {
        if (project.status === 'script_ready') {
          html += '<textarea class="form-input auto-scene-ta auto-scene-visual" data-project="' + project.project_id + '" data-scene="' + scene.scene_index + '" rows="2" placeholder="Visual prompt">' + escapeHtml(scene.visual_prompt) + '</textarea>';
        } else {
          html += '<p class="auto-scene-text auto-scene-vp"><strong>Visual:</strong> ' + escapeHtml(scene.visual_prompt) + '</p>';
        }
      }
      if (scene.status === 'failed' && scene.error_message) {
        html += '<div class="error-box">' + escapeHtml(scene.error_message) + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  var allScenesCompleted = scenes.length > 0 && scenes.every(function(s) { return s.status === 'completed' && s.video_url; });
  var hasMultipleVideos = scenes.filter(function(s) { return s.video_url; }).length > 1;
  if (hasMultipleVideos && (project.status === 'completed' || project.status === 'production_failed') && !project.final_video_url) {
    html += '<div class="section-card" style="text-align:center;padding:16px;">';
    html += '<button class="btn-primary auto-merge-btn" data-project-id="' + project.project_id + '">Gabungkan Semua Video</button>';
    html += '</div>';
  }
  if (project.final_video_url) {
    html += '<div class="section-card">';
    html += '<h3 style="margin-bottom:8px;">Video Final</h3>';
    html += '<video src="' + escapeHtml(project.final_video_url) + '" controls style="width:100%;max-height:400px;border-radius:8px;"></video>';
    html += '<div style="margin-top:8px;display:flex;gap:8px;justify-content:center;">';
    html += '<a href="' + escapeHtml(project.final_video_url) + '" download class="btn-secondary" style="text-decoration:none;">Download</a>';
    html += '<button class="btn-secondary auto-merge-btn" data-project-id="' + project.project_id + '">Re-merge</button>';
    html += '</div>';
    html += '</div>';
  }

  var hasCompleted = scenes.some(function(s) { return s.status === 'completed' && s.video_url; });
  if (hasCompleted && (project.status === 'completed' || project.status === 'production_failed')) {
    var yt = state.automation.youtube;
    html += '<div class="section-card yt-upload-section">';
    html += '<div class="yt-header"><svg width="20" height="20" viewBox="0 0 24 24" fill="#f00"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg> <span>Upload ke YouTube</span></div>';

    if (!yt.configured) {
      html += '<p class="yt-note">Setup GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET dulu untuk menggunakan fitur ini.</p>';
    } else if (!yt.connected) {
      html += '<button class="btn-secondary yt-connect-btn" id="ytConnectBtn">Connect YouTube</button>';
    } else {
      html += '<div class="yt-connected-info"><span>Connected: ' + escapeHtml(yt.channelName || 'YouTube') + '</span><button class="yt-disconnect" id="ytDisconnectBtn">Disconnect</button></div>';

      if (yt.isUploading) {
        var prog = yt.uploadProgress || {};
        html += '<div class="processing-indicator"><span class="spinner"></span> ' + escapeHtml(prog.message || 'Processing...') + '</div>';
      } else if (yt.lastVideoUrl) {
        html += '<div class="yt-success-box"><span>Video berhasil diupload!</span> <a href="' + escapeHtml(yt.lastVideoUrl) + '" target="_blank" class="yt-video-link">Lihat di YouTube</a></div>';
      }
      if (!yt.isUploading) {
        html += '<div class="yt-form">';
        html += '<input type="text" class="form-input" id="ytTitle" placeholder="Judul video" value="' + escapeHtml(project.title || project.niche || '') + '"/>';
        html += '<textarea class="form-input" id="ytDesc" rows="2" placeholder="Deskripsi (opsional)">' + escapeHtml(project.niche || '') + '</textarea>';
        html += '<div class="yt-form-row">';
        html += '<input type="text" class="form-input" id="ytTags" placeholder="Tags (pisah koma)"/>';
        html += '<select class="form-input" id="ytPrivacy"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select>';
        html += '</div>';
        html += '<button class="btn-primary" id="ytUploadBtn" data-project-id="' + project.project_id + '">Upload ke YouTube</button>';
        html += '</div>';
      }
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function attachAutomationListeners() {
  var createBtn = document.getElementById('autoCreateBtn');
  if (createBtn) {
    createBtn.addEventListener('click', function() {
      var nicheInput = document.getElementById('autoNiche');
      var formatSelect = document.getElementById('autoFormat');
      var modelSelect = document.getElementById('autoVideoModel');
      var durationSelect = document.getElementById('autoDuration');
      var sceneSelect = document.getElementById('autoSceneCount');
      var langSelect = document.getElementById('autoLanguage');
      if (nicheInput) state.automation.newProject.niche = nicheInput.value;
      if (formatSelect) state.automation.newProject.format = formatSelect.value;
      if (modelSelect) state.automation.newProject.videoModel = modelSelect.value;
      if (durationSelect) state.automation.newProject.videoDuration = parseInt(durationSelect.value);
      if (sceneSelect) state.automation.newProject.sceneCount = parseInt(sceneSelect.value);
      if (langSelect) state.automation.newProject.language = langSelect.value;
      createAutomationProject();
    });
  }

  var refBtn = document.getElementById('autoRefBtn');
  var refInput = document.getElementById('autoRefImage');
  if (refBtn && refInput) {
    refBtn.addEventListener('click', function() { refInput.click(); });
  }
  if (refInput) {
    refInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { showToast('Ukuran gambar maks 10MB', 'error'); return; }
      var reader = new FileReader();
      reader.onload = function(ev) {
        state.automation.newProject.referenceImage = ev.target.result;
        state.automation.newProject.referenceImagePreview = ev.target.result;
        render();
      };
      reader.readAsDataURL(file);
    });
  }
  var refRemove = document.getElementById('autoRefRemove');
  if (refRemove) {
    refRemove.addEventListener('click', function() {
      state.automation.newProject.referenceImage = null;
      state.automation.newProject.referenceImagePreview = null;
      render();
    });
  }

  document.querySelectorAll('[data-auto-project]').forEach(function(el) {
    el.addEventListener('click', function() {
      loadAutomationProjectDetail(el.getAttribute('data-auto-project'));
    });
  });

  var backBtn = document.getElementById('autoBackBtn');
  if (backBtn) {
    backBtn.addEventListener('click', function() {
      state.automation.view = 'list';
      state.automation.currentProject = null;
      state.automation.currentScenes = [];
      loadAutomationProjects();
    });
  }

  var genScriptBtn = document.getElementById('autoGenScriptBtn');
  if (genScriptBtn) {
    genScriptBtn.addEventListener('click', function() {
      generateAutomationScript(genScriptBtn.getAttribute('data-project-id'));
    });
  }

  var startProdBtn = document.getElementById('autoStartProductionBtn');
  if (startProdBtn) {
    startProdBtn.addEventListener('click', function() {
      startAutomationProduction(startProdBtn.getAttribute('data-project-id'));
    });
  }

  document.querySelectorAll('.auto-merge-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      mergeAutomationVideos(btn.getAttribute('data-project-id'));
    });
  });

  var deleteBtn = document.getElementById('autoDeleteBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', function() {
      deleteAutomationProject(deleteBtn.getAttribute('data-project-id'));
    });
  }

  document.querySelectorAll('.auto-retry-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      retryAutomationScene(btn.getAttribute('data-project'), parseInt(btn.getAttribute('data-scene')), btn.getAttribute('data-mode') || 'video');
    });
  });

  document.querySelectorAll('.auto-scene-narration, .auto-scene-visual, .auto-scene-dialogue').forEach(function(ta) {
    ta.addEventListener('change', function() {
      var proj = ta.getAttribute('data-project');
      var idx = parseInt(ta.getAttribute('data-scene'));
      var body = { sceneIndex: idx };
      if (ta.classList.contains('auto-scene-narration')) body.narration = ta.value;
      else if (ta.classList.contains('auto-scene-dialogue')) body.dialogue = ta.value;
      else body.visualPrompt = ta.value;
      fetch(API_URL + '/api/automation/projects/' + proj + '/update-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) showToast('Scene updated', 'success');
      }).catch(function() {});
    });
  });

  var nicheInput = document.getElementById('autoNiche');
  if (nicheInput) {
    nicheInput.addEventListener('input', function() {
      state.automation.newProject.niche = nicheInput.value;
    });
  }

  var ytConnectBtn = document.getElementById('ytConnectBtn');
  if (ytConnectBtn) {
    ytConnectBtn.addEventListener('click', connectYouTube);
  }
  var ytDisconnectBtn = document.getElementById('ytDisconnectBtn');
  if (ytDisconnectBtn) {
    ytDisconnectBtn.addEventListener('click', disconnectYouTube);
  }
  var ytUploadBtn = document.getElementById('ytUploadBtn');
  if (ytUploadBtn) {
    ytUploadBtn.addEventListener('click', function() {
      uploadToYouTube(ytUploadBtn.getAttribute('data-project-id'));
    });
  }
}

function renderSceneStudioPage() {
  if (!state.auth.user) {
    return `<div class="page-container"><div class="feature-section">
      <h2 class="section-title">Scene Studio</h2>
      <p style="color:var(--text-secondary);text-align:center;">Login untuk menggunakan Scene Studio</p>
    </div></div>`;
  }
  const ss = state.sceneStudio;
  if (!ss._modelsLoaded) loadSceneStudioModels();
  if (!ss._historyLoaded) { ss._historyLoaded = true; loadSceneStudioHistory(); }
  const models = ss.models;
  const selectedModelConfig = models.find(m => m.id === ss.selectedModel);
  const completedResults = ss.batchResults.filter(r => r.status === 'completed' && r.imageUrl);

  return `
    <div class="page-container">
      <div class="feature-section" style="max-width:800px;margin:0 auto;">
        <h2 class="section-title">Scene Studio — Batch Image</h2>

        <textarea id="ssCharDesc" placeholder="Deskripsi karakter/style global (opsional, ditambahkan ke semua prompt untuk konsistensi)&#10;Contoh: Andi, laki-laki 25 tahun, rambut hitam pendek, kaos merah, celana jeans biru" rows="3" style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#fff;resize:vertical;box-sizing:border-box;margin-bottom:14px;font-size:13px;">${escapeHtml(ss.characterDesc)}</textarea>

        <div style="margin-bottom:14px;">
          <label style="color:var(--text-primary);font-weight:600;font-size:14px;display:block;margin-bottom:8px;">Gaya / Style Gambar</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap;" id="ssStyleGrid">
            ${[
              { id: '', label: 'Default', icon: '🎨' },
              { id: 'realistic', label: 'Realistis', icon: '📷' },
              { id: 'anime', label: 'Anime', icon: '🌸' },
              { id: 'manga', label: 'Manga B&W', icon: '📖' },
              { id: 'comic', label: 'Komik', icon: '💥' },
              { id: 'webtoon', label: 'Webtoon', icon: '📱' },
              { id: 'pixar', label: 'Pixar 3D', icon: '🧸' },
              { id: 'ghibli', label: 'Studio Ghibli', icon: '🏯' },
              { id: 'watercolor', label: 'Cat Air', icon: '🎨' },
              { id: 'oil-painting', label: 'Lukisan Minyak', icon: '🖼️' },
              { id: 'pencil-sketch', label: 'Sketsa Pensil', icon: '✏️' },
              { id: 'digital-art', label: 'Digital Art', icon: '🖥️' },
              { id: 'cinematic', label: 'Sinematik', icon: '🎬' },
              { id: 'fantasy', label: 'Fantasi', icon: '🐉' },
              { id: 'chibi', label: 'Chibi', icon: '🧒' },
              { id: 'pop-art', label: 'Pop Art', icon: '🟡' },
              { id: 'pixel-art', label: 'Pixel Art', icon: '👾' },
              { id: 'storybook', label: 'Buku Cerita', icon: '📚' },
            ].map(s => `
              <button class="ss-style-btn" data-style="${s.id}" style="padding:6px 12px;border-radius:8px;border:1px solid ${ss.selectedStyle === s.id ? 'rgba(139,92,246,0.7)' : 'rgba(255,255,255,0.08)'};background:${ss.selectedStyle === s.id ? 'rgba(139,92,246,0.2)' : 'rgba(0,0,0,0.2)'};color:${ss.selectedStyle === s.id ? '#c4b5fd' : 'var(--text-secondary)'};cursor:pointer;font-size:12px;transition:all 0.15s;white-space:nowrap;">${s.icon} ${s.label}</button>
            `).join('')}
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <label style="color:var(--text-primary);font-weight:600;font-size:14px;">Gambar Referensi Karakter</label>
            <span style="color:var(--text-secondary);font-size:11px;">Maks 4 gambar</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${ss.characterRefImages.map((img, i) => `
              <div style="position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:1px solid rgba(139,92,246,0.3);">
                <img src="${img}" style="width:100%;height:100%;object-fit:cover;display:block;">
                <button class="ss-remove-ref" data-idx="${i}" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.7);border:none;color:#fca5a5;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;line-height:1;">×</button>
              </div>
            `).join('')}
            ${ss.characterRefImages.length < 4 ? `
              <label id="ssRefUploadLabel" style="width:72px;height:72px;border-radius:8px;border:2px dashed rgba(139,92,246,0.3);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:rgba(139,92,246,0.05);transition:all 0.2s;">
                <span style="font-size:20px;color:rgba(139,92,246,0.5);line-height:1;">+</span>
                <span style="font-size:9px;color:var(--text-secondary);margin-top:2px;">Upload</span>
                <input type="file" id="ssRefFileInput" accept="image/*" multiple style="display:none;">
              </label>
            ` : ''}
          </div>
          <p style="color:var(--text-secondary);font-size:11px;margin-top:6px;margin-bottom:0;">Upload foto referensi karakter untuk menjaga konsistensi wajah & penampilan di semua gambar</p>
        </div>

        <div style="margin-bottom:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <label style="color:var(--text-primary);font-weight:600;font-size:14px;">Gambar Referensi Latar/Background</label>
            <span style="color:var(--text-secondary);font-size:11px;">Maks 2 gambar</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${ss.bgRefImages.map((img, i) => `
              <div style="position:relative;width:96px;height:64px;border-radius:8px;overflow:hidden;border:1px solid rgba(34,197,94,0.3);">
                <img src="${img}" style="width:100%;height:100%;object-fit:cover;display:block;">
                <button class="ss-remove-bg-ref" data-idx="${i}" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.7);border:none;color:#fca5a5;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;line-height:1;">×</button>
              </div>
            `).join('')}
            ${ss.bgRefImages.length < 2 ? `
              <label id="ssBgRefUploadLabel" style="width:96px;height:64px;border-radius:8px;border:2px dashed rgba(34,197,94,0.3);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:rgba(34,197,94,0.05);transition:all 0.2s;">
                <span style="font-size:20px;color:rgba(34,197,94,0.5);line-height:1;">+</span>
                <span style="font-size:9px;color:var(--text-secondary);margin-top:2px;">Upload</span>
                <input type="file" id="ssBgRefFileInput" accept="image/*" multiple style="display:none;">
              </label>
            ` : ''}
          </div>
          <p style="color:var(--text-secondary);font-size:11px;margin-top:6px;margin-bottom:0;">Upload contoh latar/setting yang diinginkan agar suasana & lokasi konsisten di semua gambar</p>
        </div>

        <div style="margin-bottom:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <label style="color:var(--text-primary);font-weight:600;font-size:14px;">Daftar Prompt</label>
            <button id="ssAddPrompt" style="padding:4px 12px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.3);border-radius:6px;color:#a5b4fc;cursor:pointer;font-size:12px;">+ Tambah</button>
          </div>
          ${ss.prompts.map((p, i) => `
            <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
              <span style="color:var(--text-secondary);font-size:11px;width:20px;text-align:center;flex-shrink:0;">${i + 1}</span>
              <input type="text" class="ss-prompt-input" data-idx="${i}" value="${escapeHtml(p)}" placeholder="Prompt gambar ke-${i + 1}..." style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#fff;box-sizing:border-box;font-size:13px;">
              ${ss.prompts.length > 1 ? `<button class="ss-remove-prompt" data-idx="${i}" style="padding:4px 8px;background:rgba(239,68,68,0.15);border:none;border-radius:4px;color:#fca5a5;cursor:pointer;font-size:12px;flex-shrink:0;">×</button>` : ''}
            </div>
          `).join('')}
        </div>

        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
          <select id="ssModelSelect" style="flex:1;min-width:150px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#fff;font-size:12px;box-sizing:border-box;">
            ${models.map(m => `<option value="${m.id}" ${m.id === ss.selectedModel ? 'selected' : ''}>${m.name}</option>`).join('')}
          </select>
          <select id="ssSizeSelect" style="width:80px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#fff;font-size:12px;box-sizing:border-box;">
            ${(selectedModelConfig?.sizes || ['1:1','16:9','9:16']).map(s => `<option value="${s}" ${s === ss.selectedSize ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          ${selectedModelConfig?.resolutions ? `<select id="ssResolutionSelect" style="width:70px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#fff;font-size:12px;box-sizing:border-box;">${selectedModelConfig.resolutions.map(r => `<option value="${r}" ${r === ss.selectedResolution ? 'selected' : ''}>${r}</option>`).join('')}</select>` : ''}
        </div>

        ${ss.error ? `<div style="background:rgba(239,68,68,0.1);border-radius:6px;padding:8px 12px;color:#fca5a5;font-size:12px;margin-bottom:10px;">${escapeHtml(ss.error)}</div>` : ''}

        ${ss.isGenerating ? `<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;color:var(--text-secondary);font-size:12px;margin-bottom:4px;"><span>Generating...</span><span>${ss.batchProgress.current}/${ss.batchProgress.total}</span></div><div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;"><div style="height:100%;width:${ss.batchProgress.total > 0 ? (ss.batchProgress.current / ss.batchProgress.total * 100) : 0}%;background:linear-gradient(90deg,#6366f1,#a855f7);border-radius:2px;transition:width 0.3s;"></div></div></div>` : ''}

        <button class="btn-primary" id="ssGenerateBtn" style="width:100%;padding:12px;font-size:14px;background:linear-gradient(135deg,#6366f1,#a855f7);margin-bottom:20px;" ${ss.isGenerating ? 'disabled' : ''}>
          ${ss.isGenerating ? 'Generating...' : `Generate ${ss.prompts.filter(p => p.trim()).length} Gambar`}
        </button>

        ${completedResults.length > 0 ? `
        <div style="margin-bottom:20px;">
          <h3 style="color:var(--text-primary);font-size:15px;font-weight:600;margin-bottom:10px;">Hasil Batch Terakhir</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;">
            ${completedResults.map(r => `
              <div style="border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);cursor:pointer;" onclick="window.open('${r.imageUrl}','_blank')">
                <img src="${r.imageUrl}" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;" loading="lazy">
                <div style="padding:4px 6px;color:var(--text-secondary);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">#${r.index + 1} ${escapeHtml(r.prompt || '')}</div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        ${ss.batchResults.filter(r => r.status === 'failed').length > 0 ? `
        <div style="margin-bottom:20px;">
          ${ss.batchResults.filter(r => r.status === 'failed').map(r => `
            <div style="background:rgba(239,68,68,0.08);border-radius:6px;padding:6px 10px;color:#fca5a5;font-size:11px;margin-bottom:4px;">#${r.index + 1} gagal: ${escapeHtml(r.error || 'Unknown')}</div>
          `).join('')}
        </div>
        ` : ''}

        ${ss.history.length > 0 ? `
        <details style="margin-bottom:16px;">
          <summary style="color:var(--text-primary);font-weight:600;cursor:pointer;padding:10px 0;font-size:15px;">Riwayat (${ss.history.length})</summary>
          <div style="padding-top:10px;">
            ${ss.history.map(b => {
              const bResults = safeJsonbArray(b.results).filter(r => r.status === 'completed' && r.imageUrl);
              const bDate = new Date(b.created_at).toLocaleString('id-ID', { day:'numeric',month:'short',hour:'2-digit',minute:'2-digit' });
              return `
                <div style="background:rgba(0,0,0,0.15);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div>
                      <span style="color:var(--text-primary);font-size:13px;font-weight:600;">${escapeHtml(b.model || '')}</span>
                      <span style="color:var(--text-secondary);font-size:11px;margin-left:8px;">${bDate}</span>
                      <span style="color:var(--text-secondary);font-size:11px;margin-left:8px;">${b.completed || 0}/${b.total || 0}</span>
                    </div>
                    <button class="ss-del-batch" data-id="${b.id}" style="padding:3px 8px;background:rgba(239,68,68,0.15);border:none;border-radius:4px;color:#fca5a5;cursor:pointer;font-size:11px;">×</button>
                  </div>
                  ${bResults.length > 0 ? `<div style="display:flex;gap:6px;overflow-x:auto;">${bResults.map(r => `<img src="${r.imageUrl}" style="width:64px;height:64px;border-radius:6px;object-fit:cover;cursor:pointer;flex-shrink:0;" onclick="window.open('${r.imageUrl}','_blank')" loading="lazy">`).join('')}</div>` : '<div style="color:var(--text-secondary);font-size:11px;">Tidak ada gambar</div>'}
                </div>
              `;
            }).join('')}
          </div>
        </details>
        ` : ''}
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollChatToBottom() {
  setTimeout(() => {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }, 100);
}

function closeMobileMenu() {
  const navMenu = document.getElementById('navMenu');
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  if (navMenu) navMenu.classList.remove('mobile-open');
  if (hamburgerBtn) hamburgerBtn.classList.remove('active');
}

window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    closeMobileMenu();
  }
});

function attachEventListeners() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  if (hamburgerBtn) {
    hamburgerBtn.onclick = (e) => {
      e.stopPropagation();
      const navMenu = document.getElementById('navMenu');
      if (navMenu) {
        navMenu.classList.toggle('mobile-open');
        hamburgerBtn.classList.toggle('active');
      }
    };
  }

  const mobileCloseBtn = document.getElementById('mobileCloseBtn');
  if (mobileCloseBtn) {
    mobileCloseBtn.onclick = (e) => {
      e.stopPropagation();
      closeMobileMenu();
    };
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => {
      state.currentPage = btn.dataset.page;
      if (btn.dataset.page === 'sceneStudio') {
        loadSceneStudioModels();
        loadSceneStudioHistory();
      }
      closeMobileMenu();
      render(true);
    };
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
      state.auth.modalMode = 'login';
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

  const adminTabPayments = document.getElementById('adminTabPayments');
  if (adminTabPayments) {
    adminTabPayments.addEventListener('click', () => {
      state.admin.activeTab = 'payments';
      fetchAdminPayments();
      render();
    });
  }

  const adminTabDdos = document.getElementById('adminTabDdos');
  if (adminTabDdos) {
    adminTabDdos.addEventListener('click', () => {
      state.admin.activeTab = 'ddos';
      fetchBlockedIPs();
    });
  }

  var adminTabKeypool = document.getElementById('adminTabKeypool');
  if (adminTabKeypool) {
    adminTabKeypool.addEventListener('click', function() {
      state.admin.activeTab = 'keypool';
      fetchKeyPool();
    });
  }

  var kpAddBtn = document.getElementById('kpAddKeysBtn');
  if (kpAddBtn) {
    kpAddBtn.addEventListener('click', async function() {
      var ta = document.getElementById('kpNewKeys');
      if (!ta || !ta.value.trim()) return;
      try {
        var resp = await fetch(API_URL + '/api/admin/key-pool', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ keys: ta.value })
        });
        var data = await resp.json();
        if (data.success) {
          showToast('Added ' + data.added + ' keys, skipped ' + data.skipped, 'success');
          ta.value = '';
          fetchKeyPool();
        } else { showToast(data.error, 'error'); }
      } catch (e) { showToast(e.message, 'error'); }
    });
  }

  var kpResetAllBtn = document.getElementById('kpResetAllExhausted');
  if (kpResetAllBtn) {
    kpResetAllBtn.addEventListener('click', async function() {
      try {
        var resp = await fetch(API_URL + '/api/admin/key-pool/reset-all-exhausted', { method: 'POST', credentials: 'include' });
        var data = await resp.json();
        showToast('Reset ' + data.count + ' keys', 'success');
        fetchKeyPool();
      } catch (e) { showToast(e.message, 'error'); }
    });
  }

  var kpUnassignAllBtn = document.getElementById('kpUnassignAll');
  if (kpUnassignAllBtn) {
    kpUnassignAllBtn.addEventListener('click', async function() {
      if (!confirm('Unassign semua key dari semua user?')) return;
      try {
        var resp = await fetch(API_URL + '/api/admin/key-pool/unassign-all', { method: 'POST', credentials: 'include' });
        var data = await resp.json();
        showToast('Unassigned ' + data.count + ' keys', 'success');
        fetchKeyPool();
      } catch (e) { showToast(e.message, 'error'); }
    });
  }

  document.querySelectorAll('.kp-delete-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      try {
        await fetch(API_URL + '/api/admin/key-pool/' + btn.getAttribute('data-id'), { method: 'DELETE', credentials: 'include' });
        fetchKeyPool();
      } catch (e) { showToast(e.message, 'error'); }
    });
  });

  document.querySelectorAll('.kp-reset-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      try {
        await fetch(API_URL + '/api/admin/key-pool/' + btn.getAttribute('data-id') + '/reset', { method: 'POST', credentials: 'include' });
        fetchKeyPool();
      } catch (e) { showToast(e.message, 'error'); }
    });
  });

  const refreshBlockedIPs = document.getElementById('refreshBlockedIPs');
  if (refreshBlockedIPs) {
    refreshBlockedIPs.addEventListener('click', fetchBlockedIPs);
  }

  const unblockAllBtn = document.getElementById('unblockAllIPs');
  if (unblockAllBtn) {
    unblockAllBtn.addEventListener('click', () => {
      if (confirm('Yakin ingin unblock semua IP?')) {
        unblockAllIPs();
      }
    });
  }

  document.querySelectorAll('.unblock-ip-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const ip = e.currentTarget.dataset.ip;
      if (confirm(`Unblock IP ${ip}?`)) {
        unblockIP(ip);
      }
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
  } else if (state.currentPage === 'ximage2') {
    attachXImage2EventListeners();
  } else if (state.currentPage === 'ximage3') {
    attachXImage3EventListeners();
  } else if (state.currentPage === 'motion') {
    attachMotionEventListeners();
  } else if (state.currentPage === 'voiceover') {
    attachVoiceoverEventListeners();
  } else if (state.currentPage === 'adsStudio') {
    attachAdsStudioListeners();
  } else if (state.currentPage === 'automation') {
    attachAutomationListeners();
  } else if (state.currentPage === 'sceneStudio') {
    attachSceneStudioEventListeners();
  }
}

function attachSceneStudioEventListeners() {
  const ss = state.sceneStudio;

  const charDescEl = document.getElementById('ssCharDesc');
  if (charDescEl) charDescEl.addEventListener('input', () => { ss.characterDesc = charDescEl.value; });

  document.querySelectorAll('.ss-style-btn').forEach(btn => {
    btn.addEventListener('click', () => { ss.selectedStyle = btn.dataset.style; render(); });
  });

  const refFileInput = document.getElementById('ssRefFileInput');
  if (refFileInput) {
    refFileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      const remaining = 4 - ss.characterRefImages.length;
      const toProcess = files.slice(0, remaining);
      toProcess.forEach(file => {
        if (!file.type.startsWith('image/')) return;
        if (file.size > 10 * 1024 * 1024) { showToast('Gambar terlalu besar (maks 10MB)', 'error'); return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (ss.characterRefImages.length < 4) {
            ss.characterRefImages.push(ev.target.result);
            render();
          }
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });
  }

  document.querySelectorAll('.ss-remove-ref').forEach(btn => {
    btn.addEventListener('click', () => { ss.characterRefImages.splice(parseInt(btn.dataset.idx), 1); render(); });
  });

  const bgRefFileInput = document.getElementById('ssBgRefFileInput');
  if (bgRefFileInput) {
    bgRefFileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      const remaining = 2 - ss.bgRefImages.length;
      const toProcess = files.slice(0, remaining);
      toProcess.forEach(file => {
        if (!file.type.startsWith('image/')) return;
        if (file.size > 10 * 1024 * 1024) { showToast('Gambar terlalu besar (maks 10MB)', 'error'); return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (ss.bgRefImages.length < 2) {
            ss.bgRefImages.push(ev.target.result);
            render();
          }
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });
  }

  document.querySelectorAll('.ss-remove-bg-ref').forEach(btn => {
    btn.addEventListener('click', () => { ss.bgRefImages.splice(parseInt(btn.dataset.idx), 1); render(); });
  });

  document.querySelectorAll('.ss-prompt-input').forEach(input => {
    input.addEventListener('input', () => { ss.prompts[parseInt(input.dataset.idx)] = input.value; });
  });

  const addPromptBtn = document.getElementById('ssAddPrompt');
  if (addPromptBtn) addPromptBtn.addEventListener('click', () => { ss.prompts.push(''); render(); });

  document.querySelectorAll('.ss-remove-prompt').forEach(btn => {
    btn.addEventListener('click', () => { ss.prompts.splice(parseInt(btn.dataset.idx), 1); render(); });
  });

  const modelSelect = document.getElementById('ssModelSelect');
  if (modelSelect) modelSelect.addEventListener('change', () => { ss.selectedModel = modelSelect.value; render(); });

  const sizeSelect = document.getElementById('ssSizeSelect');
  if (sizeSelect) sizeSelect.addEventListener('change', () => { ss.selectedSize = sizeSelect.value; });

  const resSelect = document.getElementById('ssResolutionSelect');
  if (resSelect) resSelect.addEventListener('change', () => { ss.selectedResolution = resSelect.value; });

  const generateBtn = document.getElementById('ssGenerateBtn');
  if (generateBtn) generateBtn.addEventListener('click', generateSceneStudioBatch);

  document.querySelectorAll('.ss-del-batch').forEach(btn => {
    btn.addEventListener('click', () => deleteSceneStudioBatch(parseInt(btn.dataset.id)));
  });
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
    uploadZone.addEventListener('click', function(e) {
      if (!e.target.closest('.remove-reference')) {
        fileInput.click();
      }
    });
    uploadZone.addEventListener('dragover', function(e) { e.preventDefault(); uploadZone.classList.add('drag-over'); });
    uploadZone.addEventListener('dragleave', function() { uploadZone.classList.remove('drag-over'); });
    uploadZone.addEventListener('drop', function(e) {
      e.preventDefault(); uploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) handleVideoGenImageUpload({ target: { files: e.dataTransfer.files } });
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


function renderVidgen2Page() {
  const isGrok = state.vidgen2.selectedModel === 'grok-video-3-10s';
  const isVeo = state.vidgen2.selectedModel === 'veo-3.1-fast' || state.vidgen2.selectedModel === 'veo-3.1';
  const models = [
    { id: 'grok-video-3-10s', name: 'Grok 3 (10s)', desc: 'Video 10 detik, 720P, Audio+Video', badge: 'AUDIO', icon: '🎵' },
    { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', desc: 'Video 8 detik, 4K, Audio', badge: '4K FAST', icon: '⚡' },
    { id: 'veo-3.1', name: 'Veo 3.1', desc: 'Video 8 detik, 4K, First/Last Frame', badge: '4K', icon: '🎬' }
  ];
  
  const durationOptions = isGrok ? [10] : [5, 8];
  const resolutionOptions = isGrok ? ['720P'] : ['4K'];
  
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
          <span class="gradient-text">Vidgen2</span> AI Video
        </h1>
        <p class="hero-subtitle">AI Video Generation</p>
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
              <h2 class="card-title">Image to Video</h2>
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
                    <span>Klik untuk upload gambar (opsional)</span>
                    <span class="upload-hint">JPG, PNG, WebP (max 50MB)</span>
                  </div>
                `}
              </div>
              <input type="file" id="vidgen2ImageInput" accept="image/*" style="display:none">
              <p class="setting-hint" style="margin-top:8px;">Upload gambar referensi untuk Image-to-Video, atau kosongkan untuk Text-to-Video</p>
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
                  ${['16:9', '9:16'].map(ratio => `
                    <button class="aspect-btn ${state.vidgen2.aspectRatio === ratio ? 'active' : ''}" data-vidgen2-ratio="${ratio}">
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
                    <button class="aspect-btn ${state.vidgen2.duration === d ? 'active' : ''}" data-vidgen2-duration="${d}">
                      <span>${d}s</span>
                    </button>
                  `).join('')}
                </div>
              </div>

              ${resolutionOptions.length > 1 ? `
              <div class="setting-group">
                <label class="setting-label">Resolution</label>
                <div class="aspect-ratio-selector">
                  ${resolutionOptions.map(r => `
                    <button class="aspect-btn ${state.vidgen2.resolution === r ? 'active' : ''}" data-vidgen2-resolution="${r}">
                      <span>${r}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
              ` : ''}

              ${isGrok ? `
              <div class="setting-group">
                <p class="setting-hint" style="color:#22c55e;">🎵 Grok 3 — Video 720P dengan audio, durasi 10 detik.</p>
              </div>
              ` : ''}

              ${isVeo ? `
              <div class="setting-group">
                <p class="setting-hint" style="color:#3b82f6;">⚡ Veo 3.1 Fast — Video 4K ultra detail, durasi 5-8 detik.</p>
              </div>
              ` : ''}

              <div class="setting-group">
                <label class="setting-label">Prompt</label>
                <textarea 
                  class="form-textarea" 
                  id="vidgen2Prompt" 
                  placeholder="Deskripsikan video yang ingin dibuat..."
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
                const hasImage = !!state.vidgen2.sourceImage;
                const needsInput = !state.vidgen2.prompt.trim() && !hasImage;
                const isDisabled = state.vidgen2.isGenerating || needsInput || state.vidgen2.tasks.length >= 3 || isOnCooldown;
                
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
              ${!state.vidgen2.prompt.trim() && !state.vidgen2.sourceImage ? '<p class="setting-hint" style="text-align:center;margin-top:12px;opacity:0.7;">Masukkan prompt atau upload gambar</p>' : ''}
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
  
  state.vidgen2.tasks.forEach(task => {
    const elapsed = task.startTime ? Math.floor((Date.now() - task.startTime) / 1000) : 0;
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

function getVidgen2ProxyUrl(originalUrl) {
  if (!originalUrl) return '';
  var key = state.vidgen2.customApiKey || '';
  return API_URL + '/api/vidgen2/proxy-video?url=' + encodeURIComponent(originalUrl) + (key ? '&key=' + encodeURIComponent(key) : '');
}

function renderVidgen2Videos() {
  if (state.vidgen2.generatedVideos.length === 0) {
    return '<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></div><p>Belum ada video yang dihasilkan</p></div>';
  }
  
  let html = '<div class="video-grid">';
  state.vidgen2.generatedVideos.forEach(video => {
    html += '<div class="video-result-card" style="position:relative;">';
    html += '<video controls playsinline preload="auto" class="result-video">';
    html += '<source src="' + video.url + '" type="video/mp4">';
    html += '</video>';
    html += '<div class="video-meta" style="display:flex;justify-content:space-between;align-items:center;">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<span class="video-model-tag">' + video.model + '</span>';
    if (video.prompt) html += '<p class="video-prompt-text" style="font-size:11px;opacity:0.7;margin:4px 0 0;">' + (video.prompt.length > 80 ? video.prompt.substring(0, 80) + '...' : video.prompt) + '</p>';
    html += '</div>';
    html += '<div style="display:flex;gap:6px;flex-shrink:0;">';
    html += '<button onclick="downloadVideo(\'' + video.url.replace(/'/g, "\\'") + '\', \'vidgen2_' + (video.id || Date.now()) + '.mp4\')" class="btn-icon downloadVidgen2Video" title="Unduh video" style="background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:6px;cursor:pointer;color:#6366f1;display:inline-flex;">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    html += '</button>';
    html += '<button class="btn-icon deleteVidgen2Video" data-task-id="' + video.id + '" title="Hapus video" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:6px;cursor:pointer;color:#ef4444;">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    html += '</button>';
    html += '</div>';
    html += '</div></div>';
  });
  html += '</div>';
  return html;
}

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
  if (state.vidgen2RoomManager.rooms.length === 0 && !state.vidgen2RoomManager.isLoading) {
    loadVidgen2Rooms().then(() => render());
  }
  
  if (!state.vidgen2._historyLoaded && state.vidgen2.customApiKey) {
    state.vidgen2._historyLoaded = true;
    loadVidgen2History().then(() => render());
  }
  
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
    uploadZone.addEventListener('click', function() { imageInput.click(); });
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
    uploadZone.addEventListener('dragleave', () => { uploadZone.classList.remove('drag-over'); });
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

  const startFrameZone = document.getElementById('vidgen2StartFrameZone');
  const startFrameInput = document.getElementById('vidgen2StartFrameInput');
  const removeStartFrame = document.getElementById('removeVidgen2StartFrame');
  if (startFrameZone && startFrameInput) {
    startFrameZone.addEventListener('click', () => startFrameInput.click());
    startFrameInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.vidgen2.startFrame = { file, data: ev.target.result, name: file.name };
        render();
      };
      reader.readAsDataURL(file);
    });
  }
  if (removeStartFrame) {
    removeStartFrame.addEventListener('click', (e) => {
      e.stopPropagation();
      state.vidgen2.startFrame = null;
      render();
    });
  }

  const endFrameZone = document.getElementById('vidgen2EndFrameZone');
  const endFrameInput = document.getElementById('vidgen2EndFrameInput');
  const removeEndFrame = document.getElementById('removeVidgen2EndFrame');
  if (endFrameZone && endFrameInput) {
    endFrameZone.addEventListener('click', () => endFrameInput.click());
    endFrameInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.vidgen2.endFrame = { file, data: ev.target.result, name: file.name };
        render();
      };
      reader.readAsDataURL(file);
    });
  }
  if (removeEndFrame) {
    removeEndFrame.addEventListener('click', (e) => {
      e.stopPropagation();
      state.vidgen2.endFrame = null;
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
      state.vidgen2._historyLoaded = false;
    });
  }

  const vidgen2StyleSelect = document.getElementById('vidgen2StyleSelect');
  if (vidgen2StyleSelect) {
    vidgen2StyleSelect.addEventListener('change', (e) => {
      state.vidgen2.style = e.target.value;
    });
  }

  document.querySelectorAll('[data-vidgen2-toggle]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const field = toggle.getAttribute('data-vidgen2-toggle');
      state.vidgen2[field] = !state.vidgen2[field];
      render();
    });
  });

  
  if (!window._vidgen2DelegationAttached) {
    window._vidgen2DelegationAttached = true;
    
    document.addEventListener('click', function(e) {
      const modelCard = e.target.closest('[data-vidgen2-model]');
      if (modelCard && state.currentPage === 'vidgen2') {
        const newModel = modelCard.dataset.vidgen2Model;
        state.vidgen2.selectedModel = newModel;
        const validDurations = newModel === 'grok-video-3-10s' ? [10] : [5, 8];
        if (!validDurations.includes(state.vidgen2.duration)) {
          state.vidgen2.duration = validDurations[validDurations.length - 1];
        }
        const validResolutions = (newModel === 'veo-3.1-fast' || newModel === 'veo-3.1') ? ['4K'] : ['720P'];
        if (!validResolutions.includes(state.vidgen2.resolution)) {
          state.vidgen2.resolution = validResolutions[0];
        }
        saveUserInputs('vidgen2');
        render();
        return;
      }
      
      const ratioBtn = e.target.closest('[data-vidgen2-ratio]');
      if (ratioBtn && state.currentPage === 'vidgen2') {
        state.vidgen2.aspectRatio = ratioBtn.dataset.vidgen2Ratio;
        saveUserInputs('vidgen2');
        render();
        return;
      }
      
      const durationBtn = e.target.closest('[data-vidgen2-duration]');
      if (durationBtn && state.currentPage === 'vidgen2') {
        state.vidgen2.duration = parseInt(durationBtn.dataset.vidgen2Duration);
        saveUserInputs('vidgen2');
        render();
        return;
      }

      const resolutionBtn = e.target.closest('[data-vidgen2-resolution]');
      if (resolutionBtn && state.currentPage === 'vidgen2') {
        state.vidgen2.resolution = resolutionBtn.dataset.vidgen2Resolution;
        saveUserInputs('vidgen2');
        render();
        return;
      }

      const genTypeBtn = e.target.closest('[data-vidgen2-gentype]');
      if (genTypeBtn && state.currentPage === 'vidgen2') {
        state.vidgen2.generationType = genTypeBtn.dataset.vidgen2Gentype;
        render();
        return;
      }

      const deleteBtn = e.target.closest('.deleteVidgen2Video');
      if (deleteBtn && state.currentPage === 'vidgen2') {
        const taskId = deleteBtn.dataset.taskId;
        if (confirm('Hapus video ini secara permanen?')) {
          deleteVidgen2Video(taskId);
        }
        return;
      }
      
    });
  }
  
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
}

async function deleteVidgen2Video(taskId) {
  try {
    const res = await fetch(`${API_URL}/api/vidgen2/history/${taskId}`, {
      method: 'DELETE',
      headers: { 'X-Xclip-Key': state.vidgen2.customApiKey }
    });
    const data = await res.json();
    if (data.success) {
      state.vidgen2.generatedVideos = state.vidgen2.generatedVideos.filter(v => v.id !== taskId);
      render();
    } else {
      alert(data.error || 'Gagal hapus video');
    }
  } catch (e) {
    alert('Gagal hapus video');
  }
}

function handleVidgen2ImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Hanya file gambar yang diperbolehkan');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast('Ukuran gambar maksimal 50MB', 'error');
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
  const hasAnyImage = state.vidgen2.sourceImage || state.vidgen2.startFrame || state.vidgen2.endFrame;
  if (!state.vidgen2.prompt.trim() && !hasAnyImage) {
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
        duration: state.vidgen2.duration,
        resolution: state.vidgen2.resolution,
        enableGif: state.vidgen2.enableGif,
        watermark: state.vidgen2.watermark,
        style: state.vidgen2.style,
        storyboard: state.vidgen2.storyboard,
        roomId: state.vidgen2.selectedRoom
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Gagal generate video');
    }
    
    state.vidgen2.tasks.push({
      taskId: data.taskId,
      model: state.vidgen2.selectedModel,
      startTime: Date.now()
    });
    
    const cooldownEnd = Date.now() + (3 * 60 * 1000);
    state.vidgen2.cooldownEndTime = cooldownEnd;
    localStorage.setItem('vidgen2_cooldown', cooldownEnd.toString());
    startVidgen2CooldownTimer();
    
    savePendingTasks();
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
  const maxAttempts = 720;
  let attempts = 0;
  
  const poll = async () => {
    if (attempts >= maxAttempts) {
      state.vidgen2.tasks = state.vidgen2.tasks.filter(t => t.taskId !== taskId);
      _activePolls.delete(taskId);
      savePendingTasks();
      state.vidgen2.error = 'Timeout - video generation terlalu lama';
      showToast('Timeout - video generation terlalu lama', 'error');
      render();
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/api/vidgen2/tasks/${taskId}`, {
        headers: { 'X-Xclip-Key': state.vidgen2.customApiKey }
      });
      
      if (!response.ok && (response.status === 404 || response.status === 401)) {
        state.vidgen2.tasks = state.vidgen2.tasks.filter(t => t.taskId !== taskId);
        _activePolls.delete(taskId);
        savePendingTasks();
        render();
        return;
      }
      
      const data = await response.json();
      
      if (data.status === 'completed' && data.videoUrl) {
        state.vidgen2.tasks = state.vidgen2.tasks.filter(t => t.taskId !== taskId);
        _activePolls.delete(taskId);
        savePendingTasks();
        state.vidgen2.generatedVideos.unshift({
          id: taskId,
          url: data.videoUrl,
          model: data.model,
          createdAt: new Date()
        });
        showToast('Video berhasil digenerate!', 'success');
        render();
        return;
      }
      
      if (data.status === 'failed') {
        state.vidgen2.tasks = state.vidgen2.tasks.filter(t => t.taskId !== taskId);
        _activePolls.delete(taskId);
        savePendingTasks();
        state.vidgen2.error = data.error || 'Video generation failed';
        showToast(data.error || 'Video generation failed', 'error');
        render();
        return;
      }
      
      const task = state.vidgen2.tasks.find(t => t.taskId === taskId);
      if (task) {
        task.progress = data.progress || Math.min(90, attempts * 2);
        const progressEl = document.querySelector(`[data-task-id="${taskId}"] .task-progress-fill`);
        const progressText = document.querySelector(`[data-task-id="${taskId}"] .task-progress-text`);
        if (progressEl) progressEl.style.width = `${task.progress}%`;
        if (progressText) progressText.textContent = `${task.progress}%`;
      }
      
      attempts++;
      console.log(`[VIDGEN2] Poll attempt ${attempts}/${maxAttempts}, status: ${data.status}`);
      setTimeout(poll, 5000);
      
    } catch (error) {
      console.error('[VIDGEN2] Poll error:', error);
      attempts++;
      if (attempts >= 3 && !state.vidgen2.tasks.find(t => t.taskId === taskId)) {
        _activePolls.delete(taskId);
        savePendingTasks();
        return;
      }
      setTimeout(poll, 5000);
    }
  };
  
  poll();
}

function renderVidgen4Page() {
  const isSora2 = state.vidgen4.selectedModel === 'sora-2-vip';
  const isVeo = state.vidgen4.selectedModel === 'veo3.1-fast';
  const isGrokV4 = state.vidgen4.selectedModel === 'grok-video';
  const models = [
    { id: 'sora-2-vip', name: 'Sora 2 VIP', desc: 'Video hingga 15 detik, 720p, kualitas premium', badge: 'VIP', icon: '🎬' },
    { id: 'veo3.1-fast', name: 'Veo 3.1 Fast', desc: 'Video 8 detik, max 1080p, start/end frame', badge: 'FAST', icon: '⚡' },
    { id: 'grok-video', name: 'Grok Video', desc: 'Video 6-10 detik, 480p/720p, image reference', badge: 'NEW', icon: '🤖' }
  ];
  
  const durationOptions = isSora2 ? [10, 15] : isGrokV4 ? [6, 10] : [8];
  const resolutionOptions = isVeo ? ['720p', '1080p'] : isGrokV4 ? ['480p', '720p'] : ['720p'];
  
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
          Vidgen4 - AI Video
        </div>
        <h1 class="hero-title">
          <span class="gradient-text">Vidgen4</span> AI Video
        </h1>
        <p class="hero-subtitle">Generate video dengan Sora 2 & Veo 3.1 Fast</p>
      </div>

      <div class="xmaker-layout">
        <div class="xmaker-settings">
          ${isSora2 || isGrokV4 ? `
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
                    <span class="upload-hint">JPG, PNG, WebP (max 50MB)</span>
                  </div>
                `}
              </div>
                <input type="file" id="vidgen4ImageInput" accept="image/*" style="display:none">
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
                <p class="setting-hint">${state.vidgen4.generationType === 'frame' ? '💡 Start/End Frame menjaga detail pakaian & penampilan lebih akurat dari gambar asli' : '⚠️ Mode Reference bisa mengubah detail pakaian. Gunakan Start/End Frame untuk konsistensi maksimal'}</p>
              </div>

              ${state.vidgen4.generationType === 'frame' ? `
              <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                <div style="flex:1;min-width:0;">
                  <label class="setting-label" style="font-size:12px;margin-bottom:6px;">Start Frame</label>
                  <div class="reference-upload ${state.vidgen4.startFrame ? 'has-image' : ''}" id="vidgen4StartFrameZone" style="min-height:100px;">
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
                <div style="flex:1;min-width:0;">
                  <label class="setting-label" style="font-size:12px;margin-bottom:6px;">End Frame</label>
                  <div class="reference-upload ${state.vidgen4.endFrame ? 'has-image' : ''}" id="vidgen4EndFrameZone" style="min-height:100px;">
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
                      <span class="upload-hint">JPG, PNG, WebP (max 50MB)</span>
                    </div>
                  `}
                </div>
                  <input type="file" id="vidgen4ImageInput" accept="image/*" style="display:none">
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
    const elapsed = task.startTime ? Math.floor((Date.now() - task.startTime) / 1000) : 0;
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

function getVidgen4ProxyUrl(originalUrl) {
  if (!originalUrl) return '';
  var key = state.vidgen4.customApiKey || '';
  return API_URL + '/api/vidgen4/proxy-video?url=' + encodeURIComponent(originalUrl) + (key ? '&key=' + encodeURIComponent(key) : '');
}

function renderVidgen4Videos() {
  if (state.vidgen4.generatedVideos.length === 0) {
    return '<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></div><p>Belum ada video yang dihasilkan</p></div>';
  }
  
  let html = '<div class="video-grid">';
  state.vidgen4.generatedVideos.forEach(video => {
    const proxyUrl = video.url ? `${API_URL}/api/vidgen4/proxy-video?url=${encodeURIComponent(video.url)}&key=${encodeURIComponent(state.vidgen4.customApiKey)}` : '';
    html += '<div class="video-result-card" style="position:relative;" data-vidgen4-id="' + (video.id || '') + '">';
    if (!video.url) {
      html += '<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:24px;text-align:center;color:#ef4444;font-size:13px;">URL video tidak tersedia</div>';
    } else {
      html += '<video controls playsinline preload="auto" class="result-video" ';
      html += 'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
      html += '<source src="' + proxyUrl + '" type="video/mp4">';
      html += '</video>';
      html += '<div style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:24px;text-align:center;flex-direction:column;gap:8px;align-items:center;">';
      html += '<span style="font-size:24px;">⚠️</span>';
      html += '<p style="color:#ef4444;font-size:13px;margin:0;">Video tidak bisa dimuat.<br>Coba download langsung atau generate ulang.</p>';
      html += '</div>';
    }
    html += '<div class="video-meta" style="display:flex;justify-content:space-between;align-items:center;">';
    html += '<div style="flex:1;min-width:0;">';
    html += '<span class="video-model-tag">' + video.model + '</span>';
    if (video.prompt) html += '<p class="video-prompt-text" style="font-size:11px;opacity:0.7;margin:4px 0 0;">' + (video.prompt.length > 80 ? video.prompt.substring(0, 80) + '...' : video.prompt) + '</p>';
    html += '</div>';
    html += '<div style="display:flex;gap:6px;flex-shrink:0;">';
    html += '<button onclick="downloadVideo(\'' + video.url.replace(/'/g, "\\'") + '\', \'vidgen4_' + (video.id || Date.now()) + '.mp4\')" class="btn-icon downloadVidgen4Video" title="Unduh video" style="background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:6px;cursor:pointer;color:#6366f1;display:inline-flex;">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    html += '</button>';
    html += '<button class="btn-icon deleteVidgen4Video" data-task-id="' + video.id + '" title="Hapus video" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:6px;cursor:pointer;color:#ef4444;">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    html += '</button>';
    html += '</div>';
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
  
  if (!state.vidgen4._historyLoaded && state.vidgen4.customApiKey) {
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
    uploadZone.addEventListener('click', function() { imageInput.click(); });
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
      state.vidgen4._historyLoaded = false;
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
        const validDurations = newModel === 'sora-2-vip' ? [10, 15] : newModel === 'grok-video' ? [6, 10] : [8];
        if (!validDurations.includes(state.vidgen4.duration)) {
          state.vidgen4.duration = validDurations[0];
        }
        const validResolutions = newModel === 'veo3.1-fast' ? ['720p', '1080p'] : newModel === 'grok-video' ? ['480p', '720p'] : ['720p'];
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

      const deleteBtn = e.target.closest('.deleteVidgen4Video');
      if (deleteBtn && state.currentPage === 'vidgen4') {
        const taskId = deleteBtn.dataset.taskId;
        if (confirm('Hapus video ini secara permanen?')) {
          deleteVidgen4Video(taskId);
        }
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

async function deleteVidgen4Video(taskId) {
  try {
    const res = await fetch(`${API_URL}/api/vidgen4/history/${taskId}`, {
      method: 'DELETE',
      headers: { 'X-Xclip-Key': state.vidgen4.customApiKey }
    });
    const data = await res.json();
    if (data.success) {
      state.vidgen4.generatedVideos = state.vidgen4.generatedVideos.filter(v => v.id !== taskId);
      render();
    } else {
      alert(data.error || 'Gagal hapus video');
    }
  } catch (e) {
    alert('Gagal hapus video');
  }
}

function handleVidgen4ImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Hanya file gambar yang diperbolehkan');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast('Ukuran gambar maksimal 50MB', 'error');
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
        image: (state.vidgen4.selectedModel === 'sora-2-vip' || state.vidgen4.selectedModel === 'grok-video') && state.vidgen4.sourceImage ? state.vidgen4.sourceImage.data : null,
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
    
    const cooldownEnd = Date.now() + (3 * 60 * 1000);
    state.vidgen4.cooldownEndTime = cooldownEnd;
    localStorage.setItem('vidgen4_cooldown', cooldownEnd.toString());
    startVidgen4CooldownTimer();
    
    savePendingTasks();
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
  
  state.vidgen4.isPolling = true;
  
  const poll = async () => {
    if (attempts >= maxAttempts) {
      state.vidgen4.tasks = state.vidgen4.tasks.filter(t => t.taskId !== taskId);
      _activePolls.delete(taskId);
      state.vidgen4.isPolling = false;
      savePendingTasks();
      state.vidgen4.error = 'Timeout - video generation terlalu lama';
      showToast('Timeout - video generation terlalu lama', 'error');
      render(true);
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/api/vidgen4/tasks/${taskId}`, {
        headers: { 'X-Xclip-Key': state.vidgen4.customApiKey }
      });
      
      if (!response.ok && (response.status === 404 || response.status === 401)) {
        state.vidgen4.tasks = state.vidgen4.tasks.filter(t => t.taskId !== taskId);
        _activePolls.delete(taskId);
        state.vidgen4.isPolling = state.vidgen4.tasks.length > 0;
        savePendingTasks();
        render(true);
        return;
      }
      
      const data = await response.json();
      
      if (data.status === 'completed' && data.videoUrl) {
        state.vidgen4.tasks = state.vidgen4.tasks.filter(t => t.taskId !== taskId);
        _activePolls.delete(taskId);
        state.vidgen4.isPolling = state.vidgen4.tasks.length > 0;
        savePendingTasks();
        const alreadyExists = state.vidgen4.generatedVideos.some(v => v.id === taskId || v.taskId === taskId);
        if (!alreadyExists) {
          state.vidgen4.generatedVideos.unshift({
            id: taskId,
            taskId: taskId,
            url: data.videoUrl,
            model: data.model,
            prompt: data.prompt,
            createdAt: new Date()
          });
        }
        showToast('Video berhasil digenerate!', 'success');
        render(true);
        return;
      }
      
      if (data.status === 'failed') {
        state.vidgen4.tasks = state.vidgen4.tasks.filter(t => t.taskId !== taskId);
        _activePolls.delete(taskId);
        state.vidgen4.isPolling = state.vidgen4.tasks.length > 0;
        savePendingTasks();
        state.vidgen4.error = data.error || 'Video generation failed';
        showToast(data.error || 'Video generation failed', 'error');
        render(true);
        return;
      }
      
      const task = state.vidgen4.tasks.find(t => t.taskId === taskId);
      if (task) {
        task.progress = data.progress || Math.min(90, attempts * 2);
        const progressEl = document.querySelector(`[data-task-id="${taskId}"] .task-progress-fill`);
        const progressText = document.querySelector(`[data-task-id="${taskId}"] .task-progress-text`);
        if (progressEl) progressEl.style.width = `${task.progress}%`;
        if (progressText) progressText.textContent = `${task.progress}%`;
      }
      
      attempts++;
      console.log(`[VIDGEN4] Poll attempt ${attempts}/${maxAttempts}, status: ${data.status}`);
      setTimeout(poll, 5000);
      
    } catch (error) {
      console.error('[VIDGEN4] Poll error:', error);
      attempts++;
      if (attempts >= 3 && !state.vidgen4.tasks.find(t => t.taskId === taskId)) {
        _activePolls.delete(taskId);
        state.vidgen4.isPolling = false;
        savePendingTasks();
        return;
      }
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

  if (uploadZone && imageInput) {
    uploadZone.addEventListener('click', function() { imageInput.click(); });

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

  const videoUploadZone = document.getElementById('vidgen3VideoUploadZone');
  const videoInput = document.getElementById('vidgen3VideoInput');
  const removeVideoBtn = document.getElementById('removeVidgen3Video');

  if (videoUploadZone && videoInput) {
    videoUploadZone.addEventListener('click', function() { videoInput.click(); });

    videoUploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      videoUploadZone.classList.add('drag-over');
    });

    videoUploadZone.addEventListener('dragleave', () => {
      videoUploadZone.classList.remove('drag-over');
    });

    videoUploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      videoUploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        handleVidgen3VideoUpload(e.dataTransfer.files[0]);
      }
    });

    videoInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleVidgen3VideoUpload(e.target.files[0]);
    });
  }

  if (removeVideoBtn) {
    removeVideoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.vidgen3.referenceVideo = null;
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

  document.querySelectorAll('.vidgen3-dismiss-task').forEach(btn => {
    btn.addEventListener('click', () => {
      const taskId = btn.dataset.dismissTask;
      state.vidgen3.tasks = state.vidgen3.tasks.filter(t => t.taskId !== taskId);
      _activePolls.delete(taskId);
      savePendingTasks();
      render();
    });
  });

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

  if (file.size > 50 * 1024 * 1024) {
    showToast('Ukuran gambar maksimal 50MB', 'error');
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

function handleVidgen3VideoUpload(file) {
  if (!file || !file.type.startsWith('video/')) {
    alert('File harus berupa video');
    return;
  }
  const maxSizeMB = 30;
  if (file.size > maxSizeMB * 1024 * 1024) {
    alert(`Video terlalu besar. Maksimal ${maxSizeMB}MB`);
    return;
  }
  const reader = new FileReader();
  reader.onload = (event) => {
    state.vidgen3.referenceVideo = {
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

  if (!state.vidgen3.prompt && !state.vidgen3.sourceImage) { alert('Masukkan prompt atau upload gambar referensi'); return; }

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
    const body = {
      model: model,
      prompt: state.vidgen3.prompt,
      image: state.vidgen3.sourceImage?.data || null,
      videoUrl: state.vidgen3.referenceVideo?.data || null,
      resolution: state.vidgen3.resolution,
      aspectRatio: state.vidgen3.aspectRatio || 'landscape'
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
      model: model,
      status: 'processing',
      progress: 0
    });

    state.vidgen3.cooldownEndTime = Date.now() + 300000;
    localStorage.setItem('vidgen3_cooldown', state.vidgen3.cooldownEndTime.toString());
    startVidgen3CooldownTimer();

    savePendingTasks();
    pollVidgen3Task(result.taskId, model);
    showToast('Video sedang diproses...', 'success');

  } catch (error) {
    console.error('Vidgen3 generate error:', error);
    showToast(error.message, 'error');
  } finally {
    state.vidgen3.isGenerating = false;
    render();
  }
}

function pollVidgen3Task(initialTaskId, model) {
  const maxAttempts = 600;
  let attempts = 0;
  let taskId = initialTaskId;

  state.vidgen3.isPolling = true;
  setTimeout(() => poll(), 5000);

  const poll = async () => {
    try {
      const task = state.vidgen3.tasks.find(t => t.taskId === taskId);
      if (!task) { state.vidgen3.isPolling = state.vidgen3.tasks.length > 0; return; }

      const response = await fetch(`${API_URL}/api/vidgen3/tasks/${taskId}?model=${encodeURIComponent(model)}`, {
        headers: { 'X-Xclip-Key': state.vidgen3.customApiKey }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 404 || response.status === 401) {
          state.vidgen3.tasks = state.vidgen3.tasks.filter(t => t.taskId !== taskId);
          _activePolls.delete(taskId);
          savePendingTasks();
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
        _activePolls.delete(taskId);
        state.vidgen3.isPolling = state.vidgen3.tasks.length > 0;
        savePendingTasks();
        showToast('Video berhasil di-generate!', 'success');
        render(true);
        return;
      }

      if (data.status === 'retrying' && data.newTaskId) {
        const oldTaskId = task.taskId;
        task.taskId = data.newTaskId;
        task.status = 'processing';
        task.progress = 5;
        _activePolls.delete(oldTaskId);
        _activePolls.add(data.newTaskId);
        savePendingTasks();
        showToast(data.message || 'Auto-retry...', 'info');
        render(true);
        taskId = data.newTaskId;
        setTimeout(poll, 8000);
        return;
      }

      if (data.status === 'failed') {
        state.vidgen3.tasks = state.vidgen3.tasks.filter(t => t.taskId !== taskId);
        _activePolls.delete(taskId);
        state.vidgen3.isPolling = state.vidgen3.tasks.length > 0;
        savePendingTasks();
        showToast(`Video gagal: ${data.error || 'Generation gagal'}`, 'error');
        render(true);
        return;
      }

      // Partial DOM update for progress (no full re-render)
      const progressEl = document.querySelector(`[data-task-id="${taskId}"] .task-progress-fill`);
      const progressText = document.querySelector(`[data-task-id="${taskId}"] .task-progress-text`);
      if (progressEl) progressEl.style.width = `${task.progress}%`;
      if (progressText) progressText.textContent = `${task.progress}%`;
      
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(poll, 5000);
      } else {
        state.vidgen3.tasks = state.vidgen3.tasks.filter(t => t.taskId !== taskId);
        _activePolls.delete(taskId);
        state.vidgen3.isPolling = false;
        savePendingTasks();
        showToast('Timeout - video generation terlalu lama', 'error');
        render(true);
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
  
  var googleSearchCheckbox = document.getElementById('ximageGoogleSearch');
  if (googleSearchCheckbox) {
    googleSearchCheckbox.addEventListener('change', function(e) {
      state.ximage.googleSearch = e.target.checked;
      saveUserInputs('ximage');
      render();
    });
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
            { id: 'gemini-3-pro-image', supportsI2I: true },
            { id: 'gemini-3-pro-image-lite', supportsI2I: true },
            { id: 'gemini-2.5-flash-image', supportsI2I: true },
            { id: 'nanobanana2', supportsI2I: true },
            { id: 'nanobanana2-beta', supportsI2I: true },
            { id: 'seedream-5.0', supportsI2I: true },
            { id: 'seedream-4.5', supportsI2I: true },
            { id: 'grok-4.2-image', supportsI2I: true },
            { id: 'grok-imagine', supportsI2I: true },
            { id: 'grok-imagine-pro', supportsI2I: true },
            { id: 'kling-omni-image', supportsI2I: true },
            { id: 'p-image', supportsI2I: false },
            { id: 'p-image-edit', supportsI2I: true }
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
        var modelsWithMultiRef = ['nanobanana2', 'nanobanana2-beta', 'seedream-5.0', 'seedream-4.5', 'kling-omni-image', 'p-image-edit'];
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
      
      var qualityBtn = e.target.closest('[data-ximage-quality]');
      if (qualityBtn && state.currentPage === 'ximage') {
        state.ximage.quality = qualityBtn.dataset.ximageQuality;
        saveUserInputs('ximage');
        render();
        return;
      }
      
      var variantBtn = e.target.closest('[data-ximage-variant]');
      if (variantBtn && state.currentPage === 'ximage') {
        state.ximage.modelVariant = variantBtn.dataset.ximageVariant;
        saveUserInputs('ximage');
        render();
        return;
      }
      
      var speedBtn = e.target.closest('[data-ximage-speed]');
      if (speedBtn && state.currentPage === 'ximage') {
        state.ximage.renderingSpeed = speedBtn.dataset.ximageSpeed;
        saveUserInputs('ximage');
        render();
        return;
      }
      
      var styleBtn = e.target.closest('[data-ximage-style]');
      if (styleBtn && state.currentPage === 'ximage') {
        state.ximage.imageStyle = styleBtn.dataset.ximageStyle;
        saveUserInputs('ximage');
        render();
        return;
      }
      
      var accelBtn = e.target.closest('[data-ximage-accel]');
      if (accelBtn && state.currentPage === 'ximage') {
        state.ximage.acceleration = accelBtn.dataset.ximageAccel;
        saveUserInputs('ximage');
        render();
        return;
      }
      
      var formatBtn = e.target.closest('[data-ximage-format]');
      if (formatBtn && state.currentPage === 'ximage') {
        state.ximage.outputFormat = formatBtn.dataset.ximageFormat;
        saveUserInputs('ximage');
        render();
        return;
      }
      
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

  // X Image delete buttons
  document.querySelectorAll('.ximage-delete-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var index = parseInt(btn.dataset.index);
      var image = state.ximage.generatedImages[index];
      state.ximage.generatedImages.splice(index, 1);
      render();
      if (image && image.id) {
        fetch(API_URL + '/api/ximage/history/' + image.id, {
          method: 'DELETE',
          credentials: 'include'
        }).catch(function(err) { console.error('Failed to delete ximage history:', err); });
      }
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
  
  if (file.size > 50 * 1024 * 1024) {
    showToast('Ukuran gambar maksimal 50MB', 'error');
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
  var modelsNotSupportingI2I = ['p-image'];
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
      numberOfImages: state.ximage.numberOfImages,
      quality: state.ximage.quality,
      modelVariant: state.ximage.modelVariant,
      renderingSpeed: state.ximage.renderingSpeed,
      imageStyle: state.ximage.imageStyle,
      acceleration: state.ximage.acceleration,
      googleSearch: state.ximage.googleSearch,
      outputFormat: state.ximage.outputFormat
    };
    
    if (state.ximage.mode === 'image-to-image' && state.ximage.sourceImage) {
      requestBody.image = state.ximage.sourceImage.data;
      var multiRefModels = ['nanobanana2', 'nanobanana2-beta', 'seedream-5.0', 'seedream-4.5', 'kling-omni-image', 'p-image-edit'];
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
    
    if (data.imageUrl) {
      state.ximage.generatedImages.unshift({
        taskId: data.taskId,
        model: data.model || state.ximage.selectedModel,
        url: data.imageUrl,
        prompt: requestBody.prompt,
        completedAt: new Date().toISOString()
      });
      render();
      return;
    }
    
    state.ximage.tasks.push({
      taskId: data.taskId,
      model: state.ximage.selectedModel,
      startTime: Date.now()
    });
    
    savePendingTasks();
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
      
      // Update task progress (partial DOM update - no full re-render)
      var task = state.ximage.tasks.find(function(t) { return t.taskId === taskId; });
      if (task) {
        task.progress = data.progress || Math.min(90, attempts * 3);
        task.status = data.message || 'Processing...';
        var progressEl = document.querySelector('[data-task-id="' + taskId + '"] .task-progress-fill');
        var progressText = document.querySelector('[data-task-id="' + taskId + '"] .task-progress-text');
        if (progressEl) progressEl.style.width = task.progress + '%';
        if (progressText) progressText.textContent = task.progress + '%';
      }
      
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
          id: img.id,
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

function attachXImage2EventListeners() {
  console.log('[XIMAGE2] attachXImage2EventListeners called');

  if (state.ximage2.generatedImages.length === 0 && !state.ximage2._historyLoaded) {
    loadXImage2History().then(function() { render(); });
  }

  if (!state.ximage2RoomManager._statusLoaded) {
    state.ximage2RoomManager._statusLoaded = true;
    loadXImage2SubscriptionStatus().then(function() { render(); });
  }

  var maxRefSlots = 4;
  for (var zi = 0; zi < maxRefSlots; zi++) {
    (function(idx) {
      var uploadZone = document.getElementById('ximage2UploadZone' + idx);
      var imageInput = document.getElementById('ximage2FileInput' + idx);
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
            handleXImage2Upload({ target: { files: e.dataTransfer.files } }, idx);
          }
        });
        imageInput.addEventListener('change', function(e) {
          handleXImage2Upload(e, idx);
        });
      }
    })(zi);
  }

  document.querySelectorAll('.ximage2-remove-ref').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var idx = parseInt(btn.dataset.refIndex);
      state.ximage2.sourceImages.splice(idx, 1);
      render();
    });
  });

  var generateBtn = document.getElementById('ximage2GenerateBtn');
  var promptInput = document.getElementById('ximage2Prompt');
  var apiKeyInput = document.getElementById('ximage2ApiKey');

  if (generateBtn) {
    generateBtn.addEventListener('click', generateXImage2);
  }

  if (promptInput) {
    promptInput.addEventListener('input', function(e) {
      state.ximage2.prompt = e.target.value;
      saveUserInputs('ximage2');
    });
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', function(e) {
      state.ximage2.customApiKey = e.target.value;
      saveUserInputs('ximage2');
    });
  }

  var watermarkToggle = document.getElementById('ximage2Watermark');
  if (watermarkToggle) {
    watermarkToggle.addEventListener('change', function(e) {
      state.ximage2.watermark = e.target.checked;
      saveUserInputs('ximage2');
    });
  }

  var sequentialToggle = document.getElementById('ximage2Sequential');
  if (sequentialToggle) {
    sequentialToggle.addEventListener('change', function(e) {
      state.ximage2.sequentialGeneration = e.target.checked;
      saveUserInputs('ximage2');
    });
  }

  var safetySlider = document.getElementById('ximage2SafetyTolerance');
  if (safetySlider) {
    safetySlider.addEventListener('input', function(e) {
      state.ximage2.safetyTolerance = parseInt(e.target.value);
      saveUserInputs('ximage2');
      var valueDisplay = safetySlider.parentElement.querySelector('.setting-value');
      if (valueDisplay) valueDisplay.textContent = state.ximage2.safetyTolerance;
    });
  }

  var promptUpsamplingToggle = document.getElementById('ximage2PromptUpsampling');
  if (promptUpsamplingToggle) {
    promptUpsamplingToggle.addEventListener('change', function(e) {
      state.ximage2.promptUpsampling = e.target.checked;
      saveUserInputs('ximage2');
    });
  }

  var maskUploadZone = document.getElementById('ximage2MaskUploadZone');
  var maskFileInput = document.getElementById('ximage2MaskFileInput');
  if (maskUploadZone && maskFileInput) {
    maskUploadZone.addEventListener('click', function() { maskFileInput.click(); });
    maskUploadZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      maskUploadZone.classList.add('drag-over');
    });
    maskUploadZone.addEventListener('dragleave', function() {
      maskUploadZone.classList.remove('drag-over');
    });
    maskUploadZone.addEventListener('drop', function(e) {
      e.preventDefault();
      maskUploadZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) handleXImage2MaskUpload(e.dataTransfer.files[0]);
    });
    maskFileInput.addEventListener('change', function(e) {
      if (e.target.files.length > 0) handleXImage2MaskUpload(e.target.files[0]);
    });
  }

  var removeMaskBtn = document.getElementById('ximage2RemoveMask');
  if (removeMaskBtn) {
    removeMaskBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      state.ximage2.maskImage = null;
      render();
    });
  }

  if (!window._ximage2DelegationAttached) {
    window._ximage2DelegationAttached = true;

    document.addEventListener('click', function(e) {
      var modeBtn = e.target.closest('[data-ximage2-mode]');
      if (modeBtn && state.currentPage === 'ximage2') {
        var newMode = modeBtn.dataset.ximage2Mode;
        state.ximage2.mode = newMode;
        state.ximage2.sourceImages = [];
        saveUserInputs('ximage2');
        render();
        return;
      }

      var modelCard = e.target.closest('[data-ximage2-model]');
      if (modelCard && state.currentPage === 'ximage2' && !modelCard.classList.contains('disabled')) {
        state.ximage2.selectedModel = modelCard.dataset.ximage2Model;
        saveUserInputs('ximage2');
        render();
        return;
      }

      var sizeBtn = e.target.closest('[data-ximage2-size]');
      if (sizeBtn && state.currentPage === 'ximage2') {
        state.ximage2.size = sizeBtn.dataset.ximage2Size;
        saveUserInputs('ximage2');
        render();
        return;
      }

      var resBtn = e.target.closest('[data-ximage2-resolution]');
      if (resBtn && state.currentPage === 'ximage2') {
        state.ximage2.resolution = resBtn.dataset.ximage2Resolution;
        saveUserInputs('ximage2');
        render();
        return;
      }

      var numBtn = e.target.closest('[data-ximage2-num-action]');
      if (numBtn && state.currentPage === 'ximage2') {
        var action = numBtn.dataset.ximage2NumAction;
        if (action === 'increase' && state.ximage2.numberOfImages < 4) {
          state.ximage2.numberOfImages++;
        } else if (action === 'decrease' && state.ximage2.numberOfImages > 1) {
          state.ximage2.numberOfImages--;
        }
        saveUserInputs('ximage2');
        render();
        return;
      }

      var inputModeBtn = e.target.closest('[data-ximage2-input-mode]');
      if (inputModeBtn && state.currentPage === 'ximage2') {
        state.ximage2.inputMode = inputModeBtn.dataset.ximage2InputMode;
        saveUserInputs('ximage2');
        render();
        return;
      }
    });
  }

  var openXimage2RoomModal = document.getElementById('openXimage2RoomModal');
  var changeXimage2Room = document.getElementById('changeXimage2Room');
  if (openXimage2RoomModal) {
    openXimage2RoomModal.onclick = async function(e) {
      e.preventDefault();
      state.ximage2RoomManager.showRoomModal = true;
      render();
      await loadXImage2Rooms();
    };
  }
  if (changeXimage2Room) {
    changeXimage2Room.onclick = async function(e) {
      e.preventDefault();
      state.ximage2RoomManager.showRoomModal = true;
      render();
      await loadXImage2Rooms();
    };
  }

  var closeXimage2RoomModal = document.getElementById('closeXimage2RoomModal');
  var ximage2RoomModalOverlay = document.getElementById('ximage2RoomModalOverlay');
  if (closeXimage2RoomModal) {
    closeXimage2RoomModal.addEventListener('click', function() {
      state.ximage2RoomManager.showRoomModal = false;
      render();
    });
  }
  if (ximage2RoomModalOverlay) {
    ximage2RoomModalOverlay.addEventListener('click', function(e) {
      if (e.target === ximage2RoomModalOverlay) {
        state.ximage2RoomManager.showRoomModal = false;
        render();
      }
    });
  }

  var ximage2RoomApiKeyInput = document.getElementById('ximage2RoomApiKeyInput');
  if (ximage2RoomApiKeyInput) {
    ximage2RoomApiKeyInput.addEventListener('input', function(e) {
      state.ximage2RoomManager.xclipApiKey = e.target.value;
      saveUserInputs('ximage2RoomManager');
    });
  }

  document.querySelectorAll('.join-ximage2-room-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var roomId = parseInt(btn.dataset.roomId);
      joinXImage2Room(roomId);
    });
  });

  document.querySelectorAll('.ximage2-download-btn').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.preventDefault();
      var url = decodeURIComponent(btn.dataset.url);
      var filename = btn.dataset.filename;
      await downloadImage(url, filename);
    });
  });

  document.querySelectorAll('.ximage2-delete-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var index = parseInt(btn.dataset.index);
      var image = state.ximage2.generatedImages[index];
      state.ximage2.generatedImages.splice(index, 1);
      render();
      if (image && image.id && state.ximage2.customApiKey) {
        fetch(API_URL + '/api/ximage2/history/' + image.id, {
          method: 'DELETE',
          headers: { 'X-Xclip-Key': state.ximage2.customApiKey },
          credentials: 'include'
        }).catch(function(err) { console.error('Failed to delete ximage2 history:', err); });
      }
    });
  });

  if (state.ximage2.cooldownEnd > Date.now()) {
    startXImage2CooldownTimer();
  }
}

function handleXImage2Upload(e, refIndex) {
  var file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Pilih file gambar');
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    showToast('Ukuran gambar maksimal 50MB', 'error');
    return;
  }

  var reader = new FileReader();
  reader.onload = function(event) {
    while (state.ximage2.sourceImages.length <= refIndex) {
      state.ximage2.sourceImages.push(null);
    }
    state.ximage2.sourceImages[refIndex] = {
      file: file,
      data: event.target.result,
      name: file.name
    };
    render();
  };
  reader.readAsDataURL(file);
}

function handleXImage2MaskUpload(file) {
  if (!file) return;
  if (file.type !== 'image/png') {
    alert('Mask image harus berformat PNG');
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    alert('Mask image maksimal 4MB');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(event) {
    state.ximage2.maskImage = {
      file: file,
      data: event.target.result,
      name: file.name
    };
    render();
  };
  reader.readAsDataURL(file);
}

async function generateXImage2() {
  if (state.ximage2.mode === 'image-to-image' && state.ximage2.sourceImages.filter(Boolean).length === 0) {
    alert('Upload gambar referensi terlebih dahulu');
    return;
  }

  if (!state.ximage2.prompt) {
    alert('Masukkan prompt');
    return;
  }

  if (!state.ximage2.customApiKey) {
    alert('Masukkan Xclip API Key');
    return;
  }

  if (state.ximage2.tasks.length >= 3) {
    alert('Maks 3 gambar bersamaan. Tunggu salah satu selesai.');
    return;
  }

  var now = Date.now();
  if (state.ximage2.cooldownEnd > now) {
    alert('Cooldown aktif. Tunggu ' + Math.ceil((state.ximage2.cooldownEnd - now) / 1000) + ' detik.');
    return;
  }

  state.ximage2.isGenerating = true;
  state.ximage2.error = null;
  render();

  try {
    var requestBody = {
      model: state.ximage2.selectedModel,
      prompt: state.ximage2.prompt,
      size: state.ximage2.size,
      mode: state.ximage2.mode,
      resolution: state.ximage2.resolution,
      numberOfImages: state.ximage2.numberOfImages,
      watermark: state.ximage2.watermark,
      sequentialGeneration: state.ximage2.sequentialGeneration,
      safetyTolerance: state.ximage2.safetyTolerance,
      inputMode: state.ximage2.inputMode,
      promptUpsampling: state.ximage2.promptUpsampling
    };

    if (state.ximage2.mode === 'image-to-image') {
      var images = state.ximage2.sourceImages.filter(Boolean).map(function(img) { return img.data; });
      if (images.length > 0) {
        requestBody.images = images;
      }
    }

    if (state.ximage2.maskImage) {
      requestBody.maskImage = state.ximage2.maskImage.data;
    }

    var response = await fetch(API_URL + '/api/ximage2/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-xclip-key': state.ximage2.customApiKey
      },
      credentials: 'include',
      body: JSON.stringify(requestBody)
    });

    var data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Gagal generate image');
    }

    if (data.imageUrl) {
      state.ximage2.generatedImages.unshift({
        url: data.imageUrl,
        model: state.ximage2.selectedModel,
        prompt: state.ximage2.prompt,
        createdAt: new Date().toISOString()
      });
      state.ximage2.cooldownEnd = Date.now() + (data.cooldown || 10) * 1000;
      startXImage2CooldownTimer();
    } else if (data.taskId) {
      state.ximage2.tasks.push({
        taskId: data.taskId,
        model: state.ximage2.selectedModel,
        startTime: Date.now()
      });
      savePendingTasks();
      pollXImage2Task(data.taskId);
      state.ximage2.cooldownEnd = Date.now() + (data.cooldown || 10) * 1000;
      startXImage2CooldownTimer();
    }

  } catch (error) {
    console.error('X Image2 error:', error);
    state.ximage2.error = error.message;
    alert(error.message);
  } finally {
    state.ximage2.isGenerating = false;
    render();
  }
}

function startXImage2CooldownTimer() {
  if (window._ximage2CooldownInterval) clearInterval(window._ximage2CooldownInterval);
  window._ximage2CooldownInterval = setInterval(function() {
    if (Date.now() >= state.ximage2.cooldownEnd) {
      clearInterval(window._ximage2CooldownInterval);
      window._ximage2CooldownInterval = null;
      render();
    } else {
      var btn = document.getElementById('ximage2GenerateBtn');
      if (btn) {
        var remaining = Math.ceil((state.ximage2.cooldownEnd - Date.now()) / 1000);
        btn.disabled = true;
        btn.innerHTML = '<span>Cooldown ' + remaining + 's</span>';
      }
    }
  }, 1000);
}

async function pollXImage2Task(taskId) {
  var maxAttempts = 120;
  var attempts = 0;

  var poll = async function() {
    if (attempts >= maxAttempts) {
      state.ximage2.tasks = state.ximage2.tasks.filter(function(t) { return t.taskId !== taskId; });
      state.ximage2.error = 'Timeout: Image generation terlalu lama';
      render();
      return;
    }

    attempts++;

    try {
      var response = await fetch(API_URL + '/api/ximage2/status/' + taskId, {
        headers: { 'x-xclip-key': state.ximage2.customApiKey },
        credentials: 'include'
      });

      var data = await response.json();

      if (data.status === 'completed' && data.imageUrl) {
        state.ximage2.tasks = state.ximage2.tasks.filter(function(t) { return t.taskId !== taskId; });
        state.ximage2.generatedImages.unshift({
          url: data.imageUrl,
          model: state.ximage2.selectedModel,
          prompt: state.ximage2.prompt,
          createdAt: new Date().toISOString()
        });
        render();
        return;
      }

      if (data.status === 'failed') {
        state.ximage2.tasks = state.ximage2.tasks.filter(function(t) { return t.taskId !== taskId; });
        state.ximage2.error = data.error || 'Image generation failed';
        render();
        return;
      }

      var task = state.ximage2.tasks.find(function(t) { return t.taskId === taskId; });
      if (task) {
        task.progress = data.progress || Math.min(90, attempts * 3);
        task.status = data.message || 'Processing...';
        var progressEl = document.querySelector('[data-task-id="' + taskId + '"] .task-progress-fill');
        var progressText = document.querySelector('[data-task-id="' + taskId + '"] .task-progress-text');
        if (progressEl) progressEl.style.width = task.progress + '%';
        if (progressText) progressText.textContent = task.progress + '%';
      }

      console.log('[XIMAGE2] Poll attempt ' + attempts + '/' + maxAttempts + ', status: ' + data.status);
      setTimeout(poll, 3000);

    } catch (error) {
      console.error('[XIMAGE2] Poll error:', error);
      attempts++;
      setTimeout(poll, 3000);
    }
  };

  poll();
}

async function loadXImage2History() {
  try {
    var response = await fetch(API_URL + '/api/ximage2/history', { credentials: 'include' });
    var data = await response.json();

    if (data.images) {
      state.ximage2.generatedImages = data.images.map(function(img) {
        return {
          id: img.id,
          url: img.imageUrl,
          model: img.model,
          prompt: img.prompt,
          createdAt: img.createdAt
        };
      });
    }
    state.ximage2._historyLoaded = true;
  } catch (error) {
    console.error('Failed to load X Image2 history:', error);
  }
}

function attachXImage3EventListeners() {
  console.log('[XIMAGE3] attachXImage3EventListeners called');

  if (state.ximage3.generatedImages.length === 0 && !state.ximage3._historyLoaded) {
    state.ximage3._historyLoaded = true;
    loadXImage3History().then(function() { render(); });
  }

  if (!state.ximage3RoomManager._statusLoaded) {
    state.ximage3RoomManager._statusLoaded = true;
    loadXImage3SubscriptionStatus().then(function() { render(); });
  }

  var maxRefSlots = 4;
  for (var zi = 0; zi < maxRefSlots; zi++) {
    (function(idx) {
      var uploadZone = document.getElementById('ximage3UploadZone' + idx);
      var imageInput = document.getElementById('ximage3FileInput' + idx);
      if (uploadZone && imageInput) {
        uploadZone.addEventListener('click', function() { imageInput.click(); });
        uploadZone.addEventListener('dragover', function(e) { e.preventDefault(); uploadZone.classList.add('drag-over'); });
        uploadZone.addEventListener('dragleave', function() { uploadZone.classList.remove('drag-over'); });
        uploadZone.addEventListener('drop', function(e) {
          e.preventDefault(); uploadZone.classList.remove('drag-over');
          if (e.dataTransfer.files.length > 0) handleXImage3Upload({ target: { files: e.dataTransfer.files } }, idx);
        });
        imageInput.addEventListener('change', function(e) { handleXImage3Upload(e, idx); });
      }
    })(zi);
  }

  document.querySelectorAll('.ximage3-remove-ref').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var idx = parseInt(btn.dataset.refIndex);
      state.ximage3.sourceImages.splice(idx, 1);
      render();
    });
  });

  var generateBtn = document.getElementById('ximage3GenerateBtn');
  var promptInput = document.getElementById('ximage3Prompt');
  var apiKeyInput = document.getElementById('ximage3ApiKey');

  if (generateBtn) generateBtn.addEventListener('click', generateXImage3);
  if (promptInput) {
    promptInput.addEventListener('input', function(e) {
      state.ximage3.prompt = e.target.value;
      saveUserInputs('ximage3');
    });
  }
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', function(e) {
      state.ximage3.customApiKey = e.target.value;
      saveUserInputs('ximage3');
    });
  }

  if (!window._ximage3DelegationAttached) {
    window._ximage3DelegationAttached = true;
    document.addEventListener('click', function(e) {
      var modeBtn = e.target.closest('[data-ximage3-mode]');
      if (modeBtn && state.currentPage === 'ximage3') {
        state.ximage3.mode = modeBtn.dataset.ximage3Mode;
        state.ximage3.sourceImages = [];
        saveUserInputs('ximage3');
        render();
        return;
      }
      var modelCard = e.target.closest('[data-ximage3-model]');
      if (modelCard && state.currentPage === 'ximage3' && !modelCard.classList.contains('disabled')) {
        state.ximage3.selectedModel = modelCard.dataset.ximage3Model;
        saveUserInputs('ximage3');
        render();
        return;
      }
      var sizeBtn = e.target.closest('[data-ximage3-size]');
      if (sizeBtn && state.currentPage === 'ximage3') {
        state.ximage3.size = sizeBtn.dataset.ximage3Size;
        saveUserInputs('ximage3');
        render();
        return;
      }
      var resBtn = e.target.closest('[data-ximage3-resolution]');
      if (resBtn && state.currentPage === 'ximage3') {
        state.ximage3.resolution = resBtn.dataset.ximage3Resolution;
        saveUserInputs('ximage3');
        render();
        return;
      }
      var numBtn = e.target.closest('[data-ximage3-num-action]');
      if (numBtn && state.currentPage === 'ximage3') {
        var action = numBtn.dataset.ximage3NumAction;
        if (action === 'increase' && state.ximage3.numberOfImages < 4) state.ximage3.numberOfImages++;
        else if (action === 'decrease' && state.ximage3.numberOfImages > 1) state.ximage3.numberOfImages--;
        saveUserInputs('ximage3');
        render();
        return;
      }
    });
  }

  var openXimage3RoomModal = document.getElementById('openXimage3RoomModal');
  var changeXimage3Room = document.getElementById('changeXimage3Room');
  if (openXimage3RoomModal) {
    openXimage3RoomModal.onclick = async function(e) {
      e.preventDefault();
      state.ximage3RoomManager.showRoomModal = true;
      render();
      await loadXImage3Rooms();
    };
  }
  if (changeXimage3Room) {
    changeXimage3Room.onclick = async function(e) {
      e.preventDefault();
      state.ximage3RoomManager.showRoomModal = true;
      render();
      await loadXImage3Rooms();
    };
  }

  var closeXimage3RoomModal = document.getElementById('closeXimage3RoomModal');
  var ximage3RoomModalOverlay = document.getElementById('ximage3RoomModalOverlay');
  if (closeXimage3RoomModal) {
    closeXimage3RoomModal.addEventListener('click', function() {
      state.ximage3RoomManager.showRoomModal = false;
      render();
    });
  }
  if (ximage3RoomModalOverlay) {
    ximage3RoomModalOverlay.addEventListener('click', function(e) {
      if (e.target === ximage3RoomModalOverlay) {
        state.ximage3RoomManager.showRoomModal = false;
        render();
      }
    });
  }

  var ximage3RoomApiKeyInput = document.getElementById('ximage3RoomApiKeyInput');
  if (ximage3RoomApiKeyInput) {
    ximage3RoomApiKeyInput.addEventListener('input', function(e) {
      state.ximage3RoomManager.xclipApiKey = e.target.value;
      saveUserInputs('ximage3RoomManager');
    });
  }

  document.querySelectorAll('.join-ximage3-room-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var roomId = parseInt(btn.dataset.roomId);
      joinXImage3Room(roomId);
    });
  });

  document.querySelectorAll('.ximage3-download-btn').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.preventDefault();
      var url = decodeURIComponent(btn.dataset.url);
      var filename = btn.dataset.filename;
      await downloadImage(url, filename);
    });
  });

  document.querySelectorAll('.ximage3-delete-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var index = parseInt(btn.dataset.index);
      var image = state.ximage3.generatedImages[index];
      state.ximage3.generatedImages.splice(index, 1);
      render();
      if (image && image.id && state.ximage3.customApiKey) {
        fetch(API_URL + '/api/ximage3/history/' + image.id, {
          method: 'DELETE',
          headers: { 'X-Xclip-Key': state.ximage3.customApiKey },
          credentials: 'include'
        }).catch(function(err) { console.error('Failed to delete ximage3 history:', err); });
      }
    });
  });

  if (state.ximage3.cooldownEnd > Date.now()) {
    startXImage3CooldownTimer();
  }
}

function handleXImage3Upload(e, refIndex) {
  var file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Pilih file gambar'); return; }
  if (file.size > 50 * 1024 * 1024) { showToast('Ukuran gambar maksimal 50MB', 'error'); return; }
  var reader = new FileReader();
  reader.onload = function(event) {
    while (state.ximage3.sourceImages.length <= refIndex) state.ximage3.sourceImages.push(null);
    state.ximage3.sourceImages[refIndex] = { file: file, data: event.target.result, name: file.name };
    render();
  };
  reader.readAsDataURL(file);
}

async function generateXImage3() {
  if (state.ximage3.mode === 'image-to-image' && state.ximage3.sourceImages.filter(Boolean).length === 0) {
    alert('Upload gambar referensi terlebih dahulu');
    return;
  }
  if (!state.ximage3.prompt) { alert('Masukkan prompt'); return; }
  if (!state.ximage3.customApiKey) { alert('Masukkan Xclip API Key'); return; }
  if (state.ximage3.tasks.length >= 3) { alert('Maks 3 gambar bersamaan. Tunggu salah satu selesai.'); return; }
  var now = Date.now();
  if (state.ximage3.cooldownEnd > now) {
    alert('Cooldown aktif. Tunggu ' + Math.ceil((state.ximage3.cooldownEnd - now) / 1000) + ' detik.');
    return;
  }

  state.ximage3.isGenerating = true;
  state.ximage3.error = null;
  render();

  try {
    var requestBody = {
      model: state.ximage3.selectedModel,
      prompt: state.ximage3.prompt,
      size: state.ximage3.size,
      mode: state.ximage3.mode,
      resolution: state.ximage3.resolution,
      numberOfImages: state.ximage3.numberOfImages
    };

    if (state.ximage3.mode === 'image-to-image') {
      var images = state.ximage3.sourceImages.filter(Boolean).map(function(img) { return img.data; });
      if (images.length > 0) requestBody.images = images;
    }

    var response = await fetch(API_URL + '/api/ximage3/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-xclip-key': state.ximage3.customApiKey },
      credentials: 'include',
      body: JSON.stringify(requestBody)
    });

    var data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Gagal generate image');

    if (data.imageUrl) {
      state.ximage3.generatedImages.unshift({
        url: data.imageUrl,
        model: state.ximage3.selectedModel,
        prompt: state.ximage3.prompt,
        createdAt: new Date().toISOString()
      });
      state.ximage3.cooldownEnd = Date.now() + (data.cooldown || 10) * 1000;
      startXImage3CooldownTimer();
    } else if (data.taskId) {
      state.ximage3.tasks.push({
        taskId: data.taskId,
        model: state.ximage3.selectedModel,
        startTime: Date.now()
      });
      savePendingTasks();
      pollXImage3Task(data.taskId);
      state.ximage3.cooldownEnd = Date.now() + (data.cooldown || 10) * 1000;
      startXImage3CooldownTimer();
    }

  } catch (error) {
    console.error('X Image3 error:', error);
    state.ximage3.error = error.message;
    alert(error.message);
  } finally {
    state.ximage3.isGenerating = false;
    render();
  }
}

function startXImage3CooldownTimer() {
  if (window._ximage3CooldownInterval) clearInterval(window._ximage3CooldownInterval);
  window._ximage3CooldownInterval = setInterval(function() {
    if (Date.now() >= state.ximage3.cooldownEnd) {
      clearInterval(window._ximage3CooldownInterval);
      window._ximage3CooldownInterval = null;
      render();
    } else {
      var btn = document.getElementById('ximage3GenerateBtn');
      if (btn) {
        var remaining = Math.ceil((state.ximage3.cooldownEnd - Date.now()) / 1000);
        btn.disabled = true;
        btn.innerHTML = '<span>Cooldown ' + remaining + 's</span>';
      }
    }
  }, 1000);
}

async function pollXImage3Task(taskId) {
  var maxAttempts = 120;
  var attempts = 0;
  var poll = async function() {
    if (attempts >= maxAttempts) {
      state.ximage3.tasks = state.ximage3.tasks.filter(function(t) { return t.taskId !== taskId; });
      state.ximage3.error = 'Timeout: Image generation terlalu lama';
      render();
      return;
    }
    attempts++;
    try {
      var response = await fetch(API_URL + '/api/ximage3/status/' + taskId, {
        headers: { 'x-xclip-key': state.ximage3.customApiKey },
        credentials: 'include'
      });
      var data = await response.json();
      if (data.status === 'completed' && data.imageUrl) {
        state.ximage3.tasks = state.ximage3.tasks.filter(function(t) { return t.taskId !== taskId; });
        var alreadyExists = state.ximage3.generatedImages.some(function(img) { return img.taskId === taskId; });
        if (!alreadyExists) {
          state.ximage3.generatedImages.unshift({
            url: data.imageUrl,
            model: state.ximage3.selectedModel,
            prompt: state.ximage3.prompt,
            taskId: taskId,
            createdAt: new Date().toISOString()
          });
        }
        savePendingTasks();
        render();
        return;
      }
      if (data.status === 'failed') {
        state.ximage3.tasks = state.ximage3.tasks.filter(function(t) { return t.taskId !== taskId; });
        state.ximage3.error = data.error || 'Image generation failed';
        savePendingTasks();
        render();
        return;
      }
      var task = state.ximage3.tasks.find(function(t) { return t.taskId === taskId; });
      if (task) {
        task.progress = data.progress || Math.min(90, attempts * 3);
        task.status = data.message || 'Processing...';
      }
      console.log('[XIMAGE3] Poll attempt ' + attempts + '/' + maxAttempts + ', status: ' + data.status);
      setTimeout(poll, 3000);
    } catch (error) {
      console.error('[XIMAGE3] Poll error:', error);
      attempts++;
      setTimeout(poll, 3000);
    }
  };
  poll();
}

async function loadXImage3History() {
  try {
    var response = await fetch(API_URL + '/api/ximage3/history', { credentials: 'include' });
    var data = await response.json();
    if (data.images) {
      state.ximage3.generatedImages = data.images.map(function(img) {
        return { id: img.id, url: img.imageUrl, model: img.model, prompt: img.prompt, createdAt: img.createdAt };
      });
    }
    state.ximage3._historyLoaded = true;
  } catch (error) {
    console.error('Failed to load X Image3 history:', error);
  }
}

function attachMotionEventListeners() {
  if (!state.motion._historyLoaded) {
    state.motion._historyLoaded = true;
    loadMotionHistory().then(() => render(true));
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
    imageUploadZone.onclick = function(e) {
      if (e.target.closest('.remove-upload')) return;
      imageInput.value = '';
      imageInput.click();
    };
    imageInput.onchange = handleMotionImageUpload;
  }
  
  if (videoUploadZone && videoInput) {
    videoUploadZone.onclick = function(e) {
      if (e.target.closest('.remove-upload')) return;
      videoInput.value = '';
      videoInput.click();
    };
    videoInput.onchange = handleMotionVideoUpload;
    
    const previewVideo = videoUploadZone.querySelector('video');
    if (previewVideo) {
      previewVideo.style.pointerEvents = 'none';
      previewVideo.load();
      const playPromise = previewVideo.play();
      if (playPromise) playPromise.catch(() => {});
    }
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
  
  if (file.size > 50 * 1024 * 1024) {
    showToast('Ukuran gambar maksimal 50MB', 'error');
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
  
  const blobUrl = URL.createObjectURL(file);
  let thumbnailDone = false;
  
  function finishUpload(thumbnail) {
    if (thumbnailDone) return;
    thumbnailDone = true;
    const reader = new FileReader();
    reader.onload = (event) => {
      state.motion.referenceVideo = {
        name: file.name,
        type: file.type,
        data: event.target.result,
        preview: blobUrl,
        thumbnail: thumbnail
      };
      render();
      showToast('Video referensi berhasil diupload!', 'success');
    };
    reader.onerror = () => {
      state.motion.referenceVideo = {
        name: file.name,
        type: file.type,
        data: null,
        preview: blobUrl,
        thumbnail: thumbnail
      };
      render();
      showToast('Video referensi berhasil diupload!', 'success');
    };
    reader.readAsDataURL(file);
  }
  
  setTimeout(() => finishUpload(null), 5000);
  
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = blobUrl;
    
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(1, video.duration / 2);
      } catch (err) {
        finishUpload(null);
      }
    };
    
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
        finishUpload(thumbnail);
      } catch (err) {
        finishUpload(null);
      }
    };
    
    video.onloadedmetadata = () => {
      setTimeout(() => finishUpload(null), 3000);
    };
    
    video.onerror = () => {
      finishUpload(null);
    };
    
    video.load();
  } catch (err) {
    finishUpload(null);
  }
  
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
    
    savePendingTasks();
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

function pollMotionStatus(initialTaskId, model, apiKey) {
  let taskId = initialTaskId;
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
      let task = state.motion.tasks.find(t => t.taskId === taskId);
      if (!task && taskId !== initialTaskId) {
        task = state.motion.tasks.find(t => t.taskId === initialTaskId);
        if (task) {
          task.taskId = taskId;
          savePendingTasks();
        }
      }
      if (!task) {
        console.log('[MOTION POLL] Task not found in state, checking if already handled');
        const alreadyGenerated = state.motion.generatedVideos.some(v => v.taskId === taskId || v.taskId === initialTaskId);
        if (alreadyGenerated) {
          console.log('[MOTION POLL] Task already completed via SSE, stopping poll');
          stopPolling();
          return;
        }
        if (state.motion._handledTaskIds && (state.motion._handledTaskIds.has(taskId) || state.motion._handledTaskIds.has(initialTaskId))) {
          console.log('[MOTION POLL] Task already handled (failed/removed via SSE), stopping poll');
          stopPolling();
          return;
        }
        task = { taskId, model, apiKey };
        state.motion.tasks.push(task);
        console.log('[MOTION POLL] Re-added task to state for polling');
      }
      
      if (task.status === 'completed' && task.videoUrl) {
        console.log('[MOTION POLL] Task already completed, stopping');
        stopPolling();
        return;
      }
      
      const xclipKey = apiKey || task.apiKey || state.motion.customApiKey || state.motionRoomManager.xclipApiKey || state.videogen.customApiKey;
      
      if (!xclipKey) {
        if (!task._noKeyCount) task._noKeyCount = 0;
        task._noKeyCount++;
        console.warn(`[MOTION POLL] No API key yet, waiting... (${task._noKeyCount}/10)`);
        if (task._noKeyCount >= 10) {
          task.status = 'failed';
          task.error = 'Xclip API key diperlukan - silakan isi API key di pengaturan';
          stopPolling();
          render(true);
          return;
        }
        task.statusText = 'Menunggu API key...';
        updateMotionTaskUI(taskId);
        setTimeout(poll, 5000);
        return;
      }
      
      const headers = { 
        'Content-Type': 'application/json',
        'X-Xclip-Key': xclipKey
      };
      
      const response = await fetch(`${API_URL}/api/motion/tasks/${taskId}?model=${encodeURIComponent(model)}`, {
        method: 'GET',
        headers: headers,
        credentials: 'include'
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
            render(true);
            return;
          }
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(poll, 5000);
          }
          return;
        }
        
        if (response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504) {
          if (!task._serverErrorCount) task._serverErrorCount = 0;
          task._serverErrorCount++;
          console.log(`[MOTION POLL] Server error ${response.status} count: ${task._serverErrorCount}/15 for task ${taskId}`);
          task.statusText = 'Server Freepik sedang sibuk, mencoba lagi...';
          updateMotionTaskUI(taskId);
          if (task._serverErrorCount >= 15) {
            task.status = 'failed';
            task.error = 'Server Freepik tidak merespon setelah beberapa kali percobaan';
            stopPolling();
            render(true);
            return;
          }
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(poll, 8000);
          }
          return;
        }
        
        throw new Error(errorData.error || `Gagal mengambil status task (${response.status})`);
      }
      
      const data = await response.json();
      
      if (data.taskId && data.taskId !== taskId) {
        console.log(`[MOTION POLL] Server returned new taskId: ${data.taskId} (was ${taskId})`);
        task.taskId = data.taskId;
        taskId = data.taskId;
        savePendingTasks();
      }
      
      task.status = data.status;
      task.progress = data.progress || 0;
      task.statusText = data.message || (data.status === 'processing' ? 'Generating motion video...' : data.status);
      
      if (data.status === 'completed' && data.videoUrl) {
        task.status = 'completed';
        task.videoUrl = data.videoUrl;
        const alreadyExists = state.motion.generatedVideos.some(v => v.taskId === taskId);
        if (!alreadyExists) {
          state.motion.generatedVideos.unshift({
            url: data.videoUrl,
            createdAt: Date.now(),
            taskId: taskId,
            model: task.model || model || 'unknown'
          });
        }
        stopPolling();
        showToast('Motion video selesai!', 'success');
        render(true);
        setTimeout(() => {
          state.motion.tasks = state.motion.tasks.filter(t => t.taskId !== taskId);
          render(true);
        }, 10000);
        return;
      }
      
      if (data.status === 'failed') {
        task.status = 'failed';
        task.error = cleanMotionError(data.error);
        stopPolling();
        savePendingTasks();
        showToast(cleanMotionError(data.error), 'error');
        render(true);
        setTimeout(() => {
          state.motion.tasks = state.motion.tasks.filter(t => t.taskId !== taskId);
          render(true);
        }, 15000);
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
        render(true);
      }
      
    } catch (error) {
      console.error('Poll motion error:', error);
      const task = state.motion.tasks.find(t => t.taskId === taskId);
      if (task) {
        if (!task._networkErrorCount) task._networkErrorCount = 0;
        task._networkErrorCount++;
        console.warn(`[MOTION POLL] Network error #${task._networkErrorCount} for task ${taskId}:`, error.message);

        if (task._networkErrorCount >= 20) {
          task.status = 'failed';
          task.error = 'Koneksi bermasalah, generation gagal setelah beberapa percobaan';
          stopPolling();
          render(true);
          return;
        }

        task.statusText = 'Koneksi sesaat bermasalah, mencoba lagi...';
        updateMotionTaskUI(taskId);
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 10000);
        }
      }
    }
  };
  
  poll();
}

async function deleteMotionHistory(index) {
  const video = state.motion.generatedVideos[index];
  if (!video) return;
  
  state.motion.generatedVideos.splice(index, 1);
  render(true);
  
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

function deleteMotionTask(taskId) {
  state.motion.tasks = state.motion.tasks.filter(t => t.taskId !== taskId);
  state.motion.generatedVideos = state.motion.generatedVideos.filter(v => v.taskId !== taskId);
  render(true);
  
  try {
    fetch(`${API_URL}/api/motion/history/${taskId}`, {
      method: 'DELETE',
      credentials: 'include'
    });
  } catch (error) {
    console.error('Failed to delete motion task:', error);
  }
}

function handleVideoGenImageUpload(e) {
  var files = e.target.files || (e.dataTransfer && e.dataTransfer.files);
  var file = files && files[0];
  if (!file) return;
  
  var isImage = (file.type && file.type.startsWith('image/')) || /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?)$/i.test(file.name);
  if (!isImage) {
    showToast('Silakan upload file gambar (JPG, PNG, WebP, dll)', 'error');
    var fi = document.getElementById('videoGenImageInput');
    if (fi) fi.value = '';
    return;
  }
  
  if (file.size > 50 * 1024 * 1024) {
    showToast('Ukuran gambar maksimal 50MB', 'error');
    var fi2 = document.getElementById('videoGenImageInput');
    if (fi2) fi2.value = '';
    return;
  }
  
  var reader = new FileReader();
  reader.onload = function(event) {
    state.videogen.sourceImage = {
      name: file.name,
      type: file.type || 'image/jpeg',
      data: event.target.result
    };
    render();
    showToast('Gambar berhasil diupload!', 'success');
  };
  reader.onerror = function() {
    showToast('Gagal membaca file gambar. Coba gambar lain.', 'error');
  };
  reader.readAsDataURL(file);
}

const _progressTimers = {};
function startLocalProgressTimer(taskId) {
  if (_progressTimers[taskId]) clearInterval(_progressTimers[taskId]);
  const startMs = Date.now();
  _progressTimers[taskId] = setInterval(() => {
    const task = state.videogen.tasks.find(t => t.taskId === taskId);
    if (!task) {
      clearInterval(_progressTimers[taskId]);
      delete _progressTimers[taskId];
      return;
    }
    const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
    const progress = Math.min(95, Math.floor(elapsedSec * 0.3));
    task.elapsed = elapsedSec;
    task.progress = progress;
    const progressEl = document.querySelector('[data-task-id="' + taskId + '"] .task-progress-fill');
    const progressText = document.querySelector('[data-task-id="' + taskId + '"] .task-progress-text');
    const elapsedEl = document.querySelector('[data-task-id="' + taskId + '"] .task-elapsed');
    if (progressEl) progressEl.style.width = progress + '%';
    if (progressText) progressText.textContent = progress + '%';
    if (elapsedEl) elapsedEl.textContent = elapsedSec + 's';
  }, 1000);
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
    
    const genAbortController = new AbortController();
    const genTimeout = setTimeout(() => genAbortController.abort(), 120000);
    
    let response;
    try {
      response = await fetch(`${API_URL}/api/videogen/proxy`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: genAbortController.signal
      });
    } finally {
      clearTimeout(genTimeout);
    }
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Server error' }));
      if (response.status === 429 && error.cooldown) {
        startCooldownTimer('videogen', error.cooldown);
      }
      throw new Error(error.error || 'Failed to generate video');
    }
    
    const data = await response.json();
    
    if (data.taskId) {
      if (data.cooldown) {
        startCooldownTimer('videogen', data.cooldown);
      }
      const newTask = {
        taskId: data.taskId,
        model: data.model || state.videogen.selectedModel,
        status: 'processing',
        elapsed: 0,
        progress: 0,
        videoUrl: null,
        createdAt: Date.now()
      };
      state.videogen.tasks.push(newTask);
      savePendingTasks();
      state.videogen.isGenerating = false;
      render();
      startLocalProgressTimer(data.taskId);
      pollVideoStatus(data.taskId, newTask.model);
      showToast('Video sedang diproses. Anda bisa generate video lagi (maks 3).', 'success');
    } else if (data.videoUrl) {
      if (data.cooldown) {
        startCooldownTimer('videogen', data.cooldown);
      }
      state.videogen.generatedVideos.unshift({ url: data.videoUrl, createdAt: Date.now() });
      state.videogen.isGenerating = false;
      showToast('Video berhasil di-generate!', 'success');
      render();
    } else {
      throw new Error('Tidak mendapat response dari server');
    }
    
  } catch (error) {
    console.error('Generate video error:', error);
    const errMsg = error.name === 'AbortError'
      ? 'Server terlalu lama merespons. Coba lagi beberapa saat.'
      : error.message;
    state.videogen.error = errMsg;
    state.videogen.isGenerating = false;
    showToast('Gagal generate video: ' + errMsg, 'error');
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
        if (_progressTimers[taskId]) { clearInterval(_progressTimers[taskId]); delete _progressTimers[taskId]; }
        task.status = 'completed';
        task.progress = 100;
        task.videoUrl = data.videoUrl;
        const alreadyExists = state.videogen.generatedVideos.some(v => v.taskId === taskId);
        if (!alreadyExists) {
          state.videogen.generatedVideos.unshift({ url: data.videoUrl, createdAt: Date.now(), taskId });
        }
        state.videogen.tasks = state.videogen.tasks.filter(t => t.taskId !== taskId);
        if (state.videogen.tasks.length === 0) {
          state.videogen.isPolling = false;
        }
        showToast('Video berhasil di-generate!', 'success');
        render(true);
        return;
      }
      
      if (data.status === 'failed' || data.status === 'FAILED') {
        if (_progressTimers[taskId]) { clearInterval(_progressTimers[taskId]); delete _progressTimers[taskId]; }
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
      if (_progressTimers[data.taskId]) { clearInterval(_progressTimers[data.taskId]); delete _progressTimers[data.taskId]; }
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
        completedTask.progress = 100;
        completedTask.videoUrl = data.videoUrl;
        state.videogen.tasks = state.videogen.tasks.filter(t => t.taskId !== data.taskId);
      }
      
      if (state.videogen.tasks.length === 0) {
        state.videogen.isPolling = false;
      }
      
      _activePolls.delete(data.taskId);
      savePendingTasks();
      showToast('Video berhasil di-generate!', 'success');
      render(true);
      break;
    
    case 'motion_completed':
      console.log('[SSE] Motion completed event received:', data.taskId, data.videoUrl, 'originalTaskId:', data.originalTaskId);
      state.motion._handledTaskIds.add(data.taskId);
      if (data.originalTaskId) state.motion._handledTaskIds.add(data.originalTaskId);
      const motionExists = state.motion.generatedVideos.some(v => v.taskId === data.taskId || (data.originalTaskId && v.taskId === data.originalTaskId));
      if (!motionExists && data.videoUrl) {
        state.motion.generatedVideos.unshift({ 
          url: data.videoUrl, 
          createdAt: Date.now(), 
          taskId: data.taskId,
          model: data.model || 'unknown'
        });
      }
      const sseMotionTask = state.motion.tasks.find(t => t.taskId === data.taskId || (data.originalTaskId && t.taskId === data.originalTaskId));
      if (sseMotionTask) {
        sseMotionTask.status = 'completed';
        sseMotionTask.videoUrl = data.videoUrl;
        sseMotionTask.taskId = data.taskId;
      }
      state.motion.isPolling = state.motion.tasks.some(t => t.status !== 'completed' && t.status !== 'failed');
      savePendingTasks();
      showToast('Motion video selesai!', 'success');
      render(true);
      setTimeout(() => {
        state.motion.tasks = state.motion.tasks.filter(t => t.taskId !== data.taskId && (!data.originalTaskId || t.taskId !== data.originalTaskId));
        render(true);
      }, 10000);
      break;
      
    case 'video_failed':
      const failedTask = state.videogen.tasks.find(t => t.taskId === data.taskId);
      if (failedTask) {
        failedTask.status = 'failed';
        failedTask.error = data.error;
        state.videogen.tasks = state.videogen.tasks.filter(t => t.taskId !== data.taskId);
        state.videogen.isPolling = state.videogen.tasks.some(t => t.status !== 'completed' && t.status !== 'failed');
        savePendingTasks();
        showToast('Gagal generate video: ' + data.error, 'error');
        render(true);
      }
      break;
    
    case 'motion_retry':
      console.log('[SSE] Motion retry:', data.oldTaskId, '->', data.newTaskId, `(${data.retryCount}/${data.maxRetries})`);
      const retryTask = state.motion.tasks.find(t => t.taskId === data.oldTaskId);
      if (retryTask) {
        retryTask.taskId = data.newTaskId;
        retryTask.status = 'processing';
        retryTask.error = null;
        retryTask.retryCount = data.retryCount;
      }
      savePendingTasks();
      showToast(`Motion retry ${data.retryCount}/${data.maxRetries}...`, 'info');
      render(true);
      break;
      
    case 'motion_failed':
      state.motion._handledTaskIds.add(data.taskId);
      const failedMotionTask = state.motion.tasks.find(t => t.taskId === data.taskId);
      if (failedMotionTask) {
        failedMotionTask.status = 'failed';
        failedMotionTask.error = data.error || 'Generation failed';
      }
      state.motion.isPolling = state.motion.tasks.some(t => t.status !== 'completed' && t.status !== 'failed' && t.taskId !== data.taskId);
      savePendingTasks();
      showToast('Gagal generate motion: ' + cleanMotionError(data.error), 'error');
      render(true);
      setTimeout(() => {
        state.motion.tasks = state.motion.tasks.filter(t => t.taskId !== data.taskId);
        render(true);
      }, 15000);
      break;

    case 'vidgen2_completed':
      console.log('[SSE] Vidgen2 completed:', data.taskId, data.videoUrl);
      const vidgen2Exists = state.vidgen2.generatedVideos.some(v => v.taskId === data.taskId || v.id === data.taskId);
      if (!vidgen2Exists && data.videoUrl) {
        state.vidgen2.generatedVideos.unshift({
          id: data.taskId,
          url: data.videoUrl,
          model: data.model || 'unknown',
          taskId: data.taskId,
          createdAt: new Date().toISOString()
        });
      }
      const completedVidgen2Task = state.vidgen2.tasks.find(t => t.taskId === data.taskId);
      if (completedVidgen2Task) {
        completedVidgen2Task.status = 'completed';
        completedVidgen2Task.videoUrl = data.videoUrl;
        state.vidgen2.tasks = state.vidgen2.tasks.filter(t => t.taskId !== data.taskId);
      }
      savePendingTasks();
      showToast('Vidgen2 video berhasil di-generate!', 'success');
      render(true);
      break;

    case 'vidgen2_failed':
      const failedVidgen2Task = state.vidgen2.tasks.find(t => t.taskId === data.taskId);
      if (failedVidgen2Task) {
        failedVidgen2Task.status = 'failed';
        failedVidgen2Task.error = data.error;
        state.vidgen2.tasks = state.vidgen2.tasks.filter(t => t.taskId !== data.taskId);
        savePendingTasks();
        showToast('Gagal generate video: ' + data.error, 'error');
        render(true);
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
      savePendingTasks();
      showToast('Vidgen3 video berhasil di-generate!', 'success');
      render(true);
      break;

    case 'vidgen3_failed':
      const failedVidgen3Task = state.vidgen3.tasks.find(t => t.taskId === data.taskId);
      if (failedVidgen3Task) {
        failedVidgen3Task.status = 'failed';
        failedVidgen3Task.error = data.error;
        state.vidgen3.tasks = state.vidgen3.tasks.filter(t => t.taskId !== data.taskId);
        savePendingTasks();
        showToast('Gagal generate video: ' + data.error, 'error');
        render(true);
      }
      break;

    case 'vidgen4_completed':
      console.log('[SSE] Vidgen4 completed:', data.taskId, data.videoUrl);
      const vidgen4Exists = state.vidgen4.generatedVideos.some(v => v.id === data.taskId || v.taskId === data.taskId);
      if (!vidgen4Exists && data.videoUrl) {
        state.vidgen4.generatedVideos.unshift({
          id: data.taskId,
          url: data.videoUrl,
          model: data.model || 'unknown',
          prompt: data.prompt || '',
          taskId: data.taskId,
          createdAt: new Date().toISOString()
        });
      }
      state.vidgen4.tasks = state.vidgen4.tasks.filter(t => t.taskId !== data.taskId);
      _activePolls.delete(data.taskId);
      savePendingTasks();
      showToast('Vidgen4 video berhasil di-generate!', 'success');
      render(true);
      break;

    case 'vidgen4_failed':
      console.log('[SSE] Vidgen4 failed:', data.taskId, data.error);
      state.vidgen4.tasks = state.vidgen4.tasks.filter(t => t.taskId !== data.taskId);
      _activePolls.delete(data.taskId);
      state.vidgen4.error = data.error || 'Video generation failed';
      savePendingTasks();
      showToast('Gagal generate Vidgen4: ' + (data.error || 'Generation failed'), 'error');
      render(true);
      break;

    case 'ximage3_completed':
      console.log('[SSE] XImage3 completed:', data.taskId, data.imageUrl);
      if (data.imageUrl) {
        var xi3Exists = state.ximage3.generatedImages.some(function(v) { return v.taskId === data.taskId; });
        if (!xi3Exists) {
          state.ximage3.generatedImages.unshift({
            url: data.imageUrl,
            model: data.model || 'unknown',
            taskId: data.taskId,
            createdAt: new Date().toISOString()
          });
        }
      }
      state.ximage3.tasks = state.ximage3.tasks.filter(function(t) { return t.taskId !== data.taskId; });
      savePendingTasks();
      showToast('X Image3 berhasil di-generate!', 'success');
      render(true);
      break;

    case 'ximage3_failed':
      state.ximage3.tasks = state.ximage3.tasks.filter(function(t) { return t.taskId !== data.taskId; });
      state.ximage3.error = data.error || 'Image generation failed';
      savePendingTasks();
      showToast('Gagal generate X Image3: ' + (data.error || 'Generation failed'), 'error');
      render(true);
      break;

    case 'video_progress':
      const progressTask = state.videogen.tasks.find(t => t.taskId === data.taskId);
      if (progressTask && data.progress) {
        progressTask.progress = data.progress;
        progressTask.status = data.status || 'processing';
        // Don't render on every progress update to avoid glitches
      }
      break;
      
    case 'scene_studio_progress':
      if (data.batchId && data.batchId === state.sceneStudio.batchProgress.batchId) {
        if (data.current) state.sceneStudio.batchProgress.current = data.current;
        if (data.total) state.sceneStudio.batchProgress.total = data.total;
        if (data.status === 'completed' && data.imageUrl) {
          const exists = state.sceneStudio.batchResults.some(r => r.index === data.index && r.status === 'completed');
          if (!exists) state.sceneStudio.batchResults.push({ index: data.index, prompt: data.prompt || '', status: 'completed', imageUrl: data.imageUrl });
        }
        if (data.status === 'failed') {
          const exists = state.sceneStudio.batchResults.some(r => r.index === data.index && r.status === 'failed');
          if (!exists) {
            state.sceneStudio.batchResults.push({ index: data.index, prompt: data.prompt || '', status: 'failed', error: data.error || 'Failed' });
            showToast(`Prompt #${(data.index || 0) + 1} gagal: ${data.error || 'Generation failed'}`, 'error');
          }
        }
        if (data.status === 'batch_done') {
          state.sceneStudio.isGenerating = false;
          state.sceneStudio._historyLoaded = false;
          if (data.results && Array.isArray(data.results)) {
            state.sceneStudio.batchResults = data.results;
          }
          loadSceneStudioHistory();
        }
        render(true);
      }
      break;

    case 'automation_update':
      if (data.projectId) {
        if (state.automation.currentProject && state.automation.currentProject.project_id === data.projectId) {
          state.automation.currentProject.status = data.status;
          if (data.status === 'completed' || data.status === 'production_failed' || data.status === 'script_ready' || data.status === 'script_failed') {
            loadAutomationProjectDetail(data.projectId);
          }
        }
        var projInList = state.automation.projects.find(function(p) { return p.project_id === data.projectId; });
        if (projInList) projInList.status = data.status;
        if (data.status === 'completed') showToast('Automation project selesai!', 'success');
        if (data.status === 'production_failed') showToast('Automation project gagal', 'error');
        if (data.status === 'script_ready') showToast('Script berhasil di-generate!', 'success');
        if (data.status === 'script_failed') showToast('Gagal generate script', 'error');
        render(true);
      }
      break;

    case 'automation_scene_update':
      if (data.projectId && state.automation.currentProject && state.automation.currentProject.project_id === data.projectId) {
        var sceneToUpdate = state.automation.currentScenes.find(function(s) { return s.scene_index === data.sceneIndex; });
        if (sceneToUpdate) {
          sceneToUpdate.status = data.status;
          if (data.imageUrl) sceneToUpdate.image_url = data.imageUrl;
          if (data.videoUrl) sceneToUpdate.video_url = data.videoUrl;
          if (data.error) sceneToUpdate.error_message = data.error;
        }
        render(true);
      }
      break;

    case 'youtube_upload_start':
      if (data.projectId) {
        state.automation.youtube.isUploading = true;
        state.automation.youtube.uploadProgress = { step: 'starting', message: 'Memulai...' };
        render(true);
      }
      break;

    case 'youtube_upload_progress':
      if (data.projectId) {
        state.automation.youtube.uploadProgress = { step: data.step, message: data.message };
        render(true);
      }
      break;

    case 'youtube_upload_complete':
      if (data.projectId) {
        state.automation.youtube.isUploading = false;
        state.automation.youtube.uploadProgress = null;
        if (data.success) {
          state.automation.youtube.lastVideoUrl = data.videoUrl;
          showToast('Upload berhasil! Video sudah di YouTube', 'success');
        } else {
          showToast('Upload gagal: ' + (data.error || 'Unknown error'), 'error');
        }
        render(true);
      }
      break;

    case 'ads_studio_update':
      if (data.projectId) {
        if (state.adsStudio.currentProject && state.adsStudio.currentProject.project_id === data.projectId) {
          state.adsStudio.currentProject.status = data.status;
          if (data.finalVideoUrl) state.adsStudio.currentProject.final_video_url = data.finalVideoUrl;
          if (data.status === 'completed' || data.status === 'production_failed' || data.status === 'script_ready' || data.status === 'script_failed') {
            loadAdsStudioProjectDetail(data.projectId);
          }
        }
        var adsProj = state.adsStudio.projects.find(function(p) { return p.project_id === data.projectId; });
        if (adsProj) adsProj.status = data.status;
        if (data.status === 'completed') showToast('Ads project selesai!', 'success');
        if (data.status === 'production_failed') showToast('Ads project gagal', 'error');
        if (data.status === 'script_ready') showToast('Ad script berhasil di-generate!', 'success');
        if (data.status === 'script_failed') showToast('Gagal generate ad script', 'error');
        render(true);
      }
      break;

    case 'ads_studio_scene_update':
      if (data.projectId && state.adsStudio.currentProject && state.adsStudio.currentProject.project_id === data.projectId) {
        var adsScene = state.adsStudio.currentScenes.find(function(s) { return s.scene_index === data.sceneIndex; });
        if (adsScene) {
          adsScene.status = data.status;
          if (data.imageUrl) adsScene.image_url = data.imageUrl;
          if (data.videoUrl) adsScene.video_url = data.videoUrl;
          if (data.error) adsScene.error_message = data.error;
        }
        render(true);
      }
      break;

    case 'ping':
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
  // Fallback: if app is still showing "Loading Xclip..." after 10s, show login UI
  const fallbackTimer = setTimeout(() => {
    const mainContent = document.getElementById('mainContent');
    if (mainContent && mainContent.innerHTML.includes('Loading Xclip')) {
      console.warn('[INIT] Timeout fallback triggered - showing login UI');
      state.auth.isLoading = false;
      try { render(true); } catch(e) { showFallbackLoginUI(); }
    }
  }, 10000);

  try {
    await checkAuth();
  } catch(e) {
    console.error('[INIT] checkAuth failed:', e);
    state.auth.isLoading = false;
    try { render(true); } catch(e2) { showFallbackLoginUI(); }
  } finally {
    clearTimeout(fallbackTimer);
  }

  if (state.auth.user) {
    connectSSE();
    fetchVideoHistory();
    recoverPendingTasks();
  }
}

async function loadVoiceoverRooms() {
  state.voiceoverRoomManager.isLoading = true;
  try {
    const res = await fetch(`${API_URL}/api/voiceover/rooms`, { credentials: 'include' });
    const data = await res.json();
    state.voiceoverRoomManager.rooms = data.rooms || [];
  } catch (e) {
    state.voiceoverRoomManager.rooms = [];
  }
  state.voiceoverRoomManager.isLoading = false;
}

async function loadVoiceoverSubscriptionStatus() {
  const apiKey = state.voiceover.customApiKey || state.voiceoverRoomManager.xclipApiKey;
  if (!apiKey) { state.voiceoverRoomManager.hasSubscription = false; return; }
  try {
    const res = await fetch(`${API_URL}/api/voiceover/subscription/status`, {
      headers: { 'X-Xclip-Key': apiKey }, credentials: 'include'
    });
    const data = await res.json();
    state.voiceoverRoomManager.hasSubscription = data.hasSubscription || false;
    state.voiceoverRoomManager.subscription = data.subscription || null;
  } catch (e) {
    state.voiceoverRoomManager.hasSubscription = false;
  }
}

async function loadVoiceoverVoices() {
  const apiKey = state.voiceover.customApiKey || state.voiceoverRoomManager.xclipApiKey;
  if (!apiKey) { showToast('Masukkan Xclip API key terlebih dahulu', 'error'); return; }
  state.voiceover.voicesLoading = true;
  render(true);
  try {
    const res = await fetch(`${API_URL}/api/voiceover/voices`, {
      headers: { 'X-Xclip-Key': apiKey }, credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Gagal memuat suara', 'error'); }
    else {
      state.voiceover.voices = data.voices || [];
      showToast(`${state.voiceover.voices.length} suara dimuat`, 'success');
    }
  } catch (e) { showToast('Gagal memuat suara', 'error'); }
  state.voiceover.voicesLoading = false;
  render(true);
}

async function loadVoiceoverHistory() {
  const apiKey = state.voiceover.customApiKey || state.voiceoverRoomManager.xclipApiKey;
  if (!apiKey) return;
  try {
    const res = await fetch(`${API_URL}/api/voiceover/history`, {
      headers: { 'X-Xclip-Key': apiKey }, credentials: 'include'
    });
    const data = await res.json();
    state.voiceover.history = data.history || [];
  } catch (e) {}
}

async function joinVoiceoverRoom(roomId) {
  const apiKey = state.voiceoverRoomManager.xclipApiKey || state.voiceover.customApiKey;
  if (!apiKey) { showToast('Masukkan Xclip API Key terlebih dahulu', 'error'); return; }
  try {
    const res = await fetch(`${API_URL}/api/voiceover/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Xclip-Key': apiKey },
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Gagal join room', 'error'); return; }
    state.voiceoverRoomManager.subscription = data.subscription;
    state.voiceoverRoomManager.hasSubscription = true;
    state.voiceoverRoomManager.showRoomModal = false;
    if (!state.voiceover.customApiKey) state.voiceover.customApiKey = apiKey;
    showToast(data.message, 'success');
    await loadVoiceoverVoices();
    await loadVoiceoverHistory();
    render();
  } catch (e) { showToast('Gagal join room', 'error'); }
}

async function generateVoiceover() {
  const vo = state.voiceover;
  const apiKey = vo.customApiKey || state.voiceoverRoomManager.xclipApiKey;
  if (!apiKey) { showToast('Masukkan Xclip API key terlebih dahulu', 'error'); return; }

  const isDialogue = vo.selectedModel === 'elevenlabs/text-to-dialogue-v3';

  if (isDialogue) {
    const validSegs = (vo.dialogueSegments || []).filter(s => s.text.trim());
    if (validSegs.length === 0) { showToast('Masukkan teks di minimal 1 segment', 'error'); return; }
  } else {
    if (!vo.text.trim()) { showToast('Masukkan teks terlebih dahulu', 'error'); return; }
    if (!vo.selectedVoiceId) { showToast('Pilih suara terlebih dahulu', 'error'); return; }
  }

  vo.isGenerating = true;
  render(true);

  try {
    const body = isDialogue
      ? {
          modelId: vo.selectedModel,
          dialogue: (vo.dialogueSegments || []).filter(s => s.text.trim()).map(s => ({ text: s.text, voice: s.voice })),
          stability: vo.stability
        }
      : {
          text: vo.text,
          voiceId: vo.selectedVoiceId,
          voiceName: vo.selectedVoiceName,
          modelId: vo.selectedModel,
          stability: vo.stability,
          similarityBoost: vo.similarityBoost,
          style: vo.style,
          useSpeakerBoost: vo.useSpeakerBoost
        };

    showToast('Mengirim ke kie.ai...', 'info');

    const res = await fetch(`${API_URL}/api/voiceover/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Xclip-Key': apiKey },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Gagal generate voice over', 'error');
      if (res.status === 429 && data.cooldownMs) {
        vo.cooldownEnd = Date.now() + data.cooldownMs;
        startVoiceoverCooldown();
      }
    } else {
      vo.currentAudioUrl = data.audioUrl;
      showToast('Voice over berhasil dibuat!', 'success');
      if (data.cooldown) {
        vo.cooldownEnd = Date.now() + (data.cooldown * 1000);
        startVoiceoverCooldown();
      }
      await loadVoiceoverHistory();
    }
  } catch (e) {
    showToast('Gagal generate voice over', 'error');
  }
  vo.isGenerating = false;
  render(true);
}

let voiceoverCooldownInterval = null;
function startVoiceoverCooldown() {
  if (voiceoverCooldownInterval) clearInterval(voiceoverCooldownInterval);
  voiceoverCooldownInterval = setInterval(() => {
    if (state.currentPage !== 'voiceover') return;
    if (Date.now() >= state.voiceover.cooldownEnd) {
      clearInterval(voiceoverCooldownInterval);
      voiceoverCooldownInterval = null;
      state.voiceover.cooldownEnd = 0;
      showToast('Voice Over siap digunakan kembali!', 'success');
    }
    render(true);
  }, 1000);
}

function attachVoiceoverEventListeners() {
  if (!state.voiceover._historyLoaded) {
    state.voiceover._historyLoaded = true;
    const apiKey = state.voiceover.customApiKey || state.voiceoverRoomManager.xclipApiKey;
    if (apiKey) {
      loadVoiceoverSubscriptionStatus().then(() => render(true));
      loadVoiceoverHistory().then(() => render(true));
    }
  }

  const openRoomModalBtn = document.getElementById('openVoiceoverRoomModalBtn');
  if (openRoomModalBtn) {
    openRoomModalBtn.addEventListener('click', async () => {
      state.voiceoverRoomManager.showRoomModal = true;
      await loadVoiceoverRooms();
      render();
    });
  }

  const changeRoomBtn = document.getElementById('changeVoiceRoomBtn');
  if (changeRoomBtn) {
    changeRoomBtn.addEventListener('click', async () => {
      state.voiceoverRoomManager.showRoomModal = true;
      await loadVoiceoverRooms();
      render();
    });
  }

  const closeRoomModal = document.getElementById('closeVoiceoverRoomModal');
  if (closeRoomModal) {
    closeRoomModal.addEventListener('click', () => {
      state.voiceoverRoomManager.showRoomModal = false;
      render();
    });
  }

  const modalOverlay = document.getElementById('voiceoverRoomModalOverlay');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) { state.voiceoverRoomManager.showRoomModal = false; render(); }
    });
  }

  const roomApiKeyInput = document.getElementById('voiceoverRoomApiKeyInput');
  if (roomApiKeyInput) {
    roomApiKeyInput.addEventListener('input', (e) => {
      state.voiceoverRoomManager.xclipApiKey = e.target.value;
      saveUserInputs('voiceoverRoomManager');
    });
  }

  document.querySelectorAll('.join-voiceover-room-btn').forEach(btn => {
    btn.addEventListener('click', () => joinVoiceoverRoom(parseInt(btn.dataset.roomId)));
  });

  const voApiKeyInput = document.getElementById('voiceoverApiKeyInput');
  if (voApiKeyInput) {
    voApiKeyInput.addEventListener('input', (e) => {
      state.voiceover.customApiKey = e.target.value;
      saveUserInputs('voiceover');
    });
  }

  const textArea = document.getElementById('voiceoverText');
  if (textArea) {
    textArea.addEventListener('input', (e) => {
      state.voiceover.text = e.target.value;
    });
  }

  const refreshVoicesBtn = document.getElementById('refreshVoicesBtn');
  if (refreshVoicesBtn) {
    refreshVoicesBtn.addEventListener('click', () => loadVoiceoverVoices());
  }

  const voiceSearchInput = document.getElementById('voiceSearchInput');
  if (voiceSearchInput) {
    voiceSearchInput.addEventListener('input', (e) => {
      state.voiceover.voiceSearch = e.target.value;
      render(true);
    });
  }

  document.querySelectorAll('.voice-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.preview-voice-btn')) return;
      state.voiceover.selectedVoiceId = card.dataset.voiceId;
      state.voiceover.selectedVoiceName = card.dataset.voiceName;
      render(true);
    });
  });

  document.querySelectorAll('.preview-voice-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.dataset.preview;
      if (url) {
        const audio = new Audio(url);
        audio.play().catch(() => showToast('Tidak dapat memutar preview', 'error'));
        showToast(`Preview: ${btn.dataset.name}`, 'info');
      }
    });
  });

  document.querySelectorAll('[data-vo-model]').forEach(el => {
    el.addEventListener('click', () => {
      state.voiceover.selectedModel = el.dataset.voModel;
      saveUserInputs('voiceover');
      render(true);
    });
  });

  const voStability = document.getElementById('voStability');
  if (voStability) {
    voStability.addEventListener('input', (e) => {
      state.voiceover.stability = parseFloat(e.target.value);
      saveUserInputs('voiceover');
      render(true);
    });
  }

  const voSimilarity = document.getElementById('voSimilarity');
  if (voSimilarity) {
    voSimilarity.addEventListener('input', (e) => {
      state.voiceover.similarityBoost = parseFloat(e.target.value);
      saveUserInputs('voiceover');
      render(true);
    });
  }

  const voStyle = document.getElementById('voStyle');
  if (voStyle) {
    voStyle.addEventListener('input', (e) => {
      state.voiceover.style = parseFloat(e.target.value);
      saveUserInputs('voiceover');
      render(true);
    });
  }

  const voSpeakerBoost = document.getElementById('voSpeakerBoost');
  if (voSpeakerBoost) {
    voSpeakerBoost.addEventListener('change', (e) => {
      state.voiceover.useSpeakerBoost = e.target.checked;
      saveUserInputs('voiceover');
    });
  }

  const addSegBtn = document.getElementById('addDialogueSegmentBtn');
  if (addSegBtn) {
    addSegBtn.addEventListener('click', () => {
      const voices = state.voiceover.voices;
      const defaultVoice = voices.length > 0 ? voices[0].name : 'Adam';
      state.voiceover.dialogueSegments = [...(state.voiceover.dialogueSegments || []), { voice: defaultVoice, text: '' }];
      render(true);
    });
  }

  document.querySelectorAll('.dialogue-voice-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.segIdx);
      if (!isNaN(idx) && state.voiceover.dialogueSegments[idx]) {
        state.voiceover.dialogueSegments[idx].voice = e.target.value;
      }
    });
  });

  document.querySelectorAll('.dialogue-text-input').forEach(ta => {
    ta.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.segIdx);
      if (!isNaN(idx) && state.voiceover.dialogueSegments[idx]) {
        state.voiceover.dialogueSegments[idx].text = e.target.value;
        const btn = document.getElementById('generateVoiceoverBtn');
        if (btn) {
          const hasText = state.voiceover.dialogueSegments.some(s => s.text.trim());
          btn.disabled = !hasText || state.voiceover.isGenerating;
        }
      }
    });
  });

  document.querySelectorAll('.remove-dialogue-seg-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.segIdx);
      state.voiceover.dialogueSegments = state.voiceover.dialogueSegments.filter((_, i) => i !== idx);
      render(true);
    });
  });

  document.querySelectorAll('.voiceover-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const voId = btn.dataset.voId;
      if (!voId) return;
      const apiKey = state.voiceover.customApiKey || state.voiceoverRoomManager.xclipApiKey;
      state.voiceover.history = state.voiceover.history.filter(h => String(h.id) !== String(voId));
      render(true);
      if (apiKey) {
        try {
          await fetch(`${API_URL}/api/voiceover/history/${voId}`, {
            method: 'DELETE',
            headers: { 'X-Xclip-Key': apiKey },
            credentials: 'include'
          });
        } catch (err) { console.error('Failed to delete voiceover history:', err); }
      }
    });
  });

  const generateBtn = document.getElementById('generateVoiceoverBtn');
  if (generateBtn) {
    generateBtn.addEventListener('click', () => generateVoiceover());
  }
}

// Start the app
initApp();
