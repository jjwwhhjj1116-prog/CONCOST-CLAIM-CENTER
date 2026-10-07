import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './DocumentReviewWorkspace.css';

/** Only the read-only display is scaled; document metrics and editor hit testing stay unchanged. */
export function DocumentPreviewPane({ children, title = '출력 미리보기', width = 794 }: { children: ReactNode; title?: string; width?: number }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: 1, height: 1123 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const paper = paperRef.current;
    if (!viewport || !paper) return;
    const measure = () => {
      const next = { scale: Math.min(1, Math.max(0.15, (viewport.clientWidth - 24) / width)), height: paper.scrollHeight };
      setSize(current => current.scale === next.scale && current.height === next.height ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport); observer.observe(paper); measure();
    return () => observer.disconnect();
  }, [width]);
  return <aside className="document-preview-pane" aria-label={title}>
    <header><strong>{title}</strong><span>머리글·꼬리말 포함 · 화면 맞춤 {Math.round(size.scale * 100)}%</span></header>
    <div className="document-preview-pane__viewport" ref={viewportRef}>
      <div className="document-preview-pane__frame" style={{ width: width * size.scale, height: size.height * size.scale }}>
        <div className="document-preview-pane__paper" ref={paperRef} style={{ width, transform: `scale(${size.scale})` }}>{children}</div>
      </div>
    </div>
  </aside>;
}

/** Shared controls sit above this spread. Native zoom keeps both pages at the same layout scale. */
export interface DocumentReviewPagesHandle { goToSourcePage: (page: number) => boolean }
export const DocumentReviewPages = forwardRef<DocumentReviewPagesHandle, {
  children: ReactNode; previewContent?: ReactNode; width: number; sourcePageCount?: number;
  sourceNavigationKey?: string; sourcePageUrls?: readonly string[]; sourceNavigation?: ReactNode;
}>(function DocumentReviewPages({ children, previewContent, width, sourcePageCount = 0, sourceNavigationKey, sourcePageUrls, sourceNavigation }, ref) {
  const spreadRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState('fit');
  const [sourcePage, setSourcePage] = useState(1);
  const [navigationNotice, setNavigationNotice] = useState('');
  useLayoutEffect(() => { setSourcePage(1); setNavigationNotice(''); }, [sourcePageCount, sourceNavigationKey]);
  useLayoutEffect(() => {
    const spread = spreadRef.current;
    if (!spread || !previewContent) return;
    const measure = () => {
      const pane = spread.querySelector('.document-review-pages__side');
      if (pane) setFit(Math.min(1, Math.max(0.15, (pane.clientWidth - 40) / width)));
    };
    const observer = new ResizeObserver(measure); observer.observe(spread); measure();
    return () => observer.disconnect();
  }, [Boolean(previewContent), width]);
  const moveToSourcePage = (page: number) => {
    if (!previewContent || !Number.isSafeInteger(page) || page < 1 || page > sourcePageCount) return false;
    const panes = [...(spreadRef.current?.querySelectorAll<HTMLElement>('.document-review-pages__side') ?? [])];
    const targets = panes.map(pane => {
      const images = pane.querySelectorAll<HTMLImageElement>(pane.classList.contains('document-review-pages__output') ? '[data-export-page] img[data-report-source-page="true"]' : 'img[data-report-source-page="true"]');
      return images.length === sourcePageCount && (!sourcePageUrls || (sourcePageUrls.length === images.length && [...images].every((image, index) => image.getAttribute('src') === sourcePageUrls[index]))) ? images[page - 1] : null;
    });
    // Wait for both renderers; never guess a chapter or move only one pane.
    if (panes.length !== 2 || targets.some(target => !target || !target.complete || !target.naturalWidth || !target.naturalHeight)) {
      setNavigationNotice('쪽 미리보기를 준비 중입니다. 잠시 후 다시 이동해 주세요.');
      return false;
    }
    targets.forEach((target, index) => {
      const pane = panes[index];
      const top = pane.scrollTop + target!.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientTop - Number.parseFloat(getComputedStyle(pane).paddingTop || '0');
      pane.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    });
    setSourcePage(page);
    setNavigationNotice(`편집·출력 미리보기를 원본 ${page}쪽으로 이동했습니다.`);
    return true;
  };
  useImperativeHandle(ref, () => ({ goToSourcePage: moveToSourcePage }));
  if (!previewContent) return children;
  const scale = zoom === 'fit' ? fit : Number(zoom);
  return <div className="document-review-pages" ref={spreadRef} style={{ '--review-scale': scale, '--review-paper-width': `${width}px`, '--review-paper-height': `${width === 794 ? 1123 : 794}px` } as CSSProperties}>
    <div className="document-review-pages__heading"><strong>편집</strong><label>양쪽 배율 <select aria-label="편집 및 미리보기 배율" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">나란히 맞춤 ({Math.round(fit * 100)}%)</option><option value="1">100%</option><option value="0.75">75%</option></select></label><strong>출력 미리보기</strong></div>
    {sourcePageCount > 0 && <div className="document-review-pages__source-nav" role="group" aria-label="원형 페이지 탐색">
      <label>원형 보고서 쪽 이동 <select aria-label="원형 보고서 쪽 이동" value={sourcePage} onChange={event => moveToSourcePage(Number(event.target.value))}>{Array.from({ length: sourcePageCount }, (_, index) => <option key={index + 1} value={index + 1}>원본 {index + 1}쪽 / {sourcePageCount}쪽</option>)}</select></label>
      <button type="button" aria-label="선택한 원형 쪽으로 이동" onClick={() => moveToSourcePage(sourcePage)}>이동</button>
      <span role="status">{navigationNotice || '편집·출력 미리보기를 같은 원본 쪽으로 이동합니다.'}</span>
    </div>}
    {sourceNavigation}
    <div className="document-review-pages__spread">
      <div className="document-review-pages__side">{children}</div>
      <div className="document-review-pages__side document-review-pages__output" aria-label="출력 미리보기"><div className="document-review-pages__paper">{previewContent}</div></div>
    </div>
  </div>;
});
