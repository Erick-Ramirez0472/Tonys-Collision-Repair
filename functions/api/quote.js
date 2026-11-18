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

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY || !env.QUOTE_TO) {
    console.error('Missing RESEND_API_KEY or QUOTE_TO');
    return json({ ok: false, error: 'not_configured' }, 500);
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
  if (Object.keys(errors).length) return json({ ok: false, error: 'invalid', fields: errors }, 422);

  const rows = [
    ['Name', d.name],
    ['Phone', d.phone],
    ['Email', d.email],
    ['Vehicle', d.vehicle],
    ['Insurance claim', d.claim],
  ].filter(([, v]) => v);

  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (d.msg ? `\n\nWhat happened:\n${d.msg}` : '');
  const html = `
    <h2 style="font-family:sans-serif;margin:0 0 12px">New quote request</h2>
    <table style="font-family:sans-serif;font-size:15px;border-collapse:collapse">
      ${rows.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#555">${esc(k)}</td><td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`).join('')}
    </table>
    ${d.msg ? `<h3 style="font-family:sans-serif;margin:20px 0 6px">What happened</h3><p style="font-family:sans-serif;font-size:15px;white-space:pre-wrap;margin:0">${esc(d.msg)}</p>` : ''}
  `;

  const payload = {
    from: env.QUOTE_FROM || DEFAULT_FROM,
    to: env.QUOTE_TO.split(',').map(s => s.trim()).filter(Boolean),
    subject: `Quote request: ${d.name}`,
    text,
    html,
  };
  if (d.email) payload.reply_to = d.email;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error('Resend error', res.status, await res.text());
    return json({ ok: false, error: 'send_failed' }, 502);
  }
  return json({ ok: true });
}

export const onRequest = () => json({ ok: false, error: 'method_not_allowed' }, 405);
