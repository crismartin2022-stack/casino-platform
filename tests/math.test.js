// Pruebas de la matemática: validez, determinismo, reproducción exacta y RTP de las semillas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ENGINES, validateConfig, simulate, buyModesOf, costMultiplier } from '../backend/math/index.js';
import { seededRng, recordingRng, replayRng } from '../backend/math/rng.js';

const seeds = Object.fromEntries(readdirSync(new URL('../backend/games/seed/', import.meta.url))
  .map((f) => JSON.parse(readFileSync(new URL(`../backend/games/seed/${f}`, import.meta.url), 'utf8')))
  .filter((c) => !c.id || c.id === c.engine) // la semilla del motor (no los juegos extra como Dados en Vivo)
  .map((c) => [c.engine, c]));

for (const [id, engine] of Object.entries(ENGINES).filter(([, e]) => (e.kind || 'slot') === 'slot')) {
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

test('bonus-buy: diseño original — sorpresa, wilds fijos al azar, giros extra, colecciona y camino', () => {
  const e = ENGINES['bonus-buy'];
  const c = seeds['bonus-buy'];
  const R = c.rules;
  const rng = seededRng(31);
  let surprises = 0, extra = 0, stickyOk = 0;
  for (let i = 0; i < 4000; i++) {
    const r = e.play(c, rng);
    if (r.surprise) { surprises++; assert.ok(r.bonus || r.freeSpins); }
    const fs = r.freeSpins;
    if (!fs) continue;
    if (R.fsStickyRandom > 0) {
      assert.ok(fs.sticky);
      const first = fs.spins[0].held;
      assert.equal(first.length, R.fsStickyRandom);
      for (const s of fs.spins) { assert.deepEqual(s.held, first); stickyOk++; }
    }
    for (const s of fs.spins) if (s.extra) extra++;
  }
  assert.ok(surprises > 0, 'sin bonus sorpresa');
  assert.ok(stickyOk > 0 && extra > 0, 'sin wilds fijos o giros extra');
  const col = e.play(c, rng, { mode: 'buy-collect' }).bonus;
  assert.equal(col.type, 'collect');
  assert.equal(col.items.length, R.bonusMenu.collect.items);
  for (const it of col.items) assert.ok(Math.abs(it.win - it.value * it.mult) < 1e-6);
  const path = e.play(c, rng, { mode: 'buy-path' }).bonus;
  assert.equal(path.type, 'path');
  assert.equal(path.moves.at(-1).position, R.bonusMenu.path.length - 1);
  path.moves.forEach((m, i) => assert.ok(Math.abs(m.multiplier - (1 + i * R.bonusMenu.path.multStep)) < 1e-6));
  const wheel = e.play(c, rng, { mode: 'buy-wheel' }).bonus;
  assert.equal(wheel.segmentsInfo.length, R.bonusMenu.wheel.segmentsCount);
  for (const s of wheel.spins) assert.equal(s.value, wheel.segmentsInfo[s.segment].value);
});

test('expanding-symbol: la expansión paga según rodillos con el símbolo especial', () => {
  const e = ENGINES['expanding-symbol'];
  const c = seeds['expanding-symbol'];
  const rng = seededRng(21);
  let seen = 0;
  for (let i = 0; i < 5000 && seen < 20; i++) {
    const r = e.play(c, rng);
    for (const s of r.freeSpins?.spins || []) {
      if (!s.expanded.length || s.expansions) continue;
      seen++;
      const sp = c.symbols.find((x) => x.id === r.freeSpins.special);
      const frame = s.frame && s.expanded.includes(s.frame.reel) ? s.frame.mult : 1;
      assert.ok(Math.abs(s.expandWin - (sp.pays[String(s.expanded.length)] || 0) * frame) < 1e-6);
      for (const col of s.expanded) assert.ok(s.grid[col].includes(r.freeSpins.special));
    }
  }
  assert.ok(seen > 0);
});

// ---- Craps (juego de mesa) ----
import * as craps from '../backend/math/craps.js';

test('craps: configuración inicial válida y RTP exacto de las apuestas clásicas', () => {
  const c = seeds.craps;
  assert.deepEqual(validateConfig(c), []);
  const a = craps.analyze(c).perBet;
  assert.equal(a.pass, 0.9859);       // 244/495 × 2
  assert.equal(a.dontPass, 0.9864);
  assert.equal(a.odds, 1);
  assert.equal(a.place['6'], 0.9848);  // 7:6
  assert.equal(a.field, 0.9444);       // 2 y 12 pagan 2 a 1 (diseño original)
});

const fixed = (a, b) => { const d = [a - 1, b - 1]; let i = 0; return { int: () => d[i++] }; };

test('craps: Pass Line gana con 7 en la salida, fija punto y gana/pierde después', () => {
  const c = seeds.craps;
  let s = craps.addBet(c, craps.newTableState(), { type: 'pass', amount: 1000 });
  let r = craps.roll(c, s, fixed(3, 4)); // 7
  assert.equal(r.cost, 1000); assert.equal(r.payout, 2000); assert.equal(r.state.bets.length, 0);
  s = craps.addBet(c, r.state, { type: 'pass', amount: 1000 });
  r = craps.roll(c, s, fixed(2, 4)); // 6 → punto
  assert.equal(r.state.phase, 'point'); assert.equal(r.state.point, 6); assert.equal(r.payout, 0);
  // odds 5x en el 6
  s = craps.addBet(c, r.state, { type: 'odds', on: r.state.bets[0].id, amount: 5000 });
  assert.throws(() => craps.addBet(c, s, { type: 'odds', on: r.state.bets[0].id, amount: 100 })); // pasa el máximo
  r = craps.roll(c, s, fixed(3, 3)); // 6 de nuevo: gana pass 1:1 y odds 6:5
  assert.equal(r.cost, 5000);
  assert.equal(r.payout, 2000 + 5000 + 6000);
  assert.equal(r.state.phase, 'comeOut');
});

test("craps: Don't Pass empata con 12 en la salida y Field paga 2 a 1 el 12", () => {
  const c = seeds.craps;
  let s = craps.addBet(c, craps.newTableState(), { type: 'dontPass', amount: 1000 });
  s = craps.addBet(c, s, { type: 'field', amount: 1000 });
  const r = craps.roll(c, s, fixed(6, 6));
  assert.equal(r.payout, 1000 * 3); // field 2:1 → 3000; don't pass queda en la mesa (bar)
  assert.equal(r.state.bets.length, 1);
  assert.equal(r.state.bets[0].type, 'dontPass');
});

test('craps: Números apagados en la salida, pagan y siguen en la mesa', () => {
  const c = seeds.craps;
  let s = craps.addBet(c, craps.newTableState(), { type: 'place', number: 6, amount: 600 });
  let r = craps.roll(c, s, fixed(3, 3)); // salida con 6: apagada, fija punto
  assert.equal(r.payout, 0); assert.equal(r.state.point, 6);
  r = craps.roll(c, r.state, fixed(2, 6)); // 8: nada
  r = craps.roll(c, r.state, fixed(1, 5)); // 6: gana 7:6 = 700 y la apuesta sigue
  assert.equal(r.payout, 700);
  assert.equal(r.state.bets[0].type, 'place');
});

test('craps: la tirada se reproduce exactamente con los dados grabados', () => {
  const c = seeds.craps;
  const rng = seededRng(4);
  let s = craps.newTableState();
  for (let i = 0; i < 500; i++) {
    if (!s.bets.length) s = craps.addBet(c, s, { type: s.phase === 'comeOut' ? 'pass' : 'field', amount: 500 });
    const rec = recordingRng(rng);
    const r = craps.roll(c, s, rec);
    const again = craps.roll(c, r.before, replayRng(rec.draws));
    assert.equal(again.payout, r.payout);
    assert.deepEqual(again.dice, r.dice);
    s = r.state;
  }
});

test('craps: rechaza pagos que dejan el RTP fuera de 85 %–110 %', () => {
  const c = structuredClone(seeds.craps);
  c.rules.pays.field = { 2: 3, 12: 3 }; // 100 % → válido
  assert.deepEqual(validateConfig(c), []);
  c.rules.bets.any7 = true; // Any 7 a 4:1 = 83,3 %
  assert.ok(validateConfig(c).some((e) => e.includes('Any 7')));
});

test('cada motor tiene ficha y formulario de funciones que coincide con sus reglas', async () => {
  const { RULE_SCHEMAS, ENGINE_CARDS } = await import('../backend/math/rule-schemas.js');
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  for (const e of Object.values(ENGINES)) {
    assert.ok(ENGINE_CARDS[e.id]?.features?.length, `${e.id}: falta la ficha`);
    if (e.kind === 'table') continue;
    const schema = RULE_SCHEMAS[e.id];
    assert.ok(schema?.length, `${e.id}: falta el formulario de funciones`);
    const R = e.defaults().rules;
    for (const f of schema) {
      if (f.nullable) continue;
      if (f.when && !Object.entries(f.when).every(([k, v]) => get(R, k) === v)) continue;
      assert.notEqual(get(R, f.k), undefined, `${e.id}: el campo ${f.k} no existe en las reglas`);
    }
  }
});

test('hold-win ELIGE Y FIJA: rondas, especiales, crecimiento y jackpots por fijas', () => {
  const e = ENGINES['hold-win'];
  const c = seeds['hold-win'];
  const R = c.rules;
  const rng = seededRng(12);
  let bonuses = 0, resets = 0, extras = 0;
  for (let i = 0; i < 30000; i++) {
    const r = e.play(c, rng);
    const hw = r.holdAndWin;
    if (!hw) continue;
    bonuses++;
    assert.equal(hw.mode, 'pick');
    assert.equal(hw.held, r.coins.length + hw.rounds.length);
    let left = R.rounds;
    for (const rd of hw.rounds) {
      left--;
      if (rd.pick.kind === 'reset') { left = R.rounds; resets++; }
      if (rd.pick.kind === 'extra_round') { left++; extras++; }
      assert.equal(rd.roundsLeft, left);
      assert.ok(rd.candidates >= 1);
    }
    const tier = [...R.jackpotCounts].reverse().find((t) => hw.held >= t.count);
    if (!hw.full) assert.equal(hw.tierJackpot?.jackpot ?? null, tier?.jackpot ?? null);
    const expect = (hw.coinsWin + hw.bonusWin) * hw.multiplier + hw.jackpotWin + (hw.tierJackpot?.value || 0);
    assert.ok(Math.abs(hw.win - expect) < 1e-4, `${hw.win} vs ${expect}`);
  }
  assert.ok(bonuses > 50 && resets > 0 && extras > 0);
});

test('cluster-pays: casillas doradas multiplican y giros gratis las conservan', () => {
  const e = ENGINES['cluster-pays'];
  const c = seeds['cluster-pays'];
  const rng = seededRng(4);
  let spotWins = 0, fs = 0;
  for (let i = 0; i < 20000 && (spotWins < 5 || !fs); i++) {
    const r = e.play(c, rng);
    for (const st of r.steps) for (const w of st.wins) if (w.spotMult) { spotWins++; assert.ok(w.spotMult >= c.rules.spotStart); }
    if (r.freeSpins) {
      fs++;
      // Las casillas del segundo giro empiezan como terminaron las del primero
      const [a, b] = r.freeSpins.spins;
      if (a && b) {
        const lastA = a.steps.at(-1).spots;
        assert.deepEqual(b.steps[0].spots, lastA);
      }
    }
  }
  assert.ok(spotWins >= 5 && fs > 0);
  const buy = e.play(c, rng, { mode: 'buy' });
  assert.ok(buy.freeSpins && buy.cost === c.rules.buyCost);
});

test('scatter-pays: rayo de Zeus y doble chance', () => {
  const e = ENGINES['scatter-pays'];
  const c = seeds['scatter-pays'];
  const rng = seededRng(6);
  let zeus = 0, ante = 0;
  for (let i = 0; i < 5000; i++) {
    const r = e.play(c, rng);
    if (r.base.zeusOrbs) { zeus++; assert.ok(r.base.zeusOrbs.length >= c.rules.zeusOrbsMin && r.base.zeusOrbs.length <= c.rules.zeusOrbsMax); }
    const a = e.play(c, rng, { mode: 'ante' });
    if (a.base.anteHits) ante++;
  }
  assert.ok(zeus > 50 && ante > 100);
  assert.equal(costMultiplier(e, c, 'ante'), c.rules.anteCost);
});

test('classic-reels: cerezas desde una, cualquier BAR, comodín que multiplica y rodillo multiplicador', async () => {
  const { evaluateClassicLine } = await import('../backend/math/classic-reels.js');
  const c = seeds['classic-reels'];
  const syms = symbolMap(c);
  const R = c.rules;
  const pay = (id, n) => c.symbols.find((s) => s.id === id).pays[String(n)];
  assert.equal(evaluateClassicLine(['cherry', 'lemon', 'bell'], syms, R).pay, pay('cherry', 1));
  assert.equal(evaluateClassicLine(['cherry', 'cherry', 'bell'], syms, R).pay, pay('cherry', 2));
  assert.equal(evaluateClassicLine(['bar1', 'bar3', 'bar2'], syms, R).pay, R.anyBarPay);
  assert.equal(evaluateClassicLine(['seven', 'wild', 'seven'], syms, R).pay, pay('seven', 3) * R.wildMult);
  assert.equal(evaluateClassicLine(['seven', 'wild', 'wild'], syms, R).pay, pay('seven', 3) * R.wildMult ** 2);
  assert.equal(evaluateClassicLine(['wild', 'wild', 'wild'], syms, R).pay, pay('wild', 3));
  assert.equal(evaluateClassicLine(['lemon', 'cherry', 'cherry'], syms, R), null);
  const e = ENGINES['classic-reels'];
  const rng = seededRng(2);
  let multHit = 0;
  for (let i = 0; i < 5000; i++) {
    const r = e.play(c, rng);
    if (!r.capped) assert.ok(Math.abs(r.totalWin - r.lineWin * r.multiplier) < 1e-6);
    if (r.multiplier > 1 && r.lineWin > 0) multHit++;
  }
  assert.ok(multHit > 0);
});

test('level-up: el estado del jugador pasa de giro en giro, sube de nivel y el jackpot reinicia', () => {
  const e = ENGINES['level-up'];
  const c = seeds['level-up'];
  const R = c.rules;
  const rng = seededRng(5);
  let st = e.initialState(c);
  let ups = 0, jackpots = 0, bonuses = 0, collects = 0;
  for (let i = 0; i < 20000; i++) {
    const r = e.play(c, rng, { state: st });
    assert.deepEqual(r.stateBefore, e.cleanState(R, st));
    ups += r.levelUps.length;
    if (r.bonus) bonuses++;
    if (r.collect.completed) collects++;
    if (r.jackpot) { jackpots++; assert.equal(r.state.level, 1); }
    // El multiplicador del nivel solo se aplica desde su nivel
    const m = Math.max(1, ...R.rewards.filter((x) => x.type === 'multiplier' && x.level <= r.stateBefore.level).map((x) => x.value));
    assert.equal(r.levelMult, m);
    assert.ok(r.state.level >= 1 && r.state.level <= R.maxLevel && r.state.xp < r.xpNeed);
    st = r.state;
  }
  assert.ok(ups > 20 && bonuses > 20 && collects > 3 && jackpots > 0, JSON.stringify({ ups, bonuses, collects, jackpots }));
  // Mismo estado + mismos números = mismo resultado (auditoría)
  const rec = recordingRng(seededRng(9));
  const s0 = { level: 9, xp: 10, collect: 3 };
  const a = e.play(c, rec, { state: s0 });
  const b = e.play(c, replayRng(rec.draws), { state: s0 });
  assert.equal(a.totalWin, b.totalWin);
  assert.deepEqual(a.state, b.state);
});

test('crash: RTP exacto para cualquier estrategia, curva inversa y punto verificable', async () => {
  const crash = await import('../backend/math/crash.js');
  const c = crash.defaults();
  assert.deepEqual(validateConfig(c), []);
  // P(explosión ≥ x) = rtp / x  →  retirarse en x devuelve rtp
  for (const x of [1.01, 1.5, 2, 10]) {
    const r = crash.simulateTarget(c, seededRng(99 + Math.round(x * 100)), 400_000, x);
    const se = Math.sqrt(c.rules.rtp * x - c.rules.rtp ** 2) / Math.sqrt(400_000);
    assert.ok(Math.abs(r - c.rules.rtp) < 4 * se, `x${x}: ${r}`);
  }
  for (const m of [1.01, 2, 9.99, 10, 10.3, 11, 100, 1000]) assert.ok(Math.abs(crash.multAt(crash.timeFor(m, c.rules.curve), c.rules.curve) - m) < 1e-6 * m);
  assert.equal(crash.crashFromUniform(0, 0.97, 1000), 1);
  assert.equal(crash.crashFromUniform(0.999999999, 0.97, 1000), 1000);
  const seed = 'f'.repeat(64);
  assert.equal(crash.crashFromSeed(seed, 0.97, 1000), crash.crashFromSeed(seed, 0.97, 1000));
  // Premio máximo por apuesta: retira automáticamente antes
  assert.equal(crash.autoTarget({ rules: { ...c.rules, limits: { ...c.rules.limits, maxPayout: 1000 } } }, 100, 50), 10);
  // Inválidos
  assert.ok(validateConfig({ ...c, rules: { ...c.rules, rtp: 1.02 } }).length);
  assert.ok(validateConfig({ ...c, rules: { ...c.rules, maxBets: 3 } }).length);
});

test('cascada que duplica: el multiplicador se duplica por cascada y sigue en los giros gratis', async () => {
  const td = await import('../backend/math/tumble-double.js');
  const c = td.defaults();
  const rng = seededRng(31);
  let seenCascade = false, seenFs = false;
  for (let i = 0; i < 20000 && !(seenCascade && seenFs); i++) {
    const r = td.play(c, rng);
    const st = r.base.steps;
    st.forEach((x, k) => assert.equal(x.multiplier, Math.min(c.rules.multMax, 2 ** k)));
    if (st.length > 2) seenCascade = true;
    if (r.freeSpins) {
      seenFs = true;
      let m = 1;
      for (const s of r.freeSpins.spins) {
        assert.equal(s.steps[0].multiplier, m, 'el giro empieza con el multiplicador del anterior');
        m = s.multAfter;
        assert.ok(m <= c.rules.fsMultMax);
      }
    }
  }
  assert.ok(seenCascade && seenFs);
});

test('tres soles: cada sol suma a su barra, la barra llena da su bonus y sobra lo que pasa', async () => {
  const ts = await import('../backend/math/triple-sun.js');
  const c = ts.defaults();
  const rng = seededRng(5);
  let st = ts.initialState();
  const fills = { red: 0, gold: 0, blue: 0 };
  for (let i = 0; i < 20000; i++) {
    const r = ts.play(c, rng, { state: st });
    assert.deepEqual(r.stateBefore, st);
    for (const col of ts.COLORS) {
      const added = r.suns.filter((x) => x.color === col).length;
      const filled = r.filled.includes(col);
      assert.equal(r.state[col], st[col] + added - (filled ? c.rules.pots[col].target : 0));
      assert.ok(r.state[col] >= 0 && r.state[col] < c.rules.pots[col].target);
      if (filled) { fills[col]++; const b = r.bonuses.find((x) => x.color === col); assert.equal(b.spins.length, c.rules.pots[col].spins); }
    }
    st = r.state;
  }
  assert.ok(fills.red > 0 && fills.gold > 0 && fills.blue > 0, JSON.stringify(fills));
  // El estado guardado se sanea si cambió la configuración
  assert.deepEqual(ts.cleanState(c.rules, { red: 999, gold: -3, blue: 'x' }), { red: 14, gold: 0, blue: 0 });
});
