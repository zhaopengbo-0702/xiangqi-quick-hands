const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extension = path.join(__dirname, '../extension');
const source = fs.readFileSync(path.join(extension, 'background.js'), 'utf8').replace(/^import[^\n]+\n/, '');
const site = 'https://play.xiangqi.com';
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

function background(options = {}) {
  const listeners = {}, pulseChanges = [], sends = [], queries = [], timers = new Map();
  let nextTimer = 0;
  const tabs = new Map([[7, { id: 7, url: site + '/computer-play' }]]);
  const event = name => ({ addListener(callback) { listeners[name] = callback; } });
  const runtime = { id: 'test', getURL: file => 'chrome-extension://test/' + file,
    onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') };
  const context = vm.createContext({ URL, console,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    analyze: async () => ({}), warmup: async () => ({}), cancel: async () => {},
    setBackgroundPulse: async enabled => { pulseChanges.push(enabled); if (options.setPulse) await options.setPulse(enabled); },
    chrome: { runtime, action: { onClicked: event('action') }, tabs: {
      onRemoved: event('removed'), onUpdated: event('updated'),
      async query(query) { queries.push({ ...query }); return [...tabs.values()].map(tab => ({ ...tab })); },
      async get(tabId) { if (options.getTab) return options.getTab(tabId, tabs); if (!tabs.has(tabId)) throw new Error('No tab'); return { ...tabs.get(tabId) }; },
      async sendMessage(tabId, message, target) {
        sends.push({ tabId, message: { ...message }, target: { ...target } });
        return options.sendMessage ? options.sendMessage(tabId, message, target) : { ok: true, active: true };
      },
    } },
  });
  vm.runInContext(source, context);
  const sender = { id: 'test', tab: { id: 7 }, frameId: 0, documentId: 'document-one', url: site + '/computer-play' };
  const offscreen = { id: 'test', url: runtime.getURL('offscreen.html') };
  function send(message, from = sender) { return new Promise(resolve => {
    const handled = listeners.message(message, from, resolve);
    if (handled === false) resolve(undefined);
  }); }
  return { listeners, tabs, sends, queries, pulseChanges, context, sender, offscreen, send, timers,
    subscribe: (sessionId = 'session-one', active = true, from = sender) => send({ type: 'XQ_BACKGROUND', sessionId, active }, from),
    heartbeat: async (from = offscreen) => { const result = await send({ target: 'background', type: 'XQ_BACKGROUND_HEARTBEAT' }, from); await flush(); return result; },
  };
}

test('background subscriptions require the extension top frame and the live game URL', async () => {
  const app = background();
  for (const from of [
    { ...app.sender, id: 'other' }, { ...app.sender, frameId: 1 },
    { ...app.sender, tab: undefined }, { ...app.sender, url: 'https://example.com/' },
    { ...app.sender, origin: 'https://example.com' },
  ]) assert.equal((await app.subscribe('one', true, from)).ok, false);
  for (const url of [site + '/play', site + '/analysis', 'https://example.com/computer-play']) {
    app.tabs.get(7).url = url;
    assert.equal((await app.subscribe()).ok, false);
  }
  assert.equal(app.pulseChanges.includes(true), false);
  app.tabs.get(7).url = site + '/game/owned';
  const result = await app.subscribe('one', true, { ...app.sender, url: site + '/play' });
  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(app.pulseChanges.at(-1), true);
});

test('an authenticated offscreen heartbeat recovers only already-active page sessions after worker restart', async () => {
  const app = background({ sendMessage: (tabId, message) => {
    if (message.type === 'XQ_BACKGROUND_STATUS') return { ok: true, active: true, sessionId: 'running-before-restart' };
    return { ok: true, active: true };
  } });
  assert.equal(app.pulseChanges.length, 0);
  await app.heartbeat({ ...app.offscreen, id: 'foreign' });
  assert.equal(app.queries.length, 0);
  await app.heartbeat();
  assert.equal(app.queries.length, 1);
  assert.equal(app.sends[0].message.type, 'XQ_BACKGROUND_STATUS');
  assert.equal(app.sends[0].target.frameId, 0);
  assert.equal(app.sends[1].message.sessionId, 'running-before-restart');
  assert.equal(app.pulseChanges.at(-1), true);
  await app.heartbeat();
  assert.equal(app.queries.length, 1);
  assert.equal(app.sends.filter(send => send.message.type === 'XQ_BACKGROUND_STATUS').length, 1);
});

test('paused, invalid or navigated pages are never resumed and empty heartbeat recovery only queries once', async () => {
  const app = background({ sendMessage: (tabId) => {
    if (tabId === 7) return { ok: true, active: false, sessionId: 'paused' };
    if (tabId === 8) return { ok: true, active: true, sessionId: '' };
    return { ok: true, active: true, sessionId: 'wrong-route' };
  } });
  app.tabs.set(8, { id: 8, url: site + '/game/other' });
  app.tabs.set(9, { id: 9, url: site + '/play' });
  await app.heartbeat();
  await app.heartbeat();
  assert.equal(app.queries.length, 1);
  assert.equal(app.sends.length, 2);
  assert.equal(app.sends.every(send => send.message.type === 'XQ_BACKGROUND_STATUS'), true);
  assert.equal(app.pulseChanges.includes(true), false);
  assert.equal(app.pulseChanges.at(-1), false);
});

test('an unsubscribe received during restart discovery prevents a stale active status from reviving the tab', async () => {
  const gate = deferred();
  const app = background({ sendMessage: () => gate.promise });
  const discovering = app.heartbeat();
  await flush();
  assert.equal(app.sends.length, 1);
  await app.subscribe('old-session', false);
  gate.resolve({ ok: true, active: true, sessionId: 'old-session' });
  await discovering;
  assert.equal(app.sends.length, 1);
  assert.equal(app.pulseChanges.includes(true), false);
});

test('a frozen status receiver cannot delay heartbeat acknowledgements or another recovered game', async () => {
  const frozen = deferred();
  const app = background({ sendMessage: (tabId, message) => {
    if (message.type === 'XQ_BACKGROUND_STATUS') return tabId === 7 ? frozen.promise : { ok: true, active: true, sessionId: 'healthy-session' };
    return { ok: true, active: true };
  } });
  app.tabs.set(8, { id: 8, url: site + '/game/healthy' });
  let immediateReply;
  const handled = app.listeners.message({ target: 'background', type: 'XQ_BACKGROUND_HEARTBEAT' }, app.offscreen, response => { immediateReply = response; });
  assert.equal(handled, false);
  assert.equal(immediateReply.ok, true);
  await flush();
  assert.equal(app.pulseChanges.at(-1), true);
  await app.heartbeat();
  assert.equal(app.sends.some(send => send.tabId === 8 && send.message.type === 'XQ_BACKGROUND_PULSE'), true);
  assert.equal(app.timers.size, 1);
  const timer = [...app.timers.values()][0];
  assert.equal(timer.delay, 800);
  timer.callback();
  await flush();
  frozen.resolve({ ok: true, active: true, sessionId: 'too-late' });
  await flush();
  await app.heartbeat();
  assert.equal(app.sends.some(send => send.tabId === 7 && send.message.type === 'XQ_BACKGROUND_PULSE'), false);
  assert.equal(app.pulseChanges.at(-1), true);
});

test('only the exact offscreen document may issue pulses, targeted to the subscribed document', async () => {
  const app = background();
  await app.subscribe();
  for (const from of [
    { ...app.offscreen, id: 'other' }, { ...app.offscreen, tab: { id: 7 } },
    { ...app.offscreen, url: 'chrome-extension://test/other.html' }, app.sender,
  ]) assert.equal(await app.heartbeat(from), undefined);
  assert.equal(app.sends.length, 0);
  await app.heartbeat();
  assert.deepEqual(app.sends, [{ tabId: 7, message: { type: 'XQ_BACKGROUND_PULSE', sessionId: 'session-one' },
    target: { frameId: 0, documentId: 'document-one' } }]);
});

test('unsubscribe is session scoped and works after navigation without reopening an engine', async () => {
  const app = background();
  await app.subscribe('new');
  await app.subscribe('old', false);
  await app.heartbeat();
  assert.equal(app.sends.length, 1);
  app.tabs.get(7).url = 'https://example.com/';
  assert.equal((await app.subscribe('new', false)).active, false);
  await app.heartbeat();
  assert.equal(app.sends.length, 1);
  assert.equal(app.pulseChanges.at(-1), false);
});

test('a late subscribe lookup cannot reenable a session already cancelled', async () => {
  const gate = deferred();
  const app = background({ getTab: async () => gate.promise });
  const pending = app.subscribe('one');
  await app.subscribe('one', false);
  gate.resolve({ id: 7, url: site + '/computer-play' });
  assert.equal((await pending).active, false);
  await app.heartbeat();
  assert.equal(app.sends.some(send => send.message.type === 'XQ_BACKGROUND_PULSE'), false);
  assert.equal(app.pulseChanges.includes(true), false);
});

test('fast enable-disable transitions serialize the final offscreen timer state', async () => {
  const gate = deferred();
  const app = background({ setPulse: enabled => enabled ? gate.promise : undefined });
  const enabling = app.subscribe('one');
  await flush();
  assert.deepEqual(app.pulseChanges, [true]);
  const disabling = app.subscribe('one', false);
  gate.resolve();
  await Promise.all([enabling, disabling]);
  await flush();
  assert.deepEqual(app.pulseChanges, [true, false]);
  assert.equal((await app.heartbeat()).enabled, false);
});

test('pulses never stack while a receiver is pending, and stale replies cannot remove a new session', async () => {
  const gate = deferred();
  let first = true;
  const app = background({ sendMessage: () => { if (first) { first = false; return gate.promise; } return { ok: true, active: true }; } });
  await app.subscribe('old');
  await app.heartbeat();
  await app.heartbeat();
  assert.equal(app.sends.length, 1);
  await app.subscribe('old');
  await app.heartbeat();
  assert.equal(app.sends.length, 1, 'renewing the same session must retain its pending pulse guard');
  await app.subscribe('new');
  gate.resolve({ ok: true, active: false });
  await flush();
  await app.heartbeat();
  assert.equal(app.sends.length, 2);
  assert.equal(app.sends.at(-1).message.sessionId, 'new');
  assert.equal(app.pulseChanges.at(-1), true);
});

test('inactive replies, missing receivers, live navigation and tab closure stop the pulse', async () => {
  for (const mode of ['inactive', 'missing', 'navigation', 'updated', 'removed']) {
    const app = background({ sendMessage: () => {
      if (mode === 'missing') throw new Error('Receiving end does not exist');
      return { ok: true, active: mode !== 'inactive' };
    } });
    await app.subscribe();
    if (mode === 'navigation') app.tabs.get(7).url = site + '/analysis';
    if (mode === 'updated') app.listeners.updated(7, { url: site + '/play' });
    if (mode === 'removed') app.listeners.removed(7);
    await app.heartbeat();
    const count = app.sends.length;
    await app.heartbeat();
    assert.equal(app.sends.length, count, mode);
    assert.equal(app.pulseChanges.at(-1), false, mode);
  }
});

test('disabling the engine-client pulse never creates an offscreen document', async () => {
  const clientSource = fs.readFileSync(path.join(extension, 'engine-client.js'), 'utf8').replace(/\bexport /g, '');
  let creates = 0, sends = 0, contexts = [];
  const context = vm.createContext({ chrome: { runtime: {
    id: 'test', getURL: file => 'chrome-extension://test/' + file, onConnect: { addListener() {} },
    getContexts: async () => contexts,
    sendMessage: async message => { sends++; return { ok: true, result: { enabled: message.enabled } }; },
  }, offscreen: { createDocument: async () => { creates++; } } } });
  vm.runInContext(clientSource, context);
  await context.setBackgroundPulse(false);
  assert.equal(creates, 0); assert.equal(sends, 0);
  contexts = [{}];
  await context.setBackgroundPulse(false);
  assert.equal(creates, 0); assert.equal(sends, 1);
  await context.setBackgroundPulse(true);
  assert.equal(creates, 0); assert.equal(sends, 2);
});

test('offscreen pulse runs only while enabled, does not stack heartbeats or initialize an engine', async () => {
  let listener, nextTimer = 0, heartbeats = 0;
  const timers = new Map(), gate = deferred();
  const runtime = { id: 'test', onMessage: { addListener(callback) { listener = callback; } },
    sendMessage: async () => { heartbeats++; return gate.promise; } };
  const context = vm.createContext({ chrome: { runtime }, console,
    setInterval(callback, interval) { const id = ++nextTimer; timers.set(id, { callback, interval }); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  vm.runInContext(fs.readFileSync(path.join(extension, 'offscreen.js'), 'utf8'), context);
  const command = enabled => new Promise(resolve => listener({ target: 'offscreen', type: 'XQ_ENGINE_PULSE', enabled }, { id: 'test' }, resolve));
  assert.equal(timers.size, 0);
  assert.equal((await command(true)).ok, true);
  assert.equal(timers.size, 1);
  const timer = [...timers.values()][0];
  assert.equal(timer.interval, 100);
  timer.callback(); timer.callback(); await flush();
  assert.equal(heartbeats, 1);
  assert.equal((await command(false)).ok, true);
  assert.equal(timers.size, 0);
  gate.resolve({ ok: true }); await flush();
  assert.equal(vm.runInContext('engine === undefined', context), true);
});
