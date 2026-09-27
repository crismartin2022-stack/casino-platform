// Motor 1 — REEL RUSH (cliente): anima las cascadas que calculó el servidor.
import { BaseEngine, wait } from '../../shared/BaseEngine.js';
import { TumbleFeature } from './features/TumbleFeature.js';

export class ReelRushEngine extends BaseEngine {
  static rulesText = '243 formas de ganar: paga el mismo símbolo en rodillos consecutivos desde la izquierda. Los símbolos ganadores explotan y caen nuevos (cascada); cada cascada sube el multiplicador.';

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
