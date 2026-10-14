// Fair-use guard for history/trends calls (REST + MCP share it): per-key daily cap + velocity check.
// State: usage/daily/<YYYY-MM-DD>/<keyHash>.json {count, items:{<item>:<firstSeenMs>}, flaggedUntil, flagReason}
const { readJSON, writeJSON } = require('./store');
const LIMITS = {
  starter: { daily: 200, distinctDay: 150, burst: 40 },
  pro: { daily: 1000, distinctDay: 600, burst: 120 },
};
const BURST_WINDOW = 10 * 60e3; const COOLDOWN = 60 * 60e3;
const mem = new Map();
const today = () => new Date().toISOString().slice(0, 10);
async function load(h, d) {
  const id = `${h}:${d}`; let s = mem.get(id);
  if (!s) { s = { count: 0, items: {}, pending: 0, flushedAt: Date.now(), syncedAt: 0 }; mem.set(id, s); }
  if (Date.now() - s.syncedAt > 3e3) { await merge(h, d, s); s.syncedAt = Date.now(); } // cross-instance sync
  return s;
}
async function merge(h, d, s) {
  const st = await readJSON(`usage/daily/${d}/${h}.json`).catch(() => null);
  if (st) { s.count = Math.max(s.count, (st.count || 0) + s.pending); for (const [k, v] of Object.entries(st.items || {})) if (!(k in s.items)) s.items[k] = v; if ((st.flaggedUntil || 0) > (s.flaggedUntil || 0)) { s.flaggedUntil = st.flaggedUntil; s.flagReason = st.flagReason; } }
}
async function flush(h, d, s, force) {
  if (!force && s.pending < 5 && Date.now() - s.flushedAt < 20e3) return;
  await merge(h, d, s);
  await writeJSON(`usage/daily/${d}/${h}.json`, { count: s.count, items: s.items, flaggedUntil: s.flaggedUntil || 0, flagReason: s.flagReason || null, updatedAt: new Date().toISOString() });
  s.pending = 0; s.flushedAt = Date.now();
}
// Returns null if allowed, else {status, body, headers}.
async function check(a, item) {
  const L = LIMITS[a.tier] || LIMITS.starter; const d = today(); const s = await load(a.h, d); const now = Date.now();
  const hdr = { 'X-History-Daily-Limit': String(L.daily) };
  if ((s.flaggedUntil || 0) > now) {
    const retry = Math.ceil((s.flaggedUntil - now) / 1000);
    return { status: 429, headers: { ...hdr, 'Retry-After': String(retry) }, body: { error: `History/trends access temporarily throttled: this key ${s.flagReason || 'requested many distinct entities/dates very quickly'}, which looks like bulk extraction (not allowed under our fair-use terms). Try again in ${Math.ceil(retry / 60)} minutes. Need the full archive? Data licence from $499/mo: hello@agentdataco.com`, code: 'velocity_throttled', retryAfterSeconds: retry } };
  }
  if (s.count >= L.daily) {
    const reset = Math.ceil((Date.parse(d + 'T00:00:00Z') + 864e5 - now) / 1000);
    return { status: 429, headers: { ...hdr, 'X-History-Daily-Remaining': '0', 'Retry-After': String(reset) }, body: { error: `Daily limit of ${L.daily} history/trends calls reached for the ${a.tier} plan. Resets at 00:00 UTC. Need more or the full archive? Data licence from $499/mo: hello@agentdataco.com`, code: 'daily_history_limit', retryAfterSeconds: reset } };
  }
  const fresh = !(item in s.items); if (fresh) s.items[item] = now;
  const times = Object.values(s.items); const recent = times.filter((t) => now - t < BURST_WINDOW).length;
  let flag = null;
  if (recent > L.burst) flag = `requested ${recent} distinct entities/dates in 10 minutes (limit ${L.burst})`;
  else if (times.length > L.distinctDay) flag = `requested ${times.length} distinct entities/dates today (limit ${L.distinctDay})`;
  if (flag) { s.flaggedUntil = now + COOLDOWN; s.flagReason = flag; s.flags = (s.flags || 0) + 1; await flush(a.h, d, s, true); console.log(JSON.stringify({ evt: 'velocity_flag', key: a.h.slice(0, 12), tier: a.tier, reason: flag })); return check(a, item); }
  s.count++; s.pending++; await flush(a.h, d, s, fresh);
  a.rl = { ...a.rl, ...hdr, 'X-History-Daily-Remaining': String(Math.max(0, L.daily - s.count)) };
  return null;
}
module.exports = { check, LIMITS };
