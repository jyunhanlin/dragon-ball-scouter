import './style.css';
import { startCamera, type CameraHandle } from './camera';
import { createDetector, type Detector, type DetectorStage } from './detector';
import {
  computeRatios, basePower, effortFromBlend, boostMultiplier,
  smooth, median, chargeStep, ssjClimb, SSJ_CHARGE_MS, SSJ_EFFORT,
} from './power';
import { initial, start, tick, type FsmState } from './fsm';
import { Hud, coverTransform, toScreen, type Box } from './hud';
import { initAudio, playLock, playTick, playOverload, playChargeTick, playTransform } from './sfx';

const video = document.querySelector<HTMLVideoElement>('#cam')!;
const canvas = document.querySelector<HTMLCanvasElement>('#hud')!;
const startOverlay = document.querySelector<HTMLDivElement>('#start-overlay')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')!;
const errorBox = document.querySelector<HTMLDivElement>('#error-box')!;
const errorMsg = document.querySelector<HTMLParagraphElement>('#error-msg')!;
const retryBtn = document.querySelector<HTMLButtonElement>('#retry-btn')!;
const flipBtn = document.querySelector<HTMLButtonElement>('#flip-btn')!;
const restartBtn = document.querySelector<HTMLButtonElement>('#restart-btn')!;
const bootLog = document.querySelector<HTMLPreElement>('#boot-log')!;

const hud = new Hud(canvas);
hud.resize();
window.addEventListener('resize', () => hud.resize());

// ?debug 顯示即時 effort/charge 數值（調參與除錯用）
const debugEl = new URLSearchParams(location.search).has('debug')
  ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'debug' }))
  : null;

let cam: CameraHandle | null = null;
let detector: Detector | null = null;
let state: FsmState = initial();
let facing: 'user' | 'environment' = 'environment';
let samples: number[] = [];   // scanning 期間收集的瞬時基礎值
let frozenBase = 0;           // scanning 結束時凍結的基礎值
let display = 0;              // 平滑後的顯示數值
let lastTickSfx = 0;
let charge = 0;               // 超賽蓄力毫秒數（result 中累積）
let ssjStartValue = 0;        // 變身瞬間的顯示值（爬升起點）
let lastChargeSfx = 0;
let prevNow = performance.now();

function showError(msg: string): void {
  errorMsg.textContent = msg;
  errorBox.hidden = false;
}

// ---- 預載：頁面載入立即開始抓 WASM + 模型（~15MB），使用者讀啟動畫面時在背景下載 ----

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, REDUCED_MOTION ? 0 : ms));
}

let detectorPromise: Promise<Detector>;
let preloadFailed = false;

function initPreload(): void {
  preloadFailed = false;
  const resolvers = {} as Record<DetectorStage, () => void>;
  const stageDone = (s: DetectorStage) => new Promise<void>((r) => { resolvers[s] = r; });
  const stages = { wasm: stageDone('wasm'), model: stageDone('model'), warmup: stageDone('warmup') };
  detectorPromise = createDetector((s) => resolvers[s]());
  detectorPromise.catch(() => { preloadFailed = true; });
  void runBootLog(stages, detectorPromise);
}

interface PendingLine { label: Text; cursor: HTMLSpanElement }

function addLine(text: string): void {
  bootLog.append(text + '\n');
}

function addPendingLine(label: string): PendingLine {
  const labelNode = document.createTextNode(label);
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  cursor.textContent = '█';
  bootLog.append(labelNode, cursor);
  return { label: labelNode, cursor };
}

function finishLine(line: PendingLine, suffix: string): void {
  line.cursor.remove();
  line.label.textContent += suffix + '\n';
}

async function runBootLog(
  stages: Record<DetectorStage, Promise<void>>,
  dp: Promise<Detector>,
): Promise<void> {
  bootLog.textContent = '';
  const failed = dp.then(() => false, () => true);

  addLine('SCOUTER OS v0.1');
  await pause(200);
  addLine('> POWER CELL ............ OK');
  await pause(200);

  const steps: [DetectorStage, string][] = [
    ['wasm', '> COMBAT MODULE .........'],
    ['model', '> TARGET DATABASE .......'],
    ['warmup', '> CALIBRATING SENSOR ....'],
  ];
  for (const [stage, label] of steps) {
    const line = addPendingLine(label);
    const bad = await Promise.race([stages[stage].then(() => false), failed]);
    if (bad) {
      finishLine(line, ' FAIL');
      showError('模型載入失敗（需要網路），請重試');
      return;
    }
    finishLine(line, ' OK');
    await pause(120);
  }
  startBtn.disabled = false;
}

