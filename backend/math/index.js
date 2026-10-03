// Registro de motores + simulador de RTP + ajuste automático de la tabla de pagos.
import { validateBets } from './currency.js';
import * as reelRush from './reel-rush.js';
import * as megaways from './megaways.js';
import * as bonusBuy from './bonus-buy.js';
import * as holdWin from './hold-win.js';
import * as colossal from './colossal-reels.js';
import * as clusterPays from './cluster-pays.js';
import * as scatterPays from './scatter-pays.js';
import { RULE_SCHEMAS, ENGINE_CARDS } from './rule-schemas.js';
import { readFileSync } from 'node:fs';
import * as expanding from './expanding-symbol.js';
import * as stickyWilds from './sticky-wilds.js';
import * as megawaysCascade from './megaways-cascade.js';
import * as craps from './craps.js';
import * as treasureChests from './treasure-chests.js';
import * as cashCollect from './cash-collect.js';
import * as classicReels from './classic-reels.js';
import * as levelUp from './level-up.js';
import * as crash from './crash.js';
import { seededRng } from './rng.js';
import { buildStrip, round6, maxLines, GRID_LIMITS } from './common.js';

/** RTP permitido: 85 % a 110 %. Por encima de 100 % el juego paga más de lo que recauda (solo promociones o demo). */
export const RTP_RANGE = [0.85, 1.10];

export const ENGINES = {
  [reelRush.id]: reelRush,
  [megaways.id]: megaways,
  [bonusBuy.id]: bonusBuy,
  [holdWin.id]: holdWin,
  [colossal.id]: colossal,
  [clusterPays.id]: clusterPays,
  [scatterPays.id]: scatterPays,
  [expanding.id]: expanding,
  [stickyWilds.id]: stickyWilds,
  [megawaysCascade.id]: megawaysCascade,
  [treasureChests.id]: treasureChests,
  [cashCollect.id]: cashCollect,
  [classicReels.id]: classicReels,
  [levelUp.id]: levelUp,
  [craps.id]: craps,
  [crash.id]: crash,
};

/** Modos de compra de un motor, con acceso a su precio. */
export function buyModesOf(engine, config) {
  if (engine.buyModes) return engine.buyModes(config);
  if (engine.modes?.includes('buy')) return [{ mode: 'buy', get: (c) => c.rules.buyCost, set: (c, v) => { c.rules.buyCost = v; } }];
  return [];
}

/** Motores que pagan por líneas (tienen rules.lines configurable). */
export const LINE_ENGINES = ['bonus-buy', 'hold-win', 'expanding-symbol', 'sticky-wilds'];
/** Motores de altura variable por rodillo (sin filas fijas). */
export const VARIABLE_ROW_ENGINES = ['megaways', 'megaways-cascade'];

export function engineGridLimits(engineId) {
  const e = ENGINES[engineId];
  if (e?.gridLimits) return { reels: e.gridLimits.reels || GRID_LIMITS.reels, rows: e.gridLimits.rows || GRID_LIMITS.rows };
  if (engineId === 'megaways' || engineId === 'colossal-reels') return { reels: [4, 8], rows: GRID_LIMITS.rows };
  return GRID_LIMITS;
}

/** ¿Es una tragamonedas (rodillos, simulación y ajuste de RTP)? Mesa (craps) y Crash no lo son. */
export const isSlot = (e) => !e?.kind || e.kind === 'slot';

export function getEngine(id) {
  const e = ENGINES[id];
  if (!e) throw Object.assign(new Error(`Motor desconocido: ${id}`), { status: 400 });
  return e;
}

// Ficha de cada motor: lo que muestra la semilla calibrada (volatilidad, frecuencia, compra) para elegir motor
let seedMath = null;
function seedMathOf(id) {
  if (!seedMath) {
    seedMath = {};
    for (const x of Object.keys(ENGINES)) {
      try { seedMath[x] = JSON.parse(readFileSync(new URL(`../games/seed/${x}.json`, import.meta.url), 'utf8')).math || null; } catch { seedMath[x] = null; }
    }
  }
  return seedMath[id];
}

