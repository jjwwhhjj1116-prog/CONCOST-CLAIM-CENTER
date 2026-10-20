import { createServer } from '../apps/web/qa/vite-server.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Open the printed localhost URL and press Run. This uses the actual exporter
// while an asynchronous table-image read moves its surrounding UI by one line.
async function main() {
const phase = process.argv[2] ?? 'before';
if (!/^[a-z0-9-]+$/u.test(phase)) throw Error('Invalid proof phase');
const proof = resolve('tmp/cf237-qa/origin-shift');
mkdirSync(proof, { recursive: true });
const server = await createServer({ root: resolve('apps/web'), cacheDir: proof + '/cache', server: { host: '127.0.0.1', port: 52737, strictPort: true, hmr: false }, logLevel: 'error', plugins: [{
  name: 'cf237-docx-origin-fixture', enforce: 'pre',
  configureServer(s) { s.middlewares.use(async (req, res, next) => {
    if (req.url === '/origin-result' && req.method === 'POST') {
      let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 100000) throw Error('Proof too large'); }
      const value = JSON.parse(text); writeFileSync(proof + '/' + phase + '.json', JSON.stringify(value, null, 2), { flag: 'wx' });
      res.setHeader('Content-Type', 'application/json'); res.end('{"saved":true}'); console.log(JSON.stringify(value)); return;
    }
    if (req.url !== '/origin.html') return next();
    res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml(req.url, '<!doctype html><html><body><h1>DOCX page origin regression</h1><button id="run">Run</button><pre id="result">Ready</pre><div id="host" style="margin-top:20px"></div><script type="module" src="/origin-entry.js"></script></body></html>'));
  }); },
  resolveId: id => id === '/origin-entry.js' ? id : undefined,
  load: id => id === '/origin-entry.js' ? `
    import {createEditableDocx} from '/src/documents/editable-docx-export.ts';
    import {unzipSync,strFromU8} from 'fflate';
    const host=document.querySelector('#host'),result=document.querySelector('#result'),button=document.querySelector('#run');
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAF0lEQVR4nGN8Vqtj8KqNAQyY4CwGBgYAWcQE0+6Bp0sAAAAASUVORK5CYII=';
    button.onclick=async()=>{button.disabled=true;
      host.innerHTML='<article data-export-page style="position:relative;width:794px;height:1123px;padding:0"><div data-hwp-import-page data-hwp-width="794" style="position:relative;width:794px;height:1123px"><div data-hwp-text-box style="position:absolute;left:75px;top:20px;width:600px"><p style="margin:0;font:16px/24px serif">BEFORE</p></div><table style="position:absolute;left:75px;top:100px;width:400px"><tr><td><img width="4" height="2" src="'+image+'"></td></tr></table><div data-hwp-text-box style="position:absolute;left:75px;top:300px;width:600px"><p style="margin:0;font:16px/24px serif">AFTER</p></div></div></article>';
      await host.querySelector('img').decode(); const nativeFetch=window.fetch;let moved=false;
      window.fetch=async(input,init)=>{const response=await nativeFetch(input,init);if(String(input)===image&&!moved){moved=true;host.style.marginTop='39.2px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}return response;};
      try{const bytes=await createEditableDocx(host,'portrait'),archive=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(archive['word/document.xml']),'application/xml'),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const frames=[...xml.getElementsByTagNameNS(ns,'p')].flatMap(p=>{const f=p.getElementsByTagNameNS(ns,'framePr')[0],text=[...p.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join('');return f&&['BEFORE','AFTER'].includes(text)?[{text,x:Number(f.getAttributeNS(ns,'x')),y:Number(f.getAttributeNS(ns,'y'))}]:[];});
        const value={moved,frames,expected:[{text:'BEFORE',x:1125,y:300},{text:'AFTER',x:1125,y:4500}],pass:moved&&frames.length===2&&frames[0].y===300&&frames[1].y===4500};
        result.textContent=JSON.stringify(value,null,2);await nativeFetch('/origin-result',{method:'POST',body:JSON.stringify(value)});
      }catch(error){result.textContent=String(error);}finally{window.fetch=nativeFetch;}
    };
  ` : undefined
}] });
await server.listen(); console.log('http://127.0.0.1:52737/origin.html');
}
void main();
