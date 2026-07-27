import { describe, expect, it } from 'vitest';
import { yawFromPose } from './pose';

/** column-major 4x4：以 3x3 旋轉列(row-major 可讀)組出 MediaPipe 的矩陣佈局 */
function poseOf(rows: number[][], tx = 0, ty = 0, tz = 0): number[] {
  return [
    rows[0][0], rows[1][0], rows[2][0], 0,
    rows[0][1], rows[1][1], rows[2][1], 0,
    rows[0][2], rows[1][2], rows[2][2], 0,
    tx, ty, tz, 1,
  ];
}

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** 繞直立軸(y)旋轉的標準右手系矩陣;第 3 行 = 鼻子朝向的像 */
function ry(deg: number): number[][] {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

/** 繞水平軸(x)= 點頭 */
function rx(deg: number): number[][] {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

/** 繞視線軸(z)= 歪頭 */
function rz(deg: number): number[][] {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

function mul(a: number[][], b: number[][]): number[][] {
  return a.map((row) => [0, 1, 2].map((j) => row.reduce((acc, v, k) => acc + v * b[k][j], 0)));
}

describe('yawFromPose', () => {
  it('正對鏡頭（單位旋轉）為 0 度', () => {
    expect(yawFromPose(poseOf(IDENTITY))).toBe(0);
  });

  it('往兩側轉的符號相反、量值等於實際轉角', () => {
    // ry(+30) 把鼻子朝向轉到相機 +x（未鏡像畫面的右側）= 使用者轉向自己的左邊
    expect(yawFromPose(poseOf(ry(30)))!).toBeCloseTo(30, 6);
    expect(yawFromPose(poseOf(ry(-30)))!).toBeCloseTo(-30, 6);
  });

  it('轉到 ±90°（正側面）不飽和、不跳號', () => {
    expect(yawFromPose(poseOf(ry(90)))!).toBeCloseTo(90, 6);
    expect(yawFromPose(poseOf(ry(-90)))!).toBeCloseTo(-90, 6);
    // 超過 90° 仍連續（不是被 asin 夾回來的鏡像值）
    expect(yawFromPose(poseOf(ry(120)))!).toBeCloseTo(120, 6);
  });

  it('點頭與歪頭不污染 yaw 讀數（真人不會只有純側轉）', () => {
    expect(yawFromPose(poseOf(mul(ry(35), rx(20))))!).toBeCloseTo(35, 6);
    expect(yawFromPose(poseOf(mul(ry(35), rz(25))))!).toBeCloseTo(35, 6);
  });

  it('矩陣帶平移與均勻縮放時讀數不變（MediaPipe 的矩陣含頭部位置與尺度）', () => {
    const scaled = ry(-52).map((row) => row.map((v) => v * 8.5));
    expect(yawFromPose(poseOf(scaled, 120, -40, -35))!).toBeCloseTo(-52, 6);
  });

  it('沒有姿態可讀時回傳 null（追丟時讀數必須斷掉，不是靜默凍住）', () => {
    expect(yawFromPose(undefined)).toBeNull();
    expect(yawFromPose([])).toBeNull();
    // 截斷的矩陣:前 12 個數看起來像一個完整的旋轉部分，仍不足以構成姿態
    expect(yawFromPose(poseOf(ry(30)).slice(0, 12))).toBeNull();
  });
});
