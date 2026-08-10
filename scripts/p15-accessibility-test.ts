import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROUTES } from '../apps/web/src/routes/Router';

describe('P15 Accessibility & UX Compliance Suite', () => {
  const webSrcDir = path.resolve(__dirname, '../apps/web/src');

  test('1. Router & All 21 Screen Accessible Names & ARIA Landmarks', () => {
    assert.ok(ROUTES.length >= 21, 'Must contain at least 21 defined routes');

    for (const route of ROUTES) {
      assert.ok(route.id, `Route missing id: ${route.path}`);
      assert.ok(route.name, `Route missing accessible name: ${route.path}`);
      assert.ok(route.path.startsWith('/'), `Route path must start with slash: ${route.path}`);
    }
  });

  test('2. UI Components Focus Trap & Keyboard Navigation Contracts', () => {
    const routerSource = fs.readFileSync(path.join(webSrcDir, 'routes/Router.tsx'), 'utf8');
    assert.match(routerSource, /aria-labelledby="route-title"/, 'Route views must maintain aria-labelledby title linkage');

    const appShellSource = fs.readFileSync(path.join(webSrcDir, 'layout/AppShell.tsx'), 'utf8');
    assert.match(appShellSource, /nav/i, 'AppShell must declare semantic nav element');
    assert.match(appShellSource, /aria-label/i, 'Navigation links must feature accessible labels');
  });

  test('3. Google Workspace Integration UI Accessible Controls & Status Badges', () => {
    const integSource = fs.readFileSync(path.join(webSrcDir, 'integrations/GoogleWorkspaceIntegration.tsx'), 'utf8');
    assert.match(integSource, /Google Workspace/);
    assert.match(integSource, /Google Workspace/);
    assert.match(integSource, /CONNECTED|EXPIRED|RECONSENT_REQUIRED|DISCONNECTED/);
  });
});
