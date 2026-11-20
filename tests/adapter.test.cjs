const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { XiangqiSiteAdapter, normalizeFen, routeMode, parseMove, displayCell, applyPlacement, normalizeSnapshot } = require("../extension/site-adapter.js");

const INITIAL = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1";

test("normalizes the site's red-side token without changing the position", () => {
  assert.equal(normalizeFen(INITIAL), INITIAL.replace(" r ", " w "));
  assert.throws(() => normalizeFen("9/9 r"));
  assert.throws(() => normalizeFen(INITIAL.replace("rnbakabnr", "rnbakabn")));
});

test("maps both board orientations including rank ten", () => {
  assert.deepEqual(parseMove("a10a9"), { from: { file: "a", rank: 10 }, to: { file: "a", rank: 9 } });
  assert.deepEqual(displayCell({ file: "a", rank: 10 }, true), { file: "i", rank: 1 });
  assert.deepEqual(displayCell({ file: "e", rank: 1 }, true), { file: "e", rank: 10 });
  assert.deepEqual(displayCell({ file: "b", rank: 3 }, false), { file: "b", rank: 3 });
  for (const move of ["a0a1", "j1a1", "a1a1", "a11a9", "a1a2 extra"]) assert.throws(() => parseMove(move));
});

test("pause during piece selection prevents the destination click", async () => {
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  const snapshot = normalizeSnapshot({ playerSide: "red", gameID: "cancel-test", gamePlayData: { initFen: INITIAL, currentFen: INITIAL, turnNow: "red", moveCount: 0, state: 2, endReason: null } });
  const rect = { left: 10, top: 10, width: 40, height: 40 };
  const source = { isConnected: true, classList: { contains: () => false } };
  const board = { querySelectorAll: () => [{ getBoundingClientRect: () => rect, querySelector: () => source }] };
  adapter.window = { performance };
  adapter.read = async () => snapshot;
  adapter.assertReady = () => board;
  adapter.squareElement = () => ({ getBoundingClientRect: () => rect });
  let cancelled = false, clicks = 0;
  adapter.clickTarget = () => { clicks += 1; cancelled = true; };
  await assert.rejects(adapter.play("b3e3", snapshot, { isCancelled: () => cancelled, deadline: performance.now() + 500 }), /取消/);
  assert.equal(clicks, 1);
});

test("an expired deadline prevents all board interaction", async () => {
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  adapter.window = { performance };
  adapter.read = async () => { throw new Error("Should not read"); };
  await assert.rejects(adapter.play("b3e3", {}, { deadline: performance.now() - 1 }), /超时/);
});

test("a hidden document can use a valid board while website modal obstruction still blocks clicks", () => {
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  const snapshot = normalizeSnapshot({ playerSide: "red", gameID: "hidden-test", gamePlayData: {
    initFen: INITIAL, currentFen: INITIAL, turnNow: "red", moveCount: 0, state: 2, endReason: null
  } });
  const rect = { left: 10, top: 10, width: 450, height: 500 };
  const board = { querySelectorAll: () => Array(90), getBoundingClientRect: () => rect, contains: hit => hit === target };
  const events = [];
  const target = { getBoundingClientRect: () => ({ left: 10, top: 10, width: 40, height: 40 }), dispatchEvent: event => events.push(event.type) };
  let hit = target;
  adapter.document = { visibilityState: "hidden", querySelector: () => board, elementFromPoint: () => hit };
  adapter.window = { MouseEvent: class { constructor(type) { this.type = type; } } };
  assert.equal(adapter.assertReady(snapshot, snapshot), board);
  adapter.clickTarget(target);
  assert.deepEqual(events, ['mousedown', 'mouseup', 'click']);
  hit = {};
  assert.throws(() => adapter.clickTarget(target), /弹窗遮挡/);
  assert.equal(events.length, 3);
});

test("acknowledgement placement identifies a move even after a fast bot reply", () => {
  assert.equal(applyPlacement(INITIAL, "b3e3"), "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/4C2C1/9/RNBAKABNR");
  assert.throws(() => applyPlacement(INITIAL, "a10a9"), /opponent/);
  assert.throws(() => applyPlacement(INITIAL, "b3h3"), /friendly/);
  assert.throws(() => applyPlacement(INITIAL, "a2a3"), /empty/);
});

