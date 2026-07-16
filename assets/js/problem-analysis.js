import { normalizeQuestionType } from './config.js';
import { apiFetch } from './api-client.js';

const API_ENDPOINT = '/api/analyze-problem';
const EVALUATION_ENDPOINT = '/api/evaluate-analysis';
const EVALUATION_SCORE_KEYS = ['topic', 'mood', 'core', 'claim', 'purpose', 'structure', 'logic', 'evidence', 'vocabulary'];

const clean = (value, max) => String(value || '').trim().slice(0, max);

export function normalizeProblemAnalysis(value = {}) {
  const correctAnswer = Number(value.correctAnswer);
  return {
    correctAnswer: Number.isInteger(correctAnswer) && correctAnswer >= 1 && correctAnswer <= 5 ? correctAnswer : 0,
    type: normalizeQuestionType(value.type, ''),
    topic: clean(value.topic, 40),
    confidence: Math.max(0, Math.min(100, Number(value.confidence) || 0)),
    evidenceSentence: clean(value.evidenceSentence, 1500),
    explanation: clean(value.explanation, 2000),
    warnings: Array.isArray(value.warnings) ? value.warnings.slice(0, 6).map((item) => clean(item, 200)).filter(Boolean) : [],
  };
}

export async function readProblemAnalysisResponse(response) {
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    const routeUnavailable = response.status === 404 || /^\s*<!doctype html/i.test(responseText) || /^\s*<html/i.test(responseText);
    const error = new Error(routeUnavailable
      ? 'AI 문제 분석 API를 찾지 못했습니다. 정적 서버가 아닌 Vercel 개발 서버로 실행해 주세요.'
      : `서버가 올바른 응답을 반환하지 않았습니다. (HTTP ${response.status})`);
    error.code = routeUnavailable ? 'API_ROUTE_UNAVAILABLE' : 'INVALID_SERVER_RESPONSE';
    throw error;
  }
  if (!response.ok) {
    const warningText = Array.isArray(payload.warnings) && payload.warnings.length ? ` ${payload.warnings.join(' ')}` : '';
    const error = new Error(`${payload.message || `AI 문제 분석에 실패했습니다. (HTTP ${response.status})`}${warningText}`.trim());
    error.code = payload.error || `HTTP_${response.status}`;
    throw error;
  }
  return payload;
}

export async function analyzeProblemWithAI(problem, onStatus = () => {}) {
  onStatus('AI가 지문과 선택지를 읽고 있습니다.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await apiFetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(problem),
      signal: controller.signal,
    });
    const payload = await readProblemAnalysisResponse(response);
    onStatus('정답, 문제 유형, 지문 소재를 확정했습니다.');
    const analysis = normalizeProblemAnalysis(payload.analysis);
    if (!analysis.correctAnswer || !analysis.type || !analysis.topic) {
      const error = new Error('AI 분석 결과에 필요한 판정값이 없습니다. 다시 시도해 주세요.');
      error.code = 'INCOMPLETE_ANALYSIS';
      throw error;
    }
    return analysis;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('AI 문제 분석 시간이 초과되었습니다. 다시 시도해 주세요.');
      timeoutError.code = 'TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeLearningEvaluation(value = {}) {
  const scores = Object.fromEntries(EVALUATION_SCORE_KEYS.map((key) => [key, Math.max(0, Math.min(100, Math.round(Number(value?.scores?.[key]) || 0)))]));
  const criterionFeedback = Object.fromEntries(EVALUATION_SCORE_KEYS.map((key) => [key, clean(value?.criterionFeedback?.[key], 500)]));
  return {
    overallScore: Math.max(0, Math.min(100, Math.round(Number(value.overallScore) || 0))),
    verdict: clean(value.verdict, 40),
    summary: clean(value.summary, 900),
    scores,
    criterionFeedback,
    strengths: Array.isArray(value.strengths) ? value.strengths.slice(0, 4).map((item) => clean(item, 500)).filter(Boolean) : [],
    improvements: Array.isArray(value.improvements) ? value.improvements.slice(0, 4).map((item) => clean(item, 500)).filter(Boolean) : [],
    thinkingCorrection: clean(value.thinkingCorrection, 900),
    rereadSentence: clean(value.rereadSentence, 1500),
    referenceAnalysis: {
      topic: clean(value?.referenceAnalysis?.topic, 100),
      mood: clean(value?.referenceAnalysis?.mood, 100),
      core: clean(value?.referenceAnalysis?.core, 700),
      claim: clean(value?.referenceAnalysis?.claim, 500),
      purpose: clean(value?.referenceAnalysis?.purpose, 500),
      logicStructures: Array.isArray(value?.referenceAnalysis?.logicStructures)
        ? value.referenceAnalysis.logicStructures.slice(0, 6).map((item) => clean(item, 100)).filter(Boolean)
        : [],
      evidenceSentence: clean(value?.referenceAnalysis?.evidenceSentence, 1500),
    },
  };
}

export async function evaluateLearningAnalysisWithAI(problem, analysis, sentences, onStatus = () => {}) {
  onStatus('AI가 지문을 독립적으로 분석해 기준답안을 만들고 있습니다.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 145_000);
  const roles = Object.entries(analysis.roles || {}).map(([index, role]) => ({
    index: Number(index),
    sentence: sentences[Number(index)] || '',
    role,
  }));
  try {
    const response = await apiFetch(EVALUATION_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        problem: {
          passage: problem.passage,
          question: problem.question,
          options: problem.options,
          correctAnswer: problem.correctAnswer,
          type: problem.type,
          topic: problem.topic,
          evidenceSentence: problem.evidenceSentence,
          explanation: problem.explanation,
        },
        sentences,
        analysis: {
          topic: analysis.topic,
          mood: analysis.mood,
          core: analysis.core,
          claim: analysis.claim,
          purpose: analysis.purpose,
          roles,
          logic: analysis.logic,
          evidenceIndex: analysis.evidenceIndex,
          confidence: analysis.confidence,
          unknownWords: analysis.unknownWords,
        },
      }),
      signal: controller.signal,
    });
    const payload = await readProblemAnalysisResponse(response);
    onStatus('학생 분석과 AI 기준답안을 항목별로 대조했습니다.');
    const evaluation = normalizeLearningEvaluation(payload.evaluation);
    const complete = evaluation.overallScore >= 0
      && evaluation.summary
      && evaluation.verdict
      && evaluation.strengths.length
      && evaluation.improvements.length
      && EVALUATION_SCORE_KEYS.every((key) => evaluation.criterionFeedback[key]);
    if (!complete) {
      const error = new Error('AI 평가 결과에 필요한 항목이 없습니다. 다시 시도해 주세요.');
      error.code = 'INCOMPLETE_EVALUATION';
      throw error;
    }
    return { ...evaluation, model: clean(payload.model, 100), requestId: clean(payload.requestId, 200), attempts: Number(payload.attempts) || 1 };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('AI 분석 평가 시간이 초과되었습니다. 작성 내용은 저장되어 있습니다.');
      timeoutError.code = 'TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
