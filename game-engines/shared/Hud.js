// Interfaz del jugador en HTML/CSS sobre el lienzo (saldo, apuesta, girar, ayuda, compra de bonus).
// Los colores vienen del tema del juego vía variables CSS, así los agentes pueden re-tematizar sin tocar código.
import { formatMoney } from './api.js';
import { canFullscreen, isTouch, toggleFullscreen, rotate, onFullscreenChange, isFullscreen } from './screen.js';
import { buildCustom, positionCustom, enableEditor } from './HudCustom.js';

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};

// Interfaces completas (theme.hud.layout). Cada una es un estilo propio: barra superior con saldo,
// panel lateral (reglas, sonido, pantalla completa, historial), fichas de apuesta directas y un GIRAR con carácter.
export const SKINS = {
  neon: { name: 'Neón', spinIcon: '↻', palette: { primary: '#ff2d78', accent: '#00e5ff', panel: '#0b0716', text: '#ffffff' } },
  cristal: { name: 'Cristal', spinIcon: '↻', palette: { primary: '#7c5cff', accent: '#7ef9ff', panel: '#101a33', text: '#ffffff' } },
  brasa: { name: 'Brasa', spinIcon: '↻', palette: { primary: '#ff5a1f', accent: '#ffc247', panel: '#1a0805', text: '#fff4e6' } },
  real: { name: 'Real', spinIcon: '↻', palette: { primary: '#b8860b', accent: '#ffd873', panel: '#120d05', text: '#fff8e1' } },
  arcade: { name: 'Arcade', spinIcon: 'GIRAR', palette: { primary: '#ff3b3b', accent: '#39ff88', panel: '#0a0a12', text: '#ffffff' } },
};

/** Etiqueta corta para una ficha: 0,20 · 1 · 2,5 · 10 · 1K · 2,5K · 1M */
function chipLabel(cents) {
  const v = cents / 100;
  const n = (x) => x.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  if (v >= 1e6) return `${n(v / 1e6)}M`;
  if (v >= 1e4) return `${n(v / 1e3)}K`;
  return n(v);
}

