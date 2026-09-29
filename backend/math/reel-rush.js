// Motor 1 — REEL RUSH: 5x3, 243 ways, cascadas (tumble) con multiplicador creciente.
import {
  symbolMap, spinStrips, evaluateWays, sumPays, cloneGrid, capWin, validateCommon, validateGrid, buildStrip, round6,
} from './common.js';

export const id = 'reel-rush';
export const name = 'Reel Rush';
export const description = 'Cascadas: los símbolos ganadores explotan, los de arriba caen y el multiplicador sube con cada cascada.';

export function play(config, rng) {
  const syms = symbolMap(config);
  const rows = config.grid.rows;
  const strips = config.reels;
  const mults = config.rules.cascadeMultipliers;
  const { stops, grid: g0 } = spinStrips(rng, strips, rows);
  let grid = g0;
  const ptr = stops.slice(); // índice superior actual de cada rodillo en su tira
  const steps = [];
  let total = 0;
  for (let cascade = 0; cascade < 60; cascade++) {
    const wins = evaluateWays(grid, syms);
    const multiplier = mults[Math.min(cascade, mults.length - 1)];
    const base = sumPays(wins);
    const win = round6(base * multiplier);
    steps.push({ grid: cloneGrid(grid), wins, multiplier, win });
    if (!wins.length) break;
    total += win;
    // Quitar posiciones ganadoras y rellenar desde arriba con la tira.
    const removed = grid.map(() => new Set());
    for (const w of wins) for (const [c, r] of w.positions) removed[c].add(r);
    grid = grid.map((col, c) => {
      const keep = col.filter((_, r) => !removed[c].has(r));
      const need = rows - keep.length;
      const fresh = [];
      for (let i = 0; i < need; i++) {
        ptr[c] = (ptr[c] - 1 + strips[c].length) % strips[c].length;
        fresh.unshift(strips[c][ptr[c]]);
      }
      return [...fresh, ...keep];
    });
    steps[steps.length - 1].removed = removed.map((s) => [...s].sort((a, b) => a - b));
  }
  const { total: capped, capped: wasCapped } = capWin(total, config);
  return { engine: id, stops, steps, totalWin: capped, capped: wasCapped, cascades: steps.length - 1 };
}

export function validate(config) {
  const errors = [...validateCommon(config), ...validateGrid(config)];
  const m = config.rules?.cascadeMultipliers;
  if (!Array.isArray(m) || !m.length || m.some((x) => typeof x !== 'number' || x < 1)) {
    errors.push('rules.cascadeMultipliers debe ser una lista de números >= 1');
  }
  return errors;
}

export function scalePays(config, k) {
  for (const s of config.symbols) for (const key of Object.keys(s.pays || {})) s.pays[key] = round6(s.pays[key] * k);
}

const ph = (label, color) => `/gen/symbol.svg?label=${encodeURIComponent(label)}&color=${encodeURIComponent(color)}`;

export function defaults() {
  const weights = { cherry: 9, lemon: 9, orange: 8, plum: 8, bell: 6, bar: 5, seven: 3, diamond: 2, wild: 2 };
  return {
    engine: id,
    name: 'Reel Rush',
    grid: { reels: 5, rows: 3 },
    symbols: [
      { id: 'cherry', name: 'Cereza', type: 'regular', image: '/game-engines/engine-reel-rush/assets/images/symbols/cherry.png', pays: { 3: 0.05, 4: 0.1, 5: 0.25 } },
      { id: 'lemon', name: 'Limón', type: 'regular', image: '/game-engines/engine-reel-rush/assets/images/symbols/lemon.png', pays: { 3: 0.05, 4: 0.1, 5: 0.25 } },
      { id: 'orange', name: 'Naranja', type: 'regular', image: ph('🍊', '#f39c12'), pays: { 3: 0.06, 4: 0.12, 5: 0.3 } },
      { id: 'plum', name: 'Ciruela', type: 'regular', image: ph('🍇', '#8e44ad'), pays: { 3: 0.06, 4: 0.12, 5: 0.3 } },
      { id: 'bell', name: 'Campana', type: 'regular', image: ph('🔔', '#f1c40f'), pays: { 3: 0.1, 4: 0.25, 5: 0.6 } },
      { id: 'bar', name: 'BAR', type: 'regular', image: ph('BAR', '#2c3e50'), pays: { 3: 0.15, 4: 0.4, 5: 1 } },
      { id: 'seven', name: 'Siete', type: 'regular', image: '/game-engines/engine-reel-rush/assets/images/symbols/seven.png', pays: { 3: 0.25, 4: 0.75, 5: 2 } },
      { id: 'diamond', name: 'Diamante', type: 'regular', image: ph('💎', '#1abc9c'), pays: { 3: 0.4, 4: 1.2, 5: 4 } },
      { id: 'wild', name: 'Comodín', type: 'wild', image: ph('WILD', '#e74c3c'), pays: {} },
    ],
    reels: [1, 2, 3, 4, 5].map((i) => buildStrip(weights, 1000 + i)),
    rules: { cascadeMultipliers: [1, 2, 3, 5, 8], maxWin: 5000 },
    bet: { levels: [20, 50, 100, 200, 500, 1000, 2000, 5000], default: 100, currency: 'USD' },
    theme: {
      title: 'Reel Rush',
      background: '/game-engines/engine-reel-rush/assets/images/ui/background.png',
      backgroundColor: '#1a1a2e',
      palette: { primary: '#e94560', accent: '#ffd460', panel: '#16213e', text: '#ffffff', reelBg: '#0f3460' },
      font: 'Bungee',
      spinButton: '/game-engines/engine-reel-rush/assets/images/ui/spin-button.png',
    },
    sounds: { music: null, spin: null, reelStop: null, win: null, bigWin: null, feature: null, click: null },
    rtpTarget: 0.96,
  };
}
