const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {fromNativeLine} = require('../extension/native-engine.js');

async function runDiagnostic() {
  const installed = path.join(process.env.LOCALAPPDATA || '', 'XiangqiQuickHands', 'PikafishHost');
  const [marker, config] = await Promise.all(['installation.json','config.json'].map(async name =>
    JSON.parse(await fs.readFile(path.join(installed,name),'utf8'))));
  const origin = config.allowed_origins?.[0];
  if (marker.product !== 'xiangqi-quick-hands-pikafish-host' || !path.isAbsolute(marker.pythonPath || '') ||
      !/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin || '')) throw new Error('Invalid installed Pikafish component.');
  const child = spawn(marker.pythonPath, ['-u',path.join(installed,'host.py'),'--config',path.join(installed,'config.json'),origin,'--parent-window=0'],
    {windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  return new Promise((resolve,reject) => {
    let pending = Buffer.alloc(0), metadata, nnueEvidence, searchStarted, result, completed = false;
    let info = {}, stderr = '', closing = false, failure;
    const startup = performance.now();
    const timer = setTimeout(() => finish(new Error('Pikafish diagnostic exceeded 15 seconds.')),15000);
    let exitTimer;
    const command = command => {
      const body = Buffer.from(JSON.stringify({type:'command',command}));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      child.stdin.write(Buffer.concat([header,body]));
    };
    function finish(error) {
      if (completed) return;
      if (error && child.exitCode === null && !closing) {
        closing = true;
        failure = error;
        clearTimeout(timer);
        child.stdin.end();
        exitTimer = setTimeout(() => {
          if (Number.isInteger(metadata?.enginePid) && metadata.enginePid > 0) {
            try { process.kill(metadata.enginePid); } catch {}
          }
          child.kill();
          finish(failure);
        },1500);
        return;
      }
      completed = true;
      clearTimeout(timer);
      clearTimeout(exitTimer);
      if (child.exitCode === null) child.kill();
      if (error) reject(error); else resolve(result);
    }
    function receive(message) {
      if (closing) return;
      if (message.type === 'error') throw new Error(message.error);
      if (message.type === 'engine') {
        const line = fromNativeLine(message.line);
        if (/NNUE evaluation using/.test(line)) nnueEvidence = line;
        if (searchStarted !== undefined && line.startsWith('info ') && !/\b(lowerbound|upperbound)\b/.test(line)) {
          const depth = line.match(/\bdepth (\d+)/)?.[1];
          const pv = line.match(/\bpv (.+)$/)?.[1];
          if (depth && pv) info = {depth:Number(depth),pv:pv.trim().split(/\s+/)};
        }
        if (searchStarted !== undefined && line.startsWith('bestmove ')) {
          const bestmove = line.split(' ')[1];
          if (!/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.test(bestmove) || !(info.depth >= 6)) {
            throw new Error('Pikafish did not complete a legal multi-ply search.');
          }
          result = {ok:true,engine:metadata.version,nnue:metadata.nnue,nnueVerified:true,
            threads:metadata.threads,hash:metadata.hash,depth:info.depth,bestmove,pv:info.pv,
            searchMs:Math.round(performance.now()-searchStarted),totalMs:Math.round(performance.now()-startup),
            extensionConnection:'not-tested'};
          child.stdin.end();
          exitTimer = setTimeout(() => finish(new Error('Pikafish did not exit after the check.')),1500);
        }
      } else if (message.type === 'ready' && !metadata) {
        if (!nnueEvidence || !message.nnue) throw new Error('Pikafish did not confirm NNUE evaluation.');
        metadata = message;
        command('setoption name MultiPV value 1');
        command('position startpos');
        searchStarted = performance.now();
        command('go movetime 600');
      }
    }
    child.once('error',finish);
    child.stdin.on('error',error => { if (!result) finish(error); });
    child.stderr.on('data',chunk => { stderr = (stderr+chunk.toString()).slice(-2000); });
    child.stdout.on('data',chunk => {
      if (completed) return;
      try {
        pending = Buffer.concat([pending,chunk]);
        while (pending.length >= 4) {
          const length = pending.readUInt32LE(0);
          if (!length || length > 65536) throw new Error('Invalid diagnostic native frame.');
          if (pending.length < length+4) break;
          const message = JSON.parse(pending.subarray(4,length+4).toString('utf8'));
          pending = pending.subarray(length+4);
          receive(message);
        }
      } catch (error) { finish(error); }
    });
    child.once('close',code => {
      if (closing) return finish(failure);
      if (result && code === 0 && pending.length === 0) finish();
      else finish(new Error(stderr || 'Pikafish component exited without completing the check.'));
    });
  });
}

module.exports = {runDiagnostic};
if (require.main === module) runDiagnostic().then(result => console.log(JSON.stringify(result,null,2)),error => {
  console.error(error.message);
  process.exitCode = 1;
});
