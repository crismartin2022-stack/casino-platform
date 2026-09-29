// Bonus Hold & Win: bloquea monedas, anima re-giros celda por celda y cobra al final.
import { Graphics } from 'pixi.js';
import { gsap } from 'gsap';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class HoldFeature {
  constructor(engine) {
    this.engine = engine;
    this.frames = new Graphics();
    engine.grid.fx.addChild(this.frames);
  }

  lockFrame(c, r) {
    const g = this.engine.grid;
    const ch = g.cellH(c);
    this.frames.roundRect(c * (g.colW + g.gap) + 3, r * ch + 3, g.colW - 6, ch - 6, 12)
      .stroke({ color: this.engine.game.theme?.palette?.accent || '#ffd460', width: 5 });
  }

  async play(result) {
    const e = this.engine;
    const g = e.grid;
    const coinId = e.coinId();
    const hw = result.holdAndWin;
    const held = new Set(result.coins.map((k) => `${k.c},${k.r}`));
    await g.highlight(result.coins.map((k) => [k.c, k.r]), { times: 2 });
    await e.featureIntro(e.msg('holdWin'), `${result.coins.length} MONEDAS · 3 RE-GIROS`);
    this.frames.clear();
    for (const k of result.coins) this.lockFrame(k.c, k.r);
    // Las celdas libres se oscurecen
    g.columns.forEach((col, c) => col.sprites.forEach((s, r) => { if (s && !held.has(`${c},${r}`)) gsap.to(s, { alpha: 0.18, duration: 0.3 }); }));

    for (const step of hw.respins) {
      e.hud.setStatus(e.msg('respins', { n: step.respinsLeft }));
      // Parpadeo de las celdas libres simulando el re-giro
      const free = [];
      g.columns.forEach((col, c) => col.sprites.forEach((s, r) => { if (s && !held.has(`${c},${r}`)) free.push(s); }));
      e.sound.play('spin', { rate: 1.3 });
      await Promise.all(free.map((s) => gsap.fromTo(s, { alpha: 0.5 }, { alpha: 0.18, duration: e.hud.turbo ? 0.2 : 0.45 }).then()));
      for (const coin of step.landed) {
        held.add(`${coin.c},${coin.r}`);
        e.sound.play('coin');
        await g.replaceCell(coin.c, coin.r, coinId);
        this.lockFrame(coin.c, coin.r);
        e.coinLabel(coin);
        await wait(e.hud.turbo ? 60 : 180);
      }
      await wait(e.hud.turbo ? 150 : 350);
    }
    if (hw.multiplier > 1) await e.hud.showBanner(`<small>MONEDAS MULTIPLICADORAS</small><b>×${hw.multiplier}</b>`, { kind: 'big', ms: 1500 });
    if (hw.full) await e.hud.showBanner('<small>¡PANTALLA COMPLETA!</small><b>GRAND</b>', { kind: 'big', ms: 2500 });
    e.hud.setStatus('');
    this.frames.clear();
    g.undim();
    await e.featureOutro(hw.win);
  }
}
