import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { BLANK_HWPX_BASE64 } from './hwpx-blank-template';

/** The audited engine is injected so the exact same conversion runs in browser and regression tests. */
export interface NativeHwpDocument {
  pasteHtml(section: number, paragraph: number, offset: number, html: string): string;
  pageCount(): number;
  exportHwpx(): Uint8Array;
  exportHwp(): Uint8Array;
  createShapeControl(options:string):string;
  setShapeProperties(section:number,paragraph:number,control:number,options:string):string;
  renderPageSvg(page:number):string;
  renderPageSvgWithProfile?(page:number,profile:string):string;
  free(): void;
}
export interface NativeHwpEngine { new(bytes: Uint8Array): NativeHwpDocument }
export interface NativeHwpContent {
  html: string;
  /** Visible source text, in reading order, independent of the HTML converter. */
  text: string;
  tables: number;
  images: number;
  tableCells?: Array<Array<{ row: number; col: number; rowSpan: number; colSpan: number; text: string }>>;
  pictures?: Array<{ bytes: Uint8Array; width: number; height: number }>;
  tableGeometry?: Array<{width:number;cells:Array<{width:number;height:number;padding:{top:number;right:number;bottom:number;left:number}}>}>;
}
export interface NativeHwpPage extends NativeHwpContent {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  footer?:NativeHwpContent & {distance:number;centerTable?:boolean};
  frame?:{left:number;top:number;width:number;height:number;color:string;stroke:number};
  rules?:Array<{left:number;top:number;width:number;height:number;colors:[string]|[string,string]}>;
  paragraphInsets?:Array<{left:number;right:number}>;
}

const pageShapes=(page:NativeHwpPage)=>[...(page.frame?[{...page.frame,colors:undefined as string[]|undefined}]:[]),...(page.rules||[]).map(rule=>({...rule,color:rule.colors[0],stroke:0}))];

const normalize = (value: string) => value.replace(/[\u200b\ufeff]/gu, '').replace(/\s+/gu, ' ').trim();
const normalizedLines=(value:string)=>JSON.stringify(value.split(/\r\n|\r|\n/u).map(normalize));
const decodeXml = (value: string) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_, entity: string) => {
  if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1), entity[1].toLowerCase() === 'x' ? 16 : 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity];
});
const textOf = (xml: string) => [...xml.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/gu)].map(match => decodeXml(match[1].replace(/<hp:lineBreak\b[^>]*\/>/gu, '\n').replace(/<[^>]+>/gu, ''))).join('');
const attribute = (xml: string, name: string) => xml.match(new RegExp(`\\b${name}="([^"]*)"`, 'u'))?.[1];
// Balanced extraction handles nested tables; a flat non-greedy table regex does not.
const elements = (xml: string, tag: string, outerOnly=false): string[] => {
  const found: Array<{ start: number; xml: string }> = [], stack: number[] = [];
  for (const match of xml.matchAll(new RegExp(`<(/?)hp:${tag}(?:\\s[^>]*|)>`, 'gu'))) {
    if (!match[1]) stack.push(match.index!);
    else {
      const start = stack.pop();
      if (start === undefined) throw new Error('HWP 요소 구조가 손상되었습니다.');
      if(!outerOnly||!stack.length)found.push({ start, xml: xml.slice(start, match.index! + match[0].length) });
    }
  }
  if (stack.length) throw new Error('HWP 요소가 닫히지 않았습니다.');
  return found.sort((a, b) => a.start - b.start).map(item => item.xml);
};

