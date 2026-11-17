/**
 * 연습 기록과 리포트.
 *
 * 믿을 만한 빠르기만 0.25초마다 적어 두었다가, 끝나면 "어디서 빨라지고 느려졌는지"를 정리한다.
 * 3초 넘게 끊기면 다른 연주(take)로 본다. 연주마다 기준 템포(목표 템포, 없으면 처음 4초의 중간값)를
 * 잡아서 그보다 2.5% 넘게 벗어난 채 2초 넘게 이어진 곳을 빨라진·느려진 구간으로 적는다.
 */

export interface TempoSample {
  t: number;
  bpm: number;
}

export interface Section {
  start: number;
  end: number;
  kind: 'fast' | 'slow';
  /** 기준 템포와의 차이(BPM). 구간 안에서 가장 크게 벗어난 값 */
  delta: number;
}

export interface Take {
  start: number;
  end: number;
  mean: number;
  /** 기준 템포 */
  baseline: number;
  startBpm: number;
  endBpm: number;
  sections: Section[];
}

export interface Report {
  /** 빠르기를 잰 시간의 합(초) */
  measured: number;
  mean: number;
  min: number;
  max: number;
  /** 연주마다 그 연주의 중간 빠르기에서 평균 몇 % 벗어났는지 */
  wobblePct: number;
  /** 0..100. 흔들림 1%마다 10점씩 깎는다 */
  score: number;
  takes: Take[];
}

export const SAMPLE_EVERY = 0.25;
const TAKE_GAP = 3;
const MIN_TAKE = 5;
const EDGE = 4;
const OFF_RATIO = 0.025;
const MIN_SECTION = 2;
const MERGE_GAP = 1;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class Session {
  samples: TempoSample[] = [];

  add(t: number, bpm: number) {
    const last = this.samples[this.samples.length - 1];
    if (last && t - last.t < SAMPLE_EVERY) return;
    this.samples.push({ t, bpm });
  }

  /** ½×·2×로 바로잡으면 지금 연주에서 이미 적은 값도 같이 바꾼다 */
  scale(factor: number) {
    let i = this.samples.length - 1;
    while (i > 0 && this.samples[i].t - this.samples[i - 1].t <= TAKE_GAP) i--;
    for (; i >= 0 && i < this.samples.length; i++) this.samples[i].bpm *= factor;
  }

  clear() {
    this.samples = [];
  }

  /** 끊긴 곳에서 나눈 연주들 */
  groups(): TempoSample[][] {
    const out: TempoSample[][] = [];
    for (const s of this.samples) {
      const cur = out[out.length - 1];
      if (cur && s.t - cur[cur.length - 1].t <= TAKE_GAP) cur.push(s);
      else out.push([s]);
    }
    return out;
  }

  report(target: number | null = null): Report | null {
    const takes: Take[] = [];
    const all: number[] = [];
    let measured = 0;
    let offSq = 0;
    for (const g of this.groups()) {
      const start = g[0].t;
      const end = g[g.length - 1].t;
      if (end - start < MIN_TAKE) continue;
      const bpms = g.map((s) => s.bpm);
      const mid = median(bpms);
      const startBpm = median(g.filter((s) => s.t - start <= EDGE).map((s) => s.bpm));
      const endBpm = median(g.filter((s) => end - s.t <= EDGE).map((s) => s.bpm));
      const baseline = target ?? startBpm;
      for (const b of bpms) {
        all.push(b);
        offSq += (b / mid - 1) ** 2;
      }
      measured += end - start;
      takes.push({
        start,
        end,
        mean: bpms.reduce((a, b) => a + b, 0) / bpms.length,
        baseline,
        startBpm,
        endBpm,
        sections: findSections(g, baseline),
      });
    }
    if (!all.length) return null;
    const wobblePct = Math.sqrt(offSq / all.length) * 100;
    return {
      measured,
      mean: all.reduce((a, b) => a + b, 0) / all.length,
      min: Math.min(...all),
      max: Math.max(...all),
      wobblePct,
      score: Math.round(Math.max(0, 100 - wobblePct * 10)),
      takes,
    };
  }
}

function findSections(g: TempoSample[], baseline: number): Section[] {
  const raw: Section[] = [];
  let cur: Section | null = null;
  for (const s of g) {
    const off = s.bpm / baseline - 1;
    const kind = off > OFF_RATIO ? 'fast' : off < -OFF_RATIO ? 'slow' : null;
    if (kind && cur && cur.kind === kind && s.t - cur.end <= MERGE_GAP) {
      cur.end = s.t;
      if (Math.abs(s.bpm - baseline) > Math.abs(cur.delta)) cur.delta = s.bpm - baseline;
    } else if (kind) {
      cur = { start: s.t, end: s.t, kind, delta: s.bpm - baseline };
      raw.push(cur);
    }
  }
  return raw.filter((s) => s.end - s.start >= MIN_SECTION);
}
