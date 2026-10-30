/**
 * 유튜브 원곡을 악보와 함께 튼다.
 * 영상 소리는 페이지가 직접 들을 수 없으므로(유튜브 정책) 박 위치를 자동으로 찾지 못한다.
 * 대신 사용자가 "맞추기"를 눌러 악보의 지금 자리가 영상의 어디인지 한 번 탭해서 알려 준다.
 * 악보 시계가 기준이고, 영상이 어긋나면 그 자리로 옮긴다.
 *
 * 영상 시각 = offset + 악보 시각 × (지금 빠르기 / 맞출 때 빠르기)
 */

const API_URL = 'https://www.youtube.com/iframe_api';
/** 이만큼(초) 어긋나면 영상을 옮긴다 */
const DRIFT = 0.15;
/** 영상을 옮긴 뒤 다시 재지 않는 시간 (옮기는 데 걸리는 시간) */
const SETTLE_MS = 1500;
/** 맞추기를 시작할 때 박 자리보다 이만큼 앞부터 들려준다 */
const LEAD_IN = 4;
const SAVED_KEY = 'drumsim.youtube.v1';

/** 유튜브 주소(또는 영상 ID)에서 영상 ID를 찾는다 */
export function parseYouTubeId(text: string): string | null {
  const s = text.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
    if (!id && m) id = m[1];
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** 영상이 낼 수 있는 재생 속도 중 가장 가까운 것 */
export function snapRate(rate: number, available: number[]): number {
  if (!available.length) return 1;
  return available.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best), available[0]);
}

// ---- 유튜브 IFrame API (필요한 부분만) ----
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  setVolume(v: number): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number | string>;
      events?: { onReady?: () => void; onError?: (e: { data: number }) => void };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
const BUFFERING = 3;

let apiPromise: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const timer = window.setTimeout(() => fail(), 10000);
    const fail = () => {
      apiPromise = null;
      window.clearTimeout(timer);
      reject(new Error('유튜브 플레이어를 불러오지 못했어요'));
    };
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      window.clearTimeout(timer);
      if (window.YT) resolve(window.YT);
      else fail();
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.onerror = fail;
    document.head.append(script);
  });
  return apiPromise;
}

interface Saved {
  id: string;
  offset: number;
  baseBpm: number;
}

function loadSaved(): Record<string, Saved> {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, Saved>;
  } catch {
    return {};
  }
}

export interface SyncState {
  /** 악보 재생 위치(초) */
  position: number;
  playing: boolean;
  /** 악보의 첫 빠르기 */
  bpm: number;
}

export class YouTubeSync {
  onMessage?: (msg: string) => void;
  /** 영상을 연결하거나 끊을 때 */
  onChange?: () => void;

  private player: YTPlayer | null = null;
  private ready = false;
  private videoId: string | null = null;
  private offset = 0;
  /** 맞출 때 악보 빠르기. 지금 빠르기가 다르면 영상도 그 비율로 */
  private baseBpm = 120;
  private rate = 1;
  private settleUntil = 0;
  private lastPosition = -1;
  private aligning = false;
  /** 사용자가 맞춘 자리를 옮겼다: 어긋남이 작아도 다시 맞춘다 */
  private forceSeek = false;
  /** 영상이 아직 시작하지 않은 자리(offset 앞)에서 악보가 도는 중 */
  private waiting = false;
  private title = '';

  constructor(
    private box: HTMLElement,
    private host: HTMLElement,
    private alignBtn: HTMLButtonElement,
    private offsetEl: HTMLElement,
    private getState: () => SyncState,
  ) {}

  get linked() {
    return this.videoId !== null;
  }

  get isAligning() {
    return this.aligning;
  }

  /** 곡이 바뀌면 그 곡에 맞춰 둔 영상을 다시 쓰고, 없으면 영상을 둔 채 빠르기만 새로 잡는다 */
  songChanged(title: string, bpm: number) {
    this.title = title;
    this.stopAligning();
    const saved = loadSaved()[title];
    if (saved) {
      void this.link(saved.id, saved.offset, saved.baseBpm);
      return;
    }
    this.baseBpm = bpm;
    this.showOffset();
  }

