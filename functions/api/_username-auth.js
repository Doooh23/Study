const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_]{3,19}$/;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'api', 'eon', 'help', 'null', 'root', 'support', 'system', 'undefined']);

function envText(env, key, max = 3000) {
  const value = env?.[key];
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function authError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function platform(env) {
  const url = envText(env, 'SUPABASE_URL', 500).replace(/\/$/, '');
  const anonKey = envText(env, 'SUPABASE_ANON_KEY');
  const serviceKey = envText(env, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) throw authError('AUTH_NOT_CONFIGURED', '인증 서비스가 설정되지 않았습니다.', 503);
  return { url, anonKey, serviceKey };
}

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

function serviceHeaders(serviceKey, body = false) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    ...(body ? { 'content-type': 'application/json' } : {}),
  };
}

export function normalizeUsername(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!USERNAME_PATTERN.test(username) || RESERVED_USERNAMES.has(username)) {
    return { ok: false, username, message: '아이디는 영문 소문자·숫자·밑줄을 사용해 4~20자로 입력해 주세요.' };
  }
  return { ok: true, username };
}

export function normalizeRecoveryCode(value) {
  return String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z2-9]/g, '');
}

function createRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte & 31]).join('');
  return raw.match(/.{1,4}/g).join('-');
}

async function recoveryHash(env, userId, code) {
  const { serviceKey } = platform(env);
  const pepper = envText(env, 'ACCOUNT_RECOVERY_PEPPER') || serviceKey;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${userId}:${normalizeRecoveryCode(code)}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}

async function findProfile(env, username) {
  const { url, serviceKey } = platform(env);
  const response = await fetch(`${url}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id,username,display_name&limit=1`, {
    headers: serviceHeaders(serviceKey),
  });
  if (!response.ok) throw authError('ACCOUNT_LOOKUP_FAILED', '계정 정보를 확인하지 못했습니다.', 503);
  return (await responseJson(response))[0] || null;
}

async function getInternalUser(env, userId) {
  const { url, serviceKey } = platform(env);
  const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: serviceHeaders(serviceKey) });
  const payload = await responseJson(response);
  if (!response.ok || !payload?.email) throw authError('INVALID_CREDENTIALS', '아이디 또는 비밀번호를 확인해 주세요.', 401);
  return payload;
}

async function passwordSession(env, email, password) {
  const { url, anonKey } = platform(env);
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = await responseJson(response);
  if (!response.ok || !payload?.access_token) throw authError('INVALID_CREDENTIALS', '아이디 또는 비밀번호를 확인해 주세요.', 401);
  if (payload.user) delete payload.user.email;
  return payload;
}

async function deleteUser(env, userId) {
  if (!userId) return;
  const { url, serviceKey } = platform(env);
  await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE', headers: serviceHeaders(serviceKey),
  }).catch(() => null);
}

export async function createUsernameAccount(env, { username: rawUsername, displayName: rawDisplayName, password }) {
  const validation = validateUsername(rawUsername);
  const displayName = String(rawDisplayName || '').normalize('NFKC').trim().slice(0, 40);
  if (!validation.ok) throw authError('INVALID_USERNAME', validation.message);
  if (!displayName) throw authError('INVALID_DISPLAY_NAME', '학습 리포트에 표시할 이름을 입력해 주세요.');
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,72}$/.test(String(password || ''))) throw authError('WEAK_PASSWORD', '영문과 숫자를 포함한 8자 이상 비밀번호가 필요합니다.');
  if (await findProfile(env, validation.username)) throw authError('USERNAME_TAKEN', '이미 사용 중인 아이디입니다.', 409);

  const { url, serviceKey } = platform(env);
  const internalEmail = `${crypto.randomUUID().replaceAll('-', '')}@accounts.eon.invalid`;
  const recoveryCode = createRecoveryCode();
  let userId = '';
  try {
    const createResponse = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST', headers: serviceHeaders(serviceKey, true),
      body: JSON.stringify({
        email: internalEmail,
        password: String(password),
        email_confirm: true,
        user_metadata: {
          name: displayName,
          username: validation.username,
          account_type: 'username',
          terms_version: '2026-07-15',
          privacy_version: '2026-07-15',
        },
      }),
    });
    const created = await responseJson(createResponse);
    if (!createResponse.ok || !created?.id) {
      const duplicate = /duplicate|unique|database error/i.test(String(created?.message || created?.msg || ''));
      throw authError(duplicate ? 'USERNAME_TAKEN' : 'ACCOUNT_CREATE_FAILED', duplicate ? '이미 사용 중인 아이디입니다.' : '계정을 만들지 못했습니다.', duplicate ? 409 : 503);
    }
    userId = created.id;
    const hash = await recoveryHash(env, userId, recoveryCode);
    const recoveryResponse = await fetch(`${url}/rest/v1/account_recovery`, {
      method: 'POST', headers: { ...serviceHeaders(serviceKey, true), prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, recovery_hash: hash }),
    });
    if (!recoveryResponse.ok) throw authError('RECOVERY_SETUP_FAILED', '복구 코드를 안전하게 설정하지 못했습니다.', 503);
    const session = await passwordSession(env, internalEmail, String(password));
    return { ...session, username: validation.username, recoveryCode };
  } catch (error) {
    await deleteUser(env, userId);
    throw error;
  }
}

