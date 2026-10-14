// Agent Demand Index: anonymised, aggregated counts of which entities/feeds are looked up via the API and MCP.
// Blob: <ns>/<YYYY-MM-DD>.json {date, total, channels:{api,mcp}, feeds:{<feed>:n}, entities:{"<feed>|<id>":n}}
// No key, IP or user data is stored: only counts. Preview deployments write to demand-preview/ so tests never pollute production.
const { readJSON, writeJSON } = require('./store');
const ns = () => (process.env.VERCEL_ENV === 'production' ? 'demand' : 'demand-preview');
const today = () => new Date().toISOString().slice(0, 10);
const shift = (d, n) => new Date(Date.parse(d) - n * 864e5).toISOString().slice(0, 10);
let buf = null; // per-instance pending counts, flushed with read-merge-write (approximate across instances, like usage/)
const blank = (d) => ({ date: d, total: 0, channels: {}, feeds: {}, entities: {} });
function add(t, s) {
  t.total += s.total;
  for (const k of ['channels', 'feeds', 'entities']) for (const [x, n] of Object.entries(s[k] || {})) t[k][x] = (t[k][x] || 0) + n;
  return t;
}
async function flush(force) {
  if (!buf || !buf.total) return;
  if (!force && buf.total < 10 && Date.now() - buf.at < 20e3) return;
  const b = buf; buf = null;
  try {
    const path = `${ns()}/${b.date}.json`;
    const cur = (await readJSON(path)) || blank(b.date);
    if (Object.keys(cur.entities).length > 20000) b.entities = {}; // safety cap on blob size
    await writeJSON(path, { ...add(cur, b), updatedAt: new Date().toISOString() });
  } catch (e) { console.error('demand flush', e.message); }
}
// channel: 'api' | 'mcp'; entity optional (exact id as used in the archive)
async function log(channel, feed, entity) {
  try {
    const d = today();
    if (!buf || buf.date !== d) { if (buf) await flush(true); buf = { ...blank(d), at: Date.now() }; }
    buf.total++; buf.channels[channel] = (buf.channels[channel] || 0) + 1;
    if (feed) buf.feeds[feed] = (buf.feeds[feed] || 0) + 1;
    if (feed && entity) { const k = `${feed}|${String(entity).slice(0, 200)}`; buf.entities[k] = (buf.entities[k] || 0) + 1; }
    await flush(false);
  } catch (e) { console.error('demand log', e.message); }
}
async function raw(days = 7) {
  await flush(true);
  const end = today(); const dates = Array.from({ length: days }, (_, i) => shift(end, i));
  const docs = (await Promise.all(dates.map((d) => readJSON(`${ns()}/${d}.json`).catch(() => null)))).filter(Boolean);
  return { t: docs.reduce((a, d) => add(a, d), blank(end)), dates, docs };
}
// {feed: {id: lookups}} over the last 7 days (momentum input)
async function byEntity() { const { t } = await raw(7); const o = {}; for (const [k, c] of Object.entries(t.entities)) { const i = k.indexOf('|'); (o[k.slice(0, i)] ||= {})[k.slice(i + 1)] = c; } return o; }
// Aggregate the last `days` days (default 7). Only entities we track (have a public page) are listed, so arbitrary strings never get published.
const wcache = { v: null, t: 0 };
async function week(days = 7, n = 25) {
  if (wcache.v && Date.now() - wcache.t < 10 * 60e3) return wcache.v;
  const { t, dates, docs } = await raw(days); const end = dates[0];
  const { CFG } = require('./pages');
  const idx = Object.fromEntries(await Promise.all(Object.keys(CFG).map(async (f) => [f, (await readJSON(`pages/${f}.json`).catch(() => null))?.entities || {}])));
  const top = Object.entries(t.entities).map(([k, c]) => { const i = k.indexOf('|'); const feed = k.slice(0, i), id = k.slice(i + 1); const e = idx[feed]?.[id]; return e ? { feed, id, name: e.name, page: `https://agentdataco.com${e.path}`, lookups: c, momentum: e.momentum?.score ?? null } : null; })
    .filter(Boolean).sort((a, b) => b.lookups - a.lookups).slice(0, n);
  const v = { window: `${dates[dates.length - 1]}..${end}`, days: docs.length, totalLookups: t.total, channels: t.channels, feeds: Object.entries(t.feeds).sort((a, b) => b[1] - a[1]).map(([feed, lookups]) => ({ feed, lookups })), mostLookedUp: top, method: 'Anonymised, aggregated counts of entity/feed lookups made by API and MCP clients (no keys, IPs or users stored). Only tracked entities are listed.' };
  wcache.v = v; wcache.t = Date.now(); return v;
}
// per-entity lookups over the week (used as a small momentum input)
module.exports = { log, flush, week, byEntity, ns };
