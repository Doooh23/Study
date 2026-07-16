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
  validateProblemRequest,
} from './_shared.js';

const MIN_PASSAGE_WORDS = 135;
const MAX_PASSAGE_WORDS = 260;

function createGenerationSchema(input) {
  return {
  type: 'object',
  additionalProperties: false,
  properties: {
    valid: { type: 'boolean', enum: [true] },
    invalidReason: { type: 'string', enum: [''] },
    setTitle: { type: 'string', maxLength: 120 },
    problems: {
      type: 'array',
      minItems: input.problemCount,
      maxItems: input.problemCount,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: [input.questionType] },
          topic: { type: 'string', enum: [input.topic] },
          subtopic: { type: 'string', maxLength: 100 },
          difficulty: { type: 'string', maxLength: 40 },
          passage: { type: 'string', minLength: 650, maxLength: 6000 },
          question: { type: 'string', maxLength: 700 },
          options: {
            type: 'array',
            minItems: 5,
            maxItems: 5,
            items: { type: 'string', maxLength: 700 },
          },
          correctAnswer: { type: 'integer', minimum: 1, maximum: 5 },
          explanation: { type: 'string', maxLength: 2000 },
          evidenceSentence: { type: 'string', maxLength: 1500 },
          structure: {
            type: 'array',
            minItems: 3,
            maxItems: 12,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sentence: { type: 'string', maxLength: 1200 },
                role: { type: 'string', maxLength: 80 },
              },
              required: ['sentence', 'role'],
            },
          },
          includedTargetWords: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', maxLength: 60 },
          },
        },
        required: ['type', 'topic', 'subtopic', 'difficulty', 'passage', 'question', 'options', 'correctAnswer', 'explanation', 'evidenceSentence', 'structure', 'includedTargetWords'],
      },
    },
  },
  required: ['valid', 'invalidReason', 'setTitle', 'problems'],
  };
}

const TYPE_DESIGN_RULES = {
  목적: '글을 쓴 구체적인 의도를 묻고 선택지는 모두 to부정사 등 같은 문법 형식으로 맞춥니다.',
  '심경·분위기': '인물의 감정 변화나 글의 분위기를 근거로 추론하게 하며 감정 형용사 선택지를 평행하게 구성합니다.',
  '필자의 주장': '필자가 독자에게 요구하거나 강조하는 행동·판단을 한 문장으로 고르게 합니다.',
  '함축 의미 추론': '지문 속 핵심 비유나 표현 하나를 <<이중 꺾쇠>>로 표시하고 그 문맥적 의미를 묻습니다.',
  요지: '글 전체의 핵심 메시지를 가장 정확히 바꿔 쓴 선택지를 고르게 합니다.',
  주제: '명사구 중심의 영어 선택지로 글이 다루는 중심 화제를 고르게 합니다.',
  제목: '간결하고 포괄적인 영어 제목을 고르게 하며 지엽적 제목을 오답으로 설계합니다.',
  '도표 정보 일치': '텍스트 표나 항목별 수치를 지문 안에 명확히 제시하고 다섯 진술 중 표와 일치하지 않는 것을 고르게 합니다.',
  '세부 내용 일치': '지문의 명시적 사실과 일치하는 진술 하나를 고르게 합니다.',
  '세부 내용 불일치': '지문의 명시적 사실과 일치하지 않는 진술 하나를 고르게 합니다.',
  '안내문·실용문 일치': '행사·프로그램 안내 정보를 날짜, 대상, 비용, 신청 방법과 함께 제시하고 세부 정보 일치 여부를 묻습니다.',
  '어법 판단': '지문 속 다섯 표현을 [① ...]부터 [⑤ ...]로 표시하고 문법상 틀린 하나를 고르게 합니다.',
  '문맥상 어휘': '지문 속 다섯 낱말을 [① ...]부터 [⑤ ...]로 표시하고 문맥상 부적절한 하나를 고르게 합니다.',
  '빈칸 추론(단어·구)': '지문에 ______를 정확히 한 번 넣고 한 단어 또는 짧은 구가 들어가는 빈칸을 묻습니다.',
  '빈칸 추론(절·문장)': '지문에 ______를 정확히 한 번 넣고 논지를 완성하는 절 또는 문장을 묻습니다.',
  '흐름과 무관한 문장': '지문의 판단 대상 다섯 문장을 ①~⑤로 표시하고 전체 흐름과 관계없는 한 문장을 고르게 합니다.',
  '글의 순서 배열': '고정된 도입문 뒤에 (A), (B), (C) 단락을 제시하고 다섯 순서 조합 중 논리적인 배열을 고르게 합니다.',
  '주어진 문장 삽입': 'question에 주어진 문장 하나를 명시하고 passage에 삽입 위치 ①~⑤를 표시해 가장 자연스러운 위치를 고르게 합니다.',
  '요약문 완성': '지문 요약문에 (A), (B) 두 빈칸을 만들고 다섯 단어·구 조합 중 알맞은 것을 고르게 합니다.',
  '장문 독해(제목)': '하나의 긴 지문 전체를 포괄하는 제목을 고르게 합니다.',
  '장문 독해(어휘)': '긴 지문의 다섯 표시 어휘 중 문맥상 부적절한 것을 고르게 합니다.',
  '장문 독해(순서)': '긴 지문에서 이어질 단락들의 논리적 순서를 고르게 합니다.',
  '장문 독해(지칭)': '긴 지문의 표시된 대명사·지칭 표현 중 가리키는 대상이 다른 하나를 고르게 합니다.',
  '장문 독해(내용 일치)': '긴 지문의 핵심 사건과 세부 사실에 일치하거나 일치하지 않는 진술을 고르게 합니다.',
};

