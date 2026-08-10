# P12 독립 검수 및 보완 노트

## 최종 결과

- 판정: `PASS_WITH_NOTES`
- Antigravity 원 구현: `1741bda7d35368a42e569947aaefaa57317769cf`
- Codex 보완 후 검수 구현: `0d5e563bd26dc3b16f1e434d13bdb85daa697eb3`
- 깨끗한 checkout: `work/p12-clean-verify4`
- 다음 단계: P13 비용·성공보수 진입 허용

## Codex가 직접 보완한 내용

1. 로그인 개발 원점 CORS를 수정하고 대시보드를 최근 사건·다가오는 일정·실행 버튼이 있는 실제 업무 화면으로 확장했다.
2. `REPO-01` 보고서 목록과 `APPR-01` 검토·승인함을 공통 플레이스홀더에서 실제 REST API 기반 화면으로 교체했다.
3. 최종 출력 다운로드를 Vite 상대 링크에서 인증된 API Blob 다운로드로 교체했다.
4. 검토 이력을 append-only 이벤트로 만들고 담당 Reviewer 역할·배정·멱등성·stale event 경계를 강화했다.
5. 최종 확정 snapshot을 transaction 안에서 재검증하고 최신 revision/hash/validation/citation/approval을 DB trigger와 API에서 고정했다.
6. Staff 출력 생성을 차단하고 artifact 파일 서명·크기·해시를 생성·재사용·다운로드마다 검증했다.
7. 동시 출력에서 다른 요청의 파일을 삭제할 수 없도록 exclusive write와 소유 파일 rollback을 적용했다.
8. DOCX 관계·필수 part 검증과 PDF xref/stream/page marker 검증을 강화하고 긴 목차·본문을 실제 다중 페이지로 분할했다.
9. 루트 `postinstall` 및 DB 스크립트의 중첩 bare pnpm 호출을 제거해 pnpm 9.15.0 깨끗한 설치 재현성을 복구했다.

## 제출 증거와 독립 실측의 차이

- 원 `commands.log`는 11개 게이트 전체를 포함하지 않았다.
- 원 요청서는 전체 보안 42건을 주장했지만 보완 후 실제 누적 보안 결과는 43/43이다.
- 원 제출은 일반 테스트 수를 명시하지 않았고 독립 실행 결과는 89/89다.
- 원 DOCX/PDF 증거는 실제 브라우저 다운로드의 구조 수치를 남기지 않았다. 독립 E2E는 DOCX 9 entries, PDF 5 pages를 검증했다.
- 원 manifest에는 implementation commit의 정확한 `changedFiles`와 테스트 결과가 없었다. 현재 manifest는 Codex 보완 커밋의 18개 파일과 1:1 일치한다.

## 보안·개인정보 점검

- 실제 API key, access token, private key 패턴: 0건
- Git 추적 DB/SQLite/DOCX/PDF 산출물: 0건
- 실제 고객정보: 0건; 테스트 데이터는 `.invalid` 도메인과 synthetic 식별자만 사용
- `docs/보고서 템플릿/` 원본과 로컬 reference는 Git 제외 유지

## 남은 낮은 위험 메모

1. Node 24 의존 도구가 `DEP0169 url.parse()` deprecation 경고를 출력하지만 모든 게이트는 exit 0이고 audit은 알려진 취약점 0건이다.
2. 기능 UI는 실제 API와 Chromium 흐름으로 검증했지만, 이미지 기반 시각 회귀 baseline은 아직 없다. P13부터 각 단계의 첫 산출물을 실제 브라우저 화면으로 고정한다.
