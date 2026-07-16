import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4182';
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

assert.ok(supabaseUrl && serviceKey, 'Supabase integration variables are required.');

const serviceHeaders = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
};
const createdUserIds = [];
let verificationError = null;

async function jsonResponse(response, label) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label} failed: HTTP ${response.status} ${payload.error || payload.message || ''}`.trim());
  return payload;
}

async function signupAccount(label) {
  const username = `isolate_${crypto.randomBytes(5).toString('hex')}`;
  const response = await fetch(`${baseUrl}/api/username-auth?action=signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, displayName: `격리 점검 ${label}`, password: `Verify9-${crypto.randomUUID()}` }),
  });
  const account = await jsonResponse(response, `signup ${label}`);
  assert.match(account.user?.id || '', /^[0-9a-f-]{36}$/i);
  assert.ok(account.access_token);
  createdUserIds.push(account.user.id);
  return { id: account.user.id, token: account.access_token };
}

async function writeSnapshot(account, marker) {
  return jsonResponse(await fetch(`${baseUrl}/api/study-data`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, data: { isolationMarker: marker, learningHistory: [{ marker }] } }),
  }), `write ${marker}`);
}

async function readSnapshot(account, label) {
  return jsonResponse(await fetch(`${baseUrl}/api/study-data`, {
    headers: { authorization: `Bearer ${account.token}` },
    cache: 'no-store',
  }), `read ${label}`);
}

async function deleteAll(table, filter) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: 'DELETE', headers: { ...serviceHeaders, prefer: 'return=minimal' },
  });
  if (!response.ok) throw new Error(`cleanup ${table} failed: HTTP ${response.status}`);
}

async function countRows(table) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, {
    method: 'HEAD', headers: { ...serviceHeaders, prefer: 'count=exact' },
  });
  if (!response.ok) throw new Error(`count ${table} failed: HTTP ${response.status}`);
  return Number((response.headers.get('content-range') || '/0').split('/').pop()) || 0;
}

try {
  const [accountA, accountB] = await Promise.all([signupAccount('A'), signupAccount('B')]);
  const markerA = `ACCOUNT_A_${crypto.randomUUID()}`;
  const markerB = `ACCOUNT_B_${crypto.randomUUID()}`;

  await Promise.all([writeSnapshot(accountA, markerA), writeSnapshot(accountB, markerB)]);
  const [snapshotA, snapshotB] = await Promise.all([readSnapshot(accountA, 'A'), readSnapshot(accountB, 'B')]);

  assert.equal(snapshotA.snapshot?.data?.isolationMarker, markerA);
  assert.equal(snapshotB.snapshot?.data?.isolationMarker, markerB);
  assert.notEqual(snapshotA.snapshot?.data?.isolationMarker, snapshotB.snapshot?.data?.isolationMarker);
} catch (error) {
  verificationError = error;
} finally {
  for (const userId of createdUserIds) {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE', headers: serviceHeaders, body: JSON.stringify({ should_soft_delete: false }),
    });
    if (!response.ok && !verificationError) verificationError = new Error(`cleanup auth user failed: HTTP ${response.status}`);
  }
  await deleteAll('error_events', 'id=not.is.null').catch((error) => { verificationError ||= error; });
  await deleteAll('rate_limit_windows', 'request_count=gte.0').catch((error) => { verificationError ||= error; });
}

const tables = ['profiles', 'account_recovery', 'study_snapshots', 'daily_ai_usage', 'ai_usage_events', 'analysis_reports', 'error_events', 'rate_limit_windows'];
const remaining = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await countRows(table)])));
const authPayload = await jsonResponse(await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
  headers: serviceHeaders,
}), 'final auth audit');
remaining.authUsers = authPayload.users?.length || 0;

if (verificationError) throw verificationError;
assert.deepEqual(remaining, Object.fromEntries(Object.keys(remaining).map((key) => [key, 0])));
console.log(JSON.stringify({ accountIsolation: 'passed', cleanup: 'passed', remaining }));
