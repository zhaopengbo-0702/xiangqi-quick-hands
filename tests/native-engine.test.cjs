const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawn} = require('node:child_process');
const {toNativeCommand,fromNativeLine} = require('../extension/native-engine.js');

const project = path.resolve(__dirname,'..');
const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

test('Pikafish command conversion shifts every history rank and preserves FEN',()=>{
  assert.equal(toNativeCommand('position fen '+START+' moves b1c3 b10c8 c3b1 c8b10'),
    'position fen '+START+' moves b0c2 b9c7 c2b0 c7b9');
  assert.equal(toNativeCommand('position fen '+START),'position fen '+START);
  assert.equal(toNativeCommand('go infinite'),'go infinite');
  assert.throws(()=>toNativeCommand('position fen '+START+' moves b0c2'));
  assert.throws(()=>toNativeCommand('uci\nquit'));
});

test('Pikafish output conversion covers PV, ponder, iteration, perft and checkers',()=>{
  assert.equal(fromNativeLine('bestmove b0c2 ponder b9c7'),'bestmove b1c3 ponder b10c8');
  assert.equal(fromNativeLine('bestmove (none)'),'bestmove (none)');
  assert.equal(fromNativeLine('info depth 8 score cp 12 pv b0c2 b9c7'),
    'info depth 8 score cp 12 pv b1c3 b10c8');
  assert.equal(fromNativeLine('info depth 10 currmove a9a8 currmovenumber 3'),
    'info depth 10 currmove a10a9 currmovenumber 3');
  assert.equal(fromNativeLine('h9g7: 1'),'h10g8: 1');
  assert.equal(fromNativeLine('Checkers: e8 a0'),'Checkers: e9 a1');
  assert.equal(fromNativeLine('Fen: '+START),'Fen: '+START);
  assert.equal(fromNativeLine('info string NNUE evaluation using C:/pv/net.nnue'),
    'info string NNUE evaluation using C:/pv/net.nnue');
});

test('native readiness requires observed NNUE evaluation and an actual probe move',async()=>{
  let receive;
  let disconnected=false;
  const context=vm.createContext({setTimeout,clearTimeout,chrome:{runtime:{
    connect:()=>({onMessage:{addListener:callback=>{receive=callback}},onDisconnect:{addListener(){}},
      disconnect(){disconnected=true},postMessage(){}}),
  }}});
  vm.runInContext(await fs.readFile(path.join(project,'extension/native-engine.js'),'utf8'),context);
  const waiting=context.createPikafishEngine();
  receive({type:'ready',name:'Pikafish',nnue:'pikafish.nnue'});
  await assert.rejects(waiting,/did not verify its NNUE/);
  assert.equal(disconnected,true);
});

