const test = require('node:test');
const assert = require('node:assert/strict');
const { XiangqiSiteAdapter, normalizeSnapshot, applyPlacement } = require('../extension/site-adapter.js');

const INITIAL = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const MOVE = 'b3e3';
const raw = () => ({ mode: 'computer', route: '/computer-play', gameID: 'recovery', playerSide: 'red',
  gamePlayData: { initFen: INITIAL, currentFen: INITIAL, turnNow: 'red', moveCount: 0, state: 2, endReason: null } });

function fixture(options = {}) {
  let now = 0, selected = false, destinationClicks = 0, reads = 0;
  const stages = [], events = [];
  const initial = normalizeSnapshot(raw());
  const after = normalizeSnapshot({ ...raw(), gamePlayData: { ...raw().gamePlayData,
    currentFen: applyPlacement(INITIAL, MOVE) + ' b - - 1 1', turnNow: 'black', moveCount: 1 } });
  let current = initial;
  const rect = { left: 10, top: 10, width: 40, height: 40 };
  const destinationRect = { left: 90, top: 10, width: 40, height: 40 };
  const source = { isConnected: true, getBoundingClientRect: () => rect,
    classList: { contains: name => name === 'selected-piece' && selected },
    dispatchEvent(event) { events.push(`source:${event.type}`); if (event.type === 'click') selected = true; } };
  const target = { getBoundingClientRect: () => destinationRect, classList: { contains: () => false },
    dispatchEvent(event) {
      events.push(`destination:${event.type}`);
      if (options.throwDuringDestination) throw new Error('event-dispatch-failed');
      if (event.type === 'click') { destinationClicks++; current = after; }
    } };
  const cells = Array.from({ length: 90 }, (_, index) => ({
    classList: { contains: name => name === `${Math.floor(index / 9) + 1}-${'abcdefghi'[index % 9]}` },
    getBoundingClientRect: () => index === 19 ? rect : destinationRect,
    children: index === 22 ? [target] : [],
  }));
  const board = {
    querySelectorAll: selector => selector === '.square' ? cells : [{ getBoundingClientRect: () => rect, querySelector: () => source }],
    getBoundingClientRect: () => ({ width: 450, height: 500 }),
    contains: hit => hit === source || hit === target,
  };
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  adapter.window = { performance: { now: () => now }, MouseEvent: class { constructor(type, init) { Object.assign(this, init, { type }); } } };
  adapter.document = {
    querySelector: () => board,
    querySelectorAll: () => cells,
    elementFromPoint(x) { return options.coverDestination && x > 80 ? {} : x < 80 ? source : target; },
  };
  adapter.delay = async milliseconds => { now += milliseconds; };
  adapter.read = async () => {
    reads++;
    if (reads === 1 && options.initialError) throw options.initialError;
    if (reads > 1 && options.readError) throw options.readError;
    return current;
  };
  return { adapter, initial, stages, events, onStage: stage => stages.push(stage),
    get destinationClicks() { return destinationClicks; },
    get selected() { return selected; } };
}

test('a pre-selection read timeout carries a recoverable stage without clicking anything', async () => {
  const error = Object.assign(new Error('read-timeout'), { code: 'XQ_READ_TIMEOUT' });
  const state = fixture({ initialError: error });
  await assert.rejects(state.adapter.play(MOVE, state.initial, { onStage: state.onStage, deadline: 500 }), {
    code: 'XQ_READ_TIMEOUT', actionStage: 'before-selection',
  });
  assert.deepEqual(state.events, []);
});

test('destination modal checks fail before dispatch and keep selected stage', async () => {
  const state = fixture({ coverDestination: true });
  await assert.rejects(state.adapter.play(MOVE, state.initial, { onStage: state.onStage, deadline: 500 }), {
    code: 'XQ_BOARD_OBSCURED', actionStage: 'selected',
  });
  assert.equal(state.selected, true);
  assert.equal(state.destinationClicks, 0);
  assert.deepEqual(state.stages, ['before-selection', 'selected']);
  assert.ok(state.events.every(event => event.startsWith('source:')));
});

test('a destination event dispatch failure remains an uncertain move and cannot be treated as pre-click', async () => {
  const state = fixture({ throwDuringDestination: true });
  await assert.rejects(state.adapter.play(MOVE, state.initial, { onStage: state.onStage, deadline: 500 }), {
    message: 'event-dispatch-failed', actionStage: 'destination-dispatched',
  });
  assert.deepEqual(state.stages, ['before-selection', 'selected', 'destination-dispatched']);
  assert.deepEqual(state.events.filter(event => event.startsWith('destination:')), ['destination:mousedown']);
});

test('confirmation read interruptions recover without stopping or replaying the destination', async () => {
  for (const interruptions of [['XQ_READ_TIMEOUT'], ['XQ_READ_TIMEOUT', 'XQ_STATE_SYNC', 'XQ_BOARD_NOT_READY', 'XQ_READ_TIMEOUT']]) {
    const state = fixture();
    const read = state.adapter.read;
    let calls = 0;
    const errors = [...interruptions];
    state.adapter.read = async options => {
      if (++calls > 2 && errors.length) throw Object.assign(new Error('temporary confirmation interruption'), { code: errors.shift() });
      return read(options);
    };
    assert.equal((await state.adapter.play(MOVE, state.initial, { onStage: state.onStage, deadline: 80 })).moveCount, 1);
    assert.equal(state.destinationClicks, 1);
    assert.deepEqual(state.stages, ['before-selection', 'selected', 'destination-dispatched']);
  }
});

