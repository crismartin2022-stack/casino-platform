// Pruebas de integración: levanta el servidor real con IA simulada y una billetera seamless falsa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const PORT = 4100 + Math.floor(Math.random() * 500);
const B = `http://127.0.0.1:${PORT}`;
const ADMIN = { authorization: 'Bearer test-admin' };
let proc, dir, wallet, walletPort, walletSecret;
const walletState = { balance: 50_000, calls: [], failCredits: 0 };

const req = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(B + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  // Billetera seamless falsa del "operador"
  wallet = createServer(async (rq, rs) => {
    let raw = '';
    for await (const c of rq) raw += c;
    const sigOk = createHmac('sha256', walletSecret || '').update(raw).digest('hex') === rq.headers['x-signature'];
    const b = JSON.parse(raw);
    walletState.calls.push({ ...b, sigOk });
    const reply = (s, o) => { rs.writeHead(s, { 'content-type': 'application/json' }); rs.end(JSON.stringify(o)); };
    if (!sigOk) return reply(401, { error: 'firma' });
    if (b.action === 'debit') {
      if (walletState.balance < b.amount) return reply(402, { error: 'INSUFFICIENT_FUNDS' });
      walletState.balance -= b.amount;
    }
    if (b.action === 'credit') {
      if (walletState.failCredits > 0) { walletState.failCredits--; return reply(500, { error: 'caído' }); }
      walletState.balance += b.amount;
    }
    reply(200, { balance: walletState.balance });
  });
  await new Promise((r) => wallet.listen(0, r));
  walletPort = wallet.address().port;

  dir = mkdtempSync(`${tmpdir()}/casino-test-`);
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', './tests/helpers/mock-ai.js', 'backend/index.js'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_TOKEN: 'test-admin', LOG_REQUESTS: '0', ALLOW_HTTP_WALLET: '1',
      ANTHROPIC_API_KEY: 'x', VENICE_API_KEY: 'x', ELEVENLABS_API_KEY: 'x', PUBLISH_SIM_SPINS: '150000', PUBLISH_MAX_RTP_DEVIATION: '0.02', VARIANT_TUNE_SPINS: '40000',
      TUNE_REFINE_MS: '1500', PUBLISH_SIM_BUDGET_MS: '4000', PUBLISH_PRECISION: '0.01' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('escuchando')) resolve(); });
    proc.on('exit', (c) => reject(new Error(`servidor salió con ${c}`)));
  });
});

after(() => {
  proc?.kill();
  wallet?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('lista los 16 juegos publicados', async () => {
  const { body } = await req('/api/v1/games');
  assert.deepEqual(body.map((g) => g.engine).sort(), ['bonus-buy', 'cash-collect', 'classic-reels', 'cluster-pays', 'colossal-reels', 'craps', 'craps', 'expanding-symbol', 'hold-win', 'level-up',
    'megaways', 'megaways-cascade', 'reel-rush', 'scatter-pays', 'sticky-wilds', 'treasure-chests']);
  const { body: g } = await req('/api/v1/games/megaways');
  assert.equal(g.reels, undefined, 'las tiras de rodillos no se exponen al navegador');
});

test('demo: giro, idempotencia, saldo y verificación', async () => {
  const { body: s } = await req('/api/v1/demo/sessions', { method: 'POST', body: { gameId: 'reel-rush' } });
  const auth = { authorization: `Bearer ${s.token}` };
  const r1 = await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 100, clientRoundId: 'abc' } });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.balance, s.balance - 100 + r1.body.win);
  const again = await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 100, clientRoundId: 'abc' } });
  assert.equal(again.body.roundId, r1.body.roundId, 'el mismo clientRoundId no cobra dos veces');
  const bad = await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 3 } });
  assert.equal(bad.status, 400);
  const rep = await req(`/api/admin/rounds/${r1.body.roundId}/replay`, { headers: ADMIN });
  assert.equal(rep.body.match, true);
});

test('bonus buy: menú de compra (ruleta) cobra su precio', async () => {
  const { body: s } = await req('/api/v1/demo/sessions', { method: 'POST', body: { gameId: 'bonus-buy' } });
  const { body: sess } = await req('/api/v1/session', { headers: { authorization: `Bearer ${s.token}` } });
  const cost = sess.game.rules.bonusMenu.wheel.cost;
  const r = await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${s.token}` }, body: { bet: 20, mode: 'buy-wheel' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cost, Math.round(20 * cost));
  assert.equal(r.body.result.bonus.type, 'wheel');
});

test('bonus buy cobra el precio de compra', async () => {
  const { body: s } = await req('/api/v1/demo/sessions', { method: 'POST', body: { gameId: 'bonus-buy' } });
  const { body: sess } = await req('/api/v1/session', { headers: { authorization: `Bearer ${s.token}` } });
  const r = await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${s.token}` }, body: { bet: 100, mode: 'buy' } });
  assert.equal(r.body.cost, 100 * sess.game.rules.buyCost);
  assert.ok(r.body.result.freeSpins.spins.length >= 10);
});

test('craps: apostar, tirar, saldo coherente, retirar y verificar', async () => {
  const { body: s } = await req('/api/v1/demo/sessions', { method: 'POST', body: { gameId: 'craps' } });
  const auth = { authorization: `Bearer ${s.token}` };
  assert.equal((await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 100 } })).status, 400);
  assert.equal((await req('/api/v1/table/roll', { method: 'POST', headers: auth, body: {} })).status, 400); // sin apuestas
  let t = (await req('/api/v1/table', { headers: auth })).body;
  assert.equal(t.phase, 'comeOut');
  let balance = t.balance;
  const bad = await req('/api/v1/table/bets', { method: 'POST', headers: auth, body: { type: 'come', amount: 500 } });
  assert.equal(bad.status, 400); // Come solo con punto
  for (let i = 0; i < 60; i++) {
    t = (await req('/api/v1/table', { headers: auth })).body;
    if (t.phase === 'comeOut' && !t.bets.some((b) => b.type === 'pass')) await req('/api/v1/table/bets', { method: 'POST', headers: auth, body: { type: 'pass', amount: 500 } });
    if (t.phase === 'point' && !t.bets.some((b) => b.type === 'place' && b.number === 8)) await req('/api/v1/table/bets', { method: 'POST', headers: auth, body: { type: 'place', number: 8, amount: 600 } });
    await req('/api/v1/table/bets', { method: 'POST', headers: auth, body: { type: 'field', amount: 100 } });
    const r = await req('/api/v1/table/roll', { method: 'POST', headers: auth, body: { clientRoundId: `r${i}` } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.balance, balance - r.body.cost + r.body.win);
    balance = r.body.balance;
    if (i === 5) {
      const rep = await req(`/api/admin/rounds/${r.body.roundId}/replay`, { headers: ADMIN });
      assert.equal(rep.body.match, true);
    }
  }
  // Retirar un Número activo devuelve el importe
  t = (await req('/api/v1/table', { headers: auth })).body;
  const placed = t.bets.find((b) => b.type === 'place' && b.status === 'active');
  if (placed) {
    const rm = await req(`/api/v1/table/bets/${placed.id}`, { method: 'DELETE', headers: auth });
    assert.equal(rm.body.refunded, placed.amount);
    assert.equal(rm.body.balance, balance + placed.amount);
  }
});

