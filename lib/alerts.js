// Watches + email alerts for paid keys. Managed via /api/v1/watches (handled inside api/v1/[feed].js, no new function);
// evaluated by the daily cron after the archive/pages/trends are rebuilt.
// Blob: <ns>/index.json {keys:[keyHash]}, <ns>/<keyHash>.json {email, tier, test, watches:[{id, feed, entity, name, path, type, threshold, createdAt, lastSent}]}
const crypto = require('crypto');
const { readJSON, writeJSON } = require('./store');
const { CFG, KIND } = require('./pages');
const ns = () => (process.env.VERCEL_ENV === 'production' ? 'alerts' : 'alerts-preview');
const MAX = { starter: 5, pro: 50 };
const TYPES = {
  any: 'any change: price/pricing-page change, new version, or momentum move of 10+ points',
  price_change: 'LLM price change or pricing-page change',
  version_bump: 'new MCP server version',
  momentum_jump: 'ADC Momentum moves by at least `threshold` points (default 10) day over day',
  momentum_above: 'ADC Momentum crosses above `threshold` (default 80)',
};
async function resolve(input, feedIn) {
  const s = String(input || '').trim().replace(/^https?:\/\/(www\.)?agentdataco\.com/i, '');
  if (feedIn && CFG[feedIn]) { const d = await readJSON(`pages/${feedIn}.json`); const e = d?.entities?.[s]; return e ? { feed: feedIn, entity: s, name: e.name, path: e.path } : null; }
  const m = /^\/?(repo|mcp|llm|pricing|hf)\/(.+)$/.exec(s); if (!m) return null;
  const feed = KIND[m[1]]; const d = await readJSON(`pages/${feed}.json`); let want; try { want = decodeURIComponent(`/${m[1]}/${m[2]}`).toLowerCase(); } catch { return null; }
  for (const [id, e] of Object.entries(d?.entities || {})) if (decodeURIComponent(e.path).toLowerCase() === want) return { feed, entity: id, name: e.name, path: e.path };
  return null;
}
async function addIndex(h) { const p = `${ns()}/index.json`; const x = (await readJSON(p)) || { keys: [] }; if (!x.keys.includes(h)) { x.keys.push(h); await writeJSON(p, x); } }
// REST handler: GET list, POST add {entity, feed?, type?, threshold?}, DELETE ?id=
async function handle(req, res, a, send) {
  const p = `${ns()}/${a.h}.json`;
  const doc = (await readJSON(p)) || { watches: [] };
  const max = MAX[a.tier] || MAX.starter;
  const out = (extra = {}, code = 200) => send(res, code, { plan: a.tier, max, count: doc.watches.length, types: TYPES, watches: doc.watches.map(({ lastSent, ...w }) => ({ ...w, page: `https://agentdataco.com${w.path}` })), ...extra }, { ...a.rl, 'Cache-Control': 'private, no-store' });
  if (req.method === 'GET') return out();
  const b = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })() : (req.body || {});
  if (req.method === 'DELETE') {
    const id = String(req.query.id || b.id || ''); const n = doc.watches.length;
    doc.watches = doc.watches.filter((w) => w.id !== id); if (doc.watches.length === n) return send(res, 404, { error: 'No watch with that id.' }, a.rl);
    await writeJSON(p, doc); return out({ deleted: id });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Use GET, POST or DELETE.' }, a.rl);
  if (doc.watches.length >= max) return send(res, 403, { error: `Your ${a.tier} plan allows up to ${max} watches${a.tier === 'starter' ? ' (Pro: 50)' : ''}. Delete one first.` }, a.rl);
  const type = String(b.type || 'any'); if (!TYPES[type]) return send(res, 400, { error: 'Unknown `type`', types: TYPES }, a.rl);
  const ent = await resolve(b.entity, b.feed);
  if (!ent) return send(res, 400, { error: 'Unknown `entity`. Pass an entity page path such as "/repo/owner/name", "/mcp/<server>", "/llm/<provider>/<model>", "/pricing/<host>", "/hf/<type>/<id>" (or `feed` + exact `entity` id). Only tracked entities can be watched.' }, a.rl);
  let threshold = b.threshold != null ? Number(b.threshold) : (type === 'momentum_above' ? 80 : type === 'momentum_jump' ? 10 : null);
  if (threshold != null && !(threshold >= 1 && threshold <= 100)) return send(res, 400, { error: '`threshold` must be 1-100.' }, a.rl);
  if (doc.watches.some((w) => w.feed === ent.feed && w.entity === ent.entity && w.type === type)) return out({ note: 'Already watching.' });
  doc.email = a.rec.email || doc.email; doc.tier = a.tier;
  if (a.rec.test) { doc.test = true; doc.email = /@resend\.dev$/i.test(String(b.email || '')) ? b.email : 'delivered@resend.dev'; } // preview test keys only mail Resend test addresses
  const w = { id: 'w_' + crypto.randomBytes(6).toString('hex'), ...ent, type, threshold, createdAt: new Date().toISOString() };
  doc.watches.push(w); await writeJSON(p, doc); await addIndex(a.h);
  return out({ added: w.id }, 201);
}
// Daily: evaluate watches against today's trend events + momentum and email one digest per key.
async function run(parts, date, opt = {}) {
  const idx = (await readJSON(`${ns()}/index.json`)) || { keys: [] };
  const events = {}; for (const p of parts.filter(Boolean)) for (const e of p.events || []) if (e.id != null) ((events[p.feed] ||= {})[e.id] ||= []).push(e);
  const pages = {}; const page = async (f) => (pages[f] ||= readJSON(`pages/${f}.json`).catch(() => null));
  const stats = { keys: 0, emails: 0, hits: 0, errors: 0 };
  for (const h of idx.keys) {
    try {
      const doc = await readJSON(`${ns()}/${h}.json`); if (!doc?.watches?.length) continue; stats.keys++;
      if (!doc.test) { const k = await readJSON(`keys/${h}.json`); if (!k || k.status !== 'active') continue; doc.email = k.email || doc.email; }
      if (!doc.email) continue;
      const hits = [];
      for (const w of doc.watches) {
        if (w.lastSent === date) continue;
        const e = (await page(w.feed))?.entities?.[w.entity]; const m = e?.momentum; const msgs = [];
        for (const ev of events[w.feed]?.[w.entity] || []) {
          if (ev.type === 'price_change' && ['any', 'price_change'].includes(w.type)) msgs.push(`Price change: $${ev.before.promptUsdPer1M}→$${ev.after.promptUsdPer1M} input / $${ev.before.completionUsdPer1M}→$${ev.after.completionUsdPer1M} output per 1M tokens`);
          if (ev.type === 'pricing_page_change' && ['any', 'price_change'].includes(w.type)) msgs.push(`Pricing page changed. Now: ${(ev.after || []).slice(0, 6).join('; ') || 'see page'}`);
          if (ev.type === 'version_bump' && ['any', 'version_bump'].includes(w.type)) msgs.push(`New version: ${ev.before} → ${ev.after}`);
        }
        if (m && m.change != null) {
          const th = w.threshold || 10;
          if ((w.type === 'momentum_jump' || w.type === 'any') && Math.abs(m.change) >= (w.type === 'any' ? 10 : th)) msgs.push(`ADC Momentum ${m.change > 0 ? 'up' : 'down'} ${Math.abs(m.change)} to ${m.score}`);
          if (w.type === 'momentum_above' && m.prev != null && m.prev < th && m.score >= th) msgs.push(`ADC Momentum crossed ${th}: now ${m.score}`);
        }
        if (opt.test && doc.test && !msgs.length) msgs.push(`Test alert (preview only). Current ADC Momentum: ${m?.score ?? 'n/a'}`);
        if (msgs.length) { hits.push({ w, msgs }); w.lastSent = date; }
      }
      if (!hits.length) continue;
      stats.hits += hits.length;
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      const html = `<p>Hi,</p><p>Changes detected today (${date}) for entities you watch on Agent Data Co:</p><ul>${hits.map(({ w, msgs }) => `<li><a href="https://agentdataco.com${esc(w.path)}">${esc(w.name)}</a><br>${msgs.map(esc).join('<br>')}</li>`).join('')}</ul><p>Manage watches with <code>GET/POST/DELETE https://agentdataco.com/api/v1/watches</code> (docs: https://agentdataco.com/docs#watches).</p><p style="color:#888;font-size:12px">Agent Data Co · Transcend UK Holdings Ltd · Office 101, 1 Eastman Road, Harrow, HA1 4WL, UK</p>`;
      const text = `Changes detected today (${date}) for entities you watch:\n\n${hits.map(({ w, msgs }) => `${w.name} (https://agentdataco.com${w.path})\n  ${msgs.join('\n  ')}`).join('\n\n')}\n\nManage watches: https://agentdataco.com/docs#watches`;
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `watch-${h.slice(0, 16)}-${date}` }, body: JSON.stringify({ from: 'Agent Data Co <hello@agentdataco.com>', to: [doc.email], reply_to: 'hello@agentdataco.com', subject: `Agent Data Co alert: ${hits.length} watched ${hits.length === 1 ? 'entity' : 'entities'} changed`, html, text, tags: [{ name: 'type', value: 'watch_alert' }] }) });
      if (!r.ok) { stats.errors++; console.error('alert send', r.status); continue; }
      stats.emails++; await writeJSON(`${ns()}/${h}.json`, doc);
    } catch (e) { stats.errors++; console.error('alerts', e.message); }
  }
  return stats;
}
module.exports = { handle, run, resolve, MAX, TYPES, ns };