test('confirmation stops for changed context, puzzle rejection and an unconfirmed game ending', async () => {
  for (const [change, code] of [
    [{ gameKey: 'another-game' }, 'XQ_CONTEXT_CHANGED'],
    [{ historyMode: true }, 'XQ_CONTEXT_CHANGED'],
    [{ participant: false }, 'XQ_CONTEXT_CHANGED'],
    [{ playerSide: 'black' }, 'XQ_CONTEXT_CHANGED'],
    [{ puzzleWrong: true }, 'XQ_PUZZLE_WRONG'],
    [{ active: false }, 'XQ_GAME_ENDED'],
    [{ puzzleCompleted: true }, 'XQ_GAME_ENDED'],
  ]) {
    const state = fixture();
    const read = state.adapter.read;
    state.adapter.read = async options => state.destinationClicks ? { ...state.initial, ...change } : read(options);
    await assert.rejects(state.adapter.play(MOVE, state.initial, { onStage: state.onStage, deadline: 500 }), {
      code, actionStage: 'destination-dispatched',
    });
    assert.equal(state.destinationClicks, 1);
  }
});

test('confirmation ignores a turn-only update until its exact destination is published', async () => {
  const state = fixture();
  const read = state.adapter.read;
  let confirmationReads = 0;
  state.adapter.read = async options => {
    if (state.destinationClicks && ++confirmationReads <= 3) return { ...state.initial, turn: 'black', isMyTurnNow: false };
    return read(options);
  };
  assert.equal((await state.adapter.play(MOVE, state.initial, { deadline: 80 })).moveCount, 1);
  assert.equal(confirmationReads, 4);
  assert.equal(state.destinationClicks, 1);
});

test('successful stage notifications occur in action order and confirm exactly one destination', async () => {
  const state = fixture();
  assert.equal((await state.adapter.play(MOVE, state.initial, { onStage: state.onStage, deadline: 500 })).moveCount, 1);
  assert.deepEqual(state.stages, ['before-selection', 'selected', 'destination-dispatched']);
  assert.equal(state.destinationClicks, 1);
});

test('initial cancellation and expired deadline expose distinct non-dispatched codes', async () => {
  for (const [options, code] of [[{ isCancelled: () => true }, 'XQ_CANCELLED'], [{ deadline: 0 }, 'XQ_ACTION_TIMEOUT']]) {
    const state = fixture();
    await assert.rejects(state.adapter.play(MOVE, state.initial, options), { code, actionStage: 'before-selection' });
    assert.deepEqual(state.events, []);
  }
});

test('only a recognized missing board is recoverable; malformed position data stays unclassified', () => {
  assert.throws(() => normalizeSnapshot({ error: 'board-not-ready' }), { code: 'XQ_BOARD_NOT_READY' });
  assert.throws(() => normalizeSnapshot({ error: 'invalid-position' }), error => !error.code);
  const state = fixture();
  state.adapter.document.querySelector = () => null;
  assert.throws(() => state.adapter.assertReady(state.initial, state.initial), { code: 'XQ_BOARD_NOT_READY' });
});

test('stale position checks expose a position change while retaining the original expected board', () => {
  const state = fixture();
  assert.throws(() => state.adapter.assertReady({ ...state.initial, boardKey: 'changed' }, state.initial), { code: 'XQ_POSITION_CHANGED' });
  assert.throws(() => state.adapter.assertReady({ ...state.initial, flipBoard: true }, state.initial), { code: 'XQ_POSITION_CHANGED' });
  assert.throws(() => state.adapter.assertReady({ ...state.initial, gameKey: 'replacement-game', boardKey: 'replacement-board' }, state.initial), { code: 'XQ_CONTEXT_CHANGED' });
});

test('bridge read timeout clears pending request and keeps its own error classification', async () => {
  const adapter = new XiangqiSiteAdapter({ document: {}, window: {
    performance, crypto: require('node:crypto').webcrypto,
    location: { hostname: 'play.xiangqi.com', pathname: '/computer-play', origin: 'https://play.xiangqi.com' },
    addEventListener() {}, removeEventListener() {}, postMessage() {},
  } });
  try {
    await assert.rejects(adapter.read({ timeoutMs: 5 }), { code: 'XQ_READ_TIMEOUT' });
    assert.equal(adapter.pending.size, 0);
  } finally { adapter.destroy(); }
});

test('bridge refuses responses from a changed context with an explicit context code', async () => {
  let listener;
  const window = {
    performance, crypto: require('node:crypto').webcrypto,
    location: { hostname: 'play.xiangqi.com', pathname: '/computer-play', origin: 'https://play.xiangqi.com' },
    addEventListener(type, callback) { listener = callback; }, removeEventListener() {},
    postMessage(message) { listener({ source: window, origin: window.location.origin,
      data: { type: 'xiangqi-assistant:state:v3', nonce: message.nonce, requestId: message.requestId,
        payload: { ...raw(), route: '/game/different' } } }); },
  };
  const adapter = new XiangqiSiteAdapter({ document: {}, window });
  try { await assert.rejects(adapter.read(), { code: 'XQ_CONTEXT_CHANGED' }); }
  finally { adapter.destroy(); }
});
