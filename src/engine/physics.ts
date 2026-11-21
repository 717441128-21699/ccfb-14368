import type { Vec2 } from './wind';

/**
 * 风三角：给定空速大小、期望航向与风向量，求地速向量。
 * 鸽子按期望航向保持空速飞行，风叠加产生偏移（真实航迹偏移的来源）。
 * 若风速超过空速导致无法前进，返回沿期望航向的最大努力地速。
 */
export function groundVelocity(
  headingX: number,
  headingY: number,
  airspeed: number,
  wind: Vec2,
): Vec2 {
  const gx = headingX * airspeed + wind.x;
  const gy = headingY * airspeed + wind.y;
  const forward = gx * headingX + gy * headingY;
  if (forward >= 0) return { x: gx, y: gy };
  // 顶不住风：原地附近盘旋，保留极小漂移
  return { x: wind.x * 0.25, y: wind.y * 0.25 };
}

/** 单位化 */
export function normalize(x: number, y: number): Vec2 {
  const d = Math.hypot(x, y);
  if (d < 1e-9) return { x: 1, y: 0 };
  return { x: x / d, y: y / d };
}

/**
 * 每秒疲劳增量。
 * 基准与耐力系数成反比；高原/山地额外消耗爬升体力。
 * 疲劳达到 1 后空速按 maxAirspeed 衰减，模拟体力不支。
 */
export function fatigueRate(
  fatigue: number,
  stamina: number,
  terrainKind: number,
  waterPenalty: number,
): number {
  const base = 1.15e-5 / stamina; // 约 8 小时量级累积到 1
  const terrainFactor = 1 + terrainKind * 0.12;
  const effort = 1 + Math.max(0, fatigue - 0.55) * 0.8;
  return base * terrainFactor * (1 + waterPenalty * 0.15) * effort;
}

/** 疲劳下的可用空速（平缓衰减，最多下降 18%） */
export function maxAirspeed(cruise: number, fatigue: number): number {
  if (fatigue <= 0.6) return cruise;
  const drop = Math.min(0.18, (fatigue - 0.6) * 0.45);
  return cruise * (1 - drop);
}

/** 休息时每秒体力恢复 */
export const REST_RECOVERY = 4.5e-5;
