// Mesa de dados EN VIVO (estilo ruleta europea en vivo): una mesa compartida por juego en la que todos los
// jugadores apuestan durante una cuenta regresiva, se cierra la mesa ("no va más"), el CRUPIER tira y se pagan
// todas las apuestas a la vez con los mismos dados.
//
// - Los dados los sortea el servidor (RNG criptográfico) en el momento del "no va más"; el video del crupier que
//   se ve en pantalla es el clip grabado que corresponde a ese resultado. Nunca hay secuencias fijas.
// - La fase de la mesa (salida / punto) es de la MESA, no de cada jugador: las apuestas de cada jugador se
//   resuelven con la fase y el punto de la mesa.
// - Cada tirada queda grabada (live_rolls) y cada jugador tiene su ronda auditada con los mismos números.
// - La mesa solo corre mientras alguien la está mirando (se apaga sola a los 2 minutos sin jugadores).
//
// Ciclo: betting (rules.live.bettingSeconds) → closed (closeSeconds) → rolling (rollSeconds: dura el video) →
// result (resultSeconds) → betting…
import { randomUUID } from 'node:crypto';
import { all, one, run } from '../db.js';
import { HttpError } from '../lib/http.js';
import { getEngine } from '../math/index.js';
import { recordingRng, cryptoRng } from '../math/rng.js';
import { getSession } from './wallets.js';
import { loadConfigFor } from './rounds.js';
import { settleRoll } from './table.js';

export const LIVE_DEFAULTS = { enabled: false, bettingSeconds: 20, closeSeconds: 2, rollSeconds: 9, resultSeconds: 5, historySize: 20 };
const IDLE_MS = 120_000;
const tables = new Map(); // key → { key, gameId, source, state, config, version, touched, busy }

export const liveRules = (config) => ({ ...LIVE_DEFAULTS, ...(config?.rules?.live || {}) });
export const isLive = (config) => getEngine(config.engine).kind === 'table' && !!config.rules?.live?.enabled;

const keyOf = (session) => `${session.game_id}:${session.source === 'draft' ? 'draft' : 'live'}`;

function loadTable(session, config, version) {
  const key = keyOf(session);
  let t = tables.get(key);
  if (!t) {
    const row = one('SELECT state FROM live_tables WHERE id = ?', key);
    const saved = row ? JSON.parse(row.state) : null;
    const L = liveRules(config);
    t = {
      key, gameId: session.game_id, source: session.source === 'draft' ? 'draft' : 'live', busy: false,
      state: saved?.roundNo ? { ...saved, phase: 'betting', endsAt: Date.now() + L.bettingSeconds * 1000 }
        : { roundNo: 1, phase: 'betting', endsAt: Date.now() + L.bettingSeconds * 1000, tablePhase: 'comeOut', point: null, history: [], lastRoll: null },
    };
    tables.set(key, t);
    save(t);
  }
  t.config = config; t.version = version; t.touched = Date.now();
  return t;
}

function save(t) {
  run(`INSERT INTO live_tables (id, game_id, state, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`, t.key, t.gameId, JSON.stringify(t.state));
}

/** Estado público de la mesa (los dados solo se ven desde que tira el crupier). */
function publicTable(t) {
  const s = t.state;
  const L = liveRules(t.config);
  const players = one(`SELECT COUNT(*) AS n FROM table_state ts JOIN sessions se ON se.token = ts.session_token
    WHERE ts.game_id = ? AND ts.updated_at > datetime('now', '-3 minutes') AND (se.source = 'draft') = ?`, t.gameId, t.source === 'draft' ? 1 : 0)?.n || 0;
  return {
    roundNo: s.roundNo, phase: s.phase, endsAt: s.endsAt, serverNow: Date.now(),
    seconds: { betting: L.bettingSeconds, close: L.closeSeconds, roll: L.rollSeconds, result: L.resultSeconds },
    tablePhase: s.tablePhase, point: s.point, history: s.history,
    roll: (s.phase === 'rolling' || s.phase === 'result') && s.lastRoll ? s.lastRoll : null,
    players,
  };
}

