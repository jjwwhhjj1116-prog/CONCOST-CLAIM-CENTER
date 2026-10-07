import assert from 'node:assert/strict';
import test from 'node:test';
import {assertReportNativeImportContainer} from '../apps/web/src/documents/report-native-source';

test('CF192 early import guard preserves native CFB, ZIP, legacy HWP3 and existing HML dispatch',()=>{
  const cfb=new Uint8Array(513);cfb.set([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);assert.doesNotThrow(()=>assertReportNativeImportContainer(cfb.buffer,'검수.HWP'));
  const legacy=new Uint8Array(30);legacy.set(new TextEncoder().encode('HWP Document File'));assert.doesNotThrow(()=>assertReportNativeImportContainer(legacy.buffer,'구형.hwp'));
  const zip=new Uint8Array([0x50,0x4b,0x03,0x04]);assert.doesNotThrow(()=>assertReportNativeImportContainer(zip.buffer,'압축.HWPX'));
  assert.doesNotThrow(()=>assertReportNativeImportContainer(new TextEncoder().encode('<HWPML/>').buffer as ArrayBuffer,'원본.hml'));
  // Passing a signature is explicitly not successful parsing or round-trip proof.
  for(const name of ['깨진.hwp','깨진.hwpx'])for(const bytes of [new Uint8Array(),new Uint8Array([0,1,2,3]),new Uint8Array(1024)])assert.throws(()=>assertReportNativeImportContainer(bytes.buffer as ArrayBuffer,name),/정상 저장/u);
  assert.throws(()=>assertReportNativeImportContainer(cfb.slice(0,512).buffer,'잘린.hwp'));
  assert.throws(()=>assertReportNativeImportContainer(legacy.slice(0,29).buffer,'잘린 구형.hwp'));
  assert.throws(()=>assertReportNativeImportContainer(legacy.buffer,'잘못된 확장자.hwpx'));
});
