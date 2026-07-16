import { json, options } from './_shared.js';
import { adminMetrics, authorizeRequest, requireAdmin } from './_platform.js';

export const onRequestOptions = () => options();

export async function onRequestGet({ request, env }) {
  const rate = await authorizeRequest(request, env, 'admin-metrics', { burstLimit: 30, windowSeconds: 60 });
  if (!rate.ok) return json({ ok: false, error: rate.error, message: rate.message }, rate.status, rate.retryAfter ? { 'retry-after': String(rate.retryAfter) } : {});
  const auth = await requireAdmin(request, env, rate);
  if (!auth.ok) return json({ ok: false, error: auth.error, message: auth.message }, auth.status);
  try {
    const days = Number(new URL(request.url).searchParams.get('days')) || 30;
    return json({ ok: true, metrics: await adminMetrics(env, days) });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Admin metrics failed', userId: auth.user.id, error: error?.message }));
    return json({ ok: false, error: 'ADMIN_METRICS_FAILED', message: '관리자 지표를 불러오지 못했습니다.' }, 500);
  }
}
