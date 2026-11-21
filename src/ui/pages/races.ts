import { RACE_CATALOG } from '../../engine/scenario.js';
import { getRegistration } from '../storage.js';

export function renderRaces(root: HTMLElement): void {
  root.innerHTML = `
    <h1>赛事列表</h1>
    <p class="muted">全部赛程基于真实赛制：开笼后按风场、天气、地形与个体体力实时模拟，成绩以经纬度大圆距离与鸽钟到钟时刻核算分速。</p>
    <div class="race-grid">
      ${RACE_CATALOG.map((c) => {
        const reg = getRegistration(c.id);
        const date = new Date(c.startEpoch * 1000);
        const dateText = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
          date.getUTCDate(),
        ).padStart(2, '0')} ${String((date.getUTCHours() + 8) % 24).padStart(2, '0')}:00`;
        return `
        <div class="race-card">
          <h3>${c.name}</h3>
          <p class="muted" style="margin:4px 0">${c.releaseName} → 俱乐部总会区 · 标称 ${c.nominalKm} km</p>
          <div class="row spread" style="margin:10px 0">
            <span class="badge">${dateText} 开笼</span>
            <span class="badge green">${c.pigeonCount} 羽</span>
          </div>
          <p class="muted" style="margin:4px 0">参赛费 ${c.entryFee} 元 · ${c.prize}</p>
          ${reg ? `<p style="color:var(--gold);margin:8px 0 4px">★ 已报名：${reg.loftName}（${reg.pigeonCount} 羽）</p>` : ''}
          <div class="row" style="margin-top:12px">
            <a class="btn" href="#/register/${c.id}">${reg ? '修改报名' : '我要报名'}</a>
            <a class="btn secondary" href="#/race/${c.id}">进入模拟</a>
            <a class="btn secondary" href="#/results/${c.id}">成绩公示</a>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}
