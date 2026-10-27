import { describe, expect, it } from 'vitest';
import { ANALYSIS_RATE, analyzeDrums } from '../src/import/audio';

/** 간단히 합성한 드럼 소리로 박자 정답을 아는 음원을 만든다 */
function synthDrums(bpm: number, bars: number, pattern: Record<'kick' | 'snare' | 'hat', string>) {
  const sr = ANALYSIS_RATE;
  const step = 60 / bpm / 4;
  const lead = 0.3;
  const x = new Float32Array(Math.ceil((lead + bars * 16 * step + 1) * sr));
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const truth: { t: number; c: string }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < 16; s++) {
      const t0 = lead + (bar * 16 + s) * step;
      const i0 = Math.round(t0 * sr);
      for (const c of ['kick', 'snare', 'hat'] as const) {
        if (pattern[c][s] !== 'x') continue;
        truth.push({ t: t0, c });
        let phase = 0;
        let prev = 0;
        for (let i = 0; i < sr * 0.4 && i0 + i < x.length; i++) {
          const t = i / sr;
          if (c === 'kick') {
            phase += (2 * Math.PI * (50 + 70 * Math.exp(-t * 30))) / sr;
            x[i0 + i] += 0.9 * Math.sin(phase) * Math.exp(-t * 9);
          } else if (c === 'snare') {
            phase += (2 * Math.PI * 190) / sr;
            x[i0 + i] += (0.35 * Math.sin(phase) * Math.exp(-t * 25) + 0.45 * rand() * Math.exp(-t * 18));
          } else {
            const n = rand();
            x[i0 + i] += 0.5 * (n - prev) * Math.exp(-t * 60); // 차분 = 고역 통과 잡음
            prev = n;
          }
        }
      }
    }
  }
  return { x, truth };
}

describe('음원에서 드럼 뽑기', () => {
  it('합성한 8비트 록에서 빠르기와 킥·스네어·하이햇을 찾는다', async () => {
    const { x, truth } = synthDrums(110, 8, {
      kick: 'x-------x-x-----',
      snare: '----x-------x---',
      hat: 'x-x-x-x-x-x-x-x-',
    });
    const a = await analyzeDrums(x, ANALYSIS_RATE);
    expect(a.bpm).toBeGreaterThan(108.5);
    expect(a.bpm).toBeLessThan(111.5);

    const stepDur = 60 / a.bpm / 4;
    const cls = (i: string) => (i === 'kick' ? 'kick' : i === 'snare' ? 'snare' : i.startsWith('hihat') || i === 'crash' ? 'hat' : 'other');
    const got = a.score.notes.map((n) => ({ t: a.offset + n.step * stepDur, c: cls(n.instrument) }));
    for (const c of ['kick', 'snare', 'hat']) {
      const T = truth.filter((h) => h.c === c);
      const G = got.filter((h) => h.c === c);
      const used = new Set<number>();
      let tp = 0;
      for (const g of G) {
        const i = T.findIndex((t, j) => !used.has(j) && Math.abs(t.t - g.t) < 0.04);
        if (i >= 0) {
          used.add(i);
          tp++;
        }
      }
      expect(tp / T.length, `${c} 찾은 비율`).toBeGreaterThan(0.8);
      expect(tp / Math.max(1, G.length), `${c} 정확도`).toBeGreaterThan(0.8);
    }
  });

  it('소리가 거의 없으면 알려 준다', async () => {
    await expect(analyzeDrums(new Float32Array(ANALYSIS_RATE * 3), ANALYSIS_RATE)).rejects.toThrow();
  });
});
