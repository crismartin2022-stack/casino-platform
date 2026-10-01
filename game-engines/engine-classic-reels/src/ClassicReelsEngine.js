// Motor 14 — CLÁSICO 3 RODILLOS (cliente): 3x3 de frutas, BAR y 7, comodín que multiplica y un
// RODILLO MULTIPLICADOR a la derecha que gira con los demás y se detiene en ×1, ×2, ×3, ×5 o ×10.
import { Container, Graphics, Text } from 'pixi.js';
import { BaseEngine, wait, gsap } from '../../shared/BaseEngine.js';

const LINE_NAMES = ['central', 'superior', 'inferior', 'diagonal ↘', 'diagonal ↗'];

export class ClassicReelsEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    const cherry = this.game.symbols.find((s) => s.cherry);
    const mv = this.multValues();
    return `3 rodillos × 3 filas, ${R.lines} ${R.lines === 1 ? 'línea' : 'líneas'} (${LINE_NAMES.slice(0, R.lines).join(', ')}). Tres iguales en una línea pagan su premio.`
      + (cherry ? ` ${cherry.name}: paga desde una en el primer rodillo.` : '')
      + (R.anyBarPay > 0 ? ' Cualquier combinación de BAR también paga.' : '')
      + (R.wildMult > 1 ? ` El COMODÍN reemplaza a todos y multiplica el premio de su línea ×${R.wildMult} (dos comodines: ×${R.wildMult ** 2}).` : ' El COMODÍN reemplaza a todos.')
      + (mv.length ? ` RODILLO MULTIPLICADOR: en cada giro se detiene en ${mv.map((v) => `×${v}`).join(', ')} y multiplica todo el premio.` : '');
  }

  multValues() {
    const M = this.game.rules?.multReel;
    if (!M?.enabled) return [];
    return [...new Set((M.values || []).map((v) => (typeof v === 'number' ? v : v.value)))].sort((a, b) => a - b);
  }

  payUnit() { return 1 / (this.game.rules?.lines || 5); }
  paySuffix() { return 'en línea'; }
  infoExtras(bet) {
    const R = this.game.rules || {};
    const out = [];
    if (R.anyBarPay > 0) out.push(['Cualquier BAR (3 en línea)', this.hud.fmt(Math.round(R.anyBarPay * this.payUnit() * bet))]);
    const mv = this.multValues();
    if (mv.length) out.push(['Rodillo multiplicador', mv.map((v) => `×${v}`).join(' · ')]);
    return out;
  }

  /** Deja lugar a la derecha para el rodillo multiplicador. */
  gridExtraCols() { return this.multValues().length ? 0.9 : 0; }

  buildScene() {
    super.buildScene();
    this.multBox = null;
    if (!this.multValues().length) return;
    const a = this.gridRect;
    const cell = a.w / 3;
    const bw = cell * 0.72, bh = a.h * 0.62;
    const box = new Container();
    box.position.set(a.x + a.w + cell * 0.12, a.y + (a.h - bh) / 2);
    const pal = this.game.theme?.palette || {};
    const bg = new Graphics().roundRect(0, 0, bw, bh, 16).fill({ color: pal.reelBg || '#3b0d18', alpha: 0.95 }).stroke({ color: pal.accent || '#ffd23f', width: 4 });
    const label = new Text({ text: 'MULTI', style: { fontFamily: this.game.theme?.font || 'Arial', fontSize: Math.max(14, bw * 0.2), fill: pal.accent || '#ffd23f' } });
    label.anchor.set(0.5, 0); label.position.set(bw / 2, 8);
    const val = new Text({ text: '×1', style: { fontFamily: this.game.theme?.font || 'Arial', fontSize: Math.max(26, bw * 0.42), fontWeight: '900', fill: '#ffffff', stroke: { color: '#000000', width: 6 } } });
    val.anchor.set(0.5); val.position.set(bw / 2, bh / 2 + 10);
    box.addChild(bg, label, val);
    this.world.addChild(box);
    this.multBox = { box, val, bg, bw, bh };
  }

  onSpinStart() {
    const m = this.multBox;
    if (!m) return;
    gsap.killTweensOf(m.val.scale);
    m.val.scale.set(1);
    const vals = this.multValues();
    let k = 0;
    clearInterval(this.multTimer);
    this.multTimer = setInterval(() => { m.val.text = `×${vals[k++ % vals.length]}`; }, this.hud?.turbo ? 45 : 70);
  }

  async stopMult(v) {
    const m = this.multBox;
    if (!m) return;
    await wait(this.hud.turbo ? 80 : 260);
    clearInterval(this.multTimer);
    m.val.text = `×${v}`;
    m.val.style.fill = v > 1 ? (this.game.theme?.palette?.accent || '#ffd23f') : '#ffffff';
    this.sound.play('reelStop');
    if (v > 1) gsap.fromTo(m.val.scale, { x: 1.8, y: 1.8 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2)' });
  }

  async playResult(result) {
    await this.stopReels(result.grid);
    await this.stopMult(result.multiplier ?? 1);
    if (!result.wins.length) return;
    // Los comodines que multiplican se anuncian sobre su línea
    const wm = Math.max(0, ...result.wins.map((w) => w.wildMult || 0));
    await this.presentWins(result.wins, result.lineWin);
    if (wm > 1) await this.hud.showBanner(`<small>COMODÍN</small><b>×${wm}</b>`, { kind: 'feature', ms: this.hud.turbo ? 600 : 1000 });
    if ((result.multiplier ?? 1) > 1) {
      this.sound.play('bigWin');
      const m = this.multBox;
      if (m) gsap.fromTo(m.box.scale, { x: 1.15, y: 1.15 }, { x: 1, y: 1, duration: 0.5, ease: 'elastic.out(1, 0.5)' });
      await this.hud.showBanner(`<small>RODILLO MULTIPLICADOR</small><b>×${result.multiplier}</b>`, { kind: 'big', ms: this.hud.turbo ? 700 : 1300 });
      this.roundWin = this.money(result.totalWin);
      this.hud.countWin(this.roundWin);
      this.flashWinText(this.roundWin);
    }
  }
}