export async function signInUsernameAccount(env, rawUsername, password) {
  const validation = validateUsername(rawUsername);
  if (!validation.ok || !password) throw authError('INVALID_CREDENTIALS', '아이디 또는 비밀번호를 확인해 주세요.', 401);
  const profile = await findProfile(env, validation.username);
  if (!profile) throw authError('INVALID_CREDENTIALS', '아이디 또는 비밀번호를 확인해 주세요.', 401);
  const user = await getInternalUser(env, profile.id);
  const session = await passwordSession(env, user.email, String(password));
  return { ...session, username: validation.username };
}

export async function resetUsernamePassword(env, { username: rawUsername, recoveryCode, password }) {
  const validation = validateUsername(rawUsername);
  if (!validation.ok) throw authError('INVALID_RECOVERY', '아이디 또는 복구 코드를 확인해 주세요.', 401);
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,72}$/.test(String(password || ''))) throw authError('WEAK_PASSWORD', '영문과 숫자를 포함한 8자 이상 비밀번호가 필요합니다.');
  const normalizedCode = normalizeRecoveryCode(recoveryCode);
  if (normalizedCode.length !== 32) throw authError('INVALID_RECOVERY', '아이디 또는 복구 코드를 확인해 주세요.', 401);

  const profile = await findProfile(env, validation.username);
  if (!profile) throw authError('INVALID_RECOVERY', '아이디 또는 복구 코드를 확인해 주세요.', 401);
  const { url, serviceKey } = platform(env);
  const recoveryResponse = await fetch(`${url}/rest/v1/account_recovery?user_id=eq.${encodeURIComponent(profile.id)}&select=recovery_hash&limit=1`, {
    headers: serviceHeaders(serviceKey),
  });
  const recovery = recoveryResponse.ok ? (await responseJson(recoveryResponse))[0] : null;
  const providedHash = await recoveryHash(env, profile.id, normalizedCode);
  if (!recovery?.recovery_hash || !constantTimeEqual(recovery.recovery_hash, providedHash)) {
    throw authError('INVALID_RECOVERY', '아이디 또는 복구 코드를 확인해 주세요.', 401);
  }

  const user = await getInternalUser(env, profile.id);
  const updateResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(profile.id)}`, {
    method: 'PUT', headers: serviceHeaders(serviceKey, true), body: JSON.stringify({ password: String(password) }),
  });
  if (!updateResponse.ok) throw authError('PASSWORD_RESET_FAILED', '비밀번호를 변경하지 못했습니다.', 503);

  const nextRecoveryCode = createRecoveryCode();
  const nextHash = await recoveryHash(env, profile.id, nextRecoveryCode);
  const rotateResponse = await fetch(`${url}/rest/v1/account_recovery?user_id=eq.${encodeURIComponent(profile.id)}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(serviceKey, true), prefer: 'return=minimal' },
    body: JSON.stringify({ recovery_hash: nextHash, updated_at: new Date().toISOString() }),
  });
  if (!rotateResponse.ok) throw authError('RECOVERY_ROTATION_FAILED', '새 복구 코드를 설정하지 못했습니다.', 503);
  const session = await passwordSession(env, user.email, String(password));
  return { ...session, username: validation.username, recoveryCode: nextRecoveryCode };
}
