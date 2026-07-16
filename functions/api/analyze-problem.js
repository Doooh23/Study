import {
  QUESTION_TYPES,
  TOPICS,
  cleanText,
  findOutputText,
  findRefusal,
  guardAIRequest,
  hasAIKey,
  json,
  normalizeQuestionType,
  options,
  parseJson,
  reasoningOption,
  requestOpenAI,
  resolveModel,
} from './_shared.js';

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    valid: { type: 'boolean' },
    invalidReason: { type: 'string', maxLength: 300 },
    correctAnswer: { type: 'integer', minimum: 0, maximum: 5 },
    type: { type: 'string', enum: QUESTION_TYPES },
    topic: { type: 'string', enum: TOPICS },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    evidenceSentence: { type: 'string', maxLength: 1500 },
    explanation: { type: 'string', maxLength: 2000 },
    warnings: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string', maxLength: 200 },
    },
  },
  required: ['valid', 'invalidReason', 'correctAnswer', 'type', 'topic', 'confidence', 'evidenceSentence', 'explanation', 'warnings'],
};

const instruction = `대한민국 수능 영어 문항 분석 전문가로 행동하세요.
입력된 영어 지문, 한국어 발문, 선택지 5개를 직접 분석해 아래 항목을 판정합니다.
- correctAnswer는 정답표를 찾는 작업이 아니라 문제를 직접 풀어 얻은 정답 번호입니다.
- type은 발문과 문제 구성에 따라 다음 세부 유형 중 정확히 하나로 분류합니다: ${QUESTION_TYPES.join(', ')}.
- 빈칸은 답의 문법 단위에 따라 '빈칸 추론(단어·구)'와 '빈칸 추론(절·문장)'을 구분합니다.
- '흐름과 무관한 문장', '글의 순서 배열', '주어진 문장 삽입', '함축 의미 추론'을 서로 혼동하지 않습니다.
- 밑줄 친 표현의 문맥적 뜻을 묻는 문항은 '함축 의미 추론', 번호가 붙은 낱말의 문맥 적절성을 묻는 문항은 '문맥상 어휘'입니다.
- 긴 한 지문에 두 문항 이상이 연결된 경우 발문의 실제 과업에 맞는 '장문 독해(...)' 세부 유형을 선택합니다.
- topic은 지문이 다루는 중심 소재를 지정된 대분류 중 하나로 분류합니다. 어느 분류에도 명확히 속하지 않으면 '기타'입니다.
- evidenceSentence에는 정답 판단에 가장 직접적인 지문 문장이나 문제 구성상의 근거를 적습니다.
- evidenceSentence는 입력 지문에 실제로 존재하는 문장을 원문 그대로 인용합니다. 문장을 바꾸어 쓰거나 존재하지 않는 근거를 만들지 않습니다.
- 정답을 확정하기 전에 발문의 과업, 지문의 핵심 방향, 선택지 5개를 각각 대조하고 과장·반대·무관·범위 오류가 없는지 검증합니다.
- explanation에는 정답인 이유와 가장 헷갈리는 오답의 배제 근거를 한국어로 간결하게 설명합니다. 숨겨진 사고 과정을 장황하게 적지 않습니다.
- 입력만으로 문제를 온전히 풀 수 없으면 valid는 false, correctAnswer는 0으로 하고 invalidReason과 warnings에 부족한 정보를 구체적으로 적습니다.
- 문제를 풀 수 있으면 valid는 true, correctAnswer는 반드시 1~5 중 하나이며 invalidReason은 빈 문자열입니다.
- 학생이 선택한 답은 정답 판정에 영향을 주지 않습니다.`;

