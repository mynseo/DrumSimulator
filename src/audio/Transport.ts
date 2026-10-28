import type { Instrument, Timeline } from '../core/types';
import { AudioEngine, DEFAULT_KIT, findKit } from './AudioEngine';

const LOOKAHEAD = 0.12;

/** 악보와 함께 트는 원곡. 악보 0번 칸 = 음원의 offset초, 음원의 원래 빠르기 = bpm */
export interface BackingTrack {
  buffer: AudioBuffer;
  offset: number;
  bpm: number;
}
const TICK_MS = 25;

/**
 * 재생 위치를 관리하고 오디오를 미리 예약한다.
 * 화면(애니메이션·피드백)은 이 클래스의 position만 읽어서 그리므로 소리와 화면이 같은 시계를 쓴다.
 */
export class Transport {
  loop = true;
  metronome = false;
  onEnded?: () => void;

  private ctx: AudioContext | null = null;
  private synth: AudioEngine | null = null;
  private kitId = DEFAULT_KIT;
  private vol = 0.8;
  private timer: number | null = null;
  /** position 0에 해당하는 AudioContext 시각 */
  private startTime = 0;
  /** 여기까지(반복을 펼친 노래 시각) 예약 완료 */
  private scheduledUntil = 0;
  private pausedAt = 0;
  private backing: BackingTrack | null = null;
  private backingGain: GainNode | null = null;
  private backingVol = 0.8;
  private backingSources: AudioBufferSourceNode[] = [];
  /** 다음 예약 때 지금 위치부터 원곡을 틀어야 한다 */
  private backingNeedsStart = false;

  constructor(private timeline: Timeline) {}

  get playing() {
    return this.timer !== null;
  }

  /** 현재 재생 위치(초, 0..duration) */
  get position(): number {
    if (!this.playing || !this.ctx) return this.pausedAt;
    return this.wrap(this.ctx.currentTime - this.startTime);
  }

  /** 오디오 엔진을 만들고 깨운다. 브라우저 정책상 사용자 입력(클릭·탭·키) 안에서 불러야 소리가 난다 */
  unlock(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.synth = new AudioEngine(this.ctx);
      this.synth.kit = findKit(this.kitId);
      this.synth.volume = this.vol;
      this.backingGain = this.ctx.createGain();
      this.backingGain.gain.value = this.backingVol;
      this.backingGain.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    return this.ctx;
  }

  /**
   * 사운드 킷을 바꾼다. 샘플 킷은 파일을 불러오는 동안에도 합성 소리로 대신 연주된다.
   * 오디오가 아직 깨어나지 않았어도 미리 불러온다(디코딩에는 사용자 입력이 필요 없다).
   */
  async setKit(id: string): Promise<void> {
    const kit = findKit(id);
    this.kitId = kit.id;
    if (this.synth) this.synth.kit = kit;
    await kit.load?.();
  }

  set volume(v: number) {
    this.vol = v;
    if (this.synth) this.synth.volume = v;
  }

  /** 원곡을 붙이거나(null이면) 뗀다 */
  setBacking(backing: BackingTrack | null) {
    this.backing = backing;
    this.restartBacking();
  }

  get hasBacking() {
    return this.backing !== null;
  }

  set backingVolume(v: number) {
    this.backingVol = v;
    if (this.backingGain) this.backingGain.gain.value = v;
  }

  /** 직접 연주: 지금 바로 소리를 낸다 */
  playNow(instrument: Instrument, velocity: number) {
    const ctx = this.unlock();
    this.synth!.play(instrument, ctx.currentTime, velocity);
  }

  /**
   * 직접 연주한 음을 악보에 녹음할 때, 실제로 들린 시점의 재생 위치.
   * 출력 지연만큼 앞당겨서 연주자가 들은 박자에 맞춘다.
   */
  get heardPosition(): number {
    if (!this.ctx) return this.position;
    const latency = (this.ctx.outputLatency || 0) + this.ctx.baseLatency;
    const d = this.timeline.duration;
    return (((this.position - latency) % d) + d) % d;
  }

  async play() {
    if (this.playing) return;
    await this.unlock().resume();
    const ctx = this.ctx!;
    const from = this.pausedAt >= this.timeline.duration ? 0 : this.pausedAt;
    this.startTime = ctx.currentTime + 0.05 - from;
    this.scheduledUntil = from;
    this.backingNeedsStart = true;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.position;
    this.halt();
  }

  stop() {
    this.halt();
    this.pausedAt = 0;
  }

  seek(position: number) {
    const pos = Math.max(0, Math.min(position, this.timeline.duration));
    if (this.playing && this.ctx) {
      this.startTime = this.ctx.currentTime - pos;
      this.scheduledUntil = pos;
      this.restartBacking();
    } else {
      this.pausedAt = pos;
    }
  }

