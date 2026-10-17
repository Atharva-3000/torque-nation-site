// Torque Nation — admin panel (vanilla ES modules, hash routing).
import { computeTotals, inr, rupees } from './calc.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const modal = $('#modal');
let boot = null;
let dirty = false;

// ---- API ------------------------------------------------------------------
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api/' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'tn-admin' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) { location.href = '/admin/login'; throw new Error('Signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(j.error || ({
      413: 'Too much data in one save. Add photos a few at a time.',
      429: 'Too many requests. Wait a minute and try again.',
      502: 'The server had a problem. Please try again.', 503: 'The server is busy. Please try again.', 504: 'The server took too long. Please try again.',
    })[r.status] || `Request failed (${r.status})`);
  }
  if (r.headers.get('X-TN-Purge') && !['ok', 'local'].includes(r.headers.get('X-TN-Purge'))) {
    console.warn('Saved, but the website cache could not be refreshed:', r.headers.get('X-TN-Purge'));
  }
  return j;
}

// Images go up one per request (Vercel caps a request at 4.5 MB) and come back
// as /uploads/... URLs that the save then refers to.
async function uploadImage(file, maxW, quality, alpha) {
  const data = await readImage(file, maxW, quality, alpha);
  return (await api('upload', { method: 'POST', body: { data } })).url;
}

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'error' ? ' toast--danger' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3600);
}
const fail = (e) => toast(e.message, 'error');

function openModal(html, onReady) {
  $('.modal__panel', modal).innerHTML = html;
  modal.showModal();
  $$('[data-close]', modal).forEach((b) => b.addEventListener('click', () => modal.close()));
  onReady && onReady($('.modal__panel', modal));
}
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const fmtDate = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const classLabel = (k) => (boot.settings.bike_classes[k] ? `${boot.settings.bike_classes[k].label} · ${boot.settings.bike_classes[k].name}` : '—');

const STATUS = {
  paid: ['ok', 'Paid'], partial: ['warn', 'Partial'], unpaid: ['danger', 'Unpaid'], void: ['', 'Void'],
  draft: ['', 'Draft'], sent: ['info', 'Sent'], approved: ['ok', 'Approved'], declined: ['danger', 'Declined'],
  new: ['danger', 'New'], contacted: ['warn', 'Contacted'], booked: ['ok', 'Booked'], closed: ['', 'Closed'],
};
const badge = (s) => `<span class="badge ${STATUS[s]?.[0] ? 'badge--' + STATUS[s][0] : ''}">${esc(STATUS[s]?.[1] || s)}</span>`;

function readImage(file, maxW = 1600, quality = 0.82, alpha = true) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') {
      const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(file); return;
    }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const keepAlpha = alpha && (file.type === 'image/png' || file.type === 'image/webp');
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', quality));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = URL.createObjectURL(file);
  });
}

// ---- Router ---------------------------------------------------------------
const routes = [
  [/^$/, dashboard],
  [/^documents$/, documentsList],
  [/^documents\/new$/, (m, q) => docEditor(null, q.get('type') || 'invoice', q)],
  [/^documents\/(\d+)$/, (m) => docEditor(Number(m[1]))],
  [/^bookings$/, bookingsPage],
  [/^rates$/, ratesPage],
  [/^brands$/, brandsPage],
  [/^portfolio$/, portfolioPage],
  [/^bikes$/, bikesPage],
  [/^parts$/, partsPage],
  [/^settings$/, settingsPage],
];

