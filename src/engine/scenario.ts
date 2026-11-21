import { Random, hashSeed } from './rng';
import { LocalProjection, type LatLon } from './geo';
import { Terrain, type Box } from './terrain';
import { WindField, type WindConfig } from './wind';
import { Weather, type RainCell } from './weather';

export interface Loft {
  id: number;
  name: string;
  owner: string;
  lat: number;
  lon: number;
  x: number;
  y: number;
  pigeonIds: number[];
  isUser?: boolean;
}

export interface Pigeon {
  id: number;
  ring: string;
  name: string;
  loftId: number;
  /** 巡航空速 m/s */
  cruise: number;
  /** 耐力：疲劳累积系数（越小越好） */
  stamina: number;
  /** 导航能力 0.8~1.2，越高绕飞/偏航越小 */
  nav: number;
  /** 降雨耐受 0..1，低于阈值遇暴雨落地 */
  rainTol: number;
}

export interface RaceConfig {
  id: string;
  name: string;
  releaseName: string;
  release: LatLon;
  /** 标称赛程 km */
  nominalKm: number;
  /** 开笼时刻（epoch 秒，固定排期，不使用系统时钟） */
  startEpoch: number;
  pigeonCount: number;
  entryFee: number;
  prize: string;
}

export interface UserRegistration {
  loftName: string;
  owner: string;
  pigeonCount: number;
}

export interface Scenario {
  seed: number;
  config: RaceConfig;
  projection: LocalProjection;
  box: Box;
  terrain: Terrain;
  wind: WindField;
  weather: Weather;
  lofts: Loft[];
  pigeons: Pigeon[];
}

const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡'];
const LOFT_WORDS = ['翔云', '鲲鹏', '疾风', '天翼', '凌云', '远帆', '鸿雁', '锦羽', '长风', '星速', '金翼', '北归', '晴空', '鹤鸣', '雷驰'];
const PIGEON_NAMES = ['闪电', '追风', '凌云', '破晓', '疾风', '孤鹰', '穿云', '惊鸿', '绝尘', '星河', '铁翼', '归心', '长风', '逐月', '青冥'];

/** 固定排期的赛事目录（开笼时间均为当地 07:00） */
export const RACE_CATALOG: RaceConfig[] = [
  {
    id: 'r500-autumn',
    name: '秋季五百公里总决赛',
    releaseName: '河南濮阳放飞基地',
    release: { lat: 35.7628, lon: 115.0293 },
    nominalKm: 500,
    startEpoch: Date.UTC(2026, 9, 18, 23, 0, 0) / 1000, // 北京时间 10-19 07:00
    pigeonCount: 5000,
    entryFee: 100,
    prize: '冠军 50,000 元 / 鸽王奖杯',
  },
  {
    id: 'r300-spring',
    name: '春季三百公里热身赛',
    releaseName: '河北衡水放飞点',
    release: { lat: 37.7389, lon: 115.6759 },
    nominalKm: 300,
    startEpoch: Date.UTC(2026, 3, 12, 23, 0, 0) / 1000, // 北京时间 04-13 07:00
    pigeonCount: 3000,
    entryFee: 50,
    prize: '冠军 20,000 元',
  },
  {
    id: 'r700-challenge',
    name: '七百公里挑战赛',
    releaseName: '湖北武汉放飞中心',
    release: { lat: 30.5928, lon: 114.3055 },
    nominalKm: 700,
    startEpoch: Date.UTC(2026, 10, 8, 22, 30, 0) / 1000, // 北京时间 11-09 06:30
    pigeonCount: 2000,
    entryFee: 200,
    prize: '冠军 100,000 元 / 挑战赛徽章',
  },
  {
    id: 'r400-rain',
    name: '梅雨四百公里逆境赛',
    releaseName: '安徽合肥放飞点',
    release: { lat: 31.8206, lon: 117.2272 },
    nominalKm: 400,
    startEpoch: Date.UTC(2026, 5, 22, 23, 0, 0) / 1000, // 北京时间 06-23 07:00
    pigeonCount: 2400,
    entryFee: 80,
    prize: '冠军 30,000 元 / 逆风鸽王',
  },
];

