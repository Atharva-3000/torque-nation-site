import { createClient } from '@libsql/client';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CATALOG, CATEGORIES, BIKE_MODELS, PART_BRANDS, PART_PRESETS, DEFAULT_SETTINGS, BIKE_CLASSES } from './seed-data.js';
import { hashPassword } from './auth.js';

// ---- Connection --------------------------------------------------------------
// Production (Vercel): a Turso database, connected from Vercel → Storage, which
// sets TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. Vercel's disk is wiped whenever
// a function instance is recycled, so nothing may be stored on it.
// Local / VPS: a SQLite file in DATA_DIR (default ./data).
const env = process.env;
const findEnv = (test) => Object.entries(env).find(([k, v]) => v && test(k, v))?.[1];
const REMOTE_URL = env.TURSO_DATABASE_URL || env.LIBSQL_URL || findEnv((k, v) => /^libsql:\/\//.test(v));
const AUTH_TOKEN = env.TURSO_AUTH_TOKEN || env.LIBSQL_AUTH_TOKEN || findEnv((k) => /(TURSO|LIBSQL).*AUTH_TOKEN$/.test(k));

export const DATA_DIR = env.DATA_DIR || join(process.cwd(), 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads'); // legacy local uploads (read-only fallback)
export const DB_MISSING = !!env.VERCEL && !REMOTE_URL;

if (!REMOTE_URL && !env.VERCEL) mkdirSync(DATA_DIR, { recursive: true });

const client = DB_MISSING ? null : createClient(
  REMOTE_URL ? { url: REMOTE_URL, authToken: AUTH_TOKEN, intMode: 'number' }
    : { url: 'file:' + join(DATA_DIR, 'torque-nation.db'), intMode: 'number' },
);

function need() {
  if (!client) throw Object.assign(new Error('Database not connected. In Vercel, open the project → Storage, connect a Turso database, then redeploy.'), { status: 503 });
  return client;
}
const clean = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
const toRows = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

// Same shape as node:sqlite's prepare().get/all/run, but every call returns a promise.
export const db = {
  prepare(sql) {
    return {
      get: async (...a) => toRows(await need().execute({ sql, args: clean(a) }))[0],
      all: async (...a) => toRows(await need().execute({ sql, args: clean(a) })),
      run: async (...a) => {
        const r = await need().execute({ sql, args: clean(a) });
        return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
      },
    };
  },
  exec: (sql) => need().executeMultiple(sql),
  // Runs [sql, args] pairs in one transaction: all succeed or none do.
  batch: (stmts) => need().batch(stmts.map(([sql, args = []]) => ({ sql, args: clean(args) })), 'write'),
};

const SCHEMA = `
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
CREATE TABLE IF NOT EXISTS uploads (
  name TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
`;

// ---- Seed on first run -----------------------------------------------------
async function seed() {
  const has = (await db.prepare('SELECT COUNT(*) AS n FROM settings').get()).n;
  if (has) return;
  const s = [];
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) s.push(['INSERT INTO settings (key, value) VALUES (?, ?)', [k, JSON.stringify(v)]]);
  s.push(['INSERT INTO settings (key, value) VALUES (?, ?)', ['bike_classes', JSON.stringify(BIKE_CLASSES)]]);
  CATEGORIES.forEach((c, i) => s.push(['INSERT INTO categories (id, name, summary, sort) VALUES (?, ?, ?, ?)', [c.id, c.name, c.summary, i]]));
  CATALOG.forEach((c, i) => s.push([`INSERT INTO catalog (id, category, name, summary, includes, prices, hours, sac, from_price, public, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [c.id, c.category, c.name, c.summary, JSON.stringify(c.includes), JSON.stringify(c.prices), c.hours, c.sac, c.from ? 1 : 0, c.public ? 1 : 0, i]]));
  BIKE_MODELS.forEach(([b, m, k]) => s.push(['INSERT INTO bike_models (brand, model, class) VALUES (?, ?, ?)', [b, m, k]]));
  PART_PRESETS.forEach((p, i) => s.push(['INSERT INTO part_presets (name, hsn, gst, unit, sort) VALUES (?, ?, ?, ?, ?)', [p.name, p.hsn, p.gst, p.unit, i]]));
  PART_BRANDS.forEach(([n, c, p], i) => s.push(['INSERT INTO brands (name, category, published, sort) VALUES (?, ?, ?, ?)', [n, c, p, i]]));
  try {
    await db.batch(s);
  } catch (e) {
    // Another instance seeded at the same moment: its copy stands, ours rolled back.
    if (!(await db.prepare('SELECT COUNT(*) AS n FROM settings').get()).n) throw e;
  }
}

// ---- Brand logos -------------------------------------------------------------
// A brand with no logo set picks up a file from public/img/brands named after
// it: the full name or its first word, slugged ("HEL Performance" → hel.svg,
// "K&N" → kn.svg, "SW-Motech" → sw-motech.svg). Drop a file in and redeploy.
const BRAND_DIR = join(process.cwd(), 'public', 'img', 'brands');
const slug = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function findBrandLogo(name) {
  const bases = [...new Set([slug(name), slug(name.split(/\s+/)[0])])].filter(Boolean);
  for (const b of bases) for (const ext of ['svg', 'webp', 'png']) {
    if (existsSync(join(BRAND_DIR, `${b}.${ext}`))) return `/img/brands/${b}.${ext}`;
  }
  return null;
}
async function syncBrandLogos() {
  const set = [];
  for (const b of await db.prepare("SELECT id, name FROM brands WHERE logo IS NULL OR logo = ''").all()) {
    const logo = findBrandLogo(b.name);
    if (logo) set.push(['UPDATE brands SET logo = ? WHERE id = ?', [logo, b.id]]);
  }
  if (set.length) await db.batch(set);
}

// ---- First admin user ------------------------------------------------------
// ADMIN_USER / ADMIN_PASSWORD (env) set the first admin. They are only used when
// the database has no users yet; after that, change the password in the admin.
async function ensureAdmin() {
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n;
  if (n) return;
  const username = env.ADMIN_USER || 'admin';
  const password = env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  try {
    await db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run(username, hashPassword(password));
  } catch (e) {
    if ((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n) return; // created by another instance
    throw e;
  }
  if (!env.ADMIN_PASSWORD) {
    if (env.VERCEL || REMOTE_URL) {
      console.error('No ADMIN_PASSWORD set: admin created with a random password. Set one with `npm run reset-password`.');
      return;
    }
    const file = join(DATA_DIR, 'first-run-credentials.txt');
    writeFileSync(file, `Torque Nation admin\nusername: ${username}\npassword: ${password}\n\nLog in at /admin, change the password in Settings, then delete this file.\n`, { mode: 0o600 });
    console.log(`\n  First run: admin account created. Credentials written to ${file}\n`);
  }
}

// Creates tables, seeds and the first admin once per instance. Every request
// awaits this; a failure (e.g. network blip) is retried on the next request.
let readyP = null;
export function ready() {
  return (readyP ??= (async () => {
    await db.exec(SCHEMA);
    await seed();
    await syncBrandLogos();
    await ensureAdmin();
  })().catch((e) => { readyP = null; throw e; }));
}

// ---- Uploaded images ---------------------------------------------------------
// Stored in the database so they survive redeploys and work on any host.
export async function putUpload(name, type, buf) {
  await db.prepare('INSERT INTO uploads (name, type, data) VALUES (?, ?, ?)').run(name, type, new Uint8Array(buf));
}
export async function getUpload(name) {
  const r = await db.prepare('SELECT type, data FROM uploads WHERE name = ?').get(name);
  return r ? { type: r.type, data: Buffer.from(r.data) } : null;
}
export async function deleteUpload(name) {
  await db.prepare('DELETE FROM uploads WHERE name = ?').run(name);
}

// ---- Helpers ---------------------------------------------------------------
export async function getSettings() {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out;
}

export async function saveSettings(patch) {
  const allowed = new Set([...Object.keys(DEFAULT_SETTINGS), 'bike_classes']);
  const s = Object.entries(patch).filter(([k]) => allowed.has(k))
    .map(([k, v]) => ['INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]]);
  if (s.length) await db.batch(s);
}

export function rowToCatalog(r) {
  return { ...r, includes: JSON.parse(r.includes || '[]'), prices: JSON.parse(r.prices), from: !!r.from_price, public: !!r.public };
}

export async function getCatalog({ publicOnly = false } = {}) {
  const [cats, items] = await Promise.all([
    db.prepare('SELECT * FROM categories ORDER BY sort, name').all(),
    db.prepare(`SELECT * FROM catalog ${publicOnly ? 'WHERE public = 1' : ''} ORDER BY sort, name`).all(),
  ]);
  return { categories: cats, items: items.map(rowToCatalog) };
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
