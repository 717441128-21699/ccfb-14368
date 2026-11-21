import './styles.css';
import { renderRaces } from './ui/pages/races.js';
import { renderRegister } from './ui/pages/register.js';
import { renderRace } from './ui/pages/race.js';
import { renderResults } from './ui/pages/results.js';

const app = document.querySelector<HTMLDivElement>('#app')!;

interface Route {
  view: string;
  raceId?: string;
}

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, raceId] = h.split('/');
  return { view: view || 'races', raceId };
}

export function navigate(path: string): void {
  location.hash = path.startsWith('#') ? path : `#/${path}`;
}

function render(): void {
  const route = parseHash();
  const nav = `
    <header class="app-header">
      <div class="logo">🕊 云翔赛鸽模拟平台</div>
      <nav>
        <a href="#/races" class="${route.view === 'races' ? 'active' : ''}">赛事列表</a>
        <a href="#/register/${route.raceId ?? ''}" class="${route.view === 'register' ? 'active' : ''}">报名</a>
        <a href="#/race/${route.raceId ?? ''}" class="${route.view === 'race' ? 'active' : ''}">比赛模拟</a>
        <a href="#/results/${route.raceId ?? ''}" class="${route.view === 'results' ? 'active' : ''}">成绩公示</a>
      </nav>
    </header>
    <main id="view"></main>`;
  app.innerHTML = nav;
  const view = document.querySelector<HTMLElement>('#view')!;
  switch (route.view) {
    case 'races':
      renderRaces(view);
      break;
    case 'register':
      renderRegister(view, route.raceId);
      break;
    case 'race':
      renderRace(view, route.raceId);
      break;
    case 'results':
      renderResults(view, route.raceId);
      break;
    default:
      navigate('/races');
  }
}

window.addEventListener('hashchange', render);
render();