test("requires explicit side and consistent turn and invalidates context changes", () => {
  const raw = { playerSide: "red", flipBoard: false, gameID: "test-game", gamePlayData: { currentFen: INITIAL, initFen: INITIAL, moveCount: 0, turnNow: "red", state: 2, endReason: null, moves: [] } };
  const snapshot = normalizeSnapshot(raw);
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.turn, "red");
  assert.notEqual(normalizeSnapshot({ ...raw, playerSide: "black" }).gameKey, snapshot.gameKey);
  assert.equal(normalizeSnapshot({ ...raw, loading: true }).active, false);
  assert.equal(normalizeSnapshot({ ...raw, historyMode: true }).historyMode, true);
  assert.throws(() => normalizeSnapshot({ ...raw, playerSide: null }));
  assert.throws(() => normalizeSnapshot({ ...raw, gamePlayData: { ...raw.gamePlayData, turnNow: "black" } }), { code: "XQ_STATE_SYNC" });
});

function acknowledgementFixture(persistent = false) {
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  const snapshot = normalizeSnapshot({ playerSide: "red", gameID: "ack-sync", gamePlayData: { initFen: INITIAL, currentFen: INITIAL, turnNow: "red", moveCount: 0, state: 2, endReason: null } });
  const rect = { left: 10, top: 10, width: 40, height: 40 };
  let selected = false, reads = 0, destinations = 0;
  const source = { isConnected: true, classList: { contains: () => selected } };
  const target = { classList: { contains: () => false } };
  const cell = { getBoundingClientRect: () => rect, children: [target] };
  const board = { querySelectorAll: () => [{ getBoundingClientRect: () => rect, querySelector: () => source }] };
  adapter.window = { performance };
  adapter.assertReady = () => board;
  adapter.squareElement = () => cell;
  adapter.clickTarget = element => { if (element === source) selected = true; else destinations++; };
  adapter.read = async () => {
    if (++reads <= 2) return snapshot;
    if (persistent || reads === 3) throw Object.assign(new Error("局面与行棋方不同步"), { code: "XQ_STATE_SYNC" });
    return { ...snapshot, fen: applyPlacement(INITIAL, "b3e3") + " b - - 0 1", moveCount: 1 };
  };
  return { adapter, snapshot, destinations: () => destinations };
}

test("transient acknowledgement sync errors confirm the original move without a second click", async () => {
  const { adapter, snapshot, destinations } = acknowledgementFixture();
  const after = await adapter.play("b3e3", snapshot, { deadline: performance.now() + 500 });
  assert.equal(after.moveCount, 1);
  assert.equal(destinations(), 1);
});

test("unconfirmed destination sync errors keep reading past the action deadline until manual cancellation", async () => {
  const { adapter, snapshot, destinations } = acknowledgementFixture(true);
  let now = 0, cancelled = false;
  adapter.window.performance = { now: () => now };
  adapter.delay = async milliseconds => { now += milliseconds; if (now >= 600) cancelled = true; };
  await assert.rejects(adapter.play("b3e3", snapshot, { deadline: 120, isCancelled: () => cancelled }), {
    code: "XQ_CANCELLED", actionStage: "destination-dispatched",
  });
  assert.ok(now >= 600);
  assert.equal(destinations(), 1);
});

function delayedAcknowledgementFixture({ delayMs = 900, wrongMove = false, fastReply = false, onDestination } = {}) {
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  const raw = { playerSide: "red", gameID: "delayed-ack", gamePlayData: {
    initFen: INITIAL, currentFen: INITIAL, turnNow: "red", moveCount: 0, state: 2, endReason: null
  } };
  const snapshot = normalizeSnapshot(raw);
  const ownFen = applyPlacement(INITIAL, wrongMove ? "b3d3" : "b3e3") + " b - - 1 1";
  const publishedFen = fastReply ? applyPlacement(ownFen, "a7a6") + " w - - 0 2" : ownFen;
  const after = normalizeSnapshot({ ...raw, gamePlayData: { ...raw.gamePlayData,
    currentFen: publishedFen, turnNow: fastReply ? "red" : "black", moveCount: fastReply ? 2 : 1,
    moves: fastReply ? [{ uci: "b3e3", currentFen: ownFen, index: 0 }] : []
  } });
  const rect = { left: 10, top: 10, width: 40, height: 40 };
  let selected = false, destinationAt = null, destinations = 0;
  const source = { isConnected: true, classList: { contains: () => selected } };
  const target = { classList: { contains: () => false } };
  adapter.window = { performance };
  adapter.assertReady = () => ({ querySelectorAll: () => [{ getBoundingClientRect: () => rect, querySelector: () => source }] });
  adapter.squareElement = () => ({ getBoundingClientRect: () => rect, children: [target] });
  adapter.clickTarget = element => {
    if (element === source) selected = true;
    else { destinations++; destinationAt = performance.now(); onDestination?.(); }
  };
  adapter.read = async () => destinationAt !== null && performance.now() - destinationAt >= delayMs ? after : snapshot;
  return { adapter, snapshot, destinations: () => destinations };
}

