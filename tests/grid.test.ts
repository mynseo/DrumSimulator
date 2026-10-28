import { describe, expect, it } from 'vitest';
import { chooseSubdivision, fitSubdivision } from '../src/core/grid';

const at = (beats: number[]) => beats.map((beat) => ({ beat }));
const bars = (pattern: number[], n = 4) => Array.from({ length: n * 4 }, (_, b) => pattern.map((p) => b + p)).flat();

describe('박 나눔 고르기', () => {
  it('8분·16분음표는 16분 격자', () => {
    expect(chooseSubdivision(at(bars([0, 0.5])))).toBe(4);
    expect(chooseSubdivision(at(bars([0, 0.25, 0.5, 0.75])))).toBe(4);
  });

  it('셋잇단은 셋잇단 격자, 16분 셋잇단은 6칸', () => {
    expect(chooseSubdivision(at(bars([0, 2 / 3])))).toBe(3);
    expect(chooseSubdivision(at(bars([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6])))).toBe(6);
  });

  it('32분음표는 8칸, 셋잇단과 16분이 섞이면 12칸', () => {
    expect(chooseSubdivision(at(bars([0, 0.125, 0.25, 0.375])))).toBe(8);
    expect(chooseSubdivision(at([...bars([0, 0.25, 0.5, 0.75], 2), ...bars([0, 1 / 3, 2 / 3], 2).map((b) => b + 8)]))).toBe(12);
  });

  it('사람 연주의 작은 흔들림은 더 잘게 나누지 않는다', () => {
    let seed = 3;
    const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.04;
    expect(chooseSubdivision(at(bars([0, 0.25, 0.5, 0.75]).map((b) => b + jitter())))).toBe(4);
  });

  it('빠르기가 조금 틀려 뒤로 갈수록 밀려도 셋잇단을 알아보고 빠르기를 고친다', () => {
    const drift = 1.004; // 처음 잡은 박보다 실제 박이 0.4% 길다
    const fit = fitSubdivision(at(bars([0, 2 / 3], 8).map((b) => b * drift + 0.02)));
    expect(fit.subdivision).toBe(3);
    expect(fit.scale).toBeCloseTo(drift, 3);
    expect(fit.offset).toBeCloseTo(0.02, 2);
  });
});
