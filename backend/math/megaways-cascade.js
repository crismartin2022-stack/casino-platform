// Motor 10 — MEGAWAYS CASCADA (a partir del diseño enviado en Ruby, rehecho con RTP controlado):
// 6 rodillos de 2 a 7 filas, cascadas con multiplicador que sube rules.cascadeStep (+0,5) por cada caída,
// símbolos MISTERIO que se revelan todos como el mismo símbolo, y giros gratis donde el multiplicador NO se reinicia.
import {
  symbolMap, stripWindow, evaluateWays, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip,
  round6, weightedPick, tumble, removedSets, setsToArrays, cloneGrid,
} from './common.js';

export const id = 'megaways-cascade';
export const name = 'Megaways Cascada';
export const description = 'Megaways con cascadas, multiplicador que sube +0,5 por caída, símbolos misterio y giros gratis con multiplicador que no se reinicia.';
export const gridLimits = { reels: [4, 8] };
export const paysBy = 'ways';

function reveal(grid, syms, rng, R) {
  const hasMystery = grid.some((col) => col.some((sid) => syms.get(sid)?.type === 'mystery'));
  if (!hasMystery) return { grid, revealed: null };
  const as = weightedPick(rng, R.mysteryWeights).symbol;
  return { grid: grid.map((col) => col.map((sid) => (syms.get(sid)?.type === 'mystery' ? as : sid))), revealed: as };
}

/** Un giro completo con todas sus cascadas. startMult: multiplicador inicial (giros gratis lo arrastran). */
function cascadeSpin(config, rng, syms, strips, startMult) {
  const R = config.rules;
  const heights = strips.map(() => weightedPick(rng, R.rowWeights).rows);
  const stops = strips.map((s) => rng.int(s.length));
  let raw = strips.map((s, c) => stripWindow(s, stops[c], heights[c]));
  const scatters = findSymbols(raw, (sid) => syms.get(sid)?.type === 'scatter');
  const ptr = stops.slice();
  const steps = [];
  let mult = startMult;
  let win = 0;
  for (let k = 0; k < 60; k++) {
    const { grid, revealed } = reveal(raw, syms, rng, R);
    const wins = evaluateWays(grid, syms);
    const stepWin = round6(sumPays(wins) * mult);
    const ways = grid.reduce((a, col) => a * col.length, 1);
    steps.push({ raw: cloneGrid(raw), grid: cloneGrid(grid), revealed, wins, multiplier: mult, win: stepWin, ways });
    if (!wins.length) break;
    win += stepWin;
    mult = round6(mult + R.cascadeStep);
    const removed = removedSets(grid, wins.flatMap((w) => w.positions));
    steps[steps.length - 1].removed = setsToArrays(removed);
    raw = tumble(grid, removed, ptr, strips).grid; // lo revelado se queda revelado
  }
  return { heights, stops, steps, scatters, win: round6(win), endMultiplier: mult };
}

export function play(config, rng) {
  const syms = symbolMap(config);
  const R = config.rules;
  const base = cascadeSpin(config, rng, syms, config.reels, 1);
  let total = base.win;
  let freeSpins = null;
  const n = base.scatters.length;
  if (n >= R.scattersToTrigger) {
    const awarded = R.freeSpins + (n - R.scattersToTrigger) * R.extraSpinsPerScatter;
    freeSpins = { awarded, spins: [] };
    let left = awarded, mult = 1;
    while (left > 0 && freeSpins.spins.length < 100) {
      left--;
      const s = cascadeSpin(config, rng, syms, config.freeSpinReels || config.reels, mult);
      mult = R.fsKeepMultiplier ? s.endMultiplier : 1;
      if (s.scatters.length >= R.retriggerScatters) left += R.retrigger;
      freeSpins.spins.push(s);
    }
    freeSpins.totalWin = round6(freeSpins.spins.reduce((a, s) => a + s.win, 0));
    total += freeSpins.totalWin;
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, base, freeSpins, totalWin: capped, capped: wasCapped };
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config, { ...gridLimits, fixedRows: true })];
  const R = config.rules || {};
  if (!Array.isArray(R.rowWeights) || R.rowWeights.some((w) => w.rows < 2 || w.rows > 7 || !(w.weight > 0))) errors.push('rules.rowWeights debe ser [{rows: 2..7, weight > 0}]');
  if (!(R.cascadeStep >= 0 && R.cascadeStep <= 5)) errors.push('rules.cascadeStep debe estar entre 0 y 5');
  const regular = new Set((config.symbols || []).filter((s) => (s.type || 'regular') === 'regular').map((s) => s.id));
  if (config.symbols?.some((s) => s.type === 'mystery')) {
    if (!Array.isArray(R.mysteryWeights) || !R.mysteryWeights.length) errors.push('rules.mysteryWeights es obligatorio si hay símbolo misterio');
    for (const m of R.mysteryWeights || []) if (!regular.has(m.symbol) || !(m.weight > 0)) errors.push(`mysteryWeights: símbolo inválido ${m.symbol}`);
  }
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Se necesita un símbolo scatter');
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { nine: 12, ten: 10, jack: 8, queen: 7, king: 6, ace: 5, mystery: 2, wild: 1, scatter: 1 };
  return {
    engine: id,
    name: 'Cascada Infinita',
    grid: { reels: 6, rowsMin: 2, rowsMax: 7 },
    symbols: [
      { id: 'nine', name: '9', type: 'regular', image: ph('9', '#3498db'), pays: { 3: 0.003, 4: 0.006, 5: 0.015, 6: 0.03 } },
      { id: 'ten', name: '10', type: 'regular', image: ph('10', '#2980b9'), pays: { 3: 0.004, 4: 0.008, 5: 0.02, 6: 0.04 } },
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#27ae60'), pays: { 3: 0.005, 4: 0.01, 5: 0.025, 6: 0.05 } },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#16a085'), pays: { 3: 0.006, 4: 0.015, 5: 0.03, 6: 0.06 } },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#d35400'), pays: { 3: 0.008, 4: 0.02, 5: 0.05, 6: 0.1 } },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#c0392b'), pays: { 3: 0.01, 4: 0.025, 5: 0.06, 6: 0.15 } },
      { id: 'mystery', name: 'Misterio', type: 'mystery', image: ph('?', '#8e44ad'), pays: {} },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e74c3c'), pays: {} },
      { id: 'scatter', name: 'Scatter', type: 'scatter', image: ph('★', '#f1c40f'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5, 6].map((i) => buildStrip(w, 10000 + i)),
    rules: {
      rowWeights: [{ rows: 2, weight: 10 }, { rows: 3, weight: 25 }, { rows: 4, weight: 30 }, { rows: 5, weight: 20 }, { rows: 6, weight: 10 }, { rows: 7, weight: 5 }],
      cascadeStep: 0.5,
      mysteryWeights: [{ symbol: 'nine', weight: 30 }, { symbol: 'ten', weight: 25 }, { symbol: 'jack', weight: 18 }, { symbol: 'queen', weight: 12 }, { symbol: 'king', weight: 9 }, { symbol: 'ace', weight: 6 }],
      scattersToTrigger: 4, freeSpins: 10, extraSpinsPerScatter: 5, retriggerScatters: 3, retrigger: 5, fsKeepMultiplier: true, maxWin: 10000,
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Cascada Infinita', background: null, backgroundColor: '#0b1d2a',
      palette: { primary: '#00b894', accent: '#ffeaa7', panel: '#07131c', text: '#ffffff', reelBg: '#11303f' },
      font: 'Bungee',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, tumble: null },
    rtpTarget: 0.96,
  };
}
