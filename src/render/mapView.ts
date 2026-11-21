import type { Scenario } from '../engine/scenario';
import type { Simulator } from '../engine/simulator';
import type { Telemetry } from '../engine/simulator';
import type { Box } from '../engine/terrain';
import { Random } from '../engine/rng';
import { buildTerrainImage } from './terrainImage';

interface Camera {
  x: number;
  y: number;
  k: number; // 米 → 像素
}

interface WindParticle {
  x: number;
  y: number;
  life: number;
}

export interface HoverInfo {
  text: string;
  sx: number;
  sy: number;
}

export class MapView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scn: Scenario;
  private readonly base: HTMLCanvasElement;
  private cam: Camera;
  private particles: WindParticle[] = [];
  private readonly rng: Random;
  private dpr = 1;
  hover: HoverInfo | null = null;
  showRain = true;
  showWind = true;
  showTracks = true;

  constructor(canvas: HTMLCanvasElement, scn: Scenario) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.scn = scn;
    this.base = buildTerrainImage(scn);
    this.cam = { x: 0, y: 0, k: 1 };
    this.fit();
    this.rng = new Random(scn.seed ^ 0x77aa55);
    for (let i = 0; i < 260; i++) {
      this.particles.push({
        x: scn.box.minX + this.rng.next() * (scn.box.maxX - scn.box.minX),
        y: scn.box.minY + this.rng.next() * (scn.box.maxY - scn.box.minY),
        life: Math.floor(this.rng.next() * 200),
      });
    }
    this.attachControls();
  }

  private attachControls(): void {
    const c = this.canvas;
    let dragging = false;
    let lx = 0;
    let ly = 0;
    c.addEventListener('mousedown', (e) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      c.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
      c.style.cursor = 'grab';
    });
    c.addEventListener('mousemove', (e) => {
      if (!dragging) {
        this.updateHover(e);
        return;
      }
      const r = c.getBoundingClientRect();
      this.cam.x -= (e.clientX - lx) / this.cam.k;
      this.cam.y += (e.clientY - ly) / this.cam.k;
      lx = e.clientX;
      ly = e.clientY;
      void r;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left - c.width / (2 * this.dpr);
      const my = e.clientY - r.top - c.height / (2 * this.dpr);
      const wx = this.cam.x + mx / this.cam.k;
      const wy = this.cam.y - my / this.cam.k;
      this.cam.k = Math.min(0.06, Math.max(0.004, this.cam.k * factor));
      this.cam.x = wx - mx / this.cam.k;
      this.cam.y = wy + my / this.cam.k;
    }, { passive: false });
  }

  fit(): void {
    const box: Box = this.scn.box;
    const cw = this.canvas.clientWidth || 900;
    const ch = this.canvas.clientHeight || 700;
    const kx = cw / (box.maxX - box.minX);
    const ky = ch / (box.maxY - box.minY);
    this.cam.k = Math.min(kx, ky) * 0.96;
    this.cam.x = (box.minX + box.maxX) / 2;
    this.cam.y = (box.minY + box.maxY) / 2;
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  private toScreen(x: number, y: number): [number, number] {
    return [
      (x - this.cam.x) * this.cam.k * this.dpr + this.canvas.width / 2,
      this.canvas.height / 2 - (y - this.cam.y) * this.cam.k * this.dpr,
    ];
  }

  private toWorld(sx: number, sy: number): [number, number] {
    return [
      this.cam.x + (sx - this.canvas.width / 2) / (this.cam.k * this.dpr),
      this.cam.y - (sy - this.canvas.height / 2) / (this.cam.k * this.dpr),
    ];
  }

  private updateHover(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * this.dpr;
    const sy = (e.clientY - r.top) * this.dpr;
    const [wx, wy] = this.toWorld(sx, sy);
    let best: { d: number; text: string } | null = null;
    for (const loft of this.scn.lofts) {
      const d = Math.hypot(loft.x - wx, loft.y - wy);
      const hitR = 9000 / Math.max(0.4, this.cam.k * 40);
      if (d < hitR && (!best || d < best.d)) {
        best = {
          d,
          text: `${loft.isUser ? '★ ' : ''}${loft.name} · ${loft.owner} · ${loft.pigeonIds.length}羽`,
        };
      }
    }
    const d0 = Math.hypot(wx, wy);
    if (d0 < 12000) {
      best = { d: d0, text: `放飞点：${this.scn.config.releaseName}` };
    }
    this.hover = best ? { text: best.text, sx, sy } : null;
  }

  render(sim: Simulator | null, time: number): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0e1726';
    ctx.fillRect(0, 0, W, H);

    // 底图
    const [x0, y0] = this.toScreen(this.scn.box.minX, this.scn.box.maxY);
    const w = (this.scn.box.maxX - this.scn.box.minX) * this.cam.k * this.dpr;
    const h = (this.scn.box.maxY - this.scn.box.minY) * this.cam.k * this.dpr;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(this.base, x0, y0, w, h);
    ctx.globalAlpha = 1;

    if (this.showWind) this.drawWind(ctx, time);
    if (this.showRain) this.drawRain(ctx, time);
    this.drawTracks(ctx, sim);
    this.drawLofts(ctx);
    this.drawRelease(ctx);
    if (sim) this.drawPigeons(ctx, sim);
    this.drawScale(ctx);
    if (this.hover) this.drawHover(ctx);
  }

  private drawWind(ctx: CanvasRenderingContext2D, t: number): void {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1 * this.dpr;
    ctx.beginPath();
    for (const p of this.particles) {
      const w = this.scn.wind.windAt(p.x, p.y, t);
      const nx = p.x + w.x * 12;
      const ny = p.y + w.y * 12;
      const [sx, sy] = this.toScreen(p.x, p.y);
      const [sx2, sy2] = this.toScreen(nx, ny);
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx2, sy2);
      p.x = nx;
      p.y = ny;
      p.life++;
      if (p.life > 260 || nx < this.scn.box.minX || nx > this.scn.box.maxX || ny < this.scn.box.minY || ny > this.scn.box.maxY) {
        p.x = this.scn.box.minX + this.rng.next() * (this.scn.box.maxX - this.scn.box.minX);
        p.y = this.scn.box.minY + this.rng.next() * (this.scn.box.maxY - this.scn.box.minY);
        p.life = 0;
      }
    }
    ctx.stroke();
  }

  private drawRain(ctx: CanvasRenderingContext2D, t: number): void {
    for (const c of this.scn.weather.cells) {
      if (t < c.t0 || t > c.t1) continue;
      const life = Math.min(1, (t - c.t0) / 600, (c.t1 - t) / 600);
      const cx = c.x0 + c.vx * t;
      const cy = c.y0 + c.vy * t;
      const [sx, sy] = this.toScreen(cx, cy);
      const rx = c.rx * this.cam.k * this.dpr;
      const ry = c.ry * this.cam.k * this.dpr;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-c.angle);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
      grad.addColorStop(0, `rgba(40,70,130,${0.55 * life})`);
      grad.addColorStop(0.7, `rgba(70,100,160,${0.3 * life})`);
      grad.addColorStop(1, 'rgba(70,100,160,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(150,180,230,${0.35 * life})`;
      ctx.setLineDash([6 * this.dpr, 6 * this.dpr]);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawTracks(ctx: CanvasRenderingContext2D, sim: Simulator | null): void {
    if (!sim || !this.showTracks) return;
    const tel: Telemetry = sim.telemetry;
    ctx.lineWidth = 1.2 * this.dpr;
    let fi = 0;
    for (const track of tel.flockTracks) {
      if (!track || track.length < 2) {
        fi++;
        continue;
      }
      ctx.strokeStyle = fi % 3 === 0 ? 'rgba(255,214,120,0.55)' : 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      for (let i = 0; i < track.length; i++) {
        const [sx, sy] = this.toScreen(track[i][0], track[i][1]);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      fi++;
    }
    // 重点鸽轨迹（橙色加粗）
    for (const [, pts] of tel.watched) {
      if (pts.length < 2) continue;
      ctx.strokeStyle = 'rgba(255,120,60,0.9)';
      ctx.lineWidth = 2 * this.dpr;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [sx, sy] = this.toScreen(pts[i][0], pts[i][1]);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.lineWidth = 1.2 * this.dpr;
    }
  }

  private drawLofts(ctx: CanvasRenderingContext2D): void {
    for (const loft of this.scn.lofts) {
      const [sx, sy] = this.toScreen(loft.x, loft.y);
      const r = (loft.isUser ? 7 : 5) * this.dpr;
      ctx.fillStyle = loft.isUser ? '#ffb02e' : '#59d98e';
      ctx.strokeStyle = '#0e1726';
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (loft.isUser || this.cam.k > 0.02) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `${11 * this.dpr}px sans-serif`;
        ctx.fillText(loft.name, sx + r + 2 * this.dpr, sy + 3 * this.dpr);
      }
    }
  }

  private drawRelease(ctx: CanvasRenderingContext2D): void {
    const [sx, sy] = this.toScreen(0, 0);
    const r = 9 * this.dpr;
    ctx.fillStyle = '#ff5d73';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * this.dpr;
    ctx.beginPath();
    ctx.rect(sx - r, sy - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${12 * this.dpr}px sans-serif`;
    ctx.fillText('放飞点', sx + r + 3 * this.dpr, sy - r);
  }

  private drawPigeons(ctx: CanvasRenderingContext2D, sim: Simulator): void {
    const snap = sim.snapshot();
    // 鸽群用大圆点 + 数量
    for (const f of snap.flocks) {
      const [sx, sy] = this.toScreen(f.x, f.y);
      const r = Math.max(3, Math.min(10, 2 + Math.log10(f.count + 1) * 4)) * this.dpr;
      ctx.fillStyle = f.resting ? 'rgba(180,180,180,0.8)' : 'rgba(255,235,150,0.85)';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      if (this.cam.k > 0.012) {
        ctx.fillStyle = '#1c2433';
        ctx.font = `${10 * this.dpr}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(String(f.count), sx, sy + 3 * this.dpr);
        ctx.textAlign = 'start';
      }
    }
    // 休息中的单鸽：灰色小方块
    ctx.fillStyle = 'rgba(200,200,210,0.9)';
    for (const p of snap.pigeons) {
      if (!p.resting || p.arrived) continue;
      const [sx, sy] = this.toScreen(p.x, p.y);
      ctx.fillRect(sx - 2 * this.dpr, sy - 2 * this.dpr, 4 * this.dpr, 4 * this.dpr);
    }
  }

  private drawScale(ctx: CanvasRenderingContext2D): void {
    const targetPx = 120 * this.dpr;
    const meters = targetPx / (this.cam.k * this.dpr);
    const pow10 = 10 ** Math.floor(Math.log10(meters));
    const nice = [1, 2, 5, 10].map((m) => m * pow10).find((m) => m * this.cam.k * this.dpr >= targetPx * 0.5) ?? pow10 * 10;
    const px = nice * this.cam.k * this.dpr;
    const x = 16 * this.dpr;
    const y = this.canvas.height - 22 * this.dpr;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 4 * this.dpr);
    ctx.lineTo(x, y + 4 * this.dpr);
    ctx.moveTo(x + px, y - 4 * this.dpr);
    ctx.lineTo(x + px, y + 4 * this.dpr);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `${11 * this.dpr}px sans-serif`;
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x, y - 7 * this.dpr);
  }

  private drawHover(ctx: CanvasRenderingContext2D): void {
    if (!this.hover) return;
    const { text, sx, sy } = this.hover;
    ctx.font = `${12 * this.dpr}px sans-serif`;
    const tw = ctx.measureText(text).width + 14 * this.dpr;
    const th = 22 * this.dpr;
    const bx = Math.min(this.canvas.width - tw - 4, sx + 12 * this.dpr);
    const by = Math.max(4, sy - th - 10 * this.dpr);
    ctx.fillStyle = 'rgba(14,23,38,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.rect(bx, by, tw, th);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, bx + 7 * this.dpr, by + 15 * this.dpr);
  }
}