let lastHash = location.hash;
async function route() {
  if (dirty && !confirm('You have unsaved changes. Leave without saving?')) { history.replaceState(null, '', lastHash || '#/'); return; }
  dirty = false;
  lastHash = location.hash;
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const q = new URLSearchParams(qs || '');
  $$('.admin-nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.route === path.split('/')[0]));
  $$('.admin-nav a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
  $('[data-side]').classList.remove('is-open');
  for (const [re, fn] of routes) {
    const m = re.exec(path);
    if (m) {
      view.onclick = view.onchange = null;
      view.innerHTML = '<div class="admin-page"><p class="muted">Loading…</p></div>';
      try { await fn(m, q); } catch (e) { view.innerHTML = `<div class="admin-page"><div class="alert alert--danger">${esc(e.message)}</div></div>`; }
      view.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      return;
    }
  }
  view.innerHTML = '<div class="admin-page"><h1>Not found</h1></div>';
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

$('[data-side-toggle]').addEventListener('click', () => $('[data-side]').classList.toggle('is-open'));
$('[data-logout]').addEventListener('click', async () => { await api('logout', { method: 'POST' }).catch(() => {}); location.href = '/admin/login'; });

async function refreshBookingCount() {
  const s = await api('stats');
  const el = $('[data-new-bookings]');
  el.hidden = !s.newBookings; el.textContent = s.newBookings;
  return s;
}

// ---- Dashboard -------------------------------------------------------------
async function dashboard() {
  const [s, docs] = await Promise.all([refreshBookingCount(), api('documents')]);
  const warn = [];
  if (/0000/.test(boot.settings.phone)) warn.push('Business phone and WhatsApp are still placeholders.');
  if (boot.settings.gst_enabled && !boot.settings.gstin) warn.push('GST is on but no GSTIN is set. Invoices will print as "Invoice", not "Tax Invoice".');
  view.innerHTML = `<div class="admin-page">
    <div class="admin-head"><div><h1>Dashboard</h1><p>${esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div>
      <div class="btn-row"><a class="btn btn--secondary" href="#/documents/new?type=estimate">+ Estimate</a><a class="btn btn--primary" href="#/documents/new?type=invoice">+ Invoice</a></div></div>
    ${warn.length ? `<div class="alert alert--warn" style="margin-bottom:var(--s-5)">${warn.map(esc).join('<br>')} <a href="#/settings">Fix in settings →</a></div>` : ''}
    <div class="stats">
      <div class="stat"><div class="stat__label">Billed this month</div><div class="stat__value">${inr(s.month, { decimals: 0 })}</div><div class="stat__sub">${s.invoicesThisMonth} invoices</div></div>
      <div class="stat"><div class="stat__label">Collected this month</div><div class="stat__value">${inr(s.collected, { decimals: 0 })}</div></div>
      <div class="stat"><div class="stat__label">Outstanding</div><div class="stat__value" style="${s.outstanding ? 'color:var(--warn-500)' : ''}">${inr(s.outstanding, { decimals: 0 })}</div><div class="stat__sub">All unpaid & partial</div></div>
      <div class="stat"><div class="stat__label">Open estimates</div><div class="stat__value">${s.openEstimates}</div></div>
      <div class="stat"><div class="stat__label">New booking requests</div><div class="stat__value" style="${s.newBookings ? 'color:var(--accent)' : ''}">${s.newBookings}</div><div class="stat__sub"><a href="#/bookings">View →</a></div></div>
    </div>
    <div class="panel"><div class="panel__head"><h2>Recent documents</h2><a class="btn btn--ghost btn--sm" href="#/documents">All →</a></div>
      ${docTable(docs.slice(0, 10))}</div>
  </div>`;
  bindRowLinks();
}

function docTable(docs) {
  if (!docs.length) return '<div class="panel__body"><div class="empty"><h3>Nothing yet</h3><p>Create your first invoice or estimate.</p></div></div>';
  return `<div class="table-wrap"><table class="table"><thead><tr><th>No.</th><th>Date</th><th>Customer</th><th>Bike</th><th>Status</th><th class="r">Total</th></tr></thead><tbody>
    ${docs.map((d) => `<tr data-href="#/documents/${d.id}">
      <td class="mono nowrap"><a href="#/documents/${d.id}" style="text-decoration:none">${esc(d.number)}</a></td>
      <td class="nowrap">${fmtDate(d.date)}</td>
      <td>${esc(d.customer.name || '—')}<div class="muted" style="font-size:var(--fs-xs)">${esc(d.customer.phone)}</div></td>
      <td>${esc([d.vehicle.make, d.vehicle.model].filter(Boolean).join(' ') || '—')}<div class="muted mono" style="font-size:var(--fs-xs)">${esc(d.vehicle.reg)}</div></td>
      <td>${d.doc_type === 'estimate' ? '<span class="badge badge--info">Estimate</span> ' : ''}${badge(d.status)}</td>
      <td class="money">${inr(d.totals.total)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function bindRowLinks() {
  $$('tr[data-href]', view).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a,button,select,input')) location.hash = tr.dataset.href; }));
}

// ---- Documents list --------------------------------------------------------
async function documentsList(m, q) {
  const type = q.get('type') || '', status = q.get('status') || '', search = q.get('q') || '';
  const params = new URLSearchParams(); if (type) params.set('type', type); if (status) params.set('status', status); if (search) params.set('q', search);
  const docs = await api('documents?' + params);
  const statuses = type === 'estimate' ? ['draft', 'sent', 'approved', 'declined'] : type === 'invoice' ? ['unpaid', 'partial', 'paid', 'void'] : [];
  const link = (patch) => { const p = new URLSearchParams({ type, status, q: search, ...patch }); [...p].forEach(([k, v]) => !v && p.delete(k)); return '#/documents' + (p.toString() ? '?' + p : ''); };
  view.innerHTML = `<div class="admin-page">
    <div class="admin-head"><div><h1>Invoices &amp; estimates</h1><p>${docs.length} shown</p></div>
      <div class="btn-row"><a class="btn btn--secondary" href="#/documents/new?type=estimate">+ Estimate</a><a class="btn btn--primary" href="#/documents/new?type=invoice">+ Invoice</a></div></div>
    <div class="toolbar-row">
      <div class="segmented">${[['', 'All'], ['invoice', 'Invoices'], ['estimate', 'Estimates']].map(([k, l]) => `<button type="button" aria-pressed="${type === k}" data-go="${link({ type: k, status: '' })}">${l}</button>`).join('')}</div>
      ${statuses.length ? `<div class="chip-row">${['', ...statuses].map((s) => `<button class="chip" type="button" aria-pressed="${status === s}" data-go="${link({ status: s })}">${s ? STATUS[s][1] : 'Any status'}</button>`).join('')}</div>` : ''}
      <span class="spacer"></span>
      <form data-search><input class="input" type="search" name="q" value="${esc(search)}" placeholder="Search number, name, phone, reg…"></form>
    </div>
    <div class="panel">${docTable(docs)}</div></div>`;
  $$('[data-go]', view).forEach((b) => b.addEventListener('click', () => (location.hash = b.dataset.go)));
  $('[data-search]', view).addEventListener('submit', (e) => { e.preventDefault(); location.hash = link({ q: e.target.q.value.trim() }); });
  bindRowLinks();
}

// ---- Document editor -------------------------------------------------------
async function docEditor(id, newType, q) {
  const s = boot.settings;
  let doc;
  if (id) doc = await api('documents/' + id);
  else {
    doc = {
      doc_type: newType === 'estimate' ? 'estimate' : 'invoice', date: today(), status: newType === 'estimate' ? 'draft' : 'unpaid',
      customer: { name: q?.get('name') || '', phone: q?.get('phone') || '', email: '', address: '', gstin: '', state: '' },
      vehicle: { make: '', model: q?.get('bike') || '', class: '', reg: '', vin: '', odo: '', nextKm: '', nextDate: '' },
      items: [], options: { gstEnabled: !!s.gst_enabled, interState: false, extraDiscount: 0, validDays: 7, jobCard: '' },
      payment: { paid: 0, method: '', ref: '' }, notes: '',
    };
    if (doc.vehicle.model) matchBike(doc.vehicle);
  }
  const isEst = doc.doc_type === 'estimate';
  const typeName = isEst ? 'Estimate' : 'Invoice';

  view.innerHTML = `<div class="admin-page">
    <div class="admin-head">
      <div><p class="eyebrow">${typeName}${doc.number ? ' · <span class="mono">' + esc(doc.number) + '</span>' : ' · new'}</p>
        <h1>${id ? esc(doc.customer.name || typeName) : 'New ' + typeName.toLowerCase()}</h1>
        ${doc.source_id ? `<p>Created from <a href="#/documents/${doc.source_id}">estimate</a></p>` : ''}</div>
      <div class="btn-row">${id ? badge(doc.status) : ''}</div>
    </div>
    <form class="editor" data-editor novalidate>
      <div class="editor__main">
        <section class="panel"><div class="panel__head"><h2>Customer</h2><span class="field__hint" data-cust-hint></span></div><div class="panel__body">
          <div class="form-grid form-grid--3">
            <div class="field"><label>Phone</label><input class="input" name="c.phone" type="tel" value="${esc(doc.customer.phone)}" placeholder="98xxxxxxxx"></div>
            <div class="field"><label>Name</label><input class="input" name="c.name" value="${esc(doc.customer.name)}" required></div>
            <div class="field"><label>Email</label><input class="input" name="c.email" type="email" value="${esc(doc.customer.email)}"></div>
            <div class="field span-all"><label>Address</label><input class="input" name="c.address" value="${esc(doc.customer.address)}"></div>
            <div class="field"><label>Customer GSTIN <span class="muted">(B2B only)</span></label><input class="input mono" name="c.gstin" value="${esc(doc.customer.gstin)}" maxlength="15"></div>
            <div class="field" data-show-inter><label>Customer state</label><input class="input" name="c.state" value="${esc(doc.customer.state)}"></div>
          </div></div></section>

        <section class="panel"><div class="panel__head"><h2>Motorcycle</h2></div><div class="panel__body">
          <div class="form-grid form-grid--3">
            <div class="field"><label>Model</label><input class="input" name="v.model" list="adm-bikes" value="${esc([doc.vehicle.make, doc.vehicle.model].filter(Boolean).join(' '))}" placeholder="Search model…"><span class="field__hint" data-class-hint></span></div>
            <div class="field"><label>Pricing class</label><select class="select" name="v.class"><option value="">Choose…</option>${['A', 'B', 'C'].map((k) => `<option value="${k}" ${doc.vehicle.class === k ? 'selected' : ''}>${esc(classLabel(k))}</option>`).join('')}</select></div>
            <div class="field"><label>Registration no.</label><input class="input mono" name="v.reg" value="${esc(doc.vehicle.reg)}" placeholder="MP43 AB 1234"></div>
            <div class="field"><label>Odometer (km)</label><input class="input input--num" name="v.odo" inputmode="numeric" value="${esc(doc.vehicle.odo)}"></div>
            <div class="field"><label>Chassis / VIN</label><input class="input mono" name="v.vin" value="${esc(doc.vehicle.vin)}"></div>
            <div class="field"><label>Job card no.</label><input class="input mono" name="o.jobCard" value="${esc(doc.options.jobCard)}"></div>
          </div>
          <datalist id="adm-bikes">${boot.bikes.map((b) => `<option value="${esc(b.brand + ' ' + b.model)}"></option>`).join('')}</datalist>
        </div></section>

        <section class="panel"><div class="panel__head"><h2>Work &amp; parts</h2><span class="field__hint">Rates in ₹, before GST</span></div>
          <div class="table-wrap" style="border:0"><table class="lines"><thead><tr><th>Description</th><th>${'SAC/HSN'}</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th><th class="r">Disc %</th><th class="r" data-gst-col>GST %</th><th class="r">Amount</th><th></th></tr></thead><tbody data-lines></tbody></table></div>
          <div class="add-row">
            <button class="btn btn--secondary btn--sm" type="button" data-add="service">+ Service from rate card</button>
            <button class="btn btn--secondary btn--sm" type="button" data-add="part">+ Part</button>
            <button class="btn btn--ghost btn--sm" type="button" data-add="custom">+ Custom line</button>
          </div>
        </section>

        <section class="panel"><div class="panel__head"><h2>Notes &amp; next service</h2></div><div class="panel__body">
          <div class="form-grid form-grid--2">
            <div class="field span-all"><label>Technician notes <span class="muted">(printed)</span></label><textarea class="textarea" name="notes" placeholder="Findings, readings, recommendations…">${esc(doc.notes)}</textarea></div>
            <div class="field"><label>Next service at (km)</label><input class="input input--num" name="v.nextKm" inputmode="numeric" value="${esc(doc.vehicle.nextKm)}"></div>
            <div class="field"><label>or by date</label><input class="input" type="date" name="v.nextDate" value="${esc(doc.vehicle.nextDate)}"></div>
          </div></div></section>
      </div>

      <aside class="editor__side">
        <section class="panel"><div class="panel__head"><h2>${typeName} details</h2></div><div class="panel__body">
          <div class="field"><label>Date</label><input class="input" type="date" name="date" value="${esc(doc.date)}"></div>
          ${isEst ? `<div class="form-grid form-grid--2"><div class="field"><label>Valid for (days)</label><input class="input input--num" name="o.validDays" value="${esc(doc.options.validDays)}"></div>
            <div class="field"><label>Status</label><select class="select" name="status">${['draft', 'sent', 'approved', 'declined'].map((x) => `<option value="${x}" ${doc.status === x ? 'selected' : ''}>${STATUS[x][1]}</option>`).join('')}</select></div></div>` : ''}
          <label class="check"><input type="checkbox" name="o.gstEnabled" ${doc.options.gstEnabled ? 'checked' : ''}> Charge GST</label>
          <label class="check" data-gst-only><input type="checkbox" name="o.interState" ${doc.options.interState ? 'checked' : ''}> Inter-state (IGST)</label>
          <div class="field"><label>Extra discount (₹)</label><input class="input input--num" name="o.extraDiscount" inputmode="decimal" value="${esc(doc.options.extraDiscount || '')}" placeholder="0"></div>
          <div class="sumlist" data-sums></div>
          ${!isEst ? `<hr style="margin:var(--s-2) 0">
            <div class="form-grid form-grid--2">
              <div class="field"><label>Amount paid (₹)</label><input class="input input--num" name="p.paid" inputmode="decimal" value="${esc(doc.payment.paid || '')}" placeholder="0"></div>
              <div class="field"><label>Method</label><select class="select" name="p.method">${['', 'Cash', 'UPI', 'Card', 'Bank transfer', 'Cheque'].map((x) => `<option ${doc.payment.method === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
            </div>
            <div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-paid-full>Mark fully paid</button>
              <label class="check" style="margin-left:auto"><input type="checkbox" name="status-void" ${doc.status === 'void' ? 'checked' : ''}> Void</label></div>` : ''}
          <button class="btn btn--primary btn--lg btn--block" type="submit">${id ? 'Save changes' : 'Save ' + typeName.toLowerCase()}</button>
          ${id ? `<div class="btn-row">
            <a class="btn btn--secondary btn--sm" href="/admin/print/${id}" target="_blank" rel="noopener" data-print>Print / PDF</a>
            ${isEst ? '<button class="btn btn--secondary btn--sm" type="button" data-convert>Convert to invoice</button>' : ''}
            <button class="btn btn--ghost btn--sm" type="button" data-duplicate>Duplicate</button>
            <button class="btn btn--danger btn--sm" type="button" data-delete>Delete</button></div>` : ''}
        </div></section>
      </aside>
    </form></div>`;

  const form = $('[data-editor]', view);
  const linesEl = $('[data-lines]', form);
  let items = doc.items.map((x) => ({ ...x }));

  const gstOn = () => form.elements['o.gstEnabled'].checked;
  const opts = () => ({ gstEnabled: gstOn(), interState: form.elements['o.interState'].checked, extraDiscount: Number(form.elements['o.extraDiscount'].value) || 0 });

  function renderLines() {
    const g = gstOn();
    $('[data-gst-col]', form).style.display = g ? '' : 'none';
    if (!items.length) {
      linesEl.innerHTML = `<tr><td colspan="9"><div class="empty" style="padding:var(--s-6)">No lines yet. Add a service from the rate card, a part, or a custom line.</div></td></tr>`;
    } else {
      linesEl.innerHTML = items.map((it, i) => `<tr data-i="${i}">
        <td class="c-desc"><input class="input" data-f="description" value="${esc(it.description)}" placeholder="Description">
          <div class="line-note"><input class="input" data-f="note" value="${esc(it.note || '')}" placeholder="Note (optional)"></div>
          <span class="kind kind-toggle"><button type="button" data-kind="labour" aria-pressed="${it.kind !== 'part'}">Labour</button><button type="button" data-kind="part" aria-pressed="${it.kind === 'part'}">Part</button></span></td>
        <td data-label="SAC/HSN"><input class="input mono w-code" data-f="code" value="${esc(it.code || '')}"></td>
        <td data-label="Qty"><input class="input input--num w-qty" data-f="qty" inputmode="decimal" value="${esc(it.qty)}"></td>
        <td data-label="Unit"><input class="input w-unit" data-f="unit" value="${esc(it.unit || '')}"></td>
        <td data-label="Rate ₹"><input class="input input--num w-rate" data-f="rate" inputmode="decimal" value="${esc(it.rate)}"></td>
        <td data-label="Disc %"><input class="input input--num w-pct" data-f="discount" inputmode="decimal" value="${esc(it.discount || '')}" placeholder="0"></td>
        <td data-label="GST %" style="${g ? '' : 'display:none'}"><input class="input input--num w-pct" data-f="gst" inputmode="decimal" value="${esc(it.gst)}"></td>
        <td class="c-amt" data-label="Amount"><div class="amt w-amt" data-amt></div></td>
        <td><button class="btn btn--ghost btn--icon btn--sm" type="button" data-remove aria-label="Remove line">✕</button></td></tr>`).join('');
    }
    recalc();
  }

  function recalc() {
    const t = computeTotals(items, opts());
    $$('[data-i]', linesEl).forEach((tr) => { const l = t.lines[Number(tr.dataset.i)]; $('[data-amt]', tr).textContent = l ? inr(l.taxable) : ''; });
    const g = gstOn(), inter = form.elements['o.interState'].checked;
    $$('[data-gst-only]', form).forEach((el) => (el.style.display = g ? '' : 'none'));
    $$('[data-show-inter]', form).forEach((el) => (el.style.display = g && inter ? '' : 'none'));
    const paidEl = form.elements['p.paid'];
    const paid = paidEl ? Math.round((Number(paidEl.value) || 0) * 100) : 0;
    $('[data-sums]', form).innerHTML = `
      <div><span>Labour</span><span>${inr(t.labour)}</span></div>
      <div><span>Parts</span><span>${inr(t.parts)}</span></div>
      ${t.discount ? `<div><span>Line discounts</span><span>−${inr(t.discount)}</span></div>` : ''}
      <div><span>Taxable</span><span>${inr(t.taxable)}</span></div>
      ${g ? (inter ? `<div><span>IGST</span><span>${inr(t.igst)}</span></div>` : `<div><span>CGST</span><span>${inr(t.cgst)}</span></div><div><span>SGST</span><span>${inr(t.sgst)}</span></div>`) : ''}
      ${t.extraDiscount ? `<div><span>Discount</span><span>−${inr(t.extraDiscount)}</span></div>` : ''}
      ${t.roundOff ? `<div><span>Round off</span><span>${t.roundOff > 0 ? '+' : '−'}${inr(Math.abs(t.roundOff))}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${inr(t.total)}</span></div>
      ${paidEl && paid ? `<div><span>Balance</span><span style="color:${t.total - paid > 0 ? 'var(--warn-500)' : 'var(--ok-500)'}">${inr(t.total - paid)}</span></div>` : ''}`;
    return t;
  }

  linesEl.addEventListener('input', (e) => {
    const tr = e.target.closest('[data-i]'); if (!tr) return;
    const it = items[Number(tr.dataset.i)], f = e.target.dataset.f;
    it[f] = ['qty', 'rate', 'discount', 'gst'].includes(f) ? e.target.value.replace(/[^\d.]/g, '') : e.target.value;
    dirty = true; recalc();
  });
  linesEl.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-i]'); if (!tr) return;
    const i = Number(tr.dataset.i);
    if (e.target.closest('[data-remove]')) { items.splice(i, 1); dirty = true; renderLines(); }
    const k = e.target.closest('[data-kind]');
    if (k) { items[i].kind = k.dataset.kind; dirty = true; renderLines(); }
  });

  form.addEventListener('input', (e) => { if (!e.target.closest('[data-lines]')) { dirty = true; recalc(); } });
  form.elements['o.gstEnabled'].addEventListener('change', renderLines);

  // Bike model → make + class
  const modelInput = form.elements['v.model'], classSel = form.elements['v.class'];
  const hint = $('[data-class-hint]', form);
  modelInput.addEventListener('change', () => {
    const v = { model: modelInput.value };
    if (matchBike(v)) {
      hint.textContent = `${classLabel(v.class)}`;
      if (classSel.value !== v.class) { classSel.value = v.class; reprice(); }
    } else hint.textContent = modelInput.value ? 'Not in the bike list: pick a class.' : '';
  });
  classSel.addEventListener('change', reprice);
  function reprice() {
    const k = classSel.value; if (!k) return;
    let n = 0;
    items.forEach((it) => {
      const c = it.catalogId && boot.catalog.items.find((x) => x.id === it.catalogId);
      if (c && typeof c.prices[k] === 'number' && Number(it.rate) !== c.prices[k]) { it.rate = c.prices[k]; n++; }
    });
    if (n) { toast(`Repriced ${n} line${n > 1 ? 's' : ''} for ${classLabel(k)}`); renderLines(); }
  }

  // Returning customer lookup by phone
  form.elements['c.phone'].addEventListener('change', async (e) => {
    const phone = e.target.value.replace(/\D/g, '').slice(-10);
    if (phone.length < 10 || id) return;
    const found = (await api('documents?q=' + phone).catch(() => []))[0];
    if (!found) return;
    const set = (n, v) => { if (form.elements[n] && !form.elements[n].value && v) form.elements[n].value = v; };
    set('c.name', found.customer.name); set('c.email', found.customer.email); set('c.address', found.customer.address); set('c.gstin', found.customer.gstin);
    if (!modelInput.value) {
      modelInput.value = [found.vehicle.make, found.vehicle.model].filter(Boolean).join(' ');
      set('v.reg', found.vehicle.reg); set('v.vin', found.vehicle.vin);
      if (found.vehicle.class) { classSel.value = found.vehicle.class; }
    }
    $('[data-cust-hint]', form).textContent = `Returning customer · last visit ${fmtDate(found.date)} (${found.number})`;
  });

  // Add lines
  $$('[data-add]', form).forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.add;
    if (t === 'custom') { items.push({ kind: 'labour', description: '', code: '998714', qty: 1, unit: '', rate: 0, discount: 0, gst: 18 }); dirty = true; renderLines(); $$('[data-f="description"]', linesEl).at(-1).focus(); }
    if (t === 'service') servicePicker(classSel.value, (it) => { items.push(it); dirty = true; renderLines(); });
    if (t === 'part') partPicker((it) => { items.push(it); dirty = true; renderLines(); setTimeout(() => $$('[data-f="rate"]', linesEl).at(-1)?.focus(), 50); });
  }));

  const paidFull = $('[data-paid-full]', form);
  if (paidFull) paidFull.addEventListener('click', () => { form.elements['p.paid'].value = (recalc().total / 100).toFixed(2); if (!form.elements['p.method'].value) form.elements['p.method'].value = 'UPI'; dirty = true; recalc(); });

  function collect() {
    const f = form.elements;
    const v = { model: modelInput.value };
    matchBike(v);
    return {
      doc_type: doc.doc_type, date: f.date.value,
      status: isEst ? f.status.value : (f['status-void']?.checked ? 'void' : ''),
      customer: { name: f['c.name'].value, phone: f['c.phone'].value, email: f['c.email'].value, address: f['c.address'].value, gstin: f['c.gstin'].value, state: f['c.state'].value },
      vehicle: { make: v.make || '', model: v.make ? v.model : modelInput.value, class: classSel.value, reg: f['v.reg'].value, vin: f['v.vin'].value, odo: f['v.odo'].value, nextKm: f['v.nextKm'].value, nextDate: f['v.nextDate'].value },
      options: { ...opts(), validDays: f['o.validDays'] ? Number(f['o.validDays'].value) || 7 : 7, jobCard: f['o.jobCard'].value },
      payment: { paid: f['p.paid'] ? Number(f['p.paid'].value) || 0 : 0, method: f['p.method'] ? f['p.method'].value : '' },
      notes: f.notes.value,
      items: items.map((it) => ({ ...it, qty: Number(it.qty) || 0, rate: Number(it.rate) || 0, discount: Number(it.discount) || 0, gst: Number(it.gst) || 0 })),
    };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = collect();
    if (!body.customer.name.trim()) { toast('Add the customer name.', 'error'); form.elements['c.name'].focus(); return; }
    if (!body.items.some((i) => i.description.trim())) { toast('Add at least one line.', 'error'); return; }
    try {
      const saved = id ? await api('documents/' + id, { method: 'PUT', body }) : await api('documents', { method: 'POST', body });
      dirty = false;
      toast(`${typeName} ${saved.number} saved`);
      if (!id) location.hash = '#/documents/' + saved.id; else docEditor(id);
    } catch (err) { fail(err); }
  });

  const printLink = $('[data-print]', form);
  if (printLink) printLink.addEventListener('click', (e) => { if (dirty) { e.preventDefault(); toast('Save your changes first, then print.', 'error'); } });
  const conv = $('[data-convert]', form);
  if (conv) conv.addEventListener('click', async () => {
    if (dirty) return toast('Save your changes first.', 'error');
    if (!confirm('Create an invoice from this estimate?')) return;
    try { const inv = await api(`documents/${id}/convert`, { method: 'POST' }); toast(`Invoice ${inv.number} created`); location.hash = '#/documents/' + inv.id; } catch (err) { fail(err); }
  });
  const dup = $('[data-duplicate]', form);
  if (dup) dup.addEventListener('click', async () => {
    try { const d = await api(`documents/${id}/duplicate`, { method: 'POST' }); dirty = false; toast(`Copied as ${d.number}`); location.hash = '#/documents/' + d.id; } catch (err) { fail(err); }
  });
  const del = $('[data-delete]', form);
  if (del) del.addEventListener('click', async () => {
    if (!confirm(`Delete ${doc.number}? This cannot be undone. For issued invoices, marking them Void is usually better.`)) return;
    try { await api('documents/' + id, { method: 'DELETE' }); dirty = false; toast('Deleted'); location.hash = '#/documents'; } catch (err) { fail(err); }
  });

  if (doc.vehicle.class) hint.textContent = classLabel(doc.vehicle.class);
  renderLines();
}