export const engineList = () => Object.values(ENGINES).map((e) => {
  const m = seedMathOf(e.id);
  return {
    id: e.id, name: e.name, description: e.description, modes: e.modes || ['base'],
    kind: e.kind || 'slot',
    paysBy: !isSlot(e) ? e.kind : e.paysBy || (LINE_ENGINES.includes(e.id) ? 'lines' : 'ways'), gridLimits: engineGridLimits(e.id),
    variableRows: VARIABLE_ROW_ENGINES.includes(e.id),
    card: {
      ...(ENGINE_CARDS[e.id] || {}),
      ...(m ? { rtp: m.rtp, volatility: m.volatility || null, hitFrequency: m.hitFrequency ?? null, featureEvery: m.featureEvery ?? null,
        buy: (m.buyOptions || []).map((b) => ({ mode: b.mode, cost: b.cost })) } : {}),
    },
    ruleSchema: RULE_SCHEMAS[e.id] || [],
  };
});

export function costMultiplier(engine, config, mode = 'base') {
  return engine.costMultiplier ? engine.costMultiplier(config, mode) : 1;
}

export function validateConfig(config) {
  if (!config?.engine) return ['Falta el campo engine'];
  const e = ENGINES[config.engine];
  if (!e) return [`Motor desconocido: ${config.engine}`];
  const errs = [...e.validate(config), ...validateBets(config)];
  if (!isSlot(e)) { if (!config.theme || typeof config.theme !== 'object') errs.push('Falta theme'); return errs; }
  if (!(config.rtpTarget >= RTP_RANGE[0] && config.rtpTarget <= RTP_RANGE[1])) errs.push(`rtpTarget debe estar entre ${RTP_RANGE[0]} y ${RTP_RANGE[1]} (85 % a 110 %)`);
  if (!config.theme || typeof config.theme !== 'object') errs.push('Falta theme');
  return errs;
}

/**
 * Simulación Monte Carlo. Devuelve RTP con intervalo de confianza del 95 %,
 * frecuencia de premio, frecuencia de bonus, volatilidad y premio máximo observado.
 */
export function simulate(config, { spins = 200_000, mode = 'base', seed = 12345, timeBudgetMs = 20_000, freshState = false } = {}) {
  const engine = getEngine(config.engine);
  if (!isSlot(engine)) throw Object.assign(new Error(engine.kind === 'crash' ? 'En Crash el RTP es exacto: se fija en Matemática (rules.rtp)' : 'En los juegos de mesa el RTP se calcula exacto: mira la tabla de apuestas'), { status: 400 });
  const rng = seededRng(seed);
  const cost = costMultiplier(engine, config, mode);
  let sum = 0, sumSq = 0, hits = 0, features = 0, maxWin = 0, n = 0, capped = 0;
  const buckets = { '0': 0, '0-1x': 0, '1-5x': 0, '5-20x': 0, '20-100x': 0, '100-1000x': 0, '1000x+': 0 };
  const t0 = Date.now();
  // Motores con estado del jugador (Level Up): el estado pasa de un giro al siguiente, como un jugador real.
  // freshState = true mide el juego siempre desde el estado inicial (ej. RTP en el nivel 1).
  let state = engine.stateful ? engine.initialState(config) : undefined;
  for (; n < spins; n++) {
    if ((n & 1023) === 0 && Date.now() - t0 > timeBudgetMs) break;
    const res = engine.play(config, rng, engine.stateful ? { mode, state: freshState ? engine.initialState(config) : state } : { mode });
    if (engine.stateful) state = res.state;
    const w = res.totalWin / cost; // retorno por unidad apostada
    sum += w; sumSq += w * w;
    if (res.totalWin > 0) hits++;
    if (res.freeSpins || res.holdAndWin || res.bonus) features++;
    if (res.capped) capped++;
    if (res.totalWin > maxWin) maxWin = res.totalWin;
    const x = res.totalWin;
    buckets[x === 0 ? '0' : x < 1 ? '0-1x' : x < 5 ? '1-5x' : x < 20 ? '5-20x' : x < 100 ? '20-100x' : x < 1000 ? '100-1000x' : '1000x+']++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const sd = Math.sqrt(variance);
  const ci = 1.96 * sd / Math.sqrt(n);
  const r = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    engine: config.engine, mode, spins: n, ms: Date.now() - t0,
    rtp: r(mean), rtpLow: r(mean - ci), rtpHigh: r(mean + ci),
    hitFrequency: r(hits / n), featureFrequency: r(features / n),
    featureEvery: features ? Math.round(n / features) : null,
    volatilitySd: r(sd, 2), volatility: sd < 3 ? 'baja' : sd < 8 ? 'media' : sd < 20 ? 'alta' : 'muy alta',
    maxWinObserved: r(maxWin, 2), cappedRounds: capped,
    distribution: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, r(v / n, 5)])),
    costMultiplier: cost,
    raw: { n, sum, sumSq, hits, features, capped, maxWin, buckets },
  };
}

