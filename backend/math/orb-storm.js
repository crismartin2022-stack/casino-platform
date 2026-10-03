// Motor 19 — TORMENTA DE ORBES: 6x5, paga con 8 o más iguales en CUALQUIER posición, con cascadas.
// - Juego base: los ORBES multiplicadores (×2…×500) que quedan en pantalla al terminar las cascadas se SUMAN y
//   multiplican el premio del giro (si hubo premio).
// - Giros gratis con MULTIPLICADOR GLOBAL QUE CRECE: empieza en rules.fsStartMult y CADA orbe que cae en los giros
//   gratis le suma su valor (gane o no ese giro). Todos los premios de los giros gratis se multiplican por el
//   multiplicador global del momento (los orbes de ese giro ya sumados).
// - COMPRA EN DOS NIVELES: «buy» (giros gratis normales, rules.buyCost) y «buy-super» (empiezan con el multiplicador
//   global en rules.superStartMult, rules.superCost). Los precios los calcula el ajuste de RTP.
// - Premio máximo rules.maxWin (2500× por defecto): al llegar, la ronda termina pagando el tope.
import {
  symbolMap, spinStrips, capWin, validateCommon, validateGrid, buildStrip, round6, weightedPick,
  tierPay, minTier, tumble, removedSets, setsToArrays, findSymbols, cloneGrid,
} from './common.js';

export const id = 'orb-storm';
export const name = 'Tormenta de orbes';
export const description = 'Paga con 8+ iguales en cualquier lugar, con cascadas y orbes multiplicadores; en los giros gratis un multiplicador global crece con cada orbe. Compra del bonus en dos niveles y premio máximo 2500×.';
export const gridLimits = { reels: [5, 8], rows: [4, 7] };
export const paysBy = 'count';
export const modes = ['base', 'buy', 'buy-super'];
export const buyModes = (config) => [
  ...(config.rules?.buyCost ? [{ mode: 'buy', get: (c) => c.rules.buyCost, set: (c, v) => { c.rules.buyCost = v; } }] : []),
  ...(config.rules?.superCost ? [{ mode: 'buy-super', get: (c) => c.rules.superCost, set: (c, v) => { c.rules.superCost = v; } }] : []),
];

/** Una secuencia completa de cascadas. accMult: multiplicador acumulado de giros gratis (0 = juego base). */
function tumbleSequence(config, rng, syms, strips, accMult = 0) {
  const zeus = false, ante = false;
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
  return { stops, steps, baseWin: round6(base), multSum, orbsLanded: multSum, applied, win: round6(base * applied), scatters, ...(zeusOrbs ? { zeusOrbs } : {}), ...(anteHits?.length ? { anteHits } : {}) };
}


function freeSpinsRound(config, rng, syms, awarded, startMult) {
  const R = config.rules;
  const strips = config.freeSpinReels || config.reels;
  const fs = { awarded, startMult, spins: [] };
  let left = awarded, global = startMult;
  let total = 0;
  while (left > 0 && fs.spins.length < 100) {
    left--;
    const s = tumbleSequence(config, rng, syms, strips, 0);
    // Cada orbe que cae en el giro (en la primera pantalla y en las cascadas) suma al multiplicador global
    const landed = s.orbsLanded;
    global = round6(global + landed);
    const win = round6(s.baseWin * global);
    if (s.scatters.length >= R.retriggerScatters) { left += R.retrigger; s.retrigger = R.retrigger; }
    total += win;
    fs.spins.push({ ...s, win, applied: s.baseWin > 0 ? global : 1, globalMult: global, orbsAdded: landed });
    if (total >= (R.maxWin ?? 2500)) { fs.maxReached = true; break; }
  }
  fs.totalWin = round6(total);
  fs.finalMult = global;
  return fs;
}

export function play(config, rng, { mode = 'base' } = {}) {
  const syms = symbolMap(config);
  const R = config.rules;
  const scatterSym = config.symbols.find((s) => s.type === 'scatter');
  if (mode === 'buy' || mode === 'buy-super') {
    const freeSpins = freeSpinsRound(config, rng, syms, R.freeSpins, mode === 'buy-super' ? R.superStartMult : R.fsStartMult);
    const { total, capped } = capWin(freeSpins.totalWin, config);
    return { engine: id, mode, base: null, freeSpins, totalWin: total, capped };
  }
  const base = tumbleSequence(config, rng, syms, config.reels, 0);
  let total = base.win;
  const n = base.scatters.length;
  const scatterPay = tierPay(scatterSym?.scatterPays || {}, n);
  total += scatterPay;
  let freeSpins = null;
  if (n >= R.scattersToTrigger) {
    freeSpins = freeSpinsRound(config, rng, syms, R.freeSpins, R.fsStartMult);
    total += freeSpins.totalWin;
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, mode, base, scatterPay, freeSpins, totalWin: capped, capped: wasCapped };
}

