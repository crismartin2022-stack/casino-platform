// Panel de administración: juegos, agentes de IA, diseño, sonido, matemática, versiones y operadores.
// El mismo panel sirve el PORTAL DEL OPERADOR en /operator (login con email): reportes, jugadas, jugadores,
// catálogo con su RTP, integración, usuarios y —si el proveedor lo habilita— sus propios juegos (sin matemática).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(2)} %`);
const money = (c) => (c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const OP_MODE = location.pathname.replace(/\/$/, '') === '/operator';
const TOKEN_KEY = OP_MODE ? 'portalToken' : 'adminToken';
const S = {
  token: sessionStorage.getItem(TOKEN_KEY) || '',
  me: null, games: [], gameId: null, game: null, tab: 'agents', platformView: null,
  runId: null, runStream: null, previewToken: null, agentsBusy: false, engines: {},
};
const engineInfo = (id) => S.engines[id] || { paysBy: 'ways', gridLimits: { reels: [3, 8], rows: [3, 6] }, variableRows: false };

// ------------------------------------------------------------------ API
async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${S.token}`, ...(body && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error(data.error || 'Sesión inválida'); }
  if (!res.ok) {
    const e = new Error(data.error || `Error ${res.status}`);
    e.details = data.details;
    throw e;
  }
  return data;
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${err ? ' err' : ''}`;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, err ? 7000 : 3000);
}

const guard = (fn) => async (...a) => {
  try { return await fn(...a); } catch (e) {
    toast(e.message + (e.details ? `: ${Array.isArray(e.details) ? e.details.join(' · ') : JSON.stringify(e.details)}` : ''), true);
  }
};

async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

// ------------------------------------------------------------------ Login
function logout() {
  if (OP_MODE && S.token) fetch('/api/portal/logout', { method: 'POST', headers: { authorization: `Bearer ${S.token}` } }).catch(() => {});
  sessionStorage.removeItem(TOKEN_KEY);
  S.token = '';
  $('#app').hidden = true;
  $('#login').hidden = false;
}

if (OP_MODE) {
  document.title = 'Portal del operador';
  $('#loginTitle').textContent = '🎰 Portal del operador';
  $('#loginHint').textContent = 'Entra con el email y la contraseña que te dio tu proveedor.';
  $('#emailInput').hidden = false;
  $('#emailInput').required = true;
  $('#tokenInput').placeholder = 'Contraseña';
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    if (OP_MODE) {
      const res = await fetch('/api/portal/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: $('#emailInput').value, password: $('#tokenInput').value }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Error ${res.status}`);
      S.token = d.token;
    } else S.token = $('#tokenInput').value.trim();
    await start();
    sessionStorage.setItem(TOKEN_KEY, S.token);
    $('#tokenInput').value = '';
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

const isOp = () => S.me?.kind === 'operator';
const can = (perm) => !isOp() || S.me.perms.includes(perm);

async function start() {
  S.me = await api('/api/admin/me');
  if (OP_MODE !== isOp()) { logout(); throw new Error(OP_MODE ? 'Usa tu email y contraseña de operador' : 'Este es el panel del proveedor: los operadores entran por /operator'); }
  $('#login').hidden = true;
  $('#app').hidden = false;
  const p = S.me.providers;
  $('#providers').innerHTML = isOp()
    ? `<div>${esc(S.me.user.email)}</div><div class="muted">${esc({ admin: 'Administrador', finance: 'Finanzas', support: 'Soporte' }[S.me.user.role] || S.me.user.role)}</div>`
    : [['anthropic', 'Claude (agentes)'], ['venice', 'Venice (imágenes)'], ['elevenlabs', 'ElevenLabs (sonido)']]
      .map(([k, l]) => `<div><span class="dot ${p[k] ? 'ok' : ''}"></span>${l}</div>`).join('');
  S.engines = Object.fromEntries((await (await fetch('/api/v1/engines')).json()).map((e) => [e.id, e]));
  if (isOp()) setupOperatorShell();
  await loadGames();
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (S.games.some((g) => g.id === fromHash)) selectGame(fromHash);
  else if (isOp()) { openView(fromHash && VIEWS[fromHash] ? fromHash : 'summary'); if (S.me.user.mustChangePassword) askNewPassword(); }
  else openView('home');
}

/** Portal del operador: marca, menú y pestañas según sus permisos. */
function setupOperatorShell() {
  const L = S.me.limits;
  $('#brand').textContent = `🎰 ${S.me.operator.name}`;
  $('#gamesTitle').textContent = 'Mis juegos';
  $('#gamesTitle').hidden = !L.canCreateGames && !L.usedGames;
  $('#newGameBtn').hidden = !(L.canCreateGames && can('games'));
  $('#newGameBtn').textContent = `＋ Nuevo juego (${L.usedGames} de ${L.maxGames})`;
  $('#platformTitle').textContent = 'Mi casino';
  $('#homeNav').hidden = true;
  const items = [['summary', '📊 Resumen'], ['plays', '🎲 Jugadas'], ['players', '👤 Jugadores'], ['catalog', '🎰 Catálogo de juegos'],
    ['integration', '🔌 Integración'], ...(can('users') ? [['users', '👥 Usuarios']] : []), ['account', '🔑 Mi cuenta']];
  $('#platformNav').innerHTML = items.map(([k, l]) => `<a data-view="${k}">${l}</a>`).join('');
  // Pestañas del editor: sin matemática ni JSON; agentes solo si el proveedor los habilitó
  $('#tabs button[data-tab="math"]').hidden = true;
  $('#tabs button[data-tab="json"]').hidden = true;
  $('#tabs button[data-tab="agents"]').hidden = !L.canUseAgents;
  if (!L.canUseAgents) S.tab = 'design';
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
}

// ------------------------------------------------------------------ Juegos
async function loadGames() {
  [S.games, S.brands] = await Promise.all([api('/api/admin/games'), api('/api/admin/brands').catch(() => [])]);
  // Tres grupos: Motores (juegos de fábrica, uno por motor), Borradores (nunca publicados) y Creados (publicados, los más nuevos primero)
  const brandOf = (id) => S.brands.find((b) => b.id === id);
  const item = (g) => `<a data-game="${esc(g.id)}" class="${g.id === S.gameId ? 'on' : ''}">
    ${esc(g.name)}<small class="gl-eng">${esc(S.engines[g.engine]?.name || g.engine)}${S.engines[g.engine]?.card?.tagline ? ` · ${esc(S.engines[g.engine].card.tagline)}` : ''}</small><small>${g.publishedVersion ? `v${g.publishedVersion}` : 'sin publicar'}${g.publishedVersion && g.hasUnpublishedChanges ? ' · <b class="gl-pend">cambios sin publicar</b>' : ''}${g.status !== 'active' ? ' · desactivado' : ''}${g.brandId && brandOf(g.brandId) ? ` · 🏷 ${esc(brandOf(g.brandId).name)}` : ''}</small></a>`;
  const by = (k) => (a, b) => String(b[k] || '').localeCompare(String(a[k] || ''));
  const groups = [
    { id: 'engines', title: 'Motores', icon: '⚙', list: S.games.filter((g) => g.factory).sort((a, b) => a.name.localeCompare(b.name, 'es')) },
    { id: 'drafts', title: 'Borradores', icon: '📝', list: S.games.filter((g) => !g.factory && !g.publishedVersion).sort(by('draftUpdatedAt')) },
    { id: 'created', title: 'Creados', icon: '⭐', list: S.games.filter((g) => !g.factory && g.publishedVersion).sort(by('createdAt')) },
  ];
  let folded = {};
  try { folded = JSON.parse(localStorage.getItem('gl-folded') || '{}'); } catch {}
  $('#gameList').innerHTML = groups.filter((gr) => gr.list.length || gr.id !== 'engines').map((gr) => {
    const open = !folded[gr.id] || gr.list.some((g) => g.id === S.gameId);
    return `<div class="gl-group ${open ? '' : 'closed'}" data-group="${gr.id}"><button type="button" class="gl-head" aria-expanded="${open}"><span>${gr.icon} ${gr.title}</span><em>${gr.list.length}</em></button>
      <div class="gl-items">${gr.list.length ? gr.list.map(item).join('') : `<p class="muted gl-empty">${gr.id === 'drafts' ? 'Sin borradores' : 'Todavía no creaste juegos'}</p>`}</div></div>`;
  }).join('');
  $$('#gameList .gl-head').forEach((btn) => btn.addEventListener('click', () => {
    const g = btn.closest('.gl-group');
    const closed = g.classList.toggle('closed');
    btn.setAttribute('aria-expanded', String(!closed));
    folded[g.dataset.group] = closed;
    try { localStorage.setItem('gl-folded', JSON.stringify(folded)); } catch {}
  }));
  $$('#gameList a').forEach((a) => a.addEventListener('click', () => selectGame(a.dataset.game)));
}

const selectGame = guard(async (id) => {
  S.gameId = id;
  S.platformView = null;
  S.runId = null;
  S.previewToken = null;
  location.hash = id;
  await refreshGame();
  $$('#gameList a').forEach((a) => a.classList.toggle('on', a.dataset.game === id));
  $$('.side nav a[data-view]').forEach((a) => a.classList.remove('on'));
  $('#gameBar').hidden = false;
  $('#tabs').hidden = false;
  renderTab();
});

async function refreshGame() {
  const [game, checks] = await Promise.all([api(`/api/admin/games/${encodeURIComponent(S.gameId)}`), api(`/api/admin/games/${encodeURIComponent(S.gameId)}/checks`).catch(() => [])]);
  S.game = game;
  S.lastCheck = checks[0] || null;
  const g = S.game;
  const ck = S.lastCheck;
  $('#gameTitle').textContent = g.name;
  $('#gameMeta').innerHTML = `<span class="badge">${esc(g.engine)}</span>
    <span class="badge ${g.publishedVersion ? 'ok' : 'warn'}">${g.publishedVersion ? `publicado v${g.publishedVersion}` : 'sin publicar'}</span>
    ${g.hasUnpublishedChanges ? '<span class="badge warn">borrador con cambios</span>' : ''}
    ${g.math ? `<span class="badge">RTP ${pct(g.math.rtp)} · volatilidad ${esc(g.math.volatility)}</span>` : ''}
    ${ck ? `<span class="badge ck ${ck.status}" id="lastCheck" title="Ver la última prueba (${esc(ck.created_at)})">🩺 ${ck.status === 'ok' ? 'prueba OK' : ck.status === 'warn' ? `prueba: ${ck.report.counts.warn} aviso(s)` : `prueba: ${ck.report.counts.fail} error(es)`}${ck.version ? ` · v${ck.version}` : ck.source === 'draft' ? ' · borrador' : ''}</span>` : ''}
    ${isOp() ? '' : `<select id="gameBrand" class="brand-select" title="Marca del juego"><option value="">🏷 Sin marca</option>${(S.brands || []).map((b) => `<option value="${esc(b.id)}" ${g.brandId === b.id ? 'selected' : ''}>🏷 ${esc(b.name)}</option>`).join('')}</select>`}`;
  $('#lastCheck')?.addEventListener('click', () => showCheck(ck.report, { title: ck.version ? `Prueba de la v${ck.version}` : 'Última prueba' }));
  $('#gameBrand')?.addEventListener('change', guard(async (e) => {
    await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/brand`, { method: 'PUT', body: { brandId: e.target.value || null } });
    toast('Marca del juego actualizada');
    await loadGames();
  }));
}

async function patchDraft(ops, msg = 'Borrador guardado') {
  const r = await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/draft`, { method: 'PATCH', body: { ops } });
  await refreshGame();
  toast(msg);
  reloadPreview();
  return r;
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  S.tab = b.dataset.tab;
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  renderTab();
});

function renderTab() {
  if ($(`#tabs button[data-tab="${S.tab}"]`)?.hidden) { S.tab = 'design'; $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab)); }
  const fn = { agents: tabAgents, design: tabDesign, symbols: tabSymbols, sounds: tabSounds, math: tabMath, assets: tabAssets, json: tabJson, versions: tabVersions }[S.tab];
  const v = $('#view');
  v.innerHTML = '';
  guard(async (el) => { await fn(el); if (S.tab === 'math' && !isOp()) { featureCard(el); currencyCard(el); } })(v);
}

// ------------------------------------------------------------------ Vista previa
$('#previewBtn').addEventListener('click', guard(async () => {
  $('#previewPane').hidden = false;
  await reloadPreview(true);
}));
$('#reloadPreview').addEventListener('click', () => reloadPreview(true));
// En el celular conviene jugar la vista previa en su propia pestaña: ocupa toda la pantalla y no se amplía por error
$('#openPreview').addEventListener('click', guard(async () => {
  if (!S.previewToken) S.previewToken = (await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/preview-session`, { method: 'POST', body: { currency: S.previewCur } })).token;
  window.open(`/play/${encodeURIComponent(S.gameId)}?token=${encodeURIComponent(S.previewToken)}&t=${Date.now()}`, '_blank');
}));
$('#closePreview').addEventListener('click', () => { $('#previewPane').hidden = true; $('#previewFrame').src = 'about:blank'; });

/** Monedas para la vista previa: la base del juego y las que tienen fichas propias (💱 Apuestas por moneda). */
function fillPreviewCurrencies() {
  const B = S.game?.draft?.bet || {};
  const list = [String(B.currency || 'USD').toUpperCase(), ...Object.keys(B.byCurrency || {}).map((c) => c.toUpperCase())].filter((c, i, a) => a.indexOf(c) === i);
  if (!list.includes(S.previewCur)) S.previewCur = list[0];
  $('#previewCur').innerHTML = list.map((c) => `<option ${c === S.previewCur ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('#previewCur').hidden = list.length < 2;
}
$('#previewCur').addEventListener('change', (e) => { S.previewCur = e.target.value; reloadPreview(true); });

async function reloadPreview(force = false) {
  if ($('#previewPane').hidden && !force) return;
  fillPreviewCurrencies();
  if (!S.previewToken || force) {
    const s = await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/preview-session`, { method: 'POST', body: { currency: S.previewCur } });
    S.previewToken = s.token;
  }
  $('#previewFrame').src = `/play/${encodeURIComponent(S.gameId)}?token=${encodeURIComponent(S.previewToken)}&t=${Date.now()}`;
}

// ------------------------------------------------------------------ Publicar
$('#publishBtn').addEventListener('click', guard(async () => {
  const note = prompt('Nota de la versión (qué cambió):', '');
  if (note === null) return;
  const btn = $('#publishBtn');
  let r;
  toast('⏳ Certificando el RTP y probando todas las funciones (puede tardar hasta ~1 minuto)…');
  try {
    r = await busy(btn, () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/publish`, { method: 'POST', body: { note } }));
  } catch (e) {
    // La prueba silenciosa encontró errores: no se publicó. Se muestra el reporte con los arreglos sugeridos.
    if (e.details?.check) { showCheck(e.details.check, { title: 'No se publicó', publishing: true }); await refreshGame(); return; }
    throw e;
  }
  toast(`Publicada v${r.version} · RTP ${pct(r.math.rtp)}${r.mathChanged && !isOp() ? ' (matemática re-simulada)' : ''}${r.rtpVariantsRebuilding ? ` · recalculando ${r.rtpVariantsRebuilding} RTP de operadores` : ''}`);
  if (r.check) showCheck(r.check, { title: `Publicada v${r.version}`, publishing: true });
  await refreshGame();
  await loadGames();
  if (S.tab === 'versions') renderTab();
}));

// ------------------------------------------------------------------ Prueba silenciosa
$('#checkBtn').addEventListener('click', guard(async () => {
  const r = await busy($('#checkBtn'), () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/check`, { method: 'POST' }));
  showCheck(r, { title: 'Prueba del borrador' });
  await refreshGame();
}));

const CHECK_ICON = { ok: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️' };
const CHECK_HEAD = { ok: 'Pasó la prueba', warn: 'Pasó la prueba con avisos', fail: 'No pasó la prueba' };

/** Reporte de la prueba silenciosa: resultado, chequeos por área y arreglos sugeridos (se pueden enviar al Director). */
function showCheck(rep, { title = 'Prueba del juego', publishing = false } = {}) {
  const areas = [...new Set(rep.checks.map((c) => c.area))];
  const body = `<div class="check-report">
    <div class="check-head ${rep.status}"><span class="big">${CHECK_ICON[rep.status]}</span>
      <div><b>${CHECK_HEAD[rep.status]}</b><div class="muted">${esc(rep.summary)}${publishing && rep.status === 'fail' ? ' El juego en vivo no cambió.' : ''} · ${rep.counts.ok} correctos · ${rep.counts.warn} avisos · ${rep.counts.fail} errores · ${(rep.ms / 1000).toFixed(1)} s</div></div></div>
    ${rep.fixes.length ? `<div class="card check-fixes"><h3>Arreglos sugeridos</h3><ol>${rep.fixes.map((f) => `<li class="${f.status}">${CHECK_ICON[f.status]} <b>${esc(f.area)}:</b> ${esc(f.text)}${f.agentName ? ` <span class="badge">${esc(f.agentName)}</span>` : ''}</li>`).join('')}</ol>
      <div class="row"><button class="primary" id="ckSend">🎬 Pedir los arreglos al Director</button><span class="muted">Los agentes corrigen el borrador; después vuelve a probar y publicar.</span></div></div>` : ''}
    ${areas.map((a) => `<div class="check-area"><h4>${esc(a)}</h4>${rep.checks.filter((c) => c.area === a).map((c) => `<div class="check-row ${c.status}"><span>${CHECK_ICON[c.status]}</span><div><b>${esc(c.label)}</b><div class="muted">${esc(c.detail)}</div></div></div>`).join('')}</div>`).join('')}
  </div>`;
  openPicker(title, body, (root, close) => {
    $('#ckSend', root)?.addEventListener('click', guard(async () => {
      const prompt = `La prueba automática del juego encontró esto. Corrige el borrador:\n${rep.fixes.map((f, i) => `${i + 1}. [${f.area}${f.agentName ? ` → ${f.agentName}` : ''}] ${f.text}`).join('\n')}`;
      const { runId } = await api('/api/admin/agents/runs', { method: 'POST', body: { gameId: S.gameId, prompt, agent: 'director' } });
      close();
      S.runId = runId;
      S.tab = 'agents';
      $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'agents'));
      renderTab();
      toast('Arreglos enviados al Director');
    }));
  });
}


// ---- Fichas para elegir motor: qué hace, cuadrícula, pagos, bonus, volatilidad, frecuencia y compra ----
const VOL_LABEL = { baja: 'Volatilidad baja', media: 'Volatilidad media', alta: 'Volatilidad alta', 'muy alta': 'Volatilidad muy alta' };
/** Contenido de la ficha de un motor: qué hace, cuadrícula, pagos, bonus, funciones y números de la semilla. */
function engineCardBody(e) {
  const c = e.card || {};
  const buys = (c.buy || []).filter((b) => b.mode !== 'ante');
  const badges = [
    c.volatility ? VOL_LABEL[c.volatility] || `Volatilidad ${c.volatility}` : null,
    c.featureEvery ? `Bonus cada ~${c.featureEvery} giros` : null,
    c.hitFrequency ? `Premio en ${Math.round(c.hitFrequency * 100)} % de los giros` : null,
    buys.length ? `Compra desde ${Math.min(...buys.map((x) => x.cost))}×` : null,
    (c.buy || []).some((b) => b.mode === 'ante') ? 'Doble chance' : null,
  ].filter(Boolean);
  return `<b class="eng-name">${esc(e.name)}</b>${c.tagline ? `<span class="eng-tag">${esc(c.tagline)}</span>` : ''}
    <span class="eng-desc">${esc(e.description || '')}</span>
    <dl>${c.grid ? `<dt>Cuadrícula</dt><dd>${esc(c.grid)}</dd>` : ''}${c.pays ? `<dt>Paga por</dt><dd>${esc(c.pays)}</dd>` : ''}${c.bonus ? `<dt>Bonus</dt><dd>${esc(c.bonus)}</dd>` : ''}</dl>
    ${c.features?.length ? `<ul>${c.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <span class="eng-badges">${badges.map((b) => `<i>${esc(b)}</i>`).join('')}</span>`;
}
function enginePicker(engines, inputId, selected = engines[0]?.id) {
  return `<input type="hidden" id="${inputId}" value="${esc(selected || '')}" />
    <div class="eng-cards" data-for="${inputId}">${engines.map((e) => `<button type="button" class="eng-card ${e.id === selected ? 'sel' : ''}" data-engine="${esc(e.id)}">${engineCardBody(e)}</button>`).join('')}</div>`;
}
function bindEnginePicker(root, inputId, onChange) {
  const box = $(`.eng-cards[data-for="${inputId}"]`, root);
  box?.addEventListener('click', (e) => {
    const card = e.target.closest('.eng-card');
    if (!card) return;
    for (const x of $$('.eng-card', box)) x.classList.toggle('sel', x === card);
    $(`#${inputId}`, root).value = card.dataset.engine;
    onChange?.(card.dataset.engine);
  });
}

$('#newGameBtn').addEventListener('click', () => openNewGame());
const openNewGame = guard(async (preset = null) => {
  if (isOp()) return newOwnGame();
  const engines = await (await fetch('/api/v1/engines')).json();
  openPicker('Nuevo juego', `<div class="stack">
    <div><label>Nombre</label><input id="ngName" placeholder="Ej. Faraón Dorado" /></div>
    <div><label>Motor — toca una ficha para elegirlo</label>${enginePicker(engines, 'ngEngine', preset || engines[0]?.id)}</div>
    <div><label>Marca</label><select id="ngBrand"><option value="">— Sin marca —</option>${(S.brands || []).map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></div>
    <div><label>Copiar diseño de (opcional)</label><select id="ngFrom"><option value="">— Plantilla del motor —</option>${S.games.map((g) => `<option value="${esc(g.id)}" data-engine="${esc(g.engine)}">${esc(g.name)}</option>`).join('')}</select></div>
    ${uiPicker()}
    <button class="primary" id="ngCreate">Crear</button></div>`, (root, close) => {
    bindUiPicker(root);
    bindEnginePicker(root, 'ngEngine');
    $('#ngCreate', root).addEventListener('click', guard(async () => {
      const engine = $('#ngEngine', root).value;
      const from = $('#ngFrom', root).selectedOptions[0];
      if (from.value && from.dataset.engine !== engine) throw new Error('El juego a copiar debe usar el mismo motor');
      const g = await api('/api/admin/games', { method: 'POST', body: { name: $('#ngName', root).value, engine, fromGameId: from.value || undefined, brandId: $('#ngBrand', root).value || undefined } });
      await applyUiChoice(root, g.id, engine);
      close();
      await loadGames();
      selectGame(g.id);
      toast('Juego creado como borrador. Pide a los agentes que lo diseñen y luego publícalo.');
    }));
  });
});

// ---- Diseño libre: tablero de la botonera y editor visual ----
function customHudCard(t) {
  const C = t.hud?.custom || {};
  const B = C.board || {};
  return `<div class="card stack" id="chCard"><h3 style="margin:0">✥ Diseño libre de la botonera</h3>
    <p class="muted">Arrastra cada botón, el saldo, la apuesta, el premio y el tablero adonde quieras (también dentro del recuadro de los rodillos) y cambia su tamaño.
      PC y celular se diseñan por separado y se adaptan solos a cualquier pantalla. Los logos de los botones mantienen su proporción: nunca se estiran.</p>
    <div class="row"><button id="chPreset">🧩 Aplicar plantilla «Tablero de la maqueta»</button>
      <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="chBox" style="width:auto" ${C.statStyle === 'box' ? 'checked' : ''} /> Saldo, apuesta y premio en recuadros</label></div>
    <div class="row"><button class="primary" data-hedit="landscape">✏️ Editar en PC</button><button class="primary" data-hedit="portrait">✏️ Editar en celular</button>
      <button class="ghost" data-hreset="landscape">↺ Restablecer PC</button><button class="ghost" data-hreset="portrait">↺ Restablecer celular</button></div>
    <div class="grid2">
      <div><label>Imagen del tablero</label><div class="row">${B.image ? `<img src="${esc(B.image)}" style="height:48px;max-width:220px;object-fit:contain;background:#0006;border-radius:6px" />` : '<span class="muted">Sin imagen (tablero de color)</span>'}
        <button class="small" id="chImg">Elegir…</button>${B.image ? '<button class="small danger" id="chImgClear">Quitar</button>' : ''}</div></div>
      <div><label>Ajuste de la imagen</label><select id="chFit"><option value="fill" ${B.fit !== 'contain' ? 'selected' : ''}>Ocupa todo el tablero</option><option value="contain" ${B.fit === 'contain' ? 'selected' : ''}>Mantener proporción</option></select></div>
      <div><label>Color del tablero (sin imagen)</label><input type="color" id="chColor" value="${esc(B.color && B.color.startsWith('#') ? B.color : '#0f2a1d')}" /></div>
      <div><label>Redondeo (${B.radius ?? 26} px)</label><input type="range" id="chRadius" min="0" max="80" value="${B.radius ?? 26}" /></div>
      <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="chBorder" style="width:auto" ${B.border !== false ? 'checked' : ''} /> Borde y sombra del tablero</label>
      <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="chHide" style="width:auto" ${C.landscape?.board?.hidden && C.portrait?.board?.hidden ? 'checked' : ''} /> Sin tablero (botones sueltos)</label>
    </div>
    <div class="row"><button id="chSave">Guardar tablero</button><span class="muted">Consejo: con el tablero sin imagen y sin borde, los botones flotan sobre el fondo del juego.</span></div></div>`;
}

function bindCustomHudCard(v) {
  if (!$('#chCard', v)) return;
  $$('[data-hedit]', v).forEach((b) => b.addEventListener('click', guard(() => openHudEditor(b.dataset.hedit))));
  $('#chPreset', v).addEventListener('click', guard(async () => {
    if (!confirm('Se reemplaza la disposición actual de PC y celular por la plantilla (marcadores en recuadros a la izquierda, GIRAR al centro, apuesta y controles a la derecha). ¿Continuar?')) return;
    await patchDraft([{ op: 'merge', path: 'theme.hud.custom', value: { preset: 'board', statStyle: 'box', landscape: null, portrait: null } }], 'Plantilla aplicada: mírala en ▶ Vista previa o ajústala con el editor');
    renderTab();
  }));
  $('#chBox', v).addEventListener('change', guard(async (e) => { await patchDraft([{ op: 'set', path: 'theme.hud.custom.statStyle', value: e.target.checked ? 'box' : 'plain' }], 'Marcadores actualizados'); }));
  $$('[data-hreset]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    if (!confirm(`¿Volver a la disposición por defecto en ${b.dataset.hreset === 'portrait' ? 'celular' : 'PC'}?`)) return;
    await patchDraft([{ op: 'set', path: `theme.hud.custom.${b.dataset.hreset}`, value: null }], 'Disposición restablecida');
  })));
  $('#chImg', v).addEventListener('click', guard(async () => {
    const url = await pickAsset('image');
    if (url) { await patchDraft([{ op: 'set', path: 'theme.hud.custom.board.image', value: url }], 'Imagen del tablero aplicada'); renderTab(); }
  }));
  $('#chImgClear', v)?.addEventListener('click', guard(async () => { await patchDraft([{ op: 'set', path: 'theme.hud.custom.board.image', value: null }], 'Imagen del tablero quitada'); renderTab(); }));
  $('#chSave', v).addEventListener('click', guard(async () => {
    const hide = $('#chHide', v).checked;
    await patchDraft([
      { op: 'merge', path: 'theme.hud.custom.board', value: { fit: $('#chFit', v).value, color: $('#chColor', v).value, radius: Number($('#chRadius', v).value), border: $('#chBorder', v).checked } },
      { op: 'merge', path: 'theme.hud.custom.landscape.board', value: { hidden: hide } },
      { op: 'merge', path: 'theme.hud.custom.portrait.board', value: { hidden: hide } },
    ], 'Tablero guardado');
  }));
}

/** Editor visual: abre el borrador en modo edición (PC 1280×720 o celular 390×844) y guarda lo que llega del juego. */
async function openHudEditor(orientation) {
  const s = await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/preview-session`, { method: 'POST' });
  const W = orientation === 'portrait' ? 390 : 1280, H = orientation === 'portrait' ? 844 : 720;
  const wrap = document.createElement('div');
  wrap.className = 'heditor';
  wrap.innerHTML = `<div class="hebar"><b>Editor de botonera · ${orientation === 'portrait' ? 'Celular' : 'PC'}</b>
      <span class="muted">Arrastra, usa la rueda o − / + para el tamaño, flechas para mover fino. «💾 Guardar» (arriba en el juego) guarda en el borrador.</span>
      <button class="ghost" data-close>Cerrar</button></div>
    <div class="hestage"><div class="heframe" style="width:${W}px;height:${H}px"><iframe src="/play/${encodeURIComponent(S.gameId)}?token=${encodeURIComponent(s.token)}&edit=1" style="width:${W}px;height:${H}px;border:0" allow="autoplay"></iframe></div></div>`;
  document.body.appendChild(wrap);
  const fit = () => {
    const st = $('.hestage', wrap);
    const k = Math.min((st.clientWidth - 20) / W, (st.clientHeight - 20) / H, 1);
    $('.heframe', wrap).style.transform = `scale(${k})`;
    $('.heframe', wrap).style.margin = `${Math.max(0, (st.clientHeight - H * k) / 2)}px auto 0`;
    $('.heframe', wrap).style.width = `${W}px`;
    $('.heframe', wrap).style.transformOrigin = 'top left';
    $('.heframe', wrap).style.marginLeft = `${Math.max(0, (st.clientWidth - W * k) / 2)}px`;
  };
  fit();
  window.addEventListener('resize', fit);
  const onMsg = async (e) => {
    if (e.data?.type !== 'hud-layout' || e.source !== $('iframe', wrap)?.contentWindow) return;
    try {
      await patchDraft([{ op: 'set', path: `theme.hud.custom.${e.data.orientation}`, value: e.data.layout }], `Botonera guardada (${e.data.orientation === 'portrait' ? 'celular' : 'PC'})`);
    } catch (err) { toast(err.message, true); }
  };
  window.addEventListener('message', onMsg);
  $('[data-close]', wrap).addEventListener('click', () => { window.removeEventListener('message', onMsg); window.removeEventListener('resize', fit); wrap.remove(); renderTab(); });
}

// ---- Carteles y mensajes (theme.messages) ----
const MSG_KINDS = [['win', 'Premio'], ['big', 'Gran premio y mega premio'], ['feature', 'Bonus: entrada y total'], ['status', 'Contador (giros gratis, re-giros…)']];
const MSG_TEXTS = [['win', 'Premio (arriba del importe; vacío = solo el importe)', ''], ['bigWin', 'Gran premio', 'GRAN PREMIO'], ['megaWin', 'Mega premio', '¡MEGA PREMIO!'],
  ['freeSpins', 'Entrada a giros gratis ({n} = cantidad)', '{n} GIROS GRATIS'], ['spinOf', 'Contador ({i} = giro actual, {n} = total)', 'GIRO GRATIS {i}/{n}'],
  ['bonusSub', 'Subtítulo de la entrada al bonus (vacío = el automático del juego; «-» = sin subtítulo)', 'Automático'],
  ['bonusTotal', 'Total del bonus', 'TOTAL DEL BONUS'], ['respins', 'Re-giros ({n} = restantes)', 'RE-GIROS: {n}'], ['holdWin', 'Entrada Hold & Win', 'HOLD & WIN']];
// Subtítulo automático de la entrada al bonus en cada motor (se puede reemplazar en Carteles → Textos)
const BONUS_SUB = { 'level-up': 'ELIGE UN COFRE', 'cash-collect': 'EL RECOLECTOR SUBE DE NIVEL', 'treasure-chests': 'BONUS DE COFRES', 'colossal-reels': 'COLOSAL GARANTIZADO', 'megaways-cascade': 'EL MULTIPLICADOR NO SE REINICIA', 'bonus-buy': 'TODOS LOS PREMIOS ×N / WILDS FIJOS',
  'expanding-symbol': 'SÍMBOLO ESPECIAL: …', megaways: '¡BONUS!', 'hold-win': 'N MONEDAS · 3 RE-GIROS', 'sticky-wilds': 'COMODINES FIJOS / CAMINANTES', 'scatter-pays': 'LOS MULTIPLICADORES SE ACUMULAN' };
// En qué cartel se muestra cada texto (para usar su tipografía)
const TEXT_KIND = { win: 'win', bigWin: 'big', megaWin: 'big', freeSpins: 'feature', bonusSub: 'feature', bonusTotal: 'feature', holdWin: 'feature', spinOf: 'status', respins: 'status', multiplier: 'status' };
const textFont = (M, kind) => { const st = M.styles?.[kind] || {}; const f = st.font || M.font || null; if (f) panelFont(f, st.font ? st.fontUrl : M.fontUrl); return f; };
const PARTICLES = [['', 'Según la interfaz'], ['none', 'Ninguna'], ['confeti', 'Confeti'], ['monedas', 'Monedas'], ['estrellas', 'Estrellas'], ['gemas', 'Gemas'], ['burbujas', 'Burbujas']];
const ANIMS = [['pop', 'Rebote'], ['zoom', 'Zoom desde lejos'], ['slide', 'Sube desde abajo'], ['flip', 'Giro 3D'], ['fade', 'Aparece suave'], ['shake', 'Rebote + temblor'], ['none', 'Sin animación']];

function messagesCard(t) {
  const M = t.messages || {};
  const S2 = M.styles || {};
  const col = (id, val, def) => `<input type="color" id="${id}" value="${esc(val && String(val).startsWith('#') ? val : def)}" style="width:54px" />`;
  const row = ([k, label]) => {
    const st = S2[k] || {};
    return `<div class="card stack" data-msg="${k}" style="background:var(--panel2)"><div class="row" style="justify-content:space-between"><b>${label}</b><button class="small" data-demo="${k === 'big' ? 'big' : k}">▶ Probar</button></div>
      <div class="grid2">
        <div><label>Imagen o GIF de fondo</label><div class="row">${st.image ? `<img src="${esc(st.image)}" style="height:40px;max-width:160px;object-fit:contain;background:#0006;border-radius:6px" />` : '<span class="muted">Sin imagen</span>'}
          <button class="small" data-mimg>Elegir…</button>${st.image ? '<button class="small danger" data-mimgclear>Quitar</button>' : ''}</div></div>
        <div><label>Colores: fondo · borde · título · importe</label><div class="row" style="gap:6px">${col(`m-${k}-bg`, st.bg, '#000000')}${col(`m-${k}-border`, st.border, '#ffd460')}${col(`m-${k}-title`, st.title, '#ffd460')}${col(`m-${k}-value`, st.value, '#ffffff')}</div>
          <label class="row" style="gap:6px;margin:4px 0 0;color:var(--text)"><input type="checkbox" id="m-${k}-noborder" style="width:auto" ${st.border === 'none' ? 'checked' : ''} /> sin borde</label>
          <label class="row" style="gap:6px;margin:4px 0 0;color:var(--text)"><input type="checkbox" id="m-${k}-usecolors" style="width:auto" ${st.bg || st.title || st.value ? 'checked' : ''} /> usar estos colores (si no, los de la interfaz)</label></div>
        <div><label>Tipografía</label><input id="m-${k}-font" value="${esc(st.font || '')}" placeholder="La de la botonera" ${st.fontUrl ? 'readonly' : ''} />
          <div class="row" style="margin-top:4px"><button class="small" data-mfont>Subir…</button>${st.fontUrl ? '<button class="small danger" data-mfontclear>Quitar</button>' : ''}</div></div>
        <div><label>Tamaño (<span id="m-${k}-scaleV">${Math.round((st.scale || 1) * 100)}</span> %)</label><input type="range" id="m-${k}-scale" min="0.6" max="2" step="0.05" value="${st.scale || 1}" /></div>
        ${k === 'status' ? `<div><label>Posición</label><select id="m-${k}-pos">${[['', 'Arriba de los rodillos'], ['center', 'Centro de los rodillos'], ['bottom', 'Debajo de los rodillos']].map(([v2, l]) => `<option value="${v2}" ${(st.position || '') === v2 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`
      : `<div><label>Animación de entrada</label><select id="m-${k}-anim">${ANIMS.map(([v2, l]) => `<option value="${v2}" ${(st.anim || 'pop') === v2 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>Posición</label><select id="m-${k}-pos">${[['center', 'Centro de los rodillos'], ['top', 'Arriba'], ['bottom', 'Abajo']].map(([v2, l]) => `<option value="${v2}" ${(st.position || 'center') === v2 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>Duración (segundos, vacío = automática)</label><input id="m-${k}-dur" type="number" min="0.4" max="10" step="0.1" value="${st.duration ?? ''}" style="width:120px" /></div>
        <div><label>Partículas</label><select id="m-${k}-part">${PARTICLES.map(([v2, l]) => `<option value="${v2}" ${(st.particles || '') === v2 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`}
      </div></div>`;
  };
  return `<div class="card stack" id="msgCard"><h3 style="margin:0">🪧 Carteles y mensajes</h3>
    <p class="muted">Diseña los avisos del juego: premio, gran premio, entrada y total del bonus y el contador de giros gratis. Cada uno puede llevar una imagen o GIF de fondo, colores, tipografía, tamaño, animación y partículas. «▶ Probar» lo muestra en la vista previa.</p>
    <div class="card stack" style="background:var(--panel2)"><b>Tipografía de todos los carteles ${M.fontUrl ? '<span class="badge ok">archivo propio</span>' : ''}</b>
      <div class="row"><input id="mAllFont" list="msgFontList" value="${esc(M.font || '')}" placeholder="La de la botonera" style="max-width:280px" ${M.fontUrl ? 'readonly' : ''} />
        <button class="small" id="mAllFontUp">Subir tipografía…</button>${M.font ? '<button class="small danger" id="mAllFontX">Quitar</button>' : ''}
        <span class="muted">Se aplica a premio, gran premio, bonus y contador. Si un cartel tiene su propia tipografía abajo, usa la suya.</span></div>
      <datalist id="msgFontList">${['Cinzel', 'Cinzel Decorative', 'Bungee', 'Orbitron', 'Russo One', 'Oswald', 'Anton', 'Bebas Neue', 'Righteous', 'Luckiest Guy', 'Rye', 'Uncial Antiqua', 'Pirata One', 'Black Ops One', 'Teko', 'Rajdhani', 'Playfair Display', 'Abril Fatface', 'Alfa Slab One', 'Titan One', 'Lilita One', 'Press Start 2P'].map((f) => `<option value="${f}">`).join('')}</datalist></div>
    ${MSG_KINDS.map(row).join('')}
    <div class="card stack" style="background:var(--panel2)"><b>Textos</b>
      <div class="row"><label style="margin:0">Tipografía de los textos ${M.fontUrl ? '<span class="badge ok">archivo propio</span>' : ''}</label>
        <input id="mTxtFont" list="msgFontList" value="${esc(M.font || '')}" placeholder="La de la botonera" style="max-width:240px" ${M.fontUrl ? 'readonly' : ''} />
        <button class="small" id="mTxtFontUp">Subir tipografía…</button>${M.font ? '<button class="small danger" id="mTxtFontX">Quitar</button>' : ''}</div>
      <p class="muted" style="margin:0">Es la misma que «Tipografía de todos los carteles» (cambiar una cambia la otra). Si un cartel tiene tipografía propia arriba, sus textos usan la de ese cartel. Cada texto ya se escribe con la tipografía con la que se verá.</p><div class="grid2">
      ${MSG_TEXTS.map(([k, l, d]) => { const kind = TEXT_KIND[k] || 'feature'; const f = textFont(M, kind); return `<div><label>${l} <span class="badge" title="Tipografía: ${esc(f || 'la de la botonera')}">${esc(MSG_KINDS.find((x) => x[0] === kind)?.[1] || '')} · ${esc(f || 'tipografía de la botonera')}</span></label><input data-mtext="${k}" value="${esc(M.texts?.[k] ?? '')}" placeholder="${esc(k === 'bonusSub' ? `Automático: ${BONUS_SUB[S.game.engine] || '—'}` : d || '(solo el importe)')}" style="${f ? `font-family:'${esc(f)}',system-ui;font-size:16px` : ''}" /></div>`; }).join('')}
      <div><label>«Gran premio» desde (× la apuesta)</label><input id="mBig" type="number" min="2" max="1000" value="${M.thresholds?.big ?? 15}" style="width:110px" /></div>
      <div><label>«Mega premio» desde (× la apuesta)</label><input id="mMega" type="number" min="3" max="5000" value="${M.thresholds?.mega ?? 50}" style="width:110px" /></div>
    </div></div>
    <div class="row"><button class="primary" id="msgSave">Guardar carteles</button><button data-demo="mega">▶ Probar mega premio</button></div></div>`;
}

/** Abre la vista previa (si hace falta), espera al juego y le pide un cartel de ejemplo. */
async function demoInPreview(kind, extra = {}) {
  if ($('#previewPane').hidden) { $('#previewPane').hidden = false; await reloadPreview(true); }
  const frame = $('#previewFrame');
  for (let i = 0; i < 60; i++) {
    const en = frame.contentWindow?.engine;
    if (en && (en.hud || en.demoTier) && !en.busy) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  frame.contentWindow?.postMessage({ type: 'demo', kind, ...extra }, '*');
}

function bindMessagesCard(v) {
  const syncFont = (from, to) => $(from, v)?.addEventListener('input', () => { if ($(to, v)) $(to, v).value = $(from, v).value; });
  syncFont('#mAllFont', '#mTxtFont'); syncFont('#mTxtFont', '#mAllFont');
  $('#mTxtFontUp', v)?.addEventListener('click', () => $('#mAllFontUp', v)?.click());
  $('#mTxtFontX', v)?.addEventListener('click', () => $('#mAllFontX', v)?.click());
  $('#mAllFontUp', v)?.addEventListener('click', guard(async () => {
    const a = await pickAsset('font');
    if (!a) return;
    const asset = typeof a === 'string' ? (await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId || '')}&kind=font`)).find((x) => x.url === a) : a;
    await patchDraft([{ op: 'set', path: 'theme.messages.font', value: fontFamilyOf(asset || { filename: 'Fuente propia' }) }, { op: 'set', path: 'theme.messages.fontUrl', value: asset?.url || a }], 'Tipografía aplicada a todos los carteles');
    renderTab();
  }));
  $('#mAllFontX', v)?.addEventListener('click', guard(async () => {
    await patchDraft([{ op: 'set', path: 'theme.messages.font', value: null }, { op: 'set', path: 'theme.messages.fontUrl', value: null }], 'Tipografía general quitada');
    renderTab();
  }));
  if (!$('#msgCard', v)) return;
  $$('#msgCard [data-demo]', v).forEach((b) => b.addEventListener('click', guard(() => demoInPreview(b.dataset.demo))));
  for (const [k] of MSG_KINDS) {
    const box = $(`[data-msg="${k}"]`, v);
    $(`#m-${k}-scale`, v).addEventListener('input', (e) => { $(`#m-${k}-scaleV`, v).textContent = Math.round(e.target.value * 100); });
    $('[data-mimg]', box).addEventListener('click', guard(async () => {
      const url = await pickAsset('image');
      if (url) { await patchDraft([{ op: 'set', path: `theme.messages.styles.${k}.image`, value: url }], 'Imagen del cartel aplicada'); renderTab(); }
    }));
    $('[data-mimgclear]', box)?.addEventListener('click', guard(async () => { await patchDraft([{ op: 'set', path: `theme.messages.styles.${k}.image`, value: null }], 'Imagen quitada'); renderTab(); }));
    $('[data-mfont]', box).addEventListener('click', guard(async () => {
      const a = await pickAsset('font');
      if (!a) return;
      await patchDraft([{ op: 'set', path: `theme.messages.styles.${k}.font`, value: fontFamilyOf(a) }, { op: 'set', path: `theme.messages.styles.${k}.fontUrl`, value: a.url }], 'Tipografía aplicada');
      renderTab();
    }));
    $('[data-mfontclear]', box)?.addEventListener('click', guard(async () => { await patchDraft([{ op: 'set', path: `theme.messages.styles.${k}.fontUrl`, value: null }, { op: 'set', path: `theme.messages.styles.${k}.font`, value: null }], 'Tipografía quitada'); renderTab(); }));
  }
  $('#msgSave', v).addEventListener('click', guard(async () => {
    const cur = S.game.draft.theme?.messages?.styles || {};
    const styles = {};
    for (const [k] of MSG_KINDS) {
      const g = (id) => $(`#m-${k}-${id}`, v);
      const use = g('usecolors').checked;
      styles[k] = {
        ...cur[k],
        bg: use ? g('bg').value + 'd9' : null, title: use ? g('title').value : null, value: use ? g('value').value : null,
        border: g('noborder').checked ? 'none' : use ? g('border').value : null,
        font: cur[k]?.fontUrl ? cur[k].font : (g('font').value.trim() || null),
        scale: Number(g('scale').value), position: g('pos').value || null,
        ...(k === 'status' ? {} : { anim: g('anim').value, duration: g('dur').value ? Number(g('dur').value) : null, particles: g('part').value || null }),
      };
    }
    const texts = Object.fromEntries($$('[data-mtext]', v).map((i) => [i.dataset.mtext, i.value.trim() || null]));
    await patchDraft([
      { op: 'set', path: 'theme.messages.styles', value: styles },
      { op: 'set', path: 'theme.messages.texts', value: texts },
      ...($('#mAllFont', v).readOnly ? [] : [{ op: 'set', path: 'theme.messages.font', value: $('#mAllFont', v).value.trim() || null }]),
      { op: 'set', path: 'theme.messages.thresholds', value: { big: Number($('#mBig', v).value) || 15, mega: Number($('#mMega', v).value) || 50 } },
    ], 'Carteles guardados: prueba cada uno con ▶ Probar');
  }));
}

// ---- Ambiente del bonus (theme.bonus): presentación, fondos y cierre con imagen, GIF o video ----
// ---- Premios por monto (theme.winTiers): sonido, video/GIF y texto según cuánto se gana ----
function winTiersCard(t) {
  const tiers = (t.winTiers || []).map((x, i) => ({ ...x, i })).sort((a, b) => (a.from || 0) - (b.from || 0));
  const media = (u) => (!u ? '<span class="muted">Sin video</span>' : /\.(mp4|webm)(\?|$)/i.test(u) ? `<video src="${esc(u)}" muted loop autoplay playsinline style="height:44px;border-radius:6px"></video>` : `<img src="${esc(u)}" style="height:44px;max-width:120px;object-fit:contain;border-radius:6px;background:#0006" />`);
  const row = (x) => `<div class="card stack tier-row" data-ti="${x.i}" style="background:var(--panel2);gap:8px">
    <div class="row" style="justify-content:space-between"><b>Desde ${esc(x.from ?? '?')}× la apuesta</b><div class="row"><button class="small" data-tdemo="${x.i}">▶ Probar</button><button class="small danger" data-tdel="${x.i}">Quitar nivel</button></div></div>
    <div class="grid2">
      <div><label>Desde (× la apuesta)</label><input data-tf="from" type="number" min="1" max="100000" step="0.5" value="${esc(x.from ?? 10)}" style="width:130px" /></div>
      <div><label>Texto del cartel</label><input data-tf="text" value="${esc(x.text || '')}" placeholder="Ej. ¡PREMIO ÉPICO!" /></div>
      <div><label>Sonido</label><div class="row">${x.sound ? `<audio src="${esc(x.sound)}" controls style="height:32px;max-width:190px"></audio>` : '<span class="muted">El de gran premio</span>'}<button class="small" data-tsound="${x.i}">Elegir…</button>${x.sound ? `<button class="small danger" data-tsoundx="${x.i}">Quitar</button>` : ''}</div></div>
      <div><label>Video, GIF o imagen a pantalla completa</label><div class="row">${media(x.media)}<button class="small" data-tmedia="${x.i}">Elegir…</button>${x.media ? `<button class="small danger" data-tmediax="${x.i}">Quitar</button>` : ''}</div></div>
      <div><label>Duración máx. del video (s)</label><input data-tf="seconds" type="number" min="1" max="15" step="0.5" value="${esc(x.seconds ?? 3)}" style="width:90px" /></div>
    </div>
    <div class="tier-pos">
      <div class="tier-prev" title="Arrastra el importe adonde quieras sobre el video">${x.media ? (/\.(mp4|webm)(\?|$)/i.test(x.media) ? `<video src="${esc(x.media)}" muted loop autoplay playsinline></video>` : `<img src="${esc(x.media)}" alt="" />`) : '<span class="muted">Elige un video, GIF o imagen para ubicar el importe</span>'}
        <div class="tp-cap" style="left:${x.amountX ?? 50}%;top:${x.amountY ?? 80}%;--k:${x.amountScale ?? 1}"><small style="color:${esc(x.textColor || 'var(--accent)')}">${esc(x.text || '¡GRAN PREMIO!')}</small><b style="color:${esc(x.amountColor || '#ffffff')}">$ 1.250,00</b></div></div>
      <div class="stack" style="gap:8px">
        <p class="muted" style="margin:0">✥ <b>Arrastra el importe</b> sobre la imagen para subirlo, bajarlo o moverlo de lado.</p>
        <div><label>Altura del importe (<span data-tv="y">${Math.round(x.amountY ?? 80)}</span> % — menos = más arriba)</label><input data-tf="amountY" type="range" min="0" max="100" step="1" value="${x.amountY ?? 80}" /></div>
        <div><label>Izquierda / derecha (<span data-tv="x">${Math.round(x.amountX ?? 50)}</span> %)</label><input data-tf="amountX" type="range" min="0" max="100" step="1" value="${x.amountX ?? 50}" /></div>
        <div><label>Tamaño del importe (<span data-tv="k">${Math.round((x.amountScale ?? 1) * 100)}</span> %)</label><input data-tf="amountScale" type="range" min="0.4" max="3" step="0.05" value="${x.amountScale ?? 1}" /></div>
        <div class="row"><label style="margin:0">Color del importe</label><input data-tf="amountColor" type="color" value="${esc(x.amountColor || '#ffffff')}" style="width:56px" />
          <label style="margin:0">Color del texto</label><input data-tf="textColor" type="color" value="${esc(x.textColor || '#ffd460')}" style="width:56px" /></div>
        <button class="small" data-tposx="${x.i}" style="justify-self:start">↺ Posición original (abajo al centro)</button>
      </div></div></div>`;
  return `<div class="card stack" id="tiersCard"><h3 style="margin:0">🏆 Premios por monto</h3>
    <p class="muted" style="margin:0">Cuando un giro (o una tirada, en juegos de mesa) paga desde cierto monto (en veces la apuesta), el juego reproduce el sonido, el video o GIF y el texto de ese nivel; si alcanza varios, usa el más alto. El importe ganado se muestra encima del video: arrástralo para ubicarlo y cambia su tamaño y colores; luego «Guardar niveles». Sin niveles, se usan «Gran premio» y «Mega premio» de los carteles.</p>
    ${tiers.map(row).join('') || '<p class="muted">Todavía no hay niveles.</p>'}
    <div class="row"><button id="tAdd">＋ Agregar nivel</button><button class="primary" id="tSave">Guardar niveles</button></div></div>`;
}

function bindWinTiersCard(v) {
  if (!$('#tiersCard', v)) return;
  const cur = () => structuredClone(S.game.draft.theme?.winTiers || []);
  // Lee los campos escritos (sin guardar) sobre la lista actual
  const read = () => {
    const list = cur();
    for (const box of $$('.tier-row', v)) {
      const i = Number(box.dataset.ti);
      const f = (k) => $(`[data-tf="${k}"]`, box).value;
      const pos = box.dataset.moved ? { amountX: Number(f('amountX')), amountY: Number(f('amountY')) } : {};
      const k = Number(f('amountScale'));
      list[i] = { ...list[i], from: Number(f('from')) || 10, text: f('text').trim() || null, seconds: Number(f('seconds')) || 3, ...pos,
        amountScale: k === 1 ? null : k,
        ...(box.dataset.colors ? { amountColor: f('amountColor'), textColor: f('textColor') } : {}) };
      if (box.dataset.reset) { list[i].amountX = null; list[i].amountY = null; }
    }
    return list;
  };
  const save = async (list, msg = 'Premios por monto guardados') => { await patchDraft([{ op: 'set', path: 'theme.winTiers', value: list }], msg); renderTab(); };
  $('#tAdd', v).addEventListener('click', guard(async () => {
    const list = read();
    const top = Math.max(0, ...list.map((x) => Number(x.from) || 0));
    list.push({ from: top ? top * 3 : 10, text: top ? '¡PREMIO ÉPICO!' : '¡GRAN PREMIO!', seconds: 3 });
    await save(list, 'Nivel agregado: elige su sonido y su video o GIF');
  }));
  $('#tSave', v).addEventListener('click', guard(() => save(read())));
  // Ubicar el importe: arrastrándolo sobre la imagen o con los controles (se ve al instante)
  for (const box of $$('.tier-row', v)) {
    const cap = $('.tp-cap', box), prevBox = $('.tier-prev', box);
    const inp = (k) => $(`[data-tf="${k}"]`, box);
    // Rectángulo donde se ve la imagen/video dentro de la vista previa (object-fit: contain), igual que en el juego
    const rect = () => {
      const m = $('img, video', prevBox), bw = prevBox.clientWidth, bh = prevBox.clientHeight;
      const nw = m?.videoWidth || m?.naturalWidth, nh = m?.videoHeight || m?.naturalHeight;
      if (!nw || !nh) return { x: 0, y: 0, w: bw, h: bh };
      const k = Math.min(bw / nw, bh / nh);
      return { x: (bw - nw * k) / 2, y: (bh - nh * k) / 2, w: nw * k, h: nh * k };
    };
    const paint = () => {
      const r = rect();
      cap.style.left = `${r.x + (r.w * inp('amountX').value) / 100}px`; cap.style.top = `${r.y + (r.h * inp('amountY').value) / 100}px`;
      $('b', cap).style.fontSize = `${Math.max(10, r.h * 0.12)}px`; $('small', cap).style.fontSize = `${Math.max(7, r.h * 0.045)}px`;
      cap.style.setProperty('--k', inp('amountScale').value);
      $('[data-tv="x"]', box).textContent = Math.round(inp('amountX').value);
      $('[data-tv="y"]', box).textContent = Math.round(inp('amountY').value);
      $('[data-tv="k"]', box).textContent = Math.round(inp('amountScale').value * 100);
      $('b', cap).style.color = inp('amountColor').value; $('small', cap).style.color = inp('textColor').value;
      $('small', cap).textContent = inp('text').value.trim() || '¡GRAN PREMIO!';
    };
    ['amountX', 'amountY'].forEach((k) => inp(k).addEventListener('input', () => { box.dataset.moved = '1'; delete box.dataset.reset; paint(); }));
    inp('amountScale').addEventListener('input', paint);
    inp('text').addEventListener('input', paint);
    ['amountColor', 'textColor'].forEach((k) => inp(k).addEventListener('input', () => { box.dataset.colors = '1'; paint(); }));
    cap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cap.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const b = prevBox.getBoundingClientRect(), r = rect();
        inp('amountX').value = Math.round(Math.min(100, Math.max(0, ((ev.clientX - b.left - r.x) / r.w) * 100)));
        inp('amountY').value = Math.round(Math.min(100, Math.max(0, ((ev.clientY - b.top - r.y) / r.h) * 100)));
        box.dataset.moved = '1'; delete box.dataset.reset; paint();
      };
      const up = () => { cap.removeEventListener('pointermove', move); cap.removeEventListener('pointerup', up); };
      cap.addEventListener('pointermove', move); cap.addEventListener('pointerup', up);
    });
    $('img, video', prevBox)?.addEventListener($('video', prevBox) ? 'loadedmetadata' : 'load', paint);
    requestAnimationFrame(paint);
    $('[data-tposx]', box).addEventListener('click', () => { inp('amountX').value = 50; inp('amountY').value = 80; box.dataset.reset = '1'; delete box.dataset.moved; paint(); });
  }
  $$('[data-tdel]', v).forEach((b) => b.addEventListener('click', guard(async () => { const list = read(); list.splice(Number(b.dataset.tdel), 1); await save(list, 'Nivel quitado'); })));
  $$('[data-tsound]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const url = await pickAsset('sound');
    if (!url) return;
    const list = read(); list[Number(b.dataset.tsound)].sound = url; await save(list, 'Sonido del nivel aplicado');
  })));
  $$('[data-tsoundx]', v).forEach((b) => b.addEventListener('click', guard(async () => { const list = read(); list[Number(b.dataset.tsoundx)].sound = null; await save(list); })));
  $$('[data-tmedia]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const url = await pickAsset('image', { animated: true });
    if (!url) return;
    const list = read(); list[Number(b.dataset.tmedia)].media = url; await save(list, 'Video del nivel aplicado');
  })));
  $$('[data-tmediax]', v).forEach((b) => b.addEventListener('click', guard(async () => { const list = read(); list[Number(b.dataset.tmediax)].media = null; await save(list); })));
  $$('[data-tdemo]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    await patchDraft([{ op: 'set', path: 'theme.winTiers', value: read() }], 'Guardado: mira el nivel en la vista previa');
    await reloadPreview(true);
    await demoInPreview('tier', { i: Number(b.dataset.tdemo) });
  })));
}

