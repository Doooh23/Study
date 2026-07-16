import { normalizeQuestionType } from './config.js';
import { apiFetch } from './api-client.js';
import { deletePrivateProblemFile, uploadPrivateProblemFile } from './auth.js';

const API_ENDPOINT = '/api/recognize-problem';
const MAX_IMAGE_SIDE = 4000;
const MAX_IMAGE_PIXELS = 12_000_000;
const MAX_ENCODED_IMAGE_BYTES = 8 * 1024 * 1024;

const clean = (value, max) => String(value || '').trim().slice(0, max);

function uploadError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function normalizeRecognitionResult(value = {}) {
  const options = Array.isArray(value.options) ? value.options.slice(0, 5).map((item) => clean(item, 600)) : [];
  while (options.length < 5) options.push('');
  const detectedCorrectAnswer = Number(value.detectedCorrectAnswer);
  const correctAnswer = Number(value.correctAnswer);
  return {
    passage: clean(value.passage, 6000),
    question: clean(value.question, 700) || '다음 글을 읽고 물음에 답하시오.',
    options,
    type: normalizeQuestionType(value.type, '주제'),
    topic: clean(value.topic, 40) || '기타',
    source: clean(value.source, 120),
    rawText: clean(value.rawText, 10000),
    warnings: Array.isArray(value.warnings) ? value.warnings.slice(0, 8).map((item) => clean(item, 200)).filter(Boolean) : [],
    confidence: Math.max(0, Math.min(100, Number(value.confidence) || 0)),
    detectedCorrectAnswer: Number.isInteger(detectedCorrectAnswer) && detectedCorrectAnswer >= 1 && detectedCorrectAnswer <= 5 ? detectedCorrectAnswer : 0,
    correctAnswer: Number.isInteger(correctAnswer) && correctAnswer >= 1 && correctAnswer <= 5 ? correctAnswer : 0,
    evidenceSentence: clean(value.evidenceSentence, 1500),
    explanation: clean(value.explanation, 2000),
    analysisConfidence: Math.max(0, Math.min(100, Number(value.analysisConfidence) || 0)),
  };
}

export async function readRecognitionResponse(response) {
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    const routeUnavailable = response.status === 404 || /^\s*<!doctype html/i.test(responseText) || /^\s*<html/i.test(responseText);
    const error = new Error(routeUnavailable
      ? '이미지 인식 API를 찾지 못했습니다. 정적 서버가 아닌 Vercel 개발 서버로 실행해 주세요.'
      : `서버가 올바른 응답을 반환하지 않았습니다. (HTTP ${response.status})`);
    error.code = routeUnavailable ? 'API_ROUTE_UNAVAILABLE' : 'INVALID_SERVER_RESPONSE';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload.message || `이미지 인식 요청에 실패했습니다. (HTTP ${response.status})`);
    error.code = payload.error || `HTTP_${response.status}`;
    throw error;
  }
  return payload;
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        // Some mobile browsers expose createImageBitmap but cannot decode every
        // camera format through it. The object URL path below is more compatible.
      }
    }
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(uploadError('IMAGE_DECODE_FAILED', '사진을 읽지 못했습니다. JPG, PNG 또는 WEBP 파일인지 확인해 주세요.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(uploadError('IMAGE_ENCODE_FAILED', '사진을 업로드용 이미지로 변환하지 못했습니다.'));
      }, 'image/jpeg', quality);
    } catch (error) {
      reject(uploadError('IMAGE_ENCODE_FAILED', error?.message || '사진 변환 중 오류가 발생했습니다.'));
    }
  });
}

export async function prepareImageForAPI(file) {
  if (!(file instanceof Blob) || !file.size) {
    throw uploadError('EMPTY_UPLOAD', '비어 있는 파일은 업로드할 수 없습니다.');
  }
  const image = await loadImage(file);
  try {
    const sourceWidth = image.width;
    const sourceHeight = image.height;
    if (!sourceWidth || !sourceHeight) {
      throw uploadError('IMAGE_DECODE_FAILED', '사진의 크기를 확인하지 못했습니다.');
    }

    let scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(sourceWidth, sourceHeight));
    if (sourceWidth * sourceHeight * scale * scale > MAX_IMAGE_PIXELS) {
      scale = Math.sqrt(MAX_IMAGE_PIXELS / (sourceWidth * sourceHeight));
    }
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw uploadError('CANVAS_UNAVAILABLE', '브라우저에서 사진 처리 기능을 사용할 수 없습니다.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);

    let quality = 0.94;
    let blob = await canvasToBlob(canvas, quality);
    while (blob.size > MAX_ENCODED_IMAGE_BYTES && quality > 0.62) {
      quality = Math.max(0.62, quality - 0.08);
      blob = await canvasToBlob(canvas, quality);
    }
    if (blob.size > MAX_ENCODED_IMAGE_BYTES) {
      throw uploadError('IMAGE_TOO_COMPLEX', '사진 데이터가 너무 큽니다. 문제 부분만 잘라서 다시 선택해 주세요.');
    }
    return { blob, width, height, mime: 'image/jpeg' };
  } finally {
    image.close?.();
  }
}

export async function prepareUploadForAPI(file) {
  const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    if (!file.name?.toLowerCase().endsWith('.pdf')) {
      throw uploadError('INVALID_PDF', 'PDF 확장자와 파일 형식을 확인해 주세요.');
    }
    return { blob: file, width: 0, height: 0, mime: 'application/pdf' };
  }
  return prepareImageForAPI(file);
}

export async function recognizeExamImage(file, onProgress = () => {}) {
  console.info('[vision] recognition started', { name: file.name, size: file.size, type: file.type });
  onProgress({ status: '문서의 형식과 크기를 확인하고 있습니다.', progress: 0.05 });
  const prepared = await prepareUploadForAPI(file);
  onProgress({ status: '문서를 안전하게 전송하고 있습니다.', progress: 0.2 });
  const storagePath = await uploadPrivateProblemFile(prepared.blob, file.name, prepared.mime);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 145_000);
  let progress = 0.28;
  const ticker = setInterval(() => {
    progress = Math.min(0.84, progress + 0.025);
    onProgress({ status: 'AI가 지문과 선택지를 읽고 있습니다.', progress });
  }, 900);

  try {
    const response = await apiFetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storagePath, fileName: file.name, mime: prepared.mime }),
      signal: controller.signal,
    });
    const payload = await readRecognitionResponse(response);
    onProgress({ status: '추출한 내용을 문제 형식으로 정리하고 있습니다.', progress: 0.95 });
    const result = normalizeRecognitionResult(payload.problem);
    console.info('[vision] recognition completed', { confidence: result.confidence, model: payload.model, requestId: payload.requestId });
    onProgress({ status: '이미지 인식을 완료했습니다.', progress: 1 });
    const isPdf = prepared.mime === 'application/pdf';
    return {
      ...result,
      preview: isPdf ? '' : (prepared.preview || ''),
      fileKind: isPdf ? 'pdf' : 'image',
      processedWidth: prepared.width,
      processedHeight: prepared.height,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.');
      timeoutError.code = 'TIMEOUT';
      throw timeoutError;
    }
    if (error instanceof TypeError && !error.code) {
      throw uploadError('AI_NETWORK_ERROR', '네트워크 연결이 끊겨 AI 서버에 요청을 보내지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(ticker);
    await deletePrivateProblemFile(storagePath);
  }
}
