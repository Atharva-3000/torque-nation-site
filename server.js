// Torque Nation web server (Node 22).
// Public site + admin panel + invoice generator.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, basename } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dangerouslyDeleteByTag } from '@vercel/functions';
import { db, ready, ENV_ADMIN, getSettings, saveSettings, getCatalog, settingsFromRows, rowToCatalog, rowToDoc, rowToPortfolio, putUpload, getUpload, deleteUpload, UPLOAD_DIR } from './lib/db.js';
import { verifyPassword, hashPassword, newToken, throttle, clearThrottle } from './lib/auth.js';
import { renderPage, renderInvoice, view } from './lib/render.js';
import { computeTotals, fiscalYear } from './public/js/calc.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = join(process.cwd(), 'public');
const SESSION_DAYS = 7;
const PROD = process.env.NODE_ENV === 'production';
const ON_VERCEL = !!process.env.VERCEL;


const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

const PAGES = {
  '/': { view: 'index.html', nav: 'home', title: 'Home', seoTitle: 'Superbike Service Workshop in Ratlam | Torque Nation',
    description: 'Independent workshop in Ratlam for 450cc to litre-class bikes. Services, valve shims, suspension, ECU remaps and branded parts. Quoted before we start.' },
  '/services': { view: 'services.html', nav: 'services', title: 'Services', seoTitle: 'Superbike and 450cc+ Services in Ratlam | Torque Nation',
    description: 'Periodic and major services, valve clearance and shims, suspension, brakes, ECU remaps, crash protection and detailing for 450cc to superbikes in Ratlam.' },
  '/pricing': { view: 'pricing.html', nav: 'pricing', title: 'Pricing', seoTitle: 'Superbike Service Prices in Ratlam | Torque Nation',
    description: 'Published labour rates by bike class, from Himalayan 450 to ZX-10R. Parts at MRP, itemised. Written estimate before any work starts in Ratlam.' },
  '/work': { view: 'portfolio.html', nav: 'work', title: 'Our work', seoTitle: 'Recent Superbike Jobs | Torque Nation, Ratlam',
    description: 'Recent jobs from the Torque Nation workshop in Ratlam: what was wrong, what we found and what we did, with photos.' },
  '/contact': { view: 'contact.html', nav: 'contact', title: 'Book a service', seoTitle: 'Book a Bike Service in Ratlam | Torque Nation',
    description: 'Book a superbike or 450cc+ service in Ratlam. WhatsApp, call or send the form and we will confirm a slot. Pick-up within Ratlam.' },
  '/credits': { view: 'credits.html', nav: 'credits', title: 'Photo credits', noindex: true, description: 'Credits and licences for photos used on this site.' },
  '/design-system': { view: 'design-system.html', nav: 'ds', title: 'Design system', noindex: true, description: 'Torque Nation design system: tokens and components.' },
};

// ---- helpers ---------------------------------------------------------------
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    ...headers,
  });
  res.end(body);
}
// JSON responses. When an admin change touches what the public site shows
// (res.purgeSite set in api()), the CDN copies of public pages are dropped
// first, so the change is live by the time the admin sees "Saved".
const json = (res, status, data, headers = {}) => {
  const out = () => send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  if (!res.purgeSite || status >= 400) return out();
  return purgeSite().then((r) => { headers['X-TN-Purge'] = r; out(); });
};
const html = (res, status, body) => send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });

// Public pages are served from Vercel's CDN (Mumbai edge for India), tagged
// "site". Every admin change that affects them deletes that tag, so the next
// visit renders fresh. The 1-hour lifetime only matters if a purge ever fails.
// Browsers always revalidate, so nobody keeps an old copy locally.
const SITE_TAG = 'site';
const PUBLIC_CACHE = ON_VERCEL
  ? { 'Cache-Control': 'public, max-age=0, must-revalidate', 'Vercel-CDN-Cache-Control': 'max-age=3600, stale-while-revalidate=86400', 'Vercel-Cache-Tag': SITE_TAG }
  : { 'Cache-Control': 'no-cache' };