function matchBike(v) {
  const q = String(v.model || '').trim().toLowerCase();
  if (!q) return false;
  const hit = boot.bikes.find((b) => `${b.brand} ${b.model}`.toLowerCase() === q) || boot.bikes.find((b) => b.model.toLowerCase() === q);
  if (!hit) return false;
  v.make = hit.brand; v.model = hit.model; v.class = hit.class;
  return true;
}

function servicePicker(cls, onPick) {
  const { categories, items } = boot.catalog;
  let cat = '', search = '';
  openModal(`<div class="modal__head"><h2>Add service</h2><button class="btn btn--ghost btn--icon" data-close aria-label="Close">✕</button></div>
    <div class="modal__body">
      ${cls ? `<p class="field__hint">Prices for <strong>${esc(classLabel(cls))}</strong></p>` : '<div class="alert alert--warn">No bike class chosen. Prices will use Class A; set the class to reprice.</div>'}
      <input class="input" type="search" placeholder="Search services…" data-q style="margin-top:var(--s-3)">
      <div class="chip-row" style="margin-top:var(--s-3)"><button class="chip" aria-pressed="true" data-cat="">All</button>${categories.map((c) => `<button class="chip" aria-pressed="false" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>
      <div class="picker-list" data-list></div></div>`, (p) => {
    const k = cls || 'A';
    const draw = () => {
      const list = items.filter((i) => (!cat || i.category === cat) && (!search || (i.name + ' ' + i.summary).toLowerCase().includes(search)));
      $('[data-list]', p).innerHTML = list.map((i) => `<button type="button" class="picker-item" data-id="${esc(i.id)}"><span><strong>${esc(i.name)}</strong><small>${esc(categories.find((c) => c.id === i.category)?.name || '')}${i.public ? '' : ' · hidden from website'}</small></span>
        <span class="mono">${typeof i.prices[k] === 'number' ? (i.from ? 'from ' : '') + rupees(i.prices[k]) : 'On quote'}</span></button>`).join('') || '<p class="muted" style="padding:var(--s-4)">No match.</p>';
    };
    draw();
    $('[data-q]', p).addEventListener('input', (e) => { search = e.target.value.toLowerCase(); draw(); });
    $('[data-q]', p).focus();
    $$('[data-cat]', p).forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat; $$('[data-cat]', p).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }));
    $('[data-list]', p).addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      const i = items.find((x) => x.id === b.dataset.id);
      onPick({ kind: 'labour', catalogId: i.id, description: i.name, note: '', code: i.sac || '998714', qty: 1, unit: '', rate: typeof i.prices[k] === 'number' ? i.prices[k] : 0, discount: 0, gst: 18 });
      modal.close();
    });
  });
}

function partPicker(onPick) {
  openModal(`<div class="modal__head"><h2>Add part</h2><button class="btn btn--ghost btn--icon" data-close aria-label="Close">✕</button></div>
    <div class="modal__body">
      <input class="input" type="search" placeholder="Search or type a new part name…" data-q>
      <div class="picker-list" data-list></div></div>`, (p) => {
    const draw = (q = '') => {
      const list = boot.parts.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
      $('[data-list]', p).innerHTML = (q ? `<button type="button" class="picker-item" data-new><span><strong>Add "${esc(q)}"</strong><small>Custom part</small></span><span class="mono">+</span></button>` : '') +
        list.map((x) => `<button type="button" class="picker-item" data-id="${x.id}"><span><strong>${esc(x.name)}</strong><small>HSN ${esc(x.hsn || '—')} · GST ${x.gst}%</small></span><span class="mono">${esc(x.unit || '')}</span></button>`).join('');
    };
    draw();
    const qEl = $('[data-q]', p);
    qEl.focus();
    qEl.addEventListener('input', () => draw(qEl.value));
    $('[data-list]', p).addEventListener('click', (e) => {
      const b = e.target.closest('.picker-item'); if (!b) return;
      if (b.hasAttribute('data-new')) onPick({ kind: 'part', description: qEl.value.trim(), note: '', code: '8714', qty: 1, unit: 'pc', rate: 0, discount: 0, gst: 18 });
      else { const x = boot.parts.find((y) => String(y.id) === b.dataset.id); onPick({ kind: 'part', description: x.name, note: '', code: x.hsn || '', qty: 1, unit: x.unit || '', rate: 0, discount: 0, gst: x.gst }); }
      modal.close();
    });
  });
}

// ---- Bookings ----------------------------------------------------------------
async function bookingsPage() {
  const rows = await api('bookings');
  const draw = (rows) => {
    view.innerHTML = `<div class="admin-page">
      <div class="admin-head"><div><h1>Booking requests</h1><p>From the website form. Call or WhatsApp to confirm, then turn it into an estimate.</p></div></div>
      <div class="panel">${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Received</th><th>Customer</th><th>Bike & service</th><th>Preferred</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((b) => `<tr>
          <td class="nowrap">${esc(new Date(b.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}</td>
          <td><strong>${esc(b.name)}</strong><div><a href="tel:${esc(b.phone)}" class="mono" style="font-size:var(--fs-xs)">${esc(b.phone)}</a> · <a class="wa-link" target="_blank" rel="noopener" href="https://wa.me/${esc((b.phone.replace(/\D/g, '').length === 10 ? '91' : '') + b.phone.replace(/\D/g, ''))}">WhatsApp</a></div></td>
          <td>${esc(b.bike || '—')}<div class="muted" style="font-size:var(--fs-xs)">${esc(b.service || '')}</div></td>
          <td class="nowrap">${esc(fmtDate(b.preferred_date) || '—')}</td>
          <td style="max-width:280px;font-size:var(--fs-xs)" class="soft">${esc(b.message || '')}</td>
          <td><select class="select" style="min-height:34px;font-size:var(--fs-xs);width:auto" data-status="${b.id}">${['new', 'contacted', 'booked', 'closed'].map((s) => `<option value="${s}" ${b.status === s ? 'selected' : ''}>${STATUS[s][1]}</option>`).join('')}</select></td>
          <td class="nowrap"><a class="btn btn--secondary btn--sm" href="#/documents/new?type=estimate&name=${encodeURIComponent(b.name)}&phone=${encodeURIComponent(b.phone)}&bike=${encodeURIComponent(b.bike || '')}">Estimate</a>
            <button class="btn btn--ghost btn--sm btn--icon" data-del="${b.id}" aria-label="Delete">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="panel__body"><div class="empty"><h3>No requests yet</h3><p>Requests from the website contact form show up here.</p></div></div>'}</div></div>`;
    $$('[data-status]', view).forEach((s) => s.addEventListener('change', async () => {
      try { await api('bookings/' + s.dataset.status, { method: 'PUT', body: { status: s.value } }); toast('Updated'); } catch (err) { fail(err); }
      refreshBookingCount().catch(() => {});
    }));
    $$('[data-del]', view).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this request?')) return;
      try { draw(await api('bookings/' + b.dataset.del, { method: 'DELETE' })); toast('Deleted'); } catch (err) { fail(err); }
      refreshBookingCount().catch(() => {});
    }));
  };
  draw(rows);
}

