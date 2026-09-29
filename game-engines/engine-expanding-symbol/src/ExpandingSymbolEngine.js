// Motor 8 — EXPANDING SYMBOL (cliente): libro comodín/scatter y símbolo especial que se expande en giros gratis.
import { Container, Sprite, Graphics } from 'pixi.js';
import { BaseEngine, wait, gsap } from '../../shared/BaseEngine.js';

export class ExpandingSymbolEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    const book = this.game.symbols.find((s) => s.type === 'wildscatter');
    return `${this.gridLabel()}, ${R.lines} líneas; paga de izquierda a derecha. ${book?.name || 'El libro'} es comodín y scatter a la vez: ${R.scattersToTrigger} o más en cualquier posición dan ${R.freeSpins} giros gratis con un SÍMBOLO ESPECIAL elegido al azar. En los giros gratis, si el símbolo especial aparece en suficientes rodillos, se expande a todo el rodillo y paga en todas las líneas aunque los rodillos no sean contiguos.`;
  }

  payUnit() { return 1 / (this.game.rules?.lines || 10); }
  bookId() { return this.game.symbols.find((s) => s.type === 'wildscatter')?.id; }

  buildScene() {
    super.buildScene();
    this.expandLayer = new Container();
    this.grid.fx.addChild(this.expandLayer);
  }

  onSpinStart() { this.clearExpand(); }
  clearExpand() { this.expandLayer?.removeChildren().forEach((c) => c.destroy()); }

  async expand(reels, symbolId) {
    const g = this.grid;
    this.sound.play('feature', { rate: 1.3 });
    const tweens = [];
    for (const c of reels) {
      const x = c * (g.colW + g.gap);
      const bg = new Graphics().roundRect(x, 0, g.colW, g.h, 14).fill({ color: this.game.theme?.palette?.reelBg || '#3d2710', alpha: 0.96 })
        .roundRect(x + 2, 2, g.colW - 4, g.h - 4, 12).stroke({ color: this.game.theme?.palette?.accent || '#f5cd79', width: 5 });
      const s = new Sprite(g.texture(symbolId));
      s.anchor.set(0.5);
      const k = Math.min((g.colW * 0.95) / s.texture.width, (g.h * 0.95) / s.texture.height);
      s.position.set(x + g.colW / 2, g.h / 2);
      s.scale.set(k * 0.3, k * 0.3);
      bg.alpha = 0;
      this.expandLayer.addChild(bg, s);
      tweens.push(gsap.to(bg, { alpha: 1, duration: 0.2 }).then());
      tweens.push(gsap.to(s.scale, { x: k, y: k, duration: 0.35, ease: 'back.out(1.6)' }).then());
      await wait(this.hud.turbo ? 40 : 120);
    }
    await Promise.all(tweens);
  }

  async playResult(result) {
    const b = result.base;
    await this.stopReels(b.grid, { scatterId: this.bookId() });
    await this.presentWins(b.wins, b.win);
    if (result.scatterPay > 0) {
      await this.grid.highlight(b.books, { times: 2 });
      this.roundWin = (this.roundWin || 0) + this.money(result.scatterPay);
      this.hud.countWin(this.roundWin);
    }
    const fs = result.freeSpins;
    if (!fs) return;
    await this.grid.highlight(b.books, { times: 3 });
    const sp = this.game.symbols.find((s) => s.id === fs.special);
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), `SÍMBOLO ESPECIAL: ${(sp?.name || fs.special).toUpperCase()}`);
    let i = 0;
    for (const s of fs.spins) {
      i++;
      this.hud.setStatus(`${this.msg('spinOf', { i, n: fs.spins.length })} · ESPECIAL: ${sp?.name || fs.special}`);
      this.clearExpand();
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.stopReels(s.grid, { scatterId: this.bookId() });
      await this.presentWins(s.wins, s.win - s.expandWin);
      if (s.expanded.length) {
        await this.expand(s.expanded, fs.special);
        this.flashWinText(this.money(s.expandWin));
        this.roundWin = (this.roundWin || 0) + this.money(s.expandWin);
        this.hud.countWin(this.roundWin);
        this.sound.play('bigWin');
        await wait(this.hud.turbo ? 400 : 1000);
      }
    }
    this.hud.setStatus('');
    this.clearExpand();
    await this.featureOutro(fs.totalWin);
  }
}
