import { describe, expect, it } from 'vitest';
import { TempoEngine } from '../src/tempo/engine';
import { OnsetDetector } from '../src/tempo/onset';
import { Session } from '../src/tempo/session';

const RATE = 44100;

/** 재현되는 난수 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Drum = 'kick' | 'snare' | 'hat';
interface Hit {
  time: number;
  drum: Drum;
}

/** 합성 드럼 소리 + 방 소음 */
function render(hits: Hit[], seconds: number, seed = 1): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.ceil(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = (rand() - 0.5) * 0.004;
  for (const h of hits) {
    const start = Math.round(h.time * RATE);
    const len = Math.round((h.drum === 'kick' ? 0.18 : h.drum === 'snare' ? 0.12 : 0.03) * RATE);
    let prev = 0;
    for (let i = 0; i < len && start + i < out.length; i++) {
      const t = i / RATE;
      let v: number;
      if (h.drum === 'kick') v = 0.8 * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 40)) * t) * Math.exp(-t * 22);
      else if (h.drum === 'snare') v = (0.5 * (rand() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 30);
      else {
        // 하이햇: 높은 소리만 남긴 잡음, 작게
        const n = rand() * 2 - 1;
        v = 0.12 * (n - prev) * Math.exp(-t * 120);
        prev = n;
      }
      out[start + i] += v;
    }
  }
  return out;
}

/** 8비트 록: 킥 1·3, 스네어 2·4, 하이햇 8분음표. bpmAt으로 빠르기를 바꿀 수 있다 */
function rock(bpmAt: (t: number) => number, seconds: number, opts: { jitter?: number; hatsPerBeat?: number; seed?: number } = {}): Hit[] {
  const rand = rng(opts.seed ?? 7);
  const per = opts.hatsPerBeat ?? 2;
  const hits: Hit[] = [];
  let t = 0.3;
  for (let beat = 0; t < seconds - 0.3; beat++) {
    const len = 60 / bpmAt(t);
    const j = () => (rand() - 0.5) * 2 * (opts.jitter ?? 0);
    hits.push({ time: t + j(), drum: beat % 2 ? 'snare' : 'kick' });
    for (let k = 0; k < per; k++) hits.push({ time: t + (k * len) / per + j(), drum: 'hat' });
    t += len;
  }
  return hits;
}

/** 소리를 마이크처럼 조금씩 넣으면서 0.25초마다 상태를 적는다 */
function listen(audio: Float32Array, setup?: (e: TempoEngine) => void, at?: Record<number, (e: TempoEngine) => void>) {
  const engine = new TempoEngine(RATE);
  setup?.(engine);
  const log: { t: number; bpm: number | null; phase: string }[] = [];
  const pending = Object.entries(at ?? {}).map(([t, fn]) => ({ t: +t, fn }));
  let next = 0.25;
  for (let i = 0; i < audio.length; i += 512) {
    engine.push(audio.subarray(i, i + 512));
    for (const p of pending) {
      if (p.t >= 0 && engine.time >= p.t) {
        p.fn(engine);
        p.t = -1;
      }
    }
    if (engine.time >= next) {
      const s = engine.state();
      log.push({ t: s.time, bpm: s.bpm, phase: s.phase });
      next += 0.25;
    }
  }
  return log;
}

const lockedAfter = (log: ReturnType<typeof listen>, t: number) => log.filter((l) => l.t >= t && l.phase === 'locked').map((l) => l.bpm!);

describe('타격 찾기', () => {
  it('킥·스네어·하이햇을 제때 하나씩 찾는다', () => {
    const hits = rock(() => 100, 6);
    const det = new OnsetDetector(RATE);
    const found = det.push(render(hits, 6.5)).map((o) => o.time);
    const times = [...new Set(hits.map((h) => h.time.toFixed(3)))].map(Number);
    for (const t of times) expect(found.some((f) => Math.abs(f - t) < 0.02), `${t}초 타격`).toBe(true);
    expect(found.length).toBe(times.length);
  });

  it('소음만 있으면 아무것도 찾지 않는다', () => {
    const det = new OnsetDetector(RATE);
    expect(det.push(render([], 5))).toHaveLength(0);
  });

  it('킥·스네어를 하이햇보다 세게 잰다', () => {
    const det = new OnsetDetector(RATE);
    const found = det.push(render([{ time: 0.5, drum: 'kick' }, { time: 1, drum: 'hat' }, { time: 1.5, drum: 'snare' }], 2.5));
    expect(found).toHaveLength(3);
    expect(found[0].strength).toBeGreaterThan(found[1].strength * 2);
    expect(found[2].strength).toBeGreaterThan(found[1].strength * 2);
  });
});

