'use strict';

const { Pool } = require('pg');

// Each entry runs once, in order, and is recorded in schema_migrations.
// Never edit a released migration; add a new one instead.
const MIGRATIONS = [
  {
    version: 1,
    name: 'directory and auth tables',
    sql: `
CREATE TABLE entities (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE departments (
  id          SERIAL PRIMARY KEY,
  entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_id, name_key)
);
CREATE TABLE focal_points (
  id            SERIAL PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  title         TEXT NOT NULL,
  email         TEXT NOT NULL,
  email_key     TEXT NOT NULL,
  remarks       TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_departments_entity ON departments(entity_id);
CREATE INDEX idx_focal_points_department ON focal_points(department_id);
CREATE INDEX idx_focal_points_email ON focal_points(email_key);

CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL,
  username_key   TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
`,
  },
];

// Uniqueness and search ignore case, surrounding spaces and Unicode form,
// so "Finance", " finance " and differently-composed Arabic text collide.
function key(text) {
  return String(text).normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function createPool(connectionString = process.env.DATABASE_URL, { schema } = {}) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Add a PostgreSQL database and set DATABASE_URL (see docs/DEPLOYMENT.md).');
  }
  return new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX) || 10,
    // Tests run each suite in its own schema.
    options: schema ? `-c search_path=${schema}` : undefined,
  });
}

async function migrate(pool) {
  const client = await pool.connect();
  try {
    // Serialise migrations if two instances start at once.
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const done = new Set(rows.map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}

module.exports = { createPool, migrate, key, MIGRATIONS };
