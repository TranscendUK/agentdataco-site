// Programmatic SEO index. One compact blob per feed: pages/<feed>.json
//   { updatedAt, date, entities: { <id>: { path, name, info:{...}, latest:{...}, series:[[date, value], ...] } } }
// Updated incrementally by the daily cron (1 read + 1 write per feed), so page renders read one blob.
const { readJSON, writeJSON } = require('./store');
const { ENT } = require('./archive');
const momentum = require('./momentum');
const SERIES_DAYS = 365;
const enc = (s) => String(s).split('/').map(encodeURIComponent).join('/');
const CFG = {
  'github-ai-repos': { kind: 'repo', cap: 800, pick: (rows) => [...rows].sort((a, b) => b.stargazers_count - a.stargazers_count), path: (r) => `/repo/${enc(r.full_name)}`, name: (r) => r.full_name, metric: 'stars', unit: 'GitHub stars',
    info: (r) => ({ description: r.description, url: r.html_url, language: r.language, license: r.license, topics: (r.topics || []).slice(0, 12), created_at: r.created_at, homepage: r.homepage }) },
  'mcp-servers': { kind: 'mcp', cap: 420, pick: (rows) => [...rows].sort((a, b) => (b.remotes?.length ? 1 : 0) - (a.remotes?.length ? 1 : 0) || ((a.publishedAt || '') < (b.publishedAt || '') ? 1 : -1)), path: (r) => `/mcp/${enc(r.name)}`, name: (r) => r.title || r.name, metric: null, unit: 'version',
    info: (r) => ({ id: r.name, description: r.description, url: r.websiteUrl || r.repository?.url || null, repository: r.repository?.url || null, remotes: (r.remotes || []).map((x) => `${x.type} ${x.url}`), packages: (r.packages || []).map((p) => `${p.registryType || p.registry_type || ''} ${p.identifier || p.name || ''}`.trim()), publishedAt: r.publishedAt }) },
  'llm-pricing': { kind: 'llm', cap: 500, pick: (rows) => rows, path: (r) => `/llm/${enc(r.id)}`, name: (r) => r.name || r.id, metric: 'promptUsdPer1M', unit: 'USD per 1M input tokens',
    info: (r) => ({ id: r.id, provider: r.provider, contextLength: r.contextLength, maxCompletionTokens: r.maxCompletionTokens, inputModalities: r.inputModalities, supportsTools: r.supportsTools, created: r.created, url: `https://openrouter.ai/${r.id}` }) },
  'ai-pricing': { kind: 'pricing', cap: 100, pick: (rows) => rows, path: (r) => `/pricing/${encodeURIComponent(new URL(r.url).hostname.replace(/^www\./, ''))}`, name: (r) => r.title || new URL(r.url).hostname, metric: null, unit: 'pricing page',
    info: (r) => ({ url: r.url, plans: (r.plans || []).map((p) => `${p.name}: ${p.prices.join(' / ')}`), lastChangedAt: r.lastChangedAt }) },
  'hf-trending': { kind: 'hf', cap: 300, pick: (rows) => rows, path: (r) => `/hf/${r.type}/${enc(r.id)}`, name: (r) => r.id, metric: 'likes', unit: 'Hugging Face likes',
    info: (r) => ({ type: r.type, url: r.url, author: r.author, pipelineTag: r.pipelineTag, license: r.license, downloads: r.downloads, createdAt: r.createdAt }) },
};
const KIND = Object.fromEntries(Object.entries(CFG).map(([f, c]) => [c.kind, f]));
function seriesValue(feed, m) { const c = CFG[feed]; if (feed === 'mcp-servers') return m.version ?? null; if (feed === 'ai-pricing') return (m.prices || []).join(' | '); return m[c.metric] ?? null; }

async function updatePages(feed, rows, date, demand = {}) {
  const c = CFG[feed]; if (!c) return null;
  const prev = (await readJSON(`pages/${feed}.json`)) || { entities: {} };
  const e = ENT[feed]; const out = {};
  for (const r of c.pick(rows).slice(0, c.cap)) {
    const id = e.id(r); if (!id || out[id]) continue;
    let path; try { path = c.path(r); } catch { continue; }
    const latest = e.m(r); const v = seriesValue(feed, latest);
    const series = (prev.entities[id]?.series || []).filter((p) => p[0] !== date);
    series.push([date, v]);
    out[id] = { path, name: c.name(r), info: c.info(r), latest, series: series.slice(-SERIES_DAYS) };
  }
  const ms = momentum.compute(feed, out, demand);
  for (const [id, m] of Object.entries(ms)) {
    const hist = (prev.entities[id]?.momentumHist || []).filter((p) => p[0] !== date);
    const before = hist.length ? hist[hist.length - 1][1] : null;
    hist.push([date, m.score]);
    out[id].momentum = { ...m, prev: before, change: before == null ? null : m.score - before };
    out[id].momentumHist = hist.slice(-60);
  }
  const doc = { feed, kind: c.kind, updatedAt: new Date().toISOString(), date, count: Object.keys(out).length, entities: out };
  await writeJSON(`pages/${feed}.json`, doc);
  return doc.count;
}
// cached {id: momentum} per feed for API responses
const mcache = new Map();
async function momentumMap(feed) {
  if (!CFG[feed]) return {};
  const c = mcache.get(feed); if (c && Date.now() - c.t < 10 * 60e3) return c.v;
  const d = await readJSON(`pages/${feed}.json`).catch(() => null); const v = {};
  for (const [id, e] of Object.entries(d?.entities || {})) if (e.momentum) v[id] = { score: e.momentum.score, change: e.momentum.change, page: `https://agentdataco.com${e.path}` };
  mcache.set(feed, { v, t: Date.now() }); return v;
}
module.exports = { CFG, KIND, updatePages, SERIES_DAYS, momentumMap };
