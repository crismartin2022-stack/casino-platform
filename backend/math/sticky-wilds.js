// Motor 9 — STICKY / WALKING WILDS: 5x3, 9 líneas. rules.wildMode:
//  "sticky"  → en giros gratis, cada comodín que cae queda FIJO hasta el final del bono.
//  "walking" → cada comodín da un RE-GIRO gratis y se mueve un rodillo a la izquierda hasta salir;
//              en giros gratis también caminan (sin re-giros extra).
// 3+ scatters = giros gratis (con multiplicador opcional).
import {
  symbolMap, spinStrips, evaluateLines, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip,
  round6, linesFor, maxLines, tierPay,
} from './common.js';

export const id = 'sticky-wilds';
export const name = 'Sticky / Walking Wilds';
export const description = 'Comodines que quedan fijos durante los giros gratis o que caminan un rodillo por giro dando re-giros.';
export const paysBy = 'lines';

function spinWith(config, rng, syms, strips, overlay) {
  const { reels, rows } = config.grid;
  const lines = linesFor(reels, rows, config.rules.lines);
  const wildId = config.symbols.find((s) => s.type === 'wild').id;
  const { stops, grid } = spinStrips(rng, strips, rows);
  const landed = findSymbols(grid, (sid) => sid === wildId).map(([c, r]) => `${c},${r}`);
  for (const key of overlay) {
    const [c, r] = key.split(',').map(Number);
    if (c >= 0 && c < reels) grid[c][r] = wildId;
  }
  const wins = evaluateLines(grid, lines, syms);
  const scatters = findSymbols(grid, (sid) => syms.get(sid)?.type === 'scatter');
  return { stops, grid, wins, scatters, landed, overlay: [...overlay], win: sumPays(wins) };
}

const walk = (set) => new Set([...set].map((k) => { const [c, r] = k.split(',').map(Number); return `${c - 1},${r}`; }).filter((k) => !k.startsWith('-')));

export function play(config, rng) {
  const syms = symbolMap(config);
  const R = config.rules;
  const mode = R.wildMode === 'walking' ? 'walking' : 'sticky';
  const scatterSym = config.symbols.find((s) => s.type === 'scatter');
  const base = spinWith(config, rng, syms, config.reels, new Set());
  let total = base.win;

  // Walking: re-giros mientras haya comodines en pantalla
  const respins = [];
  if (mode === 'walking') {
    let walkers = walk(new Set(base.landed));
    while (walkers.size && respins.length < 30) {
      const s = spinWith(config, rng, syms, config.reels, walkers);
      respins.push(s);
      total += s.win;
      walkers = walk(new Set([...walkers, ...s.landed]));
    }
  }

  const allScatters = [base, ...respins].reduce((m, s) => Math.max(m, s.scatters.length), 0);
  const scatterPay = tierPay(scatterSym?.scatterPays || {}, allScatters);
  total += scatterPay;

  let freeSpins = null;
  if (allScatters >= R.scattersToTrigger) {
    freeSpins = { awarded: R.freeSpins, mode, multiplier: R.fsMultiplier, spins: [] };
    let left = R.freeSpins;
    let held = new Set();
    const strips = config.freeSpinReels || config.reels;
    while (left > 0 && freeSpins.spins.length < R.maxFreeSpins) {
      left--;
      const s = spinWith(config, rng, syms, strips, held);
      const win = round6(s.win * R.fsMultiplier);
      if (mode === 'sticky') held = new Set([...held, ...s.landed]);
      else held = walk(new Set([...held, ...s.landed]));
      if (s.scatters.length >= R.scattersToTrigger) left += R.retrigger;
      freeSpins.spins.push({ ...s, win, held: [...held] });
    }
    freeSpins.totalWin = round6(freeSpins.spins.reduce((a, s) => a + s.win, 0));
    total += freeSpins.totalWin;
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, mode, base, respins, scatterPay, freeSpins, totalWin: capped, capped: wasCapped };
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config)];
  const R = config.rules || {};
  const g = config.grid || {};
  const maxL = g.reels ? maxLines(g.reels, g.rows) : 20;
  if (!Number.isInteger(R.lines) || R.lines < 1 || R.lines > maxL) errors.push(`rules.lines debe estar entre 1 y ${maxL}`);
  if (!['sticky', 'walking'].includes(R.wildMode)) errors.push('rules.wildMode debe ser "sticky" o "walking"');
  if (!config.symbols?.some((s) => s.type === 'wild')) errors.push('Se necesita un símbolo comodín');
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Se necesita un símbolo scatter');
  if (!(R.fsMultiplier >= 1)) errors.push('rules.fsMultiplier debe ser >= 1');
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) {
    for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
    for (const key of Object.keys(s.scatterPays || {})) s.scatterPays[key] = round6(s.scatterPays[key] * k);
  }
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { ten: 10, jack: 10, queen: 9, king: 9, ace: 8, boots: 6, hat: 5, pistol: 4, badge: 3, wild: 2, scatter: 2 };
  return {
    engine: id,
    name: 'Forajidos del Oeste',
    grid: { reels: 5, rows: 3 },
    symbols: [
      { id: 'ten', name: '10', type: 'regular', image: ph('10', '#2980b9'), pays: { 3: 5, 4: 10, 5: 25 } },
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#27ae60'), pays: { 3: 5, 4: 10, 5: 25 } },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#16a085'), pays: { 3: 5, 4: 15, 5: 30 } },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#d35400'), pays: { 3: 10, 4: 20, 5: 40 } },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#c0392b'), pays: { 3: 10, 4: 25, 5: 50 } },
      { id: 'boots', name: 'Botas', type: 'regular', image: ph('👢', '#8e5b3a'), pays: { 3: 15, 4: 40, 5: 100 } },
      { id: 'hat', name: 'Sombrero', type: 'regular', image: ph('🤠', '#a0522d'), pays: { 3: 20, 4: 60, 5: 150 } },
      { id: 'pistol', name: 'Revólver', type: 'regular', image: ph('🔫', '#7f8c8d'), pays: { 3: 30, 4: 100, 5: 300 } },
      { id: 'badge', name: 'Estrella de sheriff', type: 'regular', image: ph('⭐', '#f1c40f'), pays: { 3: 50, 4: 200, 5: 1000 } },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e74c3c'), pays: {} },
      { id: 'scatter', name: 'Cartel de "Se busca"', type: 'scatter', image: ph('$', '#f39c12'), pays: {}, scatterPays: { 3: 2, 4: 10, 5: 50 } },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(w, 9000 + i)),
    rules: { lines: 9, wildMode: 'sticky', scattersToTrigger: 3, freeSpins: 12, retrigger: 5, maxFreeSpins: 60, fsMultiplier: 2, maxWin: 5000 },
    bet: { levels: [9, 18, 45, 90, 180, 450, 900, 1800], default: 90, currency: 'USD' },
    theme: {
      title: 'Forajidos del Oeste', background: null, backgroundColor: '#2b1b0e',
      palette: { primary: '#d35400', accent: '#f6c667', panel: '#1b1008', text: '#ffffff', reelBg: '#3e2615' },
      font: 'Rye',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null },
    rtpTarget: 0.96,
  };
}
