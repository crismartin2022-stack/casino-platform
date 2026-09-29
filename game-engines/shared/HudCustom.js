// Interfaz "Diseño libre": cada botón, marcador y el tablero de la botonera se ubican donde quiera el diseñador,
// en coordenadas del juego (1280×720 en PC, 720×1280 en celular), así escalan junto con los rodillos en cualquier pantalla.
// theme.hud.custom = {
//   board: { image, color, border (true/false), radius, fit: 'fill'|'contain' },
//   landscape: { board: { x, y, w, h, hidden }, items: { spin: { x, y, s, hidden }, … } },
//   portrait:  { … } }
// x, y = centro; s = alto en px de diseño (el ancho sale de la proporción de la imagen: nunca se deforma).
import { h } from './Hud.js';

// Jerarquía por defecto (pedido de diseño): GIRAR 100 % · − + AUTO TURBO ≈58 % · MAX ovalado a la altura de los chicos · INFO/SONIDO ≈45 %
export function defaultCustomLayout(orientation, gridBottom = null) {
  if (orientation === 'portrait') {
    // El tablero arranca justo debajo de los rodillos (sin hueco), sin salirse de la pantalla
    const top = Math.min(1275 - 262, Math.max(700, (gridBottom ?? 980) + 26));
    const y = top + 142, S = 140, s = 80, xs = 58;
    return {
      board: { x: 360, y: top + 131, w: 712, h: 262 },
      items: {
        balance: { x: 150, y: top + 34, s: 46 }, bet: { x: 360, y: top + 34, s: 46 }, win: { x: 570, y: top + 34, s: 46 },
        info: { x: 48, y, s: xs }, minus: { x: 142, y, s }, plus: { x: 236, y, s },
        spin: { x: 360, y, s: S },
        auto: { x: 484, y, s }, turbo: { x: 578, y, s }, sound: { x: 672, y, s: xs },
        max: { x: 236, y: top + 230, s: 50 }, buy: { x: 484, y: top + 230, s: 50 },
        fullscreen: { x: 676, y: 44, s: 48 }, rotate: { x: 620, y: 44, s: 48 },
      },
    };
  }
  const y = 663, S = 118, s = 68, xs = 53;
  return {
    board: { x: 640, y: 663, w: 1210, h: 102 },
    items: {
      info: { x: 72, y, s: xs }, balance: { x: 190, y, s: 52 },
      minus: { x: 318, y, s }, plus: { x: 404, y, s }, max: { x: 508, y, s },
      spin: { x: 640, y: 652, s: S },
      auto: { x: 754, y, s }, turbo: { x: 840, y, s },
      bet: { x: 968, y, s: 52 }, win: { x: 1090, y, s: 52 }, sound: { x: 1208, y, s: xs },
      buy: { x: 150, y: 300, s: 84 }, fullscreen: { x: 1244, y: 34, s: 42 }, rotate: { x: 1192, y: 34, s: 42 },
    },
  };
}

const LABELS = { spin: 'GIRAR', minus: 'Bajar apuesta', plus: 'Subir apuesta', max: 'Apuesta máxima', auto: 'Automático', turbo: 'Turbo',
  info: 'Reglas', sound: 'Sonido', fullscreen: 'Pantalla completa', rotate: 'Girar pantalla', buy: 'Comprar bonus',
  balance: 'Saldo', bet: 'Apuesta', win: 'Premio', board: 'Tablero de la botonera' };

