// Motor 18 — TRES SOLES (cliente): tres barras de soles (roja, dorada y azul) que el servidor guarda por jugador
// y apuesta. Al llenarse una barra se juega su bonus de giros gratis.
import { BaseEngine, wait, h } from '../../shared/BaseEngine.js';

const COLORS = ['red', 'gold', 'blue'];
const HEX = { red: '#ef4444', gold: '#facc15', blue: '#38bdf8' };
const ICON = { red: '🔥', gold: '✨', blue: '💧' };

export class TripleSunEngine extends BaseEngine {
  potName(c) { return this.game.rules.pots?.[c]?.name || { red: 'Sol de fuego', gold: 'Sol de oro', blue: 'Sol del cielo' }[c]; }
  potText(c) {
    const P = this.game.rules.pots?.[c] || {};
    if (c === 'red') return `${P.spins} giros gratis con todos los premios ×${P.mult}`;
    if (c === 'gold') { const v = (P.mults || []).map((m) => m.value ?? m); return `${P.spins} giros gratis, cada uno con un multiplicador de ×${Math.min(...v)} a ×${Math.max(...v)}`; }
    return `${P.spins} giros gratis con 1 a ${P.wildsMax} comodines extra en cada giro`;
  }

  rulesText() {
    const R = this.game.rules;
    const m = this.game.math;
    return `${this.gridLabel()}, ${R.lines} líneas; paga de izquierda a derecha. TRES SOLES: cada sol que cae suma uno a la barra de su color y la barra se guarda entre giros (por separado para cada apuesta). Al llenarla se juega su bonus: `
      + COLORS.map((c) => `${this.potName(c)} (${R.pots[c].target} soles): ${this.potText(c)}`).join('; ')
      + '. Si se llenan varias a la vez, se juegan todos esos bonus. En los giros gratis los soles no suman.'
      + (m?.rtp && m?.rtpLevel1 ? ` RTP promedio (guardando las barras): ${(m.rtp * 100).toFixed(2)} %; con las barras vacías y sin guardar progreso: ${(m.rtpLevel1 * 100).toFixed(2)} %.` : '');
  }

  payUnit() { return 1 / (this.game.rules?.lines || 20); }
  infoExtras() { return COLORS.map((c) => [`${ICON[c]} ${this.potName(c)}`, this.potText(c)]); }

  async init(p) {
    await super.init(p);
    this.buildPots();
    const orig = this.hud.renderBet.bind(this.hud);
    this.hud.renderBet = () => { orig(); this.loadProgress(); };
    await this.loadProgress();
  }

  async loadProgress() {
    const bet = this.hud.bet;
    if (this.progressBet === bet && this.pots) return;
    this.progressBet = bet;
    try {
      const p = await this.api.progress(bet);
      if (this.hud.bet === bet) { this.pots = p.state; this.renderPots(); }
    } catch { this.pots ||= { red: 0, gold: 0, blue: 0 }; this.renderPots(); }
  }

  buildPots() {
    this.potEls = {};
    const rows = COLORS.map((c) => {
      const fill = h('i', { class: 'ts-fill', style: `background:${HEX[c]}` });
      const txt = h('small', { class: 'ts-n' }, '');
      this.potEls[c] = { fill, txt };
      return h('div', { class: 'ts-pot', title: this.potText(c) }, h('span', { class: 'ts-ic', style: `color:${HEX[c]}` }, '☀'),
        h('div', { class: 'ts-bar' }, fill), txt);
    });
    this.panel = h('div', { class: 'lu-panel ts-panel' }, h('b', { class: 'ts-title' }, 'TRES SOLES'), ...rows);
    this.hudRoot.append(this.panel);
  }

  renderPots(pop = null) {
    if (!this.pots || !this.potEls) return;
    for (const c of COLORS) {
      const t = this.game.rules.pots[c].target;
      const v = Math.min(t, this.pots[c] || 0);
      this.potEls[c].fill.style.width = `${(v / t) * 100}%`;
      this.potEls[c].txt.textContent = `${v}/${t}`;
      if (pop?.includes(c)) { const el = this.potEls[c].fill.parentElement.parentElement; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    }
  }

  async playResult(result) {
    const R = this.game.rules;
    await this.stopReels(result.grid);
    if (result.lineWin > 0) await this.presentWins(result.wins, result.lineWin);
    if (result.suns.length) {
      // Los soles suben a su barra
      await this.grid.highlight(result.suns.map((s) => [s.c, s.r]), { times: 1, color: '#ffd76a' });
      this.sound.play('coin');
      const counts = { ...result.stateBefore };
      for (const s of result.suns) counts[s.color] = (counts[s.color] || 0) + 1;
      this.pots = Object.fromEntries(COLORS.map((c) => [c, Math.min(R.pots[c].target, counts[c])]));
      this.renderPots([...new Set(result.suns.map((s) => s.color))]);
      await wait(this.hud.turbo ? 150 : 400);
    }
    let acc = result.lineWin;
    for (const b of result.bonuses || []) {
      await this.hud.showBanner(`<small>${ICON[b.color]} BARRA LLENA</small><b>${this.potName(b.color).toUpperCase()}</b>`, { kind: 'feature', ms: this.hud.turbo ? 800 : 1500 });
      await this.featureIntro(this.msg('freeSpins', { n: b.spins.length }), this.potText(b.color).toUpperCase());
      let i = 0;
      for (const s of b.spins) {
        i++;
        this.hud.setStatus(`${this.potName(b.color)} · ${this.msg('spinOf', { i, n: b.spins.length })}${s.mult > 1 ? ` · ×${s.mult}` : ''}`);
        this.grid.undim();
        this.grid.startSpin();
        await wait(this.hud.turbo ? 100 : 260);
        await this.grid.stop(s.grid);
        if (s.wilds?.length) { this.sound.play('feature'); await this.grid.highlight(s.wilds, { times: 1, color: HEX.blue }); }
        if (b.color === 'gold' && s.mult > 1) await this.hud.showBanner(`<small>MULTIPLICADOR</small><b>×${s.mult}</b>`, { kind: 'feature', ms: this.hud.turbo ? 400 : 800 });
        if (s.win > 0) {
          await this.presentWins(s.wins, s.win);
          acc += s.win;
          this.roundWin = this.money(acc);
          this.hud.countWin(this.roundWin);
        }
      }
      this.hud.setStatus('');
      await this.featureOutro(b.totalWin);
      this.pots = { ...this.pots, [b.color]: result.state[b.color] };
      this.renderPots([b.color]);
    }
    this.pots = { ...result.state };
    this.renderPots();
    this.progressBet = this.hud.bet;
  }

  /** Hyper play: solo actualizar las barras. */
  onHyper(result) { this.pots = { ...result.state }; this.renderPots([...new Set((result.suns || []).map((s) => s.color))]); this.progressBet = this.hud.bet; }
}
