import {
  QUESTION_TYPES,
  TOPICS,
  cleanText,
  findOutputText,
  findRefusal,
  guardAIRequest,
  hasAIKey,
  imageDetailOption,
  json,
  normalizeQuestionType,
  options,
  parseJson,
  reasoningOption,
  requestOpenAI,
  resolveModel,
} from './_shared.js';
import { consumePrivateUpload, getAuthUser, validateUploadDataUrl } from './_platform.js';

const problemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    passage: { type: 'string', maxLength: 6000 },
    question: { type: 'string', maxLength: 700 },
    options: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: { type: 'string', maxLength: 600 },
    },
    type: { type: 'string', enum: QUESTION_TYPES },
    topic: { type: 'string', enum: TOPICS },
    source: { type: 'string', maxLength: 120 },
    rawText: { type: 'string', maxLength: 10000 },
    warnings: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', maxLength: 200 },
    },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    detectedCorrectAnswer: { type: 'integer', minimum: 0, maximum: 5 },
    correctAnswer: { type: 'integer', minimum: 0, maximum: 5 },
    evidenceSentence: { type: 'string', maxLength: 1500 },
    explanation: { type: 'string', maxLength: 2000 },
    analysisConfidence: { type: 'integer', minimum: 0, maximum: 100 },
  },
  required: ['passage', 'question', 'options', 'type', 'topic', 'source', 'rawText', 'warnings', 'confidence', 'detectedCorrectAnswer', 'correctAnswer', 'evidenceSentence', 'explanation', 'analysisConfidence'],
};

