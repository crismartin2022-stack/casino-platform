// Portal del operador: usuarios con roles, permisos que asigna el proveedor, catálogo con su RTP,
// juegos propios (limitados), reportes, jugadores, credenciales y prueba de billetera.
import { randomBytes, createHash, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { one, all, run, audit } from '../db.js';
import { HttpError } from '../lib/http.js';
import { config } from '../config.js';
import { getEngine } from '../math/index.js';
import { listGames, createOwnedGame, getGame } from './games.js';
import { configForOperator, operatorCanUse, buildVariant, findVariant, listVariants } from './variants.js';
import { mathHash, getPublished } from './games.js';
const isTable = (engine) => getEngine(engine).kind === 'table';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const token = (n = 24) => randomBytes(n).toString('base64url');

export const ROLES = {
  admin: 'Administrador (todo: reportes, jugadores, saldo, juegos, credenciales y usuarios)',
  finance: 'Finanzas (reportes, jugadores y saldo)',
  support: 'Soporte (solo consulta de jugadas y jugadores)',
};
const PERMS = {
  admin: ['view', 'balance', 'games', 'integration', 'users'],
  finance: ['view', 'balance'],
  support: ['view'],
};

// ---------------------------------------------------------------- Contraseñas y sesiones
function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${scryptSync(pw, salt, 32).toString('base64url')}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const a = scryptSync(String(pw), Buffer.from(salt, 'base64url'), 32);
  const b = Buffer.from(hash, 'base64url');
  return a.length === b.length && timingSafeEqual(a, b);
}
const tempPassword = () => token(9).replace(/[-_]/g, 'x');

function validPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'La contraseña debe tener al menos 10 caracteres');
}

export function login(email, password) {
  const u = one('SELECT * FROM operator_users WHERE email = ?', String(email || '').trim().toLowerCase());
  const ok = u && checkPassword(password, u.password_hash);
  if (!ok || !u.active) throw new HttpError(401, 'Email o contraseña incorrectos');
  const op = one('SELECT * FROM operators WHERE id = ?', u.operator_id);
  if (!op?.active) throw new HttpError(403, 'Tu operador está suspendido. Contacta al proveedor.');
  const t = `ous_${token(30)}`;
  run('INSERT INTO operator_user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(t), u.id, new Date(Date.now() + config.sessionTtlHours * 3600_000).toISOString());
  run("UPDATE operator_users SET last_login_at = datetime('now') WHERE id = ?", u.id);
  audit(`op:${op.id}:${u.email}`, 'portal.login', u.id);
  return { token: t, mustChangePassword: !!u.must_change };
}

export function logout(t) {
  run('DELETE FROM operator_user_sessions WHERE token_hash = ?', sha256(t));
}

/** Usuario del portal a partir del token (Authorization: Bearer ous_…). */
export function principalFromToken(t) {
  const s = one('SELECT * FROM operator_user_sessions WHERE token_hash = ?', sha256(t));
  if (!s || s.expires_at < new Date().toISOString()) throw new HttpError(401, 'Sesión del portal inválida o vencida');
  const u = one('SELECT * FROM operator_users WHERE id = ?', s.user_id);
  if (!u?.active) throw new HttpError(401, 'Usuario desactivado');
  const op = one('SELECT * FROM operators WHERE id = ?', u.operator_id);
  if (!op?.active) throw new HttpError(403, 'Tu operador está suspendido. Contacta al proveedor.');
  return { kind: 'operator', actor: `op:${op.id}:${u.email}`, operator: op, user: u, perms: PERMS[u.role] || [] };
}

export function need(p, perm) {
  if (!p.perms.includes(perm)) throw new HttpError(403, 'Tu rol no tiene permiso para esta acción');
}

export function me(p) {
  const op = p.operator;
  return {
    kind: 'operator',
    user: { id: p.user.id, email: p.user.email, name: p.user.name, role: p.user.role, mustChangePassword: !!p.user.must_change },
    operator: { id: op.id, name: op.name, walletMode: op.wallet_mode, currency: op.currency },
    perms: p.perms,
    limits: gameLimits(op),
  };
}

export function changePassword(p, current, next) {
  if (!checkPassword(current, p.user.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta');
  validPassword(next);
  run('UPDATE operator_users SET password_hash = ?, must_change = 0 WHERE id = ?', hashPassword(next), p.user.id);
  audit(p.actor, 'portal.password', p.user.id);
  return { ok: true };
}

// ---------------------------------------------------------------- Usuarios del operador
const userOut = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active, mustChangePassword: !!u.must_change, lastLoginAt: u.last_login_at, createdAt: u.created_at });

export const listUsers = (operatorId) => all('SELECT * FROM operator_users WHERE operator_id = ? ORDER BY created_at', operatorId).map(userOut);

export function createUser(operatorId, { email, name, role = 'admin' }, actor) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Email inválido');
  if (!ROLES[role]) throw new HttpError(400, `Rol inválido. Opciones: ${Object.keys(ROLES).join(', ')}`);
  if (!one('SELECT id FROM operators WHERE id = ?', operatorId)) throw new HttpError(404, 'Operador no encontrado');
  if (one('SELECT id FROM operator_users WHERE email = ?', email)) throw new HttpError(409, 'Ya existe un usuario con ese email');
  const id = `ou_${token(8)}`;
  const pw = tempPassword();
  run('INSERT INTO operator_users (id, operator_id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)', id, operatorId, email, name || null, role, hashPassword(pw));
  audit(actor, 'operator_user.create', id, { operatorId, email, role });
  return { ...userOut(one('SELECT * FROM operator_users WHERE id = ?', id)), temporaryPassword: pw };
}