function validateInput(body) {
  const passage = cleanText(body?.passage, 6000);
  const question = cleanText(body?.question, 700);
  const rawOptions = Array.isArray(body?.options) ? body.options : [];
  const optionList = rawOptions.slice(0, 5).map((item) => cleanText(item, 600));
  if (passage.length < 20 || !question || optionList.length !== 5 || optionList.some((item) => !item)) return null;
  return { passage, question, options: optionList };
}

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  if (!hasAIKey(env)) {
    return json({ ok: false, error: 'AI_NOT_CONFIGURED', message: '서버에 AI_API_KEY 또는 OPENAI_API_KEY가 설정되지 않았습니다.' }, 503);
  }

  try {
    const input = validateInput(await parseJson(request, 50_000));
    if (!input) {
      return json({ ok: false, error: 'INVALID_PROBLEM', message: '지문, 질문, 선택지 5개를 모두 입력해 주세요.' }, 400);
    }

    const usage = await guardAIRequest(request, env, 'problem-analysis', { burstLimit: 12 });
    if (!usage.ok) return usage.response;

    const model = resolveModel(env, 'AI_ANALYSIS_MODEL', 'gpt-5.4-mini');
    const ai = await requestOpenAI({
      env,
      model,
      label: 'api/analyze-problem',
      usageReservation: usage,
      timeoutMs: 105_000,
      body: {
        model,
        store: false,
        max_output_tokens: 3500,
        ...reasoningOption(model, 'high'),
        instructions: instruction,
        input: JSON.stringify(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'csat_problem_analysis',
            strict: true,
            schema: analysisSchema,
          },
        },
      },
    });
    if (!ai.ok) return ai.errorResponse;
    const { result, requestId, attempts, model: usedModel = model } = ai;
    if (result.status === 'incomplete') {
      console.error('[api/analyze-problem] OpenAI response incomplete', { model: usedModel, requestId, details: result.incomplete_details });
      return json({ ok: false, error: 'AI_INCOMPLETE_RESPONSE', message: 'AI가 분석을 끝내기 전에 응답이 중단됐습니다. 입력 내용은 임시 저장됩니다.', requestId }, 502);
    }
    const outputText = findOutputText(result);
    if (!outputText) {
      return json({
        ok: false,
        error: findRefusal(result) ? 'OPENAI_REFUSAL' : 'AI_EMPTY_RESPONSE',
        message: findRefusal(result) ? '이 문제는 AI가 분석할 수 없습니다.' : 'AI가 문제 분석 결과를 반환하지 않았습니다.',
      }, 422);
    }

    let analysis;
    try {
      analysis = JSON.parse(outputText);
    } catch {
      return json({ ok: false, error: 'AI_INVALID_JSON', message: 'AI 문제 분석 결과를 해석하지 못했습니다. 다시 시도해 주세요.' }, 502);
    }

    analysis.type = normalizeQuestionType(analysis?.type, '');
    const answer = Number(analysis?.correctAnswer);
    const classificationIsValid = QUESTION_TYPES.includes(analysis?.type) && TOPICS.includes(analysis?.topic);
    if (!analysis?.valid || !Number.isInteger(answer) || answer < 1 || answer > 5 || !classificationIsValid) {
      return json({
        ok: false,
        error: 'UNDETERMINABLE_PROBLEM',
        message: cleanText(analysis?.invalidReason, 300) || '입력된 내용만으로 정답을 확정할 수 없습니다. 문제의 표시와 선택지를 확인해 주세요.',
        warnings: Array.isArray(analysis?.warnings) ? analysis.warnings : [],
      }, 422);
    }
    const normalizedPassage = input.passage.replace(/\s+/g, ' ');
    const normalizedEvidence = cleanText(analysis.evidenceSentence, 1500).replace(/\s+/g, ' ');
    if (normalizedEvidence && !normalizedPassage.includes(normalizedEvidence)) {
      analysis.evidenceSentence = '';
      analysis.confidence = Math.min(Number(analysis.confidence) || 0, 85);
      analysis.warnings = [...new Set([...(Array.isArray(analysis.warnings) ? analysis.warnings : []), '근거 문장이 원문과 정확히 일치하지 않아 표시에서 제외했습니다.'])];
    }

    console.info('[api/analyze-problem] analysis completed', { model: usedModel, requestedModel: ai.requestedModel, requestId, attempts, type: analysis.type, topic: analysis.topic, confidence: analysis.confidence });
    return json({ ok: true, analysis, model: usedModel, requestedModel: ai.requestedModel, requestId, attempts });
  } catch (error) {
    if (error.message === 'PAYLOAD_TOO_LARGE') return json({ ok: false, error: error.message, message: '분석할 문제 내용이 너무 깁니다.' }, 413);
    if (error.message === 'INVALID_JSON') return json({ ok: false, error: error.message, message: '올바른 문제 분석 요청이 필요합니다.' }, 400);
    console.error('[api/analyze-problem] unexpected error', { name: error.name, message: error.message });
    return json({ ok: false, error: 'ANALYSIS_FAILED', message: '문제 분석 중 오류가 발생했습니다.' }, 500);
  }
}
