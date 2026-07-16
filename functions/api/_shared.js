import { authorizeAIRequest, finalizeAIRequest } from './_platform.js';

const buckets = new Map();

export const QUESTION_TYPE_GROUPS = [
  {
    label: '대의·태도',
    types: ['목적', '심경·분위기', '필자의 주장', '함축 의미 추론', '요지', '주제', '제목'],
  },
  {
    label: '정보 확인',
    types: ['도표 정보 일치', '세부 내용 일치', '세부 내용 불일치', '안내문·실용문 일치'],
  },
  {
    label: '언어 사용',
    types: ['어법 판단', '문맥상 어휘'],
  },
  {
    label: '빈칸 추론',
    types: ['빈칸 추론(단어·구)', '빈칸 추론(절·문장)'],
  },
  {
    label: '글의 흐름',
    types: ['흐름과 무관한 문장', '글의 순서 배열', '주어진 문장 삽입'],
  },
  {
    label: '통합·장문 독해',
    types: ['요약문 완성', '장문 독해(제목)', '장문 독해(어휘)', '장문 독해(순서)', '장문 독해(지칭)', '장문 독해(내용 일치)'],
  },
];

export const QUESTION_TYPES = QUESTION_TYPE_GROUPS.flatMap((group) => group.types);
export const DEFAULT_QUESTION_TYPE = '빈칸 추론(절·문장)';
export const TOPICS = ['경제', '철학', '심리', '과학', '기술', '환경', '예술', '사회', '교육', '역사', '기타'];

const QUESTION_TYPE_ALIASES = {
  주장: '필자의 주장',
  '빈칸 추론': '빈칸 추론(절·문장)',
  '문장 순서': '글의 순서 배열',
  '글의 순서': '글의 순서 배열',
  '문장 삽입': '주어진 문장 삽입',
  '무관한 문장': '흐름과 무관한 문장',
  '흐름과 관련 없는 문장': '흐름과 무관한 문장',
  '흐름과 관련없는 문장': '흐름과 무관한 문장',
  어휘: '문맥상 어휘',
  어법: '어법 판단',
  요약문: '요약문 완성',
  함축의미: '함축 의미 추론',
  '함축 의미': '함축 의미 추론',
};

export function normalizeQuestionType(value, fallback = DEFAULT_QUESTION_TYPE) {
  const cleaned = cleanText(value, 60);
  const normalized = QUESTION_TYPE_ALIASES[cleaned] || cleaned;
  return QUESTION_TYPES.includes(normalized) ? normalized : fallback;
}

export function responseHeaders(extra = {}) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  };
}

export function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders(extraHeaders) });
}

export function options() {
  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
    },
  });
}

export async function guardAIRequest(request, env, feature, settings) {
  const access = await authorizeAIRequest(request, env, feature, settings);
  if (access.ok) return access;
  const headers = access.retryAfter ? { 'retry-after': String(access.retryAfter) } : {};
  return {
    ok: false,
    response: json({ ok: false, error: access.error, message: access.message, usage: access.usage }, access.status || 500, headers),
  };
}

function clientKey(request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('x-vercel-forwarded-for') || forwarded || request.headers.get('CF-Connecting-IP') || 'local';
}

export function rateLimit(request, limit = 20, windowMs = 60_000) {
  const key = clientKey(request);
  const now = Date.now();
  const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (buckets.size > 1000) {
    for (const [bucketKey, value] of buckets) if (value.resetAt < now) buckets.delete(bucketKey);
  }
  return bucket.count <= limit;
}

export async function parseJson(request, maxBytes = 60_000) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  try {
    return await request.json();
  } catch {
    throw new Error('INVALID_JSON');
  }
}