function userOf(operatorId, userId) {
  const u = one('SELECT * FROM operator_users WHERE id = ? AND operator_id = ?', userId, operatorId);
  if (!u) throw new HttpError(404, 'Usuario no encontrado');
  return u;
}

export function updateUser(operatorId, userId, { role, active, name }, actor, selfId = null) {
  const u = userOf(operatorId, userId);
  if (role != null && !ROLES[role]) throw new HttpError(400, 'Rol inválido');
  if (selfId === userId && (active === false || (role && role !== 'admin'))) throw new HttpError(400, 'No puedes quitarte tu propio acceso de administrador');
  run('UPDATE operator_users SET role = ?, active = ?, name = ? WHERE id = ?', role ?? u.role, active == null ? u.active : active ? 1 : 0, name ?? u.name, userId);
  if (active === false) run('DELETE FROM operator_user_sessions WHERE user_id = ?', userId);
  audit(actor, 'operator_user.update', userId, { role, active });
  return userOut(one('SELECT * FROM operator_users WHERE id = ?', userId));
}

export function resetUserPassword(operatorId, userId, actor) {
  userOf(operatorId, userId);
  const pw = tempPassword();
  run('UPDATE operator_users SET password_hash = ?, must_change = 1 WHERE id = ?', hashPassword(pw), userId);
  run('DELETE FROM operator_user_sessions WHERE user_id = ?', userId);
  audit(actor, 'operator_user.reset_password', userId);
  return { id: userId, temporaryPassword: pw };
}

// ---------------------------------------------------------------- Permisos y juegos (los fija el proveedor)
export function gameLimits(op) {
  const used = one('SELECT COUNT(*) AS n FROM games WHERE owner_operator_id = ?', op.id).n;
  return { canCreateGames: !!op.can_create_games, maxGames: op.max_games, usedGames: used, canUseAgents: !!op.can_use_agents };
}

