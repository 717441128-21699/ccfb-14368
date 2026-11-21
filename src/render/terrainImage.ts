import type { Scenario } from '../engine/scenario';
import type { Box } from '../engine/terrain';
import { TERRAIN_NAMES } from '../engine/terrain';

/**
 * 静态底图：地形高程着色 + 河湖水系 + 微等高线，
 * 离屏 Canvas 只绘制一次，动态帧直接 drawImage。
 */
export function buildTerrainImage(scn: Scenario): HTMLCanvasElement {
  const { terrain, box } = scn;
  const W = 900;
  const scale = W / (box.maxX - box.minX);
  const H = Math.ceil((box.maxY - box.minY) * scale);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const data = img.data;

  for (let py = 0; py < H; py++) {
    const my = box.maxY - py / scale;
    for (let px = 0; px < W; px++) {
      const mx = box.minX + px / scale;
      const idx = (py * W + px) * 4;
      if (terrain.isWaterAt(mx, my)) {
        data[idx] = 46;
        data[idx + 1] = 108;
        data[idx + 2] = 154;
        data[idx + 3] = 255;
        continue;
      }
      const e = terrain.elevationAt(mx, my);
      const [r, g, b] = elevationColor(e);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 等高线（每 200m 一条）
  ctx.strokeStyle = 'rgba(60,50,40,0.18)';
  ctx.lineWidth = 1;
  for (const level of [200, 400, 600, 800, 1000, 1200]) {
    ctx.beginPath();
    const stepPx = 6;
    for (let py = 0; py < H; py += stepPx) {
      for (let px = 0; px < W; px += stepPx) {
        const mx = box.minX + px / scale;
        const my = box.maxY - py / scale;
        const e = terrain.elevationAt(mx, my);
        const e2 = terrain.elevationAt(mx + stepPx / scale, my);
        if ((e - level) * (e2 - level) < 0) {
          ctx.moveTo(px, py);
          ctx.lineTo(px + stepPx, py);
        }
      }
    }
    ctx.stroke();
  }

  // 图例由调用方叠加；底图角落标注比例尺信息
  return canvas;
}

function elevationColor(e: number): [number, number, number] {
  if (e < 40) return [124, 168, 96]; // 低平原 绿
  if (e < 120) return [156, 184, 108];
  if (e < 240) return [196, 190, 128]; // 丘陵 黄绿
  if (e < 450) return [178, 152, 104];
  if (e < 700) return [150, 118, 88]; // 山地 棕
  if (e < 1000) return [128, 104, 92];
  return [168, 164, 168]; // 高山 岩灰
}

export function terrainLegend(): string {
  return TERRAIN_NAMES.map((n, i) => `${n}(${[40, 240, 650, 1000][i]}m)`).join(' / ');
}

export function boxOf(scn: Scenario): Box {
  return scn.box;
}
