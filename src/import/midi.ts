import { chooseSubdivision } from '../core/grid';
import type { Instrument, Score, ScoreNote } from '../core/types';

/** General MIDI 드럼 맵 (채널 10) → 시뮬레이터 악기 */
export const GM_DRUM_MAP: Record<number, Instrument> = {
  35: 'kick', 36: 'kick',
  37: 'snare', 38: 'snare', 39: 'snare', 40: 'rimshot',
  41: 'floorTom', 43: 'floorTom',
  42: 'hihatClosed', 44: 'hihatPedal', 46: 'hihatOpen',
  45: 'tom2', 47: 'tom2',
  48: 'tom1', 50: 'tom1',
  49: 'crash', 52: 'crash2', 55: 'crash', 57: 'crash2',
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

/** 표준 MIDI 파일(.mid)을 가장 잘 맞는 격자(16분음표·셋잇단·32분음표 등)로 양자화해 악보로 바꾼다. */
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

  const seen = new Set<string>();
  const notes: ScoreNote[] = [];
  let skipped = 0;
  // 플램: 같은 북을 32분 셋잇단보다 짧은 간격으로 두 번(앞이 약하게) 치면 앞 음은 꾸밈음
  const flamGap = division / 12;
  const graceOf = new Set<RawNote>();
  const flams = new Set<RawNote>();
  const byInstrument = new Map<Instrument, RawNote[]>();
  for (const n of [...source].sort((a, b) => a.tick - b.tick)) {
    const inst = GM_DRUM_MAP[n.key];
    if (!inst) continue;
    const list = byInstrument.get(inst) ?? [];
    const prev = list[list.length - 1];
    if (prev && !graceOf.has(prev) && n.tick - prev.tick > 0 && n.tick - prev.tick < flamGap && prev.velocity < n.velocity && inst !== 'kick' && inst !== 'hihatPedal') {
      graceOf.add(prev);
      flams.add(n);
    }
    list.push(n);
    byInstrument.set(inst, list);
  }
  // 16분음표·셋잇단·32분음표 중 음들이 가장 잘 맞는 격자
  const mapped = source.filter((n) => GM_DRUM_MAP[n.key] && !graceOf.has(n));
  const stepsPerBeat = chooseSubdivision(mapped.map((n) => ({ beat: n.tick / division, weight: n.velocity / 127 })));
  const ticksPerStep = division / stepsPerBeat;
  for (const n of source) {
    const instrument = GM_DRUM_MAP[n.key];
    if (!instrument) {
      skipped++;
      continue;
    }
    if (graceOf.has(n)) continue;
    const step = Math.round(n.tick / ticksPerStep);
    const key = `${step}:${instrument}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ step, instrument, velocity: Math.min(1, n.velocity / 127), ...(flams.has(n) ? { flam: true } : {}) });
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
