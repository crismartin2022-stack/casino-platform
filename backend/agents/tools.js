// Herramientas que los agentes pueden usar. Cada agente solo ve las suyas y solo puede
// editar las rutas de configuración que le corresponden (el diseñador nunca toca la matemática).
import { getDraft, patchDraft, saveDraft } from '../services/games.js';
import { saveAsset, readAssetBytes, listAssets } from '../services/assets.js';
import { veniceGenerate, veniceEdit, veniceRemoveBackground, veniceUpscale, elevenSoundEffect, elevenMusic } from '../ai/providers.js';
import { simulateAsync, tuneAsync, resizeAsync } from '../math/worker.js';
import { ENGINES, validateConfig } from '../math/index.js';
import { HttpError } from '../lib/http.js';

// ---- Permisos de edición por agente (patrones de ruta; * = cualquier id de símbolo) ----
export const EDIT_SCOPES = {
  designer: ['name', 'theme', 'theme.*', 'symbols.*.name', 'symbols.*.image', 'symbols.*.color'],
  artist: ['theme.background', 'theme.backgroundMobile', 'theme.reelsBackground', 'theme.cellImage', 'theme.logo', 'theme.spinButton', 'theme.frame', 'theme.buttons.*.image', 'symbols.*.image'],
  sound: ['sounds', 'sounds.*', 'soundVolumes', 'soundVolumes.*'],
  math: ['symbols.*.pays', 'symbols.*.pays.*', 'reels', 'freeSpinReels', 'rules', 'rules.*', 'rtpTarget', 'bet', 'bet.*', 'grid'],
};

export function pathAllowed(agent, path) {
  const segs = path.split('.');
  // Un patrón cubre la ruta si coincide como prefijo ("theme" cubre "theme.palette.primary").
  return EDIT_SCOPES[agent].some((pattern) => {
    const ps = pattern.split('.');
    return ps.length <= segs.length && ps.every((p, i) => p === '*' || p === segs[i]);
  });
}

export const BUTTON_KEYS = ['spin', 'auto', 'turbo', 'sound', 'minus', 'plus', 'info', 'buy'];

const symbolsSummary = (c) => c.symbols.map((s) => ({ id: s.id, name: s.name, type: s.type, image: s.image, pays: s.pays }));

function configView(c, section) {
  switch (section) {
    case 'theme': return { name: c.name, theme: c.theme, buttonKeys: BUTTON_KEYS };
    case 'symbols': return symbolsSummary(c);
    case 'sounds': return { sounds: c.sounds, soundVolumes: c.soundVolumes || null };
    case 'math': return {
      engine: c.engine, grid: c.grid, rules: c.rules, rtpTarget: c.rtpTarget, bet: c.bet, symbols: symbolsSummary(c),
      reels: c.reels.map((s) => ({ length: s.length, counts: s.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {}) })),
    };
    default: return {
      engine: c.engine, name: c.name, grid: c.grid, theme: c.theme, sounds: c.sounds, soundVolumes: c.soundVolumes || null,
      symbols: symbolsSummary(c), rules: c.rules, bet: c.bet, rtpTarget: c.rtpTarget,
    };
  }
}

function assign(ctx, agent, path, url, reason) {
  if (!path) return null;
  if (!pathAllowed(agent, path)) throw new HttpError(403, `El agente ${agent} no puede editar ${path}`);
  patchDraft(ctx.gameId, [{ op: 'set', path, value: url }], `agent:${agent}`);
  ctx.emit('config_changed', { agent, ops: [{ path, value: url }], reason });
  return path;
}

const PURPOSE_SIZES = { symbol: [1024, 1024], button: [1024, 1024], tile: [1024, 1024], background: [1280, 720], backgroundMobile: [720, 1280], reels: [1280, 720], frame: [1280, 720], ui: [1024, 512], logo: [1280, 640] };

