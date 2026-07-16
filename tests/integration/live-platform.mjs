import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4182';
const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

assert.ok(supabaseUrl && anonKey && serviceKey, 'Supabase integration variables are required.');

const marker = `eon-live-smoke-${crypto.randomUUID()}`;
const username = `eon_${crypto.randomBytes(6).toString('hex')}`;
const password = `Smoke9-${crypto.randomUUID()}`;
let userId = '';
let storagePath = '';
let aiRecognition = 'skipped';

const serviceHeaders = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
};

async function jsonResponse(response, label) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label} failed: HTTP ${response.status} ${payload.error || payload.message || ''}`.trim());
  return payload;
}

async function appRequest(path, token, init = {}) {
  const headers = new Headers(init.headers || {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

try {
  const signup = await jsonResponse(await appRequest('/api/username-auth?action=signup', '', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, displayName: '홍동원 통합 점검', password }),
  }), 'username signup');
  userId = signup.user?.id;
  assert.match(userId, /^[0-9a-f-]{36}$/i);
  assert.equal(signup.username, username);
  assert.match(signup.recoveryCode, /^(?:[A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);

  const duplicate = await appRequest('/api/username-auth?action=signup', '', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, displayName: '중복 계정', password }),
  });
  assert.equal(duplicate.status, 409);

  const session = await jsonResponse(await appRequest('/api/username-auth?action=login', '', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: username.toUpperCase(), password }),
  }), 'username login');
  let token = session.access_token;
  assert.ok(token && session.refresh_token);

  const changedPassword = `Changed9-${crypto.randomUUID()}`;
  const recovered = await jsonResponse(await appRequest('/api/username-auth?action=reset', '', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, recoveryCode: signup.recoveryCode, password: changedPassword }),
  }), 'recovery-code password reset');
  assert.notEqual(recovered.recoveryCode, signup.recoveryCode);
  token = recovered.access_token;
  assert.ok(token);

  const reusedRecovery = await appRequest('/api/username-auth?action=reset', '', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, recoveryCode: signup.recoveryCode, password: `Reuse9-${crypto.randomUUID()}` }),
  });
  assert.equal(reusedRecovery.status, 401);

  const changedSession = await jsonResponse(await appRequest('/api/username-auth?action=login', '', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: changedPassword }),
  }), 'login with changed password');
  token = changedSession.access_token;

  const config = await jsonResponse(await appRequest('/api/public-config', ''), 'public config');
  assert.equal(config.authConfigured, true);

  const unauthorized = await appRequest('/api/account', '');
  assert.equal(unauthorized.status, 401);

  const account = await jsonResponse(await appRequest('/api/account', token), 'account read');
  assert.equal(account.user.id, userId);
  assert.equal(account.user.username, username);
  assert.equal('email' in account.user, false);

  const profile = await jsonResponse(await appRequest('/api/account', token, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: '홍동원 실계정 점검' }),
  }), 'profile update');
  assert.equal(profile.profile.display_name, '홍동원 실계정 점검');

  await jsonResponse(await appRequest('/api/study-data', token, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, data: { integrationMarker: marker, analysisReports: [] } }),
  }), 'study data write');
  const study = await jsonResponse(await appRequest('/api/study-data', token), 'study data read');
  assert.equal(study.snapshot.data.integrationMarker, marker);

  const uploadFile = process.env.SMOKE_UPLOAD_FILE
    ? await readFile(process.env.SMOKE_UPLOAD_FILE)
    : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n7sAAAAASUVORK5CYII=', 'base64');
  const uploadMime = process.env.SMOKE_UPLOAD_FILE?.toLowerCase().endsWith('.jpg') || process.env.SMOKE_UPLOAD_FILE?.toLowerCase().endsWith('.jpeg')
    ? 'image/jpeg'
    : 'image/png';
  const uploadExtension = uploadMime === 'image/jpeg' ? 'jpg' : 'png';
  storagePath = `${userId}/${marker}.${uploadExtension}`;
  const storageUrl = `${supabaseUrl}/storage/v1/object/problem-uploads/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
  const upload = await fetch(storageUrl, {
    method: 'POST', headers: { apikey: anonKey, authorization: `Bearer ${token}`, 'content-type': uploadMime, 'x-upsert': 'false' }, body: uploadFile,
  });
  assert.ok(upload.ok, `private storage upload failed: HTTP ${upload.status}`);
  if (process.env.SMOKE_OCR === '1') {
    const recognition = await jsonResponse(await appRequest('/api/recognize-problem', token, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storagePath, fileName: `${marker}.${uploadExtension}`, mime: uploadMime }),
    }), 'AI problem recognition');
    assert.ok(recognition.problem?.passage?.length >= 20);
    assert.ok(recognition.problem?.question?.length >= 5);
    assert.equal(recognition.problem?.options?.length, 5);
    assert.equal(recognition.model?.replace(/^openai\//, ''), 'gpt-5.4-mini');
    aiRecognition = 'passed';
    storagePath = '';
  } else if (process.env.SMOKE_OCR_EXPECT_BILLING === '1') {
    const recognition = await appRequest('/api/recognize-problem', token, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storagePath, fileName: `${marker}.${uploadExtension}`, mime: uploadMime }),
    });
    const recognitionError = await recognition.json().catch(() => ({}));
    assert.equal(recognition.status, 503);
    assert.ok(['AI_BILLING_REQUIRED', 'AI_QUOTA_EXCEEDED'].includes(recognitionError.error));
    aiRecognition = 'upload-consumed-and-billing-guard-passed';
    storagePath = '';
  } else {
    const removed = await fetch(storageUrl, { method: 'DELETE', headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
    assert.ok(removed.ok, `private storage delete failed: HTTP ${removed.status}`);
    storagePath = '';
  }

  await jsonResponse(await appRequest('/api/report-error', token, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'integration smoke marker', route: marker, context: { marker } }),
  }), 'error monitoring write');

  const promoted = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH', headers: { ...serviceHeaders, prefer: 'return=minimal' }, body: JSON.stringify({ role: 'admin' }),
  });
  assert.ok(promoted.ok, `admin promotion failed: HTTP ${promoted.status}`);
  const metrics = await jsonResponse(await appRequest('/api/admin-metrics?days=30', token), 'admin metrics');
  assert.ok(Number(metrics.metrics.users) >= 1);

  let aiReport = 'skipped';
  if (process.env.SMOKE_AI === '1' || process.env.SMOKE_AI_EXPECT_BILLING === '1') {
    const reportResponse = await appRequest('/api/create-report', token, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: {
        id: marker,
        passage: 'People often assume that having more choices creates more freedom. Yet too many alternatives can increase anxiety and make meaningful commitment harder. A carefully limited set of options may therefore support genuine autonomy.',
        question: '다음 글의 요지로 가장 적절한 것은?',
        options: ['More choices always remove anxiety.', 'Limited choices can sometimes support genuine freedom.', 'Commitment prevents autonomy.', 'Comparison is the only source of confidence.', 'People should avoid every difficult decision.'],
        correctAnswer: 2, type: '요지', topic: '심리', source: '홍동원 live integration smoke',
      } }),
    });
    if (process.env.SMOKE_AI_EXPECT_BILLING === '1') {
      const error = await reportResponse.json().catch(() => ({}));
      assert.equal(reportResponse.status, 503);
      assert.ok(['AI_BILLING_REQUIRED', 'AI_QUOTA_EXCEEDED', 'AI_ACCOUNT_VERIFICATION_REQUIRED'].includes(error.error));
      aiReport = 'billing-guard-passed';
    } else {
      const report = await jsonResponse(reportResponse, 'AI report generation');
      assert.ok(report.report?.sentenceAnalysis?.length >= 1);
      assert.equal(report.report?.answerAnalysis?.correctAnswer, 2);
      aiReport = 'passed';
    }
  }

  console.log(JSON.stringify({ usernameAuth: 'passed', duplicateGuard: 'passed', recoveryRotation: 'passed', passwordChange: 'passed', database: 'passed', storage: 'passed', aiRecognition, rateGuard: 'passed', admin: 'passed', monitoring: 'passed', aiReport }));
} finally {
  if (storagePath && userId) {
    const storageUrl = `${supabaseUrl}/storage/v1/object/problem-uploads/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
    await fetch(storageUrl, { method: 'DELETE', headers: serviceHeaders }).catch(() => null);
  }
  await fetch(`${supabaseUrl}/rest/v1/error_events?route=eq.${encodeURIComponent(marker)}`, {
    method: 'DELETE', headers: { ...serviceHeaders, prefer: 'return=minimal' },
  }).catch(() => null);
  if (userId) {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: serviceHeaders }).catch(() => null);
  }
}
