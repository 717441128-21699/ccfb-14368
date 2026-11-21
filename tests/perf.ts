/**
 * 性能压测：五千羽 / 五百公里全场模拟，硬指标 < 10 秒。
 * 同时输出规模分档耗时与归巢率、分速分布，便于回归对比。
 */
import { RACE_CATALOG, buildScenario } from '../src/engine/scenario';
import { Simulator } from '../src/engine/simulator';

function bench(label: string, raceId: string): void {
  const cfg = RACE_CATALOG.find((c) => c.id === raceId)!;
  const scn = buildScenario(cfg, [{ loftName: '压测鸽舍', owner: '机器人', pigeonCount: 20 }]);
  const sim = new Simulator(scn);

  const t0 = performance.now();
  const results = sim.run();
  const cost = performance.now() - t0;

  const arrived = results.filter((r) => r.arrived);
  const speeds = arrived.map((r) => r.speed).sort((a, b) => a - b);
  const quantile = (q: number) => speeds[Math.floor(speeds.length * q)]?.toFixed(1) ?? '—';
  const rests = results.filter((r) => r.rests > 0).length;

  console.log(`\n[${label}] ${cfg.name}`);
  console.log(`  参赛 ${results.length} 羽 · 鸽舍 ${scn.lofts.length} 个 · 雨团 ${scn.weather.cells.length} 个`);
  console.log(`  引擎耗时: ${cost.toFixed(0)} ms （指标 < 10000 ms）${cost < 10000 ? ' ✅ PASS' : ' ❌ FAIL'}`);
  console.log(`  归巢率: ${((arrived.length / results.length) * 100).toFixed(1)}% · 落地过的鸽子: ${rests} 羽`);
  console.log(`  分速 p10/p50/p90: ${quantile(0.1)} / ${quantile(0.5)} / ${quantile(0.9)} m/min`);
  const winner = arrived[0];
  if (winner) {
    const h = Math.floor(winner.elapsed / 3600);
    const m = Math.floor((winner.elapsed % 3600) / 60);
    console.log(`  冠军用时: ${h}h${m}m · 距离 ${(winner.distance / 1000).toFixed(1)} km`);
  }
  if (cost >= 10000) process.exitCode = 1;
}

bench('主指标', 'r500-autumn');
bench('对照档', 'r300-spring');
bench('长距离', 'r700-challenge');

console.log('\n内存占用（堆）:', `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`);
