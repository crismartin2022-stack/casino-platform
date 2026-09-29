// Prueba silenciosa del juego: se ejecuta sola al publicar (y a pedido desde el panel).
// Junta la prueba de matemática/jugadas (en el hilo del simulador) con la revisión del diseño:
// archivos que faltan o pesan demasiado, símbolos sin imagen, sonidos, textos de los carteles,
// botonera, marca y cliente. Devuelve un reporte con lo que pasó, lo que no y cómo arreglarlo.
import { existsSync, statSync } from 'node:fs';
import { one, all, run } from '../db.js';
import { ROOT, DATA_DIR } from '../config.js';
import { selfTestAsync } from '../math/worker.js';
import { getEngine } from '../math/index.js';

const STATIC = ['game-engines', 'play', 'admin-panel', 'client-sdk', 'docs'];
const HEAVY_MB = 15;
const TEXT_VARS = { freeSpins: ['n'], spinOf: ['i', 'n'], respins: ['n'], multiplier: ['x'] };
const AGENT_NAMES = { director: 'Director', designer: 'Diseñador', artist: 'Artista', sound: 'Sonido', math: 'Matemático' };

/** Recorre un objeto y devuelve [ruta, valor] de cada texto que parece un archivo o URL. */
function fileRefs(obj, path = '', out = []) {
  if (typeof obj === 'string') { if (/^(\/|https?:\/\/)/.test(obj) && !/^\/\//.test(obj)) out.push([path, obj]); return out; }
  if (Array.isArray(obj)) obj.forEach((v, i) => fileRefs(v, `${path}[${i}]`, out));
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) fileRefs(v, path ? `${path}.${k}` : k, out);
  return out;
}

function localFile(url) {
  const clean = decodeURIComponent(url.split(/[?#]/)[0]);
  if (clean.includes('..')) return null;
  if (clean.startsWith('/media/')) return `${DATA_DIR}/media/${clean.slice(7)}`;
  const dir = clean.split('/')[1];
  return STATIC.includes(dir) ? `${ROOT}${clean}` : null;
}

export function designChecks(config, { gameId, brandId } = {}) {
  const checks = [];
  const add = (c) => checks.push({ status: 'ok', detail: '', fix: '', agent: null, ...c });
  let engine = null;
  try { engine = getEngine(config.engine); } catch { /* ya lo reporta la prueba de matemática */ }
  const table = engine?.kind === 'table';

  // Cliente del motor
  const client = `${ROOT}/game-engines/engine-${config.engine}/src`;
  add(existsSync(client)
    ? { id: 'client', area: 'Cliente', label: 'Motor gráfico del juego', detail: `engine-${config.engine} disponible.` }
    : { id: 'client', area: 'Cliente', label: 'Motor gráfico del juego', status: 'fail', detail: `No existe game-engines/engine-${config.engine}.`, fix: 'Reinstalar el motor del juego (falta el cliente en el servidor).' });

  // Archivos referenciados (imágenes, GIF, videos, sonidos, tipografías)
  const refs = fileRefs({ theme: config.theme, sounds: config.sounds, symbols: config.symbols });
  const missing = [], heavy = [], external = [];
  let totalMb = 0;
  for (const [p, url] of refs) {
    if (/^https?:/.test(url)) { external.push(p); continue; }
    const f = localFile(url);
    if (!f) continue;
    if (!existsSync(f)) { missing.push([p, url]); continue; }
    const mb = statSync(f).size / 1048576;
    totalMb += mb;
    if (mb > HEAVY_MB) heavy.push(`${p} (${mb.toFixed(1)} MB)`);
  }
  const missSym = missing.filter(([p]) => p.startsWith('symbols'));
  const missOther = missing.filter(([p]) => !p.startsWith('symbols'));
  const symName = (p) => { const i = Number(/^symbols\[(\d+)\]/.exec(p)?.[1]); const s = config.symbols?.[i]; return s ? (s.name || s.id) : p; };
  if (missSym.length) {
    const names = [...new Set(missSym.map(([p]) => symName(p)))];
    add({ id: 'filesSymbols', area: 'Diseño', label: 'Imágenes de símbolos', status: 'fail', detail: `No se encuentra la imagen de: ${names.join(', ')}.`, fix: `Volver a generar o subir la imagen de: ${names.join(', ')}.`, agent: 'artist' });
  }
  add(missOther.length
    ? { id: 'files', area: 'Diseño', label: 'Archivos del diseño', status: 'warn', detail: `No se encuentran ${missOther.length}: ${missOther.map(([p]) => p.replace(/^theme\./, '').replace(/^sounds\./, 'sonido ')).join(', ')}`, fix: 'Volver a subir esos archivos o quitarlos del diseño (se verían vacíos).', agent: missOther.every(([p]) => p.startsWith('sounds')) ? 'sound' : 'artist' }
    : { id: 'files', area: 'Diseño', label: 'Archivos del diseño', detail: `${refs.length - external.length} archivos revisados, todos presentes (${totalMb.toFixed(1)} MB).` });
  if (heavy.length || totalMb > 60) add({ id: 'weight', area: 'Rendimiento', label: 'Peso de la carga', status: 'warn', detail: `${heavy.length ? `Archivos pesados: ${heavy.join(', ')}. ` : ''}Total ${totalMb.toFixed(1)} MB.`, fix: 'Comprimir videos y GIF (videos cortos en WebM, menos de 10 MB) para que cargue rápido en móviles.', agent: 'artist' });
  if (external.length) add({ id: 'external', area: 'Diseño', label: 'Archivos externos', status: 'info', detail: `${external.length} archivos se cargan desde otros sitios y no se pueden verificar: ${external.join(', ')}`, fix: 'Conviene subirlos a la plataforma para que no dependan de otro servidor.', agent: 'artist' });

  // Símbolos sin imagen
  if (!table) {
    const noImg = (config.symbols || []).filter((s) => !s.image).map((s) => s.name || s.id);
    add(noImg.length
      ? { id: 'symbols', area: 'Diseño', label: 'Símbolos con imagen', status: 'warn', detail: `Sin imagen: ${noImg.join(', ')} (se ve un marcador genérico).`, fix: `Generar imágenes para: ${noImg.join(', ')}.`, agent: 'artist' }
      : { id: 'symbols', area: 'Diseño', label: 'Símbolos con imagen', detail: `${(config.symbols || []).length} símbolos, todos con imagen.` });
  }

  // Sonidos básicos
  const need = table ? ['music', 'roll', 'win', 'click'] : ['music', 'spin', 'reelStop', 'win', 'bigWin', 'click'];
  if (!table && engine && ((engine.modes || []).length > 1 || /free|bonus|hold|scatter/i.test(JSON.stringify(config.rules || {})))) need.push('feature');
  const noSnd = need.filter((k) => !config.sounds?.[k]);
  add(noSnd.length
    ? { id: 'sounds', area: 'Sonido', label: 'Sonidos del juego', status: 'warn', detail: `Faltan: ${noSnd.join(', ')}.`, fix: `Crear los sonidos: ${noSnd.join(', ')}.`, agent: 'sound' }
    : { id: 'sounds', area: 'Sonido', label: 'Sonidos del juego', detail: `${Object.keys(config.sounds || {}).length} sonidos configurados.` });

  // Textos de los carteles
  const texts = config.theme?.messages?.texts || {};
  const textIssues = [];
  for (const [k, v] of Object.entries(texts)) {
    if (!v) continue;
    const used = [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const allowed = TEXT_VARS[k] || [];
    const unknown = used.filter((u) => !allowed.includes(u));
    const lost = allowed.filter((a) => !used.includes(a));
    if (unknown.length) textIssues.push(`"${k}" usa {${unknown.join('}, {')}} que no existe`);
    if (lost.length) textIssues.push(`"${k}" no muestra {${lost.join('}, {')}}`);
    if (String(v).length > 60) textIssues.push(`"${k}" es muy largo para el cartel`);
  }
  const th = config.theme?.messages?.thresholds || {};
  if (th.big && th.mega && Number(th.big) >= Number(th.mega)) textIssues.push('el umbral de "Gran premio" es mayor o igual al de "Mega premio"');
  add(textIssues.length
    ? { id: 'texts', area: 'Carteles', label: 'Textos de los carteles', status: 'warn', detail: textIssues.join(' · '), fix: 'Revisar los textos en Diseño → Carteles: {n} = giros, {i} = giro actual, {x} = multiplicador.', agent: 'designer' }
    : { id: 'texts', area: 'Carteles', label: 'Textos de los carteles', detail: Object.keys(texts).length ? `${Object.keys(texts).length} textos personalizados correctos.` : 'Usa los textos por defecto.' });

  // Botonera en diseño libre: todo dentro de la pantalla
  const custom = config.theme?.hud?.layout === 'custom' ? config.theme.hud.custom : null;
  if (custom) {
    const size = { landscape: [1280, 720], portrait: [720, 1280] };
    const out = [];
    for (const [o, [W, H]] of Object.entries(size)) {
      const items = custom[o]?.items || {};
      for (const [k, it] of Object.entries(items)) {
        if (it.hidden) continue;
        const r = (it.s || 0) / 2;
        if (it.x - r < -2 || it.x + r > W + 2 || it.y - r < -2 || it.y + r > H + 2) out.push(`${k} (${o === 'portrait' ? 'móvil' : 'PC'})`);
      }
      if (items.spin?.hidden) out.push(`GIRAR oculto (${o === 'portrait' ? 'móvil' : 'PC'})`);
    }
    add(out.length
      ? { id: 'hud', area: 'Botonera', label: 'Botonera dentro de la pantalla', status: 'warn', detail: `Quedan fuera o cortados: ${out.join(', ')}.`, fix: 'Abrir el editor de la botonera y mover esos botones dentro de la pantalla.', agent: 'designer' }
      : { id: 'hud', area: 'Botonera', label: 'Botonera dentro de la pantalla', detail: 'Todos los botones visibles en PC y móvil.' });
  }

  // Marca
  const brand = brandId ? one('SELECT * FROM brands WHERE id = ?', brandId) : null;
  if (!brand) add({ id: 'brand', area: 'Marca', label: 'Marca del juego', status: 'warn', detail: 'El juego no tiene marca: al cargar se ve una pantalla genérica.', fix: 'Asignar una marca (arriba, junto al nombre del juego) para que aparezca su logo al cargar.' });
  else if (!brand.logo) add({ id: 'brand', area: 'Marca', label: 'Marca del juego', status: 'warn', detail: `La marca ${brand.name} no tiene logotipo: al cargar se ve solo el nombre.`, fix: 'Subir el logotipo en Marcas.' });
  else {
    const f = localFile(brand.logo);
    add(f && !existsSync(f)
      ? { id: 'brand', area: 'Marca', label: 'Marca del juego', status: 'warn', detail: `No se encuentra el logotipo de ${brand.name}.`, fix: 'Volver a subir el logotipo en Marcas.' }
      : { id: 'brand', area: 'Marca', label: 'Marca del juego', detail: `${brand.name}, con logotipo en la pantalla de carga.` });
  }
  if (!config.theme?.title && !config.name) add({ id: 'title', area: 'Diseño', label: 'Nombre del juego', status: 'warn', detail: 'El juego no tiene título.', fix: 'Poner un título al juego.', agent: 'designer' });
  return checks;
}

const rank = { fail: 3, warn: 2, info: 1, ok: 0 };

/** Resume una lista de chequeos en un reporte. */
export function summarize(checks, extra = {}) {
  const count = (s) => checks.filter((c) => c.status === s).length;
  const status = count('fail') ? 'fail' : count('warn') ? 'warn' : 'ok';
  const sorted = [...checks].sort((a, b) => rank[b.status] - rank[a.status]);
  const fixes = sorted.filter((c) => (c.status === 'fail' || c.status === 'warn') && c.fix)
    .map((c) => ({ status: c.status, area: c.area, text: c.fix, agent: c.agent, agentName: c.agent ? AGENT_NAMES[c.agent] : null }));
  const summary = status === 'ok' ? `Pasó la prueba: ${checks.length} chequeos correctos.`
    : status === 'warn' ? `Pasó la prueba con ${count('warn')} aviso(s).`
      : `No pasó la prueba: ${count('fail')} error(es)${count('warn') ? ` y ${count('warn')} aviso(s)` : ''}.`;
  return { status, passed: status !== 'fail', summary, counts: { ok: count('ok'), warn: count('warn'), fail: count('fail'), info: count('info') }, checks: sorted, fixes, ...extra };
}

/** Prueba completa de una configuración (borrador). math: resultado certificado del RTP si ya se simuló. */
export async function runCheck(config, { gameId, brandId, math = null } = {}) {
  const t0 = Date.now();
  const [mech] = await Promise.all([selfTestAsync(config, { math })]);
  const design = designChecks(config, { gameId, brandId });
  return summarize([...mech.checks, ...design], { ms: Date.now() - t0, at: new Date().toISOString() });
}

export function saveCheck(gameId, report, { version = null, source = 'draft', actor = 'admin' } = {}) {
  run('INSERT INTO game_checks (game_id, version, source, status, report, created_by) VALUES (?,?,?,?,?,?)',
    gameId, version, source, report.status, JSON.stringify(report), actor);
  // Se guardan las últimas 20 por juego
  run('DELETE FROM game_checks WHERE game_id = ? AND id NOT IN (SELECT id FROM game_checks WHERE game_id = ? ORDER BY id DESC LIMIT 20)', gameId, gameId);
}

export function listChecks(gameId, limit = 10) {
  return all('SELECT id, version, source, status, report, created_by, created_at FROM game_checks WHERE game_id = ? ORDER BY id DESC LIMIT ?', gameId, limit)
    .map((r) => ({ ...r, report: JSON.parse(r.report) }));
}
