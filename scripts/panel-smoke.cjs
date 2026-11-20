const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const project = path.resolve(__dirname, '..');
const extension = path.join(project, 'extension');
const results = path.join(project, 'test-results');
const tempRoot = path.resolve(os.tmpdir());
const baseline = { width: 360, height: 440, left: 300, top: 140 };
const fixture = '<!doctype html><html><head><meta charset="utf-8"><title>Panel interaction fixture</title>' +
  '<style>body{margin:0;background:#edf2ee;font:16px system-ui}h1{margin:40px}</style></head>' +
  '<body><h1>Panel interaction fixture</h1><p style="margin:40px">Local test only. No chess game is connected.</p></body></html>';

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1.1, `${message}: ${actual} versus ${expected}`);
}

async function main() {
  const profile = await fs.mkdtemp(path.join(tempRoot, 'xiangqi-panel-smoke-'));
  const errors = [];
  const checks = [];
  let context, page, worker;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(),
      channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    });
    await context.route('https://play.xiangqi.com/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture }));
    page = context.pages()[0] || await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
    await page.goto('https://play.xiangqi.com/play');
    const panel = page.locator('#panel');
    const header = page.locator('#panel-header');
    await panel.waitFor({ state: 'visible' });

    async function rect() { return panel.boundingBox(); }
    async function saved() { return worker.evaluate(async () => (await chrome.storage.local.get('panelLayout')).panelLayout); }
    async function seed(layout = baseline) {
      await worker.evaluate(layout => chrome.storage.local.set({ panelLayout: layout }), layout);
      await page.reload();
      await panel.waitFor({ state: 'visible' });
      await page.waitForFunction(layout => {
        const r = document.getElementById('xq-quick-hands')?.shadowRoot?.getElementById('panel')?.getBoundingClientRect();
        return r && Math.abs(r.width - layout.width) < 1 && Math.abs(r.left - layout.left) < 1;
      }, layout);
    }
    async function drag(locator, dx, dy) {
      const box = await locator.boundingBox();
      assert.ok(box, 'Drag target must be visible');
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 8 });
      await page.mouse.up();
    }
    async function storedEquals(expected) {
      await worker.evaluate(async expected => {
        for (let i = 0; i < 40; i++) {
          const actual = (await chrome.storage.local.get('panelLayout')).panelLayout;
          if (actual && Object.keys(expected).every(key => Math.abs(actual[key] - expected[key]) < 1)) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Panel layout was not saved');
      }, expected);
    }
    async function fits(viewport) {
      const r = await rect();
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width + 1 && r.y + r.height <= viewport.height + 1, JSON.stringify(r));
      return r;
    }

    for (const direction of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      await seed();
      const dx = direction.includes('w') ? -40 : direction.includes('e') ? 40 : 0;
      const dy = direction.includes('n') ? -30 : direction.includes('s') ? 30 : 0;
      await drag(page.locator(`[data-resize="${direction}"]`), dx, dy);
      const actual = await rect();
      close(actual.width, baseline.width + Math.abs(dx), direction + ' width');
      close(actual.height, baseline.height + Math.abs(dy), direction + ' height');
      close(actual.x, baseline.left + Math.min(0, dx), direction + ' left anchor');
      close(actual.y, baseline.top + Math.min(0, dy), direction + ' top anchor');
      await storedEquals({ width: actual.width, height: actual.height, left: actual.x, top: actual.y });
      checks.push('resize-' + direction);
    }

    await seed();
    await drag(header.locator('strong'), 90, 50);
    let actual = await rect();
    close(actual.x, baseline.left + 90, 'Title drag left');
    close(actual.y, baseline.top + 50, 'Title drag top');
    await storedEquals({ width: actual.width, height: actual.height, left: actual.x, top: actual.y });
    const remembered = actual;
    await page.reload();
    await panel.waitFor({ state: 'visible' });
    await page.waitForFunction(expected => {
      const r = document.getElementById('xq-quick-hands')?.shadowRoot?.getElementById('panel')?.getBoundingClientRect();
      return r && Math.abs(r.left - expected.x) < 1 && Math.abs(r.top - expected.y) < 1;
    }, remembered);
    actual = await rect();
    close(actual.width, remembered.width, 'Refresh width');
    close(actual.height, remembered.height, 'Refresh height');
    checks.push('title-drag-and-refresh-memory');

    await page.locator('#collapse').click();
    const collapsed = await rect();
    assert.ok(collapsed.height < 60, 'Collapsed panel contains only its header');
    assert.equal(await page.locator('.resize-handle:visible').count(), 0);
    await drag(header.locator('strong'), -60, -40);
    await page.locator('#collapse').click();
    actual = await rect();
    close(actual.width, remembered.width, 'Expand width');
    close(actual.height, remembered.height, 'Expand height');
    close(actual.x, remembered.x - 60, 'Collapsed movement left');
    close(actual.y, remembered.y - 40, 'Collapsed movement top');
    checks.push('collapse-drag-expand');

    const beforeButton = await rect();
    await drag(page.locator('#reconnect'), 40, 30);
    actual = await rect();
    close(actual.x, beforeButton.x, 'Button must not drag panel left');
    close(actual.y, beforeButton.y, 'Button must not drag panel top');
    checks.push('header-buttons-do-not-drag');

    await seed();
    await drag(page.locator('[data-resize="se"]'), -300, -350);
    actual = await rect();
    close(actual.width, 240, 'Minimum width');
    close(actual.height, 180, 'Minimum height');
    const scrollable = await page.locator('#body').evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight, overflow: getComputedStyle(el).overflowY }));
    assert.ok(scrollable.scroll > scrollable.client && scrollable.overflow === 'auto', 'Small panel contents must scroll');
    await page.locator('#body').evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await page.locator('#body').evaluate(el => el.scrollTop > 0), 'Contents can be scrolled');
    checks.push('minimum-size-and-scroll');

    await seed();
    await page.setViewportSize({ width: 320, height: 280 });
    await page.waitForFunction(() => {
      const r = document.getElementById('xq-quick-hands')?.shadowRoot?.getElementById('panel')?.getBoundingClientRect();
      return r && r.right <= innerWidth && r.bottom <= innerHeight;
    });
    await fits({ width: 320, height: 280 });
    await page.reload();
    await panel.waitFor({ state: 'visible' });
    await fits({ width: 320, height: 280 });
    checks.push('small-viewport-and-refresh');
    await page.setViewportSize({ width: 1280, height: 900 });
    await header.locator('strong').dblclick();
    actual = await rect();
    close(actual.width, 300, 'Reset desktop width');
    close(actual.x + actual.width, 1280 - 16, 'Reset right position');
    close(actual.y + actual.height, 900 - 16, 'Reset bottom position');
    checks.push('double-click-reset');
    await seed();
    await page.locator('#collapse').click();
    await header.locator('strong').dblclick();
    assert.ok((await rect()).height < 60, 'Reset keeps a collapsed panel collapsed');
    await page.locator('#collapse').click();
    actual = await rect();
    close(actual.width, 300, 'Reset while collapsed restores expanded default width');
    assert.ok(actual.height > 300, 'Reset while collapsed restores expanded content height');
    checks.push('double-click-reset-while-collapsed');

    const handle = await page.locator('[data-resize="nw"]').boundingBox();
    await page.mouse.move(handle.x + 7, handle.y + 7);
    await page.mouse.down();
    await page.mouse.move(handle.x - 20, handle.y - 20, { steps: 4 });
    const cleanup = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
      return chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', func: () => {
        const host = document.getElementById('xq-quick-hands');
        const panel = host.shadowRoot.getElementById('panel');
        const header = host.shadowRoot.getElementById('panel-header');
        globalThis.__xiangqiQuickHands.destroy();
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 0, clientY: 0 }));
        window.dispatchEvent(new Event('resize'));
        return { removed: !host.isConnected, alive: globalThis.__xiangqiQuickHands.isAlive(), panelHandler: panel.onpointerdown, headerHandler: header.onpointerdown, resizeState: panel.dataset.interacting };
      } });
    });
    await page.mouse.up();
    assert.deepEqual(cleanup[0].result, { removed: true, alive: false, panelHandler: null, headerHandler: null });
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
      await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', files: ['content.js'] });
    });
    await panel.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#xq-quick-hands').count(), 1);
    checks.push('destroy-during-pointer-capture-and-reinject');
    assert.deepEqual(errors, []);
    await fs.mkdir(results, { recursive: true });
    await page.screenshot({ path: path.join(results, 'panel-resize.png'), fullPage: true });
    const report = { ok: true, manifestVersion: JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8')).version, checks, checkCount: checks.length, finalRect: await rect(), savedLayout: await saved(), pageErrors: errors };
    await fs.writeFile(path.join(results, 'panel-resize.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await fs.mkdir(results, { recursive: true });
    await page?.screenshot({ path: path.join(results, 'panel-resize-failed.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(results, 'panel-resize-failed.json'), JSON.stringify({ ok: false, checks, pageErrors: errors, error: error.stack || String(error) }, null, 2) + '\n');
    throw error;
  } finally {
    await context?.close();
    if (path.dirname(profile) !== tempRoot || !path.basename(profile).startsWith('xiangqi-panel-smoke-')) throw new Error('Refusing unexpected profile cleanup path');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
