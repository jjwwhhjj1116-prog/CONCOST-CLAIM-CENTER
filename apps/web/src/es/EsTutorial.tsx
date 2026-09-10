import { useRef, useEffect } from 'react';

export const ES_TUTORIAL = [
  { title:'공사정보와 기준일을 확인하세요', checks:['기존 Excel이 있으면 가져오기 → 내용 확인 → 적용 순서로 시작하세요. 새 산출서는 노란 입력칸부터 작성합니다.', '입찰 기준일·조정기준일, 총계약금액(원), 계약기간·공종·등급을 확인하세요. 프로젝트 연결은 선택입니다.', '날짜를 바꾸면 이력에서 자료를 다시 선택합니다. ES 요율정보 가져오기로 공식 자료를 조회하고 출처·조건을 확인해 적용하세요.'] },
  { title:'계약내역의 비목 금액을 맞추세요', checks:['28개 비목별 금액을 원가내역과 대조하세요. 총계약금액과 비목 합계는 같은 값이라고 가정하지 않습니다.', '해당 없는 비목은 0, 아직 확인하지 못한 금액은 빈 값으로 구분하세요.', '적용대가에서 제외할 기성·선금은 다음 단계에서 확인합니다.'] },
  { title:'기준·현재·직전의 자료와 출처를 확인하세요', checks:['노임·재료지수·보험요율이 각 기준일에 맞는지 비교하세요. 조회값은 적용 전 확인창에서 검토합니다.', '기계경비와 표준시장단가 5개 공종의 공통품목 수·기준 평균·비교 평균·출처를 확인하세요.', '자동 미매칭은 0이 아닙니다. 공식 원문을 확인해 수동 입력하거나 Excel에서 가져오세요.'] },
  { title:'기성·직접지급·선금의 중복 공제를 확인하세요', checks:['기성 제외액, 직접지급 내역, 이미 제외한 직접지급액을 계약자료와 대조하세요.', '선금 대상금액·지급액·직전 기성과 기타 공제액을 확인하세요. 해당하지 않으면 0을 입력합니다.', '복수 선금·후속 차수 등 미지원 계약은 현재 결과를 제출하지 마세요.'] },
  { title:'계산 근거와 부족한 입력을 검토하세요', checks:['빨간 오류가 있으면 안내된 원자료를 보완하세요. 빈 값을 임의로 0으로 바꾸지 않습니다.', '현재·직전을 전환하고 비목별 금액·계수·기준/비교지수·등락비를 확인하세요.', '적용대가·선금 공제·최종 조정금액을 확인한 뒤 저장·계산하세요. 현재 결과는 검토용 초안입니다.'] },
  { title:'출력 범위와 인쇄 문구를 확정하세요', checks:['출력할 시트를 선택하고 머리글·바닥글을 원본 유지, 직접 편집·반복, 숨김 중 선택하세요. 변경 후 저장·계산합니다.', 'A4 미리보기에서 글자·표·쪽 나눔을 확인하고 페이지 범위를 입력한 뒤 페이지 확인을 누르세요.', '프린터 인쇄 / PDF 저장을 누릅니다. 브라우저 인쇄창은 A4·100%·여백 없음·브라우저 머리글/바닥글 해제입니다. Excel은 전체/선택 시트로 내보냅니다.'] }
] as const;

export function EsTutorial({ step, onStep, onClose }: { step:number; onStep:(step:number)=>void; onClose:()=>void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll:true }); }, [step]);
  return <aside className="es-tutorial" aria-label="ES 단계별 사용 안내">
    <div className="es-tutorial-heading"><h2 ref={heading} tabIndex={-1}>사용 안내 {step + 1} / 6 · {ES_TUTORIAL[step].title}</h2><button onClick={onClose}>안내 닫기</button></div>
    <ul>{ES_TUTORIAL[step].checks.map(text => <li key={text}>{text}</li>)}</ul>
    <div className="es-actions"><button disabled={step === 0} onClick={() => onStep(step - 1)}>이전 안내</button><button className="es-primary" onClick={() => step === 5 ? onClose() : onStep(step + 1)}>{step === 5 ? '안내 마치기' : '다음 단계로 →'}</button><small>안내 이동은 입력·저장·자동조회를 실행하지 않습니다.</small></div>
  </aside>;
}