/**
 * Simulación por lotes con semillas distintas hasta lograr la precisión pedida (semiancho del IC 95 % del RTP)
 * o agotar el tiempo / los giros. Así la precisión se adapta a la volatilidad de cada juego.
 * opts: { mode, seed, targetHalf (0,003 = ±0,3 %), budgetMs, minSpins, maxSpins, chunk }
 */
export function simulatePooled(config, { mode = 'base', seed = 1, targetHalf = 0.003, budgetMs = 45_000, minSpins = 0, maxSpins = 50_000_000, chunk = 400_000 } = {}) {
  const t0 = Date.now();
  const A = { n: 0, sum: 0, sumSq: 0, hits: 0, features: 0, capped: 0, maxWin: 0, buckets: {} };
  let cost = 1, batches = 0;
  while (true) {
    const left = budgetMs - (Date.now() - t0);
    const sim = simulate(config, { spins: Math.min(chunk, maxSpins - A.n), mode, seed: seed + batches * 7919, timeBudgetMs: Math.max(1000, left) });
    batches++;
    cost = sim.costMultiplier;
    const R = sim.raw;
    A.n += R.n; A.sum += R.sum; A.sumSq += R.sumSq; A.hits += R.hits; A.features += R.features; A.capped += R.capped; A.maxWin = Math.max(A.maxWin, R.maxWin);
    for (const [k, v] of Object.entries(R.buckets)) A.buckets[k] = (A.buckets[k] || 0) + v;
    const mean = A.sum / A.n, sd = Math.sqrt(Math.max(0, A.sumSq / A.n - mean * mean)), half = 1.96 * sd / Math.sqrt(A.n);
    if (A.n >= maxSpins || (Date.now() - t0 >= budgetMs && A.n >= Math.min(minSpins, maxSpins)) || (half <= targetHalf && A.n >= minSpins)) break;
  }
  const n = A.n, mean = A.sum / n, sd = Math.sqrt(Math.max(0, A.sumSq / n - mean * mean)), ci = 1.96 * sd / Math.sqrt(n);
  const r = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    engine: config.engine, mode, spins: n, ms: Date.now() - t0, batches,
    rtp: r(mean), rtpLow: r(mean - ci), rtpHigh: r(mean + ci), precision: r(ci, 5),
    hitFrequency: r(A.hits / n), featureFrequency: r(A.features / n), featureEvery: A.features ? Math.round(n / A.features) : null,
    volatilitySd: r(sd, 2), volatility: sd < 3 ? 'baja' : sd < 8 ? 'media' : sd < 20 ? 'alta' : 'muy alta',
    maxWinObserved: r(A.maxWin, 2), cappedRounds: A.capped,
    distribution: Object.fromEntries(Object.entries(A.buckets).map(([k, v]) => [k, r(v / n, 5)])),
    costMultiplier: cost,
    raw: A,
  };
}

/** Une resultados de simulatePooled hechos en paralelo (semillas distintas) en una sola estimación. */
export function combinePooled(parts, { engine, mode = 'base', ms = 0 } = {}) {
  const A = { n: 0, sum: 0, sumSq: 0, hits: 0, features: 0, capped: 0, maxWin: 0, buckets: {} };
  for (const p of parts) {
    const R = p.raw;
    A.n += R.n; A.sum += R.sum; A.sumSq += R.sumSq; A.hits += R.hits; A.features += R.features; A.capped += R.capped; A.maxWin = Math.max(A.maxWin, R.maxWin);
    for (const [k, v] of Object.entries(R.buckets)) A.buckets[k] = (A.buckets[k] || 0) + v;
  }
  const n = A.n, mean = A.sum / n, sd = Math.sqrt(Math.max(0, A.sumSq / n - mean * mean)), ci = 1.96 * sd / Math.sqrt(n);
  const r = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    engine, mode, spins: n, ms, batches: parts.reduce((a, p) => a + (p.batches || 1), 0), threads: parts.length,
    rtp: r(mean), rtpLow: r(mean - ci), rtpHigh: r(mean + ci), precision: r(ci, 5),
    hitFrequency: r(A.hits / n), featureFrequency: r(A.features / n), featureEvery: A.features ? Math.round(n / A.features) : null,
    volatilitySd: r(sd, 2), volatility: sd < 3 ? 'baja' : sd < 8 ? 'media' : sd < 20 ? 'alta' : 'muy alta',
    maxWinObserved: r(A.maxWin, 2), cappedRounds: A.capped,
    distribution: Object.fromEntries(Object.entries(A.buckets).map(([k, v]) => [k, r(v / n, 5)])),
    costMultiplier: parts[0]?.costMultiplier ?? 1, raw: A,
  };
}

