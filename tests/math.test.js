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

// ---- Tamaños de cuadrícula configurables ----
import { resizeGrid } from '../backend/math/index.js';
import { generateLines, LINES_5x3 } from '../backend/math/common.js';

test('5x3 conserva las 20 líneas clásicas (compatibilidad con versiones publicadas)', () => {
  assert.deepEqual(generateLines(5, 3, 20), LINES_5x3);
  assert.equal(generateLines(5, 3, 50).length, 50);
});

test('las líneas generadas son válidas y no se repiten', () => {
  for (const [r, f] of [[3, 3], [4, 4], [6, 4], [7, 5], [8, 6]]) {
    const L = generateLines(r, f, 100);
    assert.ok(L.length >= 5);
    assert.equal(new Set(L.map(String)).size, L.length);
    for (const l of L) { assert.equal(l.length, r); assert.ok(l.every((x) => x >= 0 && x < f)); }
  }
});

const SIZES = { 'reel-rush': [6, 4], megaways: [7], 'bonus-buy': [6, 4, 30], 'hold-win': [4, 4, 12], 'colossal-reels': [6, 5] };
for (const [id, [reels, rows, lines]] of Object.entries(SIZES)) {
  test(`${id}: se puede cambiar a ${reels}x${rows ?? 'variable'}${lines ? ` con ${lines} líneas` : ''}`, () => {
    const { config } = resizeGrid(seeds[id], { reels, rows, lines });
    assert.deepEqual(validateConfig(config), []);
    assert.equal(config.reels.length, reels);
    if (lines) assert.equal(config.rules.lines, lines);
    const engine = ENGINES[id];
    const base = seededRng(3);
    for (let i = 0; i < 300; i++) {
      const rec = recordingRng(base);
      const r1 = engine.play(config, rec);
      const grid = r1.steps?.[0].grid || r1.base?.grid || r1.grid;
      assert.equal(grid.length, reels);
      if (rows) assert.ok(grid.every((col) => col.length === rows));
      assert.deepEqual(engine.play(config, replayRng(rec.draws)), r1);
    }
  });
}

test('resizeGrid rechaza tamaños fuera de límites', () => {
  assert.throws(() => resizeGrid(seeds['reel-rush'], { reels: 9 }));
  assert.throws(() => resizeGrid(seeds['reel-rush'], { rows: 2 }));
  assert.throws(() => resizeGrid(seeds.megaways, { reels: 3 }));
});

test('RTP objetivo permitido de 85 % a 110 %', () => {
  const c = structuredClone(seeds['reel-rush']);
  for (const [t, ok] of [[0.85, true], [0.96, true], [1.1, true], [0.84, false], [1.11, false]]) {
    c.rtpTarget = t;
    assert.equal(validateConfig(c).length === 0, ok, `rtpTarget ${t}`);
  }
});