test('admin exige token', async () => {
  assert.equal((await req('/api/admin/games')).status, 401);
  assert.equal((await req('/api/admin/games', { headers: { authorization: 'Bearer malo' } })).status, 401);
});

test('agentes: el director delega, se respetan permisos y el borrador cambia', async () => {
  const { body } = await req('/api/admin/agents/runs', { method: 'POST', headers: ADMIN, body: { gameId: 'reel-rush', prompt: 'Rediseño neón' } });
  let run;
  for (let i = 0; i < 120; i++) {
    run = (await req(`/api/admin/agents/runs/${body.runId}`, { headers: ADMIN })).body;
    if (run.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(run.status, 'done', run.summary);
  const denied = run.events.find((e) => e.type === 'tool_result' && e.data.tool === 'update_config' && e.data.agent === 'artist');
  assert.equal(denied.data.ok, false, 'el artista no puede tocar la matemática');
  const { body: g } = await req('/api/admin/games/reel-rush', { headers: ADMIN });
  assert.match(g.draft.symbols.find((s) => s.id === 'cherry').image, /^\/media\//);
  assert.match(g.draft.sounds.win, /^\/media\/.*\.mp3$/);
  assert.equal(g.draft.rtpTarget, 0.955);
  assert.equal(g.hasUnpublishedChanges, true);
  // El asset se sirve
  const img = await fetch(B + g.draft.symbols.find((s) => s.id === 'cherry').image);
  assert.equal(img.headers.get('content-type'), 'image/png');
});

test('agentes: las imágenes de referencia llegan al director y al especialista', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(`${B}/api/admin/assets?gameId=megaways&kind=image&reference=1&name=ref.png`, { method: 'POST', headers: { ...ADMIN, 'content-type': 'image/png' }, body: png });
  const asset = await up.json();
  assert.equal(asset.provider, 'referencia');
  const { body } = await req('/api/admin/agents/runs', { method: 'POST', headers: ADMIN, body: { gameId: 'megaways', prompt: 'Algo así', images: [asset.id] } });
  let run;
  for (let i = 0; i < 60; i++) {
    run = (await req(`/api/admin/agents/runs/${body.runId}`, { headers: ADMIN })).body;
    if (run.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal(run.status, 'done', run.summary);
  const user = run.events.find((e) => e.type === 'user');
  assert.equal(user.data.images[0].id, asset.id);
  const artist = run.events.find((e) => e.type === 'agent_done' && e.data.agent === 'artist');
  assert.equal(artist.data.summary, 'VI_LA_IMAGEN');
  const tooMany = await req('/api/admin/agents/runs', { method: 'POST', headers: ADMIN, body: { gameId: 'megaways', prompt: 'x', images: Array(7).fill(asset.id) } });
  assert.equal(tooMany.status, 400);
});

test('vista previa juega el borrador; publicar crea versión nueva', async () => {
  const { body: pv } = await req('/api/admin/games/reel-rush/preview-session', { method: 'POST', headers: ADMIN });
  const { body: sess } = await req('/api/v1/session', { headers: { authorization: `Bearer ${pv.token}` } });
  assert.equal(sess.source, 'draft');
  const spin = await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${pv.token}` }, body: { bet: 100 } });
  assert.equal(spin.status, 200);
  assert.equal(spin.body.version, null);
  const pub = await req('/api/admin/games/reel-rush/publish', { method: 'POST', headers: ADMIN, body: { note: 'neón' } });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.version, 2);
  assert.equal(pub.body.mathChanged, true);
  const { body: g } = await req('/api/v1/games/reel-rush');
  assert.equal(g.version, 2);
});

test('publicar rechaza un RTP fuera de tolerancia', async () => {
  const ops = [{ op: 'set', path: 'symbols.diamond.pays', value: { 3: 50, 4: 100, 5: 400 } }];
  assert.equal((await req('/api/admin/games/reel-rush/draft', { method: 'PATCH', headers: ADMIN, body: { ops } })).status, 200);
  const pub = await req('/api/admin/games/reel-rush/publish', { method: 'POST', headers: ADMIN, body: {} });
  assert.equal(pub.status, 422);
  assert.match(pub.body.error, /RTP simulado/);
  // La prueba silenciosa acompaña el rechazo con el arreglo sugerido
  assert.equal(pub.body.details.check.status, 'fail');
  assert.ok(pub.body.details.check.fixes.some((f) => f.agent === 'math'));
});

test('cuadrícula: cambiar rodillos, filas y líneas reajusta el RTP del borrador', async () => {
  const r = await req('/api/admin/games/bonus-buy/resize', { method: 'POST', headers: ADMIN, body: { reels: 6, rows: 4, lines: 30 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.grid.reels, r.body.grid.rows, r.body.lines], [6, 4, 30]);
  assert.ok(Math.abs(r.body.final.rtp - 0.96) < 0.03, `RTP ${r.body.final.rtp}`);
  const { body: g } = await req('/api/admin/games/bonus-buy', { headers: ADMIN });
  assert.equal(g.draft.reels.length, 6);
  // La vista previa juega el borrador en 6x4
  const { body: pv } = await req('/api/admin/games/bonus-buy/preview-session', { method: 'POST', headers: ADMIN });
  const spin = await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${pv.token}` }, body: { bet: 100 } });
  assert.equal(spin.body.result.base.grid.length, 6);
  assert.equal(spin.body.result.base.grid[0].length, 4);
  const bad = await req('/api/admin/games/bonus-buy/resize', { method: 'POST', headers: ADMIN, body: { reels: 12 } });
  assert.equal(bad.status, 400);
});

test('botones: el tema acepta forma, estilo e imágenes por botón', async () => {
  const ops = [
    { op: 'merge', path: 'theme.buttons', value: { shape: 'square', style: 'glass', size: 1.2 } },
    { op: 'set', path: 'theme.buttons.spin.image', value: '/gen/symbol.svg?label=GO' },
    { op: 'set', path: 'theme.buttons.auto.icon', value: '▶▶' },
  ];
  const r = await req('/api/admin/games/hold-win/draft', { method: 'PATCH', headers: ADMIN, body: { ops } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { body: g } = await req('/api/admin/games/hold-win', { headers: ADMIN });
  assert.equal(g.draft.theme.buttons.shape, 'square');
  assert.equal(g.draft.theme.buttons.spin.image, '/gen/symbol.svg?label=GO');
});

test('operador seamless: firma HMAC, débito/crédito y reintento de créditos', async () => {
  const op = await req('/api/admin/operators', { method: 'POST', headers: ADMIN, body: { name: 'Casino X', walletMode: 'seamless', walletUrl: `http://127.0.0.1:${walletPort}/wallet` } });
  assert.equal(op.status, 201);
  walletSecret = op.body.walletSecret;
  const key = { 'x-api-key': op.body.apiKey };
  const s = await req('/api/v1/operator/sessions', { method: 'POST', headers: key, body: { playerId: 'u-1', gameId: 'hold-win' } });
  assert.equal(s.status, 201);
  assert.match(s.body.launchUrl, /\/play\/hold-win\?token=/);
  const auth = { authorization: `Bearer ${s.body.token}` };
  const before = walletState.balance;
  const r = await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 200 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(walletState.balance, before - 200 + r.body.win);
  assert.ok(walletState.calls.every((c) => c.sigOk), 'todas las peticiones van firmadas');
  const deb = walletState.calls.find((c) => c.action === 'debit');
  assert.equal(deb.txId, `${r.body.roundId}:bet`);
  // Sin saldo → 402 y no se juega
  walletState.balance = 10;
  const poor = await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 200 } });
  assert.equal(poor.status, 402);
  // Crédito que falla → la ronda queda pendiente y se informa
  walletState.balance = 10_000;
  walletState.failCredits = 10;
  const pend = await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 200 } });
  assert.equal(pend.body.creditPending, true);
  const rounds = (await req('/api/admin/rounds?status=pending_credit', { headers: ADMIN })).body;
  assert.ok(rounds.some((x) => x.id === pend.body.roundId));
  // Informe del operador
  const list = await req('/api/v1/operator/rounds', { headers: key });
  assert.ok(list.body.length >= 2);
  assert.equal(list.body[0].player_id, 'u-1');
});

