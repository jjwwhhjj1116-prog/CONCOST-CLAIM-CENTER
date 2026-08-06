import React, { useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DDay } from '../components/DDay';
import { Dialog } from '../components/Dialog';
import { Drawer } from '../components/Drawer';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { StateView } from '../components/StateView';
import { StatusBadge } from '../components/StatusBadge';
import { Table } from '../components/Table';
import { Timeline } from '../components/Timeline';

const claimTypeOptions = [
  { value: 'TYPE-01', label: 'TYPE-01: 현장조사 및 수량산출 클레임' },
  { value: 'TYPE-02', label: 'TYPE-02: 분석 보고서 작성 클레임' },
  { value: 'TYPE-03', label: 'TYPE-03: 일반적인 클레임' },
  { value: 'TYPE-04', label: 'TYPE-04: 재건축·재개발 공사비 협상' },
  { value: 'TYPE-05', label: 'TYPE-05: 사감정보고서 (TEMPLATE_NOT_FOUND)' },
  { value: 'TYPE-06', label: 'TYPE-06: 물가변동' }
];

type CatalogRow = { id: string; name: string; status: string };
const catalogRows: CatalogRow[] = [
  { id: 'SYN-001', name: '합성 예시 사건 — 매우 긴 제목의 말줄임·가로 스크롤 검증 데이터', status: '검토중' },
  { id: 'SYN-002', name: '합성 예시 사건 2', status: '승인' }
];

export const ComponentCatalog: React.FC = () => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <section className="route-view" aria-labelledby="catalog-title">
      <h2 id="catalog-title">공통 UI 컴포넌트 카탈로그</h2>
      <p className="muted">실제 고객정보가 아닌 synthetic fixture만 사용합니다.</p>
      <div className="content-stack">
        <Card title="버튼·입력·선택·Dialog/Drawer">
          <div className="action-row">
            <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="danger">Danger</Button><Button variant="ghost">Ghost</Button><Button isLoading>Loading</Button>
            <Button onClick={() => setIsDialogOpen(true)}>Dialog 열기</Button><Button onClick={() => setIsDrawerOpen(true)}>Drawer 열기</Button>
          </div>
          <div className="form-stack" style={{ marginTop: 16 }}>
            <Input label="사건명" placeholder="합성 사건명을 입력하세요" />
            <Select label="6대 고정 클레임 유형" options={claimTypeOptions} />
          </div>
          <Dialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} title="확인 대화상자">키보드 Escape로 닫을 수 있습니다.</Dialog>
          <Drawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} title="목차 드로어"><Button onClick={() => setIsDrawerOpen(false)}>목차 선택</Button></Drawer>
        </Card>

        <Card title="Table·StatusBadge·D-day·Timeline">
          <div className="action-row"><StatusBadge status="approved" /><StatusBadge status="ai_draft" /><StatusBadge status="review" /><DDay targetDate="2099-12-31" daysRemaining={3} /></div>
          <Table<CatalogRow> keyField="id" data={catalogRows} columns={[{ key: 'name', header: '사건명' }, { key: 'status', header: '상태' }]} />
          <Timeline items={[{ id: '1', title: '합성 사건 생성', timestamp: '2099-01-01', description: '개인정보가 없는 카탈로그 예시' }]} />
        </Card>

        <Card title="정상·로딩·빈 상태·오류·403·긴 텍스트">
          <div className="content-stack">
            <StateView state="normal"><p>Normal: 정상 콘텐츠</p></StateView>
            <StateView state="loading"><span /></StateView>
            <StateView state="empty"><span /></StateView>
            <StateView state="error"><span /></StateView>
            <StateView state="forbidden"><span /></StateView>
            <p className="text-ellipsis" title="긴 콘텐츠 전체 문구">긴 콘텐츠 오버플로우 예시 — 보고서 제목이 매우 길어도 핵심 행동과 레이아웃을 밀어내지 않습니다.</p>
          </div>
        </Card>
      </div>
    </section>
  );
};
