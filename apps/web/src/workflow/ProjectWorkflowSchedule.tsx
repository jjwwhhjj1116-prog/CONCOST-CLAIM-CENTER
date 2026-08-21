import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@claim-studio/ui';
import { apiRequest } from '../api';
import {
  REPORT_AUTHOR_NAMES,
  WORKFLOW_STAGES,
  WORKFORCE_UNITS,
  workflowStageFromRoute,
  type WorkflowProject,
  type WorkflowStageId
} from './workflow-model';

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const clampDay = (value: number) => Math.max(1, Math.min(31, value));
const barStyle = (start: number, end: number): React.CSSProperties => {
  const safeStart = clampDay(start);
  const safeEnd = Math.max(safeStart, clampDay(end));
  return {
    left: `${((safeStart - 1) / 31) * 100}%`,
    width: `${((safeEnd - safeStart + 1) / 31) * 100}%`
  };
};

const statusLabel = (status: 'DONE' | 'IN_PROGRESS' | 'PLANNED') => ({
  DONE: '완료', IN_PROGRESS: '진행 중', PLANNED: '예정'
}[status]);

const awardLabel = (status: WorkflowProject['awardStatus']) => ({
  WON: '수주 확정', PENDING: '회신 대기', LOST: '미수주'
}[status]);

const actionForStage = (stageId: WorkflowStageId, project: WorkflowProject) => {
  const projectId = encodeURIComponent(project.id);
  const caseId = encodeURIComponent(project.caseId);
  switch (stageId) {
    case 1: return { label: '제안서 작성 열기', path: `/proposals/editor?caseId=${caseId}&projectId=${projectId}` };
    case 2: return { label: '프로젝트 접수 열기', path: `/workflow/award?caseId=${caseId}&projectId=${projectId}` };
    case 3: return { label: '착수회의·회의록 열기', path: `/meetings?caseId=${caseId}&projectId=${projectId}` };
    case 4: return { label: '현장자료 업로드 열기', path: `/cases/files?caseId=${caseId}&projectId=${projectId}` };
    case 5: return { label: '팀 배정표로 이동', path: '#workforce-panel' };
    case 6: return { label: 'AI 보고서 스튜디오 열기', path: `/reports/studio?caseId=${caseId}&projectId=${projectId}` };
  }
};

interface ProjectWorkflowScheduleProps {
  routeId: string;
  onNavigate: (path: string) => void;
}