/** Arma la interfaz libre dentro del HUD. */
export function buildCustom(hud, { stat, lobbyUrl, preview }) {
  const t = hud.game.theme || {};
  const C = t.hud?.custom || {};
  hud.custom = C;
  const B = C.board || {};
  hud.board = h('div', { class: 'cboard' });
  if (B.image) {
    hud.board.style.backgroundImage = `url("${String(B.image).replace(/"/g, '%22')}")`;
    hud.board.classList.add('img');
    hud.board.dataset.fit = B.fit === 'contain' ? 'contain' : 'fill';
  }
  if (B.color) hud.board.style.setProperty('--cb-color', B.color);
  if (B.border === false) hud.board.classList.add('noborder');
  if (B.radius != null) hud.board.style.setProperty('--cb-radius', `${Number(B.radius)}px`);
  const nodes = {
    spin: hud.spinBtn, minus: hud.minus, plus: hud.plus, max: hud.maxBtn, auto: hud.autoBtn, turbo: hud.turboBtn,
    info: hud.infoBtn, sound: hud.soundBtn, fullscreen: hud.fullBtn, rotate: hud.rotateBtn, buy: hud.buyBtn,
    balance: stat('SALDO', hud.balanceEl, 'saldo'), bet: stat('APUESTA', hud.betEl, 'apuesta'), win: stat('PREMIO', hud.winEl, 'premio'),
  };
  hud.citems = {};
  for (const [key, node] of Object.entries(nodes)) {
    if (!node) continue;
    const wrap = h('div', { class: `citem ${['balance', 'bet', 'win'].includes(key) ? 'cstat' : ''}`, 'data-key': key }, node);
    hud.citems[key] = wrap;
  }
  const top = h('div', { class: 'top' },
    lobbyUrl ? h('a', { class: 'chip', href: lobbyUrl, 'aria-label': 'Volver' }, '⟵') : null,
    preview ? h('span', { class: 'tag' }, 'VISTA PREVIA') : null,
    hud.forceBtn);
  hud.fx = h('div', { class: 'fx' });
  hud.root.append(...[hud.board, ...Object.values(hud.citems), top, hud.banner, hud.status, hud.fx, hud.modal].filter(Boolean));
}

/** Layout efectivo de una orientación: el guardado sobre los valores por defecto. */
export function layoutFor(hud, orientation) {
  const def = defaultCustomLayout(orientation, hud.world?.gridBottom);
  const saved = hud.custom?.[orientation] || {};
  const items = { ...def.items };
  for (const [k, v] of Object.entries(saved.items || {})) items[k] = { ...(def.items[k] || {}), ...v };
  return { board: { ...def.board, ...(saved.board || {}) }, items };
}

/** Coloca todo según la transformación del mundo de juego (px de pantalla). */
export function positionCustom(hud, world, orientation) {
  if (!hud.citems) return;
  hud.world = world;
  hud.orient = orientation;
  const L = hud.editLayout && hud.editLayout.orientation === orientation ? hud.editLayout : layoutFor(hud, orientation);
  if (!hud.editLayout || hud.editLayout.orientation !== orientation) hud.editLayout = null;
  hud.current = { orientation, ...structuredClone(L) };
  const g = Math.min(1.6, Math.max(0.6, Number(hud.game.theme?.hud?.scale) || 1));
  const { ox, oy, k } = world;
  const b = L.board;
  Object.assign(hud.board.style, { left: `${ox + b.x * k}px`, top: `${oy + b.y * k}px`, width: `${b.w * k}px`, height: `${b.h * k}px`, display: b.hidden ? 'none' : '' });
  for (const [key, el] of Object.entries(hud.citems)) {
    const it = L.items[key];
    if (!it) { el.style.display = 'none'; continue; }
    const size = it.s * k * g;
    el.style.display = it.hidden && !hud.editing ? 'none' : '';
    el.classList.toggle('hiddenitem', !!it.hidden);
    el.style.left = `${ox + it.x * k}px`;
    el.style.top = `${oy + it.y * k}px`;
    el.style.setProperty('--sz', `${size}px`);
  }
}

