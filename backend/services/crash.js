// Mesa CRASH compartida (estilo Aviator): una ronda para todos los jugadores del juego.
// Ciclo: betting (cuenta regresiva para apostar) → flying (el multiplicador sube) → crashed (pausa) → betting…
//
// Dinero real:
// - Cada apuesta es una ronda auditada (rounds.play_mode = 'crash'): se cobra al apostar (status 'open'), se paga al
//   retirarse o queda en 0 si explota (status 'completed'). Cancelar durante la cuenta regresiva devuelve el importe
//   (status 'cancelled'). Si el servidor se reinicia con una ronda en vuelo, las apuestas abiertas se devuelven ('void').
// - El punto de explosión sale de una semilla secreta por ronda: su sha256 se publica ANTES de apostar y la semilla
//   se revela al explotar (crash_rounds). El navegador nunca conoce el punto antes de tiempo.
// - El retiro se decide con el reloj del servidor en el momento en que llega el pedido.
import { randomUUID, randomBytes } from 'node:crypto';
import { all, one, run, tx } from '../db.js';
import { HttpError } from '../lib/http.js';
import { getEngine } from '../math/index.js';
import { multAt, timeFor, floor2, hashSeed, crashFromSeed, autoTarget } from '../math/crash.js';
import { getSession, walletForSession } from './wallets.js';
import { loadConfigFor } from './rounds.js';

const IDLE_MS = 120_000;
const TICK_MS = 100;
const tables = new Map(); // key → mesa

const keyOf = (session) => `crash:${session.game_id}:${session.source === 'draft' ? 'draft' : 'live'}`;
export const isCrash = (config) => getEngine(config.engine).kind === 'crash';

function crashConfig(session) {
  const ctx = loadConfigFor(session);
  if (!isCrash(ctx.config)) throw new HttpError(400, 'Este juego no es Crash');
  return ctx;
}

/** Nueva ronda: semilla secreta, hash publicado y punto de explosión ya fijado (antes de cualquier apuesta). */
function newRound(t, roundNo) {
  const R = t.config.rules;
  const seed = randomBytes(32).toString('hex');
  const hash = hashSeed(seed);
  const crash = crashFromSeed(seed, R.rtp, R.maxMultiplier);
  const id = `cr_${randomUUID()}`;
  run('INSERT INTO crash_rounds (id, table_id, game_id, round_no, version, hash, seed, crash) VALUES (?,?,?,?,?,?,?,?)',
    id, t.key, t.gameId, roundNo, t.version ?? null, hash, seed, crash);
  t.round = { id, seed, hash, crash };
  t.bets = new Map();
  Object.assign(t.state, { roundNo, phase: 'betting', endsAt: Date.now() + R.bettingSeconds * 1000, flightStart: null, crashAt: null, roundId: id, hash });
  save(t);
}

function save(t) {
  run(`INSERT INTO live_tables (id, game_id, state, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`, t.key, t.gameId,
  JSON.stringify({ roundNo: t.state.roundNo, history: t.state.history }));
}

function loadTable(session, config, version) {
  const key = keyOf(session);
  let t = tables.get(key);
  if (!t) {
    const row = one('SELECT state FROM live_tables WHERE id = ?', key);
    const saved = row ? JSON.parse(row.state) : null;
    t = { key, gameId: session.game_id, source: session.source === 'draft' ? 'draft' : 'live', busy: false, config, version, state: { history: saved?.history || [] } };
    tables.set(key, t);
    newRound(t, (saved?.roundNo || 0) + 1);
  }
  // La configuración nueva (publicación) se toma al empezar la ronda siguiente
  t.pending = { config, version };
  t.touched = Date.now();
  return t;
}

const elapsedSec = (t, now = Date.now()) => (t.state.flightStart ? (now - t.state.flightStart) / 1000 : 0);

// ---------------------------------------------------------------- Dinero
async function payBet(t, b, mult) {
  if (b.status !== 'active') return;
  b.status = 'cashed';
  b.cashout = mult;
  b.win = Math.floor(b.amount * mult);
  t.paid = (t.paid || 0) + b.win;
  await settle(b, { win: b.win, cashout: mult });
}

async function loseBet(b) {
  if (b.status !== 'active') return;
  b.status = 'lost';
  b.win = 0;
  await settle(b, { win: 0, cashout: null });
}

