// Motor base compartido. Cada uno de los 5 motores hereda de aquí y solo implementa
// cómo se ANIMA su resultado (playResult). El resultado siempre viene del servidor.
import { Application, Container, Sprite, Texture, Text } from 'pixi.js';
import { gsap } from 'gsap';
import { GridView, wait } from './GridView.js';
import { Hud, h } from './Hud.js';
import { SoundManager } from './SoundManager.js';

const DESIGN = { landscape: { w: 1280, h: 720 }, portrait: { w: 720, h: 1280 } };

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
  /** Nombre visible de las reglas; los motores lo sobrescriben. */
  static rulesText = '';

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
    this.orientation = this.container.clientHeight > this.container.clientWidth * 1.1 ? 'portrait' : 'landscape';
    this.design = DESIGN[this.orientation];

    this.app = new Application();
    await this.app.init({
      resizeTo: this.container, backgroundAlpha: 0, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
    });
    this.container.appendChild(this.app.canvas);
    this.world = new Container();
    this.app.stage.addChild(this.world);

    onProgress(0.1, 'Cargando tipografía…');
    await loadFont(t.font);

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
    if (t.background) {
      try { this.bgTexture = await loadTexture(t.background); } catch (e) { console.warn(e.message); }
    }
    if (t.logo) {
      try { this.logoTexture = await loadTexture(t.logo); } catch (e) { console.warn(e.message); }
    }

    onProgress(0.9, 'Preparando mesa…');
    this.sound = new SoundManager(this.game.sounds || {}, this.game.soundVolumes || {});
    this.buildScene();
    this.buildHud();
    const { balance } = await this.api.balance();
    this.hud.setBalance(balance);
    window.addEventListener('resize', () => this.fit());
    this.fit();
    const unlock = () => { this.sound.unlock(); this.sound.playMusic('music'); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    onProgress(1, 'Listo');
  }

  /** Área de la cuadrícula en coordenadas de diseño. */
  gridArea() {
    if (this.orientation === 'portrait') return { x: 30, y: 250, w: 660, h: 640 };
    return { x: 190, y: 88, w: 900, h: 500 };
  }

  gridRows() { return this.game.grid.rows; }
  gridCols() { return this.game.grid.reels; }

  fillerIds() {
    return this.game.symbols.filter((s) => s.type === 'regular' || !s.type).map((s) => s.id);
  }

  buildScene() {
    const w = this.design.w, hgt = this.design.h;
    if (this.bgTexture) {
      const bg = new Sprite(this.bgTexture);
      const k = Math.max(w / bg.texture.width, hgt / bg.texture.height);
      bg.scale.set(k);
      bg.anchor.set(0.5);
      bg.position.set(w / 2, hgt / 2);
      this.world.addChild(bg);
      this.bgSprite = bg;
    }
    const a = this.gridArea();
    this.grid = new GridView({
      textures: this.textures, fillerIds: this.fillerIds(), cols: this.gridCols(), rows: this.gridRows(),
      width: a.w, height: a.h, ticker: this.app.ticker, palette: this.game.theme?.palette,
    });
    this.grid.position.set(a.x, a.y);
    this.world.addChild(this.grid);
    this.grid.setGrid(this.randomGrid());

    if (this.logoTexture) {
      const logo = new Sprite(this.logoTexture);
      logo.anchor.set(0.5, 1);
      const k = Math.min(420 / logo.texture.width, (a.y - 8) / logo.texture.height, 1);
      logo.scale.set(k);
      logo.position.set(w / 2, a.y - 6);
      this.world.addChild(logo);
    }
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
    });
    this.hud.onTurbo = (v) => { this.grid.turbo = v; };
  }

  supportsBuy() { return false; }

  /** Gancho para limpiar capas propias del motor (etiquetas, colosales…) antes de girar. */
  onSpinStart() {}

  fit() {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const k = Math.min(W / this.design.w, H / this.design.h);
    this.world.scale.set(k);
    this.world.position.set((W - this.design.w * k) / 2, (H - this.design.h * k) / 2);
  }

  // ---------------------------------------------------------------- Ciclo de juego
  async spin(mode = 'base') {
    if (this.busy) return;
    const bet = this.hud.bet;
    const cost = mode === 'buy' ? bet * (this.game.rules.buyCost || 1) : bet;
    if (this.hud.balance < cost) { this.hud.error('Saldo insuficiente para esta apuesta.'); return; }
    this.busy = true;
    this.hud.lock(true);
    this.hud.setWin(0);
    this.hud.setBalance(this.hud.balance - cost); // visual: el servidor confirma el saldo real
    this.sound.unlock();
    this.sound.play('spin');
    this.grid.undim();
    this.onSpinStart();
    this.grid.startSpin();
    let round;
    try {
      [round] = await Promise.all([this.api.spin(bet, mode), wait(this.hud.turbo ? 200 : 550)]);
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
    this.hud.setWin(round.win);
    if (round.win > 0) await this.presentTotal(round.win, bet);
    this.hud.setBalance(round.balance);
    // Aviso al sitio del operador cuando el juego va embebido en un iframe (client-sdk).
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'casino:round', gameId: this.game.id, roundId: round.roundId, bet: round.bet, cost: round.cost, win: round.win, balance: round.balance }, '*');
    }
    if (round.creditPending) this.hud.setStatus('Premio en proceso de acreditación por el operador…');
    this.busy = false;
    this.hud.lock(false);
    if (this.hud.autoLeft > 0 && !(round.result.freeSpins || round.result.holdAndWin)) {
      if (this.hud.consumeAuto()) setTimeout(() => this.spin('base'), 350);
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
    this.flashWinText(this.money(stepWinMult));
    await this.grid.highlight(positions);
    this.grid.undim();
  }

  flashWinText(cents) {
    this.winText.text = this.hud.fmt(cents);
    gsap.killTweensOf(this.winText);
    gsap.killTweensOf(this.winText.scale);
    this.winText.alpha = 1;
    this.winText.scale.set(0.4);
    gsap.to(this.winText.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2)' });
    gsap.to(this.winText, { alpha: 0, duration: 0.4, delay: this.hud.turbo ? 0.5 : 1.1 });
  }

  async presentTotal(cents, bet) {
    const x = cents / bet;
    if (x >= 50) {
      this.sound.play('bigWin');
      await this.hud.showBanner(`<small>¡MEGA PREMIO!</small><b>${this.hud.fmt(cents)}</b>`, { kind: 'big', ms: 3200 });
    } else if (x >= 15) {
      this.sound.play('bigWin');
      await this.hud.showBanner(`<small>GRAN PREMIO</small><b>${this.hud.fmt(cents)}</b>`, { kind: 'big', ms: 2400 });
    } else if (x >= 1) {
      await this.hud.showBanner(`<b>${this.hud.fmt(cents)}</b>`, { kind: 'win', ms: 900 });
    }
  }

  async featureIntro(title, sub = '') {
    this.sound.play('feature');
    this.sound.playMusic('featureMusic');
    await this.hud.showBanner(`<small>${sub}</small><b>${title}</b>`, { kind: 'feature', ms: 2000 });
  }

  async featureOutro(totalMult) {
    await this.hud.showBanner(`<small>TOTAL DEL BONUS</small><b>${this.hud.fmt(this.money(totalMult))}</b>`, { kind: 'feature', ms: 2200 });
    this.sound.playMusic('music');
  }

  async buyBonus() {
    if (this.busy) return;
    const price = this.hud.bet * this.game.rules.buyCost;
    const ok = await this.hud.confirm('Comprar bonus', `¿Comprar los giros gratis por ${this.hud.fmt(price)}?`, `Comprar por ${this.hud.fmt(price)}`);
    if (ok) this.spin('buy');
  }

  // ---------------------------------------------------------------- Reglas y pagos (obligatorio en mercados regulados)
  payUnit() { return 1; }

  showInfo() {
    const bet = this.hud.bet;
    const unit = this.payUnit();
    const rows = this.game.symbols.map((s) => {
      const pays = Object.entries(s.pays || {}).sort((a, b) => b[0] - a[0])
        .map(([n, p]) => h('div', {}, `${n}× `, h('b', {}, this.hud.fmt(Math.round(p * unit * bet)))));
      const kind = s.type === 'wild' ? 'Sustituye a los símbolos normales'
        : s.type === 'scatter' ? 'Activa los giros gratis'
          : s.type === 'coin' ? 'Activa el bonus Hold & Win' : null;
      return h('div', { class: 'pay' }, h('img', { src: s.image, alt: s.name }), h('div', {}, h('strong', {}, s.name), kind ? h('div', {}, kind) : null, ...pays));
    });
    const rtp = this.game.math?.rtp ? `${(this.game.math.rtp * 100).toFixed(2)} %` : '—';
    this.hud.openModal(h('div', { class: 'info' },
      h('h2', {}, this.game.theme?.title || this.game.name),
      h('p', {}, this.constructor.rulesText),
      h('p', {}, `Premios de la tabla calculados para la apuesta actual (${this.hud.fmt(bet)}). Premio máximo: ${this.game.rules?.maxWin ?? '—'}× la apuesta.`),
      h('div', { class: 'paytable' }, rows),
      h('p', { class: 'fine' }, `RTP teórico: ${rtp}. Versión ${this.game.version ?? 'borrador'}. Los resultados se determinan en el servidor con un generador de números aleatorios certificable; el mal funcionamiento anula pagos y jugadas. Juega con responsabilidad.`)));
  }
}

export { wait, h, gsap };