let booting = false;

async function boot(): Promise<void> {
  if (booting) return; // 連點 flip/retry 時的重入會孤兒化已開啟的 stream
  booting = true;
  errorBox.hidden = true;
  try {
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
        detector = await detectorPromise; // 頁面載入時就開跑，這裡通常瞬間 resolve
      } catch {
        showError('模型載入失敗（需要網路），請重試');
        return;
      }
    }
    state = start(state, performance.now());
  } finally {
    booting = false;
  }
}

startBtn.addEventListener('click', () => {
  initAudio();
  startOverlay.hidden = true;
  void boot();
});
retryBtn.addEventListener('click', () => {
  errorBox.hidden = true;
  if (preloadFailed) {
    initPreload();
    // 啟動畫面已關（使用者按過啟動）時，重載完成後直接續跑 boot
    if (startOverlay.hidden) void boot();
    return;
  }
  void boot();
});
flipBtn.addEventListener('click', () => {
  facing = facing === 'user' ? 'environment' : 'user';
  void boot();
});
restartBtn.addEventListener('click', () => {
  restartBtn.hidden = true;
  // 手動 start() 不經過 onTransition：這裡必須鏡照 onTransition 的 searching 分支
  display = 0;
  charge = 0;
  hud.clearOverload();
  state = start(state, performance.now());
});

function onTransition(prev: FsmState['phase'], next: FsmState['phase']): void {
  if (prev === 'searching' && next === 'locked') playLock();
  if (next === 'scanning') {
    samples = [];
    charge = 0;
  }
  if (prev === 'scanning' && next === 'result') {
    frozenBase = median(samples);
    display = frozenBase;
  }
  if (prev === 'result' && next === 'ssj') {
    playTransform();
    ssjStartValue = display; // 爬升起點：變身瞬間的讀數
  }
  if (next === 'overload') {
    playOverload();
    hud.triggerOverload();
    restartBtn.hidden = false;
  }
  if (next === 'searching') {
    display = 0;
    charge = 0;
    hud.clearOverload();
  }
}

function loop(): void {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = now - prevNow;
  prevNow = now;
  const frame = detector && video.readyState >= 2 ? detector.detect(video, now) : null;

  const prevPhase = state.phase;
  state = tick(state, {
    now,
    faceVisible: frame !== null,
    displayValue: display,
    charged: charge >= SSJ_CHARGE_MS,
  });
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
      const effort = effortFromBlend(frame.blend);
      display = smooth(display, frozenBase * boostMultiplier(effort));
      charge = chargeStep(charge, effort, dt);
      if (charge > 0 && now - lastChargeSfx > 150) {
        playChargeTick(charge / SSJ_CHARGE_MS);
        lastChargeSfx = now;
      }
    }
  }
  if (state.phase === 'ssj') {
    // 確定性爬升（臉短暫消失也不中斷）；穿越 9000 時 fsm 交給既有 overload
    display = ssjClimb(ssjStartValue, now - state.phaseAt);
  }

  if (debugEl) {
    const jaw = frame?.blend.jawOpen ?? 0;
    const brow = ((frame?.blend.browDownLeft ?? 0) + (frame?.blend.browDownRight ?? 0)) / 2;
    const eye = ((frame?.blend.eyeWideLeft ?? 0) + (frame?.blend.eyeWideRight ?? 0)) / 2;
    const eff = frame ? effortFromBlend(frame.blend) : 0;
    debugEl.textContent =
      `phase   ${state.phase}\n` +
      `effort  ${eff.toFixed(2)} (need ≥ ${SSJ_EFFORT.toFixed(2)})\n` +
      `charge  ${Math.round(charge)}/${SSJ_CHARGE_MS}\n` +
      `jaw ${jaw.toFixed(2)}  brow ${brow.toFixed(2)}  eye ${eye.toFixed(2)}`;
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
  const showValue = state.phase === 'result' || state.phase === 'ssj' || state.phase === 'overload';
  hud.draw({
    phase: state.phase,
    box,
    value: showValue ? Math.round(display) : null,
    charge: state.phase === 'ssj' ? 1 : state.phase === 'result' ? charge / SSJ_CHARGE_MS : 0,
  });
}

initPreload();
loop();
