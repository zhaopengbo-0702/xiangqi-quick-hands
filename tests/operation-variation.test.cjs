const test = require('node:test');
const assert = require('node:assert/strict');
const { XiangqiSiteAdapter, operationPattern, normalizeSnapshot, applyPlacement } = require('../extension/site-adapter.js');

const INITIAL = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const MOVE = 'b3e3';

function snapshot(gameID = 'variation-game', moved = false) {
  return normalizeSnapshot({ mode: 'computer', route: '/computer-play', participant: true,
    playerSide: 'red', gameID, isMyTurnNow: !moved,
    gamePlayData: { initFen: INITIAL, currentFen: moved ? applyPlacement(INITIAL, MOVE) + ' b - - 1 1' : INITIAL,
      turnNow: moved ? 'black' : 'red', moveCount: moved ? 1 : 0, state: 2, endReason: null } });
}

function fixture(options = {}) {
  let now = 0, reads = 0, selected = false, destinations = 0, cancelled = false;
  const events = [], waits = [], readDeadlines = [], inputTimes = [];
  const initial = snapshot();
  let current = initial;
  const sourceRect = { left: 100, top: 300, width: 40, height: 40 };
  const targetRect = { left: 220, top: 300, width: 40, height: 40 };
  function element(name, rect, onClick = () => {}) {
    return { name, isConnected: true, getBoundingClientRect: () => rect,
      classList: { contains: value => name === 'source' && value === 'selected-piece' && selected },
      dispatchEvent(event) { inputTimes.push(now); events.push({ element: name, ...event }); if (event.type === 'click') onClick(); } };
  }
  const source = element('source', sourceRect, () => { selected = true; });
  const target = element('destination', targetRect, () => {
    destinations++;
    if (options.confirm !== false) current = snapshot('variation-game', true);
    options.onDestination?.(controls);
  });
  const squares = [];
  for (let rank = 1; rank <= 10; rank++) {
    for (const file of 'abcdefghi') {
      const rect = rank === 3 && file === 'b' ? sourceRect : rank === 3 && file === 'e' ? targetRect : { left: -100, top: -100, width: 40, height: 40 };
      squares.push({ classList: { contains: value => value === `${rank}-${file}` },
        getBoundingClientRect: () => rect, children: rank === 3 && file === 'e' ? [target] : [] });
    }
  }
  const board = {
    querySelectorAll(selector) {
      if (selector === '.square') return squares;
      if (selector === '.pieces-container > div') return [{ getBoundingClientRect: () => sourceRect, querySelector: () => source }];
      return [];
    },
    getBoundingClientRect: () => ({ left: 50, top: 50, width: 450, height: 500 }),
    contains: element => element === source || element === target,
  };
  const adapter = Object.create(XiangqiSiteAdapter.prototype);
  adapter.window = { performance: { now: () => now }, MouseEvent: class {
    constructor(type, init) { Object.assign(this, init, { type }); }
  } };
  adapter.document = {
    querySelector: selector => selector === '#game-grid' ? board : null,
    querySelectorAll: selector => selector === '#game-grid .square' ? squares : [],
    elementFromPoint: (x, y) => [source, target].find(element => {
      const rect = element.getBoundingClientRect();
      return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
    }) || null,
  };
  adapter.random = options.random || (() => 0.5);
  const controls = {
    adapter, initial, source, target, events, waits, readDeadlines, inputTimes,
    get now() { return now; }, get reads() { return reads; }, get destinations() { return destinations; },
    advance: milliseconds => { now += milliseconds; }, cancel: () => { cancelled = true; },
    changeGame: () => { current = snapshot('replacement-game'); },
    isCancelled: () => cancelled,
  };
  adapter.delay = async milliseconds => {
    waits.push(milliseconds); now += milliseconds;
    await options.onWait?.(controls, milliseconds);
  };
  adapter.read = async (readOptions = {}) => {
    reads++; readDeadlines.push(readOptions.deadline);
    now += options.readCost || 0;
    await options.onRead?.(controls);
    return current;
  };
  return controls;
}

test('operation timings stay within short bounded ranges for boundary and invalid random samples', () => {
  for (const sample of [-10, 0, 0.1, 0.5, 0.9, 1, 10, NaN, Infinity]) {
    const pattern = operationPattern(() => sample);
    assert.ok(Number.isInteger(pattern.beforeSelectionMs));
    assert.ok(Number.isInteger(pattern.afterSelectionMs));
    assert.ok(pattern.beforeSelectionMs >= 80 && pattern.beforeSelectionMs <= 220);
    assert.ok(pattern.afterSelectionMs >= 60 && pattern.afterSelectionMs <= 150);
  }
  assert.notDeepEqual(operationPattern(() => 0), operationPattern(() => 1));
});

