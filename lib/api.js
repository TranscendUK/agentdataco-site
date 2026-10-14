const crypto = require('crypto');
const { readJSON, writeJSON } = require('./store');
const { FEEDS } = require('./feeds');
const MONTHLY_LIMIT = 10000;
const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');
const newKey = () => 'adc_live_' + crypto.randomBytes(24).toString('base64url');
const month = () => new Date().toISOString().slice(0, 7);

// small in-memory caches (per function instance) to keep Blob operations near zero
const cache = new Map();
async function cached(k, ttl, fn) {
  const c = cache.get(k); if (c && Date.now() - c.t < ttl) return c.v;
  const v = await fn(); cache.set(k, { v, t: Date.now() }); return v;
}
const getFeed = (name) => cached('feed:' + name, 10 * 60e3, () => readJSON(`feeds/${name}.json`));
const getKeyRec = (h) => cached('key:' + h, 5 * 60e3, () => readJSON(`keys/${h}.json`));

// Usage: per-instance pending counter flushed to Blob periodically (approximate across instances).
const usage = new Map();
async function countUse(h) {
  const m = month(); const id = `${h}:${m}`;
  let u = usage.get(id);
  if (!u) { const stored = await readJSON(`usage/${m}/${h}.json`); u = { base: stored?.count || 0, pending: 0, flushedAt: Date.now() }; usage.set(id, u); }
  u.pending++;
  const total = u.base + u.pending;
  if (u.pending >= 50 || Date.now() - u.flushedAt > 60e3) {
    const stored = await readJSON(`usage/${m}/${h}.json`);
    const count = Math.max(stored?.count || 0, u.base) + u.pending;
    await writeJSON(`usage/${m}/${h}.json`, { count, updatedAt: new Date().toISOString() });
    u.base = count; u.pending = 0; u.flushedAt = Date.now();
  }
  return total;
}

function filterRows(rows, field, q) {
  let out = rows || [];
  if (q.since) { const s = new Date(q.since); if (isNaN(s)) return { error: 'Invalid `since` (use ISO 8601 date, e.g. 2026-10-01)' }; out = out.filter((r) => r[field] && new Date(r[field]) >= s); }
  if (q.q) { const n = String(q.q).toLowerCase(); out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(n)); }
  return { rows: out };
}
const send = (res, status, body, headers = {}) => { for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); res.setHeader('Access-Control-Allow-Origin', '*'); res.status(status).json(body); };

const TIERS = { starter: { historyDays: 30, monthly: MONTHLY_LIMIT }, pro: { historyDays: 3650, monthly: 100000 } };
// Returns {rec, h, tier, rl} or null after sending an error response.
async function authorize(req, res) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m) { send(res, 401, { error: 'Missing API key. Send `Authorization: Bearer <key>`. Free sample: /api/v1/sample. Get a key: https://agentdataco.com/#api' }, { 'WWW-Authenticate': 'Bearer' }); return null; }
  const h = hashKey(m[1]);
  const rec = await getKeyRec(h);
  if (!rec || rec.status !== 'active') { send(res, 401, { error: rec ? 'API key revoked (subscription ended).' : 'Invalid API key.' }); return null; }
  const tier = TIERS[rec.tier] ? rec.tier : 'starter';
  const used = await countUse(h);
  const limit = TIERS[tier].monthly;
  const rl = { 'X-RateLimit-Limit': String(limit), 'X-RateLimit-Remaining': String(Math.max(0, limit - used)), 'X-Plan': tier };
  if (used > limit) { send(res, 429, { error: `Monthly limit of ${limit} requests reached. Resets on the 1st (UTC). Contact hello@agentdataco.com for more.` }, rl); return null; }
  return { rec, h, tier, rl, limits: TIERS[tier] };
}
module.exports = { TIERS, authorize, FEEDS, MONTHLY_LIMIT, hashKey, newKey, getFeed, getKeyRec, countUse, filterRows, send, month };
