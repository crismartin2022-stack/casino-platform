// Juegos: borrador editable (por humanos o agentes) + versiones publicadas inmutables.
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { db, one, all, run, tx, audit } from '../db.js';
import { ROOT, config as appConfig } from '../config.js';
import { validateConfig, getEngine, ENGINES, buyModesOf } from '../math/index.js';
import { simulateAsync } from '../math/worker.js';
import { HttpError } from '../lib/http.js';

const SEED_DIR = `${ROOT}/backend/games/seed`;
const now = () => new Date().toISOString();

export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Huella de todo lo que afecta al RTP. Si no cambia, publicar no requiere re-simular. */
export function mathHash(c) {
  const mathPart = {
    engine: c.engine, grid: c.grid, reels: c.reels, freeSpinReels: c.freeSpinReels ?? null, rules: c.rules,
    symbols: c.symbols.map((s) => ({ id: s.id, type: s.type || 'regular', pays: s.pays || {} })),
  };
  return createHash('sha256').update(stableStringify(mathPart)).digest('hex').slice(0, 16);
}

export function seedTemplates() {
  const out = {};
  for (const f of readdirSync(SEED_DIR).filter((x) => x.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(`${SEED_DIR}/${f}`, 'utf8'));
    out[c.engine] = c;
  }
  return out;
}

export function seedGames() {
  const templates = seedTemplates();
  for (const c of Object.values(templates)) {
    if (one('SELECT id FROM games WHERE id = ?', c.id)) continue;
    const { math, ...config } = c;
    tx(() => {
      run('INSERT INTO games (id, engine, name, draft, draft_updated_at, published_version) VALUES (?, ?, ?, ?, ?, 1)',
        c.id, c.engine, c.name, JSON.stringify(config), now());
      run('INSERT INTO game_versions (game_id, version, config, math_hash, math, note, created_by) VALUES (?, 1, ?, ?, ?, ?, ?)',
        c.id, JSON.stringify(config), mathHash(config), JSON.stringify(math || null), 'Versión inicial (RTP ajustado)', 'system');
    });
    console.log(`[seed] juego ${c.id} creado`);
  }
}

function rowToGame(r, { withDraft = true } = {}) {
  if (!r) return null;
  const pub = r.published_version ? one('SELECT version, math, created_at, note FROM game_versions WHERE game_id = ? AND version = ?', r.id, r.published_version) : null;
  const draft = JSON.parse(r.draft);
  return {
    id: r.id, engine: r.engine, name: r.name, status: r.status,
    publishedVersion: r.published_version,
    publishedAt: pub?.created_at ?? null,
    math: pub?.math ? JSON.parse(pub.math) : null,
    draftUpdatedAt: r.draft_updated_at,
    hasUnpublishedChanges: pub ? stableStringify(draft) !== stableStringify(getVersionConfig(r.id, r.published_version)) : true,
    ...(withDraft ? { draft } : {}),
  };
}

export function listGames() {
  return all('SELECT * FROM games ORDER BY created_at').map((r) => rowToGame(r, { withDraft: false }));
}

export function getGame(id) {
  const g = rowToGame(one('SELECT * FROM games WHERE id = ?', id));
  if (!g) throw new HttpError(404, `Juego no encontrado: ${id}`);
  return g;
}

export function getVersionConfig(id, version) {
  const r = one('SELECT config FROM game_versions WHERE game_id = ? AND version = ?', id, version);
  if (!r) throw new HttpError(404, `Versión ${version} no encontrada para ${id}`);
  return JSON.parse(r.config);
}

export function getPublished(id) {
  const g = one('SELECT published_version, status FROM games WHERE id = ?', id);
  if (!g) throw new HttpError(404, `Juego no encontrado: ${id}`);
  if (!g.published_version || g.status !== 'active') throw new HttpError(404, 'El juego no está publicado');
  return { version: g.published_version, config: getVersionConfig(id, g.published_version) };
}

export function getDraft(id) {
  const g = one('SELECT draft FROM games WHERE id = ?', id);
  if (!g) throw new HttpError(404, `Juego no encontrado: ${id}`);
  return JSON.parse(g.draft);
}

