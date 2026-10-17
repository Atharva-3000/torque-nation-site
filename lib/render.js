import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, getSettings, getCatalog, rowToPortfolio } from './db.js';
import { inr, rupees, amountInWords, taxBreakdown } from '../public/js/calc.js';

const VIEWS = join(process.cwd(), 'views');
const cache = new Map();
const DEV = process.env.NODE_ENV !== 'production';

export function view(name) {
  if (!DEV && cache.has(name)) return cache.get(name);
  const s = readFileSync(join(VIEWS, name), 'utf8');
  cache.set(name, s);
  return s;
}

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function lookup(ctx, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
}

/** {{> partial}}  {{{raw}}}  {{escaped.path}} */
// Single pass, so inserted content is never re-scanned for tags.
export function template(str, ctx) {
  return str.replace(/\{\{(?:>\s*([\w-]+)|\{\s*([\w.]+)\s*\}|\s*([\w.]+))\s*\}\}/g, (_, partial, raw, key) => {
    if (partial) return template(view(`partials/${partial}.html`), ctx);
    if (raw) {
      const v = lookup(ctx, raw);
      return typeof v === 'function' ? v() : v ?? '';
    }
    return esc(lookup(ctx, key));
  });
}

const WA_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2l-.4-.3Z"/></svg>';

