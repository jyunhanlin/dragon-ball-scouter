/**
 * 染金（Gold Tint）：hair segmentation 把使用者真髮調成金色，保留真實髮絲紋理與髮際線。
 * 髮束（hair3d）疊在其上補尖刺形狀 — 本層只負責「真髮變金」，不畫任何形狀。
 *
 * 復刻自舊 2D 管線實機驗證過的 segmenter（git show 9e62470^:src/segmenter.ts）：
 * MediaPipe ImageSegmenter（categoryMask）→ alpha 遮罩 → source-in 套金色濾鏡。
 * 瀏覽器綁定模組（canvas/MediaPipe），無單元測試，實機驗收。
 */
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { WASM_URL } from './detector';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite';

// 可調常數（染金調校的旋鈕，T9 調金色從這裡動，不動管線）
export const TINT_INTERVAL_MS = 50; // 分割節流 20Hz（舊管線實測單次 ~29ms，全幀率會吃光幀預算）
// 真染金：遮罩內的 video 像素套金色濾鏡，保留髮絲紋理
export const TINT_FILTER = 'sepia(1) saturate(4) brightness(1.35) hue-rotate(-10deg)';
export const TINT_FALLBACK = 'rgba(255, 215, 94, 0.6)'; // Safari 無 ctx.filter：平塗半透明金

export interface TintLayer {
  /** 回傳 video 像素空間的金髮圖層；此幀無頭髮結果時回 null */
  render(video: HTMLVideoElement, nowMs: number): HTMLCanvasElement | null;
  close(): void;
}

export async function createTint(): Promise<TintLayer> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const seg = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });

  const maskCanvas = document.createElement('canvas'); // mask → alpha 形狀
  const layerCanvas = document.createElement('canvas'); // 最終金髮圖層
  const maskCtx = maskCanvas.getContext('2d')!;
  const layerCtx = layerCanvas.getContext('2d')!;

  // Safari 舊版不支援 ctx.filter：偵測一次，不支援就降級成平塗金色
  layerCtx.filter = 'sepia(1)';
  const filterOk = layerCtx.filter !== 'none';
  layerCtx.filter = 'none';

  // 暖機：把 shader 編譯成本移到載入階段（與 detector 同一教訓）
  const warm = document.createElement('canvas');
  warm.width = 64;
  warm.height = 64;
  warm.getContext('2d')?.fillRect(0, 0, 64, 64);
  seg.segmentForVideo(warm, performance.now()).close();

  return {
    render(video, nowMs) {
      const res = seg.segmentForVideo(video, nowMs);
      const mask = res.categoryMask;
      if (!mask) {
        res.close();
        return null;
      }
      const mw = mask.width;
      const mh = mask.height;
      const data = mask.getAsUint8Array(); // 類別索引：0=背景、>0=頭髮
      if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
        maskCanvas.width = mw;
        maskCanvas.height = mh;
      }
      const img = maskCtx.createImageData(mw, mh);
      for (let i = 0; i < data.length; i++) {
        img.data[i * 4 + 3] = data[i] > 0 ? 255 : 0;
      }
      maskCtx.putImageData(img, 0, 0);

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (layerCanvas.width !== vw || layerCanvas.height !== vh) {
        layerCanvas.width = vw;
        layerCanvas.height = vh;
      }
      layerCtx.clearRect(0, 0, vw, vh);
      layerCtx.drawImage(maskCanvas, 0, 0, vw, vh);
      layerCtx.globalCompositeOperation = 'source-in';
      if (filterOk) {
        layerCtx.filter = TINT_FILTER;
        layerCtx.drawImage(video, 0, 0, vw, vh);
        layerCtx.filter = 'none';
      } else {
        layerCtx.fillStyle = TINT_FALLBACK;
        layerCtx.fillRect(0, 0, vw, vh);
      }
      layerCtx.globalCompositeOperation = 'source-over';
      res.close();
      return layerCanvas;
    },
    close() {
      seg.close();
    },
  };
}
