import { VELOCITY } from '../core/instruments';
import type { Instrument, Score, ScoreNote } from '../core/types';

/**
 * 음원 → 드럼 악보 (브라우저 안에서만, 서버 없이).
 *
 * 1. 짧은 구간마다 주파수를 나눠 본다(STFT).
 * 2. 대역마다 소리가 갑자기 커지는 순간(타격)을 찾는다:
 *    낮은 소리 = 킥, 중간(몸통 + 스내피 잡음) = 스네어, 아주 높은 소리 = 하이햇·심벌.
 * 3. 전체 타격 흐름에서 빠르기(BPM)와 박 위치를 찾고, 킥·스네어 배치로 마디 첫 박을 정한다.
 * 4. 16분음표 격자에 맞춰 악보를 만든다.
 *
 * 드럼만 녹음된 음원이나 드럼이 크게 들리는 곡에서 잘 맞는다. 베이스·기타가 큰 곡에서는
 * 베이스를 킥으로, 기타를 하이햇으로 착각할 수 있다.
 */

/** 분석용 샘플레이트. 하이햇(7~11kHz)까지 볼 수 있으면서 계산량은 절반이다 */
export const ANALYSIS_RATE = 22050;
const FRAME = 1024;
const HOP = 256;
const STEPS_PER_BEAT = 4;
const MAX_BARS = 128;

/** 분석에 쓰는 주파수 대역 (Hz) */
const BANDS = {
  sub: [35, 90], // 킥의 둥둥
  low: [90, 200], // 탐·킥의 몸통
  body: [200, 400], // 스네어·탐의 몸통
  noise: [1200, 4500], // 스네어의 스내피
  hat: [7000, 11000], // 하이햇·심벌
} as const;
type Band = keyof typeof BANDS;
const BAND_NAMES = Object.keys(BANDS) as Band[];

/** STFT 프레임 번호는 창의 시작이라 실제 타격보다 앞선다: 측정한 지연(프레임) */
const FRAME_LAG = 2.5;

export interface DrumAnalysis {
  score: Score;
  /** 악보 0번 칸이 음원의 몇 초에 해당하는지 (음수면 음원이 악보보다 늦게 시작) */
  offset: number;
  /** 음원에서 찾은 빠르기(소수점 포함). 재생 속도를 맞출 때 쓴다 */
  bpm: number;
}

export interface AnalyzeOptions {
  title?: string;
  /** 0..1 진행률 */
  onProgress?: (p: number) => void;
}

interface Hit {
  frame: number;
  /** 0..~1.5, 이 곡 안에서의 상대 세기 */
  strength: number;
  instruments: Instrument[];
}

