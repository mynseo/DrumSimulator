import './tempo.css';
import { TempoEngine, type TempoState } from './engine';
import { openMic, type Mic } from './mic';
import { Session, type Report, type Section, type TempoSample } from './session';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const meter = $('meter');
const statusEl = $('status');
const bpmEl = $('bpm');
const deltaEl = $('delta');
const hitEl = $('hit');
const levelEl = $('level');
const toggle = $<HTMLButtonElement>('toggle');
const half = $<HTMLButtonElement>('half');
const double = $<HTMLButtonElement>('double');
const targetEl = $<HTMLInputElement>('target');
const canvas = $<HTMLCanvasElement>('graph');
const graphTitle = $('graph-title');
const graphRange = $('graph-range');
const reportEl = $('report');

/** 실시간 그래프에 보이는 길이(초) */
const LIVE_SPAN = 60;
/** 기준에서 이만큼(비율) 안이면 잘 맞는 것으로 본다 */
const ON_TEMPO = 0.01;

const session = new Session();
let mic: Mic | null = null;
let engine: TempoEngine | null = null;
let target: number | null = null;
let wakeLock: { release(): Promise<void> } | null = null;
/** 지금 연주의 기준 템포 (목표가 없을 때 처음 4초에서 잡는다) */
let baseline: number | null = null;
let report: Report | null = null;

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

toggle.addEventListener('click', () => void (mic ? stop() : start()));
half.addEventListener('click', () => rescale(0.5));
double.addEventListener('click', () => rescale(2));
targetEl.addEventListener('change', () => {
  const v = Number(targetEl.value);
  target = v >= 30 && v <= 300 ? v : null;
  if (!target) targetEl.value = '';
  engine?.setTarget(target);
  if (!mic && session.samples.length) showReport();
});
window.addEventListener('resize', () => draw());
document.addEventListener('visibilitychange', () => {
  if (mic && document.visibilityState === 'visible') void keepAwake();
});

async function start() {
  toggle.disabled = true;
  statusEl.textContent = '마이크를 켜는 중…';
  try {
    mic = await openMic(onSamples);
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    const missing = e instanceof DOMException && e.name === 'NotFoundError';
    statusEl.textContent = denied
      ? '마이크를 쓸 수 없어요. 브라우저에서 마이크 권한을 허용해 주세요'
      : missing
        ? '마이크를 찾지 못했어요'
        : e instanceof Error && !(e instanceof DOMException)
          ? e.message
          : '마이크를 켜지 못했어요';
    toggle.disabled = false;
    return;
  }
  engine = new TempoEngine(mic.sampleRate);
  engine.setTarget(target);
  session.clear();
  baseline = null;
  report = null;
  reportEl.hidden = true;
  graphTitle.textContent = '빠르기 흐름';
  toggle.textContent = '결과 보기';
  toggle.disabled = false;
  void keepAwake();
  requestAnimationFrame(frame);
}

function stop() {
  mic?.stop();
  mic = null;
  engine = null;
  void wakeLock?.release();
  wakeLock = null;
  toggle.textContent = '다시 측정';
  half.disabled = double.disabled = true;
  meter.dataset.phase = 'off';
  bpmEl.textContent = '--';
  statusEl.textContent = '측정을 마쳤어요 · 아래에서 결과를 확인하세요';
  levelEl.style.width = '0';
  deltaEl.innerHTML = '&nbsp;';
  delete deltaEl.dataset.kind;
  showReport();
}