function actualPort(configFile,ports){
  const process=spawn('python',[path.join(project,'native-host/host.py'),'--config',configFile,'chrome-extension://'+'a'.repeat(32)+'/'],
    {cwd:project,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const messages=new Set(),disconnects=new Set();
  let pending=Buffer.alloc(0),closed=false;
  const port={
    onMessage:{addListener:callback=>messages.add(callback)},
    onDisconnect:{addListener:callback=>disconnects.add(callback)},
    postMessage(message){const body=Buffer.from(JSON.stringify(message));const header=Buffer.alloc(4);header.writeUInt32LE(body.length);process.stdin.write(Buffer.concat([header,body]));},
    disconnect(){if(closed)return;process.stdin.end();const timer=setTimeout(()=>process.kill(),1500);timer.unref();},
    done:new Promise(resolve=>process.once('close',()=>{closed=true;for(const callback of disconnects)callback();resolve();})),
  };
  process.on('error',()=>{for(const callback of disconnects)callback();});
  process.stdout.on('data',chunk=>{
    pending=Buffer.concat([pending,chunk]);
    while(pending.length>=4){const length=pending.readUInt32LE(0);if(pending.length<length+4)return;
      const value=JSON.parse(pending.subarray(4,length+4).toString('utf8'));pending=pending.subarray(length+4);
      for(const callback of messages)callback(value);
    }
  });
  process.stderr.resume();
  ports.push(port);
  return port;
}

test('real Python native host and official NNUE binary run the offscreen adaptive engine',
  {skip:process.platform!=='win32',timeout:30000},async()=>{
    const tempRoot=path.resolve(os.tmpdir());
    const temp=await fs.mkdtemp(path.join(tempRoot,'xq-native-engine-test-'));
    const ports=[];
    let context;
    try{
      const metadata=JSON.parse(await fs.readFile(path.join(project,'third_party/pikafish/runtime.json'),'utf8'));
      const config={...metadata,
        enginePath:path.resolve(project,'third_party/pikafish',metadata.enginePath),
        networkPath:path.resolve(project,'third_party/pikafish',metadata.networkPath),
        allowed_origins:['chrome-extension://'+'a'.repeat(32)+'/'],
      };
      const configFile=path.join(temp,'config.json');
      await fs.writeFile(configFile,JSON.stringify(config));
      let listener;
      context=vm.createContext({console,performance,setTimeout,clearTimeout,setInterval,clearInterval,
        crossOriginIsolated:false,
        Stockfish:()=>{throw new Error('Native mode must not fall back to the WASM engine');},
        chrome:{runtime:{id:'native-engine-test',lastError:null,
          connect:options=>{assert.equal(options.name,'xq-pikafish-native');return actualPort(configFile,ports);},
          onMessage:{addListener:callback=>{listener=callback}},
        }},
      });
      vm.runInContext(await fs.readFile(path.join(project,'extension/native-engine.js'),'utf8'),context);
      vm.runInContext(await fs.readFile(path.join(project,'extension/offscreen.js'),'utf8'),context);
      const request=(type,options)=>new Promise((resolve,reject)=>listener({target:'offscreen',type,options},
        {id:'native-engine-test'},response=>response.ok?resolve(response.result):reject(new Error(response.error))));
      const ready=await request('XQ_ENGINE_WARMUP');
      assert.match(ready.name,/Pikafish 2026-09-06/);
      assert.equal(ready.nnueVerified,true);
      assert.match(ready.nnueEvidence,/NNUE evaluation using .*pikafish\.nnue/);
      assert.equal(ready.threads,4);
      assert.equal(ready.hash,128);
      const result=await request('XQ_ENGINE_ANALYZE',{fen:START,initialFen:START,moves:[],
        movetime:1800,mode:'adaptive',balance:0.65,requestId:'native-real'});
      assert.match(result.bestmove,/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);
      assert.ok(result.depth>=6);
      assert.equal(result.legalMoves,44);
      assert.equal(result.historyUsed,true);
      assert.equal(result.nnueVerified,true);
      assert.match(result.engineName,/Pikafish/);
      assert.ok(result.elapsedMs<2500);
      assert.equal(result.bestmove,result.pv[0]);
      console.log('Official native NNUE:',JSON.stringify({engine:result.engineName,nnue:result.nnue,
        bestmove:result.bestmove,depth:result.depth,elapsedMs:result.elapsedMs,nodes:result.nodes}));
      const cycle=['b1c3','b10c8','c3b1','c8b10'];
      const repeated=await request('XQ_ENGINE_ANALYZE',{fen:START,initialFen:START,moves:cycle,movetime:200,mode:'fixed'});
      assert.equal(repeated.historyUsed,true);
      assert.equal(repeated.historyPlies,4);
      const longHistory=Array.from({length:30},()=>cycle).flat();
      const longPosition=START.replace(' - - 0 1',' - - 120 61');
      const afterLimit=await request('XQ_ENGINE_ANALYZE',{fen:longPosition,initialFen:START,moves:longHistory,movetime:200,mode:'adaptive'});
      assert.equal(afterLimit.historyUsed,true);
      assert.equal(afterLimit.historyPlies,120);
      assert.equal(afterLimit.legalMoves,null,'Native perft must not reparse a replayed 120-ply counter');
      const searching=request('XQ_ENGINE_ANALYZE',{fen:START,movetime:3500,mode:'fixed'});
      const rejected=assert.rejects(searching,/Search cancelled/);
      await new Promise(resolve=>setTimeout(resolve,35));
      await request('XQ_ENGINE_CANCEL');
      await rejected;
      const warmedAgain=await request('XQ_ENGINE_WARMUP');
      assert.equal(warmedAgain.nnueVerified,true);
      assert.equal(ports.length,2,'Cancellation must establish a fresh native engine');
      await assert.rejects(request('XQ_ENGINE_ANALYZE',{fen:START,initialFen:START,
        moves:['a1a10','b10c8'],movetime:200,mode:'fixed'}),/CRITICAL ERROR|failed|Pikafish/);
      const recovered=await request('XQ_ENGINE_WARMUP');
      assert.equal(recovered.nnueVerified,true);
      assert.equal(ports.length,3,'Invalid native history must recover in a new process');
    }finally{
      context?.resetEngine();
      for(const port of ports)port.disconnect();
      await Promise.all(ports.map(port=>port.done));
      if(path.dirname(temp)!==tempRoot || !path.basename(temp).startsWith('xq-native-engine-test-'))throw new Error('Unexpected native test cleanup path');
      await fs.rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    }
  });
