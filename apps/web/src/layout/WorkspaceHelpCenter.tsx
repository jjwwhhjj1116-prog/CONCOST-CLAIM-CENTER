import { Button, Dialog } from '@claim-studio/ui';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest } from '../api';
import { CATEGORY_HELP, CURRENT_TUTORIAL_VERSION, ROUTE_HELP, WORKSPACE_TUTORIAL_STEPS } from './workspace-help-content';

interface TutorialState {
  completedTutorialVersion: string | null;
  completedAt: string | null;
  version: number;
  updatedAt: string | null;
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
  const [tutorialState, setTutorialState] = useState<TutorialState>({ completedTutorialVersion: null, completedAt: null, version: 0, updatedAt: null });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const categoryHelp = CATEGORY_HELP[category] ?? CATEGORY_HELP.home;
  const routeHelp = routeId ? ROUTE_HELP[routeId] : undefined;
  const step = WORKSPACE_TUTORIAL_STEPS[tutorialStep] ?? WORKSPACE_TUTORIAL_STEPS[0];
  const progress = useMemo(() => Math.round(((tutorialStep + 1) / WORKSPACE_TUTORIAL_STEPS.length) * 100), [tutorialStep]);

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

  const finishTutorial = async () => {
    if (saving) return;
    setSaving(true); setNotice('');
    try {
      const result = await apiRequest<{ tutorial: TutorialState }>('/api/settings/tutorial', {
        method: 'PUT', body: JSON.stringify({ tutorialVersion: CURRENT_TUTORIAL_VERSION, expectedVersion: tutorialState.version })
      });
      setTutorialState(result.tutorial);
      window.localStorage.setItem('claim-center-tutorial-fallback', CURRENT_TUTORIAL_VERSION);
      setTutorialOpen(false); setTutorialStep(0);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        const latest = await apiRequest<{ tutorial: TutorialState }>('/api/settings/tutorial').catch(() => null);
        if (latest?.tutorial.completedTutorialVersion === CURRENT_TUTORIAL_VERSION) {
          setTutorialState(latest.tutorial); setTutorialOpen(false); setTutorialStep(0); return;
        }
      }
      setNotice('완료 상태를 저장하지 못했습니다. 네트워크를 확인한 뒤 다시 눌러 주세요. 안내 내용은 사라지지 않습니다.');
    } finally { setSaving(false); }
  };

  const reopenTutorial = () => {
    setHelpOpen(false); setTutorialStep(0); setNotice(''); setTutorialOpen(true);
  };

  return <>
    <button type="button" className="theme-toggle workspace-help-trigger" aria-label="현재 화면 도움말 열기" onClick={() => setHelpOpen(true)}>
      <span aria-hidden="true">?</span><strong>도움말</strong>
    </button>
    <Dialog isOpen={tutorialOpen} title="처음 사용하는 분을 위한 클레임센터 업무 순서" onClose={() => setTutorialOpen(false)} hideDefaultAction>
      <div className="workspace-tutorial" data-step={tutorialStep + 1}>
        <header><span>{step.eyebrow}</span><strong>{tutorialStep + 1} / {WORKSPACE_TUTORIAL_STEPS.length}</strong></header>
        <div className="workspace-tutorial__progress" aria-label={`튜토리얼 ${progress}% 완료`}><i style={{ width: `${progress}%` }} /></div>
        <section>
          <div className="workspace-tutorial__number">{String(tutorialStep + 1).padStart(2, '0')}</div>
          <div><h3>{step.title}</h3><p>{step.explanation}</p><ol>{step.tasks.map((task) => <li key={task}>{task}</li>)}</ol></div>
        </section>
        <aside><strong>이 단계의 완료 기준</strong><p>{step.completion}</p></aside>
        {notice && <p className="error-box" role="alert">{notice}</p>}
        <footer>
          <Button variant="secondary" disabled={tutorialStep === 0 || saving} onClick={() => setTutorialStep((current) => Math.max(0, current - 1))}>← 이전 설명</Button>
          <Button variant="secondary" onClick={() => { setTutorialOpen(false); onNavigate(step.path); }}>{step.pathLabel}</Button>
          {tutorialStep < WORKSPACE_TUTORIAL_STEPS.length - 1
            ? <Button onClick={() => setTutorialStep((current) => Math.min(WORKSPACE_TUTORIAL_STEPS.length - 1, current + 1))}>다음 설명 →</Button>
            : <Button disabled={saving} onClick={() => void finishTutorial()}>{saving ? '완료 저장 중…' : '튜토리얼 완료'}</Button>}
        </footer>
        <small>중간에 닫아도 다음 로그인 때 다시 안내합니다. 완료 후에는 상단 도움말에서 언제든 다시 볼 수 있습니다.</small>
      </div>
    </Dialog>
    <Dialog isOpen={helpOpen} title={`도움말 · ${categoryHelp.title}`} onClose={() => setHelpOpen(false)} hideDefaultAction>
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
