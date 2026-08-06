import React from 'react';

export interface TimelineItem {
  id: string;
  title: string;
  timestamp: string;
  description?: string;
}

export interface TimelineProps {
  items: TimelineItem[];
}

export const Timeline: React.FC<TimelineProps> = ({ items }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderLeft: '2px solid rgba(255,255,255,0.1)', paddingLeft: '16px' }}>
      {items.map((item) => (
        <div key={item.id} style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: '-21px', top: '4px', width: '8px', height: '8px', borderRadius: '50%', background: 'hsl(217, 91%, 60%)' }} />
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>{item.timestamp}</div>
          <div style={{ fontWeight: 'bold', color: '#f8fafc' }}>{item.title}</div>
          {item.description && <div style={{ fontSize: '14px', color: '#cbd5e1', marginTop: '4px' }}>{item.description}</div>}
        </div>
      ))}
    </div>
  );
};
