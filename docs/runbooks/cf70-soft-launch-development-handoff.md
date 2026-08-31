# CF70 가오픈·개발 서버 분리 인수인계

## 결론

- 현재 가오픈 Worker `concost-claim-center-preview`와 D1 `concost-claim-center-preview-db`는 이 작업에서 배포·마이그레이션하지 않는다.
- 개발 Worker는 `concost-claim-center-development`, 개발 D1은 `concost-claim-center-development-db`로 완전히 분리한다.
- 개발 배포는 반드시 `wrangler.development.jsonc`를 사용한다. 인자 없이 `wrangler deploy`를 실행하면 가오픈 Worker를 가리키므로 금지한다.

## 이번 수정

1. 제안서·보고서 확정 DOCX는 미리보기 1페이지를 Word 1페이지로 고정해 14페이지가 백지 없이 출력되도록 표준 OOXML로 재구성했다.
2. HWP는 확정본 다운로드만 수행하고 편집기를 열지 않는다. HWP 생성 후 완성 파일을 다시 열어 페이지 수와 OLE 서명을 자기검증한다.
3. 프로젝트 일정은 착수회의·현장조사·수량산출·보고서 화면이 동일한 D1 기준 일정을 사용한다.
4. 동일 담당 PM의 화면 간 저장은 최신 버전을 안전하게 이어받고, 다른 사용자가 먼저 바꾼 경우는 409로 보호한다.
5. 4개 단계 전체 저장은 D1 batch로 모두 성공하거나 모두 취소되어 부분 저장을 막는다.
6. 회원 화면 상단에 가오픈 안내와 문서 출력·일정 충돌·외부 연동 주의사항, 추가 개발 예정을 표시한다.

## DB 방침

- 이번 수정은 기존 테이블·컬럼을 바꾸지 않아 **신규 migration이 없다**. 일정 저장 API의 트랜잭션 방식만 변경했다.
- 가오픈 D1을 개발 D1에 덮어쓰거나, 개발 D1을 가오픈 D1에 복사하지 않는다.
- 기존 SQLite `dev.db`를 사용하는 베트남 메인 서버는 `docs/runbooks/vietnam-weekly-sqlite-update.md`에 따라 DB 파일을 보존하고 추가 migration만 적용한다.

## 개발 배포 명령

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test:cf40
corepack pnpm test:cf69
corepack pnpm cf:build
corepack pnpm cf:d1:migrate:development
corepack pnpm cf:deploy:development
```

## 외부 연동

- 개발 도메인의 Google OAuth callback은 `https://concost-claim-center-development.jjwwhhjj1116.workers.dev/auth/google/callback`이다.
- Google Console에 위 URI를 개발용 리디렉션 URI로 별도 등록하기 전에는 Google Drive 인증을 테스트하지 않는다.
- AI·Google 암호화 키는 소스나 D1에 복사하지 말고 Cloudflare Worker secret로 별도 설정한다.

## 검증 기준

- TypeScript typecheck 통과
- Cloudflare 프로덕션 빌드 통과
- 일정 통합 테스트 10/10 통과
- 실제 Chrome 문서·접수·일정 E2E 6/6 통과
- Word에서 DOCX 14페이지 재렌더 완료

## 롤백

- 개발 Worker 문제는 Cloudflare Worker 버전에서 직전 버전을 재배포한다.
- 가오픈 Worker는 이 브랜치에서 배포하지 않았으므로 별도 롤백이 필요 없다.
