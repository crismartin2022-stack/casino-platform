// Motor 12 — COFRES (cliente): premios por fila y bonus de elección de cofre con giros gratis multiplicados.
import { BaseEngine, wait } from '../../shared/BaseEngine.js';
import { playChests } from '../../shared/MiniGames.js';

export class TreasureChestsEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules, g = this.game.grid;
    const prizes = (R.chestPrizes || []).map((p) => `×${typeof p === 'number' ? p : p.mult}`).join(', ');
    const where = (R.triggerRow ?? -1) < 0 ? 'en pantalla' : `en la ${['primera', 'segunda', 'tercera', 'cuarta', 'quinta'][R.triggerRow] || `${R.triggerRow + 1}.ª`} fila`;
    const onTrigger = (R.chestMultTarget || 'trigger') === 'trigger';
    return `${this.gridLabel()}. Paga con 3, 4 o ${g.reels} símbolos iguales en la MISMA FILA, en cualquier posición; cada fila paga por separado y se suman. `
      + `${R.triggerCount} o más cofres ${where} abren el BONUS DE COFRES: eliges un cofre, que revela un multiplicador${prizes ? ` (${prizes})` : ''} `
      + (onTrigger ? `para el premio de ese giro, y ganas ${R.freeSpins} giros gratis.` : `y juegas ${R.freeSpins} giros gratis con todos los premios multiplicados.`)
      + ` En los giros gratis, otros ${R.triggerCount} cofres abren una nueva elección y suman giros.`
      + (R.buyCost ? ` También puedes comprar el bonus por ${R.buyCost}× la apuesta.` : '');
  }

  paySuffix() { return 'iguales en fila'; }
  payNote() {
    return `Importes por FILA: ${this.game.grid.rows} filas, cada una paga si tiene 3 o más símbolos iguales en cualquier posición (no hace falta que estén juntos). Si varias filas ganan en el mismo giro, se suman todas.`;
  }

  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  /** Elección de cofre sobre el giro que lo activó. */
  async openChest(s, n) {
    const img = this.game.symbols.find((x) => x.type === 'scatter')?.image;
    const onTrigger = (this.game.rules.chestMultTarget || 'trigger') === 'trigger';
    await this.grid.highlight(s.chests, { times: 2 });
    await playChests(this, s.chest, {
      image: img, title: 'Elige un cofre',
      info: onTrigger ? `El cofre multiplica el premio de este giro y te da ${s.chest.spins} giros gratis.` : `Cada cofre esconde un multiplicador para tus ${s.chest.spins} giros gratis.`,
      done: (c) => (onTrigger ? `¡×${c.mult}! Premio del giro ×${c.mult} y ${c.spins} giros gratis` : `¡×${c.mult}! ${c.spins} giros gratis con todos los premios ×${c.mult}`),
    });
    void n;
  }

  async playResult(result) {
    const b = result.base;
    await this.stopReels(b.grid, { scatterId: this.scatterId() });
    const fs = result.freeSpins;
    if (b.chest) {
      await this.featureIntro(this.msg('freeSpins', { n: b.chest.spins }), 'BONUS DE COFRES');
      await this.openChest(b);
    }
    await this.presentWins(b.wins, b.win);
    if (!fs) return;
    let i = 0, total = fs.awarded;
    for (const s of fs.spins) {
      i++;
      this.hud.setStatus(`${this.msg('spinOf', { i, n: total })}${fs.multiplier > 1 ? ` · ×${fs.multiplier}` : ''}`);
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.stopReels(s.grid, { scatterId: this.scatterId() });
      if (s.chest) {
        total += s.retrigger || 0;
        await this.openChest(s);
        this.hud.setStatus(`${this.msg('spinOf', { i, n: total })} · +${s.retrigger} GIROS`);
      }
      await this.presentWins(s.wins, s.win);
    }
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
  }
}
