const MOVE = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/;
const MAX_MOVETIME = 3500;
const WATCHDOG_MS = 4300;
const MIN_DEPTH = 6;
const PROBE_MS = 450;
const MIN_ALLOCATION_MS = 650;
let engine;
let readyPromise;
let active;
let waiters = [];
let engineMetadata;
let backgroundPulseTimer = null;
let heartbeatPending = false;

function setBackgroundPulse(enabled) {
  if (!enabled) {
    clearInterval(backgroundPulseTimer);
    backgroundPulseTimer = null;
    return { enabled: false };
  }
  if (backgroundPulseTimer === null) backgroundPulseTimer = setInterval(() => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    Promise.resolve().then(() => chrome.runtime.sendMessage({ target: 'background', type: 'XQ_BACKGROUND_HEARTBEAT' }))
      .catch(() => {})
      .finally(() => { heartbeatPending = false; });
  }, 100);
  return { enabled: true };
}

function validateFen(fen) {
  if (typeof fen !== 'string' || fen.length > 180) throw new Error('Invalid Xiangqi FEN.');
  const fields = fen.split(' ');
  if (fields.length !== 6 || !/^[wb]$/.test(fields[1]) ||
      fields[2] !== '-' || fields[3] !== '-' ||
      !/^\d+$/.test(fields[4]) || !/^[1-9]\d*$/.test(fields[5])) {
    throw new Error('Invalid Xiangqi FEN fields.');
  }
  const rows = fields[0].split('/');
  if (rows.length !== 10 || rows.some((row) => !/^[1-9rnbakcpRNBAKCP]+$/.test(row) ||
      [...row].reduce((sum, item) => sum + (/\d/.test(item) ? Number(item) : 1), 0) !== 9) ||
      (fields[0].match(/k/g) || []).length !== 1 ||
      (fields[0].match(/K/g) || []).length !== 1) {
    throw new Error('Invalid Xiangqi board.');
  }
}

function validateHistory(options) {
  if (options.initialFen === undefined && options.moves === undefined) return null;
  validateFen(options.initialFen);
  if (!Array.isArray(options.moves) || options.moves.length > 1024 ||
      options.moves.some((move) => typeof move !== 'string' || !MOVE.test(move))) {
    throw new Error('Invalid Xiangqi move history.');
  }
  const initial = options.initialFen.split(' ');
  const initialFullmove = Number(initial[5]);
  const expectedFullmove = initialFullmove + Math.floor((options.moves.length + (initial[1] === 'b' ? 1 : 0)) / 2);
  if (!Number.isSafeInteger(initialFullmove) || expectedFullmove > 1000000000) {
    throw new Error('Invalid Xiangqi history move number.');
  }
  const side = options.moves.length % 2 ? (initial[1] === 'w' ? 'b' : 'w') : initial[1];
  if (options.fen.split(' ')[1] !== side) throw new Error('Move history turn does not match the current board.');
  return {initialFen: options.initialFen, moves: [...options.moves], expectedFullmove};
}

