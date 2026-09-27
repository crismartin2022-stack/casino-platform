// Panel de administración: juegos, agentes de IA, diseño, sonido, matemática, versiones y operadores.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(2)} %`);
const money = (c) => (c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const S = {
  token: sessionStorage.getItem('adminToken') || '',
  me: null, games: [], gameId: null, game: null, tab: 'agents', platformView: null,
  runId: null, runStream: null, previewToken: null, agentsBusy: false,
};

// ------------------------------------------------------------------ API
async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${S.token}`, ...(body && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error('Sesión de administrador inválida'); }
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
  sessionStorage.removeItem('adminToken');
  S.token = '';
  $('#app').hidden = true;
  $('#login').hidden = false;
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  S.token = $('#tokenInput').value.trim();
  try {
    await start();
    sessionStorage.setItem('adminToken', S.token);
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

async function start() {
  S.me = await api('/api/admin/me');
  $('#login').hidden = true;
  $('#app').hidden = false;
  const p = S.me.providers;
  $('#providers').innerHTML = [['anthropic', 'Claude (agentes)'], ['venice', 'Venice (imágenes)'], ['elevenlabs', 'ElevenLabs (sonido)']]
    .map(([k, l]) => `<div><span class="dot ${p[k] ? 'ok' : ''}"></span>${l}</div>`).join('');
  await loadGames();
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (S.games.some((g) => g.id === fromHash)) selectGame(fromHash);
  else if (S.games[0]) selectGame(S.games[0].id);
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
  const v = $('#view');
  const fn = { agents: tabAgents, design: tabDesign, symbols: tabSymbols, sounds: tabSounds, math: tabMath, assets: tabAssets, json: tabJson, versions: tabVersions }[S.tab];
  v.innerHTML = '';
  guard(fn)(v);
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
  toast(`Publicada v${r.version} · RTP ${pct(r.math.rtp)}${r.mathChanged ? ' (matemática re-simulada)' : ''}`);
  await refreshGame();
  await loadGames();
  if (S.tab === 'versions') renderTab();
}));

$('#newGameBtn').addEventListener('click', guard(async () => {
  const engines = await (await fetch('/api/v1/engines')).json();
  openPicker('Nuevo juego', `<div class="stack">
    <div><label>Nombre</label><input id="ngName" placeholder="Ej. Faraón Dorado" /></div>
    <div><label>Motor</label><select id="ngEngine">${engines.map((e) => `<option value="${e.id}">${esc(e.name)} — ${esc(e.description)}</option>`).join('')}</select></div>
    <div><label>Copiar diseño de (opcional)</label><select id="ngFrom"><option value="">— Plantilla del motor —</option>${S.games.map((g) => `<option value="${esc(g.id)}" data-engine="${esc(g.engine)}">${esc(g.name)}</option>`).join('')}</select></div>
    <button class="primary" id="ngCreate">Crear</button></div>`, (root, close) => {
    $('#ngCreate', root).addEventListener('click', guard(async () => {
      const engine = $('#ngEngine', root).value;
      const from = $('#ngFrom', root).selectedOptions[0];
      if (from.value && from.dataset.engine !== engine) throw new Error('El juego a copiar debe usar el mismo motor');
      const g = await api('/api/admin/games', { method: 'POST', body: { name: $('#ngName', root).value, engine, fromGameId: from.value || undefined } });
      close();
      await loadGames();
      selectGame(g.id);
      toast('Juego creado como borrador. Pide a los agentes que lo diseñen y luego publícalo.');
    }));
  });
}));

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

async function pickAsset(kind) {
  const list = await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId)}&kind=${kind}`);
  return new Promise((resolve) => {
    openPicker(kind === 'image' ? 'Elegir imagen' : 'Elegir sonido', `
      <div class="row" style="margin-bottom:12px"><input type="file" id="pkUpload" accept="${kind === 'image' ? 'image/png,image/jpeg,image/webp,image/svg+xml' : 'audio/mpeg,audio/wav,audio/ogg'}" /></div>
      <div class="gallery">${list.map((a) => assetTile(a, true)).join('') || '<p class="muted">Aún no hay assets. Sube uno o pídeselo a los agentes.</p>'}</div>`, (root, close) => {
      $$('.tile', root).forEach((t) => t.addEventListener('click', (e) => { if (e.target.tagName === 'AUDIO') return; close(); resolve(t.dataset.url); }));
      $('#pkUpload', root).addEventListener('change', guard(async (e) => {
        const a = await uploadFile(e.target.files[0], kind);
        close();
        resolve(a.url);
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
  const media = a.kind === 'image' ? `<img src="${esc(a.url)}" loading="lazy" alt="" />` : `<audio controls preload="none" src="${esc(a.url)}"></audio>`;
  return `<div class="tile" data-url="${esc(a.url)}" data-id="${esc(a.id)}">${media}
    <div class="p" title="${esc(a.prompt)}">${esc(a.prompt || a.filename)}</div>
    <div class="muted">${esc(a.provider)} · ${esc(a.created_at?.slice(0, 16))}${selectable ? '' : ` · <code>${esc(a.id)}</code>`}</div></div>`;
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
      <div class="suggestions">${SUGGESTIONS.map((s) => `<button data-s="${esc(s)}">${esc(s.slice(0, 48))}…</button>`).join('')}</div>
      <div class="composer">
        <div><label>Hablar con</label><select id="agentSel">
          <option value="director">🎬 Director (coordina a todos)</option><option value="designer">🎨 Diseñador</option>
          <option value="artist">🖌 Artista (imágenes)</option><option value="sound">🎵 Sonido</option><option value="math">📈 Matemático</option></select></div>
        <div><label>Pedido</label><textarea id="prompt" rows="2" placeholder="Ej.: Quiero un tema pirata con cofres, calaveras doradas y mar de noche…"></textarea></div>
        <div class="row"><button class="primary" id="sendBtn">Enviar</button><button id="cancelBtn" class="danger" hidden>Detener</button></div>
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
  $('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPrompt(); });
  $('#cancelBtn').addEventListener('click', guard(async () => { await api(`/api/admin/agents/runs/${S.runId}/cancel`, { method: 'POST' }); }));
  if (S.runId) { $('#runSelect').value = S.runId; $('#log').innerHTML = ''; await openRun(S.runId); }
}

async function sendPrompt() {
  const prompt = $('#prompt').value.trim();
  if (!prompt) return;
  const agent = $('#agentSel').value;
  const { runId } = await api('/api/admin/agents/runs', { method: 'POST', body: { gameId: S.gameId, prompt, agent, runId: S.runId || undefined } });
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
    case 'user': add(`<div class="who">Tú → ${esc(AGENT_NAMES[d.agent] || d.agent)}</div>${esc(d.text)}`, 'msg user'); break;
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
async function tabDesign(v) {
  const t = S.game.draft.theme || {};
  const p = t.palette || {};
  const color = (k, label) => `<div><label>${label}</label><input type="color" data-pal="${k}" value="${esc(p[k] || '#000000')}" /></div>`;
  const imgField = (k, label) => `<div><label>${label}</label><div class="row">
    ${t[k] ? `<img src="${esc(t[k])}" style="height:54px;border-radius:6px;background:#0006" />` : '<span class="muted">Sin imagen</span>'}
    <button class="small" data-img="${k}">Elegir…</button>${t[k] ? `<button class="small danger" data-clear="${k}">Quitar</button>` : ''}</div></div>`;
  v.innerHTML = `<div class="stack">
    <div class="card stack"><h3 style="margin:0">Identidad</h3>
      <div class="grid2">
        <div><label>Nombre del juego</label><input id="dName" value="${esc(S.game.draft.name)}" /></div>
        <div><label>Título visible</label><input id="dTitle" value="${esc(t.title)}" /></div>
        <div><label>Tipografía (Google Fonts)</label><input id="dFont" value="${esc(t.font)}" placeholder="Bungee, Cinzel Decorative, Orbitron…" /></div>
        <div><label>Color de fondo</label><input type="color" id="dBg" value="${esc(t.backgroundColor || '#000000')}" /></div>
      </div></div>
    <div class="card stack"><h3 style="margin:0">Paleta</h3><div class="grid2">
      ${color('primary', 'Principal (botón girar)')}${color('accent', 'Acento (marcos, premios)')}${color('panel', 'Panel inferior')}${color('text', 'Texto')}${color('reelBg', 'Fondo de rodillos')}
    </div></div>
    <div class="card stack"><h3 style="margin:0">Imágenes</h3><div class="grid2">
      ${imgField('background', 'Fondo (16:9)')}${imgField('logo', 'Logo')}
    </div></div>
    <div class="row"><button class="primary" id="dSave">Guardar diseño</button><span class="muted">Consejo: en 🤖 Agentes puedes pedir “cambia el fondo por una selva de noche” y lo genera el Artista.</span></div>
  </div>`;
  $$('[data-img]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    const url = await pickAsset('image');
    if (url) { await patchDraft([{ op: 'set', path: `theme.${b.dataset.img}`, value: url }]); renderTab(); }
  })));
  $$('[data-clear]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    await patchDraft([{ op: 'set', path: `theme.${b.dataset.clear}`, value: null }]); renderTab();
  })));
  $('#dSave').addEventListener('click', guard(async () => {
    const palette = Object.fromEntries($$('[data-pal]', v).map((i) => [i.dataset.pal, i.value]));
    await patchDraft([
      { op: 'set', path: 'name', value: $('#dName').value },
      { op: 'set', path: 'theme.title', value: $('#dTitle').value },
      { op: 'set', path: 'theme.font', value: $('#dFont').value },
      { op: 'set', path: 'theme.backgroundColor', value: $('#dBg').value },
      { op: 'merge', path: 'theme.palette', value: palette },
    ]);
    loadGames();
  }));
}

// ------------------------------------------------------------------ Pestaña: Símbolos
async function tabSymbols(v) {
  const syms = S.game.draft.symbols;
  const maxN = Math.max(...syms.flatMap((s) => Object.keys(s.pays || {}).map(Number)), 3);
  const counts = []; for (let n = 3; n <= maxN; n++) counts.push(n);
  const unit = ['bonus-buy', 'hold-win'].includes(S.game.engine) ? 'múltiplo de la apuesta por línea' : 'múltiplo de la apuesta total (por way)';
  v.innerHTML = `<div class="card"><table><thead><tr><th>Imagen</th><th>Id</th><th>Nombre</th><th>Tipo</th>${counts.map((n) => `<th>${n}×</th>`).join('')}</tr></thead>
    <tbody>${syms.map((s) => `<tr data-id="${esc(s.id)}"><td><img class="sym" src="${esc(s.image)}" title="Cambiar imagen" /></td><td><code>${esc(s.id)}</code></td>
      <td><input data-f="name" value="${esc(s.name)}" /></td><td>${esc(s.type || 'regular')}</td>
      ${counts.map((n) => `<td>${s.type === 'regular' || !s.type ? `<input type="number" step="any" min="0" data-pay="${n}" value="${s.pays?.[n] ?? ''}" style="width:90px" />` : ''}</td>`).join('')}</tr>`).join('')}
    </tbody></table>
    <p class="muted">Pagos en ${unit}. Cambiar pagos modifica el RTP: después usa 📈 Matemática → “Ajustar RTP” antes de publicar.</p>
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
async function tabMath(v) {
  const d = S.game.draft;
  const m = S.game.math;
  v.innerHTML = `<div class="stack">
    <div class="card stack"><h3 style="margin:0">Versión publicada</h3>
      ${m ? `<div class="kpi"><div><small>RTP</small><b>${pct(m.rtp)}</b></div><div><small>IC 95 %</small><b style="font-size:14px">${pct(m.ci?.[0])} – ${pct(m.ci?.[1])}</b></div>
      <div><small>Frecuencia de premio</small><b>${pct(m.hitFrequency)}</b></div><div><small>Bonus cada</small><b>${m.featureEvery ? `1/${m.featureEvery}` : '—'}</b></div>
      <div><small>Volatilidad</small><b>${esc(m.volatility)}</b></div>${m.buy ? `<div><small>Compra</small><b>${m.buy.buyCost}× · ${pct(m.buy.rtp)}</b></div>` : ''}</div>` : '<p class="muted">Sin publicar.</p>'}
    </div>
    <div class="card stack"><h3 style="margin:0">Borrador</h3>
      <div class="row">
        <div style="width:160px"><label>RTP objetivo</label><input id="mTarget" type="number" step="0.001" min="0.85" max="0.985" value="${d.rtpTarget}" /></div>
        <div style="width:170px"><label>Giros a simular</label><select id="mSpins"><option>200000</option><option selected>500000</option><option>1000000</option><option>3000000</option></select></div>
        ${d.engine === 'bonus-buy' ? '<div style="width:150px"><label>Modo</label><select id="mMode"><option value="base">Juego base</option><option value="buy">Compra de bonus</option></select></div>' : ''}
        <button id="mSim">Simular</button><button class="primary" id="mTune">Ajustar RTP al objetivo</button>
      </div>
      <div id="mOut"></div>
    </div>
    <div class="card stack"><h3 style="margin:0">Reglas del motor (<code>rules</code>)</h3>
      <textarea id="mRules" rows="14">${esc(JSON.stringify(d.rules, null, 2))}</textarea>
      <div class="row"><button id="mRulesSave">Guardar reglas</button><button id="mBetSave" class="ghost">Editar niveles de apuesta…</button></div>
    </div></div>`;
  const showSim = (s, title) => {
    $('#mOut').innerHTML = `<h4>${title}</h4><div class="kpi">
      <div><small>RTP</small><b>${pct(s.rtp)}</b></div><div><small>IC 95 %</small><b style="font-size:14px">${pct(s.rtpLow)} – ${pct(s.rtpHigh)}</b></div>
      <div><small>Frecuencia de premio</small><b>${pct(s.hitFrequency)}</b></div><div><small>Bonus cada</small><b>${s.featureEvery ? `1/${s.featureEvery}` : '—'}</b></div>
      <div><small>Volatilidad (σ)</small><b>${esc(s.volatility)} · ${s.volatilitySd}</b></div><div><small>Máx. observado</small><b>${s.maxWinObserved}×</b></div>
      <div><small>Giros</small><b>${s.spins.toLocaleString('es')}</b></div><div><small>Tiempo</small><b>${(s.ms / 1000).toFixed(1)} s</b></div></div>
      <p class="muted">Distribución: ${Object.entries(s.distribution).map(([k, x]) => `${k}: ${pct(x)}`).join(' · ')}</p>`;
  };
  $('#mSim').addEventListener('click', guard(async (e) => {
    const s = await busy(e.target, () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/simulate`, { method: 'POST', body: { spins: Number($('#mSpins').value), mode: $('#mMode')?.value || 'base' } }));
    showSim(s, 'Simulación del borrador');
  }));
  $('#mTune').addEventListener('click', guard(async (e) => {
    const r = await busy(e.target, () => api(`/api/admin/games/${encodeURIComponent(S.gameId)}/tune`, { method: 'POST', body: { target: Number($('#mTarget').value) } }));
    showSim({ ...r.final }, `Ajustado: ${r.history.map((h) => pct(h.rtp)).join(' → ')}${r.buy ? ` · compra ${r.buy.buyCost}× (${pct(r.buy.rtp)})` : ''}`);
    await refreshGame();
    toast('Tabla de pagos ajustada en el borrador');
  }));
  $('#mRulesSave').addEventListener('click', guard(async () => {
    let rules;
    try { rules = JSON.parse($('#mRules').value); } catch { throw new Error('JSON de reglas inválido'); }
    await patchDraft([{ op: 'set', path: 'rules', value: rules }, { op: 'set', path: 'rtpTarget', value: Number($('#mTarget').value) }], 'Reglas guardadas');
  }));
  $('#mBetSave').addEventListener('click', guard(async () => {
    const cur = d.bet.levels.join(', ');
    const val = prompt('Niveles de apuesta en centavos separados por coma:', cur);
    if (val == null) return;
    const levels = val.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
    await patchDraft([{ op: 'set', path: 'bet.levels', value: levels }, { op: 'set', path: 'bet.default', value: levels.includes(d.bet.default) ? d.bet.default : levels[0] }], 'Apuestas guardadas');
  }));
}

