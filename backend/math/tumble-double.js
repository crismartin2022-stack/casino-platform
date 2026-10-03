// Motor 17 — CASCADA QUE DUPLICA: 5x4, 1024 formas de ganar, cascadas (tumble).
// - En cada giro el multiplicador empieza en ×1 y se DUPLICA con cada cascada ganadora (×1, ×2, ×4, ×8…) hasta
//   rules.multMax. Cada cascada paga su premio por el multiplicador del momento.
// - 3+ scatters (en la primera pantalla) dan giros gratis (rules.freeSpins por cantidad). En los giros gratis el
//   multiplicador NO se reinicia entre giros: sigue duplicándose con cada cascada ganadora hasta rules.fsMultMax.
// - 3+ scatters durante los giros gratis suman rules.retrigger giros. Los giros gratis se pueden comprar.
// Pagos en múltiplos de la apuesta total (ways: pago × cantidad de formas).
import {
  symbolMap, spinStrips, evaluateWays, sumPays, cloneGrid, capWin, validateCommon, validateGrid, buildStrip, round6,
  tumble, removedSets, setsToArrays, findSymbols,
} from './common.js';

export const id = 'tumble-double';
export const name = 'Cascada que duplica';
export const description = 'Cascadas 5x4 (1024 formas): el multiplicador se duplica con cada cascada ganadora; en los giros gratis no se reinicia y sigue duplicándose de giro en giro.';
export const gridLimits = { reels: [5, 6], rows: [3, 5] };
export const paysBy = 'ways';
export const modes = ['base', 'buy'];

const nextMult = (m, R, cap) => Math.min(cap, round6(m * (R.multFactor || 2)));

/** Una secuencia de cascadas empezando con el multiplicador m. Devuelve los pasos y el multiplicador final. */
function sequence(config, rng, syms, strips, m, cap) {
  const R = config.rules;
  const rows = config.grid.rows;
  const { stops, grid: g0 } = spinStrips(rng, strips, rows);
  let grid = g0;
  const ptr = stops.slice();
  const steps = [];
  let win = 0;
  for (let k = 0; k < 60; k++) {
    const wins = evaluateWays(grid, syms);
    const base = sumPays(wins);
    const stepWin = round6(base * m);
    steps.push({ grid: cloneGrid(grid), wins, multiplier: m, win: stepWin });
    if (!wins.length) break;
    win += stepWin;
    const removed = removedSets(grid, wins.flatMap((w) => w.positions));
    steps[steps.length - 1].removed = setsToArrays(removed);
    grid = tumble(grid, removed, ptr, strips).grid;
    m = nextMult(m, R, cap);
  }
  const scatters = findSymbols(steps[0].grid, (sid) => syms.get(sid)?.type === 'scatter');
  return { stops, steps, win: round6(win), multEnd: m, scatters };
}

const awardFor = (R, n) => {
  const t = R.freeSpins || {};
  let best = 0;
  for (const [k, v] of Object.entries(t)) if (n >= Number(k)) best = Math.max(best, v);
  return best;
};

function freeSpinsRound(config, rng, syms, awarded) {
  const R = config.rules;
  const strips = config.freeSpinReels || config.reels;
  const fs = { awarded, spins: [] };
  let left = awarded;
  let m = R.multStart || 1;
  while (left > 0 && fs.spins.length < 200) {
    left--;
    const s = sequence(config, rng, syms, strips, m, R.fsMultMax || 1024);
    m = s.multEnd;
    if (R.retrigger > 0 && s.scatters.length >= (R.retriggerScatters || 3)) { left += R.retrigger; s.retrigger = R.retrigger; }
    fs.spins.push({ ...s, multAfter: m });
  }
  fs.totalWin = round6(fs.spins.reduce((a, s) => a + s.win, 0));
  return fs;
}

export function play(config, rng, { mode = 'base' } = {}) {
  const syms = symbolMap(config);
  const R = config.rules;
  if (mode === 'buy') {
    const n = R.scattersToTrigger || 3;
    const freeSpins = freeSpinsRound(config, rng, syms, awardFor(R, n));
    const { total, capped } = capWin(freeSpins.totalWin, config);
    return { engine: id, mode, base: null, freeSpins, totalWin: total, capped };
  }
  const base = sequence(config, rng, syms, config.reels, R.multStart || 1, R.multMax || 128);
  let total = base.win;
  let freeSpins = null;
  if (base.scatters.length >= (R.scattersToTrigger || 3)) {
    freeSpins = freeSpinsRound(config, rng, syms, awardFor(R, base.scatters.length));
    total += freeSpins.totalWin;
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, mode, base, steps: base.steps, freeSpins, totalWin: capped, capped: wasCapped };
}

