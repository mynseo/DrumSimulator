import type { Instrument } from '../../core/types';
import type { Voice } from '../Voice';
import type { SoundKit } from './types';

/** 합성 킷: 샘플 없이 오실레이터·노이즈로 만든다. 불러올 것이 없어 항상 준비되어 있다 */
function synthKit(id: string, name: string, description: string, play: SoundKit['play']): SoundKit {
  return { id, name, description, ready: () => true, play };
}

/** 오른쪽 크래시(크래시 2)는 왼쪽보다 작은 심벌: 조금 높고 짧게 */
const CRASH2_PITCH = 1.18;

/**
 * 세기 → 볼륨. 사람 귀는 소리 크기를 로그로 느끼므로 곡선을 가파르게 둔다:
 * 고스트(0.35) ≈ 0.19, 보통(0.75) ≈ 0.62, 악센트(1) = 1 → 고스트와 보통은 약 10dB, 보통과 악센트는 약 4dB 차이
 */
export const level = (velocity: number) => 0.05 + 0.95 * velocity ** 1.8;

// ---------------------------------------------------------------------------
// 기본: 처음부터 쓰던 합성 드럼
// ---------------------------------------------------------------------------
export function playBasic(v: Voice, instrument: Instrument, when: number, velocity: number) {
  const g = level(velocity);
  const k = instrument === 'crash2' ? CRASH2_PITCH : 1;
  switch (instrument) {
    case 'kick':
      v.osc('sine', when, 0.5, 150, 45, 0.12).connect(v.env(when, g * 1.1, 0.42));
      v.noise(when, 0.02).connect(v.filter('highpass', 2500)).connect(v.env(when, g * 0.25, 0.012));
      return;
    case 'snare':
      v.noise(when, 0.3).connect(v.filter('highpass', 1200)).connect(v.env(when, g * 0.7, 0.18));
      v.osc('triangle', when, 0.15, 220, 170, 0.08).connect(v.env(when, g * 0.5, 0.1));
      return;
    case 'hihatClosed':
    case 'hihatPedal':
    case 'hihatOpen': {
      const [peak, decay] = instrument === 'hihatOpen' ? [0.55, 0.45] : instrument === 'hihatPedal' ? [0.35, 0.035] : [0.6, 0.05];
      v.metallic(when, decay + 0.05, 40)
        .connect(v.filter('bandpass', 10000, 0.8))
        .connect(v.filter('highpass', 7000))
        .connect(v.env(when, g * peak, decay));
      return;
    }
    case 'tom1':
    case 'tom2':
    case 'floorTom': {
      const f = { tom1: 240, tom2: 180, floorTom: 115 }[instrument];
      v.osc('sine', when, 0.55, f * 1.4, f, 0.05).connect(v.env(when, g * 0.9, 0.45));
      v.noise(when, 0.06).connect(v.filter('bandpass', f * 6, 1)).connect(v.env(when, g * 0.25, 0.05));
      return;
    }
    case 'crash':
    case 'crash2':
      v.noise(when, 2 / k).connect(v.filter('highpass', 4000 * k)).connect(v.env(when, g * 0.5, 1.8 / k));
      v.metallic(when, 2, 60 * k).connect(v.filter('highpass', 5000 * k)).connect(v.env(when, g * 0.35, 1.2 / k));
      return;
    case 'ride':
      v.metallic(when, 1.3, 70).connect(v.filter('bandpass', 5500, 1.2)).connect(v.env(when, g * 0.45, 1.1));
      v.osc('sine', when, 0.6, 2400).connect(v.env(when, g * 0.06, 0.5));
      v.noise(when, 0.4).connect(v.filter('highpass', 8000)).connect(v.env(when, g * 0.12, 0.3));
      return;
  }
}

