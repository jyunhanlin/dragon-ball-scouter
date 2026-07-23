import { describe, expect, it } from 'vitest';
import { buildSpike, flipWinding, type SpikeSpec } from './hairgeo';

const SPEC: SpikeSpec = { h: 1.0, bend: 0.3, r: 0.15 };

describe('buildSpike:結構契約', () => {
  it('positions/normals/spineT 頂點數一致,indices 為三角形且全部有效', () => {
    const g = buildSpike(SPEC, 8, 4);
    const vertexCount = g.positions.length / 3;
    expect(g.positions.length % 3).toBe(0);
    expect(g.normals.length).toBe(g.positions.length);
    expect(g.spineT.length).toBe(vertexCount);
    expect(g.indices.length % 3).toBe(0);
    for (const i of g.indices) expect(i).toBeLessThan(vertexCount);
  });

  it('拓撲封閉:每條邊最多屬於兩個三角形,唯一開口是髮根環', () => {
    const radial = 8;
    const g = buildSpike(SPEC, radial, 4);
    const edgeCount = new Map<string, number>();
    for (let i = 0; i < g.indices.length; i += 3) {
      const tri = [g.indices[i], g.indices[i + 1], g.indices[i + 2]];
      for (let e = 0; e < 3; e++) {
        const a = tri[e];
        const b = tri[(e + 1) % 3];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      }
    }
    for (const n of edgeCount.values()) expect(n).toBeLessThanOrEqual(2);
    const boundaryEdges = [...edgeCount.values()].filter((n) => n === 1).length;
    expect(boundaryEdges).toBe(radial); // 髮根環的開口邊,其餘全縫合
  });
});

/** 依 spineT 分組取每環中心點(公開資料推得,不碰內部) */
function ringCentroids(g: ReturnType<typeof buildSpike>): { t: number; x: number; y: number }[] {
  const byT = new Map<number, { x: number; y: number; n: number }>();
  for (let v = 0; v < g.spineT.length; v++) {
    const t = g.spineT[v];
    const e = byT.get(t) ?? { x: 0, y: 0, n: 0 };
    e.x += g.positions[v * 3];
    e.y += g.positions[v * 3 + 1];
    e.n += 1;
    byT.set(t, e);
  }
  return [...byT.entries()]
    .map(([t, e]) => ({ t, x: e.x / e.n, y: e.y / e.n }))
    .sort((a, b) => a.t - b.t);
}

describe('buildSpike:脊線', () => {
  it('spineT 全在 [0,1],髮尖為 1', () => {
    const g = buildSpike(SPEC);
    for (const t of g.spineT) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
    expect(g.spineT[g.spineT.length - 1]).toBe(1);
  });

  it('脊線單調:spineT 越大、環中心 y 嚴格越小(往上長)', () => {
    const rings = ringCentroids(buildSpike(SPEC));
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i].y).toBeLessThan(rings[i - 1].y);
    }
  });

  it('髮尖落在配置的終點:y=-h、x=bend*h', () => {
    const g = buildSpike(SPEC);
    const tip = g.spineT.length - 1;
    expect(g.positions[tip * 3 + 1]).toBeCloseTo(-SPEC.h, 5);
    expect(g.positions[tip * 3]).toBeCloseTo(SPEC.bend * SPEC.h, 5);
  });
});

describe('buildSpike:剪影包絡', () => {
  function envelope(g: ReturnType<typeof buildSpike>) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxAbsZ = 0;
    for (let v = 0; v < g.spineT.length; v++) {
      minX = Math.min(minX, g.positions[v * 3]);
      maxX = Math.max(maxX, g.positions[v * 3]);
      minY = Math.min(minY, g.positions[v * 3 + 1]);
      maxY = Math.max(maxY, g.positions[v * 3 + 1]);
      maxAbsZ = Math.max(maxAbsZ, Math.abs(g.positions[v * 3 + 2]));
    }
    return { minX, maxX, minY, maxY, maxAbsZ };
  }

  it('所有頂點落在配置表推得的界內:x∈[-r, bend*h+r]、y∈[-h, r]、|z|≤r', () => {
    const e = envelope(buildSpike(SPEC));
    const { h, bend, r } = SPEC;
    expect(e.minX).toBeGreaterThanOrEqual(-r - 1e-6);
    expect(e.maxX).toBeLessThanOrEqual(bend * h + r + 1e-6);
    expect(e.minY).toBeGreaterThanOrEqual(-h - 1e-6);
    expect(e.maxY).toBeLessThanOrEqual(r + 1e-6);
    expect(e.maxAbsZ).toBeLessThanOrEqual(r + 1e-6);
  });

  it('負 bend 鏡像:x 界變成 [bend*h-r, r]', () => {
    const spec: SpikeSpec = { h: 0.8, bend: -0.4, r: 0.12 };
    const e = envelope(buildSpike(spec));
    expect(e.minX).toBeGreaterThanOrEqual(spec.bend * spec.h - spec.r - 1e-6);
    expect(e.maxX).toBeLessThanOrEqual(spec.r + 1e-6);
  });

  it('配置驅動:h 加倍 → y 深度加倍(調表即調型)', () => {
    const e1 = envelope(buildSpike({ h: 0.6, bend: 0.2, r: 0.1 }));
    const e2 = envelope(buildSpike({ h: 1.2, bend: 0.2, r: 0.1 }));
    expect(e2.minY).toBeCloseTo(e1.minY * 2, 5);
  });
});

