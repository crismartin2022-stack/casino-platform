// Motor 6 — CLUSTER PAYS (cliente): grupos que explotan y cascadas con multiplicador.
import { BaseEngine, wait } from '../../shared/BaseEngine.js';
import { TumbleFeature } from '../../engine-reel-rush/src/features/TumbleFeature.js';

export class ClusterPaysEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    return `${this.gridLabel()}. Paga por grupos de ${R.minCluster} o más símbolos iguales que se tocan en horizontal o vertical (no en diagonal); el comodín se une a cualquier grupo. Cuanto más grande el grupo, mayor el premio. Los grupos ganadores explotan, caen símbolos nuevos y el multiplicador sube con cada cascada (${R.cascadeMultipliers.map((m) => `×${m}`).join(', ')}).`;
  }

  /** En la tabla de pagos, las cantidades son tamaños de grupo ("12+" = 12 o más). */
  payLabel(n, keys) { return Number(n) === Math.max(...keys.map(Number)) ? `${n}+` : `${n}`; }

  async init(p) {
    await super.init(p);
    this.tumble = new TumbleFeature(this);
  }

  async playResult(result) {
    await this.stopReels(result.steps[0].grid);
    await this.tumble.play(result.steps);
    await wait(60);
  }
}
