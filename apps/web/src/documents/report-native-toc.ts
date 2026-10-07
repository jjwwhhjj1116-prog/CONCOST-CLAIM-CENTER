import { unzipSync, strFromU8 } from 'fflate';
import type { NativeHwpDocument, NativeHwpEngine } from './editable-hwp-export';
import { reportSourceSha256 } from './report-native-source';

/** Offsets are the engine's Unicode-scalar indices, never JS UTF-16 indices.
 * Writes remain control-free body numerals only. A literal Roman/title 1x2
 * table can be a read-only body anchor, never a cell mutation target. */
type CellPath = [{controlIndex:number;cellIndex:number;cellParaIndex:number}];
type CellProof = {path:CellPath;length:number;sha256:string};
type NativeTocAnchor = {section:number;paragraph:number;paragraphSha256:string;physicalPage:number;printedPage:number;cells?:[CellProof,CellProof]};
export interface ConfirmedNativeTocNumber {
  section: number; paragraph: number; offset: number; oldText: string; paragraphSha256: string;
  decimalDigits: number; tocPhysicalPage: number;
  anchor: NativeTocAnchor;
}
type TocDocument = NativeHwpDocument & {
  getSourceFormat(): string;
  getSectionCount(): number; getParagraphCount(section: number): number; getParagraphLength(section: number, paragraph: number): number;
  getTextRange(section: number, paragraph: number, offset: number, count: number): string;
  getCharShapeRuns(section: number, paragraph: number, start: number, end: number): string;
  getParaPropertiesAt(section: number, paragraph: number): string; getControlTextPositions(section: number, paragraph: number): string;
  getFieldList(): string; getControls(): string; getPageOfPosition(section: number, paragraph: number): string;
  getCursorModel():string;getTableDimensions(section:number,parent:number,control:number):string;
  getCellInfoByPath(section:number,parent:number,path:string):string;getCellParagraphCountByPath(section:number,parent:number,path:string):number;
  getCellParagraphLengthByPath(section:number,parent:number,path:string):number;getTextInCellByPath(section:number,parent:number,path:string,offset:number,count:number):string;
  getPageInfo(page: number): string; getPageTextLayout(page: number): string;
  replaceText(section: number, paragraph: number, offset: number, count: number, value: string): string;
  setCharShapeId(section: number, paragraph: number, start: number, end: number, shape: number): string;
  exportHwpWithReport(): {contentLoss(): string; takeBytes(): Uint8Array; free(): void};
  exportHwpxWithReport(): {contentLoss(): string; takeBytes(): Uint8Array; free(): void};
};
type Run = {text: string; secIdx?: number; paraIdx?: number; charStart?: number; parentParaIdx?: number; cellPath?: unknown[]; charX: number[]; x: number; y: number; h: number; [key: string]: unknown};
const reject = (code = 'CHECK') => new Error(`원형 목차의 확인 위치·숫자·서식 또는 배치를 보존하지 못해 적용하지 않았습니다. 기존 원본은 유지됩니다. (${code})`);
const check: (value: unknown, code?: string) => asserts value = (value, code) => {if (!value) throw reject(code);};
const shaText = (text: string) => reportSourceSha256(new TextEncoder().encode(text).buffer as ArrayBuffer);
const key = (entry: {section: number; paragraph: number}) => `${entry.section}:${entry.paragraph}`;
const validIndex = (value: number) => Number.isSafeInteger(value) && value >= 0;
const printedNumber = (value: number) => validIndex(value) && value >= 1 && value <= 65_535; // Native folio formatter uses u16.
const normalTitle=(text:string)=>text.trim().replace(/\s+/gu,' ');
// Preserve only actual trailing U0020 spaces; TAB/LF or later text is not a suffix.
const tocNumber=(text:string)=>/^(.+?)(?:\s*[.·…]{3,}\s*|\t+\s*)([0-9]{1,9})( *)$/u.exec(text);
const paragraph = (doc: TocDocument, entry: {section: number; paragraph: number}) => {
  check(validIndex(entry.section) && validIndex(entry.paragraph) && entry.section < doc.getSectionCount() && entry.paragraph < doc.getParagraphCount(entry.section));
  const length = doc.getParagraphLength(entry.section, entry.paragraph);
  check(Number.isSafeInteger(length) && length >= 0 && length <= 100_000);
  const text = doc.getTextRange(entry.section, entry.paragraph, 0, length);
  check([...text].length === length); return text;
};
const shapes = (doc: TocDocument, entry: {section: number; paragraph: number}, length: number): number[] => {
  const runs = JSON.parse(doc.getCharShapeRuns(entry.section, entry.paragraph, 0, length));
  check(Array.isArray(runs)); const result: number[] = [];
  for (const run of runs) {
    check(run && run.startOffset === result.length && Number.isSafeInteger(run.endOffset) && run.endOffset > result.length && run.endOffset <= length && validIndex(run.charShapeId));
    while (result.length < run.endOffset) result.push(run.charShapeId);
  }
  check(result.length === length); return result;
};
const bodyRun = (run: Run) => validIndex(run.secIdx!) && validIndex(run.paraIdx!) && validIndex(run.charStart!) && run.parentParaIdx === undefined && !run.cellPath?.length;
const layout = (doc: TocDocument): Run[][] => Array.from({length: doc.pageCount()}, (_, page) => {
  const result = JSON.parse(doc.getPageTextLayout(page)); check(Array.isArray(result.runs)); return result.runs;
});
const numberLocation=(pages:Run[][],entry:ConfirmedNativeTocNumber,digits:string)=>{
  const locations:Array<{page:number;y:number;h:number}>=[];
  for(let offset=0;offset<digits.length;offset++) {
    const hits=pages.flatMap((runs,page)=>runs.filter(run=>bodyRun(run)&&run.secIdx===entry.section&&run.paraIdx===entry.paragraph&&run.charStart!<=entry.offset+offset&&run.charStart!+[...run.text].length>entry.offset+offset).map(run=>({page,y:run.y,h:run.h,char:[...run.text][entry.offset+offset-run.charStart!]})));
    check(hits.length===1 && hits[0].char===digits[offset],'NUMBER_LOCATION'); const {char:_char,...position}=hits[0];locations.push(position);
  }
  check(locations.every(location=>JSON.stringify(location)===JSON.stringify(locations[0])),'NUMBER_LOCATION');return locations[0];
};
const cellAnchorData=(doc:TocDocument,anchor:NativeTocAnchor,pages:Run[][],archive:Record<string,Uint8Array>)=>{
  paragraph(doc,anchor); // Validate section-local host address before native cell queries.
  for(const method of ['getCursorModel','getTableDimensions','getCellInfoByPath','getCellParagraphCountByPath','getCellParagraphLengthByPath','getTextInCellByPath'])check(typeof(doc as unknown as Record<string,unknown>)[method]==='function','CELL_ANCHOR');
  const cells=anchor.cells;check(Array.isArray(cells)&&cells.length===2,'CELL_ANCHOR');
  verifyLiteralCellXml(doc,anchor,archive);
  const model=JSON.parse(doc.getCursorModel()),controls=JSON.parse(doc.getControls()),fields=JSON.parse(doc.getFieldList());check(Array.isArray(model.lists)&&Array.isArray(controls)&&Array.isArray(fields),'CELL_ANCHOR');
  const texts:string[]=[], positions:Array<{page:number;y:number;h:number}>=[];
  for(const [col,cell]of cells.entries()){
    check(cell&&Array.isArray(cell.path)&&cell.path.length===1&&validIndex(cell.length)&&cell.length>0&&cell.length<=300&&/^[a-f0-9]{64}$/u.test(cell.sha256),'CELL_ANCHOR');
    const hop=cell.path[0];check(hop&&JSON.stringify(Object.keys(hop).sort())===JSON.stringify(['cellIndex','cellParaIndex','controlIndex'])&&validIndex(hop.controlIndex)&&validIndex(hop.cellIndex)&&hop.cellParaIndex===0,'CELL_ANCHOR');
    check(hop.controlIndex===cells[0].path[0].controlIndex&&(col===0||hop.cellIndex!==cells[0].path[0].cellIndex),'CELL_ANCHOR');
    const dimensions=JSON.parse(doc.getTableDimensions(anchor.section,anchor.paragraph,hop.controlIndex));check(dimensions.rowCount===1&&dimensions.colCount===2&&dimensions.cellCount===2,'CELL_ANCHOR');
    const lists=model.lists.filter((list:Record<string,unknown>)=>list.isCell===true&&list.sectionIndex===anchor.section&&list.hostPara===anchor.paragraph&&list.controlIndex===hop.controlIndex&&list.cellIndex===hop.cellIndex);
    // Cursor model keeps the cross-section body as root list 0, not in lists[].
    check(lists.length===1,'CELL_ANCHOR');const list=lists[0];check(list.hostListId===0&&list.paraCount===1&&list.row===0&&list.col===col&&list.rowSpan===1&&list.colSpan===1&&list.cellCount===2&&!controls.some((control:Record<string,unknown>)=>control.list===list.listId)&&!fields.some((field:Record<string,unknown>)=>field.listId===list.listId),'CELL_ANCHOR');
    const path=JSON.stringify(cell.path), info=JSON.parse(doc.getCellInfoByPath(anchor.section,anchor.paragraph,path));check(info.row===0&&info.col===col&&info.rowSpan===1&&info.colSpan===1&&doc.getCellParagraphCountByPath(anchor.section,anchor.paragraph,path)===1&&doc.getCellParagraphLengthByPath(anchor.section,anchor.paragraph,path)===cell.length,'CELL_ANCHOR');
    const text=doc.getTextInCellByPath(anchor.section,anchor.paragraph,path,0,cell.length);check([...text].length===cell.length,'CELL_ANCHOR');texts.push(text);
    for(const [offset,char]of [...text].entries()){
      const hits=pages.flatMap((runs,page)=>runs.filter(run=>run.secIdx===anchor.section&&run.parentParaIdx===anchor.paragraph&&JSON.stringify(run.cellPath)===path&&validIndex(run.charStart!)&&run.charStart!<=offset&&run.charStart!+[...run.text].length>offset).map(run=>({page,y:run.y,h:run.h,char:[...run.text][offset-run.charStart!]})));
      check(hits.length===1&&hits[0].char===char,'CELL_ANCHOR');const {char:_char,...position}=hits[0];positions.push(position);
    }
  }
  check(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\.$/u.test(texts[0].trim())&&texts[1].trim()&&positions.every(position=>JSON.stringify(position)===JSON.stringify(positions[0])),'CELL_ANCHOR');
  return {texts,page:positions[0].page};
};
const verifyAnchorText=async(doc:TocDocument,entry:ConfirmedNativeTocNumber,pages:Run[][],archive:Record<string,Uint8Array>)=>{
  if(!entry.anchor.cells){check(await shaText(paragraph(doc,entry.anchor))===entry.anchor.paragraphSha256);return;}
  const {texts}=cellAnchorData(doc,entry.anchor,pages,archive);
  for(const [index,text]of texts.entries())check(await shaText(text)===entry.anchor.cells[index].sha256,'CELL_ANCHOR');
  check(await shaText(JSON.stringify(texts))===entry.anchor.paragraphSha256&&normalTitle(texts.join(' '))===normalTitle(tocNumber(paragraph(doc,entry))?.[1]??''),'CELL_ANCHOR');
};
const anchorPage = (doc: TocDocument, entry: ConfirmedNativeTocNumber, pages: Run[][],archive:Record<string,Uint8Array>) => {
  if(entry.anchor.cells){const {page}=cellAnchorData(doc,entry.anchor,pages,archive);check(page+1===entry.anchor.physicalPage,'CELL_ANCHOR');const info=JSON.parse(doc.getPageInfo(page));check(info.sectionIndex===entry.anchor.section&&printedNumber(info.pageNumber)&&info.pageNumber===entry.anchor.printedPage,'CELL_ANCHOR');return info.pageNumber as number;}
  const position = JSON.parse(doc.getPageOfPosition(entry.anchor.section, entry.anchor.paragraph));
  check(position.ok === true); const page = position.page;
  check(validIndex(page) && page < pages.length && page + 1 === entry.anchor.physicalPage);
  const starts = pages.flatMap((runs, index) => runs.filter(run => bodyRun(run) && run.secIdx === entry.anchor.section && run.paraIdx === entry.anchor.paragraph && run.charStart === 0).map(run => ({run, index})));
  check(starts.length === 1 && starts[0].index === page);
  const text = [...paragraph(doc, entry.anchor)];
  check(starts[0].run.text.length > 0 && starts[0].run.text === text.slice(0, [...starts[0].run.text].length).join(''));
  const info = JSON.parse(doc.getPageInfo(page));
  // pageIndex can be section-local. Never equate it with the global index.
  check(info.sectionIndex === entry.anchor.section && printedNumber(info.pageNumber) && info.pageNumber === entry.anchor.printedPage);
  return info.pageNumber as number;
};
const svgNonText = async (doc: TocDocument) => {
  const hashes: string[] = []; check(typeof doc.renderPageSvgWithProfile === 'function');
  for (let page=0;page<doc.pageCount();page++) {
    const svg=doc.renderPageSvgWithProfile!(page,'print'); check(svg.includes('<svg'));
    // Only inter-tag whitespace is normalized; shape/clip/image values are not.
    // Keep hashes, not a second complete copy of every embedded photograph.
    hashes.push(await shaText(svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/gu,'').replace(/>\s+</gu,'><')));
  }
  return hashes;
};
const geometry = (pages: Run[][], targets: Map<string, {offset: number;oldLength:number;newText:string}>,changed=false) => pages.map(runs => runs.flatMap<unknown>(run => {
  const target = bodyRun(run) ? targets.get(`${run.secIdx}:${run.paraIdx}`) : undefined;
  if (!target) return [{run}];
  check(Array.isArray(run.charX) && run.charX.length === [...run.text].length + 1);
  const {text, charX, x, w: _width, charStart, ...style} = run;
  const length=changed?target.newText.length:target.oldLength;
  return [...text].flatMap((char,index)=>{const offset=charStart!+index;if(offset>=target.offset&&offset<target.offset+length)return [];if(offset>=target.offset+length){check(char===' ');return [{glyph:char,offset:offset-length+target.oldLength,style}];}return [{glyph:char,offset,x:x+charX[index],style}];});
}));
const exportBytes = (doc: TocDocument, format: 'hwp' | 'hwpx') => {
  const result = format === 'hwp' ? doc.exportHwpWithReport() : doc.exportHwpxWithReport();
  try {const report = JSON.parse(result.contentLoss()); check(report.schemaVersion === 1 && report.count === 0 && Array.isArray(report.losses) && !report.losses.length && report.outputFormat?.toLowerCase() === format); const bytes = result.takeBytes(); check(bytes instanceof Uint8Array && bytes.length); return new Uint8Array(bytes);} finally {result.free();}
};
const outerElements = (xml: string,tag:'p'|'tbl'|'tc') => {
  const result: Array<{start: number; end: number; xml: string}> = []; let depth = 0, start = 0;
  for (const match of xml.matchAll(new RegExp(`<(\\/?)hp:${tag}(?:\\s[^>]*|)>`,'gu'))) {
    if(!match[1]&&/\/>$/u.test(match[0])){if(depth===0)result.push({start:match.index!,end:match.index!+match[0].length,xml:match[0]});continue;}
    if (!match[1]) {if (depth++ === 0) start = match.index!;}
    else {check(depth > 0); if (--depth === 0) result.push({start, end: match.index! + match[0].length, xml: xml.slice(start, match.index! + match[0].length)});}
  }
  check(depth === 0); return result;
};
const outerParagraphs=(xml:string)=>outerElements(xml,'p');
const verifyLiteralCellXml=(doc:TocDocument,anchor:NativeTocAnchor,archive:Record<string,Uint8Array>)=>{
  const section=archive[`Contents/section${anchor.section}.xml`];check(section,'CELL_ANCHOR');
  const hosts=outerParagraphs(strFromU8(section));check(hosts.length===doc.getParagraphCount(anchor.section)&&hosts[anchor.paragraph],'CELL_ANCHOR');
  const tables=outerElements(hosts[anchor.paragraph].xml,'tbl');check(tables.length===1,'CELL_ANCHOR');
  const cells=outerElements(tables[0].xml,'tc');check(cells.length===2,'CELL_ANCHOR');
  for(let col=0;col<2;col++){
    const matches=cells.filter(cell=>{const addresses=[...cell.xml.matchAll(/<hp:cellAddr\b[^>]*\/>/gu)];return addresses.length===1&&/\browAddr="0"/u.test(addresses[0][0])&&new RegExp(`\\bcolAddr="${col}"`,'u').test(addresses[0][0]);});
    check(matches.length===1&&outerParagraphs(matches[0].xml).length===1,'CELL_ANCHOR');
    // getControls can omit child controls after a section boundary. Check the
    // canonical selected cell too: no fields, generated numbers or pictures.
    check([...matches[0].xml.matchAll(/<\/?hp:([A-Za-z][\w]*)\b/gu)].every(match=>['tc','subList','p','run','t','linesegarray','lineseg','cellAddr','cellSpan','cellSz','cellMargin'].includes(match[1])),'CELL_ANCHOR');
  }
};
const paragraphStructure = (xml: string) => xml.replace(/<hp:linesegarray\b[^>]*>[\s\S]*?<\/hp:linesegarray>/gu, '').replace(/(<hp:t(?:\s[^>]*)?>)([\s\S]*?)(<\/hp:t>)/gu,(_match,open:string,inner:string,close:string)=>open+inner.replace(/(^|>)[^<]*/gu,'$1')+close).replace(/<\/?hp:run(?:\s[^>]*)?>/gu, '');
const verifyArchive = (left: Record<string,Uint8Array>, right: Record<string,Uint8Array>, targets: Map<string, {offset: number}>) => {
  check(JSON.stringify(Object.keys(left).sort()) === JSON.stringify(Object.keys(right).sort()));
  for (const path of Object.keys(left)) {
    if (/^Preview\/(?:PrvText\.txt|PrvImage\.png)$/u.test(path)) continue; // Derived preview, not manuscript/BinData.
    const section = /^Contents\/section(\d+)\.xml$/u.exec(path);
    if (!section || ![...targets.keys()].some(key => key.startsWith(`${Number(section[1])}:`))) {check(left[path].length === right[path].length && left[path].every((byte, index) => byte === right[path][index])); continue;}
    const a = strFromU8(left[path]), b = strFromU8(right[path]), ap = outerParagraphs(a), bp = outerParagraphs(b); check(ap.length === bp.length);
    let aOutside = a, bOutside = b;
    for (let index = ap.length - 1; index >= 0; index--) if (targets.has(`${Number(section[1])}:${index}`)) {
      check(paragraphStructure(ap[index].xml) === paragraphStructure(bp[index].xml));
      aOutside = aOutside.slice(0, ap[index].start) + '<TARGET/>' + aOutside.slice(ap[index].end);
      bOutside = bOutside.slice(0, bp[index].start) + '<TARGET/>' + bOutside.slice(bp[index].end);
    }
    check(aOutside === bOutside);
  }
};

