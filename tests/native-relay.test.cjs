const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function port(sender) {
  const listeners = {};
  return {
    name:'xq-pikafish-native', sender, messages:[], disconnected:false,
    onMessage:{addListener(callback) { listeners.message=callback; }},
    onDisconnect:{addListener(callback) { listeners.disconnect=callback; }},
    postMessage(message) { this.messages.push(message); },
    disconnect() { if (!this.disconnected) { this.disconnected=true; listeners.disconnect?.(); } },
    receive(message) { listeners.message(message); },
  };
}

function relay() {
  let connect;
  const native=port();
  const calls=[];
  const runtime={
    id:'test', getURL:file=>'chrome-extension://test/'+file,
    onConnect:{addListener(callback) { connect=callback; }},
    connectNative(name) { calls.push(name); return native; },
  };
  const source=fs.readFileSync(path.join(__dirname,'../extension/engine-client.js'),'utf8').replace(/\bexport /g,'');
  vm.runInNewContext(source,{chrome:{runtime}});
  return {native,calls,runtime,connect};
}

test('only the extension offscreen document can open the native engine relay', () => {
  const app=relay();
  for (const sender of [
    {id:'other',url:'chrome-extension://test/offscreen.html'},
    {id:'test',url:'https://play.xiangqi.com/computer-play',tab:{id:1}},
    {id:'test',url:'chrome-extension://test/another.html'},
  ]) {
    const client=port(sender);
    app.connect(client);
    assert.equal(client.disconnected,true);
  }
  assert.equal(app.calls.length,0);
});

test('the authenticated offscreen relay forwards UCI commands and native replies', () => {
  const app=relay();
  const client=port({id:'test',url:'chrome-extension://test/offscreen.html'});
  app.connect(client);
  client.receive({type:'command',command:'uci'});
  app.native.receive({type:'engine',line:'uciok'});
  assert.deepEqual(app.calls,['com.xiangqi.quick_hands.pikafish']);
  assert.equal(app.native.messages[0].command,'uci');
  assert.equal(client.messages[0].line,'uciok');
  client.disconnect();
  assert.equal(app.native.disconnected,true);
});

test('native launch errors propagate to the offscreen client and close both ports', () => {
  const app=relay();
  const client=port({id:'test',url:'chrome-extension://test/offscreen.html'});
  app.connect(client);
  app.runtime.lastError={message:'Specified native messaging host not found.'};
  app.native.disconnect();
  assert.equal(client.messages[0].error,'Specified native messaging host not found.');
  assert.equal(client.disconnected,true);
});

test('offscreen startup retries only warmup and never replays an analysis request', async () => {
  let calls=0,lookups=0;
  const source=fs.readFileSync(path.join(__dirname,'../extension/engine-client.js'),'utf8').replace(/\bexport /g,'');
  const runtime={id:'test',getURL:file=>'chrome-extension://test/'+file,
    onConnect:{addListener(){}},getContexts:async()=>{lookups++;return [{}];},
    sendMessage:async()=>{calls++;if(calls===1)throw new Error('Could not establish connection. Receiving end does not exist.');return {ok:true,result:{ready:true}};}};
  const context=vm.createContext({chrome:{runtime},setTimeout:callback=>queueMicrotask(callback)});
  vm.runInContext(source,context);
  assert.equal((await context.warmup()).ready,true);
  assert.equal(calls,2);
  assert.equal(lookups,2);
  calls=0;
  await assert.rejects(context.command('XQ_ENGINE_ANALYZE'),/Receiving end does not exist/);
  assert.equal(calls,1);
});
