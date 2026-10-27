import { Button, Card, Dialog, Input } from '@claim-studio/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../api';
import { AiGenerationProgressModal, type AiGenerationStatus } from '../components/AiGenerationProgressModal';
import { BusinessCardTransferPanel, optimizeBusinessCard } from './BusinessCardTransfer';
import { registerNavigationBlocker, type PendingNavigation } from '../navigation-guard';
import './BusinessCardContacts.css';

type BusinessCardMode = 'LIST' | 'REGISTER' | 'DATABASE';
type BusinessCardFields = { name:string; company:string; department:string; title:string; mobile:string; phone:string; fax:string; email:string; address:string; website:string; notes:string; tags:string };
interface BusinessCardRecord extends BusinessCardFields { id:string; originalName:string; googleDriveUrl:string; backGoogleDriveUrl?:string|null; geminiModelCode:string; version:number; createdAt:string; updatedAt:string; deletedAt:string|null; createdByName:string }
interface Analysis { id:string; fields:BusinessCardFields; sourceSha256:string; modelCode:string; credentialSource:string; expiresAt:string }

const EMPTY_FIELDS: BusinessCardFields = { name:'',company:'',department:'',title:'',mobile:'',phone:'',fax:'',email:'',address:'',website:'',notes:'',tags:'' };
const FIELD_COPY: Array<{key:keyof BusinessCardFields;label:string;placeholder:string;wide?:boolean}> = [
  {key:'name',label:'이름 *',placeholder:'홍길동'}, {key:'company',label:'회사명',placeholder:'회사명'},
  {key:'department',label:'부서',placeholder:'기술본부'}, {key:'title',label:'직함',placeholder:'팀장 / 수석연구원'},
  {key:'mobile',label:'휴대전화',placeholder:'010-0000-0000'}, {key:'phone',label:'회사 전화',placeholder:'02-000-0000'},
  {key:'fax',label:'팩스',placeholder:'02-000-0001'}, {key:'email',label:'이메일',placeholder:'name@company.com'},
  {key:'website',label:'웹사이트',placeholder:'https://company.com',wide:true}, {key:'address',label:'주소',placeholder:'회사 주소',wide:true},
  {key:'tags',label:'검색 태그',placeholder:'발주처, 감정, 재건축',wide:true}, {key:'notes',label:'메모',placeholder:'명함에 표시된 추가 정보 또는 확인 메모',wide:true}
];

function idempotencyKey(): string { return `business-card:${crypto.randomUUID()}`; }

