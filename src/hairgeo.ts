/**
 * 髮束幾何純模組:配置表 → 純陣列(positions/normals/spineT/indices)。
 * 無瀏覽器 API、無 three 依賴 — 可被 vitest 直測(purity split 的受測側)。
 * hair3d.ts 只負責把這些陣列組裝成 BufferGeometry。
 *
 * spineT:每頂點的脊線參數(0=髮根、1=髮尖),是 M2 彎曲動力學的預埋鉤子 —
 * 彎曲 = 以 spineT 為權重對頂點做位移,幾何本體不用重建。
 */

import type { Pt } from './types';

/** 髮束規格(臉寬單位)。tilt 屬於擺放不屬於幾何,由 hair3d 以 rotation 施加 */
export interface SpikeSpec {
  /** 髮束長 */
  h: number;
  /** 彎曲量:髮尖沿局部 +x 偏移 bend*h(掛上 rotation 後即「往外掠」) */
  bend: number;
  /** 髮根半徑 */
  r: number;
}

/** 純陣列幾何:hair3d 組裝成 BufferGeometry;spineT 是 M2 彎曲的每頂點權重 */
export interface SpikeGeo {
  positions: Float32Array;
  normals: Float32Array;
  spineT: Float32Array;
  indices: Uint16Array;
}

// 可調常數(整體曲線性格;每束的長度/彎量/半徑在 hair3d 的配置表)
export const CTRL_X = 0.2; // 貝茲控制點的 x 比例:根部近直、越往尖端越彎
export const TAPER_EXP = 1.2; // 錐度指數:>1 讓髮尖收得更銳

/**
 * 沿二次貝茲脊線掃描 n 邊形截面成一根髮束。
 * 局部座標:髮根在原點、往 -y 長(y-down 螢幕座標的上方)、bend 往 +x 彎。
 * 脊線是平面曲線(xy 平面),截面 frame 因此免平行移送:N=面內法向、B=+z。
 */
