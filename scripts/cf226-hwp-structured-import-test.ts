import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { findDocumentTextMatches } from '../apps/web/src/documents/document-editing-actions';
import { DocumentMeasuredTable, DocumentTableCell, DocumentTableHeader, HWP_IMPORT_EXTENSIONS, HwpTextStyle, HwpTextAdvance, hwpStructuredSignature, normalizeHwpLayout, hwpLayoutStyle,compactHwpTextStyle,compactHwpLayout } from '../apps/web/src/documents/hwp-import-nodes';

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

test('CF227 native coordinates remain metadata while local baseline corrections survive rendering',()=>{
  const original={nativeX:82.1,nativeY:98,nativeBaseline:108.0133,fontSize:12,fontFamily:'HwpImport Noto Serif KR',lineHeight:18.6,marginBottom:-6.6,position:'relative',left:.02,top:-.9867};
  const layout=normalizeHwpLayout(original)!;
  assert.deepEqual(layout,original);
  const css=hwpLayoutStyle(layout);
  assert.doesNotMatch(css,/native/);
  assert.match(css,/top:-0.9867px/);
  assert.match(css,/font-family:"HwpImport Noto Serif KR"/);
  assert.match(hwpLayoutStyle({nativeX:82,paddingTop:8,borderTop:'1.889px solid #111111'}),/max\(var\(--hwp-device-pixel, 1px\), round\(down/);
  assert.equal(normalizeHwpLayout({fontFamily:'serif;position:fixed',nativeBaseline:Infinity}),null);
  const paragraph={type:'paragraph',attrs:{hwpLayout:layout},content:[{type:'text',text:'수정 가능한 문장'}]};
  assert.notEqual(hwpStructuredSignature(paragraph),hwpStructuredSignature({...paragraph,attrs:{hwpLayout:{...layout,top:0}}}));
});

test('CF228 tabs and mixed-font baseline offsets survive the editable schema',()=>{
  const paragraph={type:'paragraph',content:[{type:'hwpImportedTab',attrs:{width:13.3}},{type:'text',text:'원본 문장',marks:[{type:'hwpTextStyle',attrs:{fontFamily:'Noto Serif KR',fontSize:14.7,baselineShift:1.4}}]},{type:'hardBreak'},{type:'text',text:'다음 줄'}]};
  const node=schema.nodeFromJSON(paragraph),roundtrip=node.toJSON();
  assert.equal(hwpStructuredSignature(roundtrip),hwpStructuredSignature(paragraph));
  assert.equal(node.child(0).isInline,true);
  assert.equal(node.child(0).isAtom,true);
  assert.notEqual(hwpStructuredSignature(roundtrip),hwpStructuredSignature({...paragraph,content:[{type:'hwpImportedTab',attrs:{width:12}},...paragraph.content.slice(1)]}));
});

test('CF228 compound cell borders keep measured geometry and distinct native strokes',()=>{
  const layout={nativeX:75.6,nativeY:80,nativeWidth:200,height:30,borderTop:'0.4535px solid #112233',borderTopPattern:'SLIM_THICK_SLIM',borderBottom:'0.4535px solid #112233',borderBottomPattern:'DOUBLE_SLIM'};
  assert.deepEqual(normalizeHwpLayout(layout),layout);
  const css=hwpLayoutStyle(layout);
  assert.equal((css.match(/linear-gradient\(/gu)||[]).length,5);
  assert.match(css,/calc\(100% - 16px\) 1.2px/u);
  assert.equal(hwpLayoutStyle({...layout,nativeWidth:300,height:60}).split('--hwp-cell-border-image:')[1],css.split('--hwp-cell-border-image:')[1]);
  assert.match(css,/border-top:0.4535px solid transparent/u);
  assert.doesNotMatch(css,/border-top-pattern|native-width/u);
  assert.equal(normalizeHwpLayout({borderTopPattern:'url(https://invalid)',nativeWidth:Infinity}),null);
});

test('CF228 compact font records preserve values and reject malformed advance records',()=>{
  const parse=HwpTextStyle.config.parseHTML!.call(HwpTextStyle)[0].getAttrs!;
  const expected={fontFamily:'Batang',fontSize:14.7,color:'#000000',letterSpacing:0,trackingCorrection:0,baselineShift:.033333};
  assert.deepEqual(parse({getAttribute:()=>JSON.stringify(Object.values(expected))} as never),expected);
  assert.deepEqual(parse({getAttribute:()=>JSON.stringify(expected)} as never),expected);
  assert.equal(parse({getAttribute:()=>'[1,2]'} as never),false);
  const advance=HwpTextAdvance.config.parseHTML!.call(HwpTextAdvance)[0].getAttrs!;
  assert.deepEqual(advance({getAttribute:()=>'.0025'} as never),{letterSpacing:.0025});
  for(const raw of ['Infinity','NaN','21','url(https://invalid)'])assert.equal(advance({getAttribute:()=>raw} as never),false);
});

test('CF228 search and replace spans font marks but stops at inline objects and paragraphs',()=>{
  const doc=schema.nodeFromJSON({type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'웹',marks:[{type:'bold'}]},{type:'text',text:'편집'},{type:'text',text:'확인 [12.',marks:[{type:'italic'}]},{type:'text',text:'5]'}]},
    {type:'paragraph',content:[{type:'text',text:'A'},{type:'hwpImportedTab',attrs:{width:10}},{type:'text',text:'B'},{type:'hardBreak'},{type:'text',text:'C'}]},
    {type:'paragraph',content:[{type:'text',text:'D'}]}
  ]});
  const matches=findDocumentTextMatches(doc,'웹편집확인');
  assert.equal(matches.length,1);
  assert.equal(doc.textBetween(matches[0].from,matches[0].to),'웹편집확인');
  const amount=findDocumentTextMatches(doc,'[12.5]');
  assert.equal(amount.length,1);
  const changed=EditorState.create({schema,doc}).tr.insertText('[13.5]',amount[0].from,amount[0].to).doc;
  assert.equal(findDocumentTextMatches(changed,'[13.5]').length,1);
  assert.equal(findDocumentTextMatches(changed,'[12.5]').length,0);
  for(const query of ['AB','BC','CD',''])assert.equal(findDocumentTextMatches(doc,query).length,0);
});

