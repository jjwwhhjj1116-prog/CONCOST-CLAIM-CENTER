import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';

test('CF212 contained JPEG exports use one source-byte decoder, without changing authored boxes or other image paths',async t=>{
  const jpeg=readFileSync('scripts/fixtures/cf212-contained-photo.jpg');
  assert.equal(createHash('sha256').update(jpeg).digest('hex'),'a5cac7bc8297682480a59766ebe626b40565dafeb65192cfda4ffe2f119388cb','Customer-free CF200 800x400 JPEG, not a live case');
  const {createServer}=await import('../apps/web/qa/vite-server.js');
  const server=await createServer({root:resolve('apps/web'),...(process.env.CF149_CACHE_ROOT?{cacheDir:process.env.CF149_CACHE_ROOT}:{}),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
  await server.listen();
  const origin='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port;
  const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path=>path&&existsSync(path));
  const browser=await chromium.launch({executablePath,headless:true});
  try{
    const page=await browser.newPage();
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort();
      if(url.pathname==='/cf212.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});
      if(url.pathname==='/cf212-photo.jpg')return route.fulfill({contentType:'image/jpeg',body:jpeg});
      return route.continue();
    });
    await page.goto(origin+'/cf212.html');
    await page.evaluate('globalThis.__name = value => value');
    for(const variant of ['contain','scale-down','contain-right','png','raw-jpeg','svg','invalid-jpeg'])await t.test(variant,async()=>{
      const result=await page.evaluate(async variant=>{
        const {documentImageData}=await import('/src/documents/editable-docx-export.ts' as string);
        const image=document.createElement('img');
        image.alt='CF212 합성 사진';
        image.style.cssText='display:block;width:260px;height:180px;object-fit:contain;object-position:50% 50%';
        const original=new Uint8Array(await(await fetch('/cf212-photo.jpg')).arrayBuffer());
        let supplied=original;
        if(variant==='png'){
          const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;
          canvas.getContext('2d')!.fillStyle='#14769a';canvas.getContext('2d')!.fillRect(0,0,80,40);
          supplied=new Uint8Array(await(await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'))).arrayBuffer());
          canvas.width=canvas.height=1;
        }
        if(variant==='svg')supplied=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#14769a"/></svg>');
        const objectUrl=URL.createObjectURL(new Blob([supplied],{type:variant==='png'?'image/png':variant==='svg'?'image/svg+xml':'image/jpeg'}));
        image.src=objectUrl;document.body.append(image);await image.decode();
        if(variant==='scale-down')image.style.objectFit='scale-down';
        if(variant==='contain-right')image.style.cssText='display:block;width:600px;height:180px;object-fit:contain;object-position:100% 0%';
        if(variant==='raw-jpeg')image.style.cssText='display:block;width:260px;height:130px;object-fit:contain;object-position:50% 50%';
        const before=image.outerHTML;
        const expectedCanvas=document.createElement('canvas');
        let expected:Uint8Array=supplied;
        let closeCount=0,decodeCount=0,failed=false;
        const nativeBitmap=globalThis.createImageBitmap;
        if(variant!=='raw-jpeg'&&variant!=='invalid-jpeg'){
          const css=getComputedStyle(image),width=image.offsetWidth,height=image.offsetHeight;
          const scale=Math.min(width/image.naturalWidth,height/image.naturalHeight,...(css.objectFit==='scale-down'?[1]:[]));
          const density=Math.max(2,1/scale),drawWidth=image.naturalWidth*scale,drawHeight=image.naturalHeight*scale;
          expectedCanvas.width=Math.round(width*density);expectedCanvas.height=Math.round(height*density);
          const bitmap=variant.startsWith('contain')||variant==='scale-down'?await nativeBitmap(new Blob([original],{type:'image/jpeg'})):null;
          const positions=css.objectPosition.split(/\s+/u);
          expectedCanvas.getContext('2d')!.drawImage(bitmap??image,(width-drawWidth)*parseFloat(positions[0])/100*density,(height-drawHeight)*parseFloat(positions[1])/100*density,drawWidth*density,drawHeight*density);
          bitmap?.close();
          expected=new Uint8Array(await(await new Promise<Blob>(resolve=>expectedCanvas.toBlob(blob=>resolve(blob!),'image/png'))).arrayBuffer());
        }
        globalThis.createImageBitmap=(async (...args:Parameters<typeof createImageBitmap>)=>{
          decodeCount++;
          if(variant==='invalid-jpeg')throw new Error('CF212 synthetic decoder failure');
          const bitmap=await nativeBitmap(...args);
          const close=bitmap.close.bind(bitmap);bitmap.close=()=>{closeCount++;close();};
          return bitmap;
        }) as typeof createImageBitmap;
        const outputs:number[][]=[];
        try{
          for(let i=0;i<3;i++)outputs.push(Array.from((await documentImageData(image)).bytes));
        }catch(error){
          if(variant!=='invalid-jpeg'||!String(error).includes('첨부 이미지 변환에 실패했습니다'))throw error;
          failed=true;
        }finally{globalThis.createImageBitmap=nativeBitmap;URL.revokeObjectURL(objectUrl);expectedCanvas.width=expectedCanvas.height=1;}
        const unchanged=image.outerHTML===before,box=[image.offsetWidth,image.offsetHeight];image.remove();
        return {outputs,expected:Array.from(expected),unchanged,box,decodeCount,closeCount,failed};
      },variant);
      assert.equal(result.unchanged,true,'The source DOM must remain unchanged');
      assert.deepEqual(result.box,variant==='contain-right'?[600,180]:variant==='raw-jpeg'?[260,130]:[260,180]);
      if(variant==='invalid-jpeg'){
        assert.equal(result.failed,true,'Do not silently fall back to another JPEG decoder');
        assert.equal(result.decodeCount,1);assert.equal(result.closeCount,0);assert.equal(result.outputs.length,0);
      }else{
        assert.equal(result.outputs.length,3);
        for(const bytes of result.outputs)assert.equal(createHash('sha256').update(Uint8Array.from(bytes)).digest('hex'),createHash('sha256').update(Uint8Array.from(result.expected)).digest('hex'),'DOCX/HWP shared photo bytes must match source-byte decoding, including alpha padding and alignment');
        const jpegRaster=['contain','scale-down','contain-right'].includes(variant);
        assert.equal(result.decodeCount,jpegRaster?3:0);assert.equal(result.closeCount,jpegRaster?3:0,'Release every decoded bitmap, preserve non-JPEG paths');
      }
    });
  }finally{await browser.close();await server.close();}
});
