// Motor 8 — EXPANDING SYMBOL (cliente): libro comodín/scatter y símbolo especial que se expande en giros gratis.
import { Container, Sprite, Graphics, Text } from 'pixi.js';
import { BaseEngine, wait, gsap } from '../../shared/BaseEngine.js';
import { h } from '../../shared/Hud.js';

export class ExpandingSymbolEngine extends BaseEngine {
  rulesText() {
    const R = this.game.rules;
    const book = this.game.symbols.find((s) => s.type === 'wildscatter');
    return `${this.gridLabel()}, ${R.lines} líneas; paga de izquierda a derecha. ${book?.name || 'El libro'} es comodín y scatter a la vez: ${R.scattersToTrigger} o más en cualquier posición dan ${R.freeSpins} giros gratis con un SÍMBOLO ESPECIAL elegido al azar. En los giros gratis, si el símbolo especial aparece en suficientes rodillos, se expande a todo el rodillo y paga en todas las líneas aunque los rodillos no sean contiguos.`
      + (R.secondSpecial ? ` Si vuelven a salir ${R.scattersToTrigger} libros durante los giros gratis, ganas ${R.freeSpins} giros más y un SEGUNDO símbolo especial que también se expande.` : ` Con ${R.scattersToTrigger} libros durante los giros gratis ganas ${R.freeSpins} giros más.`)
      + (R.frameChance > 0 ? ` MARCOS MULTIPLICADORES: en los giros gratis un rodillo puede traer un marco de ×${Math.min(...R.frameValues.map((f) => f.value ?? f))} a ×${Math.max(...R.frameValues.map((f) => f.value ?? f))} que multiplica la expansión si ese rodillo se expande.` : '')
      + (R.anteCost > 0 ? ` DOBLE CHANCE: por ${R.anteCost}× la apuesta aparecen más libros.` : '');
  }

  /** El libro se abre y pasa páginas hasta el símbolo especial que decidió el servidor. */
  async bookReveal(specialId, title) {
    const syms = this.game.symbols.filter((x) => (x.type || 'regular') === 'regular');
    const target = syms.find((x) => x.id === specialId);
    const img = h('img', { class: 'bk-img', alt: '' });
    const name = h('b', { class: 'bk-name' }, '');
    const book = h('div', { class: 'bk-book' }, h('div', { class: 'bk-page' }, img, name));
    this.hud.openModal(h('div', { class: 'confirm bk-modal' }, h('h2', {}, title), book));
    const show = (x) => { img.src = x.image; name.textContent = x.name || x.id; };
    const n = this.hud.turbo ? 10 : 22;
    for (let k = 0; k < n; k++) {
      show(syms[(k * 3 + Math.floor(Math.random() * syms.length)) % syms.length]);
      book.classList.remove('flip'); void book.offsetWidth; book.classList.add('flip');
      this.sound.play('click');
      await wait(60 + (k > n - 6 ? (k - (n - 6)) * 70 : 0));
    }
    show(target || syms[0]);
    book.classList.add('done');
    this.sound.play('feature');
    await wait(this.hud.turbo ? 600 : 1400);
    this.hud.modal.hidden = true;
  }

  /** Marco multiplicador sobre un rodillo. */
  drawFrame(frame, hit) {
    const g = this.grid;
    const x = frame.reel * (g.colW + g.gap);
    const accent = this.game.theme?.palette?.accent || '#f5cd79';
    const fr = new Graphics().roundRect(x - 2, -2, g.colW + 4, g.h + 4, 16).stroke({ color: hit ? '#ff4757' : accent, width: 7 });
    const t = new Text({ text: `×${frame.mult}`, style: { fontFamily: this.game.theme?.font || 'Arial', fontSize: 34, fontWeight: '900', fill: '#ffffff', stroke: { color: '#8a5a00', width: 7 } } });
    t.anchor.set(0.5, 0);
    t.position.set(x + g.colW / 2, 4);
    this.expandLayer.addChild(fr, t);
    gsap.from(t.scale, { x: 0, y: 0, duration: 0.4, ease: 'back.out(2.2)' });
    gsap.fromTo(fr, { alpha: 0 }, { alpha: 1, duration: 0.25 });
  }

  payUnit() { return 1 / (this.game.rules?.lines || 10); }
  bookId() { return this.game.symbols.find((s) => s.type === 'wildscatter')?.id; }

  buildScene() {
    super.buildScene();
    this.expandLayer = new Container();
    this.grid.fx.addChild(this.expandLayer);
  }

