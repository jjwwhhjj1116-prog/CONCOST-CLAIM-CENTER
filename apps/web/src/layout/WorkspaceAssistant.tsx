import React, { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '../api';
import { ROUTES, canAccessRoute, type UserRole } from '../routes/Router';
import { assistantGuides, assistantPath, assistantFacts, ASSISTANT_MANUAL_VERSION, ASSISTANT_ROUTES, ASSISTANT_TARGETS, type AssistantGuide, type AssistantProject, type AssistantReply, type AssistantQuota } from './workspace-assistant-guide';
import './WorkspaceAssistant.css';

interface Props { currentPath: string; currentSearch: string; roles: UserRole[]; suspended: boolean; open: boolean; onOpenChange(open: boolean): void; onNavigate(path: string): void }
const suggestions = ['처음인데 어떤 순서로 작업해야 해?', 'HWP 보고서는 어떻게 불러와?', '왜 보고서 출력이 안 돼?', '주간 업무일지는 어떻게 보내?'];
export function WorkspaceAssistant({ currentPath, currentSearch, roles, suspended, open, onOpenChange: setOpen, onNavigate }: Props) {
  const [question, setQuestion] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [quota, setQuota] = useState<AssistantQuota | null>(null);
  const [quotaError, setQuotaError] = useState('');
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<AssistantProject[]>([]);
  const [caseId, setCaseId] = useState('');
  const [messages, setMessages] = useState<{ id: number; contextKey: string; question: string; reply: AssistantReply }[]>([]);
  const [pendingRequest, setPendingRequest] = useState<{ question: string; routeId: string; caseId: string | null; useAi: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [error, setError] = useState('');
  const [projectError, setProjectError] = useState('');
  const [hint, setHint] = useState('');
  const [pendingGuide, setPendingGuide] = useState<{ guide: AssistantGuide; path: string } | null>(null);
  const [mobile, setMobile] = useState(() => window.innerWidth <= 760);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const answerEnd = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const appliedRouteContext = useRef<string | null>(null);
  const routeId = ASSISTANT_ROUTES.find(route => route[1] === currentPath)?.[0] ?? '';
  useEffect(() => { const resize = () => setMobile(window.innerWidth <= 760); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useEffect(() => () => { request.current?.abort(); sequence.current += 1; }, []);
  useEffect(() => {
    if (!open || suspended) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingProjects(true); setProjectError('');
      void apiRequest<{ projects: AssistantProject[] }>(`/api/workspace-assistant?q=${encodeURIComponent(query)}`, { signal: controller.signal }).then(result => {
        if (controller.signal.aborted) return;
        setProjects(result.projects);
        const contextCase = new URLSearchParams(currentSearch).get('caseId');
        if (appliedRouteContext.current !== currentSearch && contextCase && result.projects.some(project => project.id === contextCase)) setCaseId(contextCase);
        else setCaseId(current => result.projects.some(project => project.id === current) ? current : '');
        appliedRouteContext.current = currentSearch;
      }).catch(() => { if (!controller.signal.aborted) setProjectError('배정 프로젝트를 불러오지 못했습니다. 검색어를 바꿔 재시도하거나 매뉴얼 안내를 이용하세요.'); }).finally(() => { if (!controller.signal.aborted) setLoadingProjects(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, suspended, query, currentSearch]);
  const applyQuota = (next: AssistantQuota) => setQuota(current => {
    if (!current || Date.parse(next.resetsAt)>Date.parse(current.resetsAt)) return next;
    if (next.resetsAt!==current.resetsAt || next.used<current.used) return current;
    return next;
  });
  const refreshQuota = async () => {
    try { const result = await apiRequest<{quota:AssistantQuota}>('/api/workspace-assistant?quota=1'); applyQuota(result.quota); setQuotaError(''); }
    catch { setQuota(null); setQuotaError('AI 남은 횟수를 불러오지 못했습니다. 기본 안내는 계속 이용할 수 있습니다.'); }
  };
  useEffect(() => {
    if (!open || suspended) return;
    void refreshQuota();
    const focus = () => void refreshQuota();
    window.addEventListener('focus',focus);
    const timer = quota ? window.setTimeout(focus,Math.max(1000,Date.parse(quota.resetsAt)-Date.now()+100)) : undefined;
    return () => {window.removeEventListener('focus',focus);window.clearTimeout(timer);};
  },[open,suspended,quota?.resetsAt]);
  useEffect(() => { if (open && !suspended) input.current?.focus(); }, [open, suspended]);
  useEffect(() => {
    if (!open || suspended) return;
    const background = document.querySelector<HTMLElement>('.shell-body');
    const wasInert = background?.inert ?? false;
    if (mobile && background) background.inert = true;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (mobile || panel.current?.contains(document.activeElement) || document.activeElement === document.body)) { event.preventDefault(); event.stopPropagation(); setOpen(false); window.requestAnimationFrame(() => launcher.current?.focus()); }
      if (mobile && event.key === 'Tab') {
        const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, summary') ?? [])].filter(node => node.getClientRects().length > 0);
        const first = nodes[0], last = nodes.at(-1);
        if (!panel.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', keyboard, true);
    return () => { window.removeEventListener('keydown', keyboard, true); if (mobile && background) background.inert = wasInert; };
  }, [open, suspended, mobile]);
  useEffect(() => { answerEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy, error]);
  useEffect(() => {
    if (!pendingGuide || currentPath + currentSearch !== pendingGuide.path) return;
    const target = ASSISTANT_TARGETS[pendingGuide.guide.id];
    if (!target) { setHint('이 화면의 참고 매뉴얼에서 작업 순서를 확인하세요.'); setPendingGuide(null); return; }
    let element: HTMLElement | undefined;
    const find = () => {
      element = [...document.querySelectorAll<HTMLElement>(target.selector)].find(node => node.getClientRects().length > 0 && (!target.text || node.textContent?.includes(target.text)));
      if (!element) return false;
      element.scrollIntoView({ block: 'center', behavior: 'auto' });
      element.classList.add('workspace-assistant-highlight');
      setHint(`${target.label} 위치를 표시했습니다. 필요한 기능은 직접 선택하세요.`);
      return true;
    };
    const observer = new MutationObserver(() => { if (find()) observer.disconnect(); });
    if (!find()) observer.observe(document.getElementById('main-content') ?? document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => { observer.disconnect(); if (!element) setHint(`현재 단계에는 ‘${target.label}’가 보이지 않습니다. 매뉴얼의 단계·권한을 확인하세요.`); element?.classList.remove('workspace-assistant-highlight'); setPendingGuide(null); }, 6000);
    return () => { observer.disconnect(); window.clearTimeout(timer); element?.classList.remove('workspace-assistant-highlight'); };
  }, [pendingGuide, currentPath, currentSearch]);
  useEffect(() => { if (!pendingGuide) return; const timer = window.setTimeout(() => setPendingGuide(null), 12_000); return () => window.clearTimeout(timer); }, [pendingGuide]);
  const close = () => { setOpen(false); window.requestAnimationFrame(() => launcher.current?.focus()); };
  const send = async (value = question) => {
    if (!value.trim() || busy || useAi && (!quota || quota.remaining <= 0)) return;
    const controller = new AbortController(); request.current = controller; const current = ++sequence.current;
    const contextKey = JSON.stringify([routeId, caseId || null]);
    setBusy(true); setError(''); setPendingRequest({ question: value, routeId, caseId: caseId || null, useAi });
    try {
      const reply = await apiRequest<AssistantReply>('/api/workspace-assistant', { method: 'POST', body: JSON.stringify({ question: value.trim(), useAi, routeId, caseId: caseId || null, previousQuestion: messages.filter(message => message.contextKey === contextKey).at(-1)?.question ?? '' }), signal: controller.signal, timeoutMs: 30_000 });
      if (current !== sequence.current) return;
      if (reply.quota) applyQuota(reply.quota);
      setMessages(previous => [...previous.slice(-5), { id: current, contextKey, question: value, reply }]);
      setPendingRequest(null);
      setQuestion(currentQuestion => currentQuestion === value ? '' : currentQuestion);
    } catch (reason) {
      if (!controller.signal.aborted) {
        if (reason instanceof ApiError && reason.payload.quota) applyQuota(reason.payload.quota as unknown as AssistantQuota);
        else if (useAi) void refreshQuota();
        setError(reason instanceof Error ? reason.message : '답변을 불러오지 못했습니다. 질문을 유지했으니 다시 보내세요.');
      }
    } finally { if (current === sequence.current) setBusy(false); }
  };
  const navigate = (guide: AssistantGuide, project: string | null, locate: boolean) => {
    const route = ROUTES.find(candidate => candidate.id === guide.id);
    if (!route || !canAccessRoute(route, roles)) { setError('현재 계정에서 열 수 있는 화면이 아닙니다.'); return; }
    const path = assistantPath(guide, project);
    setHint(''); setOpen(false); setPendingGuide(locate ? { guide, path } : null);
    if (path !== currentPath + currentSearch) onNavigate(path);
  };
  if (suspended) return null;
  const localSources = assistantGuides(pendingRequest?.question ?? (question || '처음 작업 순서'), pendingRequest?.routeId ?? routeId);
  return <>
    <button ref={launcher} className="workspace-assistant-launcher" type="button" aria-label="업무 도우미" title="업무 도우미 열기" aria-haspopup="dialog" aria-expanded={open} aria-controls="workspace-assistant-panel" onClick={() => setOpen(!open)}>
      <ChatIcon /><span aria-hidden="true">?</span>
    </button>
    {open && <aside ref={panel} id="workspace-assistant-panel" className="workspace-assistant-panel" role="dialog" aria-modal={mobile ? true : undefined} aria-label="업무 도우미">
      <header><div className="workspace-assistant-heading"><ChatIcon /><div><h2>업무 도우미</h2><p>기본 안내 · 선택형 Gemini 질문</p></div></div><button type="button" aria-label="업무 도우미 닫기" onClick={close}>×</button></header>
      <details className="workspace-assistant-context">
        <summary>프로젝트 연결 <span>{projects.find(project => project.id === caseId)?.caseNumber ?? '선택 사항'}</span></summary>
        <div className="workspace-assistant-context-fields">
        <label>본인 배정 프로젝트 검색<input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} placeholder="프로젝트명 또는 번호" /></label>
        <label>상태를 확인할 프로젝트<select aria-label="상태를 확인할 프로젝트" value={caseId} onChange={event => setCaseId(event.target.value)}><option value="">프로젝트 선택 없이 사용법 안내</option>{projects.map(project => <option key={project.id} value={project.id}>{project.caseNumber} · {project.title}</option>)}</select></label>
        {loadingProjects && <small role="status">배정 프로젝트 조회 중…</small>}
        {projectError && <p role="alert">{projectError}</p>}
        {!loadingProjects && !projectError && projects.length === 0 && <small>배정된 검색 결과가 없습니다. 사용법 안내는 계속 이용할 수 있습니다.</small>}
        </div>
      </details>
      <div className="workspace-assistant-conversation" role="log" aria-label="질문과 답변" aria-live="polite" aria-busy={busy}>
        {!messages.length && !pendingRequest && <div className="workspace-assistant-welcome"><div className="workspace-assistant-bubble"><strong>업무 도우미</strong><p>안녕하세요. 기본 안내는 무료 매뉴얼 답변입니다. 더 풀어서 설명이 필요하면 아래 ‘AI로 질문하기’를 켜세요.</p><p>궁금한 업무를 질문하거나 아래 질문을 선택해 보세요.</p></div><div className="workspace-assistant-suggestions">{suggestions.map(value => <button type="button" key={value} disabled={busy} onClick={() => { setQuestion(value); void send(value); }}>{value}</button>)}</div></div>}
        {messages.map(message => <article className="workspace-assistant-answer" key={message.id}>
          <div className="workspace-assistant-user"><small>나</small><p>{message.question}</p></div>
          <div className="workspace-assistant-bubble"><strong>업무 도우미</strong><small>{message.reply.mode === 'AI' ? 'Gemini 답변' : '매뉴얼 자동 안내'} · {message.reply.manualVersion}</small>
          <p className="workspace-assistant-answer-text">{message.reply.answer}</p>
          {message.reply.notice && <p className="workspace-assistant-notice" role="status">{message.reply.notice}</p>}
          {message.reply.snapshot && <details className="workspace-assistant-facts" aria-label="실제 서버 저장 상태"><summary>내 프로젝트 저장 상태 · {message.reply.snapshot.caseNumber}</summary><strong>{message.reply.snapshot.title}</strong><ul>{assistantFacts(message.reply.snapshot).map(fact => <li key={fact}>{fact}</li>)}</ul><small>조회 {new Date(message.reply.observedAt).toLocaleString('ko-KR')} · 화면 미저장 입력 제외</small></details>}
          <Sources guides={message.reply.sources} roles={roles} onNavigate={(guide, locate) => navigate(guide, message.reply.snapshot?.id ?? null, locate)} />
          </div>
        </article>)}
        {pendingRequest && <div className="workspace-assistant-user"><small>나</small><p>{pendingRequest.question}</p></div>}
        {busy && <p className="workspace-assistant-bubble workspace-assistant-typing" role="status">{pendingRequest?.useAi ? 'Gemini 답변을 기다리고 있어요…' : '매뉴얼을 찾아 답변을 준비하고 있어요…'}</p>}
        {error && <p className="workspace-assistant-error" role="alert">{error}</p>}
        {error && <Sources guides={localSources} roles={roles} onNavigate={(guide, locate) => navigate(guide, pendingRequest ? pendingRequest.caseId : caseId || null, locate)} />}
        <div ref={answerEnd} />
      </div>
      <form className="workspace-assistant-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
        <div className="workspace-assistant-mode"><label><input type="checkbox" role="switch" aria-label="AI로 질문하기" checked={useAi} disabled={busy} onChange={event => {setUseAi(event.target.checked);setError('');if(event.target.checked)void refreshQuota();}}/>AI로 질문하기</label><small role="status">{quota ? `오늘 ${quota.remaining}/${quota.limit}회 남음` : 'AI 횟수 확인 중'}</small></div>
        {quotaError && <p role="status">{quotaError}</p>}
        {useAi && <p className="workspace-assistant-ai-consent">현재 질문과 관련 매뉴얼만 Gemini 3.1 Flash-Lite로 전송합니다. 저장된 프로젝트 본문·상태는 자동 전송하지 않습니다.</p>}
        {useAi && quota?.remaining === 0 && <p role="status">오늘 AI 질문을 모두 사용했습니다. 토글을 끄면 기본 안내를 계속 이용할 수 있습니다.</p>}
        <label htmlFor="workspace-assistant-question"><span>업무 질문</span><textarea id="workspace-assistant-question" ref={input} value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }} maxLength={600} rows={2} placeholder="궁금한 업무를 물어보세요…" /></label>
        <div><small>{question.length}/600</small><button type="submit" disabled={busy || !question.trim() || useAi && (!quota || quota.remaining <= 0)}>{busy ? '답변 확인 중…' : '질문 보내기'}</button></div>
        <p>비밀번호·키·고객 원문은 입력하지 마세요.</p>
        <details className="workspace-assistant-privacy"><summary>사용 방법·AI 한도 안내</summary><ol><li>아이콘을 열고 질문을 입력하세요. 기본 안내는 횟수 제한 없이 무료로 제공합니다.</li><li>‘AI로 질문하기’를 켜면 Gemini 3.1 Flash-Lite가 질문에 관련된 매뉴얼만 참고해 설명합니다. 관련 항목이 없으면 AI를 호출하거나 횟수를 차감하지 않습니다. 계정당 하루 20회, 한국시간 자정에 초기화됩니다. 전송 후 실패한 시도도 1회입니다. 자동 재시도·다른 모델 전환은 하지 않습니다.</li><li>프로젝트 상태·업무 실행 요청은 기본 안내로 답하고 AI 횟수를 차감하지 않습니다. 참고 매뉴얼을 펼쳐 해당 화면·버튼 위치로 이동하세요.</li></ol><p>AI는 기존 회사 Gemini 연결을 사용합니다. Google 프로젝트 한도는 공유되며 회사 키의 요금제에 따라 비용이 발생할 수 있습니다. 앱의 20회는 Google 무료 할당량과 별개입니다. 저장된 프로젝트 원문·상태는 자동 전송하지 않습니다. 입력한 질문은 전송됩니다. 비밀번호·키·고객 원문을 질문에 입력하지 마세요. 저장·상신·승인은 기존 화면에서 진행합니다.</p></details>
      </form>
    </aside>}
    {hint && !open && <div className="workspace-assistant-location" role="status"><p>{hint}</p><button type="button" onClick={() => { setHint(''); setPendingGuide(null); }}>위치 안내 닫기</button></div>}
  </>;
}
function ChatIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-6 4v-4H3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></svg>;
}
function Sources({ guides, roles, onNavigate }: { guides: AssistantGuide[]; roles: UserRole[]; onNavigate(guide: AssistantGuide, locate: boolean): void }) {
  return <details className="workspace-assistant-sources"><summary>참고 매뉴얼 {guides.length}건 · {ASSISTANT_MANUAL_VERSION}</summary>{guides.map(guide => {
    const route = ROUTES.find(candidate => candidate.id === guide.id); const accessible = route && canAccessRoute(route, roles);
    return <details key={guide.id}><summary>{guide.title}</summary><ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol><p>다음 절차: {guide.next}</p>{accessible && <div><button type="button" onClick={() => onNavigate(guide, false)}>해당 화면 열기</button>{ASSISTANT_TARGETS[guide.id] && <button type="button" onClick={() => onNavigate(guide, true)}>버튼 위치 보기</button>}</div>}</details>;
  })}</details>;
}
