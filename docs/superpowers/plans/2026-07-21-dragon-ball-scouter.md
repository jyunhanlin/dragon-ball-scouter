# 七龍珠戰鬥力探測器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 純前端戰鬥力探測器網頁 — 手機後鏡頭偵測人臉，鎖定/掃描動畫後顯示「基礎值 + 表情加成」的戰鬥力，破 9000 觸發爆表彩蛋。

**Architecture:** Vite + vanilla TypeScript 單頁應用。MediaPipe FaceLandmarker（WASM，裝置端）每幀輸出 478 landmarks + 52 blendshapes；`power.ts`（純函式）把幾何比值轉成穩定基礎值、blendshapes 轉成加成乘數；`fsm.ts`（純函式）管理 IDLE→SEARCHING→LOCKED→SCANNING→RESULT→OVERLOAD 狀態流；`main.ts` 用 requestAnimationFrame 迴圈串接 camera/detector/hud/sfx。

**Tech Stack:** Vite ^7、TypeScript（strict）、Vitest ^3、`@mediapipe/tasks-vision` ^0.10.14、`@vitejs/plugin-basic-ssl`（手機 LAN HTTPS 測試用）、WebAudio（音效合成，零素材）。

**Spec:** `docs/superpowers/specs/2026-07-21-dragon-ball-scouter-design.md`

## Global Constraints

- TypeScript `strict: true`；純函式模組（`power.ts`、`fsm.ts`、`hud.ts` 的 transform）不得 import 瀏覽器 API
- 不使用任何七龍珠官方素材（圖片/音效/字型）；音效一律 WebAudio 合成
- UI 按鈕文案（中文，照抄）：「啟動」「重試」「重新啟動」；HUD 內文字用英文（`SCANNING...`、`IT'S OVER 9000!!`）
- 數值常數集中放 `power.ts` / `fsm.ts` 頂部 export，標示可調：`BASE_MIN=100`、`BASE_MAX=8000`、`OVER_LIMIT=9000`、`MAX_BOOST=10`、`LOCK_MS=600`、`SCAN_MS=1200`、`LOST_MS=1000`
- Commit message 一律不加任何 AI/Claude 署名
- getUserMedia 需 secure context：桌機用 localhost，手機測試靠 basic-ssl（Task 1 就裝好）
- 測試檔與被測模組同目錄（`src/power.test.ts` 測 `src/power.ts`）

---

## File Structure

```
index.html            — DOM 骨架：video、canvas、start overlay、error box、按鈕
vite.config.ts        — basic-ssl plugin、host: true、vitest 設定
src/style.css         — 全螢幕佈局、綠色 HUD 主題、mirrored class
src/types.ts          — Pt、FaceFrame 共用型別
src/power.ts          — 純函式：ratios→基礎值、blend→effort→boost、EMA、median、isOverload
src/power.test.ts
src/fsm.ts            — 純函式狀態機：phase 轉換 + 臉消失 debounce
src/fsm.test.ts
src/camera.ts         — getUserMedia、前/後鏡頭、stop
src/detector.ts       — FaceLandmarker 封裝，輸出像素座標 FaceFrame（取最大臉）
src/hud.ts            — coverTransform/toScreen（純函式）+ Hud canvas 繪製類別
src/hud.test.ts       — 只測 transform 純函式
src/sfx.ts            — WebAudio 合成音效
src/main.ts           — 狀態機 wiring、rAF 迴圈、錯誤處理、按鈕事件
```

---

