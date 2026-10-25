/*
 * Videasy — standalone Nuvio provider.
 *
 * Confirmed by test:
 *   - wecollege requires tmdbId (numeric TMDB id only)
 *   - wecollege uses TVDB season structure for S/E
 *   - wecollege ignores title, imdbId, tvdbId params entirely
 *
 * Nuvio already provides TMDB id + TVDB S/E, so no conversion is needed.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const ENC_DEC   = "https://enc-dec.app/api";
const SEED_API  = "https://api.wecollege.net/seed";
const SRC_API   = "https://api.wecollege.net";
const ORIGIN    = "https://vidy.st";
const TIMEOUT   = 15000;

const SERVERS = [
  "miami","boise","vegas","phoenix","atlanta","seattle","portland",
  "oakland","dallas","tampa","orlando","reno"
];
const FOUR_K_SERVERS = new Set(["miami","boise"]);
const PRIORITY_HEAD_START_MS = 400;

const SERVER_LABELS = {
  miami:"Miami", boise:"Boise", vegas:"Vegas", reno:"Reno",
  oakland:"Oakland", seattle:"Seattle", phoenix:"Phoenix",
  atlanta:"Atlanta", portland:"Portland", dallas:"Dallas",
  tampa:"Tampa", orlando:"Orlando"
};

function labelFor(srv){ return SERVER_LABELS[srv] || srv; }
function log(x){ console.log("[Videasy] " + x); }

function invisiblePrefix(i) {
  if (i < 16)  return String.fromCodePoint(0xFE00 + i);
  if (i < 256) return String.fromCodePoint(0xE0100 + (i - 16));
  return "";
}
function rankOf(q) {
  const n = parseInt(String(q).replace(/\D/g,""),10) || 0;
  if (n >= 4320) return 1; if (n >= 2160) return 2;
  if (n >= 1440) return 3; if (n >= 1080) return 4;
  if (n >= 720)  return 5; if (n >= 480)  return 6;
  if (n >= 360)  return 7; if (n >= 240)  return 8;
  return 9;
}

async function fetchT(url, opts = {}, ms = TIMEOUT, externalSignal) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  if (externalSignal) {
    if (externalSignal.aborted) c.abort();
    else externalSignal.addEventListener("abort", () => { try { c.abort(); } catch(e) {} });
  }
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, ...(opts.headers || {}) },
      ...opts,
      signal: c.signal
    });
    return { status: r.status, text: await r.text() };
  } catch(e) { return { status: 0, text: "" }; }
  finally { clearTimeout(t); }
}

async function getSeed(tmdbId) {
  const r = await fetchT(SEED_API + "?mediaId=" + tmdbId, { headers: { "Origin": ORIGIN, "Referer": ORIGIN + "/", "Accept": "application/json" } });
  if (r.status !== 200) return null;
  try {
    const j = JSON.parse(r.text);
    return j && j.seed ? j.seed : null;
  } catch(e) { return null; }
}

async function fetchSources(srv, mediaType, tmdbId, season, episode, seed, signal) {
  // title is ignored by wecollege — pass a static placeholder.
  // tmdbId is the only identity that matters.
  let url = SRC_API + "/" + srv + "/sources" +
    "?title=x" +
    "&mediaType=" + mediaType +
    "&year=0" +
    "&tmdbId=" + tmdbId +
    "&enc=2" +
    "&seed=" + seed;
  if (mediaType === "tv") url += "&episodeId=" + episode + "&seasonId=" + season;

  const r = await fetchT(url, { headers: { "Origin": ORIGIN, "Referer": ORIGIN + "/", "Accept": "*/*" } }, TIMEOUT, signal);
  if (r.status !== 200 || r.text.length < 30) return null;
  return r.text;
}