export function buildScenario(config: RaceConfig, registrations: UserRegistration[], seedInput?: number): Scenario {
  const seed = seedInput ?? hashSeed(config.id);
  const rng = new Random(seed);
  const projection = new LocalProjection(config.release);

  // 俱乐部总会区：沿正北方向 nominalKm 处，鸽舍在其周围散布。
  // 标称赛程为最近鸽舍距离，整体向远端偏移，保证实际距离围绕标称值分布。
  const homeBearing = (-90 + rng.range(-12, 12)) * (Math.PI / 180); // 近正北
  const clubDist = config.nominalKm * 1000 + 55000 + rng.range(-10000, 15000);
  const clubX = Math.cos(homeBearing) * clubDist;
  const clubY = Math.sin(homeBearing) * clubDist;

  interface LoftSeed { name: string; owner: string; x: number; y: number; isUser: boolean }
  const loftSeeds: LoftSeed[] = [];
  const loftCount = Math.max(12, Math.round(config.pigeonCount / 210));
  for (let i = 0; i < loftCount; i++) {
    // 三个分鸽会簇 + 全域散点
    const cluster = i % 3;
    const ang = rng.range(0, Math.PI * 2);
    const rad = 12000 + rng.next() * 38000;
    const cx = clubX + Math.cos(cluster * 2.1) * 45000;
    const cy = clubY + Math.sin(cluster * 2.1) * 45000;
    loftSeeds.push({
      name: `${rng.pick(LOFT_WORDS)}鸽舍`,
      owner: rng.pick(SURNAMES) + (rng.next() < 0.5 ? '师傅' : '鸽友'),
      x: cx + Math.cos(ang) * rad,
      y: cy + Math.sin(ang) * rad,
      isUser: false,
    });
  }
  for (const reg of registrations) {
    const ang = rng.range(0, Math.PI * 2);
    const rad = rng.range(4000, 25000);
    loftSeeds.push({
      name: reg.loftName,
      owner: reg.owner,
      x: clubX + Math.cos(ang) * rad,
      y: clubY + Math.sin(ang) * rad,
      isUser: true,
    });
  }

  const lofts: Loft[] = [];
  const pigeons: Pigeon[] = [];
  let pid = 0;
  loftSeeds.forEach((ls, li) => {
    const ll = projection.unproject(ls.x, ls.y);
    const loft: Loft = {
      id: li,
      name: ls.isUser ? ls.name : `${ls.name}${li + 1}号`,
      owner: ls.owner,
      lat: ll.lat,
      lon: ll.lon,
      x: ls.x,
      y: ls.y,
      pigeonIds: [],
      isUser: ls.isUser,
    };
    const count = ls.isUser
      ? (registrations.find((r) => r.loftName === ls.name)?.pigeonCount ?? 6)
      : Math.max(60, Math.round(config.pigeonCount / loftCount + rng.gaussian() * 25));
    for (let k = 0; k < count; k++) {
      const cruise = clamp(22 + rng.gaussian() * 1.9, 17, 27.5);
      const stamina = clamp(1 + rng.gaussian() * 0.16, 0.62, 1.45);
      const nav = clamp(1 + rng.gaussian() * 0.09, 0.78, 1.22);
      const rainTol = clamp(0.5 + rng.gaussian() * 0.22, 0.05, 0.98);
      pigeons.push({
        id: pid,
        ring: `2026-${String(100000 + pid)}`,
        name: `${rng.pick(PIGEON_NAMES)}${rng.int(1, 99)}号`,
        loftId: li,
        cruise,
        stamina,
        nav,
        rainTol,
      });
      loft.pigeonIds.push(pid);
      pid++;
    }
    lofts.push(loft);
  });

  const maxR = Math.max(...lofts.map((l) => Math.hypot(l.x, l.y)));
  const box: Box = {
    minX: -70000,
    minY: -70000,
    maxX: maxR + 70000,
    maxY: maxR + 70000,
  };
  const terrain = new Terrain(seed ^ 0x1234abcd, box, 4000);

  // 风：沿归巢轴的盛行风（随机顺/逆风倾向）+ 两条移动逆风带
  const homeAngle = Math.atan2(clubY, clubX);
  const tail = rng.range(-3.5, 3.0); // 负=逆风
  const prevailing = {
    x: Math.cos(homeAngle) * tail + rng.range(-1.2, 1.2),
    y: Math.sin(homeAngle) * tail + rng.range(-1.2, 1.2),
  };
  const bands = [0, 1].map((i) => {
    const a = homeAngle + Math.PI + rng.range(-0.35, 0.35); // 逆风方向
    const strength = rng.range(6.5, 10.5);
    return {
      axisX: Math.cos(homeAngle + rng.range(-0.2, 0.2)),
      axisY: Math.sin(homeAngle + rng.range(-0.2, 0.2)),
      center0: clubDist * (0.3 + i * 0.32) + rng.range(-25000, 25000),
      speed: rng.range(6, 12),
      width: rng.range(26000, 42000),
      windX: Math.cos(a) * strength,
      windY: Math.sin(a) * strength,
    };
  });
  const windCfg: WindConfig = {
    prevailing,
    bands,
    gustAmp: 1.1,
    gustL: 80000,
    gustT: 2400,
  };

  // 雨：一团横在归巢走廊上的"拦路雨" + 2~3 个移动云团，生消窗口覆盖赛程中段
  const rainCount = config.id.includes('rain') ? 4 : 2 + (rng.next() < 0.5 ? 1 : 0);
  const dirX = Math.cos(homeAngle);
  const dirY = Math.sin(homeAngle);
  const cells: RainCell[] = [];
  // 拦路雨：覆盖走廊中段，比赛开始后约 1 小时形成、持续到后半程
  cells.push({
    x0: dirX * clubDist * 0.45 + -dirY * rng.range(-15000, 15000),
    y0: dirY * clubDist * 0.45 + dirX * rng.range(-15000, 15000),
    vx: rng.range(-3, 3),
    vy: rng.range(-2, 4),
    rx: rng.range(55000, 80000),
    ry: rng.range(40000, 60000),
    angle: homeAngle + Math.PI / 2 + rng.range(-0.3, 0.3),
    strength: rng.range(0.7, 0.95),
    t0: 2400,
    t1: rng.range(15000, 22000),
  });
  for (let i = 0; i < rainCount; i++) {
    const along = rng.range(0.25, 0.8) * clubDist;
    const off = rng.range(-90000, 90000);
    cells.push({
      x0: dirX * along + -dirY * off,
      y0: dirY * along + dirX * off,
      vx: rng.range(-10, 10),
      vy: rng.range(4, 11),
      rx: rng.range(28000, 55000),
      ry: rng.range(18000, 38000),
      angle: rng.range(0, Math.PI),
      strength: rng.range(0.55, 1),
      t0: rng.range(3600, 9000),
      t1: rng.range(16000, 26000),
    });
  }

  return {
    seed,
    config,
    projection,
    box,
    terrain,
    wind: new WindField(windCfg),
    weather: new Weather(cells),
    lofts,
    pigeons,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
