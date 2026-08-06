# P06 Codex 보정·검수 증거 노트

## 판정

- 최종 판정: `PASS`
- 검수 커밋: `7ae66f2845712c1f6b4c5fa3012dd5f82c0d4ebc`
- 다음 단계: `P07 진입 허용`

## Antigravity 제출본에서 직접 확인한 주요 결함

- 브라우저 코드에서 Node 전용 `Buffer`를 사용해 실제 파일 업로드가 실패했다.
- 클라이언트 MIME을 신뢰했고 이중 확장자·경로 조작·엄격 Base64·HWP/OOXML 시그니처를 충분히 차단하지 않았다.
- 다운로드 라우팅이 실제 경로를 매칭하지 못해 404였고, 디스크 SHA-256/크기 검증과 브라우저 파일명 노출도 없었다.
- `currentVersionId`/최종본/사건·기일·보고서 장 관계의 DB 무결성과 단일 최종본 제약이 없었다.
- FINAL 회의에 할 일을 추가하거나 다른 사건 기일·타 조직 담당자를 연결할 수 있는 경계가 불완전했다.
- 자료실·회의록 UI에 새 버전, 다운로드, 메타데이터, 연결 대상, 회의 수정·확정·할 일·TXT 원문 업로드 실제 흐름이 없었다.
- `test:e2e`와 `test:security`가 P05 수트를 계속 가리켰고 P06의 실제 브라우저·보안 검증이 없었다.
- manifest에 구현 커밋/changedFiles가 없고 review request가 누락됐으며 commands.log는 실제 실행 증거가 아니었다.

## Codex 보정

- 브라우저 FileReader 업로드와 인증 다운로드, MIME 추론, v01→v02→v03, 최종본, 메타데이터·SHA·연결 대상 UI를 구현했다.
- 서버에서 정확한 확장자↔MIME 정책, strict Base64, 크기, 시그니처, 이중 확장자/NUL/경로 차단, 안전 storageKey, SHA/크기 다운로드 검증, `nosniff`, CORS 파일명 노출을 강제했다.
- P06 migration을 손실 없는 additive migration으로 재작성하고 문서 포인터·단일 최종본·최종 버전 불변·같은 사건 링크·회의 원문/FINAL/자식 불변·같은 조직/사건 연결을 DB 트리거로 강제했다.
- 낙관적 잠금, AuditLog 원자성, 파일 보상 삭제, stale 충돌 시 orphan 0을 API·테스트로 검증했다.
- 실제 Chrome E2E와 독립 P06 보안 수트를 추가하고 P04/P05 공격 회귀를 유지했다.

## 재현 결과

- 일반 테스트: `60 passed, 0 failed, 0 skipped`
- 보안 테스트: `22 passed, 0 failed, 0 skipped`
- 실제 Chrome E2E: 업로드→v02→최종본→다운로드→회의 원문→할 일→FINAL→Staff 차단 통과
- 의존성 audit: high 이상 `0`
- 비밀정보/고객정보: 추적 패턴 `0`, 민감 파일 `0`, 실제 고객정보 `0`

실패를 의도적으로 주입하는 AuditLog 롤백 테스트에서는 Prisma 오류가 stderr에 출력된다. 해당 요청이 500으로 실패한 뒤 DB 행과 디스크 파일이 모두 0으로 복구되는지 확인하는 정상적인 적대 테스트이며 테스트 자체는 통과했다.
