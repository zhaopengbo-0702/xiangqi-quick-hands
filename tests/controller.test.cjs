const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8').replace(/^import[^\n]+\n/, '');
const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function classList() {
  const classes = new Set();
  return {
    add: name => classes.add(name),
    remove: name => classes.delete(name),
    contains: name => classes.has(name),
    toggle(name, force) {
      const value = force === undefined ? !classes.has(name) : force;
      if (value) classes.add(name); else classes.delete(name);
      return value;
    },
  };
}

async function controller(initial = {}, options = {}) {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  let elements = new Map();
  let host;
  let readCount = 0;
  let destroyCount = 0;
  let reloadCount = 0;
  const hosts = [];
  const runtimeListeners = new Set();
  const runtimeFaults = { id: false, getURL: false, sendMessage: false, storage: false };
  const listeners = {};
  const calls = [];
  const reads = [];
  const searches = [];
  const warmups = [];
  const storageWrites = [];
  const plays = [];
  const playAttempts = [];
  const viewport = { innerWidth: options.viewport?.width ?? 1280, innerHeight: options.viewport?.height ?? 800 };
  let readError = options.adapterError || null;
  let deferRead = false;
  let playError = options.playError || null;
  let state = { fen: START, mode: 'computer', participant: true, playerSide: 'red', turn: 'red', active: true, historyMode: false, gameKey: 'game:original', boardKey: 'game:opening', moveCount: 0, ...initial };
  function eventTarget(target, observedListeners) {
    const callbacks = new Map();
    target.addEventListener = (name, callback) => {
      if (!callbacks.has(name)) callbacks.set(name, new Set());
      callbacks.get(name).add(callback);
      if (observedListeners) observedListeners[name] = event => target.dispatchEvent({ ...event, type: name });
    };
    target.removeEventListener = (name, callback) => {
      callbacks.get(name)?.delete(callback);
      if (!callbacks.get(name)?.size && observedListeners) delete observedListeners[name];
    };
    target.dispatchEvent = event => {
      event.target ||= target;
      event.currentTarget = target;
      event.preventDefault ||= () => { event.defaultPrevented = true; };
      event.stopPropagation ||= () => {};
      target['on' + event.type]?.(event);
      for (const callback of [...(callbacks.get(event.type) || [])]) callback(event);
      return !event.defaultPrevented;
    };
    return target;
  }
  function makeElement(id = '', tagName = 'DIV') {
    const capturedPointers = new Set();
    const style = {
      setProperty(name, value) { this[name] = value; },
      getPropertyValue(name) { return this[name] || ''; },
      removeProperty(name) { const old = this[name] || ''; delete this[name]; return old; },
    };
    const element = eventTarget({ id, tagName, style, dataset: {}, classList: classList(), disabled: false, textContent: '', innerHTML: '', value: '', hidden: false });
    element.closest = selector => selector.toLowerCase() === tagName.toLowerCase() ? element : element.parentElement?.closest(selector) || null;
    element.setPointerCapture = pointerId => capturedPointers.add(pointerId);
    element.releasePointerCapture = pointerId => capturedPointers.delete(pointerId);
    element.hasPointerCapture = pointerId => capturedPointers.has(pointerId);
    element.getBoundingClientRect = () => {
      const width = Number.parseFloat(style.width) || Number.parseFloat(host?.style.width) || 300;
      const headerHeight = viewport.innerWidth <= 560 ? 42 : 48;
      const collapsed = elements.get('body')?.classList.contains('hidden');
      const height = id === 'panel-header' || collapsed ? headerHeight : Number.parseFloat(style.height) || Number.parseFloat(host?.style.height) || 400;
      const left = Number.parseFloat(host?.style.left);
      const top = Number.parseFloat(host?.style.top);
      const x = Number.isFinite(left) ? left : viewport.innerWidth - 16 - width;
      const y = Number.isFinite(top) ? top : viewport.innerHeight - 16 - height;
      return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON() { return { x, y, width, height }; } };
    };
    Object.defineProperties(element, {
      clientWidth: { get: () => element.getBoundingClientRect().width },
      clientHeight: { get: () => element.getBoundingClientRect().height },
      offsetWidth: { get: () => element.getBoundingClientRect().width },
      offsetHeight: { get: () => element.getBoundingClientRect().height },
    });
    return element;
  }
  const createHost = () => {
    const hostElements = new Map();
    const shadow = {
      set innerHTML(value) {
        for (const [, id] of value.matchAll(/id="([^"]+)"/g)) {
          const tag = value.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>'))?.[0] || '';
          const element = makeElement(id, tag.match(/^<([\w-]+)/)?.[1].toUpperCase() || 'DIV');
          element.disabled = /\bdisabled\b/.test(tag);
          if (/class="[^"]*\bhidden\b/.test(tag)) element.classList.add('hidden');
          hostElements.set(id, element);
        }
        const panel = hostElements.get('panel');
        const header = hostElements.get('panel-header');
        if (header) header.parentElement = panel;
        for (const [id, element] of hostElements) {
          if (id !== 'panel' && id !== 'panel-header') element.parentElement = ['quick-stop', 'reconnect', 'collapse'].includes(id) ? header : panel;
        }
        hostElements.get('budget').value = '3500';
        if (hostElements.has('mode')) hostElements.get('mode').value = 'adaptive';
        if (hostElements.has('balance')) hostElements.get('balance').value = '0.65';
      },
      getElementById: id => hostElements.get(id),
    };
    const next = { ...makeElement(), isConnected: false, removed: false, attachShadow: () => shadow };
    next.remove = () => { next.isConnected = false; next.removed = true; };
    hosts.push(next);
    host = next;
    elements = hostElements;
    return next;
  };
  const document = eventTarget({
    hidden: false,
    createElement: createHost,
    getElementById: id => hosts.find(element => element.isConnected && element.id === id) || null,
    querySelector: selector => selector === '#xq-quick-hands' ? document.getElementById('xq-quick-hands') : null,
    querySelectorAll: selector => selector === '#xq-quick-hands' ? hosts.filter(element => element.isConnected && element.id === 'xq-quick-hands') : [],
    documentElement: { append(element) { element.isConnected = true; } },
  }, listeners);
  const window = eventTarget(viewport, listeners);
  const location = { origin: 'https://play.xiangqi.com', pathname: options.pathname || '/computer-play', reload() { reloadCount++; } };
  const invalidated = () => new Error('Extension context invalidated.');
  const runtime = {
    get id() { return runtimeFaults.id ? undefined : 'test-extension'; },
    getURL: file => { if (runtimeFaults.getURL) throw invalidated(); return `chrome-extension://test-extension/${file}`; },
    onMessage: {
      addListener(callback) { runtimeListeners.add(callback); listeners.runtime = callback; },
      removeListener(callback) { runtimeListeners.delete(callback); if (listeners.runtime === callback) delete listeners.runtime; },
    },
    async sendMessage(message) {
      calls.push(message);
      if (runtimeFaults.sendMessage) throw invalidated();
      if (message.type === 'XQ_BACKGROUND') return options.backgroundReply ? options.backgroundReply(message) : { ok: true };
      if (message.type === 'XQ_WARMUP') {
        if (options.deferInitialWarmup || (options.deferRewarm && calls.some(call => call.type === 'XQ_CANCEL'))) {
          const warmup = deferred();
          warmups.push(warmup);
          return warmup.promise;
        }
        return { ok: true, ready: true, ...(options.warmupReply || {}) };
      }
      if (message.type === 'XQ_CANCEL') return { ok: true };
      const search = deferred();
      searches.push(search);
      return search.promise;
    },
  };
  const context = vm.createContext({
    console, document, location,
    window,
    chrome: { runtime, storage: { local: {
      get: async defaults => { if (runtimeFaults.storage) throw invalidated(); return { ...defaults, ...(options.savedSettings || {}) }; },
      set: async settings => { if (runtimeFaults.storage) throw invalidated(); storageWrites.push(settings); },
    } } },
    crypto: { randomUUID: () => `request-${calls.length}` },
    performance: { now: () => now },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    XiangqiSiteAdapter: class {
      async read() {
        readCount++;
        if (readError) throw typeof readError === 'string' ? new Error(readError) : readError;
        if (deferRead) {
          deferRead = false;
          const read = deferred();
          reads.push({ ...read, snapshot: { ...state } });
          return read.promise;
        }
        return { ...state };
      }
      async play(move, snapshot, options) {
        if (options.isCancelled()) throw new Error('Cancelled');
        playAttempts.push({ move, snapshot, options });
        if (playError) throw playError;
        plays.push({ move, snapshot, options });
        state = { ...state, turn: 'black', boardKey: 'game:after-player', moveCount: 1 };
      }
      destroy() { destroyCount++; }
    },
  });
  vm.runInContext(source, context);
  await flush();
  const advance = async ms => {
    const end = now + ms;
    for (;;) {
      const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      now = entry[1].at;
      timers.delete(entry[0]);
      entry[1].callback();
      await flush();
    }
    now = end;
    await flush();
  };
  return {
    get elements() { return elements; }, get host() { return host; },
    get readCount() { return readCount; }, get destroyCount() { return destroyCount; },
    get reloadCount() { return reloadCount; },
    context, document, location, calls, reads, searches, warmups, plays, playAttempts, listeners, advance, storageWrites, hosts, timers, runtimeListeners,
    setState: next => { state = { ...state, ...next }; },
    setReadError: error => { readError = error; },
    deferNextRead: () => { deferRead = true; },
    setPlayError: error => { playError = error; },
    invalidateRuntime: (overrides = {}) => { Object.assign(runtimeFaults, { id: true, getURL: true, sendMessage: true, storage: true }, overrides); },
    restoreRuntime: () => { for (const key of Object.keys(runtimeFaults)) runtimeFaults[key] = false; },
    async reinject() { vm.runInContext(source, context); await flush(); },
    dispatch(message, respond = () => {}) {
      let handled = false;
      for (const listener of runtimeListeners) handled = listener(message, {}, respond) || handled;
      return handled;
    },
    async click(id) { const element = elements.get(id); if (!element.disabled) element.onclick(); await flush(); },
    async resolveSearch(index = 0, result = {}) { searches[index].resolve({ ok: true, bestmove: 'b1c3', depth: 12, score: { type: 'cp', value: 20 }, pv: ['b1c3', 'b10c8'], ...result }); await flush(); },
    async resolveRead(index = 0) { reads[index].resolve(reads[index].snapshot); await flush(); },
    async resolveWarmup(index = 0) { warmups[index].resolve({ ok: true, ready: true }); await flush(); },
  };
}

