// Append-only daily archive + derived metrics + trends. Stored in Vercel Blob:
//   snapshots/<feed>/<YYYY-MM-DD>.json  {date, feed, entities:{id:{...metrics, rank}}}   (never overwritten after the day)
//   derived/<feed>/<YYYY-MM-DD>.json    {date, deltas:{id:{...}}, events:[...]}
//   trends/<YYYY-MM-DD>.json + trends/latest.json
const { readJSON, writeJSON } = require('./store');
const day = (d = new Date()) => d.toISOString().slice(0, 10);
const shift = (date, n) => day(new Date(Date.parse(date) - n * 864e5));

const ENT = {
  'github-ai-repos': { id: (r) => r.full_name, m: (r) => ({ stars: r.stargazers_count, forks: r.forks_count, issues: r.open_issues_count, pushed_at: r.pushed_at }), score: 'stars' },
  'show-hn-ai': { id: (r) => r.id, m: (r) => ({ points: r.points, comments: r.num_comments, title: r.title }), score: 'points' },
  'mcp-servers': { id: (r) => r.name, m: (r) => ({ version: r.version, updatedAt: r.updatedAt }), score: null },
  'hf-trending': { id: (r) => `${r.type}:${r.id}`, m: (r) => ({ likes: r.likes, downloads: r.downloads, trendingScore: r.trendingScore }), score: 'likes' },
  'llm-pricing': { id: (r) => r.id, m: (r) => ({ promptUsdPer1M: r.promptUsdPer1M, completionUsdPer1M: r.completionUsdPer1M, contextLength: r.contextLength }), score: null },
  'ai-pricing': { id: (r) => r.url, m: (r) => ({ contentHash: r.contentHash, prices: r.prices, plans: (r.plans || []).map((p) => `${p.name}: ${p.prices.join(' / ')}`) }), score: null },
};

function snapshotOf(feed, rows, date) {
  const e = ENT[feed]; const entities = {};
  rows.forEach((r, i) => { const id = e.id(r); if (id && !entities[id]) entities[id] = { ...e.m(r), rank: i + 1 }; });
  return { date, feed, count: Object.keys(entities).length, entities };
}

function derive(feed, cur, prev) {
  const e = ENT[feed]; const deltas = {}; const events = [];
  if (!prev) return { date: cur.date, prevDate: null, deltas, events: [{ type: 'first_snapshot' }] };
  for (const [id, c] of Object.entries(cur.entities)) {
    const p = prev.entities[id];
    if (!p) { events.push({ type: 'new_entity', id }); continue; }
    const d = { rankChange: p.rank - c.rank };
    if (e.score) d[e.score + 'Delta'] = (c[e.score] ?? 0) - (p[e.score] ?? 0);
    if (feed === 'llm-pricing' && (c.promptUsdPer1M !== p.promptUsdPer1M || c.completionUsdPer1M !== p.completionUsdPer1M)) events.push({ type: 'price_change', id, before: { promptUsdPer1M: p.promptUsdPer1M, completionUsdPer1M: p.completionUsdPer1M }, after: { promptUsdPer1M: c.promptUsdPer1M, completionUsdPer1M: c.completionUsdPer1M } });
    if (feed === 'ai-pricing' && c.contentHash !== p.contentHash) events.push({ type: 'pricing_page_change', id, before: p.plans, after: c.plans });
    if (feed === 'mcp-servers' && c.version !== p.version) events.push({ type: 'version_bump', id, before: p.version, after: c.version });
    deltas[id] = d;
  }
  for (const id of Object.keys(prev.entities)) if (!cur.entities[id]) events.push({ type: 'removed_entity', id });
  return { date: cur.date, prevDate: prev.date, deltas, events };
}

// nearest existing snapshot on or before `date`, scanning back up to `max` days
async function snapAtOrBefore(feed, date, max = 3) {
  for (let i = 0; i <= max; i++) { const s = await readJSON(`snapshots/${feed}/${shift(date, i)}.json`); if (s) return s; }
  return null;
}

function movers(feed, cur, old, n = 15) {
  const sc = ENT[feed].score; if (!sc || !old) return [];
  return Object.entries(cur.entities).filter(([id]) => old.entities[id]).map(([id, c]) => ({ id, [sc]: c[sc], delta: (c[sc] ?? 0) - (old.entities[id][sc] ?? 0), rank: c.rank, rankChange: old.entities[id].rank - c.rank }))
    .filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, n);
}

async function archive(feed, rows) {
  const date = day();
  const path = `snapshots/${feed}/${date}.json`;
  const cur = snapshotOf(feed, rows, date);
  if (!(await readJSON(path))) await writeJSON(path, cur); // append-only: first snapshot of the day wins
  const prev = await snapAtOrBefore(feed, shift(date, 1), 7);
  const der = derive(feed, cur, prev);
  if (!(await readJSON(`derived/${feed}/${date}.json`))) await writeJSON(`derived/${feed}/${date}.json`, der);
  const out = { feed, date, events: der.events.filter((e) => e.type !== 'first_snapshot').slice(0, 50), newEntities: der.events.filter((e) => e.type === 'new_entity').length };
  for (const w of [1, 7, 30]) { const old = w === 1 ? prev : await snapAtOrBefore(feed, shift(date, w), 3); out[`movers_${w}d`] = movers(feed, cur, old); out[`baseline_${w}d`] = old?.date || null; }
  return out;
}

async function buildTrends(parts) {
  const t = { generatedAt: new Date().toISOString(), date: day(), feeds: Object.fromEntries(parts.filter(Boolean).map((p) => [p.feed, p])) };
  await writeJSON(`trends/${t.date}.json`, t); await writeJSON('trends/latest.json', t);
  return t;
}

async function history(feed, entity, from, to) {
  const out = []; const dates = [];
  for (let d = from; d <= to; d = shift(d, -1)) dates.push(d);
  const snaps = await Promise.all(dates.map((d) => readJSON(`snapshots/${feed}/${d}.json`).catch(() => null)));
  snaps.forEach((s, i) => { if (s && s.entities[entity]) out.push({ date: dates[i], ...s.entities[entity] }); });
  return out;
}
module.exports = { archive, buildTrends, history, day, shift, ENT, snapshotOf, derive, movers };
