import { CONFIG, normalizeQuestionType } from './config.js';
import { createInitialData } from './demo-data.js';

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let memoryFallback = null;
let activeUserId = readSessionUserId();

function normalizeUserId(value) {
  const userId = String(value || '').trim();
  return USER_ID_PATTERN.test(userId) ? userId.toLowerCase() : '';
}

function readSessionUserId() {
  try {
    const raw = localStorage.getItem(`${CONFIG.authKey}:supabase-session`);
    return normalizeUserId(raw ? JSON.parse(raw)?.user?.id : '');
  } catch {
    return '';
  }
}

function activeStorageKey() {
  return activeUserId ? `${CONFIG.storageKey}:${activeUserId}` : CONFIG.storageKey;
}

function belongsToActiveUser(saved) {
  const savedUserId = normalizeUserId(saved?.user?.id);
  if (activeUserId) return !savedUserId || savedUserId === activeUserId;
  return !savedUserId;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(saved, defaults) {
  if (!saved || typeof saved !== 'object') return defaults;
  const result = { ...defaults, ...saved };
  result.user = { ...defaults.user, ...(saved.user || {}) };
  result.settings = { ...defaults.settings, ...(saved.settings || {}) };
  result.weakTypes = migrateWeakTypes({ ...defaults.weakTypes, ...(saved.weakTypes || {}) });
  result.weakTopics = { ...defaults.weakTopics, ...(saved.weakTopics || {}) };
  result.currentProblem = migrateProblem(result.currentProblem);
  result.submittedProblems = Array.isArray(result.submittedProblems) ? result.submittedProblems.map(migrateProblem) : [];
  result.generatedProblemSets = Array.isArray(result.generatedProblemSets) ? result.generatedProblemSets.map(migrateSet) : [];
  result.analysisReports = Array.isArray(result.analysisReports) ? result.analysisReports : [];
  result.activeSet = migrateSet(result.activeSet);
  result.learningHistory = Array.isArray(result.learningHistory)
    ? result.learningHistory.map((item) => ({ ...item, type: normalizeQuestionType(item?.type) }))
    : [];
  return result;
}

function migrateProblem(problem) {
  return problem && typeof problem === 'object'
    ? { ...problem, type: normalizeQuestionType(problem.type) }
    : problem;
}

function migrateSet(set) {
  return set && typeof set === 'object'
    ? { ...set, problems: Array.isArray(set.problems) ? set.problems.map(migrateProblem) : [] }
    : set;
}

function migrateWeakTypes(types) {
  return Object.entries(types || {}).reduce((result, [type, score]) => {
    const normalized = normalizeQuestionType(type);
    const numericScore = Number(score) || 0;
    result[normalized] = normalized in result ? Math.min(result[normalized], numericScore) : numericScore;
    return result;
  }, {});
}

export function loadData() {
  const defaults = createInitialData();
  try {
    const raw = localStorage.getItem(activeStorageKey());
    if (!raw) {
      saveData(defaults);
      return defaults;
    }
    const saved = JSON.parse(raw);
    if (!belongsToActiveUser(saved)) {
      saveData(defaults);
      return defaults;
    }
    return mergeDefaults(saved, defaults);
  } catch (error) {
    console.warn('저장 데이터를 읽지 못해 메모리 모드로 전환합니다.', error);
    memoryFallback = memoryFallback || defaults;
    return clone(memoryFallback);
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(activeStorageKey(), JSON.stringify(data));
  } catch (error) {
    console.warn('저장 공간을 사용할 수 없어 메모리에만 저장합니다.', error);
    memoryFallback = clone(data);
  }
  document.dispatchEvent(new CustomEvent('eon:data-saved'));
  return data;
}

export function setDataOwner(userId = '') {
  const nextUserId = normalizeUserId(userId);
  if (nextUserId !== activeUserId) {
    activeUserId = nextUserId;
    memoryFallback = null;
  }
  return loadData();
}

export function getDataOwner() {
  return activeUserId;
}

export function replaceData(nextData) {
  const merged = mergeDefaults(nextData, createInitialData());
  saveData(merged);
  return merged;
}

export function resetData({ preserveTheme = true } = {}) {
  const previous = loadData();
  const fresh = createInitialData();
  if (preserveTheme) fresh.settings.darkMode = previous.settings.darkMode;
  saveData(fresh);
  return fresh;
}

export function isAuthenticated() {
  try {
    return localStorage.getItem(CONFIG.authKey) === 'true';
  } catch {
    return Boolean(memoryFallback?.user);
  }
}

export function setAuthenticated(value) {
  try {
    localStorage.setItem(CONFIG.authKey, String(Boolean(value)));
  } catch {
    // Private browsing may block localStorage. The demo remains usable in-memory.
  }
}

export function exportData() {
  return JSON.stringify(loadData(), null, 2);
}