test('the panel identifies the engine and NNUE confirmed by warmup', async () => {
  const app = await controller({}, {warmupReply: {engine:'Pikafish 2026-09-06', nnue:'pikafish.nnue'}});
  assert.match(app.elements.get('engine-name').textContent, /Pikafish 2026-09-06.*NNUE/);
  assert.equal(app.elements.get('single').disabled, false);
  const unavailable = await controller({}, {warmupReply: {ok:false, error:'Native host is not installed'}});
  assert.equal(unavailable.elements.get('single').disabled, true);
  assert.equal(unavailable.elements.get('status').textContent, 'Native host is not installed');
  const lobby = await controller({}, {pathname:'/computer', warmupReply:{ok:false,error:'Native host is not installed'}});
  await lobby.advance(220);
  assert.equal(lobby.elements.get('status').textContent, 'Native host is not installed');
});

test('a live content script acknowledges health probes and ignores unrelated messages', async () => {
  const app = await controller();
  const replies = [];
  assert.equal(app.dispatch({ type: 'UNRELATED_MESSAGE' }, reply => replies.push(reply)), false);
  assert.equal(replies.length, 0);
  app.dispatch({ type: 'XQ_PING' }, reply => replies.push(reply));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].ok, true);
  assert.equal(replies[0].contextAlive, true);
  app.dispatch({ type: 'XQ_TOGGLE_PANEL' }, reply => replies.push(reply));
  assert.equal(replies.length, 2);
  assert.equal(replies[1].contextAlive, true);
  assert.equal(app.elements.get('body').classList.contains('hidden'), true);
});

test('idle extension invalidation pauses autoplay and stops every recurring resource', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  const readsBeforeInvalidation = app.readCount;
  app.invalidateRuntime();
  await app.advance(110);
  assert.equal(app.elements.get('status').textContent, '插件已更新，请重新连接');
  assert.equal(app.elements.get('dot').dataset.kind, 'error');
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  assert.equal(app.elements.get('auto').disabled, true);
  assert.equal(app.elements.get('single').disabled, true);
  assert.equal(app.elements.get('mode').disabled, true);
  assert.equal(app.elements.get('budget').disabled, true);
  assert.equal(app.elements.get('reconnect').disabled, false);
  assert.equal(app.elements.get('reconnect').title, '刷新棋盘重新连接');
  assert.equal(app.readCount, readsBeforeInvalidation);
  assert.equal(app.destroyCount, 1);
  assert.equal(app.listeners.visibilitychange, undefined);
  assert.equal(app.listeners.keydown, undefined);
  assert.equal(app.listeners.pagehide, undefined);
  assert.equal(app.timers.size, 0);
  const callsAfterDisposal = app.calls.length;
  await app.advance(10000);
  assert.equal(app.calls.length, callsAfterDisposal);
  assert.equal(app.readCount, readsBeforeInvalidation);
  assert.equal(app.reloadCount, 0);
  const replies = [];
  assert.equal(app.dispatch({ type: 'XQ_PING' }, reply => replies.push(reply)), false);
  assert.equal(replies.length, 0);
});

test('an invalidated sendMessage rejection disposes the panel even while runtime.id remains set', async () => {
  const app = await controller();
  app.invalidateRuntime({ id: false, getURL: false });
  await app.click('single');
  assert.equal(app.elements.get('status').textContent, '插件已更新，请重新连接');
  assert.equal(app.elements.get('single').disabled, true);
  assert.equal(app.elements.get('auto').disabled, true);
  assert.equal(app.destroyCount, 1);
  assert.equal(app.searches.length, 0);
  assert.equal(app.timers.size, 0);
  const readCount = app.readCount;
  const callCount = app.calls.length;
  await app.advance(10000);
  assert.equal(app.readCount, readCount);
  assert.equal(app.calls.length, callCount);
  assert.equal(app.reloadCount, 0);
});

test('a storage context error from changing a setting disposes the panel without an unhandled rejection', async () => {
  const app = await controller();
  app.invalidateRuntime({ id: false, getURL: false, sendMessage: false });
  app.elements.get('budget').value = '2800';
  app.elements.get('budget').onchange();
  await flush();
  assert.equal(app.elements.get('status').textContent, '插件已更新，请重新连接');
  assert.equal(app.elements.get('single').disabled, true);
  assert.equal(app.storageWrites.length, 0);
  assert.equal(app.destroyCount, 1);
  assert.equal(app.timers.size, 0);
  assert.equal(app.reloadCount, 0);
});

test('extension invalidation clears the move watchdog and discards a late engine result', async () => {
  const app = await controller();
  await app.click('auto');
  assert.equal(app.searches.length, 1);
  app.invalidateRuntime();
  await app.advance(110);
  const disposedStatus = app.elements.get('status').textContent;
  const callsAfterDisposal = app.calls.length;
  await app.resolveSearch();
  await app.advance(10000);
  assert.equal(app.plays.length, 0);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  assert.equal(app.elements.get('status').textContent, disposedStatus);
  assert.equal(app.calls.length, callsAfterDisposal);
  assert.equal(app.destroyCount, 1);
  assert.equal(app.timers.size, 0);
});

test('cancelling on a newly invalidated context preserves the terminal reconnect status', async () => {
  const app = await controller();
  await app.click('auto');
  app.invalidateRuntime();
  await app.click('quick-stop');
  assert.equal(app.elements.get('status').textContent, '插件已更新，请重新连接');
  assert.equal(app.elements.get('dot').dataset.kind, 'error');
  assert.equal(app.elements.get('reconnect').disabled, false);
  assert.equal(app.timers.size, 0);
  const callCount = app.calls.length;
  await app.resolveSearch();
  await app.advance(10000);
  assert.equal(app.calls.length, callCount);
  assert.equal(app.plays.length, 0);
});

test('a late warmup cannot reactivate an invalidated content script', async () => {
  const app = await controller({}, { deferInitialWarmup: true });
  assert.equal(app.warmups.length, 1);
  app.invalidateRuntime();
  await app.advance(110);
  await app.resolveWarmup();
  assert.equal(app.elements.get('status').textContent, '插件已更新，请重新连接');
  assert.equal(app.elements.get('single').disabled, true);
  assert.equal(app.elements.get('auto').disabled, true);
  assert.equal(app.timers.size, 0);
  assert.equal(app.reloadCount, 0);
});

test('dead-context reconnect reloads the page only after an explicit click', async () => {
  const app = await controller();
  app.invalidateRuntime();
  await app.advance(110);
  assert.equal(app.reloadCount, 0);
  const callCount = app.calls.length;
  await app.click('reconnect');
  assert.equal(app.reloadCount, 1);
  assert.equal(app.calls.length, callCount);
  assert.equal(app.searches.length, 0);
});

