(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;
  $('#yr').textContent = new Date().getFullYear();

  // Mobile menu: disclosure button, Escape closes and returns focus
  const menuBtn = $('.menu-btn');
  const nav = $('#site-nav');
  const setMenu = open => { menuBtn.setAttribute('aria-expanded', String(open)); nav.classList.toggle('open', open); };
  menuBtn.addEventListener('click', () => setMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menuBtn.getAttribute('aria-expanded') === 'true') { setMenu(false); menuBtn.focus(); }
  });

  // In-page links: close the menu and move focus to the target for keyboard and screen reader users
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute('href').length < 2) return;
    const t = document.getElementById(a.getAttribute('href').slice(1));
    if (!t) return;
    setMenu(false);
    if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    setTimeout(() => t.focus({ preventScroll: true }), 0);
  });

  if (hasIO) {
    // Nav: mark the section in view (aria-current) so the reader knows where they are
    const links = $$('.nav ul a');
    const spy = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      links.forEach(l => l.getAttribute('href') === '#' + en.target.id ? l.setAttribute('aria-current', 'true') : l.removeAttribute('aria-current'));
    }), { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(l => { const t = document.getElementById(l.getAttribute('href').slice(1)); if (t) spy.observe(t); });

    // Mobile action bar: show once the hero CTAs have scrolled out of view
    const bar = $('#actionbar');
    new IntersectionObserver(([en]) => bar.classList.toggle('show', !en.isIntersecting), { threshold: 0 })
      .observe($('.hero__ctas'));

    // Move-in reveals for key blocks and photos (sequence + hierarchy), skipped under reduced motion.
    // A block plays when 15% of it is visible and resets once it is completely off screen,
    // so the animation replays every time it comes back into view, scrolling down or up.
    if (!reduce) {
      const els = $$('.hero__copy > *, .hero__media, .proof__row > *, .bento .cell, .answers > div, .track li, .about__num, .about__text, .quote__intro, .form');
      const io = new IntersectionObserver(entries => entries.forEach(en => {
        if (en.intersectionRatio >= 0.15) en.target.classList.add('in');
        else if (!en.isIntersecting) en.target.classList.remove('in');
      }), { threshold: [0, 0.15] });
      els.forEach(el => {
        const sibs = [...el.parentElement.children];
        el.style.setProperty('--d', (sibs.indexOf(el) % 5) * 0.07 + 's');
        el.setAttribute('data-reveal', '');
        io.observe(el);
      });
      // Never leave focused content invisible
      document.addEventListener('focusin', e => { const r = e.target.closest('[data-reveal]'); if (r) r.classList.add('in'); });
    }
  } else {
    $('#actionbar').classList.add('show');
  }

  // Quote form: inline validation on blur, error summary on submit, busy + success states
  const form = $('#form');
  const summary = $('#err-summary');
  const list = $('#err-list');
  const status = $('#status');
  const submit = $('#submit');
  const labels = { name: 'Name', phone: 'Phone', email: 'Email' };
  const rules = {
    name: v => v.trim() ? '' : 'Enter your name.',
    phone: v => !v.trim() ? 'Enter a phone number so we can call you back.'
      : v.replace(/\D/g, '').length < 10 ? 'Enter a 10-digit phone number, for example 801-555-0123.' : '',
    email: v => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Enter an email like name@example.com, or leave it blank.'
  };

  function check(field) {
    const input = form.elements[field];
    const out = $('#e-' + field);
    const hint = $('#h-' + field);
    const msg = rules[field](input.value);
    const ids = [hint && hint.id, msg && out.id].filter(Boolean).join(' ');
    out.textContent = msg;
    out.hidden = !msg;
    msg ? input.setAttribute('aria-invalid', 'true') : input.removeAttribute('aria-invalid');
    ids ? input.setAttribute('aria-describedby', ids) : input.removeAttribute('aria-describedby');
    return msg;
  }

  Object.keys(rules).forEach(f => form.elements[f].addEventListener('blur', () => {
    if (form.elements[f].value || form.elements[f].hasAttribute('aria-invalid')) check(f);
  }));

  form.addEventListener('submit', e => {
    e.preventDefault();
    status.textContent = '';
    const errors = Object.keys(rules).map(f => [f, check(f)]).filter(([, m]) => m);
    if (errors.length) {
      list.replaceChildren(...errors.map(([f, m]) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#f-' + f;
        a.textContent = `${labels[f]}: ${m}`;
        a.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); form.elements[f].focus(); });
        li.append(a);
        return li;
      }));
      summary.hidden = false;
      summary.focus();
      return;
    }
    summary.hidden = true;
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Opening email';
    const d = Object.fromEntries(new FormData(form));
    const body = [
      `Name: ${d.name}`, `Phone: ${d.phone}`,
      d.email && `Email: ${d.email}`, d.vehicle && `Vehicle: ${d.vehicle}`,
      `Insurance claim: ${d.claim}`, d.msg && `\n${d.msg}`
    ].filter(Boolean).join('\n');
    location.href = 'mailto:info@tonyscollisionrepair.com?subject=' +
      encodeURIComponent('Quote request: ' + d.name) + '&body=' + encodeURIComponent(body);
    setTimeout(() => {
      submit.removeAttribute('aria-busy');
      submit.textContent = 'Send request';
      status.textContent = 'Your email app should now be open with your request. Press send there. If nothing opened, call (555) 123-4567.';
    }, 900);
  });
})();
