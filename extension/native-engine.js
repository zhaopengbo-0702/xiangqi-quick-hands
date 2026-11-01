(function (root) {
  'use strict';

  const RELAY = 'xq-pikafish-native';
  const NORMALIZED_MOVE = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/;
  const NATIVE_MOVE = /^([a-i])([0-9])([a-i])([0-9])$/;

  function toNativeMove(move) {
    const match = move.match(NORMALIZED_MOVE);
    if (!match) throw new Error('Invalid Xiangqi move coordinate.');
    return match[1] + (Number(match[2]) - 1) + match[3] + (Number(match[4]) - 1);
  }

  function fromNativeMove(move) {
    if (move === '(none)' || move === '0000') return move;
    const match = move.match(NATIVE_MOVE);
    if (!match) throw new Error('Invalid Pikafish move coordinate.');
    return match[1] + (Number(match[2]) + 1) + match[3] + (Number(match[4]) + 1);
  }

  function toNativeCommand(command) {
    if (typeof command !== 'string' || /[\r\n\0]/.test(command)) throw new Error('Invalid Pikafish command.');
    if (!command.startsWith('position ')) return command;
    const marker = command.indexOf(' moves ');
    if (marker < 0) return command;
    return command.slice(0, marker) + ' moves ' + command.slice(marker + 7).split(' ').map(toNativeMove).join(' ');
  }

  function fromNativeLine(line) {
    if (line.startsWith('bestmove ')) {
      return line.split(' ').map((token, index) => index === 1 || index === 3 ? fromNativeMove(token) : token).join(' ');
    }
    if (line.startsWith('info string ')) return line;
    if (line.startsWith('info ')) {
      return line.replace(/\bpv (.+)$/, (_, moves) => 'pv ' + moves.trim().split(/\s+/).map(fromNativeMove).join(' '))
        .replace(/\bcurrmove ([a-i][0-9][a-i][0-9])\b/, (_, move) => 'currmove ' + fromNativeMove(move));
    }
    const perft = line.match(/^([a-i][0-9][a-i][0-9])(:\s*\d+.*)$/);
    if (perft) return fromNativeMove(perft[1]) + perft[2];
    if (line.startsWith('Checkers:')) {
      return line.replace(/\b([a-i])([0-9])\b/g, (_, file, rank) => file + (Number(rank) + 1));
    }
    return line;
  }

  async function createNativePikafishEngine(options = {}) {
    return new Promise((resolve, reject) => {
      let port;
      let ready = false;
      let closed = false;
      let nnueEvidence = null;
      let verifiedMove = false;
      const listeners = new Set();
      const timeout = setTimeout(() => fail(new Error('Pikafish native companion did not become ready.')), 20000);
      const fail = (error) => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        try { port?.disconnect(); } catch {}
        if (!ready) reject(error);
        else options.onError?.(error);
      };
      const api = {
        native: true,
        pikafish: true,
        metadata: null,
        addMessageListener: (listener) => listeners.add(listener),
        removeMessageListener: (listener) => listeners.delete(listener),
        postMessage(command) {
          if (closed || !ready) throw new Error('Pikafish native companion is disconnected.');
          try { port.postMessage({type:'command', command:toNativeCommand(command)}); }
          catch (error) { fail(error); throw error; }
        },
        terminate() {
          if (closed) return;
          closed = true;
          clearTimeout(timeout);
          try { port.disconnect(); } catch {}
          listeners.clear();
        },
      };
      try {
        port = chrome.runtime.connect({name:RELAY});
        port.onDisconnect.addListener(() => fail(new Error(chrome.runtime.lastError?.message || 'Pikafish native companion disconnected.')));
        port.onMessage.addListener((message) => {
          if (closed) return;
          try {
            if (message?.type === 'error') throw new Error(message.error || 'Pikafish native companion failed.');
            if (message?.type === 'engine' && typeof message.line === 'string') {
              const line = message.line;
              if (/NNUE evaluation using .+/i.test(line) && !/disabled/i.test(line)) nnueEvidence = line;
              if (!ready && line.startsWith('bestmove ') && NATIVE_MOVE.test(line.split(' ')[1])) verifiedMove = true;
              if (/CRITICAL ERROR|ERROR: NNUE/.test(line)) throw new Error(line);
              if (ready) for (const listener of listeners) listener(fromNativeLine(line));
            } else if (message?.type === 'ready') {
              if (ready) return;
              if (!nnueEvidence || !verifiedMove || !message.nnue) throw new Error('Pikafish did not verify its NNUE evaluation.');
              ready = true;
              clearTimeout(timeout);
              api.metadata = {...message, name:message.version || message.name || 'Pikafish',
                backend:'native', nnueVerified:true, nnueEvidence};
              resolve(api);
            }
          } catch (error) { fail(error); }
        });
      } catch (error) { fail(error); }
    });
  }

  async function createPikafishEngine(options = {}) {
    try { return await createNativePikafishEngine(options); }
    catch (error) {
      if (typeof root.createPikafishWasmEngine !== 'function' ||
          /NNUE|SHA-?256|integrity|checksum|hash mismatch/i.test(error.message)) throw error;
      return root.createPikafishWasmEngine({...options, nativeError:error.message});
    }
  }

  root.PikafishProtocol = Object.freeze({toNativeCommand, fromNativeLine});
  root.createPikafishEngine = createPikafishEngine;
  if (typeof module === 'object' && module.exports) module.exports = {createPikafishEngine,createNativePikafishEngine,toNativeCommand,fromNativeLine};
}(typeof globalThis === 'object' ? globalThis : this));
