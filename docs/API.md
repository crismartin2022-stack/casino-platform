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

### Juegos de mesa: Craps (`engine: "craps"`)

Craps no usa `/spin`. Las apuestas quedan sobre la mesa entre tiradas y el estado se guarda en el servidor por sesión. Cada tirada es **una ronda auditable**: `cost` = fichas nuevas que se cobran en esa tirada y `win` = todo lo que vuelve al jugador (premio + apuesta devuelta).

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/v1/table` | Estado de la mesa: `{ phase: "comeOut"\|"point", point, bets[], pending, balance }` |
| POST | `/api/v1/table/bets` | `{ "type": "pass"\|"dontPass"\|"come"\|"dontCome"\|"odds"\|"place"\|"field"\|"hard"\|"anyCraps"\|"any7", "number"?: 4-10, "on"?: "id de apuesta (odds)", "amount": 500 }` |
| DELETE | `/api/v1/table/bets/:id` | Retira una apuesta. Si aún no se cobró, se anula. Si ya estaba activa y se puede retirar (números, odds, hardways), se devuelve y queda registrada como ronda `takedown`. Pass/Come con punto no se pueden retirar. |
| POST | `/api/v1/table/roll` | `{ "clientRoundId": "único" }`: tira los dados con el RNG del servidor |

Respuesta de `/table/roll`:

```json
{
  "roundId": "rd_…", "cost": 1000, "win": 2000, "balance": 101000,
  "result": { "dice": [3, 4], "total": 7, "hard": false,
    "resolutions": [ { "id": "b_…", "type": "pass", "amount": 1000, "outcome": "win", "payout": 2000 } ],
    "phaseBefore": "comeOut", "pointBefore": null },
  "table": { "phase": "comeOut", "point": null, "bets": [] }
}
```

- Las reglas (pagos de números, field, hardways, any craps/any 7, empate del Don't Pass con 12 o 2, odds máximas, límites) están en `rules` del juego y se editan en el panel. El RTP de cada apuesta se calcula **exacto** y cada apuesta habilitada debe quedar entre 85 % y 110 %.
- Replay: `GET /api/admin/rounds/:id/replay` reproduce la tirada con los dados grabados y el estado previo de la mesa.

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
| POST | `/api/admin/games/:id/preview-session` | Sesión demo que juega el **borrador**. En esa sesión, `POST /api/v1/spin { "force": true }` fuerza un bonus (solo borradores: en cualquier otra sesión responde `403`) |
| POST | `/api/admin/games/:id/feature-frequency` | `{ every }` recalibra el bonus para que salga cada ~N giros y reajusta el RTP del borrador |
| GET / POST | `/api/admin/assets` | Listar / subir imagen o sonido (cuerpo binario, `?gameId=&kind=`) |
| POST | `/api/admin/agents/runs` | `{ gameId, prompt, agent?: director\|designer\|artist\|sound\|math, runId? }` |
| GET | `/api/admin/agents/runs/:id/events` | Progreso en vivo (Server-Sent Events) |
| GET | `/api/admin/rounds` · `/rounds/:id/replay` | Rondas y verificación reproducible |
| GET | `/api/admin/stats` · `/api/admin/audit` | RTP real por juego · registro de auditoría |
| GET / POST | `/api/admin/operators` | Operadores y API keys |
| GET / PATCH | `/api/admin/operators/:id` | Detalle (juegos, RTP, usuarios) · `{ active?, canCreateGames?, maxGames?, canUseAgents? }` |
| PUT | `/api/admin/operators/:id/games/:gameId` | `{ enabled?, rtpTarget? }` habilita el juego para ese operador y le asigna un RTP (`null` = el del juego) |
| POST / PATCH | `/api/admin/operators/:id/users` · `/users/:uid` | Crea usuario del portal (`{ email, name, role: admin\|finance\|support }` → contraseña temporal) · cambia rol o lo desactiva |
| POST | `/api/admin/operators/:id/users/:uid/reset-password` | Nueva contraseña temporal |
| GET / POST | `/api/admin/games/:id/rtp-variants` | Variantes de RTP de un juego · `{ target }` calcula una nueva |

### Marcas y prueba silenciosa

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/admin/brands` | Marcas (con cantidad de juegos) |
| POST | `/api/admin/brands` | Crear `{ name, logo, tagline, color, bg, bgImage, loader: bar\|ring\|pulse, minMs }` |
| PATCH / DELETE | `/api/admin/brands/:id` | Editar / borrar (409 si tiene juegos) |
| PUT | `/api/admin/games/:id/brand` | Asignar marca `{ brandId }` (null = sin marca) |
| POST | `/api/admin/games/:id/check` | Prueba silenciosa del borrador → `{ status: ok\|warn\|fail, passed, summary, counts, checks[], fixes[] }` |
| GET | `/api/admin/games/:id/checks` | Últimas pruebas (incluye las de cada publicación, con su versión) |