test('varied click coordinates remain inside each target and match across the whole mouse sequence', async () => {
  const samples = [0, 1];
  const controls = fixture({ random: () => samples.shift() ?? 0.5 });
  // Exercise clickTarget directly so the samples describe position, not pause timing.
  controls.adapter.clickTarget(controls.source, true);
  const sequence = controls.events;
  assert.deepEqual(sequence.map(event => event.type), ['mousedown', 'mouseup', 'click']);
  const [first] = sequence;
  assert.ok(first.clientX > 100 && first.clientX < 140);
  assert.ok(first.clientY > 300 && first.clientY < 340);
  assert.notEqual(first.clientX, 120);
  assert.notEqual(first.clientY, 320);
  for (const event of sequence) {
    assert.equal(event.clientX, first.clientX);
    assert.equal(event.clientY, first.clientY);
    assert.equal(event.button, 0);
    assert.equal(event.buttons, event.type === 'mousedown' ? 1 : 0);
  }
});

test('a modal covering a varied click prevents every mouse event', () => {
  const controls = fixture();
  controls.adapter.document.elementFromPoint = () => ({ name: 'modal' });
  assert.throws(() => controls.adapter.clickTarget(controls.source, true), /遮挡/);
  assert.equal(controls.events.length, 0);
});

test('cancelling during the initial randomized pause prevents the first piece click', async () => {
  const controls = fixture({ onWait: state => state.cancel() });
  await assert.rejects(controls.adapter.play(MOVE, controls.initial, {
    varyOperations: true, deadline: 1000, isCancelled: controls.isCancelled,
  }), /取消/);
  assert.ok(controls.waits.length > 0);
  assert.equal(controls.events.length, 0);
  assert.equal(controls.destinations, 0);
});

test('a game change during the initial randomized pause stops before selection', async () => {
  const controls = fixture({ onWait: state => state.changeGame() });
  await assert.rejects(controls.adapter.play(MOVE, controls.initial, {
    varyOperations: true, deadline: 1000,
  }), { code: 'XQ_CONTEXT_CHANGED', actionStage: 'before-selection' });
  assert.equal(controls.reads, 2);
  assert.equal(controls.events.length, 0);
});

test('an overdue randomized pause cannot create a fresh action deadline', async () => {
  const controls = fixture({ onWait: state => state.advance(1000) });
  await assert.rejects(controls.adapter.play(MOVE, controls.initial, {
    varyOperations: true, deadline: 600,
  }), /超时/);
  assert.equal(controls.events.length, 0);
  assert.ok(controls.readDeadlines.every(deadline => deadline <= 600));
});

test('short remaining budgets reduce optional pauses and still confirm the original move', async () => {
  const controls = fixture({ random: () => 1, readCost: 20 });
  const after = await controls.adapter.play(MOVE, controls.initial, { varyOperations: true, deadline: 500 });
  assert.equal(after.moveCount, 1);
  assert.equal(controls.destinations, 1);
  assert.ok(controls.waits.reduce((total, value) => total + value, 0) < 370);
  assert.ok(controls.now < 500);
  assert.ok(controls.readDeadlines.slice(0, 3).every(deadline => deadline <= 500));
  assert.ok(controls.inputTimes.every(time => time < 500));
});

test('a normal varied operation selects once, clicks one destination, and reads confirmation', async () => {
  const controls = fixture({ random: () => 0 });
  const after = await controls.adapter.play(MOVE, controls.initial, { varyOperations: true, deadline: 2000 });
  assert.equal(after.moveCount, 1);
  assert.deepEqual(controls.events.filter(event => event.type === 'click').map(event => event.element), ['source', 'destination']);
  assert.equal(controls.destinations, 1);
  assert.equal(controls.reads, 4);
  assert.equal(controls.waits.length, 2);
});

test('cancelling in the selection pause keeps the destination untouched', async () => {
  const controls = fixture({ onWait: state => { if (state.waits.length === 2) state.cancel(); } });
  await assert.rejects(controls.adapter.play(MOVE, controls.initial, {
    varyOperations: true, deadline: 2000, isCancelled: controls.isCancelled,
  }), /取消/);
  assert.deepEqual(controls.events.filter(event => event.type === 'click').map(event => event.element), ['source']);
  assert.equal(controls.destinations, 0);
});

test('missing confirmation waits read-only past the input deadline until cancelled and never repeats the destination', async () => {
  const controls = fixture({ confirm: false, random: () => 1, readCost: 5,
    onWait: state => { if (state.now >= 2400) state.cancel(); } });
  await assert.rejects(controls.adapter.play(MOVE, controls.initial, {
    varyOperations: true, deadline: 800, isCancelled: controls.isCancelled,
  }), { code: 'XQ_CANCELLED', actionStage: 'destination-dispatched' });
  assert.equal(controls.destinations, 1);
  assert.ok(controls.readDeadlines.slice(0, 3).every(deadline => deadline <= 800));
  assert.ok(controls.readDeadlines.some(deadline => deadline > 800));
  assert.ok(controls.inputTimes.every(time => time < 800));
  assert.ok(controls.now >= 2400);
});

test('disabling variation uses centered clicks and the original selection interval', async () => {
  const controls = fixture({ random: () => { throw new Error('Randomness should not be used'); } });
  const after = await controls.adapter.play(MOVE, controls.initial, { varyOperations: false, deadline: 1000 });
  assert.equal(after.moveCount, 1);
  assert.deepEqual(controls.waits, [30]);
  const clicks = controls.events.filter(event => event.type === 'click');
  assert.deepEqual(clicks.map(event => [event.clientX, event.clientY]), [[120, 320], [240, 320]]);
  assert.equal(controls.destinations, 1);
});