function bonusCard(t) {
  const B = t.bonus || {};
  const media = (u) => (!u ? '<span class="muted">Nada</span>' : /\.(mp4|webm)(\?|$)/i.test(u) ? `<video src="${esc(u)}" muted loop autoplay playsinline style="height:44px;border-radius:6px"></video>` : `<img src="${esc(u)}" style="height:44px;max-width:160px;object-fit:contain;border-radius:6px;background:#0006" />`);
  const f = (k, label, secs) => `<div><label>${label}</label><div class="row">${media(B[k])}<button class="small" data-bmedia="${k}">Elegir…</button>${B[k] ? `<button class="small danger" data-bclear="${k}">Quitar</button>` : ''}</div>
    ${secs ? `<div class="row" style="margin-top:4px"><span class="muted">Duración máx.</span><input data-bsecs="${secs}" type="number" min="1" max="15" step="0.5" value="${B[secs] ?? 3}" style="width:80px" /><span class="muted">s (un video termina solo)</span></div>` : ''}</div>`;
  return `<div class="card stack" id="bonusCard"><h3 style="margin:0">🎁 Ambiente del bonus</h3>
    <p class="muted">Durante los giros gratis (o el bonus) el juego puede cambiar de ambiente: una presentación a pantalla completa al entrar, fondos propios mientras dura y un cierre al terminar. Todo acepta imagen, GIF o video (MP4/WebM).</p>
    <div class="grid2">${f('intro', 'Presentación al entrar', 'introSeconds')}${f('outro', 'Cierre al terminar', 'outroSeconds')}
      ${f('background', 'Fondo PC durante el bonus')}${f('backgroundMobile', 'Fondo celular durante el bonus')}${f('reelsBackground', 'Fondo de rodillos durante el bonus')}</div>
    <div class="row"><button class="primary" id="bnSave">Guardar duraciones</button><button data-demo="feature">▶ Probar el bonus</button><span class="muted">También puedes usar 🎁 FORZAR BONUS en la vista previa para ver un bonus real.</span></div></div>`;
}

function bindBonusCard(v) {
  if (!$('#bonusCard', v)) return;
  $$('#bonusCard [data-demo]', v).forEach((b) => b.addEventListener('click', guard(() => demoInPreview(b.dataset.demo))));
  $$('[data-bmedia]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const url = await pickAsset('image', { animated: true });
    if (url) { await patchDraft([{ op: 'set', path: `theme.bonus.${b.dataset.bmedia}`, value: url }], 'Aplicado al bonus'); renderTab(); }
  })));
  $$('[data-bclear]', v).forEach((b) => b.addEventListener('click', guard(async () => { await patchDraft([{ op: 'set', path: `theme.bonus.${b.dataset.bclear}`, value: null }], 'Quitado'); renderTab(); })));
  $('#bnSave', v).addEventListener('click', guard(async () => {
    const ops = $$('[data-bsecs]', v).map((i) => ({ op: 'set', path: `theme.bonus.${i.dataset.bsecs}`, value: Number(i.value) || 3 }));
    await patchDraft(ops, 'Duraciones guardadas');
  }));
}

// ---- Selector de interfaz al crear un juego ----
function uiPicker() {
  return `<div><label>Interfaz</label><div class="ui-grid small">${UIS.map(([k, n, , pal], i) => `<button type="button" class="ui-tile ${i === 0 ? 'on' : ''}" data-pick="${k}">${uiMock(k, pal)}<b>${n}</b></button>`).join('')}</div>
    <span class="muted">Los juegos de mesa (Craps) usan su propia mesa y no llevan esta interfaz.</span></div>`;
}
function bindUiPicker(root) {
  $$('[data-pick]', root).forEach((b) => b.addEventListener('click', () => { $$('[data-pick]', root).forEach((x) => x.classList.toggle('on', x === b)); }));
}
async function applyUiChoice(root, gameId, engine) {
  const k = $('[data-pick].on', root)?.dataset.pick;
  if (!k || k === 'pill' || (engineInfo(engine).kind || 'slot') !== 'slot') return;
  const pal = UIS.find((x) => x[0] === k)[3];
  await api(`/api/admin/games/${encodeURIComponent(gameId)}/draft`, { method: 'PATCH', body: { ops: [{ op: 'merge', path: 'theme.hud', value: { layout: k } }, ...(pal ? [{ op: 'merge', path: 'theme.palette', value: pal }] : [])] } });
}

// ------------------------------------------------------------------ Selector modal genérico
function openPicker(title, html, onMount) {
  const wrap = document.createElement('div');
  wrap.className = 'picker';
  wrap.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(title)}</h2><button class="ghost small" data-close>✕</button></div><div class="body" style="margin-top:14px">${html}</div></div>`;
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(wrap);
  onMount?.(wrap, close);
}

/** Elegir o subir un asset. kind: image | sound | font; con { animated: true } también acepta GIF y video (fondos). */
async function pickAsset(kind, { animated = false } = {}) {
  let list = await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId || '')}&kind=${kind}`);
  if (animated) list = [...list, ...(await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId || '')}&kind=video`))];
  const accept = { image: `image/png,image/jpeg,image/webp,image/svg+xml,image/gif${animated ? ',video/mp4,video/webm' : ''}`, sound: 'audio/mpeg,audio/wav,audio/ogg', font: '.woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf', video: 'video/mp4,video/webm' }[kind];
  const title = { image: animated ? 'Elegir imagen, GIF o video' : 'Elegir imagen', sound: 'Elegir sonido', font: 'Elegir tipografía', video: 'Elegir video (MP4 o WebM)' }[kind];
  return new Promise((resolve) => {
    openPicker(title, `
      <div class="row" style="margin-bottom:12px"><input type="file" id="pkUpload" accept="${accept}" />${animated ? '<span class="muted">GIF animado o video MP4/WebM (hasta 60 MB; mejor cortos y livianos, en bucle).</span>' : ''}</div>
      <div class="gallery">${list.map((a) => assetTile(a, true)).join('') || '<p class="muted">Aún no hay assets. Sube uno o pídeselo a los agentes.</p>'}</div>`, (root, close) => {
      $$('.tile', root).forEach((t) => t.addEventListener('click', (e) => { if (e.target.tagName === 'AUDIO') return; close(); resolve(kind === 'font' ? list.find((x) => x.url === t.dataset.url) : t.dataset.url); }));
      $('#pkUpload', root).addEventListener('change', guard(async (e) => {
        const a = await uploadFile(e.target.files[0], kind);
        close();
        resolve(kind === 'font' ? a : a.url);
      }));
    });
  });
}

async function uploadFile(file, kind) {
  if (!file) throw new Error('Selecciona un archivo');
  return api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId || '')}&kind=${kind}&name=${encodeURIComponent(file.name)}`, {
    method: 'POST', raw: true, body: file, headers: { 'content-type': file.type || 'application/octet-stream' },
  });
}

// ------------------------------------------------------------------ ✂ Quitar fondo de una imagen (en el navegador)
// Borra el fondo liso (o el "cuadriculado" falso de transparencia) que toca los bordes de la imagen: toma los colores
// del borde y borra todo lo conectado a él que se les parezca. Recorta los bordes vacíos y sube un PNG nuevo.
async function loadImageData(url) {
  const blob = await (await fetch(url, { credentials: 'same-origin' })).blob();
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

function removeBackground(src, { tolerance = 40, holes = false, trim = true } = {}) {
  const W = src.width, H = src.height;
  const ctx = src.getContext('2d');
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  // Colores del borde (agrupados) → los del fondo
  const buckets = new Map();
  let borderN = 0;
  const sample = (x, y) => {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 16) return;
    borderN++;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    buckets.set(key, b);
  };
  for (let x = 0; x < W; x++) { sample(x, 0); sample(x, H - 1); }
  for (let y = 1; y < H - 1; y++) { sample(0, y); sample(W - 1, y); }
  const seeds = [];
  let acc = 0;
  for (const b of [...buckets.values()].sort((a, c) => c.n - a.n)) {
    if (seeds.length >= 4 || acc >= borderN * 0.85 || b.n < borderN * 0.03) break;
    seeds.push([b.r / b.n, b.g / b.n, b.b / b.n]); acc += b.n;
  }
  const dist = (i) => {
    let m = Infinity;
    for (const [r, g, b] of seeds) m = Math.min(m, Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b)));
    return m;
  };
  const bg = new Uint8Array(W * H);
  if (seeds.length) {
    const near = (p) => d[p * 4 + 3] < 16 || dist(p * 4) <= tolerance;
    if (holes) { for (let p = 0; p < W * H; p++) if (near(p)) bg[p] = 1; }
    else {
      const q = new Int32Array(W * H);
      let qh = 0, qt = 0;
      const push = (p) => { if (!bg[p] && near(p)) { bg[p] = 1; q[qt++] = p; } };
      for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
      for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
      while (qh < qt) {
        const p = q[qh++], x = p % W, y = (p / W) | 0;
        if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (y > 0) push(p - W); if (y < H - 1) push(p + W);
      }
    }
    for (let p = 0; p < W * H; p++) {
      if (bg[p]) { d[p * 4 + 3] = 0; continue; }
      // Borde suave: los píxeles pegados al fondo que se le parecen quedan semitransparentes
      const x = p % W, y = (p / W) | 0;
      if ((x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1]) || (y > 0 && bg[p - W]) || (y < H - 1 && bg[p + W])) {
        const e = dist(p * 4);
        if (e < tolerance * 2) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * Math.max(0.15, (e - tolerance) / tolerance));
      }
    }
  }
  // Recortar lo vacío
  let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
  if (trim) {
    x0 = W; y0 = H; x1 = -1; y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(W - 1, x1 + 2); y1 = Math.min(H - 1, y1 + 2);
  }
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
  tmp.getContext('2d').putImageData(id, 0, 0);
  out.getContext('2d').drawImage(tmp, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { canvas: out, seeds: seeds.length, removed: bg.reduce((a, v) => a + v, 0) / (W * H) };
}

