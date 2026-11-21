/**
 * 引擎单元测试（零依赖断言，tsx 直接运行）。
 * 覆盖：随机确定性、大圆距离、投影互逆、噪声范围、
 * 风/雨移动、场景生成、模拟器可复现性、分速与到钟精度。
 */
import { Random, hashSeed } from '../src/engine/rng';
import { haversine, LocalProjection } from '../src/engine/geo';
import { fbm, valueNoise } from '../src/engine/noise';
import { WindField } from '../src/engine/wind';
import { Weather } from '../src/engine/weather';
import { Terrain } from '../src/engine/terrain';
import { RACE_CATALOG, buildScenario } from '../src/engine/scenario';
import { Simulator, STEP } from '../src/engine/simulator';
import { rankResults } from '../src/engine/scoring';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

console.log('rng:');
{
  const a = new Random(42);
  const b = new Random(42);
  const seq1 = Array.from({ length: 1000 }, () => a.next());
  const seq2 = Array.from({ length: 1000 }, () => b.next());
  check('同种子序列一致', seq1.every((v, i) => v === seq2[i]));
  check('值域 [0,1)', seq1.every((v) => v >= 0 && v < 1));
  const rngG = new Random(7);
  const g = Array.from({ length: 20000 }, () => rngG.gaussian());
  const mean = g.reduce((s, v) => s + v, 0) / g.length;
  const variance = g.reduce((s, v) => s + (v - mean) ** 2, 0) / g.length;
  check('高斯均值≈0', approx(mean, 0, 0.03), `mean=${mean}`);
  check('高斯方差≈1', approx(variance, 1, 0.06), `var=${variance}`);
  check('hashSeed 稳定', hashSeed('abc') === hashSeed('abc'));
}

console.log('geo:');
{
  // 北京→上海大圆距离约 1068 km
  const d = haversine({ lat: 39.9042, lon: 116.4074 }, { lat: 31.2304, lon: 121.4737 });
  check('北京-上海距离≈1068km', approx(d, 1_068_000, 8000), `d=${d}`);
  const proj = new LocalProjection({ lat: 35, lon: 115 });
  const p = { lat: 35.5, lon: 115.5 };
  const xy = proj.project(p);
  const back = proj.unproject(xy.x, xy.y);
  check('投影互逆', approx(back.lat, p.lat, 1e-9) && approx(back.lon, p.lon, 1e-9));
  // 向北 1 度 ≈ 111.2 km
  const north = proj.project({ lat: 36, lon: 115 });
  check('1 度纬度≈111.2km', approx(north.y, 111_195, 200), `y=${north.y}`);
}

console.log('noise:');
{
  const vals = Array.from({ length: 500 }, (_, i) => fbm(i * 0.37, i * 0.53, 99));
  check('fbm 值域 [0,1]', vals.every((v) => v >= 0 && v <= 1));
  check('fbm 确定性', fbm(1.2, 3.4, 99) === fbm(1.2, 3.4, 99));
  check('valueNoise 周期平铺', valueNoise(0, 0, 1, 64) === valueNoise(64, 0, 1, 64));
}

console.log('terrain:');
{
  const t = new Terrain(5, { minX: 0, minY: 0, maxX: 600000, maxY: 600000 }, 4000);
  check('栅格尺寸', t.nx === 151 && t.ny === 151, `nx=${t.nx}`);
  const e = t.elevationAt(300000, 300000);
  check('高程合理(0~1500)', e >= 0 && e <= 1500, `e=${e}`);
  check('双线性在格点上一致', approx(t.elevationAt(0, 0), t.height[0], 1e-6));
  check('存在水面', (() => {
    for (let x = 0; x <= 600000; x += 8000) {
      for (let y = 0; y <= 600000; y += 8000) {
        if (t.isWaterAt(x, y)) return true;
      }
    }
    return false;
  })());
}

console.log('wind / weather:');
{
  const wind = new WindField({
    prevailing: { x: 2, y: 1 },
    bands: [{ axisX: 0, axisY: 1, center0: 100000, speed: 10, width: 20000, windX: -8, windY: 0 }],
    gustAmp: 1,
    gustL: 80000,
    gustT: 2400,
  });
  const w0 = wind.windAt(0, 100000, 0);
  check('逆风带中心受影响', w0.x < -4, `vx=${w0.x}`);
  const wFar = wind.windAt(0, 400000, 0);
  check('逆风带外围接近盛行风', approx(wFar.x, 2, 1.5), `vx=${wFar.x}`);
  const weather = new Weather([
    { x0: 0, y0: 0, vx: 5, vy: 0, rx: 20000, ry: 20000, angle: 0, strength: 0.9, t0: 0, t1: 10000 },
  ]);
  check('雨团中心有雨', weather.rainAt(0, 0, 1000) > 0.8);
  check('雨团外无雨', weather.rainAt(200000, 200000, 0) < 0.01);
  check('雨团随时间移动', weather.rainAt(50, 0, 10) > weather.rainAt(50, 0, 0));
}

