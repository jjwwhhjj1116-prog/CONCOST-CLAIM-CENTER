import { HocuspocusProvider, WebSocketStatus, type StatesArray } from '@hocuspocus/provider';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import CharacterCount from '@tiptap/extension-character-count';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import * as Y from 'yjs';

export interface StructuredSelection {
  from: number;
  to: number;
  text: string;
}

export type StructuredSelectionImprovementMode = 'professional' | 'concise' | 'custom';

export interface StructuredSelectionAssistant {
  busy?: boolean;
  disabled?: boolean;
  onImprove: (mode: StructuredSelectionImprovementMode, selection: StructuredSelection) => void;
}

export interface StructuredDocumentEditorHandle {
  focus: () => void;
  getJSON: () => JSONContent | null;
  getMarkdown: () => string;
  getSelection: () => StructuredSelection | null;
  replaceRange: (from: number, to: number, replacement: string) => void;
  insertTable: (rows?: number, columns?: number) => void;
  insertImage: (image: { src: string; alt: string; title?: string }) => void;
  deleteSelectedTable: () => boolean;
  deleteSelectedImage: () => { deleted: boolean; src?: string };
  moveSelectedImage: (direction: 'up' | 'down') => boolean;
  dismissSelectionMenu: () => void;
}

interface StructuredDocumentEditorProps {
  value: string;
  editorJson?: JSONContent | null;
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  compact?: boolean;
  documentKey?: string;
  collaboration?: {
    documentId: string;
    userName: string;
    userEmail?: string;
  };
  selectionAssistant?: StructuredSelectionAssistant;
  onRequestInsertTable?: () => void;
  onChange: (markdown: string, editorJson: JSONContent) => void;
  onSelectionChange?: (selection: StructuredSelection | null) => void;
}

interface CollaborationSession {
  document: Y.Doc;
  provider: HocuspocusProvider;
  user: { name: string; color: string; email?: string };
}

