import type { ReactElement } from 'react';

export interface DocumentToolAction {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface DocumentToolGroup {
  id: 'excel' | 'docx' | 'hwp';
  label: string;
  actions: readonly DocumentToolAction[];
}

function DocumentIcon({ kind }: { kind: DocumentToolGroup['id'] }): ReactElement {
  const label = kind === 'excel' ? 'X' : kind === 'docx' ? 'W' : '한';
  return <span className={`document-tool-icon is-${kind}`} aria-hidden="true"><i />{label}</span>;
}

export function DocumentToolMenus({ groups }: { groups: readonly DocumentToolGroup[] }): ReactElement {
  return <div className="document-tool-menus" aria-label="문서 가져오기와 내보내기">
    {groups.map((group) => <details key={group.id} className={`document-tool-menu is-${group.id}`}>
      <summary aria-label={`${group.label} 문서 도구 열기`}>
        <DocumentIcon kind={group.id} />
        <span>{group.label}</span>
        <b aria-hidden="true">⌄</b>
      </summary>
      <div className="document-tool-menu__panel">
        {group.actions.map((action) => <button key={action.id} type="button" disabled={action.disabled} onClick={() => {
          action.onClick();
          const active = document.activeElement?.closest('details');
          if (active instanceof HTMLDetailsElement) active.open = false;
        }}>{action.label}</button>)}
      </div>
    </details>)}
  </div>;
}
