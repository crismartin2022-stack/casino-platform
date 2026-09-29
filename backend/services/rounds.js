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

export function loadConfigFor(session) {
  if (session.source === 'draft') {
    if (session.mode !== 'demo') throw new HttpError(403, 'Los borradores solo se pueden jugar en modo demo');
    return { version: null, config: getDraft(session.game_id), variantId: null };
  }
  const pub = getPublished(session.game_id);
  if (!session.variant_id) return { ...pub, variantId: null };
  // RTP asignado por el proveedor a este operador
  return { version: pub.version, config: configWithVariant(session.game_id, pub.version, session.variant_id), variantId: session.variant_id };
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

export async function playRound(token, { bet, mode = 'base', clientRoundId = null }) {
  const session = getSession(token);
  const prior = existingRound(token, clientRoundId);
  if (prior) return { ...prior, replayed: true };

  const { version, config, variantId } = loadConfigFor(session);
  const engine = getEngine(config.engine);
  if (engine.kind === 'table') throw new HttpError(400, 'Este juego es de mesa: usa /api/v1/table');
  if (!config.bet.levels.includes(bet)) throw new HttpError(400, `Apuesta no permitida. Niveles: ${config.bet.levels.join(', ')}`);
  if (!(engine.modes || ['base']).includes(mode)) throw new HttpError(400, `Modo de juego no disponible: ${mode}`);
  const cost = Math.round(bet * costMultiplier(engine, config, mode));

  const rng = recordingRng(cryptoRng());
  const roundId = `rd_${randomUUID()}`;
  const wallet = walletForSession(session);
  const base = [roundId, clientRoundId, token, session.player_id, session.game_id, version, variantId ?? null, session.source, session.mode, mode, bet, cost];

  if (wallet.mode === 'internal') {
    // Todo en una transacción: o se registra la ronda completa o no pasa nada.
    const row = tx(() => {
      const before = one('SELECT balance FROM players WHERE id = ?', session.player_id).balance;
      wallet.debitSync(cost, roundId);
      const result = engine.play(config, rng, { mode });
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
  const result = engine.play(config, rng, { mode });
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
  if (!r.rng) throw new HttpError(409, 'La ronda no tiene resultado');
  const config = r.version ? configWithVariant(r.game_id, r.version, r.variant_id) : null;
  if (!config) throw new HttpError(409, 'Ronda jugada sobre un borrador: no reproducible');
  if (getEngine(config.engine).kind === 'table') {
    if (r.play_mode !== 'roll') throw new HttpError(409, 'Esta operación no tiene dados que verificar');
    return replayTable(r);
  }
  const draws = JSON.parse(r.rng);
  const rng = replayRng(draws);
  const res = getEngine(config.engine).play(config, rng, { mode: r.play_mode });
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
