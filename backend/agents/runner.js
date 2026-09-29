// Orquestador de agentes. Un "Director" entiende el pedido y delega en especialistas:
//   designer (tema y textos) · artist (imágenes con Venice) · sound (ElevenLabs) · math (RTP).
// Todo se aplica sobre el BORRADOR del juego; publicar siempre lo hace una persona.
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { claudeMessages } from '../ai/providers.js';
import { toolDefs, runTool, EDIT_SCOPES } from './tools.js';
import { one, run, all } from '../db.js';
import { config, providers } from '../config.js';
import { getGame } from '../services/games.js';
import { HttpError } from '../lib/http.js';

const bus = new EventEmitter();
bus.setMaxListeners(200);
const active = new Map(); // runId → { cancelled }

const COMMON = `Trabajas dentro de una plataforma profesional de tragamonedas (slots) con licencia para dinero real.
Editas el BORRADOR de un juego; los cambios no llegan a los jugadores hasta que una persona los publica desde el panel.
Responde siempre en español, breve y concreto. Nunca inventes URLs ni ids de assets: usa los que devuelven las herramientas.
Contenido responsable: nada dirigido a menores (sin estética infantil ni personajes de caricatura para niños), nada que prometa ganar dinero,
nada sexual, nada con marcas, personajes o obras protegidas por derechos de autor.`;

