const { readJSON } = require('../lib/store');
const HEAD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<title>AI ecosystem trends today: top movers in AI agents, MCP, Hugging Face, Show HN — Agent Data Co</title><meta name="description" content="Structured, schedulable data feeds on the AI ecosystem: trending AI agent & MCP repos, Show HN AI launches, the MCP server registry, AI pricing changes and AI app reviews."><link rel="canonical" href="https://agentdataco.com/trends">\n<meta property="og:type" content="website"><meta property="og:site_name" content="Agent Data Co"><meta property="og:title" content="Agent Data Co — AI ecosystem data feeds for agents & analysts"><meta property="og:description" content="Structured, schedulable data feeds on the AI ecosystem: trending AI agent & MCP repos, Show HN AI launches, the MCP server registry, AI pricing changes and AI app reviews."><meta property="og:url" content="https://agentdataco.com/"><meta property="og:image" content="https://agentdataco.com/og.svg">\n<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Agent Data Co — AI ecosystem data feeds for agents & analysts"><meta name="twitter:description" content="Structured, schedulable data feeds on the AI ecosystem: trending AI agent & MCP repos, Show HN AI launches, the MCP server registry, AI pricing changes and AI app reviews.">\n<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/style.css"></head><body>\n<header><a class="logo" href="/">◆ Agent Data Co</a><nav><a href="/#feeds">Feeds</a><a href="/#api">API</a><a href="/docs">Docs</a><a href="/#newsletter">Newsletter</a><a href="mailto:hello@agentdataco.com">Contact</a></nav></header>';
const FOOT = '<footer><p>Agent Data Co is a trading name of Transcend UK Holdings Ltd, registered in England &amp; Wales no. 15851774 · VAT GB499804133 · Office 101, 1 Eastman Road, Harrow, HA1 4WL, United Kingdom.</p><p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/llms.txt">llms.txt</a> · <a href="mailto:hello@agentdataco.com">hello@agentdataco.com</a></p></footer></body></html>';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const LINK = { 'github-ai-repos': (id) => `https://github.com/${id}`, 'show-hn-ai': (id) => `https://news.ycombinator.com/item?id=${id}`, 'hf-trending': (id) => { const [t, ...r] = id.split(':'); const x = r.join(':'); return `https://huggingface.co/${t === 'model' ? '' : t + 's/'}${x}`; } };
const TITLES = { 'github-ai-repos': ['GitHub AI agent & MCP repos — most stars gained', 'stars'], 'hf-trending': ['Hugging Face — most likes gained', 'likes'], 'show-hn-ai': ['Show HN AI launches — most points gained', 'points'] };
module.exports = async (req, res) => {
  if (req.query.view === 'demand' || req.query.view === 'leaderboard') return view(req, res);
  const t = await readJSON('trends/latest.json');
  let body = '<main><section><h1>AI ecosystem trends</h1>';
  if (!t) body += '<p>Trends are generated daily from our archive. Check back tomorrow.</p>';
  else {
    body += `<p class="lead">Top movers across AI agents, MCP servers, Hugging Face and Show HN, computed from Agent Data Co's daily snapshot archive. Updated ${esc(t.date)}. Get the full data via the <a href="/docs">API</a> (<code>/api/v1/trends</code>, per-entity <code>/history</code>).</p>`;
    for (const [feed, [title, unit]] of Object.entries(TITLES)) {
      const f = t.feeds[feed]; if (!f) continue;
      const win = ['7d', '30d', '1d'].find((w) => (f[`movers_${w}`] || []).length);
      body += `<h2>${esc(title)}${win ? ` (${win === '1d' ? 'last day' : 'last ' + win})` : ''}</h2>`;
      if (!win) { body += '<p class="small">Not enough history yet; movers appear after the second daily snapshot.</p>'; continue; }
      body += `<table><thead><tr><th>#</th><th>Entity</th><th>+${unit}</th><th>Total</th></tr></thead><tbody>` + f[`movers_${win}`].slice(0, 10).map((m, i) => `<tr><td>${i + 1}</td><td><a href="${esc(LINK[feed](m.id))}" rel="noopener nofollow">${esc(m.id.replace(/^\w+:/, ''))}</a></td><td>+${m.delta}</td><td>${m[unit] ?? ''}</td></tr>`).join('') + '</tbody></table>';
    }
    const ev = [...(t.feeds['llm-pricing']?.events || []).filter((e) => e.type === 'price_change' || e.type === 'new_entity'), ...(t.feeds['mcp-servers']?.events || []).filter((e) => e.type === 'new_entity').slice(0, 10)];
    const pr = (t.feeds['ai-pricing']?.events || []).filter((e) => e.type === 'pricing_page_change');
    body += '<h2>Latest changes</h2>';
    body += ev.length || pr.length ? '<ul>' + [...pr.map((e) => `<li>Pricing page changed: ${esc(e.id)}</li>`), ...ev.slice(0, 25).map((e) => `<li>${e.type === 'price_change' ? `LLM price change: <code>${esc(e.id)}</code> $${e.before.promptUsdPer1M}→$${e.after.promptUsdPer1M} in / $${e.before.completionUsdPer1M}→$${e.after.completionUsdPer1M} out per 1M tokens` : `New: <code>${esc(e.id)}</code>`}</li>`)].join('') + '</ul>' : '<p class="small">No changes detected since the previous snapshot.</p>';
  }
  body += '</section></main>';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(HEAD + body + FOOT);
};

