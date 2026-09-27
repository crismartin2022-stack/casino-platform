// Cliente de la API de juego. El navegador NUNCA decide resultados: solo pide y anima.
export class GameApi {
  constructor({ token, baseUrl = '' }) {
    this.token = token;
    this.baseUrl = baseUrl;
    this.seq = 0;
  }

  async request(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  session() { return this.request('/api/v1/session'); }
  balance() { return this.request('/api/v1/balance'); }
  history(limit = 20) { return this.request(`/api/v1/history?limit=${limit}`); }

  /** clientRoundId hace la petición idempotente: si se corta la conexión, reintentar no cobra dos veces. */
  async spin(bet, mode = 'base') {
    const clientRoundId = `${Date.now().toString(36)}-${(this.seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const body = { bet, mode, clientRoundId };
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request('/api/v1/spin', { method: 'POST', body });
      } catch (e) {
        if (e.status || attempt >= 2) throw e; // errores del servidor no se reintentan; los de red sí
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }

  static async demo(gameId, baseUrl = '') {
    const res = await fetch(`${baseUrl}/api/v1/demo/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo crear la sesión demo');
    return new GameApi({ token: data.token, baseUrl });
  }
}

export function formatMoney(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat(navigator.language || 'es-AR', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
