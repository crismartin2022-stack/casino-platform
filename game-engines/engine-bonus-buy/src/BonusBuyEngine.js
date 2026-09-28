// Motor 3 — BONUS BUY (cliente): 20 líneas, giros gratis multiplicados y botón de compra.
import { BaseEngine, wait } from '../../shared/BaseEngine.js';

export class BonusBuyEngine extends BaseEngine {
  static rulesText = '20 líneas fijas; paga de izquierda a derecha. 3, 4 o 5 scatters activan 10, 12 o 15 giros gratis con todos los premios multiplicados. También puedes comprar los giros gratis directamente.';

  supportsBuy() { return Boolean(this.game.rules?.buyCost); }
  payUnit() { return 1 / (this.game.rules?.lines || 20); }
  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  async playResult(result) {
    if (result.base) {
      await this.stopReels(result.base.grid, { scatterId: this.scatterId() });
      await this.presentWins(result.base.wins, result.base.win);
    }
    const fs = result.freeSpins;
    if (!fs) return;
    if (result.base) await this.grid.highlight(result.base.scatters, { times: 3 });
    else await this.grid.stop(this.randomGrid());
    await this.featureIntro(`${fs.awarded} GIROS GRATIS`, `TODOS LOS PREMIOS ×${fs.multiplier}`);
    let i = 0;
    for (const s of fs.spins) {
      i++;
      this.hud.setStatus(`GIRO GRATIS ${i}/${fs.spins.length} · ×${fs.multiplier}`);
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 150 : 380);
      await this.stopReels(s.grid, { scatterId: this.scatterId() });
      await this.presentWins(s.wins, s.win);
    }
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
  }
}