// /demand (Agent Demand Index) and /leaderboard (ADC Momentum) share this function (Hobby plan: no new functions).
const demand = require('../lib/demand');
const { momentumMap, CFG } = require('../lib/pages');
const { METHOD } = require('../lib/momentum');
const H = require('../lib/html');
const NAMES = { 'github-ai-repos': 'GitHub AI repos', 'mcp-servers': 'MCP servers', 'llm-pricing': 'LLM models', 'hf-trending': 'Hugging Face', 'ai-pricing': 'AI pricing pages', 'show-hn-ai': 'Show HN AI' };
async function view(req, res) {
  let html;
  if (req.query.view === 'demand') {
    const w = await demand.week();
    const rows = w.mostLookedUp.map((x, i) => `<tr><td>${i + 1}</td><td><a href="${esc(new URL(x.page).pathname)}">${esc(x.name)}</a></td><td>${esc(NAMES[x.feed] || x.feed)}</td><td>${x.lookups}</td><td>${x.momentum ?? ''}</td></tr>`).join('');
    html = H.head({ title: 'Agent Demand Index: what AI agents look up most this week | Agent Data Co', desc: 'The AI repos, MCP servers, models and tools that AI agents queried most via the Agent Data Co API and MCP server in the last 7 days. Anonymised, aggregated, updated continuously.', canonical: 'https://agentdataco.com/demand' })
      + `<main><section><h1>Agent Demand Index</h1><p class="lead">Most looked-up by AI agents this week: which AI-ecosystem entities agents and apps query through our <a href="/docs">REST API</a> and <a href="/docs#mcp">MCP server</a>. A usage signal that exists only here and grows with every query.</p>
<p class="small">Window ${esc(w.window)} · ${w.totalLookups} lookups (API ${w.channels.api || 0}, MCP ${w.channels.mcp || 0}). Anonymised and aggregated: we store counts only, never keys, IPs or users. Only tracked entities are listed. JSON: <a href="/api/v1/demand">/api/v1/demand</a></p>
${rows ? `<table><thead><tr><th>#</th><th>Entity</th><th>Category</th><th>Lookups (7d)</th><th>ADC Momentum</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>Collecting: the index started on 2026-10-14 and fills in as agents query the API and MCP server. Check back soon.</p>'}
${w.feeds.length ? `<h2>Most queried feeds</h2><table><tbody>${w.feeds.map((f) => `<tr><td>${esc(NAMES[f.feed] || f.feed)}</td><td>${f.lookups}</td></tr>`).join('')}</tbody></table>` : ''}
<p><a href="/leaderboard">ADC Momentum leaderboard</a> · <a href="/trends">Trends</a></p></section></main>` + H.FOOT;
  } else {
    let body = '';
    for (const f of ['github-ai-repos', 'mcp-servers', 'llm-pricing', 'hf-trending']) {
      const top = Object.entries(await momentumMap(f)).sort((a, b) => b[1].score - a[1].score).slice(0, 25);
      body += `<h2>${esc(NAMES[f])}</h2>` + (top.length ? `<table><thead><tr><th>#</th><th>Entity</th><th>Momentum</th><th>Change</th></tr></thead><tbody>${top.map(([id, m], i) => `<tr><td>${i + 1}</td><td><a href="${esc(new URL(m.page).pathname)}">${esc(id.replace(/^\w+:/, ''))}</a></td><td>${m.score}</td><td>${m.change == null ? '' : (m.change > 0 ? '+' : '') + m.change}</td></tr>`).join('')}</tbody></table>` : '<p class="small">Scores appear after the next daily refresh.</p>');
    }
    html = H.head({ title: 'ADC Momentum leaderboard: fastest-rising AI repos, MCP servers, models | Agent Data Co', desc: 'ADC Momentum: a 0-100 score per AI repo, MCP server, LLM and Hugging Face item from growth velocity, consistency, recency and agent demand in our daily archive.', canonical: 'https://agentdataco.com/leaderboard' })
      + `<main><section><h1>ADC Momentum leaderboard</h1><p class="lead">One 0-100 score per entity, recomputed daily from Agent Data Co's append-only archive. Every entity page has an embeddable badge.</p>${body}
<h2 id="method">Method</h2><p>${esc(METHOD)}</p><p class="small">JSON: <a href="/api/v1/momentum">/api/v1/momentum</a> (<code>?category=github-ai-repos&amp;limit=100</code>) · MCP tool <code>get_momentum_leaderboard</code> · Badge: <code>https://agentdataco.com/badge/&lt;entity page path&gt;.svg</code></p><p><a href="/demand">Agent Demand Index</a> · <a href="/trends">Trends</a></p></section></main>` + H.FOOT;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}
