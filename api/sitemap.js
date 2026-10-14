const { readJSON } = require('../lib/store');
const { CFG } = require('../lib/pages');
const STATIC = ['/', '/docs', '/trends', '/llms.txt', '/privacy', '/terms'];
module.exports = async (req, res) => {
  const docs = await Promise.all(Object.keys(CFG).map((f) => readJSON(`pages/${f}.json`).catch(() => null)));
  const urls = STATIC.map((p) => `<url><loc>https://agentdataco.com${p}</loc><changefreq>daily</changefreq></url>`);
  for (const d of docs) if (d) for (const e of Object.values(d.entities)) urls.push(`<url><loc>https://agentdataco.com${e.path.replace(/&/g, '&amp;')}</loc><lastmod>${d.date}</lastmod><changefreq>daily</changefreq></url>`);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
};
