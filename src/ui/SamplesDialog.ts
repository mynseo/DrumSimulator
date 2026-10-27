import { customKit } from '../audio/AudioEngine';
import { decodeSample } from '../audio/kits/sampled';
import { deleteSample, loadSamples, saveSample } from '../audio/sampleStore';
import { INSTRUMENTS } from '../core/instruments';
import type { Instrument } from '../core/types';

/** "내 샘플" 킷: 악기마다 오디오 파일을 넣고, 미리 듣고, 지운다 */
export class SamplesDialog {
  onPreview?: (instrument: Instrument) => void;
  onError?: (message: string) => void;
  private target: Instrument | null = null;

  constructor(
    private dialog: HTMLDialogElement,
    private list: HTMLElement,
    private fileInput: HTMLInputElement,
  ) {
    fileInput.addEventListener('change', () => this.fileChosen());
  }

  /** 지난번에 넣어 둔 파일을 브라우저 저장소에서 다시 불러온다 */
  async restore() {
    for (const s of await loadSamples()) {
      try {
        customKit.samples.set(s.instrument, { ...(await decodeSample(s.data)), name: s.name });
      } catch {
        /* 더 이상 읽을 수 없는 파일은 건너뛴다 */
      }
    }
  }

  open() {
    this.render();
    this.dialog.showModal();
  }

  private render() {
    this.list.innerHTML = '';
    for (const inst of INSTRUMENTS) {
      const s = customKit.samples.get(inst.id);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = inst.label;
      const file = document.createElement('span');
      file.className = `file${s ? ' set' : ''}`;
      file.textContent = s ? s.name : '어쿠스틱 소리';
      file.title = file.textContent;

      const actions = document.createElement('span');
      actions.className = 'row-actions';
      actions.append(
        button('파일 선택', () => {
          this.target = inst.id;
          this.fileInput.click();
        }),
        button('▶', () => this.onPreview?.(inst.id), '미리 듣기'),
      );
      if (s) {
        actions.append(
          button('지우기', async () => {
            customKit.samples.delete(inst.id);
            await deleteSample(inst.id);
            this.render();
          }),
        );
      }
      this.list.append(name, file, actions);
    }
  }

  private async fileChosen() {
    const file = this.fileInput.files?.[0];
    const instrument = this.target;
    this.fileInput.value = '';
    if (!file || !instrument) return;
    try {
      const data = await file.arrayBuffer();
      // decodeAudioData가 버퍼를 넘겨받아 비우므로 저장용 사본을 따로 둔다
      const sample = await decodeSample(data.slice(0));
      customKit.samples.set(instrument, { ...sample, name: file.name });
      await saveSample({ instrument, name: file.name, data });
      this.render();
      this.onPreview?.(instrument);
    } catch {
      this.onError?.(`${file.name}: 재생할 수 없는 오디오 파일입니다. wav나 mp3로 바꿔서 넣어 보세요`);
    }
  }
}

function button(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}
