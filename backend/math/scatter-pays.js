// Motor 7 — SCATTER PAYS: 6x5. Paga con 8 o más símbolos iguales en CUALQUIER posición.
// Los ganadores caen (cascada). Los símbolos MULTIPLICADOR (bombas) traen un valor ×2…×100 que,
// al terminar la secuencia de cascadas, multiplica el premio de ese giro.
// 4+ scatters = giros gratis donde los multiplicadores se ACUMULAN. Se pueden comprar.
// Extras: RAYO DE ZEUS (rules.zeusChance) — en un giro base cualquiera caen de zeusOrbsMin a zeusOrbsMax orbes
// multiplicadores extra; DOBLE CHANCE (modo 'ante', cuesta rules.anteCost) — cada casilla tiene
// rules.anteScatterChance de volverse rayo, para entrar más seguido a los giros gratis.
import {
  symbolMap, spinStrips, capWin, validateCommon, validateGrid, buildStrip, round6, weightedPick,
  tierPay, minTier, tumble, removedSets, setsToArrays, findSymbols, cloneGrid,
} from './common.js';

export const id = 'scatter-pays';
export const name = 'Scatter Pays';
export const description = 'Paga con 8+ iguales en cualquier lugar; cascadas, bombas multiplicadoras que se acumulan en giros gratis, Rayo de Zeus y doble chance.';
export const gridLimits = { reels: [5, 8], rows: [4, 7] };
export const paysBy = 'count';
export const modes = ['base', 'buy', 'ante'];
export const buyModes = (config) => [
  ...(config.rules?.buyCost ? [{ mode: 'buy', get: (c) => c.rules.buyCost, set: (c, v) => { c.rules.buyCost = v; } }] : []),
  ...(config.rules?.anteCost ? [{ mode: 'ante', get: (c) => c.rules.anteCost, set: (c, v) => { c.rules.anteCost = v; } }] : []),
];

/** Una secuencia completa de cascadas. accMult: multiplicador acumulado de giros gratis (0 = juego base). */
function tumbleSequence(config, rng, syms, strips, accMult = 0, { zeus = false, ante = false } = {}) {
  const R = config.rules;
  const rows = config.grid.rows;
  const isMult = (sid) => syms.get(sid)?.type === 'multiplier';
  const drawMult = () => weightedPick(rng, R.multiplierValues).value;
  const { stops, grid: g0 } = spinStrips(rng, strips, rows);
  let grid = g0;
  const regularCells = () => { const out = []; grid.forEach((col, c) => col.forEach((sid, r) => { if ((syms.get(sid)?.type || 'regular') === 'regular') out.push([c, r]); })); return out; };
  // Doble chance: cada casilla normal puede volverse rayo
  let anteHits = null;
  if (ante && R.anteScatterChance > 0) {
    const sc = config.symbols.find((x) => x.type === 'scatter').id;
    anteHits = [];
    for (const [c, r] of regularCells()) if (rng.int(1_000_000) < R.anteScatterChance * 1_000_000) { grid[c][r] = sc; anteHits.push([c, r]); }
  }
  // Rayo de Zeus: caen orbes multiplicadores extra en casillas normales
  let zeusOrbs = null;
  if (zeus && R.zeusChance > 0 && rng.int(1_000_000) < R.zeusChance * 1_000_000) {
    const orb = config.symbols.find((x) => x.type === 'multiplier').id;
    const cells = regularCells();
    const k = Math.min(cells.length, (R.zeusOrbsMin || 1) + rng.int(Math.max(1, (R.zeusOrbsMax || 3) - (R.zeusOrbsMin || 1) + 1)));
    zeusOrbs = [];
    for (let i = 0; i < k; i++) { const [c, r] = cells.splice(rng.int(cells.length), 1)[0]; grid[c][r] = orb; zeusOrbs.push([c, r]); }
  }
  let mults = grid.map((col) => col.map((sid) => (isMult(sid) ? drawMult() : null)));
  const ptr = stops.slice();
  const steps = [];
  let base = 0;
  for (let k = 0; k < 60; k++) {
    // Contar cada símbolo regular en toda la pantalla
    const counts = new Map();
    grid.forEach((col, c) => col.forEach((sid, r) => {
      if ((syms.get(sid)?.type || 'regular') !== 'regular') return;
      if (!counts.has(sid)) counts.set(sid, []);
      counts.get(sid).push([c, r]);
    }));
    const wins = [];
    for (const [sid, pos] of counts) {
      const pay = tierPay(syms.get(sid).pays, pos.length);
      if (pay > 0) wins.push({ symbol: sid, count: pos.length, pay: round6(pay), positions: pos });
    }
    const win = round6(wins.reduce((a, w) => a + w.pay, 0));
    steps.push({ grid: cloneGrid(grid), mults: mults.map((c) => c.slice()), wins, win });
    if (!wins.length) break;
    base += win;
    const removed = removedSets(grid, wins.flatMap((w) => w.positions));
    steps[steps.length - 1].removed = setsToArrays(removed);
    const t = tumble(grid, removed, ptr, strips, mults, (sid) => (isMult(sid) ? drawMult() : null));
    grid = t.grid;
    mults = t.extra;
  }
  // Multiplicadores visibles al final de la secuencia
  const onScreen = mults.flat().filter((v) => v != null);
  const multSum = onScreen.reduce((a, v) => a + v, 0);
  let applied = 1;
  if (base > 0 && multSum > 0) applied = accMult ? accMult + multSum : multSum;
  const scatters = findSymbols(steps[0].grid, (sid) => syms.get(sid)?.type === 'scatter');
  return { stops, steps, baseWin: round6(base), multSum, applied, win: round6(base * applied), scatters, ...(zeusOrbs ? { zeusOrbs } : {}), ...(anteHits?.length ? { anteHits } : {}) };
}