export function updateOperator(id, patch, actor) {
  const op = one('SELECT * FROM operators WHERE id = ?', id);
  if (!op) throw new HttpError(404, 'Operador no encontrado');
  const next = {
    name: patch.name ?? op.name,
    active: patch.active == null ? op.active : patch.active ? 1 : 0,
    can_create_games: patch.canCreateGames == null ? op.can_create_games : patch.canCreateGames ? 1 : 0,
    max_games: patch.maxGames == null ? op.max_games : Math.max(0, Math.min(1000, Math.floor(Number(patch.maxGames) || 0))),
    can_use_agents: patch.canUseAgents == null ? op.can_use_agents : patch.canUseAgents ? 1 : 0,
  };
  run('UPDATE operators SET name = ?, active = ?, can_create_games = ?, max_games = ?, can_use_agents = ? WHERE id = ?',
    next.name, next.active, next.can_create_games, next.max_games, next.can_use_agents, id);
  if (!next.active) run('DELETE FROM operator_user_sessions WHERE user_id IN (SELECT id FROM operator_users WHERE operator_id = ?)', id);
  audit(actor, 'operator.update', id, patch);
  return operatorDetail(id);
}

/** RTP que ve/usa el operador en un juego: el asignado (variante) o el de la versión publicada. */
function effectiveMath(opId, g) {
  const og = one('SELECT enabled, rtp_target FROM operator_games WHERE operator_id = ? AND game_id = ?', opId, g.id);
  let rtp = g.math?.rtp ?? null, volatility = g.math?.volatility ?? null, variant = null;
  if (og?.rtp_target != null && g.publishedVersion && !isTable(g.engine)) {
    const { config: c } = getPublished(g.id);
    const v = findVariant(g.id, og.rtp_target, mathHash(c));
    const building = !v && one("SELECT id FROM rtp_variants WHERE game_id = ? AND base_math_hash = ? AND status = 'building' AND ABS(rtp_target - ?) < 0.000001", g.id, mathHash(c), og.rtp_target);
    variant = { target: og.rtp_target, status: v ? 'ready' : building ? 'building' : 'missing' };
    if (v?.math) { const m = JSON.parse(v.math); rtp = m.rtp; volatility = m.volatility; }
  }
  return { enabled: og ? !!og.enabled : true, rtpTarget: og?.rtp_target ?? null, rtp, volatility, variant };
}

export function operatorDetail(id) {
  const op = one('SELECT * FROM operators WHERE id = ?', id);
  if (!op) throw new HttpError(404, 'Operador no encontrado');
  const games = listGames().filter((g) => !g.ownerOperatorId || g.ownerOperatorId === id).map((g) => ({
    id: g.id, name: g.name, engine: g.engine, kind: getEngine(g.engine).kind || 'slot', own: g.ownerOperatorId === id,
    publishedVersion: g.publishedVersion, status: g.status, defaultRtp: g.math?.rtp ?? null, ...effectiveMath(id, g),
  }));
  return {
    id: op.id, name: op.name, walletMode: op.wallet_mode, walletUrl: op.wallet_url, currency: op.currency, active: !!op.active, createdAt: op.created_at,
    ...gameLimits(op), games, users: listUsers(id),
  };
}

export function setOperatorGame(opId, gameId, { enabled, rtpTarget }, actor) {
  if (!one('SELECT id FROM operators WHERE id = ?', opId)) throw new HttpError(404, 'Operador no encontrado');
  const g = getGame(gameId);
  if (g.ownerOperatorId && g.ownerOperatorId !== opId) throw new HttpError(403, 'Ese juego pertenece a otro operador');
  const cur = one('SELECT * FROM operator_games WHERE operator_id = ? AND game_id = ?', opId, gameId);
  const nextEnabled = enabled == null ? (cur ? cur.enabled : 1) : enabled ? 1 : 0;
  let target = rtpTarget === undefined ? (cur?.rtp_target ?? null) : rtpTarget === null || rtpTarget === '' ? null : Number(rtpTarget);
  if (target != null) {
    if (getEngine(g.engine).kind === 'table') throw new HttpError(400, 'En los juegos de mesa el RTP sale de los pagos de cada apuesta: no hay variantes');
    buildVariant(gameId, target, actor); // valida el rango y la calcula en segundo plano si falta
  }
  run(`INSERT INTO operator_games (operator_id, game_id, enabled, rtp_target, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(operator_id, game_id) DO UPDATE SET enabled = excluded.enabled, rtp_target = excluded.rtp_target, updated_at = excluded.updated_at`,
  opId, gameId, nextEnabled, target);
  audit(actor, 'operator.game', opId, { gameId, enabled: !!nextEnabled, rtpTarget: target });
  return { gameId, ...effectiveMath(opId, g) };
}

