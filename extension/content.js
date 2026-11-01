(() => {
  'use strict';
  const previous = globalThis.__xiangqiQuickHands;
  try { if (previous?.isAlive?.()) return; } catch {}
  try { previous?.destroy?.(); } catch {}
  document.getElementById?.('xq-quick-hands')?.remove();
  const extensionId = chrome.runtime.id;
  const resourceBase = chrome.runtime.getURL('');
  const adapter = new globalThis.XiangqiSiteAdapter();
  const host = document.createElement('div');
  host.id = 'xq-quick-hands';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
  const root = host.attachShadow({ mode: 'open' });
  const icon = (name, label) => `<img src="${resourceBase}icons/${name}.svg" width="17" height="17" alt="" aria-hidden="true">${label || ''}`;
  root.innerHTML = `<style>
    :host{all:initial;font-family:"Microsoft YaHei",system-ui,sans-serif;color:#202629;font-size:13px;letter-spacing:0;color-scheme:light}:host(.hidden){display:none!important}
    *{box-sizing:border-box}button,select{font:inherit;letter-spacing:0}button{cursor:pointer}button:disabled{cursor:default;opacity:.45}
    .panel{width:300px;max-width:calc(100vw - 24px);background:#fff;border:1px solid #d2d9d6;border-radius:8px;box-shadow:0 6px 28px #162a2326;overflow:hidden}
    header{height:48px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #e7eae8;background:#f7f9f8}
    .brand{width:25px;height:25px;border-radius:50%;background:#b3292d;color:#fff;display:grid;place-items:center;font-size:17px;font-weight:700}
    strong{font-size:14px;font-weight:700;flex:1}.icon{width:28px;height:28px;display:grid;place-items:center;border:0;background:transparent;border-radius:4px}
    .icon:hover{background:#e6eeea}img{display:inline-block;flex:none}main{padding:12px} .state{display:flex;align-items:center;gap:7px;min-height:24px}
    .dot{width:7px;height:7px;flex:none;border-radius:50%;background:#8a9690}.dot[data-kind=ready]{background:#19845d}.dot[data-kind=busy]{background:#c57b12}.dot[data-kind=error]{background:#ba3137}
    #status{flex:1;line-height:1.6;overflow-wrap:anywhere}.engine{color:#6d7872;font-size:11px;margin:3px 0 14px 14px}
    .settings{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;color:#5c6862}select{max-width:155px;padding:5px 6px;border:1px solid #d5ddd8;border-radius:4px;background:white;color:#263a30}
    input[type=range]{width:112px;accent-color:#176d4d;margin:0}#balance-label{font-size:11px;min-width:48px;text-align:right}.importance{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#6d7872;margin-top:9px;gap:8px}
    .actions{display:grid;grid-template-columns:1.35fr 1fr;gap:8px} .command{display:flex;align-items:center;justify-content:center;gap:6px;min-height:36px;border:1px solid #ccd7d0;border-radius:5px;background:#f6f8f7;color:#253c2e;font-weight:600}
    .primary{background:#176d4d;color:white;border-color:#176d4d}.primary img{filter:brightness(0) invert(1)}.primary.running{background:#a52b32;border-color:#a52b32}
    .result{margin-top:14px;border-top:1px solid #e7eae8;padding-top:11px;display:flex;justify-content:space-between;align-items:center;gap:8px}.move{font-family:Consolas,monospace;font-size:19px;font-weight:600;color:#224b38;white-space:nowrap}
    #side{font-size:12px;color:#6d7872}.metrics{display:flex;justify-content:space-between;color:#7a837f;font-size:11px;gap:5px;margin-top:7px;font-variant-numeric:tabular-nums}.pv{color:#6d7872;font-family:Consolas,monospace;font-size:11px;line-height:1.6;overflow-wrap:anywhere;margin-top:9px;max-height:54px;overflow:auto}
    footer{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#f7f9f8;border-top:1px solid #e7eae8;color:#6d7872;font-size:11px}
    .hidden{display:none!important}:focus-visible{outline:2px solid #158a60;outline-offset:2px}
    @media(max-width:560px){.panel{width:266px}header{height:42px}main{padding:10px}}
  </style><section class="panel" aria-label="象棋快手控制台">
  <header><span class="brand">帥</span><strong>象棋快手</strong><button id="quick-stop" class="icon hidden" title="立即暂停" aria-label="立即暂停">${icon('pause')}</button><button id="reconnect" class="icon" title="重新连接引擎" aria-label="重新连接引擎">${icon('refresh-cw')}</button><button id="collapse" class="icon" title="收起控制台" aria-label="收起控制台">${icon('minus')}</button></header>
  <div id="body"><main><div class="state"><span class="dot" id="dot"></span><span id="status" role="status" aria-live="polite">等待棋盘</span></div><div class="engine" id="engine-name">Pikafish · 本地引擎</div>
  <label class="settings">搜索模式<select id="mode" aria-label="搜索模式"><option value="adaptive" selected>自适应</option><option value="fixed">固定时限</option></select></label>
  <label class="settings" id="balance-row">决策偏好<input id="balance" type="range" aria-label="决策偏好" min="0" max="1" step="0.05" value="0.65"><output id="balance-label">稳健 65%</output></label>
  <label class="settings">最长计算<select id="budget" aria-label="最长计算"><option value="800">0.8 秒</option><option value="1800">1.8 秒</option><option value="2800">2.8 秒</option><option value="3500" selected>3.5 秒</option></select></label>
  <div class="actions"><button id="auto" class="command primary" disabled>${icon('play','开始自动')}</button><button id="single" class="command" disabled>${icon('step-forward','走一步')}</button></div>
  <div class="result"><output id="move" class="move">-</output><span id="side">-</span></div><div class="metrics"><span id="depth">深度 -</span><span id="score">评估 -</span><span id="elapsed">耗时 -</span></div>
  <div class="importance"><span id="importance">重要性 -</span><span id="allocated">预算 -</span></div><div id="pv" class="pv"></div>
  </main><footer><span id="footer">最多 5 秒 · 至少 6 层</span><span id="plies">第 0 手</span></footer></div></section>`;
  document.documentElement.append(host);
  const $ = id => root.getElementById(id);
  let ready = false;
  let auto = false;
  let busy = false;
  let generation = 0;
  let requestId = null;
  let lastPlayed = null;
  let current = null;
  let booting = false;
  let destroyed = false;
  let watchdog = null;
  let tickTimer = null;
  let observedRoute = location.pathname;
  let observedGameKey = null;
  let syncSince = null;
  let boardReadFailed = false;

  function isContextAlive() {
    try { return !destroyed && chrome.runtime.id === extensionId; } catch { return false; }
  }
  function dispose(removePanel = false) {
    if (!destroyed) {
      destroyed = true;
      ready = false;
      auto = false;
      busy = false;
      booting = false;
      generation++;
      requestId = null;
      clearTimeout(watchdog);
      clearTimeout(tickTimer);
      adapter.destroy?.();
      document.removeEventListener?.('visibilitychange', onVisibilityChange);
      document.removeEventListener?.('keydown', onKeyDown);
      window.removeEventListener?.('pagehide', onPageHide);
      try {
        if (chrome.runtime.id === extensionId) chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      } catch {}
    }
    if (removePanel) host.remove();
  }
  function invalidateContext() {
    if (destroyed) return;
    dispose();
    status('插件已更新，请重新连接', 'error');
    controls();
    $('reconnect').title = '刷新棋盘重新连接';
    $('reconnect').ariaLabel = '刷新棋盘重新连接';
  }
  function handleContextError(error) {
    if (!isContextAlive() || /Extension context invalidated/i.test(error?.message || '')) {
      invalidateContext();
      return true;
    }
    return false;
  }
  function persist(settings) {
    if (!isContextAlive()) { invalidateContext(); return; }
    try { Promise.resolve(chrome.storage.local.set(settings)).catch(handleContextError); }
    catch (error) { handleContextError(error); }
  }
  function status(text, kind = 'ready') { $('status').textContent = text; $('dot').dataset.kind = kind; }
  function canPlay(snapshot) {
    return snapshot?.active && !snapshot.historyMode && !snapshot.viewOnly &&
      !(snapshot.mode === 'online' && snapshot.participant !== true) &&
      !(Number.isFinite(snapshot.clockRemainingMs) && snapshot.clockRemainingMs < 1000);
  }
  function controls() {
    $('auto').innerHTML = icon(auto ? 'pause' : 'play', auto ? '暂停自动' : '开始自动');
    $('auto').classList.toggle('running', auto);
    $('auto').disabled = !ready || (!canPlay(current) && !auto);
    $('single').disabled = !ready || busy || auto || !canPlay(current) || current.turn !== current.playerSide;
    $('budget').disabled = destroyed || busy || auto;
    $('mode').disabled = destroyed || busy || auto;
    $('balance').disabled = destroyed || busy || auto;
    $('reconnect').disabled = booting;
    $('quick-stop').classList.toggle('hidden', !auto && !busy);
  }
  async function rpc(type, payload = {}) {
    try {
      if (!isContextAlive()) throw new Error('Extension context invalidated.');
      const response = await chrome.runtime.sendMessage({ type, ...payload });
      if (!response?.ok) throw new Error(response?.error || '插件连接已失效，请刷新棋盘。');
      return response;
    } catch (error) { handleContextError(error); throw error; }
  }
  function stop(text, kind = 'ready', preserveAuto = false) {
    if (destroyed) return;
    if (!isContextAlive()) { invalidateContext(); return; }
    auto = preserveAuto && auto;
    generation++;
    clearTimeout(watchdog);
    watchdog = null;
    if (requestId) {
      ready = false;
      const cancelledId = requestId;
      void rpc('XQ_CANCEL', { requestId: cancelledId }).catch(() => {}).then(() => {
        if (!destroyed && onBoard()) void boot(text ? { text, kind } : undefined);
      });
    }
    requestId = null;
    busy = false;
    if (text) status(text, kind);
    controls();
  }
  function waitForSync(error) {
    if (error?.code !== 'XQ_STATE_SYNC') return false;
    current = null;
    boardReadFailed = true;
    if (syncSince === null) syncSince = performance.now();
    if (busy) stop(undefined, 'ready', true);
    if (performance.now() - syncSince >= 2000) {
      if (auto || busy) stop('棋盘持续不同步，已暂停，请刷新棋盘', 'error');
      else status('棋盘持续不同步，已暂停，请刷新棋盘', 'error');
    } else status('等待棋盘同步', 'busy');
    controls();
    return true;
  }
  async function boot(preservedStatus) {
    if (destroyed || booting || !onSupportedRoute()) return;
    booting = true;
    ready = false;
    status('正在预热引擎', 'busy');
    controls();
    try {
      const result = await rpc('XQ_WARMUP');
      if (destroyed) return;
      const backend = result.backend === 'wasm' ? '浏览器引擎' : '本地引擎';
      $('engine-name').textContent = `${result.engine || 'Pikafish'} · ${result.nnue ? 'NNUE ' : ''}${backend}`;
      $('engine-name').title = result.nativeError ? `原生连接不可用，使用皮卡鱼 NNUE 浏览器引擎：${result.nativeError}` : '';
      ready = true;
      if (preservedStatus) status(preservedStatus.text, preservedStatus.kind);
      else status('引擎就绪');
    } catch (error) { if (!destroyed) status(error.message, 'error'); }
    finally { booting = false; if (!destroyed) controls(); }
  }
  const onBoard = () => location.origin === 'https://play.xiangqi.com' &&
    (location.pathname === '/computer-play' || /^\/game\/[^/]+\/?$/.test(location.pathname));
  const onSupportedRoute = () => onBoard() || (location.origin === 'https://play.xiangqi.com' && ['/play', '/computer'].includes(location.pathname));

  async function moveOnce() {
    if (destroyed || busy || !ready || document.hidden || !onBoard()) return;
    if (!isContextAlive()) { invalidateContext(); return; }
    if (window.innerWidth < 700) setCollapsed(true);
    const ticket = ++generation;
    const started = performance.now();
    busy = true;
    controls();
    try {
      const snapshot = await adapter.read();
      if (ticket !== generation) return;
      current = snapshot;
      if (!canPlay(snapshot) || snapshot.turn !== snapshot.playerSide) throw new Error('当前棋盘不允许我方行棋');
      if (lastPlayed === snapshot.boardKey) throw new Error('该局面已落子，等待棋盘更新');
      status('正在计算', 'busy');
      const remaining = Number.isFinite(snapshot.clockRemainingMs) ? snapshot.clockRemainingMs : Infinity;
      const turnLimit = Math.min(5000, remaining - 200);
      const movetime = Math.min(Number($('budget').value), Math.max(500, remaining - 900));
      requestId = crypto.randomUUID();
      watchdog = setTimeout(() => {
        if (ticket === generation) stop(remaining < 5200 ? '剩余时间不足，已停止本步' : '本步超过 5 秒，已停止', 'error');
      }, Math.max(0, turnLimit - (performance.now() - started)));
      const result = await rpc('XQ_ANALYZE', {
        fen: snapshot.fen, movetime,
        ...(Array.isArray(snapshot.moves) ? { initialFen: snapshot.initFen, moves: snapshot.moves } : {}),
        mode: $('mode').value, balance: Number($('balance').value), requestId,
      });
      if (ticket !== generation || document.hidden || !onBoard()) return;
      if (performance.now() - started > Math.min(4400, turnLimit - 250)) throw new Error('计算超时，已取消本步');
      if (!result.bestmove || result.bestmove === '(none)' || result.bestmove === '0000') throw new Error('当前局面无可走着法');
      if (!(result.depth >= 6) && !(result.score?.type === 'mate' && result.score.value > 0)) {
        throw new Error('未完成至少 6 层搜索，已暂停');
      }
      status('正在落子', 'busy');
      await adapter.play(result.bestmove, snapshot, { deadline: started + Math.min(4900, turnLimit), isCancelled: () => ticket !== generation });
      if (ticket !== generation) return;
      lastPlayed = snapshot.boardKey;
      $('move').textContent = result.bestmove;
      $('depth').textContent = `深度 ${result.depth ?? '-'}`;
      $('score').textContent = result.score ? (result.score.type === 'mate' ? `杀棋 ${result.score.value}` : `评估 ${(result.score.value / 100).toFixed(2)}`) : '评估 -';
      $('elapsed').textContent = `耗时 ${((performance.now() - started) / 1000).toFixed(2)} 秒`;
      $('pv').textContent = (result.pv || []).slice(0, 8).join(' > ');
      $('importance').textContent = Number.isFinite(result.importance) ? `重要性 ${Math.round(result.importance * 100)}` : '固定时限';
      $('allocated').textContent = Number.isFinite(result.allocatedMs) ? `预算 ${(result.allocatedMs / 1000).toFixed(2)} 秒` : '';
      const reasonLabels = {
        'close-candidates': '候选着法接近', 'clear-leader': '最佳候选明显领先',
        'unstable-principal': '最佳着法反复变化', 'volatile-score': '评分波动较大',
        'material-tactics': '涉及重要子力交换', 'limited-probe': '候选比较尚不充分',
        'balanced-search': '局面相对稳定', 'king-in-check': '当前正在应将',
        'winning-mate': '引擎发现强制杀棋', 'defensive-mate': '需要寻找防守',
        'forced-move': '只有一个合法着法', 'only-legal-move': '只有一个合法着法', 'fixed-budget': '固定时间计算',
      };
      $('importance').title = (result.reason || []).map(reason => reasonLabels[reason] || reason).join('、');
      status(auto ? '已落子，等待对方' : '本步已完成');
      if (result.timedOut) {
        ready = false;
        void boot();
      }
    } catch (error) {
      if (ticket === generation && !waitForSync(error)) stop(error.message, 'error');
    } finally {
      if (ticket === generation) {
        clearTimeout(watchdog);
        watchdog = null;
        requestId = null;
        busy = false;
        controls();
      }
    }
  }

  async function tick() {
    if (destroyed) return;
    if (!isContextAlive()) { invalidateContext(); return; }
    try {
      if (observedRoute !== location.pathname) {
        if (auto || busy) stop('已切换对局，已暂停');
        observedRoute = location.pathname;
        observedGameKey = null;
        lastPlayed = null;
        syncSince = null;
        boardReadFailed = false;
      }
      if (!onBoard()) {
        if (auto || busy) stop('等待棋盘');
        host.classList.toggle('hidden', !onSupportedRoute());
        current = null;
        lastPlayed = null;
        observedGameKey = null;
        if (onSupportedRoute()) {
          if (ready && !booting) status(location.pathname === '/play' ? '等待在线对局' : '等待人机对局');
          if (!ready && !booting && !host.dataset.bootAttempted) { host.dataset.bootAttempted = 'true'; void boot(); }
        }
        controls();
      } else {
        host.classList.remove('hidden');
        if (!ready && !booting) { if (!host.dataset.bootAttempted) { host.dataset.bootAttempted = 'true'; void boot(); } }
        if (!busy) {
          current = await adapter.read();
          const recovered = boardReadFailed;
          syncSince = null;
          boardReadFailed = false;
          if (observedGameKey && current.gameKey && observedGameKey !== current.gameKey) {
            if (auto || busy) stop('新对局已开始，请重新开启自动行棋');
            lastPlayed = null;
          }
          if (current.gameKey) observedGameKey = current.gameKey;
          $('side').textContent = current.participant === false ? '观战' : (current.playerSide === 'red' ? '我方执红' : '我方执黑');
          $('plies').textContent = `第 ${current.moveCount} 手`;
          if (auto) {
            if (current.historyMode) stop('棋谱回放中，已暂停');
            else if (current.mode === 'online' && current.participant !== true) stop('观战棋盘，已暂停');
            else if (Number.isFinite(current.clockRemainingMs) && current.clockRemainingMs < 1000) stop('剩余时间不足，已暂停');
            else if (current.hasPreMove) stop('预走子待执行，已暂停');
            else if (current.connected === false) stop('对局已断线，已暂停');
            else if (!current.active) stop('本局已结束');
            else if (current.turn === current.playerSide && lastPlayed !== current.boardKey) void moveOnce();
            else status('等待对方行棋');
          }
          else if (ready && current.mode === 'online' && current.participant !== true) status('观战棋盘');
          else if (ready && recovered) status('引擎就绪');
          controls();
        }
      }
    } catch (error) {
      if (destroyed || handleContextError(error)) return;
      current = null;
      boardReadFailed = true;
      if (!waitForSync(error)) {
        syncSince = null;
        if (auto || busy) stop(error.message, 'error');
        else if (ready) status(error.message, 'error');
      }
      controls();
    } finally { if (!destroyed) tickTimer = setTimeout(tick, 110); }
  }

  $('auto').onclick = () => {
    if (auto || busy) { stop('已暂停'); return; }
    auto = true;
    status('自动行棋已开启');
    controls();
    if (current?.turn === current?.playerSide) void moveOnce();
  };
  $('single').onclick = () => void moveOnce();
  $('reconnect').onclick = () => {
    if (!isContextAlive()) { location.reload(); return; }
    stop(); delete host.dataset.bootAttempted; lastPlayed = null; void boot();
  };
  function setCollapsed(collapsed) {
    $('body').classList.toggle('hidden', collapsed);
    $('collapse').innerHTML = icon(collapsed ? 'plus' : 'minus');
    $('collapse').title = collapsed ? '展开控制台' : '收起控制台';
    $('collapse').ariaLabel = $('collapse').title;
  }
  $('collapse').onclick = () => setCollapsed(!$('body').classList.contains('hidden'));
  $('quick-stop').onclick = () => stop('已暂停');
  $('budget').onchange = () => persist({ movetime: Number($('budget').value) });
  $('mode').onchange = () => {
    $('balance-row').classList.toggle('hidden', $('mode').value === 'fixed');
    persist({ mode: $('mode').value });
  };
  $('balance').oninput = () => {
    const value = Number($('balance').value);
    $('balance-label').textContent = `${value >= 0.5 ? '稳健' : '速度'} ${Math.round(value * 100)}%`;
  };
  $('balance').onchange = () => persist({ balance: Number($('balance').value) });
  Promise.resolve().then(() => {
    if (!isContextAlive()) { invalidateContext(); return null; }
    return chrome.storage.local.get({ movetime: 3500, mode: 'adaptive', balance: 0.65 });
  }).then(settings => {
    if (destroyed || !settings) return;
    const { movetime, mode, balance } = settings;
    if (['800', '1800', '2800', '3500'].includes(String(movetime))) $('budget').value = String(movetime);
    $('mode').value = mode === 'fixed' ? 'fixed' : 'adaptive';
    $('balance-row').classList.toggle('hidden', $('mode').value === 'fixed');
    $('balance').value = String(Number.isFinite(balance) ? Math.min(1, Math.max(0, balance)) : 0.65);
    $('balance').oninput();
  }).catch(handleContextError);
  function onRuntimeMessage(message, sender, sendResponse) {
    if (destroyed) return false;
    if (!isContextAlive()) { invalidateContext(); return false; }
    if (!['XQ_PING', 'XQ_TOGGLE_PANEL'].includes(message?.type)) return false;
    if (message.type === 'XQ_TOGGLE_PANEL') setCollapsed(!$('body').classList.contains('hidden'));
    sendResponse?.({ ok: true, contextAlive: true });
    return false;
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  function onVisibilityChange() { if (document.hidden && (auto || busy)) stop('页面已隐藏，已暂停'); }
  function onKeyDown(event) { if (event.key === 'Escape' && (auto || busy)) stop('已暂停'); }
  function onPageHide() {
    if (requestId && isContextAlive()) void rpc('XQ_CANCEL', { requestId }).catch(() => {});
    dispose();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('pagehide', onPageHide);
  globalThis.__xiangqiQuickHands = { isAlive: isContextAlive, destroy: () => dispose(true) };
  void tick();
})();
