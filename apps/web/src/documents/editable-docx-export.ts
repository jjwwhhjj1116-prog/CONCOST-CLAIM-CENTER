import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, ImageRun, LeaderType, LineRuleType, Packer, PageOrientation, Paragraph, ShadingType, Tab, Table, TableCell, TableLayoutType, TableRow, TabStopType, TextRun, VerticalAlign, WidthType } from 'docx';
import {strFromU8,strToU8,unzipSync,zipSync} from 'fflate';

type Block = Paragraph | Table;
type Run = TextRun | ImageRun | ExternalHyperlink;
const px = (value: string): number => Number.parseFloat(value) || 0;
const twips = (value: number): number => Math.max(0, Math.round(value * 15));
const style = (node: Element): CSSStyleDeclaration => node.ownerDocument.defaultView!.getComputedStyle(node);
const color = (value: string): string | undefined => {
  const match = value.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)/u);
  if (match) return match[4] === '0' ? undefined : match.slice(1, 4).map(part => Number(part).toString(16).padStart(2, '0')).join('');
  return /^#[a-f\d]{6}$/iu.test(value) ? value.slice(1) : undefined;
};
const ignored = (node: Element): boolean => {
  if (node.matches('script,style,button,input,select,textarea,[hidden],[aria-hidden="true"],[data-export-ignore],[data-html2canvas-ignore],.document-tool-menus,.structured-editor__toolbar')) return true;
  const css = style(node);
  return css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse';
};
const alignment = (value: string) => value === 'center' ? AlignmentType.CENTER : ['right', 'end'].includes(value) ? AlignmentType.RIGHT : value === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;
export function documentBlockImageAlignment(image: HTMLImageElement): 'left' | 'center' | 'right' | undefined {
  const css=style(image);
  if(css.display!=='block')return undefined;
  const authored=image.getAttribute('data-image-align'),left=css.marginLeft,right=css.marginRight;
  if(authored&&['left','center','right'].includes(authored))return authored as 'left' | 'center' | 'right';
  if(left==='auto'&&right==='auto'||px(left)>0&&px(right)>0&&Math.abs(px(left)-px(right))<.5)return 'center';
  if((left==='auto'||px(left)>0)&&right!=='auto'&&px(right)===0)return 'right';
  if(left!=='auto'&&px(left)===0&&(right==='auto'||px(right)>0))return 'left';
  return undefined;
}
const border = (css: CSSStyleDeclaration, side: 'Top' | 'Right' | 'Bottom' | 'Left') => {
  const width = px(css[`border${side}Width`]);
  return { style: !width || css[`border${side}Style`] === 'none' ? BorderStyle.NONE : css[`border${side}Style`] === 'dashed' ? BorderStyle.DASHED : css[`border${side}Style`] === 'dotted' ? BorderStyle.DOTTED : BorderStyle.SINGLE, size: Math.max(1, Math.round(width * 6)), color: color(css[`border${side}Color`]) ?? '000000' };
};

