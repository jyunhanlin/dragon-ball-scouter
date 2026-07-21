import type { Pt } from './types';

// 可調常數
export const BASE_MIN = 100;
export const BASE_MAX = 8000;
export const OVER_LIMIT = 9000;
export const MAX_BOOST = 10;

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

// MediaPipe FaceLandmarker canonical landmark indices
const IDX = {
  eyeOuterR: 33, eyeOuterL: 263,
  cheekR: 234, cheekL: 454,
  noseBridge: 168, noseTip: 1,
  forehead: 10, chin: 152,
  mouthR: 61, mouthL: 291,
} as const;

/** 對距離不敏感的臉部幾何比值（同一人每次測都相近） */
export function computeRatios(points: Pt[]): number[] {
  const faceW = dist(points[IDX.cheekR], points[IDX.cheekL]);
  const faceH = dist(points[IDX.forehead], points[IDX.chin]);
  return [
    dist(points[IDX.eyeOuterR], points[IDX.eyeOuterL]) / faceW,
    dist(points[IDX.noseBridge], points[IDX.noseTip]) / faceH,
    dist(points[IDX.mouthR], points[IDX.mouthL]) / faceW,
    faceW / faceH,
  ];
}

// 連續的偽隨機散佈：sin 高頻讓「不同人」的相近比值被拉開，
// 但函數連續 → 同一人的幀間抖動只造成小幅變化
const FREQS = [37, 53, 71, 89];

export function basePower(ratios: number[]): number {
  let s = 0;
  for (let i = 0; i < ratios.length; i++) s += Math.sin(ratios[i] * FREQS[i % FREQS.length]);
  const t = Math.min(1, Math.max(0, (s / ratios.length + 1) / 2)); // → [0,1]
  return Math.round(BASE_MIN * Math.pow(BASE_MAX / BASE_MIN, t));  // 對數尺度
}

/** blendshapes → 0..1 發力度（張嘴為主、皺眉瞪眼為輔） */
export function effortFromBlend(blend: Record<string, number>): number {
  const get = (k: string): number => blend[k] ?? 0;
  const browDown = (get('browDownLeft') + get('browDownRight')) / 2;
  const eyeWide = (get('eyeWideLeft') + get('eyeWideRight')) / 2;
  const e = 0.6 * get('jawOpen') + 0.25 * browDown + 0.15 * eyeWide;
  return Math.min(1, Math.max(0, e));
}

/** 加速曲線：小表情沒感覺，用力吼才飆升 */
export function boostMultiplier(effort: number): number {
  return 1 + (MAX_BOOST - 1) * effort * effort;
}

export function smooth(prev: number, next: number, alpha = 0.25): number {
  return prev + (next - prev) * alpha;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function isOverload(displayValue: number): boolean {
  return displayValue > OVER_LIMIT;
}
