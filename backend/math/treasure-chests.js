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
  const R = config.rules;
  const { stops, grid } = spinStrips(rng, strips, config.grid.rows);
  const raw = evaluateRows(grid, syms);
  const wins = mult > 1 ? raw.map((w) => ({ ...w, pay: round6(w.pay * mult) })) : raw;
  // Cofres que cuentan para el bonus: solo en la fila indicada (rules.triggerRow, como el diseño original: la central)
  // o en toda la pantalla si triggerRow es -1.
  const row = R.triggerRow ?? -1;
  const chests = findSymbols(grid, (sid) => syms.get(sid)?.type === 'scatter').filter(([, r]) => row < 0 || r === row);
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

/**
 * Aplica un cofre al giro que lo activó. Como el diseño original (chestMultTarget = "trigger"): el multiplicador
 * multiplica el premio de ESE giro y da giros gratis normales. Con chestMultTarget = "freeSpins" el multiplicador
 * se aplica a todos los giros gratis.
 */
function applyChest(config, rng, s) {
  const chest = chestBonus(config, rng);
  s.chest = chest;
  if ((config.rules.chestMultTarget || 'trigger') === 'trigger' && chest.mult > 1) {
    s.rawWin = s.win;
    s.wins = s.wins.map((w) => ({ ...w, pay: round6(w.pay * chest.mult) }));
    s.win = round6(s.win * chest.mult);
  }
  return chest;
}

export function play(config, rng, { mode = 'base' } = {}) {
  const syms = symbolMap(config);
  const R = config.rules;
  const target = R.chestMultTarget || 'trigger';
  if (mode === 'buy' && !R.buyCost) throw Object.assign(new Error('Este juego no tiene compra de bonus'), { status: 400 });
  const base = spinOnce(config, rng, syms, config.reels);
  let freeSpins = null;
  // En la compra, el giro de compra siempre abre el bonus de cofres
  if (mode === 'buy' || base.chests.length >= R.triggerCount) {
    const chest = applyChest(config, rng, base);
    const fsMult = target === 'freeSpins' ? chest.mult : 1;
    freeSpins = { awarded: chest.spins, multiplier: fsMult, spins: [] };
    let left = chest.spins;
    const strips = config.freeSpinReels || config.reels;
    while (left > 0 && freeSpins.spins.length < (R.maxFreeSpins || 50)) {
      left--;
      const s = spinOnce(config, rng, syms, strips, fsMult);
      // Durante los giros gratis, otros cofres: nueva elección y más giros
      if (s.chests.length >= R.triggerCount) {
        const c2 = applyChest(config, rng, s);
        left += R.retrigger ?? c2.spins;
        s.retrigger = R.retrigger ?? c2.spins;
      }
      freeSpins.spins.push(s);
    }
    freeSpins.totalWin = round6(freeSpins.spins.reduce((a, s) => a + s.win, 0));
  }
  const total = base.win + (freeSpins?.totalWin || 0);
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, base, chest: base.chest || null, freeSpins, totalWin: capped, capped: wasCapped };
}

export function costMultiplier(config, mode) { return mode === 'buy' ? config.rules.buyCost : 1; }