export async function analyzeDrums(samples: Float32Array, sampleRate: number, opts: AnalyzeOptions = {}): Promise<DrumAnalysis> {
  if (sampleRate !== ANALYSIS_RATE) throw new Error(`${ANALYSIS_RATE}Hz로 바꿔서 넣어 주세요`);
  const frameTime = HOP / sampleRate;

  const spec = await spectrogram(samples, opts.onProgress);
  const flux = {} as Record<Band, Float32Array>;
  const energy = {} as Record<Band, Float32Array>;
  for (const band of BAND_NAMES) {
    const bins = bandBins([BANDS[band] as unknown as [number, number]], sampleRate);
    flux[band] = bandFlux(spec, bins);
    energy[band] = bandEnergy(spec, bins);
  }

  // 1) 대역마다 따로 타격을 찾고 2) 다른 악기에서 새어 든 것을 걸러 악기를 정한다
  const hits = detectHits(flux, energy, spec, sampleRate);
  if (hits.length < 4) throw new Error('드럼 소리를 거의 찾지 못했어요');

  // 3) 빠르기·박·마디 첫 박 (하이햇은 빼고 킥·스네어 리듬으로)
  const backbone = hits.filter((h) => h.instruments.some((i) => i === 'kick' || i === 'snare'));
  const period = estimatePeriod(backbone.length >= 8 ? backbone : hits, spec.length);
  const bpm = 60 / (period * frameTime);
  const phase = estimatePhase(backbone.length >= 8 ? backbone : hits, period);
  const downbeat = chooseDownbeat(hits, period, phase);

  // 첫 타격 바로 앞(또는 그 자리)의 마디 첫 박을 0번 칸으로
  const barFrames = period * 4;
  const first = hits[0].frame;
  let start = phase + downbeat * period;
  start -= Math.ceil((start - first - period * 0.25) / barFrames) * barFrames;
  const stepFrames = period / STEPS_PER_BEAT;

  const notes: ScoreNote[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const step = Math.round((h.frame - start) / stepFrames);
    if (step < 0) continue;
    for (let instrument of h.instruments) {
      // 마디 첫 박의 오래 울리는 심벌은 크래시, 나머지는 열린 하이햇
      if (instrument === 'hihatOpen' && step % (4 * STEPS_PER_BEAT) === 0) instrument = 'crash';
      const key = `${step}:${instrument}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push({ step, instrument, velocity: velocityOf(h.strength) });
    }
  }

  const stepsInBar = 4 * STEPS_PER_BEAT;
  const maxStep = notes.reduce((m, n) => Math.max(m, n.step), 0);
  const bars = Math.min(MAX_BARS, Math.max(1, Math.ceil((maxStep + 1) / stepsInBar)));
  notes.sort((a, b) => a.step - b.step);
  return {
    score: {
      version: 1,
      title: opts.title ?? '음원에서 뽑은 드럼',
      bpm: Math.round(bpm),
      beatsPerBar: 4,
      stepsPerBeat: STEPS_PER_BEAT,
      bars,
      notes: notes.filter((n) => n.step < bars * stepsInBar),
    },
    offset: (start + FRAME_LAG) * frameTime,
    bpm,
  };
}

/**
 * 대역별로 따로 타격을 찾는다. 같은 순간 여러 악기를 함께 치는 일이 많아서(킥+하이햇, 스네어+하이햇)
 * 한 타격에 악기 하나만 붙이면 안 된다. 대신 한 악기가 다른 대역으로 새어 드는 소리를 걸러 낸다.
 * - 킥: 90Hz 아래. 탐도 조금 울리므로 곡 안의 큰 킥들보다 확실히 작으면 버린다
 * - 스네어·탐: 200~400Hz. 킥과 같은 순간에 에너지가 거의 다 낮은 대역이면 킥이 새어 든 것.
 *   스펙트럼이 평탄하면(줄 잡음) 스네어, 음높이가 뚜렷하면 탐(음높이로 셋으로)
 * - 하이햇·심벌: 7kHz 위. 스네어 잡음·스틱 소리가 새어 들므로 같은 순간이면 더 커야 한다.
 *   울림이 길면 크래시, 중간이면 열린 하이햇
 */
function detectHits(flux: Record<Band, Float32Array>, energy: Record<Band, Float32Array>, spec: Float32Array[], sampleRate: number): Hit[] {
  // 킥은 타격 직후 에너지가 90Hz 아래에 몰려 있다 (스네어·탐은 200~400Hz 쪽). 찌그러진 808 킥도 마찬가지다
  const subVsBody = (f: number) => {
    let sub = 0;
    let body = 0;
    for (let t = f + 2; t <= f + 5; t++) {
      sub += energy.sub[t] ?? 0;
      body += energy.body[t] ?? 0;
    }
    return sub / (body || 1e-12);
  };
  // 킥 꼬리에서 낮은 대역이 다시 튀는 것은 새 타격이 아니다: 직전에 에너지가 충분히 줄었어야 한다
  const freshAttack = (e: Float32Array, f: number) => {
    let before = Infinity;
    for (let t = f - 6; t < f; t++) before = Math.min(before, e[t] ?? 0);
    const after = Math.max(e[f] ?? 0, e[f + 1] ?? 0, e[f + 2] ?? 0, e[f + 3] ?? 0);
    return before < after * 0.5;
  };
  // 세기는 타격 직후의 실제 음량(진폭)으로 잰다. 변화량은 조용하다 친 첫 타격에서만 유난히 커서 세기로 쓰기 어렵다.
  // 진짜 타격은 이 곡의 큰 타격들보다 크게 작지 않다. 그보다 작은 봉우리는 울림·공명·다른 악기
  const loud = (peaks: Peak[], e: Float32Array, ratio: number) => {
    const amp = (f: number) => Math.sqrt(Math.max(e[f] ?? 0, e[f + 1] ?? 0, e[f + 2] ?? 0, e[f + 3] ?? 0, e[f + 4] ?? 0));
    const amps = peaks.map((p) => amp(p.frame));
    const top = percentile(Float32Array.from(amps), 0.9) || 1;
    return peaks.map((p, i) => ({ ...p, strength: amps[i] / top })).filter((p) => p.strength >= ratio);
  };
  const kicks = loud(pickPeaks(flux.sub, 3), energy.sub, 0.3).filter((p) => subVsBody(p.frame) > 1.5 && freshAttack(energy.sub, p.frame));
  const bodies = loud(pickPeaks(flux.body, 3), energy.body, 0.25);
  const highs = loud(pickPeaks(flux.hat, 2), energy.hat, 0.08);
  const near = (list: Peak[], frame: number) => list.find((p) => Math.abs(p.frame - frame) <= 2);

  const hits = new Map<number, Hit>();
  const add = (frame: number, strength: number, instrument: Instrument) => {
    // 같은 순간(±2프레임)의 다른 악기와 한 타격으로 묶는다
    for (const [f, h] of hits) {
      if (Math.abs(f - frame) <= 2) {
        if (!h.instruments.includes(instrument)) h.instruments.push(instrument);
        h.strength = Math.max(h.strength, strength);
        return h;
      }
    }
    const h: Hit = { frame, strength, instruments: [instrument] };
    hits.set(frame, h);
    return h;
  };

  for (const k of kicks) add(k.frame, k.strength, 'kick');

  const toms: { hit: Hit; pitch: number }[] = [];
  const membranes = new Map<number, 'snare' | 'tom'>();
  // 스네어 줄은 잡음(평탄한 스펙트럼), 탐은 음높이가 뚜렷하다. 킷마다 범위가 달라 이 곡 기준으로 나눈다
  const flat = new Map(bodies.map((b) => [b.frame, flatness(spec, b.frame + 3, sampleRate)]));
  const flatCut = 0.35 * percentile(Float32Array.from(flat.values()), 0.9);
  for (const b of bodies) {
    // 킥과 같은 순간인데 에너지가 거의 다 낮은 대역이면 킥이 새어 든 것이다
    if (near(kicks, b.frame) && subVsBody(b.frame) > 5) continue;
    if (flat.get(b.frame)! < flatCut) {
      const hit = add(b.frame, b.strength, 'tom2');
      toms.push({ hit, pitch: lowPitch(spec, b.frame + 3, sampleRate) });
      membranes.set(b.frame, 'tom');
    } else {
      add(b.frame, b.strength, 'snare');
      membranes.set(b.frame, 'snare');
    }
  }

  for (const h of highs) {
    const m = [...membranes].find(([f]) => Math.abs(f - h.frame) <= 2);
    // 탐 스틱 소리·스네어 잡음이 높은 대역에 새어 든다: 그 순간이면 더 커야 하이햇으로 본다
    if (m && h.strength < (m[1] === 'tom' ? 0.6 : 0.35)) continue;
    if (near(kicks, h.frame) && h.strength < 0.25) continue;
    // 오래 울리는 높은 소리는 크래시나 열린 하이햇: 소리만으로는 구분이 어려워 박자 위치로 나중에 정한다
    add(h.frame, h.strength, decay(energy.hat, h.frame, 0.06, 0.12, sampleRate) > 0.06 ? 'hihatOpen' : 'hihatClosed');
  }

  // 탐은 이 곡에 나온 탐들끼리 음높이로 나눈다: 높은 쪽 = 하이 탐, 낮은 쪽 = 플로어 탐
  if (toms.length) {
    const pitches = toms.map((x) => x.pitch).sort((a, b) => a - b);
    const lo = pitches[Math.floor(pitches.length / 3)];
    const hi = pitches[Math.floor((pitches.length * 2) / 3)];
    for (const x of toms) {
      const name: Instrument = hi - lo < 15 ? 'tom2' : x.pitch > hi ? 'tom1' : x.pitch < lo ? 'floorTom' : 'tom2';
      x.hit.instruments = x.hit.instruments.map((i) => (i === 'tom2' ? name : i));
    }
  }
  return [...hits.values()].sort((a, b) => a.frame - b.frame);
}

/**
 * 울림의 길이: 타격 뒤 from~to초 사이에 남은 에너지의 "가장 작은" 비율.
 * 다음 타격이 그 사이에 오면 에너지가 다시 커지므로, 최솟값을 봐야 그 소리 자체의 울림만 잴 수 있다.
 */
function decay(energy: Float32Array, frame: number, from: number, to: number, sampleRate: number): number {
  const peak = Math.max(energy[frame] ?? 0, energy[frame + 1] ?? 0, energy[frame + 2] ?? 0, energy[frame + 3] ?? 0);
  if (peak <= 0) return 0;
  const toFrames = (sec: number) => frame + 3 + Math.round((sec * sampleRate) / HOP);
  let min = Infinity;
  for (let t = toFrames(from); t <= toFrames(to); t++) min = Math.min(min, energy[t] ?? 0);
  return min / peak;
}

/** 80~1000Hz 스펙트럼의 평탄도(0..1): 높으면 잡음(스네어 줄), 낮으면 음높이가 뚜렷(탐) */
function flatness(spec: Float32Array[], frame: number, sampleRate: number): number {
  const s = spec[Math.min(frame, spec.length - 1)];
  const k0 = Math.ceil((80 * FRAME) / sampleRate);
  const k1 = Math.floor((1000 * FRAME) / sampleRate);
  let logSum = 0;
  let sum = 0;
  for (let k = k0; k <= k1; k++) {
    const v = s[k] * s[k] + 1e-12;
    logSum += Math.log(v);
    sum += v;
  }
  const n = k1 - k0 + 1;
  return Math.exp(logSum / n) / (sum / n);
}

/** 60~400Hz에서 가장 큰 주파수(Hz): 탐의 음높이 */
function lowPitch(spec: Float32Array[], frame: number, sampleRate: number): number {
  const s = spec[Math.min(frame, spec.length - 1)];
  const k0 = Math.ceil((60 * FRAME) / sampleRate);
  const k1 = Math.floor((400 * FRAME) / sampleRate);
  let best = k0;
  for (let k = k0; k <= k1; k++) if (s[k] > s[best]) best = k;
  return (best * sampleRate) / FRAME;
}

// ---------------------------------------------------------------------------
// 스펙트로그램

let fftCache: { n: number; cos: Float32Array; sin: Float32Array; rev: Uint32Array } | null = null;

/** 제자리 반복형 radix-2 FFT */
export function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  if (!fftCache || fftCache.n !== n) {
    const cos = new Float32Array(n / 2);
    const sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((-2 * Math.PI * i) / n);
      sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    const bits = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    fftCache = { n, cos, sin, rev };
  }
  const { cos, sin, rev } = fftCache;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step];
        const s = sin[k * step];
        const a = i + k;
        const b = a + half;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** 프레임별 크기 스펙트럼. 긴 곡에서도 화면이 멈추지 않도록 중간중간 쉰다 */
async function spectrogram(x: Float32Array, onProgress?: (p: number) => void): Promise<Float32Array[]> {
  const frames = Math.max(1, Math.floor((x.length - FRAME) / HOP) + 1);
  const win = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const out: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = (x[o + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(FRAME / 2);
    for (let k = 0; k < FRAME / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    out.push(mag);
    if (f % 2000 === 1999) {
      onProgress?.(f / frames);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(1);
  return out;
}

function bandBins(ranges: [number, number][], sampleRate: number): number[] {
  const bins: number[] = [];
  for (const [lo, hi] of ranges) {
    for (let k = Math.ceil((lo * FRAME) / sampleRate); k <= Math.floor((hi * FRAME) / sampleRate) && k < FRAME / 2; k++) bins.push(k);
  }
  return bins;
}

/** 스펙트럼 플럭스: 로그 크기가 늘어난 만큼만 더한다 (줄어드는 것은 무시) */
function bandFlux(spec: Float32Array[], bins: number[]): Float32Array {
  const out = new Float32Array(spec.length);
  const log = (v: number) => Math.log1p(100 * v);
  for (let t = 1; t < spec.length; t++) {
    let sum = 0;
    for (const k of bins) {
      const d = log(spec[t][k]) - log(spec[t - 1][k]);
      if (d > 0) sum += d;
    }
    out[t] = sum / bins.length;
  }
  return out;
}

function bandEnergy(spec: Float32Array[], bins: number[]): Float32Array {
  const out = new Float32Array(spec.length);
  for (let t = 0; t < spec.length; t++) {
    let sum = 0;
    for (const k of bins) sum += spec[t][k] * spec[t][k];
    out[t] = sum;
  }
  return out;
}

function percentile(f: Float32Array, p: number): number {
  if (!f.length) return 0;
  const sorted = Float32Array.from(f).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** 시각(프레임)과 세기만 있는 타격 */
type Timed = { frame: number; strength: number };

interface Peak {
  frame: number;
  /** 큰 타격들(상위 10%)을 1로 둔 상대 세기 */
  strength: number;
  /** 원래 플럭스 값 */
  raw: number;
}

/**
 * 봉우리 찾기: 주변(±0.3초) 평균보다 확실히 높고, 앞뒤 minGap 프레임 안에서 가장 큰 점.
 * 세기는 찾은 봉우리들의 상위 10% 값을 1로 둔 상대값이다.
 */
export function pickPeaks(f: Float32Array, minGap: number): Peak[] {
  const w = 26;
  const candidates: Peak[] = [];
  let sum = 0;
  for (let i = 0; i < Math.min(w, f.length); i++) sum += f[i];
  for (let t = 0; t < f.length; t++) {
    const lo = t - w - 1;
    const hi = t + w;
    if (hi < f.length) sum += f[hi];
    if (lo >= 0) sum -= f[lo];
    const mean = sum / (Math.min(f.length - 1, hi) - Math.max(0, lo + 1) + 1);
    if (f[t] < mean * 1.2) continue;
    let isMax = true;
    for (let d = -minGap; d <= minGap && isMax; d++) {
      if (d !== 0 && f[t + d] !== undefined && (f[t + d] > f[t] || (f[t + d] === f[t] && d < 0))) isMax = false;
    }
    if (isMax) candidates.push({ frame: t, strength: f[t], raw: f[t] });
  }
  // 아주 작은 흔들림(잔향, 다른 악기)은 버린다: 큰 타격들의 15% 미만
  const ref = percentile(Float32Array.from(candidates.map((c) => c.raw)), 0.9) || 1;
  return candidates.filter((c) => c.raw > ref * 0.15).map((c) => ({ ...c, strength: c.raw / ref }));
}

/** 박 길이(프레임): 타격 펄스열의 자기상관. 60~190 BPM, 100~130 근처를 조금 우대 */
function estimatePeriod(hits: Timed[], frames: number): number {
  const frameTime = HOP / ANALYSIS_RATE;
  const x = new Float32Array(frames);
  for (const h of hits) {
    for (let d = -2; d <= 2; d++) if (x[h.frame + d] !== undefined) x[h.frame + d] += h.strength * Math.exp(-d * d);
  }
  const minLag = Math.floor(60 / 190 / frameTime);
  const maxLag = Math.ceil(60 / 60 / frameTime);
  const ac = new Float32Array(maxLag * 4 + 2);
  for (let lag = minLag - 1; lag < ac.length; lag++) {
    let s = 0;
    for (let t = lag; t < x.length; t++) s += x[t] * x[t - lag];
    ac[lag] = s / Math.max(1, x.length - lag);
  }
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // 박의 2·4배 길이(반 마디·한 마디)에서도 맞아야 진짜 박이다
    const harmonic = ac[lag] + 0.6 * ac[lag * 2] + 0.4 * ac[lag * 4];
    const bpm = 60 / (lag * frameTime);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 112) / 0.45) ** 2);
    const score = harmonic * (0.4 + 0.6 * prior);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return refinePeriod(hits, best);
}

/** 정수 프레임 단위 박 길이를 타격 위치에 가장 잘 맞도록 소수점까지 다듬는다 */
function refinePeriod(hits: Timed[], period: number): number {
  let best = period;
  let bestScore = -Infinity;
  for (let p = period * 0.96; p <= period * 1.04; p += period * 0.0005) {
    const phase = estimatePhase(hits, p);
    let s = 0;
    for (const h of hits) {
      const d = ((((h.frame - phase) / (p / 4)) % 1) + 1) % 1; // 16분음표 격자에 얼마나 붙는지
      const dist = Math.min(d, 1 - d);
      s += h.strength * Math.exp(-((dist / 0.12) ** 2));
    }
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

/** 박 격자의 시작 위치(프레임, 0..period): 원형 평균으로 타격들이 가장 많이 모이는 곳 */
function estimatePhase(hits: Timed[], period: number): number {
  let c = 0;
  let s = 0;
  for (const h of hits) {
    const a = (2 * Math.PI * h.frame) / period;
    c += h.strength * Math.cos(a);
    s += h.strength * Math.sin(a);
  }
  const a = Math.atan2(s, c);
  return ((((a / (2 * Math.PI)) * period) % period) + period) % period;
}

/** 넷 중 마디 첫 박: 킥이 1·3박, 스네어가 2·4박에 오는 배치, 크래시가 1박에 오는 배치가 가장 잘 맞는 것 */
function chooseDownbeat(hits: Hit[], period: number, phase: number): number {
  const score = [0, 0, 0, 0];
  for (const h of hits) {
    const b = (h.frame - phase) / period;
    if (Math.abs(b - Math.round(b)) > 0.2) continue;
    const beat = ((Math.round(b) % 4) + 4) % 4;
    for (let d = 0; d < 4; d++) {
      const pos = (beat - d + 4) % 4;
      for (const i of h.instruments) {
        if (i === 'kick') score[d] += pos === 0 ? 2 * h.strength : pos === 2 ? h.strength : 0;
        if (i === 'snare') score[d] += pos === 1 || pos === 3 ? 1.5 * h.strength : 0;
        // 오래 울리는 심벌(크래시 후보)은 보통 마디 첫 박: 킥 1·3박 대칭을 깨는 단서
        if (i === 'crash' || i === 'hihatOpen') score[d] += pos === 0 ? 2.5 * h.strength : 0;
      }
    }
  }
  return score.indexOf(Math.max(...score));
}

function velocityOf(strength: number): number {
  if (strength < 0.35) return VELOCITY.ghost;
  if (strength > 0.95) return VELOCITY.accent;
  return VELOCITY.normal;
}