export function cleanText(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function validateProblemRequest(body) {
  const count = Math.min(10, Math.max(1, Number(body?.problemCount) || 3));
  return {
    originalPassage: cleanText(body?.originalPassage),
    originalQuestion: cleanText(body?.originalQuestion, 500),
    questionType: normalizeQuestionType(body?.questionType),
    topic: TOPICS.includes(cleanText(body?.topic, 40)) ? cleanText(body?.topic, 40) : '기타',
    difficulty: cleanText(body?.difficulty, 40) || '평가원 수준',
    unknownWords: Array.isArray(body?.unknownWords)
      ? body.unknownWords.slice(0, 20).map((word) => ({
        word: cleanText(word?.word, 40),
        meaning: cleanText(word?.meaning, 100),
        masteryScore: Number(word?.masteryScore) || 0,
      })).filter((word) => word.word)
      : [],
    problemCount: count,
  };
}

export function resolveModel(env, featureKey, fallbackModel = 'gpt-5.4-mini') {
  const featureModel = cleanText(env?.[featureKey], 100);
  const sharedModel = cleanText(env?.AI_MODEL, 100);
  const selected = featureModel || (/^(?:openai\/)?gpt-5\.(?:4|5|6)(?:[-.]|$)/.test(sharedModel) ? sharedModel : fallbackModel);
  const usesGateway = !cleanText(env?.AI_API_KEY || env?.OPENAI_API_KEY, 500)
    && Boolean(cleanText(env?.AI_GATEWAY_API_KEY || env?.VERCEL_OIDC_TOKEN, 4000));
  return usesGateway && !selected.includes('/') ? `openai/${selected}` : selected;
}

export function hasAIKey(env) {
  return Boolean(cleanText(env?.AI_API_KEY || env?.OPENAI_API_KEY, 500)
    || cleanText(env?.AI_GATEWAY_API_KEY || env?.VERCEL_OIDC_TOKEN, 4000));
}

export function reasoningOption(model, effort = 'low') {
  return /^(?:openai\/)?gpt-5(?:\.|$)/.test(model) ? { reasoning: { effort } } : {};
}

export function imageDetailOption(model) {
  return /^(?:openai\/)?gpt-5\.6(?:[-.]|$)/.test(model) ? 'original' : 'high';
}

export function findOutputText(result) {
  if (typeof result?.output_text === 'string') return result.output_text;
  return result?.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === 'output_text')?.text;
}

export function findRefusal(result) {
  return result?.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === 'refusal')?.refusal;
}

function parseDurationSeconds(value) {
  if (!value) return 0;
  const raw = String(value).trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m)$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  return match[2] === 'ms' ? amount / 1000 : match[2] === 'm' ? amount * 60 : amount;
}

function retryAfterSeconds(response, attempt) {
  const retryAfter = parseDurationSeconds(response?.headers?.get('retry-after'));
  const requestReset = parseDurationSeconds(response?.headers?.get('x-ratelimit-reset-requests'));
  const fallback = 0.7 * (2 ** (attempt - 1)) + Math.random() * 0.35;
  return Math.min(8, Math.max(retryAfter, requestReset, fallback));
}

function isQuotaError(code, type) {
  return ['insufficient_quota', 'billing_hard_limit_reached', 'usage_limit_reached'].includes(code)
    || type === 'insufficient_quota';
}

function errorResponse({ status, code, type, upstreamMessage, requestId, retryAfter, label, attempts }) {
  const meta = { label, status, code, type, requestId, attempts };
  if (status === 429 && isQuotaError(code, type)) {
    console.error(`[${label}] OpenAI quota exhausted`, meta);
    return json({ ok: false, error: 'AI_QUOTA_EXCEEDED', message: '연결 가능한 AI 경로를 모두 자동으로 시도했지만 요청을 완료하지 못했습니다. 입력 내용은 브라우저에 임시 저장됩니다.', requestId }, 503);
  }
  if (type === 'customer_verification_required') {
    console.error(`[${label}] OpenAI organization verification required`, meta);
    return json({ ok: false, error: 'AI_ACCOUNT_VERIFICATION_REQUIRED', message: 'OpenAI 조직 인증이 필요합니다. OpenAI Platform의 조직 설정에서 인증을 완료해 주세요.', requestId }, 503);
  }
  if (status === 402 || /credit card|billing|credit balance|payment/i.test(upstreamMessage || '')) {
    console.error(`[${label}] AI billing is not ready`, meta);
    return json({ ok: false, error: 'AI_BILLING_REQUIRED', message: 'AI Gateway 결제 수단 또는 사용 한도가 설정되지 않았습니다. Vercel AI Gateway 결제 설정을 확인해 주세요.', requestId }, 503);
  }
  if (status === 401 || status === 403) {
    console.error(`[${label}] AI authentication failed`, meta);
    return json({ ok: false, error: 'OPENAI_AUTH', message: 'AI 제공자 인증이 유효하지 않습니다. Vercel AI Gateway 또는 API 키 설정을 확인해 주세요.', requestId }, 502);
  }
  if (status === 429) {
    console.warn(`[${label}] OpenAI rate limit persisted after retry`, meta);
    const seconds = Math.max(1, Math.ceil(retryAfter || 2));
    return json({ ok: false, error: 'OPENAI_RATE_LIMIT', message: `AI 서버가 혼잡해 자동 재시도에 실패했습니다. 약 ${seconds}초 후 다시 시도해 주세요.`, retryAfterSeconds: seconds, requestId }, 429, { 'retry-after': String(seconds) });
  }
  if ([408, 409, 425].includes(status) || status >= 500 || status === 0) {
    console.error(`[${label}] OpenAI temporary failure`, meta);
    return json({ ok: false, error: 'OPENAI_TEMPORARY_FAILURE', message: 'AI 서버 연결이 일시적으로 불안정합니다. 자동 재시도 후에도 응답하지 않았습니다.', requestId }, 503);
  }
  console.error(`[${label}] OpenAI request rejected`, meta);
  return json({ ok: false, error: 'OPENAI_UPSTREAM', message: 'AI 요청 조건을 처리하지 못했습니다. 서버 설정과 모델을 확인해 주세요.', requestId }, 502);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function privacySafeIdentifier(value) {
  const raw = cleanText(value, 200);
  if (!raw) return '';
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`eon-ai-user:${raw}`));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

