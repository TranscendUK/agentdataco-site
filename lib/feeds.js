// Feed definitions: name -> fetcher + date field for `since` filtering. Logic mirrors the agentdataco Apify actors.
const UA = 'agentdataco-api/1.0 (+https://agentdataco.com)';
async function getJson(url, headers = {}) {
  for (let a = 1; ; a++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
    if (r.ok) return r.json();
    if (a >= 3 || (r.status < 500 && r.status !== 429 && r.status !== 403)) throw new Error(`HTTP ${r.status} for ${url}`);
    await new Promise((s) => setTimeout(s, 2000 * a));
  }
}
const per1M = (x) => (x == null || x === '' ? null : Math.round(Number(x) * 1e6 * 10000) / 10000);

const FEEDS = {
  'github-ai-repos': {
    title: 'GitHub AI agent & MCP repos', dateField: 'created_at', source: 'GitHub Search API',
    async fetch(prev, watch) {
      const topics = ['mcp-server', 'mcp', 'model-context-protocol', 'ai-agent', 'ai-agents', 'llm-agent', 'agentic-ai', 'autonomous-agents'];
      const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const byId = new Map();
      for (const t of topics) {
        for (const q of [`topic:${t}`, `topic:${t} created:>=${since}`]) {
          let data;
          try { data = await getJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100`, headers); } catch (e) { console.warn('gh', q, e.message); continue; }
          for (const r of data.items || []) {
            if (byId.has(r.id)) { const p = byId.get(r.id); if (!p.matched_topics.includes(t)) p.matched_topics.push(t); continue; }
            byId.set(r.id, { id: r.id, full_name: r.full_name, html_url: r.html_url, description: r.description, stargazers_count: r.stargazers_count, forks_count: r.forks_count, open_issues_count: r.open_issues_count, language: r.language, topics: r.topics || [], created_at: r.created_at, updated_at: r.updated_at, pushed_at: r.pushed_at, license: r.license?.spdx_id || null, owner_login: r.owner?.login, homepage: r.homepage || null, archived: r.archived, matched_topics: [t] });
          }
          if (!process.env.GITHUB_TOKEN) await new Promise((s) => setTimeout(s, 1500));
        }
      }
      const have = new Set([...byId.values()].map((r) => r.full_name.toLowerCase()));
      for (const full of (watch || []).slice(0, 50)) {
        if (have.has(full.toLowerCase())) continue;
        try { const r = await getJson(`https://api.github.com/repos/${full}`, headers); byId.set(r.id, { id: r.id, full_name: r.full_name, html_url: r.html_url, description: r.description, stargazers_count: r.stargazers_count, forks_count: r.forks_count, open_issues_count: r.open_issues_count, language: r.language, topics: r.topics || [], created_at: r.created_at, updated_at: r.updated_at, pushed_at: r.pushed_at, license: r.license?.spdx_id || null, owner_login: r.owner?.login, homepage: r.homepage || null, archived: r.archived, matched_topics: ['watchlist'] }); } catch (e) { console.warn('watch repo', full, e.message); }
      }
      return [...byId.values()].sort((a, b) => b.stargazers_count - a.stargazers_count);
    },
  },
  'show-hn-ai': {
    title: 'Show HN AI launches', dateField: 'created_at', source: 'Algolia HN Search API',
    async fetch() {
      const kws = ['AI', 'LLM', 'GPT', 'MCP', 'agent', 'agents', 'Claude', 'chatbot', 'RAG', 'machine learning'];
      const byId = new Map();
      for (const kw of kws) {
        const data = await getJson(`https://hn.algolia.com/api/v1/search_by_date?${new URLSearchParams({ query: kw, tags: 'show_hn', hitsPerPage: '200' })}`);
        const re = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, 'i');
        for (const h of data.hits || []) {
          if (!re.test(`${h.title} ${h.url || ''} ${h.story_text || ''}`)) continue;
          if (byId.has(h.objectID)) { byId.get(h.objectID).matched_keywords.push(kw); continue; }
          byId.set(h.objectID, { id: h.objectID, title: h.title, url: h.url || null, hn_url: `https://news.ycombinator.com/item?id=${h.objectID}`, points: h.points, num_comments: h.num_comments, created_at: h.created_at, matched_keywords: [kw] });
        }
      }
      return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
  },
  'mcp-servers': {
    title: 'Official MCP registry servers', dateField: 'publishedAt', source: 'registry.modelcontextprotocol.io',
    async fetch() {
      const out = []; let cursor = null;
      for (let pages = 0; pages < 100; pages++) {
        const p = new URLSearchParams({ limit: '100', version: 'latest' }); if (cursor) p.set('cursor', cursor);
        const data = await getJson(`https://registry.modelcontextprotocol.io/v0/servers?${p}`);
        const rows = data.servers || [];
        for (const row of rows) {
          const s = row.server || row; const meta = row._meta?.['io.modelcontextprotocol.registry/official'] || {};
          const status = meta.status || s.status || 'unknown';
          if (status !== 'active') continue;
          out.push({ name: s.name, title: s.title || null, description: s.description || null, version: s.version, status, publishedAt: meta.publishedAt || null, updatedAt: meta.updatedAt || null, remotes: s.remotes || [], packages: s.packages || [], repository: s.repository || null, websiteUrl: s.websiteUrl || null });
        }
        cursor = data.metadata?.nextCursor; if (!rows.length || !cursor) break;
      }
      return out.sort((a, b) => ((a.publishedAt || '') < (b.publishedAt || '') ? 1 : -1));
    },
  },
  'hf-trending': {
    title: 'Hugging Face trending models & Spaces', dateField: 'createdAt', source: 'Hugging Face Hub API',
    async fetch() {
      const out = [];
      for (const type of ['models', 'spaces', 'datasets']) {
        const rows = await getJson(`https://huggingface.co/api/${type}?sort=trendingScore&limit=100`);
        for (const r of rows) out.push({ type: type.replace(/s$/, ''), id: r.id, url: `https://huggingface.co/${type === 'models' ? '' : type + '/'}${r.id}`, author: r.id.includes('/') ? r.id.split('/')[0] : r.author || null, likes: r.likes ?? null, downloads: r.downloads ?? null, trendingScore: r.trendingScore ?? null, pipelineTag: r.pipeline_tag || null, libraryName: r.library_name || null, sdk: r.sdk || null, license: (r.tags || []).find((t) => t.startsWith('license:'))?.slice(8) || null, tags: r.tags || [], createdAt: r.createdAt || null, lastModified: r.lastModified || null });
      }
      return out;
    },
  },
  'llm-pricing': {
    title: 'LLM model pricing (OpenRouter)', dateField: 'created', source: 'OpenRouter models API',
    async fetch(prev) {
      const data = (await getJson('https://openrouter.ai/api/v1/models')).data || [];
      const pm = new Map((prev || []).map((m) => [m.id, m]));
      return data.map((m) => {
        const row = { id: m.id, name: m.name, provider: m.id.split('/')[0], created: m.created ? new Date(m.created * 1000).toISOString() : null, contextLength: m.context_length ?? null, maxCompletionTokens: m.top_provider?.max_completion_tokens ?? null, inputModalities: m.architecture?.input_modalities || [], outputModalities: m.architecture?.output_modalities || [], promptUsdPer1M: per1M(m.pricing?.prompt), completionUsdPer1M: per1M(m.pricing?.completion), cacheReadUsdPer1M: per1M(m.pricing?.input_cache_read), isFree: Number(m.pricing?.prompt || 0) === 0 && Number(m.pricing?.completion || 0) === 0, supportsTools: (m.supported_parameters || []).includes('tools'), huggingFaceId: m.hugging_face_id || null };
        const p = pm.get(row.id);
        row.change = !prev ? 'first_snapshot' : !p ? 'new_model' : (p.promptUsdPer1M !== row.promptUsdPer1M || p.completionUsdPer1M !== row.completionUsdPer1M) ? 'price_changed' : 'unchanged';
        if (row.change === 'price_changed') row.previous = { promptUsdPer1M: p.promptUsdPer1M, completionUsdPer1M: p.completionUsdPer1M };
        if (p && p.change === 'price_changed' && row.change === 'unchanged') { /* keep */ }
        return row;
      }).sort((a, b) => ((a.created || '') < (b.created || '') ? 1 : -1));
    },
  },
  'ai-pricing': {
    title: 'AI & SaaS pricing page snapshots', dateField: 'snapshotAt', source: 'Public pricing pages',
    async fetch(prev, watch) {
      const { extract, diff } = await import('./extract.mjs');
      const urls = ['https://cursor.com/pricing', 'https://elevenlabs.io/pricing', 'https://linear.app/pricing', 'https://www.notion.com/pricing', 'https://www.perplexity.ai/pro', 'https://openai.com/chatgpt/pricing/', 'https://claude.com/pricing', 'https://x.ai/grok', 'https://mistral.ai/pricing', 'https://www.anthropic.com/pricing', 'https://replit.com/pricing', 'https://v0.app/pricing', 'https://lovable.dev/pricing', 'https://bolt.new/pricing', 'https://windsurf.com/pricing', 'https://github.com/features/copilot/plans', 'https://www.midjourney.com/pricing', 'https://runwayml.com/pricing', 'https://www.jasper.ai/pricing', 'https://zapier.com/pricing'];
      for (const w of (watch || []).slice(0, 100)) if (!urls.includes(w)) urls.push(w);
      const pm = new Map((prev || []).map((p) => [p.url, p]));
      const now = new Date().toISOString();
      const out = await Promise.all(urls.map(async (url) => {
        const p = pm.get(url);
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; AgentDataCoPricingBot/1.0; +https://agentdataco.com)', accept: 'text/html' }, redirect: 'follow' });
          const html = await res.text();
          if (!res.ok || /just a moment|cf-chl|captcha-delivery/i.test(html.slice(0, 5000))) throw new Error(`blocked_or_http_${res.status}`);
          const cur = extract(html, url);
          if (!cur.plans.length && !cur.prices.length) throw new Error('no_prices_found');
          const old = p && p.status === 'ok' ? p : null;
          const changed = !!old && old.contentHash !== cur.contentHash;
          return { ...cur, status: 'ok', snapshotAt: now, changed, changes: old ? diff(old, cur) : { firstSnapshot: true }, lastChangedAt: changed ? now : (old?.lastChangedAt || null) };
        } catch (e) {
          return p && p.status === 'ok' ? { ...p, stale: true, lastError: e.message } : null;
        }
      }));
      return out.filter(Boolean);
    },
  },
};
module.exports = { FEEDS };
