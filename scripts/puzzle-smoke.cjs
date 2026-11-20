const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const project = path.resolve(__dirname, '..');
const extension = path.join(project, 'extension');
const results = path.join(project, 'test-results');
const tempRoot = path.resolve(os.tmpdir());
const initialFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1';

const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Puzzle contract fixture</title>
<style>body{margin:32px;background:#eef3ef;font:15px system-ui}#game-grid{position:relative;width:450px;height:500px;background:#e1e8df;border:1px solid #81937d}.square{position:absolute;width:50px;height:50px;box-sizing:border-box;border:1px solid #a8b5a2}.square-target{width:100%;height:100%}.pieces-container{position:absolute;inset:0;pointer-events:none}.pieces-container>div{position:absolute;width:50px;height:50px}.piece{position:absolute;inset:4px;display:grid;place-items:center;background:#fff;border:2px solid #465a45;border-radius:50%;pointer-events:auto;font-size:20px}.selected-piece{outline:3px solid #22a168}</style></head>
<body><h1>Local puzzle and analysis fixture</h1><div id="game-grid"></div><pre id="fixture-state"></pre><script>
const INITIAL=${JSON.stringify(initialFen)};
let boardContext={fen:INITIAL,myPieceCase:'toUpperCase',isMyTurnNow:true,flipBoard:false,viewOnly:false,wrongMove:null,movePiece(){},isLegalToMove(){return true}};
let game={puzzle:{puzzle_id:123,initial_fen:INITIAL},movesHistory:[{initMove:true,index:0,currentFen:INITIAL}],activeMove:null,moveCount:0,isPuzzleCompleted:false,lastMoveCompleted:false,wrongMove:null,isPlayerTurn:true,playAgain:0,remainingTime:180,totalLives:3,completeRaceAttemptSuccess:false,completeRaceAttemptData:null};
let answerReads=0;
for(const key of ['answerTree','model_answer'])Object.defineProperty(game.puzzle,key,{get(){answerReads++;throw new Error('Puzzle answers must never be read')}});
const board=document.getElementById('game-grid');
const pointerInputs=[];
for(const type of ['mousedown','mouseup','click'])board.addEventListener(type,event=>{const rect=event.target.getBoundingClientRect();pointerInputs.push({type,clientX:event.clientX,clientY:event.clientY,left:rect.left,top:rect.top,width:rect.width,height:rect.height,isTrusted:event.isTrusted})},true);
const pieces=document.createElement('div');pieces.className='pieces-container';
const rootState={current:null};const root={tag:3,stateNode:rootState,return:null};
const gameFiber={memoizedProps:game,return:root};const provider={memoizedProps:{value:boardContext},return:gameFiber};const host={memoizedProps:{id:'game-grid'},return:provider};
root.child=gameFiber;gameFiber.child=provider;provider.child=host;rootState.current=root;board.__reactFiber$puzzleFixture=host;
let selected=null;let ownMoves=[];let inputAttempts=0;let completeOnMove=false;let wrongOnMove=false;let halfmove=0;let fullmove=1;
let cells=INITIAL.split(' ')[0].split('/').map(row=>[...row].flatMap(piece=>/\\d/.test(piece)?Array(Number(piece)).fill(null):[piece]));
function publish(){window.puzzleFixture={fen:boardContext.fen,moveCount:game.moveCount,ownMoves:[...ownMoves],inputAttempts,answerReads,pointerInputs:[...pointerInputs],completed:game.isPuzzleCompleted,wrong:Boolean(game.wrongMove),id:game.puzzle.puzzle_id,route:location.pathname};document.getElementById('fixture-state').textContent=JSON.stringify(window.puzzleFixture)}
function sync(){provider.memoizedProps={value:boardContext};gameFiber.memoizedProps=game;publish()}
function placement(){return cells.map(row=>{let text='',empty=0;for(const p of row){if(!p)empty++;else{if(empty)text+=empty;empty=0;text+=p}}if(empty)text+=empty;return text}).join('/')}
function render(){pieces.replaceChildren();cells.forEach((row,r)=>row.forEach((piece,c)=>{if(!piece)return;const holder=document.createElement('div');holder.style.left=c*50+'px';holder.style.top=r*50+'px';const token=document.createElement('div');token.className='piece';token.textContent=piece;token.addEventListener('click',event=>{event.stopPropagation();pieces.querySelectorAll('.piece').forEach(p=>p.classList.remove('selected-piece'));token.classList.add('selected-piece');selected={r,c}});holder.append(token);pieces.append(holder)}))}
function applyMove(uci){const m=uci.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);if(!m)throw new Error('Bad fixture move');const fr=10-Number(m[2]),fc=m[1].charCodeAt(0)-97,tr=10-Number(m[4]),tc=m[3].charCodeAt(0)-97;const piece=cells[fr][fc];if(!piece)throw new Error('No fixture source');halfmove=cells[tr][tc]||piece.toLowerCase()==='p'?0:halfmove+1;const black=piece===piece.toLowerCase();if(black)fullmove++;cells[tr][tc]=piece;cells[fr][fc]=null;const fen=placement()+' '+(black?'r':'b')+' - - '+halfmove+' '+fullmove;game.moveCount++;const move={uci,index:game.moveCount,currentFen:fen};game.movesHistory.push(move);game.activeMove=move;boardContext={...boardContext,fen,isMyTurnNow:black};game.isPlayerTurn=black;render();sync()}
function destination(r,c){if(!selected)return;inputAttempts++;if(!boardContext.isMyTurnNow||game.isPuzzleCompleted||game.wrongMove){selected=null;sync();return}const from=selected;selected=null;const uci=String.fromCharCode(97+from.c)+(10-from.r)+String.fromCharCode(97+c)+(10-r);ownMoves.push({uci,fen:boardContext.fen});if(wrongOnMove){game.wrongMove={uci};boardContext.wrongMove={uci};sync();return}applyMove(uci);if(completeOnMove){game.isPuzzleCompleted=true;game.lastMoveCompleted=true;sync()}}
for(let r=0;r<10;r++)for(let c=0;c<9;c++){const square=document.createElement('div');square.className='square '+(10-r)+'-'+String.fromCharCode(97+c);square.style.left=c*50+'px';square.style.top=r*50+'px';const target=document.createElement('div');target.className='square-target';target.addEventListener('click',()=>destination(r,c));square.append(target);board.append(square)}board.append(pieces);render();sync();
window.fixtureActions={completeNext(){completeOnMove=true},wrongNext(){wrongOnMove=true},opponentMove(){const options=['a7a6','c7c6','e7e6','g7g6','i7i6'];const move=options.find(uci=>cells[3][uci.charCodeAt(0)-97]==='p'&&!cells[4][uci.charCodeAt(0)-97]);if(!move)throw new Error('No opponent fixture move');applyMove(move)},switchPuzzle(){game.puzzle.puzzle_id=456;game.playAgain++;sync()},raceEnd(){game.remainingTime=0;sync()}};
</script></body></html>`;

async function main() {
  const profile = await fs.mkdtemp(path.join(tempRoot, 'xiangqi-puzzle-smoke-'));
  let context, page, worker;
  const errors = [], cases = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath(),
      channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    });
    await context.route('https://play.xiangqi.com/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture }));
    page = context.pages()[0] || await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const isWorker = candidate => /^chrome-extension:\/\/[^/]+\/background\.js$/.test(candidate.url());
    worker = context.serviceWorkers().find(isWorker) || await context.waitForEvent('serviceworker', { predicate: isWorker, timeout: 20000 });
    await worker.evaluate(() => {
      const connect = chrome.runtime.connectNative.bind(chrome.runtime);
      chrome.runtime.connectNative = () => connect('com.xiangqi.quick_hands.deliberately_missing');
      globalThis.puzzleSmokeRequests = [];
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message.type === 'XQ_ANALYZE' && sender.tab) globalThis.puzzleSmokeRequests.push({ fen: message.fen, moves: message.moves, url: sender.tab.url });
      });
    });
    async function open(route) {
      await page.goto('https://play.xiangqi.com' + route);
      await page.locator('#panel').waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const r = document.getElementById('xq-quick-hands')?.shadowRoot;
        return r && !r.getElementById('single').disabled;
      }, null, { timeout: 30000 });
      await worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
        await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', func: () => {
          const original = globalThis.XiangqiSiteAdapter.prototype.play;
          globalThis.puzzleSmokePlayOptions = [];
          globalThis.XiangqiSiteAdapter.prototype.play = function(move, snapshot, options) {
            globalThis.puzzleSmokePlayOptions.push({ move, varyOperations: options.varyOperations });
            return original.call(this, move, snapshot, options);
          };
        } });
      });
    }
    async function playOptions() {
      return worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
        const result = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', func: () => globalThis.puzzleSmokePlayOptions });
        return result[0].result;
      });
    }
    async function savedVariation(expected) {
      await worker.evaluate(async expected => {
        for (let i = 0; i < 40; i++) {
          if ((await chrome.storage.local.get('varyOperations')).varyOperations === expected) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Operation variation setting was not saved');
      }, expected);
    }
    async function state() {
      return page.evaluate(() => {
        const r = document.getElementById('xq-quick-hands').shadowRoot;
        return { ...window.puzzleFixture, status: r.getElementById('status').textContent, auto: r.getElementById('auto').textContent, autoDisabled: r.getElementById('auto').disabled, singleDisabled: r.getElementById('single').disabled, single: r.getElementById('single').textContent, variationChecked: r.getElementById('vary-operations').checked, variationDisabled: r.getElementById('vary-operations').disabled, side: r.getElementById('side').textContent, move: r.getElementById('move').textContent, depth: r.getElementById('depth').textContent, engine: r.getElementById('engine-name').textContent };
      });
    }
    async function waitPaused(pattern) {
      await page.waitForFunction(source => {
        const r = document.getElementById('xq-quick-hands').shadowRoot;
        return new RegExp(source).test(r.getElementById('status').textContent) && /开始自动/.test(r.getElementById('auto').textContent);
      }, pattern, { timeout: 15000 });
    }

    for (const [route, ending] of [['/puzzle/123/P', 'complete'], ['/puzzle/123/C', 'wrong'], ['/puzzle/race/fixture', 'race']]) {
      await open(route);
      const before = await state();
      assert.match(before.side, ending === 'race' ? /题库竞速/ : /题库练习/);
      assert.equal(before.autoDisabled, false);
      assert.equal(before.variationChecked, true, 'Variation defaults on for each puzzle route');
      assert.equal(before.variationDisabled, false);
      assert.match(before.engine, /Pikafish.*NNUE/);
      if (ending === 'complete') await page.evaluate(() => window.fixtureActions.completeNext());
      if (ending === 'wrong') await page.evaluate(() => window.fixtureActions.wrongNext());
      await page.locator('#auto').click();
      await page.waitForFunction(() => /正在计算/.test(document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent));
      assert.equal((await state()).variationDisabled, false, 'The main-panel switch remains usable during an active operation');
      await page.locator('#vary-operations').uncheck();
      await savedVariation(false);
      assert.equal((await state()).variationChecked, false, 'The user can disable the option while computation is running');
      if (ending === 'complete') await waitPaused('题目已完成');
      if (ending === 'wrong') await waitPaused('走法未通过');
      if (ending === 'race') {
        await page.waitForFunction(() => window.puzzleFixture.ownMoves.length === 1, null, { timeout: 15000 });
        await page.evaluate(() => window.fixtureActions.raceEnd());
        await waitPaused('题目已完成');
      }
      const after = await state();
      assert.equal(after.inputAttempts, 1);
      assert.equal(after.ownMoves.length, 1);
      assert.equal(after.singleDisabled, true);
      assert.equal(after.answerReads, 0);
      assert.equal(after.variationDisabled, false, 'The switch remains available after automatic pause');
      assert.equal(after.variationChecked, false, 'The changed setting remains off when the current move finishes');
      const captured = await playOptions();
      assert.deepEqual(captured, [{ move: after.ownMoves[0].uci, varyOperations: true }], 'The current move retains the setting captured before the user changed it');
      assert.equal(after.pointerInputs.length, 6, 'Each move emits exactly one source and one destination event sequence');
      for (let i = 0; i < after.pointerInputs.length; i += 3) {
        const sequence = after.pointerInputs.slice(i, i + 3);
        assert.deepEqual(sequence.map(event => event.type), ['mousedown', 'mouseup', 'click']);
        assert.equal(new Set(sequence.map(event => event.clientX + ',' + event.clientY)).size, 1, 'One click keeps consistent event coordinates');
        for (const event of sequence) {
          assert.ok(event.clientX >= event.left + event.width * .42 - 1 && event.clientX <= event.left + event.width * .58 + 1, 'Actual X stays within the target central region');
          assert.ok(event.clientY >= event.top + event.height * .42 - 1 && event.clientY <= event.top + event.height * .58 + 1, 'Actual Y stays within the target central region');
          assert.equal(event.isTrusted, false, 'The extension does not turn synthetic inputs into trusted browser inputs');
        }
      }
      if (ending !== 'wrong') assert.ok(Number(after.depth.match(/\d+/)?.[0]) >= 6);
      cases.push({ route, ending, before, after, capturedPlayOptions: captured });
      await page.locator('#vary-operations').check();
      await savedVariation(true);
    }

    await open('/puzzle/123/P');
    await page.locator('#auto').click();
    await page.waitForFunction(() => window.puzzleFixture.ownMoves.length === 1 && /等待对方/.test(document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent), null, { timeout: 15000 });
    await page.evaluate(() => window.fixtureActions.switchPuzzle());
    await waitPaused('新对局|已切换');
    await page.evaluate(() => window.fixtureActions.opponentMove());
    await page.waitForTimeout(1000);
    const switched = await state();
    assert.equal(switched.ownMoves.length, 1, 'Changing puzzle must stop autoplay');
    assert.match(switched.auto, /开始自动/);
    assert.equal(switched.answerReads, 0);
    cases.push({ route: '/puzzle/123/P', ending: 'switch-puzzle', after: switched });

    await open('/analysis/board');
    const analysisBefore = await state();
    assert.match(analysisBefore.single, /分析局面/);
    assert.equal(analysisBefore.autoDisabled, true);
    assert.match(analysisBefore.side, /仅分析/);
    await page.locator('#single').click();
    await page.waitForFunction(() => /分析完成/.test(document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent), null, { timeout: 15000 });
    const analysisAfter = await state();
    assert.equal(analysisAfter.inputAttempts, 0);
    assert.equal(analysisAfter.ownMoves.length, 0);
    assert.equal(analysisAfter.moveCount, 0);
    assert.equal(analysisAfter.fen, initialFen);
    assert.ok(Number(analysisAfter.depth.match(/\d+/)?.[0]) >= 6);
    assert.match(analysisAfter.move, /^[a-i](10|[1-9])[a-i](10|[1-9])$/);
    assert.equal(analysisAfter.answerReads, 0);
    cases.push({ route: '/analysis/board', ending: 'suggest-only', before: analysisBefore, after: analysisAfter });
    assert.deepEqual(errors, []);
    await fs.mkdir(results, { recursive: true });
    await page.screenshot({ path: path.join(results, 'mv3-puzzle-analysis.png'), fullPage: true });
    const report = { ok: true, manifestVersion: JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8')).version, scenario: 'real MV3 + genuine Pikafish NNUE WASM + local fixtures matching observed puzzle and analysis props; no answer lookup', cases, requests: await worker.evaluate(() => globalThis.puzzleSmokeRequests), pageErrors: errors };
    await fs.writeFile(path.join(results, 'mv3-puzzle-analysis.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await fs.mkdir(results, { recursive: true });
    await page?.screenshot({ path: path.join(results, 'mv3-puzzle-analysis-failed.png'), fullPage: true }).catch(() => {});
    console.error('FIXTURE', await page?.evaluate(() => ({ fixture: window.puzzleFixture, status: document.getElementById('xq-quick-hands')?.shadowRoot?.getElementById('status').textContent })).catch(() => null));
    await fs.writeFile(path.join(results, 'mv3-puzzle-analysis-failed.json'), JSON.stringify({ ok: false, cases, pageErrors: errors, error: error.stack || String(error) }, null, 2) + '\n');
    throw error;
  } finally {
    await context?.close();
    if (path.dirname(profile) !== tempRoot || !path.basename(profile).startsWith('xiangqi-puzzle-smoke-')) throw new Error('Refusing unexpected profile cleanup path');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