describe('빠르기 찾기', () => {
  for (const bpm of [52, 60, 74, 90, 105, 120, 138, 150, 165]) {
    it(`${bpm} BPM 8비트를 2배·절반으로 헷갈리지 않는다`, () => {
      const got = lockedAfter(listen(render(rock(() => bpm, 14), 14)), 6);
      expect(got.length).toBeGreaterThan(20);
      for (const g of got) expect(Math.abs(g - bpm)).toBeLessThan(bpm * 0.01);
    });
  }

  it('16비트 하이햇도 한 박으로 읽는다', () => {
    const got = lockedAfter(listen(render(rock(() => 84, 14, { hatsPerBeat: 4 }), 14)), 6);
    expect(got.length).toBeGreaterThan(20);
    for (const g of got) expect(Math.abs(g - 84)).toBeLessThan(1);
  });

  it('셔플(셋잇단)도 한 박으로 읽는다', () => {
    const hits: Hit[] = [];
    const len = 60 / 96;
    for (let b = 0; 0.3 + b * len < 13.5; b++) {
      const t = 0.3 + b * len;
      hits.push({ time: t, drum: b % 2 ? 'snare' : 'kick' }, { time: t, drum: 'hat' }, { time: t + (len * 2) / 3, drum: 'hat' });
    }
    const got = lockedAfter(listen(render(hits, 14)), 6);
    expect(got.length).toBeGreaterThan(20);
    for (const g of got) expect(Math.abs(g - 96)).toBeLessThan(1);
  });

  it('사람처럼 조금씩 어긋나게 쳐도 2% 안으로 맞춘다', () => {
    const got = lockedAfter(listen(render(rock(() => 112, 20, { jitter: 0.012 }), 20)), 6);
    expect(got.length).toBeGreaterThan(40);
    for (const g of got) expect(Math.abs(g - 112)).toBeLessThan(112 * 0.02);
  });

  it('치기 시작하고 3초 안에 빠르기를 보여 준다', () => {
    const log = listen(render(rock(() => 120, 8), 8));
    const first = log.find((l) => l.phase === 'locked')!;
    expect(first.t).toBeLessThan(3.3);
    expect(Math.abs(first.bpm! - 120)).toBeLessThan(3);
  });

  it('빠르기가 바뀌면 3초 안에 따라간다', () => {
    const log = listen(render(rock((t) => (t < 8 ? 100 : 116), 18), 18));
    for (const g of lockedAfter(log, 5).slice(0, 8)) expect(Math.abs(g - 100)).toBeLessThan(1.5);
    for (const g of lockedAfter(log, 11.5)) expect(Math.abs(g - 116)).toBeLessThan(2);
  });

  it('점점 빨라지는 것을 따라간다', () => {
    const log = listen(render(rock((t) => 100 + t * 0.8, 25), 25));
    const at = (t: number) => log.find((l) => l.t >= t && l.phase === 'locked')!.bpm!;
    expect(at(8)).toBeGreaterThan(102);
    expect(at(22)).toBeGreaterThan(at(8) + 8);
    expect(Math.abs(at(22) - 117.6)).toBeLessThan(3);
  });

  it('아무렇게나 치면 틀린 숫자 대신 측정 중으로 둔다', () => {
    const rand = rng(99);
    const hits: Hit[] = [];
    for (let t = 0.3; t < 14; t += 0.09 + rand() * 0.7) hits.push({ time: t, drum: rand() < 0.5 ? 'kick' : 'snare' });
    const log = listen(render(hits, 15));
    const locked = log.filter((l) => l.phase === 'locked').length;
    expect(locked / log.length).toBeLessThan(0.15);
  });

  it('멈추면 조용함으로 돌아가고 다시 치면 새로 찾는다', () => {
    const a = rock(() => 90, 8);
    const b = rock(() => 150, 8).map((h) => ({ ...h, time: h.time + 14 }));
    const log = listen(render([...a, ...b], 22));
    expect(log.find((l) => l.t > 12.5 && l.t < 14)!.phase).toBe('silent');
    for (const g of lockedAfter(log, 18)) expect(Math.abs(g - 150)).toBeLessThan(2);
  });

  it('2×를 누르면 두 배로 읽고 그대로 유지한다', () => {
    const log = listen(render(rock(() => 80, 16), 16), undefined, { 6: (e) => expect(e.scale(2)).toBe(2) });
    const got = lockedAfter(log, 7);
    expect(got.length).toBeGreaterThan(20);
    for (const g of got) expect(Math.abs(g - 160)).toBeLessThan(2);
  });

  it('목표 템포를 정하면 그 근처에서 읽는다', () => {
    const got = lockedAfter(listen(render(rock(() => 62, 14), 14), (e) => e.setTarget(124)), 6);
    expect(got.length).toBeGreaterThan(20);
    for (const g of got) expect(Math.abs(g - 124)).toBeLessThan(2);
  });
});

