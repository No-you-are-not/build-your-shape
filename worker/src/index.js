// Tiny sync store for Build Your Shape.
// GET  /state/:code  -> { state, updatedAt } or 404
// PUT  /state/:code  body { state, updatedAt } -> { ok, updatedAt }
// The sync code is a long random secret generated in the browser; whoever has it can read/write that record.

const ALLOWED_ORIGINS = [
  "https://no-you-are-not.github.io",
  "http://localhost:8000",
];
const CODE_RE = /^[A-Za-z0-9_-]{20,64}$/;
const MAX_BYTES = 64 * 1024;

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    const m = url.pathname.match(/^\/state\/([^/]+)$/);
    if (!m) return json({ error: "not_found" }, 404, origin);
    const code = m[1];
    if (!CODE_RE.test(code)) return json({ error: "bad_code" }, 400, origin);
    const key = "state:" + code;

    if (request.method === "GET") {
      const value = await env.STATE.get(key);
      if (!value) return json({ error: "empty" }, 404, origin);
      return new Response(value, {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) },
      });
    }

    if (request.method === "PUT") {
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: "too_large" }, 413, origin);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400, origin); }
      const s = body && body.state;
      const updatedAt = Number(body && body.updatedAt);
      if (!s || typeof s !== "object" || typeof s.checks !== "object" || typeof s.weights !== "object" || !Number.isFinite(updatedAt)) {
        return json({ error: "bad_state" }, 400, origin);
      }
      // Last write wins, but never let an older snapshot overwrite a newer one.
      const current = await env.STATE.get(key, "json");
      if (current && Number(current.updatedAt) > updatedAt) return json({ ok: false, stale: true, ...current }, 409, origin);
      const overrides = s.overrides && typeof s.overrides === "object" ? s.overrides : {};
      const record = { state: { checks: s.checks, weights: s.weights, overrides, week: Number(s.week) || 1 }, updatedAt };
      await env.STATE.put(key, JSON.stringify(record));
      return json({ ok: true, updatedAt }, 200, origin);
    }

    return json({ error: "method_not_allowed" }, 405, origin);
  },
};
