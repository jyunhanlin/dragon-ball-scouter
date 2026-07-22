import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { WASM_URL } from './detector';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite';

export interface HairLayer {
  /** 回傳 video 像素空間的金髮圖層；此幀無頭髮結果時回 null */
  render(video: HTMLVideoElement, nowMs: number): HTMLCanvasElement | null;
  close(): void;
}

export async function createHairSegmenter(): Promise<HairLayer> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const seg = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });

  const maskCanvas = document.createElement('canvas');  // mask → alpha 形狀
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
        // 真染金：遮罩內的 video 像素套金色濾鏡，保留髮絲紋理
        layerCtx.filter = 'sepia(1) saturate(4) brightness(1.35) hue-rotate(-10deg)';
        layerCtx.drawImage(video, 0, 0, vw, vh);
        layerCtx.filter = 'none';
      } else {
        layerCtx.fillStyle = 'rgba(255, 215, 94, 0.6)'; // 降級：平塗半透明金
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
