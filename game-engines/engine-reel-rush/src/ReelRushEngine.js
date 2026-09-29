// Motor 1 — REEL RUSH (cliente): anima las cascadas que calculó el servidor.
import { BaseEngine, wait } from '../../shared/BaseEngine.js';
import { TumbleFeature } from './features/TumbleFeature.js';

export class ReelRushEngine extends BaseEngine {
  rulesText() {
    const g = this.game.grid;
    const ways = g.rows ** g.reels;
    return `${this.gridLabel()}, ${ways.toLocaleString('es')} formas de ganar: paga el mismo símbolo en rodillos consecutivos desde la izquierda. Los símbolos ganadores explotan y caen nuevos (cascada); cada cascada sube el multiplicador (${this.game.rules.cascadeMultipliers.map((m) => `×${m}`).join(', ')}).`;
  }

  async init(p) {
    await super.init(p);
    this.tumble = new TumbleFeature(this);
  }

  async playResult(result) {
    await this.stopReels(result.steps[0].grid);
    await this.tumble.play(result.steps);
    await wait(80);
  }
}
