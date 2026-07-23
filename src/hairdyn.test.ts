import { describe, expect, it } from 'vitest';
import {
  INERTIA_DAMPING, INERTIA_STIFFNESS, atRest, stepSpring, type Spring3,
} from './hairdyn';

const ORIGIN = { x: 0, y: 0, z: 0 };

/** 以固定參數把彈簧模擬 totalMs,回傳每步狀態(公開介面重複呼叫,不碰內部) */
function simulate(start: Spring3, target: typeof ORIGIN, totalMs: number, stepMs: number): Spring3[] {
  const states: Spring3[] = [];
  let s = start;
  for (let t = 0; t < totalMs; t += stepMs) {
    s = stepSpring(s, target, stepMs, INERTIA_STIFFNESS, INERTIA_DAMPING);
    states.push(s);
  }
  return states;
}

describe('stepSpring', () => {
  it('dt=0 不改變狀態', () => {
    const s: Spring3 = { x: 50, y: -20, z: 3, vx: 1, vy: 0, vz: -0.5 };
    expect(stepSpring(s, ORIGIN, 0, INERTIA_STIFFNESS, INERTIA_DAMPING)).toEqual(s);
  });

  it('純函式:不改動輸入狀態', () => {
    const s: Spring3 = { x: 50, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    stepSpring(s, ORIGIN, 16, INERTIA_STIFFNESS, INERTIA_DAMPING);
    expect(s).toEqual({ x: 50, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  });

  it('擾動後有限時間收斂:位移 100、2 秒內回到目標 ±1,速度歸零', () => {
    const end = simulate({ ...atRest(100, 0, 0) }, ORIGIN, 2000, 16).at(-1)!;
    expect(Math.abs(end.x)).toBeLessThan(1);
    expect(Math.abs(end.vx)).toBeLessThan(0.01);
  });

  it('預設參數為欠阻尼:回彈存在(至少穿越目標一次)', () => {
    const xs = simulate(atRest(100, 0, 0), ORIGIN, 2000, 16).map((s) => s.x);
    expect(Math.min(...xs)).toBeLessThan(0);
  });

  it('能量遞減:振幅永不超過初始位移', () => {
    const xs = simulate(atRest(100, 0, 0), ORIGIN, 2000, 16).map((s) => Math.abs(s.x));
    // 1.01 = 數值積分的離散誤差容差,非物理性放大
    expect(Math.max(...xs)).toBeLessThanOrEqual(100 * 1.01);
  });

  it('臨界阻尼(c=2√k)不回彈:全程不穿越目標', () => {
    const critical = 2 * Math.sqrt(INERTIA_STIFFNESS);
    let s = atRest(100, 0, 0);
    for (let t = 0; t < 2000; t += 16) {
      s = stepSpring(s, ORIGIN, 16, INERTIA_STIFFNESS, critical);
      expect(s.x).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(Math.abs(s.x)).toBeLessThan(1);
  });

  it('最軟的執行期彈簧(stiffness/h,h=1.28)單次巨大 dt 也收斂(MAX_SIM_MS 內足夠)', () => {
    const soft = INERTIA_STIFFNESS / 1.28;
    const s = stepSpring(atRest(100, 0, 0), ORIGIN, 1_000_000, soft, INERTIA_DAMPING);
    expect(Math.abs(s.x)).toBeLessThan(1);
    expect(Math.abs(s.vx)).toBeLessThan(0.01);
  });

  it('滯後:目標跳到 100,單一 16ms 步只追上一小段(< 30%)', () => {
    const s = stepSpring(atRest(0, 0, 0), { x: 100, y: 0, z: 0 }, 16, INERTIA_STIFFNESS, INERTIA_DAMPING);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.x).toBeLessThan(30);
  });

  it('任意 dt 無 NaN:巨大 dt 一次呼叫仍為有限值且趨向目標', () => {
    const s = stepSpring(atRest(100, -50, 25), ORIGIN, 1_000_000, INERTIA_STIFFNESS, INERTIA_DAMPING);
    for (const v of [s.x, s.y, s.z, s.vx, s.vy, s.vz]) expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(5);
    expect(Math.abs(s.y)).toBeLessThan(5);
    expect(Math.abs(s.z)).toBeLessThan(5);
  });

  it('不規則 dt(7/33/16 交錯)仍收斂且全程有限', () => {
    let s = atRest(80, 40, -60);
    const steps = [7, 33, 16, 7, 33, 16];
    for (let t = 0; t < 2500; ) {
      for (const dt of steps) {
        s = stepSpring(s, ORIGIN, dt, INERTIA_STIFFNESS, INERTIA_DAMPING);
        t += dt;
        for (const v of [s.x, s.y, s.z, s.vx, s.vy, s.vz]) expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(Math.hypot(s.x, s.y, s.z)).toBeLessThan(1.5);
  });

  it('三軸獨立同性:對稱初始位移收斂軌跡對稱', () => {
    const a = simulate(atRest(100, 0, 0), ORIGIN, 500, 16).at(-1)!;
    const b = simulate(atRest(0, 100, 0), ORIGIN, 500, 16).at(-1)!;
    expect(b.y).toBeCloseTo(a.x, 9);
    expect(b.vy).toBeCloseTo(a.vx, 9);
  });
});
