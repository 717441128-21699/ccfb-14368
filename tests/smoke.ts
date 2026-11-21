/**
 * 浏览器端冒烟测试：最小 DOM/Canvas 桩，
 * 跑通 列表→报名→比赛模拟→成绩公示 的完整页面渲染链路。
 */
import { RACE_CATALOG, buildScenario } from '../src/engine/scenario';
import { Simulator } from '../src/engine/simulator';

// ---- 最小 Canvas 2D 桩 ----
class CtxStub {
  canvas = { width: 900, height: 700 };
  fillRect(): void {}
  clearRect(): void {}
  drawImage(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  fill(): void {}
  arc(): void {}
  rect(): void {}
  ellipse(): void {}
  fillText(): void {}
  strokeText(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  setLineDash(): void {}
  createRadialGradient(): { addColorStop(): void } {
    return { addColorStop(): void {} };
  }
  createImageData(w: number, h: number): ImageData {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as unknown as ImageData;
  }
  putImageData(): void {}
  measureText(): TextMetrics {
    return { width: 40 } as TextMetrics;
  }
  set fillStyle(_: string) {}
  get fillStyle(): string {
    return '';
  }
  set strokeStyle(_: string) {}
  get strokeStyle(): string {
    return '';
  }
  set lineWidth(_: number) {}
  get lineWidth(): number {
    return 1;
  }
  set font(_: string) {}
  get font(): string {
    return '';
  }
  set globalAlpha(_: number) {}
  get globalAlpha(): number {
    return 1;
  }
  set textAlign(_: string) {}
  get textAlign(): string {
    return 'start';
  }
}

class CanvasStub {
  width = 900;
  height = 700;
  style: Record<string, string> = {};
  listeners: Record<string, EventListener> = {};
  clientWidth = 900;
  clientHeight = 700;
  getContext(): CtxStub {
    return new CtxStub();
  }
  addEventListener(type: string, fn: EventListener): void {
    this.listeners[type] = fn;
  }
  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700, x: 0, y: 0, toJSON() {} };
  }
}

// ---- 全局 DOM 桩 ----
const elements = new Map<string, HTMLElement>();
function makeEl(id: string): any {
  const el = {
    id,
    innerHTML: '',
    textContent: '',
    style: {},
    value: '',
    checked: false,
    listeners: {} as Record<string, EventListener>,
    appendChild(): void {},
    remove(): void {},
    addEventListener(t: string, fn: EventListener): void {
      this.listeners[t] = fn;
    },
    querySelector(): HTMLElement | null {
      return makeEl(id + '-q');
    },
    querySelectorAll(): HTMLElement[] {
      return [];
    },
    getBoundingClientRect(): DOMRect {
      return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30, x: 0, y: 0, toJSON() {} };
    },
  };
  elements.set(id, el as unknown as HTMLElement);
  return el;
}

const documentStub = {
  querySelector(sel: string): HTMLElement {
    return makeEl(sel);
  },
  createElement(tag: string): any {
    if (tag === 'canvas') return new CanvasStub();
    return makeEl('created-' + tag);
  },
};
const storage = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
};

Object.assign(globalThis, {
  document: documentStub,
  localStorage: localStorageStub,
  window: { addEventListener(): void {}, devicePixelRatio: 1 },
  location: { hash: '' },
  requestAnimationFrame: (fn: FrameRequestCallback) => {
    fn(16);
    return 1;
  },
  cancelAnimationFrame: (): void => {},
  performance: globalThis.performance,
  sessionStorage: storage,
  addEventListener(): void {},
});

// ---- 冒烟：直接验证引擎全链路 + 页面模块可导入 ----
const cfg = RACE_CATALOG[0];
const scn = buildScenario(cfg, [{ loftName: '冒烟鸽舍', owner: '测试员', pigeonCount: 10 }]);
const sim = new Simulator(scn, scn.lofts.find((l) => l.isUser)!.pigeonIds.slice(0, 3));

// 分步跑 30 步，验证 snapshot / telemetry 不炸
for (let i = 0; i < 30; i++) sim.step();
const snap = sim.snapshot();
if (snap.pigeons.length !== scn.pigeons.length) throw new Error('snapshot 数量不符');
if (sim.telemetry.flockTracks.every((t) => !t || t.length === 0)) throw new Error('无航迹');

// 跑完
const results = sim.run();
if (results.length !== scn.pigeons.length) throw new Error('成绩数量不符');
const userLoft = scn.lofts.find((l) => l.isUser)!;
const userResults = results.filter((r) => r.loftId === userLoft.id);
if (userResults.length !== 10) throw new Error('玩家成绩缺失');

// 动态导入页面模块，验证顶层代码与依赖图完整
await import('../src/ui/pages/races.js');
await import('../src/ui/pages/register.js');
await import('../src/ui/pages/race.js');
await import('../src/ui/pages/results.js');
await import('../src/render/mapView.js');

console.log('SMOKE OK');
console.log('  场景:', scn.pigeons.length, '羽 /', scn.lofts.length, '舍');
console.log('  30 步快照: 群', snap.flocks.length, '在飞', snap.pigeons.filter((p) => !p.arrived).length);
console.log('  完赛:', results.filter((r) => r.arrived).length, '/', results.length);
console.log('  玩家鸽舍成绩:', userResults.length, '羽');
console.log('  全部页面模块与 MapView 导入成功');
