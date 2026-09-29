// Juegos: borrador editable (por humanos o agentes) + versiones publicadas inmutables.
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { db, one, all, run, tx, audit } from '../db.js';
import { ROOT, config as appConfig } from '../config.js';
import { validateConfig, getEngine, ENGINES, buyModesOf } from '../math/index.js';
import { simulateAsync } from '../math/worker.js';
import { runCheck, saveCheck } from './checks.js';
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
    engine: c.engine, grid: c.grid ?? null, reels: c.reels ?? null, freeSpinReels: c.freeSpinReels ?? null, rules: c.rules,
    symbols: (c.symbols || []).map((s) => ({ id: s.id, type: s.type || 'regular', pays: s.pays || {} })),
  };
  return createHash('sha256').update(stableStringify(mathPart)).digest('hex').slice(0, 16);
}

const lockedPart = (c) => `${mathHash(c)}|${c.rtpTarget}|${stableStringify(c.bet ?? null)}|${c.id}`;

export function seedTemplates() {
  const out = {};
  for (const f of readdirSync(SEED_DIR).filter((x) => x.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(`${SEED_DIR}/${f}`, 'utf8'));
    out[c.engine] = c;
  }
  return out;
}

// Juegos de fábrica recalibrados (bonus más frecuente). Se actualizan solos SOLO si nadie los tocó.
const FACTORY_RECALIBRATED = { 'megaways-cascade': 'Recalibración de fábrica: bonus cada ~185 giros', 'scatter-pays': 'Recalibración de fábrica: bonus cada ~185 giros' };

export function seedGames() {
  const templates = seedTemplates();
  for (const c of Object.values(templates)) {
    const existing = one('SELECT * FROM games WHERE id = ?', c.id);
    if (existing && FACTORY_RECALIBRATED[c.id] && existing.published_version === 1) {
      const v1 = one("SELECT config, created_by FROM game_versions WHERE game_id = ? AND version = 1", c.id);
      const { math, ...config } = c;
      const untouched = v1?.created_by === 'system' && stableStringify(JSON.parse(existing.draft)) === stableStringify(JSON.parse(v1.config));
      if (untouched && mathHash(JSON.parse(v1.config)) !== mathHash(config)) {
        tx(() => {
          run('INSERT INTO game_versions (game_id, version, config, math_hash, math, note, created_by) VALUES (?, 2, ?, ?, ?, ?, ?)',
            c.id, JSON.stringify(config), mathHash(config), JSON.stringify(math || null), FACTORY_RECALIBRATED[c.id], 'system');
          run('UPDATE games SET draft = ?, draft_updated_at = ?, published_version = 2 WHERE id = ?', JSON.stringify(config), now(), c.id);
        });
        console.log(`[seed] ${c.id} recalibrado (v2)`);
      }
    }
    if (existing) continue;
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
    id: r.id, engine: r.engine, name: r.name, status: r.status, ownerOperatorId: r.owner_operator_id ?? null, brandId: r.brand_id ?? null,
    publishedVersion: r.published_version,
    publishedAt: pub?.created_at ?? null,
    math: pub?.math ? JSON.parse(pub.math) : null,
    draftUpdatedAt: r.draft_updated_at,
    hasUnpublishedChanges: pub ? stableStringify(draft) !== stableStringify(getVersionConfig(r.id, r.published_version)) : true,
    ...(withDraft ? { draft } : {}),
  };
}

export function listGames({ ownerOperatorId } = {}) {
  const order = "ORDER BY (SELECT name FROM brands b WHERE b.id = games.brand_id) IS NULL, (SELECT name FROM brands b WHERE b.id = games.brand_id) COLLATE NOCASE, name COLLATE NOCASE";
  const rows = ownerOperatorId ? all(`SELECT * FROM games WHERE owner_operator_id = ? ${order}`, ownerOperatorId) : all(`SELECT * FROM games ${order}`);
  return rows.map((r) => rowToGame(r, { withDraft: false }));
}

