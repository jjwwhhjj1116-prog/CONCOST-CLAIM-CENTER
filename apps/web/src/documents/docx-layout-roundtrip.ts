import DOMPurify from 'dompurify';
import {strFromU8,strToU8,unzipSync} from 'fflate';
import {HWP_IMPORT_DATA_ATTRIBUTES,compactHwpTextStyle,compactHwpPageFonts,compactHwpLayout} from './hwp-import-nodes';
import {documentImageData} from './editable-docx-export';

const part='customXml/claim-center-layout.xml';
const namespace='urn:claim-center:editable-page-layout:1';
const wordNamespace='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const wordParts=(files:Record<string,Uint8Array>)=>Object.keys(files).filter(path=>path.startsWith('word/')&&!path.endsWith('/')).sort();
const clean=(html:string)=>DOMPurify.sanitize(html,{ADD_ATTR:[...HWP_IMPORT_DATA_ATTRIBUTES,'style','colwidth','colspan','rowspan','width','height']});

/** Optional editing-layout part, bound to every actual Word part and photo.
 * Word still receives native frames/tables/pictures. A changed Word file must
 * never restore stale web content from this part instead of the changed file. */
export async function captureEditablePageLayout(pages:HTMLElement[],media:Map<string,string>,imagePrefix='/__docx_import_image__/'):Promise<string[]>{
  const html:string[]=[];
  for(const paper of pages){
    const source=paper.matches('[data-hwp-import-page]')?paper:paper.querySelector<HTMLElement>('[data-hwp-import-page]');
    if(!source)throw Error('DOCX 편집 배치의 원본 페이지가 없습니다.');
    const page=source.cloneNode(true) as HTMLElement;
    // The final preview keeps column widths on COL elements. Carry that same
    // grid on cells before removing derived CSS, including merged rows.
    for(const table of page.querySelectorAll<HTMLTableElement>('table')){
      const widths=[...table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col')].map(col=>parseFloat(col.style.width||col.getAttribute('width')||'0'));
      const occupied:boolean[][]=[];
      for(const [r,row]of [...table.rows].entries()){let column=0;
        for(const cell of [...row.cells]){
          while(occupied[r]?.[column])column++;
          const span=cell.colSpan,rows=cell.rowSpan||table.rows.length-r;
          if(!cell.hasAttribute('colwidth')&&widths.slice(column,column+span).length===span&&widths.slice(column,column+span).every(width=>width>0&&Number.isFinite(width)))cell.setAttribute('colwidth',widths.slice(column,column+span).join(','));
          for(let y=r;y<r+rows;y++)for(let x=column;x<column+span;x++){occupied[y]??=[];occupied[y][x]=true;}
          column+=span;
        }
      }
    }
    for(const element of [page,...page.querySelectorAll<HTMLElement>('*')]){
      const align=element.style.textAlign;
      const font=element.tagName==='SPAN'&&!element.hasAttribute('data-hwp-text-style')
        ? ['font-family','font-size','color'].map(name=>[name,element.style.getPropertyValue(name)]).filter(([,value])=>value) : [];
      element.removeAttribute('style');element.removeAttribute('contenteditable');
      if(align&&element.tagName==='P')element.style.textAlign=align;
      for(const [name,value]of font)element.style.setProperty(name,value);
      const layout=element.getAttribute('data-hwp-layout');
      if(layout)element.setAttribute('data-hwp-layout',JSON.stringify(compactHwpLayout(JSON.parse(layout))));
      const textStyle=element.getAttribute('data-hwp-text-style');
      if(textStyle){const value=JSON.parse(textStyle);if(value&&typeof value==='object'&&!Array.isArray(value))element.setAttribute('data-hwp-text-style',JSON.stringify(compactHwpTextStyle(value)));}
      if(element.hasAttribute('data-hwp-import-rule'))element.replaceChildren();
    }
    const originals=[...source.querySelectorAll<HTMLImageElement>('img:not(.ProseMirror-separator)')],copies=[...page.querySelectorAll('img:not(.ProseMirror-separator)')];
    page.querySelectorAll('.ProseMirror-separator,.ProseMirror-trailingBreak').forEach(node=>node.remove());
    for(const [i,image]of originals.entries()){
      const {bytes}=await documentImageData(image),path=media.get(await digest(bytes));
      if(!path)throw Error('DOCX의 실제 사진과 편집 배치가 일치하지 않습니다.');
      copies[i].setAttribute('src',imagePrefix+path);
    }
    compactHwpPageFonts(page);html.push(clean(page.outerHTML));
  }
  return html;
}

export async function embedDocxLayout(files:Record<string,Uint8Array>,pages:HTMLElement[]):Promise<void>{
  const media=new Map<string,string>();
  for(const path of wordParts(files).filter(path=>path.startsWith('word/media/')))media.set(await digest(files[path]),path);
  const html=await captureEditablePageLayout(pages,media);
  // Bind the layout itself back into the native Word body using standard
  // empty bookmarks, without adding visible report content.
  const layoutHash=await digest(strToU8(JSON.stringify(html))),document=new DOMParser().parseFromString(strFromU8(files['word/document.xml']),'application/xml');
  const paragraph=document.getElementsByTagNameNS(wordNamespace,'p')[0];if(!paragraph)throw Error('DOCX 본문 문단이 없습니다.');
  let bookmarkId=Math.max(0,...[...document.getElementsByTagNameNS(wordNamespace,'bookmarkStart')].map(node=>Number(node.getAttributeNS(wordNamespace,'id'))||0))+1;
  const reference=[...paragraph.children].find(node=>node.localName!=='pPr')??null;
  for(const [index,prefix]of ['CCLA_','CCLB_'].entries()){
    const start=document.createElementNS(wordNamespace,'w:bookmarkStart'),end=document.createElementNS(wordNamespace,'w:bookmarkEnd');
    start.setAttributeNS(wordNamespace,'w:id',String(bookmarkId));end.setAttributeNS(wordNamespace,'w:id',String(bookmarkId++));start.setAttributeNS(wordNamespace,'w:name',prefix+layoutHash.slice(index*32,index*32+32));paragraph.insertBefore(start,reference);paragraph.insertBefore(end,reference);
  }
  files['word/document.xml']=strToU8(new XMLSerializer().serializeToString(document));
  const relPath='word/_rels/document.xml.rels',relationships=new DOMParser().parseFromString(strFromU8(files[relPath]),'application/xml');
  const relation=relationships.createElementNS(relationships.documentElement.namespaceURI,'Relationship');
  relation.setAttribute('Id','claimCenterEditableLayout');relation.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml');relation.setAttribute('Target','../'+part);
  relationships.documentElement.append(relation);files[relPath]=strToU8(new XMLSerializer().serializeToString(relationships));
  const bound=await Promise.all(wordParts(files).map(async path=>({path,sha256:await digest(files[path])})));
  const payload=JSON.stringify({version:1,bound,pages:html});
  if(payload.length>2_000_000)throw Error('DOCX 편집 배치가 저장 한도를 넘었습니다.');
  files[part]=strToU8(`<layout xmlns="${namespace}">${payload.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</layout>`);
}

export async function readDocxLayout(bytes:Uint8Array):Promise<{reportContent:string;images:Array<{source:string;file:File}>}|null>{
  let total=0;
  const files=unzipSync(bytes,{filter:entry=>{const wanted=entry.name===part||entry.name.startsWith('word/');if(wanted){total+=entry.originalSize;if(entry.originalSize>20_000_000||total>60_000_000)throw Error('Word 편집 자료가 너무 큽니다. 기존 보고서는 유지됩니다.');}return wanted;}});
  if(!files[part])return null;
  const invalid=():never=>{throw Error('Word 파일의 실제 본문·사진이 내보낸 편집 배치와 달라졌습니다. 이전 웹 내용을 덮어쓰지 않도록 가져오기를 중단했습니다. 기존 보고서는 유지됩니다.');};
  const xml=new DOMParser().parseFromString(strFromU8(files[part]),'application/xml');
  if(xml.getElementsByTagName('parsererror').length||xml.documentElement.namespaceURI!==namespace)invalid();
  let value:{version:number;bound:Array<{path:string;sha256:string}>;pages:string[]};
  try{value=JSON.parse(xml.documentElement.textContent||'');}catch{return invalid();}
  if(value.version!==1||!Array.isArray(value.bound)||!Array.isArray(value.pages)||!value.pages.length||value.pages.length>60||value.pages.some(page=>typeof page!=='string')||JSON.stringify(value.bound.map(item=>item.path))!==JSON.stringify(wordParts(files)))invalid();
  for(const entry of value.bound)if(!/^[0-9a-f]{64}$/u.test(entry.sha256)||await digest(files[entry.path])!==entry.sha256)invalid();
  const body=new DOMParser().parseFromString(strFromU8(files['word/document.xml']),'application/xml'),layoutHash=await digest(strToU8(JSON.stringify(value.pages)));
  const bookmarks=[...body.getElementsByTagNameNS(wordNamespace,'bookmarkStart')].map(node=>node.getAttributeNS(wordNamespace,'name'));
  if(!bookmarks.includes('CCLA_'+layoutHash.slice(0,32))||!bookmarks.includes('CCLB_'+layoutHash.slice(32)))invalid();
  const document=new DOMParser().parseFromString(clean(value.pages.join('')),'text/html');
  if(document.body.children.length!==value.pages.length||[...document.body.children].some(page=>!page.hasAttribute('data-hwp-import-page')))invalid();
  const visible=(text:string)=>text.replace(/[\s\u200b\ufeff]/gu,'');
  if(visible([...body.getElementsByTagNameNS(wordNamespace,'t')].map(node=>node.textContent||'').join(''))!==visible(document.body.textContent||''))invalid();
  const images:Array<{source:string;file:File}>=[],seen=new Set<string>();
  for(const image of document.querySelectorAll('img')){
    const source=image.getAttribute('src')||'',path=source.slice('/__docx_import_image__/'.length),data=files[path];
    if(!source.startsWith('/__docx_import_image__/')||!/^word\/media\/[^/\\?#]+$/u.test(path)||!data)invalid();
    const mime=data[0]===137&&data[1]===80?'image/png':data[0]===255&&data[1]===216?'image/jpeg':null;
    if(!mime)invalid();
    if(!seen.has(source)){const file=new File([new Uint8Array(data)],path.split('/').at(-1)!,{type:mime!});const bitmap=await createImageBitmap(file);bitmap.close();images.push({source,file});seen.add(source);}
  }
  return{reportContent:document.body.innerHTML,images};
}