export function buildSpike(spec: SpikeSpec, radialSegments = 8, rings = 6): SpikeGeo {
  const { h, bend, r } = spec;
  // 環頂點 + 髮尖 + 底蓋(蓋環重複頂點以取硬邊軸向法線 + 蓋心)
  const vertexCount = rings * radialSegments + 1 + radialSegments + 1;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const spineT = new Float32Array(vertexCount);

  // 二次貝茲:P0=原點、P1=(bend*h*CTRL_X, -h/2)、P2=(bend*h, -h)
  const p1x = bend * h * CTRL_X;
  const p1y = -h / 2;
  const p2x = bend * h;
  const p2y = -h;
  const spine = (t: number): [number, number] => {
    const u = 1 - t;
    return [2 * u * t * p1x + t * t * p2x, 2 * u * t * p1y + t * t * p2y];
  };
  const tangent = (t: number): [number, number] => {
    const u = 1 - t;
    const tx = 2 * u * p1x + 2 * t * (p2x - p1x);
    const ty = 2 * u * p1y + 2 * t * (p2y - p1y);
    const len = Math.hypot(tx, ty) || 1;
    return [tx / len, ty / len];
  };

  for (let i = 0; i < rings; i++) {
    const t = i / rings;
    const [cx, cy] = spine(t);
    const [tx, ty] = tangent(t);
    // 面內法向:+z × T = (-ty, tx, 0)
    const nx = -ty;
    const ny = tx;
    // 法線取圓柱式近似(純徑向,忽略錐度的軸向傾斜):toon 色階量化下
    // 差異不可辨;T4 若改連續色階再補精確法線
    const radius = r * Math.pow(1 - t, TAPER_EXP);
    for (let j = 0; j < radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const v = i * radialSegments + j;
      positions[v * 3] = cx + nx * cosA * radius;
      positions[v * 3 + 1] = cy + ny * cosA * radius;
      positions[v * 3 + 2] = sinA * radius;
      normals[v * 3] = nx * cosA;
      normals[v * 3 + 1] = ny * cosA;
      normals[v * 3 + 2] = sinA;
      spineT[v] = t;
    }
  }
  const tip = rings * radialSegments;
  const [tipX, tipY] = spine(1);
  const [ttx, tty] = tangent(1);
  positions[tip * 3] = tipX;
  positions[tip * 3 + 1] = tipY;
  positions[tip * 3 + 2] = 0;
  normals[tip * 3] = ttx;
  normals[tip * 3 + 1] = tty;
  normals[tip * 3 + 2] = 0;
  spineT[tip] = 1;

  // 底蓋:蓋環複製 t=0 環的位置、法線改軸向 +y(遠離髮尖的外側)— 封住髮根,
  // tilt 翻轉(額前垂髮)時才不會看進管內
  const capRing = tip + 1;
  const capCenter = capRing + radialSegments;
  for (let j = 0; j < radialSegments; j++) {
    const src = j; // t=0 環
    const dst = capRing + j;
    positions[dst * 3] = positions[src * 3];
    positions[dst * 3 + 1] = positions[src * 3 + 1];
    positions[dst * 3 + 2] = positions[src * 3 + 2];
    normals[dst * 3] = 0;
    normals[dst * 3 + 1] = 1;
    normals[dst * 3 + 2] = 0;
    spineT[dst] = 0;
  }
  positions[capCenter * 3] = 0;
  positions[capCenter * 3 + 1] = 0;
  positions[capCenter * 3 + 2] = 0;
  normals[capCenter * 3] = 0;
  normals[capCenter * 3 + 1] = 1;
  normals[capCenter * 3 + 2] = 0;
  spineT[capCenter] = 0;

  // 側面 quad ×2 tris + 尖端扇 + 底蓋扇
  const indices = new Uint16Array(((rings - 1) * radialSegments * 2 + radialSegments * 2) * 3);
  let k = 0;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * radialSegments + j;
      const b = i * radialSegments + ((j + 1) % radialSegments);
      const c = a + radialSegments;
      const d = b + radialSegments;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }
  for (let j = 0; j < radialSegments; j++) {
    const a = (rings - 1) * radialSegments + j;
    const b = (rings - 1) * radialSegments + ((j + 1) % radialSegments);
    indices[k++] = a;
    indices[k++] = b;
    indices[k++] = tip;
  }
  for (let j = 0; j < radialSegments; j++) {
    // 蓋扇朝 +y:(center, j+1, j) 的 winding 給出 +y 面法線(有方向測試把關)
    indices[k++] = capCenter;
    indices[k++] = capRing + ((j + 1) % radialSegments);
    indices[k++] = capRing + j;
  }
  return { positions, normals, spineT, indices };
}

/**
 * 髮束擺放。ex/ez 是**足印座標**:圓頂上殼的歸一化位置,不是臉寬單位的絕對座標。
 * ex = 左右(-1 左耳、0 正中、+1 右耳),ez = 前後(+1 髮際線、0 頭頂正中、-1 後頸)。
 * 髮型因此錨在圓頂上 —— 圓頂的錨點/深度一改(那是實機量出來的,見 DOME_CZ),
 * 整顆髮型跟著頭骨走,不必重排配置表。tilt 為外傾角。
 */
export interface SpikePlacement extends SpikeSpec {
  ex: number;
  ez: number;
  tilt: number;
}

