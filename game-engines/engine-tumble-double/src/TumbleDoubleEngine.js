// Motor 17 — CASCADA QUE DUPLICA (cliente): cascadas con multiplicador que se duplica en cada caída ganadora;
// en los giros gratis el multiplicador sigue de giro en giro. Todo lo calcula el servidor: aquí solo se anima.
import { BaseEngine, wait } from '../../shared/BaseEngine.js';

export class TumbleDoubleEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    const g = this.game.grid;
    const fs = Object.entries(R.freeSpins || {}).sort((a, b) => a[0] - b[0]).map(([n, s]) => `${n} → ${s} giros`).join(', ');
    return `${this.gridLabel()}, ${(g.rows ** g.reels).toLocaleString('es')} formas de ganar: paga el mismo símbolo en rodillos consecutivos desde la izquierda. Los ganadores explotan y caen nuevos: el multiplicador empieza en ×${R.multStart} y se multiplica ×${R.multFactor} con cada cascada ganadora (tope ×${R.multMax}). `
      + `${R.scattersToTrigger} o más scatters dan giros gratis (${fs}): ahí el multiplicador NO se reinicia entre giros y puede llegar a ×${R.fsMultMax}.`
      + (R.retrigger ? ` ${R.retriggerScatters} scatters durante el bonus suman ${R.retrigger} giros.` : '')
      + (R.buyCost ? ` Puedes comprar los giros gratis por ${R.buyCost}× la apuesta.` : '');
  }

  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  async showSpin(spin, label = '') {
    await this.stopReels(spin.steps[0].grid, { scatterId: this.scatterId() });
    for (let i = 0; i < spin.steps.length - 1; i++) {
      const st = spin.steps[i];
      if (!st.wins.length) break;
      this.hud.setStatus(`${label}MULTIPLICADOR ×${st.multiplier}`);
      if (st.multiplier > 1 && i > 0) this.sound.play('feature', { rate: Math.min(2, 1 + i * 0.12) });
      await this.presentWins(st.wins, st.win);
      this.sound.play('tumble');
      await this.grid.explode(st.removed);
      await this.grid.cascade(spin.steps[i + 1].grid);
    }
    const last = spin.steps.at(-1);
    this.hud.setStatus(label ? `${label}MULTIPLICADOR ×${spin.multEnd ?? last.multiplier}` : '');
  }

  async playResult(result) {
    if (result.base) await this.showSpin(result.base);
    else await this.grid.stop(this.randomGrid());
    const fs = result.freeSpins;
    if (!fs) { this.hud.setStatus(''); return; }
    if (result.base) await this.grid.highlight(result.base.scatters, { times: 3 });
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), 'EL MULTIPLICADOR SE DUPLICA Y NO SE REINICIA');
    let i = 0, total = fs.awarded;
    for (const s of fs.spins) {
      i++;
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.showSpin(s, `${this.msg('spinOf', { i, n: total })} · `);
      if (s.retrigger) {
        total += s.retrigger;
        await this.grid.highlight(s.scatters, { times: 2 });
        this.sound.play('feature');
        await this.hud.showBanner(`<small>¡MÁS GIROS!</small><b>+${s.retrigger}</b>`, { kind: 'feature', ms: 1300 });
      }
    }
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
  }
}