async function settle(b, { win, cashout }) {
  const result = JSON.stringify({ ...b.result, cashout, crash: b.crashKnown ?? null, win });
  const wallet = walletForSession(b.session);
  try {
    if (wallet.mode === 'internal') {
      tx(() => {
        const after = wallet.creditSync(win, b.roundId);
        run("UPDATE rounds SET status = 'completed', win = ?, balance_after = ?, result = ? WHERE id = ?", win, after, result, b.roundId);
      });
      return;
    }
    run("UPDATE rounds SET status = 'pending_credit', win = ?, result = ? WHERE id = ?", win, result, b.roundId);
    const after = await wallet.credit(win, b.roundId);
    run("UPDATE rounds SET status = 'completed', balance_after = ? WHERE id = ?", after, b.roundId);
  } catch (e) {
    // Seamless caído: queda en pending_credit y el reintento automático lo acredita
    run('UPDATE rounds SET error = ? WHERE id = ?', e.message, b.roundId);
    console.error('[crash] no se pudo acreditar', b.roundId, e.message);
  }
}

// ---------------------------------------------------------------- Reloj de la mesa
async function advance(t) {
  if (t.busy) return;
  t.busy = true;
  try {
    const s = t.state;
    const now = Date.now();
    const R = t.config.rules;
    if (s.phase === 'betting' && now >= s.endsAt) {
      s.phase = 'flying';
      s.flightStart = now;
      s.crashAt = now + Math.round(timeFor(t.round.crash, R.curve) * 1000);
    }
    if (s.phase === 'flying') {
      const m = multAt(elapsedSec(t, now), R.curve);
      const crashed = now >= s.crashAt;
      // Retiros automáticos: los que llegaron a su objetivo (antes o justo en la explosión) cobran su objetivo
      for (const b of t.bets.values()) {
        if (b.status === 'active' && b.target <= t.round.crash && (m >= b.target || crashed)) await payBet(t, b, b.target);
      }
      if (crashed) {
        s.phase = 'crashed';
        s.endsAt = s.crashAt + R.pauseSeconds * 1000;
        for (const b of t.bets.values()) { b.crashKnown = t.round.crash; b.result.crash = t.round.crash; }
        for (const b of t.bets.values()) await loseBet(b);
        // Cada apuesta queda auditada con el punto de explosión de su ronda
        for (const b of t.bets.values()) run("UPDATE rounds SET result = json_set(result, '$.crash', ?) WHERE id = ?", t.round.crash, b.roundId);
        const bets = [...t.bets.values()];
        run("UPDATE crash_rounds SET crashed_at = datetime('now'), bets = ?, wagered = ?, paid = ? WHERE id = ?",
          bets.length, bets.reduce((a, b) => a + b.amount, 0), bets.reduce((a, b) => a + (b.win || 0), 0), t.round.id);
        s.history = [{ roundNo: s.roundNo, crash: t.round.crash, hash: t.round.hash, seed: t.round.seed }, ...(s.history || [])].slice(0, R.historySize || 30);
        save(t);
      }
    }
    if (s.phase === 'crashed' && now >= s.endsAt) {
      if (t.pending) { t.config = t.pending.config; t.version = t.pending.version; }
      newRound(t, s.roundNo + 1);
    }
  } finally { t.busy = false; }
}

let timer = null;
export function startCrashTables() {
  if (timer) return;
  recoverOpenBets().catch((e) => console.error('[crash] recuperación', e.message));
  timer = setInterval(() => {
    for (const [key, t] of tables) {
      const empty = !t.bets?.size;
      if (Date.now() - t.touched > IDLE_MS && t.state.phase === 'betting' && empty) { tables.delete(key); continue; }
      advance(t).catch((e) => console.error('[crash]', e.message));
    }
  }, TICK_MS);
  timer.unref?.();
}
export function stopCrashTables() { clearInterval(timer); timer = null; tables.clear(); }

/** Al arrancar: apuestas que quedaron abiertas por un reinicio se devuelven (la ronda se anula). */
export async function recoverOpenBets() {
  if (tables.size) return 0;
  const open = all("SELECT r.*, s.token AS tok FROM rounds r LEFT JOIN sessions s ON s.token = r.session_token WHERE r.play_mode = 'crash' AND r.status = 'open'");
  for (const r of open) {
    const session = one('SELECT s.*, p.operator_id, p.external_id, p.currency, p.demo FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?', r.session_token);
    if (!session) continue;
    const doc = JSON.stringify({ ...JSON.parse(r.result || '{}'), void: true, reason: 'Reinicio del servidor: la apuesta se devolvió' });
    try {
      const wallet = walletForSession(session);
      if (wallet.mode === 'internal') tx(() => { const after = wallet.creditSync(r.cost, r.id); run("UPDATE rounds SET status = 'void', win = ?, balance_after = ?, result = ? WHERE id = ?", r.cost, after, doc, r.id); });
      else { const after = await wallet.credit(r.cost, r.id); run("UPDATE rounds SET status = 'void', win = ?, balance_after = ?, result = ? WHERE id = ?", r.cost, after, doc, r.id); }
    } catch (e) { run('UPDATE rounds SET error = ? WHERE id = ?', `devolución: ${e.message}`, r.id); }
  }
  return open.length;
}

