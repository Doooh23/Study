import { CONFIG } from './config.js';

const SESSION_KEY = `${CONFIG.authKey}:supabase-session`;
let publicConfig = null;
let session = null;
let currentUser = null;
let refreshPromise = null;
let redirectType = '';

const clean = (value, max = 500) => String(value || '').trim().slice(0, max);

export async function loadPublicConfig() {
  if (publicConfig) return publicConfig;
  const response = await fetch('/api/public-config', { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error('PUBLIC_CONFIG_FAILED');
  publicConfig = await response.json();
  window.__EON_CONFIG__ = publicConfig;
  return publicConfig;
}

function saveSession(value) {
  session = value?.access_token && value?.refresh_token ? value : null;
  if (session?.user) currentUser = session.user;
  if (!session) currentUser = null;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Session remains in memory when browser storage is unavailable.
  }
  return session;
}

function readSession() {
  if (session) return session;
  try { return saveSession(JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')); } catch { return null; }
}

function consumeRedirectSession() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!raw || raw.startsWith('/')) return null;
  const params = new URLSearchParams(raw);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  redirectType = clean(params.get('type'), 40);
  const expiresIn = Math.max(60, Number(params.get('expires_in')) || 3600);
  const next = saveSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: params.get('token_type') || 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
  });
  const route = redirectType === 'recovery' ? 'reset-password' : 'dashboard';
  history.replaceState(null, '', `${location.pathname}${location.search}#/${route}`);
  return next;
}

function authHeaders(config, token = '') {
  return {
    apikey: config.supabaseAnonKey,
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function readAuthResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(clean(payload.msg || payload.message || payload.error_description || '인증 요청에 실패했습니다.', 500));
    error.code = clean(payload.error_code || payload.error || `HTTP_${response.status}`, 100);
    throw error;
  }
  return payload;
}

async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const config = await loadPublicConfig();
    const current = readSession();
    if (!config.authConfigured || !current?.refresh_token) return saveSession(null);
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: authHeaders(config), body: JSON.stringify({ refresh_token: current.refresh_token }),
    });
    if (!response.ok) return saveSession(null);
    return saveSession(await response.json());
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function bootstrapAuth() {
  const config = await loadPublicConfig();
  const current = consumeRedirectSession() || readSession();
  if (!config.authConfigured || !current) return null;
  const expiresAt = Number(current.expires_at || 0) * 1000;
  const active = !expiresAt || expiresAt > Date.now() + 60_000 ? current : await refreshSession();
  if (!active?.access_token) return null;
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, { headers: authHeaders(config, active.access_token) });
    if (!response.ok) {
      const refreshed = await refreshSession();
      if (!refreshed) return null;
      const retry = await fetch(`${config.supabaseUrl}/auth/v1/user`, { headers: authHeaders(config, refreshed.access_token) });
      if (!retry.ok) return saveSession(null);
      currentUser = await retry.json();
      return currentUser;
    }
    currentUser = await response.json();
    return currentUser;
  } catch {
    return null;
  }
}

