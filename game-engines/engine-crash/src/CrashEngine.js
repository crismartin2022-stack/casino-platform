// Motor 16 — CRASH (cliente): escenario PixiJS con el personaje, la curva y el multiplicador; dos paneles de apuesta
// con retiro automático; lista de apuestas reales de la ronda e historial verificable.
// El navegador NUNCA conoce el punto de explosión: el servidor dice cuándo empezó el vuelo y cuándo explotó; el
// multiplicador que se ve se calcula con la misma curva y el reloj del servidor. Al retirarse, paga el servidor.
import { Application, Container, Sprite, AnimatedSprite, Graphics, Text, Texture, Rectangle, Assets } from 'pixi.js';
import { SoundManager } from '../../shared/SoundManager.js';
import { formatMoney } from '../../shared/api.js';
import { canFullscreen, toggleFullscreen } from '../../shared/screen.js';
import { loadAnyFont, loadFontFile, playMediaOverlay } from '../../shared/media.js';

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
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Misma curva que el servidor (backend/math/crash.js)
const CURVE = { rate: 0.082, slowAt: 10, slowFactor: 0.5, rampSeconds: 1.5 };
export function multAt(sec, curve) {
  const { rate, slowAt, slowFactor, rampSeconds } = { ...CURVE, ...(curve || {}) };
  const t = Math.max(0, sec || 0);
  const full = Math.exp(rate * t);
  if (slowFactor >= 1 || slowAt <= 1 || rampSeconds <= 0 || full < slowAt) return full;
  const tSlow = Math.log(slowAt) / rate;
  const slowRate = rate * slowFactor;
  const slope = (slowRate - rate) / rampSeconds;
  if (t <= tSlow + rampSeconds) { const s = t - tSlow; return slowAt * Math.exp(rate * s + 0.5 * slope * s * s); }
  const ramp = rate * rampSeconds + 0.5 * slope * rampSeconds * rampSeconds;
  return slowAt * Math.exp(ramp + slowRate * (t - tSlow - rampSeconds));
}
const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;

const CSS = `
.cx { position: fixed; inset: 0; display: grid; grid-template-columns: minmax(250px, 300px) 1fr; gap: 10px; padding: 10px; color: var(--text); font-family: var(--cx-font);
  background: var(--cx-bg); overflow: hidden; }
.cx * { box-sizing: border-box; }
.cx button { font-family: inherit; }
.cx-side { display: flex; flex-direction: column; gap: 10px; min-height: 0; background: var(--cx-panel); border: 1px solid var(--cx-line); border-radius: 14px; padding: 10px; }
.cx-wallet { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--cx-panel2); border: 1px solid var(--cx-line); }
.cx-wallet .bal { flex: 1; min-width: 0; }
.cx-wallet small { display: block; font-size: 11px; opacity: .7; }
.cx-wallet b { font-size: 18px; color: var(--accent); white-space: nowrap; }
.cx-ico { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--cx-line); background: var(--cx-panel); color: var(--text); font-size: 16px; cursor: pointer; display: grid; place-items: center; flex: none; text-decoration: none; }
.cx-ico:hover { background: var(--cx-panel2); }
.cx-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 4px; border-radius: 12px; background: var(--cx-panel2); }
.cx-tabs button { border: 0; border-radius: 9px; padding: 8px 4px; background: transparent; color: var(--text); opacity: .75; font-weight: 700; font-size: 12px; cursor: pointer; }
.cx-tabs button.on { background: var(--accent); color: #1a1205; opacity: 1; }
.cx-count { font-size: 11px; opacity: .7; padding: 0 4px; }
.cx-list { flex: 1; min-height: 0; overflow: auto; font-size: 12px; }
.cx-list table { width: 100%; border-collapse: collapse; }
.cx-list th { text-align: left; font-weight: 600; opacity: .6; padding: 4px; position: sticky; top: 0; background: var(--cx-panel); }
.cx-list td { padding: 6px 4px; border-bottom: 1px solid var(--cx-line); white-space: nowrap; }
.cx-list td:nth-child(n+2), .cx-list th:nth-child(n+2) { text-align: right; }
.cx-list tr.mine td { color: var(--accent); }
.cx-list tr.cashed td { background: color-mix(in srgb, #22c55e 14%, transparent); }
.cx-list tr.cashed td:nth-child(3), .cx-list tr.cashed td:nth-child(4) { color: #4ade80; font-weight: 700; }
.cx-list tr.lost td { opacity: .5; }
.cx-list .empty { text-align: center; opacity: .6; padding: 24px 8px; white-space: normal; }
.cx-list .rnd { cursor: pointer; }
.cx-main { display: grid; grid-template-rows: 1fr auto auto; gap: 10px; min-height: 0; min-width: 0; }
.cx-stage { position: relative; min-height: 220px; border-radius: 16px; overflow: hidden; border: 1px solid var(--cx-line); background: var(--cx-panel2); }
.cx-stage canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; display: block; }
.cx-stage .cx-ico { position: absolute; top: 12px; right: 12px; background: #0006; }
.cx-tag { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); background: #f59e0b; color: #1a1205; font: 800 10px system-ui; padding: 3px 8px; border-radius: 6px; letter-spacing: .06em; }
.cx-hist { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cx-hist .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; box-shadow: 0 0 8px var(--accent); }
.cx-chips { display: flex; gap: 6px; overflow: hidden; flex: 1; min-width: 0; mask-image: linear-gradient(90deg, #000 85%, transparent); }
.cx-chip { flex: none; border: 1px solid var(--cx-line); background: var(--cx-panel); color: var(--text); border-radius: 999px; padding: 4px 10px; font: 700 12px var(--cx-font); cursor: pointer; }
.cx-chip.mid { color: #fbbf24; border-color: #fbbf2455; background: #fbbf2414; }
.cx-chip.hi { color: #c4b5fd; border-color: #8b5cf6; background: #6d28d933; }
.cx-chip.low { opacity: .75; }
.cx-histbtn { flex: none; border: 1px solid var(--cx-line); background: var(--cx-panel); color: var(--text); border-radius: 10px; padding: 6px 10px; font: 600 12px var(--cx-font); cursor: pointer; }
.cx-panels { display: grid; grid-template-columns: repeat(var(--np, 2), 1fr); gap: 10px; }
.cx-panel { background: var(--cx-panel); border: 1px solid var(--cx-line); border-radius: 14px; padding: 10px; display: grid; grid-template-columns: 1fr minmax(120px, 42%); grid-template-rows: auto auto auto; gap: 8px; }
.cx-panel.active { border-color: color-mix(in srgb, var(--accent) 60%, transparent); }
.cx-row { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.cx-tog { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--cx-line); border-radius: 999px; padding: 4px 6px 4px 10px; font-size: 12px; cursor: pointer; user-select: none; background: var(--cx-panel2); }
.cx-tog i { width: 26px; height: 14px; border-radius: 99px; background: #ffffff30; position: relative; transition: background .2s; }
.cx-tog i::after { content: ''; position: absolute; left: 2px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: #fff; transition: transform .2s; }
.cx-tog.on i { background: var(--accent); } .cx-tog.on i::after { transform: translateX(12px); }
.cx-auto { display: inline-flex; align-items: center; gap: 6px; }
.cx-auto input { width: 74px; text-align: right; }
.cx input { background: var(--cx-panel2); color: var(--text); border: 1px solid var(--cx-line); border-radius: 8px; padding: 6px 8px; font: 700 13px var(--cx-font); }
.cx input:disabled { opacity: .5; }
.cx-amt { display: grid; grid-template-columns: 30px 1fr 30px; gap: 4px; align-items: center; }
.cx-amt button { height: 32px; border-radius: 8px; border: 1px solid var(--cx-line); background: var(--cx-panel2); color: var(--text); font-weight: 800; cursor: pointer; }
.cx-amt input { width: 100%; height: 32px; text-align: right; }
.cx-quick { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
.cx-quick button { height: 26px; border-radius: 7px; border: 1px solid var(--cx-line); background: var(--cx-panel2); color: var(--text); font: 700 11px var(--cx-font); cursor: pointer; padding: 0; }
.cx-left { display: grid; gap: 6px; align-content: start; }
.cx-go { grid-row: 2 / 4; grid-column: 2; border: 0; border-radius: 12px; font: 800 15px var(--cx-font); cursor: pointer; color: #1a1205; background: linear-gradient(180deg, #fbbf24, #f59e0b);
  box-shadow: 0 4px 0 #b45309, 0 8px 18px #f59e0b44; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 6px; min-height: 64px; transition: transform .08s; }
.cx-go:active { transform: translateY(2px); box-shadow: 0 2px 0 #b45309; }
.cx-go small { font-size: 12px; font-weight: 700; opacity: .9; }
.cx-go.cancel { background: linear-gradient(180deg, #f87171, #dc2626); color: #fff; box-shadow: 0 4px 0 #991b1b; }
.cx-go.cash { background: linear-gradient(180deg, #4ade80, #16a34a); color: #052e12; box-shadow: 0 4px 0 #166534, 0 0 24px #22c55e66; }
.cx-go.wait { background: linear-gradient(180deg, #a78bfa, #7c3aed); color: #fff; box-shadow: 0 4px 0 #5b21b6; }
.cx-go:disabled { opacity: .55; cursor: default; }
.cx-modal { position: fixed; inset: 0; background: #000b; display: grid; place-items: center; z-index: 40; padding: 16px; }
.cx-sheet { position: relative; width: min(640px, 100%); max-height: 88vh; overflow: auto; background: var(--cx-panel); border: 1px solid var(--cx-line); border-radius: 16px; padding: 18px; font-family: var(--info-font, var(--cx-font)); }
.cx-sheet h2 { margin: 0 0 10px; color: var(--accent); }
.cx-sheet table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0; }
.cx-sheet td, .cx-sheet th { padding: 6px; border-bottom: 1px solid var(--cx-line); text-align: left; }
.cx-sheet code { display: block; word-break: break-all; font-size: 11px; background: var(--cx-panel2); padding: 6px 8px; border-radius: 8px; margin: 4px 0 8px; }
.cx-sheet .close { position: absolute; top: 12px; right: 12px; }
.cx-ok { color: #4ade80; font-weight: 800; } .cx-bad { color: #f87171; font-weight: 800; }
.cx-toast { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); background: #000d; color: #fff; padding: 10px 16px; border-radius: 10px; z-index: 45; font: 600 13px var(--cx-font); max-width: 90vw; text-align: center; }
.cx-float { position: fixed; z-index: 30; pointer-events: none; font: 900 20px var(--cx-font); color: #4ade80; text-shadow: 0 2px 8px #000; animation: cxfl 1.6s ease-out forwards; }
@keyframes cxfl { from { opacity: 0; transform: translateY(10px) scale(.8); } 15% { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-50px); } }
.cx-players { display: none; }
@media (max-width: 860px) {
  .cx { display: flex; flex-direction: column; overflow: auto; padding: 8px; gap: 8px; }
  .cx-side { order: 3; flex: none; min-height: auto; }
  .cx-side .cx-wallet { display: none; }
  .cx-side.fold .cx-tabs, .cx-side.fold .cx-list, .cx-side.fold .cx-count { display: none; }
  .cx-list { max-height: 60vh; }
  .cx-players { display: flex; align-items: center; justify-content: space-between; border: 0; background: none; color: var(--text); font: 700 14px var(--cx-font); padding: 4px; cursor: pointer; }
  .cx-players em { font-style: normal; background: var(--accent); color: #1a1205; border-radius: 99px; padding: 1px 9px; font-size: 12px; }
  .cx-main { display: flex; flex-direction: column; flex: none; }
  .cx-topw { display: flex !important; }
  .cx-stage { height: min(48vh, 360px); flex: none; }
  .cx-panels { grid-template-columns: 1fr; }
}
.cx-topw { display: none; }
`;