async function uploadCanvasPng(canvas, srcUrl) {
  const blob = await new Promise((res, rej) => { try { canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear el PNG'))), 'image/png'); } catch (e) { rej(e); } });
  const base = String(srcUrl).split('/').pop().split('?')[0].replace(/\.\w+$/, '').slice(0, 40) || 'imagen';
  const a = await uploadFile(new File([blob], `${base}-sin-fondo.png`, { type: 'image/png' }), 'image');
  return a.url;
}

/** Ventana «Quitar fondo» con vista previa y ajuste; devuelve la URL del PNG nuevo (o null). */
function openBgRemover(url) {
  return new Promise((resolve) => {
    openPicker('✂ Quitar fondo', `<p class="muted" style="margin-top:0">Borra el fondo que toca los bordes (color liso o el cuadriculado falso de transparencia) y recorta lo vacío. Se guarda como imagen nueva: la original no se toca.</p>
      <div class="bgr"><figure><img id="bgrA" src="${esc(url)}" /><figcaption>Antes</figcaption></figure><figure><canvas id="bgrB"></canvas><figcaption>Después</figcaption></figure></div>
      <div class="grid2"><div><label>Tolerancia (<span id="bgrTv">40</span>)</label><input id="bgrT" type="range" min="5" max="120" step="1" value="40" />
        <small class="muted">Más alto: borra colores más parecidos al fondo. Si se come parte del botón, bájala.</small></div>
        <div class="stack"><label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="bgrH" style="width:auto" /> Borrar también los huecos interiores del mismo color</label>
        <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="bgrC" style="width:auto" checked /> Recortar los bordes vacíos</label></div></div>
      <div class="row" style="margin-top:12px"><button class="primary" id="bgrOk">Aplicar</button><button class="ghost" data-close>Cancelar</button><span class="muted" id="bgrInfo"></span></div>`, async (root, close) => {
      let src = null, last = null;
      const draw = () => {
        if (!src) return;
        const tol = Number($('#bgrT', root).value);
        $('#bgrTv', root).textContent = tol;
        const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
        c.getContext('2d').drawImage(src, 0, 0);
        last = removeBackground(c, { tolerance: tol, holes: $('#bgrH', root).checked, trim: $('#bgrC', root).checked });
        const b = $('#bgrB', root);
        b.width = last.canvas.width; b.height = last.canvas.height;
        b.getContext('2d').drawImage(last.canvas, 0, 0);
        $('#bgrInfo', root).textContent = last.seeds ? `Fondo borrado: ${Math.round(last.removed * 100)} % de la imagen` : 'La imagen ya no tiene fondo en los bordes';
      };
      try { src = await loadImageData(url); draw(); } catch { $('#bgrInfo', root).textContent = 'No se pudo abrir la imagen (¿está en otro servidor? Descárgala y súbela).'; }
      for (const id of ['#bgrT', '#bgrH', '#bgrC']) $(id, root).addEventListener('input', draw);
      root.addEventListener('click', (e) => { if (e.target === root || e.target.closest('[data-close]')) resolve(null); });
      $('#bgrOk', root).addEventListener('click', guard(async () => {
        if (!last) return;
        const u = await uploadCanvasPng(last.canvas, url);
        close(); resolve(u);
      }));
    });
  });
}

function assetTile(a, selectable = false) {
  const media = a.kind === 'image' ? `<img src="${esc(a.url)}" loading="lazy" alt="" />`
    : a.kind === 'video' ? `<video src="${esc(a.url)}" muted loop autoplay playsinline style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px"></video>`
      : a.kind === 'font' ? `<div style="font:28px '${esc(fontFamilyOf(a))}';padding:18px 6px;text-align:center"><style>@font-face{font-family:'${esc(fontFamilyOf(a))}';src:url('${esc(a.url)}')}</style>Aa Bb 123</div>`
        : `<audio controls preload="none" src="${esc(a.url)}"></audio>`;
  return `<div class="tile" data-url="${esc(a.url)}" data-id="${esc(a.id)}">${media}
    <div class="p" title="${esc(a.prompt)}">${esc(a.prompt || a.filename)}</div>
    <div class="muted">${esc(a.provider)} · ${esc(a.created_at?.slice(0, 16))}${selectable ? '' : ` · <code>${esc(a.id)}</code>`}</div></div>`;
}

/** Nombre de familia para una tipografía subida (a partir del nombre del archivo). */
function fontFamilyOf(a) {
  return String(a.prompt || a.filename || 'Fuente').replace(/\.(woff2?|ttf|otf)$/i, '').replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Fuente propia';
}

// ------------------------------------------------------------------ Pestaña: Agentes
const SUGGESTIONS = [
  'Rediseña el juego completo con temática egipcia: faraones, escarabajos y oro. Símbolos, fondo, colores y sonidos.',
  'Haz los símbolos más brillantes y con borde dorado, manteniendo el estilo actual.',
  'Crea una música de fondo relajada y efectos de sonido de monedas y cascadas.',
  'Sube la volatilidad: premios altos más grandes y bajos más pequeños, manteniendo RTP 96 %.',
  'Cambia la paleta a tonos neón (magenta y cian) y la tipografía a algo futurista.',
];

async function tabAgents(v) {
  const runs = await api(`/api/admin/agents/runs?gameId=${encodeURIComponent(S.gameId)}`);
  v.innerHTML = `
  <div class="chat">
    <div class="stack" style="overflow:hidden;display:flex;flex-direction:column">
      <div class="runs">
        <select id="runSelect" style="max-width:420px"><option value="">＋ Nueva conversación</option>${runs.map((r) => `<option value="${r.id}">${esc(r.created_at.slice(5, 16))} · ${esc(r.prompt.slice(0, 60))} (${esc(r.status)})</option>`).join('')}</select>
        <span class="muted" id="usage"></span>
      </div>
      <div class="log" id="log"><div class="muted">Los agentes editan el <b>borrador</b>. Revisa la vista previa y publica cuando te guste.
      ${S.me.providers.anthropic ? '' : '<br><span class="error">Falta ANTHROPIC_API_KEY en el servidor: los agentes no pueden trabajar.</span>'}</div></div>
    </div>
    <div class="stack">
      <div class="suggestions">${SUGGESTIONS.filter((s) => !isOp() || !/volatilidad|RTP/.test(s)).map((s) => `<button data-s="${esc(s)}">${esc(s.slice(0, 48))}…</button>`).join('')}</div>
      <div class="composer">
        <div><label>Hablar con</label><select id="agentSel">
          <option value="director">🎬 Director (coordina a todos)</option><option value="designer">🎨 Diseñador</option>
          <option value="artist">🖌 Artista (imágenes)</option><option value="sound">🎵 Sonido</option>${isOp() ? '' : '<option value="math">📈 Matemático</option>'}</select></div>
        <div><label>Pedido <span class="muted">(puedes adjuntar o pegar imágenes de referencia)</span></label>
          <div id="refThumbs" class="ref-thumbs"></div>
          <textarea id="prompt" rows="2" placeholder="Ej.: Quiero un tema pirata con cofres, calaveras doradas y mar de noche…"></textarea></div>
        <div class="row"><label class="attach" title="Adjuntar imágenes de referencia">📎<input id="refInput" type="file" accept="image/*" multiple hidden /></label>
          <button class="primary" id="sendBtn">Enviar</button><button id="cancelBtn" class="danger" hidden>Detener</button></div>
      </div>
    </div>
  </div>`;
  $$('.suggestions button', v).forEach((b) => b.addEventListener('click', () => { $('#prompt').value = b.dataset.s; $('#prompt').focus(); }));
  $('#runSelect').addEventListener('change', guard(async (e) => {
    S.runId = e.target.value || null;
    $('#log').innerHTML = '';
    if (S.runId) await openRun(S.runId);
  }));
  $('#sendBtn').addEventListener('click', guard(sendPrompt));
  S.refs = [];
  renderRefs();
  $('#refInput').addEventListener('change', guard(async (e) => { await addRefs([...e.target.files]); e.target.value = ''; }));
  $('#prompt').addEventListener('paste', guard(async (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); await addRefs(files); }
  }));
  const chatEl = $('.chat', v);
  chatEl.addEventListener('dragover', (e) => e.preventDefault());
  chatEl.addEventListener('drop', guard(async (e) => {
    e.preventDefault();
    await addRefs([...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/')));
  }));
  $('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPrompt(); });
  $('#cancelBtn').addEventListener('click', guard(async () => { await api(`/api/admin/agents/runs/${S.runId}/cancel`, { method: 'POST' }); }));
  if (S.runId) { $('#runSelect').value = S.runId; $('#log').innerHTML = ''; await openRun(S.runId); }
}

// ---- Imágenes de referencia para los agentes ----
/** Reduce la imagen en el navegador (máx. 1568 px, JPEG) para que suba rápido y los agentes la vean bien. */
async function shrinkImage(file) {
  if (file.type === 'image/gif') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size < 1_500_000) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b ? new File([b], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file), 'image/jpeg', 0.88));
}

async function addRefs(files) {
  for (const f of files) {
    if (S.refs.length >= 6) { toast('Máximo 6 imágenes por mensaje', true); break; }
    const small = await shrinkImage(f);
    const a = await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId || '')}&kind=image&reference=1&name=${encodeURIComponent('Referencia: ' + f.name)}`, {
      method: 'POST', raw: true, body: small, headers: { 'content-type': small.type || 'image/jpeg' },
    });
    S.refs.push({ id: a.id, url: a.url });
    renderRefs();
  }
}

function renderRefs() {
  const el = $('#refThumbs');
  if (!el) return;
  el.innerHTML = (S.refs || []).map((r, i) => `<div class="ref"><img src="${esc(r.url)}" alt="" /><button data-i="${i}" title="Quitar">✕</button></div>`).join('');
  $$('button[data-i]', el).forEach((b) => b.addEventListener('click', () => { S.refs.splice(Number(b.dataset.i), 1); renderRefs(); }));
}

async function sendPrompt() {
  const prompt = $('#prompt').value.trim() || (S.refs?.length ? 'Mira las imágenes de referencia y dime cómo aplicarías ese estilo a este juego.' : '');
  if (!prompt) return;
  const agent = $('#agentSel').value;
  const images = (S.refs || []).map((r) => r.id);
  const { runId } = await api('/api/admin/agents/runs', { method: 'POST', body: { gameId: S.gameId, prompt, agent, images, runId: S.runId || undefined } });
  S.refs = [];
  renderRefs();
  const isNew = runId !== S.runId;
  S.runId = runId;
  $('#prompt').value = '';
  if (isNew) { $('#log').innerHTML = ''; S.lastEventId = 0; }
  streamRun(runId);
}

async function openRun(runId) {
  S.lastEventId = 0;
  const r = await api(`/api/admin/agents/runs/${runId}`);
  for (const e of r.events) renderEvent(e);
  showUsage(r.usage);
  if (r.running) streamRun(runId);
}

async function streamRun(runId) {
  S.runStream?.abort();
  const ctrl = new AbortController();
  S.runStream = ctrl;
  setAgentsBusy(true);
  try {
    const res = await fetch(`/api/admin/agents/runs/${runId}/events?after=${S.lastEventId || 0}`, { headers: { authorization: `Bearer ${S.token}` }, signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!data) continue;
        const e = JSON.parse(data.slice(6));
        if (e.id && e.id <= (S.lastEventId || 0)) continue;
        renderEvent(e);
        if (e.type === 'done') { ctrl.abort(); break; }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Conexión con los agentes interrumpida: ${e.message}`, true);
  } finally {
    if (S.runStream === ctrl) { S.runStream = null; setAgentsBusy(false); }
  }
}

function setAgentsBusy(v) {
  S.agentsBusy = v;
  if ($('#sendBtn')) { $('#sendBtn').disabled = v; $('#cancelBtn').hidden = !v; }
}

const AGENT_NAMES = { director: '🎬 Director', designer: '🎨 Diseñador', artist: '🖌 Artista', sound: '🎵 Sonido', math: '📈 Matemático' };
const TOOL_NAMES = {
  get_game_config: 'lee la configuración', update_config: 'edita el borrador', list_assets: 'revisa los assets', view_asset: 'mira una imagen',
  generate_image: 'genera una imagen', edit_image: 'edita una imagen', remove_background: 'quita el fondo', upscale_image: 'mejora la resolución',
  generate_sound: 'genera un sonido', generate_music: 'compone música', simulate_rtp: 'simula el RTP', tune_rtp: 'ajusta el RTP',
  engine_info: 'consulta las reglas', delegate: 'delega',
};

function renderEvent(e) {
  const log = $('#log');
  if (!log) return;
  if (e.id) S.lastEventId = Math.max(S.lastEventId || 0, e.id);
  const d = e.data || {};
  const add = (html, cls = 'evt') => { const el = document.createElement('div'); el.className = cls; el.innerHTML = html; log.appendChild(el); log.scrollTop = log.scrollHeight; };
  switch (e.type) {
    case 'user': add(`<div class="who">Tú → ${esc(AGENT_NAMES[d.agent] || d.agent)}</div>${(d.images || []).length ? `<div class="ref-thumbs in-msg">${d.images.map((im) => `<a href="${esc(im.url)}" target="_blank"><img src="${esc(im.url)}" alt="" /></a>`).join('')}</div>` : ''}${esc(d.text)}`, 'msg user'); break;
    case 'message': add(`<div class="who">${esc(AGENT_NAMES[d.agent] || d.agent)}</div>${esc(d.text)}`, 'msg'); break;
    case 'agent_start': add(`${esc(AGENT_NAMES[d.agent])} empieza: <span class="muted">${esc(d.task.slice(0, 220))}${d.task.length > 220 ? '…' : ''}</span>`, 'evt agent'); break;
    case 'agent_done': add(`${esc(AGENT_NAMES[d.agent])} terminó.`, 'evt agent'); break;
    case 'tool_call': add(`<b>${esc(AGENT_NAMES[d.agent] || d.agent)}</b> ${esc(TOOL_NAMES[d.tool] || d.tool)}${d.tool === 'delegate' ? ` → ${esc(AGENT_NAMES[d.input.agent])}` : d.input?.assignTo ? ` → ${esc(d.input.assignTo)}` : d.input?.slot ? ` → ${esc(d.input.slot)}` : ''}`); break;
    case 'tool_result': if (!d.ok) add(`⚠ ${esc(d.tool)}: ${esc(d.preview)}`, 'evt err'); break;
    case 'progress': add(`⏳ ${esc(d.message)}`); break;
    case 'warning': add(`⚠ ${esc(d.message)}`, 'evt err'); break;
    case 'asset_created': {
      const a = d.asset;
      add(a.kind === 'image'
        ? `<div class="asset-inline"><img src="${esc(a.url)}" alt="" /><div><div class="muted"><code>${esc(a.id)}</code></div><div>${esc((a.prompt || '').slice(0, 140))}</div></div></div>`
        : `<div class="asset-inline"><audio controls src="${esc(a.url)}"></audio><div class="muted">${esc((a.prompt || '').slice(0, 100))}</div></div>`, 'evt');
      break;
    }
    case 'config_changed': add(`✎ ${esc(AGENT_NAMES[d.agent])}: ${esc((d.ops || []).map((o) => o.path).join(', ').slice(0, 200))}${d.reason ? ` — <span class="muted">${esc(d.reason)}</span>` : ''}`);
      refreshGame().then(() => reloadPreview()).catch(() => {});
      break;
    case 'error': add(`✖ ${esc(d.message)}`, 'evt err'); break;
    case 'done':
      add(`— ${d.status === 'done' ? 'Listo. Revisa la vista previa y publica si te gusta.' : d.status === 'cancelled' ? 'Detenido.' : 'Terminó con error.'}`, 'evt agent');
      showUsage(d.usage);
      refreshGame().then(() => { reloadPreview(); loadGames(); }).catch(() => {});
      break;
    default: break;
  }
}

function showUsage(u) {
  if (!u || !$('#usage')) return;
  const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  $('#usage').textContent = `Tokens: ${inTok.toLocaleString('es')} entrada · ${(u.output_tokens || 0).toLocaleString('es')} salida`;
}

// ------------------------------------------------------------------ Pestaña: Diseño
const BUTTONS = [['spin', 'Girar', '↻'], ['auto', 'Automático', 'AUTO'], ['turbo', 'Turbo', '⚡'], ['sound', 'Sonido', '🔊'],
  ['minus', 'Bajar apuesta', '−'], ['plus', 'Subir apuesta', '+'], ['max', 'Apuesta máxima', 'MÁX'], ['fullscreen', 'Pantalla completa', '⛶'], ['rotate', 'Girar pantalla (celular)', '⟳'], ['info', 'Reglas', 'i'], ['buy', 'Comprar bonus', 'COMPRAR BONUS']];

// ---- Interfaces del juego (theme.hud.layout) con miniatura y colores sugeridos ----
const UIS = [
  ['pill', 'Píldora', 'Botonera flotante bajo los rodillos', null],
  ['classic', 'Clásica', 'Barra de ancho completo abajo', null],
  ['neon', 'Neón', 'Tubos de luz y noche de ciudad', { primary: '#ff2d78', accent: '#00e5ff', panel: '#0b0716', text: '#ffffff' }],
  ['cristal', 'Cristal', 'Vidrio esmerilado que flota', { primary: '#7c5cff', accent: '#7ef9ff', panel: '#101a33', text: '#ffffff' }],
  ['brasa', 'Brasa', 'Metal forjado y fuego', { primary: '#ff5a1f', accent: '#ffc247', panel: '#1a0805', text: '#fff4e6' }],
  ['real', 'Real', 'Oro, fichas de casino y monedas', { primary: '#b8860b', accent: '#ffd873', panel: '#120d05', text: '#fff8e1' }],
  ['arcade', 'Arcade', 'Gabinete retro, LED y botones gordos', { primary: '#ff3b3b', accent: '#39ff88', panel: '#0a0a12', text: '#ffffff' }],
  ['custom', 'Diseño libre', 'Mueve y escala cada botón y el tablero (PC y celular)', null],
];

/** Miniatura dibujada con CSS de cada interfaz (para elegir de un vistazo). */
function uiMock(key, pal) {
  const P = pal || { primary: '#e94560', accent: '#ffd460', panel: '#16213e' };
  const cells = Array.from({ length: 15 }, () => `<i style="background:${P.panel};border:1px solid ${P.accent}33;border-radius:2px"></i>`).join('');
  const grid = `<div style="position:absolute;left:24%;right:24%;top:${['pill', 'classic'].includes(key) ? 14 : 22}%;height:44%;display:grid;grid-template-columns:repeat(5,1fr);gap:2px">${cells}</div>`;
  const top = ['pill', 'classic'].includes(key) ? '' : `<div style="position:absolute;left:${key === 'cristal' ? '4%' : 0};right:${key === 'cristal' ? '4%' : 0};top:${key === 'cristal' ? '4%' : 0};height:11%;
    background:${key === 'cristal' ? 'rgba(255,255,255,.14)' : key === 'arcade' ? '#07070d' : 'rgba(0,0,0,.7)'};border-radius:${key === 'cristal' ? 6 : 0}px;${key === 'neon' ? `border-bottom:1px solid ${P.primary};box-shadow:0 0 6px ${P.primary}` : key === 'arcade' ? `border-bottom:2px solid ${P.primary}` : ''}"></div>`;
  const side = ['pill', 'classic'].includes(key) ? '' : `<div style="position:absolute;${key === 'cristal' ? 'left:3%' : 'right:3%'};top:24%;width:${key === 'cristal' ? 7 : 13}%;display:flex;flex-direction:column;gap:3px">
    ${'<i style="height:8px;border-radius:2px;background:rgba(255,255,255,.18)"></i>'.repeat(4)}</div>`;
  if (key === 'custom') {
    const bs = (x, y, d, r = '50%', c = P.primary) => `<i style="position:absolute;left:${x}%;top:${y}%;width:${d}px;height:${d}px;transform:translate(-50%,-50%);border-radius:${r};background:${c};box-shadow:0 0 0 1px ${P.accent}88"></i>`;
    return `<div style="position:relative;width:100%;aspect-ratio:16/10;border-radius:10px;overflow:hidden;background:radial-gradient(#1d3b2a,#06120b)">${grid}
      <div style="position:absolute;left:5%;right:5%;bottom:5%;height:17%;border-radius:8px;background:linear-gradient(#0f3d28,#062014);border:1px solid ${P.accent}88"></div>
      ${bs(10, 86, 8, '50%', '#888')}${bs(26, 86, 12)}${bs(35, 86, 12)}<i style="position:absolute;left:44%;top:86%;width:16px;height:10px;transform:translate(-50%,-50%);border-radius:99px;background:${P.accent}"></i>
      ${bs(50, 84, 22, '50%', P.accent)}${bs(62, 86, 12)}${bs(71, 86, 12)}${bs(90, 86, 8, '50%', '#888')}
      <i style="position:absolute;left:18%;top:24%;font:700 9px system-ui;color:#9fe3ff;font-style:normal">✥ mover</i></div>`;
  }
  const spinStyle = {
    neon: `border-radius:50%;background:${P.primary};box-shadow:0 0 8px ${P.primary},0 0 0 2px ${P.accent}`,
    cristal: `border-radius:50%;background:rgba(255,255,255,.3);box-shadow:0 0 0 2px ${P.accent}`,
    brasa: `clip-path:polygon(25% 3%,75% 3%,100% 50%,75% 97%,25% 97%,0 50%);background:linear-gradient(0deg,${P.primary},${P.accent})`,
    real: `border-radius:50%;background:conic-gradient(#fff6c9,${P.accent},#8a6408,#fff6c9);box-shadow:0 0 0 2px #5a4105`,
    arcade: `border-radius:5px;width:26px;background:${P.primary};box-shadow:0 3px 0 #000`,
  }[key] || `border-radius:50%;background:${P.primary};box-shadow:0 0 0 2px ${P.accent}`;
  const dockBg = { pill: 'transparent', classic: 'rgba(0,0,0,.75)', neon: '#0a0614', cristal: 'rgba(255,255,255,.14)', brasa: 'linear-gradient(0deg,#0e0301,#2a0c05)', real: 'linear-gradient(0deg,#000,transparent)', arcade: '#0c0c14' }[key];
  const dock = key === 'pill'
    ? `<div style="position:absolute;left:18%;right:18%;bottom:12%;height:13%;border-radius:99px;background:rgba(0,0,0,.75);border:1px solid ${P.accent}88"></div>`
    : `<div style="position:absolute;left:${key === 'cristal' ? '10%' : 0};right:${key === 'cristal' ? '10%' : 0};bottom:${key === 'cristal' ? '4%' : 0};height:20%;background:${dockBg};border-radius:${key === 'cristal' ? 10 : 0}px;
      ${key === 'neon' ? `border-top:1px solid ${P.primary}` : key === 'brasa' ? `border-top:1px solid ${P.accent}` : ''};display:flex;align-items:center;gap:3px;padding-left:8%">
      ${['pill', 'classic'].includes(key) ? '' : Array.from({ length: 4 }, (_, i) => `<i style="width:10px;height:8px;border-radius:${key === 'real' ? '50%' : '2px'};background:${i === 1 ? P.accent : 'rgba(255,255,255,.22)'}"></i>`).join('')}</div>`;
  const spin = `<div style="position:absolute;left:50%;bottom:${key === 'pill' ? 9 : 5}%;transform:translateX(-50%);width:20px;height:20px;${spinStyle}"></div>`;
  const bg = { neon: 'radial-gradient(#2a0f3a,#05030a)', cristal: 'linear-gradient(135deg,#1c2a55,#3a1f5c)', brasa: 'radial-gradient(#3a0e05,#080100)', real: 'radial-gradient(#2a1f08,#050402)', arcade: '#0a0a12' }[key] || 'radial-gradient(#2a2f4a,#0b0d17)';
  return `<div style="position:relative;width:100%;aspect-ratio:16/10;border-radius:10px;overflow:hidden;background:${bg}">${grid}${top}${side}${dock}${spin}</div>`;
}

