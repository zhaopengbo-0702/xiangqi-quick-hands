const assert = require('node:assert/strict');
const {test, after} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extension = path.resolve(__dirname, '../extension');
const createStockfish = require('../extension/engine/stockfish.js');
const wasmBinary = fs.readFileSync(path.join(extension, 'engine/stockfish.wasm'));
let listener;
const context = vm.createContext({
  console, performance, setTimeout, clearTimeout, setInterval, clearInterval, SharedArrayBuffer,
  crossOriginIsolated: true,
  Stockfish: (options) => createStockfish({...options, wasmBinary}),
  chrome: {runtime: {
    id: 'engine-test',
    getURL: (file) => path.join(extension, file),
    onMessage: {addListener: (callback) => { listener = callback; }},
  }},
});
vm.runInContext(fs.readFileSync(path.join(extension, 'offscreen.js'), 'utf8'), context);

function request(type, options) {
  return new Promise((resolve, reject) => {
    listener({target: 'offscreen', type, options}, {id: 'engine-test'}, (response) => {
      if (response.ok) resolve(response.result);
      else reject(new Error(response.error));
    });
  });
}

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const MOVE = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/;

async function legalMoves(fen) {
  const engine = vm.runInContext('engine', context);
  return new Promise((resolve) => {
    const moves = new Set();
    const receive = (line) => {
      const move = line.match(/^([a-i](?:10|[1-9])[a-i](?:10|[1-9])): /)?.[1];
      if (move) moves.add(move);
      if (line.startsWith('Nodes searched:')) {
        engine.removeMessageListener(receive);
        resolve(moves);
      }
    };
    engine.addMessageListener(receive);
    engine.postMessage('position fen ' + fen);
    engine.postMessage('go perft 1');
  });
}

after(() => context.resetEngine());

test('bundled engine initializes the Xiangqi variant before accepting searches', async () => {
  const result = await request('XQ_ENGINE_WARMUP');
  assert.equal(result.ready, true);
  assert.equal(result.variant, 'xiangqi');
});

test('opening search returns a legal engine move and evaluation within its budget', async () => {
  const result = await request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, movetime: 250, mode: 'fixed', requestId: 'opening',
  });
  assert.match(result.bestmove, MOVE);
  assert.ok(result.depth > 0);
  assert.ok(result.nodes > 0);
  assert.ok(['cp', 'mate'].includes(result.score.type));
  assert.equal(result.requestId, 'opening');
  assert.ok(result.elapsedMs < 1500, 'warmed 250ms search exceeded 1500ms');
  const legal = await legalMoves(START_FEN);
  assert.equal(legal.size, 44, 'initial Xiangqi position has 44 legal moves');
  assert.ok(legal.has(result.bestmove), 'bestmove must be in the engine legal-move list');
  const resultFromBlack = await request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN.replace(' w ', ' b '), movetime: 150, mode: 'fixed',
  });
  assert.match(resultFromBlack.bestmove, MOVE);
  const sourceRank = Number(resultFromBlack.bestmove.match(MOVE)[2]);
  assert.ok(sourceRank >= 7, 'Black move must originate from a black piece');
});

test('requested search times are capped below the five-second turn deadline', async () => {
  const engine = vm.runInContext('engine', context);
  let lastCompleted;
  const observe = (line) => {
    if (!line.startsWith('info ') || /\b(?:lowerbound|upperbound)\b/.test(line)) return;
    const depth = line.match(/\bdepth (\d+)/)?.[1];
    const score = line.match(/\bscore (cp|mate) (-?\d+)/);
    const pv = line.match(/\bpv (.+)$/)?.[1].trim().split(/\s+/);
    if (depth && score && pv?.length && pv.every((move) => MOVE.test(move))) {
      lastCompleted = {depth: Number(depth), score: {type: score[1], value: Number(score[2])}, pv};
    }
  };
  engine.addMessageListener(observe);
  const result = await request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, movetime: 10000, mode: 'fixed', requestId: 'capped',
  });
  engine.removeMessageListener(observe);
  assert.match(result.bestmove, MOVE);
  assert.ok(result.elapsedMs < 4400, 'search exceeded its 4300ms watchdog plus timer margin');
  assert.ok(result.depth >= 6, 'full-budget search must complete multiple plies');
  assert.equal(result.depth, lastCompleted.depth);
  assert.deepEqual(JSON.parse(JSON.stringify(result.score)), lastCompleted.score);
  assert.deepEqual(Array.from(result.pv), lastCompleted.pv);
  assert.equal(result.bestmove, result.pv[0]);
});

