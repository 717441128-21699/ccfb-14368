import type { Scenario, Pigeon } from './scenario';
import { haversine } from './geo';
import { groundVelocity, normalize, fatigueRate, maxAirspeed, REST_RECOVERY } from './physics';
import { RAIN_DETOUR, RAIN_LAND } from './weather';

export const STEP = 60; // 固定步长 60 秒
const ARRIVE_R = 250; // 到家判定半径 250m
const SPLIT_R = 35000; // 距自家鸽舍 35km 离群分道
const REST_TAKE_OFF = 1500; // 落地休息最少 25 分钟
export const CUTOFF_T = 16 * 3600; // 16 小时未归巢按失格处理（长距离赛事留足窗口）
const FLOCK_HARD_CAP = 220; // 群规模硬上限，防止合并成巨型群
const MERGE_DIST = 4500; // 合并触发距离

export interface PigeonResult {
  pigeonId: number;
  loftId: number;
  distance: number; // 官方距离：经纬度大圆（米）
  elapsed: number; // 飞行用时（模拟秒，亚秒精度）
  speed: number; // 分速 米/分
  arrived: boolean;
  rests: number; // 落地次数
  arrivalEpoch: number | null;
}

interface FlockState {
  active: boolean;
  x: number;
  y: number;
  hx: number; // 单位航向
  hy: number;
  members: number[];
  targetX: number;
  targetY: number;
  resting: boolean;
  restUntil: number;
  restX: number;
  restY: number;
  airspeed: number;
  rainSide: number; // 绕雨偏置侧（±1），进入雨区时锁定，防止左右横跳
}

interface PigeonState {
  x: number;
  y: number;
  flock: number; // -1 表示单飞
  resting: boolean;
  restUntil: number;
  fatigue: number;
  rests: number;
  phase: number; // 个体航向噪声相位
  arrived: boolean;
}

export interface Telemetry {
  /** 群航迹点（每 4 分钟采样） */
  flockTracks: number[][][];
  /** 重点鸽子逐点轨迹（x,y,t） */
  watched: Map<number, [number, number, number][]>;
}

export class Simulator {
  readonly scn: Scenario;
  readonly t: number[] = [0];
  private readonly pigeons: Pigeon[];
  private readonly ps: PigeonState[];
  private readonly flocks: FlockState[] = [];
  private results: PigeonResult[] = [];
  private readonly homeX: Float64Array;
  private readonly homeY: Float64Array;
  private readonly officialDist: Float64Array;
  private readonly tracks: number[][][] = [];
  private readonly watched: Map<number, [number, number, number][]>;
  private stepCount = 0;

  constructor(scn: Scenario, watchedIds: number[] = []) {
    this.scn = scn;
    this.pigeons = scn.pigeons;
    const n = this.pigeons.length;
    this.watched = new Map(watchedIds.map((id) => [id, [[0, 0, 0]]]));
    this.homeX = new Float64Array(n);
    this.homeY = new Float64Array(n);
    this.officialDist = new Float64Array(n);
    this.ps = new Array(n);

    const release = scn.config.release;
    for (let i = 0; i < n; i++) {
      const p = this.pigeons[i];
      const loft = scn.lofts[p.loftId];
      this.homeX[i] = loft.x;
      this.homeY[i] = loft.y;
      this.officialDist[i] = haversine(release, { lat: loft.lat, lon: loft.lon });
      this.ps[i] = {
        x: 0,
        y: 0,
        flock: -1,
        resting: false,
        restUntil: 0,
        fatigue: 0,
        rests: 0,
        phase: (i * 2.399963) % (Math.PI * 2),
        arrived: false,
      };
    }
    this.formInitialFlocks();
  }