describe('buildSpike:錐度與彎曲', () => {
  it('環半徑沿脊線嚴格遞減,髮尖半徑為 0(銳尖)', () => {
    const g = buildSpike(SPEC);
    const centroids = ringCentroids(g);
    const radiusOf = new Map<number, number>();
    for (let v = 0; v < g.spineT.length; v++) {
      const t = g.spineT[v];
      const c = centroids.find((e) => e.t === t)!;
      const dx = g.positions[v * 3] - c.x;
      const dz = g.positions[v * 3 + 2];
      radiusOf.set(t, Math.max(radiusOf.get(t) ?? 0, Math.hypot(dx, dz)));
    }
    const ts = [...radiusOf.keys()].sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) {
      expect(radiusOf.get(ts[i])!).toBeLessThan(radiusOf.get(ts[i - 1])!);
    }
    expect(radiusOf.get(1)).toBe(0);
  });

  it('bend>0 時脊線偏離「根到尖」直線(帶弧度,非直線掃出)', () => {
    const { h, bend } = SPEC;
    const mids = ringCentroids(buildSpike(SPEC)).filter((c) => c.t > 0.2 && c.t < 0.8);
    // 直線參考:x_line(t) = bend*h * (y / -h)
    let maxDeviation = 0;
    for (const c of mids) {
      const lineX = bend * h * (c.y / -h);
      maxDeviation = Math.max(maxDeviation, Math.abs(c.x - lineX));
    }
    expect(maxDeviation).toBeGreaterThan(0.02 * h); // 偏離量得是可見級的
  });

  it('bend=0 退化為直髮束:所有環中心 x=0', () => {
    for (const c of ringCentroids(buildSpike({ h: 1, bend: 0, r: 0.15 }))) {
      expect(c.x).toBeCloseTo(0, 6);
    }
  });
});

describe('buildSpike:法線', () => {
  it('全部單位長', () => {
    const g = buildSpike(SPEC);
    for (let v = 0; v < g.spineT.length; v++) {
      const len = Math.hypot(g.normals[v * 3], g.normals[v * 3 + 1], g.normals[v * 3 + 2]);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('環頂點法線朝外(與「中心→頂點」徑向同側)', () => {
    const g = buildSpike(SPEC);
    const centroids = ringCentroids(g);
    for (let v = 0; v < g.spineT.length - 1; v++) {
      const t = g.spineT[v];
      if (t === 1) continue;
      const c = centroids.find((e) => e.t === t)!;
      const rx = g.positions[v * 3] - c.x;
      const rz = g.positions[v * 3 + 2];
      const dot = g.normals[v * 3] * rx + g.normals[v * 3 + 2] * rz;
      expect(dot).toBeGreaterThan(0);
    }
  });
});

describe('buildSpike:winding 方向', () => {
  it('三角形依 CCW-朝外慣例:面法線與頂點法線同向(flipWinding 前)', () => {
    const g = buildSpike(SPEC);
    for (let i = 0; i < g.indices.length; i += 3) {
      const [ia, ib, ic] = [g.indices[i], g.indices[i + 1], g.indices[i + 2]];
      const ax = g.positions[ia * 3], ay = g.positions[ia * 3 + 1], az = g.positions[ia * 3 + 2];
      const e1x = g.positions[ib * 3] - ax, e1y = g.positions[ib * 3 + 1] - ay, e1z = g.positions[ib * 3 + 2] - az;
      const e2x = g.positions[ic * 3] - ax, e2y = g.positions[ic * 3 + 1] - ay, e2z = g.positions[ic * 3 + 2] - az;
      const fx = e1y * e2z - e1z * e2y;
      const fy = e1z * e2x - e1x * e2z;
      const fz = e1x * e2y - e1y * e2x;
      const area = Math.hypot(fx, fy, fz);
      if (area < 1e-9) continue; // 零面積(髮尖退化)不判向
      const nx = (g.normals[ia * 3] + g.normals[ib * 3] + g.normals[ic * 3]) / 3;
      const ny = (g.normals[ia * 3 + 1] + g.normals[ib * 3 + 1] + g.normals[ic * 3 + 1]) / 3;
      const nz = (g.normals[ia * 3 + 2] + g.normals[ib * 3 + 2] + g.normals[ic * 3 + 2]) / 3;
      expect(fx * nx + fy * ny + fz * nz).toBeGreaterThan(0);
    }
  });
});

describe('flipWinding', () => {
  it('每個三角形交換後兩個 index(反轉 winding)', () => {
    const flipped = flipWinding(new Uint16Array([0, 1, 2, 3, 4, 5]));
    expect(Array.from(flipped)).toEqual([0, 2, 1, 3, 5, 4]);
  });

  it('套用兩次還原(自反)', () => {
    const original = new Uint16Array([7, 8, 9, 1, 0, 4]);
    const twice = flipWinding(flipWinding(original));
    expect(Array.from(twice)).toEqual(Array.from(original));
  });

  it('不改動輸入陣列(純函式)', () => {
    const input = new Uint16Array([0, 1, 2]);
    flipWinding(input);
    expect(Array.from(input)).toEqual([0, 1, 2]);
  });
});