const publicHtml = (res, body) => send(res, 200, body, { 'Content-Type': 'text/html; charset=utf-8', ...PUBLIC_CACHE });

async function purgeSite() {
  if (!ON_VERCEL) return 'local';
  const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
  if (!ctx?.purge) { console.error('CDN purge unavailable: no Vercel request context'); return 'unavailable'; }
  try { await dangerouslyDeleteByTag(SITE_TAG); return 'ok'; } catch (e) { console.error('CDN purge failed', e); return 'error'; }
}
// API routes whose writes change what public pages show.
const PUBLIC_DATA = new Set(['settings', 'catalog', 'bikes', 'brands', 'portfolio']);
const redirect = (res, to) => send(res, 302, '', { Location: to });
// Same policy as vercel.json, for when this runs as a plain Node server.
const staticCache = (url, path) => !PROD ? 'no-cache'
  : (url.searchParams.has('v') || path.startsWith('/fonts/')) ? 'public, max-age=31536000, immutable'
  : 'public, max-age=86400, stale-while-revalidate=604800';

async function readBody(req, limit = 1_000_000) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Too much data in one save. Add photos a few at a time.'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
// Vercel sets x-real-ip itself; x-forwarded-for's first entry can be spoofed.
const ip = (req) => req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress;
const sameSecret = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && timingSafeEqual(x, y); };

async function currentUser(req) {
  const token = cookies(req).tn_session;
  if (!token) return null;
  const row = await db.prepare('SELECT s.token, s.expires_at, u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}
const sessionCookie = (token, maxAge) => `tn_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`;

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST

// ---- documents -------------------------------------------------------------
function cleanItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 200).map((it) => ({
    kind: it.kind === 'part' ? 'part' : 'labour',
    description: str(it.description, 200),
    note: str(it.note, 300),
    code: str(it.code, 20),
    catalogId: str(it.catalogId, 60),
    qty: num(it.qty, 1),
    unit: str(it.unit, 10),
    rate: Math.max(0, num(it.rate)),
    discount: Math.min(100, Math.max(0, num(it.discount))),
    gst: Math.min(40, Math.max(0, num(it.gst, 18))),
  })).filter((it) => it.description);
}

function buildDoc(body) {
  const c = body.customer || {}, v = body.vehicle || {}, o = body.options || {}, p = body.payment || {};
  const customer = { name: str(c.name, 120), phone: str(c.phone, 20), email: str(c.email, 120), address: str(c.address, 300), gstin: str(c.gstin, 15).toUpperCase(), state: str(c.state, 60) };
  const vehicle = { make: str(v.make, 60), model: str(v.model, 80), class: ['A', 'B', 'C'].includes(v.class) ? v.class : '', reg: str(v.reg, 20).toUpperCase(), vin: str(v.vin, 30).toUpperCase(), odo: str(v.odo, 10), nextKm: str(v.nextKm, 10), nextDate: str(v.nextDate, 10) };
  const options = { gstEnabled: !!o.gstEnabled, interState: !!o.interState, extraDiscount: Math.max(0, num(o.extraDiscount)), validDays: num(o.validDays, 7), jobCard: str(o.jobCard, 30) };
  const items = cleanItems(body.items);
  const totals = computeTotals(items, options);
  const paid = Math.max(0, num(p.paid));
  const payment = { paid, method: str(p.method, 30), ref: str(p.ref, 60) };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today();
  const notes = str(body.notes, 2000);
  return { customer, vehicle, options, items, totals, payment, date, notes };
}

function statusFor(type, totals, payment, requested) {
  if (type === 'estimate') return ['draft', 'sent', 'approved', 'declined'].includes(requested) ? requested : 'draft';
  const paid = Math.round(payment.paid * 100);
  if (requested === 'void') return 'void';
  if (paid <= 0) return 'unpaid';
  return paid >= totals.total ? 'paid' : 'partial';
}

