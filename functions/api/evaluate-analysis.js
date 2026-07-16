import {
  cleanText,
  findOutputText,
  findRefusal,
  guardAIRequest,
  hasAIKey,
  json,
  options,
  parseJson,
  reasoningOption,
  requestOpenAI,
  resolveModel,
} from './_shared.js';

const SCORE_KEYS = ['topic', 'mood', 'core', 'claim', 'purpose', 'structure', 'logic', 'evidence', 'vocabulary'];

const scoreProperties = Object.fromEntries(SCORE_KEYS.map((key) => [key, { type: 'integer', minimum: 0, maximum: 100 }]));
const feedbackProperties = Object.fromEntries(SCORE_KEYS.map((key) => [key, { type: 'string', maxLength: 500 }]));

const evaluationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    valid: { type: 'boolean' },
    invalidReason: { type: 'string', maxLength: 300 },
    overallScore: { type: 'integer', minimum: 0, maximum: 100 },
    verdict: { type: 'string', enum: ['매우 정확', '대체로 정확', '부분적으로 정확', '보완 필요', '재분석 필요'] },
    summary: { type: 'string', maxLength: 900 },
    scores: {
      type: 'object',
      additionalProperties: false,
      properties: scoreProperties,
      required: SCORE_KEYS,
    },
    criterionFeedback: {
      type: 'object',
      additionalProperties: false,
      properties: feedbackProperties,
      required: SCORE_KEYS,
    },
    strengths: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: { type: 'string', maxLength: 500 },
    },
    improvements: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: { type: 'string', maxLength: 500 },
    },
    thinkingCorrection: { type: 'string', maxLength: 900 },
    rereadSentence: { type: 'string', maxLength: 1500 },
    referenceAnalysis: {
      type: 'object',
      additionalProperties: false,
      properties: {
        topic: { type: 'string', maxLength: 100 },
        mood: { type: 'string', maxLength: 100 },
        core: { type: 'string', maxLength: 700 },
        claim: { type: 'string', maxLength: 500 },
        purpose: { type: 'string', maxLength: 500 },
        logicStructures: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: { type: 'string', maxLength: 100 },
        },
        evidenceSentence: { type: 'string', maxLength: 1500 },
      },
      required: ['topic', 'mood', 'core', 'claim', 'purpose', 'logicStructures', 'evidenceSentence'],
    },
  },
  required: [
    'valid', 'invalidReason', 'overallScore', 'verdict', 'summary', 'scores', 'criterionFeedback',
    'strengths', 'improvements', 'thinkingCorrection', 'rereadSentence', 'referenceAnalysis',
  ],
};

const instructions = `대한민국 수능 영어 독해를 연구·지도하는 평가 전문가로 행동하세요.
영어 지문과 문항을 먼저 독립적으로 분석해 기준 분석을 세운 다음, 학생의 분석을 의미 단위로 비교 평가합니다.

채점 원칙:
- 글자 수, 입력 유무, 선택 개수만으로 점수를 주지 않습니다. 그럴듯하지만 지문과 무관한 답은 0~20점으로 평가합니다.
- 학생 표현이 기준답안과 달라도 의미가 정확하면 높게 평가하고, 핵심 방향·인과·대립이 뒤집히면 크게 감점합니다.
- topic은 중심 소재, mood는 지배적 어조, core는 전체 요약, claim은 필자의 핵심 주장, purpose는 글을 쓴 의도를 각각 구분합니다.
- structure는 학생이 선택한 실제 문장과 부여한 기능이 글의 전개에서 타당한지 평가합니다.
- logic은 지문에 실제 존재하는 논리 관계와 학생 선택의 정밀도를 평가합니다.
- evidence는 정답 번호와 문항 유형을 직접 해결하는 가장 강한 근거인지 평가합니다. 단순 주제 문장과 정답 근거를 혼동하지 않습니다.
- vocabulary는 학생이 모른다고 표시한 단어가 지문 이해와 정답 판단에 얼마나 핵심적인지를 평가합니다. 단어가 없으면 자동으로 고득점이나 감점을 주지 말고 독해상 필요성을 판단합니다.
- confidence는 점수에 포함하지 않습니다. 학생의 자기보고일 뿐 정확성 근거가 아닙니다.
- overallScore는 scores의 단순 평균이 아니라 core·claim·evidence를 더 중요하게 반영한 종합 점수여야 합니다.
- 각 점수는 서로 독립적으로 판정하며 고정값이나 일정한 기본점수를 사용하지 않습니다.
- 피드백은 반드시 현재 입력된 지문과 학생 답변만 언급합니다. 예시 지문이나 존재하지 않는 표현을 만들어 내지 않습니다.
- referenceAnalysis에는 교사가 제시할 수 있는 간결한 모범 분석을 한국어로 작성합니다.
- rereadSentence는 입력 지문에 실제로 존재하는 문장을 그대로 반환합니다.
- 입력이 영어 독해 문제로 평가할 수 없을 정도로 불완전하면 valid=false로 하고 invalidReason을 구체적으로 적습니다. 그 외에는 valid=true, invalidReason은 빈 문자열입니다.
- 숨겨진 사고 과정을 장황하게 공개하지 말고 판정 근거와 교정 방법만 명료하게 씁니다.`;

