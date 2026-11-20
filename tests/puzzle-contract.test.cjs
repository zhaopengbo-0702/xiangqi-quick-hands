const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeSnapshot, routeMode, XiangqiSiteAdapter } = require('../extension/site-adapter.js');
const source = fs.readFileSync(require.resolve('../extension/page-bridge.js'), 'utf8');
const INITIAL = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1';
const AFTER = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/4C2C1/9/RNBAKABNR b - - 1 1';

// Shape verified against Xiangqi.com build main.31116d7f... + puzzle chunk 8741.eddd3c... .
function fixture(pathname = '/puzzle/123/P', overrides = {}, selector = '#game-grid') {
  const state = {
    puzzle: { puzzle_id: 123, initial_fen: INITIAL, player_turn: 1 },
    movesHistory: [{ initMove: true, index: 0, currentFen: INITIAL }],
    activeMove: null, moveCount: 0, isPuzzleCompleted: false, lastMoveCompleted: false,
    wrongMove: null, isPlayerTurn: true, playAgain: 0, ...overrides,
  };
  Object.defineProperty(state.puzzle, 'model_answer', { get() { throw new Error('Answers are not board state'); } });
  Object.defineProperty(state, 'answerTree', { get() { throw new Error('Answers must not be read'); } });
  const context = { fen: INITIAL, myPieceCase: 'toUpperCase', isMyTurnNow: true, flipBoard: false,
    viewOnly: false, wrongMove: null, movePiece() {}, isLegalToMove() { return true; } };
  const rootState = {};
  const root = { tag: 3, stateNode: rootState, return: null };
  rootState.current = root;
  const game = { memoizedProps: state, return: root };
  const provider = { memoizedProps: { value: context }, return: game };
  const host = { memoizedProps: { id: 'game-grid' }, return: provider };
  root.child = game; game.child = provider; provider.child = host;
  const board = { __reactFiber$fixture: host };
  const location = { hostname: 'play.xiangqi.com', origin: 'https://play.xiangqi.com', pathname };
  const listeners = new Set(), posts = [];
  const window = { addEventListener: (_, callback) => listeners.add(callback), removeEventListener: (_, callback) => listeners.delete(callback), postMessage: data => posts.push(data) };
  vm.runInNewContext(source, { window, location, document: { querySelector: query => query === selector ? board : null } });
  const read = () => {
    for (const callback of listeners) callback({ source: window, origin: location.origin,
      data: { type: 'xiangqi-assistant:read:v3', nonce: '0123456789abcdef0123456789abcdef', requestId: posts.length + 1 } });
    return posts.at(-1).payload;
  };
  return { state, context, root, host, location, read, snapshot: () => normalizeSnapshot(read()) };
}

test('route classification separates actual puzzle boards, libraries and analysis pages', () => {
  for (const route of ['/puzzle/123', '/puzzle/abc/P', '/puzzle/abc/C', '/puzzle/race/abc']) {
    assert.equal(routeMode(route), 'puzzle');
    assert.equal(XiangqiSiteAdapter.routeMode(route), 'puzzle');
  }
  for (const route of ['/puzzle', '/puzzle/', '/puzzle/custom', '/puzzle/stats', '/puzzle/record', '/puzzle/race', '/puzzle/custom/P', '/puzzle/id/not-a-mode']) assert.equal(routeMode(route), null);
  for (const route of ['/analysis/board', '/review/123', '/note/view/123', '/lessons/play/123', '/editor', '/game-database/a/en', '/watch/id']) assert.equal(routeMode(route), 'analysis');
  for (const route of ['/settings', '/account/signin', '/analysis/no', '/watching']) assert.equal(routeMode(route), null);
});

test('puzzle practice, challenge and daily-linked boards normalize live state without reading answers', () => {
  for (const route of ['/puzzle/123', '/puzzle/123/P', '/puzzle/123/C']) {
    const app = fixture(route);
    let snapshot = app.snapshot();
    assert.equal(snapshot.mode, 'puzzle');
    assert.equal(snapshot.active, true);
    assert.equal(snapshot.moveCount, 0);
    assert.deepEqual([...snapshot.moves], []);
    assert.equal(snapshot.fen, INITIAL.replace(' r ', ' w '));
    app.state.movesHistory.push({ index: 1, uci: 'b3e3', currentFen: AFTER });
    app.state.moveCount = 1;
    app.state.activeMove = app.state.movesHistory[1];
    app.context.fen = AFTER;
    app.context.isMyTurnNow = false;
    snapshot = app.snapshot();
    assert.equal(snapshot.turn, 'black');
    assert.equal(snapshot.moveCount, 1);
    assert.deepEqual([...snapshot.moves], ['b3e3']);
    assert.equal(snapshot.recentPositions[0].fen, AFTER);
  }
});

