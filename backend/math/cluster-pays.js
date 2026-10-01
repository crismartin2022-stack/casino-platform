// Motor 6 — CLUSTER PAYS: cuadrícula grande (7x7 por defecto). Paga por GRUPOS de 5 o más símbolos
// iguales que se tocan en horizontal o vertical (el comodín se une a cualquier grupo).
// Los grupos ganadores explotan, cae un relleno (cascada) y el multiplicador sube.
// Extras (si están en rules): CASILLAS DORADAS (rules.spotStart) — donde explota un símbolo la casilla queda
// marcada; si vuelve a explotar ahí se vuelve ×spotStart y se duplica en cada explosión hasta ×spotMax; el grupo
// que toca casillas doradas se multiplica por la suma de sus valores. GIROS GRATIS con scatters (rules.freeSpins)
// donde las casillas doradas NO se borran entre giros, y compra del bonus (rules.buyCost).
import {
  symbolMap, spinStrips, findSymbols, cloneGrid, capWin, validateCommon, validateGrid, buildStrip, round6,
  tierPay, minTier, tumble, removedSets, setsToArrays,
} from './common.js';

export const id = 'cluster-pays';
export const name = 'Cluster Pays';
export const description = 'Paga por grupos de 5+ iguales que se tocan; cascadas con multiplicador, CASILLAS DORADAS que multiplican y giros gratis donde no se borran.';
export const gridLimits = { reels: [5, 8], rows: [5, 8] };
export const paysBy = 'cluster';
export const modes = ['base', 'buy'];
export const costMultiplier = (config, mode) => (mode === 'buy' ? config.rules.buyCost : 1);
export const buyModes = (config) => (config.rules?.buyCost ? [{ mode: 'buy', get: (c) => c.rules.buyCost, set: (c, v) => { c.rules.buyCost = v; } }] : []);

/** Encuentra grupos conectados (arriba/abajo/izquierda/derecha). Índices numéricos para que sea rápido. */
export function findClusters(grid, syms, minSize) {
  const cols = grid.length, rows = grid[0].length, n = cols * rows;
  const flat = new Array(n);
  const wild = new Uint8Array(n);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const i = c * rows + r;
    flat[i] = grid[c][r];
    if (syms.get(flat[i])?.type === 'wild') wild[i] = 1;
  }
  const wins = [];
  const seen = new Uint8Array(n);        // símbolos regulares ya asignados a un grupo
  const mark = new Int32Array(n).fill(-1); // visitado en la búsqueda actual
  const stack = new Int32Array(n);
  let stamp = 0;
  for (let start = 0; start < n; start++) {
    const sid = flat[start];
    if (wild[start] || seen[start]) continue;
    const sym = syms.get(sid);
    if ((sym?.type || 'regular') !== 'regular') continue;
    stamp++;
    let sp = 0;
    stack[sp++] = start;
    mark[start] = stamp;
    const cells = [];
    while (sp) {
      const i = stack[--sp];
      cells.push(i);
      if (!wild[i]) seen[i] = 1;
      const c = (i / rows) | 0, r = i - c * rows;
      if (r > 0) { const j = i - 1; if (mark[j] !== stamp && (flat[j] === sid || wild[j])) { mark[j] = stamp; stack[sp++] = j; } }
      if (r < rows - 1) { const j = i + 1; if (mark[j] !== stamp && (flat[j] === sid || wild[j])) { mark[j] = stamp; stack[sp++] = j; } }
      if (c > 0) { const j = i - rows; if (mark[j] !== stamp && (flat[j] === sid || wild[j])) { mark[j] = stamp; stack[sp++] = j; } }
      if (c < cols - 1) { const j = i + rows; if (mark[j] !== stamp && (flat[j] === sid || wild[j])) { mark[j] = stamp; stack[sp++] = j; } }
    }
    if (cells.length >= minSize) {
      const pay = tierPay(sym.pays, cells.length);
      if (pay > 0) wins.push({ symbol: sid, count: cells.length, pay: round6(pay), positions: cells.map((i) => [(i / rows) | 0, i % rows]) });
    }
  }
  return wins;
}

