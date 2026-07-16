import {
  CONFIG,
  DEFAULT_QUESTION_TYPE,
  LOGIC_STRUCTURES,
  QUESTION_TYPE_GROUPS,
  QUESTION_TYPES,
  STRUCTURE_ROLES,
  TOPICS,
  normalizeQuestionType,
} from './config.js';
import { sourceProblem } from './demo-data.js';
import { loadData, saveData, resetData, isAuthenticated, setAuthenticated, setDataOwner, exportData } from './storage.js';
import { recognizeExamImage } from './vision.js';
import { analyzeProblemWithAI, evaluateLearningAnalysisWithAI } from './problem-analysis.js';
import { generateProblemSet } from './problem-generation.js';
import { enrichWordWithAI } from './word-enrichment.js';
import { downloadProblemSheet, renderProblemSheetToCanvas } from './exam-image.js';
import {
  bootstrapAuth,
  fetchAccount,
  hasRealSession,
  installErrorMonitoring,
  loadPublicConfig,
  resetPasswordWithRecoveryCode,
  signInWithUsername,
  signOut,
  signUpWithUsername,
} from './auth.js';
import { hydrateCloudData, installCloudSync, pushCloudData } from './cloud-sync.js';
import { apiFetch } from './api-client.js';
import { createProblemReport } from './report.js';
import { downloadReportPdf, downloadReportPng } from './report-export.js';

const app = document.querySelector('#app');
let data = loadData();
let ui = {
  registerTab: 'direct',
  analysisMode: 'role',
  vocabularyFilter: '전체',
  vocabularySort: 'mastery',
  vocabularySearch: '',
  insightTab: 'type',
  settingsTab: 'learning',
  sidebarOpen: false,
  generationTimers: [],
  practiceTimer: null,
  ocr: null,
  imageCanvas: null,
  analysisEvaluationBusy: false,
  authBusy: false,
  reportBusy: false,
  reportStatus: '',
  exportBusy: false,
  adminMetrics: null,
  adminBusy: false,
  publicConfig: null,
};

const e = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const icon = (name, className = 'icon') => `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
const average = (items) => items.length ? Math.round(items.reduce((sum, value) => sum + Number(value || 0), 0) / items.length) : 0;
const formatDate = (iso, withYear = false) => {
  const d = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat('ko-KR', withYear ? { year: 'numeric', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' }).format(d);
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const todayLong = () => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
const statusClass = (status = '') => status.includes('통과') || status.includes('완전') ? 'success' : status.includes('복습') ? 'danger' : status.includes('기억') ? 'warning' : 'primary';
const countStreak = (history) => {
  const days = new Set(history.map((item) => item.date));
  let streak = 0;
  const cursor = new Date();
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

const AI_ERROR_MESSAGES = {
  AI_NOT_CONFIGURED: '서버에 AI_API_KEY 또는 OPENAI_API_KEY가 설정되지 않았습니다.',
  OPENAI_AUTH: 'AI 제공자 인증이 유효하지 않습니다. Vercel Gateway 또는 API 키 설정을 확인해 주세요.',
  AI_BILLING_REQUIRED: 'Vercel AI Gateway의 결제 수단 또는 사용 한도를 설정해 주세요.',
  AI_QUOTA_EXCEEDED: '연결 가능한 AI 경로를 모두 자동으로 시도했지만 요청을 완료하지 못했습니다.',
  AI_ACCOUNT_VERIFICATION_REQUIRED: 'OpenAI Platform의 조직 설정에서 조직 인증을 완료해 주세요.',
  OPENAI_RATE_LIMIT: 'AI 서버 혼잡으로 자동 재시도까지 실패했습니다. 잠시 후 다시 시도해 주세요.',
  OPENAI_TEMPORARY_FAILURE: 'AI 서버 연결이 일시적으로 불안정합니다. 잠시 후 다시 시도해 주세요.',
  AI_INCOMPLETE_RESPONSE: 'AI 응답이 중간에 끝났습니다. 다시 시도해 주세요.',
  AI_OUTPUT_LIMIT: 'AI가 모든 문항을 완성하지 못했습니다. 문제 수를 줄여 다시 시도해 주세요.',
  AUTH_REQUIRED: '실제 계정으로 로그인한 뒤 AI 기능을 이용해 주세요.',
  SESSION_EXPIRED: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  DAILY_AI_LIMIT: '오늘의 AI 사용량을 모두 사용했습니다. 한국 시간 자정에 다시 이용할 수 있습니다.',
  USAGE_GUARD_FAILED: '사용량 제한 서버를 확인하지 못해 안전하게 요청을 중단했습니다.',
  RATE_LIMIT: '이 브라우저에서 요청을 너무 많이 보냈습니다. 잠시 후 다시 시도해 주세요.',
  API_ROUTE_UNAVAILABLE: 'AI API를 찾지 못했습니다. Vercel 개발 서버 또는 배포 설정을 확인해 주세요.',
  INVALID_SERVER_RESPONSE: '서버 응답 형식이 올바르지 않습니다.',
  EMPTY_UPLOAD: '비어 있는 파일은 업로드할 수 없습니다.',
  IMAGE_DECODE_FAILED: '사진을 읽지 못했습니다. JPG, PNG 또는 WEBP 파일인지 확인해 주세요.',
  IMAGE_ENCODE_FAILED: '사진을 업로드용 이미지로 변환하지 못했습니다.',
  IMAGE_TOO_COMPLEX: '사진 데이터가 너무 큽니다. 문제 부분만 잘라서 다시 선택해 주세요.',
  UPLOAD_TIMEOUT: '파일 전송 시간이 초과되었습니다. 네트워크 연결을 확인해 주세요.',
  UPLOAD_NETWORK_ERROR: '파일 저장소와 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.',
  PRIVATE_UPLOAD_FAILED: '비공개 업로드 저장소에 파일을 올리지 못했습니다.',
  AI_NETWORK_ERROR: '네트워크 연결이 끊겨 AI 서버에 요청을 보내지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
};

const describeAIError = (error, fallback = '잠시 후 다시 시도해 주세요.') => AI_ERROR_MESSAGES[error?.code] || error?.message || fallback;
const isStrongPassword = (value) => /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/.test(String(value || ''));

function questionTypeOptions(selected, includePlaceholder = false) {
  return `${includePlaceholder ? '<option value="">문제 유형 선택</option>' : ''}${QUESTION_TYPE_GROUPS.map((group) => `<optgroup label="${e(group.label)}">${group.types.map((type) => `<option value="${e(type)}" ${type === selected ? 'selected' : ''}>${e(type)}</option>`).join('')}</optgroup>`).join('')}`;
}

function brand() {
  return `<a class="brand" href="#/landing" aria-label="${CONFIG.brandName} 홈">
    <span class="brand-mark">E:O</span>
    <span class="brand-copy"><span>${CONFIG.brandName}</span><small>${CONFIG.tagline}</small></span>
  </a>`;
}

function go(route) {
  const target = `#/${route.replace(/^#?\//, '')}`;
  if (location.hash === target) render();
  else location.hash = target;
}

