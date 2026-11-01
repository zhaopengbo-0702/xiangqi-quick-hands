const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const project = path.resolve(__dirname, '..');
const CHECKSUM = '7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e';

test('missing native host falls back to genuine Pikafish WASM and retains the reason', async () => {
  let receivedOptions;
  const engine = {pikafish:true, native:false, metadata:{backend:'wasm', nnueVerified:true}};
  const context = vm.createContext({setTimeout, clearTimeout,
    chrome:{runtime:{connect(){ throw new Error('Specified native messaging host not found.'); }}},
    createPikafishWasmEngine:async options => { receivedOptions=options; return engine; },
  });
  vm.runInContext(await fs.readFile(path.join(project, 'extension/native-engine.js'), 'utf8'), context);
  const onError = () => {};
  assert.equal(await context.createPikafishEngine({onError}), engine);
  assert.equal(receivedOptions.nativeError, 'Specified native messaging host not found.');
  assert.equal(receivedOptions.onError, onError);
});

test('native NNUE verification failure is a hard error', async () => {
  let receive;
  let fallbackCalls = 0;
  const context = vm.createContext({setTimeout, clearTimeout,
    chrome:{runtime:{connect:() => ({onMessage:{addListener:listener => {receive=listener;}},
      onDisconnect:{addListener(){}}, disconnect(){}})}},
    createPikafishWasmEngine:async () => {fallbackCalls++;},
  });
  vm.runInContext(await fs.readFile(path.join(project, 'extension/native-engine.js'), 'utf8'), context);
  const pending = context.createPikafishEngine();
  receive({type:'ready', name:'Pikafish', nnue:'pikafish.nnue'});
  await assert.rejects(pending, /did not verify its NNUE/);
  assert.equal(fallbackCalls, 0);
});

async function workerFixture({checksum=CHECKSUM, size=50706378, evidence=true} = {}) {
  const commands = [];
  const order = [];
  let completed;
  const outcome = new Promise(resolve => {completed=resolve;});
  const context = vm.createContext({URL, Uint8Array, ArrayBuffer, SharedArrayBuffer,
    setTimeout, clearTimeout,
    crossOriginIsolated:true,
    location:{href:'chrome-extension://'+'a'.repeat(32)+'/pikafish-worker.js'},
    navigator:{hardwareConcurrency:16},
    fetch:async () => ({ok:true, arrayBuffer:async () => new ArrayBuffer(size)}),
    crypto:{subtle:{digest:async () => Uint8Array.from(Buffer.from(checksum, 'hex')).buffer}},
    postMessage:message => {if(message.type==='ready'||message.type==='error')completed(message);},
  });
  context.self = context;
  context.importScripts = () => {
    order.push('import');
    context.Pikafish = async options => ({
      FS:{writeFile(name, bytes){order.push('network');assert.equal(name,'/pikafish.nnue');assert.equal(bytes.length,50706378);}, chdir(){}},
      cwrap(name) {
        if (name==='pikafish_initialize') return () => {assert.ok(order.includes('network'));order.push('initialize');};
        assert.equal(name,'pikafish_command');
        return command => {
          commands.push(command);
          if(command==='uci'){options.print('id name Pikafish 2026-09-06');options.print('uciok');}
          if(command==='isready')options.print('readyok');
          if(command==='go depth 1'){
            if(evidence)options.print('info string NNUE evaluation using pikafish.nnue (64MiB)');
            options.print('bestmove b0c2');
          }
        };
      },
    });
  };
  vm.runInContext(await fs.readFile(path.join(project,'extension/pikafish-worker.js'),'utf8'),context);
  return {message:await outcome, commands, order};
}

test('WASM checks NNUE SHA256 before importing or initializing the engine', async () => {
  const corrupt = await workerFixture({checksum:'0'.repeat(64)});
  assert.equal(corrupt.message.type,'error');
  assert.match(corrupt.message.error,/NNUE integrity check failed/);
  assert.deepEqual(corrupt.order,[]);
  assert.deepEqual(corrupt.commands,[]);
});

test('WASM readiness requires loaded NNUE, legal probe and actual evaluation evidence', async () => {
  const result = await workerFixture();
  assert.equal(result.message.type,'ready');
  assert.equal(result.message.backend,'wasm');
  assert.equal(result.message.nnueVerified,true);
  assert.equal(result.message.nnueSha256,CHECKSUM);
  assert.equal(result.message.threads,4);
  assert.deepEqual(result.order,['import','network','initialize']);
  assert.ok(result.commands.includes('setoption name EvalFile value /pikafish.nnue'));
  assert.ok(!result.commands.some(command=>/Use NNUE value false/.test(command)));
  const unverified = await workerFixture({evidence:false});
  assert.equal(unverified.message.type,'error');
  assert.match(unverified.message.error,/did not verify its NNUE/);
});

test('WASM adapter preserves native coordinate boundary and sends worker errors to owner', async () => {
  let worker;
  let failure;
  const context=vm.createContext({setTimeout,clearTimeout,
    chrome:{runtime:{getURL:file=>'chrome-extension://test/'+file}},
    Worker:class {constructor(){worker=this;} postMessage(message){this.last=message;} terminate(){this.closed=true;}},
  });
  vm.runInContext(await fs.readFile(path.join(project,'extension/native-engine.js'),'utf8'),context);
  vm.runInContext(await fs.readFile(path.join(project,'extension/wasm-engine.js'),'utf8'),context);
  const pending=context.createPikafishWasmEngine({nativeError:'host not found',onError:error=>{failure=error;}});
  worker.onmessage({data:{type:'ready',name:'Pikafish',nnueVerified:true,
    nnueEvidence:'info string NNUE evaluation using pikafish.nnue'}});
  const engine=await pending;
  assert.equal(engine.metadata.backend,'wasm');
  assert.equal(engine.metadata.nativeError,'host not found');
  engine.postMessage('position startpos moves b1c3 b10c8');
  assert.equal(worker.last.command,'position startpos moves b0c2 b9c7');
  let line;
  engine.addMessageListener(value=>{line=value;});
  worker.onmessage({data:{type:'engine',line:'bestmove b0c2 ponder b9c7'}});
  assert.equal(line,'bestmove b1c3 ponder b10c8');
  worker.onmessage({data:{type:'error',error:'Pikafish aborted'}});
  assert.match(failure.message,/Pikafish aborted/);
  assert.equal(worker.closed,true);
});
