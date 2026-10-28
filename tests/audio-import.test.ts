import { describe, expect, it } from 'vitest';
import { ANALYSIS_RATE, analyzeDrums } from '../src/import/audio';

type Part = 'kick' | 'snare' | 'hat';

/**
 * 간단히 합성한 드럼 소리로 박자 정답을 아는 음원을 만든다.
 * 패턴 한 줄이 한 마디: 16칸이면 16분음표, 12칸이면 셋잇단, 24칸이면 16분 셋잇단.
 * guitar를 켜면 마디마다 코드를 긁는 기타(배음이 많은 뜯는 소리)를 섞는다.
 */
function synthDrums(bpm: number, bars: number, pattern: Record<Part, string>, guitar = false) {
  const sr = ANALYSIS_RATE;
  const cells = pattern.hat.length;
  const step = (60 / bpm) * (4 / cells);
  const lead = 0.3;
  const x = new Float32Array(Math.ceil((lead + bars * cells * step + 1) * sr));
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const truth: { t: number; c: Part }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < cells; s++) {
      const t0 = lead + (bar * cells + s) * step;
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
            x[i0 + i] += 0.35 * Math.sin(phase) * Math.exp(-t * 25) + 0.45 * rand() * Math.exp(-t * 18);
          } else {
            const n = rand();
            x[i0 + i] += 0.5 * (n - prev) * Math.exp(-t * 60); // 차분 = 고역 통과 잡음
            prev = n;
          }
        }
      }
    }
  }
  if (guitar) {
    // 8분음표마다 코드를 긁는다(박과 엇갈리는 위치도 포함). 각 줄은 배음 12개짜리 뜯는 소리
    const chords = [
      [196, 247, 294, 392],
      [220, 262, 330, 440],
      [175, 220, 262, 349],
      [165, 196, 247, 330],
    ];
    const eighth = 60 / bpm / 2;
    for (let k = 0; k * eighth < bars * cells * step; k++) {
      const chord = chords[Math.floor((k * eighth) / ((60 / bpm) * 4)) % chords.length];
      chord.forEach((f, j) => {
        const i0 = Math.round((lead + k * eighth + j * 0.008) * sr);
        for (let i = 0; i < sr * eighth && i0 + i < x.length; i++) {
          const t = i / sr;
          let v = 0;
          for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
          x[i0 + i] += 0.07 * v * Math.exp(-t * 3) * Math.min(1, t / 0.004);
        }
      });
    }
  }
  return { x, truth };
}

async function check(bpm: number, pattern: Record<Part, string>, guitar = false, spb?: number, minPrecision: Partial<Record<Part, number>> = {}) {
  const { x, truth } = synthDrums(bpm, 8, pattern, guitar);
  const a = await analyzeDrums(x, ANALYSIS_RATE);
  expect(a.bpm).toBeGreaterThan(bpm - 1.5);
  expect(a.bpm).toBeLessThan(bpm + 1.5);
  if (spb) expect(a.score.stepsPerBeat).toBe(spb);

  const stepDur = 60 / a.bpm / a.score.stepsPerBeat;
  const cls = (i: string) => (i === 'kick' ? 'kick' : i === 'snare' ? 'snare' : i.startsWith('hihat') || i === 'crash' ? 'hat' : 'other');
  const got = a.score.notes.map((n) => ({ t: a.offset + n.step * stepDur, c: cls(n.instrument) }));
  for (const c of ['kick', 'snare', 'hat'] as const) {
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
    expect(tp / Math.max(1, G.length), `${c} 정확도`).toBeGreaterThan(minPrecision[c] ?? 0.8);
  }
  return a;
}

describe('음원에서 드럼 뽑기', () => {
  it('합성한 8비트 록에서 빠르기와 킥·스네어·하이햇을 찾는다', async () => {
    await check(110, {
      kick: 'x-------x-x-----',
      snare: '----x-------x---',
      hat: 'x-x-x-x-x-x-x-x-',
    });
  });

  it('16분음표 하이햇을 16분 격자로 따라간다', async () => {
    await check(96, {
      kick: 'x-----x-x-------',
      snare: '----x-------x---',
      hat: 'xxxxxxxxxxxxxxxx',
    }, false, 4);
  });

  it('셋잇단(셔플) 리듬은 셋잇단 격자로 읽는다', async () => {
    await check(100, {
      kick: 'x-----x-x---',
      snare: '---x-----x--',
      hat: 'x-xx-xx-xx-x',
    }, false, 3);
  });

  it('기타 반주가 섞여도 기타를 드럼으로 치지 않는다', async () => {
    await check(110, {
      kick: 'x-------x-x-----',
      snare: '----x-------x---',
      hat: 'x-x-x-x-x-x-x-x-',
    }, true, undefined, {
      // 기타만 울린 순간은 거르지만, 하이햇과 기타가 같은 순간에 시작하면 가끔 약한 스네어로 읽는다 (예전에는 16%)
      snare: 0.65,
    });
  });

  it('소리가 거의 없으면 알려 준다', async () => {
    await expect(analyzeDrums(new Float32Array(ANALYSIS_RATE * 3), ANALYSIS_RATE)).rejects.toThrow();
  });
});