test('reinjection preserves one live panel and replaces a disposed panel without autoplay', async () => {
  const app = await controller();
  const originalHost = app.host;
  const originalCalls = app.calls.length;
  await app.reinject();
  assert.equal(app.hosts.length, 1);
  assert.equal(app.host, originalHost);
  assert.equal(app.calls.length, originalCalls);
  assert.equal(app.runtimeListeners.size, 1);
  await app.click('auto');
  app.invalidateRuntime();
  await app.advance(110);
  app.restoreRuntime();
  await app.reinject();
  assert.equal(originalHost.removed, true);
  assert.notEqual(app.host, originalHost);
  assert.equal(app.hosts.filter(element => element.isConnected).length, 1);
  assert.equal(app.elements.get('single').disabled, false);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  const replies = [];
  app.dispatch({ type: 'XQ_PING' }, reply => replies.push(reply));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].contextAlive, true);
  assert.equal(app.searches.length, 1);
  await app.resolveSearch();
  await app.advance(330);
  assert.equal(app.plays.length, 0);
  assert.equal(app.searches.length, 1);
  assert.equal(app.reloadCount, 0);
});

test('automatic mode waits through opponent turn and starts when our turn arrives', async () => {
  const app = await controller({ playerSide: 'black', turn: 'red' });
  await app.click('auto');
  assert.equal(app.searches.length, 0);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  app.setState({ turn: 'black', boardKey: 'game:opponent-moved', moveCount: 1 });
  await app.advance(110);
  assert.equal(app.searches.length, 1);
});

function syncError() {
  return Object.assign(new Error('局面与行棋方不同步'), { code: 'XQ_STATE_SYNC' });
}

test('automatic mode waits through a transient poll sync error and resumes on a valid board', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  app.setReadError(syncError());
  await app.advance(110);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.elements.get('auto').disabled, false);
  assert.equal(app.elements.get('single').disabled, true);
  assert.equal(app.elements.get('status').textContent, '等待棋盘同步，恢复后继续');
  assert.equal(app.elements.get('dot').dataset.kind, 'busy');
  app.setState({ turn: 'red', boardKey: 'game:opponent-moved', moveCount: 2 });
  await app.advance(1100);
  assert.equal(app.searches.length, 0);
  assert.equal(app.plays.length, 0);
  app.setReadError(null);
  await app.advance(110);
  assert.equal(app.searches.length, 1);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  await app.resolveSearch();
  assert.equal(app.plays.length, 1);
  assert.equal(app.elements.get('dot').dataset.kind, 'ready');
});

test('an initial move read sync error preserves autoplay until a valid snapshot returns', async () => {
  const app = await controller();
  app.setReadError(syncError());
  await app.click('auto');
  assert.equal(app.searches.length, 0);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.elements.get('status').textContent, '等待棋盘同步，恢复后继续');
  await app.advance(330);
  assert.equal(app.searches.length, 0);
  app.setReadError(null);
  await app.advance(110);
  assert.equal(app.searches.length, 1);
  await app.resolveSearch();
  assert.equal(app.plays.length, 1);
});

test('a sync error during a manual step never turns recovery into automatic play', async () => {
  const app = await controller();
  app.setReadError(syncError());
  await app.click('single');
  assert.equal(app.searches.length, 0);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  app.setReadError(null);
  await app.advance(330);
  assert.equal(app.searches.length, 0);
  assert.equal(app.plays.length, 0);
  assert.equal(app.elements.get('single').disabled, false);
});

test('an unclassified board read failure still pauses automatic play', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  app.setReadError(new Error('unrecognized-board-state'));
  await app.advance(110);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  assert.equal(app.elements.get('status').textContent, 'unrecognized-board-state');
  assert.equal(app.elements.get('dot').dataset.kind, 'error');
  app.setReadError(null);
  app.setState({ turn: 'red', boardKey: 'game:opponent-moved', moveCount: 2 });
  await app.advance(330);
  assert.equal(app.searches.length, 0);
});

test('persistent board sync errors keep waiting and recover automatically within the same game', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  app.setReadError(syncError());
  await app.advance(110);
  await app.advance(1980);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.searches.length, 0);
  await app.advance(110);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.elements.get('status').textContent, '等待棋盘同步，恢复后继续');
  assert.equal(app.elements.get('dot').dataset.kind, 'busy');
  app.setReadError(null);
  app.setState({ turn: 'red', boardKey: 'game:opponent-moved', moveCount: 2 });
  await app.advance(330);
  assert.equal(app.searches.length, 1);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.elements.get('single').disabled, true);
});

test('a recovered sync error starts a fresh grace period for a later board update', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  app.setReadError(syncError());
  await app.advance(1650);
  app.setReadError(null);
  await app.advance(110);
  app.setReadError(syncError());
  await app.advance(1100);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.elements.get('status').textContent, '等待棋盘同步，恢复后继续');
  assert.equal(app.searches.length, 0);
});

test('an idle read error clears its red status after a successful board read', async () => {
  const app = await controller();
  app.setReadError('board-read-failed');
  await app.advance(110);
  assert.equal(app.elements.get('status').textContent, 'board-read-failed');
  assert.equal(app.elements.get('dot').dataset.kind, 'error');
  assert.equal(app.elements.get('single').disabled, true);
  app.setReadError(null);
  await app.advance(110);
  assert.notEqual(app.elements.get('status').textContent, 'board-read-failed');
  assert.equal(app.elements.get('dot').dataset.kind, 'ready');
  assert.equal(app.elements.get('single').disabled, false);
  assert.equal(app.searches.length, 0);
});

test('pausing during a sync wait prevents recovery from restarting autoplay', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  app.setReadError(syncError());
  await app.advance(110);
  assert.equal(app.elements.get('auto').disabled, false);
  await app.click('auto');
  await app.click('pause-confirm');
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  app.setReadError(null);
  app.setState({ turn: 'red', boardKey: 'game:opponent-moved', moveCount: 2 });
  await app.advance(330);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  assert.equal(app.searches.length, 0);
  assert.equal(app.plays.length, 0);
});

test('switching game routes during a sync wait prevents recovery from inheriting autoplay', async () => {
  const app = await controller({ mode: 'online', participant: true, turn: 'black' }, { pathname: '/game/match-a' });
  await app.click('auto');
  app.setReadError(syncError());
  await app.advance(110);
  app.location.pathname = '/game/match-b';
  await app.advance(110);
  app.setReadError(null);
  app.setState({ gameKey: 'game:new', boardKey: 'game:new-opening', turn: 'red', moveCount: 0 });
  await app.advance(330);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  assert.equal(app.searches.length, 0);
  assert.equal(app.plays.length, 0);
});

test('a new game after a sync wait cannot inherit automatic play on the same route', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  app.setReadError(syncError());
  await app.advance(110);
  app.setReadError(null);
  app.setState({ gameKey: 'game:new', boardKey: 'game:new-opening', turn: 'red', moveCount: 0 });
  await app.advance(330);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  assert.equal(app.searches.length, 0);
});

test('verified online participants can analyze and move on the actual game route', async () => {
  const app = await controller({ mode: 'online', participant: true }, { pathname: '/game/match-123' });
  await app.click('single');
  assert.equal(app.searches.length, 1);
  await app.resolveSearch();
  assert.equal(app.plays.length, 1);
});

test('online automatic mode waits until the verified participant owns the turn', async () => {
  const app = await controller({ mode: 'online', participant: true, turn: 'black' }, { pathname: '/game/match-123' });
  await app.click('auto');
  assert.equal(app.searches.length, 0);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  app.setState({ turn: 'red', boardKey: 'online:after-opponent', moveCount: 2 });
  await app.advance(110);
  assert.equal(app.searches.length, 1);
});

test('online spectators and missing participant proof never enable move controls', async () => {
  for (const participant of [false, undefined]) {
    const app = await controller({ mode: 'online', participant, active: true }, { pathname: '/game/match-123' });
    assert.equal(app.elements.get('single').disabled, true);
    assert.equal(app.elements.get('auto').disabled, true);
    await app.click('single');
    await app.click('auto');
    assert.equal(app.searches.length, 0);
    assert.equal(app.plays.length, 0);
  }
});

test('revoking online participation stops waiting autoplay and reports the spectator state', async () => {
  const app = await controller({ mode: 'online', participant: true, turn: 'black' }, { pathname: '/game/match-123' });
  await app.click('auto');
  app.setState({ participant: false, playerSide: null, active: false });
  await app.advance(110);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  assert.equal(app.elements.get('single').disabled, true);
  assert.equal(app.elements.get('auto').disabled, true);
  assert.equal(app.searches.length, 0);
  assert.match(app.elements.get('status').textContent, /观战/);
});

test('online clocks cap compute time and reserve time for the board action', async () => {
  const app = await controller({ mode: 'online', participant: true, clockRemainingMs: 1800 }, { pathname: '/game/match-123' });
  await app.click('single');
  const request = app.calls.find(call => call.type === 'XQ_ANALYZE');
  assert.equal(request.movetime, 900);
  await app.resolveSearch();
  assert.equal(app.plays.length, 1);
  assert.equal(app.plays[0].options.deadline, 1600);
});

