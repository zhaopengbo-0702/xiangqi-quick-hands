const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {runDiagnostic} = require('./pikafish-diagnostic.cjs');

const project = path.resolve(__dirname, '..');
const extension = path.join(project, 'extension');
const allowedOrigin = 'https://play.xiangqi.com';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const wasmHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fairy-Stockfish WASM 兼容性验证</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f7;color:#17222b;font:15px/1.6 system-ui,sans-serif}
main{max-width:900px;margin:48px auto;padding:0 24px}h1{font-size:26px;margin:0 0 24px}button{background:#12664f;color:white;border:0;padding:12px 20px;border-radius:6px;font:inherit;cursor:pointer}button:disabled{opacity:.6}
dl{display:grid;grid-template-columns:170px minmax(0,1fr);gap:0;margin:24px 0;border-top:1px solid #d7dfe3}dt,dd{margin:0;padding:10px 0;border-bottom:1px solid #d7dfe3;overflow-wrap:anywhere}dt{color:#52616b}pre{background:#fff;border:1px solid #d7dfe3;border-radius:6px;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere}#status{margin-left:16px;color:#52616b}@media(max-width:600px){main{margin:24px auto}dl{grid-template-columns:110px minmax(0,1fr)}}
</style></head><body><main><h1>Fairy-Stockfish WASM 兼容性验证</h1>
<button id="run" type="button">验证引擎</button><span id="status">待验证</span>
<dl><dt>跨源隔离</dt><dd id="isolation"></dd><dt>共享内存</dt><dd id="shared"></dd>
<dt>完成搜索深度</dt><dd id="depth">-</dd><dt>引擎耗时</dt><dd id="elapsed">-</dd>
<dt>推荐着法</dt><dd id="bestmove">-</dd><dt>主变化</dt><dd id="pv">-</dd></dl>
<pre id="output">{}</pre></main>
<script src="/harness-setup.js"></script><script src="/extension/engine/stockfish.js"></script>
<script type="module" src="/extension/offscreen.js"></script><script type="module" src="/harness.js"></script>
</body></html>`;

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pikafish NNUE 本机检查</title>
<style>*{box-sizing:border-box}body{margin:0;color:#22332c;background:#f3f6f4;font:14px/1.65 system-ui,sans-serif;letter-spacing:0}main{max-width:800px;margin:32px auto;padding:0 20px}header{display:flex;align-items:center;gap:12px;padding-bottom:18px;border-bottom:1px solid #d6dfd9}header img{width:38px;height:38px}h1{font-size:23px;margin:0}nav{margin:16px 0;display:flex;gap:18px;flex-wrap:wrap}a{color:#176d4d}button{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:8px 14px;border:0;border-radius:5px;color:white;background:#176d4d;font:inherit;cursor:pointer}button img{width:16px;height:16px;filter:brightness(0) invert(1)}button:disabled{opacity:.5;cursor:default}#status{margin-left:12px;color:#596e61}dl{display:grid;grid-template-columns:130px minmax(0,1fr);margin:20px 0;border-top:1px solid #d6dfd9}dt,dd{padding:10px 0;margin:0;border-bottom:1px solid #d6dfd9;overflow-wrap:anywhere}dt{color:#627568}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 Consolas,monospace;border-top:1px solid #d6dfd9;padding-top:16px}@media(max-width:480px){main{margin-top:20px}h1{font-size:20px}dl{grid-template-columns:100px minmax(0,1fr)}}</style></head>
<body><main><header><img src="/extension/icons/icon128.png" alt="象棋快手"><h1>Pikafish NNUE 本机检查</h1></header><nav><a href="https://play.xiangqi.com/computer-play" target="_blank" rel="noopener">人机对局</a><a href="https://play.xiangqi.com/play" target="_blank" rel="noopener">在线对局</a><a href="/wasm">兼容引擎检查</a></nav>
<button id="run"><img src="/extension/icons/play.svg" alt="">运行检查</button><span id="status" role="status">服务已连接</span>
<dl><dt>引擎</dt><dd id="engine">-</dd><dt>NNUE</dt><dd id="nnue">-</dd><dt>线程 / 置换表</dt><dd id="resources">-</dd><dt>完成深度</dt><dd id="depth">-</dd><dt>搜索耗时</dt><dd id="elapsed">-</dd><dt>最佳着法</dt><dd id="move">-</dd><dt>主变化</dt><dd id="pv">-</dd><dt>浏览器插件连接</dt><dd>未检测</dd></dl><pre id="output">{}</pre></main><script src="/diagnostic.js"></script></body></html>`;

const diagnosticScript = `const field=(id,value)=>{document.getElementById(id).textContent=String(value)};
document.getElementById('run').onclick=async event=>{const button=event.currentTarget;button.disabled=true;field('status','检查中');try{const response=await fetch('/api/verify',{method:'POST'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'检查失败');field('engine',result.engine);field('nnue',result.nnue+' · 已验证');field('resources',result.threads+' / '+result.hash+' MiB');field('depth',result.depth);field('elapsed',result.searchMs+' ms');field('move',result.bestmove);field('pv',result.pv.join(' > '));field('output',JSON.stringify(result,null,2));field('status','本机引擎通过')}catch(error){field('status','检查失败');field('output',error.message)}finally{button.disabled=false}};`;

const setup = `const engineListeners = [];
window.chrome = {runtime: {
  id: 'local-engine-harness',
  getURL: (file) => location.origin + '/extension/' + file,
  onMessage: {addListener: (listener) => engineListeners.push(listener)}
}};
window.engineRequest = (type, options) => new Promise((resolve, reject) => {
  const respond = (response) => response.ok ? resolve(response.result) : reject(new Error(response.error));
  for (const listener of engineListeners) listener({target:'offscreen',type,options},{id:chrome.runtime.id},respond);
});`;

const harness = `const field = (id, text) => { document.getElementById(id).textContent = String(text); };
field('isolation', String(crossOriginIsolated));
field('shared', typeof SharedArrayBuffer);
document.getElementById('run').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    field('status', '预热中');
    await engineRequest('XQ_ENGINE_WARMUP');
    field('status', '计算中');
    const result = await engineRequest('XQ_ENGINE_ANALYZE', {
      fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
      movetime: 3500, mode: 'adaptive', balance: 0.65, requestId: 'browser-harness'
    });
    field('depth', result.depth);
    field('elapsed', result.elapsedMs + ' ms');
    field('bestmove', result.bestmove);
    field('pv', result.pv.join(' '));
    field('output', JSON.stringify({crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer, ...result}, null, 2));
    field('status', result.depth >= 6 && result.elapsedMs < 4300 ? '通过' : '未通过');
  } catch (error) { field('status', '失败'); field('output', error.stack || error.message); }
  finally { button.disabled = false; }
});`;

function createVerificationServer({diagnostic = runDiagnostic} = {}) {
let checking = false;
const server = http.createServer(async (request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.url === '/api/verify') {
    const localOrigin = 'http://127.0.0.1:' + server.address().port;
    const json = (status, value) => response.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
    if (request.method !== 'POST') return json(405,{ok:false,error:'POST required.'});
    if (request.headers.host !== localOrigin.slice(7) || request.headers.origin !== localOrigin) return json(403,{ok:false,error:'Local same-origin requests only.'});
    if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
      request.resume();
      return json(400,{ok:false,error:'This fixed diagnostic accepts no input.'});
    }
    if (checking) return json(409,{ok:false,error:'A diagnostic is already running.'});
    checking = true;
    try { json(200, await diagnostic()); }
    catch (error) { json(500,{ok:false,error:error.message}); }
    finally { checking = false; }
    return;
  }
  if (request.headers.origin === allowedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    let content;
    let type;
    if (pathname === '/') { content = html; type = types['.html']; }
    else if (pathname === '/wasm') { content = wasmHtml; type = types['.html']; }
    else if (pathname === '/diagnostic.js') { content = diagnosticScript; type = types['.js']; }
    else if (pathname === '/harness-setup.js') { content = setup; type = types['.js']; }
    else if (pathname === '/harness.js') { content = harness; type = types['.js']; }
    else if (pathname === '/live-test.js') {
      const files = await Promise.all(['page-bridge.js', 'site-adapter.js'].map((name) => fs.readFile(path.join(extension, name), 'utf8')));
      content = files.join('\n'); type = types['.js'];
    } else if (pathname.startsWith('/extension/')) {
      const relative = pathname.slice('/extension/'.length);
      const target = path.resolve(extension, relative);
      if (!target.startsWith(extension + path.sep)) { response.writeHead(403).end(); return; }
      content = await fs.readFile(target);
      type = types[path.extname(target)] || 'application/octet-stream';
    } else { response.writeHead(404).end(); return; }
    response.writeHead(200, {'Content-Type': type}).end(content);
  } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 400).end(); }
});
return server;
}

if (require.main === module) {
const server = createVerificationServer();
let port = 8791;
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && port === 8791) {
    port = 8792;
    server.listen(port, '127.0.0.1');
  } else { console.error(error.message); process.exitCode = 1; }
});
server.on('listening', () => console.log('Engine verification: http://127.0.0.1:' + port));
server.listen(port, '127.0.0.1');
}
module.exports = {createVerificationServer};
