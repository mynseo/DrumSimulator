/**
 * 연주 위치(박 단위)에 가장 잘 맞는 박 나눔을 고른다.
 * 4 = 16분음표, 3 = 셋잇단 8분, 6 = 셋잇단 16분, 8 = 32분음표, 12 = 셋잇단과 16분이 섞인 곡.
 * 더 잘게 나눌수록 아무 위치에나 잘 맞으므로, 단순한 격자가 충분히 잘 맞으면 그것을 고른다.
 */
export const SUBDIVISIONS = [4, 3, 6, 8, 12] as const;

/** 사람 연주의 흔들림: 이 정도(박의 3.5%, 120BPM에서 약 17ms)까지는 격자에 맞는 것으로 본다 */
export const TOLERANCE = 0.035;
/** 더 잘게 나눈 격자를 고르려면 이만큼은 더 잘 맞아야 한다 */
const MARGIN = 0.06;

export interface Onset {
  /** 박 단위 위치 (0 = 첫 박) */
  beat: number;
  /** 큰 타격일수록 중요하게 본다 */
  weight?: number;
}

/**
 * 격자 g(한 박을 g칸으로)에 타격들이 얼마나 잘 붙는지 0..1.
 * 칸이 촘촘할수록 아무 데나 찍어도 우연히 잘 붙으므로, 그 우연한 만큼을 빼고 잰다(0 = 우연과 같음).
 */
export function gridFit(onsets: Onset[], g: number, tolerance = TOLERANCE): number {
  let sum = 0;
  let total = 0;
  for (const o of onsets) {
    const w = o.weight ?? 1;
    const x = o.beat * g;
    const d = Math.abs(x - Math.round(x)) / g; // 가장 가까운 칸까지 거리(박 단위)
    sum += w * Math.exp(-((d / tolerance) ** 2));
    total += w;
  }
  const raw = total ? sum / total : 1;
  // 무작위 위치의 평균 점수: 칸 사이 거리 1/g 위에서 가우스 종을 평균낸 값
  const chance = Math.min(0.999, Math.sqrt(Math.PI) * tolerance * g);
  return (raw - chance) / (1 - chance);
}

export function chooseSubdivision(onsets: Onset[], tolerance = TOLERANCE): number {
  if (onsets.length < 4) return 4;
  const fits = SUBDIVISIONS.map((g) => gridFit(onsets, g, tolerance));
  const best = Math.max(...fits);
  return SUBDIVISIONS[fits.findIndex((f) => f >= best - MARGIN)];
}

export interface GridFit {
  subdivision: number;
  /** 고친 첫 박 위치(입력과 같은 박 단위) */
  offset: number;
  /** 고친 한 박 길이(입력 박 길이에 대한 비율) */
  scale: number;
}

/**
 * 음원처럼 처음 잡은 빠르기가 조금 틀릴 수 있을 때: 격자마다 시작점과 빠르기를 함께 맞춰 보고
 * (타격과 가장 가까운 칸의 최소제곱) 가장 잘 맞는 단순한 격자를 고른다.
 * 빠르기가 0.3%만 틀려도 8마디 뒤에는 0.1박이 밀려 셋잇단과 16분음표를 가를 수 없게 된다.
 */
export function fitSubdivision(onsets: Onset[], tolerance = TOLERANCE): GridFit {
  if (onsets.length < 4) return { subdivision: 4, offset: 0, scale: 1 };
  const fits = SUBDIVISIONS.map((g) => align(onsets, g, tolerance));
  const best = Math.max(...fits.map((f) => f.fit));
  const pick = fits.find((f) => f.fit >= best - MARGIN)!;
  return { subdivision: pick.subdivision, offset: pick.offset, scale: pick.scale };
}

function align(onsets: Onset[], g: number, tolerance: number) {
  let offset = 0;
  let scale = 1;
  for (let iter = 0; iter < 4; iter++) {
    // 각 타격을 가장 가까운 칸에 붙이고, 칸 번호 → 위치 직선을 가중 최소제곱으로 맞춘다.
    // 칸에서 멀리 떨어진 타격(잘못 찾은 소리)은 빼서 직선이 끌려가지 않게 한다.
    let sw = 0, sk = 0, sb = 0, skk = 0, skb = 0;
    for (const o of onsets) {
      const k = Math.round(((o.beat - offset) / scale) * g) / g;
      const r = o.beat - (offset + k * scale);
      if (Math.abs(r) > 0.3 / g) continue;
      const w = o.weight ?? 1;
      sw += w; sk += w * k; sb += w * o.beat; skk += w * k * k; skb += w * k * o.beat;
    }
    const det = sw * skk - sk * sk;
    if (sw === 0 || Math.abs(det) < 1e-9) break;
    const s = (sw * skb - sk * sb) / det;
    if (Math.abs(s - 1) > 0.03) break; // 빠르기를 크게 바꾸는 것은 격자를 잘못 붙인 것
    scale = s;
    offset = (sb - scale * sk) / sw;
  }
  const fit = gridFit(onsets.map((o) => ({ beat: (o.beat - offset) / scale, weight: o.weight })), g, tolerance);
  return { subdivision: g, offset, scale, fit };
}
