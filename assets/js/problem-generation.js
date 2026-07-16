import { normalizeQuestionType } from './config.js';
import { apiFetch } from './api-client.js';

const API_ENDPOINT = '/api/generate-problems';

const clean = (value, max) => String(value || '').trim().slice(0, max);

export function countEnglishWords(text) {
  return (String(text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
}

export function normalizeGeneratedSet(payload = {}) {
  const rawProblems = Array.isArray(payload.problems) ? payload.problems : [];
  const problems = rawProblems.map((problem, index) => {
    const passage = clean(problem?.passage, 6000);
    const options = Array.isArray(problem?.options) ? problem.options.slice(0, 5).map((item) => clean(item, 700)) : [];
    const correctAnswer = Number(problem?.correctAnswer);
    const structure = Array.isArray(problem?.structure) ? problem.structure.slice(0, 12) : [];
    const includedTargetWords = Array.isArray(problem?.includedTargetWords) ? problem.includedTargetWords.slice(0, 8).map((item) => clean(item, 60)).filter(Boolean) : [];
    return {
      ...problem,
      id: clean(problem?.id, 100) || `problem_${Date.now()}_${index}`,
      questionNumber: index + 1,
      type: normalizeQuestionType(problem?.type, ''),
      topic: clean(problem?.topic, 40),
      subtopic: clean(problem?.subtopic, 100),
      difficulty: clean(problem?.difficulty, 40),
      passage,
      passageWordCount: Number(problem?.passageWordCount) || countEnglishWords(passage),
      question: clean(problem?.question, 700),
      options,
      correctAnswer,
      explanation: clean(problem?.explanation, 2000),
      evidenceSentence: clean(problem?.evidenceSentence, 1500),
      structure,
      includedTargetWords,
    };
  });
  const valid = problems.length > 0 && problems.every((problem) => problem.passageWordCount >= 135
    && problem.options.length === 5
    && problem.options.every(Boolean)
    && problem.question
    && Number.isInteger(problem.correctAnswer)
    && problem.correctAnswer >= 1
    && problem.correctAnswer <= 5);
  if (!valid) {
    const error = new Error('생성된 문제가 실전 모의고사 분량과 문항 형식을 충족하지 못했습니다. 다시 생성해 주세요.');
    error.code = 'INCOMPLETE_GENERATION';
    throw error;
  }
  return {
    setTitle: clean(payload.setTitle, 120) || '실전 모의고사형 맞춤 문제',
    generatedAt: payload.generatedAt || new Date().toISOString(),
    mode: payload.mode || 'ai',
    problems,
  };
}

export async function readGenerationResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    const routeUnavailable = response.status === 404 || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
    const error = new Error(routeUnavailable ? '문제 생성 API를 찾지 못했습니다. 정적 서버가 아닌 Vercel 개발 서버로 실행해 주세요.' : '서버가 올바른 문제 생성 응답을 반환하지 않았습니다.');
    error.code = routeUnavailable ? 'API_ROUTE_UNAVAILABLE' : 'INVALID_SERVER_RESPONSE';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload.message || `문제 생성에 실패했습니다. (HTTP ${response.status})`);
    error.code = payload.error || `HTTP_${response.status}`;
    throw error;
  }
  return payload;
}

export async function generateProblemSet(input, onStatus = () => {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 115_000);
  try {
    onStatus('실전 모의고사 분량의 지문을 설계하고 있습니다.');
    const response = await apiFetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const payload = await readGenerationResponse(response);
    onStatus('문항 형식과 정답 근거를 검수했습니다.');
    return normalizeGeneratedSet(payload);
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('실전형 문제 생성 시간이 초과되었습니다. 문제 수를 줄여 다시 시도해 주세요.');
      timeoutError.code = 'TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