function currentRoute() {
  return (location.hash.replace(/^#\//, '').split('?')[0] || 'landing').toLowerCase();
}

function routeParam(name) {
  const query = location.hash.split('?')[1] || '';
  return new URLSearchParams(query).get(name) || '';
}

function clearTimers() {
  if (ui.practiceTimer) clearInterval(ui.practiceTimer);
  ui.practiceTimer = null;
  ui.generationTimers.forEach(clearTimeout);
  ui.generationTimers = [];
}

function applyTheme() {
  const dark = Boolean(data.settings?.darkMode);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1320' : '#f4f7fb');
}

function toast(title, message = '', type = 'success') {
  let region = document.querySelector('.toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    document.body.append(region);
  }
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.innerHTML = `<span class="toast-icon">${icon(type === 'error' ? 'x' : 'check', 'icon-sm')}</span><div><b>${e(title)}</b>${message ? `<p>${e(message)}</p>` : ''}</div>`;
  region.append(item);
  setTimeout(() => item.remove(), 3400);
}

function modal({ title, body, actions = '' }) {
  closeModal();
  const wrapper = document.createElement('div');
  wrapper.className = 'modal-backdrop';
  wrapper.dataset.modal = 'true';
  wrapper.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <header class="modal-head"><h2 id="modal-title">${e(title)}</h2><button class="icon-btn" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></header>
    <div class="modal-body">${body}</div>
    ${actions ? `<footer class="modal-actions">${actions}</footer>` : ''}
  </section>`;
  document.body.append(wrapper);
  wrapper.querySelector('button, input, select, textarea')?.focus();
}

function closeModal() {
  document.querySelector('[data-modal]')?.remove();
}

function showRecoveryCode(code, description = '이 코드는 다시 표시되지 않습니다. 비밀번호 관리자나 안전한 곳에 보관해 주세요.') {
  modal({
    title: '계정 복구 코드를 저장하세요',
    body: `<p class="muted">${e(description)}</p><div class="recovery-code" id="recovery-code">${e(code)}</div><p class="field-help">이메일 없이 비밀번호를 재설정할 때 필요한 유일한 수단입니다.</p>`,
    actions: '<button class="btn btn-secondary" type="button" data-action="copy-recovery-code">코드 복사</button><button class="btn btn-primary" type="button" data-action="close-modal">저장 완료</button>',
  });
}

const routeMeta = {
  dashboard: ['학습 홈', '오늘의 학습'], register: ['문제 학습', '오답 등록'], analysis: ['문제 학습', '능동 분석'],
  feedback: ['문제 학습', 'AI 분석 비교'], generate: ['맞춤 학습', '문제 생성'], practice: ['맞춤 학습', '문제 풀이'],
  results: ['맞춤 학습', '학습 결과'], vocabulary: ['학습 관리', '단어장'], insights: ['학습 관리', '취약 분석'],
  history: ['학습 관리', '학습 기록'], settings: ['내 정보', '설정'], reports: ['AI 분석서', '분석서 보관함'],
  report: ['AI 분석서', '상세 분석서'], admin: ['관리자', '사용량·비용'], 'reset-password': ['계정', '비밀번호 재설정'],
};

const navItems = [
  ['dashboard', 'home', '학습 홈'], ['register', 'plus', '오답 등록'], ['reports', 'book', 'AI 분석서'], ['generate', 'spark', '맞춤 문제'],
  ['vocabulary', 'book', '단어 학습'], ['insights', 'chart', '취약 분석'], ['history', 'calendar', '학습 기록'], ['settings', 'settings', '설정'],
];

function navLink(item, route, mobile = false) {
  const [path, iconName, label] = item;
  const active = route === path || (path === 'generate' && ['practice', 'results'].includes(route)) || (path === 'reports' && route === 'report');
  return `<a class="${mobile ? '' : 'nav-link'} ${active ? 'active' : ''}" href="#/${path}" ${active ? 'aria-current="page"' : ''}>${icon(iconName)}<span>${label}</span></a>`;
}

function shell(route, content) {
  const [group, page] = routeMeta[route] || ['홍동원', '학습'];
  const displayName = String(data.user.name || '').trim();
  const initial = e(displayName.slice(0, 1) || 'E');
  const accountLabel = displayName || '이름 미설정';
  const accountMeta = data.user.targetGrade ? `목표 ${data.user.targetGrade}등급` : '학습 데이터 없음';
  const studiedToday = data.learningHistory.filter((h) => h.date === todayISO()).reduce((s, h) => s + h.problemCount, 0);
  const goal = data.settings.dailyGoal || 5;
  const usage = data.user.aiUsage;
  const accountItems = [navItems[7], ...(data.user.role === 'admin' ? [['admin', 'chart', '관리자 대시보드']] : [])];
  return `<div class="app-shell">
    ${ui.sidebarOpen ? '<div class="sidebar-scrim" data-action="close-sidebar"></div>' : ''}
    <aside class="sidebar ${ui.sidebarOpen ? 'open' : ''}" aria-label="주요 메뉴">
      ${brand()}
      <nav class="sidebar-nav">
        <div class="nav-group-label">LEARN</div>
        ${navItems.slice(0, 4).map((item) => navLink(item, route)).join('')}
        <div class="nav-group-label">REVIEW</div>
        ${navItems.slice(4, 7).map((item) => navLink(item, route)).join('')}
        <div class="nav-group-label">ACCOUNT</div>
        ${accountItems.map((item) => navLink(item, route)).join('')}
      </nav>
      <div class="sidebar-bottom">
        <div class="streak-mini"><div class="streak-mini-top"><strong>오늘의 목표</strong><span>${studiedToday}/${goal}</span></div><div class="progress-track"><div class="progress-fill" style="width:${clamp(studiedToday / goal * 100, 0, 100)}%"></div></div></div>
        <button class="nav-link" type="button" data-action="logout">${icon('logout')}<span>로그아웃</span></button>
      </div>
    </aside>
    <header class="topbar">
      <div class="topbar-left"><button class="icon-btn mobile-menu" type="button" data-action="toggle-sidebar" aria-label="메뉴 열기">${icon('menu')}</button><button class="icon-btn back-button" type="button" data-action="history-back" aria-label="뒤로 가기">←</button><div class="breadcrumb"><span>${e(group)}</span>${icon('chevron', 'icon-sm')}<strong>${e(page)}</strong></div></div>
      <div class="topbar-actions">
        ${usage ? `<span class="usage-chip" title="한국 시간 자정에 초기화">AI ${usage.request_count || 0}/${usage.limit || ui.publicConfig?.dailyAiLimit || 20}</span>` : ''}
        <button class="icon-btn" type="button" data-action="toggle-theme" aria-label="${data.settings.darkMode ? '라이트' : '다크'} 모드">${icon(data.settings.darkMode ? 'sun' : 'moon')}</button>
        <div class="user-chip"><span class="user-avatar">${initial}</span><span><b>${e(accountLabel)}</b><small>${e(accountMeta)}</small></span></div>
      </div>
    </header>
    <main class="app-main" id="main-content"><div class="page-container">${content}</div></main>
    <nav class="mobile-nav" aria-label="모바일 메뉴">${[navItems[0], navItems[1], navItems[2], navItems[3], navItems[7]].map((item) => navLink(item, route, true)).join('')}</nav>
  </div>`;
}

function landingView() {
  const features = [
    ['book', '문맥 단어 반복', '외운 단어를 새로운 지문 속에서 다시 만나 진짜 내 단어로 만듭니다.'],
    ['target', '취약 유형 집중', '빈칸·순서·삽입 등 흔들리는 유형만 정확히 골라 반복합니다.'],
    ['chart', '소재 배경 강화', '경제·철학·과학처럼 낯선 소재를 연결해 읽는 힘을 기릅니다.'],
    ['edit', '능동적 지문 분석', '전환, 대립, 근거 문장을 직접 표시하며 사고 과정을 훈련합니다.'],
    ['brain', 'AI 비교 피드백', '내 분석과 모범 분석의 차이를 점수보다 구체적인 언어로 알려줍니다.'],
  ];
  return `<div class="landing">
    <header class="landing-nav">${brand()}<nav class="landing-links" aria-label="소개 메뉴"><button class="btn-ghost" data-action="scroll" data-target="features">핵심 기능</button><button class="btn-ghost" data-action="scroll" data-target="process">학습 방식</button><a class="btn-ghost" href="#/privacy">개인정보</a></nav><div class="landing-actions"><button class="icon-btn" data-action="toggle-theme" aria-label="테마 전환">${icon(data.settings.darkMode ? 'sun' : 'moon')}</button><a class="btn btn-secondary" href="#/login">로그인</a><a class="btn btn-primary" href="#/signup">회원가입</a></div></header>
    <main id="main-content">
      <section class="hero"><div class="hero-copy"><div class="hero-badge">${icon('spark', 'icon-sm')} 수능 영어를 이해하는 새로운 방식</div><h1>틀린 문제 하나를,<br><em>완전히 이해할 때까지.</em></h1><p>취약 유형, 모르는 단어, 약한 소재를 연결해 나만의 문제로 다시 만듭니다. 해설을 읽는 공부에서, 스스로 구조를 찾는 공부로.</p><div class="hero-actions"><a class="btn btn-primary btn-lg" href="#/signup">무료 계정 만들기 ${icon('arrow')}</a><button class="btn btn-secondary btn-lg" data-action="scroll" data-target="process">학습 방식 보기</button></div><div class="trust-row"><span class="avatar-stack"><span>DB</span><span>AI</span><span>PDF</span></span><span>계정별 동기화 · 안전한 AI 사용량 관리 · 인쇄형 분석서</span></div></div>
      <div class="hero-visual" aria-label="학습 대시보드 미리보기"><div class="demo-window"><div class="window-bar"><span class="window-dots"><i></i><i></i><i></i></span><span class="badge primary">LIVE DEMO</span></div><div class="mini-dashboard"><div class="mini-sidebar"><div class="mini-logo"></div><i class="mini-nav active"></i><i class="mini-nav"></i><i class="mini-nav"></i><i class="mini-nav"></i><i class="mini-nav"></i></div><div class="mini-main"><div class="mini-title"></div><div class="mini-stats"><div class="mini-stat"><i></i><b></b></div><div class="mini-stat"><i></i><b></b></div><div class="mini-stat"><i></i><b></b></div></div><div class="mini-focus"><span></span><strong></strong></div><div class="mini-bars"><i></i><i></i><i></i><i></i><i></i></div></div></div></div><div class="float-card one"><span class="float-icon">${icon('check', 'icon-sm')}</span><span><b>AI 의미 대조 평가</b><small>지문과 내 분석을 직접 비교해요</small></span></div><div class="float-card two"><span class="float-icon">${icon('lightning', 'icon-sm')}</span><span><b>실제 기록 기반 성장</b><small>고정 수치를 사용하지 않아요</small></span></div></div></section>
      <section class="landing-section alt" id="features"><div class="section-inner"><div class="section-heading"><div class="eyebrow">Why 홍동원</div><h2>오답의 이유를, 다음 정답의 근거로</h2><p>맞고 틀림만 기록하지 않습니다. 읽는 과정에서 놓친 모든 단서를 다음 학습에 연결합니다.</p></div><div class="feature-grid">${features.map((f, i) => `<article class="feature-card"><div class="feature-num">0${i + 1}</div><span class="feature-icon">${icon(f[0])}</span><h3>${f[1]}</h3><p>${f[2]}</p></article>`).join('')}</div></div></section>
      <section class="landing-section" id="process"><div class="section-inner"><div class="section-heading"><div class="eyebrow">Learning Loop</div><h2>한 번의 오답이 완전 학습이 되는 4단계</h2><p>학생의 능동 분석을 중심으로 매 학습이 다음 학습을 더 정교하게 만듭니다.</p></div><div class="process-grid">${[['틀린 문제 등록','지문과 내가 고른 답을 기록합니다.'],['취약 요소 표시','모르는 단어와 논리 구조를 직접 찾습니다.'],['맞춤 문제 생성','취약 유형×소재로 새 문제를 만듭니다.'],['분석 비교·반복','근거까지 확인해 완전 학습을 판정합니다.']].map((s,i)=>`<article class="process-step"><span class="step-dot">${i+1}</span><h3>${s[0]}</h3><p>${s[1]}</p></article>`).join('')}</div></div></section>
      <section class="landing-section alt" id="start"><div class="section-inner"><div class="landing-cta"><div><h2>오늘 틀린 문제, 오늘 끝내세요.</h2><p>회원가입 후 모든 기기에서 학습 기록과 분석서를 안전하게 이어가세요.</p></div><a class="btn btn-lg" href="#/signup">무료 계정 만들기 ${icon('arrow')}</a></div></div></section>
    </main><footer class="landing-footer">${brand()}<span>© 2026 홍동원 Study · <a href="#/privacy">개인정보 처리방침</a> · <a href="#/terms">이용약관</a></span></footer></div>`;
}

function loginView() {
  return `<div class="auth-page"><aside class="auth-aside">${brand()}<div class="auth-quote"><div class="eyebrow">Secure learning cloud</div><h1>정답을 맞히는 감각보다,<br>근거를 찾는 습관.</h1><p>학습 기록은 사용자 계정에 안전하게 동기화되고, 모든 AI 요청은 서버에서 인증과 사용량 검사를 거칩니다.</p></div><div class="auth-metric"><span><b>분석</b><small>글의 구조 직접 표시</small></span><span><b>동기화</b><small>Postgres 영구 저장</small></span><span><b>보안</b><small>계정별 요청 제한</small></span></div></aside>
    <main class="auth-main" id="main-content"><section class="auth-box"><a class="auth-back" href="#/landing">← 처음으로 돌아가기</a><h2>다시 만나서 반가워요</h2><p>아이디와 비밀번호로 로그인해 학습을 이어가세요.</p>${ui.publicConfig && !ui.publicConfig.authConfigured ? '<div class="auth-alert">배포 환경에 인증 정보가 아직 연결되지 않았습니다. README의 설정 절차를 완료해 주세요.</div>' : ''}<form class="auth-form" id="login-form"><div class="field"><label for="login-username">아이디</label><input class="control" id="login-username" name="username" minlength="4" maxlength="20" pattern="[A-Za-z0-9_]{4,20}" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="영문·숫자·밑줄 4~20자" required></div><div class="field"><label for="login-password">비밀번호</label><div class="password-wrap"><input class="control" id="login-password" name="password" type="password" minlength="8" maxlength="72" autocomplete="current-password" placeholder="8자 이상 입력" required><button class="password-toggle" type="button" data-action="toggle-password" aria-label="비밀번호 표시">●</button></div></div><div class="auth-options"><label class="check-row"><input type="checkbox" checked disabled> 안전하게 로그인 유지</label><button class="text-link" type="button" data-action="forgot-password">복구 코드로 재설정</button></div><button class="btn btn-primary btn-lg btn-block" type="submit" ${ui.authBusy ? 'disabled' : ''}>${ui.authBusy ? '로그인 확인 중…' : '로그인'}</button></form><p class="auth-foot">아직 계정이 없나요? <a class="text-link" href="#/signup">회원가입</a></p><div class="or">개발 환경 미리보기</div><button class="btn btn-secondary btn-block" type="button" data-action="demo-login">서버 기능 없이 화면 둘러보기</button><div class="policy-mini"><a href="#/privacy">개인정보 처리방침</a><span>·</span><a href="#/terms">이용약관</a></div></section></main></div>`;
}

function signupView() {
  return `<div class="auth-page"><aside class="auth-aside auth-aside-signup">${brand()}<div class="auth-quote"><div class="eyebrow">Start with evidence</div><h1>한 문제의 오답을,<br>한 권의 해설처럼.</h1><p>이미지나 PDF를 올리면 문장별 해석, 논리 흐름, 정답 근거, 오답 함정과 핵심 어휘를 분석서로 정리합니다.</p></div></aside><main class="auth-main" id="main-content"><section class="auth-box"><a class="auth-back" href="#/login">← 로그인으로 돌아가기</a><h2>무료 계정 만들기</h2><p>이메일 없이 아이디로 가입하고 모든 기기에서 학습 데이터를 동기화합니다.</p><form class="auth-form" id="signup-form"><div class="field"><label for="signup-name">이름</label><input class="control" id="signup-name" name="name" maxlength="40" autocomplete="name" required placeholder="학습 리포트에 표시할 이름"></div><div class="field"><label for="signup-username">아이디</label><input class="control" id="signup-username" name="username" minlength="4" maxlength="20" pattern="[A-Za-z0-9_]{4,20}" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="영문·숫자·밑줄 4~20자"><small class="field-help">로그인에 사용할 아이디이며, 영문 대소문자는 구분하지 않습니다.</small></div><div class="field"><label for="signup-password">비밀번호</label><div class="password-wrap"><input class="control" id="signup-password" name="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required placeholder="영문·숫자 포함 8자 이상"><button class="password-toggle" type="button" data-action="toggle-signup-password" aria-label="비밀번호 표시">●</button></div></div><label class="consent-card"><input type="checkbox" name="consent" required><span><b>필수 약관에 동의합니다.</b><small><a href="#/terms">이용약관</a>과 <a href="#/privacy">개인정보 처리방침</a>을 확인했으며, 서비스 제공을 위한 계정·학습 데이터 처리에 동의합니다.</small></span></label><button class="btn btn-primary btn-lg btn-block" type="submit" ${ui.authBusy ? 'disabled' : ''}>${ui.authBusy ? '계정을 만드는 중…' : '회원가입'}</button></form><p class="auth-foot">이미 계정이 있나요? <a class="text-link" href="#/login">로그인</a></p></section></main></div>`;
}

function resetPasswordView() {
  return `<div class="auth-page"><aside class="auth-aside">${brand()}<div class="auth-quote"><div class="eyebrow">Account recovery</div><h1>새 비밀번호로,<br>안전하게 다시 시작하세요.</h1><p>가입할 때 저장한 복구 코드로 이메일 없이 계정을 되찾을 수 있습니다.</p></div></aside><main class="auth-main" id="main-content"><section class="auth-box"><a class="auth-back" href="#/login">← 로그인으로 돌아가기</a><h2>비밀번호 재설정</h2><p>아이디와 복구 코드, 새 비밀번호를 입력해 주세요.</p><form class="auth-form" id="reset-password-form"><div class="field"><label for="reset-username">아이디</label><input class="control" id="reset-username" name="username" minlength="4" maxlength="20" autocomplete="username" autocapitalize="none" required></div><div class="field"><label for="reset-recovery-code">복구 코드</label><input class="control recovery-input" id="reset-recovery-code" name="recoveryCode" maxlength="48" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required></div><div class="field"><label for="reset-password">새 비밀번호</label><input class="control" id="reset-password" name="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></div><div class="field"><label for="reset-password-confirm">새 비밀번호 확인</label><input class="control" id="reset-password-confirm" name="confirmPassword" type="password" minlength="8" maxlength="72" autocomplete="new-password" required></div><button class="btn btn-primary btn-lg btn-block" type="submit" ${ui.authBusy ? 'disabled' : ''}>${ui.authBusy ? '변경 중…' : '비밀번호 변경'}</button></form></section></main></div>`;
}

function policyView(kind) {
  const privacy = kind === 'privacy';
  const operator = ui.publicConfig?.operatorName || '홍동원 Study';
  const email = ui.publicConfig?.privacyEmail || 'privacy@eon.study';
  const title = privacy ? '개인정보 처리방침' : '이용약관';
  const sections = privacy ? [
    ['1. 처리하는 개인정보', '계정 생성 시 아이디, 표시 이름, 인증 식별자를 처리합니다. 서비스 이용 중 업로드 파일의 이름·형식·크기, 추출된 문제 내용, 분석 결과, 학습 기록, AI 요청 횟수·토큰·추정 비용, 접속 시각과 오류 로그가 처리될 수 있습니다. 비밀번호와 복구 코드 원문은 저장하지 않으며 안전한 해시 형태로 관리합니다.'],
    ['2. 처리 목적', '회원 식별과 로그인, 사용자별 학습 데이터 동기화, AI 분석 제공과 오남용 방지, 일일 사용량 제한, 장애 대응, 보안 사고 조사, 서비스 품질 및 비용 관리 목적으로 처리합니다.'],
    ['3. 보유 기간', '계정과 학습 데이터는 회원 탈퇴 시까지 보관합니다. AI 사용량·비용 기록과 보안 로그는 분쟁 대응 및 오남용 방지를 위해 최대 1년, 오류 로그는 최대 90일 보관 후 삭제 또는 비식별화합니다. 법령상 별도 보존 의무가 있으면 해당 기간을 따릅니다.'],
    ['4. 처리 위탁 및 국외 이전', '인증·데이터베이스는 Supabase, 배포·로그는 Vercel, AI 분석은 설정된 AI 제공자를 이용합니다. 선택된 서비스의 처리 지역에 따라 국외 이전이 발생할 수 있으며, 전송 시 TLS를 사용하고 필요한 최소 데이터만 전달합니다. AI 요청에는 저장 비활성화 옵션을 적용합니다.'],
    ['5. 업로드 파일 보호', '업로드 파일은 허용 형식, 실제 파일 서명, 크기, PDF 활성 콘텐츠와 암호화 여부를 검사합니다. 원본은 공개 URL로 제공하지 않으며 분석 요청 처리 범위를 벗어나 임의 공유하지 않습니다. 사용자는 주민등록번호, 연락처 등 불필요한 개인정보가 포함된 파일을 업로드하지 않아야 합니다.'],
    ['6. 이용자 권리', '이용자는 설정에서 학습 데이터를 내려받거나 삭제할 수 있고, 계정 열람·정정·삭제·처리 제한을 요청할 수 있습니다. 요청은 아래 개인정보 문의처로 접수할 수 있습니다.'],
    ['7. 안전성 확보조치', '행 수준 접근 통제(RLS), 서버 전용 서비스 키, 계정별·분산 요청 제한, 보안 헤더, 입력 길이 제한, 업로드 매직바이트 검사, 구조화된 오류 로그와 관리자 접근 검사를 적용합니다.'],
    ['8. 문의처 및 변경', `${operator} 개인정보 문의: ${email}. 시행일은 2026년 7월 15일입니다. 중요한 변경은 서비스 화면을 통해 사전 안내합니다.`],
  ] : [
    ['1. 목적과 적용', `본 약관은 ${operator}가 제공하는 홍동원 영어 학습·AI 분석 서비스 이용 조건을 정합니다.`],
    ['2. 계정', '이용자는 아이디·비밀번호와 가입 시 발급되는 복구 코드를 안전하게 관리해야 합니다. 타인의 계정을 사용하거나 자동화 수단으로 제한을 우회해서는 안 됩니다. 복구 코드를 분실하면 운영자가 계정 소유권을 확인할 수 없어 복구가 제한될 수 있습니다.'],
    ['3. 서비스와 AI 결과', '서비스는 업로드한 영어 문제를 인식하고 해설·학습 자료를 생성합니다. AI 결과에는 오류가 있을 수 있으므로 시험 원문과 공식 정답을 함께 확인해야 하며, 서비스는 특정 점수나 학업 성과를 보장하지 않습니다.'],
    ['4. 허용되지 않는 이용', '악성 코드가 포함된 파일, 권리를 침해하는 자료, 불법·유해 콘텐츠를 업로드하거나 서비스·모델·요금 한도를 공격·우회·재판매해서는 안 됩니다. 보안 또는 안정성을 해치는 요청은 차단될 수 있습니다.'],
    ['5. 업로드 자료와 권리', '이용자는 업로드 자료를 처리할 권한이 있음을 보증합니다. 자료의 소유권은 이용자 또는 원권리자에게 유지되며, 이용자는 서비스 제공에 필요한 범위에서 분석·변환·저장할 수 있는 제한적 권한을 부여합니다.'],
    ['6. 사용량 제한', '공정한 이용과 비용 보호를 위해 계정별 일일 AI 한도와 단시간 요청 제한을 적용합니다. 한도는 요금제·운영 상황에 따라 변경될 수 있으며, 변경 시 서비스 화면에 표시합니다.'],
    ['7. 서비스 변경과 책임', '점검, 장애, 외부 제공자 정책 변경 또는 불가항력으로 서비스가 일시 중단될 수 있습니다. 고의 또는 중대한 과실이 없는 범위에서 간접·특별 손해에 대한 책임은 제한됩니다.'],
    ['8. 해지·분쟁·문의', `이용자는 언제든 계정 삭제를 요청할 수 있습니다. 대한민국 법률을 준거법으로 하며, 문의는 ${email}로 접수합니다. 시행일은 2026년 7월 15일입니다.`],
  ];
  return `<div class="policy-page"><header class="policy-header">${brand()}<div><a class="btn btn-secondary btn-sm" href="#/landing">홈</a><a class="btn btn-primary btn-sm" href="#/signup">동의하고 가입</a></div></header><main id="main-content" class="policy-document"><div class="eyebrow">LEGAL · 2026.07.15</div><h1>${title}</h1><p class="policy-lead">${privacy ? '홍동원은 학습에 필요한 최소 정보만 처리하고, 사용자가 자신의 데이터를 통제할 수 있도록 설계합니다.' : '서비스를 이용하기 전에 아래 권리와 책임을 확인해 주세요.'}</p>${sections.map(([heading, body]) => `<section><h2>${e(heading)}</h2><p>${e(body)}</p></section>`).join('')}<footer><a href="#/${privacy ? 'terms' : 'privacy'}">${privacy ? '이용약관' : '개인정보 처리방침'} 보기</a><span>·</span><a href="#/signup">회원가입으로 돌아가기</a></footer></main></div>`;
}

function pageHeading(title, description, actions = '') {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p><p class="page-hint"><span aria-hidden="true">ⓘ</span> 카드·행·단어를 누르면 상세 내용을 볼 수 있어요. 버튼은 다음 단계로 이동합니다.</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}

function dashboardView() {
  const history = data.learningHistory;
  const hasData = history.length > 0;
  const weekly = history.filter((h) => (new Date() - new Date(`${h.date}T00:00:00`)) / 86400000 <= 7);
  const problems = weekly.reduce((s, h) => s + h.problemCount, 0);
  const accuracy = weekly.length ? Math.round(weekly.reduce((s,h)=>s+h.correctCount,0) / weekly.reduce((s,h)=>s+h.problemCount,0) * 100) : 0;
  const analysis = average(weekly.map((h) => h.analysisAccuracy));
  const dueWords = data.vocabulary.filter((w) => w.nextReviewAt <= todayISO() && w.status !== '완전 학습').length;
  const masteredTypes = Object.values(data.weakTypes).filter((score) => score >= 90).length;
  const stats = [['book',problems,'이번 주 문제',''],['target',`${accuracy}%`,'정답률',''],['brain',`${analysis}%`,'분석 정확도',''],['clock',dueWords,'복습 예정 단어',''],['lightning',hasData?'1일':'0일','연속 학습',''],['check',`${masteredTypes}개`,'완전 학습 유형','']];
  const typeRows = Object.entries(data.weakTypes).sort((a,b)=>a[1]-b[1]).slice(0,7);
  const topicRows = Object.entries(data.weakTopics).sort((a,b)=>a[1]-b[1]);
  const weakWords = [...data.vocabulary].sort((a,b)=>a.masteryScore-b.masteryScore).slice(0,3).map(w=>w.word).join(' · ');
  const weakType = typeRows[0]?.[0];
  const weakTopic = topicRows[0]?.[0];
  const greeting = data.user.name ? `<span>${e(data.user.name)}님</span>, 오늘도 읽는 힘을 켜볼까요?` : '첫 학습을 시작해 볼까요?';
  const starterGuide = !hasData
    ? `<section class="card onboarding-card"><div><span class="badge primary">처음 사용하는 분</span><h2>3분이면 시작할 수 있어요</h2><p>오답 한 문제만 등록하면 단어, 구조, 근거, AI 비교까지 이어집니다.</p></div><div class="onboarding-steps"><div><b>1</b><span>오답 등록</span><small>지문·질문·선택지를 입력하세요.</small></div><div><b>2</b><span>단어 체크</span><small>모르는 단어를 눌러 저장하세요.</small></div><div><b>3</b><span>능동 분석</span><small>근거와 구조를 직접 표시하세요.</small></div><div><b>4</b><span>AI 비교</span><small>내 분석과 모범 답안을 비교합니다.</small></div></div><div class="onboarding-actions"><a class="btn btn-primary" href="#/register">첫 오답 등록하기 ${icon('arrow','icon-sm')}</a><a class="btn btn-secondary" href="#/generate">맞춤 문제 보기</a></div></section>`
    : `<section class="card onboarding-card compact"><div><span class="badge">빠른 시작</span><h2>막히는 부분부터 먼저 보세요</h2><p>오늘의 목표를 따라 오답 등록, 단어 복습, AI 비교를 이어가면 됩니다.</p></div><div class="onboarding-actions"><a class="btn btn-secondary" href="#/register">오답 등록</a><a class="btn btn-primary" href="#/vocabulary">단어 학습</a></div></section>`;
  return shell('dashboard', `<div class="welcome-row"><div><h1>${greeting}</h1><p>${hasData ? '최근 기록을 바탕으로 다음 학습을 준비했어요.' : '아직 저장된 학습 데이터가 없습니다. 틀린 문제를 하나 등록해 주세요.'}</p></div><div class="date-pill">${icon('calendar','icon-sm')}${todayLong()}</div></div>
    ${starterGuide}
    <section class="stat-grid" aria-label="학습 요약">${stats.map(s=>`<article class="card stat-card"><div class="stat-top"><span class="stat-icon">${icon(s[0])}</span>${s[3]?`<span class="stat-delta">${s[3]}</span>`:''}</div><div class="stat-value">${s[1]}</div><div class="stat-label">${s[2]}</div></article>`).join('')}</section>
    <div class="dashboard-grid"><section class="card focus-card"><div class="focus-top"><div><span class="badge">${hasData ? "TODAY'S FOCUS" : 'GET STARTED'}</span><h2>${hasData ? `${e(weakTopic || '혼합')} 소재 × ${e(weakType || '맞춤 유형')}` : '등록된 오답이 없습니다'}</h2><p>${hasData ? '가장 취약한 조합을 목표 단어와 함께 집중 학습해요.' : '직접 입력하거나 문제 사진을 올려 첫 분석을 시작하세요.'}</p></div>${icon(hasData?'spark':'plus')}</div>${hasData?`<div class="focus-meta"><div class="focus-meta-item"><small>취약 유형</small><b>${e(weakType||'분석 중')}</b></div><div class="focus-meta-item"><small>복습 소재</small><b>${e(weakTopic||'분석 중')}</b></div><div class="focus-meta-item"><small>목표 단어</small><b>${e(weakWords||'없음')}</b></div><div class="focus-meta-item"><small>오늘 목표</small><b>${data.settings.dailyGoal}문제</b></div></div>`:'<div style="height:34px"></div>'}<div class="focus-actions"><button class="btn" data-action="${hasData?'start-focus':'start-register'}">${hasData?'학습 시작':'오답 등록하기'} ${icon('arrow','icon-sm')}</button><div class="focus-progress"><small>오늘 목표 ${Math.min(problems, data.settings.dailyGoal)}/${data.settings.dailyGoal} 문제</small><div class="progress-track"><div class="progress-fill" style="width:${clamp(problems/data.settings.dailyGoal*100,0,100)}%"></div></div></div></div></section>
    <section class="card week-card"><div class="card-header"><div><h2>이번 주 성장</h2><p>${hasData?'실제 학습 기록으로 계산합니다.':'학습을 완료하면 변화가 표시됩니다.'}</p></div></div>${hasData?`<div class="week-ring-wrap"><div class="ring" style="--value:${analysis}"><div class="ring-content"><b>${analysis}%</b><small>분석 정확도</small></div></div><div class="week-list"><div class="week-list-row"><span>정답률</span><b>${accuracy}%</b></div><div class="week-list-row"><span>분석 정확도</span><b>${analysis}%</b></div><div class="week-list-row"><span>학습 문제</span><b>${problems}개</b></div></div></div>`:`<div class="empty-state" style="min-height:150px;padding:15px"><div><span class="empty-icon">${icon('trend')}</span><p class="muted">표시할 기록이 없습니다.</p></div></div>`}</section></div>
    <div class="analysis-grid"><section class="card card-pad"><div class="card-header"><div><h2>취약 유형 숙련도</h2><p>학습 후 실제 결과로 계산됩니다.</p></div><a class="text-link" href="#/insights">전체 보기</a></div>${typeRows.length?`<div class="bar-chart">${typeRows.map(([name,score])=>`<div class="bar-row ${score<50?'weak':score<65?'medium':''}"><span>${e(name)}</span><div class="bar-track"><div class="bar-value" style="width:${score}%"></div></div><strong>${score}</strong></div>`).join('')}</div>`:'<div class="empty-state" style="min-height:180px"><p class="muted">아직 유형 데이터가 없습니다.</p></div>'}</section><section class="card card-pad"><div class="card-header"><div><h2>소재별 이해도</h2><p>학습한 소재만 표시됩니다.</p></div></div>${topicRows.length?`<div class="topic-cloud">${topicRows.map(([name,score])=>`<div class="topic-score ${score<55?'weak':''}"><span>${e(name)}</span><b>${score}%</b></div>`).join('')}</div>`:'<div class="empty-state" style="min-height:180px"><p class="muted">아직 소재 데이터가 없습니다.</p></div>'}</section></div>
    <section class="card card-pad"><div class="card-header"><div><h2>최근 학습 기록</h2><p>${weakWords?`복습할 단어: ${e(weakWords)}`:'완료한 학습이 여기에 쌓입니다.'}</p></div><a class="text-link" href="#/history">전체 기록</a></div>${historyTable(history.slice(0,5))}</section>`);
}

function historyTable(rows) {
  if (!rows.length) return `<div class="empty-state"><div><span class="empty-icon">${icon('calendar')}</span><h3>아직 학습 기록이 없습니다</h3><p class="muted">문제를 등록하고 첫 학습을 완료해 보세요.</p></div></div>`;
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>학습 날짜</th><th>문제 유형</th><th>소재</th><th>점수</th><th>분석 정확도</th><th>상태</th></tr></thead><tbody>${rows.map(h=>`<tr><td>${formatDate(h.date, true)}</td><td><strong>${e(h.type)}</strong></td><td>${e(h.topic)}</td><td>${h.score}점</td><td><div class="score-cell"><span>${h.analysisAccuracy}%</span><span class="mini-progress"><i style="width:${h.analysisAccuracy}%"></i></span></div></td><td><span class="badge ${statusClass(h.status)}">${e(h.status)}</span></td></tr>`).join('')}</tbody></table></div>`;
}

function normalizeWordSenses(word) {
  const senses = Array.isArray(word?.senses) ? word.senses : [];
  return senses
    .map((sense, index) => ({
      index: index + 1,
      meaning: String(sense?.meaning || '').trim(),
      contextMeaning: String(sense?.contextMeaning || '').trim(),
      usage: String(sense?.usage || '').trim(),
      note: String(sense?.note || '').trim(),
    }))
    .filter((sense) => sense.meaning || sense.contextMeaning || sense.usage || sense.note);
}

function wordMeaningSummary(word, max = 2) {
  const senses = normalizeWordSenses(word);
  const rawPrimary = String(word?.meaning || '').trim();
  const placeholderPrimary = !rawPrimary || /AI .*대기|뜻 정리 대기|정리 대기/.test(rawPrimary);
  if (senses.length) {
    const core = senses.slice(0, max).map((sense) => sense.meaning).filter(Boolean);
    return {
      primary: placeholderPrimary ? (core[0] || 'AI 정리 대기') : rawPrimary,
      senses,
      compact: core.join(' · '),
      extraCount: Math.max(0, senses.length - max),
    };
  }
  return {
    primary: rawPrimary || 'AI 정리 대기',
    senses: [],
    compact: rawPrimary || 'AI 정리 대기',
    extraCount: 0,
  };
}

function manualConfirmationFields({ answer = 0, type = '', topic = '' } = {}) {
  const normalizedType = QUESTION_TYPES.includes(type) ? type : '';
  const normalizedTopic = TOPICS.includes(topic) ? topic : '';
  return `<details class="manual-confirmation">
    <summary>AI 연결 문제 때 직접 확정하기 <span class="badge">선택 사항</span></summary>
    <p class="subtle">AI 분석이 실패해도 아래 세 값을 입력하면 문제를 잃지 않고 바로 학습을 시작할 수 있습니다.</p>
    <div class="form-grid">
      <div class="field"><label>실제 정답</label><select class="control" name="manualCorrectAnswer"><option value="">정답 선택</option>${[1,2,3,4,5].map((number) => `<option value="${number}" ${answer === number ? 'selected' : ''}>${number}번</option>`).join('')}</select></div>
      <div class="field"><label>문제 유형</label><select class="control" name="manualType">${questionTypeOptions(normalizedType, true)}</select></div>
      <div class="field full"><label>지문 소재</label><select class="control" name="manualTopic"><option value="">소재 선택</option>${TOPICS.map((item) => `<option value="${e(item)}" ${item === normalizedTopic ? 'selected' : ''}>${e(item)}</option>`).join('')}</select></div>
    </div>
  </details>`;
}

function registerView() {
  const difficultyOptions = ['쉬움', '보통', '평가원 수준', '고난도 평가원 수준'];
  const draft = data.pendingRegistration || {};
  const direct = `<form id="problem-form" autocomplete="off">
    <div class="form-section card">
      <div class="form-section-title"><span>1</span><h2>지문과 문제</h2></div>
      <div class="form-grid">
        <div class="field full"><label for="passage">영어 지문</label><textarea class="control" id="passage" name="passage" maxlength="5000" placeholder="영어 지문을 입력하세요." required>${e(draft.passage || '')}</textarea></div>
        <div class="field full"><label for="question">질문</label><input class="control" id="question" name="question" maxlength="500" placeholder="문제의 질문을 입력하세요." required value="${e(draft.question || '')}"></div>
        <div class="field full"><span class="field-label">선택지 5개</span><div class="option-inputs">${[1,2,3,4,5].map(n=>`<label class="option-input"><span>${['①','②','③','④','⑤'][n-1]}</span><input class="control" name="option${n}" maxlength="500" aria-label="${n}번 선택지" required value="${e(draft.options?.[n-1] || '')}"></label>`).join('')}</div></div>
      </div>
    </div>
    <div class="form-section card" style="margin-top:16px">
      <div class="form-section-title"><span>2</span><h2>학습 정보</h2></div>
      <div class="ai-auto-card full"><span class="ai-auto-icon">${icon('spark')}</span><div><h3>AI가 자동으로 판정합니다</h3><p>입력한 지문·질문·선택지를 직접 풀어 정답을 정하고, 문제 유형과 지문 소재도 함께 분류합니다.</p><div class="segmented"><span class="tag">정답</span><span class="tag">문제 유형</span><span class="tag">지문 소재</span></div></div></div>
      <div class="form-grid">
        <div class="field"><label for="selected-answer">내가 선택한 답</label><select class="control" id="selected-answer" name="selectedAnswer" required><option value="" ${draft.selectedAnswer?'':'selected'} disabled>내 답 선택</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${draft.selectedAnswer===n?'selected':''}>${n}번</option>`).join('')}</select></div>
        <div class="field"><label for="difficulty">난이도</label><select class="control" id="difficulty" name="difficulty">${difficultyOptions.map(value=>`<option ${value===(draft.difficulty || '평가원 수준')?'selected':''}>${value}</option>`).join('')}</select></div>
        <div class="field full"><label for="source">시험 출처</label><input class="control" id="source" name="source" maxlength="100" placeholder="예: 2026학년도 6월 모의평가" value="${e(draft.source || '')}"></div>
      </div>
      ${manualConfirmationFields({ answer: draft.manualCorrectAnswer, type: draft.manualType, topic: draft.manualTopic })}
      <div class="divider"></div>
      <div class="registration-ai-status" data-registration-status hidden aria-live="polite">${icon('spark','icon-sm')}<span>AI 분석을 준비하고 있습니다.</span></div>
      <button class="btn btn-primary btn-lg" type="submit">AI 분석 후 학습 시작 ${icon('arrow')}</button>
    </div>
  </form>`;
  const ocr = ui.ocr;
  const ocrOptions = (ocr?.result?.options || Array(5).fill(''));
  const recognitionWarnings = ocr?.result?.warnings?.length ? `<div class="recognition-warnings"><b>확인이 필요한 부분</b><ul>${ocr.result.warnings.map((warning) => `<li>${e(warning)}</li>`).join('')}</ul></div>` : '';
  const ocrReview = ocr?.result ? `<form id="ocr-result-form" class="ocr-review">
    <div class="ocr-result-head"><div><span class="badge ${ocr.result.confidence >= 75 ? 'success' : 'warning'}">AI 판독 신뢰도 ${ocr.result.confidence}%</span><h2>인식 결과를 확인해 주세요</h2><p>잘못 인식된 글자나 줄바꿈을 고친 뒤 등록하면 됩니다.</p></div><button class="btn btn-secondary" type="button" data-action="clear-ocr">다른 파일</button></div>
    ${recognitionWarnings}
    <div class="form-grid">
      <div class="field full"><label for="ocr-passage">영어 지문 *</label><textarea class="control" id="ocr-passage" name="passage" maxlength="5000" required>${e(ocr.result.passage)}</textarea></div>
      <div class="field full"><label for="ocr-question">질문 *</label><input class="control" id="ocr-question" name="question" maxlength="500" required value="${e(ocr.result.question)}"></div>
      <div class="field full"><span class="field-label">선택지 5개 *</span><div class="option-inputs">${[1,2,3,4,5].map(n=>`<label class="option-input"><span>${['①','②','③','④','⑤'][n-1]}</span><input class="control" name="option${n}" maxlength="500" required aria-label="${n}번 선택지" value="${e(ocrOptions[n-1])}"></label>`).join('')}</div></div>
      <div class="field full"><div class="ai-auto-card"><span class="ai-auto-icon">${icon('spark')}</span><div><h3>이미지 판독과 1차 정답 분석을 완료했습니다</h3><p>문제를 저장할 때 추출된 텍스트를 독립적으로 다시 풀어 정답·유형·소재를 한 번 더 교차 검증합니다.</p><div class="segmented"><span class="tag">유형 · ${e(ocr.result.type)}</span><span class="tag">소재 · ${e(ocr.result.topic)}</span>${ocr.result.correctAnswer ? `<span class="tag">2단계 검증 준비</span>` : ''}</div></div></div></div>
      <div class="field"><label for="ocr-selected">내가 선택한 답</label><select class="control" id="ocr-selected" name="selectedAnswer" required><option value="" selected disabled>내 답 선택</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n}번</option>`).join('')}</select></div>
      <input type="hidden" name="difficulty" value="평가원 수준"><input type="hidden" name="source" value="${e(ocr.result.source || 'AI 이미지 등록')}">
    </div>
    ${manualConfirmationFields()}
    <label class="consent-card report-option"><input type="checkbox" name="createReport" checked><span><b>문제 저장 후 인쇄형 AI 분석서 자동 생성</b><small>문장별 해석·논리 흐름·정답 근거·선택지 함정·핵심 어휘를 정리하고 PDF/PNG 다운로드를 준비합니다. AI 사용량 1회가 차감됩니다.</small></span></label>
    <details class="ocr-raw"><summary>AI가 읽은 전체 원문 보기</summary><pre>${e(ocr.result.rawText)}</pre></details>
    <div class="registration-ai-status" data-registration-status hidden aria-live="polite">${icon('spark','icon-sm')}<span>AI 분석을 준비하고 있습니다.</span></div>
    <button class="btn btn-primary btn-lg" type="submit">확인한 문제로 학습 시작 ${icon('arrow')}</button>
  </form>` : '';
  const uploadPreview = ocr?.mime === 'application/pdf' || ocr?.file?.type === 'application/pdf'
    ? `<span class="pdf-preview">${icon('book')}<b>${e(ocr.file.name)}</b><small>PDF 문서 · ${(ocr.file.size/1024/1024).toFixed(1)}MB</small></span>`
    : ocr?.preview ? `<img class="ocr-preview" src="${ocr.preview}" alt="업로드한 영어 문제 이미지">` : '';
  const upload = `<section class="card form-section"><label class="upload-zone ${ocr ? 'has-image' : ''}" for="problem-image">${uploadPreview || `<span>${icon('upload')}<h3>문제 이미지 또는 PDF를 올려 주세요</h3><p>파일을 끌어 놓거나 눌러서 선택하세요.</p><small>JPG, PNG, WEBP, PDF · 최대 ${ui.publicConfig?.maxUploadMb || 12}MB · PDF 12쪽 이하</small></span>`}<input class="sr-only" id="problem-image" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>${ocr && !ocr.result ? `<div class="ocr-file-card"><div><b>${e(ocr.file.name)}</b><p>${(ocr.file.size/1024/1024).toFixed(1)}MB · ${ocr.error ? e(ocr.error) : '서버가 파일 서명과 위험 요소를 검사한 뒤 AI가 문제를 판독합니다.'}</p></div>${ocr.busy ? `<span class="badge primary">AI 판독 중</span>` : `<button class="btn btn-primary" data-action="start-ocr">${icon('spark','icon-sm')} AI로 문서 인식</button>`}</div>` : ''}${ocr?.busy ? `<div class="ocr-progress" aria-live="polite"><div class="ocr-progress-top"><span id="ocr-status">문서를 준비하고 있습니다.</span><b id="ocr-percent">0%</b></div><div class="progress-track"><div class="progress-fill" id="ocr-progress-bar" style="width:0%"></div></div><small>파일 형식과 크기를 검사한 뒤 AI가 지문과 선택지를 읽습니다.</small></div>` : ''}${ocrReview}</section>`;
  const example = `<section class="card form-section"><div class="example-preview"><span class="badge primary">홍동원 SAMPLE 01</span><h2 style="margin:14px 0 8px;font-size:17px">선택의 역설과 진정한 자유</h2><p class="english-passage">${e(sourceProblem.passage)}</p><div class="divider"></div><p style="font-size:12px"><strong>${e(sourceProblem.question)}</strong></p><div class="segmented"><span class="tag">${e(sourceProblem.type)}</span><span class="tag">${e(sourceProblem.topic)}</span><span class="tag">${e(sourceProblem.difficulty)}</span></div><button class="btn btn-primary btn-lg" style="margin-top:20px" data-action="load-example">이 예시로 분석 시작 ${icon('arrow')}</button></div></section>`;
  return shell('register', `${pageHeading('틀린 문제 등록', '오답을 등록하면 모르는 단어와 사고 과정을 차근차근 분석해요.')}
    <div class="stepper"><span class="stepper-item active"><i class="stepper-num">1</i>문제 등록</span><span class="stepper-item"><i class="stepper-num">2</i>단어 표시</span><span class="stepper-item"><i class="stepper-num">3</i>능동 분석</span><span class="stepper-item"><i class="stepper-num">4</i>AI 비교</span></div>
    <div class="tabs" role="tablist">${[['direct','edit','직접 입력'],['upload','upload','파일 업로드'],['example','book','예시 불러오기']].map(t=>`<button class="tab ${ui.registerTab===t[0]?'active':''}" type="button" role="tab" aria-selected="${ui.registerTab===t[0]}" data-action="register-tab" data-tab="${t[0]}">${icon(t[1])}<span>${t[2]}</span></button>`).join('')}</div>
    <div class="register-layout"><div>${ui.registerTab==='direct'?direct:ui.registerTab==='upload'?upload:example}</div><aside class="card sticky-help"><div class="help-illustration">${icon('edit')}</div><h3>좋은 오답 기록이란?</h3><p>문제의 정답보다 내가 왜 그 선택지를 골랐는지가 더 중요한 학습 정보예요.</p><div class="help-list"><div class="help-item"><i>1</i><span>지문과 선택지를 빠짐없이 입력해 주세요.</span></div><div class="help-item"><i>2</i><span>내가 고른 답만 직접 선택해 주세요.</span></div><div class="help-item"><i>3</i><span>정답·유형·소재는 AI가 문제를 분석해 결정합니다.</span></div></div></aside></div>`);
}

function ensureAnalysis() {
  if (!data.currentProblem) return null;
  if (!data.currentAnalysis || data.currentAnalysis.problemId !== data.currentProblem.id) {
    data.currentAnalysis = {
      problemId: data.currentProblem.id,
      unknownWords: [], topic: '', core: '', claim: '', purpose: '', mood: '',
      roles: {}, logic: [], evidenceIndex: null, confidence: 0, submitted: false,
    };
    saveData(data);
  }
  return data.currentAnalysis;
}

function passageTokens(passage, knownWords = [], selected = []) {
  const wordMap = new Map(knownWords.map((w) => [w.word.toLowerCase(), w]));
  const chunks = passage.split(/([A-Za-z]+(?:'[A-Za-z]+)?)/g);
  return chunks.map((chunk) => {
    if (!/^[A-Za-z]/.test(chunk)) return e(chunk);
    const lower = chunk.toLowerCase();
    const selectedClass = selected.some((w) => w.word.toLowerCase() === lower) ? ' selected' : '';
    const info = wordMap.get(lower);
    return `<button class="word-token${selectedClass}" type="button" data-action="word-info" data-word="${e(lower)}" ${info ? `data-known="true"` : ''}>${e(chunk)}</button>`;
  }).join('');
}

function analysisView() {
  if (!data.currentProblem) return emptyGuard('분석할 문제가 없습니다.', '오답을 먼저 등록한 뒤 능동 분석을 시작해 주세요.', 'register');
  const problem = data.currentProblem;
  const analysis = ensureAnalysis();
  const sentences = problem.sentences?.length ? problem.sentences : problem.passage.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) || [problem.passage];
  const completion = analysisCompletion(analysis);
  const allKnown = [...(problem.words || sourceProblem.words), ...data.vocabulary];
  const roleList = sentences.map((sentence, index) => `<button class="sentence ${analysis.roles[index] ? 'has-role' : ''}" type="button" data-action="analysis-sentence" data-index="${index}">${analysis.roles[index] ? `<span class="sentence-role">${e(analysis.roles[index])}</span>` : ''}${e(sentence)}</button>`).join('');
  const evidenceList = sentences.map((sentence, index) => `<button class="sentence ${analysis.evidenceIndex === index ? 'evidence' : ''}" type="button" data-action="evidence-sentence" data-index="${index}" aria-pressed="${analysis.evidenceIndex === index}">${analysis.evidenceIndex === index ? '<span class="sentence-role" style="color:var(--success)">✓ 정답 근거로 선택</span>' : ''}${e(sentence)}</button>`).join('');
  return shell('analysis', `${pageHeading('지문을 직접 해부해 보세요', 'AI 해설은 분석을 제출한 뒤에만 공개됩니다.', `<button class="btn btn-secondary" data-action="create-report" ${ui.reportBusy ? 'disabled' : ''}>${icon('book','icon-sm')} ${ui.reportBusy ? '분석서 생성 중…' : 'AI 분석서 만들기'}</button><span class="badge warning">해설 잠금 중</span>`)}
    <div class="stepper"><span class="stepper-item done"><i class="stepper-num">✓</i>문제 등록</span><span class="stepper-item active"><i class="stepper-num">2</i>단어 표시</span><span class="stepper-item active"><i class="stepper-num">3</i>능동 분석</span><span class="stepper-item"><i class="stepper-num">4</i>AI 비교</span></div>
    <section class="card analysis-guide"><div><span class="badge primary">처음이면 이렇게</span><h2>왼쪽은 지문, 오른쪽은 생각 정리</h2><p>지문에서 모르는 단어를 먼저 표시하고, 아래 칸에 소재·주장·논리 구조를 적은 뒤 AI와 비교하세요.</p></div><div class="analysis-guide-grid"><div><b>1</b><span>단어 표시</span><small>모르는 표현을 눌러 뜻을 확인합니다.</small></div><div><b>2</b><span>분석 입력</span><small>소재, 핵심 내용, 주장, 목적을 적습니다.</small></div><div><b>3</b><span>근거 선택</span><small>지문에서 정답 근거가 되는 문장을 고릅니다.</small></div></div></section>
    <div class="analysis-workspace"><section class="card passage-panel panel-sticky"><div class="card-header"><div><span class="badge primary">${e(problem.type)}</span> <span class="badge">${e(problem.topic)} 소재</span><h2 style="margin-top:10px">원문 지문</h2><p>모르는 단어를 누르면 뜻을 확인하고 저장할 수 있어요.</p></div><span class="badge">${e(problem.source || '직접 등록')}</span></div><div class="passage-tools"><span class="tag">정답 ${problem.correctAnswer}번</span><span class="tag">내 선택 ${problem.selectedAnswer}번</span><span class="tag">${e(problem.difficulty || '평가원 수준')}</span>${problem.analyzedByAI ? `<span class="tag">AI 판정 ${problem.aiConfidence}%</span>` : ''}</div><div class="english-passage">${passageTokens(problem.passage, allKnown, analysis.unknownWords)}</div><div class="selected-words"><span class="field-label" style="width:100%">저장할 모르는 단어 · ${analysis.unknownWords.length}개</span>${analysis.unknownWords.length ? analysis.unknownWords.map((w)=>`<span class="word-chip">${e(w.word)}<button type="button" data-action="remove-word" data-word="${e(w.word)}" aria-label="${e(w.word)} 삭제">×</button></span>`).join('') : '<span class="subtle" style="font-size:10px">지문에서 단어를 눌러 표시해 보세요.</span>'}</div></section>
    <form class="analysis-form" id="analysis-form"><section class="card analysis-section"><h2>1. 기본 분석</h2><p>번역보다 먼저, 글이 무엇을 말하려는지 내 언어로 정리하세요.</p><div class="form-grid"><div class="field"><label for="analysis-topic">글의 소재 *</label><input class="control" id="analysis-topic" name="topic" maxlength="80" required value="${e(analysis.topic)}" placeholder="예: 선택의 자유"></div><div class="field"><label for="analysis-mood">글의 분위기 *</label><select class="control" id="analysis-mood" name="mood" required><option value="">선택하세요</option>${['비판적','설득적','낙관적','객관적','성찰적'].map(v=>`<option ${analysis.mood===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field full"><label for="analysis-core">핵심 내용 *</label><textarea class="control" id="analysis-core" name="core" maxlength="500" required placeholder="글 전체를 한두 문장으로 요약하세요.">${e(analysis.core)}</textarea></div><div class="field full"><label for="analysis-claim">필자의 주장 *</label><input class="control" id="analysis-claim" name="claim" maxlength="300" required value="${e(analysis.claim)}" placeholder="필자가 독자에게 가장 강조하는 생각"></div><div class="field full"><label for="analysis-purpose">글의 목적 *</label><input class="control" id="analysis-purpose" name="purpose" maxlength="300" required value="${e(analysis.purpose)}" placeholder="예: 선택지의 수와 진정한 자유의 관계를 재고하게 하려는 것"></div></div></section>
    <section class="card analysis-section"><h2>2. 문장 구조 분석</h2><p>문장을 클릭하고 글에서 수행하는 역할을 지정하세요. 2개 이상 표시해야 해요.</p><div class="sentence-list">${roleList}</div></section>
    <section class="card analysis-section"><h2>3. 논리 구조</h2><p>이 글에서 발견한 관계를 모두 선택하세요.</p><div class="segmented">${LOGIC_STRUCTURES.map((name,i)=>`<span class="segment"><input type="checkbox" id="logic-${i}" name="logic" value="${e(name)}" ${analysis.logic.includes(name)?'checked':''}><label for="logic-${i}">${e(name)}</label></span>`).join('')}</div></section>
    <section class="card analysis-section"><h2>4. 정답 근거</h2><p>정답을 결정하는 데 가장 직접적인 문장 하나를 선택하세요.</p><div class="sentence-list">${evidenceList}</div></section>
    <section class="card analysis-section"><h2>5. 답에 대한 확신도</h2><p>문제를 처음 풀었을 때의 확신을 솔직하게 표시하세요.</p><div class="confidence" role="group" aria-label="확신도">${[1,2,3,4,5].map(n=>`<button class="${analysis.confidence===n?'selected':''}" type="button" data-action="confidence" data-value="${n}" aria-pressed="${analysis.confidence===n}">${n}</button>`).join('')}</div></section>
    <div class="analysis-submit-bar"><div class="completion-text"><span class="completion-count" id="completion-count">${completion.done}/${completion.total}</span><span>필수 분석 항목을 완성해 주세요.</span></div><button class="btn btn-primary" id="analysis-submit" type="submit" ${completion.done < completion.total ? 'disabled' : ''}>분석 제출하고 AI와 비교 ${icon('arrow','icon-sm')}</button></div></form></div>`);
}

function analysisCompletion(analysis) {
  const values = [analysis.topic.trim(), analysis.core.trim(), analysis.claim.trim(), analysis.purpose.trim(), analysis.mood, Object.keys(analysis.roles).length >= 2, analysis.logic.length > 0, analysis.evidenceIndex !== null, analysis.confidence > 0];
  return { done: values.filter(Boolean).length, total: values.length };
}

function feedbackView() {
  const analysis = data.currentAnalysis;
  if (!analysis?.submitted || !analysis?.aiEvaluation) return emptyGuard('AI 평가가 필요한 분석이에요.', '기존 고정 점수는 폐기했습니다. 분석을 다시 제출하면 AI가 지문과 직접 대조합니다.', 'analysis');
  const evaluation = analysis.aiEvaluation;
  const scores = evaluation.scores;
  const overall = evaluation.overallScore;
  const scoreNames = { topic:'소재', mood:'분위기', core:'핵심 내용', claim:'필자 주장', purpose:'글의 목적', structure:'글의 구조', logic:'논리 관계', evidence:'정답 근거', vocabulary:'핵심 단어' };
  const list = (items) => `<ul>${items.map((item) => `<li>${e(item)}</li>`).join('')}</ul>`;
  const reference = evaluation.referenceAnalysis;
  return shell('feedback', `${pageHeading('AI 분석 비교', '내가 읽은 방식과 AI의 분석을 나란히 비교해 보세요.', `<a class="btn btn-secondary" href="#/analysis">내 분석 다시 보기</a>`)}
    <section class="card feedback-hero"><div class="ring feedback-ring" style="--value:${overall};width:156px;height:156px"><div class="ring-content"><b>${overall}%</b><small>AI 의미 평가</small></div></div><div class="feedback-summary"><span class="badge success">${e(evaluation.verdict)}</span><h2>지문 기준 AI 대조 평가</h2><p>${e(evaluation.summary)}</p><div class="score-tags">${Object.entries(scores).map(([k,v])=>`<span class="tag">${scoreNames[k]} <strong>${Math.round(v)}</strong></span>`).join('')}</div><small class="subtle">${e(evaluation.model)} · ${evaluation.attempts}회 시도 · 글자 수가 아닌 의미 일치도로 채점</small></div></section>
    <div class="feedback-grid"><article class="card feedback-card"><span class="feedback-card-icon">${icon('check')}</span><h3>잘한 점</h3>${list(evaluation.strengths)}</article><article class="card feedback-card missed"><span class="feedback-card-icon">${icon('x')}</span><h3>보완할 점</h3>${list(evaluation.improvements)}</article><article class="card feedback-card thinking"><span class="feedback-card-icon">${icon('brain')}</span><h3>사고 과정 교정</h3><p>${e(evaluation.thinkingCorrection)}</p></article><article class="card feedback-card reread"><span class="feedback-card-icon">${icon('book')}</span><h3>다시 확인할 문장</h3><p class="english-passage" style="font-size:14px">“${e(evaluation.rereadSentence)}”</p></article></div>
    <section class="card card-pad" style="margin-top:16px"><div class="card-header"><div><h2>항목별 AI 판정</h2><p>각 입력을 지문의 의미와 직접 대조한 결과입니다.</p></div></div><div class="compare-list">${Object.entries(scores).map(([k,v])=>`<div class="compare-item ai-compare-item"><span><strong>${scoreNames[k]}</strong><small>${e(evaluation.criterionFeedback[k])}</small></span><b style="color:${v>=70?'var(--success)':v>=50?'var(--warning)':'var(--danger)'}">${Math.round(v)}점</b></div>`).join('')}</div></section>
    <section class="card card-pad" style="margin-top:16px"><div class="card-header"><div><h2>AI 기준 분석</h2><p>학생 답안을 보기 전에 지문에서 독립적으로 도출한 모범 분석입니다.</p></div></div><div class="reference-analysis"><div><span>소재</span><p>${e(reference.topic)}</p></div><div><span>분위기</span><p>${e(reference.mood)}</p></div><div><span>핵심 내용</span><p>${e(reference.core)}</p></div><div><span>필자의 주장</span><p>${e(reference.claim)}</p></div><div><span>글의 목적</span><p>${e(reference.purpose)}</p></div><div><span>논리 구조</span><p>${e(reference.logicStructures.join(' · '))}</p></div><div><span>정답 근거</span><p class="english-passage">${e(reference.evidenceSentence)}</p></div></div><div class="divider"></div><div style="display:flex;justify-content:flex-end;gap:9px"><a class="btn btn-secondary" href="#/register">새 오답 등록</a><a class="btn btn-primary" href="#/generate">이 취약점으로 맞춤 문제 생성 ${icon('arrow','icon-sm')}</a></div></section>`);
}

function generatorView() {
  const hasLearningData = data.learningHistory.length > 0;
  const weakestWords = [...data.vocabulary].sort((a,b)=>a.masteryScore-b.masteryScore).slice(0,3).map(w=>w.word).join(', ');
  const weakType = Object.entries(data.weakTypes).sort((a,b)=>a[1]-b[1])[0]?.[0];
  const weakTopic = Object.entries(data.weakTopics).sort((a,b)=>a[1]-b[1])[0]?.[0];
  const selectedType = QUESTION_TYPES.includes(weakType) ? weakType : (QUESTION_TYPES.includes(data.currentProblem?.type) ? data.currentProblem.type : DEFAULT_QUESTION_TYPE);
  const selectedTopic = TOPICS.includes(weakTopic) ? weakTopic : (TOPICS.includes(data.currentProblem?.topic) ? data.currentProblem.topic : '경제');
  const radioCards = (name, items, selected) => `<div class="radio-cards">${items.map((item,i)=>`<span class="radio-card"><input id="${name}-${i}" type="radio" name="${name}" value="${e(item)}" ${item===selected?'checked':''}><label for="${name}-${i}">${e(item)}</label></span>`).join('')}</div>`;
  return shell('generate', `${pageHeading('나만의 실전 모의고사 만들기', 'AI가 150~220단어 지문과 5개 선택지를 갖춘 평가원형 문제를 새로 출제해요.')}
    <div class="recommend-banner"><span class="stat-icon">${icon(hasLearningData?'spark':'info')}</span><div><b>${hasLearningData?`추천 조합 · ${e(weakType)} × ${e(weakTopic)}`:'아직 맞춤 추천 데이터가 없습니다'}</b><p>${hasLearningData?'실제 학습 기록에서 숙련도가 가장 낮은 조합입니다.':'오답 분석이나 문제 풀이를 완료하면 취약점을 바탕으로 추천합니다.'}</p></div></div>
    <form id="generator-form" class="generator-layout"><section class="card settings-card"><div class="setting-block"><h3>문제 유형 활용 방식</h3><p>추천을 활용하거나 아래에서 최종 출제 유형을 직접 정할 수 있어요.</p>${radioCards('typeMode',['원본과 같은 유형','내가 취약한 유형','직접 선택'],'내가 취약한 유형')}<label class="generator-select"><span>최종 출제 유형</span><select class="control" name="questionType">${questionTypeOptions(selectedType)}</select></label></div><div class="setting-block"><h3>소재 활용 방식</h3><p>같은 논리를 낯선 소재에서도 찾아내는 연습을 해요.</p>${radioCards('topicMode',['원본과 유사한 소재','같은 소재의 다른 세부 주제','취약 소재','랜덤 소재'],'취약 소재')}<label class="generator-select"><span>최종 지문 소재</span><select class="control" name="topic">${TOPICS.map((topic)=>`<option value="${e(topic)}" ${topic===selectedTopic?'selected':''}>${e(topic)}</option>`).join('')}</select></label></div><div class="setting-block"><h3>난이도</h3><p>현재 설정의 선호 난이도가 기본으로 적용됩니다.</p><div class="segmented">${['쉬움','보통','어려움','평가원 수준','고난도 평가원 수준'].map((v,i)=>`<span class="segment"><input type="radio" id="difficulty-${i}" name="difficulty" value="${v}" ${v===data.settings.preferredDifficulty?'checked':''}><label for="difficulty-${i}">${v}</label></span>`).join('')}</div></div><div class="setting-block"><h3>단어 반복 방식</h3><p>AI가 문맥에 자연스러운 저장 단어를 문제당 2~5개 골라 포함합니다.</p>${radioCards('wordMode',['저장된 모르는 단어 자동 포함','이번 문제 선택 단어만','오래 복습하지 않은 단어 우선','숙련도가 낮은 단어 우선'],'숙련도가 낮은 단어 우선')}</div><div class="setting-block"><h3>생성 문제 수</h3><div class="segmented">${[3,5,10].map(n=>`<span class="segment"><input type="radio" id="count-${n}" name="problemCount" value="${n}" ${n===3?'checked':''}><label for="count-${n}">${n}문제${n===3?' · 안정적 추천':''}</label></span>`).join('')}</div></div></section>
    <aside class="card generate-summary"><div class="summary-visual"><span class="orbit">${icon('brain')}</span></div><h2 style="font-size:17px">실전형 생성 기준</h2><div class="summary-list"><div class="summary-row"><span>영어 지문</span><b>문제당 150~220단어</b></div><div class="summary-row"><span>선택지</span><b>평가원형 5개</b></div><div class="summary-row"><span>반복 단어</span><b>${e(weakestWords||'저장된 단어 없음')}</b></div><div class="summary-row"><span>이미지</span><b>문제지 PNG 제공</b></div></div><button class="btn btn-primary btn-lg btn-block" type="submit">${icon('spark')} 실전 모의고사 생성</button><p class="subtle" style="margin:13px 0 0;font-size:9px;text-align:center">AI가 출제한 뒤 분량·선택지·정답 형식을 한 번 더 검사합니다.</p></aside></form>`);
}

async function showGeneration(count, options) {
  const overlay = document.createElement('div');
  overlay.className = 'generation-overlay';
  const steps = ['학습 조건과 목표 단어를 분석하고 있습니다.','150~220단어의 지문을 설계하고 있습니다.','평가원형 발문과 오답 선택지를 만들고 있습니다.','정답과 근거 문장을 직접 검토하고 있습니다.','모든 문항의 분량과 형식을 검사하고 있습니다.'];
  overlay.innerHTML = `<div class="generation-content"><div class="ai-loader">${icon('spark')}</div><h2>맞춤 문제를 만들고 있어요</h2><p>${data.learningHistory.length ? '저장된 학습 기록을 바탕으로 문제를 구성합니다.' : '선택한 설정을 바탕으로 새 문제를 구성합니다.'}</p><div class="loading-steps">${steps.map((s,i)=>`<div class="loading-step ${i===0?'active':''}" data-loading-step="${i}"><i></i><span>${s}</span></div>`).join('')}</div></div>`;
  document.body.append(overlay);
  steps.forEach((_, index) => {
    ui.generationTimers.push(setTimeout(() => {
      overlay.querySelectorAll('.loading-step').forEach((el,i) => el.className = `loading-step ${i<index?'done':i===index?'active':''}`);
    }, index * 2400));
  });

  const wordSource = options.wordMode === '이번 문제 선택 단어만' && data.currentAnalysis?.unknownWords?.length ? data.currentAnalysis.unknownWords : data.vocabulary;
  const rankedWords = [...wordSource].sort((a,b) => {
    if (options.wordMode === '오래 복습하지 않은 단어 우선') return String(a.lastSeenAt || '').localeCompare(String(b.lastSeenAt || ''));
    return (a.masteryScore || 0) - (b.masteryScore || 0);
  }).slice(0, 12).map((word) => ({ word: word.word, meaning: word.meaning, masteryScore: word.masteryScore || 0 }));
  const input = {
    originalPassage: data.currentProblem?.passage || '',
    originalQuestion: data.currentProblem?.question || '',
    questionType: options.questionType,
    topic: options.topic,
    difficulty: options.difficulty,
    unknownWords: rankedWords,
    problemCount: count,
  };

  try {
    const generated = await generateProblemSet(input, (status) => {
      const message = overlay.querySelector('.generation-content > p');
      if (message) message.textContent = status;
    });
    data.activeSet = { id: `set_${Date.now()}`, ...generated, options };
    data.generatedProblemSets.unshift(data.activeSet);
    data.practiceSession = { setId: data.activeSet.id, currentIndex: 0, answers: Array(generated.problems.length).fill(null), evidence: Array(generated.problems.length).fill(null), startedAt: Date.now(), elapsed: 0, submitted: false };
    saveData(data);
    overlay.remove();
    toast('실전 모의고사를 만들었어요.', `${generated.problems.length}문제 · 모든 지문 135단어 이상 검수 완료`);
    go('practice');
  } catch (error) {
    console.error('[generation-ui] generation failed', error);
    ui.generationTimers.forEach(clearTimeout);
    ui.generationTimers = [];
    overlay.remove();
    const fallbackMessages = {
      TIMEOUT: '생성 시간이 초과되었습니다. 문제 수를 3개로 줄여 다시 시도해 주세요.',
      INCOMPLETE_GENERATION: 'AI 결과가 실전 모의고사 분량에 미달했습니다. 다시 생성해 주세요.',
    };
    toast('문제를 만들지 못했어요.', fallbackMessages[error.code] || describeAIError(error), 'error');
  }
}

function ensurePractice() {
  if (!data.activeSet?.problems?.length) return null;
  const count = data.activeSet.problems.length;
  if (!data.practiceSession || data.practiceSession.setId !== data.activeSet.id || data.practiceSession.submitted) {
    data.practiceSession = { setId: data.activeSet.id, currentIndex: 0, answers: Array(count).fill(null), evidence: Array(count).fill(null), startedAt: Date.now(), elapsed: 0, submitted: false };
    saveData(data);
  }
  return data.practiceSession;
}

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])/g).filter(Boolean);
}