test("a board published after 900ms confirms the original destination without another start or click", async () => {
  const { adapter, snapshot, destinations } = delayedAcknowledgementFixture();
  const started = performance.now();
  const after = await adapter.play("b3e3", snapshot, { deadline: started + 2200 });
  assert.equal(after.moveCount, 1);
  assert.ok(performance.now() - started >= 900);
  assert.equal(destinations(), 1);
});

test("a fast opponent reply is acknowledged through the published own move history", async () => {
  const { adapter, snapshot, destinations } = delayedAcknowledgementFixture({ delayMs: 0, fastReply: true });
  const after = await adapter.play("b3e3", snapshot, { deadline: performance.now() + 500 });
  assert.equal(after.moveCount, 2);
  assert.equal(destinations(), 1);
});

test("a different published move pauses rather than confirming or repeating the destination", async () => {
  const { adapter, snapshot, destinations } = delayedAcknowledgementFixture({ delayMs: 0, wrongMove: true });
  await assert.rejects(adapter.play("b3e3", snapshot, { deadline: performance.now() + 500 }), /局面与预期不同/);
  assert.equal(destinations(), 1);
});

test("an acknowledgement after 1500ms and the input deadline confirms only the original click", async () => {
  const { adapter, snapshot, destinations } = delayedAcknowledgementFixture();
  let now = 0;
  adapter.window.performance = { now: () => now };
  adapter.delay = async milliseconds => { now += milliseconds; };
  const initialRead = adapter.read;
  const after = { ...snapshot, fen: applyPlacement(INITIAL, "b3e3") + " b - - 1 1", moveCount: 1 };
  adapter.read = async options => {
    if (destinations() && now >= 1800) return after;
    if (destinations()) return snapshot;
    return initialRead(options);
  };
  const confirmed = await adapter.play("b3e3", snapshot, { deadline: 150 });
  assert.equal(confirmed.moveCount, 1);
  assert.ok(now >= 1800);
  assert.equal(destinations(), 1);
});

test("pausing after the destination cancels acknowledgement without another click", async () => {
  let cancelled = false;
  const { adapter, snapshot, destinations } = delayedAcknowledgementFixture({ onDestination: () => { cancelled = true; } });
  await assert.rejects(adapter.play("b3e3", snapshot, { deadline: performance.now() + 500, isCancelled: () => cancelled }), /取消/);
  assert.equal(destinations(), 1);
});

test("version two board requests ignore obsolete bridge responses after extension updates", async () => {
  let receive;
  const raw = { mode: "computer", route: "/computer-play", playerSide: "red", gamePlayData: {
    initFen: INITIAL, currentFen: INITIAL, moveCount: 0, turnNow: "red", state: 2, endReason: null
  } };
  const fakeWindow = {
    location: { hostname: "play.xiangqi.com", pathname: "/computer-play", origin: "https://play.xiangqi.com" },
    crypto: require("node:crypto").webcrypto, performance,
    addEventListener: (_type, callback) => { receive = callback; }, removeEventListener() {},
    postMessage(message) {
      assert.equal(message.type, "xiangqi-assistant:read:v3");
      const response = { nonce: message.nonce, requestId: message.requestId };
      receive({ source: fakeWindow, origin: fakeWindow.location.origin, data: { ...response,
        type: "xiangqi-assistant:state", payload: { error: "obsolete-state" } } });
      receive({ source: fakeWindow, origin: fakeWindow.location.origin, data: { ...response,
        type: "xiangqi-assistant:state:v3", payload: raw } });
    }
  };
  const adapter = new XiangqiSiteAdapter({ window: fakeWindow, document: {} });
  assert.equal((await adapter.read()).moveCount, 0);
  adapter.destroy();
});