interface StructuredDocumentEditorCoreProps extends StructuredDocumentEditorProps {
  collaborationSession?: CollaborationSession | null;
  collaborationStatus?: WebSocketStatus;
  collaborationSynced?: boolean;
  collaborationUsers?: Array<{ clientId: number; name: string; color: string }>;
  collaborationError?: string;
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
const markerPattern = /<!--\s*((?:AI|MANUAL)-CHAPTER:[^:]+:(?:START|END))\s*-->/gu;

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

const collaborationColor = (identity: string): string => {
  const palette = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#059669', '#4f46e5', '#be123c'];
  let hash = 0;
  for (const character of identity) hash = ((hash << 5) - hash + character.codePointAt(0)!) | 0;
  return palette[Math.abs(hash) % palette.length];
};

const normalizeCollaborationUsers = (states: StatesArray): Array<{ clientId: number; name: string; color: string }> => states.flatMap((state) => {
  const user = state.user as { name?: unknown; color?: unknown } | undefined;
  if (!user || typeof user.name !== 'string' || !user.name.trim()) return [];
  return [{ clientId: state.clientId, name: user.name.trim(), color: typeof user.color === 'string' ? user.color : collaborationColor(user.name) }];
});

const StructuredDocumentEditorCore = forwardRef<StructuredDocumentEditorHandle, StructuredDocumentEditorCoreProps>(function StructuredDocumentEditorCore({
  value,
  editorJson,
  label,
  placeholder = '내용을 입력하세요.',
  readOnly = false,
  compact = false,
  documentKey,
  collaborationSession = null,
  collaborationStatus = WebSocketStatus.Disconnected,
  collaborationSynced = false,
  collaborationUsers = [],
  collaborationError = '',
  selectionAssistant,
  onRequestInsertTable,
  onChange,
  onSelectionChange
}, ref) {
  const [fullscreen, setFullscreen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [activeSelection, setActiveSelection] = useState<StructuredSelection | null>(null);
  const [imageSelected, setImageSelected] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const lastEmitted = useRef(value);
  const selectionRef = useRef<StructuredSelection | null>(null);
  // useEditor is recreated for each documentKey. Calculate this value on that
  // render so a chapter never inherits the previous chapter's first content.
  const initialContent = collaborationSession ? undefined : editorJson ?? markdownToEditorHtml(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure(collaborationSession ? { undoRedo: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } } : { link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ allowBase64: false, inline: false }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
      AiChapterMarker,
      ...(collaborationSession ? [
        Collaboration.configure({ document: collaborationSession.document }),
        CollaborationCaret.configure({ provider: collaborationSession.provider, user: collaborationSession.user })
      ] : [])
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
      setImageSelected(activeEditor.state.selection instanceof NodeSelection && activeEditor.state.selection.node.type.name === 'image');
      const text = from === to ? '' : activeEditor.state.doc.textBetween(from, to, '\n');
      const selection = text.trim() ? { from, to, text } : null;
      selectionRef.current = selection;
      setActiveSelection(selection);
      if (!selection) setCopyStatus('');
      onSelectionChange?.(selection);
    }
  }, [documentKey, collaborationSession]);

  useEffect(() => {
    if (!editor?.isInitialized || editor.isDestroyed) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    setImageSelected(false);
    setActiveSelection(null);
    selectionRef.current = null;
  }, [documentKey]);

  useEffect(() => {
    if (collaborationSession) return;
    if (!editor?.isInitialized || editor.isDestroyed || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(editorJson ?? markdownToEditorHtml(value), { emitUpdate: false });
  }, [collaborationSession, editor, editorJson, value]);

  useEffect(() => {
    if (!collaborationSession || !collaborationSynced || !editor?.isInitialized || editor.isDestroyed || !editor.isEmpty || !value.trim()) return;
    editor.commands.setContent(editorJson ?? markdownToEditorHtml(value));
  }, [collaborationSession, collaborationSynced, editor, editorJson, value]);

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [fullscreen]);

  const deleteSelectedImageNode = (): { deleted: boolean; src?: string } => {
    if (!editor || !(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') return { deleted: false };
    const src = typeof editor.state.selection.node.attrs.src === 'string' ? editor.state.selection.node.attrs.src : undefined;
    editor.chain().focus().deleteSelection().run();
    window.dispatchEvent(new CustomEvent('structured-editor:image-deleted', { detail: { documentKey, src } }));
    return { deleted: true, ...(src ? { src } : {}) };
  };

  useImperativeHandle(ref, () => ({
    focus: () => { editor?.chain().focus().run(); },
    getJSON: () => editor?.getJSON() ?? null,
    getMarkdown: () => editor ? editorHtmlToMarkdown(editor.getHTML()) : value,
    getSelection: () => selectionRef.current,
    replaceRange: (from, to, next) => {
      if (!editor) return;
      editor.chain().focus().insertContentAt({ from, to }, markdownToEditorHtml(next)).run();
    },
    insertTable: (rows, columns) => {
      if (rows === undefined || columns === undefined) {
        setTableDialogOpen(true);
        return;
      }
      editor?.chain().focus().insertTable({ rows, cols: columns, withHeaderRow: true }).run();
    },
    insertImage: ({ src, alt, title }) => {
      editor?.chain().focus().setImage({ src, alt, title: title ?? alt }).run();
    },
    deleteSelectedTable: () => {
      if (!editor?.isActive('table')) return false;
      editor.chain().focus().deleteTable().run();
      return true;
    },
    deleteSelectedImage: () => {
      return deleteSelectedImageNode();
    },
    moveSelectedImage: (direction) => {
      if (!editor || !(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') return false;
      const { selection } = editor.state;
      const parent = selection.$from.parent;
      const index = selection.$from.index();
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= parent.childCount) return false;
      const neighbor = parent.child(targetIndex);
      const image = selection.node;
      const from = selection.from;
      const nextPosition = direction === 'up' ? from - neighbor.nodeSize : from + neighbor.nodeSize;
      const transaction = editor.state.tr.delete(from, from + image.nodeSize).insert(nextPosition, image);
      transaction.setSelection(NodeSelection.create(transaction.doc, nextPosition));
      editor.view.dispatch(transaction.scrollIntoView());
      return true;
    },
    dismissSelectionMenu: () => {
      if (!editor) return;
      editor.chain().setTextSelection(editor.state.selection.to).blur().run();
      selectionRef.current = null;
      setActiveSelection(null);
      onSelectionChange?.(null);
    }
  }), [editor, onSelectionChange, value]);

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

  const copySelectedText = async () => {
    const selection = selectionRef.current;
    if (!selection?.text.trim()) return;
    try {
      await navigator.clipboard.writeText(selection.text);
      setCopyStatus('복사됨');
      window.setTimeout(() => setCopyStatus(''), 1400);
    } catch {
      setCopyStatus('복사 실패');
    }
  };

  const runSelectionImprovement = (mode: StructuredSelectionImprovementMode) => {
    const selection = selectionRef.current;
    if (!selection || selectionAssistant?.disabled || selectionAssistant?.busy) return;
    selectionAssistant?.onImprove(mode, selection);
  };

  const wordCount = editor?.getText().trim().split(/\s+/u).filter(Boolean).length ?? 0;
  const characterCount = editor?.storage.characterCount.characters() as number | undefined;

  return <>
    {tableDialogOpen && createPortal(<div className="structured-editor__table-dialog-backdrop" role="presentation" onMouseDown={()=>setTableDialogOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="structured-table-dialog-title" className="structured-editor__table-dialog" onMouseDown={(event)=>event.stopPropagation()}><h2 id="structured-table-dialog-title">표 크기 설정</h2><p>커서를 표가 들어갈 위치에 둔 뒤 필요한 행과 열 수를 지정하세요. 첫 번째 행은 제목 행으로 생성됩니다.</p><div><label><span>행 수</span><input type="number" min="2" max="30" value={tableRows} onChange={(event)=>setTableRows(Math.min(30,Math.max(2,Number(event.target.value)||2)))}/></label><b>×</b><label><span>열 수</span><input type="number" min="2" max="12" value={tableColumns} onChange={(event)=>setTableColumns(Math.min(12,Math.max(2,Number(event.target.value)||2)))}/></label></div><small>행 2~30개, 열 2~12개까지 만들 수 있습니다.</small><footer><button type="button" onClick={()=>setTableDialogOpen(false)}>취소</button><button type="button" className="is-primary" onClick={()=>{editor?.chain().focus().insertTable({rows:tableRows,cols:tableColumns,withHeaderRow:true}).run();setTableDialogOpen(false);}}>▦ {tableRows}행 × {tableColumns}열 표 만들기</button></footer></section></div>,document.body)}
    <section className={`structured-editor${fullscreen ? ' is-fullscreen' : ''}${compact ? ' is-compact' : ''}${readOnly ? ' is-readonly' : ''}`} aria-label={label}>
    <header className="structured-editor__header">
      <div><strong>{label}</strong><span>{readOnly ? '읽기 전용' : collaborationSession ? '실시간 공동 편집 + 자동 저장' : '자동 저장 호환 편집기'}</span></div>
      {collaborationSession && <div className="structured-editor__collaboration" data-status={collaborationStatus}>
        <span>{collaborationError ? '인증 확인 필요' : collaborationStatus === WebSocketStatus.Connected ? (collaborationSynced ? '실시간 연결됨' : '문서 동기화 중…') : collaborationStatus === WebSocketStatus.Connecting ? '협업 서버 연결 중…' : '오프라인 편집 중'}</span>
        <div aria-label={`현재 공동 편집자 ${collaborationUsers.length}명`}>
          {collaborationUsers.slice(0, 5).map((user) => <i key={user.clientId} title={user.name} style={{ backgroundColor: user.color }}>{user.name.slice(0, 1)}</i>)}
          {collaborationUsers.length > 5 && <b>+{collaborationUsers.length - 5}</b>}
        </div>
      </div>}
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
        <ToolbarButton label="표 삽입" onClick={() => onRequestInsertTable ? onRequestInsertTable() : setTableDialogOpen(true)}>표 +</ToolbarButton>
        <ToolbarButton label="표 행 추가" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().addRowAfter().run()}>행 +</ToolbarButton>
        <ToolbarButton label="표 열 추가" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().addColumnAfter().run()}>열 +</ToolbarButton>
        <ToolbarButton label="표 행 삭제" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteRow().run()}>행 −</ToolbarButton>
        <ToolbarButton label="표 열 삭제" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteColumn().run()}>열 −</ToolbarButton>
        <ToolbarButton label="표 삭제" disabled={!editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteTable().run()}>표 삭제</ToolbarButton>
      </div>
      <div>
        <ToolbarButton label="링크" active={editor?.isActive('link')} onClick={addLink}>링크</ToolbarButton>
        <ToolbarButton label="이미지" onClick={addImage}>이미지</ToolbarButton>
        <ToolbarButton label="선택 이미지 위로 이동" disabled={!imageSelected} onClick={() => {
          if (!editor || !(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') return;
          const parent = editor.state.selection.$from.parent; const index = editor.state.selection.$from.index(); if (index < 1) return;
          const previous = parent.child(index - 1); const image = editor.state.selection.node; const from = editor.state.selection.from; const nextPosition = from - previous.nodeSize;
          const transaction = editor.state.tr.delete(from, from + image.nodeSize).insert(nextPosition, image); transaction.setSelection(NodeSelection.create(transaction.doc, nextPosition)); editor.view.dispatch(transaction.scrollIntoView());
        }}>이미지 ↑</ToolbarButton>
        <ToolbarButton label="선택 이미지 아래로 이동" disabled={!imageSelected} onClick={() => {
          if (!editor || !(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') return;
          const parent = editor.state.selection.$from.parent; const index = editor.state.selection.$from.index(); if (index >= parent.childCount - 1) return;
          const next = parent.child(index + 1); const image = editor.state.selection.node; const from = editor.state.selection.from; const nextPosition = from + next.nodeSize;
          const transaction = editor.state.tr.delete(from, from + image.nodeSize).insert(nextPosition, image); transaction.setSelection(NodeSelection.create(transaction.doc, nextPosition)); editor.view.dispatch(transaction.scrollIntoView());
        }}>이미지 ↓</ToolbarButton>
        <ToolbarButton label="선택 이미지 삭제" disabled={!imageSelected} onClick={deleteSelectedImageNode}>이미지 삭제</ToolbarButton>
        <ToolbarButton label="구분선" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>구분선</ToolbarButton>
        <ToolbarButton label="서식 지우기" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}>서식 지우기</ToolbarButton>
      </div>
    </div>}
    {showSearch && <div className="structured-editor__search" role="search"><label>찾기<input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); findNext(); } }} /></label><label>바꾸기<input value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label><button type="button" onClick={findNext}>다음 찾기</button>{!readOnly && <><button type="button" onClick={replaceCurrent}>현재 바꾸기</button><button type="button" className="is-primary" onClick={replaceAll}>모두 바꾸기</button></>}<span role="status">{searchStatus}</span></div>}
    <div className="structured-editor__canvas">
      {preview ? <article className="structured-editor__preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(editor?.getHTML() ?? '') }} /> : <>
        {selectionAssistant && editor && <BubbleMenu
          editor={editor}
          pluginKey={`structured-selection-assistant-${documentKey ?? label}`}
          updateDelay={80}
          shouldShow={({ editor: activeEditor, from, to }) => !readOnly && !selectionAssistant.disabled && !selectionAssistant.busy && activeEditor.isEditable && activeEditor.isFocused && from !== to && Boolean(activeEditor.state.doc.textBetween(from, to, '\n').trim())}
          className="structured-editor__selection-menu"
          role="toolbar"
          aria-label="선택 문장 빠른 작업"
        >
          <button type="button" className="is-copy" onMouseDown={(event) => event.preventDefault()} onClick={() => void copySelectedText()} aria-label="선택 문장 복사">{copyStatus || '복사'}</button>
          <span aria-hidden="true" />
          <button type="button" className="is-ai" disabled={selectionAssistant.disabled || selectionAssistant.busy || !activeSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => runSelectionImprovement('professional')}>✦ 전문적으로</button>
          <button type="button" className="is-ai" disabled={selectionAssistant.disabled || selectionAssistant.busy || !activeSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => runSelectionImprovement('concise')}>✦ 간결하게</button>
          <button type="button" className="is-ai is-primary" disabled={selectionAssistant.disabled || selectionAssistant.busy || !activeSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => runSelectionImprovement('custom')}>{selectionAssistant.busy ? '개선 중…' : '✦ Gemini 개선'}</button>
        </BubbleMenu>}
        <EditorContent editor={editor} />
      </>}
    </div>
    <footer>{collaborationError && <span className="structured-editor__collaboration-error">{collaborationError}</span>}<span>{wordCount.toLocaleString('ko-KR')}단어</span><span>{(characterCount ?? 0).toLocaleString('ko-KR')}자</span><span>{collaborationSession ? 'Yjs + Hocuspocus CRDT' : 'Markdown + Tiptap JSON 호환'}</span></footer>
    </section>
  </>;
});