export const AGENTS = {
  director: {
    title: 'Director creativo',
    system: `${COMMON}
Eres el DIRECTOR. Entiendes lo que pide el usuario, lees el juego y delegas en especialistas con instrucciones completas
(el especialista NO ve esta conversación: incluye estilo, paleta, lista de símbolos con sus ids, etc.).
- designer: nombre, tema, paleta de colores, tipografía, nombres de símbolos y estilo de los BOTONES (forma, estilo, tamaño, colores, iconos y textos).
  Botones del juego: spin (girar), auto, turbo, sound, minus/plus (apuesta), info, buy (comprar bonus; solo Bonus Buy).
- artist: generar/editar imágenes de símbolos, fondos de PC y de celular, fondo de rodillos, celdas, marco, logo y BOTONES (Venice). Cada símbolo y cada botón es una imagen distinta.
- sound: efectos de sonido y música (ElevenLabs).
- math: tabla de pagos, reglas, volatilidad, RTP, cantidad de rodillos, filas y líneas de pago (resize_grid).
Orden recomendado para un re-diseño completo: designer → artist → sound; math solo si piden cambios de juego/pagos/RTP.
Puedes delegar varias veces. Al terminar, resume qué cambió y recuerda que hay que revisar la vista previa y publicar.`,
    maxTurns: 14,
    director: true,
  },
  designer: {
    title: 'Diseñador',
    system: `${COMMON}
Eres el DISEÑADOR de UI/tema. Controlas theme (title, palette {primary, accent, panel, text, reelBg}, backgroundColor, font de Google Fonts,
background/logo/spinButton si te pasan una URL) y los nombres visibles de los símbolos. Cuida el contraste (texto legible sobre panel).
BOTONES (theme.buttons): { shape: round|rounded|square|pill, style: gradient|flat|glass|outline, size: 0.8-1.4,
  color: fondo de botones pequeños, textColor, y por botón <spin|auto|turbo|sound|minus|plus|info|buy>: { icon: emoji o texto corto,
  label: texto accesible, iconOff: icono de sonido apagado, image: URL de imagen (la pone el Artista) } }.
Para volver al diseño estándar de un botón con imagen, pon theme.buttons.<botón>.image = null.
BOTONERA (theme.hud): { layout: "pill" (píldora centrada bajo los rodillos, por defecto) | "classic" (barra de ancho completo abajo),
  barColor (color CSS con transparencia, ej. "rgba(10,8,12,.82)"), barBorder, spinSize (56-130 px) }.
RODILLOS: theme.symbolScale (0.6-1, cuánto de la celda ocupa el símbolo; 0.92 por defecto), theme.cellGap (0-16 px entre celdas),
  theme.cellColor, theme.cellAlpha (0-1), theme.cellRadius, theme.cellBorder (color o "none"), theme.frameColor,
  theme.tagline (frase corta bajo los rodillos en celular). Imágenes que pone el Artista: theme.background (PC), theme.backgroundMobile
  (celular), theme.reelsBackground (detrás de los rodillos), theme.cellImage (fondo de cada celda), theme.frame (marco), theme.logo.
Usa update_config con varias operaciones a la vez. No puedes tocar la matemática.`,
    maxTurns: 10,
  },
  artist: {
    title: 'Artista',
    system: `${COMMON}
Eres el ARTISTA. Creas y editas imágenes con Venice.
- Símbolos: purpose "symbol", removeBackground true, prompts en inglés que terminen con "slot game symbol icon, centered, isolated on plain background, high detail, vibrant, no text".
  Mantén un estilo coherente entre todos los símbolos del juego (mismo estilo de ilustración, iluminación y paleta). Los símbolos de mayor pago deben verse más lujosos.
  Comodín (wild) y scatter/bonus pueden incluir la palabra WILD o BONUS si el pedido lo requiere.
- Fondo: purpose "background", escena ambiental sin personajes en primer plano y sin texto, con el centro despejado para los rodillos.
- Botones: purpose "button" (spin, auto, turbo, sound, minus, plus, info) o "ui" (buy, más ancho), removeBackground true,
  prompts en inglés como "round glossy casino spin button icon with circular arrow, <estilo del juego>, centered, isolated, no text".
  Asigna con assignTo "theme.buttons.<botón>.image". El botón spin debe ser el más llamativo; mantén el mismo estilo en todos.
- Fondos: "background" para PC (16:9) y "backgroundMobile" para celular (9:16), misma escena adaptada; centro despejado.
  "reels" para el fondo detrás de los rodillos (oscuro, poco detalle), "tile" para el fondo de cada celda (sutil, que no compita con los símbolos),
  "frame" para un marco ornamental con el centro transparente (removeBackground no aplica), "logo" con el nombre del juego.
- Asigna cada imagen con assignTo (ej. "symbols.<id>.image", "theme.background", "theme.buttons.spin.image").
Tras generar algo importante, usa view_asset para revisarlo; si no sirve, edítalo o regénéralo (máx. 2 intentos por imagen).`,
    maxTurns: 40,
  },
  sound: {
    title: 'Diseñador de sonido',
    system: `${COMMON}
Eres el DISEÑADOR DE SONIDO. Generas efectos con ElevenLabs (prompts en inglés, cortos y concretos) y música instrumental en loop.
Eventos: spin (0.5-1 s), reelStop (0.3 s, golpe seco), win (1-2 s), bigWin (3-5 s, celebración), feature (2-3 s, activación de bonus),
click (0.2 s), coin (0.5 s), tumble (0.4 s), scatter (0.8 s), music (30-60 s loop, base), featureMusic (30-60 s, más intensa).
Todo debe sonar coherente con el tema del juego. Ajusta volúmenes con update_config en soundVolumes {slot: 0..1} si hace falta.`,
    maxTurns: 20,
  },
  math: {
    title: 'Matemático',
    system: `${COMMON}
Eres el MATEMÁTICO del juego. Lee engine_info y la sección math antes de cambiar nada.
Los juegos son de dinero real: el RTP publicado debe coincidir con el objetivo (tolerancia ±1 %). Tras cualquier cambio en pagos o reglas,
ejecuta tune_rtp para volver al objetivo y luego simulate_rtp para confirmar. Explica el impacto en volatilidad y frecuencia de premios
en lenguaje sencillo. rtpTarget permitido: entre 0.85 y 1.10 (85 % a 110 %). Si el objetivo supera 1.00, advierte claramente que el juego
pagará más de lo que recauda (pierde dinero con cada apuesta) y solo tiene sentido para promociones o demo. No cambies bet.levels salvo que te lo pidan.
Para cambiar rodillos (verticales), filas (horizontales) o líneas de pago usa SIEMPRE resize_grid (ya reajusta el RTP);
nunca edites grid ni reels a mano. Reel Rush, Megaways y Colossal pagan por "formas" (ways): ahí no hay líneas.`,
    maxTurns: 14,
  },
};