function normalizeInput(body) {
  const problem = body?.problem || {};
  const student = body?.analysis || {};
  const passage = cleanText(problem.passage, 6000);
  const question = cleanText(problem.question, 700);
  const optionsList = Array.isArray(problem.options)
    ? problem.options.slice(0, 5).map((item) => cleanText(item, 700))
    : [];
  const sentences = Array.isArray(body?.sentences)
    ? body.sentences.slice(0, 30).map((item) => cleanText(item, 1500)).filter(Boolean)
    : [];
  if (passage.length < 20 || !question || optionsList.length !== 5 || optionsList.some((item) => !item) || !sentences.length) return null;

  const roles = Array.isArray(student.roles)
    ? student.roles.slice(0, 30).map((item) => ({
      index: Number(item?.index),
      sentence: cleanText(item?.sentence, 1500),
      role: cleanText(item?.role, 100),
    })).filter((item) => Number.isInteger(item.index) && item.sentence && item.role)
    : [];
  const evidenceIndex = student.evidenceIndex === null || student.evidenceIndex === undefined ? -1 : Number(student.evidenceIndex);
  const selectedEvidence = Number.isInteger(evidenceIndex) && sentences[evidenceIndex] ? sentences[evidenceIndex] : '';

  return {
    problem: {
      passage,
      question,
      options: optionsList,
      correctAnswer: Math.min(5, Math.max(0, Number(problem.correctAnswer) || 0)),
      type: cleanText(problem.type, 100),
      classifiedTopic: cleanText(problem.topic, 100),
      existingEvidence: cleanText(problem.evidenceSentence, 1500),
      existingExplanation: cleanText(problem.explanation, 2000),
    },
    sentences,
    studentAnalysis: {
      topic: cleanText(student.topic, 100),
      mood: cleanText(student.mood, 100),
      core: cleanText(student.core, 700),
      claim: cleanText(student.claim, 500),
      purpose: cleanText(student.purpose, 500),
      roles,
      logic: Array.isArray(student.logic) ? student.logic.slice(0, 12).map((item) => cleanText(item, 100)).filter(Boolean) : [],
      selectedEvidence,
      evidenceIndex: Number.isInteger(evidenceIndex) ? evidenceIndex : -1,
      confidence: Math.min(5, Math.max(0, Number(student.confidence) || 0)),
      unknownWords: Array.isArray(student.unknownWords)
        ? student.unknownWords.slice(0, 20).map((item) => cleanText(item?.word || item, 60)).filter(Boolean)
        : [],
    },
  };
}