function practiceView() {
  const session = ensurePractice();
  if (!session) return emptyGuard('풀 문제가 없습니다.', '문제 생성 설정을 선택하고 새 문제 세트를 만들어 주세요.', 'generate');
  const problems = data.activeSet.problems;
  const index = clamp(session.currentIndex, 0, problems.length - 1);
  session.currentIndex = index;
  const problem = problems[index];
  const selected = session.answers[index];
  const evidence = session.evidence[index];
  const sentences = splitSentences(problem.passage);
  const passage = sentences.map((sentence, i) => `<span class="exam-sentence ${evidence===i?'evidence-mark':''}" data-action="practice-evidence" data-index="${i}" role="button" tabindex="0">${e(sentence)} </span>`).join('');
  return shell('practice', `<div class="practice-shell"><div class="practice-top"><div class="practice-progress"><div class="practice-progress-label"><span>${e(data.activeSet.setTitle)}</span><b>${index + 1} / ${problems.length}</b></div><div class="progress-track"><div class="progress-fill" style="width:${(index+1)/problems.length*100}%"></div></div></div><div class="timer" id="practice-timer">${icon('clock','icon-sm')}<span>경과 시간</span><b>00:00</b></div></div>
    <article class="card question-card"><div class="question-meta"><div class="question-number"><strong>${index + 1}.</strong><span class="badge primary">${e(problem.type)}</span><span class="badge">${e(problem.topic)}</span></div><span class="subtle" style="font-size:10px">${e(problem.difficulty)} · ${problem.passageWordCount || (problem.passage.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)||[]).length} words</span></div><p class="question-prompt">${e(problem.question)}</p><div class="exam-passage">${passage}</div><div class="options" role="radiogroup" aria-label="답안 선택">${problem.options.map((option,i)=>`<button class="option ${selected===i+1?'selected':''}" type="button" role="radio" aria-checked="${selected===i+1}" data-action="select-answer" data-answer="${i+1}"><span class="option-num">${['①','②','③','④','⑤'][i]}</span><span>${e(option)}</span></button>`).join('')}</div>
    <div class="question-toolbar"><div class="question-tools"><button class="btn btn-secondary" type="button" data-action="practice-help">${icon('book','icon-sm')} 목표 단어</button><button class="btn btn-secondary ${evidence!==null?'active':''}" type="button" data-action="evidence-help">${icon('target','icon-sm')} ${evidence!==null?'근거 선택됨':'정답 근거 표시'}</button><button class="btn btn-secondary" type="button" data-action="problem-image">${icon('image','icon-sm')} 문제지 이미지</button></div><div style="display:flex;gap:8px"><button class="btn btn-secondary" type="button" data-action="prev-problem" ${index===0?'disabled':''}>이전</button>${index < problems.length-1 ? `<button class="btn btn-primary" type="button" data-action="next-problem">다음 ${icon('arrow','icon-sm')}</button>` : `<button class="btn btn-primary" type="button" data-action="submit-practice">전체 제출 ${icon('check','icon-sm')}</button>`}</div></div></article>
    <nav class="problem-nav" aria-label="문제 바로가기">${problems.map((_,i)=>`<button class="problem-dot ${i===index?'current':''} ${session.answers[i]!==null?'answered':''}" type="button" data-action="jump-problem" data-index="${i}" aria-label="${i+1}번 문제">${i+1}</button>`).join('')}</nav></div>`);
}

