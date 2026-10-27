import type { BackingTrack } from '../audio/Transport';
import { analyzeDrums, ANALYSIS_RATE, type DrumAnalysis } from './audio';

/** 너무 긴 파일은 앞부분만 본다 (악보도 128마디까지) */
const MAX_SECONDS = 6 * 60;

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|aif|aiff|webm)$/i.test(file.name);
}

/**
 * 음원 파일 하나로 드럼 악보와 함께 틀 원곡을 만든다.
 * 분석은 22kHz 모노로, 원곡은 44.1kHz 그대로 디코딩한다.
 */
export async function drumsFromAudioFile(
  file: File,
  onProgress?: (p: number) => void,
): Promise<{ analysis: DrumAnalysis; backing: BackingTrack }> {
  const data = await file.arrayBuffer();
  // decodeAudioData는 받은 버퍼를 비워 버리므로 두 번 쓰려면 사본이 필요하다
  const [forAnalysis, forPlayback] = await Promise.all([
    new OfflineAudioContext(1, 1, ANALYSIS_RATE).decodeAudioData(data.slice(0)),
    new OfflineAudioContext(2, 1, 44100).decodeAudioData(data),
  ]);

  const length = Math.min(forAnalysis.length, MAX_SECONDS * ANALYSIS_RATE);
  const mono = new Float32Array(length);
  for (let c = 0; c < forAnalysis.numberOfChannels; c++) {
    const ch = forAnalysis.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += ch[i] / forAnalysis.numberOfChannels;
  }
  const analysis = await analyzeDrums(mono, ANALYSIS_RATE, { title: file.name.replace(/\.[^.]+$/, ''), onProgress });
  return { analysis, backing: { buffer: forPlayback, offset: analysis.offset, bpm: analysis.bpm } };
}
