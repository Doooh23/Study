import { cleanText, json, options, parseJson } from './_shared.js';
import { limitPublicRequest } from './_platform.js';
import { normalizeUsername, signInUsernameAccount } from './_username-auth.js';

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  try {
    const body = await parseJson(request, 10_000);
    const username = normalizeUsername(cleanText(body?.username, 40));
    const guard = await limitPublicRequest(request, env, 'username-login', { burstLimit: 30, identifierLimit: 8, windowSeconds: 60, identifier: username });
    if (!guard.ok) return json({ ok: false, error: guard.error, message: guard.message }, guard.status, guard.retryAfter ? { 'retry-after': String(guard.retryAfter) } : {});
    return json({ ok: true, ...(await signInUsernameAccount(env, username, String(body?.password || ''))) });
  } catch (error) {
    const status = error?.status || 500;
    if (status >= 500) console.error(JSON.stringify({ level: 'error', message: 'Username login failed', code: error?.code, status }));
    return json({ ok: false, error: error?.code || 'LOGIN_FAILED', message: error?.message || '로그인하지 못했습니다.' }, status);
  }
}
