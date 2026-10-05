import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Presentation only: saved IDs/text and AI chapter boundaries remain intact. */
export const ReportChapterDecoration = Extension.create({
  name: 'reportChapterDecoration',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations(state) {
      const decorations: Decoration[] = [];
      let chapter = 0;
      state.doc.forEach((node, pos, index) => {
        if (node.type.name !== 'heading') return;
        const prefix = /^\s*CH-\d+\s*[:.·-]?\s+/u.exec(node.textContent);
        if (!prefix) return;
        chapter++;
        const next = index + 1 < state.doc.childCount ? state.doc.child(index + 1) : null;
        const duplicate = next?.type.name === 'heading' && next.textContent.trim() === node.textContent.slice(prefix[0].length).trim();
        const targetPos = duplicate ? pos + node.nodeSize : pos;
        const target = duplicate ? next! : node;
        if (duplicate) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'report-chapter-hidden' }));
        else decorations.push(Decoration.inline(pos + 1, pos + 1 + prefix[0].length, { class: 'report-chapter-hidden' }));
        decorations.push(Decoration.node(targetPos, targetPos + target.nodeSize, { class: 'report-chapter-heading', 'data-report-chapter-number': `${chapter}. ` }));
      });
      return DecorationSet.create(state.doc, decorations);
    } } })];
  }
});