test('online clock limits refuse late results and disable expired positions', async () => {
  const app = await controller({ mode: 'online', participant: true, clockRemainingMs: 1800 }, { pathname: '/game/match-123' });
  await app.click('single');
  await app.advance(1370);
  await app.resolveSearch();
  assert.equal(app.plays.length, 0);
  assert.equal(app.calls.filter(call => call.type === 'XQ_CANCEL').length, 1);
  const expired = await controller({ mode: 'online', participant: true, clockRemainingMs: 999, active: true }, { pathname: '/game/match-123' });
  assert.equal(expired.elements.get('single').disabled, true);
  assert.equal(expired.elements.get('auto').disabled, true);
  await expired.click('single');
  assert.equal(expired.searches.length, 0);
});

test('complete move history is forwarded from a verified board snapshot', async () => {
  const moves = ['b1c3', 'b10c8'];
  const app = await controller({ mode: 'online', participant: true, initFen: START, moves }, { pathname: '/game/match-123' });
  await app.click('single');
  const request = app.calls.find(call => call.type === 'XQ_ANALYZE');
  assert.equal(request.initialFen, START);
  assert.deepEqual(request.moves, moves);
});

test('lobby pages without a verified board never authorize an engine search', async () => {
  const app = await controller({}, { pathname: '/play', adapterError: 'board-not-ready' });
  assert.equal(app.elements.get('single').disabled, true);
  assert.equal(app.elements.get('auto').disabled, true);
  await app.click('single');
  assert.equal(app.searches.length, 0);
});

test('adaptive mode forwards its selected importance balance and upper time limit', async () => {
  const app = await controller();
  await app.click('single');
  const request = app.calls.find(call => call.type === 'XQ_ANALYZE');
  assert.equal(request.mode, 'adaptive');
  assert.equal(request.balance, 0.65);
  assert.equal(request.movetime, 3500);
  assert.equal(app.elements.get('mode').disabled, false);
  assert.equal(app.elements.get('budget').disabled, false);
  assert.equal(app.elements.get('balance').disabled, true);
});

test('search mode and maximum compute time can change while automatic play waits for the opponent', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  assert.equal(app.elements.get('mode').disabled, false);
  assert.equal(app.elements.get('budget').disabled, false);
  const statusBeforeChange = app.elements.get('status').textContent;
  app.elements.get('mode').value = 'fixed';
  app.elements.get('mode').onchange();
  app.elements.get('budget').value = '1800';
  app.elements.get('budget').onchange();
  assert.equal(app.elements.get('status').textContent, statusBeforeChange);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.elements.get('pause-request').classList.contains('hidden'), true);
  assert.equal(app.calls.some(call => call.type === 'XQ_CANCEL'), false);
  app.setState({ turn: 'red', boardKey: 'game:opponent-moved', moveCount: 2 });
  await app.advance(110);
  const request = app.calls.find(call => call.type === 'XQ_ANALYZE');
  assert.equal(request.mode, 'fixed');
  assert.equal(request.movetime, 1800);
});

test('live search-setting edits preserve the current calculation, apply next automatic turn, and survive reload', async () => {
  const app = await controller();
  await app.click('auto');
  const firstRequest = app.calls.find(call => call.type === 'XQ_ANALYZE');
  assert.equal(app.elements.get('mode').disabled, false);
  assert.equal(app.elements.get('budget').disabled, false);
  const statusBeforeChange = app.elements.get('status').textContent;
  app.elements.get('mode').value = 'fixed';
  app.elements.get('mode').onchange();
  app.elements.get('budget').value = '800';
  app.elements.get('budget').onchange();
  await flush();
  assert.equal(firstRequest.mode, 'adaptive');
  assert.equal(firstRequest.movetime, 3500);
  assert.equal(app.searches.length, 1);
  assert.equal(app.elements.get('status').textContent, statusBeforeChange);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.elements.get('pause-request').classList.contains('hidden'), true);
  assert.equal(app.calls.some(call => call.type === 'XQ_CANCEL'), false);
  await app.resolveSearch();
  assert.equal(app.plays.length, 1);
  app.setState({ turn: 'red', boardKey: 'game:next-player-turn', moveCount: 2 });
  await app.advance(110);
  const nextRequest = app.calls.filter(call => call.type === 'XQ_ANALYZE')[1];
  assert.equal(nextRequest.mode, 'fixed');
  assert.equal(nextRequest.movetime, 800);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.calls.some(call => call.type === 'XQ_CANCEL'), false);
  const savedSettings = Object.assign({}, ...app.storageWrites);
  assert.equal(savedSettings.mode, 'fixed');
  assert.equal(savedSettings.movetime, 800);
  const restored = await controller({}, { savedSettings });
  assert.equal(restored.elements.get('mode').value, 'fixed');
  assert.equal(restored.elements.get('budget').value, '800');
  await restored.click('single');
  const restoredRequest = restored.calls.find(call => call.type === 'XQ_ANALYZE');
  assert.equal(restoredRequest.mode, 'fixed');
  assert.equal(restoredRequest.movetime, 800);
});

test('a step captures search settings before its initial asynchronous board read', async () => {
  const app = await controller();
  app.deferNextRead();
  await app.click('auto');
  assert.equal(app.reads.length, 1);
  assert.equal(app.searches.length, 0);
  assert.equal(app.elements.get('mode').disabled, false);
  assert.equal(app.elements.get('budget').disabled, false);
  app.elements.get('mode').value = 'fixed';
  app.elements.get('mode').onchange();
  app.elements.get('budget').value = '2800';
  app.elements.get('budget').onchange();
  await app.resolveRead();
  const request = app.calls.find(call => call.type === 'XQ_ANALYZE');
  assert.equal(request.mode, 'adaptive');
  assert.equal(request.movetime, 3500);
  assert.equal(request.balance, 0.65);
  await app.resolveSearch();
  app.setState({ turn: 'red', boardKey: 'game:next-player-turn', moveCount: 2 });
  await app.advance(110);
  const nextRequest = app.calls.filter(call => call.type === 'XQ_ANALYZE')[1];
  assert.equal(nextRequest.mode, 'fixed');
  assert.equal(nextRequest.movetime, 2800);
  assert.equal(app.calls.some(call => call.type === 'XQ_CANCEL'), false);
});

test('increasing maximum compute time during automatic play still respects the next turn clock reserve', async () => {
  const app = await controller({ mode: 'online', participant: true, clockRemainingMs: 5000 }, { pathname: '/game/match-123', savedSettings: { movetime: 800 } });
  await app.click('auto');
  app.elements.get('mode').value = 'fixed';
  app.elements.get('mode').onchange();
  app.elements.get('budget').value = '3500';
  app.elements.get('budget').onchange();
  await app.resolveSearch();
  app.setState({ turn: 'red', boardKey: 'game:next-player-turn', moveCount: 2, clockRemainingMs: 1800 });
  await app.advance(110);
  const requests = app.calls.filter(call => call.type === 'XQ_ANALYZE');
  assert.equal(requests[0].movetime, 800);
  assert.equal(requests[1].mode, 'fixed');
  assert.equal(requests[1].movetime, 900);
  await app.resolveSearch(1);
  assert.equal(app.plays.length, 2);
  assert.equal(app.plays[1].options.deadline, 1710);
  assert.equal(app.calls.some(call => call.type === 'XQ_CANCEL'), false);
});

test('fixed mode and changed balance propagate from the panel to analysis', async () => {
  const app = await controller();
  app.elements.get('mode').value = 'fixed';
  app.elements.get('balance').value = '0.2';
  app.elements.get('budget').value = '1800';
  await app.click('single');
  const request = app.calls.find(call => call.type === 'XQ_ANALYZE');
  assert.equal(request.mode, 'fixed');
  assert.equal(request.balance, 0.2);
  assert.equal(request.movetime, 1800);
});

test('saved adaptive preferences are restored before a search', async () => {
  const app = await controller({}, { savedSettings: { mode: 'fixed', balance: 0.9, movetime: 2800 } });
  await app.click('single');
  const request = app.calls.find(call => call.type === 'XQ_ANALYZE');
  assert.equal(request.mode, 'fixed');
  assert.equal(request.balance, 0.9);
  assert.equal(request.movetime, 2800);
});

test('adaptive settings persist and fixed mode hides the balance control', async () => {
  const app = await controller();
  app.elements.get('mode').value = 'fixed';
  app.elements.get('mode').onchange();
  assert.equal(app.elements.get('balance-row').classList.contains('hidden'), true);
  app.elements.get('balance').value = '0.85';
  app.elements.get('balance').oninput();
  app.elements.get('balance').onchange();
  await flush();
  assert.ok(app.storageWrites.some(settings => settings.mode === 'fixed'));
  assert.ok(app.storageWrites.some(settings => settings.balance === 0.85));
  assert.match(app.elements.get('balance-label').textContent, /85%/);
});

