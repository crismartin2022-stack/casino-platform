// Utilidades matemáticas compartidas por los 5 motores.
// Toda la matemática trabaja en MÚLTIPLOS DE LA APUESTA TOTAL.
// La conversión a dinero (centavos) la hace services/rounds.js.

export const round6 = (x) => Math.round(x * 1e6) / 1e6;

export function symbolMap(config) {
  const m = new Map();
  for (const s of config.symbols) m.set(s.id, s);
  return m;
}

export function weightedPick(rng, items, weightKey = 'weight') {
  let total = 0;
  for (const it of items) total += it[weightKey];
  let r = rng.int(total);
  for (const it of items) {
    r -= it[weightKey];
    if (r < 0) return it;
  }
  return items[items.length - 1];
}

/** Ventana visible de una tira de rodillo, con vuelta circular. */
export function stripWindow(strip, stop, height) {
  const out = new Array(height);
  for (let i = 0; i < height; i++) out[i] = strip[(stop + i) % strip.length];
  return out;
}

export function spinStrips(rng, strips, heights) {
  const stops = strips.map((s) => rng.int(s.length));
  const grid = strips.map((s, c) => stripWindow(s, stops[c], Array.isArray(heights) ? heights[c] : heights));
  return { stops, grid };
}

const payFor = (sym, count) => {
  if (!sym || !sym.pays) return 0;
  return sym.pays[String(count)] || 0;
};

/**
 * Evaluación "ways" (243 / 1024 / Megaways): un símbolo paga si aparece en rodillos
 * consecutivos desde la izquierda. Pago = paytable[n] × producto de apariciones.
 * El comodín (type 'wild') sustituye a los símbolos regulares.
 */
export function evaluateWays(grid, syms, { minCount = 3 } = {}) {
  const wins = [];
  const regular = [];
  for (const s of syms.values()) if (s.type === 'regular' || s.type === undefined) regular.push(s);
  for (const sym of regular) {
    let ways = 1, reels = 0;
    const positions = [];
    for (let c = 0; c < grid.length; c++) {
      let n = 0;
      for (let r = 0; r < grid[c].length; r++) {
        const id = grid[c][r];
        const t = syms.get(id)?.type;
        if (id === sym.id || t === 'wild') { n++; positions.push([c, r]); }
      }
      if (n === 0) break;
      ways *= n; reels++;
    }
    if (reels >= minCount) {
      const p = payFor(sym, reels);
      if (p > 0) {
        // Descarta posiciones de rodillos más allá de la racha
        wins.push({ symbol: sym.id, count: reels, ways, pay: round6(p * ways), positions: positions.filter(([c]) => c < reels) });
      }
    }
  }
  return wins;
}

/**
 * Evaluación por líneas. `lines` es un array de arrays con el índice de fila por rodillo.
 * Los pagos de la tabla son múltiplos de la APUESTA POR LÍNEA (apuesta total / nº de líneas).
 */
export function evaluateLines(grid, lines, syms) {
  const wins = [];
  const lineBet = 1 / lines.length;
  lines.forEach((line, li) => {
    let base = null;
    for (let c = 0; c < line.length; c++) {
      const id = grid[c][line[c]];
      const t = syms.get(id)?.type;
      if (t === 'wild') continue;
      if (t !== 'regular' && t !== undefined) break;
      base = id; break;
    }
    if (!base) return;
    let count = 0;
    for (let c = 0; c < line.length; c++) {
      const id = grid[c][line[c]];
      if (id === base || syms.get(id)?.type === 'wild') count++;
      else break;
    }
    const p = payFor(syms.get(base), count);
    if (p > 0) {
      wins.push({
        symbol: base, line: li, count, pay: round6(p * lineBet),
        positions: line.slice(0, count).map((r, c) => [c, r]),
      });
    }
  });
  return wins;
}

export function findSymbols(grid, predicate) {
  const out = [];
  grid.forEach((col, c) => col.forEach((id, r) => { if (predicate(id)) out.push([c, r]); }));
  return out;
}

export const sumPays = (wins) => round6(wins.reduce((a, w) => a + w.pay, 0));

export const cloneGrid = (g) => g.map((c) => c.slice());

/** Líneas estándar 5x3 (hasta 20). */
export const LINES_5x3 = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 2, 0, 2, 0], [2, 0, 2, 0, 2], [0, 2, 2, 2, 0],
];

/** Construye una tira de rodillo a partir de pesos {symbolId: cantidad}, mezclada de forma determinista. */
export function buildStrip(weights, seed = 1) {
  const strip = [];
  for (const [id, n] of Object.entries(weights)) for (let i = 0; i < n; i++) strip.push(id);
  // Fisher-Yates con LCG determinista para que las tiras sean reproducibles.
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000);
  for (let i = strip.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }
  // Evita scatters/especiales adyacentes (pueden aparecer dos en la misma ventana).
  return strip;
}

export function capWin(total, config) {
  const cap = config.rules?.maxWin ?? 5000;
  return total > cap ? { total: cap, capped: true } : { total: round6(total), capped: false };
}

/** Validaciones comunes a todos los motores. Devuelve lista de errores en español. */
export function validateCommon(config, { reels, specialTypes = [] } = {}) {
  const errors = [];
  if (!config || typeof config !== 'object') return ['La configuración debe ser un objeto'];
  if (!Array.isArray(config.symbols) || config.symbols.length < 3) errors.push('Se necesitan al menos 3 símbolos');
  const ids = new Set();
  for (const s of config.symbols || []) {
    if (!s.id || typeof s.id !== 'string') errors.push('Todo símbolo necesita un id de texto');
    if (ids.has(s.id)) errors.push(`Símbolo duplicado: ${s.id}`);
    ids.add(s.id);
    const t = s.type || 'regular';
    if (!['regular', 'wild', 'scatter', 'coin', ...specialTypes].includes(t)) errors.push(`Tipo de símbolo desconocido: ${t}`);
    for (const [k, v] of Object.entries(s.pays || {})) {
      if (!/^\d+$/.test(k) || typeof v !== 'number' || v < 0 || !Number.isFinite(v)) errors.push(`Pago inválido en ${s.id}: ${k}=${v}`);
    }
  }
  if (!Array.isArray(config.reels)) errors.push('Faltan las tiras de rodillos (reels)');
  else {
    if (reels && config.reels.length !== reels) errors.push(`Se esperaban ${reels} tiras de rodillo y hay ${config.reels.length}`);
    config.reels.forEach((strip, i) => {
      if (!Array.isArray(strip) || strip.length < 10) errors.push(`La tira ${i + 1} debe tener al menos 10 posiciones`);
      else for (const id of strip) if (!ids.has(id)) { errors.push(`La tira ${i + 1} usa un símbolo inexistente: ${id}`); break; }
    });
  }
  const b = config.bet || {};
  if (!Array.isArray(b.levels) || !b.levels.length || b.levels.some((x) => !Number.isInteger(x) || x <= 0)) {
    errors.push('bet.levels debe ser una lista de apuestas en centavos (enteros > 0)');
  }
  return errors;
}