function automaticModelFallbacks(model, env) {
  if (String(env?.AI_DISABLE_MODEL_FALLBACK || '').toLowerCase() === 'true') return [];
  const gatewayPrefix = String(model).startsWith('openai/') ? 'openai/' : '';
  const normalized = String(model).replace(/^openai\//, '');
  const candidates = /^gpt-5\.6(?:-sol)?$/.test(normalized)
    ? ['gpt-5.6-terra', 'gpt-5.4', 'gpt-5.4-mini']
    : /^gpt-5\.6-terra$/.test(normalized)
      ? ['gpt-5.4', 'gpt-5.4-mini']
      : /^gpt-5\.6-luna$/.test(normalized)
        ? ['gpt-5.4-mini']
      : /^gpt-5\.4$/.test(normalized)
        ? ['gpt-5.4-mini']
        : [];
  return candidates.map((candidate) => `${gatewayPrefix}${candidate}`);
}

function requestBodyForModel(body, model) {
  const input = Array.isArray(body?.input)
    ? body.input.map((item) => ({
      ...item,
      content: Array.isArray(item?.content)
        ? item.content.map((content) => content?.type === 'input_image'
          ? { ...content, detail: imageDetailOption(model) }
          : content)
        : item?.content,
    }))
    : body?.input;
  return { ...body, model, ...(input === undefined ? {} : { input }) };
}

function modelCanFallback(status, code, type) {
  return status === 404
    || isQuotaError(code, type)
    || type === 'customer_verification_required'
    || ['model_not_found', 'model_not_available', 'unsupported_model'].includes(code);
}

function providerCanFallback({ status, code, type, upstreamMessage }) {
  return status === 0
    || status === 401
    || status === 402
    || status === 403
    || status === 408
    || status === 409
    || status === 425
    || status === 429
    || status >= 500
    || isQuotaError(code, type)
    || /credit card|billing|credit balance|payment/i.test(upstreamMessage || '');
}

export async function requestOpenAI({
  env,
  model,
  body,
  label,
  timeoutMs = 50_000,
  maxAttempts = 3,
  usageReservation = null,
  fallbackModels = null,
  priorAttempts = 0,
  requestedModel = '',
  provider = '',
}) {
  const startedAt = Date.now();
  const directKey = cleanText(env?.AI_API_KEY || env?.OPENAI_API_KEY, 500);
  const gatewayKey = cleanText(env?.AI_GATEWAY_API_KEY || env?.VERCEL_OIDC_TOKEN, 4000);
  const selectedProvider = provider || (directKey ? 'direct' : 'gateway');
  const usesGateway = selectedProvider === 'gateway';
  const apiKey = usesGateway ? gatewayKey : directKey;
  const endpoint = usesGateway ? 'https://ai-gateway.vercel.sh/v1/responses' : 'https://api.openai.com/v1/responses';
  const providerModel = usesGateway
    ? (String(model).includes('/') ? String(model) : `openai/${model}`)
    : String(model).replace(/^openai\//, '');
  const safetyIdentifier = await privacySafeIdentifier(usageReservation?.user?.id);
  const modelBody = requestBodyForModel(body, providerModel);
  const requestBody = safetyIdentifier && !modelBody.safety_identifier ? { ...modelBody, safety_identifier: safetyIdentifier } : modelBody;
  const remainingFallbacks = Array.isArray(fallbackModels) ? fallbackModels : automaticModelFallbacks(providerModel, env);
  const originallyRequestedModel = requestedModel || model;
  let lastFailure = { status: 0, code: '', type: '', upstreamMessage: '', requestId: '', retryAfter: 0, attempts: 0 };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining < 750) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      lastFailure = {
        ...lastFailure,
        status: 0,
        code: error?.name || 'NETWORK_ERROR',
        type: error?.name || 'NETWORK_ERROR',
        upstreamMessage: cleanText(error?.message, 300),
        attempts: attempt,
      };
      const canRetry = attempt < maxAttempts && Date.now() - startedAt < timeoutMs - 1500;
      if (canRetry) {
        console.warn(`[${label}] OpenAI network request retry`, { model, attempt, name: error?.name });
        await wait(Math.min(1800, 550 * attempt));
        continue;
      }
      break;
    } finally {
      clearTimeout(timeout);
    }

    const requestId = response.headers.get('x-request-id') || '';
    if (response.ok) {
      try {
        const result = await response.json();
        await finalizeAIRequest(env, usageReservation, result, { model: providerModel, status: 'completed' });
        return {
          ok: true,
          response,
          result,
          requestId: requestId || result.id || '',
          attempts: priorAttempts + attempt,
          model: providerModel,
          requestedModel: originallyRequestedModel,
          provider: selectedProvider,
          fallbackUsed: providerModel.replace(/^openai\//, '') !== String(originallyRequestedModel).replace(/^openai\//, ''),
        };
      } catch {
        await finalizeAIRequest(env, usageReservation, null, { model, status: 'failed', errorCode: 'AI_INVALID_RESPONSE' });
        return {
          ok: false,
          errorResponse: json({ ok: false, error: 'AI_INVALID_RESPONSE', message: 'AI 서버 응답을 읽지 못했습니다.', requestId }, 502),
        };
      }
    }

    const payload = await response.json().catch(() => ({}));
    const code = cleanText(payload?.error?.code, 100);
    const type = cleanText(payload?.error?.type, 100);
    const upstreamMessage = cleanText(payload?.error?.message || payload?.error, 300);
    const retryAfter = retryAfterSeconds(response, attempt);
    lastFailure = { status: response.status, code, type, upstreamMessage, requestId, retryAfter, attempts: attempt };
    if (modelCanFallback(response.status, code, type) && remainingFallbacks.length) {
      const elapsed = Date.now() - startedAt;
      if (timeoutMs - elapsed > 2_000) {
        const [fallbackModel, ...nextFallbacks] = remainingFallbacks;
        console.warn(`[${label}] requested model unavailable; using fallback`, {
          requestedModel: originallyRequestedModel,
          unavailableModel: model,
          fallbackModel,
          status: response.status,
          code,
          type,
        });
        return requestOpenAI({
          env,
          model: fallbackModel,
          body,
          label,
          timeoutMs: timeoutMs - elapsed,
          maxAttempts,
          usageReservation,
          fallbackModels: nextFallbacks,
          priorAttempts: priorAttempts + attempt,
          requestedModel: originallyRequestedModel,
          provider: selectedProvider,
        });
      }
    }
    const transient = [408, 409, 425, 429].includes(response.status) || response.status >= 500;
    const canRetry = transient && !isQuotaError(code, type) && attempt < maxAttempts
      && Date.now() - startedAt + retryAfter * 1000 < timeoutMs - 500;
    if (!canRetry) break;
    console.warn(`[${label}] OpenAI request retry`, { status: response.status, code, type, model, attempt, requestId });
    await wait(retryAfter * 1000);
  }

  const elapsed = Date.now() - startedAt;
  if (selectedProvider === 'direct' && gatewayKey && providerCanFallback(lastFailure) && timeoutMs - elapsed > 2_000) {
    console.warn(`[${label}] direct provider unavailable; switching to AI Gateway`, {
      model: providerModel,
      status: lastFailure.status,
      code: lastFailure.code,
      type: lastFailure.type,
    });
    return requestOpenAI({
      env,
      model: providerModel,
      body,
      label,
      timeoutMs: timeoutMs - elapsed,
      maxAttempts,
      usageReservation,
      priorAttempts: priorAttempts + lastFailure.attempts,
      requestedModel: originallyRequestedModel,
      provider: 'gateway',
    });
  }

  await finalizeAIRequest(env, usageReservation, null, { model: providerModel, status: 'failed', errorCode: lastFailure.code || `HTTP_${lastFailure.status || 0}` });
  return { ok: false, errorResponse: errorResponse({ ...lastFailure, label }) };
}
