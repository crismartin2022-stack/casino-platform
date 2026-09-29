// Assets (imágenes y sonidos) generados por IA o subidos a mano. Se guardan en DATA_DIR/media.
import { writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from '../config.js';
import { one, all, run, audit } from '../db.js';
import { HttpError } from '../lib/http.js';

const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
  'video/mp4': 'mp4', 'video/webm': 'webm',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf',
};
const KIND = (mime) => (mime.startsWith('audio/') ? 'sound' : mime.startsWith('video/') ? 'video' : mime.startsWith('font/') ? 'font' : 'image');

export function sniffMime(buf, fallback) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (buf.slice(0, 3).toString() === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (buf.slice(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (buf.slice(0, 4).toString() === 'GIF8') return 'image/gif';
  if (buf.slice(4, 8).toString() === 'ftyp') return 'video/mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (buf.slice(0, 4).toString() === 'wOF2') return 'font/woff2';
  if (buf.slice(0, 4).toString() === 'wOFF') return 'font/woff';
  if (buf.slice(0, 4).toString() === 'OTTO') return 'font/otf';
  if ((buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) || buf.slice(0, 4).toString() === 'true') return 'font/ttf';
  if (/^\s*<(\?xml|svg)/.test(buf.slice(0, 100).toString())) return 'image/svg+xml';
  return fallback;
}

export function saveAsset(buf, { gameId = null, kind, mime, provider = 'upload', prompt = null, parentId = null, meta = null, actor = 'admin' }) {
  mime = sniffMime(buf, mime);
  const ext = EXT[mime];
  if (!ext) throw new HttpError(415, `Tipo de archivo no permitido: ${mime}`);
  kind = KIND(mime); // el tipo real sale del archivo, no de lo que diga el cliente
  const id = `as_${randomBytes(9).toString('base64url')}`;
  const filename = `${id}.${ext}`;
  writeFileSync(`${DATA_DIR}/media/${filename}`, buf);
  run('INSERT INTO assets (id, game_id, kind, mime, filename, bytes, provider, prompt, parent_id, meta, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, gameId, kind, mime, filename, buf.length, provider, prompt, parentId, meta ? JSON.stringify(meta) : null, actor);
  audit(actor, 'asset.create', id, { gameId, kind, provider });
  return getAsset(id);
}

export function getAsset(id) {
  const a = one('SELECT * FROM assets WHERE id = ?', id);
  if (!a) throw new HttpError(404, 'Asset no encontrado');
  return { ...a, meta: a.meta ? JSON.parse(a.meta) : null, url: `/media/${a.filename}` };
}

export function readAssetBytes(idOrUrl) {
  const id = String(idOrUrl).replace(/^.*\/media\//, '').replace(/\.\w+$/, '');
  const a = getAsset(id);
  return { asset: a, buf: readFileSync(`${DATA_DIR}/media/${a.filename}`) };
}

export function listAssets({ gameId, kind, limit = 100 } = {}) {
  const w = [], p = [];
  if (gameId) { w.push('game_id = ?'); p.push(gameId); }
  if (kind) { w.push('kind = ?'); p.push(kind); }
  return all(`SELECT * FROM assets ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, ...p, limit)
    .map((a) => ({ ...a, meta: a.meta ? JSON.parse(a.meta) : null, url: `/media/${a.filename}` }));
}

// ---- Símbolos provisionales en SVG, para que todos los juegos funcionen sin assets ----
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function placeholderSvg(label = '?', color = '#888888') {
  const c = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#888888';
  const l = String(label).slice(0, 6);
  const size = [...l].length <= 2 ? 96 : l.length <= 4 ? 64 : 48;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs><radialGradient id="g" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient></defs>
<rect x="14" y="14" width="228" height="228" rx="44" fill="${c}"/><rect x="14" y="14" width="228" height="228" rx="44" fill="url(#g)"/>
<rect x="14" y="14" width="228" height="228" rx="44" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="6"/>
<text x="128" y="132" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${size}" fill="#fff" text-anchor="middle" dominant-baseline="middle" stroke="#000" stroke-opacity=".35" stroke-width="3">${esc(l)}</text></svg>`;
}