const instruction = `대한민국 수능 영어 시험지 이미지 판독 전문가로 행동하세요.
업로드된 이미지 또는 PDF에 실제로 보이는 한 문제를 정확히 옮겨 적고 지정된 JSON 스키마로 반환하세요.
- 영어 지문의 철자, 대소문자, 문장부호, 문단, 빈칸, (A) 같은 표기를 원문대로 보존합니다.
- 한글 발문과 선택지 5개를 번호 기호 없이 각각 분리합니다.
- 번역하거나 문장을 자연스럽게 고치거나 보이지 않는 내용을 추측해서 채우지 않습니다.
- 손글씨, 형광펜, 동그라미, 체크 표시처럼 학생이 추가한 흔적은 무시합니다.
- 여러 문제가 함께 보이면 중앙에 있고 지문과 선택지가 가장 온전한 문제 하나만 추출합니다.
- 시험 출처가 인쇄되어 있을 때만 source에 적고, 없으면 빈 문자열을 반환합니다.
- 인쇄된 정답표나 해설에 정답이 명시된 경우에만 detectedCorrectAnswer를 1~5로 반환하고, 학생 표시만 있거나 알 수 없으면 0입니다.
- 추출한 지문·발문·선택지가 완전하면 문제를 직접 풀어 correctAnswer를 1~5로 확정하고 정답 근거와 한국어 해설을 작성합니다. 학생의 필기나 표시는 정답 판단에 사용하지 않습니다.
- 가려진 부분 때문에 문제를 풀 수 없으면 correctAnswer는 0, evidenceSentence와 explanation은 빈 문자열로 반환합니다.
- type은 다음 세부 유형 중 발문의 실제 과업과 일치하는 하나를 선택합니다: ${QUESTION_TYPES.join(', ')}.
- 빈칸의 답 단위, 함축 의미, 무관한 문장, 순서 배열, 문장 삽입을 세부 유형대로 엄격히 구분합니다.
- 가려졌거나 잘렸거나 확신할 수 없는 부분은 멋대로 보완하지 말고 warnings에 한국어로 적습니다.
- rawText에는 판독 가능한 전체 인쇄 텍스트를 읽는 순서대로 담습니다.
- 빈칸, 밑줄, 네모·원문자 번호, (A)~(C), ①~⑤처럼 정답 판단에 필요한 시각적 표지를 빠뜨리지 않습니다.
- 반환하기 전에 지문·발문·선택지 5개가 이미지에 실제로 존재하는지 한 번 더 대조하고, 보이지 않는 문자열은 절대 만들어내지 않습니다.
- confidence는 이미지 선명도와 문제 구성의 완전성을, analysisConfidence는 정답 판정의 확실성을 반영한 0~100 정수입니다.`;

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  if (!hasAIKey(env)) {
    return json({ ok: false, error: 'AI_NOT_CONFIGURED', message: '서버에 AI_API_KEY 또는 OPENAI_API_KEY가 설정되지 않았습니다.' }, 503);
  }

  try {
    const body = await parseJson(request, 3_500_000);
    let upload;
    if (body?.storagePath) {
      const auth = await getAuthUser(request, env);
      if (!auth.ok) return json({ ok: false, error: auth.error, message: auth.message }, auth.status);
      try { upload = await consumePrivateUpload(env, auth.user.id, body.storagePath, body.fileName, body.mime); }
      catch (error) { upload = { ok: false, error: error.message || 'UPLOAD_SCAN_FAILED' }; }
    } else {
      upload = validateUploadDataUrl(body?.fileDataUrl || body?.imageDataUrl, body?.fileName, env);
    }
    const uploadMessages = {
      INVALID_UPLOAD: 'JPG, PNG, WEBP 또는 PDF 파일을 다시 선택해 주세요.',
      UPLOAD_TOO_LARGE: '업로드 파일이 서버의 안전 용량 제한을 초과했습니다.',
      FILE_SIGNATURE_MISMATCH: '파일 확장자와 실제 형식이 일치하지 않습니다.',
      PDF_PAGE_LIMIT: 'PDF는 문제 부분만 추려 12페이지 이하로 업로드해 주세요.',
      ENCRYPTED_PDF: '암호화된 PDF는 분석할 수 없습니다.',
      ACTIVE_PDF_BLOCKED: '스크립트나 첨부 파일이 포함된 PDF는 보안을 위해 차단했습니다.',
      INVALID_STORAGE_PATH: '업로드 파일 경로가 올바르지 않습니다.',
      UPLOAD_NOT_FOUND: '임시 업로드 파일을 찾지 못했습니다. 다시 선택해 주세요.',
      MALWARE_DETECTED: '악성 콘텐츠가 감지되어 파일을 차단하고 삭제했습니다.',
      MALWARE_SCANNER_UNAVAILABLE: '악성 파일 검사 서비스를 확인하지 못해 안전하게 업로드를 중단했습니다.',
    };
    if (!upload.ok) return json({ ok: false, error: upload.error, message: uploadMessages[upload.error] || uploadMessages.INVALID_UPLOAD }, upload.error === 'UPLOAD_TOO_LARGE' ? 413 : 400);
    const usage = await guardAIRequest(request, env, 'document-recognition', { burstLimit: 8 });
    if (!usage.ok) return usage.response;

    const fileName = cleanText(upload.fileName, 120);
    const model = resolveModel(env, 'AI_OCR_MODEL', 'gpt-5.4-mini');
    const ai = await requestOpenAI({
      env,
      model,
      label: 'api/recognize-problem',
      usageReservation: usage,
      timeoutMs: 125_000,
      body: {
        model,
        store: false,
        max_output_tokens: 6500,
        ...reasoningOption(model, 'medium'),
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: instruction },
            upload.mime === 'application/pdf'
              ? { type: 'input_file', filename: fileName || 'problem.pdf', file_data: upload.dataUrl }
              : { type: 'input_image', image_url: upload.dataUrl, detail: imageDetailOption(model) },
          ],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'csat_english_problem',
            strict: true,
            schema: problemSchema,
          },
        },
      },
    });
    if (!ai.ok) return ai.errorResponse;
    const { result, requestId, attempts, model: usedModel = model } = ai;
    if (result.status === 'incomplete') {
      console.error('[api/recognize-problem] OpenAI response incomplete', { model: usedModel, requestId, details: result.incomplete_details });
      return json({ ok: false, error: 'AI_INCOMPLETE_RESPONSE', message: '이미지 판독 응답이 중간에 끝났습니다. 더 선명하게 촬영하거나 이미지 영역을 줄여 주세요.', requestId }, 502);
    }
    const outputText = findOutputText(result);
    if (!outputText) {
      const refusal = findRefusal(result);
      return json({
        ok: false,
        error: refusal ? 'OPENAI_REFUSAL' : 'AI_EMPTY_RESPONSE',
        message: refusal ? '이 이미지는 판독할 수 없습니다. 다른 이미지를 사용해 주세요.' : 'AI가 인식 결과를 반환하지 않았습니다.',
      }, 422);
    }

    let problem;
    try {
      problem = JSON.parse(outputText);
    } catch {
      return json({ ok: false, error: 'AI_INVALID_JSON', message: 'AI 인식 결과를 해석하지 못했습니다. 다시 시도해 주세요.' }, 502);
    }
    if (!problem?.passage || !problem?.question || !Array.isArray(problem?.options) || problem.options.length !== 5) {
      return json({ ok: false, error: 'INCOMPLETE_RECOGNITION', message: '문제의 지문·질문·선택지 5개를 모두 찾지 못했습니다.' }, 422);
    }
    problem.type = normalizeQuestionType(problem.type);
    const normalizedPassage = cleanText(problem.passage, 6000).replace(/\s+/g, ' ');
    const normalizedEvidence = cleanText(problem.evidenceSentence, 1500).replace(/\s+/g, ' ');
    if (normalizedEvidence && !normalizedPassage.includes(normalizedEvidence)) {
      problem.evidenceSentence = '';
      problem.analysisConfidence = Math.min(Number(problem.analysisConfidence) || 0, 85);
      problem.warnings = [...new Set([...(Array.isArray(problem.warnings) ? problem.warnings : []), '정답 근거가 판독된 원문과 정확히 일치하지 않아 2차 검증 대상으로 표시했습니다.'])];
    }

    console.info('[api/recognize-problem] recognition completed', { fileName, model: usedModel, requestedModel: ai.requestedModel, requestId, attempts, confidence: problem.confidence, analysisConfidence: problem.analysisConfidence });
    return json({ ok: true, problem, model: usedModel, requestedModel: ai.requestedModel, requestId, attempts });
  } catch (error) {
    if (error.message === 'PAYLOAD_TOO_LARGE') return json({ ok: false, error: error.message, message: '전송할 이미지가 너무 큽니다.' }, 413);
    if (error.message === 'INVALID_JSON') return json({ ok: false, error: error.message, message: '올바른 이미지 요청이 필요합니다.' }, 400);
    console.error('[api/recognize-problem] unexpected error', { name: error.name, message: error.message });
    return json({ ok: false, error: 'RECOGNITION_FAILED', message: '이미지 인식 중 오류가 발생했습니다.' }, 500);
  }
}