// 髮束配置表 — 調型改表,不改演算法。仲裁看造型基準的剪影面向(CONTEXT.md)。
// 三特徵:額前兩撮垂髮(tilt 翻轉近 π=朝下)、主體往上後方的大尖刺簇(z 負)、
// 左右不對稱(左側整體偏高、主尖偏左)。bend 與 tilt 同號=往外勾。
export const SPIKES: SpikePlacement[] = [
  // 後排:略矮、往後收
  { ex: -0.724, ez: -0.1, h: 0.72, tilt: -0.55, bend: -0.3, r: 0.13 },
  { ex: -0.241, ez: -0.14, h: 0.88, tilt: -0.18, bend: -0.14, r: 0.15 },
  { ex: 0.241, ez: -0.14, h: 0.78, tilt: 0.2, bend: 0.14, r: 0.14 },
  { ex: 0.724, ez: -0.1, h: 0.6, tilt: 0.55, bend: 0.3, r: 0.12 },
  // 前排:高、外傾;主尖偏左(x=-0.08)且最高 — 不對稱的錨點
  { ex: -0.862, ez: 0.16, h: 0.78, tilt: -0.7, bend: -0.38, r: 0.13 },
  { ex: -0.517, ez: 0.16, h: 1.08, tilt: -0.38, bend: -0.27, r: 0.15 },
  { ex: -0.138, ez: 0.16, h: 1.38, tilt: -0.14, bend: -0.18, r: 0.17 },
  { ex: 0.207, ez: 0.16, h: 1.12, tilt: 0.16, bend: 0.18, r: 0.15 },
  { ex: 0.517, ez: 0.16, h: 0.88, tilt: 0.42, bend: 0.3, r: 0.13 },
  { ex: 0.862, ez: 0.16, h: 0.6, tilt: 0.72, bend: 0.38, r: 0.11 },
  // 額前兩撮:短、細,tilt 翻轉過 π/2 → 轉為垂掛。實際方向是圓頂法線+roll 的
  // 合成(偏側向下、微交叉),且 |tilt|>π/2 後 bend 同號實際往「內」勾 — 以畫面為準
  { ex: -0.259, ez: 0.72, h: 0.34, tilt: -2.55, bend: -0.18, r: 0.07 },
  { ex: 0.224, ez: 0.72, h: 0.3, tilt: 2.6, bend: 0.16, r: 0.06 },
  // ---- 後腦(#15 鋪滿)---------------------------------------------------
  // 足印 -0.22 → -0.97,五排包到後頸。半徑推到 0.9 以上是關鍵:圓頂錨點校準後
  // ry 從 0.279 長到 0.48,若沿用舊的 0.77 級足印半徑,髮根只佔圓頂上緣約 24%,
  // 後腦下半(真髮被染金的那一片)整片光著 —— 實機照片量到的正是這個。
  // 每排的 |ex| 上限由 rad<FOOTPRINT_MAX 決定,所以越往後排越窄,那是幾何逼的。
  { ex: -0.88, ez: -0.22, h: 0.72, tilt: -0.6, bend: -0.32, r: 0.13 },
  { ex: -0.32, ez: -0.22, h: 1.0, tilt: -0.2, bend: -0.14, r: 0.15 },
  { ex: 0.34, ez: -0.22, h: 0.95, tilt: 0.22, bend: 0.15, r: 0.15 },
  { ex: 0.88, ez: -0.22, h: 0.68, tilt: 0.6, bend: 0.32, r: 0.12 },
  { ex: -0.8, ez: -0.45, h: 0.62, tilt: -0.55, bend: -0.28, r: 0.12 },
  { ex: -0.28, ez: -0.45, h: 0.88, tilt: -0.18, bend: -0.12, r: 0.14 },
  { ex: 0.3, ez: -0.45, h: 0.82, tilt: 0.2, bend: 0.13, r: 0.14 },
  { ex: 0.8, ez: -0.45, h: 0.58, tilt: 0.55, bend: 0.28, r: 0.11 },
  { ex: -0.6, ez: -0.68, h: 0.55, tilt: -0.5, bend: -0.24, r: 0.11 },
  { ex: 0, ez: -0.68, h: 0.72, tilt: 0, bend: -0.1, r: 0.13 },
  { ex: 0.6, ez: -0.68, h: 0.52, tilt: 0.5, bend: 0.24, r: 0.1 },
  { ex: -0.4, ez: -0.87, h: 0.42, tilt: -0.35, bend: -0.18, r: 0.09 },
  { ex: 0, ez: -0.87, h: 0.5, tilt: 0, bend: -0.08, r: 0.1 },
  { ex: 0.4, ez: -0.87, h: 0.4, tilt: 0.35, bend: 0.18, r: 0.09 },
  // 後頸最後緣:足印半徑 0.98,再往外會被 FOOTPRINT_MAX 夾走
  { ex: -0.15, ez: -0.97, h: 0.34, tilt: -0.1, bend: -0.1, r: 0.08 },
  { ex: 0.15, ez: -0.97, h: 0.32, tilt: 0.1, bend: 0.1, r: 0.08 },
];

