// Motor 11 — CRAPS (juego de mesa con dados). A diferencia de los slots:
//  - la mesa tiene ESTADO entre tiradas (fase "salida" o "punto" y el número del punto);
//  - el jugador pone varias apuestas; algunas se resuelven en una tirada y otras en varias.
// Los dados los tira el servidor (RNG criptográfico y grabado); el navegador solo anima el resultado.
// Los pagos son editables y el RTP de cada apuesta se calcula EXACTO (no hace falta simular).

export const id = 'craps';
export const name = 'Craps';
export const kind = 'table';
export const description = 'Mesa de dados: Pass/Don\'t Pass, Come/Don\'t Come, odds, apuestas a números, Field y apuestas de una tirada. Pagos editables con RTP exacto por apuesta.';

const WAYS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
export const POINTS = [4, 5, 6, 8, 9, 10];
/** Odds verdaderas (pagan exactamente la probabilidad: ventaja 0 %). */
const TRUE_ODDS = { 4: [2, 1], 5: [3, 2], 6: [6, 5], 8: [6, 5], 9: [3, 2], 10: [2, 1] };

export const BET_NAMES = {
  pass: 'Pass Line', dontPass: "Don't Pass", come: 'Come', dontCome: "Don't Come", odds: 'Odds',
  place: 'Número', field: 'Field', anyCraps: 'Any Craps', any7: 'Any 7', hard: 'Hardway',
};

const ratio = (r) => (Array.isArray(r) ? r[0] / r[1] : Number(r));
const round2 = (x) => Math.round(x);

// ---------------------------------------------------------------- Reglas para poner apuestas
let seq = 0;
const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newTableState() {
  return { phase: 'comeOut', point: null, bets: [], rolls: 0, history: [] };
}

/**
 * Valida y agrega una apuesta PENDIENTE (todavía no cobrada: se cobra al tirar).
 * bet: { type, amount (centavos), number? (place / hard), on? (id de la apuesta base, para odds) }
 */
export function addBet(config, state, bet) {
  const R = config.rules;
  const t = bet.type;
  const amount = Number(bet.amount);
  const err = (m) => { throw Object.assign(new Error(m), { status: 400 }); };
  if (!R.bets[t]) err(`La apuesta ${BET_NAMES[t] || t} no está habilitada en esta mesa`);
  if (!Number.isInteger(amount) || amount <= 0) err('Importe inválido');
  const s = structuredClone(state);
  const same = (b) => b.type === t && (b.number ?? null) === (bet.number ?? null) && (b.on ?? null) === (bet.on ?? null) && !b.point;

  if (t === 'pass' || t === 'dontPass') {
    if (s.phase !== 'comeOut') err(`${BET_NAMES[t]} solo se puede apostar en la tirada de salida`);
  } else if (t === 'come' || t === 'dontCome') {
    if (s.phase !== 'point') err(`${BET_NAMES[t]} solo se puede apostar cuando hay un punto`);
  } else if (t === 'place') {
    if (!POINTS.includes(Number(bet.number))) err('Número inválido (4, 5, 6, 8, 9 o 10)');
    if (!R.pays.place[bet.number]) err(`El ${bet.number} no está habilitado`);
  } else if (t === 'hard') {
    if (![4, 6, 8, 10].includes(Number(bet.number))) err('Hardway solo en 4, 6, 8 o 10');
  } else if (t === 'odds') {
    const base = s.bets.find((b) => b.id === bet.on);
    if (!base || !['pass', 'dontPass', 'come', 'dontCome'].includes(base.type)) err('Las odds van sobre una apuesta Pass, Don\'t Pass, Come o Don\'t Come');
    const pt = base.type === 'pass' || base.type === 'dontPass' ? s.point : base.point;
    if (!pt) err('Las odds solo se pueden poner cuando esa apuesta ya tiene punto');
    const current = s.bets.filter((b) => b.type === 'odds' && b.on === base.id).reduce((a, b) => a + b.amount, 0);
    const lay = base.type === 'dontPass' || base.type === 'dontCome';
    const [n, d] = TRUE_ODDS[pt];
    // Máximo: X veces la apuesta base (en las "don't" se permite poner lo necesario para GANAR X veces)
    const max = Math.floor((R.oddsMax[pt] || 0) * base.amount * (lay ? n / d : 1));
    if (current + amount > max) err(`Máximo de odds para el ${pt}: ${max / 100}`);
    bet.number = pt;
  } else if (!['field', 'anyCraps', 'any7'].includes(t)) {
    err(`Apuesta desconocida: ${t}`);
  }
  const existing = s.bets.find((b) => b.status === 'pending' && same(b));
  const total = (existing?.amount || 0) + amount;
  if (total < R.limits.min && t !== 'odds') err(`Apuesta mínima: ${R.limits.min / 100}`);
  if (total > R.limits.max) err(`Apuesta máxima por posición: ${R.limits.max / 100}`);
  const stake = s.bets.reduce((a, b) => a + b.amount, 0) + amount;
  if (stake > R.limits.table) err(`Máximo total en la mesa: ${R.limits.table / 100}`);
  if (existing) existing.amount = total;
  else s.bets.push({ id: newId(), type: t, amount, ...(bet.number ? { number: Number(bet.number) } : {}), ...(bet.on ? { on: bet.on } : {}), status: 'pending' });
  return s;
}

