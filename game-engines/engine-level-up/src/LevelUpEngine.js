// Motor 15 — LEVEL UP (cliente): barra de NIVEL y XP, barra de colección de semillas (Drop & Collect),
// bonus de cofres y panel de RECOMPENSAS. El nivel lo guarda el servidor por jugador y apuesta: al cambiar
// la apuesta se muestra el progreso de esa apuesta.
import { BaseEngine, wait, h } from '../../shared/BaseEngine.js';
import { playChests } from '../../shared/MiniGames.js';

const REWARD_ICON = { multiplier: '✖', goldenSeed: '🌟', jackpot: '🏆' };

export class LevelUpEngine extends BaseEngine {
  rewardText(rw, bet = this.hud?.bet) {
    if (rw.type === 'multiplier') return `Premios de línea ×${rw.value}`;
    if (rw.type === 'goldenSeed') return `Semillas doradas: el cofre paga ×${this.game.rules.goldenMult || 2}`;
    if (rw.type === 'jackpot') return `JACKPOT ${bet ? this.hud.fmt(Math.round(rw.value * bet)) : `${rw.value}×`} y vuelves al nivel 1`;
    return rw.type;
  }

  rulesText() {
    const R = this.game.rules;
    const m = this.game.math;
    const rw = (R.rewards || []).slice().sort((a, b) => a.level - b.level).map((x) => `nivel ${x.level}: ${this.rewardText(x)}`).join('; ');
    return `${this.gridLabel()}, ${R.lines} líneas; paga de izquierda a derecha. SUBES DE NIVEL jugando: cada giro da ${R.xpPerSpin} XP y cada nivel pide más XP que el anterior (el primero ${R.xpBase} XP).`
      + (R.collectTarget > 0 ? ` DROP & COLLECT: cada semilla que cae llena la barra de colección; al juntar ${R.collectTarget} subes un nivel.` : '')
      + ` ${R.triggerCount} o más semillas abren el BONUS DE COFRES: eliges un cofre con un premio de ${Math.min(...R.pickValues.map((p) => p.value ?? p))} a ${Math.max(...R.pickValues.map((p) => p.value ?? p))} veces la apuesta y XP extra${R.bonusLevelUp !== false ? ', y subes un nivel' : ''}.`
      + (rw ? ` Recompensas: ${rw}.` : '')
      + ' Tu nivel se guarda para cada apuesta por separado.'
      + (m?.rtp && m?.rtpLevel1 ? ` RTP promedio (jugando y subiendo de nivel): ${(m.rtp * 100).toFixed(2)} %; en el nivel 1: ${(m.rtpLevel1 * 100).toFixed(2)} %.` : '');
  }

