// Motor 16 — CRASH (multiplicador en vivo, estilo Aviator): un multiplicador sube desde ×1,00 y en algún momento
// "explota". Los jugadores apuestan durante la cuenta regresiva y se retiran (cash out) antes de la explosión:
// cobran apuesta × multiplicador del momento; si no se retiraron, pierden la apuesta.
//
// - El punto de explosión lo decide el SERVIDOR con una semilla aleatoria por ronda (verificable, "provably fair"):
//   antes de apostar se publica sha256(semilla); al terminar la ronda se revela la semilla y cualquiera puede
//   recalcular el punto con crashFromSeed(). Nunca se calcula en el navegador.
// - RTP EXACTO para cualquier estrategia: P(explosión ≥ x) = rtp / x, así que retirarse en x devuelve x · rtp / x = rtp.
//   Con probabilidad 1 − rtp la ronda explota en ×1,00 (nadie gana).
// - El retiro automático en x gana si la explosión es ≥ x. El tope rules.maxMultiplier (y el premio máximo por
//   apuesta, rules.limits.maxPayout) retiran automáticamente al llegar: no cambian el RTP.
// - La curva del multiplicador en el tiempo (rules.curve) es solo visual y de ritmo: la misma fórmula en el
//   servidor y en el cliente, así el multiplicador que ve el jugador es el que se le paga.
import { createHash, createHmac } from 'node:crypto';

export const id = 'crash';
export const name = 'Crash';
export const kind = 'crash';
export const description = 'Juego Crash en vivo (estilo Aviator): el multiplicador sube y el jugador se retira antes de que explote. Punto de explosión verificable, RTP exacto, dos apuestas por ronda y retiro automático.';

export const CURVE_DEFAULTS = { rate: 0.082, slowAt: 10, slowFactor: 0.5, rampSeconds: 1.5 };

const curveOf = (c) => ({ ...CURVE_DEFAULTS, ...(c || {}) });

/** Multiplicador a los `sec` segundos de vuelo (sin redondear). */
export function multAt(sec, curve) {
  const { rate, slowAt, slowFactor, rampSeconds } = curveOf(curve);
  const t = Math.max(0, sec || 0);
  const full = Math.exp(rate * t);
  if (slowFactor >= 1 || slowAt <= 1 || rampSeconds <= 0 || full < slowAt) return full;
  const tSlow = Math.log(slowAt) / rate;
  const slowRate = rate * slowFactor;
  const slope = (slowRate - rate) / rampSeconds;
  if (t <= tSlow + rampSeconds) {
    const s = t - tSlow;
    return slowAt * Math.exp(rate * s + 0.5 * slope * s * s);
  }
  const ramp = rate * rampSeconds + 0.5 * slope * rampSeconds * rampSeconds;
  return slowAt * Math.exp(ramp + slowRate * (t - tSlow - rampSeconds));
}

/** Segundos de vuelo hasta llegar al multiplicador m (inversa de multAt). */
export function timeFor(m, curve) {
  const { rate, slowAt, slowFactor, rampSeconds } = curveOf(curve);
  if (!(m > 1)) return 0;
  if (slowFactor >= 1 || slowAt <= 1 || rampSeconds <= 0 || m < slowAt) return Math.log(m) / rate;
  const tSlow = Math.log(slowAt) / rate;
  const slowRate = rate * slowFactor;
  const slope = (slowRate - rate) / rampSeconds;
  const L = Math.log(m / slowAt);
  const ramp = rate * rampSeconds + 0.5 * slope * rampSeconds * rampSeconds;
  if (L <= ramp) return tSlow + (-rate + Math.sqrt(Math.max(0, rate * rate + 2 * slope * L))) / slope;
  return tSlow + rampSeconds + (L - ramp) / slowRate;
}

/** Multiplicador que se muestra y se paga (2 decimales hacia abajo). */
export const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;

export const hashSeed = (seed) => createHash('sha256').update(String(seed)).digest('hex');

