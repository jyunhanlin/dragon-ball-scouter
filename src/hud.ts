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
const GOLD = '#ffd75e';

/** 兩個 #rrggbb 之間線性插值（蓄力時臉框綠→金漸變用） */
function mixColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => {
    const va = (pa >> sh) & 255;
    return Math.round(va + (((pb >> sh) & 255) - va) * t);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; ttl: number; r: number }

const MAX_PARTICLES = 80;

export interface HairFrame {
  /** video 像素空間的金髮圖層（segmenter 產出） */
  img: CanvasImageSource;
  videoW: number;
  videoH: number;
  mirrored: boolean;
}

export interface HudFrame {
  phase: Phase;
  /** 螢幕座標的臉框；無臉時 null */
  box: Box | null;
  /** result/ssj/overload 顯示的數值；其他 phase null */
  value: number | null;
  /** 超賽蓄力進度 0..1（result 中漸變；ssj 起固定 1） */
  charge: number;
  /** ssj 金髮圖層；無則 null */
  hair: HairFrame | null;
  /** 進入 ssj 起算的毫秒數（刺蝟頭 grow-in 用）；非 ssj 為 0 */
  ssjMs: number;
}

export class Hud {
  private ctx: CanvasRenderingContext2D;
  private cracks: Pt[][] = [];
  private particles: Particle[] = [];
  private lastDrawAt = performance.now();

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
    const now = performance.now();
    const dt = Math.min(50, now - this.lastDrawAt) / 1000; // 秒；分頁暫停後夾住避免粒子瞬移
    this.lastDrawAt = now;

    const ssj = f.phase === 'ssj';
    const theme = ssj ? GOLD : mixColor(GREEN, GOLD, f.charge);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = ssj ? 'rgba(255, 200, 60, 0.06)' : 'rgba(0, 255, 120, 0.05)'; // 鏡片色調
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = theme;
    ctx.fillStyle = theme;
    ctx.shadowColor = theme;
    ctx.shadowBlur = 12;

    if (f.hair) this.drawHair(f.hair, W, H);
    if (f.phase === 'searching') this.drawSearchReticle(W, H);
    if (f.box) {
      if (ssj) this.drawSpikes(f.box, Math.min(1, f.ssjMs / 350));
      this.drawBrackets(f.box);
      if (f.phase === 'scanning') {
        this.drawScanline(f.box);
        this.drawValue(f.box, String(1 + Math.floor(Math.random() * 99999))); // 亂數滾動
      }
      if ((f.phase === 'result' || f.phase === 'ssj' || f.phase === 'overload') && f.value !== null) {
        this.drawValue(f.box, String(f.value));
      }
      // 蓄力靜電微粒（稀疏）→ 變身火焰 aura（全開）
      if (ssj) this.spawnAura(f.box, 1);
      else if (f.charge > 0) this.spawnAura(f.box, f.charge * 0.35);
    }
    this.drawParticles(dt);
    if (f.phase === 'overload') this.drawOverload(W, H);
  }

  /** 金髮圖層：video 像素空間 → cover 映射鋪到螢幕（鏡像用整層翻轉，等價於 toScreen 的 x 翻轉） */
  private drawHair(h: HairFrame, W: number, H: number): void {
    const { ctx } = this;
    const t = coverTransform(h.videoW, h.videoH, W, H);
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.85;
    if (h.mirrored) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(h.img, t.dx, t.dy, h.videoW * t.scale, h.videoH * t.scale);
    ctx.restore();
  }

  /** 超賽刺蝟頭剪影：固定比例尖刺（幀間穩定），grow 0..1 做變身瞬間的長出動畫 */
  private drawSpikes(b: Box, grow: number): void {
    const { ctx } = this;
    const heights = [0.55, 0.8, 1, 0.7, 0.9, 0.6];
    const n = heights.length;
    const baseY = b.y + b.h * 0.15; // 髮際線附近
    const eased = 1 - (1 - grow) * (1 - grow);
    const maxH = b.h * 0.55 * eased;
    if (maxH <= 0) return;
    ctx.save();
    ctx.fillStyle = GOLD;
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 18;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(b.x, baseY);
    for (let i = 0; i < n; i++) {
      const x0 = b.x + (b.w * i) / n;
      const x1 = b.x + (b.w * (i + 1)) / n;
      ctx.lineTo((x0 + x1) / 2, baseY - maxH * heights[i]);
      ctx.lineTo(x1, baseY - maxH * 0.15);
    }
    ctx.lineTo(b.x + b.w, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 頭部區域灑金色粒子；intensity 0..1 控制每幀生成量 */
  private spawnAura(b: Box, intensity: number): void {
    const count = Math.round(6 * intensity);
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: b.x + Math.random() * b.w,
        y: b.y + b.h * (0.05 + Math.random() * 0.5), // 頭部上半
        vx: (Math.random() - 0.5) * 40,
        vy: -(80 + Math.random() * 160), // 向上竄
        life: 0,
        ttl: 0.5 + Math.random() * 0.5,
        r: 2 + Math.random() * 3,
      });
    }
  }

  private drawParticles(dt: number): void {
    const { ctx } = this;
    if (this.particles.length === 0) return;
    ctx.save();
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 8;
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      if (p.life >= p.ttl) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const fade = 1 - p.life / p.ttl;
      ctx.globalAlpha = fade;
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * fade, 0, Math.PI * 2);
      ctx.fill();
      return true;
    });
    ctx.restore();
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
