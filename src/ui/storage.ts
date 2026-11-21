import type { UserRegistration } from '../engine/scenario';

/**
 * 报名信息持久化（localStorage）。
 * 键按赛事 id 区分，构建场景时注入为玩家鸽舍。
 */
const KEY = 'pigeon-race/registrations/v1';

type Store = Record<string, UserRegistration>;

export function loadRegistrations(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

export function getRegistration(raceId: string): UserRegistration | null {
  return loadRegistrations()[raceId] ?? null;
}

export function saveRegistration(raceId: string, reg: UserRegistration): void {
  const all = loadRegistrations();
  all[raceId] = reg;
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function clearRegistration(raceId: string): void {
  const all = loadRegistrations();
  delete all[raceId];
  localStorage.setItem(KEY, JSON.stringify(all));
}