// ---------------- Definiciones (JSON Schema para Claude) ----------------
const T = {
  get_game_config: {
    description: 'Lee el BORRADOR actual del juego. section: all | theme | symbols | sounds | math.',
    input_schema: { type: 'object', properties: { section: { type: 'string', enum: ['all', 'theme', 'symbols', 'sounds', 'math'] } } },
  },
  update_config: {
    description: 'Edita el borrador con operaciones por ruta. Rutas con puntos; en listas de símbolos se usa el id: "symbols.cherry.name", "theme.palette.primary". op: set | merge | delete | append. Solo puedes tocar las rutas de tu especialidad.',
    input_schema: {
      type: 'object', required: ['ops', 'reason'],
      properties: {
        ops: { type: 'array', items: { type: 'object', required: ['path'], properties: { op: { type: 'string', enum: ['set', 'merge', 'delete', 'append'] }, path: { type: 'string' }, value: {} } } },
        reason: { type: 'string', description: 'Por qué haces el cambio (queda en el historial)' },
      },
    },
  },
  list_assets: {
    description: 'Lista las imágenes y sonidos del juego (id, tipo, prompt, url).',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['image', 'sound'] } } },
  },
  view_asset: {
    description: 'Mira una imagen para revisar su calidad antes de asignarla o para decidir cómo editarla.',
    input_schema: { type: 'object', required: ['assetId'], properties: { assetId: { type: 'string' } } },
  },
  generate_image: {
    description: 'Genera una imagen con Venice. purpose define el tamaño: symbol (cuadrado), button (cuadrado, botón del juego), tile (cuadrado, fondo de cada celda), background (16:9, fondo de PC), backgroundMobile (9:16, fondo de celular), reels (fondo detrás de los rodillos), frame (marco decorativo), ui (2:1, p. ej. botón de compra), logo. Para símbolos y botones usa removeBackground=true. assignTo asigna la imagen al juego (ej. "symbols.cherry.image", "theme.background", "theme.buttons.spin.image").',
    input_schema: {
      type: 'object', required: ['prompt', 'purpose'],
      properties: {
        prompt: { type: 'string', description: 'Prompt detallado en inglés: sujeto, estilo, iluminación, colores, "centered, isolated, game icon"' },
        negativePrompt: { type: 'string' },
        purpose: { type: 'string', enum: ['symbol', 'button', 'tile', 'background', 'backgroundMobile', 'reels', 'frame', 'ui', 'logo'] },
        removeBackground: { type: 'boolean' },
        assignTo: { type: 'string' },
        seed: { type: 'integer' },
      },
    },
  },
  edit_image: {
    description: 'Edita una imagen existente con instrucciones (cambiar color, añadir brillo, cambiar estilo...). Crea un asset nuevo; el original no se pierde.',
    input_schema: {
      type: 'object', required: ['assetId', 'prompt'],
      properties: { assetId: { type: 'string' }, prompt: { type: 'string' }, removeBackground: { type: 'boolean' }, assignTo: { type: 'string' } },
    },
  },
  remove_background: {
    description: 'Quita el fondo de una imagen (PNG transparente).',
    input_schema: { type: 'object', required: ['assetId'], properties: { assetId: { type: 'string' }, assignTo: { type: 'string' } } },
  },
  upscale_image: {
    description: 'Aumenta la resolución de una imagen (x2 o x4).',
    input_schema: { type: 'object', required: ['assetId'], properties: { assetId: { type: 'string' }, scale: { type: 'integer', enum: [2, 4] }, assignTo: { type: 'string' } } },
  },
  generate_sound: {
    description: 'Genera un efecto de sonido con ElevenLabs y lo asigna a un evento del juego. slot: spin, reelStop, win, bigWin, feature, click, coin, tumble, scatter.',
    input_schema: {
      type: 'object', required: ['prompt', 'slot'],
      properties: {
        prompt: { type: 'string', description: 'Descripción en inglés del sonido: "short bright casino coin chime, arcade, 0.5s"' },
        slot: { type: 'string' }, durationSeconds: { type: 'number' }, loop: { type: 'boolean' },
      },
    },
  },
  generate_music: {
    description: 'Compone música instrumental con ElevenLabs. slot: music (juego base) o featureMusic (bonus). Usa loops de 30-60 s.',
    input_schema: {
      type: 'object', required: ['prompt', 'slot'],
      properties: { prompt: { type: 'string' }, slot: { type: 'string', enum: ['music', 'featureMusic'] }, lengthSeconds: { type: 'number' } },
    },
  },
  simulate_rtp: {
    description: 'Simula el borrador (Monte Carlo) y devuelve RTP con intervalo de confianza, frecuencia de premio y de bonus, volatilidad y distribución de premios.',
    input_schema: { type: 'object', properties: { spins: { type: 'integer', description: 'Por defecto 300000' }, mode: { type: 'string', enum: ['base', 'buy'] } } },
  },
  tune_rtp: {
    description: 'Escala la tabla de pagos para alcanzar el RTP objetivo y lo guarda en el borrador. En Bonus Buy también recalcula el precio de compra.',
    input_schema: { type: 'object', properties: { target: { type: 'number', description: 'Ej. 0.96' } } },
  },
  resize_grid: {
    description: 'Cambia la cantidad de rodillos (reels, verticales), filas (rows, horizontales) y/o líneas de pago (lines, solo Bonus Buy y Hold & Win). Reconstruye tiras y tabla de pagos y reajusta el RTP al objetivo automáticamente. Límites: rodillos 3-8 (Megaways y Colossal 4-8), filas 3-6 (Megaways no usa filas fijas).',
    input_schema: { type: 'object', properties: { reels: { type: 'integer' }, rows: { type: 'integer' }, lines: { type: 'integer' } } },
  },
  engine_info: {
    description: 'Explica las reglas y parámetros del motor de este juego.',
    input_schema: { type: 'object', properties: {} },
  },
  delegate: {
    description: 'Encarga una tarea a un agente especialista y recibe su resumen. designer: tema, paleta, tipografía, nombres. artist: imágenes (Venice). sound: efectos y música (ElevenLabs). math: tabla de pagos, reglas, RTP.',
    input_schema: {
      type: 'object', required: ['agent', 'task'],
      properties: { agent: { type: 'string', enum: ['designer', 'artist', 'sound', 'math'] }, task: { type: 'string', description: 'Instrucciones completas y concretas' } },
    },
  },
};