test('completed, wrong and locked puzzles stop action and retries have a distinct game identity', () => {
  const app = fixture();
  const original = app.snapshot().gameKey;
  app.state.playAgain = 1;
  assert.notEqual(app.snapshot().gameKey, original);
  for (const property of ['isPuzzleCompleted', 'lastMoveCompleted']) {
    app.state[property] = true;
    assert.equal(app.snapshot().active, false);
    assert.equal(app.snapshot().puzzleCompleted, true);
    app.state[property] = false;
  }
  app.state.wrongMove = { uci: 'b3d3' };
  assert.equal(app.snapshot().puzzleWrong, true);
  assert.equal(app.snapshot().active, false);
  app.state.wrongMove = null;
  app.context.viewOnly = true;
  assert.equal(app.snapshot().participant, true);
  assert.equal(app.snapshot().active, false);
});

test('the final accepted puzzle move confirms even when the website immediately switches to completed read-only', async () => {
  const app = fixture();
  const initial = app.snapshot();
  const rect = { left: 10, top: 10, width: 40, height: 40 };
  let selected = false, destinations = 0;
  const source = { isConnected: true, classList: { contains: () => selected } };
  const target = { classList: { contains: () => false } };
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  adapter.window = { performance };
  adapter.read = async () => app.snapshot();
  adapter.assertReady = () => ({ querySelectorAll: () => [{ getBoundingClientRect: () => rect, querySelector: () => source }] });
  adapter.squareElement = () => ({ getBoundingClientRect: () => rect, children: [target] });
  adapter.clickTarget = element => {
    if (element === source) { selected = true; return; }
    destinations++;
    app.state.movesHistory.push({ index: 1, uci: 'b3e3', currentFen: AFTER });
    app.state.moveCount = 1;
    app.state.isPuzzleCompleted = true;
    app.state.lastMoveCompleted = true;
    app.context.fen = AFTER;
    app.context.isMyTurnNow = false;
    app.context.viewOnly = true;
  };
  const result = await adapter.play('b3e3', initial, { deadline: performance.now() + 500 });
  assert.equal(result.puzzleCompleted, true);
  assert.equal(result.gameKey, initial.gameKey);
  assert.equal(destinations, 1);
});

test('race tracks lives, completion and finite clock while survival can be untimed', () => {
  const app = fixture('/puzzle/race/123', { remainingTime: 180, totalLives: 3, time: 180 });
  assert.equal(app.snapshot().puzzleRace, true);
  assert.equal(app.snapshot().active, true);
  app.state.remainingTime = 0;
  assert.equal(app.snapshot().clockRemainingMs, 0);
  assert.equal(app.snapshot().active, false);
  app.state.remainingTime = null;
  assert.equal(app.snapshot().active, true);
  app.state.time = null;
  app.state.remainingTime = 0;
  assert.equal(app.snapshot().active, true);
  app.state.totalLives = 0;
  assert.equal(app.snapshot().active, false);
  app.state.totalLives = 3;
  app.state.completeRaceAttemptSuccess = true;
  app.state.completeRaceAttemptData = { id: 'finished' };
  assert.equal(app.snapshot().active, false);
  const unknownSurvival = fixture('/puzzle/race/456', { remainingTime: 0, totalLives: 3 });
  assert.equal(unknownSurvival.snapshot().active, true);
  assert.equal(unknownSurvival.snapshot().clockRemainingMs, null);
});

test('analysis, review, note, lesson, editor and watch boards expose analysis without authorizing clicks', () => {
  for (const route of ['/analysis/board', '/review/123', '/note/view/123', '/lessons/play/123', '/editor', '/game-database/a/en', '/watch/id']) {
    const app = fixture(route);
    const snapshot = app.snapshot();
    assert.equal(snapshot.mode, 'analysis');
    assert.equal(snapshot.canAnalyze, true);
    assert.equal(snapshot.participant, false);
    assert.equal(snapshot.active, false);
    assert.equal(snapshot.viewOnly, true);
    const adapter = Object.create(XiangqiSiteAdapter.prototype);
    assert.throws(() => adapter.assertReady(snapshot), /只读/);
  }
});

test('editor board-container ancestors expose only a complete valid FEN for analysis', () => {
  const app = fixture('/editor', {}, '#puzzle-board .board-container');
  delete app.context.isMyTurnNow;
  app.context.editorMode = true;
  assert.equal(app.snapshot().canAnalyze, true);
  assert.equal(app.snapshot().active, false);
  assert.equal(app.snapshot().mode, 'analysis');
  app.context.fen = INITIAL.replace('K', '1');
  assert.equal(app.read().error, 'invalid-position');
});

test('invalid, incomplete, detached or unrecognized boards never produce a playable snapshot', () => {
  const app = fixture();
  app.context.fen = '9/9 r';
  assert.equal(app.read().error, 'invalid-position');
  app.context.fen = INITIAL.replace('k', '1');
  assert.equal(app.read().error, 'invalid-position');
  app.context.fen = INITIAL;
  app.root.child = null;
  assert.equal(app.read().error, 'react-state-unavailable');
  const missing = fixture();
  missing.state.puzzle = null;
  assert.equal(missing.read().error, 'game-state-unavailable');
});
