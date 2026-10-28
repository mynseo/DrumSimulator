import { VELOCITY } from '../core/instruments';
import type { Instrument, Score, ScoreNote } from '../core/types';

/**
 * 텍스트 드럼 탭(ASCII 드럼 악보)을 악보로 바꾼다.
 *
 *   C |x---------------|----------------|
 *   HH|--x-x-x-x-x-x-x-|x-x-x-x-x-x-x-o-|
 *   S |----o-------o---|----o-------o---|
 *   B |o-------o-o-----|o-------o-o-----|
 *
 * - 한 마디는 '|'로 구분. 16칸이면 16분음표, 8칸이면 8분음표, 12칸이면 셋잇단으로 본다.
 * - 빈 줄로 나뉜 여러 단(시스템)은 이어 붙인다.
 * - x/o = 보통, X/O = 악센트, g 또는 ( = 고스트, f = 플램, 하이햇 줄의 o = 오픈 하이햇, 스네어 줄의 r = 림샷.
 */
export function parseDrumTab(text: string, title = '드럼 탭 가져오기', bpm = 100): Score {
  const blocks: { instrument: string; measures: string[] }[][] = [];
  let current: { instrument: string; measures: string[] }[] = [];

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9]{0,2})\s*[|:](.*)$/);
    const label = m ? LABELS[m[1].toUpperCase()] : undefined;
    if (!m || !label) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    const measures = m[2]
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && /^[-xXoOgf()#*rR.+]+$/.test(s));
    if (measures.length) current.push({ instrument: label, measures });
  }
  if (current.length) blocks.push(current);
  if (!blocks.length) throw new Error('드럼 탭을 못 찾았어요');

  const lengths = blocks.flatMap((b) => b.flatMap((l) => l.measures.map((s) => s.length)));
  const triplet = lengths.every((n) => n % 3 === 0 && 16 % n !== 0 && n % 16 !== 0);
  const stepsPerBeat = triplet ? 3 : 4;
  const stepsInBar = 4 * stepsPerBeat;

  const notes: ScoreNote[] = [];
  const seen = new Set<string>();
  let barBase = 0;
  for (const block of blocks) {
    let blockBars = 0;
    for (const { instrument, measures } of block) {
      blockBars = Math.max(blockBars, measures.length);
      measures.forEach((cells, bar) => {
        for (let i = 0; i < cells.length; i++) {
          const parsed = parseCell(instrument, cells[i]);
          if (!parsed) continue;
          const step = (barBase + bar) * stepsInBar + Math.min(stepsInBar - 1, Math.round((i * stepsInBar) / cells.length));
          const key = `${step}:${parsed.instrument}`;
          if (seen.has(key)) continue;
          seen.add(key);
          notes.push({ step, ...parsed });
        }
      });
    }
    barBase += blockBars;
  }

  return { version: 1, title, bpm, beatsPerBar: 4, stepsPerBeat, bars: Math.max(1, barBase), notes };
}

function parseCell(label: string, c: string): { instrument: Instrument; velocity: number; flam?: boolean } | null {
  if (c === '-' || c === '.') return null;
  // f = 플램 (보통 세게 친다)
  const flam = c === 'f' && label !== 'kick' && label !== 'hihatPedal';
  const velocity = c === 'X' || c === 'O' || flam ? VELOCITY.accent : c === 'g' || c === '(' ? VELOCITY.ghost : VELOCITY.normal;
  if (label === 'hihat') {
    return { instrument: c === 'o' || c === 'O' ? 'hihatOpen' : 'hihatClosed', velocity, ...(flam ? { flam } : {}) };
  }
  // 스네어 줄의 r/R = 림샷
  if (label === 'snare' && (c === 'r' || c === 'R')) return { instrument: 'rimshot', velocity: VELOCITY.accent };
  return { instrument: label as Instrument, velocity, ...(flam ? { flam } : {}) };
}

/** 탭 줄 머리말 → 악기 ('hihat'은 글자에 따라 열림/닫힘으로 나뉜다) */
const LABELS: Record<string, string> = {
  C: 'crash', CC: 'crash', CR: 'crash', C1: 'crash', C2: 'crash2', CY: 'crash',
  R: 'ride', RC: 'ride', RD: 'ride', RI: 'ride',
  H: 'hihat', HH: 'hihat', HC: 'hihat', HO: 'hihat',
  HF: 'hihatPedal', HP: 'hihatPedal', FH: 'hihatPedal', P: 'hihatPedal',
  S: 'snare', SD: 'snare', SN: 'snare', SR: 'snare',
  T: 'tom1', T1: 'tom1', HT: 'tom1', TT: 'tom1',
  T2: 'tom2', MT: 'tom2',
  T3: 'floorTom', FT: 'floorTom', LT: 'floorTom', FL: 'floorTom',
  B: 'kick', BD: 'kick', K: 'kick', KD: 'kick', BA: 'kick',
};