/** Quita una apuesta. Pendiente: se borra (no se había cobrado). Activa: solo Números, Hardways y Odds se pueden retirar. */
export function removeBet(config, state, betId) {
  const s = structuredClone(state);
  const b = s.bets.find((x) => x.id === betId);
  if (!b) throw Object.assign(new Error('Apuesta no encontrada'), { status: 404 });
  if (b.status === 'active' && !['place', 'hard', 'odds'].includes(b.type)) {
    throw Object.assign(new Error(`${BET_NAMES[b.type]} no se puede retirar una vez en juego`), { status: 400 });
  }
  // Si se retira una apuesta base pendiente, también sus odds
  s.bets = s.bets.filter((x) => x.id !== betId && x.on !== betId);
  return { state: s, refund: b.status === 'active' ? b.amount : 0, removed: b };
}

// ---------------------------------------------------------------- Resolver una tirada
/**
 * Tira los dados con el RNG del servidor y resuelve todas las apuestas.
 * Devuelve: { dice, total, cost (lo que se cobra ahora: apuestas pendientes), payout (lo que se paga: premios + apuestas devueltas),
 *            resolutions, before, state }
 */
export function roll(config, state, rng) {
  const R = config.rules;
  const before = structuredClone(state);
  const s = structuredClone(state);
  const d1 = rng.int(6) + 1, d2 = rng.int(6) + 1;
  const total = d1 + d2;
  const hard = d1 === d2;
  let cost = 0;
  for (const b of s.bets) if (b.status === 'pending') { cost += b.amount; b.status = 'active'; }
  const resolutions = [];
  let payout = 0;
  const win = (b, r) => { const p = b.amount + round2(b.amount * r); payout += p; resolutions.push({ id: b.id, on: b.on, type: b.type, number: b.number, amount: b.amount, outcome: 'win', payout: p }); return false; };
  const winStay = (b, r) => { const p = round2(b.amount * r); payout += p; resolutions.push({ id: b.id, on: b.on, type: b.type, number: b.number, amount: b.amount, outcome: 'win', payout: p, stays: true }); return true; };
  const lose = (b) => { resolutions.push({ id: b.id, on: b.on, type: b.type, number: b.number, amount: b.amount, outcome: 'lose', payout: 0 }); return false; };
  const push = (b) => { payout += b.amount; resolutions.push({ id: b.id, on: b.on, type: b.type, number: b.number, amount: b.amount, outcome: 'push', payout: b.amount }); return false; };
  const phase = s.phase, point = s.point;
  const odds = (b, basePoint, lay) => {
    const [n, d] = TRUE_ODDS[basePoint];
    return lay ? d / n : n / d;
  };

  const keep = [];
  for (const b of s.bets) {
    let stays = true;
    switch (b.type) {
      case 'pass':
        if (phase === 'comeOut') {
          if (total === 7 || total === 11) stays = win(b, 1);
          else if ([2, 3, 12].includes(total)) stays = lose(b);
        } else if (total === point) stays = win(b, 1);
        else if (total === 7) stays = lose(b);
        break;
      case 'dontPass':
        if (phase === 'comeOut') {
          if (total === R.dontBar) { resolutions.push({ id: b.id, type: b.type, amount: b.amount, outcome: 'bar' }); }
          else if (total === 2 || total === 3 || total === 12) stays = win(b, 1);
          else if (total === 7 || total === 11) stays = lose(b);
        } else if (total === 7) stays = win(b, 1);
        else if (total === point) stays = lose(b);
        break;
      case 'come':
        if (!b.point) {
          if (total === 7 || total === 11) stays = win(b, 1);
          else if ([2, 3, 12].includes(total)) stays = lose(b);
          else { b.point = total; resolutions.push({ id: b.id, type: b.type, amount: b.amount, outcome: 'move', number: total }); }
        } else if (total === b.point) stays = win(b, 1);
        else if (total === 7) stays = lose(b);
        break;
      case 'dontCome':
        if (!b.point) {
          if (total === R.dontBar) resolutions.push({ id: b.id, type: b.type, amount: b.amount, outcome: 'bar' });
          else if (total === 2 || total === 3 || total === 12) stays = win(b, 1);
          else if (total === 7 || total === 11) stays = lose(b);
          else { b.point = total; resolutions.push({ id: b.id, type: b.type, amount: b.amount, outcome: 'move', number: total }); }
        } else if (total === 7) stays = win(b, 1);
        else if (total === b.point) stays = lose(b);
        break;
      case 'odds': {
        const base = state.bets.find((x) => x.id === b.on);
        const lay = base && (base.type === 'dontPass' || base.type === 'dontCome');
        const pt = b.number;
        if (total === pt) stays = lay ? lose(b) : win(b, odds(b, pt, false));
        else if (total === 7) {
          // Odds de Come en la salida: "apagadas" (se devuelven si sale 7) — regla estándar
          if (!lay && base?.type === 'come' && phase === 'comeOut') stays = push(b);
          else stays = lay ? win(b, odds(b, pt, true)) : lose(b);
        }
        break;
      }
      case 'place':
        if (phase === 'comeOut') break; // apagadas en la salida
        if (total === b.number) stays = winStay(b, ratio(R.pays.place[b.number]));
        else if (total === 7) stays = lose(b);
        break;
      case 'hard':
        if (total === b.number && hard) stays = winStay(b, ratio(R.pays.hard[b.number]));
        else if (total === 7 || total === b.number) stays = lose(b);
        break;
      case 'field':
        if (total === 2) win(b, ratio(R.pays.field[2]));
        else if (total === 12) win(b, ratio(R.pays.field[12]));
        else if ([3, 4, 9, 10, 11].includes(total)) win(b, 1);
        else lose(b);
        stays = false;
        break;
      case 'anyCraps':
        if ([2, 3, 12].includes(total)) win(b, ratio(R.pays.anyCraps)); else lose(b);
        stays = false;
        break;
      case 'any7':
        if (total === 7) win(b, ratio(R.pays.any7)); else lose(b);
        stays = false;
        break;
      default: break;
    }
    if (stays) keep.push(b);
  }
  // Odds huérfanas (su apuesta base se resolvió) se devuelven si no se resolvieron
  const alive = new Set(keep.map((b) => b.id));
  s.bets = keep.filter((b) => {
    if (b.type !== 'odds' || alive.has(b.on)) return true;
    push(b);
    return false;
  });

  // Cambio de fase
  if (phase === 'comeOut') {
    if (POINTS.includes(total)) { s.phase = 'point'; s.point = total; }
  } else if (total === point || total === 7) {
    s.phase = 'comeOut'; s.point = null;
  }
  s.rolls = (s.rolls || 0) + 1;
  s.history = [...(s.history || []), total].slice(-20);
  return { dice: [d1, d2], total, hard, cost, payout, resolutions, before, state: s, phaseBefore: phase, pointBefore: point };
}

