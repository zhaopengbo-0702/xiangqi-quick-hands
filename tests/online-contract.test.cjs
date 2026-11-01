const test = require('node:test');
const assert = require('node:assert/strict');
const { XiangqiSiteAdapter, normalizeSnapshot, applyPlacement } = require('../extension/site-adapter.js');

const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1';
const online = (overrides = {}) => ({
  mode: 'online', participant: true, viewOnly: false,
  playerSide: 'red', flipBoard: false, historyMode: false,
  gameID: 'online-contract', isMyTurnNow: true,
  gamePlayData: {
    initFen: FEN, currentFen: FEN, moveCount: 0, turnNow: 'red',
    state: 2, endReason: null, moves: [],
  },
  ...overrides,
});

function playableAdapter() {
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  adapter.document = {
    visibilityState: 'visible',
    querySelector: () => ({
      querySelectorAll: () => Array(90),
      getBoundingClientRect: () => ({ width: 450, height: 500 }),
    }),
  };
  return adapter;
}

function readAdapter(payload, pathname = '/game/match-123') {
  let receive;
  const targetWindow = {
    location: { hostname: 'play.xiangqi.com', origin: 'https://play.xiangqi.com', pathname },
    performance,
    crypto: { getRandomValues: array => array.fill(7) },
    addEventListener: (_name, callback) => { receive = callback; },
    removeEventListener() {},
    postMessage(message) {
      receive({
        source: targetWindow, origin: targetWindow.location.origin,
        data: { type: 'xiangqi-assistant:state', nonce: message.nonce, requestId: message.requestId, payload },
      });
    },
  };
  return new XiangqiSiteAdapter({ window: targetWindow, document: {} });
}

test('online activity requires affirmative participant proof', () => {
  const verified = normalizeSnapshot(online());
  assert.equal(verified.mode, 'online');
  assert.equal(verified.participant, true);
  assert.equal(verified.active, true);
  assert.doesNotThrow(() => playableAdapter().assertReady(verified, verified));
  for (const participant of [false, undefined]) {
    const spectator = normalizeSnapshot(online({ participant }));
    assert.equal(spectator.active, false);
    assert.throws(() => playableAdapter().assertReady(spectator, spectator));
  }
});

test('spectators without a side remain readable and cannot become playable', () => {
  const spectator = normalizeSnapshot(online({ participant: false, playerSide: null }));
  assert.equal(spectator.playerSide, null);
  assert.equal(spectator.active, false);
  assert.throws(() => playableAdapter().assertReady(spectator, spectator));
});

test('view-only boards are blocked even when participant proof is present', () => {
  const snapshot = normalizeSnapshot(online({ viewOnly: true }));
  assert.equal(snapshot.active, false);
  assert.throws(() => playableAdapter().assertReady(snapshot, snapshot));
});

test('online replay, finished game and non-owned turn cannot receive a move', () => {
  const replay = normalizeSnapshot(online({ historyMode: true }));
  assert.equal(replay.historyMode, true);
  assert.throws(() => playableAdapter().assertReady(replay, replay));
  const ended = normalizeSnapshot(online({
    gamePlayData: { ...online().gamePlayData, state: 3, endReason: 'finished' },
  }));
  assert.equal(ended.active, false);
  assert.throws(() => playableAdapter().assertReady(ended, ended));
  const notMyTurn = normalizeSnapshot(online({ isMyTurnNow: false }));
  assert.throws(() => playableAdapter().assertReady(notMyTurn, notMyTurn));
});

test('online reads reject mismatched modes and stale game routes', async () => {
  const matching = readAdapter(online({ route: '/game/match-123' }));
  assert.equal((await matching.read()).participant, true);
  matching.destroy();
  for (const payload of [
    online({ mode: 'computer', route: '/game/match-123' }),
    online({ mode: undefined, route: '/game/match-123' }),
    online({ route: '/game/another-match' }),
  ]) {
    const adapter = readAdapter(payload);
    await assert.rejects(adapter.read());
    adapter.destroy();
  }
});

test('participant proof revoked during selection prevents the destination click', async () => {
  const verified = normalizeSnapshot(online());
  const spectator = normalizeSnapshot(online({ participant: false, playerSide: null }));
  const adapter = playableAdapter();
  const rect = { left: 10, top: 10, width: 40, height: 40 };
  let selected = false;
  const source = { isConnected: true, classList: { contains: () => selected } };
  const board = {
    getBoundingClientRect: () => ({ width: 450, height: 500 }),
    querySelectorAll: selector => selector === '.square' ? Array(90) : [
      { getBoundingClientRect: () => rect, querySelector: () => source },
    ],
  };
  adapter.document.querySelector = () => board;
  adapter.window = { performance };
  let reads = 0;
  adapter.read = async () => ++reads === 1 ? verified : spectator;
  adapter.squareElement = () => ({ getBoundingClientRect: () => rect });
  let clicks = 0;
  adapter.clickTarget = () => { clicks++; selected = true; };
  await assert.rejects(adapter.play('b3e3', verified, { deadline: performance.now() + 1000 }), /观战|只读/);
  assert.equal(clicks, 1);
});

test('a search started with 1800ms can land at 900ms inside its reserved deadline', async () => {
  const expected = normalizeSnapshot(online({ clockRemainingMs: 1800 }));
  const readyToLand = normalizeSnapshot(online({ clockRemainingMs: 900 }));
  const selected = normalizeSnapshot(online({ clockRemainingMs: 850 }));
  const acknowledged = normalizeSnapshot(online({
    clockRemainingMs: 820,
    gamePlayData: {
      ...online().gamePlayData,
      currentFen: applyPlacement(FEN, 'b3e3') + ' b - - 0 1', moveCount: 1, turnNow: 'black',
    },
  }));
  const adapter = playableAdapter();
  const rect = { left: 10, top: 10, width: 40, height: 40 };
  let isSelected = false;
  const source = { isConnected: true, classList: { contains: () => isSelected } };
  const board = {
    getBoundingClientRect: () => ({ width: 450, height: 500 }),
    querySelectorAll: selector => selector === '.square' ? Array(90) : [
      { getBoundingClientRect: () => rect, querySelector: () => source },
    ],
  };
  adapter.document.querySelector = () => board;
  adapter.window = { performance };
  const snapshots = [readyToLand, selected, acknowledged];
  adapter.read = async () => snapshots.shift() || acknowledged;
  const destinationTarget = { classList: { contains: () => false } };
  adapter.squareElement = () => ({ getBoundingClientRect: () => rect, children: [destinationTarget] });
  let clicks = 0;
  adapter.clickTarget = () => { clicks++; isSelected = true; };
  const after = await adapter.play('b3e3', expected, { deadline: performance.now() + 500 });
  assert.equal(after.moveCount, 1);
  assert.equal(clicks, 2);
});

test('landing below the 150ms action reserve is refused before any click', async () => {
  const expected = normalizeSnapshot(online({ clockRemainingMs: 1800 }));
  const tooLate = normalizeSnapshot(online({ clockRemainingMs: 100 }));
  const adapter = playableAdapter();
  adapter.window = { performance };
  adapter.read = async () => tooLate;
  let clicks = 0;
  adapter.clickTarget = () => { clicks++; };
  await assert.rejects(adapter.play('b3e3', expected, { deadline: performance.now() + 500 }), /时间|时钟|到时/);
  assert.equal(clicks, 0);
});
