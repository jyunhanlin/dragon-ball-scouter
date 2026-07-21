import { describe, it, expect } from 'vitest';
import {
  computeRatios, basePower, effortFromBlend, boostMultiplier,
  smooth, median, isOverload, BASE_MIN, BASE_MAX, MAX_BOOST,
} from './power';
import type { Pt } from './types';

/** 造一個只填了必要 index 的稀疏 landmark 陣列 */
function fakeFace(scale = 1): Pt[] {
  const pts: Pt[] = [];
  const put = (i: number, x: number, y: number) => { pts[i] = { x: x * scale, y: y * scale }; };
  put(33, 120, 150);  // 右眼外角
  put(263, 220, 150); // 左眼外角
  put(234, 90, 180);  // 右頰
  put(454, 250, 180); // 左頰
  put(168, 170, 150); // 鼻樑
  put(1, 170, 210);   // 鼻尖
  put(10, 170, 80);   // 額頂
  put(152, 170, 300); // 下巴
  put(61, 140, 250);  // 右嘴角
  put(291, 200, 250); // 左嘴角
  return pts;
}

describe('computeRatios', () => {
  it('回傳 4 個比值', () => {
    expect(computeRatios(fakeFace())).toHaveLength(4);
  });
  it('距離不變性：整體縮放 2 倍，比值不變', () => {
    const a = computeRatios(fakeFace(1));
    const b = computeRatios(fakeFace(2));
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 10));
  });
});

describe('basePower', () => {
  const ratios = computeRatios(fakeFace());
  it('決定性：同輸入同輸出', () => {
    expect(basePower(ratios)).toBe(basePower([...ratios]));
  });
  it('落在 [BASE_MIN, BASE_MAX]', () => {
    for (const r0 of [0.2, 0.5, 0.8]) {
      for (const r1 of [0.1, 0.3, 0.6]) {
        const p = basePower([r0, r1, 0.4, 0.7]);
        expect(p).toBeGreaterThanOrEqual(BASE_MIN);
        expect(p).toBeLessThanOrEqual(BASE_MAX);
      }
    }
  });
  it('連續性：比值微擾 0.001，變化 < 50%', () => {
    const p1 = basePower(ratios);
    const p2 = basePower(ratios.map((r) => r + 0.001));
    expect(Math.abs(Math.log(p2 / p1))).toBeLessThan(Math.log(1.5));
  });
  it('區分度：明顯不同的臉給出不同數值', () => {
    expect(basePower([0.45, 0.28, 0.31, 0.72])).not.toBe(basePower([0.55, 0.35, 0.4, 0.85]));
  });
});

describe('effortFromBlend / boostMultiplier', () => {
  it('面無表情 effort=0、乘數=1', () => {
    expect(effortFromBlend({})).toBe(0);
    expect(boostMultiplier(0)).toBe(1);
  });
  it('全力表情 effort=1、乘數=MAX_BOOST', () => {
    const e = effortFromBlend({
      jawOpen: 1, browDownLeft: 1, browDownRight: 1, eyeWideLeft: 1, eyeWideRight: 1,
    });
    expect(e).toBe(1);
    expect(boostMultiplier(1)).toBe(MAX_BOOST);
  });
  it('加速曲線：半力加成低於線性中點', () => {
    expect(boostMultiplier(0.5)).toBeLessThan((1 + MAX_BOOST) / 2);
  });
  it('單調遞增', () => {
    expect(boostMultiplier(0.3)).toBeLessThan(boostMultiplier(0.6));
  });
});

describe('smooth', () => {
  it('alpha=1 直接跳到目標', () => {
    expect(smooth(0, 100, 1)).toBe(100);
  });
  it('反覆套用會收斂到目標', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) v = smooth(v, 100);
    expect(v).toBeCloseTo(100, 1);
  });
});

describe('median', () => {
  it('空陣列回 0', () => expect(median([])).toBe(0));
  it('奇數個取中位', () => expect(median([3, 1, 2])).toBe(2));
  it('偶數個取中間平均', () => expect(median([1, 2, 3, 4])).toBe(2.5));
});

describe('isOverload', () => {
  it('9000 不算爆表，9001 算', () => {
    expect(isOverload(9000)).toBe(false);
    expect(isOverload(9001)).toBe(true);
  });
});