export const ProjectWorkflowSchedule: React.FC<ProjectWorkflowScheduleProps> = ({ routeId, onNavigate }) => {
  const [viewMode, setViewMode] = useState<'month' | '30days'>('month');
  const [projects, setProjects] = useState<WorkflowProject[]>([]);
  const [liveError, setLiveError] = useState('');
  const focusedStageId = workflowStageFromRoute(routeId);
  const requestedProjectId = new URLSearchParams(window.location.search).get('projectId');
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === requestedProjectId) ?? projects[0],
    [projects, requestedProjectId]
  );
  const showOverview = routeId === 'PROJ-01';
  const focusedStage = WORKFLOW_STAGES.find((stage) => stage.id === focusedStageId);
  const isProjectDialogOpen = showOverview && Boolean(requestedProjectId);

  useEffect(() => {
    let active = true;
    apiRequest<{ projects: WorkflowProject[]; dataBasis: string }>('/api/project-workflow/schedule')
      .then((result) => { if (active) { setProjects(result.projects); setLiveError(''); } })
      .catch((reason) => { if (active) setLiveError(reason instanceof Error ? reason.message : 'D1 프로젝트를 불러오지 못했습니다.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isProjectDialogOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onNavigate('/projects/schedule');
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isProjectDialogOpen, onNavigate]);

  if (!selectedProject) return <section className="workflow-page" aria-label="프로젝트 일정표">
    <header className="workflow-hero"><div><span className="workflow-kicker">CLAIM DELIVERY WORKFLOW</span><h2>프로젝트 통합 일정표</h2><p>제안서부터 보고서 작성까지 실제 D1 업무 기록을 연결합니다.</p></div></header>
    {liveError ? <p className="error-box" role="alert">{liveError}</p> : <p className="empty-box">등록된 프로젝트를 불러오는 중이거나 아직 프로젝트 의뢰가 없습니다.</p>}
  </section>;

  const openProjectDialog = (project: WorkflowProject) => {
    onNavigate(`/projects/schedule?projectId=${encodeURIComponent(project.id)}`);
  };

  const navigateAction = (stageId: WorkflowStageId) => {
    const action = actionForStage(stageId, selectedProject);
    if (action.path.startsWith('#')) {
      document.querySelector(action.path)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    onNavigate(action.path);
  };

  return (
    <section className="workflow-page" aria-labelledby="workflow-page-title">
      {!showOverview && <nav className="project-context-strip" aria-label="현재 프로젝트 경로">
        <button type="button" onClick={() => onNavigate('/projects/schedule')}>프로젝트 워크</button>
        <span aria-hidden="true">›</span>
        <button type="button" onClick={() => onNavigate('/projects/schedule')}>프로젝트 일정표</button>
        <span aria-hidden="true">›</span>
        <div><strong>{selectedProject.code}</strong><b>{selectedProject.name}</b></div>
        <em>{focusedStage ? `${focusedStage.id}단계 · ${focusedStage.name}` : '전체 단계 워크플로우'}</em>
        <i aria-label={`전체 공정률 ${selectedProject.progress}%`}><span style={{ width: `${selectedProject.progress}%` }} /></i>
        <small>{selectedProject.progress}%</small>
      </nav>}
      <header className="workflow-hero">
        <div>
          <span className="workflow-kicker">CLAIM DELIVERY WORKFLOW</span>
          <h2 id="workflow-page-title">{showOverview ? '프로젝트 통합 일정표' : `${selectedProject.code} · 단계별 워크플로우`}</h2>
          <p>{showOverview
            ? '제안서부터 보고서 작성까지 프로젝트별 일정과 투입 팀을 한 화면에서 확인합니다.'
            : '작성된 제안서를 연결한 뒤 수주 확정, 착수회의, 현장조사, 산출, 보고서 작성으로 이어집니다.'}</p>
        </div>
        <div className="workflow-hero-actions">
          {!showOverview && <Button variant="secondary" onClick={() => onNavigate('/projects/schedule')}>← 전체 프로젝트</Button>}
          <span className="workflow-live-badge">D1 LIVE PROJECTS · 신규 의뢰 자동 반영</span>
        </div>
      </header>

      {liveError && <p className="error-box" role="alert">{liveError}</p>}

      {showOverview ? (
        <>
          <div className="workflow-summary" aria-label="프로젝트 일정 요약">
            <article><span>전체 프로젝트</span><strong>{projects.length}</strong><small>D1 실제 단계 기록만 표시</small></article>
            <article><span>수주 검토</span><strong>{projects.filter((project) => project.awardStatus === 'PENDING').length}</strong><small>의뢰·제안서 회신 대기</small></article>
            <article><span>팀 배정 프로젝트</span><strong>{projects.filter((project) => project.stages.some((stage) => stage.stageId === 5 && stage.status !== 'PLANNED')).length}</strong><small>실제 수량산출·내역 투입 기록</small></article>
            <article><span>보고서 작성 대기</span><strong>{projects.filter((project) => project.stages.some((stage) => stage.stageId === 6 && stage.status !== 'DONE')).length}</strong><small>전담 작성자 5명</small></article>
          </div>

          <div className="schedule-toolbar" aria-label="일정표 보기 설정">
            <div><strong>2026년 8월</strong><span>프로젝트별 진행 구간</span></div>
            <div className="schedule-toolbar-actions">
              <Button size="sm" variant={viewMode === '30days' ? 'primary' : 'secondary'} onClick={() => setViewMode('30days')}>30일</Button>
              <Button size="sm" variant={viewMode === 'month' ? 'primary' : 'secondary'} onClick={() => setViewMode('month')}>월별 보기</Button>
              <Button size="sm" variant="secondary">‹ 이전</Button>
              <Button size="sm" variant="secondary">오늘</Button>
              <Button size="sm" variant="secondary">다음 ›</Button>
            </div>
          </div>

          <section className="project-brief-board" aria-labelledby="project-brief-title">
            <header>
              <div><span>PROJECT SNAPSHOT</span><h3 id="project-brief-title">프로젝트별 작업 특이사항</h3></div>
              <p>산출 범위와 투입 팀처럼 일정만으로 놓치기 쉬운 내용을 함께 표시합니다.</p>
            </header>
            <div className="project-brief-list">
              {projects.map((project) => (
                <button key={project.id} type="button" className="project-brief-row" onClick={() => openProjectDialog(project)} aria-haspopup="dialog">
                  <span className="project-brief-copy">
                    <b>{project.code}</b>
                    <strong>{project.name}</strong>
                    <small>{project.claimType} · {project.client}</small>
                  </span>
                  <span className="project-highlight-list" aria-label={`${project.name} 작업 특이사항`}>
                    {project.highlights.map((highlight) => <em key={highlight.label} data-tone={highlight.tone}>{highlight.label}</em>)}
                  </span>
                  <span className="project-brief-action">상세 보기 <b aria-hidden="true">›</b></span>
                </button>
              ))}
            </div>
          </section>

          <div className="schedule-board" role="table" aria-label="프로젝트 월간 일정표">
            <div className="schedule-board-header" role="row">
              <div className="schedule-left-heading" role="columnheader">프로젝트 정보 <span>공정률</span></div>
              <div className="schedule-days" role="row">
                {DAYS.map((day) => {
                  const weekday = DAY_LABELS[new Date(Date.UTC(2026, 7, day)).getUTCDay()];
                  return <div key={day} className={`schedule-day ${weekday === '토' || weekday === '일' ? 'is-weekend' : ''} ${day === 13 ? 'is-today' : ''}`} role="columnheader" aria-label={`2026-08-${String(day).padStart(2, '0')} ${weekday}요일`}><strong>{day}</strong><small>{weekday}</small></div>;
                })}
              </div>
            </div>
            {projects.map((project) => (
              <div className="schedule-project-row" role="row" key={project.id}>
                <button className="schedule-project-info" role="cell" onClick={() => openProjectDialog(project)} aria-haspopup="dialog">
                  <span className={`award-dot award-${project.awardStatus.toLowerCase()}`} aria-hidden="true" />
                  <span className="schedule-project-copy"><strong>{project.name}</strong><small>{project.code} · {project.claimType} · {awardLabel(project.awardStatus)}</small></span>
                  <span className="schedule-progress"><b>{project.progress}%</b><i><em style={{ width: `${project.progress}%` }} /></i></span>
                </button>
                <div className="schedule-track" role="cell" aria-label={`${project.name} ${project.start}부터 ${project.end}까지`}>
                  {DAYS.map((day) => <span key={day} className={`schedule-grid-cell ${day === 13 ? 'is-today' : ''}`} />)}
                  <button
                    className="project-range-bar"
                    style={barStyle(project.stages[0]?.startDay ?? 1, project.stages.at(-1)?.endDay ?? 31)}
                    onClick={() => openProjectDialog(project)}
                    aria-label={`${project.name} 프로젝트 상세 팝업 열기`}
                    aria-haspopup="dialog"
                  >
                    <span>{project.name}</span><b>{project.progress}%</b>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="schedule-legend" aria-label="일정표 범례">
            <span><i className="legend-project" />프로젝트 기간</span>
            <span><i className="legend-today" />오늘</span>
            <span><i className="legend-weekend" />주말</span>
            <span>프로젝트를 클릭하면 1~6단계 세부 작업과 팀 배정이 열립니다.</span>
          </div>

          {isProjectDialogOpen && (
            <div
              className="project-detail-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) onNavigate('/projects/schedule');
              }}
            >
              <section
                className="project-detail-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="project-detail-modal-title"
                aria-describedby="project-detail-modal-description"
              >
                <header className="project-detail-modal__header">
                  <div>
                    <span>SELECTED PROJECT · 1~6단계 워크플로우</span>
                    <h3 id="project-detail-modal-title">{selectedProject.code} · {selectedProject.name}</h3>
                    <p id="project-detail-modal-description">현재 선택한 프로젝트의 일정, 단계별 담당자, 투입 팀을 확인합니다.</p>
                  </div>
                  <div className="project-detail-modal__identity" aria-label="선택 프로젝트 요약">
                    <b>{awardLabel(selectedProject.awardStatus)}</b>
                    <strong>{selectedProject.progress}%</strong>
                    <small>{selectedProject.start} ~ {selectedProject.end}</small>
                  </div>
                  <button type="button" className="project-detail-modal__close" onClick={() => onNavigate('/projects/schedule')} autoFocus aria-label="프로젝트 상세 팝업 닫기">×</button>
                </header>
                <div className="project-detail-modal__body">
                  <ProjectDetail
                    project={selectedProject}
                    focusedStageId={focusedStageId}
                    onNavigate={onNavigate}
                    onAction={navigateAction}
                  />
                </div>
              </section>
            </div>
          )}
        </>
      ) : (
        <ProjectDetail
          project={selectedProject}
          focusedStageId={focusedStageId}
          onNavigate={onNavigate}
          onAction={navigateAction}
        />
      )}
    </section>
  );
};

const ProjectDetail: React.FC<{
  project: WorkflowProject;
  focusedStageId?: WorkflowStageId;
  onNavigate: (path: string) => void;
  onAction: (stageId: WorkflowStageId) => void;
}> = ({ project, focusedStageId, onNavigate, onAction }) => {
  const selectedStage = WORKFLOW_STAGES.find((stage) => stage.id === focusedStageId);
  const koreanUnits = WORKFORCE_UNITS.filter((unit) => unit.organization === 'CONCOST' && unit.discipline !== '클레임');
  const vietnamUnits = WORKFORCE_UNITS.filter((unit) => unit.organization === 'VIETQS');

  return (
    <>
      <div className="project-workflow-summary">
        <div><span>거래처</span><strong>{project.client}</strong></div>
        <div><span>업무 유형</span><strong>{project.claimType}</strong></div>
        <div><span>수주 상태</span><strong>{awardLabel(project.awardStatus)}</strong></div>
        <div><span>전체 공정률</span><strong>{project.progress}%</strong></div>
        <div><span>프로젝트 기간</span><strong>{project.start} ~ {project.end}</strong></div>
      </div>

      {selectedStage && (
        <article className="focused-stage-card" style={{ borderColor: selectedStage.color }}>
          <span>{selectedStage.eyebrow}</span>
          <h3>{selectedStage.id}. {selectedStage.name}</h3>
          <p>{selectedStage.description}</p>
          <Button onClick={() => onAction(selectedStage.id)}>{actionForStage(selectedStage.id, project).label}</Button>
        </article>
      )}

      <div className="detail-schedule-board" role="table" aria-label={`${project.name} 1단계부터 6단계까지 일정`}>
        <div className="detail-schedule-header" role="row">
          <div role="columnheader">1~6단계 업무 · 담당</div>
          <div className="schedule-days" role="row">
            {DAYS.map((day) => <div key={day} className={`schedule-day ${day === 13 ? 'is-today' : ''}`} role="columnheader"><strong>{day}</strong></div>)}
          </div>
        </div>
        {WORKFLOW_STAGES.map((stage) => {
          const item = project.stages.find((candidate) => candidate.stageId === stage.id);
          if (!item) return null;
          return (
            <div className={`workflow-stage-row ${focusedStageId === stage.id ? 'is-focused' : ''}`} role="row" key={stage.id}>
              <button className="workflow-stage-info" role="cell" onClick={() => onNavigate(`${stage.path}?projectId=${encodeURIComponent(project.id)}`)}>
                <span className="stage-number" style={{ background: stage.color }}>{stage.id}</span>
                <span><strong>{stage.name}</strong><small>{item.owner}</small><em>{item.detail}</em></span>
                <b className={`stage-status status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</b>
              </button>
              <div className="schedule-track" role="cell">
                {DAYS.map((day) => <span key={day} className={`schedule-grid-cell ${day === 13 ? 'is-today' : ''}`} />)}
                <button
                  className={`stage-range-bar status-${item.status.toLowerCase()}`}
                  style={{ ...barStyle(item.startDay, item.endDay), backgroundColor: stage.color }}
                  onClick={() => onNavigate(`${stage.path}?projectId=${encodeURIComponent(project.id)}`)}
                >
                  <span>{item.startDay}~{item.endDay}일</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <section id="workforce-panel" className="workforce-panel" tabIndex={-1} aria-labelledby="workforce-title">
        <header>
          <div><span>WORKFORCE ALLOCATION</span><h3 id="workforce-title">수량산출·내역작성 투입 현황</h3></div>
          <p>한국 본사는 인원별, VIETQS는 팀별 일정으로 표시합니다.</p>
        </header>
        <div className="workforce-columns">
          <article>
            <h4>CONCOST · 한국 본사</h4>
            {koreanUnits.map((unit, index) => <div className="workforce-row" key={unit.unit}>
              <div><strong>{unit.unit}</strong><small>{unit.size}명 · 인원별 배정</small></div>
              <div className="mini-track"><i style={barStyle(16 + index * 2, 25 + index)} /></div>
              <span title={unit.members?.join(', ')}>{unit.members?.slice(0, 3).join(' · ')}{unit.size > 3 ? ` 외 ${unit.size - 3}명` : ''}</span>
            </div>)}
          </article>
          <article>
            <h4>VIETQS · 베트남 지사</h4>
            {vietnamUnits.map((unit, index) => <div className="workforce-row" key={unit.unit}>
              <div><strong>{unit.unit}</strong><small>{unit.size}명 · 팀 단위 배정</small></div>
              <div className="mini-track"><i style={barStyle(16 + (index % 5), 23 + (index % 7))} /></div>
              <span>{unit.discipline}</span>
            </div>)}
          </article>
        </div>
      </section>

      <section className="report-author-panel" aria-labelledby="report-author-title">
        <div><span>REPORT AUTHORING CELL</span><h3 id="report-author-title">보고서 작성 전담 5인</h3><p>유형별 목차와 1~5단계 근거를 장별 역할로 나눠 작성합니다.</p></div>
        <ul>{REPORT_AUTHOR_NAMES.map((name, index) => <li key={name}><span>{String(index + 1).padStart(2, '0')}</span><strong>{name}</strong></li>)}</ul>
        <Button onClick={() => onNavigate(`/reports/studio?caseId=${encodeURIComponent(project.caseId)}&projectId=${encodeURIComponent(project.id)}`)}>AI 보고서 스튜디오</Button>
      </section>
    </>
  );
};
