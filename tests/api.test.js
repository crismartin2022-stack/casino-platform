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
      ANTHROPIC_API_KEY: 'x', VENICE_API_KEY: 'x', ELEVENLABS_API_KEY: 'x', PUBLISH_SIM_SPINS: '150000', PUBLISH_MAX_RTP_DEVIATION: '0.02' },
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

test('lista los 10 juegos publicados', async () => {
  const { body } = await req('/api/v1/games');
  assert.deepEqual(body.map((g) => g.engine).sort(), ['bonus-buy', 'cluster-pays', 'colossal-reels', 'expanding-symbol', 'hold-win',
    'megaways', 'megaways-cascade', 'reel-rush', 'scatter-pays', 'sticky-wilds']);
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
  assert.equal(r.body.cost, 20 * cost);
  assert.equal(r.body.result.bonus.type, 'wheel');
});

test('bonus buy cobra el precio de compra', async () => {
  const { body: s } = await req('/api/v1/demo/sessions', { method: 'POST', body: { gameId: 'bonus-buy' } });
  const { body: sess } = await req('/api/v1/session', { headers: { authorization: `Bearer ${s.token}` } });
  const r = await req('/api/v1/spin', { method: 'POST', headers: { authorization: `Bearer ${s.token}` }, body: { bet: 100, mode: 'buy' } });
  assert.equal(r.body.cost, 100 * sess.game.rules.buyCost);
  assert.ok(r.body.result.freeSpins.spins.length >= 10);
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
