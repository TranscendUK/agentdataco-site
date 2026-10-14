const { FEEDS, authorize, getFeed, filterRows, send } = require('../../lib/api');
const watchlist = require('../../lib/watchlist');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Authorization'); return res.status(204).end(); }
  const name = req.query.feed;
  if (name === 'sample') return sample(req, res);
  const def = FEEDS[name];
  if (!def) return send(res, 404, { error: 'Unknown endpoint', endpoints: [...Object.keys(FEEDS).map((f) => `/api/v1/${f}`), '/api/v1/<feed>/history', '/api/v1/trends', '/api/v1/sample'], docs: 'https://agentdataco.com/docs' });
  const a = await authorize(req, res); if (!a) return;
  const feed = await getFeed(name);
  if (!feed) return send(res, 503, { error: 'Feed not yet available, try again later.' }, a.rl);
  let rows = feed.rows; let queued;
  // exact-entity filters; unknown entities are queued for daily collection (coverage growth loop)
  const want = name === 'ai-pricing' ? req.query.url : name === 'github-ai-repos' ? req.query.repo : null;
  if (want) {
    const w = String(want).toLowerCase().replace(/\/$/, '');
    rows = rows.filter((r) => (name === 'ai-pricing' ? r.url : r.full_name).toLowerCase().replace(/\/$/, '') === w);
    if (!rows.length) queued = await watchlist.request(name, want, a.h).catch(() => false);
  }
  const f = filterRows(rows, def.dateField, req.query);
  if (f.error) return send(res, 400, { error: f.error }, a.rl);
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const body = { feed: name, title: def.title, source: def.source, updatedAt: feed.updatedAt, total: f.rows.length, offset, limit, count: Math.min(limit, Math.max(0, f.rows.length - offset)), data: f.rows.slice(offset, offset + limit) };
  if (want && !rows.length) body.watchlist = { requested: want, status: queued ? 'queued: will be collected from the next daily run' : 'not tracked (already queued or not a valid value)' };
  return send(res, 200, body, { ...a.rl, 'Cache-Control': 'private, no-store' });
};
async function sample(req, res) {
  const names = req.query.name ? [req.query.name] : Object.keys(FEEDS);
  if (names.some((n) => !FEEDS[n])) return send(res, 404, { error: 'Unknown feed', feeds: Object.keys(FEEDS) });
  const out = {};
  for (const n of names) { const f = await getFeed(n); out[n] = { title: FEEDS[n].title, endpoint: `/api/v1/${n}`, updatedAt: f?.updatedAt || null, total: f?.rows?.length || 0, sample: (f?.rows || []).slice(0, 5) }; }
  return send(res, 200, { note: 'Free sample: 5 rows per feed. Full feeds, history and trends need an API key: https://agentdataco.com/docs', feeds: out }, { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' });
}