export const AGENT_TOOLS = {
  director: ['get_game_config', 'list_assets', 'view_asset', 'delegate'],
  designer: ['get_game_config', 'update_config', 'list_assets', 'view_asset'],
  artist: ['get_game_config', 'list_assets', 'view_asset', 'generate_image', 'edit_image', 'remove_background', 'upscale_image', 'update_config'],
  sound: ['get_game_config', 'list_assets', 'generate_sound', 'generate_music', 'update_config'],
  math: ['get_game_config', 'engine_info', 'simulate_rtp', 'tune_rtp', 'resize_grid', 'update_config'],
};

export function toolDefs(agent) {
  return AGENT_TOOLS[agent].map((name) => ({ name, ...T[name] }));
}

async function imageAsset(ctx, agent, buf, { prompt, provider, parentId, purpose, assignTo, removeBackground }) {
  let out = buf;
  if (removeBackground) {
    try { out = await veniceRemoveBackground({ image: buf }); } catch (e) { ctx.emit('warning', { agent, message: `No se pudo quitar el fondo: ${e.message}` }); }
  }
  const a = saveAsset(out, { gameId: ctx.gameId, kind: 'image', mime: 'image/png', provider, prompt, parentId, meta: { purpose }, actor: `agent:${agent}` });
  ctx.emit('asset_created', { agent, asset: { id: a.id, url: a.url, kind: 'image', prompt } });
  const assigned = assign(ctx, agent, assignTo, a.url, `Imagen generada: ${prompt || ''}`.slice(0, 200));
  return { assetId: a.id, url: a.url, assigned };
}

