// Clientes HTTP de los proveedores de IA (sin SDKs, solo fetch).
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';

function need(key, name, envVar) {
  if (!key) throw new HttpError(503, `${name} no está configurado. Añade ${envVar} en las variables de Railway.`);
}

async function failIfBad(res, provider) {
  if (res.ok) return;
  let detail = '';
  try { detail = (await res.text()).slice(0, 500); } catch { /* sin cuerpo */ }
  throw new HttpError(res.status === 402 ? 402 : 502, `${provider} respondió ${res.status}: ${detail}`);
}

/** Si la respuesta es JSON con base64 (images[0] / image / data), la decodifica; si es binaria, la devuelve. */
async function imageFromResponse(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const j = await res.json();
    const b64 = j.images?.[0] || j.image || j.data?.[0]?.b64_json;
    if (!b64) throw new HttpError(502, 'Respuesta de imagen vacía');
    return Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64');
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---------------- Anthropic (Claude) ----------------
export async function claudeMessages({ system, messages, tools, model = config.anthropic.model, maxTokens = config.anthropic.maxTokens }) {
  need(config.anthropic.apiKey, 'Claude (Anthropic)', 'ANTHROPIC_API_KEY');
  const body = {
    model, max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  };
  if (tools?.length) {
    body.tools = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.anthropic.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 3) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    await failIfBad(res, 'Claude');
    return res.json();
  }
  throw new HttpError(502, 'Claude no respondió tras varios intentos');
}

// ---------------- Venice (imágenes) ----------------
const VENICE = 'https://api.venice.ai/api/v1';
const PIXEL_MODELS = /sd35|hidream|lustify|flux-dev|pony|fluently/i;

function aspectFor(w, h) {
  const r = w / h;
  const options = [['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4], ['3:2', 1.5], ['2:3', 2 / 3], ['21:9', 21 / 9]];
  return options.reduce((best, o) => (Math.abs(o[1] - r) < Math.abs(best[1] - r) ? o : best))[0];
}

export async function veniceGenerate({ prompt, negativePrompt, width = 1024, height = 1024, model = config.venice.imageModel, seed }) {
  need(config.venice.apiKey, 'Venice', 'VENICE_API_KEY');
  const body = { model, prompt, format: 'png', safe_mode: true, variants: 1 };
  if (PIXEL_MODELS.test(model)) Object.assign(body, { width: Math.min(1280, width), height: Math.min(1280, height) });
  else body.aspect_ratio = aspectFor(width, height);
  if (negativePrompt) body.negative_prompt = negativePrompt;
  if (Number.isInteger(seed)) body.seed = seed;
  const res = await fetch(`${VENICE}/image/generate`, {
    method: 'POST', headers: { authorization: `Bearer ${config.venice.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
  });
  await failIfBad(res, 'Venice');
  return imageFromResponse(res);
}

export async function veniceEdit({ image, prompt, model = config.venice.editModel, aspectRatio = 'auto' }) {
  need(config.venice.apiKey, 'Venice', 'VENICE_API_KEY');
  const res = await fetch(`${VENICE}/image/edit`, {
    method: 'POST', headers: { authorization: `Bearer ${config.venice.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, image: image.toString('base64'), output_format: 'png', aspect_ratio: aspectRatio }),
    signal: AbortSignal.timeout(240_000),
  });
  await failIfBad(res, 'Venice');
  return imageFromResponse(res);
}

export async function veniceRemoveBackground({ image }) {
  need(config.venice.apiKey, 'Venice', 'VENICE_API_KEY');
  const res = await fetch(`${VENICE}/image/background-remove`, {
    method: 'POST', headers: { authorization: `Bearer ${config.venice.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ image: image.toString('base64') }), signal: AbortSignal.timeout(120_000),
  });
  await failIfBad(res, 'Venice');
  return imageFromResponse(res);
}

export async function veniceUpscale({ image, scale = 2 }) {
  need(config.venice.apiKey, 'Venice', 'VENICE_API_KEY');
  const res = await fetch(`${VENICE}/image/upscale`, {
    method: 'POST', headers: { authorization: `Bearer ${config.venice.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ image: image.toString('base64'), scale }), signal: AbortSignal.timeout(180_000),
  });
  await failIfBad(res, 'Venice');
  return imageFromResponse(res);
}

// ---------------- ElevenLabs (sonido) ----------------
const ELEVEN = 'https://api.elevenlabs.io/v1';

export async function elevenSoundEffect({ text, durationSeconds, loop = false, promptInfluence = 0.4 }) {
  need(config.elevenlabs.apiKey, 'ElevenLabs', 'ELEVENLABS_API_KEY');
  const body = { text, model_id: 'eleven_text_to_sound_v2', prompt_influence: promptInfluence, loop };
  if (durationSeconds) body.duration_seconds = Math.min(30, Math.max(0.5, durationSeconds));
  const res = await fetch(`${ELEVEN}/sound-generation?output_format=${config.elevenlabs.outputFormat}`, {
    method: 'POST', headers: { 'xi-api-key': config.elevenlabs.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
  });
  await failIfBad(res, 'ElevenLabs');
  return Buffer.from(await res.arrayBuffer());
}

export async function elevenMusic({ prompt, lengthMs = 30_000, instrumental = true }) {
  need(config.elevenlabs.apiKey, 'ElevenLabs', 'ELEVENLABS_API_KEY');
  const res = await fetch(`${ELEVEN}/music?output_format=${config.elevenlabs.outputFormat}`, {
    method: 'POST', headers: { 'xi-api-key': config.elevenlabs.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, music_length_ms: Math.min(600_000, Math.max(3000, lengthMs)), model_id: config.elevenlabs.musicModel, force_instrumental: instrumental }),
    signal: AbortSignal.timeout(300_000),
  });
  await failIfBad(res, 'ElevenLabs');
  return Buffer.from(await res.arrayBuffer());
}
