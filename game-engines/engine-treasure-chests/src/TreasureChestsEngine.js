// Motor 12 — COFRES (cliente): premios por fila y bonus de elección de cofre con giros gratis multiplicados.
import { BaseEngine, wait } from '../../shared/BaseEngine.js';
import { playChests } from '../../shared/MiniGames.js';

export class TreasureChestsEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules, g = this.game.grid;
    const prizes = (R.chestPrizes || []).map((p) => `×${typeof p === 'number' ? p : p.mult}`).join(', ');
    return `${this.gridLabel()}. Paga con ${3}, ${4} o ${g.reels >= 5 ? 5 : 4} símbolos iguales en la MISMA FILA, en cualquier posición; cada fila paga por separado y se suman. `
      + `${R.triggerCount} o más cofres en pantalla abren el BONUS DE COFRES: eliges un cofre, que revela un multiplicador${prizes ? ` (${prizes})` : ''}, `
      + `y juegas ${R.freeSpins} giros gratis con todos los premios multiplicados. En los giros gratis, ${R.triggerCount}+ cofres suman ${R.retrigger} giros.`
      + (R.buyCost ? ` También puedes comprar el bonus por ${R.buyCost}× la apuesta.` : '');
  }

  paySuffix() { return 'iguales en fila'; }
  payNote() {
    return `Importes por FILA: ${this.game.grid.rows} filas, cada una paga si tiene 3 o más símbolos iguales en cualquier posición (no hace falta que estén juntos). Si varias filas ganan en el mismo giro, se suman todas.`;
  }

  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  async playResult(result) {
    if (result.base) {
      await this.stopReels(result.base.grid, { scatterId: this.scatterId() });
      await this.presentWins(result.base.wins, result.base.win);
    }
    const fs = result.freeSpins;
    if (!fs) return;
    if (result.base) await this.grid.highlight(result.base.chests, { times: 3 });
    else await this.grid.stop(this.randomGrid());
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), 'BONUS DE COFRES');
    const img = this.game.symbols.find((s) => s.type === 'scatter')?.image;
    await playChests(this, result.chest, { image: img, title: 'Elige un cofre' });
    let i = 0;
    for (const s of fs.spins) {
      i++;
      this.hud.setStatus(`${this.msg('spinOf', { i, n: fs.spins.length })} · ×${fs.multiplier}${s.retrigger ? ` · +${s.retrigger} GIROS` : ''}`);
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.stopReels(s.grid, { scatterId: this.scatterId() });
      if (s.retrigger) await this.grid.highlight(s.chests, { times: 2 });
      await this.presentWins(s.wins, s.win);
    }
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
  }
}
