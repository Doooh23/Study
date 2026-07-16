const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = 82;
const COLORS = { ink: '#20242a', muted: '#687078', wine: '#8b1238', pink: '#f6d4df', yellow: '#fff5b8', line: '#d8d8d2', paper: '#fffef9', blue: '#155b70', teal: '#25798a', orange: '#f06b2b' };

function roundedRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

function setFont(ctx, size, weight = 400, family = "'Noto Sans KR', sans-serif") {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = COLORS.ink;
}

function lines(ctx, text, maxWidth) {
  const output = [];
  String(text || '').split(/\n/).forEach((paragraph) => {
    let line = '';
    const tokens = paragraph.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*|\S|\s+/g) || [];
    tokens.forEach((token) => {
      const next = line + token;
      if (line.trim() && ctx.measureText(next).width > maxWidth) { output.push(line.trim()); line = token.trimStart(); }
      else line = next;
    });
    if (line.trim()) output.push(line.trim());
  });
  return output.length ? output : [''];
}

function drawText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 999) {
  const wrapped = lines(ctx, text, maxWidth).slice(0, maxLines);
  wrapped.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return y + wrapped.length * lineHeight;
}

function basePage(pageNumber, section) {
  const canvas = document.createElement('canvas'); canvas.width = PAGE_W; canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = COLORS.paper; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = '#e8e5de'; ctx.lineWidth = 2; ctx.strokeRect(38, 38, PAGE_W - 76, PAGE_H - 76);
  setFont(ctx, 20, 800); ctx.fillStyle = COLORS.wine; ctx.fillText('홍동원 insight', MARGIN, 77);
  setFont(ctx, 15, 700); ctx.fillStyle = COLORS.muted; ctx.fillText(section, MARGIN + 165, 77);
  ctx.fillStyle = COLORS.wine; ctx.fillRect(MARGIN, PAGE_H - 72, 44, 3);
  setFont(ctx, 13, 600); ctx.fillStyle = COLORS.muted; ctx.fillText(String(pageNumber).padStart(2, '0'), PAGE_W - MARGIN - 20, PAGE_H - 65);
  return { canvas, ctx };
}

function drawCover(report, problem) {
  const { canvas, ctx } = basePage(1, 'AI READING ANALYSIS');
  ctx.fillStyle = '#f8dbe5'; ctx.fillRect(38, 38, PAGE_W - 76, PAGE_H - 76);
  ctx.fillStyle = COLORS.wine; ctx.fillRect(38, 38, 26, PAGE_H - 76);
  setFont(ctx, 28, 800); ctx.fillStyle = COLORS.ink; ctx.fillText('수능 영어 · 능동 독해 분석서', 110, 190);
  setFont(ctx, 112, 900); ctx.fillStyle = COLORS.wine; ctx.fillText('홍동원', 108, 380);
  setFont(ctx, 76, 400, "'Source Serif 4', Georgia, serif"); ctx.fillStyle = '#111'; ctx.fillText('insight report', 112, 465);
  ctx.strokeStyle = COLORS.wine; ctx.lineWidth = 4; ctx.strokeRect(108, 560, PAGE_W - 216, 570);
  setFont(ctx, 24, 800); ctx.fillStyle = COLORS.wine; ctx.fillText(problem.type || '수능 영어 문항', 158, 645);
  setFont(ctx, 48, 800); ctx.fillStyle = COLORS.ink;
  let y = drawText(ctx, report.title, 158, 725, PAGE_W - 316, 62, 3);
  setFont(ctx, 22, 500); ctx.fillStyle = COLORS.muted; y = drawText(ctx, report.subtitle, 158, y + 24, PAGE_W - 316, 36, 4);
  ctx.fillStyle = '#fff8f4'; ctx.fillRect(158, 955, PAGE_W - 316, 98);
  setFont(ctx, 18, 700); ctx.fillStyle = COLORS.wine; ctx.fillText(`${problem.source || '사용자 업로드'}  ·  ${problem.topic || '기타'} 소재  ·  정답 ${problem.correctAnswer}번`, 188, 1013);
  setFont(ctx, 19, 500); ctx.fillStyle = COLORS.ink; drawText(ctx, report.summary, 112, 1245, PAGE_W - 224, 34, 7);
  setFont(ctx, 17, 700); ctx.fillStyle = COLORS.wine; ctx.fillText('ORIGINAL · LOGIC · EVIDENCE · VOCABULARY', 112, 1550);
  return canvas;
}

