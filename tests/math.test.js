// Pruebas de la matemática: validez, determinismo, reproducción exacta y RTP de las semillas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ENGINES, validateConfig, simulate } from '../backend/math/index.js';
import { seededRng, recordingRng, replayRng } from '../backend/math/rng.js';

const seeds = Object.fromEntries(readdirSync(new URL('../backend/games/seed/', import.meta.url))
  .map((f) => JSON.parse(readFileSync(new URL(`../backend/games/seed/${f}`, import.meta.url), 'utf8')))
  .map((c) => [c.engine, c]));

for (const [id, engine] of Object.entries(ENGINES)) {
  const config = seeds[id];

  test(`${id}: la configuración inicial es válida`, () => {
    assert.ok(config, `falta la semilla de ${id}`);
    assert.deepEqual(validateConfig(config), []);
  });

  test(`${id}: misma semilla → mismo resultado`, () => {
    for (const mode of engine.modes || ['base']) {
      const a = engine.play(config, seededRng(42), { mode });
      const b = engine.play(config, seededRng(42), { mode });
      assert.deepEqual(a, b);
    }
  });

  test(`${id}: una ronda grabada se reproduce exactamente`, () => {
    const base = seededRng(7);
    for (let i = 0; i < 300; i++) {
      const rec = recordingRng(base);
      const r1 = engine.play(config, rec);
      const rep = replayRng(rec.draws);
      const r2 = engine.play(config, rep);
      assert.deepEqual(r2, r1);
      assert.equal(rep.consumed, rec.draws.length);
    }
  });

  test(`${id}: premios dentro del máximo y nunca negativos`, () => {
    const rng = seededRng(99);
    for (let i = 0; i < 3000; i++) {
      const r = engine.play(config, rng);
      assert.ok(r.totalWin >= 0 && r.totalWin <= config.rules.maxWin, `premio fuera de rango: ${r.totalWin}`);
    }
  });

  test(`${id}: RTP simulado cerca del objetivo`, () => {
    const s = simulate(config, { spins: 150_000, seed: 2024 });
    // Tolerancia amplia: es una comprobación rápida, la precisa se hace al publicar.
    assert.ok(Math.abs(s.rtp - config.rtpTarget) < 0.05, `RTP ${s.rtp} lejos de ${config.rtpTarget}`);
  });
}

test('validación detecta errores habituales', () => {
  const c = structuredClone(seeds['reel-rush']);
  c.reels[0][0] = 'no-existe';
  c.symbols[0].pays['3'] = -1;
  const errs = validateConfig(c);
  assert.ok(errs.some((e) => e.includes('no-existe')));
  assert.ok(errs.some((e) => e.includes('Pago inválido')));
});
