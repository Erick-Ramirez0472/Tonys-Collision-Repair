// Cloudflare Pages Function: POST /api/quote
// Takes the quote form as JSON and emails it through Resend (https://resend.com).
//
// Environment variables (set in Cloudflare Pages > Settings > Variables and Secrets,
// or in .dev.vars for local testing):
//   RESEND_API_KEY  required, secret. Your Resend API key (starts with re_).
//   QUOTE_TO        required. Where quote requests are delivered. Comma-separate for several.
//   QUOTE_FROM      optional. Sender shown on the email. Defaults to Resend's test sender,
//                   which can only deliver to the email address your Resend account uses.
//                   Once you verify a domain in Resend, set this to something like
//                   "Tony's Collision Repair <quotes@yourdomain.com>".

const DEFAULT_FROM = "Tony's Collision Repair <onboarding@resend.dev>";
const LIMITS = { name: 100, phone: 40, email: 200, vehicle: 120, claim: 20, msg: 3000 };
const CLAIMS = ['Yes', 'No', 'Not sure yet'];

// Attachments arrive base64-encoded in the JSON body. Photos are shrunk in the browser first.
// Each file is tagged with the upload spot it came from; the order here is the order in the email.
const GROUPS = {
  vin:      { label: 'VIN photo',          max: 1,  docs: false },
  estimate: { label: 'Insurance estimate', max: 5,  docs: true },
  damage:   { label: 'Damage photo',       max: 10, docs: false },
};
const MAX_FILES = Object.values(GROUPS).reduce((s, g) => s + g.max, 0);
const MAX_TOTAL = 10 * 1024 * 1024;               // decoded bytes, all files together
const MAX_BODY = Math.ceil(MAX_TOTAL * 4 / 3) + 64 * 1024; // base64 overhead + form fields
const EXT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
};