function drawOverview(report, problem) {
  const { canvas, ctx } = basePage(2, '문항 원문 × 핵심 분석');
  setFont(ctx, 22, 800); ctx.fillStyle = '#fff'; roundedRect(ctx, MARGIN, 115, 335, 43, 3, COLORS.wine); ctx.fillText('원문과 분석을 한눈에 보기', MARGIN + 18, 145);
  const colW = 500; const rightX = 658;
  setFont(ctx, 25, 800); ctx.fillStyle = COLORS.ink; ctx.fillText(problem.question, MARGIN, 212, colW);
  setFont(ctx, 21, 400, "'Source Serif 4', Georgia, serif"); ctx.fillStyle = '#252525';
  let y = drawText(ctx, problem.passage, MARGIN, 270, colW, 34, 30);
  y += 22; setFont(ctx, 17, 500, "'Source Serif 4', Georgia, serif");
  problem.options.forEach((option, i) => { ctx.fillText(`${['①','②','③','④','⑤'][i]} ${option}`, MARGIN + 10, y, colW - 10); y += 35; });
  ctx.strokeStyle = COLORS.line; ctx.setLineDash([5, 6]); ctx.beginPath(); ctx.moveTo(620, 184); ctx.lineTo(620, 1610); ctx.stroke(); ctx.setLineDash([]);
  setFont(ctx, 18, 800); ctx.fillStyle = COLORS.wine; ctx.fillText('ONE-LINE MAP', rightX, 210);
  const info = [['소재', report.theme], ['핵심 주장', report.thesis], ['목적', report.purpose], ['분위기', report.tone]];
  let ry = 248;
  info.forEach(([label, value], index) => {
    const h = index === 1 ? 170 : 125; roundedRect(ctx, rightX, ry, 500, h, 10, index === 1 ? COLORS.yellow : '#f7f6f1', COLORS.line);
    setFont(ctx, 16, 800); ctx.fillStyle = index === 1 ? COLORS.wine : COLORS.teal; ctx.fillText(label, rightX + 24, ry + 34);
    setFont(ctx, 18, 500); ctx.fillStyle = COLORS.ink; drawText(ctx, value, rightX + 24, ry + 69, 452, 29, index === 1 ? 4 : 2);
    ry += h + 18;
  });
  setFont(ctx, 18, 800); ctx.fillStyle = COLORS.wine; ctx.fillText('LOGIC FLOW', rightX, ry + 24); ry += 60;
  report.structureFlow.forEach((step, index) => {
    ctx.fillStyle = index % 2 ? '#f2f7f7' : '#fff2f4'; ctx.fillRect(rightX, ry, 500, 94);
    roundedRect(ctx, rightX + 16, ry + 15, 52, 30, 15, index % 2 ? COLORS.teal : COLORS.wine);
    setFont(ctx, 14, 800); ctx.fillStyle = '#fff'; ctx.fillText(step.sentenceRange, rightX + 27, ry + 36);
    setFont(ctx, 17, 800); ctx.fillStyle = COLORS.ink; ctx.fillText(step.label, rightX + 82, ry + 35);
    setFont(ctx, 14, 500); ctx.fillStyle = COLORS.muted; drawText(ctx, step.explanation, rightX + 82, ry + 61, 398, 21, 2);
    ry += 104;
  });
  return canvas;
}

function sentencePages(report) {
  const pages = []; let index = 0; let pageNo = 3;
  while (index < report.sentenceAnalysis.length) {
    const { canvas, ctx } = basePage(pageNo, '문장별 해석과 구문 분석'); pages.push(canvas);
    setFont(ctx, 22, 800); ctx.fillStyle = '#fff'; roundedRect(ctx, MARGIN, 115, 330, 43, 3, COLORS.wine); ctx.fillText('문장을 읽는 힘 만들기', MARGIN + 18, 145);
    let y = 202;
    while (index < report.sentenceAnalysis.length) {
      const item = report.sentenceAnalysis[index];
      setFont(ctx, 18, 600, "'Source Serif 4', Georgia, serif");
      const originalLines = lines(ctx, item.original, 910).length;
      setFont(ctx, 15, 500); const translationLines = lines(ctx, item.translation, 1000).length;
      const blockHeight = Math.max(205, 105 + originalLines * 28 + translationLines * 24 + Math.min(2, item.grammarPoints.length) * 22);
      if (y + blockHeight > PAGE_H - 115 && y > 260) break;
      roundedRect(ctx, MARGIN, y, PAGE_W - MARGIN * 2, blockHeight - 12, 10, index % 2 ? '#fbfaf6' : '#fff8f3', COLORS.line);
      roundedRect(ctx, MARGIN + 20, y + 20, 48, 48, 24, COLORS.wine);
      setFont(ctx, 18, 800); ctx.fillStyle = '#fff'; ctx.fillText(String(item.number), MARGIN + 37, y + 52);
      setFont(ctx, 15, 800); ctx.fillStyle = COLORS.teal; ctx.fillText(item.role, MARGIN + 84, y + 38);
      setFont(ctx, 18, 600, "'Source Serif 4', Georgia, serif"); ctx.fillStyle = COLORS.ink;
      let ty = drawText(ctx, item.original, MARGIN + 84, y + 70, 930, 28, 8);
      ctx.fillStyle = COLORS.yellow; ctx.fillRect(MARGIN + 84, ty + 4, 930, Math.max(32, translationLines * 24 + 14));
      setFont(ctx, 15, 600); ctx.fillStyle = COLORS.ink; ty = drawText(ctx, item.translation, MARGIN + 96, ty + 29, 906, 24, 6);
      setFont(ctx, 13, 600); ctx.fillStyle = COLORS.wine;
      const expressions = item.keyExpressions.join(' · '); if (expressions) { ctx.fillText(`KEY  ${expressions}`, MARGIN + 84, ty + 19); ty += 29; }
      setFont(ctx, 13, 500); ctx.fillStyle = COLORS.muted; drawText(ctx, item.commentary, MARGIN + 84, ty + 15, 930, 20, 2);
      y += blockHeight; index += 1;
    }
    pageNo += 1;
  }
  return pages;
}