// ---------------------------------------------------------------- Vista pública
const maskName = (b) => {
  const raw = String(b.session.external_id || b.session.player_id || 'jugador');
  return raw.length <= 4 ? `${raw[0]}***` : `${raw.slice(0, 3)}***${raw.slice(-2)}`;
};

function publicBet(b, token) {
  return {
    id: b.id, name: maskName(b), amount: b.amount, currency: b.session.currency, status: b.status,
    cashout: b.cashout ?? null, win: b.win ?? null, mine: b.session.token === token, panel: b.session.token === token ? b.panel : undefined,
    auto: b.session.token === token ? b.auto : undefined,
  };
}

function publicTable(t, token) {
  const s = t.state;
  const R = t.config.rules;
  const bets = [...t.bets.values()];
  const list = bets.slice().sort((a, b) => (b.win || 0) - (a.win || 0) || b.amount - a.amount).slice(0, 50);
  return {
    roundNo: s.roundNo, phase: s.phase, endsAt: s.endsAt, serverNow: Date.now(), flightStart: s.flightStart,
    elapsed: s.phase === 'flying' ? elapsedSec(t) : null,
    crash: s.phase === 'crashed' ? t.round.crash : null,
    // La semilla se revela recién al explotar
    hash: t.round.hash, seed: s.phase === 'crashed' ? t.round.seed : null,
    seconds: { betting: R.bettingSeconds, pause: R.pauseSeconds }, curve: R.curve, maxMultiplier: R.maxMultiplier,
    history: (s.history || []).slice(0, R.historySize || 30),
    players: bets.length,
    bets: list.map((b) => publicBet(b, token)),
    mine: bets.filter((b) => b.session.token === token).map((b) => publicBet(b, token)),
  };
}

// ---------------------------------------------------------------- API del jugador
export async function getCrash(token) {
  const session = getSession(token);
  const { version, config } = crashConfig(session);
  const t = loadTable(session, config, version);
  await advance(t);
  return { table: publicTable(t, token), limits: config.rules.limits, balance: await walletForSession(session).balance(), currency: session.currency };
}

export async function placeCrashBet(token, { amount, auto = null, panel = 0, clientBetId = null } = {}) {
  const session = getSession(token);
  const { version, config } = crashConfig(session);
  const t = loadTable(session, config, version);
  await advance(t);
  const R = config.rules;
  const L = R.limits;
  if (clientBetId) {
    const prior = one('SELECT * FROM rounds WHERE session_token = ? AND client_round_id = ?', token, String(clientBetId));
    if (prior) return { ...(await getCrash(token)), replayed: true };
  }
  if (t.state.phase !== 'betting' || Date.now() > t.state.endsAt - 150) throw new HttpError(409, 'La ronda ya empezó: tu apuesta va a la próxima');
  amount = Number(amount);
  if (!Number.isInteger(amount) || amount < L.min || amount > L.max) throw new HttpError(400, `La apuesta debe estar entre ${L.min} y ${L.max} (centavos)`);
  panel = Number(panel) === 1 ? 1 : 0;
  if (auto != null && auto !== '') {
    auto = floor2(Number(auto));
    if (!(auto >= R.autoMin && auto <= R.maxMultiplier)) throw new HttpError(400, `El retiro automático debe estar entre ×${R.autoMin} y ×${R.maxMultiplier}`);
  } else auto = null;
  const mine = [...t.bets.values()].filter((b) => b.session.token === token);
  if (mine.length >= R.maxBets) throw new HttpError(409, `Máximo ${R.maxBets} apuestas por ronda`);
  if (mine.some((b) => b.panel === panel)) throw new HttpError(409, 'Ya hay una apuesta en ese panel');
  if (mine.reduce((a, b) => a + b.amount, 0) + amount > L.table) throw new HttpError(400, 'Superaste el máximo por ronda');

  const roundNo = t.state.roundNo;
  const roundId = `rd_${randomUUID()}`;
  const result = { crashRound: t.round.id, roundNo, hash: t.round.hash, panel, auto, amount };
  const bet = { id: roundId, roundId, session, panel, amount, auto, target: autoTarget(config, amount, auto), status: 'active', result };
  const wallet = walletForSession(session);
  const base = [roundId, clientBetId ? String(clientBetId) : null, token, session.player_id, session.game_id, version, session.source, session.mode, amount, amount];
  if (wallet.mode === 'internal') {
    tx(() => {
      const before = one('SELECT balance FROM players WHERE id = ?', session.player_id).balance;
      const after = wallet.debitSync(amount, roundId);
      run(`INSERT INTO rounds (id, client_round_id, session_token, player_id, game_id, version, source, mode, play_mode, bet, cost, win,
           balance_before, balance_after, status, result) VALUES (?,?,?,?,?,?,?,?,'crash',?,?,0,?,?,'open',?)`, ...base, before, after, JSON.stringify(result));
    });
  } else {
    run(`INSERT INTO rounds (id, client_round_id, session_token, player_id, game_id, version, source, mode, play_mode, bet, cost, status, result)
         VALUES (?,?,?,?,?,?,?,?,'crash',?,?,'pending_debit',?)`, ...base, JSON.stringify(result));
    try {
      const after = await wallet.debit(amount, roundId);
      run("UPDATE rounds SET status = 'open', balance_before = ? WHERE id = ?", after + amount, roundId);
    } catch (e) {
      run("UPDATE rounds SET status = 'debit_failed', error = ? WHERE id = ?", e.message, roundId);
      throw e.status ? e : new HttpError(502, 'No se pudo contactar la billetera del operador');
    }
    // Si mientras cobraba la billetera empezó el vuelo, se devuelve
    if (t.state.roundNo !== roundNo || t.state.phase !== 'betting') {
      await settle({ ...bet, crashKnown: null }, { win: amount, cashout: null });
      run("UPDATE rounds SET status = 'cancelled' WHERE id = ?", roundId);
      throw new HttpError(409, 'La ronda empezó mientras se cobraba: se devolvió la apuesta');
    }
  }
  t.bets.set(roundId, bet);
  return getCrash(token);
}

