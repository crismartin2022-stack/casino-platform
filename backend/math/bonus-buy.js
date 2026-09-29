// Motor 3 — BONUS BUY: 5x3, 20 líneas. 3+ scatters = giros gratis con multiplicador fijo.
// El jugador puede COMPRAR los giros gratis pagando rules.buyCost × apuesta.
import {
  symbolMap, spinStrips, evaluateLines, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip, round6, linesFor, maxLines,
} from './common.js';

export const id = 'bonus-buy';
export const name = 'Bonus Buy';
export const description = '20 líneas con giros gratis multiplicados; los giros gratis se pueden comprar directamente.';

export const modes = ['base', 'buy'];

function lineSpin(config, rng, syms, strips) {
  const lines = linesFor(config.grid.reels, config.grid.rows, config.rules.lines);
  const { stops, grid } = spinStrips(rng, strips, config.grid.rows);
  const wins = evaluateLines(grid, lines, syms);
  const scatters = findSymbols(grid, (s) => syms.get(s)?.type === 'scatter');
  return { stops, grid, wins, scatters, win: sumPays(wins) };
}

function freeSpinsRound(config, rng, syms, awarded) {
  const R = config.rules;
  const strips = config.freeSpinReels || config.reels;
  const fs = { awarded, multiplier: R.fsMultiplier, spins: [] };
  let left = awarded;
  while (left > 0 && fs.spins.length < R.maxFreeSpins) {
    left--;
    const s = lineSpin(config, rng, syms, strips);
    const win = round6(s.win * R.fsMultiplier);
    if (s.scatters.length >= 3) left += R.retrigger;
    fs.spins.push({ ...s, win });
  }
  fs.totalWin = round6(fs.spins.reduce((a, s) => a + s.win, 0));
  return fs;
}

/** mode: 'base' (giro normal, cuesta 1× apuesta) o 'buy' (compra, cuesta rules.buyCost × apuesta). */
export function play(config, rng, { mode = 'base' } = {}) {
  const syms = symbolMap(config);
  const R = config.rules;
  if (mode === 'buy') {
    const freeSpins = freeSpinsRound(config, rng, syms, R.freeSpins['3']);
    const { total, capped } = capWin(freeSpins.totalWin, config);
    return { engine: id, mode, cost: R.buyCost, base: null, freeSpins, totalWin: total, capped };
  }
  const base = lineSpin(config, rng, syms, config.reels);
  let total = base.win;
  let freeSpins = null;
  const n = Math.min(base.scatters.length, 5);
  if (n >= 3) {
    freeSpins = freeSpinsRound(config, rng, syms, R.freeSpins[String(n)]);
    total += freeSpins.totalWin;
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, mode, cost: 1, base, freeSpins, totalWin: capped, capped: wasCapped };
}

export function costMultiplier(config, mode) {
  return mode === 'buy' ? config.rules.buyCost : 1;
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config)];
  const R = config.rules || {};
  const maxL = config.grid ? maxLines(config.grid.reels, config.grid.rows) : 20;
  if (!Number.isInteger(R.lines) || R.lines < 1 || R.lines > maxL) errors.push(`rules.lines (líneas de pago) debe estar entre 1 y ${maxL} para esta cuadrícula`);
  if (!(R.buyCost >= 10)) errors.push('rules.buyCost debe ser >= 10 (múltiplo de la apuesta)');
  if (!(R.fsMultiplier >= 1)) errors.push('rules.fsMultiplier debe ser >= 1');
  if (!R.freeSpins?.['3']) errors.push('rules.freeSpins debe definir al menos "3"');
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Bonus Buy necesita un símbolo scatter');
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { ten: 9, jack: 9, queen: 8, king: 8, ace: 7, gem: 5, ring: 4, chalice: 3, dragon: 2, wild: 2, scatter: 2 };
  const fsw = { ...w, wild: 4 };
  return {
    engine: id,
    name: 'Tesoro del Dragón',
    grid: { reels: 5, rows: 3 },
    symbols: [
      { id: 'ten', name: '10', type: 'regular', image: ph('10', '#2980b9'), pays: { 3: 5, 4: 10, 5: 25 } },
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#27ae60'), pays: { 3: 5, 4: 10, 5: 25 } },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#16a085'), pays: { 3: 6, 4: 15, 5: 30 } },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#d35400'), pays: { 3: 8, 4: 20, 5: 40 } },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#c0392b'), pays: { 3: 10, 4: 25, 5: 50 } },
      { id: 'gem', name: 'Gema', type: 'regular', image: ph('💎', '#9b59b6'), pays: { 3: 15, 4: 40, 5: 100 } },
      { id: 'ring', name: 'Anillo', type: 'regular', image: ph('💍', '#f39c12'), pays: { 3: 20, 4: 60, 5: 150 } },
      { id: 'chalice', name: 'Cáliz', type: 'regular', image: ph('🏆', '#e67e22'), pays: { 3: 30, 4: 100, 5: 250 } },
      { id: 'dragon', name: 'Dragón', type: 'regular', image: ph('🐉', '#c0392b'), pays: { 3: 50, 4: 200, 5: 1000 } },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e74c3c'), pays: {} },
      { id: 'scatter', name: 'Bonus', type: 'scatter', image: ph('BONUS', '#f1c40f'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(w, 3000 + i)),
    freeSpinReels: [1, 2, 3, 4, 5].map((i) => buildStrip(fsw, 3100 + i)),
    rules: {
      lines: 20, freeSpins: { 3: 10, 4: 12, 5: 15 }, retrigger: 5, maxFreeSpins: 50,
      fsMultiplier: 3, buyCost: 100, maxWin: 5000,
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Tesoro del Dragón', background: null, backgroundColor: '#2b0f0f',
      palette: { primary: '#c0392b', accent: '#f1c40f', panel: '#1a0707', text: '#ffffff', reelBg: '#3d1515' },
      font: 'Cinzel Decorative',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null },
    rtpTarget: 0.96,
  };
}
