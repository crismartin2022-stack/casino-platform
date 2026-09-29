// Apuestas por moneda (módulo puro, sin base de datos: lo usan también los hilos del simulador): cada juego define sus fichas en la moneda base (bet.levels) y, opcionalmente,
// fichas propias para otras monedas (bet.byCurrency). Cada operador puede acotar mínimo y máximo por moneda.
// El RTP no cambia con la moneda (todo se calcula en múltiplos de la apuesta); solo cambian los importes.
import { HttpError } from '../lib/http.js';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'ARS', 'BRL', 'MXN', 'CLP', 'COP', 'PEN', 'UYU', 'PYG', 'BOB', 'VES', 'DOP', 'CRC', 'GTQ', 'TRY', 'INR', 'JPY', 'CNY', 'KRW', 'PHP', 'ZAR', 'NGN', 'KES', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'USDT'];

const isLevels = (l) => Array.isArray(l) && l.length > 0 && l.every((x, i) => Number.isInteger(x) && x > 0 && (i === 0 || x > l[i - 1]));

/** Errores de configuración de apuestas (se suman a validateConfig). */
export function validateBets(config) {
  const errs = [];
  const b = config.bet;
  if (!b) return [];
  for (const [cur, x] of Object.entries(b.byCurrency || {})) {
    if (!/^[A-Z]{3,4}$/.test(cur)) { errs.push(`bet.byCurrency: código de moneda inválido "${cur}"`); continue; }
    if (!isLevels(x?.levels)) errs.push(`bet.byCurrency.${cur}.levels: lista de enteros positivos en centavos, de menor a mayor`);
    else if (x.default != null && !x.levels.includes(x.default)) errs.push(`bet.byCurrency.${cur}.default debe ser una de sus fichas`);
    const L = x?.limits;
    if (L && !(L.min > 0 && L.max >= L.min && L.table >= L.max)) errs.push(`bet.byCurrency.${cur}.limits: min > 0, max >= min, table >= max`);
  }
  return errs;
}

/**
 * Configuración con las apuestas de la moneda de la sesión y los límites del operador aplicados.
 * No toca la matemática: solo bet (fichas) y, en juegos de mesa, rules.limits.
 */
export function applyCurrency(config, currency, opLimits = null) {
  const base = config.bet || { levels: [100] };
  const cur = String(currency || base.currency || 'USD').toUpperCase();
  const bc = base.byCurrency?.[cur];
  let levels = bc?.levels?.length ? [...bc.levels] : [...base.levels];
  let def = bc ? (bc.default ?? levels[0]) : base.default;
  let limits = config.rules?.limits ? { ...config.rules.limits } : null;
  if (limits && bc) {
    if (bc.limits) limits = { ...bc.limits };
    else {
      // Sin límites propios: se escalan con la misma proporción que las fichas.
      const k = levels[0] / base.levels[0];
      limits = { min: Math.max(1, Math.round(limits.min * k)), max: Math.round(limits.max * k), table: Math.round(limits.table * k) };
    }
  }
  if (opLimits) {
    const min = Number(opLimits.min) || 0, max = Number(opLimits.max) || Infinity;
    levels = levels.filter((x) => x >= min && x <= max);
    if (limits) {
      limits.min = Math.max(limits.min, min || 0);
      limits.max = Math.min(limits.max, max);
      limits.table = Math.max(limits.max, Math.min(limits.table, max === Infinity ? limits.table : limits.table));
      if (limits.max < limits.min) throw new HttpError(409, `Los límites de apuesta del operador para ${cur} no dejan ninguna apuesta posible en este juego`);
    }
    if (!levels.length && !limits) throw new HttpError(409, `No hay apuestas disponibles en ${cur} dentro de los límites del operador para este juego`);
    if (!levels.length) levels = [limits.min];
  }
  if (!levels.includes(def)) def = levels.reduce((a, x) => (Math.abs(x - (def ?? x)) < Math.abs(a - (def ?? a)) ? x : a), levels[0]);
  return {
    ...config,
    bet: { ...base, currency: cur, levels, default: def, byCurrency: undefined },
    ...(limits ? { rules: { ...config.rules, limits } } : {}),
  };
}

/** Redondea a una cifra "linda" (1, 2, 2,5, 5 × 10^n) para sugerir fichas en otra moneda. */
export function niceRound(x) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  const n = m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10;
  return Math.max(1, Math.round(n * p));
}
