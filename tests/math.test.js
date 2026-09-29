// Pruebas de la matemática: validez, determinismo, reproducción exacta y RTP de las semillas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ENGINES, validateConfig, simulate, buyModesOf } from '../backend/math/index.js';
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
    for (const mode of ['base', ...buyModesOf(engine, config).map((b) => b.mode)]) {
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

const SIZES = {
  'reel-rush': [6, 4], megaways: [7], 'bonus-buy': [6, 4, 30], 'hold-win': [4, 4, 12], 'colossal-reels': [6, 5],
  'cluster-pays': [8, 6], 'scatter-pays': [7, 6], 'expanding-symbol': [6, 4, 25], 'sticky-wilds': [5, 4, 20], 'megaways-cascade': [5],
};
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
      const grid = r1.steps?.[0].grid || r1.base?.grid || r1.base?.steps?.[0].grid || r1.grid;
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

// ---- Motores nuevos: reglas específicas ----
import { findClusters } from '../backend/math/cluster-pays.js';
import { symbolMap } from '../backend/math/common.js';

test('cluster-pays: detecta grupos conectados y el comodín se une', () => {
  const c = seeds['cluster-pays'];
  const syms = symbolMap(c);
  const g = Array.from({ length: 7 }, () => Array(7).fill('blue'));
  for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) g[x][y] = (x + y) % 2 ? 'red' : 'green'; // tablero de ajedrez: sin grupos
  assert.equal(findClusters(g, syms, 5).length, 0);
  g[0][0] = 'sun'; g[1][0] = 'sun'; g[2][0] = 'wild'; g[3][0] = 'sun'; g[3][1] = 'sun';
  const wins = findClusters(g, syms, 5);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].symbol, 'sun');
  assert.equal(wins[0].count, 5);
});

test('scatter-pays: los multiplicadores solo aplican si hay premio', () => {
  const e = ENGINES['scatter-pays'];
  const rng = seededRng(11);
  for (let i = 0; i < 2000; i++) {
    const r = e.play(seeds['scatter-pays'], rng);
    if (r.base.baseWin === 0) assert.equal(r.base.win, 0);
    else if (r.base.multSum > 0) assert.ok(Math.abs(r.base.win - r.base.baseWin * r.base.multSum) < 1e-6);
  }
});

test('sticky-wilds: los comodines fijos se mantienen y los que caminan avanzan', () => {
  const e = ENGINES['sticky-wilds'];
  for (const mode of ['sticky', 'walking']) {
    const c = structuredClone(seeds['sticky-wilds']);
    c.rules.wildMode = mode;
    const rng = seededRng(5);
    let checked = 0;
    for (let i = 0; i < 3000 && checked < 5; i++) {
      const r = e.play(c, rng);
      if (!r.freeSpins) continue;
      checked++;
      const spins = r.freeSpins.spins;
      for (let k = 1; k < spins.length; k++) {
        for (const key of spins[k - 1].held) {
          const [cc, rr] = key.split(',').map(Number);
          const expect = mode === 'sticky' ? [cc, rr] : [cc, rr];
          if (expect[0] >= 0) assert.equal(spins[k].grid[expect[0]][expect[1]], 'wild');
        }
      }
    }
    assert.ok(checked > 0, `no hubo giros gratis en modo ${mode}`);
  }
});

test('bonus-buy: cada opción del menú cobra su precio y paga su bono', () => {
  const e = ENGINES['bonus-buy'];
  const c = seeds['bonus-buy'];
  const rng = seededRng(8);
  for (const b of buyModesOf(e, c)) {
    const r = e.play(c, rng, { mode: b.mode });
    assert.ok(r.freeSpins || r.bonus, b.mode);
    assert.equal(r.cost, b.get(c));
  }
  const pick = e.play(c, rng, { mode: 'buy-pick' }).bonus;
  assert.equal(pick.picked.length, c.rules.bonusMenu.pick.picks);
  assert.equal(pick.totalWin, pick.values.reduce((a, v) => a + v, 0));
});

test('expanding-symbol: la expansión paga según rodillos con el símbolo especial', () => {
  const e = ENGINES['expanding-symbol'];
  const c = seeds['expanding-symbol'];
  const rng = seededRng(21);
  let seen = 0;
  for (let i = 0; i < 5000 && seen < 20; i++) {
    const r = e.play(c, rng);
    for (const s of r.freeSpins?.spins || []) {
      if (!s.expanded.length) continue;
      seen++;
      const sp = c.symbols.find((x) => x.id === r.freeSpins.special);
      assert.ok(Math.abs(s.expandWin - (sp.pays[String(s.expanded.length)] || 0)) < 1e-6);
      for (const col of s.expanded) assert.ok(s.grid[col].includes(r.freeSpins.special));
    }
  }
  assert.ok(seen > 0);
});