// ------------------------------------------------------------------ Editor (solo vista previa con ?edit=1)
export function enableEditor(hud) {
  hud.editing = true;
  hud.root.classList.add('editing');
  const bar = h('div', { class: 'ceditbar' });
  const info = h('span', { class: 'cinfo' }, 'Arrastra cualquier botón o el tablero. Rueda del mouse o − / + para el tamaño.');
  let sel = null;
  const L = () => hud.current;
  const itemOf = (key) => (key === 'board' ? L().board : L().items[key]);
  const apply = () => { hud.editLayout = L(); positionCustom(hud, hud.world, hud.orient); markSel(); };
  const markSel = () => {
    for (const el of [hud.board, ...Object.values(hud.citems)]) el.classList.toggle('sel', el.dataset.key === sel);
    const it = sel && itemOf(sel);
    info.textContent = sel ? `${LABELS[sel] || sel}: x ${Math.round(it.x)} · y ${Math.round(it.y)} · ${sel === 'board' ? `${Math.round(it.w)}×${Math.round(it.h)}` : `tamaño ${Math.round(it.s)}`}${it.hidden ? ' · OCULTO' : ''}` : 'Toca un elemento para seleccionarlo.';
    hideBtn.textContent = it?.hidden ? '👁 Mostrar' : '🙈 Ocultar';
    hideBtn.disabled = !sel || sel === 'spin';
  };
  hud.board.dataset.key = 'board';
  const resize = (f) => {
    if (!sel) return;
    const it = itemOf(sel);
    if (sel === 'board') { it.w = Math.max(60, it.w * f); it.h = Math.max(30, it.h * f); } else it.s = Math.max(16, Math.min(420, it.s * f));
    apply();
  };
  const btn = (label, fn, title) => h('button', { onclick: (e) => { e.stopPropagation(); fn(); }, title: title || label }, label);
  const hideBtn = btn('🙈 Ocultar', () => { if (!sel || sel === 'spin') return; const it = itemOf(sel); it.hidden = !it.hidden; apply(); });
  bar.append(info,
    btn('−', () => resize(1 / 1.08), 'Achicar'), btn('+', () => resize(1.08), 'Agrandar'),
    btn('⇔ Centrar', () => { if (!sel) return; itemOf(sel).x = hud.world.w / 2; apply(); }, 'Centrar horizontalmente'),
    btn('↕ Ancho del tablero', () => { if (sel !== 'board') return; const it = itemOf('board'); it.w = Math.min(hud.world.w, it.w * 1.05); apply(); }, 'Ensanchar el tablero'),
    btn('↔ Alto del tablero', () => { if (sel !== 'board') return; const it = itemOf('board'); it.h *= 1.05; apply(); }, 'Hacer más alto el tablero'),
    hideBtn,
    btn('↺ Restablecer', () => { hud.editLayout = { orientation: hud.orient, ...defaultCustomLayout(hud.orient, hud.world?.gridBottom) }; hud.custom = { ...(hud.custom || {}), [hud.orient]: null }; positionCustom(hud, hud.world, hud.orient); markSel(); }),
    btn('💾 Guardar', () => {
      const cur = L();
      window.parent?.postMessage({ type: 'hud-layout', orientation: cur.orientation, layout: { board: cur.board, items: cur.items } }, '*');
      info.textContent = `Guardado (${cur.orientation === 'portrait' ? 'celular' : 'PC'}).`;
    }));
  hud.root.append(bar);
  // Arrastrar
  let drag = null;
  const onDown = (e) => {
    const el = e.target.closest?.('.citem, .cboard');
    if (!el || e.target.closest('.ceditbar')) return;
    e.preventDefault(); e.stopPropagation();
    sel = el.dataset.key;
    const it = itemOf(sel);
    const corner = sel === 'board' && e.target === hud.board && e.offsetX > hud.board.clientWidth - 18 && e.offsetY > hud.board.clientHeight - 18;
    drag = { x0: e.clientX, y0: e.clientY, ix: it.x, iy: it.y, iw: it.w, ih: it.h, corner };
    markSel();
  };
  const onMove = (e) => {
    if (!drag) return;
    const k = hud.world.k;
    const it = itemOf(sel);
    const dx = (e.clientX - drag.x0) / k, dy = (e.clientY - drag.y0) / k;
    if (drag.corner) { it.w = Math.max(60, drag.iw + dx * 2); it.h = Math.max(30, drag.ih + dy * 2); } else { it.x = Math.round(drag.ix + dx); it.y = Math.round(drag.iy + dy); }
    apply();
  };
  hud.root.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', () => { drag = null; });
  // En edición los botones no juegan
  hud.root.addEventListener('click', (e) => { if (e.target.closest('.citem, .cboard')) { e.preventDefault(); e.stopPropagation(); } }, true);
  hud.root.addEventListener('wheel', (e) => { if (!sel) return; e.preventDefault(); resize(e.deltaY < 0 ? 1.05 : 1 / 1.05); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (!sel) return;
    const it = itemOf(sel);
    const st = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
    if (moves[e.key]) { it.x += moves[e.key][0]; it.y += moves[e.key][1]; apply(); e.preventDefault(); }
    if (e.key === '+' || e.key === '=') resize(1.05);
    if (e.key === '-') resize(1 / 1.05);
  }, true);
  markSel();
}
