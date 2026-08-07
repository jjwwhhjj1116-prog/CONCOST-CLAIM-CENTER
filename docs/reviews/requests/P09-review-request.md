# P09 재검수 요청서

- 단계: P09 보고서 스튜디오
- 브랜치: `feat/P09-report-studio`
- Antigravity 제출 커밋: `8db5895c357a6716fa112f132240ce9333a16e28`
- Codex 보정 커밋: `e2f1efaba9081d8b4d0f37e559b6034fb9444fcd`, `edc9f8a847e83ad73665c549fcd543c6ff55f63d`, `ceadc14e2cceba18697d6eacc62391b4218b3f8f`
- 최종 검수 대상: `ceadc14e2cceba18697d6eacc62391b4218b3f8f`
- 증거 패키지: `artifacts/harness/P09/`

Antigravity 원 제출에 이 요청서가 누락되어 있었다. 사용자가 허용한 patch 검수 모드에 따라 Codex가 결함을 보정하고 검수 대상과 증거를 재기준화했다. 변경 파일 기준은 `git diff --name-only 8db5895..ceadc14`의 14개 경로이며 manifest와 1:1로 일치한다.

검수 범위는 P08 ReportInstance provenance, 3단 스튜디오, immutable revision/evidence/approval/merge, autosave와 409 무손실 복구, RBAC/tenant/CSRF/audit rollback, 100장·100KB 경계, 실제 Chrome 1024px/keyboard/focus/200% 회귀다. P10 외부 AI 호출과 P12 DOCX/PDF 출력은 포함하지 않는다.
