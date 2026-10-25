/*
 * Videasy — DIAGNOSTIC build.
 *
 * Returns EVERY working lane's streams instead of racing.
 * Use this to verify audio + subtitles per lane manually in Nuvio.
 */

const UA        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const ENC_DEC   = "https://enc-dec.app/api";
const SEED_API  = "https://api.wecollege.net/seed";
const SRC_API   = "https://api.wecollege.net";
const ORIGIN    = "https://vidy.st";
const TIMEOUT   = 15000;

const SERVERS = [
  "miami","boise","vegas","phoenix","atlanta","seattle","portland",
  "oakland","dallas","tampa","orlando","reno"
];

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

function subFormat(url) {
  const m = String(url || "").match(/\.(srt|vtt|ass|ssa)(?:\?|$)/i);
  return m ? m[1].toLowerCase() : "srt";
}

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

async function getSeed(tmdbId) {
  const r = await fetchT(SEED_API + "?mediaId=" + tmdbId, {
    headers: { "Origin": ORIGIN, "Referer": ORIGIN + "/", "Accept": "application/json" }
  });
  if (r.status !== 200) return null;
  try {
    const j = JSON.parse(r.text);
    return j && j.seed ? j.seed : null;
  } catch(e) { return null; }
}

async function fetchSources(srv, mediaType, tmdbId, season, episode, seed) {
  let url = SRC_API + "/" + srv + "/sources" +
    "?title=x" +
    "&mediaType=" + mediaType +
    "&year=0" +
    "&tmdbId=" + tmdbId +
    "&enc=2" +
    "&seed=" + seed;
  if (mediaType === "tv") url += "&episodeId=" + episode + "&seasonId=" + season;

  const r = await fetchT(url, {
    headers: { "Origin": ORIGIN, "Referer": ORIGIN + "/", "Accept": "*/*" }
  });
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
    if (!id || !/^\d+$/.test(id)) { log("invalid id: " + id); return []; }
    if (mediaType !== "movie" && mediaType !== "tv") return [];

    const s = Number(season) || 1;
    const e = Number(episode) || 1;

    log("DIAGNOSTIC resolve tmdb=" + id + " " + mediaType + (mediaType === "tv" ? " s" + s + "e" + e : ""));

    const seed = await getSeed(id);
    if (!seed) { log("seed failed"); return []; }

    const laneResults = await Promise.all(SERVERS.map(async (srv) => {
      try {
        const enc = await fetchSources(srv, mediaType, id, s, e, seed);
        if (!enc) return { srv, err: "no sources response" };
        const result = await decrypt(enc, id, seed);
        if (!result || !Array.isArray(result.sources) || !result.sources.length) {
          return { srv, err: "no sources after decrypt" };
        }
        const subs = Array.isArray(result.subtitles) ? result.subtitles.filter(x => x && x.url) : [];
        return { srv, result, subs };
      } catch (err) {
        return { srv, err: String(err && err.message || err) };
      }
    }));

    const streams = [];

    for (const lane of laneResults) {
      const srvLabel = labelFor(lane.srv);
      if (lane.err) { log("✗ " + srvLabel + " — " + lane.err); continue; }

      const subs = lane.subs.map(sub => ({
        url: String(sub.url),
        name: String(sub.lang || sub.language || "Subtitle"),
        language: String(sub.language || sub.lang || "und"),
        format: subFormat(sub.url),
        default: false,
        headers: { "User-Agent": UA }
      }));

      // Per-lane dedupe: keep highest quality per URL
      const urlMap = new Map();
      for (const src of lane.result.sources) {
        if (!src || !src.url) continue;
        const url = String(src.url);
        const q = String(src.quality || "auto");
        const r = rankOf(q);
        const prev = urlMap.get(url);
        if (!prev || r < prev.rank) urlMap.set(url, { url, quality: q, rank: r });
      }

      const titleLine = mediaType === "movie"
        ? "Movie"
        : "S" + String(s).padStart(2,"0") + "E" + String(e).padStart(2,"0");

      for (const { url, quality } of urlMap.values()) {
        const subsSuffix = subs.length ? " · " + subs.length + " subs" : "";
        const label = srvLabel + " " + quality + subsSuffix;
        streams.push({
          name: label,
          title: titleLine + "\n" + label,
          url: url,
          quality: quality,
          headers: { "User-Agent": UA, "Referer": ORIGIN + "/" },
          subtitles: subs,
          provider: "videasy",
          type: "hls",
          __rank: rankOf(quality),
          __lane: srvLabel
        });
      }

      log("✓ " + srvLabel + " — " + urlMap.size + " src(s), " + subs.length + " subs");
    }

    if (!streams.length) { log("no lane returned sources"); return []; }

    // Sort by rank (quality high→low), then lane alphabetical
    streams.sort((a, b) => {
      if (a.__rank !== b.__rank) return a.__rank - b.__rank;
      return a.__lane.localeCompare(b.__lane);
    });

    // Apply invisible prefix ONCE at the end — no strip-and-reapply
    for (let i = 0; i < streams.length; i++) {
      streams[i].name = invisiblePrefix(i) + streams[i].name;
      delete streams[i].__rank;
      delete streams[i].__lane;
    }

    log("📤 emitting " + streams.length + " streams from " + laneResults.filter(x => !x.err).length + "/" + SERVERS.length + " lanes");
    return streams;
  } catch(e) {
    log("ERROR " + (e && e.message || e));
    return [];
  }
}

module.exports = { getStreams };