/** Candidate only. Caller must obtain explicit confirmation and use the existing
 * same-source/case apply→upload→acknowledged-save path, never mutate on export. */
export async function refreshConfirmedNativeTocNumbers(bytes: Uint8Array, format: 'hwp' | 'hwpx', sourceSha256: string, confirmed: readonly ConfirmedNativeTocNumber[], Engine: NativeHwpEngine) {
  const original = new Uint8Array(bytes), entries = structuredClone(confirmed);
  check(/^[a-f0-9]{64}$/u.test(sourceSha256) && await reportSourceSha256(original.buffer) === sourceSha256 && ['hwp', 'hwpx'].includes(format) && Array.isArray(entries) && entries.length > 0 && entries.length <= 100);
  const doc = new Engine(original) as TocDocument; let reopened: TocDocument | undefined, second: TocDocument | undefined;
  try {
    for (const method of ['getSourceFormat','getSectionCount','getParagraphCount','getParagraphLength','getTextRange','getCharShapeRuns','getParaPropertiesAt','getControlTextPositions','getFieldList','getControls','getPageOfPosition','getPageInfo','getPageTextLayout','replaceText','setCharShapeId','exportHwpWithReport','exportHwpxWithReport']) check(typeof (doc as unknown as Record<string,unknown>)[method] === 'function');
    check(doc.getSourceFormat()===format,'FORMAT');
    const pages = layout(doc), nonText = await svgNonText(doc), beforeArchive = unzipSync(exportBytes(doc,'hwpx')), controls = doc.getControls(), fields = doc.getFieldList();
    const targets = new Map<string, {offset: number;oldLength:number;newText:string;expected: string; styles: number[]; props: string}>();
    const changes: Array<{section: number; paragraph: number; offset: number; oldText: string; newText: string; physicalPage: number; printedPage: number}> = [];
    for (const entry of entries) {
      check(entry && entry.anchor && typeof entry.oldText === 'string');
      const text = paragraph(doc, entry), chars = [...text], id = key(entry);
      check(!targets.has(id) && validIndex(entry.offset) && /^[0-9]{1,9}$/u.test(entry.oldText) && validIndex(entry.decimalDigits) && entry.decimalDigits >= 1 && entry.decimalDigits <= 9);
      check(await shaText(text)===entry.paragraphSha256);await verifyAnchorText(doc,entry,pages,beforeArchive);
      const end=entry.offset+entry.oldText.length,suffix=chars.slice(end).join('');
      check(end<=chars.length&&/^ *$/u.test(suffix)&&chars.slice(entry.offset,end).join('')===entry.oldText&&Number(entry.oldText).toString().padStart(entry.decimalDigits,'0')===entry.oldText);
      check(numberLocation(pages,entry,entry.oldText).page+1===entry.tocPhysicalPage,'NUMBER_LOCATION');
      const positions = JSON.parse(doc.getControlTextPositions(entry.section, entry.paragraph)); check(Array.isArray(positions) && positions.length === 0);
      const sectionXml = strFromU8(beforeArchive[`Contents/section${entry.section}.xml`]), paragraphs = outerParagraphs(sectionXml);
      check(paragraphs.length === doc.getParagraphCount(entry.section) && paragraphs[entry.paragraph]);
      // getFieldInfoAt only recognizes ClickHere. The serialized paragraph must
      // also contain no fields/controls or unsupported inline elements.
      check([...paragraphs[entry.paragraph].xml.matchAll(/<\/?hp:([A-Za-z][\w]*)\b/gu)].every(match => ['p','run','t','tab','linesegarray','lineseg'].includes(match[1])));
      const styles = shapes(doc, entry, chars.length), digitStyle = styles[entry.offset]; check(styles.slice(entry.offset,end).every(style => style === digitStyle));
      const printedPage = anchorPage(doc, entry, pages,beforeArchive), newText = String(printedPage).padStart(entry.decimalDigits, '0');
      targets.set(id,{offset:entry.offset,oldLength:entry.oldText.length,newText,expected:chars.slice(0,entry.offset).join('')+newText+suffix,styles:[...styles.slice(0,entry.offset),...Array(newText.length).fill(digitStyle),...styles.slice(end)],props:doc.getParaPropertiesAt(entry.section,entry.paragraph)});
      if (newText !== entry.oldText) changes.push({section: entry.section, paragraph: entry.paragraph, offset: entry.offset, oldText: entry.oldText, newText, physicalPage: entry.anchor.physicalPage, printedPage});
    }
    if (!changes.length) return {bytes: original, changes};
    for (const change of changes) {
      check(JSON.parse(doc.replaceText(change.section, change.paragraph, change.offset, change.oldText.length, change.newText)).ok === true);
      check(JSON.parse(doc.setCharShapeId(change.section, change.paragraph, change.offset, change.offset + change.newText.length, targets.get(key(change))!.styles[change.offset])).ok === true);
    }
    const verify = async (current: TocDocument) => {
      check(current.getSourceFormat()===format,'FORMAT');
      const currentPages = layout(current),currentArchive=unzipSync(exportBytes(current,'hwpx')); check(currentPages.length === pages.length && current.getControls() === controls && current.getFieldList() === fields);
      for (const entry of entries) {
        const target = targets.get(key(entry))!; check(paragraph(current, entry) === target.expected && JSON.stringify(shapes(current, entry, [...target.expected].length)) === JSON.stringify(target.styles) && current.getParaPropertiesAt(entry.section, entry.paragraph) === target.props);
        await verifyAnchorText(current,entry,currentPages,currentArchive);anchorPage(current,entry,currentPages,currentArchive);
        check(JSON.stringify(numberLocation(currentPages,entry,target.newText))===JSON.stringify(numberLocation(pages,entry,entry.oldText)),'NUMBER_LOCATION');
      }
      check(JSON.stringify(geometry(currentPages,targets,true))===JSON.stringify(geometry(pages,targets)), 'TEXT_GEOMETRY');
      check(JSON.stringify(await svgNonText(current)) === JSON.stringify(nonText), 'PAGE_GRAPHICS');
      verifyArchive(beforeArchive,currentArchive,targets);
    };
    await verify(doc);
    const candidate = exportBytes(doc, format); reopened = new Engine(candidate) as TocDocument; await verify(reopened);
    for (let page = 0; page < pages.length; page++) check(doc.renderPageSvgWithProfile!(page, 'print') === reopened.renderPageSvgWithProfile!(page, 'print'));
    second = new Engine(exportBytes(reopened,format)) as TocDocument; await verify(second);
    for (let page = 0; page < pages.length; page++) check(reopened.renderPageSvgWithProfile!(page, 'print') === second.renderPageSvgWithProfile!(page, 'print'));
    return {bytes: candidate, changes};
  } finally {second?.free(); reopened?.free(); doc.free();}
}

