# 홍동원 — 배포형 수능 영어 AI 학습 플랫폼

문제 이미지/PDF를 인식하고, 문장별 해석·논리 구조·정답 근거·선택지 함정·핵심 어휘를 인쇄형 분석서로 만드는 Vercel 웹앱입니다. 분석서는 웹에서 확인하거나 다중 페이지 PDF와 고해상도 PNG로 내려받을 수 있습니다.

## 프로덕션 기능

- Supabase Auth 기반 실제 아이디 회원가입·로그인과 오프라인 복구 코드 재설정
- Supabase Postgres 사용자별 학습 데이터 영구 동기화와 RLS
- Postgres 원자적 RPC 기반 계정별 일일 AI 사용량 제한
- Upstash Redis 분산 burst limit, 장애 시 Postgres 영구 rate-limit RPC로 fail-safe 전환
- 관리자 전용 사용자·요청·토큰·추정 비용·오류 대시보드
- 이미지/PDF 비공개 임시 업로드, MIME/매직바이트/크기/PDF 활성 콘텐츠 검사
- 선택형 외부 악성코드 스캐너 연동(`MALWARE_SCAN_URL`)과 검사 실패 시 fail-closed
- 브라우저 전역 오류 수집, Vercel 구조화 로그, 관리자 최근 오류 화면
- 개인정보 처리방침·이용약관·전역 뒤로 가기 버튼
- CSP, HSTS, COOP/CORP, 클릭재킹·MIME sniffing 방지 헤더

## 구조

```text
index.html                     정적 SPA 진입점
assets/js/auth.js              Supabase 실제 인증과 비공개 Storage 업로드
assets/js/cloud-sync.js        사용자별 Postgres 학습 데이터 동기화
assets/js/report*.js           AI 분석서 정규화·웹 표시·PDF/PNG 생성
functions/api/_platform.js     인증 검증, DB, Redis, 사용량, 업로드 보안
functions/api/create-report.js 인쇄형 상세 분석서 생성
functions/api/*                기존 OCR·분석·평가·문제 생성·단어 API
api/*                          Vercel Functions 어댑터
supabase/migrations/           전체 DB/RLS/RPC/비공개 Storage 마이그레이션
ops/                           Vercel Firewall 권장 규칙
```

## 1. Supabase 준비

Supabase 프로젝트를 만든 뒤 SQL Editor에서 [`supabase/migrations/001_production_platform.sql`](supabase/migrations/001_production_platform.sql)을 실행합니다. 이 한 파일이 다음 항목을 생성합니다.

- `profiles`, `account_recovery`, `study_snapshots`, `daily_ai_usage`, `ai_usage_events`
- `rate_limit_windows`, `analysis_reports`, `error_events`
- 신규 Auth 사용자 프로필 trigger
- 사용자별 RLS 정책
- 원자적 일일 사용량 예약/확정 RPC와 관리자 집계 RPC
- 12MB 제한의 private `problem-uploads` Storage bucket과 사용자 폴더 정책

아이디 계정은 서버가 이메일 발송 없이 확인된 내부 Auth 사용자를 생성합니다. 사용자에게 이메일을 수집하지 않으므로 Custom SMTP나 발신 도메인이 필요하지 않습니다. 가입 시 한 번 표시되는 복구 코드는 원문을 저장하지 않고 HMAC 해시만 `account_recovery`에 보관합니다.

```text
http://localhost:4173
https://<production-domain>
```

첫 관리자는 Supabase SQL Editor에서 지정합니다.

```sql
update public.profiles
set role = 'admin'
where username = 'admin_username';
```

## 2. Vercel 환경 변수

`.env.example`의 값을 Vercel Project Settings에 등록합니다. `SUPABASE_SERVICE_ROLE_KEY`, AI 키, Upstash token은 절대로 브라우저 변수나 저장소에 넣지 않습니다.

필수 데이터 계층:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ACCOUNT_RECOVERY_PEPPER      # 선택: 설정하면 서비스 키와 분리된 복구 코드 HMAC 비밀값 사용
```

AI 인증은 다음 중 하나를 사용합니다.

```text
AI_API_KEY                 # OpenAI 직접 호출
AI_GATEWAY_API_KEY         # Vercel AI Gateway 정적 키
VERCEL_OIDC_TOKEN          # Vercel 배포/`vercel env pull`에서 자동 제공
```

직접 API 키가 없으면 Vercel OIDC와 AI Gateway Responses API를 자동 사용합니다. AI Gateway는 프로젝트에 유효한 결제 수단과 사용 한도가 설정되어 있어야 합니다.

권장:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
DEFAULT_DAILY_AI_LIMIT=20
MAX_UPLOAD_MB=12
AI_INPUT_USD_PER_MILLION
AI_OUTPUT_USD_PER_MILLION
PUBLIC_OPERATOR_NAME
PUBLIC_PRIVACY_EMAIL
```

