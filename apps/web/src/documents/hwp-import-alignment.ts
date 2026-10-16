import { normalizeHwpLayout } from './hwp-import-nodes';

const layoutOf=(element:HTMLElement)=>{
  try{return normalizeHwpLayout(JSON.parse(element.getAttribute('data-hwp-layout')||'null'));}catch{return null;}
};

/** Keep native em-box/grid coordinates separate from CSS leading and collapsed borders.
 * Re-measure at the current zoom; device-pixel border rounding must not be saved as geometry.
 * Only presentation styles change. Authored text, image sizes and table columns stay in JSON.
 */
export function alignImportedHwpPages(source:HTMLElement):void {
  for(const page of source.querySelectorAll<HTMLElement>('[data-hwp-import-page]')){
    const paper=page.getBoundingClientRect(),scale=paper.width/Number(page.getAttribute('data-hwp-width'));
    if(!(scale>0))continue;
    for(const table of page.querySelectorAll<HTMLTableElement>('table')){
      const first=table.rows[0]?.cells[0],origin=layoutOf(table);
      if(!first||origin?.nativeGrid!==1)continue;
      // CSS owns the cell inset. Mutating content-DOM cell styles would make
      // ProseMirror restore them while processing a later edit/selection.
      table.style.setProperty('--hwp-device-pixel',`${1/(scale*window.devicePixelRatio)}px`);
      table.style.transform='';
      const actual=first!.getBoundingClientRect(),outer=table.getBoundingClientRect();
      table.style.transform=`translate(${(outer.left-actual.left)/scale}px,${(outer.top-actual.top)/scale}px)`;
    }
  }
}

/** Import-time calibration only. Persist local offsets, never re-anchor edited text
 * to original page coordinates after Enter, alignment, photo or table changes. */
export function measureImportedHwpOffsets(source:HTMLElement):Array<{left:number;top:number}|null>{
  const offsets:Array<{left:number;top:number}|null>=[];
  for(const page of source.querySelectorAll<HTMLElement>('[data-hwp-import-page]')){
    const paper=page.getBoundingClientRect(),scale=paper.width/Number(page.getAttribute('data-hwp-width'));
    for(const paragraph of page.querySelectorAll<HTMLElement>('p')){
      const origin=layoutOf(paragraph);
      if(typeof origin?.nativeBaseline!=='number'){offsets.push(null);continue;}
      const walker=source.ownerDocument.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);
      let text:Text|null=null,offset=0;
      while(walker.nextNode()){
        const candidate=walker.currentNode as Text,index=candidate.data.search(/[^\s\u200b]/u);
        if(index>=0&&candidate.parentElement?.closest('[data-hwp-text-style]')){text=candidate;offset=index;break;}
      }
      if(!text){offsets.push(null);continue;}
      const probe=source.ownerDocument.createElement('span');
      probe.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
      text.parentElement!.insertBefore(probe,text);
      const baseline=(probe.getBoundingClientRect().top-paper.top)/scale;
      probe.remove();
      const range=source.ownerDocument.createRange();range.setStart(text,offset);range.setEnd(text,offset+1);
      const rect=range.getClientRects()[0];
      offsets.push({top:origin.nativeBaseline-baseline,left:rect&&typeof origin.nativeX==='number'?origin.nativeX-(rect.left-paper.left)/scale:0});
    }
  }
  return offsets;
}
