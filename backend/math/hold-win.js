// Motor 4 — HOLD & WIN: 5x3, 10 líneas. 6+ monedas activan el bonus de re-giros:
// las monedas quedan fijas, hay 3 re-giros y cada moneda nueva los reinicia a 3.
// Llenar las 15 posiciones paga el jackpot GRAND.
// Modo "elige" (rules.holdMode = 'pick', diseño original 5x5): en cada ronda aparecen monedas misteriosas y el
// JUGADOR elige cuál fijar; al fijarla se revela (bronce, plata, oro, platino, diamante o un especial: bonus, ×,
// jackpot, reset de rondas o +1 ronda). Cada moneda nueva hace crecer +10 % las ya fijadas y los jackpots se
// ganan por cantidad de posiciones fijas. El contenido de la moneda que se fija sale en orden (no depende de la
// casilla tocada), así que la elección no cambia el RTP y todo el bonus se decide y audita en el servidor.
import {
  symbolMap, spinStrips, evaluateLines, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip, round6, weightedPick, linesFor, maxLines,
} from './common.js';

export const id = 'hold-win';
export const name = 'Hold & Win';
export const description = 'ELIGE Y FIJA: el jugador elige qué moneda misteriosa fijar (Bronce a Diamante, especiales y +10 % al fijar); jackpots por posiciones fijas.';

function coinValue(rng, R) {
  const pick = weightedPick(rng, R.coinValues);
  if (pick.jackpot) return { jackpot: pick.jackpot, value: R.jackpots[pick.jackpot] };
  return { value: pick.value, ...(pick.name ? { tier: pick.name } : {}) };
}

const randRange = (rng, min, max) => round6(min + rng.int(Math.round((max - min) * 100) + 1) / 100);

/** Contenido de la moneda que el jugador fija en una ronda del modo "elige". */
function pickContent(rng, R, specialChance) {
  if (R.pickSpecials?.length && rng.int(1_000_000) < specialChance * 1_000_000) {
    const sp = weightedPick(rng, R.pickSpecials);
    if (sp.type === 'bonus') return { kind: 'bonus', value: randRange(rng, sp.min, sp.max) };
    if (sp.type === 'multiplier') return { kind: 'multiplier', mult: sp.min + rng.int(sp.max - sp.min + 1) };
    if (sp.type === 'jackpot') return { kind: 'jackpot', jackpot: sp.jackpot || 'mini', value: R.jackpots[sp.jackpot || 'mini'] };
    return { kind: sp.type }; // reset | extra_round
  }
  const cv = weightedPick(rng, R.coinValues);
  if (cv.jackpot) return { kind: 'jackpot', jackpot: cv.jackpot, value: R.jackpots[cv.jackpot] };
  return { kind: 'coin', value: cv.value, ...(cv.name ? { tier: cv.name } : {}) };
}

