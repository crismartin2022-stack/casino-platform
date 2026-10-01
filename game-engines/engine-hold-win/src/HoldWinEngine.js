// Motor 4 — HOLD & WIN (cliente): monedas con premio que quedan fijas durante los re-giros.
import { Text, Graphics, Container } from 'pixi.js';
import { BaseEngine, wait, gsap } from '../../shared/BaseEngine.js';
import { HoldFeature } from './features/HoldFeature.js';
import { playHoldPick } from './features/HoldPick.js';

const TIER_FILL = { Bronce: '#e59a58', Plata: '#e0e0e0', Oro: '#ffd700', Platino: '#ffffff', Diamante: '#b9f2ff' };

export class HoldWinEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules, g = this.game.grid;
    if (R.holdMode === 'pick') {
      const tiers = (R.coinTiers || (R.coinValues || []).filter((v) => v?.name)).map((v) => v.name).join(', ');
      const sp = { bonus: 'BONUS (premio extra)', multiplier: 'MULTIPLICADOR (multiplica las monedas)', jackpot: 'JACKPOT', reset: 'RESET (las rondas vuelven a empezar)', extra_round: '+1 RONDA' };
      const jc = (R.jackpotCounts || []).map((t) => `${t.count} fijas: ${t.jackpot.toUpperCase()}`).join(', ');
      return `${this.gridLabel()}, ${R.lines} líneas fijas. Con ${R.triggerCount} o más monedas empieza el bonus ELIGE Y FIJA: las monedas quedan fijas y tienes ${R.rounds} rondas. `
        + `En cada ronda aparecen monedas misteriosas y tú eliges cuál fijar; al fijarla se revela${tiers ? ` (${tiers}` : ''}${R.pickSpecials?.length ? ` o un especial: ${R.pickSpecials.map((x) => sp[x.type]).filter(Boolean).join(', ')}` : ''}${tiers ? ')' : ''}. `
        + (R.holdGrowth > 0 ? `Cada moneda nueva hace crecer +${Math.round(R.holdGrowth * 100)} % las monedas ya fijas. ` : '')
        + (jc ? `Jackpots por posiciones fijas: ${jc}. ` : '') + `Llena las ${g.reels * g.rows} posiciones para ganar el GRAND. El premio de cada moneda lo decide el servidor: la casilla que elijas no cambia el resultado.`;
    }
    return `${this.gridLabel()}, ${R.lines} líneas fijas. Las monedas muestran un premio. Con ${R.triggerCount} o más monedas empieza el bonus: las monedas quedan fijas y tienes ${R.respins} re-giros; cada moneda nueva los reinicia. Llena las ${g.reels * g.rows} posiciones para ganar el jackpot GRAND.${R.specialCoins?.length ? ' Durante el bonus pueden caer monedas especiales: MULTIPLICADORAS (multiplican el total de monedas) y +1 GIRO (dan un re-giro extra).' : ''}`;
  }

  payUnit() { return 1 / (this.game.rules?.lines || 10); }
  infoExtras(bet) {
    const J = this.game.rules?.jackpots || {};
    const vals = (this.game.rules?.coinValues || []).map((c) => (typeof c === 'number' ? c : c?.value)).filter((x) => x > 0);
    const out = ['mini', 'minor', 'major', 'grand'].filter((k) => J[k]).map((k) => [`Jackpot ${k.toUpperCase()}`, this.hud.fmt(Math.round(J[k] * bet))]);
    if (vals.length) out.unshift(['Monedas', `${this.hud.fmt(Math.round(Math.min(...vals) * bet))} a ${this.hud.fmt(Math.round(Math.max(...vals) * bet))}`]);
    return out;
  }
  coinId() { return this.game.symbols.find((s) => s.type === 'coin')?.id; }

  buildScene() {
    super.buildScene();
    this.labels = new Container();
    this.grid.fx.addChild(this.labels);
    this.hold = new HoldFeature(this);
  }

  coinLabel(coin) {
    const t = new Text({
      text: coin.special === 'multiplier' ? `×${coin.mult}` : coin.jackpot ? coin.jackpot.toUpperCase()
        : `${this.hud.fmt(this.money(coin.value))}${coin.special === 'respin' ? '\n+1 GIRO' : ''}`,
      style: { fontFamily: this.game.theme?.font || 'Arial', fontSize: coin.jackpot ? 30 : 26, fill: coin.tier && TIER_FILL[coin.tier] ? TIER_FILL[coin.tier] : coin.special === 'multiplier' ? '#7bed9f' : coin.special === 'respin' ? '#70a1ff' : coin.jackpot ? '#ff4d6d' : '#ffffff', align: 'center', stroke: { color: '#000000', width: 6 } },
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
    if (result.holdAndWin?.mode === 'pick') {
      await this.grid.highlight(result.coins.map((k) => [k.c, k.r]), { times: 2 });
      await this.featureIntro(this.msg('holdWin'), `${result.coins.length} MONEDAS · ELIGE Y FIJA`);
      await playHoldPick(this, result);
      await this.featureOutro(result.holdAndWin.win);
    } else if (result.holdAndWin) await this.hold.play(result);
  }
}

export { Graphics };
