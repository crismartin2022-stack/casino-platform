// Motor 14 — CLÁSICO 3 RODILLOS: 3x3 de frutas, BAR y 7 con 1 a 5 líneas (3 filas y 2 diagonales).
// - 3 iguales en una línea pagan su premio; las cerezas pagan desde 1 a la izquierda.
// - Cualquier combinación de BAR (BAR, DOBLE BAR, TRIPLE BAR) paga rules.anyBarPay.
// - El COMODÍN reemplaza a todos y MULTIPLICA el premio de su línea ×rules.wildMult (dos comodines: ×wildMult²).
//   Tres comodines pagan su propio premio.
// - RODILLO MULTIPLICADOR (rules.multReel): un cuarto rodillo con ×1, ×2, ×3, ×5, ×10… que multiplica el premio del giro.
// Pagos en múltiplos de la apuesta POR LÍNEA (apuesta total / rules.lines).
import { symbolMap, spinStrips, capWin, validateCommon, buildStrip, round6, weightedPick } from './common.js';

export const id = 'classic-reels';
export const name = 'Clásico 3 rodillos';
export const description = 'Tragamonedas clásica 3x3 de frutas, BAR y 7: cerezas que pagan desde una, cualquier BAR, comodín que multiplica y un rodillo multiplicador hasta ×10.';
export const gridLimits = { reels: [3, 3], rows: [3, 3] };
export const paysBy = 'lines';

/** Las 5 líneas clásicas: central, superior, inferior y las dos diagonales. */
export const CLASSIC_LINES = [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
export const linesOf = (n) => CLASSIC_LINES.slice(0, Math.max(1, Math.min(5, n || 5)));

/** Mejor premio de una línea (en múltiplos de la apuesta por línea, antes de dividir). */
export function evaluateClassicLine(ids, syms, R) {
  const t = ids.map((x) => syms.get(x)?.type || 'regular');
  const wilds = t.filter((x) => x === 'wild').length;
  const wm = R.wildMult > 1 ? R.wildMult ** wilds : 1;
  let best = null;
  const offer = (w) => { if (w.pay > 0 && (!best || w.pay > best.pay)) best = w; };
  // Tres comodines
  if (wilds === 3) {
    const w = syms.get(ids[0]);
    offer({ symbol: ids[0], kind: 'three', count: 3, pay: w.pays?.['3'] || 0, cells: [0, 1, 2] });
  }
  // Tres iguales (los comodines reemplazan y multiplican)
  const regs = [...new Set(ids.filter((x, i) => t[i] === 'regular'))];
  if (regs.length === 1 && wilds < 3) {
    const s = syms.get(regs[0]);
    offer({ symbol: regs[0], kind: 'three', count: 3, pay: (s.pays?.['3'] || 0) * wm, wildMult: wm > 1 ? wm : undefined, cells: [0, 1, 2] });
  }
  // Cualquier BAR (mezcla de BAR con o sin comodines)
  if (R.anyBarPay > 0 && ids.every((x, i) => t[i] === 'wild' || syms.get(x)?.bar) && wilds < 3) {
    offer({ symbol: 'anyBar', kind: 'anyBar', count: 3, pay: R.anyBarPay * wm, wildMult: wm > 1 ? wm : undefined, cells: [0, 1, 2] });
  }
  // Cerezas desde la izquierda (sin comodines)
  const cherry = [...syms.values()].find((s) => s.cherry);
  if (cherry) {
    let n = 0;
    while (n < 3 && ids[n] === cherry.id) n++;
    if (n > 0) offer({ symbol: cherry.id, kind: 'cherry', count: n, pay: cherry.pays?.[String(n)] || 0, cells: [...Array(n).keys()] });
  }
  return best;
}

export function play(config, rng) {
  const syms = symbolMap(config);
  const R = config.rules;
  const lines = linesOf(R.lines);
  const { stops, grid } = spinStrips(rng, config.reels, 3);
  const wins = [];
  lines.forEach((line, li) => {
    const ids = line.map((r, c) => grid[c][r]);
    const w = evaluateClassicLine(ids, syms, R);
    if (w) wins.push({ symbol: w.symbol, kind: w.kind, line: li, count: w.count, ...(w.wildMult ? { wildMult: w.wildMult } : {}), pay: round6(w.pay / lines.length), positions: w.cells.map((c) => [c, line[c]]) });
  });
  const lineWin = round6(wins.reduce((a, w) => a + w.pay, 0));
  // Rodillo multiplicador: se gira siempre que esté activo (el resultado no depende del premio)
  const mult = R.multReel?.enabled && R.multReel.values?.length ? weightedPick(rng, R.multReel.values).value : 1;
  const total = round6(lineWin * mult);
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, stops, grid, wins, lineWin, multiplier: mult, totalWin: capped, capped: wasCapped };
}