function cleanFiles(list, claim) {
  if (list == null || list === '') return { files: [] };
  if (!Array.isArray(list)) return { error: 'Attachments could not be read. Try adding them again.' };
  if (list.length > MAX_FILES) return { error: `Attach up to ${MAX_FILES} files.` };
  let bytes = 0;
  const count = {};
  const files = [];
  for (const f of list) {
    if (!f || typeof f.data !== 'string' || !f.data) return { error: 'An attachment could not be read. Try adding it again.' };
    const group = GROUPS[f.group] ? f.group : 'damage';
    if (group === 'estimate' && claim !== 'Yes') continue;   // estimate only applies to claims
    const g = GROUPS[group];
    count[group] = (count[group] || 0) + 1;
    if (count[group] > g.max) return { error: g.max === 1 ? `Add only one ${g.label}.` : `Add up to ${g.max} ${g.label.toLowerCase()}s.` };
    let name = String(f.name || 'file')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .slice(-100);
    let ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (!ext || !EXT_TYPES[ext]) {
      // Some phones send photos without an extension; fall back to the browser-reported type
      ext = Object.keys(EXT_TYPES).find(k => EXT_TYPES[k] === f.type);
      if (!ext) return { error: `${name} isn't a photo or PDF.` };
      name = `${name}.${ext}`;
    }
    if (ext === 'pdf' && !g.docs) return { error: `${name} isn't a photo.` };
    bytes += Math.floor(f.data.length * 3 / 4);
    if (bytes > MAX_TOTAL) return { error: 'Attachments can total up to 10 MB.' };
    // Prefix the file name so the shop can tell attachments apart in the email
    files.push({ group, filename: `${g.label} - ${name}`, content: f.data });
  }
  const order = Object.keys(GROUPS);
  files.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  return { files, bytes };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Short quote number like "1118-K7M4": the Utah date plus 4 random characters.
// A unique subject keeps Gmail from stacking requests into one thread, with no counter to store.
// The alphabet skips look-alikes (0/O, 1/I/L) so it's easy to read out over the phone.
const REF_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function quoteRef() {
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: '2-digit', day: '2-digit' })
    .format(new Date()).replace('/', '');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => REF_CHARS[b % REF_CHARS.length]).join('');
  return `${date}-${rand}`;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY || !env.QUOTE_TO) {
    console.error('Missing RESEND_API_KEY or QUOTE_TO');
    return json({ ok: false, error: 'not_configured' }, 500);
  }

  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
    return json({ ok: false, error: 'invalid', fields: { files: 'Attachments can total up to 10 MB.' } }, 413);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // Honeypot: real visitors never see or fill this field. Pretend it worked so bots move on.
  if (data.website) return json({ ok: true });

  const d = {};
  for (const [key, max] of Object.entries(LIMITS)) d[key] = String(data[key] ?? '').trim().slice(0, max);
  if (!CLAIMS.includes(d.claim)) d.claim = 'Not sure yet';

  const errors = {};
  if (!d.name) errors.name = 'Enter your name.';
  if (d.phone.replace(/\D/g, '').length < 10) errors.phone = 'Enter a 10-digit phone number.';
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.email = 'Enter a valid email or leave it blank.';
  const attached = cleanFiles(data.files, d.claim);
  if (attached.error) errors.files = attached.error;
  else {
    // A VIN photo and damage photos are needed to build an estimate; claims also need the insurer's estimate
    const has = g => attached.files.some(f => f.group === g);
    if (!has('vin')) errors.vin = 'Add a photo of your VIN.';
    if (d.claim === 'Yes' && !has('estimate')) errors.estimate = 'Add your insurance estimate.';
    if (!has('damage')) errors.damage = 'Add at least one photo of the damage.';
  }
  if (Object.keys(errors).length) return json({ ok: false, error: 'invalid', fields: errors }, 422);
  const files = attached.files;
  const ref = quoteRef();

  const rows = [
    ['Quote #', ref],
    ['Name', d.name],
    ['Phone', d.phone],
    ['Email', d.email],
    ['Vehicle', d.vehicle],
    ['Insurance claim', d.claim],
  ].filter(([, v]) => v);

  // What's attached, per upload spot, e.g. "VIN photo: yes / Insurance estimate: 2 / Damage photos: 4"
  const tally = Object.entries(GROUPS).map(([key, g]) => {
    const n = files.filter(f => f.group === key).length;
    if (key === 'estimate' && d.claim !== 'Yes') return null;
    return [g.label + (g.max === 1 ? '' : 's'), n ? (g.max === 1 ? 'Attached' : `${n} attached`) : 'None'];
  }).filter(Boolean);
  rows.push(...tally);
  const names = files.map(f => f.filename);
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n')
    + (d.msg ? `\n\nWhat happened:\n${d.msg}` : '')
    + (names.length ? `\n\nAttached (${names.length}):\n${names.join('\n')}` : '');
  const html = `
    <h2 style="font-family:sans-serif;margin:0 0 12px">Quote request #${esc(ref)}</h2>
    <table style="font-family:sans-serif;font-size:15px;border-collapse:collapse">
      ${rows.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#555">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`).join('')}
    </table>
    ${d.msg ? `<h3 style="font-family:sans-serif;margin:20px 0 6px">What happened</h3><p style="font-family:sans-serif;font-size:15px;white-space:pre-wrap;margin:0">${esc(d.msg)}</p>` : ''}
    ${names.length ? `<h3 style="font-family:sans-serif;margin:20px 0 6px">Attached (${names.length})</h3><ul style="font-family:sans-serif;font-size:15px;margin:0;padding-left:20px">${names.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  `;

  const payload = {
    from: env.QUOTE_FROM || DEFAULT_FROM,
    to: env.QUOTE_TO.split(',').map(s => s.trim()).filter(Boolean),
    subject: `Quote #${ref}: ${d.name}${d.vehicle ? `, ${d.vehicle}` : ''}`,
    text,
    html,
  };
  if (d.email) payload.reply_to = d.email;
  if (files.length) payload.attachments = files.map(({ filename, content }) => ({ filename, content }));

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error('Resend error', res.status, await res.text());
    return json({ ok: false, error: 'send_failed' }, 502);
  }
  return json({ ok: true, ref });
}

export const onRequest = () => json({ ok: false, error: 'method_not_allowed' }, 405);
