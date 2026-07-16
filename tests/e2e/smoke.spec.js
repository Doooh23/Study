import { test, expect } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:4181';

const sampleProblem = {
  id: 'p1', passage: 'People often assume that more choices create more freedom. Yet too many choices can make meaningful commitment harder.',
  question: '다음 글의 요지로 가장 적절한 것은?', options: ['More is always better.', 'Choice can create a hidden burden.', 'Freedom is impossible.', 'Commitment has no value.', 'People dislike autonomy.'],
  correctAnswer: 2, selectedAnswer: 1, type: '요지', topic: '심리', source: 'E2E sample', difficulty: '평가원 수준', sentences: [], words: [],
};

const sampleReport = {
  title: '선택의 역설과 진정한 자유', subtitle: '많은 선택지가 항상 더 큰 자유를 보장하지는 않는다.', summary: '통념을 반박하며 제한된 선택이 의미 있는 전념을 돕는다고 주장한다.',
  theme: '선택과 자유의 관계', thesis: '선택지의 수보다 선택에 전념할 수 있는 능력이 진정한 자유를 만든다.', purpose: '선택의 양에 대한 통념을 재고하게 함', tone: '비판적·설득적',
  structureFlow: [{ label: '통념', sentenceRange: '1', explanation: '많은 선택이 자유를 준다는 생각' }, { label: '전환', sentenceRange: '2', explanation: '과도한 선택의 부담 제시' }],
  sentenceAnalysis: [{ number: 1, original: sampleProblem.passage, translation: '사람들은 흔히 더 많은 선택이 더 큰 자유를 만든다고 생각하지만, 지나친 선택은 의미 있는 전념을 어렵게 할 수 있다.', role: '통념과 반박', grammarPoints: ['that절 목적어'], keyExpressions: ['meaningful commitment'], commentary: 'Yet 이후가 필자의 핵심 방향이다.' }],
  answerAnalysis: { correctAnswer: 2, evidence: 'Yet too many choices can make meaningful commitment harder.', whyCorrect: '역접 이후에 과도한 선택의 부담을 직접 제시한다.', solvingRoutine: ['역접 표지를 찾는다.', '역접 이후를 선택지와 대조한다.'], trapAnalysis: [1,2,3,4,5].map((option) => ({ option, verdict: option === 2 ? '정답' : '오답', reason: option === 2 ? '핵심 주장과 일치한다.' : '지문에서 지지하지 않는 과장이다.' })) },
  vocabulary: [{ word: 'assume', partOfSpeech: 'v.', meaning: '가정하다', contextMeaning: '당연하다고 여기다', synonyms: ['suppose'], antonyms: ['verify'] }],
  studyTips: ['Yet 이후의 방향 전환을 먼저 표시한다.'], warnings: [],
};

test('public, auth preview, report and downloads render without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(({ sampleProblem, sampleReport }) => {
    localStorage.setItem('eon-study-data-v2', JSON.stringify({
      user: { id: 'local_user', name: '테스트', email: '', role: 'user' }, settings: { darkMode: false, dailyGoal: 5, preferredDifficulty: '평가원 수준', reduceMotion: true },
      currentProblem: sampleProblem, submittedProblems: [sampleProblem], analysisReports: [{ id: 'r1', problemId: 'p1', generatedAt: new Date().toISOString(), problem: sampleProblem, report: sampleReport }],
    }));
  }, { sampleProblem, sampleReport });
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /틀린 문제 하나를/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '회원가입' }).first()).toBeVisible();
  await page.screenshot({ path: '/tmp/eon-landing.png', fullPage: true });

  await page.goto(`${baseUrl}/#/privacy`);
  await expect(page.getByRole('heading', { name: '개인정보 처리방침' })).toBeVisible();
  await page.goto(`${baseUrl}/#/signup`);
  await expect(page.getByLabel('아이디')).toBeVisible();
  await expect(page.getByText('이메일 없이 아이디로 가입하고')).toBeVisible();
  await page.goto(`${baseUrl}/#/login`);
  await expect(page.getByLabel('아이디')).toBeVisible();
  await page.getByRole('button', { name: '서버 기능 없이 화면 둘러보기' }).click();
  await expect(page.getByRole('heading', { name: /테스트님.*읽는 힘/ }).first()).toBeVisible();
  await page.goto(`${baseUrl}/#/reset-password`);
  await expect(page.getByRole('heading', { name: '비밀번호 재설정' })).toBeVisible();
  await expect(page.getByLabel('복구 코드')).toBeVisible();
  await page.goto(`${baseUrl}/#/report?id=r1`);
  await expect(page.getByRole('heading', { name: '선택의 역설과 진정한 자유' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /뒤로 가기/ })).toBeVisible();
  await page.screenshot({ path: '/tmp/eon-report.png', fullPage: true });

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /PDF 다운로드/ }).click();
  expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/);
  await expect.poll(() => errors, { timeout: 1000 }).toEqual([]);
});

