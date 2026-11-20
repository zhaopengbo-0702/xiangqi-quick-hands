(function () {
  "use strict";

  const INSTANCE = "__xiangqiAssistantBridgeV3";
  try { window.__xiangqiAssistantBridgeV2?.destroy?.(); } catch {}
  if (window[INSTANCE]?.version === 3 && window[INSTANCE].isAlive()) return;
  window[INSTANCE]?.destroy?.();
  const REQUEST = "xiangqi-assistant:read:v3";
  const RESPONSE = "xiangqi-assistant:state:v3";
  let timedRaceObserved = false;
  let timedRaceRoute = null;

  function committedAncestors(host) {
    const candidates = new Set();
    const pending = [host];
    let rootState = null;
    for (let index = 0; index < pending.length; index += 1) {
      const fiber = pending[index];
      if (!fiber || candidates.has(fiber)) continue;
      if (typeof fiber !== "object" || candidates.size >= 512) return null;
      candidates.add(fiber);
      if (fiber.return) pending.push(fiber.return);
      if (fiber.alternate) pending.push(fiber.alternate);
      if (fiber.tag === 3) {
        if (fiber.return || !fiber.stateNode?.current || (rootState && rootState !== fiber.stateNode)) return null;
        rootState = fiber.stateNode;
        pending.push(rootState.current);
      }
    }
    const currentRoot = rootState?.current;
    if (currentRoot?.tag !== 3 || currentRoot.stateNode !== rootState || currentRoot.return) return null;

    // A shared bailout child can retain stale return pointers. Rebuild only its known ancestry from the committed root.
    const paths = [{ fiber: currentRoot, parent: -1, depth: 0 }];
    const visited = new Set([currentRoot]);
    let scanned = 0;
    for (let index = 0; index < paths.length; index += 1) {
      const entry = paths[index];
      if (entry.fiber === host || entry.fiber === host.alternate) {
        const ancestors = [];
        for (let cursor = index; cursor >= 0; cursor = paths[cursor].parent) ancestors.push(paths[cursor].fiber);
        return ancestors;
      }
      if (entry.depth >= 150) return null;
      const siblings = new Set();
      for (let child = entry.fiber.child; child; child = child.sibling) {
        if (++scanned > 4096 || siblings.has(child)) return null;
        siblings.add(child);
        if (!candidates.has(child) || visited.has(child)) continue;
        visited.add(child);
        paths.push({ fiber: child, parent: index, depth: entry.depth + 1 });
      }
    }
    return null;
  }

  function shortString(value, limit) {
    return typeof value === "string" && value.length <= limit ? value : null;
  }

  function routeMode(pathname) {
    if (pathname === "/computer-play") return "computer";
    if (pathname === "/play" || /^\/game\/[^/]+\/?$/.test(pathname)) return "online";
    if (/^\/puzzle\/race\/[^/]+\/?$/.test(pathname) ||
        /^\/puzzle\/(?!custom(?:\/|$)|stats(?:\/|$)|record(?:\/|$)|race(?:\/|$))[^/]+(?:\/[PC])?\/?$/.test(pathname)) return "puzzle";
    if (pathname === "/analysis/board" || /^\/(review|note|lessons|learn|editor|game-database|watch)(?:\/|$)/.test(pathname)) return "analysis";
    return null;
  }

  function validFen(value) {
    if (typeof value !== "string" || value.length > 180) return false;
    const fields = value.trim().split(/\s+/);
    if (fields.length !== 6 || !/^[rwb]$/.test(fields[1]) || !/^\d+$/.test(fields[4]) || !/^[1-9]\d*$/.test(fields[5])) return false;
    const rows = fields[0].split("/");
    if (rows.length !== 10 || rows.some(row => {
      let width = 0;
      for (const token of row) { if (/[1-9]/.test(token)) width += Number(token); else if (/[rnbakcpheRNBAKCPHE]/.test(token)) width++; else return true; }
      return width !== 9;
    })) return false;
    return (fields[0].match(/k/g) || []).length === 1 && (fields[0].match(/K/g) || []).length === 1;
  }

  function fenSide(fen) { return fen.trim().split(/\s+/)[1] === "b" ? "black" : "red"; }

  function analysisState(context, candidates) {
    const fen = shortString(context?.fen, 180);
    if (!validFen(fen)) return { error: "invalid-position" };
    const metadata = candidates.find(candidate => Array.isArray(candidate.gameHistory) || Array.isArray(candidate.movesHistory));
    const recent = context.recentMove || metadata?.activeMove;
    const moveCount = Number.isSafeInteger(recent?.index) && recent.index >= 0 ? recent.index : 0;
    return {
      mode: "analysis", participant: false, viewOnly: true, canAnalyze: true,
      playerSide: fenSide(fen), route: location.pathname, historyMode: false,
      flipBoard: context.flipBoard === true, isMyTurnNow: true,
      gameID: location.pathname, displayFen: fen,
      gamePlayData: { initFen: fen, currentFen: fen, moveCount, turnNow: fenSide(fen), state: 2, endReason: null, moves: [] }
    };
  }

  function puzzleState(context, candidates) {
    const state = candidates.find(candidate => candidate.puzzle?.initial_fen && Array.isArray(candidate.movesHistory));
    if (!state || !context) return { error: "game-state-unavailable" };
    const puzzle = state.puzzle;
    const currentFen = shortString(context.fen, 180);
    const initFen = shortString(puzzle.initial_fen, 180);
    if (!validFen(currentFen) || !validFen(initFen)) return { error: "invalid-position" };
    const id = typeof puzzle.puzzle_id === "number" || typeof puzzle.puzzle_id === "string" ? String(puzzle.puzzle_id) : null;
    if (!id || id.length > 100) return { error: "game-state-unavailable" };
    const history = state.movesHistory;
    if (history.length > 1025 || !history.every(move => move && typeof move === "object")) return { error: "game-state-unavailable" };
    // The site's index-zero initMove is not a played half-move; never read answerTree or model_answer.
    const played = history.filter(move => !move.initMove);
    const moveCount = Number.isSafeInteger(state.moveCount) && state.moveCount >= 0 ? state.moveCount : played.length;
    const playerSide = context.myPieceCase === "toUpperCase" ? "red" : context.myPieceCase === "toLowerCase" ? "black" : null;
    if (!playerSide) return { error: "player-side-unavailable" };
    const puzzleRace = /^\/puzzle\/race\//.test(location.pathname);
    const completed = state.isPuzzleCompleted === true || state.lastMoveCompleted === true;
    const wrong = Boolean(state.wrongMove || context.wrongMove);
    // remainingTime is seconds; survival has null time. Do not mistake unknown/zero for a timed session.
    if (!puzzleRace || timedRaceRoute !== location.pathname || state.remainingTime === null) timedRaceObserved = false;
    timedRaceRoute = puzzleRace ? location.pathname : null;
    if (puzzleRace && Number.isFinite(state.remainingTime) && state.remainingTime > 0) timedRaceObserved = true;
    const timedRace = puzzleRace && timedRaceObserved && Number.isFinite(state.remainingTime);
    const raceEnded = puzzleRace && ((timedRace && state.remainingTime <= 0) || (Number.isFinite(state.totalLives) && state.totalLives <= 0) ||
      (state.completeRaceAttemptSuccess === true && Boolean(state.completeRaceAttemptData)));
    const readonly = context.viewOnly === true || typeof context.movePiece !== "function" || typeof context.isLegalToMove !== "function";
    const active = !completed && !wrong && !raceEnded && !readonly;
    const moves = played.slice(-4).map(move => ({ uci: shortString(move.uci, 12), currentFen: shortString(move.currentFen, 180), index: Number.isSafeInteger(move.index) ? move.index : null }));
    const uciPattern = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/;
    const completeUciMoves = played.length === moveCount && played.every(move => !move.isWrongMove && typeof move.uci === "string" && uciPattern.test(move.uci)) ? played.map(move => move.uci) : undefined;
    return {
      mode: "puzzle", participant: true, playerSide, route: location.pathname,
      canAnalyze: true, viewOnly: readonly, flipBoard: context.flipBoard === true,
      historyMode: false, isMyTurnNow: context.isMyTurnNow === true && active,
      puzzleCompleted: completed || raceEnded, puzzleWrong: wrong, puzzleRace,
      clockRemainingMs: timedRace && Number.isFinite(state.remainingTime) ? Math.max(0, state.remainingTime * 1000) : null,
      gameID: id + ":" + String(Number.isSafeInteger(state.playAgain) ? state.playAgain : 0),
      displayFen: currentFen, loading: Boolean(context.loadingMessage || state.isAnalyzing), hasPreMove: Boolean(context.preMove),
      completeUciMoves,
      gamePlayData: { initFen, currentFen, moveCount, turnNow: fenSide(currentFen), state: active ? 2 : 3,
        endReason: wrong ? "puzzle-wrong" : completed || raceEnded ? "puzzle-completed" : readonly ? "puzzle-readonly" : null, moves }
    };
  }

  function findState() {
    const mode = routeMode(location.pathname);
    if (location.hostname !== "play.xiangqi.com" || !mode) {
      return { error: "unsupported-route" };
    }
    if (location.pathname === "/play") return { error: "board-not-ready" };
    const board = document.querySelector("#game-grid") || (mode === "analysis" ? document.querySelector("#puzzle-board .board-container") : null);
    if (!board) return { error: "board-not-ready" };
    const key = Object.keys(board).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
    if (!key) return { error: "react-state-unavailable" };

    const ancestors = committedAncestors(board[key]);
    if (!ancestors) return { error: "react-state-unavailable" };
    let game = null;
    let context = null;
    let footer = null;
    let connected = null;
    const seen = new Set();
    const knownCandidates = [];
    // Only inspect the board's ancestors and known prop paths, never the global store.
    for (const fiber of ancestors) {
      const props = fiber.memoizedProps;
      if (!props || typeof props !== "object") continue;
      const candidates = [props, props.value, props.botState, props.botGameData?.botState, props.sidebarProps, props.sidebarData];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object" || seen.has(candidate)) continue;
        seen.add(candidate);
        knownCandidates.push(candidate);
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
    if (mode === "puzzle") return puzzleState(context, knownCandidates);
    if (mode === "analysis") return analysisState(context || knownCandidates.find(candidate => validFen(candidate.fen)), knownCandidates);
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

  let alive = true;
  const onMessage = (event) => {
    if (!alive) return;
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.type !== REQUEST || !/^[a-f0-9]{32}$/.test(message.nonce || "") ||
        !Number.isSafeInteger(message.requestId) || message.requestId < 0) return;
    let payload;
    try { payload = findState(); } catch { payload = { error: "state-read-failed" }; }
    window.postMessage({ type: RESPONSE, nonce: message.nonce, requestId: message.requestId, payload }, location.origin);
  };
  const instance = {
    version: 3,
    isAlive: () => alive,
    destroy() {
      if (!alive) return;
      alive = false;
      window.removeEventListener("message", onMessage);
      if (window[INSTANCE] === instance) delete window[INSTANCE];
    }
  };
  window[INSTANCE] = instance;
  window.addEventListener("message", onMessage);
}());
