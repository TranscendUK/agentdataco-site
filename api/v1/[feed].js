const { FEEDS, authorize, getFeed, filterRows, send } = require('../../lib/api');
const watchlist = require('../../lib/watchlist');
const demand = require('../../lib/demand');
const alerts = require('../../lib/alerts');
const { momentumMap, CFG } = require('../../lib/pages');
const { ENT } = require('../../lib/archive');
const { METHOD } = require('../../lib/momentum');
const chan = (req) => (req.headers['x-adc-channel'] === 'mcp' ? 'mcp' : 'api');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Authorization'); return res.status(204).end(); }
  const name = req.query.feed;
  if (name === 'sample') return sample(req, res);
  if (name === 'demand') return send(res, 200, { agentDemandIndex: await demand.week(), page: 'https://agentdataco.com/demand' }, { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' });
  if (name === 'momentum') return leaderboard(req, res);
  if (name === 'watches') { const a = await authorize(req, res); if (!a) return; return alerts.handle(req, res, a, send); }
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
  await demand.log(chan(req), name, want ? (rows[0] ? ENT[name].id(rows[0]) : null) : null);
  const mm = await momentumMap(name).catch(() => ({}));
  const data = f.rows.slice(offset, offset + limit).map((r) => { const m = mm[ENT[name].id(r)]; return m ? { ...r, adcMomentum: m.score } : r; });
  const body = { feed: name, title: def.title, source: def.source, updatedAt: feed.updatedAt, total: f.rows.length, offset, limit, count: data.length, data, mostLookedUpByAgentsThisWeek: (await demand.week().catch(() => null))?.mostLookedUp?.filter((x) => x.feed === name).slice(0, 5) || [] };
  if (want && !rows.length) body.watchlist = { requested: want, status: queued ? 'queued: will be collected from the next daily run' : 'not tracked (already queued or not a valid value)' };
  return send(res, 200, body, { ...a.rl, 'Cache-Control': 'private, no-store' });
};
async function sample(req, res) {
  const names = req.query.name ? [req.query.name] : Object.keys(FEEDS);
  if (names.some((n) => !FEEDS[n])) return send(res, 404, { error: 'Unknown feed', feeds: Object.keys(FEEDS) });
  const out = {};
  for (const n of names) { const f = await getFeed(n); out[n] = { title: FEEDS[n].title, endpoint: `/api/v1/${n}`, updatedAt: f?.updatedAt || null, total: f?.rows?.length || 0, sample: (f?.rows || []).slice(0, 5) }; }
  const w = await demand.week().catch(() => null);
  return send(res, 200, { mostLookedUpByAgentsThisWeek: w?.mostLookedUp?.slice(0, 10) || [], note: 'Free sample: 5 rows per feed. Full feeds, history and trends need an API key: https://agentdataco.com/docs', feeds: out }, { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' });
}

// Public ADC Momentum leaderboard: /api/v1/momentum?category=<feed>&limit=
async function leaderboard(req, res) {
  const cat = req.query.category; const feeds = cat ? [cat] : Object.keys(CFG).filter((f) => f !== 'ai-pricing');
  if (feeds.some((f) => !CFG[f] || f === 'ai-pricing')) return send(res, 400, { error: 'Unknown feed', feeds: Object.keys(CFG).filter((f) => f !== 'ai-pricing') });
  const n = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25)); const out = {};
  for (const f of feeds) out[f] = Object.entries(await momentumMap(f)).sort((a, b) => b[1].score - a[1].score).slice(0, n).map(([id, m], i) => ({ rank: i + 1, id, ...m, badge: `https://agentdataco.com/badge${new URL(m.page).pathname}.svg` }));
  return send(res, 200, { method: METHOD, leaderboard: out, page: 'https://agentdataco.com/leaderboard' }, { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' });
}