function persist(runId, type, data) {
  const { lastInsertRowid } = run('INSERT INTO agent_events (run_id, type, data) VALUES (?, ?, ?)', runId, type, JSON.stringify(data));
  bus.emit(runId, { id: Number(lastInsertRowid), type, data, at: new Date().toISOString() });
}

export function subscribe(runId, fn) {
  bus.on(runId, fn);
  return () => bus.off(runId, fn);
}

export const listEvents = (runId, afterId = 0) =>
  all('SELECT id, type, data, created_at FROM agent_events WHERE run_id = ? AND id > ? ORDER BY id', runId, afterId)
    .map((e) => ({ id: e.id, type: e.type, data: JSON.parse(e.data), at: e.created_at }));

export const listRuns = (gameId) =>
  all('SELECT id, game_id, prompt, status, summary, usage, created_at, finished_at FROM agent_runs WHERE (? IS NULL OR game_id = ?) ORDER BY created_at DESC LIMIT 50', gameId ?? null, gameId ?? null)
    .map((r) => ({ ...r, usage: r.usage ? JSON.parse(r.usage) : null }));

export function getRun(id) {
  const r = one('SELECT * FROM agent_runs WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Ejecución no encontrada');
  return { ...r, messages: undefined, usage: r.usage ? JSON.parse(r.usage) : null, running: active.has(id) };
}

export function cancelRun(id) {
  const a = active.get(id);
  if (a) a.cancelled = true;
  return { cancelled: Boolean(a) };
}

function addUsage(total, u) {
  if (!u) return;
  for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) total[k] = (total[k] || 0) + (u[k] || 0);
}

function toolResultContent(out) {
  if (out && out.__content) return out.__content;
  const text = JSON.stringify(out ?? { ok: true });
  return text.length > 60_000 ? text.slice(0, 60_000) + '…(recortado)' : text;
}