function freeSpinsRound(config, rng, syms, awarded) {
  const R = config.rules;
  const strips = config.freeSpinReels || config.reels;
  const fs = { awarded, spins: [] };
  let left = awarded, acc = 0;
  while (left > 0 && fs.spins.length < 100) {
    left--;
    const s = tumbleSequence(config, rng, syms, strips, acc);
    // En giros gratis los multiplicadores de giros ganadores se suman al acumulado
    if (s.baseWin > 0 && s.multSum > 0) acc += s.multSum;
    if (s.scatters.length >= R.retriggerScatters) { left += R.retrigger; s.retrigger = R.retrigger; }
    fs.spins.push({ ...s, accMult: acc });
  }
  fs.totalWin = round6(fs.spins.reduce((a, s) => a + s.win, 0));
  return fs;
}

export function play(config, rng, { mode = 'base' } = {}) {
  const syms = symbolMap(config);
  const R = config.rules;
  const scatterSym = config.symbols.find((s) => s.type === 'scatter');
  if (mode === 'buy') {
    const freeSpins = freeSpinsRound(config, rng, syms, R.freeSpins);
    const { total, capped } = capWin(freeSpins.totalWin, config);
    return { engine: id, mode, base: null, freeSpins, totalWin: total, capped };
  }
  if (mode === 'ante' && !R.anteCost) throw Object.assign(new Error('Este juego no tiene doble chance'), { status: 400 });
  const base = tumbleSequence(config, rng, syms, config.reels, 0, { zeus: true, ante: mode === 'ante' });
  let total = base.win;
  const n = base.scatters.length;
  const scatterPay = tierPay(scatterSym?.scatterPays || {}, n);
  total += scatterPay;
  let freeSpins = null;
  if (n >= R.scattersToTrigger) {
    freeSpins = freeSpinsRound(config, rng, syms, R.freeSpins);
    total += freeSpins.totalWin;
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, mode, base, scatterPay, freeSpins, totalWin: capped, capped: wasCapped };
}

