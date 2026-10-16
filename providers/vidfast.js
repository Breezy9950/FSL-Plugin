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
    const delay   = options.delay   !== void 0 ? options.delay   : 1000;
    for (let i = 0; i <= retries; i++) {
      try {
        const response = yield fetch(url, {
          method: options.method || "GET",
          headers: Object.assign({ "User-Agent": USER_AGENT, "Accept": "*/*" }, options.headers || {}),
          body: options.body
        });
        const text = yield response.text();
        console.log("[VidFast] HTTP " + response.status + " " + options.method + " " + url + " (len=" + text.length + ")");
        if (response.status < 200 || response.status >= 400) return null;
        return text;
      } catch (err) {
        console.log("[VidFast] Request failed for " + url + ": " + err.message + (i < retries ? ", retrying (" + (i + 1) + "/" + retries + ")..." : ""));
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
      console.log("[VidFast] TMDB request failed: " + error.message);
      return null;
    }
  });
}

// enc-dec.app helper — decrypts and returns JSONObject, JSONArray, or raw string
function encDecDecrypt(encrypted) {
  return __async(this, null, function* () {
    const body = JSON.stringify({ text: encrypted });
    const respText = yield fetchText("https://enc-dec.app/api/dec-vidfast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body
    });
    if (!respText) return null;
    let resp;
    try { resp = JSON.parse(respText); } catch (e) { return null; }
    if (resp.status !== 200) { console.log("[VidFast] enc-dec decrypt status=" + resp.status); return null; }
    const result = resp.result;
    if (result === undefined || result === null) return null;
    if (typeof result !== "string") return result;
    try { return JSON.parse(result); } catch (e) { return result; }
  });
}

function onSettings() { return []; }

function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const tmdbDetails = yield getTmdbDetails(tmdbId, type);
    if (!tmdbDetails) return [];
    const { title, year } = tmdbDetails;
    const isSeries = type === "series" || type === "tv";
    const isMovie = type === "movie";

    const pageUrl = isMovie
      ? "https://vidfast.io/movie/" + tmdbId
      : "https://vidfast.io/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1);

    console.log("[VidFast] Page: " + pageUrl);
    const html = yield fetchText(pageUrl);
    if (!html) { console.log("[VidFast] Page fetch failed"); return []; }

    // Step 1: pull the page token — try escaped-JSON form first, then plain
    let pageToken =
      (html.match(/\\"(?:en|token)\\":"([^"\\]+)\\"/) || [])[1] ||
      (html.match(/"(?:en|token)":"([^"\\]{20,})"/) || [])[1];
    if (!pageToken) { console.log("[VidFast] Page token not found"); return []; }
    console.log("[VidFast] Page token: " + pageToken.substring(0, 40) + "...");

    // Step 2: enc-dec handshake
    const handshakeText = yield fetchText("https://enc-dec.app/api/enc-vidfast?text=" + encodeURIComponent(pageToken));
    if (!handshakeText) { console.log("[VidFast] Handshake fetch failed"); return []; }
    let handshake;
    try { handshake = JSON.parse(handshakeText); }
    catch (e) { console.log("[VidFast] Handshake not JSON: " + handshakeText.substring(0, 200)); return []; }
    if (handshake.status !== 200) { console.log("[VidFast] Handshake status=" + handshake.status); return []; }
    const boot = handshake.result;
    if (!boot) { console.log("[VidFast] Handshake result missing"); return []; }

    const serversUrl = boot.servers;
    const streamBase = boot.stream;
    if (!serversUrl || !streamBase) { console.log("[VidFast] Handshake missing servers/stream"); return []; }
    console.log("[VidFast] servers=" + serversUrl + " streamBase=" + streamBase);

    const apiHeaders = { "Referer": "https://vidfast.io/", "User-Agent": USER_AGENT };
    if (boot.token) apiHeaders["X-CSRF-Token"] = boot.token;

    // Step 3: fetch encrypted server list (empty POST body)
    const encServers = yield fetchText(serversUrl, { method: "POST", headers: apiHeaders, body: "" });
    if (!encServers) { console.log("[VidFast] Server-list fetch failed"); return []; }

    const servers = yield encDecDecrypt(encServers);
    if (!Array.isArray(servers)) { console.log("[VidFast] Server list decrypt failed"); return []; }
    console.log("[VidFast] Servers: " + servers.length);

    // Step 4: iterate servers, POST streamBase/{data}, decrypt
    let playable = null;
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
      playable = { url: streamUrl, source: source };
      console.log("[VidFast] Playable from server " + i + ": " + streamUrl);
      break;
    }

    if (!playable) { console.log("[VidFast] No playable server"); return []; }

    const subtitles = Array.isArray(playable.source.tracks)
      ? playable.source.tracks
          .filter((t) => t && (t.file || t.url))
          .map((t) => ({ language: t.label || t.language || "Subtitle", url: t.file || t.url }))
      : [];

    // ---- Description — same multi-line format as 4KHDHub ----
    const seSuffix = isSeries && season && episode
      ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
      : "";
    const titleLine = title + " (" + year + ")" + seSuffix;

    const isDash = playable.url.indexOf(".mpd") >= 0;
    const tagParts = ["VidFast"];
    tagParts.push(isDash ? "DASH" : "HLS");
    tagParts.push("H.264");
    if (subtitles.length) tagParts.push(subtitles.length + " Subs");
    const tagLine = tagParts.join(" • ");

    const lines = [titleLine];
    if (tagLine) lines.push(tagLine);
    const description = lines.join("\n");

    return [{
      name: "VidFast",
      title: description,
      size: description,
      description: description,
      url: playable.url,
      headers: apiHeaders,
      subtitles: subtitles,
      behaviorHints: { bingeGroup: "vidfast-" + (isDash ? "dash" : "hls") }
    }];
  });
}

module.exports = { getStreams, onSettings };
