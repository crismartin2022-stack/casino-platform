// Casino Platform SDK — para operadores que integran los juegos.
//
// NAVEGADOR: incrusta un juego en un iframe y escucha sus eventos.
//   <script type="module">
//     import { embedGame } from 'https://TU-DOMINIO/client-sdk/casino-sdk.js';
//     const game = embedGame(document.getElementById('slot'), launchUrl, {
//       onRound: (r) => console.log('ronda', r.roundId, 'premio', r.win, 'saldo', r.balance),
//     });
//   </script>
//
// SERVIDOR (Node 18+): abre sesiones y verifica la firma de las llamadas a tu billetera.
//   import { CasinoClient, verifyWalletSignature } from './casino-sdk.js';
//   const casino = new CasinoClient({ baseUrl: 'https://TU-DOMINIO', apiKey: process.env.CASINO_API_KEY });
//   const { launchUrl } = await casino.createSession({ playerId: 'u-123', gameId: 'megaways' });

export function embedGame(container, launchUrl, { onRound, width = '100%', height = '100%' } = {}) {
  const iframe = document.createElement('iframe');
  iframe.src = launchUrl;
  iframe.allow = 'autoplay; fullscreen';
  iframe.style.cssText = `border:0;width:${width};height:${height};display:block;background:#000`;
  container.appendChild(iframe);
  const origin = new URL(launchUrl, location.href).origin;
  const listener = (e) => {
    if (e.origin !== origin || e.source !== iframe.contentWindow) return;
    if (e.data?.type === 'casino:round') onRound?.(e.data);
  };
  window.addEventListener('message', listener);
  return {
    iframe,
    destroy() { window.removeEventListener('message', listener); iframe.remove(); },
  };
}

export class CasinoClient {
  constructor({ baseUrl, apiKey }) {
    if (!baseUrl || !apiKey) throw new Error('baseUrl y apiKey son obligatorios');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async request(path, { method = 'GET', body } = {}) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { 'x-api-key': this.apiKey, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, details: data.details });
    return data;
  }

  /** Lista de juegos publicados con su RTP y volatilidad. */
  games() { return this.request('/api/v1/operator/games'); }

  /** Crea una sesión de jugador y devuelve { token, launchUrl }. mode: 'real' | 'demo'. */
  createSession({ playerId, gameId, currency, mode = 'real', lobbyUrl }) {
    return this.request('/api/v1/operator/sessions', { method: 'POST', body: { playerId, gameId, currency, mode, lobbyUrl } });
  }

  /** Solo billetera interna: suma (depósito) o resta (retiro) saldo en centavos. `reference` evita duplicados. */
  adjustBalance(playerId, amount, reference) {
    return this.request(`/api/v1/operator/players/${encodeURIComponent(playerId)}/balance`, { method: 'POST', body: { amount, reference } });
  }

  /** Rondas de tus jugadores (conciliación). since: fecha ISO opcional. */
  rounds({ since, limit = 100 } = {}) {
    const q = new URLSearchParams({ limit: String(limit), ...(since ? { since } : {}) });
    return this.request(`/api/v1/operator/rounds?${q}`);
  }
}

/**
 * Verifica que una petición a TU billetera viene de la plataforma.
 * rawBody: el cuerpo exacto recibido (string); signature: cabecera x-signature.
 */
export async function verifyWalletSignature(secret, rawBody, signature) {
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const got = Buffer.from(String(signature || ''));
  return expected.length === got.length && timingSafeEqual(expected, got);
}
