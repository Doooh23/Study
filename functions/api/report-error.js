import { json, options, parseJson } from './_shared.js';
import { authorizeRequest, recordClientError } from './_platform.js';

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  const auth = await authorizeRequest(request, env, 'client-error', { burstLimit: 12, windowSeconds: 60 });
  if (!auth.ok) return json({ ok: false, error: auth.error, message: auth.message }, auth.status, auth.retryAfter ? { 'retry-after': String(auth.retryAfter) } : {});
  try {
    const payload = await parseJson(request, 20_000);
    await recordClientError(env, auth.user.id, payload);
    return json({ ok: true }, 202);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Client error ingest failed', error: error?.message }));
    return json({ ok: false, error: 'ERROR_REPORT_FAILED', message: '오류 보고를 저장하지 못했습니다.' }, 500);
  }
}