  /** 악보가 바뀌면 현재 위치를 최대한 유지한 채 새 타임라인으로 갈아탄다. */
  setTimeline(timeline: Timeline) {
    const pos = this.position;
    const ratio = this.timeline.duration > 0 ? pos / this.timeline.duration : 0;
    const old = this.timeline;
    this.timeline = timeline;
    // 템포가 바뀌면 같은 박 위치를 유지한다
    const next = old.totalSteps === timeline.totalSteps ? ratio * timeline.duration : pos % (timeline.duration || 1);
    if (this.playing && this.ctx) {
      const ahead = this.scheduledUntil - (this.ctx.currentTime - this.startTime);
      this.startTime = this.ctx.currentTime - next;
      this.scheduledUntil = next + Math.max(0, ahead) * (timeline.duration / (old.duration || 1));
      // 음 하나를 고치는 정도면 원곡은 그대로 두고, 빠르기·길이가 바뀌었을 때만 다시 맞춘다
      if (old.duration !== timeline.duration) this.restartBacking();
    } else {
      this.pausedAt = next;
    }
  }

  private halt() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stopBacking();
  }

  private stopBacking() {
    for (const s of this.backingSources) {
      try {
        s.stop();
      } catch {
        /* 이미 멈춤 */
      }
    }
    this.backingSources = [];
  }

  private restartBacking() {
    this.stopBacking();
    this.backingNeedsStart = this.playing;
  }

  /**
   * 노래 시각 t(반복을 펼친 값)부터 그 반복이 끝날 때까지 원곡 구간을 예약한다.
   * 악보 빠르기가 원곡과 다르면 재생 속도를 같은 비율로 바꿔 박을 맞춘다.
   */
  private startBacking(t: number) {
    const b = this.backing;
    if (!b || !this.ctx || !this.backingGain) return;
    const { duration, stepDuration, stepsPerBeat } = this.timeline;
    const rate = 60 / (stepDuration * stepsPerBeat) / b.bpm;
    const loopStart = this.loop ? Math.floor(t / duration) * duration : 0;
    const p = t - loopStart;
    if (p >= duration) return;
    let when = this.startTime + t;
    let audioAt = b.offset + p * rate;
    let length = (duration - p) * rate;
    // 이미 지난 시각이면 늦은 만큼 건너뛴다
    const late = this.ctx.currentTime - when;
    if (late > 0) {
      when += late;
      audioAt += late * rate;
      length -= late * rate;
    }
    // 원곡이 악보보다 늦게 시작하면(앞부분이 비면) 그만큼 기다렸다가 튼다
    if (audioAt < 0) {
      when += -audioAt / rate;
      length += audioAt;
      audioAt = 0;
    }
    if (length <= 0 || audioAt >= b.buffer.duration) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b.buffer;
    src.playbackRate.value = rate;
    src.connect(this.backingGain);
    src.start(when, audioAt, length);
    this.backingSources.push(src);
    src.onended = () => (this.backingSources = this.backingSources.filter((x) => x !== src));
  }

  private wrap(t: number): number {
    const d = this.timeline.duration;
    if (t < 0) return 0;
    if (this.loop) return t % d;
    return Math.min(t, d);
  }

  private schedule() {
    if (!this.ctx || !this.synth) return;
    const { hits, duration, stepDuration, stepsPerBeat, barStarts } = this.timeline;
    const downbeats = new Set(barStarts);
    const now = this.ctx.currentTime - this.startTime;
    const until = now + LOOKAHEAD;

    if (!this.loop && now >= duration + 0.3) {
      this.stop();
      this.onEnded?.();
      return;
    }

    const from = this.scheduledUntil;
    if (this.backingNeedsStart) {
      this.backingNeedsStart = false;
      this.startBacking(from);
    }
    if (until <= from) return;
    const firstLoop = Math.floor(from / duration);
    const lastLoop = this.loop ? Math.floor(until / duration) : 0;
    for (let k = firstLoop; k <= lastLoop; k++) {
      const offset = k * duration;
      // 반복이 새로 시작될 때 원곡도 처음부터 (지금 위치에서 이미 튼 구간은 제외)
      if (offset > from && offset < until) this.startBacking(offset);
      for (const h of hits) {
        const t = h.time + offset;
        if (t >= from && t < until) this.synth.play(h.instrument, this.startTime + t, h.velocity);
      }
      if (this.metronome) {
        const beatLen = stepDuration * stepsPerBeat;
        const beats = Math.round(duration / beatLen);
        for (let b = 0; b < beats; b++) {
          const t = b * beatLen + offset;
          if (t >= from && t < until) this.synth.click(this.startTime + t, downbeats.has(b * stepsPerBeat));
        }
      }
    }
    this.scheduledUntil = until;
  }
}