async function showProblemImage() {
  const index = data.practiceSession?.currentIndex || 0;
  const problem = data.activeSet?.problems?.[index];
  if (!problem) return;
  ui.imageCanvas = null;
  modal({
    title: `${index + 1}번 문제지 이미지`,
    body: '<div class="exam-image-loading"><span class="ai-loader mini"></span><p>인쇄형 문제지 이미지를 만들고 있습니다.</p></div><div id="exam-image-preview" class="exam-image-preview"></div>',
    actions: '<button class="btn btn-secondary" data-action="close-modal">닫기</button><button class="btn btn-primary" data-action="download-problem-image" disabled>PNG 이미지 저장</button>',
  });
  document.querySelector('[data-modal] .modal')?.classList.add('exam-image-modal');
  try {
    const canvas = await renderProblemSheetToCanvas(problem, index + 1);
    const preview = document.querySelector('#exam-image-preview');
    if (!preview) return;
    document.querySelector('.exam-image-loading')?.remove();
    preview.append(canvas);
    ui.imageCanvas = canvas;
    const download = document.querySelector('[data-action="download-problem-image"]');
    if (download) download.disabled = false;
  } catch (error) {
    console.error('[exam-image] render failed', error);
    closeModal();
    toast('문제지 이미지를 만들지 못했어요.', error.message || '잠시 후 다시 시도해 주세요.', 'error');
  }
}