  payUnit() { return 1 / (this.game.rules?.lines || 10); }
  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }
  infoExtras(bet) {
    return (this.game.rules?.rewards || []).slice().sort((a, b) => a.level - b.level).map((rw) => [`Nivel ${rw.level}`, this.rewardText(rw, bet)]);
  }

  async init(p) {
    await super.init(p);
    this.buildPanel();
    // Al cambiar la apuesta se carga el nivel de esa apuesta
    const orig = this.hud.renderBet.bind(this.hud);
    this.hud.renderBet = () => { orig(); this.loadProgress(); };
    await this.loadProgress();
  }

  async loadProgress() {
    const bet = this.hud.bet;
    if (this.progressBet === bet && this.progress) return;
    this.progressBet = bet;
    try {
      const p = await this.api.progress(bet);
      if (this.hud.bet === bet) { this.progress = { ...p.state, xpNeed: p.xpNeed }; this.renderPanel(); }
    } catch { /* sin progreso: se muestra el nivel 1 */ this.progress ||= { level: 1, xp: 0, collect: 0, xpNeed: this.game.rules.xpBase }; this.renderPanel(); }
  }

  buildPanel() {
    const R = this.game.rules;
    this.lvNum = h('b', { class: 'lu-num' }, '1');
    this.xpFill = h('i', { class: 'lu-fill' });
    this.xpText = h('small', { class: 'lu-xptext' }, '');
    this.colFill = h('i', { class: 'lu-fill col' });
    this.colText = h('small', { class: 'lu-xptext' }, '');
    this.nextEl = h('div', { class: 'lu-next' }, '');
    const segs = h('div', { class: 'lu-segs' }, Array.from({ length: 10 }, (_, i) => h('span', {}, i === 9 ? '🏁' : '')));
    this.panel = h('div', { class: 'lu-panel' },
      h('div', { class: 'lu-card' }, h('span', { class: 'lu-icon' }, '⭐'),
        h('div', { class: 'lu-info' }, h('small', {}, 'NIVEL'), this.lvNum),
        h('div', { class: 'lu-bars' }, h('div', { class: 'lu-bar' }, this.xpFill), this.xpText,
          R.collectTarget > 0 ? h('div', { class: 'lu-bar col' }, this.colFill, segs) : null, R.collectTarget > 0 ? this.colText : null)),
      this.nextEl,
      h('button', { class: 'lu-rewards', onclick: () => this.showRewards() }, '🎁 RECOMPENSAS'));
    this.hudRoot.append(this.panel);
  }

  renderPanel(pop = false) {
    const p = this.progress;
    if (!p || !this.panel) return;
    const R = this.game.rules;
    this.lvNum.textContent = String(p.level);
    this.xpFill.style.width = `${Math.min(100, (p.xp / Math.max(1, p.xpNeed)) * 100)}%`;
    this.xpText.textContent = `${p.xp} / ${p.xpNeed} XP`;
    if (R.collectTarget > 0) {
      this.colFill.style.width = `${Math.min(100, (p.collect / R.collectTarget) * 100)}%`;
      this.colText.textContent = `🌱 ${p.collect} / ${R.collectTarget}`;
    }
    const next = (R.rewards || []).filter((rw) => rw.level > p.level).sort((a, b) => a.level - b.level)[0];
    this.nextEl.textContent = next ? `Próximo: nivel ${next.level} · ${REWARD_ICON[next.type] || ''} ${this.rewardText(next)}` : '';
    if (pop) { this.panel.classList.remove('pop'); void this.panel.offsetWidth; this.panel.classList.add('pop'); }
  }

  showRewards() {
    const R = this.game.rules;
    const lv = this.progress?.level || 1;
    const rows = (R.rewards || []).slice().sort((a, b) => a.level - b.level).map((rw) => h('div', { class: `lu-rw ${lv >= rw.level ? 'on' : ''}` },
      h('span', { class: 'lu-rw-ic' }, REWARD_ICON[rw.type] || '★'), h('div', {}, h('b', {}, `Nivel ${rw.level}`), h('small', {}, this.rewardText(rw))),
      h('em', {}, lv >= rw.level ? (rw.type === 'jackpot' ? '—' : 'ACTIVA') : '🔒')));
    this.hud.openModal(h('div', { class: 'confirm lu-modal' }, h('h2', {}, 'Recompensas'),
      h('p', {}, `Estás en el nivel ${lv} de ${R.maxLevel} con esta apuesta.`), h('div', { class: 'lu-rws' }, rows)));
  }

  /** Suma XP en la barra con animación (en el cliente; el valor real viene del servidor). */
  async animateTo(state, xpNeed) {
    this.progress = { ...state, xpNeed };
    this.renderPanel(true);
    await wait(this.hud.turbo ? 100 : 300);
  }

  /** Hyper play: solo actualizar el nivel. */
  onHyper(result) { this.progress = { ...result.state, xpNeed: result.xpNeed }; this.renderPanel(true); this.progressBet = this.hud.bet; }

  async playResult(result) {
    const R = this.game.rules;
    await this.stopReels(result.grid, { scatterId: this.scatterId() });
    if (result.lineWin > 0) {
      await this.presentWins(result.wins, result.lineWin);
      if (result.levelMult > 1) this.hud.setStatus(`Recompensa de nivel: premios de línea ×${result.levelMult}`);
    }
    if (result.seeds.length) {
      await this.grid.highlight(result.seeds, { times: 1, color: result.golden.length ? '#ffd700' : '#2ecc71' });
      if (result.golden.length) await this.hud.showBanner(`<small>🌟 SEMILLA DORADA</small><b>COFRE ×${R.goldenMult || 2}</b>`, { kind: 'feature', ms: 1100 });
      this.sound.play('coin');
      if (this.progress) { this.progress.collect = result.collect.completed ? R.collectTarget : result.collect.before + result.collect.added; this.renderPanel(true); }
      if (result.collect.completed) await this.hud.showBanner('<small>🏁 COLECCIÓN COMPLETA</small><b>¡SUBES DE NIVEL!</b>', { kind: 'feature', ms: 1300 });
    }
    if (result.bonus) {
      const b = result.bonus;
      await this.featureIntro('BONUS DE COFRES', 'ELIGE UN COFRE');
      await playChests(this, { mult: b.value, others: b.others, spins: 0 }, {
        image: null, title: 'Elige un cofre',
        info: 'Cada cofre esconde un premio y XP para subir de nivel.',
        done: () => `¡${b.value}× la apuesta${b.goldenMult > 1 ? ` × ${b.goldenMult} (semilla dorada)` : ''}! +${b.xp} XP`,
      });
      this.roundWin = this.money((result.lineWin || 0) + b.win);
      this.hud.countWin(this.roundWin);
      this.flashWinText(this.money(b.win));
      await this.exitBonus?.();
    }
    for (const up of result.levelUps) {
      this.sound.play('feature');
      const rw = up.rewards.filter((x) => x.type !== 'jackpot').map((x) => this.rewardText(x)).join(' · ');
      await this.hud.showBanner(`<small>¡SUBISTE DE NIVEL!</small><b>NIVEL ${up.level}</b>${rw ? `<small>${rw}</small>` : ''}`, { kind: up.rewards.length ? 'big' : 'feature', ms: this.hud.turbo ? 900 : 1700 });
    }
    if (result.jackpot) {
      this.sound.play('bigWin');
      this.hud.celebrate(1.5);
      await this.hud.showBanner(`<small>🏆 NIVEL ${result.jackpot.level} · JACKPOT</small><b>${this.hud.fmt(this.money(result.jackpot.value))}</b><small>¡Vuelves al nivel 1!</small>`, { kind: 'big', ms: 3000 });
      this.roundWin = this.money(result.totalWin);
      this.hud.countWin(this.roundWin);
    }
    await this.animateTo(result.state, result.xpNeed);
    this.progressBet = this.hud.bet;
    this.hud.setStatus('');
  }
}
