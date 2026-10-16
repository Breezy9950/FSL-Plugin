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

// Try these in order — VixSrc rotates domains
var CANDIDATE_DOMAINS = [
  "https://vixsrc.to",
  "https://vixsrc.tv",
  "https://vixsrc.xyz",
  "https://vixsrc.win",
  "https://vixsrc.ru"
];

function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const retries = options.retries !== void 0 ? options.retries : 1;
    const delay   = options.delay   !== void 0 ? options.delay   : 800;
    for (let i = 0; i <= retries; i++) {
      try {
        const response = yield fetch(url, {
          headers: Object.assign({ "User-Agent": USER_AGENT, "Accept": "*/*" }, options.headers || {})
        });
        const status = response.status;
        const text = yield response.text();
        console.log("[VixSrc] HTTP " + status + " " + url + " (len=" + text.length + ")");
        if (status < 200 || status >= 400) return { ok: false, status: status, text: text };
        return { ok: true, status: status, text: text };
      } catch (err) {
        console.log("[VixSrc] Request error for " + url + ": " + err.message);
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

function tryOneDomain(domain, tmdbId, isMovie, season, episode) {
  return __async(this, null, function* () {
    console.log("[VixSrc] === Trying domain: " + domain + " ===");

    const apiUrl = isMovie
      ? domain + "/api/movie/" + tmdbId + "?lang=en"
      : domain + "/api/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1) + "?lang=en";

    const apiResult = yield fetchText(apiUrl, {
      headers: { "Referer": domain, "X-Requested-With": "XMLHttpRequest" }
    });
    if (!apiResult || !apiResult.ok) {
      console.log("[VixSrc] API failed: " + (apiResult ? "HTTP " + apiResult.status + " body=" + apiResult.text.substring(0, 200) : "no response"));
      return null;
    }

    console.log("[VixSrc] API raw body (first 300 chars): " + apiResult.text.substring(0, 300));

    let apiData;
    try { apiData = JSON.parse(apiResult.text); }
    catch (e) {
      console.log("[VixSrc] API is not JSON: " + e.message);
      return null;
    }

    const embedPath = String(apiData.src || "").replace(/^\//, "");
    if (!embedPath) {
      console.log("[VixSrc] API JSON has no .src field. Keys: " + Object.keys(apiData).join(", "));
      return null;
    }

    const embedUrl = domain + "/" + embedPath;
    const embedResult = yield fetchText(embedUrl, { headers: { "Referer": domain } });
    if (!embedResult || !embedResult.ok) {
      console.log("[VixSrc] Embed failed: " + (embedResult ? "HTTP " + embedResult.status : "no response"));
      return null;
    }

    console.log("[VixSrc] Embed raw body (first 500 chars): " + embedResult.text.substring(0, 500));

    const embedHtml = embedResult.text;
    const videoSection    = embedHtml.split("window.video = {")[1] || "";
    const videoId         = between(videoSection, "id: '", "'");
    const playlistSection = embedHtml.split("window.masterPlaylist")[1] || "";
    const token           = between(playlistSection, "'token': '", "'");
    const expires         = between(playlistSection, "'expires': '", "'");

    console.log("[VixSrc] Parsed: videoId=" + videoId + " token=" + (token ? token.substring(0, 20) + "..." : null) + " expires=" + expires);

    if (!videoId || !token || !expires) {
      console.log("[VixSrc] Has 'window.video': " + (embedHtml.indexOf("window.video") >= 0));
      console.log("[VixSrc] Has 'window.masterPlaylist': " + (embedHtml.indexOf("window.masterPlaylist") >= 0));
      console.log("[VixSrc] Has 'token': " + (embedHtml.indexOf("token") >= 0));
      console.log("[VixSrc] Has 'canPlayFHD': " + (embedHtml.indexOf("canPlayFHD") >= 0));
      return null;
    }

    const masterUrl = between(playlistSection, "url: '", "'") || (domain + "/playlist/" + videoId);
    const query = [
      "token=" + encodeURIComponent(token),
      "expires=" + encodeURIComponent(expires),
      "lang=en"
    ];
    if (embedHtml.indexOf("window.canPlayFHD = true") >= 0) query.push("h=1");
    const separator = masterUrl.indexOf("?") >= 0 ? "&" : "?";
    const streamUrl = masterUrl + separator + query.join("&");

    console.log("[VixSrc] SUCCESS — playlist URL: " + streamUrl);
    return { streamUrl: streamUrl, domain: domain };
  });
}

function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const tmdbDetails = yield getTmdbDetails(tmdbId, type);
    if (!tmdbDetails) return [];
    const { title, year } = tmdbDetails;
    const isSeries = type === "series" || type === "tv";
    const isMovie = type === "movie";

    let hit = null;
    for (const domain of CANDIDATE_DOMAINS) {
      const result = yield tryOneDomain(domain, tmdbId, isMovie, season, episode);
      if (result) { hit = result; break; }
    }

    if (!hit) { console.log("[VixSrc] All domains failed"); return []; }

    const seSuffix = isSeries && season && episode
      ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
      : "";
    const titleLine = title + " (" + year + ")" + seSuffix;
    const tagLine = ["VixSrc", "HLS", "H.264"].join(" • ");
    const description = [titleLine, tagLine].join("\n");

    return [{
      name: "VixSrc",
      title: description,
      size: description,
      description: description,
      url: hit.streamUrl,
      headers: { "Referer": hit.domain + "/", "Origin": hit.domain },
      behaviorHints: { bingeGroup: "vixsrc-hls" }
    }];
  });
}

module.exports = { getStreams, onSettings };
