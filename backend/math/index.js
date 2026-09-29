// Registro de motores + simulador de RTP + ajuste automático de la tabla de pagos.
import * as reelRush from './reel-rush.js';
import * as megaways from './megaways.js';
import * as bonusBuy from './bonus-buy.js';
import * as holdWin from './hold-win.js';
import * as colossal from './colossal-reels.js';
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
};

export function getEngine(id) {
  const e = ENGINES[id];
  if (!e) throw Object.assign(new Error(`Motor desconocido: ${id}`), { status: 400 });
  return e;
}

export const engineList = () => Object.values(ENGINES).map((e) => ({
  id: e.id, name: e.name, description: e.description, modes: e.modes || ['base'],
}));

export function costMultiplier(engine, config, mode = 'base') {
  return engine.costMultiplier ? engine.costMultiplier(config, mode) : 1;
}

export function validateConfig(config) {
  if (!config?.engine) return ['Falta el campo engine'];
  const e = ENGINES[config.engine];
  if (!e) return [`Motor desconocido: ${config.engine}`];
  const errs = e.validate(config);
  if (!(config.rtpTarget >= RTP_RANGE[0] && config.rtpTarget <= RTP_RANGE[1])) errs.push(`rtpTarget debe estar entre ${RTP_RANGE[0]} y ${RTP_RANGE[1]} (85 % a 110 %)`);
  if (!config.theme || typeof config.theme !== 'object') errs.push('Falta theme');
  return errs;
}

/**
 * Simulación Monte Carlo. Devuelve RTP con intervalo de confianza del 95 %,
 * frecuencia de premio, frecuencia de bonus, volatilidad y premio máximo observado.
 */
export function simulate(config, { spins = 200_000, mode = 'base', seed = 12345, timeBudgetMs = 20_000 } = {}) {
  const engine = getEngine(config.engine);
  const rng = seededRng(seed);
  const cost = costMultiplier(engine, config, mode);
  let sum = 0, sumSq = 0, hits = 0, features = 0, maxWin = 0, n = 0, capped = 0;
  const buckets = { '0': 0, '0-1x': 0, '1-5x': 0, '5-20x': 0, '20-100x': 0, '100-1000x': 0, '1000x+': 0 };
  const t0 = Date.now();
  for (; n < spins; n++) {
    if ((n & 1023) === 0 && Date.now() - t0 > timeBudgetMs) break;
    const res = engine.play(config, rng, { mode });
    const w = res.totalWin / cost; // retorno por unidad apostada
    sum += w; sumSq += w * w;
    if (res.totalWin > 0) hits++;
    if (res.freeSpins || res.holdAndWin) features++;
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
  };
}

/**
 * Cambia el tamaño de la cuadrícula (rodillos × filas) y/o las líneas de pago.
 * Reconstruye tiras de rodillos, completa la tabla de pagos para las nuevas cantidades
 * y ajusta reglas dependientes. El RTP queda desajustado: después hay que llamar a tuneRtp.
 */
export function resizeGrid(config, { reels, rows, lines } = {}) {
  const c = structuredClone(config);
  const g = c.grid;
  const R = c.rules || {};
  const newReels = reels ?? g.reels;
  const newRows = rows ?? g.rows;
  const errors = [];
  const [minR, maxR] = c.engine === 'megaways' || c.engine === 'colossal-reels' ? [4, 8] : GRID_LIMITS.reels;
  if (!Number.isInteger(newReels) || newReels < minR || newReels > maxR) errors.push(`Rodillos: entre ${minR} y ${maxR}`);
  if (c.engine !== 'megaways' && (!Number.isInteger(newRows) || newRows < GRID_LIMITS.rows[0] || newRows > GRID_LIMITS.rows[1])) {
    errors.push(`Filas: entre ${GRID_LIMITS.rows[0]} y ${GRID_LIMITS.rows[1]}`);
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
  if (c.engine !== 'megaways') g.rows = newRows;

  // Pagos: quitar cantidades imposibles y extrapolar las nuevas (cada paso ×2,5 aprox., como en slots típicos).
  for (const s of c.symbols) {
    if (!s.pays || !Object.keys(s.pays).length) continue;
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
  const maxL = ['bonus-buy', 'hold-win'].includes(c.engine) ? maxLines(newReels, g.rows) : null;
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
export function tuneRtp(config, { target = config.rtpTarget, spins = 300_000, iterations = 3, seed = 777 } = {}) {
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
  const finalSim = simulate(cfg, { spins, seed: seed + 99 });
  let buy = null;
  if (engine.modes?.includes('buy')) {
    // RTP de la compra = EV(giros gratis) / precio. Precio = EV / objetivo.
    const probe = simulate(cfg, { spins: Math.max(20_000, spins / 10), mode: 'buy', seed: seed + 5 });
    const ev = probe.rtp * probe.costMultiplier;
    cfg.rules.buyCost = Math.max(10, Math.round(ev / target));
    const check = simulate(cfg, { spins: Math.max(20_000, spins / 10), mode: 'buy', seed: seed + 6 });
    buy = { buyCost: cfg.rules.buyCost, rtp: check.rtp, ci: [check.rtpLow, check.rtpHigh] };
  }
  return { config: cfg, history, final: finalSim, buy };
}
