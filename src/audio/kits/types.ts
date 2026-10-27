import type { Instrument } from '../../core/types';
import type { Voice } from '../Voice';

/** 사운드 킷: 같은 악보를 다른 소리로 연주한다 */
export interface SoundKit {
  id: string;
  name: string;
  /** 고르는 메뉴에 붙는 한 줄 설명 */
  description: string;
  /** 샘플을 받아야 하는 킷은 여기서 불러온다. 실패해도 play는 대체 소리로 동작해야 한다 */
  load?(): Promise<void>;
  /** 이미 불러왔거나 불러올 필요가 없으면 true */
  ready(): boolean;
  play(voice: Voice, instrument: Instrument, when: number, velocity: number): void;
}
