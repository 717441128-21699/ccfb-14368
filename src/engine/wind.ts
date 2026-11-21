/**
 * 风场：盛行风 + 大尺度阵风 + 随时间移动的逆风带。
 * 全部为解析函数，任意 (x, y, t) 可 O(条数) 求值，无需栅格，
 * 同一赛事种子下逐位可复现。
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface HeadwindBand {
  /** 条带法向（移动方向）单位向量 */
  axisX: number;
  axisY: number;
  /** t=0 时条带中心在轴上的投影坐标（米） */
  center0: number;
  /** 条带平移速度 m/s */
  speed: number;
  /** 高斯宽度 m */
  width: number;
  /** 条带内的风向量 m/s */
  windX: number;
  windY: number;
}

export interface WindConfig {
  prevailing: Vec2;
  bands: HeadwindBand[];
  /** 阵风振幅 m/s */
  gustAmp: number;
  /** 阵风空间波长 m / 时间周期 s */
  gustL: number;
  gustT: number;
}

export class WindField {
  readonly cfg: WindConfig;

  constructor(cfg: WindConfig) {
    this.cfg = cfg;
  }

  /** 返回位置 (x,y) 在模拟秒 t 的风向量（m/s，北东坐标系） */
  windAt(x: number, y: number, t: number): Vec2 {
    const c = this.cfg;
    let vx = c.prevailing.x;
    let vy = c.prevailing.y;

    // 大尺度缓慢阵风
    const phase = (2 * Math.PI * t) / c.gustT;
    vx += c.gustAmp * Math.sin(y / c.gustL + phase);
    vy += c.gustAmp * Math.cos(x / c.gustL - phase * 0.7);

    // 移动逆风带（高斯剖面）
    for (let i = 0; i < c.bands.length; i++) {
      const b = c.bands[i];
      const d = x * b.axisX + y * b.axisY - (b.center0 + b.speed * t);
      const inf = Math.exp(-((d / b.width) ** 2));
      vx += b.windX * inf;
      vy += b.windY * inf;
    }
    return { x: vx, y: vy };
  }
}
