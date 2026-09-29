// Variantes de RTP: la misma versión publicada de un juego con la tabla de pagos ajustada a otro RTP.
// El proveedor (panel de administración) asigna a cada operador el RTP de cada juego; el operador solo lo ve.
//
// Una variante guarda solo la parte matemática (pagos, reglas, tiras) y la huella de la matemática base
// sobre la que se calculó. Así el diseño siempre sale de la versión publicada vigente y, si alguien cambia
// la matemática y republica, las variantes viejas dejan de aplicarse y se recalculan solas.
import { randomBytes } from 'node:crypto';
import { one, all, run, audit } from '../db.js';
import { HttpError } from '../lib/http.js';
import { getEngine, RTP_RANGE } from '../math/index.js';
import { tuneAsync } from '../math/worker.js';
import { getPublished, getVersionConfig, mathHash } from './games.js';

const TUNE_SPINS = () => Number(process.env.VARIANT_TUNE_SPINS || 400_000);

export function overlayOf(cfg) {
  return {
    rtpTarget: cfg.rtpTarget, grid: cfg.grid ?? null, reels: cfg.reels ?? null, freeSpinReels: cfg.freeSpinReels ?? null, rules: cfg.rules,
    pays: Object.fromEntries((cfg.symbols || []).map((s) => [s.id, s.pays ?? null])),
  };
}

export function applyOverlay(config, o) {
  const c = structuredClone(config);
  c.rtpTarget = o.rtpTarget;
  if (o.grid) c.grid = o.grid;
  if (o.reels) c.reels = o.reels;
  if (o.freeSpinReels) c.freeSpinReels = o.freeSpinReels;
  c.rules = o.rules;
  for (const s of c.symbols || []) if (o.pays && o.pays[s.id] != null) s.pays = o.pays[s.id];
  return c;
}

const rowOut = (r) => r && ({
  id: r.id, gameId: r.game_id, rtpTarget: r.rtp_target, baseMathHash: r.base_math_hash, status: r.status, error: r.error,
  math: r.math ? JSON.parse(r.math) : null, createdBy: r.created_by, createdAt: r.created_at,
});

const same = (a, b) => Math.abs(a - b) < 1e-6;

export function listVariants(gameId) {
  const pub = one('SELECT published_version FROM games WHERE id = ?', gameId);
  const hash = pub?.published_version ? mathHash(getVersionConfig(gameId, pub.published_version)) : null;
  return all('SELECT * FROM rtp_variants WHERE game_id = ? ORDER BY rtp_target, created_at DESC', gameId)
    .map((r) => ({ ...rowOut(r), current: r.base_math_hash === hash }));
}

/** Variante lista para la matemática publicada actual (o null). */
export function findVariant(gameId, target, baseHash) {
  return all("SELECT * FROM rtp_variants WHERE game_id = ? AND base_math_hash = ? AND status = 'ready' ORDER BY created_at DESC", gameId, baseHash)
    .find((r) => same(r.rtp_target, target)) || null;
}

export function variantById(id) {
  const r = one('SELECT * FROM rtp_variants WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Variante de RTP no encontrada');
  return r;
}

