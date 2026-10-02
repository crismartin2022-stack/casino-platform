// Motor base compartido. Cada uno de los 5 motores hereda de aquí y solo implementa
// cómo se ANIMA su resultado (playResult). El resultado siempre viene del servidor.
import { Application, Container, Sprite, Texture, Text } from 'pixi.js';
import { gsap } from 'gsap';
import { GridView, wait } from './GridView.js';
import { Hud, h } from './Hud.js';
import { SoundManager } from './SoundManager.js';
import { isAnimated, isVideo, mediaEl, applyBackgroundMedia, loadFontFile, playMediaOverlay } from './media.js';

// Textos de los carteles (editables en theme.messages.texts; {n}, {i} y {x} se reemplazan)
const DEFAULT_TEXTS = {
  win: '', bigWin: 'GRAN PREMIO', megaWin: '¡MEGA PREMIO!', freeSpins: '{n} GIROS GRATIS', bonusTotal: 'TOTAL DEL BONUS',
  spinOf: 'GIRO GRATIS {i}/{n}', respins: 'RE-GIROS: {n}', holdWin: 'HOLD & WIN', multiplier: 'MULTIPLICADOR ×{x}',
};
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DESIGN = { landscape: { w: 1280, h: 720 }, portrait: { w: 720, h: 1280 } };
// Zonas en coordenadas de diseño: logo arriba, rodillos, espacio para la botonera (HTML) abajo.
const ZONES = {
  landscape: { logo: { y: 6, h: 118 }, grid: { x: 120, y: 132, w: 1040, h: 470 } },
  portrait: { logo: { y: 70, h: 170 }, grid: { x: 12, y: 250, w: 696, h: 700 } },
};

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
    img.src = url;
  });
}

async function loadTexture(url, fallbackUrl) {
  try {
    return Texture.from(await loadImage(url));
  } catch (e) {
    if (!fallbackUrl) throw e;
    console.warn(e.message, '→ usando imagen provisional');
    return Texture.from(await loadImage(fallbackUrl));
  }
}

