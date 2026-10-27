import { describe, expect, it } from 'vitest';
import { parseMidi } from '../src/import/midi';
import { parseDrumTab } from '../src/import/tab';

describe('드럼 탭', () => {
  it('16칸 마디와 여러 단을 읽는다', () => {
    const s = parseDrumTab(`
HH|x-x-x-x-x-x-x-o-|
S |----o-------o---|
B |o-------o-o-----|

HH|x-x-x-x-x-x-x-x-|
B |o---------------|
`);
    expect(s.bars).toBe(2);
    expect(s.stepsPerBeat).toBe(4);
    expect(s.notes.filter((n) => n.instrument === 'hihatOpen').map((n) => n.step)).toEqual([14]);
    expect(s.notes.filter((n) => n.instrument === 'snare').map((n) => n.step)).toEqual([4, 12]);
    expect(s.notes.filter((n) => n.instrument === 'kick').map((n) => n.step)).toEqual([0, 8, 10, 16]);
  });

  it('8칸 마디는 16분음표 격자에 맞춘다', () => {
    const s = parseDrumTab('HH|xxxxxxxx|');
    expect(s.notes.map((n) => n.step)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it('12칸 마디는 셋잇단으로 읽는다', () => {
    const s = parseDrumTab('R |x--x-xx--x-x|');
    expect(s.stepsPerBeat).toBe(3);
    expect(s.notes.map((n) => n.step)).toEqual([0, 3, 5, 6, 9, 11]);
  });

  it('탭이 없으면 오류', () => {
    expect(() => parseDrumTab('hello')).toThrow();
  });
});

/** 테스트용 최소 MIDI 파일 작성기 */
function midi(events: [number, number, number, number][], division = 480, bpm = 120): ArrayBuffer {
  const bytes: number[] = [];
  const u32 = (v: number) => bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const vlq = (v: number, out: number[]) => {
    const stack = [v & 0x7f];
    while ((v >>= 7)) stack.unshift((v & 0x7f) | 0x80);
    out.push(...stack);
  };
  const track: number[] = [];
  const tempo = Math.round(60_000_000 / bpm);
  track.push(0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255);
  let last = 0;
  for (const [tick, channel, key, vel] of events) {
    vlq(tick - last, track);
    last = tick;
    track.push(0x90 | channel, key, vel);
  }
  track.push(0, 0xff, 0x2f, 0);
  bytes.push(...'MThd'.split('').map((c) => c.charCodeAt(0)));
  u32(6);
  bytes.push(0, 0, 0, 1, (division >> 8) & 255, division & 255);
  bytes.push(...'MTrk'.split('').map((c) => c.charCodeAt(0)));
  u32(track.length);
  bytes.push(...track);
  return new Uint8Array(bytes).buffer;
}

describe('MIDI', () => {
  it('GM 드럼 채널의 음을 16분음표 격자로 가져온다', () => {
    const { score, skipped } = parseMidi(
      midi([
        [0, 9, 36, 100],
        [0, 9, 42, 80],
        [480, 9, 38, 127],
        [960, 9, 81, 60], // 트라이앵글: 지원 안 함
        [1925, 9, 46, 90], // 살짝 어긋난 타이밍도 양자화
      ], 480, 90),
    );
    expect(score.bpm).toBe(90);
    expect(skipped).toBe(1);
    expect(score.notes.map((n) => [n.step, n.instrument])).toEqual([
      [0, 'kick'],
      [0, 'hihatClosed'],
      [4, 'snare'],
      [16, 'hihatOpen'],
    ]);
    expect(score.bars).toBe(2);
  });
});
