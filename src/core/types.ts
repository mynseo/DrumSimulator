/** 악보에서 쓰는 개별 소리(같은 하이햇이라도 닫힘/열림/페달은 다른 소리). */
export type Instrument =
  | 'crash'
  | 'ride'
  | 'hihatOpen'
  | 'hihatClosed'
  | 'tom1'
  | 'tom2'
  | 'floorTom'
  | 'snare'
  | 'kick'
  | 'hihatPedal';

/** 3D 드럼 세트의 물리적인 부품. 여러 Instrument가 같은 부품을 칠 수 있다. */
export type PieceId = 'crash' | 'ride' | 'hihat' | 'tom1' | 'tom2' | 'floorTom' | 'snare' | 'kick';

export type Hand = 'R' | 'L';
/** RH/LH = 오른손/왼손, RF/LF = 오른발/왼발 */
export type Limb = 'RH' | 'LH' | 'RF' | 'LF';
export const LIMBS: Limb[] = ['RH', 'LH', 'RF', 'LF'];

export interface ScoreNote {
  /** 악보 시작부터의 칸 번호 (stepsPerBeat 해상도) */
  step: number;
  instrument: Instrument;
  /** 0..1 (고스트 ≈ 0.35, 보통 ≈ 0.75, 악센트 = 1) */
  velocity: number;
  /** 사용자가 지정한 손. 없으면 자동 배정 */
  hand?: Hand;
}

export interface Score {
  version: 1;
  title: string;
  bpm: number;
  beatsPerBar: number;
  /** 한 박을 몇 칸으로 나눌지: 4 = 16분음표, 3 = 셋잇단 8분음표 */
  stepsPerBeat: number;
  bars: number;
  notes: ScoreNote[];
}

/** 타임라인에 올라간 한 번의 타격 (시간·손발 배정까지 끝난 상태). */
export interface Hit {
  time: number;
  step: number;
  instrument: Instrument;
  piece: PieceId;
  /** null = 동시에 칠 수 있는 손이 없어 소리만 나는 음 */
  limb: Limb | null;
  velocity: number;
  handForced: boolean;
}

export interface Timeline {
  /** 전체 길이(초) */
  duration: number;
  stepDuration: number;
  totalSteps: number;
  stepsPerBeat: number;
  beatsPerBar: number;
  hits: Hit[];
  byLimb: Record<Limb, Hit[]>;
  byPiece: Record<PieceId, Hit[]>;
}