  async link(id: string, offset = 0, baseBpm = this.getState().bpm) {
    this.offset = offset;
    this.baseBpm = baseBpm;
    this.showOffset();
    if (this.videoId === id && this.player) return;
    this.close(false);
    this.videoId = id;
    this.box.hidden = false;
    this.onChange?.();
    let YT: YTNamespace;
    try {
      YT = await loadApi();
    } catch (e) {
      this.close();
      this.onMessage?.(`${(e as Error).message}. 이 화면에서는 유튜브가 막혀 있을 수 있어요`);
      return;
    }
    if (this.videoId !== id) return;
    const el = document.createElement('div');
    this.host.replaceChildren(el);
    this.ready = false;
    this.player = new YT.Player(el, {
      videoId: id,
      width: '100%',
      height: '100%',
      // 재생은 악보 버튼으로만 (영상 쪽에서 따로 움직이면 박이 어긋난다)
      playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 0, iv_load_policy: 3 },
      events: {
        onReady: () => {
          this.ready = true;
          this.rate = 0;
          this.lastPosition = -1;
          this.save();
        },
        onError: (e) => {
          const blocked = e.data === 101 || e.data === 150;
          this.onMessage?.(blocked ? '이 영상은 올린 사람이 다른 사이트에서 못 틀게 막아 두었어요' : '영상을 틀 수 없어요');
          this.close();
        },
      },
    });
  }

  /** 사용자가 영상을 끊으면 이 곡에 기억해 둔 영상도 지운다 */
  unlink() {
    try {
      const all = loadSaved();
      delete all[this.title];
      localStorage.setItem(SAVED_KEY, JSON.stringify(all));
    } catch {
      /* 저장 불가 환경 */
    }
    this.close();
  }

  close(notify = true) {
    this.stopAligning();
    this.player?.destroy();
    this.player = null;
    this.ready = false;
    this.videoId = null;
    this.host.replaceChildren();
    this.box.hidden = true;
    if (notify) this.onChange?.();
  }

  /** 원곡 음량 (0..1.2) */
  set volume(v: number) {
    if (this.ready) this.player!.setVolume(Math.round(Math.min(1, v / 1.2) * 100));
  }

  /** 영상을 조금 앞·뒤로 (초) */
  nudge(seconds: number) {
    this.offset = Math.round((this.offset + seconds) * 100) / 100;
    this.forceSeek = true;
    this.lastPosition = -1;
    this.showOffset();
    this.save();
  }

  /**
   * 맞추기: 악보는 멈춘 채로 두고 영상만 박 자리 조금 앞부터 튼다.
   * 악보의 지금 자리(멈춰 둔 곳, 처음이면 첫 박)가 들릴 때 한 번 더 누른다.
   */
  toggleAlign() {
    if (!this.ready) return;
    if (!this.aligning) {
      const { position } = this.getState();
      this.aligning = true;
      this.alignBtn.textContent = '지금!';
      this.alignBtn.classList.add('primary');
      this.player!.setPlaybackRate(1);
      this.rate = 0;
      this.player!.seekTo(Math.max(0, this.expected(position) - LEAD_IN), true);
      this.player!.playVideo();
      this.onMessage?.('악보의 지금 자리(멈춘 마디의 첫 박)가 들릴 때 "지금!"을 누르세요');
      return;
    }
    const { position } = this.getState();
    // 누른 순간보다 손이 조금 늦으므로 살짝 당긴다
    const heard = this.player!.getCurrentTime() - 0.08;
    this.offset = Math.round((heard - position * this.scale()) * 100) / 100;
    this.stopAligning();
    this.player!.pauseVideo();
    this.player!.seekTo(Math.max(0, this.expected(position)), true);
    this.showOffset();
    this.save();
    this.onMessage?.('맞췄어요. 영상이 빠르면 ◀, 늦으면 ▶로 조금씩 옮기세요');
  }

  /** 매 프레임: 악보 시계에 영상을 맞춘다 */
  update() {
    if (!this.ready || this.aligning) return;
    const p = this.player!;
    const { position, playing } = this.getState();
    const want = this.expected(position);
    const state = p.getPlayerState();
    const now = performance.now();

    if (!playing) {
      if (state === PLAYING || state === BUFFERING) p.pauseVideo();
      // 멈춘 채로 자리를 옮기면 영상 화면도 그 자리로
      if (Math.abs(position - this.lastPosition) > 0.01) p.seekTo(Math.max(0, want), true);
      this.lastPosition = position;
      this.waiting = false;
      return;
    }
    this.lastPosition = position;

    const rate = snapRate(this.scale(), p.getAvailablePlaybackRates());
    if (rate !== this.rate) {
      if (this.rate && Math.abs(rate - this.scale()) > 0.01) this.onMessage?.(`영상은 ${rate}배까지만 맞출 수 있어서 조금씩 어긋날 수 있어요`);
      this.rate = rate;
      p.setPlaybackRate(rate);
    }

    // 악보가 영상 시작보다 앞(첫 박이 영상 0초보다 이르게 맞춰진 경우)이면 0초에서 기다린다
    if (want < 0) {
      if (!this.waiting) {
        this.waiting = true;
        p.pauseVideo();
        p.seekTo(0, true);
      }
      return;
    }
    if (this.waiting) {
      this.waiting = false;
      this.settleUntil = 0;
    }

    if (state !== PLAYING && state !== BUFFERING) {
      p.seekTo(want, true);
      p.playVideo();
      this.settleUntil = now + SETTLE_MS;
      return;
    }
    if (state === BUFFERING || now < this.settleUntil) return;
    // 반복으로 처음에 돌아갔거나 영상이 밀렸으면 그 자리로
    if (this.forceSeek || Math.abs(p.getCurrentTime() - want) > DRIFT) {
      this.forceSeek = false;
      p.seekTo(want, true);
      this.settleUntil = now + SETTLE_MS;
    }
  }

  private scale() {
    return this.getState().bpm / this.baseBpm;
  }

  private expected(position: number) {
    return this.offset + position * this.scale();
  }

  private stopAligning() {
    if (!this.aligning) return;
    this.aligning = false;
    this.alignBtn.textContent = '맞추기';
    this.alignBtn.classList.remove('primary');
  }

  private showOffset() {
    const sign = this.offset < 0 ? '−' : '';
    this.offsetEl.textContent = `${sign}${Math.abs(this.offset).toFixed(2)}초`;
  }

  /** 곡 이름별로 영상·맞춘 자리를 기억한다 (같은 PDF를 다시 열면 그대로) */
  private save() {
    if (!this.videoId || !this.title) return;
    try {
      const all = loadSaved();
      all[this.title] = { id: this.videoId, offset: this.offset, baseBpm: this.baseBpm };
      localStorage.setItem(SAVED_KEY, JSON.stringify(all));
    } catch {
      /* 저장 불가 환경 */
    }
  }
}
