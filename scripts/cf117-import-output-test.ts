import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { reportStudioWorkbook, readReportStudioWorkbook } from '../apps/web/src/proposals/proposal-excel';

const appRequire = createRequire(resolve('apps/web/package.json'));
const { zipSync, unzipSync, strToU8, strFromU8 } = appRequire('fflate');

test('CF117 DOCX preserves ordinary first paragraphs and styled titles, and refuses lossy automatic-list imports', async t => {
  const { Document, Packer, Paragraph, HeadingLevel, AlignmentType, ImageRun, Table, TableRow, TableCell } = appRequire('docx');
  const firstParagraph = '첫 본문입니다. ' + '원도면과 검토 근거를 보존한다. '.repeat(30) + '첫 문단 마지막 근거';
  const ordinary = await Packer.toArrayBuffer(new Document({ sections: [{ children: [new Paragraph(firstParagraph), new Paragraph('두 번째 본문도 보존한다.')] }] }));
  const titled = await Packer.toArrayBuffer(new Document({ sections: [{ children: [new Paragraph({ text: '정식 문서 제목', heading: HeadingLevel.TITLE }), new Paragraph('제목 다음의 첫 본문'), new Paragraph('마지막 본문')] }] }));
  const numbered = await Packer.toArrayBuffer(new Document({ numbering: { config: [{ reference: 'cf117', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }] }] }, sections: [{ children: [new Paragraph({ text: '합성 보고서', heading: HeadingLevel.TITLE }), new Paragraph({ text: '첫 번째 근거', numbering: { reference: 'cf117', level: 0 } }), new Paragraph({ text: '두 번째 근거', numbering: { reference: 'cf117', level: 0 } })] }] }));
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' } as any);
  await server.listen();
  const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(path => path && existsSync(path));
  assert.ok(executablePath, 'An isolated Chrome/Chromium executable is required.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/cf117-import-test.html') return route.fulfill({ contentType: 'text/html', body: await server.transformIndexHtml(url.pathname,'<!doctype html><html><head><meta charset="utf-8"></head><body>CF117 isolated import regression</body></html>') });
      return route.continue();
    });
    await page.goto(`${origin}/cf117-import-test.html`);
    const results = await page.evaluate(async payload => {
      const modulePath = '/src/proposals/proposal-excel.ts';
      const { readReportDocx } = await import(modulePath);
      return Promise.all(payload.map(async ({ name, bytes }) => {
        try { return { value: await readReportDocx(new File([new Uint8Array(bytes)], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })), error: '' }; }
        catch (error) { return { value: null, error: error instanceof Error ? error.message : String(error) }; }
      }));
    }, [{ name: '첫본문.docx', bytes: Array.from(new Uint8Array(ordinary)) }, { name: '제목.docx', bytes: Array.from(new Uint8Array(titled)) }, { name: '자동번호.docx', bytes: Array.from(new Uint8Array(numbered)) }]);
    const [bodyResult, titleResult, listResult] = results;
    assert.ok(bodyResult.value, bodyResult.error);
    assert.ok(bodyResult.value.reportContent.includes(firstParagraph), 'An unstyled first body paragraph, including the text after character 300, must not be removed or truncated.');
    assert.ok(bodyResult.value.reportContent.includes('두 번째 본문도 보존한다.'));
    assert.equal(bodyResult.value.reportTitle, '첫본문');
    assert.ok(titleResult.value, titleResult.error);
    assert.equal(titleResult.value.reportTitle, '정식 문서 제목');
    assert.ok(titleResult.value.reportContent.includes('제목 다음의 첫 본문'));
    assert.ok(titleResult.value.reportContent.includes('마지막 본문'));
    assert.ok(!titleResult.value.reportContent.includes('정식 문서 제목'));
    assert.equal(listResult.value, null, 'A numbered document must not return a stripped body that replaces the report.');
    assert.match(listResult.error, /자동 번호·글머리표/u);
    assert.match(listResult.error, /기존 보고서는 유지됩니다/u);
    assert.match(listResult.error, /일반 텍스트/u);
    const pictureData=await page.evaluate(()=>['image/png','image/jpeg'].map(type=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=6;canvas.getContext('2d')!.fillRect(0,0,8,6);return canvas.toDataURL(type).split(',')[1];}));
    const pictures=pictureData.map((value:string)=>Buffer.from(value,'base64'));
    const image=(index:number,width:number,height:number)=>new ImageRun({data:pictures[index],type:index?'jpg':'png',transformation:{width,height}});
    const photoDocx=new Uint8Array(await Packer.toArrayBuffer(new Document({sections:[{children:[
      new Paragraph({heading:HeadingLevel.TITLE,children:[image(0,80,60),new (appRequire('docx').TextRun)('그림을 포함한 첫 제목')]}),
      new Paragraph('사진 앞 본문'),new Paragraph({children:[image(1,120,90)]}),
      new Table({rows:[new TableRow({children:[new TableCell({children:[new Paragraph('0 / 123.45 / 246.9')]}),new TableCell({children:[new Paragraph({children:[image(0,40,30)]})]})]}),new TableRow({children:[new TableCell({children:[new Paragraph('')]}),new TableCell({children:[new Paragraph('')]})]})]}),
      new Paragraph('사진 뒤 본문')
    ]}]})));
    const parts=unzipSync(photoDocx), source=strFromU8(parts['word/document.xml']);
    const variants=[{name:'사진.docx',bytes:Array.from(photoDocx)}];
    for(const [name,changed] of [
      ['떠있는그림',source.replaceAll('wp:inline','wp:anchor')],
      ['회전그림',source.replace('<a:xfrm>','<a:xfrm rot="60000">')],
      ['잘라낸그림',source.replace(/<a:stretch>/u,'<a:srcRect l="5000"/><a:stretch>')]
    ]){assert.notEqual(changed,source);variants.push({name:name+'.docx',bytes:Array.from(zipSync({...parts,'word/document.xml':strToU8(changed)}))});}
    for(const type of ['nextPage','continuous','evenPage']){
      const sectionXml=`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>첫 구역</w:t></w:r><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr></w:p><w:p><w:r><w:t>둘째 구역</w:t></w:r></w:p><w:sectPr><w:type w:val="${type}"/></w:sectPr></w:body></w:document>`;
      variants.push({name:type+'.docx',bytes:Array.from(zipSync({...parts,'word/document.xml':strToU8(sectionXml)}))});
    }
    const imageResults=await page.evaluate(async payload=>{
      const {readReportDocx}=await import('/src/proposals/proposal-excel.ts');
      const {parseStructuredDocumentMarkdown}=await import('/src/documents/StructuredDocumentEditor.tsx');
      return Promise.all(payload.map(async ({name,bytes})=>{
        try{
          const value=await readReportDocx(new File([new Uint8Array(bytes)],name));
          const dom=new DOMParser().parseFromString(value.reportContent,'text/html');
          const placements=[...dom.querySelectorAll('img')].map(img=>[img.getAttribute('src'),Number(img.getAttribute('width')),Number(img.getAttribute('height'))]);
          value.images?.forEach((image:{source:string;file:File},i:number)=>[...dom.querySelectorAll('img')].filter(img=>img.getAttribute('src')===image.source).forEach(img=>img.src='/api/cases/evidence/cf117-'+i+'/download'));
          const parsed=parseStructuredDocumentMarkdown(dom.body.innerHTML), nodes:unknown[][]=[];
          const queue=[parsed];while(queue.length){const node=queue.shift()!;if(node.type==='image')nodes.push([node.attrs.src,Number(node.attrs.width),Number(node.attrs.height)]);queue.unshift(...(node.content??[]));}
          return{error:'',title:value.reportTitle,html:value.reportContent,placements,nodes,images:await Promise.all((value.images??[]).map(async(image:{source:string;file:File})=>({source:image.source,type:image.file.type,bytes:Array.from(new Uint8Array(await image.file.arrayBuffer()))})))};
        }catch(error){return{error:error instanceof Error?error.message:String(error)};}
      }));
    },variants);
    const photos=imageResults[0];assert.equal(photos.error,'');
    assert.equal(photos.title,'사진','A title containing a picture must stay in the body.');
    assert.match(photos.html!,/그림을 포함한 첫 제목/u);
    assert.deepEqual(photos.placements!.map(row=>row.slice(1)),[[80,60],[120,90],[40,30]]);
    assert.deepEqual(photos.nodes!.map(row=>row.slice(1)),[[80,60],[120,90],[40,30]]);
    assert.equal(photos.images!.length,2,'Repeated media shares one stored asset while retaining all placements.');
    photos.images!.forEach((entry,index)=>assert.ok(Buffer.from(entry.bytes).equals(pictures[index])));
    assert.ok(photos.html!.indexOf('사진 앞 본문')<photos.html!.lastIndexOf('<img')&&photos.html!.lastIndexOf('<img')<photos.html!.indexOf('사진 뒤 본문'));
    imageResults.slice(1,4).forEach(result=>assert.match(result.error,/그림의 배치 또는 형식.*기존 보고서는 유지됩니다/u));
    assert.equal(imageResults[4].error,'');assert.equal(imageResults[4].html!.match(/data-document-page-break/gu)?.length,1);
    assert.equal(imageResults[5].error,'');assert.ok(!imageResults[5].html!.includes('data-document-page-break'));
    assert.match(imageResults[6].error,/구역 나누기.*기존 보고서는 유지됩니다/u);
    t.diagnostic(JSON.stringify({ firstParagraphCharactersPreserved: firstParagraph.length, styledTitlesPreserved: 1, unsupportedNumberedImportsRejected: 1 }));
  } finally { await browser.close(); await server.close(); }
});

