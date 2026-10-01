// Motor 3 — BONUS BUY (cliente): líneas, giros gratis multiplicados con wilds fijos al azar y giros extra,
// BONUS SORPRESA en el juego base y MENÚ DE COMPRA (giros gratis, ruleta, elige un premio, colecciona, el camino).
import { Graphics } from 'pixi.js';
import { BaseEngine, wait } from '../../shared/BaseEngine.js';
import { playWheel, playPick, playCollect, playPath } from '../../shared/MiniGames.js';

const BONUS_PLAY = { wheel: playWheel, pick: playPick, collect: playCollect, path: playPath };
const BONUS_TITLE = { wheel: 'Ruleta de la fortuna', pick: 'Elige un premio', collect: 'Colecciona', path: 'El camino', free: 'Giros gratis' };

export class BonusBuyEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    const fs = R.freeSpins || {};
    const menu = this.buyOptions().map((o) => `${o.name} (${o.cost}× la apuesta)`).join(', ');
    const parts = [`${this.gridLabel()}, ${R.lines} líneas fijas; paga de izquierda a derecha.`,
      `3, 4 o 5 scatters activan ${fs['3']}, ${fs['4'] ?? fs['3']} o ${fs['5'] ?? fs['3']} giros gratis con todos los premios ×${R.fsMultiplier}.`];
    if (R.fsStickyRandom > 0) parts.push(`Al empezar los giros gratis, ${R.fsStickyRandom} comodines quedan fijos en posiciones al azar durante todo el bonus.`);
    if (R.fsExtraChance > 0) parts.push(`En cada giro gratis hay un ${Math.round(R.fsExtraChance * 100)} % de probabilidad de ganar +${R.fsExtraSpins || 5} giros extra.`);
    if (R.randomBonusChance > 0) parts.push(`BONUS SORPRESA: en cualquier giro, con ${+(R.randomBonusChance * 100).toFixed(2)} % de probabilidad se activa un bonus al azar.`);
    const M = R.bonusMenu || {};
    if (M.pick?.enabled && !M.pick.prizes?.length) parts.push(`Elige un premio: ${M.pick.picks} casillas de ${M.pick.tiles}; algunas son BONUS y valen ×${M.pick.bonusMult ?? 2}.`);
    if (M.wheel?.enabled) parts.push(`Ruleta: ${M.wheel.spins} giros; el multiplicador sube +${M.wheel.multStep} en cada giro.`);
    if (M.collect?.enabled) parts.push(`Colecciona: ${M.collect.items} objetos; moneda ×1, gema ×2, cofre ×3.`);
    if (M.path?.enabled) parts.push(`El camino: ${M.path.length} casillas; el dado avanza ${M.path.stepMin ?? 1} a ${M.path.stepMax ?? 5} y el multiplicador sube +${M.path.multStep ?? 0.2} por tirada.`);
    if (menu) parts.push(`Bonos que puedes comprar: ${menu}.`);
    return parts.join(' ');
  }

  payUnit() { return 1 / (this.game.rules?.lines || 20); }
  infoExtras(bet) { return this.buyOptions().map((o) => [`Comprar: ${o.name}`, this.hud.fmt(Math.round(o.cost * bet))]); }
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

  bonusName(type) { return this.game.rules?.bonusMenu?.[type]?.name || BONUS_TITLE[type] || 'Bonus'; }

  async playResult(result) {
    if (result.base) {
      await this.stopReels(result.base.grid, { scatterId: this.scatterId() });
      await this.presentWins(result.base.wins, result.base.win);
    }
    if (result.surprise) {
      // Bonus sorpresa: sacude la pantalla y anuncia cuál tocó
      this.sound.play('feature');
      await this.hud.showBanner(`<small>⚡ BONUS SORPRESA ⚡</small><b>${this.bonusName(result.surprise).toUpperCase()}</b>`, { kind: 'feature', ms: 2000 });
    }
    if (result.bonus) {
      await this.grid.stop(this.randomGrid());
      await this.featureIntro(this.bonusName(result.bonus.type).toUpperCase(), 'BONUS');
      await (BONUS_PLAY[result.bonus.type] || playPick)(this, result.bonus);
      this.roundWin = this.money((result.base?.win || 0) + result.bonus.totalWin);
      await this.featureOutro(result.bonus.totalWin);
      return;
    }
    const fs = result.freeSpins;
    if (!fs) return;
    if (!result.surprise && result.base?.scatters?.length) await this.grid.highlight(result.base.scatters, { times: 3 });
    else if (!result.base) await this.grid.stop(this.randomGrid());
    const sub = [fs.multiplier > 1 ? `TODOS LOS PREMIOS ×${fs.multiplier}` : '', fs.sticky ? `${fs.spins[0]?.held?.length || ''} WILDS FIJOS`.trim() : ''].filter(Boolean).join(' · ');
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), sub);
    let i = 0, total = fs.awarded;
    for (const s of fs.spins) {
      i++;
      this.hud.setStatus(`${this.msg('spinOf', { i, n: total })}${fs.multiplier > 1 ? ` · ×${fs.multiplier}` : ''}${fs.sticky ? ` · ${s.held.length} WILDS FIJOS` : ''}`);
      this.grid.undim();
      this.grid.startSpin();
      if (fs.sticky && i === 1) this.drawHeld(s.held);
      await wait(this.hud.turbo ? 100 : 260);
      await this.stopReels(s.grid, { scatterId: this.scatterId() });
      if (fs.sticky) this.drawHeld(s.held);
      await this.presentWins(s.wins, s.win);
      if (s.extra) {
        total += s.extra;
        this.sound.play('feature');
        await this.hud.showBanner(`<small>¡GIROS EXTRA!</small><b>+${s.extra} GIROS</b>`, { kind: 'feature', ms: 1500 });
      }
    }
    this.hud.setStatus('');
    this.stickyLayer.clear();
    await this.featureOutro(fs.totalWin);
  }
}
