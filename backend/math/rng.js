// Generadores de números aleatorios para la matemática de los juegos.
//
// - cryptoRng(): el que se usa con dinero real. Basado en crypto.randomInt
//   (CSPRNG del sistema operativo, sin sesgo de módulo).
// - recordingRng(): envuelve cualquier RNG y guarda cada valor extraído.
//   Esos valores se guardan en la ronda para auditoría y reproducción exacta.
// - replayRng(): reproduce una ronda a partir de los valores guardados.
// - seededRng(): xoshiro128** rápido y determinista, SOLO para simulaciones de RTP.

import { randomInt } from 'node:crypto';

export function cryptoRng() {
  return {
    kind: 'crypto',
    int(n) {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`rng.int: rango inválido ${n}`);
      return n === 1 ? 0 : randomInt(n);
    },
  };
}

export function recordingRng(inner = cryptoRng()) {
  const draws = [];
  return {
    kind: `recording(${inner.kind})`,
    draws,
    int(n) {
      const v = inner.int(n);
      draws.push([n, v]);
      return v;
    },
  };
}

export function replayRng(draws) {
  let i = 0;
  return {
    kind: 'replay',
    int(n) {
      if (i >= draws.length) throw new Error('replay: se agotaron los valores grabados');
      const [rn, v] = draws[i++];
      if (rn !== n) throw new Error(`replay: rango distinto en extracción ${i - 1} (${rn} vs ${n})`);
      return v;
    },
    get consumed() { return i; },
  };
}

export function seededRng(seed = Date.now()) {
  // xoshiro128** — período 2^128-1, excelente para Monte Carlo.
  let s0 = (seed ^ 0x9e3779b9) >>> 0, s1 = (seed * 0x85ebca6b) >>> 0,
      s2 = (seed * 0xc2b2ae35 + 1) >>> 0, s3 = (seed ^ 0x27d4eb2f) >>> 0;
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  const next = () => {
    const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11);
    return r;
  };
  for (let i = 0; i < 16; i++) next();
  return {
    kind: 'seeded',
    int(n) {
      if (n === 1) return 0;
      // Rechazo para evitar sesgo de módulo.
      const limit = 0x100000000 - (0x100000000 % n);
      let x;
      do { x = next(); } while (x >= limit);
      return x % n;
    },
  };
}
