import { describe, expect, it } from 'vitest';
import { findOnset, pickLayer } from '../src/audio/kits/sampled';
import { SOUND_KITS } from '../src/audio/AudioEngine';

describe('샘플 킷', () => {
  it('세기에 맞는 녹음을 고른다', () => {
    const layers = [{ upTo: 0.45, f: 'soft' }, { upTo: 0.85, f: 'mid' }, { upTo: 1, f: 'hard' }];
    expect(pickLayer(layers, 0.3).f).toBe('soft');
    expect(pickLayer(layers, 0.45).f).toBe('soft');
    expect(pickLayer(layers, 0.75).f).toBe('mid');
    expect(pickLayer(layers, 1).f).toBe('hard');
  });

  it('앞부분 무음을 건너뛰고 타격 1ms 전부터 재생한다', () => {
    const sampleRate = 1000;
    const data = new Float32Array(100);
    data[30] = 0.05; // 피크의 10% 미만: 잡음
    data[40] = 0.5;
    data[41] = 1;
    const buffer = { sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
    expect(findOnset(buffer)).toBeCloseTo(0.039, 6);
  });

  it('킷 id가 겹치지 않는다', () => {
    const ids = SOUND_KITS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
