import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceFrame, Pt } from './types';

// 單一定義供 detector/segmenter 共用 — 版本必須與 package.json 的 @mediapipe/tasks-vision 完全一致
export const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface Detector {
  detect(video: HTMLVideoElement, nowMs: number): FaceFrame | null;
  close(): void;
}

/** 載入階段，供啟動畫面把開機文字綁到真實進度 */
export type DetectorStage = 'wasm' | 'model' | 'warmup';

export async function createDetector(onStage?: (stage: DetectorStage) => void): Promise<Detector> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  onStage?.('wasm');
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 3,
    outputFaceBlendshapes: true,
  });
  onStage?.('model');

  // 暖機：對空白 canvas 跑一次推論，把 GPU shader 編譯成本從首個真實幀移到載入畫面
  const warmup = document.createElement('canvas');
  warmup.width = 64;
  warmup.height = 64;
  warmup.getContext('2d')?.fillRect(0, 0, 64, 64);
  landmarker.detectForVideo(warmup, performance.now());
  onStage?.('warmup');

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