// ---- 頭皮圓頂(Scalp Dome):髮根分佈面 ----

/** 軸對齊橢球(臉寬單位、鼻樑為原點、y-down)。頭皮圓頂與頭部代理共用這個形狀 */
export interface Ellipsoid {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
}

/** 頭皮圓頂:只用上殼 — 髮根落在上面,髮束沿法線生長 */
export type Dome = Ellipsoid;

// 圓頂比例(對臉寬;由造型目測校準,T4 對基準圖時再調)
export const DOME_RX = 0.58; // 半寬:略寬於臉框,髮叢才蓋得住鬢角上緣
// 高度對上臉高比例(aspect 定義見 fitDome)。?proxy 實機量測(2026-07-27 第二輪):
// 線框半高 127px vs 真人顱骨半高 227px、偵測框寬 420px —— 中心高度已對,純粹太扁,
// 髮根因此長在眉毛高度而不是頭皮上
export const DOME_RY_PER_ASPECT = 1.55;
// 前後深與錨點:圓頂必須包住**頭骨**,不是包住臉。實機照片量到舊值(rz=0.5、
// cz=-0.08)的後緣比真人後腦短了約 0.5 個臉寬 —— 髮根面根本沒延伸到後腦,
// 髮束當然全擠在額頭。正交投影下純 z 位移在正面完全不改變畫面,所以這個錯位
// 正面驗不出來、一側轉才現形;`?proxy` 就是為了量它而存在的量具。
// 現值由 ?proxy 的青色線框對真人頭骨實機量得(2026-07-27,兩輪):第二輪量到前極比
// 額頭前緣多凸 95px、後緣短 35px(側轉 ≈55°,線框投影寬算 516 vs 實測 505,吻合)。
// 收斂後 rx/ry/rz = 0.58/0.48/0.54 → 直徑 1.16×0.96×1.08 臉寬,是一顆真的頭的比例;
// 舊值 1.16×0.56×1.26 是塊煎餅 —— 這個交叉驗證比單張照片的量測更能背書
export const DOME_RZ = 0.54; // 前後深(後緣到後頸、前緣到髮際線)
export const DOME_CY = -0.18; // 中心高度(鼻樑上方)
export const DOME_CZ = -0.74; // 中心在鼻樑後方 = 頭骨中心,不是鼻樑
const FOOTPRINT_MAX = 0.995; // 足印半徑上限:貼著赤道會讓法線貼平、y 梯度退化

// aspect 鉗位:2D 投影在側轉/點頭時透縮,量出來的比例會失真;
// 鉗在合理頭型範圍內,把「轉著頭變身」凍結到的誤差鎖住
export const ASPECT_MIN = 0.24;
export const ASPECT_MAX = 0.4;

/**
 * 從 landmark 量上臉高/臉寬:10(額頂)↔168(鼻樑) ÷ 234↔454(兩頰)。
 * 用上臉不用下巴(152)— 變身時張嘴大吼會把臉量長。結果經 ASPECT_MIN/MAX 鉗位。
 */
export function measureAspect(points: readonly Pt[]): number {
  const upper = Math.hypot(points[10].x - points[168].x, points[10].y - points[168].y);
  const width = Math.hypot(points[454].x - points[234].x, points[454].y - points[234].y) || 1;
  return Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, upper / width));
}

/**
 * 由臉部比例擬合圓頂。aspect 來自 measureAspect,由呼叫端在每次變身第一幀
 * 凍結(那一刻使用者通常正對鏡頭;若不是,鉗位保證圓頂仍在合理範圍)。
 */