function isValidEvaluation(value) {
  if (!value?.valid || !SCORE_KEYS.every((key) => Number.isInteger(value?.scores?.[key]) && value.scores[key] >= 0 && value.scores[key] <= 100)) return false;
  if (!Number.isInteger(value.overallScore) || value.overallScore < 0 || value.overallScore > 100) return false;
  return SCORE_KEYS.every((key) => cleanText(value?.criterionFeedback?.[key], 500));
}

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  if (!hasAIKey(env)) {
    return json({ ok: false, error: 'AI_NOT_CONFIGURED', message: '서버에 AI_API_KEY 또는 OPENAI_API_KEY가 설정되지 않았습니다.' }, 503);
  }

  try {
    const input = normalizeInput(await parseJson(request, 80_000));
    if (!input) {
      return json({ ok: false, error: 'INVALID_EVALUATION', message: '지문, 문항, 선택지와 학생 분석을 모두 확인해 주세요.' }, 400);
    }

    const usage = await guardAIRequest(request, env, 'analysis-evaluation', { burstLimit: 8 });
    if (!usage.ok) return usage.response;

    const model = resolveModel(env, 'AI_EVALUATION_MODEL', 'gpt-5.4-mini');
    const ai = await requestOpenAI({
      env,
      model,
      label: 'api/evaluate-analysis',
      usageReservation: usage,
      timeoutMs: 130_000,
      body: {
        model,
        store: false,
        max_output_tokens: 6500,
        ...reasoningOption(model, 'high'),
        instructions,
        input: JSON.stringify(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'student_reading_analysis_evaluation',
            strict: true,
            schema: evaluationSchema,
          },
        },
      },
    });
    if (!ai.ok) return ai.errorResponse;

    const { result, requestId, attempts, model: usedModel = model } = ai;
    if (result.status === 'incomplete') {
      return json({ ok: false, error: 'AI_INCOMPLETE_RESPONSE', message: 'AI 평가가 끝나기 전에 응답이 중단됐습니다. 작성 내용은 저장되어 있습니다.', requestId }, 502);
    }
    const outputText = findOutputText(result);
    if (!outputText) {
      const refused = findRefusal(result);
      return json({ ok: false, error: refused ? 'OPENAI_REFUSAL' : 'AI_EMPTY_RESPONSE', message: refused ? '이 내용은 AI가 평가할 수 없습니다.' : 'AI가 평가 결과를 반환하지 않았습니다.' }, 422);
    }

    let evaluation;
    try {
      evaluation = JSON.parse(outputText);
    } catch {
      return json({ ok: false, error: 'AI_INVALID_JSON', message: 'AI 평가 결과를 해석하지 못했습니다. 다시 시도해 주세요.' }, 502);
    }
    if (!evaluation.valid) {
      return json({ ok: false, error: 'INVALID_EVALUATION', message: cleanText(evaluation.invalidReason, 300) || '현재 입력으로는 분석을 평가할 수 없습니다.' }, 422);
    }
    if (!isValidEvaluation(evaluation)) {
      return json({ ok: false, error: 'INCOMPLETE_EVALUATION', message: 'AI 평가 결과의 필수 항목이 완전하지 않습니다. 다시 시도해 주세요.' }, 502);
    }

    console.info('[api/evaluate-analysis] evaluation completed', { model: usedModel, requestedModel: ai.requestedModel, requestId, attempts, overallScore: evaluation.overallScore });
    return json({ ok: true, evaluation, model: usedModel, requestedModel: ai.requestedModel, requestId, attempts });
  } catch (error) {
    if (error.message === 'PAYLOAD_TOO_LARGE') return json({ ok: false, error: error.message, message: '평가할 분석 내용이 너무 깁니다.' }, 413);
    if (error.message === 'INVALID_JSON') return json({ ok: false, error: error.message, message: '올바른 분석 평가 요청이 필요합니다.' }, 400);
    console.error('[api/evaluate-analysis] unexpected error', { name: error.name, message: error.message });
    return json({ ok: false, error: 'EVALUATION_FAILED', message: '분석 평가 중 오류가 발생했습니다.' }, 500);
  }
}
