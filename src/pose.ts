/**
 * 頭部姿態解碼:MediaPipe 的 facialTransformationMatrixes → 角度。
 * 純模組(無瀏覽器 API、無 three)— 可被 vitest 直測(purity split 的受測側)。
 */

/**
 * 側轉角(度)。回傳 null = 沒有姿態可讀(臉追丟或模型沒輸出矩陣)。
 *
 * 正值 = 使用者把頭轉向**自己的左邊**(未鏡像的畫面上臉朝畫面右側)。
 * 這個符號約定是紙上推導,以 `?debug` 的讀數為準 — 若實機相反,改這裡的
 * 正負號,不要改 hair3d 的四元數。
 */
export function yawFromPose(pose: number[] | undefined): number | null {
  if (!pose || pose.length < 16) return null; // 4x4 才是完整姿態;截斷的矩陣不猜
  // 旋轉矩陣第 3 行(model +z,即鼻子朝向)在相機空間的 x/z 分量:
  // column-major 佈局下 R[row][col] = pose[col * 4 + row]
  return (Math.atan2(pose[8], pose[10]) * 180) / Math.PI;
}
