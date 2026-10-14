const { authorize, send, FEEDS } = require('../../lib/api');
const { readJSON } = require('../../lib/store');
const { day, shift } = require('../../lib/archive');
const guard = require('../../lib/guard');
const wm = require('../../lib/wm');
module.exports = async (req, res) => {
  const a = await authorize(req, res); if (!a) return;
  const d = req.query.date; const f = req.query.feed;
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return send(res, 400, { error: '`date` must be YYYY-MM-DD' }, a.rl);
  if (f && !FEEDS[f]) return send(res, 400, { error: 'Unknown feed', feeds: Object.keys(FEEDS) }, a.rl);
  if (d && !f) return send(res, 400, { error: 'Past-date trends need a `feed` filter (one feed per request).' }, a.rl);
  if (d && d < shift(day(), a.limits.historyDays - 1)) return send(res, 403, { error: `Trends for ${d} are outside your plan's ${a.limits.historyDays}-day history.` }, a.rl);
  const g = await guard.check(a, `t|${d || 'latest'}|${f || '*'}`); if (g) return send(res, g.status, g.body, { ...a.rl, ...g.headers });
  const t = await readJSON(d ? `trends/${d}.json` : 'trends/latest.json');
  if (!t) return send(res, 404, { error: 'No trends for that date.' }, a.rl);
  const win = req.query.window; // 1d|7d|30d
  const feeds = f ? { [f]: t.feeds[f] } : t.feeds;
  if (win) for (const k of Object.keys(feeds)) if (feeds[k]) feeds[k] = { feed: k, date: feeds[k].date, events: feeds[k].events, [`movers_${win}`]: feeds[k][`movers_${win}`], [`baseline_${win}`]: feeds[k][`baseline_${win}`] };
  return send(res, 200, { generatedAt: t.generatedAt, date: t.date, plan: a.tier, feeds: wm.trends(a.h, feeds) }, a.rl);
};
