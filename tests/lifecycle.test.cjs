const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8').replace(/^import[^\n]+\n/, '');
const site = 'https://play.xiangqi.com';
const alive = { ok: true, contextAlive: true };

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function lifecycle(options = {}) {
  const listeners = {};
  const calls = [];
  const tabs = new Map((options.tabs || [{ id: 1, url: site + '/computer-play' }]).map(tab => [tab.id, { ...tab }]));
  const healthy = new Set(options.healthy || []);
  const event = name => ({ addListener(callback) { listeners[name] = callback; } });
  const context = vm.createContext({
    URL,
    analyze() { throw new Error('Lifecycle recovery must not analyze a game.'); },
    warmup() { throw new Error('Lifecycle recovery must not warm the engine.'); },
    cancel: async () => {},
    chrome: {
      runtime: { id: 'test', onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') },
      action: { onClicked: event('action') },
      tabs: {
        onRemoved: event('removed'),
        async get(tabId) {
          if (!tabs.has(tabId)) throw new Error('No tab.');
          return { ...tabs.get(tabId) };
        },
        async query(query) { calls.push({ type: 'query', query: { ...query } }); return [...tabs.values()]; },
        async sendMessage(tabId, message, target) {
          calls.push({ type: 'message', tabId, message: { ...message }, target: { ...target } });
          if (options.sendMessage) return options.sendMessage(tabId, message, healthy);
          if (!healthy.has(tabId)) throw new Error('Receiving end does not exist.');
          return alive;
        },
        async create(tab) { calls.push({ type: 'create', tab: { ...tab } }); },
        async reload(tabId) { calls.push({ type: 'reload', tabId }); throw new Error('Recovery must not reload a game.'); },
      },
      scripting: {
        async executeScript(spec) {
          calls.push({ type: 'inject', tabId: spec.target.tabId, world: spec.world, files: [...spec.files] });
          if (options.executeScript) await options.executeScript(spec);
          if (spec.files.includes('content.js')) healthy.add(spec.target.tabId);
        },
      },
    },
  });
  vm.runInContext(source, context);
  return { listeners, calls, tabs, healthy, context };
}

test('installation recovers missing panels on every Xiangqi path with ordered script worlds', async () => {
  const app = lifecycle({ tabs: [
    { id: 1, url: site + '/computer-play' },
    { id: 2, url: site + '/game/owned-match' },
    { id: 3, url: site + '/computer' },
    { id: 4, url: 'https://example.com/' },
  ], healthy: [1] });
  await app.listeners.installed({ reason: 'update' });
  assert.deepEqual(app.calls.find(call => call.type === 'query').query, { url: site + '/*' });
  const injections = app.calls.filter(call => call.type === 'inject');
  for (const tabId of [2, 3]) {
    assert.deepEqual(injections.filter(call => call.tabId === tabId), [
      { type: 'inject', tabId, world: 'MAIN', files: ['page-bridge.js'] },
      { type: 'inject', tabId, world: 'ISOLATED', files: ['site-adapter.js', 'content.js'] },
    ]);
  }
  assert.equal(injections.length, 4);
  assert.equal(app.calls.some(call => call.type === 'reload' || call.message?.type === 'XQ_TOGGLE_PANEL'), false);
});

test('browser startup leaves healthy panels and their visibility alone', async () => {
  const app = lifecycle({ healthy: [1] });
  await app.listeners.startup();
  assert.deepEqual(app.calls.filter(call => call.type === 'message').map(call => call.message.type), ['XQ_PING']);
  assert.equal(app.calls.some(call => call.type === 'inject'), false);
});

test('toolbar action toggles an acknowledged healthy panel in the top frame', async () => {
  const app = lifecycle({ healthy: [1] });
  await app.listeners.action(app.tabs.get(1));
  const messages = app.calls.filter(call => call.type === 'message');
  assert.deepEqual(messages.map(call => call.message.type), ['XQ_PING', 'XQ_TOGGLE_PANEL']);
  assert.equal(messages.every(call => call.target.frameId === 0), true);
  assert.equal(app.calls.some(call => ['inject', 'reload', 'create'].includes(call.type)), false);
});

test('toolbar action replaces a missing or invalidated panel without reloading the game', async () => {
  for (const response of [undefined, { ok: true }, { ok: true, contextAlive: false }]) {
    const app = lifecycle({ sendMessage: async () => response });
    await app.listeners.action(app.tabs.get(1));
    assert.deepEqual(app.calls.filter(call => call.type === 'inject').map(call => call.world), ['MAIN', 'ISOLATED']);
    assert.equal(app.calls.some(call => call.type === 'reload' || call.message?.type === 'XQ_TOGGLE_PANEL'), false);
  }
});

test('a panel invalidated between ping and toggle is recovered without a tab reload', async () => {
  const app = lifecycle({ sendMessage: async (_tabId, message) => {
    if (message.type === 'XQ_PING') return alive;
    throw new Error('Extension context invalidated.');
  } });
  await app.listeners.action(app.tabs.get(1));
  assert.equal(app.calls.filter(call => call.type === 'inject').length, 2);
  assert.equal(app.calls.some(call => call.type === 'reload'), false);
});

test('overlapping install and startup recovery serialize each tab and inject only once', async () => {
  const gate = deferred();
  let first = true;
  const app = lifecycle({ executeScript: async spec => {
    if (first && spec.world === 'MAIN') { first = false; await gate.promise; }
  } });
  const install = app.listeners.installed({ reason: 'update' });
  const startup = app.listeners.startup();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(app.calls.filter(call => call.type === 'inject').length, 1);
  gate.resolve();
  await Promise.all([install, startup]);
  assert.equal(app.calls.filter(call => call.type === 'inject').length, 2);
  assert.equal(app.calls.filter(call => call.message?.type === 'XQ_PING').length, 2);
});

test('one failed tab does not block other recovery and releases its per-tab queue', async () => {
  let failed = false;
  const app = lifecycle({ tabs: [{ id: 1, url: site + '/computer-play' }, { id: 2, url: site + '/game/owned' }],
    executeScript: async spec => {
      if (!failed && spec.target.tabId === 1) { failed = true; throw new Error('Tab closed during injection.'); }
    },
  });
  await app.listeners.installed({ reason: 'update' });
  assert.equal(app.healthy.has(1), false);
  assert.equal(app.healthy.has(2), true);
  await app.listeners.action(app.tabs.get(1));
  assert.equal(app.healthy.has(1), true);
  assert.equal(app.calls.some(call => call.type === 'reload'), false);
});

test('toolbar action outside Xiangqi opens the computer page without injection', async () => {
  const app = lifecycle();
  await app.listeners.action({ id: 9, url: 'https://example.com/' });
  assert.deepEqual(app.calls, [{ type: 'create', tab: { url: site + '/computer-play' } }]);
});
