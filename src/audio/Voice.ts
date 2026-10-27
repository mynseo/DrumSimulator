/**
 * 한 번의 타격 소리를 만드는 도구 모음. 만든 소리는 모두 out(이 타격 전용 볼륨)으로 나간다.
 * 사운드 킷은 이 도구로 소리를 짜맞추고, 엔진은 out을 통해 하이햇 끊기(choke)·볼륨을 처리한다.
 */
export class Voice {
  constructor(
    readonly ctx: BaseAudioContext,
    readonly out: AudioNode,
    private noiseBuffer: AudioBuffer,
  ) {}

  /** attack 후 decay 동안 지수적으로 줄어드는 볼륨. out에 연결되어 있다 */
  env(when: number, peak: number, decay: number, attack = 0.002): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    g.connect(this.out);
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  noise(when: number, duration: number, buffer = this.noiseBuffer, rate = 1): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(when, Math.random() * buffer.duration);
    src.stop(when + duration);
    return src;
  }

  /** 주파수가 from에서 to로 sweep초 동안 떨어지는 오실레이터 */
  osc(type: OscillatorType, when: number, duration: number, from: number, to = from, sweep = 0.05): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, when);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, when + sweep);
    o.start(when);
    o.stop(when + duration);
    return o;
  }

  /** 비화성 사각파 여섯 개: 하이햇·심벌의 금속성 소리 (TR-808 방식) */
  metallic(when: number, duration: number, base: number): GainNode {
    const sum = this.ctx.createGain();
    sum.gain.value = 0.25;
    for (const ratio of [2, 3, 4.16, 5.43, 6.79, 8.21]) this.osc('square', when, duration, base * ratio).connect(sum);
    return sum;
  }

  /** 녹음된 샘플 재생 */
  sample(buffer: AudioBuffer, when: number, gain: number, rate = 1, offset = 0): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.out);
    src.start(when, offset);
    return src;
  }

  /** 소리를 거칠게 만드는 웨이브셰이퍼 (아날로그 드럼머신의 찌그러짐) */
  drive(amount: number): WaveShaperNode {
    const ws = this.ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    ws.curve = curve;
    return ws;
  }
}
