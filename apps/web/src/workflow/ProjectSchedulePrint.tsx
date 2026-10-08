import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api';
import { claimTypeLabel } from '../claim-types';
import { scheduleDayInfo } from './schedule-holidays';
import { WORKFLOW_STAGES, type WorkflowProject } from './workflow-model';

type PrintLanguage = 'ko' | 'vi';
type PrintColorMode = 'color' | 'mono';

interface ProjectSchedulePrintProps {
  currentSearch: string;
  userName: string;
  onClose: () => void;
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const VI_DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
// Translate only fixed interface text; never translate project names, people or saved source data.
const VI_TEXT: Record<string, string> = {
  '일정표 출력 설정': 'Thiết lập in lịch', '프로젝트 일정표 출력': 'In lịch dự án',
  'A4 가로 · 현재 저장 일정 기준': 'A4 ngang · Theo lịch đã lưu', '출력 범위': 'Phạm vi in',
  '전체 일정': 'Toàn bộ lịch', '한 달': 'Một tháng', '‹ 이전': '‹ Trước', '다음 ›': 'Sau ›',
  '출력 월': 'Tháng in', '언어 선택': 'Chọn ngôn ngữ', '색상 선택': 'Chọn màu',
  '컬러': 'Màu', '흑백': 'Đen trắng', 'PDF 저장': 'Lưu PDF', '인쇄': 'In', '닫기': 'Đóng', '확인': 'Xác nhận',
  '프로젝트 일정을 불러오는 중입니다…': 'Đang tải lịch dự án…',
  '프로젝트 일정을 불러오지 못했습니다.': 'Không tải được lịch dự án.', '프로젝트 일정표': 'Lịch dự án',
  '프로젝트 전체 기간 월별 상세 일정표': 'Lịch chi tiết theo tháng cho toàn bộ dự án',
  '프로젝트 전체 기간 통합 일정표': 'Lịch tổng hợp cho toàn bộ thời gian dự án',
  '프로젝트 상세 일정표': 'Lịch chi tiết dự án', '프로젝트 통합 일정표': 'Lịch tổng hợp dự án',
  '수주 확정 프로젝트의 단계별 기준 일정 · 한국 본사 / VIETQS 휴일 통합': 'Lịch các giai đoạn của dự án đã nhận · Ngày lễ Hàn Quốc / VIETQS',
  '출력 기준': 'Thời điểm in', '출력자': 'Người in', '페이지': 'Trang', '프로젝트 정보': 'Thông tin dự án',
  '담당 PM': 'PM phụ trách', '미지정': 'Chưa phân công', '일정 요약': 'Tóm tắt lịch',
  '전체 프로젝트': 'Tổng số dự án', '수주 확정': 'Đã nhận dự án', 'PM 미지정': 'Chưa có PM',
  '일정 미입력': 'Chưa nhập lịch', '단계 / 담당': 'Giai đoạn / Phụ trách', '프로젝트 / PM': 'Dự án / PM',
  '업무 단계': 'Giai đoạn công việc', '제안서 연동': 'Liên kết đề xuất', '착수회의': 'Họp khởi động',
  '현장조사': 'Khảo sát hiện trường', '수량산출·내역작성': 'Bóc tách khối lượng · Lập BOQ', '보고서 작성': 'Soạn báo cáo',
  '이 달에 해당 일정 없음': 'Không có lịch trong tháng này', '저장 일정 없음': 'Chưa có lịch đã lưu',
  '이 달의 저장 일정 없음': 'Không có lịch đã lưu trong tháng này', '공정률': 'Tiến độ',
  '등록된 프로젝트가 없습니다.': 'Chưa có dự án được đăng ký.', '프로젝트 기간': 'Thời gian dự án',
  '주말': 'Cuối tuần', '일반 근무일': 'Ngày làm việc', '한국': 'Hàn Quốc', '베트남': 'Việt Nam', '양국': 'KR/VN',
  '한국 공휴일': 'Ngày lễ Hàn Quốc', '베트남 휴일': 'Ngày lễ Việt Nam', '양국 공통 휴일': 'Ngày lễ chung',
  '※ 일정 변경은 프로젝트 일정표에 저장된 최신 일정을 반영합니다.': '※ Lịch in phản ánh lịch mới nhất đã lưu trong lịch dự án.',
  '현장조사 및 수량산출 클레임': 'Khiếu nại cần khảo sát và bóc tách khối lượng',
  '분석 보고서 작성 클레임': 'Khiếu nại cần báo cáo phân tích', '일반적인 클레임': 'Khiếu nại chung',
  '재건축·재개발 공사비 협상': 'Đàm phán chi phí tái thiết · tái phát triển',
  '사감정보고서': 'Báo cáo giám định tư nhân', '물가변동': 'Biến động giá',
  '신정': 'Tết Dương lịch', '남부해방기념일': 'Ngày Giải phóng miền Nam', '국제노동절': 'Ngày Quốc tế Lao động',
  '어린이날': 'Ngày Thiếu nhi', '현충일': 'Ngày Tưởng niệm', '광복절': 'Ngày Giải phóng',
  '개천절': 'Ngày Lập quốc', '한글날': 'Ngày Hangeul', '성탄절': 'Giáng sinh',
  '뗏 연휴': 'Kỳ nghỉ Tết', '설날 연휴': 'Kỳ nghỉ Tết', '설날': 'Tết Hàn Quốc', '뗏(설날)': 'Tết Nguyên đán',
  '삼일절': 'Ngày Phong trào Độc lập 1/3', '삼일절 대체공휴일': 'Ngày nghỉ bù Phong trào Độc lập 1/3',
  '흥왕 기념일 대체휴일': 'Ngày nghỉ bù Giỗ Tổ Hùng Vương',
  '부처님오신날': 'Lễ Phật Đản', '부처님오신날 대체공휴일': 'Ngày nghỉ bù Lễ Phật Đản',
  '광복절 대체공휴일': 'Ngày nghỉ bù Giải phóng', '국경절 연휴': 'Kỳ nghỉ Quốc khánh', '국경절': 'Quốc khánh',
  '추석 연휴': 'Kỳ nghỉ Chuseok', '추석': 'Chuseok', '추석 대체공휴일': 'Ngày nghỉ bù Chuseok',
  '개천절 대체공휴일': 'Ngày nghỉ bù Lập quốc'
};
const ROWS_PER_PAGE = 8;

const isoMonth = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const validMonth = (value: string | null): string => {
  if (value && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value)) return value;
  return isoMonth(new Date());
};

