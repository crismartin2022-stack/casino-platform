// Vista de la cuadrícula de símbolos (PixiJS v8 + GSAP). Sirve a los 5 motores:
// columnas de altura variable (Megaways), cascadas (Reel Rush), celdas bloqueadas (Hold & Win)
// y superposiciones gigantes (Colossal).
import { Container, Sprite, Graphics } from 'pixi.js';
import { gsap } from 'gsap';

export class GridView extends Container {
  /**
   * @param {object} o
   * @param {Map<string, import('pixi.js').Texture>} o.textures
   * @param {string[]} o.fillerIds  símbolos para el efecto de giro
   * @param {number} o.cols
   * @param {number|number[]} o.rows
   * @param {number} o.width  @param {number} o.height
   * @param {import('pixi.js').Ticker} o.ticker
   */
  constructor({ textures, fillerIds, cols, rows, width, height, ticker, palette = {}, gap = 6 }) {
    super();
    this.textures = textures;
    this.fillerIds = fillerIds;
    this.cols = cols;
    this.heights = Array.isArray(rows) ? rows.slice() : Array(cols).fill(rows);
    this.w = width;
    this.h = height;
    this.gap = gap;
    this.ticker = ticker;
    this.palette = palette;
    this.colW = (width - gap * (cols - 1)) / cols;
    this.turbo = false;

    this.bg = new Graphics();
    this.addChild(this.bg);
    this.content = new Container();
    this.addChild(this.content);
    const mask = new Graphics().rect(0, 0, width, height).fill(0xffffff);
    this.addChild(mask);
    this.content.mask = mask;
    this.fx = new Container(); // capa de efectos por encima (sin máscara)
    this.addChild(this.fx);

    this.columns = Array.from({ length: cols }, (_, c) => {
      const cont = new Container();
      cont.x = c * (this.colW + gap);
      this.content.addChild(cont);
      return { cont, sprites: [], spin: null };
    });
    this.drawBackground();
  }

  drawBackground() {
    const g = this.bg.clear();
    const color = this.palette.reelBg || '#0f3460';
    for (let c = 0; c < this.cols; c++) {
      g.roundRect(c * (this.colW + this.gap), 0, this.colW, this.h, 14).fill({ color, alpha: 0.78 });
    }
    g.roundRect(-8, -8, this.w + 16, this.h + 16, 20).stroke({ color: this.palette.accent || '#ffd460', width: 4, alpha: 0.9 });
  }

  cellH(c) { return this.h / this.heights[c]; }

  /** Centro de una celda en coordenadas de la cuadrícula. */
  cellCenter(c, r) {
    return { x: c * (this.colW + this.gap) + this.colW / 2, y: (r + 0.5) * this.cellH(c) };
  }

  texture(id) {
    return this.textures.get(id) || this.textures.get('__missing');
  }

  makeSprite(id, c, r) {
    const s = new Sprite(this.texture(id));
    s.anchor.set(0.5);
    const ch = this.cellH(c);
    const k = Math.min((this.colW * 0.88) / s.texture.width, (ch * 0.88) / s.texture.height);
    s.scale.set(k);
    s.baseScale = k;
    s.symbolId = id;
    s.x = this.colW / 2;
    s.y = (r + 0.5) * ch;
    return s;
  }

  clearColumn(c) {
    const col = this.columns[c];
    for (const s of col.sprites) if (s) { gsap.killTweensOf(s); gsap.killTweensOf(s.scale); s.destroy(); }
    col.sprites = [];
  }

  /** Coloca una cuadrícula al instante (sin animación). */
  setGrid(grid) {
    grid.forEach((ids, c) => {
      this.heights[c] = ids.length;
      this.clearColumn(c);
      this.columns[c].sprites = ids.map((id, r) => {
        const s = this.makeSprite(id, c, r);
        this.columns[c].cont.addChild(s);
        return s;
      });
    });
  }

  getSprite(c, r) { return this.columns[c]?.sprites[r] || null; }

  // ---------------------------------------------------------------- Giro
  startSpin(columns = null) {
    const which = columns ?? this.columns.map((_, i) => i);
    for (const c of which) {
      const col = this.columns[c];
      if (col.spin) continue;
      const layer = new Container();
      const ch = this.cellH(c);
      const n = this.heights[c] + 2;
      for (let i = 0; i < n; i++) {
        const s = this.makeSprite(this.randomFiller(), c, i - 1);
        s.alpha = 0.85;
        s.scale.y = s.baseScale * 1.12;
        layer.addChild(s);
      }
      // Los símbolos actuales caen y desaparecen
      for (const s of col.sprites) if (s) gsap.to(s, { y: s.y + this.h, duration: 0.25, ease: 'power2.in', onComplete: () => s.destroy() });
      col.sprites = [];
      col.cont.addChild(layer);
      const speed = this.h * (this.turbo ? 0.12 : 0.075);
      const tick = (t) => {
        for (const s of layer.children) {
          s.y += speed * t.deltaTime;
          if (s.y - ch / 2 > this.h) {
            s.y -= n * ch;
            s.texture = this.texture(this.randomFiller());
          }
        }
      };
      this.ticker.add(tick);
      col.spin = { layer, tick };
    }
  }

