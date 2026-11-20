(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.XiangqiSiteAdapter = api.XiangqiSiteAdapter;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeFen(fen) {
    if (typeof fen !== "string" || fen.length > 180) throw new Error("Invalid FEN");
    const fields = fen.trim().split(/\s+/);
    const rows = fields[0].split("/");
    if (rows.length !== 10) throw new Error("Invalid board rows");
    for (const row of rows) {
      let width = 0;
      for (const token of row) {
        if (/[1-9]/.test(token)) width += Number(token);
        else if (/[rnbakcpheRNBAKCPHE]/.test(token)) width += 1;
        else throw new Error("Invalid board piece");
      }
      if (width !== 9) throw new Error("Invalid board width");
    }
    if (!["r", "w", "b"].includes(fields[1])) throw new Error("Invalid side to move");
    const side = fields[1] === "b" ? "b" : "w";
    const placement = fields[0].replace(/h/g, "n").replace(/H/g, "N").replace(/e/g, "b").replace(/E/g, "B");
    return `${placement} ${side} - - ${/^\d+$/.test(fields[4] || "") ? fields[4] : "0"} ${/^[1-9]\d*$/.test(fields[5] || "") ? fields[5] : "1"}`;
  }

  function positionKey(fen) { return normalizeFen(fen).split(" ").slice(0, 2).join(" "); }

  function routeMode(pathname) {
    if (pathname === "/computer-play") return "computer";
    if (pathname === "/play" || /^\/game\/[^/]+\/?$/.test(pathname)) return "online";
    if (/^\/puzzle\/race\/[^/]+\/?$/.test(pathname) ||
        /^\/puzzle\/(?!custom(?:\/|$)|stats(?:\/|$)|record(?:\/|$)|race(?:\/|$))[^/]+(?:\/[PC])?\/?$/.test(pathname)) return "puzzle";
    if (pathname === "/analysis/board" || /^\/(review|note|lessons|learn|editor|game-database|watch)(?:\/|$)/.test(pathname)) return "analysis";
    return null;
  }

  function parseMove(move) {
    const match = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.exec(move || "");
    if (!match) throw new Error("Invalid engine move");
    if (match[1] === match[3] && match[2] === match[4]) throw new Error("Empty engine move");
    return { from: { file: match[1], rank: Number(match[2]) }, to: { file: match[3], rank: Number(match[4]) } };
  }

  function displayCell(square, flipped) {
    return {
      file: flipped ? String.fromCharCode(202 - square.file.charCodeAt(0)) : square.file,
      rank: flipped ? 11 - square.rank : square.rank
    };
  }

  function boardArray(fen) {
    return normalizeFen(fen).split(" ")[0].split("/").map((row) => {
      const cells = [];
      for (const token of row) {
        if (/[1-9]/.test(token)) cells.push(...Array(Number(token)).fill(null));
        else cells.push(token);
      }
      return cells;
    });
  }

  function applyPlacement(fen, move) {
    const parsed = parseMove(move);
    const board = boardArray(fen);
    const fromRow = 10 - parsed.from.rank, fromColumn = parsed.from.file.charCodeAt(0) - 97;
    const toRow = 10 - parsed.to.rank, toColumn = parsed.to.file.charCodeAt(0) - 97;
    const piece = board[fromRow][fromColumn];
    if (!piece) throw new Error("Engine source square is empty");
    const side = normalizeFen(fen).split(" ")[1];
    if ((piece === piece.toUpperCase()) !== (side === "w")) throw new Error("Engine selected the opponent's piece");
    const target = board[toRow][toColumn];
    if (target && (target === target.toUpperCase()) === (piece === piece.toUpperCase())) throw new Error("Engine selected a friendly destination");
    board[fromRow][fromColumn] = null;
    board[toRow][toColumn] = piece;
    return board.map((row) => {
      let output = "", spaces = 0;
      for (const cell of row) {
        if (!cell) spaces += 1;
        else { if (spaces) output += spaces; spaces = 0; output += cell; }
      }
      if (spaces) output += spaces;
      return output;
    }).join("/");
  }

  function normalizeSnapshot(raw) {
    const messages = {
      "unsupported-route": "请打开象棋对局页面",
      "board-not-ready": "等待棋盘加载",
      "react-state-unavailable": "无法读取棋盘，请刷新页面",
      "game-state-unavailable": "无法读取对局，请刷新页面",
      "player-side-unavailable": "无法识别我方执子",
      "invalid-position": "棋盘局面无效",
      "state-read-failed": "读取棋盘失败"
    };
    if (!raw || raw.error) throw new Error(messages[raw?.error] || "无法读取对局");
    const mode = ["online", "puzzle", "analysis"].includes(raw.mode) ? raw.mode : "computer";
    const participant = mode === "analysis" ? false : mode === "computer" ? raw.participant !== false : raw.participant === true;
    const playerSide = ["red", "black"].includes(raw.playerSide) ? raw.playerSide : null;
    if (!playerSide && participant) throw new Error("无法识别我方执子");
    const data = raw.gamePlayData;
    if (!data || !Number.isSafeInteger(data.moveCount) || data.moveCount < 0) throw new Error("无法读取对局步数");
    const fen = normalizeFen(data.currentFen);
    const turn = fen.split(" ")[1] === "w" ? "red" : "black";
    if (turn !== data.turnNow) {
      const error = new Error("局面与行棋方不同步");
      error.code = "XQ_STATE_SYNC";
      throw error;
    }
    const initFen = normalizeFen(data.initFen);
    const route = typeof raw.route === "string" ? raw.route : "";
    const gameKey = JSON.stringify([mode, route, raw.gameID || "", initFen, playerSide, participant]);
    const boardKey = JSON.stringify([gameKey, positionKey(fen), data.moveCount]);
    const clockRemainingMs = Number.isFinite(raw.clockRemainingMs) && raw.clockRemainingMs >= 0 ? raw.clockRemainingMs : null;
    const viewOnly = raw.viewOnly === true;
    const completeMoves = raw.completeUciMoves;
    const moves = Array.isArray(completeMoves) && completeMoves.length <= 1024 && completeMoves.length === data.moveCount &&
      completeMoves.every((move) => typeof move === "string" && /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.test(move)) ? [...completeMoves] : undefined;
    return {
      fen, initFen, moves, mode, participant, viewOnly, playerSide, turn, route,
      canAnalyze: raw.canAnalyze === true || mode === "computer" || mode === "online",
      puzzleCompleted: raw.puzzleCompleted === true, puzzleWrong: raw.puzzleWrong === true, puzzleRace: raw.puzzleRace === true,
      active: participant && !viewOnly && !raw.historyMode && data.state === 2 && data.endReason == null && !raw.loading &&
        !raw.hasPreMove && raw.connected !== false && (clockRemainingMs === null || clockRemainingMs > 0),
      historyMode: raw.historyMode === true,
      flipBoard: raw.flipBoard === true,
      isMyTurnNow: raw.isMyTurnNow,
      isDrawArrows: raw.isDrawArrows === true,
      loading: raw.loading === true,
      hasPreMove: raw.hasPreMove === true,
      connected: raw.connected,
      clockRemainingMs,
      moveCount: data.moveCount, gameKey, boardKey,
      recentPositions: (Array.isArray(data.moves) ? data.moves : []).map((move) => {
        try { return { fen: normalizeFen(move.currentFen), index: move.index, uci: move.uci }; } catch { return null; }
      }).filter(Boolean)
    };
  }

  class XiangqiSiteAdapter {
    static routeMode(pathname) { return routeMode(pathname); }
    constructor(options = {}) {
      this.window = options.window || window;
      this.document = options.document || document;
      this.delay = options.delay || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
      this.requestId = 0;
      this.pending = new Map();
      this.nonce = Array.from(this.window.crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
      this.onMessage = (event) => {
        if (event.source !== this.window || event.origin !== this.window.location.origin) return;
        const value = event.data;
        if (!value || value.type !== "xiangqi-assistant:state:v3" || value.nonce !== this.nonce) return;
        const pending = this.pending.get(value.requestId);
        if (!pending) return;
        this.pending.delete(value.requestId);
        clearTimeout(pending.timer);
        pending.resolve(value.payload);
      };
      this.window.addEventListener("message", this.onMessage);
    }

    destroy() {
      this.window.removeEventListener("message", this.onMessage);
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("助手已停止")); }
      this.pending.clear();
    }

    async read(options = {}) {
      if (this.window.location.hostname !== "play.xiangqi.com" || !routeMode(this.window.location.pathname)) throw new Error("请打开象棋对局页面");
      const timeout = Number.isFinite(options.timeoutMs) ? Math.max(0, Math.min(650, options.timeoutMs)) : 650;
      const remaining = Number.isFinite(options.deadline) ? Math.min(timeout, options.deadline - this.window.performance.now()) : timeout;
      if (remaining <= 0) throw new Error("本步已超时，停止落子");
      const requestId = ++this.requestId;
      const raw = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error("读取棋盘超时，请刷新页面")); }, remaining);
        this.pending.set(requestId, { resolve, reject, timer });
        this.window.postMessage({ type: "xiangqi-assistant:read:v3", nonce: this.nonce, requestId }, this.window.location.origin);
      });
      if (!raw?.error && raw?.mode !== routeMode(this.window.location.pathname)) throw new Error("对局类型已变化，请重新读取棋盘");
      if (!raw?.error && raw?.route !== this.window.location.pathname) throw new Error("对局页面已变化，停止落子");
      return normalizeSnapshot(raw);
    }

    assertReady(snapshot, expected) {
      if (!snapshot.participant || snapshot.viewOnly) throw new Error("观战或只读棋盘，无法自动落子");
      if (snapshot.clockRemainingMs !== null && snapshot.clockRemainingMs < 150) throw new Error("我方剩余时间不足，停止落子");
      if (!snapshot.active || snapshot.historyMode || snapshot.turn !== snapshot.playerSide || snapshot.isMyTurnNow === false) throw new Error("棋盘当前不允许落子");
      if (expected && (snapshot.boardKey !== expected.boardKey || snapshot.flipBoard !== expected.flipBoard)) throw new Error("计算期间局面已变化");
      const board = this.document.querySelector("#game-grid");
      if (!board || board.querySelectorAll(".square").length !== 90) throw new Error("无法识别棋盘布局");
      const rect = board.getBoundingClientRect();
      if (rect.width < 90 || rect.height < 100) throw new Error("无法识别棋盘尺寸");
      return board;
    }

    squareElement(square, snapshot) {
      const cell = displayCell(square, snapshot.flipBoard);
      return Array.from(this.document.querySelectorAll("#game-grid .square")).find((element) => element.classList.contains(`${cell.rank}-${cell.file}`));
    }

    clickTarget(element) {
      if (!element) throw new Error("无法定位落子位置");
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error("落子位置不可见");
      const hit = this.document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const board = this.document.querySelector("#game-grid");
      if (!hit || !board?.contains(hit)) throw new Error("棋盘被弹窗遮挡");
      const init = { bubbles: true, cancelable: true, view: this.window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
      for (const type of ["mousedown", "mouseup", "click"]) {
        element.dispatchEvent(new this.window.MouseEvent(type, { ...init, buttons: type === "mousedown" ? 1 : 0 }));
      }
    }

    async play(bestmove, expected, options = {}) {
      const checkAction = () => {
        if (options.isCancelled?.()) throw new Error("已取消落子");
        if (Number.isFinite(options.deadline) && this.window.performance.now() >= options.deadline) throw new Error("本步已超时，停止落子");
      };
      checkAction();
      const move = parseMove(bestmove);
      const initial = await this.read(options);
      checkAction();
      const board = this.assertReady(initial, expected);
      const predicted = applyPlacement(initial.fen, bestmove);
      const sourceCell = this.squareElement(move.from, initial);
      if (!sourceCell) throw new Error("无法定位起点");
      const sourceRect = sourceCell.getBoundingClientRect();
      const source = Array.from(board.querySelectorAll(".pieces-container > div")).find((element) => {
        const rect = element.getBoundingClientRect();
        return Math.abs(rect.left - sourceRect.left) < sourceRect.width * 0.25 && Math.abs(rect.top - sourceRect.top) < sourceRect.height * 0.25;
      })?.querySelector(".piece");
      if (!source) throw new Error("无法定位待走棋子");
      checkAction();
      if (!source.classList.contains("selected-piece")) this.clickTarget(source);
      await this.wait(30);
      checkAction();
      const beforeDestination = await this.read(options);
      checkAction();
      this.assertReady(beforeDestination, initial);
      if (!source.isConnected || !source.classList.contains("selected-piece")) throw new Error("未能选中棋子，已停止");
      const destination = this.squareElement(move.to, beforeDestination);
      const target = destination && Array.from(destination.children).find((element) => !element.classList.contains("top-indicator") && !element.classList.contains("column-index"));
      checkAction();
      this.clickTarget(target);
      const confirmationDeadline = Math.min(this.window.performance.now() + 1500,
        Number.isFinite(options.deadline) ? options.deadline : Infinity);
      // Wait for the original click only; never replay an uncertain destination.
      while (this.window.performance.now() < confirmationDeadline) {
        checkAction();
        let after;
        try { after = await this.read({ ...options, deadline: confirmationDeadline }); }
        catch (error) {
          if (error.code !== "XQ_STATE_SYNC") throw error;
          await this.wait(35);
          continue;
        }
        checkAction();
        if (after.gameKey !== initial.gameKey || after.historyMode) throw new Error("确认落子时对局已变化");
        if (after.moveCount > initial.moveCount && (after.fen.split(" ")[0] === predicted || after.recentPositions.some((entry) => entry.fen.split(" ")[0] === predicted))) return after;
        if (after.boardKey !== initial.boardKey) throw new Error("网站局面与预期不同，已停止");
        await this.wait(35);
        checkAction();
      }
      checkAction();
      throw new Error("网站未在时限内确认落子，已暂停，请检查棋盘");
    }
    wait(milliseconds) {
      return this.delay ? this.delay(milliseconds) : new Promise(resolve => setTimeout(resolve, milliseconds));
    }
  }

  return { XiangqiSiteAdapter, normalizeFen, positionKey, routeMode, parseMove, displayCell, boardArray, applyPlacement, normalizeSnapshot };
}));
