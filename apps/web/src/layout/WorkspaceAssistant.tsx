import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api';
import { ROUTES, canAccessRoute, type UserRole } from '../routes/Router';
import { assistantGuides, assistantPath, assistantFacts, ASSISTANT_MANUAL_VERSION, ASSISTANT_ROUTES, ASSISTANT_TARGETS, type AssistantGuide, type AssistantProject, type AssistantReply } from './workspace-assistant-guide';
import './WorkspaceAssistant.css';

interface Props { currentPath: string; currentSearch: string; roles: UserRole[]; suspended: boolean; open: boolean; onOpenChange(open: boolean): void; onNavigate(path: string): void }
const suggestions = ['처음인데 어떤 순서로 작업해야 해?', 'HWP 보고서는 어떻게 불러와?', '왜 보고서 출력이 안 돼?', '주간 업무일지는 어떻게 보내?'];
export function WorkspaceAssistant({ currentPath, currentSearch, roles, suspended, open, onOpenChange: setOpen, onNavigate }: Props) {
  const [question, setQuestion] = useState('');
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<AssistantProject[]>([]);
  const [caseId, setCaseId] = useState('');
  const [messages, setMessages] = useState<{ id: number; contextKey: string; question: string; reply: AssistantReply }[]>([]);
  const [pendingRequest, setPendingRequest] = useState<{ question: string; routeId: string; caseId: string | null } | null>(null);
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
    if (!value.trim() || busy) return;
    const controller = new AbortController(); request.current = controller; const current = ++sequence.current;
    const contextKey = JSON.stringify([routeId, caseId || null]);
    setBusy(true); setError(''); setPendingRequest({ question: value, routeId, caseId: caseId || null });
    try {
      const reply = await apiRequest<AssistantReply>('/api/workspace-assistant', { method: 'POST', body: JSON.stringify({ question: value.trim(), routeId, caseId: caseId || null, previousQuestion: messages.filter(message => message.contextKey === contextKey).at(-1)?.question ?? '' }), signal: controller.signal, timeoutMs: 30_000 });
      if (current !== sequence.current) return;
      setMessages(previous => [...previous.slice(-5), { id: current, contextKey, question: value, reply }]);
      setPendingRequest(null);
      setQuestion(currentQuestion => currentQuestion === value ? '' : currentQuestion);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '답변을 불러오지 못했습니다. 질문을 유지했으니 다시 보내세요.');
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
    <button ref={launcher} className="workspace-assistant-launcher" type="button" aria-label="AI 업무 도우미" title="AI 업무 도우미 열기" aria-haspopup="dialog" aria-expanded={open} aria-controls="workspace-assistant-panel" onClick={() => setOpen(!open)}>
      <ChatIcon /><span aria-hidden="true">AI</span>
    </button>
    {open && <aside ref={panel} id="workspace-assistant-panel" className="workspace-assistant-panel" role="dialog" aria-modal={mobile ? true : undefined} aria-label="AI 업무 도우미">
      <header><div className="workspace-assistant-heading"><ChatIcon /><div><h2>AI 업무 도우미</h2><p>클레임 업무, 무엇이 궁금하세요?</p></div></div><button type="button" aria-label="AI 업무 도우미 닫기" onClick={close}>×</button></header>
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
        {!messages.length && !pendingRequest && <div className="workspace-assistant-welcome"><div className="workspace-assistant-bubble"><strong>AI 업무 도우미</strong><p>안녕하세요. 의뢰부터 결재·출력까지, 현재 매뉴얼을 찾아 안내해 드릴게요.</p><p>궁금한 업무를 질문하거나 아래 질문을 선택해 보세요.</p></div><div className="workspace-assistant-suggestions">{suggestions.map(value => <button type="button" key={value} disabled={busy} onClick={() => { setQuestion(value); void send(value); }}>{value}</button>)}</div></div>}
        {messages.map(message => <article className="workspace-assistant-answer" key={message.id}>
          <div className="workspace-assistant-user"><small>나</small><p>{message.question}</p></div>
          <div className="workspace-assistant-bubble"><strong>AI 업무 도우미</strong><small>{message.reply.mode === 'AI' ? 'AI 매뉴얼 안내' : '매뉴얼·저장 상태 안내'} · {message.reply.manualVersion}</small>
          <p className="workspace-assistant-answer-text">{message.reply.answer}</p>
          {message.reply.notice && <p className="workspace-assistant-notice" role="status">{message.reply.notice}</p>}
          {message.reply.snapshot && <details className="workspace-assistant-facts" aria-label="실제 서버 저장 상태"><summary>내 프로젝트 저장 상태 · {message.reply.snapshot.caseNumber}</summary><strong>{message.reply.snapshot.title}</strong><ul>{assistantFacts(message.reply.snapshot).map(fact => <li key={fact}>{fact}</li>)}</ul><small>조회 {new Date(message.reply.observedAt).toLocaleString('ko-KR')} · 화면 미저장 입력 제외</small></details>}
          <Sources guides={message.reply.sources} roles={roles} onNavigate={(guide, locate) => navigate(guide, message.reply.snapshot?.id ?? null, locate)} />
          </div>
        </article>)}
        {pendingRequest && <div className="workspace-assistant-user"><small>나</small><p>{pendingRequest.question}</p></div>}
        {busy && <p className="workspace-assistant-bubble workspace-assistant-typing" role="status">매뉴얼을 찾아 답변을 준비하고 있어요…</p>}
        {error && <p className="workspace-assistant-error" role="alert">{error}</p>}
        {error && <Sources guides={localSources} roles={roles} onNavigate={(guide, locate) => navigate(guide, pendingRequest ? pendingRequest.caseId : caseId || null, locate)} />}
        <div ref={answerEnd} />
      </div>
      <form className="workspace-assistant-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
        <label htmlFor="workspace-assistant-question"><span>업무 질문</span><textarea id="workspace-assistant-question" ref={input} value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }} maxLength={600} rows={2} placeholder="궁금한 업무를 물어보세요…" /></label>
        <div><small>{question.length}/600</small><button type="submit" disabled={busy || !question.trim()}>{busy ? '답변 확인 중…' : '질문 보내기'}</button></div>
        <p>비밀번호·키·고객 원문은 입력하지 마세요.</p>
        <details className="workspace-assistant-privacy"><summary>질문 전송·업무 처리 안내</summary><p>질문과 관련 매뉴얼을 회사 AI로 전송합니다. 프로젝트 본문은 자동 전송하지 않으며, 저장·상신·승인은 기존 화면에서 진행합니다.</p></details>
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
