(() => {
  'use strict';
  const previous = globalThis.__xiangqiQuickHands;
  try { if (previous?.isAlive?.()) return; } catch {}
  try { previous?.destroy?.(); } catch {}
  document.getElementById?.('xq-quick-hands')?.remove();
  const extensionId = chrome.runtime.id;
  const resourceBase = chrome.runtime.getURL('');
  const adapter = new globalThis.XiangqiSiteAdapter({ delay: waitForPageTask });
  const host = document.createElement('div');
  host.id = 'xq-quick-hands';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
  const root = host.attachShadow({ mode: 'open' });
  const icon = (name, label) => `<img src="${resourceBase}icons/${name}.svg" width="17" height="17" alt="" aria-hidden="true">${label || ''}`;
  root.innerHTML = `<style>
    :host{all:initial;font-family:"Microsoft YaHei",system-ui,sans-serif;color:#202629;font-size:16px;letter-spacing:0;color-scheme:light}:host(.hidden){display:none!important}
    *{box-sizing:border-box}button,select{font:inherit;letter-spacing:0}button{cursor:pointer}button:disabled{cursor:default;opacity:.45}
    .panel{position:relative;display:flex;flex-direction:column;width:360px;height:auto;background:#fff;border:1px solid #d2d9d6;border-radius:8px;box-shadow:0 6px 28px #162a2326;overflow:hidden}
    header{height:52px;flex:none;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #e7eae8;background:#f7f9f8;cursor:move;touch-action:none;user-select:none}
    #body{min-height:0;overflow:auto;flex:1}.panel[data-interacting]{user-select:none}
    .resize-handle{position:absolute;z-index:2;touch-action:none;user-select:none}
    [data-resize=n],[data-resize=s]{height:8px;left:14px;right:14px;cursor:ns-resize}[data-resize=n]{top:0}[data-resize=s]{bottom:0}
    [data-resize=e],[data-resize=w]{width:8px;top:14px;bottom:14px;cursor:ew-resize}[data-resize=e]{right:0}[data-resize=w]{left:0}
    [data-resize=ne],[data-resize=nw],[data-resize=se],[data-resize=sw]{width:14px;height:14px}
    [data-resize=ne],[data-resize=sw]{cursor:nesw-resize}[data-resize=nw],[data-resize=se]{cursor:nwse-resize}
    [data-resize=ne]{top:0;right:0}[data-resize=nw]{top:0;left:0}[data-resize=se]{bottom:0;right:0}[data-resize=sw]{bottom:0;left:0}
    [data-resize=se]::after{content:"";position:absolute;right:3px;bottom:3px;width:8px;height:8px;background:repeating-linear-gradient(135deg,transparent 0 2px,#96a69d 2px 3px)}
    .panel[data-collapsed=true] .resize-handle{display:none}
    .brand{width:28px;height:28px;flex:none;border-radius:50%;background:#b3292d;color:#fff;display:grid;place-items:center;font-size:19px;font-weight:700}
    strong{font-size:17px;font-weight:700;flex:1;min-width:0;white-space:nowrap}.icon{width:30px;height:30px;flex:none;display:grid;place-items:center;border:0;background:transparent;border-radius:4px}
    .scale-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;color:#485d51;font-size:14px}
    .scale-tools div{display:flex;align-items:center;gap:6px}.scale-button{min-width:34px;min-height:30px;padding:2px 7px;border:1px solid #bdccc3;border-radius:4px;background:#f6f8f7;color:#243c2e;font-weight:700}.scale-tools output{min-width:42px;text-align:center;font-variant-numeric:tabular-nums}
    .variation{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;color:#485d51;margin-bottom:12px}.variation input{width:17px;height:17px;accent-color:#176d4d;margin:0}
    .pause-request{flex:none;padding:10px 12px;background:#fff5df;border-bottom:1px solid #e6c891;color:#674b20;font-size:14px}.pause-request p{margin:0 0 8px;line-height:1.5}.pause-request div{display:flex;gap:8px}.pause-request button{flex:1;min-height:34px;border:1px solid #d7b7a5;border-radius:4px;background:#fff;color:#583d2b}.pause-request #pause-confirm{background:#a52b32;color:#fff;border-color:#a52b32}.stop-reason{margin-top:10px;padding:8px;border:1px solid #e2c6bc;border-radius:4px;background:#fff5f1;color:#70402e;font-size:14px;overflow-wrap:anywhere}
    .icon:hover{background:#e6eeea}img{display:inline-block;flex:none}main{padding:12px} .state{display:flex;align-items:center;gap:7px;min-height:24px}
    .dot{width:7px;height:7px;flex:none;border-radius:50%;background:#8a9690}.dot[data-kind=ready]{background:#19845d}.dot[data-kind=busy]{background:#c57b12}.dot[data-kind=error]{background:#ba3137}
    #status{flex:1;line-height:1.6;overflow-wrap:anywhere}.engine{color:#58665e;font-size:14px;margin:3px 0 14px 14px;overflow-wrap:anywhere}
    .settings{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;color:#5c6862}select{max-width:155px;padding:5px 6px;border:1px solid #d5ddd8;border-radius:4px;background:white;color:#263a30}
    input[type=range]{width:112px;min-width:40px;flex:1;accent-color:#176d4d;margin:0}#balance-label{font-size:14px;min-width:64px;text-align:right}.importance{display:flex;align-items:center;justify-content:space-between;font-size:14px;color:#58665e;margin-top:9px;gap:8px}
    .actions{display:grid;grid-template-columns:1.35fr 1fr;gap:8px} .command{display:flex;align-items:center;justify-content:center;gap:6px;min-height:40px;border:1px solid #ccd7d0;border-radius:5px;background:#f6f8f7;color:#253c2e;font-weight:600}
    .primary{background:#176d4d;color:white;border-color:#176d4d}.primary img{filter:brightness(0) invert(1)}.primary.running{background:#a52b32;border-color:#a52b32}
    .result{margin-top:14px;border-top:1px solid #e7eae8;padding-top:11px;display:flex;justify-content:space-between;align-items:center;gap:8px}.move{font-family:Consolas,monospace;font-size:23px;font-weight:600;color:#224b38;white-space:nowrap}
    #side{font-size:14px;color:#58665e}.metrics{display:flex;flex-wrap:wrap;justify-content:space-between;color:#58665e;font-size:14px;gap:5px;margin-top:7px;font-variant-numeric:tabular-nums}.score-meaning{font-size:14px;line-height:1.6;color:#58665e;margin-top:4px;overflow-wrap:anywhere}.pv{color:#58665e;font-family:Consolas,monospace;font-size:14px;line-height:1.6;overflow-wrap:anywhere;margin-top:9px;max-height:5em;overflow:auto}
    .evaluation-history{margin-top:12px;border-top:1px solid #e7eae8;padding-top:10px}.evaluation-heading{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:14px}.evaluation-heading b{font-size:15px;color:#263a30}.evaluation-heading span{color:#58665e;font-variant-numeric:tabular-nums}
    .evaluation-plot{position:relative;margin-top:6px;border:1px solid #e0e7e2;border-radius:5px;overflow:hidden;background:#fafcfb}#evaluation-chart{display:block;width:100%;height:auto;overflow:visible;font-family:inherit;font-size:12px;color:#58665e;touch-action:pan-y}.evaluation-grid{stroke:#dce4de;stroke-width:1}.evaluation-zero{stroke:#9baea1;stroke-dasharray:3 3}.evaluation-axis{fill:#58665e}.evaluation-line{fill:none;stroke:#176d4d;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}.evaluation-point{fill:#176d4d;stroke:#fff;stroke-width:1.2;cursor:crosshair}.evaluation-point[data-mate=true]{fill:#ad393d}.evaluation-point:focus{outline:none;stroke:#263a30;stroke-width:2}.evaluation-hit{fill:transparent;pointer-events:all;cursor:crosshair}#evaluation-cursor{stroke:#7d9486;stroke-width:1;stroke-dasharray:3 3;pointer-events:none}#evaluation-active{fill:#fff;stroke:#176d4d;stroke-width:2;pointer-events:none}
    #evaluation-empty{position:absolute;inset:0;display:grid;place-items:center;font-size:14px;color:#63756a;pointer-events:none}#evaluation-tooltip{min-height:22px;margin-top:5px;font-size:13px;line-height:1.6;color:#485d51;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.evaluation-legend{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 8px;font-size:12px;color:#63756a}
    footer{display:flex;flex-wrap:wrap;gap:5px;align-items:center;justify-content:space-between;padding:9px 16px 9px 12px;background:#f7f9f8;border-top:1px solid #e7eae8;color:#58665e;font-size:14px}
    .hidden{display:none!important}:focus-visible{outline:2px solid #158a60;outline-offset:2px}
  </style><section id="panel" class="panel" aria-label="象棋快手控制台">
  <header id="panel-header" title="拖动标题栏移动；拖动边缘或四角同步放大文字与按钮；双击标题栏恢复默认"><span class="brand">帥</span><strong id="panel-title">象棋快手</strong><button id="quick-stop" class="icon hidden" title="申请暂停（需确认）" aria-label="申请暂停（需确认）">${icon('pause')}</button><button id="reconnect" class="icon" title="重新连接引擎" aria-label="重新连接引擎">${icon('refresh-cw')}</button><button id="collapse" class="icon" title="收起控制台" aria-label="收起控制台">${icon('minus')}</button></header>
  <div id="pause-request" class="pause-request hidden" role="group" aria-label="暂停确认"><p>确认暂停本局自动行棋？</p><div><button id="pause-confirm">确认暂停</button><button id="pause-cancel">继续运行</button></div></div>
  <div id="body"><main><div class="scale-tools"><span>界面大小</span><div><button id="scale-down" class="scale-button" title="缩小文字和按钮" aria-label="缩小文字和按钮">A−</button><output id="scale-label">100%</output><button id="scale-up" class="scale-button" title="放大文字和按钮" aria-label="放大文字和按钮">A+</button></div></div><div class="state"><span class="dot" id="dot"></span><span id="status" role="status" aria-live="polite">等待棋盘</span></div><div class="engine" id="engine-name">Pikafish · 本地引擎</div>
  <label class="settings" title="运行中可更改，从下一步生效">搜索模式<select id="mode" aria-label="搜索模式"><option value="adaptive" selected>自适应</option><option value="fixed">固定时限</option></select></label>
  <label class="settings" id="balance-row" title="运行中可拖动，从下一步生效">决策偏好<input id="balance" type="range" aria-label="决策偏好" min="0" max="1" step="0.05" value="0.65"><output id="balance-label">稳健 65%</output></label>
  <label class="settings" title="运行中可更改，从下一步生效">最长计算<select id="budget" aria-label="最长计算"><option value="800">0.8 秒</option><option value="1800">1.8 秒</option><option value="2800">2.8 秒</option><option value="3500" selected>3.5 秒</option></select></label>
  <label class="variation" title="随机短暂停顿和点击位置变化；可随时切换，从下一步生效"><input id="vary-operations" type="checkbox" checked>反侦查辅助（操作变化）</label>
  <div class="actions"><button id="auto" class="command primary" disabled>${icon('play','开始自动')}</button><button id="single" class="command" disabled>${icon('step-forward','走一步')}</button></div>
  <div class="result"><output id="move" class="move">-</output><span id="side">-</span></div><div class="metrics"><span id="depth">深度 -</span><span id="score">评估 -</span><span id="elapsed">耗时 -</span></div>
  <div id="score-meaning" class="score-meaning">暂无有效评估</div>
  <section class="evaluation-history" aria-label="本局评估走势"><div class="evaluation-heading"><b>本局评估走势</b><span id="evaluation-summary">已记录 0 个局面</span></div>
  <div class="evaluation-plot"><svg id="evaluation-chart" viewBox="0 0 332 154" role="group" aria-label="本局评估曲线，横轴为手数，纵轴为评估，范围负1到正1">
  <path class="evaluation-grid" d="M32,14H320 M32,72H320 M32,130H320"/><path class="evaluation-grid evaluation-zero" d="M32,72H320"/>
  <g class="evaluation-axis"><text x="25" y="18" text-anchor="end">+1</text><text x="25" y="76" text-anchor="end">0</text><text x="25" y="134" text-anchor="end">−1</text><text id="evaluation-x-start" x="32" y="147">0</text><text id="evaluation-x-middle" x="176" y="147" text-anchor="middle">5</text><text id="evaluation-x-end" x="320" y="147" text-anchor="end">10 手</text></g>
  <rect x="32" y="14" width="288" height="58" fill="#176d4d" fill-opacity=".025"/><rect x="32" y="72" width="288" height="58" fill="#ad393d" fill-opacity=".025"/>
  <path id="evaluation-line" class="evaluation-line" d=""/><g id="evaluation-points"></g><path id="evaluation-cursor" class="hidden" d=""/><circle id="evaluation-active" class="hidden" r="4"/>
  </svg><div id="evaluation-empty">等待首个评估</div></div><div id="evaluation-tooltip">每次有效计算记录一个点</div><div class="evaluation-legend"><span id="evaluation-viewpoint">我的视角 · 正值我优 / 负值对方优</span><span>新局自动清零</span></div></section>
  <div class="importance"><span id="importance">重要性 -</span><span id="allocated">预算 -</span></div><div id="pv" class="pv"></div>
  <div id="stop-reason" class="stop-reason hidden" role="status"></div>
  </main><footer><span id="footer">最多 5 秒 · 至少 6 层</span><span id="plies">第 0 手</span></footer></div>
  ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(direction => `<span class="resize-handle" data-resize="${direction}" aria-hidden="true"></span>`).join('')}</section>`;
  document.documentElement.append(host);
  const $ = id => root.getElementById(id);
  $('panel-title').textContent = `象棋快手 v${chrome.runtime.getManifest().version}`;
  const evaluationKnots = [0, 0.635148952387, 0.978026114739, 0.999753210848, 0.999999969540, 1];
  const evaluationTargets = [0, 0.5, 0.7, 0.9, 0.99, 1];
  const evaluationSegments = (() => {
    const h = evaluationKnots.slice(1).map((x, i) => x - evaluationKnots[i]);
    const delta = h.map((width, i) => (evaluationTargets[i + 1] - evaluationTargets[i]) / width);
    const edge = (h0, h1, d0, d1) => {
      const slope = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(slope) !== Math.sign(d0)) return 0;
      return Math.sign(d0) !== Math.sign(d1) && Math.abs(slope) > 3 * Math.abs(d0) ? 3 * d0 : slope;
    };
    const slopes = [edge(h[0], h[1], delta[0], delta[1])];
    for (let i = 1; i < evaluationKnots.length - 1; i++) {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      slopes.push(delta[i - 1] * delta[i] <= 0 ? 0 : (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]));
    }
    const last = h.length - 1;
    slopes.push(edge(h[last], h[last - 1], delta[last], delta[last - 1]));
    return h.map((width, i) => {
      const start = evaluationTargets[i], end = evaluationTargets[i + 1];
      return { width, A: 2 * start - 2 * end + width * (slopes[i] + slopes[i + 1]),
        B: -3 * start + 3 * end - width * (2 * slopes[i] + slopes[i + 1]), C: width * slopes[i], D: start };
    });
  })();
  function interpolateEvaluation(value) {
    if (!Number.isFinite(value)) return NaN;
    const magnitude = Math.min(1, Math.abs(value));
    if (magnitude === 0) return 0;
    if (magnitude === 1) return Math.sign(value);
    let i = 0;
    while (magnitude > evaluationKnots[i + 1]) i++;
    const segment = evaluationSegments[i], t = (magnitude - evaluationKnots[i]) / segment.width;
    const result = ((segment.A * t + segment.B) * t + segment.C) * t + segment.D;
    return Math.sign(value) * result;
  }
  function normalizedEvaluation(score) {
    if (score?.type !== 'cp' || !Number.isFinite(score.value)) return null;
    const index = Math.max(-0.999999, Math.min(0.999999, interpolateEvaluation(Math.tanh(score.value * 0.015))));
    const rounded = Number(index.toFixed(6));
    return rounded === 0 ? 0 : rounded;
  }
  function setEvaluation(score) {
    const description = '评估范围 −1～+1，保留六位小数；正值有利，负值不利。按本次计算的行棋方判断。';
    $('score').title = description;
    if (!score || !Number.isFinite(score.value) || !['cp', 'mate'].includes(score.type)) {
      $('score').textContent = '评估 -';
      $('score-meaning').textContent = '暂无有效评估';
      return;
    }
    if (score.type === 'mate') {
      $('score').textContent = `杀棋 ${score.value}`;
      $('score-meaning').textContent = score.value > 0 ? '引擎发现强制杀棋' : score.value < 0 ? '引擎发现对方强制杀棋' : '引擎报告终局杀棋';
      return;
    }
    // Interpolate the unrounded v2.6.0 value: its displayed six decimals lose
    // information near the final anchors. Clamp only after interpolation.
    const rounded = normalizedEvaluation(score);
    $('score').textContent = `评估 ${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(6)}`;
    const magnitude = Math.abs(rounded);
    const positive = score.value > 0;
    $('score-meaning').textContent = magnitude < 0.5 ? '均势' : magnitude < 0.7 ? (positive ? '稍优' : '稍劣') :
      magnitude < 0.9 ? (positive ? '明显优势' : '明显劣势') : magnitude < 0.99 ? (positive ? '大幅优势' : '大幅劣势') :
      (positive ? '接近胜势' : '接近败势');
  }
  setEvaluation(null);
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
  let pauseConfirmationUntil = 0;
  let pauseConfirmationTimer = null;
  let retryAfter = 0;
  let tickTimer = null;
  let tickRunning = false;
  let backgroundSubscribed = false;
  let backgroundRenewAt = 0;
  let backgroundSubscriptionRequest = 0;
  const backgroundSessionId = crypto.randomUUID();
  const pageWaiters = new Set();
  let observedRoute = location.pathname;
  let observedGameKey = null;
  let syncSince = null;
  let boardReadFailed = false;
  const panel = $('panel');
  const panelHeader = $('panel-header');
  let panelLayout = null;
  let layoutTouched = false;
  let panelInteraction = null;

  let evaluationGameKey = null;
  let evaluationLastPly = null;
  let evaluationPoints = [];
  let evaluationMaxPly = 10;
  let evaluationSide = 'red';
  let evaluationControlled = false;
  let openingEvaluationRetryAt = 0;
  const evaluationChart = $('evaluation-chart');
  const chartX = ply => 32 + 288 * ply / evaluationMaxPly;
  const chartY = value => 72 - 58 * value;
  const chartCoordinate = value => Number(value.toFixed(6));
  const signedEvaluation = value => `${value > 0 ? '+' : ''}${value.toFixed(6)}`;
  const evaluationPerspectiveLabel = () => evaluationControlled ? '我的视角' : '分析视角';
  function evaluationPointLabel(point) {
    const favored = evaluationControlled ? (point.value > 0 ? '我方' : '对方') : (point.value > 0 ? '红方' : '黑方');
    return `第 ${point.ply} 手 · ${evaluationPerspectiveLabel()} ${point.mate ? `${favored}杀棋 ${Math.abs(point.mate)}` : signedEvaluation(point.value)}`;
  }
  function showEvaluationPoint(index) {
    const point = evaluationPoints[index];
    if (!point) return;
    $('evaluation-tooltip').textContent = evaluationPointLabel(point);
    const x = chartCoordinate(chartX(point.ply));
    $('evaluation-cursor').setAttribute('d', `M${x},14V130`);
    $('evaluation-active').setAttribute('cx', x);
    $('evaluation-active').setAttribute('cy', chartCoordinate(chartY(point.value)));
    $('evaluation-cursor').classList.remove('hidden');
    $('evaluation-active').classList.remove('hidden');
  }
  function hideEvaluationPoint() {
    $('evaluation-cursor').classList.add('hidden');
    $('evaluation-active').classList.add('hidden');
    $('evaluation-tooltip').textContent = evaluationPoints.length ? evaluationPointLabel(evaluationPoints[evaluationPoints.length - 1]) : '每次有效计算记录一个点';
  }
  // PCHIP in actual ply coordinates: C1 joins without overshooting adjacent samples.
  function evaluationCurvePath(points) {
    if (!points.length) return '';
    const xy = point => `${chartCoordinate(chartX(point.ply))},${chartCoordinate(chartY(point.value))}`;
    let path = `M${xy(points[0])}`;
    if (points.length === 1) return path;
    const h = points.slice(1).map((point, i) => point.ply - points[i].ply);
    const delta = h.map((width, i) => (points[i + 1].value - points[i].value) / width);
    const slopes = new Array(points.length).fill(0);
    const edge = (h0, h1, d0, d1) => {
      const slope = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(slope) !== Math.sign(d0)) return 0;
      return Math.sign(d0) !== Math.sign(d1) && Math.abs(slope) > 3 * Math.abs(d0) ? 3 * d0 : slope;
    };
    if (points.length === 2) slopes.fill(delta[0]);
    else {
      slopes[0] = edge(h[0], h[1], delta[0], delta[1]);
      for (let i = 1; i < points.length - 1; i++) {
        if (delta[i - 1] * delta[i] <= 0) continue;
        const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
        slopes[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
      }
      const last = h.length - 1;
      slopes[points.length - 1] = edge(h[last], h[last - 1], delta[last], delta[last - 1]);
    }
    for (let i = 0; i < h.length; i++) {
      const first = { ply: points[i].ply + h[i] / 3, value: points[i].value + h[i] * slopes[i] / 3 };
      const second = { ply: points[i + 1].ply - h[i] / 3, value: points[i + 1].value - h[i] * slopes[i + 1] / 3 };
      path += ` C${xy(first)} ${xy(second)} ${xy(points[i + 1])}`;
    }
    return path;
  }
  function renderEvaluationHistory() {
    const last = evaluationPoints[evaluationPoints.length - 1];
    const maximum = Math.max(10, last?.ply || 0);
    const step = maximum <= 20 ? 5 : maximum <= 100 ? 10 : maximum <= 200 ? 25 : 50;
    evaluationMaxPly = Math.ceil(maximum / step) * step;
    $('evaluation-x-middle').textContent = String(evaluationMaxPly / 2);
    $('evaluation-x-end').textContent = `${evaluationMaxPly} 手`;
    $('evaluation-line').setAttribute('d', evaluationCurvePath(evaluationPoints));
    $('evaluation-points').innerHTML = evaluationPoints.map(point => {
      const label = evaluationPointLabel(point);
      return `<circle class="evaluation-point" cx="${chartCoordinate(chartX(point.ply))}" cy="${chartCoordinate(chartY(point.value))}" r="${point.mate ? 3.3 : 2.5}" tabindex="0" role="img" data-ply="${point.ply}" data-value="${point.value}" data-mate="${Boolean(point.mate)}" aria-label="${label}"><title>${label}</title></circle>`;
    }).join('');
    $('evaluation-summary').textContent = `已记录 ${evaluationPoints.length} 个局面`;
    evaluationChart.dataset.count = String(evaluationPoints.length);
    evaluationChart.dataset.perspective = evaluationSide;
    evaluationChart.dataset.controlled = String(evaluationControlled);
    evaluationChart.setAttribute('aria-label', `本局评估曲线，${evaluationPerspectiveLabel()}，横轴为手数，纵轴范围负1到正1`);
    $('evaluation-viewpoint').textContent = evaluationControlled ? '我的视角 · 正值我优 / 负值对方优' : '分析视角';
    $('evaluation-empty').classList.toggle('hidden', evaluationPoints.length > 0);
    hideEvaluationPoint();
  }
  function clearEvaluationHistory() {
    evaluationGameKey = null;
    evaluationLastPly = null;
    evaluationPoints = [];
    evaluationSide = 'red';
    evaluationControlled = false;
    openingEvaluationRetryAt = 0;
    renderEvaluationHistory();
  }
  function observeEvaluationGame(snapshot) {
    if (snapshot.historyMode || snapshot.loading || snapshot.hasPreMove || snapshot.connected === false) return;
    // Analysis snapshots use their current FEN as initFen, so their gameKey changes on each move.
    const key = snapshot.mode === 'analysis' ? `analysis:${location.pathname}` : snapshot.gameKey;
    if (!key || !Number.isSafeInteger(snapshot.moveCount) || snapshot.moveCount < 0) return;
    // A player using black may first see the new opening after red has already moved.
    const restarted = evaluationGameKey === key && snapshot.moveCount <= 1 && evaluationLastPly > snapshot.moveCount && snapshot.active;
    if (restarted) lastPlayed = null;
    if (evaluationGameKey !== key || restarted) clearEvaluationHistory();
    evaluationGameKey = key;
    evaluationLastPly = snapshot.moveCount;
    const controlled = snapshot.participant === true && ['red', 'black'].includes(snapshot.playerSide);
    const side = controlled ? snapshot.playerSide : 'red';
    if (evaluationSide !== side || evaluationControlled !== controlled) {
      if (evaluationSide !== side) evaluationPoints = evaluationPoints.map(point => ({ ...point, value: point.value === 0 ? 0 : -point.value }));
      evaluationSide = side;
      evaluationControlled = controlled;
      renderEvaluationHistory();
    }
  }
  function recordEvaluation(score, snapshot) {
    if (snapshot.historyMode || !['red', 'black'].includes(snapshot.turn) || !Number.isSafeInteger(snapshot.moveCount) || snapshot.moveCount < 0) return;
    const mate = score?.type === 'mate' && Number.isFinite(score.value) ? score.value : 0;
    const normalized = normalizedEvaluation(score);
    if (normalized === null && mate === 0) return;
    const value = (mate ? Math.sign(mate) : normalized) * (snapshot.turn === evaluationSide ? 1 : -1);
    evaluationPoints = evaluationPoints.filter(point => point.ply !== snapshot.moveCount);
    evaluationPoints.push({ ply: snapshot.moveCount, value: value === 0 ? 0 : value, mate });
    evaluationPoints.sort((a, b) => a.ply - b.ply);
    renderEvaluationHistory();
  }
  evaluationChart.onpointermove = event => {
    if (!evaluationPoints.length) return;
    const rect = evaluationChart.getBoundingClientRect();
    const ply = ((event.clientX - rect.left) * 332 / rect.width - 32) * evaluationMaxPly / 288;
    let nearest = 0;
    for (let i = 1; i < evaluationPoints.length; i++) {
      if (Math.abs(evaluationPoints[i].ply - ply) < Math.abs(evaluationPoints[nearest].ply - ply)) nearest = i;
    }
    showEvaluationPoint(nearest);
  };
  evaluationChart.onpointerleave = hideEvaluationPoint;
  function onEvaluationFocus(event) {
    const point = event.target.closest?.('[data-ply]');
    if (point) showEvaluationPoint(evaluationPoints.findIndex(sample => sample.ply === Number(point.dataset.ply)));
  }
  evaluationChart.addEventListener('focusin', onEvaluationFocus);
  evaluationChart.addEventListener('focusout', hideEvaluationPoint);
  renderEvaluationHistory();

  const PANEL_WIDTH = 360;
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  function panelBounds() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const margin = Math.min(12, (width - 1) / 2, (height - 1) / 2);
    return { width, height, margin, maxScale: Math.min(2.5, (width - 2 * margin) / PANEL_WIDTH) };
  }
  function applyPanelLayout(layout) {
    const bounds = panelBounds();
    const requestedScale = clamp(Number.isFinite(layout.scale) ? layout.scale : 1, 0.8, 2.5);
    const scale = Math.min(requestedScale, bounds.maxScale);
    Object.assign(panel.style, { zoom: String(scale), width: `${PANEL_WIDTH}px`, height: 'auto',
      maxWidth: 'none', maxHeight: `${(bounds.height - 2 * bounds.margin) / scale}px` });
    const rect = panel.getBoundingClientRect();
    panelLayout = {
      scale: requestedScale, width: rect.width, height: rect.height,
      left: clamp(layout.left, bounds.margin, bounds.width - rect.width - bounds.margin),
      top: clamp(layout.top, bounds.margin, bounds.height - rect.height - bounds.margin),
    };
    Object.assign(host.style, { left: `${panelLayout.left}px`, top: `${panelLayout.top}px`, right: 'auto', bottom: 'auto' });
    $('scale-label').textContent = `${Math.round(scale * 100)}%`;
    $('scale-down').disabled = destroyed || scale <= Math.min(0.8, bounds.maxScale) + 0.001;
    $('scale-up').disabled = destroyed || scale >= bounds.maxScale - 0.001;
  }
  function restorePanelLayout(saved) {
    if (!saved || !['left', 'top'].every(key => Number.isFinite(saved[key]))) return;
    // Old releases saved an arbitrary box height. Only its width migrates to a scale.
    const scale = Number.isFinite(saved.scale) && saved.scale > 0 ? saved.scale :
      Number.isFinite(saved.width) && saved.width > 0 ? Math.max(1, saved.width / PANEL_WIDTH) : null;
    if (scale !== null) applyPanelLayout({ ...saved, scale });
  }
  function resetPanelLayout() {
    layoutTouched = true;
    const bounds = panelBounds();
    applyPanelLayout({ scale: 1, left: bounds.width, top: bounds.height });
    applyPanelLayout({ ...panelLayout, left: bounds.width - panelLayout.width - 16, top: bounds.height - panelLayout.height - 16 });
    persist({ panelLayout: { ...panelLayout } });
  }
  function changePanelScale(change) {
    if (destroyed) return;
    layoutTouched = true;
    const currentScale = Math.min(panelLayout.scale, panelBounds().maxScale);
    applyPanelLayout({ ...panelLayout, scale: Math.round((currentScale + change) * 10) / 10 });
    persist({ panelLayout: { ...panelLayout } });
  }
  function startPanelInteraction(event, direction = '') {
    if (destroyed || panelInteraction || event.button !== 0 || (direction && $('body').classList.contains('hidden'))) return;
    layoutTouched = true;
    const capture = direction ? event.target : panelHeader;
    panelInteraction = { pointerId: event.pointerId, capture, x: event.clientX, y: event.clientY, direction,
      layout: { ...panelLayout, scale: Math.min(panelLayout.scale, panelBounds().maxScale) } };
    panel.dataset.interacting = direction ? 'resize' : 'move';
    capture.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function movePanelInteraction(event) {
    const interaction = panelInteraction;
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const original = interaction.layout;
    const dx = event.clientX - interaction.x, dy = event.clientY - interaction.y;
    if (!interaction.direction) {
      applyPanelLayout({ ...original, left: original.left + dx, top: original.top + dy });
    } else {
      const bounds = panelBounds(), direction = interaction.direction;
      const horizontal = direction.includes('e') || direction.includes('w');
      const vertical = direction.includes('s') || direction.includes('n');
      const widthChange = horizontal ? (direction.includes('w') ? -dx : dx) / original.width : 0;
      const heightChange = vertical ? (direction.includes('n') ? -dy : dy) / original.height : 0;
      const change = !horizontal ? heightChange : !vertical ? widthChange :
        Math.abs(widthChange) >= Math.abs(heightChange) ? widthChange : heightChange;
      const scale = Math.min(clamp(original.scale * (1 + change), 0.8, 2.5), bounds.maxScale);
      applyPanelLayout({ ...original, scale });
      applyPanelLayout({ ...panelLayout,
        left: direction.includes('w') ? original.left + original.width - panelLayout.width : original.left,
        top: direction.includes('n') ? original.top + original.height - panelLayout.height : original.top });
    }
    event.preventDefault();
  }
  function finishPanelInteraction(event) {
    if (!panelInteraction || (event && event.pointerId !== panelInteraction.pointerId)) return;
    const { pointerId, capture } = panelInteraction;
    panelInteraction = null;
    delete panel.dataset.interacting;
    if (capture.hasPointerCapture(pointerId)) capture.releasePointerCapture(pointerId);
    if (!destroyed) persist({ panelLayout: { ...panelLayout } });
  }
  function onPanelViewportResize() {
    finishPanelInteraction();
    applyPanelLayout(panelLayout);
  }
  panel.onpointerdown = event => {
    const direction = event.target?.dataset?.resize;
    if (/^(n|s|e|w|ne|nw|se|sw)$/.test(direction || '')) startPanelInteraction(event, direction);
  };
  panelHeader.onpointerdown = event => {
    if (!event.target.closest('button')) startPanelInteraction(event);
  };
  panelHeader.ondblclick = event => { if (!event.target.closest('button') && !destroyed) resetPanelLayout(); };
  $('scale-down').onclick = () => changePanelScale(-0.1);
  $('scale-up').onclick = () => changePanelScale(0.1);
  panel.onlostpointercapture = finishPanelInteraction;
  window.addEventListener('pointermove', movePanelInteraction);
  window.addEventListener('pointerup', finishPanelInteraction);
  window.addEventListener('pointercancel', finishPanelInteraction);
  window.addEventListener('resize', onPanelViewportResize);
  const initialPanelRect = panel.getBoundingClientRect();
  applyPanelLayout({ scale: 1, left: initialPanelRect.left, top: initialPanelRect.top });
  const panelSizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    if (!destroyed && panelLayout) applyPanelLayout(panelLayout);
  });
  panelSizeObserver?.observe(panel);

  function isContextAlive() {
    try { return !destroyed && chrome.runtime.id === extensionId; } catch { return false; }
  }
  function dispose(removePanel = false) {
    if (!destroyed) {
      updateBackgroundSubscription(false);
      destroyed = true;
      ready = false;
      auto = false;
      busy = false;
      booting = false;
      generation++;
      requestId = null;
      clearTimeout(watchdog);
      closePauseConfirmation();
      clearTimeout(tickTimer);
      for (const waiter of [...pageWaiters]) waiter.finish();
      finishPanelInteraction();
      panelSizeObserver?.disconnect();
      evaluationChart.onpointermove = evaluationChart.onpointerleave = null;
      evaluationChart.removeEventListener('focusin', onEvaluationFocus);
      evaluationChart.removeEventListener('focusout', hideEvaluationPoint);
      $('scale-down').onclick = $('scale-up').onclick = null;
      panel.onpointerdown = panel.onlostpointercapture = panelHeader.onpointerdown = panelHeader.ondblclick = null;
      window.removeEventListener('pointermove', movePanelInteraction);
      window.removeEventListener('pointerup', finishPanelInteraction);
      window.removeEventListener('pointercancel', finishPanelInteraction);
      window.removeEventListener('resize', onPanelViewportResize);
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
  const analysisOnly = snapshot => snapshot?.mode === 'analysis' && snapshot.canAnalyze === true;
  function controls() {
    $('auto').innerHTML = icon(auto ? 'pause' : 'play', auto ? '暂停自动' : '开始自动');
    $('auto').classList.toggle('running', auto);
    $('auto').disabled = destroyed || (!auto && !busy && (!ready || !canPlay(current)));
    $('single').innerHTML = icon('step-forward', analysisOnly(current) ? '分析局面' : '走一步');
    $('single').disabled = !ready || busy || auto || (!analysisOnly(current) && (!canPlay(current) || current.isMyTurnNow === false || current.turn !== current.playerSide));
    $('budget').disabled = destroyed;
    $('mode').disabled = destroyed;
    $('balance').disabled = destroyed;
    $('vary-operations').disabled = destroyed;
    $('reconnect').disabled = booting || auto || busy;
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
  function updateBackgroundSubscription(active = auto || busy) {
    if (backgroundSubscribed === active && (!active || performance.now() < backgroundRenewAt)) return;
    const request = ++backgroundSubscriptionRequest;
    backgroundSubscribed = active;
    backgroundRenewAt = performance.now() + 2000;
    if (!isContextAlive()) return;
    void rpc('XQ_BACKGROUND', { active, sessionId: backgroundSessionId }).then(response => {
      if (request === backgroundSubscriptionRequest && active && response.active === false) backgroundSubscribed = false;
    }).catch(() => {
      if (request === backgroundSubscriptionRequest && active) backgroundSubscribed = false;
    });
  }
  // Offscreen pulses also finish short waits when hidden-page timers are throttled.
  function waitForPageTask(milliseconds) {
    return new Promise(resolve => {
      const waiter = { at: performance.now() + milliseconds, timer: null, finish() {
        clearTimeout(waiter.timer);
        pageWaiters.delete(waiter);
        resolve();
      } };
      pageWaiters.add(waiter);
      waiter.timer = setTimeout(waiter.finish, milliseconds);
    });
  }
  function flushPageTasks() {
    for (const waiter of [...pageWaiters]) if (performance.now() >= waiter.at) waiter.finish();
  }
  function closePauseConfirmation() {
    pauseConfirmationUntil = 0;
    clearTimeout(pauseConfirmationTimer);
    pauseConfirmationTimer = null;
    $('pause-request').classList.add('hidden');
  }
  function requestPause() {
    if (!isContextAlive()) { invalidateContext(); return; }
    if (!auto && !busy) return;
    // Repeated clicks on the original button never count as confirmation.
    if (pauseConfirmationUntil > performance.now()) return;
    pauseConfirmationUntil = performance.now() + 8000;
    $('pause-request').classList.remove('hidden');
    pauseConfirmationTimer = setTimeout(closePauseConfirmation, 8000);
    applyPanelLayout(panelLayout);
  }
  function retryAutomatically(error, delay = 600) {
    if (!auto || destroyed || !onBoard() || error?.actionStage === 'destination-dispatched') return false;
    const recoverable = ['XQ_STATE_SYNC', 'XQ_READ_TIMEOUT', 'XQ_BOARD_NOT_READY', 'XQ_BOARD_OBSCURED', 'XQ_POSITION_CHANGED'];
    if (!recoverable.includes(error?.code)) return false;
    current = null;
    boardReadFailed = true;
    retryAfter = performance.now() + delay;
    const recoveryText = `${error.message}，等待恢复后继续`;
    if (busy) stop(recoveryText, 'busy', true);
    status(recoveryText, 'busy');
    controls();
    return true;
  }
  function stop(text, kind = 'ready', preserveAuto = false) {
    if (destroyed) return;
    if (!isContextAlive()) { invalidateContext(); return; }
    auto = preserveAuto && auto;
    if (!preserveAuto) closePauseConfirmation();
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
    updateBackgroundSubscription();
    if (text && !preserveAuto) {
      $('stop-reason').textContent = `停止原因：${text}`;
      $('stop-reason').classList.remove('hidden');
    }
    if (text) status(text, kind);
    controls();
  }
  function waitForSync(error) {
    if (error?.code !== 'XQ_STATE_SYNC' || error.actionStage === 'destination-dispatched') return false;
    current = null;
    boardReadFailed = true;
    if (syncSince === null) syncSince = performance.now();
    const syncText = auto ? '等待棋盘同步，恢复后继续' : '等待棋盘同步';
    if (busy) stop(syncText, 'busy', true);
    status(syncText, 'busy');
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
  const puzzleRoute = path => /^\/puzzle\/(?!custom(?:\/|$)|stats(?:\/|$)|record(?:\/|$)|race(?:\/|$))[^/]+(?:\/[PC])?\/?$/.test(path) || /^\/puzzle\/race\/[^/]+\/?$/.test(path);
  const analysisRoute = path => path === '/analysis/board' || /^\/(review|note|lessons|learn|editor|game-database|watch)(?:\/|$)/.test(path);
  const onBoard = () => location.origin === 'https://play.xiangqi.com' &&
    (location.pathname === '/computer-play' || /^\/game\/[^/]+\/?$/.test(location.pathname) || puzzleRoute(location.pathname) || analysisRoute(location.pathname));
  const onSupportedRoute = () => onBoard() || (location.origin === 'https://play.xiangqi.com' && ['/play', '/computer', '/puzzle', '/puzzle/custom', '/puzzle/stats', '/puzzle/record', '/puzzle/race'].includes(location.pathname));

  function needsOpeningEvaluation(snapshot) {
    return snapshot?.participant === true && ['red', 'black'].includes(snapshot.playerSide) &&
      !snapshot.historyMode && snapshot.active && !snapshot.loading && !snapshot.hasPreMove && snapshot.connected !== false &&
      !evaluationPoints.some(point => point.ply === 0) &&
      !(snapshot.moveCount === 0 && snapshot.turn === snapshot.playerSide) &&
      typeof snapshot.initFen === 'string' && /^[rnbakcpheRNBAKCPHE\d/]+ [wb] - - \d+ \d+$/.test(snapshot.initFen) &&
      performance.now() >= openingEvaluationRetryAt;
  }
  async function captureOpeningEvaluation() {
    if (destroyed || busy || !ready || !onBoard() || !needsOpeningEvaluation(current)) return true;
    const snapshot = { ...current }, route = location.pathname, ticket = ++generation;
    busy = true;
    requestId = crypto.randomUUID();
    updateBackgroundSubscription();
    controls();
    status('正在采集开局评估', 'busy');
    watchdog = setTimeout(() => {
      if (ticket !== generation) return;
      openingEvaluationRetryAt = performance.now() + 2000;
      stop('开局评估稍后重试', 'busy', true);
    }, 5000);
    try {
      const result = await rpc('XQ_ANALYZE', { fen: snapshot.initFen, initialFen: snapshot.initFen, moves: [],
        movetime: 650, mode: 'fixed', balance: Number($('balance').value), requestId });
      if (ticket !== generation || location.pathname !== route) return false;
      const latest = await adapter.read();
      if (ticket !== generation || location.pathname !== route) return false;
      if (latest.gameKey !== snapshot.gameKey || latest.initFen !== snapshot.initFen || latest.playerSide !== snapshot.playerSide ||
          latest.participant !== true || latest.historyMode) return false;
      if (!(result.depth >= 6) && !(result.score?.type === 'mate' && result.score.value !== 0)) throw new Error('开局评估尚未完成');
      if (normalizedEvaluation(result.score) === null && !(result.score?.type === 'mate' && Number.isFinite(result.score.value) && result.score.value !== 0)) throw new Error('开局评估暂不可用');
      current = latest;
      observeEvaluationGame(latest);
      recordEvaluation(result.score, { ...snapshot, moveCount: 0, turn: snapshot.initFen.split(' ')[1] === 'b' ? 'black' : 'red' });
      return true;
    } catch (error) {
      if (ticket !== generation || handleContextError(error)) return false;
      openingEvaluationRetryAt = performance.now() + 2000;
      return true;
    } finally {
      if (ticket === generation) {
        clearTimeout(watchdog);
        watchdog = null;
        requestId = null;
        busy = false;
        updateBackgroundSubscription();
        status(auto ? '自动行棋已开启' : '引擎就绪');
        controls();
      }
    }
  }
  async function moveWithOpeningEvaluation() {
    if (!await captureOpeningEvaluation()) return;
    if (current?.turn === current?.playerSide || analysisOnly(current)) await moveOnce();
  }

  async function moveOnce() {
    if (destroyed || busy || !ready || !onBoard() || performance.now() < retryAfter) return;
    if (!isContextAlive()) { invalidateContext(); return; }
    if (window.innerWidth < 700) setCollapsed(true);
    const ticket = ++generation;
    const searchRoute = location.pathname;
    const started = performance.now();
    const varyOperations = $('vary-operations').checked;
    const searchSettings = { mode: $('mode').value, movetime: Number($('budget').value), balance: Number($('balance').value) };
    busy = true;
    updateBackgroundSubscription();
    controls();
    try {
      const snapshot = await adapter.read();
      if (ticket !== generation) return;
      current = snapshot;
      observeEvaluationGame(snapshot);
      const suggestionOnly = analysisOnly(snapshot);
      if (!suggestionOnly && !snapshot.historyMode && snapshot.participant !== false &&
          (snapshot.loading || snapshot.hasPreMove || snapshot.connected === false)) {
        throw Object.assign(new Error('棋盘暂未就绪'), { code: 'XQ_BOARD_NOT_READY', actionStage: 'before-selection' });
      }
      if (!suggestionOnly && (!canPlay(snapshot) || snapshot.isMyTurnNow === false || snapshot.turn !== snapshot.playerSide)) throw new Error('当前棋盘不允许我方行棋');
      if (!suggestionOnly && lastPlayed === snapshot.boardKey) throw new Error('该局面已落子，等待棋盘更新');
      status('正在计算', 'busy');
      const remaining = Number.isFinite(snapshot.clockRemainingMs) ? snapshot.clockRemainingMs : Infinity;
      const turnLimit = Math.min(5000, remaining - 200);
      const movetime = Math.min(searchSettings.movetime, Math.max(500, remaining - 900));
      requestId = crypto.randomUUID();
      watchdog = setTimeout(() => {
        if (ticket === generation) stop(remaining < 5200 ? '剩余时间不足，已停止本步' : '本步超过 5 秒，已停止', 'error');
      }, Math.max(0, turnLimit - (performance.now() - started)));
      const result = await rpc('XQ_ANALYZE', {
        fen: snapshot.fen, movetime,
        ...(Array.isArray(snapshot.moves) ? { initialFen: snapshot.initFen, moves: snapshot.moves } : {}),
        mode: searchSettings.mode, balance: searchSettings.balance, requestId,
      });
      if (ticket !== generation || !onBoard() || location.pathname !== searchRoute) return;
      if (performance.now() - started > Math.min(4400, turnLimit - 250)) throw new Error('计算超时，已取消本步');
      if (!result.bestmove || result.bestmove === '(none)' || result.bestmove === '0000') throw new Error('当前局面无可走着法');
      if (!(result.depth >= 6) && !(result.score?.type === 'mate' && result.score.value > 0)) {
        throw new Error('未完成至少 6 层搜索，已暂停');
      }
      if (suggestionOnly) {
        const latest = await adapter.read({ deadline: started + Math.min(4900, turnLimit) });
        if (ticket !== generation) return;
        if (performance.now() - started >= Math.min(4900, turnLimit)) throw new Error('分析超时，请重新分析');
        if (!analysisOnly(latest) || latest.boardKey !== snapshot.boardKey) throw new Error('分析期间局面已变化，请重新分析');
      } else {
        status('正在落子', 'busy');
        await adapter.play(result.bestmove, snapshot, { deadline: started + Math.min(4900, turnLimit),
          isCancelled: () => ticket !== generation, varyOperations,
          onStage(stage) {
            if (stage === 'destination-dispatched' && ticket === generation) {
              clearTimeout(watchdog);
              watchdog = null;
              status('等待网站确认落子', 'busy');
            }
          } });
      }
      if (ticket !== generation || location.pathname !== searchRoute) return;
      if (!suggestionOnly) lastPlayed = snapshot.boardKey;
      $('move').textContent = result.bestmove;
      $('depth').textContent = `深度 ${result.depth ?? '-'}`;
      setEvaluation(result.score);
      recordEvaluation(result.score, snapshot);
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
      status(suggestionOnly ? '分析完成' : auto ? '已落子，等待对方' : '本步已完成');
      if (result.timedOut) {
        ready = false;
        void boot();
      }
    } catch (error) {
      if (ticket === generation && !waitForSync(error) && !retryAutomatically(error)) stop(error.message, 'error');
    } finally {
      if (ticket === generation) {
        clearTimeout(watchdog);
        watchdog = null;
        requestId = null;
        busy = false;
        updateBackgroundSubscription();
        controls();
      }
    }
  }

  async function tick() {
    if (destroyed || tickRunning) return;
    if (!isContextAlive()) { invalidateContext(); return; }
    tickRunning = true;
    clearTimeout(tickTimer);
    if (pauseConfirmationUntil && performance.now() >= pauseConfirmationUntil) closePauseConfirmation();
    if ((auto || busy) && onBoard()) updateBackgroundSubscription();
    try {
      if (observedRoute !== location.pathname) {
        if (auto || busy) stop('已切换对局，已暂停');
        observedRoute = location.pathname;
        clearEvaluationHistory();
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
          if (ready && !booting) status(location.pathname.startsWith('/puzzle') ? '请选择题目，等待棋盘' : location.pathname === '/play' ? '等待在线对局' : '等待人机对局');
          if (!ready && !booting && !host.dataset.bootAttempted) { host.dataset.bootAttempted = 'true'; void boot(); }
        }
        controls();
      } else {
        host.classList.remove('hidden');
        if (!ready && !booting) { if (!host.dataset.bootAttempted) { host.dataset.bootAttempted = 'true'; void boot(); } }
        if (!busy) {
          current = await adapter.read();
          if (destroyed) return;
          observeEvaluationGame(current);
          const recovered = boardReadFailed;
          const changedBoard = observedGameKey !== current.gameKey;
          syncSince = null;
          boardReadFailed = false;
          if (observedGameKey && current.gameKey && observedGameKey !== current.gameKey) {
            if (auto || busy) stop('新对局已开始，请重新开启自动行棋');
            lastPlayed = null;
          }
          if (current.gameKey) observedGameKey = current.gameKey;
          $('side').textContent = analysisOnly(current) ? '棋盘分析' : current.mode === 'puzzle' ? (current.puzzleRace ? '题库竞速' : '题库练习') : current.participant === false ? '观战' : (current.playerSide === 'red' ? '我方执红' : '我方执黑');
          $('plies').textContent = `第 ${current.moveCount} 手`;
          if (auto) {
            if (current.puzzleCompleted) stop('题目已完成，已暂停');
            else if (current.puzzleWrong) stop('本题走法未通过，请检查题目');
            else if (current.historyMode) stop('棋谱回放中，已暂停');
            else if (current.mode === 'online' && current.participant !== true) stop('观战棋盘，已暂停');
            else if (Number.isFinite(current.clockRemainingMs) && current.clockRemainingMs < 1000) stop('剩余时间不足，已暂停');
            else if (current.hasPreMove) status('等待网站完成预走子，恢复后继续', 'busy');
            else if (current.connected === false) status('等待对局重新连接，恢复后继续', 'busy');
            else if (current.loading) status('等待棋盘加载，恢复后继续', 'busy');
            else if (!current.active) stop('本局已结束');
            else if (current.turn === current.playerSide && current.isMyTurnNow !== false && lastPlayed !== current.boardKey) void moveWithOpeningEvaluation();
            else if (needsOpeningEvaluation(current)) void captureOpeningEvaluation();
            else status('等待对方行棋');
          }
          else if (ready && analysisOnly(current) && (recovered || changedBoard)) status('点击“分析局面”查看建议');
          else if (ready && current.puzzleCompleted) status('题目已完成');
          else if (ready && current.puzzleWrong) status('本题走法未通过，请检查题目');
          else if (ready && current.mode === 'online' && current.participant !== true) status('观战棋盘');
          else if (ready && recovered) status('引擎就绪');
          controls();
        }
      }
    } catch (error) {
      if (destroyed || handleContextError(error)) return;
      current = null;
      boardReadFailed = true;
      if (!waitForSync(error) && !retryAutomatically(error)) {
        syncSince = null;
        if (auto || busy) stop(error.message, 'error');
        else if (ready) status(error.message, 'error');
      }
      controls();
    } finally {
      tickRunning = false;
      if (!destroyed) tickTimer = setTimeout(tick, 110);
    }
  }

  $('auto').onclick = () => {
    if (auto || busy) { requestPause(); return; }
    auto = true;
    closePauseConfirmation();
    $('stop-reason').classList.add('hidden');
    retryAfter = 0;
    updateBackgroundSubscription();
    status('自动行棋已开启');
    controls();
    void moveWithOpeningEvaluation();
  };
  $('single').onclick = () => void moveWithOpeningEvaluation();
  $('reconnect').onclick = () => {
    if (!isContextAlive()) { location.reload(); return; }
    stop(); delete host.dataset.bootAttempted; lastPlayed = null; void boot();
  };
  function setCollapsed(collapsed) {
    finishPanelInteraction();
    $('body').classList.toggle('hidden', collapsed);
    panel.dataset.collapsed = String(collapsed);
    applyPanelLayout(panelLayout);
    $('collapse').innerHTML = icon(collapsed ? 'plus' : 'minus');
    $('collapse').title = collapsed ? '展开控制台' : '收起控制台';
    $('collapse').ariaLabel = $('collapse').title;
  }
  $('collapse').onclick = () => setCollapsed(!$('body').classList.contains('hidden'));
  $('quick-stop').onclick = requestPause;
  $('pause-confirm').onclick = () => {
    if (pauseConfirmationUntil > performance.now() && (auto || busy)) stop('已暂停（手动确认）');
    else closePauseConfirmation();
  };
  $('pause-cancel').onclick = closePauseConfirmation;
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
  $('vary-operations').onchange = () => persist({ varyOperations: $('vary-operations').checked });
  Promise.resolve().then(() => {
    if (!isContextAlive()) { invalidateContext(); return null; }
    return chrome.storage.local.get({ movetime: 3500, mode: 'adaptive', balance: 0.65, panelLayout: null, varyOperations: true });
  }).then(settings => {
    if (destroyed || !settings) return;
    const { movetime, mode, balance } = settings;
    if (['800', '1800', '2800', '3500'].includes(String(movetime))) $('budget').value = String(movetime);
    $('mode').value = mode === 'fixed' ? 'fixed' : 'adaptive';
    $('balance-row').classList.toggle('hidden', $('mode').value === 'fixed');
    $('balance').value = String(Number.isFinite(balance) ? Math.min(1, Math.max(0, balance)) : 0.65);
    $('balance').oninput();
    $('vary-operations').checked = settings.varyOperations !== false;
    if (!layoutTouched) restorePanelLayout(settings.panelLayout);
  }).catch(handleContextError);
  function onRuntimeMessage(message, sender, sendResponse) {
    if (destroyed) return false;
    if (!isContextAlive()) { invalidateContext(); return false; }
    if (message?.type === 'XQ_BACKGROUND_STATUS') {
      if (sender?.id !== extensionId || sender?.tab) return false;
      sendResponse?.({ ok: true, active: (auto || busy) && onBoard(), sessionId: backgroundSessionId });
      return false;
    }
    if (message?.type === 'XQ_BACKGROUND_PULSE') {
      if (sender?.id !== extensionId || sender?.tab || message.sessionId !== backgroundSessionId) return false;
      const active = auto || busy;
      sendResponse?.({ ok: true, active });
      if (active) { flushPageTasks(); void tick(); }
      return false;
    }
    if (!['XQ_PING', 'XQ_TOGGLE_PANEL'].includes(message?.type)) return false;
    if (message.type === 'XQ_TOGGLE_PANEL') setCollapsed(!$('body').classList.contains('hidden'));
    sendResponse?.({ ok: true, contextAlive: true });
    return false;
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  function onVisibilityChange() { if (auto || busy) { flushPageTasks(); void tick(); } }
  function onKeyDown(event) { if (event.key === 'Escape') closePauseConfirmation(); }
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
