// Deliberately allowlist fields; never serialize Error, request, headers, or provider payloads.
const reasons = new Set(['internal_error','database_error','database_parameter_type_conflict',
  'database_column_missing','database_table_missing','database_constraint_violation',
  'database_timeout','database_deadlock','upstream_auth_failed','upstream_forbidden',
  'upstream_rate_limited','upstream_request_rejected','upstream_unavailable',
  'upstream_network_error','upstream_timeout','upstream_response_invalid',
  'upstream_generation_failed','upstream_insufficient_credits','upstream_content_rejected',
  'request_rejected','wallet_not_ready','generation_credentials_missing',
  'generation_workspace_ambiguous','generation_project_ambiguous',
  'generation_model_unavailable','generation_parameter_unsupported']);
const databaseCodes = {
  '42P08':'database_parameter_type_conflict','42703':'database_column_missing',
  '42P01':'database_table_missing','23503':'database_constraint_violation',
  '23514':'database_constraint_violation','23505':'database_constraint_violation',
  '57014':'database_timeout','40P01':'database_deadlock',
};
const networkCodes = new Set(['ETIMEDOUT','ECONNABORTED','ECONNRESET','ECONNREFUSED',
  'ENOTFOUND','EAI_AGAIN','ERR_NETWORK','ERR_BAD_RESPONSE','ERR_BAD_REQUEST']);
const isDatabaseCode = code => /^(?:[0-9]{2}|XX|P0)[0-9A-Z]{3}$/.test(code || '');
const messages = {
  database_parameter_type_conflict:'Tipe parameter SQL tidak konsisten.',
  database_column_missing:'Kolom database belum tersedia.',
  database_table_missing:'Tabel database belum tersedia.',
  database_constraint_violation:'Aturan integritas database menolak perubahan.',
  database_timeout:'Query database melewati batas waktu.',
  database_deadlock:'Transaksi database mengalami deadlock.',
  database_error:'Database menolak operasi; lihat code dan stage.',
  upstream_auth_failed:'Autentikasi layanan generasi ditolak.',
  upstream_forbidden:'Akun layanan generasi tidak memiliki izin.',
  upstream_rate_limited:'Layanan generasi membatasi jumlah request.',
  upstream_request_rejected:'Layanan generasi menolak parameter request.',
  upstream_unavailable:'Server layanan generasi sedang gagal.',
  upstream_network_error:'Koneksi ke layanan generasi gagal.',
  upstream_timeout:'Layanan generasi melewati batas waktu.',
  upstream_response_invalid:'Respons layanan generasi tidak sesuai kontrak.',
  upstream_generation_failed:'Layanan menyatakan generasi video gagal.',
  upstream_insufficient_credits:'Kredit/kuota akun layanan generasi tidak cukup.',
  upstream_content_rejected:'Layanan generasi menolak konten.',
  wallet_not_ready:'Penyimpanan saldo API belum siap.',
  request_rejected:'Request ditolak; lihat httpStatus dan stage.',
  internal_error:'Kesalahan internal; lihat stage dan code.',
  generation_credentials_missing:'Tidak ada kredensial layanan generasi yang aktif.',
  generation_workspace_ambiguous:'Workspace generasi belum dapat ditentukan dengan aman.',
  generation_project_ambiguous:'Project generasi belum dapat ditentukan dengan aman.',
  generation_model_unavailable:'Model/kemampuan yang diminta tidak tersedia di katalog.',
  generation_parameter_unsupported:'Parameter generasi tidak didukung oleh katalog.',
};
function describeError(error) {
  const code = isDatabaseCode(error?.code)
    ? error.code : networkCodes.has(error?.code) ? error.code : undefined;
  const reason = databaseCodes[code] || (reasons.has(error?.diagnostic?.reason)
    ? error.diagnostic.reason : isDatabaseCode(code)
      ? 'database_error' : Number.isInteger(error?.status) && error.status < 500
        ? 'request_rejected' : 'internal_error');
  return { reason, code, upstreamStatus:error?.diagnostic?.upstreamStatus };
}
function createGenerationLogger({ write = (level, record) =>
  console[level]('[XCLIP_GENERATION] '+JSON.stringify(record)) } = {}) {
  function emit(level, event, fields = {}) {
    if (!/^[a-z_]{1,50}$/.test(event)) return;
    const record = { time:new Date().toISOString(),level,event };
    if (/^(?:xv_[a-f0-9]{64}|xmc_[a-f0-9]{32})$/.test(fields.taskId || '')) record.taskId=fields.taskId;
    if (/^[a-f0-9-]{36}$/.test(fields.requestId || '')) record.requestId=fields.requestId;
    if (/^[a-z_]{1,40}$/.test(fields.stage || '')) record.stage=fields.stage;
    if (reasons.has(fields.reason)) {
      record.reason=fields.reason;record.message=messages[fields.reason];
    }
    if (isDatabaseCode(fields.code) ||
        networkCodes.has(fields.code)) record.code=fields.code;
    if (['pending','processing','completed','failed'].includes(fields.status)) record.status=fields.status;
    if (['wallet','legacy'].includes(fields.billing)) record.billing=fields.billing;
    if (['held','spent','refunded'].includes(fields.walletState)) record.walletState=fields.walletState;
    for (const key of ['httpStatus','upstreamStatus']) {
      if (Number.isInteger(fields[key]) && fields[key]>=100 && fields[key]<=599) record[key]=fields[key];
    }
    for (const key of ['elapsedMs','ageSeconds','checkedTasks','failedChecks','amount','duration']) {
      if (Number.isSafeInteger(fields[key]) && fields[key]>=0) record[key]=fields[key];
    }
    if (typeof fields.progress==='number' && Number.isFinite(fields.progress) &&
        fields.progress>=0 && fields.progress<=100) record.progress=fields.progress;
    try { write(level,record); } catch { /* Logging must not interrupt a paid transaction. */ }
  }
  return { info:(event,fields)=>emit('info',event,fields),
    warn:(event,fields)=>emit('warn',event,fields),error:(event,fields)=>emit('error',event,fields) };
}
module.exports={createGenerationLogger,describeError};