function loadFont(family) {
  if (!family || document.querySelector(`link[data-font="${family}"]`)) return Promise.resolve();
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.dataset.font = family;
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;700&display=swap`;
  document.head.appendChild(link);
  return Promise.race([document.fonts?.load(`16px "${family}"`) ?? Promise.resolve(), wait(1500)]).catch(() => {});
}

export class BaseEngine {
  constructor({ container, hudRoot, api, session, lobbyUrl }) {
    this.container = container;
    this.hudRoot = hudRoot;
    this.api = api;
    this.session = session;
    this.game = session.game;
    this.currency = session.currency;
    this.lobbyUrl = lobbyUrl;
    this.busy = false;
    this.symbols = new Map(this.game.symbols.map((s) => [s.id, s]));
  }

  // ---------------------------------------------------------------- Arranque
  async init(onProgress = () => {}) {
    const t = this.game.theme || {};
    this.orientation = this.detectOrientation();
    this.design = DESIGN[this.orientation];
    this.applyBackground();

    this.app = new Application();
    await this.app.init({
      resizeTo: this.container, backgroundAlpha: 0, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
    });
    this.container.appendChild(this.app.canvas);
    this.world = new Container();
    this.app.stage.addChild(this.world);

    onProgress(0.1, 'Cargando tipografía…');
    // Tipografía propia subida (theme.fontUrl) o de Google Fonts (theme.font); la botonera puede tener otra (theme.hud.font/fontUrl)
    if (t.fontUrl) await loadFontFile(t.font, t.fontUrl); else await loadFont(t.font);
    if (t.hud?.fontUrl) await loadFontFile(t.hud.font, t.hud.fontUrl); else if (t.hud?.font) await loadFont(t.hud.font);
    // Tipografías de SALDO / APUESTA / PREMIO (theme.hud.meters.labelFont/valueFont, con archivo propio opcional)
    const M = t.hud?.meters || {};
    for (const k of ['label', 'value']) {
      const f = M[`${k}Font`], u = M[`${k}FontUrl`];
      if (f && u) await loadFontFile(f, u); else if (f) await loadFont(f);
    }
    if (t.infoFont) { if (t.infoFontUrl) await loadFontFile(t.infoFont, t.infoFontUrl); else await loadFont(t.infoFont); }
    if (t.messages?.font) { if (t.messages.fontUrl) await loadFontFile(t.messages.font, t.messages.fontUrl); else await loadFont(t.messages.font); }
    for (const st of Object.values(t.messages?.styles || {})) {
      if (st?.fontUrl) await loadFontFile(st.font, st.fontUrl); else if (st?.font) await loadFont(st.font);
    }

    onProgress(0.2, 'Cargando símbolos…');
    this.textures = new Map();
    let done = 0;
    const list = this.game.symbols;
    await Promise.all(list.map(async (s) => {
      const fallback = `/gen/symbol.svg?label=${encodeURIComponent(s.name || s.id)}&color=%23777777`;
      this.textures.set(s.id, await loadTexture(s.image || fallback, fallback));
      onProgress(0.2 + 0.6 * (++done / list.length), 'Cargando símbolos…');
    }));
    this.textures.set('__missing', await loadTexture('/gen/symbol.svg?label=%3F&color=%23555555'));
    const optional = async (url) => { if (!url) return null; try { return await loadTexture(url); } catch (e) { console.warn(e.message); return null; } };
    // Fondo de rodillos animado (GIF o video): va en una capa HTML detrás del lienzo, que es transparente.
    const reelsAnimated = isAnimated(t.reelsBackground);
    [this.logoTexture, this.cellTexture, this.reelsTexture, this.frameTexture] = await Promise.all(
      [t.logo, t.cellImage, reelsAnimated ? null : t.reelsBackground, t.frame].map(optional));
    if (reelsAnimated) {
      this.reelsMedia = mediaEl(t.reelsBackground, { fit: 'fill' });
      this.reelsMedia.className = 'reelsbg';
      this.container.prepend(this.reelsMedia);
    }

    onProgress(0.9, 'Preparando mesa…');
    // Sonidos de los premios por monto (theme.winTiers[i].sound) como ranuras winTier0, winTier1…
    const tierSounds = Object.fromEntries((this.game.theme?.winTiers || []).map((t, i) => [`winTier${i}`, t?.sound || null]));
    this.sound = new SoundManager({ ...(this.game.sounds || {}), ...tierSounds }, this.game.soundVolumes || {});
    this.buildScene();
    this.buildHud();
    const { balance } = await this.api.balance();
    this.hud.setBalance(balance);
    window.addEventListener('resize', () => this.onResize());
    this.fit();
    const unlock = () => { this.sound.unlock(); this.sound.playMusic('music'); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    onProgress(1, 'Listo');
  }

  detectOrientation() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    return h > w * 1.1 ? 'portrait' : 'landscape';
  }

  /** Fondo de pantalla completa por CSS: imagen de PC (theme.background) y de celular (theme.backgroundMobile). */
  applyBackground() {
    const t = this.game.theme || {};
    const el = document.getElementById?.('bg');
    if (!el) return;
    applyBackgroundMedia(t, this.orientation);
    const url = (u) => (u ? `url("${String(u).replace(/"/g, '%22')}")` : null);
    // Los videos no van por CSS (applyBackgroundMedia los pone como <video>)
    if (url(t.background) && !isVideo(t.background)) el.style.setProperty('--bg-desktop', url(t.background));
    if (url(t.backgroundMobile) && !isVideo(t.backgroundMobile)) el.style.setProperty('--bg-mobile', url(t.backgroundMobile));
    if (t.backgroundColor) el.style.setProperty('--bg-color', t.backgroundColor);
  }

  onResize() {
    const o = this.detectOrientation();
    if (o !== this.orientation) {
      // Al girar el teléfono se rearma la escena con el diseño de la nueva orientación.
      if (this.busy) { this.pendingRelayout = true; return; }
      this.relayout(o);
    }
    this.fit();
  }

  relayout(orientation) {
    this.orientation = orientation;
    applyBackgroundMedia(this.game.theme || {}, orientation);
    this.design = DESIGN[orientation];
    for (const ch of this.world.removeChildren()) ch.destroy({ children: true });
    this.buildScene();
    this.fit();
  }

  /** Área de la cuadrícula en coordenadas de diseño. */
  gridArea() {
    const box = ZONES[this.orientation].grid;
    const rows = this.gridRows();
    if (Array.isArray(rows)) return box; // Megaways: altura variable, ocupa todo el espacio
    // Celdas casi cuadradas para cualquier cantidad de rodillos y filas, centradas en el espacio disponible.
    // gridExtraCols(): columnas extra a la derecha para piezas propias del motor (ej. rodillo multiplicador)
    const cols = this.gridCols(), extra = this.gridExtraCols();
    const cell = Math.min(box.w / (cols + extra), box.h / rows, 210);
    const w = cell * cols, h = cell * rows;
    return { x: box.x + (box.w - cell * (cols + extra)) / 2, y: box.y + (box.h - h) / 2, w, h };
  }

  /** Texto de reglas con los números reales del juego (rodillos, filas, líneas). */
  rulesText() { return ''; }

  gridLabel() {
    const g = this.game.grid;
    return `${g.reels} rodillos × ${g.rows ?? `${g.rowsMin}–${g.rowsMax}`} filas`;
  }

  gridRows() { return this.game.grid.rows; }
  gridCols() { return this.game.grid.reels; }
  gridExtraCols() { return 0; }

  fillerIds() {
    return this.game.symbols.filter((s) => s.type === 'regular' || !s.type).map((s) => s.id);
  }

  buildScene() {
    const w = this.design.w, hgt = this.design.h;
    const t = this.game.theme || {};
    const a = this.gridArea();
    this.gridRect = a;
    this.grid = new GridView({
      textures: this.textures, fillerIds: this.fillerIds(), cols: this.gridCols(), rows: this.gridRows(),
      width: a.w, height: a.h, ticker: this.app.ticker, palette: t.palette,
      look: {
        gap: t.cellGap ?? 6, symbolScale: t.symbolScale ?? 0.92,
        cellColor: t.cellColor, cellAlpha: t.cellAlpha, cellRadius: t.cellRadius,
        cellBorder: t.cellBorder === 'none' ? null : t.cellBorder, frameColor: t.frameColor,
        cellTexture: this.cellTexture, reelsTexture: this.reelsTexture, frameTexture: this.frameTexture,
        frameLayer: t.frameLayer, frameScale: t.frameScale, frameCut: t.frameCut,
        // Subir/bajar el marco (px de diseño; negativo = arriba). En celular puede tener su propio valor.
        frameOffsetY: this.offsetY('frame'),
        // Ancho y alto del marco por separado (estirar o achicar) y moverlo a izquierda/derecha; en celular puede tener los suyos.
        frameScaleX: this.themeFor('frameScaleX'), frameScaleY: this.themeFor('frameScaleY'), frameOffsetX: this.themeFor('frameOffsetX'),
      },
    });
    this.grid.position.set(a.x, a.y);
    this.world.addChild(this.grid);
    this.grid.setGrid(this.randomGrid());

    // Logo (imagen) o, si no hay, el título con la tipografía del juego.
    const z = ZONES[this.orientation].logo;
    const logoBottom = Math.min(z.y + z.h, a.y - 10);
    if (this.logoTexture) {
      const logo = new Sprite(this.logoTexture);
      logo.anchor.set(0.5, 1);
      const k = Math.min((this.orientation === 'portrait' ? 640 : 560) / logo.texture.width, (logoBottom - z.y) / logo.texture.height);
      // theme.logoScale agranda/achica el logo; theme.logoOffsetY (logoOffsetYMobile) lo sube o baja.
      logo.scale.set(k * Math.min(1.8, Math.max(0.4, Number(t.logoScale) || 1)));
      logo.position.set(w / 2, logoBottom + this.offsetY('logo'));
      this.world.addChild(logo);
    } else {
      const title = new Text({
        text: t.title || this.game.name,
        style: {
          fontFamily: t.font || 'Arial', fontSize: this.orientation === 'portrait' ? 64 : 58, fontWeight: '700',
          fill: t.palette?.accent || '#ffd460', stroke: { color: '#000000', width: 7 },
          dropShadow: { color: '#000000', blur: 10, distance: 4, alpha: 0.7 }, align: 'center',
          wordWrap: true, wordWrapWidth: w - 60,
        },
      });
      title.anchor.set(0.5, 1);
      const k = Math.min(1, (logoBottom - z.y) / Math.max(1, title.height));
      title.scale.set(k * Math.min(1.8, Math.max(0.4, Number(t.logoScale) || 1)));
      title.position.set(w / 2, logoBottom + this.offsetY('logo'));
      this.world.addChild(title);
    }
    // Frase bajo los rodillos (theme.tagline), en celular entre rodillos y botonera
    if (t.tagline && this.orientation === 'portrait') {
      const tag = new Text({ text: t.tagline, style: { fontFamily: t.font || 'Arial', fontSize: 30, fill: t.palette?.accent || '#ffd460', stroke: { color: '#000000', width: 5 } } });
      tag.anchor.set(0.5, 0);
      tag.position.set(w / 2, a.y + a.h + 16);
      this.world.addChild(tag);
      this.taglineH = 56;
    } else this.taglineH = 0;
    // Texto de premio sobre la cuadrícula
    this.winText = new Text({
      text: '',
      style: {
        fontFamily: this.game.theme?.font || 'Arial', fontSize: 64, fill: this.game.theme?.palette?.accent || '#ffd460',
        stroke: { color: '#000000', width: 8 }, dropShadow: { color: '#000000', blur: 8, distance: 4, alpha: 0.6 },
      },
    });
    this.winText.anchor.set(0.5);
    this.winText.position.set(a.x + a.w / 2, a.y + a.h / 2);
    this.onSceneBuilt?.();
    this.winText.alpha = 0;
    this.world.addChild(this.winText);
  }

  randomGrid() {
    const ids = this.fillerIds();
    const rows = this.gridRows();
    return Array.from({ length: this.gridCols() }, (_, c) =>
      Array.from({ length: Array.isArray(rows) ? rows[c] : rows }, () => ids[Math.floor(Math.random() * ids.length)]));
  }

  buildHud() {
    this.hud = new Hud(this.hudRoot, {
      game: this.game, currency: this.currency, lobbyUrl: this.lobbyUrl, preview: this.session.source === 'draft',
      onSpin: () => this.spin('base'),
      onBuy: this.supportsBuy() ? () => this.buyBonus() : null,
      onInfo: () => this.showInfo(),
      onToggleSound: () => this.sound.toggleMute(),
      onHistory: () => this.api.history(20),
      // Solo en la vista previa del borrador: el próximo giro trae el bonus
      onForce: this.session.source === 'draft' ? () => this.spin('base', { force: true }) : null,
    });
    this.hud.onTurbo = (v) => { this.grid.turbo = v; };
    this.buildAnte();
  }

  /** Gancho para limpiar capas propias del motor (etiquetas, colosales…) antes de girar. */
  onSpinStart() {}

  fit() {
    const W = this.container.clientWidth || window.innerWidth, H = this.container.clientHeight || window.innerHeight;
    // Interfaces completas: barra superior, dock inferior y panel lateral ocupan píxeles fijos; los rodillos van en el resto.
    const R = this.hud?.reserve?.(this.orientation);
    if (R) {
      const usedH = R.full ? this.design.h : this.gridRect.y + this.gridRect.h + (this.taglineH || 0) + 12;
      const availW = Math.max(200, W - 2 * R.side), availH = Math.max(200, H - R.top - R.bottom);
      const k = Math.min(availW / this.design.w, availH / usedH);
      this.world.scale.set(k);
      const ox = (W - this.design.w * k) / 2;
      const oy = R.top + Math.max(0, (availH - usedH * k) / 2);
      this.world.position.set(ox, oy);
      const r = this.gridRect;
      this.hud.setLayout({ x: ox + r.x * k, y: oy + r.y * k, w: r.w * k, h: (r.h + (this.taglineH || 0)) * k }, this.orientation, k);
      this.hud.setWorld?.({ ox, oy, k, w: this.design.w, h: this.design.h, H, gridBottom: r.y + r.h + (this.taglineH || 0) });
      this.placeReelsMedia(ox, oy, k);
      this.hud.renderBet();
      return;
    }
    // Reserva espacio para la botonera HTML debajo de los rodillos (más si la interfaz está agrandada).
    const barSpace = (this.orientation === 'portrait' ? 250 : 110) * (this.hud?.uiScale || 1);
    const usedH = this.gridRect.y + this.gridRect.h + barSpace + (this.taglineH || 0);
    const k = Math.min(W / this.design.w, H / usedH);
    this.world.scale.set(k);
    const ox = (W - this.design.w * k) / 2;
    const oy = this.orientation === 'portrait' ? Math.max(0, (H - usedH * k) / 2) : Math.max(0, (H - usedH * k) / 2);
    this.world.position.set(ox, oy);
    const r = this.gridRect;
    this.hud?.setLayout({ x: ox + r.x * k, y: oy + r.y * k, w: r.w * k, h: (r.h + (this.taglineH || 0)) * k }, this.orientation, k);
    this.hud?.setWorld?.({ ox, oy, k, w: this.design.w, h: this.design.h, H, gridBottom: r.y + r.h + (this.taglineH || 0) });
    this.placeReelsMedia(ox, oy, k);
  }

  /** Coloca el fondo de rodillos animado exactamente detrás de la cuadrícula (mismo margen que la imagen fija). */
  placeReelsMedia(ox, oy, k) {
    const r = this.gridRect;
    for (const m of [this.reelsMedia, this.bonusReels]) {
      if (m) Object.assign(m.style, { left: `${ox + (r.x - 10) * k}px`, top: `${oy + (r.y - 10) * k}px`, width: `${(r.w + 20) * k}px`, height: `${(r.h + 20) * k}px` });
    }
  }

  // ---------------------------------------------------------------- Ciclo de juego
  async spin(mode = 'base', { force = false } = {}) {
    if (this.busy) return;
    if (mode === 'base' && this.ante && this.supportsAnte()) mode = 'ante';
    const bet = this.hud.bet;
    const cost = Math.round(bet * this.costFor(mode));
    if (this.hud.balance < cost) { this.hud.error('Saldo insuficiente para esta apuesta.'); return; }
    this.busy = true;
    this.hud.lock(true);
    this.hud.setWin(0);
    this.roundWin = 0;
    this.hud.setBalance(this.hud.balance - cost); // visual: el servidor confirma el saldo real
    this.sound.unlock();
    this.sound.play('spin');
    this.grid.undim();
    this.onSpinStart();
    this.grid.startSpin();
    let round;
    try {
      [round] = await Promise.all([this.api.spin(bet, mode, { force }), wait(this.hud.turbo ? 150 : 380)]);
    } catch (e) {
      await this.grid.stop(this.randomGrid());
      this.hud.setBalance(this.hud.balance + cost);
      this.api.balance().then((b) => this.hud.setBalance(b.balance)).catch(() => {});
      this.hud.error(e.message || 'Error de conexión');
      this.busy = false;
      this.hud.lock(false);
      return;
    }
    try {
      this.currentBet = bet;
      await this.playResult(round.result, round);
    } catch (e) {
      console.error('Error animando la ronda', e); // el dinero ya está resuelto en el servidor
    }
    if (round.win > 0) this.hud.countWin(round.win, 400); else this.hud.setWin(0);
    if (round.win > 0) await this.presentTotal(round.win, bet);
    this.hud.setBalance(round.balance);
    // Aviso al sitio del operador cuando el juego va embebido en un iframe (client-sdk).
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'casino:round', gameId: this.game.id, roundId: round.roundId, bet: round.bet, cost: round.cost, win: round.win, balance: round.balance }, '*');
    }
    if (round.creditPending) this.hud.setStatus('Premio en proceso de acreditación por el operador…');
    this.busy = false;
    if (this.pendingRelayout) { this.pendingRelayout = false; this.relayout(this.detectOrientation()); }
    this.hud.lock(false);
    if (this.hud.autoLeft > 0 && !(round.result.freeSpins || round.result.holdAndWin)) {
      if (this.hud.consumeAuto()) setTimeout(() => this.spin('base'), 220);
    } else if (round.result.freeSpins || round.result.holdAndWin) {
      this.hud.stopAuto();
    }
  }

  /** Implementado por cada motor. Debe dejar la cuadrícula en su estado final. */
  async playResult() { throw new Error('playResult no implementado'); }

  money(mult, bet = this.currentBet) { return Math.round(mult * bet); }

  /** Detiene los rodillos. Pone "anticipación" si ya hay 2 scatters antes de los últimos rodillos. */
  async stopReels(grid, { scatterId } = {}) {
    let seen = 0;
    const anticipation = [];
    if (scatterId) {
      grid.forEach((col, c) => {
        if (seen >= 2) anticipation.push(c);
        seen += col.filter((id) => id === scatterId).length;
      });
    }
    await this.grid.stop(grid, { anticipation, onReelStop: () => this.sound.play('reelStop') });
  }

  /** Muestra ganancias de un paso: resalta, suma y muestra el importe. */
  async presentWins(wins, stepWinMult) {
    if (!wins?.length) return;
    this.sound.play('win');
    const positions = wins.flatMap((w) => w.positions);
    const lines = wins.filter((w) => w.line != null).map((w) => w.positions);
    const cents = this.money(stepWinMult);
    this.flashWinText(cents);
    this.roundWin = (this.roundWin || 0) + cents;
    this.hud.countWin(this.roundWin);
    await this.grid.highlight(positions, { lines });
    this.grid.undim();
  }

  flashWinText(cents) {
    // Cuenta hacia arriba el importe sobre los rodillos
    const obj = { v: 0 };
    gsap.to(obj, { v: cents, duration: this.hud.turbo ? 0.25 : 0.45, ease: 'power2.out', onUpdate: () => { this.winText.text = this.hud.fmt(Math.round(obj.v)); } });
    this.winText.text = this.hud.fmt(0);
    gsap.killTweensOf(this.winText);
    gsap.killTweensOf(this.winText.scale);
    this.winText.alpha = 1;
    this.winText.scale.set(0.4);
    gsap.to(this.winText.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2)' });
    gsap.to(this.winText, { alpha: 0, duration: 0.4, delay: this.hud.turbo ? 0.5 : 1.1 });
  }

  /** Texto de un cartel: el que puso el diseñador o el de fábrica. */
  /** Desplazamiento vertical (px de diseño) del logo o del marco: theme.<k>OffsetY en PC y theme.<k>OffsetYMobile en celular. */
  /** Valor del tema según la orientación: en celular usa «<clave>Mobile» si existe, si no el de PC. */
  themeFor(k) {
    const t = this.game.theme || {};
    const v = this.orientation === 'portrait' ? (t[`${k}Mobile`] ?? t[k]) : t[k];
    return v == null || v === '' ? null : Number(v);
  }

  offsetY(k) {
    const t = this.game.theme || {};
    const v = this.orientation === 'portrait' ? (t[`${k}OffsetYMobile`] ?? t[`${k}OffsetY`]) : t[`${k}OffsetY`];
    return Math.max(-300, Math.min(300, Number(v) || 0));
  }

  msg(key, vars = {}) {
    const txt = this.game.theme?.messages?.texts?.[key];
    return String(txt != null && txt !== '' ? txt : DEFAULT_TEXTS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }

  /** Niveles de premio configurados (theme.winTiers), ordenados de menor a mayor «desde». */
  winTiers() {
    return (this.game.theme?.winTiers || []).map((t, i) => ({ ...t, i, from: Number(t.from) }))
      .filter((t) => t.from > 0).sort((a, b) => a.from - b.from);
  }

  async presentTotal(cents, bet) {
    const x = cents / bet;
    // Premios por monto: el nivel más alto alcanzado reproduce su sonido, su video/GIF y su cartel
    const tier = this.winTiers().filter((t) => x >= t.from).pop();
    if (tier) {
      this.sound.play(tier.sound ? `winTier${tier.i}` : 'bigWin');
      // Con video/GIF, el importe se muestra encima del propio video; sin él, en el cartel
      if (tier.media) { await this.playOverlay(tier.media, tier.seconds ?? 3, { amount: this.hud.fmt(cents), text: tier.text || this.msg('bigWin'), cap: tier }); return; }
      const kind = x >= (Number(this.game.theme?.messages?.thresholds?.big) || 15) ? 'big' : 'win';
      await this.hud.showBanner(`<small>${escHtml(tier.text || this.msg(kind === 'big' ? 'bigWin' : 'win'))}</small><b>${this.hud.fmt(cents)}</b>`, { kind, ms: tier.bannerMs || (kind === 'big' ? 2600 : 1400) });
      return;
    }
    const T = this.game.theme?.messages?.thresholds || {};
    const mega = Number(T.mega) || 50, big = Number(T.big) || 15;
    if (x >= mega) {
      this.sound.play('bigWin');
      await this.hud.showBanner(`<small>${escHtml(this.msg('megaWin'))}</small><b>${this.hud.fmt(cents)}</b>`, { kind: 'big', ms: 3200 });
    } else if (x >= big) {
      this.sound.play('bigWin');
      await this.hud.showBanner(`<small>${escHtml(this.msg('bigWin'))}</small><b>${this.hud.fmt(cents)}</b>`, { kind: 'big', ms: 2400 });
    } else if (x >= 1) {
      const t = this.msg('win');
      await this.hud.showBanner(`${t ? `<small>${escHtml(t)}</small>` : ''}<b>${this.hud.fmt(cents)}</b>`, { kind: 'win', ms: 900 });
    }
  }

  async featureIntro(title, sub = '') {
    // Subtítulo propio (theme.messages.texts.bonusSub): vacío = el automático del juego; "-" = sin subtítulo.
    const own = this.game.theme?.messages?.texts?.bonusSub;
    if (own != null && String(own).trim() !== '') sub = String(own).trim() === '-' ? '' : String(own);
    this.sound.play('feature');
    this.sound.playMusic('featureMusic');
    await this.enterBonus();
    await this.hud.showBanner(`<small>${escHtml(sub)}</small><b>${escHtml(title)}</b>`, { kind: 'feature', ms: 2000 });
  }

  async featureOutro(totalMult) {
    await this.hud.showBanner(`<small>${escHtml(this.msg('bonusTotal'))}</small><b>${this.hud.fmt(this.money(totalMult))}</b>`, { kind: 'feature', ms: 2200 });
    await this.exitBonus();
    this.sound.playMusic('music');
  }

  // ---------------------------------------------------------------- Ambiente del bonus (theme.bonus)
  // { intro, outro: imagen/GIF/video a pantalla completa; background, backgroundMobile, reelsBackground: fondos durante el bonus }

  /** Muestra una imagen, GIF o video a pantalla completa (se salta tocando). Espera a que termine o a `seconds`. */
  async playOverlay(url, seconds = 3, { amount = null, text = null, cap = null } = {}) {
    await playMediaOverlay(url, seconds, { amount, text, cap, turbo: this.hud?.turbo });
  }

  async enterBonus() {
    const B = this.game.theme?.bonus || {};
    if (this.inBonus) return;
    this.inBonus = true;
    await this.playOverlay(B.intro, B.introSeconds);
    const t = this.game.theme || {};
    if (B.background || B.backgroundMobile) {
      this.applyThemeBackground({ ...t, background: B.background || t.background, backgroundMobile: B.backgroundMobile || B.background || t.backgroundMobile });
    }
    if (B.reelsBackground) {
      this.bonusReels?.remove();
      this.bonusReels = mediaEl(B.reelsBackground, { fit: 'fill' });
      this.bonusReels.className = 'reelsbg';
      this.container.prepend(this.bonusReels);
      if (this.reelsMedia) this.reelsMedia.style.visibility = 'hidden';
      if (this.grid?.reelsSprite) this.grid.reelsSprite.visible = false;
      this.fit();
    }
  }

  async exitBonus() {
    if (!this.inBonus) return;
    const B = this.game.theme?.bonus || {};
    await this.playOverlay(B.outro, B.outroSeconds);
    this.inBonus = false;
    if (B.background || B.backgroundMobile) this.applyThemeBackground(this.game.theme || {});
    if (this.bonusReels) {
      this.bonusReels.remove();
      this.bonusReels = null;
      if (this.reelsMedia) this.reelsMedia.style.visibility = '';
      if (this.grid?.reelsSprite) this.grid.reelsSprite.visible = true;
    }
  }

  /** Aplica los fondos (PC/celular) de un tema: imágenes y GIF por CSS, videos como <video>. */
  applyThemeBackground(t) {
    const el = document.getElementById?.('bg');
    if (!el) return;
    const url = (u) => (u ? `url("${String(u).replace(/"/g, '%22')}")` : null);
    el.style.removeProperty('--bg-desktop');
    el.style.removeProperty('--bg-mobile');
    if (url(t.background) && !isVideo(t.background)) el.style.setProperty('--bg-desktop', url(t.background));
    if (url(t.backgroundMobile) && !isVideo(t.backgroundMobile)) el.style.setProperty('--bg-mobile', url(t.backgroundMobile));
    applyBackgroundMedia(t, this.orientation);
  }

  /** Precio (en múltiplos de la apuesta) de cada modo de juego. */
  costFor(mode) {
    const R = this.game.rules || {};
    if (mode === 'base') return 1;
    if (mode === 'buy') return R.buyCost || 1;
    if (mode === 'ante') return R.anteCost || 1;
    return R.bonusMenu?.[mode.replace(/^buy-/, '')]?.cost || 1;
  }

  /** Doble chance (apuesta extra por más probabilidad de bonus): botón para activarla o no. */
  supportsAnte() { return (this.game.rules?.anteCost || 0) > 0 && (this.game.modes || ['ante']).includes('ante'); }
  buildAnte() {
    if (!this.supportsAnte()) return;
    const R = this.game.rules;
    const root = this.hudRoot;
    let box = root.querySelector('.buybox');
    if (!box) { box = document.createElement('div'); box.className = 'buybox'; root.append(box); }
    const btn = document.createElement('button');
    btn.className = 'buy ante';
    const paint = () => {
      btn.innerHTML = `<small>DOBLE CHANCE</small><b>${this.ante ? 'SÍ' : 'NO'}</b><small>apuesta ×${R.anteCost}</small>`;
      btn.classList.toggle('on', !!this.ante);
      this.hud.renderBet?.();
    };
    btn.onclick = () => { if (this.busy) return; this.ante = !this.ante; this.sound.play('click'); paint(); };
    box.append(btn);
    this.anteBtn = btn;
    paint();
  }

  /** Opciones de compra disponibles: [{ mode, name, cost }]. */
  buyOptions() {
    const R = this.game.rules || {};
    const out = [];
    if (R.buyCost) out.push({ mode: 'buy', name: 'Giros gratis', cost: R.buyCost });
    const names = { sticky: 'Giros gratis con wilds fijos', wheel: 'Ruleta de la fortuna', pick: 'Elige un premio', collect: 'Colecciona', path: 'El camino' };
    for (const key of ['sticky', 'wheel', 'pick', 'collect', 'path']) {
      const o = R.bonusMenu?.[key];
      if (o?.enabled && o.cost) out.push({ mode: `buy-${key}`, name: o.name || names[key], cost: o.cost });
    }
    return out;
  }

  supportsBuy() { return this.buyOptions().length > 0; }

  async buyBonus() {
    if (this.busy) return;
    const opts = this.buyOptions();
    if (opts.length === 1) {
      const price = this.hud.bet * opts[0].cost;
      const ok = await this.hud.confirm('Comprar bonus', `¿Comprar ${opts[0].name.toLowerCase()} por ${this.hud.fmt(price)}?`, `Comprar por ${this.hud.fmt(price)}`);
      if (ok) this.spin(opts[0].mode);
      return;
    }
    const mode = await this.hud.choose('Comprar bonus', opts.map((o) => ({ value: o.mode, label: o.name, sub: this.hud.fmt(this.hud.bet * o.cost) })));
    if (mode) this.spin(mode);
  }

  // ---------------------------------------------------------------- Reglas y pagos (obligatorio en mercados regulados)
  payUnit() { return 1; }

  /** Datos extra de la pantalla de información como [etiqueta, importe] ya calculados para la apuesta (compras de bonus, jackpots…). */
  infoExtras(bet) { return this.game.rules?.buyCost ? [['Comprar giros gratis', this.hud.fmt(Math.round(this.game.rules.buyCost * bet))]] : []; }

  /** Aclaración de cómo se cuentan los premios de la tabla (por línea, por forma, por grupo…). */
  payNote() {
    const e = this.game.engine;
    if (e === 'cluster-pays') return 'Importes por cada GRUPO de símbolos iguales que se tocan. Si hay varios grupos, o cascadas, se suman todos los premios del giro.';
    if (e === 'scatter-pays') return 'Importes por cantidad de símbolos iguales en cualquier lugar de la pantalla. Cada cascada suma su premio y los multiplicadores lo agrandan.';
    const lines = this.game.rules?.lines;
    if (this.payUnit() !== 1 && lines) return `Importes por LÍNEA ganadora: la apuesta se reparte entre las ${lines} líneas. Si ganás en varias líneas en el mismo giro, se suman todas.`;
    return 'Importes por cada FORMA de ganar: si la combinación se arma de varias maneras (por ejemplo, 2 símbolos iguales en un mismo rodillo), cada forma paga y se suman.' + (e === 'colossal-reels' ? ' Un símbolo COLOSAL ocupa varias filas y multiplica las formas.' : /cascade|reel-rush/.test(e) ? ' Las cascadas suman más premios en el mismo giro.' : '');
  }

  /** Texto después de la cantidad en la tabla de premios («5 iguales», «5 iguales en fila»…). */
  paySuffix() { return 'iguales'; }

  /** Cómo se muestra cada cantidad de la tabla de pagos (los motores de grupos la cambian). */
  payLabel(n) { return `${n}`; }

  showInfo() {
    const bet = this.hud.bet;
    const unit = this.payUnit();
    const rows = this.game.symbols.map((s) => {
      const keys = Object.keys(s.pays || {});
      const pays = Object.entries(s.pays || {}).sort((a, b) => b[0] - a[0])
        .map(([n, p]) => h('div', { class: 'pl' }, h('span', {}, `${this.payLabel(n, keys)} ${this.paySuffix()}`), h('b', {}, this.hud.fmt(Math.round(p * unit * bet)))));
      // Pagos de scatter en cualquier posición (múltiplos de la apuesta total). El importe ya es el total del premio.
      const sp = Object.entries(s.scatterPays || {}).sort((a, b) => b[0] - a[0])
        .map(([n, p]) => h('div', { class: 'pl' }, h('span', {}, `${n} en pantalla`), h('b', {}, this.hud.fmt(Math.round(p * bet)))));
      const kind = {
        wild: 'Sustituye a los símbolos normales', scatter: 'Activa los giros gratis', coin: 'Activa el bonus Hold & Win',
        wildscatter: 'Comodín y scatter: activa los giros gratis', multiplier: 'Multiplica el premio del giro', mystery: 'Se revela como un símbolo al azar',
      }[s.type] || null;
      return h('div', { class: 'pay' }, h('img', { src: s.image, alt: s.name }), h('div', {}, h('strong', {}, s.name), kind ? h('div', {}, kind) : null, ...pays, ...sp));
    });
    const rtp = this.game.math?.rtp ? `${(this.game.math.rtp * 100).toFixed(2)} %` : '—';
    // La tabla se recalcula con la apuesta y la moneda de la sesión; se puede cambiar la apuesta desde aquí mismo.
    const step = (d) => h('button', { class: 'chip', disabled: this.hud.locked || (d < 0 ? this.hud.betIndex === 0 : this.hud.betIndex === this.hud.levels.length - 1),
      onclick: () => { this.hud.changeBet(d); this.showInfo(); } }, d < 0 ? '−' : '+');
    const maxWin = this.game.rules?.maxWin;
    const extra = this.infoExtras(bet);
    this.hud.openModal(h('div', { class: 'info' },
      h('h2', {}, this.game.theme?.title || this.game.name),
      h('div', { class: 'info-bet' }, h('span', {}, 'Premios para tu apuesta de'), step(-1), h('b', {}, this.hud.fmt(bet)), step(1),
        h('small', {}, this.hud.currency ? `(${this.hud.currency})` : '')),
      h('p', {}, this.rulesText()),
      extra.length ? h('div', { class: 'info-extra' }, extra.map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, v)))) : null,
      maxWin ? h('p', {}, `Premio máximo: ${maxWin.toLocaleString('es')}× la apuesta = `, h('b', {}, this.hud.fmt(Math.round(maxWin * bet))), '.') : null,
      h('p', { class: 'pay-note' }, this.payNote()),
      h('div', { class: 'paytable' }, rows),
      h('p', { class: 'fine' }, `RTP teórico: ${rtp}. Versión ${this.game.version ?? 'borrador'}. Los resultados se determinan en el servidor con un generador de números aleatorios certificable; el mal funcionamiento anula pagos y jugadas. Juega con responsabilidad.`)));
  }
}

export { wait, h, gsap };
