# CF01 Cloudflare Foundation

## 목적

검증된 P16 Node.js/SQLite 릴리스 후보를 유지하면서 Cloudflare 무료 플랜으로 이전하기 위한 별도 기반 단계입니다. 이 단계는 GitHub 자동 빌드, Workers Static Assets, D1, R2의 연결만 검증합니다.

## 안전 경계

- feat/CF01-cloudflare-foundation은 P16과 분리합니다.
- 첫 배포는 Preview 버전으로만 생성하고 운영 트래픽을 전환하지 않습니다.
- 실제 사건, 보고서, 사용자 데이터는 아직 D1/R2로 복사하지 않습니다.
- API는 이관 완료 전 503 CLOUDFLARE_MIGRATION_IN_PROGRESS로 차단합니다.
- Cloudflare에 비밀번호, OAuth 토큰, Google 자격증명 원문을 저장하지 않습니다.

## 무료 플랜 적용 범위

| 구성 | 용도 |
| --- | --- |
| Workers Static Assets | React/Vite SPA |
| Worker Fetch API | 동일 출처 API 진입점 |
| D1 | 관계형 메타데이터 이관 대상 |
| R2 | 업로드 원본, DOCX, PDF 이관 대상 |
| Workers Builds | GitHub push 기반 Preview 빌드 |

Cloudflare Containers는 무료 플랜 대상이 아니므로 사용하지 않습니다.

## 완료 조건

1. D1 claim-center-preview-db와 R2 claim-center-preview-files를 생성합니다.
2. 두 리소스를 DB, FILES 바인딩으로 Worker에 연결합니다.
3. D1에는 apps/cloudflare/migrations만 적용합니다.
4. test:cf01, cf:build, wrangler deploy --dry-run을 통과합니다.
5. GitHub 연결은 Preview 업로드로 제한합니다.
6. 전체 P04-P16 회귀가 D1/R2에서 통과하기 전 운영 전환을 금지합니다.
