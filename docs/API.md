# API de Casino Platform

Base: `https://TU-DOMINIO`. Todas las cantidades de dinero van en **centavos (enteros)**. Todas las respuestas son JSON; los errores tienen la forma `{ "error": "mensaje", "details": [...] }`.

Hay tres niveles de acceso:

| Quién | Autenticación | Prefijo |
| --- | --- | --- |
| Jugador (navegador) | `Authorization: Bearer <token de sesión>` | `/api/v1/…` |
| Operador (tu cliente B2B) | `X-API-Key: <api key>` | `/api/v1/operator/…` |
| Administrador (panel) | `Authorization: Bearer <ADMIN_TOKEN>` | `/api/admin/…` |

---

## 1. Integración de un operador (paso a paso)

1. En el panel → **Operadores**, crea el operador. Elige billetera:
   - **internal**: el saldo del jugador vive en esta plataforma; lo cargas con `POST /api/v1/operator/players/:id/balance`.
   - **seamless**: el saldo vive en tu sistema; la plataforma llama a tu `walletUrl` en cada ronda (ver §3).
2. Guarda la **API key** (y el **secreto de firma** si es seamless): solo se muestran una vez.
3. Cuando un jugador abre un juego, desde **tu servidor**:

```http
POST /api/v1/operator/sessions
X-API-Key: ck_live_…
Content-Type: application/json

{ "playerId": "u-123", "gameId": "megaways", "currency": "USD", "mode": "real", "lobbyUrl": "https://tu-casino.com/lobby" }
```

Respuesta `201`:

```json
{ "token": "ses_…", "playerId": "pl_…", "mode": "real", "currency": "USD",
  "launchUrl": "https://TU-DOMINIO/play/megaways?token=ses_…&lobby=…" }
```

4. Abre `launchUrl` en un iframe o en una pestaña. Con `client-sdk/casino-sdk.js` (`embedGame`) recibes un evento `casino:round` tras cada ronda.

### Endpoints del operador

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/v1/operator/games` | Juegos publicados con versión, RTP y volatilidad |
| POST | `/api/v1/operator/sessions` | Crea sesión de jugador → `token`, `launchUrl` |
| POST | `/api/v1/operator/players/:playerId/balance` | Solo billetera interna. `{ "amount": 5000, "reference": "dep-1" }` (negativo = retiro). `reference` repetida → `409` |
| GET | `/api/v1/operator/rounds?since=ISO&limit=100` | Rondas de tus jugadores para conciliación |

---

## 2. API del juego (la usa el cliente del juego)

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/v1/games` | Lista pública de juegos |
| GET | `/api/v1/games/:id` | Configuración pública (símbolos, tema, sonidos, apuestas, reglas visibles). **No incluye las tiras de rodillos.** |
| POST | `/api/v1/demo/sessions` | `{ "gameId": "reel-rush" }` → sesión demo con créditos ficticios (límite por IP) |
| GET | `/api/v1/session` | Juego, modo y configuración de la sesión |
| GET | `/api/v1/balance` | Saldo actual |
| POST | `/api/v1/spin` | `{ "bet": 100, "mode": "base" \| "buy", "clientRoundId": "único-por-ronda" }` |
| GET | `/api/v1/history?limit=20` | Últimas rondas del jugador |

Respuesta de `/spin`:

```json
{
  "roundId": "rd_…", "status": "completed", "bet": 100, "cost": 100, "win": 250, "balance": 100150,
  "playMode": "base", "version": 3,
  "result": { "engine": "reel-rush", "steps": [ … ], "totalWin": 2.5 }
}
```

- `result.totalWin` está en **múltiplos de la apuesta**; `win` ya está en centavos.
- `clientRoundId` hace la llamada **idempotente**: si se corta la conexión y el cliente reintenta con el mismo id, se devuelve la misma ronda (`"replayed": true`) sin cobrar dos veces.
- `mode: "buy"` solo existe en motores con compra de bonus (`bonus-buy`); el coste es `bet × rules.buyCost`.
- Errores: `400` apuesta o modo inválido, `401` sesión inválida/expirada, `402` saldo insuficiente, `429` demasiadas peticiones, `502` billetera del operador no disponible.

### Formato de `result` por motor

