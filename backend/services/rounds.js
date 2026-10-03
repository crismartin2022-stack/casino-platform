// Rondas de juego: débito → RNG en servidor → crédito, con registro auditable y reproducible.
import { randomUUID } from 'node:crypto';
import { one, run, all, tx } from '../db.js';
import { HttpError } from '../lib/http.js';
import { getEngine, costMultiplier } from '../math/index.js';
import { recordingRng, cryptoRng, replayRng } from '../math/rng.js';
import { getSession, walletForSession } from './wallets.js';
import { getPublished, getDraft, getVersionConfig } from './games.js';
import { replayTableRound as replayTable } from './table.js';
import { configWithVariant, variantById } from './variants.js';
import { applyCurrency, operatorLimits } from './bets.js';
import { crashFromSeed, hashSeed } from '../math/crash.js';

export function loadConfigFor(session) {
  if (session.source === 'draft') {
    if (session.mode !== 'demo') throw new HttpError(403, 'Los borradores solo se pueden jugar en modo demo');
    return { version: null, config: applyCurrency(getDraft(session.game_id), session.currency), variantId: null };
  }
  const pub = getPublished(session.game_id);
  // RTP asignado por el proveedor a este operador + fichas de la moneda de la sesión y límites del operador
  const config = session.variant_id ? configWithVariant(session.game_id, pub.version, session.variant_id) : pub.config;
  return { version: pub.version, config: applyCurrency(config, session.currency, operatorLimits(session.operator_id, session.currency)), variantId: session.variant_id || null };
}

/** RTP/volatilidad que ve el jugador: los de la variante si la sesión tiene una. */
export function mathFor(session, gameMath) {
  if (!session.variant_id) return gameMath;
  const v = variantById(session.variant_id);
  return v.math ? JSON.parse(v.math) : gameMath;
}

const toCents = (mult, bet) => Math.round(mult * bet);

/** Ronda ya existente para el mismo clientRoundId → se devuelve tal cual (idempotencia). */
function existingRound(token, clientRoundId) {
  if (!clientRoundId) return null;
  const r = one('SELECT * FROM rounds WHERE session_token = ? AND client_round_id = ?', token, clientRoundId);
  return r ? formatRound(r) : null;
}

export function formatRound(r) {
  return {
    roundId: r.id, status: r.status, bet: r.bet, cost: r.cost, win: r.win,
    balance: r.balance_after, playMode: r.play_mode, version: r.version,
    result: r.result ? JSON.parse(r.result) : null, createdAt: r.created_at,
  };
}

/** ¿El resultado trae un bonus (giros gratis, Hold & Win, re-giros, minijuego)? */
export function hasFeature(r) {
  return !!((r.freeSpins && (r.freeSpins.awarded > 0 || r.freeSpins.spins?.length)) || r.holdAndWin || r.respins?.length || r.bonus);
}

/** Progreso guardado del jugador en un juego con niveles (por apuesta). */
export function loadProgress(playerId, gameId, bet, engine, config) {
  const r = one('SELECT state FROM player_progress WHERE player_id = ? AND game_id = ? AND bet = ?', playerId, gameId, bet);
  const s = r ? JSON.parse(r.state) : engine.initialState(config);
  return engine.cleanState ? engine.cleanState(config.rules, s) : s;
}
function saveProgress(playerId, gameId, bet, state) {
  run(`INSERT INTO player_progress (player_id, game_id, bet, state, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT (player_id, game_id, bet) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`, playerId, gameId, bet, JSON.stringify(state));
}

/** Nivel del jugador para la apuesta indicada (lo pide el juego al abrir y al cambiar la apuesta). */
export function playerProgress(token, bet) {
  const session = getSession(token);
  const { config } = loadConfigFor(session);
  const engine = getEngine(config.engine);
  if (!engine.stateful) throw new HttpError(400, 'Este juego no tiene niveles');
  if (!config.bet.levels.includes(bet)) throw new HttpError(400, `Apuesta no permitida. Niveles: ${config.bet.levels.join(', ')}`);
  const state = loadProgress(session.player_id, session.game_id, bet, engine, config);
  return { bet, state, xpNeed: engine.xpNeeded(config.rules, state.level) };
}

