const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function envText(env, key, max = 1000) {
  const value = env?.[key];
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function clientAddress(request) {
  return (request.headers.get('x-vercel-forwarded-for')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || request.headers.get('cf-connecting-ip')
    || 'unknown').trim().slice(0, 120);
}

export function platformConfigured(env) {
  return Boolean(envText(env, 'SUPABASE_URL') && envText(env, 'SUPABASE_ANON_KEY') && envText(env, 'SUPABASE_SERVICE_ROLE_KEY'));
}

export function publicPlatformConfig(env) {
  const url = envText(env, 'SUPABASE_URL', 500).replace(/\/$/, '');
  const anonKey = envText(env, 'SUPABASE_ANON_KEY', 3000);
  return {
    authConfigured: Boolean(url && anonKey),
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
    dailyAiLimit: Math.max(1, Math.min(500, Number(env?.DEFAULT_DAILY_AI_LIMIT) || 20)),
    maxUploadMb: Math.max(1, Math.min(25, Number(env?.MAX_UPLOAD_MB) || 12)),
    operatorName: envText(env, 'PUBLIC_OPERATOR_NAME', 120) || '홍동원 Study',
    privacyEmail: envText(env, 'PUBLIC_PRIVACY_EMAIL', 180) || 'privacy@eon.study',
    sentryDsn: envText(env, 'PUBLIC_SENTRY_DSN', 1000),
  };
}

async function supabaseFetch(env, path, { method = 'GET', body, headers = {}, useAnon = false } = {}) {
  const baseUrl = envText(env, 'SUPABASE_URL', 500).replace(/\/$/, '');
  const key = envText(env, useAnon ? 'SUPABASE_ANON_KEY' : 'SUPABASE_SERVICE_ROLE_KEY', 3000);
  if (!baseUrl || !key) throw new Error('DATABASE_NOT_CONFIGURED');
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function getAuthUser(request, env) {
  const token = bearerToken(request);
  const baseUrl = envText(env, 'SUPABASE_URL', 500).replace(/\/$/, '');
  const anonKey = envText(env, 'SUPABASE_ANON_KEY', 3000);
  if (!baseUrl || !anonKey) return { ok: false, status: 503, error: 'AUTH_NOT_CONFIGURED', message: '서버 인증 환경 변수가 설정되지 않았습니다.' };
  if (!token) return { ok: false, status: 401, error: 'AUTH_REQUIRED', message: '로그인 후 이용해 주세요.' };
  let response;
  try {
    response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Auth verification failed', error: error?.message }));
    return { ok: false, status: 503, error: 'AUTH_TEMPORARY_FAILURE', message: '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (!response.ok) return { ok: false, status: 401, error: 'SESSION_EXPIRED', message: '로그인이 만료되었습니다. 다시 로그인해 주세요.' };
  const user = await response.json().catch(() => null);
  if (!user?.id || !UUID_PATTERN.test(user.id)) return { ok: false, status: 401, error: 'INVALID_SESSION', message: '올바르지 않은 로그인 정보입니다.' };
  return { ok: true, user, token };
}

async function getProfile(env, userId) {
  const response = await supabaseFetch(env, `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,username,display_name,role,daily_ai_limit,created_at&limit=1`);
  if (!response.ok) throw new Error('PROFILE_READ_FAILED');
  return (await response.json())[0] || null;
}

export async function updateProfile(env, userId, changes) {
  const response = await supabaseFetch(env, `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: changes,
  });
  if (!response.ok) throw new Error('PROFILE_UPDATE_FAILED');
  return (await response.json())[0] || null;
}

export async function requireAdmin(request, env, verifiedAuth = null) {
  const auth = verifiedAuth?.ok ? verifiedAuth : await getAuthUser(request, env);
  if (!auth.ok) return auth;
  const profile = await getProfile(env, auth.user.id).catch(() => null);
  if (profile?.role !== 'admin') return { ok: false, status: 403, error: 'ADMIN_REQUIRED', message: '관리자 권한이 필요합니다.' };
  return { ...auth, profile };
}

async function postgresBurstLimit(env, key, limit, windowSeconds) {
  const response = await supabaseFetch(env, '/rest/v1/rpc/check_rate_limit', {
    method: 'POST',
    body: { p_key: key, p_limit: limit, p_window_seconds: windowSeconds },
  });
  if (!response.ok) throw new Error('RATE_LIMIT_RPC_FAILED');
  return response.json();
}

async function upstashBurstLimit(env, key, limit, windowSeconds) {
  const url = envText(env, 'UPSTASH_REDIS_REST_URL', 500).replace(/\/$/, '');
  const token = envText(env, 'UPSTASH_REDIS_REST_TOKEN', 2000);
  if (!url || !token) return null;
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const redisKey = `eon:rate:${key}:${window}`;
  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify([['INCR', redisKey], ['EXPIRE', redisKey, String(windowSeconds + 5), 'NX']]),
  });
  if (!response.ok) throw new Error('UPSTASH_RATE_LIMIT_FAILED');
  const result = await response.json();
  const count = Number(result?.[0]?.result) || 0;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), reset_seconds: windowSeconds };
}

export async function limitPublicRequest(request, env, scope, { burstLimit = 10, identifierLimit = burstLimit, windowSeconds = 60, identifier = '' } = {}) {
  if (!platformConfigured(env)) return { ok: false, status: 503, error: 'AUTH_NOT_CONFIGURED', message: '인증 서비스가 설정되지 않았습니다.' };
  const ip = clientAddress(request);
  const guards = [{ key: `public:${scope}:ip:${ip}`, limit: burstLimit }];
  if (identifier) guards.push({ key: `public:${scope}:identifier:${String(identifier).slice(0, 80)}`, limit: identifierLimit });
  try {
    for (const { key, limit } of guards) {
      let result;
      try {
        result = await upstashBurstLimit(env, key, limit, windowSeconds);
      } catch (error) {
        console.warn(JSON.stringify({ level: 'warn', message: 'Public auth Upstash guard unavailable; using Postgres', scope, error: error?.message }));
      }
      result = result || await postgresBurstLimit(env, key, limit, windowSeconds);
      if (!result?.allowed) {
        return { ok: false, status: 429, error: 'RATE_LIMIT', message: '인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', retryAfter: Number(result?.reset_seconds) || windowSeconds };
      }
    }
    return { ok: true };
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Public auth rate guard failed closed', scope, error: error?.message }));
    return { ok: false, status: 503, error: 'RATE_LIMIT_GUARD_FAILED', message: '요청 제한을 확인하지 못해 안전하게 인증을 중단했습니다.' };
  }
}

async function reserveDailyUsage(env, userId, feature, requestId) {
  const profile = await getProfile(env, userId);
  const defaultLimit = Math.max(1, Math.min(500, Number(env?.DEFAULT_DAILY_AI_LIMIT) || 20));
  const limit = Math.max(1, Math.min(500, Number(profile?.daily_ai_limit) || defaultLimit));
  const response = await supabaseFetch(env, '/rest/v1/rpc/reserve_ai_request', {
    method: 'POST',
    body: { p_user_id: userId, p_feature: feature, p_request_id: requestId, p_daily_limit: limit },
  });
  if (!response.ok) throw new Error('USAGE_RESERVATION_FAILED');
  return response.json();
}

export async function authorizeRequest(request, env, scope, { burstLimit = 30, windowSeconds = 60 } = {}) {
  const auth = await getAuthUser(request, env);
  if (!auth.ok) return auth;
  if (!platformConfigured(env)) return { ok: false, status: 503, error: 'DATABASE_NOT_CONFIGURED', message: '사용량 데이터베이스가 설정되지 않았습니다.' };
  const ip = clientAddress(request);
  const burstKey = `${auth.user.id}:${scope}:${ip}`;
  let burst;
  try {
    burst = await upstashBurstLimit(env, burstKey, burstLimit, windowSeconds);
  } catch (error) {
    console.warn(JSON.stringify({ level: 'warn', message: 'Upstash unavailable; falling back to Postgres rate limit', scope, error: error?.message }));
  }
  try {
    burst = burst || await postgresBurstLimit(env, burstKey, burstLimit, windowSeconds);
    if (!burst?.allowed) return { ok: false, status: 429, error: 'RATE_LIMIT', message: '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', retryAfter: Number(burst?.reset_seconds) || windowSeconds };
    return { ...auth, burst };
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Distributed request guard failed', scope, error: error?.message }));
    return { ok: false, status: 503, error: 'RATE_LIMIT_GUARD_FAILED', message: '요청 제한을 확인하지 못해 안전하게 요청을 중단했습니다.' };
  }
}

export async function authorizeAIRequest(request, env, feature, { burstLimit = 20, windowSeconds = 60 } = {}) {
  const auth = await authorizeRequest(request, env, `ai:${feature}`, { burstLimit, windowSeconds });
  if (!auth.ok) return auth;
  const requestId = crypto.randomUUID();
  try {
    const usage = await reserveDailyUsage(env, auth.user.id, feature, requestId);
    if (!usage?.allowed) return { ok: false, status: 429, error: 'DAILY_AI_LIMIT', message: `오늘의 AI 사용량 ${usage?.limit || 0}회를 모두 사용했습니다. 한국 시간 자정에 다시 이용할 수 있습니다.`, usage };
    return { ok: true, user: auth.user, requestId, usage };
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Distributed usage guard failed', feature, error: error?.message }));
    return { ok: false, status: 503, error: 'USAGE_GUARD_FAILED', message: '사용량 제한을 확인하지 못해 안전하게 요청을 중단했습니다.' };
  }
}

export function modelTokenPrices(model = '') {
  const normalized = String(model || '').replace(/^openai\//, '');
  if (/^gpt-5\.6-terra(?:$|-)/.test(normalized)) return { input: 2.5, cached: 0.25, cacheWrite: 3.125, output: 15 };
  if (/^gpt-5\.6-luna(?:$|-)/.test(normalized)) return { input: 1, cached: 0.1, cacheWrite: 1.25, output: 6 };
  if (/^gpt-5\.6(?:$|-sol(?:$|-))/.test(normalized)) return { input: 5, cached: 0.5, cacheWrite: 6.25, output: 30 };
  if (/^gpt-5\.5(?:$|-)/.test(normalized)) return { input: 5, cached: 0.5, cacheWrite: 5, output: 30 };
  if (/^gpt-5\.4-mini(?:$|-)/.test(normalized)) return { input: 0.75, cached: 0.075, cacheWrite: 0.75, output: 4.5 };
  if (/^gpt-5\.4(?:$|-)/.test(normalized)) return { input: 2.5, cached: 0.25, cacheWrite: 2.5, output: 15 };
  return { input: 0, cached: 0, cacheWrite: 0, output: 0 };
}

function usageCostMicros(env, usage = {}, model = '') {
  const defaults = modelTokenPrices(model);
  const hasInputOverride = String(env?.AI_INPUT_USD_PER_MILLION ?? '').trim() !== '';
  const hasOutputOverride = String(env?.AI_OUTPUT_USD_PER_MILLION ?? '').trim() !== '';
  const inputRate = hasInputOverride ? Math.max(0, Number(env.AI_INPUT_USD_PER_MILLION) || 0) : defaults.input;
  const outputRate = hasOutputOverride ? Math.max(0, Number(env.AI_OUTPUT_USD_PER_MILLION) || 0) : defaults.output;
  const cachedRate = hasInputOverride ? inputRate * 0.1 : defaults.cached;
  const cacheWriteRate = hasInputOverride ? inputRate * 1.25 : defaults.cacheWrite;
  const inputTokens = Number(usage.input_tokens) || 0;
  const outputTokens = Number(usage.output_tokens) || 0;
  const details = usage.input_tokens_details || {};
  const cachedTokens = Math.min(inputTokens, Math.max(0, Number(details.cached_tokens) || 0));
  const cacheWriteTokens = Math.min(inputTokens - cachedTokens, Math.max(0, Number(details.cache_write_tokens) || 0));
  const uncachedTokens = Math.max(0, inputTokens - cachedTokens - cacheWriteTokens);
  return Math.max(0, Math.round(
    uncachedTokens * inputRate
    + cachedTokens * cachedRate
    + cacheWriteTokens * cacheWriteRate
    + outputTokens * outputRate,
  ));
}

export async function finalizeAIRequest(env, reservation, result, { model = '', status = 'completed', errorCode = '' } = {}) {
  if (!reservation?.requestId || !reservation?.user?.id) return;
  const usage = result?.usage || {};
  try {
    const response = await supabaseFetch(env, '/rest/v1/rpc/finalize_ai_request', {
      method: 'POST',
      body: {
        p_user_id: reservation.user.id,
        p_request_id: reservation.requestId,
        p_model: String(model || '').slice(0, 120),
        p_input_tokens: Number(usage.input_tokens) || 0,
        p_output_tokens: Number(usage.output_tokens) || 0,
        p_cost_micros: usageCostMicros(env, usage, model),
        p_status: status,
        p_error_code: String(errorCode || '').slice(0, 120),
      },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'AI usage finalization failed', requestId: reservation.requestId, error: error?.message }));
  }
}

export async function readStudySnapshot(env, userId) {
  const response = await supabaseFetch(env, `/rest/v1/study_snapshots?user_id=eq.${encodeURIComponent(userId)}&select=data,version,updated_at&limit=1`);
  if (!response.ok) throw new Error('STUDY_DATA_READ_FAILED');
  return (await response.json())[0] || null;
}

export async function writeStudySnapshot(env, userId, data, version = 1) {
  const response = await supabaseFetch(env, '/rest/v1/study_snapshots?on_conflict=user_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: { user_id: userId, data, version, updated_at: new Date().toISOString() },
  });
  if (!response.ok) throw new Error('STUDY_DATA_WRITE_FAILED');
  return (await response.json())[0] || null;
}

export async function saveAnalysisReport(env, userId, problemId, title, report) {
  const response = await supabaseFetch(env, '/rest/v1/analysis_reports?on_conflict=user_id,problem_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      user_id: userId,
      problem_id: String(problemId || '').slice(0, 160),
      title: String(title || '홍동원 분석 리포트').slice(0, 200),
      report,
      updated_at: new Date().toISOString(),
    },
  });
  if (!response.ok) throw new Error('REPORT_SAVE_FAILED');
}

export async function accountSummary(env, userId) {
  const profile = await getProfile(env, userId);
  const response = await supabaseFetch(env, `/rest/v1/daily_ai_usage?user_id=eq.${encodeURIComponent(userId)}&usage_date=eq.${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })}&select=request_count,input_tokens,output_tokens,cost_micros&limit=1`);
  const usage = response.ok ? (await response.json())[0] || null : null;
  return { profile, usage };
}

export async function adminMetrics(env, days = 30) {
  const response = await supabaseFetch(env, '/rest/v1/rpc/admin_dashboard_metrics', {
    method: 'POST', body: { p_days: Math.max(1, Math.min(180, Number(days) || 30)) },
  });
  if (!response.ok) throw new Error('ADMIN_METRICS_FAILED');
  return response.json();
}

export async function recordClientError(env, userId, payload) {
  const response = await supabaseFetch(env, '/rest/v1/error_events', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: {
      user_id: userId || null,
      level: String(payload?.level || 'error').slice(0, 20),
      message: String(payload?.message || 'Unknown client error').slice(0, 1000),
      stack: String(payload?.stack || '').slice(0, 8000),
      route: String(payload?.route || '').slice(0, 300),
      context: payload?.context && typeof payload.context === 'object' ? payload.context : {},
    },
  });
  if (!response.ok) throw new Error('ERROR_EVENT_WRITE_FAILED');
}

export function safeFileName(value) {
  return String(value || 'upload')
    .normalize('NFKC')
    .replace(/[\\/\0\r\n<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'upload';
}

export function validateUploadBytes(bytes, mime, fileName, env) {
  if (!(bytes instanceof Uint8Array) || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime)) return { ok: false, error: 'INVALID_UPLOAD' };
  const maxBytes = Math.max(1, Math.min(25, Number(env?.MAX_UPLOAD_MB) || 12)) * 1024 * 1024;
  if (!bytes.length || bytes.length > maxBytes) return { ok: false, error: 'UPLOAD_TOO_LARGE' };
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  const isPdf = String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
  const magicMatches = (mime === 'image/jpeg' && isJpeg) || (mime === 'image/png' && isPng) || (mime === 'image/webp' && isWebp) || (mime === 'application/pdf' && isPdf);
  if (!magicMatches) return { ok: false, error: 'FILE_SIGNATURE_MISMATCH' };
  if (isPdf) {
    const sample = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 2_000_000)));
    const pageCount = (sample.match(/\/Type\s*\/Page\b/g) || []).length;
    if (pageCount > 12) return { ok: false, error: 'PDF_PAGE_LIMIT' };
    if (/\/Encrypt\b/.test(sample)) return { ok: false, error: 'ENCRYPTED_PDF' };
    if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/i.test(sample)) return { ok: false, error: 'ACTIVE_PDF_BLOCKED' };
  }
  return { ok: true, mime, bytes, fileName: safeFileName(fileName) };
}

export function validateUploadDataUrl(dataUrl, fileName, env) {
  if (typeof dataUrl !== 'string') return { ok: false, error: 'INVALID_UPLOAD' };
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return { ok: false, error: 'INVALID_UPLOAD' };
  let bytes;
  try { bytes = Uint8Array.from(atob(match[2].replace(/\s/g, '')), (char) => char.charCodeAt(0)); } catch { return { ok: false, error: 'INVALID_UPLOAD' }; }
  const result = validateUploadBytes(bytes, match[1], fileName, env);
  return result.ok ? { ...result, dataUrl } : result;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function optionalMalwareScan(env, upload) {
  const url = envText(env, 'MALWARE_SCAN_URL', 1000);
  if (!url) return { safe: true, provider: 'static-validation' };
  const token = envText(env, 'MALWARE_SCAN_TOKEN', 2000);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': upload.mime, 'x-file-name': encodeURIComponent(upload.fileName), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: upload.bytes,
  });
  if (!response.ok) throw new Error('MALWARE_SCANNER_UNAVAILABLE');
  const result = await response.json().catch(() => ({}));
  if (result.safe !== true) return { safe: false, provider: result.provider || 'external', threat: String(result.threat || 'detected').slice(0, 200) };
  return { safe: true, provider: result.provider || 'external' };
}

export async function consumePrivateUpload(env, userId, storagePath, fileName, claimedMime) {
  const path = String(storagePath || '').replace(/^\/+/, '');
  if (!path.startsWith(`${userId}/`) || path.includes('..') || path.length > 500) return { ok: false, error: 'INVALID_STORAGE_PATH' };
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  let response;
  try {
    response = await supabaseFetch(env, `/storage/v1/object/problem-uploads/${encodedPath}`);
    if (!response.ok) return { ok: false, error: 'UPLOAD_NOT_FOUND' };
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mime = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(claimedMime) ? claimedMime : response.headers.get('content-type')?.split(';')[0] || '';
    const upload = validateUploadBytes(bytes, mime, fileName, env);
    if (!upload.ok) return upload;
    const scan = await optionalMalwareScan(env, upload);
    if (!scan.safe) return { ok: false, error: 'MALWARE_DETECTED', threat: scan.threat };
    return { ...upload, dataUrl: `data:${upload.mime};base64,${bytesToBase64(upload.bytes)}`, scanProvider: scan.provider };
  } finally {
    await supabaseFetch(env, `/storage/v1/object/problem-uploads/${encodedPath}`, { method: 'DELETE' }).catch(() => null);
  }
}
