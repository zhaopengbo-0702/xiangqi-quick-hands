const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../extension/page-bridge.js'), 'utf8');
const INITIAL = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1';

function gameProps(moveCount) {
  return {
    playerSide: 'red', gameData: { gameID: 'committed-game' },
    gamePlayData: { currentFen: INITIAL, initFen: INITIAL, moveCount, turnNow: 'red', state: 2, endReason: null, moves: [] },
    boardContext: { fen: INITIAL, myPieceCase: 'toUpperCase', isMyTurnNow: true }
  };
}

function alternate(a, b) { a.alternate = b; b.alternate = a; }
function rootPair() {
  const stateNode = {};
  const a = { tag: 3, stateNode, return: null, memoizedProps: {} };
  const b = { tag: 3, stateNode, return: null, memoizedProps: {} };
  alternate(a, b);
  stateNode.current = b;
  return { a, b, stateNode };
}

function bridge(host) {
  const listeners = new Set(), posts = [];
  const location = { hostname: 'play.xiangqi.com', pathname: '/computer-play', origin: 'https://play.xiangqi.com' };
  const window = {
    addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener); },
    postMessage(value) { posts.push(value); }
  };
  const board = { __reactFiber$test: host };
  const context = vm.createContext({ window, location, document: { querySelector: () => board } });
  const load = () => vm.runInContext(source, context);
  const send = type => {
    const previous = posts.length;
    for (const listener of [...listeners]) listener({ source: window, origin: location.origin,
      data: { type, nonce: '0123456789abcdef0123456789abcdef', requestId: previous + 1 } });
    return posts.slice(previous);
  };
  load();
  return { window, posts, listeners, load, send, read: () => send('xiangqi-assistant:read:v3')[0]?.payload };
}

test('bridge selects the committed host and parent alternates, not the DOM-attached old branch', () => {
  const roots = rootPair();
  const oldGame = { memoizedProps: gameProps(6), return: roots.a };
  const currentGame = { memoizedProps: gameProps(8), return: roots.b };
  const oldHost = { memoizedProps: {}, return: oldGame };
  const currentHost = { memoizedProps: {}, return: currentGame };
  alternate(oldGame, currentGame); alternate(oldHost, currentHost);
  roots.a.child = oldGame; roots.b.child = currentGame;
  oldGame.child = oldHost; currentGame.child = currentHost;
  const fixture = bridge(oldHost);
  assert.equal(fixture.read().gamePlayData.moveCount, 8);
  roots.stateNode.current = roots.a;
  assert.equal(fixture.read().gamePlayData.moveCount, 6);
});

test('bridge follows the committed parent path when a shared child has no alternate and stale return pointers', () => {
  const roots = rootPair();
  const oldGame = { memoizedProps: gameProps(6), return: roots.a };
  const currentGame = { memoizedProps: gameProps(8), return: roots.b };
  alternate(oldGame, currentGame);
  roots.a.child = oldGame; roots.b.child = currentGame;
  const provider = { memoizedProps: {}, return: oldGame };
  const host = { memoizedProps: {}, return: provider };
  oldGame.child = provider; currentGame.child = provider; provider.child = host;
  const fixture = bridge(host);
  assert.equal(fixture.read().gamePlayData.moveCount, 8);
  roots.stateNode.current = roots.a;
  assert.equal(fixture.read().gamePlayData.moveCount, 6);
});

test('bridge does not substitute a newer uncommitted position for the actual committed state', () => {
  const roots = rootPair();
  roots.stateNode.current = roots.a;
  const committedGame = { memoizedProps: gameProps(6), return: roots.a };
  const workInProgressGame = { memoizedProps: gameProps(100), return: roots.b };
  alternate(committedGame, workInProgressGame);
  const host = { memoizedProps: {}, return: committedGame };
  roots.a.child = committedGame; roots.b.child = workInProgressGame;
  committedGame.child = host; workInProgressGame.child = host;
  assert.equal(bridge(host).read().gamePlayData.moveCount, 6);
});

test('bridge rejects detached hosts even when their stale return chain reaches a mounted root', () => {
  const roots = rootPair();
  const detachedGame = { memoizedProps: gameProps(6), return: roots.a };
  const detachedHost = { memoizedProps: {}, return: detachedGame };
  detachedGame.child = detachedHost; roots.a.child = detachedGame;
  roots.b.child = { memoizedProps: gameProps(8), return: roots.b };
  assert.equal(bridge(detachedHost).read().error, 'react-state-unavailable');
  assert.equal(bridge({ memoizedProps: gameProps(8), return: null }).read().error, 'react-state-unavailable');
});

test('bridge caps ancestor and sibling traversal and never searches unrelated child subtrees', () => {
  let host = { memoizedProps: {} }, cursor = host;
  for (let index = 0; index < 520; index++) cursor = cursor.return = { memoizedProps: {} };
  assert.equal(bridge(host).read().error, 'react-state-unavailable');

  const roots = rootPair();
  const game = { memoizedProps: gameProps(8), return: roots.b };
  host = { memoizedProps: {}, return: game };
  roots.b.child = game;
  game.child = { sibling: null };
  game.child.sibling = game.child;
  assert.equal(bridge(host).read().error, 'react-state-unavailable');

  const unrelated = { sibling: game };
  Object.defineProperty(unrelated, 'child', { get() { throw new Error('unrelated subtree must not be read'); } });
  roots.b.child = unrelated; game.child = host;
  assert.equal(bridge(host).read().gamePlayData.moveCount, 8);
});

test('V3 protocol ignores the legacy channel and reinjection keeps exactly one removable listener', () => {
  const roots = rootPair();
  const host = { memoizedProps: gameProps(8), return: roots.b };
  roots.b.child = host;
  const fixture = bridge(host);
  fixture.window.__xiangqiAssistantBridgeV1 = true;
  assert.equal(fixture.send('xiangqi-assistant:read').length, 0);
  assert.equal(fixture.send('xiangqi-assistant:read:v2').length, 0);
  assert.equal(fixture.read().gamePlayData.moveCount, 8);
  assert.equal(fixture.posts[0].type, 'xiangqi-assistant:state:v3');
  fixture.load();
  assert.equal(fixture.listeners.size, 1);
  const oldInstance = fixture.window.__xiangqiAssistantBridgeV3;
  oldInstance.destroy();
  assert.equal(oldInstance.isAlive(), false);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(fixture.send('xiangqi-assistant:read:v3').length, 0);
  fixture.load();
  assert.equal(fixture.listeners.size, 1);
  assert.equal(fixture.read().gamePlayData.moveCount, 8);
  assert.notEqual(fixture.window.__xiangqiAssistantBridgeV3, oldInstance);
});

test('V3 removes a surviving V2 bridge when updating an already-open puzzle page', () => {
  const roots = rootPair();
  const host = { memoizedProps: gameProps(0), return: roots.b };
  roots.b.child = host;
  const fixture = bridge(host);
  fixture.window.__xiangqiAssistantBridgeV3.destroy();
  let disposed = false;
  fixture.window.__xiangqiAssistantBridgeV2 = { version: 2, isAlive: () => true, destroy() { disposed = true; } };
  fixture.load();
  assert.equal(disposed, true);
  assert.equal(fixture.window.__xiangqiAssistantBridgeV3.version, 3);
  assert.equal(fixture.read().gamePlayData.moveCount, 0);
});
