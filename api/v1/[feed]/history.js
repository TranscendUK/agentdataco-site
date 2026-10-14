const { FEEDS, authorize, send } = require('../../../lib/api');
const { history, day, shift } = require('../../../lib/archive');
const watchlist = require('../../../lib/watchlist');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
module.exports = async (req, res) => {
  const name = req.query.feed;
  if (!FEEDS[name]) return send(res, 404, { error: 'Unknown feed', feeds: Object.keys(FEEDS) });
  const a = await authorize(req, res); if (!a) return;
  const entity = req.query.entity;
  if (!entity) return send(res, 400, { error: 'Missing `entity` (e.g. owner/repo, OpenRouter model id, MCP server name, pricing page URL, model:<hf id>).' }, a.rl);
  const to = req.query.to || day(); let from = req.query.from || shift(to, 29);
  if (!ISO.test(from) || !ISO.test(to) || from > to) return send(res, 400, { error: '`from`/`to` must be YYYY-MM-DD with from <= to' }, a.rl);
  const earliest = shift(day(), a.limits.historyDays - 1); let clipped = false;
  if (from < earliest) { from = earliest; clipped = true; }
  if (Date.parse(to) - Date.parse(from) > 366 * 864e5) return send(res, 400, { error: 'Max 366 days per request; paginate with from/to.' }, a.rl);
  const rows = await history(name, entity, from, to);
  let queued = false;
  if (!rows.length && watchlist.valid[name]) queued = await watchlist.request(name, entity, a.h).catch(() => false);
  return send(res, 200, { feed: name, entity, from, to, plan: a.tier, historyDays: a.limits.historyDays, clippedToPlan: clipped, count: rows.length, data: rows, ...(queued ? { watchlist: 'Entity not tracked yet; queued for daily collection.' } : {}) }, a.rl);
};
