// Ejecuta simulaciones y ajustes de RTP en un hilo aparte para no bloquear las tiradas de los jugadores.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism, cpus } from 'node:os';
import { simulate, simulatePooled, combinePooled, tuneRtp, resizeGrid, tuneFeature, priceBuys, getEngine, buyModesOf } from './index.js';
import { selfTest } from './selftest.js';

if (!isMainThread && workerData?.__simWorker) {
  const { task, config, opts } = workerData;
  try {
    let out;
    if (task === 'tune') out = tuneRtp(config, opts);
    else if (task === 'feature') out = tuneFeature(config, opts);
    else if (task === 'selftest') out = selfTest(config, opts);
    else if (task === 'pooled') out = simulatePooled(config, opts);
    else if (task === 'price') out = { config, ...priceBuys(getEngine(config.engine), config, opts.target, opts.spins, opts.seed) };
    else if (task === 'resize') {
      const { config: resized, maxLines } = resizeGrid(config, opts);
      out = { ...tuneRtp(resized, { target: resized.rtpTarget, spins: opts.spins || 300_000 }), maxLines };
    } else out = simulate(config, opts);
    parentPort.postMessage({ ok: true, out });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e.message, status: e.status, details: e.details });
  }
}

let running = 0;
const MAX_PARALLEL = 2;
const queue = [];

function runNext() {
  if (running >= MAX_PARALLEL || !queue.length) return;
  const { task, config, opts, resolve, reject } = queue.shift();
  running++;
  const w = new Worker(new URL(import.meta.url), { workerData: { __simWorker: true, task, config, opts } });
  let done = false;
  const finish = (fn, v) => { if (done) return; done = true; running--; fn(v); runNext(); };
  w.once('message', (m) => finish(m.ok ? resolve : reject, m.ok ? m.out : Object.assign(new Error(m.error), { status: m.status, details: m.details })));
  w.once('error', (e) => finish(reject, e));
  w.once('exit', (code) => finish(reject, new Error(`El simulador terminó con código ${code}`)));
}

function enqueue(task, config, opts) {
  return new Promise((resolve, reject) => { queue.push({ task, config, opts, resolve, reject }); runNext(); });
}

export const simulateAsync = (config, opts = {}) => enqueue('simulate', config, opts);

/** Hilos para medir el RTP en paralelo (SIM_THREADS o núcleos − 1, de 1 a 6). */
export function simThreads() {
  const env = Number(process.env.SIM_THREADS);
  if (env > 0) return Math.min(16, Math.floor(env));
  const n = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  return Math.max(1, Math.min(6, n - 1));
}

/** Un hilo propio (fuera de la cola) para una parte de una medición en paralelo. */
function runDirect(task, config, opts) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { __simWorker: true, task, config, opts } });
    w.once('message', (m) => (m.ok ? resolve(m.out) : reject(Object.assign(new Error(m.error), { status: m.status }))));
    w.once('error', reject);
    w.once('exit', (code) => { if (code) reject(new Error(`El simulador terminó con código ${code}`)); });
  });
}

/**
 * Medición del RTP por lotes repartida en varios hilos (semillas distintas) y combinada.
 * Con 1 hilo es igual a simulatePooled. opts: { seed, targetHalf, budgetMs, minSpins, maxSpins, chunk, mode }
 */
export async function pooledParallelAsync(config, opts = {}) {
  const P = simThreads();
  if (P <= 1) return enqueue('pooled', config, opts);
  const t0 = Date.now();
  const seed = opts.seed ?? 1;
  const parts = await Promise.all(Array.from({ length: P }, (_, i) => runDirect('pooled', config, {
    ...opts, seed: seed + i * 1_000_003,
    // Cada hilo busca una precisión √P veces menor: al combinarlos se llega a la pedida
    targetHalf: (opts.targetHalf ?? 0.003) * Math.sqrt(P),
    minSpins: Math.ceil((opts.minSpins || 0) / P), maxSpins: Math.ceil((opts.maxSpins || 50_000_000) / P),
  })));
  return combinePooled(parts, { engine: config.engine, mode: opts.mode || 'base', ms: Date.now() - t0 });
}

/**
 * Ajuste de RTP: iteraciones rápidas (misma semilla) + refinado con muestras nuevas en paralelo hasta ±0,3 %
 * (o TUNE_REFINE_MS), corrección final exacta por proporcionalidad y precios de compra con los pagos definitivos.
 */
export async function tuneAsync(config, opts = {}) {
  if (simThreads() <= 1) return enqueue('tune', config, opts);
  const target = opts.target ?? config.rtpTarget;
  const spins = opts.spins || 300_000;
  const t = await enqueue('tune', config, { ...opts, refine: false });
  const pool = await pooledParallelAsync(t.config, { seed: (opts.seed ?? 777) + 1000, targetHalf: 0.003, budgetMs: Number(process.env.TUNE_REFINE_MS || 45_000), minSpins: spins, maxSpins: 60_000_000, chunk: spins });
  const k = pool.rtp > 0 ? target / pool.rtp : 1;
  if (Math.abs(pool.rtp - target) >= 0.0002) getEngine(config.engine).scalePays(t.config, k);
  t.history.push({ iteration: t.history.length + 1, rtp: pool.rtp, ci: [pool.rtpLow, pool.rtpHigh], refinedSpins: pool.spins, precision: pool.precision, threads: pool.threads });
  const rs = (x) => Math.round(x * k * 1e4) / 1e4;
  const { raw, ...rest } = pool;
  t.final = { ...rest, rtp: rs(pool.rtp), rtpLow: rs(pool.rtpLow), rtpHigh: rs(pool.rtpHigh), precision: Math.round(pool.precision * k * 1e5) / 1e5 };
  if (buyModesOf(getEngine(config.engine), t.config).length) {
    const priced = await enqueue('price', t.config, { target, spins, seed: opts.seed ?? 777 });
    t.config = priced.config; t.buy = priced.buy; t.buyOptions = priced.buyOptions;
  }
  return t;
}
/** Prueba silenciosa de jugadas, bonus, compras, auditoría y apuestas. */
export const selfTestAsync = (config, opts = {}) => enqueue('selftest', config, opts);
/** Simulación por lotes hasta la precisión pedida (certificación al publicar). */
export const pooledAsync = (config, opts = {}) => enqueue('pooled', config, opts);
export const featureAsync = (config, opts = {}) => enqueue('feature', config, opts);
/** Cambia rodillos/filas/líneas y reajusta el RTP. opts: { reels, rows, lines, spins } */
export const resizeAsync = (config, opts = {}) => enqueue('resize', config, opts);
