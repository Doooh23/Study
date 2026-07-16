import { apiFetch } from './api-client.js';

const clean = (value, max = 2000) => String(value || '').trim().slice(0, max);

export function normalizeReport(value = {}) {
  const report = {
    title: clean(value.title, 160) || '홍동원 Insight 분석서',
    subtitle: clean(value.subtitle, 240), summary: clean(value.summary, 900), theme: clean(value.theme, 300),
    thesis: clean(value.thesis, 500), purpose: clean(value.purpose, 400), tone: clean(value.tone, 160),
    structureFlow: Array.isArray(value.structureFlow) ? value.structureFlow.slice(0, 8).map((item) => ({
      label: clean(item.label, 80), sentenceRange: clean(item.sentenceRange, 50), explanation: clean(item.explanation, 400),
    })) : [],
    sentenceAnalysis: Array.isArray(value.sentenceAnalysis) ? value.sentenceAnalysis.slice(0, 24).map((item, index) => ({
      number: Number(item.number) || index + 1, original: clean(item.original, 1800), translation: clean(item.translation, 1800),
      role: clean(item.role, 120), grammarPoints: Array.isArray(item.grammarPoints) ? item.grammarPoints.slice(0, 5).map((v) => clean(v, 240)) : [],
      keyExpressions: Array.isArray(item.keyExpressions) ? item.keyExpressions.slice(0, 6).map((v) => clean(v, 180)) : [], commentary: clean(item.commentary, 700),
    })) : [],
    answerAnalysis: {
      correctAnswer: Number(value.answerAnalysis?.correctAnswer) || 0, evidence: clean(value.answerAnalysis?.evidence, 1800),
      whyCorrect: clean(value.answerAnalysis?.whyCorrect, 1200),
      solvingRoutine: Array.isArray(value.answerAnalysis?.solvingRoutine) ? value.answerAnalysis.solvingRoutine.slice(0, 6).map((v) => clean(v, 300)) : [],
      trapAnalysis: Array.isArray(value.answerAnalysis?.trapAnalysis) ? value.answerAnalysis.trapAnalysis.slice(0, 5).map((item) => ({
        option: Number(item.option), verdict: clean(item.verdict, 20), reason: clean(item.reason, 500),
      })) : [],
    },
    vocabulary: Array.isArray(value.vocabulary) ? value.vocabulary.slice(0, 20).map((item) => ({
      word: clean(item.word, 80), partOfSpeech: clean(item.partOfSpeech, 60), meaning: clean(item.meaning, 240),
      contextMeaning: clean(item.contextMeaning, 320), synonyms: Array.isArray(item.synonyms) ? item.synonyms.slice(0, 4).map((v) => clean(v, 80)) : [],
      antonyms: Array.isArray(item.antonyms) ? item.antonyms.slice(0, 4).map((v) => clean(v, 80)) : [],
      senses: Array.isArray(item.senses) ? item.senses.slice(0, 4).map((sense) => ({
        meaning: clean(sense?.meaning, 220),
        contextMeaning: clean(sense?.contextMeaning, 260),
        usage: clean(sense?.usage, 180),
        note: clean(sense?.note, 180),
      })) : [],
    })) : [],
    studyTips: Array.isArray(value.studyTips) ? value.studyTips.slice(0, 6).map((v) => clean(v, 400)) : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.slice(0, 6).map((v) => clean(v, 240)) : [],
  };
  if (!report.sentenceAnalysis.length || report.answerAnalysis.correctAnswer < 1) {
    const error = new Error('분석서 필수 항목이 부족합니다. 다시 생성해 주세요.');
    error.code = 'INCOMPLETE_REPORT';
    throw error;
  }
  return report;
}

export async function createProblemReport(problem, onStatus = () => {}) {
  onStatus('지문을 문장과 논리 단위로 나누고 있습니다.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 170_000);
  try {
    const response = await apiFetch('/api/create-report', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problem }), signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error('서버가 올바른 분석서 응답을 반환하지 않았습니다.'); }
    if (!response.ok) {
      const error = new Error(payload.message || '분석서를 만들지 못했습니다.');
      error.code = payload.error || `HTTP_${response.status}`;
      throw error;
    }
    onStatus('문장별 해석, 정답 근거와 오답 함정을 조판했습니다.');
    return { id: `report_${Date.now()}`, problemId: problem.id, generatedAt: payload.generatedAt, model: payload.model, report: normalizeReport(payload.report) };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('분석서 생성 시간이 초과되었습니다. 다시 시도해 주세요.');
      timeoutError.code = 'TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