export async function documentImageData(image: HTMLImageElement): Promise<{bytes:Uint8Array;type:'png'|'jpg'|'gif'|'bmp';width:number;height:number}> {
  const src = image.currentSrc || image.src;
  if (!src) throw new Error('DOCX에 넣을 이미지 주소가 없습니다.');
  let bytes: Uint8Array;
  try {
    const response = await fetch(src, { credentials: 'same-origin', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(String(response.status));
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch { throw new Error(`DOCX 이미지를 읽지 못했습니다: ${image.alt || '첨부 이미지'}`); }
  let type: 'png' | 'jpg' | 'gif' | 'bmp' | null = bytes[0] === 137 && bytes[1] === 80 ? 'png' : bytes[0] === 255 && bytes[1] === 216 ? 'jpg' : bytes[0] === 71 && bytes[1] === 73 ? 'gif' : bytes[0] === 66 && bytes[1] === 77 ? 'bmp' : null;
  try { await image.decode(); } catch { throw new Error(`DOCX 이미지가 손상되었습니다: ${image.alt || '첨부 이미지'}`); }
  const css = style(image);
  const width = image.offsetWidth || px(css.width) || image.naturalWidth;
  const height = image.offsetHeight || px(css.height) || image.naturalHeight;
  if (!width || !height) throw new Error('DOCX 이미지 크기를 확인하지 못했습니다.');
  const fitScale=Math.min(width/image.naturalWidth,height/image.naturalHeight,...(css.objectFit==='scale-down'?[1]:[]));
  const fitted = ['contain', 'scale-down'].includes(css.objectFit) && (Math.abs(width-image.naturalWidth*fitScale)>.01 || Math.abs(height-image.naturalHeight*fitScale)>.01);
  if (!type || fitted) {
    // Word does not reliably display SVG/WebP across versions. Convert only the
    // individual image; all surrounding text and tables remain native/editable.
    // Preserve the CSS photo box, including empty side/top space. Exporting
    // the source bitmap at the box dimensions would stretch portrait evidence.
    const density = fitted ? Math.max(2,1/fitScale) : 1;
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round((fitted?width:image.naturalWidth)*density));canvas.height=Math.max(1,Math.round((fitted?height:image.naturalHeight)*density));
    if(canvas.width*canvas.height>36_000_000)throw new Error('DOCX 첨부 이미지가 너무 큽니다. 6000px 이하 이미지로 조정하세요.');
    try{
      const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable');
      if(fitted){
        const drawWidth=image.naturalWidth*fitScale,drawHeight=image.naturalHeight*fitScale;
        const position=css.objectPosition.split(/\s+/u);
        const offset=(value:string,space:number)=>{
          if(/^-?[\d.]+%$/u.test(value))return space*parseFloat(value)/100;
          if(/^-?[\d.]+px$/u.test(value))return parseFloat(value);
          throw new Error('지원하지 않는 사진 정렬입니다. 가운데 정렬 후 다시 출력해 주세요.');
        };
        context.drawImage(image,offset(position[0],width-drawWidth)*density,offset(position[1]??'50%',height-drawHeight)*density,drawWidth*density,drawHeight*density);
      }else context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Image conversion failed')),'image/png'));
      bytes=new Uint8Array(await blob.arrayBuffer());type='png';
    }catch{throw new Error(`DOCX 첨부 이미지 변환에 실패했습니다: ${image.alt || '첨부 이미지'}`);}
    finally{canvas.width=1;canvas.height=1;}
  }
  return {bytes,type,width,height};
}

async function imageRun(image: HTMLImageElement): Promise<ImageRun> {
  const {bytes,type,width,height}=await documentImageData(image);
  return new ImageRun({ type, data: bytes, transformation: { width, height }, altText: { title: image.title || image.alt, description: image.alt, name: image.alt || '첨부 이미지' } });
}

async function runs(nodes: readonly Node[], inherited: Element): Promise<Run[]> {
  const result: Run[] = [];
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const css = style(inherited);
      const text = css.whiteSpace.startsWith('pre') ? node.textContent || '' : (node.textContent || '').replace(/\s+/gu, ' ');
      if (!text) continue;
      const font = css.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/gu, '');
      result.push(new TextRun({ text, font, size: Math.max(1, Math.round((px(css.fontSize) || 16) * 1.5)), bold: Number(css.fontWeight) >= 600 || css.fontWeight === 'bold', italics: css.fontStyle === 'italic', color: color(css.color), underline: css.textDecorationLine.includes('underline') ? {} : undefined, strike: css.textDecorationLine.includes('line-through'), subScript: css.verticalAlign === 'sub', superScript: css.verticalAlign === 'super' }));
    } else if (node instanceof Element && !ignored(node)) {
      if (node instanceof HTMLImageElement) result.push(await imageRun(node));
      else if (node.tagName === 'BR') result.push(new TextRun({ break: 1 }));
      else if (node instanceof HTMLAnchorElement && node.getAttribute('href')) {
        const children = await runs([...node.childNodes], node);
        let link: URL | undefined;
        try { const candidate = new URL(node.getAttribute('href')!, node.ownerDocument.baseURI); if (['http:', 'https:'].includes(candidate.protocol) && !candidate.username && !candidate.password) link = candidate; } catch { /* Invalid links keep their visible text. */ }
        result.push(...(link ? [new ExternalHyperlink({ children, link: link.href })] : children));
      } else result.push(...await runs([...node.childNodes], node));
    }
  }
  return result;
}

