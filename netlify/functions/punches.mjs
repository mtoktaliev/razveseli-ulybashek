// Netlify Function: all-time punch counter for the game.
//   GET  /api/punches?player=<id>  -> { totals: {faceId: n}, mine: {faceId: n} }
//   POST /api/punches  {player, counts} -> stores that player's counts
// Each player (browser) has its own blob, so concurrent players never overwrite each other;
// totals are the sum over all players.
import { getStore } from "@netlify/blobs";

const PLAYER_RE = /^[A-Za-z0-9-]{8,64}$/;
const FACE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_FACES = 200;
const MAX_STEP = 2000; // max growth per face in one request (blocks absurd numbers)

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const cleanCounts = (obj) => {
  const out = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj).slice(0, MAX_FACES)) {
    if (FACE_RE.test(k) && Number.isFinite(v) && v > 0) out[k] = Math.min(Math.floor(v), 1e9);
  }
  return out;
};

export default async (req) => {
  const store = getStore({ name: "punches", consistency: "strong" });

  if (req.method === "GET") {
    const player = new URL(req.url).searchParams.get("player") || "";
    const { blobs } = await store.list({ prefix: "players/" });
    const all = await Promise.all(
      blobs.map(async (b) => [b.key, cleanCounts(await store.get(b.key, { type: "json" }))])
    );
    const totals = {};
    let mine = {};
    for (const [key, counts] of all) {
      for (const k in counts) totals[k] = (totals[k] || 0) + counts[k];
      if (key === "players/" + player) mine = counts;
    }
    return json({ totals, mine });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const player = String(body?.player || "");
    if (!PLAYER_RE.test(player)) return json({ error: "bad player" }, 400);
    const key = "players/" + player;
    const old = cleanCounts(await store.get(key, { type: "json" }));
    const next = { ...old };
    const incoming = cleanCounts(body.counts);
    for (const k in incoming) {
      // counts only ever go up, and by a sane amount per request
      next[k] = Math.max(old[k] || 0, Math.min(incoming[k], (old[k] || 0) + MAX_STEP));
    }
    await store.setJSON(key, next);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/punches" };