/** Tiempo máximo del refinado del ajuste de RTP (ms). Configurable con TUNE_REFINE_MS. */
const refineBudget = () => Number(process.env.TUNE_REFINE_MS || 45_000);

/**
 * Cambia el tamaño de la cuadrícula (rodillos × filas) y/o las líneas de pago.
 * Reconstruye tiras de rodillos, completa la tabla de pagos para las nuevas cantidades
 * y ajusta reglas dependientes. El RTP queda desajustado: después hay que llamar a tuneRtp.
 */
export function resizeGrid(config, { reels, rows, lines } = {}) {
  if (!isSlot(getEngine(config.engine))) throw Object.assign(new Error('Este juego no tiene rodillos'), { status: 400 });
  const c = structuredClone(config);
  const g = c.grid;
  const R = c.rules || {};
  const newReels = reels ?? g.reels;
  const newRows = rows ?? g.rows;
  const errors = [];
  const lim = engineGridLimits(c.engine);
  const variable = VARIABLE_ROW_ENGINES.includes(c.engine);
  const [minR, maxR] = lim.reels;
  if (!Number.isInteger(newReels) || newReels < minR || newReels > maxR) errors.push(`Rodillos: entre ${minR} y ${maxR}`);
  if (!variable && (!Number.isInteger(newRows) || newRows < lim.rows[0] || newRows > lim.rows[1])) {
    errors.push(`Filas: entre ${lim.rows[0]} y ${lim.rows[1]}`);
  }
  if (errors.length) throw Object.assign(new Error(errors.join('. ')), { status: 400, details: errors });

  // Tiras: se conservan las existentes; las nuevas copian la composición de un rodillo existente, mezclada.
  const rebuild = (strips, seedBase) => Array.from({ length: newReels }, (_, i) => {
    if (i < strips.length) return strips[i];
    const src = strips[i % strips.length];
    const counts = src.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {});
    return buildStrip(counts, seedBase + i * 97);
  });
  c.reels = rebuild(c.reels, 9100);
  if (c.freeSpinReels) c.freeSpinReels = rebuild(c.freeSpinReels, 9300);
  g.reels = newReels;
  if (!variable) g.rows = newRows;

  // Pagos: quitar cantidades imposibles y extrapolar las nuevas (cada paso ×2,5 aprox., como en slots típicos).
  const byCount = ['cluster', 'count'].includes(ENGINES[c.engine]?.paysBy); // pagos por tamaño de grupo, no por rodillos
  for (const s of c.symbols) {
    if (byCount || !s.pays || !Object.keys(s.pays).length) continue;
    for (const k of Object.keys(s.pays)) if (Number(k) > newReels) delete s.pays[k];
    const keys = Object.keys(s.pays).map(Number).sort((a, b) => a - b);
    if (!keys.length) continue;
    for (let n = keys[keys.length - 1] + 1; n <= newReels; n++) {
      const prev = s.pays[n - 1], prev2 = s.pays[n - 2];
      const ratio = prev2 ? Math.min(4, Math.max(1.5, prev / prev2)) : 2.5;
      s.pays[n] = round6(prev * ratio);
    }
  }

  // Reglas que dependen del tamaño
  const maxL = LINE_ENGINES.includes(c.engine) ? maxLines(newReels, g.rows) : null;
  if (maxL) R.lines = Math.max(1, Math.min(maxL, lines ?? R.lines));
  if (c.engine === 'hold-win') {
    const cells = newReels * g.rows;
    R.triggerCount = Math.max(3, Math.min(cells - 2, Math.round((6 * cells) / 15)));
  }
  if (c.engine === 'colossal-reels') {
    R.colossalSizes = R.colossalSizes.filter((s) => s.size <= g.rows && s.size <= newReels - 1);
    if (!R.colossalSizes.length) R.colossalSizes = [{ size: 2, weight: 1 }];
  }
  return { config: c, maxLines: maxL };
}

