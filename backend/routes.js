// Rutas HTTP: API pública de juego, API de operadores (B2B) y API de administración.
import { timingSafeEqual } from 'node:crypto';
import { HttpError, json, readJson, readBody, send, sse, rateLimiter, clientIp } from './lib/http.js';
import { config, providers } from './config.js';
import * as games from './services/games.js';
import * as wallets from './services/wallets.js';
import * as rounds from './services/rounds.js';
import * as table from './services/table.js';
import * as assets from './services/assets.js';
import * as agents from './agents/runner.js';
import * as operators from './services/operators.js';
import { ensureAssignedVariants, buildVariant, listVariants } from './services/variants.js';
import { engineList, getEngine, LINE_ENGINES } from './math/index.js';
import { simulateAsync, tuneAsync, resizeAsync, featureAsync } from './math/worker.js';
import { maxLines } from './math/common.js';
import { all, one } from './db.js';

const spinLimit = rateLimiter({ windowMs: 60_000, max: 240 });
const demoLimit = rateLimiter({ windowMs: 60_000, max: 20 });

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

function requireAdmin(req) {
  if (bearer(req).startsWith('ous_')) throw new HttpError(403, 'Esta sección es solo del proveedor');
  const t = Buffer.from(bearer(req));
  const expected = Buffer.from(config.adminToken);
  if (t.length !== expected.length || !timingSafeEqual(t, expected)) throw new HttpError(401, 'Token de administrador inválido');
  return 'admin';
}

/** Administrador del proveedor o usuario del portal de un operador (token ous_…). */
function principal(req) {
  const t = bearer(req);
  if (t.startsWith('ous_')) return operators.principalFromToken(t);
  return { kind: 'admin', actor: requireAdmin(req) };
}

const loginLimit = rateLimiter({ windowMs: 15 * 60_000, max: 20 });