function startPracticeTimer() {
  const timerEl = document.querySelector('#practice-timer b');
  if (!timerEl || !data.practiceSession) return;
  const tick = () => {
    const elapsed = Math.floor((Date.now() - data.practiceSession.startedAt) / 1000) + (data.practiceSession.elapsed || 0);
    const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const sec = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${min}:${sec}`;
  };
  tick();
  ui.practiceTimer = setInterval(tick, 1000);
}

function finishPractice() {
  const session = data.practiceSession;
  const problems = data.activeSet.problems;
  const unanswered = session.answers.filter((v) => v === null).length;
  if (unanswered) {
    modal({ title: '아직 풀지 않은 문제가 있어요', body: `<p class="muted"><strong>${unanswered}문제</strong>의 답을 선택하지 않았습니다. 제출 전 답안을 다시 확인해 주세요.</p>`, actions: `<button class="btn btn-secondary" data-action="close-modal">계속 풀기</button><button class="btn btn-primary" data-action="force-submit">그래도 제출</button>` });
    return;
  }
  calculateResults();
}

function calculateResults() {
  closeModal();
  const session = data.practiceSession;
  const problems = data.activeSet.problems;
  const correctCount = problems.filter((p,i)=>session.answers[i]===p.correctAnswer).length;
  const correctEvidence = problems.filter((problem, index) => {
    if (session.evidence[index] === null) return false;
    const sentences = splitSentences(problem.passage);
    const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
    const expected = normalize(problem.evidenceSentence);
    const selectedSentence = normalize(sentences[session.evidence[index]] || '');
    return Boolean(selectedSentence && expected) && (selectedSentence.includes(expected) || expected.includes(selectedSentence));
  }).length;
  const evidenceAccuracy = Math.round(correctEvidence / problems.length * 100);
  const score = Math.round(correctCount / problems.length * 100);
  const analysisAccuracy = Math.round((score * .55) + (evidenceAccuracy * .45));
  const wordAccuracy = null;
  const elapsed = Math.max(60, Math.floor((Date.now() - session.startedAt) / 1000) + (session.elapsed || 0));
  const passes = { score: score >= 60 && correctCount >= Math.min(3, problems.length), analysis: analysisAccuracy >= 70, evidence: evidenceAccuracy >= 70 };
  const passed = Object.values(passes).every(Boolean);
  session.submitted = true;
  session.result = { correctCount, score, evidenceAccuracy, analysisAccuracy, wordAccuracy, elapsed, passes, passed, completedAt: new Date().toISOString() };
  const type = problems[0]?.type || '맞춤 학습';
  const topic = problems[0]?.topic || '혼합';
  data.learningHistory.unshift({ id:`h_${Date.now()}`, date:todayISO(), type, topic, problemCount:problems.length, correctCount, score, analysisAccuracy, evidenceAccuracy, wordAccuracy, studyMinutes:Math.ceil(elapsed/60), status:passed?'1차 통과':'복습 필요' });
  const typeMastery = Math.round((score + analysisAccuracy + evidenceAccuracy) / 3);
  const topicMastery = Math.round((score + evidenceAccuracy) / 2);
  data.weakTypes[type] = data.weakTypes[type] === undefined ? typeMastery : Math.round((data.weakTypes[type] * 2 + typeMastery) / 3);
  data.weakTopics[topic] = data.weakTopics[topic] === undefined ? topicMastery : Math.round((data.weakTopics[topic] * 2 + topicMastery) / 3);
  problems.forEach((problem,i) => {
    (problem.includedTargetWords || []).forEach((target) => {
      const word = data.vocabulary.find((w)=>w.word.toLowerCase()===target.toLowerCase());
      if (!word) return;
      word.exposureCount += 1;
      word.lastSeenAt = todayISO();
      if (session.answers[i] === problem.correctAnswer) { word.correctCount += 1; word.masteryScore = clamp(word.masteryScore + 8,0,100); }
      else { word.incorrectCount += 1; word.masteryScore = clamp(word.masteryScore - 7,0,100); word.status = '복습 필요'; word.nextReviewAt = todayISO(); }
    });
  });
  saveData(data);
  go('results');
}

function resultsView() {
  const session = data.practiceSession;
  if (!session?.submitted || !session.result) return emptyGuard('아직 완료한 문제 세트가 없어요.', '맞춤 문제를 풀고 제출하면 상세 결과가 표시됩니다.', 'generate');
  const r = session.result;
  const problems = data.activeSet.problems;
  const status = r.passed ? '1차 학습 완료' : '복습이 조금 더 필요해요';
  const metrics = [[`${r.correctCount}/${problems.length}`,'정답 개수'],[`${r.score}%`,'정답률'],[`${r.analysisAccuracy}%`,'풀이·근거 종합'],[`${r.evidenceAccuracy}%`,'근거 정확도'],['측정 안 함','단어 인식률'],[`${Math.round(r.elapsed/problems.length)}초`,'평균 풀이 시간']];
  return shell('results', `${pageHeading('맞춤 학습 결과', '정답뿐 아니라 근거와 분석 과정을 함께 평가했어요.', '<a class="btn btn-secondary" href="#/dashboard">대시보드로</a>')}
    <section class="card result-banner"><div><div class="result-kicker">LEARNING REPORT</div><h1>${status}</h1><p>${r.passed ? '모든 기준을 통과했습니다. 다른 날짜에 2회 더 통과하면 완전 학습으로 판정돼요.' : '틀린 문제와 기준 미달 항목은 자동으로 복습 목록에 유지됩니다.'}</p></div><div class="result-score"><strong>${r.score}</strong><span>FINAL SCORE / 100</span></div></section>
    <section class="result-metrics">${metrics.map(m=>`<article class="card metric-card"><b>${m[0]}</b><span>${m[1]}</span></article>`).join('')}</section>
    <section class="card mastery-check"><div><h2>완전 학습 판정 · <span style="color:${r.passed?'var(--success)':'var(--warning)'}">${r.passed?'1차 통과':'복습 필요'}</span></h2><p>5문제 중 3문제 이상 정답과 아래 세 기준을 모두 충족해야 합니다. 별도 단어 시험 없이 단어 인식률을 추정하지 않습니다.</p><div class="criteria">${[['score','정답률 60%'],['analysis','풀이·근거 종합 70%'],['evidence','정답 근거 70%']].map(([k,label])=>`<span class="criterion ${r.passes[k]?'pass':'fail'}">${icon(r.passes[k]?'check':'x','icon-sm')}${label}</span>`).join('')}</div></div><a class="btn btn-primary" href="#/generate">${r.passed?'다음 세트 학습':'취약점 다시 학습'} ${icon('arrow','icon-sm')}</a></section>
    <section><div class="card-header" style="margin:24px 0 13px"><div><h2>문제별 상세 분석</h2><p>문제를 눌러 정답 근거와 해설을 확인하세요.</p></div></div><div class="result-detail">${problems.map((p,i)=>{const correct=session.answers[i]===p.correctAnswer;return `<article class="card result-item ${correct?'':'wrong'}"><button class="result-item-head" type="button" data-action="toggle-result"><span class="result-state">${icon(correct?'check':'x','icon-sm')}</span><span><b>${i+1}번 · ${e(p.type)}</b><span>${e(p.topic)} · ${correct?'정답':'오답'}</span></span>${icon('chevron')}</button><div class="result-item-body"><div class="answer-compare"><div class="answer-box"><span>내가 선택한 답</span><b>${session.answers[i] || '미응답'}번 · ${session.answers[i] ? e(p.options[session.answers[i]-1]) : '-'}</b></div><div class="answer-box"><span>정답</span><b style="color:var(--success)">${p.correctAnswer}번 · ${e(p.options[p.correctAnswer-1])}</b></div></div><div class="explanation-box"><strong>정답 근거</strong><br>“${e(p.evidenceSentence)}”<br><br><strong>AI 해설</strong><br>${e(p.explanation)}</div><div class="segmented" style="margin-top:12px">${p.includedTargetWords.map(w=>`<span class="tag">${e(w)}</span>`).join('')}</div></div></article>`}).join('')}</div></section>`);
}

function vocabularyExamples(word) {
  return Array.isArray(word?.examples) ? word.examples.filter((example) => example?.sentence && example?.translation).slice(0, 4) : [];
}

function vocabularyRow(w) {
  const examples = vocabularyExamples(w);
  const senses = wordMeaningSummary(w, 2);
  const recentSentence = String(w.recentSentence || '저장된 문맥이 없습니다.');
  const contextMeaning = String(w.contextMeaning || w.meaning || '뜻 정리 대기 중');
  return `<tr class="vocab-row" data-action="word-detail" data-word-id="${e(w.id)}"><td><span class="vocab-word"><b>${e(w.word)}</b><small>${e(w.partOfSpeech || 'word')}${w.pronunciation ? ` · ${e(w.pronunciation)}` : ''}</small></span></td><td><strong>${e(senses.primary)}</strong><br><span class="vocab-context">${e(contextMeaning)}</span>${senses.senses.length ? `<div class="vocab-sense-summary">${senses.senses.slice(0, 2).map((sense) => `<span class="sense-chip">${e(sense.meaning)}</span>`).join('')}${senses.extraCount ? `<span class="sense-chip more">+${senses.extraCount}</span>` : ''}</div>` : ''}</td><td>${examples.length ? `<span class="vocab-example-preview"><b>${e(examples[0].sentence)}</b><small>${e(examples[0].translation)}</small><em>AI 예문 ${examples.length}개</em><button class="vocab-open-link" type="button" data-action="word-detail" data-word-id="${e(w.id)}">예문 ${examples.length}개 모두 보기 <span aria-hidden="true">→</span></button></span>` : `<span class="badge warning">AI 예문 정리 대기</span><br><span title="${e(recentSentence)}">${e(recentSentence.slice(0,34))}${recentSentence.length>34?'…':''}</span><button class="vocab-open-link" type="button" data-action="word-detail" data-word-id="${e(w.id)}">단어 상세 열기 <span aria-hidden="true">→</span></button>`}</td><td>${w.exposureCount || 1}회</td><td><div class="mastery-bar"><div class="progress-track"><div class="progress-fill" style="width:${w.masteryScore || 0}%"></div></div><b>${w.masteryScore || 0}</b></div></td><td>${formatDate(w.nextReviewAt || todayISO())}</td><td><span class="badge ${statusClass(w.status || '신규')}">${e(w.status || '신규')}</span></td></tr>`;
}

function vocabularyView() {
  let words = [...data.vocabulary];
  if (ui.vocabularyFilter !== '전체') words = words.filter((w)=>w.status===ui.vocabularyFilter);
  if (ui.vocabularySearch) words = words.filter((w)=>`${w.word} ${w.meaning} ${w.contextMeaning} ${(w.senses || []).map((sense) => `${sense.meaning} ${sense.contextMeaning} ${sense.usage}`).join(' ')}`.toLowerCase().includes(ui.vocabularySearch.toLowerCase()));
  if (ui.vocabularySort === 'mastery') words.sort((a,b)=>a.masteryScore-b.masteryScore);
  if (ui.vocabularySort === 'review') words.sort((a,b)=>a.nextReviewAt.localeCompare(b.nextReviewAt));
  if (ui.vocabularySort === 'exposure') words.sort((a,b)=>b.exposureCount-a.exposureCount);
  const filters = ['전체','신규','학습 중','복습 필요','거의 암기','완전 학습'];
  return shell('vocabulary', `${pageHeading('단어 학습 관리', '외운 횟수가 아니라 문맥에서 알아본 경험을 기준으로 관리해요.', `<button class="btn btn-primary" data-action="review-words">${icon('play','icon-sm')} 오늘 단어 복습</button>`)}
    <div class="toolbar"><div class="filter-group">${filters.map(f=>`<button class="filter-btn ${ui.vocabularyFilter===f?'active':''}" data-action="vocab-filter" data-filter="${f}">${f}</button>`).join('')}</div><div style="display:flex;gap:8px"><label class="search-box">${icon('search')}<span class="sr-only">단어 검색</span><input class="control" id="vocab-search" value="${e(ui.vocabularySearch)}" placeholder="단어 검색"></label><select class="control" id="vocab-sort" aria-label="단어 정렬" style="min-height:38px;width:160px;font-size:11px"><option value="mastery" ${ui.vocabularySort==='mastery'?'selected':''}>숙련도 낮은 순</option><option value="review" ${ui.vocabularySort==='review'?'selected':''}>복습일 빠른 순</option><option value="exposure" ${ui.vocabularySort==='exposure'?'selected':''}>노출 많은 순</option></select></div></div>
    <section class="card card-pad">${words.length ? `<div class="data-table-wrap"><table class="data-table vocab-table"><thead><tr><th>단어</th><th>대표 뜻 / 여러 뜻</th><th>AI 학습 예문</th><th>노출</th><th>숙련도</th><th>다음 복습</th><th>상태</th></tr></thead><tbody>${words.map(vocabularyRow).join('')}</tbody></table></div>` : `<div class="empty-state"><div><span class="empty-icon">${icon('search')}</span><h3>조건에 맞는 단어가 없어요.</h3><p class="muted">지문에서 모르는 단어를 누르면 AI가 대표 뜻, 여러 의미, 예문 4개를 정리해 저장합니다.</p></div></div>`}</section>`);
}

function wordDetail(id) {
  const w = data.vocabulary.find((item)=>item.id===id);
  if (!w) return;
  const senses = wordMeaningSummary(w, 3);
  const examples = vocabularyExamples(w);
  const sensesHtml = senses.senses.length ? `<div class="sense-grid">${senses.senses.map((sense, index) => `<article class="sense-card"><span class="sense-index">${index + 1}</span><div><b>${e(sense.meaning)}</b><p>${e(sense.contextMeaning || sense.usage || sense.note || '문맥 설명이 없습니다.')}</p>${sense.usage ? `<small>${e(sense.usage)}</small>` : ''}${sense.note ? `<em>${e(sense.note)}</em>` : ''}</div></article>`).join('')}</div>` : '<div class="word-ai-pending"><b>여러 뜻은 AI 정리 후 표시됩니다.</b><p>아래 버튼을 누르면 문맥 뜻과 예문 4개를 자동으로 만듭니다.</p></div>';
  const examplesHtml = examples.length ? `<div class="vocab-example-list">${examples.map((example, index) => `<article class="vocab-example"><span>${index + 1}</span><div><b>${e(example.sentence)}</b><p>${e(example.translation)}</p>${example.focus ? `<small>${e(example.focus)}</small>` : ''}</div></article>`).join('')}</div>` : '<div class="word-ai-pending"><b>AI 예문이 아직 정리되지 않았어요.</b><p>아래 버튼을 누르면 문맥 뜻과 예문 4개를 자동으로 만듭니다.</p></div>';
  const enrichmentButton = examples.length >= 3 ? '' : `<button class="btn btn-secondary" data-action="retry-word-enrichment" data-word-id="${e(w.id)}">${icon('spark','icon-sm')} AI 뜻·예문 만들기</button>`;
  modal({ title:'단어 상세 학습 · 뜻과 예문을 모두 확인하세요', body:`<div class="word-detail-top"><div><h3>${e(w.word)}</h3><p>${e(w.partOfSpeech || 'word')}${w.pronunciation ? ` · ${e(w.pronunciation)}` : ''}</p></div><strong>${w.masteryScore || 0}</strong></div><div class="detail-list"><div class="detail-row meaning-pair"><div><small>대표 뜻</small><p><strong>${e(senses.primary)}</strong></p></div><div><small>문맥 속 의미</small><p>${e(w.contextMeaning || w.meaning || 'AI 정리 대기')}</p></div></div><div class="detail-row"><small>뜻 여러 개</small>${sensesHtml}</div><div class="detail-row"><small>최근 등장 문장</small><p class="english-passage" style="font-size:14px">${e(w.recentSentence || '저장된 문맥이 없습니다.')}</p></div><div class="detail-row"><small>AI 학습 예문 · ${examples.length}개 (아래에 모두 표시)</small>${examplesHtml}</div>${w.learningTip ? `<div class="detail-row learning-tip"><small>기억 팁</small><p>${e(w.learningTip)}</p></div>` : ''}<div class="detail-row"><small>학습 기록</small><p>총 ${w.exposureCount || 1}회 노출 · 정답 ${w.correctCount || 0}회 · 오답 ${w.incorrectCount || 0}회</p></div><div class="detail-row"><small>숙련도 변화</small><div class="mastery-timeline">${[18,32,28,45,w.masteryScore || 0].map(v=>`<i style="height:${v}%"></i>`).join('')}</div></div><div class="detail-row"><small>다음 복습</small><p>${formatDate(w.nextReviewAt || todayISO(),true)} · <span class="badge ${statusClass(w.status || '신규')}">${e(w.status || '신규')}</span></p></div></div>`, actions:`${enrichmentButton}<button class="btn btn-secondary" data-action="close-modal">닫기</button><button class="btn btn-primary" data-action="review-one" data-word-id="${e(w.id)}">지금 복습</button>` });
}

function insightsView() {
  const typeEntries = Object.entries(data.weakTypes).sort((a,b)=>a[1]-b[1]);
  const topicEntries = Object.entries(data.weakTopics).sort((a,b)=>a[1]-b[1]);
  const selected = ui.insightTab === 'type' ? typeEntries : topicEntries;
  const label = ui.insightTab === 'type' ? '유형' : '소재';
  if (!typeEntries.length && !topicEntries.length) {
    return shell('insights', `${pageHeading('취약 유형 및 소재 분석', '학습 기록을 바탕으로 다음에 무엇을 공부해야 할지 우선순위를 정해요.')}<section class="card empty-state"><div><span class="empty-icon">${icon('chart')}</span><h2>아직 분석할 학습 데이터가 없습니다</h2><p class="muted">문제를 등록하고 학습을 완료하면 유형과 소재별 결과가 표시됩니다.</p><a class="btn btn-primary" href="#/register">첫 오답 등록 ${icon('arrow','icon-sm')}</a></div></section>`);
  }
  const weakType = typeEntries[0]?.[0] || '분석 중';
  const weakTopic = topicEntries[0]?.[0] || '분석 중';
  const recordMetrics = (name) => {
    const records = data.learningHistory.filter((item) => (ui.insightTab === 'type' ? item.type : item.topic) === name);
    const problemCount = records.reduce((sum, item) => sum + item.problemCount, 0);
    const correctCount = records.reduce((sum, item) => sum + item.correctCount, 0);
    const accuracy = problemCount ? Math.round(correctCount / problemCount * 100) : 0;
    const analysisAccuracy = records.length ? average(records.map((item) => item.analysisAccuracy)) : 0;
    const recent = records.slice(0, 2).map((item) => item.analysisAccuracy);
    const change = recent.length > 1 ? recent[0] - recent[1] : 0;
    return { problemCount, accuracy, analysisAccuracy, change };
  };
  const growth = [...data.learningHistory].reverse().slice(-6).map((item) => Number(item.analysisAccuracy) || 0);
  const graphValues = growth.length ? growth : [0];
  const graphPoints = graphValues.map((value, index) => {
    const x = graphValues.length === 1 ? 260 : 20 + index * (480 / (graphValues.length - 1));
    const y = 190 - Math.min(100, Math.max(0, value)) * 1.6;
    return [Math.round(x), Math.round(y)];
  });
  const graphPath = graphPoints.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
  const growthDelta = graphValues.length > 1 ? graphValues.at(-1) - graphValues[0] : 0;
  const evaluation = data.currentAnalysis?.aiEvaluation;
  const coachText = evaluation?.improvements?.[0] || evaluation?.summary || 'AI 의미 평가를 완료하면 지문별 보완 방향이 여기에 표시됩니다.';
  const scoreLabels = { topic:'소재', mood:'분위기', core:'핵심 내용', claim:'필자 주장', purpose:'글의 목적', structure:'글의 구조', logic:'논리 관계', evidence:'정답 근거', vocabulary:'핵심 단어' };
  const coachTags = evaluation?.scores
    ? Object.entries(evaluation.scores).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([key]) => scoreLabels[key])
    : [];
  return shell('insights', `${pageHeading('취약 유형 및 소재 분석', '학습 기록을 바탕으로 다음에 무엇을 공부해야 할지 우선순위를 정해요.')}
    <section class="card insight-hero"><span class="stat-icon">${icon('target')}</span><div><h2>현재 숙련도가 가장 낮은 조합은 ‘${e(weakType)} × ${e(weakTopic)}’입니다.</h2><p>실제 학습 결과를 기준으로 계산했습니다.</p></div><a class="btn btn-primary" href="#/generate">추천 학습 시작 ${icon('arrow','icon-sm')}</a></section>
    <div class="tabs"><button class="tab ${ui.insightTab==='type'?'active':''}" data-action="insight-tab" data-tab="type">${icon('chart')}<span>유형 분석</span></button><button class="tab ${ui.insightTab==='topic'?'active':''}" data-action="insight-tab" data-tab="topic">${icon('book')}<span>소재 분석</span></button></div>
    <div class="insight-columns"><section class="card card-pad"><div class="card-header"><div><h2>${label}별 숙련도</h2><p>낮은 점수 순으로 표시합니다.</p></div></div><div class="analysis-list">${selected.map(([name,score],i)=>{const metrics=recordMetrics(name);return `<article class="analysis-row"><div class="analysis-row-top"><span><strong style="color:var(--text)">${i+1}. ${e(name)}</strong></span><b style="color:${score<55?'var(--danger)':score<70?'var(--warning)':'var(--success)'}">${score}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${score}%;background:${score<55?'var(--danger)':score<70?'var(--warning)':'var(--success)'}"></div></div><div class="analysis-row-meta"><div><b>${metrics.problemCount}문제</b><small>풀이 수</small></div><div><b>${metrics.accuracy}%</b><small>정답률</small></div><div><b>${metrics.analysisAccuracy}%</b><small>풀이·근거 종합</small></div><div><b>${metrics.change>0?'+':''}${metrics.change}%p</b><small>최근 변화</small></div></div></article>`}).join('')}</div></section>
    <section class="card card-pad"><div class="card-header"><div><h2>성장 흐름</h2><p>최근 ${graphValues.length}회 실제 학습의 풀이·근거 종합 변화예요.</p></div><span class="badge ${growthDelta>=0?'success':'warning'}">${growthDelta>0?'+':''}${growthDelta}%p</span></div><svg viewBox="0 0 520 220" style="width:100%;height:auto;overflow:visible" role="img" aria-label="최근 학습 점수 ${graphValues.join(', ')}"><path d="M20 190H500M20 136H500M20 83H500M20 30H500" stroke="var(--line)" stroke-width="1"/><path d="${graphPath}" fill="none" stroke="var(--primary)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${graphPoints.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="5" fill="var(--surface)" stroke="var(--primary)" stroke-width="3"/>`).join('')}</svg><div class="divider"></div><h3 style="font-size:14px">AI 학습 코치의 제안</h3><p class="muted" style="font-size:11px">${e(coachText)}</p>${coachTags.length?`<div class="segmented">${coachTags.map((tag)=>`<span class="tag">${e(tag)}</span>`).join('')}</div>`:'<p class="subtle">능동 분석을 AI와 비교하면 개인화 제안이 생성됩니다.</p>'}</section></div>`);
}

function historyView() {
  const history = data.learningHistory;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year,month,1).getDay();
  const days = new Date(year,month+1,0).getDate();
  const studied = new Set(history
    .filter((h) => {
      const date = new Date(`${h.date}T00:00:00`);
      return date.getFullYear() === year && date.getMonth() === month;
    })
    .map((h) => Number(h.date.slice(8,10))));
  const calendar = [...Array(firstDay).fill(null), ...Array.from({length:days},(_,i)=>i+1)];
  const totalProblems = history.reduce((s,h)=>s+h.problemCount,0);
  const totalCorrect = history.reduce((s,h)=>s+h.correctCount,0);
  const totalMinutes = history.reduce((s,h)=>s+h.studyMinutes,0);
  const avgAnalysis = average(history.map(h=>h.analysisAccuracy));
  const accuracy = totalProblems ? Math.round(totalCorrect / totalProblems * 100) : 0;
  const streak = countStreak(history);
  const typeCounts = history.reduce((counts, item) => ({ ...counts, [item.type]: (counts[item.type] || 0) + (item.problemCount - item.correctCount) }), {});
  const topicCounts = history.reduce((counts, item) => ({ ...counts, [item.topic]: (counts[item.topic] || 0) + item.problemCount }), {});
  const mostWrongType = Object.entries(typeCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '없음';
  const mostStudiedTopic = Object.entries(topicCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '없음';
  return shell('history', `${pageHeading('학습 기록', '매일 쌓인 작은 분석이 어떻게 실력으로 이어지는지 확인하세요.', '<button class="btn btn-secondary" data-action="export-data">학습 데이터 내보내기</button>')}
    <div class="history-top"><section class="card calendar"><div class="calendar-head"><h2>${year}년 ${month+1}월</h2><span class="badge primary">${streak}일 연속 학습</span></div><div class="calendar-grid">${['일','월','화','수','목','금','토'].map(d=>`<span class="cal-weekday">${d}</span>`).join('')}${calendar.map(day=>day===null?'<span class="cal-day empty"></span>':`<button class="cal-day ${studied.has(day)?'has-study':''} ${day===now.getDate()?'today':''}" data-action="calendar-day" data-day="${day}">${day}</button>`).join('')}</div></section><section class="card weekly-summary"><div class="card-header"><div><h2>이번 달 요약</h2><p>${history.length?'실제 학습 기록을 합산했습니다.':'아직 완료한 학습이 없습니다.'}</p></div></div><div class="summary-stat-grid"><div class="summary-stat"><b>${totalProblems}</b><span>총 학습 문제</span></div><div class="summary-stat"><b>${accuracy}%</b><span>평균 정답률</span></div><div class="summary-stat"><b>${avgAnalysis}%</b><span>분석 정확도</span></div><div class="summary-stat"><b>${Math.floor(totalMinutes/60)}h ${totalMinutes%60}m</b><span>학습 시간</span></div></div><div class="divider"></div><div class="summary-row"><span>가장 많이 틀린 유형</span><b>${e(mostWrongType)}</b></div><div class="summary-row" style="margin-top:11px"><span>가장 많이 학습한 소재</span><b>${e(mostStudiedTopic)}</b></div><div class="summary-row" style="margin-top:11px"><span>저장된 단어</span><b>${data.vocabulary.length}개</b></div></section></div>
    <section class="card card-pad"><div class="card-header"><div><h2>전체 학습 내역</h2><p>날짜별 문제 수, 정확도와 학습 상태를 확인하세요.</p></div><span class="badge">총 ${history.length}회</span></div>${historyTable(history)}</section>`);
}

async function generateReportForProblem(problem = data.currentProblem) {
  if (!problem || ui.reportBusy) return null;
  if (!hasRealSession()) {
    toast('실제 로그인이 필요해요.', 'AI 분석서는 회원 계정으로 로그인한 뒤 만들 수 있습니다.', 'error');
    go('login');
    return null;
  }
  ui.reportBusy = true;
  ui.reportStatus = '지문 분석을 준비하고 있습니다.';
  render();
  try {
    const generated = await createProblemReport(problem, (status) => {
      ui.reportStatus = status;
      const node = document.querySelector('[data-report-status]');
      if (node) node.textContent = status;
    });
    data.analysisReports = Array.isArray(data.analysisReports) ? data.analysisReports : [];
    data.analysisReports = data.analysisReports.filter((item) => item.problemId !== problem.id);
    data.analysisReports.unshift({ ...generated, problem: { ...problem } });
    data.currentReportId = generated.id;
    saveData(data);
    await pushCloudData().catch(() => null);
    toast('인쇄형 AI 분석서를 완성했어요.', '웹에서 확인하거나 PDF·PNG로 내려받을 수 있습니다.');
    go(`report?id=${encodeURIComponent(generated.id)}`);
    return generated;
  } catch (error) {
    console.error('[report-ui] generation failed', error);
    toast('분석서를 만들지 못했어요.', describeAIError(error, error.message || '잠시 후 다시 시도해 주세요.'), 'error');
    return null;
  } finally {
    ui.reportBusy = false;
    ui.reportStatus = '';
    if (currentRoute() === 'analysis' || currentRoute() === 'reports') render();
  }
}

function reportsView() {
  const reports = Array.isArray(data.analysisReports) ? data.analysisReports : [];
  return shell('reports', `${pageHeading('AI 분석서 보관함', '업로드한 문제를 인쇄형 해설 구조로 정리하고 PDF·PNG로 보관하세요.', `<button class="btn btn-primary" data-action="create-report" ${!data.currentProblem || ui.reportBusy ? 'disabled' : ''}>${icon('spark','icon-sm')} ${ui.reportBusy ? '생성 중…' : '현재 문제 분석서 만들기'}</button>`)}${ui.reportBusy ? `<section class="card report-generating"><span class="ai-loader mini">${icon('spark')}</span><div><h2>분석서를 편집하고 있습니다</h2><p data-report-status>${e(ui.reportStatus)}</p></div></section>` : ''}${reports.length ? `<div class="report-library">${reports.map((item) => `<article class="card report-library-card"><div class="report-cover-mini"><span>홍동원</span><b>insight</b><small>${e(item.problem?.type || 'AI ANALYSIS')}</small></div><div class="report-library-copy"><span class="badge primary">${e(item.problem?.topic || '기타')} 소재</span><h2>${e(item.report?.title || '홍동원 분석서')}</h2><p>${e(item.report?.summary || '')}</p><div class="report-meta"><span>${item.generatedAt ? new Intl.DateTimeFormat('ko-KR').format(new Date(item.generatedAt)) : ''}</span><span>정답 ${item.report?.answerAnalysis?.correctAnswer || item.problem?.correctAnswer}번</span></div><div class="heading-actions"><a class="btn btn-primary" href="#/report?id=${encodeURIComponent(item.id)}">분석서 열기 ${icon('arrow','icon-sm')}</a><button class="btn btn-secondary" data-action="delete-report" data-report-id="${e(item.id)}">삭제</button></div></div></article>`).join('')}</div>` : `<section class="card empty-state"><div><span class="empty-icon">${icon('book')}</span><h2>아직 만든 분석서가 없습니다</h2><p class="muted">문제 이미지나 PDF를 올리면 문장별 해석과 정답 논리를 한 권의 해설처럼 정리합니다.</p><a class="btn btn-primary" href="#/register">첫 문제 업로드 ${icon('arrow','icon-sm')}</a></div></section>`}`);
}

function activeReport() {
  const id = routeParam('id') || data.currentReportId;
  return (data.analysisReports || []).find((item) => item.id === id) || data.analysisReports?.[0] || null;
}

function reportView() {
  const item = activeReport();
  if (!item) return emptyGuard('열 수 있는 분석서가 없습니다.', '먼저 문제를 업로드하고 AI 분석서를 만들어 주세요.', 'register');
  data.currentReportId = item.id;
  const report = item.report;
  const problem = item.problem;
  const flow = report.structureFlow.map((step, index) => `<div class="report-flow-step"><i>${index + 1}</i><span><b>${e(step.label)}</b><small>${e(step.sentenceRange)} · ${e(step.explanation)}</small></span></div>`).join('');
  return shell('report', `${pageHeading(report.title, `${problem.source || '사용자 업로드'} · ${problem.type} · ${problem.topic} 소재`, `<button class="btn btn-secondary" data-action="download-report-png" ${ui.exportBusy ? 'disabled' : ''}>${icon('image','icon-sm')} PNG</button><button class="btn btn-primary" data-action="download-report-pdf" ${ui.exportBusy ? 'disabled' : ''}>${icon('book','icon-sm')} ${ui.exportBusy ? '파일 생성 중…' : 'PDF 다운로드'}</button>`)}${report.warnings?.length ? `<div class="recognition-warnings"><b>검토 안내</b><ul>${report.warnings.map((warning) => `<li>${e(warning)}</li>`).join('')}</ul></div>` : ''}<article class="report-paper"><header class="report-title-block"><div><span>수능 영어 · 능동 독해 분석서</span><h1>홍동원 <em>insight</em></h1></div><div class="report-answer-stamp"><small>CORRECT</small><b>${report.answerAnalysis.correctAnswer}</b></div></header><section class="report-summary-grid"><div class="report-summary-main"><span class="report-label">ONE-LINE SUMMARY</span><p>${e(report.summary)}</p></div><div><span class="report-label">THEME</span><p>${e(report.theme)}</p></div><div><span class="report-label">TONE</span><p>${e(report.tone)}</p></div><div class="wide"><span class="report-label">THESIS</span><p>${e(report.thesis)}</p></div></section><section class="report-original-analysis"><div class="report-original"><span class="report-section-title">ORIGINAL</span><h2>${e(problem.question)}</h2><p>${e(problem.passage)}</p><ol>${problem.options.map((option) => `<li>${e(option)}</li>`).join('')}</ol></div><aside class="report-margin-analysis"><span class="report-section-title">LOGIC FLOW</span>${flow}</aside></section><section class="report-section"><div class="report-section-head"><span>01</span><div><h2>문장별 해석과 구문 분석</h2><p>원문의 역할과 정답으로 이어지는 단서를 문장 단위로 확인하세요.</p></div></div><div class="sentence-report-list">${report.sentenceAnalysis.map((sentence) => `<article><span class="sentence-report-num">${sentence.number}</span><div><span class="sentence-role-label">${e(sentence.role)}</span><h3>${e(sentence.original)}</h3><p class="translation-highlight">${e(sentence.translation)}</p>${sentence.keyExpressions.length ? `<small><b>KEY</b> ${e(sentence.keyExpressions.join(' · '))}</small>` : ''}${sentence.grammarPoints.length ? `<small><b>GRAMMAR</b> ${e(sentence.grammarPoints.join(' · '))}</small>` : ''}<p class="sentence-commentary">${e(sentence.commentary)}</p></div></article>`).join('')}</div></section><section class="report-section"><div class="report-section-head"><span>02</span><div><h2>정답 논리와 선택지 함정</h2><p>근거를 먼저 찾고 각 선택지를 지문과 대조합니다.</p></div></div><blockquote class="evidence-highlight">“${e(report.answerAnalysis.evidence)}”</blockquote><div class="why-correct"><b>왜 ${report.answerAnalysis.correctAnswer}번인가?</b><p>${e(report.answerAnalysis.whyCorrect)}</p></div><div class="trap-grid">${report.answerAnalysis.trapAnalysis.map((option) => `<div class="${option.verdict === '정답' ? 'correct' : ''}"><b>${option.option}번 · ${e(option.verdict)}</b><p>${e(option.reason)}</p></div>`).join('')}</div><div class="routine-box"><b>시험장 풀이 루틴</b><ol>${report.answerAnalysis.solvingRoutine.map((step) => `<li>${e(step)}</li>`).join('')}</ol></div></section><section class="report-section"><div class="report-section-head"><span>03</span><div><h2>핵심 문맥 어휘</h2><p>뜻만 외우지 말고 이 지문에서 수행하는 의미로 기억하세요.</p></div></div><div class="report-vocab-grid">${report.vocabulary.map((word) => `<article><h3>${e(word.word)} <small>${e(word.partOfSpeech)}</small></h3><b>${e(word.meaning)}</b><p>${e(word.contextMeaning)}</p><small>유의어 ${e(word.synonyms.join(', ') || '-')} · 반의어 ${e(word.antonyms.join(', ') || '-')}</small></article>`).join('')}</div><div class="study-tip-box"><b>FINAL CHECK</b>${report.studyTips.map((tip) => `<p>• ${e(tip)}</p>`).join('')}</div></section><footer class="report-footer">홍동원 Study · AI 분석 결과는 공식 정답 및 원문과 함께 검토하세요.</footer></article>`);
}

async function loadAdminMetrics() {
  if (ui.adminBusy) return;
  ui.adminBusy = true;
  if (currentRoute() === 'admin') render();
  try {
    const response = await apiFetch('/api/admin-metrics?days=30', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || '관리자 지표를 불러오지 못했습니다.');
    ui.adminMetrics = payload.metrics;
  } catch (error) {
    toast('관리자 지표 오류', error.message, 'error');
  } finally {
    ui.adminBusy = false;
    if (currentRoute() === 'admin') render();
  }
}

function adminView() {
  if (data.user.role !== 'admin') return emptyGuard('관리자 권한이 필요합니다.', '프로필 role이 admin인 계정만 운영 지표를 볼 수 있습니다.', 'dashboard');
  const metrics = ui.adminMetrics;
  if (!metrics && !ui.adminBusy) setTimeout(() => { void loadAdminMetrics(); }, 0);
  if (!metrics) return shell('admin', `${pageHeading('사용량·비용 대시보드', '최근 30일 AI 요청과 운영 오류를 집계합니다.')}<section class="card report-generating"><span class="ai-loader mini">${icon('chart')}</span><div><h2>운영 지표를 불러오는 중</h2><p>관리자 권한과 집계 데이터를 확인하고 있습니다.</p></div></section>`);
  const usd = (Number(metrics.costMicros || 0) / 1_000_000).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 });
  const maxRequests = Math.max(1, ...metrics.daily.map((item) => Number(item.requests) || 0));
  return shell('admin', `${pageHeading('사용량·비용 대시보드', `최근 ${metrics.periodDays}일 · Postgres 원본 집계`, '<button class="btn btn-secondary" data-action="refresh-admin">새로고침</button>')}<div class="admin-kpis"><article class="card"><span>가입 사용자</span><b>${Number(metrics.users).toLocaleString()}명</b></article><article class="card"><span>AI 요청</span><b>${Number(metrics.requests).toLocaleString()}회</b></article><article class="card"><span>처리 토큰</span><b>${(Number(metrics.inputTokens) + Number(metrics.outputTokens)).toLocaleString()}</b></article><article class="card"><span>추정 비용</span><b>${usd}</b></article></div><div class="admin-grid"><section class="card card-pad"><div class="card-header"><div><h2>일별 AI 요청</h2><p>한국 시간 기준 영구 사용량 카운터</p></div></div><div class="admin-bars">${metrics.daily.length ? metrics.daily.map((item) => `<div><span>${e(item.date)}</span><i><b style="width:${Math.max(3, Number(item.requests) / maxRequests * 100)}%"></b></i><strong>${Number(item.requests).toLocaleString()}</strong></div>`).join('') : '<p class="muted">집계할 요청이 없습니다.</p>'}</div></section><section class="card card-pad"><div class="card-header"><div><h2>기능별 사용량</h2><p>비용 귀속과 병목 확인</p></div></div><div class="feature-usage-list">${metrics.features.length ? metrics.features.map((item) => `<div><span><b>${e(item.feature)}</b><small>${(Number(item.costMicros || 0)/1_000_000).toFixed(4)} USD</small></span><strong>${Number(item.requests).toLocaleString()}회</strong></div>`).join('') : '<p class="muted">집계할 기능이 없습니다.</p>'}</div></section></div><section class="card card-pad"><div class="card-header"><div><h2>최근 오류 이벤트</h2><p>브라우저 전역 오류와 서버 기록을 함께 확인합니다.</p></div><span class="badge ${metrics.errors.length ? 'warning' : 'success'}">${metrics.errors.length}건</span></div><div class="admin-error-list">${metrics.errors.length ? metrics.errors.map((error) => `<div><span><b>${e(error.message)}</b><small>${e(error.route || 'server')} · ${e(error.createdAt)}</small></span></div>`).join('') : '<p class="muted">최근 기록된 오류가 없습니다.</p>'}</div></section>`);
}

