const { authorize, send } = require('../../lib/api');
const { readJSON } = require('../../lib/store');
const { day } = require('../../lib/archive');
module.exports = async (req, res) => {
  const a = await authorize(req, res); if (!a) return;
  const d = req.query.date;
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return send(res, 400, { error: '`date` must be YYYY-MM-DD' }, a.rl);
  const t = await readJSON(d ? `trends/${d}.json` : 'trends/latest.json');
  if (!t) return send(res, 404, { error: 'No trends for that date.' }, a.rl);
  const win = req.query.window; // 1d|7d|30d
  const feeds = req.query.feed ? { [req.query.feed]: t.feeds[req.query.feed] } : t.feeds;
  if (win) for (const k of Object.keys(feeds)) if (feeds[k]) feeds[k] = { feed: k, date: feeds[k].date, events: feeds[k].events, [`movers_${win}`]: feeds[k][`movers_${win}`], [`baseline_${win}`]: feeds[k][`baseline_${win}`] };
  return send(res, 200, { generatedAt: t.generatedAt, date: t.date, plan: a.tier, feeds }, a.rl);
};
