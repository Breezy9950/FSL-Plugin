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

function onSettings() { return []; }

function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const tmdbDetails = yield getTmdbDetails(tmdbId, type);
    if (!tmdbDetails) throw new Error("VidFast: TMDB fetch failed");

    const isMovie = type === "movie";
    const pageUrl = isMovie
      ? "https://vidfast.io/movie/" + tmdbId
      : "https://vidfast.io/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1);

    const pageResp = yield fetchRaw(pageUrl);
    if (pageResp.status < 200 || pageResp.status >= 400) {
      throw new Error("VidFast: page HTTP " + pageResp.status);
    }
    const html = pageResp.text;

    const escapedMatch = html.match(/\\"(?:en|token)\\":\\"([^"\\]+)\\"/);
    const plainMatch   = html.match(/"(?:en|token)":"([^"\\]{20,})"/);

    if (!escapedMatch && !plainMatch) {
      throw new Error("VidFast: no token regex match. len=" + html.length
        + " hasNext=" + (html.indexOf("__NEXT_DATA__") >= 0)
        + " head=" + html.substring(0, 400).replace(/\s+/g, " "));
    }

    const pageToken = escapedMatch ? escapedMatch[1] : plainMatch[1];

    // === Try GET first (matches Kotlin source) ===
    const getUrl = "https://enc-dec.app/api/enc-vidfast?text=" + encodeURIComponent(pageToken);
    const getResp = yield fetchRaw(getUrl);

    if (getResp.status >= 200 && getResp.status < 400) {
      // GET worked — proceed as before
      return yield runHandshake(getResp.text, tmdbDetails, isMovie, season, episode, tmdbId);
    }

    // === GET failed — try POST fallback ===
    const postResp = yield fetchRaw("https://enc-dec.app/api/enc-vidfast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pageToken })
    });

    if (postResp.status >= 200 && postResp.status < 400) {
      return yield runHandshake(postResp.text, tmdbDetails, isMovie, season, episode, tmdbId);
    }

    // === Both failed — throw everything we know ===
    throw new Error(
      "VidFast enc-dec rejected. " +
      "GET.status=" + getResp.status + " " +
      "GET.body=" + getResp.text.substring(0, 180) + " | " +
      "POST.status=" + postResp.status + " " +
      "POST.body=" + postResp.text.substring(0, 180) + " | " +
      "tokenLen=" + pageToken.length + " " +
      "tokenHead=" + pageToken.substring(0, 60)
    );
  });
}

function runHandshake(handshakeBody, tmdbDetails, isMovie, season, episode, tmdbId) {
  return __async(this, null, function* () {
    let handshake;
    try { handshake = JSON.parse(handshakeBody); }
    catch (e) { throw new Error("VidFast: handshake not JSON: " + handshakeBody.substring(0, 200)); }

    if (handshake.status !== 200) {
      throw new Error("VidFast: handshake status=" + handshake.status + " body=" + handshakeBody.substring(0, 200));
    }
    const boot = handshake.result;
    if (!boot) throw new Error("VidFast: handshake result missing: " + handshakeBody.substring(0, 200));

    const serversUrl = boot.servers;
    const streamBase = boot.stream;
    if (!serversUrl || !streamBase) {
      throw new Error("VidFast: handshake keys=" + Object.keys(boot).join(","));
    }

    const apiHeaders = { "Referer": "https://vidfast.io/", "User-Agent": USER_AGENT };
    if (boot.token) apiHeaders["X-CSRF-Token"] = boot.token;

    const encServersResp = yield fetchRaw(serversUrl, { method: "POST", headers: apiHeaders, body: "" });
    if (encServersResp.status < 200 || encServersResp.status >= 400) {
      throw new Error("VidFast: servers HTTP " + encServersResp.status + " url=" + serversUrl);
    }

    const decResp = yield fetchRaw("https://enc-dec.app/api/dec-vidfast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: encServersResp.text })
    });
    if (decResp.status < 200 || decResp.status >= 400) {
      throw new Error("VidFast: dec-vidfast HTTP " + decResp.status + " body=" + decResp.text.substring(0, 180));
    }

    let decJson;
    try { decJson = JSON.parse(decResp.text); }
    catch (e) { throw new Error("VidFast: dec-vidfast not JSON: " + decResp.text.substring(0, 200)); }

    if (decJson.status !== 200) {
      throw new Error("VidFast: dec-vidfast status=" + decJson.status + " body=" + decResp.text.substring(0, 200));
    }

    let servers = decJson.result;
    if (typeof servers === "string") { try { servers = JSON.parse(servers); } catch (e) {} }
    if (!Array.isArray(servers)) {
      throw new Error("VidFast: servers not array, type=" + typeof servers + " val=" + JSON.stringify(servers).substring(0, 200));
    }
    if (!servers.length) throw new Error("VidFast: servers empty");

    for (let i = 0; i < servers.length; i++) {
      const item = servers[i];
      if (!item || !item.data) continue;
      const url = streamBase + "/" + item.data;
      const encSourceResp = yield fetchRaw(url, { method: "POST", headers: apiHeaders, body: "" });
      if (encSourceResp.status < 200 || encSourceResp.status >= 400) continue;

      const srcDecResp = yield fetchRaw("https://enc-dec.app/api/dec-vidfast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: encSourceResp.text })
      });
      if (srcDecResp.status < 200 || srcDecResp.status >= 400) continue;

      let srcJson;
      try { srcJson = JSON.parse(srcDecResp.text); }
      catch (e) { continue; }
      if (srcJson.status !== 200) continue;

      let source = srcJson.result;
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
