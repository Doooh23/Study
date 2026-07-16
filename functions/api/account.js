import { cleanText, json, options, parseJson } from './_shared.js';
import { accountSummary, authorizeRequest, updateProfile } from './_platform.js';

export const onRequestOptions = () => options();

export async function onRequestGet({ request, env }) {
  const auth = await authorizeRequest(request, env, 'account-read', { burstLimit: 60, windowSeconds: 60 });
  if (!auth.ok) return json({ ok: false, error: auth.error, message: auth.message }, auth.status, auth.retryAfter ? { 'retry-after': String(auth.retryAfter) } : {});
  try {
    const summary = await accountSummary(env, auth.user.id);
    return json({ ok: true, user: { id: auth.user.id, ...summary.profile }, usage: summary.usage });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Account summary failed', userId: auth.user.id, error: error?.message }));
    return json({ ok: false, error: 'ACCOUNT_READ_FAILED', message: '계정 정보를 불러오지 못했습니다.' }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const auth = await authorizeRequest(request, env, 'profile-update', { burstLimit: 12, windowSeconds: 60 });
  if (!auth.ok) return json({ ok: false, error: auth.error, message: auth.message }, auth.status, auth.retryAfter ? { 'retry-after': String(auth.retryAfter) } : {});
  try {
    const body = await parseJson(request, 10_000);
    const displayName = cleanText(body?.displayName, 80);
    if (!displayName) return json({ ok: false, error: 'INVALID_PROFILE', message: '표시 이름을 입력해 주세요.' }, 400);
    return json({ ok: true, profile: await updateProfile(env, auth.user.id, { display_name: displayName, updated_at: new Date().toISOString() }) });
  } catch (error) {
    return json({ ok: false, error: 'PROFILE_UPDATE_FAILED', message: '계정 정보를 저장하지 못했습니다.' }, 500);
  }
}
