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

const wordSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    valid: { type: 'boolean' },
    invalidReason: { type: 'string', maxLength: 300 },
    word: { type: 'string', maxLength: 60 },
    lemma: { type: 'string', maxLength: 60 },
    pronunciation: { type: 'string', maxLength: 100 },
    partOfSpeech: { type: 'string', maxLength: 80 },
    meaning: { type: 'string', maxLength: 300 },
    contextMeaning: { type: 'string', maxLength: 400 },
    senses: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          meaning: { type: 'string', maxLength: 220 },
          contextMeaning: { type: 'string', maxLength: 260 },
          usage: { type: 'string', maxLength: 180 },
          note: { type: 'string', maxLength: 180 },
        },
        required: ['meaning', 'contextMeaning', 'usage', 'note'],
      },
    },
    difficulty: { type: 'integer', minimum: 1, maximum: 5 },
    examples: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sentence: { type: 'string', maxLength: 500 },
          translation: { type: 'string', maxLength: 500 },
          focus: { type: 'string', maxLength: 200 },
        },
        required: ['sentence', 'translation', 'focus'],
      },
    },
    learningTip: { type: 'string', maxLength: 500 },
  },
  required: ['valid', 'invalidReason', 'word', 'lemma', 'pronunciation', 'partOfSpeech', 'meaning', 'contextMeaning', 'senses', 'difficulty', 'examples', 'learningTip'],
};

const instruction = `한국인 수능 영어 학습자를 돕는 영영·영한 어휘 교사로 행동하세요.
입력된 영어 단어를 주변 문장과 지문 안에서 분석해 지정된 JSON 스키마로 정리하세요.
- lemma에는 사전형을, partOfSpeech에는 해당 문맥에서의 품사를 한국어와 영어 약어로 함께 적습니다. 예: 동사 (v.).
- meaning에는 학습자가 가장 먼저 기억할 대표 한국어 뜻을, contextMeaning에는 주어진 문장에서 실제로 쓰인 뜻과 뉘앙스를 적습니다.
- senses에는 사전에서 실제로 자주 쓰이는 뜻 2~4개를 우선순위 순으로 정리합니다. 각 항목은 meaning, contextMeaning, usage, note를 모두 채우고, usage는 그 뜻이 쓰이는 전형적인 맥락을 짧게 설명합니다.
- pronunciation에는 일반적인 발음기호 또는 한국어 발음 힌트를 간결하게 적습니다.
- examples는 정확히 4개 만듭니다. 쉬운 일상 문장, 수능 독해형 문장, 다른 의미 또는 결합 표현, 복습 문장처럼 맥락을 다양화합니다.
- 각 예문은 해당 단어 또는 자연스러운 활용형을 실제로 포함해야 하며, translation은 자연스러운 한국어 번역, focus는 그 예문에서 기억할 표현 또는 쓰임입니다.
- learningTip에는 유의어·반의어·어원·자주 쓰는 결합 표현 중 실제 학습에 가장 도움이 되는 내용을 설명합니다.
- 입력이 영어 단어가 아니거나 문맥에서 판정할 수 없으면 valid는 false로 하고 invalidReason에 이유를 적습니다. 이때 나머지 문자열은 빈 문자열, difficulty는 1, examples는 형식을 맞춘 빈 항목 4개로 반환합니다.
- 입력에 없는 개인 정보나 사실을 지어내지 않습니다.`;