export function BusinessCardContacts({ mode, roles, onNavigate }: { mode:BusinessCardMode; roles:string[]; onNavigate:(path:string)=>void }): React.ReactElement {
  const isAdmin=roles.includes('admin'); const inputRef=useRef<HTMLInputElement|null>(null); const backInputRef=useRef<HTMLInputElement|null>(null);
  const [cards,setCards]=useState<BusinessCardRecord[]>([]); const [query,setQuery]=useState('');
  const [file,setFile]=useState<File|null>(null); const [previewUrl,setPreviewUrl]=useState('');
  const [backFile,setBackFile]=useState<File|null>(null); const [backPreviewUrl,setBackPreviewUrl]=useState('');
  const [analysis,setAnalysis]=useState<Analysis|null>(null); const [fields,setFields]=useState<BusinessCardFields>(EMPTY_FIELDS);
  const [busy,setBusy]=useState(''); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [analysisProgress,setAnalysisProgress]=useState<{status:AiGenerationStatus;error?:string}|null>(null);
  const [deleteTarget,setDeleteTarget]=useState<BusinessCardRecord|null>(null);
  const [incomingPhotos,setIncomingPhotos]=useState<{front:File;back:File}|null>(null);
  const incomingResolve=useRef<((accepted:boolean)=>void)|null>(null);
  const registrationKey=useRef('');
  const [pendingNavigation,setPendingNavigation]=useState<PendingNavigation|null>(null);
  const dirty=mode==='REGISTER'&&Boolean(file||backFile||analysis||Object.values(fields).some((value)=>value.trim()));

  const loadCards=useCallback(async(search='')=>{
    try{const result=await apiRequest<{cards:BusinessCardRecord[]}>(`/api/business-cards?q=${encodeURIComponent(search)}${mode==='DATABASE'?'&includeArchived=true':''}`);setCards(result.cards);setError('');}
    catch(reason){setError(reason instanceof Error?reason.message:'인맥 목록을 불러오지 못했습니다.');}
  },[mode]);
  useEffect(()=>{if(mode!=='REGISTER')void loadCards();},[loadCards,mode]);
  useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);
  useEffect(()=>()=>{if(backPreviewUrl)URL.revokeObjectURL(backPreviewUrl);},[backPreviewUrl]);
  useEffect(()=>()=>{incomingResolve.current?.(false);incomingResolve.current=null;},[]);
  useEffect(()=>registerNavigationBlocker((navigation)=>{if(mode!=='REGISTER'||(!dirty&&!busy))return false;if(busy){setError('처리가 끝난 뒤 이동해 주세요.');return true;}setPendingNavigation(navigation);return true;}),[mode,dirty,busy]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty||busy){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,busy]);

  const chooseFile=async(side:'front'|'back',selected:File|null)=>{
    if(!selected)return;
    setBusy('이미지 최적화');setError('');
    try{const compressed=await optimizeBusinessCard(selected);setAnalysis(null);if(side==='front'){setFile(compressed);setPreviewUrl(URL.createObjectURL(compressed));}else{setBackFile(compressed);setBackPreviewUrl(URL.createObjectURL(compressed));}setNotice('사진이 변경되었습니다. 앞면과 뒷면을 선택한 뒤 다시 인식해 주세요.');}
    catch(reason){setError(reason instanceof Error?reason.message:'이미지를 처리하지 못했습니다.');}
    finally{setBusy('');}
  };
  const applyReceivedFiles=(front:File,back:File)=>{setFile(front);setBackFile(back);setPreviewUrl(URL.createObjectURL(front));setBackPreviewUrl(URL.createObjectURL(back));setAnalysis(null);setError('');setNotice('휴대폰에서 두 사진을 받았습니다. 다시 인식하면 이전 입력값이 갱신됩니다.');};
  const receiveFiles=async(front:File,back:File):Promise<boolean>=>{
    if(busy)return false;
    if(file||backFile||analysis||Object.values(fields).some((value)=>value.trim()))return new Promise((resolve)=>{incomingResolve.current=resolve;setIncomingPhotos({front,back});});
    applyReceivedFiles(front,back);return true;
  };
  const finishIncoming=(accepted:boolean)=>{if(accepted&&incomingPhotos)applyReceivedFiles(incomingPhotos.front,incomingPhotos.back);setIncomingPhotos(null);incomingResolve.current?.(accepted);incomingResolve.current=null;};
  const analyze=async()=>{
    if(!file||!backFile)return;setBusy('Gemini 인식');setError('');setNotice('');setAnalysisProgress({status:'running'});
    try{const body=new FormData();body.set('file',file);body.set('backFile',backFile);const result=await apiRequest<{analysis:Analysis}>('/api/business-cards/analyze',{method:'POST',body,timeoutMs:55_000});registrationKey.current=idempotencyKey();setAnalysis(result.analysis);setFields(result.analysis.fields);setNotice('Gemini 인식 완료 · 앞면과 뒷면을 아래 값과 대조한 뒤 등록해 주세요.');setAnalysisProgress({status:'complete'});}
    catch(reason){const message=reason instanceof Error?reason.message:'Gemini 명함 인식에 실패했습니다.';setError(message);setAnalysisProgress({status:'error',error:message});}
    finally{setBusy('');}
  };
  const register=async()=>{
    if(!file||!backFile||!analysis||!registrationKey.current||!fields.name.trim())return;setBusy('Drive 저장·등록');setError('');setNotice('');
    try{const body=new FormData();body.set('file',file);body.set('backFile',backFile);body.set('analysisId',analysis.id);body.set('fields',JSON.stringify(fields));
      await apiRequest('/api/business-cards',{method:'POST',headers:{'Idempotency-Key':registrationKey.current},body});
      registrationKey.current='';setNotice('명함 앞면과 뒷면을 회사 Google Drive에 저장하고 인맥관리 목록에 등록했습니다.');setFile(null);setBackFile(null);setAnalysis(null);setFields(EMPTY_FIELDS);setPreviewUrl('');setBackPreviewUrl('');if(inputRef.current)inputRef.current.value='';if(backInputRef.current)backInputRef.current.value='';
    }catch(reason){setError(reason instanceof Error?reason.message:'명함 등록에 실패했습니다.');}
    finally{setBusy('');}
  };
  const changeArchive=async(card:BusinessCardRecord,archive:boolean)=>{
    if(!isAdmin||busy)return;setBusy(card.id);setError('');setNotice('');
    try{await apiRequest(`/api/business-cards/${encodeURIComponent(card.id)}`,{method:'PUT',body:JSON.stringify({action:archive?'ARCHIVE':'RESTORE',expectedVersion:card.version})});
      setCards(current=>mode==='LIST'&&archive?current.filter(item=>item.id!==card.id):current.map(item=>item.id===card.id?{...item,deletedAt:archive?new Date().toISOString():null,version:item.version+1}:item));
      setDeleteTarget(null);await loadCards(query);setNotice(archive?'명함을 목록에서 삭제했습니다. Drive 원본은 보존되며 명함 DB관리에서 복원할 수 있습니다.':'명함을 인맥관리 목록으로 복원했습니다.');}
    catch(reason){setError(reason instanceof Error?reason.message:'명함 상태를 변경하지 못했습니다.');}
    finally{setBusy('');}
  };
  const filteredCount=useMemo(()=>cards.filter((card)=>!card.deletedAt).length,[cards]);

  if(mode==='REGISTER')return <section className="route-view business-card-page" aria-labelledby="business-card-register-title">
    <AiGenerationProgressModal isOpen={Boolean(analysisProgress)} status={analysisProgress?.status??'running'} providerLabel="Gemini" title="Gemini가 명함 정보를 읽고 있습니다" description="촬영본을 안전하게 전송하고 이름·회사·부서·직함·연락처를 구조화하고 있습니다." stages={['AI 공급자 응답 대기','Gemini 글자·문맥 인식','연락처 필드 구조화','사람 검수용 결과 준비']} completeMessage="명함 인식이 완료되었습니다. 원본과 인식값을 대조하고 필요한 항목을 수정한 뒤 등록하세요." errorMessage={analysisProgress?.error} confirmLabel="인식값 확인·수정" timeoutHintSeconds={45} retryLabel="Gemini 인식 다시 시도" onRetry={()=>void analyze()} onConfirm={()=>setAnalysisProgress(null)} onClose={()=>setAnalysisProgress(null)}/>
    <div className="workspace-hero business-card-hero"><div><span className="workspace-eyebrow">GEMINI VISION · HUMAN VERIFIED</span><h2 id="business-card-register-title">명함 촬영본을 읽고<br/>안전하게 인맥으로 등록합니다.</h2><p>앞면·뒷면 촬영 → Gemini 구조화 인식 → 사람 확인·수정 → 회사 Google Drive 원본 저장 → 인맥 목록 등록 순서입니다.</p></div><div className="business-card-policy"><b>원본 저장 정책</b><strong>Google Drive 전용</strong><small>전송을 위해 최적화된 앞면·뒷면 촬영본을 각각 보관합니다.</small></div></div>
    <div className="business-card-register-grid"><Card title="1. 명함 촬영·업로드"><BusinessCardTransferPanel onReceive={receiveFiles}/><p className="business-card-upload-label">또는 이 기기에서 앞면과 뒷면을 각각 선택하세요.</p><div className="business-card-photo-grid"><label className="business-card-drop"><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={Boolean(busy)} onChange={(event)=>{void chooseFile('front',event.target.files?.[0]??null);event.target.value='';}}/>{previewUrl?<img src={previewUrl} alt="선택한 명함 앞면 미리보기"/>:<><strong>명함 앞면 선택</strong><span>JPG · PNG · WEBP</span></>}</label><label className="business-card-drop"><input ref={backInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={Boolean(busy)} onChange={(event)=>{void chooseFile('back',event.target.files?.[0]??null);event.target.value='';}}/>{backPreviewUrl?<img src={backPreviewUrl} alt="선택한 명함 뒷면 미리보기"/>:<><strong>명함 뒷면 선택</strong><span>JPG · PNG · WEBP</span></>}</label></div><Button onClick={()=>void analyze()} disabled={!file||!backFile||Boolean(busy)}>{busy==='Gemini 인식'?'Gemini가 읽는 중…':'2. Gemini로 앞·뒷면 인식'}</Button><small className="business-card-honest-note">AI 인식은 보조 기능입니다. 특수 글꼴·반사·작은 글자는 틀릴 수 있으므로 등록 전 반드시 앞면과 뒷면을 대조하세요.</small></Card>
    <Card title="3. 인식값 확인·수정"><div className="business-card-form">{FIELD_COPY.map((field)=><label key={field.key} className={field.wide?'is-wide':''}>{field.label}<input value={fields[field.key]} placeholder={field.placeholder} disabled={!analysis||Boolean(busy)} onChange={(event)=>setFields((current)=>({...current,[field.key]:event.target.value}))}/></label>)}</div><div className="business-card-register-actions"><Button variant="secondary" onClick={()=>onNavigate('/contacts')}>인맥 목록</Button><Button onClick={()=>void register()} disabled={!analysis||!fields.name.trim()||Boolean(busy)}>{busy==='Drive 저장·등록'?'Drive 저장·등록 중…':'4. 회사 Google Drive 저장 · 명함 등록'}</Button></div>{analysis&&<small>인식 모델 {analysis.modelCode} · 검수 세션은 30분 동안 유효합니다.</small>}</Card></div>
    {notice&&<p className="success-box" role="status">{notice}</p>}{error&&<p className="error-box" role="alert">{error}</p>}
    <Dialog isOpen={Boolean(incomingPhotos)} title="휴대폰 사진으로 교체할까요?" hideDefaultAction onClose={()=>finishIncoming(false)}><p>기존 앞면과 뒷면이 교체되고 인식 결과가 초기화됩니다. 현재 입력값은 유지되지만 다시 인식하면 갱신됩니다.</p><p>취소하면 기존 작업과 휴대폰 전송본을 그대로 보관합니다.</p><div className="action-row"><Button type="button" variant="secondary" onClick={()=>finishIncoming(false)}>기존 작업 유지</Button><Button type="button" onClick={()=>finishIncoming(true)}>사진 교체</Button></div></Dialog>
    <Dialog isOpen={Boolean(pendingNavigation)} title="명함 등록을 나갈까요?" hideDefaultAction onClose={()=>setPendingNavigation(null)}><p>아직 등록하지 않은 사진과 입력값은 이 화면을 나가면 사라집니다.</p><div className="action-row"><Button type="button" variant="secondary" onClick={()=>setPendingNavigation(null)}>계속 작성</Button><Button type="button" onClick={()=>{const navigation=pendingNavigation;setPendingNavigation(null);navigation?.proceed();}}>나가기</Button></div></Dialog>
  </section>;

  return <section className="route-view business-card-page" aria-labelledby="business-card-list-title">
    <div className="workspace-hero business-card-hero"><div><span className="workspace-eyebrow">CLAIM CENTER CONTACT NETWORK</span><h2 id="business-card-list-title">{mode==='DATABASE'?'명함 DB관리':'인맥관리'}</h2><p>{mode==='DATABASE'?'관리자가 명함 등록 이력과 보관 상태를 관리합니다. 물리 삭제 없이 Drive 원본과 감사이력을 보존합니다.':'등록된 명함을 이름·회사·부서·직함·전화·이메일·태그로 빠르게 찾습니다.'}</p></div><div className="business-card-kpi"><b>{mode==='DATABASE'?'활성 명함':'검색 가능 인맥'}</b><strong>{filteredCount}</strong><small>등록된 연락처</small></div></div>
    <Card title="통합 검색"><form className="business-card-search" onSubmit={(event)=>{event.preventDefault();void loadCards(query);}}><Input label="검색어" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="이름·회사·부서·전화·이메일·태그"/><Button type="submit">검색</Button><Button type="button" variant="secondary" onClick={()=>onNavigate('/contacts/cards/new')}>+ 명함 등록</Button></form></Card>
    {notice&&<p className="success-box" role="status">{notice}</p>}{error&&<p className="error-box" role="alert">{error}</p>}
    <div className="business-card-list">{cards.length?cards.map((card)=><article key={card.id} className={card.deletedAt?'is-archived':''}><header><div className="business-card-avatar" aria-hidden="true">{card.name.slice(0,1)}</div><div><h3>{card.name}</h3><p>{[card.company,card.department,card.title].filter(Boolean).join(' · ')||'소속 정보 없음'}</p></div>{card.deletedAt&&<span>보관됨</span>}</header><dl><div><dt>휴대전화</dt><dd>{card.mobile||'-'}</dd></div><div><dt>전화</dt><dd>{card.phone||'-'}</dd></div><div><dt>이메일</dt><dd>{card.email||'-'}</dd></div><div><dt>주소</dt><dd>{card.address||'-'}</dd></div></dl>{card.tags&&<p className="business-card-tags">{card.tags}</p>}<footer><small>{card.createdByName} · {new Date(card.createdAt).toLocaleDateString('ko-KR')} · {card.geminiModelCode}</small><div><a href={card.googleDriveUrl} target="_blank" rel="noreferrer noopener">{card.backGoogleDriveUrl?'앞면 원본':'Drive 원본'}</a>{card.backGoogleDriveUrl&&<a href={card.backGoogleDriveUrl} target="_blank" rel="noreferrer noopener">뒷면 원본</a>}{isAdmin&&<button type="button" aria-label={`${card.name} 명함 ${card.deletedAt?'복원':'삭제'}`} disabled={Boolean(busy)} onClick={()=>card.deletedAt?void changeArchive(card,false):setDeleteTarget(card)}>{card.deletedAt?'복원':'삭제'}</button>}</div></footer></article>):<p className="empty-box">검색 조건에 맞는 인맥이 없습니다. 명함을 등록하면 이곳에서 바로 찾을 수 있습니다.</p>}</div>
    <Dialog isOpen={Boolean(deleteTarget)} title="명함을 목록에서 삭제할까요?" hideDefaultAction onClose={()=>{if(!busy)setDeleteTarget(null);}}>
      <p><strong>{deleteTarget?.name}</strong>{deleteTarget?.company?` · ${deleteTarget.company}`:''}</p><p>인맥 목록에서 삭제합니다. 회사 Google Drive 원본과 감사이력은 보존되며, 관리자가 명함 DB관리에서 복원할 수 있습니다.</p>
      {error&&<p className="error-box" role="alert">{error}</p>}
      <div className="action-row"><Button variant="secondary" disabled={Boolean(busy)} onClick={()=>setDeleteTarget(null)}>취소</Button><Button disabled={Boolean(busy)} onClick={()=>{if(deleteTarget)void changeArchive(deleteTarget,true);}}>{busy?'삭제 중…':'목록에서 삭제'}</Button></div>
    </Dialog>
  </section>;
}
