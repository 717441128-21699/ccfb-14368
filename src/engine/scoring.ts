import type { PigeonResult } from './simulator';
import type { Loft, Pigeon } from './scenario';

export interface RankedRow {
  rank: number;
  result: PigeonResult;
  pigeon: Pigeon;
  loft: Loft;
  /** 到达钟点 HH:MM:SS（亚秒截断到整秒显示） */
  clockText: string;
  /** 飞行用时 HH:MM:SS */
  elapsedText: string;
  speedText: string;
  distanceText: string;
}

function pad(n: number, w = 2): string {
  return String(Math.floor(n)).padStart(w, '0');
}

/** 模拟秒 → HH:MM:SS（UTC+8 钟点） */
export function clockText(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const h = (d.getUTCHours() + 8) % 24;
  return `${pad(h)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** 用时秒 → H:MM:SS */
export function elapsedText(seconds: number): string {
  const s = Math.floor(seconds);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function rankResults(
  results: PigeonResult[],
  pigeons: Pigeon[],
  lofts: Loft[],
): RankedRow[] {
  let rank = 0;
  return results.map((r) => {
    if (r.arrived) rank++;
    const p = pigeons[r.pigeonId];
    return {
      rank: r.arrived ? rank : 0,
      result: r,
      pigeon: p,
      loft: lofts[r.loftId],
      clockText: r.arrivalEpoch !== null ? clockText(r.arrivalEpoch) : '—',
      elapsedText: r.arrived ? elapsedText(r.elapsed) : '失格',
      speedText: r.arrived ? r.speed.toFixed(3) : '0.000',
      distanceText: (r.distance / 1000).toFixed(3),
    };
  });
}

/** 鸽舍团体分：取本舍最快 3 羽分速之和 */
export function loftTeamScores(rows: RankedRow[]): { loft: Loft; score: number; counted: number }[] {
  const map = new Map<number, { loft: Loft; speeds: number[] }>();
  for (const row of rows) {
    if (!row.result.arrived) continue;
    const e = map.get(row.loft.id);
    if (e) e.speeds.push(row.result.speed);
    else map.set(row.loft.id, { loft: row.loft, speeds: [row.result.speed] });
  }
  return [...map.values()]
    .map((e) => {
      const top3 = e.speeds.sort((a, b) => b - a).slice(0, 3);
      return { loft: e.loft, score: top3.reduce((s, v) => s + v, 0), counted: top3.length };
    })
    .sort((a, b) => b.score - a.score);
}
