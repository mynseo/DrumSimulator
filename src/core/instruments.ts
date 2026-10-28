import type { Instrument, PieceId } from './types';

export interface InstrumentInfo {
  id: Instrument;
  label: string;
  piece: PieceId;
  /** 손으로 치는지, 어느 발로 치는지 */
  kind: 'hand' | 'RF' | 'LF';
  /** 드러머 기준 좌우 위치 (오른쪽이 +). 손 배정 비용 계산에 쓴다 */
  lateral: number;
  /** 오른손이 박자를 유지하는 악기 (하이햇·라이드) */
  timekeeper?: boolean;
  cymbal?: boolean;
}

/** 에디터에 위에서부터 보이는 순서 */
export const INSTRUMENTS: InstrumentInfo[] = [
  { id: 'crash', label: '크래시', piece: 'crash', kind: 'hand', lateral: -0.45, cymbal: true },
  { id: 'crash2', label: '크래시 2', piece: 'crash2', kind: 'hand', lateral: 0.42, cymbal: true },
  { id: 'ride', label: '라이드', piece: 'ride', kind: 'hand', lateral: 0.62, cymbal: true, timekeeper: true },
  { id: 'hihatOpen', label: '하이햇 열림', piece: 'hihat', kind: 'hand', lateral: -0.48, cymbal: true, timekeeper: true },
  { id: 'hihatClosed', label: '하이햇 닫힘', piece: 'hihat', kind: 'hand', lateral: -0.48, cymbal: true, timekeeper: true },
  { id: 'tom1', label: '하이 탐', piece: 'tom1', kind: 'hand', lateral: -0.12 },
  { id: 'tom2', label: '미드 탐', piece: 'tom2', kind: 'hand', lateral: 0.17 },
  { id: 'floorTom', label: '플로어 탐', piece: 'floorTom', kind: 'hand', lateral: 0.45 },
  { id: 'snare', label: '스네어', piece: 'snare', kind: 'hand', lateral: -0.22 },
  { id: 'kick', label: '킥', piece: 'kick', kind: 'RF', lateral: 0.05 },
  { id: 'hihatPedal', label: '하이햇 페달', piece: 'hihat', kind: 'LF', lateral: -0.32 },
];

export const INSTRUMENT_INFO: Record<Instrument, InstrumentInfo> = Object.fromEntries(
  INSTRUMENTS.map((i) => [i.id, i]),
) as Record<Instrument, InstrumentInfo>;

export const INSTRUMENT_ORDER: Record<Instrument, number> = Object.fromEntries(
  INSTRUMENTS.map((i, idx) => [i.id, idx]),
) as Record<Instrument, number>;

export const PIECES: PieceId[] = ['crash', 'crash2', 'ride', 'hihat', 'tom1', 'tom2', 'floorTom', 'snare', 'kick'];

export const VELOCITY = { ghost: 0.35, normal: 0.75, accent: 1 } as const;
