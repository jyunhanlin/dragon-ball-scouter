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
        detector = await createDetector();
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
retryBtn.addEventListener('click', () => void boot());
flipBtn.addEventListener('click', () => {
  facing = facing === 'user' ? 'environment' : 'user';
  void boot();
});
restartBtn.addEventListener('click', () => {
  restartBtn.hidden = true;
  // 手動 start() 不經過 onTransition：這裡必須鏡照 onTransition 的 searching 分支
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
