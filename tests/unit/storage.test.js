import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.document = { dispatchEvent() {} };
globalThis.CustomEvent = class CustomEvent {
  constructor(type) { this.type = type; }
};

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
localStorage.setItem('eon-auth-v1:supabase-session', JSON.stringify({ user: { id: USER_A } }));

const { getDataOwner, loadData, saveData, setDataOwner } = await import('../../assets/js/storage.js');

test('the saved session selects its user-scoped storage during startup', () => {
  assert.equal(getDataOwner(), USER_A);
});

test('learning data is isolated by authenticated user', () => {
  localStorage.clear();

  let first = setDataOwner(USER_A);
  first.user.id = USER_A;
  first.learningHistory.push({ date: '2026-07-15', problemCount: 1 });
  saveData(first);

  let second = setDataOwner(USER_B);
  assert.equal(second.learningHistory.length, 0);
  second.user.id = USER_B;
  second.learningHistory.push({ date: '2026-07-16', problemCount: 2 });
  saveData(second);

  first = setDataOwner(USER_A);
  assert.deepEqual(first.learningHistory.map((item) => item.problemCount), [1]);
  second = setDataOwner(USER_B);
  assert.deepEqual(second.learningHistory.map((item) => item.problemCount), [2]);
});

test('legacy account data is not exposed in the unscoped preview', () => {
  localStorage.clear();
  setDataOwner('');
  localStorage.setItem('eon-study-data-v2', JSON.stringify({
    user: { id: USER_A, name: '이전 회원' },
    learningHistory: [{ date: '2026-07-15', problemCount: 9 }],
  }));

  const preview = loadData();
  assert.equal(preview.user.id, 'local_user');
  assert.equal(preview.user.name, '');
  assert.deepEqual(preview.learningHistory, []);
});
