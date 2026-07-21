import { describe, it, expect } from 'vitest';
import { initial, start, tick, LOCK_MS, SCAN_MS, LOST_MS, type FsmState } from './fsm';

const face = (now: number, displayValue = 0) => ({ now, faceVisible: true, displayValue });
const noFace = (now: number, displayValue = 0) => ({ now, faceVisible: false, displayValue });

/** 直接構造某個 phase 的狀態，避免每個測試都從頭走流程 */
const at = (phase: FsmState['phase'], phaseAt: number, lastFaceAt: number): FsmState =>
  ({ phase, phaseAt, lastFaceAt });

describe('fsm', () => {
  it('初始為 idle，tick 不動', () => {
    expect(initial().phase).toBe('idle');
    expect(tick(initial(), face(100)).phase).toBe('idle');
  });

  it('start: idle → searching；overload → searching；其他 phase 不動', () => {
    expect(start(initial(), 5).phase).toBe('searching');
    expect(start(at('overload', 0, 0), 5).phase).toBe('searching');
    expect(start(at('scanning', 0, 0), 5).phase).toBe('scanning');
  });

  it('searching + 臉 → locked', () => {
    expect(tick(at('searching', 0, 0), face(100)).phase).toBe('locked');
  });

  it('locked 滿 LOCK_MS → scanning', () => {
    const s = at('locked', 100, 100);
    expect(tick(s, face(100 + LOCK_MS - 1)).phase).toBe('locked');
    expect(tick(s, face(100 + LOCK_MS)).phase).toBe('scanning');
  });

  it('臉短暫消失 < LOST_MS 不掉回 searching', () => {
    const s = at('locked', 100, 100);
    // 未達 LOCK_MS：留在 locked
    expect(tick(s, noFace(100 + LOCK_MS - 1)).phase).toBe('locked');
    // 已過 LOCK_MS（仍 < LOST_MS）：照常前進到 scanning，不會掉回 searching
    // （debounce 的意圖是「不重置」，不是「凍結流程推進」）
    expect(tick(s, noFace(100 + LOST_MS - 1)).phase).toBe('scanning');
  });

  it('臉消失 ≥ LOST_MS → searching（locked / scanning / result 皆然）', () => {
    for (const phase of ['locked', 'scanning', 'result'] as const) {
      expect(tick(at(phase, 100, 100), noFace(100 + LOST_MS)).phase).toBe('searching');
    }
  });

  it('scanning 滿 SCAN_MS → result', () => {
    const s = at('scanning', 100, 100);
    expect(tick(s, face(100 + SCAN_MS - 1)).phase).toBe('scanning');
    expect(tick(s, face(100 + SCAN_MS)).phase).toBe('result');
  });

  it('result: 顯示值 > 9000 → overload；9000 不觸發', () => {
    expect(tick(at('result', 100, 100), face(200, 9000)).phase).toBe('result');
    expect(tick(at('result', 100, 100), face(200, 9001)).phase).toBe('overload');
  });

  it('overload 對 tick 免疫（只能 start 重啟）', () => {
    expect(tick(at('overload', 100, 100), noFace(99999)).phase).toBe('overload');
  });

  it('faceVisible 會更新 lastFaceAt', () => {
    expect(tick(at('locked', 100, 100), face(250)).lastFaceAt).toBe(250);
  });
});