test('only completed exact-score principal variations update the completed depth', () => {
  const completed = context.parseInfo('info depth 8 score cp 34 nodes 12000 pv c1e3 b10c8');
  assert.equal(completed.depth, 8);
  assert.equal(completed.pv.length, 2);
  for (const line of [
    'info depth 99 currmove a1a2 currmovenumber 1 nodes 13000',
    'info depth 99 score cp 70 lowerbound nodes 13000 pv c1e3 b10c8',
    'info depth 99 score cp -70 upperbound nodes 13000 pv c1e3 b10c8',
    'info depth 99 score cp 70 nodes 13000',
    'info depth 99 score cp 70 nodes 13000 pv c1e3 invalid',
  ]) {
    const info = context.parseInfo(line);
    assert.equal(info.depth, undefined, line);
    assert.equal(info.score, undefined, line);
    assert.equal(info.pv, undefined, line);
  }
});

test('engine validates board shape before sending a FEN to WebAssembly', async () => {
  await assert.rejects(request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN + '\nquit', movetime: 100,
  }), /Invalid Xiangqi FEN/);
  await assert.rejects(request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN.replace('RNBAKABNR', 'RNBA1ABNR'),
  }), /Invalid Xiangqi board/);
});

test('cancellation prevents a stale bestmove from satisfying the next search', async () => {
  const searching = request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, movetime: 3800, mode: 'fixed', requestId: 'cancelled',
  });
  const rejected = assert.rejects(searching, /Search cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 75));
  const result = await request('XQ_ENGINE_CANCEL');
  assert.equal(result.cancelled, true);
  await rejected;
  await request('XQ_ENGINE_WARMUP');
  const next = await request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, movetime: 100, mode: 'fixed', requestId: 'fresh',
  });
  assert.equal(next.requestId, 'fresh');
  assert.match(next.bestmove, MOVE);
});

test('the offscreen message handler ignores content-script senders', () => {
  let replied = false;
  const accepted = listener({target: 'offscreen', type: 'XQ_ENGINE_CANCEL'}, {
    id: 'engine-test', tab: {id: 1},
  }, () => { replied = true; });
  assert.equal(accepted, undefined);
  assert.equal(replied, false);
});

test('warmup retries if cancellation replaces its engine generation', async () => {
  let releaseFirst;
  let notifyStarted;
  const firstStarted = new Promise((resolve) => { notifyStarted = resolve; });
  let warmupCount = 0;
  const clientContext = vm.createContext({
    chrome: {runtime: {
      getURL: (file) => 'chrome-extension://engine-test/' + file,
      getContexts: async () => [{}],
      onConnect: {addListener() {}},
      sendMessage: async (message) => {
        if (message.type === 'XQ_ENGINE_CANCEL') return {ok: true, result: {cancelled: true}};
        warmupCount += 1;
        if (warmupCount === 1) {
          notifyStarted();
          return new Promise((resolve) => { releaseFirst = resolve; });
        }
        return {ok: true, result: {ready: true, generation: warmupCount}};
      },
    }},
  });
  vm.runInContext(fs.readFileSync(path.join(extension, 'engine-client.js'), 'utf8')
    .replace(/^export /gm, ''), clientContext);
  const warming = clientContext.warmup();
  await firstStarted;
  await clientContext.cancel();
  releaseFirst({ok: true, result: {ready: true, generation: 1}});
  const result = await warming;
  assert.equal(warmupCount, 2);
  assert.equal(result.generation, 2);
});

