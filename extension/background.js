import { analyze, warmup, cancel, setBackgroundPulse } from './engine-client.js';

let owner = null;
const backgroundTabs = new Map();
const backgroundRequests = new Map();
let pulseApplied = null;
let pulseSync = null;
let heartbeatRecovery = null;

function validBackgroundSession(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function backgroundStatus(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Background status timed out.')), 800);
    Promise.resolve().then(() => chrome.tabs.sendMessage(tabId, { type: 'XQ_BACKGROUND_STATUS' }, { frameId: 0 }))
      .then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function recoverBackgroundSubscriptions() {
  if (heartbeatRecovery) return heartbeatRecovery;
  // The surviving offscreen timer can wake a restarted service worker. Ask only
  // already-running page instances; never inject a script or enable autoplay.
  heartbeatRecovery = (async () => {
    if (backgroundTabs.size) return;
    let tabs;
    try { tabs = await chrome.tabs.query({ url: 'https://play.xiangqi.com/*' }); }
    catch { return; }
    await Promise.allSettled(tabs.filter(tab => Number.isSafeInteger(tab.id) && isGameUrl(tab.url)).map(async tab => {
      if (backgroundTabs.has(tab.id) || backgroundRequests.has(tab.id)) return;
      const request = { recovery: true };
      backgroundRequests.set(tab.id, request);
      try {
        const response = await backgroundStatus(tab.id);
        if (response?.ok !== true || response.active !== true || !validBackgroundSession(response.sessionId)) return;
        const liveTab = await chrome.tabs.get(tab.id);
        if (!isGameUrl(liveTab.url) || backgroundRequests.get(tab.id) !== request || backgroundTabs.has(tab.id)) return;
        backgroundTabs.set(tab.id, { sessionId: response.sessionId, inFlight: false });
        void syncBackgroundPulse();
      } catch {}
      finally { if (backgroundRequests.get(tab.id) === request) backgroundRequests.delete(tab.id); }
    }));
  })();
  return heartbeatRecovery;
}

function syncBackgroundPulse() {
  if (pulseSync) return pulseSync;
  let failed = false;
  pulseSync = (async () => {
    while (pulseApplied !== (backgroundTabs.size > 0)) {
      const enabled = backgroundTabs.size > 0;
      await setBackgroundPulse(enabled);
      pulseApplied = enabled;
    }
  })().catch(() => { failed = true; pulseApplied = null; }).finally(() => {
    pulseSync = null;
    if (!failed && pulseApplied !== (backgroundTabs.size > 0)) void syncBackgroundPulse();
  });
  return pulseSync;
}

function removeBackgroundTab(tabId, subscription) {
  if (subscription && backgroundTabs.get(tabId) !== subscription) return;
  if (backgroundTabs.delete(tabId)) void syncBackgroundPulse();
}

function isGameUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://play.xiangqi.com' && isBoardPath(url.pathname);
  } catch { return false; }
}

function isBoardPath(path) {
  return path === '/computer-play' || /^\/game\/[^/]+\/?$/.test(path) ||
    /^\/puzzle\/(?!custom(?:\/|$)|stats(?:\/|$)|record(?:\/|$)|race(?:\/|$))[^/]+(?:\/[PC])?\/?$/.test(path) ||
    /^\/puzzle\/race\/[^/]+\/?$/.test(path) || path === '/analysis/board' ||
    /^\/(review|note|lessons|learn|editor|game-database|watch)(?:\/|$)/.test(path);
}

