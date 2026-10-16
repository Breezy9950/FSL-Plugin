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
    const response = yield fetch(url, {
      method: options.method || "GET",
      headers: Object.assign({ "User-Agent": USER_AGENT, "Accept": "*/*" }, options.headers || {}),
      body: options.body
    });
    const text = yield response.text();
    if (response.status < 200 || response.status >= 400) return null;
    return text;
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
      return null;
    }
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
    if (!html) throw new Error("VidFast: page fetch returned null");

    // === DIAGNOSTIC: find all plausible token patterns ===
    const escapedMatch = html.match(/\\"(?:en|token)\\":\\"([^"\\]+)\\"/);
    const plainMatch   = html.match(/"(?:en|token)":"([^"\\]{20,})"/);
    const nextData     = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]{0,500})/);
    const rscPush      = html.match(/self\.__next_f\.push\(\[1,\s*"([\s\S]{0,300})/);
    const tokenCount   = (html.match(/"token"/g) || []).length;
    const enCount      = (html.match(/"en"/g) || []).length;
    const encCount     = (html.match(/"enc"/g) || []).length;
    const hasNextData  = html.indexOf("__NEXT_DATA__") >= 0;
    const hasRscPush   = html.indexOf("self.__next_f") >= 0;
    const hasChakra    = html.indexOf("__chakra") >= 0;

    if (!escapedMatch && !plainMatch) {
      // Throw everything useful so the runtime log shows it
      throw new Error(
        "VidFast token parse failed. " +
        "len=" + html.length + " " +
        "nextData=" + hasNextData + " " +
        "rscPush=" + hasRscPush + " " +
        "chakra=" + hasChakra + " " +
        "tokenCount=" + tokenCount + " " +
        "enCount=" + enCount + " " +
        "encCount=" + encCount + " " +
        "head500=" + html.substring(0, 500).replace(/\s+/g, " ")
      );
    }

    const pageToken = escapedMatch ? escapedMatch[1] : plainMatch[1];
    console.log("[VidFast] Token: " + pageToken.substring(0, 40) + "...");

    // === Handshake ===
    const handshakeText = yield fetchText("https://enc-dec.app/api/enc-vidfast?text=" + encodeURIComponent(pageToken));
    if (!handshakeText) throw new Error("VidFast: enc-dec handshake fetch returned null");
    let handshake;
    try { handshake = JSON.parse(handshakeText); }
    catch (e) { throw new Error("VidFast: handshake not JSON: " + handshakeText.substring(0, 200)); }
    if (handshake.status !== 200) throw new Error("VidFast: handshake status=" + handshake.status);
    const boot = handshake.result;
    if (!boot) throw new Error("VidFast: handshake result missing");

    const serversUrl = boot.servers;
    const streamBase = boot.stream;
    if (!serversUrl || !streamBase) throw new Error("VidFast: handshake missing servers/stream");

    const apiHeaders = { "Referer": "https://vidfast.io/", "User-Agent": USER_AGENT };
    if (boot.token) apiHeaders["X-CSRF-Token"] = boot.token;

    // === Server list ===
    const encServers = yield fetchText(serversUrl, { method: "POST", headers: apiHeaders, body: "" });
    if (!encServers) throw new Error("VidFast: server-list fetch returned null");

    const decText = yield fetchText("https://enc-dec.app/api/dec-vidfast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: encServers })
    });
    if (!decText) throw new Error("VidFast: dec-vidfast returned null");

    let decResp;
    try { decResp = JSON.parse(decText); }
    catch (e) { throw new Error("VidFast: dec-vidfast not JSON: " + decText.substring(0, 200)); }
    if (decResp.status !== 200) throw new Error("VidFast: dec-vidfast status=" + decResp.status);

    let servers = decResp.result;
    if (typeof servers === "string") { try { servers = JSON.parse(servers); } catch (e) {} }
    if (!Array.isArray(servers)) throw new Error("VidFast: server list not array (type=" + typeof servers + ")");

    if (!servers.length) throw new Error("VidFast: server list empty");

    // === Iterate ===
    for (let i = 0; i < servers.length; i++) {
      const item = servers[i];
      if (!item || !item.data) continue;
      const url = streamBase + "/" + item.data;
      const encSource = yield fetchText(url, { method: "POST", headers: apiHeaders, body: "" });
      if (!encSource) continue;

      const srcText = yield fetchText("https://enc-dec.app/api/dec-vidfast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: encSource })
      });
      if (!srcText) continue;

      let srcResp;
      try { srcResp = JSON.parse(srcText); } catch (e) { continue; }
      if (srcResp.status !== 200) continue;

      let source = srcResp.result;
      if (typeof source === "string") { try { source = JSON.parse(source); } catch (e) {} }
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
