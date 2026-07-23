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

// ---- 氣場上飄(Aura Updraft)與吼叫連動(Yell Reactivity)----

/**
 * 實測 full-yell 的 effort 上限。測量值的原始出處是 power.ts SSJ_EFFORT 的
 * 校準紀錄(CLAUDE.md gotcha:紙上權重和為 1,實際 blendshape 封頂 ~0.45)。
 * 葉模組規則禁止 hairdyn→power 匯入,故此處持有副本 — 重校準時兩處同步改。
 */
export const EFFORT_FULL = 0.45;

/** effort → 吼叫強度 0..1(線性、鉗位);曲線若要調,實機 ?debug 校準後改這裡 */
export function yellIntensity(effort: number): number {
  return Math.min(1, Math.max(0, effort / EFFORT_FULL));
}

/**
 * 上飄擾動(單位振幅,方向恆朝上=-y):餵給彈簧「目標」,由彈簧自然濾波。
 * 雙不可通約頻率+seed 相位散佈 → 每束不同步、任何短平移都不重合(無機械感)。
 * 確定性(無亂數):同輸入同輸出,可測試、可重播。
 */
export function updraft(timeMs: number, seed: number): { x: number; y: number; z: number } {
  // 下列頻率是波形「性格」而非調校旋鈕(振幅/增益才是,見 hair3d 可調常數)
  const p = seed * 2.399; // 黃金角讓相位在束間均勻散開
  const a = Math.sin(timeMs * 0.0021 + p);
  const b = Math.sin(timeMs * 0.00297 + p * 1.7);
  return {
    x: 0.5 * (a * 0.7 + b * 0.3),
    y: -(0.55 + 0.35 * (0.5 * a + 0.5 * Math.sin(timeMs * 0.0013 + p))), // ∈ [-0.9, -0.2]
    z: 0.4 * Math.sin(timeMs * 0.0017 + p * 2.3),
  };
}

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
