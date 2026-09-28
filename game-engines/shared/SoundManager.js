// Sonido con Web Audio: efectos superpuestos sin cortes y música en loop con fundido.
export class SoundManager {
  constructor(sounds = {}, volumes = {}) {
    this.urls = Object.fromEntries(Object.entries(sounds).filter(([, v]) => v));
    this.volumes = { music: 0.45, featureMusic: 0.5, spin: 0.6, reelStop: 0.5, click: 0.4, ...volumes };
    this.buffers = new Map();
    this.muted = (() => { try { return localStorage.getItem('slots.muted') === '1'; } catch { return false; } })();
    this.ctx = null;
    this.musicNode = null;
    this.musicSlot = null;
  }

  /** Los navegadores exigen un gesto del usuario antes de reproducir audio. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.preload();
  }

  async preload() {
    await Promise.all(Object.entries(this.urls).map(async ([slot, url]) => {
      try {
        const res = await fetch(url);
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(slot, buf);
      } catch (e) { console.warn(`Sonido ${slot} no disponible`, e); }
    }));
    if (this.pendingMusic) this.playMusic(this.pendingMusic);
  }

  play(slot, { rate = 1 } = {}) {
    const buf = this.buffers.get(slot);
    if (!this.ctx || !buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = this.volumes[slot] ?? 0.8;
    src.connect(g).connect(this.master);
    src.start();
  }

  playMusic(slot = 'music') {
    if (this.musicSlot === slot) return;
    const buf = this.buffers.get(slot);
    if (!this.ctx || !buf) { this.pendingMusic = slot; return; }
    this.pendingMusic = null;
    this.stopMusic();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(this.volumes[slot] ?? 0.45, this.ctx.currentTime + 1.2);
    src.connect(g).connect(this.master);
    src.start();
    this.musicNode = { src, g };
    this.musicSlot = slot;
  }

  stopMusic() {
    if (!this.musicNode) return;
    const { src, g } = this.musicNode;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + 0.6);
    src.stop(t + 0.7);
    this.musicNode = null;
    this.musicSlot = null;
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('slots.muted', this.muted ? '1' : '0'); } catch { /* sin almacenamiento */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }
}
