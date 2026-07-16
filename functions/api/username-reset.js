import { cleanText, json, options, parseJson } from './_shared.js';
import { limitPublicRequest } from './_platform.js';
import { normalizeUsername, resetUsernamePassword } from './_username-auth.js';

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  try {
    const body = await parseJson(request, 12_000);
    const username = normalizeUsername(cleanText(body?.username, 40));
    const guard = await limitPublicRequest(request, env, 'username-reset', { burstLimit: 12, identifierLimit: 5, windowSeconds: 900, identifier: username });
    if (!guard.ok) return json({ ok: false, error: guard.error, message: guard.message }, guard.status, guard.retryAfter ? { 'retry-after': String(guard.retryAfter) } : {});
    return json({ ok: true, ...(await resetUsernamePassword(env, {
      username,
      recoveryCode: cleanText(body?.recoveryCode, 80),
      password: String(body?.password || ''),
    })) });
  } catch (error) {
    const status = error?.status || 500;
    if (status >= 500) console.error(JSON.stringify({ level: 'error', message: 'Username recovery failed', code: error?.code, status }));
    return json({ ok: false, error: error?.code || 'PASSWORD_RESET_FAILED', message: error?.message || '비밀번호를 변경하지 못했습니다.' }, status);
  }
}