| Motor | Campos |
| --- | --- |
| `reel-rush` | `steps[]`: `{ grid, wins[], multiplier, win, removed[] }` (una entrada por cascada) |
| `megaways` | `base: { heights, grid, ways, wins, scatters, win }`, `freeSpins: { awarded, spins[], totalWin }` |
| `bonus-buy` | `base` (null si fue compra), `freeSpins: { awarded, multiplier, spins[], totalWin }` |
| `hold-win` | `grid, wins, coins[{c,r,value,jackpot?}]`, `holdAndWin: { coins, respins[{landed, respinsLeft}], full, win }` |
| `colossal-reels` | `base: { grid, colossal: {symbol,size,col,row}, wins, scatters }`, `freeSpins` |

`grid` es `grid[columna][fila]` con ids de símbolo. `wins[].positions` es una lista de `[columna, fila]`.

---

## 3. Protocolo de billetera seamless

La plataforma hace `POST` a tu `walletUrl` con JSON y la cabecera `X-Signature` = HMAC-SHA256 (hex) del **cuerpo exacto** con tu secreto de firma. Verifícala siempre (`verifyWalletSignature` en el SDK).

```json
{ "action": "debit", "playerId": "u-123", "currency": "USD", "amount": 100,
  "roundId": "rd_…", "txId": "rd_…:bet", "timestamp": 1760000000000 }
```

| action | Qué debes hacer | Responder |
| --- | --- | --- |
| `balance` | Nada | `200 { "balance": 12345 }` |
| `debit` | Restar `amount`. Si no alcanza: `402` o `{ "error": "INSUFFICIENT_FUNDS" }` | `200 { "balance": … }` |
| `credit` | Sumar `amount` (puede ser 0: cierra la ronda) | `200 { "balance": … }` |
| `rollback` | Revertir el débito `txId` | `200 { "balance": … }` |

**Idempotencia obligatoria:** usa `txId` como clave única. La plataforma reintenta los créditos fallidos cada minuto hasta confirmarlos (la ronda queda en `pending_credit`), así que el mismo `txId` puede llegar varias veces y solo debe aplicarse una.

Tiempo máximo de respuesta: 8 s.

---

## 4. API de administración (resumen)

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/admin/games` · `/api/admin/games/:id` | Juegos, borrador y versión publicada |
| POST | `/api/admin/games` | `{ name, engine, fromGameId? }` crea juego nuevo (borrador) |
| PUT / PATCH | `/api/admin/games/:id/draft` | Reemplaza el borrador / aplica `ops: [{ op: set\|merge\|delete\|append, path, value }]` |
| POST | `/api/admin/games/:id/publish` | Valida, simula RTP (si cambió la matemática) y crea versión inmutable |
| GET / POST | `/api/admin/games/:id/versions` · `/restore/:version` | Historial y restaurar |
| POST | `/api/admin/games/:id/simulate` · `/tune` | Simulación Monte Carlo · ajuste automático del RTP |
| GET | `/api/admin/games/:id/grid?reels=&rows=` | Tamaño actual, tipo de pago (líneas/formas) y máximo de líneas posible |
| POST | `/api/admin/games/:id/resize` | `{ reels?, rows?, lines? }` cambia rodillos (3–8), filas (3–6) y líneas; reconstruye rodillos y pagos y reajusta el RTP |
| POST | `/api/admin/games/:id/preview-session` | Sesión demo que juega el **borrador** |
| GET / POST | `/api/admin/assets` | Listar / subir imagen o sonido (cuerpo binario, `?gameId=&kind=`) |
| POST | `/api/admin/agents/runs` | `{ gameId, prompt, agent?: director\|designer\|artist\|sound\|math, runId? }` |
| GET | `/api/admin/agents/runs/:id/events` | Progreso en vivo (Server-Sent Events) |
| GET | `/api/admin/rounds` · `/rounds/:id/replay` | Rondas y verificación reproducible |
| GET | `/api/admin/stats` · `/api/admin/audit` | RTP real por juego · registro de auditoría |
| GET / POST | `/api/admin/operators` | Operadores y API keys |

Rutas de configuración usadas por `ops`: `theme.palette.primary`, `symbols.<id>.image`, `symbols.<id>.pays`, `sounds.win`, `rules.freeSpins.3`… (en listas de símbolos se usa el `id`).
