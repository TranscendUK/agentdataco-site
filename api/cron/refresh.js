const { FEEDS } = require('../../lib/feeds');
const { readJSON, writeJSON } = require('../../lib/store');
const { archive, buildTrends } = require('../../lib/archive');
const watchlist = require('../../lib/watchlist');
const { updatePages } = require('../../lib/pages');
const INDEXNOW_KEY = '9f3c2a7e5b1d4c8a6e0f2b4d7a9c1e3f';
module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'unauthorized' });
  const only = req.query.feed ? [req.query.feed] : Object.keys(FEEDS);
  const results = await Promise.all(only.map(async (name) => {
    const t = Date.now();
    try {
      const prev = ['llm-pricing', 'ai-pricing'].includes(name) ? (await readJSON(`feeds/${name}.json`))?.rows : null;
      const watch = watchlist.valid[name] ? await watchlist.list(name) : [];
      const rows = await FEEDS[name].fetch(prev, watch);
      if (!rows.length) throw new Error('zero rows; keeping previous data');
      await writeJSON(`feeds/${name}.json`, { feed: name, updatedAt: new Date().toISOString(), rows });
      const trend = await archive(name, rows);
      let pages = null; try { pages = await updatePages(name, rows, trend.date); } catch (e) { console.error('pages failed', name, e.message); }
      return { name, ok: true, rows: rows.length, pages, watched: watch.length, events: trend.events.length, ms: Date.now() - t, trend };
    } catch (e) { console.error('refresh failed', name, e.message); return { name, ok: false, error: e.message, ms: Date.now() - t }; }
  }));
  if (!req.query.feed) {
    const old = (await readJSON('trends/latest.json'))?.feeds || {};
    await buildTrends(Object.keys(FEEDS).map((n) => results.find((r) => r.name === n && r.ok)?.trend || old[n]));
  }
  // IndexNow (Bing, Yandex, Seznam, Naver...): ping the sitemap's URLs daily so new/changed entity pages get recrawled.
  let indexnow = null;
  if (!req.query.feed && !req.query.noping) {
    try {
      const sm = await (await fetch('https://agentdataco.com/sitemap.xml', { signal: AbortSignal.timeout(20000) })).text();
      const urlList = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&')).slice(0, 10000);
      const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host: 'agentdataco.com', key: INDEXNOW_KEY, keyLocation: `https://agentdataco.com/${INDEXNOW_KEY}.txt`, urlList }) });
      indexnow = { status: r.status, urls: urlList.length };
    } catch (e) { indexnow = { error: e.message }; }
  }
  res.status(results.every((r) => r.ok) ? 200 : 207).json({ results: results.map(({ trend, ...r }) => r), indexnow });
};
module.exports.config = { maxDuration: 300 };
