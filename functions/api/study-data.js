import { json, options, parseJson } from './_shared.js';
import { authorizeRequest, readStudySnapshot, writeStudySnapshot } from './_platform.js';

export const onRequestOptions = () => options();

export async function onRequestGet({ request, env }) {
  const auth = await authorizeRequest(request, env, 'study-read', { burstLimit: 60, windowSeconds: 60 });
  if (!auth.ok) return json({ ok: false, error: auth.error, message: auth.message }, auth.status, auth.retryAfter ? { 'retry-after': String(auth.retryAfter) } : {});
  try {
    const snapshot = await readStudySnapshot(env, auth.user.id);
    return json({ ok: true, snapshot });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Study snapshot read failed', userId: auth.user.id, error: error?.message }));
    return json({ ok: false, error: 'STUDY_DATA_READ_FAILED', message: '서버 학습 데이터를 불러오지 못했습니다.' }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const auth = await authorizeRequest(request, env, 'study-sync', { burstLimit: 30, windowSeconds: 60 });
  if (!auth.ok) return json({ ok: false, error: auth.error, message: auth.message }, auth.status, auth.retryAfter ? { 'retry-after': String(auth.retryAfter) } : {});
  try {
    const body = await parseJson(request, 2_100_000);
    if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      return json({ ok: false, error: 'INVALID_STUDY_DATA', message: '올바른 학습 데이터가 필요합니다.' }, 400);
    }
    const serialized = JSON.stringify(body.data);
    if (serialized.length > 1_900_000) return json({ ok: false, error: 'STUDY_DATA_TOO_LARGE', message: '학습 데이터가 저장 한도를 초과했습니다.' }, 413);
    const snapshot = await writeStudySnapshot(env, auth.user.id, body.data, Math.max(1, Number(body.version) || 1));
    return json({ ok: true, snapshot });
  } catch (error) {
    const status = error.message === 'PAYLOAD_TOO_LARGE' ? 413 : error.message === 'INVALID_JSON' ? 400 : 500;
    console.error(JSON.stringify({ level: 'error', message: 'Study snapshot write failed', userId: auth.user.id, error: error?.message }));
    return json({ ok: false, error: error.message || 'STUDY_DATA_WRITE_FAILED', message: '서버 학습 데이터를 저장하지 못했습니다.' }, status);
  }
}
