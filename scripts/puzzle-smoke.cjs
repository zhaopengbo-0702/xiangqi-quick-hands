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

// Independent SciPy PchipInterpolator reference coefficients, expressed in
// each interval's normalized coordinate. Do not import the production mapper.
function referenceEvaluation(cp) {
  const segments = [
    [0, .635148952387, .003501168314592769, -.08761269627027911, .5841115279556863, 0],
    [.635148952387, .978026114739, .3337808544377575, -.36018306964360114, .22640221520584358, .5],
    [.978026114739, .999753210848, .19743013869620432, -.029581199392770027, .03215106069656577, .7],
    [.999753210848, .999999969540, .09578825340447801, -.012208233562085181, .006419980157607156, .9],
    [.999999969540, 1, -.009965516182746442, .01993226524626417, .00003325093648228132, .99],
  ];
  const raw = Math.tanh(cp * .015), magnitude = Math.abs(raw);
  const [left, right, a, b, c, d] = segments.find(segment => magnitude <= segment[1]) || segments.at(-1);
  const t = (magnitude - left) / (right - left);
  const value = Math.max(-.999999, Math.min(.999999, Math.sign(raw) * (((a * t + b) * t + c) * t + d)));
  const rounded = Number(value.toFixed(6));
  const level = Math.abs(rounded);
  const meaning = level < .5 ? '均势' : cp > 0 ?
    level < .7 ? '稍优' : level < .9 ? '明显优势' : level < .99 ? '大幅优势' : '接近胜势' :
    level < .7 ? '稍劣' : level < .9 ? '明显劣势' : level < .99 ? '大幅劣势' : '接近败势';
  return { text: '评估 ' + (rounded > 0 ? '+' : '') + (rounded === 0 ? 0 : rounded).toFixed(6), meaning };
}

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
let selected=null;let ownMoves=[];let inputAttempts=0;let completeOnMove=false;let wrongOnMove=false;let halfmove=0;let fullmove=1;let nextCommitDelay=0;let pendingConfirmation=false;let pendingCommit=null;let commitTimer=null;let confirmedAt=null;
let cells=INITIAL.split(' ')[0].split('/').map(row=>[...row].flatMap(piece=>/\\d/.test(piece)?Array(Number(piece)).fill(null):[piece]));
function publish(){window.puzzleFixture={fen:boardContext.fen,moveCount:game.moveCount,ownMoves:[...ownMoves],inputAttempts,answerReads,pointerInputs:[...pointerInputs],completed:game.isPuzzleCompleted,wrong:Boolean(game.wrongMove),id:game.puzzle.puzzle_id,pendingConfirmation,confirmedAt,route:location.pathname};document.getElementById('fixture-state').textContent=JSON.stringify(window.puzzleFixture)}
function sync(){provider.memoizedProps={value:boardContext};gameFiber.memoizedProps=game;publish()}
function placement(){return cells.map(row=>{let text='',empty=0;for(const p of row){if(!p)empty++;else{if(empty)text+=empty;empty=0;text+=p}}if(empty)text+=empty;return text}).join('/')}
function render(){pieces.replaceChildren();cells.forEach((row,r)=>row.forEach((piece,c)=>{if(!piece)return;const holder=document.createElement('div');holder.style.left=c*50+'px';holder.style.top=r*50+'px';const token=document.createElement('div');token.className='piece';token.textContent=piece;token.addEventListener('click',event=>{event.stopPropagation();pieces.querySelectorAll('.piece').forEach(p=>p.classList.remove('selected-piece'));token.classList.add('selected-piece');selected={r,c}});holder.append(token);pieces.append(holder)}))}
function applyMove(uci){const m=uci.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);if(!m)throw new Error('Bad fixture move');const fr=10-Number(m[2]),fc=m[1].charCodeAt(0)-97,tr=10-Number(m[4]),tc=m[3].charCodeAt(0)-97;const piece=cells[fr][fc];if(!piece)throw new Error('No fixture source');halfmove=cells[tr][tc]||piece.toLowerCase()==='p'?0:halfmove+1;const black=piece===piece.toLowerCase();if(black)fullmove++;cells[tr][tc]=piece;cells[fr][fc]=null;const fen=placement()+' '+(black?'r':'b')+' - - '+halfmove+' '+fullmove;game.moveCount++;const move={uci,index:game.moveCount,currentFen:fen};game.movesHistory.push(move);game.activeMove=move;boardContext={...boardContext,fen,isMyTurnNow:black};game.isPlayerTurn=black;render();sync()}
function destination(r,c){if(!selected)return;inputAttempts++;if(!boardContext.isMyTurnNow||game.isPuzzleCompleted||game.wrongMove||pendingConfirmation){selected=null;sync();return}const from=selected;selected=null;const uci=String.fromCharCode(97+from.c)+(10-from.r)+String.fromCharCode(97+c)+(10-r);ownMoves.push({uci,fen:boardContext.fen,dispatchedAt:Date.now()});if(wrongOnMove){game.wrongMove={uci};boardContext.wrongMove={uci};sync();return}const commit=()=>{pendingConfirmation=false;pendingCommit=null;confirmedAt=Date.now();applyMove(uci);if(completeOnMove){game.isPuzzleCompleted=true;game.lastMoveCompleted=true;sync()}};if(nextCommitDelay>0){const delay=nextCommitDelay;nextCommitDelay=0;pendingConfirmation=true;pendingCommit=commit;publish();commitTimer=setTimeout(commit,delay)}else commit()}
for(let r=0;r<10;r++)for(let c=0;c<9;c++){const square=document.createElement('div');square.className='square '+(10-r)+'-'+String.fromCharCode(97+c);square.style.left=c*50+'px';square.style.top=r*50+'px';const target=document.createElement('div');target.className='square-target';target.addEventListener('click',()=>destination(r,c));square.append(target);board.append(square)}board.append(pieces);render();sync();
window.fixtureActions={completeNext(){completeOnMove=true},wrongNext(){wrongOnMove=true},delayNext(ms){nextCommitDelay=ms},publishDelayed(){if(pendingCommit){clearTimeout(commitTimer);pendingCommit()}},opponentMove(){const options=['a7a6','c7c6','e7e6','g7g6','i7i6'];const move=options.find(uci=>cells[3][uci.charCodeAt(0)-97]==='p'&&!cells[4][uci.charCodeAt(0)-97]);if(!move)throw new Error('No opponent fixture move');applyMove(move)},switchPuzzle(){game.puzzle.puzzle_id=456;game.playAgain++;sync()},raceEnd(){game.remainingTime=0;sync()}};
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
      globalThis.puzzleSmokeCancellations = [];
      globalThis.puzzleSmokeTimeline = [];
      const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async function(message, ...args) {
        const tracked = /^XQ_ENGINE_/.test(message.type || '');
        if (tracked) globalThis.puzzleSmokeTimeline.push({ stage: 'send', type: message.type, at: Date.now(), options: message.options });
        try {
          const response = await sendMessage(message, ...args);
          if (tracked) globalThis.puzzleSmokeTimeline.push({ stage: 'reply', type: message.type, at: Date.now(), ok: response?.ok, result: message.type === 'XQ_ENGINE_ANALYZE' ? response : undefined });
          return response;
        } catch (error) {
          if (tracked) globalThis.puzzleSmokeTimeline.push({ stage: 'error', type: message.type, at: Date.now(), error: error.message });
          throw error;
        }
      };
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message.type === 'XQ_ANALYZE' && sender.tab) globalThis.puzzleSmokeRequests.push({ fen: message.fen, moves: message.moves, mode: message.mode, movetime: message.movetime, balance: message.balance, requestId: message.requestId, at: Date.now(), url: sender.tab.url });
        if (message.type === 'XQ_CANCEL' && sender.tab) globalThis.puzzleSmokeCancellations.push({ requestId: message.requestId, url: sender.tab.url });
      });
    });
    async function open(route) {
      await page.goto('https://play.xiangqi.com' + route);
      await page.locator('#panel').waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const r = document.getElementById('xq-quick-hands')?.shadowRoot;
        return r && !r.getElementById('single').disabled;
      }, null, { timeout: 30000 });
      await keepPanelBesideBoard();
      await worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
        await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', func: () => {
          const original = globalThis.XiangqiSiteAdapter.prototype.play;
          const clickTarget = globalThis.XiangqiSiteAdapter.prototype.clickTarget;
          globalThis.puzzleSmokePlayOptions = [];
          globalThis.puzzleSmokePlayErrors = [];
          globalThis.puzzleSmokeClickHits = [];
          globalThis.XiangqiSiteAdapter.prototype.clickTarget = function(element, vary, beforeDispatch) {
            const elementFromPoint = document.elementFromPoint;
            document.elementFromPoint = function(x, y) {
              const hit = elementFromPoint.call(this, x, y);
              globalThis.puzzleSmokeClickHits.push({ at: Date.now(), x, y, targetClass: element?.className, target: element?.getBoundingClientRect().toJSON(), hit: hit && { tag: hit.tagName, id: hit.id, class: hit.className, rect: hit.getBoundingClientRect().toJSON() }, board: document.getElementById('game-grid').getBoundingClientRect().toJSON(), panel: document.getElementById('xq-quick-hands')?.shadowRoot?.getElementById('panel').getBoundingClientRect().toJSON() });
              return hit;
            };
            try { return clickTarget.call(this, element, vary, beforeDispatch); }
            finally { document.elementFromPoint = elementFromPoint; }
          };
          globalThis.XiangqiSiteAdapter.prototype.play = function(move, snapshot, options) {
            globalThis.puzzleSmokePlayOptions.push({ move, varyOperations: options.varyOperations });
            return original.call(this, move, snapshot, options).catch(error => {
              globalThis.puzzleSmokePlayErrors.push({ move, at: Date.now(), message: error.message, code: error.code, actionStage: error.actionStage, scrollX, scrollY });
              throw error;
            });
          };
        } });
      });
      await captureEngineReplies();
    }
    async function captureEngineReplies() {
      await worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
        await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', func: () => {
          const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
          globalThis.puzzleSmokeReplies = [];
          chrome.runtime.sendMessage = async function(message, ...args) {
            const response = await sendMessage(message, ...args);
            if (message.type === 'XQ_ANALYZE') globalThis.puzzleSmokeReplies.push({ requestId: message.requestId, response });
            return response;
          };
        } });
      });
    }
    async function assertRealEvaluation(value) {
      const replies = await worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
        const result = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', func: () => globalThis.puzzleSmokeReplies });
        return result[0].result;
      });
      const reply = replies.at(-1);
      assert.ok(reply?.response?.ok, 'The genuine engine returned a successful response');
      const score = reply.response.score;
      assert.equal(score?.type, 'cp', 'The real starting-position evaluation is a finite centipawn result');
      assert.ok(Number.isFinite(score.value));
      const expected = referenceEvaluation(score.value);
      assert.equal(value.score, expected.text, 'The displayed six-decimal PCHIP index matches the independent SciPy reference for the real engine score');
      assert.equal(value.scoreMeaning, expected.meaning, 'The rounded displayed index receives the matching plain-language meaning');
      assert.equal(value.hasRawScore, false, 'The panel contains no separate raw-score field');
      assert.notEqual(value.score, '评估 ' + (score.value / 100).toFixed(2), 'The old raw score is not rendered');
      return { requestId: reply.requestId, engineScore: score, displayed: value.score, meaning: value.scoreMeaning };
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
    async function keepPanelBesideBoard() {
      const panel = page.locator('#panel'), header = page.locator('#panel-title');
      const box = await panel.boundingBox(), title = await header.boundingBox(), board = await page.locator('#game-grid').boundingBox();
      assert.ok(box && title && board);
      const targetLeft = 800, targetTop = 100;
      if (Math.abs(box.x - targetLeft) > 1 || Math.abs(box.y - targetTop) > 1) {
        const x = title.x + Math.min(50, title.width / 2), y = title.y + title.height / 2;
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + targetLeft - box.x, y + targetTop - box.y, { steps: 5 }); await page.mouse.up();
      }
      const positioned = await panel.boundingBox();
      assert.ok(positioned.x > board.x + board.width + 20, 'The local test panel stays beside the chessboard');
    }
    async function savedSearch(mode, movetime) {
      await worker.evaluate(async expected => {
        for (let i = 0; i < 40; i++) {
          const saved = await chrome.storage.local.get(['mode', 'movetime']);
          if (saved.mode === expected.mode && saved.movetime === expected.movetime) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Search settings were not saved');
      }, { mode, movetime });
    }
    async function savedBalance(expected) {
      await worker.evaluate(async expected => {
        for (let i = 0; i < 40; i++) {
          if ((await chrome.storage.local.get('balance')).balance === expected) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Decision preference was not saved');
      }, expected);
    }
    async function dragBalance(target) {
      const slider = page.locator('#balance');
      assert.equal(await slider.isEnabled(), true, 'The decision preference slider accepts real mouse input');
      const box = await slider.boundingBox();
      assert.ok(box && box.width > 30 && box.height > 0, 'The slider is visible before dragging');
      const initial = Number(await slider.inputValue());
      const thumbInset = 8;
      const x = value => box.x + thumbInset + value * (box.width - thumbInset * 2);
      const y = box.y + box.height / 2;
      await page.mouse.move(x(initial), y);
      await page.mouse.down();
      await page.mouse.move(x(target), y, { steps: 8 });
      const dragging = await state();
      assert.equal(dragging.balance, target, 'Real mouse dragging changes the slider value');
      assert.equal(dragging.balanceLabel, `${target >= .5 ? '稳健' : '速度'} ${Math.round(target * 100)}%`, 'The percentage updates before the mouse is released');
      await page.mouse.up();
      await savedBalance(target);
      return dragging;
    }
    async function state() {
      return page.evaluate(() => {
        const r = document.getElementById('xq-quick-hands').shadowRoot;
        return { ...window.puzzleFixture, status: r.getElementById('status').textContent, auto: r.getElementById('auto').textContent, autoDisabled: r.getElementById('auto').disabled, singleDisabled: r.getElementById('single').disabled, single: r.getElementById('single').textContent, searchMode: r.getElementById('mode').value, searchModeDisabled: r.getElementById('mode').disabled, movetime: Number(r.getElementById('budget').value), movetimeDisabled: r.getElementById('budget').disabled, balance: Number(r.getElementById('balance').value), balanceLabel: r.getElementById('balance-label').textContent, balanceDisabled: r.getElementById('balance').disabled, balanceVisible: !r.getElementById('balance-row').classList.contains('hidden'), variationChecked: r.getElementById('vary-operations').checked, variationDisabled: r.getElementById('vary-operations').disabled, side: r.getElementById('side').textContent, move: r.getElementById('move').textContent, depth: r.getElementById('depth').textContent, score: r.getElementById('score').textContent, scoreMeaning: r.getElementById('score-meaning').textContent, hasRawScore: Boolean(r.getElementById('score-raw')), engine: r.getElementById('engine-name').textContent };
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

    await open('/puzzle/123/P');
    await page.locator('#mode').selectOption('adaptive');
    await page.locator('#budget').selectOption('3500');
    await savedSearch('adaptive', 3500);
    const liveRequestStart = await worker.evaluate(() => globalThis.puzzleSmokeRequests.length);
    await page.locator('#auto').click();
    await page.waitForFunction(() => /正在计算/.test(document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent));
    const cancellationsBefore = await worker.evaluate(() => globalThis.puzzleSmokeCancellations.length);
    const computingBefore = await state();
    assert.equal(computingBefore.searchModeDisabled, false, 'Search mode remains usable while the engine is computing');
    assert.equal(computingBefore.movetimeDisabled, false, 'Maximum thinking time remains usable while the engine is computing');
    assert.equal(computingBefore.balanceDisabled, false, 'Decision preference remains usable while the engine is computing');
    assert.equal(computingBefore.balance, .65);
    const computingDragged = await dragBalance(.25);
    assert.match(computingDragged.status, /正在计算/, 'The preference percentage changes during the active engine search');
    assert.match(computingDragged.auto, /暂停自动/, 'Dragging the preference does not pause autoplay');
    await fs.mkdir(results, { recursive: true });
    await page.locator('#panel').screenshot({ path: path.join(results, 'mv3-live-decision-preference.png') });
    await page.locator('#mode').selectOption('fixed');
    await page.locator('#budget').selectOption('2800');
    await savedSearch('fixed', 2800);
    const computingChanged = await state();
    assert.match(computingChanged.status, /正在计算/, 'Changing the dropdowns does not interrupt the active search');
    assert.match(computingChanged.auto, /暂停自动/, 'Changing settings keeps autoplay running');
    assert.equal(computingChanged.searchMode, 'fixed');
    assert.equal(computingChanged.movetime, 2800);
    assert.equal(computingChanged.balance, .25);
    await fs.mkdir(results, { recursive: true });
    await page.locator('#panel').screenshot({ path: path.join(results, 'mv3-live-search-settings.png') });
    await keepPanelBesideBoard();
    await page.waitForFunction(() => window.puzzleFixture.ownMoves.length === 1 && /等待对方/.test(document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent), null, { timeout: 15000 });
    const waitingBefore = await state();
    assert.equal(waitingBefore.searchModeDisabled, false, 'Search mode remains usable while autoplay waits for the opponent');
    assert.equal(waitingBefore.movetimeDisabled, false, 'Maximum thinking time remains usable while autoplay waits for the opponent');
    assert.equal(waitingBefore.balanceDisabled, false, 'Decision preference remains enabled while autoplay waits for the opponent');
    assert.match(waitingBefore.auto, /暂停自动/);
    const firstLiveRequest = await worker.evaluate(index => globalThis.puzzleSmokeRequests[index], liveRequestStart);
    assert.equal(firstLiveRequest.mode, 'adaptive', 'The in-progress move keeps its original search mode');
    assert.equal(firstLiveRequest.movetime, 3500, 'The in-progress move keeps its original thinking limit');
    assert.equal(firstLiveRequest.balance, .65, 'The in-progress move keeps the preference captured before dragging');
    await page.locator('#mode').selectOption('adaptive');
    await page.locator('#budget').selectOption('1800');
    const waitingDragged = await dragBalance(.8);
    assert.match(waitingDragged.status, /等待对方/, 'The preference can also be dragged while waiting for the opponent');
    await savedSearch('adaptive', 1800);
    const waitingChanged = await state();
    assert.match(waitingChanged.status, /等待对方/);
    assert.match(waitingChanged.auto, /暂停自动/, 'Changing settings while waiting does not pause autoplay');
    assert.equal(waitingChanged.searchMode, 'adaptive');
    assert.equal(waitingChanged.movetime, 1800);
    assert.equal(waitingChanged.balance, .8);
    assert.equal(waitingChanged.balanceLabel, '稳健 80%');
    await page.evaluate(() => window.fixtureActions.opponentMove());
    await page.waitForFunction(() => window.puzzleFixture.ownMoves.length === 2 && /等待对方/.test(document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent), null, { timeout: 15000 });
    const liveAfter = await state();
    const liveRequests = await worker.evaluate(index => globalThis.puzzleSmokeRequests.slice(index), liveRequestStart);
    assert.equal(liveRequests.length, 2, 'Each own turn starts exactly one engine request');
    assert.deepEqual(liveRequests.map(request => ({ mode: request.mode, movetime: request.movetime, balance: request.balance })), [{ mode: 'adaptive', movetime: 3500, balance: .65 }, { mode: 'adaptive', movetime: 1800, balance: .8 }], 'The current move retains its captured settings and the next move uses the most recently selected preference and limit');
    assert.equal(await worker.evaluate(() => globalThis.puzzleSmokeCancellations.length), cancellationsBefore, 'Editing search settings never sends XQ_CANCEL');
    assert.match(liveAfter.auto, /暂停自动/);
    assert.equal(liveAfter.inputAttempts, 2);
    assert.equal(liveAfter.answerReads, 0);
    await page.reload();
    await page.locator('#panel').waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const r = document.getElementById('xq-quick-hands')?.shadowRoot;
      return r && !r.getElementById('single').disabled;
    }, null, { timeout: 30000 });
    const reloaded = await state();
    assert.equal(reloaded.searchMode, 'adaptive', 'Search mode persists after reload');
    assert.equal(reloaded.movetime, 1800, 'Maximum thinking time persists after reload');
    assert.equal(reloaded.searchModeDisabled, false);
    assert.equal(reloaded.movetimeDisabled, false);
    assert.equal(reloaded.balance, .8, 'Decision preference persists after reload');
    assert.equal(reloaded.balanceLabel, '稳健 80%', 'The restored preference percentage matches the saved value');
    assert.equal(reloaded.balanceDisabled, false);
    assert.equal(reloaded.balanceVisible, true);
    cases.push({ route: '/puzzle/123/P', ending: 'live-search-settings', computingBefore, computingDragged, computingChanged, waitingBefore, waitingDragged, waitingChanged, after: liveAfter, reloaded, requests: liveRequests, settingsCancellations: 0 });

    await open('/puzzle/123/P');
    await page.locator('#mode').selectOption('fixed');
    await page.locator('#budget').selectOption('1800');
    await savedSearch('fixed', 1800);
    await page.evaluate(() => window.fixtureActions.delayNext(8000));
    const delayedStart = await worker.evaluate(() => ({ requests: globalThis.puzzleSmokeRequests.length, cancellations: globalThis.puzzleSmokeCancellations.length }));
    await page.locator('#auto').click();
    await page.waitForFunction(() => window.puzzleFixture.pendingConfirmation, null, { timeout: 15000 });
    const dispatched = await state();
    assert.equal(dispatched.moveCount, 0, 'The website fixture has not published the move yet');
    assert.equal(dispatched.ownMoves.length, 1);
    assert.equal(dispatched.inputAttempts, 1);
    await page.waitForTimeout(5500);
    const delayedWaiting = await state();
    assert.equal(delayedWaiting.pendingConfirmation, true, 'Confirmation is still delayed beyond five seconds after the destination click');
    assert.equal(delayedWaiting.status, '等待网站确认落子');
    assert.match(delayedWaiting.auto, /暂停自动/, 'Delayed website confirmation keeps autoplay active');
    assert.equal(delayedWaiting.singleDisabled, true, 'No second move can start while confirmation is pending');
    assert.equal(delayedWaiting.ownMoves.length, 1);
    assert.equal(delayedWaiting.inputAttempts, 1, 'The original destination click is never replayed');
    assert.equal(delayedWaiting.pointerInputs.length, 6, 'Waiting emits no additional source or destination input');
    assert.equal(await worker.evaluate(() => globalThis.puzzleSmokeRequests.length), delayedStart.requests + 1, 'Waiting never launches another search');
    assert.equal(await worker.evaluate(() => globalThis.puzzleSmokeCancellations.length), delayedStart.cancellations, 'Waiting does not cancel the original operation');
    await page.locator('#panel').screenshot({ path: path.join(results, 'mv3-delayed-confirmation-waiting.png') });
    await page.waitForFunction(() => window.puzzleFixture.moveCount === 1 && /等待对方/.test(document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent), null, { timeout: 10000 });
    const delayedConfirmed = await state();
    assert.ok(delayedConfirmed.confirmedAt - delayedConfirmed.ownMoves[0].dispatchedAt >= 7900, 'The actual publication occurred after the configured eight-second delay');
    assert.match(delayedConfirmed.auto, /暂停自动/);
    assert.equal(delayedConfirmed.inputAttempts, 1);
    await page.evaluate(() => window.fixtureActions.opponentMove());
    await page.waitForFunction(() => window.puzzleFixture.ownMoves.length === 2 && /等待对方/.test(document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent), null, { timeout: 15000 });
    const delayedContinued = await state();
    assert.equal(delayedContinued.inputAttempts, 2);
    assert.equal(await worker.evaluate(() => globalThis.puzzleSmokeRequests.length), delayedStart.requests + 2);
    assert.match(delayedContinued.auto, /暂停自动/, 'Autoplay continues with the next turn after the delayed confirmation');
    cases.push({ route: '/puzzle/123/P', ending: 'delayed-confirmation-over-five-seconds', dispatched, waiting: delayedWaiting, confirmed: delayedConfirmed, after: delayedContinued });

    await open('/puzzle/123/P');
    await page.evaluate(() => window.fixtureActions.delayNext(60000));
    const pauseDelayedStart = await worker.evaluate(() => globalThis.puzzleSmokeRequests.length);
    await page.locator('#auto').click();
    await page.waitForFunction(() => window.puzzleFixture.pendingConfirmation && document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent === '等待网站确认落子', null, { timeout: 15000 });
    await page.locator('#auto').click();
    await page.locator('#pause-confirm').waitFor({ state: 'visible' });
    const requestedPause = await state();
    assert.match(requestedPause.auto, /暂停自动/, 'The first pause click keeps the confirmation wait running');
    assert.equal(requestedPause.pendingConfirmation, true);
    await page.locator('#pause-confirm').click();
    await waitPaused('手动确认');
    const manuallyPaused = await state();
    assert.equal(manuallyPaused.pendingConfirmation, true, 'Manual pause does not fabricate a website acknowledgement');
    assert.equal(manuallyPaused.inputAttempts, 1);
    assert.equal(manuallyPaused.ownMoves.length, 1);
    await page.evaluate(() => window.fixtureActions.publishDelayed());
    await page.waitForFunction(() => window.puzzleFixture.moveCount === 1);
    await page.evaluate(() => window.fixtureActions.opponentMove());
    await page.waitForTimeout(1000);
    const pausedAfterLatePublish = await state();
    assert.match(pausedAfterLatePublish.auto, /开始自动/, 'A late acknowledgement never resumes a manually paused operation');
    assert.equal(pausedAfterLatePublish.inputAttempts, 1);
    assert.equal(pausedAfterLatePublish.ownMoves.length, 1);
    assert.equal(await worker.evaluate(() => globalThis.puzzleSmokeRequests.length), pauseDelayedStart + 1);
    cases.push({ route: '/puzzle/123/P', ending: 'manual-two-step-pause-during-delayed-confirmation', requestedPause, paused: manuallyPaused, after: pausedAfterLatePublish });

    await open('/analysis/board');
    const analysisBefore = await state();
    assert.match(analysisBefore.single, /分析局面/);
    assert.equal(analysisBefore.autoDisabled, true);
    assert.equal(analysisBefore.side, '棋盘分析');
    await page.locator('#single').click();
    await page.waitForFunction(() => document.getElementById('xq-quick-hands').shadowRoot.getElementById('status').textContent === '分析完成', null, { timeout: 15000 });
    const analysisAfter = await state();
    assert.equal(analysisAfter.inputAttempts, 0);
    assert.equal(analysisAfter.ownMoves.length, 0);
    assert.equal(analysisAfter.moveCount, 0);
    assert.equal(analysisAfter.fen, initialFen);
    assert.ok(Number(analysisAfter.depth.match(/\d+/)?.[0]) >= 6);
    assert.match(analysisAfter.move, /^[a-i](10|[1-9])[a-i](10|[1-9])$/);
    assert.equal(analysisAfter.answerReads, 0);
    const actualEvaluation = await assertRealEvaluation(analysisAfter);
    cases.push({ route: '/analysis/board', ending: 'suggest-only', before: analysisBefore, after: analysisAfter, actualEvaluation });
    assert.deepEqual(errors, []);
    await fs.mkdir(results, { recursive: true });
    await page.screenshot({ path: path.join(results, 'mv3-puzzle-analysis.png'), fullPage: true });
    await page.locator('#panel').screenshot({ path: path.join(results, 'mv3-normalized-evaluation.png') });
    const report = { ok: true, manifestVersion: JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8')).version, scenario: 'real MV3 + genuine Pikafish NNUE WASM + local fixtures matching observed puzzle and analysis props; live search settings without pause; no answer lookup', cases, requests: await worker.evaluate(() => globalThis.puzzleSmokeRequests), cancellations: await worker.evaluate(() => globalThis.puzzleSmokeCancellations), engineTimeline: await worker.evaluate(() => globalThis.puzzleSmokeTimeline), pageErrors: errors };
    await fs.writeFile(path.join(results, 'mv3-puzzle-analysis.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await fs.mkdir(results, { recursive: true });
    await page?.screenshot({ path: path.join(results, 'mv3-puzzle-analysis-failed.png'), fullPage: true }).catch(() => {});
    const failureState = await page?.evaluate(() => {
      const r = document.getElementById('xq-quick-hands')?.shadowRoot;
      return { fixture: window.puzzleFixture, status: r?.getElementById('status').textContent,
        auto: r?.getElementById('auto').textContent, mode: r?.getElementById('mode').value,
        movetime: r?.getElementById('budget').value, balance: r?.getElementById('balance').value,
        visibility: document.visibilityState, focused: document.hasFocus(), scrollX, scrollY, viewport: { width: innerWidth, height: innerHeight } };
    }).catch(() => null);
    const failureBackground = await worker?.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' });
      const captured = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, world: 'ISOLATED', func: () => ({ replies: globalThis.puzzleSmokeReplies, playErrors: globalThis.puzzleSmokePlayErrors, clickHits: globalThis.puzzleSmokeClickHits }) });
      return { requests: globalThis.puzzleSmokeRequests, cancellations: globalThis.puzzleSmokeCancellations,
        engineTimeline: globalThis.puzzleSmokeTimeline, pageReplies: captured[0].result.replies, playErrors: captured[0].result.playErrors, clickHits: captured[0].result.clickHits };
    }).catch(error => ({ unavailable: error.message }));
    console.error('FIXTURE', failureState, 'BACKGROUND', failureBackground);
    await fs.writeFile(path.join(results, 'mv3-puzzle-analysis-failed.json'), JSON.stringify({ ok: false, cases, failureState, failureBackground, pageErrors: errors, error: error.stack || String(error) }, null, 2) + '\n');
    throw error;
  } finally {
    await context?.close();
    if (path.dirname(profile) !== tempRoot || !path.basename(profile).startsWith('xiangqi-puzzle-smoke-')) throw new Error('Refusing unexpected profile cleanup path');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
