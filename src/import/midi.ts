import type { Instrument, Score, ScoreNote } from '../core/types';

/** General MIDI 드럼 맵 (채널 10) → 시뮬레이터 악기 */
export const GM_DRUM_MAP: Record<number, Instrument> = {
  35: 'kick', 36: 'kick',
  37: 'snare', 38: 'snare', 39: 'snare', 40: 'snare',
  41: 'floorTom', 43: 'floorTom',
  42: 'hihatClosed', 44: 'hihatPedal', 46: 'hihatOpen',
  45: 'tom2', 47: 'tom2',
  48: 'tom1', 50: 'tom1',
  49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash',
  51: 'ride', 53: 'ride', 59: 'ride',
};

const DRUM_CHANNEL = 9;
const MAX_BARS = 128;

interface RawNote {
  tick: number;
  channel: number;
  key: number;
  velocity: number;
}

export interface MidiImportResult {
  score: Score;
  /** 매핑되지 않아 버린 음 개수 */
  skipped: number;
}

/** 표준 MIDI 파일(.mid)을 16분음표 격자로 양자화해 악보로 바꾼다. */
export function parseMidi(buffer: ArrayBuffer, title = 'MIDI 가져오기'): MidiImportResult {
  const r = new Reader(new DataView(buffer));
  if (r.str(4) !== 'MThd') throw new Error('MIDI 파일이 아닙니다 (MThd 헤더 없음)');
  const headerLen = r.u32();
  r.u16(); // format
  const trackCount = r.u16();
  const division = r.u16();
  r.skip(headerLen - 6);
  if (division & 0x8000) throw new Error('SMPTE 시간 단위 MIDI는 아직 지원하지 않습니다');

  let tempo = 500000; // μs per quarter
  let tempoSet = false;
  let beatsPerBar = 4;
  const raw: RawNote[] = [];

  for (let t = 0; t < trackCount && !r.eof(); t++) {
    if (r.str(4) !== 'MTrk') throw new Error('잘못된 MIDI 트랙');
    const end = r.pos + r.u32();
    let tick = 0;
    let running = 0;
    while (r.pos < end) {
      tick += r.vlq();
      let status = r.u8();
      if (status < 0x80) {
        // running status: 방금 읽은 바이트는 데이터
        r.pos--;
        status = running;
      }
      if (status === 0xff) {
        const type = r.u8();
        const len = r.vlq();
        if (type === 0x51 && len === 3 && !tempoSet) {
          tempo = (r.u8() << 16) | (r.u8() << 8) | r.u8();
          tempoSet = true;
        } else if (type === 0x58 && len >= 2) {
          const num = r.u8();
          const denPow = r.u8();
          beatsPerBar = Math.max(1, Math.round((num * 4) / 2 ** denPow));
          r.skip(len - 2);
        } else {
          r.skip(len);
        }
      } else if (status === 0xf0 || status === 0xf7) {
        r.skip(r.vlq());
      } else {
        running = status;
        const kind = status & 0xf0;
        const channel = status & 0x0f;
        if (kind === 0xc0 || kind === 0xd0) {
          r.u8();
        } else {
          const key = r.u8();
          const vel = r.u8();
          if (kind === 0x90 && vel > 0) raw.push({ tick, channel, key, velocity: vel });
        }
      }
    }
    r.pos = end;
  }

  const hasDrumChannel = raw.some((n) => n.channel === DRUM_CHANNEL);
  const source = hasDrumChannel ? raw.filter((n) => n.channel === DRUM_CHANNEL) : raw;

  const stepsPerBeat = 4;
  const ticksPerStep = division / stepsPerBeat;
  const seen = new Set<string>();
  const notes: ScoreNote[] = [];
  let skipped = 0;
  for (const n of source) {
    const instrument = GM_DRUM_MAP[n.key];
    if (!instrument) {
      skipped++;
      continue;
    }
    const step = Math.round(n.tick / ticksPerStep);
    const key = `${step}:${instrument}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ step, instrument, velocity: Math.min(1, n.velocity / 127) });
  }

  const stepsInBar = beatsPerBar * stepsPerBeat;
  const maxStep = notes.reduce((m, n) => Math.max(m, n.step), 0);
  const bars = Math.min(MAX_BARS, Math.max(1, Math.ceil((maxStep + 1) / stepsInBar)));

  return {
    score: {
      version: 1,
      title,
      bpm: Math.round(60_000_000 / tempo),
      beatsPerBar,
      stepsPerBeat,
      bars,
      notes: notes.filter((n) => n.step < bars * stepsInBar),
    },
    skipped,
  };
}

class Reader {
  pos = 0;
  constructor(private view: DataView) {}
  eof() {
    return this.pos >= this.view.byteLength;
  }
  u8() {
    return this.view.getUint8(this.pos++);
  }
  u16() {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  str(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  vlq() {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  }
  skip(n: number) {
    this.pos += n;
  }
}
