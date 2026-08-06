# P06 Antigravity 선행 구현 지시서 — 자료실·문서 버전·회의록

## 0. 진입 조건

- P05 판정: `PASS`
- P05 검수 커밋: `719ecbc0ba81d98bd47ed14662e599f7da6f98f1`
- 새 P06 브랜치는 원본 E 저장소에 통합된 최종 P05 PASS 상태 커밋에서 생성한다.
- 권장 브랜치: `feat/P06-materials-document-versions-meetings`
- `phase-status.json`을 `currentPhase: P06`, `P06.status: IN_PROGRESS`, `nextPhaseAllowed: false`로 바꾸는 시작 커밋을 먼저 만든다.
- P05의 46개 일반 테스트와 16개 보안 테스트를 삭제·완화·skip하지 않는다.
- P07은 Codex의 P06 PASS 전까지 시작하지 않는다.

## 1. 고정 구현 범위

v2 지시서 P06의 범위만 구현한다.

1. 사건 자료 업로드와 조회·다운로드
2. `RECEIVED`(수신), `AUTHORED`(작성), `SUBMITTED`(제출) 구분
3. 문서 메타데이터와 서버 생성 저장 키
4. 파일명 규칙 `[사건코드]_[문서유형]_[문서명]_[YYYYMMDD]_v01`
5. 동일 논리 문서의 원본·버전·최종본 추적
6. 사건·일정·보고서 장 연결
7. 회의록 직접 작성과 회의 텍스트 업로드
8. 요약·결정사항·할 일 추출 인터페이스
9. 원본 회의 텍스트와 확정 회의록의 변경 불가 보존
10. 회의 할 일을 담당자와 기일에 연결

Google Drive/Docs OAuth 실제 연동과 외부 AI 호출은 P06 범위를 확장하지 않는다. P06에서는 로컬 저장 어댑터와 수동·결정적 추출 인터페이스로 계약을 완성한다.

## 2. DB·마이그레이션 요구사항

- Prisma에 최소 `Document`, `DocumentVersion`, `Meeting`, `MeetingActionItem`을 구현한다.
- 문서와 버전은 별도 엔터티여야 하며 `(documentId, versionNumber)`는 unique여야 한다.
- 저장 경로는 사용자 파일명을 직접 사용하지 말고 서버 생성 `storageKey`만 사용한다.
- 원본 파일명은 표시용 정제 값으로만 보관한다. `..`, 절대경로, 드라이브 문자, NUL, 경로 구분자를 허용하지 않는다.
- SHA-256, byte size, 검증된 MIME, 확장자, 업로더, 생성 시각, 출처 구분, 문서 유형을 보관한다.
- 최종본 변경은 원자적이며 AuditLog와 같은 트랜잭션에 기록한다. 최종 버전 삭제는 DB/API에서 차단한다.
- 사건·일정·보고서 장 연결은 외래키와 조직 경계를 보존한다.
- 회의 확정본과 원본 텍스트는 확정 후 UPDATE/DELETE를 DB 트리거 또는 동등한 DB 제약으로 막는다.
- P04/P05 데이터가 들어 있는 DB에 P06 migration을 적용하는 보존 테스트를 반드시 만든다. 기존 테이블 DROP/재생성으로 하위 데이터를 유실하면 즉시 실패다.

## 3. 파일 저장·보안 요구사항

- 실제 고객 파일을 저장소·테스트·외부 AI에 사용하지 않는다. 작은 합성 fixture만 사용한다.
- 업로드 크기 상한, 확장자 allow-list, MIME allow-list, magic-byte 검증을 서버에서 모두 수행한다.
- 이중 확장자, MIME 불일치, 과대 파일, 경로 조작, NUL, 동일 파일명, 권한 없는 다운로드, 다른 사건 IDOR, 최종본 삭제를 공격 테스트로 직접 호출한다.
- 동일 파일명은 덮어쓰지 말고 같은 논리 문서의 새 버전 또는 충돌 응답으로 처리한다.
- 업로드 실패와 메타데이터/AuditLog 실패 시 DB 행과 디스크 파일이 함께 정리되는 보상 트랜잭션을 검증한다.
- 다운로드는 로그인, 조직, 사건 접근·배정 권한을 서버에서 다시 확인한 뒤 스트리밍한다.
- 실행 파일·스크립트·매크로 문서 등 위험 형식은 P06 allow-list에서 제외한다.
- `.data/uploads/` 등 로컬 저장소는 Git 추적에서 제외하고 테스트 종료 시 생성 파일을 정리한다.

## 4. API·권한 요구사항

