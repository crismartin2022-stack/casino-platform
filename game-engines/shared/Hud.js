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

    this.balanceEl = h('b', {}, '—');
    this.betEl = h('b', {}, '');
    this.winEl = h('b', {}, formatMoney(0, currency));
    this.spinBtn = h('button', { class: 'spin', 'aria-label': 'Girar', onclick: () => onSpin() }, h('span', {}, '↻'));
    this.autoBtn = h('button', { class: 'chip', onclick: () => this.toggleAuto(onSpin), title: 'Juego automático' }, 'AUTO');
    this.turboBtn = h('button', { class: 'chip', onclick: () => this.toggleTurbo(), title: 'Turbo' }, '⚡');
    this.soundBtn = h('button', { class: 'chip', onclick: () => { this.soundBtn.textContent = onToggleSound() ? '🔇' : '🔊'; } }, '🔊');
    this.minus = h('button', { class: 'chip', onclick: () => this.changeBet(-1), 'aria-label': 'Bajar apuesta' }, '−');
    this.plus = h('button', { class: 'chip', onclick: () => this.changeBet(1), 'aria-label': 'Subir apuesta' }, '+');
    this.buyBtn = onBuy ? h('button', { class: 'buy', onclick: () => onBuy() }, 'COMPRAR BONUS') : null;
    this.banner = h('div', { class: 'banner', hidden: true });
    this.status = h('div', { class: 'status' });
    this.modal = h('div', { class: 'modal', hidden: true, onclick: (e) => { if (e.target === this.modal) this.closeModal(); } });

    root.append(
      h('div', { class: 'top' },
        lobbyUrl ? h('a', { class: 'chip', href: lobbyUrl }, '⟵') : null,
        h('div', { class: 'title' }, t.title || game.name),
        preview ? h('span', { class: 'tag' }, 'VISTA PREVIA · BORRADOR') : null,
        h('button', { class: 'chip', onclick: () => onInfo(), 'aria-label': 'Reglas y pagos' }, 'i')),
      this.banner, this.status,
      h('div', { class: 'bottom' },
        h('div', { class: 'stat' }, h('small', {}, 'SALDO'), this.balanceEl),
        h('div', { class: 'stat' }, h('small', {}, 'PREMIO'), this.winEl),
        h('div', { class: 'betbox' }, this.minus, h('div', { class: 'stat' }, h('small', {}, 'APUESTA'), this.betEl), this.plus),
        this.buyBtn, this.autoBtn, this.turboBtn, this.soundBtn, this.spinBtn),
      this.modal,
    );
    this.renderBet();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.modal.hidden && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); onSpin(); }
    });
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

  setWin(cents) { this.winEl.textContent = this.fmt(cents); }

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
    this.autoBtn.textContent = String(this.autoLeft);
    if (!this.locked) onSpin();
  }

  stopAuto() {
    this.autoLeft = 0;
    this.autoBtn.classList.remove('on');
    this.autoBtn.textContent = 'AUTO';
  }

  consumeAuto() {
    if (this.autoLeft <= 0) return false;
    this.autoLeft--;
    this.autoBtn.textContent = this.autoLeft ? String(this.autoLeft) : 'AUTO';
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