function parseInfo(line) {
  const number = (field) => {
    const match = line.match(new RegExp('(?:^| )' + field + ' (-?\\d+)(?: |$)'));
    return match ? Number(match[1]) : undefined;
  };
  const score = line.match(/\bscore (cp|mate) (-?\d+)/);
  const pv = line.match(/\bpv (.+)$/)?.[1].trim().split(/\s+/);
  const depth = number('depth');
  const completed = depth !== undefined && score && pv?.length &&
    pv.every((move) => MOVE.test(move)) && !/\b(?:lowerbound|upperbound)\b/.test(line);
  return {
    nodes: number('nodes'),
    ...(completed ? {depth, multipv: number('multipv') || 1,
      score: {type: score[1], value: Number(score[2])}, pv} : {}),
  };
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function allocationForImportance(importance, balance = 0.65, limitMs = MAX_MOVETIME) {
  return Math.round(Math.min(limitMs, MIN_ALLOCATION_MS +
    (MAX_MOVETIME - MIN_ALLOCATION_MS) * clamp(importance, 0, 1) ** (1.4 - balance * 0.8)));
}

function materialPressure(fen, pv) {
  const occupied = new Map();
  fen.split(' ')[0].split('/').forEach((row, index) => {
    let file = 0;
    for (const piece of row) {
      if (/\d/.test(piece)) file += Number(piece);
      else occupied.set(String.fromCharCode(97 + file++) + (10 - index), piece);
    }
  });
  let pressure = 0;
  // Replay engine-generated coordinates only; the engine owns move legality.
  for (const move of pv.slice(0, 4)) {
    const match = move.match(MOVE);
    if (!match) break;
    const from = match[1] + match[2];
    const to = match[3] + match[4];
    const moving = occupied.get(from);
    if (!moving) break;
    const captured = occupied.get(to)?.toLowerCase();
    pressure = Math.max(pressure, ({r: 1, c: 0.8, n: 0.7})[captured] || 0);
    occupied.set(to, moving);
    occupied.delete(from);
  }
  return pressure;
}

function assessImportance(search) {
  const best = search.info;
  const recent = search.history.slice(-6);
  let paired;
  for (const [depth, candidates] of search.iterations) {
    if (candidates[1] && candidates[2] && (!paired || depth > paired.depth)) {
      paired = {depth, candidates};
    }
  }
  let gapCp = null;
  if (paired?.candidates[1].score.type === 'cp' && paired.candidates[2].score.type === 'cp') {
    gapCp = Math.max(0, paired.candidates[1].score.value - paired.candidates[2].score.value);
  }
  const uncertainty = gapCp === null ? 0.85 : Math.exp(-gapCp / 120);
  let changes = 0;
  let largestSwing = 0;
  for (let index = 1; index < recent.length; index++) {
    if (recent[index].pv[0] !== recent[index - 1].pv[0]) changes++;
    if (recent[index].score.type === 'cp' && recent[index - 1].score.type === 'cp') {
      largestSwing = Math.max(largestSwing, Math.abs(recent[index].score.value - recent[index - 1].score.value));
    }
  }
  const churn = recent.length > 1 ? changes / (recent.length - 1) : 0;
  const volatility = Math.min(1, largestSwing / 120);
  const tactics = materialPressure(search.fen, best.pv);
  let importance = clamp(0.05 + 0.45 * uncertainty + 0.2 * churn + 0.2 * volatility + 0.2 * tactics, 0, 1);
  const reason = [];
  if (search.rootLegalMoves === 1) {
    importance = 0;
    reason.push('only-legal-move');
  } else if (best.score?.type === 'mate') {
    importance = best.score.value > 0 ? 0 : 1;
    reason.push(best.score.value > 0 ? 'winning-mate' : 'defensive-mate');
  } else {
    if (gapCp === null) reason.push('limited-probe');
    else if (gapCp <= 60) reason.push('close-candidates');
    else if (gapCp >= 200) reason.push('clear-leader');
    if (churn >= 0.4) reason.push('unstable-principal');
    if (volatility >= 0.4) reason.push('volatile-score');
    if (tactics >= 0.7) reason.push('material-tactics');
    if (!reason.length) reason.push('balanced-search');
  }
  if (search.rootInCheck && search.rootLegalMoves !== 1 &&
      !(best.score?.type === 'mate' && best.score.value > 0)) {
    importance = Math.max(importance, 0.85);
    reason.push('king-in-check');
  }
  return {
    importance: Math.round(importance * 1000) / 1000,
    allocatedMs: allocationForImportance(importance, search.balance, search.limitMs), reason,
    importanceInputs: {gapCp, uncertainty, churn, volatility, tactics,
      pairedDepth: paired?.depth ?? null, inCheck: search.rootInCheck ?? null,
      legalMoves: search.rootLegalMoves ?? null},
  };
}

function requestStop(search, stopReason) {
  if (active !== search || search.stopped) return;
  search.stopped = true;
  search.stopReason = stopReason;
  engine.postMessage('stop');
}

function checkAdaptiveBudget(search, elapsedMs = performance.now() - search.started) {
  if (active !== search || search.stopped || search.mode !== 'adaptive' || elapsedMs < PROBE_MS) return;
  search.allocation = assessImportance(search);
  const winningMate = search.info.score?.type === 'mate' && search.info.score.value > 0;
  if ((search.info.depth >= MIN_DEPTH || winningMate) && elapsedMs >= search.allocation.allocatedMs) {
    requestStop(search, winningMate ? 'winning-mate' : 'adaptive-budget');
  }
}

function startPreparedSearch(search) {
  if (active !== search || search.stopped || search.searchStarted) return;
  search.searchStarted = true;
  if (search.mode === 'adaptive' && !(engine.pikafish &&
      (search.reconstructedHalfmove >= 120 || search.reconstructedFullmove > 100000))) {
    engine.postMessage('go perft 1');
  }
  engine.postMessage('go infinite');
}

function verifyHistoryPosition(search, fen) {
  try {
    validateFen(fen);
    const actual = fen.split(' ');
    const expected = search.fen.split(' ');
    if (actual[0] !== expected[0] || actual[1] !== expected[1] ||
        Number(actual[5]) !== search.positionHistory.expectedFullmove) {
      throw new Error('Move history does not match the current board.');
    }
    search.reconstructedHalfmove = Number(actual[4]);
    search.reconstructedFullmove = Number(actual[5]);
    search.historyVerified = true;
    startPreparedSearch(search);
  } catch (error) {
    settle(null, error, true);
  }
}

function waitFor(predicate, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const waiter = {predicate, resolve, reject};
    waiter.timer = setTimeout(() => {
      waiters = waiters.filter((item) => item !== waiter);
      reject(new Error('Engine initialization timed out.'));
    }, timeoutMs);
    waiters.push(waiter);
  });
}