/** User supplies physical TOC pages (cover included), never printed folios. */
export function parseNativeTocPages(value: string, count: number): number[] {
  check(Number.isSafeInteger(count) && count > 0 && count <= 5000 && typeof value === 'string' && value.length <= 200, 'TOC_PAGES');
  const pages = new Set<number>();
  for (const token of value.split(',')) {
    const match = /^\s*(\d{1,4})(?:\s*-\s*(\d{1,4}))?\s*$/u.exec(token); check(match,'TOC_PAGES');
    const start=Number(match[1]), end=Number(match[2]??match[1]); check(start>=1 && start<=end && end<=count && end-start<100,'TOC_PAGES');
    for(let page=start;page<=end;page++) pages.add(page);
  }
  check(pages.size>0 && pages.size<=100 && pages.size<count,'TOC_PAGES'); return [...pages].sort((a,b)=>a-b);
}
export interface NativeTocCandidate extends ConfirmedNativeTocNumber {title: string; newText: string}
export type NativeTocExcludedReason='NO_PAGE_NUMBER'|'TITLE_NOT_FOUND'|'TITLE_AMBIGUOUS'|'TARGET_CONTROL'|'PAGE_UNCONFIRMED'|'STYLE_UNCONFIRMED';
export interface NativeTocExcludedRow {physicalPage:number;section:number;paragraph:number;title:string;reason:NativeTocExcludedReason}
/** Read-only proposals, not a semantic/fuzzy TOC generator. Titles must match a
 * unique literal body paragraph outside the explicitly selected TOC pages.
 * User must separately confirm Arabic printed folios before applying. */
