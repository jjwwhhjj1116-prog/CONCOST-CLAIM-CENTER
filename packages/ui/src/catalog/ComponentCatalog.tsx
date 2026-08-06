import React, { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Drawer } from '../components/Drawer';
import { StatusBadge } from '../components/StatusBadge';
import { Card } from '../components/Card';
import { Table } from '../components/Table';
import { DDay } from '../components/DDay';
import { Timeline } from '../components/Timeline';
import { StateView } from '../components/StateView';

export const ComponentCatalog: React.FC = () => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const claimTypeOptions = [
    { value: 'TYPE-01', label: 'TYPE-01: 현장조사 및 수량산출 클레임' },
    { value: 'TYPE-02', label: 'TYPE-02: 분석 보고서 작성 클레임' },
    { value: 'TYPE-03', label: 'TYPE-03: 일반적인 클레임' },
    { value: 'TYPE-04', label: 'TYPE-04: 재건축·재개발 공사비 협상' },
    { value: 'TYPE-05', label: 'TYPE-05: 사감정보고서 (TEMPLATE_NOT_FOUND)' },
    { value: 'TYPE-06', label: 'TYPE-06: 물가변동' }
  ];

  return (
    <div style={{ padding: '24px', background: '#0f172a', color: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>
      <h2>🎨 Claim Studio Design System Component Catalog</h2>

      <section style={{ marginBottom: '32px' }}>
        <h3>1. Buttons</h3>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="ghost">Ghost</Button>
          <Button isLoading variant="primary">Loading</Button>
        </div>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h3>2. Inputs & 6 Claim Type Select</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
          <Input label="사건명" placeholder="사건명을 입력하세요..." />
          <Select label="6대 고정 클레임 유형 (TYPE-01 ~ TYPE-06)" options={claimTypeOptions} />
        </div>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h3>3. Status Badges</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <StatusBadge status="approved" />
          <StatusBadge status="ai_draft" />
          <StatusBadge status="review" />
          <StatusBadge status="request_changes" />
          <StatusBadge status="unwritten" />
        </div>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h3>4. Drawer Component (1024px Responsive)</h3>
        <Button onClick={() => setIsDrawerOpen(true)}>Open Drawer</Button>
        <Drawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} title="목차 드로어">
          <div>드로어 내부 7대 정규 장 목차</div>
        </Drawer>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h3>5. 5 Standard UI States (Normal, Loading, Empty, Error, Forbidden)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          <Card title="Loading State"><StateView state="loading"><div>Normal Content</div></StateView></Card>
          <Card title="Empty State"><StateView state="empty"><div>Normal Content</div></StateView></Card>
          <Card title="Error State"><StateView state="error" onRetry={() => alert('Retry')}><div>Normal Content</div></StateView></Card>
          <Card title="Forbidden 403 State"><StateView state="forbidden"><div>Normal Content</div></StateView></Card>
        </div>
      </section>
    </div>
  );
};
