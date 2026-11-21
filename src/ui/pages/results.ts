import { RACE_CATALOG, buildScenario, type Loft, type Pigeon } from '../../engine/scenario.js';
import type { PigeonResult } from '../../engine/simulator.js';
import { Simulator } from '../../engine/simulator.js';
import { rankResults, loftTeamScores, type RankedRow } from '../../engine/scoring.js';
import { getRegistration } from '../storage.js';

interface CachedScenario {
  seed: number;
  lofts: Pick<Loft, 'id' | 'name' | 'owner' | 'isUser'>[];
  pigeons: Pigeon[];
}

export function renderResults(root: HTMLElement, raceId?: string): void {
  const config = RACE_CATALOG.find((c) => c.id === raceId) ?? RACE_CATALOG[0];
  const rawResults = sessionStorage.getItem(`result/${config.id}`);
  const rawScn = sessionStorage.getItem(`scenario/${config.id}`);

  if (!rawResults || !rawScn) {
    root.innerHTML = `
      <h1>成绩公示 · ${config.name}</h1>
      <div class="card" style="max-width:560px">
        <p>本场比赛尚未模拟，暂无成绩。</p>
        <div class="row">
          <a class="btn" href="#/race/${config.id}">前往比赛模拟</a>
          <button class="secondary" id="btn-auto">立即后台模拟并出成绩</button>
        </div>
        <p class="muted" id="auto-status" style="margin-top:10px"></p>
      </div>`;
    root.querySelector('#btn-auto')!.addEventListener('click', () => {
      const status = root.querySelector('#auto-status')!;
      status.textContent = '模拟中…';
      setTimeout(() => {
        const t0 = performance.now();
        const { rows, teamRows, total, arrived, dnf } = compute(config.id);
        const cost = performance.now() - t0;
        sessionStorage.setItem(`perf/${config.id}`, cost.toFixed(1));
        paint(root, config.id, rows, teamRows, total, arrived, dnf);
      }, 30);
    });
    return;
  }

  const results = JSON.parse(rawResults) as PigeonResult[];
  const cached = JSON.parse(rawScn) as CachedScenario;
  const reg = getRegistration(config.id);
  const scn = buildScenario(config, reg ? [reg] : [], cached.seed);
  // 以缓存的命名/属性为准（防止报名状态变化导致错位）
  scn.pigeons.forEach((p, i) => Object.assign(p, cached.pigeons[i]));
  cached.lofts.forEach((l) => {
    const target = scn.lofts.find((x) => x.id === l.id);
    if (target) Object.assign(target, l);
  });
  const rows = rankResults(results, scn.pigeons, scn.lofts);
  const teamRows = loftTeamScores(rows);
  const arrived = results.filter((r) => r.arrived).length;
  paint(root, config.id, rows, teamRows, results.length, arrived, results.length - arrived);
}

function compute(raceId: string): {
  rows: RankedRow[];
  teamRows: ReturnType<typeof loftTeamScores>;
  total: number;
  arrived: number;
  dnf: number;
} {
  const config = RACE_CATALOG.find((c) => c.id === raceId)!;
  const reg = getRegistration(raceId);
  const scn = buildScenario(config, reg ? [reg] : []);
  const sim = new Simulator(scn);
  const results = sim.run();
  sessionStorage.setItem(`result/${raceId}`, JSON.stringify(results));
  sessionStorage.setItem(
    `scenario/${raceId}`,
    JSON.stringify({
      seed: scn.seed,
      lofts: scn.lofts.map((l) => ({ id: l.id, name: l.name, owner: l.owner, isUser: l.isUser })),
      pigeons: scn.pigeons,
    }),
  );
  const rows = rankResults(results, scn.pigeons, scn.lofts);
  const arrived = results.filter((r) => r.arrived).length;
  return { rows, teamRows: loftTeamScores(rows), total: results.length, arrived, dnf: results.length - arrived };
}

