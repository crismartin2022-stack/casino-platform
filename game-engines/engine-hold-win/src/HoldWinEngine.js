// Motor 4 — HOLD & WIN (cliente): monedas con premio que quedan fijas durante los re-giros.
import { Text, Graphics, Container } from 'pixi.js';
import { BaseEngine, wait, gsap } from '../../shared/BaseEngine.js';
import { HoldFeature } from './features/HoldFeature.js';

export class HoldWinEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules, g = this.game.grid;
    return `${this.gridLabel()}, ${R.lines} líneas fijas. Las monedas muestran un premio. Con ${R.triggerCount} o más monedas empieza el bonus: las monedas quedan fijas y tienes ${R.respins} re-giros; cada moneda nueva los reinicia. Llena las ${g.reels * g.rows} posiciones para ganar el jackpot GRAND.`;
  }

  payUnit() { return 1 / (this.game.rules?.lines || 10); }
  coinId() { return this.game.symbols.find((s) => s.type === 'coin')?.id; }

  buildScene() {
    super.buildScene();
    this.labels = new Container();
    this.grid.fx.addChild(this.labels);
    this.hold = new HoldFeature(this);
  }

  coinLabel(coin) {
    const t = new Text({
      text: coin.jackpot ? coin.jackpot.toUpperCase() : this.hud.fmt(this.money(coin.value)),
      style: { fontFamily: this.game.theme?.font || 'Arial', fontSize: coin.jackpot ? 30 : 26, fill: coin.jackpot ? '#ff4d6d' : '#ffffff', stroke: { color: '#000000', width: 6 } },
    });
    t.anchor.set(0.5);
    const p = this.grid.cellCenter(coin.c, coin.r);
    t.position.set(p.x, p.y + this.grid.cellH(coin.c) * 0.28);
    this.labels.addChild(t);
    gsap.from(t.scale, { x: 0, y: 0, duration: 0.3, ease: 'back.out(2)' });
    return t;
  }

  onSpinStart() { this.clearLabels(); }

  clearLabels() { this.labels.removeChildren().forEach((c) => c.destroy()); }

  async playResult(result) {
    this.clearLabels();
    await this.stopReels(result.grid);
    for (const coin of result.coins) this.coinLabel(coin);
    await this.presentWins(result.wins, result.wins.reduce((a, w) => a + w.pay, 0));
    if (result.holdAndWin) await this.hold.play(result);
  }
}

export { Graphics };