- 문서 업로드·버전 추가·최종본 지정·다운로드·삭제 API를 실제 DB와 저장 어댑터에 연결한다.
- 사건 자료 변경 권한은 P05 사건 작성 권한(CEO/Director/PM/Admin)과 동일하게 서버에서 강제한다. Staff/Reviewer는 제품 권한표 범위의 읽기만 허용한다.
- PM은 사건/문서 soft-delete 권한을 임의로 확대하지 않는다.
- 모든 mutation은 CSRF, Origin allow-list, 세션, 조직·배정 경계, AuditLog 원자성을 유지한다.
- 회의록 작성·수정·확정, action item 담당자·기일 연결 API를 구현하고 낙관적 잠금 `version` 충돌은 409로 처리한다.

## 5. 실제 UI 요구사항

- 기존 `CASE-05` 사건 상세-자료실과 `MEET-01` 회의록 라우트를 실제 API에 연결한다.
- 자료실에서 문서명, 출처 구분, 문서 유형, 버전, 최종본, 업로더, 시각, 크기, 연결 대상을 확인할 수 있어야 한다.
- 업로드, 새 버전, 최종본 지정, 권한 있는 다운로드, 회의록 직접 작성, 원문 업로드, 요약·결정사항·할 일 편집과 확정 흐름을 구현한다.
- loading, empty, error, 403, oversize/type rejection, duplicate filename, long filename 상태를 실제 UI로 보여준다.
- 1440px/1024px, 키보드 포커스, label/ARIA, 200% 확대 회귀를 유지한다.
- 클라이언트 가짜 데이터나 임의 역할 스위처를 다시 도입하지 않는다.

## 6. 필수 자동화 테스트

기존 테스트에 더해 최소 다음을 자동화한다.

- 동일 문서 v01→v02→v03과 최종본 변경 이력
- 수신/작성/제출 구분, 사건·기일·보고서 장 연결
- 이중 확장자와 MIME/magic-byte 불일치 거부
- 크기 초과, 경로 조작, NUL, 실행형 파일 거부
- 동일 파일명 무덮어쓰기
- 타 조직·미배정·하위 리소스 IDOR 다운로드 차단
- Staff/Reviewer mutation과 PM 최종 삭제 차단
- 최종본/확정 회의록 UPDATE·DELETE 차단
- 감사 실패 시 업로드/메타데이터 롤백 및 orphan 파일 0
- 회의 action item이 같은 조직의 담당자와 기일에 연결됨
- stale version 409와 이력 무변경
- 실제 Chromium: 로그인→사건 자료 업로드→새 버전→최종본→다운로드→회의록 작성/확정→할 일 연결→권한 차단

`test:e2e`와 `test:security`는 별도 스크립트여야 하고, 파일명/문자열 존재만 확인하지 말고 실제 API·DB·디스크·브라우저 동작을 검증한다.

## 7. 11대 게이트와 증거

다음을 깨끗한 설치 환경에서 모두 실행한다.

```powershell
npx --yes pnpm@9.15.0 install --frozen-lockfile
npx --yes pnpm@9.15.0 db:reset
npx --yes pnpm@9.15.0 db:migrate
npx --yes pnpm@9.15.0 db:seed
npx --yes pnpm@9.15.0 lint
npx --yes pnpm@9.15.0 typecheck
npx --yes pnpm@9.15.0 test
npx --yes pnpm@9.15.0 build
npx --yes pnpm@9.15.0 test:e2e
npx --yes pnpm@9.15.0 test:security
npx --yes pnpm@9.15.0 audit --audit-level high
```

- `artifacts/harness/P06/manifest.json`, `notes.md`, `commands.log`를 새로 만든다.
- 구현 커밋 A와 상태·증거 커밋 B를 분리한다.
- manifest의 `changedFiles`는 구현 커밋 A의 `git show --name-only`와 경로·개수 모두 정확히 일치해야 한다.
- 명령의 실제 stdout/stderr, 테스트 passed/failed/skipped, 실제 브라우저 엔진, 보안 공격 수를 기록한다.
- API 키·토큰·개인키·DB·업로드 파일·실제 고객정보 추적 여부를 검사한다.
- `docs/reviews/requests/P06-review-request.md`를 작성하고 `P06.status: READY_FOR_REVIEW`, `nextPhaseAllowed: false`로 제출한다.

## 8. Antigravity 최종 보고 형식

- 기준 P05 PASS 커밋
- P06 시작/구현/상태 커밋
- 실제 변경 파일 목록
- 문서·버전·회의·할 일 모델과 저장 경계
- 파일 공격 테스트 결과
- 일반/보안/E2E 테스트 수
- 11대 게이트 결과
- 증거 경로
- 알려진 제한

구현 설명만으로 완료 처리하지 않는다. Codex가 저장소와 실행 결과를 독립 검수하고 필요 시 직접 보정한다.
