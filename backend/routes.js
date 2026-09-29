// Rutas HTTP: API pública de juego, API de operadores (B2B) y API de administración.
import { timingSafeEqual } from 'node:crypto';
import { HttpError, json, readJson, readBody, send, sse, rateLimiter, clientIp } from './lib/http.js';
import { config, providers } from './config.js';
import * as games from './services/games.js';
import * as wallets from './services/wallets.js';
import * as rounds from './services/rounds.js';
import * as assets from './services/assets.js';
import * as agents from './agents/runner.js';
import { engineList, getEngine } from './math/index.js';
import { simulateAsync, tuneAsync, resizeAsync } from './math/worker.js';
import { maxLines } from './math/common.js';
import { all } from './db.js';

const spinLimit = rateLimiter({ windowMs: 60_000, max: 240 });
const demoLimit = rateLimiter({ windowMs: 60_000, max: 20 });

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

function requireAdmin(req) {
  const t = Buffer.from(bearer(req));
  const expected = Buffer.from(config.adminToken);
  if (t.length !== expected.length || !timingSafeEqual(t, expected)) throw new HttpError(401, 'Token de administrador inválido');
  return 'admin';
}

export function registerRoutes(r) {
  // ------------------------------------------------------------------ Salud
  r.get('/health', (req, res) => json(res, { ok: true, time: new Date().toISOString() }));

  // ------------------------------------------------------------------ Público (jugador)
  r.get('/api/v1/engines', (req, res) => json(res, engineList()));

  r.get('/api/v1/games', (req, res) => json(res, games.listGames()
    .filter((g) => g.publishedVersion && g.status === 'active')
    .map((g) => ({ id: g.id, name: g.name, engine: g.engine, version: g.publishedVersion, rtp: g.math?.rtp ?? null, volatility: g.math?.volatility ?? null }))));

  r.get('/api/v1/games/:id', (req, res, { params }) => {
    const { version, config: c } = games.getPublished(params.id);
    const g = games.getGame(params.id);
    json(res, { ...games.publicConfig(params.id, c, version), math: g.math ? { rtp: g.math.rtp, volatility: g.math.volatility } : null });
  });

  r.post('/api/v1/demo/sessions', async (req, res) => {
    demoLimit(clientIp(req));
    const body = await readJson(req);
    json(res, wallets.createDemoSession(body.gameId), 201);
  });

  // La sesión define juego y fuente (publicado o borrador en vista previa).
  r.get('/api/v1/session', (req, res) => {
    const s = wallets.getSession(bearer(req));
    const { version, config: c } = s.source === 'draft'
      ? { version: null, config: games.getDraft(s.game_id) }
      : games.getPublished(s.game_id);
    const math = s.source === 'draft' ? null : games.getGame(s.game_id).math;
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
      bet: Number(body.bet), mode: body.mode || 'base', clientRoundId: body.clientRoundId ? String(body.clientRoundId).slice(0, 64) : null,
    });
    json(res, out);
  });

  r.get('/api/v1/history', (req, res) => {
    const s = wallets.getSession(bearer(req));
    json(res, rounds.listRounds({ playerId: s.player_id, limit: Number(req.query.limit) || 20 }));
  });

  // ------------------------------------------------------------------ Operadores (B2B)
  const op = (req) => wallets.operatorFromKey(req.headers['x-api-key']);

  r.get('/api/v1/operator/games', (req, res) => {
    op(req);
    json(res, games.listGames().filter((g) => g.publishedVersion && g.status === 'active')
      .map((g) => ({ id: g.id, name: g.name, engine: g.engine, version: g.publishedVersion, math: g.math })));
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

  r.get('/api/admin/me', A((req, res) => json(res, { ok: true, providers: providers(), models: { agents: config.anthropic.model, director: config.anthropic.directorModel } })));

  r.get('/api/admin/games', A((req, res) => json(res, games.listGames())));
  r.post('/api/admin/games', A(async (req, res, { actor }) => json(res, games.createGame(await readJson(req), actor), 201)));
  r.get('/api/admin/games/:id', A((req, res, { params }) => json(res, games.getGame(params.id))));
  r.put('/api/admin/games/:id/draft', A(async (req, res, { params, actor }) => {
    const body = await readJson(req);
    json(res, games.saveDraft(params.id, body, actor, { allowInvalid: req.query.force === '1' }));
  }));
  r.patch('/api/admin/games/:id/draft', A(async (req, res, { params, actor }) => {
    const { ops } = await readJson(req);
    json(res, games.patchDraft(params.id, ops || [], actor));
  }));
  r.post('/api/admin/games/:id/publish', A(async (req, res, { params, actor }) => {
    const { note } = await readJson(req);
    json(res, await games.publish(params.id, { actor, note }));
  }));
  r.get('/api/admin/games/:id/versions', A((req, res, { params }) => json(res, games.listVersions(params.id))));
  r.post('/api/admin/games/:id/restore/:version', A((req, res, { params, actor }) => json(res, games.restoreVersion(params.id, Number(params.version), actor))));
  r.post('/api/admin/games/:id/status', A(async (req, res, { params, actor }) => {
    games.setStatus(params.id, (await readJson(req)).status, actor);
    json(res, { ok: true });
  }));
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
    json(res, { history: t.history, final: t.final, buy: t.buy });
  }));
  // Tamaño de la cuadrícula y líneas de pago (reajusta pagos y RTP en el borrador).
  r.get('/api/admin/games/:id/grid', A((req, res, { params }) => {
    const c = games.getDraft(params.id);
    const lined = ['bonus-buy', 'hold-win'].includes(c.engine);
    const q = { reels: Number(req.query.reels) || c.grid.reels, rows: Number(req.query.rows) || c.grid.rows };
    json(res, { grid: c.grid, lines: c.rules.lines ?? null, paysBy: lined ? 'lines' : 'ways', maxLines: lined ? maxLines(q.reels, q.rows) : null });
  }));
  r.post('/api/admin/games/:id/resize', A(async (req, res, { params, actor }) => {
    const body = await readJson(req);
    const c = games.getDraft(params.id);
    const t = await resizeAsync(c, { reels: body.reels != null ? Number(body.reels) : undefined, rows: body.rows != null ? Number(body.rows) : undefined, lines: body.lines != null ? Number(body.lines) : undefined, spins: 300_000 });
    games.saveDraft(params.id, t.config, actor);
    json(res, { grid: t.config.grid, lines: t.config.rules.lines ?? null, maxLines: t.maxLines, history: t.history, final: t.final, buy: t.buy });
  }));
  // Vista previa: sesión demo que juega el BORRADOR.
  r.post('/api/admin/games/:id/preview-session', A((req, res, { params }) => json(res, wallets.createDemoSession(params.id, { source: 'draft' }), 201)));

  // Assets
  r.get('/api/admin/assets', A((req, res) => json(res, assets.listAssets({ gameId: req.query.gameId, kind: req.query.kind, limit: Number(req.query.limit) || 100 }))));
  r.post('/api/admin/assets', A(async (req, res, { actor }) => {
    const buf = await readBody(req, 20 * 1024 * 1024);
    if (!buf.length) throw new HttpError(400, 'Archivo vacío');
    const a = assets.saveAsset(buf, { gameId: req.query.gameId || null, kind: req.query.kind, mime: req.headers['content-type'], provider: 'upload', prompt: req.query.name || null, actor });
    json(res, a, 201);
  }));

  // Agentes
  r.get('/api/admin/agents', A((req, res) => json(res, Object.entries(agents.AGENTS).map(([id, a]) => ({ id, title: a.title })))));
  r.post('/api/admin/agents/runs', A(async (req, res, { actor }) => {
    const body = await readJson(req);
    json(res, agents.startRun({ gameId: body.gameId, prompt: body.prompt, runId: body.runId, agent: body.agent || 'director', actor }), 202);
  }));
  r.get('/api/admin/agents/runs', A((req, res) => json(res, agents.listRuns(req.query.gameId))));
  r.get('/api/admin/agents/runs/:id', A((req, res, { params }) => json(res, { ...agents.getRun(params.id), events: agents.listEvents(params.id) })));
  r.post('/api/admin/agents/runs/:id/cancel', A((req, res, { params }) => json(res, agents.cancelRun(params.id))));
  r.get('/api/admin/agents/runs/:id/events', A((req, res, { params }) => {
    const stream = sse(res);
    let last = Number(req.query.after) || 0;
    for (const e of agents.listEvents(params.id, last)) { stream.send(e.type, e); last = e.id; }
    const unsub = agents.subscribe(params.id, (e) => stream.send(e.type, e));
    res.on('close', unsub);
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
