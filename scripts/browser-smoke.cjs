const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

const project = path.resolve(__dirname, '..');
const extension = path.join(project, 'extension');
const results = path.join(project, 'test-results');
const artifactPrefix = process.env.XQ_SMOKE_ARTIFACT_PREFIX || 'mv3-pikafish';
const syncScenario = process.env.XQ_SMOKE_SYNC === '1';
const reloadScenario = process.env.XQ_SMOKE_RELOAD === '1';
if(syncScenario&&reloadScenario)throw new Error('Run sync and reload smoke scenarios separately.');
if (!/^[a-z0-9-]+$/.test(artifactPrefix)) throw new Error('Invalid smoke artifact prefix');
const tempRoot = path.resolve(os.tmpdir());
const initialFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1';

const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MV3 SPA smoke fixture</title>
<style>body{margin:32px;font:15px system-ui;background:#f2f5f4;color:#24342b}h1{font-size:22px}button{font:inherit;padding:9px 12px}#game-grid{position:relative;width:450px;height:500px;background:#e1e8df;border:1px solid #81937d;margin-top:20px}.square{position:absolute;width:50px;height:50px;box-sizing:border-box;border:1px solid #a8b5a2}.square-target{width:100%;height:100%}.pieces-container{position:absolute;inset:0;pointer-events:none}.pieces-container>div{position:absolute;width:50px;height:50px}.piece{position:absolute;inset:4px;display:grid;place-items:center;background:#fff;border:2px solid #465a45;border-radius:50%;pointer-events:auto;cursor:pointer;font-size:20px}.red{color:#b2232b}.selected-piece{outline:3px solid #22a168}pre{max-width:680px;white-space:pre-wrap;overflow-wrap:anywhere}</style></head>
<body><h1>MV3 SPA smoke fixture</h1><button id="enter">Enter fixture game</button><div id="stage"></div><pre id="fixture-state">Lobby</pre>
<script>
const INITIAL = ${JSON.stringify(initialFen)};
const SYNC_SCENARIO = ${JSON.stringify(syncScenario)};
const boardContext = {fen:INITIAL,myPieceCase:'toUpperCase',isMyTurnNow:true,flipBoard:false,viewOnly:false};
const game = {playerSide:'red',flipBoard:false,historyMode:false,gameData:{gameID:'mv3-fixture'},boardContext,
  gamePlayData:{currentFen:INITIAL,initFen:INITIAL,moveCount:0,turnNow:'red',state:2,endReason:null,moves:[]}};
let selected = null;
let board;
let pieces;
let halfmove = 0;
let fullmove = 1;
let ownInputAttempts = 0;
let rejectedOwnInputs = 0;
let syncPhase = null;
const ownMoves = [];
const syncEvents = [];
const cells = INITIAL.split(' ')[0].split('/').map(row=>[...row].flatMap(piece=>/\\d/.test(piece)?Array(Number(piece)).fill(null):[piece]));
function square(row,column){return String.fromCharCode(97+column)+(10-row)}
function placement(){return cells.map(row=>{let result='',empty=0;for(const piece of row){if(!piece)empty++;else{if(empty)result+=empty;empty=0;result+=piece}}if(empty)result+=empty;return result}).join('/')}
function publish(){
  const data=game.gamePlayData;
  window.smokeFixture={moveCount:data.moveCount,lastMove:data.moves.at(-1)?.uci||null,fen:data.currentFen,
    route:location.pathname,ownInputAttempts,rejectedOwnInputs,ownMoves,syncEvents,syncPhase:syncPhase?.name||null};
  document.getElementById('fixture-state').textContent=JSON.stringify(window.smokeFixture);
}
function inconsistentTurn(name){
  const correct=game.gamePlayData.currentFen.split(' ')[1]==='b'?'black':'red';
  game.gamePlayData.turnNow=correct==='red'?'black':'red';
  const phase={name,durationMs:300,reads:0,startedAt:Math.round(performance.now())};
  syncEvents.push(phase);syncPhase=phase;publish();
  setTimeout(()=>{game.gamePlayData.turnNow=correct;boardContext.isMyTurnNow=correct==='red';
    phase.completedAt=Math.round(performance.now());syncPhase=null;publish();},300);
}
window.addEventListener('message',event=>{
  if(event.source===window&&event.data?.type==='xiangqi-assistant:read'&&syncPhase)syncPhase.reads++;
});
function applyMove(uci){
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
  data.moves.push({uci,currentFen:fen,index:data.moveCount});
  Object.assign(data,{currentFen:fen,moveCount:data.moveCount+1,turnNow:turn});
  Object.assign(boardContext,{fen,isMyTurnNow:turn==='red'});render();publish();
}
function opponentMove(){
  const options=['a7a6','c7c6','e7e6','g7g6','i7i6'];
  const move=options.find(uci=>cells[3][uci.charCodeAt(0)-97]==='p'&&!cells[4][uci.charCodeAt(0)-97]);
  if(!move)throw new Error('No fixture opponent pawn move');
  applyMove(move);inconsistentTurn('after-opponent-move');
}
function destination(row,column){
  if(!selected)return;
  ownInputAttempts++;
  if(game.gamePlayData.turnNow!=='red'||!boardContext.isMyTurnNow){rejectedOwnInputs++;selected=null;publish();return;}
  const from=selected;selected=null;
  const uci=square(from.r,from.c)+square(row,column);
  ownMoves.push({uci,beforeFen:game.gamePlayData.currentFen,acceptedAt:Math.round(performance.now())});
  applyMove(uci);
  if(SYNC_SCENARIO){
    inconsistentTurn('after-own-destination-'+ownMoves.length);
    if(ownMoves.length===1){setTimeout(()=>inconsistentTurn('waiting-for-opponent'),750);setTimeout(opponentMove,1500);}
  }
}
function render(){
  pieces.replaceChildren();
  cells.forEach((row,r)=>row.forEach((piece,c)=>{if(!piece)return;const holder=document.createElement('div');holder.style.left=(c*50)+'px';holder.style.top=(r*50)+'px';const token=document.createElement('div');token.className='piece'+(piece===piece.toUpperCase()?' red':'');token.textContent=piece;token.dataset.square=square(r,c);token.addEventListener('click',event=>{event.stopPropagation();pieces.querySelectorAll('.piece').forEach(item=>item.classList.remove('selected-piece'));token.classList.add('selected-piece');selected={r,c}});holder.append(token);pieces.append(holder)}));
}
function enter(){
  history.pushState({},'', '/computer-play');
  document.getElementById('enter').remove();
  board=document.createElement('div');board.id='game-grid';
  const root={memoizedProps:game,return:null};const provider={memoizedProps:{value:boardContext},return:root};board['__reactFiber$smoke']={memoizedProps:{id:'game-grid'},return:provider};
  for(let r=0;r<10;r++)for(let c=0;c<9;c++){const cell=document.createElement('div');cell.className='square '+(10-r)+'-'+String.fromCharCode(97+c);cell.style.left=(c*50)+'px';cell.style.top=(r*50)+'px';const target=document.createElement('div');target.className='square-target';target.addEventListener('click',()=>destination(r,c));cell.append(target);board.append(cell)}
  pieces=document.createElement('div');pieces.className='pieces-container';board.append(pieces);document.getElementById('stage').append(board);render();
  publish();
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
        ...(message.type==='XQ_ANALYZE'?{fen:message.fen,historyPlies:message.moves?.length??null}:{}),
      }));
      return false;
    });
  });
}

