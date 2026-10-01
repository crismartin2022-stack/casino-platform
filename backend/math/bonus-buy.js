// Motor 3 — BONUS BUY: 5x3, 20 líneas. 3+ scatters = giros gratis con multiplicador fijo.
// El jugador puede COMPRAR los giros gratis pagando rules.buyCost × apuesta.
import {
  symbolMap, spinStrips, evaluateLines, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip, round6, linesFor, maxLines,
  weightedPick,
} from './common.js';

export const id = 'bonus-buy';
export const name = 'Bonus Buy';
export const description = 'Líneas con giros gratis ×2 y wilds fijos al azar, BONUS SORPRESA y MENÚ DE COMPRA: giros gratis, ruleta, elige un premio, colecciona y el camino.';

/**
 * Menú de bonos (rules.bonusMenu), cada uno con su precio en múltiplos de la apuesta:
 *   buy         → giros gratis normales (rules.buyCost)
 *   buy-sticky  → giros gratis donde cada comodín queda fijo (bonusMenu.sticky.cost)
 *   buy-wheel   → ruleta de la fortuna: N giros, el multiplicador sube +step cada giro (bonusMenu.wheel)
 *   buy-pick    → "elige un premio": se revelan N premios de M casillas (bonusMenu.pick); 1 de cada 3 casillas "bonus" vale ×2
 *   buy-collect → "collect": se revelan todos los objetos: moneda ×1, gema ×2, cofre ×3 (bonusMenu.collect)
 *   buy-path    → "camino": se avanza 1-5 casillas por tirada hasta el final; cada casilla paga su valor × un
 *                 multiplicador que sube en cada paso (bonusMenu.path)
 * Además, cada giro normal puede activar un BONO SORPRESA al azar (rules.randomBonusChance, como el diseño original: 5 %).
 */
export const modes = ['base', 'buy', 'buy-sticky', 'buy-wheel', 'buy-pick', 'buy-collect', 'buy-path'];
export const MENU_MODES = { 'buy-sticky': 'sticky', 'buy-wheel': 'wheel', 'buy-pick': 'pick', 'buy-collect': 'collect', 'buy-path': 'path' };

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

const WHEEL_COLORS = ['red', 'black', 'green'];
const WHEEL_TYPES = ['normal', 'bonus', 'multiplier'];
/** Valor al azar entre min y max (en pasos de 0,1 × la apuesta). */
const randRange = (rng, min, max) => round6(min + rng.int(Math.round((max - min) * 10) + 1) / 10);

function wheelBonus(config, rng) {
  const W = config.rules.bonusMenu.wheel;
  // Diseño original: 8 segmentos con valor, color y tipo al azar; cada giro cae en uno con la misma probabilidad
  const randomSegs = !Array.isArray(W.segments) || !W.segments.length;
  const segs = randomSegs
    ? Array.from({ length: W.segmentsCount || 8 }, () => ({ value: randRange(rng, W.valueMin, W.valueMax), color: WHEEL_COLORS[rng.int(3)], type: WHEEL_TYPES[rng.int(3)] }))
    : W.segments;
  const spins = [];
  let mult = 1, total = 0;
  for (let i = 0; i < W.spins; i++) {
    const idx = randomSegs ? rng.int(segs.length) : pickIndex(rng, segs);
    const seg = segs[idx];
    const win = round6(seg.value * mult);
    spins.push({ segment: idx, value: seg.value, multiplier: mult, win });
    total += win;
    mult = round6(mult + W.multStep);
  }
  return { type: 'wheel', segments: segs.map((x) => x.value), segmentsInfo: segs.map((x) => ({ value: x.value, color: x.color || null, type: x.type || null })), spins, totalWin: round6(total) };
}

