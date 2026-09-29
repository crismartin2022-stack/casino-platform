// Simula Claude, Venice y ElevenLabs para probar el sistema de agentes sin gastar créditos.
const realFetch = globalThis.fetch;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]);
let n = 0;
const tool = (name, input) => ({ type: 'tool_use', id: `tu_${++n}`, name, input });
const reply = (content, stop = 'tool_use') => new Response(JSON.stringify({ content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 } }), { headers: { 'content-type': 'application/json' } });
function lastToolResults(messages) { const m = messages[messages.length - 1]; return Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : []; }
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.anthropic.com/v1/messages')) {
    const body = JSON.parse(opts.body);
    const sys = body.system[0].text;
    const turns = body.messages.filter((m) => m.role === 'assistant').length;
    const tools = body.tools.map((t) => t.name);
    const firstUser = body.messages[0];
    const hasImage = Array.isArray(firstUser?.content) && firstUser.content.some((b) => b.type === 'image');
    const refIds = hasImage ? (JSON.stringify(firstUser.content).match(/as_[A-Za-z0-9_-]+/g) || []) : [];
    // Caso con imágenes de referencia: el director las pasa al artista, que confirma que las ve
    if (hasImage && sys.includes('Eres el DIRECTOR')) {
      if (turns === 0) return reply([tool('delegate', { agent: 'artist', task: 'Usa la referencia', referenceImages: [...new Set(refIds)] })]);
      return reply([{ type: 'text', text: 'Referencia aplicada.' }], 'end_turn');
    }
    if (hasImage && sys.includes('Eres el ARTISTA')) return reply([{ type: 'text', text: 'VI_LA_IMAGEN' }], 'end_turn');
    if (sys.includes('Eres el DIRECTOR')) {
      const script = [
        () => reply([{ type: 'text', text: 'Voy a coordinar el rediseño.' }, tool('get_game_config', { section: 'symbols' })]),
        () => reply([tool('delegate', { agent: 'artist', task: 'Genera el símbolo cherry estilo neón' })]),
        () => reply([tool('delegate', { agent: 'sound', task: 'Sonido de premio arcade' })]),
        () => reply([tool('delegate', { agent: 'math', task: 'Ajusta el RTP a 0.955' })]),
        () => reply([{ type: 'text', text: 'Listo: nuevo símbolo, sonido y RTP 95,5 %.' }], 'end_turn'),
      ];
      const k = turns % script.length;
      return script[k]();
    }
    if (sys.includes('Eres el ARTISTA')) {
      const r = lastToolResults(body.messages);
      if (turns === 0) return reply([tool('generate_image', { prompt: 'neon cherry', purpose: 'symbol', removeBackground: true, assignTo: 'symbols.cherry.image' })]);
      if (turns === 1) { const id = JSON.parse(r[0].content).assetId; return reply([tool('view_asset', { assetId: id })]); }
      if (turns === 2) { if (!Array.isArray(r[0].content) || r[0].content[0].type !== 'image') throw new Error('view_asset no devolvió imagen'); return reply([tool('update_config', { ops: [{ op: 'set', path: 'rules.maxWin', value: 99999 }], reason: 'intento indebido' })]); }
      if (turns === 3) { if (!r[0].is_error) throw new Error('El artista pudo tocar la matemática'); return reply([{ type: 'text', text: 'Símbolo listo.' }], 'end_turn'); }
    }
    if (sys.includes('Eres el DISEÑADOR DE SONIDO')) {
      if (turns === 0) return reply([tool('generate_sound', { prompt: 'arcade win jingle', slot: 'win', durationSeconds: 1.5 })]);
      return reply([{ type: 'text', text: 'Sonido listo.' }], 'end_turn');
    }
    if (sys.includes('Eres el MATEMÁTICO')) {
      if (turns === 0) return reply([tool('tune_rtp', { target: 0.955 })]);
      if (turns === 1) return reply([tool('simulate_rtp', { spins: 100000 })]);
      return reply([{ type: 'text', text: 'RTP ajustado.' }], 'end_turn');
    }
    throw new Error('mock: agente inesperado ' + sys.slice(0, 80));
  }
  if (u.startsWith('https://api.venice.ai/api/v1/image/generate')) return new Response(JSON.stringify({ images: [PNG.toString('base64')] }), { headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://api.venice.ai/api/v1/image/')) return new Response(PNG, { headers: { 'content-type': 'image/png' } });
  if (u.startsWith('https://api.elevenlabs.io/')) return new Response(MP3, { headers: { 'content-type': 'audio/mpeg' } });
  return realFetch(url, opts);
};
