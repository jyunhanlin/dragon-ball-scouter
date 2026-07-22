/**
 * SPIKE（丟棄式驗證碼，非正式功能）：回答一個問題 —
 * 「雙 ML 推論 + three.js 場景 + UnrealBloom 後處理，手機還剩幾 fps？」
 *
 * 便宜取巧之處（正式版要重做）：
 * - canvas 用 mix-blend-mode: screen 疊在 video 上 → 迴避 bloom 在透明背景的黑底問題，
 *   代價是這層只能「加亮」（能量特效剛好只需要加亮）
 * - 正交相機直接用螢幕像素座標（y 向下），錐體位置錨在額頂 landmark 的螢幕投影
 * - 頭部旋轉從 facialTransformationMatrixes 取，軸向做了 y-down 翻轉 — 方向若相反屬 spike 精度，不校
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { FaceFrame } from './types';
import { coverTransform, toScreen } from './hud';

export interface Spike3D {
  render(frame: FaceFrame | null, videoW: number, videoH: number, mirrored: boolean, sw: number, sh: number): void;
}

export function createSpike3D(insertBefore: HTMLElement): Spike3D {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setClearColor(0x000000, 1);
  renderer.domElement.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;';
  insertBefore.parentElement!.insertBefore(renderer.domElement, insertBefore);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xfff2c0, 1.2);
  key.position.set(0, -1, 2);
  scene.add(key);

  const geo = new THREE.ConeGeometry(28, 96, 12);
  geo.rotateX(Math.PI); // 讓錐尖在 y-down 座標裡朝上
  const cone = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xffd75e, emissive: 0xffb300, emissiveIntensity: 1.6 }),
  );
  cone.visible = false;
  scene.add(cone);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 1.2, 0.6, 0.1));

  let w = 0;
  let h = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();

  return {
    render(frame, videoW, videoH, mirrored, sw, sh) {
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
      if (frame?.pose && videoW > 0) {
        const t = coverTransform(videoW, videoH, sw, sh);
        const forehead = toScreen(frame.points[10], t, mirrored, sw);
        cone.position.set(forehead.x, forehead.y - 70, 0);
        m4.fromArray(frame.pose);
        q.setFromRotationMatrix(m4);
        // MediaPipe 相機空間 y 朝上、我們的正交相機 y 朝下：翻 y/z；鏡像時再翻 x
        cone.quaternion.set(mirrored ? -q.x : q.x, -q.y, -q.z, q.w);
        const s = frame.box.w / 220; // 隨臉遠近縮放
        cone.scale.set(s, s, s);
        cone.visible = true;
      } else {
        cone.visible = false;
      }
      composer.render();
    },
  };
}
