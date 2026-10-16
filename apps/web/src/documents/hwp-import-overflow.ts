/** Validate editable page contents after fonts/images have settled, without changing saved text. */
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
        const range = source.ownerDocument.createRange(); range.selectNodeContents(block);
        rects.push(...Array.from(range.getClientRects()).filter(box => box.width > 0 && box.height > 0));
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
      const range = source.ownerDocument.createRange(); range.selectNodeContents(cell);
      const box = cell.getBoundingClientRect();
      if (Array.from(range.getClientRects()).some(rect => rect.width > 0 && (rect.left < box.left - tolerance || rect.right > box.right + tolerance || rect.top < box.top - tolerance || rect.bottom > box.bottom + tolerance))) overflow = true;
    }
  }
  return { pages, overflow };
}
