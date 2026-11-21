import { fbm } from './noise';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type TerrainKind = 0 | 1 | 2 | 3; // 平原 / 丘陵 / 山地 / 高山

export const TERRAIN_NAMES = ['平原', '丘陵', '山地', '高山'] as const;

/**
 * 程序化地形：FBM 高程栅格（双线性采样）+ 一条曲流河与一处湖泊。
 * 栅格按米制平面坐标生成，渲染层可直接整块绘制，模拟层按点查询。
 */
export class Terrain {
  readonly box: Box;
  readonly cell: number;
  readonly nx: number;
  readonly ny: number;
  /** 高程（米），行优先，长度 nx*ny */
  readonly height: Float32Array;
  private readonly seed: number;
  private readonly riverBase: number;
  private readonly riverAmp: number;
  private readonly riverWidth: number;
  private readonly lake: { cx: number; cy: number; rx: number; ry: number };

  constructor(seed: number, box: Box, cell = 4000) {
    this.seed = seed;
    this.box = box;
    this.cell = cell;
    this.nx = Math.ceil((box.maxX - box.minX) / cell) + 1;
    this.ny = Math.ceil((box.maxY - box.minY) / cell) + 1;
    this.height = new Float32Array(this.nx * this.ny);

    // 河流参数（沿 x 方向蜿蜒）
    const rng = mulberryLike(seed ^ 0x9e3779b9);
    this.riverBase = box.minY + (0.35 + rng() * 0.3) * (box.maxY - box.minY);
    this.riverAmp = 18000 + rng() * 26000;
    this.riverWidth = 3500 + rng() * 2500;
    this.lake = {
      cx: box.minX + (0.2 + rng() * 0.6) * (box.maxX - box.minX),
      cy: box.minY + (0.15 + rng() * 0.2) * (box.maxY - box.minY),
      rx: 22000 + rng() * 18000,
      ry: 12000 + rng() * 10000,
    };

    const scale = 1 / 110000; // 地形特征波长 ~ 百公里
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = box.minX + i * cell;
        const y = box.minY + j * cell;
        const n = fbm(x * scale, y * scale, seed, { octaves: 5, gain: 0.55 });
        // 指数拉伸：多平原、少高山
        const e = Math.pow(n, 1.7) * 1500;
        this.height[j * this.nx + i] = e;
      }
    }
  }

  /** 双线性插值高程，单位米 */
  elevationAt(x: number, y: number): number {
    const fx = (x - this.box.minX) / this.cell;
    const fy = (y - this.box.minY) / this.cell;
    const i0 = Math.max(0, Math.min(this.nx - 2, Math.floor(fx)));
    const j0 = Math.max(0, Math.min(this.ny - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - i0));
    const ty = Math.max(0, Math.min(1, fy - j0));
    const h00 = this.height[j0 * this.nx + i0];
    const h10 = this.height[j0 * this.nx + i0 + 1];
    const h01 = this.height[(j0 + 1) * this.nx + i0];
    const h11 = this.height[(j0 + 1) * this.nx + i0 + 1];
    return (
      (h00 * (1 - tx) + h10 * tx) * (1 - ty) +
      (h01 * (1 - tx) + h11 * tx) * ty
    );
  }

  kindAt(x: number, y: number): TerrainKind {
    const e = this.elevationAt(x, y);
    if (e < 60) return 0;
    if (e < 240) return 1;
    if (e < 650) return 2;
    return 3;
  }

  /** 水面掩膜：曲流河 + 椭圆湖 */
  isWaterAt(x: number, y: number): boolean {
    const riverY =
      this.riverBase +
      this.riverAmp * Math.sin(x / 95000 + this.seed * 0.001) +
      this.riverAmp * 0.35 * Math.sin(x / 37000 + this.seed * 0.003);
    if (Math.abs(y - riverY) < this.riverWidth) return true;
    const lx = (x - this.lake.cx) / this.lake.rx;
    const ly = (y - this.lake.cy) / this.lake.ry;
    return lx * lx + ly * ly < 1;
  }
}

/** 与 rng.ts 同源思路的轻量哈希随机，仅用于构造期参数 */
function mulberryLike(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