test('operation variation defaults on, persists the toggle, and reaches board actions', async () => {
  const app = await controller();
  assert.equal(app.elements.get('vary-operations').checked, true);
  await app.click('single');
  assert.equal(app.elements.get('vary-operations').disabled, false);
  await app.resolveSearch();
  assert.equal(app.plays[0].options.varyOperations, true);
  assert.equal(app.elements.get('vary-operations').disabled, false);
  app.elements.get('vary-operations').checked = false;
  app.elements.get('vary-operations').onchange();
  await flush();
  assert.ok(app.storageWrites.some(settings => settings.varyOperations === false));
  const restored = await controller({}, { savedSettings: { varyOperations: false } });
  await restored.click('single');
  await restored.resolveSearch();
  assert.equal(restored.plays[0].options.varyOperations, false);
});

test('the main panel toggle can change during a search and applies to the following step', async () => {
  const app = await controller();
  await app.click('single');
  const toggle = app.elements.get('vary-operations');
  assert.equal(toggle.disabled, false);
  toggle.checked = false;
  toggle.onchange();
  await app.resolveSearch();
  assert.equal(app.plays[0].options.varyOperations, true, 'The current operation keeps its captured choice');
  app.setState({ turn: 'red', boardKey: 'game:next-player-turn', moveCount: 2 });
  await app.advance(110);
  await app.click('single');
  await app.resolveSearch(1);
  assert.equal(app.plays[1].options.varyOperations, false, 'The next operation uses the latest choice');
  assert.ok(app.storageWrites.some(settings => settings.varyOperations === false));
});

test('adaptive result displays importance and its allocated compute budget', async () => {
  const app = await controller();
  await app.click('single');
  await app.resolveSearch(0, {
    importance: 0.723, allocatedMs: 1980, reason: ['close-candidates', 'unstable-principal'],
  });
  assert.equal(app.plays.length, 1);
  assert.match(app.elements.get('importance').textContent, /72/);
  assert.match(app.elements.get('allocated').textContent, /1\.98/);
  assert.ok(app.elements.get('importance').title.length > 0);
});

test('pausing cancels the search and discards a late engine response', async () => {
  const app = await controller();
  await app.click('auto');
  assert.equal(app.searches.length, 1);
  await app.click('auto');
  await app.click('pause-confirm');
  assert.equal(app.calls.filter(call => call.type === 'XQ_CANCEL').length, 1);
  await app.resolveSearch();
  assert.equal(app.plays.length, 0);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
});

test('single-step control prevents overlapping requests', async () => {
  const app = await controller();
  await app.click('single');
  await app.click('single');
  assert.equal(app.searches.length, 1);
  await app.resolveSearch();
  assert.equal(app.plays.length, 1);
  assert.equal(app.plays[0].options.deadline, 4900);
  assert.match(app.elements.get('pv').textContent, /b1c3.*b10c8/);
});

test('shallow searches stop without moving unless they prove a positive mate', async () => {
  const shallow = await controller();
  await shallow.click('single');
  await shallow.resolveSearch(0, { depth: 5 });
  assert.equal(shallow.plays.length, 0);
  assert.equal(shallow.elements.get('dot').dataset.kind, 'error');

  const knownMate = await controller();
  await knownMate.click('single');
  await knownMate.resolveSearch(0, { depth: 1, score: { type: 'mate', value: 2 } });
  assert.equal(knownMate.plays.length, 1);

  const losingMate = await controller();
  await losingMate.click('single');
  await losingMate.resolveSearch(0, { depth: 1, score: { type: 'mate', value: -2 } });
  assert.equal(losingMate.plays.length, 0);

  const sufficient = await controller();
  await sufficient.click('single');
  await sufficient.resolveSearch(0, { depth: 6 });
  assert.equal(sufficient.plays.length, 1);
});

test('cancellation finishes prewarming before move controls become available again', async () => {
  const app = await controller({}, { deferRewarm: true });
  await app.click('auto');
  await app.click('auto');
  await app.click('pause-confirm');
  await flush();
  assert.equal(app.warmups.length, 1);
  assert.equal(app.elements.get('auto').disabled, true);
  assert.equal(app.elements.get('single').disabled, true);
  await app.click('single');
  assert.equal(app.searches.length, 1);
  await app.resolveWarmup();
  assert.equal(app.elements.get('single').disabled, false);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  await app.resolveSearch();
  assert.equal(app.plays.length, 0);
});

test('repeated clicks on either pause entry only request confirmation while the current search continues', async () => {
  const app = await controller();
  await app.click('auto');
  for (const button of ['auto', 'auto', 'quick-stop', 'quick-stop']) await app.click(button);
  assert.equal(app.elements.get('pause-request').classList.contains('hidden'), false);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.calls.filter(call => call.type === 'XQ_CANCEL').length, 0);
  await app.resolveSearch();
  assert.equal(app.plays.length, 1);
  await app.click('pause-confirm');
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  assert.equal(app.elements.get('pause-request').classList.contains('hidden'), true);
  assert.match(app.elements.get('stop-reason').textContent, /手动确认/);
});

test('Escape and continue both dismiss a pause request without cancelling automatic play', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  await app.click('quick-stop');
  app.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  await flush();
  assert.equal(app.elements.get('pause-request').classList.contains('hidden'), true);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  await app.click('quick-stop');
  await app.click('pause-cancel');
  assert.equal(app.elements.get('pause-request').classList.contains('hidden'), true);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.calls.filter(call => call.type === 'XQ_CANCEL').length, 0);
});

test('an expired pause request closes without stopping and its stale confirm cannot pause the game', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  await app.click('quick-stop');
  await app.advance(8001);
  assert.equal(app.elements.get('pause-request').classList.contains('hidden'), true);
  await app.click('pause-confirm');
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.calls.filter(call => call.type === 'XQ_BACKGROUND').at(-1).active, true);
});

test('collapsing the panel keeps play running and the separate confirmation remains available', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  await app.click('collapse');
  assert.equal(app.elements.get('body').classList.contains('hidden'), true);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  await app.click('quick-stop');
  assert.equal(app.elements.get('pause-request').classList.contains('hidden'), false);
  await app.click('pause-confirm');
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
});

test('reconnect is disabled during automatic play so an accidental reconnect cannot bypass pause confirmation', async () => {
  const app = await controller();
  await app.click('auto');
  const warmups = app.calls.filter(call => call.type === 'XQ_WARMUP').length;
  assert.equal(app.elements.get('reconnect').disabled, true);
  await app.click('reconnect');
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.calls.filter(call => call.type === 'XQ_CANCEL').length, 0);
  assert.equal(app.calls.filter(call => call.type === 'XQ_WARMUP').length, warmups);
});

test('recognized board read interruptions wait and resume in the same game without a manual restart', async () => {
  for (const code of ['XQ_READ_TIMEOUT', 'XQ_BOARD_NOT_READY']) {
    const app = await controller({ turn: 'black' });
    await app.click('auto');
    app.setReadError(Object.assign(new Error('temporary board read'), { code }));
    await app.advance(2200);
    assert.equal(app.elements.get('auto').classList.contains('running'), true, code);
    assert.equal(app.searches.length, 0, code);
    app.setReadError(null);
    app.setState({ turn: 'red', boardKey: 'game:recovered' });
    await app.advance(700);
    assert.equal(app.searches.length, 1, code);
  }
});

test('disconnect, pending premove and board loading wait for recovery without dropping automatic mode', async () => {
  for (const condition of [{ connected: false }, { hasPreMove: true }, { loading: true }]) {
    const app = await controller({ turn: 'black' });
    await app.click('auto');
    app.setState({ ...condition, active: false, turn: 'red' });
    await app.advance(2200);
    assert.equal(app.elements.get('auto').classList.contains('running'), true, JSON.stringify(condition));
    assert.equal(app.searches.length, 0);
    app.setState({ connected: true, hasPreMove: false, loading: false, active: true });
    await app.advance(110);
    assert.equal(app.searches.length, 1);
  }
});

test('a modal before destination delivery retries after recovery using a fresh computation', async () => {
  const error = Object.assign(new Error('棋盘被弹窗遮挡'), { code: 'XQ_BOARD_OBSCURED', actionStage: 'selected' });
  const app = await controller({}, { playError: error });
  await app.click('auto');
  await app.resolveSearch();
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.playAttempts.length, 1);
  assert.equal(app.plays.length, 0);
  await app.advance(550);
  assert.equal(app.searches.length, 1);
  app.setPlayError(null);
  await app.advance(110);
  assert.equal(app.searches.length, 2);
  await app.resolveSearch(1);
  assert.equal(app.plays.length, 1);
});