function pickBonus(config, rng) {
  const P = config.rules.bonusMenu.pick;
  // Las casillas ya tienen su premio antes de elegir: el jugador solo decide el orden en que se revelan.
  // Diseño original: valores al azar entre valueMin y valueMax, y 1 de cada 3 casillas es "bonus" (vale ×bonusMult).
  if (!Array.isArray(P.prizes) || !P.prizes.length) {
    const kinds = Array.from({ length: P.tiles }, () => (rng.int(1_000_000) < (P.bonusChance ?? 1 / 3) * 1_000_000 ? 'bonus' : 'normal'));
    const tiles = kinds.map((k) => round6(randRange(rng, P.valueMin, P.valueMax) * (k === 'bonus' ? (P.bonusMult ?? 2) : 1)));
    const picked = [];
    const pool = tiles.map((_, i) => i);
    for (let i = 0; i < P.picks; i++) picked.push(pool.splice(rng.int(pool.length), 1)[0]);
    const values = picked.map((i) => tiles[i]);
    return { type: 'pick', tiles, kinds, picked, values, totalWin: round6(values.reduce((a, v) => a + v, 0)) };
  }
  const tiles = Array.from({ length: P.tiles }, () => weightedPick(rng, P.prizes).value);
  const picked = [];
  const pool = tiles.map((_, i) => i);
  for (let i = 0; i < P.picks; i++) picked.push(pool.splice(rng.int(pool.length), 1)[0]);
  const values = picked.map((i) => tiles[i]);
  return { type: 'pick', tiles, picked, values, totalWin: round6(values.reduce((a, v) => a + v, 0)) };
}

/** Collect: se revelan todos los objetos; moneda ×1, gema ×2, cofre ×3 (diseño original). */
function collectBonus(config, rng) {
  const C = config.rules.bonusMenu.collect;
  const types = C.types?.length ? C.types : [{ type: 'coin', mult: 1 }, { type: 'gem', mult: 2 }, { type: 'chest', mult: 3 }];
  const items = Array.from({ length: C.items || 20 }, () => {
    const t = types[rng.int(types.length)];
    const value = randRange(rng, C.valueMin, C.valueMax);
    return { type: t.type, mult: t.mult, value, win: round6(value * t.mult) };
  });
  return { type: 'collect', items, totalWin: round6(items.reduce((a, x) => a + x.win, 0)) };
}

/** Camino: tiradas de 1 a 5 casillas hasta el final; cada casilla paga (posición+1)×valueStep × un multiplicador que sube. */
function pathBonus(config, rng) {
  const P = config.rules.bonusMenu.path;
  const len = P.length || 15;
  const squares = Array.from({ length: len }, (_, i) => ({ value: round6((i + 1) * P.valueStep), bonus: i % 3 === 0 }));
  const moves = [];
  let pos = -1, mult = 1, total = 0;
  while (pos < len - 1 && moves.length < 100) {
    const steps = (P.stepMin ?? 1) + rng.int((P.stepMax ?? 5) - (P.stepMin ?? 1) + 1);
    pos = Math.min(len - 1, pos + steps);
    const win = round6(squares[pos].value * mult);
    moves.push({ steps, position: pos, value: squares[pos].value, multiplier: mult, win });
    total += win;
    mult = round6(mult + (P.multStep ?? 0.2));
  }
  return { type: 'path', squares, moves, totalWin: round6(total) };
}

const BONUS_FNS = { wheel: wheelBonus, pick: pickBonus, collect: collectBonus, path: pathBonus };

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

/**
 * Giros gratis. Como el diseño original (si están configurados): rules.fsStickyRandom comodines PEGAJOSOS en
 * posiciones al azar durante todo el bono, y en cada giro rules.fsExtraChance de sumar rules.fsExtraSpins giros.
 */