export class Hud {
  constructor(root, { game, currency, onSpin, onBuy, onInfo, onToggleSound, onHistory, onForce, lobbyUrl, preview }) {
    this.root = root;
    this.game = game;
    this.currency = currency;
    this.levels = game.bet.levels;
    this.betIndex = Math.max(0, this.levels.indexOf(game.bet.default));
    this.autoLeft = 0;
    this.turbo = false;

    const t = game.theme || {};
    const p = t.palette || {};
    const css = root.style;
    css.setProperty('--primary', p.primary || '#e94560');
    css.setProperty('--accent', p.accent || '#ffd460');
    css.setProperty('--panel', p.panel || '#16213e');
    css.setProperty('--text', p.text || '#ffffff');
    // La botonera puede usar su propia tipografía (theme.hud.font); si no, la del juego.
    css.setProperty('--font', `'${t.hud?.font || t.font || 'Bungee'}', system-ui, sans-serif`);

    // Botones personalizables desde el tema (theme.buttons): forma, estilo, tamaño,
    // y por cada botón una imagen, un icono o un texto propio.
    const B = t.buttons || {};
    root.dataset.shape = ['round', 'rounded', 'square', 'pill'].includes(B.shape) ? B.shape : 'round';
    root.dataset.style = ['gradient', 'flat', 'glass', 'outline'].includes(B.style) ? B.style : 'gradient';
    css.setProperty('--btn-scale', String(Math.min(1.4, Math.max(0.8, Number(B.size) || 1))));
    if (B.color) css.setProperty('--btn', B.color);
    if (B.textColor) css.setProperty('--btn-text', B.textColor);
    const spec = (key) => ({ ...(B[key] || {}), ...(key === 'spin' && !B.spin?.image && t.spinButton ? { image: t.spinButton } : {}) });
    this.btnSpec = spec;

    this.balanceEl = h('b', {}, '—');
    this.betEl = h('b', {}, '');
    this.winEl = h('b', {}, formatMoney(0, currency));
    const HUD = t.hud || {};
    this.skin = SKINS[HUD.layout] ? HUD.layout : null;
    this.spinBtn = this.makeButton('spin', 'spin', this.skin ? SKINS[this.skin].spinIcon : '↻', 'Girar', () => onSpin());
    this.autoBtn = this.makeButton('auto', 'chip', 'AUTO', 'Juego automático', () => this.toggleAuto(onSpin));
    this.turboBtn = this.makeButton('turbo', 'chip', '⚡', 'Turbo', () => this.toggleTurbo());
    this.soundBtn = this.makeButton('sound', 'chip', '🔊', 'Sonido', () => {
      const muted = onToggleSound();
      this.soundBtn.classList.toggle('muted', muted);
      if (!this.soundBtn.classList.contains('img')) this.soundBtn.firstChild.textContent = muted ? (spec('sound').iconOff || '🔇') : (spec('sound').icon || '🔊');
    });
    this.minus = this.makeButton('minus', 'chip', '−', 'Bajar apuesta', () => this.changeBet(-1));
    this.plus = this.makeButton('plus', 'chip', '+', 'Subir apuesta', () => this.changeBet(1));
    // Vista previa: botón para forzar el bonus y probar sus sonidos y animaciones
    this.forceBtn = onForce ? h('button', { class: 'forcebtn', title: 'Solo en vista previa: el próximo giro trae el bonus', onclick: () => { if (!this.locked) onForce(); } }, '🎁 FORZAR BONUS') : null;
    // Pantalla completa y girar (girar solo en pantallas táctiles)
    this.fullBtn = canFullscreen() ? this.makeButton('fullscreen', 'chip', '⛶', 'Pantalla completa', () => toggleFullscreen()) : null;
    this.rotateBtn = isTouch() ? this.makeButton('rotate', 'chip', '⟳', 'Girar pantalla', () => this.rotateScreen()) : null;
    onFullscreenChange(() => this.fullBtn?.classList.toggle('on', isFullscreen()));
    // Apuesta máxima (se puede ocultar con theme.hud.maxBet = false)
    this.maxBtn = (t.hud?.maxBet ?? true) ? this.makeButton('max', 'chip maxbet', 'MÁX', 'Apuesta máxima', () => this.setMaxBet()) : null;
    this.buyBtn = onBuy ? this.makeButton('buy', 'buy', 'COMPRAR BONUS', 'Comprar bonus', () => onBuy()) : null;
    this.infoBtn = this.makeButton('info', 'chip menu', '☰', 'Menú: reglas y pagos', () => onInfo());
    this.banner = h('div', { class: 'banner', hidden: true });
    this.status = h('div', { class: 'status' });
    this.modal = h('div', { class: 'modal', hidden: true, onclick: (e) => { if (e.target === this.modal) this.closeModal(); } });

    // Estilo de la botonera (theme.hud): pill = píldora centrada bajo los rodillos (por defecto), classic = barra inferior,
    // o una de las interfaces completas (SKINS).
    this.isCustom = HUD.layout === 'custom';
    root.dataset.layout = this.isCustom ? 'custom' : this.skin || (HUD.layout === 'classic' ? 'classic' : 'pill');
    // Tamaño general de la interfaz (theme.hud.scale 0.8–1.4): agranda o achica botonera, botones y textos juntos.
    this.uiScale = Math.min(1.4, Math.max(0.8, Number(HUD.scale) || 1));
    css.zoom = this.uiScale === 1 || this.isCustom ? '' : String(this.uiScale);
    if (this.isCustom) this.uiScale = 1; // en Diseño libre la escala se aplica a cada elemento
    if (this.skin) root.dataset.skin = this.skin; else delete root.dataset.skin;
    if (HUD.barColor) css.setProperty('--bar', HUD.barColor);
    if (HUD.barBorder) css.setProperty('--bar-border', HUD.barBorder);
    if (HUD.spinSize) css.setProperty('--spin-size', `${Math.min(130, Math.max(56, Number(HUD.spinSize)))}px`);

    const stat = (label, el, cls) => h('div', { class: `stat ${cls}` }, h('small', {}, label), el);
    this.onInfo = onInfo;
    this.onHistory = onHistory;
    if (this.isCustom) {
      buildCustom(this, { stat, lobbyUrl, preview });
      this.wantEditor = preview && typeof location !== 'undefined' && new URLSearchParams(location.search).get('edit') === '1';
      this.renderBet();
      window.addEventListener('keydown', (e) => {
        if (!this.editing && e.code === 'Space' && this.modal.hidden && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); onSpin(); }
      });
      return;
    }
    if (this.skin) {
      this.buildSkin({ stat, lobbyUrl, preview, t });
      this.renderBet();
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && this.modal.hidden && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); onSpin(); }
      });
      return;
    }
    this.bar = h('div', { class: 'bar' },
      this.infoBtn,
      stat('SALDO', this.balanceEl, 'saldo'),
      h('div', { class: 'betbox' }, stat('APUESTA', this.betEl, 'apuesta'), h('div', { class: 'betbtns' }, this.minus, this.plus, this.maxBtn)),
      this.spinBtn,
      h('div', { class: 'autos' }, this.autoBtn, this.turboBtn),
      stat('PREMIO', this.winEl, 'premio'),
      this.soundBtn);

    root.append(...[
      h('div', { class: 'top' },
        lobbyUrl ? h('a', { class: 'chip', href: lobbyUrl, 'aria-label': 'Volver' }, '⟵') : null,
        preview ? h('span', { class: 'tag' }, 'VISTA PREVIA · BORRADOR') : null,
        this.forceBtn,
        (this.fullBtn || this.rotateBtn) ? h('div', { class: 'tr' }, this.rotateBtn, this.fullBtn) : null),
      this.banner, this.status,
      this.buyBtn ? h('div', { class: 'buybox' }, this.buyBtn) : null,
      this.bar,
      this.modal,
    ].filter(Boolean));
    this.renderBet();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.modal.hidden && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); onSpin(); }
    });
  }

  /** Interfaz completa: barra superior, panel lateral, dock inferior con fichas y efectos propios de cada estilo. */
  buildSkin({ stat, lobbyUrl, preview, t }) {
    const fsOk = canFullscreen();
    this.betChips = h('div', { class: 'betchips' });
    const side = (icon, label, fn) => h('button', { class: 'sk-sbtn', onclick: fn, title: label }, h('i', {}, icon), h('span', {}, label));
    this.sideSound = side('🔊', 'SONIDO', () => { this.soundBtn.click(); this.sideSound.classList.toggle('muted', this.soundBtn.classList.contains('muted')); });
    this.sidePanel = h('div', { class: 'sk-side' },
      side('ⓘ', 'REGLAS', () => this.onInfo()),
      this.sideSound,
      fsOk ? side('⛶', 'PANTALLA', () => this.toggleFullscreen()) : null,
      this.onHistory ? side('☷', 'HISTORIAL', () => this.showHistory()) : null);
    // El ☰ abre un menú con todo (en celular el panel lateral no entra)
    this.infoBtn.onclick = null;
    this.infoBtn.replaceWith(this.infoBtn = this.makeButton('info', 'chip menu', '☰', 'Menú', () => this.openMenu()));
    const top = h('div', { class: 'sk-top' },
      lobbyUrl ? h('a', { class: 'chip', href: lobbyUrl, 'aria-label': 'Volver' }, '⟵') : null,
      this.infoBtn,
      h('div', { class: 'sk-brand' }, t.title || this.game.name),
      preview ? h('span', { class: 'tag' }, 'VISTA PREVIA') : null,
      this.forceBtn,
      stat('SALDO', this.balanceEl, 'saldo'),
      h('div', { class: 'sk-topbtns' }, this.rotateBtn, this.soundBtn, this.fullBtn));
    this.dock = h('div', { class: 'sk-dock' },
      h('div', { class: 'sk-deco' }),
      h('div', { class: 'sk-bets' }, h('small', { class: 'sk-lbl' }, 'APUESTA'), h('div', { class: 'sk-betrow' }, this.minus, this.betChips, this.plus, this.maxBtn)),
      h('div', { class: 'sk-spinwrap' }, h('div', { class: 'sk-ring' }), this.spinBtn),
      h('div', { class: 'sk-right' }, stat('APUESTA', this.betEl, 'apuesta'), stat('PREMIO', this.winEl, 'premio'), h('div', { class: 'autos' }, this.autoBtn, this.turboBtn)));
    this.fx = h('div', { class: 'fx' });
    this.root.append(...[top, this.sidePanel, this.banner, this.status, this.buyBtn ? h('div', { class: 'buybox' }, this.buyBtn) : null, this.dock, this.fx, this.modal].filter(Boolean));
  }

  /** Espacio (px) que ocupa la interfaz: el motor acomoda los rodillos en el resto. null = botonera clásica. */
  reserve(orientation) {
    if (this.isCustom) return { top: 0, bottom: 0, side: 0, full: true }; // todo va dentro del área de juego
    if (!this.skin) return null;
    const W = window.innerWidth;
    const sideOn = orientation === 'landscape' && W >= 1000;
    this.root.toggleAttribute('data-noside', !sideOn);
    const z = this.uiScale || 1;
    const r = orientation === 'portrait'
      ? { top: 64, bottom: 228, side: 0 }
      : { top: 62, bottom: W < 760 ? 88 : 112, side: sideOn ? 150 : 0 };
    return { top: r.top * z, bottom: r.bottom * z, side: r.side * z };
  }

  toggleFullscreen() { return toggleFullscreen(); }

  /** Transformación del mundo de juego (para Diseño libre: todo se ubica en coordenadas del juego). */
  setWorld(world) {
    if (!this.isCustom) return;
    positionCustom(this, world, this.root.dataset.orient || 'landscape');
    if (this.wantEditor && !this.editing) enableEditor(this);
  }

  /** Gira a la otra orientación; si el teléfono no lo permite (iPhone), pide girarlo a mano. */
  async rotateScreen() {
    const ok = await rotate(this.root.dataset.orient);
    if (!ok) {
      const to = this.root.dataset.orient === 'portrait' ? 'horizontal' : 'vertical';
      await this.showBanner(`<small>GIRA TU TELÉFONO</small><b style="font-size:clamp(20px,5vw,34px)">Ponlo en ${to}: el juego se acomoda solo</b>`, { kind: 'info', ms: 2400 });
    }
  }

  openMenu() {
    const item = (icon, label, fn) => h('button', { class: 'sk-mitem', onclick: () => { this.modal.hidden = true; fn(); } }, h('i', {}, icon), h('span', {}, label));
    const fsOk = canFullscreen();
    this.openModal(h('div', { class: 'sk-menu' }, h('h2', {}, 'Menú'),
      h('div', { class: 'sk-mgrid' },
        item('ⓘ', 'Reglas y pagos', () => this.onInfo()),
        this.onHistory ? item('☷', 'Historial', () => this.showHistory()) : null,
        item(this.soundBtn.classList.contains('muted') ? '🔇' : '🔊', 'Sonido', () => this.soundBtn.click()),
        fsOk ? item('⛶', 'Pantalla completa', () => this.toggleFullscreen()) : null,
        isTouch() ? item('⟳', 'Girar pantalla', () => this.rotateScreen()) : null,
        item('⚡', this.turbo ? 'Turbo: sí' : 'Turbo: no', () => this.toggleTurbo()))));
  }

  async showHistory() {
    this.openModal(h('div', { class: 'info' }, h('h2', {}, 'Historial'), h('p', {}, 'Cargando…')));
    try {
      const rows = await this.onHistory();
      const fmtD = (s) => { try { return new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleString(); } catch { return s; } };
      this.openModal(h('div', { class: 'info' }, h('h2', {}, 'Historial'),
        rows.length ? h('table', { class: 'hist' }, h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, 'Jugada'), h('th', {}, 'Apuesta'), h('th', {}, 'Premio'))),
          h('tbody', {}, rows.map((r) => h('tr', { class: r.win > 0 ? 'won' : '' }, h('td', {}, fmtD(r.created_at)), h('td', {}, r.play_mode === 'base' ? 'Giro' : 'Bonus'),
            h('td', {}, this.fmt(r.cost)), h('td', {}, r.win > 0 ? this.fmt(r.win) : '—')))))
          : h('p', {}, 'Todavía no hay jugadas.'),
        h('p', { class: 'fine' }, 'Últimas 20 jugadas de esta sesión de juego. Cada jugada queda registrada y se puede verificar.')));
    } catch (e) {
      this.openModal(h('div', { class: 'info' }, h('h2', {}, 'Historial'), h('p', {}, e.message)));
    }
  }

  /** Lluvia de partículas con la forma de cada estilo (monedas, brasas, píxeles…). */
  celebrate(power = 1) {
    if (!this.fx || typeof document === 'undefined') return;
    const n = Math.round(14 + 40 * Math.min(1, power));
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 380 * Math.min(1.4, power + 0.3);
      p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(ang) * dist - 80}px`);
      p.style.setProperty('--d', `${Math.random() * 0.25}s`);
      p.style.setProperty('--s', String(0.6 + Math.random() * 0.9));
      p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
      frag.appendChild(p);
    }
    this.fx.replaceChildren(frag);
    clearTimeout(this.fxT);
    this.fxT = setTimeout(() => this.fx.replaceChildren(), 2200);
  }

  /** Crea un botón usando la imagen, el icono o el texto definidos en theme.buttons[key]. */
  makeButton(key, cls, defaultIcon, label, onclick) {
    const s = this.btnSpec(key);
    const content = s.image
      ? h('img', { src: s.image, alt: '', draggable: 'false' })
      : h('span', {}, s.icon || s.label || defaultIcon);
    const txt = !s.image && String(s.icon || s.label || defaultIcon).length > 2 ? ' txt' : '';
    return h('button', { class: `${cls}${s.image ? ' img' : ''}${txt}`, 'aria-label': s.label || label, title: s.label || label, onclick }, content);
  }

  /** Muestra el contador del juego automático sin borrar una imagen personalizada. */
  setAutoLabel(text) {
    const s = this.btnSpec('auto');
    if (this.autoBtn.classList.contains('img')) {
      let badge = this.autoBtn.querySelector?.('.count');
      if (!badge) { badge = h('em', { class: 'count' }); this.autoBtn.append(badge); }
      badge.textContent = text || '';
      badge.hidden = !text;
    } else {
      this.autoBtn.firstChild.textContent = text ?? (s.icon || s.label || 'AUTO');
    }
  }

  /**
   * Coloca la botonera según dónde quedó la cuadrícula en pantalla (px) y la orientación.
   * rect: { x, y, w, h } de la cuadrícula; scale: escala del mundo de juego.
   */
  setLayout(rect0, orientation, scale) {
    const css = this.root.style;
    this.root.dataset.orient = orientation;
    // Con zoom, las coordenadas en px de la pantalla se pasan a px de la interfaz.
    const z = this.uiScale || 1;
    const rect = { x: rect0.x / z, y: rect0.y / z, w: rect0.w / z, h: rect0.h / z };
    css.setProperty('--gx', `${rect.x + rect.w / 2}px`);
    css.setProperty('--gy', `${rect.y}px`);
    css.setProperty('--gw', `${rect.w}px`);
    css.setProperty('--gb', `${rect.y + rect.h}px`);
    css.setProperty('--ui', String(Math.min(1.25, Math.max(0.7, scale))));
  }

  /** Cuenta hacia arriba el premio en la botonera. */
  countWin(toCents, ms = 500) {
    const from = this.shownWin || 0;
    this.shownWin = toCents;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / (this.turbo ? ms / 2 : ms));
      this.winEl.textContent = this.fmt(Math.round(from + (toCents - from) * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step); else this.winEl.textContent = this.fmt(toCents);
    this.winEl.parentElement?.classList?.add('flash');
    setTimeout(() => this.winEl.parentElement?.classList?.remove('flash'), 700);
  }

  get bet() { return this.levels[this.betIndex]; }
  fmt(cents) { return formatMoney(cents, this.currency); }

  setMaxBet() {
    if (this.locked) return;
    this.betIndex = this.levels.length - 1;
    this.renderBet();
    this.maxBtn?.classList.add('on');
    setTimeout(() => this.maxBtn?.classList.remove('on'), 350);
  }

  changeBet(d) {
    if (this.locked) return;
    this.betIndex = Math.min(this.levels.length - 1, Math.max(0, this.betIndex + d));
    this.renderBet();
  }

  renderBet() {
    this.betEl.textContent = this.fmt(this.bet);
    if (this.betChips) {
      // Ventana de fichas alrededor de la apuesta actual (todas si entran)
      const max = window.innerWidth < 420 ? 4 : window.innerWidth < 760 ? 5 : 7;
      const L = this.levels;
      let from = Math.max(0, Math.min(L.length - max, this.betIndex - Math.floor(max / 2)));
      if (L.length <= max) from = 0;
      this.betChips.replaceChildren(...L.slice(from, from + max).map((v, i) => h('button', {
        class: `bchip${from + i === this.betIndex ? ' sel' : ''}`, 'data-i': String((from + i) % 6), title: this.fmt(v),
        onclick: () => { if (this.locked) return; this.betIndex = from + i; this.renderBet(); },
      }, chipLabel(v))));
      this.betChips.querySelectorAll?.('button').forEach((b) => { b.disabled = !!this.locked; });
    }
    if (this.buyBtn && this.game.rules?.buyCost) this.buyBtn.title = `Precio: ${this.fmt(this.bet * this.game.rules.buyCost)}`;
  }

  setBalance(cents) { this.balance = cents; this.balanceEl.textContent = this.fmt(cents); }

  setWin(cents) { this.shownWin = cents; this.winEl.textContent = this.fmt(cents); }

  lock(v) {
    this.locked = v;
    for (const b of [this.minus, this.plus, this.maxBtn, this.buyBtn, this.forceBtn].filter(Boolean)) b.disabled = v;
    this.betChips?.querySelectorAll?.('button').forEach((b) => { b.disabled = v; });
    this.spinBtn.classList.toggle('busy', v);
  }

  toggleTurbo() {
    this.turbo = !this.turbo;
    this.turboBtn.classList.toggle('on', this.turbo);
    this.onTurbo?.(this.turbo);
  }

  /** Giros automáticos: el jugador elige cuántos (opciones de bet.autoSpins) y, si quiere, un límite de pérdida. */
  async toggleAuto(onSpin) {
    if (this.autoLeft > 0) { this.stopAuto(); return; }
    const opts = (Array.isArray(this.game.bet?.autoSpins) && this.game.bet.autoSpins.length ? this.game.bet.autoSpins : [10, 25, 50, 100])
      .filter((n) => Number.isInteger(n) && n > 0).slice(0, 8);
    const pick = await new Promise((resolve) => {
      this.modalResolve = () => resolve(null);
      let loss = 0;
      const lossSel = h('select', { class: 'auto-loss', onchange: (e) => { loss = Number(e.target.value); } },
        h('option', { value: '0' }, 'Sin límite'),
        ...[10, 25, 50, 100].map((k) => h('option', { value: String(k) }, `${k}× la apuesta (${this.fmt(this.bet * k)})`)));
      this.openModal(h('div', { class: 'confirm auto-pick' }, h('h2', {}, 'Juego automático'),
        h('p', {}, '¿Cuántos giros?'),
        h('div', { class: 'auto-grid' }, opts.map((n) => h('button', { class: 'buy auto-n', onclick: () => { this.modalResolve = null; this.modal.hidden = true; resolve({ n, loss }); } }, String(n)))),
        h('label', { class: 'auto-lbl' }, 'Detener si pierdo más de', lossSel),
        h('p', { class: 'fine' }, 'Se detiene solo al entrar en un bonus. Puedes pararlo cuando quieras tocando AUTO.')));
    });
    if (!pick) return;
    this.autoLeft = pick.n;
    this.autoLoss = pick.loss ? pick.loss * this.bet : 0;
    this.autoStartBalance = this.balance;
    this.autoBtn.classList.add('on');
    this.setAutoLabel(String(this.autoLeft));
    if (!this.locked) onSpin();
  }

  stopAuto() {
    this.autoLeft = 0;
    this.autoBtn.classList.remove('on');
    this.setAutoLabel(null);
  }

  consumeAuto() {
    if (this.autoLeft <= 0) return false;
    if (this.autoLoss && this.autoStartBalance - this.balance >= this.autoLoss) {
      this.stopAuto();
      this.setStatus('Juego automático detenido: llegaste a tu límite de pérdida');
      setTimeout(() => this.setStatus(''), 3500);
      return false;
    }
    this.autoLeft--;
    this.setAutoLabel(this.autoLeft ? String(this.autoLeft) : null);
    if (!this.autoLeft) this.autoBtn.classList.remove('on');
    return true;
  }

  /** Mensaje grande en pantalla. kind: win | big | feature | info */
  async showBanner(html, { kind = 'win', ms = 1400 } = {}) {
    if (this.skin && kind !== 'info') this.celebrate(kind === 'big' ? 1.2 : kind === 'feature' ? 0.8 : 0.25);
    this.banner.className = `banner ${kind}`;
    this.banner.innerHTML = html;
    this.banner.hidden = false;
    await new Promise((r) => setTimeout(r, this.turbo ? ms * 0.5 : ms));
    this.banner.hidden = true;
  }

  setStatus(text) { this.status.textContent = text || ''; this.status.hidden = !text; }

  openModal(content) {
    this.modal.replaceChildren(h('div', { class: 'sheet' }, h('button', { class: 'close chip', onclick: () => this.closeModal() }, '✕'), content));
    this.modal.hidden = false;
  }

  closeModal() { this.modal.hidden = true; this.modalResolve?.(false); this.modalResolve = null; }

  confirm(title, text, okLabel = 'Confirmar') {
    return new Promise((resolve) => {
      this.modalResolve = resolve;
      this.openModal(h('div', { class: 'confirm' }, h('h2', {}, title), h('p', {}, text),
        h('button', { class: 'buy', onclick: () => { this.modalResolve = null; this.modal.hidden = true; resolve(true); } }, okLabel)));
    });
  }

  /** Menú de opciones (p. ej. bonos a comprar). Devuelve el value elegido o null. */
  choose(title, options) {
    return new Promise((resolve) => {
      this.modalResolve = () => resolve(null);
      this.openModal(h('div', { class: 'confirm choose' }, h('h2', {}, title),
        ...options.map((o) => h('button', { class: 'buy option', onclick: () => { this.modalResolve = null; this.modal.hidden = true; resolve(o.value); } },
          h('span', {}, o.label), h('b', {}, o.sub || '')))));
    });
  }

  error(msg) {
    this.stopAuto();
    this.openModal(h('div', { class: 'confirm' }, h('h2', {}, 'Aviso'), h('p', {}, msg)));
  }
}

export { h };
