import type { Instrument } from '../../core/types';
import type { Voice } from '../Voice';
import { level, playBasic } from './synth';
import type { SoundKit } from './types';

/** 디코딩된 샘플과, 실제 소리가 시작되는 위치(초) */
export interface Sample {
  buffer: AudioBuffer;
  /** mp3 인코더 지연·녹음 앞부분의 무음을 건너뛰는 재생 시작점 */
  offset: number;
}

let decoder: OfflineAudioContext | null = null;

/**
 * 오디오 파일을 디코딩한다. 재생용 AudioContext 없이도(사용자 입력 전에도) 미리 불러올 수 있도록
 * 별도의 OfflineAudioContext로 디코딩한다. AudioBuffer는 어느 컨텍스트에서나 재생할 수 있다.
 */
export async function decodeSample(data: ArrayBuffer): Promise<Sample> {
  decoder ??= new OfflineAudioContext(1, 1, 44100);
  const buffer = await decoder.decodeAudioData(data);
  return { buffer, offset: findOnset(buffer) };
}

/** 피크의 10%를 처음 넘는 지점보다 1ms 앞. 브라우저마다 다른 mp3 앞부분 지연을 없앤다 */
export function findOnset(buffer: AudioBuffer): number {
  const d = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak === 0) return 0;
  const threshold = peak * 0.1;
  let i = 0;
  while (i < d.length && Math.abs(d[i]) < threshold) i++;
  return Math.max(0, i - buffer.sampleRate * 0.001) / buffer.sampleRate;
}

interface Layer {
  file: string;
  /** 이 세기 이하일 때 쓰는 샘플 (마지막 층은 1) */
  upTo: number;
}

/** 세기에 맞는 녹음을 고른다: 살살 치면 부드러운 음색, 세게 치면 단단한 음색 */
export function pickLayer<T extends { upTo: number }>(layers: T[], velocity: number): T {
  return layers.find((l) => velocity <= l.upTo) ?? layers[layers.length - 1];
}

interface SampledVoice {
  layers: Layer[];
  gain: number;
  rate?: number;
}

const ACOUSTIC: Record<Instrument, SampledVoice> = {
  kick: { layers: [{ file: 'kick-soft', upTo: 0.55 }, { file: 'kick', upTo: 1 }], gain: 1.0, rate: 1.08 },
  snare: {
    layers: [
      { file: 'snare-soft', upTo: 0.45 },
      { file: 'snare', upTo: 0.85 },
      { file: 'snare-hard', upTo: 1 },
    ],
    gain: 0.75,
  },
  tom1: { layers: [{ file: 'tom-hi-soft', upTo: 0.5 }, { file: 'tom-hi', upTo: 1 }], gain: 0.8 },
  tom2: { layers: [{ file: 'tom-lo-soft', upTo: 0.5 }, { file: 'tom-lo', upTo: 1 }], gain: 0.8, rate: 1.12 },
  floorTom: { layers: [{ file: 'tom-lo-soft', upTo: 0.5 }, { file: 'tom-lo', upTo: 1 }], gain: 0.85, rate: 0.8 },
  hihatClosed: { layers: [{ file: 'hihat-closed-soft', upTo: 0.6 }, { file: 'hihat-closed', upTo: 1 }], gain: 0.42 },
  hihatOpen: { layers: [{ file: 'hihat-open', upTo: 1 }], gain: 0.42 },
  hihatPedal: { layers: [{ file: 'hihat-pedal', upTo: 1 }], gain: 0.35 },
  crash: { layers: [{ file: 'crash', upTo: 1 }], gain: 0.75 },
  ride: { layers: [{ file: 'ride', upTo: 1 }], gain: 0.45 },
};
const RIDE_BELL = 'ride-bell';

const ACOUSTIC_FILES = [...new Set([...Object.values(ACOUSTIC).flatMap((v) => v.layers.map((l) => l.file)), RIDE_BELL])];

/** 세기 → 샘플 볼륨. 합성 킷보다 실제 녹음은 셈여림 폭을 조금 더 넓게 둔다 */
const sampleLevel = (velocity: number) => 1.3 * (0.12 + 0.88 * velocity ** 1.3);

/**
 * 실제로 녹음한 드럼 소리.
 * 출처: Versilian Community Sample Library (VCSL), CC0 1.0 — https://github.com/sgossner/VCSL
 * 원본을 다듬는 과정은 scripts/prepare_samples.py 참고.
 */
export class AcousticKit implements SoundKit {
  readonly id = 'acoustic';
  readonly name = '어쿠스틱 (실제 녹음)';
  readonly description = '실제 드럼을 녹음한 소리 · 세기에 따라 음색이 바뀝니다';
  private samples = new Map<string, Sample>();
  private loading: Promise<void> | null = null;

  constructor(private baseUrl = 'samples/acoustic/') {}

  ready() {
    return this.samples.size === ACOUSTIC_FILES.length;
  }

  load(): Promise<void> {
    this.loading ??= Promise.all(
      ACOUSTIC_FILES.map(async (file) => {
        const res = await fetch(`${this.baseUrl}${file}.mp3`);
        if (!res.ok) throw new Error(`${file}.mp3: ${res.status}`);
        this.samples.set(file, await decodeSample(await res.arrayBuffer()));
      }),
    ).then(
      () => undefined,
      (e) => {
        this.loading = null; // 다음에 다시 시도할 수 있게
        throw e;
      },
    );
    return this.loading;
  }

  play(v: Voice, instrument: Instrument, when: number, velocity: number) {
    const def = ACOUSTIC[instrument];
    const s = this.samples.get(pickLayer(def.layers, velocity).file);
    if (!s) return playBasic(v, instrument, when, velocity); // 아직 못 불러왔으면 합성 소리로
    const g = sampleLevel(velocity) * def.gain;
    v.sample(s.buffer, when, g, def.rate ?? 1, s.offset);
    if (instrument === 'ride') {
      const bell = this.samples.get(RIDE_BELL);
      if (bell) v.sample(bell.buffer, when, g * 0.25, 1, bell.offset);
    }
    if (instrument === 'kick') {
      // 원본이 큰 북이라 발 드럼처럼 들리도록 비터가 닿는 소리를 살짝 더한다
      v.noise(when, 0.02).connect(v.filter('bandpass', 3500, 0.8)).connect(v.env(when, g * 0.18, 0.012, 0.0005));
    }
  }
}

/**
 * 사용자가 고른 오디오 파일로 치는 킷. 파일이 없는 악기는 어쿠스틱(없으면 기본 합성) 소리를 쓴다.
 */
export class CustomKit implements SoundKit {
  readonly id = 'custom';
  readonly name = '내 샘플';
  readonly description = '내가 가진 오디오 파일을 악기마다 넣어서 연주';
  readonly samples = new Map<Instrument, Sample & { name: string }>();

  constructor(private fallback: AcousticKit) {}

  ready() {
    return true;
  }

  load() {
    // 비어 있는 악기를 채울 어쿠스틱 소리. 실패해도 기본 합성으로 대신한다
    return this.fallback.load().catch(() => undefined);
  }

  play(v: Voice, instrument: Instrument, when: number, velocity: number) {
    const s = this.samples.get(instrument);
    if (!s) return this.fallback.play(v, instrument, when, velocity);
    v.sample(s.buffer, when, level(velocity), 1, s.offset);
  }
}