/** Bonus del modo "elige": rondas donde el jugador fija una moneda misteriosa por ronda. */
function pickHoldBonus(config, rng, startCoins) {
  const R = config.rules;
  const cells = config.grid.reels * config.grid.rows;
  const growth = R.holdGrowth || 0;
  const coins = startCoins.map((k) => (k.jackpot ? { kind: 'jackpot', jackpot: k.jackpot, value: k.value } : { kind: 'coin', value: k.value }));
  let held = startCoins.length, left = R.rounds || 3;
  let bonusWin = 0, jackpotWin = 0, multSum = 0;
  const rounds = [];
  while (left > 0 && held < cells) {
    const free = cells - held;
    const inject = rounds.length === 0 ? Math.min(R.injectSpecials || 0, free) : 0;
    const base = Math.min(free - inject, (R.candidatesMin || 2) + rng.int(Math.max(1, (R.candidatesMax || 4) - (R.candidatesMin || 2) + 1)));
    const candidates = Math.max(1, base + inject);
    // Los especiales inyectados están entre las candidatas: tocar una al azar da especial con probabilidad inject/candidatas
    const chance = inject ? inject / candidates + (1 - inject / candidates) * (R.specialChance || 0) : (R.specialChance || 0);
    const pick = pickContent(rng, R, chance);
    left--;
    held++;
    if (pick.kind === 'coin' || pick.kind === 'jackpot') {
      if (growth > 0) for (const k of coins) if (k.kind === 'coin') k.value = round6(k.value * (1 + growth));
      coins.push({ ...pick });
    }
    if (pick.kind === 'jackpot') jackpotWin += pick.value;
    if (pick.kind === 'bonus') bonusWin += pick.value;
    if (pick.kind === 'multiplier') multSum += pick.mult;
    if (pick.kind === 'reset') left = R.rounds || 3;
    if (pick.kind === 'extra_round') left += 1;
    rounds.push({ candidates, pick, roundsLeft: left, held });
  }
  const coinSum = coins.filter((k) => k.kind === 'coin').reduce((a, k) => a + k.value, 0);
  const startJackpots = coins.filter((k) => k.kind === 'jackpot').reduce((a, k) => a + k.value, 0) - jackpotWin;
  const full = held >= cells;
  // Jackpot por cantidad de posiciones fijas (el mayor alcanzado); llenar todo paga el GRAND
  let tier = null;
  for (const t of R.jackpotCounts || []) if (held >= t.count && (!tier || t.count > tier.count)) tier = t;
  const tierJackpot = full ? { jackpot: 'grand', value: R.jackpots.grand } : tier ? { jackpot: tier.jackpot, value: R.jackpots[tier.jackpot] } : null;
  const win = (coinSum + bonusWin) * Math.max(1, multSum) + startJackpots + jackpotWin + (tierJackpot?.value || 0);
  return {
    mode: 'pick', rounds, held, full, multiplier: Math.max(1, multSum),
    coinsWin: round6(coinSum), bonusWin: round6(bonusWin), jackpotWin: round6(startJackpots + jackpotWin), tierJackpot,
    coins: startCoins, win: round6(win),
  };
}