describe('연습 리포트', () => {
  const fill = (s: Session, from: number, to: number, bpm: (t: number) => number) => {
    for (let t = from; t <= to; t += 0.25) s.add(t, bpm(t));
  };

  it('빨라진 구간과 느려진 구간을 찾는다', () => {
    const s = new Session();
    fill(s, 0, 60, (t) => (t >= 20 && t < 30 ? 126 : t >= 45 && t < 50 ? 115 : 120));
    const r = s.report()!;
    expect(r.takes).toHaveLength(1);
    const [fast, slow] = r.takes[0].sections;
    expect(fast).toMatchObject({ kind: 'fast', start: 20 });
    expect(fast.end).toBeCloseTo(29.75);
    expect(fast.delta).toBeCloseTo(6);
    expect(slow).toMatchObject({ kind: 'slow', start: 45 });
    expect(slow.delta).toBeCloseTo(-5);
    expect(r.min).toBe(115);
    expect(r.max).toBe(126);
  });

  it('처음과 끝의 빠르기로 흐름을 알려 준다', () => {
    const s = new Session();
    fill(s, 0, 40, (t) => 100 + t * 0.2);
    const take = s.report()!.takes[0];
    expect(take.startBpm).toBeCloseTo(100.4, 0);
    expect(take.endBpm).toBeCloseTo(107.6, 0);
  });

  it('고르게 치면 점수가 높고 흔들리면 낮다', () => {
    const steady = new Session();
    fill(steady, 0, 30, (t) => 120 + Math.sin(t) * 0.3);
    const shaky = new Session();
    fill(shaky, 0, 30, (t) => 120 + Math.sin(t) * 6);
    expect(steady.report()!.score).toBeGreaterThan(95);
    expect(shaky.report()!.score).toBeLessThan(70);
  });

  it('3초 넘게 쉬면 다른 연주로 나누고, 곡마다 따로 흔들림을 잰다', () => {
    const s = new Session();
    fill(s, 0, 20, () => 90);
    fill(s, 30, 50, () => 140);
    const r = s.report()!;
    expect(r.takes.map((t) => Math.round(t.mean))).toEqual([90, 140]);
    expect(r.score).toBe(100);
    expect(r.measured).toBe(40);
  });

  it('목표 템포가 있으면 그것을 기준으로 삼는다', () => {
    const s = new Session();
    fill(s, 0, 20, () => 124);
    expect(s.report()!.takes[0].sections).toHaveLength(0);
    expect(s.report(120)!.takes[0].sections[0]).toMatchObject({ kind: 'fast', delta: 4 });
  });

  it('½×로 바로잡으면 지금 연주의 기록만 바뀐다', () => {
    const s = new Session();
    fill(s, 0, 10, () => 90);
    fill(s, 20, 30, () => 160);
    s.scale(0.5);
    expect(s.report()!.takes.map((t) => t.mean)).toEqual([90, 80]);
  });

  it('너무 짧으면 리포트가 없다', () => {
    const s = new Session();
    fill(s, 0, 2, () => 100);
    expect(s.report()).toBeNull();
  });
});