test('a read failure after destination dispatch stops and cannot replay the old position automatically', async () => {
  const error = Object.assign(new Error('落子确认超时'), { code: 'XQ_READ_TIMEOUT', actionStage: 'destination-dispatched' });
  const app = await controller({}, { playError: error });
  await app.click('auto');
  await app.resolveSearch();
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  assert.equal(app.playAttempts.length, 1);
  assert.match(app.elements.get('stop-reason').textContent, /落子确认超时/);
  app.setPlayError(null);
  await app.advance(3000);
  assert.equal(app.searches.length, 1);
  assert.equal(app.playAttempts.length, 1);
});

test('the five-second watchdog cancels a hung engine without moving', async () => {
  const app = await controller();
  await app.click('single');
  await app.advance(5000);
  assert.equal(app.calls.filter(call => call.type === 'XQ_CANCEL').length, 1);
  assert.equal(app.plays.length, 0);
  assert.equal(app.elements.get('dot').dataset.kind, 'error');
  await app.resolveSearch();
  assert.equal(app.plays.length, 0);
});

test('engine responses after the action reserve are refused', async () => {
  const app = await controller();
  await app.click('single');
  await app.advance(4450);
  await app.resolveSearch();
  assert.equal(app.plays.length, 0);
  assert.equal(app.calls.filter(call => call.type === 'XQ_CANCEL').length, 1);
});

test('leaving supported game routes cancels autoplay and never applies its late result', async () => {
  const app = await controller();
  await app.click('auto');
  app.location.pathname = '/analysis';
  await app.advance(110);
  await app.resolveSearch();
  assert.equal(app.plays.length, 0);
  assert.equal(app.calls.filter(call => call.type === 'XQ_CANCEL').length, 1);
});

test('switching between online game routes cancels the old search and keeps the new game paused', async () => {
  const app = await controller({ mode: 'online', participant: true }, { pathname: '/game/match-a' });
  await app.click('auto');
  app.location.pathname = '/game/match-b';
  app.setState({ gameKey: 'game:new', boardKey: 'game:new-opening' });
  await app.advance(110);
  assert.equal(app.calls.filter(call => call.type === 'XQ_CANCEL').length, 1);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  await app.resolveSearch();
  await app.advance(110);
  assert.equal(app.plays.length, 0);
  assert.equal(app.searches.length, 1);
});

test('a new computer game on the same route cannot inherit automatic play', async () => {
  const app = await controller({ turn: 'black' });
  await app.click('auto');
  app.setState({ gameKey: 'game:new', boardKey: 'game:new-opening', turn: 'red', moveCount: 0 });
  await app.advance(110);
  assert.equal(app.elements.get('auto').classList.contains('running'), false);
  assert.equal(app.searches.length, 0);
});

test('hiding the tab preserves the explicitly started search and its deadline', async () => {
  const app = await controller();
  await app.click('single');
  app.document.hidden = true;
  app.listeners.visibilitychange();
  await app.resolveSearch();
  assert.equal(app.plays.length, 1);
  assert.equal(app.calls.filter(call => call.type === 'XQ_CANCEL').length, 0);
  const subscriptions = app.calls.filter(call => call.type === 'XQ_BACKGROUND');
  assert.deepEqual(subscriptions.map(call => call.active), [true, false]);
  assert.equal(subscriptions[0].sessionId, subscriptions[1].sessionId);
});

test('background pulses only advance an explicitly active session and cannot restart a paused panel', async () => {
  const app = await controller({ turn: 'black' });
  app.document.hidden = true;
  await app.click('auto');
  const subscription = app.calls.find(call => call.type === 'XQ_BACKGROUND' && call.active);
  assert.ok(subscription);
  app.setState({ turn: 'red' });
  const replies = [];
  for (const sender of [{ id: 'foreign' }, { id: 'test-extension', tab: { id: 1 } }]) {
    for (const callback of app.runtimeListeners) callback({ type: 'XQ_BACKGROUND_PULSE', sessionId: subscription.sessionId }, sender, reply => replies.push(reply));
  }
  assert.equal(replies.length, 0);
  assert.equal(app.searches.length, 0);
  for (const callback of app.runtimeListeners) callback({ type: 'XQ_BACKGROUND_PULSE', sessionId: 'stale-session' }, { id: 'test-extension' }, reply => replies.push(reply));
  assert.equal(replies.length, 0);
  for (let i = 0; i < 3; i++) for (const callback of app.runtimeListeners) callback({ type: 'XQ_BACKGROUND_PULSE', sessionId: subscription.sessionId }, { id: 'test-extension' }, reply => replies.push(reply));
  await flush();
  assert.equal(app.searches.length, 1);
  assert.ok(replies.every(reply => reply.active));
  await app.click('auto');
  await app.click('pause-confirm');
  await app.resolveSearch();
  for (const callback of app.runtimeListeners) callback({ type: 'XQ_BACKGROUND_PULSE', sessionId: subscription.sessionId }, { id: 'test-extension' }, reply => replies.push(reply));
  await flush();
  assert.equal(replies.at(-1).active, false);
  assert.equal(app.plays.length, 0);
  assert.equal(app.searches.length, 1);
});

test('hidden sessions reject late engine results and unsubscribe on disposal', async () => {
  const app = await controller();
  app.document.hidden = true;
  await app.click('single');
  await app.advance(4500);
  await app.resolveSearch();
  assert.equal(app.plays.length, 0);
  assert.match(app.elements.get('status').textContent, /超时/);
  assert.equal(app.calls.filter(call => call.type === 'XQ_BACKGROUND').at(-1).active, false);
  const waiting = await controller({ turn: 'black' });
  await waiting.click('auto');
  waiting.context.__xiangqiQuickHands.destroy();
  await flush();
  assert.equal(waiting.calls.filter(call => call.type === 'XQ_BACKGROUND').at(-1).active, false);
  assert.equal(waiting.listeners.pointermove, undefined);
  assert.equal(waiting.listeners.resize, undefined);
});

test('active sessions retry a failed or declined background subscription and renew acknowledged subscriptions', async () => {
  for (const firstOutcome of ['failed', 'declined']) {
    let activeRequests = 0;
    const app = await controller({ turn: 'black' }, { backgroundReply: message => {
      if (message.active && ++activeRequests === 1) {
        if (firstOutcome === 'failed') throw new Error('Temporary service worker startup failure');
        return { ok: true, active: false };
      }
      return { ok: true, active: message.active };
    } });
    await app.click('auto');
    await app.advance(330);
    assert.ok(activeRequests >= 2, firstOutcome);
    const acknowledgedCount = activeRequests;
    await app.advance(2200);
    assert.ok(activeRequests > acknowledgedCount, 'acknowledged sessions still renew after two seconds');
    assert.equal(app.searches.length, 0);
    await app.click('auto');
    await app.click('pause-confirm');
    const pausedCount = activeRequests;
    await app.advance(5000);
    assert.equal(activeRequests, pausedCount, 'paused sessions must not keep renewing');
    assert.equal(app.elements.get('auto').classList.contains('running'), false);
  }
});

test('a late background subscription acknowledgement cannot revive or suppress the next user session', async () => {
  const gate = deferred();
  let first = true;
  const app = await controller({ turn: 'black' }, { backgroundReply: message => {
    if (message.active && first) { first = false; return gate.promise; }
    return { ok: true, active: message.active };
  } });
  await app.click('auto');
  await app.click('auto');
  await app.click('pause-confirm');
  await app.click('auto');
  const before = app.calls.filter(call => call.type === 'XQ_BACKGROUND');
  assert.deepEqual(before.map(call => call.active), [true, false, true]);
  gate.resolve({ ok: true, active: false });
  await flush();
  await app.advance(110);
  assert.equal(app.calls.filter(call => call.type === 'XQ_BACKGROUND').length, before.length);
  assert.equal(app.elements.get('auto').classList.contains('running'), true);
  assert.equal(app.searches.length, 0);
});

test('background status probes authenticate the extension and report activity without starting or resuming it', async () => {
  const app = await controller({ turn: 'black' });
  const replies = [];
  const probe = sender => {
    for (const callback of app.runtimeListeners) callback({ type: 'XQ_BACKGROUND_STATUS' }, sender, reply => replies.push(reply));
  };
  probe({ id: 'foreign' });
  probe({ id: 'test-extension', tab: { id: 7 } });
  assert.equal(replies.length, 0);
  probe({ id: 'test-extension' });
  assert.equal(replies.at(-1).active, false);
  assert.ok(replies.at(-1).sessionId);
  assert.equal(app.calls.filter(call => call.type === 'XQ_BACKGROUND').length, 0);
  await app.click('auto');
  probe({ id: 'test-extension' });
  assert.equal(replies.at(-1).active, true);
  await app.click('auto');
  await app.click('pause-confirm');
  probe({ id: 'test-extension' });
  assert.equal(replies.at(-1).active, false);
  assert.equal(app.searches.length, 0);
  app.location.pathname = '/settings';
  probe({ id: 'test-extension' });
  assert.equal(replies.at(-1).active, false);
});

