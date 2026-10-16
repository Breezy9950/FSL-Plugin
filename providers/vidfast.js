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

function fetchRaw(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const response = yield fetch(url, {
      method: options.method || "GET",
      headers: Object.assign({ "User-Agent": USER_AGENT, "Accept": "*/*" }, options.headers || {}),
      body: options.body
    });
    const text = yield response.text();
    return { status: response.status, text: text };
  });
}

function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const r = yield fetchRaw(url, options);
    if (r.status < 200 || r.status >= 400) return null;
    return r.text;
  });
}

function getTmdbDetails(tmdbId, type) {
  return __async(this, null, function* () {
    const isSeries = type === "series" || type === "tv";
    const url = "https://api.themoviedb.org/3/" + (isSeries ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    try { const r = yield fetch(url); const d = yield r.json();
      return isSeries
        ? { title: d.name, year: d.first_air_date ? parseInt(d.first_air_date.split("-")[0]) : 0 }
        : { title: d.title, year: d.release_date ? parseInt(d.release_date.split("-")[0]) : 0 };
    } catch (e) { return null; }
  });
}

function encDecDecrypt(encrypted) {
  return __async(this, null, function* () {
    const r = yield fetchRaw("https://enc-dec.app/api/dec-vidfast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: encrypted })
    });
    if (r.status < 200 || r.status >= 400) return null;
    let j;
    try { j = JSON.parse(r.text); } catch (e) { return null; }
    if (j.status !== 200) return null;
    let res = j.result;
    if (typeof res === "string") { try { res = JSON.parse(res); } catch (e) {} }
    return res;
  });
}

function onSettings() { return []; }

function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const tmdbDetails = yield getTmdbDetails(tmdbId, type);
    if (!tmdbDetails) throw new Error("VidFast: TMDB fetch failed");

    const isMovie = type === "movie";
    const pageUrl = isMovie
      ? "https://vidfast.io/movie/" + tmdbId
      : "https://vidfast.io/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1);

    const html = yield fetchText(pageUrl);
    if (!html) throw new Error("VidFast: page fetch failed");

    const tokenMatch = html.match(/\\"(?:en|token)\\":\\"([^"\\]+)\\"/);
    if (!tokenMatch) throw new Error("VidFast: token regex miss (len=" + html.length + ")");
    const pageToken = tokenMatch[1];

    // === Stage 1: get CSRF token ===
    const stage1Text = yield fetchText(
      "https://enc-dec.app/api/enc-vidfast?text=" + encodeURIComponent(pageToken) + "&stage=1"
    );
    if (!stage1Text) throw new Error("VidFast: stage 1 fetch failed");
    let stage1;
    try { stage1 = JSON.parse(stage1Text); } catch (e) { throw new Error("VidFast: stage1 not JSON"); }
    if (stage1.status !== 200 || !stage1.result) {
      throw new Error("VidFast: stage1 status=" + stage1.status);
    }
    const csrfToken = stage1.result.token;

    // === Stage 2: get servers + stream base URLs ===
    const stage2Text = yield fetchText(
      "https://enc-dec.app/api/enc-vidfast?text=" + encodeURIComponent(pageToken) + "&stage=2"
    );
    if (!stage2Text) throw new Error("VidFast: stage 2 fetch failed");
    let stage2;
    try { stage2 = JSON.parse(stage2Text); } catch (e) { throw new Error("VidFast: stage2 not JSON"); }
    if (stage2.status !== 200 || !stage2.result) {
      throw new Error("VidFast: stage2 status=" + stage2.status);
    }
    const serversUrl = stage2.result.servers;
    const streamBase = stage2.result.stream;
    if (!serversUrl || !streamBase) throw new Error("VidFast: stage2 missing urls");

    const apiHeaders = {
      "Referer": "https://vidfast.io/",
      "User-Agent": USER_AGENT
    };
    if (csrfToken) apiHeaders["X-CSRF-Token"] = csrfToken;

    // === Fetch encrypted server list ===
    const encServers = yield fetchText(serversUrl, { method: "POST", headers: apiHeaders, body: "" });
    if (!encServers) throw new Error("VidFast: servers fetch failed");

    const servers = yield encDecDecrypt(encServers);
    if (!Array.isArray(servers) || !servers.length) {
      throw new Error("VidFast: server list not array or empty");
    }

    // === Iterate servers for a playable URL ===
    for (let i = 0; i < servers.length; i++) {
      const item = servers[i];
      if (!item || !item.data) continue;
      const url = streamBase + "/" + item.data;
      const encSource = yield fetchText(url, { method: "POST", headers: apiHeaders, body: "" });
      if (!encSource) continue;
      const source = yield encDecDecrypt(encSource);
      if (!source || typeof source !== "object") continue;
      const streamUrl = source.url;
      if (!streamUrl) continue;

      const seSuffix = !isMovie && season && episode
        ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
        : "";
      const titleLine = tmdbDetails.title + " (" + tmdbDetails.year + ")" + seSuffix;
      const isDash = streamUrl.indexOf(".mpd") >= 0;
      const tagLine = "VidFast • " + (isDash ? "DASH" : "HLS") + " • H.264";
      const description = [titleLine, tagLine].join("\n");

      const subtitles = Array.isArray(source.tracks)
        ? source.tracks.filter((t) => t && (t.file || t.url))
            .map((t) => ({ language: t.label || t.language || "Subtitle", url: t.file || t.url }))
        : [];

      return [{
        name: "VidFast",
        title: description,
        size: description,
        description: description,
        url: streamUrl,
        headers: apiHeaders,
        subtitles: subtitles,
        behaviorHints: { bingeGroup: "vidfast-" + (isDash ? "dash" : "hls") }
      }];
    }

    throw new Error("VidFast: no playable server among " + servers.length);
  });
}

module.exports = { getStreams, onSettings };
