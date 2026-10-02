# 🎰 Casino Platform

Plataforma de tragamonedas lista para Railway: **15 motores de juego** (14 tragamonedas y Craps de mesa), **RNG y matemática en el servidor**, **API para operadores** (billetera interna o *seamless*) y un **panel con agentes de IA** que rediseñan los juegos: imágenes con Venice, sonido y música con ElevenLabs, diseño y matemática con Claude.

Sin dependencias de npm: solo Node.js ≥ 22.13 (usa `node:sqlite`, `fetch` y `worker_threads` integrados).

## Motores

| Motor | Mecánica | Juego de ejemplo |
| --- | --- | --- |
| `reel-rush` | 5×3, 243 formas, cascadas con multiplicador creciente | Reel Rush |
| `megaways` | 6 rodillos de 2–7 filas (hasta 117.649 formas); 2+ comodines y símbolos multiplicador suman al multiplicador del giro; 10 giros gratis por cada scatter | Templo Megaways |
| `bonus-buy` | 5×3, 20 líneas; giros gratis ×2 con 3 wilds fijos al azar y +5 giros; BONUS SORPRESA; ruleta real, «Elige y gana» con casillas ×2, «Colecciona» y «El camino»; menú de compra | Tesoro del Dragón |
| `hold-win` | 5×5, 20 líneas; ELIGE Y FIJA: el jugador elige qué moneda misteriosa fijar (Bronce a Diamante, +10 % al fijar), especiales (bonus, ×, jackpot, reset, +1 ronda) y jackpots por posiciones fijas | Monedas de la Suerte |
| `colossal-reels` | 5×4, 1.024 formas, símbolos gigantes 2×2/3×3/4×4 con entrada pseudo-3D | Titanes Colosales |
| `cluster-pays` | 7×7, grupos de 5+, cascadas; CASILLAS DORADAS ×2 → ×32; giros gratis con casillas que no se borran; compra | Gemas Conectadas |
| `scatter-pays` | 6×5, 8+ iguales en cualquier lugar, cascadas y bombas ×2–×100 acumulables; RAYO DE ZEUS; doble chance; compra | Tormenta del Olimpo |
| `expanding-symbol` | 5×3 estilo "Book": el libro elige el símbolo que se expande; segundo especial al reactivar; marcos multiplicadores; doble chance | El Libro del Desierto |
| `sticky-wilds` | 5×3; 10 giros ×2 con 3 comodines fijos al azar y +5 giros; comodines fijos o caminantes (configurable) | Forajidos del Oeste |
| `megaways-cascade` | Megaways con cascadas (+0,5 por caída), comodines que multiplican, símbolos misterio y 10 giros por scatter | Cascada Infinita |
| `treasure-chests` | 5×4 con premios por fila y cofres que multiplican el premio | Cofres de la Corona |
| `cash-collect` | 5×3, monedas con dinero que cobra el recolector; niveles en giros gratis | Pesca de Oro |
| `classic-reels` | Clásico 3×3 de frutas, BAR y 7 (1 a 5 líneas): cerezas que pagan desde una, cualquier BAR, comodín ×2 (dos comodines ×4) y rodillo multiplicador ×1–×10 | Frutas de Oro |
| `level-up` | 5×3 con NIVEL DEL JUGADOR guardado por apuesta: barra de XP, colección de semillas (Drop & Collect), bonus de cofres y recompensas por nivel (multiplicador, semillas doradas y jackpot que reinicia al nivel 1) | Huerta Dorada |
| `craps` (Dados en Vivo) | MESA EN VIVO con crupier: mesa compartida estilo ruleta europea en vivo — cuenta regresiva para apostar (20 s), «no va más», tira el crupier (video grabado del resultado) y se paga a todos con la misma tirada | Dados en Vivo |
| `craps` | Mesa de Craps: Pass/Don't Pass, Come/Don't Come, odds, números, field (2 y 12 pagan 2 a 1), hardways. Dados 3D, lanzamiento arrastrando con medidor de potencia, fichas que se arrastran a la mesa, partículas de premio, pagos editables con RTP exacto | Dados de Oro |

**Todas las funciones son editables** en 📈 Matemática → ⚙ Funciones del motor (formulario por motor; también en JSON en «Avanzado»). Cada precio de compra y de la doble chance se calcula para respetar el RTP.

