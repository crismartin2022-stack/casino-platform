// Motor 2 — MEGAWAYS (cliente): rodillos de 2 a 7 filas y giros gratis con multiplicador creciente.
import { BaseEngine, wait } from '../../shared/BaseEngine.js';

export class MegawaysEngine extends BaseEngine {
  rulesText() {
    const n = this.game.grid.reels;
    const max = this.game.grid.rowsMax || 7;
    return `${n} rodillos que muestran de 2 a ${max} símbolos en cada giro: hasta ${(max ** n).toLocaleString('es')} formas de ganar. ${this.game.rules.scattersToTrigger} o más scatters dan giros gratis; cada giro gratis ganador suma +${this.game.rules.fsMultiplierStep} al multiplicador.`;
  }

  gridRows() { return Array(this.game.grid.reels).fill(4); }
  gridCols() { return this.game.grid.reels; }

  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  async showSpin(s) {
    this.hud.setStatus(`${s.ways.toLocaleString('es')} FORMAS`);
    await this.stopReels(s.grid, { scatterId: this.scatterId() });
    await this.presentWins(s.wins, s.win);
  }

  async playResult(result) {
    await this.showSpin(result.base);
    const fs = result.freeSpins;
    if (!fs) { this.hud.setStatus(''); return; }
    await this.grid.highlight(result.base.scatters, { times: 3 });
    await this.featureIntro(`${fs.awarded} GIROS GRATIS`, '¡BONUS!');
    let i = 0;
    for (const s of fs.spins) {
      i++;
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.stopReels(s.grid, { scatterId: this.scatterId() });
      this.hud.setStatus(`GIRO GRATIS ${i}/${fs.spins.length} · ×${s.multiplier} · ${s.ways.toLocaleString('es')} FORMAS`);
      await this.presentWins(s.wins, s.win);
    }
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
  }
}
