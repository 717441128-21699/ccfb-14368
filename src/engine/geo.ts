/**
 * 地理计算：WGS-84 大圆距离（Haversine）与本地等距投影。
 * 模拟在本地米制平面上进行，成绩距离始终回经纬度用大圆距离核算。
 */
export const EARTH_R = 6371008.8; // 地球平均半径（米）

const DEG = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

/** 两点间大圆距离，单位米，Haversine 公式 */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 以原点为中心的局部等距投影（小域线性方位等距投影）。
 * x 向东（米），y 向北（米）。500km 跨度内失真远小于 0.1%，
 * 官方成绩距离不使用本投影，直接用 haversine 核算。
 */
export class LocalProjection {
  private readonly originLat: number;
  private readonly originLon: number;
  private readonly kx: number;
  private readonly ky: number;

  constructor(origin: LatLon) {
    this.originLat = origin.lat;
    this.originLon = origin.lon;
    this.kx = EARTH_R * Math.cos(origin.lat * DEG) * DEG;
    this.ky = EARTH_R * DEG;
  }

  project(p: LatLon): { x: number; y: number } {
    return {
      x: (p.lon - this.originLon) * this.kx,
      y: (p.lat - this.originLat) * this.ky,
    };
  }

  unproject(x: number, y: number): LatLon {
    return {
      lat: this.originLat + y / this.ky,
      lon: this.originLon + x / this.kx,
    };
  }
}