const instruction = `대한민국 대학수학능력시험과 평가원 영어 모의평가 문항을 설계하는 출제 전문가로 행동하세요.
사용자의 학습 조건에 맞는 완전히 새로운 영어 독해 문제를 지정된 JSON 스키마로 만드세요.

반드시 지킬 출제 기준:
- 모든 문제의 type은 사용자가 요청한 세부 유형과 정확히 같아야 하며, 해당 유형의 형식을 끝까지 유지합니다.
- 각 passage는 영어 기준 150~220단어, 대체로 7~12개의 완결된 문장으로 구성합니다. 단 두세 문장짜리 요약문은 허용하지 않습니다.
- 실제 평가원 지문처럼 하나의 중심 주장, 논리적 전개, 전환 또는 구체적 근거가 있어야 하며 문장 밀도와 어휘 수준도 요청 난이도에 맞춥니다.
- 글의 순서 배열·주어진 문장 삽입 유형도 도입부와 (A)(B)(C), ①~⑤ 위치를 포함한 전체 읽기 분량이 위 기준을 충족해야 합니다.
- 발문은 실제 수능 형식을 따르고, 선택지는 반드시 5개이며 길이와 문법 형식을 가능한 한 평행하게 맞춥니다.
- 별도의 밑줄 서식을 사용할 수 없으므로 함축 표현은 <<...>>, 어법·어휘 대상은 [① ...], 위치와 문장은 ①~⑤ 표기로 분명하게 표시합니다.
- 위치 번호를 고르는 유형도 options를 정확히 5개 반환합니다. 각 option은 해당 번호 또는 문장을 식별할 수 있게 작성합니다.
- 오답은 지문의 일부 표현을 이용하되 범위 과장, 인과 뒤집기, 반대 방향, 지엽 정보 등 설득력 있는 근거로 설계합니다.
- correctAnswer는 문항을 직접 풀어 확정한 1~5의 번호입니다. 여러 문제를 만들 때 정답 번호가 한 번호에 몰리지 않도록 분산합니다.
- evidenceSentence는 정답을 가장 직접적으로 뒷받침하는 지문 표현을 정확히 옮기고, explanation은 정답 이유와 주요 오답 배제 근거를 한국어로 설명합니다.
- structure에는 지문의 핵심 문장과 각 문장의 역할을 최소 3개 정리합니다.
- unknownWords가 제공되면 문맥에 자연스러운 단어만 문제당 2~5개 활용하고 includedTargetWords에 실제 사용한 단어를 기록합니다. 억지로 끼워 넣지 않습니다.
- 저작권이 있는 기존 기출 지문을 복제하지 말고 새로운 지문을 작성합니다.
- 서버가 정리한 출제 조건을 그대로 사용해 valid는 true, invalidReason은 빈 문자열로 반환하고 요청된 수의 문항을 모두 완성합니다.`;

