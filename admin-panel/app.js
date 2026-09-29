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
  else if (S.games[0]) selectGame(S.games[0].id);
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
  S.games = await api('/api/admin/games');
  $('#gameList').innerHTML = S.games.map((g) => `<a data-game="${esc(g.id)}" class="${g.id === S.gameId ? 'on' : ''}">
    ${esc(g.name)}<small>${esc(g.engine)} · v${g.publishedVersion ?? '—'}${g.hasUnpublishedChanges ? ' · cambios sin publicar' : ''}${g.status !== 'active' ? ' · desactivado' : ''}</small></a>`).join('');
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
  S.game = await api(`/api/admin/games/${encodeURIComponent(S.gameId)}`);
  const g = S.game;
  $('#gameTitle').textContent = g.name;
  $('#gameMeta').innerHTML = `<span class="badge">${esc(g.engine)}</span>
    <span class="badge ${g.publishedVersion ? 'ok' : 'warn'}">${g.publishedVersion ? `publicado v${g.publishedVersion}` : 'sin publicar'}</span>
    ${g.hasUnpublishedChanges ? '<span class="badge warn">borrador con cambios</span>' : ''}
    ${g.math ? `<span class="badge">RTP ${pct(g.math.rtp)} · volatilidad ${esc(g.math.volatility)}</span>` : ''}`;
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
  const v = $('#view');
  const fn = { agents: tabAgents, design: tabDesign, symbols: tabSymbols, sounds: tabSounds, math: tabMath, assets: tabAssets, json: tabJson, versions: tabVersions }[S.tab];
  v.innerHTML = '';
  guard(async (el) => { await fn(el); if (S.tab === 'math' && !isOp()) { featureCard(el); currencyCard(el); } })(v);
}

// ------------------------------------------------------------------ Vista previa
$('#previewBtn').addEventListener('click', guard(async () => {
  $('#previewPane').hidden = false;
  await reloadPreview(true);
}));
$('#reloadPreview').addEventListener('click', () => reloadPreview(true));
$('#closePreview').addEventListener('click', () => { $('#previewPane').hidden = true; $('#previewFrame').src = 'about:blank'; });

async function reloadPreview(force = false) {
  if ($('#previewPane').hidden && !force) return;
  if (!S.previewToken || force) {
    const s = await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/preview-session`, { method: 'POST' });
    S.previewToken = s.token;
  }
  $('#previewFrame').src = `/play/${encodeURIComponent(S.gameId)}?token=${encodeURIComponent(S.previewToken)}&t=${Date.now()}`;
}

// ------------------------------------------------------------------ Publicar
$('#publishBtn').addEventListener('click', guard(async () => {
  const note = prompt('Nota de la versión (qué cambió):', '');
  if (note === null) return;
  const btn = $('#publishBtn');
  const r = await busy(btn, () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/publish`, { method: 'POST', body: { note } }));
  toast(`Publicada v${r.version} · RTP ${pct(r.math.rtp)}${r.mathChanged && !isOp() ? ' (matemática re-simulada)' : ''}${r.rtpVariantsRebuilding ? ` · recalculando ${r.rtpVariantsRebuilding} RTP de operadores` : ''}`);
  await refreshGame();
  await loadGames();
  if (S.tab === 'versions') renderTab();
}));

