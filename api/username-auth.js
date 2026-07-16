import { onRequestPost as login } from '../functions/api/username-login.js';
import { onRequestPost as reset } from '../functions/api/username-reset.js';
import { onRequestPost as signup } from '../functions/api/username-signup.js';

const handlers = { login, reset, signup };

export function POST(request) {
  const action = new URL(request.url).searchParams.get('action');
  const handler = handlers[action];
  if (!handler) {
    return new Response(JSON.stringify({ ok: false, error: 'INVALID_AUTH_ACTION', message: '올바르지 않은 인증 요청입니다.' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return handler({ request, env: process.env });
}

export const OPTIONS = () => new Response(null, {
  status: 204,
  headers: { 'cache-control': 'no-store', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' },
});
