// Connexion PostgreSQL (serveur uniquement) + création idempotente du schéma et de l'admin initial.
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { DEFAULT_SETTINGS } from "../types";
import { DEFAULT_USER_VISIBLE } from "../settings-meta";
import { hashPassword } from "./password";

const g = globalThis as unknown as { __pgPool?: Pool; __schemaReady?: Promise<void> };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant : copiez .env.example en .env.local et renseignez la connexion PostgreSQL.");
  return url;
}

export function pool(): Pool {
  if (!g.__pgPool) g.__pgPool = new Pool({ connectionString: databaseUrl(), max: 10 });
  return g.__pgPool;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  password_hash        TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_login_at        TIMESTAMPTZ,
  password_changed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,               -- empreinte SHA-256 du jeton (le jeton n'est jamais stocké)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS app_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  setting_values JSONB NOT NULL,
  user_visible  JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS optimizations (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  label            TEXT NOT NULL,
  files            JSONB NOT NULL,
  period_start     DATE,
  period_end       DATE,
  agents           INTEGER NOT NULL,
  vehicles_before  INTEGER NOT NULL,
  vehicles_after   INTEGER NOT NULL,
  swaps            INTEGER NOT NULL,
  swaps_off        INTEGER NOT NULL,
  swaps_reserve    INTEGER NOT NULL,
  duration_ms      INTEGER NOT NULL,
  settings         JSONB NOT NULL,
  result_gz        BYTEA NOT NULL              -- résultat complet (JSON compressé) : contient des noms d'agents
);
CREATE INDEX IF NOT EXISTS optimizations_user_idx ON optimizations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS optimizations_created_idx ON optimizations(created_at DESC);
`;

/** Crée les tables (si besoin), les réglages par défaut et l'admin initial (si aucun admin n'existe). */
export async function initSchema(client: Pool | PoolClient = pool()): Promise<{ adminCreated: string | null }> {
  await client.query(SCHEMA_SQL);
  await client.query(
    `INSERT INTO app_settings (id, setting_values, user_visible) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(DEFAULT_SETTINGS), JSON.stringify(DEFAULT_USER_VISIBLE)]
  );
  const admins = await client.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
  if (admins.rowCount) return { adminCreated: null };
  const username = (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "Admin@2026!";
  await client.query(
    `INSERT INTO users (username, display_name, role, password_hash, must_change_password)
     VALUES ($1, $2, 'admin', $3, TRUE)
     ON CONFLICT (username) DO UPDATE SET role = 'admin', active = TRUE`,
    [username, "Administrateur", await hashPassword(password)]
  );
  return { adminCreated: username };
}

/** À appeler avant toute requête applicative : le schéma n'est vérifié qu'une fois par processus. */
export function ensureSchema(): Promise<void> {
  if (!g.__schemaReady)
    g.__schemaReady = initSchema().then(
      () => undefined,
      (e) => {
        g.__schemaReady = undefined; // on réessaiera au prochain appel
        throw e;
      }
    );
  return g.__schemaReady;
}

export async function q<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  const r = await pool().query<T>(sql, params);
  return r.rows;
}

export async function q1<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}
