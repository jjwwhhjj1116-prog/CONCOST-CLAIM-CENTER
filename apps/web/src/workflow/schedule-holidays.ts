export type ScheduleHolidayCountry = 'KR' | 'VN';

export interface ScheduleHoliday { country: ScheduleHolidayCountry; name: string }

const ANNUAL: Record<string, readonly ScheduleHoliday[]> = {
  '01-01': [{ country: 'KR', name: '신정' }, { country: 'VN', name: '신정' }],
  '04-30': [{ country: 'VN', name: '남부해방기념일' }],
  '05-01': [{ country: 'VN', name: '국제노동절' }],
  '05-05': [{ country: 'KR', name: '어린이날' }],
  '06-06': [{ country: 'KR', name: '현충일' }],
  '08-15': [{ country: 'KR', name: '광복절' }],
  '10-03': [{ country: 'KR', name: '개천절' }],
  '10-09': [{ country: 'KR', name: '한글날' }],
  '12-25': [{ country: 'KR', name: '성탄절' }]
};

// 음력·대체휴일과 베트남 연휴는 연도마다 달라 회사 운영 캘린더의 확정 날짜를 사용합니다.
const YEARLY: Record<string, readonly ScheduleHoliday[]> = {
  '2026-02-14': [{ country: 'VN', name: '뗏 연휴' }],
  '2026-02-15': [{ country: 'VN', name: '뗏 연휴' }],
  '2026-02-16': [{ country: 'KR', name: '설날 연휴' }, { country: 'VN', name: '뗏 연휴' }],
  '2026-02-17': [{ country: 'KR', name: '설날' }, { country: 'VN', name: '뗏(설날)' }],
  '2026-02-18': [{ country: 'KR', name: '설날 연휴' }, { country: 'VN', name: '뗏 연휴' }],
  '2026-02-19': [{ country: 'VN', name: '뗏 연휴' }],
  '2026-02-20': [{ country: 'VN', name: '뗏 연휴' }],
  '2026-02-21': [{ country: 'VN', name: '뗏 연휴' }],
  '2026-02-22': [{ country: 'VN', name: '뗏 연휴' }],
  '2026-03-01': [{ country: 'KR', name: '삼일절' }],
  '2026-03-02': [{ country: 'KR', name: '삼일절 대체공휴일' }],
  '2026-04-27': [{ country: 'VN', name: '흥왕 기념일 대체휴일' }],
  '2026-05-24': [{ country: 'KR', name: '부처님오신날' }],
  '2026-05-25': [{ country: 'KR', name: '부처님오신날 대체공휴일' }],
  '2026-08-17': [{ country: 'KR', name: '광복절 대체공휴일' }],
  '2026-08-31': [{ country: 'VN', name: '국경절 연휴' }],
  '2026-09-01': [{ country: 'VN', name: '국경절 연휴' }],
  '2026-09-02': [{ country: 'VN', name: '국경절' }],
  '2026-09-24': [{ country: 'KR', name: '추석 연휴' }],
  '2026-09-25': [{ country: 'KR', name: '추석' }],
  '2026-09-26': [{ country: 'KR', name: '추석 연휴' }],
  '2026-09-28': [{ country: 'KR', name: '추석 대체공휴일' }],
  '2026-10-05': [{ country: 'KR', name: '개천절 대체공휴일' }]
};

export interface ScheduleDayInfo {
  iso: string; isWeekend: boolean; holidays: readonly ScheduleHoliday[];
  hasKoreanHoliday: boolean; hasVietnamHoliday: boolean; label: string; className: string;
}

export function scheduleDayInfo(year: number, monthIndex: number, day: number): ScheduleDayInfo {
  const month = String(monthIndex + 1).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  const iso = `${year}-${month}-${dayText}`;
  const unique = new Map<string, ScheduleHoliday>();
  [...(ANNUAL[`${month}-${dayText}`] ?? []), ...(YEARLY[iso] ?? [])]
    .forEach((holiday) => unique.set(`${holiday.country}:${holiday.name}`, holiday));
  const holidays = [...unique.values()];
  const hasKoreanHoliday = holidays.some((holiday) => holiday.country === 'KR');
  const hasVietnamHoliday = holidays.some((holiday) => holiday.country === 'VN');
  const weekday = new Date(year, monthIndex, day).getDay();
  const isWeekend = weekday === 0 || weekday === 6;
  const className = [isWeekend && 'is-weekend', weekday === 6 && 'is-saturday', weekday === 0 && 'is-sunday', hasKoreanHoliday && 'is-korean-holiday', hasVietnamHoliday && 'is-vietnam-holiday', hasKoreanHoliday && hasVietnamHoliday && 'is-shared-holiday'].filter(Boolean).join(' ');
  const label = holidays.length ? holidays.map((holiday) => `${holiday.country === 'KR' ? '한국' : '베트남'} ${holiday.name}`).join(', ') : isWeekend ? '주말' : '일반 근무일';
  return { iso, isWeekend, holidays, hasKoreanHoliday, hasVietnamHoliday, label, className };
}
