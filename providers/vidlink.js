/*
 * VidLink.pro — standalone Nuvio provider.
 *
/*
 * Videasy — standalone Nuvio provider.
 * TMDB -> seed -> wecollege sources -> decrypt -> m3u8 URLs.
 * 12 servers, includes 4K on some content.
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
    log("meta: " + meta.title + " (" + meta.year + ") imdb=" + (meta.imdbId || "-"));

    const seed = await getSeed(id);
    if (!seed) { log("seed failed"); return []; }

    const encTitle = doubleEnc(meta.title);

    for (const srv of SERVERS) {
      const enc = await fetchSources(srv, encTitle, mediaType, meta.year, id, meta.imdbId, s, e, seed);
      if (!enc) continue;

      const result = await decrypt(enc, id, seed);
      if (!result || !Array.isArray(result.sources) || !result.sources.length) continue;

      const streams = result.sources
        .filter(src => src && src.url)
        .sort((a, b) => parseInt(b.quality || 0) - parseInt(a.quality || 0))
        .map(src => ({
          name: "Videasy",
          title: "Videasy " + (src.quality || "auto") + " · " + srv,
          url: String(src.url),
          quality: String(src.quality || "auto"),
          headers: { "User-Agent": UA, "Referer": ORIGIN + "/" },
          provider: "videasy",
          type: "hls"
        }));

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