function freeSpinsRound(config, rng, syms, awarded) {
  const R = config.rules;
  const strips = config.freeSpinReels || config.reels;
  const { reels: RC, rows: RR } = config.grid;
  const wildId = config.symbols.find((x) => x.type === 'wild')?.id;
  const held = [];
  if (R.fsStickyRandom > 0 && wildId) {
    const cells = [];
    for (let c = 0; c < RC; c++) for (let r = 0; r < RR; r++) cells.push(`${c},${r}`);
    for (let i = 0; i < Math.min(R.fsStickyRandom, cells.length); i++) held.push(cells.splice(rng.int(cells.length), 1)[0]);
  }
  const fs = { awarded, multiplier: R.fsMultiplier, spins: [], ...(held.length ? { sticky: true } : {}) };
  let left = awarded, extras = 0;
  const lines = linesFor(RC, RR, R.lines);
  while (left > 0 && fs.spins.length < R.maxFreeSpins) {
    left--;
    let s;
    if (held.length) {
      const { stops, grid } = spinStrips(rng, strips, RR);
      for (const k of held) { const [c, r] = k.split(',').map(Number); grid[c][r] = wildId; }
      const wins = evaluateLines(grid, lines, syms);
      s = { stops, grid, wins, scatters: findSymbols(grid, (x) => syms.get(x)?.type === 'scatter'), held: [...held], win: sumPays(wins) };
    } else s = lineSpin(config, rng, syms, strips);
    const win = round6(s.win * R.fsMultiplier);
    if (s.scatters.length >= 3) left += R.retrigger;
    // Giros extra al azar, como mucho rules.fsExtraMax veces por bonus (0 = sin límite)
    if (R.fsExtraChance > 0 && !(R.fsExtraMax > 0 && extras >= R.fsExtraMax) && rng.int(1_000_000) < R.fsExtraChance * 1_000_000) { extras++; left += R.fsExtraSpins || 5; s.extra = R.fsExtraSpins || 5; }
    fs.spins.push({ ...s, win });
  }
  fs.totalWin = round6(fs.spins.reduce((a, x) => a + x.win, 0));
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
    else bonus = BONUS_FNS[key](config, rng);
    const { total, capped } = capWin((freeSpins || bonus).totalWin, config);
    return { engine: id, mode, cost: opt.cost, base: null, freeSpins, bonus, totalWin: total, capped };
  }
  const base = lineSpin(config, rng, syms, config.reels);
  let total = base.win;
  let freeSpins = null;
  const n = Math.min(base.scatters.length, 5);
  let bonus = null, surprise = null;
  if (n >= 3) {
    freeSpins = freeSpinsRound(config, rng, syms, R.freeSpins[String(n)]);
    total += freeSpins.totalWin;
  } else if (R.randomBonusChance > 0 && rng.int(1_000_000) < R.randomBonusChance * 1_000_000) {
    // BONO SORPRESA (diseño original): uno de los bonos habilitados, gratis
    const pool = (R.randomBonuses || ['free', 'pick', 'wheel', 'collect', 'path'])
      .filter((k) => k === 'free' || (R.bonusMenu?.[k]?.enabled && BONUS_FNS[k]));
    if (pool.length) {
      surprise = pool[rng.int(pool.length)];
      if (surprise === 'free') { freeSpins = freeSpinsRound(config, rng, syms, R.freeSpins['3']); total += freeSpins.totalWin; }
      else { bonus = BONUS_FNS[surprise](config, rng); total += bonus.totalWin; }
    }
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, mode, cost: 1, base, freeSpins, ...(bonus ? { bonus } : {}), ...(surprise ? { surprise } : {}), totalWin: capped, capped: wasCapped };
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
  if (!(R.buyCost >= 5)) errors.push('rules.buyCost debe ser >= 5 (múltiplo de la apuesta)');
  if (R.randomBonusChance != null && !(R.randomBonusChance >= 0 && R.randomBonusChance <= 0.25)) errors.push('rules.randomBonusChance (bono sorpresa) debe estar entre 0 y 0,25');
  if (R.fsExtraChance != null && !(R.fsExtraChance >= 0 && R.fsExtraChance <= 0.5)) errors.push('rules.fsExtraChance debe estar entre 0 y 0,5');
  if (R.fsExtraMax != null && !(Number.isInteger(R.fsExtraMax) && R.fsExtraMax >= 0 && R.fsExtraMax <= 20)) errors.push('rules.fsExtraMax (veces que se pueden ganar giros extra) debe ser un entero entre 0 (sin límite) y 20');
  if (R.fsExtraChance > 0 && !(R.fsExtraMax > 0) && R.fsExtraChance * (R.fsExtraSpins || 5) >= 1) errors.push('Con giros extra sin límite (fsExtraMax 0), fsExtraChance × fsExtraSpins debe ser menor que 1: si no, el bonus no termina nunca');
  if (R.fsStickyRandom != null && !(Number.isInteger(R.fsStickyRandom) && R.fsStickyRandom >= 0 && R.fsStickyRandom <= 8)) errors.push('rules.fsStickyRandom (wilds pegajosos) debe ser un entero de 0 a 8');
  if (!(R.fsMultiplier >= 1)) errors.push('rules.fsMultiplier debe ser >= 1');
  if (!R.freeSpins?.['3']) errors.push('rules.freeSpins debe definir al menos "3"');
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Bonus Buy necesita un símbolo scatter');
  const M = R.bonusMenu || {};
  for (const [key, opt] of Object.entries(M)) {
    if (!opt?.enabled) continue;
    if (!(opt.cost >= 1)) errors.push(`bonusMenu.${key}.cost debe ser >= 1`);
    if (key === 'sticky' && !config.symbols?.some((s) => s.type === 'wild')) errors.push('El bono de wilds fijos necesita un comodín');
    const range = (o) => o.valueMin > 0 && o.valueMax >= o.valueMin;
    if (key === 'wheel' && !(opt.spins >= 1)) errors.push('bonusMenu.wheel necesita spins');
    if (key === 'wheel' && !(Array.isArray(opt.segments) && opt.segments.length >= 3) && !(range(opt) && opt.segmentsCount >= 3)) errors.push('bonusMenu.wheel necesita segments (3+) o valueMin/valueMax y segmentsCount (3+)');
    if (key === 'pick' && (!(opt.picks >= 1) || !(opt.tiles > opt.picks))) errors.push('bonusMenu.pick necesita picks y tiles > picks');
    if (key === 'pick' && !(Array.isArray(opt.prizes) && opt.prizes.length) && !range(opt)) errors.push('bonusMenu.pick necesita prizes o valueMin/valueMax');
    if (key === 'collect' && (!range(opt) || !(opt.items >= 3 && opt.items <= 60))) errors.push('bonusMenu.collect necesita items (3-60) y valueMin/valueMax');
    if (key === 'path' && (!(opt.length >= 3 && opt.length <= 60) || !(opt.valueStep > 0) || !(opt.stepMin >= 1) || !(opt.stepMax >= opt.stepMin))) errors.push('bonusMenu.path necesita length (3-60), valueStep > 0 y stepMin ≤ stepMax');
  }
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
  // Con bono sorpresa, los premios de los bonos también forman parte del RTP del juego base
  if (!(config.rules.randomBonusChance > 0)) return;
  const M = config.rules.bonusMenu || {};
  for (const o of Object.values(M)) {
    if (!o) continue;
    if (o.valueMin != null) { o.valueMin = round6(o.valueMin * k); o.valueMax = round6(o.valueMax * k); }
    if (o.valueStep != null) o.valueStep = round6(o.valueStep * k);
    for (const x of o.segments || []) x.value = round6(x.value * k);
    for (const x of o.prizes || []) x.value = round6(x.value * k);
  }
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
      // Diseño original: giros gratis ×2 con 3 wilds pegajosos al azar y 20 % de +5 giros en cada giro;
      // 5 % de BONO SORPRESA en cada giro normal (uno de los 5 bonos al azar); 5 bonos para comprar.
      lines: 20, freeSpins: { 3: 10, 4: 10, 5: 10 }, retrigger: 5, maxFreeSpins: 50,
      fsMultiplier: 2, fsStickyRandom: 3, fsExtraChance: 0.2, fsExtraSpins: 5, fsExtraMax: 2,
      randomBonusChance: 0.05, randomBonuses: ['free', 'pick', 'wheel', 'collect', 'path'],
      buyCost: 100, maxWin: 5000,
      bonusMenu: {
        sticky: { enabled: false, name: 'Giros gratis con wilds fijos', cost: 150, freeSpins: 10, multiplier: 1 },
        pick: { enabled: true, name: 'Elige y gana', cost: 75, picks: 5, tiles: 12, valueMin: 1, valueMax: 10, bonusChance: 0.3333, bonusMult: 2 },
        wheel: { enabled: true, name: 'Rueda de la fortuna', cost: 150, spins: 3, multStep: 0.5, segmentsCount: 8, valueMin: 5, valueMax: 20 },
        collect: { enabled: true, name: 'Colecciona', cost: 125, items: 20, valueMin: 0.5, valueMax: 10 },
        path: { enabled: true, name: 'El camino', cost: 90, length: 15, valueStep: 1, stepMin: 1, stepMax: 5, multStep: 0.2 },
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
