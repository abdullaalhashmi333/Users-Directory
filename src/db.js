'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (entity_id, name_key)
);
CREATE TABLE IF NOT EXISTS focal_points (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  title         TEXT NOT NULL,
  email         TEXT NOT NULL,
  email_key     TEXT NOT NULL,
  remarks       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_departments_entity ON departments(entity_id);
CREATE INDEX IF NOT EXISTS idx_focal_points_department ON focal_points(department_id);
CREATE INDEX IF NOT EXISTS idx_focal_points_email ON focal_points(email_key);
`;

// Uniqueness and search ignore case, surrounding spaces and Unicode form,
// so "Finance", " finance " and differently-composed Arabic text collide.
function key(text) {
  return String(text).normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function defaultDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'directory.db');
  }
  return path.join(__dirname, '..', 'data', 'directory.db');
}

function openDb(dbPath = defaultDbPath()) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb, key, defaultDbPath };
