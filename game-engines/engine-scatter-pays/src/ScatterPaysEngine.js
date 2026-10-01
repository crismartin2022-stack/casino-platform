// Motor 7 — SCATTER PAYS (cliente): 8+ iguales en cualquier lugar, cascadas y bombas multiplicadoras.
import { Container, Text } from 'pixi.js';
import { BaseEngine, wait, gsap } from '../../shared/BaseEngine.js';

export class ScatterPaysEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    return `${this.gridLabel()}. Paga con 8 o más símbolos iguales en cualquier posición. Los ganadores desaparecen y caen nuevos (cascada). Las bombas multiplicadoras traen un valor de ×${Math.min(...R.multiplierValues)} a ×${Math.max(...R.multiplierValues)}: al terminar las cascadas, si hubo premio, se suman y multiplican el premio del giro. ${R.scattersToTrigger} o más rayos dan ${R.freeSpins} giros gratis donde los multiplicadores se acumulan${R.retrigger ? ` (${R.retriggerScatters} rayos durante el bonus dan +${R.retrigger} giros)` : ''}. También puedes comprar los giros gratis por ${R.buyCost}× la apuesta.`
      + (R.zeusChance > 0 ? ` RAYO DE ZEUS: en cualquier giro puede caer un rayo que suma de ${R.zeusOrbsMin} a ${R.zeusOrbsMax} bombas multiplicadoras extra.` : '')
      + (R.anteCost > 0 ? ` DOBLE CHANCE: por ${R.anteCost}× la apuesta aparecen más rayos y entras más seguido a los giros gratis.` : '');
  }

  payLabel(n, keys) { return Number(n) === Math.max(...keys.map(Number)) ? `${n}+` : `${n}-${Number(keys.map(Number).sort((a, b) => a - b).find((k) => k > n)) - 1}`; }

  buildScene() {
    super.buildScene();
    this.multLayer = new Container();
    this.grid.fx.addChild(this.multLayer);
  }

  onSpinStart() { this.clearMults(); }
  clearMults() { this.multLayer?.removeChildren().forEach((c) => c.destroy()); }

  drawMults(mults, pop = false) {
    this.clearMults();
    mults.forEach((col, c) => col.forEach((v, r) => {
      if (v == null) return;
      const t = new Text({ text: `×${v}`, style: { fontFamily: this.game.theme?.font || 'Arial', fontSize: 34, fontWeight: '900', fill: '#ffffff', stroke: { color: '#000000', width: 6 } } });
      t.anchor.set(0.5);
      const p = this.grid.cellCenter(c, r);
      t.position.set(p.x, p.y);
      this.multLayer.addChild(t);
      if (pop) gsap.from(t.scale, { x: 0, y: 0, duration: 0.3, ease: 'back.out(2)' });
    }));
  }

  async showSequence(seq, accMult = 0) {
    await this.stopReels(seq.steps[0].grid, { scatterId: this.game.symbols.find((s) => s.type === 'scatter')?.id });
    if (seq.zeusOrbs?.length) {
      // Rayo de Zeus: destello y las bombas extra caen del cielo
      this.sound.play('feature');
      await this.hud.showBanner('<small>⚡ RAYO DE ZEUS ⚡</small><b>+' + seq.zeusOrbs.length + ' MULTIPLICADORES</b>', { kind: 'feature', ms: this.hud.turbo ? 700 : 1300 });
      await this.grid.highlight(seq.zeusOrbs, { times: 1, color: '#ffffff' });
    }
    this.drawMults(seq.steps[0].mults, true);
    for (let i = 0; i < seq.steps.length - 1; i++) {
      const st = seq.steps[i];
      await this.presentWins(st.wins, st.win);
      this.sound.play('tumble');
      this.clearMults();
      await this.grid.explode(st.removed);
      await this.grid.cascade(seq.steps[i + 1].grid);
      this.drawMults(seq.steps[i + 1].mults, true);
    }
    if (seq.baseWin > 0 && seq.applied > 1) {
      // Las bombas vuelan al centro y se suman
      const cx = this.grid.w / 2, cy = this.grid.h / 2;
      const flying = [...this.multLayer.children];
      if (flying.length) {
        this.sound.play('coin');
        await Promise.all(flying.map((t, k) => new Promise((res) => gsap.to(t.position, { x: cx, y: cy, duration: this.hud.turbo ? 0.25 : 0.55, delay: k * 0.06, ease: 'power2.in', onComplete: res }))));
        this.clearMults();
      }
      this.sound.play('bigWin');
      await this.hud.showBanner(`<small>MULTIPLICADOR${accMult ? ' ACUMULADO' : ''}</small><b>×${seq.applied}</b>`, { kind: 'big', ms: 1300 });
      this.roundWin = (this.roundWin || 0) + this.money(seq.win - seq.baseWin);
      this.hud.countWin(this.roundWin);
      this.flashWinText(this.money(seq.win));
    }
  }

  async playResult(result) {
    if (result.base) {
      await this.showSequence(result.base);
      if (result.scatterPay > 0) {
        this.roundWin = (this.roundWin || 0) + this.money(result.scatterPay);
        this.hud.countWin(this.roundWin);
      }
    } else {
      await this.grid.stop(this.randomGrid());
    }
    const fs = result.freeSpins;
    if (!fs) return;
    if (result.base) await this.grid.highlight(result.base.scatters, { times: 3 });
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), 'LOS MULTIPLICADORES SE ACUMULAN');
    let i = 0, acc = 0, total = fs.awarded;
    for (const s of fs.spins) {
      i++;
      this.hud.setStatus(`${this.msg('spinOf', { i, n: total })} · MULTIPLICADOR ACUMULADO ×${acc || 0}`);
      this.clearMults();
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.showSequence(s, acc);
      acc = s.accMult;
      if (s.retrigger) {
        total += s.retrigger;
        await this.grid.highlight(s.scatters, { times: 2 });
        this.sound.play('feature');
        await this.hud.showBanner(`<small>¡MÁS GIROS!</small><b>+${s.retrigger}</b>`, { kind: 'feature', ms: 1400 });
      }
    }
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
  }
}
