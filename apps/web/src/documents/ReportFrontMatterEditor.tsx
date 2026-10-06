import { useMemo } from 'react';
import { Button } from '@claim-studio/ui';
import type { ReportFrontMatter } from '../../../../packages/document-engine/src/report-presentation';
import { prepareReportPrint } from './report-print-structure';

export function ReportFrontMatterEditor({ title, caseTitle, html, value, disabled, onTitle, onChange, onEditNative }: {
  title: string; caseTitle: string; html: string; value: ReportFrontMatter; disabled: boolean;
  onTitle: (title: string) => void; onChange: (next: ReportFrontMatter) => void;
  onEditNative?: () => void;
}) {
  const headings = useMemo(() => {
    const source = document.createElement('div'); source.innerHTML = html;
    return prepareReportPrint(source);
  }, [html]);
  if (!value.enabled) return onEditNative ? <section className="notice-box" aria-label="원형 HWP 표지·목차 편집">
    <strong>원형 HWP 표지·목차 편집</strong>
    <p>가져온 HWP의 페이지 모양을 유지하도록 자동 표지·목차를 추가하지 않습니다. 원본에 있는 표지·목차와 문장·표·사진은 HWP 편집기에서 수정하고, “수정 원본 보존·전체 페이지 적용”을 눌러 보고서에 반영하세요. 다운로드만으로는 보고서가 갱신되지 않습니다.</p>
    <Button type="button" variant="secondary" disabled={disabled} onClick={onEditNative}>표지·목차·표를 HWP 편집기에서 수정</Button>
  </section> : null;
  return <div className="report-frontmatter-edit report-final-document">
    <section className="report-frontmatter-cover" aria-label="표지 편집">
      <div className="report-cover-heading">
        <textarea aria-label="표지 제목 편집" value={title} maxLength={300} disabled={disabled} onChange={event => onTitle(event.target.value)} rows={4}/>
        <textarea aria-label="표지 부제 편집" value={value.subtitle ?? (caseTitle === title ? '' : caseTitle)} maxLength={1000} disabled={disabled} onChange={event => onChange({ ...value, subtitle: event.target.value })} rows={3}/>
      </div>
      <div className="report-cover-signature">
        <input aria-label="표지 작성일 편집" value={value.date} placeholder="작성일" maxLength={80} disabled={disabled} onChange={event => onChange({ ...value, date: event.target.value })}/>
        <input aria-label="표지 작성자 편집" value={value.author} placeholder="작성자·기관" maxLength={200} disabled={disabled} onChange={event => onChange({ ...value, author: event.target.value })}/>
      </div>
    </section>
    <section className="report-frontmatter-toc" aria-label="목차 편집">
      <input className="report-toc-title-input" aria-label="목차 표제 편집" value={value.tocTitle ?? '목 차'} maxLength={200} disabled={disabled} onChange={event => onChange({ ...value, tocTitle: event.target.value })}/>
      <p className="report-frontmatter-help">목차 문구를 직접 수정할 수 있습니다. 항목은 본문 제목에서 생성되고 쪽수는 출력 시 자동 계산됩니다. 본문 제목을 변경하면 해당 목차 문구를 다시 확인해 주세요.</p>
      {headings.map(heading => <div key={heading.key} className={`report-toc-entry report-toc-level-${heading.level}`}>
        <textarea aria-label={`목차 항목 ${heading.title}`} rows={2} value={value.tocTitles?.[heading.key] ?? heading.title} maxLength={1000} disabled={disabled} onChange={event => onChange({ ...value, tocTitles: { ...value.tocTitles, [heading.key]: event.target.value } })}/>
        <span className="report-toc-leader"/><span className="report-toc-page">자동</span>
      </div>)}
      <button type="button" disabled={disabled || !Object.keys(value.tocTitles ?? {}).length} onClick={() => onChange({ ...value, tocTitles: {} })}>목차 문구를 본문 제목으로 되돌리기</button>
    </section>
  </div>;
}
