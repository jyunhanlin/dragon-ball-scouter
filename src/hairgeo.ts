/**
 * 髮束幾何純模組:配置表 → 純陣列(positions/normals/spineT/indices)。
 * 無瀏覽器 API、無 three 依賴 — 可被 vitest 直測(purity split 的受測側)。
 * hair3d.ts 只負責把這些陣列組裝成 BufferGeometry。
 *
 * spineT:每頂點的脊線參數(0=髮根、1=髮尖),是 M2 彎曲動力學的預埋鉤子 —
 * 彎曲 = 以 spineT 為權重對頂點做位移,幾何本體不用重建。
 */

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
  const vertexCount = rings * radialSegments + 1; // 環頂點 + 髮尖
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
  const tip = vertexCount - 1;
  const [tipX, tipY] = spine(1);
  const [ttx, tty] = tangent(1);
  positions[tip * 3] = tipX;
  positions[tip * 3 + 1] = tipY;
  positions[tip * 3 + 2] = 0;
  normals[tip * 3] = ttx;
  normals[tip * 3 + 1] = tty;
  normals[tip * 3 + 2] = 0;
  spineT[tip] = 1;

  // 側面 quad ×2 tris + 尖端扇
  const indices = new Uint16Array(((rings - 1) * radialSegments * 2 + radialSegments) * 3);
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
  return { positions, normals, spineT, indices };
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