async function paragraph(nodes: readonly Node[], element: Element, marker = '', spacing?: {before:number;after:number}): Promise<Paragraph> {
  const css = style(element);
  const children = await runs(nodes, element);
  const containsImage = children.some(child => child instanceof ImageRun) || nodes.some(node => node instanceof Element && !ignored(node) && [...node.querySelectorAll('img')].some(image => !ignored(image)));
  if (marker) children.unshift(new TextRun(marker));
  const heading = /^H[1-6]$/u.test(element.tagName);
  // Direct cell text already gets this padding from tcMar. A nested authored
  // paragraph still retains its own independent indentation.
  const cellText=element.matches('td,th');
  let paragraphAlignment=alignment(css.textAlign);
  const visibleNodes=nodes.filter(node=>node instanceof Element?!ignored(node):Boolean(node.textContent?.trim()));
  const onlyImage=!marker&&visibleNodes.length===1&&visibleNodes[0] instanceof HTMLImageElement?visibleNodes[0]:null;
  if(onlyImage&&style(onlyImage).display==='block'){
    const imageAlignment=documentBlockImageAlignment(onlyImage);
    if(imageAlignment)paragraphAlignment=alignment(imageAlignment);
  }
  // CSS line-height is an absolute length here, not Word's 240ths-of-a-line.
  // Inline photographs must still be allowed to grow their line box.
  return new Paragraph({ children, outlineLevel: heading && !element.closest('.report-final-cover') ? Number(element.tagName[1]) - 1 : undefined, alignment: paragraphAlignment, spacing: { before: twips(spacing?.before??px(css.marginTop)), after: twips(spacing?.after??px(css.marginBottom)), ...(px(css.lineHeight) ? { line: twips(px(css.lineHeight)), lineRule: containsImage ? LineRuleType.AT_LEAST : LineRuleType.EXACT } : {}) }, indent: { left: cellText?0:twips(px(css.paddingLeft)), right: cellText?0:twips(px(css.paddingRight)) }, keepNext: heading });
}

async function table(element: HTMLTableElement): Promise<Table> {
  const css = style(element);
  const rows: TableRow[] = [];
  for (const row of [...element.rows]) {
    if (ignored(row)) continue;
    const cells: TableCell[] = [];
    for (const cell of [...row.cells]) {
      if (ignored(cell)) continue;
      const cellStyle = style(cell);
      const children = await blocks(cell);
      if (!children.length || children[children.length - 1] instanceof Table) children.push(new Paragraph(''));
      cells.push(new TableCell({ children, columnSpan: cell.colSpan, rowSpan: cell.rowSpan === 0 ? element.rows.length - row.rowIndex : cell.rowSpan, width: { size: twips(cell.offsetWidth || px(cellStyle.width)), type: WidthType.DXA }, verticalAlign: cellStyle.verticalAlign === 'middle' ? VerticalAlign.CENTER : cellStyle.verticalAlign === 'bottom' ? VerticalAlign.BOTTOM : VerticalAlign.TOP, shading: color(cellStyle.backgroundColor) ? { type: ShadingType.CLEAR, fill: color(cellStyle.backgroundColor) } : undefined, borders: { top: border(cellStyle, 'Top'), right: border(cellStyle, 'Right'), bottom: border(cellStyle, 'Bottom'), left: border(cellStyle, 'Left') }, margins: { top: twips(px(cellStyle.paddingTop)), right: twips(px(cellStyle.paddingRight)), bottom: twips(px(cellStyle.paddingBottom)), left: twips(px(cellStyle.paddingLeft)) } }));
    }
    if (cells.length) rows.push(new TableRow({ children: cells, tableHeader: row.parentElement?.tagName === 'THEAD', cantSplit: true }));
  }
  if (!rows.length) throw new Error('DOCX 표에 표시할 행이 없습니다.');
  return new Table({ rows, layout: TableLayoutType.FIXED, width: { size: twips(element.offsetWidth || px(css.width)), type: WidthType.DXA }, alignment: alignment(css.textAlign) === AlignmentType.JUSTIFIED ? AlignmentType.LEFT : alignment(css.textAlign) as typeof AlignmentType.LEFT | typeof AlignmentType.CENTER | typeof AlignmentType.RIGHT });
}

