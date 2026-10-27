import './style.css';
import { Transport } from './audio/Transport';
import { cloneScore, PRESETS } from './core/presets';
import { buildTimeline, stepsPerBar } from './core/timeline';
import type { Score, Timeline } from './core/types';
import { CHARACTERS } from './drummer/characters';
import type { DrummerRig } from './drummer/DrummerRig';
import { parseMidi } from './import/midi';
import { parseDrumTab } from './import/tab';
import { MotionPlanner } from './motion/MotionPlanner';
import { DrumKit } from './scene/DrumKit';
import { Stage, type CameraView } from './scene/Stage';
import { LiveSticking } from './core/sticking';
import type { Instrument } from './core/types';
import { LiveMotion } from './motion/LiveMotion';
import { Editor } from './ui/Editor';
import { instrumentForKey, Pads } from './ui/Pads';

const STORAGE_KEY = 'drumsim.score.v1';
const CHARACTER_KEY = 'drumsim.character';
const PANEL_KEY = 'drumsim.panel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// 3D를 그릴 수 없는 브라우저에서는 빈 화면 대신 안내를 보여 준다
if (!webglAvailable()) {
  document.body.innerHTML =
    '<div class="fatal">이 브라우저에서는 3D 그래픽(WebGL)을 사용할 수 없습니다.<br />최신 Chrome, Edge, Safari, Firefox에서 열어 주세요.</div>';
  throw new Error('WebGL unavailable');
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// ---- 상태 ----
let score: Score = loadScore() ?? cloneScore(PRESETS[1].score);
let timeline: Timeline = buildTimeline(score);

const stage = new Stage($('viewport'));
const kit = new DrumKit();
stage.scene.add(kit.root);
const planner = new MotionPlanner(kit);
const transport = new Transport(timeline);
const editor = new Editor($('editor'), score);
const pads = new Pads($('pads'));
const liveMotion = new LiveMotion(kit);
const liveSticking = new LiveSticking();

let rig: DrummerRig | null = null;
function setCharacter(id: string) {
  const def = CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
  rig?.dispose();
  rig = def.create();
  stage.scene.add(rig.root);
  try {
    localStorage.setItem(CHARACTER_KEY, def.id);
  } catch {
    /* 저장 불가 환경 */
  }
}

// ---- 악보 변경 흐름: score → timeline → (오디오, 모션, 편집기) ----
function scoreChanged({ rerender = false } = {}) {
  timeline = buildTimeline(score);
  transport.setTimeline(timeline);
  if (rerender) editor.setScore(score);
  editor.showSticking(timeline);
  syncToolbar();
  saveScore();
}

function setScore(next: Score) {
  score = next;
  scoreChanged({ rerender: true });
}

// ---- 툴바 ----
const playBtn = $<HTMLButtonElement>('play');
const bpmInput = $<HTMLInputElement>('bpm');
const barsInput = $<HTMLInputElement>('bars');
const spbSelect = $<HTMLSelectElement>('spb');
const loopInput = $<HTMLInputElement>('loop');
const metroInput = $<HTMLInputElement>('metro');
const presetSelect = $<HTMLSelectElement>('preset');
const characterSelect = $<HTMLSelectElement>('character');
const fileInput = $<HTMLInputElement>('file');

function syncToolbar() {
  bpmInput.value = String(score.bpm);
  barsInput.value = String(score.bars);
  spbSelect.value = String(score.stepsPerBeat);
  $('title').textContent = score.title;
}

function updatePlayButton() {
  playBtn.textContent = transport.playing ? '❚❚ 일시정지' : '▶ 재생';
}

async function togglePlay() {
  if (transport.playing) transport.pause();
  else await transport.play();
  updatePlayButton();
}

playBtn.addEventListener('click', togglePlay);
$('stop').addEventListener('click', () => {
  transport.stop();
  pads.resetFollow();
  updatePlayButton();
});
transport.onEnded = updatePlayButton;

bpmInput.addEventListener('change', () => {
  score.bpm = clampInt(bpmInput.value, 30, 300, score.bpm);
  scoreChanged();
});
barsInput.addEventListener('change', () => {
  score.bars = clampInt(barsInput.value, 1, 128, score.bars);
  score.notes = score.notes.filter((n) => n.step < score.bars * stepsPerBar(score));
  scoreChanged({ rerender: true });
});
spbSelect.addEventListener('change', () => {
  const next = Number(spbSelect.value);
  const old = score.stepsPerBeat;
  const seen = new Set<string>();
  score.notes = score.notes
    .map((n) => ({ ...n, step: Math.round((n.step * next) / old) }))
    .filter((n) => {
      const key = `${n.step}:${n.instrument}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  score.stepsPerBeat = next;
  scoreChanged({ rerender: true });
});
loopInput.addEventListener('change', () => (transport.loop = loopInput.checked));
metroInput.addEventListener('change', () => (transport.metronome = metroInput.checked));

presetSelect.innerHTML = '<option value="">예제 불러오기…</option>' + PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
presetSelect.addEventListener('change', () => {
  const p = PRESETS[Number(presetSelect.value)];
  presetSelect.value = '';
  if (p) setScore(cloneScore(p.score));
});

characterSelect.innerHTML = CHARACTERS.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
characterSelect.addEventListener('change', () => setCharacter(characterSelect.value));

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => stage.setView(b.dataset.view as CameraView)),
);

// ---- 불러오기 / 저장 ----
$('import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, '');
  try {
    if (/\.midi?$/i.test(file.name)) {
      const { score: s, skipped } = parseMidi(await file.arrayBuffer(), name);
      setScore(s);
      toast(`MIDI를 불러왔습니다: ${s.notes.length}개 음${skipped ? `, 지원하지 않는 음 ${skipped}개 제외` : ''}`);
    } else if (/\.json$/i.test(file.name)) {
      setScore(validateScore(JSON.parse(await file.text())));
      toast('악보를 불러왔습니다');
    } else {
      setScore(parseDrumTab(await file.text(), name, score.bpm));
      toast('드럼 탭을 불러왔습니다');
    }
  } catch (e) {
    toast(`불러오기 실패: ${(e as Error).message}`);
  }
});

const tabDialog = $<HTMLDialogElement>('tab-dialog');
$('tab').addEventListener('click', () => tabDialog.showModal());
tabDialog.addEventListener('close', () => {
  if (tabDialog.returnValue !== 'ok') return;
  try {
    setScore(parseDrumTab($<HTMLTextAreaElement>('tab-text').value, '드럼 탭', score.bpm));
    toast('드럼 탭을 불러왔습니다');
  } catch (e) {
    toast(`불러오기 실패: ${(e as Error).message}`);
  }
});

$('export').addEventListener('click', async () => {
  const json = JSON.stringify(score, null, 2);
  // claude.ai 아티팩트 안에서는 파일 다운로드가 막혀 있으므로 클립보드로 복사한다
  if (import.meta.env.VITE_TARGET === 'artifact') {
    try {
      await navigator.clipboard.writeText(json);
      toast('악보 JSON을 클립보드에 복사했습니다. 메모장에 붙여 넣어 .json으로 저장하세요');
    } catch {
      toast('클립보드에 복사하지 못했습니다');
    }
    return;
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${score.title || 'score'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/** 글자를 입력하는 칸에서는 키보드 연주를 하지 않는다 (체크박스 등은 괜찮다) */
function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(target.type);
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  if (tabDialog.open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
    return;
  }
  const instrument = instrumentForKey(e.code);
  if (!instrument) return;
  e.preventDefault();
  if (!e.repeat) liveHit(instrument, e.shiftKey ? 1 : 0.8);
});

// 브라우저는 사용자 입력 뒤에만 소리를 허락한다. 휴대폰은 첫 터치를 뗄 때 오디오를 깨워 둔다
for (const type of ['pointerup', 'touchend', 'keydown'] as const) {
  window.addEventListener(type, () => transport.unlock(), { passive: true });
}

// ---- 직접 연주 ----
const recInput = $<HTMLInputElement>('rec');

function liveHit(instrument: Instrument, velocity: number) {
  const now = performance.now() / 1000;
  const limb = liveSticking.next(instrument, now);
  transport.playNow(instrument, velocity);
  liveMotion.hit(limb, instrument, now, velocity);
  pads.flash(instrument, limb);
  if (recInput.checked && transport.playing) record(instrument, velocity);
}
pads.onHit = liveHit;

/** 재생 중 친 음을 가장 가까운 칸에 넣는다 */
function record(instrument: Instrument, velocity: number) {
  const step = Math.round(transport.heardPosition / timeline.stepDuration) % timeline.totalSteps;
  const existing = score.notes.find((n) => n.step === step && n.instrument === instrument);
  if (existing) existing.velocity = Math.max(existing.velocity, velocity);
  else score.notes.push({ step, instrument, velocity });
  scoreChanged();
  editor.refresh();
}

recInput.addEventListener('change', () => {
  if (recInput.checked && !transport.playing) {
    togglePlay();
    toast('녹음 중: 반복 재생에 맞춰 치면 악보에 들어갑니다');
  }
});

// ---- 아래 패널: 악보 / 드럼 패드 ----
const panel = $('editor-wrap');
function showPanel(name: 'score' | 'pads') {
  panel.dataset.panel = name;
  $('editor').hidden = name !== 'score';
  $('pads').hidden = name !== 'pads';
  panel.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => (el.hidden = el.dataset.for !== name));
  panel.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.panel === name)));
  try {
    localStorage.setItem(PANEL_KEY, name);
  } catch {
    /* 저장 불가 환경 */
  }
}
panel.querySelectorAll<HTMLButtonElement>('.tabs [data-panel]').forEach((b) =>
  b.addEventListener('click', () => showPanel(b.dataset.panel as 'score' | 'pads')),
);

// ---- 편집기 ----
editor.onChange = () => scoreChanged();
editor.onSeek = (step) => {
  transport.seek(step * timeline.stepDuration);
  pads.resetFollow();
};

// ---- 매 프레임: 재생 위치 하나로 소리·드러머·피드백·편집기를 맞춘다 ----
const positionEl = $('position');
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = transport.position;
  const loop = transport.loop;

  const live = performance.now() / 1000;

  const pose = planner.compute(timeline, t, loop);
  liveMotion.apply(pose, live, planner.kickPressValue, planner.hatClosedValue, transport.playing);
  rig?.apply(pose);
  kit.update(timeline, t, loop, liveMotion.kickPress, liveMotion.hatClosed, liveMotion.flashAges(live));
  if (transport.playing) pads.followScore(timeline, t, loop);

  const step = Math.min(timeline.totalSteps - 1, Math.floor(t / timeline.stepDuration + 1e-6));
  editor.setPlayhead(transport.playing || t > 0 ? step : -1);
  const perBar = stepsPerBar(score);
  positionEl.textContent = `${Math.floor(step / perBar) + 1}마디 ${Math.floor((step % perBar) / score.stepsPerBeat) + 1}박`;

  stage.render(dt);
  requestAnimationFrame(frame);
}

// ---- 저장소 ----
function saveScore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(score));
  } catch {
    /* 저장 불가 환경 */
  }
}

function loadScore(): Score | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateScore(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function validateScore(s: Score): Score {
  if (!s || !Array.isArray(s.notes) || !(s.bpm > 0) || !(s.bars > 0) || !(s.stepsPerBeat > 0)) {
    throw new Error('올바른 악보 파일이 아닙니다');
  }
  return { version: 1, title: s.title ?? '악보', bpm: s.bpm, beatsPerBar: s.beatsPerBar ?? 4, stepsPerBeat: s.stepsPerBeat, bars: s.bars, notes: s.notes };
}

function clampInt(v: string, min: number, max: number, fallback: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 3000);
}

// ---- 시작 ----
let savedCharacter: string | null = null;
try {
  savedCharacter = localStorage.getItem(CHARACTER_KEY);
} catch {
  /* 저장 불가 환경 */
}
characterSelect.value = CHARACTERS.some((c) => c.id === savedCharacter) ? savedCharacter! : CHARACTERS[0].id;
setCharacter(characterSelect.value);
let savedPanel: string | null = null;
try {
  savedPanel = localStorage.getItem(PANEL_KEY);
} catch {
  /* 저장 불가 환경 */
}
// 휴대폰·태블릿은 처음에 드럼 패드를 보여 준다
showPanel(savedPanel === 'score' || savedPanel === 'pads' ? savedPanel : matchMedia('(pointer: coarse)').matches ? 'pads' : 'score');
editor.render();
scoreChanged();
requestAnimationFrame(frame);
