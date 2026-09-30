# 🎰 Casino Platform

Plataforma de tragamonedas lista para Railway: **11 motores de juego** (10 tragamonedas y Craps de mesa), **RNG y matemática en el servidor**, **API para operadores** (billetera interna o *seamless*) y un **panel con agentes de IA** que rediseñan los juegos: imágenes con Venice, sonido y música con ElevenLabs, diseño y matemática con Claude.

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
| `craps` | Mesa de Craps: Pass/Don't Pass, Come/Don't Come, odds, números, field, hardways. Dados 3D, lanzamiento arrastrando, pagos editables con RTP exacto | Dados de Oro |

**Bonus Buy** incluye un menú de compra (giros gratis, giros gratis con wilds fijos, ruleta de la fortuna y "elige un premio"), y **Hold & Win** tiene monedas especiales (multiplicadoras y +1 re-giro). Cada precio de compra se calcula para respetar el RTP.

Los 10 vienen con la tabla de pagos ajustada a **RTP 96 %** (`npm run simulate` para recalcular).

## Estructura

```
backend/           API, base de datos, billeteras, agentes
  math/            matemática de los 11 motores, RNG, simulador y ajuste de RTP
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

## Interfaces del juego

Cada tragamonedas puede usar una de 7 interfaces (Diseño → Interfaz del juego, o al crear el juego):
**Píldora** y **Clásica** (botoneras simples) y cinco interfaces completas con barra superior, panel lateral
(reglas, sonido, pantalla completa, historial), fichas de apuesta directas y efectos de premio propios:
**Neón** (tubos de luz), **Cristal** (vidrio esmerilado), **Brasa** (metal y fuego, GIRAR hexagonal),
**Real** (oro, fichas de casino y lluvia de monedas) y **Arcade** (gabinete retro con LED).
Todas toman los colores de la paleta del juego y funcionan en PC y celular; los agentes también pueden elegirlas.

### Diseño libre, medios y pruebas del bonus

- **Diseño libre** (Diseño → Interfaz → Diseño libre): editor visual para arrastrar y escalar cada botón, marcador y el tablero de la botonera, por separado en PC y celular. Los logos conservan su proporción; el tablero admite imagen (se puede quitar), color, redondeo y borde.
- **Marcos** delante o detrás de los rodillos, con tamaño ajustable y recorte automático del centro.
- **Fondos animados**: GIF o video (MP4/WebM) para el fondo de PC, de celular y detrás de los rodillos. **Tipografías propias** (.ttf, .otf, .woff, .woff2) para el juego y para la botonera.
- **Forzar bonus** en la vista previa (solo borradores) para probar sonidos y animaciones del bonus.
- **Carteles diseñables** (premio, gran/mega premio, entrada y total del bonus, contador de giros): imagen o GIF de fondo, colores, tipografía, tamaño, animación, posición, partículas y textos propios; «▶ Probar» en la vista previa.
- **Ambiente del bonus**: presentación y cierre a pantalla completa y fondos propios durante el bonus, con imagen, GIF o video.
- **Plantilla «Tablero de la maqueta»** en Diseño libre: marcadores en recuadros, GIRAR al centro, − valor + MÁX, AUTO y TURBO; en celular pegada abajo con INFO y SONIDO en las esquinas.
- **Frecuencia del bonus** (Matemática): "bonus cada ~N giros" recalibra los activadores y reajusta el RTP.

## Marcas, prueba silenciosa y marcadores

- **Marcas** (panel → Marcas): nombre, logotipo (imagen, GIF o video), frase, colores, fondo y estilo de carga (barra, anillo o pulso). Al abrir un juego aparece la pantalla de carga con el logo de su marca; el panel agrupa los juegos por marca. Cada juego elige su marca junto al título.
- **Prueba silenciosa**: al publicar, el sistema juega miles de rondas con semilla fija y revisa configuración, apuestas en 7 monedas, jugadas y premios dentro del tope, reproducción exacta (auditoría), bonus y su frecuencia, compras de bonus, RTP, archivos del diseño (faltantes o pesados), símbolos, sonidos, textos de carteles, botonera, marca y cliente. Si hay **errores no se publica** (el juego en vivo no cambia); los **avisos** se informan. El reporte sugiere arreglos y se pueden enviar al Director con un clic. También hay un botón **🩺 Probar** para el borrador. Tarda 0,2–1,5 s por juego.
- **Saldo, apuesta y premio** (Diseño → Saldo, apuesta y premio): títulos propios, colores, recuadro con fondo, opacidad, borde, esquinas o imagen y tamaño de los números (`theme.hud.meters`).
- **Marcadores sin recuadro y con tipografía propia**: en «Saldo, apuesta y premio» el Recuadro puede ser el de la interfaz, **sin recuadro** (se ven los huecos del tablero o la imagen de la botonera) o personalizado; títulos y números admiten tipografía de Google Fonts o un archivo propio (`meters.box = "none"`, `labelFont`, `valueFont`, `labelFontUrl`, `valueFontUrl`).
- **Moneda en la vista previa y en la información**: la barra de la vista previa tiene un selector de moneda (la base y las que tienen fichas en 💱 Apuestas por moneda). La tabla de premios del juego (botón ☰/ⓘ) muestra todos los importes en la moneda y la apuesta de la sesión, con − / + para cambiar la apuesta ahí mismo, el premio máximo en dinero, los precios de compra del bonus y los jackpots. En 🧩 Símbolos, «Ver cuánto paga con» muestra el importe de cada combinación. La prueba silenciosa avisa si un operador usa una moneda sin fichas propias.
- **Colosal en giros gratis** (Titanes Colosales): `rules.fsColossalChance` (Matemática → «Colosal en los giros gratis», 0–100 %; 100 % = garantizado). El subtítulo del cartel de entrada al bonus se edita en Carteles → Textos (`texts.bonusSub`; «-» lo oculta).
- **Tabla de premios con el total**: cada combinación se muestra como «5 iguales ··· $ 182,23» (el importe ya es el premio total para la apuesta elegida), y los precios de compra de giros gratis aparecen en dinero.
- **Tipografía de todos los carteles**: en Carteles y mensajes, «Tipografía de todos los carteles» (Google Fonts o archivo propio, `theme.messages.font` / `fontUrl`); cada cartel puede tener la suya.
- **Más tipografías**: pantalla de información, menú e historial (Diseño → Identidad, `theme.infoFont`), textos de la mesa en Dados de Oro (`theme.tableFont`) y nombre y frase de la marca en la pantalla de carga (Marcas → Tipografía). Todas aceptan Google Fonts o un archivo propio.
- **Eliminar un juego** (Versiones → 🗑 Eliminar juego): con confirmación escribiendo el nombre; no se permite si tuvo jugadas con dinero real (se conservan para auditoría: en ese caso, desactivarlo).
- **Vista previa en el celular**: el botón **↗ Abrir** la abre en su propia pestaña a pantalla completa.
- **Logo y marco**: tamaño del logo y posición vertical del logo y del marco, por separado en PC y celular (`theme.logoScale`, `theme.logoOffsetY`, `theme.logoOffsetYMobile`, `theme.frameOffsetY`, `theme.frameOffsetYMobile`).

## Monedas

Las fichas de cada juego se definen por moneda (Matemática → Apuestas por moneda, con sugerencia automática a partir de un tipo de cambio)
y cada operador puede tener mínimo y máximo propios. El RTP no cambia con la moneda.

## Portal del operador

Cada casino que integra tus juegos tiene su propio panel en **`/operator`** (email y contraseña, roles administrador, finanzas y soporte):
resumen con GGR, jugadas con verificación, jugadores y saldo, catálogo con su RTP, API key y prueba de su billetera, usuarios y reportes CSV.

Desde tu panel (**Operadores → Gestionar**) decides por operador: qué juegos ve, **con qué RTP** (se calcula una variante del juego con esa tabla de pagos),
si puede **crear juegos propios** y cuántos, y si puede usar los agentes de IA. En sus juegos propios solo cambia diseño, imágenes y sonidos:
la matemática, el RTP y las apuestas siguen bajo tu control. Detalle en [docs/API.md](docs/API.md#5-portal-del-operador-operator).

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
