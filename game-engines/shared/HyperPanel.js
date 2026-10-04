// HYPER: juego automático súper rápido sin rodillos. Cada tirada es un giro normal del servidor (mismo RTP,
// misma auditoría); solo se salta la animación y se muestra una lista con la ganancia y el crédito de cada una.
// El jugador elige apuesta, cantidad de tiradas, si se detiene al entrar en una función y un límite de pérdida.
import { h } from './Hud.js';
import { loadAnyFont } from './media.js';

/** Diseño editable (theme.hyper): título, colores, imagen de fondo, desenfoque y tipografía. */
export function hyperStyle(T = {}) {
  const v = {};
  const color = (x) => (typeof x === 'string' && /^#[0-9a-f]{3,8}$/i.test(x) ? x : null);
  if (color(T.bg)) v['--hyp-bg'] = T.bg;
  if (color(T.side)) v['--hyp-side'] = T.side;
  if (color(T.accent)) v['--hyp-accent'] = T.accent;
  if (color(T.text)) v['--hyp-text'] = T.text;
  if (color(T.win)) v['--hyp-win'] = T.win;
  if (color(T.feature)) v['--hyp-feat'] = T.feature;
  if (color(T.rowLine)) v['--hyp-line'] = T.rowLine;
  if (T.image) v['--hyp-img'] = `url("${String(T.image).replace(/"/g, '%22')}")`;
  if (T.blur != null) v['--hyp-blur'] = `${Math.max(0, Math.min(30, Number(T.blur) || 0))}px`;
  if (T.opacity != null) v['--hyp-op'] = `${Math.round(Math.max(0, Math.min(1, Number(T.opacity))) * 100)}%`;
  if (T.rowSize != null) v['--hyp-fs'] = String(Math.max(0.7, Math.min(2, Number(T.rowSize) || 1)));
  if (T.lastSize != null) v['--hyp-last-fs'] = String(Math.max(0.7, Math.min(2.5, Number(T.lastSize) || 1)));
  if (color(T.last)) v['--hyp-last'] = T.last;
  if (T.numFont) v['--hyp-num-font'] = `'${String(T.numFont).replace(/'/g, '')}', system-ui, sans-serif`;
  if (T.font) v['--hyp-font'] = `'${String(T.font).replace(/'/g, '')}', system-ui, sans-serif`;
  return v;
}


/** Textos del panel (theme.hyper.texts los reemplaza; vacío = el de fábrica). */
export const HYPER_TEXTS = {
  bet: 'APUESTA', spins: 'TIRADAS', stop: 'Detenerse en la función', loss: 'Detener si pierdo más de', noLimit: 'Sin límite',
  totalBet: 'APUESTA TOTAL', totalWin: 'PREMIO TOTAL', last: 'ÚLTIMA TIRADA', spin: 'TIRADA', win: 'GANANCIA', x: '×', credit: 'CRÉDITO',
  initial: 'Crédito inicial', bonus: 'BONUS', see: '▶ VER LA FUNCIÓN',
  ready: 'LISTO', playing: 'JUGANDO', paused: 'EN PAUSA', feature: 'FUNCIÓN', done: 'TERMINADO', noFunds: 'SALDO INSUFICIENTE', lossLimit: 'LÍMITE DE PÉRDIDA',
  intro1: 'Juego automático súper rápido, sin rodillos. Cada tirada es un giro normal del juego: mismo RTP y mismas reglas.',
  intro2: 'Elige la apuesta y cuántas tiradas, y pulsa ▶. Puedes pausar o cambiarlo cuando quieras.',
};

const FEATURE = (r) => !!(r?.freeSpins || r?.holdAndWin || r?.bonus || r?.bonuses?.length || r?.respins?.length);

export class HyperPanel {
  constructor(engine) {
    this.e = engine;
    this.hud = engine.hud;
    const max = Number(engine.game.bet?.hyperMaxSpins) || 1000;
    this.max = Math.max(10, Math.min(5000, max));
    this.count = Math.min(100, this.max);
    this.stopOnFeature = false;
    this.loss = 0;
    this.running = false;
    this.done = 0;
    this.totalBet = 0;
    this.totalWin = 0;
    this.rows = 0;
    const tx = engine.game.theme?.hyper?.texts || {};
    this.L = (k) => (tx[k] != null && String(tx[k]).trim() !== '' ? String(tx[k]) : HYPER_TEXTS[k]);
  }

  open() {
    const e = this.e;
    const hud = this.hud;
    const title = e.game.theme?.title || e.game.name;
    const T = e.game.theme?.hyper || {};
    this.betEl = h('b', {}, hud.fmt(hud.bet));
    const betStep = (d) => {
      if (this.running) return;
      hud.betIndex = Math.min(hud.levels.length - 1, Math.max(0, hud.betIndex + d));
      hud.renderBet();
      this.betEl.textContent = hud.fmt(hud.bet);
    };
    this.countEl = h('b', {}, String(this.count));
    this.range = h('input', { type: 'range', min: '10', max: String(this.max), step: '10', value: String(this.count), 'aria-label': 'Tiradas',
      oninput: (ev) => { this.count = Number(ev.target.value); this.renderCount(); } });
    const cStep = (d) => { if (this.running) return; this.count = Math.max(10, Math.min(this.max, this.count + d)); this.range.value = String(this.count); this.renderCount(); };
    this.stopBox = h('input', { type: 'checkbox', onchange: (ev) => { this.stopOnFeature = ev.target.checked; } });
    const lossSel = h('select', { onchange: (ev) => { this.loss = Number(ev.target.value); } },
      h('option', { value: '0' }, this.L('noLimit')),
      ...[10, 25, 50, 100, 250].map((k) => h('option', { value: String(k) }, `${k}× la apuesta`)));
    this.playBtn = h('button', { class: 'hyp-play', 'aria-label': 'Jugar', onclick: () => (this.running ? this.pause() : this.start()) }, '▶');
    this.side = h('aside', { class: 'hyp-side' },
      h('div', { class: 'hyp-brand' }, h('small', {}, title), T.logo ? h('img', { src: T.logo, alt: 'HYPER' }) : h('b', {}, T.title || '⚡ HYPER')),
      h('div', { class: 'hyp-field' }, h('button', { onclick: () => betStep(-1) }, '−'), h('div', {}, this.betEl, h('small', {}, this.L('bet'))), h('button', { onclick: () => betStep(1) }, '+')),
      h('div', { class: 'hyp-field' }, h('button', { onclick: () => cStep(-10) }, '−'), h('div', {}, this.countEl, h('small', {}, this.L('spins'))), h('button', { onclick: () => cStep(10) }, '+')),
      this.range,
      h('label', { class: 'hyp-check' }, this.stopBox, this.L('stop')),
      h('label', { class: 'hyp-check col' }, this.L('loss'), lossSel),
      this.playBtn);
    this.statusEl = h('span', { class: 'hyp-status' }, this.L('ready'));
    this.totalBetEl = h('b', {}, '0');
    this.totalWinEl = h('b', {}, '0');
    this.nEl = h('span', {}, `${this.L('spin')} 0`);
    // La lista solo tiene las tiradas; el crédito inicial y la última tirada quedan fijos arriba (siempre visibles)
    this.list = h('div', { class: 'hyp-list' });
    this.lastN = h('b', { class: 'n' }, '—');
    this.lastWin = h('b', { class: 'w' }, '');
    this.lastX = h('b', { class: 'x' }, '');
    this.lastCredit = h('b', { class: 'c' }, hud.fmt(hud.balance));
    this.last = h('div', { class: 'hyp-last', hidden: T.showLast === false },
      h('div', {}, h('small', {}, this.L('last')), this.lastN),
      h('div', { class: 'r' }, h('small', {}, this.L('win')), this.lastWin),
      h('div', { class: 'r' }, h('small', {}, this.L('x')), this.lastX),
      h('div', { class: 'r' }, h('small', {}, this.L('credit')), this.lastCredit));
    this.initEl = h('small', { class: 'hyp-init' }, `${this.L('initial')} ${hud.fmt(hud.balance)}`);
    this.intro = h('div', { class: 'hyp-intro' }, T.logo ? h('img', { src: T.logo, alt: 'HYPER' }) : h('b', {}, T.title || '⚡ HYPER'),
      h('p', {}, this.L('intro1')),
      h('p', {}, this.L('intro2')));
    const main = h('section', { class: 'hyp-main' },
      h('div', { class: 'hyp-head' }, h('div', {}, h('small', {}, this.L('totalBet')), this.totalBetEl), this.statusEl, h('div', { class: 'r' }, h('small', {}, this.L('totalWin')), this.totalWinEl)),
      this.last, this.initEl,
      h('div', { class: 'hyp-cols' }, this.nEl, h('span', {}, this.L('win')), h('span', {}, this.L('x')), h('span', {}, this.L('credit'))),
      this.list, this.intro);
    this.root = h('div', { class: `hyp ${T.image ? 'img' : ''}` }, h('button', { class: 'hyp-x', 'aria-label': 'Salir', onclick: () => this.close() }, '✕'), this.side, main);
    for (const [k, val] of Object.entries(hyperStyle(T))) this.root.style.setProperty(k, val);
    if (T.font) loadAnyFont(T.font, T.fontUrl).catch(() => {});
    if (T.numFont) loadAnyFont(T.numFont, T.numFontUrl).catch(() => {});
    e.hudRoot.append(this.root);
    hud.lock(true);
    this.renderCount();
    this.renderHead();
  }

  renderCount() { this.countEl.textContent = this.running || this.done ? `${this.done}/${this.count}` : String(this.count); }
  renderHead() {
    this.totalBetEl.textContent = this.hud.fmt(this.totalBet);
    this.totalWinEl.textContent = this.hud.fmt(this.totalWin);
    this.nEl.textContent = `${this.L('spin')} ${this.done}`;
  }
  setStatus(t, cls = '') { this.statusEl.textContent = t; this.statusEl.className = `hyp-status ${cls}`; }

  addRow(n, round, feature) {
    const bet = round.cost || this.hud.bet;
    const x = round.win / Math.max(1, round.bet || bet);
    const row = h('div', { class: `hyp-row ${round.win > 0 ? 'win' : ''} ${feature ? 'feat' : ''}` },
      h('span', {}, feature ? `${n} · ${this.L('bonus')}` : String(n)), h('span', {}, this.hud.fmt(round.win)),
      h('span', {}, `${Number.isInteger(x) ? x : x.toFixed(2)}x`), h('span', {}, this.hud.fmt(round.balance)));
    this.list.prepend(row);
    this.list.scrollTop = 0;
    this.rows++;
    if (this.rows > 400) this.list.lastChild.remove();
    // Última tirada, grande y fija arriba
    const xs = `${Number.isInteger(x) ? x : x.toFixed(2)}x`;
    this.lastN.textContent = feature ? `${n} · ${this.L('bonus')}` : String(n);
    this.lastWin.textContent = this.hud.fmt(round.win);
    this.lastX.textContent = xs;
    this.lastCredit.textContent = this.hud.fmt(round.balance);
    this.last.classList.toggle('win', round.win > 0);
    this.last.classList.toggle('feat', !!feature);
    this.last.classList.remove('pulse'); void this.last.offsetWidth; this.last.classList.add('pulse');
  }

  async start() {
    if (this.done >= this.count) { this.done = 0; }
    this.running = true;
    this.intro.hidden = true;
    this.playBtn.textContent = '❚❚';
    this.playBtn.setAttribute('aria-label', 'Pausar');
    this.range.disabled = true;
    this.setStatus(this.L('playing'), 'on');
    this.startBalance ??= this.hud.balance;
    const e = this.e;
    const bet = this.hud.bet;
    while (this.running && this.done < this.count) {
      if (this.hud.balance < bet) { this.finish(this.L('noFunds'), 'warn'); return; }
      if (this.loss && this.startBalance - this.hud.balance >= this.loss * bet) { this.finish(this.L('lossLimit'), 'warn'); return; }
      let round;
      const t0 = performance.now();
      try { round = await e.api.spin(bet, 'base'); } catch (err) { this.finish(err.message || 'Error de conexión', 'warn'); return; }
      this.done++;
      this.totalBet += round.cost;
      this.totalWin += round.win;
      this.hud.setBalance(round.balance);
      this.hud.setWin(round.win);
      const feature = FEATURE(round.result);
      this.addRow(this.done, round, feature);
      this.renderHead();
      this.renderCount();
      // El juego de fondo queda con la última pantalla y el progreso guardado (barras, nivel)
      try { e.currentBet = bet; await e.playHyper(round.result, round); } catch { /* solo visual */ }
      if (feature && this.stopOnFeature) { this.pauseOnFeature(round); return; }
      // Ritmo: hasta ~8 tiradas por segundo
      const wait = 125 - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    if (this.done >= this.count) this.finish(this.L('done'), 'done');
  }

  pause() {
    this.running = false;
    this.playBtn.textContent = '▶';
    this.playBtn.setAttribute('aria-label', 'Jugar');
    this.setStatus(this.L('paused'));
  }

  finish(text, cls) {
    this.running = false;
    this.playBtn.textContent = '▶';
    this.range.disabled = false;
    this.setStatus(text, cls);
  }

  /** Se detuvo en una función: se puede ver animada (es el mismo resultado ya cobrado) y seguir. */
  pauseOnFeature(round) {
    this.pause();
    this.setStatus(this.L('feature'), 'feat');
    const see = h('button', { class: 'hyp-see', onclick: async () => {
      see.remove();
      this.root.hidden = true;
      const e = this.e;
      e.busy = true;
      try {
        e.roundWin = 0;
        await e.playResult(round.result, round);
        if (round.win > 0) await e.presentTotal(round.win, round.bet || this.hud.bet);
      } catch { /* solo visual */ }
      e.busy = false;
      this.hud.setBalance(round.balance);
      this.root.hidden = false;
      this.hud.lock(true);
    } }, this.L('see'));
    this.list.prepend(h('div', { class: 'hyp-row seebox' }, see));
  }

  close() {
    this.running = false;
    this.root.remove();
    this.hud.lock(false);
    this.hud.setWin(0);
  }
}
