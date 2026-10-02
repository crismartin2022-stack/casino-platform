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
  /**
   * @param {object} [o.look] aspecto editable desde el tema:
   *   gap (px entre celdas), symbolScale (0.6–1, cuánto de la celda ocupa el símbolo),
   *   cellColor, cellAlpha, cellRadius, cellBorder (color del borde de cada celda, null = sin borde),
   *   cellTexture (imagen de fondo de cada celda), reelsTexture (imagen detrás de todos los rodillos),
   *   frameTexture (marco decorativo alrededor), frameColor.
   */
  constructor({ textures, fillerIds, cols, rows, width, height, ticker, palette = {}, look = {} }) {
    const gap = look.gap ?? 6;
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
    this.look = look;
    this.symbolScale = Math.min(1, Math.max(0.6, look.symbolScale ?? 0.92));
    this.colW = (width - gap * (cols - 1)) / cols;
    this.turbo = false;

    // Capas: marco decorativo (detrás) → fondo de rodillos → recuadros de celda → símbolos → marco (delante) → efectos
    // theme.frameLayer: "front" pone el marco por encima de los símbolos (para marcos con el centro transparente).
    // theme.frameScale: tamaño del marco respecto de los rodillos (1 = justo; 1,12 por defecto).
    let frameSprite = null;
    if (look.frameTexture) {
      const f = new Sprite(look.frameTexture);
      // theme.frameScaleX / frameScaleY: ancho y alto por separado (0,5-2,5); theme.frameOffsetX: mover a izquierda/derecha.
      const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v)));
      const k = look.frameScale != null ? clamp(look.frameScale, 0.9, 1.6) : null;
      const kx = look.frameScaleX != null && Number.isFinite(Number(look.frameScaleX)) ? clamp(look.frameScaleX, 0.5, 2.5) : k;
      const ky = look.frameScaleY != null && Number.isFinite(Number(look.frameScaleY)) ? clamp(look.frameScaleY, 0.5, 2.5) : k;
      const padX = kx != null ? (width * (kx - 1)) / 2 : Math.max(width, height) * 0.06;
      const padY = ky != null ? (height * (ky - 1)) / 2 : Math.max(width, height) * 0.06;
      f.position.set(-padX + (clamp(look.frameOffsetX || 0, -400, 400) || 0), -padY + (Number(look.frameOffsetY) || 0));
      f.width = width + padX * 2;
      f.height = height + padY * 2;
      frameSprite = f;
      if (look.frameLayer !== 'front') this.addChild(f);
    }
    if (look.reelsTexture) {
      const r = new Sprite(look.reelsTexture);
      r.position.set(-10, -10);
      r.width = width + 20;
      r.height = height + 20;
      this.addChild(r);
      this.reelsSprite = r;
    }
    this.tiles = new Container(); // imágenes de celda
    this.addChild(this.tiles);
    this.bg = new Container();    // recuadros y bordes de celda
    this.addChild(this.bg);
    this.content = new Container();
    this.addChild(this.content);
    const mask = new Graphics().rect(0, 0, width, height).fill(0xffffff);
    this.addChild(mask);
    this.content.mask = mask;
    if (frameSprite && look.frameLayer === 'front') {
      this.addChild(frameSprite);
      // Si el marco no trae el centro transparente, se recorta el hueco de los rodillos (theme.frameCut = false lo desactiva).
      if (look.frameCut !== false) {
        const hole = new Graphics().rect(frameSprite.x, frameSprite.y, frameSprite.width, frameSprite.height).fill(0xffffff).rect(0, 0, width, height).cut();
        this.addChild(hole);
        frameSprite.mask = hole;
      }
    }
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

  /** Dibuja un recuadro por celda (se redibuja por columna cuando cambia su altura, p. ej. Megaways). */
  drawBackground(onlyCol = null) {
    const L = this.look;
    const color = L.cellColor || this.palette.reelBg || '#0f3460';
    const alpha = L.cellAlpha ?? 0.82;
    const border = L.cellBorder === undefined ? (this.palette.accent || '#ffd460') : L.cellBorder;
    const radius = L.cellRadius ?? 12;
    if (!this.cellGfx) this.cellGfx = Array.from({ length: this.cols }, () => this.bg.addChild(new Graphics()));
    if (!this.cellSprites) this.cellSprites = Array.from({ length: this.cols }, () => []);
    for (let c = 0; c < this.cols; c++) {
      if (onlyCol != null && c !== onlyCol) continue;
      const g = this.cellGfx[c].clear();
      for (const s of this.cellSprites[c]) s.destroy();
      this.cellSprites[c] = [];
      const ch = this.cellH(c);
      const x = c * (this.colW + this.gap);
      for (let r = 0; r < this.heights[c]; r++) {
        const y = r * ch + this.gap / 2;
        const h = ch - this.gap;
        if (L.cellTexture) {
          const sp = new Sprite(L.cellTexture);
          sp.position.set(x, y); sp.width = this.colW; sp.height = h;
          this.tiles.addChild(sp);
          this.cellSprites[c].push(sp);
        } else {
          g.roundRect(x, y, this.colW, h, radius).fill({ color, alpha });
        }
        if (border) g.roundRect(x + 1, y + 1, this.colW - 2, h - 2, radius).stroke({ color: border, width: 2, alpha: 0.85 });
      }
    }
    if (onlyCol == null && !this.frameDrawn && !L.frameTexture) {
      this.frameDrawn = true;
      const f = new Graphics().roundRect(-8, -8, this.w + 16, this.h + 16, 18)
        .stroke({ color: L.frameColor || this.palette.accent || '#ffd460', width: 5, alpha: 0.95 });
      this.addChildAt(f, 0);
    }
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
    const k = Math.min((this.colW * this.symbolScale) / s.texture.width, ((ch - this.gap) * this.symbolScale) / s.texture.height);
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
      if (this.heights[c] !== ids.length) { this.heights[c] = ids.length; this.drawBackground(c); }
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
      for (const s of col.sprites) if (s) gsap.to(s, { y: s.y + this.h, duration: 0.18, ease: 'power2.in', onComplete: () => s.destroy() });
      col.sprites = [];
      col.cont.addChild(layer);
      const speed = this.h * (this.turbo ? 0.14 : 0.1);
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
    if (this.heights[c] !== ids.length) { this.heights[c] = ids.length; this.drawBackground(c); }
    const dur = this.turbo ? 0.14 : 0.24;
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
    const delay = this.turbo ? 40 : 110;
    for (let c = 0; c < grid.length; c++) {
      if (anticipation.includes(c)) await wait(this.turbo ? 250 : 700);
      await Promise.race([this.stopColumn(c, grid[c]), wait(delay)]);
      onReelStop?.(c);
    }
    await wait(this.turbo ? 80 : 160);
  }

  // ---------------------------------------------------------------- Premios
  /**
   * Resalta un premio: recuadro brillante en cada celda ganadora, pulso del símbolo,
   * chispas y (en juegos de líneas) el trazo de cada línea ganadora. El resto se oscurece.
   * lines: array de arrays de [c, r] con el recorrido de cada línea.
   */
  highlight(positions, { color = this.palette.accent || '#ffd460', times = 2, lines = [], sparks = true } = {}) {
    const key = new Set(positions.map(([c, r]) => `${c},${r}`));
    const fast = this.turbo ? 0.6 : 1;
    const frames = new Graphics();
    const glow = new Graphics();
    this.fx.addChild(glow, frames);
    this.columns.forEach((col, c) => col.sprites.forEach((s, r) => {
      if (!s) return;
      if (key.has(`${c},${r}`)) {
        gsap.to(s.scale, { x: s.baseScale * 1.12, y: s.baseScale * 1.12, duration: 0.16 * fast, yoyo: true, repeat: times * 2 - 1, ease: 'sine.inOut' });
        const ch = this.cellH(c);
        const x = c * (this.colW + this.gap), y = r * ch + this.gap / 2, h = ch - this.gap;
        glow.roundRect(x - 3, y - 3, this.colW + 6, h + 6, 16).fill({ color, alpha: 0.28 });
        frames.roundRect(x + 1, y + 1, this.colW - 2, h - 2, 12).stroke({ color, width: 4 });
        if (sparks) this.sparks(x + this.colW / 2, y + h / 2, color);
      } else {
        gsap.to(s, { alpha: 0.3, duration: 0.12 });
      }
    }));
    for (const line of lines) {
      if (!line?.length) continue;
      const pts = line.map(([c, r]) => this.cellCenter(c, r));
      frames.moveTo(pts[0].x, pts[0].y);
      for (const pt of pts.slice(1)) frames.lineTo(pt.x, pt.y);
      frames.stroke({ color, width: 5, alpha: 0.9, cap: 'round', join: 'round' });
    }
    frames.alpha = 0;
    glow.alpha = 0;
    const d = 0.16 * fast;
    gsap.to(frames, { alpha: 1, duration: d, yoyo: true, repeat: times * 2 - 1, onComplete: () => frames.destroy() });
    gsap.to(glow, { alpha: 1, duration: d, yoyo: true, repeat: times * 2 - 1, onComplete: () => glow.destroy() });
    return wait(times * d * 2000 + 40);
  }

  /** Chispas que salen de una celda ganadora. */
  sparks(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const p = new Graphics().circle(0, 0, 3 + Math.random() * 3).fill({ color });
      p.position.set(x, y);
      this.fx.addChild(p);
      const a = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 60;
      gsap.to(p, { x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0, duration: 0.5 + Math.random() * 0.3, ease: 'power2.out', onComplete: () => p.destroy() });
    }
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
        tweens.push(gsap.to(s.scale, { x: 0, y: 0, duration: 0.2, ease: 'back.in(2)' }).then());
        this.sparks(this.columns[c].cont.x + s.x, s.y, this.palette.accent || '#ffd460', 6);
        tweens.push(gsap.to(s, { rotation: 0.6, alpha: 0, duration: 0.2, onComplete: () => s.destroy() }).then());
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
        tweens.push(gsap.to(s, { y: target, duration: 0.3, ease: 'back.out(1.2)', delay: c * 0.02 }).then());
      }
      keep.forEach((s, i) => {
        const r = fresh + i;
        s.alpha = 1;
        sprites.push(s);
        tweens.push(gsap.to(s, { y: (r + 0.5) * ch, duration: 0.26, ease: 'back.out(1.2)', delay: c * 0.02 }).then());
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
