// Bonus Hold & Win "ELIGE Y FIJA" (diseño original 5x5): en cada ronda aparecen monedas misteriosas y el
// jugador toca la que quiere fijar. La moneda se bloquea con una animación y se revela su contenido. El premio
// de cada ronda ya lo decidió el servidor (en orden), así que la casilla elegida no cambia el resultado.
import { h } from '../../../shared/Hud.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TIER_COLORS = { Bronce: '#cd7f32', Plata: '#c0c0c0', Oro: '#ffd700', Platino: '#e5e4e2', Diamante: '#b9f2ff' };
const SPECIAL = {
  bonus: { icon: '🎁', color: '#ff4dff', label: 'BONUS' },
  multiplier: { icon: '✖', color: '#2ecc71', label: 'MULTIPLICADOR' },
  jackpot: { icon: '👑', color: '#ffe44d', label: 'JACKPOT' },
  reset: { icon: '🔄', color: '#ff4d4d', label: 'RESET' },
  extra_round: { icon: '➕', color: '#4d7cff', label: '+1 RONDA' },
};
const JP = ['mini', 'minor', 'major', 'grand'];

export async function playHoldPick(engine, result) {
  const hud = engine.hud;
  const R = engine.game.rules;
  const hw = result.holdAndWin;
  const { reels: C, rows: RR } = engine.game.grid;
  const tierColor = (name) => (R.coinTiers || R.coinValues || []).find((v) => v?.name === name)?.color || TIER_COLORS[name] || '#ffd460';
  const fmt = (m) => hud.fmt(engine.money(m));

  // ---- Tablero
  const cells = [];
  for (let r = 0; r < RR; r++) for (let c = 0; c < C; c++) cells.push(h('button', { class: 'hp-cell', 'data-c': c, 'data-r': r }));
  const at = (c, r) => cells[r * C + c];
  const heldSet = new Set();
  const coinEls = []; // { el, value } de las monedas normales fijas (crecen +10 %)

  const paintCoin = (el, k) => {
    el.className = 'hp-cell held';
    el.textContent = '';
    if (k.kind === 'coin') {
      el.style.setProperty('--tc', tierColor(k.tier));
      el.append(h('span', { class: 'hp-coin' }, h('small', {}, k.tier || ''), h('b', {}, fmt(k.value))));
    } else if (k.kind === 'jackpot') {
      el.style.setProperty('--tc', SPECIAL.jackpot.color);
      el.append(h('span', { class: 'hp-coin' }, h('small', {}, '👑'), h('b', {}, k.jackpot.toUpperCase())));
    } else {
      const S = SPECIAL[k.kind];
      el.style.setProperty('--tc', S.color);
      el.append(h('span', { class: 'hp-coin sp' }, h('i', {}, S.icon), h('small', {}, k.kind === 'multiplier' ? `×${k.mult}` : k.kind === 'bonus' ? fmt(k.value) : S.label)));
    }
  };

  // ---- Barra de jackpots (con la cantidad de fijas que necesita cada uno)
  const J = R.jackpots || {};
  const need = Object.fromEntries((R.jackpotCounts || []).map((t) => [t.jackpot, t.count]));
  need.grand = C * RR;
  const jpEls = {};
  const jpBar = h('div', { class: 'hp-jackpots' }, JP.filter((k) => J[k]).map((k) => (jpEls[k] = h('div', { class: `hp-jp jp-${k}` },
    h('small', {}, k.toUpperCase()), h('b', {}, fmt(J[k])), need[k] ? h('em', {}, `${need[k]} fijas`) : null))));
  const roundsEl = h('div', { class: 'hp-rounds' });
  const heldEl = h('b', {}, '0');
  const multEl = h('b', {}, '×1');
  const totalEl = h('b', {}, fmt(0));
  const msg = h('p', { class: 'hp-msg' }, '');
  const box = h('div', { class: 'confirm hp-modal' },
    h('h2', {}, engine.msg('holdWin')), jpBar,
    h('div', { class: 'hp-info' }, h('span', {}, 'Rondas ', roundsEl), h('span', {}, 'Fijas ', heldEl), h('span', {}, 'Mult. ', multEl)),
    h('div', { class: 'hp-board', style: `grid-template-columns: repeat(${C}, 1fr)` }, cells), msg,
    h('p', { class: 'mg-total' }, 'Total: ', totalEl));
  hud.openModal(box);
  hud.modalResolve = () => { hud.modal.hidden = false; }; // no se puede cerrar a mitad del bonus

  const setRounds = (n) => {
    roundsEl.textContent = '';
    const max = Math.max(n, R.rounds || 3);
    for (let i = 0; i < max; i++) roundsEl.append(h('i', { class: i < n ? 'on' : '' }));
  };
  let held = 0, multSum = 0;
  const extra = { bonus: 0, jp: 0 };
  const setHeld = (n) => {
    held = n; heldEl.textContent = String(n);
    for (const k of JP) jpEls[k]?.classList.toggle('lit', need[k] != null && n >= need[k]);
  };
  // Total en vivo: (monedas + bonus) × multiplicador + jackpots
  const showTotal = () => totalEl.textContent = fmt((coinEls.reduce((a, ce) => a + ce.k.value, 0) + extra.bonus) * Math.max(1, multSum) + extra.jp);

  // Monedas iniciales (las que activaron el bonus)
  for (const k of hw.coins) {
    const el = at(k.c, k.r);
    heldSet.add(`${k.c},${k.r}`);
    const kk = k.jackpot ? { kind: 'jackpot', jackpot: k.jackpot, value: k.value } : { kind: 'coin', value: k.value, tier: k.tier };
    paintCoin(el, kk);
    if (kk.kind === 'coin') coinEls.push({ el, k: kk }); else extra.jp += kk.value;
    showTotal();
    el.classList.add('lock');
    engine.sound.play('coin');
    await wait(hud.turbo ? 40 : 120);
  }
  setHeld(hw.coins.length);
  setRounds(R.rounds || 3);
  msg.textContent = 'Toca una moneda misteriosa para fijarla';

  for (const round of hw.rounds) {
    // Candidatas en casillas libres al azar (solo visual)
    const free = cells.filter((el) => !heldSet.has(`${el.dataset.c},${el.dataset.r}`));
    const cand = [];
    while (cand.length < Math.min(round.candidates, free.length)) cand.push(free.splice(Math.floor(Math.random() * free.length), 1)[0]);
    engine.sound.play('spin', { rate: 1.3 });
    cand.forEach((el, i) => { el.className = 'hp-cell cand'; el.style.animationDelay = `${i * 0.08}s`; el.textContent = '?'; });
    const chosen = await new Promise((resolve) => {
      let done = false;
      const pick = (el) => { if (done) return; done = true; clearTimeout(timer); resolve(el); };
      cand.forEach((el) => { el.onclick = () => pick(el); });
      const timer = setTimeout(() => pick(cand[Math.floor(Math.random() * cand.length)]), hud.autoLeft > 0 ? 900 : 15_000);
    });
    cand.forEach((el) => { el.onclick = null; if (el !== chosen) { el.className = 'hp-cell gone'; el.textContent = ''; } });
    const p = round.pick;
    heldSet.add(`${chosen.dataset.c},${chosen.dataset.r}`);
    // Crecimiento +x % de las monedas ya fijas
    if ((p.kind === 'coin' || p.kind === 'jackpot') && R.holdGrowth > 0 && coinEls.length) {
      for (const ce of coinEls) { ce.k.value *= 1 + R.holdGrowth; ce.el.querySelector('b').textContent = fmt(ce.k.value); ce.el.classList.remove('grow'); void ce.el.offsetWidth; ce.el.classList.add('grow'); }
    }
    paintCoin(chosen, p);
    chosen.classList.add('lock');
    if (p.kind === 'coin') coinEls.push({ el: chosen, k: { ...p } });
    engine.sound.play(p.kind === 'coin' ? 'coin' : 'feature');
    setHeld(round.held);
    if (p.kind === 'multiplier') { multSum += p.mult; multEl.textContent = `×${multSum}`; }
    if (p.kind === 'bonus') extra.bonus += p.value;
    if (p.kind === 'jackpot') extra.jp += p.value;
    showTotal();
    msg.textContent = p.kind === 'coin' ? `${p.tier || 'Moneda'} ${fmt(p.value)}${R.holdGrowth > 0 && coinEls.length > 1 ? ` · las demás +${Math.round(R.holdGrowth * 100)} %` : ''}`
      : p.kind === 'bonus' ? `¡BONUS! +${fmt(p.value)}`
      : p.kind === 'multiplier' ? `¡MULTIPLICADOR ×${p.mult}!`
      : p.kind === 'jackpot' ? `¡JACKPOT ${p.jackpot.toUpperCase()}! +${fmt(p.value)}`
      : p.kind === 'reset' ? '¡RESET! Las rondas vuelven a empezar' : '¡+1 RONDA!';
    setRounds(round.roundsLeft);
    await wait(hud.turbo ? 350 : 900);
  }

  // ---- Cobro
  multEl.textContent = `×${hw.multiplier}`;
  msg.textContent = hw.multiplier > 1 ? `Monedas ${fmt(hw.coinsWin + hw.bonusWin)} × ${hw.multiplier}` : `Monedas ${fmt(hw.coinsWin + hw.bonusWin)}`;
  totalEl.textContent = fmt((hw.coinsWin + hw.bonusWin) * hw.multiplier + hw.jackpotWin);
  await wait(hud.turbo ? 500 : 1200);
  if (hw.tierJackpot) {
    engine.sound.play('bigWin');
    jpEls[hw.tierJackpot.jackpot]?.classList.add('won');
    msg.textContent = `¡${held} FIJAS! JACKPOT ${hw.tierJackpot.jackpot.toUpperCase()} +${fmt(hw.tierJackpot.value)}`;
    totalEl.textContent = fmt(hw.win);
    await wait(hud.turbo ? 900 : 2200);
  }
  totalEl.textContent = fmt(hw.win);
  await wait(800);
  hud.modalResolve = null;
  hud.modal.hidden = true;
}
