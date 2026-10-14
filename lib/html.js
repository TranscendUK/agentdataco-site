const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const head = ({ title, desc, canonical, jsonld }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Agent Data Co"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="https://agentdataco.com/og.svg"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/style.css">${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}</head><body>
<header><a class="logo" href="/">◆ Agent Data Co</a><nav><a href="/#feeds">Feeds</a><a href="/#pricing">Pricing</a><a href="/docs">Docs</a><a href="/trends">Trends</a><a href="mailto:hello@agentdataco.com">Contact</a></nav></header>`;
const FOOT = '<footer><p>Agent Data Co is a trading name of Transcend UK Holdings Ltd, registered in England &amp; Wales no. 15851774 · VAT GB499804133 · Office 101, 1 Eastman Road, Harrow, HA1 4WL, United Kingdom.</p><p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/llms.txt">llms.txt</a> · <a href="mailto:hello@agentdataco.com">hello@agentdataco.com</a></p></footer></body></html>';
// numeric series -> inline SVG line chart
function chart(series, unit) {
  const pts = series.filter((p) => typeof p[1] === 'number');
  if (pts.length < 2) return `<p class="small">History chart: ${pts.length} daily snapshot${pts.length === 1 ? '' : 's'} so far (archive started 2026-10-14). The line fills in as the daily archive grows; full series via the API.</p>`;
  const W = 640, H = 180, P = 28; const vs = pts.map((p) => p[1]); const min = Math.min(...vs), max = Math.max(...vs); const span = max - min || 1;
  const xy = pts.map((p, i) => [P + (i * (W - 2 * P)) / (pts.length - 1), H - P - ((p[1] - min) / span) * (H - 2 * P)]);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(unit)} history" style="max-width:${W}px;background:#f8f9fb;border-radius:8px"><polyline fill="none" stroke="#4f6bed" stroke-width="2.5" points="${xy.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}"/><text x="${P}" y="16" font-size="11" fill="#666">${esc(unit)}: ${min} – ${max}</text><text x="${P}" y="${H - 8}" font-size="11" fill="#666">${esc(pts[0][0])}</text><text x="${W - P}" y="${H - 8}" font-size="11" fill="#666" text-anchor="end">${esc(pts[pts.length - 1][0])}</text></svg>`;
}
module.exports = { esc, head, FOOT, chart };
