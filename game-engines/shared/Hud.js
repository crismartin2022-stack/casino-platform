// Interfaz del jugador en HTML/CSS sobre el lienzo (saldo, apuesta, girar, ayuda, compra de bonus).
// Los colores vienen del tema del juego vía variables CSS, así los agentes pueden re-tematizar sin tocar código.
import { formatMoney } from './api.js';

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

export class Hud {
  constructor(root, { game, currency, onSpin, onBuy, onInfo, onToggleSound, lobbyUrl, preview }) {
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
    css.setProperty('--font', `'${t.font || 'Bungee'}', system-ui, sans-serif`);

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
    this.spinBtn = this.makeButton('spin', 'spin', '↻', 'Girar', () => onSpin());
    this.autoBtn = this.makeButton('auto', 'chip', 'AUTO', 'Juego automático', () => this.toggleAuto(onSpin));
    this.turboBtn = this.makeButton('turbo', 'chip', '⚡', 'Turbo', () => this.toggleTurbo());
    this.soundBtn = this.makeButton('sound', 'chip', '🔊', 'Sonido', () => {
      const muted = onToggleSound();
      this.soundBtn.classList.toggle('muted', muted);
      if (!this.soundBtn.classList.contains('img')) this.soundBtn.firstChild.textContent = muted ? (spec('sound').iconOff || '🔇') : (spec('sound').icon || '🔊');
    });
    this.minus = this.makeButton('minus', 'chip', '−', 'Bajar apuesta', () => this.changeBet(-1));
    this.plus = this.makeButton('plus', 'chip', '+', 'Subir apuesta', () => this.changeBet(1));
    this.buyBtn = onBuy ? this.makeButton('buy', 'buy', 'COMPRAR BONUS', 'Comprar bonus', () => onBuy()) : null;
    this.infoBtn = this.makeButton('info', 'chip menu', '☰', 'Menú: reglas y pagos', () => onInfo());
    this.banner = h('div', { class: 'banner', hidden: true });
    this.status = h('div', { class: 'status' });
    this.modal = h('div', { class: 'modal', hidden: true, onclick: (e) => { if (e.target === this.modal) this.closeModal(); } });

    // Estilo de la botonera (theme.hud): pill = píldora centrada bajo los rodillos (por defecto), classic = barra inferior.
    const HUD = t.hud || {};
    root.dataset.layout = HUD.layout === 'classic' ? 'classic' : 'pill';
    if (HUD.barColor) css.setProperty('--bar', HUD.barColor);
    if (HUD.barBorder) css.setProperty('--bar-border', HUD.barBorder);
    if (HUD.spinSize) css.setProperty('--spin-size', `${Math.min(130, Math.max(56, Number(HUD.spinSize)))}px`);

    const stat = (label, el, cls) => h('div', { class: `stat ${cls}` }, h('small', {}, label), el);
    this.bar = h('div', { class: 'bar' },
      this.infoBtn,
      stat('SALDO', this.balanceEl, 'saldo'),
      h('div', { class: 'betbox' }, stat('APUESTA', this.betEl, 'apuesta'), h('div', { class: 'betbtns' }, this.minus, this.plus)),
      this.spinBtn,
      h('div', { class: 'autos' }, this.autoBtn, this.turboBtn),
      stat('PREMIO', this.winEl, 'premio'),
      this.soundBtn);

    root.append(
      h('div', { class: 'top' },
        lobbyUrl ? h('a', { class: 'chip', href: lobbyUrl, 'aria-label': 'Volver' }, '⟵') : null,
        preview ? h('span', { class: 'tag' }, 'VISTA PREVIA · BORRADOR') : null),
      this.banner, this.status,
      this.buyBtn ? h('div', { class: 'buybox' }, this.buyBtn) : null,
      this.bar,
      this.modal,
    );
    this.renderBet();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.modal.hidden && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); onSpin(); }
    });
  }

  /** Crea un botón usando la imagen, el icono o el texto definidos en theme.buttons[key]. */
  makeButton(key, cls, defaultIcon, label, onclick) {
    const s = this.btnSpec(key);
    const content = s.image
      ? h('img', { src: s.image, alt: '', draggable: 'false' })
      : h('span', {}, s.icon || s.label || defaultIcon);
    return h('button', { class: `${cls}${s.image ? ' img' : ''}`, 'aria-label': s.label || label, title: s.label || label, onclick }, content);
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
  setLayout(rect, orientation, scale) {
    const css = this.root.style;
    this.root.dataset.orient = orientation;
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

  changeBet(d) {
    if (this.locked) return;
    this.betIndex = Math.min(this.levels.length - 1, Math.max(0, this.betIndex + d));
    this.renderBet();
  }

  renderBet() {
    this.betEl.textContent = this.fmt(this.bet);
    if (this.buyBtn && this.game.rules?.buyCost) this.buyBtn.title = `Precio: ${this.fmt(this.bet * this.game.rules.buyCost)}`;
  }

  setBalance(cents) { this.balance = cents; this.balanceEl.textContent = this.fmt(cents); }

  setWin(cents) { this.shownWin = cents; this.winEl.textContent = this.fmt(cents); }

  lock(v) {
    this.locked = v;
    for (const b of [this.minus, this.plus, this.buyBtn].filter(Boolean)) b.disabled = v;
    this.spinBtn.classList.toggle('busy', v);
  }

  toggleTurbo() {
    this.turbo = !this.turbo;
    this.turboBtn.classList.toggle('on', this.turbo);
    this.onTurbo?.(this.turbo);
  }

  toggleAuto(onSpin) {
    if (this.autoLeft > 0) { this.stopAuto(); return; }
    this.autoLeft = 25;
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
    this.autoLeft--;
    this.setAutoLabel(this.autoLeft ? String(this.autoLeft) : null);
    if (!this.autoLeft) this.autoBtn.classList.remove('on');
    return true;
  }

  /** Mensaje grande en pantalla. kind: win | big | feature | info */
  async showBanner(html, { kind = 'win', ms = 1400 } = {}) {
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

  error(msg) {
    this.stopAuto();
    this.openModal(h('div', { class: 'confirm' }, h('h2', {}, 'Aviso'), h('p', {}, msg)));
  }
}

export { h };
