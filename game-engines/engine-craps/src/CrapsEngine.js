// Motor 11 — CRAPS (cliente): mesa con zonas de apuesta, fichas y dados 3D.
// Los dados los tira el SERVIDOR; aquí el lanzamiento (arrastrando o con el botón) solo decide la animación.
import { SoundManager } from '../../shared/SoundManager.js';
import { formatMoney } from '../../shared/api.js';
import { canFullscreen, isTouch, toggleFullscreen, rotate } from '../../shared/screen.js';
import { applyBackgroundMedia, loadFontFile, loadAnyFont, playMediaOverlay, winTierFor } from '../../shared/media.js';

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Rotación del cubo para mostrar cada cara arriba (cara 1 al frente)
const FACE_ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const FACE_POS = { 1: 'rotateY(0deg)', 2: 'rotateY(90deg)', 3: 'rotateX(90deg)', 4: 'rotateX(-90deg)', 5: 'rotateY(-90deg)', 6: 'rotateY(180deg)' };

const CSS = `
.cr { position: fixed; inset: 0; display: flex; flex-direction: column; font-family: var(--cr-font, var(--font)); color: var(--text); overflow: hidden; }
.cr * { box-sizing: border-box; }
.cr-top { display: flex; align-items: center; gap: 10px; padding: calc(8px + env(safe-area-inset-top)) 12px 4px; }
.cr-title { font-family: var(--font); flex: 1; text-align: center; font-size: clamp(18px, 3.2vw, 34px); color: var(--accent); text-shadow: 0 3px 10px #000; }
.cr-title img { max-height: 70px; max-width: 70vw; }
.cr-icon { width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(0,0,0,.45); color: var(--text); font-size: 18px; cursor: pointer; }
.cr-main { flex: 1; display: grid; grid-template-columns: 1fr minmax(260px, 30%); gap: 12px; padding: 6px 12px; min-height: 0; }
.cr-felt { position: relative; border-radius: 26px; padding: 12px; border: 6px solid color-mix(in srgb, var(--accent) 70%, #5a3a10);
  background: var(--felt-img, radial-gradient(ellipse at center, color-mix(in srgb, var(--felt) 85%, #fff) 0%, var(--felt) 60%, color-mix(in srgb, var(--felt) 70%, #000) 100%));
  background-size: cover; box-shadow: inset 0 0 40px rgba(0,0,0,.6), 0 10px 30px rgba(0,0,0,.6); display: grid; gap: 8px;
  grid-template-rows: auto auto auto auto auto; align-content: center; overflow: auto; }
.cr-row { display: grid; gap: 8px; }
.cr-zone { position: relative; border: 2px solid rgba(255,255,255,.75); border-radius: 12px; padding: 8px 6px; min-height: 58px; text-align: center; cursor: pointer;
  background: rgba(0,0,0,.12); transition: background .15s, box-shadow .2s, opacity .2s; user-select: none; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 2px; }
.cr-zone:hover { background: rgba(255,255,255,.1); }
.cr-zone.off { opacity: .35; cursor: not-allowed; }
.cr-zone b { font-size: clamp(13px, 1.6vw, 20px); letter-spacing: .04em; }
.cr-zone small { font: 600 10px var(--cr-font, system-ui); opacity: .85; }
.cr-zone.win { box-shadow: 0 0 0 3px var(--accent), 0 0 26px var(--accent); background: color-mix(in srgb, var(--accent) 30%, transparent); }
.cr-zone.lose { opacity: .45; }
.cr-zone.point { box-shadow: inset 0 0 0 3px var(--accent); }
.cr-puck { position: absolute; top: -10px; right: -8px; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font: 800 9px var(--cr-font, system-ui);
  background: #fff; color: #000; border: 3px solid #111; box-shadow: 0 3px 8px #0008; }
.cr-puck.offp { background: #111; color: #fff; border-color: #fff; }
.cr-chips { display: flex; flex-wrap: wrap; gap: 3px; justify-content: center; }
.cr-chip { min-width: 34px; height: 22px; padding: 0 6px; border-radius: 99px; font: 800 11px var(--cr-font, system-ui); display: inline-grid; place-items: center; color: #fff;
  background: var(--primary); border: 2px dashed #fff; box-shadow: 0 2px 5px #0008; }
.cr-chip.pending { background: color-mix(in srgb, var(--primary) 45%, #555); border-style: dotted; }
.cr-chip .x { margin-left: 4px; cursor: pointer; opacity: .8; }
.cr-mini { font: 700 10px var(--cr-font, system-ui); padding: 2px 6px; border-radius: 6px; border: 1px solid #fff9; background: #0006; color: #fff; cursor: pointer; }
.cr-side { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.cr-tray { position: relative; flex: 1; min-height: 190px; border-radius: 22px; overflow: hidden; perspective: 900px; touch-action: none; cursor: grab;
  background: radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--felt) 90%, #fff) 0%, var(--felt) 55%, #000 130%); border: 6px solid color-mix(in srgb, var(--accent) 60%, #3a2508); }
.cr-tray .hint { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; font: 600 11px var(--cr-font, system-ui); opacity: .7; pointer-events: none; }
.cr-tray svg { position: absolute; inset: 0; pointer-events: none; }
.cr-die { position: absolute; width: var(--ds, 56px); height: var(--ds, 56px); transform-style: preserve-3d; left: 0; top: 0; }
.cr-die .f { position: absolute; inset: 0; background: linear-gradient(145deg, color-mix(in srgb, var(--die-face, #fbfbfb) 100%, #fff), color-mix(in srgb, var(--die-face, #fbfbfb) 88%, #000));
  border-radius: var(--die-radius, 18%); border: 1px solid var(--die-edge, #ccc); background-size: cover; background-position: center; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr);
  padding: calc(var(--ds, 56px) * .13); box-shadow: inset 0 0 calc(var(--ds, 56px) * .18) rgba(0,0,0,.25); backface-visibility: hidden; }
.cr-die .f i { width: calc(var(--ds, 56px) * .18); height: calc(var(--ds, 56px) * .18); border-radius: 50%; background: transparent; place-self: center; }
/* Lanzamiento a pantalla completa: los dados cruzan la mesa, rebotan en la pared y caen */
.cr-throw { position: fixed; inset: 0; pointer-events: none; z-index: 35; perspective: 1100px; transition: opacity .35s; }
.cr-throw.out { opacity: 0; }
.cr-shadow { position: absolute; left: 0; top: 0; width: var(--ds, 56px); height: calc(var(--ds, 56px) * .5); border-radius: 50%; background: radial-gradient(#000a, #0000 70%); }
.cr-throw-total { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); font-size: clamp(34px, 7vw, 64px); color: var(--accent); text-shadow: 0 3px 12px #000, 0 0 20px #000;
  opacity: 0; transition: opacity .2s, transform .25s; white-space: nowrap; }
.cr-throw-total.show { opacity: 1; transform: translate(-50%, -125%); }
.cr-die .f.img i { display: none; }
.cr-die .f i.on { background: var(--pip, #c0392b); box-shadow: inset 0 2px 2px rgba(0,0,0,.5); }
.cr-total { position: absolute; top: 10px; left: 0; right: 0; text-align: center; font-size: 30px; color: var(--accent); text-shadow: 0 2px 8px #000; opacity: 0; transition: opacity .2s; pointer-events: none; }
.cr-total.show { opacity: 1; }
.cr-hist { position: absolute; left: 10px; bottom: 26px; display: flex; gap: 4px; flex-wrap: wrap; max-width: calc(100% - 20px); pointer-events: none; }
.cr-hist span { width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; font: 800 12px var(--cr-font, system-ui); background: #0007; }
.cr-hist span.seven { background: #c0392b; } .cr-hist span.pt { background: var(--accent); color: #000; }
.cr-phase { font: 700 13px var(--cr-font, system-ui); text-align: center; padding: 6px; border-radius: 10px; background: #0007; }
.cr-bar { display: flex; align-items: center; gap: 12px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); background: rgba(8,8,12,.85); border-top: 2px solid color-mix(in srgb, var(--accent) 50%, transparent); flex-wrap: wrap; }
.cr-stat { display: flex; flex-direction: column; min-width: 80px; } .cr-stat small { font: 600 10px var(--cr-font, system-ui); opacity: .7; letter-spacing: .1em; } .cr-stat b { font-size: 17px; white-space: nowrap; }
.cr-stats { display: flex; gap: 14px; }
.cr-chipsel { display: flex; gap: 8px; margin: 0 auto; }
.cr-chipsel button { width: 48px; height: 48px; border-radius: 50%; border: 4px dashed #fff; font: 800 12px var(--cr-font, system-ui); color: #fff; cursor: pointer; box-shadow: 0 3px 8px #0009; }
.cr-chipsel button.sel { transform: translateY(-6px); box-shadow: 0 0 0 3px var(--accent), 0 6px 14px #000; }
.cr-btn { border: 0; border-radius: 12px; padding: 12px 16px; font: 800 13px var(--cr-font, system-ui); cursor: pointer; background: #ffffff22; color: var(--text); }
.cr-roll { background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--primary) 55%, #fff), var(--primary) 60%, color-mix(in srgb, var(--primary) 55%, #000));
  font-size: 16px; padding: 14px 26px; border-radius: 999px; box-shadow: 0 0 0 3px var(--accent), 0 6px 16px #000; color: #fff; }
.cr-roll:disabled, .cr-btn:disabled { opacity: .45; cursor: not-allowed; }
.cr-float { position: fixed; pointer-events: none; font: 900 22px var(--cr-font, system-ui); color: var(--accent); text-shadow: 0 2px 6px #000; animation: crfloat 1.2s ease-out forwards; z-index: 30; }
@keyframes crfloat { to { transform: translateY(-60px); opacity: 0; } }
.cr-banner { position: fixed; left: 50%; top: 42%; transform: translate(-50%, -50%); padding: 16px 34px; border-radius: 20px; background: #000c; border: 3px solid var(--accent); text-align: center; z-index: 40; animation: crpop .3s; }
.cr-banner small { display: block; color: var(--accent); letter-spacing: .1em; } .cr-banner b { font-size: clamp(30px, 6vw, 60px); }
@keyframes crpop { from { transform: translate(-50%, -50%) scale(.3); opacity: 0; } }
.cr-modal { position: fixed; inset: 0; background: #000b; display: grid; place-items: center; z-index: 50; padding: 14px; }
.cr-sheet { background: var(--panel); border: 2px solid var(--accent); border-radius: 18px; padding: 20px; max-width: 720px; width: 100%; max-height: 88vh; overflow: auto; font-family: var(--info-font, system-ui, sans-serif); position: relative; }
.cr-sheet h2 { font-family: var(--font); color: var(--accent); margin: 0 0 10px; } .cr-sheet table { width: 100%; border-collapse: collapse; font-size: 13px; }
.cr-sheet td, .cr-sheet th { border-bottom: 1px solid #fff2; padding: 6px; text-align: left; } .cr-sheet .close { position: absolute; top: 10px; right: 10px; }
.cr-toast { position: fixed; left: 50%; top: 70px; transform: translateX(-50%); background: #000d; border: 1px solid #fff4; padding: 8px 16px; border-radius: 10px; z-index: 60; font: 600 13px var(--cr-font, system-ui); }
.cr-tag { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); background: #ff9f1c; color: #000; font: 700 11px var(--cr-font, system-ui); padding: 4px 8px; border-radius: 6px; z-index: 5; }
@media (orientation: portrait), (max-width: 820px) {
  /* Celular: todo en una columna que scrollea entera; la mesa no scrollea por dentro */
  .cr-main { display: flex; flex-direction: column; overflow-y: auto; gap: 8px; padding: 4px 8px; }
  .cr-side { gap: 6px; } .cr-tray { min-height: 120px; flex: none; height: 19vh; border-width: 4px; }
  .cr-phase { font-size: 12px; padding: 5px; }
  .cr-felt { padding: 8px; gap: 6px; overflow: visible; align-content: start; border-width: 4px; flex: none; }
  .cr-zone { min-height: 46px; padding: 5px 3px; } .cr-zone b { font-size: 13px; } .cr-zone small { font-size: 9px; }
  .cr-bar { gap: 6px 8px; padding: 8px 10px calc(8px + env(safe-area-inset-bottom)); }
  .cr-stats { order: 0; width: 100%; justify-content: space-between; }
  .cr-stat { min-width: 0; } .cr-stat b { font-size: 15px; } .cr-stat small { font-size: 9px; }
  .cr-chipsel { order: 1; } .cr-btn { order: 2; } .cr-roll { margin-left: auto; }
  .cr-chipsel { order: 3; width: 100%; justify-content: center; } .cr-chipsel button { width: 42px; height: 42px; font-size: 11px; }
  .cr-btn { padding: 10px 12px; } .cr-roll { padding: 12px 20px; }
  .cr-title img { max-height: 48px; }
}
`;