  /** 按巡航速度分层结群：同速段鸽子自然编队 */
  private formInitialFlocks(): void {
    const order = this.pigeons.map((_, i) => i).sort((a, b) => this.pigeons[a].cruise - this.pigeons[b].cruise);
    let cursor = 0;
    let fid = 0;
    while (cursor < order.length) {
      const size = Math.min(order.length - cursor, 90 + ((fid * 37) % 60));
      const members = order.slice(cursor, cursor + size);
      cursor += size;
      let tx = 0;
      let ty = 0;
      let speed = 0;
      for (const id of members) {
        tx += this.homeX[id];
        ty += this.homeY[id];
        speed += this.pigeons[id].cruise;
        this.ps[id].flock = fid;
      }
      const h = normalize(tx / members.length, ty / members.length);
      this.flocks.push({
        active: true,
        x: 0,
        y: 0,
        hx: h.x,
        hy: h.y,
        members,
        targetX: tx / members.length,
        targetY: ty / members.length,
        resting: false,
        restUntil: 0,
        restX: 0,
        restY: 0,
        airspeed: speed / members.length,
        rainSide: 0,
      });
      fid++;
    }
  }

  /** 推进固定步长，返回本步到钟的鸽子 id */
  step(): number[] {
    const arrivals: number[] = [];
    const t = this.stepCount * STEP;
    const tNext = t + STEP;
    this.stepCount++;
    // 本步刚分道的鸽子位置已更新到 tNext，跳过当拍单飞推进，避免同一时间窗走两步
    const splitThisStep = new Set<number>();

    for (let f = 0; f < this.flocks.length; f++) {
      const fl = this.flocks[f];
      if (!fl.active || fl.members.length === 0) continue;

      if (fl.resting) {
        if (tNext < fl.restUntil) {
          for (const id of fl.members) this.recoverPigeon(id);
          continue;
        }
        fl.resting = false;
        fl.x = fl.restX;
        fl.y = fl.restY;
      }

      // 群目标 = 在飞成员鸽舍的平均位置
      let tx = 0;
      let ty = 0;
      let flying = 0;
      for (const id of fl.members) {
        if (!this.ps[id].arrived) {
          tx += this.homeX[id];
          ty += this.homeY[id];
          flying++;
        }
      }
      if (flying === 0) {
        fl.active = false;
        continue;
      }
      fl.targetX = tx / flying;
      fl.targetY = ty / flying;
      // 群已抵达鸽舍密集区（平均目标附近）：解散，成员各自分道归巢
      if (Math.hypot(fl.targetX - fl.x, fl.targetY - fl.y) < SPLIT_R * 0.7) {
        for (const id of fl.members) {
          const st = this.ps[id];
          if (st.arrived) continue;
          st.flock = -1;
          splitThisStep.add(id);
        }
        fl.members = [];
        fl.active = false;
        continue;
      }
      this.steerFlock(fl, t);

      const w = this.scn.wind.windAt(fl.x, fl.y, t);
      const gv = groundVelocity(fl.hx, fl.hy, fl.airspeed, w);
      fl.x += gv.x * STEP;
      fl.y += gv.y * STEP;

      // 群级雨强：超过绕飞阈值时整群转向（steerFlock 已处理），
      // 落地与否按每羽自身位置与耐受度逐羽判断
      const remaining: number[] = [];
      for (const id of fl.members) {
        const st = this.ps[id];
        const p = this.pigeons[id];
        st.phase += STEP * 0.0011;
        const jitter = (0.18 / p.nav) * Math.sin(st.phase + id);
        const jx = -fl.hy * jitter;
        const jy = fl.hx * jitter;
        const prevX = st.x;
        const prevY = st.y;
        st.x = fl.x + jx * 900;
        st.y = fl.y + jy * 900;

        // 逐羽落雨检查（自身位置）
        const rainHere = this.scn.weather.rainAt(st.x, st.y, tNext);
        if (rainHere > RAIN_LAND && p.rainTol < rainHere) {
          st.resting = true;
          st.restUntil = tNext + REST_TAKE_OFF;
          st.flock = -1;
          st.rests++;
          continue;
        }

        const kind = this.scn.terrain.kindAt(st.x, st.y);
        const water = this.scn.terrain.isWaterAt(st.x, st.y) ? 1 : 0;
        st.fatigue += fatigueRate(st.fatigue, p.stamina, kind, water) * STEP;

        const hdx = this.homeX[id] - st.x;
        const hdy = this.homeY[id] - st.y;
        const dHome = Math.hypot(hdx, hdy);
        if (dHome <= ARRIVE_R) {
          // 群移动后恰好到家：按上一位置到当前位置线性插值求到钟
          const dPrev = Math.hypot(this.homeX[id] - prevX, this.homeY[id] - prevY);
          const frac = (dPrev - ARRIVE_R) / Math.max(1e-9, dPrev - dHome);
          this.finish(id, t + STEP * Math.min(1, Math.max(0, frac)), arrivals);
          continue;
        }
        if (dHome < SPLIT_R) {
          // 分道：彻底离群，下一拍起直奔自家鸽舍
          st.flock = -1;
          splitThisStep.add(id);
          continue;
        }
        remaining.push(id);
      }
      fl.members = remaining;
      if (fl.members.length < 3) {
        for (const id of fl.members) {
          this.ps[id].flock = -1;
          splitThisStep.add(id);
        }
        fl.members = [];
        fl.active = false;
      }
    }

    // 单飞鸽子（分道个体、雨后绕飞个体、休息后复飞个体）
    for (let id = 0; id < this.ps.length; id++) {
      const st = this.ps[id];
      if (st.arrived || st.flock !== -1 || splitThisStep.has(id)) continue;
      if (st.resting) {
        if (tNext < st.restUntil) {
          this.recoverPigeon(id);
          continue;
        }
        st.resting = false;
      }
      this.advanceSolo(id, st.x, st.y, t, tNext, arrivals);
    }

    // 群合并（每 3 步一次，空间哈希）
    if (this.stepCount % 3 === 0) this.mergeFlocks();

    this.t.push(tNext);
    if (this.stepCount % 4 === 0) this.recordTracks(tNext);
    for (const [id, arr] of this.watched) {
      const st = this.ps[id];
      arr.push([st.x, st.y, tNext]);
    }
    return arrivals;
  }