// ---------------------------------------------------------------------------
// 808: 길게 울리는 킥, 두 음 스네어, 사각파 금속음 하이햇 (힙합·트랩)
// ---------------------------------------------------------------------------
function play808(v: Voice, instrument: Instrument, when: number, velocity: number) {
  const g = level(velocity);
  const k = instrument === 'crash2' ? CRASH2_PITCH : 1;
  switch (instrument) {
    case 'kick': {
      const drive = v.drive(1.6);
      drive.connect(v.env(when, g * 1.0, 1.1, 0.001));
      v.osc('sine', when, 1.3, 110, 48, 0.07).connect(drive);
      return;
    }
    case 'snare':
      v.osc('triangle', when, 0.2, 238, 180, 0.03).connect(v.env(when, g * 0.45, 0.11));
      v.osc('triangle', when, 0.2, 476, 330, 0.03).connect(v.env(when, g * 0.3, 0.07));
      v.noise(when, 0.3).connect(v.filter('highpass', 1800)).connect(v.env(when, g * 0.55, 0.2));
      return;
    case 'hihatClosed':
    case 'hihatPedal':
    case 'hihatOpen': {
      const [peak, decay] = instrument === 'hihatOpen' ? [0.5, 0.42] : instrument === 'hihatPedal' ? [0.3, 0.03] : [0.55, 0.045];
      v.metallic(when, decay + 0.05, 40)
        .connect(v.filter('bandpass', 10500, 1))
        .connect(v.filter('highpass', 8000))
        .connect(v.env(when, g * peak, decay, 0.001));
      return;
    }
    case 'tom1':
    case 'tom2':
    case 'floorTom': {
      const f = { tom1: 200, tom2: 140, floorTom: 95 }[instrument];
      v.osc('sine', when, 0.7, f * 1.25, f, 0.12).connect(v.env(when, g * 0.95, 0.55, 0.001));
      v.noise(when, 0.02).connect(v.filter('lowpass', 3000)).connect(v.env(when, g * 0.08, 0.015));
      return;
    }
    case 'crash':
    case 'crash2':
      v.metallic(when, 2.2, 52 * k).connect(v.filter('highpass', 6000 * k)).connect(v.env(when, g * 0.5, 1.9 / k, 0.001));
      v.noise(when, 1.4).connect(v.filter('highpass', 7000 * k)).connect(v.env(when, g * 0.2, 1.2 / k));
      return;
    case 'ride':
      v.metallic(when, 1.2, 62).connect(v.filter('bandpass', 7500, 1.4)).connect(v.env(when, g * 0.5, 1.0, 0.001));
      return;
  }
}

// ---------------------------------------------------------------------------
// 일렉트로닉 (909 계열): 펀치감 있는 킥, 노이즈 스네어, 밝은 하이햇 (하우스·테크노)
// ---------------------------------------------------------------------------
function playElectro(v: Voice, instrument: Instrument, when: number, velocity: number) {
  const g = level(velocity);
  const k = instrument === 'crash2' ? CRASH2_PITCH : 1;
  switch (instrument) {
    case 'kick': {
      const drive = v.drive(3);
      drive.connect(v.env(when, g * 0.95, 0.5, 0.001));
      v.osc('sine', when, 0.6, 230, 52, 0.035).connect(drive);
      v.noise(when, 0.01).connect(v.filter('highpass', 4000)).connect(v.env(when, g * 0.35, 0.006, 0.0005));
      return;
    }
    case 'snare':
      v.osc('triangle', when, 0.15, 260, 190, 0.02).connect(v.env(when, g * 0.45, 0.08));
      v.noise(when, 0.35).connect(v.filter('bandpass', 5000, 0.6)).connect(v.env(when, g * 0.75, 0.24));
      v.noise(when, 0.05).connect(v.filter('highpass', 7000)).connect(v.env(when, g * 0.3, 0.03));
      return;
    case 'hihatClosed':
    case 'hihatPedal':
    case 'hihatOpen': {
      const [peak, decay] = instrument === 'hihatOpen' ? [0.45, 0.32] : instrument === 'hihatPedal' ? [0.25, 0.025] : [0.5, 0.06];
      v.noise(when, decay + 0.05).connect(v.filter('highpass', 9000)).connect(v.env(when, g * peak, decay, 0.001));
      v.metallic(when, decay, 55).connect(v.filter('highpass', 9500)).connect(v.env(when, g * peak * 0.4, decay * 0.7, 0.001));
      return;
    }
    case 'tom1':
    case 'tom2':
    case 'floorTom': {
      const f = { tom1: 300, tom2: 210, floorTom: 140 }[instrument];
      v.osc('sine', when, 0.45, f * 1.6, f, 0.06).connect(v.env(when, g * 0.9, 0.32, 0.001));
      v.noise(when, 0.03).connect(v.filter('bandpass', f * 8, 1)).connect(v.env(when, g * 0.2, 0.02));
      return;
    }
    case 'crash':
    case 'crash2':
      v.noise(when, 1.6).connect(v.filter('highpass', 5000 * k)).connect(v.env(when, g * 0.55, 1.3 / k, 0.001));
      v.metallic(when, 1.4, 75 * k).connect(v.filter('highpass', 6000 * k)).connect(v.env(when, g * 0.25, 0.9 / k));
      return;
    case 'ride':
      v.metallic(when, 0.9, 90).connect(v.filter('bandpass', 8000, 2)).connect(v.env(when, g * 0.45, 0.75, 0.001));
      v.noise(when, 0.3).connect(v.filter('highpass', 10000)).connect(v.env(when, g * 0.12, 0.2));
      return;
  }
}

