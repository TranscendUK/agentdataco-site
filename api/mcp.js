// Remote MCP server (Streamable HTTP, stateless JSON responses) at https://agentdataco.com/mcp
// Free tools need no key; full tools need `Authorization: Bearer adc_live_...` (same key as the REST API).
const { FEEDS } = require('../lib/feeds');
const { readJSON } = require('../lib/store');
const { CFG } = require('../lib/pages');
const feedHandler = require('./v1/[feed]');
const historyHandler = require('./v1/[feed]/history');
const trendsHandler = require('./v1/trends');
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const FEED_NAMES = Object.keys(FEEDS);
const call = (handler, query, headers) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); }, send(b) { resolve({ status: this.statusCode, body: b }); }, end() { resolve({ status: this.statusCode, body: null }); } };
  Promise.resolve(handler({ method: 'GET', query, headers: { authorization: headers.authorization || '' } }, res)).catch(reject);
});
const strArgs = { q: { type: 'string', description: 'Case-insensitive full-text filter' }, since: { type: 'string', description: 'ISO date; only rows created/updated on or after' }, limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 }, offset: { type: 'integer', minimum: 0, default: 0 } };
const TOOLS = [
  { name: 'list_feeds', free: true, description: 'List the Agent Data Co feeds (AI-ecosystem datasets), their sources and update times. Free, no API key.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_sample', free: true, description: 'Free sample: 5 latest rows from one or all feeds. No API key needed.', inputSchema: { type: 'object', properties: { feed: { type: 'string', enum: FEED_NAMES } } } },
  { name: 'lookup_entity', free: true, description: 'Free: latest public metrics and recent daily values for one tracked entity (top ~2,000 entities: GitHub repo owner/name, MCP server name, OpenRouter model id, pricing page URL, or hf "<type>:<id>"). Full history needs a key (get_history).', inputSchema: { type: 'object', required: ['feed', 'entity'], properties: { feed: { type: 'string', enum: Object.keys(CFG) }, entity: { type: 'string' } } } },
  ...FEED_NAMES.map((f) => ({ name: `get_${f.replace(/-/g, '_')}`, free: false, description: `${FEEDS[f].title} (source: ${FEEDS[f].source}). Full current feed, refreshed daily. Requires API key.${f === 'github-ai-repos' ? ' Pass repo=owner/name for one repo (untracked repos are queued).' : ''}${f === 'ai-pricing' ? ' Pass url= for one pricing page (untracked pages are queued).' : ''}`, inputSchema: { type: 'object', properties: { ...strArgs, ...(f === 'github-ai-repos' ? { repo: { type: 'string' } } : {}), ...(f === 'ai-pricing' ? { url: { type: 'string' } } : {}) } }, feed: f })),
  { name: 'get_history', free: false, description: 'Daily time series for ONE entity from the append-only archive (Starter: last 30 days, Pro: full archive). Max 90-day window per call (from..to); up to 90 rows per page, use nextCursor as `cursor` for the next page. No whole-feed dumps. Fair use: 200 (Starter) / 1,000 (Pro) history+trends calls per day per key; keys scanning many distinct entities/dates very fast are throttled for 1 hour (429). Bulk/full-archive access: data licence from $499/mo, hello@agentdataco.com. Requires API key.', inputSchema: { type: 'object', required: ['feed', 'entity'], properties: { feed: { type: 'string', enum: FEED_NAMES }, entity: { type: 'string', description: 'owner/repo, MCP server name, OpenRouter model id, pricing page URL, "model:<hf id>", HN item id' }, from: { type: 'string', description: 'YYYY-MM-DD (default: to minus 30 days)' }, to: { type: 'string', description: 'YYYY-MM-DD (default today); max 90 days after from' }, limit: { type: 'integer', minimum: 1, maximum: 90, default: 31 }, cursor: { type: 'string', description: 'nextCursor from the previous page' } } } },
  { name: 'get_trends', free: false, description: 'Top movers (1d/7d/30d) by stars/likes/points plus change events: new entities, LLM price changes, MCP version bumps, pricing-page changes. Latest by default; past dates need `feed` and must be within your plan history. Counts toward the daily history/trends fair-use cap (200 Starter / 1,000 Pro). Requires API key.', inputSchema: { type: 'object', properties: { window: { type: 'string', enum: ['1d', '7d', '30d'] }, feed: { type: 'string', enum: FEED_NAMES }, date: { type: 'string', description: 'YYYY-MM-DD (default latest; requires feed)' } } } },
];
const NEED_KEY = 'This tool needs an Agent Data Co API key. Send header `Authorization: Bearer <key>` on the MCP connection. Plans from $19/month: https://agentdataco.com/#pricing. Free tools: list_feeds, get_sample, lookup_entity.';
async function runTool(name, a, headers) {
  const t = TOOLS.find((x) => x.name === name); if (!t) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  const hasKey = /^Bearer\s+\S+/i.test(headers.authorization || '');
  if (!t.free && !hasKey) return { isError: true, text: NEED_KEY };
  let r;
  if (name === 'list_feeds') { const s = await call(feedHandler, { feed: 'sample' }, {}); r = { status: 200, body: Object.fromEntries(Object.entries(s.body.feeds).map(([k, v]) => [k, { title: v.title, rows: v.total, updatedAt: v.updatedAt, source: FEEDS[k].source }])) }; }
  else if (name === 'get_sample') r = await call(feedHandler, { feed: 'sample', ...(a.feed ? { name: a.feed } : {}) }, {});
  else if (name === 'lookup_entity') {
    if (!CFG[a.feed]) return { isError: true, text: `feed must be one of ${Object.keys(CFG).join(', ')}` };
    const doc = await readJSON(`pages/${a.feed}.json`); const e = doc?.entities?.[a.entity];
    r = e ? { status: 200, body: { feed: a.feed, entity: a.entity, page: `https://agentdataco.com${e.path}`, snapshot: doc.date, latest: e.latest, info: e.info, recent: e.series.slice(-7), more: 'Full history: get_history (API key).' } } : { status: 404, body: { error: 'Entity not in the free lookup index (top ~2,000). Try get_history with a key, or the exact id (e.g. owner/repo, OpenRouter id).' } };
  }
  else if (t.feed) r = await call(feedHandler, { ...a, limit: String(a.limit ?? 50), feed: t.feed }, headers);
  else if (name === 'get_history') r = await call(historyHandler, { ...a, ...(a.limit != null ? { limit: String(a.limit) } : {}) }, headers);
  else if (name === 'get_trends') r = await call(trendsHandler, a, headers);
  return { isError: r.status >= 400, text: JSON.stringify(r.body, null, 1) };
}
const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
async function handle(m, headers) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return err(m?.id, -32600, 'Invalid Request');
  const notification = m.id === undefined;
  switch (m.method) {
    case 'initialize': { const v = m.params?.protocolVersion; return ok(m.id, { protocolVersion: PROTOCOLS.includes(v) ? v : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'agentdataco', title: 'Agent Data Co', version: '1.0.0', websiteUrl: 'https://agentdataco.com' }, instructions: 'Daily AI-ecosystem data: GitHub AI/MCP repos, MCP registry, Hugging Face trending, LLM pricing, AI pricing pages, Show HN AI launches; with history and trends. Free: list_feeds, get_sample, lookup_entity. Others need Authorization: Bearer <key> (https://agentdataco.com/#pricing).' }); }
    case 'ping': return ok(m.id, {});
    case 'tools/list': return ok(m.id, { tools: TOOLS.map(({ name, description, inputSchema, free }) => ({ name, title: name.replace(/_/g, ' '), description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false }, _meta: { 'agentdataco/requiresKey': !free } })) });
    case 'tools/call': {
      try { const r = await runTool(m.params?.name, m.params?.arguments || {}, headers); return ok(m.id, { content: [{ type: 'text', text: r.text }], isError: !!r.isError }); }
      catch (e) { return e.code ? err(m.id, e.code, e.message) : ok(m.id, { content: [{ type: 'text', text: 'Internal error: ' + e.message }], isError: true }); }
    }
    case 'resources/list': return ok(m.id, { resources: [] });
    case 'prompts/list': return ok(m.id, { prompts: [] });
    default: return notification ? null : err(m.id, -32601, `Method not found: ${m.method}`);
  }
}
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version'); res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') { if (/text\/event-stream/.test(req.headers.accept || '')) return res.status(405).setHeader('Allow', 'POST') || res.status(405).end(); res.setHeader('Content-Type', 'application/json'); return res.status(200).send(JSON.stringify({ name: 'Agent Data Co MCP server', transport: 'streamable-http', endpoint: 'https://agentdataco.com/mcp', auth: 'Optional Bearer API key; free tools work without one', tools: TOOLS.map((t) => ({ name: t.name, free: t.free })), docs: 'https://agentdataco.com/docs#mcp' }, null, 1)); }
  if (req.method === 'DELETE') return res.status(405).end();
  if (req.method !== 'POST') return res.status(405).end();
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json(err(null, -32700, 'Parse error')); } }
  const headers = { authorization: req.headers.authorization || '' };
  const msgs = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(msgs.map((m) => handle(m, headers)))).filter(Boolean);
  if (!out.length) return res.status(202).end();
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).send(JSON.stringify(Array.isArray(body) ? out : out[0]));
};
