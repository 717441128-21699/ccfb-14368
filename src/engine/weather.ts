/**
 * 天气：随时间移动的椭圆降雨云团。
 * 每团有生消窗口、平移速度与高斯雨强剖面；rainAt 返回 0..1 综合雨强。
 * 鸽子遇雨的落地/绕飞决策在 simulator 中按个体耐受度处理。
 */
export interface RainCell {
  x0: number;
  y0: number;
  vx: number; // m/s
  vy: number;
  rx: number; // 椭圆半轴 m
  ry: number;
  angle: number; // 椭圆旋转角（弧度）
  strength: number; // 峰值雨强 0..1
  t0: number; // 生成时间（模拟秒）
  t1: number; // 消散时间
}

/** 雨强超过该值视为中雨，鸽子开始绕飞 */
export const RAIN_DETOUR = 0.25;
/** 雨强超过该值视为暴雨，耐受不足的鸽子落地 */
export const RAIN_LAND = 0.6;

export class Weather {
  readonly cells: RainCell[];

  constructor(cells: RainCell[]) {
    this.cells = cells;
  }

  /** t 时刻 (x,y) 的综合雨强，截断到 [0,1] */
  rainAt(x: number, y: number, t: number): number {
    let s = 0;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (t < c.t0 || t > c.t1) continue;
      const cx = c.x0 + c.vx * t;
      const cy = c.y0 + c.vy * t;
      // 生消斜坡，避免雨强跳变
      const life = Math.min(
        1,
        (t - c.t0) / 600,
        (c.t1 - t) / 600,
      );
      const dx = x - cx;
      const dy = y - cy;
      const ca = Math.cos(c.angle);
      const sa = Math.sin(c.angle);
      const ex = (dx * ca + dy * sa) / c.rx;
      const ey = (-dx * sa + dy * ca) / c.ry;
      s += c.strength * life * Math.exp(-(ex * ex + ey * ey));
    }
    return s > 1 ? 1 : s;
  }
}
