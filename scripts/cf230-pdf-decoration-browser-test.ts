import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {createServer} from '../apps/web/qa/vite-server.js';

async function main(){
 const out=mkdtempSync(resolve('tmp/cf230-pdf-decoration-')),before=process.env.CF230_PDF_BEFORE==='1';
 const server=await createServer({root:resolve('apps/web'),cacheDir:resolve(out,'cache'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'before-pdf-decoration',enforce:'pre',transform(code,id){if(before&&id.replaceAll('\\','/').split('?')[0].endsWith('/src/documents/final-document-export.ts'))return code.replace('prepareHwpPdfDecorations(clonedPage);','');}}]});
 await server.listen();const origin='http://127.0.0.1:'+(server.httpServer!.address() as any).port;
 const executablePath=[process.env.CHROME_PATH,...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).map(p=>resolve(p!,'Google/Chrome/Application/chrome.exe'))].find(p=>p&&existsSync(p));
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1300}});await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/qa')return route.fulfill({contentType:'text/html',body:'<html><head><script type="module">import "/src/theme-system.css";import "/src/documents/hwp-import.css";</script></head><body></body></html>'});return route.continue();});
  await page.goto(origin+'/qa');await page.waitForFunction(()=>document.styleSheets.length>0);await page.evaluate('globalThis.__name=v=>v');
  const original=await page.evaluate(async(scale:number)=>{
   const {hwpLayoutStyle}=await import('/src/documents/hwp-import-nodes.ts' as string);
   const root=document.createElement('div');root.id='report';root.dataset.exportDocumentKind='REPORT';root.style.color='#111';
   const cell=(borders:Record<string,string>)=>`<td style="${hwpLayoutStyle({nativeWidth:320,paddingTop:10,paddingBottom:10,...borders})}"><p>CF230 PDF</p></td>`;
   const edge='7.559055118110237px solid #000000';
   const rule=(left:number,top:number,width:number,height:number)=>`<div data-hwp-import-rule="1" data-hwp-rule-nativevector="1" style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;overflow:visible"><svg xmlns="http://www.w3.org/2000/svg" width="${width+.32}" height="${height+.32}" viewBox="0 0 ${width+.32} ${height+.32}" style="position:absolute;left:-.16px;top:-.16px;overflow:visible"><line x1=".16" y1=".16" x2="${width+.16}" y2="${height+.16}" stroke="#000000" stroke-width=".32"/></svg></div>`;
   root.innerHTML=`<section data-export-page data-export-page-policy="fit" style="position:relative;width:794px;height:1123px;margin:0;background:white"><div class="hwp-import-page" style="position:relative;width:794px;height:1123px;background:white">${rule(60,60,674,0)}${rule(60,60,0,1000)}${rule(734,60,0,1000)}${rule(60,1060,674,0)}<table style="position:absolute;left:120px;top:200px;width:320px;height:100px;table-layout:fixed;border-collapse:collapse"><tr>${cell({borderTop:edge,borderBottom:edge,borderTopPattern:'SLIM_THICK_SLIM',borderBottomPattern:'SLIM_THICK_SLIM'})}</tr></table><table style="position:absolute;left:500px;top:200px;width:160px;height:180px;table-layout:fixed;border-collapse:collapse"><tr>${cell({borderLeft:edge,borderRight:edge,borderLeftPattern:'DOUBLE_SLIM',borderRightPattern:'DOUBLE_SLIM'})}</tr></table></div></section>`;
   if(scale!==1){root.style.transform=`scale(${scale})`;root.style.transformOrigin='top left';}
   document.body.append(root);await document.fonts.ready;return root.innerHTML;
  },Number(process.env.CF230_PDF_SCALE||1));
  const download=page.waitForEvent('download');download.catch(()=>{});
  await page.evaluate(async()=>{const{downloadFinalDocument}=await import('/src/documents/final-document-export.ts' as string);await downloadFinalDocument({root:document.getElementById('report')!,format:'pdf',fileName:'CF230-public-decoration-fixture',orientation:'portrait'});});
  const pdfBytes=readFileSync((await (await download).path())!);writeFileSync(resolve(out,'actual.pdf'),pdfBytes);
  assert.equal(await page.locator('#report').innerHTML(),original,'PDF must not change the editable source DOM');
  const metrics=await page.evaluate(async(bytes:number[])=>{
   const{openPdfPageImages}=await import('/src/documents/pdf-page-image.ts' as string);const pdf=await openPdfPageImages(new Uint8Array(bytes));
   try{const file=await pdf.readPage(0),image=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);image.close();
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data,dark=(x:number,y:number,limit=180)=>data[(y*canvas.width+x)*4]<limit;
    const horizontal=(x1:number,x2:number,y1:number,y2:number,limit=180)=>{let max=0;for(let y=y1;y<y2;y++){let count=0;for(let x=x1;x<x2;x++)if(dark(x,y,limit))count++;max=Math.max(max,count);}return max;};
    const vertical=(x1:number,x2:number,y1:number,y2:number,limit=180)=>{let max=0;for(let x=x1;x<x2;x++){let count=0;for(let y=y1;y<y2;y++)if(dark(x,y,limit))count++;max=Math.max(max,count);}return max;};
    return{pages:pdf.count,width:canvas.width,height:canvas.height,horizontal:horizontal(260,850,380,425),vertical:vertical(975,1025,430,730),outerTop:horizontal(140,1400,116,125,245),outerLeft:vertical(116,125,140,2050,245),png:canvas.toDataURL()};
   }finally{await pdf.close();}
  },[...pdfBytes]);
  writeFileSync(resolve(out,'actual.png'),Buffer.from(metrics.png.split(',')[1],'base64'));writeFileSync(resolve(out,'result.json'),JSON.stringify({before,...metrics,png:undefined},null,2));
  console.log(JSON.stringify({out,before,...metrics,png:undefined}));
  assert.equal(metrics.pages,1);assert.ok(metrics.horizontal>500,'Triple horizontal strokes must stay horizontal');assert.ok(metrics.vertical>200,'Double vertical strokes must stay vertical');assert.ok(metrics.outerTop>1000,'Subpixel horizontal native rule must remain visible');assert.ok(metrics.outerLeft>1500,'Subpixel vertical native rule must remain visible');
 }finally{await browser.close();await server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