/**
 * Escala los pagos para acercar el RTP al objetivo. Es lineal en los pagos, así que
 * converge en 2-3 iteraciones. Para Bonus Buy también ajusta el precio de compra.
 */
/**
 * Frecuencia del bonus: cambia cuántos símbolos activadores (scatter, libro, moneda…) hay en las tiras
 * para que el bonus salga en promedio cada `every` giros y luego reajusta los pagos al RTP objetivo.
 * Ajusta la densidad (activadores / largo de tira) cambiando cantidad de activadores y relleno con símbolos normales.
 */
export function tuneFeature(config, { every, spins = 200_000, seed = 4242 } = {}) {
  const engine = getEngine(config.engine);
  if (!isSlot(engine)) throw Object.assign(new Error('Este juego no tiene bonus de rodillos'), { status: 400 });
  every = Number(every);
  if (!(every >= 20 && every <= 5000)) throw Object.assign(new Error('La frecuencia debe estar entre 20 y 5000 giros'), { status: 400 });
  const triggers = new Set((config.symbols || []).filter((s) => ['scatter', 'wildscatter', 'coin'].includes(s.type)).map((s) => s.id));
  if (!triggers.size || !Array.isArray(config.reels)) throw Object.assign(new Error('Este juego no tiene un bonus activado por símbolos en los rodillos'), { status: 400 });
  const regular = (config.symbols || []).filter((s) => (s.type || 'regular') === 'regular').map((s) => s.id);
  const rng = seededRng(seed);
  let cfg = structuredClone(config);
  const history = [];
  const measure = (c) => simulate(c, { spins, seed: seed + 1, timeBudgetMs: 45_000 });
  let sim = measure(cfg);
  history.push({ step: 0, featureEvery: sim.featureEvery, rtp: sim.rtp });
  for (let step = 1; step <= 7; step++) {
    const fe = sim.featureEvery ?? every * 20;
    if (Math.abs(fe - every) / every < 0.1) break;
    // La probabilidad del bonus crece aprox. con la densidad al cubo (hacen falta ~3 activadores)
    const factor = Math.min(2.2, Math.max(0.45, (fe / every) ** (1 / 3)));
    cfg.reels = cfg.reels.map((strip) => {
      const trig = strip.filter((x) => triggers.has(x));
      const others = strip.filter((x) => !triggers.has(x));
      if (!trig.length) return strip;
      const density = (trig.length / strip.length) * factor;
      let count = Math.max(1, Math.round(trig.length * Math.sqrt(factor)));
      let len = Math.round(count / density);
      len = Math.max(Math.max(24, count * 4), Math.min(220, len));
      // Relleno: símbolos normales copiando la mezcla de la tira (o regulares si no hay)
      const pool = others.filter((x) => regular.includes(x));
      const fill = pool.length ? pool : regular;
      let body = others.slice();
      while (body.length < len - count) body.splice(rng.int(body.length + 1), 0, fill[rng.int(fill.length)]);
      while (body.length > len - count) {
        const idx = body.findIndex((x, i) => regular.includes(x) && i === rng.int(body.length));
        body.splice(idx >= 0 ? idx : rng.int(body.length), 1);
      }
      // Reparte los activadores lo más separados posible (nunca dos juntos a la vista)
      const out = body.slice();
      const types = [...trig];
      for (let i = 0; i < count; i++) {
        const pos = Math.round(((i + 0.5) * out.length) / count) + i;
        out.splice(Math.min(out.length, pos), 0, types[i % types.length]);
      }
      return out;
    });
    sim = measure(cfg);
    history.push({ step, featureEvery: sim.featureEvery, rtp: sim.rtp });
  }
  const tuned = tuneRtpSlot(cfg, { target: cfg.rtpTarget, spins: Math.max(spins, 400_000), iterations: 5 });
  return { config: tuned.config, history, featureEvery: tuned.final.featureEvery, final: tuned.final, buy: tuned.buy, buyOptions: tuned.buyOptions };
}

