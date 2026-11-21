const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const project = path.resolve(__dirname, '..');
const extension = path.join(project, 'extension');
const results = path.join(project, 'test-results');
const artifactPrefix = process.env.XQ_SMOKE_ARTIFACT_PREFIX || 'mv3-pikafish';
const syncScenario = process.env.XQ_SMOKE_SYNC === '1';
const reloadScenario = process.env.XQ_SMOKE_RELOAD === '1';
const ackScenario = process.env.XQ_SMOKE_ACK === '1';
const backgroundScenario = process.env.XQ_SMOKE_BACKGROUND === '1';
const playerSide = process.env.XQ_SMOKE_SIDE || 'red';
if([syncScenario,reloadScenario,ackScenario,backgroundScenario].filter(Boolean).length>1)throw new Error('Run sync, reload, acknowledgement and background scenarios separately.');
if(!['red','black'].includes(playerSide))throw new Error('Invalid smoke player side');
if (!/^[a-z0-9-]+$/.test(artifactPrefix)) throw new Error('Invalid smoke artifact prefix');
const tempRoot = path.resolve(os.tmpdir());
const initialFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1';

const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MV3 SPA smoke fixture</title>
<style>body{margin:32px;font:15px system-ui;background:#f2f5f4;color:#24342b}h1{font-size:22px}button{font:inherit;padding:9px 12px}#game-grid{position:relative;width:450px;height:500px;background:#e1e8df;border:1px solid #81937d;margin-top:20px}.square{position:absolute;width:50px;height:50px;box-sizing:border-box;border:1px solid #a8b5a2}.square-target{width:100%;height:100%}.pieces-container{position:absolute;inset:0;pointer-events:none}.pieces-container>div{position:absolute;width:50px;height:50px}.piece{position:absolute;inset:4px;display:grid;place-items:center;background:#fff;border:2px solid #465a45;border-radius:50%;pointer-events:auto;cursor:pointer;font-size:20px}.red{color:#b2232b}.selected-piece{outline:3px solid #22a168}pre{max-width:680px;white-space:pre-wrap;overflow-wrap:anywhere}</style></head>
<body><h1>MV3 SPA smoke fixture</h1><button id="enter">Enter fixture game</button><div id="stage"></div><pre id="fixture-state">Lobby</pre>
<script>
const INITIAL = ${JSON.stringify(initialFen)};
const SYNC_SCENARIO = ${JSON.stringify(syncScenario)};
const ACK_SCENARIO = ${JSON.stringify(ackScenario)};
const BACKGROUND_SCENARIO = ${JSON.stringify(backgroundScenario)};
const PLAYER_SIDE = ${JSON.stringify(playerSide)};
const FLIPPED = PLAYER_SIDE==='black';
let boardContext = {fen:INITIAL,myPieceCase:FLIPPED?'toLowerCase':'toUpperCase',isMyTurnNow:!FLIPPED,flipBoard:FLIPPED,viewOnly:false};
let game = {playerSide:PLAYER_SIDE,flipBoard:FLIPPED,historyMode:false,gameData:{gameID:'mv3-fixture'},boardContext,
  gamePlayData:{currentFen:INITIAL,initFen:INITIAL,moveCount:0,turnNow:'red',state:2,endReason:null,moves:[]}};
let selected = null;
let board;
let pieces;
let halfmove = 0;
let fullmove = 1;
let ownInputAttempts = 0;
let rejectedOwnInputs = 0;
let syncPhase = null;
let ackPhase = null;
let tree = null;
let rootFlips = 0;
let staleReturnReads = 0;
const ownMoves = [];
const syncEvents = [];
const ackEvents = [];
const cells = INITIAL.split(' ')[0].split('/').map(row=>[...row].flatMap(piece=>/\\d/.test(piece)?Array(Number(piece)).fill(null):[piece]));
function square(row,column){return String.fromCharCode(97+column)+(10-row)}
function display(row,column){return FLIPPED?{r:9-row,c:8-column}:{r:row,c:column}}
function placement(){return cells.map(row=>{let result='',empty=0;for(const piece of row){if(!piece)empty++;else{if(empty)result+=empty;empty=0;result+=piece}}if(empty)result+=empty;return result}).join('/')}
function commit(nextGame,nextContext){
  game=nextGame;boardContext=nextContext;
  if(tree){
    const next=1-tree.current;
    tree.games[next].memoizedProps=game;tree.providers[next].memoizedProps={value:boardContext};
    tree.rootState.current=tree.roots[next];tree.current=next;
    tree.host.return=tree.providers[1-next];rootFlips++;
  }
}
function publish(){
  const data=game.gamePlayData;
  window.smokeFixture={moveCount:data.moveCount,lastMove:data.moves.at(-1)?.uci||null,fen:data.currentFen,
    route:location.pathname,playerSide:PLAYER_SIDE,flipBoard:FLIPPED,ownInputAttempts,rejectedOwnInputs,
    ownMoves,syncEvents,syncPhase:syncPhase?.name||null,ackEvents,ackPhase:ackPhase?.name||null,rootFlips,staleReturnReads};
  document.getElementById('fixture-state').textContent=JSON.stringify(window.smokeFixture);
}
function inconsistentTurn(name){
  const correct=game.gamePlayData.currentFen.split(' ')[1]==='b'?'black':'red';
  commit({...game,gamePlayData:{...game.gamePlayData,turnNow:correct==='red'?'black':'red'}},boardContext);
  const phase={name,durationMs:300,reads:0,startedAt:Math.round(performance.now())};
  syncEvents.push(phase);syncPhase=phase;publish();
  setTimeout(()=>{const nextContext={...boardContext,isMyTurnNow:correct===PLAYER_SIDE};
    commit({...game,boardContext:nextContext,gamePlayData:{...game.gamePlayData,turnNow:correct}},nextContext);
    phase.completedAt=Math.round(performance.now());syncPhase=null;publish();},300);
}
window.addEventListener('message',event=>{
  if(event.source!==window||event.data?.type!=='xiangqi-assistant:read:v3')return;
  if(syncPhase)syncPhase.reads++;
  if(ackPhase)ackPhase.reads++;
  if(tree&&tree.host.return!==tree.providers[tree.current])staleReturnReads++;
});
function applyMove(uci,delayMs=0,onCommitted){
  const match=uci.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);
  if(!match)throw new Error('Invalid fixture coordinate');
  const from={r:10-Number(match[2]),c:match[1].charCodeAt(0)-97};
  const to={r:10-Number(match[4]),c:match[3].charCodeAt(0)-97};
  const piece=cells[from.r][from.c];
  if(!piece)throw new Error('Missing fixture source piece');
  const captured=cells[to.r][to.c];
  halfmove=captured||piece.toLowerCase()==='p'?0:halfmove+1;
  const black=piece===piece.toLowerCase();
  if(black)fullmove++;
  cells[to.r][to.c]=piece;cells[from.r][from.c]=null;
  const turn=black?'red':'black';
  const fen=placement()+' '+(black?'r':'b')+' - - '+halfmove+' '+fullmove;
  const data=game.gamePlayData;
  const nextData={...data,moves:[...data.moves,{uci,currentFen:fen,index:data.moveCount}],currentFen:fen,moveCount:data.moveCount+1,turnNow:turn};
  const nextContext={...boardContext,fen,isMyTurnNow:turn===PLAYER_SIDE};
  const nextGame={...game,gamePlayData:nextData,boardContext:nextContext};
  render();
  const finish=()=>{
    commit(nextGame,nextContext);
    if(ackPhase){ackPhase.completedAt=Math.round(performance.now());ackPhase=null;}
    publish();onCommitted?.();
  };
  if(delayMs){
    ackPhase={name:'after-own-destination-'+ownMoves.length,durationMs:delayMs,reads:0,startedAt:Math.round(performance.now())};
    ackEvents.push(ackPhase);publish();setTimeout(finish,delayMs);
  }else finish();
}
function opponentMove(){
  const options=PLAYER_SIDE==='red'?['a7a6','c7c6','e7e6','g7g6','i7i6']:['a4a5','c4c5','e4e5','g4g5','i4i5'];
  const row=PLAYER_SIDE==='red'?3:6,targetRow=PLAYER_SIDE==='red'?4:5,pawn=PLAYER_SIDE==='red'?'p':'P';
  const move=options.find(uci=>cells[row][uci.charCodeAt(0)-97]===pawn&&!cells[targetRow][uci.charCodeAt(0)-97]);
  if(!move)throw new Error('No fixture opponent pawn move');
  applyMove(move);if(!ACK_SCENARIO&&!BACKGROUND_SCENARIO)inconsistentTurn('after-opponent-move');
}
function destination(row,column){
  if(!selected)return;
  ownInputAttempts++;
  if(ackPhase||game.gamePlayData.turnNow!==PLAYER_SIDE||!boardContext.isMyTurnNow){rejectedOwnInputs++;selected=null;publish();return;}
  const from=selected;selected=null;
  const uci=square(from.r,from.c)+square(row,column);
  ownMoves.push({uci,beforeFen:game.gamePlayData.currentFen,acceptedAt:Math.round(performance.now()),visibilityState:document.visibilityState});
  applyMove(uci,ACK_SCENARIO?900:0,()=>{
    if(ACK_SCENARIO&&ownMoves.length===1)setTimeout(opponentMove,450);
  });
  if(SYNC_SCENARIO){
    inconsistentTurn('after-own-destination-'+ownMoves.length);
    if(ownMoves.length===1){setTimeout(()=>inconsistentTurn('waiting-for-opponent'),750);setTimeout(opponentMove,1500);}
  }
}
function render(){
  pieces.replaceChildren();
  cells.forEach((row,r)=>row.forEach((piece,c)=>{if(!piece)return;const visual=display(r,c);const holder=document.createElement('div');holder.style.left=(visual.c*50)+'px';holder.style.top=(visual.r*50)+'px';const token=document.createElement('div');token.className='piece'+(piece===piece.toUpperCase()?' red':'');token.textContent=piece;token.dataset.square=square(r,c);token.addEventListener('click',event=>{event.stopPropagation();pieces.querySelectorAll('.piece').forEach(item=>item.classList.remove('selected-piece'));token.classList.add('selected-piece');selected={r,c}});holder.append(token);pieces.append(holder)}));
}
function enter(){
  history.pushState({},'', '/computer-play');
  document.getElementById('enter').remove();
  board=document.createElement('div');board.id='game-grid';
  // Both committed branches share the host, whose return pointer deliberately trails the current root.
  const rootState={current:null};
  const roots=[0,1].map(()=>({tag:3,stateNode:rootState,return:null}));
  const games=roots.map(root=>({memoizedProps:game,return:root}));
  const providers=games.map(parent=>({memoizedProps:{value:boardContext},return:parent}));
  const host={memoizedProps:{id:'game-grid'},return:providers[0]};
  for(let index=0;index<2;index++){
    roots[index].alternate=roots[1-index];roots[index].child=games[index];
    games[index].alternate=games[1-index];games[index].child=providers[index];
    providers[index].alternate=providers[1-index];providers[index].child=host;
  }
  rootState.current=roots[0];tree={rootState,roots,games,providers,host,current:0};board['__reactFiber$smoke']=host;
  for(let r=0;r<10;r++)for(let c=0;c<9;c++){const cell=document.createElement('div');cell.className='square '+(10-r)+'-'+String.fromCharCode(97+c);cell.style.left=(c*50)+'px';cell.style.top=(r*50)+'px';const target=document.createElement('div');target.className='square-target';target.addEventListener('click',()=>destination(FLIPPED?9-r:r,FLIPPED?8-c:c));cell.append(target);board.append(cell)}
  pieces=document.createElement('div');pieces.className='pieces-container';board.append(pieces);document.getElementById('stage').append(board);render();
  if(PLAYER_SIDE==='black')applyMove('a4a5');else publish();
}
document.getElementById('enter').addEventListener('click',enter);
</script></body></html>`;

async function configureWorker(worker,forceWasm){
  if(forceWasm)await worker.evaluate(()=>{
    const connect=chrome.runtime.connectNative.bind(chrome.runtime);
    chrome.runtime.connectNative=()=>connect('com.xiangqi.quick_hands.deliberately_missing');
  });
  await worker.evaluate(()=>{
    globalThis.smokeObservedMessages=[];
    chrome.runtime.onMessage.addListener((message,sender)=>{
      if(!['XQ_WARMUP','XQ_ANALYZE','XQ_CANCEL'].includes(message?.type)||!sender.tab)return false;
      void chrome.tabs.get(sender.tab.id).then(tab=>globalThis.smokeObservedMessages.push({
        type:message.type,senderUrl:sender.url,senderTabUrl:sender.tab.url,currentTabUrl:tab.url,
        ...(message.type==='XQ_ANALYZE'?{fen:message.fen,historyPlies:message.moves?.length??null,
          openingOnly:message.mode==='fixed'&&message.movetime===650&&Array.isArray(message.moves)&&message.moves.length===0}:{}),
      }));
      return false;
    });
  });
}

async function main() {
  const profile = await fs.mkdtemp(path.join(tempRoot, 'xiangqi-mv3-smoke-'));
  let context;
  let browser;
  let browserProcess;
  let page;
  const errors = [];
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
    if(backgroundScenario){
      // Playwright's normal launch forces focus emulation, keeping every page "visible".
      // Attach without those overrides to exercise real tab and window visibility.
      browserProcess=spawn(executablePath,['--user-data-dir='+profile,'--remote-debugging-port=0','--no-first-run',
        '--no-default-browser-check','--disable-background-networking','--disable-extensions-except='+extension,'--load-extension='+extension,'about:blank'],
        {windowsHide:true,stdio:'ignore'});
      const portFile=path.join(profile,'DevToolsActivePort');
      let port;
      for(let attempt=0;attempt<100;attempt++){
        try{port=Number((await fs.readFile(portFile,'utf8')).split('\n')[0]);if(port)break;}catch{}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.ok(port,'Isolated browser must publish its debugging port');
      browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{noDefaults:true});
      context=browser.contexts()[0];
    }else{
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium', executablePath, headless: true, viewport: {width: 1280, height: 900},
        args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
      });
    }
    await context.route('https://play.xiangqi.com/**', route => route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture}));
    page = context.pages()[0] || await context.newPage();
    if(backgroundScenario)await page.setViewportSize({width:1280,height:900});
    page.on('pageerror', error => errors.push(error.message));
    const isExtensionWorker=candidate=>/^chrome-extension:\/\/[^/]+\/background\.js$/.test(candidate.url());
    let worker = context.serviceWorkers().find(isExtensionWorker) || await context.waitForEvent('serviceworker', {predicate:isExtensionWorker,timeout:20000});
    const forceWasm = process.env.XQ_FORCE_WASM === '1';
    await configureWorker(worker,forceWasm);
    await page.goto('https://play.xiangqi.com/computer', {waitUntil:'load'});
    await page.locator('#xq-quick-hands').waitFor({state:'visible',timeout:20000});
    let startup = await worker.evaluate(async () => {
      for (let attempt=0; attempt<50; attempt++) {
        if ((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length) {
          try {
            return await chrome.runtime.sendMessage({target:'offscreen',type:'XQ_ENGINE_WARMUP'});
          } catch (error) {
            if (!/Receiving end does not exist/.test(error.message)) throw error;
          }
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      return {ok:false,error:'Offscreen document was not created'};
    });
    assert.equal(startup.ok,true,JSON.stringify(startup));
    assert.equal(startup.result.backend,forceWasm?'wasm':'native');
    if (forceWasm) {
      assert.equal(startup.result.nnueVerified,true);
      assert.match(startup.result.nativeError,/not found|unavailable/i);
    }
    await page.getByRole('button',{name:'Enter fixture game'}).click();
    await page.waitForURL('https://play.xiangqi.com/computer-play');
    await page.waitForFunction(() => {
      const panel=document.getElementById('xq-quick-hands')?.shadowRoot;
      return panel && !panel.getElementById('single').disabled;
    }, null, {timeout:30000});
    const contextsBefore = await worker.evaluate(() => chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}));
    assert.equal(contextsBefore.length,1,'The real extension must create its offscreen engine document');
    let reload;
    let background;
    let documentNavigations;
    if(reloadScenario){
      // Modern Chromium disables command-line unpacked extensions on reload
      // unless developer mode is also enabled in this isolated test profile.
      const management=await context.newPage();
      await management.goto('chrome://extensions');
      const developerMode=management.locator('extensions-toolbar #devMode');
      await developerMode.waitFor({state:'visible'});
      if(!(await developerMode.evaluate(element=>element.checked)))await developerMode.click();
      assert.equal(await developerMode.evaluate(element=>element.checked),true);
      await management.close();
      await page.bringToFront();
      await page.locator('#xq-quick-hands').getByRole('button',{name:'走一步',exact:true}).click();
      await page.waitForFunction(()=>document.getElementById('xq-quick-hands')?.shadowRoot.getElementById('status').textContent==='本步已完成',null,{timeout:15000});
      await page.evaluate(()=>opponentMove());
      await page.waitForFunction(()=>!window.smokeFixture.syncPhase&&
        !document.getElementById('xq-quick-hands').shadowRoot.getElementById('single').disabled);
      const before=await page.evaluate(()=>{
        window.smokeDocumentToken=crypto.randomUUID();
        return {documentToken:window.smokeDocumentToken,url:location.href,fen:window.smokeFixture.fen,
          moveCount:window.smokeFixture.moveCount};
      });
      const oldPanel=await page.locator('#xq-quick-hands').elementHandle();
      const oldWorker=worker;
      const engineBefore=startup.result;
      const messagesBefore=await oldWorker.evaluate(()=>globalThis.smokeObservedMessages);
      documentNavigations=[];
      page.on('framenavigated',frame=>{if(frame===page.mainFrame())documentNavigations.push(frame.url());});
      const replacement=context.waitForEvent('serviceworker',{predicate:candidate=>candidate!==oldWorker,timeout:30000})
        .then(async candidate=>{await configureWorker(candidate,forceWasm);return candidate;});
      let reloadEvaluationError=null;
      try{await oldWorker.evaluate(()=>chrome.runtime.reload());}
      catch(error){
        reloadEvaluationError=error.message;
        assert.match(error.message,/closed|destroyed|context|target/i);
      }
      worker=await replacement;
      const invalidatedError=await oldWorker.evaluate(()=>chrome.runtime.id).then(()=>null,error=>error.message);
      assert.ok(invalidatedError,'The original extension worker must actually be invalidated');
      await page.waitForFunction(node=>!node.isConnected,oldPanel,{timeout:30000});
      await page.waitForFunction(()=>{
        const panels=document.querySelectorAll('#xq-quick-hands');
        const panel=panels.length===1&&panels[0].shadowRoot;
        return panel&&!panel.getElementById('single').disabled&&!panel.getElementById('auto').disabled&&
          panel.getElementById('status').textContent==='引擎就绪';
      },null,{timeout:40000});
      startup=await worker.evaluate(()=>chrome.runtime.sendMessage({target:'offscreen',type:'XQ_ENGINE_WARMUP'}));
      assert.equal(startup.ok,true,JSON.stringify(startup));
      assert.equal(startup.result.backend,forceWasm?'wasm':'native');
      const after=await page.evaluate(()=>{
        const panel=document.getElementById('xq-quick-hands').shadowRoot;
        return {documentToken:window.smokeDocumentToken,url:location.href,fen:window.smokeFixture.fen,
          moveCount:window.smokeFixture.moveCount,panelCount:document.querySelectorAll('#xq-quick-hands').length,
          autoButton:panel.getElementById('auto').textContent,status:panel.getElementById('status').textContent};
      });
      assert.equal(after.documentToken,before.documentToken,'Extension reload must preserve the chess document');
      assert.equal(after.url,before.url);
      assert.equal(after.fen,before.fen);
      assert.equal(after.moveCount,before.moveCount);
      assert.equal(after.panelCount,1,'Fresh content must replace the orphan panel');
      assert.match(after.autoButton,/开始自动/,'Recovered extension must remain paused');
      assert.deepEqual(documentNavigations,[],'The recovery must not navigate or refresh the chess page');
      reload={before,after,engineBefore,messagesBefore,reloadEvaluationError,invalidatedError,
        oldPanelRemoved:await oldPanel.evaluate(node=>!node.isConnected)};
      await oldPanel.dispose();
    }
    const started = Date.now();
    if(syncScenario||ackScenario||backgroundScenario){
      await page.evaluate(()=>{
        const panel=document.getElementById('xq-quick-hands').shadowRoot;
        window.smokeAutoplay={startClicks:0,searches:[]};
        panel.getElementById('auto').addEventListener('click',()=>window.smokeAutoplay.startClicks++);
        new MutationObserver(()=>{
          const depth=Number(panel.getElementById('depth').textContent.match(/\d+/)?.[0]);
          if(depth)window.smokeAutoplay.searches.push({depth,move:panel.getElementById('move').textContent,
            elapsedMs:Math.round(Number(panel.getElementById('elapsed').textContent.match(/[\d.]+/)?.[0])*1000)});
        }).observe(panel.getElementById('depth'),{childList:true,characterData:true,subtree:true});
      });
      await page.locator('#xq-quick-hands').getByRole('button',{name:'开始自动',exact:true}).click();
      if(backgroundScenario){
        const cdp=await context.newCDPSession(page);
        const target=await cdp.send('Target.getTargetInfo');
        const windowInfo=await cdp.send('Browser.getWindowForTarget',{targetId:target.targetInfo.targetId});
        const otherPage=await context.newPage();
        await otherPage.setContent('<!doctype html><title>Foreground fixture</title><h1>Background execution check</h1>');
        await otherPage.bringToFront();
        await cdp.send('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{windowState:'minimized'}});
        await page.waitForFunction(()=>document.visibilityState==='hidden',null,{polling:100,timeout:10000});
        const minimized=await cdp.send('Browser.getWindowBounds',{windowId:windowInfo.windowId});
        assert.equal(minimized.bounds.windowState,'minimized','The isolated browser window must actually be minimized');
        const hiddenState=await page.evaluate(()=>({visibilityState:document.visibilityState,hidden:document.hidden}));
        await page.waitForFunction(()=>window.smokeFixture?.ownMoves.length===1&&window.smokeAutoplay.searches.length===1,null,{polling:100,timeout:18000});
        await page.evaluate(()=>opponentMove());
        await page.waitForFunction(()=>window.smokeFixture?.ownMoves.length===2&&window.smokeAutoplay.searches.length===2,null,{polling:100,timeout:18000});
        const continuous=await page.evaluate(()=>({startClicks:window.smokeAutoplay.startClicks,visibilityState:document.visibilityState,searches:[...window.smokeAutoplay.searches],ownMoves:[...window.smokeFixture.ownMoves]}));
        assert.equal(continuous.startClicks,1,'Two background moves must follow one start click');
        assert.equal(continuous.visibilityState,'hidden');
        assert.ok(continuous.ownMoves.every(move=>move.visibilityState==='hidden'),'Both destination clicks must occur in a genuinely hidden document');
        async function pauseState() {
          const ui=await page.evaluate(()=>{
            const root=document.getElementById('xq-quick-hands').shadowRoot;
            const request=root.getElementById('pause-request'),rect=request.getBoundingClientRect();
            return {button:root.getElementById('auto').textContent,requestVisible:!request.classList.contains('hidden'),
              requestHeight:rect.height,bodyCollapsed:root.getElementById('body').classList.contains('hidden')};
          });
          const subscription=await worker.evaluate(async()=>{
            const tabs=await chrome.tabs.query({url:'https://play.xiangqi.com/computer-play'});
            return chrome.tabs.sendMessage(tabs[0].id,{type:'XQ_BACKGROUND_STATUS'},{frameId:0});
          });
          return {...ui,active:subscription.active};
        }
        await page.evaluate(()=>document.getElementById('xq-quick-hands').shadowRoot.getElementById('quick-stop').click());
        const firstRequest=await pauseState();
        assert.equal(firstRequest.requestVisible,true,'The first pause click opens the second confirmation');
        assert.equal(firstRequest.active,true,'Opening confirmation must leave background execution active');
        assert.match(firstRequest.button,/暂停自动/);
        await page.evaluate(()=>document.getElementById('xq-quick-hands').shadowRoot.getElementById('pause-cancel').click());
        const cancelled=await pauseState();
        assert.equal(cancelled.requestVisible,false,'Continue closes the pause request');
        assert.equal(cancelled.active,true,'Continue preserves background execution');
        await page.evaluate(()=>{
          const root=document.getElementById('xq-quick-hands').shadowRoot;
          root.getElementById('quick-stop').click();
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        });
        const escaped=await pauseState();
        assert.equal(escaped.requestVisible,false,'Escape only closes the confirmation');
        assert.equal(escaped.active,true,'Escape must not pause the running controller');
        await page.evaluate(()=>document.getElementById('xq-quick-hands').shadowRoot.getElementById('auto').click());
        assert.equal((await pauseState()).requestVisible,true,'The main automatic button also requests confirmation');
        await page.waitForFunction(()=>document.getElementById('xq-quick-hands').shadowRoot.getElementById('pause-request').classList.contains('hidden'),null,{polling:100,timeout:10500});
        const expired=await pauseState();
        assert.equal(expired.active,true,'An expired confirmation must not pause background execution');
        await page.evaluate(()=>{
          const root=document.getElementById('xq-quick-hands').shadowRoot;
          root.getElementById('collapse').click();
          root.getElementById('quick-stop').click();
        });
        const collapsedRequest=await pauseState();
        assert.equal(collapsedRequest.bodyCollapsed,true);
        assert.equal(collapsedRequest.requestVisible,true,'A collapsed panel still exposes pause confirmation');
        assert.ok(collapsedRequest.requestHeight>0,'Collapsed confirmation retains a visible height');
        assert.equal(collapsedRequest.active,true);
        await page.evaluate(()=>document.getElementById('xq-quick-hands').shadowRoot.getElementById('pause-confirm').click());
        assert.equal((await pauseState()).active,false,'Only the explicit second confirmation stops the controller');
        await page.evaluate(()=>document.getElementById('xq-quick-hands').shadowRoot.getElementById('collapse').click());
        await page.evaluate(()=>opponentMove());
        await page.waitForTimeout(1300);
        const paused=await page.evaluate(()=>({ownMoves:window.smokeFixture.ownMoves.length,button:document.getElementById('xq-quick-hands').shadowRoot.getElementById('auto').textContent}));
        assert.equal(paused.ownMoves,2,'Manual pause must stop background moves');
        assert.match(paused.button,/开始自动/);
        await worker.evaluate(async()=>{
          const tabs=await chrome.tabs.query({url:'https://play.xiangqi.com/computer-play'});
          await chrome.scripting.executeScript({target:{tabId:tabs[0].id},world:'ISOLATED',func:()=>{
            globalThis.smokeModalFailures=[];
            const original=globalThis.XiangqiSiteAdapter.prototype.play;
            globalThis.XiangqiSiteAdapter.prototype.play=async function(...args){
              try{return await original.apply(this,args);}
              catch(error){globalThis.smokeModalFailures.push({code:error.code,message:error.message,actionStage:error.actionStage});throw error;}
            };
          }});
        });
        await page.evaluate(()=>{
          const modal=document.createElement('div');modal.id='blocking-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
          modal.style.cssText='position:fixed;inset:0;background:#fff9;z-index:2147483646';modal.textContent='Local fixture blocking dialog';document.body.append(modal);
          document.getElementById('xq-quick-hands').shadowRoot.getElementById('auto').click();
        });
        const modalFailures=await worker.evaluate(async()=>{
          const tabs=await chrome.tabs.query({url:'https://play.xiangqi.com/computer-play'});
          for(let i=0;i<150;i++){
            const result=await chrome.scripting.executeScript({target:{tabId:tabs[0].id},world:'ISOLATED',func:()=>globalThis.smokeModalFailures});
            if(result[0].result.some(error=>error.code==='XQ_BOARD_OBSCURED'))return result[0].result;
            await new Promise(resolve=>setTimeout(resolve,100));
          }
          throw new Error('The real adapter did not reject the obscuring webpage modal');
        });
        const modal=await page.evaluate(()=>({status:document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent,ownMoves:window.smokeFixture.ownMoves.length,visibilityState:document.visibilityState}));
        modal.failures=modalFailures;
        assert.equal(modal.ownMoves,2,'A webpage modal must still prevent background destination input');
        assert.equal((await pauseState()).active,true,'A temporary obscuring modal keeps automatic execution active');
        // The confirmation checks take longer than one turn. Reestablish and
        // verify the real background state before the recovery move as well.
        await otherPage.bringToFront();
        await cdp.send('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{windowState:'minimized'}});
        await page.waitForFunction(()=>document.visibilityState==='hidden',null,{polling:100,timeout:10000});
        await page.evaluate(()=>document.getElementById('blocking-modal').remove());
        await page.waitForFunction(()=>window.smokeFixture?.ownMoves.length===3&&window.smokeAutoplay.searches.length===3,null,{polling:100,timeout:18000});
        const recovered=await page.evaluate(()=>({ownMoves:window.smokeFixture.ownMoves.length,inputAttempts:window.smokeFixture.ownInputAttempts,
          visibilityState:document.visibilityState,moveVisibilityState:window.smokeFixture.ownMoves.at(-1).visibilityState,button:document.getElementById('xq-quick-hands').shadowRoot.getElementById('auto').textContent}));
        assert.equal(recovered.inputAttempts,3,'Clearing a temporary modal resumes with exactly one new destination click');
        assert.equal(recovered.moveVisibilityState,'hidden','The modal recovery destination must also happen in a hidden document');
        assert.match(recovered.button,/暂停自动/);
        await page.evaluate(()=>document.getElementById('xq-quick-hands').shadowRoot.getElementById('quick-stop').click());
        assert.equal((await pauseState()).active,true,'The later pause request also needs separate confirmation');
        await page.evaluate(()=>document.getElementById('xq-quick-hands').shadowRoot.getElementById('pause-confirm').click());
        assert.equal((await pauseState()).active,false);
        background={hiddenState,windowState:minimized.bounds.windowState,continuous,pauseConfirmation:{firstRequest,cancelled,escaped,expired,collapsedRequest},paused,modal,recovered};
        await cdp.send('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{windowState:'normal'}});
        await page.bringToFront();
      }else{
        await page.waitForFunction(()=>window.smokeFixture?.ownMoves.length===2&&window.smokeAutoplay.searches.length===2&&
          !window.smokeFixture.syncPhase&&!window.smokeFixture.ackPhase,null,{timeout:25000});
        await page.waitForTimeout(600);
      }
    }else{
      await page.locator('#xq-quick-hands').getByRole('button',{name:'走一步',exact:true}).click();
      await page.waitForFunction(() => {
        const panel=document.getElementById('xq-quick-hands')?.shadowRoot;
        return panel?.getElementById('status').textContent==='本步已完成';
      }, null, {timeout:15000});
    }
    const elapsed = Date.now()-started;
    const panel = await page.evaluate(() => {
      const root=document.getElementById('xq-quick-hands').shadowRoot;
      return Object.fromEntries(['status','move','depth','score','elapsed','importance','allocated','pv'].map(id=>[id,root.getElementById(id).textContent]));
    });
    const curve = await page.evaluate(() => {
      const root=document.getElementById('xq-quick-hands').shadowRoot;
      const chart=root.getElementById('evaluation-chart');
      return {perspective:chart.dataset.perspective,controlled:chart.dataset.controlled,
        hasViewpoint:!!root.getElementById('evaluation-viewpoint'),
        tooltip:root.getElementById('evaluation-tooltip').textContent,
        points:[...root.querySelectorAll('#evaluation-points circle')].map(point=>({
          ply:Number(point.dataset.ply),value:Number(point.dataset.value),mate:point.dataset.mate==='true',
          label:point.getAttribute('aria-label')}))};
    });
    const boardState = JSON.parse(await page.locator('#fixture-state').textContent());
    const autoplay=syncScenario||ackScenario||backgroundScenario?await page.evaluate(()=>({...window.smokeAutoplay,
      button:document.getElementById('xq-quick-hands').shadowRoot.getElementById('auto').textContent})):null;
    const messages = await worker.evaluate(() => globalThis.smokeObservedMessages);
    const analysisMessages=messages.filter(message=>message.type==='XQ_ANALYZE');
    const openingAnalyses=analysisMessages.filter(message=>message.openingOnly);
    const liveAnalyses=analysisMessages.filter(message=>!message.openingOnly);
    const analysis = messages.find(message=>message.type==='XQ_ANALYZE');
    assert.ok(analysis,'The real service worker must receive an analysis request');
    assert.equal(analysis.currentTabUrl,'https://play.xiangqi.com/computer-play');
    const initialPlies=playerSide==='black'?1:0;
    assert.equal(boardState.moveCount,initialPlies+(backgroundScenario?5:syncScenario||reloadScenario||ackScenario?3:1));
    if(!backgroundScenario)assert.equal(boardState.lastMove,panel.move);
    assert.match(startup.result.name, /Pikafish/, 'The actual warmed backend is Pikafish');
    assert.ok(startup.result.nnue, 'The actual warmed backend reports its NNUE network');
    assert.ok(Number(panel.depth.match(/\d+/)?.[0])>=6,'Real Pikafish search must finish at least six plies');
    assert.ok(panel.pv.includes(panel.move),'The displayed move must have a searched principal variation');
    assert.equal(curve.perspective,playerSide,'The production curve follows the controlled side');
    assert.equal(curve.controlled,'true');
    assert.equal(curve.hasViewpoint,false,'The redundant perspective caption is removed');
    assert.ok(!/我的视角|分析视角|执红|执黑/.test(curve.tooltip),'Point details contain only the ply and evaluation');
    assert.ok(curve.points.some(point=>point.ply===0),'The genuine initial position evaluation is retained');
    if(playerSide==='black'||reloadScenario){
      assert.equal(openingAnalyses.length,1,'Exactly one initial-position analysis supplements this panel');
      assert.equal(openingAnalyses[0].historyPlies,0);
    }
    if(!syncScenario&&!ackScenario&&!backgroundScenario&&!reloadScenario){
      assert.equal(boardState.ownInputAttempts,1,'The initial-position analysis must not add destination input');
      assert.equal(boardState.ownMoves.length,1);
      assert.deepEqual(analysisMessages.map(message=>message.historyPlies),playerSide==='black'?[0,1]:[0]);
      assert.deepEqual(curve.points.map(point=>point.ply),playerSide==='black'?[0,1]:[0]);
      const latest=curve.points.at(-1);
      const score=Number(panel.score.match(/[+-]?\d+(?:\.\d+)?/)?.[0]);
      assert.equal(latest.value,panel.score.startsWith('杀棋')?Math.sign(score):score,
        'The own-turn numeric evaluation and curve point share sign and magnitude');
    }
    if(backgroundScenario){
      assert.equal(boardState.ownMoves.length,3);
      assert.equal(boardState.ownInputAttempts,3);
      assert.equal(boardState.rejectedOwnInputs,0);
      assert.ok(background.continuous.searches.every(search=>search.depth>=6&&search.elapsedMs<5000));
      const analyzedPlies=liveAnalyses.map(message=>message.historyPlies);
      assert.deepEqual(analyzedPlies.slice(0,2),[initialPlies,initialPlies+2]);
      assert.ok(analyzedPlies.length>=4&&analyzedPlies.slice(2).every(plies=>plies===initialPlies+4),'Only the currently blocked position may be retried before recovery');
    }else if(syncScenario||ackScenario){
      assert.equal(autoplay.startClicks,1,'Autoplay must continue after one start click');
      assert.match(autoplay.button,/暂停自动/,'Transient updates must leave autoplay running');
      assert.equal(boardState.ownMoves.length,2);
      assert.equal(boardState.ownInputAttempts,2,'Each own move must have one destination click');
      assert.equal(boardState.rejectedOwnInputs,0,'No duplicate input may occur during the opponent turn');
      assert.equal(new Set(boardState.ownMoves.map(move=>move.beforeFen)).size,2);
      assert.deepEqual(liveAnalyses.map(message=>message.historyPlies),[initialPlies,initialPlies+2]);
      assert.equal(autoplay.searches.length,2);
      assert.ok(autoplay.searches.every(search=>search.depth>=6&&search.elapsedMs<5000));
      if(syncScenario){
        assert.deepEqual(boardState.syncEvents.map(event=>event.name),['after-own-destination-1','waiting-for-opponent',
          'after-opponent-move','after-own-destination-2']);
        assert.ok(boardState.syncEvents.every(event=>event.reads>0&&event.completedAt>=event.startedAt+250),
          'The extension must read all injected 300ms inconsistent snapshots');
      }else{
        assert.equal(boardState.ackEvents.length,2);
        assert.ok(boardState.ackEvents.every(event=>event.reads>0&&event.completedAt>=event.startedAt+850),
          'Both accepted moves must expose stale coherent snapshots for 900ms');
        assert.ok(boardState.rootFlips>=3,'Committed state must alternate between both React roots');
        assert.ok(boardState.staleReturnReads>0,'The bridge must encounter stale return pointers on shared children');
        assert.equal(boardState.playerSide,playerSide);
        assert.equal(boardState.flipBoard,playerSide==='black');
      }
    }else assert.ok(elapsed<5000,'Warmed end-to-end move must finish in five seconds');
    if(reloadScenario){
      assert.equal(boardState.ownInputAttempts,2);
      assert.equal(boardState.rejectedOwnInputs,0);
      assert.equal(boardState.ownMoves.length,2);
      assert.deepEqual(liveAnalyses.map(message=>message.historyPlies),[initialPlies+2]);
      assert.deepEqual(documentNavigations,[]);
      reload.documentNavigations=documentNavigations;
    }
    assert.deepEqual(errors,[]);
    await fs.mkdir(results,{recursive:true});
    await page.screenshot({path:path.join(results,artifactPrefix+'.png'),fullPage:true});
    const report={ok:true,executablePath,manifestVersion:JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8')).version,
      scenario:forceWasm?
        'real MV3 extension + missing native host + genuine Pikafish NNUE WASM fallback + SPA lobby-to-game + '+
          (backgroundScenario?'one-click autoplay through genuinely hidden tab + minimized isolated browser + pause confirmation/cancel/Escape/expiry/collapsed panel + webpage modal recovery without repeated destination input':
            ackScenario?'one-click autoplay + '+playerSide+' side + flipped board when black + two 900ms delayed confirmations + shared React child and stale ancestors':
            syncScenario?'one-click autoplay through 300ms inconsistent state updates and two acknowledged own moves':
            reloadScenario?'real runtime reload + preserved live chess document + fresh paused panel + acknowledged move':'fixture move acknowledgement'):
        'real MV3 extension + native messaging + official Pikafish NNUE + SPA lobby-to-game + fixture move acknowledgement',
      engine:startup.result,
      elapsedMs:elapsed,panel,curve,boardState,...(autoplay?{autoplay}:{}),...(reload?{reload}:{}),...(background?{background}:{}),messages,offscreenContexts:contextsBefore,pageErrors:errors};
    await fs.writeFile(path.join(results,artifactPrefix+'.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } catch(error) {
    if(page){await fs.mkdir(results,{recursive:true});await page.screenshot({path:path.join(results,artifactPrefix+'-failed.png'),fullPage:true}).catch(()=>{});console.error('PANEL',await page.evaluate(()=>{const root=document.getElementById('xq-quick-hands')?.shadowRoot;return root&&{status:root.getElementById('status').textContent}}).catch(()=>''));}
    const worker = context?.serviceWorkers()[0];
    if (worker) console.error('ENGINE', await worker.evaluate(async () => {
      try { return await chrome.runtime.sendMessage({target:'offscreen',type:'XQ_ENGINE_WARMUP'}); }
      catch (failure) { return {error:failure.message}; }
    }).catch(failure=>({error:failure.message})));
    throw error;
  } finally {
    await context?.close();
    await browser?.close();
    if(browserProcess&&browserProcess.exitCode===null)browserProcess.kill();
    if(path.dirname(profile)!==tempRoot || !path.basename(profile).startsWith('xiangqi-mv3-smoke-')) throw new Error('Refusing unexpected profile cleanup path');
    await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300});
  }
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
