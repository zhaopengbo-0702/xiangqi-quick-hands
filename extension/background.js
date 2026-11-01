import { analyze, warmup, cancel } from './engine-client.js';

let owner = null;

async function isSupportedTab(sender, type) {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return false;
  try {
    const origin = 'https://play.xiangqi.com';
    if (new URL(sender.url).origin !== origin || (sender.origin && sender.origin !== origin)) return false;
    // SPA navigation can leave the message sender's document URL on the lobby.
    const tab = await chrome.tabs.get(sender.tab.id);
    const url = new URL(tab.url);
    const game = url.pathname === '/computer-play' || /^\/game\/[^/]+\/?$/.test(url.pathname);
    const lobby = ['/play', '/computer'].includes(url.pathname);
    return url.origin === origin && (type === 'XQ_CANCEL' || game || (type === 'XQ_WARMUP' && lobby));
  } catch {
    return false;
  }
}

async function handle(message, sender) {
  if (!(await isSupportedTab(sender, message.type))) throw new Error('请先打开象棋对局棋盘。');
  if (message.type === 'XQ_WARMUP') {
    const result = await warmup();
    return { engine: result.name || 'Pikafish', nnue: result.nnue || null,
      backend: result.backend || null, nativeError: result.nativeError || null, ready: true };
  }
  if (message.type === 'XQ_CANCEL') {
    if (owner?.tabId === sender.tab.id && (!message.requestId || owner.requestId === message.requestId)) {
      owner = null;
      await cancel();
    }
    return {};
  }
  if (message.type === 'XQ_ANALYZE') {
    if (typeof message.fen !== 'string' || message.fen.length > 200 || !/^[rnbakcpheRNBAKCPHE\d/]+ [wb] - - \d+ \d+$/.test(message.fen)) {
      throw new Error('局面格式无效。');
    }
    if (typeof message.requestId !== 'string' || message.requestId.length > 100) throw new Error('请求无效。');
    let history = {};
    if (message.moves !== undefined || message.initialFen !== undefined) {
      if (typeof message.initialFen !== 'string' || message.initialFen.length > 180 ||
          !Array.isArray(message.moves) || message.moves.length > 1024 ||
          !message.moves.every(move => typeof move === 'string' && /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.test(move))) {
        throw new Error('棋谱格式无效。');
      }
      history = { initialFen: message.initialFen, moves: message.moves };
    }
    if (owner) throw new Error('另一局正在计算，请先暂停那一局。');
    const ticket = { tabId: sender.tab.id, requestId: message.requestId };
    owner = ticket;
    try {
      const result = await analyze({
        fen: message.fen,
        ...history,
        movetime: Math.max(500, Math.min(3500, Number(message.movetime) || 3500)),
        mode: message.mode === 'fixed' ? 'fixed' : 'adaptive',
        balance: Number.isFinite(Number(message.balance)) ? Math.max(0, Math.min(1, Number(message.balance))) : 0.65,
        requestId: ticket.requestId,
      });
      if (owner !== ticket) throw new Error('计算已取消。');
      return result;
    } finally {
      if (owner === ticket) owner = null;
    }
  }
  throw new Error('未知请求。');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['XQ_WARMUP', 'XQ_ANALYZE', 'XQ_CANCEL'].includes(message?.type)) return false;
  handle(message, sender).then(result => sendResponse({ ok: true, ...result }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});

const tabRecoveries = new Map();

function isXiangqiUrl(value) {
  try { return new URL(value).origin === 'https://play.xiangqi.com'; } catch { return false; }
}

async function recoverContent(tabId, toggle) {
  const tab = await chrome.tabs.get(tabId);
  if (!isXiangqiUrl(tab.url)) return;
  let alive = false;
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'XQ_PING' }, { frameId: 0 });
    alive = response?.ok === true && response.contextAlive === true;
  } catch {}
  if (alive) {
    if (!toggle) return;
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'XQ_TOGGLE_PANEL' }, { frameId: 0 });
      if (response?.ok === true && response.contextAlive === true) return;
    } catch {}
  }
  await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', files: ['page-bridge.js'],
  });
  await chrome.scripting.executeScript({
    target: { tabId }, world: 'ISOLATED', files: ['site-adapter.js', 'content.js'],
  });
}

function recoverTab(tabId, toggle = false) {
  if (!Number.isSafeInteger(tabId)) return Promise.resolve();
  const previous = tabRecoveries.get(tabId) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => recoverContent(tabId, toggle));
  tabRecoveries.set(tabId, task);
  const clear = () => { if (tabRecoveries.get(tabId) === task) tabRecoveries.delete(tabId); };
  void task.then(clear, clear);
  return task;
}

async function recoverOpenTabs() {
  let tabs;
  try { tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' }); } catch { return; }
  await Promise.allSettled(tabs.map(tab => recoverTab(tab.id)));
}

chrome.runtime.onInstalled.addListener(recoverOpenTabs);
chrome.runtime.onStartup.addListener(recoverOpenTabs);

chrome.action.onClicked.addListener(async tab => {
  if (isXiangqiUrl(tab.url)) {
    try { await recoverTab(tab.id, true); } catch {}
  } else {
    await chrome.tabs.create({ url: 'https://play.xiangqi.com/computer-play' });
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (owner?.tabId === tabId) { owner = null; void cancel(); }
});
