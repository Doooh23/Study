import { authFetch } from './auth.js';

export async function apiFetch(input, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await authFetch(input, { ...init, headers });
  const url = String(input);
  if (response.ok && /\/(analyze-problem|evaluate-analysis|generate-problems|enrich-word|recognize-problem|create-report)$/.test(url.split('?')[0])) {
    document.dispatchEvent(new CustomEvent('eon:ai-used'));
  }
  return response;
}
