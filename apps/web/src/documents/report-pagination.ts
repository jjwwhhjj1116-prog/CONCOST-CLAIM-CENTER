/** Paginate rendered HTML only; never insert layout nodes into the saved editor. */
export function paginateReport(source: HTMLElement, height: number): { pages: string[]; overflow: boolean } {
  const nativeOnly = !source.textContent?.trim() && source.querySelector('img[data-report-source-page="true"]') && !source.querySelector('img:not([data-report-source-page="true"])');
  const tester = source.cloneNode(false) as HTMLElement;
  tester.style.cssText = `position:absolute;left:0;top:0;width:${source.clientWidth}px;height:auto;min-height:0;max-height:none;display:flow-root;overflow:visible;margin:0;`;
  source.append(tester);
  const pages: string[] = [];
  let overflow = height < 40;
  const fits = () => tester.scrollHeight <= height + 1 && tester.scrollWidth <= source.clientWidth + 1;
  const commit = (explicitBreak = false) => { if (tester.childNodes.length || explicitBreak) { pages.push(tester.innerHTML); tester.replaceChildren(); } };
  const appendAtomic = (node: Node) => {
    const copy = node.cloneNode(true); tester.append(copy);
    if (fits()) return;
    copy.parentNode?.removeChild(copy); commit(); tester.append(copy);
    if (!fits()) overflow = true;
  };
  const retainListOrdinals = (root: HTMLElement) => {
    for (const list of [...(root.tagName==='OL'?[root]:[]), ...root.querySelectorAll<HTMLOListElement>('ol')]) {
      const items=[...list.children].filter(item=>item.tagName==='LI');
      const reversed=list.hasAttribute('reversed');
      let ordinal=Number(list.getAttribute('start')??(reversed?items.length:1));
      for(const item of items){
        if(item.hasAttribute('value'))ordinal=Number(item.getAttribute('value'));
        item.setAttribute('value',String(ordinal));ordinal+=reversed?-1:1;
      }
    }
  };
  // DOM ranges retain inline formatting, links, line breaks and images when a
  // paragraph is taller than a sheet. Only text/BR boundaries can be split.
  const splitTextBlock = (block: HTMLElement) => {
    let rest = block.cloneNode(true) as HTMLElement;
    // A nested ordered list may begin half-way down a later page. Persist each
    // item's display ordinal in this render-only clone before ranges split it.
    retainListOrdinals(rest);
    while (rest.childNodes.length) {
      tester.append(rest);
      if (fits()) return;
      rest.remove();
      // A paragraph that fits a fresh sheet is not an oversized block. Keep it
      // intact with its immediately preceding headings instead of splitting a word
      // into a one-line continuation. All measurements use render-only clones.
      if (rest.tagName === 'P' && tester.childNodes.length && !rest.querySelector('img,table,svg,canvas,iframe,video,audio,object,embed,input,textarea,button')) {
        const prior=[...tester.childNodes], headings:Node[]=[];
        for (let index=prior.length-1;index>=0;index--) {
          const node=prior[index];
          if (!(node instanceof HTMLElement) || !/^H[1-6]$/u.test(node.tagName)) break;
          headings.unshift(node);
        }
        tester.replaceChildren(...headings,rest);
        const fitsFresh=fits();
        tester.replaceChildren(...prior);
        if (fitsFresh) {
          headings.forEach(heading=>heading.parentNode?.removeChild(heading));
          commit(); tester.append(...headings,rest); return;
        }
      }
      const positions: Array<[Node, number]> = [];
      const walk = document.createTreeWalker(rest, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      while (walk.nextNode()) {
        const node = walk.currentNode;
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? '';
          for (let offset = 1; offset <= text.length; offset++) {
            if (offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1])) continue;
            positions.push([node, offset]);
          }
        } else if ((node as Element).tagName === 'BR' && node.parentNode) {
          positions.push([node.parentNode, Array.prototype.indexOf.call(node.parentNode.childNodes, node) + 1]);
        }
      }
      const fragment = (at: number, tail = false) => {
        const range = document.createRange(); range.selectNodeContents(rest);
        const continuation: HTMLElement[]=[];
        if (tail) {
          let [container,offset]=positions[at];
          // Starting at the end of a consumed LI otherwise leaves an empty
          // numbered item in cloneContents(), shifting the following numbers.
          while(container!==rest && offset===(container.nodeType===Node.TEXT_NODE?(container.textContent??'').length:container.childNodes.length)){
            const parent=container.parentNode!;
            offset=Array.prototype.indexOf.call(parent.childNodes,container)+1;container=parent;
          }
          range.setStart(container,offset);
          for(let ancestor=container.nodeType===Node.ELEMENT_NODE?container as HTMLElement:container.parentElement;ancestor&&ancestor!==rest;ancestor=ancestor.parentElement){
            if(ancestor.tagName==='LI'){ancestor.setAttribute('data-report-list-continuation','true');continuation.push(ancestor);}
          }
        } else range.setEnd(...positions[at]);
        const shell = rest.cloneNode(false) as HTMLElement; shell.append(range.cloneContents());
        for(const item of shell.querySelectorAll<HTMLElement>('[data-report-list-continuation]')){item.style.listStyleType='none';item.removeAttribute('data-report-list-continuation');}
        continuation.forEach(item=>item.removeAttribute('data-report-list-continuation'));
        return shell;
      };
      let low = 0, high = positions.length - 1, best = -1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2), part = fragment(mid);
        tester.append(part); const ok = fits(); part.remove();
        if (ok) { best = mid; low = mid + 1; } else high = mid - 1;
      }
      if (best < 0) {
        if (tester.childNodes.length) { commit(); continue; }
        appendAtomic(rest); return;
      }
      tester.append(fragment(best)); commit(); rest = fragment(best, true);
      // A continuation is not a new indented paragraph/list item.
      rest.style.textIndent = '0';
      if (rest.tagName === 'LI') rest.style.listStyleType = 'none';
    }
  };
  const splitList = (list: HTMLOListElement) => {
    let ordinal = Number(list.getAttribute('start') ?? (list.reversed ? list.children.length : 1));
    const direction = list.reversed ? -1 : 1;
    for (const item of [...list.children]) {
      if (item.hasAttribute('value')) ordinal = Number(item.getAttribute('value'));
      const shell = list.cloneNode(false) as HTMLElement;
      if (list.tagName === 'OL') shell.setAttribute('start', String(ordinal));
      shell.append(item.cloneNode(true)); tester.append(shell);
      if (!fits()) {
        shell.remove(); commit(); tester.append(shell);
        if (!fits()) { shell.remove(); if (item.querySelector('table')) appendAtomic(shell); else splitTextBlock(shell); }
      }
      ordinal += direction;
    }
  };
  const splitTable = (table: HTMLTableElement) => {
    // A cell-local manual break cannot split the table grid safely. Preserve
    // the entire source and block output instead of silently ignoring it.
    if (table.querySelector('[data-document-page-break]')) { appendAtomic(table); overflow = true; return; }
    const rows = [...table.rows]; // Direct table rows, not nested table rows.
    const headers = rows.filter((row, index) => row.parentElement?.tagName === 'THEAD' || (index === 0 && [...row.cells].every(cell => cell.tagName === 'TH')));
    const bodyRows = rows.filter(row => !headers.includes(row));
    const shell = () => {
      const next = table.cloneNode(false) as HTMLTableElement;
      for (const child of [...table.children]) if (['COLGROUP', 'CAPTION'].includes(child.tagName)) next.append(child.cloneNode(true));
      if (headers.length) { const head = next.createTHead(); headers.forEach(row => head.append(row.cloneNode(true))); }
      next.createTBody(); return next;
    };
    let current = shell(); tester.append(current);
    const splitTallRow = (row: HTMLTableRowElement) => {
      // Render-only continuation rows keep the original table grid. A merged
      // row or atomic image cannot be split without changing its meaning.
      if ([...row.cells].some(cell => cell.rowSpan !== 1 || cell.querySelector('img,table,svg,canvas,iframe,video,audio,object,embed,hr,input,textarea,button') || (!cell.textContent?.length && !cell.querySelector('br') && cell.childElementCount))) return false;
      const startPages = pages.length;
      const fail = () => {
        // A later unsplittable cell must not leave earlier fragments beside
        // the intact blocked row: that would duplicate evidence in preview.
        pages.length = startPages; tester.replaceChildren();
        current = shell(); tester.append(current); return false;
      };
      let remaining = [...row.cells].map(cell => cell.cloneNode(true) as HTMLTableCellElement);
      remaining.forEach(retainListOrdinals);
      const meaningful = (cell: HTMLTableCellElement) => Boolean(cell.textContent?.length || cell.querySelector('br'));
      for (let page = 0; page < 200; page++) {
        const part = row.cloneNode(false) as HTMLTableRowElement;
        part.append(...remaining.map(cell => cell.cloneNode(false)));
        current.tBodies[0].append(part);
        let advanced = false;
        const next: HTMLTableCellElement[] = [];
        for (let index = 0; index < remaining.length; index++) {
          const cell = remaining[index], placeholder = part.cells[index];
          if (!meaningful(cell)) { next.push(cell.cloneNode(false) as HTMLTableCellElement); continue; }
          const full = cell.cloneNode(true) as HTMLTableCellElement;
          placeholder.replaceWith(full);
          if (fits()) { advanced = true; next.push(cell.cloneNode(false) as HTMLTableCellElement); continue; }
          full.replaceWith(placeholder);
          const positions: Array<[Node, number]> = [];
          const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
          while (walk.nextNode()) {
            const node = walk.currentNode;
            if (node.nodeType === Node.TEXT_NODE) {
              const content = node.textContent ?? '';
              for (let offset = 1; offset <= content.length; offset++) {
                if (offset < content.length && /[\uD800-\uDBFF]/u.test(content[offset - 1])) continue;
                positions.push([node, offset]);
              }
            } else if ((node as Element).tagName === 'BR' && node.parentNode) {
              positions.push([node.parentNode, Array.prototype.indexOf.call(node.parentNode.childNodes, node) + 1]);
            }
          }
          const fragment = (at: number, tail = false) => {
            const range = document.createRange(); range.selectNodeContents(cell);
            let [container, offset] = positions[at];
            const continuation: HTMLElement[] = [];
            if (tail) {
              while (container !== cell && offset === (container.nodeType === Node.TEXT_NODE ? (container.textContent ?? '').length : container.childNodes.length)) {
                const parent = container.parentNode!;
                offset = Array.prototype.indexOf.call(parent.childNodes, container) + 1; container = parent;
              }
              range.setStart(container, offset);
              for (let ancestor = container.nodeType === Node.ELEMENT_NODE ? container as HTMLElement : container.parentElement; ancestor && ancestor !== cell; ancestor = ancestor.parentElement) {
                if (ancestor.tagName === 'LI') { ancestor.setAttribute('data-report-list-continuation', 'true'); continuation.push(ancestor); }
              }
            } else range.setEnd(container, offset);
            const copy = cell.cloneNode(false) as HTMLTableCellElement;
            copy.append(range.cloneContents());
            for (const item of copy.querySelectorAll<HTMLElement>('[data-report-list-continuation]')) { item.style.listStyleType = 'none'; item.removeAttribute('data-report-list-continuation'); }
            continuation.forEach(item => item.removeAttribute('data-report-list-continuation'));
            return copy;
          };
          let low = 0, high = positions.length - 1, best = -1;
          while (low <= high) {
            const middle = Math.floor((low + high) / 2), candidate = fragment(middle);
            placeholder.replaceWith(candidate); const okay = fits(); candidate.replaceWith(placeholder);
            if (okay) { best = middle; low = middle + 1; } else high = middle - 1;
          }
          if (best < 0) { next.push(cell); continue; }
          placeholder.replaceWith(fragment(best)); next.push(fragment(best, true)); advanced = true;
        }
        if (!advanced || !fits()) return fail();
        if (next.every(cell => !meaningful(cell))) return true;
        remaining = next; commit(); current = shell(); tester.append(current);
      }
      return fail();
    };
    for (let index = 0; index < bodyRows.length;) {
      // Keep every connected rowspan group on one sheet.
      const group: HTMLTableRowElement[] = []; let end = index + 1;
      for (; index < Math.min(end, bodyRows.length); index++) {
        const row = bodyRows[index]; group.push(row);
        for (const cell of [...row.cells]) end = Math.max(end, cell.rowSpan === 0 ? bodyRows.length : index + cell.rowSpan);
      }
      const copies = group.map(row => row.cloneNode(true)); current.tBodies[0].append(...copies);
      if (!fits()) {
        copies.forEach(copy => copy.parentNode?.removeChild(copy));
        if (!current.tBodies[0].rows.length) current.remove();
        commit(); current = shell(); tester.append(current); current.tBodies[0].append(...copies);
        if (!fits()) {
          copies.forEach(copy => copy.parentNode?.removeChild(copy));
          if (group.length !== 1 || !splitTallRow(group[0])) {
            current.tBodies[0].append(...copies); overflow = true;
          }
        }
      }
    }
    if (!bodyRows.length && !fits()) { current.remove(); appendAtomic(table); }
  };
  try {
    const nodes: Node[]=[];
    for(const original of [...source.childNodes].filter(node=>node!==tester)){
      if(!(original instanceof HTMLElement)||original.tagName==='TABLE'||original.querySelector('table')||!original.querySelector('[data-document-page-break]')){nodes.push(original);continue;}
      const container=original.cloneNode(true) as HTMLElement;retainListOrdinals(container);
      const range=document.createRange();range.selectNodeContents(container);
      for(const marker of container.querySelectorAll('[data-document-page-break]')){
        range.setEndBefore(marker);const contents=range.cloneContents();
        if(contents.childNodes.length){const part=container.cloneNode(false);part.appendChild(contents);nodes.push(part);}
        nodes.push(marker.cloneNode(true));
        let boundary:Node=marker.parentNode!,offset=Array.prototype.indexOf.call(boundary.childNodes,marker)+1;
        while(boundary!==container&&offset===boundary.childNodes.length){
          const parent=boundary.parentNode!;offset=Array.prototype.indexOf.call(parent.childNodes,boundary)+1;boundary=parent;
        }
        range.setStart(boundary,offset);range.setEnd(container,container.childNodes.length);
        // The next range may continue the same list item. Only its first sheet
        // should show that marker; later siblings retain their own ordinals.
        for(let ancestor=boundary as HTMLElement;ancestor&&ancestor!==container;ancestor=ancestor.parentElement!){
          if(ancestor.tagName==='LI')ancestor.style.listStyleType='none';
        }
      }
      const contents=range.cloneContents();if(contents.childNodes.length){const part=container.cloneNode(false);part.appendChild(contents);nodes.push(part);}
    }
    for (const node of nodes) {
      if (node.nodeType === Node.COMMENT_NODE || (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim())) continue;
      if (node instanceof HTMLElement && node.hasAttribute('data-ai-chapter-marker')) continue;
      // Tiptap's block image conversion may leave empty paragraph wrappers.
      // Ignore those only for an otherwise all-native page document.
      if (nativeOnly && node instanceof HTMLElement && node.matches('p') && !node.textContent?.trim() && !node.querySelector(':not(br)')) continue;
      if (node instanceof HTMLElement && node.querySelector('table [data-document-page-break]')) { appendAtomic(node); overflow = true; continue; }
      if (node instanceof HTMLElement) {
        const nativePage = node.matches('img[data-report-source-page="true"]') ? node : !node.textContent?.trim() && node.querySelector('img[data-report-source-page="true"]');
        if (nativePage && node.querySelectorAll('img').length <= 1) { commit(); pages.push(nativePage.outerHTML); continue; }
      }
      if (node instanceof HTMLElement && node.hasAttribute('data-document-page-break')) { commit(true); continue; }
      const copy = node.cloneNode(true); tester.append(copy);
      if (fits()) continue;
      copy.parentNode?.removeChild(copy);
      if (node instanceof HTMLTableElement) splitTable(node);
      else if (node instanceof HTMLElement && ['UL', 'OL'].includes(node.tagName)) splitList(node as HTMLOListElement);
      else if (node instanceof HTMLElement && !node.querySelector('table') && node.textContent?.length) splitTextBlock(node);
      else appendAtomic(node);
    }
    commit(); return { pages: pages.length ? pages : [''], overflow };
  } finally { tester.remove(); }
}
