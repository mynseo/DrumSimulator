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

  it('f는 플램', () => {
    const s = parseDrumTab('S |----f-------x---|\nB |x---------------|');
    const snare = s.notes.filter((n) => n.instrument === 'snare');
    expect(snare.map((n) => [n.step, !!n.flam])).toEqual([[4, true], [12, false]]);
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

  it('셋잇단으로 친 곡은 셋잇단 격자로 가져온다', () => {
    // 셔플: 매 박의 첫째·셋째 셋잇단에 하이햇, 2·4박 스네어
    const events: [number, number, number, number][] = [];
    for (let beat = 0; beat < 8; beat++) {
      events.push([beat * 480, 9, 42, 90], [beat * 480 + 320, 9, 42, 70]);
      if (beat % 2 === 1) events.push([beat * 480, 9, 38, 110]);
    }
    events.sort((a, b) => a[0] - b[0]);
    const { score } = parseMidi(midi(events));
    expect(score.stepsPerBeat).toBe(3);
    const hats = score.notes.filter((n) => n.instrument === 'hihatClosed').map((n) => n.step);
    expect(hats.slice(0, 4)).toEqual([0, 2, 3, 5]);
  });

  it('32분음표 롤은 32분 격자로 가져온다', () => {
    const events: [number, number, number, number][] = [];
    for (let i = 0; i < 32; i++) events.push([i * 60, 9, 38, 100]);
    const { score } = parseMidi(midi(events));
    expect(score.stepsPerBeat).toBe(8);
    expect(score.notes.map((n) => n.step)).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });

  it('같은 북을 아주 짧은 간격으로 약-강 두 번 치면 플램으로 읽는다', () => {
    const { score } = parseMidi(midi([[0, 9, 36, 100], [455, 9, 38, 40], [480, 9, 38, 120], [960, 9, 38, 100]]));
    const snare = score.notes.filter((n) => n.instrument === 'snare');
    expect(snare.map((n) => [n.step, !!n.flam])).toEqual([[4, true], [8, false]]);
  });
});
