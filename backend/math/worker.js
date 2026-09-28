// Ejecuta simulaciones y ajustes de RTP en un hilo aparte para no bloquear las tiradas de los jugadores.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { simulate, tuneRtp } from './index.js';

if (!isMainThread && workerData?.__simWorker) {
  const { task, config, opts } = workerData;
  try {
    const out = task === 'tune' ? tuneRtp(config, opts) : simulate(config, opts);
    parentPort.postMessage({ ok: true, out });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e.message });
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
  w.once('message', (m) => finish(m.ok ? resolve : reject, m.ok ? m.out : new Error(m.error)));
  w.once('error', (e) => finish(reject, e));
  w.once('exit', (code) => finish(reject, new Error(`El simulador terminó con código ${code}`)));
}

function enqueue(task, config, opts) {
  return new Promise((resolve, reject) => { queue.push({ task, config, opts, resolve, reject }); runNext(); });
}

export const simulateAsync = (config, opts = {}) => enqueue('simulate', config, opts);
export const tuneAsync = (config, opts = {}) => enqueue('tune', config, opts);