export { listVariants };

// ---------------------------------------------------------------- Catálogo y juegos propios (portal)
export function catalog(op) {
  return listGames()
    .filter((g) => g.publishedVersion && g.status === 'active' && (!g.ownerOperatorId || g.ownerOperatorId === op.id))
    .map((g) => ({ id: g.id, name: g.name, engine: g.engine, own: g.ownerOperatorId === op.id, version: g.publishedVersion, ...effectiveMath(op.id, g) }))
    .filter((g) => g.own || g.enabled);
}

export function ownGames(op) {
  return listGames({ ownerOperatorId: op.id }).map((g) => ({ id: g.id, name: g.name, engine: g.engine, status: g.status, publishedVersion: g.publishedVersion, hasUnpublishedChanges: g.hasUnpublishedChanges, rtp: g.math?.rtp ?? null }));
}

export function createGameFor(p, { name, baseGameId }) {
  need(p, 'games');
  const op = p.operator;
  const lim = gameLimits(op);
  if (!lim.canCreateGames) throw new HttpError(403, 'La creación de juegos no está habilitada para tu operador. Pídesela al proveedor.');
  if (lim.usedGames >= lim.maxGames) throw new HttpError(403, `Llegaste al máximo de juegos propios (${lim.maxGames}). Pídele al proveedor que lo amplíe.`);
  if (!name?.trim()) throw new HttpError(400, 'Ponle un nombre al juego');
  if (!operatorCanUse(op.id, baseGameId)) throw new HttpError(404, 'Juego base no disponible');
  const { config: base } = configForOperator(op.id, baseGameId); // con el RTP que el proveedor le asignó
  return createOwnedGame(op.id, { name: name.trim().slice(0, 60), base }, p.actor);
}

/** El usuario del portal solo puede editar juegos propios de su operador. */
export function assertOwnGame(p, gameId) {
  need(p, 'games');
  const g = one('SELECT owner_operator_id FROM games WHERE id = ?', gameId);
  if (!g || g.owner_operator_id !== p.operator.id) throw new HttpError(403, 'Solo puedes editar los juegos creados por tu operador');
}

// ---------------------------------------------------------------- Reportes
function range(q) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const to = day.test(q.to || '') ? q.to : new Date().toISOString().slice(0, 10);
  const from = day.test(q.from || '') ? q.from : new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  return { from, to, fromTs: `${from} 00:00:00`, toTs: `${to} 23:59:59` };
}
const DONE = "r.status IN ('completed', 'pending_credit')";

export function summary(opId, q = {}) {
  const { from, to, fromTs, toTs } = range(q);
  const base = `FROM rounds r JOIN players p ON p.id = r.player_id WHERE p.operator_id = ? AND r.mode = 'real' AND ${DONE} AND r.created_at BETWEEN ? AND ?`;
  const totals = one(`SELECT COUNT(*) AS rounds, COALESCE(SUM(r.cost), 0) AS wagered, COALESCE(SUM(r.win), 0) AS won, COUNT(DISTINCT r.player_id) AS players ${base}`, opId, fromTs, toTs);
  const byDay = all(`SELECT substr(r.created_at, 1, 10) AS day, COUNT(*) AS rounds, SUM(r.cost) AS wagered, SUM(r.win) AS won, COUNT(DISTINCT r.player_id) AS players ${base} GROUP BY day ORDER BY day`, opId, fromTs, toTs);
  const byGame = all(`SELECT r.game_id, (SELECT name FROM games WHERE id = r.game_id) AS game_name, COUNT(*) AS rounds, SUM(r.cost) AS wagered, SUM(r.win) AS won, COUNT(DISTINCT r.player_id) AS players ${base} GROUP BY r.game_id ORDER BY wagered DESC`, opId, fromTs, toTs);
  const pending = one(`SELECT COUNT(*) AS n, COALESCE(SUM(r.win), 0) AS amount FROM rounds r JOIN players p ON p.id = r.player_id WHERE p.operator_id = ? AND r.status = 'pending_credit'`, opId);
  const ggr = (x) => ({ ...x, ggr: (x.wagered || 0) - (x.won || 0), rtp: x.wagered ? x.won / x.wagered : null });
  return { from, to, totals: ggr(totals), byDay: byDay.map(ggr), byGame: byGame.map(ggr), pendingCredits: pending };
}

