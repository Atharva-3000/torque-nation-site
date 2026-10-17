// Torque Nation — zero-dependency web server (Node ≥ 22.13).
// Public site + admin panel + invoice generator.
import http from 'node:http';
import { readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { join, extname, normalize, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { db, ensureAdmin, getSettings, saveSettings, getCatalog, rowToDoc, rowToPortfolio, UPLOAD_DIR } from './lib/db.js';
import { verifyPassword, hashPassword, newToken, throttle, clearThrottle } from './lib/auth.js';
import { renderPage, renderInvoice, view } from './lib/render.js';
import { computeTotals, fiscalYear } from './public/js/calc.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = join(process.cwd(), 'public');
const SESSION_DAYS = 7;
const PROD = process.env.NODE_ENV === 'production';

ensureAdmin();

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
const json = (res, status, data, headers = {}) => send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
const html = (res, status, body) => send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
const redirect = (res, to) => send(res, 302, '', { Location: to });

async function readBody(req, limit = 1_000_000) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const ip = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

function currentUser(req) {
  const token = cookies(req).tn_session;
  if (!token) return null;
  const row = db.prepare('SELECT s.token, s.expires_at, u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
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

function nextNumber(type, date) {
  const s = getSettings();
  const fy = fiscalYear(date);
  const row = db.prepare('SELECT MAX(seq) AS m FROM documents WHERE doc_type = ? AND fy = ?').get(type, fy);
  const seq = (row.m || 0) + 1;
  const prefix = type === 'invoice' ? s.invoice_prefix : s.estimate_prefix;
  return { fy, seq, number: `${prefix}/${fy}/${String(seq).padStart(4, '0')}` };
}

function insertDoc(type, d, requestedStatus, sourceId = null) {
  const { fy, seq, number } = nextNumber(type, d.date);
  const status = statusFor(type, d.totals, d.payment, requestedStatus);
  const r = db.prepare(`INSERT INTO documents (doc_type, number, fy, seq, date, customer, vehicle, items, options, totals, notes, payment, status, source_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(type, number, fy, seq, d.date, JSON.stringify(d.customer), JSON.stringify(d.vehicle),
    JSON.stringify(d.items), JSON.stringify(d.options), JSON.stringify(d.totals), d.notes, JSON.stringify(d.payment), status, sourceId);
  return Number(r.lastInsertRowid);
}

// ---- uploads ---------------------------------------------------------------
async function saveUpload(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw Object.assign(new Error('Unsupported image. Use PNG, JPG, WebP or SVG.'), { status: 400 });
  const ext = { png: '.png', jpg: '.jpg', jpeg: '.jpg', webp: '.webp', 'svg+xml': '.svg' }[m[1]];
  const buf = Buffer.from(m[2], 'base64');
  if (ext === '.svg' && /<script|\son[a-z]+\s*=|javascript:/i.test(buf.toString('utf8'))) throw Object.assign(new Error('SVG contains scripts'), { status: 400 });
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${ext}`;
  await writeFile(join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}
async function removeUpload(url) {
  if (typeof url === 'string' && url.startsWith('/uploads/')) await unlink(join(UPLOAD_DIR, basename(url))).catch(() => {});
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
      db.prepare('INSERT INTO bookings (name, phone, bike, service, preferred_date, message) VALUES (?, ?, ?, ?, ?, ?)')
        .run(name, phone, str(b.bike, 100), str(b.service, 100), str(b.preferred_date, 10), str(b.message, 1500));
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Not found' });
  }

  if (seg[0] === 'login' && m === 'POST') {
    if (!throttle('login:' + ip(req))) return json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const b = await readBody(req, 5_000);
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(str(b.username, 60));
    if (!u || !verifyPassword(b.password, u.pass_hash)) return json(res, 401, { error: 'Wrong username or password.' });
    clearThrottle('login:' + ip(req));
    const token = newToken();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, u.id, Date.now() + SESSION_DAYS * 86400_000);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
  }

  // Everything below requires a session. Mutations also require the custom
  // header (cross-site forms cannot set it) on top of SameSite=Strict.
  if (!user) return json(res, 401, { error: 'Not signed in' });
  if (m !== 'GET' && req.headers['x-requested-with'] !== 'tn-admin') return json(res, 403, { error: 'Bad request origin' });

  if (seg[0] === 'logout' && m === 'POST') {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (seg[0] === 'me') return json(res, 200, { username: user.username });

  if (seg[0] === 'password' && m === 'POST') {
    const b = await readBody(req, 5_000);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(b.current, u.pass_hash)) return json(res, 400, { error: 'Current password is wrong.' });
    if (String(b.next || '').length < 10) return json(res, 400, { error: 'New password must be at least 10 characters.' });
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(b.next), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, user.token);
    return json(res, 200, { ok: true });
  }

  if (seg[0] === 'bootstrap') {
    return json(res, 200, {
      settings: getSettings(),
      catalog: getCatalog(),
      bikes: db.prepare('SELECT * FROM bike_models ORDER BY brand, model').all(),
      parts: db.prepare('SELECT * FROM part_presets ORDER BY sort, name').all(),
    });
  }

  if (seg[0] === 'settings' && m === 'PUT') {
    const b = await readBody(req, 6_000_000);
    if (b.hero_image_data) {
      const old = getSettings().hero_image;
      b.hero_image = await saveUpload(b.hero_image_data);
      await removeUpload(old);
    }
    delete b.hero_image_data;
    saveSettings(b);
    return json(res, 200, getSettings());
  }

  if (seg[0] === 'stats') {
    const t = today(), monthStart = t.slice(0, 8) + '01';
    const inv = db.prepare(`SELECT totals, payment, status FROM documents WHERE doc_type = 'invoice' AND status != 'void' AND date >= ?`).all(monthStart);
    const month = inv.reduce((a, r) => a + JSON.parse(r.totals).total, 0);
    const collected = inv.reduce((a, r) => a + Math.round(JSON.parse(r.payment).paid * 100), 0);
    const outstanding = db.prepare(`SELECT totals, payment FROM documents WHERE doc_type = 'invoice' AND status IN ('unpaid','partial')`).all()
      .reduce((a, r) => a + JSON.parse(r.totals).total - Math.round(JSON.parse(r.payment).paid * 100), 0);
    return json(res, 200, {
      month, collected, outstanding, invoicesThisMonth: inv.length,
      openEstimates: db.prepare(`SELECT COUNT(*) n FROM documents WHERE doc_type = 'estimate' AND status IN ('draft','sent','approved')`).get().n,
      newBookings: db.prepare(`SELECT COUNT(*) n FROM bookings WHERE status = 'new'`).get().n,
    });
  }

  // Documents
  if (seg[0] === 'documents') {
    const id = Number(seg[1]);
    if (!seg[1] && m === 'GET') {
      const u = new URL(req.url, 'http://x');
      const type = u.searchParams.get('type'), q = `%${u.searchParams.get('q') || ''}%`, status = u.searchParams.get('status');
      const rows = db.prepare(`SELECT * FROM documents WHERE (? IS NULL OR doc_type = ?) AND (? IS NULL OR status = ?)
        AND (number LIKE ? OR customer LIKE ? OR vehicle LIKE ?) ORDER BY date DESC, id DESC LIMIT 300`)
        .all(type, type, status, status, q, q, q).map(rowToDoc);
      return json(res, 200, rows);
    }
    if (!seg[1] && m === 'POST') {
      const b = await readBody(req, 300_000);
      const type = b.doc_type === 'estimate' ? 'estimate' : 'invoice';
      const newId = insertDoc(type, buildDoc(b), b.status);
      return json(res, 201, rowToDoc(db.prepare('SELECT * FROM documents WHERE id = ?').get(newId)));
    }
    const existing = rowToDoc(db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
    if (!existing) return json(res, 404, { error: 'Not found' });
    if (m === 'GET' && !seg[2]) return json(res, 200, existing);
    if (m === 'PUT') {
      const b = await readBody(req, 300_000);
      const d = buildDoc(b);
      const status = statusFor(existing.doc_type, d.totals, d.payment, b.status);
      db.prepare(`UPDATE documents SET date = ?, customer = ?, vehicle = ?, items = ?, options = ?, totals = ?, notes = ?, payment = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(d.date, JSON.stringify(d.customer), JSON.stringify(d.vehicle), JSON.stringify(d.items), JSON.stringify(d.options), JSON.stringify(d.totals), d.notes, JSON.stringify(d.payment), status, id);
      return json(res, 200, rowToDoc(db.prepare('SELECT * FROM documents WHERE id = ?').get(id)));
    }
    if (m === 'DELETE') {
      db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }
    if (m === 'POST' && seg[2] === 'convert' && existing.doc_type === 'estimate') {
      const d = buildDoc({ ...existing, date: today(), payment: { paid: 0 } });
      const newId = insertDoc('invoice', d, 'unpaid', existing.id);
      db.prepare(`UPDATE documents SET status = 'approved' WHERE id = ?`).run(existing.id);
      return json(res, 201, rowToDoc(db.prepare('SELECT * FROM documents WHERE id = ?').get(newId)));
    }
    if (m === 'POST' && seg[2] === 'duplicate') {
      const d = buildDoc({ ...existing, date: today(), payment: { paid: 0 } });
      const newId = insertDoc(existing.doc_type, d, 'draft');
      return json(res, 201, rowToDoc(db.prepare('SELECT * FROM documents WHERE id = ?').get(newId)));
    }
  }

  // Rate card
  if (seg[0] === 'catalog') {
    if (m === 'PUT' && seg[1]) {
      const b = await readBody(req, 50_000);
      const price = (x) => (x === null || x === '' || x === undefined ? null : Math.max(0, num(x)));
      const id = str(seg[1], 60).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'item-' + Date.now();
      const sort = db.prepare('SELECT sort FROM catalog WHERE id = ?').get(id)?.sort ?? (db.prepare('SELECT MAX(sort) m FROM catalog').get().m || 0) + 1;
      db.prepare(`INSERT INTO catalog (id, category, name, summary, includes, prices, hours, sac, from_price, public, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET category=excluded.category, name=excluded.name, summary=excluded.summary, includes=excluded.includes, prices=excluded.prices,
        hours=excluded.hours, sac=excluded.sac, from_price=excluded.from_price, public=excluded.public`)
        .run(id, str(b.category, 40), str(b.name, 120), str(b.summary, 400), JSON.stringify((b.includes || []).map((x) => str(x, 120)).filter(Boolean)),
          JSON.stringify({ A: price(b.prices?.A), B: price(b.prices?.B), C: price(b.prices?.C) }), str(b.hours, 40), str(b.sac, 12), b.from ? 1 : 0, b.public ? 1 : 0, sort);
      return json(res, 200, getCatalog());
    }
    if (m === 'DELETE' && seg[1]) {
      db.prepare('DELETE FROM catalog WHERE id = ?').run(seg[1]);
      return json(res, 200, getCatalog());
    }
  }

  // Bikes
  if (seg[0] === 'bikes') {
    if (m === 'POST') {
      const b = await readBody(req, 5_000);
      if (!str(b.brand) || !str(b.model) || !['A', 'B', 'C'].includes(b.class)) return json(res, 400, { error: 'Brand, model and class are required.' });
      if (b.id) db.prepare('UPDATE bike_models SET brand = ?, model = ?, class = ? WHERE id = ?').run(str(b.brand, 40), str(b.model, 60), b.class, num(b.id));
      else db.prepare('INSERT INTO bike_models (brand, model, class) VALUES (?, ?, ?)').run(str(b.brand, 40), str(b.model, 60), b.class);
      return json(res, 200, db.prepare('SELECT * FROM bike_models ORDER BY brand, model').all());
    }
    if (m === 'DELETE' && seg[1]) {
      db.prepare('DELETE FROM bike_models WHERE id = ?').run(num(seg[1]));
      return json(res, 200, db.prepare('SELECT * FROM bike_models ORDER BY brand, model').all());
    }
  }

  // Part presets
  if (seg[0] === 'parts') {
    if (m === 'POST') {
      const b = await readBody(req, 5_000);
      if (!str(b.name)) return json(res, 400, { error: 'Name is required.' });
      if (b.id) db.prepare('UPDATE part_presets SET name = ?, hsn = ?, gst = ?, unit = ? WHERE id = ?').run(str(b.name, 100), str(b.hsn, 12), num(b.gst, 18), str(b.unit, 10), num(b.id));
      else db.prepare('INSERT INTO part_presets (name, hsn, gst, unit, sort) VALUES (?, ?, ?, ?, 999)').run(str(b.name, 100), str(b.hsn, 12), num(b.gst, 18), str(b.unit, 10));
      return json(res, 200, db.prepare('SELECT * FROM part_presets ORDER BY sort, name').all());
    }
    if (m === 'DELETE' && seg[1]) {
      db.prepare('DELETE FROM part_presets WHERE id = ?').run(num(seg[1]));
      return json(res, 200, db.prepare('SELECT * FROM part_presets ORDER BY sort, name').all());
    }
  }

  // Brands
  if (seg[0] === 'brands') {
    const list = () => db.prepare('SELECT * FROM brands ORDER BY sort, name').all();
    if (m === 'GET') return json(res, 200, list());
    if (m === 'POST') {
      const b = await readBody(req, 3_000_000);
      if (!str(b.name)) return json(res, 400, { error: 'Name is required.' });
      const newLogo = b.logoData ? await saveUpload(b.logoData) : null;
      if (b.id) {
        const old = db.prepare('SELECT logo FROM brands WHERE id = ?').get(num(b.id));
        let logo = old?.logo || null;
        if (newLogo || b.removeLogo) { if (logo) await removeUpload(logo); logo = newLogo; }
        db.prepare('UPDATE brands SET name = ?, category = ?, published = ?, sort = ?, logo = ? WHERE id = ?')
          .run(str(b.name, 60), str(b.category, 60), b.published ? 1 : 0, num(b.sort), logo, num(b.id));
      } else {
        db.prepare('INSERT INTO brands (name, category, published, sort, logo) VALUES (?, ?, ?, ?, ?)').run(str(b.name, 60), str(b.category, 60), b.published ? 1 : 0, num(b.sort, 99), newLogo);
      }
      return json(res, 200, list());
    }
    if (m === 'DELETE' && seg[1]) {
      const old = db.prepare('SELECT logo FROM brands WHERE id = ?').get(num(seg[1]));
      if (old?.logo) await removeUpload(old.logo);
      db.prepare('DELETE FROM brands WHERE id = ?').run(num(seg[1]));
      return json(res, 200, list());
    }
  }

  // Portfolio
  if (seg[0] === 'portfolio') {
    const list = () => db.prepare('SELECT * FROM portfolio ORDER BY sort, created_at DESC').all().map(rowToPortfolio);
    if (m === 'GET') return json(res, 200, list());
    if (m === 'POST') {
      const b = await readBody(req, 15_000_000);
      const images = [];
      for (const img of (b.images || []).slice(0, 12)) images.push(String(img).startsWith('data:') ? await saveUpload(img) : str(img, 200));
      const work = (b.work || []).map((x) => str(x, 140)).filter(Boolean).slice(0, 20);
      if (!str(b.title)) return json(res, 400, { error: 'Title is required.' });
      if (b.id) {
        const old = rowToPortfolio(db.prepare('SELECT * FROM portfolio WHERE id = ?').get(num(b.id)));
        for (const u of old.images) if (!images.includes(u)) await removeUpload(u);
        db.prepare('UPDATE portfolio SET title = ?, bike = ?, summary = ?, work = ?, images = ?, published = ?, sort = ? WHERE id = ?')
          .run(str(b.title, 120), str(b.bike, 80), str(b.summary, 800), JSON.stringify(work), JSON.stringify(images), b.published ? 1 : 0, num(b.sort), num(b.id));
      } else {
        db.prepare('INSERT INTO portfolio (title, bike, summary, work, images, published, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(str(b.title, 120), str(b.bike, 80), str(b.summary, 800), JSON.stringify(work), JSON.stringify(images), b.published ? 1 : 0, num(b.sort));
      }
      return json(res, 200, list());
    }
    if (m === 'DELETE' && seg[1]) {
      const old = db.prepare('SELECT * FROM portfolio WHERE id = ?').get(num(seg[1]));
      if (old) for (const u of rowToPortfolio(old).images) await removeUpload(u);
      db.prepare('DELETE FROM portfolio WHERE id = ?').run(num(seg[1]));
      return json(res, 200, list());
    }
  }

  // Bookings
  if (seg[0] === 'bookings') {
    const list = () => db.prepare('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 500').all();
    if (m === 'GET') return json(res, 200, list());
    if (m === 'PUT' && seg[1]) {
      const b = await readBody(req, 2_000);
      if (['new', 'contacted', 'booked', 'closed'].includes(b.status)) db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(b.status, num(seg[1]));
      return json(res, 200, list());
    }
    if (m === 'DELETE' && seg[1]) {
      db.prepare('DELETE FROM bookings WHERE id = ?').run(num(seg[1]));
      return json(res, 200, list());
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
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let path = decodeURIComponent(url.pathname);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  try {
    if (path.startsWith('/api/')) return await api(req, res, path, currentUser(req));

    if (PAGES[path] && (req.method === 'GET' || req.method === 'HEAD')) return html(res, 200, renderPage(PAGES[path].view, { ...PAGES[path], path }, url.origin));

    if (path === '/admin/login') {
      if (currentUser(req)) return redirect(res, '/admin');
      return html(res, 200, view('admin/login.html'));
    }
    if (path === '/admin') {
      if (!currentUser(req)) return redirect(res, '/admin/login');
      return html(res, 200, view('admin/app.html'));
    }
    const pm = /^\/admin\/print\/(\d+)$/.exec(path);
    if (pm) {
      if (!currentUser(req)) return redirect(res, '/admin/login');
      const doc = rowToDoc(db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(pm[1])));
      if (!doc) return html(res, 404, 'Not found');
      return html(res, 200, renderInvoice(doc, getSettings()));
    }

    if (path.startsWith('/uploads/') && (await serveFile(res, UPLOAD_DIR, path.slice('/uploads/'.length), 'public, max-age=31536000, immutable'))) return;
    if (path === '/robots.txt') return send(res, 200, `User-agent: *\nDisallow: /admin\nDisallow: /api\nSitemap: ${(getSettings().site_url || url.origin).replace(/\/$/, '')}/sitemap.xml\n`, { 'Content-Type': 'text/plain' });
    if (path === '/sitemap.xml') {
      const base = (getSettings().site_url || url.origin).replace(/\/$/, '');
      const hasWork = db.prepare('SELECT COUNT(*) n FROM portfolio WHERE published = 1').get().n > 0;
      const urls = Object.entries(PAGES).filter(([p, m]) => !m.noindex && (p !== '/work' || hasWork)).map(([p]) => `<url><loc>${base}${p}</loc></url>`).join('');
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { 'Content-Type': 'application/xml' });
    }
    if (await serveFile(res, PUBLIC, path, PROD ? 'public, max-age=86400' : 'no-cache')) return;

    return html(res, 404, renderPage('404.html', { nav: '', title: 'Page not found', description: 'This page does not exist.', noindex: true, path }, url.origin));
  } catch (err) {
    if (!err.status) console.error(err);
    if (path.startsWith('/api/')) return json(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
    return html(res, 500, 'Server error');
  }
});

server.listen(PORT, () => console.log(`Torque Nation running → http://localhost:${PORT}`));