async function nextNumber(type, date) {
  const s = await getSettings();
  const fy = fiscalYear(date);
  const row = await db.prepare('SELECT MAX(seq) AS m FROM documents WHERE doc_type = ? AND fy = ?').get(type, fy);
  const seq = (row.m || 0) + 1;
  const prefix = type === 'invoice' ? s.invoice_prefix : s.estimate_prefix;
  return { fy, seq, number: `${prefix}/${fy}/${String(seq).padStart(4, '0')}` };
}

async function insertDoc(type, d, requestedStatus, sourceId = null) {
  const status = statusFor(type, d.totals, d.payment, requestedStatus);
  // Two saves at the same moment can pick the same number; the UNIQUE index
  // rejects the second, which then takes the next number.
  for (let attempt = 0; ; attempt++) {
    const { fy, seq, number } = await nextNumber(type, d.date);
    try {
      const r = await db.prepare(`INSERT INTO documents (doc_type, number, fy, seq, date, customer, vehicle, items, options, totals, notes, payment, status, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(type, number, fy, seq, d.date, JSON.stringify(d.customer), JSON.stringify(d.vehicle),
        JSON.stringify(d.items), JSON.stringify(d.options), JSON.stringify(d.totals), d.notes, JSON.stringify(d.payment), status, sourceId);
      return Number(r.lastInsertRowid);
    } catch (e) {
      if (attempt < 3 && /UNIQUE/i.test(String(e?.message))) continue;
      throw e;
    }
  }
}

// ---- uploads ---------------------------------------------------------------
async function saveUpload(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw Object.assign(new Error('Unsupported image. Use PNG, JPG, WebP or SVG.'), { status: 400 });
  const ext = { png: '.png', jpg: '.jpg', jpeg: '.jpg', webp: '.webp', 'svg+xml': '.svg' }[m[1]];
  const buf = Buffer.from(m[2], 'base64');
  if (ext === '.svg' && /<script|\son[a-z]+\s*=|javascript:/i.test(buf.toString('utf8'))) throw Object.assign(new Error('SVG contains scripts'), { status: 400 });
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${ext}`;
  await putUpload(name, MIME[ext], buf);
  return `/uploads/${name}`;
}
// Only our own image paths are accepted where the admin sends a URL back.
const cleanImageUrl = (v) => (typeof v === 'string' && /^\/(uploads|img)\/[\w./-]+$/.test(v) && !v.includes('..') ? v : '');
async function removeUpload(url) {
  if (typeof url === 'string' && url.startsWith('/uploads/')) await deleteUpload(basename(url)).catch(() => {});
}
// Uploads live in the database. Files from before that change may still sit in
// DATA_DIR/uploads on a local or VPS install, so fall back to the disk.
async function serveUpload(res, name) {
  const f = await getUpload(name);
  if (!f) return serveFile(res, UPLOAD_DIR, name, 'public, max-age=31536000, immutable');
  const headers = { 'Content-Type': f.type, 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable' };
  if (f.type === 'image/svg+xml') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
  send(res, 200, f.data, headers);
  return true;
}

// ---- API -------------------------------------------------------------------
async function api(req, res, path, user) {
  const m = req.method;
  const seg = path.split('/').filter(Boolean).slice(1); // after "api"

  // Public endpoints
  if (seg[0] === 'public') {
    if (seg[1] === 'booking' && m === 'POST') {
      const b = await readBody(req, 20_000);
      if (b.website) return json(res, 200, { ok: true }); // honeypot
      const name = str(b.name, 80), phone = str(b.phone, 20);
      if (!name || !/^[+\d][\d\s-]{7,}$/.test(phone)) return json(res, 400, { error: 'Please add your name and a valid phone number.' });
      if (!throttle('booking:' + ip(req))) return json(res, 429, { error: 'Too many requests. Please WhatsApp us instead.' });
      await db.prepare('INSERT INTO bookings (name, phone, bike, service, preferred_date, message) VALUES (?, ?, ?, ?, ?, ?)')
        .run(name, phone, str(b.bike, 100), str(b.service, 100), str(b.preferred_date, 10), str(b.message, 1500));
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Not found' });
  }

  if (seg[0] === 'login' && m === 'POST') {
    if (!throttle('login:' + ip(req))) return json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const b = await readBody(req, 5_000);
    const username = str(b.username, 60);
    let u = await db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (!u || !verifyPassword(b.password, u.pass_hash)) {
      // Recovery: ADMIN_USER / ADMIN_PASSWORD from Vercel always sign in, and
      // reset the stored password to match.
      if (!ENV_ADMIN || username.toLowerCase() !== ENV_ADMIN.username.toLowerCase() || !sameSecret(b.password, ENV_ADMIN.password)) {
        return json(res, 401, { error: 'Wrong username or password.' });
      }
      await db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET pass_hash = excluded.pass_hash')
        .run(ENV_ADMIN.username, hashPassword(ENV_ADMIN.password));
      u = await db.prepare('SELECT * FROM users WHERE username = ?').get(ENV_ADMIN.username);
    }
    clearThrottle('login:' + ip(req));
    const token = newToken();
    await db.batch([
      ['DELETE FROM sessions WHERE expires_at < ?', [Date.now()]],
      ['INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, u.id, Date.now() + SESSION_DAYS * 86400_000]],
    ]);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
  }

  // Everything below requires a session. Mutations also require the custom
  // header (cross-site forms cannot set it) on top of SameSite=Strict.
  if (!user) return json(res, 401, { error: 'Not signed in' });
  if (m !== 'GET' && req.headers['x-requested-with'] !== 'tn-admin') return json(res, 403, { error: 'Bad request origin' });
  if (m !== 'GET' && PUBLIC_DATA.has(seg[0])) res.purgeSite = true;

  if (seg[0] === 'logout' && m === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (seg[0] === 'me') return json(res, 200, { username: user.username });

  if (seg[0] === 'password' && m === 'POST') {
    const b = await readBody(req, 5_000);
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(b.current, u.pass_hash)) return json(res, 400, { error: 'Current password is wrong.' });
    if (String(b.next || '').length < 10) return json(res, 400, { error: 'New password must be at least 10 characters.' });
    await db.batch([
      ['UPDATE users SET pass_hash = ? WHERE id = ?', [hashPassword(b.next), user.id]],
      ['DELETE FROM sessions WHERE user_id = ? AND token != ?', [user.id, user.token]],
    ]);
    return json(res, 200, { ok: true });
  }

  if (seg[0] === 'bootstrap') {
    const [settings, categories, items, bikes, parts] = await db.reads([
      ['SELECT key, value FROM settings'],
      ['SELECT * FROM categories ORDER BY sort, name'],
      ['SELECT * FROM catalog ORDER BY sort, name'],
      ['SELECT * FROM bike_models ORDER BY brand, model'],
      ['SELECT * FROM part_presets ORDER BY sort, name'],
    ]);
    return json(res, 200, { settings: settingsFromRows(settings), catalog: { categories, items: items.map(rowToCatalog) }, bikes, parts });
  }

  // One image per request, so no save ever runs into Vercel's 4.5 MB body limit.
  if (seg[0] === 'upload' && m === 'POST') {
    const b = await readBody(req, 4_000_000);
    return json(res, 200, { url: await saveUpload(b.data) });
  }

  if (seg[0] === 'settings' && m === 'PUT') {
    const b = await readBody(req, 4_000_000);
    const old = (b.hero_image_data || b.replace_hero) ? (await getSettings()).hero_image : null;
    if (b.hero_image_data) b.hero_image = await saveUpload(b.hero_image_data);
    if ('hero_image' in b) b.hero_image = cleanImageUrl(b.hero_image);
    if (old && old !== b.hero_image) await removeUpload(old);
    delete b.hero_image_data; delete b.replace_hero;
    await saveSettings(b);
    return json(res, 200, await getSettings());
  }

  if (seg[0] === 'stats') {
    const t = today(), monthStart = t.slice(0, 8) + '01';
    const [inv, open, [est], [bk]] = await db.reads([
      [`SELECT totals, payment, status FROM documents WHERE doc_type = 'invoice' AND status != 'void' AND date >= ?`, [monthStart]],
      [`SELECT totals, payment FROM documents WHERE doc_type = 'invoice' AND status IN ('unpaid','partial')`],
      [`SELECT COUNT(*) n FROM documents WHERE doc_type = 'estimate' AND status IN ('draft','sent','approved')`],
      [`SELECT COUNT(*) n FROM bookings WHERE status = 'new'`],
    ]);
    const month = inv.reduce((a, r) => a + JSON.parse(r.totals).total, 0);
    const collected = inv.reduce((a, r) => a + Math.round(JSON.parse(r.payment).paid * 100), 0);
    const outstanding = open.reduce((a, r) => a + JSON.parse(r.totals).total - Math.round(JSON.parse(r.payment).paid * 100), 0);
    return json(res, 200, { month, collected, outstanding, invoicesThisMonth: inv.length, openEstimates: est.n, newBookings: bk.n });
  }

  // Documents
  if (seg[0] === 'documents') {
    const id = Number(seg[1]);
    if (!seg[1] && m === 'GET') {
      const u = new URL(req.url, 'http://x');
      const type = u.searchParams.get('type'), q = `%${u.searchParams.get('q') || ''}%`, status = u.searchParams.get('status');
      const rows = (await db.prepare(`SELECT * FROM documents WHERE (? IS NULL OR doc_type = ?) AND (? IS NULL OR status = ?)
        AND (number LIKE ? OR customer LIKE ? OR vehicle LIKE ?) ORDER BY date DESC, id DESC LIMIT 300`)
        .all(type, type, status, status, q, q, q)).map(rowToDoc);
      return json(res, 200, rows);
    }
    if (!seg[1] && m === 'POST') {
      const b = await readBody(req, 300_000);
      const type = b.doc_type === 'estimate' ? 'estimate' : 'invoice';
      const newId = await insertDoc(type, buildDoc(b), b.status);
      return json(res, 201, rowToDoc(await db.prepare('SELECT * FROM documents WHERE id = ?').get(newId)));
    }
    const existing = rowToDoc(await db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
    if (!existing) return json(res, 404, { error: 'Not found' });
    if (m === 'GET' && !seg[2]) return json(res, 200, existing);
    if (m === 'PUT') {
      const b = await readBody(req, 300_000);
      const d = buildDoc(b);
      const status = statusFor(existing.doc_type, d.totals, d.payment, b.status);
      await db.prepare(`UPDATE documents SET date = ?, customer = ?, vehicle = ?, items = ?, options = ?, totals = ?, notes = ?, payment = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(d.date, JSON.stringify(d.customer), JSON.stringify(d.vehicle), JSON.stringify(d.items), JSON.stringify(d.options), JSON.stringify(d.totals), d.notes, JSON.stringify(d.payment), status, id);
      return json(res, 200, rowToDoc(await db.prepare('SELECT * FROM documents WHERE id = ?').get(id)));
    }
    if (m === 'DELETE') {
      await db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }
    if (m === 'POST' && seg[2] === 'convert' && existing.doc_type === 'estimate') {
      const d = buildDoc({ ...existing, date: today(), payment: { paid: 0 } });
      const newId = await insertDoc('invoice', d, 'unpaid', existing.id);
      await db.prepare(`UPDATE documents SET status = 'approved' WHERE id = ?`).run(existing.id);
      return json(res, 201, rowToDoc(await db.prepare('SELECT * FROM documents WHERE id = ?').get(newId)));
    }
    if (m === 'POST' && seg[2] === 'duplicate') {
      const d = buildDoc({ ...existing, date: today(), payment: { paid: 0 } });
      const newId = await insertDoc(existing.doc_type, d, 'draft');
      return json(res, 201, rowToDoc(await db.prepare('SELECT * FROM documents WHERE id = ?').get(newId)));
    }
  }

  // Rate card
  if (seg[0] === 'catalog') {
    if (m === 'PUT' && seg[1]) {
      const b = await readBody(req, 50_000);
      const price = (x) => (x === null || x === '' || x === undefined ? null : Math.max(0, num(x)));
      const id = str(seg[1], 60).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'item-' + Date.now();
      const sort = (await db.prepare('SELECT sort FROM catalog WHERE id = ?').get(id))?.sort ?? ((await db.prepare('SELECT MAX(sort) m FROM catalog').get()).m || 0) + 1;
      await db.prepare(`INSERT INTO catalog (id, category, name, summary, includes, prices, hours, sac, from_price, public, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET category=excluded.category, name=excluded.name, summary=excluded.summary, includes=excluded.includes, prices=excluded.prices,
        hours=excluded.hours, sac=excluded.sac, from_price=excluded.from_price, public=excluded.public`)
        .run(id, str(b.category, 40), str(b.name, 120), str(b.summary, 400), JSON.stringify((b.includes || []).map((x) => str(x, 120)).filter(Boolean)),
          JSON.stringify({ A: price(b.prices?.A), B: price(b.prices?.B), C: price(b.prices?.C) }), str(b.hours, 40), str(b.sac, 12), b.from ? 1 : 0, b.public ? 1 : 0, sort);
      return json(res, 200, await getCatalog());
    }
    if (m === 'DELETE' && seg[1]) {
      await db.prepare('DELETE FROM catalog WHERE id = ?').run(seg[1]);
      return json(res, 200, await getCatalog());
    }
  }

  // Bikes
  if (seg[0] === 'bikes') {
    if (m === 'POST') {
      const b = await readBody(req, 5_000);
      if (!str(b.brand) || !str(b.model) || !['A', 'B', 'C'].includes(b.class)) return json(res, 400, { error: 'Brand, model and class are required.' });
      if (b.id) await db.prepare('UPDATE bike_models SET brand = ?, model = ?, class = ? WHERE id = ?').run(str(b.brand, 40), str(b.model, 60), b.class, num(b.id));
      else await db.prepare('INSERT INTO bike_models (brand, model, class) VALUES (?, ?, ?)').run(str(b.brand, 40), str(b.model, 60), b.class);
      return json(res, 200, await db.prepare('SELECT * FROM bike_models ORDER BY brand, model').all());
    }
    if (m === 'DELETE' && seg[1]) {
      await db.prepare('DELETE FROM bike_models WHERE id = ?').run(num(seg[1]));
      return json(res, 200, await db.prepare('SELECT * FROM bike_models ORDER BY brand, model').all());
    }
  }

  // Part presets
  if (seg[0] === 'parts') {
    if (m === 'POST') {
      const b = await readBody(req, 5_000);
      if (!str(b.name)) return json(res, 400, { error: 'Name is required.' });
      if (b.id) await db.prepare('UPDATE part_presets SET name = ?, hsn = ?, gst = ?, unit = ? WHERE id = ?').run(str(b.name, 100), str(b.hsn, 12), num(b.gst, 18), str(b.unit, 10), num(b.id));
      else await db.prepare('INSERT INTO part_presets (name, hsn, gst, unit, sort) VALUES (?, ?, ?, ?, 999)').run(str(b.name, 100), str(b.hsn, 12), num(b.gst, 18), str(b.unit, 10));
      return json(res, 200, await db.prepare('SELECT * FROM part_presets ORDER BY sort, name').all());
    }
    if (m === 'DELETE' && seg[1]) {
      await db.prepare('DELETE FROM part_presets WHERE id = ?').run(num(seg[1]));
      return json(res, 200, await db.prepare('SELECT * FROM part_presets ORDER BY sort, name').all());
    }
  }

  // Brands
  if (seg[0] === 'brands') {
    const list = async () => await db.prepare('SELECT * FROM brands ORDER BY sort, name').all();
    if (m === 'GET') return json(res, 200, await list());
    if (m === 'POST') {
      const b = await readBody(req, 4_000_000);
      if (!str(b.name)) return json(res, 400, { error: 'Name is required.' });
      const newLogo = b.logoData ? await saveUpload(b.logoData) : (cleanImageUrl(b.logo) || null);
      if (b.id) {
        const old = await db.prepare('SELECT logo FROM brands WHERE id = ?').get(num(b.id));
        let logo = old?.logo || null;
        if (newLogo || b.removeLogo) { if (logo) await removeUpload(logo); logo = newLogo; }
        await db.prepare('UPDATE brands SET name = ?, category = ?, published = ?, sort = ?, logo = ? WHERE id = ?')
          .run(str(b.name, 60), str(b.category, 60), b.published ? 1 : 0, num(b.sort), logo, num(b.id));
      } else {
        await db.prepare('INSERT INTO brands (name, category, published, sort, logo) VALUES (?, ?, ?, ?, ?)').run(str(b.name, 60), str(b.category, 60), b.published ? 1 : 0, num(b.sort, 99), newLogo);
      }
      return json(res, 200, await list());
    }
    if (m === 'DELETE' && seg[1]) {
      const old = await db.prepare('SELECT logo FROM brands WHERE id = ?').get(num(seg[1]));
      if (old?.logo) await removeUpload(old.logo);
      await db.prepare('DELETE FROM brands WHERE id = ?').run(num(seg[1]));
      return json(res, 200, await list());
    }
  }

  // Portfolio
  if (seg[0] === 'portfolio') {
    const list = async () => (await db.prepare('SELECT * FROM portfolio ORDER BY sort, created_at DESC').all()).map(rowToPortfolio);
    if (m === 'GET') return json(res, 200, await list());
    if (m === 'POST') {
      const b = await readBody(req, 4_000_000);
      const images = [];
      for (const img of (Array.isArray(b.images) ? b.images : []).slice(0, 12)) {
        const url = String(img).startsWith('data:') ? await saveUpload(img) : cleanImageUrl(img);
        if (url) images.push(url);
      }
      const work = (b.work || []).map((x) => str(x, 140)).filter(Boolean).slice(0, 20);
      if (!str(b.title)) return json(res, 400, { error: 'Title is required.' });
      if (b.id) {
        const old = rowToPortfolio(await db.prepare('SELECT * FROM portfolio WHERE id = ?').get(num(b.id)));
        for (const u of old.images) if (!images.includes(u)) await removeUpload(u);
        await db.prepare('UPDATE portfolio SET title = ?, bike = ?, summary = ?, work = ?, images = ?, published = ?, sort = ? WHERE id = ?')
          .run(str(b.title, 120), str(b.bike, 80), str(b.summary, 800), JSON.stringify(work), JSON.stringify(images), b.published ? 1 : 0, num(b.sort), num(b.id));
      } else {
        await db.prepare('INSERT INTO portfolio (title, bike, summary, work, images, published, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(str(b.title, 120), str(b.bike, 80), str(b.summary, 800), JSON.stringify(work), JSON.stringify(images), b.published ? 1 : 0, num(b.sort));
      }
      return json(res, 200, await list());
    }
    if (m === 'DELETE' && seg[1]) {
      const old = await db.prepare('SELECT * FROM portfolio WHERE id = ?').get(num(seg[1]));
      if (old) for (const u of rowToPortfolio(old).images) await removeUpload(u);
      await db.prepare('DELETE FROM portfolio WHERE id = ?').run(num(seg[1]));
      return json(res, 200, await list());
    }
  }

  // Bookings
  if (seg[0] === 'bookings') {
    const list = async () => await db.prepare('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 500').all();
    if (m === 'GET') return json(res, 200, await list());
    if (m === 'PUT' && seg[1]) {
      const b = await readBody(req, 2_000);
      if (['new', 'contacted', 'booked', 'closed'].includes(b.status)) await db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(b.status, num(seg[1]));
      return json(res, 200, await list());
    }
    if (m === 'DELETE' && seg[1]) {
      await db.prepare('DELETE FROM bookings WHERE id = ?').run(num(seg[1]));
      return json(res, 200, await list());
    }
  }

  return json(res, 404, { error: 'Not found' });
}

// ---- static ----------------------------------------------------------------
async function serveFile(res, root, rel, cache = 'public, max-age=3600') {
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) return false;
  try {
    const s = await stat(file);
    if (!s.isFile()) return false;
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': cache };
    if (type === 'image/svg+xml') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
    send(res, 200, await readFile(file), headers);
    return true;
  } catch { return false; }
}

// ---- router ----------------------------------------------------------------
export async function app(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let path = decodeURIComponent(url.pathname);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  try {
    // Static files never need the database.
    if (!path.startsWith('/api/') && !path.startsWith('/admin') && !path.startsWith('/uploads/') && !PAGES[path] && extname(path)
      && path !== '/robots.txt' && path !== '/sitemap.xml'
      && (await serveFile(res, PUBLIC, path, staticCache(url, path)))) return;
    await ready();
    if (path.startsWith('/api/')) return await api(req, res, path, await currentUser(req));

    if (PAGES[path] && (req.method === 'GET' || req.method === 'HEAD')) return publicHtml(res, await renderPage(PAGES[path].view, { ...PAGES[path], path }, url.origin));

    if (path === '/admin/login') {
      if (await currentUser(req)) return redirect(res, '/admin');
      return html(res, 200, view('admin/login.html'));
    }
    if (path === '/admin') {
      if (!await currentUser(req)) return redirect(res, '/admin/login');
      return html(res, 200, view('admin/app.html'));
    }
    const pm = /^\/admin\/print\/(\d+)$/.exec(path);
    if (pm) {
      if (!await currentUser(req)) return redirect(res, '/admin/login');
      const doc = rowToDoc(await db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(pm[1])));
      if (!doc) return html(res, 404, 'Not found');
      return html(res, 200, renderInvoice(doc, await getSettings()));
    }

    if (path.startsWith('/uploads/') && (await serveUpload(res, basename(path)))) return;
    if (path === '/robots.txt') return send(res, 200, `User-agent: *\nDisallow: /admin\nDisallow: /api\nSitemap: ${((await getSettings()).site_url || url.origin).replace(/\/$/, '')}/sitemap.xml\n`, { 'Content-Type': 'text/plain', ...PUBLIC_CACHE });
    if (path === '/sitemap.xml') {
      const base = ((await getSettings()).site_url || url.origin).replace(/\/$/, '');
      const hasWork = (await db.prepare('SELECT COUNT(*) n FROM portfolio WHERE published = 1').get()).n > 0;
      const urls = Object.entries(PAGES).filter(([p, m]) => !m.noindex && (p !== '/work' || hasWork)).map(([p]) => `<url><loc>${base}${p}</loc></url>`).join('');
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { 'Content-Type': 'application/xml', ...PUBLIC_CACHE });
    }
    if (await serveFile(res, PUBLIC, path, staticCache(url, path))) return;

    return html(res, 404, await renderPage('404.html', { nav: '', title: 'Page not found', description: 'This page does not exist.', noindex: true, path }, url.origin));
  } catch (err) {
    if (!err.status) console.error(err);
    if (path.startsWith('/api/')) return json(res, err.status || 500, { error: err.status ? err.message : 'Server error. Please try again.' });
    return html(res, err.status || 500, err.status === 503 ? err.message : 'Server error. Please refresh the page.');
  }
}

// Vercel (Node.js preset) imports this file and calls the default export per request.
export default app;

if (!process.env.VERCEL) {
  http.createServer(app).listen(PORT, () => console.log(`Torque Nation running → http://localhost:${PORT}`));
}
