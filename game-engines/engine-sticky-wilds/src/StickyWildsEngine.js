// Motor 9 — STICKY / WALKING WILDS (cliente): comodines fijos durante el bonus o que caminan dando re-giros.
import { Graphics } from 'pixi.js';
import { BaseEngine, wait } from '../../shared/BaseEngine.js';

export class StickyWildsEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    const how = R.wildMode === 'walking'
      ? 'Cada comodín que cae da un RE-GIRO gratis y se mueve un rodillo a la izquierda hasta salir de la pantalla. En los giros gratis los comodines también caminan.'
      : 'En los giros gratis, cada comodín que cae queda FIJO en su lugar hasta que termina el bonus.';
    return `${this.gridLabel()}, ${R.lines} líneas; paga de izquierda a derecha. ${how} ${R.scattersToTrigger} o más scatters dan ${R.freeSpins} giros gratis${R.fsMultiplier > 1 ? ` con premios ×${R.fsMultiplier}` : ''}.`
      + (R.fsStickyRandom > 0 ? ` Al empezar el bonus aparecen ${R.fsStickyRandom} comodines ${R.wildMode === 'walking' ? '' : 'fijos '}en posiciones al azar.` : '')
      + (R.fsExtraChance > 0 ? ` En cada giro gratis hay un ${Math.round(R.fsExtraChance * 100)} % de probabilidad de ganar +${R.fsExtraSpins || 5} giros${R.fsExtraMax > 0 ? ` (hasta ${R.fsExtraMax} ${R.fsExtraMax === 1 ? 'vez' : 'veces'} por bonus)` : ''}.` : '');
  }

  payUnit() { return 1 / (this.game.rules?.lines || 9); }
  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  buildScene() {
    super.buildScene();
    this.heldLayer = new Graphics();
    this.grid.fx.addChild(this.heldLayer);
  }

  onSpinStart() { this.heldLayer?.clear(); }

  drawHeld(keys, color) {
    const g = this.grid;
    this.heldLayer.clear();
    for (const key of keys || []) {
      const [c, r] = key.split(',').map(Number);
      if (c < 0 || c >= g.cols) continue;
      const ch = g.cellH(c);
      this.heldLayer.roundRect(c * (g.colW + g.gap) + 2, r * ch + g.gap / 2 + 2, g.colW - 4, ch - g.gap - 4, 12)
        .stroke({ color: color || this.game.theme?.palette?.accent || '#f6c667', width: 5 });
    }
  }

  async respin(s, label) {
    this.hud.setStatus(label);
    this.grid.undim();
    // Solo giran los rodillos sin comodín caminante
    const fixed = new Set(s.overlay.map((k) => Number(k.split(',')[0])));
    this.grid.startSpin(this.grid.columns.map((_, c) => c).filter((c) => !fixed.has(c)));
    await wait(this.hud.turbo ? 100 : 260);
    await this.stopReels(s.grid, { scatterId: this.scatterId() });
    this.drawHeld(s.overlay);
    await this.presentWins(s.wins, s.win);
  }

  async playResult(result) {
    await this.stopReels(result.base.grid, { scatterId: this.scatterId() });
    await this.presentWins(result.base.wins, result.base.win);
    let n = 0;
    for (const s of result.respins || []) {
      n++;
      await this.respin(s, `RE-GIRO ${n} · COMODÍN CAMINANTE`);
    }
    if (result.scatterPay > 0) {
      this.roundWin = (this.roundWin || 0) + this.money(result.scatterPay);
      this.hud.countWin(this.roundWin);
    }
    const fs = result.freeSpins;
    if (fs) {
      await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), fs.mode === 'walking' ? 'COMODINES CAMINANTES' : 'COMODINES FIJOS');
      if (fs.startWilds?.length) {
        // Los comodines al azar caen uno por uno antes del primer giro
        const wildId = this.game.symbols.find((x) => x.type === 'wild')?.id;
        for (const k of fs.startWilds) {
          const [c, r] = k.split(',').map(Number);
          this.sound.play('feature', { rate: 1.2 });
          await this.grid.replaceCell(c, r, wildId);
          this.drawHeld(fs.startWilds.slice(0, fs.startWilds.indexOf(k) + 1));
          await wait(this.hud.turbo ? 120 : 380);
        }
        await this.hud.showBanner(`<small>COMODINES ${fs.mode === 'walking' ? 'CAMINANTES' : 'FIJOS'}</small><b>${fs.startWilds.length} WILDS</b>`, { kind: 'feature', ms: 1300 });
      }
      let i = 0, total = fs.awarded;
      for (const s of fs.spins) {
        i++;
        this.hud.setStatus(`${this.msg('spinOf', { i, n: total })} · ${s.held.length} COMODINES ${fs.mode === 'walking' ? 'CAMINANDO' : 'FIJOS'}`);
        this.grid.undim();
        this.grid.startSpin();
        await wait(this.hud.turbo ? 100 : 260);
        await this.stopReels(s.grid, { scatterId: this.scatterId() });
        this.drawHeld(fs.mode === 'sticky' ? s.held : s.overlay);
        await this.presentWins(s.wins, s.win);
        if (s.extra) {
          total += s.extra;
          this.sound.play('feature');
          await this.hud.showBanner(`<small>¡GIROS EXTRA!</small><b>+${s.extra} GIROS</b>`, { kind: 'feature', ms: 1500 });
        }
      }
      this.hud.setStatus('');
      this.heldLayer.clear();
      await this.featureOutro(fs.totalWin);
    }
    this.hud.setStatus('');
  }
}
