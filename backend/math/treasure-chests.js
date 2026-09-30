// Motor 12 — COFRES: 5x4, pagos por FILA: 3, 4 o 5 símbolos iguales en la misma fila, en cualquier posición.
// 3 o más cofres en pantalla abren el BONUS DE COFRES: el jugador elige uno de 3 cofres, que revela un
// multiplicador (decidido por el servidor), y juega giros gratis con todos los premios multiplicados.
// En los giros gratis, 3+ cofres suman giros. El bono también se puede comprar.
import { symbolMap, spinStrips, findSymbols, capWin, validateCommon, validateGrid, buildStrip, round6, weightedPick } from './common.js';

export const id = 'treasure-chests';
export const name = 'Cofres (pagos por fila)';
export const description = '5x4 con premios por fila (3, 4 o 5 iguales en cualquier posición); 3+ cofres abren la elección de cofre con multiplicador y giros gratis.';
export const paysBy = 'rows';
export const modes = ['base', 'buy'];
export const gridLimits = { reels: [5, 6], rows: [3, 5] };

/** Premios por fila: cada símbolo normal que aparece 3+ veces en una fila paga según la tabla (múltiplos de la apuesta total). */
export function evaluateRows(grid, syms) {
  const wins = [];
  const rows = grid[0].length;
  for (let r = 0; r < rows; r++) {
    const count = new Map();
    for (let c = 0; c < grid.length; c++) {
      const id = grid[c][r];
      const t = syms.get(id)?.type || 'regular';
      if (t !== 'regular') continue;
      count.set(id, (count.get(id) || 0) + 1);
    }
    for (const [sym, n] of count) {
      const pays = syms.get(sym)?.pays || {};
      // Si hay más iguales que la tabla (p. ej. 6 rodillos), paga el nivel más alto definido
      const k = Math.min(n, Math.max(...Object.keys(pays).map(Number), 0));
      const p = n >= 3 ? pays[String(k)] || 0 : 0;
      if (p > 0) {
        const positions = [];
        for (let c = 0; c < grid.length; c++) if (grid[c][r] === sym) positions.push([c, r]);
        wins.push({ symbol: sym, row: r, count: n, pay: round6(p), positions });
      }
    }
  }
  return wins;
}

function spinOnce(config, rng, syms, strips, mult = 1) {
  const { stops, grid } = spinStrips(rng, strips, config.grid.rows);
  const raw = evaluateRows(grid, syms);
  const wins = mult > 1 ? raw.map((w) => ({ ...w, pay: round6(w.pay * mult) })) : raw;
  const chests = findSymbols(grid, (s) => syms.get(s)?.type === 'scatter');
  return { stops, grid, wins, chests, win: round6(wins.reduce((a, w) => a + w.pay, 0)) };
}

/** Elección de cofre: el premio lo decide el servidor; los otros cofres muestran premios posibles distintos. */
function chestBonus(config, rng) {
  const R = config.rules;
  const prize = weightedPick(rng, R.chestPrizes);
  const pool = R.chestPrizes.filter((p) => p !== prize);
  const others = [];
  for (let i = 0; i < Math.max(0, (R.chests || 3) - 1) && pool.length; i++) others.push(pool.splice(rng.int(pool.length), 1)[0].mult);
  return { mult: prize.mult, spins: prize.spins ?? R.freeSpins, others };
}

export function play(config, rng, { mode = 'base' } = {}) {
  const syms = symbolMap(config);
  const R = config.rules;
  let base = null;
  let total = 0;
  if (mode !== 'buy') {
    base = spinOnce(config, rng, syms, config.reels);
    total = base.win;
  }
  let chest = null, freeSpins = null;
  if (mode === 'buy' || base.chests.length >= R.triggerCount) {
    chest = chestBonus(config, rng);
    freeSpins = { awarded: chest.spins, multiplier: chest.mult, spins: [] };
    let left = chest.spins;
    const strips = config.freeSpinReels || config.reels;
    while (left > 0 && freeSpins.spins.length < (R.maxFreeSpins || 50)) {
      left--;
      const s = spinOnce(config, rng, syms, strips, chest.mult);
      if (s.chests.length >= R.triggerCount) { left += R.retrigger; s.retrigger = R.retrigger; }
      freeSpins.spins.push(s);
      total += s.win;
    }
    freeSpins.totalWin = round6(freeSpins.spins.reduce((a, s) => a + s.win, 0));
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, base, chest, freeSpins, totalWin: capped, capped: wasCapped };
}

