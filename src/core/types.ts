/** 악보에서 쓰는 개별 소리(같은 하이햇이라도 닫힘/열림/페달은 다른 소리). */
export type Instrument =
  | 'crash'
  | 'crash2'
  | 'ride'
  | 'hihatOpen'
  | 'hihatClosed'
  | 'tom1'
  | 'tom2'
  | 'floorTom'
  | 'snare'
  | 'rimshot'
  | 'kick'
  | 'hihatPedal';

/** 3D 드럼 세트의 물리적인 부품. 여러 Instrument가 같은 부품을 칠 수 있다. */
export type PieceId = 'crash' | 'crash2' | 'ride' | 'hihat' | 'tom1' | 'tom2' | 'floorTom' | 'snare' | 'kick';

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
  /** 플램: 다른 손이 아주 살짝 먼저 약하게 친다 (손으로 치는 악기만) */
  flam?: boolean;
  /** PDF 악보에서 읽은 기호 ("머리모양:오선위치[:o 열림 표시][:r ride 글씨]"). 기호별 악기 지정에 쓴다 */
  mark?: string;
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
  /** 마디마다 박 수 (곡 중간에 박자가 바뀔 때만). 없으면 모든 마디가 beatsPerBar */
  barBeats?: number[];
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
  /** 플램의 꾸밈음: 본 음보다 조금 먼저 다른 손이 약하게 친 것 */
  grace?: boolean;
  /** 더블 스트로크의 둘째 타: 손목을 다시 들지 않고 튕겨서 친다 (조금 약하다) */
  rebound?: boolean;
}

export interface Timeline {
  /** 전체 길이(초) */
  duration: number;
  stepDuration: number;
  totalSteps: number;
  stepsPerBeat: number;
  beatsPerBar: number;
  /** 마디 시작 칸 (마지막 원소 = 전체 칸 수) */
  barStarts: number[];
  hits: Hit[];
  byLimb: Record<Limb, Hit[]>;
  byPiece: Record<PieceId, Hit[]>;
}
