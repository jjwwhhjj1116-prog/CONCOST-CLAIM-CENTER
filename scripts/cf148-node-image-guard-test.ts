import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLegacyReportTextOnly } from '../apps/api/src/server.js';
import { startP12Isolated, closeP12Isolated } from './p12-test-support.js';
import { requestJson } from './p09-test-support.js';

test('Node legacy output rejects image-bearing sections instead of silently dropping them', () => {
  for (const content of ['![사진](photo.png)', '![사진][ref]', '<IMG src="photo.png">', '[PROPOSAL_ASSET:photo]']) {
    assert.throws(() => assertLegacyReportTextOnly([{ content: '일반 본문' }, { content }]), /사진·이미지를 보존하지 못하므로/u);
  }
  assert.doesNotThrow(() => assertLegacyReportTextOnly([{ content: '검토금액 123,456원\n1. 결론' }]));
  for (const structuredDataJson of [JSON.stringify({type:'doc',content:[{type:'blockquote',content:[{type:'image',attrs:{src:'photo.png'}}]}]}), '{broken']) {
    assert.throws(() => assertLegacyReportTextOnly([{content:'일반 본문',approvedRevision:{structuredDataJson}}]), /사진·이미지를 보존하지 못하므로/u);
  }
});

test('Node HTTP output generation blocks JSON-only images before artifact creation', async () => {
  const context = await startP12Isolated('cf148-image-guard', {sectionCount:1});
  try {
    const {origin, db, fixture} = context;
    const {reportId, sectionIds, staff, reviewer} = fixture;
    const section = await db.reportSection.findUniqueOrThrow({where:{id:sectionIds[0]}});
    const saved = await requestJson(origin, `/api/reports/${reportId}/sections/${section.id}/revisions`, 'POST', {
      title:section.title, content:'현장 조사 사진 첨부', structuredDataJson:JSON.stringify({type:'doc',content:[{type:'image',attrs:{src:'photo.png'}}]}), expectedVersion:section.version, saveMode:'MANUAL', evidenceLinks:[]
    }, staff);
    assert.equal(saved.status,201,JSON.stringify(saved.body));
    const current = await db.reportSection.findUniqueOrThrow({where:{id:section.id},include:{revisions:{orderBy:{createdAt:'desc'}}}});
    const approved=await requestJson(origin,`/api/reports/${reportId}/sections/${section.id}/approve`,'POST',{revisionId:current.revisions[0].id,expectedVersion:current.version},reviewer);
    assert.equal(approved.status,200,JSON.stringify(approved.body));
    const finalized=await requestJson(origin,`/api/reports/${reportId}/finalizations`,'POST',{idempotencyKey:'cf148-json-image-final'},reviewer);
    assert.equal(finalized.status,201,JSON.stringify(finalized.body));
    for(const format of ['DOCX','PDF']) {
      const output=await requestJson(origin,`/api/reports/${reportId}/finalizations/${finalized.body.finalization.id}/outputs`,'POST',{format},reviewer);
      assert.equal(output.status,422,JSON.stringify(output.body));
    }
    assert.equal(await db.reportOutputArtifact.count({where:{reportId}}),0);
  } finally { await closeP12Isolated(context); }
});