export async function playRound(token, { bet, mode = 'base', clientRoundId = null, force = false }) {
  const session = getSession(token);
  const prior = existingRound(token, clientRoundId);
  if (prior) return { ...prior, replayed: true };

  const { version, config, variantId } = loadConfigFor(session);
  const engine = getEngine(config.engine);
  if (engine.kind === 'table') throw new HttpError(400, 'Este juego es de mesa: usa /api/v1/table');
  if (engine.kind === 'crash') throw new HttpError(400, 'Este juego es Crash: usa /api/v1/crash');
  if (!config.bet.levels.includes(bet)) throw new HttpError(400, `Apuesta no permitida. Niveles: ${config.bet.levels.join(', ')}`);
  if (!(engine.modes || ['base']).includes(mode)) throw new HttpError(400, `Modo de juego no disponible: ${mode}`);
  const cost = Math.round(bet * costMultiplier(engine, config, mode));

  // Forzar bonus: SOLO en la vista previa del borrador (demo), para probar sonidos y animaciones del bonus.
  if (force && session.source !== 'draft') throw new HttpError(403, 'Forzar el bonus solo está permitido en la vista previa del borrador');
  let rng = recordingRng(cryptoRng());
  // Juegos con nivel del jugador: el estado se lee y se guarda en el mismo paso (sin esperas en el medio)
  const produce = () => {
    const state = engine.stateful ? loadProgress(session.player_id, session.game_id, bet, engine, config) : undefined;
    for (let i = 0; i < (force ? 60_000 : 1); i++) {
      if (i) rng = recordingRng(cryptoRng());
      const res = engine.play(config, rng, engine.stateful ? { mode, state } : { mode });
      if (!force || hasFeature(res)) {
        if (engine.stateful) saveProgress(session.player_id, session.game_id, bet, res.state);
        return res;
      }
    }
    throw new HttpError(409, 'Este juego no tiene un bonus que se pueda forzar (o es demasiado raro): revisa la frecuencia del bonus en Matemática');
  };
  const roundId = `rd_${randomUUID()}`;
  const wallet = walletForSession(session);
  const base = [roundId, clientRoundId, token, session.player_id, session.game_id, version, variantId ?? null, session.source, session.mode, mode, bet, cost];

  if (wallet.mode === 'internal') {
    // Todo en una transacción: o se registra la ronda completa o no pasa nada.
    const row = tx(() => {
      const before = one('SELECT balance FROM players WHERE id = ?', session.player_id).balance;
      wallet.debitSync(cost, roundId);
      const result = produce();
      const win = toCents(result.totalWin, bet);
      const after = wallet.creditSync(win, roundId);
      run(`INSERT INTO rounds (id, client_round_id, session_token, player_id, game_id, version, variant_id, source, mode, play_mode, bet, cost,
             win, balance_before, balance_after, status, rng, result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'completed',?,?)`,
        ...base, win, before, after, JSON.stringify(rng.draws), JSON.stringify(result));
      return one('SELECT * FROM rounds WHERE id = ?', roundId);
    });
    return formatRound(row);
  }

  // Seamless: la ronda queda registrada antes de tocar el dinero del operador.
  run(`INSERT INTO rounds (id, client_round_id, session_token, player_id, game_id, version, variant_id, source, mode, play_mode, bet, cost, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending_debit')`, ...base);
  let afterDebit;
  try {
    afterDebit = await wallet.debit(cost, roundId);
  } catch (e) {
    run("UPDATE rounds SET status = 'debit_failed', error = ? WHERE id = ?", e.message, roundId);
    // Si fue un fallo de red, el débito pudo aplicarse en el operador: pedimos anularlo (idempotente por txId).
    if (!e.status) {
      wallet.rollback(cost, roundId)
        .then(() => run("UPDATE rounds SET status = 'rolled_back' WHERE id = ?", roundId))
        .catch((err) => run('UPDATE rounds SET error = ? WHERE id = ?', `rollback: ${err.message}`, roundId));
    }
    throw e.status ? e : new HttpError(502, 'No se pudo contactar la billetera del operador');
  }
  const result = produce();
  const win = toCents(result.totalWin, bet);
  run("UPDATE rounds SET status = 'pending_credit', win = ?, balance_before = ?, rng = ?, result = ? WHERE id = ?",
    win, afterDebit + cost, JSON.stringify(rng.draws), JSON.stringify(result), roundId);
  try {
    const after = await wallet.credit(win, roundId);
    run("UPDATE rounds SET status = 'completed', balance_after = ? WHERE id = ?", after, roundId);
  } catch (e) {
    // El resultado ya es definitivo: el reintento automático acreditará el premio.
    run('UPDATE rounds SET error = ? WHERE id = ?', e.message, roundId);
    const r = formatRound(one('SELECT * FROM rounds WHERE id = ?', roundId));
    return { ...r, balance: afterDebit, creditPending: true };
  }
  return formatRound(one('SELECT * FROM rounds WHERE id = ?', roundId));
}