test("bridge reads the live board props shape and derives side from piece case", () => {
  const callbacks = [];
  const posts = [];
  const boardContext = { fen: INITIAL, myPieceCase: "toUpperCase", isMyTurnNow: true, isDrawArrows: true, flipBoard: false };
  const game = { gamePlayData: { currentFen: INITIAL, initFen: INITIAL, moveCount: 0, turnNow: "red", state: 2, endReason: null, moves: [] }, gameData: { gameID: "live-game" }, boardContext };
  const root = { memoizedProps: game, return: null };
  const provider = { memoizedProps: { value: boardContext }, return: root };
  const board = { __reactFiber$test: { memoizedProps: { id: "game-grid" }, return: provider } };
  Object.assign(root, { tag: 3, stateNode: { current: root }, child: provider });
  provider.child = board.__reactFiber$test;
  const location = { hostname: "play.xiangqi.com", pathname: "/computer-play", origin: "https://play.xiangqi.com" };
  const window = { addEventListener: (type, callback) => callbacks.push(callback), postMessage: (value) => posts.push(value) };
  const document = { querySelector: () => board };
  vm.runInNewContext(fs.readFileSync(require.resolve("../extension/page-bridge.js"), "utf8"), { window, location, document });
  callbacks[0]({ source: window, origin: location.origin, data: { type: "xiangqi-assistant:read:v3", nonce: "0123456789abcdef0123456789abcdef", requestId: 1 } });
  assert.equal(posts[0].payload.playerSide, "red");
  assert.equal(posts[0].payload.isDrawArrows, true);
  assert.equal(posts[0].payload.gameID, "live-game");
  boardContext.myPieceCase = "toLowerCase";
  callbacks[0]({ source: window, origin: location.origin, data: { type: "xiangqi-assistant:read:v3", nonce: "0123456789abcdef0123456789abcdef", requestId: 2 } });
  assert.equal(posts[1].payload.playerSide, "black");
});

test("right-click arrow support does not block a normal move", () => {
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  const snapshot = normalizeSnapshot({ playerSide: "red", isDrawArrows: true, gamePlayData: { initFen: INITIAL, currentFen: INITIAL, moveCount: 0, turnNow: "red", state: 2, endReason: null } });
  adapter.document = { visibilityState: "visible", querySelector: () => ({ querySelectorAll: () => Array(90), getBoundingClientRect: () => ({ width: 450, height: 500 }) }) };
  assert.doesNotThrow(() => adapter.assertReady(snapshot, snapshot));
});

test("classifies verified game routes separately from read-only analysis routes", () => {
  assert.equal(routeMode("/computer-play"), "computer");
  assert.equal(routeMode("/play"), "online");
  assert.equal(routeMode("/game/aB12_3-4"), "online");
  assert.equal(routeMode("/game/aB12_3-4/"), "online");
  for (const pathname of ["/watch/test", "/analysis/board", "/review/test"]) assert.equal(routeMode(pathname), "analysis");
  for (const pathname of ["/game/", "/game/id/review", "/play/other"]) assert.equal(routeMode(pathname), null);
});

test("bridge adapts online footer participant proof and server-adjusted clock", () => {
  const callbacks = [], posts = [];
  const now = 1700000000000;
  const boardContext = { fen: INITIAL, myPieceCase: "toLowerCase", isMyTurnNow: false, isDrawArrows: true, flipBoard: true, viewOnly: false };
  const footerContext = { isGamePlayer: true, isMyTurnNow: false, moveCount: 0, gameID: "online-id", gameState: 2, endReason: null, isTimed: true, isDaily: false };
  const data = { currentFen: INITIAL, initFen: INITIAL, turnNow: "red", state: 2, endReason: null, moves: [], timers: { server_clock: now - 1500, red: { game_secs: 300, move_secs: 20 }, black: { game_secs: 240, move_secs: 10 } } };
  const root = { memoizedProps: { gamePlayData: data, gameData: { gameID: "online-id", isTimed: true } }, return: null };
  const holder = { memoizedProps: { boardContext, footerContext }, return: root };
  const provider = { memoizedProps: { value: boardContext }, return: holder };
  const board = { __reactFiber$test: { memoizedProps: { id: "game-grid" }, return: provider } };
  Object.assign(root, { tag: 3, stateNode: { current: root }, child: holder });
  holder.child = provider;
  provider.child = board.__reactFiber$test;
  const location = { hostname: "play.xiangqi.com", pathname: "/game/online-id", origin: "https://play.xiangqi.com" };
  const window = { addEventListener: (type, callback) => callbacks.push(callback), postMessage: (value) => posts.push(value) };
  vm.runInNewContext(fs.readFileSync(require.resolve("../extension/page-bridge.js"), "utf8"), { window, location, document: { querySelector: () => board }, Date: { now: () => now } });
  const read = () => {
    callbacks[0]({ source: window, origin: location.origin, data: { type: "xiangqi-assistant:read:v3", nonce: "0123456789abcdef0123456789abcdef", requestId: posts.length } });
    return posts.at(-1).payload;
  };
  const first = read();
  assert.equal(first.mode, "online");
  assert.equal(first.participant, true);
  assert.equal(first.playerSide, "black");
  assert.equal(first.clockRemainingMs, 10000);
  assert.equal(first.gamePlayData.moveCount, 0);
  assert.deepEqual([...first.completeUciMoves], []);
  boardContext.myPieceCase = "toUpperCase";
  assert.equal(read().clockRemainingMs, 18500);
  root.memoizedProps.gameData.moveTimer = 0;
  data.timers.server_clock = now;
  data.timers.red.game_secs = 60;
  data.timers.red.move_secs = 0;
  assert.equal(read().clockRemainingMs, 60000);
  root.memoizedProps.gameData.moveTimer = 2;
  assert.equal(read().clockRemainingMs, 0);
  footerContext.isGamePlayer = false;
  boardContext.myPieceCase = "";
  const spectator = normalizeSnapshot(read());
  assert.equal(spectator.playerSide, null);
  assert.equal(spectator.participant, false);
  assert.equal(spectator.active, false);
  location.pathname = "/play";
  assert.equal(read().error, "board-not-ready");
});