export function waLink(settings, text) {
  const n = String(settings.whatsapp || '').replace(/\D/g, '');
  return `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}

// Tachometer: every mark is derived from one angle function so the scale,
// redline and needle always share the same centre and radius.
function gaugeSvg({ value = 7.6, redFrom = 8, max = 10 } = {}) {
  const cx = 100, cy = 100, R = 82, START = 135, SWEEP = 270;
  const f = (n) => Math.round(n * 100) / 100;
  const ang = (v) => START + (SWEEP * v) / max;
  const pt = (a, r) => [f(cx + r * Math.cos((a * Math.PI) / 180)), f(cy + r * Math.sin((a * Math.PI) / 180))];
  const arc = (v0, v1, r) => {
    const [x0, y0] = pt(ang(v0), r), [x1, y1] = pt(ang(v1), r);
    return `M${x0} ${y0}A${r} ${r} 0 ${ang(v1) - ang(v0) > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  let marks = '';
  for (let i = 0; i <= max * 5; i++) {
    const v = i / 5, major = i % 5 === 0, red = v >= redFrom;
    const [x0, y0] = pt(ang(v), R - 4), [x1, y1] = pt(ang(v), R - (major ? 14 : 9));
    marks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="${major ? 'maj' : 'min'}${red ? ' red' : ''}"/>`;
    if (major) { const [tx, ty] = pt(ang(v), R - 27); marks += `<text x="${tx}" y="${ty}"${red ? ' class="red"' : ''}>${v}</text>`; }
  }
  return `<svg class="gauge" viewBox="8 8 184 162" role="img" aria-label="Tachometer graphic" style="--needle:${ang(value)}deg">
    <path class="gauge__track" d="${arc(0, max, R)}"/>
    <path class="gauge__red" d="${arc(redFrom, max, R)}"/>
    ${marks}
    <text class="gauge__unit" x="${cx}" y="${cy + 34}">x1000 r/min</text>
    <g class="gauge__needle"><line x1="${cx - 12}" y1="${cy}" x2="${cx + R - 20}" y2="${cy}"/></g>
    <circle class="gauge__hub" cx="${cx}" cy="${cy}" r="6"/>
  </svg>`;
}

function priceCell(price, from) {
  if (price === null || price === undefined || price === '') return '<span class="quote">On quote</span>';
  return (from ? '<span class="quote">from </span>' : '') + rupees(price);
}

// ---- Public page blocks ----------------------------------------------------
function blocks(settings) {
  const classes = settings.bike_classes;
  const { categories, items } = getCatalog({ publicOnly: true });
  const byCat = (id) => items.filter((i) => i.category === id);

  const bikesByClass = (k, limit = 99) =>
    db.prepare('SELECT brand, model FROM bike_models WHERE class = ? ORDER BY id').all(k).slice(0, limit);

  return {
    wa_icon: WA_ICON,

    gauge_demo: () => gaugeSvg(),
    hero_visual: () => settings.hero_image
      ? `<figure class="hero__photo"><img src="${esc(settings.hero_image)}" alt="${esc(settings.hero_image_alt || 'Superbike')}" width="1600" height="1200" fetchpriority="high" decoding="async"></figure>`
      : gaugeSvg(),

    class_rows: () => Object.entries(classes).map(([k, c]) => {
      const bikes = bikesByClass(k);
      return `<li class="class-row reveal" data-class="${k}">
        ${c.image ? `<img class="class-row__img" src="${esc(c.image)}" alt="${esc(c.image_alt || c.name)}" width="1000" height="750" loading="lazy" decoding="async">` : ''}
        <div class="class-row__body">
          <div class="class-row__k mono">${esc(c.label)}</div>
          <h3>${esc(c.name)}</h3>
          <p class="soft">${esc(c.blurb)}</p>
          <p class="class-row__bikes">${bikes.slice(0, 6).map((b) => esc(`${b.brand} ${b.model}`)).join(', ')}${bikes.length > 6 ? ` and ${bikes.length - 6} more` : ''}</p>
        </div>
      </li>`;
    }).join(''),

    services_overview: () => categories.filter((c) => c.id !== 'labour' && byCat(c.id).length).map((c, i) => {
      const list = byCat(c.id);
      const minA = list.map((x) => x.prices.A).filter((x) => typeof x === 'number');
      const from = minA.length ? Math.min(...minA) : null;
      return `<a class="service-card reveal" href="/services#${esc(c.id)}">
        <div class="service-card__top"><h3>${esc(c.name)}</h3><span class="service-card__arrow" aria-hidden="true">→</span></div>
        <p>${esc(c.summary)}</p>
        <dl class="readout">
          <div class="readout__row"><dt>Jobs</dt><dd>${list.length}</dd></div>
          <div class="readout__row"><dt>Labour from</dt><dd>${from !== null ? rupees(from) : 'On quote'}</dd></div>
        </dl>
      </a>`;
    }).join(''),

    services_full: () => categories.filter((c) => byCat(c.id).length).map((c, i) => `
      <section class="svc-block" id="${esc(c.id)}">
        <header class="svc-block__head">
          <h2>${esc(c.name)}</h2>
          <p class="lede">${esc(c.summary)}</p>
        </header>
        <div class="svc-block__items">
          ${byCat(c.id).map((it) => `
            <article class="svc-item reveal">
              <div>
                <h3>${esc(it.name)}</h3>
                <p class="soft">${esc(it.summary)}</p>
                ${it.includes.length ? `<ul class="ticklist">${it.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
              </div>
              <dl class="readout">
                ${it.hours ? `<div class="readout__row"><dt>Time</dt><dd>${esc(it.hours)}</dd></div>` : ''}
                ${['A', 'B', 'C'].map((k) => `<div class="readout__row"><dt>${esc(classes[k].label)}</dt><dd>${priceCell(it.prices[k], it.from)}</dd></div>`).join('')}
              </dl>
            </article>`).join('')}
        </div>
      </section>`).join(''),

    pricing_tables: () => categories.filter((c) => byCat(c.id).length).map((c) => `
      <div class="price-group" id="price-${esc(c.id)}">
        <div class="price-group__head"><h3>${esc(c.name)}</h3><a class="muted" href="/services#${esc(c.id)}">What's included →</a></div>
        <table class="price-table">
          <thead><tr><th scope="col">Job</th>${['A', 'B', 'C'].map((k) => `<th scope="col" data-class="${k}">${esc(classes[k].label)}<br><span class="muted">${esc(classes[k].name)}</span></th>`).join('')}</tr></thead>
          <tbody>
            ${byCat(c.id).map((it) => `<tr>
              <td><span class="svc-name">${esc(it.name)}</span><span class="svc-sum">${esc(it.summary)}</span></td>
              ${['A', 'B', 'C'].map((k) => `<td class="price" data-class="${k}">${priceCell(it.prices[k], it.from)}</td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`).join(''),

    class_switch: () => `<div class="segmented" role="group" aria-label="Choose your bike class">${Object.entries(classes).map(([k, c], i) =>
      `<button type="button" data-class="${k}" aria-pressed="${i === 0}">${esc(c.label)}: ${esc(c.name)}</button>`).join('')}</div>`,

    bike_finder_data: () => JSON.stringify(db.prepare('SELECT brand, model, class FROM bike_models ORDER BY brand, model').all()).replace(/</g, '\\u003c'),

    brands: () => {
      const rows = db.prepare('SELECT * FROM brands WHERE published = 1 ORDER BY sort, name').all();
      return rows.map((b) => `<div class="brand-tile" title="${esc(b.name)}">
        ${b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.name)}" loading="lazy">` : `<span class="brand-tile__word">${esc(b.name)}</span>`}
      </div>`).join('');
    },

    portfolio_grid: () => portfolioCards(db.prepare('SELECT * FROM portfolio WHERE published = 1 ORDER BY sort, created_at DESC').all().map(rowToPortfolio)),
    portfolio_preview_section: () => {
      const rows = db.prepare('SELECT * FROM portfolio WHERE published = 1 ORDER BY sort, created_at DESC LIMIT 3').all().map(rowToPortfolio);
      if (!rows.length) return '';
      return `<section class="section"><div class="container">
        <div class="section-head"><h2>Recent work.</h2><p class="lede"><a href="/work">See all jobs</a></p></div>
        <div class="work-grid">${portfolioCards(rows)}</div></div></section>`;
    },
    portfolio_count: () => String(db.prepare('SELECT COUNT(*) n FROM portfolio WHERE published = 1').get().n),

    faq_html: () => {
      const faqs = faqItems(settings, items);
      if (!faqs.length) return '';
      return `<section class="faq" aria-labelledby="faq-title"><h2 id="faq-title" class="faq__title">Common questions</h2>
        ${faqs.map((f) => `<details class="faq__item"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</section>`;
    },

    service_options: () => categories.map((c) => `<optgroup label="${esc(c.name)}">${byCat(c.id).map((it) => `<option>${esc(it.name)}</option>`).join('')}</optgroup>`).join('') + '<option>Not sure: need a diagnosis</option>',

    footer_contact: () => [
      `<li><a href="tel:${esc(String(settings.phone).replace(/\s/g, ''))}">${esc(settings.phone)}</a></li>`,
      settings.email ? `<li><a href="mailto:${esc(settings.email)}">${esc(settings.email)}</a></li>` : '',
      settings.instagram ? `<li><a href="${esc(settings.instagram)}" rel="noopener" target="_blank">Instagram</a></li>` : '',
      settings.google_reviews_url ? `<li><a href="${esc(settings.google_reviews_url)}" rel="noopener" target="_blank">Google reviews</a></li>` : '',
    ].join(''),

    address_html: () => [settings.address_line1, settings.address_line2, `${settings.city}, ${settings.state} ${settings.pincode}`].filter(Boolean).map(esc).join('<br>'),
    maps_link: () => settings.maps_url ? `<a class="btn btn--secondary" href="${esc(settings.maps_url)}" target="_blank" rel="noopener">Open in Google Maps</a>` : '',
  };
}

function portfolioCards(rows) {
  if (!rows.length) return '';
  return rows.map((p) => `<article class="work-card reveal">
    <div class="work-card__media">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="${esc(p.title)}" loading="lazy">` : '<div class="work-card__ph ticks" aria-hidden="true"></div>'}
      ${p.images.length > 1 ? `<span class="work-card__count mono">${p.images.length} photos</span>` : ''}</div>
    <div class="work-card__body">
      ${p.bike ? `<p class="work-card__bike mono">${esc(p.bike)}</p>` : ''}
      <h3>${esc(p.title)}</h3>
      ${p.summary ? `<p class="soft">${esc(p.summary)}</p>` : ''}
      ${p.work.length ? `<ul class="ticklist">${p.work.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${p.images.length > 1 ? `<div class="work-card__thumbs">${p.images.slice(1, 5).map((src) => `<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
    </div>
  </article>`).join('');
}

// FAQ answers are built from the live rate card and settings, never invented.
function faqItems(settings, items) {
  const byId = (id) => items.find((i) => i.id === id);
  const p = (n) => (typeof n === 'number' ? rupees(n) : 'on quote');
  const out = [];
  const gs = byId('general-service');
  if (gs) out.push({ q: `How much does a superbike service cost in ${settings.city}?`, a: `Labour for a general service is ${p(gs.prices.A)} for 450-700cc bikes, ${p(gs.prices.B)} for middleweights and ${p(gs.prices.C)} for superbikes. Oil, filters and other parts are extra at MRP, plus GST. You get a written estimate before any work starts.` });
  const ms = byId('major-service');
  if (ms && ms.includes.length) out.push({ q: 'What is included in a major service?', a: ms.includes.join(', ') + '.' });
  const brands = db.prepare('SELECT name FROM brands WHERE published = 1 ORDER BY sort LIMIT 6').all().map((b) => b.name);
  if (brands.length) out.push({ q: 'Which parts and oils do you use?', a: `OEM parts and branded parts from ${brands.slice(0, -1).join(', ')} and ${brands.at(-1)}, in sealed packs. You can also bring your own parts and we will fit them at the same labour rate.` });
  const ecu = byId('ecu-remap');
  if (ecu) out.push({ q: 'Can you remap my ECU?', a: ecu.summary });
  const pd = byId('pickup-drop');
  if (pd) out.push({ q: 'Do you pick up bikes?', a: `Pick-up and drop within ${settings.city} is ${p(pd.prices.A)}. Flatbed transport from Indore and Ujjain is quoted per trip.` });
  return out;
}

const isPlaceholder = (v) => !v || /0000|^Workshop address$/i.test(String(v));

function structuredData(settings, base, meta) {
  const business = {
    '@type': 'MotorcycleRepair', '@id': `${base}/#business`, name: settings.name, url: `${base}/`,
    image: settings.hero_image ? base + settings.hero_image : undefined,
    telephone: isPlaceholder(settings.phone) ? undefined : settings.phone,
    email: settings.email || undefined,
    priceRange: '₹₹',
    address: { '@type': 'PostalAddress', streetAddress: isPlaceholder(settings.address_line1) ? undefined : [settings.address_line1, settings.address_line2].filter(Boolean).join(', '), addressLocality: settings.city, addressRegion: settings.state, postalCode: settings.pincode, addressCountry: 'IN' },
    geo: settings.geo_lat && settings.geo_lng ? { '@type': 'GeoCoordinates', latitude: Number(settings.geo_lat), longitude: Number(settings.geo_lng) } : undefined,
    openingHours: settings.opening_hours_schema || undefined,
    areaServed: ['Ratlam', 'Ujjain', 'Indore', 'Mandsaur', 'Neemuch', 'Banswara'].map((n) => ({ '@type': 'City', name: n })),
    sameAs: [settings.instagram, settings.google_reviews_url, settings.maps_url].filter(Boolean),
  };
  const graph = [business];
  if (meta.path && meta.path !== '/') {
    graph.push({ '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${base}/` },
      { '@type': 'ListItem', position: 2, name: meta.crumb || meta.title, item: base + meta.path },
    ] });
  }
  if (meta.path === '/pricing') {
    const faqs = faqItems(settings, getCatalog({ publicOnly: true }).items);
    if (faqs.length) graph.push({ '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

export function renderPage(viewName, meta, origin = '') {
  const settings = getSettings();
  const base = (settings.site_url || origin).replace(/\/$/, '');
  const noindex = meta.noindex || (meta.path === '/work' && !db.prepare('SELECT COUNT(*) n FROM portfolio WHERE published = 1').get().n);
  const ctx = {
    biz: settings,
    page: meta,
    year: new Date().getFullYear(),
    wa: waLink(settings, `Hi ${settings.name}, I'd like to ask about a service.`),
    wa_book: waLink(settings, `Hi ${settings.name}, here's my bike and what it needs:`),
    tel: String(settings.phone).replace(/\s/g, ''),
    [`nav_${meta.nav}`]: 'aria-current="page"',
    seo: {
      title: meta.seoTitle || `${meta.title} | ${settings.name}`,
      canonical: base + (meta.path || '/'),
      robots: noindex ? '<meta name="robots" content="noindex, follow">' : '',
      og_image: settings.hero_image ? `<meta property="og:image" content="${esc(base + settings.hero_image)}"><meta property="og:image:alt" content="${esc(settings.hero_image_alt || settings.name)}">` : '',
      preload: meta.path === '/' && settings.hero_image ? `<link rel="preload" as="image" href="${esc(settings.hero_image)}" fetchpriority="high">` : '',
    },
    jsonld: () => structuredData(settings, base, meta),
    credits_list: () => creditsList(),
    ...blocks(settings),
  };
  const body = template(view(viewName), ctx);
  return template(view('layout.html'), { ...ctx, body });
}

function creditsList() {
  let credits = [];
  try { credits = JSON.parse(readFileSync(join(process.cwd(), 'lib', 'image-credits.json'), 'utf8')); } catch {}
  return credits.map((c) => `<li class="credit"><img src="${esc(c.file)}" alt="" loading="lazy" width="160" height="120">
    <div><strong>${esc(c.title)}</strong><br><span class="soft">By ${esc(c.author || 'unknown')}, ${c.license_url ? `<a href="${esc(c.license_url)}" rel="noopener license" target="_blank">${esc(c.license)}</a>` : esc(c.license)}, via <a href="${esc(c.source)}" rel="noopener" target="_blank">Wikimedia Commons</a>. Resized and cropped.</span></div></li>`).join('');
}

// ---- Invoice / estimate print view ---------------------------------------
export function renderInvoice(doc, settings) {
  const t = doc.totals;
  const gst = !!doc.options.gstEnabled;
  const isInvoice = doc.doc_type === 'invoice';
  const title = isInvoice ? (gst && settings.gstin ? 'Tax Invoice' : 'Invoice') : 'Estimate';
  const v = doc.vehicle, c = doc.customer;
  const breakdown = taxBreakdown(doc.items, t);
  const paid = Math.round((Number(doc.payment.paid) || 0) * 100);
  const balance = t.total - paid;

  const rows = doc.items.map((it, i) => {
    const l = t.lines[i];
    return `<tr>
      <td class="c">${i + 1}</td>
      <td><strong>${esc(it.description)}</strong>${it.note ? `<div class="sub">${esc(it.note)}</div>` : ''}<div class="sub">${it.kind === 'part' ? 'Part' : 'Labour'}${it.code ? ` · ${it.kind === 'part' ? 'HSN' : 'SAC'} ${esc(it.code)}` : ''}</div></td>
      <td class="r">${esc(it.qty)}${it.unit ? ` <span class="sub">${esc(it.unit)}</span>` : ''}</td>
      <td class="r">${inr(Math.round(Number(it.rate) * 100), { symbol: false })}</td>
      <td class="r">${Number(it.discount) ? esc(it.discount) + '%' : '–'}</td>
      ${gst ? `<td class="r">${esc(it.gst || 0)}%</td>` : ''}
      <td class="r">${inr(l.taxable, { symbol: false })}</td>
    </tr>`;
  }).join('');

  const sumRow = (label, val, cls = '') => `<div class="sum-row ${cls}"><span>${label}</span><span>${val}</span></div>`;
  const addr = [settings.address_line1, settings.address_line2, `${settings.city}, ${settings.state} ${settings.pincode}`].filter(Boolean).map(esc).join('<br>');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.number)} · ${esc(c.name || '')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/invoice.css"></head>
<body>
<div class="toolbar no-print">
  <a class="tb-btn" href="/admin#/documents/${doc.id}">← Back to edit</a>
  <span class="tb-spacer"></span>
  ${c.phone ? `<a class="tb-btn" target="_blank" rel="noopener" href="${esc(waLink({ whatsapp: (String(c.phone).replace(/\D/g, '').length === 10 ? '91' : '') + String(c.phone).replace(/\D/g, '') }, `Hi ${c.name || ''}, your ${title.toLowerCase()} ${doc.number} from ${settings.name} for ${[v.make, v.model].filter(Boolean).join(' ')}: ${inr(t.total)}.${isInvoice && balance > 0 ? ` Balance due: ${inr(balance)}.` : ''} Thank you!`))}">Share summary on WhatsApp</a>` : ''}
  <button class="tb-btn tb-btn--primary" onclick="window.print()">Print / Save PDF</button>
</div>
<main class="sheet">
  <header class="inv-head">
    <div class="inv-brand">
      <div class="inv-logo">TORQUE<span>NATION</span></div>
      <div class="inv-from">${esc(settings.legal_name || settings.name)}<br>${addr}<br>${esc(settings.phone)}${settings.email ? ' · ' + esc(settings.email) : ''}${gst && settings.gstin ? `<br><strong>GSTIN</strong> ${esc(settings.gstin)}` : ''}${gst ? `<br>State: ${esc(settings.state)} (${esc(settings.state_code)})` : ''}</div>
    </div>
    <div class="inv-title">
      <h1>${title}</h1>
      <dl class="meta">
        <div><dt>No.</dt><dd>${esc(doc.number)}</dd></div>
        <div><dt>Date</dt><dd>${esc(fmtDate(doc.date))}</dd></div>
        ${!isInvoice && doc.options.validDays ? `<div><dt>Valid for</dt><dd>${esc(doc.options.validDays)} days</dd></div>` : ''}
        ${doc.options.jobCard ? `<div><dt>Job card</dt><dd>${esc(doc.options.jobCard)}</dd></div>` : ''}
      </dl>
    </div>
  </header>

  <section class="parties">
    <div>
      <div class="lbl">Bill to</div>
      <div class="big">${esc(c.name || '—')}</div>
      <div>${[c.phone, c.email].filter(Boolean).map(esc).join(' · ')}</div>
      ${c.address ? `<div>${esc(c.address)}</div>` : ''}
      ${c.gstin ? `<div><strong>GSTIN</strong> ${esc(c.gstin)}</div>` : ''}
      ${gst && doc.options.interState && c.state ? `<div>Place of supply: ${esc(c.state)}</div>` : ''}
    </div>
    <div>
      <div class="lbl">Vehicle</div>
      <div class="big">${esc([v.make, v.model].filter(Boolean).join(' ') || '—')}</div>
      <dl class="kv">
        ${v.reg ? `<div><dt>Reg. no.</dt><dd>${esc(v.reg)}</dd></div>` : ''}
        ${v.odo ? `<div><dt>Odometer</dt><dd>${esc(Number(v.odo).toLocaleString('en-IN'))} km</dd></div>` : ''}
        ${v.vin ? `<div><dt>Chassis</dt><dd>${esc(v.vin)}</dd></div>` : ''}
        ${v.class ? `<div><dt>Class</dt><dd>${esc(settings.bike_classes[v.class]?.label || v.class)}</dd></div>` : ''}
      </dl>
    </div>
  </section>

  <table class="lines">
    <thead><tr><th class="c">#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc.</th>${gst ? '<th class="r">GST</th>' : ''}<th class="r">Amount</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="${gst ? 7 : 6}" class="c sub">No items</td></tr>`}</tbody>
  </table>

  <section class="foot">
    <div class="foot-left">
      <div class="words"><span class="lbl">Amount in words</span>${esc(amountInWords(t.total))}</div>
      ${gst && breakdown.length ? `<table class="taxsum"><thead><tr><th>GST rate</th><th class="r">Taxable</th>${doc.options.interState ? '<th class="r">IGST</th>' : '<th class="r">CGST</th><th class="r">SGST</th>'}</tr></thead><tbody>
        ${breakdown.map((b) => `<tr><td>${b.rate}%</td><td class="r">${inr(b.taxable, { symbol: false })}</td>${doc.options.interState ? `<td class="r">${inr(b.tax, { symbol: false })}</td>` : `<td class="r">${inr(Math.floor(b.tax / 2), { symbol: false })}</td><td class="r">${inr(b.tax - Math.floor(b.tax / 2), { symbol: false })}</td>`}</tr>`).join('')}
      </tbody></table>` : ''}
      ${doc.notes ? `<div class="notes"><span class="lbl">Technician notes</span>${esc(doc.notes).replace(/\n/g, '<br>')}</div>` : ''}
      ${v.nextKm || v.nextDate ? `<div class="next"><span class="lbl">Next service due</span>${[v.nextKm ? Number(v.nextKm).toLocaleString('en-IN') + ' km' : '', v.nextDate ? fmtDate(v.nextDate) : ''].filter(Boolean).join(' or ')}, whichever comes first</div>` : ''}
    </div>
    <div class="sums">
      ${sumRow('Labour', inr(t.labour))}
      ${sumRow('Parts', inr(t.parts))}
      ${t.discount ? sumRow('Line discounts', '−' + inr(t.discount), 'muted') : ''}
      ${sumRow('Taxable value', inr(t.taxable), 'strong')}
      ${gst ? (doc.options.interState ? sumRow('IGST', inr(t.igst)) : sumRow('CGST', inr(t.cgst)) + sumRow('SGST', inr(t.sgst))) : ''}
      ${t.extraDiscount ? sumRow('Discount', '−' + inr(t.extraDiscount)) : ''}
      ${t.roundOff ? sumRow('Round off', (t.roundOff > 0 ? '+' : '−') + inr(Math.abs(t.roundOff)), 'muted') : ''}
      <div class="grand"><span>Total</span><span>${inr(t.total)}</span></div>
      ${isInvoice && paid ? sumRow(`Paid${doc.payment.method ? ' (' + esc(doc.payment.method) + ')' : ''}`, inr(paid)) + sumRow('Balance due', inr(balance), 'strong') : ''}
    </div>
  </section>

  <footer class="inv-foot">
    <div>
      ${settings.upi_id || settings.bank_account ? `<div class="lbl">Payment</div>
        ${settings.upi_id ? `<div>UPI: <strong>${esc(settings.upi_id)}</strong></div>` : ''}
        ${settings.bank_account ? `<div>${esc(settings.bank_name)} · A/c ${esc(settings.bank_account)} · IFSC ${esc(settings.bank_ifsc)}</div>` : ''}` : ''}
      ${settings.invoice_terms ? `<div class="terms"><span class="lbl">Terms</span>${esc(settings.invoice_terms)}</div>` : ''}
    </div>
    <div class="sign">
      <div class="sign-line"></div>
      For ${esc(settings.legal_name || settings.name)}<br><span class="sub">Authorised signatory</span>
    </div>
  </footer>
  ${!isInvoice ? '<p class="est-note">This is an estimate, not a tax invoice. Final amount may vary after inspection. Nothing beyond this estimate will be done without your approval.</p>' : ''}
</main>
</body></html>`;
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
