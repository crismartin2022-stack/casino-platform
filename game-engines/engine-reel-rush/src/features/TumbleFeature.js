// Mecánica de cascada (tumble / avalanche): explotar → caer → rellenar → repetir.
// Solo anima: los pasos (grids, premios y multiplicadores) vienen calculados del servidor.
export class TumbleFeature {
  constructor(engine) {
    this.engine = engine;
  }

  async play(steps) {
    const e = this.engine;
    for (let i = 0; i < steps.length - 1; i++) {
      const step = steps[i];
      if (!step.wins.length) break;
      if (step.multiplier > 1) e.hud.setStatus(`Cascada ${i + 1} · multiplicador ×${step.multiplier}`);
      await e.presentWins(step.wins, step.win);
      e.sound.play('tumble');
      await e.grid.explode(step.removed);
      await e.grid.cascade(steps[i + 1].grid);
    }
    e.hud.setStatus('');
  }
}