const CollaborativeDocumentEditor = forwardRef<StructuredDocumentEditorHandle, StructuredDocumentEditorProps>(function CollaborativeDocumentEditor(props, ref) {
  const [session, setSession] = useState<CollaborationSession | null>(null);
  const [status, setStatus] = useState(WebSocketStatus.Connecting);
  const [synced, setSynced] = useState(false);
  const [users, setUsers] = useState<Array<{ clientId: number; name: string; color: string }>>([]);
  const [error, setError] = useState('');
  const runtime = globalThis as typeof globalThis & {
    __CLAIM_CENTER_COLLABORATION_URL__?: string;
    __CLAIM_CENTER_COLLABORATION_TOKEN_ENDPOINT__?: string;
  };
  const url = runtime.__CLAIM_CENTER_COLLABORATION_URL__?.trim() ?? '';
  const tokenEndpoint = runtime.__CLAIM_CENTER_COLLABORATION_TOKEN_ENDPOINT__?.trim() || '/api/collaboration/token';
  const collaboration = props.collaboration!;

  useEffect(() => {
    const document = new Y.Doc();
    const user = {
      name: collaboration.userName.trim() || collaboration.userEmail?.split('@')[0] || '협업 사용자',
      color: collaborationColor(collaboration.userEmail || collaboration.userName || collaboration.documentId),
      ...(collaboration.userEmail ? { email: collaboration.userEmail } : {})
    };
    let active = true;
    const provider = new HocuspocusProvider({
      url,
      name: collaboration.documentId,
      document,
      sessionAwareness: true,
      flushDelay: 250,
      token: async () => {
        const response = await fetch(tokenEndpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentName: collaboration.documentId })
        });
        if (!response.ok) throw new Error(`협업 인증 토큰 발급 실패 (HTTP ${response.status})`);
        const payload = await response.json() as { token?: unknown };
        if (typeof payload.token !== 'string' || !payload.token) throw new Error('협업 인증 토큰이 없습니다.');
        return payload.token;
      },
      onStatus: ({ status: next }) => { if (active) setStatus(next); },
      onSynced: ({ state }) => { if (active) setSynced(state); },
      onAwarenessUpdate: ({ states }) => { if (active) setUsers(normalizeCollaborationUsers(states)); },
      onAuthenticationFailed: ({ reason }) => { if (active) setError(`실시간 협업 인증 실패: ${reason}`); },
      onAuthenticated: () => { if (active) setError(''); }
    });
    provider.setAwarenessField('user', user);
    setSession({ document, provider, user });
    return () => {
      active = false;
      provider.destroy();
      document.destroy();
    };
  }, [collaboration.documentId, collaboration.userEmail, collaboration.userName, tokenEndpoint, url]);

  if (!session) return <section className="structured-editor structured-editor--collaboration-loading" aria-label={props.label}><strong>실시간 공동 편집기를 준비하고 있습니다…</strong></section>;
  return <StructuredDocumentEditorCore {...props} ref={ref} collaborationSession={session} collaborationStatus={status} collaborationSynced={synced} collaborationUsers={users} collaborationError={error} />;
});

