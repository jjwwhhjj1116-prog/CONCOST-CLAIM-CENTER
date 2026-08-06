import React from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
}

export function Table<T>({ columns, data, keyField }: TableProps<T>) {
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', color: '#f8fafc', fontSize: '14px' }}>
        <thead>
          <tr style={{ background: '#0f172a', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            {columns.map((col) => (
              <th key={col.key} style={{ padding: '12px', textAlign: 'left', color: '#94a3b8' }}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={String(row[keyField])} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              {columns.map((col) => (
                <td key={col.key} style={{ padding: '12px' }}>
                  {col.render ? col.render(row) : String((row as any)[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
