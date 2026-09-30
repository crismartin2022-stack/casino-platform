// Prueba silenciosa de la matemática y las jugadas de un juego (corre en el hilo del simulador).
// Juega miles de rondas con semilla fija y revisa que nada falle: jugadas base, bonus, compras de bonus,
// premios dentro del tope, reproducción exacta para auditoría y niveles de apuesta en varias monedas.
// Cada chequeo devuelve { id, area, label, status: ok|warn|fail|info, detail, fix, agent }.
import { getEngine, validateConfig, costMultiplier, simulate, RTP_RANGE } from './index.js';
import { seededRng, recordingRng, replayRng } from './rng.js';
import { validateBets, applyCurrency } from './currency.js';
import * as craps from './craps.js';

const pct = (x) => `${(x * 100).toFixed(2)} %`;
const featureOf = (r) => !!((r.freeSpins && (r.freeSpins.awarded > 0 || r.freeSpins.spins?.length)) || r.holdAndWin || r.respins?.length || r.bonus);
const TEST_CURRENCIES = ['USD', 'EUR', 'ARS', 'BRL', 'MXN', 'CLP', 'COP'];

export function selfTest(config, { plays = 20_000, seed = 777, math = null, rtpSpins = 150_000 } = {}) {
  const checks = [];
  const add = (c) => checks.push({ status: 'ok', detail: '', fix: '', agent: null, ...c });
  const t0 = Date.now();

  // 1) Configuración
  const errors = validateConfig(config);
  add(errors.length
    ? { id: 'config', area: 'Configuración', label: 'Configuración válida', status: 'fail', detail: errors.join(' · '), fix: `Corregir la configuración: ${errors.join('; ')}`, agent: 'director' }
    : { id: 'config', area: 'Configuración', label: 'Configuración válida', detail: 'Todos los campos obligatorios están bien.' });
  if (errors.length) return { checks, ms: Date.now() - t0 };

  let engine;
  try { engine = getEngine(config.engine); } catch (e) {
    add({ id: 'engine', area: 'Configuración', label: 'Motor del juego', status: 'fail', detail: e.message, fix: 'Elegir un motor existente', agent: 'director' });
    return { checks, ms: Date.now() - t0 };
  }

  // 2) Apuestas y monedas
  const betErrs = validateBets(config);
  const badCur = [];
  for (const cur of TEST_CURRENCIES) {
    try {
      const c = applyCurrency(config, cur);
      const lv = c.bet?.levels || [];
      if (!lv.length || lv.some((v, i) => !Number.isInteger(v) || v <= 0 || (i && v <= lv[i - 1]))) badCur.push(cur);
    } catch { badCur.push(cur); }
  }
  add(betErrs.length || badCur.length
    ? { id: 'bets', area: 'Apuestas', label: 'Niveles de apuesta y monedas', status: 'fail',
      detail: [...betErrs, badCur.length ? `Niveles inválidos al convertir a ${badCur.join(', ')}` : ''].filter(Boolean).join(' · '),
      fix: 'Revisar los niveles de apuesta en Matemática → Apuestas por moneda (enteros positivos, en orden creciente).', agent: 'math' }
    : { id: 'bets', area: 'Apuestas', label: 'Niveles de apuesta y monedas', detail: `${config.bet.levels.length} niveles; convierten bien a ${TEST_CURRENCIES.join(', ')}.` });

  if (engine.kind === 'table') return { checks: [...checks, ...tableChecks(config, { plays, seed })], ms: Date.now() - t0 };

  const cap = config.rules?.maxWin ?? 5000;
  const cost = costMultiplier(engine, config, 'base');

  // 3) Jugadas base
  const rng = seededRng(seed);
  let crashes = 0, firstCrash = '', badWins = 0, overCap = 0, hits = 0, features = 0, capped = 0, n = 0;
  let featureSample = null;
  for (; n < plays; n++) {
    let r;
    try { r = engine.play(config, rng, { mode: 'base' }); } catch (e) { crashes++; firstCrash ||= e.message; continue; }
    const w = r.totalWin;
    if (!Number.isFinite(w) || w < 0) badWins++;
    if (w > cap + 1e-6) overCap++;
    if (w > 0) hits++;
    if (r.capped) capped++;
    if (featureOf(r)) { features++; featureSample ||= r; }
  }
  add(crashes
    ? { id: 'plays', area: 'Jugadas', label: `Jugadas base (${n.toLocaleString('es')})`, status: 'fail', detail: `${crashes} jugadas fallaron. Primer error: ${firstCrash}`, fix: 'Revisar tiras de rodillos, símbolos y reglas: una jugada no puede fallar nunca con dinero real.', agent: 'math' }
    : { id: 'plays', area: 'Jugadas', label: `Jugadas base (${n.toLocaleString('es')})`, detail: 'Ninguna jugada falló.' });
  add(badWins || overCap
    ? { id: 'payouts', area: 'Jugadas', label: 'Premios válidos y dentro del tope', status: 'fail', detail: `${badWins} premios inválidos, ${overCap} por encima del tope de ×${cap}.`, fix: `Ajustar la tabla de pagos o el tope máximo (rules.maxWin = ${cap}).`, agent: 'math' }
    : { id: 'payouts', area: 'Jugadas', label: 'Premios válidos y dentro del tope', detail: `Todos los premios son válidos y respetan el tope de ×${cap}.` });

  const hf = hits / Math.max(1, n - crashes);
  add(hf < 0.08
    ? { id: 'hits', area: 'Experiencia', label: 'Frecuencia de premio', status: 'warn', detail: `Solo ${pct(hf)} de los giros paga algo: el jugador pasa muchos giros sin ganar.`, fix: 'Subir la frecuencia de premios bajos (más símbolos bajos en las tiras) manteniendo el RTP.', agent: 'math' }
    : hf > 0.75
      ? { id: 'hits', area: 'Experiencia', label: 'Frecuencia de premio', status: 'warn', detail: `${pct(hf)} de los giros paga: casi todos los premios serán menores que la apuesta.`, fix: 'Bajar la frecuencia de premios y subir su tamaño manteniendo el RTP.', agent: 'math' }
      : { id: 'hits', area: 'Experiencia', label: 'Frecuencia de premio', detail: `${pct(hf)} de los giros paga algo (1 de cada ${(1 / Math.max(hf, 1e-9)).toFixed(1)}).` });
  if (capped / n > 0.001) add({ id: 'cap', area: 'Matemática', label: 'Premios que tocan el tope', status: 'warn', detail: `${capped} de ${n} jugadas llegaron al tope de ×${cap}.`, fix: `Subir el tope máximo o bajar los pagos altos: el tope se alcanza demasiado seguido.`, agent: 'math' });

  // 4) Reproducción exacta (auditoría): la misma extracción del RNG da el mismo resultado
  let replayBad = 0, replayErr = '';
  const rr = seededRng(seed + 1);
  for (let i = 0; i < 300; i++) {
    const rec = recordingRng(rr);
    try {
      const a = engine.play(config, rec, { mode: 'base' });
      const b = engine.play(config, replayRng(rec.draws), { mode: 'base' });
      if (JSON.stringify(a) !== JSON.stringify(b)) replayBad++;
    } catch (e) { replayBad++; replayErr ||= e.message; }
  }
  add(replayBad
    ? { id: 'replay', area: 'Auditoría', label: 'Reproducción exacta de rondas', status: 'fail', detail: `${replayBad} de 300 rondas no se reproducen igual${replayErr ? ` (${replayErr})` : ''}.`, fix: 'La matemática usa algo fuera del RNG (fecha, azar propio): debe depender solo del RNG para poder auditar.', agent: 'math' }
    : { id: 'replay', area: 'Auditoría', label: 'Reproducción exacta de rondas', detail: '300 de 300 rondas se reproducen idénticas (auditable).' });

  // 5) Bonus
  let every = features ? Math.round(n / features) : null;
  if (!features) {
    const r2 = seededRng(seed + 2);
    for (let i = 0; i < 60_000; i++) {
      let r; try { r = engine.play(config, r2, { mode: 'base' }); } catch { continue; }
      if (featureOf(r)) { featureSample = r; every = Math.round((n + i + 1)); break; }
    }
  }
  if (!featureSample) {
    add({ id: 'bonus', area: 'Bonus', label: 'Bonus alcanzable', status: 'info', detail: `No salió ningún bonus en ${(n + 60_000).toLocaleString('es')} jugadas: el juego no tiene bonus en el juego base.`, fix: '', agent: null });
  } else {
    const fsSpins = featureSample.freeSpins?.spins;
    const broken = Array.isArray(fsSpins) && featureSample.freeSpins.awarded > 0 && fsSpins.length === 0;
    if (broken) add({ id: 'bonusPlay', area: 'Bonus', label: 'El bonus se juega completo', status: 'fail', detail: 'El bonus se activa pero no juega ningún giro gratis.', fix: 'Revisar las reglas de giros gratis (cantidad otorgada y tiras del bonus).', agent: 'math' });
    else add({ id: 'bonusPlay', area: 'Bonus', label: 'El bonus se juega completo', detail: 'El bonus se activa y termina bien.' });
    add(every > 350
      ? { id: 'bonus', area: 'Bonus', label: 'Frecuencia del bonus', status: 'warn', detail: `El bonus sale 1 de cada ~${every} giros: muy raro, el juego se siente poco atractivo.`, fix: 'Ajustar la frecuencia del bonus a 1 de cada 150–200 giros (Matemática → Frecuencia del bonus).', agent: 'math' }
      : every < 40
        ? { id: 'bonus', area: 'Bonus', label: 'Frecuencia del bonus', status: 'warn', detail: `El bonus sale 1 de cada ~${every} giros: demasiado seguido, pierde emoción y paga poco.`, fix: 'Ajustar la frecuencia del bonus a 1 de cada 100–200 giros.', agent: 'math' }
        : { id: 'bonus', area: 'Bonus', label: 'Frecuencia del bonus', detail: `Sale 1 de cada ~${every} giros.` });
  }

  // 6) Compras de bonus
  for (const mode of (engine.modes || ['base']).filter((m) => m !== 'base')) {
    const mc = costMultiplier(engine, config, mode);
    let err = '', feat = 0, bad = 0;
    const r3 = seededRng(seed + 3);
    const N = 2000;
    for (let i = 0; i < N; i++) {
      let r; try { r = engine.play(config, r3, { mode }); } catch (e) { err ||= e.message; continue; }
      if (!Number.isFinite(r.totalWin) || r.totalWin < 0 || r.totalWin > cap + 1e-6) bad++;
      if (featureOf(r)) feat++;
    }
    const label = `Compra de bonus: ${mode}`;
    if (!(mc > 0) || !Number.isFinite(mc)) add({ id: `buy-${mode}`, area: 'Compra de bonus', label, status: 'fail', detail: `Precio inválido (×${mc}).`, fix: 'Fijar un precio de compra positivo.', agent: 'math' });
    else if (err || bad) add({ id: `buy-${mode}`, area: 'Compra de bonus', label, status: 'fail', detail: err ? `Falla al jugar: ${err}` : `${bad} premios inválidos o sobre el tope.`, fix: 'Revisar las reglas de la compra de bonus.', agent: 'math' });
    else if (feat / N < 0.99) add({ id: `buy-${mode}`, area: 'Compra de bonus', label, status: 'warn', detail: `Solo ${pct(feat / N)} de las compras entregó el bonus.`, fix: 'Una compra de bonus debería entregar siempre el bonus: revisar la regla de la compra.', agent: 'math' });
    else add({ id: `buy-${mode}`, area: 'Compra de bonus', label, detail: `Precio ×${mc}; entrega el bonus siempre y los premios son válidos.` });
  }

  // 7) RTP
  if (math?.rejected) {
    add({ id: 'rtp', area: 'Matemática', label: 'RTP', status: 'fail', detail: math.rejected, fix: `Reajustar la tabla de pagos al RTP objetivo ${pct(config.rtpTarget)} (Matemática → Ajustar RTP, o pedírselo al Matemático).`, agent: 'math' });
  } else if (math?.rtp != null) {
    add({ id: 'rtp', area: 'Matemática', label: 'RTP', detail: `RTP certificado ${pct(math.rtp)}${math.precision ? ` ±${(math.precision * 100).toFixed(2)} %` : ''} (objetivo ${pct(config.rtpTarget)})${math.spins ? ` con ${math.spins.toLocaleString('es')} giros` : ''}.` });
  } else {
    const sim = simulate(config, { spins: rtpSpins, seed: seed + 4, timeBudgetMs: 15_000 });
    const off = Math.abs(sim.rtp - config.rtpTarget);
    const inCi = config.rtpTarget >= sim.rtpLow && config.rtpTarget <= sim.rtpHigh;
    add(off > 0.01 && !inCi
      ? { id: 'rtp', area: 'Matemática', label: 'RTP', status: 'warn', detail: `Simulado ${pct(sim.rtp)} vs objetivo ${pct(config.rtpTarget)} (${sim.spins.toLocaleString('es')} giros). Al publicar se certifica con más giros y puede rechazarse.`, fix: `Reajustar la tabla de pagos al RTP objetivo ${pct(config.rtpTarget)} (tune_rtp).`, agent: 'math' }
      : { id: 'rtp', area: 'Matemática', label: 'RTP', detail: `Simulado ${pct(sim.rtp)} vs objetivo ${pct(config.rtpTarget)} (${sim.spins.toLocaleString('es')} giros).` });
  }
  if (math?.precision > 0.005 && !math?.rejected) add({ id: 'rtpPrecision', area: 'Matemática', label: 'Precisión de la certificación', status: 'warn',
    detail: `El RTP quedó certificado con ±${(math.precision * 100).toFixed(2)} %: este juego es muy volátil y en el tiempo disponible no se llegó a ±0,5 %.`,
    fix: 'Para dinero real conviene ±0,5 % o menos: dar más tiempo a la certificación (PUBLISH_SIM_BUDGET_MS) o más núcleos al servidor (SIM_THREADS), y volver a publicar.', agent: null });
  if (!(config.rtpTarget <= 1)) add({ id: 'rtpOver', area: 'Matemática', label: 'RTP por encima de 100 %', status: 'warn', detail: 'El juego devuelve más de lo que recauda.', fix: 'Solo para promociones o demo: para dinero real usar un RTP ≤ 100 %.', agent: 'math' });
  void cost;
  return { checks, ms: Date.now() - t0 };
}

