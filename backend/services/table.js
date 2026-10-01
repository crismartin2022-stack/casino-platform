// Juegos de mesa (Craps): estado de la mesa por sesión, apuestas y tiradas con dinero real.
// Modelo de dinero: las apuestas nuevas quedan PENDIENTES y se cobran al tirar (una ronda = una tirada:
// cost = apuestas nuevas, win = premios + apuestas devueltas). Así cada tirada queda auditada como una ronda.
import { randomUUID } from 'node:crypto';
import { one, run, tx } from '../db.js';
import { HttpError } from '../lib/http.js';
import { getEngine } from '../math/index.js';
import { recordingRng, cryptoRng, replayRng } from '../math/rng.js';
import { getSession, walletForSession } from './wallets.js';
import { loadConfigFor, formatRound } from './rounds.js';
import { getVersionConfig } from './games.js';
import { isLive, liveGate } from './live.js';

/** Mesa en vivo: la fase (salida / punto) del jugador es la de la mesa compartida. */
export function alignToTable(state, table) {
  return { ...state, phase: table.tablePhase, point: table.point ?? null };
}

// Sesión aunque esté vencida: las apuestas que quedaron en una mesa en vivo se pagan igual
const looseSession = (token) => one('SELECT s.*, p.operator_id, p.external_id, p.currency, p.demo FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?', token);

function tableFor(token, { loose = false, forBet = false } = {}) {
  const session = loose ? looseSession(token) : getSession(token);
  if (!session) throw new HttpError(401, 'Sesión inválida');
  const { version, config } = loadConfigFor(session);
  const engine = getEngine(config.engine);
  if (engine.kind !== 'table') throw new HttpError(400, 'Este juego no es de mesa');
  const row = one('SELECT state FROM table_state WHERE session_token = ?', token);
  let state = row ? JSON.parse(row.state) : engine.newTableState();
  const live = isLive(config);
  if (live && !loose) state = alignToTable(state, liveGate(session, config, version, { forBet }));
  return { session, version, config, engine, state, live };
}

function saveState(token, gameId, state) {
  run(`INSERT INTO table_state (session_token, game_id, state, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(session_token) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`, token, gameId, JSON.stringify(state));
}

const publicState = (state) => ({
  phase: state.phase, point: state.point, bets: state.bets, history: state.history || [], lastLive: state.lastLive || null,
  pending: state.bets.filter((b) => b.status === 'pending').reduce((a, b) => a + b.amount, 0),
  onTable: state.bets.reduce((a, b) => a + b.amount, 0),
});

export async function getTable(token) {
  const { session, engine, config, state, live } = tableFor(token);
  const balance = await walletForSession(session).balance();
  return { ...publicState(state), balance, currency: session.currency, analysis: engine.analyze(config).perBet, live };
}

export async function placeBet(token, bet) {
  const { session, engine, config, state } = tableFor(token, { forBet: true });
  const next = engine.addBet(config, state, bet);
  // No se puede apostar más de lo que hay en la billetera (las pendientes se cobran al tirar)
  const pending = next.bets.filter((b) => b.status === 'pending').reduce((a, b) => a + b.amount, 0);
  const balance = await walletForSession(session).balance();
  if (pending > balance) throw new HttpError(402, 'Saldo insuficiente para esa apuesta');
  saveState(token, session.game_id, next);
  return { ...publicState(next), balance };
}

/** Quita una apuesta pendiente (sin movimiento de dinero) o retira una activa (Números/Hardways/Odds: devuelve el importe). */
export async function removeBet(token, betId) {
  const { session, engine, config, state, version } = tableFor(token, { forBet: true });
  const { state: next, refund, removed } = engine.removeBet(config, state, betId);
  if (!refund) {
    saveState(token, session.game_id, next);
    return { ...publicState(next), balance: await walletForSession(session).balance() };
  }
  // Devolución de una apuesta activa: se registra como ronda sin costo
  const wallet = walletForSession(session);
  const roundId = `rd_${randomUUID()}`;
  const result = { type: 'takedown', bet: removed, before: state, state: next };
  if (wallet.mode === 'internal') {
    tx(() => {
      const before = one('SELECT balance FROM players WHERE id = ?', session.player_id).balance;
      const after = wallet.creditSync(refund, roundId);
      run(`INSERT INTO rounds (id, client_round_id, session_token, player_id, game_id, version, source, mode, play_mode, bet, cost, win,
           balance_before, balance_after, status, result) VALUES (?,NULL,?,?,?,?,?,?,'takedown',0,0,?,?,?,'completed',?)`,
      roundId, token, session.player_id, session.game_id, version, session.source, session.mode, refund, before, after, JSON.stringify(result));
      saveState(token, session.game_id, next);
    });
  } else {
    run(`INSERT INTO rounds (id, session_token, player_id, game_id, version, source, mode, play_mode, bet, cost, win, status, result)
         VALUES (?,?,?,?,?,?,?,'takedown',0,0,?,'pending_credit',?)`,
    roundId, token, session.player_id, session.game_id, version, session.source, session.mode, refund, JSON.stringify(result));
    saveState(token, session.game_id, next);
    const after = await wallet.credit(refund, roundId);
    run("UPDATE rounds SET status = 'completed', balance_after = ? WHERE id = ?", after, roundId);
  }
  return { ...publicState(next), balance: await wallet.balance(), refunded: refund };
}

