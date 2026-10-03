(() => {
  const form = document.getElementById('form');
  const summary = document.getElementById('err-summary');
  const list = document.getElementById('err-list');
  const status = document.getElementById('status');
  document.getElementById('yr').textContent = new Date().getFullYear();

  // After in-page nav, move keyboard focus to the target so screen reader and keyboard users follow along
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute('href') === '#') return;
    const t = document.getElementById(a.getAttribute('href').slice(1));
    if (!t) return;
    if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    setTimeout(() => t.focus({ preventScroll: true }), 0);
  });

  const rules = {
    name:  v => v.trim() ? '' : 'Enter your name.',
    phone: v => !v.trim() ? 'Enter a phone number so we can call you back.'
              : v.replace(/\D/g, '').length < 10 ? 'Enter a 10-digit phone number, for example 801-555-0123.' : '',
    email: v => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Enter an email like name@example.com, or leave it blank.'
  };
  const labels = { name: 'Your name', phone: 'Phone number', email: 'Email' };

  function check(field) {
    const input = form.elements[field];
    const out = document.getElementById('e-' + field);
    const msg = rules[field](input.value);
    const hint = document.getElementById('h-' + field);
    const base = hint ? hint.id : '';
    if (msg) {
      out.textContent = msg; out.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', (base + ' ' + out.id).trim());
    } else {
      out.textContent = ''; out.hidden = true;
      input.removeAttribute('aria-invalid');
      if (base) input.setAttribute('aria-describedby', base); else input.removeAttribute('aria-describedby');
    }
    return msg;
  }

  // Validate when the user leaves a field, so errors are not announced while typing
  Object.keys(rules).forEach(f => form.elements[f].addEventListener('blur', () => {
    if (form.elements[f].value || form.elements[f].hasAttribute('aria-invalid')) check(f);
  }));

  form.addEventListener('submit', e => {
    e.preventDefault();
    status.textContent = '';
    const errors = Object.keys(rules).map(f => [f, check(f)]).filter(([, m]) => m);
    if (errors.length) {
      list.innerHTML = '';
      errors.forEach(([f, m]) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#f-' + f; a.textContent = labels[f] + ': ' + m;
        a.addEventListener('click', ev => { ev.preventDefault(); form.elements[f].focus(); });
        li.appendChild(a); list.appendChild(li);
      });
      summary.hidden = false;
      summary.focus();
      return;
    }
    summary.hidden = true;
    const d = Object.fromEntries(new FormData(form));
    const body = [`Name: ${d.name}`, `Phone: ${d.phone}`, d.email && `Email: ${d.email}`, d.vehicle && `Vehicle: ${d.vehicle}`,
      `Insurance claim: ${d.claim}`, '', d.msg].filter(x => x !== '' && x !== undefined && x !== false).join('\n');
    status.textContent = 'Opening your email app with your quote request. If nothing opens, call (555) 123-4567.';
    location.href = 'mailto:info@tonyscollisionrepair.com?subject=' + encodeURIComponent('Quote request: ' + d.name) + '&body=' + encodeURIComponent(body);
  });
})();
