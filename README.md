# agentdataco-site

Source for [agentdataco.com](https://agentdataco.com): daily, archived data on the AI ecosystem (GitHub AI agent & MCP repos, the official MCP registry, Hugging Face trending, LLM pricing from OpenRouter, AI/SaaS pricing pages, Show HN AI launches), served as a REST API and a remote **MCP server**.

## MCP server

Remote endpoint (Streamable HTTP): `https://agentdataco.com/mcp`

| Tool | Key needed |
|---|---|
| `list_feeds`, `get_sample`, `lookup_entity` | No |
| `get_github_ai_repos`, `get_show_hn_ai`, `get_mcp_servers`, `get_hf_trending`, `get_llm_pricing`, `get_ai_pricing`, `get_history`, `get_trends` | Yes (`Authorization: Bearer <key>`) |

```json
{ "mcpServers": { "agentdataco": { "url": "https://agentdataco.com/mcp", "headers": { "Authorization": "Bearer adc_live_..." } } } }
```

Claude Code: `claude mcp add --transport http agentdataco https://agentdataco.com/mcp`

## REST API
Docs: https://agentdataco.com/docs · OpenAPI: https://agentdataco.com/openapi.json · Free sample: https://agentdataco.com/api/v1/sample · Plans: https://agentdataco.com/#pricing

## Stack
Vercel (static `public/` + Node functions in `api/`), Vercel Blob for feeds and the append-only snapshot archive, Stripe for billing, Resend for email. Secrets live only in Vercel environment variables.

Operated by Transcend UK Holdings Ltd (Agent Data Co).
