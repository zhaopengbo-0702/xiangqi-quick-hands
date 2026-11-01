(function (root) {
  'use strict';

  function createPikafishWasmEngine(options = {}) {
    return new Promise((resolve, reject) => {
      let worker;
      let ready = false;
      let closed = false;
      const listeners = new Set();
      const timeout = setTimeout(() => fail(new Error('Pikafish WASM did not become ready.')), 30000);
      const fail = error => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        worker?.terminate();
        if (!ready) reject(error);
        else options.onError?.(error);
      };
      const api = {
        native:false,
        pikafish:true,
        metadata:null,
        addMessageListener:listener => listeners.add(listener),
        removeMessageListener:listener => listeners.delete(listener),
        postMessage(command) {
          if (closed || !ready) throw new Error('Pikafish WASM is disconnected.');
          try { worker.postMessage({type:'command', command:root.PikafishProtocol.toNativeCommand(command)}); }
          catch (error) { fail(error); throw error; }
        },
        terminate() {
          if (closed) return;
          closed = true;
          clearTimeout(timeout);
          worker?.terminate();
          listeners.clear();
        },
      };
      try {
        if (!root.PikafishProtocol) throw new Error('Pikafish protocol adapter is unavailable.');
        worker = new Worker(chrome.runtime.getURL('pikafish-worker.js'), {name:'xq-pikafish'});
        worker.onerror = event => fail(new Error(event.message || 'Pikafish WASM worker failed.'));
        worker.onmessage = event => {
          if (closed) return;
          try {
            const message = event.data;
            if (message?.type === 'error') throw new Error(message.error || 'Pikafish WASM failed.');
            if (message?.type === 'ready') {
              if (ready) return;
              if (!message.nnueVerified || !/NNUE evaluation using .+/i.test(message.nnueEvidence || '')) {
                throw new Error('Pikafish WASM did not verify its NNUE evaluation.');
              }
              ready = true;
              clearTimeout(timeout);
              api.metadata = {...message, backend:'wasm', nativeError:options.nativeError || null};
              resolve(api);
            } else if (ready && message?.type === 'engine' && typeof message.line === 'string') {
              const line = root.PikafishProtocol.fromNativeLine(message.line);
              for (const listener of listeners) listener(line);
            }
          } catch (error) { fail(error); }
        };
      } catch (error) { fail(error); }
    });
  }

  root.createPikafishWasmEngine = createPikafishWasmEngine;
  if (typeof module === 'object' && module.exports) module.exports = {createPikafishWasmEngine};
}(typeof globalThis === 'object' ? globalThis : this));