// ------------------------------------------------------------------ Pestaña: Assets
async function tabAssets(v) {
  const list = await api(`/api/admin/assets?gameId=${encodeURIComponent(S.gameId)}`);
  v.innerHTML = `<div class="stack"><div class="row"><label style="margin:0">Subir:</label><input type="file" id="aUp" multiple style="max-width:340px" accept="image/*,audio/*" /></div>
    <div class="gallery">${list.map((a) => assetTile(a)).join('') || '<p class="muted">Sin assets todavía.</p>'}</div></div>`;
  $('#aUp').addEventListener('change', guard(async (e) => {
    for (const f of e.target.files) await uploadFile(f, f.type.startsWith('audio/') ? 'sound' : 'image');
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
$$('.side nav a[data-view]').forEach((a) => a.addEventListener('click', () => {
  S.platformView = a.dataset.view;
  S.gameId = null;
  location.hash = '';
  $$('.side nav a').forEach((x) => x.classList.toggle('on', x === a));
  $('#gameBar').hidden = true;
  $('#tabs').hidden = true;
  const v = $('#view');
  v.innerHTML = '';
  guard({ operators: viewOperators, rounds: viewRounds, stats: viewStats }[a.dataset.view])(v);
}));

async function viewOperators(v) {
  const ops = await api('/api/admin/operators');
  v.innerHTML = `<div class="stack"><h2 style="margin:0">Operadores</h2>
    <p class="muted">Cada operador (casino que integra tus juegos) recibe una API key para abrir sesiones de jugador. Documentación: <a href="/docs/API.md" target="_blank">docs/API.md</a></p>
    <div class="card"><table><thead><tr><th>Id</th><th>Nombre</th><th>Billetera</th><th>Moneda</th><th>Alta</th><th></th></tr></thead><tbody>
      ${ops.map((o) => `<tr><td><code>${esc(o.id)}</code></td><td>${esc(o.name)}</td><td>${esc(o.wallet_mode)}${o.wallet_url ? `<div class="muted">${esc(o.wallet_url)}</div>` : ''}</td><td>${esc(o.currency)}</td><td>${esc(o.created_at)}</td>
      <td><button class="small" data-rotate="${esc(o.id)}">Nueva API key</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin operadores.</td></tr>'}</tbody></table></div>
    <div class="card stack"><h3 style="margin:0">Nuevo operador</h3><div class="grid2">
      <div><label>Nombre</label><input id="oName" /></div>
      <div><label>Billetera</label><select id="oMode"><option value="internal">Interna (saldo en esta plataforma)</option><option value="seamless">Seamless (saldo en el operador)</option></select></div>
      <div><label>URL de billetera (seamless)</label><input id="oUrl" placeholder="https://operador.com/wallet" /></div>
      <div><label>Moneda</label><input id="oCur" value="USD" maxlength="3" /></div></div>
      <div class="row"><button class="primary" id="oCreate">Crear</button></div><div id="oSecret"></div></div></div>`;
  const showSecret = (r) => {
    $('#oSecret').innerHTML = `<p><b>Guarda esto ahora, no se volverá a mostrar:</b></p><div class="secret">API key: ${esc(r.apiKey)}${r.walletSecret ? `<br>Secreto de firma de billetera: ${esc(r.walletSecret)}` : ''}</div>`;
  };
  $('#oCreate').addEventListener('click', guard(async () => {
    const r = await api('/api/admin/operators', { method: 'POST', body: { name: $('#oName').value, walletMode: $('#oMode').value, walletUrl: $('#oUrl').value || null, currency: $('#oCur').value.toUpperCase() } });
    showSecret(r);
  }));
  $$('[data-rotate]', v).forEach((b) => b.addEventListener('click', guard(async () => {
    if (!confirm('La API key actual dejará de funcionar. ¿Continuar?')) return;
    showSecret(await api(`/api/admin/operators/${b.dataset.rotate}/rotate-key`, { method: 'POST' }));
  })));
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

// ------------------------------------------------------------------ Arranque
if (S.token) start().catch(() => logout());
else logout();