test('analysis choices update in place without jumping back to the top', async ({ page }) => {
  await page.addInitScript(({ sampleProblem }) => {
    localStorage.setItem('eon-study-data-v2', JSON.stringify({
      user: { id: 'local_user', name: '테스트', email: '', role: 'user' },
      settings: { darkMode: false, dailyGoal: 5, preferredDifficulty: '평가원 수준', reduceMotion: true },
      currentProblem: sampleProblem,
      currentAnalysis: {
        problemId: sampleProblem.id, unknownWords: [], topic: '', core: '', claim: '', purpose: '', mood: '',
        roles: {}, logic: [], evidenceIndex: null, confidence: 0, submitted: false,
      },
      submittedProblems: [sampleProblem],
    }));
  }, { sampleProblem });
  await page.goto(`${baseUrl}/#/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '서버 기능 없이 화면 둘러보기' }).click();
  await page.goto(`${baseUrl}/#/analysis`);

  const roleSentence = page.locator('[data-action="analysis-sentence"]').first();
  await roleSentence.scrollIntoViewIfNeeded();
  const roleScroll = await page.evaluate(() => window.scrollY);
  await roleSentence.click();
  await page.locator('[data-action="set-role"]').filter({ hasText: '핵심 주장' }).click();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - roleScroll)).toBeLessThan(3);
  await expect(roleSentence).toContainText('핵심 주장');

  const evidenceSentence = page.locator('[data-action="evidence-sentence"]').last();
  await evidenceSentence.scrollIntoViewIfNeeded();
  const evidenceScroll = await page.evaluate(() => window.scrollY);
  await evidenceSentence.click();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - evidenceScroll)).toBeLessThan(3);
  await expect(evidenceSentence).toHaveAttribute('aria-pressed', 'true');

  const confidence = page.locator('[data-action="confidence"][data-value="5"]');
  await confidence.scrollIntoViewIfNeeded();
  const confidenceScroll = await page.evaluate(() => window.scrollY);
  await confidence.click();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - confidenceScroll)).toBeLessThan(3);
  await expect(confidence).toHaveAttribute('aria-pressed', 'true');
});

test('camera image preparation creates a bounded Blob without fetching a data URL', async ({ page }) => {
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  const prepared = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1800;
    canvas.height = 1300;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111';
    context.font = '32px serif';
    for (let index = 0; index < 24; index += 1) {
      context.fillText(`${index + 1}. People often assume that more choices create more freedom.`, 60, 70 + index * 48);
    }
    const source = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([source], 'camera-problem.png', { type: 'image/png' });
    const originalFetch = window.fetch;
    let dataUrlFetches = 0;
    window.fetch = (...args) => {
      if (String(args[0]).startsWith('data:')) dataUrlFetches += 1;
      return originalFetch(...args);
    };
    try {
      const { prepareUploadForAPI } = await import('/assets/js/vision.js');
      const result = await prepareUploadForAPI(file);
      return { size: result.blob.size, type: result.blob.type, width: result.width, height: result.height, dataUrlFetches };
    } finally {
      window.fetch = originalFetch;
    }
  });
  expect(prepared).toMatchObject({ type: 'image/jpeg', width: 1800, height: 1300, dataUrlFetches: 0 });
  expect(prepared.size).toBeGreaterThan(1_000);
  expect(prepared.size).toBeLessThanOrEqual(8 * 1024 * 1024);
});