async function decrypt(encText, tmdbId, seed, signal) {
  const r = await fetchT(ENC_DEC + "/dec-videasy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: encText, id: tmdbId, seed: seed })
  }, TIMEOUT, signal);
  if (r.status !== 200) return null;
  try {
    const j = JSON.parse(r.text);
    if (j.status !== 200 || !j.result) return null;
    return j.result;
  } catch(e) { return null; }
}

async function raceServers(mediaType, tmdbId, season, episode, seed) {
  const shared = new AbortController();
  let winner = null, settled = false;

  const tasks = SERVERS.map(async (srv) => {
    const is4K = FOUR_K_SERVERS.has(srv);
    if (!is4K) {
      await new Promise(r => setTimeout(r, PRIORITY_HEAD_START_MS));
      if (settled || shared.signal.aborted) return winner;
    }
    try {
      const enc = await fetchSources(srv, mediaType, tmdbId, season, episode, seed, shared.signal);
      if (!enc) throw new Error("empty");
      if (shared.signal.aborted) return winner;
      const result = await decrypt(enc, tmdbId, seed, shared.signal);
      if (!result || !Array.isArray(result.sources) || !result.sources.length) throw new Error("no sources");
      if (shared.signal.aborted) return winner;
      if (!settled) {
        settled = true;
        winner = { srv, result, is4K };
        const has4K = result.sources.some(s => (parseInt(String(s.quality).replace(/\D/g,""),10)||0) >= 2160);
        log("🏆 WINNER: " + labelFor(srv) + (is4K ? " [4K-capable]" : "") + (has4K ? " → 4K delivered" : " → no 4K for this title"));
        try { shared.abort(); } catch(e) {}
      }
      return winner;
    } catch(e) {
      if (settled) return winner;
      throw e;
    }
  });

  try { await Promise.any(tasks); } catch(e) {}
  return winner;
}

async function getStreams(tmdbId, mediaType, season, episode, settings){
  try {
    mediaType = String(mediaType || "tv").toLowerCase();
    const id = String(tmdbId || "").trim();
    if (!id || !/^\d+$/.test(id)) { log("invalid id: " + id); return []; }
    if (mediaType !== "movie" && mediaType !== "tv") return [];

    const s = Number(season) || 1;
    const e = Number(episode) || 1;

    log("resolve tmdb=" + id + " " + mediaType + (mediaType === "tv" ? " s" + s + "e" + e : ""));

    const seed = await getSeed(id);
    if (!seed) { log("seed failed"); return []; }

    const winner = await raceServers(mediaType, id, s, e, seed);
    if (!winner) { log("all " + SERVERS.length + " servers failed"); return []; }

    const winnerLabel = labelFor(winner.srv);
    const titleLine = "Videasy " + mediaType.toUpperCase() +
      (mediaType === "tv" ? " S" + String(s).padStart(2,"0") + "E" + String(e).padStart(2,"0") : "") +
      " • " + winnerLabel;

    const seen = new Set();
    const built = [];
    for (const src of winner.result.sources) {
      if (!src || !src.url) continue;
      const url = String(src.url);
      if (seen.has(url)) continue;
      seen.add(url);

      const q = String(src.quality || "auto");
      built.push({
        name: "Videasy " + q + " • " + winnerLabel,
        title: titleLine + "\n" + "Videasy " + q + " • " + winnerLabel,
        url: url,
        quality: q,
        headers: { "User-Agent": UA, "Referer": ORIGIN + "/" },
        provider: "videasy",
        type: "hls",
        __rank: rankOf(q)
      });
    }

    if (!built.length) { log("winner had no usable sources"); return []; }
    built.sort((a, b) => a.__rank - b.__rank);
    for (let i = 0; i < built.length; i++) {
      built[i].name = invisiblePrefix(i) + built[i].name;
      delete built[i].__rank;
    }

    log("📤 emitting " + built.length + " streams from " + winnerLabel);
    return built;
  } catch(e) {
    log("ERROR " + (e && e.message || e));
    return [];
  }
}

module.exports = { getStreams };
