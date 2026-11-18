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
  const labels = { name: 'Name', phone: 'Phone', email: 'Email', vin: 'VIN photo', estimate: 'Insurance estimate', damage: 'Photos of the damage' };
  // Required uploads: what to say when one is missing
  const needFiles = {
    vin: 'Add a photo of your VIN.',
    estimate: 'Add your insurance estimate.',
    damage: 'Add at least one photo of the damage.'
  };
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

  // Attachments: three upload spots (VIN photo, insurance estimate, damage photos) share one
  // uploader. Photos are shrunk in the browser (phone photos are 3-8 MB each) so the email
  // stays small and the request stays light for the free Cloudflare plan.
  const MAX_TOTAL = 10 * 1024 * 1024;   // all upload spots together
  const MAX_EDGE = 1800;
  const IMG_TYPE = /^image\/(jpeg|png|webp|heic|heif)$/;
  const IMG_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;
  const PDF = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  let pending = 0;     // photos still being shrunk

  const mb = n => n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';

  async function shrink(file) {
    if (!file.type.startsWith('image/')) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close && bmp.close();
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
      if (blob && blob.size < file.size) {
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      }
    } catch { /* e.g. HEIC on browsers that can't read it: send the original */ }
    return file;
  }

  const uploaders = $$('[data-upload]').map(root => {
    const group = root.dataset.upload;
    const max = Number(root.dataset.max);
    const docs = root.dataset.docs === 'true';
    const input = $('input[type=file]', root);
    const drop = $('.drop', root);
    const listEl = $('.files', root);
    const err = $('.err', root);
    const live = $('.files__total', root);
    const hintId = input.getAttribute('aria-describedby');
    err.id = 'e-' + group;
    const kind = docs ? 'a photo or PDF' : 'a photo';
    const noun = n => (docs ? 'file' : 'photo') + (n === 1 ? '' : 's');
    const u = { group, root, files: [] };

    const setError = msg => {
      err.textContent = msg;
      err.hidden = !msg;
      drop.classList.toggle('invalid', !!msg);
      input.setAttribute('aria-describedby', msg ? `${hintId} ${err.id}` : hintId);
      msg ? input.setAttribute('aria-invalid', 'true') : input.removeAttribute('aria-invalid');
    };
    const summary = () => !u.files.length ? ''
      : max === 1 ? `Added, ${mb(u.files[0].file.size)}.`
      : `${u.files.length} of ${max} ${noun(max)} added, ${mb(u.files.reduce((s, f) => s + f.file.size, 0))}.`;

    const release = f => f.url && URL.revokeObjectURL(f.url);
    u.clear = () => { u.files.forEach(release); u.files = []; setError(''); render(); };
    u.setError = setError;

    function render(note = '') {
      listEl.replaceChildren(...u.files.map((f, i) => {
        const li = document.createElement('li');
        let thumb;
        if (f.url) {
          thumb = document.createElement('img');
          thumb.className = 'files__thumb';
          thumb.src = f.url;
          thumb.alt = '';
        } else {
          thumb = document.createElement('span');
          thumb.className = 'files__doc';
          thumb.setAttribute('aria-hidden', 'true');
          thumb.textContent = (f.file.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 4);
        }
        const name = document.createElement('span');
        name.className = 'files__name';
        name.textContent = f.file.name;
        const size = document.createElement('span');
        size.className = 'files__size';
        size.textContent = mb(f.file.size);
        name.append(size);
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'files__rm';
        rm.textContent = 'Remove';
        rm.setAttribute('aria-label', 'Remove ' + f.file.name);
        rm.addEventListener('click', () => {
          release(f);
          u.files.splice(i, 1);
          setError('');
          render(`Removed ${f.file.name}.`);
          const next = listEl.querySelectorAll('.files__rm')[Math.min(i, u.files.length - 1)];
          (next || input).focus();
        });
        li.append(thumb, name, rm);
        return li;
      }));
      live.textContent = [note, summary()].filter(Boolean).join(' ');
    }

    async function add(list) {
      const incoming = [...list];
      if (!incoming.length) return;
      const problems = [];
      pending++;
      live.textContent = 'Preparing…';
      for (const raw of incoming) {
        const isImg = IMG_TYPE.test(raw.type) || IMG_EXT.test(raw.name);
        if (!isImg && !(docs && PDF(raw))) { problems.push(`${raw.name} isn't ${kind}.`); continue; }
        if (max === 1 && u.files.length) u.files.splice(0).forEach(release);   // single spot: replace
        if (u.files.length >= max) { problems.push(`You can add up to ${max} ${noun(max)} here.`); break; }
        const file = await shrink(raw);
        if (totalBytes() + file.size > MAX_TOTAL) {
          problems.push(`${raw.name} is too large. All files together can be up to ${mb(MAX_TOTAL)}.`);
          continue;
        }
        const showable = /^image\/(jpeg|png|webp)$/.test(file.type);
        u.files.push({ file, url: showable ? URL.createObjectURL(file) : null });
      }
      pending--;
      setError(problems.join(' '));
      render();
    }

    input.addEventListener('change', () => { add(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'dragend', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
    drop.addEventListener('drop', e => { e.preventDefault(); add(e.dataTransfer.files); });
    return u;
  });

  // Only send uploads from spots the customer can see (the estimate hides unless "Yes")
  const active = () => uploaders.filter(u => !u.root.hidden);
  const totalBytes = () => uploaders.reduce((s, u) => s + u.files.reduce((t, f) => t + f.file.size, 0), 0);

  // VIN help: the "?" button shows the location diagram only when the customer asks for it.
  // Disclosure pattern: aria-expanded on the button, Escape closes and returns focus.
  const vinBtn = $('#vin-help-btn');
  const vinHelp = $('#vin-help');
  const setVinHelp = open => { vinBtn.setAttribute('aria-expanded', String(open)); vinHelp.hidden = !open; };
  vinBtn.addEventListener('click', () => setVinHelp(vinHelp.hidden));
  [vinBtn, vinHelp].forEach(el => el.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !vinHelp.hidden) { e.stopPropagation(); setVinHelp(false); vinBtn.focus(); }
  }));

  // Insurance estimate: reveal its upload spot when the customer says this is a claim
  const estimate = $('#estimate-field');
  const syncClaim = () => { estimate.hidden = form.elements.claim.value !== 'Yes'; };
  $$('input[name=claim]', form).forEach(r => r.addEventListener('change', syncClaim));
  syncClaim();

  const toBase64 = file => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

  Object.keys(rules).forEach(f => form.elements[f].addEventListener('blur', () => {
    if (form.elements[f].value || form.elements[f].hasAttribute('aria-invalid')) check(f);
  }));

  form.addEventListener('submit', e => {
    e.preventDefault();
    status.textContent = '';
    if (submit.hasAttribute('aria-busy')) return;
    if (pending) { status.textContent = 'Your files are still being prepared. Try again in a moment.'; return; }
    // Required uploads (only the ones showing; the estimate is required only for claims)
    const fileErrors = active().map(u => {
      const m = u.files.length ? '' : needFiles[u.group] || '';
      if (m) u.setError(m);
      return [u.group, m];
    });
    const errors = [...Object.keys(rules).map(f => [f, check(f)]), ...fileErrors].filter(([, m]) => m);
    if (errors.length) {
      list.replaceChildren(...errors.map(([f, m]) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#f-' + f;
        a.textContent = `${labels[f]}: ${m}`;
        a.addEventListener('click', ev => {
          ev.preventDefault(); ev.stopPropagation();
          const el = document.getElementById('f-' + f);
          (el.closest('.field') || el).scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
          el.focus({ preventScroll: true });
        });
        li.append(a);
        return li;
      }));
      summary.hidden = false;
      summary.focus();
      return;
    }
    summary.hidden = true;
    submit.setAttribute('aria-busy', 'true');
    const toSend = active().flatMap(u => u.files.map(f => ({ group: u.group, file: f.file })));
    submit.textContent = toSend.length ? 'Uploading' : 'Sending';
    status.classList.remove('status--error');
    const fail = 'We couldn\'t send your request. Please try again, or call +1 (385) 268-8187.';
    const fields = Object.fromEntries(new FormData(form));
    Promise.all(toSend.map(async f => ({ group: f.group, name: f.file.name, type: f.file.type, data: await toBase64(f.file) })))
      .then(attachments => fetch('/api/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...fields, files: attachments })
      }))
      .then(r => r.json().catch(() => ({})).then(res => ({ ok: r.ok && res.ok, res })))
      .then(({ ok, res }) => {
        if (ok) {
          form.reset();
          uploaders.forEach(u => u.clear());
          syncClaim();
          status.textContent = 'Thanks, your request was sent. We\'ll call you back soon.';
          return;
        }
        // Server-side validation caught something the browser missed: show it on the field
        const bad = (res && res.fields) || {};
        Object.entries(bad).forEach(([f, m]) => {
          const spot = uploaders.find(x => x.group === f);
          if (spot) return spot.setError(m);
          if (f === 'files') {
            const u = active().find(x => x.files.length) || uploaders[uploaders.length - 1];
            return u.setError(m);
          }
          const out = $('#e-' + f);
          if (!out) return;
          out.textContent = m;
          out.hidden = false;
          form.elements[f].setAttribute('aria-invalid', 'true');
        });
        status.classList.add('status--error');
        status.textContent = Object.keys(bad).length ? 'Check the highlighted fields and try again.' : fail;
      })
      .catch(() => { status.classList.add('status--error'); status.textContent = fail; })
      .finally(() => { submit.removeAttribute('aria-busy'); submit.textContent = 'Send request'; });
  });
})();