/**
 * Punto de explosión a partir de la semilla de la ronda (verificable por cualquiera):
 * u = primeros 52 bits de HMAC-SHA256(semilla, "crash") / 2^52;  explosión = piso2(rtp / (1 − u)), mínimo 1,00,
 * máximo rules.maxMultiplier.
 */
export function crashFromSeed(seed, rtp, maxMultiplier) {
  const hex = createHmac('sha256', String(seed)).update('crash').digest('hex').slice(0, 13);
  const u = parseInt(hex, 16) / 2 ** 52;
  return crashFromUniform(u, rtp, maxMultiplier);
}

export function crashFromUniform(u, rtp, maxMultiplier) {
  const m = floor2(rtp / (1 - u));
  return Math.min(Math.max(1, m), maxMultiplier || 1000);
}

/** Multiplicador de retiro automático efectivo de una apuesta (su objetivo, el tope del juego o el premio máximo). */
export function autoTarget(config, amount, auto) {
  const R = config.rules;
  const caps = [R.maxMultiplier];
  if (auto) caps.push(auto);
  if (R.limits?.maxPayout > 0 && amount > 0) caps.push(Math.max(1.01, floor2(R.limits.maxPayout / amount)));
  return Math.min(...caps.filter((x) => x > 1));
}

/** RTP exacto (igual para cualquier forma de jugar) y datos de la curva para la tabla de información. */
export function analyze(config) {
  const R = config.rules;
  const rtp = R.rtp;
  const at = (x) => ({ x, chance: Math.min(1, rtp / x), seconds: Math.round(timeFor(x, R.curve) * 10) / 10 });
  return {
    rtp,
    houseEdge: Math.round((1 - rtp) * 1e6) / 1e6,
    instantCrash: Math.round((1 - rtp) * 1e6) / 1e6,
    targets: [1.5, 2, 3, 5, 10, 50, 100, R.maxMultiplier].filter((x, i, a) => x <= R.maxMultiplier && a.indexOf(x) === i).map(at),
    perBet: { any: rtp },
    volatility: 'la elige el jugador',
  };
}

/** Simulación de rondas (para la prueba silenciosa): retirarse siempre en x. */
export function simulateTarget(config, rng, rounds, x) {
  const R = config.rules;
  let ret = 0;
  for (let i = 0; i < rounds; i++) {
    const u = (rng.int(2 ** 26) * 2 ** 26 + rng.int(2 ** 26)) / 2 ** 52;
    const c = crashFromUniform(u, R.rtp, R.maxMultiplier);
    if (c >= x) ret += x;
  }
  return ret / rounds;
}

export function validate(config) {
  const errors = [];
  const R = config.rules || {};
  if (!(R.rtp >= 0.85 && R.rtp <= 0.99)) errors.push('rules.rtp (RTP) debe estar entre 0.85 y 0.99 (85 % a 99 %)');
  if (!(R.maxMultiplier >= 2 && R.maxMultiplier <= 100000)) errors.push('rules.maxMultiplier (tope) debe estar entre 2 y 100000');
  if (!(R.bettingSeconds >= 3 && R.bettingSeconds <= 60)) errors.push('rules.bettingSeconds (cuenta regresiva para apostar) debe estar entre 3 y 60 s');
  if (!(R.pauseSeconds >= 1 && R.pauseSeconds <= 30)) errors.push('rules.pauseSeconds (pausa después de la explosión) debe estar entre 1 y 30 s');
  if (!(Number.isInteger(R.maxBets) && R.maxBets >= 1 && R.maxBets <= 2)) errors.push('rules.maxBets (apuestas por ronda) debe ser 1 o 2');
  const C = curveOf(R.curve);
  if (!(C.rate >= 0.02 && C.rate <= 1)) errors.push('rules.curve.rate (velocidad) debe estar entre 0.02 y 1');
  if (!(C.slowFactor > 0 && C.slowFactor <= 1)) errors.push('rules.curve.slowFactor debe estar entre 0 y 1');
  if (!(C.slowAt >= 1)) errors.push('rules.curve.slowAt debe ser >= 1');
  if (!(C.rampSeconds >= 0)) errors.push('rules.curve.rampSeconds debe ser >= 0');
  if (timeFor(R.maxMultiplier || 1000, C) > 600) errors.push('Con esa velocidad el tope tarda más de 10 minutos en llegar: sube rules.curve.rate o baja el tope');
  const L = R.limits || {};
  if (!(L.min > 0 && L.max >= L.min && L.table >= L.max)) errors.push('rules.limits: min > 0, max >= min, table >= max (centavos)');
  if (L.maxPayout != null && !(L.maxPayout >= (L.min || 1) * 1.01)) errors.push('rules.limits.maxPayout (premio máximo por apuesta) debe ser mayor que la apuesta mínima');
  if (!(R.autoMin >= 1.01 && R.autoMin <= (R.maxMultiplier || 1000))) errors.push('rules.autoMin (retiro automático mínimo) debe estar entre 1.01 y el tope');
  if (!Array.isArray(config.bet?.levels) || !config.bet.levels.length) errors.push('bet.levels: importes rápidos en centavos');
  if (!config.theme || typeof config.theme !== 'object') errors.push('Falta theme');
  return errors;
}