// ---- Rate card -----------------------------------------------------------------
async function ratesPage() {
  const { categories, items } = boot.catalog;
  const pv = (v) => (v === null || v === undefined ? '' : v);
  view.innerHTML = `<div class="admin-page">
    <div class="admin-head"><div><h1>Rate card</h1><p>Labour prices by class, in ₹ before GST. Changes go live on the website and in the invoice picker immediately. Leave a price empty for "On quote".</p></div>
      <div class="btn-row"><a class="btn btn--secondary" href="/pricing" target="_blank" rel="noopener">View pricing page ↗</a><button class="btn btn--primary" data-new>+ Add service</button></div></div>
    <div class="alert alert--warn" style="margin-bottom:var(--s-5)">Starting prices are indicative placeholders. Review every line before you go live.</div>
    ${categories.map((c) => `<section class="panel"><div class="panel__head"><h2>${esc(c.name)}</h2><span class="field__hint">${esc(c.summary)}</span></div>
      <div class="table-wrap" style="border:0"><table class="table edit-table"><thead><tr><th>Service</th>${['A', 'B', 'C'].map((k) => `<th class="r">${esc(boot.settings.bike_classes[k].label)}</th>`).join('')}<th>From</th><th>On site</th><th></th></tr></thead><tbody>
      ${items.filter((i) => i.category === c.id).map((i) => `<tr data-id="${esc(i.id)}">
        <td><strong>${esc(i.name)}</strong><div class="muted" style="font-size:var(--fs-xs)">${esc(i.summary)}</div></td>
        ${['A', 'B', 'C'].map((k) => `<td class="w-price"><input class="input input--num" data-price="${k}" inputmode="numeric" value="${pv(i.prices[k])}" placeholder="Quote"></td>`).join('')}
        <td><input type="checkbox" data-flag="from" ${i.from ? 'checked' : ''} aria-label="Show as from-price"></td>
        <td><input type="checkbox" data-flag="public" ${i.public ? 'checked' : ''} aria-label="Show on website"></td>
        <td class="nowrap"><button class="btn btn--ghost btn--sm" data-edit>Edit</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No services in this category.</td></tr>'}
      </tbody></table></div></section>`).join('')}
  </div>`;

  const save = async (item) => {
    try { boot.catalog = await api('catalog/' + encodeURIComponent(item.id), { method: 'PUT', body: item }); toast(`${item.name} saved`); return true; } catch (e) { fail(e); return false; }
  };
  view.onchange = (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const item = structuredClone(boot.catalog.items.find((i) => i.id === tr.dataset.id));
    if (e.target.dataset.price) item.prices[e.target.dataset.price] = e.target.value.trim() === '' ? null : Number(e.target.value.replace(/[^\d.]/g, ''));
    if (e.target.dataset.flag) item[e.target.dataset.flag] = e.target.checked;
    save(item);
  };
  view.onclick = (e) => {
    if (e.target.closest('[data-new]')) return serviceForm({ id: '', category: categories[0].id, name: '', summary: '', includes: [], prices: { A: null, B: null, C: null }, hours: '', sac: '998714', from: false, public: true });
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target.closest('[data-edit]')) serviceForm(structuredClone(boot.catalog.items.find((i) => i.id === tr.dataset.id)));
  };

  function serviceForm(item) {
    const isNew = !item.id;
    openModal(`<form data-f><div class="modal__head"><h2>${isNew ? 'New service' : 'Edit service'}</h2><button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Close">✕</button></div>
      <div class="modal__body"><div class="form-grid form-grid--2">
        <div class="field span-all"><label>Name</label><input class="input" name="name" value="${esc(item.name)}" required></div>
        <div class="field"><label>Category</label><select class="select" name="category">${categories.map((c) => `<option value="${esc(c.id)}" ${item.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Typical time</label><input class="input" name="hours" value="${esc(item.hours)}" placeholder="e.g. 2–4 h"></div>
        <div class="field span-all"><label>Summary</label><textarea class="textarea" name="summary" style="min-height:72px">${esc(item.summary)}</textarea></div>
        <div class="field span-all"><label>What's included <span class="muted">(one per line)</span></label><textarea class="textarea" name="includes">${esc(item.includes.join('\n'))}</textarea></div>
        ${['A', 'B', 'C'].map((k) => `<div class="field"><label>${esc(classLabel(k))} ₹</label><input class="input input--num" name="p${k}" value="${pv(item.prices[k])}" placeholder="On quote"></div>`).join('')}
        <div class="field"><label>SAC code</label><input class="input mono" name="sac" value="${esc(item.sac)}"></div>
        <label class="check"><input type="checkbox" name="from" ${item.from ? 'checked' : ''}> Show as "from" price</label>
        <label class="check"><input type="checkbox" name="public" ${item.public ? 'checked' : ''}> Show on website</label>
      </div></div>
      <div class="modal__foot">${isNew ? '' : '<button type="button" class="btn btn--danger" data-del style="margin-right:auto">Delete</button>'}<button type="button" class="btn" data-close>Cancel</button><button class="btn btn--primary">Save</button></div></form>`, (p) => {
      const f = $('[data-f]', p);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const g = (n) => f.elements[n].value.trim();
        const price = (n) => (g(n) === '' ? null : Number(g(n).replace(/[^\d.]/g, '')));
        const body = { ...item, name: g('name'), category: g('category'), hours: g('hours'), summary: g('summary'), sac: g('sac'), includes: g('includes').split('\n').map((s) => s.trim()).filter(Boolean),
          prices: { A: price('pA'), B: price('pB'), C: price('pC') }, from: f.elements.from.checked, public: f.elements.public.checked };
        if (!body.name) return toast('Name is required', 'error');
        if (isNew) body.id = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36).slice(-4);
        if (await save(body)) { modal.close(); ratesPage(); }
      });
      const d = $('[data-del]', p);
      if (d) d.addEventListener('click', async () => {
        if (!confirm(`Delete "${item.name}"? Existing invoices keep their lines.`)) return;
        try { boot.catalog = await api('catalog/' + encodeURIComponent(item.id), { method: 'DELETE' }); modal.close(); toast('Deleted'); ratesPage(); } catch (err) { fail(err); }
      });
    });
  }
}

