import { describe, expect, it } from 'vitest';
import { parseYouTubeId, snapRate } from '../src/ui/YouTubeSync';

describe('유튜브 링크', () => {
  it('여러 모양의 주소에서 영상 ID를 찾는다', () => {
    const id = 'dQw4w9WgXcQ';
    for (const url of [
      id,
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=42s`,
      `https://m.youtube.com/watch?feature=share&v=${id}`,
      `https://music.youtube.com/watch?v=${id}&list=RD`,
      `https://youtu.be/${id}?si=abc`,
      `youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}?feature=shared`,
    ]) {
      expect(parseYouTubeId(url)).toBe(id);
    }
  });

  it('유튜브가 아니면 못 찾는다', () => {
    expect(parseYouTubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('그냥 글자')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/')).toBeNull();
  });

  it('영상이 낼 수 있는 가장 가까운 속도를 고른다', () => {
    const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    expect(snapRate(1, rates)).toBe(1);
    expect(snapRate(0.8, rates)).toBe(0.75);
    expect(snapRate(3, rates)).toBe(2);
    expect(snapRate(0.9, [])).toBe(1);
  });
});
