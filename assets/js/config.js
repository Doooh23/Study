export const CONFIG = {
  brandName: '홍동원',
  tagline: '영어의 이해가 켜지는 순간',
  storageKey: 'eon-study-data-v2',
  authKey: 'eon-auth-v1',
  appVersion: '2.0.0',
};

export const QUESTION_TYPE_GROUPS = [
  { label: '대의·태도', types: ['목적', '심경·분위기', '필자의 주장', '함축 의미 추론', '요지', '주제', '제목'] },
  { label: '정보 확인', types: ['도표 정보 일치', '세부 내용 일치', '세부 내용 불일치', '안내문·실용문 일치'] },
  { label: '언어 사용', types: ['어법 판단', '문맥상 어휘'] },
  { label: '빈칸 추론', types: ['빈칸 추론(단어·구)', '빈칸 추론(절·문장)'] },
  { label: '글의 흐름', types: ['흐름과 무관한 문장', '글의 순서 배열', '주어진 문장 삽입'] },
  { label: '통합·장문 독해', types: ['요약문 완성', '장문 독해(제목)', '장문 독해(어휘)', '장문 독해(순서)', '장문 독해(지칭)', '장문 독해(내용 일치)'] },
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
  const type = String(value || '').trim();
  const normalized = QUESTION_TYPE_ALIASES[type] || type;
  return QUESTION_TYPES.includes(normalized) ? normalized : fallback;
}

export const STRUCTURE_ROLES = ['주제 제시', '일반적 통념', '예시', '근거', '부연 설명', '반론', '역접 또는 전환', '핵심 주장', '결론'];
export const LOGIC_STRUCTURES = ['원인과 결과', '문제와 해결책', '주장과 근거', '통념과 반박', '과거와 현재', '장점과 단점', '일반론과 구체적 사례', '대립 구조'];
