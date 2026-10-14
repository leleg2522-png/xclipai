import { useState, type FormEvent } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  LogIn,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserPlus,
  Video,
  Wallet,
  X,
} from "lucide-react";
import "./Portal.css";

type ApiKey = { value: string; created: string; label: string };
type DocTab = "generate" | "status";

const generateCurl = `curl -X POST "$XCLIP_BASE_URL/api/videogen/proxy" \\
  -H "X-Xclip-Key: <API_KEY_ANDA>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<model>",
    "image": "<gambar_base64_atau_data_uri>",
    "prompt": "Kamera bergerak perlahan melewati lanskap",
    "duration": 5,
    "aspectRatio": "16:9"
  }'`;

const statusCurl = `curl "$XCLIP_BASE_URL/api/videogen/tasks/<taskId>" \\
  -H "X-Xclip-Key: <API_KEY_ANDA>"`;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function IconMark() {
  return <span className="xp-mark"><span /><span /><span /></span>;
}

export function Portal() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [keySpent, setKeySpent] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [keyLabel, setKeyLabel] = useState("Kunci integrasi");
  const [docTab, setDocTab] = useState<DocTab>("generate");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPayload, setShowPayload] = useState(true);

  const announceCopy = async (text: string, what: string) => {
    const ok = await copyText(text);
    setCopied(ok ? what : "");
    setError(ok ? "" : "Clipboard tidak tersedia di pratinjau ini. Pilih dan salin teks secara manual.");
    window.setTimeout(() => setCopied(""), 2200);
  };

  const createKey = () => {
    if (apiKey) return;
    if (!keyLabel.trim()) {
      setError("Tambahkan nama kunci sebelum membuat API key.");
      return;
    }
    setError("");
    setApiKey({
      value: "xclip_demo_local_4c81••••••••••••",
      created: "Hari ini",
      label: keyLabel.trim(),
    });
    setKeySpent(true);
    setNotice("API key demo dibuat. Nilai ini hanya berlaku di pratinjau.");
    window.setTimeout(() => setNotice(""), 4000);
  };

  const revokeKey = () => {
    setApiKey(null);
    setKeySpent(true);
    setKeyVisible(false);
    setConfirmRevoke(false);
    setNotice("Kunci demo dinonaktifkan. Sesuai kebijakan, kunci baru tidak dapat dibuat.");
    window.setTimeout(() => setNotice(""), 5000);
  };

  const activeCurl = docTab === "generate" ? generateCurl : statusCurl;

  const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = authEmail.trim().toLowerCase();
    if (!email || !authPassword) {
      setAuthError("Isi email dan kata sandi untuk melanjutkan.");
      return;
    }
    if (!validEmail(email)) {
      setAuthError("Masukkan alamat email dengan format yang benar.");
      return;
    }
    if (authPassword.length < 6) {
      setAuthError("Kata sandi harus berisi minimal 6 karakter.");
      return;
    }
    if (registeredEmail && email !== registeredEmail) {
      setAuthError("Untuk demo ini, lanjutkan dengan email yang baru didaftarkan.");
      return;
    }
    setAuthError("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthNotice("");
    setIsAuthenticated(true);
  };

  const handleRegister = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = authEmail.trim().toLowerCase();
    if (!authName.trim()) {
      setAuthError("Masukkan nama developer.");
      return;
    }
    if (!validEmail(email)) {
      setAuthError("Masukkan alamat email dengan format yang benar.");
      return;
    }
    if (authPassword.length < 6) {
      setAuthError("Kata sandi harus berisi minimal 6 karakter.");
      return;
    }
    if (authPassword !== authConfirmPassword) {
      setAuthError("Konfirmasi kata sandi belum cocok.");
      return;
    }
    setRegisteredEmail(email);
    setAuthEmail(email);
    setAuthPassword("");
    setAuthConfirmPassword("");
    setShowAuthPassword(false);
    setAuthError("");
    setAuthNotice("Pendaftaran demo selesai. Masuk kembali untuk melanjutkan ke portal.");
    setAuthMode("login");
  };

  const switchAuthMode = (mode: "register" | "login") => {
    setAuthMode(mode);
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthError("");
    setAuthNotice("");
    setShowAuthPassword(false);
  };

  if (!isAuthenticated) {
    const registering = authMode === "register";
    return (
      <div className="xp-portal xp-auth-screen">
        <header className="xp-topbar xp-auth-topbar">
          <a className="xp-brand" href="#login" aria-label="Xclip Developer Portal">
            <IconMark />
            <span className="xp-brand-name">xclip<span> / developers</span></span>
          </a>
          <span className="xp-auth-topnote"><LockKeyhole size={13} /> RUANG DEVELOPER XCLIP</span>
        </header>

        <div className="xp-auth-demo-banner">
          <span className="xp-demo-pip" />
          <strong>PRATINJAU</strong>
          <span>Pendaftaran dan login hanya simulasi lokal; tidak membuat akun di Railway.</span>
        </div>

        <main className="xp-auth-main" id="login">
          <section className="xp-auth-story">
            <div className="xp-auth-kicker"><span /> PORTAL DEVELOPER</div>
            <h1>{registering ? <>API video,<br /><em>dimulai dari sini.</em></> : <>Selamat<br /><em>datang kembali.</em></>}</h1>
            <p>{registering ? "Daftarkan akun developer terlebih dahulu, lalu masuk untuk mengelola API key, membaca quickstart, dan memeriksa akses." : "Masuk dengan akun Xclip Anda untuk membuka menu developer dan mengelola integrasi."}</p>
            <div className="xp-auth-promise">
              <span className="xp-auth-promise-icon"><ShieldCheck size={17} /></span>
              <span><strong>Akses terpusat</strong><small>{registering ? "Daftar dahulu sebelum masuk." : "Kredensial tidak disimpan dalam demo."}</small></span>
            </div>
          </section>

          <section className="xp-login-card" aria-labelledby="xp-login-title">
            <div className="xp-login-icon">{registering ? <UserPlus size={20} /> : <KeyRound size={20} />}</div>
            <span className="xp-login-kicker">{registering ? "AKUN DEVELOPER BARU" : "AKUN XCLIP"}</span>
            <h2 id="xp-login-title">{registering ? "Daftar developer" : "Masuk ke portal"}</h2>
            <p className="xp-login-intro">{registering ? "Buat akses demo sebelum melihat menu API." : "Gunakan akun Xclip terdaftar untuk membuka portal."}</p>

            <form className="xp-login-form" onSubmit={registering ? handleRegister : handleLogin} noValidate>
              {registering && (
                <>
                  <label htmlFor="xp-signup-name">Nama developer</label>
                  <div className="xp-login-input-wrap">
                    <UserPlus size={16} aria-hidden="true" />
                    <input
                      id="xp-signup-name"
                      type="text"
                      name="name"
                      autoComplete="name"
                      placeholder="Nama Anda"
                      value={authName}
                      onChange={event => { setAuthName(event.target.value); setAuthError(""); }}
                      required
                    />
                  </div>
                </>
              )}

              <label className={registering ? "xp-auth-secondary-label" : ""} htmlFor="xp-login-email">Email</label>
              <div className="xp-login-input-wrap">
                <Mail size={16} aria-hidden="true" />
                <input
                  id="xp-login-email"
                  type="email"
                  name="email"
                  autoComplete={registering ? "email" : "username"}
                  placeholder="nama@email.com"
                  value={authEmail}
                  onChange={event => { setAuthEmail(event.target.value); setAuthError(""); }}
                  required
                />
              </div>

              <div className={`xp-password-label-row ${registering ? "xp-auth-register-password-row" : ""}`}>
                <label htmlFor="xp-login-password">Kata sandi</label>
                <span>Minimal 6 karakter</span>
              </div>
              <div className="xp-login-input-wrap">
                <LockKeyhole size={16} aria-hidden="true" />
                <input
                  id="xp-login-password"
                  type={showAuthPassword ? "text" : "password"}
                  name="password"
                  autoComplete={registering ? "new-password" : "current-password"}
                  placeholder="Masukkan kata sandi"
                  value={authPassword}
                  onChange={event => { setAuthPassword(event.target.value); setAuthError(""); }}
                  required
                  minLength={6}
                />
                <button
                  className="xp-password-toggle"
                  type="button"
                  onClick={() => setShowAuthPassword(value => !value)}
                  aria-label={showAuthPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                >
                  {showAuthPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {registering && (
                <>
                  <label className="xp-confirm-label" htmlFor="xp-confirm-password">Konfirmasi kata sandi</label>
                  <div className="xp-login-input-wrap">
                    <LockKeyhole size={16} aria-hidden="true" />
                    <input
                      id="xp-confirm-password"
                      type={showAuthPassword ? "text" : "password"}
                      name="confirm-password"
                      autoComplete="new-password"
                      placeholder="Ulangi kata sandi"
                      value={authConfirmPassword}
                      onChange={event => { setAuthConfirmPassword(event.target.value); setAuthError(""); }}
                      required
                      minLength={6}
                    />
                  </div>
                </>
              )}

              {authNotice && <div className="xp-login-notice" role="status"><Check size={15} />{authNotice}</div>}
              {authError && <div className="xp-login-error" role="alert"><CircleHelp size={15} />{authError}</div>}

              <button className="xp-login-submit" type="submit">
                {registering ? "Daftar demo" : "Masuk ke portal"} {registering ? <UserPlus size={16} /> : <LogIn size={16} />}
              </button>
            </form>

            <div className="xp-login-foot">
              <LockKeyhole size={13} />
              <span>Kata sandi hanya digunakan di sesi pratinjau ini; tidak dikirim atau disimpan.</span>
            </div>
            <div className="xp-auth-switch">
              <span>{registering ? "Sudah punya akun?" : "Developer baru?"}</span>
              <button type="button" onClick={() => switchAuthMode(registering ? "login" : "register")}>
                {registering ? "Masuk" : "Daftar dulu"}
              </button>
            </div>
          </section>
        </main>

        <footer className="xp-auth-footer">
          <a className="xp-footer-brand" href="#login"><IconMark /> xclip</a>
          <span>PORTAL DEVELOPER · PRATINJAU LOGIN</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="xp-portal">
      <header className="xp-topbar">
        <a className="xp-brand" href="#home" aria-label="Xclip Developer Portal">
          <IconMark />
          <span className="xp-brand-name">xclip<span> / developers</span></span>
        </a>
        <nav className="xp-top-links" aria-label="Navigasi utama">
          <a href="#model">Model</a>
          <a href="#dokumentasi">Dokumentasi</a>
          <a href="#akses">Akses & paket</a>
          <a href="#topup">Top up</a>
        </nav>
        <a className="xp-generator-link" href="#generator" onClick={() => setNotice("Tautan generator aplikasi ditampilkan sebagai prototipe.")}>
          <ArrowLeft size={15} /> Ke generator <ExternalLink size={13} />
        </a>
        <button className="xp-signout" onClick={() => { setIsAuthenticated(false); setAuthPassword(""); setAuthError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          Keluar
        </button>
      </header>

      <nav className="xp-mobile-menu" aria-label="Menu developer">
        <a href="#model">Model</a>
        <a href="#dokumentasi">Dokumentasi</a>
        <a href="#akses">Akses & paket</a>
        <a href="#topup">Top up</a>
      </nav>

      <div className="xp-demo-banner">
        <span className="xp-demo-pip" />
        <strong>MODE DEMO</strong>
        <span>Semua data dan aksi di portal ini hanya simulasi lokal — tidak ada request API atau perubahan akun.</span>
      </div>

      <main id="home" className="xp-main">
        <section className="xp-intro">
          <div className="xp-eyebrow"><span>PORTAL DEVELOPER</span><i /> API VIDEO XCLIP</div>
          <div className="xp-intro-row">
            <div>
              <h1>Mulai bangun<br /><em>dengan video AI.</em></h1>
              <p className="xp-lede">Satu kunci, dua endpoint, dan langkah pertama yang jelas. Hubungkan Xclip ke aplikasi Anda tanpa perlu menelusuri generator.</p>
            </div>
            <div className="xp-intro-aside">
              <div className="xp-aside-icon"><Code2 size={19} /></div>
              <span>DIRANCANG UNTUK INTEGRASI</span>
              <p>Gunakan akses Xclip yang sudah Anda miliki. Tidak ada paket API terpisah.</p>
              <a href="#dokumentasi">Lihat quickstart <ArrowDownRight size={14} /></a>
            </div>
          </div>
          <div className="xp-step-line" aria-label="Alur mulai">
            <span><b>01</b> Buat kunci</span><i />
            <span><b>02</b> Kirim request</span><i />
            <span><b>03</b> Cek status tugas</span>
          </div>
        </section>

        {notice && <div className="xp-toast" role="status"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Tutup pemberitahuan"><X size={15} /></button></div>}

        <section className="xp-overview" aria-label="Ringkasan akses">
          <div className="xp-overview-title"><span className="xp-overview-icon"><Activity size={17} /></span><span>AKTIVITAS PORTAL</span></div>
          <div className="xp-overview-number">1.248</div>
          <div className="xp-overview-caption">total request demo</div>
          <div className="xp-overview-foot"><span className="xp-green-dot" />Hitungan contoh, bukan penggunaan akun</div>
        </section>

        <section className="xp-key-section" id="kunci">
          <div className="xp-section-heading">
            <div><span className="xp-kicker">01 / KREDENSIAL</span><h2>API key Anda</h2></div>
            <span className="xp-single-rule"><LockKeyhole size={14} /> Satu kunci seumur hidup</span>
          </div>
          <div className="xp-key-card">
            {apiKey ? (
              <>
                <div className="xp-key-top">
                  <div className="xp-key-identity"><div className="xp-key-symbol"><KeyRound size={19} /></div><div><div className="xp-key-label">{apiKey.label}</div><div className="xp-key-sub"><span className="xp-status-dot" /> Aktif <i /> Dibuat {apiKey.created}</div></div></div>
                  <span className="xp-key-badge"><ShieldCheck size={13} /> KEY AKTIF</span>
                </div>
                <div className="xp-key-value-row">
                  <code>{keyVisible ? apiKey.value.replace("••••••••••••", "d4e9c210be73") : apiKey.value}</code>
                  <button className="xp-icon-button" onClick={() => setKeyVisible(!keyVisible)} aria-label={keyVisible ? "Sembunyikan API key" : "Tampilkan API key"} title={keyVisible ? "Sembunyikan" : "Tampilkan"}>{keyVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  <button className="xp-copy-button" onClick={() => announceCopy(apiKey.value.replace("••••••••••••", "d4e9c210be73"), "key")}><Copy size={15} />{copied === "key" ? "Tersalin" : "Salin key"}</button>
                </div>
                <div className="xp-key-bottom">
                  <p><LockKeyhole size={14} /> Simpan key dengan aman. Jangan letakkan di kode sisi klien.</p>
                  <button className="xp-revoke-link" onClick={() => setConfirmRevoke(true)}>Nonaktifkan key</button>
                </div>
              </>
            ) : (
              <div className="xp-empty-key">
                <div className="xp-empty-icon"><KeyRound size={21} /></div>
                <div className="xp-empty-copy"><h3>{keySpent ? "Tidak ada API key aktif" : "Mulai dengan satu API key"}</h3><p>{keySpent ? "Kunci yang dinonaktifkan tidak dapat dibuat ulang. Satu kunci diperbolehkan seumur hidup." : "Buat satu kunci untuk mulai menghubungkan aplikasi Anda."}</p></div>
                {keySpent
                  ? <span className="xp-retired-badge">BATAS SEUMUR HIDUP TERCAPAI</span>
                  : <div className="xp-create-control"><input value={keyLabel} onChange={e => setKeyLabel(e.target.value)} aria-label="Nama API key" placeholder="Nama kunci (opsional)" /><button className="xp-primary-button" onClick={createKey}><KeyRound size={15} /> Buat API key</button></div>}
              </div>
            )}
            {error && <div className="xp-inline-error" role="alert"><CircleHelp size={15} />{error}<button onClick={() => setError("")} aria-label="Tutup pesan"><X size={14} /></button></div>}
            {confirmRevoke && apiKey && (
              <div className="xp-confirm">
                <div><strong>Nonaktifkan API key ini?</strong><p>Tindakan ini permanen. Anda tidak akan dapat membuat key pengganti.</p></div>
                <div className="xp-confirm-actions"><button onClick={() => setConfirmRevoke(false)}>Batal</button><button className="xp-danger-button" onClick={revokeKey}>Ya, nonaktifkan</button></div>
              </div>
            )}
            <div className="xp-key-footnote"><span>i</span> Maksimal satu API key per pengguna, termasuk setelah dinonaktifkan.</div>
          </div>
        </section>

        <section className="xp-model-section" id="model" aria-labelledby="model-heading">
          <div className="xp-section-heading">
            <div><span className="xp-kicker">KATALOG / VIDEO</span><h2 id="model-heading">Model video</h2></div>
          </div>
          <article className="xp-model-card">
            <div className="xp-model-title">
              <div><span className="xp-model-category">VIDEO · UNCENSORED</span><h3>Wan 3.0 Uncensored</h3></div>
              <span className="xp-model-status">Segera tersedia</span>
            </div>
            <p>Model video dalam katalog Xclip. Belum aktif untuk request API; parameter integrasi akan ditampilkan saat model tersedia.</p>
          </article>
        </section>

        <section className="xp-docs-section" id="dokumentasi">
          <div className="xp-section-heading xp-doc-heading">
            <div><span className="xp-kicker">02 / QUICKSTART</span><h2>Request pertama Anda</h2></div>
            <span className="xp-doc-meta"><BookOpen size={15} /> REST · JSON</span>
          </div>
          <div className="xp-doc-layout">
            <aside className="xp-doc-nav">
              <span className="xp-nav-caption">ENDPOINT</span>
              <button className={docTab === "generate" ? "active" : ""} onClick={() => setDocTab("generate")}><span className="xp-method post">POST</span><span>Generate video</span></button>
              <button className={docTab === "status" ? "active" : ""} onClick={() => setDocTab("status")}><span className="xp-method get">GET</span><span>Status tugas</span></button>
              <div className="xp-doc-nav-note"><span className="xp-nav-lock"><LockKeyhole size={14} /></span><p>Kedua endpoint memakai header <code>X-Xclip-Key</code>.</p></div>
            </aside>
            <article className="xp-endpoint">
              <div className="xp-endpoint-head">
                <span className={`xp-method ${docTab === "generate" ? "post" : "get"}`}>{docTab === "generate" ? "POST" : "GET"}</span>
                <code>{docTab === "generate" ? "/api/videogen/proxy" : "/api/videogen/tasks/:taskId"}</code>
                <button onClick={() => announceCopy(activeCurl, "endpoint")} className="xp-copy-inline"><Copy size={14} />{copied === "endpoint" ? "Tersalin" : "Salin cURL"}</button>
              </div>
              <p className="xp-endpoint-desc">{docTab === "generate" ? "Kirim instruksi video dan parameter model untuk memulai proses generasi." : "Ambil status terbaru tugas menggunakan ID yang diterima dari request generasi."}</p>
              {docTab === "generate" ? (
                <div className="xp-parameter-box">
                  <div className="xp-param-title"><span>BODY · APPLICATION/JSON</span><button onClick={() => setShowPayload(!showPayload)}>{showPayload ? "Sembunyikan" : "Tampilkan"} <ChevronDown size={13} className={showPayload ? "xp-chevron-up" : ""} /></button></div>
                  {showPayload && <div className="xp-param-grid">
                    <div><code>model</code><span>string</span><p>Model video yang digunakan.</p></div>
                    <div><code>image</code><span>string</span><p>Gambar dalam format Base64 atau data URI.</p></div>
                    <div><code>prompt</code><span>string</span><p>Deskripsi video yang diinginkan.</p></div>
                    <div><code>duration</code><span>number</span><p>Durasi video.</p></div>
                    <div><code>aspectRatio</code><span>string</span><p>Rasio aspek, mis. <code>"16:9"</code>.</p></div>
                  </div>}
                </div>
              ) : (
                <div className="xp-status-note"><RefreshCw size={15} /><span>Ganti <code>:taskId</code> dengan ID tugas dari hasil request generate. Endpoint ini hanya untuk pemeriksaan status.</span></div>
              )}
              <div className="xp-code-window">
                <div className="xp-code-title"><span><Terminal size={14} /> CONTOH cURL</span><span className="xp-lang-tag">SHELL</span></div>
                <pre><code>{activeCurl}</code></pre>
                <div className="xp-code-foot"><span><ShieldCheck size={13} /> Placeholder saja — ganti dengan nilai Anda</span><button onClick={() => announceCopy(activeCurl, "curl")}><Clipboard size={14} />{copied === "curl" ? "Tersalin" : "Salin cURL"}</button></div>
              </div>
              <div className="xp-header-tip"><span className="xp-tip-icon"><KeyRound size={14} /></span><span>Header autentikasi</span><code>X-Xclip-Key: &lt;API_KEY_ANDA&gt;</code></div>
            </article>
          </div>
        </section>

        <section className="xp-access-section" id="akses">
          <div className="xp-section-heading">
            <div><span className="xp-kicker">03 / AKSES</span><h2>Akses mengikuti akun Xclip</h2></div>
          </div>
          <div className="xp-access-card">
            <div className="xp-access-main"><div className="xp-access-icon"><Sparkles size={18} /></div><div><span className="xp-access-label">PAKET SAAT INI</span><h3>Langganan Xclip Anda</h3><p>Akses API mengikuti paket dan status langganan yang sudah terhubung ke akun Xclip Anda.</p></div></div>
            <div className="xp-access-divider" />
            <div className="xp-access-side"><span><Check size={14} /> Tidak ada harga API terpisah</span><span><Check size={14} /> Tidak ada kuota baru di portal ini</span><a href="#generator" onClick={() => setNotice("Aksi ke generator Xclip — tautan aplikasi dalam prototipe.")}>Lihat akun di Xclip <ArrowUpRight size={14} /></a></div>
          </div>
          <aside
            role="note"
            aria-label="Layanan Xclip"
            style={{
              marginTop: 14,
              padding: "16px 18px",
              border: "1px solid rgba(37, 94, 73, 0.18)",
              borderRadius: 13,
              background: "rgba(37, 94, 73, 0.055)",
            }}
          >
            <div style={{ marginBottom: 5, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "#526b5e" }}>
              LAYANAN XCLIP
            </div>
            <h3 style={{ margin: "0 0 5px", fontSize: 15, fontWeight: 650, color: "#202a25" }}>
              Generasi dikelola oleh Xclip
            </h3>
            <p style={{ maxWidth: 820, margin: 0, fontSize: 13, lineHeight: 1.6, color: "#5c6c63" }}>
              Aplikasi Anda cukup memakai API key Xclip. Proses generasi dan hasil video diakses melalui layanan Xclip, tanpa pengaturan layanan lain di sisi pengguna.
            </p>
          </aside>
        </section>

        <section className="xp-topup-section" id="topup">
          <div className="xp-section-heading">
            <div><span className="xp-kicker">04 / SALDO</span><h2>Top up akun Xclip</h2></div>
          </div>
          <div className="xp-topup-card">
            <div className="xp-topup-main">
              <div className="xp-topup-icon"><Wallet size={19} /></div>
              <div>
                <span className="xp-access-label">TOP UP AKUN</span>
                <h3>Isi saldo melalui Xclip</h3>
                <p>Top up dikelola lewat akun Xclip Anda. Portal ini tidak membuat saldo API terpisah atau menampilkan nilai saldo yang belum terhubung.</p>
              </div>
            </div>
            <div className="xp-topup-action">
              <span><LockKeyhole size={13} /> Pembayaran tetap di akun Xclip</span>
              <button onClick={() => setNotice("Menu top up Xclip ditampilkan sebagai pratinjau. Pembayaran belum tersambung.")}>
                Buka menu top up <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        </section>

        <section className="xp-bottom-cta" id="generator">
          <div className="xp-cta-mark"><Video size={20} /></div>
          <div><span>SUDAH SIAP MENCOBA?</span><h2>Lanjutkan di generator Xclip.</h2><p>Gunakan aplikasi generator seperti biasa. Portal ini hanya untuk integrasi developer.</p></div>
          <button onClick={() => setNotice("Generator Xclip terbuka melalui tautan prototipe.")}>Buka generator <ArrowRight size={16} /></button>
        </section>

        <footer className="xp-footer"><a className="xp-footer-brand" href="#home"><IconMark /> xclip</a><span>PORTAL DEVELOPER · PROTOTIPE</span><button onClick={() => setNotice("Bantuan dokumentasi belum terhubung pada prototipe.")}><CircleHelp size={14} /> Bantuan</button></footer>
      </main>
    </div>
  );
}