test("online reads reject wrong-mode and stale-route responses", async () => {
  let listener;
  const payload = { mode: "computer", route: "/game/owned", participant: true, playerSide: "red", gamePlayData: { initFen: INITIAL, currentFen: INITIAL, moveCount: 0, turnNow: "red", state: 2, endReason: null } };
  const fakeWindow = {
    location: { hostname: "play.xiangqi.com", pathname: "/game/owned", origin: "https://play.xiangqi.com" },
    crypto: require("node:crypto").webcrypto, performance,
    addEventListener(type, callback) { listener = callback; }, removeEventListener() {},
    postMessage(message) {
      queueMicrotask(() => listener({ source: fakeWindow, origin: fakeWindow.location.origin, data: { type: "xiangqi-assistant:state:v3", nonce: message.nonce, requestId: message.requestId, payload } }));
    }
  };
  const adapter = new XiangqiSiteAdapter({ window: fakeWindow, document: {} });
  await assert.rejects(adapter.read(), /类型已变化/);
  payload.mode = "online";
  payload.route = "/game/other";
  await assert.rejects(adapter.read(), /页面已变化/);
  payload.route = "/game/owned";
  payload.participant = false;
  assert.equal((await adapter.read()).active, false);
  adapter.destroy();
});

test("only complete bounded UCI history is supplied to the engine", () => {
  const raw = { playerSide: "red", completeUciMoves: ["b3e3", "h8e8"], gamePlayData: { initFen: INITIAL, currentFen: INITIAL, moveCount: 2, turnNow: "red", state: 2, endReason: null } };
  assert.deepEqual(normalizeSnapshot(raw).moves, ["b3e3", "h8e8"]);
  assert.equal(normalizeSnapshot({ ...raw, completeUciMoves: ["b3e3"] }).moves, undefined);
  assert.equal(normalizeSnapshot({ ...raw, completeUciMoves: ["b3e3", "h0e8"] }).moves, undefined);
  assert.equal(normalizeSnapshot({ ...raw, completeUciMoves: Array(1025).fill("b3e3"), gamePlayData: { ...raw.gamePlayData, moveCount: 1025 } }).moves, undefined);
  assert.equal(normalizeSnapshot({ ...raw, completeUciMoves: undefined }).moves, undefined);
});

test("an owned turn may land below one second but preserves the action margin", () => {
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  adapter.document = { visibilityState: "visible", querySelector: () => ({ querySelectorAll: () => Array(90), getBoundingClientRect: () => ({ width: 450, height: 500 }) }) };
  const raw = { mode: "online", participant: true, playerSide: "red", isMyTurnNow: true, clockRemainingMs: 900, gamePlayData: { initFen: INITIAL, currentFen: INITIAL, moveCount: 0, turnNow: "red", state: 2, endReason: null } };
  const enough = normalizeSnapshot(raw);
  assert.equal(enough.active, true);
  assert.doesNotThrow(() => adapter.assertReady(enough, enough));
  const low = normalizeSnapshot({ ...raw, clockRemainingMs: 100 });
  assert.throws(() => adapter.assertReady(low, low), /剩余时间不足/);
  assert.equal(normalizeSnapshot({ ...raw, clockRemainingMs: 0 }).active, false);
});