export class CrapsEngine {
  constructor({ container, hudRoot, api, session, lobbyUrl }) {
    this.container = container;
    this.hudRoot = hudRoot;
    this.api = api;
    this.session = session;
    this.game = session.game;
    this.currency = session.currency;
    this.lobbyUrl = lobbyUrl;
    this.busy = false;
    this.zones = new Map();
  }

  fmt(c) { return formatMoney(c, this.currency); }

  async init(progress = () => {}) {
    const t = this.game.theme || {};
    const p = t.palette || {};
    const root = document.documentElement.style;
    root.setProperty('--primary', p.primary || '#c0392b');
    root.setProperty('--accent', p.accent || '#f1c40f');
    root.setProperty('--panel', p.panel || '#071a10');
    root.setProperty('--text', p.text || '#ffffff');
    root.setProperty('--felt', p.reelBg || '#0f5132');
    root.setProperty('--font', `'${t.font || 'Bungee'}', system-ui, sans-serif`);
    // Tipografía de los textos de la mesa (fichas, apuestas, fase, botones) y de la pantalla de información
    if (t.tableFont) root.setProperty('--cr-font', `'${String(t.tableFont).replace(/'/g, '')}', system-ui, sans-serif`);
    if (t.infoFont) root.setProperty('--info-font', `'${String(t.infoFont).replace(/'/g, '')}', system-ui, sans-serif`);
    if (t.tableImage) root.setProperty('--felt-img', `url("${t.tableImage}")`);
    const D = t.dice || {};
    this.diceTheme = D;
    if (D.face) root.setProperty('--die-face', D.face);
    if (D.pip) root.setProperty('--pip', D.pip);
    if (D.edge) root.setProperty('--die-edge', D.edge);
    if (D.radius != null) root.setProperty('--die-radius', `${Math.max(0, Math.min(50, Number(D.radius)))}%`);
    const bg = document.getElementById('bg');
    if (bg) {
      if (t.background && !/\.(mp4|webm)(\?|$)/i.test(t.background)) bg.style.setProperty('--bg-desktop', `url("${t.background}")`);
      if (t.backgroundMobile && !/\.(mp4|webm)(\?|$)/i.test(t.backgroundMobile)) bg.style.setProperty('--bg-mobile', `url("${t.backgroundMobile}")`);
      if (t.backgroundColor) bg.style.setProperty('--bg-color', t.backgroundColor);
    }
    applyBackgroundMedia(t, matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape');
    await Promise.all([loadAnyFont(t.tableFont, t.tableFontUrl), loadAnyFont(t.infoFont, t.infoFontUrl)]);
    if (t.fontUrl) await loadFontFile(t.font, t.fontUrl);
    else if (t.font && !document.querySelector(`link[data-font="${t.font}"]`)) {
      const link = h('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(t.font).replace(/%20/g, '+')}&display=swap` });
      link.dataset.font = t.font;
      document.head.append(link);
    }
    document.head.append(h('style', {}, CSS));
    progress(0.4, 'Preparando la mesa…');
    // Sonidos de los premios por monto (theme.winTiers[i].sound) como ranuras winTier0, winTier1…
    const tierSounds = Object.fromEntries((this.game.theme?.winTiers || []).map((t, i) => [`winTier${i}`, t?.sound || null]));
    this.sound = new SoundManager({ ...(this.game.sounds || {}), ...tierSounds }, this.game.soundVolumes || {});
    const unlock = () => { this.sound.unlock(); this.sound.playMusic('music'); };
    window.addEventListener('pointerdown', unlock, { once: true });
    this.levels = this.game.bet?.levels || [100, 500, 1000];
    this.chip = this.levels.includes(this.game.bet?.default) ? this.game.bet.default : this.levels[0];
    this.build();
    this.table = await this.api.request('/api/v1/table');
    this.render();
    progress(1, 'Listo');
  }

  // ---------------------------------------------------------------- Construcción de la mesa
  build() {
    const R = this.game.rules;
    const t = this.game.theme || {};
    const zone = (key, title, sub, { type, number, cls = '' } = {}) => {
      const chips = h('div', { class: 'cr-chips' });
      const el = h('div', { class: `cr-zone ${cls}`, 'data-key': key, onclick: () => this.onZone(type, number) }, h('b', {}, title), sub ? h('small', {}, sub) : null, chips);
      this.zones.set(key, { el, chips, type, number });
      return el;
    };
    const P = R.pays;
    const pr = (r) => (Array.isArray(r) ? `${r[0]} a ${r[1]}` : `${r} a 1`);
    const numbers = R.bets.place ? h('div', { class: 'cr-row', style: 'grid-template-columns: repeat(6, 1fr)' },
      [4, 5, 6, 8, 9, 10].map((n) => zone(`place${n}`, n === 6 ? 'SEIS' : n === 9 ? 'NUEVE' : String(n), pr(P.place[n]), { type: 'place', number: n }))) : null;
    const mid = h('div', { class: 'cr-row', style: 'grid-template-columns: 2fr 1fr' },
      R.bets.come ? zone('come', 'COME', 'paga 1 a 1', { type: 'come' }) : h('div'),
      h('div', { class: 'cr-row', style: 'grid-template-columns: 1fr 1fr' },
        ...(R.bets.hard ? [4, 6, 8, 10].map((n) => zone(`hard${n}`, `${n / 2}+${n / 2}`, pr(P.hard[n]), { type: 'hard', number: n })) : []),
        R.bets.anyCraps ? zone('anyCraps', 'ANY CRAPS', pr(P.anyCraps), { type: 'anyCraps' }) : null,
        R.bets.any7 ? zone('any7', 'ANY 7', pr(P.any7), { type: 'any7' }) : null));
    const field = R.bets.field ? zone('field', 'FIELD', `2 (${P.field[2]} a 1) · 3 · 4 · 9 · 10 · 11 · 12 (${P.field[12]} a 1)`, { type: 'field' }) : null;
    const dont = h('div', { class: 'cr-row', style: 'grid-template-columns: 1fr 1fr' },
      R.bets.dontCome ? zone('dontCome', "DON'T COME", `bar ${R.dontBar}`, { type: 'dontCome' }) : h('div'),
      R.bets.dontPass ? zone('dontPass', "DON'T PASS", `bar ${R.dontBar}`, { type: 'dontPass' }) : h('div'));
    const pass = R.bets.pass ? zone('pass', 'PASS LINE', 'paga 1 a 1', { type: 'pass', cls: 'pass' }) : null;
    this.felt = h('div', { class: 'cr-felt' }, numbers, mid, field, dont, pass);

    // Bandeja de dados: arrastrar para lanzar
    this.dice = [this.makeDie(), this.makeDie()];
    this.totalEl = h('div', { class: 'cr-total' });
    this.aim = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.hist = h('div', { class: 'cr-hist' });
    this.tray = h('div', { class: 'cr-tray' }, this.aim, this.hist, this.dice[0].el, this.dice[1].el, this.totalEl, h('div', { class: 'hint' }, 'Arrastra y suelta para lanzar los dados'));
    this.bindThrow();
    this.phaseEl = h('div', { class: 'cr-phase' });
    const side = h('div', { class: 'cr-side' }, this.phaseEl, this.tray);

    this.balEl = h('b', {}, '—');
    this.onTableEl = h('b', {}, '—');
    this.winEl = h('b', {}, this.fmt(0));
    this.chipBtns = this.levels.map((v, i) => h('button', {
      style: `background: hsl(${(i * 67 + 350) % 360} 65% 38%)`, onclick: () => { this.chip = v; this.render(); this.sound.play('click'); },
    }, this.fmt(v).replace(/[^0-9.,]/g, '').replace(/[.,]00$/, '')));
    this.undoBtn = h('button', { class: 'cr-btn', onclick: () => this.undo() }, '↶ Deshacer');
    this.clearBtn = h('button', { class: 'cr-btn', onclick: () => this.clearPending() }, 'Limpiar');
    this.rollBtn = h('button', { class: 'cr-btn cr-roll', onclick: () => this.throwDice(0.65 + Math.random() * 0.3, { x: (Math.random() - 0.5) * 0.8, y: -1 }) }, '🎲 TIRAR');
    const bar = h('div', { class: 'cr-bar' },
      h('div', { class: 'cr-stats' },
        h('div', { class: 'cr-stat' }, h('small', {}, 'SALDO'), this.balEl),
        h('div', { class: 'cr-stat' }, h('small', {}, 'EN LA MESA'), this.onTableEl),
        h('div', { class: 'cr-stat' }, h('small', {}, 'ÚLTIMO PREMIO'), this.winEl)),
      h('div', { class: 'cr-chipsel' }, this.chipBtns),
      this.undoBtn, this.clearBtn, this.rollBtn);
    this.soundBtn = h('button', { class: 'cr-icon', onclick: () => { this.soundBtn.textContent = this.sound.toggleMute() ? '🔇' : '🔊'; } }, '🔊');
    const fullBtn = canFullscreen() ? h('button', { class: 'cr-icon', 'aria-label': 'Pantalla completa', onclick: () => toggleFullscreen() }, '⛶') : null;
    const rotBtn = isTouch() ? h('button', { class: 'cr-icon', 'aria-label': 'Girar pantalla', onclick: async () => {
      const portrait = matchMedia('(orientation: portrait)').matches;
      if (!(await rotate(portrait ? 'portrait' : 'landscape'))) this.toast(`Gira el teléfono a ${portrait ? 'horizontal' : 'vertical'}: la mesa se acomoda sola`);
    } }, '⟳') : null;
    const top = h('div', { class: 'cr-top' },
      this.lobbyUrl ? h('a', { class: 'cr-icon', href: this.lobbyUrl, style: 'display:grid;place-items:center;text-decoration:none' }, '⟵') : null,
      h('button', { class: 'cr-icon', onclick: () => this.showRules(), 'aria-label': 'Reglas' }, '☰'),
      h('div', { class: 'cr-title', style: (() => { const pt = matchMedia('(orientation: portrait)').matches; const y = Number(pt ? (t.logoOffsetYMobile ?? t.logoOffsetY) : t.logoOffsetY) || 0; const k = Number(t.logoScale) || 1; return y || k !== 1 ? `transform:translateY(${Math.max(-300, Math.min(300, y)) / 2}px) scale(${Math.min(1.8, Math.max(0.4, k))})` : ''; })() }, t.logo ? h('img', { src: t.logo, alt: t.title || this.game.name }) : (t.title || this.game.name)),
      rotBtn, this.soundBtn, fullBtn);
    this.root = h('div', { class: 'cr' }, top, h('div', { class: 'cr-main' }, this.felt, side), bar);
    if (this.session.source === 'draft') this.root.append(h('div', { class: 'cr-tag' }, 'VISTA PREVIA · BORRADOR'));
    this.container.innerHTML = '';
    this.container.append(this.root);
    this.placeDiceIdle();
  }

  makeDie() {
    const cube = h('div', { class: 'cr-die' });
    for (let f = 1; f <= 6; f++) {
      const img = this.diceTheme?.faces?.[f];
      const face = h('div', { class: `f${img ? ' img' : ''}`, style: `transform: ${FACE_POS[f]} translateZ(calc(var(--ds, 56px) / 2))${img ? `; background-image: url("${String(img).replace(/"/g, '%22')}")` : ''}` });
      for (let i = 1; i <= 9; i++) face.append(h('i', { class: PIPS[f].includes(i) ? 'on' : '' }));
      cube.append(face);
    }
    return { el: cube, x: 0, y: 0, value: 1 };
  }

  placeDiceIdle() {
    const w = this.tray.clientWidth || 300, hgt = this.tray.clientHeight || 200;
    this.dice.forEach((d, i) => this.setDie(d, w / 2 - 70 + i * 84, hgt / 2 - 28, d.value, i * 15));
  }

  setDie(d, x, y, value, spin = 0) {
    const [rx, ry] = FACE_ROT[value];
    d.x = x; d.y = y; d.value = value;
    d.el.style.transform = `translate3d(${x}px, ${y}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${spin}deg)`;
  }

  // ---------------------------------------------------------------- Lanzamiento arrastrando
  bindThrow() {
    let start = null;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', 'white'); line.setAttribute('stroke-width', '3'); line.setAttribute('stroke-dasharray', '8 6'); line.setAttribute('opacity', '0');
    this.aim.append(line);
    const pos = (e) => { const r = this.tray.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    this.tray.addEventListener('pointerdown', (e) => { if (this.busy) return; start = pos(e); this.tray.setPointerCapture?.(e.pointerId); });
    this.tray.addEventListener('pointermove', (e) => {
      if (!start) return;
      const p = pos(e);
      line.setAttribute('x1', start.x); line.setAttribute('y1', start.y); line.setAttribute('x2', p.x); line.setAttribute('y2', p.y); line.setAttribute('opacity', '0.8');
    });
    this.tray.addEventListener('pointerup', (e) => {
      if (!start) return;
      const p = pos(e);
      line.setAttribute('opacity', '0');
      const dx = p.x - start.x, dy = p.y - start.y;
      const dist = Math.hypot(dx, dy);
      start = null;
      if (dist < 25) return; // un toque no lanza
      const power = Math.min(1, dist / 220);
      this.throwDice(power, { x: dx / dist, y: dy / dist });
    });
  }

  /**
   * Anima el lanzamiento hacia el resultado que decidió el servidor. Los dados vuelan por toda la mesa
   * (capa a pantalla completa, visible aunque la página esté desplazada en el celular): física simple con
   * gravedad, rebotes en el paño y en la pared del fondo, fricción y giro; al final se orientan a la cara real.
   */
  async animateDice(values, power, dir) {
    this.throwLayer?.remove();
    clearTimeout(this.throwFade);
    const vw = window.innerWidth, vh = window.innerHeight;
    // Zona de juego visible: la mesa recortada a la pantalla (sin la barra de abajo)
    const barTop = this.root.querySelector('.cr-bar')?.getBoundingClientRect().top ?? vh;
    const fr = this.felt.getBoundingClientRect();
    let area = { l: Math.max(0, fr.left), t: Math.max(0, fr.top), r: Math.min(vw, fr.right), b: Math.min(barTop, vh, fr.bottom) };
    if (area.b - area.t < 220 || area.r - area.l < 220) area = { l: 0, t: 0, r: vw, b: Math.min(barTop, vh) };
    const W = area.r - area.l, H = area.b - area.t;
    const dScale = Math.max(0.7, Math.min(1.4, Number(this.diceTheme?.scale) || 1));
    const size = Math.round(Math.max(40, Math.min(110, Math.min(W, H) * 0.13 * dScale)));
    const layer = h('div', { class: 'cr-throw', style: `--ds:${size}px` });
    const shadows = [h('div', { class: 'cr-shadow' }), h('div', { class: 'cr-shadow' })];
    const dice = [this.makeDie(), this.makeDie()];
    const total = h('div', { class: 'cr-throw-total' }, String(values[0] + values[1]));
    layer.append(...shadows, dice[0].el, dice[1].el, total);
    this.root.append(layer);
    this.throwLayer = layer;
    this.totalEl.classList.remove('show');
    this.sound.play('roll');

    // Dirección: hacia el fondo de la mesa (arriba), con el ángulo del arrastre si lo hubo
    let dx = dir?.x ?? 0, dy = dir?.y ?? -1;
    if (dy > -0.35) dy = -0.35 - Math.random() * 0.3;
    const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    const scale = Math.max(0.6, H / 650);
    const speed = (900 + power * 1100) * scale;
    const m = 6;
    const bounds = { x0: area.l + m, x1: area.r - size - m, y0: area.t + m, y1: area.b - size - m };
    const startX = area.l + W / 2 - size - dx * W * 0.15;
    const st = [0, 1].map((i) => ({
      x: Math.min(bounds.x1, Math.max(bounds.x0, startX + i * (size + 14))), y: bounds.y1, z: size * 1.6,
      vx: dx * speed * (0.92 + Math.random() * 0.16) + (i ? 60 : -60), vy: dy * speed * (0.92 + Math.random() * 0.16),
      vz: (260 + power * 260) * scale, rx: 0, ry: 0, rz: Math.random() * 90, spin: (Math.random() - 0.5) * 900, bounces: 0,
    }));
    const G = 2600 * scale, dt = 1 / 60;
    const frames = [[], []];
    let t = 0, clacked = 0;
    for (; t < 3.2; t += dt) {
      let moving = false;
      for (const d of st) {
        d.vz -= G * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        if (d.z <= 0) {
          d.z = 0;
          if (d.vz < -60) { d.vz = -d.vz * 0.42; d.vx *= 0.82; d.vy *= 0.82; d.spin *= 0.7; d.bounces++; if (clacked < 4) { clacked++; setTimeout(() => this.sound.play('dice'), t * 1000); } } else d.vz = 0;
        }
        if (d.x < bounds.x0) { d.x = bounds.x0; d.vx = Math.abs(d.vx) * 0.62; d.spin *= -0.8; }
        if (d.x > bounds.x1) { d.x = bounds.x1; d.vx = -Math.abs(d.vx) * 0.62; d.spin *= -0.8; }
        if (d.y < bounds.y0) { d.y = bounds.y0; d.vy = Math.abs(d.vy) * 0.55; d.vz += 120 * scale; } // pared del fondo (pirámides)
        if (d.y > bounds.y1) { d.y = bounds.y1; d.vy = -Math.abs(d.vy) * 0.5; }
        if (d.z === 0) { const f = Math.pow(0.07, dt); d.vx *= f; d.vy *= f; d.spin *= f; }
        const sp = Math.hypot(d.vx, d.vy);
        d.rx -= d.vy * dt * (d.z > 0 ? 1.1 : 0.8);
        d.ry += d.vx * dt * (d.z > 0 ? 1.1 : 0.8);
        d.rz += d.spin * dt;
        if (sp > 18 || d.z > 0.5 || Math.abs(d.vz) > 1) moving = true;
      }
      // Choque entre los dos dados: se separan e intercambian parte de la velocidad
      const [a, b] = st;
      const ddx = b.x - a.x, ddy = b.y - a.y, dist = Math.hypot(ddx, ddy);
      if (dist < size * 1.05 && dist > 0) {
        const push = (size * 1.05 - dist) / 2, ux = ddx / dist, uy = ddy / dist;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
        const rel = (a.vx - b.vx) * ux + (a.vy - b.vy) * uy;
        if (rel > 0) { a.vx -= rel * ux * 0.8; a.vy -= rel * uy * 0.8; b.vx += rel * ux * 0.8; b.vy += rel * uy * 0.8; }
      }
      for (let i = 0; i < 2; i++) frames[i].push({ x: st[i].x, y: st[i].y, z: st[i].z, rx: st[i].rx, ry: st[i].ry, rz: st[i].rz });
      if (!moving && t > 0.6) break;
    }
    const dur = Math.round(frames[0].length * dt * 1000);
    const anims = [];
    for (let i = 0; i < 2; i++) {
      const fr2 = frames[i];
      const last = fr2[fr2.length - 1];
      const [fx, fy] = FACE_ROT[values[i]];
      const tx = fx + 360 * Math.round((last.rx - fx) / 360), ty = fy + 360 * Math.round((last.ry - fy) / 360);
      const tz = 90 * Math.round(last.rz / 90) + (Math.random() - 0.5) * 24;
      const from = Math.floor(fr2.length * 0.55);
      const step = Math.max(1, Math.floor(fr2.length / 90));
      const kf = [], sk = [];
      for (let k = 0; k < fr2.length; k += step) {
        const f = fr2[k];
        const u = k < from ? 0 : (k - from) / Math.max(1, fr2.length - 1 - from);
        const e = u * u * (3 - 2 * u);
        const rx = f.rx + (tx - last.rx) * e, ry = f.ry + (ty - last.ry) * e, rz = f.rz + (tz - last.rz) * e;
        const lift = f.z * 0.55, sc = 1 + f.z / (size * 9);
        kf.push({ offset: k / (fr2.length - 1), transform: `translate3d(${f.x}px, ${f.y - lift}px, 0) scale(${sc}) rotateZ(${rz}deg) rotateX(${rx}deg) rotateY(${ry}deg)` });
        sk.push({ offset: k / (fr2.length - 1), opacity: Math.max(0.25, 0.9 - f.z / (size * 5)), transform: `translate3d(${f.x + f.z * 0.25}px, ${f.y + size * 0.72}px, 0) scale(${1 + f.z / (size * 6)})` });
      }
      const endT = `translate3d(${last.x}px, ${last.y}px, 0) rotateZ(${tz}deg) rotateX(${tx}deg) rotateY(${ty}deg)`;
      kf.push({ offset: 1, transform: endT });
      sk.push({ offset: 1, opacity: 0.9, transform: `translate3d(${last.x}px, ${last.y + size * 0.72}px, 0) scale(1)` });
      const a = dice[i].el.animate(kf, { duration: dur, easing: 'linear', fill: 'forwards' });
      shadows[i].animate(sk, { duration: dur, easing: 'linear', fill: 'forwards' });
      anims.push(a.finished.then(() => { dice[i].el.style.transform = endT; }));
    }
    await Promise.all(anims);
    const cx = (frames[0].at(-1).x + frames[1].at(-1).x) / 2 + size / 2, cy = Math.min(frames[0].at(-1).y, frames[1].at(-1).y);
    total.style.left = `${cx}px`; total.style.top = `${Math.max(area.t + 40, cy)}px`;
    total.classList.add('show');
    // La bandeja lateral conserva el último resultado
    const tw = this.tray.clientWidth || 300, th = this.tray.clientHeight || 200;
    this.dice.forEach((d, i) => this.setDie(d, tw / 2 - 70 + i * 84, th / 2 - 28, values[i], i ? 12 : -8));
    this.totalEl.textContent = String(values[0] + values[1]);
    this.totalEl.classList.add('show');
    this.throwFade = setTimeout(() => { layer.classList.add('out'); setTimeout(() => layer.remove(), 400); }, 2600);
  }

  // ---------------------------------------------------------------- Apuestas
  async onZone(type, number) {
    if (this.busy) return;
    const s = this.table;
    if ((type === 'pass' || type === 'dontPass') && s.phase === 'point') {
      // Con punto: tocar Pass/Don't Pass agrega ODDS a esa apuesta
      const base = s.bets.find((b) => b.type === type && b.status === 'active');
      if (base) return this.addBet({ type: 'odds', on: base.id, amount: this.chip });
    }
    return this.addBet({ type, number, amount: this.chip });
  }

  async addBet(bet) {
    try {
      this.table = { ...this.table, ...(await this.api.request('/api/v1/table/bets', { method: 'POST', body: bet })) };
      this.sound.play('chip');
      this.render();
    } catch (e) { this.toast(e.message); }
  }

  async removeBet(id) {
    try {
      const r = await this.api.request(`/api/v1/table/bets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      this.table = { ...this.table, ...r };
      if (r.refunded) this.toast(`Retiraste ${this.fmt(r.refunded)}`);
      this.render();
    } catch (e) { this.toast(e.message); }
  }

  async undo() {
    const pend = this.table.bets.filter((b) => b.status === 'pending');
    if (pend.length) await this.removeBet(pend[pend.length - 1].id);
  }

  async clearPending() {
    for (const b of this.table.bets.filter((x) => x.status === 'pending')) await this.removeBet(b.id);
  }

  // ---------------------------------------------------------------- Tirada
  async throwDice(power, dir) {
    if (this.busy) return;
    if (!this.table.bets.length) { this.toast('Pon al menos una apuesta'); return; }
    this.busy = true;
    this.render();
    this.sound.unlock();
    let r;
    try {
      const clientRoundId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      r = await this.api.request('/api/v1/table/roll', { method: 'POST', body: { clientRoundId } });
    } catch (e) {
      this.toast(e.message);
      this.busy = false;
      this.render();
      return;
    }
    await this.animateDice(r.result.dice, power, dir);
    // Premios y pérdidas en la mesa
    let won = 0;
    for (const res of r.result.resolutions) {
      const z = this.zoneFor(res);
      if (!z) continue;
      if (res.outcome === 'win') {
        z.el.classList.add('win');
        won += res.payout;
        this.float(z.el, `+${this.fmt(res.payout)}`);
      } else if (res.outcome === 'lose') z.el.classList.add('lose');
    }
    if (won) this.sound.play('win'); else if (r.result.resolutions.some((x) => x.outcome === 'lose')) this.sound.play('lose');
    this.table = { ...this.table, ...r.table, balance: r.balance };
    this.winEl.textContent = this.fmt(r.win);
    // Premios por monto: en veces lo apostado en la tirada (o la apuesta mínima de la mesa si no se apostó nada nuevo)
    const stake = Math.max(r.cost || 0, this.game.rules?.limits?.min || 1);
    const tier = r.win > 0 ? winTierFor(this.game.theme, r.win / stake) : null;
    if (tier) await this.presentTier(tier, r.win);
    else if (r.win >= Math.max(r.cost, 1) * 15 && r.win > 0) await this.banner('¡GRAN PREMIO!', this.fmt(r.win));
    const msg = this.phaseMessage(r.result);
    if (msg) this.toast(msg);
    await wait(900);
    for (const z of this.zones.values()) z.el.classList.remove('win', 'lose');
    this.busy = false;
    this.render();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'casino:round', gameId: this.game.id, roundId: r.roundId, cost: r.cost, win: r.win, balance: r.balance }, '*');
    }
  }

  zoneFor(res) {
    if (res.type === 'place' || res.type === 'hard') return this.zones.get(`${res.type}${res.number}`);
    if (res.type === 'odds') {
      const base = this.table.bets.find((b) => b.id === res.on);
      return this.zones.get(base?.type === 'dontPass' ? 'dontPass' : 'pass');
    }
    return this.zones.get(res.type);
  }

  phaseMessage(r) {
    if (r.phaseBefore === 'comeOut' && r.point) return `Punto: ${r.point}`;
    if (r.phaseBefore === 'point' && r.total === r.pointBefore) return `¡Salió el punto ${r.total}!`;
    if (r.phaseBefore === 'point' && r.total === 7) return 'Siete: fin de la ronda';
    return null;
  }

  // ---------------------------------------------------------------- Dibujar estado
  render() {
    const s = this.table;
    if (!s) return;
    this.balEl.textContent = this.fmt(s.balance);
    this.onTableEl.textContent = this.fmt(s.onTable || 0);
    this.phaseEl.textContent = s.phase === 'point' ? `PUNTO: ${s.point} — gana el ${s.point} antes que el 7` : 'TIRADA DE SALIDA — 7 u 11 ganan en Pass';
    this.chipBtns.forEach((b, i) => b.classList.toggle('sel', this.levels[i] === this.chip));
    for (const [key, z] of this.zones) {
      z.chips.innerHTML = '';
      z.el.classList.toggle('point', key === `place${s.point}`);
      const off = (z.type === 'pass' || z.type === 'dontPass') ? (s.phase === 'point' && !s.bets.some((b) => b.type === z.type && b.status === 'active'))
        : (z.type === 'come' || z.type === 'dontCome') ? s.phase !== 'point' : false;
      z.el.classList.toggle('off', off);
      z.el.querySelector('.cr-puck')?.remove();
      if (key === `place${s.point}`) z.el.append(h('div', { class: 'cr-puck' }, 'ON'));
    }
    if (s.phase === 'comeOut' && this.zones.get('pass')) this.zones.get('pass').el.append(h('div', { class: 'cr-puck offp' }, 'OFF'));
    const chip = (b, label) => h('span', { class: `cr-chip ${b.status === 'pending' ? 'pending' : ''}`, title: b.status === 'pending' ? 'Pendiente: se cobra al tirar' : 'En juego' },
      `${label || ''}${this.fmt(b.amount)}`,
      (b.status === 'pending' || ['place', 'hard', 'odds'].includes(b.type)) ? h('span', { class: 'x', onclick: (e) => { e.stopPropagation(); if (!this.busy) this.removeBet(b.id); } }, '✕') : null);
    for (const b of s.bets) {
      let z;
      if (b.type === 'place' || b.type === 'hard') z = this.zones.get(`${b.type}${b.number}`);
      else if ((b.type === 'come' || b.type === 'dontCome') && b.point) z = this.zones.get(`place${b.point}`) || this.zones.get(b.type);
      else if (b.type === 'odds') {
        const base = s.bets.find((x) => x.id === b.on);
        z = base?.point ? this.zones.get(`place${base.point}`) : this.zones.get(base?.type === 'dontPass' ? 'dontPass' : 'pass');
      } else z = this.zones.get(b.type);
      if (!z) continue;
      const label = b.type === 'odds' ? 'ODDS ' : (b.type === 'come' && b.point) ? 'C ' : (b.type === 'dontCome' && b.point) ? 'DC ' : '';
      z.chips.append(chip(b, label));
      // Botón para agregar odds a las Come/Don't Come con punto
      if ((b.type === 'come' || b.type === 'dontCome') && b.point && this.game.rules.bets.odds) {
        z.chips.append(h('span', { class: 'cr-mini', onclick: (e) => { e.stopPropagation(); this.addBet({ type: 'odds', on: b.id, amount: this.chip }); } }, '+odds'));
      }
    }
    this.hist.innerHTML = '';
    for (const t of (s.history || []).slice(-14)) this.hist.append(h('span', { class: t === 7 ? 'seven' : '' }, String(t)));
    const pending = s.bets.some((b) => b.status === 'pending');
    this.undoBtn.disabled = this.busy || !pending;
    this.clearBtn.disabled = this.busy || !pending;
    this.rollBtn.disabled = this.busy || !s.bets.length;
  }

  // ---------------------------------------------------------------- Mensajes y reglas
  float(el, text) {
    const r = el.getBoundingClientRect();
    const f = h('div', { class: 'cr-float', style: `left:${r.left + r.width / 2 - 40}px; top:${r.top}px` }, text);
    document.body.append(f);
    setTimeout(() => f.remove(), 1300);
  }

  /** Premio por monto: su sonido y su video/GIF (con el importe encima) o su cartel. */
  async presentTier(tier, cents) {
    this.sound.play(tier.sound ? `winTier${tier.i}` : 'bigWin');
    if (tier.media) await playMediaOverlay(tier.media, tier.seconds ?? 3, { amount: this.fmt(cents), text: tier.text || '¡GRAN PREMIO!' });
    else await this.banner(tier.text || '¡GRAN PREMIO!', this.fmt(cents), { silent: true });
  }

  /** Vista previa: muestra el nivel i como si se hubiera ganado su monto mínimo con la apuesta mínima. */
  async demoTier(i) {
    const tier = (this.game.theme?.winTiers || [])[i];
    if (!tier) return;
    await this.presentTier({ ...tier, i }, Math.round((Number(tier.from) || 10) * (this.game.rules?.limits?.min || 100)));
  }

  async banner(small, big, { silent = false } = {}) {
    if (!silent) this.sound.play('bigWin');
    const b = h('div', { class: 'cr-banner' }, h('small', {}, small), h('b', {}, big));
    document.body.append(b);
    await wait(1800);
    b.remove();
  }

  toast(text) {
    this.toastEl?.remove();
    this.toastEl = h('div', { class: 'cr-toast' }, text);
    document.body.append(this.toastEl);
    const el = this.toastEl;
    setTimeout(() => el.remove(), 2600);
  }

  showRules() {
    const R = this.game.rules;
    const a = this.table?.analysis || {};
    const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(2)} %`);
    const pr = (r) => (Array.isArray(r) ? `${r[0]} a ${r[1]}` : `${r} a 1`);
    const rows = [];
    const add = (name, how, pays, rtp) => rows.push(h('tr', {}, h('td', {}, h('b', {}, name)), h('td', {}, how), h('td', {}, pays), h('td', {}, pct(rtp))));
    if (R.bets.pass) add('Pass Line', 'Salida: 7/11 gana, 2/3/12 pierde; si no, ese número es el punto y gana si sale antes que el 7.', '1 a 1', a.pass);
    if (R.bets.dontPass) add("Don't Pass", `Lo contrario de Pass. En la salida el ${R.dontBar} empata.`, '1 a 1', a.dontPass);
    if (R.bets.come) add('Come', 'Como Pass, pero se apuesta cuando ya hay punto.', '1 a 1', a.come);
    if (R.bets.dontCome) add("Don't Come", "Como Don't Pass, cuando ya hay punto.", '1 a 1', a.dontCome);
    if (R.bets.odds) add('Odds', `Apuesta extra detrás de Pass/Come (o Don't) con punto. Máximo ${Object.values(R.oddsMax).join('-')}× la apuesta. Toca la zona otra vez para agregarlas.`, 'probabilidad real', a.odds);
    if (R.bets.place) for (const n of [4, 5, 6, 8, 9, 10]) add(`Número ${n}`, `Gana si sale ${n} antes que 7. Queda en la mesa. Apagado en la salida.`, pr(R.pays.place[n]), a.place?.[n]);
    if (R.bets.field) add('Field', 'Una tirada: gana con 2, 3, 4, 9, 10, 11 o 12.', `1 a 1 (2: ${R.pays.field[2]} a 1, 12: ${R.pays.field[12]} a 1)`, a.field);
    if (R.bets.hard) for (const n of [4, 6, 8, 10]) add(`Hard ${n}`, `Gana si sale ${n / 2}+${n / 2} antes que 7 o que ${n} "fácil".`, pr(R.pays.hard[n]), a.hard?.[n]);
    if (R.bets.anyCraps) add('Any Craps', 'Una tirada: 2, 3 o 12.', pr(R.pays.anyCraps), a.anyCraps);
    if (R.bets.any7) add('Any 7', 'Una tirada: 7.', pr(R.pays.any7), a.any7);
    const modal = h('div', { class: 'cr-modal', onclick: (e) => { if (e.target === modal) modal.remove(); } },
      h('div', { class: 'cr-sheet' },
        h('button', { class: 'cr-icon close', onclick: () => modal.remove() }, '✕'),
        h('h2', {}, this.game.theme?.title || this.game.name),
        h('p', {}, 'Elige una ficha, toca las zonas para apostar y lanza los dados arrastrando en la bandeja o con TIRAR. Las apuestas nuevas se cobran al tirar; puedes deshacerlas antes. Los números, hardways y odds se pueden retirar con ✕.'),
        h('table', {}, h('tr', {}, h('th', {}, 'Apuesta'), h('th', {}, 'Cómo gana'), h('th', {}, 'Paga'), h('th', {}, 'RTP')), rows),
        h('p', { style: 'font-size:11px;opacity:.7' }, `Límites: mínimo ${this.fmt(R.limits.min)}, máximo ${this.fmt(R.limits.max)} por apuesta y ${this.fmt(R.limits.table)} en total. Los dados se tiran en el servidor con un generador aleatorio certificable. Juega con responsabilidad.`)));
    document.body.append(modal);
  }
}
