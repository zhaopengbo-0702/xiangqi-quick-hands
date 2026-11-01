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

test("unconfirmed destination sync errors stop at the deadline without authorizing an automatic retry", async () => {
  const { adapter, snapshot, destinations } = acknowledgementFixture(true);
  await assert.rejects(adapter.play("b3e3", snapshot, { deadline: performance.now() + 120 }), error =>
    error.code !== "XQ_STATE_SYNC" && /超时/.test(error.message));
  assert.equal(destinations(), 1);
});

test("bridge reads the live board props shape and derives side from piece case", () => {
  const callbacks = [];
  const posts = [];
  const boardContext = { fen: INITIAL, myPieceCase: "toUpperCase", isMyTurnNow: true, isDrawArrows: true, flipBoard: false };
  const game = { gamePlayData: { currentFen: INITIAL, initFen: INITIAL, moveCount: 0, turnNow: "red", state: 2, endReason: null, moves: [] }, gameData: { gameID: "live-game" }, boardContext };
  const root = { memoizedProps: game, return: null };
  const provider = { memoizedProps: { value: boardContext }, return: root };
  const board = { __reactFiber$test: { memoizedProps: { id: "game-grid" }, return: provider } };
  const location = { hostname: "play.xiangqi.com", pathname: "/computer-play", origin: "https://play.xiangqi.com" };
  const window = { addEventListener: (type, callback) => callbacks.push(callback), postMessage: (value) => posts.push(value) };
  const document = { querySelector: () => board };
  vm.runInNewContext(fs.readFileSync(require.resolve("../extension/page-bridge.js"), "utf8"), { window, location, document });
  callbacks[0]({ source: window, origin: location.origin, data: { type: "xiangqi-assistant:read", nonce: "0123456789abcdef0123456789abcdef", requestId: 1 } });
  assert.equal(posts[0].payload.playerSide, "red");
  assert.equal(posts[0].payload.isDrawArrows, true);
  assert.equal(posts[0].payload.gameID, "live-game");
  boardContext.myPieceCase = "toLowerCase";
  callbacks[0]({ source: window, origin: location.origin, data: { type: "xiangqi-assistant:read", nonce: "0123456789abcdef0123456789abcdef", requestId: 2 } });
  assert.equal(posts[1].payload.playerSide, "black");
});

test("right-click arrow support does not block a normal move", () => {
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  const snapshot = normalizeSnapshot({ playerSide: "red", isDrawArrows: true, gamePlayData: { initFen: INITIAL, currentFen: INITIAL, moveCount: 0, turnNow: "red", state: 2, endReason: null } });
  adapter.document = { visibilityState: "visible", querySelector: () => ({ querySelectorAll: () => Array(90), getBoundingClientRect: () => ({ width: 450, height: 500 }) }) };
  assert.doesNotThrow(() => adapter.assertReady(snapshot, snapshot));
});

test("allows only the verified computer, online lobby and game routes", () => {
  assert.equal(routeMode("/computer-play"), "computer");
  assert.equal(routeMode("/play"), "online");
  assert.equal(routeMode("/game/aB12_3-4"), "online");
  assert.equal(routeMode("/game/aB12_3-4/"), "online");
  for (const pathname of ["/watch/test", "/analysis/board", "/review/test", "/game/", "/game/id/review", "/play/other"]) assert.equal(routeMode(pathname), null);
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
  const location = { hostname: "play.xiangqi.com", pathname: "/game/online-id", origin: "https://play.xiangqi.com" };
  const window = { addEventListener: (type, callback) => callbacks.push(callback), postMessage: (value) => posts.push(value) };
  vm.runInNewContext(fs.readFileSync(require.resolve("../extension/page-bridge.js"), "utf8"), { window, location, document: { querySelector: () => board }, Date: { now: () => now } });
  const read = () => {
    callbacks[0]({ source: window, origin: location.origin, data: { type: "xiangqi-assistant:read", nonce: "0123456789abcdef0123456789abcdef", requestId: posts.length } });
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
      queueMicrotask(() => listener({ source: fakeWindow, origin: fakeWindow.location.origin, data: { type: "xiangqi-assistant:state", nonce: message.nonce, requestId: message.requestId, payload } }));
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
