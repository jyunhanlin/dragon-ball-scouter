export interface Pt {
  x: number;
  y: number;
}

export interface FaceFrame {
  /** 478 landmarks，video 像素座標 */
  points: Pt[];
  /** blendshape 名稱 → 分數 0..1（jawOpen、browDownLeft…） */
  blend: Record<string, number>;
  /** landmarks 的 bounding box，video 像素座標 */
  box: { x: number; y: number; w: number; h: number };
  /** 頭部姿態 4x4 矩陣（facialTransformationMatrixes，column-major 16 floats）；未輸出時 undefined */
  pose?: number[];
}
