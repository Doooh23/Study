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
import { saveAnalysisReport } from './_platform.js';

const reportSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 160 },
    subtitle: { type: 'string', maxLength: 240 },
    summary: { type: 'string', maxLength: 900 },
    theme: { type: 'string', maxLength: 300 },
    thesis: { type: 'string', maxLength: 500 },
    purpose: { type: 'string', maxLength: 400 },
    tone: { type: 'string', maxLength: 160 },
    structureFlow: {
      type: 'array', minItems: 2, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          label: { type: 'string', maxLength: 80 },
          sentenceRange: { type: 'string', maxLength: 50 },
          explanation: { type: 'string', maxLength: 400 },
        },
        required: ['label', 'sentenceRange', 'explanation'],
      },
    },
    sentenceAnalysis: {
      type: 'array', minItems: 1, maxItems: 24,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          number: { type: 'integer', minimum: 1, maximum: 30 },
          original: { type: 'string', maxLength: 1800 },
          translation: { type: 'string', maxLength: 1800 },
          role: { type: 'string', maxLength: 120 },
          grammarPoints: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 240 } },
          keyExpressions: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 180 } },
          commentary: { type: 'string', maxLength: 700 },
        },
        required: ['number', 'original', 'translation', 'role', 'grammarPoints', 'keyExpressions', 'commentary'],
      },
    },
    answerAnalysis: {
      type: 'object', additionalProperties: false,
      properties: {
        correctAnswer: { type: 'integer', minimum: 1, maximum: 5 },
        evidence: { type: 'string', maxLength: 1800 },
        whyCorrect: { type: 'string', maxLength: 1200 },
        solvingRoutine: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', maxLength: 300 } },
        trapAnalysis: {
          type: 'array', minItems: 5, maxItems: 5,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              option: { type: 'integer', minimum: 1, maximum: 5 },
              verdict: { type: 'string', enum: ['정답', '오답'] },
              reason: { type: 'string', maxLength: 500 },
            },
            required: ['option', 'verdict', 'reason'],
          },
        },
      },
      required: ['correctAnswer', 'evidence', 'whyCorrect', 'solvingRoutine', 'trapAnalysis'],
    },
    vocabulary: {
      type: 'array', minItems: 5, maxItems: 20,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          word: { type: 'string', maxLength: 80 },
          partOfSpeech: { type: 'string', maxLength: 60 },
          meaning: { type: 'string', maxLength: 240 },
          contextMeaning: { type: 'string', maxLength: 320 },
          senses: {
            type: 'array', maxItems: 4,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                meaning: { type: 'string', maxLength: 220 },
                contextMeaning: { type: 'string', maxLength: 260 },
                usage: { type: 'string', maxLength: 180 },
                note: { type: 'string', maxLength: 180 },
              },
              required: ['meaning', 'contextMeaning', 'usage', 'note'],
            },
          },
          synonyms: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 80 } },
          antonyms: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 80 } },
        },
        required: ['word', 'partOfSpeech', 'meaning', 'contextMeaning', 'synonyms', 'antonyms'],
      },
    },
    studyTips: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', maxLength: 400 } },
    warnings: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 240 } },
  },
  required: ['title', 'subtitle', 'summary', 'theme', 'thesis', 'purpose', 'tone', 'structureFlow', 'sentenceAnalysis', 'answerAnalysis', 'vocabulary', 'studyTips', 'warnings'],
};

const instructions = `대한민국 수능 영어 최고 수준의 해설 집필자이자 편집자로 행동하세요.
사용자가 확인한 지문, 발문, 선택지와 정답을 바탕으로 상세 분석서를 작성합니다.
- 제공된 정답을 맹목적으로 따르지 말고 문제를 다시 풀되, 다른 결론이면 warnings에 명시합니다.
- 지문을 의미 단위 문장으로 빠짐없이 나누고 각 문장의 정확한 한국어 해석, 글에서의 역할, 핵심 구문, 문법 포인트와 독해 코멘트를 제공합니다.
- sentenceAnalysis의 original은 입력 지문의 철자와 문장부호를 그대로 인용하고, 입력에 없는 원문이나 사실을 만들지 않습니다.
- structureFlow는 글 전체를 '통념 → 전환 → 근거 → 결론'처럼 시험장에서 재현 가능한 흐름으로 만듭니다.
- answerAnalysis는 정답 근거, 정답 논리, 5개 선택지별 정오 이유, 실제 풀이 루틴을 모두 포함합니다.
- 정답은 발문의 실제 과업과 선택지 5개를 각각 지문에 대조해 독립적으로 검증하며, trapAnalysis는 1~5번을 중복 없이 한 번씩 포함합니다.
- vocabulary는 문맥 이해에 중요한 어휘를 선정하고 대표 뜻, 다의어 의미 구분, 문맥 뜻, 유의어, 반의어를 정확히 정리합니다. 다의어가 있는 단어는 senses에 2~4개의 실제 의미를 우선순위 순으로 넣습니다.
- 해설은 한국어로 쓰고 원문 인용은 입력 지문 범위 안에서만 사용합니다.
- 숨겨진 사고 과정을 장황하게 노출하지 말고 검증 가능한 근거와 간결한 풀이 절차를 제시합니다.
- 출력은 인쇄형 분석서로 바로 조판할 수 있도록 완결된 문장과 짧은 레이블을 사용합니다.`;

