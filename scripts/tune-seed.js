// Genera las configuraciones iniciales de los 5 juegos con el RTP ajustado al objetivo.
// Uso: node scripts/tune-seed.js   → escribe backend/games/seed/<engine>.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { ENGINES, tuneRtp } from '../backend/math/index.js';

const out = new URL('../backend/games/seed/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const e of Object.values(ENGINES)) {
  const t0 = Date.now();
  const { config, final, buy, history } = tuneRtp(e.defaults(), { spins: 2_000_000, iterations: 4 });
  config.id = e.id;
  config.math = { rtp: final.rtp, ci: [final.rtpLow, final.rtpHigh], hitFrequency: final.hitFrequency, featureEvery: final.featureEvery, volatility: final.volatility, buy };
  writeFileSync(new URL(`${e.id}.json`, out), JSON.stringify(config, null, 2));
  console.log(e.id, history.map((h) => h.rtp).join(' → '), '| final', final.rtp, final.rtpLow, final.rtpHigh, final.volatility, buy ? `| compra ${buy.buyCost}x rtp ${buy.rtp}` : '', `${Date.now() - t0}ms`);
}
