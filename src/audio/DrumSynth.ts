import type { Instrument } from '../core/types';

/** 샘플 없이 Web Audio로 합성하는 드럼 소리. 나중에 샘플 기반 엔진으로 교체할 수 있다. */
export class DrumSynth {
  readonly out: GainNode;
  private noise: AudioBuffer;
  /** 열린 하이햇은 다음 닫힘/페달에 의해 끊긴다(choke) */
  private openHat: GainNode | null = null;

  constructor(private ctx: AudioContext) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.out = ctx.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  play(instrument: Instrument, when: number, velocity: number) {
    const v = 0.15 + 0.85 * velocity;
    switch (instrument) {
      case 'kick':
        return this.kick(when, v);
      case 'snare':
        return this.snare(when, v);
      case 'hihatClosed':
        return this.hat(when, v * 0.6, 0.05);
      case 'hihatPedal':
        return this.hat(when, v * 0.35, 0.035);
      case 'hihatOpen':
        return this.hat(when, v * 0.55, 0.45, true);
      case 'tom1':
        return this.tom(when, v, 240);
      case 'tom2':
        return this.tom(when, v, 180);
      case 'floorTom':
        return this.tom(when, v, 115);
      case 'crash':
        return this.crash(when, v);
      case 'ride':
        return this.ride(when, v);
    }
  }

  click(when: number, accent: boolean) {
    const o = this.ctx.createOscillator();
    o.frequency.value = accent ? 1760 : 1320;
    const g = this.env(when, 0.25, 0.03);
    o.connect(g);
    o.start(when);
    o.stop(when + 0.05);
  }

  private env(when: number, peak: number, decay: number, attack = 0.002): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    g.connect(this.out);
    return g;
  }

  private noiseSource(when: number, duration: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(when, Math.random() * 0.5);
    src.stop(when + duration);
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private kick(when: number, v: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, when);
    o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
    o.connect(this.env(when, v * 1.1, 0.42));
    o.start(when);
    o.stop(when + 0.5);
    this.noiseSource(when, 0.02).connect(this.filter('highpass', 2500)).connect(this.env(when, v * 0.25, 0.012));
  }

  private snare(when: number, v: number) {
    this.noiseSource(when, 0.3).connect(this.filter('highpass', 1200)).connect(this.env(when, v * 0.7, 0.18));
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, when);
    o.frequency.exponentialRampToValueAtTime(170, when + 0.08);
    o.connect(this.env(when, v * 0.5, 0.1));
    o.start(when);
    o.stop(when + 0.15);
  }

  private metallic(when: number, duration: number, base: number): GainNode {
    const sum = this.ctx.createGain();
    sum.gain.value = 0.25;
    for (const ratio of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * ratio;
      o.connect(sum);
      o.start(when);
      o.stop(when + duration);
    }
    return sum;
  }

  private hat(when: number, v: number, decay: number, open = false) {
    if (this.openHat) {
      this.openHat.gain.cancelScheduledValues(when);
      this.openHat.gain.setTargetAtTime(0, when, 0.01);
      this.openHat = null;
    }
    const g = this.env(when, v, decay);
    this.metallic(when, decay + 0.05, 40)
      .connect(this.filter('bandpass', 10000, 0.8))
      .connect(this.filter('highpass', 7000))
      .connect(g);
    if (open) this.openHat = g;
  }

  private tom(when: number, v: number, freq: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(freq * 1.4, when);
    o.frequency.exponentialRampToValueAtTime(freq, when + 0.05);
    o.connect(this.env(when, v * 0.9, 0.45));
    o.start(when);
    o.stop(when + 0.55);
    this.noiseSource(when, 0.06).connect(this.filter('bandpass', freq * 6, 1)).connect(this.env(when, v * 0.25, 0.05));
  }

  private crash(when: number, v: number) {
    const g = this.env(when, v * 0.5, 1.8);
    this.noiseSource(when, 2).connect(this.filter('highpass', 4000)).connect(g);
    this.metallic(when, 2, 60).connect(this.filter('highpass', 5000)).connect(this.env(when, v * 0.35, 1.2));
  }

  private ride(when: number, v: number) {
    this.metallic(when, 1.3, 70).connect(this.filter('bandpass', 5500, 1.2)).connect(this.env(when, v * 0.45, 1.1));
    const bell = this.ctx.createOscillator();
    bell.frequency.value = 2400;
    bell.connect(this.env(when, v * 0.06, 0.5));
    bell.start(when);
    bell.stop(when + 0.6);
    this.noiseSource(when, 0.4).connect(this.filter('highpass', 8000)).connect(this.env(when, v * 0.12, 0.3));
  }
}
