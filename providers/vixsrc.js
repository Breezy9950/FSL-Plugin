"use strict";

var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (v) => { try { step(generator.next(v)); } catch (e) { reject(e); } };
    var rejected  = (v) => { try { step(generator.throw(v)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const retries = options.retries !== void 0 ? options.retries : 2;
    const delay   = options.delay   !== void 0 ? options.delay   : 800;
    for (let i = 0; i <= retries; i++) {
      try {
        const response = yield fetch(url, {
          headers: Object.assign({ "User-Agent": USER_AGENT, "Accept": "*/*" }, options.headers || {})
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        return yield response.text();
      } catch (err) {
        console.log("[VixSrc] Request failed for " + url + ": " + err.message + (i < retries ? ", retrying (" + (i + 1) + "/" + retries + ")..." : ""));
      }
      if (i < retries) yield new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
    }
    return null;
  });
}

function getTmdbDetails(tmdbId, type) {
  return __async(this, null, function* () {
    const isSeries = type === "series" || type === "tv";
    const endpoint = isSeries ? "tv" : "movie";
    const url = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    console.log("[VixSrc] Fetching TMDB details from: " + url);
    try {
      const response = yield fetch(url);
      const data = yield response.json();
      if (isSeries) return { title: data.name, year: data.first_air_date ? parseInt(data.first_air_date.split("-")[0]) : 0 };
      return { title: data.title, year: data.release_date ? parseInt(data.release_date.split("-")[0]) : 0 };
    } catch (error) {
      console.log("[VixSrc] TMDB request failed: " + error.message);
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

function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const tmdbDetails = yield getTmdbDetails(tmdbId, type);
    if (!tmdbDetails) return [];
    const { title, year } = tmdbDetails;
    const isSeries = type === "series" || type === "tv";
    const isMovie = type === "movie";

    const apiUrl = isMovie
      ? "https://vixsrc.to/api/movie/" + tmdbId + "?lang=en"
      : "https://vixsrc.to/api/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1) + "?lang=en";

    console.log("[VixSrc] API Request URL: " + apiUrl);

    const apiText = yield fetchText(apiUrl, {
      headers: { "Referer": "https://vixsrc.to", "X-Requested-With": "XMLHttpRequest" }
    });
    if (!apiText) { console.log("[VixSrc] API failed: No response"); return []; }

    let apiData;
    try { apiData = JSON.parse(apiText); }
    catch (e) { console.log("[VixSrc] API returned invalid JSON"); return []; }

    const embedPath = String(apiData.src || "").replace(/^\//, "");
    if (!embedPath) { console.log("[VixSrc] No embed path in API response"); return []; }

    const embedUrl = "https://vixsrc.to/" + embedPath;
    console.log("[VixSrc] Embed URL: " + embedUrl);

    const embedHtml = yield fetchText(embedUrl, {
      headers: { "Referer": "https://vixsrc.to" }
    });
    if (!embedHtml) { console.log("[VixSrc] Embed fetch failed"); return []; }

    const videoSection    = embedHtml.split("window.video = {")[1] || "";
    const videoId         = between(videoSection, "id: '", "'");
    const playlistSection = embedHtml.split("window.masterPlaylist")[1] || "";
    const token           = between(playlistSection, "'token': '", "'");
    const expires         = between(playlistSection, "'expires': '", "'");

    if (!videoId || !token || !expires) {
      console.log("[VixSrc] Player params not found (videoId=" + !!videoId + " token=" + !!token + " expires=" + !!expires + ")");
      return [];
    }

    // CRITICAL: use the page's own masterPlaylist URL as the base — some titles
    // have ?b=1 baked in, others don't. Hardcoding a base + always appending
    // b=1 caused 403s on movies and some TV in MaxStream.
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

    // ---- Description — same multi-line format as 4KHDHub ----
    const seSuffix = isSeries && season && episode
      ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
      : "";
    const titleLine = title + " (" + year + ")" + seSuffix;

    const tagParts = ["VixSrc", "HLS", "H.264"];
    const tagLine = tagParts.join(" • ");

    const lines = [titleLine];
    if (tagLine) lines.push(tagLine);
    const description = lines.join("\n");

    const baseName = "VixSrc";

    return [{
      name: baseName,
      title: description,
      size: description,
      description: description,
      url: streamUrl,
      headers: { "Referer": "https://vixsrc.to/", "Origin": "https://vixsrc.to" },
      behaviorHints: { bingeGroup: "vixsrc-hls" }
    }];
  });
}

module.exports = { getStreams, onSettings };