function policySearch({gap = 500, unstable = false, mate, fen = START_FEN, pv = ['c1e3', 'b10c8']} = {}) {
  const score = mate === undefined ? {type: 'cp', value: 500} : {type: 'mate', value: mate};
  const history = Array.from({length: 6}, (_, index) => ({
    depth: index + 5,
    score: unstable ? {type: 'cp', value: index % 2 ? 500 : 200} : score,
    pv: unstable && index % 2 ? ['g1e3', 'b10c8'] : pv,
  }));
  const info = {depth: 10, score, pv};
  return {
    fen, balance: 0.65, limitMs: 3500, mode: 'adaptive', history, info,
    iterations: new Map([[10, {1: info, 2: {depth: 10, score: {type: 'cp', value: 500 - gap}, pv: ['g1e3']}}]]),
  };
}

test('importance spends less on a stable clear leader and more on close unstable choices', () => {
  const clear = context.assessImportance(policySearch());
  const close = context.assessImportance(policySearch({gap: 5}));
  const unstable = context.assessImportance(policySearch({gap: 5, unstable: true}));
  assert.ok(clear.allocatedMs < close.allocatedMs);
  assert.ok(close.allocatedMs < unstable.allocatedMs);
  assert.ok(clear.importance < close.importance && close.importance < unstable.importance);
  assert.ok(clear.reason.includes('clear-leader'));
  assert.ok(close.reason.includes('close-candidates'));
  assert.ok(unstable.reason.includes('unstable-principal'));
  assert.ok(unstable.reason.includes('volatile-score'));
  assert.ok(clear.allocatedMs >= 650 && unstable.allocatedMs <= 3500);
  for (let balance = 0; balance <= 1; balance += 0.2) {
    let previous = 0;
    for (let importance = 0; importance <= 1; importance += 0.05) {
      const allocation = context.allocationForImportance(importance, balance);
      assert.ok(allocation >= previous && allocation <= 3500);
      previous = allocation;
    }
  }
});

test('importance compares candidates from a common completed depth and identifies material exchanges', () => {
  const search = policySearch();
  search.iterations = new Map([[10, {1: search.info}], [9, {2: {score: {type: 'cp', value: 0}}}]]);
  const unpaired = context.assessImportance(search);
  assert.equal(unpaired.importanceInputs.gapCp, null);
  assert.ok(unpaired.reason.includes('limited-probe'));
  const quiet = context.assessImportance(policySearch());
  const capture = context.assessImportance(policySearch({
    fen: 'r3k4/9/9/9/4p4/9/9/9/9/R3K4 w - - 0 1', pv: ['a1a10'],
  }));
  assert.equal(capture.importanceInputs.tactics, 1);
  assert.ok(capture.reason.includes('material-tactics'));
  assert.ok(capture.allocatedMs > quiet.allocatedMs);
});

test('proven winning mate permits a short search while losing mate receives the maximum budget', () => {
  const winning = context.assessImportance(policySearch({mate: 3}));
  const losing = context.assessImportance(policySearch({mate: -3}));
  assert.equal(winning.importance, 0);
  assert.equal(winning.allocatedMs, 650);
  assert.equal(losing.importance, 1);
  assert.equal(losing.allocatedMs, 3500);
  const checked = policySearch();
  checked.rootInCheck = true;
  const defense = context.assessImportance(checked);
  assert.ok(defense.importance >= 0.85);
  assert.ok(defense.reason.includes('king-in-check'));
  const checkedMate = policySearch({mate: 2});
  checkedMate.rootInCheck = true;
  assert.equal(context.assessImportance(checkedMate).allocatedMs, 650);
  const forced = policySearch({mate: -4});
  forced.rootInCheck = true;
  forced.rootLegalMoves = 1;
  const forcedMove = context.assessImportance(forced);
  assert.equal(forcedMove.importance, 0);
  assert.equal(forcedMove.allocatedMs, 650);
  assert.ok(forcedMove.reason.includes('only-legal-move'));
});