async function tabDesign(v) {
  const t = S.game.draft.theme || {};
  const p = t.palette || {};
  const B = t.buttons || {};
  const color = (k, label) => `<div><label>${label}</label><input type="color" data-pal="${k}" value="${esc(p[k] || '#000000')}" /></div>`;
  const ANIM = ['background', 'backgroundMobile', 'reelsBackground'];
  const thumb = (u) => (/\.(mp4|webm)(\?|$)/i.test(u) ? `<video src="${esc(u)}" muted loop autoplay playsinline style="height:54px;border-radius:6px;background:#0006"></video>` : `<img src="${esc(u)}" style="height:54px;border-radius:6px;background:#0006" />`);
  const imgField = (k, label) => `<div><label>${label}${ANIM.includes(k) ? ' <span class="muted">(imagen, GIF o video)</span>' : ''}</label><div class="row">
    ${t[k] ? thumb(t[k]) : '<span class="muted">Sin imagen</span>'}
    <button class="small" data-img="${k}">Elegir…</button>${t[k] ? `<button class="small danger" data-clear="${k}">Quitar</button>` : ''}</div></div>`;
  const curUi = t.hud?.layout || 'pill';
  const fontRow = (k, label) => `<div><label>${label} ${t[`${k}Url`] ? '<span class="badge ok">archivo propio</span>' : ''}</label>
    <input id="f-${k}" list="dFontList" value="${esc(t[k] || '')}" placeholder="La del juego" ${t[`${k}Url`] ? 'readonly' : ''} />
    <div class="row" style="margin-top:6px"><button class="small" data-fkup="${k}">Subir tipografía…</button>${t[k] ? `<button class="small danger" data-fkx="${k}">Quitar</button>` : ''}</div></div>`;
  const slider = (id, label, val, min, max, step, unit) => `<div><label>${label} (<span id="${id}V">${unit === '%' ? Math.round(val * 100) : val}</span> ${unit})</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-unit="${unit}" /></div>`;
  const isCrash = engineInfo(S.game.engine).kind === 'crash';
  const isTableGame = engineInfo(S.game.engine).kind === 'table' || isCrash;
  v.innerHTML = `<div class="stack">
    ${isTableGame ? '' : `<div class="card stack"><h3 style="margin:0">Interfaz del juego</h3>
      <p class="muted">Elige cómo se ve y se ordena todo alrededor de los rodillos: saldo, fichas de apuesta, botón GIRAR, menú y efectos de premio. Funciona en PC y celular.</p>
      <div class="ui-grid">${UIS.map(([k, n, d, pal]) => `<button class="ui-tile ${curUi === k ? 'on' : ''}" data-ui="${k}">${uiMock(k, curUi === k ? (t.palette || pal) : pal)}<b>${n}</b><span class="muted">${d}</span></button>`).join('')}</div>
      <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="uiPal" style="width:auto" checked /> Aplicar también los colores sugeridos de la interfaz (luego puedes cambiarlos en Paleta)</label></div>`}
    ${!isTableGame && curUi === 'custom' ? customHudCard(t) : ''}
    ${isTableGame ? winTiersCard(t) : messagesCard(t) + winTiersCard(t) + bonusCard(t)}
    <div class="card stack"><h3 style="margin:0">Identidad</h3>
      <div class="grid2">
        <div><label>Nombre del juego</label><input id="dName" value="${esc(S.game.draft.name)}" /></div>
        <div><label>Título visible</label><input id="dTitle" value="${esc(t.title)}" /></div>
        <div><label>Tipografía del juego ${t.fontUrl ? '<span class="badge ok">archivo propio</span>' : '(Google Fonts)'}</label><input id="dFont" value="${esc(t.font)}" placeholder="Bungee, Cinzel Decorative, Orbitron…" ${t.fontUrl ? 'readonly' : ''} />
          <div class="row" style="margin-top:6px"><button class="small" data-fontup="theme">Subir tipografía…</button>${t.fontUrl ? '<button class="small danger" data-fontclear="theme">Quitar archivo</button>' : ''}</div></div>
        <div><label>Color de fondo</label><input type="color" id="dBg" value="${esc(t.backgroundColor || '#000000')}" /></div>
        ${fontRow('infoFont', 'Tipografía de la pantalla de información (reglas, tabla de premios, menú e historial)')}
        ${isTableGame && !isCrash ? fontRow('tableFont', 'Tipografía de los textos de la mesa (apuestas, fichas, botones)') : ''}
      </div>${fontDatalist('dFontList')}</div>
    <div class="card stack"><h3 style="margin:0">Paleta</h3><div class="grid2">
      ${color('primary', 'Principal (botón girar)')}${color('accent', 'Acento (marcos, premios)')}${color('panel', 'Panel inferior')}${color('text', 'Texto')}${color('reelBg', 'Fondo de rodillos')}
    </div></div>
    <div class="card stack"><h3 style="margin:0">Imágenes</h3><div class="grid2">
      ${isCrash ? `${imgField('background', 'Fondo de la página (detrás de los paneles)')}${imgField('logo', 'Logo (arriba a la izquierda del escenario)')}` : `${imgField('background', 'Fondo PC (horizontal 16:9)')}${imgField('backgroundMobile', 'Fondo celular (vertical 9:16)')}
      ${imgField('logo', 'Logo')}${imgField('reelsBackground', 'Fondo detrás de los rodillos')}
      ${engineInfo(S.game.engine).kind === 'table' ? imgField('tableImage', 'Paño de la mesa') : `${imgField('cellImage', 'Fondo de cada celda')}${imgField('frame', 'Marco decorativo')}`}`}
    </div></div>
    ${isCrash ? crashStageCard(t) : ''}
    <div class="card stack" ${isCrash ? 'hidden' : ''}><h3 style="margin:0">Logo y marco: tamaño y posición</h3>
      <p class="muted" style="margin:0">Mueve el logo${isTableGame ? '' : ' y el marco decorativo'} hacia arriba (negativo) o hacia abajo (positivo)${isTableGame ? '' : '; el marco además se estira o achica a lo ANCHO y a lo ALTO por separado (100 % = justo a los rodillos)'}. PC y celular se ajustan por separado; mira el cambio en ▶ Vista previa. También se lo puedes pedir al agente: «el marco más ancho y un poco más bajo».</p>
      <div class="grid2">
        ${slider('pLogoScale', 'Tamaño del logo', t.logoScale ?? 1, 0.4, 1.8, 0.05, '%')}
        <div></div>
        ${slider('pLogoY', 'Logo — subir / bajar en PC', t.logoOffsetY ?? 0, -200, 200, 2, 'px')}
        ${slider('pLogoYM', 'Logo — subir / bajar en celular', t.logoOffsetYMobile ?? t.logoOffsetY ?? 0, -200, 200, 2, 'px')}
        ${isTableGame ? '' : `${slider('pFrameY', 'Marco — subir / bajar en PC', t.frameOffsetY ?? 0, -150, 150, 2, 'px')}
        ${slider('pFrameYM', 'Marco — subir / bajar en celular', t.frameOffsetYMobile ?? t.frameOffsetY ?? 0, -150, 150, 2, 'px')}
        ${slider('pFrameW', 'Marco — ANCHO en PC', t.frameScaleX ?? t.frameScale ?? 1.12, 0.5, 2.5, 0.01, '%')}
        ${slider('pFrameWM', 'Marco — ANCHO en celular', t.frameScaleXMobile ?? t.frameScaleX ?? t.frameScale ?? 1.12, 0.5, 2.5, 0.01, '%')}
        ${slider('pFrameH', 'Marco — ALTO en PC', t.frameScaleY ?? t.frameScale ?? 1.12, 0.5, 2.5, 0.01, '%')}
        ${slider('pFrameHM', 'Marco — ALTO en celular', t.frameScaleYMobile ?? t.frameScaleY ?? t.frameScale ?? 1.12, 0.5, 2.5, 0.01, '%')}
        ${slider('pFrameX', 'Marco — izquierda / derecha en PC', t.frameOffsetX ?? 0, -400, 400, 2, 'px')}
        ${slider('pFrameXM', 'Marco — izquierda / derecha en celular', t.frameOffsetXMobile ?? t.frameOffsetX ?? 0, -400, 400, 2, 'px')}`}
      </div>
      <div class="row"><button class="small" id="pReset">Volver a la posición original</button></div></div>
    ${engineInfo(S.game.engine).kind === 'table' ? diceCard(t.dice || {}) + croupierCard(S.game.draft) : ''}
    <div class="card stack" ${isTableGame ? 'hidden' : ''}><h3 style="margin:0">Rodillos y símbolos</h3><div class="grid2">
      <div><label>Tamaño de los símbolos (<span id="lScaleV">${Math.round((t.symbolScale ?? 0.92) * 100)}</span> % de la celda)</label><input id="lScale" type="range" min="0.6" max="1" step="0.01" value="${t.symbolScale ?? 0.92}" /></div>
      <div><label>Separación entre celdas (<span id="lGapV">${t.cellGap ?? 6}</span> px)</label><input id="lGap" type="range" min="0" max="16" step="1" value="${t.cellGap ?? 6}" /></div>
      <div><label>Color de las celdas</label><input id="lCell" type="color" value="${esc(t.cellColor || p.reelBg || '#0f3460')}" /></div>
      <div><label>Opacidad de las celdas</label><input id="lAlpha" type="range" min="0" max="1" step="0.05" value="${t.cellAlpha ?? 0.82}" /></div>
      <div><label>Borde de las celdas</label><div class="row"><input id="lBorder" type="color" value="${esc(t.cellBorder && t.cellBorder !== 'none' ? t.cellBorder : (p.accent || '#ffd460'))}" style="width:70px" /><label style="margin:0"><input id="lNoBorder" type="checkbox" style="width:auto" ${t.cellBorder === 'none' ? 'checked' : ''} /> sin borde</label></div></div>
      <div><label>Color del marco</label><input id="lFrame" type="color" value="${esc(t.frameColor || p.accent || '#ffd460')}" /></div>
      <div><label>Marco (imagen)</label><select id="lFrameLayer"><option value="back" ${t.frameLayer !== 'front' ? 'selected' : ''}>Detrás de los rodillos</option><option value="front" ${t.frameLayer === 'front' ? 'selected' : ''}>Delante de los rodillos</option></select>
        <label class="row" style="gap:6px;margin:6px 0 0;color:var(--text)"><input type="checkbox" id="lFrameCut" style="width:auto" ${t.frameCut !== false ? 'checked' : ''} /> Recortar el centro del marco (si la imagen no es transparente)</label></div>
      <div><label>Tamaño del marco (<span id="lFrameScaleV">${Math.round((t.frameScale ?? 1.12) * 100)}</span> %)</label><input id="lFrameScale" type="range" min="0.9" max="1.6" step="0.01" value="${t.frameScale ?? 1.12}" /></div>
      <div><label>Frase bajo los rodillos (celular)</label><input id="lTag" value="${esc(t.tagline || '')}" placeholder="Ej.: ¡El golpe continúa!" /></div>
    </div></div>
    <div class="card stack" ${isCrash ? 'hidden' : ''}><h3 style="margin:0">Botonera</h3><div class="grid2">
      <input type="hidden" id="hLayout" value="${esc(t.hud?.layout || 'pill')}" />
      <div><label>Color de la botonera</label><input id="hBar" type="color" value="${esc((t.hud?.barColor || '').startsWith('#') ? t.hud.barColor : '#0a080c')}" /></div>
      <div><label>Borde de la botonera</label><input id="hBorder" type="color" value="${esc(t.hud?.barBorder || p.accent || '#ffd460')}" /></div>
      <div><label>Tamaño del botón GIRAR (<span id="hSpinV">${t.hud?.spinSize || 84}</span> px)</label><input id="hSpin" type="range" min="56" max="130" step="2" value="${t.hud?.spinSize || 84}" /></div>
      <div><label>Tipografía de la botonera ${t.hud?.fontUrl ? '<span class="badge ok">archivo propio</span>' : ''}</label><input id="hFont" value="${esc(t.hud?.font || '')}" placeholder="La del juego" ${t.hud?.fontUrl ? 'readonly' : ''} />
        <div class="row" style="margin-top:6px"><button class="small" data-fontup="hud">Subir tipografía…</button>${t.hud?.fontUrl ? '<button class="small danger" data-fontclear="hud">Quitar archivo</button>' : ''}</div></div>
      <div><label>Tamaño general de la interfaz (<span id="hScaleV">${Math.round((t.hud?.scale || 1) * 100)}</span> %)</label><input id="hScale" type="range" min="0.8" max="1.4" step="0.05" value="${t.hud?.scale || 1}" /></div>
      <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="hMax" style="width:auto" ${(t.hud?.maxBet ?? true) ? 'checked' : ''} /> Mostrar botón de apuesta máxima (MÁX)</label>
      <label class="row" style="gap:8px;margin:0;color:var(--text)" title="El botón ⚡ pasa por normal → turbo → HYPER. Desactívalo en mercados que exigen un tiempo mínimo por giro."><input type="checkbox" id="hHyper" style="width:auto" ${t.hud?.hyper !== false ? 'checked' : ''} /> Permitir HYPER play (resultado al instante, mismo RTP)</label>
    </div></div>
    ${isTableGame ? '' : metersCard(t.hud?.meters || {}, p)}
    <div class="card stack" ${isCrash ? 'hidden' : ''}><h3 style="margin:0">Botones del juego</h3>
      <div class="grid2">
        <div><label>Forma</label><select id="bShape">${[['round', 'Redondos'], ['rounded', 'Esquinas suaves'], ['square', 'Cuadrados'], ['pill', 'Píldora']].map(([v, l]) => `<option value="${v}" ${(B.shape || 'round') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>Estilo</label><select id="bStyle">${[['gradient', 'Degradado'], ['flat', 'Plano'], ['glass', 'Vidrio'], ['outline', 'Solo borde']].map(([v, l]) => `<option value="${v}" ${(B.style || 'gradient') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>Tamaño (${Number(B.size || 1).toFixed(2)}×)</label><input id="bSize" type="range" min="0.8" max="1.4" step="0.05" value="${B.size || 1}" /></div>
        <div><label>Color de botones pequeños</label><input id="bColor" type="color" value="${esc(B.color || '#333a55')}" /></div>
        <div><label>Color del texto/icono</label><input id="bText" type="color" value="${esc(B.textColor || p.text || '#ffffff')}" /></div>
      </div>
      <table><thead><tr><th>Botón</th><th>Imagen</th><th>Icono o texto</th><th></th></tr></thead><tbody>
      ${BUTTONS.filter(([k]) => k !== 'buy' || S.game.engine === 'bonus-buy').map(([k, l, def]) => {
    const s = B[k] || {};
    const img = s.image || (k === 'spin' ? t.spinButton : null);
    return `<tr data-btn="${k}"><td>${l}</td>
          <td>${img ? `<img src="${esc(img)}" style="height:40px;max-width:110px;object-fit:contain;background:#0006;border-radius:6px" />` : '<span class="muted">—</span>'}</td>
          <td><input data-icon value="${esc(s.icon || '')}" placeholder="${esc(def)}" style="max-width:140px" /></td>
          <td class="row"><button class="small" data-bimg>Imagen…</button>${img ? '<button class="small" data-bcut title="Borra el fondo cuadrado de la imagen">✂ Quitar fondo</button><button class="small danger" data-bclear>Quitar imagen</button>' : ''}</td></tr>`;
  }).join('')}
      </tbody></table>
      <div class="row"><button class="small" id="bCutAll">✂ Quitar el fondo cuadrado a todos los botones con imagen</button><span class="muted">Si un botón se ve con un cuadrado atrás, es que su imagen trae ese fondo pintado.</span></div>
      <p class="muted">Con imagen, el botón muestra la imagen tal cual. Sin imagen, usa la forma, el estilo, los colores y el icono. Pídele al agente 🖌 Artista “crea botones dorados estilo egipcio para todo el juego”.</p>
    </div>
    <div class="row"><button class="primary" id="dSave">Guardar diseño</button><span class="muted">Consejo: en 🤖 Agentes puedes pedir “cambia el fondo por una selva de noche” y lo genera el Artista.</span></div>
  </div>`;
  bindCrashStageCard(v);
  $$('[data-ui]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const k = b.dataset.ui;
    const pal = UIS.find((x) => x[0] === k)[3];
    const ops = [{ op: 'merge', path: 'theme.hud', value: { layout: k } }];
    if (pal && $('#uiPal', v).checked) ops.push({ op: 'merge', path: 'theme.palette', value: pal });
    await patchDraft(ops, `Interfaz: ${UIS.find((x) => x[0] === k)[1]}. Mírala en ▶ Vista previa`);
    renderTab();
  })));
  for (const [inp, out, fmt] of [['#lScale', '#lScaleV', (x) => Math.round(x * 100)], ['#lGap', '#lGapV', (x) => x], ['#hSpin', '#hSpinV', (x) => x], ['#hScale', '#hScaleV', (x) => Math.round(x * 100)], ['#lFrameScale', '#lFrameScaleV', (x) => Math.round(x * 100)]]) {
    $(inp, v).addEventListener('input', (e) => { $(out, v).textContent = fmt(Number(e.target.value)); });
  }
  $$('[data-bimg]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const url = await pickAsset('image');
    if (url) { await patchDraft([{ op: 'set', path: `theme.buttons.${b.closest('tr').dataset.btn}.image`, value: url }]); renderTab(); }
  })));
  const btnImg = (k) => S.game.draft.theme?.buttons?.[k]?.image || (k === 'spin' ? S.game.draft.theme?.spinButton : null);
  $$('[data-bcut]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const k = b.closest('tr').dataset.btn;
    const url = await openBgRemover(btnImg(k));
    if (url) { await patchDraft([{ op: 'set', path: `theme.buttons.${k}.image`, value: url }], 'Fondo quitado. Mira el botón en ▶ Vista previa'); renderTab(); }
  })));
  $('#bCutAll', v)?.addEventListener('click', guard(async () => {
    const keys = $$('tr[data-btn]', v).map((tr) => tr.dataset.btn).filter((k) => btnImg(k));
    if (!keys.length) { toast('Ningún botón tiene imagen'); return; }
    const ops = [];
    const done = new Map(); // la misma imagen en varios botones se procesa una vez
    for (const k of keys) {
      const src = btnImg(k);
      if (!done.has(src)) {
        try { const r = removeBackground(await loadImageData(src), { tolerance: 40 }); done.set(src, r.seeds ? await uploadCanvasPng(r.canvas, src) : null); }
        catch { done.set(src, null); }
      }
      if (done.get(src)) ops.push({ op: 'set', path: `theme.buttons.${k}.image`, value: done.get(src) });
    }
    if (!ops.length) { toast('Las imágenes ya no tienen fondo en los bordes'); return; }
    await patchDraft(ops, `Fondo quitado a ${ops.length} botón(es). Si alguno quedó mal, usa ✂ en ese botón y ajusta la tolerancia`);
    renderTab();
  }));
  $$('[data-bclear]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const k = b.closest('tr').dataset.btn;
    const ops = [{ op: 'set', path: `theme.buttons.${k}.image`, value: null }];
    if (k === 'spin') ops.push({ op: 'set', path: 'theme.spinButton', value: null });
    await patchDraft(ops); renderTab();
  })));
  $$('[data-img]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const url = await pickAsset('image', { animated: ANIM.includes(b.dataset.img) });
    if (url) { await patchDraft([{ op: 'set', path: `theme.${b.dataset.img}`, value: url }]); renderTab(); }
  })));
  $$('[data-clear]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    await patchDraft([{ op: 'set', path: `theme.${b.dataset.clear}`, value: null }]); renderTab();
  })));
  $$('#pFrameWM, #pFrameHM, #pFrameXM', v).forEach((i) => i.addEventListener('input', () => { i.dataset.touched = '1'; }));
  $$('input[type=range][data-unit]', v).forEach((i) => i.addEventListener('input', () => { $(`#${i.id}V`, v).textContent = i.dataset.unit === '%' ? Math.round(i.value * 100) : i.value; }));
  $('#pReset', v).addEventListener('click', guard(async () => {
    await patchDraft(['logoScale', 'logoOffsetY', 'logoOffsetYMobile', 'frameOffsetY', 'frameOffsetYMobile', 'frameScaleX', 'frameScaleY', 'frameScaleXMobile', 'frameScaleYMobile', 'frameOffsetX', 'frameOffsetXMobile'].map((k) => ({ op: 'set', path: `theme.${k}`, value: null })), 'Logo y marco en su posición original');
    renderTab();
  }));
  $$('[data-fkup]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const a = await pickAsset('font');
    if (!a) return;
    const asset = typeof a === 'string' ? (await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId || '')}&kind=font`)).find((x) => x.url === a) : a;
    const k = b.dataset.fkup;
    await patchDraft([{ op: 'set', path: `theme.${k}`, value: fontFamilyOf(asset || { filename: 'Fuente propia' }) }, { op: 'set', path: `theme.${k}Url`, value: asset?.url || a }], 'Tipografía aplicada');
    renderTab();
  })));
  $$('[data-fkx]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const k = b.dataset.fkx;
    await patchDraft([{ op: 'set', path: `theme.${k}`, value: null }, { op: 'set', path: `theme.${k}Url`, value: null }], 'Tipografía quitada');
    renderTab();
  })));
  bindMetersCard(v);
  bindDiceCard(v);
  bindCroupierCard(v);
  bindCustomHudCard(v);
  bindMessagesCard(v);
  bindWinTiersCard(v);
  bindBonusCard(v);
  $$('[data-fontup]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const a = await pickAsset('font');
    if (!a) return;
    const asset = typeof a === 'string' ? (await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId || '')}&kind=font`)).find((x) => x.url === a) : a;
    const fam = fontFamilyOf(asset || { filename: 'Fuente propia' });
    const url = asset?.url || a;
    const base = b.dataset.fontup === 'hud' ? 'theme.hud' : 'theme';
    await patchDraft([{ op: 'set', path: `${base}.font`, value: fam }, { op: 'set', path: `${base}.fontUrl`, value: url }], `Tipografía «${fam}» aplicada`);
    renderTab();
  })));
  $$('[data-fontclear]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const base = b.dataset.fontclear === 'hud' ? 'theme.hud' : 'theme';
    await patchDraft([{ op: 'set', path: `${base}.fontUrl`, value: null }, ...(base === 'theme.hud' ? [{ op: 'set', path: 'theme.hud.font', value: null }] : [])], 'Tipografía quitada');
    renderTab();
  })));
  $('#dSave').addEventListener('click', guard(async () => {
    const palette = Object.fromEntries($$('[data-pal]', v).map((i) => [i.dataset.pal, i.value]));
    await patchDraft([
      { op: 'set', path: 'name', value: $('#dName').value },
      { op: 'set', path: 'theme.title', value: $('#dTitle').value },
      { op: 'set', path: 'theme.font', value: $('#dFont').value },
      { op: 'set', path: 'theme.backgroundColor', value: $('#dBg').value },
      ...['infoFont', 'tableFont'].filter((k) => $(`#f-${k}`) && !$(`#f-${k}`).readOnly).map((k) => ({ op: 'set', path: `theme.${k}`, value: $(`#f-${k}`).value.trim() || null })),
      { op: 'merge', path: 'theme.palette', value: palette },
      { op: 'set', path: 'theme.symbolScale', value: Number($('#lScale').value) },
      { op: 'set', path: 'theme.cellGap', value: Number($('#lGap').value) },
      { op: 'set', path: 'theme.cellColor', value: $('#lCell').value },
      { op: 'set', path: 'theme.cellAlpha', value: Number($('#lAlpha').value) },
      { op: 'set', path: 'theme.cellBorder', value: $('#lNoBorder').checked ? 'none' : $('#lBorder').value },
      { op: 'set', path: 'theme.frameColor', value: $('#lFrame').value },
      { op: 'set', path: 'theme.frameLayer', value: $('#lFrameLayer').value },
      { op: 'set', path: 'theme.frameScale', value: Number($('#lFrameScale').value) },
      { op: 'set', path: 'theme.frameCut', value: $('#lFrameCut').checked },
      { op: 'set', path: 'theme.tagline', value: $('#lTag').value.trim() || null },
      { op: 'set', path: 'theme.logoScale', value: Number($('#pLogoScale').value) === 1 ? null : Number($('#pLogoScale').value) },
      { op: 'set', path: 'theme.logoOffsetY', value: Number($('#pLogoY').value) || null },
      { op: 'set', path: 'theme.logoOffsetYMobile', value: Number($('#pLogoYM').value) || null },
      ...($('#pFrameY') ? [{ op: 'set', path: 'theme.frameOffsetY', value: Number($('#pFrameY').value) || null }, { op: 'set', path: 'theme.frameOffsetYMobile', value: Number($('#pFrameYM').value) || null }] : []),
      ...($('#pFrameW') ? (() => {
        // Ancho/alto: se guardan solo si difieren del «Tamaño del marco» (PC) o del valor de PC (celular); así ese control sigue mandando
        const base = Number($('#lFrameScale').value), num = (id) => Number($(id).value);
        // Los de celular que no se tocaron siguen al de PC (si ya tenían valor propio, se conserva)
        const mob = (id, key) => ($(id).dataset.touched || t[key] != null ? num(id) : null);
        const own = (val, ref) => (Math.abs(val - ref) < 0.005 ? null : val);
        const w = own(num('#pFrameW'), base), hh = own(num('#pFrameH'), base);
        const x = num('#pFrameX') || null;
        return [
          { op: 'set', path: 'theme.frameScaleX', value: w }, { op: 'set', path: 'theme.frameScaleY', value: hh },
          { op: 'set', path: 'theme.frameScaleXMobile', value: mob('#pFrameWM', 'frameScaleXMobile') == null ? null : own(num('#pFrameWM'), w ?? base) },
          { op: 'set', path: 'theme.frameScaleYMobile', value: mob('#pFrameHM', 'frameScaleYMobile') == null ? null : own(num('#pFrameHM'), hh ?? base) },
          { op: 'set', path: 'theme.frameOffsetX', value: x },
          { op: 'set', path: 'theme.frameOffsetXMobile', value: mob('#pFrameXM', 'frameOffsetXMobile') == null || num('#pFrameXM') === (x || 0) ? null : num('#pFrameXM') },
        ];
      })() : []),
      ...($('#mCard') ? [{ op: 'set', path: 'theme.hud.meters', value: readMeters(v, t.hud?.meters || {}) }] : []),
      { op: 'merge', path: 'theme.hud', value: { layout: $('#hLayout').value, barColor: `${$('#hBar').value}d9`, barBorder: $('#hBorder').value, spinSize: Number($('#hSpin').value), maxBet: $('#hMax').checked, hyper: $('#hHyper').checked, scale: Number($('#hScale').value), ...(t.hud?.fontUrl ? {} : { font: $('#hFont').value.trim() || null }) } },
      { op: 'merge', path: 'theme.buttons', value: { shape: $('#bShape').value, style: $('#bStyle').value, size: Number($('#bSize').value), color: $('#bColor').value, textColor: $('#bText').value } },
      ...$$('tr[data-btn]', v).map((tr) => ({ op: 'set', path: `theme.buttons.${tr.dataset.btn}.icon`, value: $('[data-icon]', tr).value.trim() || null })),
    ]);
    loadGames();
  }));
}

// ---- Marcadores de la botonera (SALDO / APUESTA / PREMIO) ----
function metersCard(M, p) {
  const L = M.labels || {};
  const boxMode = M.box === 'none' ? 'none' : (M.bg || M.border || M.bgImage) ? 'custom' : 'theme';
  const fontField = (k, label, ph) => `<div><label>${label} ${M[`${k}FontUrl`] ? '<span class="badge ok">archivo propio</span>' : ''}</label>
      <input id="mF${k}" list="mFontList" value="${esc(M[`${k}Font`] || '')}" placeholder="${ph}" ${M[`${k}FontUrl`] ? 'readonly' : ''} />
      <div class="row" style="margin-top:6px"><button class="small" data-mfontup="${k}">Subir tipografía…</button>${M[`${k}Font`] ? `<button class="small danger" data-mfontx="${k}">Quitar</button>` : ''}</div></div>`;
  const colors = !!(M.labelColor || M.valueColor || M.winColor);
  const bgHex = (M.bg || '#000000b8').slice(0, 7), bgA = M.bg && M.bg.length === 9 ? parseInt(M.bg.slice(7), 16) / 255 : 0.72;
  return `<div class="card stack" id="mCard"><h3 style="margin:0">Saldo, apuesta y premio</h3>
    <p class="muted" style="margin:0">Títulos, colores y recuadro de los marcadores de la botonera. En Diseño libre además se mueven y cambian de tamaño en el editor.</p>
    <div class="meter-prev" id="mPrev">${['SALDO|1.000,00|saldo', 'APUESTA|1,00|apuesta', 'PREMIO|25,00|premio'].map((x) => { const [a, b, c] = x.split('|'); return `<div class="mp ${c}"><small>${a}</small><b>${b}</b></div>`; }).join('')}</div>
    <div class="grid2">
      <div><label>Título de SALDO</label><input id="mLb" value="${esc(L.balance || '')}" placeholder="SALDO" /></div>
      <div><label>Título de APUESTA</label><input id="mLa" value="${esc(L.bet || '')}" placeholder="APUESTA" /></div>
      <div><label>Título de PREMIO</label><input id="mLp" value="${esc(L.win || '')}" placeholder="PREMIO" /></div>
      <div><label>Tamaño de los números (<span id="mVsV">${Math.round((M.valueScale || 1) * 100)}</span> %)</label><input id="mVs" type="range" min="0.7" max="1.6" step="0.05" value="${M.valueScale || 1}" /></div>
      <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="mShow" style="width:auto" ${M.showLabels !== false ? 'checked' : ''} /> Mostrar los títulos</label>
      <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="mColors" style="width:auto" ${colors ? 'checked' : ''} /> Colores propios</label>
      <div><label>Color del título</label><input type="color" id="mCl" value="${esc(M.labelColor || p.text || '#ffffff')}" /></div>
      <div><label>Color del número</label><input type="color" id="mCv" value="${esc(M.valueColor || p.text || '#ffffff')}" /></div>
      <div><label>Color del número de PREMIO</label><input type="color" id="mCw" value="${esc(M.winColor || p.accent || '#ffd460')}" /></div>
      <div></div>
      ${fontField('label', 'Tipografía de los títulos', 'La de la botonera')}
      ${fontField('value', 'Tipografía de los números', 'La de la botonera')}
      <datalist id="mFontList">${['Cinzel', 'Cinzel Decorative', 'Bungee', 'Orbitron', 'Russo One', 'Oswald', 'Anton', 'Bebas Neue', 'Righteous', 'Luckiest Guy', 'Rye', 'Uncial Antiqua', 'Pirata One', 'Black Ops One', 'Teko', 'Rajdhani', 'Playfair Display', 'Abril Fatface', 'Alfa Slab One', 'Titan One', 'Lilita One', 'Press Start 2P'].map((f) => `<option value="${f}">`).join('')}</datalist>
      <div><label>Recuadro</label><select id="mBoxMode">
        <option value="theme" ${boxMode === 'theme' ? 'selected' : ''}>El de la interfaz</option>
        <option value="none" ${boxMode === 'none' ? 'selected' : ''}>Sin recuadro (se ve tu tablero o fondo)</option>
        <option value="custom" ${boxMode === 'custom' ? 'selected' : ''}>Personalizado (colores e imagen de abajo)</option></select></div>
      <div></div>
      <div class="mcustom"><label>Fondo del recuadro</label><input type="color" id="mBg" value="${esc(bgHex)}" /></div>
      <div class="mcustom"><label>Opacidad del fondo (<span id="mBaV">${Math.round(bgA * 100)}</span> %)</label><input id="mBa" type="range" min="0" max="1" step="0.05" value="${bgA}" /></div>
      <div class="mcustom"><label>Borde del recuadro</label><input type="color" id="mBd" value="${esc(M.border || p.accent || '#ffd460')}" /></div>
      <div class="mcustom"><label>Esquinas (<span id="mRV">${M.radius ?? 10}</span> px)</label><input id="mR" type="range" min="0" max="40" step="1" value="${M.radius ?? 10}" /></div>
      <div class="mcustom"><label>Imagen del recuadro <span class="muted">(opcional)</span></label><div class="row">${M.bgImage ? `<img src="${esc(M.bgImage)}" style="height:40px;border-radius:6px;background:#0006" />` : '<span class="muted">Sin imagen</span>'}
        <button class="small" id="mImg">Elegir…</button>${M.bgImage ? '<button class="small danger" id="mImgX">Quitar</button>' : ''}</div></div>
    </div>
    <div class="row"><button class="small primary" id="mTextOnly" title="Sin recuadro, sin fondo y sin borde: solo los títulos y los números">✨ Solo texto (sin recuadro ni fondo)</button><button class="small" id="mReset">Volver al estilo de la interfaz</button><span class="muted">Se guarda con «Guardar diseño».</span></div></div>`;
}

function readMeters(v, cur) {
  const on = (id) => $(id, v).checked;
  const a = Math.round(Number($('#mBa', v).value) * 255).toString(16).padStart(2, '0');
  const mode = $('#mBoxMode', v).value, box = mode === 'custom', colors = on('#mColors');
  const font = (k) => ($(`#mF${k}`, v).value.trim() || null);
  return {
    box: mode === 'none' ? 'none' : null,
    labelFont: font('label'), labelFontUrl: font('label') ? cur.labelFontUrl || null : null,
    valueFont: font('value'), valueFontUrl: font('value') ? cur.valueFontUrl || null : null,
    labels: { balance: $('#mLb', v).value.trim() || null, bet: $('#mLa', v).value.trim() || null, win: $('#mLp', v).value.trim() || null },
    showLabels: on('#mShow') ? null : false,
    labelColor: colors ? $('#mCl', v).value : null, valueColor: colors ? $('#mCv', v).value : null, winColor: colors ? $('#mCw', v).value : null,
    bg: box ? `${$('#mBg', v).value}${a}` : null, border: box ? $('#mBd', v).value : null, radius: box ? Number($('#mR', v).value) : null,
    bgImage: box ? cur.bgImage || null : null,
    valueScale: Number($('#mVs', v).value) === 1 ? null : Number($('#mVs', v).value),
  };
}

function bindMetersCard(v) {
  if (!$('#mCard', v)) return;
  const prev = () => {
    const m = readMeters(v, S.game.draft.theme?.hud?.meters || {});
    $$('#mPrev .mp', v).forEach((el) => {
      const k = el.classList.contains('saldo') ? 'balance' : el.classList.contains('apuesta') ? 'bet' : 'win';
      $('small', el).textContent = m.labels[k] || { balance: 'SALDO', bet: 'APUESTA', win: 'PREMIO' }[k];
      $('small', el).style.display = m.showLabels === false ? 'none' : '';
      $('small', el).style.color = m.labelColor || '';
      $('b', el).style.color = (k === 'win' ? m.winColor : null) || m.valueColor || '';
      $('b', el).style.fontSize = `${16 * (m.valueScale || 1)}px`;
      const H = S.game.draft.theme?.hud || {};
      const themeBox = !m.box && !m.bg && !m.border && !(H.layout === 'custom' && H.custom?.statStyle !== 'box');
      el.style.background = m.bg ? `${m.bgImage ? `url("${m.bgImage}") center / 100% 100% no-repeat, ` : ''}${m.bg}` : themeBox ? 'rgba(0,0,0,.72)' : 'transparent';
      el.style.border = `2px solid ${m.border || (themeBox ? 'var(--accent)' : 'transparent')}`;
      $('small', el).style.fontFamily = m.labelFont ? `'${m.labelFont}', system-ui` : '';
      $('b', el).style.fontFamily = m.valueFont ? `'${m.valueFont}', system-ui` : '';
      el.style.borderRadius = `${m.radius ?? 10}px`;
    });
  };
  // Cargar en el panel las tipografías elegidas para verlas en la vista previa
  const loadPrevFont = (name, url) => {
    if (!name) return;
    if (url && typeof FontFace !== 'undefined') { new FontFace(name, `url("${url}")`).load().then((f) => document.fonts.add(f)).catch(() => {}); return; }
    const id = `gf-${name.replace(/\W+/g, '-')}`;
    if (!document.getElementById(id)) document.head.append(Object.assign(document.createElement('link'), { id, rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;700;900&display=swap` }));
  };
  const cur0 = S.game.draft.theme?.hud?.meters || {};
  loadPrevFont(cur0.labelFont, cur0.labelFontUrl); loadPrevFont(cur0.valueFont, cur0.valueFontUrl);
  $$('#mFlabel, #mFvalue', v).forEach((i) => i.addEventListener('change', () => { loadPrevFont(i.value.trim()); setTimeout(prev, 400); }));
  $$('[data-mfontup]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const a = await pickAsset('font');
    if (!a) return;
    const asset = typeof a === 'string' ? (await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId || '')}&kind=font`)).find((x) => x.url === a) : a;
    const k = b.dataset.mfontup;
    const cur = S.game.draft.theme?.hud?.meters || {};
    await patchDraft([{ op: 'set', path: 'theme.hud.meters', value: { ...readMeters(v, cur), [`${k}Font`]: fontFamilyOf(asset || { filename: 'Fuente propia' }), [`${k}FontUrl`]: asset?.url || a } }], 'Tipografía aplicada a los marcadores');
    renderTab();
  })));
  $$('[data-mfontx]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const k = b.dataset.mfontx;
    const cur = S.game.draft.theme?.hud?.meters || {};
    await patchDraft([{ op: 'set', path: 'theme.hud.meters', value: { ...readMeters(v, cur), [`${k}Font`]: null, [`${k}FontUrl`]: null } }], 'Tipografía quitada');
    renderTab();
  })));
  const showCustom = () => $$('.mcustom', v).forEach((el) => { el.hidden = $('#mBoxMode', v).value !== 'custom'; });
  showCustom();
  $('#mBoxMode', v).addEventListener('change', () => { showCustom(); prev(); });
  $$('#mCard input', v).forEach((i) => i.addEventListener('input', () => {
    const o = $(`#${i.id}V`, v); if (o) o.textContent = i.id === 'mR' ? i.value : Math.round(i.value * 100);
    prev();
  }));
  prev();
  $('#mImg', v).addEventListener('click', guard(async () => {
    const url = await pickAsset('image');
    if (!url) return;
    const cur = S.game.draft.theme?.hud?.meters || {};
    $('#mBoxMode', v).value = 'custom';
    await patchDraft([{ op: 'set', path: 'theme.hud.meters', value: { ...readMeters(v, cur), bgImage: url, bg: readMeters(v, cur).bg || '#00000000' } }], 'Imagen de los marcadores aplicada');
    renderTab();
  }));
  $('#mImgX', v)?.addEventListener('click', guard(async () => { await patchDraft([{ op: 'set', path: 'theme.hud.meters.bgImage', value: null }]); renderTab(); }));
  $('#mTextOnly', v).addEventListener('click', guard(async () => {
    const cur = S.game.draft.theme?.hud?.meters || {};
    const ops = [{ op: 'set', path: 'theme.hud.meters', value: { ...readMeters(v, cur), box: 'none', bg: null, border: null, radius: null, bgImage: null } }];
    if (S.game.draft.theme?.hud?.custom?.statStyle === 'box') ops.push({ op: 'set', path: 'theme.hud.custom.statStyle', value: 'plain' });
    await patchDraft(ops, 'Saldo, apuesta y premio: solo el texto. Mira la ▶ Vista previa');
    renderTab();
  }));
  $('#mReset', v).addEventListener('click', guard(async () => { await patchDraft([{ op: 'set', path: 'theme.hud.meters', value: null }], 'Marcadores con el estilo de la interfaz'); renderTab(); }));
}

// ---- Dados (juegos de mesa): colores, forma, tamaño e imagen propia por cara ----
function diceCard(D) {
  const faces = D.faces || {};
  return `<div class="card stack" id="diceCard"><h3 style="margin:0">🎲 Dados</h3>
    <div class="row" style="align-items:center;gap:18px">
      <div id="diePreview" style="display:flex;gap:10px">${[5, 3].map((n) => diePreview(D, n)).join('')}</div>
      <span class="muted">Vista previa. Si una cara tiene imagen, se muestra la imagen en lugar de los puntos.</span></div>
    <div class="grid2">
      <div><label>Color de las caras</label><input type="color" id="dkFace" value="${esc(D.face || '#fbfbfb')}" /></div>
      <div><label>Color de los puntos</label><input type="color" id="dkPip" value="${esc(D.pip || '#c0392b')}" /></div>
      <div><label>Color del borde</label><input type="color" id="dkEdge" value="${esc(D.edge || '#cccccc')}" /></div>
      <div><label>Redondeo de las esquinas (<span id="dkRadV">${D.radius ?? 18}</span> %)</label><input type="range" id="dkRad" min="0" max="50" step="1" value="${D.radius ?? 18}" /></div>
      <div><label>Tamaño al lanzar (<span id="dkScaleV">${Number(D.scale ?? 1).toFixed(2)}</span>×)</label><input type="range" id="dkScale" min="0.7" max="1.4" step="0.05" value="${D.scale ?? 1}" /></div>
    </div>
    <table><thead><tr><th>Cara</th><th>Imagen propia (opcional)</th><th></th></tr></thead><tbody>
      ${[1, 2, 3, 4, 5, 6].map((f) => `<tr data-face="${f}"><td><b>${f}</b></td><td>${faces[f] ? `<img src="${esc(faces[f])}" style="height:40px;width:40px;object-fit:cover;border-radius:6px" />` : '<span class="muted">Puntos</span>'}</td>
        <td class="row"><button class="small" data-dface>Imagen…</button>${faces[f] ? '<button class="small danger" data-dfclear>Quitar</button>' : ''}</td></tr>`).join('')}
    </tbody></table>
    <div class="row"><button class="primary" id="dkSave">Guardar dados</button><span class="muted">También puedes pedirle al 🖌 Artista “haz dados dorados con puntos negros” o imágenes para cada cara.</span></div></div>`;
}

