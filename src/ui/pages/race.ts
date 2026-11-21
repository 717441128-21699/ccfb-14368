import { RACE_CATALOG, buildScenario } from '../../engine/scenario.js';
import { Simulator, STEP, CUTOFF_T, type PigeonResult } from '../../engine/simulator.js';
import { MapView } from '../../render/mapView.js';
import { getRegistration } from '../storage.js';
import { elapsedText } from '../../engine/scoring.js';

const SPEEDS = [1, 30, 120, 300, 900]; // 倍速：1x … 15x 分钟/秒

export function renderRace(root: HTMLElement, raceId?: string): void {
  const config = RACE_CATALOG.find((c) => c.id === raceId) ?? RACE_CATALOG[0];
  const reg = getRegistration(config.id);
  const scn = buildScenario(config, reg ? [reg] : []);

  // 重点追踪：玩家的前 3 羽 + 全场随机 2 羽
  const watched: number[] = [];
  if (reg) {
    const userLoft = scn.lofts.find((l) => l.isUser);
    if (userLoft) watched.push(...userLoft.pigeonIds.slice(0, 3));
  }
  for (let i = 0; i < 2; i++) watched.push(Math.floor((i + 1) * scn.pigeons.length * 0.37));

  const sim = new Simulator(scn, watched);
  let results: PigeonResult[] | null = null;

  root.innerHTML = `
    <h1>${config.name} <span class="muted" style="font-size:13px">种子 #${scn.seed}</span></h1>
    <div class="race-layout">
      <div>
        <canvas id="race-canvas"></canvas>
        <div class="legend">
          <span><i style="background:#ff5d73"></i>放飞点</span>
          <span><i style="background:#59d98e"></i>鸽舍</span>
          <span><i style="background:#ffb02e"></i>我的鸽舍</span>
          <span><i style="background:#ffe996"></i>鸽群（数字为羽数）</span>
          <span><i style="background:#c8c8d2"></i>落地休息</span>
          <span><i style="background:#4a6cb0"></i>降雨区</span>
        </div>
      </div>
      <div class="side-panel">
        <h2 style="margin-top:0">赛况</h2>
        <div class="stat"><span>模拟时间</span><b id="st-time">00:00:00</b></div>
        <div class="stat"><span>在飞鸽群</span><b id="st-flocks">0</b></div>
        <div class="stat"><span>已归巢</span><b id="st-home">0 / ${scn.pigeons.length}</b></div>
        <div class="stat"><span>落地休息</span><b id="st-rest">0</b></div>
        <div class="stat"><span>最新分速</span><b id="st-speed">— m/min</b></div>
        <div class="timeline"><div id="st-bar"></div></div>
        <h2>播放控制</h2>
        <div class="row" style="margin-bottom:10px">
          <button id="btn-play">▶ 播放</button>
          <button id="btn-step" class="secondary">单步</button>
          <button id="btn-finish" class="secondary">直接跑完</button>
        </div>
        <label class="field"><span>模拟倍速</span>
          <select id="sel-speed">${SPEEDS.map((s, i) => `<option value="${i}" ${i === 2 ? 'selected' : ''}>${s}×（${s} 秒/秒）</option>`).join('')}</select>
        </label>
        <div class="row">
          <label class="row" style="gap:6px"><input type="checkbox" id="tg-rain" checked style="width:auto" />雨区</label>
          <label class="row" style="gap:6px"><input type="checkbox" id="tg-wind" checked style="width:auto" />风场</label>
          <label class="row" style="gap:6px"><input type="checkbox" id="tg-track" checked style="width:auto" />航迹</label>
        </div>
        <h2>赛事参数</h2>
        <div class="stat"><span>放飞点</span><b style="font-size:12px">${config.releaseName}</b></div>
        <div class="stat"><span>鸽舍数量</span><b>${scn.lofts.length}</b></div>
        <div class="stat"><span>降雨云团</span><b>${scn.weather.cells.length} 个（移动）</b></div>
        <div class="stat"><span>逆风带</span><b>${scn.wind.cfg.bands.length} 条（移动）</b></div>
        <a class="btn" style="margin-top:12px" href="#/results/${config.id}">查看成绩公示 →</a>
      </div>
    </div>`;

  const canvas = root.querySelector<HTMLCanvasElement>('#race-canvas')!;
  const map = new MapView(canvas, scn);
  map.resize();
  map.render(sim, 0);

  let playing = false;
  let speedIdx = 2;
  let last = performance.now();
  let acc = 0;

  const btnPlay = root.querySelector<HTMLButtonElement>('#btn-play')!;
  const setStat = (id: string, v: string) => (root.querySelector(id)!.textContent = v);

  function syncStats(): void {
    const snap = sim.snapshot();
    const home = snap.pigeons.filter((p) => p.arrived).length;
    const rest = snap.pigeons.filter((p) => p.resting).length;
    const list = sim.resultsList;
    const lastSpeed = list.length ? list[list.length - 1].speed.toFixed(2) : '—';
    setStat('#st-time', elapsedText(snap.time));
    setStat('#st-flocks', String(snap.flocks.length));
    setStat('#st-home', `${home} / ${scn.pigeons.length}`);
    setStat('#st-rest', String(rest));
    setStat('#st-speed', `${lastSpeed} m/min`);
    root.querySelector<HTMLDivElement>('#st-bar')!.style.width =
      `${Math.min(100, (snap.time / CUTOFF_T) * 100)}%`;
  }

  function frame(now: number): void {
    // 页面已切走（canvas 被移出 DOM）：停止循环，避免操作分离节点
    if (!canvas.isConnected) return;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (playing && !results) {
      acc += dt * SPEEDS[speedIdx];
      let guard = 0;
      while (acc >= 1 && guard < 64) {
        sim.step();
        acc -= 1;
        guard++;
        if (sim.resultsList.length === scn.pigeons.length) {
          finalize();
          break;
        }
      }
    }
    map.render(sim, sim.snapshot().time);
    syncStats();
    requestAnimationFrame(frame);
  }

  function finalize(): void {
    if (results) return;
    results = sim.run();
    playing = false;
    btnPlay.textContent = '▶ 播放';
    sessionStorage.setItem(`result/${config.id}`, JSON.stringify(results));
    sessionStorage.setItem(`scenario/${config.id}`, JSON.stringify(serialize(scn)));
  }

  btnPlay.addEventListener('click', () => {
    if (results) return;
    playing = !playing;
    btnPlay.textContent = playing ? '⏸ 暂停' : '▶ 播放';
  });
  root.querySelector('#btn-step')!.addEventListener('click', () => {
    if (results) return;
    sim.step();
  });
  root.querySelector('#btn-finish')!.addEventListener('click', () => {
    const t0 = performance.now();
    finalize();
    const cost = (performance.now() - t0).toFixed(1);
    setStat('#st-time', '比赛结束');
    toast(root, `全场 ${scn.pigeons.length} 羽模拟完成，引擎耗时 ${cost} ms`);
  });
  root.querySelector<HTMLSelectElement>('#sel-speed')!.addEventListener('change', (e) => {
    speedIdx = Number((e.target as HTMLSelectElement).value);
  });
  root.querySelector<HTMLInputElement>('#tg-rain')!.addEventListener('change', (e) => (map.showRain = (e.target as HTMLInputElement).checked));
  root.querySelector<HTMLInputElement>('#tg-wind')!.addEventListener('change', (e) => (map.showWind = (e.target as HTMLInputElement).checked));
  root.querySelector<HTMLInputElement>('#tg-track')!.addEventListener('change', (e) => (map.showTracks = (e.target as HTMLInputElement).checked));

  window.addEventListener('resize', () => map.resize(), { once: true });
  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });
}

/** 结果页重建场景所需的最小信息 */
function serialize(scn: ReturnType<typeof buildScenario>): unknown {
  return {
    seed: scn.seed,
    lofts: scn.lofts.map((l) => ({ id: l.id, name: l.name, owner: l.owner, isUser: l.isUser })),
    pigeons: scn.pigeons,
  };
}

function toast(root: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

void STEP;
