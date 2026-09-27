// Punto de entrada: un único servicio para Railway que sirve API, juegos y panel.
import { createServer } from 'node:http';
import { Router, HttpError, send, serveStatic, serveFile } from './lib/http.js';
import { config, ROOT, DATA_DIR, providers } from './config.js';
import { registerRoutes } from './routes.js';
import { seedGames } from './services/games.js';
import { retryPendingCredits } from './services/rounds.js';

const router = new Router();
registerRoutes(router);

// ---- Archivos estáticos ----
const STATIC_DIRS = ['game-engines', 'admin-panel', 'client-sdk', 'play', 'docs'];
router.get('/', (req, res) => serveFile(req, res, `${ROOT}/index.html`, { cache: 'no-cache' }) || send(res, 404, 'index.html no encontrado'));
router.get('/admin', (req, res) => serveFile(req, res, `${ROOT}/admin-panel/index.html`, { cache: 'no-cache' }));
router.get('/play/:gameId', (req, res) => serveFile(req, res, `${ROOT}/play/index.html`, { cache: 'no-cache' }));
router.get('/media/*', (req, res, { params }) => serveStatic(req, res, `${DATA_DIR}/media`, params.wild, { cache: 'public, max-age=31536000, immutable' }) || send(res, 404, { error: 'No encontrado' }));
for (const dir of STATIC_DIRS) {
  router.get(`/${dir}/*`, (req, res, { params }) => serveStatic(req, res, `${ROOT}/${dir}`, params.wild, { cache: 'public, max-age=60' }) || send(res, 404, { error: 'No encontrado' }));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = config.corsOrigins.includes('*') || config.corsOrigins.includes(origin);
  if (!allowed) return;
  res.setHeader('access-control-allow-origin', config.corsOrigins.includes('*') ? '*' : origin);
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-api-key');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('vary', 'origin');
}

const server = createServer(async (req, res) => {
  const t0 = Date.now();
  const url = new URL(req.url, 'http://x');
  req.query = Object.fromEntries(url.searchParams);
  res.setHeader('x-content-type-options', 'nosniff');
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    const m = router.match(req.method, url.pathname);
    if (!m) throw new HttpError(404, `Ruta no encontrada: ${req.method} ${url.pathname}`);
    for (const h of m.route.handlers) await h(req, res, { params: m.params });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${url.pathname}`, e);
    send(res, status, { error: status >= 500 && !e.status ? 'Error interno del servidor' : e.message, ...(e.details ? { details: e.details } : {}) });
  } finally {
    if (url.pathname.startsWith('/api/') && process.env.LOG_REQUESTS !== '0') {
      res.on('finish', () => console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - t0}ms`));
    }
  }
});

seedGames();
setInterval(() => retryPendingCredits().catch((e) => console.error('[retry]', e.message)), 60_000).unref();

server.listen(config.port, () => {
  console.log(`🎰 Casino Platform escuchando en :${config.port}`);
  console.log(`   Datos: ${DATA_DIR}`);
  console.log(`   Proveedores IA: ${JSON.stringify(providers())}`);
  if (config.adminTokenGenerated) {
    console.log(`   ⚠️  ADMIN_TOKEN no definido. Token temporal para esta ejecución: ${config.adminToken}`);
  }
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { console.log(`Recibido ${sig}, cerrando…`); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
}