const demoPassage = `People often describe efficiency as the art of completing a task with the least possible waste. This definition is useful, but it can become misleading when the task itself has not been carefully chosen. A school may shorten every meeting, for example, while continuing to hold discussions that no longer serve students. The meetings then consume less time individually, yet the institution remains committed to an unnecessary routine. Genuine efficiency therefore requires judgment before optimization. We must first ask which goals deserve our limited attention and which activities merely survive because they are familiar. Only after that decision does speed become meaningful. This distinction also explains why a slower process can sometimes produce a better overall result. Careful deliberation at the beginning may prevent repeated corrections later, just as a thoughtful map can save a traveler from several fast but pointless detours. Efficiency is not simply doing the same thing more quickly; it is arranging effort so that each action contributes to a worthwhile end.`;

const demoTemplate = {
  type: '요지', topic: '경제', subtopic: '효율성과 목표 선택', difficulty: '평가원 수준',
  passage: demoPassage,
  question: '다음 글의 요지로 가장 적절한 것은?',
  options: ['Efficiency always depends on shortening each individual activity.', 'Familiar routines are the safest basis for institutional decisions.', 'Meaningful efficiency begins by deciding which goals are worth pursuing.', 'Slow procedures necessarily create more waste than rapid procedures.', 'Optimization can remove the need to evaluate the purpose of a task.'],
  correctAnswer: 3,
  explanation: '글은 속도를 높이기 전에 어떤 목표가 가치 있는지 판단해야 진정한 효율성이 성립한다고 주장합니다. 3번이 이 핵심을 정확히 요약합니다.',
  evidenceSentence: 'Genuine efficiency therefore requires judgment before optimization.',
  structure: [
    { sentence: 'This definition is useful, but it can become misleading when the task itself has not been carefully chosen.', role: '통념의 한계 제시' },
    { sentence: 'Genuine efficiency therefore requires judgment before optimization.', role: '핵심 주장' },
    { sentence: 'Careful deliberation at the beginning may prevent repeated corrections later, just as a thoughtful map can save a traveler from several fast but pointless detours.', role: '비유를 통한 근거' },
    { sentence: 'Efficiency is not simply doing the same thing more quickly; it is arranging effort so that each action contributes to a worthwhile end.', role: '결론' },
  ],
  includedTargetWords: ['deliberation', 'optimization', 'contribute'],
};

