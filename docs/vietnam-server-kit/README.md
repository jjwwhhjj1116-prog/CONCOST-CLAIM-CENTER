# CONCOST Claim Center · Vietnam Server Bridge Kit

이 폴더는 GitHub 본체와 함께 베트남 개발팀에 전달하는 서버 연결용 보조 소스다.

## 먼저 읽을 문서

1. `AFTER_SERVER_CONNECTION_EN.md` — English execution instructions
2. `AFTER_SERVER_CONNECTION_VI.md` — Hướng dẫn thực hiện bằng tiếng Việt
3. `../runbooks/vietnam-primary-server-migration-handoff.md`
4. `../runbooks/vietnam-yjs-hocuspocus-handoff.md`
5. `../runbooks/vietnam-hermes-private-bridge.md`

## 포함된 실행 자료

- `collaboration-server/`: Hocuspocus v4 + PostgreSQL Yjs binary 저장 starter
- `api/collaboration-token-service.example.ts`: 기존 로그인/권한 API에 넣을 5분 JWT 발급 서비스
- `migrations/001_collaboration_documents.sql`: Yjs 문서·감사 테이블
- `nginx/claim-center.conf.example`: `/collaboration` WebSocket reverse proxy
- `runtime-config.production.example.js`: 웹 번들을 다시 빌드하지 않고 서버 주소를 주입하는 파일
- `docker-compose.collaboration.example.yml`: private network 서비스 예시
- `.env.example`: Secret 이름 계약; 실제 값 금지

## 반드시 본체에서 같이 가져갈 프론트 파일

ZIP의 `web-overlay/`에는 현재 구현된 Yjs/Hocuspocus와 HWP 브리지 파일이 경로를 유지한 채 포함된다. GitHub 최신본이 더 새로우면 무조건 최신본을 기준으로 diff하여 병합하고 파일 전체를 과거본으로 덮어쓰지 않는다.

완료 판정은 WebSocket 연결 표시가 아니라 서로 다른 승인 계정 2명의 동시 편집·재접속 복원·타 조직 거부·최종본 잠금·Hocuspocus 장애 폴백까지 통과했을 때만 한다.