// ---------------------------------------------------------------- RTP exacto por apuesta
/** Probabilidad de que salga `n` antes que 7. */
const beforeSeven = (n) => WAYS[n] / (WAYS[n] + 6);

export function analyze(config) {
  const R = config.rules;
  const P = (t) => WAYS[t] / 36;
  const out = {};
  // Pass / Come: gana 7-11 en la salida o el punto antes del 7. Paga 1 a 1.
  const passWin = P(7) + P(11) + POINTS.reduce((a, p) => a + P(p) * beforeSeven(p), 0);
  out.pass = 2 * passWin;
  out.come = out.pass;
  // Don't: gana 2-3-12 (menos el número "bar", que empata) o el 7 antes del punto.
  const dpWinOut = [2, 3, 12].filter((t) => t !== R.dontBar).reduce((a, t) => a + P(t), 0);
  const dpWin = dpWinOut + POINTS.reduce((a, p) => a + P(p) * (1 - beforeSeven(p)), 0);
  out.dontPass = 2 * dpWin + P(R.dontBar);
  out.dontCome = out.dontPass;
  out.odds = 1; // se pagan las probabilidades verdaderas
  out.place = Object.fromEntries(Object.entries(R.pays.place).map(([n, r]) => [n, beforeSeven(Number(n)) * (1 + ratio(r))]));
  // Hardway n: gana si sale n "doble" antes que 7 o n "fácil".
  out.hard = Object.fromEntries(Object.entries(R.pays.hard || {}).map(([n, r]) => [n, (1 / (6 + WAYS[n])) * (1 + ratio(r))]));
  out.field = P(2) * (1 + ratio(R.pays.field[2])) + P(12) * (1 + ratio(R.pays.field[12])) + [3, 4, 9, 10, 11].reduce((a, t) => a + P(t) * 2, 0);
  out.anyCraps = (P(2) + P(3) + P(12)) * (1 + ratio(R.pays.anyCraps));
  out.any7 = P(7) * (1 + ratio(R.pays.any7));
  const r4 = (x) => Math.round(x * 10000) / 10000;
  const flat = {};
  for (const [k, v] of Object.entries(out)) flat[k] = typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, r4(b)])) : r4(v);
  return { perBet: flat, rtp: flat.pass, volatility: 'baja', hitFrequency: r4(passWin) };
}