export function fitDome(aspect: number): Dome {
  return {
    cx: 0,
    cy: DOME_CY,
    cz: DOME_CZ,
    rx: DOME_RX,
    ry: DOME_RY_PER_ASPECT * aspect,
    rz: DOME_RZ,
  };
}

/** 把足印座標 (ex,ez) 投上圓頂上殼;足印外的座標 clamp 回邊緣 */
export function domePoint(d: Dome, ex0: number, ez0: number): { x: number; y: number; z: number } {
  let ex = ex0;
  let ez = ez0;
  const rad = Math.hypot(ex, ez);
  if (rad > FOOTPRINT_MAX) {
    ex *= FOOTPRINT_MAX / rad;
    ez *= FOOTPRINT_MAX / rad;
  }
  const y = d.cy - d.ry * Math.sqrt(1 - ex * ex - ez * ez);
  return { x: d.cx + ex * d.rx, y, z: d.cz + ez * d.rz };
}

// ---- 頭部代理(Head Proxy):只寫深度、不寫顏色的擋頭幾何 ----

// 代理相對圓頂的形變(對圓頂半徑的比例 + 中心往後推的量,臉寬單位)。
// ⚠ 代理不是「等比縮小的圓頂」,而且不能是 —— 圓頂是「髮根長在哪」的面,它的前緣
// 鼓到 z = cz+rz = +0.42,遠在鼻樑(z=0)之前;而額前兩撮垂髮 tilt 翻過 π/2 之後
// 生長方向是法線的 -83%,髮尖落在圓頂內部(歸一化半徑約 0.52)。等比縮小要縮到
// 0.52 以下才不會把那兩撮吃掉,那種尺寸連後腦都擋不住 —— 等比這條路是死的。
// 因此代理壓扁 z(×0.4)並往後推:前緣正好退到鼻樑平面,前面讓開垂髮與臉,
// 頂/側/背仍在髮根面內側。已知代價:側轉大角度時代理的剪影比真頭窄,後腦真正
// 鋪滿(#15)時要重看這組值。
export const PROXY_SCALE = { rx: 0.95, ry: 0.96, rz: 0.9 }; // 對圓頂半徑的比例
export const PROXY_CZ = 0; // 中心再往後推的量(臉寬單位)

/** 頭部代理:整顆橢球都算數 — 擋頭的是它的近側表面,臉那半邊本來就屬於頭 */
export type HeadProxy = Ellipsoid;

/** 圓頂 → 頭部代理。hair3d 只負責把這六個數組成 depth-only mesh */
export function headProxy(d: Dome): HeadProxy {
  return {
    cx: d.cx,
    cy: d.cy,
    cz: d.cz + PROXY_CZ,
    rx: d.rx * PROXY_SCALE.rx,
    ry: d.ry * PROXY_SCALE.ry,
    rz: d.rz * PROXY_SCALE.rz,
  };
}

/** 圓頂面上一點的外法線(橢球隱函數梯度,單位化)= 髮束的生長方向 */
export function domeNormal(d: Dome, p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const gx = (p.x - d.cx) / (d.rx * d.rx);
  const gy = (p.y - d.cy) / (d.ry * d.ry);
  const gz = (p.z - d.cz) / (d.rz * d.rz);
  const len = Math.hypot(gx, gy, gz) || 1;
  return { x: gx / len, y: gy / len, z: gz / len };
}

/**
 * y-down 正交投影(top=0,bottom=sh)是鏡像投影,螢幕上三角形 winding 全面反轉。
 * three 只會替「物件矩陣」的負行列式自動補償 frontFace,不會替投影矩陣補償。
 * 所有進入髮層場景的幾何都必須經過這個反轉(index 反向、法線保持原樣),
 * FrontSide/BackSide 語義才會正常。
 */
export function flipWinding(indices: Uint16Array): Uint16Array {
  const out = new Uint16Array(indices);
  for (let i = 0; i < out.length; i += 3) {
    const b = out[i + 1];
    out[i + 1] = out[i + 2];
    out[i + 2] = b;
  }
  return out;
}