function drawAnswers(report, problem, pageNumber) {
  const { canvas, ctx } = basePage(pageNumber, '정답 논리 × 선택지 함정');
  setFont(ctx, 22, 800); ctx.fillStyle = '#fff'; roundedRect(ctx, MARGIN, 115, 360, 43, 3, COLORS.wine); ctx.fillText('정답을 만드는 근거 찾기', MARGIN + 18, 145);
  roundedRect(ctx, MARGIN, 200, 180, 180, 20, COLORS.wine);
  setFont(ctx, 20, 700); ctx.fillStyle = '#f9cad8'; ctx.fillText('CORRECT', MARGIN + 38, 256);
  setFont(ctx, 74, 900); ctx.fillStyle = '#fff'; ctx.fillText(String(report.answerAnalysis.correctAnswer), MARGIN + 70, 346);
  roundedRect(ctx, 285, 200, 873, 180, 12, COLORS.yellow, '#e3d777');
  setFont(ctx, 16, 800); ctx.fillStyle = COLORS.wine; ctx.fillText('결정적 근거', 315, 238);
  setFont(ctx, 18, 600, "'Source Serif 4', Georgia, serif"); ctx.fillStyle = COLORS.ink; drawText(ctx, report.answerAnalysis.evidence, 315, 276, 813, 29, 4);
  setFont(ctx, 19, 800); ctx.fillStyle = COLORS.wine; ctx.fillText('왜 정답인가?', MARGIN, 445);
  setFont(ctx, 17, 500); ctx.fillStyle = COLORS.ink; drawText(ctx, report.answerAnalysis.whyCorrect, MARGIN, 482, PAGE_W - MARGIN * 2, 28, 8);
  let y = 720; setFont(ctx, 19, 800); ctx.fillStyle = COLORS.wine; ctx.fillText('선택지 5개 판별', MARGIN, y); y += 32;
  report.answerAnalysis.trapAnalysis.forEach((item) => {
    const correct = item.verdict === '정답'; roundedRect(ctx, MARGIN, y, PAGE_W - MARGIN * 2, 103, 9, correct ? '#edf8f3' : '#f8f6f2', correct ? '#7bc4a6' : COLORS.line);
    roundedRect(ctx, MARGIN + 18, y + 20, 62, 31, 16, correct ? '#16865d' : '#7c7f82');
    setFont(ctx, 14, 800); ctx.fillStyle = '#fff'; ctx.fillText(`${item.option} ${item.verdict}`, MARGIN + 30, y + 42);
    setFont(ctx, 15, 500); ctx.fillStyle = COLORS.ink; drawText(ctx, item.reason, MARGIN + 98, y + 31, 950, 24, 3); y += 114;
  });
  y = Math.max(y + 20, 1380); setFont(ctx, 18, 800); ctx.fillStyle = COLORS.teal; ctx.fillText('시험장 풀이 루틴', MARGIN, y);
  setFont(ctx, 15, 600); ctx.fillStyle = COLORS.ink;
  report.answerAnalysis.solvingRoutine.forEach((tip, i) => { ctx.fillText(`${i + 1}. ${tip}`, MARGIN + 15, y + 38 + i * 30); });
  return canvas;
}

