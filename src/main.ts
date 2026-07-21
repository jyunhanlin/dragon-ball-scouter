import './style.css';
import { startCamera, type CameraHandle } from './camera';
import { createDetector, type Detector } from './detector';
import { Hud, coverTransform, toScreen, type Box } from './hud';

const video = document.querySelector<HTMLVideoElement>('#cam')!;
const startOverlay = document.querySelector<HTMLDivElement>('#start-overlay')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')!;
const errorBox = document.querySelector<HTMLDivElement>('#error-box')!;
const errorMsg = document.querySelector<HTMLParagraphElement>('#error-msg')!;
const retryBtn = document.querySelector<HTMLButtonElement>('#retry-btn')!;
const flipBtn = document.querySelector<HTMLButtonElement>('#flip-btn')!;
const canvas = document.querySelector<HTMLCanvasElement>('#hud')!;
const hud = new Hud(canvas);
hud.resize();
window.addEventListener('resize', () => hud.resize());

let cam: CameraHandle | null = null;
let facing: 'user' | 'environment' = 'environment';
let detector: Detector | null = null;

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
  requestAnimationFrame(debugLoop); // TEMP
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