/** Una secuencia de cascadas. spots: casillas doradas (0 = libre, 1 = marcada, >= 2 = multiplicador); se modifica. */
function clusterSequence(config, rng, syms, strips, spots) {
  const R = config.rules;
  const rows = config.grid.rows;
  const { stops, grid: g0 } = spinStrips(rng, strips, rows);
  let grid = g0;
  const ptr = stops.slice();
  const steps = [];
  let total = 0, scatters = 0;
  for (let cascade = 0; cascade < 80; cascade++) {
    const wins = findClusters(grid, syms, R.minCluster);
    const multiplier = R.cascadeMultipliers[Math.min(cascade, R.cascadeMultipliers.length - 1)];
    if (R.freeSpins) scatters = Math.max(scatters, findSymbols(grid, (sid) => syms.get(sid)?.type === 'scatter').length);
    let raw = 0;
    for (const w of wins) {
      // Casillas doradas: el grupo se multiplica por la suma de las que toca
      if (spots) {
        const m = w.positions.reduce((a, [c, r]) => a + (spots[c][r] >= 2 ? spots[c][r] : 0), 0);
        if (m > 0) { w.spotMult = m; w.pay = round6(w.pay * m); }
      }
      raw += w.pay;
    }
    const win = round6(raw * multiplier);
    steps.push({ grid: cloneGrid(grid), wins, multiplier, win, ...(spots ? { spots: spots.map((c) => c.slice()) } : {}) });
    if (!wins.length) break;
    total += win;
    const removed = removedSets(grid, wins.flatMap((w) => w.positions));
    steps[steps.length - 1].removed = setsToArrays(removed);
    if (spots) {
      removed.forEach((set, c) => set.forEach((r) => {
        const v = spots[c][r];
        spots[c][r] = v === 0 ? 1 : v === 1 ? R.spotStart : Math.min(R.spotMax || 128, v * 2);
      }));
    }
    grid = tumble(grid, removed, ptr, strips).grid;
  }
  return { stops, steps, scatters, win: round6(total), cascades: steps.length - 1 };
}

const freshSpots = (config) => (config.rules.spotStart >= 2 ? Array.from({ length: config.grid.reels }, () => new Array(config.grid.rows).fill(0)) : null);