Todos vienen con la tabla de pagos ajustada a **RTP 96 %** (`npm run simulate` para recalcular).

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
- **«✨ Solo texto»** (Saldo, apuesta y premio): con un clic quita recuadro, fondo y borde de los marcadores en cualquier interfaz, también en Diseño libre con la plantilla de recuadros. En Diseño libre, los colores del recuadro personalizado y «Sin recuadro» mandan sobre el recuadro de la plantilla (`custom.statStyle = "box"`).
- **✂ Quitar fondo** (Diseño → Botones del juego): borra en el navegador el fondo cuadrado que traen pintado algunas imágenes de botones (color liso o el cuadriculado falso de transparencia), con vista previa y tolerancia, recorta lo vacío y guarda un PNG nuevo (la original no se toca). «Quitar el fondo cuadrado a todos los botones» lo hace en un clic para todos.
- **Marco: ancho y alto por separado** (Diseño → Logo y marco): estira o achica el marco a lo ancho y a lo alto (50–250 % de los rodillos) y muévelo a izquierda/derecha, con valores propios en PC y en celular (`theme.frameScaleX`, `frameScaleY`, `frameOffsetX` y sus versiones `…Mobile`; sin valor usan «Tamaño del marco»). El agente Diseñador también lo hace: «el marco más ancho y un poco más bajo».
- **Moneda en la vista previa y en la información**: la barra de la vista previa tiene un selector de moneda (la base y las que tienen fichas en 💱 Apuestas por moneda). La tabla de premios del juego (botón ☰/ⓘ) muestra todos los importes en la moneda y la apuesta de la sesión, con − / + para cambiar la apuesta ahí mismo, el premio máximo en dinero, los precios de compra del bonus y los jackpots. En 🧩 Símbolos, «Ver cuánto paga con» muestra el importe de cada combinación. La prueba silenciosa avisa si un operador usa una moneda sin fichas propias.
- **Colosal en giros gratis** (Titanes Colosales): `rules.fsColossalChance` (Matemática → «Colosal en los giros gratis», 0–100 %; 100 % = garantizado). El subtítulo del cartel de entrada al bonus se edita en Carteles → Textos (`texts.bonusSub`; «-» lo oculta).
- **Tabla de premios con el total**: cada combinación se muestra como «5 iguales ··· $ 182,23» (el importe ya es el premio total para la apuesta elegida), y los precios de compra de giros gratis aparecen en dinero.
- **Tipografía de todos los carteles**: en Carteles y mensajes, «Tipografía de todos los carteles» (Google Fonts o archivo propio, `theme.messages.font` / `fontUrl`); cada cartel puede tener la suya.
- **Más tipografías**: pantalla de información, menú e historial (Diseño → Identidad, `theme.infoFont`), textos de la mesa en Dados de Oro (`theme.tableFont`) y nombre y frase de la marca en la pantalla de carga (Marcas → Tipografía). Todas aceptan Google Fonts o un archivo propio.
- **RTP preciso**: «Ajustar RTP» hace el ajuste rápido y después mide con muestras nuevas (en paralelo, varios núcleos) hasta ±0,3 % o `TUNE_REFINE_MS` (45 s) y corrige una vez más; los precios de compra del bonus se calculan con los pagos definitivos. La certificación al publicar mide hasta ±`PUBLISH_PRECISION` (0,4 %) o `PUBLISH_SIM_BUDGET_MS` (60 s) y guarda la precisión lograda; la prueba silenciosa avisa si quedó por encima de ±0,5 %. `SIM_THREADS` fija los hilos (por defecto núcleos − 1, máx. 6).
- **Tabla de premios**: aclara si los importes son por LÍNEA, por FORMA, por GRUPO o por cantidad en pantalla, y que se suman.
- **Textos de los carteles**: se escriben con la tipografía con la que se verán; «Tipografía de los textos» (= la de todos los carteles) está en el mismo bloque.
- **Motor Cofres** (`treasure-chests`, juego «Cofres de la Corona»): 5×4 con premios por FILA (3, 4 o 5 iguales en la misma fila, en cualquier posición); 3+ cofres abren la elección de cofre (×1, ×2, ×3 configurables en `rules.chestPrizes`) con giros gratis multiplicados y re-activación; el bonus también se compra.
- **Premios por monto** (Diseño → 🏆 Premios por monto, `theme.winTiers`): niveles «desde N× la apuesta» con sonido, video/GIF/imagen a pantalla completa (con el importe encima) y texto. En todos los motores, incluido Dados de Oro (por tirada). «▶ Probar» lo muestra en la vista previa.
- **Cambiar motor (copia)** (Versiones → 🔁): crea un juego nuevo con otro motor conservando el diseño (fondos, logo, marco, botonera, carteles, textos, tipografías, sonidos, bonus, fichas y marca); los símbolos pasan por equivalencia y la matemática se calibra al RTP del original. El original no se toca.
- **Eliminar un juego** (Versiones → 🗑 Eliminar juego): con confirmación escribiendo el nombre; no se permite si tuvo jugadas con dinero real (se conservan para auditoría: en ese caso, desactivarlo).
- **Vista previa en el celular**: el botón **↗ Abrir** la abre en su propia pestaña a pantalla completa.
- **Dados en Vivo (mesa en vivo con crupier)**: una mesa compartida por juego que corre sola mientras haya jugadores: TOMANDO APUESTAS (azul, con barra de tiempo) → NO VA MÁS → el crupier TIRA (rojo) → PAGANDO GANANCIAS (verde). Los dados los sortea el servidor en el «no va más» (nunca hay secuencias fijas) y todos los jugadores ven y cobran la misma tirada; la fase y el punto son de la mesa. Cada tirada queda en `live_rolls` y cada jugador tiene su ronda auditada (reproducible). En 🎨 Diseño → «Mesa en vivo y crupier grabado» se activa la mesa en vivo, los tiempos y se cargan los videos del crupier: uno por combinación (21) o por total (11), el video de espera en bucle, y una carga masiva por nombre de archivo (`3-4.mp4`, `total-7.mp4`). Sin video para un resultado se ven los dados 3D con el CRUPIER ANIMADO (dibujado de fábrica o tu imagen/GIF): saluda, dice «¡Hagan sus apuestas!», «¡No va más!», lanza y anuncia el resultado. En el panel hay una guía con el texto para generar los videos con IA (Runway, Kling, Sora…). En la mesa normal, el botón «Crupier» hace tirar al crupier grabado.
- **Inicio del panel** (🏠): al entrar se ve una ficha por motor con de qué se trata (frase corta, cuadrícula, forma de pago, bonus, funciones, volatilidad y frecuencias), con «Ver juego» (su juego de ejemplo) y «Crear juego»; arriba, tus borradores y juegos creados. En la lista lateral, cada juego muestra el motor y para qué sirve.
- **Lista de juegos ordenada**: el panel separa ⚙ Motores (los juegos de fábrica, uno por motor), 📝 Borradores (nunca publicados, los últimos editados primero) y ⭐ Creados (publicados, los más nuevos primero). Cada grupo se pliega y recuerda si estaba abierto.
- **Level Up y el RTP**: el nivel se guarda en el servidor por jugador + juego + apuesta (tabla `player_progress`), así nadie sube de nivel con apuestas chicas para cobrar con grandes. Cada ronda guarda el estado anterior y se reproduce igual en la auditoría. El RTP publicado es el promedio a largo plazo (el simulador arrastra el nivel de giro en giro); también se certifica y se informa en las reglas el RTP del nivel 1 (`math.rtpLevel1`).
- **Elegir motor con fichas**: al crear un juego o cambiar de motor, cada motor se muestra en una ficha con cuadrícula, forma de pago, bonus, funciones, volatilidad, frecuencia del bonus, frecuencia de premio y compra.
- **Funciones del motor** (Matemática → ⚙): formulario generado desde el esquema de cada motor (`/api/v1/engines` → `ruleSchema`) con todas sus funciones, incluidas las nuevas (casillas doradas, rayo de Zeus, doble chance, marcos, ELIGE Y FIJA, bonus sorpresa, colecciona, camino…).
- **Doble chance** (`rules.anteCost`, `rules.anteScatterChance`): botón en el juego para pagar un poco más por giro y ver más scatters; el precio lo calcula «Ajustar RTP».
- **Actualizaciones de fábrica**: los juegos de ejemplo que no se tocaron reciben la versión nueva automáticamente al desplegar (nueva versión creada por el sistema); los editados no cambian.
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
