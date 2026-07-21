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