export function listRoundsFor(opId, q = {}) {
  const { fromTs, toTs } = range(q);
  const where = ['p.operator_id = ?', 'r.created_at BETWEEN ? AND ?'];
  const args = [opId, fromTs, toTs];
  if (q.player) { where.push('p.external_id = ?'); args.push(String(q.player)); }
  if (q.game) { where.push('r.game_id = ?'); args.push(String(q.game)); }
  if (q.status) { where.push('r.status = ?'); args.push(String(q.status)); }
  if (q.mode) { where.push('r.mode = ?'); args.push(String(q.mode)); }
  if (q.round) { where.push('r.id = ?'); args.push(String(q.round)); }
  const limit = Math.min(1000, Math.max(1, Number(q.limit) || 100));
  const offset = Math.max(0, Number(q.offset) || 0);
  return all(`SELECT r.id, r.created_at, p.external_id AS player, r.game_id, r.version, r.mode, r.play_mode, r.bet, r.cost, r.win,
      r.balance_before, r.balance_after, r.status, r.error FROM rounds r JOIN players p ON p.id = r.player_id
      WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC, r.id LIMIT ? OFFSET ?`, ...args, limit, offset);
}

export function roundFor(opId, roundId) {
  const r = one('SELECT r.*, p.external_id AS player, p.operator_id FROM rounds r JOIN players p ON p.id = r.player_id WHERE r.id = ?', roundId);
  if (!r || r.operator_id !== opId) throw new HttpError(404, 'Ronda no encontrada');
  return {
    id: r.id, createdAt: r.created_at, player: r.player, gameId: r.game_id, version: r.version, mode: r.mode, playMode: r.play_mode,
    bet: r.bet, cost: r.cost, win: r.win, balanceBefore: r.balance_before, balanceAfter: r.balance_after, status: r.status, error: r.error,
    clientRoundId: r.client_round_id, result: r.result ? JSON.parse(r.result) : null, verifiable: !!(r.version && r.rng),
  };
}

export function listPlayers(op, q = {}) {
  const args = [op.id];
  let where = 'p.operator_id = ?';
  if (q.q) { where += ' AND p.external_id LIKE ?'; args.push(`%${String(q.q).slice(0, 60)}%`); }
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
  return all(`SELECT p.external_id AS player, p.currency, p.balance, p.created_at,
      (SELECT COUNT(*) FROM rounds r WHERE r.player_id = p.id AND r.status IN ('completed','pending_credit')) AS rounds,
      (SELECT COALESCE(SUM(cost), 0) FROM rounds r WHERE r.player_id = p.id AND r.status IN ('completed','pending_credit')) AS wagered,
      (SELECT COALESCE(SUM(win), 0) FROM rounds r WHERE r.player_id = p.id AND r.status IN ('completed','pending_credit')) AS won,
      (SELECT MAX(created_at) FROM rounds r WHERE r.player_id = p.id) AS last_play
    FROM players p WHERE ${where} ORDER BY last_play DESC NULLS LAST, p.created_at DESC LIMIT ?`, ...args, limit)
    .map((x) => ({ ...x, balance: op.wallet_mode === 'internal' ? x.balance : null }));
}

