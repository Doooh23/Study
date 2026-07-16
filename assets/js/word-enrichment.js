import { apiFetch } from './api-client.js';

const API_ENDPOINT = '/api/enrich-word';

const clean = (value, max) => String(value || '').trim().slice(0, max);

export function normalizeEnrichedWord(value = {}) {
  const senses = Array.isArray(value.senses) ? value.senses : Array.isArray(value.meanings) ? value.meanings : [];
  const normalizedSenses = senses.slice(0, 4).map((sense) => ({
    meaning: clean(sense?.meaning || sense?.label || sense, 220),
    contextMeaning: clean(sense?.contextMeaning || sense?.context || sense?.meaning, 260),
    usage: clean(sense?.usage || sense?.note || '', 180),
    note: clean(sense?.note || sense?.usage || '', 180),
  })).filter((sense) => sense.meaning || sense.contextMeaning || sense.usage || sense.note);
  const examples = Array.isArray(value.examples) ? value.examples.slice(0, 4).map((example) => ({
    sentence: clean(example?.sentence, 500),
    translation: clean(example?.translation, 500),
    focus: clean(example?.focus, 200),
  })).filter((example) => example.sentence && example.translation) : [];
  const word = {
    word: clean(value.word, 60).toLowerCase(),
    lemma: clean(value.lemma, 60).toLowerCase(),
    pronunciation: clean(value.pronunciation, 100),
    partOfSpeech: clean(value.partOfSpeech, 80),
    meaning: clean(value.meaning, 300),
    contextMeaning: clean(value.contextMeaning, 400),
    difficulty: Math.min(5, Math.max(1, Number(value.difficulty) || 1)),
    senses: normalizedSenses.length ? normalizedSenses : ((clean(value.meaning, 300) || clean(value.contextMeaning, 400)) ? [{
      meaning: clean(value.meaning, 220),
      contextMeaning: clean(value.contextMeaning, 260),
      usage: '',
      note: '',
    }] : []),
    examples,
    learningTip: clean(value.learningTip, 500),
    enrichmentStatus: examples.length >= 3 ? 'complete' : 'pending',
    enrichedAt: value.enrichedAt || new Date().toISOString(),
  };
  if (!word.word || !word.meaning || !word.contextMeaning || examples.length < 3) {
    const error = new Error('AI 단어 정리 결과에 뜻 또는 예문이 부족합니다.');
    error.code = 'INCOMPLETE_WORD';
    throw error;
  }
  return word;
}

export async function readWordResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    const routeUnavailable = response.status === 404 || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
    const error = new Error(routeUnavailable ? '단어 학습 API를 찾지 못했습니다.' : '서버가 올바른 단어 학습 응답을 반환하지 않았습니다.');
    error.code = routeUnavailable ? 'API_ROUTE_UNAVAILABLE' : 'INVALID_SERVER_RESPONSE';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload.message || `단어 정리에 실패했습니다. (HTTP ${response.status})`);
    error.code = payload.error || `HTTP_${response.status}`;
    throw error;
  }
  return payload;
}

export async function enrichWordWithAI(input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await apiFetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const payload = await readWordResponse(response);
    return normalizeEnrichedWord(payload.word);
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('AI 단어 정리 시간이 초과되었습니다. 다시 시도해 주세요.');
      timeoutError.code = 'TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