// ---- Brands --------------------------------------------------------------------
async function brandsPage() {
  const draw = (rows) => {
    view.innerHTML = `<div class="admin-page">
      <div class="admin-head"><div><h1>Brands we fit</h1><p>Shown on the home page. Upload the official logo (SVG or transparent PNG works best). Without a logo, the name is shown as a wordmark.</p></div>
        <button class="btn btn--primary" data-new>+ Add brand</button></div>
      <div class="alert" style="margin-bottom:var(--s-5)">Use logo files supplied by the brand or your distributor. Only switch on brands you actually stock or fit.</div>
      <div class="panel"><div class="table-wrap" style="border:0"><table class="table edit-table"><thead><tr><th>Logo</th><th>Brand</th><th>Category</th><th>Order</th><th>On site</th><th></th></tr></thead><tbody>
      ${rows.map((b) => `<tr data-id="${b.id}">
        <td><div class="logo-cell">${b.logo ? `<img src="${esc(b.logo)}" alt="">` : '<span>No logo</span>'}</div></td>
        <td><input class="input" data-k="name" value="${esc(b.name)}"></td>
        <td><input class="input" data-k="category" value="${esc(b.category || '')}"></td>
        <td style="width:90px"><input class="input input--num" data-k="sort" value="${b.sort}"></td>
        <td><input type="checkbox" data-k="published" ${b.published ? 'checked' : ''} aria-label="Show on website"></td>
        <td class="nowrap"><label class="btn btn--secondary btn--sm">Upload logo<input type="file" accept="image/svg+xml,image/png,image/webp,image/jpeg" hidden data-logo></label>
          ${b.logo ? '<button class="btn btn--ghost btn--sm" data-rmlogo>Remove logo</button>' : ''}
          <button class="btn btn--ghost btn--sm btn--icon" data-del aria-label="Delete">✕</button></td></tr>`).join('')}
      </tbody></table></div></div></div>`;
  };
  let rows = await api('brands');
  draw(rows);
  const rowData = (tr) => { const b = rows.find((x) => String(x.id) === tr.dataset.id); return { id: b.id, name: $('[data-k="name"]', tr).value, category: $('[data-k="category"]', tr).value, sort: Number($('[data-k="sort"]', tr).value) || 0, published: $('[data-k="published"]', tr).checked }; };
  view.onchange = async (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    try {
      const body = rowData(tr);
      if (e.target.matches('[data-logo]')) {
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 2_000_000) return toast('Logo must be under 2 MB', 'error');
        body.logo = await uploadImage(file, 600, 0.92);
      }
      rows = await api('brands', { method: 'POST', body }); draw(rows); toast('Saved');
    } catch (err) { fail(err); }
  };
  view.onclick = async (e) => {
    if (e.target.closest('[data-new]')) {
      const name = prompt('Brand name'); if (!name) return;
      try { rows = await api('brands', { method: 'POST', body: { name, category: '', published: true, sort: rows.length } }); draw(rows); toast('Saved'); } catch (err) { fail(err); }
      return;
    }
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    try {
      if (e.target.closest('[data-rmlogo]')) { rows = await api('brands', { method: 'POST', body: { ...rowData(tr), removeLogo: true } }); draw(rows); toast('Logo removed'); }
      if (e.target.closest('[data-del]') && confirm('Delete this brand?')) { rows = await api('brands/' + tr.dataset.id, { method: 'DELETE' }); draw(rows); toast('Deleted'); }
    } catch (err) { fail(err); }
  };
}

