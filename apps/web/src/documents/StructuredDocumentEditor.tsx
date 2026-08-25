import CharacterCount from '@tiptap/extension-character-count';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export interface StructuredSelection {
  from: number;
  to: number;
  text: string;
}

export interface StructuredDocumentEditorHandle {
  focus: () => void;
  getJSON: () => JSONContent | null;
  getMarkdown: () => string;
  getSelection: () => StructuredSelection | null;
  replaceRange: (from: number, to: number, replacement: string) => void;
}

interface StructuredDocumentEditorProps {
  value: string;
  editorJson?: JSONContent | null;
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  compact?: boolean;
  documentKey?: string;
  onChange: (markdown: string, editorJson: JSONContent) => void;
  onSelectionChange?: (selection: StructuredSelection | null) => void;
}

const AiChapterMarker = Node.create({
  name: 'aiChapterMarker',
  group: 'block',
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      marker: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-chapter-marker') ?? '',
        renderHTML: (attributes) => ({ 'data-ai-chapter-marker': attributes.marker })
      }
    };
  },
  parseHTML() { return [{ tag: 'div[data-ai-chapter-marker]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'structured-editor__marker' })]; }
});

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const markerPattern = /<!--\s*(AI-CHAPTER:[^:]+:(?:START|END))\s*-->/gu;

const markdownToEditorHtml = (markdown: string): string => {
  const withMarkers = markdown.replace(markerPattern, (_match, marker: string) => `\n<div data-ai-chapter-marker="${marker}"></div>\n`);
  const rendered = marked.parse(withMarkers, { async: false, gfm: true, breaks: true });
  return DOMPurify.sanitize(typeof rendered === 'string' ? rendered : '', {
    ADD_ATTR: ['data-ai-chapter-marker', 'colspan', 'rowspan', 'style', 'target', 'rel']
  });
};

const createTurndown = () => {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**'
  });
  service.use(gfm);
  service.addRule('aiChapterMarker', {
    filter: (node) => node instanceof HTMLElement && node.hasAttribute('data-ai-chapter-marker'),
    replacement: (_content, node) => {
      const marker = node instanceof HTMLElement ? node.getAttribute('data-ai-chapter-marker') : '';
      return marker ? `\n\n<!-- ${marker} -->\n\n` : '';
    }
  });
  return service;
};

const editorHtmlToMarkdown = (html: string): string => createTurndown().turndown(html).replace(/\n{3,}/gu, '\n\n').trim();

const ToolbarButton = ({ active = false, disabled = false, label, onClick, children }: { active?: boolean; disabled?: boolean; label: string; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" className={active ? 'is-active' : ''} disabled={disabled} title={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>
);

const findMatches = (editor: Editor, query: string): Array<{ from: number; to: number }> => {
  const matches: Array<{ from: number; to: number }> = [];
  if (!query) return matches;
  const pattern = new RegExp(escapeRegExp(query), 'giu');
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      matches.push({ from: pos + match.index, to: pos + match.index + match[0].length });
    }
  });
  return matches;
};