export async function rollDice(token, { clientRoundId = null } = {}) {
  const ctx = tableFor(token);
  if (ctx.live) throw new HttpError(409, 'En esta mesa tira el crupier: apuesta durante la cuenta regresiva');
  if (clientRoundId) {
    const prior = one('SELECT * FROM rounds WHERE session_token = ? AND client_round_id = ?', token, clientRoundId);
    if (prior) return { ...formatRound(prior), table: publicState(JSON.parse(one('SELECT state FROM table_state WHERE session_token = ?', token).state)), replayed: true };
  }
  if (!ctx.state.bets.length) throw new HttpError(400, 'Pon al menos una apuesta antes de tirar');
  return doRoll(token, ctx, recordingRng(cryptoRng()), { clientRoundId });
}

/**
 * Mesa en vivo: paga a un jugador la tirada del crupier (mismos números para todos). table = fase y punto de la
 * mesa ANTES de la tirada. Si no le alcanza el saldo para las apuestas nuevas, esas se retiran y juega el resto.
 */
export async function settleRoll(token, { draws, table, live }) {
  const ctx = tableFor(token, { loose: true });
  ctx.state = alignToTable(ctx.state, table);
  if (!ctx.state.bets.length) return null;
  try {
    return await doRoll(token, ctx, recordingRng(replayRng(draws)), { live });
  } catch (e) {
    if (e.status !== 402 && !/saldo/i.test(e.message)) throw e;
    ctx.state = { ...ctx.state, bets: ctx.state.bets.filter((b) => b.status !== 'pending') };
    if (!ctx.state.bets.length) { saveState(token, ctx.session.game_id, { ...ctx.state, lastLive: { ...live, dropped: true } }); return null; }
    return doRoll(token, ctx, recordingRng(replayRng(draws)), { live });
  }
}

async function doRoll(token, { session, version, config, engine, state }, rng, { clientRoundId = null, live = null } = {}) {
  const r = engine.roll(config, state, rng);
  const roundId = `rd_${randomUUID()}`;
  const wallet = walletForSession(session);
  const resultDoc = { dice: r.dice, total: r.total, hard: r.hard, resolutions: r.resolutions, before: r.before, phaseBefore: r.phaseBefore, pointBefore: r.pointBefore, phase: r.state.phase, point: r.state.point, ...(live ? { live } : {}) };
  if (live) r.state.lastLive = { ...live, dice: r.dice, total: r.total, resolutions: r.resolutions, cost: r.cost, payout: r.payout, roundId };
  const base = [roundId, clientRoundId, token, session.player_id, session.game_id, version, session.source, session.mode];

  if (wallet.mode === 'internal') {
    const row = tx(() => {
      const before = one('SELECT balance FROM players WHERE id = ?', session.player_id).balance;
      if (r.cost > 0) wallet.debitSync(r.cost, roundId);
      const after = wallet.creditSync(r.payout, roundId);
      run(`INSERT INTO rounds (id, client_round_id, session_token, player_id, game_id, version, source, mode, play_mode, bet, cost, win,
           balance_before, balance_after, status, rng, result) VALUES (?,?,?,?,?,?,?,?,'roll',?,?,?,?,?,'completed',?,?)`,
      ...base, r.cost, r.cost, r.payout, before, after, JSON.stringify(rng.draws), JSON.stringify(resultDoc));
      saveState(token, session.game_id, r.state);
      return one('SELECT * FROM rounds WHERE id = ?', roundId);
    });
    return { ...formatRound(row), table: publicState(r.state) };
  }
  // Seamless: cobrar primero en la billetera del operador
  run(`INSERT INTO rounds (id, client_round_id, session_token, player_id, game_id, version, source, mode, play_mode, bet, cost, status)
       VALUES (?,?,?,?,?,?,?,?,'roll',?,?,'pending_debit')`, ...base, r.cost, r.cost);
  let afterDebit;
  try {
    afterDebit = r.cost > 0 ? await wallet.debit(r.cost, roundId) : await wallet.balance();
  } catch (e) {
    run("UPDATE rounds SET status = 'debit_failed', error = ? WHERE id = ?", e.message, roundId);
    throw e.status ? e : new HttpError(502, 'No se pudo contactar la billetera del operador');
  }
  run("UPDATE rounds SET status = 'pending_credit', win = ?, balance_before = ?, rng = ?, result = ? WHERE id = ?",
    r.payout, afterDebit + r.cost, JSON.stringify(rng.draws), JSON.stringify(resultDoc), roundId);
  saveState(token, session.game_id, r.state);
  try {
    const after = await wallet.credit(r.payout, roundId);
    run("UPDATE rounds SET status = 'completed', balance_after = ? WHERE id = ?", after, roundId);
  } catch (e) {
    run('UPDATE rounds SET error = ? WHERE id = ?', e.message, roundId);
    return { ...formatRound(one('SELECT * FROM rounds WHERE id = ?', roundId)), balance: afterDebit, creditPending: true, table: publicState(r.state) };
  }
  return { ...formatRound(one('SELECT * FROM rounds WHERE id = ?', roundId)), table: publicState(r.state) };
}

/** Verificación de una tirada: recalcula con los dados grabados y la mesa como estaba antes. */
export function replayTableRound(r) {
  const config = getVersionConfig(r.game_id, r.version);
  const doc = JSON.parse(r.result);
  const draws = JSON.parse(r.rng);
  const rng = replayRng(draws);
  const again = getEngine(config.engine).roll(config, doc.before, rng);
  return { roundId: r.id, stored: r.win, recomputed: again.payout, match: again.payout === r.win && again.cost === r.cost && rng.consumed === draws.length, drawsUsed: rng.consumed, result: { dice: again.dice } };
}
