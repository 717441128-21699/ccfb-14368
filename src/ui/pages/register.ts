import { RACE_CATALOG, type UserRegistration } from '../../engine/scenario.js';
import { getRegistration, saveRegistration, clearRegistration } from '../storage.js';

export function renderRegister(root: HTMLElement, raceId?: string): void {
  const config = RACE_CATALOG.find((c) => c.id === raceId) ?? RACE_CATALOG[0];
  const existing = getRegistration(config.id);

  root.innerHTML = `
    <h1>参赛报名 · ${config.name}</h1>
    <div class="card" style="max-width:560px">
      <form id="reg-form">
        <label class="field">
          <span>鸽舍名称</span>
          <input name="loftName" required maxlength="12" placeholder="例如：追风鸽舍" value="${existing?.loftName ?? ''}" />
        </label>
        <label class="field">
          <span>鸽主姓名</span>
          <input name="owner" required maxlength="8" placeholder="您的称呼" value="${existing?.owner ?? ''}" />
        </label>
        <label class="field">
          <span>参赛羽数（每羽参赛费 ${config.entryFee} 元）</span>
          <input name="pigeonCount" type="number" min="2" max="30" value="${existing?.pigeonCount ?? 8}" />
        </label>
        <div class="row">
          <button type="submit">${existing ? '保存修改' : '确认报名'}</button>
          ${existing ? '<button type="button" class="secondary" id="cancel-reg">退报</button>' : ''}
          <a class="btn secondary" href="#/races">返回列表</a>
          <a class="btn" href="#/race/${config.id}">报名后进入模拟 →</a>
        </div>
      </form>
      <p class="muted" style="margin-top:14px">报名后，您的鸽舍将以 <b style="color:var(--gold)">★ 金色</b> 标注在地图上，鸽舍位置在总会区附近随机生成，赛鸽属性按赛会统一分布抽取，公平参赛。</p>
    </div>`;

  const form = root.querySelector<HTMLFormElement>('#reg-form')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const reg: UserRegistration = {
      loftName: String(fd.get('loftName')!).trim(),
      owner: String(fd.get('owner')!).trim(),
      pigeonCount: Math.max(2, Math.min(30, Number(fd.get('pigeonCount')) || 8)),
    };
    saveRegistration(config.id, reg);
    toast(root, '报名成功！');
    setTimeout(() => { location.hash = `#/race/${config.id}`; }, 600);
  });
  root.querySelector('#cancel-reg')?.addEventListener('click', () => {
    clearRegistration(config.id);
    toast(root, '已退报');
    setTimeout(() => { location.hash = '#/races'; }, 500);
  });
}

function toast(root: HTMLElement, text: string): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}
