const crypto = require('crypto');
const { readJSON, writeJSON } = require('../lib/store');
const { hashKey, newKey } = require('../lib/api');
const rawBody = (req) => new Promise((ok, no) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });
function verify(raw, header, secret) {
  if (!header || !secret) return false;
  const v1 = []; let t;
  for (const kv of header.split(',')) { const [k, v] = kv.split('='); if (k === 't') t = v; if (k === 'v1') v1.push(v); }
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const exp = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return v1.some((s) => s.length === exp.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp)));
}
async function emailKey(to, key, tier) {
  const docs = 'https://agentdataco.com/docs';
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
    from: 'Agent Data Co <hello@agentdataco.com>', to: [to], reply_to: 'hello@agentdataco.com', subject: 'Your Agent Data Co API key',
    html: `<p>Thanks for subscribing to the <strong>Agent Data Co API</strong>.</p><p>Your API key (keep it secret; we only store a hash, so we can't show it again):</p><p><code style="font-size:15px;background:#f3f4f6;padding:8px 10px;border-radius:6px;display:inline-block">${key}</code></p><p>Try it:</p><pre style="background:#f3f4f6;padding:10px;border-radius:6px">curl -H "Authorization: Bearer ${key}" \\\n  "https://agentdataco.com/api/v1/github-ai-repos?limit=10"</pre><p>Endpoints, parameters and the OpenAPI spec: <a href="${docs}">${docs}</a>. Your plan includes ${tier === 'pro' ? '100,000' : '10,000'} requests per month.</p><p>Questions or lost key? Just reply to this email.</p><p style="color:#888;font-size:12px">Agent Data Co · Transcend UK Holdings Ltd · Office 101, 1 Eastman Road, Harrow, HA1 4WL, UK</p>`,
    text: `Thanks for subscribing to the Agent Data Co API.\n\nYour API key: ${key}\n(We only store a hash; keep it safe.)\n\ncurl -H "Authorization: Bearer ${key}" "https://agentdataco.com/api/v1/github-ai-repos?limit=10"\n\nDocs: ${docs}\n${tier === 'pro' ? '100,000' : '10,000'} requests/month. Reply to this email with questions.` }) });
  if (!r.ok) throw new Error(`resend ${r.status}`);
  return (await r.json()).id;
}
const FOOTER = '<p style="color:#888;font-size:12px">Agent Data Co · Transcend UK Holdings Ltd · Office 101, 1 Eastman Road, Harrow, HA1 4WL, UK</p>';
async function resend(payload) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Agent Data Co <hello@agentdataco.com>', reply_to: 'hello@agentdataco.com', ...payload }) });
  if (!r.ok) throw new Error(`resend ${r.status}`);
  return (await r.json()).id;
}
// Retention: day-3 check-in with tips, scheduled at key issue (Resend scheduled_at, max 30 days ahead).
const checkin = (to, tier) => resend({ to: [to], subject: 'Getting the most out of your Agent Data Co API key', scheduled_at: new Date(Date.now() + 3 * 864e5).toISOString(), tags: [{ name: 'type', value: 'day3_checkin' }],
  html: `<p>Hi,</p><p>You've had your Agent Data Co API key for a few days, so here are a few things worth trying:</p><ul><li><strong>Trends:</strong> <code>/api/v1/trends?window=7d</code> gives top movers and change events (new MCP servers, LLM price changes, pricing-page changes).</li><li><strong>History:</strong> <code>/api/v1/github-ai-repos/history?entity=owner/repo</code> returns a daily series (${tier === 'pro' ? 'full archive on Pro' : '30 days on Starter'}).</li><li><strong>Watchlist:</strong> ask for a repo or pricing page we don't track (<code>?repo=owner/name</code> or <code>?url=</code>) and it joins the daily collection.</li><li><strong>MCP:</strong> point Claude, Cursor or any MCP client at <code>https://agentdataco.com/mcp</code> with header <code>Authorization: Bearer &lt;your key&gt;</code>.</li><li><strong>Incremental pulls:</strong> use <code>since=YYYY-MM-DD</code> to fetch only new rows.</li></ul><p>Docs: <a href="https://agentdataco.com/docs">agentdataco.com/docs</a>. Anything missing or broken? Just reply; it comes straight to us.</p>${FOOTER}`,
  text: `Tips for your Agent Data Co API key:\n- Trends: /api/v1/trends?window=7d\n- History: /api/v1/<feed>/history?entity=...\n- Watchlist: ?repo=owner/name or ?url=\n- MCP: https://agentdataco.com/mcp with Authorization: Bearer <key>\n- since=YYYY-MM-DD for incremental pulls\nDocs: https://agentdataco.com/docs\nReply with any questions.` });
