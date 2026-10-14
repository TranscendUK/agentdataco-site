// Coverage growth loop: entities requested via the API that we don't track yet get queued for the daily job.
const { readJSON, writeJSON } = require('./store');
const MAX = 300;
const valid = {
  'ai-pricing': (v) => { try { const u = new URL(v); return u.protocol === 'https:' && !/^(localhost|[\d.]+|\[)/.test(u.hostname) && v.length < 300 ? u.href : null; } catch { return null; } },
  'github-ai-repos': (v) => (/^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(v) ? v : null),
};
const seen = new Set();
async function request(feed, value, by) {
  const v = valid[feed] && valid[feed](String(value || '').trim());
  if (!v || seen.has(feed + v)) return false;
  seen.add(feed + v);
  const path = `watchlist/${feed}.json`;
  const w = (await readJSON(path)) || { items: [] };
  if (w.items.some((i) => i.value === v) || w.items.length >= MAX) return false;
  w.items.push({ value: v, requestedAt: new Date().toISOString(), by: by ? by.slice(0, 12) : 'anon' });
  await writeJSON(path, w); return true;
}
// WATCH_IGNORE_BY: comma-separated requester key-hash prefixes whose requests are ignored (e.g. test keys).
const ignored = () => (process.env.WATCH_IGNORE_BY || '').split(',').filter(Boolean);
const list = async (feed) => ((await readJSON(`watchlist/${feed}.json`)) || { items: [] }).items.filter((i) => !ignored().includes(i.by)).map((i) => i.value);
module.exports = { request, list, valid };