  private recoverPigeon(id: number): void {
    const st = this.ps[id];
    st.fatigue = Math.max(0, st.fatigue - REST_RECOVERY * STEP);
  }

  /** 群航向：归巢 + 绕雨 + 山地规避 */
  private steerFlock(fl: FlockState, t: number): void {
    const base = normalize(fl.targetX - fl.x, fl.targetY - fl.y);
    let hx = base.x;
    let hy = base.y;

    const rain = this.scn.weather.rainAt(fl.x, fl.y, t);
    if (rain > RAIN_DETOUR) {
      const px = -base.y;
      const py = base.x;
      const probe = 9000;
      const rL = this.scn.weather.rainAt(fl.x + px * probe, fl.y + py * probe, t);
      const rR = this.scn.weather.rainAt(fl.x - px * probe, fl.y - py * probe, t);
      // 首次进入雨区时锁定偏置侧，两侧接近则沿用，避免横跳
      if (fl.rainSide === 0) fl.rainSide = rL <= rR ? 1 : -1;
      const side = fl.rainSide;
      const w = Math.min(1, (rain - RAIN_DETOUR) / (RAIN_LAND - RAIN_DETOUR));
      const n = normalize(base.x + px * side * w * 1.4, base.y + py * side * w * 1.4);
      hx = n.x;
      hy = n.y;
    } else {
      fl.rainSide = 0;
    }
    // 山地规避：探两侧高程，走低的一侧
    const e0 = this.scn.terrain.elevationAt(fl.x + hx * 12000, fl.y + hy * 12000);
    if (e0 > 550) {
      const px = -hy;
      const py = hx;
      const eL = this.scn.terrain.elevationAt(fl.x + px * 12000, fl.y + py * 12000);
      const eR = this.scn.terrain.elevationAt(fl.x - px * 12000, fl.y - py * 12000);
      const side = eL <= eR ? 1 : -1;
      const w = Math.min(0.6, (e0 - 550) / 900);
      const n = normalize(hx + px * side * w, hy + py * side * w);
      hx = n.x;
      hy = n.y;
    }
    // 平滑转向，避免锯齿航迹
    const sm = normalize(fl.hx * 0.7 + hx * 0.3, fl.hy * 0.7 + hy * 0.3);
    fl.hx = sm.x;
    fl.hy = sm.y;
  }