function normalizeProblem(body) {
  const problem = body?.problem;
  const passage = cleanText(problem?.passage, 12000);
  const question = cleanText(problem?.question, 1000);
  const optionsList = Array.isArray(problem?.options) ? problem.options.slice(0, 5).map((item) => cleanText(item, 800)) : [];
  const correctAnswer = Number(problem?.correctAnswer);
  if (passage.length < 30 || !question || optionsList.length !== 5 || optionsList.some((item) => !item) || correctAnswer < 1 || correctAnswer > 5) return null;
  return {
    id: cleanText(problem?.id, 160) || crypto.randomUUID(), passage, question, options: optionsList, correctAnswer,
    type: cleanText(problem?.type, 100), topic: cleanText(problem?.topic, 100), source: cleanText(problem?.source, 180),
    evidenceSentence: cleanText(problem?.evidenceSentence, 1800), explanation: cleanText(problem?.explanation, 2400),
  };
}

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  if (!hasAIKey(env)) return json({ ok: false, error: 'AI_NOT_CONFIGURED', message: '서버 AI 키가 설정되지 않았습니다.' }, 503);
  try {
    const problem = normalizeProblem(await parseJson(request, 120_000));
    if (!problem) return json({ ok: false, error: 'INVALID_REPORT_INPUT', message: '지문, 발문, 선택지 5개와 정답을 확인해 주세요.' }, 400);
    const usage = await guardAIRequest(request, env, 'analysis-report', { burstLimit: 4, windowSeconds: 60 });
    if (!usage.ok) return usage.response;
    const model = resolveModel(env, 'AI_REPORT_MODEL', 'gpt-5.4-mini');
    const ai = await requestOpenAI({
      env, model, label: 'api/create-report', timeoutMs: 150_000, usageReservation: usage,
      body: {
        model, store: false, max_output_tokens: 16_000, ...reasoningOption(model, 'high'),
        instructions, input: JSON.stringify(problem),
        text: { format: { type: 'json_schema', name: 'eon_print_analysis_report', strict: true, schema: reportSchema } },
      },
    });
    if (!ai.ok) return ai.errorResponse;
    const { result, requestId, attempts, model: usedModel = model } = ai;
    if (result.status === 'incomplete') return json({ ok: false, error: 'AI_OUTPUT_LIMIT', message: '분석서 작성이 중간에 끝났습니다. 지문 길이를 줄여 다시 시도해 주세요.', requestId }, 502);
    const text = findOutputText(result);
    if (!text) return json({ ok: false, error: findRefusal(result) ? 'OPENAI_REFUSAL' : 'AI_EMPTY_RESPONSE', message: 'AI가 분석서를 반환하지 않았습니다.' }, 422);
    let report;
    try { report = JSON.parse(text); } catch { return json({ ok: false, error: 'AI_INVALID_JSON', message: '분석서 결과를 해석하지 못했습니다.' }, 502); }
    const trapOptions = Array.isArray(report?.answerAnalysis?.trapAnalysis)
      ? report.answerAnalysis.trapAnalysis.map((item) => Number(item?.option)).sort((a, b) => a - b)
      : [];
    const originalsAreGrounded = Array.isArray(report?.sentenceAnalysis) && report.sentenceAnalysis.every((item) => {
      const original = cleanText(item?.original, 1800).replace(/\s+/g, ' ');
      return original && problem.passage.replace(/\s+/g, ' ').includes(original);
    });
    if (report?.answerAnalysis?.correctAnswer < 1 || !report.sentenceAnalysis?.length
      || trapOptions.join(',') !== '1,2,3,4,5' || !originalsAreGrounded) {
      return json({ ok: false, error: 'INCOMPLETE_REPORT', message: '분석서의 필수 항목이 완성되지 않았습니다.' }, 502);
    }
    await saveAnalysisReport(env, usage.user.id, problem.id, report.title, report).catch((error) => {
      console.error(JSON.stringify({ level: 'error', message: 'Generated report persistence failed', requestId, error: error?.message }));
    });
    console.info(JSON.stringify({ level: 'info', message: 'Analysis report completed', requestId, userId: usage.user.id, model: usedModel, requestedModel: ai.requestedModel, attempts }));
    return json({ ok: true, report, model: usedModel, requestedModel: ai.requestedModel, requestId, attempts, generatedAt: new Date().toISOString() });
  } catch (error) {
    const status = error.message === 'PAYLOAD_TOO_LARGE' ? 413 : error.message === 'INVALID_JSON' ? 400 : 500;
    console.error(JSON.stringify({ level: 'error', message: 'Analysis report failed', error: error?.message }));
    return json({ ok: false, error: error.message || 'REPORT_FAILED', message: '분석서를 만드는 중 오류가 발생했습니다.' }, status);
  }
}
