// Motor 15 — LEVEL UP (diseño original "Level Up / Progressive Bonus"): 5x3, 10 líneas, y un NIVEL DEL JUGADOR
// que se guarda en el servidor por jugador + juego + apuesta (no se puede subir de nivel con apuestas chicas y
// cobrar las recompensas con apuestas grandes).
// - Cada giro da XP (rules.xpPerSpin). Al llenar la barra se sube de nivel (cada nivel pide xpGrowth veces más XP).
// - DROP & COLLECT: cada SEMILLA que cae llena la barra de colección; al completar rules.collectTarget se sube un nivel.
// - 3+ semillas: BONUS DE COFRES (se elige 1 de 3): premio de rules.pickValues × la apuesta y XP extra; después
//   del bonus se sube un nivel (como el diseño original).
// - RECOMPENSAS por nivel (rules.rewards): multiplier (premios de línea × valor desde ese nivel), goldenSeed (desde ese
//   nivel pueden caer SEMILLAS DORADAS que duplican el cofre) y jackpot (al llegar paga valor × la apuesta y el
//   jugador vuelve al nivel 1).
// El estado entra y sale de cada jugada (play(config, rng, { state })) y queda guardado en la ronda para auditar
// y reproducir. El simulador lo arrastra de giro en giro: el RTP publicado es el promedio a largo plazo.
import {
  symbolMap, spinStrips, evaluateLines, sumPays, findSymbols, capWin, validateCommon, validateGrid, buildStrip,
  round6, weightedPick, linesFor, maxLines,
} from './common.js';

export const id = 'level-up';
export const name = 'Level Up';
export const description = 'El jugador sube de nivel girando: barra de XP, colección de semillas, bonus de cofres y recompensas por nivel (multiplicador, semillas doradas y jackpot) guardadas por jugador y apuesta.';
export const paysBy = 'lines';
export const stateful = true;

export const initialState = () => ({ level: 1, xp: 0, collect: 0 });

/** XP que pide el nivel L para pasar al siguiente. */
export const xpNeeded = (R, level) => Math.round((R.xpBase || 100) * (R.xpGrowth || 1.3) ** (level - 1));

/** Recompensas activas en un nivel: multiplicador (el mayor alcanzado) y semillas doradas. */
export function perksAt(R, level) {
  let mult = 1, golden = false;
  for (const rw of R.rewards || []) {
    if (rw.level > level) continue;
    if (rw.type === 'multiplier') mult = Math.max(mult, rw.value || 1);
    if (rw.type === 'goldenSeed') golden = true;
  }
  return { mult, golden };
}

/** Saneamiento del estado guardado (por si cambió la configuración). */
export function cleanState(R, s) {
  const max = R.maxLevel || 15;
  const level = Math.min(max, Math.max(1, Math.floor(Number(s?.level) || 1)));
  return { level, xp: Math.max(0, Math.min(xpNeeded(R, level) - 1, Math.floor(Number(s?.xp) || 0))), collect: Math.max(0, Math.min((R.collectTarget || 10) - 1, Math.floor(Number(s?.collect) || 0))) };
}