/** Reintenta créditos pendientes (billetera seamless caída). Llamado periódicamente. */
export async function retryPendingCredits() {
  const pending = all("SELECT * FROM rounds WHERE status = 'pending_credit' AND created_at < datetime('now', '-30 seconds') LIMIT 50");
  for (const r of pending) {
    try {
      const wallet = walletForSession(getSessionLoose(r.session_token));
      const after = await wallet.credit(r.win, r.id);
      run("UPDATE rounds SET status = 'completed', balance_after = ?, error = NULL WHERE id = ?", after, r.id);
    } catch (e) {
      run('UPDATE rounds SET error = ? WHERE id = ?', `reintento: ${e.message}`, r.id);
    }
  }
  return pending.length;
}

function getSessionLoose(t) {
  return one('SELECT s.*, p.operator_id, p.external_id, p.currency, p.demo FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?', t);
}

/** Recalcula una ronda con los números aleatorios grabados y verifica que el resultado coincide. */
export function replayRound(roundId) {
  const r = one('SELECT * FROM rounds WHERE id = ?', roundId);
  if (!r) throw new HttpError(404, 'Ronda no encontrada');
  if (r.play_mode === 'crash') return replayCrash(r);
  if (!r.rng) throw new HttpError(409, 'La ronda no tiene resultado');
  const config = r.version ? configWithVariant(r.game_id, r.version, r.variant_id) : null;
  if (!config) throw new HttpError(409, 'Ronda jugada sobre un borrador: no reproducible');
  if (getEngine(config.engine).kind === 'table') {
    if (r.play_mode !== 'roll') throw new HttpError(409, 'Esta operación no tiene dados que verificar');
    return replayTable(r);
  }
  const draws = JSON.parse(r.rng);
  const rng = replayRng(draws);
  const eng = getEngine(config.engine);
  const stored = r.result ? JSON.parse(r.result) : null;
  const res = eng.play(config, rng, eng.stateful ? { mode: r.play_mode, state: stored?.stateBefore } : { mode: r.play_mode });
  const win = toCents(res.totalWin, r.bet);
  return { roundId, stored: r.win, recomputed: win, match: win === r.win && rng.consumed === draws.length, drawsUsed: rng.consumed, result: res };
}

export function listRounds({ gameId, playerId, status, limit = 50 } = {}) {
  const where = [], p = [];
  if (gameId) { where.push('game_id = ?'); p.push(gameId); }
  if (playerId) { where.push('player_id = ?'); p.push(playerId); }
  if (status) { where.push('status = ?'); p.push(status); }
  return all(`SELECT id, game_id, player_id, version, mode, play_mode, bet, cost, win, balance_after, status, error, created_at FROM rounds
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, ...p, Math.min(500, limit));
}

export function stats({ gameId, days = 30 } = {}) {
  const p = [`-${Number(days)} days`];
  let where = "created_at >= datetime('now', ?) AND status = 'completed'";
  if (gameId) { where += ' AND game_id = ?'; p.push(gameId); }
  return all(`SELECT game_id, mode, COUNT(*) AS rounds, SUM(cost) AS wagered, SUM(win) AS won,
      ROUND(1.0 * SUM(win) / NULLIF(SUM(cost), 0), 4) AS rtp, COUNT(DISTINCT player_id) AS players
    FROM rounds WHERE ${where} GROUP BY game_id, mode ORDER BY wagered DESC`, ...p);
}

/**
 * Verificación de una apuesta de Crash: la semilla revelada da el hash publicado antes de la ronda y el mismo
 * punto de explosión; el premio es apuesta × retiro si el retiro fue ≤ explosión (si no, 0).
 */
function replayCrash(r) {
  const doc = r.result ? JSON.parse(r.result) : {};
  const cr = one('SELECT * FROM crash_rounds WHERE id = ?', doc.crashRound);
  if (!cr) throw new HttpError(404, 'Ronda de Crash no encontrada');
  if (!cr.crashed_at) throw new HttpError(409, 'La ronda todavía no terminó');
  const config = r.version ? getVersionConfig(r.game_id, r.version) : getDraft(r.game_id);
  const crash = crashFromSeed(cr.seed, config.rules.rtp, config.rules.maxMultiplier);
  const hashOk = hashSeed(cr.seed) === cr.hash;
  const expected = ['cancelled', 'void'].includes(r.status) ? r.cost : doc.cashout && doc.cashout <= crash ? Math.floor(r.cost * doc.cashout) : 0;
  return {
    roundId: r.id, stored: r.win, recomputed: expected, match: hashOk && crash === cr.crash && expected === r.win,
    result: { roundNo: cr.round_no, hash: cr.hash, seed: cr.seed, hashOk, crash, cashout: doc.cashout ?? null, auto: doc.auto ?? null, status: r.status },
  };
}
