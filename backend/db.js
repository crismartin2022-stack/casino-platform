// Base de datos SQLite integrada en Node (node:sqlite). En Railway monta un Volume en /data.
// Guarda juegos y versiones, jugadores, sesiones, rondas auditables, transacciones, assets y agentes.
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

export const db = new DatabaseSync(process.env.DB_PATH || `${DATA_DIR}/casino.db`);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  name TEXT NOT NULL,
  draft TEXT NOT NULL,
  draft_updated_at TEXT NOT NULL,
  published_version INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS game_versions (
  game_id TEXT NOT NULL REFERENCES games(id),
  version INTEGER NOT NULL,
  config TEXT NOT NULL,
  math_hash TEXT NOT NULL,
  math TEXT,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, version)
);
CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  wallet_mode TEXT NOT NULL DEFAULT 'internal',
  wallet_url TEXT,
  wallet_secret TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  operator_id TEXT,
  external_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  balance INTEGER NOT NULL DEFAULT 0,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (operator_id, external_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  mode TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'published',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  client_round_id TEXT,
  session_token TEXT NOT NULL,
  player_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  version INTEGER,
  source TEXT NOT NULL,
  mode TEXT NOT NULL,
  play_mode TEXT NOT NULL,
  bet INTEGER NOT NULL,
  cost INTEGER NOT NULL,
  win INTEGER NOT NULL DEFAULT 0,
  balance_before INTEGER,
  balance_after INTEGER,
  status TEXT NOT NULL,
  rng TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_token, client_round_id)
);
CREATE INDEX IF NOT EXISTS rounds_player ON rounds(player_id, created_at);
CREATE INDEX IF NOT EXISTS rounds_game ON rounds(game_id, created_at);
CREATE INDEX IF NOT EXISTS rounds_status ON rounds(status);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  round_id TEXT,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER,
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tx_player ON transactions(player_id, created_at);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  filename TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  provider TEXT,
  prompt TEXT,
  parent_id TEXT,
  meta TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS assets_game ON assets(game_id, created_at);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  messages TEXT,
  summary TEXT,
  usage TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS agent_events_run ON agent_events(run_id, id);
CREATE TABLE IF NOT EXISTS table_state (
  session_token TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Progreso del jugador en juegos con niveles (Level Up): uno por jugador + juego + apuesta
CREATE TABLE IF NOT EXISTS player_progress (
  player_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  bet INTEGER NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, game_id, bet)
);
-- Mesas en vivo (dados con crupier): estado compartido de la mesa y cada tirada del crupier
CREATE TABLE IF NOT EXISTS live_tables (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS live_rolls (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  version INTEGER,
  dice TEXT NOT NULL,
  rng TEXT NOT NULL,
  phase_before TEXT,
  point_before INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_rolls_game ON live_rolls(game_id, created_at);
CREATE TABLE IF NOT EXISTS operator_users (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  password_hash TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS operator_user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES operator_users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS operator_games (
  operator_id TEXT NOT NULL REFERENCES operators(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  rtp_target REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (operator_id, game_id)
);
CREATE TABLE IF NOT EXISTS rtp_variants (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  rtp_target REAL NOT NULL,
  base_math_hash TEXT NOT NULL,
  result_math_hash TEXT,
  overlay TEXT,
  math TEXT,
  status TEXT NOT NULL DEFAULT 'building',
  error TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS rtp_variants_game ON rtp_variants(game_id, base_math_hash, rtp_target);
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo TEXT,
  tagline TEXT,
  color TEXT,
  bg TEXT,
  bg_image TEXT,
  loader TEXT NOT NULL DEFAULT 'bar',
  min_ms INTEGER NOT NULL DEFAULT 1500,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS game_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  version INTEGER,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  report TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_game_checks_game ON game_checks(game_id, id);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migraciones de columnas nuevas sobre bases existentes (idempotentes).
for (const [table, col, def] of [
  ['operators', 'can_create_games', 'INTEGER NOT NULL DEFAULT 0'],
  ['operators', 'max_games', 'INTEGER NOT NULL DEFAULT 0'],
  ['operators', 'can_use_agents', 'INTEGER NOT NULL DEFAULT 0'],
  ['operators', 'bet_limits', 'TEXT'],
  ['games', 'owner_operator_id', 'TEXT'],
  ['sessions', 'variant_id', 'TEXT'],
  ['rounds', 'variant_id', 'TEXT'],
  ['games', 'brand_id', 'TEXT'],
  ['brands', 'font', 'TEXT'],
  ['brands', 'font_url', 'TEXT'],
]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
db.exec('CREATE INDEX IF NOT EXISTS players_operator ON players(operator_id, created_at)');

/** Ejecuta fn dentro de una transacción SQLite (BEGIN IMMEDIATE para serializar escrituras). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function audit(actor, action, target, details) {
  run('INSERT INTO audit_log (actor, action, target, details) VALUES (?, ?, ?, ?)',
    actor, action, target ?? null, details == null ? null : JSON.stringify(details));
}
