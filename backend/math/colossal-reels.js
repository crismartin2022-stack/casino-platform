// Motor 5 — COLOSSAL REELS: 5x4, 1024 formas. Aparecen símbolos gigantes (2x2 o 3x3)
// que ocupan varias celdas. 3+ scatters = giros gratis donde SIEMPRE cae un colosal.
import {
  symbolMap, spinStrips, evaluateWays, sumPays, findSymbols, capWin, validateCommon, buildStrip, round6, weightedPick,
} from './common.js';

export const id = 'colossal-reels';
export const name = 'Colossal Reels';
export const description = '5x4 con símbolos gigantes 2x2 y 3x3 renderizados en 3D; giros gratis con colosal garantizado.';

function colossalSpin(config, rng, syms, forceColossal) {
  const R = config.rules;
  const rows = config.grid.rows;
  const { stops, grid } = spinStrips(rng, config.reels, rows);
  let colossal = null;
  if (forceColossal || rng.int(1_000_000) < R.colossalChance * 1_000_000) {
    const { size } = weightedPick(rng, R.colossalSizes);
    const symbol = weightedPick(rng, R.colossalSymbols).symbol;
    // Nunca en el rodillo 1: así el colosal "completa" formas en vez de crearlas solo.
    const col = 1 + rng.int(5 - size); // 1..(5-size)
    const row = rng.int(rows - size + 1);
    for (let c = col; c < col + size; c++) for (let r = row; r < row + size; r++) grid[c][r] = symbol;
    colossal = { symbol, size, col, row };
  }
  const wins = evaluateWays(grid, syms);
  const scatters = findSymbols(grid, (s) => syms.get(s)?.type === 'scatter');
  return { stops, grid, colossal, wins, scatters, win: sumPays(wins) };
}

export function play(config, rng) {
  const syms = symbolMap(config);
  const R = config.rules;
  const base = colossalSpin(config, rng, syms, false);
  let total = base.win;
  let freeSpins = null;
  if (base.scatters.length >= 3) {
    const awarded = R.freeSpins[String(Math.min(base.scatters.length, 5))] || R.freeSpins['3'];
    freeSpins = { awarded, spins: [] };
    let left = awarded;
    while (left > 0 && freeSpins.spins.length < 50) {
      left--;
      const s = colossalSpin(config, rng, syms, true);
      if (s.scatters.length >= 3) left += R.retrigger;
      freeSpins.spins.push(s);
      total += s.win;
    }
    freeSpins.totalWin = round6(freeSpins.spins.reduce((a, s) => a + s.win, 0));
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, base, freeSpins, totalWin: capped, capped: wasCapped };
}

export function validate(config) {
  const errors = validateCommon(config, { reels: 5 });
  const R = config.rules || {};
  if (config.grid?.rows !== 4) errors.push('Colossal Reels usa 4 filas (grid.rows = 4)');
  if (!(R.colossalChance >= 0 && R.colossalChance <= 1)) errors.push('rules.colossalChance debe estar entre 0 y 1');
  if (!Array.isArray(R.colossalSizes) || R.colossalSizes.some((s) => ![2, 3].includes(s.size) || !(s.weight > 0))) {
    errors.push('rules.colossalSizes debe ser [{size: 2|3, weight > 0}]');
  }
  const ids = new Set((config.symbols || []).map((s) => s.id));
  for (const cs of R.colossalSymbols || []) if (!ids.has(cs.symbol)) errors.push(`Símbolo colosal inexistente: ${cs.symbol}`);
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Colossal Reels necesita un símbolo scatter');
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { ten: 10, jack: 10, queen: 9, king: 9, ace: 8, sword: 5, shield: 5, helmet: 4, titan: 3, wild: 2, scatter: 1 };
  return {
    engine: id,
    name: 'Titanes Colosales',
    grid: { reels: 5, rows: 4 },
    symbols: [
      { id: 'ten', name: '10', type: 'regular', image: ph('10', '#2980b9'), pays: { 3: 0.01, 4: 0.02, 5: 0.05 } },
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#27ae60'), pays: { 3: 0.01, 4: 0.02, 5: 0.05 } },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#16a085'), pays: { 3: 0.012, 4: 0.025, 5: 0.06 } },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#d35400'), pays: { 3: 0.015, 4: 0.03, 5: 0.08 } },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#c0392b'), pays: { 3: 0.015, 4: 0.03, 5: 0.08 } },
      { id: 'sword', name: 'Espada', type: 'regular', image: ph('⚔️', '#7f8c8d'), pays: { 3: 0.03, 4: 0.08, 5: 0.2 } },
      { id: 'shield', name: 'Escudo', type: 'regular', image: ph('🛡️', '#34495e'), pays: { 3: 0.03, 4: 0.08, 5: 0.2 } },
      { id: 'helmet', name: 'Yelmo', type: 'regular', image: ph('⛑️', '#b7950b'), pays: { 3: 0.05, 4: 0.15, 5: 0.4 } },
      { id: 'titan', name: 'Titán', type: 'regular', image: ph('🗿', '#6c3483'), pays: { 3: 0.1, 4: 0.3, 5: 1 } },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e74c3c'), pays: {} },
      { id: 'scatter', name: 'Rayo', type: 'scatter', image: ph('⚡', '#f1c40f'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(w, 5000 + i)),
    rules: {
      colossalChance: 0.2,
      colossalSizes: [{ size: 2, weight: 75 }, { size: 3, weight: 25 }],
      colossalSymbols: [
        { symbol: 'sword', weight: 30 }, { symbol: 'shield', weight: 30 }, { symbol: 'helmet', weight: 20 },
        { symbol: 'titan', weight: 12 }, { symbol: 'wild', weight: 8 },
      ],
      freeSpins: { 3: 8, 4: 12, 5: 20 }, retrigger: 4, maxWin: 5000,
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Titanes Colosales', background: null, backgroundColor: '#10131f',
      palette: { primary: '#8e44ad', accent: '#f1c40f', panel: '#0a0c14', text: '#ffffff', reelBg: '#1c2033' },
      font: 'Cinzel Decorative',
      render3d: true,
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null },
    rtpTarget: 0.96,
  };
}