export class CrashEngine {
  constructor({ container, hudRoot, api, session, lobbyUrl }) {
    this.container = container;
    this.hudRoot = hudRoot;
    this.api = api;
    this.session = session;
    this.game = session.game;
    this.currency = session.currency;
    this.lobbyUrl = lobbyUrl;
    this.busy = false;
    this.offset = 0;
    this.table = null;
    this.tab = 'all';
    this.panels = [];
  }

  fmt(c) { return formatMoney(c, this.currency); }
  short(c) { const v = c / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2); }
  now() { return Date.now() + this.offset; }

  async init(progress = () => {}) {
    const t = this.game.theme || {};
    const p = t.palette || {};
    const root = document.documentElement.style;
    root.setProperty('--primary', p.primary || '#f59e0b');
    root.setProperty('--accent', p.accent || '#f59e0b');
    root.setProperty('--text', p.text || '#ffffff');
    root.setProperty('--cx-panel', p.panel || '#1d1433');
    root.setProperty('--cx-panel2', p.reelBg || '#2a1d4a');
    root.setProperty('--cx-line', `color-mix(in srgb, ${p.text || '#ffffff'} 10%, transparent)`);
    root.setProperty('--cx-bg', t.background ? `url("${t.background}") center / cover, ${t.backgroundColor || '#120a24'}` : (t.backgroundColor || '#120a24'));
    root.setProperty('--cx-font', `'${t.font || 'Rubik'}', system-ui, sans-serif`);
    if (t.infoFont) root.setProperty('--info-font', `'${String(t.infoFont).replace(/'/g, '')}', system-ui, sans-serif`);
    if (t.fontUrl) await loadFontFile(t.font, t.fontUrl);
    else await loadAnyFont(t.font || 'Rubik', null).catch(() => {});
    await loadAnyFont(t.infoFont, t.infoFontUrl).catch(() => {});
    document.head.append(h('style', {}, CSS));
    progress(0.2, 'Preparando el escenario…');
    const tierSounds = Object.fromEntries((t.winTiers || []).map((x, i) => [`winTier${i}`, x?.sound || null]));
    this.sound = new SoundManager({ ...(this.game.sounds || {}), ...tierSounds }, this.game.soundVolumes || {});
    const unlock = () => { this.sound.unlock(); this.sound.playMusic('music'); };
    window.addEventListener('pointerdown', unlock, { once: true });
    this.build();
    this.stage = new CrashStage(this, this.stageEl);
    await this.stage.init((x) => progress(0.2 + x * 0.7, 'Cargando el personaje…'));
    await this.poll();
    this.loop();
    this.ambient();
    progress(1, 'Listo');
  }

  // ---------------------------------------------------------------- Construcción de la pantalla
  build() {
    const R = this.game.rules;
    const preview = this.session.source === 'draft';
    this.balEl = h('b', {}, '—');
    this.balEl2 = h('b', {}, '—');
    const icons = () => [
      h('button', { class: 'cx-ico', title: 'Sonido', onclick: (e) => { e.currentTarget.textContent = this.sound.toggleMute() ? '🔇' : '🔊'; } }, this.sound.muted ? '🔇' : '🔊'),
      h('button', { class: 'cx-ico', title: 'Reglas', onclick: () => this.showRules() }, 'ⓘ'),
      this.lobbyUrl ? h('a', { class: 'cx-ico', href: this.lobbyUrl, title: 'Volver' }, '⟵') : null,
    ];
    this.countEl = h('div', { class: 'cx-count' }, '');
    this.listEl = h('div', { class: 'cx-list' });
    this.tabsEl = h('div', { class: 'cx-tabs' },
      ...[['all', 'Apuestas'], ['mine', 'Mías'], ['rounds', 'Rondas']].map(([k, l]) => h('button', { class: k === this.tab ? 'on' : '', 'data-tab': k, onclick: () => this.setTab(k) }, l)));
    this.playersBtn = h('button', { class: 'cx-players', onclick: () => this.side.classList.toggle('fold') }, 'Jugadores y apuestas', h('em', {}, '0'));
    this.side = h('aside', { class: 'cx-side fold' },
      h('div', { class: 'cx-wallet' }, h('div', { class: 'bal' }, h('small', {}, 'Saldo'), this.balEl), ...icons()),
      this.playersBtn, this.tabsEl, this.countEl, this.listEl);
    if (matchMedia('(min-width: 861px)').matches) this.side.classList.remove('fold');
    this.stageEl = h('div', { class: 'cx-stage' },
      preview ? h('span', { class: 'cx-tag' }, 'VISTA PREVIA') : null,
      canFullscreen() ? h('button', { class: 'cx-ico', title: 'Pantalla completa', onclick: () => toggleFullscreen() }, '⛶') : null);
    this.chipsEl = h('div', { class: 'cx-chips' });
    const hist = h('div', { class: 'cx-hist' }, h('i', { class: 'dot' }), this.chipsEl, h('button', { class: 'cx-histbtn', onclick: () => this.setTab('rounds', true) }, '🕘 Historial'));
    const n = Math.max(1, Math.min(2, R.maxBets || 2));
    this.panelsEl = h('div', { class: 'cx-panels', style: `--np:${n}` });
    for (let i = 0; i < n; i++) this.panels.push(this.buildPanel(i));
    const topw = h('div', { class: 'cx-wallet cx-topw' }, h('div', { class: 'bal' }, h('small', {}, 'Saldo'), this.balEl2), ...icons());
    this.main = h('main', { class: 'cx-main' }, topw, this.stageEl, hist, this.panelsEl);
    this.root = h('div', { class: 'cx' }, this.side, this.main);
    this.hudRoot.append(this.root);
  }

  buildPanel(i) {
    const R = this.game.rules;
    const L = R.limits || {};
    const levels = this.game.bet?.levels || [100, 500, 2000, 10000];
    const P = { i, amount: clamp(levels[0], L.min || 1, L.max || 1e12), autoBet: false, autoCash: false, autoX: 2, queued: false };
    const amt = h('input', { inputmode: 'decimal', value: (P.amount / 100).toFixed(2), 'aria-label': 'Importe' });
    const setAmt = (c) => { P.amount = clamp(Math.round(c), L.min || 1, L.max || 1e12); amt.value = (P.amount / 100).toFixed(2); this.renderPanel(P); };
    amt.addEventListener('change', () => setAmt(Math.round(Number(String(amt.value).replace(',', '.')) * 100) || P.amount));
    const step = levels[0];
    const autoIn = h('input', { inputmode: 'decimal', value: P.autoX.toFixed(2), 'aria-label': 'Retiro automático' });
    autoIn.addEventListener('change', () => { const v = floor2(Number(String(autoIn.value).replace(',', '.'))); P.autoX = clamp(Number.isFinite(v) ? v : 2, R.autoMin || 1.01, R.maxMultiplier || 1000); autoIn.value = P.autoX.toFixed(2); });
    const tog = (label, key) => {
      const el = h('span', { class: 'cx-tog', role: 'switch', onclick: () => { P[key] = !P[key]; el.classList.toggle('on', P[key]); this.sound.play('click'); this.renderPanel(P); if (key === 'autoBet' && P[key] && !P.bet) this.maybeQueue(P); } }, label, h('i'));
      return el;
    };
    P.go = h('button', { class: 'cx-go', onclick: () => this.onGo(P) }, 'APOSTAR');
    P.amtIn = amt; P.autoIn = autoIn;
    P.autoBetEl = tog('Apuesta automática', 'autoBet');
    P.autoCashEl = tog('Retiro auto', 'autoCash');
    P.el = h('div', { class: 'cx-panel' },
      h('div', { class: 'cx-row' }, P.autoBetEl, h('span', { class: 'cx-auto' }, P.autoCashEl, autoIn, h('b', {}, '×'))),
      h('div', { class: 'cx-left' },
        h('div', { class: 'cx-amt' }, h('button', { onclick: () => setAmt(P.amount - step) }, '−'), amt, h('button', { onclick: () => setAmt(P.amount + step) }, '+')),
        h('div', { class: 'cx-quick' }, ...levels.slice(0, 4).map((lv) => h('button', { onclick: () => setAmt(P.amount + lv) }, `+${this.short(lv)}`)),
          h('button', { onclick: () => setAmt(P.amount / 2) }, '½'), h('button', { onclick: () => setAmt(P.amount * 2) }, '2×'))),
      P.go);
    this.panelsEl.append(P.el);
    return P;
  }

  // ---------------------------------------------------------------- Sincronización con el servidor
  async poll() {
    const t0 = Date.now();
    const d = await this.api.request('/api/v1/crash');
    const t1 = Date.now();
    // Diferencia de reloj con el servidor (mitad del viaje de ida y vuelta)
    const off = d.table.serverNow - (t0 + t1) / 2;
    this.offset = this.table ? this.offset * 0.7 + off * 0.3 : off;
    this.apply(d);
    return d;
  }

  async loop() {
    for (;;) {
      const ph = this.table?.phase;
      await wait(ph === 'flying' ? 200 : ph === 'betting' ? 500 : 700);
      try { await this.poll(); } catch (e) { if (e.status === 401) { this.toast('La sesión terminó. Vuelve a abrir el juego.'); return; } }
    }
  }

  apply(d) {
    const prev = this.table;
    this.table = d.table;
    this.limits = d.limits;
    this.setBalance(d.balance);
    const T = d.table;
    if (!prev || prev.phase !== T.phase || prev.roundNo !== T.roundNo) this.onPhase(T, prev);
    // Mis apuestas de la ronda en cada panel
    for (const P of this.panels) {
      const b = T.mine.find((x) => x.panel === P.i);
      const before = P.bet;
      if (b) P.bet = b;
      else if (P.bet && P.bet.roundNo !== T.roundNo) P.bet = null;
      if (b && before?.status === 'active' && b.status === 'cashed' && !P.cashShown) this.cashedFx(P, b);
      if (b) b.roundNo = T.roundNo;
      this.renderPanel(P);
    }
    this.renderList();
    this.renderChips();
    this.playersBtn.lastChild.textContent = String(T.players);
  }

  onPhase(T, prev) {
    this.stage.setPhase(T);
    if (T.phase === 'betting') {
      this.sound.play('timer');
      for (const P of this.panels) {
        P.cashShown = false;
        if (P.bet && P.bet.roundNo !== T.roundNo) P.bet = null;
        if (P.queued || (P.autoBet && !P.bet)) { P.queued = false; this.placeBet(P); }
      }
    } else if (T.phase === 'flying') {
      this.sound.play('start');
    } else if (T.phase === 'crashed') {
      this.sound.play('crash');
      const mine = T.mine.filter((b) => b.status === 'cashed');
      const best = mine.sort((a, b) => b.win - a.win)[0];
      if (best && prev) this.maybeTier(best);
      if (this.tab === 'mine') this.loadMine();
    }
  }

  setBalance(c) {
    if (c == null) return;
    this.balance = c;
    this.balEl.textContent = this.fmt(c);
    this.balEl2.textContent = this.fmt(c);
  }

  // ---------------------------------------------------------------- Apuestas
  async onGo(P) {
    this.sound.play('click');
    const T = this.table;
    if (!T) return;
    if (P.bet?.status === 'active' && T.phase === 'flying') return this.cashout(P);
    if (P.bet?.status === 'active' && T.phase === 'betting') return this.cancel(P);
    if (P.queued) { P.queued = false; this.renderPanel(P); return; }
    if (T.phase === 'betting' && Date.now() + this.offset < T.endsAt - 300) return this.placeBet(P);
    P.queued = true; // va a la próxima ronda
    this.renderPanel(P);
  }

  maybeQueue(P) {
    if (this.table?.phase === 'betting') this.placeBet(P); else { P.queued = true; this.renderPanel(P); }
  }

  async placeBet(P) {
    if (P.sending) return;
    if (this.balance != null && P.amount > this.balance) { this.toast('Saldo insuficiente'); P.autoBet = false; P.autoBetEl.classList.remove('on'); this.renderPanel(P); return; }
    P.sending = true;
    try {
      const d = await this.api.request('/api/v1/crash/bets', { method: 'POST', body: { amount: P.amount, panel: P.i, auto: P.autoCash ? P.autoX : null, clientBetId: `${Date.now().toString(36)}-${P.i}-${Math.random().toString(36).slice(2, 8)}` } });
      this.sound.play('bet');
      this.apply(d);
    } catch (e) {
      if (e.status === 409 && /próxima/.test(e.message)) P.queued = true;
      else this.toast(e.message);
    } finally { P.sending = false; this.renderPanel(P); }
  }

  async cancel(P) {
    try { this.apply(await this.api.request(`/api/v1/crash/bets/${encodeURIComponent(P.bet.id)}`, { method: 'DELETE' })); P.bet = null; this.renderPanel(P); }
    catch (e) { this.toast(e.message); }
  }

  async cashout(P) {
    if (P.sending) return;
    P.sending = true;
    try {
      const d = await this.api.request(`/api/v1/crash/bets/${encodeURIComponent(P.bet.id)}/cashout`, { method: 'POST' });
      this.apply(d);
    } catch (e) { this.toast(e.message); }
    finally { P.sending = false; this.renderPanel(P); }
  }

  cashedFx(P, b) {
    P.cashShown = true;
    this.sound.play('cashout');
    const r = P.go.getBoundingClientRect();
    const f = h('div', { class: 'cx-float', style: `left:${r.left + 8}px; top:${r.top - 10}px` }, `+${this.fmt(b.win)} · ×${b.cashout.toFixed(2)}`);
    document.body.append(f);
    setTimeout(() => f.remove(), 1700);
    this.stage.cashFlash(b.cashout);
  }

  renderPanel(P) {
    const T = this.table;
    const b = P.bet;
    const go = P.go;
    go.className = 'cx-go';
    go.disabled = false;
    const live = T?.phase === 'flying' ? floor2(multAt((this.now() - T.flightStart) / 1000, T.curve)) : 1;
    let big = 'APOSTAR', small = this.fmt(P.amount);
    if (b?.status === 'active' && T?.phase === 'flying') { go.classList.add('cash'); big = 'RETIRAR'; small = this.fmt(Math.floor(b.amount * live)); }
    else if (b?.status === 'active' && T?.phase === 'betting') { go.classList.add('cancel'); big = 'CANCELAR'; small = this.fmt(b.amount); }
    else if (b?.status === 'cashed') { go.classList.add('cash'); go.disabled = true; big = `¡+${this.fmt(b.win)}!`; small = `×${b.cashout.toFixed(2)}`; }
    else if (P.queued) { go.classList.add('wait'); big = 'ESPERANDO'; small = 'próxima ronda · tocar para cancelar'; }
    else if (T && T.phase !== 'betting') { big = 'APOSTAR'; small = `${this.fmt(P.amount)} · próxima ronda`; }
    if (P.sending) go.disabled = true;
    go.replaceChildren(h('span', {}, big), h('small', {}, small));
    P.el.classList.toggle('active', !!b && b.status === 'active');
    const lock = !!b && b.status === 'active';
    P.amtIn.disabled = lock; P.autoIn.disabled = lock || !P.autoCash;
  }

  /** Cada cuadro: el botón RETIRAR muestra cuánto se cobraría ahora. */
  tickPanels() {
    if (this.table?.phase !== 'flying') return;
    for (const P of this.panels) if (P.bet?.status === 'active') this.renderPanel(P);
  }

  // ---------------------------------------------------------------- Lista e historial
  setTab(k, open = false) {
    this.tab = k;
    if (open) this.side.classList.remove('fold');
    for (const b of this.tabsEl.children) b.classList.toggle('on', b.dataset.tab === k);
    if (k === 'mine') this.loadMine();
    this.renderList();
  }

  async loadMine() {
    try {
      const rows = await this.api.history(30);
      this.mineHist = rows.filter((r) => r.play_mode === 'crash' && r.game_id === this.game.id);
    } catch { this.mineHist = []; }
    if (this.tab === 'mine') this.renderList();
  }

  renderList() {
    const T = this.table;
    if (!T) return;
    if (this.tab === 'all') {
      this.countEl.textContent = `${T.players} ${T.players === 1 ? 'apuesta' : 'apuestas'} en esta ronda`;
      const rows = T.bets.map((b) => h('tr', { class: `${b.mine ? 'mine' : ''} ${b.status}` },
        h('td', {}, b.mine ? 'Tú' : b.name), h('td', {}, formatMoney(b.amount, b.currency)), h('td', {}, b.cashout ? `×${b.cashout.toFixed(2)}` : '—'), h('td', {}, b.win ? formatMoney(b.win, b.currency) : '—')));
      this.listEl.replaceChildren(h('table', {}, h('tr', {}, h('th', {}, 'Jugador'), h('th', {}, 'Apuesta'), h('th', {}, '×'), h('th', {}, 'Premio')),
        rows.length ? rows : h('tr', {}, h('td', { class: 'empty', colspan: 4 }, 'Todavía nadie apostó en esta ronda. ¡Sé el primero!'))));
    } else if (this.tab === 'mine') {
      const rows = (this.mineHist || []).map((r) => {
        const st = r.status;
        const ok = r.win > 0 && st === 'completed';
        return h('tr', { class: ok ? 'cashed mine' : st === 'completed' ? 'lost' : '' },
          h('td', {}, (r.created_at || '').slice(11, 16)), h('td', {}, this.fmt(r.cost)), h('td', {}, st === 'cancelled' ? 'cancelada' : st === 'void' ? 'devuelta' : ok ? `×${(r.win / r.cost).toFixed(2)}` : '—'), h('td', {}, ok ? this.fmt(r.win) : '—'));
      });
      this.countEl.textContent = 'Tus últimas apuestas';
      this.listEl.replaceChildren(h('table', {}, h('tr', {}, h('th', {}, 'Hora'), h('th', {}, 'Apuesta'), h('th', {}, '×'), h('th', {}, 'Premio')),
        rows.length ? rows : h('tr', {}, h('td', { class: 'empty', colspan: 4 }, 'Todavía no apostaste.'))));
    } else {
      this.countEl.textContent = 'Toca una ronda para verificarla';
      const rows = T.history.map((r) => h('tr', { class: 'rnd', onclick: () => this.showVerify(r) }, h('td', {}, `#${r.roundNo}`), h('td', { style: `color:${this.chipColor(r.crash)}` }, `×${r.crash.toFixed(2)}`), h('td', {}, '🔒 verificar')));
      this.listEl.replaceChildren(h('table', {}, h('tr', {}, h('th', {}, 'Ronda'), h('th', {}, 'Explotó'), h('th', {}, '')), rows));
    }
  }

  chipColor(x) { return x >= 10 ? '#c4b5fd' : x >= 2 ? '#fbbf24' : 'inherit'; }

  renderChips() {
    const H = this.table?.history || [];
    const key = H.map((x) => x.roundNo).join(',');
    if (key === this.chipsKey) return;
    this.chipsKey = key;
    this.chipsEl.replaceChildren(...H.slice(0, 20).map((r) => h('button', { class: `cx-chip ${r.crash >= 10 ? 'hi' : r.crash >= 2 ? 'mid' : 'low'}`, title: `Ronda #${r.roundNo}`, onclick: () => this.showVerify(r) }, `×${r.crash.toFixed(2)}`)));
  }

  /** Verificación en el propio navegador: sha256(semilla) = hash publicado y el mismo punto de explosión. */
  async showVerify(r) {
    const R = this.game.rules;
    const out = h('p', {}, 'Verificando…');
    const modal = h('div', { class: 'cx-modal', onclick: (e) => { if (e.target === modal) modal.remove(); } },
      h('div', { class: 'cx-sheet' }, h('button', { class: 'cx-ico close', onclick: () => modal.remove() }, '✕'),
        h('h2', {}, `Ronda #${r.roundNo} · ×${r.crash.toFixed(2)}`),
        h('p', {}, 'Antes de que empiece cada ronda se publica el hash de una semilla secreta. Cuando explota se revela la semilla: con ella cualquiera puede comprobar que el punto de explosión estaba fijado antes de las apuestas.'),
        h('b', {}, 'Hash publicado antes de la ronda'), h('code', {}, r.hash),
        h('b', {}, 'Semilla revelada'), h('code', {}, r.seed || '—'),
        h('small', {}, `Fórmula: u = primeros 52 bits de HMAC-SHA256(semilla, "crash") / 2^52; explosión = piso(${R.rtp} / (1 − u)) con 2 decimales, mínimo ×1,00 y máximo ×${R.maxMultiplier}.`),
        out));
    document.body.append(modal);
    try {
      const enc = new TextEncoder();
      const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
      const hash = hex(await crypto.subtle.digest('SHA-256', enc.encode(r.seed)));
      const key = await crypto.subtle.importKey('raw', enc.encode(r.seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const mac = hex(await crypto.subtle.sign('HMAC', key, enc.encode('crash')));
      const u = parseInt(mac.slice(0, 13), 16) / 2 ** 52;
      const crash = Math.min(Math.max(1, floor2(R.rtp / (1 - u))), R.maxMultiplier);
      const ok = hash === r.hash && Math.abs(crash - r.crash) < 1e-9;
      out.replaceChildren(h('span', { class: ok ? 'cx-ok' : 'cx-bad' }, ok ? '✔ Verificada: ' : '✖ No coincide: '),
        `sha256(semilla) ${hash === r.hash ? '=' : '≠'} hash publicado; punto recalculado ×${crash.toFixed(2)}.`);
    } catch { out.textContent = 'Este navegador no permite verificar aquí (necesita una conexión segura, https).'; }
  }

  // ---------------------------------------------------------------- Premios por monto, reglas y avisos
  winTiers() {
    return (this.game.theme?.winTiers || []).map((t, i) => ({ ...t, i, from: Number(t.from) })).filter((t) => t.from > 0).sort((a, b) => a.from - b.from);
  }

  async maybeTier(b) {
    const x = b.win / b.amount;
    const tier = this.winTiers().filter((t) => x >= t.from).pop();
    if (tier) await this.presentTier(tier, b.win);
  }

  async presentTier(tier, cents) {
    this.sound.play(tier.sound ? `winTier${tier.i}` : 'bigWin');
    if (tier.media) await playMediaOverlay(tier.media, tier.seconds ?? 3, { amount: this.fmt(cents), text: tier.text || '¡GRAN PREMIO!', cap: tier });
    else this.toast(`${tier.text || '¡GRAN PREMIO!'} ${this.fmt(cents)}`);
  }

  async demoTier(i) {
    const tier = this.winTiers().find((x) => x.i === i);
    if (tier) await this.presentTier(tier, Math.round(tier.from * (this.game.bet?.default || 100)));
  }

  /** Sonido ambiente de vez en cuando (solo decorativo). */
  ambient() {
    const next = () => setTimeout(() => { if (this.table?.phase !== 'flying') this.sound.play('ambient'); next(); }, 25000 + Math.random() * 30000);
    next();
  }

  toast(text) {
    this.toastEl?.remove();
    this.toastEl = h('div', { class: 'cx-toast' }, text);
    document.body.append(this.toastEl);
    const el = this.toastEl;
    setTimeout(() => el.remove(), 2600);
  }

  showRules() {
    const R = this.game.rules;
    const L = this.limits || R.limits || {};
    const pct = (x) => `${(x * 100).toFixed(2)} %`;
    const rows = [1.5, 2, 3, 5, 10, 100].filter((x) => x <= R.maxMultiplier).map((x) => h('tr', {}, h('td', {}, `×${x.toFixed(2)}`), h('td', {}, pct(Math.min(1, R.rtp / x))), h('td', {}, pct(R.rtp))));
    const modal = h('div', { class: 'cx-modal', onclick: (e) => { if (e.target === modal) modal.remove(); } },
      h('div', { class: 'cx-sheet' }, h('button', { class: 'cx-ico close', onclick: () => modal.remove() }, '✕'),
        h('h2', {}, this.game.theme?.title || this.game.name),
        h('p', {}, 'Apuesta durante la cuenta regresiva. Cuando empieza la ronda el multiplicador sube desde ×1,00: toca RETIRAR para cobrar tu apuesta por el multiplicador de ese momento. Si explota antes de que te retires, pierdes la apuesta.'),
        h('p', {}, `Puedes tener ${R.maxBets} apuesta${R.maxBets > 1 ? 's' : ''} por ronda. Con «Retiro auto» te retiras solo al llegar al multiplicador que elijas; con «Apuesta automática» se vuelve a apostar en cada ronda. Si apuestas mientras la ronda está en juego, la apuesta queda para la próxima.`),
        h('p', {}, `RTP: ${pct(R.rtp)}, el mismo para cualquier forma de jugar. El ${pct(1 - R.rtp)} de las rondas explota en ×1,00. Tope: ×${R.maxMultiplier} (al llegar se retira solo).`),
        h('table', {}, h('tr', {}, h('th', {}, 'Retirarse en'), h('th', {}, 'Probabilidad de llegar'), h('th', {}, 'Retorno')), rows),
        h('p', { style: 'font-size:12px;opacity:.75' }, `Apuesta mínima ${this.fmt(L.min)}, máxima ${this.fmt(L.max)}${L.maxPayout ? `; premio máximo por apuesta ${this.fmt(L.maxPayout)}` : ''}. El punto de explosión lo fija el servidor antes de cada ronda (con su hash publicado) y se puede verificar en «Rondas». Si se corta la conexión, el retiro automático se cumple igual. Juega con responsabilidad.`)));
    document.body.append(modal);
  }
}

// =====================================================================================================
// Escenario PixiJS: cielo, estrellas, luna, murciélagos, fondo en capas, ejes, curva y personaje
// =====================================================================================================
class CrashStage {
  constructor(engine, el) {
    this.e = engine;
    this.el = el;
    this.T = null;
    this.parallax = [];
    this.stars = [];
    this.bats = [];
    this.flash = 0;
  }

  async loadAtlas(json, image) {
    if (!json || !image) return null;
    // El .json puede venir como archivo o ya dentro del diseño (lista de cuadros)
    const [data, tex] = await Promise.all([typeof json === 'object' ? json : fetch(json).then((r) => r.json()), Assets.load(image)]);
    const frames = (Array.isArray(data.frames) ? data.frames : Object.entries(data.frames).map(([filename, f]) => ({ filename, ...f })))
      .slice().sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
    return frames.map((f) => ({ name: f.filename, tex: new Texture({ source: tex.source, frame: new Rectangle(f.frame.x, f.frame.y, f.frame.w, f.frame.h) }) }));
  }

  async init(progress) {
    const C = this.e.game.theme?.crash || {};
    const A = C.atlases || {};
    this.C = C;
    this.app = new Application();
    await this.app.init({ resizeTo: this.el, backgroundAlpha: 0, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
    this.el.prepend(this.app.canvas);
    const safe = (p) => p.catch((err) => { console.warn('[crash] recurso no disponible', err); return null; });
    let done = 0;
    const step = (p) => p.then((x) => { progress(++done / 8); return x; });
    const [bg, bats, details, idle, run, explode, fly, logo] = await Promise.all([
      step(safe(this.loadAtlas(A.bg, A.bgImage))), step(safe(this.loadAtlas(A.bats, A.batsImage))), step(safe(this.loadAtlas(A.details, A.detailsImage))),
      step(safe(this.loadAtlas(A.idle, A.idleImage))), step(safe(this.loadAtlas(A.run, A.runImage))), step(safe(this.loadAtlas(A.explode, A.explodeImage))),
      step(safe(this.loadAtlas(A.fly, A.flyImage))), step(safe(this.e.game.theme?.logo ? Assets.load(this.e.game.theme.logo) : Promise.resolve(null))),
    ]);
    const S = this.app.stage;
    // Cielo
    this.sky = new Sprite(this.skyTexture(C.sky || ['#27194c', '#3e2968', '#563c7c', '#755799']));
    S.addChild(this.sky);
    this.skyLayer = new Container();
    S.addChild(this.skyLayer);
    const star = details?.find((f) => f.name === 'star')?.tex;
    const moon = details?.find((f) => f.name === 'moon')?.tex;
    if (star) for (let i = 0; i < 18; i++) {
      const s = new Sprite(star);
      s.anchor.set(0.5);
      s.scale.set(0.45 + Math.random() * 0.25);
      s.base = 0.35 + Math.random() * 0.4; s.ph = Math.random() * 6.28; s.sp = 0.015 + Math.random() * 0.03; s.fx = Math.random(); s.fy = Math.random() * 0.48;
      this.stars.push(s); this.skyLayer.addChild(s);
    }
    if (moon) { this.moon = new Sprite(moon); this.moon.anchor.set(0.5); this.moon.tint = 0xddd2f0; this.skyLayer.addChild(this.moon); }
    if (bats?.length) for (let i = 0; i < 5; i++) {
      const b = new AnimatedSprite(bats.map((f) => f.tex));
      b.anchor.set(0.5); b.animationSpeed = 0.2 + Math.random() * 0.12; b.gotoAndPlay(Math.floor(Math.random() * bats.length));
      const k = 0.7 + Math.random() * 0.5;
      b.scale.set(k); b.alpha = 0.6 + Math.random() * 0.35; b.fx = Math.random(); b.fy = 0.08 + Math.random() * 0.4; b.vx = -(1 + Math.random() * 1.3) * k; b.ph = Math.random() * 6.28;
      this.bats.push(b); this.skyLayer.addChild(b);
    }
    // Fondo en capas (de atrás hacia adelante)
    this.ground = new Container();
    S.addChild(this.ground);
    const byName = Object.fromEntries((bg || []).map((f) => [f.name, f.tex]));
    for (const [name, speed] of [['detail3', 0.35], ['detail2', 0.7], ['detail1', 1.25]]) {
      if (!byName[name]) continue;
      const layer = { tex: byName[name], speed, c: new Container(), x: 0 };
      this.ground.addChild(layer.c);
      this.parallax.push(layer);
    }
    // Ejes, curva y textos
    this.grid = new Graphics(); S.addChild(this.grid);
    this.labels = new Container(); S.addChild(this.labels);
    this.curve = new Graphics(); S.addChild(this.curve);
    // Personaje
    this.char = new Container();
    const anim = (frames, speed, loop, scale) => {
      if (!frames?.length) return null;
      const a = new AnimatedSprite(frames.map((f) => f.tex));
      a.anchor.set(0.5); a.animationSpeed = speed; a.loop = loop; a.visible = false; a.scale.set(scale);
      this.char.addChild(a);
      return a;
    };
    this.shadow = new Graphics().ellipse(0, 44, 30, 8).fill({ color: 0x0a0515, alpha: 0.55 });
    this.char.addChild(this.shadow);
    this.anims = { IDLE: anim(idle, 0.25, true, 1.5), RUN: anim(run, 0.35, true, 1.5), EXPLODE: anim(explode, 0.44, false, 2), FLY: anim(fly, 0.4, true, 2) };
    S.addChild(this.char);
    // Logo
    if (logo) { this.logo = new Sprite(logo); S.addChild(this.logo); }
    const font = getComputedStyle(document.documentElement).getPropertyValue('--cx-font') || 'system-ui';
    this.multText = new Text({ text: '', style: { fontFamily: font, fontSize: 64, fontWeight: '900', fill: C.multColor || '#ffffff', align: 'center', dropShadow: { alpha: 0.6, blur: 14, color: '#000000', distance: 4 } } });
    this.multText.anchor.set(0.5);
    this.subText = new Text({ text: '', style: { fontFamily: font, fontSize: 18, fontWeight: '800', fill: '#ffffff', align: 'center', letterSpacing: 2, dropShadow: { alpha: 0.6, blur: 8, color: '#000000', distance: 2 } } });
    this.subText.anchor.set(0.5);
    this.bar = new Graphics();
    this.count = new Text({ text: '', style: { fontFamily: font, fontSize: 12, fontWeight: '700', fill: '#cbbfe6' } });
    S.addChild(this.multText, this.subText, this.bar, this.count);
    this.setChar('IDLE');
    this.layout();
    this.app.renderer.on('resize', () => { this.layout(); this.axesKey = null; });
    this.app.ticker.add((tk) => this.update(tk.deltaMS));
  }

  skyTexture(stops) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 512;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 512);
    stops.forEach((s, i) => grad.addColorStop(i / Math.max(1, stops.length - 1), s));
    g.fillStyle = grad; g.fillRect(0, 0, 16, 512);
    return Texture.from(c);
  }

  layout() {
    const w = this.app.screen.width, H = this.app.screen.height;
    this.w = w; this.h = H;
    this.mobile = w < 640;
    this.sky.width = w; this.sky.height = H;
    for (const s of this.stars) { s.x = s.fx * w; s.y = s.fy * H; }
    if (this.moon) { this.moon.x = w * 0.86; this.moon.scale.set(this.mobile ? 0.85 : 1.05); }
    const k = Math.min(1, Math.max(0.6, H / 320));
    for (const L of this.parallax) {
      L.c.removeChildren();
      const sw = L.tex.width * k;
      const n = Math.max(3, Math.ceil(w / sw) + 2);
      for (let i = 0; i < n; i++) { const s = new Sprite(L.tex); s.scale.set(k); s.x = i * (sw - 1); s.y = H - L.tex.height * k; L.c.addChild(s); }
      L.w = sw - 1;
    }
    // Área del gráfico
    this.x0 = this.mobile ? 34 : 48; this.x1 = w - (this.mobile ? 16 : 26);
    this.y0 = H - (this.mobile ? 30 : 36); this.y1 = this.mobile ? 50 : 70;
    if (this.logo) { const th = this.mobile ? 40 : 56; this.logo.scale.set(th / this.logo.texture.height); this.logo.position.set(this.mobile ? 50 : 52, 10); }
    const cs = (this.mobile ? 0.28 : 0.42) * (Number(this.C.characterScale) || 1);
    this.char.scale.set(cs);
    this.multText.style.fontSize = this.mobile ? 42 : 72;
    this.subText.style.fontSize = this.mobile ? 13 : 18;
    this.count.position.set(this.mobile ? 10 : 18, H - 20);
  }

  setChar(state) {
    if (this.charState === state) return;
    this.charState = state;
    for (const [k, a] of Object.entries(this.anims)) {
      if (!a) continue;
      if (k === state) { a.visible = true; a.gotoAndPlay(0); } else { a.visible = false; a.stop(); }
    }
    this.shadow.visible = state === 'IDLE';
    this.char.visible = true;
  }

  setPhase(T) {
    const prev = this.T?.phase;
    this.T = T;
    if (T.phase === 'betting') { this.setChar('IDLE'); this.char.rotation = 0; this.char.alpha = 1; this.maxT = 6; this.maxM = 2; }
    if (T.phase === 'flying') this.setChar('RUN');
    if (T.phase === 'crashed' && prev !== 'crashed') {
      // Explota en la punta de la curva y se va volando
      const ex = this.anims.EXPLODE;
      if (prev === 'flying' && ex) {
        this.setChar('EXPLODE');
        ex.onComplete = () => { this.setChar('FLY'); this.batT = 0; this.batX = this.char.x; this.batY = this.char.y; };
      } else { this.char.visible = false; }
    }
  }

  cashFlash() { this.flash = 1; }

  /** Punto de la pantalla para (segundos, multiplicador) con los ejes actuales. */
  pt(t, m) {
    return { x: this.x0 + (t / this.maxT) * (this.x1 - this.x0), y: this.y0 - ((m - 1) / (this.maxM - 1)) * (this.y0 - this.y1) };
  }

  drawAxes() {
    // Solo se redibujan cuando cambia la escala (crear textos en cada cuadro es caro)
    const key = `${this.maxT.toFixed(1)}|${this.maxM.toFixed(2)}|${this.w}|${this.h}`;
    if (key === this.axesKey) return;
    this.axesKey = key;
    const g = this.grid;
    g.clear();
    this.labels.removeChildren().forEach((c) => c.destroy());
    const style = { fontFamily: 'system-ui', fontSize: this.mobile ? 9 : 11, fill: '#bfb3dc' };
    const ny = 4;
    for (let i = 0; i <= ny; i++) {
      const m = 1 + ((this.maxM - 1) * i) / ny;
      const y = this.y0 - ((m - 1) / (this.maxM - 1)) * (this.y0 - this.y1);
      g.moveTo(this.x0, y).lineTo(this.x1, y);
      const t = new Text({ text: m.toFixed(m < 10 ? 1 : 0), style }); t.anchor.set(1, 0.5); t.position.set(this.x0 - 6, y); this.labels.addChild(t);
    }
    const stepT = [1, 2, 5, 10, 15, 30, 60].find((s) => this.maxT / s <= 6) || 60;
    for (let s = 0; s <= this.maxT + 1e-6; s += stepT) {
      const x = this.x0 + (s / this.maxT) * (this.x1 - this.x0);
      g.moveTo(x, this.y0).lineTo(x, this.y0 + 4);
      const t = new Text({ text: `${s}s`, style }); t.anchor.set(0.5, 0); t.position.set(x, this.y0 + 6); this.labels.addChild(t);
    }
    g.moveTo(this.x0, this.y0).lineTo(this.x1, this.y0).moveTo(this.x0, this.y1).lineTo(this.x0, this.y0);
    g.stroke({ color: 0xffffff, alpha: 0.1, width: 1 });
  }

  update(dt) {
    const T = this.T;
    const e = this.e;
    if (!T) return;
    const w = this.w, H = this.h;
    const now = e.now();
    const flying = T.phase === 'flying';
    const el = flying ? Math.max(0, (now - T.flightStart) / 1000) : T.phase === 'crashed' ? this.lastT || 0 : 0;
    const m = flying ? multAt(el, T.curve) : T.phase === 'crashed' ? T.crash : 1;
    const dtn = dt / 16.66;
    // Fondo
    const speed = flying ? 1 + Math.min(4.5, (m - 1) * 0.32) : 0.6;
    for (const L of this.parallax) { L.x = (L.x - L.speed * speed * dtn) % L.w; L.c.x = L.x; }
    for (const s of this.stars) { s.ph += s.sp; s.alpha = clamp(s.base + Math.sin(s.ph) * 0.35, 0.15, 1); s.fx -= (speed * 0.09 * dtn) / w; if (s.fx < -0.02) { s.fx = 1.02; s.fy = Math.random() * 0.6; } s.x = s.fx * w; }
    if (this.moon) { this.mph = (this.mph || 0) + 0.02; this.moon.y = Math.max(H * 0.5, H - 170) + Math.sin(this.mph) * 2; }
    for (const b of this.bats) { b.ph += 0.035 * dtn; b.fx += (b.vx * dtn * (flying ? 1 + Math.min(2.5, (m - 1) * 0.2) : 1)) / w; if (b.fx < -0.05) { b.fx = 1.05; b.fy = 0.08 + Math.random() * 0.4; } b.x = b.fx * w; b.y = b.fy * H + Math.sin(b.ph) * 4; }
    // Ejes que se agrandan con el vuelo
    if (flying) {
      this.lastT = el;
      this.maxT += (Math.max(6, el / 0.78) - this.maxT) * 0.06;
      this.maxM += (Math.max(2, (m - 1) / 0.74 + 1) - this.maxM) * 0.06;
    }
    this.maxT ||= 6; this.maxM ||= 2;
    this.drawAxes();
    // Curva
    const g = this.curve;
    g.clear();
    if (flying || (T.phase === 'crashed' && this.lastT)) {
      const pts = [];
      const steps = 70;
      for (let i = 0; i <= steps; i++) { const t = (el * i) / steps; pts.push(this.pt(t, i === steps ? m : multAt(t, T.curve))); }
      const color = T.phase === 'crashed' ? (this.C.crashColor || '#ef4444') : (this.C.curveColor || '#ffffff');
      // Relleno suave bajo la curva + línea punteada
      g.moveTo(pts[0].x, this.y0); for (const p of pts) g.lineTo(p.x, p.y); g.lineTo(pts.at(-1).x, this.y0); g.closePath();
      g.fill({ color, alpha: 0.08 });
      this.dashed(g, pts, 8, 6); g.stroke({ color, width: 3, alpha: 0.95 });
      const head = pts.at(-1);
      if (flying) {
        const prev = pts[Math.max(0, pts.length - 4)];
        const ang = Math.atan2(head.y - prev.y, head.x - prev.x);
        this.char.position.set(head.x, head.y - 22 + Math.sin(el * 1.8) * 4);
        this.char.rotation = ang * 0.15 + Math.cos(el * 1.8) * 0.03;
        this.char.alpha = 1;
      }
    } else if (T.phase === 'betting') {
      this.char.position.set(this.x0 + 30, this.y0 - 22 + Math.sin(Date.now() * 0.005) * 2);
      this.char.rotation = 0;
    }
    // Murciélago que se va después de explotar
    if (this.charState === 'FLY') {
      this.batT += dt / 1000;
      const k = Math.min(1, this.batT / 1.85);
      this.char.x = this.batX - (this.batX + 140) * Math.pow(k, 1.35);
      this.char.y = this.batY - (this.batY + 140) * Math.pow(k, 1.45) + Math.sin(k * Math.PI) * 15 + Math.sin(this.batT * 16) * 6 * (1 - k * 0.5);
      this.char.rotation = 0.15 - Math.sin(this.batT * 16) * 0.05;
      if (k >= 1) this.char.visible = false;
    }
    // Textos centrales (se actualizan solo si cambian: rasterizar texto en cada cuadro es caro)
    const setT = (o, v) => { if (o.text !== v) o.text = v; };
    const setF = (o, v) => { if (o.style.fill !== v) o.style.fill = v; };
    this.multText.position.set(w * 0.5, H * 0.42);
    this.subText.position.set(w * 0.5, H * 0.42 + (this.mobile ? 34 : 56));
    this.bar.clear();
    if (T.phase === 'betting') {
      const left = Math.max(0, (T.endsAt - now) / 1000);
      setT(this.multText, left > 0.3 ? left.toFixed(1) : '¡YA!');
      setF(this.multText, '#ffffff');
      setT(this.subText, 'HAGAN SUS APUESTAS');
      const bw = Math.min(260, w * 0.5), frac = clamp(left / (T.seconds?.betting || 7), 0, 1);
      const bx = w * 0.5 - bw / 2, by = H * 0.42 + (this.mobile ? 54 : 84);
      this.bar.roundRect(bx, by, bw, 6, 3).fill({ color: 0xffffff, alpha: 0.15 }).roundRect(bx, by, bw * frac, 6, 3).fill({ color: e.game.theme?.palette?.accent || '#f59e0b' });
    } else if (flying) {
      setT(this.multText, `×${floor2(m).toFixed(2)}`);
      setF(this.multText, this.flash > 0 ? '#4ade80' : (this.C.multColor || '#ffffff'));
      setT(this.subText, '');
    } else {
      setT(this.multText, `×${(T.crash || 1).toFixed(2)}`);
      setF(this.multText, this.C.crashColor || '#ef4444');
      setT(this.subText, '¡EXPLOTÓ!');
    }
    this.flash = Math.max(0, this.flash - dt / 600);
    setT(this.count, `👤 ${T.players}`);
    e.tickPanels();
  }

  dashed(g, pts, dash, gap) {
    let on = true, left = dash;
    let [cx, cy] = [pts[0].x, pts[0].y];
    g.moveTo(cx, cy);
    for (let i = 1; i < pts.length; i++) {
      let dx = pts[i].x - cx, dy = pts[i].y - cy, d = Math.hypot(dx, dy);
      if (d < 1e-4) continue;
      const ux = dx / d, uy = dy / d;
      while (d > 1e-4) {
        const s = Math.min(d, left);
        cx += ux * s; cy += uy * s; d -= s; left -= s;
        if (on) g.lineTo(cx, cy); else g.moveTo(cx, cy);
        if (left <= 1e-4) { on = !on; left = on ? dash : gap; }
      }
    }
  }
}
