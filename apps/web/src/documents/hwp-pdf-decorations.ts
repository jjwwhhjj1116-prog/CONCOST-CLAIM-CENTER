// html2canvas does not understand calc() in background size/position and drops
// SVG images smaller than one pixel. Adapt only its disposable HWP page clone.
export function prepareHwpPdfDecorations(root:HTMLElement):void {
 const length=(token:string,basis:number)=>{
  const pixels=token.match(/^(-?[\d.]+)px$/u),percent=token.match(/^(-?[\d.]+)%$/u),calc=token.match(/^calc\(\s*(-?[\d.]+)%\s*([+-])\s*(-?[\d.]+)px\s*\)$/u);
  const value=pixels?Number(pixels[1]):percent?Number(percent[1])*basis/100:calc?Number(calc[1])*basis/100+(calc[2]==='-'?-1:1)*Number(calc[3]):NaN;
  if(!Number.isFinite(value))throw Error('HWP 복합 테두리의 PDF 위치를 확인하지 못했습니다.');
  return value;
 };
 const pair=(value:string)=>{
  const tokens=value.match(/calc\([^()]+\)|-?[\d.]+(?:px|%)/gu);
  if(tokens?.length!==2)throw Error('HWP 복합 테두리의 PDF 크기를 확인하지 못했습니다.');
  return tokens;
 };
 for(const cell of root.querySelectorAll<HTMLElement>('.hwp-import-page :is(td,th)[style*="--hwp-cell-border-image"]')){
  // At onclone, html2canvas has already replaced ::before with this real
  // element and hidden the CSS pseudo. Correct its copied paint properties.
  const paint=cell.querySelector<HTMLElement>(':scope>html2canvaspseudoelement');
  if(!paint)throw Error('HWP 복합 테두리의 PDF 복제 영역이 없습니다.');
  const css=cell.ownerDocument.defaultView!.getComputedStyle(paint),width=length(css.width,0),height=length(css.height,0);
  if(width<=0||height<=0)throw Error('HWP 복합 테두리의 PDF 영역이 없습니다.');
  const sizes=css.backgroundSize.split(',').map(value=>pair(value).map((token,i)=>length(token,i?height:width)));
  const positions=css.backgroundPosition.split(',').map((value,index)=>pair(value).map((token,i)=>length(token,(i?height:width)-(sizes[index]?.[i]??NaN))));
  if(sizes.length!==positions.length||sizes.some(size=>size.some(value=>value<=0)))throw Error('HWP 복합 테두리의 PDF 선 대응이 다릅니다.');
  paint.style.backgroundSize=sizes.map(size=>size.map(value=>`${value}px`).join(' ')).join(',');
  paint.style.backgroundPosition=positions.map(position=>position.map(value=>`${value}px`).join(' ')).join(',');
 }
 for(const svg of root.querySelectorAll<SVGSVGElement>('[data-hwp-import-rule][data-hwp-rule-nativevector="1"]>svg')){
  const box=svg.viewBox.baseVal,css=svg.ownerDocument.defaultView!.getComputedStyle(svg),rect=svg.getBoundingClientRect();
  const scaleX=rect.width/length(css.width,0),scaleY=rect.height/length(css.height,0);
  if(!Number.isFinite(scaleX)||!Number.isFinite(scaleY)||scaleX<=0||scaleY<=0)throw Error('HWP 선의 PDF 배율을 확인하지 못했습니다.');
  // The image converter uses transformed bounds, so a fit-to-screen ancestor
  // can reduce a 1px viewport below one pixel again. Leave two image pixels of
  // viewport, while retaining the original line coordinates and stroke width.
  const width=Math.max(2/scaleX,box.width),height=Math.max(2/scaleY,box.height);
  svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));
  svg.style.width=`${width}px`;svg.style.height=`${height}px`;
  svg.setAttribute('viewBox',`${box.x} ${box.y} ${width} ${height}`);
 }
}