export async function cancelCrashBet(token, betId) {
  const session = getSession(token);
  const { version, config } = crashConfig(session);
  const t = loadTable(session, config, version);
  await advance(t);
  const b = t.bets.get(betId);
  if (!b || b.session.token !== token) throw new HttpError(404, 'Apuesta no encontrada');
  if (t.state.phase !== 'betting' || b.status !== 'active') throw new HttpError(409, 'Ya no se puede cancelar: la ronda empezó');
  t.bets.delete(betId);
  b.status = 'cancelled';
  await settle(b, { win: b.amount, cashout: null });
  run("UPDATE rounds SET status = 'cancelled' WHERE id = ?", b.roundId);
  return getCrash(token);
}

export async function cashoutCrashBet(token, betId) {
  const now = Date.now();
  const session = getSession(token);
  const { version, config } = crashConfig(session);
  const t = loadTable(session, config, version);
  const b = t.bets.get(betId);
  if (!b || b.session.token !== token) throw new HttpError(404, 'Apuesta no encontrada');
  if (b.status === 'cashed') return { ...(await getCrash(token)), cashout: b.cashout, win: b.win };
  if (t.state.phase !== 'flying' || b.status !== 'active') throw new HttpError(409, t.state.phase === 'betting' ? 'La ronda todavía no empezó' : '¡Explotó! Llegaste tarde');
  // El multiplicador del momento en que llegó el pedido (reloj del servidor)
  if (now >= t.state.crashAt) { await advance(t); throw new HttpError(409, '¡Explotó! Llegaste tarde'); }
  const m = Math.min(floor2(multAt(elapsedSec(t, now), config.rules.curve)), b.target);
  if (m > t.round.crash) throw new HttpError(409, '¡Explotó! Llegaste tarde');
  await payBet(t, b, Math.max(1, m));
  return { ...(await getCrash(token)), cashout: b.cashout, win: b.win };
}

/** Verificación pública de una ronda ya terminada: hash, semilla y punto de explosión. */
export function crashRound(gameId, roundNo) {
  const r = one('SELECT * FROM crash_rounds WHERE game_id = ? AND round_no = ? AND crashed_at IS NOT NULL ORDER BY created_at DESC LIMIT 1', gameId, Number(roundNo));
  if (!r) throw new HttpError(404, 'Ronda no encontrada o todavía en juego');
  return { roundNo: r.round_no, hash: r.hash, seed: r.seed, crash: r.crash, bets: r.bets, wagered: r.wagered, paid: r.paid, createdAt: r.created_at, crashedAt: r.crashed_at };
}

/** Para el panel: últimas rondas con lo apostado y pagado. */
export function crashRounds(gameId, limit = 100) {
  return all('SELECT round_no, hash, seed, crash, bets, wagered, paid, created_at, crashed_at FROM crash_rounds WHERE game_id = ? AND crashed_at IS NOT NULL ORDER BY created_at DESC LIMIT ?', gameId, Math.min(500, limit));
}