/** Mesa de dados: RTP exacto por apuesta, miles de tiradas y reproducción exacta. */
function tableChecks(config, { plays, seed }) {
  const out = [];
  const add = (c) => out.push({ status: 'ok', detail: '', fix: '', agent: null, ...c });
  const rtps = craps.enabledRtps(config);
  const off = rtps.filter((x) => !(x.rtp >= RTP_RANGE[0] && x.rtp <= RTP_RANGE[1]));
  add(off.length
    ? { id: 'rtp', area: 'Matemática', label: 'RTP exacto por apuesta', status: 'fail', detail: off.map((x) => `${x.bet}: ${pct(x.rtp)}`).join(' · '), fix: 'Ajustar los pagos de esas apuestas para que el RTP quede entre 85 % y 110 %.', agent: 'math' }
    : { id: 'rtp', area: 'Matemática', label: 'RTP exacto por apuesta', detail: `${rtps.length} apuestas habilitadas, todas entre ${pct(Math.min(...rtps.map((x) => x.rtp)))} y ${pct(Math.max(...rtps.map((x) => x.rtp)))}.` });
  const R = config.rules;
  const rng = seededRng(seed);
  let st = craps.newTableState(), err = '', bad = 0, n = 0, replayBad = 0;
  for (; n < Math.min(plays, 10_000); n++) {
    try {
      if (st.phase === 'comeOut' && R.bets.pass && !st.bets.some((b) => b.type === 'pass')) st = craps.addBet(config, st, { type: 'pass', amount: R.limits.min });
      if (R.bets.field && n % 3 === 0) st = craps.addBet(config, st, { type: 'field', amount: R.limits.min });
      const rec = recordingRng(rng);
      const r = craps.roll(config, st, rec);
      if (!Number.isFinite(r.payout) || r.payout < 0) bad++;
      if (n < 300 && JSON.stringify(craps.roll(config, st, replayRng(rec.draws)).dice) !== JSON.stringify(r.dice)) replayBad++;
      st = r.state;
    } catch (e) { err ||= e.message; st = craps.newTableState(); }
  }
  add(err || bad
    ? { id: 'plays', area: 'Jugadas', label: `Tiradas de prueba (${n.toLocaleString('es')})`, status: 'fail', detail: err || `${bad} pagos inválidos`, fix: 'Revisar límites y pagos de la mesa.', agent: 'math' }
    : { id: 'plays', area: 'Jugadas', label: `Tiradas de prueba (${n.toLocaleString('es')})`, detail: 'Todas las tiradas y pagos fueron válidos.' });
  add(replayBad
    ? { id: 'replay', area: 'Auditoría', label: 'Reproducción exacta de tiradas', status: 'fail', detail: `${replayBad} tiradas no se reproducen igual.`, fix: 'Los dados deben depender solo del RNG.', agent: 'math' }
    : { id: 'replay', area: 'Auditoría', label: 'Reproducción exacta de tiradas', detail: 'Las tiradas se reproducen idénticas (auditable).' });
  return out;
}