/** Calcula (en segundo plano) la variante de un juego a un RTP. Devuelve la existente si ya está lista o en curso. */
export function buildVariant(gameId, target, actor = 'admin') {
  target = Number(target);
  if (!(target >= RTP_RANGE[0] && target <= RTP_RANGE[1])) throw new HttpError(400, `El RTP debe estar entre ${RTP_RANGE[0] * 100} % y ${RTP_RANGE[1] * 100} %`);
  const { config } = getPublished(gameId);
  if (getEngine(config.engine).kind === 'table') throw new HttpError(400, 'En los juegos de mesa el RTP sale de los pagos de cada apuesta: no hay variantes');
  const baseHash = mathHash(config);
  const existing = all("SELECT * FROM rtp_variants WHERE game_id = ? AND base_math_hash = ? AND status IN ('ready', 'building')", gameId, baseHash)
    .find((r) => same(r.rtp_target, target));
  if (existing) return rowOut(existing);
  const id = `rv_${randomBytes(8).toString('base64url')}`;
  run('INSERT INTO rtp_variants (id, game_id, rtp_target, base_math_hash, status, created_by) VALUES (?, ?, ?, ?, ?, ?)', id, gameId, target, baseHash, 'building', actor);
  audit(actor, 'rtp_variant.build', gameId, { id, target });
  const cfg = { ...structuredClone(config), rtpTarget: target };
  tuneAsync(cfg, { target, spins: TUNE_SPINS() })
    .then((t) => {
      const f = t.final;
      const math = { rtp: f.rtp, ci: [f.rtpLow, f.rtpHigh], hitFrequency: f.hitFrequency, featureEvery: f.featureEvery, volatility: f.volatility, spins: f.spins, buy: t.buy, buyOptions: t.buyOptions };
      run("UPDATE rtp_variants SET status = 'ready', overlay = ?, math = ?, result_math_hash = ? WHERE id = ?",
        JSON.stringify(overlayOf(t.config)), JSON.stringify(math), mathHash(t.config), id);
    })
    .catch((e) => run("UPDATE rtp_variants SET status = 'failed', error = ? WHERE id = ?", String(e.message).slice(0, 500), id));
  return rowOut(one('SELECT * FROM rtp_variants WHERE id = ?', id));
}

/** Tras publicar: recalcula las variantes que los operadores tienen asignadas si cambió la matemática. */
export function ensureAssignedVariants(gameId, actor = 'system') {
  const g = one('SELECT published_version FROM games WHERE id = ?', gameId);
  if (!g?.published_version) return [];
  const cfg = getVersionConfig(gameId, g.published_version);
  if (getEngine(cfg.engine).kind === 'table') return [];
  const hash = mathHash(cfg);
  const targets = all('SELECT DISTINCT rtp_target FROM operator_games WHERE game_id = ? AND rtp_target IS NOT NULL', gameId).map((r) => r.rtp_target);
  return targets.filter((t) => !findVariant(gameId, t, hash)).map((t) => buildVariant(gameId, t, actor));
}

/**
 * Configuración con la que juega un operador: la versión publicada con su RTP asignado.
 * Si el RTP asignado todavía se está calculando, no se abre el juego (nunca se juega con un RTP distinto al asignado).
 */
export function configForOperator(operatorId, gameId) {
  const { version, config } = getPublished(gameId);
  const og = operatorId ? one('SELECT rtp_target FROM operator_games WHERE operator_id = ? AND game_id = ?', operatorId, gameId) : null;
  if (og?.rtp_target == null || getEngine(config.engine).kind === 'table') return { version, config, variantId: null };
  const v = findVariant(gameId, og.rtp_target, mathHash(config));
  if (!v) {
    buildVariant(gameId, og.rtp_target, 'system');
    throw new HttpError(409, `El juego se está preparando con el RTP asignado (${(og.rtp_target * 100).toFixed(2)} %). Reintenta en unos minutos.`);
  }
  return { version, config: applyOverlay(config, JSON.parse(v.overlay)), variantId: v.id };
}

/** Configuración exacta de una ronda o sesión: versión + variante (si la hubo). */
export function configWithVariant(gameId, version, variantId) {
  const config = getVersionConfig(gameId, version);
  if (!variantId) return config;
  const v = variantById(variantId);
  if (v.base_math_hash !== mathHash(config)) throw new HttpError(409, 'El juego se actualizó: vuelve a abrirlo desde el casino');
  return applyOverlay(config, JSON.parse(v.overlay));
}

/** ¿Puede este operador abrir este juego? Juegos del catálogo habilitados para él, o juegos propios. */
export function operatorCanUse(operatorId, gameId) {
  const g = one('SELECT id, owner_operator_id, published_version, status FROM games WHERE id = ?', gameId);
  if (!g || !g.published_version || g.status !== 'active') return false;
  if (g.owner_operator_id) return g.owner_operator_id === operatorId;
  const og = one('SELECT enabled FROM operator_games WHERE operator_id = ? AND game_id = ?', operatorId, gameId);
  return og ? og.enabled === 1 : true; // sin fila: habilitado por defecto
}