// ---------------------------------------------------------------------------
// 8비트: 옛날 게임기 소리 (사각파·삼각파, 거친 디지털 노이즈)
// ---------------------------------------------------------------------------
const chipNoiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
/** 같은 값을 여러 샘플 반복한 노이즈: 낮은 해상도의 게임기 노이즈 채널을 흉내 낸다 */
function chipNoise(ctx: BaseAudioContext): AudioBuffer {
  let buf = chipNoiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let value = 0;
    for (let i = 0; i < d.length; i++) {
      if (i % 4 === 0) value = Math.random() < 0.5 ? -1 : 1;
      d[i] = value;
    }
    chipNoiseCache.set(ctx, buf);
  }
  return buf;
}

function playChip(v: Voice, instrument: Instrument, when: number, velocity: number) {
  const g = level(velocity) * 0.6;
  const k = instrument === 'crash2' ? CRASH2_PITCH : 1;
  const noise = chipNoise(v.ctx);
  switch (instrument) {
    case 'kick':
      v.osc('triangle', when, 0.25, 160, 40, 0.09).connect(v.env(when, g * 1.6, 0.18, 0.001));
      v.osc('square', when, 0.03, 90).connect(v.env(when, g * 0.4, 0.02, 0.001));
      return;
    case 'snare':
      v.noise(when, 0.2, noise, 0.6).connect(v.env(when, g * 1.0, 0.14, 0.001));
      v.osc('square', when, 0.06, 240, 160, 0.04).connect(v.env(when, g * 0.35, 0.05, 0.001));
      return;
    case 'hihatClosed':
    case 'hihatPedal':
    case 'hihatOpen': {
      const [peak, decay] = instrument === 'hihatOpen' ? [0.45, 0.25] : instrument === 'hihatPedal' ? [0.25, 0.02] : [0.45, 0.035];
      v.noise(when, decay + 0.05, noise, 2).connect(v.filter('highpass', 7000)).connect(v.env(when, g * peak, decay, 0.001));
      return;
    }
    case 'tom1':
    case 'tom2':
    case 'floorTom': {
      const f = { tom1: 330, tom2: 247, floorTom: 165 }[instrument];
      v.osc('square', when, 0.25, f, f * 0.5, 0.2).connect(v.env(when, g * 1.7, 0.2, 0.001));
      return;
    }
    case 'crash':
    case 'crash2':
      v.noise(when, 1.1, noise, 0.9 * k).connect(v.filter('highpass', 3000 * k)).connect(v.env(when, g * 0.6, 0.9 / k, 0.001));
      return;
    case 'ride':
      v.osc('square', when, 0.12, 1568).connect(v.env(when, g * 0.25, 0.1, 0.001));
      v.noise(when, 0.5, noise, 1.5).connect(v.filter('highpass', 8000)).connect(v.env(when, g * 0.25, 0.4, 0.001));
      return;
  }
}

export const BASIC_KIT = synthKit('basic', '기본 합성', '가볍고 단순한 합성 드럼', playBasic);
export const KIT_808 = synthKit('808', '808', '길게 울리는 킥 · 힙합, 트랩', play808);
export const KIT_ELECTRO = synthKit('electro', '일렉트로닉', '펀치감 있는 909 계열 · 하우스, 테크노', playElectro);
export const KIT_CHIP = synthKit('chip', '8비트', '옛날 게임기 소리', playChip);
