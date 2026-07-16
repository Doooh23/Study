import { cleanText, json, options, parseJson } from './_shared.js';
import { limitPublicRequest } from './_platform.js';
import { createUsernameAccount, normalizeUsername } from './_username-auth.js';

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  try {
    const body = await parseJson(request, 12_000);
    const username = normalizeUsername(cleanText(body?.username, 40));
    const guard = await limitPublicRequest(request, env, 'username-signup', { burstLimit: 12, identifierLimit: 3, windowSeconds: 600, identifier: username });
    if (!guard.ok) return json({ ok: false, error: guard.error, message: guard.message }, guard.status, guard.retryAfter ? { 'retry-after': String(guard.retryAfter) } : {});
    const result = await createUsernameAccount(env, {
      username,
      displayName: cleanText(body?.displayName, 80),
      password: String(body?.password || ''),
    });
    return json({ ok: true, ...result }, 201);
  } catch (error) {
    const status = error?.status || 500;
    if (status >= 500) console.error(JSON.stringify({ level: 'error', message: 'Username signup failed', code: error?.code, status }));
    return json({ ok: false, error: error?.code || 'ACCOUNT_CREATE_FAILED', message: error?.message || '계정을 만들지 못했습니다.' }, status);
  }
}