export function costMultiplier(config, mode) { return mode === 'buy' ? config.rules.buyCost : 1; }

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config, gridLimits)];
  const R = config.rules || {};
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Cofres necesita un símbolo de tipo "scatter" (el cofre)');
  if (config.symbols?.some((s) => s.type === 'wild')) errors.push('Cofres no usa comodines (los premios son por fila)');
  if (!(R.triggerCount >= 2 && R.triggerCount <= 6)) errors.push('rules.triggerCount (cofres para el bonus) debe estar entre 2 y 6');
  if (!(R.freeSpins >= 1 && R.freeSpins <= 50)) errors.push('rules.freeSpins debe estar entre 1 y 50');
  if (!(R.retrigger >= 0 && R.retrigger <= 20)) errors.push('rules.retrigger debe estar entre 0 y 20');
  if (!Array.isArray(R.chestPrizes) || R.chestPrizes.length < 2) errors.push('rules.chestPrizes necesita al menos 2 premios [{mult, weight}]');
  for (const p of R.chestPrizes || []) {
    if (!(p.mult >= 1 && p.mult <= 100) || !(p.weight > 0)) errors.push('Cada premio de cofre necesita mult entre 1 y 100 y weight > 0');
    if (p.spins != null && !(p.spins >= 1 && p.spins <= 50)) errors.push('spins de un premio de cofre debe estar entre 1 y 50');
  }
  if (!(R.chests >= 2 && R.chests <= 6)) errors.push('rules.chests (cofres para elegir) debe estar entre 2 y 6');
  if (!(R.buyCost >= 5)) errors.push('rules.buyCost (precio de compra) debe ser al menos 5');
  for (const s of config.symbols || []) {
    if ((s.type || 'regular') === 'regular' && !Object.keys(s.pays || {}).some((k) => Number(k) >= 3)) errors.push(`El símbolo ${s.id} necesita pagos para 3, 4 o 5 iguales en fila`);
  }
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { ten: 13, jack: 12, queen: 11, king: 10, ace: 9, gem: 6, rose: 5, goblet: 4, crown: 3, chest: 2 };
  const fsw = { ...w, chest: 2 };
  return {
    engine: id,
    name: 'Cofres de la Corona',
    grid: { reels: 5, rows: 4 },
    symbols: [
      { id: 'ten', name: '10', type: 'regular', image: ph('10', '#8e5a2b'), pays: { 3: 0.1, 4: 0.3, 5: 1 } },
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#9b6a2f'), pays: { 3: 0.1, 4: 0.3, 5: 1 } },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#a8783a'), pays: { 3: 0.15, 4: 0.4, 5: 1.2 } },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#b5863f'), pays: { 3: 0.2, 4: 0.5, 5: 1.5 } },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#c49a48'), pays: { 3: 0.25, 4: 0.6, 5: 2 } },
      { id: 'gem', name: 'Diamante', type: 'regular', image: ph('💎', '#2e86de'), pays: { 3: 0.5, 4: 1.5, 5: 5 } },
      { id: 'rose', name: 'Rosa', type: 'regular', image: ph('🌹', '#c0392b'), pays: { 3: 0.8, 4: 2.5, 5: 8 } },
      { id: 'goblet', name: 'Copa', type: 'regular', image: ph('🍷', '#8e44ad'), pays: { 3: 1.2, 4: 4, 5: 15 } },
      { id: 'crown', name: 'Corona', type: 'regular', image: ph('👑', '#d4af37'), pays: { 3: 2, 4: 8, 5: 40 } },
      { id: 'chest', name: 'Cofre', type: 'scatter', image: ph('🎁', '#b8860b'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(w, 12000 + i)),
    freeSpinReels: [1, 2, 3, 4, 5].map((i) => buildStrip(fsw, 12100 + i)),
    rules: {
      triggerCount: 3, freeSpins: 8, retrigger: 3, maxFreeSpins: 50, chests: 3,
      chestPrizes: [{ mult: 1, weight: 60 }, { mult: 2, weight: 30 }, { mult: 3, weight: 10 }],
      buyCost: 60, maxWin: 5000,
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Cofres de la Corona', background: null, backgroundColor: '#1a0b0b',
      palette: { primary: '#b8860b', accent: '#d4af37', panel: '#2d1515', text: '#ffffff', reelBg: '#3a1c1c' },
      font: 'Cinzel Decorative',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, coin: null },
    rtpTarget: 0.96,
  };
}