현재 프로젝트에서 실제 호출 가능한 `gpt-5.4-mini`를 OCR·정답 분석·학생 분석 평가·문제 생성·단어 정리·인쇄형 분석서의 기본값으로 사용합니다. 상위 모델을 환경 변수로 지정했을 때 모델 한도나 가용성 문제가 발생하면 하위 모델과 Vercel AI Gateway를 순서대로 자동 시도합니다. 업로드 문제는 이미지 판독과 추출 텍스트 재분석을 분리해 두 번 검증합니다. 관리자 비용 집계는 GPT-5.4/5.5/5.6의 모델별 표준·캐시 입출력 가격을 구분하며, 별도 계약 가격은 `AI_INPUT_USD_PER_MILLION`, `AI_OUTPUT_USD_PER_MILLION`으로 덮어쓸 수 있습니다.

Vercel CLI 사용 예시:

```bash
npx -y vercel@55.0.0 env add SUPABASE_URL production preview development
npx -y vercel@55.0.0 env add SUPABASE_ANON_KEY production preview development
npx -y vercel@55.0.0 env add SUPABASE_SERVICE_ROLE_KEY production preview development --sensitive
npx -y vercel@55.0.0 env add AI_API_KEY production preview development --sensitive
npx -y vercel@55.0.0 env pull .env.local --yes
```

## 3. 분산 rate limit

Upstash가 설정되면 기능·사용자·IP 단위 60초 고정 윈도우를 Redis에서 검사합니다. Redis가 없거나 일시 실패하면 `check_rate_limit` Postgres RPC가 같은 역할을 수행합니다. 일일 AI 한도는 항상 `reserve_ai_request` RPC의 조건부 upsert로 예약하므로 여러 Vercel 인스턴스가 동시에 실행되어도 초과 요청이 통과하지 않습니다.

요청이 모델에 도달하면 `ai_usage_events`에 상태, 모델, 입출력 토큰과 추정 비용을 기록합니다. 실패 요청도 일일 요청 횟수에는 포함되어 반복 실패를 이용한 우회를 방지합니다.

## 4. 업로드 보안

브라우저는 파일을 Supabase private Storage의 사용자 전용 폴더에 직접 업로드합니다. Vercel Function은 다음 검사를 통과한 파일만 메모리로 읽어 AI에 전달하고 즉시 원본 object를 삭제합니다.

- 인증 사용자 폴더 일치
- 허용 MIME: JPG, PNG, WEBP, PDF
- 실제 매직바이트와 선언 MIME 일치
- 배포 설정 용량 제한
- PDF 암호화, JavaScript, Launch action, embedded file 차단
- 확인 가능한 경우 PDF 12페이지 제한

더 강한 악성코드 검사가 필요하면 `MALWARE_SCAN_URL`을 연결합니다. 스캐너는 raw file body를 받고 다음 JSON을 반환해야 합니다.

```json
{ "safe": true, "provider": "scanner-name" }
```

`safe !== true`이거나 스캐너가 실패하면 업로드는 차단됩니다.

## 5. 로컬 실행

```bash
npx -y vercel@55.0.0 env pull .env.local --yes
npx -y vercel@55.0.0 dev --listen 4173
```

`http://localhost:4173`에서 확인합니다. 환경 변수가 없으면 랜딩·정책 화면은 열리지만 회원가입과 AI 기능은 설정 필요 상태로 안전하게 중단됩니다.

## 6. Vercel Firewall과 모니터링

[`ops/vercel-firewall-recommended.json`](ops/vercel-firewall-recommended.json)을 기준으로 Vercel Dashboard → Firewall에서 AI API IP rate limit과 scanner 차단 규칙을 적용합니다. 앱 내부 사용량 제한이 최종 비용 방어선이며 Firewall은 앞단의 추가 방어선입니다. Bot Protection은 처음에는 log 모드로 관찰한 뒤 challenge로 전환합니다.

서버 API는 JSON 구조화 로그를 남기고, 브라우저의 `error`/`unhandledrejection`은 `error_events`에 저장합니다. 관리자 계정은 `/admin`에서 최근 오류와 사용량을 볼 수 있습니다. Pro/Enterprise 환경에서는 Vercel Drains를 Sentry·Datadog 등으로 추가 연결할 수 있습니다.

## 7. 배포 전 체크리스트

1. Supabase migration 실행 및 아이디 가입·로그인·복구 코드 흐름 확인
2. 필수 Vercel 환경 변수 등록, production/preview 데이터 분리
3. 관리자 계정 role 설정
4. 실제 모델 가격 환경 변수 입력
5. Upstash 또는 Postgres fallback rate limit RPC 확인
6. 개인정보 처리방침의 운영자명·문의 이메일을 실제 정보로 교체
7. Firewall 규칙과 Bot Protection 적용
8. 테스트 계정으로 회원가입 → 파일 업로드 → 분석서 생성 → PDF/PNG 저장 → 관리자 집계 확인
9. Production 배포 직후 Vercel Runtime Logs에서 초기 5xx/timeout 확인

```bash
npx -y vercel@55.0.0 --prod
```
