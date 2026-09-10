const agencies: Record<string, string> = {
  'www.pps.go.kr': '조달청', 'pps.go.kr': '조달청',
  'www.cak.or.kr': '대한건설협회', 'cak.or.kr': '대한건설협회',
  'www.law.go.kr': '국가법령정보센터', 'law.go.kr': '국가법령정보센터',
  'ecos.bok.or.kr': '한국은행 ECOS',
};

/** Source notes can come from imported/user text. Only public agency HTTPS links are clickable. */
export function esSourceLinks(text: string): { href: string; label: string }[] {
  const links = new Map<string, string>();
  for (const match of text.matchAll(/https:\/\/[^\s<>"']+/giu)) {
    let raw = match[0].replace(/&amp;/gu, '&').replace(/[;,.·]+$/gu, '');
    while (raw.endsWith(')') && (raw.match(/\)/gu)?.length ?? 0) > (raw.match(/\(/gu)?.length ?? 0)) raw = raw.slice(0, -1);
    try {
      const url = new URL(raw), agency = agencies[url.hostname];
      if (!Object.hasOwn(agencies, url.hostname) || !agency || url.protocol !== 'https:' || url.username || url.password || url.port || /[\\\u0000-\u001f]/u.test(raw)) continue;
      if ([...url.searchParams.keys()].some(key => /^(?:oc|servicekey|api[_-]?key|token|access[_-]?token|authorization)$/iu.test(key))) continue;
      if (url.hostname === 'ecos.bok.or.kr' && /^\/api\//iu.test(url.pathname)) continue;
      links.set(url.href, agency + (url.pathname.includes('list.do') ? ' 공표 목록' : /download|fileDown/iu.test(url.pathname) ? ' 첨부자료' : url.hostname === 'ecos.bok.or.kr' ? ' 통계 조회' : ' 원문'));
    } catch { /* Invalid notes stay plain text; never navigate to a guessed URL. */ }
  }
  return [...links].map(([href, label]) => ({ href, label }));
}

export function EsSourceLinks({ text }: { text: string }) {
  const links = esSourceLinks(text);
  return links.length ? <span className="es-source-links">{links.map(({ href, label }, i) => <a key={href} href={href} target="_blank" rel="noopener noreferrer" title="새 탭에서 열기">{label}{links.filter(link => link.label === label).length > 1 ? ` ${i + 1}` : ''} 열기</a>)}</span> : null;
}
