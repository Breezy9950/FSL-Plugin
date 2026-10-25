/*
 * VidLink.pro — standalone Nuvio provider.
 *
 * Flow: TMDB ID → enc-dec.app /api/enc-vidlink → vidlink.pro /api/b/{type}/{enc}
 * → JSON {stream.qualities} → MP4 URLs per quality.
 *
 * No local crypto, no scraping. TMDB IDs only (Nuvio handles conversion).
 */

const UA              = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ENC_DEC         = "https://enc-dec.app/api/enc-vidlink";
const VIDLINK_API     = "https://vidlink.pro/api/b";
const VIDLINK_ORIGIN  = "https://vidlink.pro";
const VIDLINK_REFERER = "https://vidlink.pro/";
const TIMEOUT         = 15000;

function log(x){ console.log("[VidLink] " + x); }

/* ================= encrypt TMDB ID ================= */

async function encryptId(tmdbId){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const r = await fetch(ENC_DEC + "?text=" + encodeURIComponent(tmdbId), {
      headers: { "User-Agent": UA },
      signal: c.signal
    });
    if (!r || !r.ok) throw new Error("enc-dec HTTP " + (r && r.status));
    const j = await r.json();
    if (!j || !j.result) throw new Error("enc-dec no result for " + tmdbId);
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

/* ================= fetch stream data ================= */

async function fetchVidLink(url){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Origin": VIDLINK_ORIGIN,
        "Referer": VIDLINK_REFERER,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: c.signal
    });
    if (!r) { log("no response"); return null; }
    const text = await r.text();
    if (r.status !== 200) {
      log("HTTP " + r.status + " body=" + text.slice(0, 150));
      return null;
    }
    try {
      return JSON.parse(text);
    } catch(e) {
      log("parse failed: " + e.message);
      return null;
    }
  } catch(e) {
    log("fetch error: " + (e && e.message || e));
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* ================= Nuvio interface ================= */

async function getStreams(tmdbId, mediaType, season, episode, settings){
  try {
    mediaType = String(mediaType || "tv").toLowerCase();
    const id = String(tmdbId || "").trim();
    if (!id) { log("no id"); return []; }
    if (!/^\d+$/.test(id)) { log("non-TMDB id, skipping: " + id); return []; }

    const s = Number(season) || 1;
    const e = Number(episode) || 1;

    const encrypted = await encryptId(id);

    let url;
    if (mediaType === "movie") {
      url = VIDLINK_API + "/movie/" + encrypted;
    } else {
      url = VIDLINK_API + "/tv/" + encrypted + "/" + s + "/" + e;
    }

    log("GET " + url.slice(0, 110));

    const data = await fetchVidLink(url);
    if (!data || !data.stream || !data.stream.qualities) {
      log("no stream data (id=" + id + " type=" + mediaType + ")");
      return [];
    }

    const quals = data.stream.qualities;
    const keys = Object.keys(quals).filter(k => /^\d+$/.test(k));
    keys.sort((a, b) => parseInt(b) - parseInt(a));

    const streams = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const q = quals[k];
      if (!q || !q.url) continue;

      const codec = q.codecName ? " · " + q.codecName : "";
      streams.push({
        name: "VidLink",
        title: "VidLink " + k + "p" + codec,
        url: String(q.url),
        quality: k + "p",
        headers: {
          "User-Agent": UA,
          "Referer": VIDLINK_REFERER
        },
        provider: "vidlink",
        type: q.type === "hls" ? "hls" : "mp4"
      });
    }

    log(streams.length + " streams for " + id + " (" + mediaType + (mediaType === "tv" ? " s" + s + "e" + e : "") + ")");
    return streams;
  } catch (e) {
    log("ERROR " + (e && e.message || e));
    return [];
  }
}

module.exports = { getStreams };