  onSpinStart() { this.clearExpand(); }
  clearExpand() { this.expandLayer?.removeChildren().forEach((c) => c.destroy()); }

  async expand(reels, symbolId) {
    const g = this.grid;
    this.sound.play('feature', { rate: 1.3 });
    const tweens = [];
    for (const c of reels) {
      const x = c * (g.colW + g.gap);
      const bg = new Graphics().roundRect(x, 0, g.colW, g.h, 14).fill({ color: this.game.theme?.palette?.reelBg || '#3d2710', alpha: 0.96 })
        .roundRect(x + 2, 2, g.colW - 4, g.h - 4, 12).stroke({ color: this.game.theme?.palette?.accent || '#f5cd79', width: 5 });
      const s = new Sprite(g.texture(symbolId));
      s.anchor.set(0.5);
      const k = Math.min((g.colW * 0.95) / s.texture.width, (g.h * 0.95) / s.texture.height);
      s.position.set(x + g.colW / 2, g.h / 2);
      s.scale.set(k * 0.3, k * 0.3);
      bg.alpha = 0;
      this.expandLayer.addChild(bg, s);
      tweens.push(gsap.to(bg, { alpha: 1, duration: 0.2 }).then());
      tweens.push(gsap.to(s.scale, { x: k, y: k, duration: 0.35, ease: 'back.out(1.6)' }).then());
      await wait(this.hud.turbo ? 40 : 120);
    }
    await Promise.all(tweens);
  }

  async playResult(result) {
    const b = result.base;
    await this.stopReels(b.grid, { scatterId: this.bookId() });
    await this.presentWins(b.wins, b.win);
    if (result.scatterPay > 0) {
      await this.grid.highlight(b.books, { times: 2 });
      this.roundWin = (this.roundWin || 0) + this.money(result.scatterPay);
      this.hud.countWin(this.roundWin);
    }
    const fs = result.freeSpins;
    if (!fs) return;
    await this.grid.highlight(b.books, { times: 3 });
    const sp = this.game.symbols.find((s) => s.id === fs.special);
    const nameOf = (id) => this.game.symbols.find((s) => s.id === id)?.name || id;
    await this.featureIntro(this.msg('freeSpins', { n: fs.awarded }), 'EL LIBRO ELIGE EL SÍMBOLO ESPECIAL');
    await this.bookReveal(fs.special, 'Símbolo especial');
    const specials = [fs.special];
    let i = 0, total = fs.awarded;
    for (const s of fs.spins) {
      i++;
      this.hud.setStatus(`${this.msg('spinOf', { i, n: total })} · ESPECIAL: ${specials.map(nameOf).join(' + ')}`);
      this.clearExpand();
      this.grid.undim();
      this.grid.startSpin();
      await wait(this.hud.turbo ? 100 : 260);
      await this.stopReels(s.grid, { scatterId: this.bookId() });
      if (s.frame) { this.drawFrame(s.frame, false); this.sound.play('feature', { rate: 1.5 }); await wait(this.hud.turbo ? 150 : 400); }
      await this.presentWins(s.wins, s.win - s.expandWin);
      const exps = s.expansions || (s.expanded.length ? [{ symbol: fs.special, expanded: s.expanded, win: s.expandWin, frameMult: s.frameHit ? s.frame.mult : 1 }] : []);
      for (const e of exps) {
        if (!e.expanded.length) continue;
        await this.expand(e.expanded, e.symbol);
        if (s.frame) this.drawFrame(s.frame, e.frameMult > 1);
        if (e.frameMult > 1) await this.hud.showBanner(`<small>MARCO MULTIPLICADOR</small><b>×${e.frameMult}</b>`, { kind: 'feature', ms: this.hud.turbo ? 600 : 1200 });
        this.flashWinText(this.money(e.win));
        this.roundWin = (this.roundWin || 0) + this.money(e.win);
        this.hud.countWin(this.roundWin);
        this.sound.play('bigWin');
        await wait(this.hud.turbo ? 400 : 1000);
        this.clearExpand();
      }
      if (s.retrigger) {
        total += s.retrigger;
        await this.grid.highlight(s.books, { times: 2 });
        await this.hud.showBanner(`<small>¡MÁS GIROS!</small><b>+${s.retrigger}</b>`, { kind: 'feature', ms: 1400 });
      }
      if (s.newSpecial) {
        await this.bookReveal(s.newSpecial, 'Segundo símbolo especial');
        specials.push(s.newSpecial);
      }
    }
    this.hud.setStatus('');
    this.clearExpand();
    await this.featureOutro(fs.totalWin);
  }
}
