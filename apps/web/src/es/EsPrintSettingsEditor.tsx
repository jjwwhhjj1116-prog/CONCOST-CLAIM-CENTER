import { newEsPrintSettings, type EsPrintSettings } from '../../../../packages/document-engine/src/es-print-settings';

export function EsPrintSettingsEditor({ value, onChange }: { value?:EsPrintSettings; onChange:(value:EsPrintSettings | undefined)=>void }) {
  const settings = value ?? newEsPrintSettings();
  return <details className="es-print-edit" open><summary>머리글·바닥글 편집</summary>
    <p>직접 편집한 문구는 모든 페이지의 같은 위치에 반복됩니다. 원본 본문의 공사명·붙임 제목·검토 주의문은 유지합니다.</p>
    <div className="es-print-band-grid">{(['header','footer'] as const).map(key => {
      const band = settings[key], label = key === 'header' ? '머리글' : '바닥글';
      const update = (patch: Partial<typeof band>) => onChange({...settings, [key]:{...band,...patch}});
      return <fieldset key={key}><legend>{label}</legend>
        <label className="es-field">{label} 표시 방식<select value={band.mode} onChange={e => update({mode:e.target.value as typeof band.mode})}><option value="original">원본 유지</option><option value="custom">직접 편집 · 모든 페이지에 고정</option><option value="hidden">숨김</option></select></label>
        {band.mode === 'custom' && <><label className="es-field">{label} 문구<input maxLength={80} value={band.text} onChange={e => update({text:e.target.value})} placeholder={key === 'header' ? '예: 공사명 또는 회사명' : '예: 검토용 산출서 · {page} / {pages}'} /></label><div className="es-actions"><label className="es-field">{label} 정렬<select value={band.align} onChange={e => update({align:e.target.value as typeof band.align})}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label><button disabled={band.text.length > 61} onClick={() => update({text:band.text + ' {page} / {pages}'})}>쪽번호 넣기</button><button onClick={() => update({text:''})}>문구 지우기</button></div><small>{band.text.length} / 80자 · {'{page}'} 현재 쪽, {'{pages}'} 전체 쪽</small></>}
      </fieldset>;
    })}</div><div className="es-actions"><button disabled={!value} onClick={() => onChange(undefined)}>원본 설정으로 되돌리기</button><small>변경 후 저장·계산하면 미리보기와 Excel에 적용됩니다. Excel 쪽번호는 시트별로 계산됩니다.</small></div>
    <p className="es-field-help">브라우저가 추가하는 URL·날짜는 인쇄창의 ‘머리글 및 바닥글’에서 별도로 해제하세요.</p>
  </details>;
}
