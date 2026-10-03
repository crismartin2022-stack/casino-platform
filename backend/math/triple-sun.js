// Motor 18 — TRES SOLES: 5x3, 20 líneas, y tres SOLES de colores (rojo, dorado y azul) que se juntan en tres
// barras que NO se pierden entre giros: se guardan en el servidor por jugador + juego + apuesta (como Level Up,
// así no se llenan con apuestas chicas para cobrarlas con grandes).
// - Cada sol que cae suma 1 a la barra de su color. Al llenarla (rules.pots[color].target) se juega su bonus en
//   ese mismo giro y la barra vuelve a empezar (lo que sobra pasa a la próxima):
//     red   «Sol de fuego»: giros gratis con todos los premios × rules.pots.red.mult.
//     gold  «Sol de oro»: giros gratis; cada giro trae un multiplicador al azar (rules.pots.gold.mults).
//     blue  «Sol del cielo»: giros gratis; en cada giro aparecen de 1 a rules.pots.blue.wildsMax comodines extra.
//   Si se llenan varias barras a la vez se juegan todos esos bonus.
// - En los giros gratis los soles no suman (las barras quedan como estaban).
// El estado entra y sale de cada jugada (play(config, rng, { state })) y queda en la ronda para auditar y reproducir.
// El RTP publicado es el promedio a largo plazo (el simulador arrastra las barras de giro en giro); también se
// informa el RTP con las barras vacías.
import {
  symbolMap, spinStrips, evaluateLines, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip,
  round6, weightedPick, linesFor, maxLines, cloneGrid,
} from './common.js';

export const id = 'triple-sun';
export const name = 'Tres Soles';
export const description = 'Tres soles de colores llenan tres barras que se guardan por jugador y apuesta; cada barra llena da su propio bonus de giros gratis (×2 fijo, multiplicador al azar o comodines extra).';
export const paysBy = 'lines';
export const stateful = true;
export const COLORS = ['red', 'gold', 'blue'];

export const initialState = () => ({ red: 0, gold: 0, blue: 0 });

const targetOf = (R, c) => Math.max(1, Math.floor(R.pots?.[c]?.target || 10));

/** Saneamiento del estado guardado (por si cambió la configuración). */
export function cleanState(R, s) {
  const out = {};
  for (const c of COLORS) out[c] = Math.max(0, Math.min(targetOf(R, c) - 1, Math.floor(Number(s?.[c]) || 0)));
  return out;
}

/** Solo vista previa del borrador («forzar bonus»): todas las barras a un sol de llenarse. */
export const forceState = (config) => Object.fromEntries(COLORS.map((c) => [c, targetOf(config.rules, c) - 1]));

/** Datos para la pantalla (barras y lo que da cada una). */
export const progressInfo = (R) => Object.fromEntries(COLORS.map((c) => [c, { target: targetOf(R, c) }]));

const sunColor = (syms, sid) => (syms.get(sid)?.type === 'scatter' ? syms.get(sid).color : null);

function bonusRound(config, rng, syms, color) {
  const R = config.rules;
  const P = R.pots[color];
  const lines = linesFor(config.grid.reels, config.grid.rows, R.lines);
  const strips = config.freeSpinReels || config.reels;
  const wild = config.symbols.find((s) => s.type === 'wild')?.id;
  const spins = [];
  for (let i = 0; i < (P.spins || 8); i++) {
    const { stops, grid } = spinStrips(rng, strips, config.grid.rows);
    let added = null;
    if (color === 'blue' && wild) {
      // Comodines extra en casillas normales
      const cells = findSymbols(grid, (sid) => (syms.get(sid)?.type || 'regular') === 'regular');
      const k = Math.min(cells.length, 1 + rng.int(Math.max(1, P.wildsMax || 3)));
      added = [];
      for (let j = 0; j < k; j++) { const [c, r] = cells.splice(rng.int(cells.length), 1)[0]; grid[c][r] = wild; added.push([c, r]); }
    }
    const mult = color === 'red' ? (P.mult || 2) : color === 'gold' ? weightedPick(rng, P.mults).value : 1;
    const wins = evaluateLines(grid, lines, syms);
    const base = sumPays(wins);
    spins.push({ stops, grid: cloneGrid(grid), wins, mult, ...(added ? { wilds: added } : {}), win: round6(base * mult) });
  }
  return { color, spins, totalWin: round6(spins.reduce((a, s) => a + s.win, 0)) };
}