const A = '/game-engines/engine-crash/assets/halloween';

export function defaults() {
  return {
    engine: id,
    kind: 'crash',
    name: 'Halloween Crash',
    rules: {
      rtp: 0.97,
      maxMultiplier: 1000,
      bettingSeconds: 7,
      pauseSeconds: 4,
      maxBets: 2,
      autoMin: 1.01,
      curve: { ...CURVE_DEFAULTS },
      limits: { min: 10, max: 100000, table: 200000, maxPayout: 10000000 },
      historySize: 30,
    },
    // Importes rápidos (+1, +5, +20, +100) y apuesta inicial, en centavos
    bet: { levels: [100, 500, 2000, 10000], default: 100, currency: 'USD' },
    theme: {
      title: 'Halloween Crash',
      logo: `${A}/images/logo.png`,
      background: null, backgroundColor: '#120a24',
      palette: { primary: '#f59e0b', accent: '#f59e0b', panel: '#1d1433', text: '#ffffff', reelBg: '#2a1d4a' },
      font: 'Rubik',
      // Paquete de arte del escenario (hojas de sprites con su .json): personaje, fondo en capas, murciélagos, luna y estrellas.
      // Cada imagen se puede reemplazar desde el panel; el .json describe los cuadros de la animación.
      crash: {
        sky: ['#27194c', '#3e2968', '#563c7c', '#755799'],
        curveColor: '#ffffff',
        multColor: '#ffffff',
        crashColor: '#ef4444',
        atlases: {
          bg: `${A}/bg.json`, bgImage: `${A}/images/bg.png`,
          bats: `${A}/bgBird.json`, batsImage: `${A}/images/bgBird.png`,
          details: `${A}/bgDetails.json`, detailsImage: `${A}/images/bgDetails.png`,
          idle: `${A}/idle.json`, idleImage: `${A}/images/idle.png`,
          run: `${A}/runFly.json`, runImage: `${A}/images/runFly.png`,
          explode: `${A}/explode.json`, explodeImage: `${A}/images/explode.png`,
          fly: `${A}/explodeFly.json`, flyImage: `${A}/images/explodeFly.png`,
        },
        characterScale: 1,
      },
    },
    sounds: {
      music: `${A}/sound/bg.mp3`, start: `${A}/sound/start.mp3`, cashout: `${A}/sound/cashout.mp3`, crash: `${A}/sound/explode.mp3`,
      timer: `${A}/sound/timer.mp3`, click: `${A}/sound/click.mp3`, ambient: `${A}/sound/random.mp3`, bet: null, bigWin: null,
    },
    soundVolumes: { music: 0.4, ambient: 0.45, click: 0.6, timer: 0.65, start: 0.75, cashout: 0.85, crash: 0.85 },
  };
}