  /**
   * 单飞推进（整步从当前位置出发），到钟则登记成绩。
   */
  private advanceSolo(
    id: number,
    fromX: number,
    fromY: number,
    t0: number,
    t1: number,
    arrivals: number[],
  ): void {
    const st = this.ps[id];
    const p = this.pigeons[id];
    const h = normalize(this.homeX[id] - fromX, this.homeY[id] - fromY);
    // 导航偏差：能力弱的鸽子偏航更大
    const navErr = (1.25 - p.nav) * 0.22;
    const ph = st.phase + t0 * 0.0009;
    const ca = Math.cos(navErr * Math.sin(ph));
    const sa = Math.sin(navErr * Math.sin(ph));
    const hx = h.x * ca - h.y * sa;
    const hy = h.x * sa + h.y * ca;

    const rain = this.scn.weather.rainAt(fromX, fromY, t0);
    if (rain > RAIN_LAND && p.rainTol < rain && !st.resting) {
      st.resting = true;
      st.restUntil = t1 + REST_TAKE_OFF;
      st.rests++;
      st.x = fromX;
      st.y = fromY;
      return;
    }

    // 中雨或可耐受的暴雨：按固定侧偏绕飞（侧别由鸽 id 决定，保证行为稳定）
    let fx = hx;
    let fy = hy;
    if (rain > RAIN_DETOUR) {
      const side = id % 2 === 0 ? 1 : -1;
      const wgt = Math.min(1, (rain - RAIN_DETOUR) / (RAIN_LAND - RAIN_DETOUR));
      const n = normalize(hx + -hy * side * wgt * 1.2, hy + hx * side * wgt * 1.2);
      fx = n.x;
      fy = n.y;
    }

    const air = maxAirspeed(p.cruise, st.fatigue);
    const w = this.scn.wind.windAt(fromX, fromY, t0);
    const gv = groundVelocity(fx, fy, air, w);
    const nx = fromX + gv.x * STEP;
    const ny = fromY + gv.y * STEP;
    st.x = nx;
    st.y = ny;
    const kind = this.scn.terrain.kindAt(nx, ny);
    const waterP = this.scn.terrain.isWaterAt(nx, ny) ? 1 : 0;
    st.fatigue += fatigueRate(st.fatigue, p.stamina, kind, waterP) * STEP;

    // 到钟判定：线段是否进入鸽舍判定圆，线性插值求亚秒到钟时刻
    const dEnd = Math.hypot(this.homeX[id] - nx, this.homeY[id] - ny);
    if (dEnd <= ARRIVE_R) {
      const dStart = Math.hypot(this.homeX[id] - fromX, this.homeY[id] - fromY);
      const frac = (dStart - ARRIVE_R) / Math.max(1e-9, dStart - dEnd);
      const arriveT = t0 + STEP * Math.min(1, Math.max(0, frac));
      this.finish(id, arriveT, arrivals);
    }
  }

  private finish(id: number, simSeconds: number, arrivals: number[]): void {
    const st = this.ps[id];
    if (st.arrived) return;
    st.arrived = true;
    st.flock = -2;
    const elapsed = simSeconds;
    this.results.push({
      pigeonId: id,
      loftId: this.pigeons[id].loftId,
      distance: this.officialDist[id],
      elapsed,
      speed: (this.officialDist[id] / elapsed) * 60,
      arrived: true,
      rests: st.rests,
      arrivalEpoch: this.scn.config.startEpoch + elapsed,
    });
    arrivals.push(id);
  }