export const StructuredDocumentEditor = forwardRef<StructuredDocumentEditorHandle, StructuredDocumentEditorProps>(function StructuredDocumentEditor({
  value,
  editorJson,
  label,
  placeholder = '내용을 입력하세요.',
  readOnly = false,
  compact = false,
  documentKey,
  onChange,
  onSelectionChange
}, ref) {
  const [fullscreen, setFullscreen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const lastEmitted = useRef(value);
  const selectionRef = useRef<StructuredSelection | null>(null);
  const initialContent = useMemo(() => editorJson ?? markdownToEditorHtml(value), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      Underline,
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ allowBase64: false, inline: false }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
      AiChapterMarker
    ],
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor: activeEditor }) => {
      const nextMarkdown = editorHtmlToMarkdown(activeEditor.getHTML());
      lastEmitted.current = nextMarkdown;
      onChange(nextMarkdown, activeEditor.getJSON());
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      const { from, to } = activeEditor.state.selection;
      const text = from === to ? '' : activeEditor.state.doc.textBetween(from, to, '\n');
      const selection = text.trim() ? { from, to, text } : null;
      selectionRef.current = selection;
      onSelectionChange?.(selection);
    }
  }, [documentKey]);

  useEffect(() => { editor?.setEditable(!readOnly); }, [editor, readOnly]);

  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(editorJson ?? markdownToEditorHtml(value), { emitUpdate: false });
  }, [editor, editorJson, value]);

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [fullscreen]);

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus(),
    getJSON: () => editor?.getJSON() ?? null,
    getMarkdown: () => editor ? editorHtmlToMarkdown(editor.getHTML()) : value,
    getSelection: () => selectionRef.current,
    replaceRange: (from, to, next) => {
      if (!editor) return;
      editor.chain().focus().insertContentAt({ from, to }, markdownToEditorHtml(next)).run();
    }
  }), [editor, value]);

  const findNext = () => {
    if (!editor || !search.trim()) { setSearchStatus('찾을 내용을 입력하세요.'); return; }
    const matches = findMatches(editor, search.trim());
    if (!matches.length) { setSearchStatus('일치하는 내용이 없습니다.'); return; }
    const next = matches.find((item) => item.from > editor.state.selection.from) ?? matches[0];
    editor.chain().focus().setTextSelection(next).scrollIntoView().run();
    setSearchStatus(`${matches.length}건 중 다음 위치로 이동했습니다.`);
  };

  const replaceCurrent = () => {
    if (!editor || !search.trim()) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, '\n');
    if (selected.toLocaleLowerCase('ko-KR') !== search.trim().toLocaleLowerCase('ko-KR')) { findNext(); return; }
    editor.chain().focus().insertContentAt({ from, to }, replacement).run();
    setSearchStatus('선택한 1건을 바꿨습니다.');
  };

  const replaceAll = () => {
    if (!editor || !search.trim()) return;
    const matches = findMatches(editor, search.trim());
    let transaction = editor.state.tr;
    for (const match of [...matches].reverse()) transaction = transaction.insertText(replacement, match.from, match.to);
    if (matches.length) editor.view.dispatch(transaction);
    setSearchStatus(matches.length ? `${matches.length}건을 모두 바꿨습니다.` : '일치하는 내용이 없습니다.');
  };

  const addLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('연결할 주소를 입력하세요.', previous ?? 'https://');
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim(), target: '_blank', rel: 'noopener noreferrer' }).run();
  };

  const addImage = () => {
    if (!editor) return;
    const src = window.prompt('로그인으로 보호된 회사 자료실 이미지 주소 또는 공개 이미지 주소를 입력하세요.', '');
    if (!src?.trim()) return;
    const alt = window.prompt('이미지 설명(대체 텍스트)을 입력하세요.', '') ?? '';
    editor.chain().focus().setImage({ src: src.trim(), alt: alt.trim(), title: alt.trim() }).run();
  };

  const wordCount = editor?.getText().trim().split(/\s+/u).filter(Boolean).length ?? 0;
  const characterCount = editor?.storage.characterCount.characters() as number | undefined;

  return <section className={`structured-editor${fullscreen ? ' is-fullscreen' : ''}${compact ? ' is-compact' : ''}${readOnly ? ' is-readonly' : ''}`} aria-label={label}>
    <header className="structured-editor__header">
      <div><strong>{label}</strong><span>{readOnly ? '읽기 전용' : '자동 저장 호환 편집기'}</span></div>
      <div className="structured-editor__view-actions">
        <ToolbarButton label="찾기와 바꾸기" active={showSearch} onClick={() => setShowSearch((current) => !current)}>찾기</ToolbarButton>
        <ToolbarButton label="본문 미리보기" active={preview} onClick={() => setPreview((current) => !current)}>{preview ? '편집' : '미리보기'}</ToolbarButton>
        <ToolbarButton label={fullscreen ? '전체화면 닫기' : '전체화면 편집'} active={fullscreen} onClick={() => setFullscreen((current) => !current)}>{fullscreen ? '축소' : '전체화면'}</ToolbarButton>
      </div>
    </header>
    {!readOnly && !preview && <div className="structured-editor__toolbar" role="toolbar" aria-label="문서 서식 도구">
      <div>
        <ToolbarButton label="실행 취소" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>↶</ToolbarButton>
        <ToolbarButton label="다시 실행" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>↷</ToolbarButton>
      </div>
      <div>
        <ToolbarButton label="본문" active={editor?.isActive('paragraph')} onClick={() => editor?.chain().focus().setParagraph().run()}>본문</ToolbarButton>
        {[1, 2, 3].map((level) => <ToolbarButton key={level} label={`제목 ${level}`} active={editor?.isActive('heading', { level })} onClick={() => editor?.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()}>H{level}</ToolbarButton>)}
      </div>
      <div>
        <ToolbarButton label="굵게" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></ToolbarButton>
        <ToolbarButton label="기울임" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></ToolbarButton>
        <ToolbarButton label="밑줄" active={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarButton>
        <ToolbarButton label="취소선" active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s></ToolbarButton>
        <ToolbarButton label="형광펜" active={editor?.isActive('highlight')} onClick={() => editor?.chain().focus().toggleHighlight().run()}>강조</ToolbarButton>
      </div>
      <div>
        <ToolbarButton label="글머리 목록" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}>• 목록</ToolbarButton>
        <ToolbarButton label="번호 목록" active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1. 목록</ToolbarButton>
        <ToolbarButton label="인용문" active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>인용</ToolbarButton>
      </div>
      <div>
        <ToolbarButton label="왼쪽 정렬" active={editor?.isActive({ textAlign: 'left' })} onClick={() => editor?.chain().focus().setTextAlign('left').run()}>왼쪽</ToolbarButton>
        <ToolbarButton label="가운데 정렬" active={editor?.isActive({ textAlign: 'center' })} onClick={() => editor?.chain().focus().setTextAlign('center').run()}>가운데</ToolbarButton>
        <ToolbarButton label="오른쪽 정렬" active={editor?.isActive({ textAlign: 'right' })} onClick={() => editor?.chain().focus().setTextAlign('right').run()}>오른쪽</ToolbarButton>
      </div>
      <div>
        <ToolbarButton label="표 삽입" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>표 +</ToolbarButton>
        <ToolbarButton label="표 행 추가" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().addRowAfter().run()}>행 +</ToolbarButton>
        <ToolbarButton label="표 열 추가" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().addColumnAfter().run()}>열 +</ToolbarButton>
        <ToolbarButton label="표 행 삭제" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteRow().run()}>행 −</ToolbarButton>
        <ToolbarButton label="표 열 삭제" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteColumn().run()}>열 −</ToolbarButton>
        <ToolbarButton label="표 삭제" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteTable().run()}>표 삭제</ToolbarButton>
      </div>
      <div>
        <ToolbarButton label="링크" active={editor?.isActive('link')} onClick={addLink}>링크</ToolbarButton>
        <ToolbarButton label="이미지" onClick={addImage}>이미지</ToolbarButton>
        <ToolbarButton label="구분선" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>구분선</ToolbarButton>
        <ToolbarButton label="서식 지우기" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}>서식 지우기</ToolbarButton>
      </div>
    </div>}
    {showSearch && <div className="structured-editor__search" role="search"><label>찾기<input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); findNext(); } }} /></label><label>바꾸기<input value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label><button type="button" onClick={findNext}>다음 찾기</button>{!readOnly && <><button type="button" onClick={replaceCurrent}>현재 바꾸기</button><button type="button" className="is-primary" onClick={replaceAll}>모두 바꾸기</button></>}<span role="status">{searchStatus}</span></div>}
    <div className="structured-editor__canvas">
      {preview ? <article className="structured-editor__preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(editor?.getHTML() ?? '') }} /> : <EditorContent editor={editor} />}
    </div>
    <footer><span>{wordCount.toLocaleString('ko-KR')}단어</span><span>{(characterCount ?? 0).toLocaleString('ko-KR')}자</span><span>Markdown + Tiptap JSON 호환</span></footer>
  </section>;
});