export function listMarker(item: Element): string {
  const kind=style(item).listStyleType;
  if(kind==='none')return '';
  if(kind==='disc'||kind==='circle'||kind==='square')return `${kind==='circle'?'◦':kind==='square'?'▪':'•'} `;
  const list=item.parentElement;
  const siblings=list?[...list.children].filter(child=>child.tagName==='LI'):[];
  const direction=list?.hasAttribute('reversed')?-1:1;
  let ordinal=Number(list?.getAttribute('start')??(direction<0?siblings.length:1));
  for(const sibling of siblings){
    if(sibling.hasAttribute('value'))ordinal=Number(sibling.getAttribute('value'));
    if(sibling===item)break;
    ordinal+=direction;
  }
  let label=String(ordinal);
  if(kind==='decimal-leading-zero'&&ordinal>=0&&ordinal<10)label=label.padStart(2,'0');
  else if(/^(upper|lower)-(alpha|latin)$/u.test(kind)&&ordinal>0){
    label='';for(let remaining=ordinal;remaining>0;remaining=Math.floor((remaining-1)/26))label=String.fromCharCode(65+(remaining-1)%26)+label;
    if(kind.startsWith('lower'))label=label.toLowerCase();
  }else if(/^(upper|lower)-roman$/u.test(kind)&&ordinal>0&&ordinal<4000){
    label='';let remaining=ordinal;
    for(const [value,letters] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']] as const){while(remaining>=value){label+=letters;remaining-=value;}}
    if(kind.startsWith('lower'))label=label.toLowerCase();
  }else if(!['decimal','decimal-leading-zero','upper-alpha','lower-alpha','upper-latin','lower-latin','upper-roman','lower-roman'].includes(kind))throw new Error(`DOCX에서 지원하지 않는 목록 번호 형식입니다: ${kind}. 번호를 본문 텍스트로 지정해 주세요.`);
  return `${label}. `;
}

async function blocks(parent: Element): Promise<Block[]> {
  const result: Block[] = [];
  let inline: Node[] = [];
  const flush = async () => { if (inline.some(node => node instanceof Element || node.textContent?.trim())) result.push(await paragraph(inline, parent)); inline = []; };
  for (const node of [...parent.childNodes]) {
    if (!(node instanceof Element)) { inline.push(node); continue; }
    if (ignored(node) || node.matches('.report-page-number')) continue;
    if (node.matches('.proposal-final-toc li')) {
      await flush();
      const number=node.querySelector(':scope > b'),title=node.querySelector(':scope > span'),pageNumber=node.querySelector(':scope > i');
      if(!number||!title||!pageNumber)throw new Error('DOCX 제안서 목차의 번호, 제목 또는 쪽번호가 없습니다.');
      const css=style(node),columns=css.gridTemplateColumns.split(' '),gap=px(css.columnGap);
      result.push(new Paragraph({children:[...await runs([...number.childNodes],number),new TextRun({children:[new Tab()]}),...await runs([...title.childNodes],title),new TextRun({children:[new Tab()]}),...await runs([...pageNumber.childNodes],pageNumber)],tabStops:[{type:TabStopType.LEFT,position:twips(px(columns[0])+gap)},{type:TabStopType.RIGHT,position:twips((node as HTMLElement).clientWidth-px(css.paddingLeft)-px(css.paddingRight))}],indent:{left:twips(px(css.paddingLeft))},spacing:{before:twips(px(css.paddingTop)+px(css.marginTop)),after:twips(px(css.paddingBottom)+px(css.marginBottom))}}));
      continue;
    }
    if(node.matches('.report-toc-entry')){
      await flush();
      const title=node.firstElementChild,pageNumber=node.querySelector('.report-toc-page'),css=style(node);
      if(!title||!pageNumber)throw new Error('DOCX 목차의 제목 또는 쪽번호가 없습니다.');
      // The flow-root TOC does not collapse its first margin with the title.
      // Word collapses adjacent paragraph spacing, so carry that boundary here.
      const tocTitle=parent.matches('.report-toc-content')&&node===parent.firstElementChild?parent.previousElementSibling:null;
      const before=px(css.marginTop)+(tocTitle?px(style(tocTitle).marginBottom):0);
      result.push(new Paragraph({children:[...await runs([...title.childNodes],title),new TextRun({children:[new Tab()]}),...await runs([...pageNumber.childNodes],pageNumber)],tabStops:[{type:TabStopType.RIGHT,position:twips((node as HTMLElement).clientWidth-px(css.paddingRight)),leader:LeaderType.DOT}],indent:{left:twips(px(css.paddingLeft))},spacing:{before:twips(before),after:twips(px(css.marginBottom)),...(px(css.lineHeight)?{line:twips(px(css.lineHeight)),lineRule:LineRuleType.EXACT}:{})}}));
      continue;
    }
    if (node instanceof HTMLTableElement) { await flush(); result.push(await table(node)); continue; }
    const css = style(node);
    // A block photograph has its own margins; using the TD paragraph loses them
    // and applies the cell padding twice (cell margins plus paragraph indent).
    if (node instanceof HTMLImageElement && css.display === 'block') { await flush(); result.push(await paragraph([node], node)); continue; }
    if (['inline', 'inline-block', 'inline-flex'].includes(css.display) || node.tagName === 'BR' || node instanceof HTMLImageElement) { inline.push(node); continue; }
    await flush();
    if (/^(P|H[1-6]|PRE|FIGCAPTION)$/u.test(node.tagName)) result.push(await paragraph([...node.childNodes], node));
    else if (node.tagName === 'LI') {
      const own = [...node.childNodes].filter(child => !(child instanceof Element && ['OL','UL'].includes(child.tagName)));
      result.push(await paragraph(own, node, listMarker(node)));
      for (const nested of [...node.children].filter(child => ['OL','UL'].includes(child.tagName))) result.push(...await blocks(nested));
    } else result.push(...await blocks(node));
  }
  await flush();
  return result;
}

/** Native paragraphs, tables and individual images; never a rasterized page. */
export async function createEditableDocx(root: HTMLElement, orientation: 'portrait' | 'landscape', onProgress?: (message: string) => void): Promise<Uint8Array> {
  await root.ownerDocument.fonts?.ready;
  const candidates = root.matches('[data-export-page]') ? [root] : [...root.querySelectorAll<HTMLElement>('[data-export-page]')];
  const pages = candidates.filter(page => !ignored(page) && !page.parentElement?.closest('[data-export-page]'));
  if (!pages.length) throw new Error('편집 가능한 DOCX로 내보낼 페이지가 없습니다.');
  const sections = [];
  const coverFrames:Array<{left:number;top:number;width:number;height:number;color:string;stroke:number}|null>=[];
  for (const [index, page] of pages.entries()) {
    onProgress?.(`DOCX ${index + 1}/${pages.length}쪽의 문단·표·이미지를 변환하고 있습니다.`);
    const css = style(page);
    let children:Block[];
    let coverSignature:Table|undefined;
    if(page.matches('.proposal-final-cover')&&page.querySelector(':scope > .proposal-cover-heading')){
      children=[];
      const rect=page.getBoundingClientRect(),scale=rect.width/page.offsetWidth||1;
      let previousBottom=rect.top+(px(css.paddingTop)+px(css.borderTopWidth))*scale;
      for(const element of page.querySelectorAll(':scope > .proposal-cover-heading > p, :scope > .proposal-cover-heading > div > *, :scope > time')){
        if(ignored(element))continue;
        const position=element.getBoundingClientRect();
        children.push(await paragraph([...element.childNodes],element,'',{before:Math.max(0,(position.top-previousBottom)/scale),after:0}));
        previousBottom=position.bottom;
      }
      const signature=page.querySelector<HTMLElement>(':scope > footer');
      const logo=signature?.querySelector<HTMLImageElement>(':scope > img'),details=signature?.querySelector<HTMLElement>(':scope > div');
      if(!signature||!logo||!details)throw new Error('DOCX 제안서 표지의 로고·회사 정보를 확인하지 못했습니다.');
      const noBorder={style:BorderStyle.NONE,size:0,color:'FFFFFF'};
      const borders={top:noBorder,right:noBorder,bottom:noBorder,left:noBorder};
      const widths=[twips(px(style(signature).gridTemplateColumns.split(' ')[0])+px(style(signature).columnGap)),twips(details.offsetWidth)];
      const contact:Block[]=[];
      for(const element of details.children)contact.push(await paragraph([...element.childNodes],element,'',{before:px(style(element).marginTop),after:element===details.lastElementChild?0:px(style(details).rowGap)}));
      coverSignature=new Table({layout:TableLayoutType.FIXED,alignment:AlignmentType.CENTER,width:{size:twips(signature.offsetWidth),type:WidthType.DXA},columnWidths:widths,borders:{...borders,insideHorizontal:noBorder,insideVertical:noBorder},rows:[new TableRow({cantSplit:true,children:[
        new TableCell({width:{size:widths[0],type:WidthType.DXA},borders,margins:{top:0,bottom:0,left:0,right:0},verticalAlign:VerticalAlign.CENTER,children:[await paragraph([logo],logo,'',{before:0,after:0})]}),
        new TableCell({width:{size:widths[1],type:WidthType.DXA},borders,margins:{top:0,bottom:0,left:0,right:0},verticalAlign:VerticalAlign.CENTER,children:contact})
      ]})]});
    }else if(page.matches('.report-final-cover')&&page.querySelector(':scope > .report-cover-heading')){
      children=[];
      const rect=page.getBoundingClientRect(),scale=rect.width/page.offsetWidth||1;
      let previousBottom=rect.top+(px(css.paddingTop)+px(css.borderTopWidth))*scale;
      for(const element of page.querySelectorAll(':scope > .report-cover-heading > *, :scope > .report-cover-signature > *')){
        if(ignored(element))continue;
        const position=element.getBoundingClientRect();
        children.push(await paragraph([...element.childNodes],element,'',{before:Math.max(0,(position.top-previousBottom)/scale),after:0}));
        previousBottom=position.bottom;
      }
    }else children=await blocks(page);
    if (!children.length) throw new Error('DOCX 페이지에 표시할 내용이 없습니다.');
    if(page===pages.at(-1)&&children.at(-1) instanceof Table){
      // Word requires a terminal paragraph after a table. Its default line
      // height can otherwise create a blank page below a full-height cover.
      children.push(new Paragraph({children:[],spacing:{before:0,after:0,line:1,lineRule:LineRuleType.EXACT}}));
    }
    const pageNumber=page.querySelector<HTMLElement>(':scope > .report-page-number');
    let footer=pageNumber&&!ignored(pageNumber)?await paragraph([...pageNumber.childNodes],pageNumber):new Paragraph('');
    let footerDistance=pageNumber?twips(px(style(pageNumber).bottom)):0;
    // Proposal footers are generated by CSS and have no DOM text to traverse.
    if(page.matches('.proposal-final-toc,.proposal-final-chapter')){
      const pseudo=page.ownerDocument.defaultView!.getComputedStyle(page,'::after');
      if(pseudo.content && !['none','normal'].includes(pseudo.content) && pseudo.display!=='none' && pseudo.visibility!=='hidden'){
        const text=[...pseudo.content.matchAll(/"([^"]*)"|'([^']*)'/gu)].map(match=>match[1]??match[2]).join('');
        if(!text)throw new Error('DOCX 제안서 하단 쪽번호를 읽지 못했습니다.');
        footer=new Paragraph({children:[new TextRun({text,font:pseudo.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/gu,''),size:Math.max(1,Math.round(px(pseudo.fontSize)*1.5)),bold:Number(pseudo.fontWeight)>=600,color:color(pseudo.color)})],alignment:alignment(pseudo.textAlign),border:{top:border(pseudo,'Top')},spacing:{before:twips(px(pseudo.paddingTop))}});
        footerDistance=twips(px(pseudo.bottom));
      }
    }
    const frame=page.matches('.proposal-final-cover')?page.querySelector(':scope > .proposal-cover-frame'):null;
    const frameStyle=frame?style(frame):null;
    coverFrames.push(frameStyle?{left:px(frameStyle.left),top:px(frameStyle.top),width:page.offsetWidth-px(frameStyle.left)-px(frameStyle.right),height:page.offsetHeight-px(frameStyle.top)-px(frameStyle.bottom),color:color(frameStyle.borderTopColor)??'626262',stroke:px(frameStyle.borderTopWidth)}:null);
    // The cover signature is bottom-aligned in CSS. Map it to Word's native
    // footer, not a full-height body spacer that can push the table to page 2.
    const footerChildren=coverSignature?[coverSignature,new Paragraph({children:[],spacing:{before:0,after:0,line:1,lineRule:LineRuleType.EXACT}})]:[footer];
    if(coverSignature)footerDistance=twips(px(css.paddingBottom)+px(css.borderBottomWidth));
    sections.push({ properties: { page: { size: { width: 11906, height: 16838, orientation: orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: twips(px(css.paddingTop)), right: twips(px(css.paddingRight)), bottom: twips(px(css.paddingBottom)), left: twips(px(css.paddingLeft)), footer: footerDistance } } }, footers:{default:new Footer({children:footerChildren})}, children });
  }
  onProgress?.(`DOCX ${pages.length}쪽을 파일로 묶고 있습니다.`);
  const archive=unzipSync(new Uint8Array(await Packer.toArrayBuffer(new Document({ sections }))));
  const xml=new DOMParser().parseFromString(strFromU8(archive['word/document.xml']),'application/xml');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // Word 2010 limits page-border offsets. An editable, page-anchored native
  // rectangle preserves the CSS inset without rasterizing the cover.
  const relationships=new DOMParser().parseFromString(strFromU8(archive['word/_rels/document.xml.rels']),'application/xml');
  [...xml.getElementsByTagNameNS(ns,'footerReference')].forEach((reference,index)=>{
    const frame=coverFrames[index];if(!frame)return;
    const id=reference.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
    const target=[...relationships.documentElement.children].find(node=>node.getAttribute('Id')===id)?.getAttribute('Target');
    if(!target)throw new Error('DOCX 표지 바닥글 연결을 찾지 못했습니다.');
    const path=new URL(target,'https://docx.invalid/word/document.xml').pathname.slice(1);
    const footerXml=new DOMParser().parseFromString(strFromU8(archive[path]),'application/xml');
    const paragraph=footerXml.documentElement.lastElementChild!;
    const run=footerXml.createElementNS(ns,'w:r'),pict=footerXml.createElementNS(ns,'w:pict');
    const rectangle=footerXml.createElementNS('urn:schemas-microsoft-com:vml','v:rect');
    rectangle.setAttribute('id',`proposal-cover-frame-${index+1}`);
    rectangle.setAttribute('style',`position:absolute;margin-left:${frame.left*.75}pt;margin-top:${frame.top*.75}pt;width:${frame.width*.75}pt;height:${frame.height*.75}pt;z-index:-1;mso-position-horizontal-relative:page;mso-position-vertical-relative:page`);
    rectangle.setAttribute('filled','f');rectangle.setAttribute('strokecolor',`#${frame.color}`);rectangle.setAttribute('strokeweight',`${frame.stroke*.75}pt`);
    pict.append(rectangle);run.append(pict);paragraph.append(run);
    archive[path]=strToU8(new XMLSerializer().serializeToString(footerXml));
  });
  // Minimize only empty section markers. Word 2010 can apply the marker's
  // exact line height to the preceding inline picture and hide it entirely.
  // A minimum height keeps the marker compact without clipping that picture.
  for(const paragraph of [...xml.getElementsByTagNameNS(ns,'p')]){
    if(paragraph.children.length!==1)continue;
    const properties=paragraph.firstElementChild!;
    if(properties.localName!=='pPr'||![...properties.children].some(node=>node.localName==='sectPr'))continue;
    const spacing=[...properties.children].find(node=>node.namespaceURI===ns&&node.localName==='spacing')??xml.createElementNS(ns,'w:spacing');
    for(const [name,value] of Object.entries({before:'0',after:'0',line:'1',lineRule:'atLeast'}))spacing.setAttributeNS(ns,`w:${name}`,value);
    if(!spacing.parentNode)properties.insertBefore(spacing,properties.firstChild);
  }
  archive['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
  // The image library defaults every drawing to id=1. Word requires unique
  // drawing identifiers, including images in separate header/footer parts.
  let drawingId=0;
  for(const path of Object.keys(archive).filter(path=>/^word\/(document|header\d+|footer\d+)\.xml$/u.test(path))){
    const part=new DOMParser().parseFromString(strFromU8(archive[path]),'application/xml');
    const drawings=[...part.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','docPr')];
    if(!drawings.length)continue;
    for(const drawing of drawings)drawing.setAttribute('id',String(++drawingId));
    archive[path]=strToU8(new XMLSerializer().serializeToString(part));
  }
  return zipSync(archive);
}