`POST /publish` ejecuta la prueba: si `status = fail` responde **422** con `details.check` y no publica; si pasa, la respuesta incluye `check`.
`GET /api/v1/session` y `GET /api/v1/games` incluyen `brand: { name, logo, tagline, color, bg, bgImage, loader, minMs }` para la pantalla de carga.

### Monedas y límites de apuesta

Todas las cantidades van en centavos de la moneda de la sesión (la del jugador, o la del operador si no se indica). El RTP no depende de la moneda: los premios son múltiplos de la apuesta.

- Cada juego tiene fichas base en `bet.levels` y, opcionalmente, fichas por moneda en `bet.byCurrency`, por ejemplo `{ "ARS": { "levels": [20000, 50000, 100000], "default": 50000 } }`. En Craps también puede traer `limits: { min, max, table }`; si no, se escalan con la misma proporción que las fichas. Si una moneda no está definida, se usan las fichas base (mismos números).
- El proveedor puede acotar a cada operador con `PATCH /api/admin/operators/:id { "betLimits": { "ARS": { "min": 50000, "max": 1000000 } } }`: el jugador solo ve (y el servidor solo acepta) las fichas dentro de ese rango.
- `GET /api/v1/session` devuelve ya las fichas efectivas en `game.bet.levels`; `POST /api/v1/spin` con una ficha que no esté en esa lista responde `400`.

### RTP por operador

El proveedor asigna a cada operador el RTP de cada juego (85 %–110 %). La plataforma ajusta la tabla de pagos de la versión publicada a ese RTP (misma matemática, pagos escalados, compras de bonus re-preciadas) y guarda el resultado como **variante**. Cada sesión nueva de ese operador juega con su variante; cada ronda registra `version` y `variant_id`, así que el replay reproduce exactamente lo jugado.

- Mientras la variante se calcula, `POST /api/v1/operator/sessions` responde `409` para ese juego: nunca se juega con un RTP distinto al asignado.
- Si se publica una versión con matemática nueva, las variantes asignadas se recalculan solas.
- En juegos de mesa (Craps) el RTP depende de los pagos de cada apuesta: no hay variantes.

---

## 5. Portal del operador (`/operator`)

Cada casino entra con email y contraseña (los crea el proveedor o su propio administrador). Ve solo lo suyo.

| Rol | Puede |
| --- | --- |
| `admin` | Todo: reportes, jugadas, jugadores, saldo, juegos propios, API key, billetera y usuarios |
| `finance` | Reportes, jugadas, jugadores y cargar/retirar saldo (billetera interna) |
| `support` | Consultar reportes, jugadas y jugadores |

Autenticación: `POST /api/portal/login { email, password }` → `{ token }` y luego `Authorization: Bearer ous_…`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/portal/summary?from=AAAA-MM-DD&to=` | Apostado, pagado, GGR, RTP real, rondas y jugadores; por día y por juego |
| GET | `/api/portal/rounds?player=&game=&status=&mode=&from=&to=&limit=&offset=` · `/rounds/:id` · `/rounds/:id/verify` | Jugadas, detalle y verificación |
| GET | `/api/portal/players?q=` · `/players/:id` | Jugadores con totales · detalle y movimientos |
| POST | `/api/portal/players/:id/balance` | `{ amount, reference }` carga/retiro (billetera interna; roles admin y finance) |
| GET / POST | `/api/portal/games` | Catálogo con su RTP + juegos propios y límite · crear juego propio `{ name, baseGameId }` |
| POST | `/api/portal/demo-session` | `{ gameId }` → `launchUrl` en modo demo para probar |
| GET / PUT | `/api/portal/integration` | Datos de integración · `{ walletUrl }` |
| POST | `/api/portal/integration/rotate-key` · `/rotate-secret` · `/test-wallet` | Nueva API key · nuevo secreto de firma · prueba de la billetera seamless (`{ playerId }`) |
| GET / POST / PATCH | `/api/portal/users` · `/users/:uid` | Usuarios de su casino |
| GET | `/api/portal/export/rounds.csv` · `summary.csv` · `games.csv` · `players.csv` | Reportes CSV (mismos filtros) |

**Juegos propios:** si el proveedor lo habilita (con un máximo), el operador crea juegos a partir de uno de su catálogo. Heredan la matemática y el RTP que tiene asignado; puede cambiar nombre, diseño, imágenes, sonidos y dados, y usar los agentes de diseño si el proveedor se los activó. La matemática, el RTP y las apuestas quedan bloqueados (`403`). Solo su operador puede abrirlos.

Rutas de configuración usadas por `ops`: `theme.palette.primary`, `symbols.<id>.image`, `symbols.<id>.pays`, `sounds.win`, `rules.freeSpins.3`… (en listas de símbolos se usa el `id`).
