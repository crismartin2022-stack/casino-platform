// Mini framework HTTP sin dependencias: router, JSON, estáticos, SSE y errores.
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern
      .replace(/\//g, '\\/')
      .replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })
      .replace(/\*$/, '(.*)') + '\\/?$');
    this.routes.push({ method, re, keys, handlers, wildcard: pattern.endsWith('*') });
    return this;
  }
  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      if (r.wildcard) params.wild = m[r.keys.length + 1] || '';
      return { route: r, params };
    }
    return null;
  }
}

export async function readBody(req, limit = 12 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Cuerpo de la petición demasiado grande');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido'); }
}

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(payload);
}

export const json = (res, body, status = 200) => send(res, status, body);

export function serveFile(req, res, filePath, { cache = 'public, max-age=300' } = {}) {
  let st;
  try { st = statSync(filePath); } catch { return false; }
  if (!st.isFile()) return false;
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const etag = `W/"${st.size}-${st.mtimeMs}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return true; }
  // Rangos (necesarios para reproducir videos en iPhone/Safari y para adelantar)
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
    let end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (!m[1]) start = Math.max(0, start);
    if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return true; }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'cache-control': cache, etag });
    if (req.method === 'HEAD') { res.end(); return true; }
    createReadStream(filePath, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': cache, etag, 'accept-ranges': 'bytes' });
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(filePath).pipe(res);
  return true;
}

/** Sirve un archivo dentro de `root` evitando path traversal. */
export function serveStatic(req, res, root, relPath, opts) {
  const base = resolve(root);
  const target = normalize(join(base, relPath));
  if (!target.startsWith(base)) return false;
  return serveFile(req, res, target, opts);
}

export function sse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no',
  });
  res.write(': conectado\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  res.on('close', () => clearInterval(ping));
  return {
    send(event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); },
    close() { clearInterval(ping); res.end(); },
  };
}

/** Limitador de peticiones en memoria por clave (IP, token...). */
export function rateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n++;
    if (h.n > max) throw new HttpError(429, 'Demasiadas peticiones, espera un momento');
  };
}

export function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}
