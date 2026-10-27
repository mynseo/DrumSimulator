import type { Timeline } from '../core/types';
import { DrumSynth } from './DrumSynth';

const LOOKAHEAD = 0.12;
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
  private synth: DrumSynth | null = null;
  private timer: number | null = null;
  /** position 0에 해당하는 AudioContext 시각 */
  private startTime = 0;
  /** 여기까지(반복을 펼친 노래 시각) 예약 완료 */
  private scheduledUntil = 0;
  private pausedAt = 0;

  constructor(private timeline: Timeline) {}

  get playing() {
    return this.timer !== null;
  }

  /** 현재 재생 위치(초, 0..duration) */
  get position(): number {
    if (!this.playing || !this.ctx) return this.pausedAt;
    return this.wrap(this.ctx.currentTime - this.startTime);
  }

  async play() {
    if (this.playing) return;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.synth = new DrumSynth(this.ctx);
    }
    await this.ctx.resume();
    const from = this.pausedAt >= this.timeline.duration ? 0 : this.pausedAt;
    this.startTime = this.ctx.currentTime + 0.05 - from;
    this.scheduledUntil = from;
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
    } else {
      this.pausedAt = next;
    }
  }

  private halt() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private wrap(t: number): number {
    const d = this.timeline.duration;
    if (t < 0) return 0;
    if (this.loop) return t % d;
    return Math.min(t, d);
  }

  private schedule() {
    if (!this.ctx || !this.synth) return;
    const { hits, duration, stepDuration, stepsPerBeat, beatsPerBar } = this.timeline;
    const now = this.ctx.currentTime - this.startTime;
    const until = now + LOOKAHEAD;

    if (!this.loop && now >= duration + 0.3) {
      this.stop();
      this.onEnded?.();
      return;
    }

    const from = this.scheduledUntil;
    if (until <= from) return;
    const firstLoop = Math.floor(from / duration);
    const lastLoop = this.loop ? Math.floor(until / duration) : 0;
    for (let k = firstLoop; k <= lastLoop; k++) {
      const offset = k * duration;
      for (const h of hits) {
        const t = h.time + offset;
        if (t >= from && t < until) this.synth.play(h.instrument, this.startTime + t, h.velocity);
      }
      if (this.metronome) {
        const beatLen = stepDuration * stepsPerBeat;
        const beats = Math.round(duration / beatLen);
        for (let b = 0; b < beats; b++) {
          const t = b * beatLen + offset;
          if (t >= from && t < until) this.synth.click(this.startTime + t, b % beatsPerBar === 0);
        }
      }
    }
    this.scheduledUntil = until;
  }
}