export function validate(config) {
  const errors = [...validateCommon(config, { reels: 3 })];
  const g = config.grid || {};
  if (g.reels !== 3 || g.rows !== 3) errors.push('El Clásico usa una cuadrícula de 3 rodillos × 3 filas');
  const R = config.rules || {};
  if (!(Number.isInteger(R.lines) && R.lines >= 1 && R.lines <= 5)) errors.push('rules.lines (líneas) debe estar entre 1 y 5');
  if (!(R.wildMult >= 1 && R.wildMult <= 10)) errors.push('rules.wildMult (multiplicador del comodín) debe estar entre 1 y 10');
  if (!(R.anyBarPay >= 0)) errors.push('rules.anyBarPay debe ser >= 0');
  if (R.multReel?.enabled) {
    const v = R.multReel.values;
    if (!Array.isArray(v) || !v.length || v.some((x) => !(x.value >= 1 && x.weight > 0))) errors.push('rules.multReel.values debe ser [{value >= 1, weight > 0}]');
  }
  if ((config.symbols || []).filter((s) => s.cherry).length > 1) errors.push('Solo un símbolo puede ser la cereza (cherry: true)');
  if (R.anyBarPay > 0 && !(config.symbols || []).some((s) => s.bar)) errors.push('«Cualquier BAR» necesita símbolos marcados como BAR (bar: true)');
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
  config.rules.anyBarPay = round6((config.rules.anyBarPay || 0) * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { cherry: 7, lemon: 7, orange: 7, plum: 6, bell: 5, bar1: 6, bar2: 4, bar3: 3, seven: 2, wild: 1 };
  return {
    engine: id,
    name: 'Frutas de Oro',
    grid: { reels: 3, rows: 3 },
    symbols: [
      { id: 'cherry', name: 'Cereza', type: 'regular', cherry: true, image: ph('🍒', '#c0392b'), pays: { 1: 1, 2: 4, 3: 15 } },
      { id: 'lemon', name: 'Limón', type: 'regular', image: ph('🍋', '#f1c40f'), pays: { 3: 15 } },
      { id: 'orange', name: 'Naranja', type: 'regular', image: ph('🍊', '#e67e22'), pays: { 3: 20 } },
      { id: 'plum', name: 'Ciruela', type: 'regular', image: ph('🍇', '#8e44ad'), pays: { 3: 25 } },
      { id: 'bell', name: 'Campana', type: 'regular', image: ph('🔔', '#f39c12'), pays: { 3: 40 } },
      { id: 'bar1', name: 'BAR', type: 'regular', bar: true, image: ph('BAR', '#2c3e50'), pays: { 3: 50 } },
      { id: 'bar2', name: 'DOBLE BAR', type: 'regular', bar: true, image: ph('BAR BAR', '#34495e'), pays: { 3: 100 } },
      { id: 'bar3', name: 'TRIPLE BAR', type: 'regular', bar: true, image: ph('BAR³', '#1a252f'), pays: { 3: 200 } },
      { id: 'seven', name: 'Siete', type: 'regular', image: ph('7', '#e74c3c'), pays: { 3: 500 } },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#16a085'), pays: { 3: 1000 } },
    ],
    // En el primer rodillo hay menos cerezas (pagan desde una)
    reels: [1, 2, 3].map((i) => buildStrip(i === 1 ? { ...w, cherry: 2, lemon: 9, orange: 9 } : w, 14000 + i)),
    rules: {
      lines: 5, wildMult: 2, anyBarPay: 20,
      multReel: { enabled: true, values: [{ value: 1, weight: 70 }, { value: 2, weight: 18 }, { value: 3, weight: 7 }, { value: 5, weight: 4 }, { value: 10, weight: 1 }] },
      maxWin: 2500,
    },
    bet: { levels: [5, 10, 25, 50, 100, 200, 500, 1000], default: 50, currency: 'USD' },
    theme: {
      title: 'Frutas de Oro', background: null, backgroundColor: '#2b0a12',
      palette: { primary: '#c0392b', accent: '#ffd23f', panel: '#1a0509', text: '#ffffff', reelBg: '#3b0d18' },
      font: 'Bungee',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null },
    rtpTarget: 0.96,
  };
}
