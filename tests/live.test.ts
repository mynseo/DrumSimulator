import { describe, expect, it } from 'vitest';
import { LiveSticking } from '../src/core/sticking';

describe('직접 연주 손발 배정', () => {
  it('하이햇과 스네어를 거의 동시에 치면 하이햇은 오른손, 스네어는 왼손', () => {
    const s = new LiveSticking();
    expect(s.next('hihatClosed', 10)).toBe('RH');
    expect(s.next('snare', 10.01)).toBe('LH');
  });

  it('빠른 스네어 연타는 오른손부터 번갈아 친다', () => {
    const s = new LiveSticking();
    const limbs = [0, 0.1, 0.2, 0.3].map((t) => s.next('snare', 5 + t));
    expect(limbs).toEqual(['RH', 'LH', 'RH', 'LH']);
  });

  it('킥은 오른발, 하이햇 페달은 왼발', () => {
    const s = new LiveSticking();
    expect(s.next('kick', 1)).toBe('RF');
    expect(s.next('hihatPedal', 1)).toBe('LF');
  });
});