/** Lista plana de RTP de las apuestas HABILITADAS (para validar y mostrar). */
export function enabledRtps(config) {
  const a = analyze(config).perBet;
  const R = config.rules;
  const list = [];
  for (const [t, on] of Object.entries(R.bets)) {
    if (!on) continue;
    if (t === 'place') for (const [n, v] of Object.entries(a.place)) list.push({ bet: `${BET_NAMES.place} ${n}`, rtp: v });
    else if (t === 'hard') for (const [n, v] of Object.entries(a.hard)) list.push({ bet: `${BET_NAMES.hard} ${n}`, rtp: v });
    else list.push({ bet: BET_NAMES[t], rtp: a[t] });
  }
  return list;
}

export function validate(config) {
  const L = config.rules?.live;
  const liveErrors = [];
  if (L?.enabled) {
    if (!(L.bettingSeconds >= 5 && L.bettingSeconds <= 120)) liveErrors.push('rules.live.bettingSeconds (tiempo para apostar) debe estar entre 5 y 120');
    if (!(L.rollSeconds >= 2 && L.rollSeconds <= 60)) liveErrors.push('rules.live.rollSeconds (duración de la tirada del crupier) debe estar entre 2 y 60');
    if (!(L.resultSeconds >= 1 && L.resultSeconds <= 60)) liveErrors.push('rules.live.resultSeconds debe estar entre 1 y 60');
    if (!(L.closeSeconds >= 0 && L.closeSeconds <= 10)) liveErrors.push('rules.live.closeSeconds debe estar entre 0 y 10');
  }
  return [...liveErrors, ...validateBase(config)];
}

