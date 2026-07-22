/**
 * 超賽 3D 刺蝟頭：three.js 特效層，疊在 video 與 2D HUD canvas 之間。
 *
 * - 只在變身期間渲染（其餘時間 display:none + 不進 render loop，零成本）
 * - mix-blend-mode: screen 疊色 → 這層只能「加亮」（能量髮剛好只需要加亮），
 *   同時迴避 bloom 在透明背景下的黑底問題
 * - pixelRatio 鎖 1：bloom 成本隨像素數放大，發光暈本來就是模糊的，半解析度視覺無感
 * - 頭部旋轉取自 facialTransformationMatrixes；y-down 螢幕座標與鏡像的四元數翻轉
 *   是紙上推導（未實機校驗）— 方向若相反，調 setQuaternion 裡的正負號即可
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { FaceFrame } from './types';
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

// 髮束配置：x/z 為臉寬單位、h 為髮束長、tilt 為外傾角（中央高、兩側外掠）
const SPIKES = [
  // 後排：略矮、往後收
  { x: -0.42, h: 0.65, tilt: -0.5, z: -0.13 },
  { x: -0.14, h: 0.82, tilt: -0.15, z: -0.15 },
  { x: 0.14, h: 0.8, tilt: 0.15, z: -0.15 },
  { x: 0.42, h: 0.62, tilt: 0.5, z: -0.13 },
  // 前排：高、外傾
  { x: -0.5, h: 0.72, tilt: -0.65, z: 0 },
  { x: -0.3, h: 1.0, tilt: -0.35, z: 0 },
  { x: -0.1, h: 1.28, tilt: -0.1, z: 0 },
  { x: 0.1, h: 1.22, tilt: 0.12, z: 0 },
  { x: 0.3, h: 0.96, tilt: 0.38, z: 0 },
  { x: 0.5, h: 0.68, tilt: 0.68, z: 0 },
];

export function createHair3D(insertBefore: HTMLElement): Hair3D {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 1);
  renderer.domElement.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;display:none;';
  insertBefore.parentElement!.insertBefore(renderer.domElement, insertBefore);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -2000, 2000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xfff2c0, 1.1);
  key.position.set(0.3, -1, 1.5);
  scene.add(key);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd75e,
    emissive: 0xffaa00,
    emissiveIntensity: 1.8,
  });
  const group = new THREE.Group();
  for (const s of SPIKES) {
    const geo = new THREE.ConeGeometry(0.15, s.h, 8);
    geo.rotateX(Math.PI); // 錐尖朝 -y（y-down 螢幕座標的上方）
    geo.translate(0, -s.h / 2, 0); // 底部對齊自身原點，往上長
    const cone = new THREE.Mesh(geo, mat);
    cone.position.set(s.x, -0.5, s.z); // 髮根提到頭頂上緣（pivot 在鼻樑）
    cone.rotation.z = -s.tilt;
    group.add(cone);
  }
  group.visible = false;
  scene.add(group);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 1.1, 0.55, 0.15));

  let w = 0;
  let h = 0;
  let shown = false;
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
        composer.setSize(sw, sh);
        camera.left = 0;
        camera.right = sw;
        camera.top = 0;
        camera.bottom = sh;
        camera.updateProjectionMatrix();
      }

      const t = coverTransform(videoW, videoH, sw, sh);
      const pivot = toScreen(frame.points[168], t, mirrored, sw); // 鼻樑：轉頭時髮叢繞頭心擺動
      group.position.set(pivot.x, pivot.y, 0);

      m4.fromArray(frame.pose!);
      q.setFromRotationMatrix(m4);
      // MediaPipe y-up 相機空間 → y-down 螢幕：negate y 軸（-x, y, -z 規則）；前鏡頭再鏡像 x 軸
      if (mirrored) group.quaternion.set(-q.x, -q.y, q.z, q.w);
      else group.quaternion.set(-q.x, q.y, -q.z, q.w);

      const grow = Math.min(1, ssjMs / 350);
      const eased = 1 - (1 - grow) * (1 - grow);
      const faceW = frame.box.w * t.scale; // 臉寬（螢幕像素）＝髮束的基準尺度
      group.scale.set(faceW, faceW * eased, faceW);
      group.visible = true;

      composer.render();
    },
  };
}
