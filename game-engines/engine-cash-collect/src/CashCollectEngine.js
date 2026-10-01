// Motor 13 — CASH COLLECT (cliente): monedas con valor en dinero sobre los rodillos; el recolector las cobra
// todas con una animación. En los giros gratis, los recolectores se cuentan y suben de nivel (más giros y ×).
import { Text, Container } from 'pixi.js';
import { BaseEngine, wait, gsap } from '../../shared/BaseEngine.js';

export class CashCollectEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    const levels = (R.fsLevels || []).map((L) => `${L.collect} recolectores: +${L.spins} giros y monedas ×${L.mult}`).join('; ');
    return `${this.gridLabel()}, ${R.lines} líneas fijas; paga de izquierda a derecha. Las MONEDAS muestran un premio en dinero pero solas no pagan: `
      + `cuando aparece un RECOLECTOR, cobra en ese mismo giro todas las monedas visibles (cada recolector las cobra de nuevo). `
      + `${R.triggerCount} o más scatters dan ${R.freeSpins} giros gratis. En los giros gratis se cuentan los recolectores y suben de nivel${levels ? ` (${levels})` : ''}.`
      + (R.buyCost ? ` También puedes comprar los giros gratis por ${R.buyCost}× la apuesta.` : '');
  }

  payUnit() { return 1 / (this.game.rules?.lines || 10); }
  infoExtras(bet) {
    const vals = (this.game.rules?.coinValues || []).map((c) => (typeof c === 'number' ? c : c?.value)).filter((x) => x > 0);
    const out = super.infoExtras(bet);
    if (vals.length) out.unshift(['Monedas', `${this.hud.fmt(Math.round(Math.min(...vals) * bet))} a ${this.hud.fmt(Math.round(Math.max(...vals) * bet))}`]);
    return out;
  }
  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  buildScene() {
    super.buildScene();
    this.labels = new Container();
    this.grid.fx.addChild(this.labels);
  }

  onSpinStart() { this.clearLabels(); }
  clearLabels() { this.labels.removeChildren().forEach((c) => c.destroy()); }

  /** Etiqueta con el valor de una moneda (ya multiplicado en los giros gratis). */
  coinLabel(coin, mult = 1) {
    const t = new Text({
      text: this.hud.fmt(this.money(coin.value * mult)),
      style: { fontFamily: this.game.theme?.font || 'Arial', fontSize: 26, fill: mult > 1 ? '#7bed9f' : '#ffffff', align: 'center', stroke: { color: '#000000', width: 6 } },
    });
    t.anchor.set(0.5);
    const p = this.grid.cellCenter(coin.c, coin.r);
    t.position.set(p.x, p.y + this.grid.cellH(coin.c) * 0.28);
    this.labels.addChild(t);
    gsap.from(t.scale, { x: 0, y: 0, duration: 0.3, ease: 'back.out(2)' });
    return t;
  }

  addWin(mult) {
    const cents = this.money(mult);
    this.flashWinText(cents);
    this.roundWin = (this.roundWin || 0) + cents;
    this.hud.countWin(this.roundWin);
  }

  /** Muestra las monedas y, si hay recolectores, las hace volar hacia cada uno y cobra. */
  async showCoins(s) {
    const labels = s.coins.map((k) => this.coinLabel(k, s.mult || 1));
    if (!s.collectors.length || !s.coins.length) return;
    await this.grid.highlight(s.collectors, { times: 1 });
    for (const [c, r] of s.collectors) {
      const target = this.grid.cellCenter(c, r);
      const flying = labels.map((l) => {
        const copy = new Text({ text: l.text, style: l.style });
        copy.anchor.set(0.5); copy.position.copyFrom(l.position);
        this.labels.addChild(copy);
        return copy;
      });
      this.sound.play('coin');
      await Promise.all(flying.map((f, i) => new Promise((res) => gsap.to(f.position, {
        x: target.x, y: target.y, duration: this.hud.turbo ? 0.25 : 0.55, delay: i * 0.05, ease: 'power2.in', onComplete: () => { f.destroy(); res(); },
      }))));
      const sum = s.coins.reduce((a, k) => a + k.value, 0) * (s.mult || 1);
      const tag = new Text({ text: `+${this.hud.fmt(this.money(sum))}`, style: { fontFamily: this.game.theme?.font || 'Arial', fontSize: 34, fill: this.game.theme?.palette?.accent || '#ffd460', stroke: { color: '#000000', width: 7 } } });
      tag.anchor.set(0.5); tag.position.set(target.x, target.y);
      this.labels.addChild(tag);
      gsap.fromTo(tag.scale, { x: 0.3, y: 0.3 }, { x: 1.15, y: 1.15, duration: 0.35, ease: 'back.out(2)' });
      this.addWin(sum);
      await wait(this.hud.turbo ? 250 : 600);
    }
  }

  async playSpin(s) {
    await this.stopReels(s.grid, { scatterId: this.scatterId() });
    const lineWin = s.wins.reduce((a, w) => a + w.pay, 0);
    await this.presentWins(s.wins, lineWin);
    await this.showCoins(s);
  }

  async playResult(result) {
    this.clearLabels();
    if (result.base) await this.playSpin(result.base);
    const fs = result.freeSpins;
    if (!fs) return;
    if (result.base) await this.grid.highlight(result.base.scatters, { times: 3 });
    else await this.grid.stop(this.randomGrid());
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), 'EL RECOLECTOR SUBE DE NIVEL');
    const levels = this.game.rules.fsLevels || [];
    let i = 0, total = fs.awarded;
    for (const s of fs.spins) {
      i++;
      const next = levels.find((L) => L.collect > (s.collected - s.collectors.length));
      this.hud.setStatus(`${this.msg('spinOf', { i, n: total })} · 🎣 ${s.collected - s.collectors.length}${next ? `/${next.collect}` : ''} · ×${s.mult}`);
      this.clearLabels();
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.playSpin(s);
      if (s.levelUp) {
        total += s.levelUp.spins;
        this.sound.play('feature');
        await this.hud.showBanner(`<small>NIVEL ${s.levelUp.level}</small><b>+${s.levelUp.spins} GIROS · MONEDAS ×${s.levelUp.mult}</b>`, { kind: 'feature', ms: 1800 });
      }
    }
    this.hud.setStatus('');
    this.clearLabels();
    await this.featureOutro(fs.totalWin);
  }
}