function validateInput(body) {
  const word = cleanText(body?.word, 60).toLowerCase();
  const sentence = cleanText(body?.sentence, 1500);
  const passage = cleanText(body?.passage, 6000);
  if (!/^[a-z]+(?:['’-][a-z]+)?$/i.test(word)) return null;
  return { word, sentence, passage };
}

function normalizeSenses(value) {
  const senses = Array.isArray(value?.senses) ? value.senses : Array.isArray(value?.meanings) ? value.meanings : [];
  return senses.slice(0, 4).map((sense) => ({
    meaning: cleanText(sense?.meaning || sense?.label || sense, 220),
    contextMeaning: cleanText(sense?.contextMeaning || sense?.context || sense?.meaning, 260),
    usage: cleanText(sense?.usage || sense?.note || '', 180),
    note: cleanText(sense?.note || sense?.usage || '', 180),
  })).filter((sense) => sense.meaning || sense.contextMeaning || sense.usage || sense.note);
}

function normalizeWord(value, requestedWord) {
  const examples = Array.isArray(value?.examples) ? value.examples.slice(0, 4).map((example) => ({
    sentence: cleanText(example?.sentence, 500),
    translation: cleanText(example?.translation, 500),
    focus: cleanText(example?.focus, 200),
  })) : [];
  if (!value?.valid || examples.length !== 4 || examples.some((example) => !example.sentence || !example.translation)) return null;
  const senses = normalizeSenses(value);
  const fallbackSense = {
    meaning: cleanText(value.meaning, 220),
    contextMeaning: cleanText(value.contextMeaning, 260),
    usage: '',
    note: '',
  };
  return {
    word: requestedWord,
    lemma: cleanText(value.lemma, 60) || requestedWord,
    pronunciation: cleanText(value.pronunciation, 100),
    partOfSpeech: cleanText(value.partOfSpeech, 80) || '단어',
    meaning: cleanText(value.meaning, 300),
    contextMeaning: cleanText(value.contextMeaning, 400),
    senses: senses.length ? senses : [fallbackSense].filter((sense) => sense.meaning || sense.contextMeaning),
    difficulty: Math.min(5, Math.max(1, Number(value.difficulty) || 1)),
    examples,
    learningTip: cleanText(value.learningTip, 500),
    enrichmentStatus: 'complete',
    enrichedAt: new Date().toISOString(),
  };
}

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  if (!hasAIKey(env)) return json({ ok: false, error: 'AI_NOT_CONFIGURED', message: '서버에 AI_API_KEY 또는 OPENAI_API_KEY가 설정되지 않았습니다.' }, 503);

  try {
    const input = validateInput(await parseJson(request, 20_000));
    if (!input) return json({ ok: false, error: 'INVALID_WORD', message: '정리할 영어 단어를 확인해 주세요.' }, 400);

    const usage = await guardAIRequest(request, env, 'vocabulary-enrichment', { burstLimit: 15 });
    if (!usage.ok) return usage.response;

    const model = resolveModel(env, 'AI_VOCAB_MODEL', 'gpt-5.4-mini');
    const ai = await requestOpenAI({
      env,
      model,
      label: 'api/enrich-word',
      usageReservation: usage,
      timeoutMs: 40_000,
      body: {
        model,
        store: false,
        max_output_tokens: 3500,
        ...reasoningOption(model, 'none'),
        instructions: instruction,
        input: JSON.stringify(input),
        text: { format: { type: 'json_schema', name: 'vocabulary_learning_card', strict: true, schema: wordSchema } },
      },
    });
    if (!ai.ok) return ai.errorResponse;
    const { result, requestId, attempts, model: usedModel = model } = ai;
    if (result.status === 'incomplete') {
      console.error('[api/enrich-word] OpenAI response incomplete', { model: usedModel, requestId, details: result.incomplete_details });
      return json({ ok: false, error: 'AI_INCOMPLETE_RESPONSE', message: '단어 정리 응답이 중간에 끝났습니다. 다시 시도해 주세요.', requestId }, 502);
    }
    const outputText = findOutputText(result);
    if (!outputText) {
      const refused = findRefusal(result);
      return json({ ok: false, error: refused ? 'OPENAI_REFUSAL' : 'AI_EMPTY_RESPONSE', message: refused ? '이 단어는 AI가 정리할 수 없습니다.' : 'AI가 단어 정리 결과를 반환하지 않았습니다.' }, 422);
    }
    let output;
    try {
      output = JSON.parse(outputText);
    } catch {
      return json({ ok: false, error: 'AI_INVALID_JSON', message: 'AI 단어 정리 결과를 해석하지 못했습니다.' }, 502);
    }
    if (!output.valid) return json({ ok: false, error: 'UNDETERMINABLE_WORD', message: cleanText(output.invalidReason, 300) || '단어의 뜻을 확정할 수 없습니다.' }, 422);
    const word = normalizeWord(output, input.word);
    if (!word || !word.meaning || !word.contextMeaning) return json({ ok: false, error: 'INCOMPLETE_WORD', message: '뜻과 예문을 충분히 만들지 못했습니다. 다시 시도해 주세요.' }, 502);

    console.info('[api/enrich-word] word enriched', { model: usedModel, requestedModel: ai.requestedModel, requestId, attempts, word: input.word });
    return json({ ok: true, word, model: usedModel, requestedModel: ai.requestedModel, requestId, attempts });
  } catch (error) {
    if (error.message === 'PAYLOAD_TOO_LARGE') return json({ ok: false, error: error.message, message: '단어 문맥이 너무 깁니다.' }, 413);
    if (error.message === 'INVALID_JSON') return json({ ok: false, error: error.message, message: '올바른 단어 정리 요청이 필요합니다.' }, 400);
    console.error('[api/enrich-word] unexpected error', { name: error.name, message: error.message });
    return json({ ok: false, error: 'WORD_ENRICHMENT_FAILED', message: '단어 정리 중 오류가 발생했습니다.' }, 500);
  }
}
