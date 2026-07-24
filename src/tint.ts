/**
 * 染金（Gold Tint）：hair segmentation 把使用者真髮調成金色，保留真實髮絲紋理與髮際線。
 * 髮束（hair3d）疊在其上補尖刺形狀 — 本層只負責「真髮變金」，不畫任何形狀。
 *
 * T10（ADR-0002）：主路徑為離屏 raw WebGL 的保光染色 shader —— confidence mask
 * smoothstep 軟遮罩＋亮度驅動 shadowGold→highlightGold 雙色 ramp（留明暗、換顏色）。
 * WebGL 不可用時降級回 T8 的 2D 濾鏡鏈（categoryMask 語意改由 conf > 0.5 重建）。
 * 兩條路徑輸出同為 video 像素空間的圖層 canvas，呼叫端（main.ts）無感。
 * 瀏覽器綁定模組（canvas/WebGL/MediaPipe），無單元測試，實機驗收。
 */
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { WASM_URL } from './detector';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite';

// 可調常數（染金調校的旋鈕，T9 調金色從這裡動，不動管線）
export const TINT_INTERVAL_MS = 50; // 分割節流 20Hz（舊管線實測單次 ~29ms，全幀率會吃光幀預算）
export const TINT_EDGE_LO = 0.35; // smoothstep 下緣＝邊緣偏移旋鈕：調高→邊緣內縮（erode 感）
export const TINT_EDGE_HI = 0.75; // 與 LO 的距離＝羽化寬度：拉開→更柔
export const TINT_SHADOW_GOLD: [number, number, number] = [0.55, 0.33, 0.05]; // 暗部金
export const TINT_HIGHLIGHT_GOLD: [number, number, number] = [1.0, 0.86, 0.38]; // 亮部金
// 2D 降級（WebGL 不可用）沿用 T8 濾鏡鏈
export const TINT_FILTER = 'sepia(1) saturate(4) brightness(1.35) hue-rotate(-10deg)';
export const TINT_FALLBACK = 'rgba(255, 215, 94, 0.6)'; // 再無 ctx.filter：平塗半透明金