const paymentFailed = (to, url) => resend({ to: [to], subject: 'Action needed: your Agent Data Co payment failed', tags: [{ name: 'type', value: 'payment_failed' }],
  html: `<p>Hi,</p><p>We couldn't take the latest payment for your Agent Data Co API subscription. Stripe will retry automatically, but to avoid your API key being paused please update your payment method${url ? `: <a href="${url}">view and pay the invoice</a>` : ' via the link in your Stripe receipt email'}.</p><p>If you meant to cancel, no action is needed. Questions? Just reply.</p>${FOOTER}`,
  text: `We couldn't take the latest payment for your Agent Data Co API subscription. Stripe will retry; to keep your key active please update your payment method${url ? ': ' + url : ''}. Reply with any questions.` });
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const raw = (await rawBody(req)).toString('utf8');
  if (!verify(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) return res.status(400).json({ error: 'bad signature' });
  const evt = JSON.parse(raw); const o = evt.data?.object || {};
  try {
    if (evt.type === 'checkout.session.completed') {
      if (process.env.STRIPE_PAYMENT_LINK_ID && ![process.env.STRIPE_PAYMENT_LINK_ID, process.env.PRO_PAYMENT_LINK_ID].filter(Boolean).includes(o.payment_link)) return res.json({ ignored: 'other payment link' });
      const ref = o.subscription || o.id;
      const existing = await readJSON(`subs/${ref}.json`);
      if (existing) return res.json({ ok: true, duplicate: true });
      const email = o.customer_details?.email || o.customer_email;
      if (!email) throw new Error('no email on session');
      const key = newKey(); const h = hashKey(key); const now = new Date().toISOString();
      const tier = process.env.PRO_PAYMENT_LINK_ID && o.payment_link === process.env.PRO_PAYMENT_LINK_ID ? 'pro' : 'starter';
      await writeJSON(`keys/${h}.json`, { status: 'active', tier, email, customer: o.customer || null, subscription: o.subscription || null, session: o.id, livemode: !!evt.livemode, createdAt: now });
      const emailId = await emailKey(email, key, tier);
      let checkinId = null; try { checkinId = await checkin(email, tier); } catch (e) { console.error('checkin schedule failed', e.message); }
      await writeJSON(`subs/${ref}.json`, { keyHash: h, email, tier, createdAt: now, event: evt.id, emailId, checkinId });
      console.log('key issued', { ref, emailId });
      return res.json({ ok: true, issued: true });
    }
    if (evt.type === 'customer.subscription.deleted') {
      const s = await readJSON(`subs/${o.id}.json`);
      if (!s) return res.json({ ok: true, unknown: true });
      const rec = (await readJSON(`keys/${s.keyHash}.json`)) || {};
      await writeJSON(`keys/${s.keyHash}.json`, { ...rec, status: 'revoked', revokedAt: new Date().toISOString() });
      return res.json({ ok: true, revoked: true });
    }
    if (evt.type === 'invoice.payment_failed') {
      const done = await readJSON(`dunning/${o.id}-${o.attempt_count || 0}.json`);
      if (done) return res.json({ ok: true, duplicate: true });
      const s = o.subscription ? await readJSON(`subs/${o.subscription}.json`) : null;
      if (!s && process.env.STRIPE_PAYMENT_LINK_ID) return res.json({ ignored: 'not an Agent Data Co subscription' });
      const email = o.customer_email || s?.email;
      if (!email) return res.json({ ok: true, noEmail: true });
      const id = await paymentFailed(email, o.hosted_invoice_url);
      await writeJSON(`dunning/${o.id}-${o.attempt_count || 0}.json`, { email, invoice: o.id, subscription: o.subscription || null, emailId: id, at: new Date().toISOString() });
      return res.json({ ok: true, emailed: true });
    }
    return res.json({ ok: true, ignored: evt.type });
  } catch (e) { console.error('webhook error', e.message); return res.status(500).json({ error: 'processing failed' }); }
};
module.exports.config = { api: { bodyParser: false } };
