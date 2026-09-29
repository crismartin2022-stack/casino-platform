# 🎰 Casino Platform

Plataforma de tragamonedas lista para Railway: **10 motores de juego**, **RNG y matemática en el servidor**, **API para operadores** (billetera interna o *seamless*) y un **panel con agentes de IA** que rediseñan los juegos: imágenes con Venice, sonido y música con ElevenLabs, diseño y matemática con Claude.

Sin dependencias de npm: solo Node.js ≥ 22.13 (usa `node:sqlite`, `fetch` y `worker_threads` integrados).

## Motores

| Motor | Mecánica | Juego de ejemplo |
| --- | --- | --- |
| `reel-rush` | 5×3, 243 formas, cascadas con multiplicador creciente | Reel Rush |
| `megaways` | 6 rodillos de 2–7 filas (hasta 117.649 formas), giros gratis con multiplicador | Templo Megaways |
| `bonus-buy` | 5×3, 20 líneas, giros gratis ×3 y compra directa del bonus | Tesoro del Dragón |
| `hold-win` | 5×3, 10 líneas, monedas fijas con re-giros y 4 jackpots | Monedas de la Suerte |
| `colossal-reels` | 5×4, 1.024 formas, símbolos gigantes 2×2/3×3 con entrada pseudo-3D | Titanes Colosales |
| `cluster-pays` | 7×7, paga por grupos de 5+ iguales que se tocan, cascadas con multiplicador | Gemas Conectadas |
| `scatter-pays` | 6×5, paga con 8+ iguales en cualquier lugar, cascadas y bombas multiplicadoras acumulables; compra de bonus | Tormenta del Olimpo |
| `expanding-symbol` | 5×3 estilo "Book": libro comodín/scatter y símbolo especial que se expande en giros gratis | El Libro del Desierto |
| `sticky-wilds` | 5×3, comodines fijos en giros gratis o comodines caminantes con re-giros (configurable) | Forajidos del Oeste |
| `megaways-cascade` | Megaways con cascadas, multiplicador +0,5 por caída y símbolos misterio | Cascada Infinita |

**Bonus Buy** incluye un menú de compra (giros gratis, giros gratis con wilds fijos, ruleta de la fortuna y "elige un premio"), y **Hold & Win** tiene monedas especiales (multiplicadoras y +1 re-giro). Cada precio de compra se calcula para respetar el RTP.

Los 10 vienen con la tabla de pagos ajustada a **RTP 96 %** (`npm run simulate` para recalcular).

## Estructura

```
backend/           API, base de datos, billeteras, agentes
  math/            matemática de los 5 motores, RNG, simulador y ajuste de RTP
  agents/          Director + Diseñador, Artista, Sonido, Matemático (herramientas y permisos)
  ai/providers.js  Claude, Venice y ElevenLabs (fetch directo)
  games/seed/      configuración inicial de los 5 juegos
game-engines/      clientes PixiJS v8 + GSAP (shared/ = núcleo común, engine-*/ = cada motor)
play/              página que carga cualquier juego: /play/<id>
admin-panel/       panel de administración: /admin
client-sdk/        SDK para operadores (iframe + servidor)
docs/API.md        documentación de la API y del protocolo de billetera
tests/             pruebas de matemática e integración (IA simulada)
```

## Probar en local

```bash
cp .env.example .env         # opcional
ADMIN_TOKEN=secreto npm start
```

- Juegos: http://localhost:3000
- Panel: http://localhost:3000/admin (entra con el `ADMIN_TOKEN`)
- Pruebas: `npm test`

## Desplegar en Railway