export const costMultiplier = (config, mode) => (mode === 'buy' ? config.rules.buyCost : mode === 'ante' ? config.rules.anteCost : 1);

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config, gridLimits)];
  const R = config.rules || {};
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Scatter Pays necesita un símbolo scatter');
  if (!config.symbols?.some((s) => s.type === 'multiplier')) errors.push('Scatter Pays necesita un símbolo de tipo "multiplier"');
  if (!Array.isArray(R.multiplierValues) || !R.multiplierValues.length || R.multiplierValues.some((m) => !(m.value >= 2 && m.weight > 0))) {
    errors.push('rules.multiplierValues debe ser [{value >= 2, weight > 0}]');
  }
  if (!(R.freeSpins >= 1)) errors.push('rules.freeSpins debe ser >= 1');
  if (!(R.buyCost >= 10)) errors.push('rules.buyCost debe ser >= 10');
  if (R.zeusChance != null && !(R.zeusChance >= 0 && R.zeusChance <= 0.5)) errors.push('rules.zeusChance (Rayo de Zeus) debe estar entre 0 y 0.5');
  if (R.zeusChance > 0 && !(Number.isInteger(R.zeusOrbsMin) && R.zeusOrbsMin >= 1 && Number.isInteger(R.zeusOrbsMax) && R.zeusOrbsMax >= R.zeusOrbsMin && R.zeusOrbsMax <= 10)) errors.push('rules.zeusOrbsMin/zeusOrbsMax: enteros de 1 a 10, mínimo <= máximo');
  if (R.anteCost != null && R.anteCost !== 0 && !(R.anteCost >= 1 && R.anteCost <= 5)) errors.push('rules.anteCost (precio de la doble chance) debe estar entre 1 y 5 (0 = sin doble chance)');
  if (R.anteCost > 0 && !(R.anteScatterChance > 0 && R.anteScatterChance <= 0.2)) errors.push('rules.anteScatterChance debe estar entre 0 y 0.2');
  for (const s of config.symbols || []) {
    if ((s.type || 'regular') === 'regular' && Object.keys(s.pays || {}).length && minTier(s.pays) < 5) errors.push(`${s.id}: el pago mínimo debe ser para 5 o más símbolos`);
  }
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
  const w = { blue: 12, green: 12, purple: 11, red: 10, cup: 7, ring: 6, hourglass: 5, crown: 4, scatter: 1, bomb: 1 };
  const t = (a, b, c) => ({ 8: a, 10: b, 12: c });
  return {
    engine: id,
    name: 'Tormenta del Olimpo',
    grid: { reels: 6, rows: 5 },
    symbols: [
      { id: 'blue', name: 'Gema azul', type: 'regular', image: ph('◆', '#3498db'), pays: t(0.25, 0.75, 2) },
      { id: 'green', name: 'Gema verde', type: 'regular', image: ph('◆', '#27ae60'), pays: t(0.4, 0.9, 4) },
      { id: 'purple', name: 'Gema violeta', type: 'regular', image: ph('◆', '#8e44ad'), pays: t(0.5, 1, 5) },
      { id: 'red', name: 'Gema roja', type: 'regular', image: ph('◆', '#e74c3c'), pays: t(0.8, 1.2, 8) },
      { id: 'cup', name: 'Cáliz', type: 'regular', image: ph('🏆', '#f39c12'), pays: t(1, 1.5, 10) },
      { id: 'ring', name: 'Anillo', type: 'regular', image: ph('💍', '#1abc9c'), pays: t(1.5, 2, 12) },
      { id: 'hourglass', name: 'Reloj de arena', type: 'regular', image: ph('⏳', '#d35400'), pays: t(2, 5, 15) },
      { id: 'crown', name: 'Corona', type: 'regular', image: ph('👑', '#f1c40f'), pays: t(10, 25, 50) },
      { id: 'scatter', name: 'Rayo', type: 'scatter', image: ph('⚡', '#e84393'), pays: {}, scatterPays: { 4: 3, 5: 5, 6: 100 } },
      { id: 'bomb', name: 'Multiplicador', type: 'multiplier', image: ph('×', '#6c5ce7'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5, 6].map((i) => buildStrip(w, 7000 + i)),
    freeSpinReels: [1, 2, 3, 4, 5, 6].map((i) => buildStrip({ ...w, bomb: 2 }, 7100 + i)),
    rules: {
      scattersToTrigger: 4, freeSpins: 15, retriggerScatters: 3, retrigger: 5, buyCost: 100, maxWin: 5000,
      // Rayo de Zeus: 3 % de los giros base reciben de 1 a 3 orbes extra
      zeusChance: 0.03, zeusOrbsMin: 1, zeusOrbsMax: 3,
      // Doble chance: más rayos (precio calculado para mantener el RTP)
      anteCost: 1.25, anteScatterChance: 0.0065,
      multiplierValues: [
        { value: 2, weight: 300 }, { value: 3, weight: 200 }, { value: 4, weight: 120 }, { value: 5, weight: 100 },
        { value: 8, weight: 50 }, { value: 10, weight: 40 }, { value: 15, weight: 20 }, { value: 25, weight: 10 },
        { value: 50, weight: 4 }, { value: 100, weight: 1 },
      ],
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Tormenta del Olimpo', background: null, backgroundColor: '#0e1630',
      palette: { primary: '#6c5ce7', accent: '#ffeaa7', panel: '#0a0f22', text: '#ffffff', reelBg: '#1b2550' },
      font: 'Cinzel Decorative', symbolScale: 0.92, cellGap: 4,
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, tumble: null },
    rtpTarget: 0.96,
  };
}
