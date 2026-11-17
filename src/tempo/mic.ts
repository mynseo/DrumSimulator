/**
 * 마이크 소리를 받아 온다. 소리는 이 기기 안에서만 쓰고 어디에도 보내거나 저장하지 않는다.
 *
 * 오디오 스레드(AudioWorklet)에서 샘플을 그대로 넘겨받는다. 타격 시각은 샘플 수로 세므로
 * 화면이 잠깐 멈춰도 빠르기 계산은 어긋나지 않는다.
 */

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf);
          this.buf = new Float32Array(1024);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('tempo-tap', Tap);
`;

export interface Mic {
  sampleRate: number;
  stop(): void;
}

export async function openMic(onSamples: (samples: Float32Array) => void): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
    throw new Error('이 브라우저에서는 마이크를 쓸 수 없어요');
  }
  // 통화용 보정(울림 제거·소음 제거·자동 음량)은 드럼 타격을 뭉개므로 끈다
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    await ctx.resume();
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw e;
  }
  const source = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, 'tempo-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data);
  // 소리는 내지 않지만, 출력에 이어 둬야 브라우저가 계속 처리한다
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(tap).connect(mute).connect(ctx.destination);

  return {
    sampleRate: ctx.sampleRate,
    stop() {
      tap.port.onmessage = null;
      source.disconnect();
      tap.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
