// Motor 13 — CASH COLLECT: 5x3, líneas de pago + monedas con valor en dinero.
// Las monedas solas no pagan: cuando aparece un RECOLECTOR, cobra en ese mismo giro el valor de TODAS las
// monedas visibles (cada recolector las cobra de nuevo). 3+ scatters dan giros gratis: los recolectores se
// cuentan y, al llegar a cada nivel (p. ej. 4, 8 y 12), se suman giros y sube el multiplicador de las monedas.
import {
  symbolMap, spinStrips, evaluateLines, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip, round6,
  weightedPick, linesFor, maxLines,
} from './common.js';

export const id = 'cash-collect';
export const name = 'Cash Collect';
export const description = 'Monedas con valor en dinero y un recolector que las cobra todas; en los giros gratis los recolectores suben de nivel: más giros y multiplicador.';
export const paysBy = 'lines';
export const modes = ['base', 'buy'];

/** Un giro: líneas + monedas (con su valor) + recolectores que las cobran. mult = multiplicador de las monedas. */
function spinOnce(config, rng, syms, strips, mult = 1) {
  const R = config.rules;
  const { reels: RC, rows: RR } = config.grid;
  const lines = linesFor(RC, RR, R.lines);
  const { stops, grid } = spinStrips(rng, strips, RR);
  const wins = evaluateLines(grid, lines, syms);
  const coins = findSymbols(grid, (s) => syms.get(s)?.type === 'coin').map(([c, r]) => ({ c, r, value: weightedPick(rng, R.coinValues).value }));
  const collectors = findSymbols(grid, (s) => syms.get(s)?.type === 'collector');
  const scatters = findSymbols(grid, (s) => syms.get(s)?.type === 'scatter');
  const coinSum = coins.reduce((a, k) => a + k.value, 0);
  // Cada recolector cobra todas las monedas visibles
  const collectWin = collectors.length && coins.length ? round6(coinSum * collectors.length * mult) : 0;
  const lineWin = sumPays(wins);
  return { stops, grid, wins, coins, collectors, scatters, mult, collectWin, win: round6(lineWin + collectWin) };
}

export function play(config, rng, { mode = 'base' } = {}) {
  const syms = symbolMap(config);
  const R = config.rules;
  let base = null, total = 0;
  if (mode !== 'buy') {
    base = spinOnce(config, rng, syms, config.reels);
    total = base.win;
  }
  let freeSpins = null;
  if (mode === 'buy' || base.scatters.length >= R.triggerCount) {
    const awarded = mode === 'buy' ? R.freeSpins : (R.freeSpinsByCount?.[String(Math.min(base.scatters.length, 5))] ?? R.freeSpins);
    freeSpins = { awarded, spins: [], levels: [] };
    let left = awarded, collected = 0, mult = 1, level = 0;
    const strips = config.freeSpinReels || config.reels;
    while (left > 0 && freeSpins.spins.length < (R.maxFreeSpins || 60)) {
      left--;
      const s = spinOnce(config, rng, syms, strips, mult);
      // Recolectores del giro: suben de nivel (más giros y multiplicador para los giros siguientes)
      if (s.collectors.length) {
        collected += s.collectors.length;
        while (level < R.fsLevels.length && collected >= R.fsLevels[level].collect) {
          const L = R.fsLevels[level];
          left += L.spins; mult = L.mult; level++;
          s.levelUp = { level, spins: L.spins, mult: L.mult };
          freeSpins.levels.push({ spin: freeSpins.spins.length + 1, level, spins: L.spins, mult: L.mult });
        }
      }
      s.collected = collected;
      freeSpins.spins.push(s);
      total += s.win;
    }
    freeSpins.totalWin = round6(freeSpins.spins.reduce((a, s) => a + s.win, 0));
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, base, freeSpins, totalWin: capped, capped: wasCapped };
}

export function costMultiplier(config, mode) { return mode === 'buy' ? config.rules.buyCost : 1; }

