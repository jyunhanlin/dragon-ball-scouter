/**
 * 髮束動力學純模組:阻尼彈簧步進。無瀏覽器 API — vitest 直測(purity split 受測側)。
 *
 * M2 的三種動態(慣性甩動/氣場上飄/吼叫連動)與豎起演出共用這套基建:
 * hair3d 對每根髮束維護一顆 Spring3,目標=剛體髮尖的世界座標;
 * 彈簧位置與目標的差經 spineT 加權位移施加在頂點上(根不動、尖全量)。
 *
 * 時間單位一律毫秒(單時鐘 performance.now),速度單位 px/ms。
 */

export interface Spring3 {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

// 慣性甩動參數:欠阻尼(臨界阻尼 c=2√k≈0.063,取約半 → 可見回彈、~600ms 收斂)。
// 週期 ~200ms:16ms 一幀只追 <30% — 甩動在 60fps 下肉眼可見(對應滯後測試)
export const INERTIA_STIFFNESS = 0.001; // /ms²(ω≈0.032 rad/ms)
export const INERTIA_DAMPING = 0.03; // /ms

// 子步進:半隱式 Euler 在大 dt 下發散,固定小步長保穩定;
// 模擬總時長封頂 — 超過的部分彈簧早已收斂,純屬浪費
const SUBSTEP_MS = 8;
const MAX_SIM_MS = 2000;

/** 靜止於某點的初始彈簧狀態 */
export function atRest(x: number, y: number, z: number): Spring3 {
  return { x, y, z, vx: 0, vy: 0, vz: 0 };
}

/** 朝 target 步進 dtMs;回傳新狀態(不改動輸入) */
export function stepSpring(
  s: Spring3,
  target: { x: number; y: number; z: number },
  dtMs: number,
  stiffness: number,
  damping: number,
): Spring3 {
  let { x, y, z, vx, vy, vz } = s;
  let remaining = Math.min(dtMs, MAX_SIM_MS);
  while (remaining > 0) {
    const h = Math.min(remaining, SUBSTEP_MS);
    remaining -= h;
    vx += (stiffness * (target.x - x) - damping * vx) * h;
    vy += (stiffness * (target.y - y) - damping * vy) * h;
    vz += (stiffness * (target.z - z) - damping * vz) * h;
    x += vx * h;
    y += vy * h;
    z += vz * h;
  }
  return { x, y, z, vx, vy, vz };
}