// ---- Mesa en vivo y crupier grabado (Dados) ----
const COMBOS = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) COMBOS.push(`${a}-${b}`);
function croupierCard(d) {
  const L = { enabled: false, bettingSeconds: 20, closeSeconds: 2, rollSeconds: 9, resultSeconds: 5, ...(d.rules?.live || {}) };
  const C = { enabled: false, name: 'Crupier', clips: {}, totals: {}, idle: null, autoSeconds: 0, playerThrow: true, ...(d.theme?.croupier || {}) };
  const cell = (k, url, kind) => `<div class="cv-cell ${url ? 'has' : ''}" data-cv="${kind}:${k}">
    <b>${kind === 'clips' ? k.replace('-', ' + ') : `= ${k}`}</b>${url ? '<span>🎬</span>' : '<span class="muted">—</span>'}
    <div class="row"><button class="small" data-cvup>${url ? 'Cambiar' : 'Video…'}</button>${url ? '<button class="small ghost" data-cvplay>▶</button><button class="small danger" data-cvdel>✕</button>' : ''}</div></div>`;
  const have = COMBOS.filter((k) => C.clips?.[k]).length, haveT = Object.values(C.totals || {}).filter(Boolean).length;
  return `<div class="card stack" id="crCard"><h3 style="margin:0">🎩 Mesa en vivo y crupier grabado</h3>
    <p class="muted" style="margin:0">En la <b>mesa en vivo</b> todos los jugadores juegan la misma tirada, como la ruleta europea en vivo: cuenta regresiva para apostar, «no va más», tira el crupier y se paga a todos.
      Los dados los sortea el servidor en el «no va más»; el video que se ve es el del crupier grabado que coincide con ese resultado. Si falta el video de un resultado, se ven los dados 3D.</p>
    <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="lvOn" style="width:auto" ${L.enabled ? 'checked' : ''} /> Mesa en vivo (tira el crupier para todos)</label>
    <div class="grid2">
      <div><label>Segundos para apostar</label><input type="number" id="lvBet" min="5" max="120" value="${L.bettingSeconds}" /></div>
      <div><label>Duración de la tirada (s) — lo que dura el video</label><input type="number" id="lvRoll" min="2" max="60" value="${L.rollSeconds}" /></div>
      <div><label>«No va más» (s)</label><input type="number" id="lvClose" min="0" max="10" value="${L.closeSeconds}" /></div>
      <div><label>Mostrar resultados (s)</label><input type="number" id="lvRes" min="1" max="60" value="${L.resultSeconds}" /></div>
      <div><label>Nombre del crupier</label><input id="crName" value="${esc(C.name || 'Crupier')}" /></div>
      <div><label>Mesa normal: el crupier tira solo a los (s, 0 = nunca)</label><input type="number" id="crAuto" min="0" max="60" value="${C.autoSeconds || 0}" /></div>
    </div>
    <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="crOn" style="width:auto" ${C.enabled ? 'checked' : ''} /> Mesa normal: botón «Crupier» para que tire el crupier grabado</label>
    <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="crPlayer" style="width:auto" ${C.playerThrow !== false ? 'checked' : ''} /> Mesa normal: el jugador también puede tirar</label>
    <div class="row"><b>Crupier animado:</b> ${C.avatar === false ? '<span class="muted">oculto</span>' : C.avatar ? `<img src="${esc(C.avatar)}" style="height:54px;border-radius:8px" />` : '<span class="muted">el dibujado de fábrica</span>'}
      <button class="small" id="crAv">Imagen o GIF…</button>${C.avatar ? '<button class="small ghost" id="crAvDef">Usar el dibujado</button>' : ''}
      <button class="small ghost" id="crAvHide">${C.avatar === false ? 'Mostrar' : 'Ocultar'}</button>
      <span class="muted">Al lanzar: ${C.avatarThrow ? `<img src="${esc(C.avatarThrow)}" style="height:40px;border-radius:6px;vertical-align:middle" />` : 'la misma'}</span><button class="small" id="crAvT">Imagen al lanzar…</button></div>
    <p class="muted" style="margin:0">El crupier aparece en la bandeja: saluda mientras se apuesta, levanta la mano en el «no va más», lanza y anuncia el resultado. Pídele al 🖌 Artista «un crupier de casino elegante, cuerpo entero, fondo transparente» y súbelo acá.</p>
    <details class="card" style="background:var(--panel2)"><summary><b>🎬 Cómo hacer los videos del crupier con IA (Runway, Kling, Sora…)</b></summary>
      <ol style="margin:8px 0;padding-left:20px;line-height:1.5">
        <li>Pide un clip por resultado, siempre con el mismo crupier, la misma mesa y la misma cámara, de 5 a 9 segundos (lo que pongas en «Duración de la tirada»).</li>
        <li>Texto sugerido para cada clip (cambia los números):<br><code id="crPrompt">Video realista de un crupier de casino elegante (chaleco negro, moño rojo) en una mesa de dados de paño verde, cámara fija frontal. El crupier lanza dos dados blancos con puntos rojos que ruedan por la mesa y se detienen mostrando 3 y 4 bien visibles hacia la cámara. Iluminación cálida de casino, 6 segundos, sin texto.</code>
          <button class="small" id="crCopy">Copiar</button></li>
        <li>Revisa cada clip: los dados del final tienen que mostrar exactamente ese resultado (las IA a veces se equivocan; si pasa, vuelve a generarlo).</li>
        <li>Nombra cada archivo con el resultado (<code>1-1.mp4</code>, <code>1-2.mp4</code> … <code>6-6.mp4</code>) o por total (<code>total-2.mp4</code> … <code>total-12.mp4</code>) y súbelos todos juntos con «Subir varios a la vez».</li>
        <li>Opcional: un clip del crupier esperando, sin lanzar, para el bucle de espera.</li>
      </ol></details>
    <div class="row"><b>Video del crupier esperando (en bucle):</b> ${C.idle ? '🎬 cargado' : '<span class="muted">ninguno</span>'} <button class="small" id="crIdle">Video…</button>${C.idle ? '<button class="small danger" id="crIdleDel">Quitar</button>' : ''}</div>
    <div class="row"><input type="file" id="crBulk" multiple accept="video/mp4,video/webm" style="max-width:320px" />
      <span class="muted">Subir varios a la vez: nombra cada archivo con el resultado, por ejemplo <code>3-4.mp4</code> (combinación) o <code>total-7.mp4</code> (total).</span><span id="crBulkMsg" class="muted"></span></div>
    <h4 style="margin:6px 0 0">Por combinación (${have} de 21)</h4>
    <div class="cv-grid">${COMBOS.map((k) => cell(k, C.clips?.[k], 'clips')).join('')}</div>
    <h4 style="margin:6px 0 0">Por total (${haveT} de 11) — se usan si falta la combinación</h4>
    <div class="cv-grid">${[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => cell(String(n), C.totals?.[n], 'totals')).join('')}</div>
    <div class="row"><button class="primary" id="crSave">Guardar mesa y crupier</button><span class="error" id="crErr"></span></div></div>`;
}
function bindCroupierCard(v) {
  const card = $('#crCard', v);
  if (!card) return;
  const setPath = async (path, value, msg) => { await patchDraft([{ op: 'set', path, value }], msg); renderTab(); };
  card.addEventListener('click', guard(async (e) => {
    const cellEl = e.target.closest('[data-cv]');
    if (!cellEl) return;
    const [kind, key] = cellEl.dataset.cv.split(':');
    const url = S.game.draft.theme?.croupier?.[kind]?.[key];
    if (e.target.matches('[data-cvplay]') && url) return openPicker(`Video ${key}`, `<video src="${esc(url)}" controls autoplay playsinline style="width:100%;max-height:70vh;border-radius:10px"></video>`);
    // Se guarda el mapa completo (las claves de los totales son números y no deben volverse una lista)
    const map = { ...(S.game.draft.theme?.croupier?.[kind] || {}) };
    if (e.target.matches('[data-cvdel]')) { delete map[key]; return setPath(`theme.croupier.${kind}`, map, 'Video quitado'); }
    if (e.target.matches('[data-cvup]')) {
      const u = await pickAsset('video');
      if (u) { map[key] = u; await setPath(`theme.croupier.${kind}`, map, `Video del ${key} guardado`); }
    }
  }));
  $('#crAv', card).addEventListener('click', guard(async () => { const u = await pickAsset('image', { animated: true }); if (u) await setPath('theme.croupier.avatar', u, 'Imagen del crupier guardada'); }));
  $('#crAvT', card).addEventListener('click', guard(async () => { const u = await pickAsset('image', { animated: true }); if (u) await setPath('theme.croupier.avatarThrow', u, 'Imagen al lanzar guardada'); }));
  $('#crAvDef', card)?.addEventListener('click', guard(() => setPath('theme.croupier.avatar', null, 'Se usa el crupier dibujado')));
  $('#crAvHide', card).addEventListener('click', guard(() => setPath('theme.croupier.avatar', S.game.draft.theme?.croupier?.avatar === false ? null : false, 'Crupier actualizado')));
  $('#crCopy', card).addEventListener('click', () => { navigator.clipboard?.writeText($('#crPrompt', card).textContent); toast('Texto copiado'); });
  $('#crIdle', card).addEventListener('click', guard(async () => { const u = await pickAsset('video'); if (u) await setPath('theme.croupier.idle', u, 'Video de espera guardado'); }));
  $('#crIdleDel', card)?.addEventListener('click', guard(() => setPath('theme.croupier.idle', null, 'Video de espera quitado')));
  $('#crBulk', card).addEventListener('change', guard(async (e) => {
    const files = [...e.target.files];
    const ops = [];
    let n = 0, skipped = [];
    for (const f of files) {
      const name = f.name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
      let path = null;
      const combo = name.match(/([1-6])\D+([1-6])(?!\d)/);
      const tot = name.match(/(?:total|t)\D*(1[0-2]|[2-9])\b/) || name.match(/^(1[0-2]|[2-9])$/);
      if (combo && !/total/.test(name)) { const [a, b] = [Number(combo[1]), Number(combo[2])].sort(); path = ['clips', `${a}-${b}`]; }
      else if (tot) path = ['totals', tot[1]];
      if (!path) { skipped.push(f.name); continue; }
      $('#crBulkMsg', card).textContent = `Subiendo ${++n} de ${files.length}…`;
      const a = await uploadFile(f, 'video');
      ops.push({ kind: path[0], key: path[1], url: a.url });
    }
    if (ops.length) {
      const C = S.game.draft.theme?.croupier || {};
      const clips = { ...(C.clips || {}) }, totals = { ...(C.totals || {}) };
      for (const o of ops) (o.kind === 'clips' ? clips : totals)[o.key] = o.url;
      await patchDraft([{ op: 'set', path: 'theme.croupier.clips', value: clips }, { op: 'set', path: 'theme.croupier.totals', value: totals }], `${ops.length} video(s) del crupier guardados`);
    }
    if (skipped.length) toast(`Sin resultado en el nombre (se omitieron): ${skipped.join(', ')}`);
    renderTab();
  }));
  $('#crSave', card).addEventListener('click', guard(async () => {
    $('#crErr', card).textContent = '';
    const num = (id) => Number($(`#${id}`, card).value);
    try {
      await patchDraft([
        { op: 'set', path: 'rules.live', value: { ...(S.game.draft.rules?.live || {}), enabled: $('#lvOn', card).checked, bettingSeconds: num('lvBet'), closeSeconds: num('lvClose'), rollSeconds: num('lvRoll'), resultSeconds: num('lvRes'), historySize: 20 } },
        { op: 'merge', path: 'theme.croupier', value: { name: $('#crName', card).value.trim() || 'Crupier', enabled: $('#crOn', card).checked, playerThrow: $('#crPlayer', card).checked, autoSeconds: num('crAuto') } },
      ], 'Mesa y crupier guardados');
      renderTab();
    } catch (err) { $('#crErr', card).textContent = `${err.message}${err.details ? ': ' + err.details.join(' · ') : ''}`; }
  }));
}

function diePreview(D, n) {
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const img = D.faces?.[n];
  return `<div style="width:58px;height:58px;border-radius:${D.radius ?? 18}%;border:1px solid ${esc(D.edge || '#ccc')};background:${img ? `center/cover url('${esc(img)}')` : esc(D.face || '#fbfbfb')};
    display:grid;grid-template:repeat(3,1fr)/repeat(3,1fr);padding:7px;box-shadow:inset 0 0 10px #0004">${img ? '' : Array.from({ length: 9 }, (_, i) => `<i style="width:10px;height:10px;border-radius:50%;place-self:center;background:${PIPS[n].includes(i + 1) ? esc(D.pip || '#c0392b') : 'transparent'}"></i>`).join('')}</div>`;
}

function bindDiceCard(v) {
  if (!$('#diceCard', v)) return;
  const cur = () => ({ ...(S.game.draft.theme?.dice || {}), face: $('#dkFace').value, pip: $('#dkPip').value, edge: $('#dkEdge').value, radius: Number($('#dkRad').value), scale: Number($('#dkScale').value) });
  const redraw = () => { $('#dkRadV').textContent = $('#dkRad').value; $('#dkScaleV').textContent = Number($('#dkScale').value).toFixed(2); $('#diePreview').innerHTML = [5, 3].map((n) => diePreview(cur(), n)).join(''); };
  $$('#diceCard input', v).forEach((i) => i.addEventListener('input', redraw));
  $$('[data-dface]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const url = await pickAsset('image');
    if (url) { await patchDraft([{ op: 'set', path: `theme.dice.faces.${b.closest('tr').dataset.face}`, value: url }], 'Cara del dado guardada'); renderTab(); }
  })));
  $$('[data-dfclear]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    await patchDraft([{ op: 'set', path: `theme.dice.faces.${b.closest('tr').dataset.face}`, value: null }], 'Imagen quitada'); renderTab();
  })));
  $('#dkSave').addEventListener('click', guard(async () => {
    const { faces, ...rest } = cur();
    await patchDraft([{ op: 'merge', path: 'theme.dice', value: rest }], 'Dados guardados');
  }));
}

// ------------------------------------------------------------------ Pestaña: Símbolos
async function tabSymbols(v) {
  if (engineInfo(S.game.engine).kind === 'crash') {
    v.innerHTML = '<div class="card"><p>Este juego es <b>Crash</b>: no tiene símbolos ni rodillos. El personaje, el fondo en capas y los colores del escenario se cambian en <b>🎨 Diseño → Escenario Crash</b>; el RTP, el tope y la curva en <b>📈 Matemática</b>.</p></div>';
    return;
  }
  if (engineInfo(S.game.engine).kind === 'table') {
    v.innerHTML = '<div class="card"><p>Este juego es de mesa: no tiene símbolos ni rodillos. Los pagos se editan en <b>📈 Matemática</b> y el aspecto (paño, colores, fondos) en <b>🎨 Diseño</b>.</p></div>';
    return;
  }
  const syms = S.game.draft.symbols;
  const maxN = Math.max(...syms.flatMap((s) => Object.keys(s.pays || {}).map(Number)), 3);
  const counts = []; if (!isOp()) for (let n = 3; n <= maxN; n++) counts.push(n);
  const unit = { lines: 'múltiplo de la apuesta por línea', cluster: 'múltiplo de la apuesta total, según el tamaño del grupo (la columna es el mínimo del nivel)',
    count: 'múltiplo de la apuesta total, según cuántos iguales hay en pantalla (la columna es el mínimo del nivel)', rows: 'múltiplo de la apuesta total, por fila (3, 4 o 5 iguales en la misma fila, en cualquier posición)' }[engineInfo(S.game.engine).paysBy] || 'múltiplo de la apuesta total (por way)';
  v.innerHTML = `<div class="card"><table><thead><tr><th>Imagen</th><th>Id</th><th>Nombre</th><th>Tipo</th>${counts.map((n) => `<th>${n}×</th>`).join('')}</tr></thead>
    <tbody>${syms.map((s) => `<tr data-id="${esc(s.id)}"><td><img class="sym" src="${esc(s.image)}" title="Cambiar imagen" /></td><td><code>${esc(s.id)}</code></td>
      <td><input data-f="name" value="${esc(s.name)}" /></td><td>${esc(s.type || 'regular')}</td>
      ${counts.map((n) => `<td>${s.type === 'regular' || !s.type ? `<input type="number" step="any" min="0" data-pay="${n}" value="${s.pays?.[n] ?? ''}" style="width:90px" /><div class="amt" data-amt="${n}"></div>` : ''}</td>`).join('')}</tr>`).join('')}
    </tbody></table>
    <div class="row pay-preview"><b>Ver cuánto paga con:</b>
      <select id="spCur">${[S.game.draft.bet?.currency || 'USD', ...Object.keys(S.game.draft.bet?.byCurrency || {})].filter((c, i, a) => a.indexOf(c) === i).map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <select id="spBet"></select><span class="muted">Así lo ve el jugador en la tabla de premios del juego (cambia con la moneda y la apuesta).</span></div>
    <p class="muted">${isOp() ? 'Puedes cambiar nombres e imágenes. Los pagos y el RTP los define tu proveedor.' : `Pagos en ${unit}. Cambiar pagos modifica el RTP: después usa 📈 Matemática → “Ajustar RTP” antes de publicar.`}</p>
    <div class="row"><button class="primary" id="sSave">Guardar símbolos</button></div></div>`;
  // Importe de cada premio para una moneda y una ficha (lo mismo que muestra la tabla de premios del juego)
  const B = S.game.draft.bet || {};
  const payK = engineInfo(S.game.engine).paysBy === 'lines' ? 1 / (S.game.draft.rules?.lines || 1) : 1;
  const money = (cents, cur) => { try { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: cur }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${cur}`; } };
  const fillBets = () => {
    const cur = $('#spCur', v).value;
    const bc = B.byCurrency?.[cur];
    const levels = bc?.levels?.length ? bc.levels : B.levels || [100];
    const def = bc ? (bc.default ?? levels[0]) : B.default;
    $('#spBet', v).innerHTML = levels.map((x) => `<option value="${x}" ${x === def ? 'selected' : ''}>Apuesta ${money(x, cur)}</option>`).join('');
  };
  const amounts = () => {
    const cur = $('#spCur', v).value, bet = Number($('#spBet', v).value);
    for (const i of $$('[data-pay]', v)) {
      const el = i.parentElement.querySelector(`[data-amt="${i.dataset.pay}"]`);
      if (el) el.textContent = i.value === '' ? '' : `= ${money(Math.round(Number(i.value) * payK * bet), cur)}`;
    }
  };
  fillBets(); amounts();
  $('#spCur', v).addEventListener('change', () => { fillBets(); amounts(); });
  $('#spBet', v).addEventListener('change', amounts);
  $$('[data-pay]', v).forEach((i) => i.addEventListener('input', amounts));
  $$('img.sym', v).forEach((img) => img.addEventListener('click', guard(async () => {
    const id = img.closest('tr').dataset.id;
    const url = await pickAsset('image');
    if (url) { await patchDraft([{ op: 'set', path: `symbols.${id}.image`, value: url }]); renderTab(); }
  })));
  $('#sSave').addEventListener('click', guard(async () => {
    const ops = [];
    for (const tr of $$('tbody tr', v)) {
      const id = tr.dataset.id;
      ops.push({ op: 'set', path: `symbols.${id}.name`, value: $('[data-f=name]', tr).value });
      const pays = {};
      for (const i of $$('[data-pay]', tr)) if (i.value !== '') pays[i.dataset.pay] = Number(i.value);
      if ($$('[data-pay]', tr).length) ops.push({ op: 'set', path: `symbols.${id}.pays`, value: pays });
    }
    await patchDraft(ops, 'Símbolos guardados');
  }));
}

// ------------------------------------------------------------------ Pestaña: Sonidos
const SLOTS = [['music', 'Música base (loop)'], ['featureMusic', 'Música del bonus'], ['spin', 'Girar'], ['reelStop', 'Parada de rodillo'], ['win', 'Premio'],
  ['roll', 'Lanzar dados (mesa)'], ['dice', 'Dados rebotando (mesa)'], ['chip', 'Poner ficha (mesa)'], ['lose', 'Apuesta perdida (mesa)'],
  ['bigWin', 'Gran premio'], ['feature', 'Activación de bonus'], ['click', 'Clic'], ['coin', 'Moneda'], ['tumble', 'Cascada'], ['scatter', 'Scatter']];

async function tabSounds(v) {
  const s = S.game.draft.sounds || {};
  const vol = S.game.draft.soundVolumes || {};
  v.innerHTML = `<div class="card"><table><thead><tr><th>Evento</th><th>Sonido</th><th>Volumen</th><th></th></tr></thead><tbody>
    ${SLOTS.map(([k, l]) => `<tr data-slot="${k}"><td>${l}<div class="muted"><code>${k}</code></div></td>
      <td>${s[k] ? `<audio controls preload="none" src="${esc(s[k])}"></audio>` : '<span class="muted">—</span>'}</td>
      <td><input type="range" min="0" max="1" step="0.05" value="${vol[k] ?? 0.8}" data-vol /></td>
      <td class="row"><button class="small" data-pick>Elegir…</button>${s[k] ? '<button class="small danger" data-clear>Quitar</button>' : ''}</td></tr>`).join('')}
    </tbody></table>
    <div class="row" style="margin-top:12px"><button class="primary" id="volSave">Guardar volúmenes</button>
    <span class="muted">${S.me.providers.elevenlabs ? 'Pide sonidos nuevos al agente 🎵 Sonido.' : 'Configura ELEVENLABS_API_KEY para generar sonidos con IA.'}</span></div></div>`;
  $$('[data-pick]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const slot = b.closest('tr').dataset.slot;
    const url = await pickAsset('sound');
    if (url) { await patchDraft([{ op: 'set', path: `sounds.${slot}`, value: url }]); renderTab(); }
  })));
  $$('[data-clear]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    await patchDraft([{ op: 'set', path: `sounds.${b.closest('tr').dataset.slot}`, value: null }]); renderTab();
  })));
  $('#volSave').addEventListener('click', guard(async () => {
    const volumes = Object.fromEntries($$('tr[data-slot]', v).map((tr) => [tr.dataset.slot, Number($('[data-vol]', tr).value)]));
    await patchDraft([{ op: 'set', path: 'soundVolumes', value: volumes }], 'Volúmenes guardados');
  }));
}

// ------------------------------------------------------------------ Pestaña: Matemática
const BUY_NAMES = { buy: 'giros gratis', 'buy-sticky': 'wilds fijos', 'buy-wheel': 'ruleta', 'buy-pick': 'elige premio', 'buy-collect': 'colecciona', 'buy-path': 'el camino', ante: 'doble chance' };

// ---- Matemática de juegos de mesa (Craps): pagos editables y RTP exacto por apuesta ----
const CRAPS_BETS = [['pass', 'Pass Line'], ['dontPass', "Don't Pass"], ['come', 'Come'], ['dontCome', "Don't Come"], ['odds', 'Odds'],
  ['place', 'Números (4-10)'], ['field', 'Field'], ['hard', 'Hardways'], ['anyCraps', 'Any Craps'], ['any7', 'Any 7']];

// ------------------------------------------------------------------ Crash: escenario (Diseño) y matemática
const CRASH_SHEETS = [['idle', 'Personaje quieto (esperando)'], ['run', 'Personaje volando'], ['explode', 'Explosión'], ['fly', 'Se va volando después de explotar'],
  ['bg', 'Fondo en capas (3 siluetas)'], ['bats', 'Murciélagos del cielo'], ['details', 'Luna y estrellas']];
function crashStageCard(t) {
  const C = t.crash || {};
  const A = C.atlases || {};
  const sky = C.sky || ['#27194c', '#3e2968', '#563c7c', '#755799'];
  return `<div class="card stack" id="crashCard"><h3 style="margin:0">🎃 Escenario Crash</h3>
    <p class="muted" style="margin:0">El escenario del juego: cielo, curva, multiplicador y el personaje animado. Cada animación es una <b>hoja de sprites</b> (una imagen con todos los cuadros y un .json que dice dónde está cada uno).
      Puedes reemplazar la imagen por otra con <b>los cuadros en el mismo lugar</b> (mismo tamaño y orden), por ejemplo la misma hoja recoloreada o redibujada.</p>
    <div class="grid2">
      ${sky.map((c, i) => `<div><label>Cielo ${['arriba', 'medio alto', 'medio bajo', 'horizonte'][i] || i + 1}</label><input type="color" data-sky="${i}" value="${esc(c)}" /></div>`).join('')}
      <div><label>Color de la curva</label><input type="color" id="cxCurve" value="${esc(C.curveColor || '#ffffff')}" /></div>
      <div><label>Color del multiplicador</label><input type="color" id="cxMult" value="${esc(C.multColor || '#ffffff')}" /></div>
      <div><label>Color al explotar</label><input type="color" id="cxCrash" value="${esc(C.crashColor || '#ef4444')}" /></div>
      <div><label>Tamaño del personaje (<span id="cxScaleV">${Math.round((C.characterScale || 1) * 100)}</span> %)</label><input type="range" id="cxScale" min="0.5" max="2" step="0.05" value="${C.characterScale || 1}" /></div>
    </div>
    <table><thead><tr><th>Animación</th><th>Imagen</th><th></th></tr></thead><tbody>
      ${CRASH_SHEETS.map(([k, l]) => `<tr data-sheet="${k}"><td>${l}</td><td>${A[`${k}Image`] ? `<img src="${esc(A[`${k}Image`])}" style="height:44px;max-width:160px;object-fit:contain;background:#0006;border-radius:6px" />` : '<span class="muted">—</span>'}</td>
        <td class="row"><button class="small" data-sheetimg>Cambiar imagen…</button><button class="small" data-sheetjson>Cambiar .json…</button></td></tr>`).join('')}
    </tbody></table>
    <div class="row"><button class="primary" id="cxSave">Guardar escenario</button><button class="small" id="cxReset">Volver al escenario original</button></div></div>`;
}
function bindCrashStageCard(v) {
  const card = $('#crashCard', v);
  if (!card) return;
  $('#cxScale', card).addEventListener('input', (e) => { $('#cxScaleV', card).textContent = Math.round(e.target.value * 100); });
  $('#cxSave', card).addEventListener('click', guard(async () => {
    const sky = $$('[data-sky]', card).map((i) => i.value);
    await patchDraft([{ op: 'merge', path: 'theme.crash', value: { sky, curveColor: $('#cxCurve', card).value, multColor: $('#cxMult', card).value, crashColor: $('#cxCrash', card).value, characterScale: Number($('#cxScale', card).value) } }], 'Escenario guardado. Míralo en ▶ Vista previa');
    renderTab();
  }));
  $('#cxReset', card).addEventListener('click', guard(async () => {
    const def = engineInfo(S.game.engine);
    void def;
    await patchDraft([{ op: 'set', path: 'theme.crash', value: CRASH_DEFAULT_STAGE() }], 'Escenario original restaurado');
    renderTab();
  }));
  $$('[data-sheetimg]', card).forEach((b) => b.addEventListener('click', guard(async () => {
    const url = await pickAsset('image');
    if (url) { await patchDraft([{ op: 'set', path: `theme.crash.atlases.${b.closest('tr').dataset.sheet}Image`, value: url }], 'Imagen de la animación cambiada'); renderTab(); }
  })));
  $$('[data-sheetjson]', card).forEach((b) => b.addEventListener('click', guard(async () => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    inp.onchange = guard(async () => {
      const f = inp.files[0];
      if (!f) return;
      const data = JSON.parse(await f.text());
      if (!data.frames) throw new Error('El .json no tiene «frames»: debe ser una hoja de sprites (formato TexturePacker / PixiJS)');
      // Se guarda dentro del diseño (solo la lista de cuadros: son pocos datos)
      const frames = (Array.isArray(data.frames) ? data.frames : Object.entries(data.frames).map(([filename, x]) => ({ filename, ...x })))
        .map((x) => ({ filename: x.filename, frame: { x: x.frame.x, y: x.frame.y, w: x.frame.w, h: x.frame.h } }));
      await patchDraft([{ op: 'set', path: `theme.crash.atlases.${b.closest('tr').dataset.sheet}`, value: { frames } }], `Cuadros de la animación cambiados (${frames.length})`);
      renderTab();
    });
    inp.click();
  })));
}
const CRASH_DEFAULT_STAGE = () => {
  const A = '/game-engines/engine-crash/assets/halloween';
  return { sky: ['#27194c', '#3e2968', '#563c7c', '#755799'], curveColor: '#ffffff', multColor: '#ffffff', crashColor: '#ef4444', characterScale: 1,
    atlases: { bg: `${A}/bg.json`, bgImage: `${A}/images/bg.png`, bats: `${A}/bgBird.json`, batsImage: `${A}/images/bgBird.png`, details: `${A}/bgDetails.json`, detailsImage: `${A}/images/bgDetails.png`,
      idle: `${A}/idle.json`, idleImage: `${A}/images/idle.png`, run: `${A}/runFly.json`, runImage: `${A}/images/runFly.png`, explode: `${A}/explode.json`, explodeImage: `${A}/images/explode.png`,
      fly: `${A}/explodeFly.json`, flyImage: `${A}/images/explodeFly.png` } };
};

async function tabMathCrash(v) {
  const d = S.game.draft;
  const R = d.rules;
  const L = R.limits || {};
  const m = S.game.math;
  const rounds = await api(`/api/admin/crash-rounds/${encodeURIComponent(S.gameId)}?limit=100`).catch(() => []);
  const wag = rounds.reduce((a, r) => a + r.wagered, 0), paid = rounds.reduce((a, r) => a + r.paid, 0);
  const at = (x) => `<tr><td>×${x.toFixed(2)}</td><td>${pct(Math.min(1, R.rtp / x))}</td><td>${pct(R.rtp)}</td></tr>`;
  v.innerHTML = `<div class="stack">
    <div class="card stack"><h3 style="margin:0">RTP exacto ${m ? `<span class="badge ok">publicado v${S.game.publishedVersion}: ${pct(m.rtp)}</span>` : ''}</h3>
      <p class="muted" style="margin:0">En Crash el RTP es el mismo para cualquier forma de jugar: retirarse cuando el multiplicador vale x gana con probabilidad RTP ÷ x. El ${pct(1 - R.rtp)} de las rondas explota en ×1,00 (la ventaja de la casa).
        El punto de explosión de cada ronda sale de una semilla secreta cuyo hash se publica antes de apostar; al explotar se revela y cualquiera lo verifica.</p>
      <table><thead><tr><th>Retirarse en</th><th>Probabilidad de llegar</th><th>Retorno</th></tr></thead><tbody>${[1.5, 2, 3, 5, 10, 100].filter((x) => x <= R.maxMultiplier).map(at).join('')}</tbody></table></div>
    <div class="card stack"><h3 style="margin:0">Límites y fichas</h3><div class="grid2">
      <div><label>Apuesta mínima</label><input id="cxMin" type="number" step="0.01" min="0.01" value="${L.min / 100}" /></div>
      <div><label>Apuesta máxima</label><input id="cxMax" type="number" step="0.01" value="${L.max / 100}" /></div>
      <div><label>Máximo por jugador y ronda</label><input id="cxTable" type="number" step="0.01" value="${L.table / 100}" /></div>
      <div><label>Premio máximo por apuesta (se retira solo al llegar)</label><input id="cxPay" type="number" step="0.01" value="${L.maxPayout ? L.maxPayout / 100 : ''}" placeholder="Sin tope" /></div>
      <div><label>Botones rápidos (+), separados por coma — el primero es la apuesta inicial y el paso de − / +</label><input id="cxChips" value="${d.bet.levels.map((x) => x / 100).join(', ')}" /></div>
    </div><div class="row"><button class="primary" id="cxLimSave">Guardar límites</button><span class="error" id="cxErr"></span></div></div>
    ${engineFunctionsCard(d)}
    <div class="card stack"><h3 style="margin:0">Últimas rondas ${rounds.length ? `<span class="badge">${rounds.length} rondas · apostado ${(wag / 100).toFixed(2)} · pagado ${(paid / 100).toFixed(2)}${wag ? ` · retorno real ${pct(paid / wag)}` : ''}</span>` : ''}</h3>
      ${rounds.length ? `<div style="max-height:360px;overflow:auto"><table><thead><tr><th>Ronda</th><th>Explotó</th><th>Apuestas</th><th>Apostado</th><th>Pagado</th><th>Hash / semilla</th></tr></thead><tbody>
        ${rounds.map((r) => `<tr><td>#${r.round_no}</td><td><b>×${Number(r.crash).toFixed(2)}</b></td><td>${r.bets}</td><td>${(r.wagered / 100).toFixed(2)}</td><td>${(r.paid / 100).toFixed(2)}</td>
          <td><code title="hash ${esc(r.hash)}&#10;semilla ${esc(r.seed)}">${esc(r.hash.slice(0, 12))}…</code></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Todavía no hay rondas: abre ▶ Vista previa para que la mesa empiece a jugar.</p>'}
      <p class="muted" style="margin:0">La mesa corre mientras alguien la está mirando. Cada apuesta es una ronda auditada en Rondas (se verifica con su semilla).</p></div>
  </div>`;
  bindEngineFunctions(v, d);
  $('#cxLimSave', v).addEventListener('click', guard(async () => {
    $('#cxErr', v).textContent = '';
    const c = (id) => Math.round(Number($(id, v).value) * 100);
    const levels = $('#cxChips', v).value.split(/[,;\s]+/).filter(Boolean).map((x) => Math.round(Number(x.replace(',', '.')) * 100)).filter((x) => x > 0);
    const limits = { min: c('#cxMin'), max: c('#cxMax'), table: c('#cxTable'), ...($('#cxPay', v).value ? { maxPayout: c('#cxPay') } : {}) };
    try {
      await patchDraft([{ op: 'set', path: 'rules.limits', value: limits }, { op: 'set', path: 'bet.levels', value: levels }, { op: 'set', path: 'bet.default', value: levels[0] }], 'Límites guardados');
      renderTab();
    } catch (e) { $('#cxErr', v).textContent = `${e.message}${e.details ? ': ' + e.details.join(' · ') : ''}`; }
  }));
}

async function tabMathTable(v) {
  const d = S.game.draft;
  const R = d.rules;
  const m = S.game.math;
  const ratioIn = (id, r) => (Array.isArray(r)
    ? `<span class="row" style="gap:4px;flex-wrap:nowrap"><input id="${id}a" type="number" min="1" step="1" value="${r[0]}" style="width:64px" /> a <input id="${id}b" type="number" min="1" step="1" value="${r[1]}" style="width:64px" /></span>`
    : `<span class="row" style="gap:4px;flex-wrap:nowrap"><input id="${id}a" type="number" min="0.1" step="0.1" value="${r}" style="width:74px" /> a 1</span>`);
  v.innerHTML = `<div class="stack">
    <div class="card stack"><h3 style="margin:0">RTP exacto por apuesta ${m ? `<span class="badge ok">publicado v${S.game.publishedVersion}</span>` : ''}</h3>
      <p class="muted">En la mesa no hay que simular: el RTP de cada apuesta se calcula exacto a partir de sus pagos. Debe quedar entre 85 % y 110 % para poder guardar.</p>
      <div id="tRtp"></div></div>
    <div class="card stack"><h3 style="margin:0">Apuestas habilitadas</h3>
      <div class="row">${CRAPS_BETS.map(([k, l]) => `<label class="row" style="gap:6px;margin:0;color:var(--text)"><input type="checkbox" data-bet="${k}" style="width:auto" ${R.bets[k] ? 'checked' : ''} /> ${l}</label>`).join('')}</div></div>
    <div class="card stack"><h3 style="margin:0">Pagos</h3>
      <table><thead><tr><th>Apuesta</th><th>Paga</th></tr></thead><tbody>
        ${[4, 5, 6, 8, 9, 10].map((n) => `<tr><td>Número ${n}</td><td>${ratioIn(`pl${n}`, R.pays.place[n])}</td></tr>`).join('')}
        <tr><td>Field con 2</td><td>${ratioIn('f2', R.pays.field[2])}</td></tr>
        <tr><td>Field con 12</td><td>${ratioIn('f12', R.pays.field[12])}</td></tr>
        ${[4, 6, 8, 10].map((n) => `<tr><td>Hard ${n} (${n / 2}+${n / 2})</td><td>${ratioIn(`hd${n}`, R.pays.hard[n])}</td></tr>`).join('')}
        <tr><td>Any Craps</td><td>${ratioIn('ac', R.pays.anyCraps)}</td></tr>
        <tr><td>Any 7</td><td>${ratioIn('a7', R.pays.any7)}</td></tr>
      </tbody></table>
      <div class="grid2">
        <div><label>Número que empata el Don't Pass en la salida</label><select id="tBar"><option value="12" ${R.dontBar === 12 ? 'selected' : ''}>12</option><option value="2" ${R.dontBar === 2 ? 'selected' : ''}>2</option></select></div>
        <div><label>Odds máximas (veces la apuesta) 4/10 · 5/9 · 6/8</label><div class="row" style="flex-wrap:nowrap;gap:4px">
          <input id="o4" type="number" min="0" max="100" value="${R.oddsMax[4]}" style="width:70px" /><input id="o5" type="number" min="0" max="100" value="${R.oddsMax[5]}" style="width:70px" /><input id="o6" type="number" min="0" max="100" value="${R.oddsMax[6]}" style="width:70px" /></div></div>
        <div><label>Apuesta mínima</label><input id="lMin" type="number" step="0.01" min="0.01" value="${R.limits.min / 100}" /></div>
        <div><label>Apuesta máxima por posición</label><input id="lMax" type="number" step="0.01" value="${R.limits.max / 100}" /></div>
        <div><label>Máximo total en la mesa</label><input id="lTable" type="number" step="0.01" value="${R.limits.table / 100}" /></div>
        <div><label>Fichas (separadas por coma)</label><input id="chips" value="${d.bet.levels.map((x) => x / 100).join(', ')}" /></div>
      </div>
      <div class="row"><button class="primary" id="tSave">Guardar pagos</button><span id="tErr" class="error"></span></div></div></div>`;
  const read = () => {
    const rr = (id, orig) => (Array.isArray(orig) ? [Number($(`#${id}a`).value), Number($(`#${id}b`).value)] : Number($(`#${id}a`).value));
    const rules = structuredClone(R);
    for (const i of $$('[data-bet]', v)) rules.bets[i.dataset.bet] = i.checked;
    for (const n of [4, 5, 6, 8, 9, 10]) rules.pays.place[n] = rr(`pl${n}`, R.pays.place[n]);
    rules.pays.field = { 2: rr('f2', R.pays.field[2]), 12: rr('f12', R.pays.field[12]) };
    for (const n of [4, 6, 8, 10]) rules.pays.hard[n] = rr(`hd${n}`, R.pays.hard[n]);
    rules.pays.anyCraps = rr('ac', R.pays.anyCraps);
    rules.pays.any7 = rr('a7', R.pays.any7);
    rules.dontBar = Number($('#tBar').value);
    const o4 = Number($('#o4').value), o5 = Number($('#o5').value), o6 = Number($('#o6').value);
    rules.oddsMax = { 4: o4, 10: o4, 5: o5, 9: o5, 6: o6, 8: o6 };
    rules.limits = { min: Math.round(Number($('#lMin').value) * 100), max: Math.round(Number($('#lMax').value) * 100), table: Math.round(Number($('#lTable').value) * 100) };
    return rules;
  };
  // RTP exacto en vivo mientras se editan los pagos (misma fórmula que el servidor)
  const W = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  const P = (t) => W[t] / 36, b7 = (n) => W[n] / (W[n] + 6), rt = (r) => (Array.isArray(r) ? r[0] / r[1] : r);
  const draw = () => {
    const r = read();
    const passWin = P(7) + P(11) + [4, 5, 6, 8, 9, 10].reduce((a, p) => a + P(p) * b7(p), 0);
    const dp = 2 * ([2, 3, 12].filter((t) => t !== r.dontBar).reduce((a, t) => a + P(t), 0) + [4, 5, 6, 8, 9, 10].reduce((a, p) => a + P(p) * (1 - b7(p)), 0)) + P(r.dontBar);
    const rows = [];
    const add = (k, name, x) => rows.push([k, name, x]);
    add('pass', 'Pass Line / Come', 2 * passWin); add('dontPass', "Don't Pass / Don't Come", dp); add('odds', 'Odds', 1);
    for (const n of [4, 5, 6, 8, 9, 10]) add('place', `Número ${n}`, b7(n) * (1 + rt(r.pays.place[n])));
    add('field', 'Field', P(2) * (1 + rt(r.pays.field[2])) + P(12) * (1 + rt(r.pays.field[12])) + [3, 4, 9, 10, 11].reduce((a, t) => a + P(t) * 2, 0));
    for (const n of [4, 6, 8, 10]) add('hard', `Hard ${n}`, (1 / (6 + W[n])) * (1 + rt(r.pays.hard[n])));
    add('anyCraps', 'Any Craps', (P(2) + P(3) + P(12)) * (1 + rt(r.pays.anyCraps)));
    add('any7', 'Any 7', P(7) * (1 + rt(r.pays.any7)));
    $('#tRtp').innerHTML = `<div class="kpi">${rows.map(([k, n, x]) => {
      const on = r.bets[k] ?? true;
      const bad = on && (x < 0.85 || x > 1.10);
      return `<div style="${on ? '' : 'opacity:.4'}${bad ? ';border-color:var(--err)' : ''}"><small>${esc(n)}${on ? '' : ' (desactivada)'}</small><b style="${bad ? 'color:var(--err)' : x > 1 ? 'color:var(--warn)' : ''}">${pct(x)}</b></div>`;
    }).join('')}</div>`;
  };
  v.addEventListener('input', draw);
  v.addEventListener('change', draw);
  draw();
  $('#tSave').addEventListener('click', guard(async () => {
    const levels = $('#chips').value.split(',').map((x) => Math.round(Number(x.trim()) * 100)).filter((x) => x > 0);
    try {
      await patchDraft([{ op: 'set', path: 'rules', value: read() }, { op: 'set', path: 'bet.levels', value: levels },
        { op: 'set', path: 'bet.default', value: levels.includes(d.bet.default) ? d.bet.default : levels[0] }], 'Pagos guardados');
      $('#tErr').textContent = '';
    } catch (e) { $('#tErr').textContent = `${e.message}${e.details ? ': ' + e.details.join(' · ') : ''}`; }
  }));
}


// ---- Funciones del motor: formulario generado desde el esquema de cada motor (rules sin tocar JSON) ----
const rGet = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function rSet(o, path, val) {
  const ks = path.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  cur[ks.at(-1)] = val;
}
function fnFieldHtml(f, val, d, idx) {
  const id = `fn${idx}`;
  const attrs = `data-fn="${idx}" id="${id}"`;
  const lim = (x) => `${x.min != null ? `min="${x.min}"` : ''} ${x.max != null ? `max="${x.max}"` : ''} step="${x.step ?? (x.t === 'int' ? 1 : 'any')}"`;
  const optHtml = (o, v) => o.map(([ov, ol]) => `<option value="${esc(JSON.stringify(ov))}" ${JSON.stringify(ov) === JSON.stringify(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('');
  // Primero los normales; también los especiales (ej. el comodín puede ser colosal)
  const regular = [...(d.symbols || []).filter((x) => (x.type || 'regular') === 'regular'), ...(d.symbols || []).filter((x) => (x.type || 'regular') !== 'regular')];
  const cell = (c, v) => {
    if (c.t === 'select') return `<select data-c="${esc(c.k)}" data-ct="select">${optHtml(c.o, v)}</select>`;
    if (c.t === 'symbol') return `<select data-c="${esc(c.k)}" data-ct="symbol">${regular.map((x) => `<option value="${esc(x.id)}" ${x.id === v ? 'selected' : ''}>${esc(x.name || x.id)}</option>`).join('')}</select>`;
    if (c.t === 'text') return `<input data-c="${esc(c.k)}" data-ct="text" value="${esc(v ?? '')}" />`;
    return `<input type="number" data-c="${esc(c.k)}" data-ct="${c.t}" value="${v ?? ''}" ${lim(c)} />`;
  };
  let input;
  switch (f.t) {
    case 'bool': input = `<label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" ${attrs} style="width:auto" ${val ? 'checked' : ''} /> ${esc(f.l)}</label>`; break;
    case 'select': input = `<select ${attrs}>${optHtml(f.o, val)}</select>`; break;
    case 'text': input = `<input ${attrs} value="${esc(val ?? '')}" />`; break;
    case 'pct': input = `<div class="row" style="gap:6px;flex-wrap:nowrap"><input type="number" ${attrs} value="${val == null ? '' : +(val * 100).toFixed(4)}" min="${(f.min ?? 0) * 100}" max="${(f.max ?? 1) * 100}" step="${(f.step ?? 0.01) * 100}" /><span>%</span></div>`; break;
    case 'list': input = `<input ${attrs} value="${esc((val || []).join(', '))}" placeholder="1, 2, 3" />`; break;
    case 'multi': input = `<div class="row" ${attrs}>${f.o.map(([ov, ol]) => `<label class="row" style="gap:6px;margin:0;color:var(--text)"><input type="checkbox" value="${esc(ov)}" style="width:auto" ${(val || []).includes(ov) ? 'checked' : ''} />${esc(ol)}</label>`).join('')}</div>`; break;
    case 'kv': {
      const rows = Object.entries(val || {});
      input = `<table class="fn-table" ${attrs} data-kind="kv"><tr><th>${esc(f.kl || 'Clave')}</th><th>${esc(f.vl || 'Valor')}</th><th></th></tr>
        ${rows.map(([k, v2]) => `<tr><td><input type="number" data-c="k" value="${esc(k)}" /></td><td><input type="number" data-c="v" value="${v2}" step="any" /></td><td><button type="button" class="small ghost" data-del>✕</button></td></tr>`).join('')}
        <tr class="fn-add"><td colspan="3"><button type="button" class="small" data-add>＋ Agregar</button></td></tr></table>`;
      break;
    }
    case 'table': {
      const rows = Array.isArray(val) ? val : [];
      input = `<table class="fn-table" ${attrs} data-kind="table"><tr>${f.cols.map((c) => `<th>${esc(c.l)}</th>`).join('')}<th></th></tr>
        ${rows.map((r) => `<tr>${f.cols.map((c) => `<td>${cell(c, r[c.k])}</td>`).join('')}<td><button type="button" class="small ghost" data-del>✕</button></td></tr>`).join('')}
        <tr class="fn-add"><td colspan="${f.cols.length + 1}"><button type="button" class="small" data-add>＋ Agregar fila</button></td></tr></table>`;
      break;
    }
    default: input = `<input type="number" ${attrs} value="${val ?? ''}" ${lim(f)} ${f.nullable ? 'placeholder="(apagado)"' : ''} />`;
  }
  return `<div class="fn-field fn-${f.t}">${f.t === 'bool' ? '' : `<label for="${id}">${esc(f.l)}</label>`}${input}${f.help ? `<div class="muted fn-help">${esc(f.help)}</div>` : ''}</div>`;
}
function engineFunctionsCard(d) {
  const schema = engineInfo(d.engine).ruleSchema || [];
  if (!schema.length) return '';
  const R = d.rules || {};
  const visible = (f) => !f.when || Object.entries(f.when).every(([k, v]) => rGet(R, k) === v);
  const groups = [];
  schema.forEach((f, i) => {
    if (!visible(f)) return;
    let g = groups.find((x) => x.name === (f.g || 'General'));
    if (!g) groups.push(g = { name: f.g || 'General', html: [] });
    g.html.push(fnFieldHtml(f, rGet(R, f.k), d, i));
  });
  return `<div class="card stack" id="fnCard"><h3 style="margin:0">⚙ Funciones del motor</h3>
    ${engineInfo(d.engine).kind === 'crash' ? '<p class="muted" style="margin:0">RTP, tope, ritmo de la ronda y curva del multiplicador. Los cambios se aplican desde la ronda siguiente en la vista previa y al publicar.</p>' : `<p class="muted" style="margin:0">Todo lo que hace ${esc(engineInfo(d.engine).name || d.engine)}: bonus, multiplicadores, giros gratis, compras y funciones especiales. Después de guardar pulsa «Ajustar RTP al objetivo» para recalibrar los pagos y los precios.</p>`}
    ${groups.map((g) => `<details class="fn-group" open><summary>${esc(g.name)}</summary><div class="fn-grid">${g.html.join('')}</div></details>`).join('')}
    <div class="row"><button class="primary" id="fnSave">Guardar funciones</button><span class="error" id="fnErr"></span></div></div>`;
}
function readEngineFunctions(root, d) {
  const schema = engineInfo(d.engine).ruleSchema || [];
  const rules = structuredClone(d.rules);
  const num = (x, t) => (x === '' || x == null ? null : t === 'int' ? Math.round(Number(x)) : Number(x));
  for (const el of $$('[data-fn]', root)) {
    const f = schema[Number(el.dataset.fn)];
    if (!f) continue;
    let v;
    switch (f.t) {
      case 'bool': v = el.checked; break;
      case 'select': v = JSON.parse(el.value); break;
      case 'text': v = el.value; break;
      case 'pct': v = el.value === '' ? null : +(Number(el.value) / 100).toFixed(8); break;
      case 'list': v = el.value.split(/[,;\s]+/).filter(Boolean).map(Number); break;
      case 'multi': v = $$('input:checked', el).map((x) => x.value); break;
      case 'kv': v = Object.fromEntries($$('tr', el).filter((tr) => $('[data-c="k"]', tr)).map((tr) => [String(Math.round(Number($('[data-c="k"]', tr).value))), Number($('[data-c="v"]', tr).value)]).filter(([k, x]) => k !== 'NaN' && Number.isFinite(x))); break;
      case 'table': v = $$('tr', el).filter((tr) => $('[data-c]', tr)).map((tr) => {
        const row = {};
        for (const c of $$('[data-c]', tr)) {
          const t = c.dataset.ct;
          const x = t === 'select' ? JSON.parse(c.value) : t === 'text' || t === 'symbol' ? c.value : num(c.value, t);
          if (x !== '' && x != null) row[c.dataset.c] = x;
        }
        return row;
      }); break;
      default: v = num(el.value, f.t);
    }
    if (f.nullable && v === 0 && f.k.endsWith('Cost')) v = null;
    // Funciones que este juego no tenía y quedaron vacías: no se agregan
    const empty = v == null || v === false || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
    if (empty && rGet(d.rules, f.k) === undefined) continue;
    rSet(rules, f.k, v);
  }
  return rules;
}
function bindEngineFunctions(root, d) {
  const card = $('#fnCard', root);
  if (!card) return;
  const schema = engineInfo(d.engine).ruleSchema || [];
  card.addEventListener('click', (e) => {
    if (e.target.matches('[data-del]')) { e.target.closest('tr').remove(); return; }
    if (e.target.matches('[data-add]')) {
      const tbl = e.target.closest('table');
      const f = schema[Number(tbl.dataset.fn)];
      const add = e.target.closest('tr');
      const tmp = document.createElement('tbody');
      if (tbl.dataset.kind === 'kv') tmp.innerHTML = '<tr><td><input type="number" data-c="k" /></td><td><input type="number" data-c="v" step="any" /></td><td><button type="button" class="small ghost" data-del>✕</button></td></tr>';
      else {
        const html = fnFieldHtml({ ...f, k: f.k }, [{}], d, tbl.dataset.fn);
        const probe = document.createElement('div'); probe.innerHTML = html;
        tmp.append($$('tr', probe).find((tr) => $('[data-c]', tr)));
      }
      add.before(...tmp.children);
    }
  });
  // Los campos que dependen de otro (ej. tipo de bonus) aparecen al cambiarlo
  const deps = new Set(schema.flatMap((f) => Object.keys(f.when || {})));
  card.addEventListener('change', (e) => {
    const f = schema[Number(e.target.dataset.fn)];
    if (f && deps.has(f.k)) {
      const rules = readEngineFunctions(root, d);
      const tmp = document.createElement('div');
      tmp.innerHTML = engineFunctionsCard({ ...d, rules });
      card.replaceWith(tmp.firstElementChild);
      bindEngineFunctions(root, { ...d, rules, _orig: d._orig || d });
    }
  });
  $('#fnSave', root).addEventListener('click', guard(async () => {
    $('#fnErr', root).textContent = '';
    try {
      const rules = readEngineFunctions(root, d);
      await patchDraft([{ op: 'set', path: 'rules', value: rules }], 'Funciones guardadas. Pulsa «Ajustar RTP al objetivo» para recalibrar pagos y precios');
      renderTab();
    } catch (e) { $('#fnErr', root).textContent = `${e.message}${e.details ? ': ' + e.details.join(' · ') : ''}`; }
  }));
}

async function tabMath(v) {
  if (engineInfo(S.game.engine).kind === 'table') return tabMathTable(v);
  if (engineInfo(S.game.engine).kind === 'crash') return tabMathCrash(v);
  const d = S.game.draft;
  const m = S.game.math;
  v.innerHTML = `<div class="stack">
    <div class="card stack"><h3 style="margin:0">Versión publicada</h3>
      ${m ? `<div class="kpi"><div><small>RTP</small><b>${pct(m.rtp)}</b></div><div><small>IC 95 %</small><b style="font-size:14px">${pct(m.ci?.[0])} – ${pct(m.ci?.[1])}</b></div>
      <div><small>Frecuencia de premio</small><b>${pct(m.hitFrequency)}</b></div><div><small>Bonus cada</small><b>${m.featureEvery ? `1/${m.featureEvery}` : '—'}</b></div>
      <div><small>Volatilidad</small><b>${esc(m.volatility)}</b></div>${m.rtpLevel1 != null ? `<div><small>${S.game.engine === 'level-up' ? 'RTP en el nivel 1' : 'RTP sin progreso guardado'}</small><b>${pct(m.rtpLevel1)}</b></div>` : ''}${(m.buyOptions?.length ? m.buyOptions : m.buy ? [{ mode: 'buy', cost: m.buy.buyCost, rtp: m.buy.rtp }] : [])
      .map((b) => `<div><small>${b.mode === 'ante' ? 'Doble chance' : `Compra ${esc(BUY_NAMES[b.mode] || b.mode)}`}</small><b>${b.cost}× · ${pct(b.rtp)}</b></div>`).join('')}</div>` : '<p class="muted">Sin publicar.</p>'}
    </div>
    <div class="card stack"><h3 style="margin:0">Tamaño de la cuadrícula${d.rules.lines != null ? ' y líneas' : ''}</h3>
      <div class="row">
        <div style="width:150px"><label>Rodillos (verticales)</label><input id="gReels" type="number" min="${engineInfo(d.engine).gridLimits.reels[0]}" max="${engineInfo(d.engine).gridLimits.reels[1]}" value="${d.grid.reels}" /></div>
        ${engineInfo(d.engine).variableRows ? '<div class="muted" style="max-width:260px">En los Megaways cada rodillo muestra de 2 a 7 filas al azar en cada giro.</div>'
    : `<div style="width:150px"><label>Filas (horizontales)</label><input id="gRows" type="number" min="${engineInfo(d.engine).gridLimits.rows[0]}" max="${engineInfo(d.engine).gridLimits.rows[1]}" value="${d.grid.rows}" /></div>`}
        ${d.rules.lines != null ? `<div style="width:170px"><label>Líneas de pago <span id="gMax" class="muted"></span></label><input id="gLines" type="number" min="1" max="100" value="${d.rules.lines}" /></div>` : ''}
        <button class="primary" id="gApply">Aplicar y ajustar RTP</button>
      </div>
      <p class="muted">Ahora: <b>${d.grid.reels} × ${d.grid.rows ?? `${d.grid.rowsMin}–${d.grid.rowsMax}`}</b>${d.rules.lines != null ? ` · <b>${d.rules.lines} líneas</b>` : ({ cluster: ' · paga por grupos que se tocan, sin líneas', count: ' · paga por cantidad de iguales en pantalla, sin líneas', rows: ' · paga por fila: 3, 4 o 5 iguales en la misma fila' }[engineInfo(d.engine).paysBy]
      || ` · paga por formas (${engineInfo(d.engine).variableRows ? 'hasta ' + (7 ** d.grid.reels).toLocaleString('es') : (d.grid.rows ** d.grid.reels).toLocaleString('es')} formas), sin líneas`)}.
      Al aplicar se reconstruyen los rodillos, se completa la tabla de pagos y se reajusta el RTP al objetivo (tarda entre 10 s y 1 min). Revisa la vista previa y publica.</p>
    </div>
    <div class="card stack"><h3 style="margin:0">Borrador</h3>
      <div class="row">
        <div style="width:160px"><label>RTP objetivo</label><input id="mTarget" type="number" step="0.001" min="0.85" max="1.10" value="${d.rtpTarget}" /><div class="muted">0.85 a 1.10 (85 %–110 %)</div></div>
        <div id="rtpWarn" class="error" style="max-width:330px" ${d.rtpTarget > 1 ? '' : 'hidden'}>⚠ Por encima de 100 % el juego paga más de lo que recauda: pierdes dinero con cada apuesta. Úsalo solo para promociones o demo.</div>
        <div style="width:170px"><label>Giros a simular</label><select id="mSpins"><option>200000</option><option selected>500000</option><option>1000000</option><option>3000000</option></select></div>
        ${engineInfo(d.engine).modes?.length > 1 ? `<div style="width:190px"><label>Modo</label><select id="mMode"><option value="base">Juego base</option>${engineInfo(d.engine).modes.filter((x) => x !== 'base' && ((x === 'buy' && d.rules.buyCost) || (x === 'ante' && d.rules.anteCost) || d.rules.bonusMenu?.[x.replace(/^buy-/, '')]?.enabled)).map((x) => `<option value="${x}">${x === 'ante' ? 'Doble chance' : `Compra: ${BUY_NAMES[x] || x}`}</option>`).join('')}</select></div>` : ''}
        <button id="mSim">Simular</button><button class="primary" id="mTune">Ajustar RTP al objetivo</button>
      </div>
      <div id="mOut"></div>
    </div>
    ${engineFunctionsCard(d)}
    <details class="card stack"><summary><b>Avanzado: reglas en JSON (<code>rules</code>)</b></summary>
      <p class="muted">${d.rules.bonusMenu ? 'Aquí también se edita el menú de compra (<code>bonusMenu</code>): activar/desactivar cada bono, giros, segmentos de la ruleta y premios del "elige un premio". Los precios se recalculan al pulsar “Ajustar RTP”.' : ''}
      ${d.rules.specialCoins ? 'Monedas especiales: <code>specialChance</code> y <code>specialCoins</code> (multiplicador o +1 re-giro).' : ''}
      ${d.rules.wildMode ? 'Modo de comodines: <code>wildMode</code> = "sticky" (fijos en giros gratis) o "walking" (caminan y dan re-giros).' : ''}</p>
      ${d.engine === 'colossal-reels' ? `<div class="card stack" style="background:var(--panel2)"><b>Colosal en los giros gratis</b>
        <div class="row"><input id="mFsCol" type="range" min="0" max="1" step="0.05" value="${d.rules.fsColossalChance ?? 1}" style="max-width:320px" />
          <b id="mFsColV">${Math.round((d.rules.fsColossalChance ?? 1) * 100)} %</b><span class="muted" id="mFsColT"></span></div>
        <p class="muted" style="margin:0">100 % = un colosal garantizado en cada giro gratis. Menos % = sale a veces; 0 % = nunca. Cambia cuánto paga el bonus: después pulsa «Ajustar RTP al objetivo».</p>
        <div class="row"><button id="mFsColSave">Guardar</button></div></div>` : ''}
      <textarea id="mRules" rows="14">${esc(JSON.stringify(d.rules, null, 2))}</textarea>
      <div class="row"><button id="mRulesSave">Guardar reglas</button></div>
    </details>
    <div class="card row"><button id="mBetSave" class="ghost">Editar niveles de apuesta…</button><button id="mAutoSave" class="ghost">Giros automáticos (${esc((d.bet.autoSpins || [10, 25, 50, 100]).join(' · '))})…</button></div>
    </div>`;
  bindEngineFunctions(v, d);
  const showSim = (s, title) => {
    $('#mOut').innerHTML = `<h4>${title}</h4><div class="kpi">
      <div><small>RTP</small><b>${pct(s.rtp)}</b></div><div><small>IC 95 %</small><b style="font-size:14px">${pct(s.rtpLow)} – ${pct(s.rtpHigh)}</b></div>
      <div><small>Frecuencia de premio</small><b>${pct(s.hitFrequency)}</b></div><div><small>Bonus cada</small><b>${s.featureEvery ? `1/${s.featureEvery}` : '—'}</b></div>
      <div><small>Volatilidad (σ)</small><b>${esc(s.volatility)} · ${s.volatilitySd}</b></div><div><small>Máx. observado</small><b>${s.maxWinObserved}×</b></div>
      <div><small>Giros</small><b>${s.spins.toLocaleString('es')}</b></div><div><small>Tiempo</small><b>${(s.ms / 1000).toFixed(1)} s</b></div></div>
      <p class="muted">Distribución: ${Object.entries(s.distribution).map(([k, x]) => `${k}: ${pct(x)}`).join(' · ')}</p>`;
  };
  if ($('#mFsCol')) {
    const lab = () => { const x = Number($('#mFsCol').value); $('#mFsColV').textContent = `${Math.round(x * 100)} %`; $('#mFsColT').textContent = x >= 1 ? 'garantizado' : x > 0 ? 'a veces' : 'sin colosales en el bonus'; };
    lab();
    $('#mFsCol').addEventListener('input', lab);
    $('#mFsColSave').addEventListener('click', guard(async () => {
      const x = Number($('#mFsCol').value);
      await patchDraft([{ op: 'set', path: 'rules.fsColossalChance', value: x >= 1 ? null : x }], 'Guardado. Ahora pulsa «Ajustar RTP al objetivo» para recalibrar los pagos');
      renderTab();
    }));
  }
  const updateMax = guard(async () => {
    if (!$('#gLines')) return;
    const q = new URLSearchParams({ reels: $('#gReels').value, rows: $('#gRows')?.value || '' });
    const info = await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/grid?${q}`);
    $('#gMax').textContent = `(máx. ${info.maxLines})`;
    $('#gLines').max = info.maxLines;
  });
  $('#gReels').addEventListener('change', updateMax);
  $('#gRows')?.addEventListener('change', updateMax);
  updateMax();
  $('#gApply').addEventListener('click', guard(async (e) => {
    const body = { reels: Number($('#gReels').value) };
    if ($('#gRows')) body.rows = Number($('#gRows').value);
    if ($('#gLines')) body.lines = Number($('#gLines').value);
    const r = await busy(e.target, () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/resize`, { method: 'POST', body }));
    await refreshGame();
    toast(`Cuadrícula ${r.grid.reels}×${r.grid.rows ?? 'variable'}${r.lines ? ` · ${r.lines} líneas` : ''} · RTP ${pct(r.final.rtp)}`);
    reloadPreview();
    renderTab();
  }));
  $('#mTarget').addEventListener('input', () => { $('#rtpWarn').hidden = !(Number($('#mTarget').value) > 1); });
  $('#mSim').addEventListener('click', guard(async (e) => {
    const s = await busy(e.target, () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/simulate`, { method: 'POST', body: { spins: Number($('#mSpins').value), mode: $('#mMode')?.value || 'base' } }));
    showSim(s, 'Simulación del borrador');
  }));
  $('#mTune').addEventListener('click', guard(async (e) => {
    $('#mOut').innerHTML = '<p class="muted">⏳ Ajustando y midiendo con muestras nuevas hasta lograr ±0,3 % de precisión (hasta ~1 minuto)…</p>';
    const r = await busy(e.target, () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/tune`, { method: 'POST', body: { target: Number($('#mTarget').value) } }));
    showSim({ ...r.final }, `Ajustado: ${r.history.map((h) => pct(h.rtp)).join(' → ')}${r.final?.precision ? ` · precisión ±${(r.final.precision * 100).toFixed(2)} % (${(r.final.spins / 1e6).toFixed(1)} M giros)` : ''}${(r.buyOptions || []).map((b) => ` · ${BUY_NAMES[b.mode] || b.mode} ${b.cost}× (${pct(b.rtp)})`).join('')}`);
    await refreshGame();
    toast('Tabla de pagos ajustada en el borrador');
  }));
  $('#mRulesSave').addEventListener('click', guard(async () => {
    let rules;
    try { rules = JSON.parse($('#mRules').value); } catch { throw new Error('JSON de reglas inválido'); }
    await patchDraft([{ op: 'set', path: 'rules', value: rules }, { op: 'set', path: 'rtpTarget', value: Number($('#mTarget').value) }], 'Reglas guardadas');
  }));
  $('#mAutoSave')?.addEventListener('click', guard(async () => {
    const cur = (d.bet.autoSpins || [10, 25, 50, 100]).join(', ');
    const val = prompt('Cantidades de giros automáticos que puede elegir el jugador (hasta 8, separadas por coma):', cur);
    if (val == null) return;
    const list = [...new Set(val.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0 && x <= 1000))].sort((a, b) => a - b).slice(0, 8);
    if (!list.length) throw new Error('Pon al menos una cantidad');
    await patchDraft([{ op: 'set', path: 'bet.autoSpins', value: list }], `Giros automáticos: ${list.join(', ')}. Publica para aplicarlo`);
  }));
  $('#mBetSave').addEventListener('click', guard(async () => {
    const cur = d.bet.levels.join(', ');
    const val = prompt('Niveles de apuesta en centavos separados por coma:', cur);
    if (val == null) return;
    const levels = val.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
    await patchDraft([{ op: 'set', path: 'bet.levels', value: levels }, { op: 'set', path: 'bet.default', value: levels.includes(d.bet.default) ? d.bet.default : levels[0] }], 'Apuestas guardadas');
  }));
}

