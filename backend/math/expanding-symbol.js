// Motor 8 — EXPANDING SYMBOL (estilo "Book"): 5x3, 10 líneas. El LIBRO es comodín y scatter a la vez.
// 3+ libros = giros gratis con un SÍMBOLO ESPECIAL elegido al azar: en cada giro gratis, si aparece
// en suficientes rodillos, se expande a todo el rodillo y paga en todas las líneas aunque no sean contiguos.
// Extras: reactivar con 3+ libros suma giros y un SEGUNDO símbolo especial (rules.secondSpecial);
// MARCOS MULTIPLICADORES (rules.frameChance/frameValues): en un giro gratis un rodillo puede traer un marco ×N que
// multiplica la expansión si ese rodillo se expande; DOBLE CHANCE (modo 'ante', rules.anteCost): cada casilla
// tiene rules.anteScatterChance de volverse libro.
import {
  symbolMap, spinStrips, evaluateLines, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip,
  round6, weightedPick, linesFor, maxLines, tierPay,
} from './common.js';

export const id = 'expanding-symbol';
export const name = 'Expanding Symbol';
export const description = 'Clásico 5x3 con libro comodín/scatter: el libro elige el símbolo que se expande; segundo especial al reactivar, marcos multiplicadores y doble chance.';
export const paysBy = 'lines';
export const modes = ['base', 'ante'];
export const costMultiplier = (config, mode) => (mode === 'ante' ? config.rules.anteCost : 1);
export const buyModes = (config) => (config.rules?.anteCost ? [{ mode: 'ante', get: (c) => c.rules.anteCost, set: (c, v) => { c.rules.anteCost = v; } }] : []);

/** Para las líneas, el libro (wildscatter) actúa como comodín. */
function lineSyms(syms) {
  const m = new Map();
  for (const [k, s] of syms) m.set(k, s.type === 'wildscatter' ? { ...s, type: 'wild' } : s);
  return m;
}

function lineSpin(config, rng, syms, lsyms, strips, ante = false) {
  const { reels, rows } = config.grid;
  const lines = linesFor(reels, rows, config.rules.lines);
  const { stops, grid } = spinStrips(rng, strips, rows);
  let anteHits = null;
  if (ante && config.rules.anteScatterChance > 0) {
    const bookId = config.symbols.find((s) => s.type === 'wildscatter').id;
    anteHits = [];
    grid.forEach((col, c) => col.forEach((sid, r) => {
      if ((syms.get(sid)?.type || 'regular') === 'regular' && rng.int(1_000_000) < config.rules.anteScatterChance * 1_000_000) { col[r] = bookId; anteHits.push([c, r]); }
    }));
  }
  const wins = evaluateLines(grid, lines, lsyms);
  const books = findSymbols(grid, (sid) => syms.get(sid)?.type === 'wildscatter');
  return { stops, grid, wins, books, win: sumPays(wins), ...(anteHits?.length ? { anteHits } : {}) };
}

/** Pago de la expansión de un símbolo especial en un giro (0 si no alcanza los rodillos mínimos). */
function expansion(s, sp, special, frame) {
  const minReels = Math.min(...Object.keys(sp.pays).map(Number));
  const reelsWith = s.grid.map((col, c) => (col.includes(special) ? c : -1)).filter((c) => c >= 0);
  if (reelsWith.length < minReels) return { expanded: [], win: 0, frameMult: 1 };
  const pay = sp.pays[String(reelsWith.length)] || 0;
  // Un marco multiplicador sobre un rodillo expandido multiplica esta expansión
  const frameMult = frame && reelsWith.includes(frame.reel) ? frame.mult : 1;
  return { expanded: reelsWith, win: round6(pay * frameMult), frameMult };
}