/** Avanza la mesa si se cumplió el tiempo de la fase actual. */
async function advance(t) {
  if (t.busy) return;
  const s = t.state;
  if (Date.now() < s.endsAt) return;
  const L = liveRules(t.config);
  t.busy = true;
  try {
    if (s.phase === 'betting') {
      s.phase = 'closed'; s.endsAt = Date.now() + L.closeSeconds * 1000;
    } else if (s.phase === 'closed') {
      await rollTable(t);
      s.phase = 'rolling'; s.endsAt = Date.now() + L.rollSeconds * 1000;
    } else if (s.phase === 'rolling') {
      s.phase = 'result'; s.endsAt = Date.now() + L.resultSeconds * 1000;
    } else {
      s.phase = 'betting'; s.roundNo += 1; s.endsAt = Date.now() + L.bettingSeconds * 1000;
    }
    save(t);
  } finally { t.busy = false; }
}

/** "No va más": sortea los dados, guarda la tirada y paga a todos los jugadores de la mesa. */
async function rollTable(t) {
  const s = t.state;
  const engine = getEngine(t.config.engine);
  const rng = recordingRng(cryptoRng());
  // La tirada de la mesa: con una mesa vacía solo se calcula cómo cambia la fase (salida / punto)
  const r = engine.roll(t.config, { phase: s.tablePhase, point: s.point, bets: [], history: [] }, rng);
  const rollId = `lr_${randomUUID()}`;
  const draws = rng.draws;
  run(`INSERT INTO live_rolls (id, table_id, game_id, round_no, version, dice, rng, phase_before, point_before) VALUES (?,?,?,?,?,?,?,?,?)`,
    rollId, t.key, t.gameId, s.roundNo, t.version ?? null, JSON.stringify(r.dice), JSON.stringify(draws), s.tablePhase, s.point ?? null);
  const before = { tablePhase: s.tablePhase, point: s.point };
  s.tablePhase = r.state.phase; s.point = r.state.point;
  s.lastRoll = { id: rollId, roundNo: s.roundNo, dice: r.dice, total: r.total, hard: r.hard, phaseBefore: before.tablePhase, pointBefore: before.point, phase: s.tablePhase, point: s.point };
  s.history = [{ dice: r.dice, total: r.total }, ...(s.history || [])].slice(0, liveRules(t.config).historySize);
  // Todos los jugadores con apuestas en esta mesa, con los mismos números
  const rows = all(`SELECT ts.session_token, ts.state FROM table_state ts JOIN sessions se ON se.token = ts.session_token
    WHERE ts.game_id = ? AND (se.source = 'draft') = ?`, t.gameId, t.source === 'draft' ? 1 : 0)
    .filter((x) => { try { return JSON.parse(x.state).bets?.length > 0; } catch { return false; } });
  for (const { session_token: token } of rows) {
    try { await settleRoll(token, { draws, table: before, live: { rollId, roundNo: s.roundNo } }); }
    catch (e) { console.error('[live] no se pudo pagar a', token.slice(0, 10), e.message); }
  }
}

// Reloj de las mesas activas
let timer = null;
export function startLiveTables() {
  if (timer) return;
  timer = setInterval(() => {
    for (const [key, t] of tables) {
      if (Date.now() - t.touched > IDLE_MS && t.state.phase === 'betting') { tables.delete(key); continue; }
      advance(t).catch((e) => console.error('[live]', e.message));
    }
  }, 250);
  timer.unref?.();
}
export function stopLiveTables() { clearInterval(timer); timer = null; tables.clear(); }

/** Para el jugador: la mesa compartida + su propio estado. */
export async function getLive(token) {
  const session = getSession(token);
  const { version, config } = loadConfigFor(session);
  if (!isLive(config)) throw new HttpError(400, 'Esta mesa no es en vivo');
  const t = loadTable(session, config, version);
  await advance(t);
  return { table: publicTable(t) };
}

/** Fase de la mesa para alinear al jugador y saber si se puede apostar. */
export function liveGate(session, config, version, { forBet = false } = {}) {
  const t = loadTable(session, config, version);
  if (forBet && t.state.phase !== 'betting') throw new HttpError(409, 'No va más: espera la próxima ronda para apostar');
  return { tablePhase: t.state.tablePhase, point: t.state.point };
}

/** Tirada de una ronda en vivo (auditoría). */
export function liveRoll(id) {
  const r = one('SELECT * FROM live_rolls WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Tirada no encontrada');
  return { ...r, dice: JSON.parse(r.dice), rng: JSON.parse(r.rng) };
}