/** Lo que ve el navegador del jugador: sin tiras de rodillos ni pesos internos. */
export function publicConfig(id, c, version) {
  const { reels, freeSpinReels, ...rest } = structuredClone(c);
  const rules = { ...rest.rules };
  for (const k of ['rowWeights', 'coinValues', 'colossalSymbols', 'colossalSizes', 'landChance', 'colossalChance',
    'multiplierValues', 'mysteryWeights', 'expandWeights', 'specialCoins', 'specialChance', 'bonusMenu']) delete rules[k];
  if (c.rules?.coinValues) rules.coinValues = c.rules.coinValues.filter((v) => v.value != null).map((v) => v.value);
  if (c.rules?.multiplierValues) rules.multiplierValues = c.rules.multiplierValues.map((m) => m.value);
  // Menú de compra: nombre, precio y lo necesario para dibujar (sin probabilidades)
  if (c.rules?.bonusMenu) {
    rules.bonusMenu = Object.fromEntries(Object.entries(c.rules.bonusMenu).filter(([, o]) => o?.enabled).map(([k, o]) => [k, {
      name: o.name, cost: o.cost, freeSpins: o.freeSpins, spins: o.spins, multStep: o.multStep, picks: o.picks, tiles: o.tiles,
      segments: o.segments?.map((x) => x.value), prizes: o.prizes?.map((x) => x.value),
    }]));
  }
  return { id, version, ...rest, rules };
}

export function saveDraft(id, config, actor = 'admin', { allowInvalid = false } = {}) {
  const g = one('SELECT engine FROM games WHERE id = ?', id);
  if (!g) throw new HttpError(404, `Juego no encontrado: ${id}`);
  if (config.engine !== g.engine) throw new HttpError(400, 'No se puede cambiar el motor de un juego existente');
  const errors = validateConfig(config);
  if (errors.length && !allowInvalid) throw new HttpError(422, 'Configuración inválida', errors);
  run('UPDATE games SET draft = ?, name = ?, draft_updated_at = ? WHERE id = ?', JSON.stringify(config), config.name || id, now(), id);
  audit(actor, 'draft.save', id, { errors });
  return { errors };
}

// ---- Edición por rutas: "theme.palette.primary", "symbols.cherry.image", "rules.freeSpins.3" ----
function resolveSegment(obj, seg) {
  if (Array.isArray(obj)) {
    if (/^\d+$/.test(seg)) return Number(seg);
    const i = obj.findIndex((x) => x && x.id === seg);
    if (i === -1) throw new HttpError(400, `No existe un elemento con id "${seg}"`);
    return i;
  }
  return seg;
}

export function applyOps(config, ops) {
  const c = structuredClone(config);
  for (const op of ops) {
    const segs = String(op.path).split('.').filter(Boolean);
    if (!segs.length) throw new HttpError(400, 'Ruta vacía');
    let cur = c;
    for (let i = 0; i < segs.length - 1; i++) {
      const k = resolveSegment(cur, segs[i]);
      if (cur[k] == null) cur[k] = /^\d+$/.test(segs[i + 1]) ? [] : {};
      cur = cur[k];
    }
    const last = resolveSegment(cur, segs[segs.length - 1]);
    switch (op.op || 'set') {
      case 'set': cur[last] = op.value; break;
      case 'delete':
        if (Array.isArray(cur)) cur.splice(last, 1); else delete cur[last];
        break;
      case 'append':
        if (!Array.isArray(cur[last])) throw new HttpError(400, `${op.path} no es una lista`);
        cur[last].push(op.value); break;
      case 'merge':
        cur[last] = { ...(cur[last] || {}), ...op.value }; break;
      default: throw new HttpError(400, `Operación desconocida: ${op.op}`);
    }
  }
  return c;
}

export function patchDraft(id, ops, actor = 'admin') {
  const next = applyOps(getDraft(id), ops);
  const { errors } = saveDraft(id, next, actor);
  return { config: next, errors };
}

