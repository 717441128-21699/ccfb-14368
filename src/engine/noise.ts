/**
 * 二维值噪声 + 分形布朗运动（FBM），纯函数、无随机状态，
 * 同一种子网格在任何平台逐位一致。用于地形高程、粗糙度与降雨底场。
 */

function hash2(ix: number, iy: number, seed: number): number {
  let h = seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 周期可平铺的值噪声，返回 [0,1)；period 为 2 的幂时网格无缝拼接 */
export function valueNoise(x: number, y: number, seed: number, period = 256): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const mod = (n: number) => ((n % period) + period) % period;
  const v00 = hash2(mod(x0), mod(y0), seed);
  const v10 = hash2(mod(x1), mod(y0), seed);
  const v01 = hash2(mod(x0), mod(y1), seed);
  const v11 = hash2(mod(x1), mod(y1), seed);
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

export interface FbmOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  period?: number;
}

/** 分形布朗运动，输出约 [0,1] */
export function fbm(x: number, y: number, seed: number, opts: FbmOptions = {}): number {
  const octaves = opts.octaves ?? 4;
  const lacunarity = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  const period = opts.period ?? 256;
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013, period);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