async function main() {
  const profile = await fs.mkdtemp(path.join(tempRoot, 'xiangqi-mv3-smoke-'));
  let context;
  let page;
  const errors = [];
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', executablePath, headless: true, viewport: {width: 1280, height: 900},
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    });
    await context.route('https://play.xiangqi.com/**', route => route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture}));
    page = context.pages()[0] || await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout:20000});
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
    let documentNavigations;
    if(reloadScenario){
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
          panel.getElementById('engine-name').textContent.includes('NNUE');
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
    if(syncScenario){
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
      await page.waitForFunction(()=>window.smokeFixture?.ownMoves.length===2&&window.smokeAutoplay.searches.length===2&&
        !window.smokeFixture.syncPhase,null,{timeout:25000});
      await page.waitForTimeout(600);
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
      return Object.fromEntries(['engine-name','status','move','depth','score','elapsed','importance','allocated','pv'].map(id=>[id,root.getElementById(id).textContent]));
    });
    const boardState = JSON.parse(await page.locator('#fixture-state').textContent());
    const autoplay=syncScenario?await page.evaluate(()=>({...window.smokeAutoplay,
      button:document.getElementById('xq-quick-hands').shadowRoot.getElementById('auto').textContent})):null;
    const messages = await worker.evaluate(() => globalThis.smokeObservedMessages);
    const analysis = messages.find(message=>message.type==='XQ_ANALYZE');
    assert.ok(analysis,'The real service worker must receive an analysis request');
    assert.equal(analysis.currentTabUrl,'https://play.xiangqi.com/computer-play');
    assert.equal(boardState.moveCount,syncScenario||reloadScenario?3:1);
    assert.equal(boardState.lastMove,panel.move);
    assert.match(panel['engine-name'], /Pikafish.*NNUE/, 'The production extension must identify the verified Pikafish NNUE backend');
    assert.ok(Number(panel.depth.match(/\d+/)?.[0])>=6,'Real Pikafish search must finish at least six plies');
    assert.ok(panel.pv.includes(panel.move),'The displayed move must have a searched principal variation');
    if(syncScenario){
      assert.equal(autoplay.startClicks,1,'Autoplay must continue after one start click');
      assert.match(autoplay.button,/暂停自动/,'Transient updates must leave autoplay running');
      assert.equal(boardState.ownMoves.length,2);
      assert.equal(boardState.ownInputAttempts,2,'Each own move must have one destination click');
      assert.equal(boardState.rejectedOwnInputs,0,'No duplicate input may occur during the opponent turn');
      assert.equal(new Set(boardState.ownMoves.map(move=>move.beforeFen)).size,2);
      assert.deepEqual(messages.filter(message=>message.type==='XQ_ANALYZE').map(message=>message.historyPlies),[0,2]);
      assert.equal(autoplay.searches.length,2);
      assert.ok(autoplay.searches.every(search=>search.depth>=6&&search.elapsedMs<5000));
      assert.deepEqual(boardState.syncEvents.map(event=>event.name),['after-own-destination-1','waiting-for-opponent',
        'after-opponent-move','after-own-destination-2']);
      assert.ok(boardState.syncEvents.every(event=>event.reads>0&&event.completedAt>=event.startedAt+250),
        'The extension must read all injected 300ms inconsistent snapshots');
    }else assert.ok(elapsed<5000,'Warmed end-to-end move must finish in five seconds');
    if(reloadScenario){
      assert.equal(boardState.ownInputAttempts,2);
      assert.equal(boardState.rejectedOwnInputs,0);
      assert.equal(boardState.ownMoves.length,2);
      assert.deepEqual(messages.filter(message=>message.type==='XQ_ANALYZE').map(message=>message.historyPlies),[2]);
      assert.deepEqual(documentNavigations,[]);
      reload.documentNavigations=documentNavigations;
    }
    assert.deepEqual(errors,[]);
    await fs.mkdir(results,{recursive:true});
    await page.screenshot({path:path.join(results,artifactPrefix+'.png'),fullPage:true});
    const report={ok:true,executablePath,manifestVersion:JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8')).version,
      scenario:forceWasm?
        'real MV3 extension + missing native host + genuine Pikafish NNUE WASM fallback + SPA lobby-to-game + '+
          (syncScenario?'one-click autoplay through 300ms inconsistent state updates and two acknowledged own moves':
            reloadScenario?'real runtime reload + preserved live chess document + fresh paused panel + acknowledged move':'fixture move acknowledgement'):
        'real MV3 extension + native messaging + official Pikafish NNUE + SPA lobby-to-game + fixture move acknowledgement',
      engine:startup.result,
      elapsedMs:elapsed,panel,boardState,...(autoplay?{autoplay}:{}),...(reload?{reload}:{}),messages,offscreenContexts:contextsBefore,pageErrors:errors};
    await fs.writeFile(path.join(results,artifactPrefix+'.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } catch(error) {
    if(page){await fs.mkdir(results,{recursive:true});await page.screenshot({path:path.join(results,artifactPrefix+'-failed.png'),fullPage:true}).catch(()=>{});console.error('PANEL',await page.evaluate(()=>{const root=document.getElementById('xq-quick-hands')?.shadowRoot;return root&&{status:root.getElementById('status').textContent,engine:root.getElementById('engine-name').textContent}}).catch(()=>''));}
    const worker = context?.serviceWorkers()[0];
    if (worker) console.error('ENGINE', await worker.evaluate(async () => {
      try { return await chrome.runtime.sendMessage({target:'offscreen',type:'XQ_ENGINE_WARMUP'}); }
      catch (failure) { return {error:failure.message}; }
    }).catch(failure=>({error:failure.message})));
    throw error;
  } finally {
    await context?.close();
    if(path.dirname(profile)!==tempRoot || !path.basename(profile).startsWith('xiangqi-mv3-smoke-')) throw new Error('Refusing unexpected profile cleanup path');
    await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300});
  }
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
