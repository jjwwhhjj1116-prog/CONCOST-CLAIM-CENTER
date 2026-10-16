import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { paginateReport } from './report-pagination';
import { prepareReportPrint, reportContentsPages } from './report-print-structure';
import { importedHwpPages } from './hwp-import-overflow';
import { alignImportedHwpPages } from './hwp-import-alignment';

export function ReportBodyPages({ html, header, contents = false, tocTitle = '목 차', tocTitles }: { html: string; header?: ReactNode; contents?: boolean; tocTitle?: string; tocTitles?: Record<string,string> }): React.ReactElement {
  const sourceRef = useRef<HTMLElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const tocTitlesSignature = JSON.stringify(tocTitles ?? {});
  const [layout, setLayout] = useState({ pages: [''], toc: [] as string[], overflow: false, ready: false });
  useLayoutEffect(() => {
    const source = sourceRef.current?.querySelector<HTMLElement>('.structured-editor__preview');
    if (!source) return;
    source.innerHTML = html;
    const imported = Boolean(source.querySelector(':scope > [data-hwp-import-page]'));
    const headings = imported ? [] : prepareReportPrint(source);
    setLayout(current => ({ ...current, ready: false }));
    let active = true, frame = 0;
    const paginate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        alignImportedHwpPages(source);
        const importedPages = importedHwpPages(source);
        if (importedPages) {
          if (active) setLayout({...importedPages,toc:[],ready:document.fonts.status==='loaded'&&[...source.querySelectorAll('img')].every(image=>image.complete)});
          return;
        }
        const next = paginateReport(source, source.clientHeight);
        let toc = { pages: [] as string[], overflow: false };
        const tocSource = tocRef.current?.querySelector<HTMLElement>('.report-toc-content');
        if (contents && tocSource) {
          reportContentsPages(tocSource, next.pages, headings, tocTitles);
          toc = paginateReport(tocSource, tocSource.clientHeight);
        }
        if (active) setLayout({ ...next, toc: toc.pages, overflow: next.overflow || toc.overflow, ready: true });
      });
    };
    const images = [...source.querySelectorAll('img')];
    images.forEach(image => { image.addEventListener('load', paginate); image.addEventListener('error', paginate); });
    window.addEventListener('resize', paginate); window.addEventListener('final-document:refit', paginate);
    void document.fonts?.ready.then(paginate); paginate();
    return () => { active = false; cancelAnimationFrame(frame); window.removeEventListener('resize', paginate); window.removeEventListener('final-document:refit', paginate); images.forEach(image => { image.removeEventListener('load', paginate); image.removeEventListener('error', paginate); }); };
  }, [html, header, contents, tocTitle, tocTitlesSignature]);
  return <>
    <section ref={sourceRef} className="report-final-body report-pagination-source" aria-hidden="true">{header}<article className="structured-editor__preview" dangerouslySetInnerHTML={{ __html: html }}/></section>
    {contents && <section ref={tocRef} className="report-final-body report-final-toc report-pagination-source" aria-hidden="true"><h2>{tocTitle}</h2><article className="report-toc-content"/></section>}
    {layout.toc.map((page, index) => <section className="report-final-body report-final-toc report-paginated-sheet" key={`toc-${index}`} data-export-page data-export-page-policy="fit" data-page-fit-overflow={!layout.ready || layout.overflow} data-page-number={index + 2}>
      <h2>{index === 0 ? tocTitle : `${tocTitle} (계속)`}</h2><article className="report-toc-content" dangerouslySetInnerHTML={{ __html: page }}/><footer className="report-page-number">- 목차 {index + 1} -</footer>
    </section>)}
    {layout.overflow && <p className="error-box" role="alert">본문·표·사진이 쪽 밖으로 넘치거나 서로 겹치는지 확인해 주세요. 가져온 쪽 밖에 추가한 내용도 정리해야 합니다. 내용은 보존되며, 문제가 해결될 때까지 출력하지 않습니다.</p>}
    {layout.pages.map((page, index) => <section className={`report-final-body report-paginated-sheet${page.includes('data-report-source-page="true"') ? ' report-native-sheet' : ''}${page.includes('data-hwp-import-page')?' report-hwp-structured-sheet':''}`} key={index} data-export-page data-export-page-policy="fit" data-page-fit-overflow={!layout.ready || layout.overflow} data-page-number={index + layout.toc.length + 2} data-report-body-page={index + 1}>
      {header}<article className="structured-editor__preview" dangerouslySetInnerHTML={{ __html: page }}/>
      {!page.includes('data-report-source-page="true"') && !page.includes('data-hwp-import-page') && <footer className="report-page-number">- {index + 1} -</footer>}
    </section>)}
  </>;
}