test('operador interno: depósitos idempotentes', async () => {
  const op = await req('/api/admin/operators', { method: 'POST', headers: ADMIN, body: { name: 'Casino Y' } });
  const key = { 'x-api-key': op.body.apiKey };
  const d = await req('/api/v1/operator/players/p9/balance', { method: 'POST', headers: key, body: { amount: 5000, reference: 'dep-1' } });
  assert.equal(d.body.balance, 5000);
  const dup = await req('/api/v1/operator/players/p9/balance', { method: 'POST', headers: key, body: { amount: 5000, reference: 'dep-1' } });
  assert.equal(dup.status, 409);
  const s = await req('/api/v1/operator/sessions', { method: 'POST', headers: key, body: { playerId: 'p9', gameId: 'colossal-reels' } });
  const r = await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${s.body.token}` }, body: { bet: 100 } });
  assert.equal(r.body.balance, 5000 - 100 + r.body.win);
});

const waitFor = async (fn, ms = 90_000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('tiempo agotado');
    await new Promise((r) => setTimeout(r, 300));
  }
};

test('portal del operador: roles, RTP asignado por el proveedor, juegos propios limitados y reportes', async () => {
  const op = (await req('/api/admin/operators', { method: 'POST', headers: ADMIN, body: { name: 'Casino Portal' } })).body;
  const key = { 'x-api-key': op.apiKey };
  // --- El proveedor deshabilita un juego y asigna otro RTP a otro
  await req(`/api/admin/operators/${op.id}/games/megaways`, { method: 'PUT', headers: ADMIN, body: { enabled: false } });
  const no = await req('/api/v1/operator/sessions', { method: 'POST', headers: key, body: { playerId: 'p1', gameId: 'megaways' } });
  assert.equal(no.status, 404);
  const set = await req(`/api/admin/operators/${op.id}/games/reel-rush`, { method: 'PUT', headers: ADMIN, body: { rtpTarget: 0.94 } });
  assert.equal(set.status, 200);
  assert.equal(set.body.rtpTarget, 0.94);
  const bad = await req(`/api/admin/operators/${op.id}/games/reel-rush`, { method: 'PUT', headers: ADMIN, body: { rtpTarget: 1.3 } });
  assert.equal(bad.status, 400);
  const craps = await req(`/api/admin/operators/${op.id}/games/craps`, { method: 'PUT', headers: ADMIN, body: { rtpTarget: 0.95 } });
  assert.equal(craps.status, 400);
  const v = await waitFor(async () => (await req('/api/admin/games/reel-rush/rtp-variants', { headers: ADMIN })).body.find((x) => x.status === 'ready' && x.rtpTarget === 0.94));
  assert.ok(Math.abs(v.math.rtp - 0.94) < 0.03, `RTP de la variante ${v.math.rtp}`);
  await req('/api/v1/operator/players/p1/balance', { method: 'POST', headers: key, body: { amount: 100_000, reference: 'd1' } });
  const s = (await req('/api/v1/operator/sessions', { method: 'POST', headers: key, body: { playerId: 'p1', gameId: 'reel-rush' } })).body;
  const auth = { authorization: `Bearer ${s.token}` };
  const sess = (await req('/api/v1/session', { headers: auth })).body;
  assert.equal(sess.game.math.rtp, v.math.rtp); // el jugador ve el RTP asignado
  let last;
  for (let i = 0; i < 5; i++) last = (await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 100 } })).body;
  const rep = (await req(`/api/admin/rounds/${last.roundId}/replay`, { headers: ADMIN })).body;
  assert.equal(rep.match, true);
  const cat = (await req('/api/v1/operator/games', { headers: key })).body;
  assert.ok(!cat.some((g) => g.id === 'megaways'));
  assert.equal(cat.find((g) => g.id === 'reel-rush').math.rtp, v.math.rtp);

  // --- Usuarios del portal
  const u = (await req(`/api/admin/operators/${op.id}/users`, { method: 'POST', headers: ADMIN, body: { email: 'Admin@CasinoPortal.com', role: 'admin' } })).body;
  assert.ok(u.temporaryPassword);
  const wrong = await req('/api/portal/login', { method: 'POST', body: { email: 'admin@casinoportal.com', password: 'mal' } });
  assert.equal(wrong.status, 401);
  const lg = (await req('/api/portal/login', { method: 'POST', body: { email: 'admin@casinoportal.com', password: u.temporaryPassword } })).body;
  assert.equal(lg.mustChangePassword, true);
  const P = { authorization: `Bearer ${lg.token}` };
  const me = (await req('/api/admin/me', { headers: P })).body;
  assert.equal(me.kind, 'operator');
  assert.equal(me.operator.id, op.id);
  assert.equal(me.providers.anthropic, false); // agentes no habilitados
  const pw = await req('/api/portal/password', { method: 'POST', headers: P, body: { current: u.temporaryPassword, next: 'nueva-clave-segura' } });
  assert.equal(pw.status, 200);
  // Solo lo suyo y nada del proveedor
  assert.equal((await req('/api/admin/operators', { headers: P })).status, 403);
  assert.equal((await req('/api/admin/rounds', { headers: P })).status, 403);
  assert.equal((await req('/api/admin/games/reel-rush', { headers: P })).status, 403);
  assert.deepEqual((await req('/api/admin/games', { headers: P })).body, []);

  // --- Reportes
  const sum = (await req('/api/portal/summary', { headers: P })).body;
  assert.equal(sum.totals.rounds, 5);
  assert.equal(sum.totals.ggr, sum.totals.wagered - sum.totals.won);
  const rl = (await req('/api/portal/rounds?player=p1', { headers: P })).body;
  assert.equal(rl.length, 5);
  assert.equal(rl[0].player, 'p1');
  const ver = (await req(`/api/portal/rounds/${last.roundId}/verify`, { headers: P })).body;
  assert.equal(ver.match, true);
  const pl = (await req('/api/portal/players', { headers: P })).body;
  assert.equal(pl[0].player, 'p1');
  const csv = await fetch(`${B}/api/portal/export/rounds.csv`, { headers: P });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const text = await csv.text();
  assert.match(text, /ronda,fecha_utc,jugador/);
  assert.equal(text.trim().split('\n').length, 6);
  // Otro operador no ve esas rondas
  const other = (await req('/api/admin/operators', { method: 'POST', headers: ADMIN, body: { name: 'Otro' } })).body;
  const ou = (await req(`/api/admin/operators/${other.id}/users`, { method: 'POST', headers: ADMIN, body: { email: 'x@otro.com', role: 'support' } })).body;
  const OP = { authorization: `Bearer ${(await req('/api/portal/login', { method: 'POST', body: { email: 'x@otro.com', password: ou.temporaryPassword } })).body.token}` };
  assert.equal((await req(`/api/portal/rounds/${last.roundId}`, { headers: OP })).status, 404);
  // Rol soporte: no mueve saldo
  assert.equal((await req('/api/portal/players/p1/balance', { method: 'POST', headers: OP, body: { amount: 100 } })).status, 403);
  const bal = await req('/api/portal/players/p1/balance', { method: 'POST', headers: P, body: { amount: 500, reference: 'bono-1' } });
  assert.equal(bal.status, 200);

  // --- Juegos propios: apagado por defecto, luego habilitado con máximo 1
  const g0 = await req('/api/portal/games', { method: 'POST', headers: P, body: { name: 'Mi Juego', baseGameId: 'reel-rush' } });
  assert.equal(g0.status, 403);
  await req(`/api/admin/operators/${op.id}`, { method: 'PATCH', headers: ADMIN, body: { canCreateGames: true, maxGames: 1 } });
  const g1 = await req('/api/portal/games', { method: 'POST', headers: P, body: { name: 'Mi Juego', baseGameId: 'reel-rush' } });
  assert.equal(g1.status, 201);
  const gid = g1.body.id;
  assert.equal(g1.body.ownerOperatorId, op.id);
  const g2 = await req('/api/portal/games', { method: 'POST', headers: P, body: { name: 'Otro más', baseGameId: 'reel-rush' } });
  assert.equal(g2.status, 403);
  // Diseño sí, matemática no
  const okTheme = await req(`/api/admin/games/${gid}/draft`, { method: 'PATCH', headers: P, body: { ops: [{ op: 'set', path: 'theme.palette.primary', value: '#123456' }] } });
  assert.equal(okTheme.status, 200);
  const draft = (await req(`/api/admin/games/${gid}`, { headers: P })).body.draft;
  const sym = draft.symbols.find((x) => x.pays && Object.keys(x.pays).length);
  const noPays = await req(`/api/admin/games/${gid}/draft`, { method: 'PATCH', headers: P, body: { ops: [{ op: 'set', path: `symbols.${sym.id}.pays`, value: { 3: 999 } }] } });
  assert.equal(noPays.status, 403);
  const noRtp = await req(`/api/admin/games/${gid}/draft`, { method: 'PATCH', headers: P, body: { ops: [{ op: 'set', path: 'rtpTarget', value: 1.05 }] } });
  assert.equal(noRtp.status, 403);
  assert.equal((await req(`/api/admin/games/${gid}/tune`, { method: 'POST', headers: P, body: {} })).status, 403);
  assert.equal((await req('/api/admin/agents/runs', { method: 'POST', headers: P, body: { gameId: gid, prompt: 'hola' } })).status, 403);
  // Publicar reutiliza la matemática certificada (RTP asignado)
  const pub = await req(`/api/admin/games/${gid}/publish`, { method: 'POST', headers: P, body: { note: 'primera' } });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.math.rtp, v.math.rtp);
  const own = (await req('/api/admin/games', { headers: P })).body;
  assert.deepEqual(own.map((g) => g.id), [gid]);
  // Solo su operador lo puede abrir; no aparece en la lista pública
  assert.equal((await req('/api/v1/operator/sessions', { method: 'POST', headers: key, body: { playerId: 'p1', gameId: gid } })).status, 201);
  assert.equal((await req('/api/v1/operator/sessions', { method: 'POST', headers: { 'x-api-key': other.apiKey }, body: { playerId: 'p1', gameId: gid } })).status, 404);
  assert.ok(!(await req('/api/v1/games')).body.some((g) => g.id === gid));
  // El proveedor lo ve y puede suspender al operador
  const det = (await req(`/api/admin/operators/${op.id}`, { headers: ADMIN })).body;
  assert.equal(det.usedGames, 1);
  assert.ok(det.games.find((g) => g.id === gid).own);
  await req(`/api/admin/operators/${op.id}`, { method: 'PATCH', headers: ADMIN, body: { active: false } });
  assert.equal((await req('/api/portal/summary', { headers: P })).status, 401);
});

test('moneda: fichas por moneda, límites del operador y validación en el servidor', async () => {
  // El proveedor define fichas en pesos argentinos para sticky-wilds y Craps
  const g = (await req('/api/admin/games/sticky-wilds', { headers: ADMIN })).body;
  const bad = await req('/api/admin/games/sticky-wilds/draft', { method: 'PATCH', headers: ADMIN, body: { ops: [{ op: 'set', path: 'bet.byCurrency', value: { ARS: { levels: [50000, 20000] } } }] } });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.details.some((e) => /byCurrency/.test(e)));
  await req('/api/admin/games/sticky-wilds/draft', { method: 'PATCH', headers: ADMIN, body: { ops: [{ op: 'set', path: 'bet.byCurrency', value: { ARS: { levels: [20000, 50000, 100000, 200000], default: 50000 } } }] } });
  const pub = await req('/api/admin/games/sticky-wilds/publish', { method: 'POST', headers: ADMIN, body: { note: 'ARS' } });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.mathChanged, false); // las fichas no cambian el RTP
  await req('/api/admin/games/craps/draft', { method: 'PATCH', headers: ADMIN, body: { ops: [{ op: 'set', path: 'bet.byCurrency', value: { ARS: { levels: [100000, 500000] } } }] } });
  assert.equal((await req('/api/admin/games/craps/publish', { method: 'POST', headers: ADMIN, body: {} })).status, 200);

  const op = (await req('/api/admin/operators', { method: 'POST', headers: ADMIN, body: { name: 'Casino Pesos', currency: 'ARS' } })).body;
  const key = { 'x-api-key': op.apiKey };
  await req('/api/v1/operator/players/a1/balance', { method: 'POST', headers: key, body: { amount: 10_000_000, reference: 'd' } });
  let s = (await req('/api/v1/operator/sessions', { method: 'POST', headers: key, body: { playerId: 'a1', gameId: 'sticky-wilds' } })).body;
  let auth = { authorization: `Bearer ${s.token}` };
  const sess = (await req('/api/v1/session', { headers: auth })).body;
  assert.equal(sess.currency, 'ARS');
  assert.deepEqual(sess.game.bet.levels, [20000, 50000, 100000, 200000]);
  assert.equal(sess.game.bet.byCurrency, undefined);
  assert.equal((await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 100 } })).status, 400); // ficha de USD no vale en ARS
  assert.equal((await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 50000 } })).status, 200);
  // Un casino en USD sigue con las fichas base
  const usd = (await req('/api/admin/operators', { method: 'POST', headers: ADMIN, body: { name: 'Casino Dólar' } })).body;
  const su = (await req('/api/v1/operator/sessions', { method: 'POST', headers: { 'x-api-key': usd.apiKey }, body: { playerId: 'u1', gameId: 'sticky-wilds' } })).body;
  assert.deepEqual((await req('/api/v1/session', { headers: { authorization: `Bearer ${su.token}` } })).body.game.bet.levels, g.draft.bet.levels);

  // Límites del operador: mínimo 50.000 y máximo 100.000 (centavos)
  const lim = await req(`/api/admin/operators/${op.id}`, { method: 'PATCH', headers: ADMIN, body: { betLimits: { ARS: { min: 50000, max: 100000 } } } });
  assert.deepEqual(lim.body.betLimits, { ARS: { min: 50000, max: 100000 } });
  assert.equal((await req(`/api/admin/operators/${op.id}`, { method: 'PATCH', headers: ADMIN, body: { betLimits: { ARS: { min: 9, max: 1 } } } })).status, 400);
  s = (await req('/api/v1/operator/sessions', { method: 'POST', headers: key, body: { playerId: 'a1', gameId: 'sticky-wilds' } })).body;
  auth = { authorization: `Bearer ${s.token}` };
  assert.deepEqual((await req('/api/v1/session', { headers: auth })).body.game.bet.levels, [50000, 100000]);
  assert.equal((await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 200000 } })).status, 400);
  const cat = (await req('/api/v1/operator/games', { headers: key })).body;
  assert.ok(cat.length > 0);

  // Craps en ARS: fichas y límites escalados, acotados por el operador
  const sc = (await req('/api/v1/operator/sessions', { method: 'POST', headers: key, body: { playerId: 'a1', gameId: 'craps' } })).body;
  const ca = { authorization: `Bearer ${sc.token}` };
  const cs = (await req('/api/v1/session', { headers: ca })).body;
  assert.deepEqual(cs.game.bet.levels, [100000].filter((x) => x <= 100000));
  assert.equal(cs.game.rules.limits.max, 100000);
  assert.equal((await req('/api/v1/table/bets', { method: 'POST', headers: ca, body: { type: 'pass', amount: 200000 } })).status, 400);
  assert.equal((await req('/api/v1/table/bets', { method: 'POST', headers: ca, body: { type: 'pass', amount: 100000 } })).status, 200);
});

test('forzar bonus: solo en la vista previa del borrador', async () => {
  const { body: pv } = await req('/api/admin/games/expanding-symbol/preview-session', { method: 'POST', headers: ADMIN });
  const auth = { authorization: `Bearer ${pv.token}` };
  const r = await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 100, force: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.result.freeSpins?.awarded > 0);
  // En sesiones normales (publicado) está prohibido
  const { body: demo } = await req('/api/v1/demo/sessions', { method: 'POST', body: { gameId: 'expanding-symbol' } });
  const no = await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${demo.token}` }, body: { bet: 100, force: true } });
  assert.equal(no.status, 403);
  // Un juego sin bonus avisa
  const { body: pv2 } = await req('/api/admin/games/reel-rush/preview-session', { method: 'POST', headers: ADMIN });
  const nb = await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${pv2.token}` }, body: { bet: 100, force: true } });
  assert.equal(nb.status, 409);
});

test('marcas: logotipo, pantalla de carga y juegos agrupados por marca', async () => {
  const b = await req('/api/admin/brands', { method: 'POST', headers: ADMIN, body: { name: 'Aurora Studio', tagline: 'Juegos con luz propia', color: '#ffcc00', bg: '#101020', loader: 'ring', minMs: 1200, logo: '/assets/logo.png' } });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal((await req('/api/admin/brands', { method: 'POST', headers: ADMIN, body: { name: 'aurora studio' } })).status, 409);
  assert.equal((await req('/api/admin/brands', { method: 'POST', headers: ADMIN, body: { name: 'X', color: 'rojo' } })).status, 400);
  assert.equal((await req(`/api/admin/games/sticky-wilds/brand`, { method: 'PUT', headers: ADMIN, body: { brandId: b.body.id } })).status, 200);
  // La sesión del jugador trae la marca para la pantalla de carga
  const { body: demo } = await req('/api/v1/demo/sessions', { method: 'POST', body: { gameId: 'sticky-wilds' } });
  const ses = (await req('/api/v1/session', { headers: { authorization: `Bearer ${demo.token}` } })).body;
  assert.equal(ses.brand.name, 'Aurora Studio');
  assert.equal(ses.brand.loader, 'ring');
  assert.equal(ses.brand.logo, '/assets/logo.png');
  // El panel lista primero los juegos con marca (ordenados por marca)
  const games = (await req('/api/admin/games', { headers: ADMIN })).body;
  const list = Array.isArray(games) ? games : games.games;
  assert.equal(list[0].brandId, b.body.id);
  const brands = (await req('/api/admin/brands', { headers: ADMIN })).body;
  assert.equal(brands.find((x) => x.id === b.body.id).games, 1);
  // No se borra una marca con juegos
  assert.equal((await req(`/api/admin/brands/${b.body.id}`, { method: 'DELETE', headers: ADMIN })).status, 409);
  const up = await req(`/api/admin/brands/${b.body.id}`, { method: 'PATCH', headers: ADMIN, body: { tagline: 'Nueva', font: 'Cinzel Decorative' } });
  assert.equal(up.body.tagline, 'Nueva');
  assert.equal(up.body.font, 'Cinzel Decorative');
  const ses2 = (await req('/api/v1/session', { headers: { authorization: `Bearer ${demo.token}` } })).body;
  assert.equal(ses2.brand.font, 'Cinzel Decorative');
  await req(`/api/admin/games/sticky-wilds/brand`, { method: 'PUT', headers: ADMIN, body: { brandId: null } });
  assert.equal((await req(`/api/admin/brands/${b.body.id}`, { method: 'DELETE', headers: ADMIN })).status, 200);
});

test('prueba silenciosa: se ejecuta al publicar, bloquea errores y sugiere arreglos', async () => {
  // A pedido, sobre el borrador
  const ck = await req('/api/admin/games/hold-win/check', { method: 'POST', headers: ADMIN });
  assert.equal(ck.status, 200, JSON.stringify(ck.body));
  assert.ok(ck.body.checks.length >= 10);
  assert.ok(['ok', 'warn'].includes(ck.body.status), JSON.stringify(ck.body.checks.filter((c) => c.status === 'fail')));
  for (const id of ['config', 'bets', 'plays', 'payouts', 'replay', 'bonus', 'rtp', 'files', 'sounds', 'brand', 'client']) {
    assert.ok(ck.body.checks.some((c) => c.id === id), `falta el chequeo ${id}`);
  }
  // Sin marca → aviso con arreglo sugerido
  assert.ok(ck.body.fixes.some((f) => f.area === 'Marca'));
  // Al publicar: la respuesta trae la prueba y queda guardada con la versión
  const pub = await req('/api/admin/games/hold-win/publish', { method: 'POST', headers: ADMIN, body: { note: 'prueba' } });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.ok(pub.body.check.passed);
  const hist = (await req('/api/admin/games/hold-win/checks', { headers: ADMIN })).body;
  assert.equal(hist[0].version, pub.body.version);
  assert.equal(hist[0].source, 'publish');
  // Un símbolo con la imagen borrada → no se publica
  const ops = [{ op: 'set', path: 'symbols.jack.image', value: '/media/no-existe.png' }, { op: 'set', path: 'theme.messages', value: { texts: { freeSpins: 'GANASTE {z} GIROS' } } }];
  assert.equal((await req('/api/admin/games/hold-win/draft', { method: 'PATCH', headers: ADMIN, body: { ops } })).status, 200);
  const bad = await req('/api/admin/games/hold-win/publish', { method: 'POST', headers: ADMIN, body: {} });
  assert.equal(bad.status, 422);
  const rep = bad.body.details.check;
  assert.equal(rep.status, 'fail');
  assert.ok(rep.checks.some((c) => c.id === 'filesSymbols' && c.status === 'fail'));
  assert.ok(rep.checks.some((c) => c.id === 'texts' && c.status === 'warn'));
  assert.ok(rep.fixes[0].status === 'fail' && rep.fixes[0].agent === 'artist');
  const { body: g } = await req('/api/v1/games/hold-win');
  assert.equal(g.version, pub.body.version); // el juego en vivo no cambió
});

test('vista previa en otra moneda: fichas y saldo de esa moneda', async () => {
  await req('/api/admin/games/reel-rush/draft', { method: 'PATCH', headers: ADMIN, body: { ops: [{ op: 'set', path: 'bet.byCurrency', value: { ARS: { levels: [20000, 50000, 100000], default: 50000 } } }] } });
  const pv = (await req('/api/admin/games/reel-rush/preview-session', { method: 'POST', headers: ADMIN, body: { currency: 'ARS' } })).body;
  assert.equal(pv.currency, 'ARS');
  const s = (await req('/api/v1/session', { headers: { authorization: `Bearer ${pv.token}` } })).body;
  assert.deepEqual(s.game.bet.levels, [20000, 50000, 100000]);
  assert.ok(pv.balance >= 100000 * 100, JSON.stringify(pv.balance)); // saldo de prueba escalado a pesos
  assert.equal((await req('/api/admin/games/reel-rush/preview-session', { method: 'POST', headers: ADMIN, body: { currency: 'x1' } })).status, 400);
});

test('colosal en giros gratis: regla editable y validada', async () => {
  const bad = await req('/api/admin/games/colossal-reels/draft', { method: 'PATCH', headers: ADMIN, body: { ops: [{ op: 'set', path: 'rules.fsColossalChance', value: 1.5 }] } });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.details.some((e) => /fsColossalChance/.test(e)));
  const ok = await req('/api/admin/games/colossal-reels/draft', { method: 'PATCH', headers: ADMIN, body: { ops: [{ op: 'set', path: 'rules.fsColossalChance', value: 0.5 }] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const { body: pv } = await req('/api/admin/games/colossal-reels/preview-session', { method: 'POST', headers: ADMIN });
  const r = await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${pv.token}` }, body: { bet: 100, force: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('prueba silenciosa: avisa si un operador usa una moneda sin fichas propias', async () => {
  await req('/api/admin/operators', { method: 'POST', headers: ADMIN, body: { name: 'Casino Reales', currency: 'BRL' } });
  const ck = (await req('/api/admin/games/cluster-pays/check', { method: 'POST', headers: ADMIN })).body;
  const c = ck.checks.find((x) => x.id === 'currencies');
  assert.equal(c.status, 'warn');
  assert.match(c.detail, /BRL/);
});

test('eliminar juego: con confirmación y nunca si tuvo jugadas con dinero real', async () => {
  const g = (await req('/api/admin/games', { method: 'POST', headers: ADMIN, body: { name: 'Duplicado por error', engine: 'reel-rush' } })).body;
  const { body: pv } = await req(`/api/admin/games/${g.id}/preview-session`, { method: 'POST', headers: ADMIN });
  assert.equal((await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${pv.token}` }, body: { bet: 100 } })).status, 200);
  assert.equal((await req(`/api/admin/games/${g.id}`, { method: 'DELETE', headers: ADMIN, body: { confirm: 'otro' } })).status, 400);
  const del = await req(`/api/admin/games/${g.id}`, { method: 'DELETE', headers: ADMIN, body: { confirm: 'Duplicado por error' } });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await req(`/api/admin/games/${g.id}`, { headers: ADMIN })).status, 404);
  // Un juego con jugadas reales no se borra (auditoría)
  const op = (await req('/api/admin/operators', { method: 'POST', headers: ADMIN, body: { name: 'Casino Borrar' } })).body;
  await req('/api/v1/operator/players/z1/balance', { method: 'POST', headers: { 'x-api-key': op.apiKey }, body: { amount: 100000, reference: 'z' } });
  const s = (await req('/api/v1/operator/sessions', { method: 'POST', headers: { 'x-api-key': op.apiKey }, body: { playerId: 'z1', gameId: 'megaways' } })).body;
  assert.equal((await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${s.token}` }, body: { bet: 100 } })).status, 200);
  const no = await req('/api/admin/games/megaways', { method: 'DELETE', headers: ADMIN, body: { confirm: 'megaways' } });
  assert.equal(no.status, 409);
});

