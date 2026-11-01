const TARGET = 'offscreen';
let documentReady;
let searchTail = Promise.resolve();
let generation = 0;

// Offscreen documents use a runtime port; only the service worker opens native hosts.
chrome.runtime.onConnect.addListener(client => {
  if (client.name !== 'xq-pikafish-native') return;
  const sender = client.sender;
  if (sender?.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('offscreen.html')) {
    client.disconnect();
    return;
  }
  let native;
  let closed = false;
  const close = error => {
    if (closed) return;
    closed = true;
    if (error) {
      try { client.postMessage({type:'error', error:error.message}); } catch {}
    }
    try { native?.disconnect(); } catch {}
    try { client.disconnect(); } catch {}
  };
  client.onDisconnect.addListener(() => close());
  client.onMessage.addListener(message => {
    if (closed) return;
    try { native.postMessage(message); } catch (error) { close(error); }
  });
  try {
    native = chrome.runtime.connectNative('com.xiangqi.quick_hands.pikafish');
    native.onMessage.addListener(message => {
      if (closed) return;
      try { client.postMessage(message); } catch (error) { close(error); }
    });
    native.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError?.message;
      close(new Error(message || 'Pikafish native companion disconnected.'));
    });
  } catch (error) { close(error); }
});

async function ensureDocument() {
  if (documentReady) return documentReady;
  documentReady = (async () => {
    const url = chrome.runtime.getURL('offscreen.html');
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url],
    });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['WORKERS'],
        justification: 'Run the bundled Xiangqi WebAssembly engine in a persistent worker.',
      });
    }
  })().catch((error) => {
    documentReady = undefined;
    throw error;
  });
  return documentReady;
}

async function command(type, payload = {}) {
  for (let attempt = 0; ; attempt++) {
    await ensureDocument();
    let response;
    try { response = await chrome.runtime.sendMessage({target: TARGET, type, ...payload}); }
    catch (error) {
      if (!/Receiving end does not exist/.test(error.message)) throw error;
      documentReady = undefined;
      if (type !== 'XQ_ENGINE_WARMUP' || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 60));
      continue;
    }
    if (!response?.ok) throw new Error(response?.error || 'The engine did not respond.');
    return response.result;
  }
}

export async function warmup() {
  const requestGeneration = generation;
  const result = await command('XQ_ENGINE_WARMUP');
  if (requestGeneration !== generation) return warmup();
  return result;
}

export function analyze(options) {
  const requestGeneration = generation;
  const task = searchTail.catch(() => {}).then(async () => {
    if (generation !== requestGeneration) throw new Error('Search cancelled.');
    await warmup();
    if (generation !== requestGeneration) throw new Error('Search cancelled.');
    return command('XQ_ENGINE_ANALYZE', {options});
  });
  searchTail = task;
  return task;
}

export async function cancel() {
  generation += 1;
  if (!documentReady) return;
  await command('XQ_ENGINE_CANCEL');
}
