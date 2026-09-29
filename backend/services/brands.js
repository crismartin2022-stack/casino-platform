// Marcas (estudios) de juegos: nombre, logotipo y pantalla de carga. Cada juego pertenece a una marca;
// al abrir un juego se muestra el logo de su marca mientras carga, y el panel agrupa los juegos por marca.
import { randomBytes } from 'node:crypto';
import { one, all, run, audit } from '../db.js';
import { HttpError } from '../lib/http.js';

const out = (b) => b && ({
  id: b.id, name: b.name, logo: b.logo, tagline: b.tagline, color: b.color, bg: b.bg, bgImage: b.bg_image,
  loader: b.loader || 'bar', minMs: b.min_ms, createdAt: b.created_at,
  games: one('SELECT COUNT(*) AS n FROM games WHERE brand_id = ?', b.id).n,
});

export const listBrands = () => all('SELECT * FROM brands ORDER BY name COLLATE NOCASE').map(out);

export function getBrand(id) {
  const b = one('SELECT * FROM brands WHERE id = ?', id);
  if (!b) throw new HttpError(404, 'Marca no encontrada');
  return out(b);
}

/** Lo que ve el jugador en la pantalla de carga (sin datos internos). */
export function publicBrand(id) {
  if (!id) return null;
  const b = one('SELECT * FROM brands WHERE id = ?', id);
  return b ? { name: b.name, logo: b.logo, tagline: b.tagline, color: b.color, bg: b.bg, bgImage: b.bg_image, loader: b.loader || 'bar', minMs: b.min_ms } : null;
}

const clean = (p, cur = {}) => {
  const hex = (v) => (v == null || v === '' ? null : /^#[0-9a-f]{3,8}$/i.test(v) ? v : (() => { throw new HttpError(400, `Color inválido: ${v}`); })());
  const name = p.name !== undefined ? String(p.name || '').trim().slice(0, 60) : cur.name;
  if (!name) throw new HttpError(400, 'La marca necesita un nombre');
  const loader = p.loader !== undefined ? p.loader : cur.loader;
  if (loader && !['bar', 'ring', 'pulse'].includes(loader)) throw new HttpError(400, 'Estilo de carga: bar, ring o pulse');
  return {
    name,
    logo: p.logo !== undefined ? (p.logo || null) : cur.logo ?? null,
    tagline: p.tagline !== undefined ? (String(p.tagline || '').slice(0, 80) || null) : cur.tagline ?? null,
    color: p.color !== undefined ? hex(p.color) : cur.color ?? null,
    bg: p.bg !== undefined ? hex(p.bg) : cur.bg ?? null,
    bg_image: p.bgImage !== undefined ? (p.bgImage || null) : cur.bg_image ?? null,
    loader: loader || 'bar',
    min_ms: p.minMs !== undefined ? Math.max(0, Math.min(6000, Math.round(Number(p.minMs) || 0))) : cur.min_ms ?? 1500,
  };
};

export function createBrand(p, actor = 'admin') {
  const b = clean(p);
  if (one('SELECT id FROM brands WHERE name = ? COLLATE NOCASE', b.name)) throw new HttpError(409, 'Ya existe una marca con ese nombre');
  const id = `br_${randomBytes(6).toString('base64url')}`;
  run('INSERT INTO brands (id, name, logo, tagline, color, bg, bg_image, loader, min_ms) VALUES (?,?,?,?,?,?,?,?,?)',
    id, b.name, b.logo, b.tagline, b.color, b.bg, b.bg_image, b.loader, b.min_ms);
  audit(actor, 'brand.create', id, { name: b.name });
  return getBrand(id);
}

export function updateBrand(id, p, actor = 'admin') {
  const cur = one('SELECT * FROM brands WHERE id = ?', id);
  if (!cur) throw new HttpError(404, 'Marca no encontrada');
  const b = clean(p, cur);
  if (one('SELECT id FROM brands WHERE name = ? COLLATE NOCASE AND id <> ?', b.name, id)) throw new HttpError(409, 'Ya existe una marca con ese nombre');
  run('UPDATE brands SET name = ?, logo = ?, tagline = ?, color = ?, bg = ?, bg_image = ?, loader = ?, min_ms = ? WHERE id = ?',
    b.name, b.logo, b.tagline, b.color, b.bg, b.bg_image, b.loader, b.min_ms, id);
  audit(actor, 'brand.update', id, p);
  return getBrand(id);
}

export function deleteBrand(id, actor = 'admin') {
  const b = getBrand(id);
  if (b.games) throw new HttpError(409, `La marca tiene ${b.games} juego(s): pásalos a otra marca antes de borrarla`);
  run('DELETE FROM brands WHERE id = ?', id);
  audit(actor, 'brand.delete', id);
  return { ok: true };
}

export function setGameBrand(gameId, brandId, actor = 'admin') {
  if (!one('SELECT id FROM games WHERE id = ?', gameId)) throw new HttpError(404, 'Juego no encontrado');
  if (brandId && !one('SELECT id FROM brands WHERE id = ?', brandId)) throw new HttpError(404, 'Marca no encontrada');
  run('UPDATE games SET brand_id = ? WHERE id = ?', brandId || null, gameId);
  audit(actor, 'game.brand', gameId, { brandId });
  return { gameId, brandId: brandId || null };
}