// ---- Portfolio -------------------------------------------------------------------
async function portfolioPage() {
  let rows = await api('portfolio');
  const draw = () => {
    view.innerHTML = `<div class="admin-page">
      <div class="admin-head"><div><h1>Portfolio</h1><p>Real jobs with real photos. Shown on "Our work" and on the home page (latest 3).</p></div><button class="btn btn--primary" data-new>+ Add job</button></div>
      ${rows.length ? `<div class="panel"><div class="table-wrap" style="border:0"><table class="table"><thead><tr><th>Photo</th><th>Job</th><th>Bike</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((p) => `<tr data-id="${p.id}"><td><div class="thumb">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="">` : ''}</div></td><td><strong>${esc(p.title)}</strong><div class="muted" style="font-size:var(--fs-xs)">${p.images.length} photos · ${p.work.length} work items</div></td>
          <td>${esc(p.bike || '—')}</td><td>${p.published ? badge('approved').replace('Approved', 'Published') : badge('draft').replace('Draft', 'Hidden')}</td>
          <td class="nowrap"><button class="btn btn--secondary btn--sm" data-edit>Edit</button></td></tr>`).join('')}</tbody></table></div></div>`
        : '<div class="empty"><h3>No jobs yet</h3><p>Add your first job with a few photos: before, during and after.</p></div>'}</div>`;
  };
  draw();
  view.onclick = (e) => {
    if (e.target.closest('[data-new]')) return form({ title: '', bike: '', summary: '', work: [], images: [], published: true, sort: 0 });
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target.closest('[data-edit]')) form(structuredClone(rows.find((r) => String(r.id) === tr.dataset.id)));
  };
  function form(p) {
    let images = [...p.images];
    openModal(`<form data-f><div class="modal__head"><h2>${p.id ? 'Edit job' : 'New job'}</h2><button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Close">✕</button></div>
      <div class="modal__body"><div class="form-grid form-grid--2">
        <div class="field span-all"><label>Title</label><input class="input" name="title" value="${esc(p.title)}" placeholder="e.g. 24,000 km major service + shim job" required></div>
        <div class="field"><label>Bike</label><input class="input" name="bike" list="pf-bikes" value="${esc(p.bike)}"></div>
        <div class="field"><label>Order</label><input class="input input--num" name="sort" value="${esc(p.sort)}"></div>
        <div class="field span-all"><label>Story</label><textarea class="textarea" name="summary" placeholder="What was wrong, what we found, what we did.">${esc(p.summary)}</textarea></div>
        <div class="field span-all"><label>Work done <span class="muted">(one per line)</span></label><textarea class="textarea" name="work">${esc(p.work.join('\n'))}</textarea></div>
        <div class="field span-all"><label>Photos <span class="muted">(first photo is the cover, up to 12)</span></label><div class="thumbs" data-thumbs></div>
          <label class="btn btn--secondary btn--sm" style="align-self:flex-start;margin-top:var(--s-2)">Add photos<input type="file" accept="image/*" multiple hidden data-files></label></div>
        <label class="check"><input type="checkbox" name="published" ${p.published ? 'checked' : ''}> Published</label>
      </div><datalist id="pf-bikes">${boot.bikes.map((b) => `<option value="${esc(b.brand + ' ' + b.model)}"></option>`).join('')}</datalist></div>
      <div class="modal__foot">${p.id ? '<button type="button" class="btn btn--danger" data-del style="margin-right:auto">Delete</button>' : ''}<button type="button" class="btn" data-close>Cancel</button><button class="btn btn--primary">Save</button></div></form>`, (panel) => {
      const f = $('[data-f]', panel);
      const thumbs = () => { $('[data-thumbs]', panel).innerHTML = images.map((src, i) => `<div class="thumb"><img src="${esc(src)}" alt=""><button type="button" data-rm="${i}" aria-label="Remove photo">✕</button></div>`).join(''); };
      thumbs();
      $('[data-thumbs]', panel).addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { images.splice(Number(b.dataset.rm), 1); thumbs(); } });
      const saveBtn = f.querySelector('.btn--primary');
      let uploading = 0;
      $('[data-files]', panel).addEventListener('change', async (e) => {
        const files = [...e.target.files].slice(0, 12 - images.length); e.target.value = '';
        uploading += files.length; saveBtn.disabled = true; saveBtn.textContent = `Uploading ${uploading} photo${uploading > 1 ? 's' : ''}…`;
        for (const file of files) {
          try { images.push(await uploadImage(file)); thumbs(); } catch (err) { fail(err); }
          uploading--; saveBtn.textContent = uploading ? `Uploading ${uploading} photo${uploading > 1 ? 's' : ''}…` : 'Save';
        }
        if (!uploading) saveBtn.disabled = false;
      });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (uploading) return;
        const btn = saveBtn; btn.disabled = true; btn.textContent = 'Saving…';
        try {
          rows = await api('portfolio', { method: 'POST', body: { id: p.id, title: f.elements.title.value, bike: f.elements.bike.value, sort: Number(f.elements.sort.value) || 0, summary: f.elements.summary.value,
            work: f.elements.work.value.split('\n').map((s) => s.trim()).filter(Boolean), images, published: f.elements.published.checked } });
          modal.close(); draw(); toast('Saved');
        } catch (err) { fail(err); btn.disabled = false; btn.textContent = 'Save'; }
      });
      const d = $('[data-del]', panel);
      if (d) d.addEventListener('click', async () => { if (confirm('Delete this job and its photos?')) { try { rows = await api('portfolio/' + p.id, { method: 'DELETE' }); modal.close(); draw(); toast('Deleted'); } catch (err) { fail(err); } } });
    });
  }
}

// ---- Bikes & parts (simple CRUD tables) ------------------------------------------
async function bikesPage() {
  const draw = () => {
    view.innerHTML = `<div class="admin-page">
      <div class="admin-head"><div><h1>Bike models</h1><p>${boot.bikes.length} models. The class decides which price column the invoice editor uses. Also feeds the "find your bike" box on the website.</p></div></div>
      <form class="panel" data-add><div class="panel__body form-grid form-grid--3" style="align-items:end">
        <div class="field"><label>Brand</label><input class="input" name="brand" list="brands-l" required></div>
        <div class="field"><label>Model</label><input class="input" name="model" required></div>
        <div class="field"><label>Class</label><div class="btn-row"><select class="select" name="class" style="flex:1">${['A', 'B', 'C'].map((k) => `<option value="${k}">${esc(classLabel(k))}</option>`).join('')}</select><button class="btn btn--primary">Add</button></div></div>
        <datalist id="brands-l">${[...new Set(boot.bikes.map((b) => b.brand))].map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div></form>
      <div class="panel"><div class="table-wrap" style="border:0"><table class="table edit-table"><thead><tr><th>Brand</th><th>Model</th><th>Class</th><th></th></tr></thead><tbody>
      ${boot.bikes.map((b) => `<tr data-id="${b.id}"><td>${esc(b.brand)}</td><td>${esc(b.model)}</td>
        <td><select class="select" data-class style="width:auto">${['A', 'B', 'C'].map((k) => `<option value="${k}" ${b.class === k ? 'selected' : ''}>${esc(classLabel(k))}</option>`).join('')}</select></td>
        <td><button class="btn btn--ghost btn--sm btn--icon" data-del aria-label="Delete">✕</button></td></tr>`).join('')}
      </tbody></table></div></div></div>`;
    $('[data-add]', view).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      try { boot.bikes = await api('bikes', { method: 'POST', body: { brand: f.brand.value.trim(), model: f.model.value.trim(), class: f.class.value } }); toast('Added'); draw(); } catch (err) { fail(err); }
    });
  };
  draw();
  view.onchange = async (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr || !e.target.matches('[data-class]')) return;
    const b = boot.bikes.find((x) => String(x.id) === tr.dataset.id);
    try { boot.bikes = await api('bikes', { method: 'POST', body: { ...b, class: e.target.value } }); toast('Saved'); } catch (err) { fail(err); e.target.value = b.class; }
  };
  view.onclick = async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target.closest('[data-del]') && confirm('Remove this model?')) { try { boot.bikes = await api('bikes/' + tr.dataset.id, { method: 'DELETE' }); draw(); toast('Removed'); } catch (err) { fail(err); } }
  };
}

async function partsPage() {
  const draw = () => {
    view.innerHTML = `<div class="admin-page">
      <div class="admin-head"><div><h1>Parts list</h1><p>Quick-add parts for invoices with default HSN code and GST rate. Confirm HSN codes and rates with your CA.</p></div></div>
      <form class="panel" data-add><div class="panel__body form-grid form-grid--3" style="align-items:end">
        <div class="field"><label>Part name</label><input class="input" name="name" required></div>
        <div class="field"><label>HSN</label><input class="input mono" name="hsn"></div>
        <div class="field"><label>GST % · Unit</label><div class="btn-row"><input class="input input--num" name="gst" value="18" style="width:80px"><input class="input" name="unit" placeholder="pc" style="width:80px"><button class="btn btn--primary">Add</button></div></div></div></form>
      <div class="panel"><div class="table-wrap" style="border:0"><table class="table edit-table"><thead><tr><th>Part</th><th>HSN</th><th class="r">GST %</th><th>Unit</th><th></th></tr></thead><tbody>
      ${boot.parts.map((p) => `<tr data-id="${p.id}"><td><input class="input" data-k="name" value="${esc(p.name)}"></td><td style="width:120px"><input class="input mono" data-k="hsn" value="${esc(p.hsn || '')}"></td>
        <td style="width:90px"><input class="input input--num" data-k="gst" value="${esc(p.gst)}"></td><td style="width:90px"><input class="input" data-k="unit" value="${esc(p.unit || '')}"></td>
        <td><button class="btn btn--ghost btn--sm btn--icon" data-del aria-label="Delete">✕</button></td></tr>`).join('')}
      </tbody></table></div></div></div>`;
    $('[data-add]', view).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      try { boot.parts = await api('parts', { method: 'POST', body: { name: f.name.value, hsn: f.hsn.value, gst: Number(f.gst.value), unit: f.unit.value } }); toast('Added'); draw(); } catch (err) { fail(err); }
    });
  };
  draw();
  view.onchange = async (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const body = { id: Number(tr.dataset.id) }; $$('[data-k]', tr).forEach((i) => (body[i.dataset.k] = i.value));
    try { boot.parts = await api('parts', { method: 'POST', body }); toast('Saved'); } catch (err) { fail(err); }
  };
  view.onclick = async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target.closest('[data-del]') && confirm('Remove this part?')) { try { boot.parts = await api('parts/' + tr.dataset.id, { method: 'DELETE' }); draw(); toast('Removed'); } catch (err) { fail(err); } }
  };
}

// ---- Settings ----------------------------------------------------------------------
async function settingsPage() {
  const s = boot.settings;
  const f = (k, label, opts = {}) => `<div class="field ${opts.span ? 'span-all' : ''}"><label for="s-${k}">${label}</label>${opts.area
    ? `<textarea class="textarea" id="s-${k}" name="${k}">${esc(s[k])}</textarea>`
    : `<input class="input ${opts.mono ? 'mono' : ''}" id="s-${k}" name="${k}" value="${esc(s[k])}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''}>`}${opts.hint ? `<span class="field__hint">${opts.hint}</span>` : ''}</div>`;
  view.innerHTML = `<div class="admin-page">
    <div class="admin-head"><div><h1>Business settings</h1><p>Used on the website, invoices and WhatsApp links.</p></div></div>
    <form data-settings>
      <section class="panel"><div class="panel__head"><h2>Business</h2></div><div class="panel__body form-grid form-grid--2">
        ${f('name', 'Trading name')}${f('legal_name', 'Legal name (on invoices)')}
        ${f('phone', 'Phone', { ph: '+91 98xxx xxxxx' })}${f('whatsapp', 'WhatsApp number', { mono: true, hint: 'Digits only with country code, e.g. 919812345678' })}
        ${f('email', 'Email')}${f('hours', 'Opening hours')}
        ${f('address_line1', 'Address line 1')}${f('address_line2', 'Address line 2')}
        ${f('city', 'City')}${f('pincode', 'PIN code')}
        ${f('maps_url', 'Google Maps link', { span: true })}
        ${f('instagram', 'Instagram URL')}${f('google_reviews_url', 'Google reviews URL')}
      </div></section>
      <section class="panel"><div class="panel__head"><h2>Website &amp; search</h2></div><div class="panel__body form-grid form-grid--2">
        ${f('site_url', 'Live website address', { ph: 'https://torquenation.in', hint: 'Used for canonical links, the sitemap and Google. Set this once the domain is live.' })}
        ${f('opening_hours_schema', 'Opening hours for Google', { mono: true, hint: 'Format: Mo-Sa 10:00-19:30' })}
        ${f('geo_lat', 'Workshop latitude', { mono: true, hint: 'From Google Maps: right-click the pin' })}${f('geo_lng', 'Workshop longitude', { mono: true })}
        <div class="field span-all"><label>Home page photo</label>
          <div class="btn-row">${s.hero_image ? `<img src="${esc(s.hero_image)}" alt="" style="width:160px;height:120px;object-fit:cover;border-radius:var(--r-1)">` : '<span class="muted">No photo: the gauge graphic is shown instead.</span>'}
          <label class="btn btn--secondary btn--sm">Upload photo<input type="file" accept="image/*" hidden data-hero></label>
          ${s.hero_image ? '<button type="button" class="btn btn--ghost btn--sm" data-hero-clear>Use gauge instead</button>' : ''}</div>
          <span class="field__hint">A real photo of your workshop or a customer bike (with permission) works best. Landscape, at least 1600px wide.</span></div>
        ${f('hero_image_alt', 'Photo description (for Google and screen readers)', { span: true })}
      </div></section>
      <section class="panel"><div class="panel__head"><h2>Tax &amp; numbering</h2></div><div class="panel__body form-grid form-grid--2">
        <label class="check span-all"><input type="checkbox" name="gst_enabled" ${s.gst_enabled ? 'checked' : ''}> GST registered: charge GST on new documents by default</label>
        ${f('gstin', 'GSTIN', { mono: true })}${f('state', 'State')}${f('state_code', 'State code', { mono: true })}
        ${f('invoice_prefix', 'Invoice prefix', { mono: true, hint: 'Numbers look like PREFIX/26-27/0001 and restart each financial year' })}${f('estimate_prefix', 'Estimate prefix', { mono: true })}
      </div></section>
      <section class="panel"><div class="panel__head"><h2>Payment details &amp; terms</h2></div><div class="panel__body form-grid form-grid--2">
        ${f('upi_id', 'UPI ID', { mono: true })}${f('bank_name', 'Bank name')}${f('bank_account', 'Account number', { mono: true })}${f('bank_ifsc', 'IFSC', { mono: true })}
        ${f('invoice_terms', 'Terms printed on invoices', { area: true, span: true })}
      </div></section>
      <div class="btn-row" style="margin-top:var(--s-5)"><button class="btn btn--primary btn--lg">Save settings</button></div>
    </form>
    <form class="panel" data-pw style="margin-top:var(--s-7)"><div class="panel__head"><h2>Change password</h2></div><div class="panel__body form-grid form-grid--3" style="align-items:end">
      <div class="field"><label>Current password</label><input class="input" type="password" name="current" autocomplete="current-password" required></div>
      <div class="field"><label>New password <span class="muted">(10+ characters)</span></label><input class="input" type="password" name="next" autocomplete="new-password" minlength="10" required></div>
      <div class="field"><button class="btn btn--secondary">Update password</button></div></div></form>
  </div>`;
  $('[data-settings]', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, String(v).trim()]));
    body.gst_enabled = e.target.gst_enabled.checked;
    body.whatsapp = body.whatsapp.replace(/\D/g, '');
    const btn = e.submitter || e.target.querySelector('.btn--primary'); btn.disabled = true;
    try { boot.settings = await api('settings', { method: 'PUT', body }); dirty = false; toast('Settings saved. The website is updated.'); } catch (err) { fail(err); } finally { btn.disabled = false; }
  });
  $('[data-hero]', view).addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { boot.settings = await api('settings', { method: 'PUT', body: { hero_image: await uploadImage(file, 1800, 0.82, false), replace_hero: true } }); toast('Home page photo updated'); settingsPage(); } catch (err) { fail(err); }
  });
  const clear = $('[data-hero-clear]', view);
  if (clear) clear.addEventListener('click', async () => { try { boot.settings = await api('settings', { method: 'PUT', body: { hero_image: '', replace_hero: true } }); toast('Gauge graphic restored'); settingsPage(); } catch (err) { fail(err); } });
  $('[data-pw]', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('password', { method: 'POST', body: { current: e.target.current.value, next: e.target.next.value } }); e.target.reset(); toast('Password updated. Other sessions were signed out.'); } catch (err) { fail(err); }
  });
}

// ---- Start ---------------------------------------------------------------------------
(async () => {
  try { boot = await api('bootstrap'); } catch (err) {
    view.innerHTML = `<div class="admin-page"><div class="alert alert--danger">Could not load the admin: ${esc(err.message)} <a href="">Reload</a></div></div>`;
    return;
  }
  refreshBookingCount().catch(() => {});
  route();
})();
