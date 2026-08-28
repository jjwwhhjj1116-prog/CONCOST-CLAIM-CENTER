import React from 'react';

export type FileFormat = 'docx' | 'pdf' | 'hwp';

const formatLabel: Record<FileFormat, string> = {
  docx: 'W',
  pdf: 'PDF',
  hwp: '한',
};

export function FileFormatIcon({ format }: { format: FileFormat }): React.ReactElement {
  return <svg
    aria-hidden="true"
    className={`file-format-icon is-${format}`}
    focusable="false"
    viewBox="0 0 28 32"
  >
    <path className="file-format-icon__sheet" d="M4 1.5h13.7L24 7.8v22.7H4z" />
    <path className="file-format-icon__fold" d="M17.7 1.5v6.3H24" />
    <rect className="file-format-icon__label" x="1.5" y="13" width="25" height="12" rx="2.5" />
    <text className="file-format-icon__text" x="14" y="21.4" textAnchor="middle">{formatLabel[format]}</text>
  </svg>;
}
