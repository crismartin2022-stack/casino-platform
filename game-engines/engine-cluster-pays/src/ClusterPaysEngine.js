// Motor 6 — CLUSTER PAYS (cliente): grupos que explotan, cascadas con multiplicador, CASILLAS DORADAS
// (se marcan al explotar y luego multiplican ×2, ×4, ×8…) y giros gratis donde las casillas no se borran.
import { Graphics, Text, Container } from 'pixi.js';
import { BaseEngine, wait, gsap } from '../../shared/BaseEngine.js';

export class ClusterPaysEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    const parts = [`${this.gridLabel()}. Paga por grupos de ${R.minCluster} o más símbolos iguales que se tocan en horizontal o vertical (no en diagonal); el comodín se une a cualquier grupo. Cuanto más grande el grupo, mayor el premio. Los grupos ganadores explotan, caen símbolos nuevos y el multiplicador sube con cada cascada (${R.cascadeMultipliers.map((m) => `×${m}`).join(', ')}).`];
    if (R.spotStart >= 2) parts.push(`CASILLAS DORADAS: donde explota un símbolo la casilla queda marcada; si vuelve a explotar ahí se vuelve ×${R.spotStart} y se duplica cada vez (hasta ×${R.spotMax}). Un grupo que toca casillas doradas se multiplica por la suma de sus valores.`);
    if (R.freeSpins) {
      const t = Object.entries(R.freeSpins).map(([k, v]) => `${k}: ${v}`).join(', ');
      parts.push(`${R.scattersToTrigger} o más scatters dan giros gratis (${t})${R.fsKeepSpots !== false && R.spotStart >= 2 ? ' donde las casillas doradas NO se borran entre giros' : ''}.`);
    }
    if (R.buyCost) parts.push(`También puedes comprar los giros gratis por ${R.buyCost}× la apuesta.`);
    return parts.join(' ');
  }

  /** En la tabla de pagos, las cantidades son tamaños de grupo ("12+" = 12 o más). */
  payLabel(n, keys) { return Number(n) === Math.max(...keys.map(Number)) ? `${n}+` : `${n}`; }
  scatterId() { return this.game.symbols.find((s) => s.type === 'scatter')?.id; }

  buildScene() {
    super.buildScene();
    this.spotLayer = new Container();
    // Debajo de los símbolos (encima de los recuadros de celda)
    const idx = this.grid.children?.indexOf?.(this.grid.bg) ?? -1;
    if (idx >= 0 && this.grid.addChildAt) this.grid.addChildAt(this.spotLayer, idx + 1);
    else this.grid.fx.addChild(this.spotLayer);
    // Los valores ×N van encima de los símbolos
    this.spotLabels = new Container();
    this.grid.fx.addChild(this.spotLabels);
  }

  onSpinStart() { if (!this.inFs) this.drawSpots(null); }

  /** Dibuja las casillas doradas: marcadas (brillo tenue) y con multiplicador (dorado con ×N). */
  drawSpots(spots, pulse = null) {
    this.spotLayer.removeChildren().forEach((c) => c.destroy());
    this.spotLabels.removeChildren().forEach((c) => c.destroy());
    if (!spots) return;
    const g = this.grid;
    const accent = this.game.theme?.palette?.accent || '#ffd460';
    const gfx = new Graphics();
    const frames = new Graphics();
    this.spotLayer.addChild(gfx);
    this.spotLabels.addChild(frames);
    spots.forEach((col, c) => col.forEach((v, r) => {
      if (!v) return;
      const ch = g.cellH(c);
      const x = c * (g.colW + g.gap), y = r * ch + g.gap / 2;
      if (v === 1) {
        gfx.roundRect(x + 2, y + 2, g.colW - 4, ch - g.gap - 4, 10).fill({ color: '#ffd700', alpha: 0.25 });
        frames.roundRect(x + 3, y + 3, g.colW - 6, ch - g.gap - 6, 10).stroke({ color: '#ffd700', width: 2, alpha: 0.7 });
      } else {
        gfx.roundRect(x + 2, y + 2, g.colW - 4, ch - g.gap - 4, 10).fill({ color: '#ffb300', alpha: 0.55 });
        frames.roundRect(x + 2, y + 2, g.colW - 4, ch - g.gap - 4, 10).stroke({ color: accent, width: 4 });
        const t = new Text({ text: `×${v}`, style: { fontFamily: this.game.theme?.font || 'Arial', fontSize: Math.max(14, Math.min(26, ch * 0.3)), fill: '#fff6c2', stroke: { color: '#7a4a00', width: 5 } } });
        t.anchor.set(1, 0);
        t.position.set(x + g.colW - 3, y + 1);
        this.spotLabels.addChild(t);
        if (pulse?.has(`${c},${r}`)) gsap.from(t.scale, { x: 2, y: 2, duration: 0.4, ease: 'back.out(2)' });
      }
    }));
  }

  async playSteps(steps) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.spots) this.drawSpots(step.spots);
      if (!step.wins.length || i === steps.length - 1) break;
      const status = [];
      if (step.multiplier > 1) status.push(`Cascada ${i + 1} · ×${step.multiplier}`);
      const sm = step.wins.reduce((a, w) => a + (w.spotMult || 0), 0);
      if (status.length) this.hud.setStatus(`${this.fsLabel || ''}${status.join(' · ')}`);
      if (sm > 0) {
        this.sound.play('feature', { rate: 1.3 });
        await this.hud.showBanner(`<small>CASILLAS DORADAS</small><b>×${sm}</b>`, { kind: 'feature', ms: this.hud.turbo ? 600 : 1100 });
      }
      await this.presentWins(step.wins, step.win);
      this.sound.play('tumble');
      await this.grid.explode(step.removed);
      // Las casillas que explotaron se marcan o suben su multiplicador
      const next = steps[i + 1];
      if (next?.spots) {
        const changed = new Set();
        next.spots.forEach((col, c) => col.forEach((v, r) => { if (v !== step.spots[c][r] && v >= 2) changed.add(`${c},${r}`); }));
        this.drawSpots(next.spots, changed);
      }
      await this.grid.cascade(next.grid);
    }
    this.hud.setStatus((this.fsLabel || '').replace(/ · $/, ''));
  }

  async playResult(result) {
    this.inFs = false;
    this.fsLabel = '';
    if (result.steps) {
      await this.stopReels(result.steps[0].grid, { scatterId: this.scatterId() });
      await this.playSteps(result.steps);
    }
    const fs = result.freeSpins;
    if (!fs) { await wait(60); return; }
    if (result.steps) {
      const sid = this.scatterId();
      const last = result.steps[result.steps.length - 1].grid;
      const pos = [];
      last.forEach((col, c) => col.forEach((x, r) => { if (x === sid) pos.push([c, r]); }));
      if (pos.length) await this.grid.highlight(pos, { times: 3 });
    } else await this.grid.stop(this.randomGrid());
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), this.game.rules.spotStart >= 2 && this.game.rules.fsKeepSpots !== false ? 'LAS CASILLAS DORADAS NO SE BORRAN' : '¡BONUS!');
    this.inFs = true;
    this.drawSpots(null);
    let i = 0, total = fs.awarded;
    for (const s of fs.spins) {
      i++;
      this.fsLabel = `${this.msg('spinOf', { i, n: total })} · `;
      this.hud.setStatus(this.fsLabel.slice(0, -3));
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.stopReels(s.steps[0].grid, { scatterId: this.scatterId() });
      await this.playSteps(s.steps);
      if (s.retrigger) {
        total += s.retrigger;
        this.sound.play('feature');
        await this.hud.showBanner(`<small>¡MÁS GIROS!</small><b>+${s.retrigger}</b>`, { kind: 'feature', ms: 1400 });
      }
    }
    this.inFs = false;
    this.fsLabel = '';
    this.hud.setStatus('');
    await this.featureOutro(fs.totalWin);
    this.drawSpots(null);
  }
}
