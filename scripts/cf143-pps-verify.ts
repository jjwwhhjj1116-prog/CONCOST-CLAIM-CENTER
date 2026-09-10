// Re-check committed history against PPS originals; --live downloads official files.
// Default uses the deliberately untracked audit cache, never customer workbooks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectPpsArchive, hwpRateCandidates } from './cf143-pps-inspect';
import { PPS_HISTORY } from '../apps/cloudflare/src/es-pps-history-data';
import { fetchPpsHistory } from '../apps/cloudflare/src/es-pps-history';
import { readPublicFile, parsePpsRates } from '../apps/cloudflare/src/es-public-sources';

async function main() {
  let verified = 0, damaged = 0, values = 0;
  for (const r of PPS_HISTORY) {
    const file = 'https://www.pps.go.kr/common/fileDown.do?key='+r.key+'&sn='+r.sn;
    const notice = 'https://www.pps.go.kr/kor/bbs/view.do?bbsSn='+r.notice+'&key=00038';
    const bytes = process.argv.includes('--live') ? await readPublicFile(file,fetch,notice) : new Uint8Array(readFileSync('tmp/cf143/originals/'+r.key+'-'+r.sn+'.bin'));
    if (!Object.keys(r.rates).length) {
      // Preserve the fail-closed record, do not use a neighbouring publication.
      const result = await fetchPpsHistory(r.date,r.trade,'7',async()=>bytes);
      assert.equal(result.items.length,0); assert.equal(result.issues.length,6); damaged++; continue;
    }
    const doc = inspectPpsArchive(bytes); assert.equal(doc.sha256,r.sha256,notice);
    const text = doc.paragraphs?.join('\n') ?? doc.sheets?.[0].cells.map(c=>c.ref+': '+c.text).join('\n') ?? '';
    const extracted = doc.format === 'hwp' ? hwpRateCandidates(doc) : Object.fromEntries(Array.from({length:7},(_,i)=>i+1).flatMap(g=>Object.entries(parsePpsRates('[sheet1]\n'+text,r.trade,String(g))).map(([field,v])=>[field==='employment'?field+g:field,{value:v.value,evidence:v.cell}])));
    for (const [field,[value]] of Object.entries(r.rates)) { assert.equal(extracted[field]?.value,value,notice+' '+field); values++; }
    for (let grade=1; grade<=7; grade++) {
      const result=await fetchPpsHistory(r.date,r.trade,String(grade),async()=>bytes);
      assert.equal(result.items.length,6,notice);
      for (const item of result.items) { assert.ok(item.source.length<=600); assert.ok(item.condition.length<=500); assert.ok(item.effectiveDate<=item.date); }
      assert.equal(result.items.find(i=>i.field==='employment')!.value,r.rates['employment'+grade][0]);
    }
    verified++;
  }
  console.log(JSON.stringify({verified,damaged,values,mode:process.argv.includes('--live')?'official-live':'original-audit-cache'}));
}
void main();
