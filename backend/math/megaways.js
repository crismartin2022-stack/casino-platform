// Motor 2 — MEGAWAYS: 6 rodillos con 2 a 7 filas aleatorias por giro (hasta 117.649 formas).
// Scatters activan giros gratis (tabla o rules.freeSpinsPerScatter por cada scatter) con multiplicador global que
// sube en cada giro ganador. Diseño original: 2+ comodines suman su cantidad al multiplicador del giro
// (rules.wildMultMin) y los símbolos MULTIPLICADOR (type 'multiplier') suman su valor al premio del giro.
import {
  symbolMap, stripWindow, evaluateWays, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip, round6, weightedPick,
} from './common.js';

export const id = 'megaways';
export const name = 'Megaways';
export const description = 'Rodillos de 2 a 7 símbolos (hasta 117.649 formas); comodines y símbolos multiplicador multiplican el giro; 10 giros gratis por cada scatter.';

function megaSpin(config, rng, syms) {
  const R = config.rules;
  const heights = config.reels.map(() => weightedPick(rng, R.rowWeights).rows);
  const stops = config.reels.map((s) => rng.int(s.length));
  const grid = config.reels.map((s, c) => stripWindow(s, stops[c], heights[c]));
  const wins = evaluateWays(grid, syms);
  const ways = heights.reduce((a, h) => a * h, 1);
  const scatters = findSymbols(grid, (sid) => syms.get(sid)?.type === 'scatter');
  // Multiplicador del giro: comodines (si hay al menos wildMultMin) + valores de los símbolos multiplicador
  let spinMult = 1;
  const wilds = R.wildMultMin > 0 ? findSymbols(grid, (sid) => syms.get(sid)?.type === 'wild').length : 0;
  if (R.wildMultMin > 0 && wilds >= R.wildMultMin) spinMult += wilds;
  const multCells = R.multiplierValues?.length ? findSymbols(grid, (sid) => syms.get(sid)?.type === 'multiplier') : [];
  const mults = multCells.map(([c, r]) => ({ c, r, value: weightedPick(rng, R.multiplierValues).value }));
  for (const m of mults) spinMult += m.value;
  const lineWin = sumPays(wins);
  const extra = spinMult > 1 && lineWin > 0 ? { spinMult, ...(wilds >= R.wildMultMin && R.wildMultMin > 0 ? { wildMult: wilds } : {}) } : {};
  return { heights, stops, grid, ways, wins, scatters, ...(mults.length ? { mults } : {}), ...extra, win: round6(lineWin * (lineWin > 0 ? spinMult : 1)) };
}

