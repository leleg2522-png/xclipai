import { useState } from "react";
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
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Video,
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

  return (
    <div className="xp-portal">
      <header className="xp-topbar">
        <a className="xp-brand" href="#home" aria-label="Xclip Developer Portal">
          <IconMark />
          <span className="xp-brand-name">xclip<span> / developers</span></span>
        </a>
        <nav className="xp-top-links" aria-label="Navigasi utama">
          <a href="#dokumentasi">Dokumentasi</a>
          <a href="#akses">Akses & paket</a>
        </nav>
        <a className="xp-generator-link" href="#generator" onClick={() => setNotice("Tautan generator aplikasi ditampilkan sebagai prototipe.")}>
          <ArrowLeft size={15} /> Ke generator <ExternalLink size={13} />
        </a>
      </header>

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
