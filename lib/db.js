import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CATALOG, CATEGORIES, BIKE_MODELS, PART_BRANDS, PART_PRESETS, DEFAULT_SETTINGS, BIKE_CLASSES } from './seed-data.js';
import { hashPassword } from './auth.js';

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'torque-nation.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, summary TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS catalog (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, summary TEXT, includes TEXT DEFAULT '[]',
  prices TEXT NOT NULL, hours TEXT, sac TEXT, from_price INTEGER DEFAULT 0, public INTEGER DEFAULT 1, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bike_models (id INTEGER PRIMARY KEY, brand TEXT NOT NULL, model TEXT NOT NULL, class TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS part_presets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, hsn TEXT, gst REAL DEFAULT 18, unit TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, logo TEXT, published INTEGER DEFAULT 1, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, doc_type TEXT NOT NULL CHECK (doc_type IN ('estimate','invoice')),
  number TEXT UNIQUE NOT NULL, fy TEXT NOT NULL, seq INTEGER NOT NULL, date TEXT NOT NULL,
  customer TEXT NOT NULL, vehicle TEXT NOT NULL, items TEXT NOT NULL, options TEXT NOT NULL, totals TEXT NOT NULL,
  notes TEXT, payment TEXT NOT NULL, status TEXT NOT NULL, source_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_date ON documents(date);
CREATE TABLE IF NOT EXISTS portfolio (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, bike TEXT, summary TEXT, work TEXT DEFAULT '[]', images TEXT DEFAULT '[]',
  published INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, bike TEXT, service TEXT, preferred_date TEXT,
  message TEXT, status TEXT DEFAULT 'new', created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---- Seed on first run -----------------------------------------------------
function seed() {
  const has = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (has) return;
  db.exec('BEGIN');
  try {
    const setS = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setS.run(k, JSON.stringify(v));
    setS.run('bike_classes', JSON.stringify(BIKE_CLASSES));

    const cat = db.prepare('INSERT INTO categories (id, name, summary, sort) VALUES (?, ?, ?, ?)');
    CATEGORIES.forEach((c, i) => cat.run(c.id, c.name, c.summary, i));

    const item = db.prepare(`INSERT INTO catalog (id, category, name, summary, includes, prices, hours, sac, from_price, public, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    CATALOG.forEach((c, i) => item.run(c.id, c.category, c.name, c.summary, JSON.stringify(c.includes), JSON.stringify(c.prices), c.hours, c.sac, c.from ? 1 : 0, c.public ? 1 : 0, i));

    const bike = db.prepare('INSERT INTO bike_models (brand, model, class) VALUES (?, ?, ?)');
    BIKE_MODELS.forEach(([b, m, k]) => bike.run(b, m, k));

    const pp = db.prepare('INSERT INTO part_presets (name, hsn, gst, unit, sort) VALUES (?, ?, ?, ?, ?)');
    PART_PRESETS.forEach((p, i) => pp.run(p.name, p.hsn, p.gst, p.unit, i));

    const br = db.prepare('INSERT INTO brands (name, category, published, sort) VALUES (?, ?, ?, ?)');
    PART_BRANDS.forEach(([n, c, p], i) => br.run(n, c, p, i));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
seed();

// ---- First admin user ------------------------------------------------------
export function ensureAdmin() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (n) return;
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run(username, hashPassword(password));
  if (!process.env.ADMIN_PASSWORD) {
    const file = join(DATA_DIR, 'first-run-credentials.txt');
    writeFileSync(file, `Torque Nation admin\nusername: ${username}\npassword: ${password}\n\nLog in at /admin, change the password in Settings, then delete this file.\n`, { mode: 0o600 });
    console.log(`\n  First run: admin account created. Credentials written to ${file}\n`);
  }
}

// ---- Helpers ---------------------------------------------------------------
export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out;
}

export function saveSettings(patch) {
  const allowed = new Set([...Object.keys(DEFAULT_SETTINGS), 'bike_classes']);
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) if (allowed.has(k)) stmt.run(k, JSON.stringify(v));
}

export function rowToCatalog(r) {
  return { ...r, includes: JSON.parse(r.includes || '[]'), prices: JSON.parse(r.prices), from: !!r.from_price, public: !!r.public };
}

export function getCatalog({ publicOnly = false } = {}) {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort, name').all();
  const items = db.prepare(`SELECT * FROM catalog ${publicOnly ? 'WHERE public = 1' : ''} ORDER BY sort, name`).all().map(rowToCatalog);
  return { categories: cats, items };
}

export function rowToDoc(r) {
  if (!r) return null;
  return {
    ...r,
    customer: JSON.parse(r.customer), vehicle: JSON.parse(r.vehicle), items: JSON.parse(r.items),
    options: JSON.parse(r.options), totals: JSON.parse(r.totals), payment: JSON.parse(r.payment),
  };
}

export function rowToPortfolio(r) {
  return { ...r, work: JSON.parse(r.work || '[]'), images: JSON.parse(r.images || '[]'), published: !!r.published };
}