async function usernameAuthRequest(path, body) {
  const config = await loadPublicConfig();
  if (!config.authConfigured) {
    const error = new Error('배포 환경에 Supabase 인증 정보가 설정되지 않았습니다.');
    error.code = 'AUTH_NOT_CONFIGURED';
    throw error;
  }
  const response = await fetch(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const payload = await readAuthResponse(response);
  saveSession(payload);
  return payload;
}

export async function signInWithUsername(username, password) {
  return usernameAuthRequest('/api/username-auth?action=login', { username: clean(username, 40), password: String(password || '') });
}

export async function signUpWithUsername({ name, username, password }) {
  return usernameAuthRequest('/api/username-auth?action=signup', {
    displayName: clean(name, 80), username: clean(username, 40), password: String(password || ''),
  });
}

export async function resetPasswordWithRecoveryCode({ username, recoveryCode, password }) {
  return usernameAuthRequest('/api/username-auth?action=reset', {
    username: clean(username, 40), recoveryCode: clean(recoveryCode, 80), password: String(password || ''),
  });
}

export async function signOut() {
  const config = await loadPublicConfig().catch(() => null);
  const current = readSession();
  if (config?.authConfigured && current?.access_token) {
    await fetch(`${config.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: authHeaders(config, current.access_token) }).catch(() => null);
  }
  saveSession(null);
}

export function getCurrentUserId() {
  return currentUser?.id || readSession()?.user?.id || '';
}

function storageObjectUrl(config, path) {
  return `${config.supabaseUrl}/storage/v1/object/problem-uploads/${path.split('/').map(encodeURIComponent).join('/')}`;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function storageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function uploadPrivateProblemFile(blob, originalName, mime) {
  const config = await loadPublicConfig();
  const token = await getAccessToken();
  const userId = getCurrentUserId();
  if (!config.authConfigured || !token || !userId) {
    const error = new Error('실제 계정으로 로그인한 뒤 파일을 업로드해 주세요.');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
  const safeName = String(originalName || 'problem').normalize('NFKC').replace(/[^A-Za-z0-9가-힣._-]+/g, '_').slice(0, 80);
  const path = `${userId}/${crypto.randomUUID()}-${safeName || 'problem'}`;
  const uploadUrl = storageObjectUrl(config, path);
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await authFetch(uploadUrl, {
        method: 'POST',
        headers: { apikey: config.supabaseAnonKey, authorization: `Bearer ${token}`, 'content-type': mime, 'x-upsert': 'false' },
        body: blob,
        signal: controller.signal,
      });
      if (response.ok) return path;

      if (response.status === 409 && attempt > 1) {
        const existing = await authFetch(uploadUrl, {
          method: 'HEAD',
          headers: { apikey: config.supabaseAnonKey, authorization: `Bearer ${token}` },
        }).catch(() => null);
        if (existing?.ok) return path;
      }

      const payload = await response.json().catch(() => ({}));
      const message = clean(payload.message || payload.error || '', 500) || `업로드 저장소가 요청을 거절했습니다. (HTTP ${response.status})`;
      lastError = storageError('PRIVATE_UPLOAD_FAILED', message);
      const retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
      if (!retryable) {
        lastError.nonRetryable = true;
        throw lastError;
      }
      if (attempt === 3) throw lastError;
    } catch (error) {
      if (error?.nonRetryable || (error?.code === 'PRIVATE_UPLOAD_FAILED' && attempt === 3)) throw error;
      const timedOut = error?.name === 'AbortError';
      lastError = storageError(
        timedOut ? 'UPLOAD_TIMEOUT' : 'UPLOAD_NETWORK_ERROR',
        timedOut
          ? '파일 전송 시간이 초과되었습니다. 네트워크 연결을 확인해 주세요.'
          : '파일 저장소와 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      );
      if (attempt === 3) throw lastError;
      console.warn('[upload] transient storage failure; retrying', { attempt, code: lastError.code });
    } finally {
      clearTimeout(timeout);
    }
    await wait(450 * (2 ** (attempt - 1)));
  }
  throw lastError || storageError('PRIVATE_UPLOAD_FAILED', '파일을 업로드하지 못했습니다.');
}

export async function deletePrivateProblemFile(path) {
  if (!path) return;
  const config = await loadPublicConfig();
  const token = await getAccessToken();
  if (!config.authConfigured || !token) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    await authFetch(storageObjectUrl(config, path), {
      method: 'DELETE',
      headers: { apikey: config.supabaseAnonKey, authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

export function hasRealSession() {
  return Boolean(readSession()?.access_token);
}

export async function getAccessToken() {
  const current = readSession();
  if (!current) return '';
  const expiresAt = Number(current.expires_at || 0) * 1000;
  const active = !expiresAt || expiresAt > Date.now() + 60_000 ? current : await refreshSession();
  return active?.access_token || '';
}

export async function authFetch(input, init = {}) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && token) {
    const refreshed = await refreshSession();
    if (refreshed?.access_token) {
      headers.set('authorization', `Bearer ${refreshed.access_token}`);
      return fetch(input, { ...init, headers });
    }
  }
  return response;
}

export async function fetchAccount() {
  const response = await authFetch('/api/account', { cache: 'no-store' });
  if (!response.ok) return null;
  return response.json();
}

export function installErrorMonitoring() {
  const report = (message, stack = '', context = {}) => {
    authFetch('/api/report-error', {
      method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ level: 'error', message: clean(message, 1000), stack: clean(stack, 8000), route: location.hash, context }),
    }).catch(() => null);
  };
  window.addEventListener('error', (event) => report(event.message, event.error?.stack, { source: event.filename, line: event.lineno, column: event.colno }));
  window.addEventListener('unhandledrejection', (event) => report(event.reason?.message || String(event.reason), event.reason?.stack, { type: 'unhandledrejection' }));
}
