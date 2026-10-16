/** Validate editable page contents after fonts/images have settled, without changing saved text. */
const contentRects=(source:HTMLElement):DOMRect[]=>{
  const rects:DOMRect[]=[],walker=source.ownerDocument.createTreeWalker(source,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
    const text=walker.currentNode;
    if(!text.textContent?.trim())continue;
    const range=source.ownerDocument.createRange();range.selectNodeContents(text);
    rects.push(...Array.from(range.getClientRects()));
  }
  // A paragraph's line box includes trailing leading, which is not painted text.
  // Keep real objects in the guard, including newly inserted tables and spacers.
  for(const object of source.querySelectorAll('img:not(.ProseMirror-separator),table,hr,[data-document-spacer]'))rects.push(object.getBoundingClientRect());
  return rects.filter(box=>box.width>0&&box.height>0);
};
export function importedHwpPages(source: HTMLElement): { pages: string[]; overflow: boolean } | null {
  if (!source.querySelector(':scope > [data-hwp-import-page]')) return null;
  const pages: string[] = [];
  let overflow = false;
  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue;
    if (node instanceof HTMLElement && node.hasAttribute('data-ai-chapter-marker')) continue;
    if (!(node instanceof HTMLElement) || !node.hasAttribute('data-hwp-import-page')) {
      // Preserve unexpected pasted blocks in the preview, and stop final output until repaired.
      const holder = source.ownerDocument.createElement('div');
      holder.append(node.cloneNode(true)); pages.push(holder.innerHTML); overflow = true;
      continue;
    }
    pages.push(node.outerHTML);
    const page = node.getBoundingClientRect(), tolerance = Math.max(1, page.width / node.offsetWidth) * 1.5;
    const outside = (box: DOMRect) => box.width > 0 && box.height > 0 && (box.left < page.left - tolerance || box.right > page.right + tolerance || box.top < page.top - tolerance || box.bottom > page.bottom + tolerance);
    const boxes: DOMRect[][] = [];
    for (const block of node.children) {
      if (!(block instanceof HTMLElement) || block.hasAttribute('data-hwp-import-rule')) continue;
      const rects: DOMRect[] = [];
      if (block.matches('[data-hwp-text-box]')) {
        rects.push(...contentRects(block));
      } else rects.push(block.getBoundingClientRect());
      if (rects.some(outside)) overflow = true;
      boxes.push(rects);
    }
    // Fixed page anchors may not silently overlap after text, row or photo edits.
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      if (boxes[a].some(first => boxes[b].some(second => Math.min(first.right, second.right) - Math.max(first.left, second.left) > tolerance && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > tolerance))) overflow = true;
    }
    for (const image of node.querySelectorAll<HTMLImageElement>('img:not(.ProseMirror-separator)')) if (image.complete && image.naturalWidth === 0) overflow = true;
    for (const cell of node.querySelectorAll('td,th')) {
      const box = cell.getBoundingClientRect();
      if (contentRects(cell as HTMLElement).some(rect => rect.left < box.left - tolerance || rect.right > box.right + tolerance || rect.top < box.top - tolerance || rect.bottom > box.bottom + tolerance)) overflow = true;
    }
  }
  return { pages, overflow };
}