export function play(config, rng, { state = null } = {}) {
  const syms = symbolMap(config);
  const R = config.rules;
  const before = cleanState(R, state || initialState());
  const st = { ...before };
  const lines = linesFor(config.grid.reels, config.grid.rows, R.lines);
  const { stops, grid } = spinStrips(rng, config.reels, config.grid.rows);
  const wins = evaluateLines(grid, lines, syms);
  const lineWin = sumPays(wins);
  const suns = findSymbols(grid, (sid) => !!sunColor(syms, sid)).map(([c, r]) => ({ c, r, color: sunColor(syms, grid[c][r]) }));
  const filled = [];
  for (const s of suns) st[s.color] += 1;
  for (const c of COLORS) {
    const t = targetOf(R, c);
    if (st[c] >= t) { st[c] -= t; filled.push(c); }
  }
  const bonuses = filled.map((c) => bonusRound(config, rng, syms, c));
  const total = lineWin + bonuses.reduce((a, b) => a + b.totalWin, 0);
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return {
    engine: id, stops, grid, wins, lineWin, suns, filled, bonuses,
    // Para el simulador: hubo bonus en este giro
    ...(bonuses.length ? { bonus: { colors: filled } } : {}),
    stateBefore: before, state: { ...st }, totalWin: capped, capped: wasCapped,
  };
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config)];
  const R = config.rules || {};
  const g = config.grid || {};
  const maxL = g.reels ? maxLines(g.reels, g.rows) : 20;
  if (!Number.isInteger(R.lines) || R.lines < 1 || R.lines > maxL) errors.push(`rules.lines debe estar entre 1 y ${maxL}`);
  for (const c of COLORS) {
    if (!config.symbols?.some((s) => s.type === 'scatter' && s.color === c)) errors.push(`Falta el sol ${c} (símbolo scatter con color "${c}")`);
    const P = R.pots?.[c];
    if (!P) { errors.push(`Falta rules.pots.${c}`); continue; }
    if (!(Number.isInteger(P.target) && P.target >= 1 && P.target <= 200)) errors.push(`rules.pots.${c}.target (soles para llenar la barra) debe estar entre 1 y 200`);
    if (!(Number.isInteger(P.spins) && P.spins >= 1 && P.spins <= 50)) errors.push(`rules.pots.${c}.spins (giros gratis) debe estar entre 1 y 50`);
  }
  if (R.pots?.red && !(R.pots.red.mult >= 1 && R.pots.red.mult <= 100)) errors.push('rules.pots.red.mult debe estar entre 1 y 100');
  const gm = R.pots?.gold?.mults;
  if (R.pots?.gold && (!Array.isArray(gm) || !gm.length || gm.some((m) => !(m.value >= 1 && m.weight > 0)))) errors.push('rules.pots.gold.mults debe ser [{value >= 1, weight > 0}]');
  if (R.pots?.blue && !(Number.isInteger(R.pots.blue.wildsMax) && R.pots.blue.wildsMax >= 1 && R.pots.blue.wildsMax <= 10)) errors.push('rules.pots.blue.wildsMax debe estar entre 1 y 10');
  if (!config.symbols?.some((s) => s.type === 'wild')) errors.push('Tres Soles necesita un comodín');
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const w = { ten: 40, jack: 40, queen: 36, king: 34, ace: 32, vase: 20, pegasus: 16, griffin: 13, god: 9, wild: 6, sunRed: 1, sunGold: 1, sunBlue: 1 };
  const fsw = { ...w, sunRed: 0, sunGold: 0, sunBlue: 0 };
  for (const k of Object.keys(fsw)) if (!fsw[k]) delete fsw[k];
  const p = (a, b, c) => ({ 3: a, 4: b, 5: c });
  return {
    engine: id,
    name: 'Tres Soles',
    grid: { reels: 5, rows: 3 },
    symbols: [
      { id: 'ten', name: '10', type: 'regular', image: ph('10', '#3498db'), pays: p(5, 10, 25) },
      { id: 'jack', name: 'J', type: 'regular', image: ph('J', '#1abc9c'), pays: p(5, 10, 25) },
      { id: 'queen', name: 'Q', type: 'regular', image: ph('Q', '#9b59b6'), pays: p(5, 12, 30) },
      { id: 'king', name: 'K', type: 'regular', image: ph('K', '#e67e22'), pays: p(8, 15, 40) },
      { id: 'ace', name: 'A', type: 'regular', image: ph('A', '#e74c3c'), pays: p(8, 20, 50) },
      { id: 'vase', name: 'Ánfora', type: 'regular', image: ph('🏺', '#d35400'), pays: p(10, 30, 80) },
      { id: 'pegasus', name: 'Caballo alado', type: 'regular', image: ph('🐎', '#ecf0f1'), pays: p(15, 40, 120) },
      { id: 'griffin', name: 'Grifo', type: 'regular', image: ph('🦅', '#f1c40f'), pays: p(20, 60, 200) },
      { id: 'god', name: 'Dios del sol', type: 'regular', image: ph('☀', '#f39c12'), pays: p(40, 120, 500) },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#c0392b'), pays: {} },
      { id: 'sunRed', name: 'Sol de fuego', type: 'scatter', color: 'red', image: ph('●', '#e74c3c'), pays: {} },
      { id: 'sunGold', name: 'Sol de oro', type: 'scatter', color: 'gold', image: ph('●', '#f1c40f'), pays: {} },
      { id: 'sunBlue', name: 'Sol del cielo', type: 'scatter', color: 'blue', image: ph('●', '#3498db'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(w, 18000 + i)),
    freeSpinReels: [1, 2, 3, 4, 5].map((i) => buildStrip(fsw, 18100 + i)),
    rules: {
      lines: 20,
      pots: {
        red: { target: 15, spins: 8, mult: 3, name: 'Sol de fuego' },
        gold: { target: 15, spins: 8, name: 'Sol de oro', mults: [{ value: 1, weight: 30 }, { value: 2, weight: 40 }, { value: 3, weight: 18 }, { value: 5, weight: 9 }, { value: 10, weight: 3 }] },
        blue: { target: 15, spins: 8, wildsMax: 2, name: 'Sol del cielo' },
      },
      maxWin: 5000,
    },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Tres Soles', background: null, backgroundColor: '#1a0f2e',
      palette: { primary: '#f39c12', accent: '#ffd76a', panel: '#120a20', text: '#ffffff', reelBg: '#2a1a45' },
      font: 'Cinzel Decorative',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, coin: null },
    rtpTarget: 0.96,
  };
}
