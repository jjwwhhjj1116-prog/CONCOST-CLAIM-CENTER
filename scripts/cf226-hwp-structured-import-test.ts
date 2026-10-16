import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { DocumentMeasuredTable, DocumentTableCell, DocumentTableHeader, HWP_IMPORT_EXTENSIONS, hwpStructuredSignature, normalizeHwpLayout } from '../apps/web/src/documents/hwp-import-nodes';

const requireWeb = createRequire(resolve('apps/web/package.json'));
const { getSchema, commands } = requireWeb('@tiptap/core');
const { EditorState, TextSelection } = requireWeb('@tiptap/pm/state');
const StarterKit = requireWeb('@tiptap/starter-kit').default;
const { TableKit } = requireWeb('@tiptap/extension-table');
const schema = getSchema([StarterKit, TableKit.configure({table:false,tableCell:false,tableHeader:false}), DocumentMeasuredTable, DocumentTableCell, DocumentTableHeader, ...HWP_IMPORT_EXTENSIONS]);

test('CF226 fractional HWP column widths survive the actual cell HTML parser', () => {
  for (const extension of [DocumentTableCell,DocumentTableHeader]) {
    const widths = extension.config.addAttributes!.call({parent:()=>({})} as never).colwidth;
    const parse = (raw: string | null) => widths.parseHTML({getAttribute:()=>raw});
    assert.deepEqual(parse('271.5,350.9,7.6'),[271.5,350.9,7.6]);
    for(const raw of [null,'','NaN','1,Infinity','-1','0','2,,3']) assert.equal(parse(raw),null);
  }
});

test('CF226 Enter keeps one original page anchor and creates flowing editable paragraphs', () => {
  const anchor={position:'absolute',left:82,top:218,width:630,height:34};
  for(const position of [4,6]) {
    const doc=schema.nodeFromJSON({type:'doc',content:[{type:'hwpImportedPage',content:[{type:'hwpImportedTextBox',attrs:{hwpLayout:anchor},content:[{type:'paragraph',content:[{type:'text',text:'abc'}]}]}]}]});
    const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,position)}),tr=state.tr;
    assert.equal(commands.splitBlock({keepMarks:false})({state,tr,dispatch:()=>{},editor:{extensionManager:{attributes:[],splittableMarks:[]}}}),true);
    const page=tr.doc.firstChild,box=page.firstChild;
    assert.equal(page.childCount,1);
    assert.equal(box.type.name,'hwpImportedTextBox');
    assert.deepEqual(box.attrs.hwpLayout,anchor);
    assert.equal(box.childCount,2);
    assert.equal(box.textContent,'abc');
    for(let index=0;index<box.childCount;index++)assert.equal(box.child(index).attrs.hwpLayout,null);
  }
});

test('CF226 preservation signature joins equal text runs but catches geometry, text and photo edits', () => {
  const marks=[{type:'hwpTextStyle',attrs:{fontFamily:'Noto Serif KR',fontSize:16}}];
  const split={type:'paragraph',content:[{type:'text',text:'보고',marks},{type:'text',text:'서',marks}]};
  assert.equal(hwpStructuredSignature(split),hwpStructuredSignature({type:'paragraph',content:[{type:'text',text:'보고서',marks}]}));
  const source={type:'tableCell',attrs:{colwidth:[7.6],verticalAlignment:'top',hwpLayout:{paddingTop:0,height:29}},content:[split]};
  for(const change of [{colwidth:[7]},{verticalAlignment:'middle'},{hwpLayout:{paddingTop:1,height:29}}])assert.notEqual(hwpStructuredSignature(source),hwpStructuredSignature({...source,attrs:{...source.attrs,...change}}));
  const image={type:'image',attrs:{src:'/api/cases/evidence/synthetic/download',width:260,height:180,alignment:'center'}};
  assert.notEqual(hwpStructuredSignature(image),hwpStructuredSignature({...image,attrs:{...image.attrs,alignment:'left'}}));
  assert.notEqual(hwpStructuredSignature(image),hwpStructuredSignature({...image,attrs:{...image.attrs,width:240}}));
});

test('CF226 stored layout rejects arbitrary CSS and retains measured numeric precision', () => {
  assert.deepEqual(normalizeHwpLayout({position:'absolute',left:82.15,width:630,backgroundImage:'url(https://invalid)',top:Infinity,height:10001,borderTop:'1px solid #111111'}),{position:'absolute',left:82.15,width:630,borderTop:'1px solid #111111'});
});
