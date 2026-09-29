// Límites de apuesta por operador (los fija el proveedor en Operadores → Gestionar).
import { one } from '../db.js';
export { applyCurrency, niceRound, CURRENCIES, validateBets } from '../math/currency.js';

/** Límites de apuesta que el proveedor le fijó a un operador para una moneda: { min, max } en centavos o null. */
export function operatorLimits(operatorId, currency) {
  if (!operatorId) return null;
  const row = one('SELECT bet_limits FROM operators WHERE id = ?', operatorId);
  const all = row?.bet_limits ? JSON.parse(row.bet_limits) : {};
  return all[String(currency || '').toUpperCase()] || null;
}