// ---------------- Implementación ----------------
export async function runTool(name, input, ctx, agent) {
  if (!AGENT_TOOLS[agent].includes(name)) throw new HttpError(403, `La herramienta ${name} no está disponible para ${agent}`);
  switch (name) {
    case 'get_game_config': return configView(getDraft(ctx.gameId), input.section);

    case 'update_config': {
      const bad = (input.ops || []).filter((o) => !pathAllowed(agent, String(o.path)));
      if (bad.length) return { error: `Sin permiso para: ${bad.map((o) => o.path).join(', ')}. Tus rutas: ${EDIT_SCOPES[agent].join(', ')}` };
      try {
        const { errors } = patchDraft(ctx.gameId, input.ops, `agent:${agent}`);
        ctx.emit('config_changed', { agent, ops: input.ops, reason: input.reason });
        return { ok: true, warnings: errors };
      } catch (e) {
        return { error: e.message, details: e.details };
      }
    }

    case 'list_assets':
      return listAssets({ gameId: ctx.gameId, kind: input.kind, limit: 60 }).map((a) => ({ id: a.id, kind: a.kind, url: a.url, prompt: a.prompt, provider: a.provider, created: a.created_at }));

    case 'view_asset': {
      const { asset, buf } = readAssetBytes(input.assetId);
      if (asset.kind !== 'image' || asset.mime === 'image/svg+xml') return { error: 'Solo se pueden ver imágenes PNG/JPG/WebP' };
      if (buf.length > 4_500_000) return { error: 'Imagen demasiado grande para revisarla' };
      return { __content: [{ type: 'image', source: { type: 'base64', media_type: asset.mime, data: buf.toString('base64') } }, { type: 'text', text: `Asset ${asset.id} (${asset.prompt || 'sin prompt'})` }] };
    }

    case 'generate_image': {
      const [width, height] = PURPOSE_SIZES[input.purpose] || PURPOSE_SIZES.symbol;
      ctx.emit('progress', { agent, message: `Generando imagen (${input.purpose})…` });
      const buf = await veniceGenerate({ prompt: input.prompt, negativePrompt: input.negativePrompt, width, height, seed: input.seed });
      return imageAsset(ctx, agent, buf, { prompt: input.prompt, provider: 'venice', purpose: input.purpose, assignTo: input.assignTo, removeBackground: input.removeBackground });
    }

    case 'edit_image': {
      const { buf } = readAssetBytes(input.assetId);
      ctx.emit('progress', { agent, message: 'Editando imagen…' });
      const out = await veniceEdit({ image: buf, prompt: input.prompt });
      return imageAsset(ctx, agent, out, { prompt: input.prompt, provider: 'venice-edit', parentId: input.assetId, purpose: 'edit', assignTo: input.assignTo, removeBackground: input.removeBackground });
    }

    case 'remove_background': {
      const { buf } = readAssetBytes(input.assetId);
      const out = await veniceRemoveBackground({ image: buf });
      return imageAsset(ctx, agent, out, { prompt: 'background removed', provider: 'venice-bg', parentId: input.assetId, purpose: 'edit', assignTo: input.assignTo });
    }

    case 'upscale_image': {
      const { buf } = readAssetBytes(input.assetId);
      const out = await veniceUpscale({ image: buf, scale: input.scale || 2 });
      return imageAsset(ctx, agent, out, { prompt: `upscale x${input.scale || 2}`, provider: 'venice-upscale', parentId: input.assetId, purpose: 'edit', assignTo: input.assignTo });
    }

    case 'generate_sound': {
      ctx.emit('progress', { agent, message: `Generando sonido "${input.slot}"…` });
      const buf = await elevenSoundEffect({ text: input.prompt, durationSeconds: input.durationSeconds, loop: input.loop });
      const a = saveAsset(buf, { gameId: ctx.gameId, kind: 'sound', mime: 'audio/mpeg', provider: 'elevenlabs', prompt: input.prompt, meta: { slot: input.slot }, actor: `agent:${agent}` });
      ctx.emit('asset_created', { agent, asset: { id: a.id, url: a.url, kind: 'sound', prompt: input.prompt } });
      assign(ctx, agent, `sounds.${input.slot}`, a.url, `Sonido ${input.slot}`);
      return { assetId: a.id, url: a.url, assigned: `sounds.${input.slot}` };
    }

    case 'generate_music': {
      ctx.emit('progress', { agent, message: 'Componiendo música (puede tardar un minuto)…' });
      const buf = await elevenMusic({ prompt: input.prompt, lengthMs: Math.round((input.lengthSeconds || 45) * 1000) });
      const a = saveAsset(buf, { gameId: ctx.gameId, kind: 'sound', mime: 'audio/mpeg', provider: 'elevenlabs-music', prompt: input.prompt, meta: { slot: input.slot }, actor: `agent:${agent}` });
      ctx.emit('asset_created', { agent, asset: { id: a.id, url: a.url, kind: 'sound', prompt: input.prompt } });
      assign(ctx, agent, `sounds.${input.slot}`, a.url, `Música ${input.slot}`);
      return { assetId: a.id, url: a.url, assigned: `sounds.${input.slot}` };
    }

    case 'simulate_rtp': {
      const c = getDraft(ctx.gameId);
      const errs = validateConfig(c);
      if (errs.length) return { error: 'Configuración inválida', details: errs };
      ctx.emit('progress', { agent, message: 'Simulando RTP…' });
      const sim = await simulateAsync(c, { spins: Math.min(input.spins || 300_000, 2_000_000), mode: input.mode || 'base', seed: Date.now() & 0xffffff, timeBudgetMs: 45_000 });
      return { ...sim, rtpTarget: c.rtpTarget };
    }

    case 'tune_rtp': {
      const c = getDraft(ctx.gameId);
      const errs = validateConfig(c);
      if (errs.length) return { error: 'Configuración inválida', details: errs };
      ctx.emit('progress', { agent, message: 'Ajustando la tabla de pagos al RTP objetivo…' });
      const target = input.target || c.rtpTarget;
      if (!(target >= 0.85 && target <= 1.10)) return { error: 'El objetivo debe estar entre 0.85 y 1.10 (85 % a 110 %)' };
      c.rtpTarget = target;
      const { config: tuned, history, final, buy } = await tuneAsync(c, { target, spins: 400_000 });
      saveDraft(ctx.gameId, tuned, `agent:${agent}`);
      ctx.emit('config_changed', { agent, ops: [{ path: 'symbols.*.pays', value: '(escalado)' }], reason: `RTP ajustado a ${target}` });
      return { history, final: { rtp: final.rtp, ci: [final.rtpLow, final.rtpHigh], hitFrequency: final.hitFrequency, featureEvery: final.featureEvery, volatility: final.volatility }, buy };
    }

    case 'resize_grid': {
      const c = getDraft(ctx.gameId);
      ctx.emit('progress', { agent, message: 'Cambiando el tamaño y reajustando el RTP…' });
      try {
        const t = await resizeAsync(c, { reels: input.reels, rows: input.rows, lines: input.lines, spins: 300_000 });
        saveDraft(ctx.gameId, t.config, `agent:${agent}`);
        ctx.emit('config_changed', { agent, ops: [{ path: 'grid', value: t.config.grid }, { path: 'rules.lines', value: t.config.rules.lines }], reason: 'Cambio de cuadrícula' });
        return { grid: t.config.grid, lines: t.config.rules.lines ?? null, maxLines: t.maxLines, rtp: t.final.rtp, ci: [t.final.rtpLow, t.final.rtpHigh], hitFrequency: t.final.hitFrequency, volatility: t.final.volatility, buy: t.buy };
      } catch (e) {
        return { error: e.message };
      }
    }

    case 'engine_info': {
      const c = getDraft(ctx.gameId);
      const e = ENGINES[c.engine];
      return { engine: e.id, name: e.name, description: e.description, modes: e.modes || ['base'], rulesDoc: RULES_DOC[e.id] };
    }

    default: throw new HttpError(400, `Herramienta desconocida: ${name}`);
  }
}

