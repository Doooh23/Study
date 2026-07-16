export const sourceProblem = {
  id: 'source_001',
  passage: `People often assume that having more options improves their freedom. Yet an abundance of choices can impose a hidden constraint. When every alternative demands comparison, the effort required to decide increases, and people become more anxious about the paths they did not take. A smaller, thoughtfully selected set of options can therefore reinforce genuine autonomy: it allows attention to move from endless comparison to meaningful commitment. Freedom is not simply the number of doors before us, but our ability to walk through one with confidence.`,
  question: '다음 빈칸에 들어갈 말로 가장 적절한 것은?',
  options: [
    'the quantity of options always guarantees satisfaction',
    'limiting choices may sometimes support meaningful freedom',
    'anxiety disappears when decisions are made quickly',
    'people should avoid making commitments whenever possible',
    'comparison is the most reliable path to autonomy',
  ],
  correctAnswer: 2,
  selectedAnswer: 1,
  type: '빈칸 추론(절·문장)',
  topic: '심리',
  source: '홍동원 데모 모의고사',
  difficulty: '평가원 수준',
  evidenceSentence: 'A smaller, thoughtfully selected set of options can therefore reinforce genuine autonomy: it allows attention to move from endless comparison to meaningful commitment.',
  explanation: '선택지가 많을수록 자유롭다는 통념을 제시한 뒤 Yet에서 방향을 전환하여, 신중하게 제한된 선택지가 오히려 진정한 자율성을 강화한다고 주장합니다.',
  sentences: [
    'People often assume that having more options improves their freedom.',
    'Yet an abundance of choices can impose a hidden constraint.',
    'When every alternative demands comparison, the effort required to decide increases, and people become more anxious about the paths they did not take.',
    'A smaller, thoughtfully selected set of options can therefore reinforce genuine autonomy: it allows attention to move from endless comparison to meaningful commitment.',
    'Freedom is not simply the number of doors before us, but our ability to walk through one with confidence.',
  ],
  structure: ['일반적 통념', '역접 또는 전환', '근거', '핵심 주장', '결론'],
  words: [
    { word: 'abundance', lemma: 'abundance', partOfSpeech: 'noun', meaning: '풍부함, 많음', contextMeaning: '지나치게 많은 선택지', senses: [
      { meaning: '풍부함', contextMeaning: '수량이나 정도가 넉넉한 상태', usage: '추상적 양이나 자원 설명', note: 'abundance of options' },
      { meaning: '과잉', contextMeaning: '지나치게 많아 오히려 부담이 되는 상태', usage: '문제의식이 있는 문장', note: 'abundance can overwhelm' },
    ], difficulty: 3 },
    { word: 'constraint', lemma: 'constraint', partOfSpeech: 'noun', meaning: '제약', contextMeaning: '선택을 어렵게 하는 숨은 제약', senses: [
      { meaning: '제약', contextMeaning: '행동이나 선택을 제한하는 조건', usage: '정책, 규칙, 상황 설명', note: 'a hidden constraint' },
      { meaning: '강제, 구속', contextMeaning: '더 강하게 묶는 압력', usage: '형식적·법적 제한', note: 'under constraint' },
    ], difficulty: 3 },
    { word: 'reinforce', lemma: 'reinforce', partOfSpeech: 'verb', meaning: '강화하다', contextMeaning: '진정한 자율성을 강화하다', senses: [
      { meaning: '강화하다', contextMeaning: '기존의 힘이나 효과를 더 강하게 하다', usage: '논지, 습관, 구조 강화', note: 'reinforce autonomy' },
      { meaning: '보강하다', contextMeaning: '물리적으로 더 튼튼하게 만들다', usage: '구조물, 장치, 장벽', note: 'reinforce a wall' },
    ], difficulty: 3 },
    { word: 'autonomy', lemma: 'autonomy', partOfSpeech: 'noun', meaning: '자율성', contextMeaning: '스스로 선택하고 실행하는 능력', senses: [
      { meaning: '자율성', contextMeaning: '스스로 판단하고 결정하는 능력', usage: '개인, 학습, 의사결정', note: 'genuine autonomy' },
      { meaning: '자치권', contextMeaning: '조직이나 지역이 스스로 운영하는 권리', usage: '정치, 행정, 기관', note: 'political autonomy' },
    ], difficulty: 4 },
    { word: 'commitment', lemma: 'commitment', partOfSpeech: 'noun', meaning: '헌신, 전념', contextMeaning: '선택한 것에 의미 있게 전념함', senses: [
      { meaning: '헌신', contextMeaning: '어떤 일에 마음과 시간을 지속적으로 쏟는 것', usage: '관계, 일, 목표', note: 'commitment to a goal' },
      { meaning: '약속', contextMeaning: '상대와 한 확고한 약속', usage: '관계·공식 발언', note: 'make a commitment' },
    ], difficulty: 3 },
  ],
};

export function createInitialData() {
  return {
    user: { id: 'local_user', name: '', grade: null, targetGrade: null, username: '', email: '', role: 'user', aiUsage: null },
    vocabulary: [],
    submittedProblems: [],
    generatedProblemSets: [],
    analysisReports: [],
    learningHistory: [],
    weakTypes: {},
    weakTopics: {},
    reviewSchedule: [],
    settings: { darkMode: false, dailyGoal: 5, preferredDifficulty: '평가원 수준', reduceMotion: false },
    currentProblem: null,
    currentAnalysis: null,
    activeSet: null,
    practiceSession: null,
    pendingRegistration: null,
  };
}