const monthBarStyle = (
  startDate: string | undefined,
  endDate: string | undefined,
  month: string,
  dayCount: number
): React.CSSProperties | undefined => {
  if (!startDate || !endDate) return undefined;
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(dayCount).padStart(2, '0')}`;
  if (endDate < monthStart || startDate > monthEnd) return undefined;
  const visibleStart = Number((startDate < monthStart ? monthStart : startDate).slice(8, 10));
  const visibleEnd = Number((endDate > monthEnd ? monthEnd : endDate).slice(8, 10));
  return {
    left: `${((visibleStart - 1) / dayCount) * 100}%`,
    width: `${((visibleEnd - visibleStart + 1) / dayCount) * 100}%`
  };
};

const scheduledRange = (project: WorkflowProject): { start?: string; end?: string } => {
  const stages = project.stages.filter((stage) => stage.scheduleExplicit && stage.startDate && stage.endDate);
  return {
    start: stages.map((stage) => stage.startDate as string).sort()[0],
    end: stages.map((stage) => stage.endDate as string).sort().at(-1)
  };
};

export function projectScheduleMonths(project: Pick<WorkflowProject, 'stages'> | undefined, fallbackMonth: string): string[] {
  const validDate = (value: string | null | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  const stages = project?.stages.filter((stage) => stage.scheduleExplicit && validDate(stage.startDate) && validDate(stage.endDate) && stage.endDate >= stage.startDate) ?? [];
  const dates = stages.flatMap((stage) => [stage.startDate!, stage.endDate!]).sort();
  if (!dates.length) return [fallbackMonth];
  const [startYear, startMonth] = dates[0].split('-').map(Number);
  const [endYear, endMonth] = dates.at(-1)!.split('-').map(Number);
  const first = startYear * 12 + startMonth - 1;
  const last = endYear * 12 + endMonth - 1;
  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const index = first + offset;
    return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
  });
}

export function schedulePrintPages(projects: WorkflowProject[], selectedProjectId: string, month: string, scope: 'all' | 'month' = 'all'): Array<{ month: string; projects: WorkflowProject[] }> {
  if (selectedProjectId) {
    const project = projects.find((item) => item.id === selectedProjectId);
    return projectScheduleMonths(project, month).map((pageMonth) => ({ month: pageMonth, projects: project ? [project] : [] }));
  }
  const months = scope === 'month' ? [month] : projectScheduleMonths({ stages: projects.flatMap(project => project.stages) }, month);
  return months.flatMap(month => Array.from({ length: Math.max(1, Math.ceil(projects.length / ROWS_PER_PAGE)) }, (_, index) => ({ month, projects: projects.slice(index * ROWS_PER_PAGE, (index + 1) * ROWS_PER_PAGE) })));
}

const replacePrintQuery = (month: string, lang: PrintLanguage, colorMode: PrintColorMode, projectId: string, scope: 'all' | 'month') => {
  const query = new URLSearchParams({ month, lang, colorMode, scope });
  if (projectId) query.set('projectId', projectId);
  window.history.replaceState(null, '', `/print/projects/month-a4?${query.toString()}`);
};

export function ProjectSchedulePrint({ currentSearch, userName, onClose }: ProjectSchedulePrintProps): React.ReactElement {
  const initialQuery = useMemo(() => new URLSearchParams(currentSearch), [currentSearch]);
  const selectedProjectId = initialQuery.get('projectId') ?? '';
  const [month, setMonth] = useState(() => validMonth(initialQuery.get('month')));
  const [scope, setScope] = useState<'all' | 'month'>(() => initialQuery.get('scope') === 'month' ? 'month' : 'all');
  const [language, setLanguage] = useState<PrintLanguage>(() => initialQuery.get('lang') === 'vi' ? 'vi' : 'ko');
  const [colorMode, setColorMode] = useState<PrintColorMode>(() => initialQuery.get('colorMode') === 'mono' ? 'mono' : 'color');
  const [projects, setProjects] = useState<WorkflowProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfGuide, setPdfGuide] = useState(false);

  const [year, monthNumber] = month.split('-').map(Number);
  const monthIndex = monthNumber - 1;
  const pages = useMemo(() => schedulePrintPages(projects, selectedProjectId, month, scope), [projects, selectedProjectId, month, scope]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest<{ projects: WorkflowProject[] }>('/api/project-workflow/schedule')
      .then((result) => {
        if (!active) return;
        setProjects(selectedProjectId ? result.projects.filter((project) => project.id === selectedProjectId) : result.projects);
        setError('');
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : '프로젝트 일정을 불러오지 못했습니다.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedProjectId]);

  const updateMonth = (nextMonth: string) => {
    const safeMonth = validMonth(nextMonth);
    setMonth(safeMonth);
    replacePrintQuery(safeMonth, language, colorMode, selectedProjectId, scope);
  };

  const updateLanguage = (nextLanguage: PrintLanguage) => {
    setLanguage(nextLanguage);
    replacePrintQuery(month, nextLanguage, colorMode, selectedProjectId, scope);
  };

  const updateColorMode = (nextMode: PrintColorMode) => {
    setColorMode(nextMode);
    replacePrintQuery(month, language, nextMode, selectedProjectId, scope);
  };

  const moveMonth = (offset: number) => {
    updateMonth(isoMonth(new Date(year, monthIndex + offset, 1)));
  };

  const printDocument = (asPdf = false) => {
    setPdfGuide(asPdf);
    window.setTimeout(() => window.print(), asPdf ? 120 : 0);
  };

  const todayText = new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short'
  }).format(new Date());
  const text = (korean: string) => language === 'vi' ? VI_TEXT[korean] ?? korean : korean;
  const monthText = (year: number, month: number) => language === 'vi' ? `Tháng ${month}/${year}` : `${year}년 ${month}월`;
  const dayLabels = language === 'vi' ? VI_DAY_LABELS : DAY_LABELS;
  const dayTitle = (info: ReturnType<typeof scheduleDayInfo>) => language === 'ko' ? info.label : info.holidays.length
    ? info.holidays.map(holiday => `${text(holiday.country === 'KR' ? '한국' : '베트남')} ${text(holiday.name)}`).join(', ')
    : text(info.isWeekend ? '주말' : '일반 근무일');
  const claimLabel = (code: string) => /^TYPE-0[1-6]$/u.test(code) ? text(claimTypeLabel(code)) : claimTypeLabel(code);

  return <main lang={language} className={`schedule-print-root is-${colorMode}`}>
    <header className="schedule-print-toolbar" aria-label={text('일정표 출력 설정')}>
      <div className="schedule-print-toolbar__title">
        <span aria-hidden="true">▦</span>
        <div><strong>{text('프로젝트 일정표 출력')}</strong><small>{text('A4 가로 · 현재 저장 일정 기준')}</small></div>
      </div>
      <div className="schedule-print-toolbar__controls">
        {!selectedProjectId && <div className="schedule-print-toggle" aria-label={text('출력 범위')}>{(['all', 'month'] as const).map(value => <button key={value} type="button" aria-pressed={scope === value} className={scope === value ? 'is-active' : ''} onClick={() => { setScope(value); replacePrintQuery(month, language, colorMode, selectedProjectId, value); }}>{text(value === 'all' ? '전체 일정' : '한 달')}</button>)}</div>}
        {!selectedProjectId && scope === 'month' && <><button type="button" onClick={() => moveMonth(-1)}>{text('‹ 이전')}</button>
        <label>{text('출력 월')}<input type="month" value={month} onChange={(event) => updateMonth(event.target.value)} /></label>
        <button type="button" onClick={() => moveMonth(1)}>{text('다음 ›')}</button></>}
        {(selectedProjectId || scope === 'all') && !loading && !error && <span className="schedule-print-period">{pages[0]?.month} ~ {pages.at(-1)?.month} · {language === 'vi' ? `${pages.length} trang` : `전체 ${pages.length}페이지`}</span>}
        <div className="schedule-print-toggle" aria-label={text('언어 선택')}>
          <button type="button" className={language === 'ko' ? 'is-active' : ''} onClick={() => updateLanguage('ko')}>한국어</button>
          <button type="button" className={language === 'vi' ? 'is-active' : ''} onClick={() => updateLanguage('vi')}>Tiếng Việt</button>
        </div>
        <div className="schedule-print-toggle" aria-label={text('색상 선택')}>
          <button type="button" className={colorMode === 'color' ? 'is-active' : ''} onClick={() => updateColorMode('color')}>{text('컬러')}</button>
          <button type="button" className={colorMode === 'mono' ? 'is-active' : ''} onClick={() => updateColorMode('mono')}>{text('흑백')}</button>
        </div>
        <button type="button" className="schedule-print-toolbar__pdf" onClick={() => printDocument(true)} disabled={loading || Boolean(error) || !projects.length}>{text('PDF 저장')}</button>
        <button type="button" className="schedule-print-toolbar__print" onClick={() => printDocument(false)} disabled={loading || Boolean(error) || !projects.length}>{text('인쇄')}</button>
        <button type="button" onClick={onClose}>{text('닫기')}</button>
      </div>
    </header>

    {pdfGuide && <aside className="schedule-print-pdf-guide" role="status">
      {language === 'vi' ? <>Trong cửa sổ in, chọn <b>Save as PDF</b>, bố cục <b>Landscape</b> và tỷ lệ <b>Fit to page</b>.</> : <>인쇄 창의 <b>대상</b>에서 <b>PDF로 저장</b>, 레이아웃은 <b>가로</b>, 배율은 <b>페이지에 맞춤</b>을 선택하세요.</>}
      <button type="button" onClick={() => setPdfGuide(false)}>{text('확인')}</button>
    </aside>}
    {loading && <p className="schedule-print-status">{text('프로젝트 일정을 불러오는 중입니다…')}</p>}
    {error && <p className="schedule-print-status is-error" role="alert">{text(error)}</p>}

    <section className="schedule-print-pages" aria-label={selectedProjectId ? text('프로젝트 전체 기간 월별 상세 일정표') : scope === 'all' ? text('프로젝트 전체 기간 통합 일정표') : `${monthText(year, monthNumber)} ${text('프로젝트 일정표')}`}>
      {!loading && !error && pages.map(({ month: pageMonth, projects: pageProjects }, pageIndex) => {
        const [year, monthNumber] = pageMonth.split('-').map(Number);
        const monthIndex = monthNumber - 1;
        const dayCount = new Date(year, monthNumber, 0).getDate();
        const days = Array.from({ length: dayCount }, (_, index) => index + 1);
        const project = pageProjects[0];
        return <article className={`schedule-print-sheet ${selectedProjectId ? 'is-detail' : 'is-overview'}`} key={`${pageMonth}-${pageIndex}`}>
        <header className="schedule-print-sheet__header">
          <div className="schedule-print-brand"><span>CONCOST</span><b>CLAIM CENTER STUDIO</b></div>
          <div><small>PROJECT DELIVERY · MONTHLY SCHEDULE</small><h1>{monthText(year, monthNumber)} {text(selectedProjectId ? '프로젝트 상세 일정표' : '프로젝트 통합 일정표')}</h1><p>{selectedProjectId && projects[0] ? `${projects[0].code} · ${projects[0].name} · PM ${projects[0].responsiblePm?.name ?? text('미지정')}` : text('수주 확정 프로젝트의 단계별 기준 일정 · 한국 본사 / VIETQS 휴일 통합')}</p></div>
          <dl><div><dt>{text('출력 기준')}</dt><dd>{todayText}</dd></div><div><dt>{text('출력자')}</dt><dd>{userName}</dd></div><div><dt>{text('페이지')}</dt><dd>{pageIndex + 1} / {pages.length}</dd></div></dl>
        </header>

        {selectedProjectId && project ? <section className="schedule-print-identity" aria-label={text('프로젝트 정보')}>
          <h2>{project.name}</h2><p>{project.code} · {text('담당 PM')}: <strong>{project.responsiblePm?.name ?? text('미지정')}</strong></p>
        </section> : !selectedProjectId && <section className="schedule-print-kpis" aria-label={text('일정 요약')}>
          <div><span>{text('전체 프로젝트')}</span><strong>{projects.length}</strong></div>
          <div><span>{text('수주 확정')}</span><strong>{projects.filter((project) => project.awardStatus === 'WON').length}</strong></div>
          <div><span>{text('PM 미지정')}</span><strong>{projects.filter((project) => !project.responsiblePm).length}</strong></div>
          <div><span>{text('일정 미입력')}</span><strong>{projects.filter((project) => !scheduledRange(project).start).length}</strong></div>
        </section>}

        <div className="schedule-print-calendar" role="table">
          <div className="schedule-print-calendar__head" role="row">
            <div role="columnheader">{text(selectedProjectId ? '단계 / 담당' : '프로젝트 / PM')}</div>
            {!selectedProjectId && <div className="schedule-print-pm" role="columnheader">{text('담당 PM')}</div>}
            <div className="schedule-print-calendar__days" style={{ gridTemplateColumns: `repeat(${dayCount}, 1fr)` }} role="row">
              {days.map((day) => {
                const info = scheduleDayInfo(year, monthIndex, day);
                return <span key={day} className={info.className} title={dayTitle(info)} role="columnheader"><b>{day}</b><small>{dayLabels[new Date(year, monthIndex, day).getDay()]}</small>{info.holidays.length > 0 && <i>{info.hasKoreanHoliday && info.hasVietnamHoliday ? text('양국') : info.hasKoreanHoliday ? 'KR' : 'VN'}</i>}</span>;
              })}
            </div>
          </div>
          {selectedProjectId && pageProjects[0] ? pageProjects[0].stages.map((stage) => {
            const stageInfo = WORKFLOW_STAGES.find((item) => item.id === stage.stageId);
            const stageName = stageInfo ? text(stageInfo.name) : stage.stageCode ?? text('업무 단계');
            const barStyle = stage.scheduleExplicit ? monthBarStyle(stage.startDate ?? undefined, stage.endDate ?? undefined, pageMonth, dayCount) : undefined;
            return <div className="schedule-print-calendar__row" role="row" key={`${pageProjects[0].id}-${stage.stageId}`}>
              <div className="schedule-print-project" role="cell"><strong>{stage.stageId}. {stageName}</strong><span>{stage.owner}</span><small>{stage.scheduleExplicit ? `${stage.startDate} ~ ${stage.endDate}` : text('일정 미입력')}</small></div>
              <div className="schedule-print-track" style={{ gridTemplateColumns:`repeat(${dayCount}, 1fr)` }} role="cell">
                {days.map((day)=>{const info=scheduleDayInfo(year,monthIndex,day);return <span key={day} className={info.className}/>;})}
                {barStyle ? <div className="schedule-print-range" style={barStyle} title={`${stageName} · ${stage.owner} · ${stage.startDate} ~ ${stage.endDate}`}><span>{stageName}</span></div> : <em>{text(stage.scheduleExplicit ? '이 달에 해당 일정 없음' : '저장 일정 없음')}</em>}
              </div>
            </div>;
          }) : pageProjects.length ? pageProjects.map((project) => {
            const range = scheduledRange(project);
            const barStyle = monthBarStyle(range.start, range.end, pageMonth, dayCount);
            return <div className="schedule-print-calendar__row" role="row" key={project.id}>
              <div className="schedule-print-project" role="cell"><strong>{project.name}</strong><span>{project.code} · {claimLabel(project.claimType)}</span><small>PM {project.responsiblePm?.name ?? text('미지정')} · {text('공정률')} {project.progress}%</small></div>
              <div className="schedule-print-pm" role="cell">{project.responsiblePm?.name ?? text('미지정')}</div>
              <div className="schedule-print-track" style={{ gridTemplateColumns: `repeat(${dayCount}, 1fr)` }} role="cell">
                {days.map((day) => {
                  const info = scheduleDayInfo(year, monthIndex, day);
                  return <span key={day} className={info.className} />;
                })}
                {barStyle ? <div className="schedule-print-range" style={barStyle}><span>{project.name}</span><b>{project.progress}%</b></div> : <em>{text('이 달의 저장 일정 없음')}</em>}
              </div>
            </div>;
          }) : <div className="schedule-print-empty">{text('등록된 프로젝트가 없습니다.')}</div>}
        </div>

        <footer className="schedule-print-sheet__footer">
          <div className="schedule-print-legends"><span><i className="legend-project" />{text('프로젝트 기간')}</span><span><i className="legend-weekend" />{text('주말')}</span><span><i className="legend-korean-holiday" />{text('한국 공휴일')}</span><span><i className="legend-vietnam-holiday" />{text('베트남 휴일')}</span><span><i className="legend-shared-holiday" />{text('양국 공통 휴일')}</span></div>
          <p>{text('※ 일정 변경은 프로젝트 일정표에 저장된 최신 일정을 반영합니다.')}</p>
        </footer>
      </article>;})}
    </section>
  </main>;
}
