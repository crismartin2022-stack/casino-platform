// Motor 5 — COLOSSAL REELS (cliente): símbolos gigantes 2x2 / 3x3 con entrada en pseudo-3D
// (perspectiva, sombra y sacudida de cámara) sobre PixiJS. En giros gratis siempre cae un colosal.
import { Sprite, Graphics, Container } from 'pixi.js';
import { BaseEngine, wait, gsap } from '../../shared/BaseEngine.js';

export class ColossalEngine extends BaseEngine {
  rulesText() {
    const g = this.game.grid;
    const sizes = [...new Set((this.game.rules.colossalSizes || []).map((s) => `${s.size}×${s.size}`))].join(' o ');
    return `${this.gridLabel()}, ${(g.rows ** g.reels).toLocaleString('es')} formas de ganar. En cualquier giro pueden caer símbolos COLOSALES de ${sizes} que cuentan como un bloque de símbolos iguales. 3 o más rayos dan giros gratis${this.fsColossalText()}.`;
  }

  /** Texto según la regla: colosal garantizado (1), con probabilidad o sin colosales en los giros gratis. */
  fsColossalText() {
    const c = this.game.rules.fsColossalChance ?? 1;
    return c >= 1 ? ' con un colosal garantizado en cada giro' : c > 0 ? ` con ${Math.round(c * 100)} % de probabilidad de colosal en cada giro` : '';
  }

  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  buildScene() {
    super.buildScene();
    this.colossalLayer = new Container();
    this.grid.fx.addChild(this.colossalLayer);
  }

  onSpinStart() { this.clearColossal(); }

  clearColossal() {
    this.colossalLayer.removeChildren().forEach((c) => c.destroy());
  }

  /** El bloque colosal se dibuja como un solo sprite grande encima de sus celdas. */
  async showColossal(col) {
    if (!col) return;
    const g = this.grid;
    const ch = g.cellH(col.col);
    const x = col.col * (g.colW + g.gap);
    const y = col.row * ch;
    const w = col.size * g.colW + (col.size - 1) * g.gap;
    const hgt = col.size * ch;
    for (let c = col.col; c < col.col + col.size; c++) for (let r = col.row; r < col.row + col.size; r++) {
      const s = g.getSprite(c, r);
      if (s) s.visible = false;
    }
    const frame = new Graphics()
      .roundRect(x + 4, y + 4, w - 8, hgt - 8, 18).fill({ color: this.game.theme?.palette?.reelBg || '#1c2033', alpha: 0.92 })
      .roundRect(x + 4, y + 4, w - 8, hgt - 8, 18).stroke({ color: this.game.theme?.palette?.accent || '#f1c40f', width: 6 });
    const shadow = new Sprite(g.texture(col.symbol));
    const spr = new Sprite(g.texture(col.symbol));
    for (const s of [shadow, spr]) {
      s.anchor.set(0.5);
      const k = Math.min((w * 0.9) / s.texture.width, (hgt * 0.9) / s.texture.height);
      s.scale.set(k);
      s.baseScale = k;
      s.position.set(x + w / 2, y + hgt / 2);
    }
    shadow.tint = 0x000000;
    shadow.alpha = 0.45;
    shadow.position.x += 10; shadow.position.y += 14;
    this.colossalLayer.addChild(frame, shadow, spr);

    // Entrada: cae desde "la cámara" con perspectiva (skew + escala) y sacude la mesa.
    const k = spr.baseScale;
    spr.scale.set(k * 2.4);
    spr.skew.set(0.25, -0.1);
    spr.alpha = 0;
    shadow.alpha = 0;
    this.sound.play('feature', { rate: 1.2 });
    await gsap.to(spr, { alpha: 1, duration: 0.15 }).then();
    await Promise.all([
      gsap.to(spr.scale, { x: k, y: k, duration: 0.45, ease: 'power3.in' }).then(),
      gsap.to(spr.skew, { x: 0, y: 0, duration: 0.45, ease: 'power3.in' }).then(),
    ]);
    gsap.to(shadow, { alpha: 0.45, duration: 0.2 });
    await this.shake(col.size === 3 ? 14 : 8);
    if (this.game.theme?.render3d !== false) {
      gsap.to(spr.scale, { x: k * 1.04, y: k * 0.98, duration: 1.2, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }
  }

  async shake(px) {
    const w = this.world;
    const ox = w.x, oy = w.y;
    const tl = gsap.timeline();
    for (let i = 0; i < 6; i++) tl.to(w, { x: ox + (Math.random() - 0.5) * px, y: oy + (Math.random() - 0.5) * px, duration: 0.04 });
    tl.to(w, { x: ox, y: oy, duration: 0.06 });
    await tl.then();
  }

  async showSpin(s) {
    this.clearColossal();
    await this.stopReels(s.grid, { scatterId: this.scatterId() });
    await this.showColossal(s.colossal);
    if (s.wins.length) {
      // Las celdas del colosal están ocultas; el marco de premio igual se dibuja en su lugar.
      await this.presentWins(s.wins, s.win);
    }
  }

  async playResult(result) {
    await this.showSpin(result.base);
    const fs = result.freeSpins;
    if (!fs) return;
    await this.grid.highlight(result.base.scatters, { times: 3 });
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), (this.game.rules.fsColossalChance ?? 1) >= 1 ? 'COLOSAL GARANTIZADO' : 'SÍMBOLOS COLOSALES');
    let i = 0;
    for (const s of fs.spins) {
      i++;
      this.hud.setStatus(this.msg('spinOf', { i, n: fs.spins.length }));
      this.clearColossal();
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.showSpin(s);
    }
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
  }
}
