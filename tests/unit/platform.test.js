import test from 'node:test';
import assert from 'node:assert/strict';
import { modelTokenPrices, safeFileName, validateUploadBytes, validateUploadDataUrl } from '../../functions/api/_platform.js';
import { imageDetailOption, requestOpenAI, resolveModel } from '../../functions/api/_shared.js';
import { normalizeRecoveryCode, normalizeUsername, validateUsername } from '../../functions/api/_username-auth.js';
import { normalizeEnrichedWord } from '../../assets/js/word-enrichment.js';

test('upload validation accepts matching image signatures', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
  const result = validateUploadBytes(jpeg, 'image/jpeg', '문제.jpg', { MAX_UPLOAD_MB: '12' });
  assert.equal(result.ok, true);
  assert.equal(result.fileName, '문제.jpg');
});

test('upload validation rejects MIME spoofing and active PDFs', () => {
  const spoofed = new TextEncoder().encode('%PDF-1.7');
  assert.equal(validateUploadBytes(spoofed, 'image/png', 'fake.png', {}).error, 'FILE_SIGNATURE_MISMATCH');

  const activePdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Page /JavaScript 2 0 R >>');
  assert.equal(validateUploadBytes(activePdf, 'application/pdf', 'active.pdf', {}).error, 'ACTIVE_PDF_BLOCKED');
});

test('data URL limits and file-name sanitization are enforced', () => {
  assert.equal(validateUploadDataUrl('data:text/html;base64,PGgxPng8L2gxPg==', 'x.html', {}).ok, false);
  assert.equal(safeFileName('../bad\0name?.pdf'), '.._bad_name_.pdf');
});

test('username accounts normalize case and reject unsafe or reserved identifiers', () => {
  assert.equal(normalizeUsername('  Study_User  '), 'study_user');
  assert.deepEqual(validateUsername('student_27'), { ok: true, username: 'student_27' });
  assert.equal(validateUsername('관리자').ok, false);
  assert.equal(validateUsername('admin').ok, false);
  assert.equal(validateUsername('abc').ok, false);
});

test('recovery codes accept grouped user input without weakening validation', () => {
  assert.equal(normalizeRecoveryCode('abcd-efgh-jklm-2345'), 'ABCDEFGHJKLM2345');
  assert.equal(normalizeRecoveryCode(' abcd efgh '), 'ABCDEFGH');
});