function receive(line) {
  for (const waiter of [...waiters]) {
    if (!waiter.predicate(line)) continue;
    clearTimeout(waiter.timer);
    waiters = waiters.filter((item) => item !== waiter);
    waiter.resolve(line);
  }
  if (!active) return;
  if (line.startsWith('Fen: ') && active.positionHistory && !active.historyVerified) {
    verifyHistoryPosition(active, line.slice('Fen: '.length).trim());
  } else if (line.startsWith('Checkers:')) {
    active.rootInCheck = line.slice('Checkers:'.length).trim().length > 0;
  } else if (/^Nodes searched:\s*\d+\s*$/.test(line)) {
    active.rootLegalMoves = Number(line.match(/\d+/)[0]);
  } else if (line.startsWith('info ')) {
    const info = parseInfo(line);
    if (info.nodes !== undefined) active.info.nodes = info.nodes;
    if (info.depth !== undefined) {
      const candidates = active.iterations.get(info.depth) || {};
      candidates[info.multipv] = info;
      active.iterations.set(info.depth, candidates);
      if (info.multipv === 1 && info.depth >= active.info.depth) {
        Object.assign(active.info, {depth: info.depth, score: info.score, pv: info.pv});
        const previous = active.history.at(-1);
        if (previous?.depth === info.depth) active.history[active.history.length - 1] = info;
        else active.history.push(info);
        active.history = active.history.slice(-6);
      }
      for (const depth of active.iterations.keys()) {
        if (depth < active.info.depth - 6) active.iterations.delete(depth);
      }
      checkAdaptiveBudget(active);
    }
  } else if (line.startsWith('bestmove ')) {
    const bestmove = line.split(/\s+/)[1];
    if (bestmove === '(none)' || bestmove === '0000') {
      settle({bestmove: null, terminal: true});
    } else if (MOVE.test(bestmove)) {
      settle({bestmove});
    } else {
      settle(null, new Error('Engine returned an invalid move.'));
    }
  }
}

function resetEngine() {
  engine?.terminate();
  engine = undefined;
  engineMetadata = undefined;
  readyPromise = undefined;
  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('Engine restarted.'));
  }
  waiters = [];
}

function settle(result, error, reset = false) {
  if (!active) return;
  const search = active;
  active = undefined;
  clearTimeout(search.stopTimer);
  clearTimeout(search.watchdog);
  clearInterval(search.adaptiveTimer);
  if (reset) resetEngine();
  if (error) search.reject(error);
  else search.resolve({
    ...search.info,
    ...(search.mode === 'adaptive' ? search.allocation || assessImportance(search) :
      {importance: null, allocatedMs: search.limitMs, reason: ['fixed-budget']}),
    mode: search.mode, balance: search.balance, inCheck: search.rootInCheck ?? null,
    legalMoves: search.rootLegalMoves ?? null,
    historyUsed: Boolean(search.positionHistory && search.historyVerified),
    historyPlies: search.positionHistory?.moves.length || 0,
    engineName: search.engineMetadata?.name || 'Fairy-Stockfish',
    backend: search.engineMetadata?.backend || 'wasm',
    nativeError: search.engineMetadata?.nativeError || null,
    nnue: search.engineMetadata?.nnue || null,
    nnueVerified: search.engineMetadata?.nnueVerified === true,
    stopReason: search.stopReason || 'engine-finished',
    ...result, requestId: search.requestId,
    elapsedMs: Math.round(performance.now() - search.started),
  });
}