/** Compra del bonus: opcional (el diseño original no la tenía). Se activa poniendo rules.buyCost. */
export function buyModes(config) {
  return config.rules?.buyCost ? [{ mode: 'buy', get: (c) => c.rules.buyCost, set: (c, v) => { c.rules.buyCost = v; } }] : [];
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config, gridLimits)];
  const R = config.rules || {};
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Cofres necesita un símbolo de tipo "scatter" (el cofre)');
  if (config.symbols?.some((s) => s.type === 'wild')) errors.push('Cofres no usa comodines (los premios son por fila)');
  if (!(R.triggerCount >= 2 && R.triggerCount <= 6)) errors.push('rules.triggerCount (cofres para el bonus) debe estar entre 2 y 6');
  if (!(R.freeSpins >= 1 && R.freeSpins <= 50)) errors.push('rules.freeSpins debe estar entre 1 y 50');
  if (R.retrigger != null && !(R.retrigger >= 0 && R.retrigger <= 20)) errors.push('rules.retrigger debe estar entre 0 y 20');
  if (!Array.isArray(R.chestPrizes) || R.chestPrizes.length < 2) errors.push('rules.chestPrizes necesita al menos 2 premios [{mult, weight}]');
  for (const p of R.chestPrizes || []) {
    if (!(p.mult >= 1 && p.mult <= 100) || !(p.weight > 0)) errors.push('Cada premio de cofre necesita mult entre 1 y 100 y weight > 0');
    if (p.spins != null && !(p.spins >= 1 && p.spins <= 50)) errors.push('spins de un premio de cofre debe estar entre 1 y 50');
  }
  if (R.triggerRow != null && !(Number.isInteger(R.triggerRow) && R.triggerRow >= -1 && R.triggerRow < (config.grid?.rows || 4))) errors.push('rules.triggerRow: fila de los cofres (0 = arriba) o -1 para toda la pantalla');
  if (R.chestMultTarget != null && !['trigger', 'freeSpins'].includes(R.chestMultTarget)) errors.push('rules.chestMultTarget: "trigger" (multiplica el giro del cofre) o "freeSpins" (multiplica los giros gratis)');
  if (!(R.chests >= 2 && R.chests <= 6)) errors.push('rules.chests (cofres para elegir) debe estar entre 2 y 6');
  if (R.buyCost != null && !(R.buyCost >= 5)) errors.push('rules.buyCost (precio de compra) debe ser al menos 5, o vacío para no ofrecer compra');
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
  // Símbolos, frecuencias y pagos relativos tal cual el diseño original (payout: 3 iguales = 1/20, 4 = 1/10, 5 = 1/5);
  // el ajuste de RTP escala todos los pagos por igual hasta el objetivo.
  const DEF = [
    ['ace', 'A', 30, 2, '#c49a48'], ['king', 'K', 25, 3, '#b5863f'], ['queen', 'Q', 20, 4, '#a8783a'], ['jack', 'J', 15, 5, '#9b6a2f'],
    ['ten', '10', 10, 6, '#8e5a2b'], ['nine', '9', 8, 8, '#7d4f27'], ['eight', '8', 6, 10, '#6e4524'], ['seven', '7', 4, 12, '#b03a2e'],
    ['gem', '💎', 3, 25, '#2e86de', 'Diamante'], ['rose', '🌹', 2, 50, '#c0392b', 'Rosa'], ['goblet', '🍷', 1, 100, '#8e44ad', 'Copa'], ['crown', '👑', 1, 200, '#d4af37', 'Corona'],
  ];
  // Cofres más frecuentes que en el original (peso 3 → bonus 1 de cada ~6.500 giros): así sale cada ~150. Editable con «Frecuencia del bonus».
  const w = Object.fromEntries([...DEF.map(([id, , wt]) => [id, wt * 2]), ['chest', 25]]);
  const fsw = { ...w };
  return {
    engine: id,
    name: 'Cofres de la Corona',
    grid: { reels: 5, rows: 4 },
    symbols: [
      ...DEF.map(([sid, label, , p, color, nm]) => ({ id: sid, name: nm || label, type: 'regular', image: ph(label, color), pays: { 3: p / 20, 4: p / 10, 5: p / 5 } })),
      { id: 'chest', name: 'Cofre', type: 'scatter', image: ph('🎁', '#b8860b'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(w, 12000 + i)),
    freeSpinReels: [1, 2, 3, 4, 5].map((i) => buildStrip(fsw, 12100 + i)),
    rules: {
      // Como el diseño original: 3 cofres en la fila central, cofre ×1/×2/×3 (60/30/10) sobre el premio del giro y 5 giros gratis
      triggerCount: 3, triggerRow: 2, chestMultTarget: 'trigger', freeSpins: 5, retrigger: 5, maxFreeSpins: 50, chests: 3,
      chestPrizes: [{ mult: 1, weight: 60 }, { mult: 2, weight: 30 }, { mult: 3, weight: 10 }],
      buyCost: null, maxWin: 5000, // sin compra de bonus, como el diseño original (se activa poniendo un precio)
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
