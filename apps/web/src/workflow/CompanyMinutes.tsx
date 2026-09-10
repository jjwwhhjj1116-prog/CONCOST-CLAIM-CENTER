import React from 'react';
import type { MinutesFields } from '../../../cloudflare/src/company-minutes';
import { meetingMinutesWorkbook, type MeetingMinutesExcelValues } from '../proposals/proposal-excel';

export function MinutesFieldsEditor({ value, onChange, disabled, survey = false, dateField, locationField, participantsField }: { value: MinutesFields; onChange: (next: MinutesFields) => void; disabled: boolean; survey?: boolean; dateField?: React.ReactNode; locationField?: React.ReactNode; participantsField?: React.ReactNode }) {
  const field = (key: keyof MinutesFields, label: string, type = 'text') => <label key={key}>{label}<input type={type} value={value[key]} disabled={disabled} maxLength={2000} placeholder={key === 'referenceDepartments' ? '미입력 시 모든 부서' : undefined} onChange={event => onChange({ ...value, [key]: event.target.value })}/></label>;
  return <fieldset className="minutes-fields"><legend>회의 기본정보</legend>
    <div className={`workflow-form-grid minutes-row ${survey ? 'minutes-row--three' : 'minutes-row--time'}`} aria-label="회의 일시와 시간">{dateField}{survey && field('meetingStartTime', '시작 시간', 'time')}{field('meetingEndTime', '종료 시간', 'time')}</div>
    <div className="workflow-form-grid minutes-row minutes-row--one">{locationField}</div>
    <div className="workflow-form-grid minutes-row minutes-row--three" aria-label="작성자 정보">{field('authorDepartment', '작성자 소속')}{field('authorPosition', '작성자 직급')}{field('author', '작성자 성명')}</div>
    <div className="workflow-form-grid minutes-row minutes-row--three" aria-label="거래처와 보고부서">{field('clientName', '거래처명')}{field('reportingDepartment', '보고부서')}{field('referenceDepartments', '참조부서')}</div>
    <div className="workflow-form-grid minutes-row minutes-row--two" aria-label="회의 참석자">{participantsField ?? field('participants', '참석자 (컨코스트)')}{field('clientParticipants', '참석자 (거래처)')}</div>
    {survey && <div className="workflow-form-grid minutes-row minutes-row--one">{field('meetingTitle', '회의명')}</div>}
    <div className="workflow-form-grid minutes-row minutes-row--one">{field('attachmentName', '첨부파일명')}</div>
  </fieldset>;
}

export function downloadMinutes(values: MeetingMinutesExcelValues, filename: string) {
  const bytes = meetingMinutesWorkbook(values);
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CompanyMinutes({ values }: { values: MeetingMinutesExcelValues }) {
  const show = (text?: string) => text?.trim() || '—';
  return <div className="company-minutes-scroll" tabIndex={0} role="region" aria-label="회사 회의록 최종본 표"><table className="company-minutes-table">
    <caption>회 의 록</caption><colgroup>{Array.from({ length: 8 }, (_, index) => <col key={index}/>)}</colgroup><tbody>
      <tr><th scope="row">작성자</th><th>소속</th><td colSpan={2}>{show(values.authorDepartment)}</td><th>직급</th><td>{show(values.authorPosition)}</td><th>성명</th><td>{show(values.author)}</td></tr>
      <tr><th scope="row">회의일시</th><td colSpan={3}>{show(values.meetingDate)}</td><th>시간</th><td>{show(values.meetingTime)}</td><td className="company-minutes-time-separator">~</td><td>{show(values.meetingEndTime)}</td></tr>
      <tr><th scope="row">회의장소</th><td colSpan={7}>{show(values.location)}</td></tr>
      <tr><th scope="row">거래처명</th><td colSpan={7}>{show(values.clientName)}</td></tr>
      <tr><th scope="row">보고부서</th><td colSpan={7}>{show(values.reportingDepartment)}</td></tr>
      <tr><th scope="row">참조부서</th><td colSpan={7}>{values.referenceDepartments?.trim() || '모든 부서'}</td></tr>
      <tr><th scope="row">참석자<br/>(컨코스트)</th><td colSpan={7}>{show(values.participants)}</td></tr>
      <tr><th scope="row">참석자<br/>(거래처)</th><td colSpan={7}>{show(values.clientParticipants)}</td></tr>
      <tr><th scope="row">회의명</th><td colSpan={7}>{show(values.meetingTitle)}</td></tr>
      <tr><th scope="row">첨부파일</th><td colSpan={7}>{show(values.attachmentName)}</td></tr>
      <tr className="company-minutes-section-heading"><th colSpan={8} scope="colgroup">회의내용 및 지시사항</th></tr>
      <tr><td className="company-minutes-content" colSpan={8}><p>{values.summary}</p>{values.followUps && <section><h4>결정사항 · 후속업무</h4><p className="minutes-followups">{values.followUps}</p></section>}</td></tr>
      <tr className="company-minutes-note"><td colSpan={8}>※ 거래처 명함은 PDF 파일로 업로드</td></tr>
    </tbody></table></div>;
}
