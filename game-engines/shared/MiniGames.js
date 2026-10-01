// Minijuegos de bonus en HTML sobre el juego: ruleta, "elige un premio", colecciona, el camino y cofres.
// El resultado ya lo decidió el servidor; aquí solo se muestra con suspenso.
import { h } from './Hud.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WHEEL_FILL = { red: '#c0392b', black: '#1b1b1f', green: '#1e8449' };
const TYPE_ICON = { coin: '🪙', gem: '💎', chest: '🧰', multiplier: '✖️', bonus: '⭐', free_spin: '🎁' };

/** Ruleta de la fortuna: una rueda de verdad (SVG) que gira y se detiene en el segmento que decidió el servidor. */
export async function playWheel(engine, bonus) {
  const hud = engine.hud;
  const segs = bonus.segmentsInfo || bonus.segments.map((v) => ({ value: v }));
  const n = segs.length;
  const pal = engine.game.theme?.palette || {};
  const alt = [pal.primary || '#6c3fc5', pal.secondary || '#2a1650'];
  const R = 100, step = (2 * Math.PI) / n;
  let paths = '';
  segs.forEach((sg, i) => {
    const a0 = i * step - Math.PI / 2, a1 = a0 + step, am = a0 + step / 2;
    const fill = WHEEL_FILL[sg.color] || alt[i % 2];
    paths += `<path d="M0 0 L${R * Math.cos(a0)} ${R * Math.sin(a0)} A${R} ${R} 0 0 1 ${R * Math.cos(a1)} ${R * Math.sin(a1)} Z" fill="${fill}" stroke="${pal.accent || '#ffd460'}" stroke-width="1.5"/>`;
    const tx = 64 * Math.cos(am), ty = 64 * Math.sin(am), deg = (am * 180) / Math.PI + 90;
    paths += `<text x="${tx}" y="${ty}" transform="rotate(${deg} ${tx} ${ty})" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="${n > 10 ? 10 : 12}" font-weight="900">${esc(hud.fmt(engine.money(sg.value)))}</text>`;
  });
  const disc = h('div', { class: 'wheel-disc' });
  disc.innerHTML = `<svg viewBox="-104 -104 208 208"><circle r="103" fill="${pal.accent || '#ffd460'}"/>${paths}<circle r="16" fill="${pal.accent || '#ffd460'}" stroke="#000" stroke-width="2"/></svg>`;
  const status = h('p', { class: 'wheel-status' }, '');
  const total = h('b', {}, hud.fmt(0));
  const mult = h('div', { class: 'wheel-mult' }, '×1');
  hud.openModal(h('div', { class: 'confirm wheel-modal' }, h('h2', {}, engine.game.rules?.bonusMenu?.wheel?.name || 'Ruleta de la fortuna'),
    h('div', { class: 'wheel-wrap' }, h('div', { class: 'wheel-pointer' }), disc, mult), status, h('p', { class: 'mg-total' }, 'Total: ', total)));
  let acc = 0, rot = 0;
  const spinMs = hud.turbo ? 1200 : 3200;
  for (const [i, spin] of bonus.spins.entries()) {
    status.textContent = `Giro ${i + 1} de ${bonus.spins.length}`;
    mult.textContent = `×${spin.multiplier}`;
    mult.classList.remove('pop'); void mult.offsetWidth; mult.classList.add('pop');
    engine.sound.play('spin');
    // El centro del segmento elegido debe quedar arriba (donde está el puntero)
    const target = -((spin.segment + 0.5) * 360) / n + (Math.random() - 0.5) * (300 / n);
    const cur = ((rot % 360) + 360) % 360;
    rot += 360 * (hud.turbo ? 2 : 5) + ((target - cur + 720) % 360);
    disc.style.transition = `transform ${spinMs}ms cubic-bezier(.12,.7,.18,1)`;
    disc.style.transform = `rotate(${rot}deg)`;
    await wait(spinMs + 80);
    engine.sound.play('win');
    acc += spin.win;
    total.textContent = hud.fmt(engine.money(acc));
    status.innerHTML = '';
    status.append(h('span', { class: 'mg-hit' }, `${hud.fmt(engine.money(spin.value))} × ${spin.multiplier} = ${hud.fmt(engine.money(spin.win))}`));
    await wait(hud.turbo ? 400 : 1000);
  }
  await wait(500);
  hud.modal.hidden = true;
}

/** Elige un premio: el jugador toca casillas; los premios se revelan en el orden decidido por el servidor.
 *  Las casillas "bonus" (kinds) valen doble y se destacan con una insignia. */