// ---- Frecuencia del bonus ----
function featureCard(v) {
  const d = S.game.draft;
  if ((engineInfo(d.engine).kind || 'slot') !== 'slot') return;
  const hasTrigger = (d.symbols || []).some((x) => ['scatter', 'wildscatter', 'coin'].includes(x.type));
  if (!hasTrigger) return;
  const fe = S.game.math?.featureEvery;
  const el = document.createElement('div');
  el.className = 'card stack';
  el.innerHTML = `<h3 style="margin:0">🎁 Frecuencia del bonus</h3>
    <p class="muted">Hoy el bonus sale en promedio cada <b>${fe ? `~${fe.toLocaleString('es')} giros` : '— giros (simula para verlo)'}</b>.
      Referencia de mercado: volatilidad media 100–200 giros, alta 200–400. Más frecuente = más entretenido; los pagos se reajustan solos para mantener el RTP.</p>
    <div class="row" style="align-items:end"><div><label>Bonus cada ~</label><input id="feEvery" type="number" min="20" max="5000" step="10" value="${fe && fe < 400 ? fe : 150}" style="width:130px" /></div>
      <span class="muted" style="margin-bottom:10px">giros</span><button class="primary" id="feGo">Calibrar</button><span id="feOut" class="muted"></span></div>
    <p class="muted" style="margin:0">Tarda alrededor de un minuto. Cambia el borrador: revisa en ▶ Vista previa y publica.</p>`;
  v.appendChild(el);
  $('#feGo', el).addEventListener('click', guard(async () => {
    const btn = $('#feGo', el);
    $('#feOut', el).textContent = 'Calibrando… (≈1 minuto)';
    const r = await busy(btn, () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/feature-frequency`, { method: 'POST', body: { every: Number($('#feEvery', el).value) } }));
    $('#feOut', el).textContent = `Listo: bonus cada ~${r.featureEvery} giros · RTP ${pct(r.final.rtp)}`;
    await refreshGame();
    toast(`Bonus cada ~${r.featureEvery} giros con RTP ${pct(r.final.rtp)}. Publica para aplicarlo.`);
    reloadPreview();
  }));
}

// ---- Apuestas por moneda (bet.byCurrency) ----
const CURRENCY_LIST = ['USD', 'EUR', 'GBP', 'CAD', 'ARS', 'BRL', 'MXN', 'CLP', 'COP', 'PEN', 'UYU', 'PYG', 'BOB', 'VES', 'DOP', 'CRC', 'GTQ', 'TRY', 'INR', 'JPY', 'CNY', 'KRW', 'PHP', 'ZAR', 'NGN', 'KES', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'USDT'];
const niceRound = (x) => { if (!(x > 0)) return 1; const p = 10 ** Math.floor(Math.log10(x)); const m = x / p; return Math.max(1, Math.round((m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p)); };
const units = (list) => list.map((c) => (c / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })).join(' · ');
const parseUnits = (txt) => String(txt).split(/[;\s·]+/).map((x) => x.trim().replace(',', '.')).filter(Boolean).map((x) => Math.round(Number(x) * 100)).filter((x) => x > 0);

function currencyCard(v) {
  const d = S.game.draft;
  const base = d.bet || {};
  const table = (engineInfo(d.engine).kind || 'slot') !== 'slot';
  const rows = Object.entries(base.byCurrency || {});
  const el = document.createElement('div');
  el.className = 'card stack';
  el.id = 'curCard';
  el.innerHTML = `<h3 style="margin:0">💱 Apuestas por moneda</h3>
    <p class="muted">Moneda base <b>${esc(base.currency || 'USD')}</b>: fichas ${units(base.levels || [])}. Para cada moneda en que operan tus casinos, define sus fichas (el RTP no cambia: los premios son múltiplos de la apuesta).
      Si una moneda no está en la lista, se usan los mismos números que la base. Cada operador puede además tener un mínimo y un máximo propios (Operadores → Gestionar).</p>
    <table><thead><tr><th>Moneda</th><th>Fichas (en unidades, separadas por ;)</th><th>Predeterminada</th>${table ? '<th>Límites mín · máx · total mesa</th>' : ''}<th></th></tr></thead><tbody id="curRows">
    ${rows.map(([cur, x]) => `<tr data-cur="${esc(cur)}"><td><b>${esc(cur)}</b></td><td><input data-lv value="${esc((x.levels || []).map((c) => c / 100).join('; '))}" placeholder="200; 500; 1000" /></td>
      <td><input data-def value="${x.default != null ? x.default / 100 : ''}" style="width:110px" placeholder="la 1.ª" /></td>
      ${table ? `<td class="row" style="gap:4px;flex-wrap:nowrap"><input data-lmin style="width:90px" value="${x.limits ? x.limits.min / 100 : ''}" placeholder="auto" /><input data-lmax style="width:100px" value="${x.limits ? x.limits.max / 100 : ''}" placeholder="auto" /><input data-ltab style="width:110px" value="${x.limits ? x.limits.table / 100 : ''}" placeholder="auto" /></td>` : ''}
      <td><button class="small danger" data-del>Quitar</button></td></tr>`).join('') || `<tr><td colspan="${table ? 5 : 4}" class="muted">Sin monedas adicionales: todas usan las fichas base.</td></tr>`}
    </tbody></table>
    <div class="row" style="align-items:end;flex-wrap:wrap">
      <div><label>Agregar moneda</label><select id="curNew" style="width:120px">${CURRENCY_LIST.filter((c) => c !== (base.currency || 'USD') && !(base.byCurrency || {})[c]).map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div><label>1 ${esc(base.currency || 'USD')} = </label><input id="curRate" type="number" step="any" min="0" placeholder="Ej. 1000" style="width:130px" /></div>
      <button id="curSuggest">Sugerir fichas</button>
      <span class="muted">Convierte las fichas base con ese valor y las redondea a cifras cómodas (1, 2, 2,5, 5…). Luego puedes ajustarlas.</span></div>
    <div class="row"><button class="primary" id="curSave">Guardar apuestas por moneda</button><span id="curErr" class="error"></span></div>`;
  v.appendChild(el);
  const collect = () => {
    const out = {};
    for (const tr of $$('#curRows tr[data-cur]', el)) {
      const levels = [...new Set(parseUnits($('[data-lv]', tr).value))].sort((a, b) => a - b);
      const defTxt = $('[data-def]', tr).value.trim();
      const entry = { levels, ...(defTxt ? { default: parseUnits(defTxt)[0] } : {}) };
      if (table) {
        const [mn, mx, tb] = ['[data-lmin]', '[data-lmax]', '[data-ltab]'].map((q) => $(q, tr).value.trim());
        if (mn || mx || tb) entry.limits = { min: parseUnits(mn)[0], max: parseUnits(mx)[0], table: parseUnits(tb)[0] };
      }
      out[tr.dataset.cur] = entry;
    }
    return out;
  };
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', () => { const tr = b.closest('tr'); tr.remove(); }));
  $('#curSuggest', el).addEventListener('click', guard(async () => {
    const cur = $('#curNew', el).value, rate = Number($('#curRate', el).value);
    if (!cur) throw new Error('Elige una moneda');
    if (!(rate > 0)) throw new Error(`Indica cuánto vale 1 ${base.currency || 'USD'} en ${cur}`);
    const levels = [...new Set((base.levels || []).map((c) => niceRound(c * rate)))];
    const def = base.default ? niceRound(base.default * rate) : levels[0];
    const byCurrency = { ...collect(), [cur]: { levels, default: levels.includes(def) ? def : levels[0] } };
    if (table && d.rules?.limits) {
      const L = d.rules.limits;
      byCurrency[cur].limits = { min: niceRound(L.min * rate), max: niceRound(L.max * rate), table: niceRound(L.table * rate) };
    }
    await patchDraft([{ op: 'set', path: 'bet.byCurrency', value: byCurrency }], `Fichas en ${cur} sugeridas: revísalas y publica`);
    renderTab();
  }));
  $('#curSave', el).addEventListener('click', async () => {
    try {
      await patchDraft([{ op: 'set', path: 'bet.byCurrency', value: collect() }], 'Apuestas por moneda guardadas: publica para aplicarlas');
      $('#curErr', el).textContent = '';
      renderTab();
    } catch (e) { $('#curErr', el).textContent = `${e.message}${e.details ? ': ' + e.details.join(' · ') : ''}`; }
  });
}

// ------------------------------------------------------------------ Pestaña: Assets
async function tabAssets(v) {
  const list = await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId || '')}`);
  v.innerHTML = `<div class="stack"><div class="row"><label style="margin:0">Subir:</label><input type="file" id="aUp" multiple style="max-width:340px" accept="image/*,audio/*,video/mp4,video/webm,.woff2,.woff,.ttf,.otf" /></div>
    <div class="gallery">${list.map((a) => assetTile(a)).join('') || '<p class="muted">Sin assets todavía.</p>'}</div></div>`;
  $('#aUp').addEventListener('change', guard(async (e) => {
    for (const f of e.target.files) await uploadFile(f, f.type.startsWith('audio/') ? 'sound' : f.type.startsWith('video/') ? 'video' : /\.(woff2?|ttf|otf)$/i.test(f.name) ? 'font' : 'image');
    toast('Archivos subidos');
    renderTab();
  }));
}

// ------------------------------------------------------------------ Pestaña: JSON
async function tabJson(v) {
  v.innerHTML = `<div class="stack"><p class="muted">Edición avanzada del borrador completo. Se valida al guardar.</p>
    <textarea id="jText" rows="30">${esc(JSON.stringify(S.game.draft, null, 2))}</textarea>
    <div class="row"><button class="primary" id="jSave">Guardar</button><span id="jErr" class="error"></span></div></div>`;
  $('#jSave').addEventListener('click', guard(async () => {
    let c;
    try { c = JSON.parse($('#jText').value); } catch (e) { $('#jErr').textContent = `JSON inválido: ${e.message}`; return; }
    try {
      await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/draft`, { method: 'PUT', body: c });
      $('#jErr').textContent = '';
      await refreshGame();
      toast('Borrador guardado');
      reloadPreview();
    } catch (e) {
      $('#jErr').textContent = `${e.message}${e.details ? ': ' + e.details.join(' · ') : ''}`;
    }
  }));
}

// ------------------------------------------------------------------ Pestaña: Versiones
async function tabVersions(v) {
  const list = await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/versions`);
  v.innerHTML = `<div class="card"><table><thead><tr><th>Versión</th><th>Fecha</th><th>Autor</th><th>RTP</th><th>Nota</th><th></th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>v${x.version}${x.version === S.game.publishedVersion ? ' <span class="badge ok">en vivo</span>' : ''}</td><td>${esc(x.created_at)}</td><td>${esc(x.created_by)}</td>
      <td>${pct(x.math?.rtp)}</td><td>${esc(x.note)}</td><td><button class="small" data-restore="${x.version}">Cargar en borrador</button></td></tr>`).join('')}
    </tbody></table><p class="muted">Cada versión publicada es inmutable y cada ronda registra la versión con la que se jugó (trazabilidad para auditoría).</p>
    <div class="row"><button class="danger" id="toggleStatus">${S.game.status === 'active' ? 'Desactivar juego' : 'Activar juego'}</button>
      ${isOp() ? '' : '<button id="convertGame">🔁 Cambiar motor (copia)</button><button class="danger" id="deleteGame">🗑 Eliminar juego</button><span class="muted">Para juegos creados por error. No se puede si ya tuvo jugadas con dinero real (se conservan para auditoría): en ese caso, desactívalo.</span>'}</div></div>`;
  $$('[data-restore]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    if (!confirm(`¿Reemplazar el borrador actual por la v${b.dataset.restore}?`)) return;
    await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/restore/${b.dataset.restore}`, { method: 'POST' });
    await refreshGame();
    toast('Borrador restaurado');
    reloadPreview();
  })));
  $('#convertGame')?.addEventListener('click', guard(async () => {
    const engines = (await (await fetch('/api/v1/engines')).json()).filter((e) => e.id !== S.game.engine);
    const g = S.game;
    openPicker('Cambiar motor (crea una copia)', `<div class="stack">
      <p class="muted" style="margin:0">Se crea un <b>juego nuevo</b> con el motor que elijas y el diseño de «${esc(g.name)}»: fondos, logo, marco, botonera, carteles, textos, tipografías, sonidos, ambiente del bonus, fichas por moneda y marca.
        Las imágenes y nombres de los símbolos pasan por equivalencia (comodín con comodín, scatter con scatter, y los normales de menor a mayor pago). La matemática es la del motor nuevo, calibrada al RTP de este juego. <b>El original no se toca.</b></p>
      <div><label>Motor nuevo — toca una ficha para elegirlo</label>${enginePicker(engines, 'cvEngine')}</div>
      <div><label>Nombre del juego nuevo</label><input id="cvName" value="${esc(g.name)} 2" /></div>
      <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="cvTune" style="width:auto" checked /> Calibrar la matemática al RTP de este juego (${pct(g.draft.rtpTarget)}) — puede tardar hasta ~1 minuto</label>
      <div class="row"><button class="primary" id="cvGo">Crear copia con el motor nuevo</button><span class="muted" id="cvMsg"></span></div></div>`, (root, close) => {
      bindEnginePicker(root, 'cvEngine');
      $('#cvGo', root).addEventListener('click', guard(async () => {
        $('#cvMsg', root).textContent = '⏳ Creando y calibrando…';
        const r = await busy($('#cvGo', root), () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/convert`, { method: 'POST', body: { engine: $('#cvEngine', root).value, name: $('#cvName', root).value.trim(), tune: $('#cvTune', root).checked } }));
        close();
        await loadGames();
        await selectGame(r.game.id);
        openPicker(`«${r.game.name}» creado con ${engineInfo(r.engine).name || r.engine}`, `<div class="stack">
          <p style="margin:0">Se conservó el diseño. Así pasaron los símbolos:</p>
          <div class="gallery">${r.mapping.map((m) => `<div class="tile" style="cursor:default"><img src="${esc(m.image)}" alt="" /><b>${esc(m.name)}</b><span class="muted">${esc(m.type === 'regular' ? 'normal' : m.type)}</span></div>`).join('')}</div>
          ${r.missing.length ? `<p class="error" style="margin:0">Sin imagen del original (quedan las de la plantilla): ${r.missing.map((m) => `${esc(m.name)} (${esc(m.type)})`).join(', ')}. Cámbialas en 🧩 Símbolos o pídeselas al Artista.</p>` : ''}
          ${r.unused.length ? `<p class="muted" style="margin:0">No se usaron del original: ${r.unused.map((m) => esc(m.name)).join(', ')}.</p>` : ''}
          ${r.tuned ? `<p class="muted" style="margin:0">Matemática calibrada: RTP ${pct(r.tuned.rtp)}${r.tuned.precision ? ` ±${(r.tuned.precision * 100).toFixed(2)} %` : ''}.</p>` : ''}
          <p class="muted" style="margin:0">Revísalo en ▶ Vista previa y publícalo cuando esté listo. El juego original sigue igual.</p></div>`);
      }));
    });
  }));
  $('#deleteGame')?.addEventListener('click', guard(async () => {
    const name = S.game.name;
    const typed = prompt(`Vas a ELIMINAR «${name}» (${S.gameId}) con sus versiones, borrador y pruebas. Esto no se puede deshacer.\n\nPara confirmar, escribe el nombre del juego:`);
    if (typed === null) return;
    const r = await api(`/api/admin/games/${encodeURIComponent(S.gameId)}`, { method: 'DELETE', body: { confirm: typed.trim() } });
    toast(`«${r.name}» eliminado`);
    S.gameId = null; S.game = null; location.hash = '';
    $('#gameBar').hidden = true; $('#tabs').hidden = true; $('#previewPane').hidden = true;
    $('#view').innerHTML = '<div class="card"><p class="muted">Juego eliminado. Elige otro juego en la lista.</p></div>';
    await loadGames();
  }));
  $('#toggleStatus').addEventListener('click', guard(async () => {
    await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/status`, { method: 'POST', body: { status: S.game.status === 'active' ? 'disabled' : 'active' } });
    await refreshGame(); await loadGames(); renderTab();
  }));
}

// ------------------------------------------------------------------ Vistas de plataforma
const VIEWS = {};
$('#platformNav').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-view]');
  if (a) openView(a.dataset.view);
});

function openView(name, ...args) {
  S.platformView = name;
  S.gameId = null;
  location.hash = isOp() ? name : '';
  $$('.side nav a').forEach((x) => x.classList.toggle('on', x.dataset.view === name));
  $('#gameBar').hidden = true;
  $('#tabs').hidden = true;
  $('#previewPane').hidden = true;
  const v = $('#view');
  v.innerHTML = '';
  guard(VIEWS[name])(v, ...args);
}

// ---- Inicio: fichas de los motores (de qué se trata cada uno), borradores y juegos creados ----
VIEWS.home = async (v) => {
  const engines = Object.values(S.engines);
  const drafts = S.games.filter((g) => !g.factory && !g.publishedVersion).sort((a, b) => String(b.draftUpdatedAt || '').localeCompare(String(a.draftUpdatedAt || '')));
  const created = S.games.filter((g) => !g.factory && g.publishedVersion).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const gameCard = (g) => `<button type="button" class="home-game" data-open="${esc(g.id)}"><b>${esc(g.name)}</b>
    <small>${esc(S.engines[g.engine]?.name || g.engine)} · ${g.publishedVersion ? `v${g.publishedVersion}` : 'sin publicar'}${g.publishedVersion && g.hasUnpublishedChanges ? ' · <span class="gl-pend">cambios sin publicar</span>' : ''}</small></button>`;
  v.innerHTML = `<div class="stack home">
    <div class="home-head"><div><h2 style="margin:0">🏠 Inicio</h2>
      <p class="muted" style="margin:4px 0 0">${engines.length} motores · ${drafts.length} borradores · ${created.length} juegos creados</p></div>
      <button class="primary" id="homeNew">＋ Nuevo juego</button></div>
    <section class="stack"><h3 class="home-title">📝 Borradores <em>${drafts.length}</em></h3>
      ${drafts.length ? `<div class="home-games">${drafts.map(gameCard).join('')}</div>` : '<p class="muted" style="margin:0">Sin borradores. Crea un juego desde la ficha de un motor.</p>'}</section>
    <section class="stack"><h3 class="home-title">⭐ Creados <em>${created.length}</em></h3>
      ${created.length ? `<div class="home-games">${created.map(gameCard).join('')}</div>` : '<p class="muted" style="margin:0">Todavía no publicaste juegos propios.</p>'}</section>
    <section class="stack"><h3 class="home-title">⚙ Motores <em>${engines.length}</em></h3>
      <p class="muted" style="margin:0">Cada ficha explica de qué se trata el motor. «Ver juego» abre su juego de ejemplo; «Crear juego» arma uno nuevo con ese motor.</p>
      <div class="eng-cards home-engines">${engines.map((e) => {
        // Juegos de ejemplo del motor (Craps tiene dos: la mesa normal y la mesa en vivo con crupier)
        const ex = S.games.filter((g) => g.factory && g.engine === e.id).sort((a, b) => (a.id === e.id ? -1 : b.id === e.id ? 1 : 0));
        return `<div class="eng-card">${engineCardBody(e)}
          <div class="home-actions">${ex.map((g) => `<button class="small" data-open="${esc(g.id)}">▶ Ver juego: ${esc(g.name)}</button>`).join('')}<button class="small primary" data-new="${esc(e.id)}">＋ Crear juego</button></div></div>`;
      }).join('')}</div></section></div>`;
  $('#homeNew', v).addEventListener('click', () => openNewGame());
  $('.home', v).addEventListener('click', (ev) => {
    const o = ev.target.closest('[data-open]');
    if (o) return selectGame(o.dataset.open);
    const n = ev.target.closest('[data-new]');
    if (n) openNewGame(n.dataset.new);
  });
};
$('#homeNav')?.addEventListener('click', () => openView('home'));
$('#brand')?.addEventListener('click', () => { if (!isOp()) openView('home'); });

async function viewOperators(v) {
  const ops = await api('/api/admin/operators');
  v.innerHTML = `<div class="stack"><h2 style="margin:0">Operadores</h2>
    <p class="muted">Cada operador (casino que integra tus juegos) recibe una API key para abrir sesiones de jugador y usuarios para su portal en
      <a href="/operator" target="_blank">${esc(location.origin)}/operator</a>. En “Gestionar” eliges qué juegos ve, con qué RTP, y si puede crear juegos propios.
      Documentación: <a href="/docs/API.md" target="_blank">docs/API.md</a></p>
    <div class="card" style="overflow:auto"><table><thead><tr><th>Nombre</th><th>Billetera</th><th>Moneda</th><th>Juegos propios</th><th>Usuarios</th><th>Estado</th><th></th></tr></thead><tbody>
      ${ops.map((o) => `<tr><td><b>${esc(o.name)}</b><div class="muted"><code>${esc(o.id)}</code></div></td><td>${esc(o.wallet_mode)}${o.wallet_url ? `<div class="muted">${esc(o.wallet_url)}</div>` : ''}</td><td>${esc(o.currency)}</td>
      <td>${o.can_create_games ? `${o.own_games} de ${o.max_games}` : '<span class="muted">no habilitado</span>'}</td><td>${o.users}</td>
      <td>${o.active ? '<span class="badge ok">activo</span>' : '<span class="badge warn">suspendido</span>'}</td>
      <td class="row"><button class="small primary" data-manage="${esc(o.id)}">Gestionar</button><button class="small" data-rotate="${esc(o.id)}">Nueva API key</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin operadores.</td></tr>'}</tbody></table></div>
    <div class="card stack"><h3 style="margin:0">Nuevo operador</h3><div class="grid2">
      <div><label>Nombre</label><input id="oName" /></div>
      <div><label>Billetera</label><select id="oMode"><option value="internal">Interna (saldo en esta plataforma)</option><option value="seamless">Seamless (saldo en el operador)</option></select></div>
      <div><label>URL de billetera (seamless)</label><input id="oUrl" placeholder="https://operador.com/wallet" /></div>
      <div><label>Moneda</label><input id="oCur" value="USD" maxlength="3" /></div></div>
      <div class="row"><button class="primary" id="oCreate">Crear</button></div><div id="oSecret"></div></div></div>`;
  const showSecret = (r) => {
    $('#oSecret').innerHTML = `<p><b>Guarda esto ahora, no se volverá a mostrar:</b></p><div class="secret">API key: ${esc(r.apiKey)}${r.walletSecret ? `<br>Secreto de firma de billetera: ${esc(r.walletSecret)}` : ''}</div>
      ${r.id && r.name ? `<p><button class="primary" data-manage="${esc(r.id)}">Configurar juegos, RTP y usuarios de ${esc(r.name)} →</button></p>` : ''}`;
    $$('#oSecret [data-manage]').forEach((b) => b.addEventListener('click', () => openView('operator', b.dataset.manage)));
  };
  $('#oCreate').addEventListener('click', guard(async () => {
    const r = await api('/api/admin/operators', { method: 'POST', body: { name: $('#oName').value, walletMode: $('#oMode').value, walletUrl: $('#oUrl').value || null, currency: $('#oCur').value.toUpperCase() } });
    showSecret(r);
  }));
  $$('[data-manage]', v).forEach((b) => b.addEventListener('click', () => openView('operator', b.dataset.manage)));
  $$('[data-rotate]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    if (!confirm('La API key actual dejará de funcionar. ¿Continuar?')) return;
    showSecret(await api(`/api/admin/operators/${b.dataset.rotate}/rotate-key`, { method: 'POST' }));
  })));
}

const RTP_CHOICES = [0.85, 0.88, 0.90, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98];
const ROLE_NAMES = { admin: 'Administrador', finance: 'Finanzas', support: 'Soporte' };

function secretBox(title, lines) {
  return `<div class="card stack" style="border-color:var(--warn)"><b>${esc(title)}</b><div class="secret">${lines.map(esc).join('<br>')}</div>
    <span class="muted">Cópialo ahora: no se volverá a mostrar.</span></div>`;
}

/** Vista del proveedor sobre un operador: permisos, juegos y RTP, usuarios del portal. */
async function viewOperator(v, id, flash = '') {
  const o = await api(`/api/admin/operators/${encodeURIComponent(id)}`);
  const rtpCell = (g) => {
    if (!g.publishedVersion) return '<span class="muted">sin publicar</span>';
    if (g.kind === 'table') return `<span class="muted">Mesa: RTP por pagos (${pct(g.defaultRtp)})</span>`;
    if (g.kind === 'crash') return `<span class="muted">Crash: RTP exacto del juego (${pct(g.defaultRtp)})</span>`;
    const cur = g.rtpTarget;
    const opts = [`<option value="" ${cur == null ? 'selected' : ''}>Por defecto (${pct(g.defaultRtp)})</option>`,
      ...[...new Set([...RTP_CHOICES, ...(cur != null ? [cur] : [])])].sort().map((t) => `<option value="${t}" ${cur != null && Math.abs(cur - t) < 1e-6 ? 'selected' : ''}>${(t * 100).toFixed(2)} %</option>`),
      '<option value="other">Otro…</option>'];
    const st = g.variant ? (g.variant.status === 'ready' ? `<span class="badge ok">listo · real ${pct(g.rtp)}</span>` : g.variant.status === 'building' ? '<span class="badge warn">calculando…</span>' : '<span class="badge warn">pendiente</span>') : '';
    return `<div class="row" style="gap:6px"><select data-rtp="${esc(g.id)}" style="width:215px">${opts.join('')}</select>${st}</div>`;
  };
  v.innerHTML = `<div class="stack">
    <div class="row" style="justify-content:space-between"><div><h2 style="margin:0">${esc(o.name)}</h2>
      <div class="muted"><code>${esc(o.id)}</code> · billetera ${esc(o.walletMode)} · ${esc(o.currency)} · portal: <a href="/operator" target="_blank">${esc(location.origin)}/operator</a></div></div>
      <div class="row"><button class="ghost" data-back>← Operadores</button><button class="${o.active ? 'danger' : 'primary'}" id="opActive">${o.active ? 'Suspender operador' : 'Reactivar operador'}</button></div></div>
    ${flash}
    <div class="card stack"><h3 style="margin:0">Permisos</h3>
      <div class="grid2">
        <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="pCreate" style="width:auto" ${o.canCreateGames ? 'checked' : ''} /> Puede crear juegos propios</label>
        <div><label>Máximo de juegos propios (usa ${o.usedGames})</label><input type="number" id="pMax" min="0" max="1000" value="${o.maxGames}" /></div>
        <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="pAgents" style="width:auto" ${o.canUseAgents ? 'checked' : ''} /> Puede usar los agentes de IA en sus juegos</label>
      </div>
      <p class="muted">Sus juegos propios parten de un juego de tu catálogo con el RTP que le asignaste. Puede cambiar diseño, imágenes y sonidos; la matemática, el RTP y las apuestas quedan bloqueados.
        Los agentes de IA consumen tus créditos de Claude, Venice y ElevenLabs, y nunca tocan la matemática.</p>
      <div class="row"><button class="primary" id="pSave">Guardar permisos</button></div></div>
    <div class="card stack"><h3 style="margin:0">Límites de apuesta</h3>
      <p class="muted">Acota la apuesta mínima y máxima de este casino por moneda (su moneda es <b>${esc(o.currency)}</b>). Se aplica a todos sus juegos: solo verá las fichas dentro del rango. Vacío = sin límite propio.</p>
      <table><thead><tr><th>Moneda</th><th>Mínima</th><th>Máxima</th><th></th></tr></thead><tbody id="blRows">
      ${[...new Set([o.currency, ...Object.keys(o.betLimits || {})])].map((cur) => `<tr data-cur="${esc(cur)}"><td><b>${esc(cur)}</b></td>
        <td><input data-min type="number" step="0.01" min="0" style="width:140px" value="${o.betLimits?.[cur]?.min != null ? o.betLimits[cur].min / 100 : ''}" /></td>
        <td><input data-max type="number" step="0.01" min="0" style="width:140px" value="${o.betLimits?.[cur]?.max != null ? o.betLimits[cur].max / 100 : ''}" /></td><td></td></tr>`).join('')}
      </tbody></table>
      <div class="row"><select id="blCur" style="width:110px">${CURRENCY_LIST.map((c) => `<option>${c}</option>`).join('')}</select><button class="small" id="blAdd">＋ Otra moneda</button>
        <button class="primary" id="blSave">Guardar límites</button></div></div>
    <div class="card stack" style="overflow:auto"><h3 style="margin:0">Juegos y RTP</h3>
      <p class="muted">Desmarca los juegos que este operador no puede ofrecer. El RTP asignado se calcula con la misma matemática del juego (se ajustan los pagos) y se aplica a todas sus sesiones nuevas.
        Mientras se calcula, ese juego no se abre para él (nunca juega con un RTP distinto al asignado).</p>
      <table><thead><tr><th>Juego</th><th>Habilitado</th><th>RTP para este operador</th></tr></thead><tbody>
      ${o.games.map((g) => `<tr><td><b>${esc(g.name)}</b> ${g.own ? '<span class="badge">propio</span>' : ''}<div class="muted">${esc(g.engine)}${g.status !== 'active' ? ' · desactivado' : ''}</div></td>
        <td><input type="checkbox" data-en="${esc(g.id)}" style="width:auto" ${g.enabled ? 'checked' : ''} ${g.own ? 'disabled' : ''} /></td><td>${rtpCell(g)}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="card stack" style="overflow:auto"><h3 style="margin:0">Usuarios del portal</h3>
      <table><thead><tr><th>Email</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th></th></tr></thead><tbody>
      ${o.users.map((u) => `<tr data-u="${esc(u.id)}"><td>${esc(u.email)}${u.name ? `<div class="muted">${esc(u.name)}</div>` : ''}</td>
        <td><select data-role style="width:150px">${Object.entries(ROLE_NAMES).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td>${u.active ? '<span class="badge ok">activo</span>' : '<span class="badge warn">desactivado</span>'}</td><td>${esc(u.lastLoginAt || '—')}</td>
        <td class="row"><button class="small" data-reset>Nueva contraseña</button><button class="small ${u.active ? 'danger' : ''}" data-toggle>${u.active ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Todavía no tiene usuarios.</td></tr>'}
      </tbody></table>
      <div class="grid2"><div><label>Email</label><input id="uEmail" type="email" placeholder="admin@sucasino.com" /></div><div><label>Nombre</label><input id="uName" /></div>
        <div><label>Rol</label><select id="uRole">${Object.entries(ROLE_NAMES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div></div>
      <div class="row"><button class="primary" id="uCreate">Crear usuario</button><span class="muted">Administrador: todo · Finanzas: reportes, jugadores y saldo · Soporte: solo consulta.</span></div></div>
  </div>`;
  const reload = (msg = '') => viewOperator(v, id, msg);
  $('[data-back]', v).addEventListener('click', () => openView('operators'));
  $('#opActive').addEventListener('click', guard(async () => {
    if (o.active && !confirm(`¿Suspender a ${o.name}? Sus jugadores no podrán abrir juegos nuevos y su portal quedará bloqueado.`)) return;
    await api(`/api/admin/operators/${id}`, { method: 'PATCH', body: { active: !o.active } });
    reload();
  }));
  $('#pSave').addEventListener('click', guard(async () => {
    await api(`/api/admin/operators/${id}`, { method: 'PATCH', body: { canCreateGames: $('#pCreate').checked, maxGames: Number($('#pMax').value), canUseAgents: $('#pAgents').checked } });
    toast('Permisos guardados');
    reload();
  }));
  $('#blAdd').addEventListener('click', () => {
    const cur = $('#blCur').value;
    if ($(`#blRows tr[data-cur="${cur}"]`)) return;
    $('#blRows').insertAdjacentHTML('beforeend', `<tr data-cur="${cur}"><td><b>${cur}</b></td><td><input data-min type="number" step="0.01" min="0" style="width:140px" /></td><td><input data-max type="number" step="0.01" min="0" style="width:140px" /></td><td></td></tr>`);
  });
  $('#blSave').addEventListener('click', guard(async () => {
    const betLimits = {};
    for (const tr of $$('#blRows tr[data-cur]')) {
      const mn = $('[data-min]', tr).value, mx = $('[data-max]', tr).value;
      if (mn !== '' || mx !== '') betLimits[tr.dataset.cur] = { min: mn === '' ? null : Math.round(Number(mn) * 100), max: mx === '' ? null : Math.round(Number(mx) * 100) };
    }
    await api(`/api/admin/operators/${id}`, { method: 'PATCH', body: { betLimits } });
    toast('Límites de apuesta guardados');
  }));
  $$('[data-en]', v).forEach((c) => c.addEventListener('change', guard(async () => {
    await api(`/api/admin/operators/${id}/games/${encodeURIComponent(c.dataset.en)}`, { method: 'PUT', body: { enabled: c.checked } });
    toast(c.checked ? 'Juego habilitado' : 'Juego deshabilitado para este operador');
  })));
  $$('[data-rtp]', v).forEach((sel) => sel.addEventListener('change', guard(async () => {
    let val = sel.value;
    if (val === 'other') {
      const t = prompt('RTP para este operador (entre 85 y 110, en %):', '95');
      if (t == null) return reload();
      val = Number(String(t).replace(',', '.')) / 100;
    }
    await api(`/api/admin/operators/${id}/games/${encodeURIComponent(sel.dataset.rtp)}`, { method: 'PUT', body: { rtpTarget: val === '' ? null : Number(val) } });
    toast(val === '' ? 'Vuelve al RTP por defecto' : 'RTP asignado: se está calculando la tabla de pagos');
    reload();
  })));
  $$('tr[data-u]', v).forEach((tr) => {
    const uid = tr.dataset.u;
    $('[data-role]', tr).addEventListener('change', guard(async (e) => { await api(`/api/admin/operators/${id}/users/${uid}`, { method: 'PATCH', body: { role: e.target.value } }); toast('Rol actualizado'); }));
    $('[data-toggle]', tr).addEventListener('click', guard(async () => { const u = o.users.find((x) => x.id === uid); await api(`/api/admin/operators/${id}/users/${uid}`, { method: 'PATCH', body: { active: !u.active } }); reload(); }));
    $('[data-reset]', tr).addEventListener('click', guard(async () => {
      if (!confirm('Se generará una contraseña temporal y se cerrarán sus sesiones. ¿Continuar?')) return;
      const r = await api(`/api/admin/operators/${id}/users/${uid}/reset-password`, { method: 'POST' });
      reload(secretBox('Contraseña temporal', [`Usuario: ${o.users.find((x) => x.id === uid).email}`, `Contraseña: ${r.temporaryPassword}`, `Portal: ${location.origin}/operator`]));
    }));
  });
  $('#uCreate').addEventListener('click', guard(async () => {
    const r = await api(`/api/admin/operators/${id}/users`, { method: 'POST', body: { email: $('#uEmail').value, name: $('#uName').value, role: $('#uRole').value } });
    reload(secretBox('Usuario creado: pásale estos datos al operador', [`Portal: ${location.origin}/operator`, `Usuario: ${r.email}`, `Contraseña temporal: ${r.temporaryPassword}`, 'Al entrar se le pedirá cambiarla.']));
  }));
  // Refresca solo mientras haya RTP calculándose
  clearTimeout(S.opPoll);
  if (o.games.some((g) => g.variant?.status === 'building')) S.opPoll = setTimeout(() => { if (S.platformView === 'operator' && $('#opActive')) viewOperator(v, id, flash); }, 4000);
}

async function viewRounds(v) {
  const [rounds, audit] = await Promise.all([api('/api/admin/rounds?limit=100'), api('/api/admin/audit?limit=60')]);
  v.innerHTML = `<div class="stack"><h2 style="margin:0">Rondas</h2>
    <div class="card" style="overflow:auto"><table><thead><tr><th>Fecha</th><th>Juego</th><th>v</th><th>Modo</th><th>Apuesta</th><th>Coste</th><th>Premio</th><th>Estado</th><th></th></tr></thead><tbody>
      ${rounds.map((r) => `<tr><td>${esc(r.created_at)}</td><td>${esc(r.game_id)}</td><td>${r.version ?? 'borr.'}</td><td>${esc(r.mode)}/${esc(r.play_mode)}</td><td>${money(r.bet)}</td><td>${money(r.cost)}</td><td>${money(r.win)}</td>
      <td>${esc(r.status)}${r.error ? `<div class="error">${esc(r.error)}</div>` : ''}</td><td>${r.version ? `<button class="small" data-replay="${esc(r.id)}">Verificar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted">“Verificar” recalcula la ronda con los números aleatorios grabados y la versión exacta del juego, y comprueba que el premio coincide.</p>
    <h2 style="margin:0">Auditoría</h2>
    <div class="card" style="overflow:auto"><table><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Objetivo</th></tr></thead><tbody>
      ${audit.map((a) => `<tr><td>${esc(a.created_at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.target)}</td></tr>`).join('')}</tbody></table></div></div>`;
  $$('[data-replay]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const r = await api(`/api/admin/rounds/${b.dataset.replay}/replay`);
    toast(r.match ? `✔ Coincide: premio ${money(r.recomputed)} (${r.drawsUsed} números aleatorios)` : `✖ NO coincide: guardado ${money(r.stored)} vs recalculado ${money(r.recomputed)}`, !r.match);
  })));
}

async function viewStats(v) {
  const rows = await api('/api/admin/stats?days=30');
  v.innerHTML = `<div class="stack"><h2 style="margin:0">Últimos 30 días</h2><div class="card"><table><thead><tr><th>Juego</th><th>Modo</th><th>Rondas</th><th>Jugadores</th><th>Apostado</th><th>Pagado</th><th>RTP real</th><th>GGR</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.game_id)}</td><td>${esc(r.mode)}</td><td>${r.rounds}</td><td>${r.players}</td><td>${money(r.wagered)}</td><td>${money(r.won)}</td><td>${pct(r.rtp)}</td><td>${money(r.wagered - r.won)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Sin datos.</td></tr>'}
    </tbody></table></div><p class="muted">El RTP real converge al teórico con volumen; con pocas rondas puede variar mucho.</p></div>`;
}

// ------------------------------------------------------------------ Portal del operador
const day = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => day(new Date(Date.now() - n * 86400_000));

function rangeBar(id, q) {
  return `<div class="row" id="${id}" style="align-items:end">
    <div><label>Desde</label><input type="date" data-from value="${esc(q.from)}" style="width:160px" /></div>
    <div><label>Hasta</label><input type="date" data-to value="${esc(q.to)}" style="width:160px" /></div>
    <div class="row" style="gap:4px">${[['Hoy', 0], ['7 días', 6], ['30 días', 29], ['90 días', 89]].map(([l, n]) => `<button class="small ghost" data-days="${n}">${l}</button>`).join('')}</div></div>`;
}
function bindRange(root, q, onChange) {
  $('[data-from]', root).addEventListener('change', (e) => { q.from = e.target.value; onChange(); });
  $('[data-to]', root).addEventListener('change', (e) => { q.to = e.target.value; onChange(); });
  $$('[data-days]', root).forEach((b) => b.addEventListener('click', () => { q.from = daysAgo(Number(b.dataset.days)); q.to = day(new Date()); onChange(); }));
}

async function downloadCsv(kind, q = {}) {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString();
  const res = await fetch(`/api/portal/export/${kind}.csv${qs ? `?${qs}` : ''}`, { headers: { authorization: `Bearer ${S.token}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: `${kind}-${q.from || ''}_${q.to || ''}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const S_Q = { from: daysAgo(29), to: day(new Date()) };

VIEWS.summary = async function viewSummary(v) {
  const q = S_Q;
  const d = await api(`/api/portal/summary?from=${q.from}&to=${q.to}`);
  const t = d.totals;
  const max = Math.max(1, ...d.byDay.map((x) => Math.abs(x.ggr)));
  v.innerHTML = `<div class="stack"><div class="row" style="justify-content:space-between;align-items:end"><h2 style="margin:0">Resumen · ${esc(S.me.operator.name)}</h2>${rangeBar('rg', q)}</div>
    <div class="kpi">
      <div><small>Apostado</small><b>${money(t.wagered)}</b></div><div><small>Pagado</small><b>${money(t.won)}</b></div>
      <div><small>GGR (queda para el casino)</small><b style="color:${t.ggr >= 0 ? 'var(--ok)' : 'var(--danger, #e74c3c)'}">${money(t.ggr)}</b></div>
      <div><small>RTP real</small><b>${pct(t.rtp)}</b></div><div><small>Rondas</small><b>${t.rounds.toLocaleString('es')}</b></div><div><small>Jugadores</small><b>${t.players}</b></div>
      <div><small>Premios por acreditar</small><b>${d.pendingCredits.n ? `${d.pendingCredits.n} · ${money(d.pendingCredits.amount)}` : '0'}</b></div>
    </div>
    <div class="card stack"><div class="row" style="justify-content:space-between"><h3 style="margin:0">GGR por día</h3><button class="small" id="csvDay">⬇ CSV por día</button></div>
      ${d.byDay.length ? `<div style="display:flex;align-items:flex-end;gap:3px;height:140px;padding-top:10px">${d.byDay.map((x) => `<div title="${esc(x.day)} · GGR ${money(x.ggr)} · ${x.rounds} rondas"
        style="flex:1;min-width:4px;max-width:48px;height:${Math.max(2, Math.abs(x.ggr) / max * 130)}px;border-radius:4px 4px 0 0;background:${x.ggr >= 0 ? 'var(--ok)' : '#e74c3c'};opacity:.85"></div>`).join('')}</div>
      <div class="row muted" style="justify-content:space-between;font-size:11px"><span>${esc(d.byDay[0].day)}</span><span>${esc(d.byDay.at(-1).day)}</span></div>` : '<p class="muted">Sin jugadas con dinero real en este período.</p>'}</div>
    <div class="card" style="overflow:auto"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Por juego</h3><button class="small" id="csvGame">⬇ CSV por juego</button></div>
      <table><thead><tr><th>Juego</th><th>Rondas</th><th>Jugadores</th><th>Apostado</th><th>Pagado</th><th>GGR</th><th>RTP real</th></tr></thead><tbody>
      ${d.byGame.map((g) => `<tr><td>${esc(g.game_name || g.game_id)}</td><td>${g.rounds}</td><td>${g.players}</td><td>${money(g.wagered)}</td><td>${money(g.won)}</td><td>${money(g.ggr)}</td><td>${pct(g.rtp)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin datos.</td></tr>'}
      </tbody></table><p class="muted">Solo dinero real (sin demo). Fechas en UTC. El RTP real se acerca al teórico con volumen; con pocas rondas varía mucho.</p></div></div>`;
  bindRange($('#rg', v), q, () => VIEWS.summary(v));
  $('#csvDay').addEventListener('click', guard(() => downloadCsv('summary', q)));
  $('#csvGame').addEventListener('click', guard(() => downloadCsv('games', q)));
};

const STATUS_NAMES = { completed: 'completada', pending_credit: 'premio por acreditar', pending_debit: 'cobrando', debit_failed: 'cobro rechazado', rolled_back: 'anulada' };

VIEWS.plays = async function viewPlays(v, preset = {}) {
  const q = { ...S_Q, player: '', game: '', status: '', mode: 'real', ...preset };
  const games = (await api('/api/portal/games')).catalog;
  let rows = [], offset = 0;
  v.innerHTML = `<div class="stack"><h2 style="margin:0">Jugadas</h2>
    <div class="card stack"><div class="row" style="align-items:end;flex-wrap:wrap">
      <div><label>Jugador (tu id)</label><input id="fPlayer" value="${esc(q.player)}" placeholder="u-123" style="width:150px" /></div>
      <div><label>Juego</label><select id="fGame" style="width:170px"><option value="">Todos</option>${games.map((g) => `<option value="${esc(g.id)}" ${q.game === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
      <div><label>Estado</label><select id="fStatus" style="width:170px"><option value="">Todos</option>${Object.entries(STATUS_NAMES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div><label>Modo</label><select id="fMode" style="width:110px"><option value="real">Real</option><option value="demo">Demo</option><option value="">Todos</option></select></div>
      <div><label>Ronda</label><input id="fRound" placeholder="rd_…" style="width:150px" /></div>
      ${rangeBar('rg', q)}</div>
      <div class="row"><button class="primary" id="fGo">Buscar</button><button id="fCsv">⬇ Descargar CSV</button></div></div>
    <div class="card" style="overflow:auto"><table><thead><tr><th>Fecha (UTC)</th><th>Jugador</th><th>Juego</th><th>Jugada</th><th>Apuesta</th><th>Cobrado</th><th>Premio</th><th>Saldo después</th><th>Estado</th></tr></thead><tbody id="pRows"></tbody></table>
      <div class="row" style="margin-top:10px"><button id="pMore" hidden>Cargar más</button><span class="muted" id="pCount"></span></div>
      <p class="muted">Toca una jugada para ver el detalle completo (resultado, números de la tirada) y verificarla: se recalcula con los números aleatorios grabados y la versión exacta del juego.</p></div></div>`;
  $('#fMode').value = q.mode;
  const read = () => Object.assign(q, { player: $('#fPlayer').value.trim(), game: $('#fGame').value, status: $('#fStatus').value, mode: $('#fMode').value, round: $('#fRound').value.trim() });
  const qs = () => new URLSearchParams(Object.entries({ ...q, limit: 100, offset }).filter(([, x]) => x !== '' && x != null)).toString();
  const draw = () => {
    $('#pRows').innerHTML = rows.map((r) => `<tr data-r="${esc(r.id)}" style="cursor:pointer"><td>${esc(r.created_at)}</td><td>${esc(r.player)}</td><td>${esc(r.game_id)}</td><td>${esc(r.mode)}/${esc(r.play_mode)}</td>
      <td>${money(r.bet)}</td><td>${money(r.cost)}</td><td>${r.win ? `<b style="color:var(--ok)">${money(r.win)}</b>` : money(0)}</td><td>${r.balance_after == null ? '—' : money(r.balance_after)}</td>
      <td>${esc(STATUS_NAMES[r.status] || r.status)}${r.error ? `<div class="error">${esc(r.error)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Sin jugadas con esos filtros.</td></tr>';
    $$('#pRows tr[data-r]').forEach((tr) => tr.addEventListener('click', guard(() => showRound(tr.dataset.r))));
    $('#pCount').textContent = rows.length ? `${rows.length} jugadas` : '';
  };
  const load = guard(async (more = false) => {
    if (!more) { offset = 0; rows = []; }
    const page = await api(`/api/portal/rounds?${qs()}`);
    rows = rows.concat(page); offset += page.length;
    $('#pMore').hidden = page.length < 100;
    draw();
  });
  $('#fGo').addEventListener('click', () => { read(); load(); });
  $('#pMore').addEventListener('click', () => load(true));
  $('#fCsv').addEventListener('click', guard(() => { read(); return downloadCsv('rounds', q); }));
  bindRange($('#rg', v), q, () => { read(); load(); });
  load();
};

async function showRound(id) {
  const r = await api(`/api/portal/rounds/${encodeURIComponent(id)}`);
  openPicker(`Jugada ${r.id}`, `<div class="stack">
    <div class="kpi"><div><small>Jugador</small><b>${esc(r.player)}</b></div><div><small>Juego</small><b>${esc(r.gameId)} v${r.version ?? '—'}</b></div>
      <div><small>Cobrado</small><b>${money(r.cost)}</b></div><div><small>Premio</small><b>${money(r.win)}</b></div>
      <div><small>Saldo antes → después</small><b>${r.balanceBefore == null ? '—' : money(r.balanceBefore)} → ${r.balanceAfter == null ? '—' : money(r.balanceAfter)}</b></div>
      <div><small>Estado</small><b>${esc(STATUS_NAMES[r.status] || r.status)}</b></div></div>
    <div class="muted">Fecha ${esc(r.createdAt)} UTC · modo ${esc(r.mode)}/${esc(r.playMode)}${r.clientRoundId ? ` · id del cliente ${esc(r.clientRoundId)}` : ''}</div>
    ${r.result?.dice ? `<div><b>Dados:</b> ${r.result.dice.join(' + ')} = ${r.result.total}</div>` : ''}
    <div class="row">${r.verifiable ? '<button class="primary" id="rVerify">✔ Verificar esta jugada</button>' : '<span class="muted">Esta operación no tiene números aleatorios que verificar.</span>'}<span id="rVerOut"></span></div>
    <details><summary>Resultado completo (JSON)</summary><pre style="max-height:320px;overflow:auto;font-size:11px">${esc(JSON.stringify(r.result, null, 2))}</pre></details></div>`, (root) => {
    $('#rVerify', root)?.addEventListener('click', guard(async () => {
      const x = await api(`/api/portal/rounds/${encodeURIComponent(id)}/verify`);
      $('#rVerOut', root).innerHTML = x.match ? `<span class="badge ok">Coincide: premio ${money(x.recomputed)} (${x.drawsUsed} números aleatorios)</span>` : `<span class="badge warn">NO coincide: guardado ${money(x.stored)} vs recalculado ${money(x.recomputed)}</span>`;
    }));
  });
}

VIEWS.players = async function viewPlayers(v) {
  const internal = S.me.operator.walletMode === 'internal';
  v.innerHTML = `<div class="stack"><h2 style="margin:0">Jugadores</h2>
    <div class="row"><input id="plQ" placeholder="Buscar por id de jugador" style="max-width:280px" /><button id="plGo">Buscar</button><button id="plCsv">⬇ CSV</button></div>
    <div class="card" style="overflow:auto"><table><thead><tr><th>Jugador</th><th>Moneda</th>${internal ? '<th>Saldo</th>' : ''}<th>Rondas</th><th>Apostado</th><th>Pagado</th><th>GGR</th><th>Última jugada</th></tr></thead><tbody id="plRows"></tbody></table>
    ${internal ? '' : '<p class="muted">Tu billetera es seamless: el saldo de cada jugador está en tu sistema, no aquí.</p>'}</div></div>`;
  const load = guard(async () => {
    const list = await api(`/api/portal/players?q=${encodeURIComponent($('#plQ').value.trim())}`);
    $('#plRows').innerHTML = list.map((p) => `<tr data-p="${esc(p.player)}" style="cursor:pointer"><td><b>${esc(p.player)}</b></td><td>${esc(p.currency)}</td>${internal ? `<td>${money(p.balance)}</td>` : ''}
      <td>${p.rounds}</td><td>${money(p.wagered)}</td><td>${money(p.won)}</td><td>${money(p.wagered - p.won)}</td><td>${esc(p.last_play || '—')}</td></tr>`).join('') || `<tr><td colspan="8" class="muted">Sin jugadores todavía.</td></tr>`;
    $$('#plRows tr[data-p]').forEach((tr) => tr.addEventListener('click', guard(() => showPlayer(tr.dataset.p, load))));
  });
  $('#plGo').addEventListener('click', load);
  $('#plQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  $('#plCsv').addEventListener('click', guard(() => downloadCsv('players', { q: $('#plQ').value.trim() })));
  load();
};

async function showPlayer(id, onChange) {
  const p = await api(`/api/portal/players/${encodeURIComponent(id)}`);
  const canMove = p.walletMode === 'internal' && can('balance');
  openPicker(`Jugador ${p.player}`, `<div class="stack">
    <div class="kpi">${p.balance != null ? `<div><small>Saldo</small><b>${money(p.balance)}</b></div>` : ''}<div><small>Rondas</small><b>${p.totals.rounds}</b></div>
      <div><small>Apostado</small><b>${money(p.totals.wagered)}</b></div><div><small>Pagado</small><b>${money(p.totals.won)}</b></div><div><small>GGR</small><b>${money(p.totals.ggr)}</b></div></div>
    ${canMove ? `<div class="card stack"><b>Cargar o retirar saldo</b><div class="grid2"><div><label>Monto (negativo = retiro)</label><input id="bAmt" type="number" step="0.01" placeholder="50.00" /></div>
      <div><label>Referencia (única, evita duplicados)</label><input id="bRef" placeholder="deposito-1234" /></div></div><div class="row"><button class="primary" id="bGo">Aplicar</button></div></div>` : ''}
    <div class="row"><button id="pPlays">Ver sus jugadas →</button></div>
    ${p.transactions.length ? `<details open><summary>Movimientos</summary><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Saldo</th><th>Referencia</th></tr></thead><tbody>
      ${p.transactions.map((t) => `<tr><td>${esc(t.created_at)}</td><td>${esc({ bet: 'apuesta', win: 'premio', deposit: 'carga', withdrawal: 'retiro' }[t.type] || t.type)}</td><td>${money(t.amount)}</td><td>${t.balance_after == null ? '—' : money(t.balance_after)}</td><td>${esc(t.external_ref || t.round_id || '')}</td></tr>`).join('')}</tbody></table></details>` : ''}
  </div>`, (root, close) => {
    $('#pPlays', root).addEventListener('click', () => { close(); openView('plays', { player: p.player }); });
    $('#bGo', root)?.addEventListener('click', guard(async () => {
      const amount = Math.round(Number(String($('#bAmt', root).value).replace(',', '.')) * 100);
      if (!amount) throw new Error('Indica un monto');
      if (!confirm(`${amount > 0 ? 'Cargar' : 'Retirar'} ${money(Math.abs(amount))} ${amount > 0 ? 'a' : 'de'} ${p.player}?`)) return;
      await api(`/api/portal/players/${encodeURIComponent(p.player)}/balance`, { method: 'POST', body: { amount, reference: $('#bRef', root).value.trim() || undefined } });
      toast('Saldo actualizado');
      close();
      onChange?.();
    }));
  });
}

VIEWS.catalog = async function viewCatalog(v) {
  const d = await api('/api/portal/games');
  const card = (g) => `<div class="card stack" style="gap:6px"><div class="row" style="justify-content:space-between"><b>${esc(g.name)}</b>${g.own ? '<span class="badge">propio</span>' : ''}</div>
    <div class="muted">${esc(g.engine)} · v${g.version}</div>
    <div>RTP <b>${pct(g.rtp)}</b>${g.volatility ? ` · volatilidad ${esc(g.volatility)}` : ''}${g.variant && g.variant.status !== 'ready' ? ' <span class="badge warn">RTP en preparación</span>' : ''}</div>
    <div class="muted">Apuestas ${esc(g.currency)}: ${g.bets?.length ? `${money(g.bets[0])} a ${money(g.bets.at(-1))}` : 'sin fichas disponibles'}</div>
    <div class="row"><button class="small primary" data-demo="${esc(g.id)}">▶ Probar demo</button><button class="small" data-code="${esc(g.id)}">Código de integración</button></div></div>`;
  v.innerHTML = `<div class="stack"><h2 style="margin:0">Catálogo de juegos</h2>
    <p class="muted">Estos son los juegos que tu proveedor habilitó para tu casino, con el RTP que aplica a tus jugadores. Para abrir uno, tu servidor crea una sesión con <code>gameId</code>.</p>
    <div class="grid2">${d.catalog.map(card).join('') || '<p class="muted">No tienes juegos habilitados. Contacta a tu proveedor.</p>'}</div></div>`;
  $$('[data-demo]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const s = await api('/api/portal/demo-session', { method: 'POST', body: { gameId: b.dataset.demo } });
    window.open(s.launchUrl, '_blank');
  })));
  $$('[data-code]', v).forEach((b) => b.addEventListener('click', () => {
    const base = location.origin;
    openPicker('Integración del juego', `<div class="stack"><p>Desde <b>tu servidor</b> (nunca desde el navegador), crea la sesión del jugador:</p>
      <pre style="white-space:pre-wrap;font-size:12px">curl -X POST ${esc(base)}/api/v1/operator/sessions \\
  -H "X-API-Key: TU_API_KEY" -H "Content-Type: application/json" \\
  -d '{"playerId":"ID_DE_TU_JUGADOR","gameId":"${esc(b.dataset.code)}","currency":"${esc(S.me.operator.currency)}","mode":"real","lobbyUrl":"https://tu-casino.com"}'</pre>
      <p>La respuesta trae <code>launchUrl</code>. Ábrelo en tu sitio:</p>
      <pre style="white-space:pre-wrap;font-size:12px">&lt;iframe src="LAUNCH_URL" style="width:100%;height:100vh;border:0" allow="autoplay; fullscreen"&gt;&lt;/iframe&gt;</pre>
      <p class="muted">Documentación completa: <a href="/docs/API.md" target="_blank">docs/API.md</a></p></div>`);
  }));
};

VIEWS.integration = async function viewIntegration(v, flash = '') {
  const d = await api('/api/portal/integration');
  const admin = can('integration');
  const seamless = d.walletMode === 'seamless';
  v.innerHTML = `<div class="stack"><h2 style="margin:0">Integración</h2>${flash}
    <div class="card stack"><div class="kpi"><div><small>Id de operador</small><b style="font-size:14px"><code>${esc(d.operatorId)}</code></b></div>
      <div><small>Billetera</small><b>${seamless ? 'Seamless (tu sistema)' : 'Interna'}</b></div><div><small>Moneda</small><b>${esc(d.currency)}</b></div>
      <div><small>API</small><b style="font-size:13px">${esc(d.apiBase || location.origin)}</b></div></div>
      <p class="muted">Guía paso a paso: <a href="/docs/API.md" target="_blank">docs/API.md</a>. Todas las cantidades van en centavos.</p></div>
    <div class="card stack"><h3 style="margin:0">API key</h3><p class="muted">Tu servidor la envía en la cabecera <code>X-API-Key</code>. Por seguridad no se muestra; si la perdiste o se filtró, genera una nueva (la anterior deja de funcionar al instante).</p>
      ${admin ? '<div class="row"><button class="danger" id="iKey">Generar nueva API key</button></div>' : '<p class="muted">Solo un usuario administrador puede cambiarla.</p>'}</div>
    ${seamless ? `<div class="card stack"><h3 style="margin:0">Billetera seamless</h3>
      <div class="grid2"><div><label>URL de tu billetera</label><input id="iUrl" value="${esc(d.walletUrl || '')}" placeholder="https://tu-casino.com/wallet" ${admin ? '' : 'disabled'} /></div></div>
      ${admin ? `<div class="row"><button id="iUrlSave">Guardar URL</button><button class="danger" id="iSecret">Nuevo secreto de firma</button></div>` : ''}
      <p class="muted">Cada pedido llega con <code>X-Signature</code> = HMAC-SHA256 del cuerpo con tu secreto. Acciones: balance, debit, credit, rollback. El <code>txId</code> es único: si llega repetido, no lo apliques dos veces.</p></div>
    ${admin ? `<div class="card stack"><h3 style="margin:0">Probar mi billetera</h3><p class="muted">Enviamos a tu URL: balance, un débito de 0,01, el mismo débito repetido (debe ignorarse), un crédito de 0,01 y un rollback. Usa un jugador de prueba de tu sistema.</p>
      <div class="row"><input id="iTestPlayer" placeholder="id de jugador de prueba" style="max-width:260px" /><button class="primary" id="iTest">Probar</button></div><div id="iTestOut"></div></div>` : ''}` : ''}
  </div>`;
  $('#iKey')?.addEventListener('click', guard(async () => {
    if (!confirm('La API key actual dejará de funcionar de inmediato. ¿Generar una nueva?')) return;
    const r = await api('/api/portal/integration/rotate-key', { method: 'POST' });
    VIEWS.integration(v, secretBox('Nueva API key', [r.apiKey]));
  }));
  $('#iUrlSave')?.addEventListener('click', guard(async () => { await api('/api/portal/integration', { method: 'PUT', body: { walletUrl: $('#iUrl').value.trim() } }); toast('URL guardada'); }));
  $('#iSecret')?.addEventListener('click', guard(async () => {
    if (!confirm('El secreto actual dejará de ser válido: actualízalo en tu servidor enseguida. ¿Continuar?')) return;
    const r = await api('/api/portal/integration/rotate-secret', { method: 'POST' });
    VIEWS.integration(v, secretBox('Nuevo secreto de firma', [r.walletSecret]));
  }));
  $('#iTest')?.addEventListener('click', guard(async () => {
    const btn = $('#iTest');
    const r = await busy(btn, () => api('/api/portal/integration/test-wallet', { method: 'POST', body: { playerId: $('#iTestPlayer').value.trim() } }));
    $('#iTestOut').innerHTML = `<p>${r.ok ? '<span class="badge ok">Todo correcto</span>' : '<span class="badge warn">Hay pasos con problemas</span>'}</p>
      <table><thead><tr><th>Paso</th><th>HTTP</th><th>Tiempo</th><th>Respuesta</th><th></th></tr></thead><tbody>${r.steps.map((x) => `<tr><td>${esc(x.action)}</td><td>${x.status ?? '—'}</td><td>${x.ms} ms</td>
        <td><code style="font-size:11px">${esc(typeof x.response === 'string' ? x.response : JSON.stringify(x.response)).slice(0, 160)}</code></td><td>${x.ok ? '✔' : `✖ <span class="error">${esc(x.hint || '')}</span>`}</td></tr>`).join('')}</tbody></table>`;
  }));
};

VIEWS.users = async function viewUsers(v, flash = '') {
  const { users, roles } = await api('/api/portal/users');
  v.innerHTML = `<div class="stack"><h2 style="margin:0">Usuarios del portal</h2>${flash}
    <div class="card" style="overflow:auto"><table><thead><tr><th>Email</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr data-u="${esc(u.id)}"><td>${esc(u.email)}${u.name ? `<div class="muted">${esc(u.name)}</div>` : ''}</td>
      <td><select data-role style="width:150px" ${u.id === S.me.user.id ? 'disabled' : ''}>${Object.keys(roles).map((k) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${ROLE_NAMES[k]}</option>`).join('')}</select></td>
      <td>${u.active ? '<span class="badge ok">activo</span>' : '<span class="badge warn">desactivado</span>'}</td><td>${esc(u.lastLoginAt || '—')}</td>
      <td class="row">${u.id === S.me.user.id ? '<span class="muted">tú</span>' : `<button class="small" data-reset>Nueva contraseña</button><button class="small ${u.active ? 'danger' : ''}" data-toggle>${u.active ? 'Desactivar' : 'Activar'}</button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="card stack"><h3 style="margin:0">Nuevo usuario</h3>
      <div class="grid2"><div><label>Email</label><input id="uEmail" type="email" /></div><div><label>Nombre</label><input id="uName" /></div>
      <div><label>Rol</label><select id="uRole">${Object.keys(roles).map((k) => `<option value="${k}">${ROLE_NAMES[k]}</option>`).join('')}</select></div></div>
      <ul class="muted" style="margin:0">${Object.entries(roles).map(([k, l]) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="row"><button class="primary" id="uCreate">Crear usuario</button></div></div></div>`;
  $$('tr[data-u]', v).forEach((tr) => {
    const uid = tr.dataset.u, u = users.find((x) => x.id === uid);
    $('[data-role]', tr).addEventListener('change', guard(async (e) => { await api(`/api/portal/users/${uid}`, { method: 'PATCH', body: { role: e.target.value } }); toast('Rol actualizado'); }));
    $('[data-toggle]', tr)?.addEventListener('click', guard(async () => { await api(`/api/portal/users/${uid}`, { method: 'PATCH', body: { active: !u.active } }); VIEWS.users(v); }));
    $('[data-reset]', tr)?.addEventListener('click', guard(async () => {
      const r = await api(`/api/portal/users/${uid}/reset-password`, { method: 'POST' });
      VIEWS.users(v, secretBox('Contraseña temporal', [`Usuario: ${u.email}`, `Contraseña: ${r.temporaryPassword}`]));
    }));
  });
  $('#uCreate').addEventListener('click', guard(async () => {
    const r = await api('/api/portal/users', { method: 'POST', body: { email: $('#uEmail').value, name: $('#uName').value, role: $('#uRole').value } });
    VIEWS.users(v, secretBox('Usuario creado', [`Portal: ${location.origin}/operator`, `Usuario: ${r.email}`, `Contraseña temporal: ${r.temporaryPassword}`]));
  }));
};

VIEWS.account = async function viewAccount(v) {
  v.innerHTML = `<div class="stack" style="max-width:520px"><h2 style="margin:0">Mi cuenta</h2>
    <div class="card stack"><div><b>${esc(S.me.user.email)}</b> · ${esc(ROLE_NAMES[S.me.user.role])} · ${esc(S.me.operator.name)}</div>
      <div><label>Contraseña actual</label><input id="aCur" type="password" autocomplete="current-password" /></div>
      <div><label>Nueva contraseña (mínimo 10 caracteres)</label><input id="aNew" type="password" autocomplete="new-password" /></div>
      <div class="row"><button class="primary" id="aSave">Cambiar contraseña</button></div></div>
    <button class="danger" id="aOut">Cerrar sesión</button></div>`;
  $('#aSave').addEventListener('click', guard(async () => {
    await api('/api/portal/password', { method: 'POST', body: { current: $('#aCur').value, next: $('#aNew').value } });
    S.me.user.mustChangePassword = false;
    toast('Contraseña cambiada');
    $('#aCur').value = ''; $('#aNew').value = '';
  }));
  $('#aOut').addEventListener('click', () => { logout(); location.hash = ''; });
};

function askNewPassword() {
  openPicker('Crea tu contraseña', `<div class="stack"><p>Estás usando una contraseña temporal. Elige una nueva para continuar.</p>
    <div><label>Contraseña temporal</label><input id="npCur" type="password" /></div>
    <div><label>Nueva contraseña (mínimo 10 caracteres)</label><input id="npNew" type="password" autocomplete="new-password" /></div>
    <div class="row"><button class="primary" id="npGo">Guardar</button><span id="npErr" class="error"></span></div></div>`, (root, close) => {
    $('#npGo', root).addEventListener('click', async () => {
      try {
        await api('/api/portal/password', { method: 'POST', body: { current: $('#npCur', root).value, next: $('#npNew', root).value } });
        S.me.user.mustChangePassword = false;
        close();
        toast('Contraseña guardada');
      } catch (e) { $('#npErr', root).textContent = e.message; }
    });
  });
}

async function newOwnGame() {
  const d = await api('/api/portal/games');
  const L = d.limits;
  if (L.usedGames >= L.maxGames) throw new Error(`Llegaste al máximo de juegos propios (${L.maxGames}). Pídele a tu proveedor que lo amplíe.`);
  const bases = d.catalog.filter((g) => !g.own);
  openPicker('Nuevo juego', `<div class="stack">
    <p class="muted">Tu juego parte de uno del catálogo: conserva su matemática y el RTP que te asignó tu proveedor. Tú cambias nombre, diseño, imágenes y sonidos. Te quedan ${L.maxGames - L.usedGames}.</p>
    <div><label>Nombre</label><input id="ngName" placeholder="Ej. Faraón Dorado" /></div>
    <div><label>Basado en</label><select id="ngBase">${bases.map((g) => `<option value="${esc(g.id)}" data-engine="${esc(g.engine)}">${esc(g.name)} — ${esc(g.engine)} · RTP ${pct(g.rtp)}</option>`).join('')}</select></div>
    ${uiPicker()}
    <button class="primary" id="ngCreate">Crear</button></div>`, (root, close) => {
    bindUiPicker(root);
    $('#ngCreate', root).addEventListener('click', guard(async () => {
      const g = await api('/api/portal/games', { method: 'POST', body: { name: $('#ngName', root).value, baseGameId: $('#ngBase', root).value } });
      await applyUiChoice(root, g.id, $('#ngBase', root).selectedOptions[0]?.dataset.engine);
      close();
      S.me = await api('/api/admin/me');
      setupOperatorShell();
      await loadGames();
      selectGame(g.id);
      toast('Juego creado como borrador. Personalízalo y publícalo cuando esté listo.');
    }));
  });
}

// ------------------------------------------------------------------ Marcas (estudios)
/** Carga en el panel una tipografía (archivo propio o Google Fonts) para verla en las vistas previas. */
function panelFont(name, url) {
  if (!name) return;
  if (url && typeof FontFace !== 'undefined') { new FontFace(name, `url("${url}")`).load().then((f) => document.fonts.add(f)).catch(() => {}); return; }
  const id = `gf-${name.replace(/\W+/g, '-')}`;
  if (!document.getElementById(id)) document.head.append(Object.assign(document.createElement('link'), { id, rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;700;900&display=swap` }));
}
const FONT_SUGGESTIONS = ['Cinzel', 'Cinzel Decorative', 'Bungee', 'Orbitron', 'Russo One', 'Oswald', 'Anton', 'Bebas Neue', 'Righteous', 'Luckiest Guy', 'Rye', 'Uncial Antiqua', 'Pirata One', 'Black Ops One', 'Teko', 'Rajdhani', 'Playfair Display', 'Abril Fatface', 'Alfa Slab One', 'Titan One', 'Lilita One', 'Press Start 2P'];
const fontDatalist = (id) => `<datalist id="${id}">${FONT_SUGGESTIONS.map((f) => `<option value="${f}">`).join('')}</datalist>`;

function loaderPreview(b) {
  if (b.font) panelFont(b.font, b.fontUrl);
  const isVid = /\.(mp4|webm)(\?|$)/i.test(b.logo || '');
  const logo = b.logo ? (isVid ? `<video src="${esc(b.logo)}" muted autoplay loop playsinline></video>` : `<img src="${esc(b.logo)}" alt="" />`) : `<b style="color:${esc(b.color || '#ffd460')}">${esc(b.name || 'Marca')}</b>`;
  const bar = b.loader === 'ring' ? `<div class="lp-ring" style="--c:${esc(b.color || '#ffd460')}"></div>` : `<div class="lp-bar" style="--c:${esc(b.color || '#ffd460')};${b.loader === 'pulse' ? 'height:3px' : ''}"><i></i></div>`;
  return `<div class="lp ${b.loader === 'pulse' ? 'pulse' : ''}" style="${b.font ? `font-family:'${esc(b.font)}',system-ui;` : ''}background:${esc(b.bg || '#05060c')} ${b.bgImage ? `url('${esc(b.bgImage)}') center/cover` : ''}">
    <div class="lp-logo">${logo}</div>${b.tagline ? `<div class="lp-tag">${esc(b.tagline)}</div>` : ''}<div class="lp-txt">Cargando…</div>${bar}</div>`;
}

VIEWS.brands = async function viewBrands(v, openId = null) {
  const list = await api('/api/admin/brands');
  S.brands = list;
  v.innerHTML = `<div class="stack"><h2 style="margin:0">Marcas</h2>
    <p class="muted">Cada juego pertenece a una marca (tu estudio o línea de juegos). Al abrir el juego aparece la <b>pantalla de carga con el logo de la marca</b>, y en el panel los juegos quedan agrupados por marca.
      El logo puede ser imagen, GIF o video.</p>
    <div class="brand-grid">${list.map((b) => `<div class="card stack" style="gap:8px">${loaderPreview(b)}
      <div class="row" style="justify-content:space-between"><b>${esc(b.name)}</b><span class="muted">${b.games} juego(s)</span></div>
      <div class="row"><button class="small primary" data-bedit="${esc(b.id)}">Editar</button>${b.games ? '' : `<button class="small danger" data-bdel="${esc(b.id)}">Borrar</button>`}</div></div>`).join('')}
      <div class="card stack" style="justify-content:center;align-items:center;min-height:200px"><button class="primary" id="bNew">＋ Nueva marca</button></div></div>
    <div id="bEditor"></div></div>`;
  const edit = (b) => {
    const cur = { name: '', logo: null, tagline: '', color: '#ffd460', bg: '#05060c', bgImage: null, loader: 'bar', minMs: 1500, ...(b || {}) };
    $('#bEditor', v).innerHTML = `<div class="card stack"><h3 style="margin:0">${b ? `Editar «${esc(b.name)}»` : 'Nueva marca'}</h3>
      <div class="brand-edit"><div class="stack">
        <div class="grid2">
          <div><label>Nombre</label><input id="bName" value="${esc(cur.name)}" placeholder="Ej. Dan Play Studios" /></div>
          <div><label>Frase bajo el logo (opcional)</label><input id="bTag" value="${esc(cur.tagline || '')}" placeholder="Ej. Juegos con alma" /></div>
          <div><label>Logotipo (imagen, GIF o video)</label><div class="row"><span id="bLogoTxt" class="muted">${cur.logo ? 'Cargado' : 'Sin logo (se muestra el nombre)'}</span><button class="small" id="bLogo">Elegir…</button><button class="small danger" id="bLogoClear" ${cur.logo ? '' : 'hidden'}>Quitar</button></div></div>
          <div><label>Imagen de fondo de la carga (opcional)</label><div class="row"><span id="bBgTxt" class="muted">${cur.bgImage ? 'Cargada' : 'Sin imagen'}</span><button class="small" id="bBg">Elegir…</button><button class="small danger" id="bBgClear" ${cur.bgImage ? '' : 'hidden'}>Quitar</button></div></div>
          <div><label>Color de fondo</label><input type="color" id="bBgColor" value="${esc(cur.bg || '#05060c')}" /></div>
          <div><label>Color de la marca (barra de carga)</label><input type="color" id="bColor" value="${esc(cur.color || '#ffd460')}" /></div>
          <div><label>Estilo de carga</label><select id="bLoader">${[['bar', 'Barra'], ['ring', 'Anillo'], ['pulse', 'Logo que late + línea']].map(([k, l]) => `<option value="${k}" ${cur.loader === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label>Tipografía del nombre y la frase <span id="bFontBadge" class="badge ok" ${cur.fontUrl ? '' : 'hidden'}>archivo propio</span></label><input id="bFont" list="bFontList" value="${esc(cur.font || '')}" placeholder="Ej. Cinzel Decorative" ${cur.fontUrl ? 'readonly' : ''} />
            <div class="row" style="margin-top:6px"><button class="small" id="bFontUp">Subir tipografía…</button><button class="small danger" id="bFontX" ${cur.font ? '' : 'hidden'}>Quitar</button></div>${fontDatalist('bFontList')}</div>
          <div><label>Tiempo mínimo del logo (<span id="bMinV">${(cur.minMs / 1000).toFixed(1)}</span> s)</label><input type="range" id="bMin" min="0" max="6000" step="250" value="${cur.minMs}" /></div>
        </div>
        <div class="row"><button class="primary" id="bSave">${b ? 'Guardar marca' : 'Crear marca'}</button><button class="ghost" id="bCancel">Cancelar</button></div>
      </div><div><label>Vista previa de la carga</label><div id="bPrev"></div></div></div></div>`;
    const read = () => ({ ...cur, font: $('#bFont').value.trim() || null, fontUrl: $('#bFont').value.trim() ? cur.fontUrl || null : null, name: $('#bName').value, tagline: $('#bTag').value, bg: $('#bBgColor').value, color: $('#bColor').value, loader: $('#bLoader').value, minMs: Number($('#bMin').value) });
    const redraw = () => { $('#bPrev').innerHTML = loaderPreview(read()); $('#bMinV').textContent = (Number($('#bMin').value) / 1000).toFixed(1); };
    $$('#bEditor input, #bEditor select').forEach((i) => i.addEventListener('input', redraw));
    $('#bLogo').addEventListener('click', guard(async () => { const u = await pickAsset('image', { animated: true }); if (u) { cur.logo = u; $('#bLogoTxt').textContent = 'Cargado'; $('#bLogoClear').hidden = false; redraw(); } }));
    $('#bLogoClear').addEventListener('click', () => { cur.logo = null; $('#bLogoTxt').textContent = 'Sin logo (se muestra el nombre)'; $('#bLogoClear').hidden = true; redraw(); });
    $('#bBg').addEventListener('click', guard(async () => { const u = await pickAsset('image'); if (u) { cur.bgImage = u; $('#bBgTxt').textContent = 'Cargada'; $('#bBgClear').hidden = false; redraw(); } }));
    $('#bBgClear').addEventListener('click', () => { cur.bgImage = null; $('#bBgTxt').textContent = 'Sin imagen'; $('#bBgClear').hidden = true; redraw(); });
    $('#bFontUp').addEventListener('click', guard(async () => {
      const a = await pickAsset('font');
      if (!a) return;
      const asset = typeof a === 'string' ? (await api('/api/admin/assets?gameId=&kind=font')).find((x) => x.url === a) : a;
      cur.font = fontFamilyOf(asset || { filename: 'Fuente propia' }); cur.fontUrl = asset?.url || a;
      Object.assign($('#bFont'), { value: cur.font, readOnly: true }); $('#bFontBadge').hidden = false; $('#bFontX').hidden = false; redraw();
    }));
    $('#bFontX').addEventListener('click', () => { cur.font = null; cur.fontUrl = null; Object.assign($('#bFont'), { value: '', readOnly: false }); $('#bFontBadge').hidden = true; $('#bFontX').hidden = true; redraw(); });
    $('#bFont').addEventListener('change', () => { panelFont($('#bFont').value.trim()); setTimeout(redraw, 500); });
    $('#bCancel').addEventListener('click', () => { $('#bEditor', v).innerHTML = ''; });
    $('#bSave').addEventListener('click', guard(async () => {
      const body = read();
      const r = b ? await api(`/api/admin/brands/${b.id}`, { method: 'PATCH', body }) : await api('/api/admin/brands', { method: 'POST', body });
      toast(b ? 'Marca guardada' : `Marca «${r.name}» creada. Asígnala a tus juegos desde el selector 🏷 de cada juego.`);
      await loadGames();
      VIEWS.brands(v);
    }));
    redraw();
    $('#bEditor', v).scrollIntoView({ behavior: 'smooth' });
  };
  $('#bNew', v).addEventListener('click', () => edit(null));
  $$('[data-bedit]', v).forEach((b) => b.addEventListener('click', () => edit(list.find((x) => x.id === b.dataset.bedit))));
  $$('[data-bdel]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    if (!confirm('¿Borrar esta marca?')) return;
    await api(`/api/admin/brands/${b.dataset.bdel}`, { method: 'DELETE' });
    VIEWS.brands(v);
  })));
  if (openId) edit(list.find((x) => x.id === openId));
};

VIEWS.operators = viewOperators;
VIEWS.operator = viewOperator;
VIEWS.rounds = (v) => viewRounds(v);
VIEWS.stats = (v) => viewStats(v);

// ------------------------------------------------------------------ Arranque
if (S.token) start().catch(() => logout());
else logout();
