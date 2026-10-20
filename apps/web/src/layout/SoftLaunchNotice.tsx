import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@claim-studio/ui';

const NOTICE_KEY = 'claim-center-soft-launch-notice-2026-08-31-v1';

export const SoftLaunchNotice: React.FC<{ hideBanner?: boolean; openRequest?: number }> = ({ hideBanner = false, openRequest = 0 }) => {
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem(NOTICE_KEY) === 'dismissed');
  const [detailOpen, setDetailOpen] = useState(false);
  useEffect(() => { if (openRequest > 0) setDetailOpen(true); }, [openRequest]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!detailOpen) return undefined;
    const opener = document.activeElement;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDetailOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [detailOpen]);

  const dismiss = () => {
    window.localStorage.setItem(NOTICE_KEY, 'dismissed');
    setDismissed(true);
  };

  return <>
    {!hideBanner && !dismissed && <aside className="soft-launch-banner" aria-label="가오픈 운영 안내">
      <span className="soft-launch-badge">BETA</span>
      <div><strong>클레임센터 스튜디오는 현재 가오픈 운영 중입니다.</strong><p>외부 발송 전 확정 문서를 직접 열어 확인해 주세요. 오류가 보이면 입력을 유지한 채 관리자에게 알려주세요.</p></div>
      <Button size="sm" variant="secondary" onClick={() => setDetailOpen(true)}>이용 안내 보기</Button>
      <button type="button" className="soft-launch-dismiss" aria-label="가오픈 안내 배너 닫기" onClick={dismiss}>×</button>
    </aside>}
    {detailOpen && <div className="soft-launch-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailOpen(false); }}>
      <section className="soft-launch-dialog" role="dialog" aria-modal="true" aria-labelledby="soft-launch-title">
        <header><div><span>SOFT LAUNCH · MEMBER GUIDE</span><h2 id="soft-launch-title">가오픈 이용 안내</h2></div><button ref={closeButtonRef} type="button" aria-label="가오픈 이용 안내 닫기" onClick={() => setDetailOpen(false)}>×</button></header>
        <div className="soft-launch-dialog__grid">
          <article><span>01</span><div><h3>기본 업무 흐름</h3><p>프로젝트 의뢰 → 제안서·프로젝트 접수 → 착수회의·현장조사·물량산출 → 보고서 작성·검수 → 5단계 결재상신 → 지정 결재자 승인 → 승인본 확정·출력 순서로 이용합니다.</p></div></article>
          <article><span>02</span><div><h3>가져오기·최종 출력</h3><p>HWP·DOCX를 보고서에 적용한 뒤 문장·표·사진과 배치를 확인하고 저장 완료를 기다리세요. 앞 단계의 작성본 출력은 검수용입니다. 5단계 승인·확정 후 DOCX·HWP·PDF 최종본을 내려받으며, 외부 발송 전 실제 파일을 확인해 주세요.</p></div></article>
          <article><span>03</span><div><h3>임시복구·서버 저장</h3><p>‘이전 작업 복구’에서 필요한 자료를 선택합니다. 임시 복구본은 마지막 보관 후 7일간 유지하며 사이트 사용 중 만료본을 정리합니다. 서버 저장 완료와는 별도이며, 서버 저장본과 직접 보관한 파일은 이 정책으로 삭제하지 않습니다.</p></div></article>
          <article><span>04</span><div><h3>승인 이메일·도움말</h3><p>승인 이메일의 수신 담당자와 발송 상태를 확인하세요. 메일 서버 접수는 실제 받은함 도착·열람과 다릅니다. 제안서 메일 발송 준비는 별도 기능입니다. 왼쪽 아래 ‘계정·업무 도구’에서 업데이트·도움말·알림을 열 수 있고, 모바일은 메뉴를 먼저 엽니다.</p></div></article>
        </div>
        <footer><p>문제 신고 시 사용한 프로젝트명, 화면, 발생 시각과 캡처를 함께 전달해 주세요.</p><Button onClick={() => { dismiss(); setDetailOpen(false); }}>확인하고 시작하기</Button></footer>
      </section>
    </div>}
  </>;
};