/** Crea un juego propio de un operador a partir de una configuración publicada (con su RTP ya aplicado). */
export function createOwnedGame(operatorId, { name, base }, actor) {
  const suffix = operatorId.replace(/^op_/, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  let slug = `${(name || base.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'juego'}-${suffix}`;
  for (let i = 2; one('SELECT id FROM games WHERE id = ?', slug); i++) slug = slug.replace(/(-\d+)?$/, `-${i}`);
  const c = { ...structuredClone(base), id: slug, name: name || base.name };
  c.theme = { ...c.theme, title: name || c.theme?.title };
  const brand = one('SELECT brand_id FROM games WHERE id = ?', base.id)?.brand_id ?? null;
  run('INSERT INTO games (id, engine, name, draft, draft_updated_at, owner_operator_id, brand_id) VALUES (?, ?, ?, ?, ?, ?, ?)', slug, c.engine, c.name, JSON.stringify(c), now(), operatorId, brand);
  audit(actor, 'game.create', slug, { engine: c.engine, owner: operatorId, from: base.id });
  return getGame(slug);
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
  const g = one('SELECT engine, draft, owner_operator_id FROM games WHERE id = ?', id);
  if (!g) throw new HttpError(404, `Juego no encontrado: ${id}`);
  if (config.engine !== g.engine) throw new HttpError(400, 'No se puede cambiar el motor de un juego existente');
  // Juegos de un operador: solo el proveedor (admin) puede tocar matemática, RTP y apuestas.
  if (g.owner_operator_id && actor !== 'admin' && lockedPart(config) !== lockedPart(JSON.parse(g.draft))) {
    throw new HttpError(403, 'La matemática, el RTP y las apuestas de este juego las controla el proveedor: solo puedes cambiar diseño, imágenes y sonidos');
  }
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

const gameBrand = (id) => one('SELECT brand_id FROM games WHERE id = ?', id)?.brand_id ?? null;

export async function publish(id, { actor = 'admin', note = '' } = {}) {
  const draft = getDraft(id);
  const errors = validateConfig(draft);
  if (errors.length) throw new HttpError(422, 'No se puede publicar: configuración inválida', errors);
  const hash = mathHash(draft);
  const last = one('SELECT version, math_hash, math FROM game_versions WHERE game_id = ? ORDER BY version DESC LIMIT 1', id);
  let math = last && last.math_hash === hash ? JSON.parse(last.math) : null;
  // Misma matemática ya certificada en otro juego o variante (p. ej. un juego creado por un operador): se reutiliza.
  if (!math) {
    const prev = one('SELECT math FROM game_versions WHERE math_hash = ? AND math IS NOT NULL ORDER BY created_at LIMIT 1', hash)
      || one("SELECT math FROM rtp_variants WHERE result_math_hash = ? AND status = 'ready' AND math IS NOT NULL LIMIT 1", hash);
    if (prev?.math) math = JSON.parse(prev.math);
  }
  if (!math && ENGINES[draft.engine].kind === 'table') {
    const a = ENGINES[draft.engine].analyze(draft);
    math = { rtp: a.rtp, perBet: a.perBet, volatility: a.volatility, hitFrequency: a.hitFrequency, exact: true };
  }
  if (!math) {
    const sim = await simulateAsync(draft, { spins: appConfig.publishSimSpins, seed: Date.now() & 0x7fffffff, timeBudgetMs: 60_000 });
    math = { rtp: sim.rtp, ci: [sim.rtpLow, sim.rtpHigh], hitFrequency: sim.hitFrequency, featureEvery: sim.featureEvery, volatility: sim.volatility, spins: sim.spins };
    const dev = Math.abs(sim.rtp - draft.rtpTarget);
    const inCi = draft.rtpTarget >= sim.rtpLow && draft.rtpTarget <= sim.rtpHigh;
    if (dev > appConfig.publishMaxRtpDeviation && !inCi) {
      const msg = `RTP simulado ${(sim.rtp * 100).toFixed(2)} % fuera de tolerancia respecto al objetivo ${(draft.rtpTarget * 100).toFixed(2)} %. Ajusta la tabla de pagos (agente matemático → tune_rtp).`;
      const check = await runCheck(draft, { gameId: id, brandId: gameBrand(id), math: { ...math, rejected: msg } });
      saveCheck(id, check, { source: 'publish', actor });
      throw new HttpError(422, msg, { ...math, check });
    }
    math.buyOptions = [];
    for (const b of buyModesOf(ENGINES[draft.engine], draft)) {
      const sim2 = await simulateAsync(draft, { spins: 50_000, mode: b.mode, seed: 99 });
      const info = { mode: b.mode, cost: b.get(draft), rtp: sim2.rtp, ci: [sim2.rtpLow, sim2.rtpHigh] };
      math.buyOptions.push(info);
      if (b.mode === 'buy') math.buy = { buyCost: info.cost, rtp: info.rtp, ci: info.ci };
    }
  }
  // Prueba silenciosa de todas las funciones: si algo falla no se publica; los avisos se informan.
  const check = await runCheck(draft, { gameId: id, brandId: gameBrand(id), math });
  if (!check.passed) {
    saveCheck(id, check, { source: 'publish', actor });
    throw new HttpError(422, `No se publicó: ${check.summary}`, { check });
  }
  const version = (last?.version || 0) + 1;
  tx(() => {
    run('INSERT INTO game_versions (game_id, version, config, math_hash, math, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, version, JSON.stringify(draft), hash, JSON.stringify(math), note, actor);
    run('UPDATE games SET published_version = ? WHERE id = ?', version, id);
  });
  saveCheck(id, check, { version, source: 'publish', actor });
  audit(actor, 'game.publish', id, { version, math, mathChanged: !last || last.math_hash !== hash, check: check.status });
  return { version, math, mathChanged: !last || last.math_hash !== hash, check };
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

export function createGame({ engine, name, id, fromGameId, brandId }, actor = 'admin') {
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
  const brand = brandId || (fromGameId ? one('SELECT brand_id FROM games WHERE id = ?', fromGameId)?.brand_id : null) || null;
  if (brand && !one('SELECT id FROM brands WHERE id = ?', brand)) throw new HttpError(404, 'Marca no encontrada');
  run('INSERT INTO games (id, engine, name, draft, draft_updated_at, brand_id) VALUES (?, ?, ?, ?, ?, ?)', slug, engine, c.name, JSON.stringify(c), now(), brand);
  audit(actor, 'game.create', slug, { engine, fromGameId });
  return getGame(slug);
}

export function setStatus(id, status, actor = 'admin') {
  if (!['active', 'disabled'].includes(status)) throw new HttpError(400, 'Estado inválido');
  run('UPDATE games SET status = ? WHERE id = ?', status, id);
  audit(actor, 'game.status', id, { status });
}

export { db };
