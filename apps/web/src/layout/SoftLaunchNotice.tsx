import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@claim-studio/ui';

const NOTICE_KEY = 'claim-center-soft-launch-notice-2026-08-31-v1';

export const SoftLaunchNotice: React.FC = () => {
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem(NOTICE_KEY) === 'dismissed');
  const [detailOpen, setDetailOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!detailOpen) return undefined;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDetailOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [detailOpen]);

  const dismiss = () => {
    window.localStorage.setItem(NOTICE_KEY, 'dismissed');
    setDismissed(true);
  };

  return <>
    {!dismissed && <aside className="soft-launch-banner" aria-label="가오픈 운영 안내">
      <span className="soft-launch-badge">BETA</span>
      <div><strong>클레임센터 스튜디오는 현재 가오픈 운영 중입니다.</strong><p>외부 발송 전 확정 문서를 직접 열어 확인해 주세요. 오류가 보이면 입력을 유지한 채 관리자에게 알려주세요.</p></div>
      <Button size="sm" variant="secondary" onClick={() => setDetailOpen(true)}>이용 안내 보기</Button>
      <button type="button" className="soft-launch-dismiss" aria-label="가오픈 안내 배너 닫기" onClick={dismiss}>×</button>
    </aside>}
    {detailOpen && <div className="soft-launch-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailOpen(false); }}>
      <section className="soft-launch-dialog" role="dialog" aria-modal="true" aria-labelledby="soft-launch-title">
        <header><div><span>SOFT LAUNCH · MEMBER GUIDE</span><h2 id="soft-launch-title">가오픈 이용 안내</h2></div><button ref={closeButtonRef} type="button" aria-label="가오픈 이용 안내 닫기" onClick={() => setDetailOpen(false)}>×</button></header>
        <div className="soft-launch-dialog__grid">
          <article><span>01</span><div><h3>기본 업무 흐름</h3><p>프로젝트 의뢰 → 제안서 입력·초안·검수·확정 → 프로젝트 접수·담당 PM·기준 일정 → 착수회의·현장조사·물량산출 → 보고서 작성·검수·확정 순서로 이용합니다.</p></div></article>
          <article><span>02</span><div><h3>문서 발송 전 확인</h3><p>DOCX·PDF·HWP 확정본은 미리보기 페이지를 A4 이미지로 보존해 출력합니다. 거래처 발송 전 내려받은 파일의 첫 장·중간 장·마지막 장을 반드시 열어 확인해 주세요.</p></div></article>
          <article><span>03</span><div><h3>현재 주의사항</h3><p>여러 화면에서 같은 일정을 동시에 수정한 경우 최신 일정 확인 안내가 표시될 수 있습니다. 입력값은 유지되며, 최신 일정 다시 불러오기 후 재저장할 수 있습니다. 메일·Drive·AI 기능은 관리자 연결 상태에 따라 제한될 수 있습니다.</p></div></article>
          <article><span>04</span><div><h3>추가 개발 예정</h3><p>실시간 공동 편집·변경자 표시, 문서 형식별 호환성 확대, 외부 메일 서버 실제 발송, Google Drive 및 AI 연결 상태 안내를 순차 보강합니다.</p></div></article>
        </div>
        <footer><p>문제 신고 시 사용한 프로젝트명, 화면, 발생 시각과 캡처를 함께 전달해 주세요.</p><Button onClick={() => { dismiss(); setDetailOpen(false); }}>확인하고 시작하기</Button></footer>
      </section>
    </div>}
  </>;
};