function paint(
  root: HTMLElement,
  raceId: string,
  rows: RankedRow[],
  teamRows: ReturnType<typeof loftTeamScores>,
  total: number,
  arrived: number,
  dnf: number,
): void {
  const perf = sessionStorage.getItem(`perf/${raceId}`);
  const winner = rows.find((r) => r.rank === 1);
  root.innerHTML = `
    <h1>成绩公示 · ${RACE_CATALOG.find((c) => c.id === raceId)!.name}</h1>
    <div class="kpi-strip">
      <div class="kpi"><div class="v">${total}</div><div class="k">参赛羽数</div></div>
      <div class="kpi"><div class="v" style="color:var(--green)">${arrived}</div><div class="k">归巢羽数（${((arrived / total) * 100).toFixed(1)}%）</div></div>
      <div class="kpi"><div class="v" style="color:var(--red)">${dnf}</div><div class="k">失格羽数</div></div>
      <div class="kpi"><div class="v">${winner ? winner.speedText : '—'}</div><div class="k">冠军分速 m/min</div></div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">冠军鸽${perf ? ` · 引擎模拟耗时 ${perf} ms` : ''}</h2>
      ${winner
        ? `<p><b style="color:var(--gold)">${winner.pigeon.name}（${winner.pigeon.ring}）</b> · ${winner.loft.name} · ${winner.loft.owner}</p>
           <p class="muted">大圆距离 ${winner.distanceText} km · 到钟 ${winner.clockText} · 用时 ${winner.elapsedText} · 分速 ${winner.speedText} m/min（落地 ${winner.result.rests} 次）</p>`
        : '<p>本场无归巢鸽。</p>'}
    </div>
    <div class="card">
      <h2 style="margin-top:0">鸽舍团体榜（最快 3 羽分速之和）</h2>
      <table>
        <thead><tr><th>名次</th><th>鸽舍</th><th>鸽主</th><th>计速羽数</th><th>团体分速</th></tr></thead>
        <tbody>
          ${teamRows
            .slice(0, 10)
            .map((t, i) => `<tr class="${t.loft.isUser ? 'user-row' : ''}">
              <td>${i + 1}</td><td>${t.loft.isUser ? '★ ' : ''}${t.loft.name}</td><td>${t.loft.owner}</td>
              <td>${t.counted}</td><td>${t.score.toFixed(3)}</td></tr>`)
            .join('')}
        </tbody>
      </table>
    </div>
    <div class="card">
      <div class="row spread">
        <h2 style="margin:0">个人总成绩（按分速排名）</h2>
        <div class="row">
          <input id="q" placeholder="搜索鸽舍 / 足环号 / 鸽名" style="width:240px" />
          <label class="row" style="gap:6px;white-space:nowrap"><input type="checkbox" id="only-mine" style="width:auto" />只看我的</label>
        </div>
      </div>
      <div class="table-wrap" style="margin-top:12px">
        <table id="result-table">
          <thead><tr>
            <th>名次</th><th>足环号</th><th>鸽名</th><th>鸽舍</th><th>距离 km</th>
            <th>到钟时刻</th><th>飞行用时</th><th>分速 m/min</th><th>落地</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div class="row">
      <a class="btn secondary" href="#/races">返回赛事列表</a>
      <a class="btn" href="#/race/${raceId}">回放比赛过程</a>
    </div>`;

  const tbody = root.querySelector<HTMLTableSectionElement>('#result-table tbody')!;
  const q = root.querySelector<HTMLInputElement>('#q')!;
  const onlyMine = root.querySelector<HTMLInputElement>('#only-mine')!;

  function draw(): void {
    const kw = q.value.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (onlyMine.checked && !r.loft.isUser) return false;
      if (!kw) return true;
      return (
        r.loft.name.toLowerCase().includes(kw) ||
        r.pigeon.ring.toLowerCase().includes(kw) ||
        r.pigeon.name.toLowerCase().includes(kw)
      );
    });
    tbody.innerHTML = filtered
      .map((r) => {
        const cls = `${r.loft.isUser ? 'user-row' : ''} ${r.result.arrived ? '' : 'dnf'}`;
        const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : '';
        return `<tr class="${cls}">
          <td>${r.rank ? r.rank + ' ' + medal : '失格'}</td>
          <td>${r.pigeon.ring}</td>
          <td>${r.pigeon.name}</td>
          <td>${r.loft.isUser ? '★ ' : ''}${r.loft.name}</td>
          <td>${r.distanceText}</td>
          <td>${r.clockText}</td>
          <td>${r.elapsedText}</td>
          <td>${r.speedText}</td>
          <td>${r.result.rests}</td>
        </tr>`;
      })
      .join('');
  }
  q.addEventListener('input', draw);
  onlyMine.addEventListener('change', draw);
  draw();
}
