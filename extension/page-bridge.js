(function () {
  "use strict";

  if (window.__xiangqiAssistantBridgeV1) return;
  window.__xiangqiAssistantBridgeV1 = true;
  const REQUEST = "xiangqi-assistant:read";
  const RESPONSE = "xiangqi-assistant:state";

  function shortString(value, limit) {
    return typeof value === "string" && value.length <= limit ? value : null;
  }

  function routeMode(pathname) {
    if (pathname === "/computer-play") return "computer";
    if (pathname === "/play" || /^\/game\/[^/]+\/?$/.test(pathname)) return "online";
    return null;
  }

  function findState() {
    const mode = routeMode(location.pathname);
    if (location.hostname !== "play.xiangqi.com" || !mode) {
      return { error: "unsupported-route" };
    }
    if (location.pathname === "/play") return { error: "board-not-ready" };
    const board = document.querySelector("#game-grid");
    if (!board) return { error: "board-not-ready" };
    const key = Object.keys(board).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
    if (!key) return { error: "react-state-unavailable" };

    let fiber = board[key];
    let root = fiber;
    for (let depth = 0; root?.return && depth < 150; depth += 1) root = root.return;
    if (root?.stateNode?.current === root?.alternate && fiber.alternate) fiber = fiber.alternate;
    let game = null;
    let context = null;
    let footer = null;
    let connected = null;
    const seen = new Set();
    // Only inspect the board's ancestors and known prop paths, never the global store.
    for (let depth = 0; fiber && depth < 100; depth += 1, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (!props || typeof props !== "object") continue;
      const candidates = [props, props.value, props.botState, props.botGameData?.botState, props.sidebarProps, props.sidebarData];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object" || seen.has(candidate)) continue;
        seen.add(candidate);
        if (!context && typeof candidate.fen === "string" && typeof candidate.isMyTurnNow === "boolean") {
          context = candidate;
        }
        if (!context && candidate.boardContext && typeof candidate.boardContext.fen === "string") {
          context = candidate.boardContext;
        }
        if (!footer && typeof candidate.footerContext?.isGamePlayer === "boolean") footer = candidate.footerContext;
        if (!footer && typeof candidate.isGamePlayer === "boolean" && typeof candidate.gameState === "number") footer = candidate;
        if (connected === null && typeof candidate.isSocketConnected === "boolean") connected = candidate.isSocketConnected;
        if (!game && candidate.gamePlayData?.currentFen && candidate.gamePlayData?.initFen) game = candidate;
      }
    }
    if (!game) return { error: "game-state-unavailable" };
    const playerSide = mode === "computer" && ["red", "black"].includes(game.playerSide) ? game.playerSide :
      context?.myPieceCase === "toUpperCase" ? "red" : context?.myPieceCase === "toLowerCase" ? "black" : null;
    if (!playerSide && mode === "computer") return { error: "player-side-unavailable" };
    const data = game.gamePlayData;
    const currentFen = shortString(data.currentFen, 180);
    const initFen = shortString(data.initFen, 180);
    if (!currentFen || !initFen) return { error: "invalid-position" };
    const moves = Array.isArray(data.moves) ? data.moves.slice(-4).map((move) => ({
      uci: shortString(move?.uci, 12),
      currentFen: shortString(move?.currentFen, 180),
      index: Number.isSafeInteger(move?.index) ? move.index : null
    })) : [];
    const moveCount = Number.isSafeInteger(data.moveCount) ? data.moveCount :
      Array.isArray(data.moves) ? data.moves.length : Number.isSafeInteger(footer?.moveCount) ? footer.moveCount : null;
    const uciPattern = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/;
    const completeUciMoves = Array.isArray(data.moves) && data.moves.length <= 1024 && data.moves.length === moveCount &&
      data.moves.every((move) => typeof move?.uci === "string" && uciPattern.test(move.uci)) ? data.moves.map((move) => move.uci) : undefined;
    const metadata = game.gameData || {};
    const participant = mode === "computer" || (footer?.isGamePlayer === true && playerSide !== null);
    const timed = footer?.isTimed === true || metadata.isTimed === true;
    const daily = footer?.isDaily === true || metadata.isDaily === true;
    const timers = data.timers;
    const playerClock = playerSide && timers?.[playerSide];
    let clockRemainingMs = null;
    if (mode === "online" && timed && !daily && playerClock && Number.isFinite(playerClock.game_secs) && Number.isFinite(timers.server_clock)) {
      const elapsed = data.turnNow === playerSide && data.state === 2 ? Math.max(0, Date.now() - timers.server_clock) : 0;
      const moveTimer = Number.isFinite(metadata.moveTimer) ? metadata.moveTimer : Number.isFinite(footer?.moveTimer) ? footer.moveTimer : null;
      const hasMoveClock = moveTimer === null ? playerClock.move_secs > 0 : moveTimer > 0;
      clockRemainingMs = playerClock.game_secs * 1000 - elapsed;
      if (hasMoveClock && Number.isFinite(playerClock.move_secs)) {
        clockRemainingMs = Math.min(clockRemainingMs, playerClock.move_secs * 1000 - elapsed + (timers.incremented ? 0.1 : 0));
      }
      clockRemainingMs = Math.max(0, clockRemainingMs);
    }
    return {
      mode, participant, playerSide, route: location.pathname,
      viewOnly: context?.viewOnly === true,
      hasPreMove: Boolean(context?.preMove),
      connected,
      clockRemainingMs,
      completeUciMoves,
      flipBoard: typeof game.flipBoard === "boolean" ? game.flipBoard : context?.flipBoard === true,
      historyMode: game.historyMode === true || context?.historyMode === true,
      gameID: shortString(metadata.gameID, 100) || shortString(footer?.gameID, 100),
      isMyTurnNow: typeof context?.isMyTurnNow === "boolean" ? context.isMyTurnNow : null,
      isDrawArrows: context?.isDrawArrows === true,
      loading: Boolean(game.showEngineStartModal || context?.loadingMessage),
      displayFen: shortString(context?.fen, 180),
      gamePlayData: {
        initFen, currentFen,
        moveCount,
        turnNow: ["red", "black"].includes(data.turnNow) ? data.turnNow : null,
        state: Number.isSafeInteger(data.state) ? data.state : null,
        endReason: typeof data.endReason === "number" || typeof data.endReason === "string" ? String(data.endReason).slice(0, 60) : null,
        moves
      }
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.type !== REQUEST || !/^[a-f0-9]{32}$/.test(message.nonce || "") ||
        !Number.isSafeInteger(message.requestId) || message.requestId < 0) return;
    let payload;
    try { payload = findState(); } catch { payload = { error: "state-read-failed" }; }
    window.postMessage({ type: RESPONSE, nonce: message.nonce, requestId: message.requestId, payload }, location.origin);
  });
}());
