// Configuración por variables de entorno (Railway → Variables).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const env = process.env;

export const ROOT = resolve(new URL('..', import.meta.url).pathname);
export const DATA_DIR = resolve(env.DATA_DIR || (env.RAILWAY_VOLUME_MOUNT_PATH ?? `${ROOT}/data`));
mkdirSync(`${DATA_DIR}/media`, { recursive: true });

const generatedAdmin = randomBytes(18).toString('base64url');

export const config = {
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '')).replace(/\/$/, ''),
  adminToken: env.ADMIN_TOKEN || generatedAdmin,
  adminTokenGenerated: !env.ADMIN_TOKEN,
  demoBalanceCents: Number(env.DEMO_BALANCE_CENTS || 100_000),
  sessionTtlHours: Number(env.SESSION_TTL_HOURS || 12),
  corsOrigins: (env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
  publishMaxRtpDeviation: Number(env.PUBLISH_MAX_RTP_DEVIATION || 0.01),
  publishSimSpins: Number(env.PUBLISH_SIM_SPINS || 500_000),
  // Certificación al publicar: se simula hasta lograr esta precisión del RTP (±) o agotar el tiempo
  publishPrecision: Number(env.PUBLISH_PRECISION || 0.004),
  publishBudgetMs: Number(env.PUBLISH_SIM_BUDGET_MS || 60_000),

  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    directorModel: env.ANTHROPIC_DIRECTOR_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    maxTokens: Number(env.ANTHROPIC_MAX_TOKENS || 4096),
  },
  venice: {
    apiKey: env.VENICE_API_KEY || '',
    imageModel: env.VENICE_IMAGE_MODEL || 'qwen-image-2',
    editModel: env.VENICE_EDIT_MODEL || 'qwen-image-2-edit',
  },
  elevenlabs: {
    apiKey: env.ELEVENLABS_API_KEY || '',
    outputFormat: env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128',
    musicModel: env.ELEVENLABS_MUSIC_MODEL || 'music_v1',
  },
};

export const providers = () => ({
  anthropic: Boolean(config.anthropic.apiKey),
  venice: Boolean(config.venice.apiKey),
  elevenlabs: Boolean(config.elevenlabs.apiKey),
});
