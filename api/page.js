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
function badgeSvg(score) {
  const l = score == null ? 'Momentum n/a' : `Momentum ${score}`; const r = 'Agent Data Co';
  const color = score == null ? '#9f9f9f' : score >= 80 ? '#2ea44f' : score >= 60 ? '#4f6bed' : score >= 40 ? '#dfb317' : '#e05d44';
  const wl = Math.round(l.length * 6.6 + 14), wr = Math.round(r.length * 6.6 + 14), w = wl + wr;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${l} | ${r}"><title>${l} | ${r}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${wl}" height="20" fill="${color}"/><rect x="${wl}" width="${wr}" height="20" fill="#0b1020"/><rect width="${w}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${wl / 2}" y="14">${l}</text><text x="${wl + wr / 2}" y="14">${r}</text></g></svg>`;
}
const KINDS = ['repo', 'mcp', 'llm', 'pricing', 'hf'];
async function badge(req, res) {
  const orig = String(req.headers['x-original-path'] || req.headers['x-vercel-original-path'] || req.url || '');
  let m = /^\/badge\/(repo|mcp|llm|pricing|hf)\/([^?#]+?)(?:\.svg)?(?:[?#].*)?$/.exec(orig);
  if (!m) { const p = [].concat(req.query.p || []).join('/').replace(/\.svg$/, ''); const i = p.indexOf('/'); m = [null, p.slice(0, i), p.slice(i + 1)]; }
  let score = null;
  if (KINDS.includes(m[1]) && m[2]) { try { const { byPath } = await index(KIND[m[1]]); score = byPath.get(decodeURIComponent(`/${m[1]}/${m[2]}`).toLowerCase())?.momentum?.score ?? null; } catch {} }
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8'); res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=43200, stale-while-revalidate=86400');
  return res.status(200).send(badgeSvg(score));
}
module.exports = async (req, res) => {
  if (req.query.badge) return badge(req, res);
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
${momentumBlock(e, kind)}
<h2>Details</h2><table>${infoRows}</table>
<div class="panel"><h2>Get this data via API or MCP</h2><p>Full daily history, trends and change events for ${esc(e.name)} and ${'thousands'} of other AI-ecosystem entities.</p>
<pre><code>curl -H "Authorization: Bearer $ADC_KEY" \\\n  "https://agentdataco.com/api/v1/${feed}/history?entity=${esc(histEntity)}"\ncurl -H "Authorization: Bearer $ADC_KEY" \\\n  "https://agentdataco.com/api/v1/${feed}${esc(q)}"</code></pre>
<p>Or connect your agent to our remote MCP server: <code>https://agentdataco.com/mcp</code>.</p><a class="btn" href="/#pricing">See plans — from $19/month</a> <a href="/api/v1/sample">Free sample</a> · <a href="/docs">Docs</a></div>
${claimBlock(e)}</section></main>` + FOOT;
  return send(200, html, 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');
};

const { METHOD } = require('../lib/momentum');
function momentumBlock(e, kind) {
  const m = e.momentum; if (!m) return '';
  const url = `https://agentdataco.com${e.path}`; const img = `https://agentdataco.com/badge${e.path}.svg`;
  const md = `[![ADC Momentum](${img})](${url})`; const html = `<a href="${url}"><img src="${img}" alt="ADC Momentum"></a>`;
  return `<h2>ADC Momentum: ${m.score}/100${m.change ? ` <span class="small">(${m.change > 0 ? '+' : ''}${m.change} since previous day)</span>` : ''}</h2>
<p><img src="/badge${esc(e.path)}.svg" alt="ADC Momentum ${m.score}" height="20"> <a class="small" href="/leaderboard">Leaderboard</a></p>
<table><tr><th>Growth velocity</th><td>${m.velocity}</td></tr><tr><th>Consistency</th><td>${m.consistency}</td></tr><tr><th>Recency</th><td>${m.recency}</td></tr><tr><th>Agent demand</th><td>${m.demand}</td></tr><tr><th>Basis</th><td>${esc(m.basis)}</td></tr></table>
<p class="small">${esc(METHOD)} <a href="/leaderboard#method">Method</a></p>
<h3>Embed this badge</h3><p class="small">Maintainers: add the live badge to your README (updates daily).</p>
<pre><code>${esc(md)}</code></pre><pre><code>${esc(html)}</code></pre>`;
}
function claimBlock(e) {
  return `<div class="panel" id="claim" style="margin-top:24px"><h2>Maintainer? Claim this listing</h2><p class="small">Owners and vendors can submit a description, pricing and corrections. We email you a verification link; verified submissions are reviewed daily (a work email on the project's domain is fastest).</p>
<form id="cl" style="flex-direction:column;align-items:stretch"><input type="email" name="email" required placeholder="you@yourcompany.com" aria-label="Email"><input type="text" name="role" maxlength="120" placeholder="Your role (e.g. maintainer, founder)" aria-label="Role" style="padding:11px;border-radius:8px;border:1px solid #2d375f;background:#0f1530;color:#fff"><textarea name="description" maxlength="1000" rows="3" placeholder="Short description" style="padding:11px;border-radius:8px;border:1px solid #2d375f;background:#0f1530;color:#fff"></textarea><textarea name="pricing" maxlength="1000" rows="2" placeholder="Pricing (plans, prices, link)" style="padding:11px;border-radius:8px;border:1px solid #2d375f;background:#0f1530;color:#fff"></textarea><textarea name="corrections" maxlength="2000" rows="2" placeholder="Corrections to the data above" style="padding:11px;border-radius:8px;border:1px solid #2d375f;background:#0f1530;color:#fff"></textarea><input type="text" name="website" class="hp" tabindex="-1" autocomplete="off"><button class="btn" type="submit">Send verification email</button></form><p id="clmsg" role="status"></p></div>
<script>document.getElementById('cl').onsubmit=async ev=>{ev.preventDefault();const f=ev.target,m=document.getElementById('clmsg');m.textContent='Sending…';try{const r=await fetch('/api/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'claim',entity:${JSON.stringify(e.path).replace(/</g, '\\u003c')},email:f.email.value,role:f.role.value,description:f.description.value,pricing:f.pricing.value,corrections:f.corrections.value,website:f.website.value})});const j=await r.json();m.textContent=r.ok?'Check your inbox and click the verification link to submit your claim.':(j.error||'Something went wrong.');if(r.ok)f.reset()}catch{m.textContent='Network error, please try again.'}}</script>`;
}