export function play(config, rng, { mode = 'base' } = {}) {
  const syms = symbolMap(config);
  const lsyms = lineSyms(syms);
  const R = config.rules;
  if (mode === 'ante' && !R.anteCost) throw Object.assign(new Error('Este juego no tiene doble chance'), { status: 400 });
  const book = config.symbols.find((s) => s.type === 'wildscatter');
  const base = lineSpin(config, rng, syms, lsyms, config.reels, mode === 'ante');
  const scatterPay = tierPay(book.scatterPays || {}, base.books.length);
  let total = base.win + scatterPay;
  let freeSpins = null;
  if (base.books.length >= R.scattersToTrigger) {
    const special = weightedPick(rng, R.expandWeights).symbol;
    const specials = [special];
    freeSpins = { awarded: R.freeSpins, special, spins: [] };
    let left = R.freeSpins;
    while (left > 0 && freeSpins.spins.length < R.maxFreeSpins) {
      left--;
      const s = lineSpin(config, rng, syms, lsyms, config.freeSpinReels || config.reels);
      // Marco multiplicador en un rodillo al azar
      let frame = null;
      if (R.frameChance > 0 && rng.int(1_000_000) < R.frameChance * 1_000_000) frame = { reel: rng.int(config.grid.reels), mult: weightedPick(rng, R.frameValues).value };
      const exps = specials.map((sid) => ({ symbol: sid, ...expansion(s, syms.get(sid), sid, frame) }));
      const main = exps[0];
      const expandWin = round6(exps.reduce((a, e) => a + e.win, 0));
      const spin = { ...s, expanded: main.expanded, expandWin, win: round6(s.win + expandWin), ...(frame ? { frame } : {}) };
      if (exps.length > 1) spin.expansions = exps;
      if (frame && exps.some((e) => e.frameMult > 1)) spin.frameHit = true;
      if (s.books.length >= R.scattersToTrigger) {
        left += R.freeSpins;
        spin.retrigger = R.freeSpins;
        // Segundo símbolo especial al reactivar (distinto del primero)
        if (R.secondSpecial && specials.length === 1) {
          const pool = R.expandWeights.filter((e) => e.symbol !== special);
          if (pool.length) { const second = weightedPick(rng, pool).symbol; specials.push(second); spin.newSpecial = second; freeSpins.second = second; }
        }
      }
      freeSpins.spins.push(spin);
    }
    freeSpins.totalWin = round6(freeSpins.spins.reduce((a, s) => a + s.win, 0));
    total += freeSpins.totalWin;
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, mode, base, scatterPay, freeSpins, totalWin: capped, capped: wasCapped };
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config)];
  const R = config.rules || {};
  const g = config.grid || {};
  const maxL = g.reels ? maxLines(g.reels, g.rows) : 20;
  if (!Number.isInteger(R.lines) || R.lines < 1 || R.lines > maxL) errors.push(`rules.lines debe estar entre 1 y ${maxL}`);
  if (!config.symbols?.some((s) => s.type === 'wildscatter')) errors.push('Expanding Symbol necesita un símbolo de tipo "wildscatter" (libro)');
  const ids = new Set((config.symbols || []).filter((s) => (s.type || 'regular') === 'regular').map((s) => s.id));
  if (!Array.isArray(R.expandWeights) || !R.expandWeights.length) errors.push('rules.expandWeights no puede estar vacío');
  for (const e of R.expandWeights || []) if (!ids.has(e.symbol) || !(e.weight > 0)) errors.push(`expandWeights: símbolo inválido ${e.symbol}`);
  if (!(R.freeSpins >= 1)) errors.push('rules.freeSpins debe ser >= 1');
  if (R.frameChance != null && !(R.frameChance >= 0 && R.frameChance <= 1)) errors.push('rules.frameChance (marcos multiplicadores) debe estar entre 0 y 1');
  if (R.frameChance > 0 && (!Array.isArray(R.frameValues) || !R.frameValues.length || R.frameValues.some((f) => !(f.value >= 2 && f.weight > 0)))) errors.push('rules.frameValues debe ser [{value >= 2, weight > 0}]');
  if (R.anteCost != null && R.anteCost !== 0 && !(R.anteCost >= 1 && R.anteCost <= 5)) errors.push('rules.anteCost (precio de la doble chance) debe estar entre 1 y 5 (0 = sin doble chance)');
  if (R.anteCost > 0 && !(R.anteScatterChance > 0 && R.anteScatterChance <= 0.2)) errors.push('rules.anteScatterChance debe estar entre 0 y 0.2');
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
  const w = { ten: 10, jack: 10, queen: 9, king: 8, ace: 8, scarab: 5, statue: 4, pharaoh: 3, explorer: 2, book: 2 };
  return {
    engine: id,
    name: 'El Libro del Desierto',
    grid: { reels: 5, rows: 3 },
    symbols: [
      { id: 'ten', name: '10', type: 'regular', image: ph('10', '#2980b9'), pays: { 3: 5, 4: 25, 5: 100 } },
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#27ae60'), pays: { 3: 5, 4: 25, 5: 100 } },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#16a085'), pays: { 3: 5, 4: 25, 5: 100 } },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#d35400'), pays: { 3: 5, 4: 40, 5: 150 } },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#c0392b'), pays: { 3: 5, 4: 40, 5: 150 } },
      { id: 'scarab', name: 'Escarabajo', type: 'regular', image: ph('🪲', '#16a085'), pays: { 2: 5, 3: 30, 4: 100, 5: 750 } },
      { id: 'statue', name: 'Estatua', type: 'regular', image: ph('🗿', '#7f8c8d'), pays: { 2: 5, 3: 30, 4: 100, 5: 750 } },
      { id: 'pharaoh', name: 'Faraón', type: 'regular', image: ph('𓂀', '#f1c40f'), pays: { 2: 10, 3: 100, 4: 400, 5: 2000 } },
      { id: 'explorer', name: 'Exploradora', type: 'regular', image: ph('🧭', '#e67e22'), pays: { 2: 10, 3: 100, 4: 1000, 5: 5000 } },
      { id: 'book', name: 'Libro', type: 'wildscatter', image: ph('📖', '#c0392b'), pays: {}, scatterPays: { 3: 2, 4: 20, 5: 200 } },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(w, 8000 + i)),
    rules: {
      lines: 10, scattersToTrigger: 3, freeSpins: 10, maxFreeSpins: 100, maxWin: 5000,
      // Reactivar da un segundo símbolo especial
      secondSpecial: true,
      // Marcos multiplicadores en los giros gratis
      frameChance: 0.25, frameValues: [{ value: 2, weight: 60 }, { value: 3, weight: 30 }, { value: 5, weight: 10 }],
      // Doble chance: más libros (precio calculado para mantener el RTP)
      anteCost: 1.25, anteScatterChance: 0.004,
      expandWeights: [
        { symbol: 'ten', weight: 20 }, { symbol: 'jack', weight: 20 }, { symbol: 'queen', weight: 18 }, { symbol: 'king', weight: 15 },
        { symbol: 'ace', weight: 15 }, { symbol: 'scarab', weight: 6 }, { symbol: 'statue', weight: 4 }, { symbol: 'pharaoh', weight: 1.5 },
        { symbol: 'explorer', weight: 0.5 },
      ],
    },
    bet: { levels: [10, 20, 50, 100, 200, 500, 1000, 2000], default: 100, currency: 'USD' },
    theme: {
      title: 'El Libro del Desierto', background: null, backgroundColor: '#2a1a08',
      palette: { primary: '#c0392b', accent: '#f5cd79', panel: '#1a1005', text: '#ffffff', reelBg: '#3d2710' },
      font: 'Cinzel Decorative',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, scatter: null },
    rtpTarget: 0.96,
  };
}
