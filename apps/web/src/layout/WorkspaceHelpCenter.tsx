import { Button, Dialog } from '@claim-studio/ui';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, apiRequest } from '../api';
import { CATEGORY_HELP, CURRENT_TUTORIAL_VERSION, ROUTE_HELP, WORKSPACE_TUTORIAL_STEPS } from './workspace-help-content';

interface TutorialState {
  completedTutorialVersion: string | null;
  completedAt: string | null;
  completionAction: 'COMPLETED' | 'SKIPPED' | null;
  version: number;
  updatedAt: string | null;
}

interface TutorialTargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\/+$/u, '') || '/';
  return normalize(left) === normalize(right);
}

export function WorkspaceHelpCenter({ category, routeId, previewMode, onNavigate }: {
  category: string;
  routeId?: string;
  previewMode: boolean;
  onNavigate: (path: string) => void;
}): React.ReactElement {
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialState, setTutorialState] = useState<TutorialState>({ completedTutorialVersion: null, completedAt: null, completionAction: null, version: 0, updatedAt: null });
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [targetRects, setTargetRects] = useState<TutorialTargetRect[]>([]);
  const [coachCollapsed, setCoachCollapsed] = useState(false);
  const categoryHelp = CATEGORY_HELP[category] ?? CATEGORY_HELP.home;
  const routeHelp = routeId ? ROUTE_HELP[routeId] : undefined;
  const step = WORKSPACE_TUTORIAL_STEPS[tutorialStep] ?? WORKSPACE_TUTORIAL_STEPS[0];
  const progress = useMemo(() => Math.round(((tutorialStep + 1) / WORKSPACE_TUTORIAL_STEPS.length) * 100), [tutorialStep]);
  const currentScreenOpen = tutorialOpen && visitedSteps.has(tutorialStep) && samePath(window.location.pathname, step.path);

  useEffect(() => {
    if (!previewMode) return;
    let active = true;
    void apiRequest<{ tutorial: TutorialState; currentTutorialVersion: string }>('/api/settings/tutorial')
      .then((result) => {
        if (!active) return;
        setTutorialState(result.tutorial);
        if (result.tutorial.completedTutorialVersion !== CURRENT_TUTORIAL_VERSION) setTutorialOpen(true);
      })
      .catch(() => {
        if (active && window.localStorage.getItem('claim-center-tutorial-fallback') !== CURRENT_TUTORIAL_VERSION) setTutorialOpen(true);
      });
    return () => { active = false; };
  }, [previewMode]);

  useEffect(() => {
    if (!currentScreenOpen) { setTargetRects([]); return; }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const used = new Set<Element>();
        const fallback = Array.from(document.querySelectorAll('#main-content h1, #main-content h2, #main-content h3, #main-content form, #main-content button, #main-content select, #main-content textarea'));
        const elements = step.targetSelectors.map((selector, index) => {
          const explicit = document.querySelector(selector);
          if (explicit && !used.has(explicit)) { used.add(explicit); return explicit; }
          const replacement = fallback.find((candidate) => !used.has(candidate) && candidate.getBoundingClientRect().width > 20 && candidate.getBoundingClientRect().height > 14);
          if (replacement) used.add(replacement);
          return replacement ?? fallback[index] ?? null;
        });
        const next = elements.filter((element): element is Element => Boolean(element)).map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: Math.max(4, rect.left), top: Math.max(4, rect.top), width: Math.max(28, Math.min(rect.width, window.innerWidth - Math.max(4, rect.left) - 4)), height: Math.max(24, Math.min(rect.height, window.innerHeight - Math.max(4, rect.top) - 4)) };
        }).filter((rect) => rect.left < window.innerWidth && rect.top < window.innerHeight);
        setTargetRects(next);
      });
    };
    measure();
    const main = document.getElementById('main-content');
    const observer = new MutationObserver(measure);
    if (main) observer.observe(main, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const delayed = window.setTimeout(measure, 500);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(delayed); observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [currentScreenOpen, step.targetSelectors]);

  const saveTutorialDecision = async (action: 'COMPLETED' | 'SKIPPED') => {
    if (saving) return;
    setSaving(true); setNotice('');
    try {
      const result = await apiRequest<{ tutorial: TutorialState }>('/api/settings/tutorial', {
        method: 'PUT', body: JSON.stringify({ tutorialVersion: CURRENT_TUTORIAL_VERSION, expectedVersion: tutorialState.version, action })
      });
      setTutorialState(result.tutorial);
      window.localStorage.setItem('claim-center-tutorial-fallback', CURRENT_TUTORIAL_VERSION);
      setTutorialOpen(false); setTutorialStep(0); setVisitedSteps(new Set());
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        const latest = await apiRequest<{ tutorial: TutorialState }>('/api/settings/tutorial').catch(() => null);
        if (latest?.tutorial.completedTutorialVersion === CURRENT_TUTORIAL_VERSION) {
          setTutorialState(latest.tutorial); setTutorialOpen(false); setTutorialStep(0); setVisitedSteps(new Set()); return;
        }
      }
      setNotice('완료 상태를 저장하지 못했습니다. 네트워크를 확인한 뒤 다시 눌러 주세요. 안내 내용은 사라지지 않습니다.');
    } finally { setSaving(false); }
  };

  const reopenTutorial = () => {
    setHelpOpen(false); setTutorialStep(0); setVisitedSteps(new Set()); setNotice(''); setCoachCollapsed(false); setTutorialOpen(true);
  };

  const visitTutorialStep = () => {
    setVisitedSteps((current) => new Set(current).add(tutorialStep));
    setCoachCollapsed(false);
    onNavigate(step.path);
  };

  const moveTutorialStep = (next: number) => {
    setTutorialStep(next);
    setCoachCollapsed(false);
    setTargetRects([]);
  };

  return <>
    <button type="button" className="theme-toggle workspace-help-trigger" aria-label="현재 화면 도움말 열기" onClick={() => setHelpOpen(true)}>
      <span aria-hidden="true">?</span><strong>도움말</strong>
    </button>
    {tutorialOpen && createPortal(<div className={`workspace-tutorial-layer${currentScreenOpen ? ' is-guiding' : ''}`}>
      {currentScreenOpen && <div className="workspace-tutorial-targets" aria-hidden="true">{targetRects.map((rect, index) => <div className="workspace-tutorial-target" key={`${tutorialStep}-${index}`} style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}><span>{index + 1}</span></div>)}</div>}
      <aside className={`workspace-tutorial-coach${coachCollapsed ? ' is-collapsed' : ''}`} role="complementary" aria-label="처음 사용하는 분을 위한 클레임센터 업무 순서" data-step={tutorialStep + 1}>
        <div className="workspace-tutorial-coach__bar"><span>{currentScreenOpen ? '실제 화면 안내 중' : '처음 사용 가이드'}</span><div><button type="button" onClick={() => setCoachCollapsed((value) => !value)}>{coachCollapsed ? '안내 펼치기' : '안내 접기'}</button><button type="button" aria-label="튜토리얼 닫기" onClick={() => setTutorialOpen(false)}>×</button></div></div>
        {!coachCollapsed && <div className="workspace-tutorial">
        <header><span>{step.eyebrow}</span><strong>{tutorialStep + 1} / {WORKSPACE_TUTORIAL_STEPS.length}</strong></header>
        <div className="workspace-tutorial__progress" aria-label={`튜토리얼 ${progress}% 완료`}><i style={{ width: `${progress}%` }} /></div>
        <section><h3>{step.title}</h3><p>{step.explanation}</p><ol>{step.tasks.map((task, index) => <li key={task} className={currentScreenOpen && index < targetRects.length ? 'is-on-screen' : ''}><span>{index + 1}</span>{task}</li>)}</ol></section>
        <aside><strong>이 단계의 완료 기준</strong><p>{step.completion}</p></aside>
        <div className={`workspace-tutorial__visit ${visitedSteps.has(tutorialStep) ? 'is-visited' : ''}`}>
          <div><strong>{currentScreenOpen ? '배경 화면에 표시된 ①②③를 보세요' : visitedSteps.has(tutorialStep) ? '이 화면을 다시 열 수 있어요' : '먼저 실제 화면을 열어 보세요'}</strong><span>{currentScreenOpen ? '바탕을 흐리게 하지 않았습니다. 숫자가 표시된 실제 버튼과 입력란을 직접 눌러보세요.' : '이 패널은 한쪽에만 남고 실제 화면은 그대로 보입니다.'}</span></div>
          <Button variant="secondary" onClick={visitTutorialStep}>{visitedSteps.has(tutorialStep) ? '화면 다시 열기' : step.pathLabel}</Button>
        </div>
        {notice && <p className="error-box" role="alert">{notice}</p>}
        <footer>
          <Button variant="secondary" disabled={tutorialStep === 0 || saving} onClick={() => moveTutorialStep(Math.max(0, tutorialStep - 1))}>← 이전 설명</Button>
          <Button variant="secondary" disabled={saving} onClick={() => void saveTutorialDecision('SKIPPED')}>가이드 건너뛰기</Button>
          {tutorialStep < WORKSPACE_TUTORIAL_STEPS.length - 1
            ? <Button disabled={!visitedSteps.has(tutorialStep)} onClick={() => moveTutorialStep(Math.min(WORKSPACE_TUTORIAL_STEPS.length - 1, tutorialStep + 1))}>다음 설명 →</Button>
            : <Button disabled={saving || !visitedSteps.has(tutorialStep)} onClick={() => void saveTutorialDecision('COMPLETED')}>{saving ? '완료 저장 중…' : '튜토리얼 완료'}</Button>}
        </footer>
        <small>건너뛰기는 이 계정에 1회 저장됩니다. 완료 또는 건너뛰기 후에는 상단 도움말에서 언제든 전체 튜토리얼을 다시 볼 수 있습니다.</small>
        </div>}
      </aside>
    </div>, document.body)}
    <Dialog isOpen={helpOpen} title={`도움말 · ${categoryHelp.title}`} onClose={() => setHelpOpen(false)} hideDefaultAction size="wide">
      <div className="workspace-help-center">
        <header><span>CURRENT CATEGORY GUIDE</span><h3>{categoryHelp.title}</h3><p>{categoryHelp.purpose}</p></header>
        <div className="workspace-help-center__grid">
          <section><strong>먼저 준비할 것</strong><ul>{categoryHelp.inputs.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section><strong>이 화면에서 하는 일</strong><ol>{categoryHelp.actions.map((item) => <li key={item}>{item}</li>)}</ol></section>
          <section><strong>완료되면 남는 것</strong><ul>{categoryHelp.outputs.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section className="is-caution"><strong>실수 방지</strong><ul>{categoryHelp.cautions.map((item) => <li key={item}>{item}</li>)}</ul></section>
        </div>
        {routeHelp && <section className="workspace-help-center__route"><span>현재 화면</span><h3>{routeHelp.title}</h3><ol>{routeHelp.steps.map((item) => <li key={item}>{item}</li>)}</ol><p><strong>다음 권장 화면</strong> {routeHelp.next}</p></section>}
        <footer><Button variant="secondary" onClick={reopenTutorial}>전체 튜토리얼 다시 보기</Button><Button onClick={() => setHelpOpen(false)}>현재 화면에서 계속하기</Button></footer>
      </div>
    </Dialog>
  </>;
}
