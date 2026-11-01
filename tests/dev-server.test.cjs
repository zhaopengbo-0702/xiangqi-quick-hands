const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {createVerificationServer} = require('../scripts/dev-server.cjs');

async function serve(t,diagnostic) {
  const server=createVerificationServer({diagnostic});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const origin='http://127.0.0.1:'+server.address().port;
  return {origin,post:(options={})=>fetch(origin+'/api/verify',{method:'POST',headers:{Origin:origin,...options.headers},...options})};
}

test('verification pages identify Pikafish and the separate compatibility engine',async t=>{
  const app=await serve(t,async()=>({ok:true}));
  assert.match(await (await fetch(app.origin)).text(),/Pikafish NNUE/);
  assert.match(await (await fetch(app.origin+'/wasm')).text(),/Fairy-Stockfish WASM/);
  assert.equal((await fetch(app.origin+'/extension/..%5cpackage.json')).status,403);
});

test('the fixed local diagnostic requires same-origin POST with no input',async t=>{
  let calls=0;
  const app=await serve(t,async()=>{calls++;return {ok:true,engine:'Pikafish'};});
  assert.equal((await fetch(app.origin+'/api/verify')).status,405);
  const foreign=await app.post({headers:{Origin:'https://play.xiangqi.com'}});
  assert.equal(foreign.status,403);
  assert.equal(foreign.headers.get('Access-Control-Allow-Origin'),null);
  const wrongHost = await new Promise((resolve,reject)=>{
    const request=http.request(app.origin+'/api/verify',{method:'POST',headers:{Origin:app.origin,Host:'evil.test'}},response=>{response.resume();resolve(response.statusCode);});
    request.on('error',reject);request.end();
  });
  assert.equal(wrongHost,403);
  assert.equal((await app.post({body:'arbitrary UCI command'})).status,400);
  assert.equal(calls,0);
  const response=await app.post();
  assert.equal(response.status,200);
  assert.equal((await response.json()).engine,'Pikafish');
  assert.equal(calls,1);
});

test('concurrent local diagnostics are serialized and failures release the lock',async t=>{
  let release, started;
  const running=new Promise(resolve=>{started=resolve;});
  let calls=0;
  const app=await serve(t,()=>{calls++;if(calls===1){started();return new Promise(resolve=>{release=resolve;});}throw new Error('NNUE unavailable');});
  const first=app.post();
  await running;
  assert.equal((await app.post()).status,409);
  release({ok:true});
  assert.equal((await first).status,200);
  assert.equal((await app.post()).status,500);
  assert.equal((await app.post()).status,500);
  assert.equal(calls,3);
});