function wordCount(text) {
  return (String(text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
}

function normalizeProblems(value, input) {
  if (!value?.valid || !Array.isArray(value.problems) || value.problems.length !== input.problemCount) return null;
  const problems = value.problems.map((problem, index) => {
    const passageWords = wordCount(problem?.passage);
    if (passageWords < MIN_PASSAGE_WORDS || passageWords > MAX_PASSAGE_WORDS) return null;
    if (problem?.type !== input.questionType || problem?.topic !== input.topic) return null;
    if (!Array.isArray(problem?.options) || problem.options.length !== 5 || problem.options.some((item) => !cleanText(item, 700))) return null;
    const correctAnswer = Number(problem.correctAnswer);
    if (!Number.isInteger(correctAnswer) || correctAnswer < 1 || correctAnswer > 5) return null;
    if (!cleanText(problem.question, 700) || !cleanText(problem.explanation, 2000) || !cleanText(problem.evidenceSentence, 1500)) return null;
    return {
      ...problem,
      id: `ai_${Date.now()}_${index}`,
      questionNumber: index + 1,
      passageWordCount: passageWords,
      difficulty: cleanText(problem.difficulty, 40) || input.difficulty,
    };
  });
  return problems.every(Boolean) ? problems : null;
}

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  try {
    const input = validateProblemRequest(await parseJson(request));
    if (!hasAIKey(env)) {
      const problems = Array.from({ length: input.problemCount }, (_, index) => ({
        ...demoTemplate,
        id: `demo_${Date.now()}_${index}`,
        questionNumber: index + 1,
        difficulty: input.difficulty,
        passageWordCount: wordCount(demoTemplate.passage),
      }));
      return json({ setTitle: `실전 모의고사형 ${input.questionType} 집중 학습`, generatedAt: new Date().toISOString(), problems, mode: 'demo', quality: { minPassageWords: MIN_PASSAGE_WORDS } });
    }

    const usage = await guardAIRequest(request, env, 'problem-generation', { burstLimit: 5 });
    if (!usage.ok) return usage.response;

    const model = resolveModel(env, 'AI_GENERATION_MODEL', 'gpt-5.4-mini');
    const generationInput = {
      ...input,
      requiredTypeDesign: TYPE_DESIGN_RULES[input.questionType],
    };
    const ai = await requestOpenAI({
      env,
      model,
      label: 'api/generate-problems',
      usageReservation: usage,
      timeoutMs: 105_000,
      body: {
        model,
        store: false,
        max_output_tokens: Math.min(30_000, 5_000 + input.problemCount * 2_300),
        ...reasoningOption(model, 'low'),
        instructions: instruction,
        input: JSON.stringify(generationInput),
        text: { format: { type: 'json_schema', name: 'csat_mock_problem_set', strict: true, schema: createGenerationSchema(input) } },
      },
    });
    if (!ai.ok) return ai.errorResponse;
    const { result, requestId, attempts, model: usedModel = model } = ai;
    if (result.status === 'incomplete') {
      console.error('[api/generate-problems] OpenAI response incomplete', { model: usedModel, requestId, details: result.incomplete_details, count: input.problemCount });
      return json({ ok: false, error: 'AI_OUTPUT_LIMIT', message: 'AI가 모든 문항을 완성하기 전에 응답이 끝났습니다. 문제 수를 줄여 다시 생성해 주세요.', requestId }, 502);
    }
    const outputText = findOutputText(result);
    if (!outputText) {
      const refused = findRefusal(result);
      return json({ ok: false, error: refused ? 'OPENAI_REFUSAL' : 'AI_EMPTY_RESPONSE', message: refused ? '이 조건으로는 문제를 만들 수 없습니다.' : 'AI가 문제를 반환하지 않았습니다.' }, 422);
    }
    let generated;
    try {
      generated = JSON.parse(outputText);
    } catch {
      return json({ ok: false, error: 'AI_INVALID_JSON', message: 'AI 문제 생성 결과를 해석하지 못했습니다. 다시 시도해 주세요.' }, 502);
    }
    if (!generated.valid) return json({ ok: false, error: 'INVALID_GENERATION_REQUEST', message: cleanText(generated.invalidReason, 300) || '이 조건으로 문제를 만들 수 없습니다.' }, 422);
    const problems = normalizeProblems(generated, input);
    if (!problems) return json({ ok: false, error: 'INCOMPLETE_GENERATION', message: `AI가 실전 분량(${MIN_PASSAGE_WORDS}단어 이상)과 문항 형식을 모두 충족하지 못했습니다. 다시 생성해 주세요.` }, 502);

    console.info('[api/generate-problems] generation completed', { model: usedModel, requestedModel: ai.requestedModel, requestId, attempts, count: problems.length, type: input.questionType, minWords: Math.min(...problems.map((problem) => problem.passageWordCount)) });
    return json({ ok: true, setTitle: cleanText(generated.setTitle, 120) || `${input.topic} 소재 ${input.questionType} 실전 학습`, generatedAt: new Date().toISOString(), problems, mode: 'ai', model: usedModel, requestedModel: ai.requestedModel, requestId, attempts, quality: { minPassageWords: MIN_PASSAGE_WORDS } });
  } catch (error) {
    if (error.message === 'PAYLOAD_TOO_LARGE') return json({ ok: false, error: error.message, message: '문제 생성 조건이 너무 깁니다.' }, 413);
    if (error.message === 'INVALID_JSON') return json({ ok: false, error: error.message, message: '올바른 문제 생성 요청이 필요합니다.' }, 400);
    console.error('[api/generate-problems] unexpected error', { name: error.name, message: error.message });
    return json({ ok: false, error: 'GENERATION_FAILED', message: '문제 생성 중 오류가 발생했습니다.' }, 500);
  }
}
