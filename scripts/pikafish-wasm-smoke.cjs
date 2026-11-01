const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {createVerificationServer} = require('./dev-server.cjs');

async function main() {
  const server = createVerificationServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,
      executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath()});
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    const result = await page.evaluate(() => new Promise((resolve, reject) => {
      const worker = new Worker('/extension/pikafish-worker.js');
      const started = performance.now();
      let metadata;
      let info;
      let searchStarted;
      const timer = setTimeout(() => {worker.terminate();reject(new Error('Pikafish WASM smoke timed out.'));}, 45000);
      worker.onerror = error => {clearTimeout(timer);worker.terminate();reject(new Error(error.message));};
      worker.onmessage = event => {
        const message = event.data;
        if (message.type === 'error') {
          clearTimeout(timer);worker.terminate();reject(new Error(message.error));
        } else if (message.type === 'ready') {
          metadata = message;
          searchStarted = performance.now();
          worker.postMessage({type:'command',command:'position startpos'});
          worker.postMessage({type:'command',command:'go movetime 2000'});
        } else if (message.type === 'engine') {
          if (/^info depth /.test(message.line) && /\bscore (cp|mate) /.test(message.line) && /\bpv /.test(message.line)) info=message.line;
          if (message.line.startsWith('bestmove ')) {
            clearTimeout(timer);worker.terminate();
            resolve({metadata,info,bestmove:message.line,searchMs:Math.round(performance.now()-searchStarted),
              totalMs:Math.round(performance.now()-started)});
          }
        }
      };
    }));
    assert.equal(result.metadata.nnueVerified,true);
    assert.equal(result.metadata.backend,'wasm');
    assert.match(result.metadata.name,/Pikafish/);
    assert.ok(Number(result.info.match(/\bdepth (\d+)/)?.[1])>=6);
    assert.match(result.bestmove,/^bestmove [a-i][0-9][a-i][0-9]/);
    assert.ok(result.searchMs<4300);
    console.log(JSON.stringify(result,null,2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {console.error(error.stack || error);process.exitCode=1;});
