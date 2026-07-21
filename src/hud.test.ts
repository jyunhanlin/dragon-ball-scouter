import { describe, it, expect } from 'vitest';
import { coverTransform, toScreen } from './hud';

describe('coverTransform（object-fit: cover 的座標映射）', () => {
  it('寬影片配方螢幕：以高度撐滿、水平置中裁切', () => {
    const t = coverTransform(1000, 500, 500, 500);
    expect(t.scale).toBe(1);        // max(500/1000, 500/500)
    expect(t.dx).toBe(-250);        // (500 - 1000*1) / 2
    expect(t.dy).toBe(0);
  });
  it('等比例：無裁切無偏移', () => {
    const t = coverTransform(640, 480, 320, 240);
    expect(t.scale).toBe(0.5);
    expect(t.dx).toBe(0);
    expect(t.dy).toBe(0);
  });
});

describe('toScreen', () => {
  const t = { scale: 2, dx: -100, dy: 10 };
  it('套 scale 與偏移', () => {
    expect(toScreen({ x: 100, y: 50 }, t, false, 500)).toEqual({ x: 100, y: 110 });
  });
  it('mirrored 時水平翻轉', () => {
    expect(toScreen({ x: 100, y: 50 }, t, true, 500)).toEqual({ x: 400, y: 110 });
  });
});
