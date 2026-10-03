// Motor 19 — TORMENTA DE ORBES (cliente): paga en cualquier lugar con cascadas y orbes; en los giros gratis un
// multiplicador global que crece con cada orbe. Compra del bonus en dos niveles. Todo lo calcula el servidor.
import { wait } from '../../shared/BaseEngine.js';
import { ScatterPaysEngine } from '../../engine-scatter-pays/src/ScatterPaysEngine.js';

export class OrbStormEngine extends ScatterPaysEngine {
  rulesText() {
    const R = this.game.rules;
    const v = (R.multiplierValues || []).map((m) => m.value ?? m);
    return `${this.gridLabel()}. Paga con 8 o más símbolos iguales en cualquier posición; los ganadores desaparecen y caen nuevos (cascada). Los ORBES traen un multiplicador de ×${Math.min(...v)} a ×${Math.max(...v)}: en el juego base, si el giro tuvo premio, se suman y lo multiplican. `
      + `${R.scattersToTrigger} o más rayos dan ${R.freeSpins} giros gratis con un MULTIPLICADOR GLOBAL que empieza en ×${R.fsStartMult} y crece con cada orbe que cae: todos los premios se multiplican por él`
      + (R.retrigger ? ` (${R.retriggerScatters} rayos durante el bonus dan +${R.retrigger} giros)` : '') + '. '
      + (R.buyCost ? `Compra de giros gratis por ${R.buyCost}× la apuesta` : '')
      + (R.superCost ? ` o SÚPER giros gratis (el multiplicador global empieza en ×${R.superStartMult}) por ${R.superCost}× la apuesta` : '') + '. '
      + `Premio máximo: ${R.maxWin}× la apuesta.`;
  }

  costFor(mode) {
    const R = this.game.rules || {};
    if (mode === 'buy-super') return R.superCost || 1;
    return super.costFor(mode);
  }

  buyOptions() {
    const R = this.game.rules || {};
    const out = [];
    if (R.buyCost) out.push({ mode: 'buy', name: `Giros gratis (multiplicador desde ×${R.fsStartMult})`, cost: R.buyCost });
    if (R.superCost) out.push({ mode: 'buy-super', name: `Súper giros gratis (multiplicador desde ×${R.superStartMult})`, cost: R.superCost });
    return out;
  }

  infoExtras(bet) { return this.buyOptions().map((o) => [`Comprar: ${o.name}`, this.hud.fmt(Math.round(o.cost * bet))]); }

  async playResult(result) {
    if (result.base) {
      await this.showSequence(result.base);
      if (result.scatterPay > 0) {
        this.roundWin = (this.roundWin || 0) + this.money(result.scatterPay);
        this.hud.countWin(this.roundWin);
      }
    } else {
      await this.grid.stop(this.randomGrid());
    }
    const fs = result.freeSpins;
    if (!fs) return;
    if (result.base) await this.grid.highlight(result.base.scatters, { times: 3 });
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), `MULTIPLICADOR GLOBAL DESDE ×${fs.startMult}`);
    let i = 0, total = fs.awarded, mult = fs.startMult;
    for (const s of fs.spins) {
      i++;
      this.hud.setStatus(`${this.msg('spinOf', { i, n: total })} · MULTIPLICADOR GLOBAL ×${mult}`);
      this.clearMults();
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      // La secuencia se muestra sin el cartel del multiplicador del giro: aquí manda el global
      await this.showSequence({ ...s, applied: 1, win: s.baseWin });
      if (s.orbsAdded > 0) {
        mult = s.globalMult;
        this.sound.play('coin');
        await this.hud.showBanner(`<small>+${s.orbsAdded} AL MULTIPLICADOR</small><b>×${mult}</b>`, { kind: 'feature', ms: this.hud.turbo ? 500 : 1000 });
      }
      if (s.baseWin > 0 && s.globalMult > 1) {
        this.sound.play('bigWin');
        this.roundWin = (this.roundWin || 0) + this.money(s.win - s.baseWin);
        this.hud.countWin(this.roundWin);
        this.flashWinText(this.money(s.win));
      }
      this.hud.setStatus(`${this.msg('spinOf', { i, n: total })} · MULTIPLICADOR GLOBAL ×${mult}`);
      if (s.retrigger) {
        total += s.retrigger;
        await this.grid.highlight(s.scatters, { times: 2 });
        this.sound.play('feature');
        await this.hud.showBanner(`<small>¡MÁS GIROS!</small><b>+${s.retrigger}</b>`, { kind: 'feature', ms: 1300 });
      }
    }
    if (fs.maxReached) await this.hud.showBanner(`<small>PREMIO MÁXIMO</small><b>${this.game.rules.maxWin}×</b>`, { kind: 'big', ms: 1800 });
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
  }
}