1. **New Project → Deploy from GitHub repo** → elige `casino-platform`. Railway detecta Node y usa `railway.json` (arranque `npm start`, healthcheck `/health`).
2. **Volume**: en el servicio → *Settings → Volumes → Add Volume* con mount path `/data`. Ahí viven la base de datos y las imágenes/sonidos generados. Sin volumen se pierden en cada despliegue.
3. **Variables** (ver `.env.example`):
   - `ADMIN_TOKEN` — una cadena larga y aleatoria (obligatoria).
   - `ANTHROPIC_API_KEY` — para los agentes.
   - `VENICE_API_KEY` — para generar y editar imágenes.
   - `ELEVENLABS_API_KEY` — para efectos de sonido y música.
4. **Networking → Generate Domain**. Listo: `https://<tu-app>.up.railway.app/admin`.

> Mantén **1 réplica**: SQLite no admite varias instancias escribiendo a la vez. Para escalar horizontalmente habría que migrar a PostgreSQL.

## Cómo se usa el panel

1. Elige un juego → pestaña **🤖 Agentes** → escribe lo que quieres, por ejemplo: *“Rediseña el juego con temática egipcia: símbolos, fondo, colores y música”*.
2. El **Director** reparte el trabajo: el Diseñador cambia paleta y tipografía, el Artista genera cada símbolo y el fondo en Venice (y los revisa viendo la imagen), el de Sonido crea efectos y música en ElevenLabs, y el Matemático ajusta pagos y RTP si lo pides. Verás el progreso en vivo.
3. Todo va al **borrador**. Pulsa **▶ Vista previa** para jugarlo.
4. **Publicar** valida la configuración y, si cambió la matemática, simula 500.000 giros: si el RTP se aleja más de ±1 % del objetivo, no deja publicar.

**Tamaño y botones:** en 📈 Matemática eliges rodillos (verticales, 3–8), filas (horizontales, 3–6) y, en Bonus Buy y Hold & Win, la cantidad de líneas de pago; el RTP se reajusta solo. En 🎨 Diseño → *Botones del juego* cambias forma, estilo, tamaño, colores, iconos o una imagen propia para cada botón (girar, auto, turbo, sonido, apuesta, info, comprar). Los agentes también pueden hacerlo: el Artista genera imágenes de botones y el Matemático cambia el tamaño de la cuadrícula.

También puedes editar a mano: Diseño, Símbolos (imagen, nombre, pagos), Sonidos (volúmenes), Matemática (simular / ajustar RTP / reglas), JSON completo y Versiones (restaurar cualquier versión anterior).

**Permisos de los agentes:** cada especialista solo puede tocar su parte (el Artista no puede cambiar pagos, el Diseñador no toca reglas…). Ningún agente puede publicar: siempre lo hace una persona.

## Integridad para dinero real

- El resultado de cada ronda se calcula **solo en el servidor** con `crypto.randomInt` (CSPRNG del sistema). El navegador solo anima.
- Cada ronda guarda los números aleatorios usados, la versión exacta del juego, el saldo antes/después y el resultado. **Rondas → Verificar** la recalcula y comprueba que el premio coincide.
- Las versiones publicadas son inmutables; cambiar la matemática exige nueva simulación.
- Las apuestas son idempotentes (`clientRoundId`) y, con billetera seamless, los créditos fallidos se reintentan automáticamente.
- Registro de auditoría de toda acción de administradores y agentes.

**Pendiente antes de certificar en un laboratorio (GLI, BMM, eCOGRA…):** informe del RNG, cálculo del RTP por la vía que exija el laboratorio (la simulación da un intervalo de confianza, no el valor exacto), textos de ayuda revisados por jurisdicción, límites por mercado (velocidad mínima de giro, autoplay, *reality check*), y migrar a PostgreSQL con copias de seguridad si vas a escalar. Los jackpots actuales son **fijos** (múltiplos de la apuesta), no progresivos.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm start` | Arranca el servidor |
| `npm run dev` | Arranca con recarga automática |
| `npm test` | Pruebas de matemática, API, billeteras y agentes (con IA simulada) |
| `npm run simulate` | Re-ajusta el RTP de las 5 semillas (tarda unos minutos) |