test('cambiar motor: copia con otro motor conservando el diseño y los símbolos por equivalencia', async () => {
  await req('/api/admin/games/sticky-wilds/draft', { method: 'PATCH', headers: ADMIN, body: { ops: [{ op: 'set', path: 'theme.messages', value: { font: 'Rye', texts: { bigWin: '¡BOTÍN!' } } }, { op: 'set', path: 'theme.logoOffsetY', value: 30 }] } });
  const src = (await req('/api/admin/games/sticky-wilds', { headers: ADMIN })).body;
  const r = await req('/api/admin/games/sticky-wilds/convert', { method: 'POST', headers: ADMIN, body: { engine: 'megaways', name: 'Forajidos Megaways', tune: false } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const g = (await req(`/api/admin/games/${r.body.game.id}`, { headers: ADMIN })).body;
  assert.equal(g.engine, 'megaways');
  assert.equal(g.draft.theme.messages.font, 'Rye');
  assert.equal(g.draft.theme.logoOffsetY, 30);
  assert.equal(g.draft.theme.background, src.draft.theme.background);
  // comodín y scatter conservan su imagen; el símbolo más alto del original pasa al más alto del nuevo
  const img = (cfg, t) => cfg.symbols.find((x) => x.type === t)?.image;
  assert.equal(img(g.draft, 'wild'), img(src.draft, 'wild'));
  assert.equal(img(g.draft, 'scatter'), img(src.draft, 'scatter'));
  const top = (cfg) => cfg.symbols.filter((x) => !x.type || x.type === 'regular').sort((a, b) => Math.max(...Object.values(b.pays)) - Math.max(...Object.values(a.pays)))[0];
  assert.equal(top(g.draft).image, top(src.draft).image);
  // (el símbolo multiplicador de Megaways no tiene equivalente en Forajidos: queda el de la plantilla)
  assert.equal(r.body.missing.filter((m) => m.type !== 'multiplier').length, 0);
  // el original sigue con su motor
  assert.equal((await req('/api/admin/games/sticky-wilds', { headers: ADMIN })).body.engine, 'sticky-wilds');
  assert.equal((await req('/api/admin/games/sticky-wilds/convert', { method: 'POST', headers: ADMIN, body: { engine: 'sticky-wilds' } })).status, 400);
  // la copia juega en la vista previa
  const { body: pv } = await req(`/api/admin/games/${r.body.game.id}/preview-session`, { method: 'POST', headers: ADMIN });
  assert.deepEqual(g.draft.bet.levels, src.draft.bet.levels); // conserva las fichas del original
  assert.equal((await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${pv.token}` }, body: { bet: g.draft.bet.levels[0] } })).status, 200);
});

test('cofres: premios por fila, elección de cofre con multiplicador y compra del bonus', async () => {
  const { body: pv } = await req('/api/admin/games/treasure-chests/preview-session', { method: 'POST', headers: ADMIN });
  const auth = { authorization: `Bearer ${pv.token}` };
  const f = await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 100, force: true } });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const r = f.body.result;
  assert.ok(r.chest && [1, 2, 3].includes(r.chest.mult));
  assert.equal(r.chest.others.length, 2);
  assert.ok(r.freeSpins.spins.length >= r.freeSpins.awarded);
  for (const s of r.freeSpins.spins) for (const w of s.wins) assert.ok(w.count >= 3 && w.positions.every(([, row]) => row === w.row));
  // Como el diseño original, sin compra de bonus por defecto
  assert.equal((await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 100, mode: 'buy' } })).status, 400);
  // las probabilidades de los cofres no se exponen
  const { body: g } = await req('/api/v1/games/treasure-chests');
  assert.ok(g.rules.chestPrizes.every((x) => typeof x === 'number'));
});

test('cash collect: el recolector cobra todas las monedas; niveles en giros gratis', async () => {
  const { body: pv } = await req('/api/admin/games/cash-collect/preview-session', { method: 'POST', headers: ADMIN });
  const auth = { authorization: `Bearer ${pv.token}` };
  const f = await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 100, force: true } });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const fs = f.body.result.freeSpins;
  assert.ok(fs.spins.length >= fs.awarded);
  for (const s of fs.spins) {
    const sum = s.coins.reduce((a, k) => a + k.value, 0);
    const expect = s.collectors.length && s.coins.length ? sum * s.collectors.length * s.mult : 0;
    assert.ok(Math.abs(s.collectWin - expect) < 1e-5, 'cobro = monedas × recolectores × multiplicador');
  }
  const buy = await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: 100, mode: 'buy' } });
  assert.equal(buy.status, 200, JSON.stringify(buy.body));
  const { body: g } = await req('/api/v1/games/cash-collect');
  assert.ok(g.rules.coinValues.every((x) => typeof x === 'number'), 'sin probabilidades expuestas');
});

test('level-up: el nivel se guarda por jugador y apuesta, y la ronda se puede reproducir', async () => {
  const { body: s } = await req('/api/v1/demo/sessions', { method: 'POST', body: { gameId: 'level-up' } });
  const auth = { authorization: `Bearer ${s.token}` };
  const { body: sess } = await req('/api/v1/session', { headers: auth });
  const [b1, b2] = sess.game.bet.levels;
  const p0 = (await req(`/api/v1/progress?bet=${b1}`, { headers: auth })).body;
  assert.deepEqual(p0.state, { level: 1, xp: 0, collect: 0 });
  let last;
  for (let i = 0; i < 5; i++) {
    last = (await req('/api/v1/spin', { method: 'POST', headers: auth, body: { bet: b1 } })).body;
    assert.equal(last.result.engine, 'level-up');
  }
  const p1 = (await req(`/api/v1/progress?bet=${b1}`, { headers: auth })).body;
  assert.deepEqual(p1.state, last.result.state);
  assert.ok(p1.state.xp > 0 || p1.state.level > 1);
  // Otra apuesta: otro progreso
  const p2 = (await req(`/api/v1/progress?bet=${b2}`, { headers: auth })).body;
  assert.deepEqual(p2.state, { level: 1, xp: 0, collect: 0 });
  // La ronda guarda el estado anterior y se reproduce igual
  const v = await req(`/api/admin/rounds/${last.roundId}/replay`, { headers: ADMIN });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.match, true);
  assert.equal((await req('/api/v1/progress?bet=12345', { headers: auth })).status, 400);
});

test('dados en vivo: mesa compartida con cuenta regresiva, no va más y la misma tirada para todos', async () => {
  // Tiempos cortos para la prueba
  await req('/api/admin/games/craps-live/draft', { method: 'PATCH', headers: ADMIN, body: { ops: [{ op: 'set', path: 'rules.live', value: { enabled: true, bettingSeconds: 5, closeSeconds: 0, rollSeconds: 2, resultSeconds: 1 } }] } });
  const pub = await req('/api/admin/games/craps-live/publish', { method: 'POST', headers: ADMIN, body: { note: 'prueba' } });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const join = async () => {
    const { body: s } = await req('/api/v1/demo/sessions', { method: 'POST', body: { gameId: 'craps-live' } });
    return { authorization: `Bearer ${s.token}` };
  };
  const a = await join(), b = await join();
  const t0 = (await req('/api/v1/live', { headers: a })).body.table;
  assert.ok(['betting', 'closed', 'rolling', 'result'].includes(t0.phase));
  // El jugador no puede tirar: tira el crupier
  assert.equal((await req('/api/v1/table/roll', { method: 'POST', headers: a, body: {} })).status, 409);
  // Esperar la próxima cuenta regresiva y apostar los dos
  const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const t = (await req('/api/v1/live', { headers: a })).body.table; if (fn(t)) return t; await new Promise((r) => setTimeout(r, 150)); } throw new Error('la mesa no avanzó'); };
  const bet = await until((t) => t.phase === 'betting' && t.endsAt - t.serverNow > 1500);
  const amount = (await req('/api/v1/table', { headers: a })).body.analysis ? 100 : 100;
  const kind = bet.tablePhase === 'comeOut' ? { type: 'pass' } : { type: 'field' };
  assert.equal((await req('/api/v1/table/bets', { method: 'POST', headers: a, body: { ...kind, amount } })).status, 200);
  assert.equal((await req('/api/v1/table/bets', { method: 'POST', headers: b, body: { type: 'field', amount } })).status, 200);
  const rolled = await until((t) => (t.phase === 'rolling' || t.phase === 'result') && t.roundNo === bet.roundNo && t.roll);
  // Con la mesa cerrada no se puede apostar
  if (rolled.phase === 'rolling') assert.equal((await req('/api/v1/table/bets', { method: 'POST', headers: a, body: { type: 'field', amount } })).status, 409);
  const ma = (await req('/api/v1/table', { headers: a })).body, mb = (await req('/api/v1/table', { headers: b })).body;
  assert.equal(ma.lastLive.rollId, rolled.roll.id);
  assert.equal(mb.lastLive.rollId, rolled.roll.id);
  assert.deepEqual(ma.lastLive.dice, rolled.roll.dice);
  assert.deepEqual(mb.lastLive.dice, rolled.roll.dice);
  // La ronda de cada jugador se reproduce igual (auditoría)
  const v = await req(`/api/admin/rounds/${mb.lastLive.roundId}/replay`, { headers: ADMIN });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.match, true);
  const lr = await req(`/api/admin/live-rolls/${rolled.roll.id}`, { headers: ADMIN });
  assert.deepEqual(lr.body.dice, rolled.roll.dice);
});