export function play(config, rng) {
  const syms = symbolMap(config);
  const R = config.rules;
  const base = megaSpin(config, rng, syms);
  let total = base.win;
  let freeSpins = null;
  const awarded = R.freeSpinsPerScatter > 0 ? (base.scatters.length >= R.scattersToTrigger ? R.freeSpinsPerScatter * base.scatters.length : 0)
    : R.freeSpins[String(Math.min(base.scatters.length, 6))];
  if (base.scatters.length >= R.scattersToTrigger && awarded) {
    freeSpins = { awarded, spins: [] };
    let left = awarded, multiplier = 1;
    while (left > 0 && freeSpins.spins.length < 100) {
      left--;
      const s = megaSpin(config, rng, syms);
      if (s.win > 0) multiplier += R.fsMultiplierStep;
      const win = round6(s.win * multiplier);
      if (s.scatters.length >= R.scattersToTrigger) left += R.retrigger;
      freeSpins.spins.push({ ...s, multiplier, win });
      total += win;
    }
    freeSpins.totalWin = round6(freeSpins.spins.reduce((a, s) => a + s.win, 0));
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, base, freeSpins, totalWin: capped, capped: wasCapped };
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config, { reels: [4, 8], fixedRows: true })];
  const R = config.rules || {};
  if (!Array.isArray(R.rowWeights) || R.rowWeights.some((w) => w.rows < 2 || w.rows > 7 || !(w.weight > 0))) {
    errors.push('rules.rowWeights debe ser [{rows: 2..7, weight > 0}]');
  }
  if (!(R.freeSpinsPerScatter > 0) && (!R.freeSpins || typeof R.freeSpins !== 'object')) errors.push('rules.freeSpins debe mapear nº de scatters → giros');
  if (R.freeSpinsPerScatter != null && !(R.freeSpinsPerScatter >= 0 && R.freeSpinsPerScatter <= 30)) errors.push('rules.freeSpinsPerScatter debe estar entre 0 y 30');
  if (R.wildMultMin != null && !(Number.isInteger(R.wildMultMin) && R.wildMultMin >= 0 && R.wildMultMin <= 10)) errors.push('rules.wildMultMin debe ser un entero entre 0 (apagado) y 10');
  if (config.symbols?.some((s) => s.type === 'multiplier') && (!Array.isArray(R.multiplierValues) || !R.multiplierValues.length || R.multiplierValues.some((m) => !(m.value >= 1 && m.weight > 0)))) {
    errors.push('rules.multiplierValues debe ser [{value >= 1, weight > 0}] cuando hay símbolos multiplicador');
  }
  if (!(R.scattersToTrigger >= 2 && R.scattersToTrigger <= 6)) errors.push('rules.scattersToTrigger debe estar entre 2 y 6');
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Megaways necesita un símbolo scatter');
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { nine: 10, ten: 10, jack: 9, queen: 9, king: 8, ace: 8, mask: 5, idol: 4, crown: 3, wild: 1, scatter: 1, orb: 1 };
  return {
    engine: id,
    name: 'Templo Megaways',
    grid: { reels: 6, rowsMin: 2, rowsMax: 7 },
    symbols: [
      { id: 'nine', name: '9', type: 'regular', image: ph('9', '#3498db'), pays: { 3: 0.002, 4: 0.004, 5: 0.01, 6: 0.02 } },
      { id: 'ten', name: '10', type: 'regular', image: ph('10', '#2980b9'), pays: { 3: 0.002, 4: 0.004, 5: 0.01, 6: 0.02 } },
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#27ae60'), pays: { 3: 0.003, 4: 0.006, 5: 0.015, 6: 0.03 } },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#16a085'), pays: { 3: 0.003, 4: 0.006, 5: 0.015, 6: 0.03 } },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#d35400'), pays: { 3: 0.004, 4: 0.01, 5: 0.02, 6: 0.05 } },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#c0392b'), pays: { 3: 0.004, 4: 0.01, 5: 0.02, 6: 0.05 } },
      { id: 'mask', name: 'Máscara', type: 'regular', image: ph('🎭', '#8e44ad'), pays: { 3: 0.01, 4: 0.025, 5: 0.06, 6: 0.15 } },
      { id: 'idol', name: 'Ídolo', type: 'regular', image: ph('🗿', '#7f8c8d'), pays: { 3: 0.015, 4: 0.04, 5: 0.1, 6: 0.25 } },
      { id: 'crown', name: 'Corona', type: 'regular', image: ph('👑', '#f1c40f'), pays: { 3: 0.025, 4: 0.075, 5: 0.2, 6: 0.5 } },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e74c3c'), pays: {} },
      { id: 'scatter', name: 'Scatter', type: 'scatter', image: ph('★', '#e67e22'), pays: {} },
      { id: 'orb', name: 'Multiplicador', type: 'multiplier', image: ph('×', '#9b59b6'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5, 6].map((i) => buildStrip(w, 2000 + i)),
    rules: {
      rowWeights: [
        { rows: 2, weight: 10 }, { rows: 3, weight: 25 }, { rows: 4, weight: 30 },
        { rows: 5, weight: 20 }, { rows: 6, weight: 10 }, { rows: 7, weight: 5 },
      ],
      // Diseño original: 3+ scatters dan 10 giros gratis por cada scatter
      scattersToTrigger: 3,
      freeSpinsPerScatter: 10,
      freeSpins: { 3: 30, 4: 40, 5: 50, 6: 60 },
      retrigger: 5,
      fsMultiplierStep: 0.5,
      // 2+ comodines suman su cantidad al multiplicador del giro
      wildMultMin: 2,
      multiplierValues: [{ value: 2, weight: 50 }, { value: 3, weight: 25 }, { value: 5, weight: 15 }, { value: 10, weight: 8 }, { value: 25, weight: 2 }],
      maxWin: 10000,
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Templo Megaways', background: null, backgroundColor: '#1b2a1b',
      palette: { primary: '#27ae60', accent: '#f1c40f', panel: '#0e1a0e', text: '#ffffff', reelBg: '#203520' },
      font: 'Cinzel Decorative',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null },
    rtpTarget: 0.96,
  };
}