test('quality-first AI defaults and model-specific pricing stay aligned', () => {
  assert.equal(resolveModel({}, 'AI_OCR_MODEL', 'gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(resolveModel({ AI_OCR_MODEL: 'gpt-5.6-terra' }, 'AI_OCR_MODEL', 'gpt-5.6-sol'), 'gpt-5.6-terra');
  assert.equal(imageDetailOption('gpt-5.6-sol'), 'original');
  assert.equal(imageDetailOption('gpt-5.4-mini'), 'high');
  assert.deepEqual(modelTokenPrices('openai/gpt-5.6-sol'), { input: 5, cached: 0.5, cacheWrite: 6.25, output: 30 });
  assert.deepEqual(modelTokenPrices('gpt-5.6-terra'), { input: 2.5, cached: 0.25, cacheWrite: 3.125, output: 15 });
});

test('model availability failures fall back without keeping unsupported image detail', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (requests.length < 3) {
      return new Response(JSON.stringify({ error: { type: 'customer_verification_required', message: 'verification required' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ id: 'resp_test', status: 'completed', output_text: '{}', usage: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await requestOpenAI({
      env: { AI_API_KEY: 'test-key' },
      model: 'gpt-5.6-sol',
      label: 'test/fallback',
      maxAttempts: 1,
      body: {
        model: 'gpt-5.6-sol',
        input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'original' }] }],
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.requestedModel, 'gpt-5.6-sol');
    assert.equal(result.model, 'gpt-5.4');
    assert.equal(result.attempts, 3);
    assert.deepEqual(requests.map((body) => body.model), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.4']);
    assert.equal(requests[2].input[0].content[0].detail, 'high');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('model quota failures fall back to an available lower-cost model', async () => {
  const originalFetch = globalThis.fetch;
  const models = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    models.push(body.model);
    if (body.model !== 'gpt-5.4-mini') {
      return new Response(JSON.stringify({ error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'quota exhausted' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ id: 'resp_quota_fallback', status: 'completed', output_text: '{}', usage: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await requestOpenAI({
      env: { AI_API_KEY: 'direct-key' },
      model: 'gpt-5.6-sol',
      label: 'test/quota-fallback',
      maxAttempts: 1,
      body: { model: 'gpt-5.6-sol', input: 'test' },
    });
    assert.equal(result.ok, true);
    assert.equal(result.model, 'gpt-5.4-mini');
    assert.deepEqual(models, ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.4', 'gpt-5.4-mini']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('direct provider failures switch to AI Gateway when configured', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), model: body.model });
    if (String(url).includes('api.openai.com')) {
      return new Response(JSON.stringify({ error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'quota exhausted' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ id: 'resp_gateway_fallback', status: 'completed', output_text: '{}', usage: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await requestOpenAI({
      env: { AI_API_KEY: 'direct-key', AI_GATEWAY_API_KEY: 'gateway-key' },
      model: 'gpt-5.4-mini',
      label: 'test/provider-fallback',
      maxAttempts: 1,
      body: { model: 'gpt-5.4-mini', input: 'test' },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'gateway');
    assert.deepEqual(requests, [
      { url: 'https://api.openai.com/v1/responses', model: 'gpt-5.4-mini' },
      { url: 'https://ai-gateway.vercel.sh/v1/responses', model: 'openai/gpt-5.4-mini' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('direct provider network failures switch to AI Gateway after retry exhaustion', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('api.openai.com')) throw new TypeError('network unavailable');
    return new Response(JSON.stringify({ id: 'resp_gateway_network', status: 'completed', output_text: '{}', usage: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await requestOpenAI({
      env: { AI_API_KEY: 'direct-key', AI_GATEWAY_API_KEY: 'gateway-key' },
      model: 'gpt-5.4-mini',
      label: 'test/provider-network-fallback',
      maxAttempts: 1,
      body: { model: 'gpt-5.4-mini', input: 'test' },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'gateway');
    assert.deepEqual(urls, [
      'https://api.openai.com/v1/responses',
      'https://ai-gateway.vercel.sh/v1/responses',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('word enrichment normalization preserves multiple senses and fills legacy fallback values', () => {
  const enriched = normalizeEnrichedWord({
    word: 'choice',
    lemma: 'choice',
    pronunciation: 'tʃɔɪs',
    partOfSpeech: 'noun',
    meaning: '선택',
    contextMeaning: '문맥에서: 선택의 여지',
    senses: [
      { meaning: '선택', contextMeaning: '여러 대안 중 하나를 고르는 행위', usage: '의사결정', note: 'make a choice' },
      { meaning: '선택권', contextMeaning: '고를 수 있는 권리나 범위', usage: '제도', note: 'give a choice' },
    ],
    difficulty: 3,
    examples: [
      { sentence: 'She made a wise choice.', translation: '그녀는 현명한 선택을 했다.', focus: 'make a choice' },
      { sentence: 'Students need more choice.', translation: '학생들은 더 많은 선택권이 필요하다.', focus: 'choice' },
      { sentence: 'Choice matters.', translation: '선택은 중요하다.', focus: 'choice' },
      { sentence: 'There is no easy choice.', translation: '쉬운 선택은 없다.', focus: 'choice' },
    ],
    learningTip: '선택은 결정을 뜻한다.',
  });
  assert.equal(enriched.senses.length, 2);
  assert.equal(enriched.senses[0].meaning, '선택');
  assert.equal(enriched.senses[1].contextMeaning, '고를 수 있는 권리나 범위');
  assert.equal(enriched.examples.length, 4);
  assert.equal(enriched.meaning, '선택');
});
