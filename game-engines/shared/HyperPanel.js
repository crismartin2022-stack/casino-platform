// HYPER: juego automático súper rápido sin rodillos. Cada tirada es un giro normal del servidor (mismo RTP,
// misma auditoría); solo se salta la animación y se muestra una lista con la ganancia y el crédito de cada una.
// El jugador elige apuesta, cantidad de tiradas, si se detiene al entrar en una función y un límite de pérdida.
import { h } from './Hud.js';

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
  }

  open() {
    const e = this.e;
    const hud = this.hud;
    const title = e.game.theme?.title || e.game.name;
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
      h('option', { value: '0' }, 'Sin límite'),
      ...[10, 25, 50, 100, 250].map((k) => h('option', { value: String(k) }, `${k}× la apuesta`)));
    this.playBtn = h('button', { class: 'hyp-play', 'aria-label': 'Jugar', onclick: () => (this.running ? this.pause() : this.start()) }, '▶');
    this.side = h('aside', { class: 'hyp-side' },
      h('div', { class: 'hyp-brand' }, h('small', {}, title), h('b', {}, '⚡ HYPER')),
      h('div', { class: 'hyp-field' }, h('button', { onclick: () => betStep(-1) }, '−'), h('div', {}, this.betEl, h('small', {}, 'APUESTA')), h('button', { onclick: () => betStep(1) }, '+')),
      h('div', { class: 'hyp-field' }, h('button', { onclick: () => cStep(-10) }, '−'), h('div', {}, this.countEl, h('small', {}, 'TIRADAS')), h('button', { onclick: () => cStep(10) }, '+')),
      this.range,
      h('label', { class: 'hyp-check' }, this.stopBox, 'Detenerse en la función'),
      h('label', { class: 'hyp-check col' }, 'Detener si pierdo más de', lossSel),
      this.playBtn);
    this.statusEl = h('span', { class: 'hyp-status' }, 'LISTO');
    this.totalBetEl = h('b', {}, '0');
    this.totalWinEl = h('b', {}, '0');
    this.nEl = h('span', {}, 'TIRADA 0');
    this.list = h('div', { class: 'hyp-list' },
      h('div', { class: 'hyp-row first' }, h('span', {}, 'CRÉDITO INICIAL'), h('span', {}), h('span', {}), h('span', {}, hud.fmt(hud.balance))));
    this.intro = h('div', { class: 'hyp-intro' }, h('b', {}, '⚡ HYPER'),
      h('p', {}, 'Juego automático súper rápido, sin rodillos. Cada tirada es un giro normal del juego: mismo RTP y mismas reglas.'),
      h('p', {}, 'Elige la apuesta y cuántas tiradas, y pulsa ▶. Puedes pausar o cambiarlo cuando quieras.'));
    const main = h('section', { class: 'hyp-main' },
      h('div', { class: 'hyp-head' }, h('div', {}, h('small', {}, 'APUESTA TOTAL'), this.totalBetEl), this.statusEl, h('div', { class: 'r' }, h('small', {}, 'PREMIO TOTAL'), this.totalWinEl)),
      h('div', { class: 'hyp-cols' }, this.nEl, h('span', {}, 'GANANCIA'), h('span', {}, '×'), h('span', {}, 'CRÉDITO')),
      this.list, this.intro);
    this.root = h('div', { class: 'hyp' }, h('button', { class: 'hyp-x', 'aria-label': 'Salir', onclick: () => this.close() }, '✕'), this.side, main);
    e.hudRoot.append(this.root);
    hud.lock(true);
    this.renderCount();
    this.renderHead();
  }

  renderCount() { this.countEl.textContent = this.running || this.done ? `${this.done}/${this.count}` : String(this.count); }
  renderHead() {
    this.totalBetEl.textContent = this.hud.fmt(this.totalBet);
    this.totalWinEl.textContent = this.hud.fmt(this.totalWin);
    this.nEl.textContent = `TIRADA ${this.done}`;
  }
  setStatus(t, cls = '') { this.statusEl.textContent = t; this.statusEl.className = `hyp-status ${cls}`; }

  addRow(n, round, feature) {
    const bet = round.cost || this.hud.bet;
    const x = round.win / Math.max(1, round.bet || bet);
    const row = h('div', { class: `hyp-row ${round.win > 0 ? 'win' : ''} ${feature ? 'feat' : ''}` },
      h('span', {}, feature ? `${n} · BONUS` : String(n)), h('span', {}, this.hud.fmt(round.win)),
      h('span', {}, `${Number.isInteger(x) ? x : x.toFixed(2)}x`), h('span', {}, this.hud.fmt(round.balance)));
    this.list.firstChild.after(row);
    this.rows++;
    if (this.rows > 400) this.list.lastChild.remove();
  }

  async start() {
    if (this.done >= this.count) { this.done = 0; }
    this.running = true;
    this.intro.hidden = true;
    this.playBtn.textContent = '❚❚';
    this.playBtn.setAttribute('aria-label', 'Pausar');
    this.range.disabled = true;
    this.setStatus('JUGANDO', 'on');
    this.startBalance ??= this.hud.balance;
    const e = this.e;
    const bet = this.hud.bet;
    while (this.running && this.done < this.count) {
      if (this.hud.balance < bet) { this.finish('SALDO INSUFICIENTE', 'warn'); return; }
      if (this.loss && this.startBalance - this.hud.balance >= this.loss * bet) { this.finish('LÍMITE DE PÉRDIDA', 'warn'); return; }
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
    if (this.done >= this.count) this.finish('TERMINADO', 'done');
  }

  pause() {
    this.running = false;
    this.playBtn.textContent = '▶';
    this.playBtn.setAttribute('aria-label', 'Jugar');
    this.setStatus('EN PAUSA');
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
    this.setStatus('FUNCIÓN', 'feat');
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
    } }, '▶ VER LA FUNCIÓN');
    this.list.firstChild.after(h('div', { class: 'hyp-row seebox' }, see));
  }

  close() {
    this.running = false;
    this.root.remove();
    this.hud.lock(false);
    this.hud.setWin(0);
  }
}
