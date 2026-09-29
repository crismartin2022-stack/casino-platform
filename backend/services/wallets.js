// Operadores (clientes B2B), jugadores, sesiones y billeteras.
//
// Dos modos de billetera por operador:
//  - internal: el saldo vive en nuestra BD (demo, pruebas, operadores pequeños).
//  - seamless: el saldo vive en el sistema del operador; llamamos a su wallet_url
//    con peticiones firmadas HMAC-SHA256 (debit / credit / rollback / balance).
import { randomBytes, randomUUID, createHash, createHmac } from 'node:crypto';
import { one, run, all, tx, audit } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { operatorCanUse, configForOperator } from './variants.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const token = (n = 24) => randomBytes(n).toString('base64url');

// ---------------- Operadores ----------------
export function createOperator({ name, walletMode = 'internal', walletUrl = null, currency = 'USD' }, actor = 'admin') {
  if (!name) throw new HttpError(400, 'Falta name');
  if (!['internal', 'seamless'].includes(walletMode)) throw new HttpError(400, 'walletMode debe ser internal o seamless');
  if (walletMode === 'seamless' && !/^https:\/\//.test(walletUrl || '') && process.env.ALLOW_HTTP_WALLET !== '1') throw new HttpError(400, 'walletUrl https obligatoria en modo seamless');
  const id = `op_${token(8)}`;
  const apiKey = `ck_live_${token(24)}`;
  const walletSecret = walletMode === 'seamless' ? `whsec_${token(24)}` : null;
  run('INSERT INTO operators (id, name, api_key_hash, wallet_mode, wallet_url, wallet_secret, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, name, sha256(apiKey), walletMode, walletUrl, walletSecret, currency);
  audit(actor, 'operator.create', id, { name, walletMode });
  // La API key solo se muestra una vez.
  return { id, name, walletMode, walletUrl, currency, apiKey, walletSecret };
}

export const listOperators = () => all(`SELECT o.id, o.name, o.wallet_mode, o.wallet_url, o.currency, o.active, o.can_create_games, o.max_games, o.can_use_agents, o.created_at,
  (SELECT COUNT(*) FROM games g WHERE g.owner_operator_id = o.id) AS own_games,
  (SELECT COUNT(*) FROM operator_users u WHERE u.operator_id = o.id) AS users
  FROM operators o ORDER BY o.created_at`);

export function operatorFromKey(apiKey) {
  if (!apiKey) throw new HttpError(401, 'Falta la cabecera X-API-Key');
  const op = one('SELECT * FROM operators WHERE api_key_hash = ? AND active = 1', sha256(apiKey));
  if (!op) throw new HttpError(401, 'API key inválida');
  return op;
}

export function rotateOperatorKey(id, actor = 'admin') {
  const apiKey = `ck_live_${token(24)}`;
  const r = run('UPDATE operators SET api_key_hash = ? WHERE id = ?', sha256(apiKey), id);
  if (!r.changes) throw new HttpError(404, 'Operador no encontrado');
  audit(actor, 'operator.rotate_key', id);
  return { id, apiKey };
}

// ---------------- Jugadores y sesiones ----------------
function upsertPlayer(operatorId, externalId, currency) {
  const existing = one('SELECT * FROM players WHERE operator_id = ? AND external_id = ?', operatorId, externalId);
  if (existing) return existing;
  const id = `pl_${token(10)}`;
  run('INSERT INTO players (id, operator_id, external_id, currency) VALUES (?, ?, ?, ?)', id, operatorId, externalId, currency);
  return one('SELECT * FROM players WHERE id = ?', id);
}

const expiry = () => new Date(Date.now() + config.sessionTtlHours * 3600_000).toISOString();

export function createDemoSession(gameId, { source = 'published', balance = config.demoBalanceCents, currency = 'USD', variantId = null } = {}) {
  if (!one('SELECT id FROM games WHERE id = ?', gameId)) throw new HttpError(404, 'Juego no encontrado');
  const id = `demo_${token(10)}`;
  const t = `ses_${token(24)}`;
  tx(() => {
    run('INSERT INTO players (id, operator_id, external_id, currency, balance, demo) VALUES (?, NULL, ?, ?, ?, 1)', id, id, currency, balance);
    run('INSERT INTO sessions (token, player_id, game_id, mode, source, expires_at, variant_id) VALUES (?, ?, ?, ?, ?, ?, ?)', t, id, gameId, 'demo', source, expiry(), variantId);
  });
  return { token: t, playerId: id, mode: 'demo', source, balance, currency };
}

export function createOperatorSession(op, { playerId, gameId, currency, mode = 'real' }) {
  if (!playerId || !gameId) throw new HttpError(400, 'Faltan playerId o gameId');
  if (!['real', 'demo'].includes(mode)) throw new HttpError(400, 'mode debe ser real o demo');
  if (!operatorCanUse(op.id, gameId)) throw new HttpError(404, 'Juego no disponible para este operador');
  const { variantId } = configForOperator(op.id, gameId); // 409 si su RTP asignado aún se está calculando
  if (mode === 'demo') return createDemoSession(gameId, { currency: currency || op.currency, variantId });
  const p = upsertPlayer(op.id, String(playerId), currency || op.currency);
  const t = `ses_${token(24)}`;
  run('INSERT INTO sessions (token, player_id, game_id, mode, source, expires_at, variant_id) VALUES (?, ?, ?, ?, ?, ?, ?)', t, p.id, gameId, 'real', 'published', expiry(), variantId);
  return { token: t, playerId: p.id, mode: 'real', currency: p.currency };
}

export function getSession(t) {
  if (!t) throw new HttpError(401, 'Falta el token de sesión');
  const s = one(`SELECT s.*, p.operator_id, p.external_id, p.currency, p.demo FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?`, t);
  if (!s) throw new HttpError(401, 'Sesión inválida');
  if (s.expires_at < new Date().toISOString()) throw new HttpError(401, 'Sesión expirada');
  return s;
}

// ---------------- Billeteras ----------------
function internalWallet(playerId) {
  return {
    mode: 'internal',
    async balance() { return one('SELECT balance FROM players WHERE id = ?', playerId).balance; },
    // Síncrono a propósito: se usa dentro de una transacción SQLite.
    debitSync(amount, roundId) {
      const r = run('UPDATE players SET balance = balance - ? WHERE id = ? AND balance >= ?', amount, playerId, amount);
      if (!r.changes) throw new HttpError(402, 'Saldo insuficiente');
      const bal = one('SELECT balance FROM players WHERE id = ?', playerId).balance;
      run('INSERT INTO transactions (id, player_id, round_id, type, amount, balance_after) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), playerId, roundId, 'bet', -amount, bal);
      return bal;
    },
    creditSync(amount, roundId) {
      run('UPDATE players SET balance = balance + ? WHERE id = ?', amount, playerId);
      const bal = one('SELECT balance FROM players WHERE id = ?', playerId).balance;
      if (amount > 0) run('INSERT INTO transactions (id, player_id, round_id, type, amount, balance_after) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), playerId, roundId, 'win', amount, bal);
      return bal;
    },
  };
}

function seamlessWallet(op, player) {
  async function call(action, payload) {
    const body = JSON.stringify({ action, playerId: player.external_id, currency: player.currency, ...payload, timestamp: Date.now() });
    const sig = createHmac('sha256', op.wallet_secret).update(body).digest('hex');
    let lastErr;
    for (let attempt = 0; attempt < (action === 'debit' ? 1 : 3); attempt++) {
      try {
        const res = await fetch(op.wallet_url, {
          method: 'POST', body, signal: AbortSignal.timeout(8000),
          headers: { 'content-type': 'application/json', 'x-signature': sig, 'x-operator-id': op.id },
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 402 || data.error === 'INSUFFICIENT_FUNDS') throw new HttpError(402, 'Saldo insuficiente');
        if (!res.ok || typeof data.balance !== 'number') throw new Error(`Wallet ${action} respondió ${res.status}`);
        return data;
      } catch (e) {
        if (e instanceof HttpError) throw e;
        lastErr = e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
  return {
    mode: 'seamless',
    async balance() { return (await call('balance', {})).balance; },
    async debit(amount, roundId) { return (await call('debit', { amount, roundId, txId: `${roundId}:bet` })).balance; },
    async credit(amount, roundId) { return (await call('credit', { amount, roundId, txId: `${roundId}:win` })).balance; },
    async rollback(amount, roundId) { return (await call('rollback', { amount, roundId, txId: `${roundId}:rollback` })).balance; },
  };
}

export function walletForSession(s) {
  if (s.demo || !s.operator_id) return internalWallet(s.player_id);
  const op = one('SELECT * FROM operators WHERE id = ?', s.operator_id);
  if (!op) throw new HttpError(500, 'Operador inexistente');
  if (op.wallet_mode === 'seamless') return seamlessWallet(op, { external_id: s.external_id, currency: s.currency });
  return internalWallet(s.player_id);
}

/** Solo billetera interna: el operador acredita/debita saldo (depósitos, retiros, ajustes). */
export function adjustInternalBalance(op, externalId, amount, reference, actor) {
  if (op.wallet_mode !== 'internal') throw new HttpError(400, 'El operador usa billetera seamless');
  if (!Number.isInteger(amount) || amount === 0) throw new HttpError(400, 'amount debe ser un entero en centavos distinto de 0');
  const p = upsertPlayer(op.id, String(externalId), op.currency);
  return tx(() => {
    if (reference && one('SELECT id FROM transactions WHERE player_id = ? AND external_ref = ?', p.id, reference)) {
      throw new HttpError(409, 'Referencia ya procesada');
    }
    const r = run('UPDATE players SET balance = balance + ? WHERE id = ? AND balance + ? >= 0', amount, p.id, amount);
    if (!r.changes) throw new HttpError(402, 'Saldo insuficiente');
    const bal = one('SELECT balance FROM players WHERE id = ?', p.id).balance;
    run('INSERT INTO transactions (id, player_id, type, amount, balance_after, external_ref) VALUES (?, ?, ?, ?, ?, ?)',
      randomUUID(), p.id, amount > 0 ? 'deposit' : 'withdrawal', amount, bal, reference || null);
    audit(actor, 'wallet.adjust', p.id, { amount, reference });
    return { playerId: externalId, balance: bal, currency: p.currency };
  });
}