export function playPick(engine, bonus) {
  const hud = engine.hud;
  const P = engine.game.rules?.bonusMenu?.pick || {};
  return new Promise((resolve) => {
    let k = 0, acc = 0;
    const picked = new Set();
    const left = h('p', {}, `Elige ${bonus.values.length} casillas`);
    const total = h('b', {}, hud.fmt(0));
    const tiles = [];
    const face = (el, j, v) => {
      el.textContent = '';
      const bonusTile = bonus.kinds?.[j] === 'bonus';
      el.append(h('span', {}, hud.fmt(engine.money(v))));
      if (bonusTile) { el.classList.add('bonus'); el.append(h('i', { class: 'pick-badge' }, `BONUS ×${P.bonusMult ?? 2}`)); }
    };
    // Con giro automático (o sin tocar en 15 s) las casillas se eligen solas
    let idle = null;
    const autoPick = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        const free = tiles.map((_, j) => j).filter((j) => !picked.has(j));
        if (k < bonus.values.length && free.length) tiles[free[Math.floor(Math.random() * free.length)]].click();
      }, hud.autoLeft > 0 ? 700 : 15_000);
    };
    bonus.tiles.forEach((_, i) => tiles.push(h('button', {
      onclick: async () => {
        if (k >= bonus.values.length || picked.has(i)) return;
        autoPick();
        picked.add(i);
        const src = bonus.picked[k];
        const v = bonus.values[k++];
        acc += v;
        face(tiles[i], src, v);
        tiles[i].classList.add('revealed');
        engine.sound.play(bonus.kinds?.[src] === 'bonus' ? 'feature' : 'coin');
        total.textContent = hud.fmt(engine.money(acc));
        left.textContent = k < bonus.values.length ? `Te quedan ${bonus.values.length - k}` : '¡Listo!';
        if (k === bonus.values.length) {
          clearTimeout(idle);
          // Muestra lo que había en las demás casillas
          const others = bonus.tiles.map((v, j) => j).filter((j) => !bonus.picked.includes(j));
          let o = 0;
          tiles.forEach((t, j) => { if (!picked.has(j)) { const src2 = others[o++]; if (src2 != null) face(t, src2, bonus.tiles[src2]); t.classList.add('other'); } });
          await wait(1600);
          hud.modal.hidden = true;
          resolve();
        }
      },
    }, '?')));
    hud.openModal(h('div', { class: 'confirm' }, h('h2', {}, P.name || 'Elige un premio'), left, h('div', { class: 'picks' }, tiles), h('p', { class: 'mg-total' }, 'Total: ', total)));
    hud.modalResolve = () => { clearTimeout(idle); resolve(); }; // si cierra la ventana, el premio igual está acreditado
    autoPick();
  });
}

/** Colecciona: todos los objetos se dan vuelta uno por uno (moneda ×1, gema ×2, cofre ×3) y se suman. */
export async function playCollect(engine, bonus) {
  const hud = engine.hud;
  const C = engine.game.rules?.bonusMenu?.collect || {};
  const cells = bonus.items.map(() => h('div', { class: 'collect-item' }, '?'));
  const total = h('b', {}, hud.fmt(0));
  const counts = h('p', { class: 'collect-counts' }, '');
  let fast = false;
  const box = h('div', { class: 'confirm collect-modal', onclick: () => { fast = true; } }, h('h2', {}, C.name || 'Colecciona'),
    h('p', {}, '🪙 ×1 · 💎 ×2 · 🧰 ×3'), h('div', { class: 'collect-grid' }, cells), counts, h('p', { class: 'mg-total' }, 'Total: ', total));
  hud.openModal(box);
  let acc = 0;
  const n = {};
  for (const [i, it] of bonus.items.entries()) {
    const el = cells[i];
    el.textContent = '';
    el.append(h('span', { class: 'ci-icon' }, TYPE_ICON[it.type] || '⭐'), h('small', {}, hud.fmt(engine.money(it.win))));
    el.classList.add('open', `t-${it.type}`);
    engine.sound.play(it.mult >= 3 ? 'feature' : 'coin');
    acc += it.win;
    n[it.type] = (n[it.type] || 0) + 1;
    total.textContent = hud.fmt(engine.money(acc));
    counts.textContent = Object.entries(n).map(([t, c]) => `${TYPE_ICON[t] || t} ${c}`).join('  ');
    await wait(fast || hud.turbo ? 60 : 220);
  }
  await wait(1200);
  hud.modal.hidden = true;
}