$('#newGameBtn').addEventListener('click', guard(async () => {
  if (isOp()) return newOwnGame();
  const engines = await (await fetch('/api/v1/engines')).json();
  openPicker('Nuevo juego', `<div class="stack">
    <div><label>Nombre</label><input id="ngName" placeholder="Ej. Faraón Dorado" /></div>
    <div><label>Motor</label><select id="ngEngine">${engines.map((e) => `<option value="${e.id}">${esc(e.name)} — ${esc(e.description)}</option>`).join('')}</select></div>
    <div><label>Copiar diseño de (opcional)</label><select id="ngFrom"><option value="">— Plantilla del motor —</option>${S.games.map((g) => `<option value="${esc(g.id)}" data-engine="${esc(g.engine)}">${esc(g.name)}</option>`).join('')}</select></div>
    ${uiPicker()}
    <button class="primary" id="ngCreate">Crear</button></div>`, (root, close) => {
    bindUiPicker(root);
    $('#ngCreate', root).addEventListener('click', guard(async () => {
      const engine = $('#ngEngine', root).value;
      const from = $('#ngFrom', root).selectedOptions[0];
      if (from.value && from.dataset.engine !== engine) throw new Error('El juego a copiar debe usar el mismo motor');
      const g = await api('/api/admin/games', { method: 'POST', body: { name: $('#ngName', root).value, engine, fromGameId: from.value || undefined } });
      await applyUiChoice(root, g.id, engine);
      close();
      await loadGames();
      selectGame(g.id);
      toast('Juego creado como borrador. Pide a los agentes que lo diseñen y luego publícalo.');
    }));
  });
}));

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
  ['bonusTotal', 'Total del bonus', 'TOTAL DEL BONUS'], ['respins', 'Re-giros ({n} = restantes)', 'RE-GIROS: {n}'], ['holdWin', 'Entrada Hold & Win', 'HOLD & WIN']];
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
    ${MSG_KINDS.map(row).join('')}
    <div class="card stack" style="background:var(--panel2)"><b>Textos</b><div class="grid2">
      ${MSG_TEXTS.map(([k, l, d]) => `<div><label>${l}</label><input data-mtext="${k}" value="${esc(M.texts?.[k] ?? '')}" placeholder="${esc(d || '(solo el importe)')}" /></div>`).join('')}
      <div><label>«Gran premio» desde (× la apuesta)</label><input id="mBig" type="number" min="2" max="1000" value="${M.thresholds?.big ?? 15}" style="width:110px" /></div>
      <div><label>«Mega premio» desde (× la apuesta)</label><input id="mMega" type="number" min="3" max="5000" value="${M.thresholds?.mega ?? 50}" style="width:110px" /></div>
    </div></div>
    <div class="row"><button class="primary" id="msgSave">Guardar carteles</button><button data-demo="mega">▶ Probar mega premio</button></div></div>`;
}

/** Abre la vista previa (si hace falta), espera al juego y le pide un cartel de ejemplo. */
async function demoInPreview(kind) {
  if ($('#previewPane').hidden) { $('#previewPane').hidden = false; await reloadPreview(true); }
  const frame = $('#previewFrame');
  for (let i = 0; i < 60; i++) {
    if (frame.contentWindow?.engine?.hud && !frame.contentWindow.engine.busy) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  frame.contentWindow?.postMessage({ type: 'demo', kind }, '*');
}

function bindMessagesCard(v) {
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
      { op: 'set', path: 'theme.messages.thresholds', value: { big: Number($('#mBig', v).value) || 15, mega: Number($('#mMega', v).value) || 50 } },
    ], 'Carteles guardados: prueba cada uno con ▶ Probar');
  }));
}

// ---- Ambiente del bonus (theme.bonus): presentación, fondos y cierre con imagen, GIF o video ----
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
  if (!k || k === 'pill' || engineInfo(engine).kind === 'table') return;
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
  let list = await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId)}&kind=${kind}`);
  if (animated) list = [...list, ...(await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId)}&kind=video`))];
  const accept = { image: `image/png,image/jpeg,image/webp,image/svg+xml,image/gif${animated ? ',video/mp4,video/webm' : ''}`, sound: 'audio/mpeg,audio/wav,audio/ogg', font: '.woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf' }[kind];
  const title = { image: animated ? 'Elegir imagen, GIF o video' : 'Elegir imagen', sound: 'Elegir sonido', font: 'Elegir tipografía' }[kind];
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
  return api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId)}&kind=${kind}&name=${encodeURIComponent(file.name)}`, {
    method: 'POST', raw: true, body: file, headers: { 'content-type': file.type || 'application/octet-stream' },
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
    const a = await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId)}&kind=image&reference=1&name=${encodeURIComponent('Referencia: ' + f.name)}`, {
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
  const isTableGame = engineInfo(S.game.engine).kind === 'table';
  v.innerHTML = `<div class="stack">
    ${isTableGame ? '' : `<div class="card stack"><h3 style="margin:0">Interfaz del juego</h3>
      <p class="muted">Elige cómo se ve y se ordena todo alrededor de los rodillos: saldo, fichas de apuesta, botón GIRAR, menú y efectos de premio. Funciona en PC y celular.</p>
      <div class="ui-grid">${UIS.map(([k, n, d, pal]) => `<button class="ui-tile ${curUi === k ? 'on' : ''}" data-ui="${k}">${uiMock(k, curUi === k ? (t.palette || pal) : pal)}<b>${n}</b><span class="muted">${d}</span></button>`).join('')}</div>
      <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="uiPal" style="width:auto" checked /> Aplicar también los colores sugeridos de la interfaz (luego puedes cambiarlos en Paleta)</label></div>`}
    ${!isTableGame && curUi === 'custom' ? customHudCard(t) : ''}
    ${isTableGame ? '' : messagesCard(t) + bonusCard(t)}
    <div class="card stack"><h3 style="margin:0">Identidad</h3>
      <div class="grid2">
        <div><label>Nombre del juego</label><input id="dName" value="${esc(S.game.draft.name)}" /></div>
        <div><label>Título visible</label><input id="dTitle" value="${esc(t.title)}" /></div>
        <div><label>Tipografía del juego ${t.fontUrl ? '<span class="badge ok">archivo propio</span>' : '(Google Fonts)'}</label><input id="dFont" value="${esc(t.font)}" placeholder="Bungee, Cinzel Decorative, Orbitron…" ${t.fontUrl ? 'readonly' : ''} />
          <div class="row" style="margin-top:6px"><button class="small" data-fontup="theme">Subir tipografía…</button>${t.fontUrl ? '<button class="small danger" data-fontclear="theme">Quitar archivo</button>' : ''}</div></div>
        <div><label>Color de fondo</label><input type="color" id="dBg" value="${esc(t.backgroundColor || '#000000')}" /></div>
      </div></div>
    <div class="card stack"><h3 style="margin:0">Paleta</h3><div class="grid2">
      ${color('primary', 'Principal (botón girar)')}${color('accent', 'Acento (marcos, premios)')}${color('panel', 'Panel inferior')}${color('text', 'Texto')}${color('reelBg', 'Fondo de rodillos')}
    </div></div>
    <div class="card stack"><h3 style="margin:0">Imágenes</h3><div class="grid2">
      ${imgField('background', 'Fondo PC (horizontal 16:9)')}${imgField('backgroundMobile', 'Fondo celular (vertical 9:16)')}
      ${imgField('logo', 'Logo')}${imgField('reelsBackground', 'Fondo detrás de los rodillos')}
      ${engineInfo(S.game.engine).kind === 'table' ? imgField('tableImage', 'Paño de la mesa') : `${imgField('cellImage', 'Fondo de cada celda')}${imgField('frame', 'Marco decorativo')}`}
    </div></div>
    ${engineInfo(S.game.engine).kind === 'table' ? diceCard(t.dice || {}) : ''}
    <div class="card stack" ${engineInfo(S.game.engine).kind === 'table' ? 'hidden' : ''}><h3 style="margin:0">Rodillos y símbolos</h3><div class="grid2">
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
    <div class="card stack"><h3 style="margin:0">Botonera</h3><div class="grid2">
      <input type="hidden" id="hLayout" value="${esc(t.hud?.layout || 'pill')}" />
      <div><label>Color de la botonera</label><input id="hBar" type="color" value="${esc((t.hud?.barColor || '').startsWith('#') ? t.hud.barColor : '#0a080c')}" /></div>
      <div><label>Borde de la botonera</label><input id="hBorder" type="color" value="${esc(t.hud?.barBorder || p.accent || '#ffd460')}" /></div>
      <div><label>Tamaño del botón GIRAR (<span id="hSpinV">${t.hud?.spinSize || 84}</span> px)</label><input id="hSpin" type="range" min="56" max="130" step="2" value="${t.hud?.spinSize || 84}" /></div>
      <div><label>Tipografía de la botonera ${t.hud?.fontUrl ? '<span class="badge ok">archivo propio</span>' : ''}</label><input id="hFont" value="${esc(t.hud?.font || '')}" placeholder="La del juego" ${t.hud?.fontUrl ? 'readonly' : ''} />
        <div class="row" style="margin-top:6px"><button class="small" data-fontup="hud">Subir tipografía…</button>${t.hud?.fontUrl ? '<button class="small danger" data-fontclear="hud">Quitar archivo</button>' : ''}</div></div>
      <div><label>Tamaño general de la interfaz (<span id="hScaleV">${Math.round((t.hud?.scale || 1) * 100)}</span> %)</label><input id="hScale" type="range" min="0.8" max="1.4" step="0.05" value="${t.hud?.scale || 1}" /></div>
      <label class="row" style="gap:8px;margin:0;color:var(--text)"><input type="checkbox" id="hMax" style="width:auto" ${(t.hud?.maxBet ?? true) ? 'checked' : ''} /> Mostrar botón de apuesta máxima (MÁX)</label>
    </div></div>
    <div class="card stack"><h3 style="margin:0">Botones del juego</h3>
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
          <td class="row"><button class="small" data-bimg>Imagen…</button>${img ? '<button class="small danger" data-bclear>Quitar imagen</button>' : ''}</td></tr>`;
  }).join('')}
      </tbody></table>
      <p class="muted">Con imagen, el botón muestra la imagen tal cual. Sin imagen, usa la forma, el estilo, los colores y el icono. Pídele al agente 🖌 Artista “crea botones dorados estilo egipcio para todo el juego”.</p>
    </div>
    <div class="row"><button class="primary" id="dSave">Guardar diseño</button><span class="muted">Consejo: en 🤖 Agentes puedes pedir “cambia el fondo por una selva de noche” y lo genera el Artista.</span></div>
  </div>`;
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
  bindDiceCard(v);
  bindCustomHudCard(v);
  bindMessagesCard(v);
  bindBonusCard(v);
  $$('[data-fontup]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const a = await pickAsset('font');
    if (!a) return;
    const asset = typeof a === 'string' ? (await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId)}&kind=font`)).find((x) => x.url === a) : a;
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
      { op: 'merge', path: 'theme.hud', value: { layout: $('#hLayout').value, barColor: `${$('#hBar').value}d9`, barBorder: $('#hBorder').value, spinSize: Number($('#hSpin').value), maxBet: $('#hMax').checked, scale: Number($('#hScale').value), ...(t.hud?.fontUrl ? {} : { font: $('#hFont').value.trim() || null }) } },
      { op: 'merge', path: 'theme.buttons', value: { shape: $('#bShape').value, style: $('#bStyle').value, size: Number($('#bSize').value), color: $('#bColor').value, textColor: $('#bText').value } },
      ...$$('tr[data-btn]', v).map((tr) => ({ op: 'set', path: `theme.buttons.${tr.dataset.btn}.icon`, value: $('[data-icon]', tr).value.trim() || null })),
    ]);
    loadGames();
  }));
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
  if (engineInfo(S.game.engine).kind === 'table') {
    v.innerHTML = '<div class="card"><p>Este juego es de mesa: no tiene símbolos ni rodillos. Los pagos se editan en <b>📈 Matemática</b> y el aspecto (paño, colores, fondos) en <b>🎨 Diseño</b>.</p></div>';
    return;
  }
  const syms = S.game.draft.symbols;
  const maxN = Math.max(...syms.flatMap((s) => Object.keys(s.pays || {}).map(Number)), 3);
  const counts = []; if (!isOp()) for (let n = 3; n <= maxN; n++) counts.push(n);
  const unit = { lines: 'múltiplo de la apuesta por línea', cluster: 'múltiplo de la apuesta total, según el tamaño del grupo (la columna es el mínimo del nivel)',
    count: 'múltiplo de la apuesta total, según cuántos iguales hay en pantalla (la columna es el mínimo del nivel)' }[engineInfo(S.game.engine).paysBy] || 'múltiplo de la apuesta total (por way)';
  v.innerHTML = `<div class="card"><table><thead><tr><th>Imagen</th><th>Id</th><th>Nombre</th><th>Tipo</th>${counts.map((n) => `<th>${n}×</th>`).join('')}</tr></thead>
    <tbody>${syms.map((s) => `<tr data-id="${esc(s.id)}"><td><img class="sym" src="${esc(s.image)}" title="Cambiar imagen" /></td><td><code>${esc(s.id)}</code></td>
      <td><input data-f="name" value="${esc(s.name)}" /></td><td>${esc(s.type || 'regular')}</td>
      ${counts.map((n) => `<td>${s.type === 'regular' || !s.type ? `<input type="number" step="any" min="0" data-pay="${n}" value="${s.pays?.[n] ?? ''}" style="width:90px" />` : ''}</td>`).join('')}</tr>`).join('')}
    </tbody></table>
    <p class="muted">${isOp() ? 'Puedes cambiar nombres e imágenes. Los pagos y el RTP los define tu proveedor.' : `Pagos en ${unit}. Cambiar pagos modifica el RTP: después usa 📈 Matemática → “Ajustar RTP” antes de publicar.`}</p>
    <div class="row"><button class="primary" id="sSave">Guardar símbolos</button></div></div>`;
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
const BUY_NAMES = { buy: 'giros gratis', 'buy-sticky': 'wilds fijos', 'buy-wheel': 'ruleta', 'buy-pick': 'elige premio' };

// ---- Matemática de juegos de mesa (Craps): pagos editables y RTP exacto por apuesta ----
const CRAPS_BETS = [['pass', 'Pass Line'], ['dontPass', "Don't Pass"], ['come', 'Come'], ['dontCome', "Don't Come"], ['odds', 'Odds'],
  ['place', 'Números (4-10)'], ['field', 'Field'], ['hard', 'Hardways'], ['anyCraps', 'Any Craps'], ['any7', 'Any 7']];

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

async function tabMath(v) {
  if (engineInfo(S.game.engine).kind === 'table') return tabMathTable(v);
  const d = S.game.draft;
  const m = S.game.math;
  v.innerHTML = `<div class="stack">
    <div class="card stack"><h3 style="margin:0">Versión publicada</h3>
      ${m ? `<div class="kpi"><div><small>RTP</small><b>${pct(m.rtp)}</b></div><div><small>IC 95 %</small><b style="font-size:14px">${pct(m.ci?.[0])} – ${pct(m.ci?.[1])}</b></div>
      <div><small>Frecuencia de premio</small><b>${pct(m.hitFrequency)}</b></div><div><small>Bonus cada</small><b>${m.featureEvery ? `1/${m.featureEvery}` : '—'}</b></div>
      <div><small>Volatilidad</small><b>${esc(m.volatility)}</b></div>${(m.buyOptions?.length ? m.buyOptions : m.buy ? [{ mode: 'buy', cost: m.buy.buyCost, rtp: m.buy.rtp }] : [])
      .map((b) => `<div><small>Compra ${esc(BUY_NAMES[b.mode] || b.mode)}</small><b>${b.cost}× · ${pct(b.rtp)}</b></div>`).join('')}</div>` : '<p class="muted">Sin publicar.</p>'}
    </div>
    <div class="card stack"><h3 style="margin:0">Tamaño de la cuadrícula${d.rules.lines != null ? ' y líneas' : ''}</h3>
      <div class="row">
        <div style="width:150px"><label>Rodillos (verticales)</label><input id="gReels" type="number" min="${engineInfo(d.engine).gridLimits.reels[0]}" max="${engineInfo(d.engine).gridLimits.reels[1]}" value="${d.grid.reels}" /></div>
        ${engineInfo(d.engine).variableRows ? '<div class="muted" style="max-width:260px">En los Megaways cada rodillo muestra de 2 a 7 filas al azar en cada giro.</div>'
    : `<div style="width:150px"><label>Filas (horizontales)</label><input id="gRows" type="number" min="${engineInfo(d.engine).gridLimits.rows[0]}" max="${engineInfo(d.engine).gridLimits.rows[1]}" value="${d.grid.rows}" /></div>`}
        ${d.rules.lines != null ? `<div style="width:170px"><label>Líneas de pago <span id="gMax" class="muted"></span></label><input id="gLines" type="number" min="1" max="100" value="${d.rules.lines}" /></div>` : ''}
        <button class="primary" id="gApply">Aplicar y ajustar RTP</button>
      </div>
      <p class="muted">Ahora: <b>${d.grid.reels} × ${d.grid.rows ?? `${d.grid.rowsMin}–${d.grid.rowsMax}`}</b>${d.rules.lines != null ? ` · <b>${d.rules.lines} líneas</b>` : ({ cluster: ' · paga por grupos que se tocan, sin líneas', count: ' · paga por cantidad de iguales en pantalla, sin líneas' }[engineInfo(d.engine).paysBy]
      || ` · paga por formas (${engineInfo(d.engine).variableRows ? 'hasta ' + (7 ** d.grid.reels).toLocaleString('es') : (d.grid.rows ** d.grid.reels).toLocaleString('es')} formas), sin líneas`)}.
      Al aplicar se reconstruyen los rodillos, se completa la tabla de pagos y se reajusta el RTP al objetivo (tarda entre 10 s y 1 min). Revisa la vista previa y publica.</p>
    </div>
    <div class="card stack"><h3 style="margin:0">Borrador</h3>
      <div class="row">
        <div style="width:160px"><label>RTP objetivo</label><input id="mTarget" type="number" step="0.001" min="0.85" max="1.10" value="${d.rtpTarget}" /><div class="muted">0.85 a 1.10 (85 %–110 %)</div></div>
        <div id="rtpWarn" class="error" style="max-width:330px" ${d.rtpTarget > 1 ? '' : 'hidden'}>⚠ Por encima de 100 % el juego paga más de lo que recauda: pierdes dinero con cada apuesta. Úsalo solo para promociones o demo.</div>
        <div style="width:170px"><label>Giros a simular</label><select id="mSpins"><option>200000</option><option selected>500000</option><option>1000000</option><option>3000000</option></select></div>
        ${engineInfo(d.engine).modes?.length > 1 ? `<div style="width:190px"><label>Modo</label><select id="mMode"><option value="base">Juego base</option>${engineInfo(d.engine).modes.filter((x) => x !== 'base' && (x === 'buy' || d.rules.bonusMenu?.[{ 'buy-sticky': 'sticky', 'buy-wheel': 'wheel', 'buy-pick': 'pick' }[x]]?.enabled)).map((x) => `<option value="${x}">Compra: ${BUY_NAMES[x]}</option>`).join('')}</select></div>` : ''}
        <button id="mSim">Simular</button><button class="primary" id="mTune">Ajustar RTP al objetivo</button>
      </div>
      <div id="mOut"></div>
    </div>
    <div class="card stack"><h3 style="margin:0">Reglas del motor (<code>rules</code>)</h3>
      <p class="muted">${d.rules.bonusMenu ? 'Aquí también se edita el menú de compra (<code>bonusMenu</code>): activar/desactivar cada bono, giros, segmentos de la ruleta y premios del "elige un premio". Los precios se recalculan al pulsar “Ajustar RTP”.' : ''}
      ${d.rules.specialCoins ? 'Monedas especiales: <code>specialChance</code> y <code>specialCoins</code> (multiplicador o +1 re-giro).' : ''}
      ${d.rules.wildMode ? 'Modo de comodines: <code>wildMode</code> = "sticky" (fijos en giros gratis) o "walking" (caminan y dan re-giros).' : ''}</p>
      <textarea id="mRules" rows="14">${esc(JSON.stringify(d.rules, null, 2))}</textarea>
      <div class="row"><button id="mRulesSave">Guardar reglas</button><button id="mBetSave" class="ghost">Editar niveles de apuesta…</button><button id="mAutoSave" class="ghost">Giros automáticos (${esc((d.bet.autoSpins || [10, 25, 50, 100]).join(' · '))})…</button></div>
    </div></div>`;
  const showSim = (s, title) => {
    $('#mOut').innerHTML = `<h4>${title}</h4><div class="kpi">
      <div><small>RTP</small><b>${pct(s.rtp)}</b></div><div><small>IC 95 %</small><b style="font-size:14px">${pct(s.rtpLow)} – ${pct(s.rtpHigh)}</b></div>
      <div><small>Frecuencia de premio</small><b>${pct(s.hitFrequency)}</b></div><div><small>Bonus cada</small><b>${s.featureEvery ? `1/${s.featureEvery}` : '—'}</b></div>
      <div><small>Volatilidad (σ)</small><b>${esc(s.volatility)} · ${s.volatilitySd}</b></div><div><small>Máx. observado</small><b>${s.maxWinObserved}×</b></div>
      <div><small>Giros</small><b>${s.spins.toLocaleString('es')}</b></div><div><small>Tiempo</small><b>${(s.ms / 1000).toFixed(1)} s</b></div></div>
      <p class="muted">Distribución: ${Object.entries(s.distribution).map(([k, x]) => `${k}: ${pct(x)}`).join(' · ')}</p>`;
  };
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
    const r = await busy(e.target, () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/tune`, { method: 'POST', body: { target: Number($('#mTarget').value) } }));
    showSim({ ...r.final }, `Ajustado: ${r.history.map((h) => pct(h.rtp)).join(' → ')}${(r.buyOptions || []).map((b) => ` · ${BUY_NAMES[b.mode] || b.mode} ${b.cost}× (${pct(b.rtp)})`).join('')}`);
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
  if (engineInfo(d.engine).kind === 'table') return;
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
  const table = engineInfo(d.engine).kind === 'table';
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
  const list = await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId)}`);
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
    <div class="row"><button class="danger" id="toggleStatus">${S.game.status === 'active' ? 'Desactivar juego' : 'Activar juego'}</button></div></div>`;
  $$('[data-restore]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    if (!confirm(`¿Reemplazar el borrador actual por la v${b.dataset.restore}?`)) return;
    await api(`/api/admin/games/${encodeURIComponent(S.gameId)}/restore/${b.dataset.restore}`, { method: 'POST' });
    await refreshGame();
    toast('Borrador restaurado');
    reloadPreview();
  })));
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

VIEWS.operators = viewOperators;
VIEWS.operator = viewOperator;
VIEWS.rounds = (v) => viewRounds(v);
VIEWS.stats = (v) => viewStats(v);

// ------------------------------------------------------------------ Arranque
if (S.token) start().catch(() => logout());
else logout();