export const costMultiplier = (config, mode) => (mode === 'buy' ? config.rules.buyCost : 1);

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config, gridLimits)];
  const R = config.rules || {};
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Cascada que duplica necesita un símbolo scatter');
  if (!(R.multStart >= 1 && R.multStart <= 10)) errors.push('rules.multStart (multiplicador inicial) debe estar entre 1 y 10');
  if (!(R.multFactor > 1 && R.multFactor <= 5)) errors.push('rules.multFactor (cuánto crece por cascada) debe estar entre 1 y 5 (2 = se duplica)');
  if (!(R.multMax >= 1 && R.multMax <= 100000)) errors.push('rules.multMax (tope en el juego base) debe estar entre 1 y 100000');
  if (!(R.fsMultMax >= 1 && R.fsMultMax <= 100000)) errors.push('rules.fsMultMax (tope en giros gratis) debe estar entre 1 y 100000');
  if (!(Number.isInteger(R.scattersToTrigger) && R.scattersToTrigger >= 2 && R.scattersToTrigger <= 6)) errors.push('rules.scattersToTrigger debe estar entre 2 y 6');
  const fs = R.freeSpins || {};
  if (!Object.keys(fs).length || Object.entries(fs).some(([k, v]) => !/^\d+$/.test(k) || !(Number.isInteger(v) && v >= 1 && v <= 100))) errors.push('rules.freeSpins debe ser {cantidad de scatters: giros} con giros entre 1 y 100');
  if (!(awardFor(R, R.scattersToTrigger || 3) >= 1)) errors.push('rules.freeSpins debe dar giros con la cantidad mínima de scatters');
  if (!(R.retrigger >= 0 && R.retrigger <= 50)) errors.push('rules.retrigger debe estar entre 0 y 50');
  if (R.buyCost != null && !(R.buyCost >= 10)) errors.push('rules.buyCost debe ser >= 10');
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { ten: 28, jack: 28, queen: 26, king: 24, ace: 24, eye: 14, bird: 12, beetle: 10, mask: 8, wild: 2, scatter: 3 };
  const p = (a, b, c) => ({ 3: a, 4: b, 5: c });
  return {
    engine: id,
    name: 'Furia del Chacal',
    grid: { reels: 5, rows: 4 },
    symbols: [
      { id: 'ten', name: '10', type: 'regular', image: ph('10', '#2980b9'), pays: p(0.01, 0.03, 0.08) },
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#16a085'), pays: p(0.01, 0.03, 0.08) },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#8e44ad'), pays: p(0.015, 0.04, 0.1) },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#d35400'), pays: p(0.015, 0.04, 0.1) },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#c0392b'), pays: p(0.02, 0.05, 0.12) },
      { id: 'eye', name: 'Ojo sagrado', type: 'regular', image: ph('👁', '#1abc9c'), pays: p(0.04, 0.1, 0.25) },
      { id: 'bird', name: 'Halcón', type: 'regular', image: ph('🦅', '#e67e22'), pays: p(0.05, 0.12, 0.3) },
      { id: 'beetle', name: 'Escarabajo', type: 'regular', image: ph('🪲', '#27ae60'), pays: p(0.06, 0.15, 0.4) },
      { id: 'mask', name: 'Máscara del chacal', type: 'regular', image: ph('🐺', '#f1c40f'), pays: p(0.1, 0.3, 1) },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e74c3c'), pays: {} },
      { id: 'scatter', name: 'Pirámide', type: 'scatter', image: ph('▲', '#f39c12'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(w, 17000 + i)),
    freeSpinReels: [1, 2, 3, 4, 5].map((i) => buildStrip({ ...w, scatter: 2 }, 17100 + i)),
    rules: {
      multStart: 1, multFactor: 2, multMax: 128, fsMultMax: 128,
      scattersToTrigger: 3, freeSpins: { 3: 10, 4: 12, 5: 15 }, retriggerScatters: 3, retrigger: 5,
      buyCost: 100, maxWin: 10000,
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Furia del Chacal', background: null, backgroundColor: '#1c1206',
      palette: { primary: '#d4a017', accent: '#ffd76a', panel: '#140c03', text: '#ffffff', reelBg: '#2b1c08' },
      font: 'Cinzel Decorative',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, tumble: null },
    rtpTarget: 0.96,
  };
}