export function validate(config) {
  const errors = [...validateCommon(config, { specialTypes: ['collector'] }), ...validateGrid(config)];
  const R = config.rules || {};
  const g = config.grid || {};
  const maxL = g.reels ? maxLines(g.reels, g.rows) : 20;
  if (!Number.isInteger(R.lines) || R.lines < 1 || R.lines > maxL) errors.push(`rules.lines (líneas de pago) debe estar entre 1 y ${maxL} para esta cuadrícula`);
  for (const t of ['coin', 'collector', 'scatter']) if (!config.symbols?.some((s) => s.type === t)) errors.push(`Cash Collect necesita un símbolo de tipo "${t}"`);
  if (!Array.isArray(R.coinValues) || !R.coinValues.length || R.coinValues.some((v) => !(v.value > 0) || !(v.weight > 0))) errors.push('rules.coinValues: lista de {value > 0 (veces la apuesta), weight > 0}');
  if (!(R.triggerCount >= 2 && R.triggerCount <= 6)) errors.push('rules.triggerCount (scatters para los giros gratis) debe estar entre 2 y 6');
  if (!(R.freeSpins >= 1 && R.freeSpins <= 50)) errors.push('rules.freeSpins debe estar entre 1 y 50');
  if (!Array.isArray(R.fsLevels)) errors.push('rules.fsLevels: lista de niveles [{collect, spins, mult}]');
  else R.fsLevels.forEach((L, i) => {
    if (!(L.collect >= 1) || !(L.spins >= 0) || !(L.mult >= 1)) errors.push(`rules.fsLevels[${i}]: collect ≥ 1, spins ≥ 0 y mult ≥ 1`);
    if (i && !(L.collect > R.fsLevels[i - 1].collect)) errors.push('rules.fsLevels: cada nivel debe pedir más recolectores que el anterior');
  });
  if (!(R.buyCost >= 5)) errors.push('rules.buyCost (precio de compra) debe ser al menos 5');
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
  for (const cv of config.rules.coinValues) cv.value = round6(cv.value * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  // Monedas solo en los rodillos 1-4 y recolector solo en el 5 (se puede cambiar editando las tiras)
  const w = { ten: 12, jack: 12, queen: 11, king: 10, ace: 10, boot: 6, anchor: 5, compass: 4, ship: 3, wild: 2, scatter: 2, coin: 9, collector: 0 };
  const w5 = { ...w, coin: 0, collector: 4 };
  const fs = { ...w, coin: 13, scatter: 1 };
  const fs5 = { ...fs, coin: 0, collector: 8 };
  return {
    engine: id,
    name: 'Pesca de Oro',
    grid: { reels: 5, rows: 3 },
    symbols: [
      { id: 'ten', name: '10', type: 'regular', image: ph('10', '#1f6f8b'), pays: { 3: 5, 4: 15, 5: 40 } },
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#2a7f9e'), pays: { 3: 5, 4: 15, 5: 40 } },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#328aa8'), pays: { 3: 6, 4: 20, 5: 50 } },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#3b96b3'), pays: { 3: 8, 4: 25, 5: 60 } },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#43a2be'), pays: { 3: 8, 4: 25, 5: 60 } },
      { id: 'boot', name: 'Bota', type: 'regular', image: ph('🥾', '#795548'), pays: { 3: 15, 4: 50, 5: 150 } },
      { id: 'anchor', name: 'Ancla', type: 'regular', image: ph('⚓', '#607d8b'), pays: { 3: 20, 4: 75, 5: 250 } },
      { id: 'compass', name: 'Brújula', type: 'regular', image: ph('🧭', '#c0392b'), pays: { 3: 30, 4: 100, 5: 400 } },
      { id: 'ship', name: 'Barco', type: 'regular', image: ph('⛵', '#f39c12'), pays: { 3: 50, 4: 200, 5: 1000 } },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e74c3c'), pays: {} },
      { id: 'scatter', name: 'Salvavidas', type: 'scatter', image: ph('🛟', '#ff7043'), pays: {} },
      { id: 'coin', name: 'Moneda', type: 'coin', image: ph('🪙', '#f1c40f'), pays: {} },
      { id: 'collector', name: 'Pescador', type: 'collector', image: ph('🎣', '#2ecc71'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(i === 5 ? w5 : w, 13000 + i)),
    freeSpinReels: [1, 2, 3, 4, 5].map((i) => buildStrip(i === 5 ? fs5 : fs, 13100 + i)),
    rules: {
      lines: 10, triggerCount: 3, freeSpins: 10, maxFreeSpins: 60,
      coinValues: [
        { value: 0.2, weight: 300 }, { value: 0.5, weight: 250 }, { value: 1, weight: 180 }, { value: 2, weight: 110 },
        { value: 5, weight: 60 }, { value: 10, weight: 25 }, { value: 25, weight: 8 }, { value: 50, weight: 3 },
      ],
      fsLevels: [{ collect: 4, spins: 10, mult: 2 }, { collect: 8, spins: 10, mult: 3 }, { collect: 12, spins: 10, mult: 5 }],
      buyCost: 100, maxWin: 5000,
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Pesca de Oro', background: null, backgroundColor: '#06222e',
      palette: { primary: '#1abc9c', accent: '#f1c40f', panel: '#04161e', text: '#ffffff', reelBg: '#0b3a4a' },
      font: 'Luckiest Guy',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, coin: null },
    rtpTarget: 0.96,
  };
}
