// "Claim your listing": maintainers/vendors submit description, pricing and corrections. Double opt-in by email.
// Blob review queue: claims/<YYYY-MM-DD>/<id>.json {status: unverified|verified|approved|rejected, entity, feed, id, email, domainMatch, ...}
// (preview deployments write to claims-preview/). Ops reviews `verified` items daily.
const crypto = require('crypto');
const { readJSON, writeJSON } = require('./store');
const { resolve } = require('./alerts');
const { makeToken, validEmail } = require('../api/_lib');
const ns = () => (process.env.VERCEL_ENV === 'production' ? 'claims' : 'claims-preview');
const clip = (v, n) => String(v || '').trim().slice(0, n);
async function submit(b) {
  const email = String(b.email || '').trim().toLowerCase();
  if (!validEmail(email)) return { status: 400, body: { error: 'Please enter a valid email address.' } };
  const ent = await resolve(b.entity); if (!ent) return { status: 400, body: { error: 'Unknown listing.' } };
  const fields = { role: clip(b.role, 120), description: clip(b.description, 1000), pricing: clip(b.pricing, 1000), corrections: clip(b.corrections, 2000) };
  if (!fields.description && !fields.pricing && !fields.corrections) return { status: 400, body: { error: 'Add a description, pricing or a correction.' } };
  const doc = await readJSON(`pages/${ent.feed}.json`); const info = doc?.entities?.[ent.entity]?.info || {};
  const dom = email.split('@')[1]; const hosts = [info.url, info.homepage, info.repository].filter(Boolean).map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } });
  const domainMatch = hosts.some((h) => h && (h === dom || h.endsWith('.' + dom))) || (ent.feed === 'ai-pricing' && ent.entity.includes(dom));
  const date = new Date().toISOString().slice(0, 10); const id = `${date}/${crypto.randomBytes(8).toString('hex')}`;
  await writeJSON(`${ns()}/${id}.json`, { status: 'unverified', createdAt: new Date().toISOString(), ...ent, email, domainMatch, ...fields });
  const url = `https://agentdataco.com/api/confirm?c=${encodeURIComponent(id)}&t=${encodeURIComponent(makeToken(`claim|${id}|${email}`))}`;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
    from: 'Agent Data Co <hello@agentdataco.com>', to: [email], reply_to: 'hello@agentdataco.com', subject: `Verify your claim for ${ent.name} on Agent Data Co`, tags: [{ name: 'type', value: 'claim_verify' }],
    html: `<p>Hi,</p><p>Please confirm you submitted details for <strong>${ent.name.replace(/[<>&"]/g, '')}</strong> (https://agentdataco.com${ent.path}). We'll review it within a working day or two.</p><p><a href="${url}" style="background:#4f6bed;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Verify my submission</a></p><p>If this wasn't you, ignore this email and nothing will be submitted.</p><p style="color:#888;font-size:12px">Agent Data Co · Transcend UK Holdings Ltd · Office 101, 1 Eastman Road, Harrow, HA1 4WL, UK</p>`,
    text: `Verify your Agent Data Co listing claim for ${ent.name}: ${url}\n\nIf this wasn't you, ignore this email.` }) });
  if (!r.ok) { console.error('claim email', r.status); return { status: 502, body: { error: 'Could not send verification email. Please try again later.' } }; }
  return { status: 200, body: { ok: true } };
}
// returns true if verified
async function verify(id, email) {
  if (!/^\d{4}-\d{2}-\d{2}\/[0-9a-f]{16}$/.test(id)) return false;
  const p = `${ns()}/${id}.json`; const c = await readJSON(p);
  if (!c || c.email !== email) return false;
  if (c.status === 'unverified') {
    c.status = 'verified'; c.verifiedAt = new Date().toISOString(); await writeJSON(p, c);
    // notify the ops inbox (hello@ is checked by the daily routine); the Blob record is the queue of record
    const body = `Verified listing claim (review queue: Blob ${p})\n\nEntity: ${c.name} https://agentdataco.com${c.path} (${c.feed} / ${c.entity})\nFrom: ${c.email} (role: ${c.role || '-'}; email domain matches project: ${c.domainMatch ? 'YES' : 'no'})${process.env.VERCEL_ENV === 'production' ? '' : '\nPREVIEW TEST'}\n\nDescription:\n${c.description || '-'}\n\nPricing:\n${c.pricing || '-'}\n\nCorrections:\n${c.corrections || '-'}`;
    await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Agent Data Co <hello@agentdataco.com>', to: ['hello@agentdataco.com'], reply_to: c.email, subject: `[claim] ${c.domainMatch ? '[domain match] ' : ''}${c.name}`, text: body, tags: [{ name: 'type', value: 'claim_review' }] }) }).catch((e) => console.error('claim notify', e.message));
  }
  return true;
}
module.exports = { submit, verify, ns };