export function play(config, rng) {
  const syms = symbolMap(config);
  const R = config.rules;
  const { reels: RC, rows: RR } = config.grid;
  const lines = linesFor(RC, RR, R.lines);
  const { stops, grid } = spinStrips(rng, config.reels, RR);
  const wins = evaluateLines(grid, lines, syms);
  const coinPos = findSymbols(grid, (s) => syms.get(s)?.type === 'coin');
  const coins = coinPos.map(([c, r]) => ({ c, r, ...coinValue(rng, R) }));
  let total = sumPays(wins);
  let holdAndWin = null;
  if (coins.length >= R.triggerCount && R.holdMode === 'pick') {
    holdAndWin = pickHoldBonus(config, rng, coins);
    total += holdAndWin.win;
  } else if (coins.length >= R.triggerCount) {
    const cells = RC * RR;
    const held = new Map(coins.map((k) => [`${k.c},${k.r}`, k]));
    const respins = [];
    let left = R.respins;
    while (left > 0 && held.size < cells) {
      left--;
      const landed = [];
      let extra = 0;
      for (let c = 0; c < RC; c++) {
        for (let r = 0; r < RR; r++) {
          const key = `${c},${r}`;
          if (held.has(key)) continue;
          if (rng.int(1_000_000) < R.landChance * 1_000_000) {
            // Monedas especiales (opcional): multiplicador o +1 re-giro
            let special = null;
            if (R.specialCoins?.length && rng.int(1_000_000) < (R.specialChance || 0) * 1_000_000) special = weightedPick(rng, R.specialCoins);
            const coin = special?.special === 'multiplier'
              ? { c, r, value: 0, special: 'multiplier', mult: special.mult }
              : { c, r, ...coinValue(rng, R), ...(special ? { special: special.special } : {}) };
            if (coin.special === 'respin') extra++;
            held.set(key, coin); landed.push(coin);
          }
        }
      }
      if (landed.length) left = R.respins + extra;
      respins.push({ landed, respinsLeft: left });
    }
    const all = [...held.values()];
    const full = held.size === cells;
    let win = all.reduce((a, k) => a + k.value, 0);
    // Los multiplicadores se suman entre sí y multiplican el total de monedas
    const multSum = all.filter((k) => k.special === 'multiplier').reduce((a, k) => a + k.mult, 0);
    if (multSum > 0) win *= multSum;
    if (full) win += R.jackpots.grand;
    holdAndWin = { coins: all, respins, full, multiplier: multSum || 1, win: round6(win) };
    total += holdAndWin.win;
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, stops, grid, wins, coins, holdAndWin, totalWin: capped, capped: wasCapped };
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config)];
  const R = config.rules || {};
  const g = config.grid || {};
  const maxL = g.reels ? maxLines(g.reels, g.rows) : 20;
  if (!Number.isInteger(R.lines) || R.lines < 1 || R.lines > maxL) errors.push(`rules.lines (líneas de pago) debe estar entre 1 y ${maxL} para esta cuadrícula`);
  if (g.reels && R.triggerCount >= g.reels * g.rows) errors.push('rules.triggerCount debe ser menor que el total de celdas');
  if (!config.symbols?.some((s) => s.type === 'coin')) errors.push('Hold & Win necesita un símbolo de tipo "coin"');
  if (!(R.landChance > 0 && R.landChance < 0.5)) errors.push('rules.landChance debe estar entre 0 y 0.5');
  if (!(R.triggerCount >= 3 && R.triggerCount <= 30)) errors.push('rules.triggerCount debe estar entre 3 y 30');
  if (!Array.isArray(R.coinValues) || !R.coinValues.length) errors.push('rules.coinValues no puede estar vacío');
  for (const cv of R.coinValues || []) {
    if (cv.jackpot && !(cv.jackpot in (R.jackpots || {}))) errors.push(`Jackpot desconocido: ${cv.jackpot}`);
    if (!(cv.weight > 0)) errors.push('Cada coinValue necesita weight > 0');
  }
  if (!R.jackpots?.grand) errors.push('rules.jackpots.grand es obligatorio');
  for (const sc of R.specialCoins || []) {
    if (!['multiplier', 'respin'].includes(sc.special) || !(sc.weight > 0)) errors.push('rules.specialCoins: cada una necesita special "multiplier" o "respin" y weight > 0');
    if (sc.special === 'multiplier' && !(sc.mult >= 2)) errors.push('Moneda multiplicadora: mult debe ser >= 2');
  }
  if (R.specialCoins?.length && !(R.specialChance > 0 && R.specialChance < 1)) errors.push('rules.specialChance debe estar entre 0 y 1');
  if (R.holdMode != null && !['pick', 'auto'].includes(R.holdMode)) errors.push('rules.holdMode debe ser "pick" (el jugador elige) o "auto" (re-giros clásicos)');
  if (R.holdMode === 'pick') {
    if (!(Number.isInteger(R.rounds) && R.rounds >= 1 && R.rounds <= 10)) errors.push('rules.rounds (rondas del bonus) debe estar entre 1 y 10');
    if (!(R.candidatesMin >= 1 && R.candidatesMax >= R.candidatesMin && R.candidatesMax <= 10)) errors.push('rules.candidatesMin/candidatesMax: entre 1 y 10, y el mínimo no puede superar al máximo');
    if (!(R.holdGrowth >= 0 && R.holdGrowth <= 0.5)) errors.push('rules.holdGrowth (crecimiento al fijar) debe estar entre 0 y 0.5');
    if (!(R.injectSpecials >= 0 && R.injectSpecials <= 5)) errors.push('rules.injectSpecials debe estar entre 0 y 5');
    if (!(R.specialChance >= 0 && R.specialChance < 1)) errors.push('rules.specialChance debe estar entre 0 y 1');
    for (const sp of R.pickSpecials || []) {
      if (!['bonus', 'multiplier', 'jackpot', 'reset', 'extra_round'].includes(sp.type) || !(sp.weight > 0)) errors.push('rules.pickSpecials: type bonus, multiplier, jackpot, reset o extra_round y weight > 0');
      if ((sp.type === 'bonus' || sp.type === 'multiplier') && !(sp.min > 0 && sp.max >= sp.min)) errors.push(`Especial ${sp.type}: min > 0 y max >= min`);
      if (sp.type === 'multiplier' && !(Number.isInteger(sp.min) && Number.isInteger(sp.max) && sp.min >= 2)) errors.push('Especial multiplier: min y max enteros, min >= 2');
      if (sp.type === 'jackpot' && sp.jackpot && !(sp.jackpot in (R.jackpots || {}))) errors.push(`Especial jackpot: jackpot desconocido ${sp.jackpot}`);
    }
    for (const t of R.jackpotCounts || []) if (!(t.count >= 1) || !(t.jackpot in (R.jackpots || {}))) errors.push('rules.jackpotCounts: cada uno necesita count >= 1 y un jackpot existente');
  }
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
  for (const cv of config.rules.coinValues) if (cv.value != null) cv.value = round6(cv.value * k);
  for (const j of Object.keys(config.rules.jackpots)) config.rules.jackpots[j] = round6(config.rules.jackpots[j] * k);
  for (const sp of config.rules.pickSpecials || []) if (sp.type === 'bonus') { sp.min = round6(sp.min * k); sp.max = round6(sp.max * k); }
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { jack: 10, queen: 10, king: 9, ace: 9, horseshoe: 6, clover: 5, pot: 4, wild: 2, coin: 6 };
  return {
    engine: id,
    name: 'Monedas de la Suerte',
    grid: { reels: 5, rows: 5 },
    symbols: [
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#27ae60'), pays: { 3: 5, 4: 15, 5: 40 } },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#16a085'), pays: { 3: 5, 4: 15, 5: 40 } },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#d35400'), pays: { 3: 8, 4: 20, 5: 60 } },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#c0392b'), pays: { 3: 8, 4: 20, 5: 60 } },
      { id: 'horseshoe', name: 'Herradura', type: 'regular', image: ph('🧲', '#95a5a6'), pays: { 3: 15, 4: 50, 5: 150 } },
      { id: 'clover', name: 'Trébol', type: 'regular', image: ph('🍀', '#2ecc71'), pays: { 3: 20, 4: 75, 5: 250 } },
      { id: 'pot', name: 'Olla de oro', type: 'regular', image: ph('💰', '#f39c12'), pays: { 3: 40, 4: 150, 5: 500 } },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e74c3c'), pays: {} },
      { id: 'coin', name: 'Moneda', type: 'coin', image: ph('🪙', '#f1c40f'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(w, 4000 + i)),
    rules: {
      lines: 20, triggerCount: 7,
      // Diseño original: el jugador elige qué moneda fijar en cada ronda
      holdMode: 'pick', rounds: 3, candidatesMin: 2, candidatesMax: 4, injectSpecials: 3, holdGrowth: 0.1,
      coinValues: [
        { name: 'Bronce', value: 1, weight: 40 }, { name: 'Plata', value: 2, weight: 30 }, { name: 'Oro', value: 5, weight: 20 },
        { name: 'Platino', value: 10, weight: 10 }, { name: 'Diamante', value: 20, weight: 5 },
      ],
      pickSpecials: [
        { type: 'bonus', weight: 3, min: 5, max: 25 }, { type: 'multiplier', weight: 3, min: 2, max: 5 },
        { type: 'jackpot', jackpot: 'mini', weight: 1 }, { type: 'reset', weight: 2 }, { type: 'extra_round', weight: 2 },
      ],
      jackpotCounts: [{ count: 9, jackpot: 'mini' }, { count: 12, jackpot: 'minor' }, { count: 15, jackpot: 'major' }],
      jackpots: { mini: 20, minor: 50, major: 200, grand: 1000 },
      // Modo clásico (holdMode 'auto'): re-giros con monedas que caen solas
      respins: 3, landChance: 0.07,
      // Monedas especiales durante el bonus (inspiradas en el diseño enviado): multiplicador ×2/×3 y +1 re-giro
      specialChance: 0.15,
      specialCoins: [{ special: 'multiplier', mult: 2, weight: 50 }, { special: 'multiplier', mult: 3, weight: 20 }, { special: 'respin', weight: 30 }],
      maxWin: 5000,
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Monedas de la Suerte', background: null, backgroundColor: '#0b2410',
      palette: { primary: '#2ecc71', accent: '#f1c40f', panel: '#071a0b', text: '#ffffff', reelBg: '#113a1a' },
      font: 'Bungee',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, coin: null },
    rtpTarget: 0.96,
  };
}
