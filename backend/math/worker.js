// Ejecuta simulaciones y ajustes de RTP en un hilo aparte para no bloquear las tiradas de los jugadores.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { simulate, tuneRtp, resizeGrid } from './index.js';

if (!isMainThread && workerData?.__simWorker) {
  const { task, config, opts } = workerData;
  try {
    let out;
    if (task === 'tune') out = tuneRtp(config, opts);
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
export const tuneAsync = (config, opts = {}) => enqueue('tune', config, opts);
/** Cambia rodillos/filas/líneas y reajusta el RTP. opts: { reels, rows, lines, spins } */
export const resizeAsync = (config, opts = {}) => enqueue('resize', config, opts);