export function tuneRtp(config, opts = {}) {
  if (!isSlot(getEngine(config.engine))) throw Object.assign(new Error(getEngine(config.engine).kind === 'crash' ? 'En Crash el RTP es exacto: cámbialo en rules.rtp' : 'En los juegos de mesa el RTP depende de los pagos de cada apuesta: edítalos en las reglas'), { status: 400 });
  return tuneRtpSlot(config, opts);
}

function tuneRtpSlot(config, { target = config.rtpTarget, spins = 300_000, iterations = 3, seed = 777, refine = true } = {}) {
  const engine = getEngine(config.engine);
  const cfg = structuredClone(config);
  const history = [];
  // Misma semilla en cada iteración (números aleatorios comunes): como el RTP es lineal
  // en los pagos, la escala converge casi en un paso sin que el ruido la haga oscilar.
  for (let i = 0; i < iterations; i++) {
    const sim = simulate(cfg, { spins, seed });
    history.push({ iteration: i + 1, rtp: sim.rtp, ci: [sim.rtpLow, sim.rtpHigh] });
    if (Math.abs(sim.rtp - target) < 0.0005) break;
    engine.scalePays(cfg, target / sim.rtp);
  }
  // Refinado: una sola muestra puede desviarse ±1–4 % en juegos volátiles. Se miden lotes con semillas NUEVAS sobre
  // los pagos ya ajustados hasta lograr ±0,3 % (o agotar el tiempo) y se corrige una vez con ese promedio
  // (el RTP es proporcional a los pagos, así que la corrección es exacta en esperanza).
  // Sin refinado aquí: lo hace el hilo principal en paralelo y después fija los precios de compra (priceBuys).
  if (refine === false) return { config: cfg, history, final: null, buy: null, buyOptions: [] };
  const pool = simulatePooled(cfg, { seed: seed + 1000, targetHalf: 0.003, budgetMs: refineBudget(), minSpins: spins, maxSpins: 40_000_000, chunk: spins });
  const k = pool.rtp > 0 ? target / pool.rtp : 1;
  if (Math.abs(pool.rtp - target) >= 0.0002) engine.scalePays(cfg, k);
  history.push({ iteration: history.length + 1, rtp: pool.rtp, ci: [pool.rtpLow, pool.rtpHigh], refinedSpins: pool.spins, precision: pool.precision });
  const rs = (x) => Math.round(x * k * 1e4) / 1e4;
  const { raw: _raw, ...poolRest } = pool;
  const finalSim = { ...poolRest, rtp: rs(pool.rtp), rtpLow: rs(pool.rtpLow), rtpHigh: rs(pool.rtpHigh), precision: Math.round(pool.precision * k * 1e5) / 1e5 };
  return { config: cfg, history, final: finalSim, ...priceBuys(engine, cfg, target, spins, seed) };
}

/** Precio de cada compra = valor esperado del bono / RTP objetivo (modifica cfg). */
export function priceBuys(engine, cfg, target, spins = 400_000, seed = 777) {
  // Precio de cada compra = valor esperado del bono / RTP objetivo.
  let buy = null;
  const buyOptions = [];
  for (const b of buyModesOf(engine, cfg)) {
    // Valor esperado del bono medido por lotes hasta ±0,5 % (o un tercio del tiempo de refinado por modo)
    const probe = simulatePooled(cfg, { mode: b.mode, seed: seed + 5, targetHalf: 0.005, budgetMs: refineBudget() / 3, minSpins: Math.max(20_000, spins / 10), chunk: 100_000 });
    const ev = probe.rtp * probe.costMultiplier;
    // Precio redondeado hacia arriba (2 decimales si es menor que 10×, si no 1): el RTP de la compra nunca supera el objetivo
    const raw = ev / target, k = raw < 10 ? 100 : 10;
    b.set(cfg, Math.max(1, Math.ceil(raw * k - 1e-9) / k));
    // RTP de la compra con el precio nuevo (el retorno es inversamente proporcional al precio)
    const q = probe.costMultiplier / Math.max(1e-9, costMultiplier(engine, cfg, b.mode));
    const r4 = (x) => Math.round(x * q * 1e4) / 1e4;
    const info = { mode: b.mode, cost: b.get(cfg), rtp: r4(probe.rtp), ci: [r4(probe.rtpLow), r4(probe.rtpHigh)] };
    buyOptions.push(info);
    if (b.mode === 'buy') buy = { buyCost: info.cost, rtp: info.rtp, ci: info.ci };
  }
  return { buy, buyOptions };
}
