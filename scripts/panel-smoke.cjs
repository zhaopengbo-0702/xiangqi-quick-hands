const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const project = path.resolve(__dirname, '..');
const extension = path.join(project, 'extension');
const results = path.join(project, 'test-results');
const tempRoot = path.resolve(os.tmpdir());
const fixture = '<!doctype html><html><head><meta charset="utf-8"><title>Panel scaling fixture</title>' +
  '<style>body{margin:0;background:#edf2ee;font:16px system-ui}h1{margin:40px}</style></head>' +
  '<body><h1>Panel scaling fixture</h1><p style="margin:40px">Local interface test only. No chess game is connected.</p></body></html>';

function close(actual, expected, message, tolerance = 1.5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} versus ${expected}`);
}

async function main() {
  const profile = await fs.mkdtemp(path.join(tempRoot, 'xiangqi-panel-smoke-'));
  const manifestVersion = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8')).version;
  const errors = [], checks = [], observations = [];
  let context, page, worker;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(),
      channel: 'chromium', headless: true, viewport: { width: 1600, height: 1600 },
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    });
    await context.route('https://play.xiangqi.com/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture }));
    page = context.pages()[0] || await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    worker = context.serviceWorkers().find(item => /\/background\.js$/.test(item.url())) || await context.waitForEvent('serviceworker', { predicate: item => /\/background\.js$/.test(item.url()), timeout: 20000 });
    await page.goto('https://play.xiangqi.com/play');
    const panel = page.locator('#panel'), header = page.locator('#panel-header');
    await panel.waitFor({ state: 'visible' });
    await fs.mkdir(results, { recursive: true });

    async function geometry() {
      return page.evaluate(() => {
        const root = document.getElementById('xq-quick-hands').shadowRoot;
        const panel = root.getElementById('panel'), body = root.getElementById('body');
        const rect = element => {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        };
        const text = root.getElementById('plies');
        const range = document.createRange(); range.selectNodeContents(text);
        const textRect = range.getBoundingClientRect();
        return {
          panel: rect(panel), header: rect(root.getElementById('panel-header')),
          footer: rect(root.querySelector('footer')), body: rect(body), pauseRequest: rect(root.getElementById('pause-request')),
          text: { width: textRect.width, height: textRect.height },
          icon: rect(root.getElementById('reconnect').querySelector('img')),
          button: rect(root.getElementById('single')),
          scale: Number(getComputedStyle(panel).zoom),
          statusFont: Number.parseFloat(getComputedStyle(root.getElementById('status')).fontSize),
          auxiliaryFont: Number.parseFloat(getComputedStyle(text).fontSize),
          bodyClient: body.clientHeight, bodyScroll: body.scrollHeight, bodyOverflow: getComputedStyle(body).overflowY,
          label: root.getElementById('scale-label')?.textContent,
          collapsed: body.classList.contains('hidden'),
        };
      });
    }
    async function saved() { return worker.evaluate(async () => (await chrome.storage.local.get('panelLayout')).panelLayout); }
    async function waitScale(scale) {
      await page.waitForFunction(scale => {
        const panel = document.getElementById('xq-quick-hands')?.shadowRoot?.getElementById('panel');
        return panel && Math.abs(Number(getComputedStyle(panel).zoom) - scale) < .015;
      }, scale);
    }
    async function seed(layout = { scale: 1, width: 360, height: 1400, left: 220, top: 60 }) {
      await worker.evaluate(layout => chrome.storage.local.set({ panelLayout: layout }), layout);
      await page.reload(); await panel.waitFor({ state: 'visible' });
      const expected = layout.scale ?? Math.min(2.5, Math.max(1, layout.width / 360));
      await waitScale(expected);
      await page.waitForFunction(() => {
        const p = document.getElementById('xq-quick-hands')?.shadowRoot?.getElementById('scale-up');
        return !!p;
      });
    }
    async function storedScale(scale) {
      await worker.evaluate(async expected => {
        for (let i = 0; i < 40; i++) {
          const actual = (await chrome.storage.local.get('panelLayout')).panelLayout;
          if (actual && Math.abs(actual.scale - expected) < .015) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('The chosen interface scale was not saved');
      }, scale);
    }
    async function compact() {
      const value = await geometry();
      assert.ok(value.panel.height <= value.header.height + value.body.height + value.pauseRequest.height + 4 * value.scale,
        'The outer panel must not reserve a blank region below its content: ' + JSON.stringify(value));
      if (value.bodyScroll <= value.bodyClient + 2) {
        close(value.panel.bottom, value.footer.bottom, 'Panel bottom follows its footer', 3 * value.scale);
      }
      return value;
    }
    async function drag(locator, dx, dy) {
      const box = await locator.boundingBox(); assert.ok(box, 'Drag target is visible');
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
    }
    async function fits(viewport) {
      const r = (await geometry()).panel;
      assert.ok(r.x >= -.5 && r.y >= -.5 && r.right <= viewport.width + 1 && r.bottom <= viewport.height + 1, 'Panel remains in the viewport: ' + JSON.stringify(r));
    }
    async function screenshot(name) { await panel.screenshot({ path: path.join(results, name + '.png') }); }
    async function visibleVersion(name) {
      const title = await page.locator('#panel-title').evaluate(element => {
        const root = element.getRootNode(), header = root.getElementById('panel-header');
        const rectangle = node => {
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const range = document.createRange(); range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const controls = ['quick-stop', 'reconnect', 'collapse'].map(id => root.getElementById(id)).filter(node => node.getBoundingClientRect().width > 0);
        return { text: element.textContent, title: rectangle(element), header: rectangle(header),
          ink: { left: text.left, right: text.right, top: text.top, bottom: text.bottom, width: text.width, height: text.height },
          controls: controls.map(rectangle), visibility: getComputedStyle(element).visibility, display: getComputedStyle(element).display };
      });
      assert.equal(title.text, '象棋快手 v' + manifestVersion, name + ': the panel displays the installed manifest version');
      assert.notEqual(title.visibility, 'hidden', name + ': version text is visible');
      assert.notEqual(title.display, 'none', name + ': version text is displayed');
      assert.ok(title.ink.width > 0 && title.ink.height > 0, name + ': version text has visible dimensions');
      assert.ok(title.ink.left >= title.title.left - 1 && title.ink.right <= title.title.right + 1,
        name + ': the full title fits its own space: ' + JSON.stringify(title));
      assert.ok(title.ink.top >= title.header.top - 1 && title.ink.bottom <= title.header.bottom + 1,
        name + ': version text fits the header vertically');
      assert.ok(title.controls.every(control => title.ink.right <= control.left + 1),
        name + ': title and version never overlap header controls: ' + JSON.stringify(title));
      observations.push({ name, versionTitle: title });
    }

    await visibleVersion('normal-header-version');
    checks.push('panel-title-matches-installed-manifest-version');

    await page.waitForFunction(() => {
      const root = document.getElementById('xq-quick-hands')?.shadowRoot;
      return root?.getElementById('vary-operations')?.checked === true;
    });
    assert.equal(await page.locator('#vary-operations').isChecked(), true, 'Operation variation is enabled by default');
    const variationPlacement = await page.locator('#vary-operations').evaluate(input => {
      const root = input.getRootNode(), label = input.closest('label');
      const rect = label.getBoundingClientRect(), main = root.querySelector('main').getBoundingClientRect();
      const start = root.getElementById('auto').getBoundingClientRect();
      return { text: label.textContent.trim(), insideMain: rect.left >= main.left && rect.right <= main.right && rect.top >= main.top && rect.bottom <= main.bottom,
        beforeStart: rect.bottom <= start.top, visible: rect.width > 0 && rect.height > 0 && rect.bottom <= innerHeight };
    });
    assert.equal(variationPlacement.text, '反侦查辅助（操作变化）');
    assert.equal(variationPlacement.insideMain, true, 'The switch is in the main panel');
    assert.equal(variationPlacement.beforeStart, true, 'The switch appears directly above the action buttons');
    assert.equal(variationPlacement.visible, true, 'The switch is visible in the normal main panel');
    await page.locator('#vary-operations').uncheck();
    await worker.evaluate(async () => {
      for (let i = 0; i < 40; i++) {
        if ((await chrome.storage.local.get('varyOperations')).varyOperations === false) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Disabling operation variation was not saved');
    });
    await page.reload(); await panel.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.getElementById('xq-quick-hands').shadowRoot.getElementById('vary-operations').checked === false);
    await page.locator('#vary-operations').check();
    await worker.evaluate(async () => {
      for (let i = 0; i < 40; i++) {
        if ((await chrome.storage.local.get('varyOperations')).varyOperations === true) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Enabling operation variation was not saved');
    });
    await page.reload(); await panel.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.getElementById('xq-quick-hands').shadowRoot.getElementById('vary-operations').checked === true);
    checks.push('main-panel-operation-variation-default-label-and-off-on-refresh-memory');

    await seed();
    const normal = await compact();
    assert.ok(normal.statusFont >= 16, 'Default main text is at least 16 CSS pixels');
    assert.ok(normal.auxiliaryFont >= 14, 'Default supporting text is at least 14 CSS pixels');
    assert.ok(normal.panel.height < 1000, 'Saved height cannot create an empty oversized panel');
    await screenshot('panel-scale-100'); observations.push({ name: '100%', ...normal });
    checks.push('readable-default-and-content-height');

    for (const scale of [1.5, 2]) {
      await seed({ scale, left: 100, top: 40, width: 360 * scale, height: 1500 });
      const value = await compact();
      for (const key of ['text', 'icon', 'button']) {
        close(value[key].height, normal[key].height * scale, `${key} actual visible height scales at ${scale}`, key === 'text' ? 2.5 : 1.5);
        close(value[key].width, normal[key].width * scale, `${key} actual visible width scales at ${scale}`, key === 'text' ? 2.5 : 1.5);
      }
      close(value.panel.width / normal.panel.width, scale, 'Visible panel width scales with its content', .03);
      assert.match(value.label, new RegExp(String(scale * 100)), 'The current scale is visible');
      await visibleVersion('scaled-' + scale * 100 + '-header-version');
      await screenshot('panel-scale-' + scale * 100); observations.push({ name: scale * 100 + '%', ...value });
      checks.push('actual-text-icons-buttons-' + scale * 100);
    }
    checks.push('scaled-header-keeps-entire-version-visible');

    await seed({ scale: 1.5, left: 100, top: 40, width: 540, height: 1500 });
    const pauseStructure = await page.locator('#pause-request').evaluate(element => ({
      hidden: element.classList.contains('hidden'), outsideBody: !element.getRootNode().getElementById('body').contains(element),
      afterHeader: element.previousElementSibling?.id === 'panel-header',
      confirmText: element.querySelector('#pause-confirm').textContent, cancelText: element.querySelector('#pause-cancel').textContent,
    }));
    assert.deepEqual(pauseStructure, { hidden: true, outsideBody: true, afterHeader: true, confirmText: '确认暂停', cancelText: '继续运行' });
    // This fixture has no running game. Reveal the row only for layout checks;
    // the background smoke verifies actual first/second clicks with real WASM.
    await page.locator('#pause-request').evaluate(element => element.classList.remove('hidden'));
    const confirmationExpanded = await compact();
    assert.ok(confirmationExpanded.pauseRequest.height > 90, 'Enlarged confirmation keeps readable text and controls');
    await fits({ width: 1600, height: 1600 });
    await screenshot('panel-pause-confirm-150');
    await page.locator('#collapse').click();
    const confirmationCollapsed = await geometry();
    assert.equal(confirmationCollapsed.collapsed, true);
    assert.ok(confirmationCollapsed.pauseRequest.height > 90, 'Collapsing the body does not hide the confirmation row');
    assert.ok(confirmationCollapsed.panel.height < confirmationExpanded.panel.height / 2);
    for (const id of ['pause-confirm', 'pause-cancel']) {
      const rect = await page.locator('#' + id).boundingBox();
      assert.ok(rect && rect.height >= 45 && rect.y + rect.height <= confirmationCollapsed.panel.bottom, id + ' remains visible in the collapsed panel');
    }
    await screenshot('panel-pause-confirm-collapsed-150');
    await page.locator('#pause-cancel').click();
    assert.equal(await page.locator('#pause-request').isVisible(), false);
    checks.push('pause-confirmation-readable-outside-collapsible-body');

    await seed();
    await page.locator('#scale-up').click(); await waitScale(1.1); await storedScale(1.1);
    await page.reload(); await panel.waitFor({ state: 'visible' }); await waitScale(1.1);
    await page.locator('#scale-down').click(); await waitScale(1); await storedScale(1);
    checks.push('font-controls-and-refresh-memory');

    await seed({ width: 300, height: 418, left: 120, top: 40 });
    const oldDefault = await compact();
    close(oldDefault.scale, 1, 'Old 300px default does not migrate to smaller text', .01);
    assert.ok(oldDefault.text.height >= normal.text.height - 1, 'Migrating old default keeps the new readable size');
    checks.push('legacy-default-keeps-readable-100-percent');

    await seed({ width: 635, height: 612, left: 120, top: 40 });
    const migrated = await compact();
    close(migrated.scale, 635 / 360, 'Legacy width migrates into a scale', .02);
    close(migrated.panel.width, 635, 'Legacy size preserves visible width', 2);
    observations.push({ name: 'legacy-635x612', ...migrated });
    checks.push('legacy-layout-migration-removes-empty-height');

    await page.setViewportSize({ width: 635, height: 612 });
    await page.waitForFunction(() => {
      const root = document.getElementById('xq-quick-hands').shadowRoot;
      const r = root.getElementById('panel').getBoundingClientRect();
      return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    });
    const screenshotViewport = await compact(); await fits({ width: 635, height: 612 });
    assert.ok(screenshotViewport.scale > 1.6, 'The screenshot-sized panel retains enlarged readable text');
    assert.ok(screenshotViewport.bodyScroll > screenshotViewport.bodyClient, 'Contents scroll instead of reserving a blank tail');
    await screenshot('panel-scale-screenshot-635x612');
    observations.push({ name: 'screenshot-635x612', ...screenshotViewport });
    checks.push('user-screenshot-viewport-remains-readable-and-compact');
    await page.setViewportSize({ width: 1600, height: 1600 });

    await seed();
    const beforeLong = await compact();
    const previousStatus=await page.locator('#status').textContent();
    await page.locator('#status').evaluate(element => { element.textContent = '棋盘状态说明 '.repeat(45); });
    await page.waitForFunction(height => document.getElementById('xq-quick-hands').shadowRoot.getElementById('panel').getBoundingClientRect().height > height + 50, beforeLong.panel.height);
    const long = await compact(); await fits({ width: 1600, height: 1600 });
    await page.locator('#status').evaluate((element,text) => { element.textContent = text; },previousStatus);
    await page.waitForFunction(height => document.getElementById('xq-quick-hands').shadowRoot.getElementById('panel').getBoundingClientRect().height < height - 50, long.panel.height);
    const short = await compact(); close(short.panel.height, beforeLong.panel.height, 'Short content reclaims its height', 3);
    checks.push('dynamic-content-grows-and-shrinks-without-blank-tail');

    for (const direction of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      await seed(); const before = await compact();
      const dx = direction.includes('w') ? -before.panel.width * .12 : direction.includes('e') ? before.panel.width * .12 : 0;
      const dy = direction.includes('n') ? -before.panel.height * .12 : direction.includes('s') ? before.panel.height * .12 : 0;
      await drag(page.locator(`[data-resize="${direction}"]`), dx, dy);
      const after = await compact();
      assert.ok(after.scale > before.scale + .07, direction + ' enlarges the interface, not an empty box');
      for (const key of ['text', 'icon', 'button']) assert.ok(after[key].height > before[key].height * 1.06, direction + ' visibly enlarges ' + key);
      close(after.panel.width / before.panel.width, after.scale / before.scale, direction + ' frame scales proportionally', .025);
      close(after.panel.height / before.panel.height, after.scale / before.scale, direction + ' height follows content proportionally', .04);
      await storedScale(after.scale);
      checks.push('proportional-resize-' + direction);
    }

    await seed(); const beforeMove = await geometry();
    await drag(header.locator('strong'), 85, 45);
    let actual = await geometry(); close(actual.panel.x, beforeMove.panel.x + 85, 'Title movement left'); close(actual.panel.y, beforeMove.panel.y + 45, 'Title movement top'); close(actual.scale, 1, 'Moving does not resize', .01);
    const moved = actual.panel;
    await page.reload(); await panel.waitFor({ state: 'visible' }); await waitScale(1);
    actual = await geometry(); close(actual.panel.x, moved.x, 'Remembered movement left'); close(actual.panel.y, moved.y, 'Remembered movement top');
    checks.push('move-and-refresh-preserve-scale-and-position');

    const beforeButton = await geometry();
    await drag(page.locator('#reconnect'), 35, 30);
    actual = await geometry(); close(actual.panel.x, beforeButton.panel.x, 'Header button does not drag left'); close(actual.panel.y, beforeButton.panel.y, 'Header button does not drag top'); close(actual.scale, beforeButton.scale, 'Header button does not resize', .01);
    checks.push('header-controls-do-not-drag');
    // Keep the busy-only button visible for geometry checks in this game-free
    // fixture, even when the regular controller tick reapplies its idle class.
    await page.locator('#quick-stop').evaluate(element => element.style.setProperty('display', 'grid', 'important'));
    const headerControls = await page.evaluate(() => {
      const root = document.getElementById('xq-quick-hands').shadowRoot;
      const header = root.getElementById('panel-header').getBoundingClientRect();
      return ['quick-stop', 'reconnect', 'collapse'].map(id => {
        const rect = root.getElementById(id).getBoundingClientRect();
        return rect.width > 0 && rect.left >= header.left && rect.right <= header.right && rect.top >= header.top && rect.bottom <= header.bottom;
      });
    });
    assert.ok(headerControls.every(Boolean), 'Pause, reconnect and collapse remain fully inside the header');
    await visibleVersion('busy-header-version');
    await screenshot('panel-version-busy');
    await page.locator('#quick-stop').evaluate(element => element.style.removeProperty('display'));
    checks.push('busy-header-controls-remain-accessible');
    checks.push('busy-header-keeps-entire-version-visible');

    await seed({ scale: 1.5, width: 540, height: 1400, left: 200, top: 50 });
    const expanded = await compact(); await page.locator('#collapse').click();
    const collapsed = await geometry(); assert.ok(collapsed.panel.height < expanded.panel.height / 2); close(collapsed.scale, 1.5, 'Collapse retains scale', .01);
    await visibleVersion('collapsed-scaled-header-version');
    await screenshot('panel-version-collapsed-150');
    assert.equal(await page.locator('.resize-handle:visible').count(), 0);
    await drag(header.locator('strong'), 40, 30); await page.locator('#collapse').click();
    actual = await compact(); close(actual.scale, 1.5, 'Expand retains scale', .01); close(actual.panel.height, expanded.panel.height, 'Expand recovers compact natural height', 3);
    checks.push('collapse-drag-expand-retains-readable-scale');
    checks.push('collapsed-scaled-header-keeps-entire-version-visible');

    await page.locator('#collapse').click(); await header.locator('strong').dblclick();
    await waitScale(1); assert.ok((await geometry()).collapsed); await page.locator('#collapse').click();
    actual = await compact(); close(actual.panel.width, 360, 'Reset restores normal interface width', 2); close(actual.scale, 1, 'Reset scale', .01);
    checks.push('reset-while-collapsed-restores-default');

    await seed({ scale: 2, width: 720, height: 1500, left: 100, top: 40 });
    await page.setViewportSize({ width: 320, height: 280 });
    await page.waitForFunction(() => {
      const r = document.getElementById('xq-quick-hands').shadowRoot.getElementById('panel').getBoundingClientRect();
      return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    });
    await fits({ width: 320, height: 280 });
    const small = await geometry();
    await visibleVersion('small-viewport-header-version');
    assert.ok(small.header.height > 0 && small.bodyClient > 0, 'Small viewport retains header and scrollable content');
    assert.ok(small.bodyScroll > small.bodyClient && small.bodyOverflow === 'auto', 'Small viewport scrolls contents');
    await page.locator('#body').evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.ok(await page.locator('#body').evaluate(element => element.scrollTop > 0));
    await page.reload(); await panel.waitFor({ state: 'visible' }); await fits({ width: 320, height: 280 });
    checks.push('small-viewport-scroll-and-refresh');
    checks.push('small-viewport-keeps-entire-version-visible');
    await page.setViewportSize({ width: 1600, height: 1600 }); await header.locator('strong').dblclick(); await waitScale(1); await compact();
    checks.push('double-click-reset');

    const handle = await page.locator('[data-resize="nw"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x - 20, handle.y - 20, { steps: 4 });
    const cleanup = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
      return chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', func: () => {
        const host = document.getElementById('xq-quick-hands'), root = host.shadowRoot;
        const panel = root.getElementById('panel'), header = root.getElementById('panel-header');
        globalThis.__xiangqiQuickHands.destroy();
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 0, clientY: 0 })); window.dispatchEvent(new Event('resize'));
        return { removed: !host.isConnected, alive: globalThis.__xiangqiQuickHands.isAlive(), panelHandler: panel.onpointerdown, headerHandler: header.onpointerdown, resizeState: panel.dataset.interacting };
      } });
    });
    await page.mouse.up(); assert.deepEqual(cleanup[0].result, { removed: true, alive: false, panelHandler: null, headerHandler: null });
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' }); await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', files: ['content.js'] });
    });
    await panel.waitFor({ state: 'visible' }); assert.equal(await page.locator('#xq-quick-hands').count(), 1); await compact();
    checks.push('destroy-during-scaled-pointer-capture-and-reinject');

    // Reuse the real content controller and its UI, replacing only the local
    // fixture's board read and engine transport so every score case is repeatable.
    await page.evaluate(() => history.pushState({}, '', '/analysis/board'));
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
      await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', func: () => {
        globalThis.__xiangqiQuickHands.destroy();
        globalThis.XiangqiSiteAdapter.prototype.read = async () => ({
          fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
          mode: 'analysis', canAnalyze: true, participant: false, active: false, viewOnly: true,
          playerSide: 'red', turn: 'red', historyMode: false, gameKey: 'evaluation-fixture', boardKey: 'evaluation-fixture:opening', moveCount: 0,
        });
        const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.panelSmokeScore = { type: 'cp', value: 100 };
        chrome.runtime.sendMessage = async function(message, ...args) {
          if (message.type === 'XQ_WARMUP') return { ok: true, engine: 'Local score fixture', backend: 'wasm', nnue: true };
          if (message.type === 'XQ_ANALYZE') return { ok: true, bestmove: 'b1c3', depth: 12, score: globalThis.panelSmokeScore, pv: ['b1c3'] };
          if (message.type === 'XQ_BACKGROUND') return { ok: true, active: message.active };
          return sendMessage(message, ...args);
        };
      } });
      await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', files: ['content.js'] });
    });
    await page.waitForFunction(() => {
      const root = document.getElementById('xq-quick-hands')?.shadowRoot;
      return root && !root.getElementById('single').disabled;
    });
    assert.equal(await page.locator('#score').textContent(), '评估 -');
    assert.equal(await page.locator('#score-meaning').textContent(), '暂无有效评估');
    async function displayScore(score, expected, meaning) {
      await worker.evaluate(async score => {
        const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
        await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', args: [score], func: score => { globalThis.panelSmokeScore = score; } });
      }, score);
      await page.locator('#single').click();
      await page.waitForFunction(expected => {
        const root = document.getElementById('xq-quick-hands').shadowRoot;
        return root.getElementById('score').textContent === expected && !root.getElementById('single').disabled;
      }, expected);
      assert.equal(await page.locator('#score').textContent(), expected);
      assert.equal(await page.locator('#score-meaning').textContent(), meaning);
      assert.equal(await page.locator('#score-raw').count(), 0, 'The old score field is absent');
      if (score.type === 'cp') {
        assert.match(expected, /^评估 [+-]?0\.\d{6}$/);
        assert.notEqual(expected, '评估 ' + (score.value / 100).toFixed(2), 'The old raw score is absent from the evaluation');
        assert.equal(await page.locator('#score').getAttribute('title'), '评估范围 −1～+1，保留六位小数；正值有利，负值不利。按本次计算的行棋方判断。');
      }
      observations.push({ name: 'normalized-evaluation', engineScore: score, expected, meaning });
    }
    for (const [value, expected, meaning] of [
      [100, '评估 +0.617918', '稍优'],
      [-104, '评估 -0.626702', '稍劣'],
      [0, '评估 0.000000', '均势'],
      [900, '评估 +0.999999', '接近胜势'],
      [-900, '评估 -0.999999', '接近败势'],
    ]) await displayScore({ type: 'cp', value }, expected, meaning);
    checks.push('real-controller-normalized-positive-negative-zero-six-decimal-meaning-without-raw-score');
    for (const [u, mapped, positive, negative] of [
      [.635148952387, .5, '稍优', '稍劣'],
      [.978026114739, .7, '明显优势', '明显劣势'],
      [.999753210848, .9, '大幅优势', '大幅劣势'],
      [.999999969540, .99, '接近胜势', '接近败势'],
    ]) {
      const cp = Math.atanh(u) / .015;
      await displayScore({ type: 'cp', value: cp }, '评估 +' + mapped.toFixed(6), positive);
      await displayScore({ type: 'cp', value: -cp }, '评估 -' + mapped.toFixed(6), negative);
    }
    checks.push('pchip-four-anchors-odd-symmetry-and-rounded-display-meaning-boundaries');
    for (const [value, meaning] of [[3, '发现强制杀棋'], [-3, '发现对方强制杀棋']]) {
      await displayScore({ type: 'mate', value }, '杀棋 ' + value, meaning);
    }
    checks.push('real-controller-preserves-explicit-positive-and-negative-mate');
    async function scoreFits(name) {
      const value = await page.evaluate(() => {
        const root = document.getElementById('xq-quick-hands').shadowRoot;
        const main = root.querySelector('main'), bounds = main.getBoundingClientRect();
        return { mainWidth: main.clientWidth, contentWidth: main.scrollWidth,
          lines: ['score', 'score-meaning'].flatMap(id => {
            const node = root.getElementById(id), range = document.createRange(); range.selectNodeContents(node);
            return [...range.getClientRects()].map(rect => ({ id, left: rect.left, right: rect.right, width: rect.width, height: rect.height }));
          }), left: bounds.left, right: bounds.right };
      });
      assert.ok(value.contentWidth <= value.mainWidth + 1, name + ': evaluation creates no horizontal overflow');
      assert.ok(value.lines.length >= 2 && value.lines.every(line => line.width > 0 && line.height > 0 && line.left >= value.left - 1 && line.right <= value.right + 1), name + ': both evaluation lines fit the main panel: ' + JSON.stringify(value));
      observations.push({ name, evaluationGeometry: value });
    }
    await displayScore({ type: 'cp', value: -104 }, '评估 -0.626702', '稍劣');
    await header.locator('strong').dblclick(); await waitScale(1);
    await scoreFits('evaluation-100'); await compact(); await screenshot('panel-evaluation-100');
    for (const target of [1.5, 2]) {
      while ((await geometry()).scale < target - .01) await page.locator('#scale-up').click();
      await waitScale(target); await scoreFits('evaluation-' + target * 100); await compact();
      await screenshot('panel-evaluation-' + target * 100);
    }
    checks.push('normalized-evaluation-and-meaning-fit-normal-150-and-200-percent');
    await page.setViewportSize({ width: 320, height: 280 });
    await page.waitForFunction(() => {
      const r = document.getElementById('xq-quick-hands').shadowRoot.getElementById('panel').getBoundingClientRect();
      return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    });
    await page.locator('#score-meaning').scrollIntoViewIfNeeded();
    await scoreFits('evaluation-small-320x280'); await fits({ width: 320, height: 280 });
    await screenshot('panel-evaluation-small-320x280');
    checks.push('normalized-evaluation-and-meaning-fit-small-scrolling-panel');
    assert.deepEqual(errors, []);
    const report = { ok: true, manifestVersion, checks, checkCount: checks.length, observations, finalGeometry: await geometry(), savedLayout: await saved(), pageErrors: errors };
    await fs.writeFile(path.join(results, 'panel-resize.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await fs.mkdir(results, { recursive: true }); await page?.screenshot({ path: path.join(results, 'panel-resize-failed.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(results, 'panel-resize-failed.json'), JSON.stringify({ ok: false, checks, pageErrors: errors, error: error.stack || String(error) }, null, 2) + '\n'); throw error;
  } finally {
    await context?.close();
    if (path.dirname(profile) !== tempRoot || !path.basename(profile).startsWith('xiangqi-panel-smoke-')) throw new Error('Refusing unexpected profile cleanup path');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
