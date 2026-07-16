const CIRCLED = ['①', '②', '③', '④', '⑤'];

export function wrapCanvasText(context, text, maxWidth) {
  const paragraphs = String(text || '').split(/\n/);
  const lines = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      return;
    }
    let line = words.shift();
    words.forEach((word) => {
      const candidate = `${line} ${word}`;
      if (context.measureText(candidate).width <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    });
    lines.push(line);
    if (paragraphIndex < paragraphs.length - 1) lines.push('');
  });
  return lines;
}

function drawLines(context, lines, x, y, lineHeight) {
  lines.forEach((line) => {
    if (line) context.fillText(line, x, y);
    y += lineHeight;
  });
  return y;
}

function drawRule(context, x1, y, x2, color = '#1b2230', width = 2) {
  context.beginPath();
  context.moveTo(x1, y);
  context.lineTo(x2, y);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function paintProblem(context, canvasWidth, problem, questionNumber) {
  const margin = 84;
  const contentWidth = canvasWidth - margin * 2;
  let y = 76;

  context.fillStyle = '#111827';
  context.textAlign = 'center';
  context.font = '700 24px "Noto Sans KR", Arial, sans-serif';
  context.fillText('홍동원  대학수학능력시험 영어영역', canvasWidth / 2, y);
  y += 30;
  context.font = '500 16px "Noto Sans KR", Arial, sans-serif';
  context.fillStyle = '#4b5563';
  context.fillText('실전 모의고사형 맞춤 문항', canvasWidth / 2, y);
  y += 31;
  drawRule(context, margin, y, canvasWidth - margin, '#111827', 3);
  y += 48;

  context.textAlign = 'left';
  context.fillStyle = '#111827';
  context.font = '800 34px "Noto Sans KR", Arial, sans-serif';
  context.fillText(`${questionNumber}.`, margin, y);
  context.font = '700 18px "Noto Sans KR", Arial, sans-serif';
  context.fillStyle = '#374151';
  context.fillText(`${problem.type || '영어 독해'} · ${problem.topic || '일반'} · ${problem.difficulty || '평가원 수준'}`, margin + 78, y - 3);
  y += 54;

  context.font = '700 25px "Noto Sans KR", Arial, sans-serif';
  context.fillStyle = '#111827';
  const questionLines = wrapCanvasText(context, problem.question, contentWidth);
  y = drawLines(context, questionLines, margin, y, 41);
  y += 25;

  context.font = '500 27px Georgia, "Times New Roman", serif';
  const passageLines = wrapCanvasText(context, problem.passage, contentWidth - 56);
  const passageHeight = passageLines.length * 46 + 58;
  context.fillStyle = '#fbfbfa';
  context.fillRect(margin, y, contentWidth, passageHeight);
  context.strokeStyle = '#9ca3af';
  context.lineWidth = 1.5;
  context.strokeRect(margin, y, contentWidth, passageHeight);
  context.fillStyle = '#111827';
  y = drawLines(context, passageLines, margin + 28, y + 43, 46);
  y += 43;

  const options = Array.isArray(problem.options) ? problem.options.slice(0, 5) : [];
  options.forEach((option, index) => {
    context.font = '700 26px "Noto Sans KR", Arial, sans-serif';
    context.fillStyle = '#111827';
    context.fillText(CIRCLED[index], margin + 3, y);
    context.font = '500 24px Georgia, "Times New Roman", "Noto Sans KR", serif';
    const optionLines = wrapCanvasText(context, option, contentWidth - 62);
    y = drawLines(context, optionLines, margin + 55, y, 38);
    y += 19;
  });

  y += 11;
  drawRule(context, margin, y, canvasWidth - margin, '#d1d5db', 1);
  y += 31;
  context.textAlign = 'center';
  context.font = '500 15px "Noto Sans KR", Arial, sans-serif';
  context.fillStyle = '#6b7280';
  context.fillText(`홍동원 · ${problem.passageWordCount || ''}${problem.passageWordCount ? ' words · ' : ''}정답과 해설은 문제 풀이 후 확인하세요.`, canvasWidth / 2, y);
  return y + 66;
}

export async function renderProblemSheetToCanvas(problem, questionNumber = 1) {
  if (!problem?.passage || !problem?.question || !Array.isArray(problem?.options)) throw new Error('이미지로 만들 문제 정보가 부족합니다.');
  await document.fonts?.ready;
  const width = 1240;
  const work = document.createElement('canvas');
  work.width = width;
  work.height = 4200;
  const context = work.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, work.width, work.height);
  const finalHeight = Math.max(1754, Math.min(work.height, paintProblem(context, width, problem, questionNumber)));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = finalHeight;
  const finalContext = canvas.getContext('2d');
  finalContext.fillStyle = '#ffffff';
  finalContext.fillRect(0, 0, width, finalHeight);
  finalContext.drawImage(work, 0, 0, width, finalHeight, 0, 0, width, finalHeight);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${questionNumber}번 ${problem.type || '영어'} 문제지 이미지`);
  return canvas;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('문제지 이미지를 만들지 못했습니다.')), 'image/png'));
}

export async function downloadProblemSheet(canvas, questionNumber = 1) {
  const blob = await canvasBlob(canvas);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `eon-mock-exam-${questionNumber}.png`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
