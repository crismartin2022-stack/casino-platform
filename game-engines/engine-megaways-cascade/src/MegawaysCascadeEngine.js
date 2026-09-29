// Motor 10 — MEGAWAYS CASCADA (cliente): cascadas con multiplicador +0,5 y símbolos misterio.
import { BaseEngine, wait } from '../../shared/BaseEngine.js';

export class MegawaysCascadeEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules, n = this.game.grid.reels, max = this.game.grid.rowsMax || 7;
    return `${n} rodillos que muestran de 2 a ${max} símbolos: hasta ${(max ** n).toLocaleString('es')} formas de ganar. Los símbolos ganadores caen y el multiplicador sube +${R.cascadeStep} con cada cascada. Los símbolos MISTERIO se revelan todos como el mismo símbolo. ${R.scattersToTrigger} o más scatters dan ${R.freeSpins} giros gratis (+${R.extraSpinsPerScatter} por cada scatter extra)${R.fsKeepMultiplier ? ' donde el multiplicador no se reinicia entre giros' : ''}.`;
  }

  gridRows() { return Array(this.game.grid.reels).fill(4); }
  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  async reveal(step) {
    if (!step.revealed) return;
    const tasks = [];
    step.raw.forEach((col, c) => col.forEach((sid, r) => { if (sid !== step.grid[c][r]) tasks.push(this.grid.replaceCell(c, r, step.grid[c][r])); }));
    this.sound.play('feature', { rate: 1.4 });
    await Promise.all(tasks);
    await wait(this.hud.turbo ? 80 : 200);
  }

  async showSpin(spin, label = '') {
    const first = spin.steps[0];
    await this.stopReels(first.raw, { scatterId: this.scatterId() });
    for (let i = 0; i < spin.steps.length; i++) {
      const st = spin.steps[i];
      this.hud.setStatus(`${label}${st.ways.toLocaleString('es')} FORMAS · ×${st.multiplier}`);
      await this.reveal(st);
      if (!st.wins.length) break;
      await this.presentWins(st.wins, st.win);
      this.sound.play('tumble');
      await this.grid.explode(st.removed);
      await this.grid.cascade(spin.steps[i + 1].raw);
    }
  }

  async playResult(result) {
    await this.showSpin(result.base);
    const fs = result.freeSpins;
    if (!fs) { this.hud.setStatus(''); return; }
    await this.grid.highlight(result.base.scatters, { times: 3 });
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), 'EL MULTIPLICADOR NO SE REINICIA');
    let i = 0;
    for (const s of fs.spins) {
      i++;
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.showSpin(s, `GIRO GRATIS ${i}/${fs.spins.length} · `);
    }
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
  }
}
