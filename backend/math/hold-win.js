// Motor 4 — HOLD & WIN: 5x3, 10 líneas. 6+ monedas activan el bonus de re-giros:
// las monedas quedan fijas, hay 3 re-giros y cada moneda nueva los reinicia a 3.
// Llenar las 15 posiciones paga el jackpot GRAND.
import {
  symbolMap, spinStrips, evaluateLines, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip, round6, weightedPick, linesFor, maxLines,
} from './common.js';

export const id = 'hold-win';
export const name = 'Hold & Win';
export const description = 'Monedas con premio que quedan fijas durante re-giros; 4 jackpots (Mini, Minor, Major, Grand).';

function coinValue(rng, R) {
  const pick = weightedPick(rng, R.coinValues);
  if (pick.jackpot) return { jackpot: pick.jackpot, value: R.jackpots[pick.jackpot] };
  return { value: pick.value };
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
  if (coins.length >= R.triggerCount) {
    const cells = RC * RR;
    const held = new Map(coins.map((k) => [`${k.c},${k.r}`, k]));
    const respins = [];
    let left = R.respins;
    while (left > 0 && held.size < cells) {
      left--;
      const landed = [];
      for (let c = 0; c < RC; c++) {
        for (let r = 0; r < RR; r++) {
          const key = `${c},${r}`;
          if (held.has(key)) continue;
          if (rng.int(1_000_000) < R.landChance * 1_000_000) {
            const coin = { c, r, ...coinValue(rng, R) };
            held.set(key, coin); landed.push(coin);
          }
        }
      }
      if (landed.length) left = R.respins;
      respins.push({ landed, respinsLeft: left });
    }
    const all = [...held.values()];
    const full = held.size === cells;
    let win = all.reduce((a, k) => a + k.value, 0);
    if (full) win += R.jackpots.grand;
    holdAndWin = { coins: all, respins, full, win: round6(win) };
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
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
  for (const cv of config.rules.coinValues) if (cv.value != null) cv.value = round6(cv.value * k);
  for (const j of Object.keys(config.rules.jackpots)) config.rules.jackpots[j] = round6(config.rules.jackpots[j] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { jack: 10, queen: 10, king: 9, ace: 9, horseshoe: 6, clover: 5, pot: 4, wild: 2, coin: 8 };
  return {
    engine: id,
    name: 'Monedas de la Suerte',
    grid: { reels: 5, rows: 3 },
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
      lines: 10, triggerCount: 6, respins: 3, landChance: 0.07,
      coinValues: [
        { value: 1, weight: 400 }, { value: 2, weight: 250 }, { value: 3, weight: 150 }, { value: 5, weight: 100 },
        { value: 10, weight: 50 }, { value: 25, weight: 15 },
        { jackpot: 'mini', weight: 20 }, { jackpot: 'minor', weight: 8 }, { jackpot: 'major', weight: 2 },
      ],
      jackpots: { mini: 10, minor: 30, major: 150, grand: 1000 },
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