export async function inspectNativeTocNumbers(bytes: Uint8Array, format: 'hwp'|'hwpx', tocPages: readonly number[], Engine: NativeHwpEngine) {
  const original=new Uint8Array(bytes), selected=new Set(tocPages); check(['hwp','hwpx'].includes(format),'FORMAT');
  const doc=new Engine(original) as TocDocument;
  try {
    check(typeof doc.getSourceFormat==='function' && doc.getSourceFormat()===format,'FORMAT');
    check(selected.size>0 && selected.size<=100 && selected.size<doc.pageCount() && [...selected].every(page=>Number.isSafeInteger(page)&&page>=1&&page<=doc.pageCount()),'TOC_PAGES');
    const records:Array<{section:number;paragraph:number;text:string;page:number}>=[];
    const normal=(text:string)=>text.trim().replace(/\s+/gu,' ');
    let scanned=0;
    for(let section=0;section<doc.getSectionCount();section++) for(let index=0;index<doc.getParagraphCount(section);index++) {
      check(++scanned<=50_000,'DOCUMENT_LIMIT');
      const text=paragraph(doc,{section,paragraph:index});
      // Real originals include unrendered empty paragraphs. They are neither
      // title anchors nor TOC rows, and the engine has no physical page for them.
      if(!normal(text))continue;
      let position:{ok?:boolean;page:number};try{position=JSON.parse(doc.getPageOfPosition(section,index));}catch{throw reject('POSITION');}
      check(position.ok===true && validIndex(position.page) && position.page<doc.pageCount());
      records.push({section,paragraph:index,text,page:position.page+1});
    }
    const xml=unzipSync(exportBytes(doc,'hwpx')),pages=layout(doc),candidates:NativeTocCandidate[]=[],excluded:NativeTocExcludedRow[]=[];
    type AnchorRecord=typeof records[number]&{cells?:[CellProof,CellProof];unverified?:true};
    const body=new Map<string,AnchorRecord[]>();
    const addAnchor=(title:string,row:AnchorRecord)=>body.set(title,[...(body.get(title)??[]),row]);
    for(const row of records)if(!selected.has(row.page)&&normal(row.text))addAnchor(normal(row.text),row);
    // Only the source-proven 1x2 Roman/title heading shape. This reads cells;
    // targets, mutation APIs and the archive/geometry guards stay body-only.
    const model=JSON.parse(doc.getCursorModel());check(Array.isArray(model.lists)&&model.lists.length<=50_000,'DOCUMENT_LIMIT');
    const pairs=new Map<string,Array<Record<string,number|boolean>>>();
    for(const list of model.lists)if(list.isCell===true&&list.hostListId===0&&list.paraCount===1&&list.cellCount===2&&list.row===0&&[0,1].includes(list.col)&&list.rowSpan===1&&list.colSpan===1){
      const id=JSON.stringify([list.sectionIndex,list.hostPara,list.controlIndex]);pairs.set(id,[...(pairs.get(id)??[]),list]);
    }
    for(const lists of pairs.values()){
      if(lists.length!==2)continue;lists.sort((a,b)=>Number(a.col)-Number(b.col));const first=lists[0],section=Number(first.sectionIndex),index=Number(first.hostPara),control=Number(first.controlIndex);
      const proofs:CellProof[]=[],texts:string[]=[];
      // Read before the tighter glyph-proof cap. An oversized/unreadable cell
      // cannot silently disappear and make another title look unique.
      for(const list of lists){const path:CellPath=[{controlIndex:control,cellIndex:Number(list.cellIndex),cellParaIndex:0}],encoded=JSON.stringify(path),length=doc.getCellParagraphLengthByPath(section,index,encoded);check(validIndex(length)&&length<=100_000,'DOCUMENT_LIMIT');const text=doc.getTextInCellByPath(section,index,encoded,0,length);check([...text].length===length,'CELL_READ');texts.push(text);proofs.push({path,length,sha256:await shaText(text)});}
      if(!/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\.$/u.test(texts[0].trim())||!texts[1].trim())continue;
      const cells=proofs as [CellProof,CellProof],title=normal(texts.join(' ')),known:AnchorRecord={section,paragraph:index,text:JSON.stringify(texts),page:0,cells};
      try{
        const anchor:NativeTocAnchor={section,paragraph:index,paragraphSha256:await shaText(JSON.stringify(texts)),physicalPage:0,printedPage:0,cells};
        const located=cellAnchorData(doc,anchor,pages,xml);if(selected.has(located.page+1))continue;
        addAnchor(title,{...known,page:located.page+1});
      }catch{addAnchor(title,{...known,unverified:true});/* A known duplicate cannot disappear just because its glyph proof failed. */}
    }
    let unchanged=0, rows=0;
    const exclude=(row:typeof records[number],reason:NativeTocExcludedReason,title=row.text)=>{check(excluded.length<100,'TOC_LIMIT');excluded.push({physicalPage:row.page,section:row.section,paragraph:row.paragraph,title:normal(title).slice(0,180),reason});};
    for(const row of records.filter(row=>selected.has(row.page))) {
      // A literal dot leader or tab separates title and numeral. No heading-code stripping.
      const match=tocNumber(row.text);
      if(!match){if(/[.·…]{3,}|\t/u.test(row.text))exclude(row,'NO_PAGE_NUMBER');continue;}
      rows++; if(rows>100) throw reject('TOC_LIMIT');
      const anchors=body.get(normal(match[1]))??[];
      if(anchors.length!==1){exclude(row,anchors.length?'TITLE_AMBIGUOUS':'TITLE_NOT_FOUND',match[1]);continue;}
      const anchor=anchors[0];if(anchor.unverified){exclude(row,'STYLE_UNCONFIRMED',match[1]);continue;}const info=JSON.parse(doc.getPageInfo(anchor.page-1));
      const targetXml=outerParagraphs(strFromU8(xml[`Contents/section${row.section}.xml`]))[row.paragraph]?.xml;
      if(!printedNumber(info.pageNumber)||info.sectionIndex!==anchor.section){exclude(row,'PAGE_UNCONFIRMED',match[1]);continue;}
      const controls=JSON.parse(doc.getControlTextPositions(row.section,row.paragraph));
      if(!targetXml||!Array.isArray(controls)||controls.length||![...targetXml.matchAll(/<\/?hp:([A-Za-z][\w]*)\b/gu)].every(tag=>['p','run','t','tab','linesegarray','lineseg'].includes(tag[1]))){exclude(row,'TARGET_CONTROL',match[1]);continue;}
      const digits=match[2],decimalDigits=digits.startsWith('0')?digits.length:1,offset=[...row.text].length-digits.length-match[3].length;
      const candidate:NativeTocCandidate={section:row.section,paragraph:row.paragraph,offset,oldText:digits,decimalDigits,paragraphSha256:await shaText(row.text),title:normal(match[1]),tocPhysicalPage:row.page,newText:String(info.pageNumber).padStart(decimalDigits,'0'),anchor:{section:anchor.section,paragraph:anchor.paragraph,paragraphSha256:await shaText(anchor.text),physicalPage:anchor.page,printedPage:info.pageNumber,...(anchor.cells?{cells:anchor.cells}:{})}};
      try{await verifyAnchorText(doc,candidate,pages,xml);anchorPage(doc,candidate,pages,xml);candidate.tocPhysicalPage=numberLocation(pages,candidate,digits).page+1;check(selected.has(candidate.tocPhysicalPage));const style=shapes(doc,candidate,[...row.text].length);check(style.slice(offset,offset+digits.length).every(shape=>shape===style[offset]));}catch{exclude(row,'STYLE_UNCONFIRMED',match[1]);continue;}
      if(candidate.newText===digits) unchanged++; else candidates.push(candidate);
    }
    return {sourceSha256:await reportSourceSha256(original.buffer),candidates,unchanged,unsupported:excluded.length,numberRows:rows,inspectedPages:[...selected].sort((a,b)=>a-b),excluded};
  } finally {doc.free();}
}