### Task 1: 專案骨架

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/style.css`, `src/types.ts`, `src/main.ts`（暫時只 import css）

**Interfaces:**
- Produces: `src/types.ts` 的 `Pt { x, y }` 與 `FaceFrame { points: Pt[]; blend: Record<string, number>; box: { x; y; w; h } }` — 後續所有 task 共用

- [ ] **Step 1: 手寫專案設定檔**（不用 `npm create vite`，目錄已有 docs/ 會觸發互動 prompt）

`package.json`：

```json
{
  "name": "dragon-ball-scouter",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@mediapipe/tasks-vision": "^0.10.14"
  },
  "devDependencies": {
    "@vitejs/plugin-basic-ssl": "^2.0.0",
    "typescript": "^5.6.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`vite.config.ts`（用 `vitest/config` 的 defineConfig 才吃得到 `test` 欄位）：

```ts
import { defineConfig } from 'vitest/config';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true },
  test: { environment: 'node' },
});
```

`.gitignore`：

```
node_modules
dist
```

- [ ] **Step 2: index.html 骨架**

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>戰鬥力探測器</title>
  </head>
  <body>
    <div id="app">
      <video id="cam" autoplay playsinline muted></video>
      <canvas id="hud"></canvas>
      <div id="start-overlay">
        <h1>戰鬥力探測器</h1>
        <p>SCOUTER v0.1</p>
        <button id="start-btn">啟動</button>
      </div>
      <div id="error-box" hidden>
        <p id="error-msg"></p>
        <button id="retry-btn">重試</button>
      </div>
      <button id="flip-btn" title="切換鏡頭">⟲</button>
      <button id="restart-btn" hidden>重新啟動</button>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: src/style.css**

```css
* { margin: 0; box-sizing: border-box; }
html, body, #app { height: 100%; }
body {
  background: #000;
  color: #7dff9e;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
}
#cam { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; }
#cam.mirrored { transform: scaleX(-1); }
#hud { position: fixed; inset: 0; width: 100%; height: 100%; }
#start-overlay, #error-box {
  position: fixed; inset: 0; z-index: 10;
  display: grid; place-content: center; gap: 16px; text-align: center;
  background: rgba(0, 10, 4, 0.88);
}
button {
  font: inherit; color: #7dff9e;
  background: transparent; border: 1px solid #7dff9e;
  padding: 10px 28px; border-radius: 4px; cursor: pointer;
}
button:active { background: rgba(125, 255, 158, 0.2); }
#flip-btn { position: fixed; right: 16px; bottom: 16px; z-index: 5; }
#restart-btn { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 5; }
[hidden] { display: none !important; }
```

- [ ] **Step 4: src/types.ts 與暫時的 src/main.ts**

`src/types.ts`：

```ts
export interface Pt {
  x: number;
  y: number;
}

export interface FaceFrame {
  /** 478 landmarks，video 像素座標 */
  points: Pt[];
  /** blendshape 名稱 → 分數 0..1（jawOpen、browDownLeft…） */
  blend: Record<string, number>;
  /** landmarks 的 bounding box，video 像素座標 */
  box: { x: number; y: number; w: number; h: number };
}
```

`src/main.ts`（暫時）：

```ts
import './style.css';
```

- [ ] **Step 5: 安裝依賴並驗證 build**

Run: `npm install`
Expected: 無 error 結束（warnings 可忽略）

Run: `npm run build`
Expected: `tsc` 無錯誤，vite build 輸出 `dist/`，結尾顯示 `✓ built in …`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite + typescript + vitest project"
```

---

### Task 2: power.ts — 戰鬥力計算（TDD）

**Files:**
- Create: `src/power.ts`
- Test: `src/power.test.ts`

**Interfaces:**
- Consumes: `Pt`（from `./types`）
- Produces（`main.ts`、`fsm.ts` 依賴這些簽名）:
  - `computeRatios(points: Pt[]): number[]`
  - `basePower(ratios: number[]): number`
  - `effortFromBlend(blend: Record<string, number>): number`
  - `boostMultiplier(effort: number): number`
  - `smooth(prev: number, next: number, alpha?: number): number`
  - `median(xs: number[]): number`
  - `isOverload(displayValue: number): boolean`
  - 常數 `BASE_MIN`, `BASE_MAX`, `OVER_LIMIT`, `MAX_BOOST`

- [ ] **Step 1: 寫失敗測試**

`src/power.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './power'`（或同義錯誤）

- [ ] **Step 3: 實作 src/power.ts**

```ts
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test`
Expected: PASS — power.test.ts 全綠（15 tests）

- [ ] **Step 5: Commit**

```bash
git add src/power.ts src/power.test.ts
git commit -m "feat: power level calculation (geometry base + expression boost)"
```

---

### Task 3: fsm.ts — 狀態機（TDD）

**Files:**
- Create: `src/fsm.ts`
- Test: `src/fsm.test.ts`

**Interfaces:**
- Consumes: `isOverload`（from `./power`）
- Produces（`main.ts`、`hud.ts` 依賴）:
  - `type Phase = 'idle' | 'searching' | 'locked' | 'scanning' | 'result' | 'overload'`
  - `interface FsmState { phase: Phase; phaseAt: number; lastFaceAt: number }`
  - `interface FrameInput { now: number; faceVisible: boolean; displayValue: number }`
  - `initial(): FsmState` / `start(s, now): FsmState` / `tick(s, input): FsmState`
  - 常數 `LOCK_MS`, `SCAN_MS`, `LOST_MS`

- [ ] **Step 1: 寫失敗測試**

`src/fsm.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './fsm'`

- [ ] **Step 3: 實作 src/fsm.ts**

```ts
import { isOverload } from './power';

// 可調常數
export const LOCK_MS = 600;
export const SCAN_MS = 1200;
export const LOST_MS = 1000;

export type Phase = 'idle' | 'searching' | 'locked' | 'scanning' | 'result' | 'overload';

export interface FsmState {
  phase: Phase;
  /** 進入目前 phase 的時間戳 */
  phaseAt: number;
  /** 最後一次看到臉的時間戳 */
  lastFaceAt: number;
}

export interface FrameInput {
  now: number;
  faceVisible: boolean;
  displayValue: number;
}

export function initial(): FsmState {
  return { phase: 'idle', phaseAt: 0, lastFaceAt: 0 };
}

export function start(s: FsmState, now: number): FsmState {
  if (s.phase === 'idle' || s.phase === 'overload') {
    return { phase: 'searching', phaseAt: now, lastFaceAt: 0 };
  }
  return s;
}

export function tick(s: FsmState, input: FrameInput): FsmState {
  const { now, faceVisible, displayValue } = input;
  const lastFaceAt = faceVisible ? now : s.lastFaceAt;
  const lost = !faceVisible && now - lastFaceAt >= LOST_MS;

  switch (s.phase) {
    case 'idle':
    case 'overload':
      return s;
    case 'searching':
      return faceVisible ? { phase: 'locked', phaseAt: now, lastFaceAt } : s;
    case 'locked':
      if (lost) return { phase: 'searching', phaseAt: now, lastFaceAt };
      if (now - s.phaseAt >= LOCK_MS) return { phase: 'scanning', phaseAt: now, lastFaceAt };
      return { ...s, lastFaceAt };
    case 'scanning':
      if (lost) return { phase: 'searching', phaseAt: now, lastFaceAt };
      if (now - s.phaseAt >= SCAN_MS) return { phase: 'result', phaseAt: now, lastFaceAt };
      return { ...s, lastFaceAt };
    case 'result':
      if (lost) return { phase: 'searching', phaseAt: now, lastFaceAt };
      if (isOverload(displayValue)) return { phase: 'overload', phaseAt: now, lastFaceAt };
      return { ...s, lastFaceAt };
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test`
Expected: PASS — power + fsm 全綠

- [ ] **Step 5: Commit**

```bash
git add src/fsm.ts src/fsm.test.ts
git commit -m "feat: scouter phase state machine with face-lost debounce"
```

---

### Task 4: camera.ts + 啟動流程

**Files:**
- Create: `src/camera.ts`
- Modify: `src/main.ts`（啟動 overlay → 開相機 → 全螢幕顯示）

**Interfaces:**
- Produces（`main.ts` 依賴）:
  - `interface CameraHandle { video: HTMLVideoElement; facing: 'user' | 'environment'; stop(): void }`
  - `startCamera(video: HTMLVideoElement, facing: 'user' | 'environment'): Promise<CameraHandle>`

- [ ] **Step 1: 實作 src/camera.ts**

```ts
export interface CameraHandle {
  video: HTMLVideoElement;
  /** 實際拿到的鏡頭方向（桌機拿不到 facingMode 時視為 user） */
  facing: 'user' | 'environment';
  stop(): void;
}

export async function startCamera(
  video: HTMLVideoElement,
  facing: 'user' | 'environment',
): Promise<CameraHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  const settings = stream.getVideoTracks()[0].getSettings();
  const actual = (settings.facingMode as 'user' | 'environment' | undefined) ?? 'user';
  return {
    video,
    facing: actual,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}
```

- [ ] **Step 2: main.ts 接上啟動流程**

`src/main.ts` 全文替換：

```ts
import './style.css';
import { startCamera, type CameraHandle } from './camera';

const video = document.querySelector<HTMLVideoElement>('#cam')!;
const startOverlay = document.querySelector<HTMLDivElement>('#start-overlay')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')!;
const errorBox = document.querySelector<HTMLDivElement>('#error-box')!;
const errorMsg = document.querySelector<HTMLParagraphElement>('#error-msg')!;
const retryBtn = document.querySelector<HTMLButtonElement>('#retry-btn')!;
const flipBtn = document.querySelector<HTMLButtonElement>('#flip-btn')!;

let cam: CameraHandle | null = null;
let facing: 'user' | 'environment' = 'environment';

function showError(msg: string): void {
  errorMsg.textContent = msg;
  errorBox.hidden = false;
}

async function boot(): Promise<void> {
  errorBox.hidden = true;
  try {
    cam?.stop();
    cam = await startCamera(video, facing);
    facing = cam.facing;
    video.classList.toggle('mirrored', facing === 'user');
  } catch {
    showError('相機權限被拒或無法開啟鏡頭，請允許相機權限後重試');
    return;
  }
}

startBtn.addEventListener('click', () => {
  startOverlay.hidden = true;
  void boot();
});
retryBtn.addEventListener('click', () => void boot());
flipBtn.addEventListener('click', () => {
  facing = facing === 'user' ? 'environment' : 'user';
  void boot();
});
```

- [ ] **Step 3: 手動驗證（桌機）**

Run: `npm run dev`，瀏覽器開 `https://localhost:5173`（basic-ssl 自簽憑證要按「繼續前往」）
Expected:
1. 看到啟動 overlay（標題 + 啟動按鈕）
2. 按「啟動」→ 瀏覽器要求相機權限 → 允許後全螢幕顯示鏡頭畫面，前鏡頭有鏡像
3. 重新整理後按啟動時**拒絕**權限 → 出現錯誤訊息與重試按鈕

- [ ] **Step 4: Build 檢查 + Commit**

Run: `npm run build`
Expected: 無 TS 錯誤

```bash
git add src/camera.ts src/main.ts
git commit -m "feat: camera startup flow with permission error handling"
```

---

### Task 5: detector.ts — MediaPipe 整合

**Files:**
- Create: `src/detector.ts`
- Modify: `src/main.ts`（載入 detector + 暫時的 console 驗證，Task 9 移除）

**Interfaces:**
- Consumes: `FaceFrame`, `Pt`（from `./types`）
- Produces（`main.ts` 依賴）:
  - `interface Detector { detect(video: HTMLVideoElement, nowMs: number): FaceFrame | null; close(): void }`
  - `createDetector(): Promise<Detector>`（載入失敗會 throw）

- [ ] **Step 1: 實作 src/detector.ts**

```ts
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceFrame, Pt } from './types';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface Detector {
  detect(video: HTMLVideoElement, nowMs: number): FaceFrame | null;
  close(): void;
}

export async function createDetector(): Promise<Detector> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 3,
    outputFaceBlendshapes: true,
  });

  return {
    detect(video, nowMs) {
      const res = landmarker.detectForVideo(video, nowMs);
      if (res.faceLandmarks.length === 0) return null;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      let best: FaceFrame | null = null;
      for (let i = 0; i < res.faceLandmarks.length; i++) {
        const points: Pt[] = res.faceLandmarks[i].map((l) => ({ x: l.x * vw, y: l.y * vh }));
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const blend: Record<string, number> = {};
        for (const c of res.faceBlendshapes[i]?.categories ?? []) blend[c.categoryName] = c.score;
        const frame: FaceFrame = {
          points,
          blend,
          box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        };
        // 鎖定畫面中最大（最近）的臉
        if (!best || frame.box.w * frame.box.h > best.box.w * best.box.h) best = frame;
      }
      return best;
    },
    close() {
      landmarker.close();
    },
  };
}
```

- [ ] **Step 2: main.ts 暫時接上偵測迴圈驗證**

在 `src/main.ts` 加入（標 `// TEMP` 的部分 Task 9 移除）：

```ts
import { createDetector, type Detector } from './detector';

let detector: Detector | null = null;

// boot() 內、相機成功之後加：
  if (!detector) {
    try {
      detector = await createDetector();
    } catch {
      showError('模型載入失敗（需要網路），請重試');
      return;
    }
  }
  requestAnimationFrame(debugLoop); // TEMP

// 檔尾加：
// TEMP: Task 9 移除，改為正式 rAF 迴圈
function debugLoop(): void {
  requestAnimationFrame(debugLoop);
  if (!detector || video.readyState < 2) return;
  const frame = detector.detect(video, performance.now());
  if (frame) {
    console.log('jawOpen:', frame.blend.jawOpen?.toFixed(2), 'box:', Math.round(frame.box.w));
  }
}
```

- [ ] **Step 3: 手動驗證**

Run: `npm run dev`，開 `https://localhost:5173`，按啟動、對著鏡頭
Expected: DevTools console 連續輸出 `jawOpen: 0.0x box: NNN`；張大嘴時 jawOpen 升到 0.6+；臉移出畫面時停止輸出

- [ ] **Step 4: Build 檢查 + Commit**

Run: `npm run build`
Expected: 無 TS 錯誤

```bash
git add src/detector.ts src/main.ts
git commit -m "feat: mediapipe face landmarker integration"
```

---

### Task 6: hud.ts — Canvas HUD（transform 用 TDD，繪製手動驗證）

**Files:**
- Create: `src/hud.ts`
- Test: `src/hud.test.ts`（只測純函式 coverTransform / toScreen）
- Modify: `src/main.ts`（把 debugLoop 換成畫準心）

**Interfaces:**
- Consumes: `Pt`（from `./types`）、`Phase`（from `./fsm`）
- Produces（`main.ts` 依賴）:
  - `interface CoverTransform { scale: number; dx: number; dy: number }`
  - `interface Box { x: number; y: number; w: number; h: number }`
  - `coverTransform(videoW, videoH, screenW, screenH): CoverTransform`
  - `toScreen(p: Pt, t: CoverTransform, mirrored: boolean, screenW: number): Pt`
  - `interface HudFrame { phase: Phase; box: Box | null; value: number | null }`
  - `class Hud { constructor(canvas); resize(): void; draw(f: HudFrame): void; triggerOverload(): void; clearOverload(): void }`

- [ ] **Step 1: 寫失敗測試（transform 純函式）**

`src/hud.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './hud'`

- [ ] **Step 3: 實作 src/hud.ts**

```ts
import type { Pt } from './types';
import type { Phase } from './fsm';

export interface CoverTransform { scale: number; dx: number; dy: number }
export interface Box { x: number; y: number; w: number; h: number }

/** video 像素座標 → object-fit: cover 顯示座標的映射參數 */
export function coverTransform(
  videoW: number, videoH: number, screenW: number, screenH: number,
): CoverTransform {
  const scale = Math.max(screenW / videoW, screenH / videoH);
  return { scale, dx: (screenW - videoW * scale) / 2, dy: (screenH - videoH * scale) / 2 };
}

export function toScreen(p: Pt, t: CoverTransform, mirrored: boolean, screenW: number): Pt {
  const x = p.x * t.scale + t.dx;
  return { x: mirrored ? screenW - x : x, y: p.y * t.scale + t.dy };
}

const GREEN = '#57ff9a';

export interface HudFrame {
  phase: Phase;
  /** 螢幕座標的臉框；無臉時 null */
  box: Box | null;
  /** result/overload 顯示的數值；其他 phase null */
  value: number | null;
}

export class Hud {
  private ctx: CanvasRenderingContext2D;
  private cracks: Pt[][] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
  }

  /** 爆表時產生玻璃裂痕（隨機折線，從畫面中心輻射） */
  triggerOverload(): void {
    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;
    this.cracks = Array.from({ length: 10 }, () => {
      const pts: Pt[] = [{ x: cx, y: cy }];
      let angle = Math.random() * Math.PI * 2;
      let r = 0;
      for (let i = 0; i < 6; i++) {
        r += 30 + Math.random() * 60;
        angle += (Math.random() - 0.5) * 0.9;
        pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
      }
      return pts;
    });
  }

  clearOverload(): void {
    this.cracks = [];
  }

  draw(f: HudFrame): void {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0, 255, 120, 0.05)'; // 綠色鏡片色調
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    ctx.shadowColor = GREEN;
    ctx.shadowBlur = 12;

    if (f.phase === 'searching') this.drawSearchReticle(W, H);
    if (f.box) {
      this.drawBrackets(f.box);
      if (f.phase === 'scanning') {
        this.drawScanline(f.box);
        this.drawValue(f.box, String(1 + Math.floor(Math.random() * 99999))); // 亂數滾動
      }
      if ((f.phase === 'result' || f.phase === 'overload') && f.value !== null) {
        this.drawValue(f.box, String(f.value));
      }
    }
    if (f.phase === 'overload') this.drawOverload(W, H);
  }

  private drawSearchReticle(W: number, H: number): void {
    const { ctx } = this;
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.18;
    const a = (performance.now() / 900) % (Math.PI * 2);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const from = a + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, from, from + Math.PI / 4);
      ctx.stroke();
    }
    ctx.font = '16px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SCANNING...', cx, cy + r + 32);
    ctx.textAlign = 'left';
  }

  private drawBrackets(b: Box): void {
    const { ctx } = this;
    const s = Math.min(b.w, b.h) * 0.2;
    ctx.lineWidth = 3;
    const corners: [number, number, number, number][] = [
      [b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1],
      [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + s * sx, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + s * sy);
      ctx.stroke();
    }
  }

  private drawScanline(b: Box): void {
    const { ctx } = this;
    const y = b.y + ((performance.now() / 600) % 1) * b.h;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(b.x, y);
    ctx.lineTo(b.x + b.w, y);
    ctx.stroke();
  }

  private drawValue(b: Box, text: string): void {
    const { ctx } = this;
    ctx.font = 'bold 40px ui-monospace, monospace';
    ctx.fillText(text, b.x, Math.max(48, b.y - 16));
  }

  private drawOverload(W: number, H: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 40, 40, 0.15)'; // 紅色警告閃爍底
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    for (const line of this.cracks) {
      ctx.beginPath();
      ctx.moveTo(line[0].x, line[0].y);
      for (const p of line.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff5050';
    ctx.font = 'bold 32px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText("IT'S OVER 9000!!", W / 2, H * 0.2);
    ctx.restore();
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test`
Expected: PASS — power + fsm + hud 全綠

- [ ] **Step 5: main.ts 的 debugLoop 改為畫臉框（仍為 TEMP，Task 8 換正式版）**

`debugLoop` 函式替換為：

```ts
import { Hud, coverTransform, toScreen, type Box } from './hud';

const canvas = document.querySelector<HTMLCanvasElement>('#hud')!;
const hud = new Hud(canvas);
hud.resize();
window.addEventListener('resize', () => hud.resize());

// TEMP: Task 8 換成完整狀態機迴圈
function debugLoop(): void {
  requestAnimationFrame(debugLoop);
  if (!detector || video.readyState < 2) return;
  const frame = detector.detect(video, performance.now());
  let box: Box | null = null;
  if (frame) {
    const t = coverTransform(video.videoWidth, video.videoHeight, canvas.clientWidth, canvas.clientHeight);
    const mirrored = facing === 'user';
    const a = toScreen({ x: frame.box.x, y: frame.box.y }, t, mirrored, canvas.clientWidth);
    const b = toScreen({ x: frame.box.x + frame.box.w, y: frame.box.y + frame.box.h }, t, mirrored, canvas.clientWidth);
    box = { x: Math.min(a.x, b.x), y: a.y, w: Math.abs(b.x - a.x), h: b.y - a.y };
  }
  hud.draw({ phase: frame ? 'locked' : 'searching', box, value: null });
}
```

- [ ] **Step 6: 手動驗證**

Run: `npm run dev`，開 `https://localhost:5173`，按啟動
Expected:
1. 無臉時：畫面中央有旋轉的搜尋準心 + `SCANNING...`
2. 有臉時：綠色四角括號貼合臉框，**臉移動時框跟著走、位置不偏移**（cover 裁切映射正確）
3. 前鏡頭鏡像下，往左移動臉，畫面上的框也往左（方向一致）

- [ ] **Step 7: Commit**

```bash
git add src/hud.ts src/hud.test.ts src/main.ts
git commit -m "feat: canvas HUD with reticle, brackets, and cover-fit mapping"
```

---

### Task 7: sfx.ts — WebAudio 音效

**Files:**
- Create: `src/sfx.ts`

**Interfaces:**
- Produces（`main.ts` 依賴）:
  - `initAudio(): void`（必須在 user gesture 內呼叫）
  - `playLock(): void` / `playTick(): void` / `playOverload(): void`

- [ ] **Step 1: 實作 src/sfx.ts**

```ts
let ac: AudioContext | null = null;

/** 必須在 user gesture（按啟動）內呼叫，否則 AudioContext 會被瀏覽器擋下 */
export function initAudio(): void {
  ac ??= new AudioContext();
  void ac.resume();
}

function beep(freq: number, delay: number, dur: number, type: OscillatorType = 'square', vol = 0.04): void {
  if (!ac) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur);
}

export function playLock(): void {
  beep(1320, 0, 0.07);
  beep(1760, 0.09, 0.12);
}

export function playTick(): void {
  beep(880, 0, 0.03, 'square', 0.02);
}

export function playOverload(): void {
  if (!ac) return;
  beep(1200, 0, 0.4, 'sawtooth', 0.06);
  beep(600, 0.1, 0.5, 'sawtooth', 0.06);
  const len = Math.floor(ac.sampleRate * 0.4);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len); // 衰減白噪
  const src = ac.createBufferSource();
  const g = ac.createGain();
  g.gain.value = 0.15;
  src.buffer = buf;
  src.connect(g).connect(ac.destination);
  src.start();
}
```

- [ ] **Step 2: 手動驗證**

Run: `npm run dev`，開頁面，在 DevTools console 執行：

```js
const sfx = await import('/src/sfx.ts');
sfx.initAudio();        // 需先在頁面上點一下
sfx.playLock();
setTimeout(() => sfx.playOverload(), 800);
```

Expected: 聽到「嗶-嗶」鎖定音，接著下降音 + 爆裂噪音

- [ ] **Step 3: Build 檢查 + Commit**

Run: `npm run build`
Expected: 無 TS 錯誤

```bash
git add src/sfx.ts
git commit -m "feat: webaudio synthesized scouter sounds"
```

---

### Task 8: main.ts — 完整狀態機整合

**Files:**
- Modify: `src/main.ts`（全文替換為正式版）

**Interfaces:**
- Consumes: 前面所有 task 的 exports（簽名見各 task 的 Produces）

- [ ] **Step 1: src/main.ts 全文替換**

```ts
import './style.css';
import { startCamera, type CameraHandle } from './camera';
import { createDetector, type Detector } from './detector';
import {
  computeRatios, basePower, effortFromBlend, boostMultiplier,
  smooth, median,
} from './power';
import { initial, start, tick, type FsmState } from './fsm';
import { Hud, coverTransform, toScreen, type Box } from './hud';
import { initAudio, playLock, playTick, playOverload } from './sfx';

const video = document.querySelector<HTMLVideoElement>('#cam')!;
const canvas = document.querySelector<HTMLCanvasElement>('#hud')!;
const startOverlay = document.querySelector<HTMLDivElement>('#start-overlay')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')!;
const errorBox = document.querySelector<HTMLDivElement>('#error-box')!;
const errorMsg = document.querySelector<HTMLParagraphElement>('#error-msg')!;
const retryBtn = document.querySelector<HTMLButtonElement>('#retry-btn')!;
const flipBtn = document.querySelector<HTMLButtonElement>('#flip-btn')!;
const restartBtn = document.querySelector<HTMLButtonElement>('#restart-btn')!;

const hud = new Hud(canvas);
hud.resize();
window.addEventListener('resize', () => hud.resize());

let cam: CameraHandle | null = null;
let detector: Detector | null = null;
let state: FsmState = initial();
let facing: 'user' | 'environment' = 'environment';
let samples: number[] = [];   // scanning 期間收集的瞬時基礎值
let frozenBase = 0;           // scanning 結束時凍結的基礎值
let display = 0;              // 平滑後的顯示數值
let lastTickSfx = 0;

function showError(msg: string): void {
  errorMsg.textContent = msg;
  errorBox.hidden = false;
}

async function boot(): Promise<void> {
  errorBox.hidden = true;
  try {
    cam?.stop();
    cam = await startCamera(video, facing);
    facing = cam.facing;
    video.classList.toggle('mirrored', facing === 'user');
  } catch {
    showError('相機權限被拒或無法開啟鏡頭，請允許相機權限後重試');
    return;
  }
  if (!detector) {
    try {
      detector = await createDetector();
    } catch {
      showError('模型載入失敗（需要網路），請重試');
      return;
    }
  }
  state = start(state, performance.now());
}

startBtn.addEventListener('click', () => {
  initAudio();
  startOverlay.hidden = true;
  void boot();
});
retryBtn.addEventListener('click', () => void boot());
flipBtn.addEventListener('click', () => {
  facing = facing === 'user' ? 'environment' : 'user';
  void boot();
});
restartBtn.addEventListener('click', () => {
  restartBtn.hidden = true;
  display = 0;
  hud.clearOverload();
  state = start(state, performance.now());
});

function onTransition(prev: FsmState['phase'], next: FsmState['phase']): void {
  if (prev === 'searching' && next === 'locked') playLock();
  if (next === 'scanning') samples = [];
  if (prev === 'scanning' && next === 'result') {
    frozenBase = median(samples);
    display = frozenBase;
  }
  if (next === 'overload') {
    playOverload();
    hud.triggerOverload();
    restartBtn.hidden = false;
  }
  if (next === 'searching') {
    display = 0;
    hud.clearOverload();
  }
}

function loop(): void {
  requestAnimationFrame(loop);
  const now = performance.now();
  const frame = detector && video.readyState >= 2 ? detector.detect(video, now) : null;

  const prevPhase = state.phase;
  state = tick(state, { now, faceVisible: frame !== null, displayValue: display });
  if (prevPhase !== state.phase) onTransition(prevPhase, state.phase);

  if (frame) {
    if (state.phase === 'scanning') {
      samples.push(basePower(computeRatios(frame.points)));
      if (now - lastTickSfx > 150) {
        playTick();
        lastTickSfx = now;
      }
    }
    if (state.phase === 'result') {
      const target = frozenBase * boostMultiplier(effortFromBlend(frame.blend));
      display = smooth(display, target);
    }
  }

  let box: Box | null = null;
  if (frame) {
    const t = coverTransform(video.videoWidth, video.videoHeight, canvas.clientWidth, canvas.clientHeight);
    const mirrored = facing === 'user';
    const a = toScreen({ x: frame.box.x, y: frame.box.y }, t, mirrored, canvas.clientWidth);
    const b = toScreen(
      { x: frame.box.x + frame.box.w, y: frame.box.y + frame.box.h },
      t, mirrored, canvas.clientWidth,
    );
    box = { x: Math.min(a.x, b.x), y: a.y, w: Math.abs(b.x - a.x), h: b.y - a.y };
  }
  hud.draw({
    phase: state.phase,
    box,
    value: state.phase === 'result' || state.phase === 'overload' ? Math.round(display) : null,
  });
}

loop();
```

- [ ] **Step 2: 跑測試 + build**

Run: `npm test && npm run build`
Expected: 測試全綠、build 無錯誤

- [ ] **Step 3: 手動驗證完整流程（桌機）**

Run: `npm run dev`，開 `https://localhost:5173`
Expected 依序檢查：
1. 按「啟動」→ 搜尋準心旋轉
2. 臉入鏡 → 「嗶-嗶」鎖定音、四角括號貼臉
3. ~0.6s 後進掃描：掃描線掃過臉框、亂數快速滾動、滴答聲
4. ~1.2s 後定格出基礎值，數字平滑滾動
5. 張大嘴吼 + 皺眉 → 數值飆升；放鬆 → 降回基礎值附近
6. 數值破 9000 → 紅閃 + 玻璃裂痕 + `IT'S OVER 9000!!` + 爆裂音，出現「重新啟動」按鈕
7. 按「重新啟動」→ 回搜尋狀態，裂痕消失
8. 遮住鏡頭 1 秒 → 回搜尋狀態
9. 若自然基礎值太低吼不破 9000：DevTools console 沒有工具能直接改，改測「臉貼近鏡頭重測」數次確認有高基礎值個體；仍不行則暫時把 `BASE_MIN` 調成 2000 驗證 overload 流程後改回（改回後需重跑 `npm test` 確認）

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: full scouter flow with overload easter egg"
```

---

### Task 9: 清理 + 手機驗證 + README

**Files:**
- Modify: `src/main.ts`（確認無 TEMP 殘留）
- Create: `README.md`

- [ ] **Step 1: 清掃 TEMP**

Run: `grep -rn "TEMP\|console.log" src/`
Expected: 無輸出（Task 8 全文替換後應已消失；若有殘留，刪除後重跑 `npm test && npm run build`）

- [ ] **Step 2: README.md**

```markdown
# 戰鬥力探測器 Dragon Ball Scouter

用鏡頭偵測人臉、顯示「戰鬥力」的趣味網頁。張嘴大吼可以發力，破 9000 會爆表。

- 基礎值：臉部幾何比值 → 對數尺度（同一人每次測都相近）
- 加成：MediaPipe blendshapes（jawOpen / browDown / eyeWide）→ 最高 ×10
- 全部在裝置端運算，影像不上傳

## Dev

​```bash
npm install
npm run dev     # https://localhost:5173（自簽憑證，按「繼續前往」）
npm test        # vitest：power / fsm / hud transform
​```

## 手機測試

1. `npm run dev` 後找 terminal 顯示的 Network URL（https://192.168.x.x:5173）
2. 手機與電腦同一 Wi-Fi，開該網址，接受自簽憑證警告
3. 預設開後鏡頭；右下角按鈕切換前後鏡頭
```

（注意：README 內的 code fence 實際寫入時用正常三個反引號）

- [ ] **Step 3: 手機實測**

Run: `npm run dev`，手機開 Network URL
Expected:
1. 後鏡頭啟動、畫面不鏡像；掃他人臉完整跑完鎖定→掃描→數值流程
2. 幀率順暢（無明顯卡頓；GPU delegate 生效）
3. 切換前鏡頭 → 畫面鏡像且臉框方向正確
4. 直式全螢幕佈局正常，按鈕可按

- [ ] **Step 4: 最終驗證 + Commit**

Run: `npm test && npm run build`
Expected: 全綠、build 成功

```bash
git add -A
git commit -m "docs: readme + cleanup"
```

---

## Self-Review 紀錄

- Spec 覆蓋：模組表（T1-T7）、數值計算含凍結基礎值（T2/T8）、狀態機含 debounce（T3）、鏡頭切換與鏡像（T4/T8）、最大臉鎖定（T5）、cover 映射（T6）、爆表彩蛋（T6/T8）、音效合成（T7）、錯誤處理兩類（T4/T5/T8）、HTTPS 限制（T1/T9）、測試策略（純函式 TDD + 手動清單）— 無缺口
- Placeholder：無 TBD/TODO；所有 code step 附完整程式碼
- 型別一致性：`FaceFrame`/`Pt`（types.ts）、`Phase`/`FsmState`（fsm.ts）、`Box`/`HudFrame`（hud.ts）、power 函式簽名 — 各 task 間互相引用處已核對一致