export const costMultiplier = (config, mode) => (mode === 'buy' ? config.rules.buyCost : mode === 'buy-super' ? config.rules.superCost : 1);

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config, gridLimits)];
  const R = config.rules || {};
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Tormenta de orbes necesita un símbolo scatter');
  if (!config.symbols?.some((s) => s.type === 'multiplier')) errors.push('Tormenta de orbes necesita un símbolo de tipo "multiplier" (el orbe)');
  if (!Array.isArray(R.multiplierValues) || !R.multiplierValues.length || R.multiplierValues.some((m) => !(m.value >= 2 && m.weight > 0))) errors.push('rules.multiplierValues debe ser [{value >= 2, weight > 0}]');
  if (!(Number.isInteger(R.scattersToTrigger) && R.scattersToTrigger >= 3 && R.scattersToTrigger <= 8)) errors.push('rules.scattersToTrigger debe estar entre 3 y 8');
  if (!(R.freeSpins >= 1 && R.freeSpins <= 100)) errors.push('rules.freeSpins debe estar entre 1 y 100');
  if (!(R.fsStartMult >= 1 && R.fsStartMult <= 1000)) errors.push('rules.fsStartMult (multiplicador global inicial) debe estar entre 1 y 1000');
  if (R.superCost != null && R.superCost !== 0 && !(R.superStartMult > (R.fsStartMult || 1) && R.superStartMult <= 1000)) errors.push('rules.superStartMult (inicio del súper bonus) debe ser mayor que el inicial normal y hasta 1000');
  if (R.buyCost != null && !(R.buyCost >= 10)) errors.push('rules.buyCost debe ser >= 10');
  if (R.superCost != null && R.superCost !== 0 && !(R.superCost > (R.buyCost || 0))) errors.push('rules.superCost debe ser mayor que rules.buyCost');
  if (!(R.retrigger >= 0 && R.retrigger <= 50)) errors.push('rules.retrigger debe estar entre 0 y 50');
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
  const w = { shield: 12, laurel: 12, amethyst: 11, ruby: 10, cup: 7, ring: 6, harp: 5, helmet: 4, scatter: 1, orb: 1 };
  const t = (a, b, c) => ({ 8: a, 10: b, 12: c });
  return {
    engine: id,
    name: 'Trueno Dorado 2500',
    grid: { reels: 6, rows: 5 },
    symbols: [
      { id: 'shield', name: 'Escudo', type: 'regular', image: ph('🛡', '#2563eb'), pays: t(0.25, 0.75, 2) },
      { id: 'laurel', name: 'Laurel', type: 'regular', image: ph('🌿', '#16a34a'), pays: t(0.4, 0.9, 4) },
      { id: 'amethyst', name: 'Amatista', type: 'regular', image: ph('◆', '#7c3aed'), pays: t(0.5, 1, 5) },
      { id: 'ruby', name: 'Rubí', type: 'regular', image: ph('◆', '#dc2626'), pays: t(0.8, 1.2, 8) },
      { id: 'cup', name: 'Copa', type: 'regular', image: ph('🏆', '#d97706'), pays: t(1, 1.5, 10) },
      { id: 'ring', name: 'Anillo', type: 'regular', image: ph('💍', '#0d9488'), pays: t(1.5, 2, 12) },
      { id: 'harp', name: 'Arpa', type: 'regular', image: ph('🎵', '#ea580c'), pays: t(2, 5, 15) },
      { id: 'helmet', name: 'Casco dorado', type: 'regular', image: ph('⛑', '#eab308'), pays: t(10, 25, 50) },
      { id: 'scatter', name: 'Rayo dorado', type: 'scatter', image: ph('⚡', '#f59e0b'), pays: {}, scatterPays: { 4: 3, 5: 5, 6: 100 } },
      { id: 'orb', name: 'Orbe', type: 'multiplier', image: ph('×', '#9333ea'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5, 6].map((i) => buildStrip(w, 19000 + i)),
    freeSpinReels: [1, 2, 3, 4, 5, 6].map((i) => buildStrip({ ...w, orb: 2 }, 19100 + i)),
    rules: {
      scattersToTrigger: 4, freeSpins: 15, retriggerScatters: 3, retrigger: 5,
      fsStartMult: 1, buyCost: 100, superStartMult: 20, superCost: 500,
      maxWin: 2500,
      multiplierValues: [
        { value: 2, weight: 300 }, { value: 3, weight: 200 }, { value: 4, weight: 120 }, { value: 5, weight: 100 },
        { value: 8, weight: 50 }, { value: 10, weight: 40 }, { value: 15, weight: 20 }, { value: 25, weight: 10 },
        { value: 50, weight: 4 }, { value: 100, weight: 2 }, { value: 500, weight: 1 },
      ],
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Trueno Dorado 2500', background: null, backgroundColor: '#1a1405',
      palette: { primary: '#eab308', accent: '#fde68a', panel: '#120d02', text: '#ffffff', reelBg: '#2e2208' },
      font: 'Cinzel Decorative', symbolScale: 0.92, cellGap: 4,
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, tumble: null },
    rtpTarget: 0.96,
  };
}