export const RULES_DOC = {
  'reel-rush': 'Pagos en múltiplos de la apuesta total por cada "way". rules.cascadeMultipliers: multiplicador por cascada (1ª, 2ª…, el último se repite). rules.maxWin: premio máximo en múltiplos de apuesta.',
  megaways: 'Pagos por way en múltiplos de la apuesta total (muy pequeños porque hay hasta 117.649 ways). rules.rowWeights: probabilidad de 2..7 filas por rodillo. rules.scattersToTrigger, rules.freeSpins {nºscatters: giros}, rules.retrigger, rules.fsMultiplierStep (+x por giro ganador).',
  'bonus-buy': 'Pagos en múltiplos de la apuesta POR LÍNEA (apuesta/rules.lines). rules.freeSpins {3,4,5 scatters}, rules.fsMultiplier, rules.retrigger, rules.maxFreeSpins, rules.buyCost (precio de compra en múltiplos de apuesta; tune_rtp lo recalcula). freeSpinReels: tiras usadas en giros gratis. rules.bonusMenu: menú de compra con sticky {enabled, freeSpins, multiplier}, wheel {enabled, spins, multStep, segments [{value, weight}]} y pick {enabled, picks, tiles, prizes [{value, weight}]}; cada uno con cost (tune_rtp recalcula todos los precios).',
  'hold-win': 'Líneas: pagos en múltiplos de la apuesta por línea. rules.triggerCount monedas activan el bonus, rules.respins, rules.landChance (probabilidad de moneda por celda y re-giro), rules.coinValues (valores en múltiplos de apuesta o jackpot), rules.jackpots {mini, minor, major, grand}. Monedas especiales en el bonus: rules.specialChance (probabilidad por moneda) y rules.specialCoins [{special: "multiplier", mult, weight} | {special: "respin", weight}].',
  'cluster-pays': 'Paga por grupos conectados (horizontal/vertical) de rules.minCluster o más; pays por niveles de tamaño {5,6,...,20} (se usa el mayor nivel ≤ tamaño) en múltiplos de la apuesta total. Cascadas con rules.cascadeMultipliers. Cuadrícula 5-8 × 5-8.',
  'scatter-pays': 'Paga con N iguales en cualquier posición; pays por niveles {8,10,12} (mayor nivel ≤ cantidad) en múltiplos de apuesta total. Cascadas. Símbolo multiplier con rules.multiplierValues [{value, weight}]: al final de las cascadas, si hubo premio, se suman y multiplican. Scatter: scatterPays {4,5,6} y rules.scattersToTrigger → rules.freeSpins donde los multiplicadores se acumulan. rules.buyCost (compra de giros gratis).',
  'expanding-symbol': 'Líneas (pagos por apuesta de línea). Símbolo wildscatter (libro) = comodín + scatter (scatterPays en múltiplos de apuesta total). rules.scattersToTrigger → rules.freeSpins con símbolo especial elegido por rules.expandWeights [{symbol, weight}]: si aparece en suficientes rodillos (mínimo = menor clave de sus pays) se expande y paga pays[nº rodillos] × apuesta total.',
  'sticky-wilds': 'Líneas. rules.wildMode "sticky" (comodines fijos en giros gratis) o "walking" (cada comodín da re-giro y se mueve un rodillo a la izquierda). rules.scattersToTrigger → rules.freeSpins, rules.fsMultiplier, rules.retrigger. Scatter con scatterPays.',
  'megaways-cascade': 'Megaways con cascadas: el multiplicador sube rules.cascadeStep (+0,5) por cascada. Símbolos mystery se revelan todos como el mismo símbolo (rules.mysteryWeights). rules.scattersToTrigger → rules.freeSpins (+rules.extraSpinsPerScatter por scatter extra); rules.fsKeepMultiplier = el multiplicador no se reinicia entre giros gratis.',
  'colossal-reels': 'Ways 5x4: pagos en múltiplos de la apuesta total por way. rules.colossalChance, rules.colossalSizes, rules.colossalSymbols, rules.freeSpins (colosal garantizado en giros gratis).',
};