export function playerDetail(op, externalId) {
  const p = one('SELECT * FROM players WHERE operator_id = ? AND external_id = ?', op.id, String(externalId));
  if (!p) throw new HttpError(404, 'Jugador no encontrado');
  const tx = all('SELECT id, round_id, type, amount, balance_after, external_ref, created_at FROM transactions WHERE player_id = ? ORDER BY created_at DESC LIMIT 100', p.id);
  const totals = one("SELECT COUNT(*) AS rounds, COALESCE(SUM(cost), 0) AS wagered, COALESCE(SUM(win), 0) AS won FROM rounds WHERE player_id = ? AND status IN ('completed','pending_credit')", p.id);
  return {
    player: p.external_id, currency: p.currency, createdAt: p.created_at, walletMode: op.wallet_mode,
    balance: op.wallet_mode === 'internal' ? p.balance : null, totals: { ...totals, ggr: totals.wagered - totals.won },
    transactions: op.wallet_mode === 'internal' ? tx : [],
  };
}

// ---------------------------------------------------------------- CSV
const csvCell = (v) => {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita fórmulas al abrir en Excel
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const cents = (c) => (c == null ? '' : (c / 100).toFixed(2));

export function csv(kind, op, q) {
  if (kind === 'rounds') {
    const rows = listRoundsFor(op.id, { ...q, limit: 1000 });
    let all2 = rows, off = 1000;
    while (rows.length === 1000 && all2.length < 200_000) {
      const more = listRoundsFor(op.id, { ...q, limit: 1000, offset: off });
      all2 = all2.concat(more); off += 1000;
      if (more.length < 1000) break;
    }
    const head = ['ronda', 'fecha_utc', 'jugador', 'juego', 'version', 'modo', 'jugada', 'apuesta', 'cobrado', 'premio', 'saldo_antes', 'saldo_despues', 'estado'];
    return [head.join(','), ...all2.map((r) => [r.id, r.created_at, r.player, r.game_id, r.version, r.mode, r.play_mode, cents(r.bet), cents(r.cost), cents(r.win), cents(r.balance_before), cents(r.balance_after), r.status].map(csvCell).join(','))].join('\n');
  }
  if (kind === 'summary') {
    const s = summary(op.id, q);
    const head = ['dia', 'rondas', 'jugadores', 'apostado', 'pagado', 'ggr', 'rtp_real'];
    return [head.join(','), ...s.byDay.map((d) => [d.day, d.rounds, d.players, cents(d.wagered), cents(d.won), cents(d.ggr), d.rtp == null ? '' : (d.rtp * 100).toFixed(2)].map(csvCell).join(','))].join('\n');
  }
  if (kind === 'games') {
    const s = summary(op.id, q);
    const head = ['juego', 'rondas', 'jugadores', 'apostado', 'pagado', 'ggr', 'rtp_real'];
    return [head.join(','), ...s.byGame.map((d) => [d.game_id, d.rounds, d.players, cents(d.wagered), cents(d.won), cents(d.ggr), d.rtp == null ? '' : (d.rtp * 100).toFixed(2)].map(csvCell).join(','))].join('\n');
  }
  if (kind === 'players') {
    const head = ['jugador', 'moneda', 'saldo', 'rondas', 'apostado', 'pagado', 'ultima_jugada'];
    return [head.join(','), ...listPlayers(op, { ...q, limit: 500 }).map((p) => [p.player, p.currency, cents(p.balance), p.rounds, cents(p.wagered), cents(p.won), p.last_play].map(csvCell).join(','))].join('\n');
  }
  throw new HttpError(404, 'Reporte desconocido');
}

// ---------------------------------------------------------------- Integración
export function integration(op) {
  return {
    operatorId: op.id, name: op.name, walletMode: op.wallet_mode, walletUrl: op.wallet_url, currency: op.currency,
    hasWalletSecret: !!op.wallet_secret, apiBase: config.publicUrl || null,
  };
}

export function setWalletUrl(p, url) {
  need(p, 'integration');
  if (p.operator.wallet_mode !== 'seamless') throw new HttpError(400, 'Tu operador usa billetera interna: no necesita URL');
  if (!/^https:\/\//.test(url || '') && process.env.ALLOW_HTTP_WALLET !== '1') throw new HttpError(400, 'La URL de billetera debe ser https');
  run('UPDATE operators SET wallet_url = ? WHERE id = ?', url, p.operator.id);
  audit(p.actor, 'operator.wallet_url', p.operator.id, { url });
  return integration(one('SELECT * FROM operators WHERE id = ?', p.operator.id));
}

export function rotateWalletSecret(p) {
  need(p, 'integration');
  if (p.operator.wallet_mode !== 'seamless') throw new HttpError(400, 'Tu operador usa billetera interna');
  const secret = `whsec_${token(24)}`;
  run('UPDATE operators SET wallet_secret = ? WHERE id = ?', secret, p.operator.id);
  audit(p.actor, 'operator.rotate_secret', p.operator.id);
  return { walletSecret: secret };
}

/**
 * Prueba la billetera seamless del operador con un jugador de prueba: balance → debit 1 → credit 1 → rollback de un débito inexistente.
 * Informa cada paso (código, tiempo, respuesta) para que el operador corrija firma, formato o idempotencia.
 */
export async function testWallet(p, playerId) {
  need(p, 'integration');
  const op = one('SELECT * FROM operators WHERE id = ?', p.operator.id);
  if (op.wallet_mode !== 'seamless') throw new HttpError(400, 'Tu operador usa billetera interna: no hay nada que probar');
  if (!op.wallet_url) throw new HttpError(400, 'Configura primero la URL de tu billetera');
  if (!playerId) throw new HttpError(400, 'Indica el id de un jugador de prueba de tu sistema');
  const roundId = `test_${token(8)}`;
  const steps = [];
  const call = async (action, extra, expect = 200) => {
    const body = JSON.stringify({ action, playerId: String(playerId), currency: op.currency, ...extra, timestamp: Date.now() });
    const sig = createHmac('sha256', op.wallet_secret).update(body).digest('hex');
    const t0 = Date.now();
    try {
      const res = await fetch(op.wallet_url, { method: 'POST', body, signal: AbortSignal.timeout(8000), headers: { 'content-type': 'application/json', 'x-signature': sig, 'x-operator-id': op.id, 'x-test': '1' } });
      const text = await res.text();
      let data = null; try { data = JSON.parse(text); } catch {}
      const ok = res.status === expect && (expect !== 200 || typeof data?.balance === 'number');
      steps.push({ action, request: JSON.parse(body), status: res.status, ms: Date.now() - t0, response: data ?? text.slice(0, 300), ok,
        hint: ok ? null : res.status === 401 || res.status === 403 ? 'Tu servidor rechazó la firma: calcula HMAC-SHA256 del cuerpo EXACTO con tu secreto' : typeof data?.balance !== 'number' ? 'La respuesta debe ser JSON con "balance" (número entero en centavos)' : `Se esperaba HTTP ${expect}` });
      return data;
    } catch (e) {
      steps.push({ action, request: JSON.parse(body), status: null, ms: Date.now() - t0, ok: false, response: e.message, hint: 'No se pudo conectar: revisa la URL, el certificado https y que responda en menos de 8 s' });
      return null;
    }
  };
  await call('balance', {});
  await call('debit', { amount: 1, roundId, txId: `${roundId}:bet` });
  await call('debit', { amount: 1, roundId, txId: `${roundId}:bet` });
  steps[steps.length - 1].action = 'debit (repetido: debe ser idempotente)';
  const b1 = steps[1]?.response?.balance, b2 = steps[2]?.response?.balance;
  if (typeof b1 === 'number' && typeof b2 === 'number' && b1 !== b2) { steps[2].ok = false; steps[2].hint = 'El mismo txId se aplicó dos veces: debe ignorarse el repetido y devolver el mismo saldo'; }
  await call('credit', { amount: 1, roundId, txId: `${roundId}:win` });
  await call('rollback', { amount: 1, roundId: `${roundId}x`, txId: `${roundId}x:rollback` });
  audit(p.actor, 'operator.wallet_test', op.id, { ok: steps.every((s) => s.ok) });
  return { ok: steps.every((s) => s.ok), roundId, steps };
}
