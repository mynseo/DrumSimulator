/**
 * 마이크 소리에서 타격 순간을 실시간으로 찾는다.
 *
 * 소리를 4ms씩 끊어 세 대역(킥의 낮은 소리 · 스네어/탐의 몸통 · 하이햇/심벌의 높은 소리)의
 * 크기를 재고, 어느 대역이든 바로 앞보다 갑자기 커지면 타격으로 본다.
 * 대역을 나눠 보기 때문에 스네어가 울리는 중에 친 하이햇처럼 겹친 소리도 따로 잡힌다.
 * 주변 소음 크기를 계속 따라가며 그보다 뚜렷이 큰 소리만 센다.
 */

export interface Onset {
  /** 듣기 시작한 뒤 몇 초째인지 (샘플 수로 세므로 화면이 버벅여도 정확하다) */
  time: number;
  /** 타격의 크기 (진폭). 강세를 가릴 때 쓴다 */
  strength: number;
}

const HOP_SEC = 0.004;
/** 이보다 가까운 두 타격은 하나로 본다 (플램·한 타격의 잔향) */
const MIN_GAP = 0.05;
/** 바로 앞보다 이만큼(로그 에너지) 커져야 타격이다. 1 ≈ 에너지 2.7배 */
const RISE = 1.0;
/** 처음 이만큼은 소음 크기를 재느라 타격을 세지 않는다 */
const WARMUP = 0.1;
const BANDS = 3;
/** 대역마다 크기를 재는 창 길이(홉 수). 낮은 소리는 한 주기가 길어서 더 길게 본다 */
const WINDOW = [4, 2, 2];
const HISTORY = 8;

export class OnsetDetector {
  readonly hop: number;
  /** 지금까지 들은 길이(초) */
  time = 0;
  /** 입력 크기 0..1 (레벨 미터용, 천천히 내려간다) */
  level = 0;

  private readonly aLow: number;
  private readonly aMid: number;
  private lpLow = 0;
  private lpMid = 0;
  private acc = [0, 0, 0];
  private fill = 0;
  private hops = 0;
  private history: number[][] = Array.from({ length: BANDS }, () => new Array<number>(HISTORY).fill(0));
  private noise = [Infinity, Infinity, Infinity];
  private odfPrev = 0;
  private odfPrev2 = 0;
  private ampPrev = 0;
  private odfMean = 0;
  private lastOnset = -Infinity;

  constructor(readonly sampleRate: number) {
    this.hop = Math.max(16, Math.round(sampleRate * HOP_SEC));
    this.aLow = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
    this.aMid = 1 - Math.exp((-2 * Math.PI * 2500) / sampleRate);
  }

  push(samples: Float32Array): Onset[] {
    const out: Onset[] = [];
    const { acc, hop } = this;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const a = x < 0 ? -x : x;
      if (a > peak) peak = a;
      this.lpLow += this.aLow * (x - this.lpLow);
      this.lpMid += this.aMid * (x - this.lpMid);
      const low = this.lpLow;
      const mid = this.lpMid - low;
      const high = x - this.lpMid;
      acc[0] += low * low;
      acc[1] += mid * mid;
      acc[2] += high * high;
      if (++this.fill === hop) {
        const onset = this.endHop();
        if (onset) out.push(onset);
        acc[0] = acc[1] = acc[2] = 0;
        this.fill = 0;
      }
    }
    this.level = Math.max(peak, this.level * Math.exp(-samples.length / (this.sampleRate * 0.3)));
    this.time = (this.hops * hop + this.fill) / this.sampleRate;
    return out;
  }

  private endHop(): Onset | null {
    let odf = 0;
    let total = 0;
    for (let b = 0; b < BANDS; b++) {
      const e = this.acc[b] / this.hop;
      const h = this.history[b];
      h.shift();
      h.push(e);
      // 소음 바닥: 조용해지면 바로 내려가고, 시끄러우면 아주 천천히 올라간다
      this.noise[b] = e < this.noise[b] ? e : Math.max(this.noise[b] * 1.0005, 1e-12);
      const w = WINDOW[b];
      let now = 0;
      let before = 0;
      for (let k = 0; k < w; k++) {
        now += h[HISTORY - 1 - k];
        before += h[HISTORY - 1 - w - k];
      }
      const floor = (1e-9 + 4 * this.noise[b]) * w;
      const d = Math.log((now + floor) / (before + floor));
      if (d > 0) odf += d;
      total += now / w;
    }
    const amp = Math.sqrt(total);
    this.hops++;

    // 한 홉 전이 봉우리였는지 본다 (이번 홉에서 꺾였어야 봉우리다)
    let onset: Onset | null = null;
    const threshold = RISE + 2 * this.odfMean;
    const t = (Math.max(0, this.hops - 3) * this.hop) / this.sampleRate;
    if (t > WARMUP && this.odfPrev > threshold && this.odfPrev >= this.odfPrev2 && this.odfPrev > odf && t - this.lastOnset >= MIN_GAP) {
      onset = { time: t, strength: Math.max(this.ampPrev, amp) };
      this.lastOnset = t;
    }
    this.odfMean += (odf - this.odfMean) * 0.01;
    this.odfPrev2 = this.odfPrev;
    this.odfPrev = odf;
    this.ampPrev = amp;
    return onset;
  }
}