test('adaptive stop waits for the minimum completed depth and initial probe', () => {
  const search = {...policySearch(), stopped: false, started: performance.now()};
  const commands = [];
  context.policySearch = search;
  context.testCommands = commands;
  vm.runInContext('var savedTestEngine = engine; engine = {postMessage: value => testCommands.push(value)}; active = policySearch;', context);
  try {
    search.info.depth = 5;
    context.checkAdaptiveBudget(search, 3400);
    assert.equal(commands.length, 0, 'depth below six must not trigger an adaptive stop');
    search.info.depth = 6;
    context.checkAdaptiveBudget(search, 449);
    assert.equal(commands.length, 0, 'probe must finish before an adaptive stop');
    context.checkAdaptiveBudget(search, 3400);
    assert.deepEqual(commands, ['stop']);
    context.checkAdaptiveBudget(search, 3450);
    assert.equal(commands.length, 1, 'stop must only be sent once');
  } finally {
    vm.runInContext('active = undefined; engine = savedTestEngine;', context);
    delete context.policySearch;
    delete context.testCommands;
  }
});

test('actual adaptive search returns paired candidate evidence and respects the turn deadline', async () => {
  const result = await request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, movetime: 3500, mode: 'adaptive', balance: 0.65, requestId: 'adaptive',
  });
  assert.match(result.bestmove, MOVE);
  assert.equal(result.mode, 'adaptive');
  assert.ok(result.depth >= 6);
  assert.ok(result.importance >= 0 && result.importance <= 1);
  assert.ok(result.allocatedMs >= 650 && result.allocatedMs <= 3500);
  assert.ok(result.importanceInputs.pairedDepth >= 6);
  assert.equal(result.legalMoves, 44);
  assert.ok(result.elapsedMs < 4300);
  assert.equal(result.bestmove, result.pv[0]);
  console.log('Adaptive engine:', JSON.stringify({
    depth: result.depth, importance: result.importance, allocatedMs: result.allocatedMs,
    elapsedMs: result.elapsedMs, reason: result.reason, inputs: result.importanceInputs,
  }));
});

test('actual engine diagnostics identify an in-check root without handwritten attack rules', async () => {
  const result = await request('XQ_ENGINE_ANALYZE', {
    fen: '4k4/4R4/9/9/4p4/9/9/9/9/4K4 b - - 0 1',
    movetime: 750, mode: 'adaptive', balance: 0.65,
  });
  assert.equal(result.inCheck, true);
  assert.equal(result.importanceInputs.inCheck, true);
  if (result.legalMoves !== 1 && !(result.score.type === 'mate' && result.score.value > 0)) {
    assert.ok(result.importance >= 0.85);
    assert.ok(result.reason.includes('king-in-check'));
  }
  assert.ok(result.elapsedMs < 1500);
  assert.match(result.bestmove, MOVE);
});

test('engine legal-move enumeration shortens forced defense and handles checkmate', async () => {
  const forced = await request('XQ_ENGINE_ANALYZE', {
    fen: '4k4/3RR4/9/9/4p4/9/9/9/9/4K4 b - - 0 1',
    movetime: 3500, mode: 'adaptive', balance: 0.65,
  });
  assert.equal(forced.inCheck, true);
  assert.equal(forced.legalMoves, 1);
  assert.equal(forced.bestmove, 'e10f10');
  assert.equal(forced.allocatedMs, 650);
  assert.ok(forced.reason.includes('only-legal-move'));
  assert.ok(forced.elapsedMs < 1300);
  const terminal = await request('XQ_ENGINE_ANALYZE', {
    fen: '4k4/3RR2N1/9/9/4p4/9/9/9/9/4K4 b - - 0 1',
    movetime: 750, mode: 'adaptive',
  });
  assert.equal(terminal.legalMoves, 0);
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.bestmove, null);
});

