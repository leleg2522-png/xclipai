import './_group.css';
const state = { xclipKeys: { showModal: true, newKeyLabel: '', isLoading: false, keys: [{ id: 1, label: 'Production Key', api_key: 'xclip_demo_not_a_real_key', requests_count: 1248, created_at: '2026-10-01T00:00:00Z' }] } };
function renderOriginalModal() {
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

        <div style="margin-top: 18px; padding: 14px 16px; border: 1px solid rgba(52, 211, 153, 0.2); border-radius: 12px; background: rgba(16, 185, 129, 0.07);">
          <div style="margin-bottom: 6px; color: #a1a1aa; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;">Provider dikelola Xclip</div>
          <strong style="color: #fff;">Picsart + Flora AI</strong>
          <p style="margin: 6px 0 0; color: #a1a1aa; font-size: 12px; line-height: 1.55;">Sesuai konfigurasi yang Anda sebutkan. Key provider tidak ditampilkan di sini; integrasi pihak ketiga hanya memerlukan API key Xclip di header <code>X-Xclip-Key</code>.</p>
        </div>
      </div>
    </div>
  `;
}

export function Current() { return <div className="min-h-screen" dangerouslySetInnerHTML={{ __html: renderOriginalModal() }} />; }
