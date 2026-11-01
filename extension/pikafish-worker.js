'use strict';

const NNUE_SHA256 = '7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e';
const NNUE_SIZE = 50706378;
const NATIVE_MOVE = /^[a-i][0-9][a-i][0-9]$/;
let command;
let initialized = false;
let failed = false;
let waiters = [];
let engineName = 'Pikafish';
let nnueEvidence;

function fail(error) {
  if (failed) return;
  failed = true;
  const message = error instanceof Error ? error.message : String(error);
  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }
  waiters = [];
  self.postMessage({type:'error', error:message});
}

function receive(output) {
  for (const line of String(output).split(/\r?\n/).filter(Boolean)) {
    if (/CRITICAL ERROR|ERROR: NNUE|ERROR:.*network/i.test(line)) {
      fail(new Error(line));
      return;
    }
    if (line.startsWith('id name ')) engineName = line.slice(8).trim();
    if (/NNUE evaluation using .+/i.test(line) && !/disabled/i.test(line)) nnueEvidence = line;
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(line)) continue;
      clearTimeout(waiter.timer);
      waiters = waiters.filter(item => item !== waiter);
      waiter.resolve(line);
    }
    if (initialized) self.postMessage({type:'engine', line});
  }
}

function waitFor(predicate, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const waiter = {predicate, resolve, reject};
    waiter.timer = setTimeout(() => {
      waiters = waiters.filter(item => item !== waiter);
      reject(new Error('Pikafish WASM initialization timed out.'));
    }, timeoutMs);
    waiters.push(waiter);
  });
}

async function initialize() {
  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('Pikafish WASM requires extension cross-origin isolation (Chrome 116+).');
  }
  const base = new URL('engine/pikafish/', self.location.href);
  const response = await fetch(new URL('pikafish.nnue', base));
  if (!response.ok) throw new Error('Pikafish NNUE could not be loaded: ' + response.status);
  const network = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', network));
  const checksum = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (network.byteLength !== NNUE_SIZE || checksum !== NNUE_SHA256) {
    throw new Error('Pikafish NNUE integrity check failed (SHA-256).');
  }
  const loader = new URL('pikafish.js', base).href;
  importScripts(loader);
  const runtime = await self.Pikafish({
    mainScriptUrlOrBlob:loader,
    locateFile:name => new URL(name, base).href,
    print:receive,
    printErr:receive,
    onAbort:reason => fail(new Error('Pikafish WASM aborted: ' + reason)),
  });
  if (failed) throw new Error('Pikafish WASM initialization failed.');
  // The network must exist before Pikafish constructs its NNUE evaluator.
  runtime.FS.writeFile('/pikafish.nnue', new Uint8Array(network));
  runtime.FS.chdir('/');
  command = runtime.cwrap('pikafish_command', null, ['string']);
  runtime.cwrap('pikafish_initialize', null, [])();
  const uci = waitFor(line => line === 'uciok');
  command('uci');
  await uci;
  const threads = Math.min(4, Math.max(1, (Number(self.navigator?.hardwareConcurrency) || 4) - 1));
  command('setoption name Threads value ' + threads);
  command('setoption name Hash value 64');
  command('setoption name EvalFile value /pikafish.nnue');
  command('setoption name Move Overhead value 30');
  const ready = waitFor(line => line === 'readyok');
  command('isready');
  await ready;
  const probe = waitFor(line => line.startsWith('bestmove ') && NATIVE_MOVE.test(line.split(' ')[1]));
  command('position startpos');
  command('go depth 1');
  await probe;
  if (!nnueEvidence) throw new Error('Pikafish WASM did not verify its NNUE evaluation.');
  initialized = true;
  self.postMessage({type:'ready', name:engineName, backend:'wasm', nnue:'pikafish.nnue',
    nnueVerified:true, nnueEvidence, nnueSha256:checksum, threads, hash:64});
}

self.onmessage = event => {
  if (failed || !initialized) return;
  try {
    const message = event.data;
    if (message?.type !== 'command' || typeof message.command !== 'string' || /[\r\n\0]/.test(message.command)) {
      throw new Error('Invalid Pikafish WASM command.');
    }
    command(message.command);
  } catch (error) { fail(error); }
};

initialize().catch(fail);
