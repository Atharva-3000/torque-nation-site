// Torque Nation — public site behaviour. Progressive enhancement only:
// every page works without this file.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Header border once the page scrolls: a 1px sentinel at the top of the
  // page, watched by IntersectionObserver (no scroll listener).
  const header = $('[data-header]');
  if (header && 'IntersectionObserver' in window) {
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:8px;left:0;width:1px;height:1px;pointer-events:none';
    sentinel.setAttribute('aria-hidden', 'true');
    document.body.prepend(sentinel);
    new IntersectionObserver(([e]) => header.classList.toggle('is-scrolled', !e.isIntersecting)).observe(sentinel);
  }

  // Mobile nav
  const toggle = $('[data-nav-toggle]');
  const nav = $('#site-nav');
  const setNav = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-open', open);
  };
  if (toggle && nav) {
    toggle.addEventListener('click', () => setNav(toggle.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) { setNav(false); toggle.focus(); } });
    $$('a', nav).forEach((a) => a.addEventListener('click', () => setNav(false)));
  }

  // Reveal on scroll
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    reveals.forEach((el, i) => { el.style.transitionDelay = `${(i % 6) * 50}ms`; io.observe(el); });
  } else reveals.forEach((el) => el.classList.add('is-in'));

  // Gauge needle sweep (geometry is server-rendered)
  const gauge = $('.gauge');
  if (gauge) requestAnimationFrame(() => setTimeout(() => gauge.classList.add('is-on'), 250));

  // Bike finder (home + pricing + contact datalist)
  const dataEl = $('#bike-data');
  const bikes = dataEl ? JSON.parse(dataEl.textContent) : [];
  const list = $('#bike-list');
  if (list) list.innerHTML = bikes.map((b) => `<option value="${b.brand} ${b.model}"></option>`).join('');
  const CLASS_NAMES = { A: 'Class A: 450-700cc', B: 'Class B: Middleweight', C: 'Class C: Superbike' };

  const setClass = (k) => {
    $$('.segmented [data-class]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.class === k)));
    $$('.price-table [data-class]').forEach((el) => el.classList.toggle('is-selected', el.dataset.class === k));
    $$('.class-row[data-class]').forEach((el) => el.classList.toggle('is-match', el.dataset.class === k));
    try { localStorage.setItem('tn-class', k); } catch {}
  };

  $$('[data-finder]').forEach((f) => {
    const input = $('[data-finder-input]', f), out = $('[data-finder-out]', f);
    const run = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) return;
      const hit = bikes.find((b) => `${b.brand} ${b.model}`.toLowerCase() === q) ||
        bikes.find((b) => `${b.brand} ${b.model}`.toLowerCase().includes(q) || b.model.toLowerCase().includes(q));
      if (hit) {
        out.innerHTML = `${hit.brand} ${hit.model} is <strong>${CLASS_NAMES[hit.class]}</strong>${$('[data-pricing]') ? '' : ' · <a href="/pricing">see prices</a>'}`;
        setClass(hit.class);
      } else {
        out.innerHTML = 'Not in our list yet. We probably still work on it. <a href="/contact">Ask us</a>.';
      }
    };
    input.addEventListener('change', run);
    input.addEventListener('input', () => { if (input.value.length > 2) run(); });
  });

  if ($('[data-pricing]')) {
    $$('.segmented [data-class]').forEach((b) => b.addEventListener('click', () => setClass(b.dataset.class)));
    let saved = 'A';
    try { saved = localStorage.getItem('tn-class') || 'A'; } catch {}
    setClass(saved);
  }

  // Services jump chips
  const jump = $('[data-jump]');
  if (jump) {
    jump.innerHTML = $$('.svc-block').map((s) => `<a class="chip" href="#${s.id}">${$('h2', s).textContent}</a>`).join('');
  }

  // Portfolio empty state
  const grid = $('[data-work-grid]');
  if (grid && !grid.children.length) $('[data-work-empty]').hidden = false;

  // Booking form
  const form = $('[data-booking]');
  if (form) {
    const status = $('[data-booking-status]', form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const name = form.elements.name, phone = form.elements.phone;
      name.setAttribute('aria-invalid', String(!data.name.trim()));
      phone.setAttribute('aria-invalid', String(!/^[+\d][\d\s-]{7,}$/.test(data.phone.trim())));
      if (!data.name.trim() || !/^[+\d][\d\s-]{7,}$/.test(data.phone.trim())) {
        status.textContent = 'Please add your name and a valid phone number.';
        status.className = 'field__error';
        return;
      }
      const btn = $('button[type="submit"]', form);
      btn.disabled = true; btn.textContent = 'Sending';
      try {
        const r = await fetch('/api/public/booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Something went wrong.');
        form.reset();
        status.textContent = "Got it. We'll call or WhatsApp you to confirm a slot.";
        status.className = 'field__hint accent';
        btn.textContent = 'Request sent';
      } catch (err) {
        status.textContent = err.message + ' You can also WhatsApp us directly.';
        status.className = 'field__error';
        btn.disabled = false; btn.textContent = 'Send request';
      }
    });
  }
})();