function workbookWithXmlText(bodyXml: string, shared: boolean): File {
  const original = reportStudioWorkbook({ reportTitle: 'CF117 합성 검수', reportContent: 'CF117_BODY' }, '합성 프로젝트', '합성 템플릿');
  const parts = unzipSync(original);
  let sheet = strFromU8(parts['xl/worksheets/sheet1.xml']);
  if (shared) {
    let replaced = 0;
    sheet = sheet.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu, (cell: string, attrs: string, content: string) => {
      if (!content.includes('CF117_BODY')) return cell;
      replaced += 1;
      return `<c${attrs.replace(/\bt="inlineStr"/u, 't="s"')}><v>0</v></c>`;
    });
    assert.equal(replaced, 1);
    parts['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t xml:space="preserve">${bodyXml}</t></si></sst>`);
    parts['xl/_rels/workbook.xml.rels'] = strToU8(strFromU8(parts['xl/_rels/workbook.xml.rels']).replace('</Relationships>', '<Relationship Id="rIdCf117Shared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'));
    parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace('</Types>', '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'));
  } else sheet = sheet.replace('CF117_BODY', bodyXml);
  parts['xl/worksheets/sheet1.xml'] = strToU8(sheet);
  return new File([zipSync(parts)], 'cf117-numeric-entities.xlsx');
}

for (const shared of [false, true]) {
  test(`CF117 XLSX ${shared ? 'shared strings' : 'inline strings'} decode numeric XML once and reject invalid Unicode`, async () => {
    const result = await readReportStudioWorkbook(workbookWithXmlText('첫째&#10;둘째&#x1F600;&#38;끝', shared));
    assert.equal(result.reportContent, '첫째\n둘째😀&끝');
    const literal = await readReportStudioWorkbook(workbookWithXmlText('literal &amp;#10; stays literal', shared));
    assert.equal(literal.reportContent, 'literal &#10; stays literal');
    await assert.rejects(() => readReportStudioWorkbook(workbookWithXmlText('invalid &#xD800;', shared)), /유효하지 않은 XML 문자.*기존 내용은 유지됩니다/u);
  });
}