test('history mode and completed games disable move controls', async () => {
  const replay = await controller({ historyMode: true });
  assert.equal(replay.elements.get('single').disabled, true);
  assert.equal(replay.elements.get('auto').disabled, true);
  const ended = await controller({ active: false });
  assert.equal(ended.elements.get('single').disabled, true);
  assert.equal(ended.elements.get('auto').disabled, true);
});

test('analysis boards offer an explicit suggestion without enabling autoplay or dispatching a move', async () => {
  for (const pathname of ['/analysis/board', '/review/game-one', '/note/view/note-one', '/lessons/notes/lesson-one', '/learn/rules', '/editor', '/game-database/example/en', '/watch/game-one']) {
    const app = await controller({ mode: 'analysis', canAnalyze: true, participant: false, active: false, viewOnly: true }, { pathname });
    assert.equal(app.elements.get('auto').disabled, true, pathname);
    assert.equal(app.elements.get('single').disabled, false, pathname);
    assert.match(app.elements.get('single').innerHTML, /分析局面/, pathname);
    assert.equal(app.searches.length, 0, 'opening an analysis page must not start searching');
    await app.click('single');
    assert.equal(app.searches.length, 1, pathname);
    await app.resolveSearch();
    assert.equal(app.plays.length, 0, pathname);
    assert.equal(app.elements.get('move').textContent, 'b1c3', pathname);
    assert.match(app.elements.get('status').textContent, /分析完成.*未落子/, pathname);
    await app.advance(220);
    assert.equal(app.searches.length, 1, 'analysis is a one-shot request');
    assert.equal(app.calls.filter(call => call.type === 'XQ_BACKGROUND').at(-1).active, false);
  }
});

test('an analysis suggestion is discarded when the displayed position changes during search', async () => {
  const app = await controller({ mode: 'analysis', canAnalyze: true, participant: false, active: false, viewOnly: true }, { pathname: '/analysis/board' });
  await app.click('single');
  app.setState({ boardKey: 'analysis:changed-position' });
  await app.resolveSearch();
  assert.equal(app.plays.length, 0);
  assert.equal(app.elements.get('move').textContent, '');
  assert.match(app.elements.get('status').textContent, /局面已变化/);
});

test('puzzle play can take an explicitly requested step while completed and rejected puzzles disable move controls', async () => {
  for (const pathname of ['/puzzle/ordinary-one', '/puzzle/ordinary-one/P', '/puzzle/ordinary-one/C', '/puzzle/race/race-one']) {
    const app = await controller({ mode: 'puzzle', puzzleRace: pathname.includes('/race/'), gameKey: 'puzzle:one', boardKey: 'puzzle:one:opening' }, { pathname });
    assert.equal(app.elements.get('single').disabled, false, pathname);
    assert.equal(app.searches.length, 0);
    await app.click('single');
    await app.resolveSearch();
    assert.equal(app.plays.length, 1, pathname);
  }
  for (const state of [{ puzzleCompleted: true }, { puzzleWrong: true }]) {
    const app = await controller({ mode: 'puzzle', active: false, ...state }, { pathname: '/puzzle/ordinary-one' });
    assert.equal(app.elements.get('single').disabled, true);
    assert.equal(app.elements.get('auto').disabled, true);
    assert.equal(app.searches.length, 0);
  }
});

test('a completed or rejected puzzle stops waiting autoplay and cannot continue into another step', async () => {
  for (const endState of [{ puzzleCompleted: true }, { puzzleWrong: true }]) {
    const app = await controller({ mode: 'puzzle', turn: 'black', gameKey: 'puzzle:one' }, { pathname: '/puzzle/ordinary-one/P' });
    await app.click('auto');
    app.setState({ ...endState, active: false, turn: 'red' });
    await app.advance(110);
    assert.equal(app.elements.get('auto').classList.contains('running'), false);
    assert.equal(app.searches.length, 0);
    assert.equal(app.calls.filter(call => call.type === 'XQ_BACKGROUND').at(-1).active, false);
    app.setState({ puzzleCompleted: false, puzzleWrong: false, active: true });
    await app.advance(220);
    assert.equal(app.searches.length, 0, 'a puzzle result must require a new explicit start');
  }
});

test('changing puzzle identity or navigating to the next puzzle cannot inherit autoplay', async () => {
  for (const changedRoute of [false, true]) {
    const app = await controller({ mode: 'puzzle', turn: 'black', gameKey: 'puzzle:one', boardKey: 'puzzle:one:opening' }, { pathname: '/puzzle/ordinary-one/P' });
    await app.click('auto');
    if (changedRoute) app.location.pathname = '/puzzle/ordinary-two/P';
    app.setState({ gameKey: 'puzzle:two', boardKey: 'puzzle:two:opening', turn: 'red' });
    await app.advance(110);
    assert.equal(app.elements.get('auto').classList.contains('running'), false);
    assert.equal(app.searches.length, 0);
    assert.equal(app.plays.length, 0);
  }
});

function background(options = {}) {
  const listeners = {};
  const calls = [];
  const pending = deferred();
  const tabUrls = new Map();
  const context = vm.createContext({
    console, URL,
    analyze: options => { calls.push({ type: 'analyze', options }); return pending.promise; },
    warmup: async () => { calls.push({ type: 'warmup' }); return { ready: true, ...(options.warmupResult || {}) }; },
    cancel: async () => { calls.push({ type: 'cancel' }); },
    chrome: {
      runtime: {
        id: 'test-extension',
        onMessage: { addListener: callback => { listeners.message = callback; } },
        onInstalled: { addListener: callback => { listeners.installed = callback; } },
        onStartup: { addListener: callback => { listeners.startup = callback; } },
      },
      action: { onClicked: { addListener: callback => { listeners.action = callback; } } },
      tabs: {
        get: async tabId => {
          if (options.tabLookupError) throw new Error(options.tabLookupError);
          return { id: tabId, url: options.liveTabUrl || tabUrls.get(tabId) };
        },
        onRemoved: { addListener: callback => { listeners.removed = callback; } },
      },
    },
  });
  vm.runInContext(backgroundSource, context);
  const sender = { id: 'test-extension', frameId: 0, tab: { id: 7 }, url: 'https://play.xiangqi.com/computer-play' };
  function dispatch(message, from = sender, respond = () => {}) {
    if (from.tab) tabUrls.set(from.tab.id, from.tab.url || from.url);
    return listeners.message(message, from, respond);
  }
  return {
    calls, pending, sender, dispatch,
    send(message, from = sender) { return new Promise(resolve => dispatch(message, from, resolve)); },
  };
}

test('background forwards the actual warmed engine identity and NNUE network', async () => {
  const app = background({warmupResult: {name:'Pikafish 2026-09-06', nnue:'pikafish.nnue'}});
  const result = await app.send({type:'XQ_WARMUP'});
  assert.equal(result.engine, 'Pikafish 2026-09-06');
  assert.equal(result.nnue, 'pikafish.nnue');
});

test('background leaves internal offscreen engine messages unanswered', async () => {
  const app = background();
  const responses = [];
  const internalSender = { id: app.sender.id, url: 'chrome-extension://test-extension/offscreen.html' };
  for (const type of ['XQ_ENGINE_WARMUP', 'XQ_ENGINE_ANALYZE', 'XQ_ENGINE_CANCEL']) {
    assert.equal(app.dispatch({ target: 'offscreen', type }, internalSender, response => responses.push(response)), false);
  }
  await flush();
  assert.equal(responses.length, 0);
  assert.equal(app.calls.length, 0);
});

test('background authorizes the live board after same-origin SPA navigation from a lobby', async () => {
  for (const originalPath of ['/', '/computer', '/play']) {
    const app = background({ liveTabUrl: 'https://play.xiangqi.com/computer-play' });
    const originalUrl = 'https://play.xiangqi.com' + originalPath;
    const from = { ...app.sender, url: originalUrl, tab: { id: app.sender.tab.id, url: originalUrl } };
    const response = app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'spa-navigation' }, from);
    await flush();
    app.pending.resolve({ bestmove: 'b1c3' });
    assert.equal((await response).ok, true, 'current board must authorize analysis after navigating from ' + originalPath);
    assert.equal(app.calls.filter(call => call.type === 'analyze').length, 1);
  }
});

