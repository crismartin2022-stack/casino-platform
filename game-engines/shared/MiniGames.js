// Minijuegos de bonus en HTML sobre el juego: ruleta de la fortuna y "elige un premio".
// El resultado ya lo decidió el servidor; aquí solo se muestra con suspenso.
import { h } from './Hud.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ruleta: recorre los segmentos y se detiene en el que decidió el servidor, giro por giro. */
export async function playWheel(engine, bonus) {
  const hud = engine.hud;
  const cells = bonus.segments.map((v) => h('div', {}, `${v}×`));
  const status = h('p', {}, '');
  const total = h('b', {}, hud.fmt(0));
  hud.openModal(h('div', { class: 'confirm' }, h('h2', {}, 'Ruleta de la fortuna'), h('div', { class: 'wheel' }, cells), status, h('p', {}, 'Total: ', total)));
  let acc = 0;
  let pos = 0;
  for (const [i, spin] of bonus.spins.entries()) {
    status.textContent = `Giro ${i + 1} de ${bonus.spins.length} · multiplicador ×${spin.multiplier}`;
    engine.sound.play('spin');
    const laps = cells.length * 2 + ((spin.segment - pos + cells.length) % cells.length);
    for (let k = 0; k <= laps; k++) {
      cells.forEach((c, j) => c.classList.toggle('hot', j === (pos + k) % cells.length));
      await wait(hud.turbo ? 18 : 30 + (k > laps - 8 ? (k - (laps - 8)) * 25 : 0));
    }
    pos = spin.segment;
    engine.sound.play('win');
    acc += spin.win;
    total.textContent = hud.fmt(engine.money(acc));
    status.textContent = `${spin.value}× × ${spin.multiplier} = ${hud.fmt(engine.money(spin.win))}`;
    await wait(hud.turbo ? 400 : 900);
  }
  await wait(500);
  hud.modal.hidden = true;
}

/** Elige un premio: el jugador toca casillas; los premios se revelan en el orden decidido por el servidor. */
export function playPick(engine, bonus) {
  const hud = engine.hud;
  return new Promise((resolve) => {
    let k = 0, acc = 0;
    const picked = new Set();
    const left = h('p', {}, `Elige ${bonus.values.length} casillas`);
    const total = h('b', {}, hud.fmt(0));
    const tiles = [];
    bonus.tiles.forEach((_, i) => tiles.push(h('button', {
      onclick: async () => {
        if (k >= bonus.values.length || picked.has(i)) return;
        picked.add(i);
        const v = bonus.values[k++];
        acc += v;
        tiles[i].textContent = `${v}×`;
        tiles[i].classList.add('revealed');
        engine.sound.play('coin');
        total.textContent = hud.fmt(engine.money(acc));
        left.textContent = k < bonus.values.length ? `Te quedan ${bonus.values.length - k}` : '¡Listo!';
        if (k === bonus.values.length) {
          // Muestra lo que había en las demás casillas
          const others = bonus.tiles.filter((_, j) => !bonus.picked.includes(j));
          let o = 0;
          tiles.forEach((t, j) => { if (!picked.has(j)) { t.textContent = `${others[o++] ?? ''}×`; t.classList.add('other'); } });
          await wait(1600);
          hud.modal.hidden = true;
          resolve();
        }
      },
    }, '?')));
    hud.openModal(h('div', { class: 'confirm' }, h('h2', {}, 'Elige un premio'), left, h('div', { class: 'picks' }, tiles), h('p', {}, 'Total: ', total)));
    hud.modalResolve = () => resolve(); // si cierra la ventana, el premio igual está acreditado
  });
}
