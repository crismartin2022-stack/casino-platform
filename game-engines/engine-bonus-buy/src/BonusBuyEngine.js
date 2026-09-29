// Motor 3 — BONUS BUY (cliente): líneas, giros gratis multiplicados y MENÚ DE COMPRA
// (giros gratis, giros gratis con wilds fijos, ruleta de la fortuna y "elige un premio").
import { Graphics } from 'pixi.js';
import { BaseEngine, wait } from '../../shared/BaseEngine.js';
import { playWheel, playPick } from '../../shared/MiniGames.js';

export class BonusBuyEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    const menu = this.buyOptions().map((o) => `${o.name} (${o.cost}× la apuesta)`).join(', ');
    return `${this.gridLabel()}, ${R.lines} líneas fijas; paga de izquierda a derecha. 3, 4 o 5 scatters activan ${R.freeSpins['3']}, ${R.freeSpins['4'] ?? R.freeSpins['3']} o ${R.freeSpins['5'] ?? R.freeSpins['3']} giros gratis con todos los premios ×${R.fsMultiplier}. Bonos que puedes comprar: ${menu}.`;
  }

  payUnit() { return 1 / (this.game.rules?.lines || 20); }
  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  buildScene() {
    super.buildScene();
    this.stickyLayer = new Graphics();
    this.grid.fx.addChild(this.stickyLayer);
  }

  onSpinStart() { this.stickyLayer?.clear(); }

  drawHeld(held) {
    const g = this.grid;
    this.stickyLayer.clear();
    for (const key of held || []) {
      const [c, r] = key.split(',').map(Number);
      const ch = g.cellH(c);
      this.stickyLayer.roundRect(c * (g.colW + g.gap) + 2, r * ch + g.gap / 2 + 2, g.colW - 4, ch - g.gap - 4, 12)
        .stroke({ color: this.game.theme?.palette?.accent || '#ffd460', width: 5 });
    }
  }

  async playResult(result) {
    if (result.base) {
      await this.stopReels(result.base.grid, { scatterId: this.scatterId() });
      await this.presentWins(result.base.wins, result.base.win);
    }
    if (result.bonus) {
      await this.grid.stop(this.randomGrid());
      const title = result.bonus.type === 'wheel' ? 'RULETA DE LA FORTUNA' : 'ELIGE UN PREMIO';
      await this.featureIntro(title, 'BONUS');
      if (result.bonus.type === 'wheel') await playWheel(this, result.bonus);
      else await playPick(this, result.bonus);
      this.roundWin = this.money(result.bonus.totalWin);
      await this.featureOutro(result.bonus.totalWin);
      return;
    }
    const fs = result.freeSpins;
    if (!fs) return;
    if (result.base) await this.grid.highlight(result.base.scatters, { times: 3 });
    else await this.grid.stop(this.randomGrid());
    await this.featureIntro(`${fs.awarded} GIROS GRATIS`, fs.sticky ? 'WILDS FIJOS' : `TODOS LOS PREMIOS ×${fs.multiplier}`);
    let i = 0;
    for (const s of fs.spins) {
      i++;
      this.hud.setStatus(`GIRO GRATIS ${i}/${fs.spins.length}${fs.multiplier > 1 ? ` · ×${fs.multiplier}` : ''}${fs.sticky ? ` · ${s.held.length} WILDS FIJOS` : ''}`);
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.stopReels(s.grid, { scatterId: this.scatterId() });
      if (fs.sticky) this.drawHeld(s.held);
      await this.presentWins(s.wins, s.win);
    }
    this.hud.setStatus('');
    this.stickyLayer.clear();
    await this.featureOutro(fs.totalWin);
  }
}