export interface TintLayer {
  /** 回傳 video 像素空間的金髮圖層；此幀無頭髮結果時回 null */
  render(video: HTMLVideoElement, nowMs: number): HTMLCanvasElement | null;
  close(): void;
  /** 實際走的染色路徑：gl＝保光染色 shader、2d＝T8 濾鏡鏈降級（?debug 顯示用） */
  mode: 'gl' | '2d';
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// 保光染色：亮度只決定金色 ramp 的取樣位置，髮絲的明暗結構原樣穿透
const FRAG = `
precision mediump float;
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform vec2 uEdge;
uniform vec3 uShadowGold;
uniform vec3 uHighlightGold;
varying vec2 vUv;
void main() {
  float conf = texture2D(uMask, vUv).r;
  float a = smoothstep(uEdge.x, uEdge.y, conf);
  // C（時間穩定）接縫：前幀 mask 的 EMA 會混進 conf —— ADR-0002 暫不實作
  vec3 rgb = texture2D(uVideo, vUv).rgb;
  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  vec3 gold = mix(uShadowGold, uHighlightGold, luma);
  gl_FragColor = vec4(gold * a, a); // premultiplied，drawImage 合成用
}`;

interface GlRecolor {
  /** context 遺失時回 null（呼叫端永久降級 2D，不嘗試復原 — ADR-0002） */
  draw(video: HTMLVideoElement, conf: Float32Array, mw: number, mh: number): HTMLCanvasElement | null;
  dispose(): void;
}

/** 離屏 raw WebGL 染色管線；任一步失敗回 null（呼叫端降級 2D） */
function createGlRecolor(): GlRecolor | null {
  const canvas = document.createElement('canvas');
  // preserveDrawingBuffer：main.ts 在 20Hz 節流間隔內每 rAF 重複 drawImage 這張離屏
  // canvas；非 preserve 緩衝在呈現後可否讀回是實作行為非規格保證，不 preserve 會賭到閃爍
  const gl = canvas.getContext('webgl', {
    premultipliedAlpha: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  // 建置中途失敗時主動釋放 context（頁面 context 有上限，不留懸掛的）
  const fail = (): null => {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  };

  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return fail();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return fail();
  gl.useProgram(prog);

  // 全底 quad（triangle strip 四頂點）
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const makeTex = (unit: number): WebGLTexture | null => {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); // mask 低解析→雙線性放大即自帶羽化
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  // 單元→貼圖綁定自此恆定（draw 只切 activeTexture 重上傳，不重 bind）；
  // 若未來加第三張貼圖，這個隱性狀態假設必須整段重審
  const videoTex = makeTex(0);
  const maskTex = makeTex(1);
  if (!videoTex || !maskTex) return fail();
  gl.uniform1i(gl.getUniformLocation(prog, 'uVideo'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'uMask'), 1);
  gl.uniform2f(gl.getUniformLocation(prog, 'uEdge'), TINT_EDGE_LO, TINT_EDGE_HI);
  gl.uniform3fv(gl.getUniformLocation(prog, 'uShadowGold'), TINT_SHADOW_GOLD);
  gl.uniform3fv(gl.getUniformLocation(prog, 'uHighlightGold'), TINT_HIGHLIGHT_GOLD);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // video/mask 都是 top-first，翻一次對齊 GL 座標
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // LUMINANCE 單通道，奇數寬不對齊會撕裂

  let maskBytes = new Uint8Array(0); // conf float→byte 的重用緩衝（避免每 tick 配置）

  // 暖機：1×1 貼圖跑一次 draw，把 shader 首繪成本留在載入階段（與 detector/segmenter 同教訓）
  canvas.width = 1;
  canvas.height = 1;
  gl.viewport(0, 0, 1, 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.activeTexture(gl.TEXTURE1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(1));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  return {
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    draw(video, conf, mw, mh) {
      if (gl.isContextLost()) return null;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (canvas.width !== vw || canvas.height !== vh) {
        canvas.width = vw;
        canvas.height = vh;
        gl.viewport(0, 0, vw, vh);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      if (maskBytes.length !== conf.length) maskBytes = new Uint8Array(conf.length);
      for (let i = 0; i < conf.length; i++) maskBytes[i] = conf[i] * 255;
      gl.activeTexture(gl.TEXTURE1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mw, mh, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, maskBytes);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return canvas;
    },
  };
}

export async function createTint(): Promise<TintLayer> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const seg = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });

  let glr = createGlRecolor(); // null → 2D 降級；runtime context 遺失也會歸 null（永久降級）

  // ---- 2D 降級路徑（T8 原樣，二值遮罩改由 conf > 0.5 重建）----
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

  function render2d(video: HTMLVideoElement, conf: Float32Array, mw: number, mh: number): HTMLCanvasElement {
    if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
      maskCanvas.width = mw;
      maskCanvas.height = mh;
    }
    const img = maskCtx.createImageData(mw, mh);
    for (let i = 0; i < conf.length; i++) {
      img.data[i * 4 + 3] = conf[i] > 0.5 ? 255 : 0;
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
    return layerCanvas;
  }

  return {
    get mode() {
      return glr ? ('gl' as const) : ('2d' as const);
    },
    render(video, nowMs) {
      const res = seg.segmentForVideo(video, nowMs);
      const masks = res.confidenceMasks;
      if (!masks || masks.length === 0) {
        res.close();
        return null;
      }
      // 類別 1＝頭髮（0＝背景）；單輸出模型則取唯一一張
      const mask = masks[masks.length > 1 ? 1 : 0];
      const mw = mask.width;
      const mh = mask.height;
      // 先畫完再 close：getAsFloat32Array 是否回拷貝無文件保證，close 前用完最穩
      const conf = mask.getAsFloat32Array();
      let out: HTMLCanvasElement | null = null;
      if (glr) {
        out = glr.draw(video, conf, mw, mh);
        if (!out) glr = null; // context 遺失：永久降級 2D（ADR-0002），?debug 的 mode 跟著變
      }
      if (!glr) out = render2d(video, conf, mw, mh);
      res.close();
      return out;
    },
    close() {
      glr?.dispose();
      glr = null;
      seg.close();
    },
  };
}