async function warmup() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const pikafish = typeof createPikafishEngine === 'function';
    if (pikafish) {
      engine = await createPikafishEngine({onError: (error) => {
        if (active) settle(null, error, true); else resetEngine();
      }});
      engineMetadata = engine.metadata;
    } else {
      if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
        throw new Error('Engine requires extension cross-origin isolation (Chrome 116+).');
      }
      engine = await Stockfish({locateFile: (name) => chrome.runtime.getURL('engine/' + name)});
      engineMetadata = {name:'Fairy-Stockfish', backend:'wasm', nnue:null, nnueVerified:false};
    }
    const initializedEngine = engine;
    engine.addMessageListener((line) => { if (engine === initializedEngine) receive(line); });
    const uci = waitFor((line) => line === 'uciok');
    engine.postMessage('uci');
    await uci;
    if (!pikafish) {
      engine.postMessage('setoption name UCI_Variant value xiangqi');
      engine.postMessage('setoption name Use NNUE value false');
      engine.postMessage('setoption name Threads value 1');
      engine.postMessage('setoption name Hash value 32');
    }
    engine.postMessage('setoption name Move Overhead value 30');
    const ready = waitFor((line) => line === 'readyok');
    engine.postMessage('isready');
    await ready;
    return {ready:true, ...engineMetadata, variant:'xiangqi'};
  })().catch((error) => {
    resetEngine();
    throw error;
  });
  return readyPromise;
}

async function analyze(options) {
  validateFen(options?.fen);
  const positionHistory = validateHistory(options);
  await warmup();
  if (active) throw new Error('The engine is already searching.');
  if (engine.pikafish) {
    const setup = (positionHistory?.initialFen || options.fen).split(' ');
    if (Number(setup[4]) >= 120 || Number(setup[5]) > 100000) {
      throw new Error('Pikafish requires a valid starting counter; supply complete history for long repetitions.');
    }
  }
  const movetime = Math.max(100, Math.min(MAX_MOVETIME, Number(options.movetime) || MAX_MOVETIME));
  const mode = options.mode === 'fixed' ? 'fixed' : 'adaptive';
  const balance = Number.isFinite(Number(options.balance)) ? clamp(Number(options.balance), 0, 1) : 0.65;
  return new Promise((resolve, reject) => {
    active = {
      resolve, reject, requestId: options.requestId, started: performance.now(),
      mode, balance, fen: options.fen, limitMs: movetime, history: [], iterations: new Map(),
      positionHistory, historyVerified: false,
      engineMetadata,
      reconstructedHalfmove: Number(options.fen.split(' ')[4]),
      reconstructedFullmove: Number(options.fen.split(' ')[5]),
      rootInCheck: null, rootLegalMoves: null,
      info: {depth: 0, nodes: 0, score: null, pv: []},
    };
    const search = active;
    active.stopTimer = setTimeout(() => requestStop(search, mode === 'adaptive' ? 'hard-limit' : 'fixed-budget'), movetime);
    if (mode === 'adaptive') active.adaptiveTimer = setInterval(() => checkAdaptiveBudget(search), 50);
    active.watchdog = setTimeout(() => {
      const bestmove = active?.info.pv?.[0];
      if (bestmove && MOVE.test(bestmove)) settle({bestmove, timedOut: true}, null, true);
      else settle(null, new Error('Engine deadline exceeded without a legal principal variation.'), true);
    }, WATCHDOG_MS);
    engine.postMessage('setoption name MultiPV value ' + (mode === 'adaptive' ? 2 : 1));
    engine.postMessage('position fen ' + (positionHistory ? positionHistory.initialFen +
      (positionHistory.moves.length ? ' moves ' + positionHistory.moves.join(' ') : '') : options.fen));
    if (mode === 'adaptive' || positionHistory) engine.postMessage('d');
    if (!positionHistory) startPreparedSearch(search);
  });
}

function cancel() {
  if (!active) return {cancelled: false};
  // Restart on cancellation so a late bestmove cannot satisfy a later request.
  settle(null, new Error('Search cancelled.'), true);
  return {cancelled: true};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.target !== 'offscreen') return;
  let operation;
  if (message.type === 'XQ_ENGINE_WARMUP') operation = warmup;
  else if (message.type === 'XQ_ENGINE_ANALYZE') operation = () => analyze(message.options);
  else if (message.type === 'XQ_ENGINE_CANCEL') operation = cancel;
  else if (message.type === 'XQ_ENGINE_PULSE') operation = () => setBackgroundPulse(message.enabled === true);
  else return;
  Promise.resolve().then(operation).then(
    (result) => sendResponse({ok: true, result}),
    (error) => sendResponse({ok: false, error: error.message}),
  );
  return true;
});