export function registerRoutes(r) {
  // ------------------------------------------------------------------ Salud
  r.get('/health', (req, res) => json(res, { ok: true, time: new Date().toISOString() }));

  // ------------------------------------------------------------------ Público (jugador)
  r.get('/api/v1/engines', (req, res) => json(res, engineList()));

  r.get('/api/v1/games', (req, res) => json(res, games.listGames()
    .filter((g) => g.publishedVersion && g.status === 'active' && !g.ownerOperatorId)
    .map((g) => ({ id: g.id, name: g.name, engine: g.engine, version: g.publishedVersion, rtp: g.math?.rtp ?? null, volatility: g.math?.volatility ?? null }))));

  r.get('/api/v1/games/:id', (req, res, { params }) => {
    const g = games.getGame(params.id);
    if (g.ownerOperatorId) throw new HttpError(404, 'Juego no encontrado');
    const { version, config: c } = games.getPublished(params.id);
    json(res, { ...games.publicConfig(params.id, c, version), math: g.math ? { rtp: g.math.rtp, volatility: g.math.volatility } : null });
  });

  r.post('/api/v1/demo/sessions', async (req, res) => {
    demoLimit(clientIp(req));
    const body = await readJson(req);
    if (one('SELECT owner_operator_id FROM games WHERE id = ?', String(body.gameId))?.owner_operator_id) throw new HttpError(404, 'Juego no encontrado');
    json(res, wallets.createDemoSession(body.gameId), 201);
  });

  // La sesión define juego y fuente (publicado o borrador en vista previa).
  r.get('/api/v1/session', (req, res) => {
    const s = wallets.getSession(bearer(req));
    const { version, config: c } = rounds.loadConfigFor(s);
    const math = s.source === 'draft' ? null : rounds.mathFor(s, games.getGame(s.game_id).math);
    json(res, { gameId: s.game_id, mode: s.mode, source: s.source, currency: s.currency,
      game: { ...games.publicConfig(s.game_id, c, version), math: math ? { rtp: math.rtp, volatility: math.volatility } : null } });
  });

  r.get('/api/v1/balance', async (req, res) => {
    const s = wallets.getSession(bearer(req));
    json(res, { balance: await wallets.walletForSession(s).balance(), currency: s.currency });
  });

  r.post('/api/v1/spin', async (req, res) => {
    const token = bearer(req);
    spinLimit(token || clientIp(req));
    const body = await readJson(req);
    const out = await rounds.playRound(token, {
      bet: Number(body.bet), mode: body.mode || 'base', clientRoundId: body.clientRoundId ? String(body.clientRoundId).slice(0, 64) : null, force: body.force === true,
    });
    json(res, out);
  });

  // Juegos de mesa (Craps)
  r.get('/api/v1/table', async (req, res) => json(res, await table.getTable(bearer(req))));
  r.post('/api/v1/table/bets', async (req, res) => {
    const token = bearer(req);
    spinLimit(token || clientIp(req));
    const b = await readJson(req);
    json(res, await table.placeBet(token, { type: String(b.type), amount: Number(b.amount), number: b.number != null ? Number(b.number) : undefined, on: b.on ? String(b.on) : undefined }));
  });
  r.delete('/api/v1/table/bets/:id', async (req, res, { params }) => json(res, await table.removeBet(bearer(req), params.id)));
  r.post('/api/v1/table/roll', async (req, res) => {
    const token = bearer(req);
    spinLimit(token || clientIp(req));
    const b = await readJson(req);
    json(res, await table.rollDice(token, { clientRoundId: b.clientRoundId ? String(b.clientRoundId).slice(0, 64) : null }));
  });

  r.get('/api/v1/history', (req, res) => {
    const s = wallets.getSession(bearer(req));
    json(res, rounds.listRounds({ playerId: s.player_id, limit: Number(req.query.limit) || 20 }));
  });

  // ------------------------------------------------------------------ Operadores (B2B)
  const op = (req) => wallets.operatorFromKey(req.headers['x-api-key']);

  r.get('/api/v1/operator/games', (req, res) => {
    const o = op(req);
    json(res, operators.catalog(o).map((g) => ({ id: g.id, name: g.name, engine: g.engine, own: g.own, version: g.version,
      math: { rtp: g.rtp, volatility: g.volatility }, rtpStatus: g.variant?.status || 'ready' })));
  });

  r.post('/api/v1/operator/sessions', async (req, res) => {
    const o = op(req);
    const body = await readJson(req);
    const s = wallets.createOperatorSession(o, body);
    const base = config.publicUrl || `https://${req.headers.host}`;
    json(res, { ...s, launchUrl: `${base}/play/${encodeURIComponent(body.gameId)}?token=${encodeURIComponent(s.token)}${body.lobbyUrl ? `&lobby=${encodeURIComponent(body.lobbyUrl)}` : ''}` }, 201);
  });

  r.post('/api/v1/operator/players/:playerId/balance', async (req, res, { params }) => {
    const o = op(req);
    const body = await readJson(req);
    json(res, wallets.adjustInternalBalance(o, params.playerId, Number(body.amount), body.reference, `operator:${o.id}`));
  });

  r.get('/api/v1/operator/rounds', (req, res) => {
    const o = op(req);
    json(res, all(`SELECT r.id, r.game_id, p.external_id AS player_id, r.version, r.play_mode, r.bet, r.cost, r.win, r.status, r.created_at
      FROM rounds r JOIN players p ON p.id = r.player_id WHERE p.operator_id = ? AND (? IS NULL OR r.created_at >= ?)
      ORDER BY r.created_at DESC LIMIT ?`, o.id, req.query.since ?? null, req.query.since ?? null, Math.min(1000, Number(req.query.limit) || 100)));
  });

  // ------------------------------------------------------------------ Administración
  const A = (fn) => async (req, res, ctx) => fn(req, res, { ...ctx, actor: requireAdmin(req) });

  // Admin o usuario del portal (rol administrador) sobre un juego PROPIO de su operador.
  const G = (fn) => async (req, res, ctx) => {
    const p = principal(req);
    if (p.kind === 'operator') operators.assertOwnGame(p, ctx.params.id);
    return fn(req, res, { ...ctx, actor: p.actor, principal: p });
  };
  const noAi = { anthropic: false, venice: false, elevenlabs: false };

  r.get('/api/admin/me', (req, res) => {
    const p = principal(req);
    if (p.kind === 'operator') return json(res, { ok: true, ...operators.me(p), providers: p.operator.can_use_agents ? providers() : noAi });
    json(res, { ok: true, kind: 'admin', providers: providers(), models: { agents: config.anthropic.model, director: config.anthropic.directorModel } });
  });

  r.get('/api/admin/games', (req, res) => {
    const p = principal(req);
    json(res, p.kind === 'operator' ? games.listGames({ ownerOperatorId: p.operator.id }) : games.listGames());
  });
  r.post('/api/admin/games', A(async (req, res, { actor }) => json(res, games.createGame(await readJson(req), actor), 201)));
  r.get('/api/admin/games/:id', G((req, res, { params }) => json(res, games.getGame(params.id))));
  r.put('/api/admin/games/:id/draft', G(async (req, res, { params, actor, principal: p }) => {
    const body = await readJson(req);
    json(res, games.saveDraft(params.id, body, actor, { allowInvalid: p.kind === 'admin' && req.query.force === '1' }));
  }));
  r.patch('/api/admin/games/:id/draft', G(async (req, res, { params, actor }) => {
    const { ops } = await readJson(req);
    json(res, games.patchDraft(params.id, ops || [], actor));
  }));
  r.post('/api/admin/games/:id/publish', G(async (req, res, { params, actor }) => {
    const { note } = await readJson(req);
    const out = await games.publish(params.id, { actor, note });
    // Si cambió la matemática, se recalculan los RTP asignados a los operadores
    const rebuilding = out.mathChanged ? ensureAssignedVariants(params.id, actor) : [];
    json(res, { ...out, rtpVariantsRebuilding: rebuilding.length });
  }));
  r.get('/api/admin/games/:id/versions', G((req, res, { params }) => json(res, games.listVersions(params.id))));
  r.post('/api/admin/games/:id/restore/:version', G((req, res, { params, actor }) => json(res, games.restoreVersion(params.id, Number(params.version), actor))));
  r.post('/api/admin/games/:id/status', G(async (req, res, { params, actor }) => {
    games.setStatus(params.id, (await readJson(req)).status, actor);
    json(res, { ok: true });
  }));
  // Variantes de RTP (solo proveedor)
  r.get('/api/admin/games/:id/rtp-variants', A((req, res, { params }) => json(res, listVariants(params.id))));
  r.post('/api/admin/games/:id/rtp-variants', A(async (req, res, { params, actor }) => json(res, buildVariant(params.id, (await readJson(req)).target, actor), 202)));
  r.post('/api/admin/games/:id/simulate', A(async (req, res, { params }) => {
    const body = await readJson(req);
    const c = games.getDraft(params.id);
    json(res, await simulateAsync(c, { spins: Math.min(Number(body.spins) || 300_000, 5_000_000), mode: body.mode || 'base', seed: Date.now() & 0xffffff, timeBudgetMs: 90_000 }));
  }));
  r.post('/api/admin/games/:id/tune', A(async (req, res, { params, actor }) => {
    const body = await readJson(req);
    const c = games.getDraft(params.id);
    if (body.target) c.rtpTarget = Number(body.target);
    const t = await tuneAsync(c, { target: c.rtpTarget, spins: 400_000 });
    games.saveDraft(params.id, t.config, actor);
    json(res, { history: t.history, final: t.final, buy: t.buy, buyOptions: t.buyOptions });
  }));
  // Frecuencia del bonus: activadores en las tiras + reajuste del RTP (en el borrador).
  r.post('/api/admin/games/:id/feature-frequency', A(async (req, res, { params, actor }) => {
    const body = await readJson(req);
    const c = games.getDraft(params.id);
    const t = await featureAsync(c, { every: Number(body.every), spins: 200_000 });
    games.saveDraft(params.id, t.config, actor);
    json(res, { featureEvery: t.featureEvery, history: t.history, final: t.final, buy: t.buy, buyOptions: t.buyOptions });
  }));
  // Tamaño de la cuadrícula y líneas de pago (reajusta pagos y RTP en el borrador).
  r.get('/api/admin/games/:id/grid', A((req, res, { params }) => {
    const c = games.getDraft(params.id);
    const lined = LINE_ENGINES.includes(c.engine);
    const q = { reels: Number(req.query.reels) || c.grid.reels, rows: Number(req.query.rows) || c.grid.rows };
    json(res, { grid: c.grid, lines: c.rules.lines ?? null, paysBy: lined ? 'lines' : 'ways', maxLines: lined ? maxLines(q.reels, q.rows) : null });
  }));
  r.post('/api/admin/games/:id/resize', A(async (req, res, { params, actor }) => {
    const body = await readJson(req);
    const c = games.getDraft(params.id);
    const t = await resizeAsync(c, { reels: body.reels != null ? Number(body.reels) : undefined, rows: body.rows != null ? Number(body.rows) : undefined, lines: body.lines != null ? Number(body.lines) : undefined, spins: 300_000 });
    games.saveDraft(params.id, t.config, actor);
    json(res, { grid: t.config.grid, lines: t.config.rules.lines ?? null, maxLines: t.maxLines, history: t.history, final: t.final, buy: t.buy, buyOptions: t.buyOptions });
  }));
  // Vista previa: sesión demo que juega el BORRADOR.
  r.post('/api/admin/games/:id/preview-session', G((req, res, { params }) => json(res, wallets.createDemoSession(params.id, { source: 'draft' }), 201)));

  // Assets (el portal solo ve y sube los de sus juegos)
  const assetScope = (req) => {
    const p = principal(req);
    if (p.kind === 'operator') {
      if (!req.query.gameId) throw new HttpError(400, 'Falta gameId');
      operators.assertOwnGame(p, req.query.gameId);
    }
    return p.actor;
  };
  r.get('/api/admin/assets', (req, res) => { assetScope(req); json(res, assets.listAssets({ gameId: req.query.gameId, kind: req.query.kind, limit: Number(req.query.limit) || 100 })); });
  r.post('/api/admin/assets', async (req, res) => {
    const actor = assetScope(req);
    const buf = await readBody(req, 60 * 1024 * 1024); // videos de fondo hasta 60 MB
    if (!buf.length) throw new HttpError(400, 'Archivo vacío');
    const a = assets.saveAsset(buf, { gameId: req.query.gameId || null, kind: req.query.kind, mime: req.headers['content-type'], provider: req.query.reference ? 'referencia' : 'upload', prompt: req.query.name || null, meta: req.query.reference ? { reference: true } : null, actor });
    json(res, a, 201);
  });

  // Agentes
  // Agentes: el portal los usa solo si el proveedor se lo habilitó, en sus juegos y sin el agente matemático.
  const agentScope = (req, gameId) => {
    const p = principal(req);
    if (p.kind === 'operator') {
      if (!p.operator.can_use_agents) throw new HttpError(403, 'Los agentes de IA no están habilitados para tu operador');
      if (!gameId) throw new HttpError(400, 'Falta gameId');
      operators.assertOwnGame(p, gameId);
    }
    return p;
  };
  const runGame = (id) => one('SELECT game_id FROM agent_runs WHERE id = ?', id)?.game_id;
  r.get('/api/admin/agents', (req, res) => {
    const p = principal(req);
    json(res, Object.entries(agents.AGENTS).filter(([id]) => p.kind === 'admin' || id !== 'math').map(([id, a]) => ({ id, title: a.title })));
  });
  r.post('/api/admin/agents/runs', async (req, res) => {
    const body = await readJson(req);
    const p = agentScope(req, body.gameId);
    if (p.kind === 'operator' && body.runId && runGame(body.runId) !== body.gameId) throw new HttpError(403, 'Conversación de otro juego');
    json(res, agents.startRun({ gameId: body.gameId, prompt: body.prompt, runId: body.runId, agent: body.agent || 'director', actor: p.actor, images: body.images || [], noMath: p.kind === 'operator' }), 202);
  });
  r.get('/api/admin/agents/runs', (req, res) => { agentScope(req, req.query.gameId); json(res, agents.listRuns(req.query.gameId)); });
  r.get('/api/admin/agents/runs/:id', (req, res, { params }) => { agentScope(req, runGame(params.id)); json(res, { ...agents.getRun(params.id), events: agents.listEvents(params.id) }); });
  r.post('/api/admin/agents/runs/:id/cancel', (req, res, { params }) => { agentScope(req, runGame(params.id)); json(res, agents.cancelRun(params.id)); });
  r.get('/api/admin/agents/runs/:id/events', ((req, res, { params }) => {
    agentScope(req, runGame(params.id));
    const stream = sse(res);
    let last = Number(req.query.after) || 0;
    for (const e of agents.listEvents(params.id, last)) { stream.send(e.type, e); last = e.id; }
    const unsub = agents.subscribe(params.id, (e) => stream.send(e.type, e));
    res.on('close', unsub);
  }));

  // ------------------------------------------------------------------ Operadores (vista del proveedor)
  r.get('/api/admin/operators/:id', A((req, res, { params }) => json(res, operators.operatorDetail(params.id))));
  r.patch('/api/admin/operators/:id', A(async (req, res, { params, actor }) => json(res, operators.updateOperator(params.id, await readJson(req), actor))));
  r.put('/api/admin/operators/:id/games/:gameId', A(async (req, res, { params, actor }) => json(res, operators.setOperatorGame(params.id, params.gameId, await readJson(req), actor))));
  r.post('/api/admin/operators/:id/users', A(async (req, res, { params, actor }) => json(res, operators.createUser(params.id, await readJson(req), actor), 201)));
  r.patch('/api/admin/operators/:id/users/:uid', A(async (req, res, { params, actor }) => json(res, operators.updateUser(params.id, params.uid, await readJson(req), actor))));
  r.post('/api/admin/operators/:id/users/:uid/reset-password', A((req, res, { params, actor }) => json(res, operators.resetUserPassword(params.id, params.uid, actor))));

  // ------------------------------------------------------------------ Portal del operador (/operator)
  const P = (perm, fn) => async (req, res, ctx) => {
    const t = bearer(req);
    if (!t.startsWith('ous_')) throw new HttpError(401, 'Inicia sesión en el portal del operador');
    const p = operators.principalFromToken(t);
    operators.need(p, perm);
    return fn(req, res, { ...ctx, p });
  };
  const sendCsv = (res, name, body) => send(res, 200, '\ufeff' + body, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` });

  r.post('/api/portal/login', async (req, res) => {
    loginLimit(clientIp(req));
    const b = await readJson(req);
    json(res, operators.login(b.email, b.password));
  });
  r.post('/api/portal/logout', P('view', (req, res) => { operators.logout(bearer(req)); json(res, { ok: true }); }));
  r.post('/api/portal/password', P('view', async (req, res, { p }) => { const b = await readJson(req); json(res, operators.changePassword(p, b.current, b.next)); }));
  r.get('/api/portal/summary', P('view', (req, res, { p }) => json(res, operators.summary(p.operator.id, req.query))));
  r.get('/api/portal/rounds', P('view', (req, res, { p }) => json(res, operators.listRoundsFor(p.operator.id, req.query))));
  r.get('/api/portal/rounds/:id', P('view', (req, res, { p, params }) => json(res, operators.roundFor(p.operator.id, params.id))));
  r.get('/api/portal/rounds/:id/verify', P('view', (req, res, { p, params }) => {
    operators.roundFor(p.operator.id, params.id);
    const v = rounds.replayRound(params.id);
    json(res, { roundId: v.roundId, stored: v.stored, recomputed: v.recomputed, match: v.match, drawsUsed: v.drawsUsed });
  }));
  r.get('/api/portal/players', P('view', (req, res, { p }) => json(res, operators.listPlayers(p.operator, req.query))));
  r.get('/api/portal/players/:player', P('view', (req, res, { p, params }) => json(res, operators.playerDetail(p.operator, params.player))));
  r.post('/api/portal/players/:player/balance', P('balance', async (req, res, { p, params }) => {
    const b = await readJson(req);
    json(res, wallets.adjustInternalBalance(p.operator, params.player, Math.round(Number(b.amount)), b.reference ? String(b.reference).slice(0, 80) : null, p.actor));
  }));
  r.get('/api/portal/games', P('view', (req, res, { p }) => json(res, { catalog: operators.catalog(p.operator), own: operators.ownGames(p.operator), limits: operators.gameLimits(p.operator) })));
  r.post('/api/portal/games', P('games', async (req, res, { p }) => json(res, operators.createGameFor(p, await readJson(req)), 201)));
  r.post('/api/portal/demo-session', P('view', async (req, res, { p }) => {
    const { gameId } = await readJson(req);
    const s = wallets.createOperatorSession(p.operator, { playerId: `demo-${p.user.id}`, gameId, mode: 'demo' });
    const base = config.publicUrl || `https://${req.headers.host}`;
    json(res, { ...s, launchUrl: `${base}/play/${encodeURIComponent(gameId)}?token=${encodeURIComponent(s.token)}` }, 201);
  }));
  r.get('/api/portal/integration', P('view', (req, res, { p }) => json(res, operators.integration(p.operator))));
  r.put('/api/portal/integration', P('integration', async (req, res, { p }) => json(res, operators.setWalletUrl(p, (await readJson(req)).walletUrl))));
  r.post('/api/portal/integration/rotate-key', P('integration', (req, res, { p }) => json(res, wallets.rotateOperatorKey(p.operator.id, p.actor))));
  r.post('/api/portal/integration/rotate-secret', P('integration', (req, res, { p }) => json(res, operators.rotateWalletSecret(p))));
  r.post('/api/portal/integration/test-wallet', P('integration', async (req, res, { p }) => json(res, await operators.testWallet(p, (await readJson(req)).playerId))));
  r.get('/api/portal/users', P('users', (req, res, { p }) => json(res, { users: operators.listUsers(p.operator.id), roles: operators.ROLES })));
  r.post('/api/portal/users', P('users', async (req, res, { p }) => json(res, operators.createUser(p.operator.id, await readJson(req), p.actor), 201)));
  r.patch('/api/portal/users/:uid', P('users', async (req, res, { p, params }) => json(res, operators.updateUser(p.operator.id, params.uid, await readJson(req), p.actor, p.user.id))));
  r.post('/api/portal/users/:uid/reset-password', P('users', (req, res, { p, params }) => json(res, operators.resetUserPassword(p.operator.id, params.uid, p.actor))));
  r.get('/api/portal/export/:kind', P('view', (req, res, { p, params }) => {
    const kind = params.kind.replace(/\.csv$/, '');
    sendCsv(res, `${kind}-${p.operator.id}-${new Date().toISOString().slice(0, 10)}.csv`, operators.csv(kind, p.operator, req.query));
  }));

  // Rondas, auditoría y operadores
  r.get('/api/admin/rounds', A((req, res) => json(res, rounds.listRounds({ gameId: req.query.gameId, status: req.query.status, limit: Number(req.query.limit) || 50 }))));
  r.get('/api/admin/rounds/:id/replay', A((req, res, { params }) => json(res, rounds.replayRound(params.id))));
  r.get('/api/admin/stats', A((req, res) => json(res, rounds.stats({ gameId: req.query.gameId, days: Number(req.query.days) || 30 }))));
  r.get('/api/admin/audit', A((req, res) => json(res, all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', Math.min(500, Number(req.query.limit) || 100)))));
  r.get('/api/admin/operators', A((req, res) => json(res, wallets.listOperators())));
  r.post('/api/admin/operators', A(async (req, res, { actor }) => json(res, wallets.createOperator(await readJson(req), actor), 201)));
  r.post('/api/admin/operators/:id/rotate-key', A((req, res, { params, actor }) => json(res, wallets.rotateOperatorKey(params.id, actor))));

  // ------------------------------------------------------------------ Utilidades
  r.get('/gen/symbol.svg', (req, res) => send(res, 200, assets.placeholderSvg(req.query.label, req.query.color), {
    'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400',
  }));
}

export { getEngine };
