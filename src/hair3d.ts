/**
 * 超賽 3D 刺蝟頭:three.js 特效層,疊在 video 與 2D HUD canvas 之間。
 *
 * - 只在變身期間渲染(其餘時間 display:none + 不進 render loop,零成本)
 * - 合成走 alpha-over(ADR-0001):髮體不透明、可畫暗部與描邊;bloom 光暈在
 *   最終 composite shader 內以加色疊上(premultiplied:rgb 可超出 alpha,
 *   光暈行為等同舊 screen blend)。單一 WebGL context,無 EffectComposer。
 * - bloom 黑邊的解法:場景先渲進透明 RT,亮部萃取/模糊只作用在 rgb,
 *   alpha 由 base 與光暈亮度在 composite 內重建 — 不存在對黑底合成的步驟
 * - pixelRatio 鎖 1、bloom 鏈跑 1/4 解析度:光暈本來就是模糊的,半解析度視覺無感
 * - 頭部旋轉取自 facialTransformationMatrixes;y-down 螢幕座標與鏡像的四元數翻轉
 *   是紙上推導(未實機校驗)— 方向若相反,調 setQuaternion 裡的正負號即可
 * - 賽璐璐材質(2 階色帶 + inverted-hull 描邊)是 T1 的「能變暗」驗證品,
 *   最終造型與色階在 T4 調校
 */
import * as THREE from 'three';
import type { FaceFrame } from './types';
import {
  SPIKES, buildSpike, domeNormal, domePoint, fitDome, flipWinding, measureAspect, type Dome,
} from './hairgeo';
import { coverTransform, toScreen } from './hud';

export interface Hair3D {
  render(
    frame: FaceFrame | null,
    ssjMs: number,
    videoW: number,
    videoH: number,
    mirrored: boolean,
    sw: number,
    sh: number,
  ): void;
}

// 髮束配置表(SPIKES)與圓頂/幾何演算法都在 hairgeo.ts(純、受測);這裡只組裝與渲染

// 可調常數(T4 造型調校的旋鈕)
export const OUTLINE_SCALE = 1.08;
export const BLOOM_DOWNSCALE = 4; // 亮部/模糊 RT 對螢幕的縮小倍率
export const BLOOM_THRESHOLD = 0.55;
export const BLOOM_STRENGTH = 0.9;
export const GROW_MS = 350; // 變身瞬間的 grow-in 時長(T7 豎起演出會取代)

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// 亮部萃取:只看 rgb(base 是 straight alpha,透明處 rgb=0 不會漏光)
const THRESHOLD_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb;
  gl_FragColor = vec4(max(c - vec3(uThreshold), vec3(0.0)), 1.0);
}`;

// 9-tap 分離高斯;uDir 為 (1/w,0) 或 (0,1/h)
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  float w[5];
  w[0] = 0.227027; w[1] = 0.194595; w[2] = 0.121622; w[3] = 0.054054; w[4] = 0.016216;
  vec3 acc = texture2D(tInput, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uDir * float(i);
    acc += texture2D(tInput, vUv + off).rgb * w[i];
    acc += texture2D(tInput, vUv - off).rgb * w[i];
  }
  gl_FragColor = vec4(acc, 1.0);
}`;