function vocabularyPages(report, startPage) {
  const pages = []; let index = 0; let pageNo = startPage;
  while (index < report.vocabulary.length) {
    const { canvas, ctx } = basePage(pageNo, '핵심 어휘 × 복습 포인트'); pages.push(canvas);
    setFont(ctx, 22, 800); ctx.fillStyle = '#fff'; roundedRect(ctx, MARGIN, 115, 330, 43, 3, COLORS.blue); ctx.fillText('문맥 어휘로 마무리', MARGIN + 18, 145);
    let y = 205;
    while (index < report.vocabulary.length && y < 1460) {
      const word = report.vocabulary[index]; roundedRect(ctx, MARGIN, y, PAGE_W - MARGIN * 2, 142, 10, index % 2 ? '#f3f8fa' : '#fff8f5', COLORS.line);
      setFont(ctx, 25, 800, "'Source Serif 4', Georgia, serif"); ctx.fillStyle = index % 2 ? COLORS.blue : COLORS.wine; ctx.fillText(word.word, MARGIN + 24, y + 42);
      setFont(ctx, 13, 700); ctx.fillStyle = COLORS.muted; ctx.fillText(word.partOfSpeech, MARGIN + 24, y + 70);
      setFont(ctx, 16, 700); ctx.fillStyle = COLORS.ink; ctx.fillText(word.meaning, MARGIN + 285, y + 38);
      const senseLine = Array.isArray(word.senses) && word.senses.length ? word.senses.slice(0, 2).map((sense) => sense.meaning).filter(Boolean).join(' · ') : '';
      if (senseLine) {
        setFont(ctx, 12, 700); ctx.fillStyle = COLORS.blue; drawText(ctx, `뜻 ${senseLine}`, MARGIN + 285, y + 63, 745, 18, 1);
      }
      setFont(ctx, 14, 500); ctx.fillStyle = COLORS.muted; drawText(ctx, word.contextMeaning, MARGIN + 285, y + (senseLine ? 89 : 70), 745, 22, 2);
      setFont(ctx, 12, 600); ctx.fillStyle = COLORS.teal; ctx.fillText(`유의어 ${word.synonyms.join(', ') || '-'}   ·   반의어 ${word.antonyms.join(', ') || '-'}`, MARGIN + 285, y + 119);
      y += 154; index += 1;
    }
    if (index >= report.vocabulary.length) {
      setFont(ctx, 18, 800); ctx.fillStyle = COLORS.orange; ctx.fillText('FINAL CHECK', MARGIN, y + 30);
      setFont(ctx, 15, 600); ctx.fillStyle = COLORS.ink;
      report.studyTips.forEach((tip, i) => { drawText(ctx, `• ${tip}`, MARGIN + 16, y + 70 + i * 55, PAGE_W - MARGIN * 2 - 20, 24, 2); });
    }
    pageNo += 1;
  }
  return pages;
}

export async function renderReportPages(report, problem) {
  await document.fonts?.ready;
  const pages = [drawCover(report, problem), drawOverview(report, problem), ...sentencePages(report)];
  pages.push(drawAnswers(report, problem, pages.length + 1));
  pages.push(...vocabularyPages(report, pages.length + 1));
  return pages;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function dataUrlBytes(dataUrl) {
  const binary = atob(dataUrl.split(',')[1]); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const output = new Uint8Array(total); let offset = 0;
  chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.length; }); return output;
}

function pdfFromCanvases(canvases) {
  const enc = new TextEncoder(); const chunks = []; const offsets = [0]; let length = 0;
  const push = (value) => { const bytes = typeof value === 'string' ? enc.encode(value) : value; chunks.push(bytes); length += bytes.length; };
  push('%PDF-1.4\n%âãÏÓ\n');
  const objectCount = 2 + canvases.length * 3;
  const addObject = (number, bodyChunks) => { offsets[number] = length; push(`${number} 0 obj\n`); bodyChunks.forEach(push); push('\nendobj\n'); };
  addObject(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  const kids = canvases.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  addObject(2, [`<< /Type /Pages /Kids [${kids}] /Count ${canvases.length} >>`]);
  canvases.forEach((canvas, i) => {
    const pageObj = 3 + i * 3; const imageObj = pageObj + 1; const contentObj = pageObj + 2;
    const jpeg = dataUrlBytes(canvas.toDataURL('image/jpeg', 0.94));
    addObject(pageObj, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`]);
    addObject(imageObj, [`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
    const command = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
    addObject(contentObj, [`<< /Length ${command.length} >>\nstream\n${command}\nendstream`]);
  });
  const xref = length; push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objectCount; i += 1) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob([concatBytes(chunks)], { type: 'application/pdf' });
}

export async function downloadReportPdf(report, problem) {
  const pages = await renderReportPages(report, problem); downloadBlob(pdfFromCanvases(pages), `EON-${problem.id || Date.now()}-분석서.pdf`);
}

export async function downloadReportPng(report, problem) {
  const pages = await renderReportPages(report, problem); const gap = 24;
  const canvas = document.createElement('canvas'); canvas.width = PAGE_W; canvas.height = pages.length * PAGE_H + (pages.length - 1) * gap;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#d7d9dd'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  pages.forEach((page, index) => ctx.drawImage(page, 0, index * (PAGE_H + gap)));
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 생성에 실패했습니다.');
  downloadBlob(blob, `EON-${problem.id || Date.now()}-분석서.png`);
}
