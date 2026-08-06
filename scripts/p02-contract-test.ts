import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '..');
const SCREEN_IDS = [
  'AUTH-01', 'DASH-01', 'CASE-01', 'CASE-02', 'CASE-03', 'CASE-04', 'CASE-05', 'CASE-06',
  'MEET-01', 'PROP-01', 'PROP-02', 'REPO-01', 'REPO-02', 'APPR-01', 'FEE-01', 'TPL-01',
  'AI-01', 'USER-01', 'AUD-01', 'RESP-01'
] as const;
const CLAIM_TYPE_IDS = ['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06'];
const TEMPLATE_FOLDER_NAMES = [
  '01. 감정보완 신청서', '02. 항소에 대한 의견 보고서', '03. 설계변경+물가변동+간접비',
  '04. 하자검토 보고서', '05. 설계변경+물가변동', '06. 공사비 적정성 검토 보고서',
  '07. 하자조사 보고서', '08. 돌관공사비', '09. 기시공+미시공'
];

type P02Snapshot = {
  artifactIds: string[];
  pageSpecIds: string[];
  screens: Record<string, string>;
  pageSpecs: Record<string, string>;
  masterPrompt: string;
  componentMap: string;
  accessibilityNotes: string;
  designTokens: string;
};

function readSnapshot(): P02Snapshot {
  const artifactsDir = path.join(ROOT, 'docs/stitch/artifacts');
  const pageSpecsDir = path.join(ROOT, 'docs/stitch/page-specs');
  const artifactIds = fs.readdirSync(artifactsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const pageSpecIds = fs.readdirSync(pageSpecsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name.slice(0, -3))
    .sort();
  const screens: Record<string, string> = {};
  const pageSpecs: Record<string, string> = {};
  for (const screenId of artifactIds) {
    const screenPath = path.join(artifactsDir, screenId, 'screen.html');
    if (fs.existsSync(screenPath)) screens[screenId] = fs.readFileSync(screenPath, 'utf8');
  }
  for (const screenId of pageSpecIds) {
    pageSpecs[screenId] = fs.readFileSync(path.join(pageSpecsDir, `${screenId}.md`), 'utf8');
  }
  return {
    artifactIds,
    pageSpecIds,
    screens,
    pageSpecs,
    masterPrompt: fs.readFileSync(path.join(ROOT, 'docs/stitch/stitch-master-prompt.md'), 'utf8'),
    componentMap: fs.readFileSync(path.join(ROOT, 'docs/stitch/component-map.md'), 'utf8'),
    accessibilityNotes: fs.readFileSync(path.join(ROOT, 'docs/stitch/accessibility-notes.md'), 'utf8'),
    designTokens: fs.readFileSync(path.join(ROOT, 'docs/stitch/design-tokens.json'), 'utf8')
  };
}

function cloneSnapshot(snapshot: P02Snapshot): P02Snapshot {
  return {
    artifactIds: [...snapshot.artifactIds],
    pageSpecIds: [...snapshot.pageSpecIds],
    screens: { ...snapshot.screens },
    pageSpecs: { ...snapshot.pageSpecs },
    masterPrompt: snapshot.masterPrompt,
    componentMap: snapshot.componentMap,
    accessibilityNotes: snapshot.accessibilityNotes,
    designTokens: snapshot.designTokens
  };
}

function assertScreenContract(screenId: string, html: string, pageSpec: string): void {
  assert.ok(html.length > 1200, `${screenId}: substantive HTML prototype required`);
  assert.match(html, /<html\s+lang=["']ko["']/, `${screenId}: lang=ko missing`);
  assert.match(html, /<meta\s+charset=["']UTF-8["']/, `${screenId}: UTF-8 metadata missing`);
  assert.ok(!html.includes('\uFFFD'), `${screenId}: invalid replacement character found`);
  assert.match(html, new RegExp(`<title>[^<]*${screenId.replace('-', '\\-')}[^<]*<\\/title>`), `${screenId}: title identity missing`);

  const stitchId = `screen_${screenId.toLowerCase().replace('-', '_')}`;
  assert.match(html, new RegExp(`<meta\\s+name=["']stitch-provenance["'][^>]+${stitchId}`), `${screenId}: Stitch provenance missing`);
  assert.ok(pageSpec.includes(`Stitch Screen ID**: \`${stitchId}\``), `${screenId}: page-spec Stitch ID mismatch`);
  assert.ok(pageSpec.includes(`docs/stitch/artifacts/${screenId}/screen.html`), `${screenId}: page-spec artifact path mismatch`);
  assert.match(pageSpec, /1440px/, `${screenId}: 1440px layout contract missing`);
  assert.match(pageSpec, /1024px/, `${screenId}: 1024px layout contract missing`);
  for (const phrase of ['로딩 상태', '빈 상태', '오류 상태', '403 권한 없음', '긴 콘텐츠 오버플로우', '접근성']) {
    assert.ok(pageSpec.includes(phrase), `${screenId}: page-spec state missing: ${phrase}`);
  }

  assert.match(html, /@media\s*\(max-width:\s*1024px\)/, `${screenId}: 1024px media query missing`);
  assert.match(html, /:(?:focus|focus-visible)\s*(?:,|\{)/, `${screenId}: keyboard focus CSS missing`);
  assert.match(html, /outline:\s*2px\s+solid/, `${screenId}: visible focus outline missing`);
  assert.match(html, /\.text-ellipsis\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s, `${screenId}: ellipsis CSS contract missing`);
  assert.match(html, /\saria-[a-z-]+=["'][^"']+["']/, `${screenId}: accessible name/state attribute missing`);
  assert.match(html, /<button\b[^>]*>[^<]*\S[^<]*<\/button>|<button\b[^>]*aria-label=["'][^"']+["'][^>]*>/s, `${screenId}: named control missing`);
  assert.match(html, /aria-live=["']polite["']/, `${screenId}: loading announcement missing`);

  assert.match(html, /class=["'][^"']*state-controls[^"']*["']/, `${screenId}: state controls missing`);
  assert.match(html, /function\s+setUIState\s*\(state\)/, `${screenId}: state switcher function missing`);
  const states = ['normal', 'loading', 'empty', 'error', 'forbidden'];
  for (const state of states) {
    assert.ok(html.includes(`setUIState('${state}')`), `${screenId}: ${state} control missing`);
    assert.ok(html.includes(`state === '${state}'`), `${screenId}: ${state} transition missing`);
  }
  for (const stateId of ['loadingState', 'emptyState', 'errorState', 'forbiddenState']) {
    assert.match(html, new RegExp(`id=["']${stateId}["']`), `${screenId}: visual state node missing: ${stateId}`);
    assert.ok(html.includes(`getElementById('${stateId}')`), `${screenId}: state node is not controlled: ${stateId}`);
  }
  assert.match(html, /403|권한 없음/, `${screenId}: forbidden state needs non-color text`);
  assert.match(html, /오류|에러|Error|error/, `${screenId}: error state needs non-color text`);
}

function validateP02(snapshot: P02Snapshot): void {
  const expectedIds = [...SCREEN_IDS].sort();
  assert.deepStrictEqual(snapshot.artifactIds, expectedIds, 'Exactly the 20 approved artifact directories are required');
  assert.deepStrictEqual(snapshot.pageSpecIds, expectedIds, 'Exactly the 20 approved page-spec files are required');

  const promptTypeIds = [...new Set(snapshot.masterPrompt.match(/TYPE-\d{2}/g) ?? [])].sort();
  assert.deepStrictEqual(promptTypeIds, CLAIM_TYPE_IDS, 'Master prompt must use exactly TYPE-01 through TYPE-06');
  assert.match(snapshot.masterPrompt, /9개[^\n]*업무 유형이 아니라[^\n]*(?:레퍼런스|참조)/, 'Nine template folders must be declared as references, not claim types');
  for (const folderName of TEMPLATE_FOLDER_NAMES) {
    const escaped = folderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(snapshot.masterPrompt, new RegExp(`업무\\s*유형\\s*:[^\\n]*${escaped}`), `Template folder misclassified as a claim type: ${folderName}`);
  }

  const tokens = JSON.parse(snapshot.designTokens) as Record<string, unknown>;
  assert.ok(tokens.color && tokens.typography && tokens.spacing && tokens.borderRadius, 'Design token families are incomplete');
  assert.match(snapshot.componentMap, /COMP-CARD-KPI[^\n]*6대 질문/, 'Component map must follow the six-question dashboard contract');
  assert.doesNotMatch(snapshot.componentMap, /COMP-CARD-KPI[^\n]*7대 질문/, 'Seven-question dashboard drift is forbidden');
  for (const requirement of ['4.5:1', '키보드', 'aria-label', '빈 상태', '오류 상태', '403', '긴 콘텐츠']) {
    assert.ok(snapshot.accessibilityNotes.includes(requirement), `Accessibility contract missing: ${requirement}`);
  }

  for (const screenId of SCREEN_IDS) {
    assertScreenContract(screenId, snapshot.screens[screenId], snapshot.pageSpecs[screenId]);
  }

  const dashHtml = snapshot.screens['DASH-01'];
  const dashboardQuestions = [
    '진행 중인 사건 총 개수', '오늘/곧 마감되는 일', '내가 오늘 해야 할 일',
    '작성·검토·승인 진행 문서', '기한 지연 업무', '미수 성공보수 총액'
  ];
  for (const question of dashboardQuestions) assert.ok(dashHtml.includes(question), `DASH-01 question missing: ${question}`);
  for (const action of ['새 사건 등록', '제안서 작성', '보고서 작성', '자료 업로드']) {
    assert.match(dashHtml, new RegExp(`<button[^>]*>\\[${action}\\]<\\/button>`), `DASH-01 quick action is not an actual button: ${action}`);
  }

  const repoHtml = snapshot.screens['REPO-02'];
  assert.match(repoHtml, /<aside\s+class=["']sidebar["'][^>]*aria-label=["'][^"']+목차[^"']*["']/, 'REPO-02 left TOC pane missing');
  assert.match(repoHtml, /<main\s+class=["']editor-main["'][^>]*role=["']main["']/, 'REPO-02 center editor pane missing');
  assert.match(repoHtml, /<aside\s+id=["']aiPanel["']\s+class=["']ai-panel["'][^>]*aria-label=/, 'REPO-02 right evidence/AI pane missing');
  for (const stateId of ['editorLoading', 'editorEmpty', 'editorError']) {
    assert.match(repoHtml, new RegExp(`id=["']${stateId}["']`), `REPO-02 center state missing: ${stateId}`);
  }
  assert.match(repoHtml, /id=["']drawerToggleBtn["'][^>]*aria-expanded=["']false["']/, 'REPO-02 drawer recovery button missing');
  assert.match(repoHtml, /id=["']closeDrawerBtn["'][^>]*aria-label=["'][^"']+["']/, 'REPO-02 drawer close button needs an accessible name');
  assert.match(repoHtml, /drawerToggleBtn\.addEventListener\(["']click["']/, 'REPO-02 drawer open event missing');
  assert.match(repoHtml, /closeDrawerBtn\.addEventListener\(["']click["']/, 'REPO-02 drawer close event missing');
  assert.match(repoHtml, /setAttribute\(["']aria-expanded["']/, 'REPO-02 aria-expanded synchronization missing');
  assert.match(repoHtml, /aiPanel\.style\.display\s*=\s*\(state === 'forbidden'\)/, 'REPO-02 AI panel must expose loading/empty/error states');
  assert.match(repoHtml, /id=["']forbiddenState["'][^>]*role=["']dialog["'][^>]*aria-modal=["']true["']/, 'REPO-02 403 modal semantics missing');
}

const baseline = readSnapshot();

test('P02 complete semantic contract', () => validateP02(baseline));

test('P02 adversarial: missing screen is rejected', () => {
  const changed = cloneSnapshot(baseline);
  changed.artifactIds = changed.artifactIds.filter(id => id !== 'AI-01');
  delete changed.screens['AI-01'];
  assert.throws(() => validateP02(changed), /Exactly the 20 approved artifact directories/);
});

test('P02 adversarial: TYPE-07 is rejected', () => {
  const changed = cloneSnapshot(baseline);
  changed.masterPrompt += '\n- `TYPE-07`: unauthorized type\n';
  assert.throws(() => validateP02(changed), /exactly TYPE-01 through TYPE-06/);
});

test('P02 adversarial: template folder promoted to type is rejected', () => {
  const changed = cloneSnapshot(baseline);
  changed.masterPrompt += '\n- 업무 유형: 01. 감정보완 신청서\n';
  assert.throws(() => validateP02(changed), /Template folder misclassified as a claim type/);
});

test('P02 adversarial: missing REPO-02 pane is rejected', () => {
  const changed = cloneSnapshot(baseline);
  changed.screens['REPO-02'] = changed.screens['REPO-02'].replace('<aside class="sidebar"', '<section class="removed-sidebar"');
  assert.throws(() => validateP02(changed), /left TOC pane missing/);
});

test('P02 adversarial: missing 1024px drawer event is rejected', () => {
  const changed = cloneSnapshot(baseline);
  changed.screens['REPO-02'] = changed.screens['REPO-02'].replace('drawerToggleBtn.addEventListener', 'drawerToggleBtn.removedEventListener');
  assert.throws(() => validateP02(changed), /drawer open event missing/);
});

test('P02 adversarial: missing forbidden transition is rejected', () => {
  const changed = cloneSnapshot(baseline);
  changed.screens['AI-01'] = changed.screens['AI-01'].replaceAll("state === 'forbidden'", "state === 'removed'");
  assert.throws(() => validateP02(changed), /forbidden transition missing/);
});

test('P02 adversarial: missing keyboard focus rule is rejected', () => {
  const changed = cloneSnapshot(baseline);
  changed.screens['AI-01'] = changed.screens['AI-01'].replace(/:focus/g, ':removed-focus');
  assert.throws(() => validateP02(changed), /keyboard focus CSS missing/);
});