test('background refuses stale board senders after the live tab leaves the board', async () => {
  for (const currentUrl of ['https://play.xiangqi.com/computer', 'https://play.xiangqi.com/analysis', 'https://example.com/computer-play']) {
    const app = background({ liveTabUrl: currentUrl });
    app.pending.resolve({ bestmove: 'b1c3' });
    const from = { ...app.sender, tab: { ...app.sender.tab, url: app.sender.url } };
    const result = await app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'stale-board' }, from);
    assert.equal(result.ok, false, 'live tab route must take precedence over the stale sender board URL');
    assert.equal(app.calls.filter(call => call.type === 'analyze').length, 0);
  }
});

test('a live supported board never bypasses sender origin and top-frame authentication', async () => {
  const app = background({ liveTabUrl: 'https://play.xiangqi.com/computer-play' });
  const command = { type: 'XQ_ANALYZE', fen: START, requestId: 'live-board-authentication' };
  for (const from of [
    { ...app.sender, url: 'https://play.xiangqi.com.evil.test/computer-play' },
    { ...app.sender, url: 'http://play.xiangqi.com/computer-play' },
    { ...app.sender, origin: 'https://example.com' },
    { ...app.sender, origin: 'null' },
    { ...app.sender, frameId: 1 },
    { ...app.sender, id: 'another-extension' },
  ]) {
    assert.equal((await app.send(command, from)).ok, false);
  }
  assert.equal(app.calls.length, 0);
});

test('background refuses analysis when the live tab URL cannot be verified', async () => {
  const app = background({ tabLookupError: 'No tab with id: 7.' });
  app.pending.resolve({ bestmove: 'b1c3' });
  const result = await app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'closed-tab' });
  assert.equal(result.ok, false);
  assert.equal(app.calls.length, 0);
});

test('background refuses analysis on unsupported routes, foreign origins and subframes', async () => {
  const app = background();
  const command = { type: 'XQ_ANALYZE', fen: START, requestId: 'test', movetime: 9999 };
  assert.equal((await app.send(command, { ...app.sender, url: 'https://play.xiangqi.com/analysis' })).ok, false);
  assert.equal((await app.send(command, { ...app.sender, url: 'https://play.xiangqi.com/game/' })).ok, false);
  assert.equal((await app.send(command, { ...app.sender, url: 'https://play.xiangqi.com/game/id/extra' })).ok, false);
  assert.equal((await app.send(command, { ...app.sender, url: 'https://play.xiangqi.com.evil.test/game/id' })).ok, false);
  assert.equal((await app.send(command, { ...app.sender, frameId: 1 })).ok, false);
  assert.equal((await app.send(command, { ...app.sender, id: 'another-extension' })).ok, false);
  assert.equal(app.calls.length, 0);
});

test('background accepts analysis from the verified online game route', async () => {
  const app = background();
  const response = app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'online', mode: 'adaptive', balance: 0.65 }, {
    ...app.sender, url: 'https://play.xiangqi.com/game/match-123',
  });
  await flush();
  assert.equal(app.calls[0].type, 'analyze');
  app.pending.resolve({ bestmove: 'b1c3' });
  assert.equal((await response).ok, true);
});

test('background authorizes verified puzzle and read-only board routes for engine suggestions', async () => {
  for (const pathname of ['/puzzle/ordinary-one', '/puzzle/ordinary-one/P', '/puzzle/ordinary-one/C', '/puzzle/race/race-one', '/analysis/board', '/review/game-one', '/note/view/note-one', '/lessons/notes/lesson-one', '/learn/rules', '/editor', '/editor/position/analysis', '/game-database/example/en', '/watch/game-one']) {
    const app = background();
    const response = app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'site-board' }, {
      ...app.sender, url: 'https://play.xiangqi.com' + pathname,
    });
    await flush();
    assert.equal(app.calls[0]?.type, 'analyze', pathname);
    app.pending.resolve({ bestmove: 'b1c3' });
    assert.equal((await response).ok, true, pathname);
  }
});

test('puzzle reserved pages and unknown modes cannot masquerade as puzzle boards', async () => {
  for (const pathname of ['/puzzle', '/puzzle/custom', '/puzzle/stats', '/puzzle/record', '/puzzle/race', '/puzzle/stats/P', '/puzzle/custom/P', '/puzzle/record/C', '/puzzle/ordinary-one/unknown', '/puzzle/race/race-one/extra']) {
    const app = background();
    const sender = { ...app.sender, url: 'https://play.xiangqi.com' + pathname };
    assert.equal((await app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'reserved-puzzle-route' }, sender)).ok, false, pathname);
    assert.equal(app.calls.length, 0, pathname);
  }
});

test('lobbies can prewarm the engine but cannot authorize analysis', async () => {
  for (const pathname of ['/play', '/computer']) {
    const app = background();
    const sender = { ...app.sender, url: 'https://play.xiangqi.com' + pathname };
    assert.equal((await app.send({ type: 'XQ_WARMUP' }, sender)).ok, true);
    assert.equal((await app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'lobby' }, sender)).ok, false);
    assert.equal(app.calls.filter(call => call.type === 'analyze').length, 0);
  }
});

test('background preserves bounded complete histories and rejects malformed history input', async () => {
  const app = background();
  const history = { initialFen: START, moves: ['b1c3', 'b10c8'] };
  const response = app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'history', ...history });
  await flush();
  assert.equal(app.calls[0].options.initialFen, START);
  assert.deepEqual(app.calls[0].options.moves, history.moves);
  app.pending.resolve({ bestmove: 'b1c3' });
  assert.equal((await response).ok, true);
  for (const invalid of [
    { initialFen: START, moves: 'b1c3' },
    { initialFen: START, moves: Array(1025).fill('b1c3') },
    { initialFen: START, moves: ['a0a1'] },
    { initialFen: START, moves: ['b1c3\nquit'] },
    { initialFen: 'x'.repeat(181), moves: [] },
    { initialFen: null, moves: [] },
  ]) {
    const invalidApp = background();
    assert.equal((await invalidApp.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'invalid-history', ...invalid })).ok, false);
    assert.equal(invalidApp.calls.length, 0);
  }
});

test('background caps compute time and serializes ownership across tabs', async () => {
  const app = background();
  const first = app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'one', movetime: 9999 });
  await flush();
  assert.equal(app.calls[0].options.movetime, 3500);
  const second = await app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'two' }, { ...app.sender, tab: { id: 8 } });
  assert.equal(second.ok, false);
  app.pending.resolve({ bestmove: 'b1c3' });
  assert.equal((await first).ok, true);
});

test('background sanitizes adaptive policy options before invoking the engine', async () => {
  const examples = [
    { input: { mode: 'adaptive', balance: 0.8 }, mode: 'adaptive', balance: 0.8 },
    { input: { mode: 'fixed', balance: 0.2 }, mode: 'fixed', balance: 0.2 },
    { input: { mode: 'adaptive', balance: -2 }, mode: 'adaptive', balance: 0 },
    { input: { mode: 'adaptive', balance: 2 }, mode: 'adaptive', balance: 1 },
    { input: { mode: 'arbitrary', balance: 'invalid' }, mode: 'adaptive', balance: 0.65 },
    { input: {}, mode: 'adaptive', balance: 0.65 },
  ];
  for (const example of examples) {
    const app = background();
    const response = app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'policy', ...example.input });
    await flush();
    assert.equal(app.calls[0].options.mode, example.mode);
    assert.equal(app.calls[0].options.balance, example.balance);
    app.pending.resolve({ bestmove: 'b1c3' });
    assert.equal((await response).ok, true);
  }
});

test('background preserves engine importance evidence in its response', async () => {
  const app = background();
  const response = app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'evidence', mode: 'adaptive', balance: 0.65 });
  const evidence = {
    bestmove: 'b1c3', mode: 'adaptive', balance: 0.65, importance: 0.6, allocatedMs: 2400,
    reason: ['close-candidates'], importanceInputs: { gapCp: 30, pairedDepth: 9 }, stopReason: 'adaptive-budget',
  };
  await flush();
  app.pending.resolve(evidence);
  const actual = await response;
  assert.equal(actual.ok, true);
  for (const key of Object.keys(evidence)) assert.deepEqual(actual[key], evidence[key]);
});

test('only the owning tab can cancel a search, even after it leaves the board route', async () => {
  const app = background();
  const first = app.send({ type: 'XQ_ANALYZE', fen: START, requestId: 'one', movetime: 800 });
  await flush();
  await app.send({ type: 'XQ_CANCEL', requestId: 'one' }, { ...app.sender, tab: { id: 8 } });
  assert.equal(app.calls.filter(call => call.type === 'cancel').length, 0);
  const cancelled = await app.send({ type: 'XQ_CANCEL', requestId: 'one' }, { ...app.sender, url: 'https://play.xiangqi.com/computer' });
  assert.equal(cancelled.ok, true);
  assert.equal(app.calls.filter(call => call.type === 'cancel').length, 1);
  app.pending.resolve({ bestmove: 'b1c3' });
  assert.equal((await first).ok, false);
});