/** El camino: un dado avanza la ficha por el tablero; cada casilla donde cae paga y el multiplicador sube. */
export async function playPath(engine, bonus) {
  const hud = engine.hud;
  const P = engine.game.rules?.bonusMenu?.path || {};
  const squares = bonus.squares.map((sq, i) => h('div', { class: 'path-sq' }, h('small', {}, String(i + 1)), h('span', {}, hud.fmt(engine.money(sq.value)))));
  const token = h('div', { class: 'path-token' }, '🏃');
  const dice = h('div', { class: 'path-dice' }, '🎲');
  const mult = h('div', { class: 'wheel-mult' }, '×1');
  const total = h('b', {}, hud.fmt(0));
  const status = h('p', {}, '');
  hud.openModal(h('div', { class: 'confirm path-modal' }, h('h2', {}, P.name || 'El camino'),
    h('div', { class: 'path-head' }, dice, mult), h('div', { class: 'path-board' }, squares), status, h('p', { class: 'mg-total' }, 'Total: ', total)));
  let acc = 0, pos = -1;
  const place = (i) => { if (i >= 0) squares[i].append(token); };
  const DIE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  for (const m of bonus.moves) {
    mult.textContent = `×${m.multiplier}`;
    mult.classList.remove('pop'); void mult.offsetWidth; mult.classList.add('pop');
    engine.sound.play('spin');
    for (let k = 0; k < (hud.turbo ? 4 : 10); k++) { dice.textContent = DIE[Math.floor(Math.random() * 6)]; await wait(50); }
    dice.textContent = DIE[m.steps - 1] || String(m.steps);
    status.textContent = `¡Avanzas ${m.steps}!`;
    while (pos < m.position) { pos++; place(pos); squares[pos].classList.add('passed'); await wait(hud.turbo ? 50 : 140); }
    squares[pos].classList.add('hit');
    engine.sound.play('win');
    acc += m.win;
    total.textContent = hud.fmt(engine.money(acc));
    status.textContent = `${hud.fmt(engine.money(m.value))} × ${m.multiplier} = ${hud.fmt(engine.money(m.win))}`;
    await wait(hud.turbo ? 300 : 800);
  }
  status.textContent = '¡Llegaste a la meta!';
  await wait(1200);
  hud.modal.hidden = true;
}

/**
 * Elección de cofre: el jugador toca uno de los cofres y se revela el multiplicador que ya decidió el servidor;
 * los demás cofres muestran otros premios posibles. Con giro automático (o sin tocar en 12 s) se elige solo.
 * chest: { mult, spins, others: [mult…] }. image: imagen del cofre (la del símbolo scatter).
 */
export function playChests(engine, chest, { image = null, title = 'Elige un cofre', info: infoText = null, done: doneText = null } = {}) {
  const hud = engine.hud;
  return new Promise((resolve) => {
    let done = false;
    const n = 1 + (chest.others?.length || 0);
    const info = h('p', {}, infoText || `Cada cofre esconde un multiplicador para tus ${chest.spins} giros gratis.`);
    const boxes = [];
    const finish = async (i) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      engine.sound.play('coin');
      boxes[i].classList.add('open', 'win');
      boxes[i].querySelector('.chest-val').textContent = `×${chest.mult}`;
      info.textContent = doneText ? doneText(chest) : `¡×${chest.mult}! ${chest.spins} giros gratis con todos los premios ×${chest.mult}`;
      await wait(hud.turbo ? 500 : 900);
      let o = 0;
      boxes.forEach((b, j) => { if (j !== i) { b.classList.add('open', 'other'); b.querySelector('.chest-val').textContent = `×${chest.others[o++]}`; } });
      await wait(hud.turbo ? 700 : 1500);
      hud.modal.hidden = true;
      hud.modalResolve = null;
      resolve(chest.mult);
    };
    for (let i = 0; i < n; i++) {
      boxes.push(h('button', { class: 'chest', style: `animation-delay:${i * 0.25}s`, onclick: () => finish(i), 'aria-label': `Cofre ${i + 1}` },
        image ? h('img', { src: image, alt: '' }) : h('span', { class: 'chest-emoji' }, '🎁'),
        h('b', { class: 'chest-val' }, '?')));
    }
    hud.openModal(h('div', { class: 'confirm chests-modal' }, h('h2', {}, title), info, h('div', { class: 'chests' }, boxes)));
    // Si cierra la ventana, se elige un cofre igual (el premio ya está decidido y acreditado)
    hud.modalResolve = () => { hud.modal.hidden = false; finish(0); };
    const timer = setTimeout(() => finish(Math.floor(Math.random() * n)), hud.autoLeft > 0 ? 1200 : 12_000);
  });
}