async function keepAwake() {
  // 연습하는 동안 화면이 꺼지지 않게 (지원하는 브라우저에서만)
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

function onSamples(samples: Float32Array) {
  if (!engine) return;
  const onsets = engine.push(samples);
  if (onsets.length) {
    hitEl.classList.remove('on');
    void hitEl.offsetWidth;
    hitEl.classList.add('on');
  }
  const s = engine.state();
  if (s.phase === 'locked' && s.bpm !== null) {
    const before = session.samples.length;
    session.add(s.time, s.bpm);
    if (session.samples.length !== before) updateBaseline();
  }
}

function updateBaseline() {
  if (target) {
    baseline = target;
    return;
  }
  const groups = session.groups();
  const take = groups[groups.length - 1];
  const start = take[0].t;
  if (take[take.length - 1].t - start < 4) {
    baseline = null;
    return;
  }
  const first = take.filter((x) => x.t - start <= 4).map((x) => x.bpm).sort((a, b) => a - b);
  baseline = first[first.length >> 1];
}

function rescale(factor: number) {
  if (!engine) return;
  const done = engine.scale(factor);
  if (done === 1) return;
  session.scale(done);
  if (session.samples.length) updateBaseline();
}

function frame() {
  if (!engine) return;
  const s = engine.state();
  renderMeter(s);
  draw(s.time);
  requestAnimationFrame(frame);
}

function renderMeter(s: TempoState) {
  meter.dataset.phase = s.phase;
  const shown = s.bpm !== null && (s.phase === 'locked' || s.phase === 'hold');
  bpmEl.textContent = shown ? s.bpm!.toFixed(1) : '--';
  half.disabled = double.disabled = !shown;
  levelEl.style.width = `${Math.min(100, Math.sqrt(engine!.level) * 100)}%`;
  statusEl.textContent =
    s.phase === 'locked' ? '듣는 중' : s.phase === 'hold' ? '잠깐 놓쳤어요 · 마지막으로 잰 빠르기' : s.phase === 'searching' ? '측정 중…' : '듣고 있어요 · 드럼을 쳐 보세요';

  if (!shown) {
    deltaEl.innerHTML = '&nbsp;';
    delete deltaEl.dataset.kind;
  } else if (baseline === null) {
    deltaEl.textContent = '기준 템포 잡는 중';
    delete deltaEl.dataset.kind;
  } else {
    const off = s.bpm! - baseline;
    const kind = Math.abs(off) <= baseline * ON_TEMPO ? 'ok' : off > 0 ? 'fast' : 'slow';
    deltaEl.dataset.kind = kind;
    const word = kind === 'ok' ? '잘 맞아요' : kind === 'fast' ? `${signed(off)} 빨라요` : `${signed(off)} 느려요`;
    deltaEl.textContent = `${target ? '목표' : '기준'} ${baseline.toFixed(target ? 0 : 1)} · ${word}`;
  }
}

function showReport() {
  report = session.report(target);
  reportEl.hidden = false;
  graphTitle.textContent = '전체 흐름';
  const tiles = $('tiles');
  const takes = $('takes');
  tiles.replaceChildren();
  takes.replaceChildren();
  if (!report) {
    $('report-time').textContent = '';
    takes.append(el('p', 'muted', '빠르기를 5초 넘게 재지 못했어요. 마이크를 드럼 가까이 두고 일정한 박으로 조금 더 길게 쳐 보세요.'));
    draw();
    return;
  }
  $('report-time').textContent = `잰 시간 ${clock(report.measured)}`;
  const tile = (value: string, label: string) => {
    const d = el('div', 'tile');
    d.append(el('b', '', value), el('span', '', label));
    tiles.append(d);
  };
  tile(report.mean.toFixed(1), '평균 BPM');
  tile(`${report.min.toFixed(0)}–${report.max.toFixed(0)}`, '가장 느릴 때–빠를 때');
  tile(`±${report.wobblePct.toFixed(1)}%`, '빠르기 흔들림');
  tile(`${report.score}점`, '안정성');

  report.takes.forEach((take, i) => {
    const box = el('div', 'take');
    const title = report!.takes.length > 1 ? `연주 ${i + 1} · ` : '';
    box.append(el('h3', '', `${title}${clock(take.start)}–${clock(take.end)} · 평균 ${take.mean.toFixed(1)} BPM`));
    const drift = take.endBpm - take.startBpm;
    const trend =
      Math.abs(drift) < take.startBpm * ON_TEMPO
        ? '처음과 끝의 빠르기가 거의 같아요'
        : `끝으로 갈수록 ${Math.abs(drift).toFixed(1)} BPM ${drift > 0 ? '빨라졌어요' : '느려졌어요'}`;
    box.append(el('p', '', `처음 ${take.startBpm.toFixed(1)} → 끝 ${take.endBpm.toFixed(1)} · ${trend}`));
    if (!take.sections.length) {
      box.append(el('p', 'tag ok', `${target ? '목표' : '기준'} ${take.baseline.toFixed(1)} BPM에서 크게 벗어난 구간이 없어요`));
    } else {
      box.append(el('p', 'muted', `${target ? '목표' : '기준'} ${take.baseline.toFixed(1)} BPM에서 벗어난 구간`));
      const ul = el('ul');
      for (const sec of take.sections) {
        const li = el('li');
        li.append(el('time', '', `${clock(sec.start)}–${clock(sec.end)}`), el('span', `tag ${sec.kind}`, `${sec.kind === 'fast' ? '빨라짐' : '느려짐'} ${signed(sec.delta)} BPM`));
        ul.append(li);
      }
      box.append(ul);
    }
    takes.append(box);
  });
  draw();
}

function el(tag: string, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

// ---- 그래프 ----

const css = getComputedStyle(document.documentElement);
const color = (name: string) => css.getPropertyValue(name).trim();

/** now가 있으면 최근 1분(실시간), 없으면 연습 전체 */
function draw(now?: number) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const live = now !== undefined && mic !== null;
  const all = session.samples;
  let from: number;
  let to: number;
  if (live) {
    to = Math.max(LIVE_SPAN, now);
    from = to - LIVE_SPAN;
  } else {
    from = all.length ? all[0].t : 0;
    to = all.length ? Math.max(all[all.length - 1].t, from + 10) : LIVE_SPAN;
  }
  const pts = all.filter((s) => s.t >= from - 1);
  graphRange.textContent = live ? '최근 1분' : all.length ? `${clock(from)}–${clock(to)}` : '';

  const padL = 34;
  const padB = 18;
  const top = 8;
  const plotW = w - padL - 4;
  const plotH = h - padB - top;
  const x = (t: number) => padL + ((t - from) / (to - from)) * plotW;

  // 세로 범위: 보이는 값들을 다 담되 너무 좁지 않게
  const values = pts.map((p) => p.bpm);
  const refs = live ? (baseline ? [baseline] : []) : (report?.takes.map((t) => t.baseline) ?? []);
  const lo0 = Math.min(...values, ...refs);
  const hi0 = Math.max(...values, ...refs);
  const mid = values.length ? (lo0 + hi0) / 2 : (target ?? 100);
  const spread = Math.max(values.length ? (hi0 - lo0) / 2 + 2 : 0, mid * 0.06, 5);
  const lo = mid - spread;
  const hi = mid + spread;
  const y = (bpm: number) => top + (1 - (bpm - lo) / (hi - lo)) * plotH;

  if (!values.length) {
    g.fillStyle = color('--muted');
    g.font = '13px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(live ? '빠르기를 재면 여기에 그려져요' : reportEl.hidden ? '측정을 시작하면 여기에 그려져요' : '아직 잰 빠르기가 없어요', padL + plotW / 2, top + plotH / 2);
    return;
  }

  g.font = '11px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.lineWidth = 1;
  const step = [1, 2, 5, 10, 20, 50].find((s) => (hi - lo) / s <= 5) ?? 50;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    g.strokeStyle = color('--line');
    g.beginPath();
    g.moveTo(padL, y(v));
    g.lineTo(w - 4, y(v));
    g.stroke();
    g.fillStyle = color('--muted');
    g.textAlign = 'right';
    g.fillText(String(v), padL - 6, y(v));
  }
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const tick = [5, 10, 15, 30, 60, 120, 300, 600].find((s) => (to - from) / s <= 6) ?? 600;
  for (let t = Math.ceil(from / tick) * tick; t <= to; t += tick) g.fillText(clock(t), Math.min(w - 16, Math.max(padL + 12, x(t))), h - 4);

  g.save();
  g.beginPath();
  g.rect(padL, 0, plotW + 4, h - padB);
  g.clip();

  // 기준선과 벗어난 구간
  const refLine = (bpm: number, a: number, b: number) => {
    g.strokeStyle = color('--muted');
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(x(a), y(bpm));
    g.lineTo(x(b), y(bpm));
    g.stroke();
    g.setLineDash([]);
  };
  if (live) {
    if (baseline) refLine(baseline, from, to);
  } else if (report) {
    for (const take of report.takes) {
      for (const sec of take.sections) shade(g, sec, x, top, plotH);
      refLine(take.baseline, take.start, take.end);
    }
  }

  g.strokeStyle = color('--text');
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.beginPath();
  let prev: TempoSample | null = null;
  for (const p of pts) {
    if (prev && p.t - prev.t <= 1) g.lineTo(x(p.t), y(p.bpm));
    else g.moveTo(x(p.t), y(p.bpm));
    prev = p;
  }
  g.stroke();
  if (live && prev && now - prev.t < 1) {
    g.fillStyle = color('--accent');
    g.beginPath();
    g.arc(x(prev.t), y(prev.bpm), 4, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function shade(g: CanvasRenderingContext2D, sec: Section, x: (t: number) => number, top: number, plotH: number) {
  g.globalAlpha = 0.22;
  g.fillStyle = color(sec.kind === 'fast' ? '--fast' : '--slow');
  g.fillRect(x(sec.start), top, Math.max(2, x(sec.end) - x(sec.start)), plotH);
  g.globalAlpha = 1;
}

draw();