console.log('scenario:');
{
  const cfg = RACE_CATALOG[1]; // 300km / 3000 羽
  const scn = buildScenario(cfg, []);
  check('鸽子总数达标', scn.pigeons.length >= cfg.pigeonCount * 0.9, `n=${scn.pigeons.length}`);
  check('每羽都挂在鸽舍下', scn.pigeons.every((p) => scn.lofts[p.loftId].pigeonIds.includes(p.id)));
  check('空速分布合理', scn.pigeons.every((p) => p.cruise >= 16 && p.cruise <= 29));
  check('鸽舍距放飞点有差异', new Set(scn.lofts.map((l) => Math.round(Math.hypot(l.x, l.y) / 1000))).size > 5);
  const scn2 = buildScenario(cfg, []);
  check('场景可复现', scn2.pigeons.every((p, i) => p.cruise === scn.pigeons[i].cruise));
  const withUser = buildScenario(cfg, [{ loftName: '测试鸽舍', owner: '我', pigeonCount: 10 }]);
  check('玩家鸽舍注入', withUser.lofts.some((l) => l.isUser && l.name === '测试鸽舍' && l.pigeonIds.length === 10));
}

console.log('simulator:');
{
  const cfg = RACE_CATALOG[1];
  const scn = buildScenario(cfg, [{ loftName: '我的鸽舍', owner: '玩家', pigeonCount: 8 }]);
  const sim = new Simulator(scn, [0, 1]);
  const results = sim.run();
  check('每羽都有成绩', results.length === scn.pigeons.length);
  const arrived = results.filter((r) => r.arrived);
  check('大部分归巢', arrived.length / results.length > 0.85, `${arrived.length}/${results.length}`);
  check('归巢距离按鸽舍区分', new Set(arrived.map((r) => r.loftId)).size === new Set(arrived.map((r) => Math.round(r.distance))).size);
  check('分速在现实区间 (550~1900 m/min)', arrived.every((r) => r.speed > 550 && r.speed < 1900),
    `range=[${Math.min(...arrived.map((r) => r.speed)).toFixed(1)}, ${Math.max(...arrived.map((r) => r.speed)).toFixed(1)}]`);
  // 到钟精度：elapsed 不应被 60s 步长量化
  const quantized = arrived.every((r) => Math.abs(r.elapsed - Math.round(r.elapsed / STEP) * STEP) < 1e-6);
  check('到钟时刻为亚秒级（未被步长量化）', !quantized);
  const maxFrac = Math.max(...arrived.map((r) => Math.abs(r.elapsed - Math.round(r.elapsed))));
  check('到钟误差 < 1 秒', maxFrac <= 1, `maxFrac=${maxFrac}`);
  check('排名按用时升序', arrived.every((r, i) => i === 0 || r.elapsed >= arrived[i - 1].elapsed));
  // 确定性遇雨落地：在放飞点覆盖一场暴雨，低耐受鸽子必须落地
  const scnRain = buildScenario(cfg, []);
  scnRain.weather.cells.length = 0;
  scnRain.weather.cells.push({
    x0: 0, y0: 0, vx: 0, vy: 0, rx: 120000, ry: 120000, angle: 0,
    strength: 1, t0: -2000, t1: 200000, // 提前生成，避开生消斜坡
  });
  const simRain = new Simulator(scnRain);
  for (let s = 0; s < 5; s++) simRain.step(); // 鸽群飞入雨区
  const restingCount = simRain.snapshot().pigeons.filter((p) => p.resting).length;
  check('暴雨触发落地休息', restingCount > scnRain.pigeons.length * 0.2, `resting=${restingCount}`);
  // 航迹被记录
  check('群航迹已采样', sim.telemetry.flockTracks.some((t) => t && t.length > 2));
  check('重点鸽轨迹已采样', sim.telemetry.watched.get(0)!.length > 10);

  // 复现性：同一种子两次完整模拟结果一致
  const sim2 = new Simulator(buildScenario(cfg, [{ loftName: '我的鸽舍', owner: '玩家', pigeonCount: 8 }]));
  const r2 = sim2.run();
  check('完整模拟可复现', r2.every((r, i) => r.elapsed === results[i].elapsed && r.pigeonId === results[i].pigeonId));

  const rows = rankResults(results, scn.pigeons, scn.lofts);
  check('排名表名次连续', rows.filter((r) => r.rank > 0).every((r, i) => r.rank === i + 1));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