test('complete legal histories reconstruct repeated positions with repetition context', async () => {
  const moves = ['b1c3', 'b10c8', 'c3b1', 'c8b10'];
  const result = await request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, initialFen: START_FEN, moves: [...moves, ...moves],
    movetime: 150, mode: 'fixed', requestId: 'with-history',
  });
  assert.equal(result.historyUsed, true);
  assert.equal(result.historyPlies, 8);
  assert.match(result.bestmove, MOVE);
  assert.ok(result.elapsedMs < 1200);
});

test('history rejects malformed, excessive and wrong-parity move lists before searching', async () => {
  await assert.rejects(request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, initialFen: START_FEN, moves: ['b1c3'],
  }), /history turn does not match/);
  await assert.rejects(request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, initialFen: START_FEN, moves: ['b1c3\nquit', 'b10c8'],
  }), /Invalid Xiangqi move history/);
  await assert.rejects(request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, initialFen: START_FEN, moves: Array(1025).fill('b1c3'),
  }), /Invalid Xiangqi move history/);
  await assert.rejects(request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, moves: [],
  }), /Invalid Xiangqi FEN/);
});

test('engine detects a truncated illegal history even when the reconstructed board cycles back', async () => {
  await assert.rejects(request('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, initialFen: START_FEN,
    moves: ['b1c3', 'b10c8', 'c3b1', 'c8b10', 'a1a10', 'b10c8', 'c8b10', 'b10c8'],
    movetime: 150, mode: 'fixed',
  }), /Move history does not match/);
  await request('XQ_ENGINE_WARMUP');
  const fresh = await request('XQ_ENGINE_ANALYZE', {fen: START_FEN, movetime: 100, mode: 'fixed'});
  assert.equal(fresh.historyUsed, false);
  assert.match(fresh.bestmove, MOVE);
});

test('cancelling while history verification is pending prevents a late diagnostic from starting search', async () => {
  let fakeListener;
  let engineReceive;
  let notifyDiagnostic;
  let terminated = false;
  const diagnosticRequested = new Promise((resolve) => { notifyDiagnostic = resolve; });
  const commands = [];
  const fakeEngine = {
    addMessageListener: (receive) => { engineReceive = receive; },
    postMessage: (command) => {
      commands.push(command);
      if (command === 'uci') engineReceive('uciok');
      if (command === 'isready') engineReceive('readyok');
      if (command === 'd') notifyDiagnostic();
    },
    terminate: () => { terminated = true; },
  };
  const delayedContext = vm.createContext({
    console, performance, setTimeout, clearTimeout, setInterval, clearInterval,
    SharedArrayBuffer, crossOriginIsolated: true, Stockfish: async () => fakeEngine,
    chrome: {runtime: {
      id: 'history-cancel-test', getURL: (file) => file,
      onMessage: {addListener: (callback) => { fakeListener = callback; }},
    }},
  });
  vm.runInContext(fs.readFileSync(path.join(extension, 'offscreen.js'), 'utf8'), delayedContext);
  const send = (type, options) => new Promise((resolve, reject) => {
    fakeListener({target: 'offscreen', type, options}, {id: 'history-cancel-test'}, (response) => {
      if (response.ok) resolve(response.result); else reject(new Error(response.error));
    });
  });
  await send('XQ_ENGINE_WARMUP');
  const searching = send('XQ_ENGINE_ANALYZE', {
    fen: START_FEN, initialFen: START_FEN, moves: [], mode: 'fixed', movetime: 3500,
  });
  const rejected = assert.rejects(searching, /Search cancelled/);
  await diagnosticRequested;
  await send('XQ_ENGINE_CANCEL');
  await rejected;
  engineReceive('Fen: ' + START_FEN);
  assert.equal(terminated, true);
  assert.ok(!commands.includes('go infinite'));
});
