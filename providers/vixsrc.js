"use strict";

var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (v) => { try { step(generator.next(v)); } catch (e) { reject(e); } };
    var rejected  = (v) => { try { step(generator.throw(v)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const retries = options.retries !== undefined ? options.retries : 2;
    const delay   = options.delay   !== undefined ? options.delay   : 800;
    for (let i = 0; i <= retries; i++) {
      try {
        const r = yield fetch(url, {
          headers: Object.assign({ "User-Agent": USER_AGENT, "Accept": "*/*" }, options.headers || {})
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return yield r.text();
      } catch (err) {
        console.log("[VixSrc] " + url + " -> " + err.message + (i < retries ? " (retry " + (i+1) + "/" + retries + ")" : ""));
      }
      if (i < retries) yield new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
    }
    return null;
  });
}

function getTmdbDetails(tmdbId, type) {
  return __async(this, null, function* () {
    const isSeries = type === "series" || type === "tv";
    const url = "https://api.themoviedb.org/3/" + (isSeries ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    try {
      const r = yield fetch(url);
      const d = yield r.json();
      if (isSeries) return { title: d.name, year: d.first_air_date ? parseInt(d.first_air_date.split("-")[0]) : 0 };
      return { title: d.title, year: d.release_date ? parseInt(d.release_date.split("-")[0]) : 0 };
    } catch (e) {
      console.log("[VixSrc] TMDB failed: " + e.message);
      return null;
    }
  });
}

function between(str, start, end) {
  const i = str.indexOf(start);
  if (i < 0) return null;
  const j = str.indexOf(end, i + start.length);
  if (j < 0) return null;
  return str.substring(i + start.length, j).trim();
}

function onSettings() { return []; }

function getStreams(tmdbId, type, season, episode) {
  return __async(this, null, function* () {
    const tmdb = yield getTmdbDetails(tmdbId, type);
    if (!tmdb) return [];

    const isMovie = type === "movie";
    const apiUrl = isMovie
      ? "https://vixsrc.to/api/movie/" + tmdbId + "?lang=en"
      : "https://vixsrc.to/api/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1) + "?lang=en";

    console.log("[VixSrc] API: " + apiUrl);

    const apiText = yield fetchText(apiUrl, {
      headers: { "Referer": "https://vixsrc.to", "X-Requested-With": "XMLHttpRequest" }
    });
    if (!apiText) return [];

    let apiData;
    try { apiData = JSON.parse(apiText); } catch (e) { return []; }

    const embedPath = String(apiData.src || "").replace(/^\//, "");
    if (!embedPath) { console.log("[VixSrc] No embed path in API response"); return []; }

    const embedUrl = "https://vixsrc.to/" + embedPath;
    console.log("[VixSrc] Embed: " + embedUrl);

    const embedHtml = yield fetchText(embedUrl, {
      headers: { "Referer": "https://vixsrc.to" }
    });
    if (!embedHtml) return [];

    const videoSection    = embedHtml.split("window.video = {")[1] || "";
    const videoId         = between(videoSection, "id: '", "'");
    const playlistSection = embedHtml.split("window.masterPlaylist")[1] || "";
    const token           = between(playlistSection, "'token': '", "'");
    const expires         = between(playlistSection, "'expires': '", "'");

    if (!videoId || !token || !expires) {
      console.log("[VixSrc] Player params not found — videoId=" + !!videoId + " token=" + !!token + " expires=" + !!expires);
      return [];
    }

    // CRITICAL: use the page's own masterPlaylist URL as the base.
    // Some titles have ?b=1 baked in; others don't. Hardcoding a base
    // and adding b=1 caused 403s on movies and some TV.
    const masterUrl = between(playlistSection, "url: '", "'") || ("https://vixsrc.to/playlist/" + videoId);

    const query = [
      "token=" + encodeURIComponent(token),
      "expires=" + encodeURIComponent(expires),
      "lang=en"
    ];
    if (embedHtml.indexOf("window.canPlayFHD = true") >= 0) query.push("h=1");

    const separator = masterUrl.indexOf("?") >= 0 ? "&" : "?";
    const streamUrl = masterUrl + separator + query.join("&");
    console.log("[VixSrc] Playlist: " + streamUrl);

    const seTag = isMovie
      ? ""
      : " S" + String(season || 1).padStart(2, "0") + "E" + String(episode || 1).padStart(2, "0");
    const titleLine = tmdb.title + " (" + tmdb.year + ")" + seTag;
    const description = titleLine + "\nVixSrc • HLS";

    return [{
      name: "VixSrc",
      title: description,
      size: "Auto",
      description: description,
      url: streamUrl,
      headers: { "Referer": "https://vixsrc.to/", "Origin": "https://vixsrc.to" },
      behaviorHints: { bingeGroup: "vixsrc-hls" }
    }];
  });
}

module.exports = { getStreams, onSettings };
