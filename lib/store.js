const { put, get } = require('@vercel/blob');
async function readJSON(path) {
  try {
    const r = await get(path, { access: 'private', useCache: false });
    if (!r || !r.stream) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) { if (/not.?found/i.test(e.name + e.message)) return null; throw e; }
}
async function writeJSON(path, obj) {
  await put(path, JSON.stringify(obj), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
}
module.exports = { readJSON, writeJSON };