// 最終合成(輸出到 canvas):髮體 straight→premultiplied,光暈直接加在 rgb 上。
// premultiplied canvas 下 rgb 可大於 alpha → 光暈對底下的 video 是純加亮,
// 髮體(alpha=1)則完整覆蓋 — 一張 shader 同時拿到「能變暗」與「screen 式光暈」。
const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tBase;
uniform sampler2D tBloom;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(tBase, vUv);
  vec3 bloom = texture2D(tBloom, vUv).rgb * uStrength;
  float bloomLum = dot(bloom, vec3(0.2126, 0.7152, 0.0722));
  vec3 premult = base.rgb * base.a + bloom;
  float alpha = clamp(base.a + bloomLum, 0.0, 1.0);
  // 手寫 sRGB OETF(與 colorspace_fragment 等效,不依賴 chunk 版本演變)
  gl_FragColor = vec4(pow(premult, vec3(1.0 / 2.2)), alpha);
}`;

/** 純陣列(hairgeo)→ BufferGeometry;winding 反轉見 hairgeo.flipWinding 的說明 */
function toBufferGeometry(g: ReturnType<typeof buildSpike>): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
  geo.setAttribute('spineT', new THREE.BufferAttribute(g.spineT, 1)); // M2 彎曲的鉤子
  geo.setIndex(new THREE.BufferAttribute(flipWinding(g.indices), 1));
  return geo;
}

function fsQuad(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
}

export function createHair3D(insertBefore: HTMLElement): Hair3D {
  // premultipliedAlpha 是 three 預設,但 composite 的 rgb>alpha 加色技巧整個賴在它上面,顯式釘住
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, premultipliedAlpha: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;display:none;';
  insertBefore.parentElement!.insertBefore(renderer.domElement, insertBefore);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -2000, 2000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xfff2c0, 1.1);
  key.position.set(0.3, -1, 1.5);
  scene.add(key);

  // 2 階賽璐璐色帶:暗部/亮部 — T1 驗證「畫得出暗部」,階數與配色 T4 再調
  const grades = new Uint8Array([96, 255]);
  const gradientMap = new THREE.DataTexture(grades, grades.length, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;

  const mat = new THREE.MeshToonMaterial({
    color: 0xffd75e,
    gradientMap,
    emissive: 0xffaa00,
    emissiveIntensity: 0.25,
  });
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x241300, side: THREE.BackSide });

  const group = new THREE.Group();
  const pairs: { spike: THREE.Mesh; hull: THREE.Mesh; s: (typeof SPIKES)[number] }[] = [];
  for (const s of SPIKES) {
    // hairgeo 的局部座標即「髮根在原點、往 -y 長、bend 往 +x 彎」,免旋轉平移
    const geo = toBufferGeometry(buildSpike(s));
    const spike = new THREE.Mesh(geo, mat);
    // inverted hull 描邊:同幾何放大、背面、深色
    const hull = new THREE.Mesh(geo, outlineMat);
    hull.scale.setScalar(OUTLINE_SCALE);
    group.add(hull, spike);
    pairs.push({ spike, hull, s });
  }
  group.visible = false;
  scene.add(group);

  // 髮根落點與生長方向依頭皮圓頂;圓頂由變身第一幀的臉部比例凍結(見 fitDome)
  const UP = new THREE.Vector3(0, -1, 0);
  const nrm = new THREE.Vector3();
  const roll = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  function placeSpikes(dome: Dome): void {
    for (const { spike, hull, s } of pairs) {
      const p = domePoint(dome, s.x, s.z);
      const n = domeNormal(dome, p);
      spike.position.set(p.x, p.y, p.z);
      spike.quaternion.setFromUnitVectors(UP, nrm.set(n.x, n.y, n.z));
      spike.quaternion.multiply(roll.setFromAxisAngle(zAxis, -s.tilt));
      hull.position.copy(spike.position);
      hull.quaternion.copy(spike.quaternion);
    }
  }

  // ---- bloom 鏈的 RT 與全螢幕 pass(單 context,無 EffectComposer)----
  const rtOpts: THREE.RenderTargetOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  };
  const baseRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const smallOpts = { ...rtOpts, depthBuffer: false };
  const brightRT = new THREE.WebGLRenderTarget(1, 1, smallOpts);
  const blurRT = new THREE.WebGLRenderTarget(1, 1, smallOpts);

  const passCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const passScene = new THREE.Scene();
  const thresholdQuad = fsQuad(THRESHOLD_FRAG, {
    tInput: { value: baseRT.texture },
    uThreshold: { value: BLOOM_THRESHOLD },
  });
  const blurQuad = fsQuad(BLUR_FRAG, {
    tInput: { value: null },
    uDir: { value: new THREE.Vector2() },
  });
  const compositeQuad = fsQuad(COMPOSITE_FRAG, {
    tBase: { value: baseRT.texture },
    tBloom: { value: brightRT.texture }, // 分離模糊 H→V 後,結果落回 brightRT
    uStrength: { value: BLOOM_STRENGTH },
  });

  function runPass(quad: THREE.Mesh, target: THREE.WebGLRenderTarget | null): void {
    passScene.clear();
    passScene.add(quad);
    renderer.setRenderTarget(target);
    renderer.render(passScene, passCam);
  }

  let w = 0;
  let h = 0;
  let shown = false;
  let lastSsjMs = Infinity;
  let domeReady = false;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();

  return {
    render(frame, ssjMs, videoW, videoH, mirrored, sw, sh) {
      const active = ssjMs > 0 && frame?.pose !== undefined && videoW > 0;
      if (!active) {
        if (shown) {
          renderer.domElement.style.display = 'none';
          shown = false;
        }
        return;
      }
      if (!shown) {
        renderer.domElement.style.display = '';
        shown = true;
      }
      if (sw !== w || sh !== h) {
        w = sw;
        h = sh;
        renderer.setSize(sw, sh, false);
        baseRT.setSize(sw, sh);
        const bw = Math.max(1, Math.round(sw / BLOOM_DOWNSCALE));
        const bh = Math.max(1, Math.round(sh / BLOOM_DOWNSCALE));
        brightRT.setSize(bw, bh);
        blurRT.setSize(bw, bh);
        camera.left = 0;
        camera.right = sw;
        camera.top = 0;
        camera.bottom = sh;
        camera.updateProjectionMatrix();
      }

      // 每次變身的第一幀量測臉部比例、擬合圓頂並擺放髮根(之後凍結,轉頭不重算)
      if (ssjMs < lastSsjMs) domeReady = false;
      lastSsjMs = ssjMs;
      if (!domeReady) {
        placeSpikes(fitDome(measureAspect(frame.points)));
        domeReady = true;
      }

      const t = coverTransform(videoW, videoH, sw, sh);
      const pivot = toScreen(frame.points[168], t, mirrored, sw); // 鼻樑:轉頭時髮叢繞頭心擺動
      group.position.set(pivot.x, pivot.y, 0);

      m4.fromArray(frame.pose!);
      q.setFromRotationMatrix(m4);
      // MediaPipe y-up 相機空間 → y-down 螢幕:negate y 軸(-x, y, -z 規則);前鏡頭再鏡像 x 軸
      if (mirrored) group.quaternion.set(-q.x, -q.y, q.z, q.w);
      else group.quaternion.set(-q.x, q.y, -q.z, q.w);

      const grow = Math.min(1, ssjMs / GROW_MS);
      const eased = 1 - (1 - grow) * (1 - grow);
      const faceW = frame.box.w * t.scale; // 臉寬(螢幕像素)= 髮束的基準尺度
      group.scale.set(faceW, faceW * eased, faceW);
      group.visible = true;

      // 1) 場景 → 透明 baseRT(髮體 straight alpha)
      renderer.setRenderTarget(baseRT);
      renderer.render(scene, camera);
      // 2) 亮部萃取 → 1/4 解析度
      runPass(thresholdQuad, brightRT);
      // 3) 分離高斯:H(bright→blur)、V(blur→bright),結果留在 brightRT
      const blurMat = blurQuad.material as THREE.ShaderMaterial;
      blurMat.uniforms.tInput.value = brightRT.texture;
      blurMat.uniforms.uDir.value.set(1 / brightRT.width, 0);
      runPass(blurQuad, blurRT);
      blurMat.uniforms.tInput.value = blurRT.texture;
      blurMat.uniforms.uDir.value.set(0, 1 / brightRT.height);
      runPass(blurQuad, brightRT);
      // 4) 合成到 canvas(premultiplied:髮體覆蓋、光暈加亮)
      runPass(compositeQuad, null);
    },
  };
}
