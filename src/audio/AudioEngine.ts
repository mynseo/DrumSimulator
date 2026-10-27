import type { Instrument } from '../core/types';
import { AcousticKit, CustomKit } from './kits/sampled';
import { BASIC_KIT, KIT_808, KIT_CHIP, KIT_ELECTRO } from './kits/synth';
import type { SoundKit } from './kits/types';
import { Voice } from './Voice';

const acoustic = new AcousticKit();
export const customKit = new CustomKit(acoustic);

/** 고를 수 있는 사운드 킷 (메뉴 순서) */
export const SOUND_KITS: SoundKit[] = [acoustic, BASIC_KIT, KIT_808, KIT_ELECTRO, KIT_CHIP, customKit];
export const DEFAULT_KIT = acoustic.id;

export function findKit(id: string): SoundKit {
  return SOUND_KITS.find((k) => k.id === id) ?? SOUND_KITS[0];
}

/**
 * 소리를 내는 곳. 킷이 만든 소리를 받아 하이햇 끊기(choke), 전체 볼륨, 컴프레서를 처리한다.
 * OfflineAudioContext로도 만들 수 있어서 테스트에서 실제로 소리를 렌더링해 볼 수 있다.
 */
export class AudioEngine {
  kit: SoundKit = findKit(DEFAULT_KIT);
  private master: GainNode;
  private noise: AudioBuffer;
  /** 열린 하이햇은 다음 닫힘/페달에 의해 끊긴다 */
  private openHat: GainNode | null = null;

  constructor(readonly ctx: BaseAudioContext) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  set volume(v: number) {
    this.master.gain.value = v;
  }

  play(instrument: Instrument, when: number, velocity: number, kit = this.kit) {
    if (instrument !== 'hihatOpen' && instrument.startsWith('hihat') && this.openHat) {
      this.openHat.gain.cancelScheduledValues(when);
      this.openHat.gain.setTargetAtTime(0, when, 0.012);
      this.openHat = null;
    }
    const out = this.ctx.createGain();
    out.connect(this.master);
    kit.play(new Voice(this.ctx, out, this.noise), instrument, when, velocity);
    if (instrument === 'hihatOpen') this.openHat = out;
  }

  /** 메트로놈: 킷과 상관없이 같은 소리 */
  click(when: number, accent: boolean) {
    const out = this.ctx.createGain();
    out.connect(this.master);
    const v = new Voice(this.ctx, out, this.noise);
    v.osc('sine', when, 0.05, accent ? 1760 : 1320).connect(v.env(when, 0.25, 0.03));
  }
}
