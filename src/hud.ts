import type { Pt } from './types';
import type { Phase } from './fsm';

export interface CoverTransform { scale: number; dx: number; dy: number }
export interface Box { x: number; y: number; w: number; h: number }

/** video 像素座標 → object-fit: cover 顯示座標的映射參數 */
export function coverTransform(
  videoW: number, videoH: number, screenW: number, screenH: number,
): CoverTransform {
  const scale = Math.max(screenW / videoW, screenH / videoH);
  return { scale, dx: (screenW - videoW * scale) / 2, dy: (screenH - videoH * scale) / 2 };
}

export function toScreen(p: Pt, t: CoverTransform, mirrored: boolean, screenW: number): Pt {
  const x = p.x * t.scale + t.dx;
  return { x: mirrored ? screenW - x : x, y: p.y * t.scale + t.dy };
}

const GREEN = '#57ff9a';

export interface HudFrame {
  phase: Phase;
  /** 螢幕座標的臉框；無臉時 null */
  box: Box | null;
  /** result/overload 顯示的數值；其他 phase null */
  value: number | null;
}

export class Hud {
  private ctx: CanvasRenderingContext2D;
  private cracks: Pt[][] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
  }

  /** 爆表時產生玻璃裂痕（隨機折線，從畫面中心輻射） */
  triggerOverload(): void {
    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;
    this.cracks = Array.from({ length: 10 }, () => {
      const pts: Pt[] = [{ x: cx, y: cy }];
      let angle = Math.random() * Math.PI * 2;
      let r = 0;
      for (let i = 0; i < 6; i++) {
        r += 30 + Math.random() * 60;
        angle += (Math.random() - 0.5) * 0.9;
        pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
      }
      return pts;
    });
  }

  clearOverload(): void {
    this.cracks = [];
  }

  draw(f: HudFrame): void {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0, 255, 120, 0.05)'; // 綠色鏡片色調
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    ctx.shadowColor = GREEN;
    ctx.shadowBlur = 12;

    if (f.phase === 'searching') this.drawSearchReticle(W, H);
    if (f.box) {
      this.drawBrackets(f.box);
      if (f.phase === 'scanning') {
        this.drawScanline(f.box);
        this.drawValue(f.box, String(1 + Math.floor(Math.random() * 99999))); // 亂數滾動
      }
      if ((f.phase === 'result' || f.phase === 'overload') && f.value !== null) {
        this.drawValue(f.box, String(f.value));
      }
    }
    if (f.phase === 'overload') this.drawOverload(W, H);
  }

  private drawSearchReticle(W: number, H: number): void {
    const { ctx } = this;
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.18;
    const a = (performance.now() / 900) % (Math.PI * 2);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const from = a + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, from, from + Math.PI / 4);
      ctx.stroke();
    }
    ctx.font = '16px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SCANNING...', cx, cy + r + 32);
    ctx.textAlign = 'left';
  }

  private drawBrackets(b: Box): void {
    const { ctx } = this;
    const s = Math.min(b.w, b.h) * 0.2;
    ctx.lineWidth = 3;
    const corners: [number, number, number, number][] = [
      [b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1],
      [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + s * sx, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + s * sy);
      ctx.stroke();
    }
  }

  private drawScanline(b: Box): void {
    const { ctx } = this;
    const y = b.y + ((performance.now() / 600) % 1) * b.h;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(b.x, y);
    ctx.lineTo(b.x + b.w, y);
    ctx.stroke();
  }

  private drawValue(b: Box, text: string): void {
    const { ctx } = this;
    ctx.font = 'bold 40px ui-monospace, monospace';
    ctx.fillText(text, b.x, Math.max(48, b.y - 16));
  }

  private drawOverload(W: number, H: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 40, 40, 0.15)'; // 紅色警告閃爍底
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    for (const line of this.cracks) {
      ctx.beginPath();
      ctx.moveTo(line[0].x, line[0].y);
      for (const p of line.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff5050';
    ctx.font = 'bold 32px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText("IT'S OVER 9000!!", W / 2, H * 0.2);
    ctx.restore();
  }
}