export function play(config, rng, { state = null } = {}) {
  const syms = symbolMap(config);
  const R = config.rules;
  const before = cleanState(R, state || initialState());
  const st = { ...before };
  const perks = perksAt(R, st.level);
  const lines = linesFor(config.grid.reels, config.grid.rows, R.lines);
  const { stops, grid } = spinStrips(rng, config.reels, config.grid.rows);
  const wins = evaluateLines(grid, lines, syms);
  const lineWin = round6(sumPays(wins) * perks.mult);
  const seeds = findSymbols(grid, (sid) => syms.get(sid)?.type === 'scatter');
  // Semillas doradas (solo con la recompensa desbloqueada)
  const golden = perks.golden && R.goldenChance > 0 ? seeds.filter(() => rng.int(1_000_000) < R.goldenChance * 1_000_000) : [];
  let total = lineWin;
  const levelUps = [];
  let jackpot = null;
  const max = R.maxLevel || 15;

  const gainLevel = (why) => {
    if (jackpot) return;
    st.level = Math.min(max, st.level + 1);
    st.xp = 0;
    const rewards = (R.rewards || []).filter((rw) => rw.level === st.level);
    levelUps.push({ level: st.level, why, rewards: rewards.map((rw) => ({ type: rw.type, value: rw.value ?? null })) });
    const jp = rewards.find((rw) => rw.type === 'jackpot');
    if (jp || st.level >= max) {
      // Jackpot del último nivel: se cobra y el jugador vuelve a empezar
      const value = jp?.value ?? 0;
      jackpot = { level: st.level, value };
      total += value;
      st.level = 1; st.xp = 0; st.collect = 0;
    }
  };
  const addXp = (n) => {
    st.xp += n;
    while (!jackpot && st.xp >= xpNeeded(R, st.level)) {
      const carry = st.xp - xpNeeded(R, st.level);
      gainLevel('xp');
      if (!jackpot) st.xp = carry;
    }
  };

  // Drop & Collect: cada semilla llena la barra de colección
  const collect = { before: st.collect, added: seeds.length, target: R.collectTarget || 10, completed: false };
  if (seeds.length && R.collectTarget > 0) {
    st.collect += seeds.length;
    if (st.collect >= R.collectTarget) { st.collect -= R.collectTarget; collect.completed = true; gainLevel('collect'); }
  }
  collect.after = st.collect;

  // Bonus de cofres
  let bonus = null;
  if (seeds.length >= R.triggerCount) {
    const value = weightedPick(rng, R.pickValues).value;
    const others = [weightedPick(rng, R.pickValues).value, weightedPick(rng, R.pickValues).value];
    const gm = golden.length ? (R.goldenMult || 2) : 1;
    const win = round6(value * gm);
    const xp = (R.bonusXpBase || 0) + value * (R.bonusXpPerValue || 0);
    bonus = { value, others, goldenMult: gm, win, xp, chests: 3 };
    total += win;
    addXp(xp);
    if (R.bonusLevelUp !== false) gainLevel('bonus');
  } else addXp(R.xpPerSpin || 0);

  const { total: capped, capped: wasCapped } = capWin(total, config);
  return {
    engine: id, stops, grid, wins, lineWin, levelMult: perks.mult, seeds, golden, collect,
    ...(bonus ? { bonus } : {}), levelUps, jackpot, xpNeed: xpNeeded(R, st.level),
    stateBefore: before, state: { ...st }, totalWin: capped, capped: wasCapped,
  };
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config)];
  const R = config.rules || {};
  const g = config.grid || {};
  const maxL = g.reels ? maxLines(g.reels, g.rows) : 20;
  if (!Number.isInteger(R.lines) || R.lines < 1 || R.lines > maxL) errors.push(`rules.lines debe estar entre 1 y ${maxL}`);
  if (!config.symbols?.some((s) => s.type === 'scatter')) errors.push('Level Up necesita un símbolo scatter (la semilla)');
  if (!(Number.isInteger(R.maxLevel) && R.maxLevel >= 2 && R.maxLevel <= 100)) errors.push('rules.maxLevel debe estar entre 2 y 100');
  if (!(R.xpBase >= 1)) errors.push('rules.xpBase (XP del nivel 1) debe ser >= 1');
  if (!(R.xpGrowth >= 1 && R.xpGrowth <= 3)) errors.push('rules.xpGrowth debe estar entre 1 y 3');
  if (!(R.xpPerSpin >= 0)) errors.push('rules.xpPerSpin debe ser >= 0');
  if (!(Number.isInteger(R.collectTarget) && R.collectTarget >= 0 && R.collectTarget <= 1000)) errors.push('rules.collectTarget debe estar entre 0 (sin colección) y 1000');
  if (!(R.triggerCount >= 2 && R.triggerCount <= 6)) errors.push('rules.triggerCount (semillas para el bonus) debe estar entre 2 y 6');
  if (!Array.isArray(R.pickValues) || !R.pickValues.length || R.pickValues.some((p) => !(p.value >= 0 && p.weight > 0))) errors.push('rules.pickValues debe ser [{value >= 0, weight > 0}]');
  if (R.goldenChance != null && !(R.goldenChance >= 0 && R.goldenChance <= 1)) errors.push('rules.goldenChance debe estar entre 0 y 1');
  for (const rw of R.rewards || []) {
    if (!['multiplier', 'goldenSeed', 'jackpot'].includes(rw.type)) errors.push(`Recompensa desconocida: ${rw.type}`);
    if (!(Number.isInteger(rw.level) && rw.level >= 2 && rw.level <= (R.maxLevel || 15))) errors.push(`Recompensa ${rw.type}: el nivel debe estar entre 2 y ${R.maxLevel || 15}`);
    if ((rw.type === 'multiplier' && !(rw.value >= 1)) || (rw.type === 'jackpot' && !(rw.value >= 0))) errors.push(`Recompensa ${rw.type}: valor inválido`);
  }
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
  for (const p of config.rules.pickValues) p.value = round6(p.value * k);
  for (const rw of config.rules.rewards || []) if (rw.type === 'jackpot') rw.value = round6(rw.value * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  // Semillas solo en los rodillos 1, 3 y 5 (como el diseño original)
  const base = { cherry: 12, lemon: 10, grape: 8, bell: 5, diamond: 3, seven: 2, wild: 2 };
  const w = (c) => ([1, 3, 5].includes(c) ? { ...base, seed: 3 } : base);
  return {
    engine: id,
    name: 'Huerta Dorada',
    grid: { reels: 5, rows: 3 },
    symbols: [
      { id: 'cherry', name: 'Cereza', type: 'regular', image: ph('🍒', '#c0392b'), pays: { 3: 4, 4: 10, 5: 30 } },
      { id: 'lemon', name: 'Limón', type: 'regular', image: ph('🍋', '#f1c40f'), pays: { 3: 5, 4: 15, 5: 40 } },
      { id: 'grape', name: 'Uvas', type: 'regular', image: ph('🍇', '#8e44ad'), pays: { 3: 8, 4: 25, 5: 75 } },
      { id: 'bell', name: 'Campana', type: 'regular', image: ph('🔔', '#f39c12'), pays: { 3: 15, 4: 50, 5: 150 } },
      { id: 'diamond', name: 'Diamante', type: 'regular', image: ph('💎', '#3498db'), pays: { 3: 30, 4: 100, 5: 400 } },
      { id: 'seven', name: 'Siete', type: 'regular', image: ph('7', '#e74c3c'), pays: { 3: 50, 4: 250, 5: 1000 } },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#2ecc71'), pays: {} },
      { id: 'seed', name: 'Semilla', type: 'scatter', image: ph('🌱', '#27ae60'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5].map((c) => buildStrip(w(c), 15000 + c)),
    rules: {
      lines: 10, triggerCount: 3,
      // Niveles: 15, cada uno pide 1,3 veces la XP del anterior (100 XP el primero)
      maxLevel: 15, xpBase: 100, xpGrowth: 1.3, xpPerSpin: 5,
      // Drop & Collect: 150 semillas suben un nivel
      collectTarget: 150,
      // Bonus de cofres: premio × la apuesta, XP = 10 + 5 × premio, y sube un nivel
      pickValues: [{ value: 1, weight: 30 }, { value: 2, weight: 28 }, { value: 3, weight: 20 }, { value: 4, weight: 13 }, { value: 5, weight: 9 }],
      bonusXpBase: 10, bonusXpPerValue: 5, bonusLevelUp: true,
      goldenChance: 0.25, goldenMult: 2,
      rewards: [
        { level: 5, type: 'multiplier', value: 1.1 },
        { level: 8, type: 'goldenSeed' },
        { level: 10, type: 'multiplier', value: 1.2 },
        { level: 15, type: 'jackpot', value: 50 },
      ],
      maxWin: 5000,
    },
    bet: { levels: [10, 20, 50, 100, 200, 500, 1000], default: 100, currency: 'USD' },
    theme: {
      title: 'Huerta Dorada', background: null, backgroundColor: '#0f0c29',
      palette: { primary: '#9b59b6', accent: '#ffd700', panel: '#1e1e1e', text: '#ffffff', reelBg: '#302b63' },
      font: 'Bungee',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null, coin: null },
    rtpTarget: 0.96,
  };
}
