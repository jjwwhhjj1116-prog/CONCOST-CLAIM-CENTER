# P16 Codex 보완 및 검증 메모

## 판정

- 최종 판정: **PASS_WITH_NOTES**
- 구현 커밋 A: `4bb68f7e9bd1e57954905df93e588dd9187432f4`
- 필수 게이트: **11/11 PASS**
- 일반·계약 테스트: **136/136**
- 보안·권한·원자성 테스트: **98/98**
- 실제 Chromium: **P06~P16 전체 연속 PASS**, P16 6개 release-candidate 흐름 PASS

## Codex가 직접 보완한 내용

1. production 시작을 단일 절대 `CLAIM_VOLUME_ROOT`와 두 개의 32바이트 키에 묶고, 루트 밖 DB·storage·vault·backup·restore 경로를 거부했습니다.
2. readiness가 실제 DB 파일 쓰기 가능 여부, migration 이름·SHA-256 원장, storage·backup·restore 디렉터리 쓰기 가능 여부를 각각 검사하도록 교정했습니다.
3. API를 완전히 종료하고 같은 DB/volume으로 재시작한 뒤 실제 API로 만든 사건이 유지되는지 검증했습니다.
4. 대시보드와 사건 목록에 loading·empty·error·403·409·offline/retry 상태 UI를 실제 네트워크 응답과 연결했습니다.
5. Reviewer 403, 충돌 복구, 오프라인 재시도, 전체 보고서 업무 동선, 1440/1024/640, 200% 확대, 키보드 포커스를 실제 Chrome으로 검증했습니다.
6. 운영 runbook의 백업·검증·복구 요청 스키마를 실제 API와 일치시키고 키나 서버 경로를 본문으로 보내지 않도록 고쳤습니다.
7. 예외 로그는 원문 Error 대신 서버 소유 오류 종류만 남겨 token/secret/customer text가 로그로 전달되지 않게 했습니다.

## 운영 메모

- 이 단계는 **원격 배포가 아니라 배포 준비 완료**입니다. Cloudflare, Render, DNS, 실제 Google credential 등록은 수행하지 않았습니다.
- 현재 보존 계약은 Node + SQLite + 영속 볼륨입니다. Cloudflare D1/R2 전환은 transaction·trigger·storage 재설계가 필요한 별도 승인 단계입니다.
- 실제 고객 데이터는 사용하지 않았고 synthetic fixture만 사용했습니다.
