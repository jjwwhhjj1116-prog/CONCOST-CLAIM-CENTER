# Antigravity P02 실행 지시

## 기준점

- P01 PASS 상태 커밋: `5167c68`
- P02 사전 초안 반입 커밋: `8847743`
- 작업 브랜치: `feat/P02-stitch-ux-ui-design`
- 최상위 실행 지침: `01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS_v2.md`
- 6대 유형 명세: `03_CLAIM_6_TYPE_TEMPLATE_MAPPING_SPEC.md`

`docs/stitch/`의 47개 파일은 이전 P02 결과를 민감 이력 없이 보존한 **재검증 대상 초안**이다. 기존 설명이나 과거 테스트 결과를 신뢰하지 말고 P01 v2 계약과 현재 파일을 직접 비교하라.

## 시작 절차

1. 현재 브랜치와 HEAD가 위 기준점인지 확인한다.
2. `docs/harness/phase-status.json`의 `currentPhase`를 `P02`, P02 상태를 `IN_PROGRESS`로 변경한 상태 커밋을 만든다.
3. P01 파일과 원본 `docs/보고서 템플릿/`, `docs/클레임 업무 프로세스.xlsx`는 이동·삭제·이름변경·덮어쓰기하지 않는다.
4. P00/P01 Codex 검수 보고서를 구현 커밋에 포함하지 않는다.

## 필수 작업

1. 정확히 20개 화면을 유지한다. 임의 화면 누락·추가 시 근거를 기록한다.
2. 클레임 유형은 `TYPE-01`~`TYPE-06` 정확히 6개만 사용한다.
3. `docs/보고서 템플릿/`의 9개 폴더는 업무 유형이 아니라 레퍼런스 묶음으로 취급한다.
4. 다음 P02 산출물을 P01 계약과 1:1 대조하여 보정한다.
   - `docs/stitch/stitch-master-prompt.md`
   - `docs/stitch/component-map.md`
   - `docs/stitch/design-tokens.json`
   - `docs/stitch/page-specs/*.md`
   - `docs/stitch/accessibility-notes.md`
   - `docs/stitch/artifacts/*/screen.html`
5. 모든 화면에 1440px 데스크톱과 1024px 태블릿 동작을 명시한다.
6. 정상·로딩·빈 상태·오류·403 권한 없음 상태가 실제 화면에서 전환 가능해야 한다.
7. 보고서 스튜디오는 왼쪽 목차/상태, 중앙 구조화 편집기, 오른쪽 근거/AI/검증의 3단 구조를 유지한다.
8. 색상 외 아이콘·텍스트 상태 표현, 키보드 탐색, 포커스 링, 대비, 긴 텍스트 오버플로우를 검증한다.
9. 대시보드는 10초 이해 기준과 주요 행동 2클릭 이내를 증거로 남긴다.
10. `scripts/harness-test.ts`에 P02 정상 검증과 독립 반례를 추가한다. 단순 키워드 존재·파일 크기 검사만으로 통과시키지 않는다.

## 반례 검증

최소 다음 변이를 각각 독립 적용하고 테스트 실패 후 원복한다.

- 20개 화면 중 1개 누락
- `TYPE-07` 추가
- 9개 템플릿 폴더를 유형으로 오인한 매핑 추가
- REPO-02 3단 구조 중 1개 영역 제거
- 1024px 드로어 복구 버튼 또는 이벤트 제거
- 상태 전환 중 오류/403 한 가지 제거
- 접근성 이름 또는 포커스 스타일 제거

## 품질 게이트와 증거

```powershell
npx --yes pnpm@9.15.0 install --frozen-lockfile
npx --yes pnpm@9.15.0 lint
npx --yes pnpm@9.15.0 typecheck
npx --yes pnpm@9.15.0 test
npx --yes pnpm@9.15.0 build
npx --yes pnpm@9.15.0 audit --audit-level high
```

- `artifacts/harness/P02/manifest.json`, `commands.log`, `notes.md`를 새 결과로 생성한다.
- 구현 커밋 A의 `git diff-tree`와 manifest `changedFiles`를 정확히 일치시킨다.
- 상태 커밋 B에서 P02를 `READY_FOR_REVIEW`로 변경하고 `docs/reviews/requests/P02-review-request.md`를 작성한다.
- 실제 고객정보·API 키·토큰·원본 파일명은 증거와 커밋에 포함하지 않는다.

## 완료 보고 형식

- 브랜치
- 구현 커밋 A와 상태 커밋 B
- 변경 파일
- 6개 품질·보안 게이트 결과
- 테스트 수와 반례 결과
- 증거 경로
- 알려진 제한
- Codex 재검수 요청 경로

Antigravity 완료 후 Codex가 저장소·커밋·clean snapshot·반례를 다시 독립 검수하고, 미달 부분은 Codex가 직접 보정한다.
