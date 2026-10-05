/** Render-only normalization. Never rewrite saved chapter IDs, prose, tables or images. */
export function prepareReportPrint(source: HTMLElement) {
  let chapter = 0;
  for (const heading of [...source.querySelectorAll<HTMLElement>('h1,h2')]) {
    const prefix = /^\s*CH-\d+\s*[:.·-]?\s+/u.exec(heading.textContent ?? '');
    if (!prefix) continue;
    chapter++;
    const title = (heading.textContent ?? '').slice(prefix[0].length).trim();
    // The generated wrapper and its first body heading may repeat the same title.
    const next = heading.nextElementSibling;
    let target = heading;
    if (next?.matches('h1,h2') && next.textContent?.trim() === title) {
      target = next as HTMLElement; heading.remove();
    } else {
      let remaining = prefix[0].length;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      while (remaining && walker.nextNode()) {
        const text = walker.currentNode as Text, length = Math.min(remaining, text.length);
        text.deleteData(0, length); remaining -= length;
      }
    }
    const normalized = document.createElement('h1');
    for (const attr of [...target.attributes]) normalized.setAttribute(attr.name, attr.value);
    normalized.append(`${chapter}. `, ...target.childNodes); target.replaceWith(normalized);
    let previous = normalized.previousElementSibling;
    while (previous?.hasAttribute('data-ai-chapter-marker')) previous = previous.previousElementSibling;
    // Keep intentional manual breaks, but do not add a second automatic one.
    if (chapter > 1 && !previous?.hasAttribute('data-document-page-break')) {
      const pageBreak = document.createElement('div'); pageBreak.dataset.documentPageBreak = 'true';
      normalized.before(pageBreak);
    }
  }
  const occurrences = new Map<string, number>();
  return [...source.querySelectorAll<HTMLElement>('h1,h2,h3')]
    .filter(heading => heading.textContent?.trim())
    .map((heading, index) => {
      heading.dataset.reportTocId = String(index);
      const title = heading.textContent!.trim(), level = Number(heading.tagName.slice(1));
      const base = `${level}:${title}`;
      const occurrence = (occurrences.get(base) ?? 0) + 1; occurrences.set(base, occurrence);
      return { id: String(index), title, level, key: `${base}#${occurrence}` };
    });
}

export function reportContentsPages(source: HTMLElement, bodyPages: string[], headings: ReturnType<typeof prepareReportPrint>, titles: Record<string, string> = {}) {
  const pageById = new Map<string, number>();
  bodyPages.forEach((html, index) => {
    const page = document.createElement('div'); page.innerHTML = html;
    page.querySelectorAll<HTMLElement>('[data-report-toc-id]').forEach(heading => {
      if (!pageById.has(heading.dataset.reportTocId!)) pageById.set(heading.dataset.reportTocId!, index + 1);
    });
  });
  source.replaceChildren();
  for (const heading of headings) {
    const row = document.createElement('div'); row.className = `report-toc-entry report-toc-level-${heading.level}`;
    const title = document.createElement('span'); title.textContent = titles[heading.key] ?? heading.title;
    const leader = document.createElement('span'); leader.className = 'report-toc-leader';
    const page = document.createElement('span'); page.className = 'report-toc-page'; page.textContent = String(pageById.get(heading.id) ?? '—');
    row.append(title, leader, page); source.append(row);
  }
}
