// ADC Momentum Score (0-100) per entity, computed daily from our own archive (pages/<feed>.json series) plus the Agent Demand Index.
// Public method (high level): growth velocity (relative to the rest of the feed), consistency of growth, recency of activity,
// and agent demand. Inputs are percentile-ranked within each feed so the score is comparable inside a category.
const DAY = 864e5;
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const ageDays = (iso, now) => { const t = Date.parse(iso || ''); return isNaN(t) ? null : Math.max(0, (now - t) / DAY); };
const recencyScore = (days, half = 30) => (days == null ? 0 : Math.pow(0.5, days / half)); // 1 = today, 0.5 = `half` days ago
function pct(values) { // value -> percentile in [0,1]
  const s = values.filter((v) => v != null).sort((a, b) => a - b); const n = s.length;
  return (v) => { if (v == null || !n) return 0; let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } let hi2 = lo; while (hi2 < n && s[hi2] === v) hi2++; return n === 1 ? 1 : ((lo + hi2 - 1) / 2) / (n - 1); };
}
// growth of a numeric series: per-day delta over the last 7 archived days, and share of positive days in the last 30
function growth(series) {
  const pts = (series || []).filter((p) => num(p[1]) != null);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1]; const base = pts.find((p) => Date.parse(last[0]) - Date.parse(p[0]) <= 7 * DAY) || pts[0];
  const days = Math.max(1, (Date.parse(last[0]) - Date.parse(base[0])) / DAY);
  const recent = pts.slice(-31); let up = 0; for (let i = 1; i < recent.length; i++) if (recent[i][1] > recent[i - 1][1]) up++;
  return { perDay: (last[1] - base[1]) / days, rel: (last[1] - base[1]) / days / Math.max(1, base[1]), consistency: up / Math.max(1, recent.length - 1), points: pts.length };
}
const W = { velocity: 0.45, consistency: 0.2, recency: 0.2, demand: 0.15 };
// entities: {id: {series, latest, info}} for one feed; demand: {id: lookups this week}
function compute(feed, entities, demand = {}, now = Date.now()) {
  const ids = Object.keys(entities); const raw = {};
  for (const id of ids) {
    const e = entities[id]; const L = e.latest || {}; const I = e.info || {};
    let vel = null, cons = null, rec = null, basis = 'archive';
    if (feed === 'github-ai-repos' || feed === 'hf-trending') {
      const g = growth(e.series); const total = num(feed === 'hf-trending' ? L.likes : L.stars) || 0;
      const born = ageDays(feed === 'hf-trending' ? I.createdAt : I.created_at, now);
      if (g) { vel = g.perDay + 50 * g.rel; cons = g.consistency; }
      else { basis = 'bootstrap'; vel = born != null ? total / Math.max(7, born) : total / 365; cons = null; } // until the archive has 2+ days: lifetime rate
      rec = feed === 'github-ai-repos' ? recencyScore(ageDays(L.pushed_at, now), 14) : recencyScore(born, 60);
    } else if (feed === 'mcp-servers') {
      const vers = new Set((e.series || []).map((p) => p[1]).filter(Boolean)); // version changes seen in our archive
      vel = vers.size - 1; cons = Math.min(1, (vers.size - 1) / 4); basis = (e.series || []).length > 1 ? 'archive' : 'bootstrap';
      rec = recencyScore(ageDays(L.updatedAt || I.publishedAt, now), 30); if (I.remotes?.length) rec = Math.min(1, rec + 0.15);
    } else if (feed === 'llm-pricing') {
      const ps = (e.series || []).map((p) => num(p[1])).filter((v) => v != null);
      const cut = ps.length > 1 && ps[0] > 0 ? (ps[0] - ps[ps.length - 1]) / ps[0] : 0; // price cuts count as momentum
      vel = cut + (num(I.contextLength) || 0) / 2e6 + (I.supportsTools ? 0.1 : 0); cons = null; basis = ps.length > 1 ? 'archive' : 'bootstrap';
      rec = recencyScore(I.created ? (now - (I.created > 1e12 ? I.created : I.created * 1000)) / DAY : null, 90);
    } else return {};
    raw[id] = { vel, cons, rec, dem: demand[id] || 0, basis };
  }
  const pv = pct(ids.map((i) => raw[i].vel)); const pd = pct(ids.map((i) => raw[i].dem));
  const out = {};
  for (const id of ids) {
    const r = raw[id]; const v = pv(r.vel); const c = r.cons == null ? v * 0.8 : r.cons; const d = r.dem ? pd(r.dem) : 0;
    const score = Math.round(100 * (W.velocity * v + W.consistency * c + W.recency * (r.rec || 0) + W.demand * d));
    out[id] = { score: Math.max(0, Math.min(100, score)), velocity: Math.round(v * 100), consistency: Math.round(c * 100), recency: Math.round((r.rec || 0) * 100), demand: Math.round(d * 100), basis: r.basis };
  }
  return out;
}
const METHOD = 'ADC Momentum (0-100) = 45% growth velocity (stars/likes gained per day in our daily archive, relative and absolute, percentile-ranked within the category) + 20% consistency (share of recent days with growth) + 20% recency (latest push/update/release, decaying) + 15% agent demand (how often AI agents looked it up via our API/MCP this week). MCP servers use release cadence; LLMs use price cuts, context and recency. Recomputed daily; scores marked "bootstrap" use lifetime rates until the archive has enough days.';
module.exports = { compute, METHOD, W };
