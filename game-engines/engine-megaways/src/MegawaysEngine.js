// Motor 2 — MEGAWAYS (cliente): rodillos de 2 a 7 filas y giros gratis con multiplicador creciente.
import { Text, Container } from 'pixi.js';
import { BaseEngine, wait, gsap } from '../../shared/BaseEngine.js';

export class MegawaysEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    const n = this.game.grid.reels;
    const max = this.game.grid.rowsMax || 7;
    const fs = R.freeSpinsPerScatter > 0 ? `${R.scattersToTrigger} o más scatters dan ${R.freeSpinsPerScatter} giros gratis POR CADA scatter` : `${R.scattersToTrigger} o más scatters dan giros gratis`;
    const mv = (R.multiplierValues || []).map((m) => (typeof m === 'number' ? m : m.value));
    return `${n} rodillos que muestran de 2 a ${max} símbolos en cada giro: hasta ${(max ** n).toLocaleString('es')} formas de ganar. `
      + (R.wildMultMin > 0 ? `Con ${R.wildMultMin} o más comodines, cada comodín suma +1 al multiplicador del giro. ` : '')
      + (mv.length && this.game.symbols.some((s) => s.type === 'multiplier') ? `Los símbolos MULTIPLICADOR traen de ×${Math.min(...mv)} a ×${Math.max(...mv)} y se suman al multiplicador del giro si hay premio. ` : '')
      + `${fs}; cada giro gratis ganador suma +${R.fsMultiplierStep} al multiplicador.`;
  }

  buildScene() {
    super.buildScene();
    this.labels = new Container();
    this.grid.fx.addChild(this.labels);
  }

  onSpinStart() { this.labels?.removeChildren().forEach((c) => c.destroy()); }

  /** Valores de los símbolos multiplicador y aviso del multiplicador del giro. */
  async showMults(s) {
    for (const m of s.mults || []) {
      const t = new Text({ text: `×${m.value}`, style: { fontFamily: this.game.theme?.font || 'Arial', fontSize: 34, fill: '#ffffff', stroke: { color: '#6c3fc5', width: 7 } } });
      t.anchor.set(0.5);
      const p = this.grid.cellCenter(m.c, m.r);
      t.position.set(p.x, p.y);
      this.labels.addChild(t);
      gsap.from(t.scale, { x: 0, y: 0, duration: 0.35, ease: 'back.out(2.5)' });
    }
    if (s.mults?.length) { this.sound.play('feature', { rate: 1.3 }); await wait(this.hud.turbo ? 150 : 450); }
    if (s.spinMult > 1) {
      const why = s.wildMult ? `${s.wildMult} COMODINES` : 'MULTIPLICADOR';
      await this.hud.showBanner(`<small>${why}</small><b>×${s.spinMult}</b>`, { kind: 'feature', ms: this.hud.turbo ? 700 : 1300 });
    }
  }

  gridRows() { return Array(this.game.grid.reels).fill(4); }
  gridCols() { return this.game.grid.reels; }

  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  async showSpin(s) {
    this.hud.setStatus(`${s.ways.toLocaleString('es')} FORMAS`);
    await this.stopReels(s.grid, { scatterId: this.scatterId() });
    await this.showMults(s);
    await this.presentWins(s.wins, s.win);
  }

  async playResult(result) {
    await this.showSpin(result.base);
    const fs = result.freeSpins;
    if (!fs) { this.hud.setStatus(''); return; }
    await this.grid.highlight(result.base.scatters, { times: 3 });
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), '¡BONUS!');
    let i = 0;
    for (const s of fs.spins) {
      i++;
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      this.onSpinStart();
      await this.stopReels(s.grid, { scatterId: this.scatterId() });
      this.hud.setStatus(`${this.msg('spinOf', { i, n: fs.spins.length })} · ×${s.multiplier} · ${s.ways.toLocaleString('es')} FORMAS`);
      await this.showMults(s);
      await this.presentWins(s.wins, s.win);
    }
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
  }
}