function validateBase(config) {
  const errors = [];
  const R = config.rules || {};
  if (!R.bets || typeof R.bets !== 'object') errors.push('Falta rules.bets (qué apuestas están habilitadas)');
  if (!R.pays?.place || !R.pays?.field) errors.push('Faltan rules.pays.place o rules.pays.field');
  if (![2, 12].includes(R.dontBar)) errors.push('rules.dontBar debe ser 2 o 12');
  for (const p of POINTS) if (!(R.oddsMax?.[p] >= 0 && R.oddsMax[p] <= 100)) errors.push(`rules.oddsMax.${p} debe estar entre 0 y 100`);
  const L = R.limits || {};
  if (!(L.min > 0 && L.max >= L.min && L.table >= L.max)) errors.push('rules.limits: min > 0, max >= min, table >= max (centavos)');
  if (!Array.isArray(config.bet?.levels) || !config.bet.levels.length) errors.push('bet.levels: valores de las fichas en centavos');
  if (!errors.length) {
    for (const { bet, rtp } of enabledRtps(config)) {
      if (!(rtp >= 0.85 && rtp <= 1.10)) errors.push(`${bet}: RTP ${(rtp * 100).toFixed(2)} % fuera del rango 85 %–110 %. Ajusta su pago o desactívala.`);
    }
  }
  return errors;
}

export function defaults() {
  return {
    engine: id,
    kind: 'table',
    name: 'Dados de Oro',
    rules: {
      bets: { pass: true, dontPass: true, come: true, dontCome: true, odds: true, place: true, field: true, hard: true, anyCraps: true, any7: false },
      dontBar: 12,
      oddsMax: { 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3 },
      pays: {
        place: { 4: [9, 5], 5: [7, 5], 6: [7, 6], 8: [7, 6], 9: [7, 5], 10: [9, 5] },
        field: { 2: 2, 12: 2 }, // diseño original: 2 y 12 pagan 2 a 1
        hard: { 4: 7, 6: 9, 8: 9, 10: 7 },
        anyCraps: 7,
        any7: 4,
      },
      limits: { min: 100, max: 50000, table: 200000 },
      maxWin: 1000000,
    },
    bet: { levels: [100, 500, 1000, 2500, 10000], default: 500, currency: 'USD' },
    theme: {
      title: 'Dados de Oro', background: null, backgroundColor: '#0b2a1a', tableImage: null,
      palette: { primary: '#c0392b', accent: '#f1c40f', panel: '#071a10', text: '#ffffff', reelBg: '#0f5132' },
      font: 'Bungee',
      // Dados editables: colores, redondeo (% del lado), tamaño y una imagen opcional por cara
      dice: { face: '#fbfbfb', pip: '#c0392b', edge: '#cccccc', radius: 18, scale: 1, faces: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null } },
    },
    sounds: { music: null, roll: null, dice: null, chip: null, win: null, bigWin: null, lose: null, click: null },
  };
}

/** Juego de ejemplo de la MESA EN VIVO: tira el crupier para todos con cuenta regresiva para apostar. */
export function liveDefaults() {
  const d = defaults();
  return {
    ...d,
    id: 'craps-live',
    name: 'Dados en Vivo',
    rules: { ...d.rules, live: { enabled: true, bettingSeconds: 20, closeSeconds: 2, rollSeconds: 9, resultSeconds: 5, historySize: 20 } },
    theme: {
      ...d.theme, title: 'Dados en Vivo', backgroundColor: '#1a0d06',
      palette: { primary: '#b8860b', accent: '#ffd700', panel: '#140a04', text: '#ffffff', reelBg: '#14532d' },
      // Crupier grabado: un video por combinación ("3-4") o por total ("7"); sin videos se ven los dados 3D
      croupier: { enabled: true, name: 'Crupier', clips: {}, totals: {}, idle: null, intro: null },
    },
  };
}
