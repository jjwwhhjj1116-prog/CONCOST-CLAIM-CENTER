import { apiRequest } from './api';

/** Existing searchable selectors need all authorized options, not just the first page. */
export async function loadCaseOptions<T extends {id:string}>(path: string): Promise<{cases:T[]}> {
  const url = new URL(path, 'https://local.invalid');
  const cases:T[]=[];
  const seen=new Set<string>();
  let offset=0;
  for (;;) {
    url.searchParams.set('offset',String(offset));
    const page=await apiRequest<{cases:T[];nextOffset?:number|null;total?:number}>(url.pathname+url.search);
    for(const entry of page.cases){
      if(seen.has(entry.id))throw new Error('조회 중 프로젝트 목록이 변경됐습니다. 다시 불러와 주세요.');
      seen.add(entry.id);cases.push(entry);
    }
    if(page.nextOffset==null){
      if(page.total!==undefined&&cases.length!==page.total)throw new Error('프로젝트 목록을 모두 불러오지 못했습니다. 다시 시도해 주세요.');
      return {cases};
    }
    if(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset||!page.cases.length)throw new Error('프로젝트 목록의 다음 페이지를 확인할 수 없습니다.');
    offset=page.nextOffset;
  }
}
