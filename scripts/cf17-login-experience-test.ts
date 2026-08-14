import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('apps/web/src/App.tsx', 'utf8');
const css = readFileSync('apps/web/src/preview-theme.css', 'utf8');

test('CF17 login preserves real member authentication in an accessible split-screen experience', () => {
  assert.match(app, /apiRequest\('\/auth\/login'/u);
  assert.match(app, /name="username"[\s\S]*autoComplete="username"/u);
  assert.match(app, /name="password"[\s\S]*autoComplete="current-password"/u);
  assert.match(app, /aria-label=\{showPassword \? '비밀번호 숨기기' : '비밀번호 보기'\}/u);
  assert.match(app, /disabled=\{isLoggingIn \|\| !loginId\.trim\(\) \|\| !password\}/u);
  assert.match(app, /Organization & role protected/u);
  assert.match(app, /복잡한 클레임을/u);
  assert.doesNotMatch(app, /<Card title="클레임센터 스튜디오">/u);
});

test('CF17 login uses a project-owned claim investigation hero and responsive desktop/mobile layouts', () => {
  const hero = statSync('apps/web/public/assets/claim-login-hero.png');
  assert.ok(hero.size > 100_000 && hero.size < 5_000_000);
  assert.match(css, /grid-template-columns: minmax\(0, 1\.07fr\) minmax\(500px, \.93fr\)/u);
  assert.match(css, /url\('\/assets\/claim-login-hero\.png'\)/u);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*grid-template-columns: 1fr/u);
  assert.match(css, /@media \(max-width: 560px\)/u);
  assert.match(css, /:focus-within/u);
  assert.match(css, /:focus-visible/u);
});
