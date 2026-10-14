import * as cheerio from 'cheerio';
import crypto from 'crypto';

const UNIT = '(?:month|mo|year|yr|user|seat|member)s?';
const PRICE_RE = new RegExp(`(?:US\\$|\\$|£|€)\\s?\\d{1,5}(?:[.,]\\d{1,2})?(?:\\s?(?:/|per)\\s?${UNIT}(?:\\s?(?:/|per)\\s?${UNIT})?)?`, 'gi');

export function extract(html, url) {
  const $ = cheerio.load(html);
  $('script:not([type="application/ld+json"]),style,noscript,svg').remove();
  // JSON-LD offers if present
  const ld = [];
  $('script[type="application/ld+json"]').each((_, el) => { try { ld.push(JSON.parse($(el).text())); } catch {} });
  const ldOffers = [];
  const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk);
    if ((o['@type'] === 'Offer' || o.price != null) && o.price != null) ldOffers.push({ name: o.name || null, price: String(o.price), currency: o.priceCurrency || null });
    Object.values(o).forEach(walk); };
  ld.forEach(walk);
  // Heuristic plan cards: elements containing a heading + a price
  const plans = [];
  const seen = new Set();
  $('h1,h2,h3,h4,h5,[class*="plan" i] [class*="name" i],[class*="tier" i] [class*="name" i]').each((_, h) => {
    const name = $(h).text().replace(/\s+/g, ' ').trim();
    if (!name || name.length > 40 || /pricing|plans|compare|faq/i.test(name)) return;
    // climb up to 4 ancestors to find a container with a price
    let node = $(h).parent();
    for (let d = 0; d < 4 && node.length; d++) {
      const txt = node.text().replace(/\s+/g, ' ');
      const m = txt.match(PRICE_RE);
      const free = /\bfree\b/i.test(txt.slice(0, 300));
      if ((m && txt.length < 2500 && new Set(m).size <= 4) || (free && txt.length < 800)) {
        const key = name.toLowerCase();
        if (!seen.has(key)) { seen.add(key); plans.push({ name, prices: m ? [...new Set(m.map(norm))].slice(0, 4) : ['Free'] }); }
        return;
      }
      node = node.parent();
    }
  });
  const body = $('body').text().replace(/\s+/g, ' ');
  const prices = [...new Set((body.match(PRICE_RE) || []).map(norm))].slice(0, 50);
  const title = $('title').text().trim();
  const hash = crypto.createHash('sha256').update(JSON.stringify({ plans, prices, ldOffers })).digest('hex').slice(0, 16);
  return { url, title, plans, prices, ldOffers, textLength: body.length, contentHash: hash };
}
const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/^us\$/, '$');

export function diff(prev, cur) {
  if (!prev) return { firstSnapshot: true };
  const pmap = new Map(prev.plans.map((p) => [p.name.toLowerCase(), p]));
  const cmap = new Map(cur.plans.map((p) => [p.name.toLowerCase(), p]));
  const added = cur.plans.filter((p) => !pmap.has(p.name.toLowerCase())).map((p) => p.name);
  const removed = prev.plans.filter((p) => !cmap.has(p.name.toLowerCase())).map((p) => p.name);
  const priceChanged = [];
  for (const [k, p] of cmap) { const o = pmap.get(k); if (o && JSON.stringify(o.prices) !== JSON.stringify(p.prices)) priceChanged.push({ plan: p.name, before: o.prices, after: p.prices }); }
  const pricesAdded = cur.prices.filter((x) => !prev.prices.includes(x));
  const pricesRemoved = prev.prices.filter((x) => !cur.prices.includes(x));
  return { plansAdded: added, plansRemoved: removed, priceChanged, pricesAdded, pricesRemoved };
}
