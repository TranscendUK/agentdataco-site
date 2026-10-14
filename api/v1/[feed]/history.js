const { FEEDS, authorize, send } = require('../../../lib/api');
const { history, day, shift } = require('../../../lib/archive');
const watchlist = require('../../../lib/watchlist');
const guard = require('../../../lib/guard');
const wm = require('../../../lib/wm');
const demand = require('../../../lib/demand');
const { momentumMap } = require('../../../lib/pages');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WINDOW = 90; const MAX_PAGE = 90; const DEF_PAGE = 31;
module.exports = async (req, res) => {
  const name = req.query.feed;
  if (!FEEDS[name]) return send(res, 404, { error: 'Unknown feed', feeds: Object.keys(FEEDS) });
  const a = await authorize(req, res); if (!a) return;
  const entity = String(req.query.entity || '').trim();
  if (!entity || /^[*%]+$|^(all|\*)$/i.test(entity)) return send(res, 400, { error: 'Missing `entity`: history is per entity (e.g. owner/repo, OpenRouter model id, MCP server name, pricing page URL, model:<hf id>). Bulk/whole-feed history is not available via the API; for a data licence contact hello@agentdataco.com.' }, a.rl);
  const to = req.query.to || day(); let from = req.query.from || shift(to, DEF_PAGE - 1);
  if (req.query.cursor) { if (!ISO.test(req.query.cursor)) return send(res, 400, { error: 'Invalid `cursor`' }, a.rl); from = req.query.cursor; }
  if (!ISO.test(from) || !ISO.test(to) || from > to) return send(res, 400, { error: '`from`/`to` must be YYYY-MM-DD with from <= to' }, a.rl);
  if ((Date.parse(to) - Date.parse(from)) / 864e5 + 1 > MAX_WINDOW) return send(res, 400, { error: `Max ${MAX_WINDOW}-day window per request (from..to). Page through longer ranges with successive requests.` }, a.rl);
  const limit = Math.min(MAX_PAGE, Math.max(1, parseInt(req.query.limit, 10) || DEF_PAGE));
  const earliest = shift(day(), a.limits.historyDays - 1); let clipped = false;
  if (from < earliest) { from = earliest; clipped = true; }
  if (from > to) return send(res, 200, { feed: name, entity, from, to, plan: a.tier, clippedToPlan: true, count: 0, data: [] }, a.rl);
  const g = await guard.check(a, `h|${name}|${entity}`); if (g) return send(res, g.status, g.body, { ...a.rl, ...g.headers });
  const all = await history(name, entity, from, to);
  await demand.log(req.headers['x-adc-channel'] === 'mcp' ? 'mcp' : 'api', name, all.length ? entity : null);
  const mom = (await momentumMap(name).catch(() => ({})))[entity] || null;
  const page = all.slice(0, limit).map((r) => wm.row(a.h, name, entity, r));
  const next = all.length > limit ? all[limit].date : null;
  let queued = false;
  if (!all.length && !a.rec.test && watchlist.valid[name]) queued = await watchlist.request(name, entity, a.h).catch(() => false);
  return send(res, 200, { feed: name, entity, from, to, plan: a.tier, historyDays: a.limits.historyDays, clippedToPlan: clipped, limit, count: page.length, nextCursor: next, adcMomentum: mom, data: page, ...(queued ? { watchlist: 'Entity not tracked yet; queued for daily collection.' } : {}) }, a.rl);
};