export const StructuredDocumentEditor = forwardRef<StructuredDocumentEditorHandle, StructuredDocumentEditorProps>(function StructuredDocumentEditor(props, ref) {
  const runtime = globalThis as typeof globalThis & {
    __CLAIM_CENTER_COLLABORATION_URL__?: string;
    __CLAIM_CENTER_SESSION_USER__?: { id: string; name: string; email: string; organizationId: string; roles: string[] };
  };
  const collaborationUrl = runtime.__CLAIM_CENTER_COLLABORATION_URL__?.trim();
  const implicitDocumentKey = props.documentKey?.replace(/^report-step(?:3|4)-/u, 'report-');
  const collaboration = props.collaboration ?? (props.documentKey ? {
    documentId: `claim-center:${runtime.__CLAIM_CENTER_SESSION_USER__?.organizationId ?? 'unknown'}:${implicitDocumentKey}`,
    userName: runtime.__CLAIM_CENTER_SESSION_USER__?.name ?? '로그인 사용자',
    userEmail: runtime.__CLAIM_CENTER_SESSION_USER__?.email
  } : undefined);
  if (collaboration && collaborationUrl) return <CollaborativeDocumentEditor {...props} collaboration={collaboration} ref={ref} />;
  return <StructuredDocumentEditorCore {...props} ref={ref} />;
});
