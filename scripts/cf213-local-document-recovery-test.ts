import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium, type Page } from 'playwright-core';

test('CF213 actual IndexedDB recovery preserves exact local snapshots, account scope and acknowledgement races', { timeout: 120_000 }, async t => {
  const base = resolve(process.env.CF213_OUTPUT_ROOT || 'tmp');
  mkdirSync(base, { recursive: true });
  const proof = mkdtempSync(join(base, 'cf213-recovery-'));
  const { createServer } = await import('../apps/web/qa/vite-server.js');
  const server = await createServer({ root: resolve('apps/web'), cacheDir: join(proof, 'cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
  await server.listen();
  const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as { port: number }).port;
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  let context = await chromium.launchPersistentContext(join(proof, 'profile'), { executablePath, headless: true });
  const initialize = async (page: Page) => {
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/cf213.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>CF213 synthetic local recovery</body></html>' });
      return route.continue();
    });
    await page.goto(origin + '/cf213.html');
    await page.evaluate('globalThis.__name = value => value');
    await page.evaluate(async () => {
      const module = await import('/src/documents/local-document-recovery.ts' as string);
      (globalThis as any).recoveryModule = module;
      (globalThis as any).recovery = module.createLocalDocumentRecovery({ accountId: 'synthetic-account-a', workspaceId: 'report-case-1' });
    });
  };
  try {
    const page = await context.newPage(); await initialize(page);
    let firstId = '';
    await t.test('structured JSON, content, navigation and cursor are cloned at invocation and committed exactly', async () => {
      const result = await page.evaluate(async () => {
        const payload = { content: '합성 보고서\n원문 123,456원', editorJson: { type: 'doc', content: [{ type: 'image', attrs: { src: '/synthetic-photo', width: 260, height: 180 } }] }, chapterId: 'CH-01', view: 'chapter', step: 4, cursor: { block: 2, offset: 3 }, baseVersion: 7 };
        const expected = structuredClone(payload), client = (globalThis as any).recovery;
        const pending = client.write(payload); payload.content = 'caller mutated after write';
        const written = await pending, read = await client.read(written.snapshotId);
        return { expected, read, listed: await client.list() };
      });
      assert.deepEqual(result.read.payload, result.expected); assert.equal(result.listed.length, 1); assert.equal('payload' in result.listed[0], false);
      firstId = result.read.snapshotId;
    });
    await t.test('another account and another workspace cannot enumerate, read or acknowledge this snapshot', async () => {
      const results = await page.evaluate(async id => {
        const module = (globalThis as any).recoveryModule;
        const clients = [module.createLocalDocumentRecovery({ accountId: 'synthetic-account-b', workspaceId: 'report-case-1' }), module.createLocalDocumentRecovery({ accountId: 'synthetic-account-a', workspaceId: 'proposal-case-2' })];
        return Promise.all(clients.map(async c => ({ list: await c.list(), read: await c.read(id), ack: await c.acknowledge(id) })));
      }, firstId);
      assert.deepEqual(results, [{ list: [], read: null, ack: false }, { list: [], read: null, ack: false }]);
    });
    const other = await context.newPage(); await initialize(other);
    const otherId = await other.evaluate(async () => (await (globalThis as any).recovery.write({ content: '두 번째 탭의 미저장 원고', editorJson: { type: 'doc', content: [] } })).snapshotId);
    await t.test('two real tabs preserve distinct snapshots, including an actual renderer crash and browser reopen', async () => {
      const rows = await other.evaluate(async () => (globalThis as any).recovery.list());
      assert.equal(rows.length, 2); assert.notEqual(rows[0].tabId, rows[1].tabId);
      const crash = page.waitForEvent('crash');
      const cdp = await context.newCDPSession(page);
      void cdp.send('Page.crash').catch(() => undefined); await crash; await page.close();
      await context.close();
      context = await chromium.launchPersistentContext(join(proof, 'profile'), { executablePath, headless: true });
      const reopened = await context.newPage(); await initialize(reopened);
      const result = await reopened.evaluate(async ids => {
        const client = (globalThis as any).recovery;
        return { list: await client.list(), records: await Promise.all(ids.map(id => client.read(id))) };
      }, [firstId, otherId]);
      assert.equal(result.list.length, 2); assert.equal(result.records[0].payload.content, '합성 보고서\n원문 123,456원'); assert.equal(result.records[1].payload.content, '두 번째 탭의 미저장 원고');
    });
    const current = await context.newPage(); await initialize(current);
    await t.test('a slow old write cannot commit after a new write, and an old acknowledgement cannot delete the newer snapshot', async () => {
      const result = await current.evaluate(async () => {
        const module = (globalThis as any).recoveryModule, client = module.createLocalDocumentRecovery({ accountId: 'synthetic-race', workspaceId: 'report-race', tabId: 'synthetic-race-tab' });
        const initial = await client.write({ content: 'initial' });
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('claim-center-local-document-recovery', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const lock = db.transaction('snapshots', 'readwrite'); let release = false;
        const keepAlive = () => { if (!release) { const request = lock.objectStore('snapshots').get(['synthetic-race', 'report-race', 'synthetic-race-tab']); request.onsuccess = keepAlive; } }; keepAlive();
        const old = client.write({ content: 'old pending' }), newest = client.write({ content: 'newest pending' }), oldAck = client.acknowledge(initial.snapshotId);
        await new Promise(resolve => setTimeout(resolve, 30)); release = true;
        await old; const written = await newest; const staleAck = await oldAck;
        const beforeAck = await client.read(written.snapshotId), acknowledged = await client.acknowledge(written.snapshotId), afterAck = await client.list(); db.close();
        return { staleAck, beforeAck, acknowledged, afterAck };
      });
      assert.equal(result.staleAck, false); assert.equal(result.beforeAck.payload.content, 'newest pending'); assert.equal(result.acknowledged, true); assert.deepEqual(result.afterAck, []);
    });
    await t.test('acknowledging one tab snapshot preserves the other tab and does not claim server confirmation', async () => {
      const result = await current.evaluate(async ids => {
        const client = (globalThis as any).recovery;
        return { ack: await client.acknowledge(ids[0]), remaining: await client.list(), retained: await client.read(ids[1]) };
      }, [firstId, otherId]);
      assert.equal(result.ack, true); assert.equal(result.remaining.length, 1); assert.equal(result.retained.payload.content, '두 번째 탭의 미저장 원고');
    });
    await t.test('quota failure rejects explicitly, does not replace the prior snapshot and does not poison subsequent writes', async () => {
      const result = await current.evaluate(async () => {
        const client = (globalThis as any).recoveryModule.createLocalDocumentRecovery({ accountId: 'synthetic-quota', workspaceId: 'report-quota' }), prior = await client.write({ content: 'prior retained' });
        const put = IDBObjectStore.prototype.put; let code = '';
        IDBObjectStore.prototype.put = function () { throw new DOMException('CF213 injected quota', 'QuotaExceededError'); };
        try { await client.write({ content: 'must not be saved' }); } catch (error) { code = (error as any).code; } finally { IDBObjectStore.prototype.put = put; }
        const retained = await client.read(prior.snapshotId), next = await client.write({ content: 'retry works' });
        return { code, retained, next };
      });
      assert.equal(result.code, 'QUOTA_EXCEEDED'); assert.equal(result.retained.payload.content, 'prior retained'); assert.equal(result.next.payload.content, 'retry works');
    });
    await t.test('unavailable IndexedDB rejects instead of returning a fake successful backup', async () => {
      const unavailable = await context.newPage();
      await unavailable.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/cf213.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
        return route.continue();
      });
      await unavailable.goto(origin + '/cf213.html');
      const code = await unavailable.evaluate(async () => {
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new DOMException('CF213 blocked storage', 'SecurityError'); } });
        const module = await import('/src/documents/local-document-recovery.ts' as string);
        try { await module.createLocalDocumentRecovery({ accountId: 'synthetic-unavailable', workspaceId: 'report-unavailable' }).write({ content: 'not stored' }); return 'FAKE_SUCCESS'; } catch (error) { return (error as any).code; }
      });
      assert.equal(code, 'UNAVAILABLE');
    });
  } finally { await context.close(); await server.close(); }
});
