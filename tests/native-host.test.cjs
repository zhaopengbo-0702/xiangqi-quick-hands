const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const project = path.resolve(__dirname, '..');
const hostPath = path.join(project, 'native-host', 'host.py');
const localPython = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python39', 'python.exe');
const python = process.env.PYTHON || (fs.existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python' : 'python3');
const origin = 'chrome-extension://klihohciokeeilfehijjohoojoomffpl/';
const importHost = `
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("native_host", sys.argv[1])
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
`;

function checkPython(code) {
  execFileSync(python, ['-c', importHost + code, hostPath], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
}

test('native framing handles fragmented UTF-8 payloads and rejects invalid frames', () => {
  checkPython(`
import io, json, struct
class Fragmented(io.BytesIO):
    def read(self, size=-1):
        return super().read(min(size, 2))
message = {"text": chr(0x68cb) + chr(0x76d8)}
body = json.dumps(message, ensure_ascii=False).encode("utf-8")
assert host.read_message(Fragmented(struct.pack("<I", len(body)) + body)) == message
assert host.read_message(io.BytesIO()) is None
for frame in (struct.pack("<I", 65537), struct.pack("<I", 0), b"xx", struct.pack("<I", 4) + b"{}", struct.pack("<I", 2) + b"[]", struct.pack("<I", 1) + bytes([255])):
    try:
        host.read_message(io.BytesIO(frame))
    except (ValueError, UnicodeError):
        pass
    else:
        raise AssertionError("Invalid frame was accepted")
`);
});

test('native framing preserves complete responses under concurrent writers', () => {
  checkPython(`
import io, threading
stream = io.BytesIO()
writer = host.Writer(stream)
threads = [threading.Thread(target=lambda worker=worker: [writer.send({"worker": worker, "index": index}) for index in range(40)]) for worker in range(8)]
for thread in threads: thread.start()
for thread in threads: thread.join()
stream.seek(0)
received = []
while True:
    message = host.read_message(stream)
    if message is None: break
    received.append((message["worker"], message["index"]))
assert len(received) == 320
assert len(set(received)) == 320
`);
});

test('native command guard permits bounded UCI and rejects injection and unsafe options', () => {
  checkPython(`
fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"
def valid(command): return host.validate_command({"type": "command", "command": command})
for command in ("uci", "isready", "ucinewgame", "stop", "go infinite", "go perft 1", "go movetime 3500", "setoption name MultiPV value 2", "setoption name Threads value 4", "setoption name Hash value 128", "position fen " + fen + " moves b0c2 b9c7", "position startpos"):
    assert valid(command) == command
assert host.valid_fen(fen.replace("0 1", "119 100000"))
for command in ("uci\\nquit", "uci\\x00quit", "bench", "export_net overwrite.nnue", "setoption name EvalFile value other.nnue", "setoption name Threads value 99", "setoption name Hash value 2048", "setoption name MultiPV value 100", "setoption name Ponder value true", "go movetime 3501", "go perft 2", "position startpos moves b10c8", "position startpos moves a0a0", "position fen " + fen.replace("0 1", "120 1"), "position fen " + fen.replace("0 1", "0 100001")):
    try: valid(command)
    except ValueError: pass
    else: raise AssertionError("Unsafe command accepted: " + repr(command))
for message in ({"type": "command", "command": "uci", "enginePath": "other.exe"}, {"type": "analyze"}, {"type": "command", "command": 42}):
    try: host.validate_command(message)
    except ValueError: pass
    else: raise AssertionError("Unsafe message accepted")
`);
});

test('native configuration requires exact extension origins and verifies both file hashes', () => {
  checkPython(`
import tempfile, pathlib, json, hashlib
with tempfile.TemporaryDirectory() as temporary:
    directory = pathlib.Path(temporary)
    engine = directory / "engine.exe"
    network = directory / "engine.nnue"
    engine.write_bytes(b"engine")
    network.write_bytes(b"network")
    config = {"enginePath": str(engine), "networkPath": str(network), "engineSha256": hashlib.sha256(b"engine").hexdigest(), "networkSha256": hashlib.sha256(b"network").hexdigest(), "threads": 4, "hash": 128, "allowed_origins": ["${origin}"]}
    filename = directory / "config.json"
    filename.write_text(json.dumps(config), encoding="utf-8")
    assert host.load_config(str(filename), "${origin}")["threads"] == 4
    for caller in ("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/", "https://play.xiangqi.com/"):
        try: host.load_config(str(filename), caller)
        except ValueError: pass
        else: raise AssertionError("Unapproved caller accepted")
    network.write_bytes(b"modified network")
    try: host.load_config(str(filename), "${origin}")
    except ValueError as error: assert "SHA256" in str(error)
    else: raise AssertionError("Modified network accepted")
`);
});

test('closing the native input terminates its child even during startup', () => {
  checkPython(`
import io, subprocess
real_popen = subprocess.Popen
children = []
def fake_engine(command, **options):
    process = real_popen([sys.executable, "-u", "-c", "import sys; [(None) for line in sys.stdin]"], **options)
    children.append(process)
    return process
host.subprocess.Popen = fake_engine
bridge = host.NativeHost({"enginePath": sys.executable}, io.BytesIO(), io.BytesIO())
assert bridge.run() == 0
assert len(children) == 1 and children[0].poll() is not None
`);
});

const runtimeMetadataPath = path.join(project, 'third_party', 'pikafish', 'runtime.json');
const runtimeMetadata = fs.existsSync(runtimeMetadataPath) ? JSON.parse(fs.readFileSync(runtimeMetadataPath, 'utf8')) : null;
const runtimeDirectory = path.dirname(runtimeMetadataPath);
const enginePath = runtimeMetadata ? path.resolve(runtimeDirectory, runtimeMetadata.enginePath) : '';
const networkPath = runtimeMetadata ? path.resolve(runtimeDirectory, runtimeMetadata.networkPath) : '';

test('actual official Pikafish proves NNUE, speaks native frames, searches, and exits on EOF', {
  timeout: 25000,
  skip: process.platform !== 'win32' || !fs.existsSync(enginePath) || !fs.existsSync(networkPath),
}, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xiangqi-native-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const configPath = path.join(temporary, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    enginePath, networkPath, engineSha256: sha256(enginePath), networkSha256: sha256(networkPath),
    threads: 4, hash: 128, allowed_origins: [origin],
  }));
  const child = spawn(python, ['-u', hostPath, '--config', configPath, origin, '--parent-window=0'], {
    windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const messages = [];
  const waiters = new Set();
  let bytes = Buffer.alloc(0);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.stdout.on('data', chunk => {
    bytes = Buffer.concat([bytes, chunk]);
    while (bytes.length >= 4) {
      const length = bytes.readUInt32LE(0);
      assert.ok(length > 0 && length <= 65536, 'stdout must contain only bounded native JSON frames');
      if (bytes.length < length + 4) break;
      const message = JSON.parse(bytes.subarray(4, length + 4).toString('utf8'));
      bytes = bytes.subarray(length + 4);
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (messages.length - 1 >= waiter.start && waiter.predicate(message)) {
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      }
    }
  });
  function waitFor(predicate, start = 0) {
    const existing = messages.slice(start).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, start, resolve };
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error('Native host response timed out. ' + stderr + JSON.stringify(messages.slice(-5))));
      }, 17000);
      waiters.add(waiter);
    });
  }
  function command(value) {
    const body = Buffer.from(JSON.stringify({ type: 'command', command: value }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([header, body]));
  }
  const ready = await waitFor(message => message.type === 'ready' || message.type === 'error');
  assert.equal(ready.type, 'ready', ready.error);
  assert.equal(ready.name, 'Pikafish');
  assert.match(ready.version, /Pikafish/);
  assert.equal(ready.threads, 4);
  assert.equal(ready.networkSha256, sha256(networkPath));
  assert.ok(messages.some(message => message.type === 'engine' && /NNUE evaluation using/.test(message.line)));
  let mark = messages.length;
  command('eval\nquit');
  assert.equal((await waitFor(message => message.type === 'error', mark)).error, 'Invalid UCI command.');
  mark = messages.length;
  command('position startpos');
  command('go movetime 150');
  const best = await waitFor(message => message.type === 'engine' && /^bestmove /.test(message.line), mark);
  assert.match(best.line, /^bestmove [a-i][0-9][a-i][0-9](?: |$)/);
  assert.ok(messages.slice(mark).some(message => message.type === 'engine' && /info depth [1-9]/.test(message.line)));
  child.stdin.end();
  const result = await closed;
  assert.equal(result.code, 0, stderr);
  assert.equal(bytes.length, 0, 'native output must end at a frame boundary');
  assert.throws(() => process.kill(ready.enginePid, 0), /ESRCH|not found|No such process/);
});