export function play(config, rng, { mode = 'base' } = {}) {
  const syms = symbolMap(config);
  const R = config.rules;
  if (mode === 'buy' && !R.buyCost) throw Object.assign(new Error('Este juego no permite comprar el bonus'), { status: 400 });
  const buy = mode === 'buy';
  let total = 0;
  let base = null;
  let n = 0;
  if (!buy) {
    base = clusterSequence(config, rng, syms, config.reels, freshSpots(config));
    total += base.win;
    n = base.scatters;
  } else n = R.scattersToTrigger;
  let freeSpins = null;
  const fsFor = (k) => (R.freeSpins ? R.freeSpins[String(Math.min(k, Math.max(...Object.keys(R.freeSpins).map(Number))))] || 0 : 0);
  if (R.freeSpins && n >= R.scattersToTrigger) {
    const awarded = fsFor(n);
    freeSpins = { awarded, spins: [] };
    // En los giros gratis las casillas doradas no se borran
    const spots = freshSpots(config);
    let left = awarded;
    while (left > 0 && freeSpins.spins.length < (R.maxFreeSpins || 100)) {
      left--;
      const s = clusterSequence(config, rng, syms, config.freeSpinReels || config.reels, R.fsKeepSpots === false ? freshSpots(config) : spots);
      if (s.scatters >= R.scattersToTrigger) { const add = R.retrigger ?? fsFor(s.scatters); left += add; s.retrigger = add; }
      freeSpins.spins.push(s);
    }
    freeSpins.totalWin = round6(freeSpins.spins.reduce((a, x) => a + x.win, 0));
    total += freeSpins.totalWin;
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  // Compatibilidad: steps y stops del giro base en la raíz (como antes)
  return {
    engine: id, mode, cost: buy ? R.buyCost : 1, ...(base ? { stops: base.stops, steps: base.steps, cascades: base.cascades } : { steps: null }),
    freeSpins, totalWin: capped, capped: wasCapped,
  };
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config, gridLimits)];
  const R = config.rules || {};
  if (!(R.minCluster >= 3 && R.minCluster <= 10)) errors.push('rules.minCluster debe estar entre 3 y 10');
  if (!Array.isArray(R.cascadeMultipliers) || !R.cascadeMultipliers.length || R.cascadeMultipliers.some((x) => !(x >= 1))) {
    errors.push('rules.cascadeMultipliers debe ser una lista de números >= 1');
  }
  if (R.spotStart != null && R.spotStart !== 0 && !(Number.isInteger(R.spotStart) && R.spotStart >= 2 && R.spotStart <= 10)) errors.push('rules.spotStart (casillas doradas) debe ser 0 (apagado) o un entero entre 2 y 10');
  if (R.spotStart >= 2 && !(R.spotMax >= R.spotStart && R.spotMax <= 1024)) errors.push('rules.spotMax debe estar entre spotStart y 1024');
  if (R.freeSpins != null) {
    if (typeof R.freeSpins !== 'object' || !Object.keys(R.freeSpins).length || Object.entries(R.freeSpins).some(([k, v]) => !/^\d+$/.test(k) || !(Number.isInteger(v) && v >= 1 && v <= 100))) errors.push('rules.freeSpins debe mapear nº de scatters → giros (1 a 100)');
    if (!(R.scattersToTrigger >= 2 && R.scattersToTrigger <= 10)) errors.push('rules.scattersToTrigger debe estar entre 2 y 10');
    if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Los giros gratis necesitan un símbolo scatter');
  }
  if (R.buyCost != null && !(R.buyCost >= 1)) errors.push('rules.buyCost debe ser >= 1');
  if (R.buyCost && !R.freeSpins) errors.push('La compra necesita giros gratis (rules.freeSpins)');
  for (const s of config.symbols || []) {
    if ((s.type || 'regular') === 'regular' && Object.keys(s.pays || {}).length && minTier(s.pays) < R.minCluster) {
      errors.push(`${s.id}: el pago más bajo (${minTier(s.pays)}) es menor que rules.minCluster`);
    }
  }
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { red: 45, blue: 45, green: 45, yellow: 40, purple: 40, star: 20, moon: 15, sun: 10, wild: 5, scatter: 2 };
  // Giros gratis: sin amatistas (menos variedad), para que se formen más grupos y se llenen las casillas doradas
  const fsW = { red: 30, blue: 30, green: 30, yellow: 26, star: 14, moon: 10, sun: 8, wild: 3, scatter: 2 };
  const tiers = (base) => ({ 5: base, 6: base * 1.5, 7: base * 2, 8: base * 3, 9: base * 4, 10: base * 6, 12: base * 10, 15: base * 25, 20: base * 60 });
  return {
    engine: id,
    name: 'Gemas Conectadas',
    grid: { reels: 7, rows: 7 },
    symbols: [
      { id: 'red', name: 'Rubí', type: 'regular', image: ph('◆', '#e74c3c'), pays: tiers(0.02) },
      { id: 'blue', name: 'Zafiro', type: 'regular', image: ph('◆', '#3498db'), pays: tiers(0.02) },
      { id: 'green', name: 'Esmeralda', type: 'regular', image: ph('◆', '#27ae60'), pays: tiers(0.025) },
      { id: 'yellow', name: 'Topacio', type: 'regular', image: ph('◆', '#f1c40f'), pays: tiers(0.03) },
      { id: 'purple', name: 'Amatista', type: 'regular', image: ph('◆', '#8e44ad'), pays: tiers(0.03) },
      { id: 'star', name: 'Estrella', type: 'regular', image: ph('★', '#f39c12'), pays: tiers(0.06) },
      { id: 'moon', name: 'Luna', type: 'regular', image: ph('☾', '#95a5a6'), pays: tiers(0.1) },
      { id: 'sun', name: 'Sol', type: 'regular', image: ph('☀', '#e67e22'), pays: tiers(0.2) },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e84393'), pays: {} },
      { id: 'scatter', name: 'Cristal', type: 'scatter', image: ph('💎', '#00cec9'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5, 6, 7].map((i) => buildStrip(w, 6000 + i)),
    freeSpinReels: [1, 2, 3, 4, 5, 6, 7].map((i) => buildStrip(fsW, 6100 + i)),
    rules: {
      minCluster: 5, cascadeMultipliers: [1, 1, 2, 3, 5, 8, 10],
      // Casillas doradas: se marcan al explotar y luego valen ×2, ×4, ×8… hasta ×32
      spotStart: 2, spotMax: 32,
      // 3+ cristales: giros gratis con casillas doradas que no se borran
      scattersToTrigger: 3, freeSpins: { 3: 10, 4: 12, 5: 15, 6: 20, 7: 30 }, retrigger: 5, fsKeepSpots: true, maxFreeSpins: 100,
      buyCost: 100,
      maxWin: 5000,
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Gemas Conectadas', background: null, backgroundColor: '#140d2b',
      palette: { primary: '#e84393', accent: '#74b9ff', panel: '#0d0820', text: '#ffffff', reelBg: '#22164a' },
      font: 'Bungee', symbolScale: 0.9, cellGap: 3,
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, tumble: null },
    rtpTarget: 0.96,
  };
}
