/*
 * Videasy — standalone Nuvio provider.
 * TMDB -> seed -> wecollege sources -> decrypt -> m3u8 URLs.
 * Uses invisible unicode prefixes so Nuvio sorts 2160p/1440p/1080p/720p correctly.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const ENC_DEC   = "https://enc-dec.app/api";
const SEED_API  = "https://api.wecollege.net/seed";
const SRC_API   = "https://api.wecollege.net";
const ORIGIN    = "https://vidy.st";
const TMDB_KEY  = "68e094699525b18a70bab2f86b1fa706";
const TIMEOUT   = 15000;

const SERVERS = [
  "miami", "boise", "vegas", "reno", "oakland", "seattle",
  "phoenix", "atlanta", "portland", "dallas", "tampa", "orlando"
];

/*
 * Invisible unicode prefix map — codepoints in ASCENDING order
 * correspond to DESCENDING quality. Nuvio's alphabetical sort
 * (or any string sort) then produces 2160p > 1440p > 1080p > ...
 *
 *   U+200B ZWSP   8203  → 4320p (8K)
 *   U+200C ZWNJ   8204  → 2160p (4K)
 *   U+200D ZWJ    8205  → 1440p (2K)
 *   U+200E LRM    8206  → 1080p
 *   U+200F RLM    8207  → 720p
 *   U+2060 WJ     8288  → 480p
 *   U+2061        8289  → 360p
 *   U+2062        8290  → 240p
 *   U+2063        8291  → 144p
 *   U+2064        8292  → auto/unknown
 */
function invisiblePrefix(q) {
  const num = parseInt(String(q).replace(/\D/g, ""), 10) || 0;
  if (num >= 4320) return "\u200B";
  if (num >= 2160) return "\u200C";
  if (num >= 1440) return "\u200D";
  if (num >= 1080) return "\u200E";
  if (num >= 720)  return "\u200F";
  if (num >= 480)  return "\u2060";
  if (num >= 360)  return "\u2061";
  if (num >= 240)  return "\u2062";
  if (num >= 144)  return "\u2063";
  return "\u2064";
}

function log(x){ console.log("[Videasy] " + x); }
function doubleEnc(s){ return encodeURIComponent(encodeURIComponent(s)); }

async function fetchT(url, opts = {}, ms = TIMEOUT) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
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

async function fetchJson(url, opts = {}) {
  const r = await fetchT(url, { ...opts, headers: { "Accept": "application/json", ...(opts.headers || {}) } });
  if (r.status !== 200) return null;
  try { return JSON.parse(r.text); } catch(e) { return null; }
}

async function tmdbMeta(tmdbId, mediaType) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const info = await fetchJson("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=en-US");
  if (!info) return null;
  const title = info.title || info.name || info.original_title || info.original_name || "";
  const year = (info.release_date || info.first_air_date || "").slice(0, 4);
  let imdbId = "";
  const ext = await fetchJson("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "/external_ids?api_key=" + TMDB_KEY);
  if (ext && ext.imdb_id) imdbId = ext.imdb_id;
  return { title, year, imdbId };
}

async function getSeed(tmdbId) {
  const j = await fetchJson(SEED_API + "?mediaId=" + tmdbId, { headers: { "Origin": ORIGIN, "Referer": ORIGIN + "/" } });
  return j && j.seed ? j.seed : null;
}

async function fetchSources(srv, encTitle, mediaType, year, tmdbId, imdbId, season, episode, seed) {
  let url = SRC_API + "/" + srv + "/sources" +
    "?title=" + encTitle +
    "&mediaType=" + mediaType +
    "&year=" + year +
    "&tmdbId=" + tmdbId +
    "&imdbId=" + imdbId +
    "&enc=2" +
    "&seed=" + seed;
  if (mediaType === "tv") url += "&episodeId=" + episode + "&seasonId=" + season;

  const r = await fetchT(url, { headers: { "Origin": ORIGIN, "Referer": ORIGIN + "/", "Accept": "*/*" } });
  if (r.status !== 200 || r.text.length < 30) return null;
  return r.text;
}

async function decrypt(encText, tmdbId, seed) {
  const r = await fetchT(ENC_DEC + "/dec-videasy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: encText, id: tmdbId, seed: seed })
  });
  if (r.status !== 200) return null;
  try {
    const j = JSON.parse(r.text);
    if (j.status !== 200 || !j.result) return null;
    return j.result;
  } catch(e) { return null; }
}

function sortKey(q) {
  return parseInt(String(q).replace(/\D/g, ""), 10) || 0;
}

async function getStreams(tmdbId, mediaType, season, episode, settings){
  try {
    mediaType = String(mediaType || "tv").toLowerCase();
    const id = String(tmdbId || "").trim();
    if (!id || !/^\d+$/.test(id)) { log("invalid id"); return []; }
    if (mediaType !== "movie" && mediaType !== "tv") return [];

    const s = Number(season) || 1;
    const e = Number(episode) || 1;

    const meta = await tmdbMeta(id, mediaType);
    if (!meta || !meta.title) { log("tmdb meta failed"); return []; }

    const seed = await getSeed(id);
    if (!seed) { log("seed failed"); return []; }

    const encTitle = doubleEnc(meta.title);

    for (const srv of SERVERS) {
      const enc = await fetchSources(srv, encTitle, mediaType, meta.year, id, meta.imdbId, s, e, seed);
      if (!enc) continue;

      const result = await decrypt(enc, id, seed);
      if (!result || !Array.isArray(result.sources) || !result.sources.length) continue;

      // Plugin-side sort: highest quality first (in case array order is respected)
      const sorted = result.sources
        .filter(src => src && src.url)
        .sort((a, b) => sortKey(b.quality) - sortKey(a.quality));

      const streams = sorted.map(src => {
        const q = String(src.quality || "auto");
        // Invisible prefix forces Nuvio's alphabetical sort to match quality order
        return {
          name: "Videasy",
          title: invisiblePrefix(q) + "Videasy " + q + " · " + srv,
          url: String(src.url),
          quality: q,
          headers: { "User-Agent": UA, "Referer": ORIGIN + "/" },
          provider: "videasy",
          type: "hls"
        };
      });

      log("found " + streams.length + " streams on " + srv);
      return streams;
    }

    log("all servers failed");
    return [];
  } catch(e) {
    log("ERROR " + (e && e.message || e));
    return [];
  }
}

module.exports = { getStreams };
