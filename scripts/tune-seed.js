// Genera las configuraciones iniciales de los 5 juegos con el RTP ajustado al objetivo.
// Uso: node scripts/tune-seed.js   → escribe backend/games/seed/<engine>.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { ENGINES, tuneRtp } from '../backend/math/index.js';

const out = new URL('../backend/games/seed/', import.meta.url);
mkdirSync(out, { recursive: true });
// Uso: node scripts/tune-seed.js [motor1 motor2 …]  (sin argumentos = todos)
const only = process.argv.slice(2);
for (const e of Object.values(ENGINES).filter((x) => !only.length || only.includes(x.id))) {
  const t0 = Date.now();
  const { config, final, buy, buyOptions, history } = tuneRtp(e.defaults(), { spins: Number(process.env.SPINS) || 2_000_000, iterations: 4 });
  config.id = e.id;
  config.math = { rtp: final.rtp, ci: [final.rtpLow, final.rtpHigh], hitFrequency: final.hitFrequency, featureEvery: final.featureEvery, volatility: final.volatility, buy, buyOptions };
  writeFileSync(new URL(`${e.id}.json`, out), JSON.stringify(config, null, 2));
  console.log(e.id, history.map((h) => h.rtp).join(' → '), '| final', final.rtp, final.rtpLow, final.rtpHigh, final.volatility, (buyOptions || []).map((b) => `| ${b.mode} ${b.cost}x rtp ${b.rtp}`).join(' '), `${Date.now() - t0}ms`);
}