/** Checks semantic content, not just a plausible page count or a non-white bitmap. */
export function verifyNativeHwpContent(hwpx: Uint8Array, pages: NativeHwpPage[], verifyFrame=true): void {
  const files = unzipSync(hwpx);
  const sections = Object.keys(files).filter(path => /^Contents\/section\d+\.xml$/u.test(path));
  if (sections.length !== pages.length) throw new Error(`HWP 구역 누락 (${sections.length}/${pages.length}).`);
  pages.forEach((source, index) => {
    const page=combinedContent(source);
    const bytes = files[`Contents/section${index}.xml`];
    if (!bytes) throw new Error(`HWP ${index + 1}쪽 구역이 없습니다.`);
    const xml = strFromU8(bytes);
    const paper = xml.match(/<hp:pagePr\b[^>]*>/u)?.[0] || '';
    const margin = xml.match(/<hp:margin\b[^>]*\/>/u)?.[0] || '';
    if (Number(attribute(paper, 'width')) !== Math.round(Math.min(page.width, page.height) * 75)
      || Number(attribute(paper, 'height')) !== Math.round(Math.max(page.width, page.height) * 75)
      || attribute(paper, 'landscape') !== (page.width > page.height ? 'NARROWLY' : 'WIDELY')
      || Object.entries(page.margins).some(([side, value]) => Number(attribute(margin, side))+(side==='bottom'?Number(attribute(margin,'footer')):0) !== Math.round(value * 75))) throw new Error(`HWP ${index + 1}쪽 용지·여백이 원문과 다릅니다.`);
    if(source.footer&&elements(xml,'footer').length!==1)throw new Error('HWP 바닥글이 누락되었습니다.');
    if(source.paragraphInsets){
      const paragraphs=elements(xml,'p',true),header=strFromU8(files['Contents/header.xml']);
      if(paragraphs.length!==source.paragraphInsets.length)throw Error('HWP 갑지 문단 배치가 원문과 다릅니다.');
      paragraphs.forEach((paragraph,i)=>{
        const definition=[...header.matchAll(/<hh:paraPr\b[^>]*>[\s\S]*?<\/hh:paraPr>/gu)].find(m=>attribute(m[0],'id')===attribute(paragraph,'paraPrIDRef'))?.[0]||'';
        const factor=definition.includes('<hp:case')?75:150;
        for(const side of ['left','right'] as const)if(Number(attribute(definition.match(new RegExp(`<hc:${side}\\b[^>]*\\/>`,'u'))?.[0]||'','value'))!==Math.round(source.paragraphInsets![i][side]*factor))throw Error('HWP 갑지 문단 가로 위치가 원문과 다릅니다.');
      });
    }
    if(verifyFrame&&pageShapes(source).length){
      const rectangles=elements(xml,'rect');
      if(rectangles.length!==pageShapes(source).length)throw new Error('HWP 갑지 테두리·장식선이 누락되었습니다.');
      for(const frame of pageShapes(source)){
      const rect=rectangles.find(rect=>{const position=rect.match(/<hp:pos\b[^>]*\/>/u)?.[0]||'';return Number(attribute(position,'horzOffset'))===Math.round(frame.left*75)&&Number(attribute(position,'vertOffset'))===Math.round(frame.top*75);})||'';
      const size=rect.match(/<hp:sz\b[^>]*\/>/u)?.[0]||'',position=rect.match(/<hp:pos\b[^>]*\/>/u)?.[0]||'',line=rect.match(/<hp:lineShape\b[^>]*\/>/u)?.[0]||'';
      if(Number(attribute(size,'width'))!==Math.round(frame.width*75)||Number(attribute(size,'height'))!==Math.round(frame.height*75)||Number(attribute(position,'horzOffset'))!==Math.round(frame.left*75)||Number(attribute(position,'vertOffset'))!==Math.round(frame.top*75)||attribute(position,'horzRelTo')!=='PAPER'||attribute(position,'vertRelTo')!=='PAPER'||attribute(line,'color')?.toLowerCase()!==frame.color.toLowerCase()||Number(attribute(line,'width'))!==Math.round(frame.stroke*75))throw new Error('HWP 갑지 테두리의 위치·크기·색상이 원문과 다릅니다.');
      if(frame.colors?.length===2){
        const gradient=rect.match(/<hc:gradation\b[\s\S]*?<\/hc:gradation>/u)?.[0]||'';
        const colors=[...gradient.matchAll(/<hc:color\b[^>]*value="([^"]+)"/gu)].map(m=>m[1].toLowerCase());
        if(attribute(gradient,'type')!=='LINEAR'||Number(attribute(gradient,'angle'))!==90||JSON.stringify(colors)!==JSON.stringify(frame.colors.map(c=>c.toLowerCase())))throw new Error('HWP 장식선 그라데이션이 원문과 다릅니다.');
      }else if(frame.colors?.length===1&&!rect.toLowerCase().includes(`facecolor="${frame.colors[0].toLowerCase()}"`))throw new Error('HWP 장식선 채우기 색상이 원문과 다릅니다.');
      if(!frame.colors&&/<hc:fillBrush\b/u.test(rect))throw new Error('HWP 갑지 테두리 안에 원문에 없는 채우기가 생겼습니다.');
      }
    }
    const text = textOf(xml);
    if(normalizedLines(text)!==normalizedLines(page.text)&&(text.includes('\n')||page.text.includes('\n')))throw new Error(`HWP ${index+1}쪽 줄바꿈 위치가 원문과 다릅니다.`);
    if (normalize(text) !== normalize(page.text)) throw new Error(`HWP ${index + 1}쪽 글자가 원문과 다릅니다. 다운로드를 중단했습니다.`);
    for (const [tag, expected, name] of [['tbl', page.tables, '표'], ['pic', page.images, '사진']] as const) {
      const actual = [...xml.matchAll(new RegExp(`<hp:${tag}\\b`, 'gu'))].length;
      if (actual !== expected) throw new Error(`HWP ${index + 1}쪽 ${name} 누락 (${actual}/${expected}). 다운로드를 중단했습니다.`);
    }
    if ((page.tableCells?.length || 0) !== page.tables || (page.pictures?.length || 0) !== page.images) throw new Error('HWP 표·사진의 원문 대조 자료가 없습니다.');
    elements(xml, 'tbl').forEach((table, tableIndex) => {
      // Remove nested tables before enumerating this table's own cells.
      let own = table;
      for (const nested of elements(table, 'tbl').slice(1)) own = own.replace(nested, '');
      const cells = elements(own, 'tc').map(cell => ({ row: Number(attribute(cell, 'rowAddr')), col: Number(attribute(cell, 'colAddr')), rowSpan: Number(attribute(cell, 'rowSpan')), colSpan: Number(attribute(cell, 'colSpan')), text: normalizedLines(textOf(cell)) }));
      const expected = page.tableCells![tableIndex].map(cell => ({ row: cell.row, col: cell.col, rowSpan: cell.rowSpan, colSpan: cell.colSpan, text: normalizedLines(cell.text) }));
      if (JSON.stringify(cells) !== JSON.stringify(expected)) throw new Error(`HWP ${index + 1}쪽 표의 셀·병합·내용이 원문과 다릅니다.`);
      const geometry=page.tableGeometry?.[tableIndex];
      if(geometry){
        const size=table.match(/<hp:sz\b[^>]*\/>/u)?.[0]||'';
        const outer=table.match(/<hp:outMargin\b[^>]*\/>/u)?.[0]||'';
        if(Number(attribute(size,'width'))!==Math.round(geometry.width*75)||['left','right','top','bottom'].some(side=>Number(attribute(outer,side))!==0))throw new Error('HWP 표 너비·바깥 여백이 원문과 다릅니다.');
        elements(own,'tc',true).forEach((cell,cellIndex)=>{
          const expected=geometry.cells[cellIndex],size=cell.match(/<hp:cellSz\b[^>]*\/>/u)?.[0]||'',padding=cell.match(/<hp:cellMargin\b[^>]*\/>/u)?.[0]||'';
          if(!expected||Number(attribute(size,'width'))!==Math.round(expected.width*75)||Number(attribute(size,'height'))!==Math.round(expected.height*75)||Object.entries(expected.padding).some(([side,value])=>Number(attribute(padding,side))!==Math.round(value*75)))throw new Error('HWP 표 셀 크기·여백이 원문과 다릅니다.');
        });
      }
    });
    const content = strFromU8(files['Contents/content.hpf']);
    elements(xml, 'pic').forEach((picture, imageIndex) => {
      const ref = attribute(picture, 'binaryItemIDRef');
      if (!ref) throw new Error(`HWP ${index + 1}쪽 사진 참조가 없습니다.`);
      const item = [...content.matchAll(/<opf:item\b[^>]*>/gu)].find(match => match[0].includes(`id="${ref}"`))?.[0];
      const path = item?.match(/href="([^"]+)"/u)?.[1];
      if (!path || !files[path]?.length) throw new Error(`HWP ${index + 1}쪽 사진 파일 연결이 손상되었습니다.`);
      const expected = page.pictures![imageIndex], actual = files[path];
      if (actual.length !== expected.bytes.length || actual.some((value, offset) => value !== expected.bytes[offset])) throw new Error(`HWP ${index + 1}쪽 사진 파일 또는 순서가 원문과 다릅니다.`);
      const size = picture.match(/<hp:sz\b[^>]*\/>/u)?.[0] || '';
      if (Number(attribute(size, 'width')) !== Math.round(expected.width * 75) || Number(attribute(size, 'height')) !== Math.round(expected.height * 75)) throw new Error(`HWP ${index + 1}쪽 사진 크기가 원문과 다릅니다.`);
    });
  });
}

