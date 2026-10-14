// Programmatic SEO entity pages: /repo/<owner>/<name>, /mcp/<server>, /llm/<model>, /pricing/<vendor>, /hf/<type>/<id>
// Data from pages/<feed>.json (rebuilt by the daily cron). CDN-cached for a day (ISR-style).
const { readJSON } = require('../lib/store');
const { KIND, CFG } = require('../lib/pages');
const { esc, head, FOOT, chart } = require('../lib/html');
const cache = new Map();
async function index(feed) {
  const c = cache.get(feed); if (c && Date.now() - c.t < 10 * 60e3) return c.v;
  const doc = await readJSON(`pages/${feed}.json`); const byPath = new Map();
  for (const [id, e] of Object.entries(doc?.entities || {})) byPath.set(decodeURIComponent(e.path).toLowerCase(), { id, ...e });
  const v = { doc, byPath }; cache.set(feed, { v, t: Date.now() }); return v;
}
const LABEL = { repo: 'GitHub repo', mcp: 'MCP server', llm: 'LLM model', pricing: 'Pricing page', hf: 'Hugging Face' };
const API = { 'github-ai-repos': 'repo', 'mcp-servers': null, 'llm-pricing': null, 'ai-pricing': 'url', 'hf-trending': null };
function row(k, v) { if (v == null || v === '' || (Array.isArray(v) && !v.length)) return ''; const val = Array.isArray(v) ? v.map(esc).join('<br>') : /^https?:\/\//.test(String(v)) ? `<a href="${esc(v)}" rel="noopener nofollow">${esc(v)}</a>` : esc(v); return `<tr><th>${esc(k)}</th><td>${val}</td></tr>`; }
module.exports = async (req, res) => {
  const kind = String(req.query.k || ''); const feed = KIND[kind];
  let p = [].concat(req.query.p || []).join('/');
  const orig = String(req.headers['x-original-path'] || req.headers['x-vercel-original-path'] || '');
  const um = /^\/(repo|mcp|llm|pricing|hf)\/([^?#]+)/.exec(orig) || /^\/(repo|mcp|llm|pricing|hf)\/([^?#]+)/.exec(String(req.url || ''));
  if (um && um[1] === kind) p = um[2];
  const send = (code, html, cc) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', cc); res.status(code).send(html); };
  const nf = () => send(404, head({ title: 'Not tracked yet — Agent Data Co', desc: 'This entity is not in the Agent Data Co archive yet.', canonical: 'https://agentdataco.com/' }) + `<main><section><h1>Not tracked yet</h1><p>We don't have a page for this ${esc(LABEL[kind] || 'entity')} yet. Paid API requests for untracked repos and pricing pages are added to the daily collection automatically. <a href="/docs">API docs</a> · <a href="/trends">Trends</a></p></section></main>` + FOOT, 'public, s-maxage=300');
  if (!feed || !p) return nf();
  const { doc, byPath } = await index(feed);
  let path; try { path = decodeURIComponent(`/${kind}/${p}`).toLowerCase(); } catch { return nf(); }
  const e = byPath.get(path); if (!e) return nf();
  const c = CFG[feed]; const canonical = `https://agentdataco.com${e.path}`;
  const L = e.latest; const metricVal = c.metric ? L[c.metric] : null;
  const title = `${e.name} — ${LABEL[kind]} stats & history | Agent Data Co`;
  const desc = `${e.name}: latest ${c.unit}${metricVal != null ? ` (${metricVal})` : ''}, daily history and changes, tracked by Agent Data Co. ${String(e.info.description || '').slice(0, 110)}`.trim();
  const latestRows = Object.entries(L).filter(([k]) => k !== 'contentHash').map(([k, v]) => row(k, v)).join('');
  const infoRows = Object.entries(e.info).map(([k, v]) => row(k, v)).join('');
  const hist = e.series.slice(-30).reverse().map(([d, v]) => `<tr><td>${esc(d)}</td><td>${esc(v)}</td></tr>`).join('');
  const q = API[feed] ? `?${API[feed]}=${encodeURIComponent(API[feed] === 'url' ? e.id : e.id)}` : `?q=${encodeURIComponent(String(e.id).replace(/^\w+:/, ''))}`;
  const histEntity = encodeURIComponent(e.id);
  const html = head({ title, desc, canonical, jsonld: { '@context': 'https://schema.org', '@type': 'Dataset', name: `${e.name} ${c.unit} history`, description: desc, url: canonical, creator: { '@type': 'Organization', name: 'Agent Data Co', url: 'https://agentdataco.com' }, dateModified: doc.updatedAt, isAccessibleForFree: false, license: 'https://agentdataco.com/terms' } })
    + `<main><section><p class="small"><a href="/">Home</a> › <a href="/trends">${esc(LABEL[kind])}s</a></p><h1>${esc(e.name)}</h1>${e.info.description ? `<p class="lead">${esc(e.info.description)}</p>` : ''}
<h2>Latest metrics <span class="small">(snapshot ${esc(doc.date)})</span></h2><table>${latestRows}</table>
<h2>History</h2>${c.metric ? chart(e.series, c.unit) : ''}<table><thead><tr><th>Date</th><th>${esc(c.unit)}</th></tr></thead><tbody>${hist}</tbody></table>
<h2>Details</h2><table>${infoRows}</table>
<div class="panel"><h2>Get this data via API or MCP</h2><p>Full daily history, trends and change events for ${esc(e.name)} and ${'thousands'} of other AI-ecosystem entities.</p>
<pre><code>curl -H "Authorization: Bearer $ADC_KEY" \\\n  "https://agentdataco.com/api/v1/${feed}/history?entity=${esc(histEntity)}"\ncurl -H "Authorization: Bearer $ADC_KEY" \\\n  "https://agentdataco.com/api/v1/${feed}${esc(q)}"</code></pre>
<p>Or connect your agent to our remote MCP server: <code>https://agentdataco.com/mcp</code>.</p><a class="btn" href="/#pricing">See plans — from $19/month</a> <a href="/api/v1/sample">Free sample</a> · <a href="/docs">Docs</a></div></section></main>` + FOOT;
  return send(200, html, 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');
};
