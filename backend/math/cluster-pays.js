// Motor 6 — CLUSTER PAYS: cuadrícula grande (7x7 por defecto). Paga por GRUPOS de 5 o más símbolos
// iguales que se tocan en horizontal o vertical (el comodín se une a cualquier grupo).
// Los grupos ganadores explotan, cae un relleno (cascada) y el multiplicador sube.
import {
  symbolMap, spinStrips, sumPays, cloneGrid, capWin, validateCommon, validateGrid, buildStrip, round6,
  tierPay, minTier, tumble, removedSets, setsToArrays,
} from './common.js';

export const id = 'cluster-pays';
export const name = 'Cluster Pays';
export const description = 'Paga por grupos de 5+ símbolos iguales que se tocan; los grupos explotan y caen nuevos con multiplicador creciente.';
export const gridLimits = { reels: [5, 8], rows: [5, 8] };
export const paysBy = 'cluster';

/** Encuentra grupos conectados (arriba/abajo/izquierda/derecha). Índices numéricos para que sea rápido. */
export function findClusters(grid, syms, minSize) {
  const cols = grid.length, rows = grid[0].length, n = cols * rows;
  const flat = new Array(n);
  const wild = new Uint8Array(n);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const i = c * rows + r;
    flat[i] = grid[c][r];
    if (syms.get(flat[i])?.type === 'wild') wild[i] = 1;
  }
  const wins = [];
  const seen = new Uint8Array(n);        // símbolos regulares ya asignados a un grupo
  const mark = new Int32Array(n).fill(-1); // visitado en la búsqueda actual
  const stack = new Int32Array(n);
  let stamp = 0;
  for (let start = 0; start < n; start++) {
    const sid = flat[start];
    if (wild[start] || seen[start]) continue;
    const sym = syms.get(sid);
    if ((sym?.type || 'regular') !== 'regular') continue;
    stamp++;
    let sp = 0;
    stack[sp++] = start;
    mark[start] = stamp;
    const cells = [];
    while (sp) {
      const i = stack[--sp];
      cells.push(i);
      if (!wild[i]) seen[i] = 1;
      const c = (i / rows) | 0, r = i - c * rows;
      if (r > 0) { const j = i - 1; if (mark[j] !== stamp && (flat[j] === sid || wild[j])) { mark[j] = stamp; stack[sp++] = j; } }
      if (r < rows - 1) { const j = i + 1; if (mark[j] !== stamp && (flat[j] === sid || wild[j])) { mark[j] = stamp; stack[sp++] = j; } }
      if (c > 0) { const j = i - rows; if (mark[j] !== stamp && (flat[j] === sid || wild[j])) { mark[j] = stamp; stack[sp++] = j; } }
      if (c < cols - 1) { const j = i + rows; if (mark[j] !== stamp && (flat[j] === sid || wild[j])) { mark[j] = stamp; stack[sp++] = j; } }
    }
    if (cells.length >= minSize) {
      const pay = tierPay(sym.pays, cells.length);
      if (pay > 0) wins.push({ symbol: sid, count: cells.length, pay: round6(pay), positions: cells.map((i) => [(i / rows) | 0, i % rows]) });
    }
  }
  return wins;
}

export function play(config, rng) {
  const syms = symbolMap(config);
  const R = config.rules;
  const rows = config.grid.rows;
  const minSize = R.minCluster;
  const { stops, grid: g0 } = spinStrips(rng, config.reels, rows);
  let grid = g0;
  const ptr = stops.slice();
  const steps = [];
  let total = 0;
  for (let cascade = 0; cascade < 80; cascade++) {
    const wins = findClusters(grid, syms, minSize);
    const multiplier = R.cascadeMultipliers[Math.min(cascade, R.cascadeMultipliers.length - 1)];
    const win = round6(sumPays(wins) * multiplier);
    steps.push({ grid: cloneGrid(grid), wins, multiplier, win });
    if (!wins.length) break;
    total += win;
    const removed = removedSets(grid, wins.flatMap((w) => w.positions));
    steps[steps.length - 1].removed = setsToArrays(removed);
    grid = tumble(grid, removed, ptr, config.reels).grid;
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, stops, steps, totalWin: capped, capped: wasCapped, cascades: steps.length - 1 };
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config, gridLimits)];
  const R = config.rules || {};
  if (!(R.minCluster >= 3 && R.minCluster <= 10)) errors.push('rules.minCluster debe estar entre 3 y 10');
  if (!Array.isArray(R.cascadeMultipliers) || !R.cascadeMultipliers.length || R.cascadeMultipliers.some((x) => !(x >= 1))) {
    errors.push('rules.cascadeMultipliers debe ser una lista de números >= 1');
  }
  for (const s of config.symbols || []) {
    if ((s.type || 'regular') === 'regular' && Object.keys(s.pays || {}).length && minTier(s.pays) < R.minCluster) {
      errors.push(`${s.id}: el pago más bajo (${minTier(s.pays)}) es menor que rules.minCluster`);
    }
  }
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { red: 9, blue: 9, green: 9, yellow: 8, purple: 8, star: 4, moon: 3, sun: 2, wild: 1 };
  const tiers = (base) => ({ 5: base, 6: base * 1.5, 7: base * 2, 8: base * 3, 9: base * 4, 10: base * 6, 12: base * 10, 15: base * 25, 20: base * 60 });
  return {
    engine: id,
    name: 'Gemas Conectadas',
    grid: { reels: 7, rows: 7 },
    symbols: [
      { id: 'red', name: 'Rubí', type: 'regular', image: ph('◆', '#e74c3c'), pays: tiers(0.02) },
      { id: 'blue', name: 'Zafiro', type: 'regular', image: ph('◆', '#3498db'), pays: tiers(0.02) },
      { id: 'green', name: 'Esmeralda', type: 'regular', image: ph('◆', '#27ae60'), pays: tiers(0.025) },
      { id: 'yellow', name: 'Topacio', type: 'regular', image: ph('◆', '#f1c40f'), pays: tiers(0.03) },
      { id: 'purple', name: 'Amatista', type: 'regular', image: ph('◆', '#8e44ad'), pays: tiers(0.03) },
      { id: 'star', name: 'Estrella', type: 'regular', image: ph('★', '#f39c12'), pays: tiers(0.06) },
      { id: 'moon', name: 'Luna', type: 'regular', image: ph('☾', '#95a5a6'), pays: tiers(0.1) },
      { id: 'sun', name: 'Sol', type: 'regular', image: ph('☀', '#e67e22'), pays: tiers(0.2) },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e84393'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5, 6, 7].map((i) => buildStrip(w, 6000 + i)),
    rules: { minCluster: 5, cascadeMultipliers: [1, 1, 2, 3, 5, 8, 10], maxWin: 5000 },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Gemas Conectadas', background: null, backgroundColor: '#140d2b',
      palette: { primary: '#e84393', accent: '#74b9ff', panel: '#0d0820', text: '#ffffff', reelBg: '#22164a' },
      font: 'Bungee', symbolScale: 0.9, cellGap: 3,
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, tumble: null },
    rtpTarget: 0.96,
  };
}