async function handleBackgroundSubscription(message, sender) {
  if (sender.id !== chrome.runtime.id || !Number.isSafeInteger(sender.tab?.id) || sender.frameId !== 0 ||
      !isXiangqiUrl(sender.url) || (sender.origin && sender.origin !== 'https://play.xiangqi.com') ||
      typeof message.active !== 'boolean' || !validBackgroundSession(message.sessionId)) throw new Error('后台执行请求无效。');
  const tabId = sender.tab.id;
  if (!message.active) {
    const pending = backgroundRequests.get(tabId);
    if (pending?.sessionId === message.sessionId || pending?.recovery) backgroundRequests.delete(tabId);
    const current = backgroundTabs.get(tabId);
    if (current?.sessionId === message.sessionId) removeBackgroundTab(tabId, current);
    await syncBackgroundPulse();
    return { active: false };
  }
  const request = { sessionId: message.sessionId };
  backgroundRequests.set(tabId, request);
  if (!(await isSupportedTab(sender, 'XQ_BACKGROUND'))) {
    if (backgroundRequests.get(tabId) === request) backgroundRequests.delete(tabId);
    throw new Error('请先打开象棋对局棋盘。');
  }
  if (backgroundRequests.get(tabId) !== request) return { active: false };
  backgroundRequests.delete(tabId);
  const current = backgroundTabs.get(tabId);
  const sameDocument = !current?.documentId || current.documentId === sender.documentId;
  const subscription = current?.sessionId === message.sessionId && sameDocument ? current :
    { sessionId: message.sessionId, inFlight: false };
  if (typeof sender.documentId === 'string') subscription.documentId = sender.documentId;
  backgroundTabs.set(tabId, subscription);
  await syncBackgroundPulse();
  return { active: backgroundTabs.get(tabId) === subscription };
}

async function sendBackgroundPulse(tabId, subscription) {
  if (subscription.inFlight || backgroundTabs.get(tabId) !== subscription) return;
  subscription.inFlight = true;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (backgroundTabs.get(tabId) !== subscription) return;
    if (!isGameUrl(tab.url)) { removeBackgroundTab(tabId, subscription); return; }
    const response = await chrome.tabs.sendMessage(tabId,
      { type: 'XQ_BACKGROUND_PULSE', sessionId: subscription.sessionId },
      { frameId: 0, ...(subscription.documentId ? { documentId: subscription.documentId } : {}) });
    if (response?.ok !== true || response.active !== true) removeBackgroundTab(tabId, subscription);
  } catch { removeBackgroundTab(tabId, subscription); }
  finally { subscription.inFlight = false; }
}

async function isSupportedTab(sender, type) {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return false;
  try {
    const origin = 'https://play.xiangqi.com';
    if (new URL(sender.url).origin !== origin || (sender.origin && sender.origin !== origin)) return false;
    // SPA navigation can leave the message sender's document URL on the lobby.
    const tab = await chrome.tabs.get(sender.tab.id);
    const url = new URL(tab.url);
    const game = isBoardPath(url.pathname);
    const lobby = ['/play', '/computer', '/puzzle', '/puzzle/custom', '/puzzle/stats', '/puzzle/record', '/puzzle/race'].includes(url.pathname);
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
  if (message?.target === 'background' && message.type === 'XQ_BACKGROUND_HEARTBEAT') {
    if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('offscreen.html')) return false;
    for (const [tabId, subscription] of backgroundTabs) void sendBackgroundPulse(tabId, subscription);
    const recovering = heartbeatRecovery === null;
    if (recovering) void recoverBackgroundSubscriptions().finally(() => {
      for (const [tabId, subscription] of backgroundTabs) void sendBackgroundPulse(tabId, subscription);
      void syncBackgroundPulse();
    });
    else if (backgroundTabs.size) void syncBackgroundPulse();
    sendResponse({ ok: true, enabled: backgroundTabs.size > 0 });
    return false;
  }
  if (message?.type === 'XQ_BACKGROUND') {
    handleBackgroundSubscription(message, sender).then(result => sendResponse({ ok: true, ...result }),
      error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
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
  backgroundRequests.delete(tabId);
  removeBackgroundTab(tabId);
  if (owner?.tabId === tabId) { owner = null; void cancel(); }
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !isGameUrl(changeInfo.url)) {
    backgroundRequests.delete(tabId);
    removeBackgroundTab(tabId);
  }
});
