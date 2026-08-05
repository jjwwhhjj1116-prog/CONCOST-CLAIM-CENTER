# 하네스 작업 협약 (Working Agreement)

## 1. 개요
본 협약은 `클레임 케이스 허브 및 AI 보고서 스튜디오` 프로젝트 진행 시 실행자(Google Antigravity)와 검수자(Codex) 간의 규칙과 작업 방식을 정의합니다.

## 2. 기본 원칙
1. **단계별 격리**: 현 단계(Current Phase)의 검수가 통과(`PASS`)되기 전에 다음 단계 작업을 시작하지 않습니다.
2. **독립 검수**: 실행자는 스스로 final PASS 상태를 결정할 수 없으며, 반드시 Codex 검수 절차를 거쳐야 합니다.
3. **품질 게이트 준수**:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm build`
   모든 단계에서 상기 명령어가 오류(Exit code 0) 없이 통과해야 합니다.
4. **증거 패키지 보존**: `/artifacts/harness/PXX/` 하위에 실행 로그, 테스트 결과, `manifest.json`을 명확히 보관합니다.
5. **제품 및 AI 안전 불변조건 준수**:
   - 사건번호, 당사자명, 계약금액, 기일, 법령 등 핵심 데이터의 AI 임의 생성 금지.
   - 확정 전 필수 승인 절차 보장 및 Audit Log 기록.