export async function publish(id, { actor = 'admin', note = '' } = {}) {
  const draft = getDraft(id);
  const errors = validateConfig(draft);
  if (errors.length) throw new HttpError(422, 'No se puede publicar: configuración inválida', errors);
  const hash = mathHash(draft);
  const last = one('SELECT version, math_hash, math FROM game_versions WHERE game_id = ? ORDER BY version DESC LIMIT 1', id);
  let math = last && last.math_hash === hash ? JSON.parse(last.math) : null;
  if (!math) {
    const sim = await simulateAsync(draft, { spins: appConfig.publishSimSpins, seed: Date.now() & 0x7fffffff, timeBudgetMs: 60_000 });
    math = { rtp: sim.rtp, ci: [sim.rtpLow, sim.rtpHigh], hitFrequency: sim.hitFrequency, featureEvery: sim.featureEvery, volatility: sim.volatility, spins: sim.spins };
    const dev = Math.abs(sim.rtp - draft.rtpTarget);
    const inCi = draft.rtpTarget >= sim.rtpLow && draft.rtpTarget <= sim.rtpHigh;
    if (dev > appConfig.publishMaxRtpDeviation && !inCi) {
      throw new HttpError(422, `RTP simulado ${(sim.rtp * 100).toFixed(2)} % fuera de tolerancia respecto al objetivo ${(draft.rtpTarget * 100).toFixed(2)} %. Ajusta la tabla de pagos (agente matemático → tune_rtp).`, math);
    }
    math.buyOptions = [];
    for (const b of buyModesOf(ENGINES[draft.engine], draft)) {
      const sim2 = await simulateAsync(draft, { spins: 50_000, mode: b.mode, seed: 99 });
      const info = { mode: b.mode, cost: b.get(draft), rtp: sim2.rtp, ci: [sim2.rtpLow, sim2.rtpHigh] };
      math.buyOptions.push(info);
      if (b.mode === 'buy') math.buy = { buyCost: info.cost, rtp: info.rtp, ci: info.ci };
    }
  }
  const version = (last?.version || 0) + 1;
  tx(() => {
    run('INSERT INTO game_versions (game_id, version, config, math_hash, math, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, version, JSON.stringify(draft), hash, JSON.stringify(math), note, actor);
    run('UPDATE games SET published_version = ? WHERE id = ?', version, id);
  });
  audit(actor, 'game.publish', id, { version, math, mathChanged: !last || last.math_hash !== hash });
  return { version, math, mathChanged: !last || last.math_hash !== hash };
}

export function listVersions(id) {
  return all('SELECT version, math_hash, math, note, created_by, created_at FROM game_versions WHERE game_id = ? ORDER BY version DESC', id)
    .map((v) => ({ ...v, math: v.math ? JSON.parse(v.math) : null }));
}

export function restoreVersion(id, version, actor = 'admin') {
  const c = getVersionConfig(id, version);
  saveDraft(id, c, actor, { allowInvalid: true });
  audit(actor, 'draft.restore', id, { version });
  return c;
}

export function createGame({ engine, name, id, fromGameId }, actor = 'admin') {
  getEngine(engine);
  const slug = (id || name || engine).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new HttpError(400, 'Nombre inválido');
  if (one('SELECT id FROM games WHERE id = ?', slug)) throw new HttpError(409, `Ya existe un juego con id ${slug}`);
  let base;
  if (fromGameId) base = getDraft(fromGameId);
  else { const { math, ...t } = seedTemplates()[engine]; base = t; }
  if (base.engine !== engine) throw new HttpError(400, 'El juego base usa otro motor');
  const c = { ...structuredClone(base), id: slug, name: name || base.name };
  c.theme = { ...c.theme, title: name || c.theme.title };
  run('INSERT INTO games (id, engine, name, draft, draft_updated_at) VALUES (?, ?, ?, ?, ?)', slug, engine, c.name, JSON.stringify(c), now());
  audit(actor, 'game.create', slug, { engine, fromGameId });
  return getGame(slug);
}

export function setStatus(id, status, actor = 'admin') {
  if (!['active', 'disabled'].includes(status)) throw new HttpError(400, 'Estado inválido');
  run('UPDATE games SET status = ? WHERE id = ?', status, id);
  audit(actor, 'game.status', id, { status });
}

export { db };
