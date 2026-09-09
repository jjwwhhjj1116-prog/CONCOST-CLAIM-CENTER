# CF131 ES 산출서 삭제·복구 검증

2026-09-09 · development 전용. 기존 업무 산출서를 시험 삭제하거나 수정하지 않았다.

## 구현

- 산출서 목록의 열기 옆 삭제 버튼, 제목을 포함한 확인창, 삭제한 산출서 목록과 복구.
- 취소는 요청하지 않고, 실패는 행을 유지한다. 진행 중 중복 작업을 차단한다.
- 같은 조직의 작성자 또는 관리자만 삭제·복구 가능. expectedRevision으로 충돌을 검사한다.
- 기존 입력/hash를 복제한 불변 revision과 DELETED/RESTORED 감사 이벤트로 처리한다. 연결 프로젝트·기존 계산·출력 이력을 보존한다.
- 삭제 상태의 직접 조회·저장·계산·출력을 차단하고 실제 쓰기 SQL에도 상태/버전 조건을 적용했다.
- 복구 후 삭제 이전 계산/출력 작업을 재사용할 수 없다. 새 저장·계산이 필요하다.
- DB migration/스키마 변경 없음. 원본·키·고객정보 커밋 없음.

## 실제 실행 결과

| 검증 | 결과 |
| --- | --- |
| 기존 ES 계산·저장·출력·가져오기·요율·금액·UI + 신규 삭제 테스트 | 165/165 PASS, 실패/미실행 0 |
| 신규 삭제·복구 테스트 | 위 결과에 포함, 16/16 PASS |
| 변경 테스트 standalone strict 타입 검사 | PASS |
| 웹 tsc + Vite production build | PASS, 기존 대형 번들 경고 유지 |
| 실제 App + 격리 Chrome, 합성 API | 6/6 PASS, pageErrors 0, 예상 외 API 0 |
| development Wrangler dry-run | PASS |
| development 배포 | 6d2c0526-11b6-48e1-81c8-1f1f5096afab |
| live health/readiness/익명 보호/배포 자산 SHA | PASS |

브라우저 시험: 삭제 취소, 삭제 실패, 중복 클릭 방지, 삭제 목록·복구 취소, 복구 실패, 복구 후 제목·입력 재진입과 비대상 문서 보존. 브라우저 확장 연결이 native 확인창에서 응답하지 않아 새 격리 Chrome에서 같은 실제 App을 검증했다. 업무 데이터 대신 메모리 합성 자료를 사용했다.

원본/Node/D1 스키마별 테스트는 격리 SQLite에서 실행했다. 저장/삭제/복구/계산/출력 경합, 원문/hash/이력 보존, 권한 차단, 감사 기록 실패 시 rollback을 확인했다. 독립 검수에서 발견한 ‘복구 후 오래된 출력 PATCH 재개’는 수정 후 회귀에 포함했다.

증거(로컬, Git 제외): `output/playwright/es-v2/cf131-browser-results.json`, `cf131-browser-test.ts`, `cf131-*.png`, `tmp/cf131-development-deploy.log`.

## 실행 명령

```text
node node_modules/tsx/dist/cli.mjs --test scripts/cf123-es-calculation-test.ts scripts/cf123-es-storage-test.ts scripts/cf123-es-output-test.ts scripts/cf124-es-input-layout-test.ts scripts/cf125-es-import-dialog-test.ts scripts/cf127-es-health-test.ts scripts/cf127-es-money-test.ts scripts/cf128-es-print-test.ts scripts/cf129-es-source-sync-test.ts scripts/cf129-es-print-test.ts scripts/cf130-es-workbench-test.ts scripts/cf131-es-delete-test.ts
corepack.cmd pnpm cf:build
node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.development.jsonc --dry-run
node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.development.jsonc --var RELEASE_MAINTENANCE:0
node scripts/cf114-live-smoke.mjs development
```

## 범위와 제한

- 실서비스/가오픈/베트남 서버 배포 없음. 라이브 실제 문서의 삭제·복구 시험은 데이터 보호를 위해 미실행.
- 영구 삭제/파일 회수 기능이 아니다. 이미 내려받은 Excel/PDF와 열린 브라우저의 사본은 회수하지 않는다.
- 원본 Excel 재계산, 프린터 출력 전체 회귀는 이 삭제 기능 작업에서 별도로 실행하지 않았다.
- 목록당 500건 제한은 기존과 동일하다.
- 구버전 서비스는 새 삭제 이벤트를 이해하지 못하므로 단순 구버전 rollback은 삭제 문서를 다시 노출할 수 있다. 장애 시 쓰기를 차단하고 삭제 필터를 유지한 수정판으로 복구해야 한다. DB를 교체하거나 감사 이벤트를 지우지 않는다.
- 노임/ECOS/기타 요율의 전체 자동 수집은 이번 삭제 배포에 포함되지 않았다. 별도 `CF131_ES_API_CONNECTION_GUIDE.md`에 발급 순서·자료별 기관·원본 수식 확인·구현 잔여 작업을 구분했다.