/** Bucle de herramientas de un agente. Devuelve su texto final y los mensajes actualizados. */
async function agentLoop(agent, messages, ctx, usage) {
  const def = AGENTS[agent];
  const tools = toolDefs(agent);
  const model = def.director ? config.anthropic.directorModel : config.anthropic.model;
  for (let turn = 0; turn < def.maxTurns; turn++) {
    if (ctx.state.cancelled) throw new HttpError(499, 'Cancelado por el usuario');
    const res = await claudeMessages({ system: def.system + `\n\nJuego: ${ctx.gameId} (motor ${ctx.engine}).`, messages, tools, model });
    addUsage(usage, res.usage);
    messages.push({ role: 'assistant', content: res.content });
    for (const b of res.content) if (b.type === 'text' && b.text.trim()) ctx.emit('message', { agent, text: b.text });
    const calls = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    }
    const results = [];
    for (const call of calls) {
      ctx.emit('tool_call', { agent, tool: call.name, input: call.input });
      let out, isError = false;
      try {
        if (call.name === 'delegate') {
          out = { summary: await runSpecialist(call.input.agent, call.input.task, ctx, usage) };
        } else {
          out = await runTool(call.name, call.input, ctx, agent);
        }
        if (out?.error) isError = true;
      } catch (e) {
        if (e.status === 499) throw e;
        out = { error: e.message };
        isError = true;
      }
      ctx.emit('tool_result', { agent, tool: call.name, ok: !isError, preview: out?.__content ? '[imagen]' : JSON.stringify(out).slice(0, 400) });
      results.push({ type: 'tool_result', tool_use_id: call.id, content: toolResultContent(out), ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  return 'Límite de pasos alcanzado; el trabajo puede estar incompleto.';
}

async function runSpecialist(agent, task, ctx, usage) {
  if (!AGENTS[agent] || AGENTS[agent].director) throw new HttpError(400, `Agente desconocido: ${agent}`);
  const p = providers();
  if (agent === 'artist' && !p.venice) return 'No disponible: falta VENICE_API_KEY en el servidor.';
  if (agent === 'sound' && !p.elevenlabs) return 'No disponible: falta ELEVENLABS_API_KEY en el servidor.';
  ctx.emit('agent_start', { agent, title: AGENTS[agent].title, task });
  const scope = EDIT_SCOPES[agent].join(', ');
  const text = await agentLoop(agent, [{ role: 'user', content: `${task}\n\n(Rutas que puedes editar: ${scope})` }], ctx, usage);
  ctx.emit('agent_done', { agent, summary: text });
  return text;
}

/**
 * Inicia (o continúa) una conversación con los agentes. Devuelve el runId de inmediato;
 * el progreso llega por eventos (SSE /api/admin/agents/runs/:id/events).
 * `agent` permite hablar directo con un especialista sin pasar por el director.
 */
export function startRun({ gameId, prompt, runId = null, agent = 'director', actor = 'admin' }) {
  if (!providers().anthropic) throw new HttpError(503, 'Falta ANTHROPIC_API_KEY en las variables del servidor');
  if (!prompt?.trim()) throw new HttpError(400, 'Escribe un pedido para los agentes');
  if (!AGENTS[agent]) throw new HttpError(400, `Agente desconocido: ${agent}`);
  const game = getGame(gameId);
  let messages = [];
  if (runId) {
    const r = one('SELECT * FROM agent_runs WHERE id = ?', runId);
    if (!r) throw new HttpError(404, 'Conversación no encontrada');
    if (active.has(runId)) throw new HttpError(409, 'Los agentes siguen trabajando en esta conversación');
    messages = JSON.parse(r.messages || '[]');
    run("UPDATE agent_runs SET status = 'running', finished_at = NULL WHERE id = ?", runId);
  } else {
    runId = `run_${randomBytes(9).toString('base64url')}`;
    run("INSERT INTO agent_runs (id, game_id, prompt, status, messages) VALUES (?, ?, ?, 'running', '[]')", runId, gameId, prompt);
  }
  const state = { cancelled: false };
  active.set(runId, state);
  const ctx = { runId, gameId, engine: game.engine, actor, state, emit: (type, data) => persist(runId, type, data) };
  const usage = {};
  messages.push({ role: 'user', content: prompt });
  ctx.emit('user', { text: prompt, agent });

  (async () => {
    let status = 'done', summary = '';
    try {
      summary = agent === 'director'
        ? await agentLoop('director', messages, ctx, usage)
        : await agentLoop(agent, messages, ctx, usage);
    } catch (e) {
      status = e.status === 499 ? 'cancelled' : 'error';
      summary = e.message;
      ctx.emit('error', { message: e.message });
      // Deja la conversación en un estado válido para poder continuarla.
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant' && last.content.some?.((b) => b.type === 'tool_use')) messages.pop();
      if (messages[messages.length - 1]?.role === 'user') messages.push({ role: 'assistant', content: `(Interrumpido: ${e.message})` });
    } finally {
      active.delete(runId);
      const prev = one('SELECT usage FROM agent_runs WHERE id = ?', runId);
      const total = prev?.usage ? JSON.parse(prev.usage) : {};
      addUsage(total, usage);
      run('UPDATE agent_runs SET status = ?, summary = ?, usage = ?, messages = ?, finished_at = datetime(\'now\') WHERE id = ?',
        status, summary.slice(0, 4000), JSON.stringify(total), JSON.stringify(messages), runId);
      ctx.emit('done', { status, summary, usage: total });
    }
  })();

  return { runId };
}
