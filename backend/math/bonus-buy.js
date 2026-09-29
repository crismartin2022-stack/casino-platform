// Motor 3 — BONUS BUY: 5x3, 20 líneas. 3+ scatters = giros gratis con multiplicador fijo.
// El jugador puede COMPRAR los giros gratis pagando rules.buyCost × apuesta.
import {
  symbolMap, spinStrips, evaluateLines, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip, round6, linesFor, maxLines,
  weightedPick,
} from './common.js';

export const id = 'bonus-buy';
export const name = 'Bonus Buy';
export const description = 'Líneas con giros gratis multiplicados y MENÚ DE COMPRA: giros gratis, giros gratis con wilds fijos, ruleta de la fortuna y "elige un premio".';

/**
 * Menú de bonos (rules.bonusMenu), cada uno con su precio en múltiplos de la apuesta:
 *   buy         → giros gratis normales (rules.buyCost)
 *   buy-sticky  → giros gratis donde cada comodín queda fijo (bonusMenu.sticky.cost)
 *   buy-wheel   → ruleta de la fortuna: N giros, el multiplicador sube +step cada giro (bonusMenu.wheel)
 *   buy-pick    → "elige un premio": se revelan N premios de M casillas (bonusMenu.pick)
 */
export const modes = ['base', 'buy', 'buy-sticky', 'buy-wheel', 'buy-pick'];
export const MENU_MODES = { 'buy-sticky': 'sticky', 'buy-wheel': 'wheel', 'buy-pick': 'pick' };

export function buyModes(config) {
  const out = [{ mode: 'buy', get: (c) => c.rules.buyCost, set: (c, v) => { c.rules.buyCost = v; } }];
  for (const [mode, key] of Object.entries(MENU_MODES)) {
    if (config.rules.bonusMenu?.[key]?.enabled) {
      out.push({ mode, get: (c) => c.rules.bonusMenu[key].cost, set: (c, v) => { c.rules.bonusMenu[key].cost = v; } });
    }
  }
  return out;
}

function stickyFreeSpins(config, rng, syms, awarded) {
  const R = config.rules;
  const strips = config.freeSpinReels || config.reels;
  const wildId = config.symbols.find((s) => s.type === 'wild')?.id;
  const lines = linesFor(config.grid.reels, config.grid.rows, R.lines);
  const mult = R.bonusMenu?.sticky?.multiplier ?? R.fsMultiplier;
  const fs = { awarded, multiplier: mult, sticky: true, spins: [] };
  let held = new Set();
  let left = awarded;
  while (left > 0 && fs.spins.length < R.maxFreeSpins) {
    left--;
    const { stops, grid } = spinStrips(rng, strips, config.grid.rows);
    grid.forEach((col, c) => col.forEach((sid, r) => { if (sid === wildId) held.add(`${c},${r}`); }));
    for (const k of held) { const [c, r] = k.split(',').map(Number); grid[c][r] = wildId; }
    const wins = evaluateLines(grid, lines, syms);
    const scatters = findSymbols(grid, (x) => syms.get(x)?.type === 'scatter');
    if (scatters.length >= 3) left += R.retrigger;
    fs.spins.push({ stops, grid, wins, scatters, held: [...held], win: round6(sumPays(wins) * mult) });
  }
  fs.totalWin = round6(fs.spins.reduce((a, x) => a + x.win, 0));
  return fs;
}

function wheelBonus(config, rng) {
  const W = config.rules.bonusMenu.wheel;
  const spins = [];
  let mult = 1, total = 0;
  for (let i = 0; i < W.spins; i++) {
    const idx = pickIndex(rng, W.segments);
    const seg = W.segments[idx];
    const win = round6(seg.value * mult);
    spins.push({ segment: idx, value: seg.value, multiplier: mult, win });
    total += win;
    mult = round6(mult + W.multStep);
  }
  return { type: 'wheel', segments: W.segments.map((x) => x.value), spins, totalWin: round6(total) };
}

function pickBonus(config, rng) {
  const P = config.rules.bonusMenu.pick;
  // Las casillas ya tienen su premio antes de elegir: el jugador solo decide el orden en que se revelan.
  const tiles = Array.from({ length: P.tiles }, () => weightedPick(rng, P.prizes).value);
  const picked = [];
  const pool = tiles.map((_, i) => i);
  for (let i = 0; i < P.picks; i++) picked.push(pool.splice(rng.int(pool.length), 1)[0]);
  const values = picked.map((i) => tiles[i]);
  return { type: 'pick', tiles, picked, values, totalWin: round6(values.reduce((a, v) => a + v, 0)) };
}

function pickIndex(rng, items) {
  let total = 0;
  for (const it of items) total += it.weight;
  let r = rng.int(total);
  for (let i = 0; i < items.length; i++) { r -= items[i].weight; if (r < 0) return i; }
  return items.length - 1;
}

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
  if (MENU_MODES[mode]) {
    const key = MENU_MODES[mode];
    const opt = R.bonusMenu?.[key];
    if (!opt?.enabled) throw Object.assign(new Error('Ese bono no está disponible en este juego'), { status: 400 });
    let freeSpins = null, bonus = null;
    if (key === 'sticky') freeSpins = stickyFreeSpins(config, rng, syms, opt.freeSpins || R.freeSpins['3']);
    else if (key === 'wheel') bonus = wheelBonus(config, rng);
    else bonus = pickBonus(config, rng);
    const { total, capped } = capWin((freeSpins || bonus).totalWin, config);
    return { engine: id, mode, cost: opt.cost, base: null, freeSpins, bonus, totalWin: total, capped };
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
  if (mode === 'buy') return config.rules.buyCost;
  if (MENU_MODES[mode]) return config.rules.bonusMenu?.[MENU_MODES[mode]]?.cost ?? 1;
  return 1;
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
  const M = R.bonusMenu || {};
  for (const [key, opt] of Object.entries(M)) {
    if (!opt?.enabled) continue;
    if (!(opt.cost >= 5)) errors.push(`bonusMenu.${key}.cost debe ser >= 5`);
    if (key === 'sticky' && !config.symbols?.some((s) => s.type === 'wild')) errors.push('El bono de wilds fijos necesita un comodín');
    if (key === 'wheel' && (!Array.isArray(opt.segments) || opt.segments.length < 3 || !(opt.spins >= 1))) errors.push('bonusMenu.wheel necesita segments (3+) y spins');
    if (key === 'pick' && (!Array.isArray(opt.prizes) || !opt.prizes.length || !(opt.picks >= 1) || !(opt.tiles > opt.picks))) errors.push('bonusMenu.pick necesita prizes, picks y tiles > picks');
  }
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
      bonusMenu: {
        sticky: { enabled: true, name: 'Giros gratis con wilds fijos', cost: 150, freeSpins: 10, multiplier: 1 },
        wheel: {
          enabled: true, name: 'Ruleta de la fortuna', cost: 80, spins: 3, multStep: 0.5,
          segments: [{ value: 5, weight: 30 }, { value: 10, weight: 25 }, { value: 15, weight: 18 }, { value: 25, weight: 12 },
            { value: 40, weight: 8 }, { value: 75, weight: 4 }, { value: 150, weight: 2 }, { value: 500, weight: 1 }],
        },
        pick: {
          enabled: true, name: 'Elige un premio', cost: 60, picks: 5, tiles: 12,
          prizes: [{ value: 2, weight: 30 }, { value: 5, weight: 28 }, { value: 10, weight: 20 }, { value: 20, weight: 12 },
            { value: 50, weight: 6 }, { value: 100, weight: 3 }, { value: 250, weight: 1 }],
        },
      },
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