function settingsView() {
  const panel = ui.settingsTab;
  const learning = `<div class="card-header"><div><h2>학습 환경</h2><p>내 학습 리듬에 맞게 기본값을 설정하세요.</p></div></div><div class="setting-row"><div><h3>다크 모드</h3><p>어두운 환경에서 눈의 피로를 줄입니다.</p></div><label class="toggle"><input id="setting-theme" type="checkbox" ${data.settings.darkMode?'checked':''}><span></span></label></div><div class="setting-row"><div><h3>하루 목표 문제 수</h3><p>대시보드 오늘의 목표에 반영됩니다.</p></div><select class="control" id="setting-goal">${[3,5,10,15,20].map(n=>`<option value="${n}" ${data.settings.dailyGoal===n?'selected':''}>${n}문제</option>`).join('')}</select></div><div class="setting-row"><div><h3>선호 난이도</h3><p>맞춤 문제 생성 시 기본으로 선택됩니다.</p></div><select class="control" id="setting-difficulty">${['쉬움','보통','어려움','평가원 수준','고난도 평가원 수준'].map(v=>`<option ${data.settings.preferredDifficulty===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="setting-row"><div><h3>움직임 줄이기</h3><p>화면 전환과 로딩 애니메이션을 최소화합니다.</p></div><label class="toggle"><input id="setting-motion" type="checkbox" ${data.settings.reduceMotion?'checked':''}><span></span></label></div>`;
  const accountName = data.user.name || '이름 미설정';
  const accountMeta = [data.user.username ? `@${data.user.username}` : '', data.user.grade ? `고등학교 ${data.user.grade}학년` : ''].filter(Boolean).join(' · ') || '입력된 계정 정보가 없습니다.';
  const account = `<div class="card-header"><div><h2>계정 정보</h2><p>인증된 계정 정보와 AI 사용량을 확인합니다.</p></div><span class="badge success">${hasRealSession() ? 'CLOUD ACCOUNT' : 'LOCAL PREVIEW'}</span></div><div class="account-box"><span class="user-avatar">${e(data.user.name?.[0] || 'E')}</span><span><b>${e(accountName)}</b><small>${e(accountMeta)}</small></span></div>${data.user.aiUsage ? `<div class="setting-row"><div><h3>오늘의 AI 사용량</h3><p>한국 시간 자정에 초기화됩니다.</p></div><span class="badge primary">${data.user.aiUsage.request_count || 0} / ${data.user.aiUsage.limit || ui.publicConfig?.dailyAiLimit || 20}회</span></div>` : ''}<div class="setting-row"><div><h3>이름</h3><p>입력하면 대시보드와 학습 리포트에 표시됩니다.</p></div><input class="control" id="setting-name" maxlength="20" placeholder="이름 입력" value="${e(data.user.name)}"></div><div class="setting-row"><div><h3>목표 등급</h3><p>선택하지 않아도 학습 기능을 사용할 수 있습니다.</p></div><select class="control" id="setting-grade"><option value="" ${!data.user.targetGrade?'selected':''}>선택 안 함</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${data.user.targetGrade===n?'selected':''}>${n}등급</option>`).join('')}</select></div>`;
  const storage = `<div class="card-header"><div><h2>데이터 관리</h2><p>학습 데이터는 이 기기와 서버 데이터베이스에 동기화됩니다.</p></div></div><div class="setting-row"><div><h3>지금 서버와 동기화</h3><p>현재 학습 기록을 즉시 영구 저장합니다.</p></div><button class="btn btn-secondary" data-action="sync-now">동기화</button></div><div class="setting-row"><div><h3>학습 데이터 내보내기</h3><p>단어, 분석서와 학습 기록을 JSON 파일로 내려받습니다.</p></div><button class="btn btn-secondary" data-action="export-data">내보내기</button></div><div class="setting-row"><div><h3>개인정보 및 약관</h3><p>데이터 처리와 서비스 이용 조건을 확인합니다.</p></div><span><a class="text-link" href="#/privacy">처리방침</a> · <a class="text-link" href="#/terms">이용약관</a></span></div><div class="setting-row"><div><h3>모든 학습 데이터 삭제</h3><p>추가한 오답, 단어, 분석서와 학습 기록을 모두 비웁니다.</p></div><button class="btn btn-danger" data-action="confirm-reset">전체 삭제</button></div><div class="setting-row"><div><h3>앱 버전</h3><p>Vercel Production</p></div><span class="badge">v${CONFIG.appVersion}</span></div>`;
  return shell('settings', `${pageHeading('설정', '학습 환경과 데모 데이터를 관리하세요.')}<div class="settings-layout"><nav class="card settings-nav">${[['learning','settings','학습 환경'],['account','user','계정 정보'],['storage','book','데이터 관리']].map(([id,ic,label])=>`<button class="${panel===id?'active':''}" data-action="settings-tab" data-tab="${id}">${icon(ic,'icon-sm')}${label}</button>`).join('')}</nav><section class="card settings-panel">${panel==='learning'?learning:panel==='account'?account:storage}</section></div>`);
}

function emptyGuard(title, description, target) {
  const route = currentRoute();
  return shell(route, `<section class="card empty-state"><div><span class="empty-icon">${icon('info')}</span><h2>${e(title)}</h2><p class="muted">${e(description)}</p><a class="btn btn-primary" href="#/${target}">시작하기 ${icon('arrow','icon-sm')}</a></div></section>`);
}

function render() {
  clearTimers();
  data = loadData();
  applyTheme();
  let route = currentRoute();
  const publicRoutes = ['landing','login','signup','privacy','terms','reset-password'];
  if (!publicRoutes.includes(route) && !isAuthenticated()) {
    go('login');
    return;
  }
  const views = {
    landing: landingView, login: loginView, signup: signupView,
    privacy: () => policyView('privacy'), terms: () => policyView('terms'), 'reset-password': resetPasswordView,
    dashboard: dashboardView, register: registerView, analysis: analysisView, feedback: feedbackView,
    generate: generatorView, practice: practiceView, results: resultsView, vocabulary: vocabularyView,
    insights: insightsView, history: historyView, settings: settingsView, reports: reportsView, report: reportView, admin: adminView,
  };
  const view = views[route] || (isAuthenticated() ? dashboardView : landingView);
  document.title = `${routeMeta[route]?.[1] || '수능 영어 능동 학습'} | ${CONFIG.brandName}`;
  app.innerHTML = view();
  window.scrollTo({ top: 0, behavior: data.settings.reduceMotion ? 'auto' : 'smooth' });
  if (route === 'practice') startPracticeTimer();
}

function persistAnalysisForm() {
  const form = document.querySelector('#analysis-form');
  if (!form || !data.currentAnalysis) return;
  const formData = new FormData(form);
  ['topic','core','claim','purpose','mood'].forEach((key) => data.currentAnalysis[key] = String(formData.get(key) || '').slice(0, key === 'core' ? 500 : 300));
  data.currentAnalysis.logic = formData.getAll('logic').map(String);
  saveData(data);
  const completion = analysisCompletion(data.currentAnalysis);
  const count = document.querySelector('#completion-count');
  const submit = document.querySelector('#analysis-submit');
  if (count) count.textContent = `${completion.done}/${completion.total}`;
  if (submit) submit.disabled = completion.done < completion.total;
}

function refreshAnalysisInteractiveState() {
  const analysis = data.currentAnalysis;
  const problem = data.currentProblem;
  if (!analysis || !problem || currentRoute() !== 'analysis') return;
  const sentences = problem.sentences?.length
    ? problem.sentences
    : problem.passage.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()) || [problem.passage];

  document.querySelectorAll('[data-action="analysis-sentence"]').forEach((button) => {
    const index = Number(button.dataset.index);
    const role = analysis.roles[index] || '';
    button.classList.toggle('has-role', Boolean(role));
    button.innerHTML = `${role ? `<span class="sentence-role">${e(role)}</span>` : ''}${e(sentences[index] || '')}`;
  });
  document.querySelectorAll('[data-action="evidence-sentence"]').forEach((button) => {
    const index = Number(button.dataset.index);
    const selected = analysis.evidenceIndex === index;
    button.classList.toggle('evidence', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.innerHTML = `${selected ? '<span class="sentence-role" style="color:var(--success)">✓ 정답 근거로 선택</span>' : ''}${e(sentences[index] || '')}`;
  });
  document.querySelectorAll('[data-action="confidence"]').forEach((button) => {
    const selected = analysis.confidence === Number(button.dataset.value);
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const completion = analysisCompletion(analysis);
  const count = document.querySelector('#completion-count');
  const submit = document.querySelector('#analysis-submit');
  if (count) count.textContent = `${completion.done}/${completion.total}`;
  if (submit) submit.disabled = completion.done < completion.total;
}

async function submitAnalysisForEvaluation() {
  if (ui.analysisEvaluationBusy) return;
  const completion = analysisCompletion(data.currentAnalysis);
  if (completion.done < completion.total) {
    toast('분석을 조금 더 완성해 주세요.', `${completion.total-completion.done}개 필수 항목이 남아 있어요.`, 'error');
    return;
  }

  const problem = data.currentProblem;
  const sentences = problem.sentences?.length
    ? problem.sentences
    : problem.passage.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()) || [problem.passage];
  const submit = document.querySelector('#analysis-submit');
  ui.analysisEvaluationBusy = true;
  if (submit) {
    submit.disabled = true;
    submit.innerHTML = `${icon('spark', 'icon-sm')} AI가 지문과 분석을 대조하고 있어요`;
  }

  try {
    const evaluation = await evaluateLearningAnalysisWithAI(problem, data.currentAnalysis, sentences, (status) => {
      if (submit) submit.textContent = status;
    });
    data.currentAnalysis.submitted = true;
    data.currentAnalysis.submittedAt = new Date().toISOString();
    data.currentAnalysis.aiEvaluation = evaluation;
    data.currentAnalysis.scores = evaluation.scores;
    data.currentAnalysis.unknownWords.forEach((word) => upsertVocabularyWord(word, problem.passage));
    saveData(data);
    toast('AI 의미 평가를 완료했어요.', `전체 분석 정확도 ${evaluation.overallScore}% · ${evaluation.verdict}`);
    go('feedback');
  } catch (error) {
    console.error('[analysis-evaluation-ui] evaluation failed', error);
    data.currentAnalysis.submitted = false;
    delete data.currentAnalysis.aiEvaluation;
    delete data.currentAnalysis.scores;
    saveData(data);
    toast('AI 분석 평가를 완료하지 못했어요.', describeAIError(error, '작성 내용은 저장되어 있습니다. 다시 제출해 주세요.'), 'error');
    if (submit) {
      submit.disabled = false;
      submit.innerHTML = `분석 제출하고 AI와 비교 ${icon('arrow','icon-sm')}`;
    }
  } finally {
    ui.analysisEvaluationBusy = false;
  }
}

function lookupWord(word) {
  const problemWords = data.currentProblem?.words || sourceProblem.words;
  const known = [...problemWords, ...data.vocabulary].find((w)=>w.word.toLowerCase()===word.toLowerCase());
  if (known) return known;
  const fallback = {
    freedom: {
      meaning: '자유',
      contextMeaning: '문맥에서: 선택할 수 있는 능력',
      senses: [
        { meaning: '자유', contextMeaning: '외부 제약 없이 스스로 선택할 수 있는 상태', usage: '추상적 개념', note: 'freedom of choice' },
        { meaning: '해방', contextMeaning: '구속이나 제한에서 벗어남', usage: '감정·사회적 맥락', note: 'freedom from fear' },
      ],
    },
    choice: {
      meaning: '선택',
      contextMeaning: '문맥에서: 여러 대안 중 결정',
      senses: [
        { meaning: '선택', contextMeaning: '여러 대안 중 하나를 고르는 행위', usage: '결정, 의사결정', note: 'make a choice' },
        { meaning: '선택권', contextMeaning: '고를 수 있는 권리나 범위', usage: '서비스, 제도, 학교 생활', note: 'give students a choice' },
      ],
    },
    comparison: {
      meaning: '비교',
      contextMeaning: '문맥에서: 대안들을 서로 견주기',
      senses: [
        { meaning: '비교', contextMeaning: '둘 이상을 나란히 놓고 살펴봄', usage: '분석, 판단', note: 'comparison with others' },
        { meaning: '대조', contextMeaning: '차이점을 더 선명하게 보여 주는 비교', usage: '문학, 논리, 설명', note: 'by comparison' },
      ],
    },
    meaningful: {
      meaning: '의미 있는',
      contextMeaning: '문맥에서: 진정한 가치가 있는',
      senses: [
        { meaning: '의미 있는', contextMeaning: '가치나 목적이 분명한', usage: '경험, 대화, 학습', note: 'meaningful learning' },
        { meaning: '중요한', contextMeaning: '눈에 띄게 가치가 있는', usage: '논의, 변화, 결과', note: 'a meaningful change' },
      ],
    },
    confidence: {
      meaning: '확신',
      contextMeaning: '문맥에서: 선택을 믿는 상태',
      senses: [
        { meaning: '확신', contextMeaning: '자신의 판단을 믿는 상태', usage: '심리 상태', note: 'with confidence' },
        { meaning: '신뢰', contextMeaning: '상대나 시스템을 믿는 태도', usage: '관계, 사회, 제도', note: 'confidence in the system' },
      ],
    },
    alternative: {
      meaning: '대안',
      contextMeaning: '문맥에서: 선택 가능한 다른 길',
      senses: [
        { meaning: '대안', contextMeaning: '다른 선택지나 해결책', usage: '문제 해결, 의사결정', note: 'alternative solution' },
        { meaning: '대체의', contextMeaning: '기존 것을 대신하는 성격', usage: '형용사 용법', note: 'an alternative route' },
      ],
    },
  }[word.toLowerCase()];
  return {
    word,
    lemma: word.toLowerCase(),
    partOfSpeech: 'word',
    meaning: fallback?.meaning || 'AI 정리 대기',
    contextMeaning: fallback?.contextMeaning || '문맥을 바탕으로 AI 정리를 요청해 주세요.',
    senses: fallback?.senses || [],
    difficulty: 2,
  };
}

function findWordContext(word, passage = data.currentProblem?.passage || '') {
  const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
  return splitSentences(String(passage)).find((sentence) => pattern.test(sentence)) || String(passage).slice(0, 500);
}

function upsertVocabularyWord(word, passage = data.currentProblem?.passage || '') {
  const normalized = String(word.word || '').toLowerCase();
  if (!normalized) return null;
  const recentSentence = word.recentSentence || findWordContext(normalized, passage);
  const existing = data.vocabulary.find((item) => String(item.word).toLowerCase() === normalized);
  const richExamples = vocabularyExamples(word);
  const senses = normalizeWordSenses(word);
  const primarySense = senses[0] || null;
  const baseFields = {
    lemma: word.lemma || normalized,
    pronunciation: word.pronunciation || '',
    partOfSpeech: word.partOfSpeech || 'word',
    meaning: word.meaning || primarySense?.meaning || 'AI 뜻 정리 대기',
    contextMeaning: word.contextMeaning || primarySense?.contextMeaning || word.meaning,
    senses,
    difficulty: word.difficulty || 2,
  };
  const learningFields = richExamples.length >= 3 ? {
    ...baseFields,
    examples: richExamples,
    learningTip: word.learningTip || '',
    enrichmentStatus: 'complete',
    enrichedAt: word.enrichedAt || new Date().toISOString(),
  } : baseFields;
  if (existing) {
    Object.assign(existing, learningFields, {
      recentSentence: recentSentence || existing.recentSentence,
      sourcePassage: String(passage || existing.sourcePassage || '').slice(0, 6000),
    });
    return existing;
  }
  const record = {
    id: `word_${Date.now()}_${normalized}`,
    word: normalized,
    lemma: word.lemma || normalized,
    pronunciation: word.pronunciation || '',
    partOfSpeech: word.partOfSpeech || 'word',
    meaning: word.meaning || primarySense?.meaning || 'AI 뜻 정리 대기',
    contextMeaning: word.contextMeaning || primarySense?.contextMeaning || word.meaning || 'AI 문맥 뜻 정리 대기',
    senses,
    difficulty: word.difficulty || 2,
    examples: richExamples,
    learningTip: word.learningTip || '',
    enrichmentStatus: richExamples.length >= 3 ? 'complete' : 'pending',
    enrichmentError: word.enrichmentError || '',
    exposureCount: 1,
    correctCount: 0,
    incorrectCount: 1,
    masteryScore: 15,
    lastSeenAt: todayISO(),
    nextReviewAt: todayISO(),
    status: '신규',
    recentSentence,
    sourcePassage: String(passage || '').slice(0, 6000),
  };
  data.vocabulary.unshift(record);
  return record;
}

async function getEnrichedWord(word) {
  const passage = data.currentProblem?.passage || '';
  const sentence = findWordContext(word.word, passage);
  const enriched = await enrichWordWithAI({ word: word.word, sentence, passage });
  return { ...word, ...enriched, recentSentence: sentence, sourcePassage: passage };
}

async function retryWordEnrichment(id, button) {
  const saved = data.vocabulary.find((item) => item.id === id);
  if (!saved) return;
  button.disabled = true;
  button.innerHTML = `${icon('spark','icon-sm')} AI가 뜻과 예문을 만드는 중...`;
  try {
    const enriched = await enrichWordWithAI({ word: saved.word, sentence: saved.recentSentence || '', passage: saved.sourcePassage || saved.recentSentence || '' });
    const stats = { id: saved.id, exposureCount: saved.exposureCount, correctCount: saved.correctCount, incorrectCount: saved.incorrectCount, masteryScore: saved.masteryScore, lastSeenAt: saved.lastSeenAt, nextReviewAt: saved.nextReviewAt, status: saved.status, recentSentence: saved.recentSentence, sourcePassage: saved.sourcePassage };
    Object.assign(saved, enriched, stats, { enrichmentStatus: 'complete', enrichmentError: '' });
    saveData(data);
    closeModal();
    toast(`${saved.word} 학습 카드를 완성했어요.`, '문맥 뜻과 AI 예문 4개를 저장했습니다.');
    render();
  } catch (error) {
    saved.enrichmentStatus = 'pending';
    saved.enrichmentError = error.code || 'WORD_ENRICHMENT_FAILED';
    saveData(data);
    button.disabled = false;
    button.innerHTML = `${icon('spark','icon-sm')} AI 뜻·예문 다시 만들기`;
    toast('AI 단어 정리를 완료하지 못했어요.', describeAIError(error), 'error');
  }
}

function openWordPopover(button) {
  document.querySelector('.word-popover')?.remove();
  const word = lookupWord(button.dataset.word);
  const selected = data.currentAnalysis?.unknownWords.some((w)=>w.word.toLowerCase()===word.word.toLowerCase());
  const saved = data.vocabulary.find((item) => item.word.toLowerCase() === word.word.toLowerCase());
  const examples = vocabularyExamples(saved || word);
  const senses = wordMeaningSummary(saved || word, 2);
  const pop = document.createElement('div');
  pop.className = 'word-popover';
  pop.innerHTML = `<div class="word-popover-head"><b>${e(word.word)}</b><span>${e(word.partOfSpeech || 'word')}</span></div><div class="word-meaning"><small>대표 뜻</small><p>${e(senses.primary)}</p></div>${senses.senses.length ? `<div class="popover-sense-list">${senses.senses.slice(0, 2).map((sense, index) => `<div class="popover-sense"><small>${index + 1}번째 뜻</small><p>${e(sense.meaning)}</p><span>${e(sense.contextMeaning || sense.usage || sense.note || '')}</span></div>`).join('')}</div>` : ''}<div class="word-meaning"><small>문맥 속 의미</small><p>${e(word.contextMeaning || word.meaning)}</p></div>${examples.length ? `<div class="word-ai-ready">${icon('check','icon-sm')} AI 예문 ${examples.length}개가 단어장에 정리됨</div>` : '<div class="word-ai-ready pending">AI가 뜻·품사·예문 4개를 정리한 뒤 저장합니다.</div>'}<button class="btn ${selected?'btn-secondary':'btn-primary'} btn-block" type="button" data-action="toggle-unknown-word" data-word="${e(word.word)}">${selected?'이번 분석에서 제외 (단어장 유지)':examples.length?'단어장 정보로 분석 단어 선택':'AI 뜻·예문과 함께 저장'}</button>`;
  document.body.append(pop);
  const rect = button.getBoundingClientRect();
  const width = 290;
  pop.style.left = `${Math.min(window.innerWidth - width - 12, Math.max(12, rect.left))}px`;
  pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 12, rect.bottom + 8)}px`;
}

function setRegistrationAnalysisState(form, busy, message = '') {
  form.dataset.busy = busy ? 'true' : 'false';
  form.setAttribute('aria-busy', String(busy));
  const submit = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-registration-status]');
  if (submit) {
    if (!submit.dataset.originalLabel) submit.dataset.originalLabel = submit.innerHTML;
    submit.disabled = busy;
    submit.innerHTML = busy ? `${icon('spark','icon-sm')} AI가 문제를 분석하는 중...` : submit.dataset.originalLabel;
  }
  if (status) {
    status.hidden = !busy;
    const text = status.querySelector('span');
    if (text && message) text.textContent = message;
  }
}

async function addProblemFromForm(form) {
  if (form.dataset.busy === 'true') return;
  const fd = new FormData(form);
  const passage = String(fd.get('passage') || '').trim().slice(0,5000);
  const question = String(fd.get('question') || '').trim().slice(0,500);
  const options = [1,2,3,4,5].map((n)=>String(fd.get(`option${n}`)||'').trim().slice(0,500));
  if (!passage || !question || options.some((v)=>!v)) { toast('입력 내용을 확인해 주세요.','지문, 질문, 선택지 5개가 모두 필요합니다.','error'); return; }
  const selectedAnswer = Number(fd.get('selectedAnswer'));
  if (!Number.isInteger(selectedAnswer) || selectedAnswer < 1 || selectedAnswer > 5) { toast('내가 선택한 답을 골라 주세요.','정답은 AI가 분석하고, 내가 고른 답만 직접 입력하면 됩니다.','error'); return; }

  const source = String(fd.get('source') || '직접 등록').trim().slice(0,100);
  const difficulty = String(fd.get('difficulty') || '평가원 수준');
  const manualCorrectAnswer = Number(fd.get('manualCorrectAnswer'));
  const manualType = String(fd.get('manualType') || '');
  const manualTopic = String(fd.get('manualTopic') || '');
  const hasManualConfirmation = Number.isInteger(manualCorrectAnswer) && manualCorrectAnswer >= 1 && manualCorrectAnswer <= 5
    && QUESTION_TYPES.includes(manualType) && TOPICS.includes(manualTopic);

  data.pendingRegistration = {
    passage,
    question,
    options,
    selectedAnswer,
    source,
    difficulty,
    manualCorrectAnswer: hasManualConfirmation ? manualCorrectAnswer : 0,
    manualType: hasManualConfirmation ? manualType : '',
    manualTopic: hasManualConfirmation ? manualTopic : '',
    savedAt: new Date().toISOString(),
  };
  saveData(data);

  setRegistrationAnalysisState(form, true, 'AI가 지문과 선택지를 직접 풀고 있습니다.');
  let aiAnalysis;
  let analysisSource = 'analysis-api';
  try {
    const recognized = form.id === 'ocr-result-form' ? ui.ocr?.result : null;
    const recognitionIsUnchanged = recognized
      && passage === String(recognized.passage || '').trim()
      && question === String(recognized.question || '').trim()
      && options.every((option, index) => option === String(recognized.options?.[index] || '').trim());
    if (recognitionIsUnchanged && recognized.correctAnswer >= 1 && recognized.correctAnswer <= 5
      && QUESTION_TYPES.includes(recognized.type) && TOPICS.includes(recognized.topic)) {
      setRegistrationAnalysisState(form, true, '추출된 텍스트를 독립적으로 다시 풀어 교차 검증하고 있습니다.');
      try {
        const verified = await analyzeProblemWithAI({ passage, question, options }, (status) => setRegistrationAnalysisState(form, true, status));
        const disagreement = verified.correctAnswer !== recognized.correctAnswer
          ? [`1차 이미지 판독은 ${recognized.correctAnswer}번, 2차 텍스트 교차 검증은 ${verified.correctAnswer}번으로 판정하여 2차 결과를 적용했습니다.`]
          : [];
        analysisSource = 'image-verified-two-pass';
        aiAnalysis = {
          ...verified,
          warnings: [...new Set([...(recognized.warnings || []), ...(verified.warnings || []), ...disagreement])],
        };
      } catch (verificationError) {
        console.warn('[problem-analysis-ui] second-pass verification unavailable; using first-pass result', { code: verificationError?.code });
        analysisSource = 'image-first-pass-fallback';
        aiAnalysis = {
          correctAnswer: recognized.correctAnswer,
          type: recognized.type,
          topic: recognized.topic,
          confidence: recognized.analysisConfidence,
          evidenceSentence: recognized.evidenceSentence,
          explanation: recognized.explanation,
          warnings: [...new Set([...(recognized.warnings || []), '2차 교차 검증을 완료하지 못해 1차 이미지 판독 결과를 사용했습니다.'])],
        };
      }
    } else {
      aiAnalysis = await analyzeProblemWithAI({ passage, question, options }, (status) => setRegistrationAnalysisState(form, true, status));
    }
  } catch (error) {
    console.error('[problem-analysis-ui] analysis failed', error);
    if (!hasManualConfirmation) {
      setRegistrationAnalysisState(form, false);
      toast('AI 연결을 완료하지 못했어요.', `${describeAIError(error)} 입력 내용은 임시 저장했습니다. 직접 확정 항목을 입력하면 AI 연결 없이 계속할 수 있습니다.`, 'error');
      return;
    }
    analysisSource = 'manual';
    aiAnalysis = {
      correctAnswer: manualCorrectAnswer,
      type: manualType,
      topic: manualTopic,
      confidence: 0,
      evidenceSentence: '',
      explanation: 'AI 연결 실패 후 사용자가 정답·문제 유형·소재를 직접 확인하여 등록했습니다.',
      warnings: [describeAIError(error)],
    };
  }

  const sentences = passage.match(/[^.!?]+[.!?]+/g)?.map((s)=>s.trim()) || [passage];
  const problem = {
    id:`source_${Date.now()}`,
    passage,
    question,
    options,
    correctAnswer: aiAnalysis.correctAnswer,
    selectedAnswer,
    type: aiAnalysis.type,
    topic: aiAnalysis.topic,
    source,
    difficulty,
    sentences,
    words:[],
    evidenceSentence:aiAnalysis.evidenceSentence,
    explanation:aiAnalysis.explanation,
    aiConfidence:aiAnalysis.confidence,
    aiWarnings:aiAnalysis.warnings,
    analyzedByAI:analysisSource !== 'manual',
    analysisSource,
  };
  data.currentProblem = problem;
  data.currentAnalysis = null;
  data.pendingRegistration = null;
  data.submittedProblems.unshift(problem);
  saveData(data);
  setRegistrationAnalysisState(form, false);
  toast(analysisSource === 'manual' ? '직접 확인한 문제를 저장했어요.' : 'AI 문제 분석을 완료했어요.',`정답 ${problem.correctAnswer}번 · ${problem.type} · ${problem.topic} 소재`);
  if (fd.get('createReport')) await generateReportForProblem(problem);
  else go('analysis');
}

function loadExample() {
  data.currentProblem = JSON.parse(JSON.stringify(sourceProblem));
  data.currentAnalysis = null;
  if (!data.submittedProblems.some((p)=>p.id===sourceProblem.id)) data.submittedProblems.unshift(data.currentProblem);
  saveData(data);
  go('analysis');
}

async function startOCR() {
  if (!ui.ocr?.file || ui.ocr.busy) return;
  ui.ocr.busy = true;
  ui.ocr.error = '';
  console.info('[vision-ui] starting recognition');
  render();
  try {
    const result = await recognizeExamImage(ui.ocr.file, ({ status, progress }) => {
      const percent = Math.round(clamp(progress * 100, 0, 100));
      const statusElement = document.querySelector('#ocr-status');
      const percentElement = document.querySelector('#ocr-percent');
      const barElement = document.querySelector('#ocr-progress-bar');
      if (statusElement) statusElement.textContent = status;
      if (percentElement) percentElement.textContent = `${percent}%`;
      if (barElement) barElement.style.width = `${percent}%`;
    });
    ui.ocr.result = result;
    ui.ocr.preview = result.preview || ui.ocr.preview;
    ui.ocr.busy = false;
    console.info('[vision-ui] result ready for review', { confidence: result.confidence });
    toast('텍스트 인식을 완료했어요.', '결과를 확인하고 잘못된 부분만 수정해 주세요.');
  } catch (error) {
    console.error('[vision-ui] recognition failed', error);
    ui.ocr.busy = false;
    const fallbackMessages = {
      TIMEOUT: 'AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.',
      INVALID_IMAGE: '지원되는 형식의 선명한 이미지를 다시 선택해 주세요.',
    };
    ui.ocr.error = fallbackMessages[error.code] || describeAIError(error, '이미지를 인식하지 못했습니다. 더 선명한 사진으로 다시 시도해 주세요.');
    void apiFetch('/api/report-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        level: 'error',
        message: `OCR upload failed: ${String(error?.code || error?.name || 'UNKNOWN').slice(0, 100)}`,
        stack: String(error?.stack || '').slice(0, 8000),
        route: location.hash,
        context: { stage: 'document-recognition', mime: ui.ocr?.mime || ui.ocr?.file?.type || '', size: ui.ocr?.file?.size || 0 },
      }),
    }).catch(() => null);
    toast('텍스트 인식에 실패했어요.', ui.ocr.error, 'error');
  }
  if (currentRoute() === 'register') render();
}

async function applyAuthenticatedUser(authUser) {
  const userId = String(authUser?.id || '').trim();
  if (!userId) throw new Error('로그인 사용자 정보를 확인하지 못했습니다.');
  data = setDataOwner(userId);
  setAuthenticated(true);
  data.user = {
    ...data.user,
    id: userId,
    email: '',
    username: authUser?.username || authUser?.user_metadata?.username || data.user.username,
    name: authUser?.user_metadata?.name || data.user.name,
  };
  saveData(data);
  await hydrateCloudData().catch(() => null);
  data = loadData();
  const account = await fetchAccount().catch(() => null);
  if (account?.user) {
    data.user = {
      ...data.user,
      id: account.user.id,
      email: '',
      username: account.user.username || data.user.username,
      name: account.user.display_name || data.user.name,
      role: account.user.role || 'user',
      aiUsage: account.usage ? { ...account.usage, limit: account.user.daily_ai_limit || ui.publicConfig?.dailyAiLimit || 20 } : null,
    };
    saveData(data);
  }
}

async function refreshAccountUsage() {
  if (!hasRealSession()) return;
  const account = await fetchAccount().catch(() => null);
  if (!account?.user) return;
  data.user.role = account.user.role || data.user.role || 'user';
  data.user.aiUsage = account.usage ? { ...account.usage, limit: account.user.daily_ai_limit || ui.publicConfig?.dailyAiLimit || 20 } : null;
  saveData(data);
  if (!['login', 'signup', 'landing'].includes(currentRoute())) render();
}

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'login-form') {
    event.preventDefault();
    const fd = new FormData(event.target);
    ui.authBusy = true; render();
    try {
      const signedIn = await signInWithUsername(fd.get('username'), fd.get('password'));
      await applyAuthenticatedUser({ ...signedIn.user, username: signedIn.username });
      toast('로그인했어요.', '서버의 학습 데이터와 안전하게 동기화했습니다.');
      go('dashboard');
    } catch (error) {
      console.error('[auth-ui] sign in failed', error);
      toast('로그인하지 못했어요.', error.message || '아이디와 비밀번호를 확인해 주세요.', 'error');
    } finally { ui.authBusy = false; if (currentRoute() === 'login') render(); }
  }
  if (event.target.id === 'signup-form') {
    event.preventDefault();
    const fd = new FormData(event.target);
    const password = String(fd.get('password') || '');
    if (!isStrongPassword(password)) {
      toast('비밀번호를 확인해 주세요.', '영문과 숫자를 포함한 8자 이상 비밀번호가 필요합니다.', 'error');
      return;
    }
    ui.authBusy = true; render();
    try {
      const result = await signUpWithUsername({ name: fd.get('name'), username: fd.get('username'), password });
      await applyAuthenticatedUser({ ...result.user, username: result.username });
      toast('계정을 만들었어요.', '이메일 확인 없이 바로 학습을 시작합니다.');
      go('dashboard');
      showRecoveryCode(result.recoveryCode);
    } catch (error) {
      console.error('[auth-ui] sign up failed', error);
      toast('회원가입을 완료하지 못했어요.', error.message || '입력 내용을 확인해 주세요.', 'error');
    } finally { ui.authBusy = false; if (currentRoute() === 'signup') render(); }
  }
  if (event.target.id === 'reset-password-form') {
    event.preventDefault();
    const fd = new FormData(event.target);
    const password = String(fd.get('password') || '');
    if (!isStrongPassword(password)) {
      toast('비밀번호를 확인해 주세요.', '영문과 숫자를 포함한 8자 이상 비밀번호가 필요합니다.', 'error');
      return;
    }
    if (password !== String(fd.get('confirmPassword') || '')) {
      toast('비밀번호가 일치하지 않습니다.', '두 입력값을 다시 확인해 주세요.', 'error');
      return;
    }
    ui.authBusy = true; render();
    try {
      const result = await resetPasswordWithRecoveryCode({
        username: fd.get('username'), recoveryCode: fd.get('recoveryCode'), password,
      });
      await applyAuthenticatedUser({ ...result.user, username: result.username });
      toast('비밀번호를 변경했어요.', '기존 복구 코드는 폐기되었습니다.');
      go('dashboard');
      showRecoveryCode(result.recoveryCode, '비밀번호 변경으로 기존 복구 코드가 폐기되었습니다. 새 코드를 저장해 주세요.');
    } catch (error) {
      toast('비밀번호를 변경하지 못했어요.', error.message, 'error');
    } finally { ui.authBusy = false; if (currentRoute() === 'reset-password') render(); }
  }
  if (event.target.id === 'problem-form') { event.preventDefault(); await addProblemFromForm(event.target); }
  if (event.target.id === 'ocr-result-form') { event.preventDefault(); await addProblemFromForm(event.target); }
  if (event.target.id === 'analysis-form') {
    event.preventDefault(); persistAnalysisForm();
    void submitAnalysisForEvaluation();
  }
  if (event.target.id === 'generator-form') {
    event.preventDefault();
    const fd = new FormData(event.target);
    const typeMode = String(fd.get('typeMode'));
    const topicMode = String(fd.get('topicMode'));
    const weakType = Object.entries(data.weakTypes).sort((a,b)=>a[1]-b[1])[0]?.[0];
    const weakTopic = Object.entries(data.weakTopics).sort((a,b)=>a[1]-b[1])[0]?.[0];
    let questionType = normalizeQuestionType(fd.get('questionType'));
    let topic = String(fd.get('topic') || '경제');
    if (typeMode === '원본과 같은 유형' && QUESTION_TYPES.includes(data.currentProblem?.type)) questionType = data.currentProblem.type;
    if (typeMode === '내가 취약한 유형' && QUESTION_TYPES.includes(weakType)) questionType = weakType;
    if (topicMode === '원본과 유사한 소재' && TOPICS.includes(data.currentProblem?.topic)) topic = data.currentProblem.topic;
    if (topicMode === '같은 소재의 다른 세부 주제' && TOPICS.includes(data.currentProblem?.topic)) topic = data.currentProblem.topic;
    if (topicMode === '취약 소재' && TOPICS.includes(weakTopic)) topic = weakTopic;
    if (topicMode === '랜덤 소재') topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
    const options = { typeMode, topicMode, questionType, topic, difficulty:String(fd.get('difficulty')||data.settings.preferredDifficulty), wordMode:String(fd.get('wordMode')) };
    showGeneration(clamp(fd.get('problemCount'),3,10), options);
  }
});

document.addEventListener('input', (event) => {
  if (event.target.closest('#analysis-form')) persistAnalysisForm();
  if (event.target.id === 'vocab-search') { ui.vocabularySearch = event.target.value.slice(0,50); window.clearTimeout(ui.searchTimer); ui.searchTimer = window.setTimeout(render,180); }
});

document.addEventListener('change', async (event) => {
  if (event.target.closest('#analysis-form')) persistAnalysisForm();
  if (event.target.id === 'problem-image') {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
    const extension = file.name.toLowerCase().split('.').pop();
    const extensionMime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[extension];
    const detectedMime = allowed.includes(file.type) ? file.type : extensionMime;
    const maxBytes = (ui.publicConfig?.maxUploadMb || 12) * 1024 * 1024;
    if (!detectedMime || !file.size || file.size > maxBytes) { event.target.value=''; toast('업로드할 수 없는 파일이에요.',`JPG, PNG, WEBP, PDF 형식의 ${ui.publicConfig?.maxUploadMb || 12}MB 이하 파일을 선택해 주세요.`,'error'); return; }
    if (ui.ocr?.preview?.startsWith('blob:')) URL.revokeObjectURL(ui.ocr.preview);
    ui.ocr = { file, mime: detectedMime, preview: detectedMime === 'application/pdf' ? '' : URL.createObjectURL(file), result: null, busy: false, error: '' };
    console.info('[vision-ui] image selected', { name: file.name, size: file.size, type: file.type });
    render();
  }
  if (event.target.id === 'vocab-sort') { ui.vocabularySort=event.target.value; render(); }
  if (event.target.id === 'setting-theme') { data.settings.darkMode=event.target.checked; saveData(data); applyTheme(); toast('테마를 저장했어요.'); render(); }
  if (event.target.id === 'setting-motion') { data.settings.reduceMotion=event.target.checked; saveData(data); toast('움직임 설정을 저장했어요.'); }
  if (event.target.id === 'setting-goal') { data.settings.dailyGoal=Number(event.target.value); saveData(data); toast('하루 목표를 저장했어요.'); }
  if (event.target.id === 'setting-difficulty') { data.settings.preferredDifficulty=event.target.value; saveData(data); toast('선호 난이도를 저장했어요.'); }
  if (event.target.id === 'setting-name') {
    data.user.name=event.target.value.trim().slice(0,20); saveData(data);
    if (hasRealSession() && data.user.name) {
      const response = await apiFetch('/api/account', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: data.user.name }) });
      if (!response.ok) toast('서버 계정 이름은 저장하지 못했어요.', '네트워크 연결 후 다시 시도해 주세요.', 'error');
    }
    toast(data.user.name?'이름을 저장했어요.':'이름을 비웠어요.'); render();
  }
  if (event.target.id === 'setting-grade') { data.user.targetGrade=event.target.value ? Number(event.target.value) : null; saveData(data); toast('목표 등급을 저장했어요.'); }
});

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) {
    if (!event.target.closest('.word-popover')) document.querySelector('.word-popover')?.remove();
    return;
  }
  const action = target.dataset.action;
  if (action === 'history-back') {
    if (history.length > 1) history.back();
    else go(isAuthenticated() ? 'dashboard' : 'landing');
  }
  if (action === 'toggle-theme') { data.settings.darkMode=!data.settings.darkMode; saveData(data); applyTheme(); render(); }
  if (action === 'scroll') document.querySelector(`#${target.dataset.target}`)?.scrollIntoView({behavior:data.settings.reduceMotion?'auto':'smooth'});
  if (action === 'demo-login') { setAuthenticated(true); toast('체험 계정으로 시작합니다.','저장된 데모 데이터는 이 브라우저에서 유지돼요.'); go('dashboard'); }
  if (action === 'toggle-password') { const input=document.querySelector('#login-password'); input.type=input.type==='password'?'text':'password'; }
  if (action === 'toggle-signup-password') { const input=document.querySelector('#signup-password'); input.type=input.type==='password'?'text':'password'; }
  if (action === 'forgot-password') {
    go('reset-password');
  }
  if (action === 'copy-recovery-code') {
    const code = document.querySelector('#recovery-code')?.textContent?.trim();
    if (code) {
      try { await navigator.clipboard.writeText(code); toast('복구 코드를 복사했어요.', '안전한 곳에 보관해 주세요.'); }
      catch { toast('자동 복사에 실패했어요.', '코드를 직접 선택해 복사해 주세요.', 'error'); }
    }
  }
  if (action === 'toggle-sidebar') { ui.sidebarOpen=!ui.sidebarOpen; render(); }
  if (action === 'close-sidebar') { ui.sidebarOpen=false; render(); }
  if (action === 'logout') modal({title:'로그아웃할까요?',body:'<p class="muted">변경된 학습 데이터는 서버에 동기화한 뒤 안전하게 로그아웃합니다.</p>',actions:'<button class="btn btn-secondary" data-action="close-modal">취소</button><button class="btn btn-primary" data-action="confirm-logout">로그아웃</button>'});
  if (action === 'confirm-logout') {
    await pushCloudData().catch(() => null);
    await signOut();
    closeModal();
    data = setDataOwner('');
    setAuthenticated(false);
    data.user.aiUsage = null;
    saveData(data);
    go('landing');
  }
  if (action === 'close-modal') closeModal();
  if (action === 'register-tab') { ui.registerTab=target.dataset.tab; render(); }
  if (action === 'load-example') loadExample();
  if (action === 'create-report') await generateReportForProblem();
  if (action === 'delete-report') {
    data.analysisReports = (data.analysisReports || []).filter((item) => item.id !== target.dataset.reportId);
    saveData(data); toast('분석서를 삭제했어요.'); render();
  }
  if (action === 'download-report-pdf' || action === 'download-report-png') {
    const item = activeReport();
    if (!item || ui.exportBusy) return;
    ui.exportBusy = true; render();
    try {
      if (action === 'download-report-pdf') await downloadReportPdf(item.report, item.problem);
      else await downloadReportPng(item.report, item.problem);
      toast(action.endsWith('pdf') ? 'PDF를 저장했어요.' : 'PNG를 저장했어요.', '인쇄형 분석서 전체 페이지가 포함되어 있습니다.');
    } catch (error) { toast('파일을 만들지 못했어요.', error.message, 'error'); }
    finally { ui.exportBusy = false; if (currentRoute() === 'report') render(); }
  }
  if (action === 'refresh-admin') { ui.adminMetrics = null; await loadAdminMetrics(); }
  if (action === 'start-ocr') startOCR();
  if (action === 'clear-ocr') {
    if (ui.ocr?.preview?.startsWith('blob:')) URL.revokeObjectURL(ui.ocr.preview);
    ui.ocr = null;
    render();
  }
  if (action === 'start-focus') go('generate');
  if (action === 'start-register') go('register');
  if (action === 'word-info') openWordPopover(target);
  if (action === 'toggle-unknown-word') {
    const word = lookupWord(target.dataset.word);
    const index = data.currentAnalysis.unknownWords.findIndex((w)=>w.word.toLowerCase()===word.word.toLowerCase());
    if (index >= 0) {
      data.currentAnalysis.unknownWords.splice(index,1);
      saveData(data); document.querySelector('.word-popover')?.remove(); render();
    } else {
      target.disabled = true;
      target.innerHTML = `${icon('spark','icon-sm')} AI가 뜻과 예문을 정리하는 중...`;
      const saved = data.vocabulary.find((item) => item.word.toLowerCase() === word.word.toLowerCase());
      let learned = vocabularyExamples(saved).length >= 3 ? saved : null;
      try {
        learned = learned || await getEnrichedWord(word);
        data.currentAnalysis.unknownWords.push(learned);
        upsertVocabularyWord(learned, data.currentProblem?.passage || '');
        saveData(data);
        toast(`${word.word} 단어를 저장했어요.`, '뜻·문맥 의미·AI 예문 4개를 단어학습 탭에 정리했습니다.');
      } catch (error) {
        console.error('[vocabulary-ui] enrichment failed', error);
        learned = { ...word, recentSentence: findWordContext(word.word), enrichmentStatus: 'pending', enrichmentError: error.code || 'WORD_ENRICHMENT_FAILED' };
        data.currentAnalysis.unknownWords.push(learned);
        upsertVocabularyWord(learned, data.currentProblem?.passage || '');
        saveData(data);
        toast('단어는 저장했지만 AI 정리가 대기 중이에요.', describeAIError(error, '잠시 후 단어학습 탭에서 다시 시도해 주세요.'), 'error');
      }
      document.querySelector('.word-popover')?.remove();
      render();
    }
  }
  if (action === 'remove-word') { data.currentAnalysis.unknownWords=data.currentAnalysis.unknownWords.filter((w)=>w.word!==target.dataset.word); saveData(data); render(); }
  if (action === 'analysis-sentence') {
    persistAnalysisForm();
    const index=Number(target.dataset.index);
    modal({title:'이 문장의 역할은 무엇인가요?',body:`<p class="muted" style="font-size:11px">${e(target.innerText)}</p><div class="segmented">${STRUCTURE_ROLES.map(role=>`<button class="filter-btn ${data.currentAnalysis.roles[index]===role?'active':''}" data-action="set-role" data-index="${index}" data-role="${e(role)}">${e(role)}</button>`).join('')}</div>`,actions:`${data.currentAnalysis.roles[index]?`<button class="btn btn-ghost" data-action="clear-role" data-index="${index}">역할 지우기</button>`:''}<button class="btn btn-secondary" data-action="close-modal">취소</button>`});
  }
  if (action === 'set-role') {
    data.currentAnalysis.roles[target.dataset.index] = target.dataset.role;
    saveData(data);
    closeModal();
    refreshAnalysisInteractiveState();
  }
  if (action === 'clear-role') {
    delete data.currentAnalysis.roles[target.dataset.index];
    saveData(data);
    closeModal();
    refreshAnalysisInteractiveState();
  }
  if (action === 'evidence-sentence') {
    persistAnalysisForm();
    data.currentAnalysis.evidenceIndex = Number(target.dataset.index);
    saveData(data);
    refreshAnalysisInteractiveState();
  }
  if (action === 'confidence') {
    persistAnalysisForm();
    data.currentAnalysis.confidence = Number(target.dataset.value);
    saveData(data);
    refreshAnalysisInteractiveState();
  }
  if (action === 'select-answer') { data.practiceSession.answers[data.practiceSession.currentIndex]=Number(target.dataset.answer); saveData(data); render(); }
  if (action === 'practice-evidence') { data.practiceSession.evidence[data.practiceSession.currentIndex]=Number(target.dataset.index); saveData(data); render(); }
  if (action === 'evidence-help') toast('정답 근거 표시 모드','지문에서 가장 직접적인 근거 문장을 눌러 표시하세요.');
  if (action === 'practice-help') {
    const p=data.activeSet.problems[data.practiceSession.currentIndex];
    const targets = Array.isArray(p.includedTargetWords) ? p.includedTargetWords : [];
    modal({title:'이번 문제의 목표 단어',body:`<p class="muted">문맥에서 뜻이 바로 떠오르지 않는 단어를 확인하세요.</p><div class="segmented">${targets.length ? targets.map(w=>`<span class="tag">${e(w)}</span>`).join('') : '<span class="subtle">이번 문제에는 지정된 목표 단어가 없습니다.</span>'}</div>`,actions:'<button class="btn btn-secondary" data-action="close-modal">계속 풀기</button>'});
  }
  if (action === 'problem-image') await showProblemImage();
  if (action === 'download-problem-image' && ui.imageCanvas) {
    try {
      await downloadProblemSheet(ui.imageCanvas, (data.practiceSession?.currentIndex || 0) + 1);
      toast('문제지 PNG를 저장했어요.', '정답이 노출되지 않는 인쇄형 이미지입니다.');
    } catch (error) {
      toast('이미지를 저장하지 못했어요.', error.message || '잠시 후 다시 시도해 주세요.', 'error');
    }
  }
  if (action === 'prev-problem' || action === 'next-problem') { data.practiceSession.currentIndex += action==='next-problem'?1:-1; saveData(data); render(); }
  if (action === 'jump-problem') { data.practiceSession.currentIndex=Number(target.dataset.index); saveData(data); render(); }
  if (action === 'submit-practice') finishPractice();
  if (action === 'force-submit') calculateResults();
  if (action === 'toggle-result') target.closest('.result-item').classList.toggle('open');
  if (action === 'vocab-filter') { ui.vocabularyFilter=target.dataset.filter; render(); }
  if (action === 'word-detail') wordDetail(target.dataset.wordId);
  if (action === 'retry-word-enrichment') await retryWordEnrichment(target.dataset.wordId, target);
  if (action === 'review-words') {
    const due=data.vocabulary.filter(w=>w.nextReviewAt<=todayISO()&&w.status!=='완전 학습').slice(0,5);
    modal({title:'오늘의 단어 복습',body:due.length?`<p class="muted">문맥을 떠올린 뒤 뜻을 확인하세요.</p><div class="analysis-list">${due.map(w=>`<div class="analysis-row"><div class="analysis-row-top"><strong style="font-family:'Source Serif 4';font-size:16px">${e(w.word)}</strong><span>${e(w.meaning)}</span></div><p class="muted" style="margin:0;font-size:10px">${e(w.recentSentence)}</p></div>`).join('')}</div>`:'<p class="muted">오늘 복습할 단어를 모두 완료했어요.</p>',actions:'<button class="btn btn-primary" data-action="complete-word-review">복습 완료</button>'});
  }
  if (action === 'review-one') { const word=data.vocabulary.find(w=>w.id===target.dataset.wordId); closeModal(); toast(`${word.word} 복습 완료`, '내일 새 문맥에서 다시 만나요.'); }
  if (action === 'complete-word-review') {
    data.vocabulary.filter(w=>w.nextReviewAt<=todayISO()&&w.status!=='완전 학습').slice(0,5).forEach(w=>{w.correctCount++;w.masteryScore=clamp(w.masteryScore+6,0,100);const d=new Date();d.setDate(d.getDate()+(w.correctCount>=4?14:w.correctCount>=3?7:w.correctCount>=2?3:1));w.nextReviewAt=d.toISOString().slice(0,10);w.status=w.masteryScore>=85?'거의 암기':'학습 중';});
    saveData(data); closeModal(); toast('단어 복습을 완료했어요.','숙련도와 다음 복습일을 업데이트했습니다.'); render();
  }
  if (action === 'insight-tab') { ui.insightTab=target.dataset.tab; render(); }
  if (action === 'calendar-day') { const day=String(target.dataset.day).padStart(2,'0'); const date=`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${day}`; const records=data.learningHistory.filter(h=>h.date===date); toast(`${Number(day)}일 학습 기록`,records.length?`${records.reduce((s,h)=>s+h.problemCount,0)}문제 · 평균 분석 ${average(records.map(h=>h.analysisAccuracy))}%`:'이날은 기록된 학습이 없어요.'); }
  if (action === 'settings-tab') { ui.settingsTab=target.dataset.tab; render(); }
  if (action === 'sync-now') { await pushCloudData(); toast('서버 동기화를 완료했어요.'); }
  if (action === 'confirm-reset') modal({title:'모든 학습 데이터를 삭제할까요?',body:'<p class="muted">등록한 문제, 단어, 학습 기록과 입력한 계정 정보가 모두 사라집니다. 테마 설정만 유지됩니다.</p>',actions:'<button class="btn btn-secondary" data-action="close-modal">취소</button><button class="btn btn-danger" data-action="reset-data">전체 삭제</button>'});
  if (action === 'reset-data') {
    const account = hasRealSession() ? { ...data.user } : null;
    closeModal(); data=resetData();
    if (account) { data.user = account; saveData(data); }
    toast('학습 데이터를 초기화했어요.'); render();
  }
  if (action === 'export-data') {
    const blob=new Blob([exportData()],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`eon-study-${todayISO()}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('학습 데이터를 내보냈어요.');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeModal(); document.querySelector('.word-popover')?.remove(); }
  const target=event.target.closest('.exam-sentence[role="button"]');
  if (target && (event.key==='Enter'||event.key===' ')) { event.preventDefault(); target.click(); }
});

window.addEventListener('hashchange', () => { ui.sidebarOpen=false; render(); });
window.addEventListener('beforeunload', () => {
  if (data.practiceSession && !data.practiceSession.submitted) {
    data.practiceSession.elapsed += Math.floor((Date.now() - data.practiceSession.startedAt) / 1000);
    data.practiceSession.startedAt = Date.now();
  }
  saveData(data);
});

async function bootstrapApp() {
  try {
    ui.publicConfig = await loadPublicConfig();
  } catch (error) {
    console.warn('[bootstrap] public config unavailable', error);
    ui.publicConfig = { authConfigured: false, dailyAiLimit: 20, maxUploadMb: 12, operatorName: '홍동원 Study', privacyEmail: 'privacy@eon.study' };
  }
  installCloudSync();
  installErrorMonitoring();
  document.addEventListener('eon:ai-used', () => {
    clearTimeout(ui.usageRefreshTimer);
    ui.usageRefreshTimer = setTimeout(() => { void refreshAccountUsage(); }, 500);
  });
  const authUser = await bootstrapAuth().catch(() => null);
  if (authUser) await applyAuthenticatedUser(authUser);
  else {
    data = setDataOwner('');
    setAuthenticated(false);
    data.user.aiUsage = null;
    saveData(data);
  }
  render();
}

void bootstrapApp();