  randomFiller() {
    return this.fillerIds[Math.floor(Math.random() * this.fillerIds.length)];
  }

  stopColumn(c, ids) {
    const col = this.columns[c];
    if (col.spin) {
      this.ticker.remove(col.spin.tick);
      col.spin.layer.destroy({ children: true });
      col.spin = null;
    }
    this.clearColumn(c);
    this.heights[c] = ids.length;
    const dur = this.turbo ? 0.18 : 0.32;
    const tweens = ids.map((id, r) => {
      const s = this.makeSprite(id, c, r);
      const targetY = s.y;
      s.y = targetY - this.h;
      col.cont.addChild(s);
      col.sprites[r] = s;
      return gsap.to(s, { y: targetY, duration: dur, ease: 'back.out(1.4)' });
    });
    return Promise.all(tweens.map((t) => t.then()));
  }

  /** Detiene todos los rodillos en secuencia. onReelStop(c) permite reproducir sonidos o anticipaciones. */
  async stop(grid, { onReelStop, anticipation = [] } = {}) {
    const delay = this.turbo ? 60 : 160;
    for (let c = 0; c < grid.length; c++) {
      if (anticipation.includes(c)) await wait(this.turbo ? 300 : 900);
      await Promise.race([this.stopColumn(c, grid[c]), wait(delay)]);
      onReelStop?.(c);
    }
    await wait(this.turbo ? 120 : 280);
  }

  // ---------------------------------------------------------------- Premios
  highlight(positions, { color = this.palette.accent || '#ffd460', times = 2 } = {}) {
    const key = new Set(positions.map(([c, r]) => `${c},${r}`));
    const frames = new Graphics();
    this.fx.addChild(frames);
    this.columns.forEach((col, c) => col.sprites.forEach((s, r) => {
      if (!s) return;
      if (key.has(`${c},${r}`)) {
        gsap.to(s.scale, { x: s.baseScale * 1.14, y: s.baseScale * 1.14, duration: 0.22, yoyo: true, repeat: times * 2 - 1 });
        const ch = this.cellH(c);
        frames.roundRect(c * (this.colW + this.gap) + 3, r * ch + 3, this.colW - 6, ch - 6, 12).stroke({ color, width: 4 });
      } else {
        gsap.to(s, { alpha: 0.35, duration: 0.2 });
      }
    }));
    frames.alpha = 0;
    gsap.to(frames, { alpha: 1, duration: 0.15, yoyo: true, repeat: times * 2 - 1, onComplete: () => frames.destroy() });
    return wait(times * 440 + 60);
  }

  undim() {
    for (const col of this.columns) for (const s of col.sprites) if (s) gsap.to(s, { alpha: 1, duration: 0.15 });
  }

  /** Explota los símbolos ganadores (cascadas). */
  async explode(removedPerCol) {
    const tweens = [];
    removedPerCol.forEach((rowsToRemove, c) => {
      for (const r of rowsToRemove) {
        const s = this.columns[c].sprites[r];
        if (!s) continue;
        this.columns[c].sprites[r] = null;
        tweens.push(gsap.to(s.scale, { x: 0, y: 0, duration: 0.28, ease: 'back.in(2)' }).then());
        tweens.push(gsap.to(s, { rotation: 0.6, alpha: 0, duration: 0.28, onComplete: () => s.destroy() }).then());
      }
    });
    await Promise.all(tweens);
  }

  /** Tras una explosión: los símbolos que quedan caen y los nuevos entran desde arriba. */
  async cascade(nextGrid) {
    const tweens = [];
    nextGrid.forEach((ids, c) => {
      const col = this.columns[c];
      const keep = col.sprites.filter(Boolean);
      const fresh = ids.length - keep.length;
      const ch = this.cellH(c);
      const sprites = [];
      for (let r = 0; r < fresh; r++) {
        const s = this.makeSprite(ids[r], c, r);
        const target = s.y;
        s.y = target - fresh * ch - 20;
        col.cont.addChild(s);
        sprites.push(s);
        tweens.push(gsap.to(s, { y: target, duration: 0.42, ease: 'bounce.out', delay: c * 0.03 }).then());
      }
      keep.forEach((s, i) => {
        const r = fresh + i;
        s.alpha = 1;
        sprites.push(s);
        tweens.push(gsap.to(s, { y: (r + 0.5) * ch, duration: 0.36, ease: 'bounce.out', delay: c * 0.03 }).then());
      });
      col.sprites = sprites;
    });
    await Promise.all(tweens);
  }

  /** Reemplaza el contenido de una celda con animación (Hold & Win). */
  replaceCell(c, r, id) {
    const col = this.columns[c];
    const old = col.sprites[r];
    if (old) old.destroy();
    const s = this.makeSprite(id, c, r);
    s.scale.set(0);
    col.cont.addChild(s);
    col.sprites[r] = s;
    return gsap.to(s.scale, { x: s.baseScale, y: s.baseScale, duration: 0.35, ease: 'back.out(2)' }).then();
  }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