function combinedContent(page:NativeHwpPage):NativeHwpPage{
  const footer=page.footer;if(!footer)return page;
  return {...page,text:footer.text+page.text,tables:footer.tables+page.tables,images:footer.images+page.images,tableCells:[...(footer.tableCells||[]),...(page.tableCells||[])],pictures:[...(footer.pictures||[]),...(page.pictures||[])],tableGeometry:[...(footer.tableGeometry||[]),...(page.tableGeometry||[])]};
}

function restoreTableGeometry(xml:string,geometries:NativeHwpContent['tableGeometry']):string{
  if(!geometries)return xml;
  if(elements(xml,'tbl').length!==geometries.length)throw new Error('HWP 표 배치 대조자료가 부족합니다.');
  for(let index=geometries.length-1;index>=0;index--){
    const original=elements(xml,'tbl')[index],geometry=geometries[index];
    let next=original.replace(/<hp:sz\b[^>]*\/>/u,tag=>tag.replace(/width="[^"]*"/u,`width="${Math.round(geometry.width*75)}"`))
      .replace(/<hp:outMargin\b[^>]*\/>/u,'<hp:outMargin left="0" right="0" top="0" bottom="0"/>');
    const cells=elements(next,'tc',true);
    if(cells.length!==geometry.cells.length)throw new Error('HWP 표 셀 배치 대조자료가 부족합니다.');
    cells.forEach((cell,cellIndex)=>{
      const expected=geometry.cells[cellIndex];
      // A cell's own geometry follows its subList; earlier matches can belong
      // to a nested table. Replace the last geometry element, not the first.
      const ownSize=[...cell.matchAll(/<hp:cellSz\b[^>]*\/>/gu)].at(-1)?.[0];
      const ownMargin=[...cell.matchAll(/<hp:cellMargin\b[^>]*\/>/gu)].at(-1)?.[0];
      if(!ownSize||!ownMargin)throw new Error('HWP 표 셀 속성이 없습니다.');
      let changed=cell.replace(/<hp:tc\b[^>]*>/u,tag=>tag.replace(/hasMargin="[^"]*"/u,'hasMargin="1"'));
      const sizeOffset=changed.lastIndexOf(ownSize);
      changed=changed.slice(0,sizeOffset)+`<hp:cellSz width="${Math.round(expected.width*75)}" height="${Math.round(expected.height*75)}"/>`+changed.slice(sizeOffset+ownSize.length);
      const marginOffset=changed.lastIndexOf(ownMargin);
      changed=changed.slice(0,marginOffset)+`<hp:cellMargin ${Object.entries(expected.padding).map(([side,value])=>`${side}="${Math.round(value*75)}"`).join(' ')}/>`+changed.slice(marginOffset+ownMargin.length);
      next=next.replace(cell,changed);
    });
    xml=xml.replace(original,next);
  }
  return xml;
}

function clearImportedTableIndent(xml:string,files:Record<string,Uint8Array>):string{
  let header=strFromU8(files['Contents/header.xml']);
  const definitions=[...header.matchAll(/<hh:paraPr\b[^>]*>[\s\S]*?<\/hh:paraPr>/gu)].map(m=>m[0]);
  let nextId=Math.max(...definitions.map(p=>Number(attribute(p,'id'))))+1;
  const replacements=new Map<string,string>();
  for(const paragraph of elements(xml,'p').reverse()){
    let own=paragraph;
    for(const child of elements(paragraph,'p').slice(1))own=own.replace(child,'');
    if(!/<hp:tbl\b/u.test(own))continue;
    const ref=attribute(paragraph,'paraPrIDRef')!;
    const definition=definitions.find(p=>attribute(p,'id')===ref);
    if(!definition)throw new Error('HWP 표 문단 속성이 없습니다.');
    if(!/<hc:(?:left|right)\b[^>]*value="(?!0")[^"]+"/u.test(definition))continue;
    if(!replacements.has(ref)){
      const id=String(nextId++);
      const clean=definition.replace(/\bid="[^"]*"/u,`id="${id}"`).replace(/<hc:(?:left|right)\b[^>]*\/>/gu,tag=>tag.replace(/value="[^"]*"/u,'value="0"'));
      header=header.replace('</hh:paraProperties>',`${clean}</hh:paraProperties>`);
      replacements.set(ref,id);
    }
    xml=xml.replace(paragraph,paragraph.replace(/(<hp:p\b[^>]*paraPrIDRef=")[^"]*/u,`$1${replacements.get(ref)}`));
  }
  if(replacements.size)header=header.replace(/<hh:paraProperties\b[^>]*>/u,tag=>tag.replace(/itemCnt="(\d+)"/u,(_,count)=>`itemCnt="${Number(count)+replacements.size}"`));
  files['Contents/header.xml']=strToU8(header);return xml;
}

function restoreParagraphInsets(xml:string,files:Record<string,Uint8Array>,insets:NativeHwpPage['paragraphInsets']):string{
  if(!insets)return xml;
  const paragraphs=elements(xml,'p',true);
  if(paragraphs.length!==insets.length)throw Error('HWP 갑지 문단 배치가 원문과 다릅니다.');
  let header=strFromU8(files['Contents/header.xml']);
  const definitions=[...header.matchAll(/<hh:paraPr\b[^>]*>[\s\S]*?<\/hh:paraPr>/gu)].map(m=>m[0]);
  let id=Math.max(...definitions.map(p=>Number(attribute(p,'id'))))+1;
  paragraphs.forEach((paragraph,index)=>{
    const definition=definitions.find(p=>attribute(p,'id')===attribute(paragraph,'paraPrIDRef'));
    if(!definition||!Object.values(insets[index]).every(Number.isFinite))throw Error('HWP 갑지 문단 여백을 확인하지 못했습니다.');
    // HWPX case margins are effective HU; switch/default margins use 2x HU.
    const set=(part:string,factor:number)=>part.replace(/<hc:(left|right)\b[^>]*\/>/gu,(tag,side:'left'|'right')=>tag.replace(/value="[^"]*"/u,`value="${Math.round(insets[index][side]*factor)}"`));
    const updated=set(definition.replace(/\bid="[^"]*"/u,`id="${id}"`),150).replace(/<hp:case\b[^>]*>[\s\S]*?<\/hp:case>/gu,part=>set(part,75));
    header=header.replace('</hh:paraProperties>',`${updated}</hh:paraProperties>`);
    xml=xml.replace(paragraph,paragraph.replace(/(<hp:p\b[^>]*paraPrIDRef=")[^"]*/u,`$1${id++}`));
  });
  header=header.replace(/<hh:paraProperties\b[^>]*>/u,tag=>tag.replace(/itemCnt="(\d+)"/u,(_,n)=>`itemCnt="${Number(n)+insets.length}"`));
  files['Contents/header.xml']=strToU8(header);return xml;
}

function blankSections(pages: NativeHwpPage[]): Uint8Array {
  const files = unzipSync(Uint8Array.from(atob(BLANK_HWPX_BASE64), value => value.charCodeAt(0)));
  const template = strFromU8(files['Contents/section0.xml']);
  pages.forEach((page, index) => {
    const { width, height, margins } = page;
    if(page.footer&&(!Number.isFinite(page.footer.distance)||page.footer.distance<0||page.footer.distance>margins.bottom))throw new Error('HWP 바닥글 위치가 본문 여백 밖에 있습니다.');
    if (![width, height, ...Object.values(margins)].every(Number.isFinite) || width <= margins.left + margins.right || height <= margins.top + margins.bottom || Object.values(margins).some(value => value < 0)) throw new Error('HWP 용지 크기 또는 여백이 올바르지 않습니다.');
    for(const shape of pageShapes(page)){
      if(![shape.left,shape.top,shape.width,shape.height,shape.stroke].every(Number.isFinite)||shape.left<0||shape.top<0||shape.width<=0||shape.height<=0||shape.stroke<0||shape.left+shape.width>width+1||shape.top+shape.height>height+1||(shape.colors&&![1,2].includes(shape.colors.length))||!(shape.colors??[shape.color]).every(value=>/^#[0-9a-f]{6}$/iu.test(value)))throw new Error('HWP 테두리·장식선의 위치 또는 색상이 올바르지 않습니다.');
    }
    // HWPUNIT = 1/100 pt = 75 screen px. WIDELY is the engine's portrait enum.
    const hu = (value: number) => Math.round(value * 75);
    files[`Contents/section${index}.xml`] = strToU8(template
      .replace(/<hp:pagePr\b[^>]*>/u, `<hp:pagePr landscape="${width > height ? 'NARROWLY' : 'WIDELY'}" width="${hu(Math.min(width, height))}" height="${hu(Math.max(width, height))}" gutterType="LEFT_ONLY">`)
      .replace(/<hp:margin\b[^>]*\/>/u, `<hp:margin header="0" footer="${page.footer?hu(margins.bottom)-hu(page.footer.distance):0}" gutter="0" left="${hu(margins.left)}" right="${hu(margins.right)}" top="${hu(margins.top)}" bottom="${hu(page.footer?.distance??margins.bottom)}"/>`));
  });
  files['Contents/header.xml'] = strToU8(strFromU8(files['Contents/header.xml']).replace(/secCnt="\d+"/u, `secCnt="${pages.length}"`));
  let content = strFromU8(files['Contents/content.hpf']);
  const item = content.match(/<opf:item\b[^>]*href="Contents\/section0\.xml"[^>]*\/>/u)?.[0];
  const id = item?.match(/\bid="([^"]+)"/u)?.[1];
  if (!item || !id) throw new Error('HWPX 기본 구역 연결을 읽지 못했습니다.');
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const spine = content.match(new RegExp(`<opf:itemref\\b[^>]*idref="${escaped}"[^>]*/>`, 'u'))?.[0];
  if (!spine) throw new Error('HWPX 기본 구역 순서를 읽지 못했습니다.');
  content = content.replace(item, pages.map((_, index) => item.replace(`id="${id}"`, `id="nativeSection${index}"`).replace('Contents/section0.xml', `Contents/section${index}.xml`)).join(''));
  content = content.replace(spine, pages.map((_, index) => spine.replace(`idref="${id}"`, `idref="nativeSection${index}"`)).join(''));
  files['Contents/content.hpf'] = strToU8(content);
  return zipSync(files);
}

function imageParagraphs(html: string): string {
  // The engine imports a block IMG (and images in TDs), but drops IMG inside
  // its inline paragraph parser. Unwrap only an image-only paragraph: mixed
  // inline text/images cannot be reflowed safely and remain a hard loss error.
  return html.replace(/<p\b([^>]*)>\s*(<img\b[^>]*>)\s*<\/p>/giu, (_, attributes: string, image: string) => {
    const parentStyle = attributes.match(/\bstyle="([^"]*)"/iu)?.[1] || '';
    const ownStyle = image.match(/\bstyle="([^"]*)"/iu)?.[1] || '';
    const declarations = parentStyle.split(';').map(value => value.trim()).filter(Boolean);
    const inherited = declarations.filter(value => /^(?:text-align|margin-(?:top|right|bottom|left))\s*:/iu.test(value));
    if (declarations.some(value => /^(?:padding(?:-\w+)?|border(?:-\w+)?|margin)\s*:/iu.test(value) && !/:\s*(?:0(?:px|pt)?|none)\s*$/iu.test(value))) throw new Error('HWP 사진 문단의 여백·테두리를 보존하려면 개별 문단 속성 변환이 필요합니다. 다운로드를 중단했습니다.');
    // Competing image and paragraph margins have CSS collapsing rules that the
    // clipboard importer cannot express. Never silently choose one of them.
    if (inherited.some(value => /^margin-/iu.test(value)) && /(?:^|;)\s*margin(?:-\w+)?\s*:/iu.test(ownStyle)) throw new Error('HWP 사진과 문단의 중첩 여백을 보존하지 못했습니다.');
    // Geometry lives in the IMG width/height, not the parent's fixed line box.
    // Keep independent image styling and the paragraph's horizontal alignment.
    const nextStyle = `${inherited.join(';')};${ownStyle}`;
    return image.replace(/\sstyle="[^"]*"/iu, '').replace(/\s*\/?>$/u, ` style="${nextStyle}">`);
  });
}

/** No screenshot fallback: loss of text, tables, images or pages is a hard error. */
export function createNativeHwp(pages: NativeHwpPage[], Engine: NativeHwpEngine): Uint8Array {
  if (!pages.length) throw new Error('HWP로 내보낼 페이지가 없습니다.');
  const document = new Engine(blankSections(pages));
  try {
    const marker = 'CF148_NATIVE_IMPORT_ANCHOR';
    const footerMarker='CF148_NATIVE_FOOTER_ANCHOR';
    const footerStyleMarker='CF148_NATIVE_FOOTER_STYLE';
    const breakMarker='\ue000';
    pages.forEach((page, index) => {
      if ([page.html,page.footer?.html||''].some(html=>[marker,footerMarker,footerStyleMarker].some(value=>html.includes(value)))) throw new Error('HWP 변환 내부 표식과 본문이 충돌했습니다.');
      if([page.html,page.footer?.html||''].some(html=>decodeXml(html).includes(breakMarker)))throw new Error('HWP 줄바꿈 내부 표식과 본문이 충돌했습니다.');
      // pasteHtml keeps the destination's paragraph properties for the first
      // pasted paragraph. Isolate that behavior in a temporary paragraph;
      // remove it below without leaving a blank line in the actual document.
      const html=`<p>${marker}</p>${imageParagraphs(page.html)}${page.footer?`<p>${footerMarker}</p>${page.footer.centerTable?`<p style="text-align:center;margin-top:0px;margin-bottom:0px">${footerStyleMarker}</p>`:''}${imageParagraphs(page.footer.html)}`:''}`;
      const result = JSON.parse(document.pasteHtml(index, 0, 0, html.replace(/<br\b[^>]*>/giu,breakMarker))) as { ok?: boolean };
      if (!result.ok) throw new Error(`HWP ${index + 1}쪽 편집 본문 생성에 실패했습니다.`);
    });
    const native = unzipSync(document.exportHwpx());
    // The pinned HTML importer stores px line-height at 75 HU/px, but native
    // FIXED spacing uses twice the effective HU (HWPX case/default pair).
    // Correct only this fresh HTML-generated document, never a loaded HWP.
    native['Contents/header.xml']=strToU8(strFromU8(native['Contents/header.xml']).replace(/<hh:lineSpacing\b[^>]*\/>/gu,tag=>/type="FIXED"/u.test(tag)?tag.replace(/value="(\d+)"/u,(_,value)=>`value="${Number(value)*2}"`):tag));
    pages.forEach((page, index) => {
      const path = `Contents/section${index}.xml`;
      let xml = strFromU8(native[path]);
      // Restore real inline breaks without introducing paragraph spacing.
      // Discard only affected layout caches so the engine measures new lines.
      for(const paragraph of elements(xml,'p').reverse())if(paragraph.includes(breakMarker))xml=xml.replace(paragraph,paragraph.replace(/<hp:linesegarray\b[^>]*>[\s\S]*?<\/hp:linesegarray>/gu,'').replace(/<hp:t(?:\s[^>]*)?>[\s\S]*?<\/hp:t>/gu,text=>text.replaceAll(breakMarker,'<hp:lineBreak/>')));
      const first = xml.match(/<hp:p\b[^>]*>[\s\S]*?<\/hp:p>/u)?.[0];
      const setup = first?.match(/<hp:run\b[^>]*><hp:secPr\b[\s\S]*?<\/hp:run>/u)?.[0];
      if (!first || !setup || (first.match(/<hp:t\b/gu) || []).length !== 1 || !first.includes(`<hp:t>${marker}</hp:t>`)) throw new Error('HWP 초기 문단 속성을 보존하지 못했습니다.');
      let withoutMarker = xml.replace(first, '');
      if (!/<hp:p\b/u.test(withoutMarker)) throw new Error('HWP 본문이 비어 있습니다.');
      const firstBody=elements(withoutMarker,'p',true)[0];
      if(firstBody&&elements(firstBody,'pic').length===1&&!normalize(textOf(firstBody))&&!/<hp:tbl\b/u.test(firstBody)){
        // The removed clipboard anchor left its baseline on this first image.
        // Do not move cell pictures or later paragraphs to compensate for it.
        withoutMarker=withoutMarker.replace(firstBody,firstBody.replace(/(<hp:lineseg\b[^>]*\bvertpos=")[^"]*/u,'$10'));
      }
      let controls=setup;
      if(page.footer){
        const split=elements(withoutMarker,'p',true).find(p=>textOf(p)===footerMarker);
        if(!split)throw new Error('HWP 바닥글 경계를 찾지 못했습니다.');
        const start=withoutMarker.indexOf(split);
        let footer=withoutMarker.slice(start+split.length,withoutMarker.lastIndexOf('</hs:sec>'));
        if(page.footer.centerTable){
          const styleParagraph=elements(footer,'p',true).find(p=>textOf(p)===footerStyleMarker);
          const ref=styleParagraph&&attribute(styleParagraph,'paraPrIDRef');
          if(!styleParagraph||!ref)throw new Error('HWP 갑지 회사정보 정렬을 만들지 못했습니다.');
          footer=footer.replace(styleParagraph,'').replace(/<hp:p\b[^>]*>/u,tag=>tag.replace(/paraPrIDRef="[^"]*"/u,`paraPrIDRef="${ref}"`));
        }
        withoutMarker=withoutMarker.slice(0,start)+'</hs:sec>';
        controls+=`<hp:run charPrIDRef="0"><hp:ctrl><hp:footer id="0" applyPageType="BOTH"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="BOTTOM" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${footer}</hp:subList></hp:footer></hp:ctrl></hp:run>`;
      }
      native[path] = strToU8(restoreParagraphInsets(clearImportedTableIndent(restoreTableGeometry(withoutMarker.replace(/(<hp:p\b[^>]*>)/u, `$1${controls}`),combinedContent(page).tableGeometry),native),native,page.paragraphInsets));
    });
    const normalized = zipSync(native);
    verifyNativeHwpContent(normalized, pages, false);
    const prepared = new Engine(normalized);
    try {
      pages.forEach((page,index)=>pageShapes(page).forEach(f=>{
        const hu=(value:number)=>Math.round(value*75);
        const result=JSON.parse(prepared.createShapeControl(JSON.stringify({sectionIdx:index,paraIdx:0,charOffset:0,width:hu(f.width),height:hu(f.height),horzOffset:hu(f.left),vertOffset:hu(f.top),treatAsChar:false,textWrap:'BehindText',shapeType:'rectangle'}))) as {ok:boolean;paraIdx:number;controlIdx:number};
        if(!result.ok)throw Error('HWP 갑지 테두리를 만들지 못했습니다.');
        const color=Number.parseInt(f.color.replace('#','').match(/../gu)!.reverse().join(''),16);
        if(!JSON.parse(prepared.setShapeProperties(index,result.paraIdx,result.controlIdx,JSON.stringify({fillType:f.colors?'solid':'none',...(f.colors?{fillBgColor:color}:{}),borderColor:color,borderWidth:hu(f.stroke),lineType:f.colors?0:1,horzRelTo:'Paper',vertRelTo:'Paper'}))).ok)throw Error('HWP 갑지 테두리 배치를 보존하지 못했습니다.');
      }));
      if (prepared.pageCount() !== pages.length) throw new Error(`HWP 줄바꿈으로 페이지 수가 달라졌습니다. (${prepared.pageCount()}/${pages.length})`);
      // The SDK exposes gradient geometry, but not its color stops. Preserve
      // those two authored stops through the native HWPX fillBrush instead.
      const decorated=unzipSync(prepared.exportHwpx());
      pages.forEach((page,index)=>{
        const path=`Contents/section${index}.xml`;let xml=strFromU8(decorated[path]);
        if(page.frame){
          const frame=elements(xml,'rect').find(rect=>{const pos=rect.match(/<hp:pos\b[^>]*\/>/u)?.[0]||'';return Number(attribute(pos,'horzOffset'))===Math.round(page.frame!.left*75)&&Number(attribute(pos,'vertOffset'))===Math.round(page.frame!.top*75);});
          if(!frame)throw new Error('HWP 갑지 테두리가 없습니다.');
          xml=xml.replace(frame,frame.replace(/<hc:fillBrush\b[\s\S]*?<\/hc:fillBrush>/u,''));
        }
        for(const rule of page.rules||[]){
          if(rule.colors.length!==2)continue;
          const rect=elements(xml,'rect').find(rect=>{const pos=rect.match(/<hp:pos\b[^>]*\/>/u)?.[0]||'';return Number(attribute(pos,'horzOffset'))===Math.round(rule.left*75)&&Number(attribute(pos,'vertOffset'))===Math.round(rule.top*75);});
          if(!rect)throw new Error('HWP 그라데이션 장식선이 없습니다.');
          const fill=`<hc:fillBrush><hc:gradation type="LINEAR" angle="90" centerX="0" centerY="0" step="255" stepCenter="50" alpha="0">${rule.colors.map(color=>`<hc:color value="${color}"/>`).join('')}</hc:gradation></hc:fillBrush>`;
          xml=xml.replace(rect,rect.replace(/<hc:fillBrush\b[\s\S]*?<\/hc:fillBrush>/u,fill));
        }
        decorated[path]=strToU8(xml);
      });
      const finished=new Engine(zipSync(decorated));
      let bytes:Uint8Array;
      try{bytes=finished.exportHwp();}finally{finished.free();}
      const reopened = new Engine(bytes);
      try {
        verifyNativeHwpContent(reopened.exportHwpx(), pages);
        if (reopened.pageCount() !== pages.length) throw new Error('HWP 저장 후 페이지 수가 달라졌습니다.');
      } finally { reopened.free(); }
      return bytes;
    } finally { prepared.free(); }
  } finally { document.free(); }
}