test('CF229 portable advances and native font provenance survive saved schema and compact font palettes',()=>{
  const layout={position:'absolute',left:75.123456,top:68.02,width:642.5,nativeWidth:642.5,borderTopPattern:'DOUBLE_SLIM',borderTop:'0.4535px solid #000000',textAlign:'justify'};
  const packed=compactHwpLayout(layout);
  assert.deepEqual(normalizeHwpLayout(packed),layout);
  const preciseCell={height:3.8,nativeHeight:282/75,paddingTop:141/75,paddingBottom:141/75};
  assert.deepEqual(normalizeHwpLayout(compactHwpLayout(preciseCell)),preciseCell);
  assert.doesNotMatch(hwpLayoutStyle(preciseCell),/native-height/u);
  assert.deepEqual(compactHwpLayout({nativeX:75.1}),[1,17,75.1]);
  assert.ok(JSON.stringify(packed).length<JSON.stringify(layout).length);
  for(const invalid of [[2,0,1],[1,999,1],[1,0,1,0,2],[1,0]])assert.equal(normalizeHwpLayout(invalid),null);
  const advance=HwpTextAdvance.config.parseHTML!.call(HwpTextAdvance)[0].getAttrs!;
  assert.deepEqual(advance({getAttribute:()=>'[14.666667]'} as never),{letterSpacing:0,unitAdvance:14.666667});
  assert.deepEqual(advance({getAttribute:()=>'[8,"space"]'} as never),{letterSpacing:0,unitAdvance:8,metric:'space'});
  assert.deepEqual(advance({getAttribute:()=>'[8,"digit"]'} as never),{letterSpacing:0,unitAdvance:8,metric:'digit'});
  for(const raw of ['[-1]','[201]','[1,2]','[null]','["14"]'])assert.equal(advance({getAttribute:()=>raw} as never),false);
  const attrs={fontFamily:'Batang',fontSize:14.666667,color:'#000000',letterSpacing:0,trackingCorrection:0,baselineShift:0,nativeFontFamily:'휴먼명조'};
  const compact=compactHwpTextStyle(attrs);assert.equal(compact[1],-1100);
  const parse=HwpTextStyle.config.parseHTML!.call(HwpTextStyle)[0].getAttrs!;
  assert.deepEqual(parse({getAttribute:()=>JSON.stringify(compact)} as never),attrs);
  const palette={getAttribute:()=>JSON.stringify([compact])};
  assert.deepEqual(parse({getAttribute:()=>'0',closest:()=>palette} as never),attrs);
  const paired={getAttribute:()=>'[0,14.666667]',closest:()=>palette};
  assert.deepEqual(parse(paired as never),attrs);
  const pairedAdvance=HwpTextAdvance.config.parseHTML!.call(HwpTextAdvance)[1].getAttrs!;
  assert.deepEqual(pairedAdvance(paired as never),{letterSpacing:0,unitAdvance:14.666667});
  const metricPair={getAttribute:()=>'[0,8,"digit"]',closest:()=>palette};
  assert.deepEqual(parse(metricPair as never),attrs);
  assert.deepEqual(pairedAdvance(metricPair as never),{letterSpacing:0,unitAdvance:8,metric:'digit'});
  for(const raw of ['[0,8,"invalid"]','[0,8,{}]'])assert.equal(pairedAdvance({getAttribute:()=>raw,closest:()=>palette} as never),false);
  const mark=(metric:string)=>schema.marks.hwpTextAdvance.create({unitAdvance:8,metric});
  const boundary=schema.node('paragraph',null,[schema.text(' ',[mark('space')]),schema.text('2',[mark('digit')])]);
  assert.equal(boundary.childCount,2,'Equal native widths must not merge a narrow browser space with a digit');
  for(const raw of ['[0,-1]','[0,201]','[0,"14"]','[1,14]'])assert.equal(pairedAdvance({getAttribute:()=>raw,closest:()=>palette} as never),false);
  for(const raw of ['-1','0.5','1'])assert.equal(parse({getAttribute:()=>raw,closest:()=>palette} as never),false);
  const paragraph={type:'paragraph',content:[{type:'text',text:'보고서 123.45',marks:[{type:'hwpTextStyle',attrs},{type:'hwpTextAdvance',attrs:{letterSpacing:0,unitAdvance:14.666667}}]}]};
  assert.equal(hwpStructuredSignature(schema.nodeFromJSON(paragraph).toJSON()),hwpStructuredSignature(paragraph));
});