  private mergeFlocks(): void {
    const cell = 6000;
    const grid = new Map<number, number[]>();
    const active: number[] = [];
    for (let f = 0; f < this.flocks.length; f++) {
      const fl = this.flocks[f];
      if (!fl.active || fl.resting || fl.members.length === 0) continue;
      active.push(f);
      const key = (Math.floor(fl.x / cell) * 73856093) ^ (Math.floor(fl.y / cell) * 19349663);
      const bucket = grid.get(key);
      if (bucket) bucket.push(f);
      else grid.set(key, [f]);
    }
    for (const f of active) {
      const fl = this.flocks[f];
      if (!fl.active) continue;
      const kx = Math.floor(fl.x / cell);
      const ky = Math.floor(fl.y / cell);
      for (let gx = kx - 1; gx <= kx + 1; gx++) {
        for (let gy = ky - 1; gy <= ky + 1; gy++) {
          const key = (gx * 73856093) ^ (gy * 19349663);
          const bucket = grid.get(key);
          if (!bucket) continue;
          for (const g of bucket) {
            if (g <= f) continue;
            const gl = this.flocks[g];
            if (!gl.active) continue;
            if (Math.abs(gl.airspeed - fl.airspeed) > 1.2) continue;
            if (Math.hypot(gl.x - fl.x, gl.y - fl.y) > MERGE_DIST) continue;
            if (fl.members.length + gl.members.length > FLOCK_HARD_CAP) continue;
            // 合并 g 进 f
            for (const id of gl.members) {
              this.ps[id].flock = f;
              fl.members.push(id);
            }
            fl.airspeed = (fl.airspeed * (fl.members.length - gl.members.length) + gl.airspeed * gl.members.length) / fl.members.length;
            gl.members = [];
            gl.active = false;
          }
        }
      }
    }
  }

  private recordTracks(t: number): void {
    for (let f = 0; f < this.flocks.length; f++) {
      const fl = this.flocks[f];
      if (!fl.active) continue;
      if (!this.tracks[f]) this.tracks[f] = [];
      this.tracks[f].push([fl.x, fl.y, t]);
    }
  }

  /** 跑完整场比赛 */
  run(): PigeonResult[] {
    while (this.t[this.t.length - 1] < CUTOFF_T) {
      this.step();
      if (this.results.length === this.pigeons.length) break;
    }
    // 失格
    for (let id = 0; id < this.ps.length; id++) {
      if (!this.ps[id].arrived) {
        this.results.push({
          pigeonId: id,
          loftId: this.pigeons[id].loftId,
          distance: this.officialDist[id],
          elapsed: CUTOFF_T,
          speed: 0,
          arrived: false,
          rests: this.ps[id].rests,
          arrivalEpoch: null,
        });
      }
    }
    this.results.sort((a, b) => (b.arrived ? 1 : 0) - (a.arrived ? 1 : 0) || a.elapsed - b.elapsed);
    return this.results;
  }

  get resultsList(): PigeonResult[] {
    return this.results;
  }

  get telemetry(): Telemetry {
    return { flockTracks: this.tracks, watched: this.watched };
  }

  /** 渲染/回放用快照 */
  snapshot(): {
    time: number;
    flocks: { x: number; y: number; count: number; resting: boolean }[];
    pigeons: { x: number; y: number; flock: number; resting: boolean; arrived: boolean }[];
  } {
    return {
      time: this.t[this.t.length - 1],
      flocks: this.flocks
        .filter((f) => f.active)
        .map((f) => ({ x: f.x, y: f.y, count: f.members.length, resting: f.resting })),
      pigeons: this.ps.map((s) => ({ x: s.x, y: s.y, flock: s.flock, resting: s.resting, arrived: s.arrived })),
    };
  }
}
