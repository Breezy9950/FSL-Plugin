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
var API = "https://enc-dec.app/api";

function req(_0) {
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
    try {
      const r = yield fetch(url);
      const d = yield r.json();
      if (isSeries) return { title: d.name, year: d.first_air_date ? parseInt(d.first_air_date.split("-")[0]) : 0 };
      return { title: d.title, year: d.release_date ? parseInt(d.release_date.split("-")[0]) : 0 };
    } catch (e) { return null; }
  });
}

function decVidFast(encrypted) {
  return __async(this, null, function* () {
    const r = yield req(API + "/dec-vidfast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: encrypted })
    });
    if (r.status < 200 || r.status >= 400) throw new Error("dec-vidfast HTTP " + r.status);
    let j;
    try { j = JSON.parse(r.text); } catch (e) { throw new Error("dec-vidfast not JSON"); }
    if (j.status !== 200) throw new Error("dec-vidfast status=" + j.status + " " + (j.error || ""));
    let res = j.result;
    if (typeof res === "string") { try { res = JSON.parse(res); } catch (e) {} }
    return res;
  });
}

function onSettings() { return []; }

function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const tmdb = yield getTmdbDetails(tmdbId, type);
    if (!tmdb) return [];
    const isMovie = type === "movie";

    const pageUrl = isMovie
      ? "https://vidfast.vc/movie/" + tmdbId + "/"
      : "https://vidfast.vc/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1) + "/";

    console.log("[VidFast] Page: " + pageUrl);
    const page = yield req(pageUrl);
    if (page.status < 200 || page.status >= 400) { console.log("[VidFast] Page HTTP " + page.status); return []; }

    const tokenMatch = page.text.match(/\\"(?:en|token)\\":\\"([^"\\]+)\\"/);
    if (!tokenMatch) { console.log("[VidFast] Page token not found"); return []; }
    const pageToken = tokenMatch[1];
    console.log("[VidFast] Page token: " + pageToken.substring(0, 30) + "...");

    // === Stage 1 ===
    const s1Resp = yield req(API + "/enc-vidfast?text=" + encodeURIComponent(pageToken) + "&stage=1");
    if (s1Resp.status < 200 || s1Resp.status >= 400) { console.log("[VidFast] Stage1 HTTP " + s1Resp.status); return []; }
    let s1; try { s1 = JSON.parse(s1Resp.text); } catch (e) { return []; }
    if (s1.status !== 200 || !s1.result) { console.log("[VidFast] Stage1 status " + s1.status); return []; }
    const stage1Url = s1.result.stage1;
    const csrf1 = s1.result.token;

    // === POST stage1 URL ===
    const stageHeaders = {
      "Referer": "https://vidfast.vc/",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-Token": csrf1
    };
    const s1Post = yield req(stage1Url, { method: "POST", headers: stageHeaders });
    if (s1Post.status < 200 || s1Post.status >= 400) { console.log("[VidFast] Stage1-POST HTTP " + s1Post.status); return []; }
    const stageText = s1Post.text.trim();
    if (!stageText) { console.log("[VidFast] Stage1-POST empty"); return []; }

    // === Stage 2 ===
    const s2Resp = yield req(API + "/enc-vidfast?text=" + encodeURIComponent(stageText) + "&stage=2");
    if (s2Resp.status < 200 || s2Resp.status >= 400) { console.log("[VidFast] Stage2 HTTP " + s2Resp.status); return []; }
    let s2; try { s2 = JSON.parse(s2Resp.text); } catch (e) { return []; }
    if (s2.status !== 200 || !s2.result) { console.log("[VidFast] Stage2 status " + s2.status); return []; }
    const serversUrl = s2.result.servers;
    const streamBase = s2.result.stream;
    const csrf2 = s2.result.token;

    const apiHeaders = {
      "Referer": "https://vidfast.vc/",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-Token": csrf2
    };

    // === Server list ===
    const srvResp = yield req(serversUrl, { method: "POST", headers: apiHeaders });
    if (srvResp.status < 200 || srvResp.status >= 400) { console.log("[VidFast] Servers HTTP " + srvResp.status); return []; }
    let servers;
    try { servers = yield decVidFast(srvResp.text); }
    catch (e) { console.log("[VidFast] Server decrypt: " + e.message); return []; }
    if (!Array.isArray(servers) || !servers.length) { console.log("[VidFast] Empty server list"); return []; }
    console.log("[VidFast] " + servers.length + " servers");

    // === Iterate servers, decode each ===
    const seSuffix = !isMovie && season && episode
      ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
      : "";
    const titleLine = tmdb.title + " (" + tmdb.year + ")" + seSuffix;

    const streams = [];
    for (let i = 0; i < servers.length; i++) {
      const item = servers[i];
      if (!item || !item.data) continue;
      const url = streamBase + "/" + item.data;   // NOTE: no trailing slash
      const enc = yield req(url, { method: "POST", headers: apiHeaders });
      if (enc.status < 200 || enc.status >= 400) continue;
      let decoded;
      try { decoded = yield decVidFast(enc.text); }
      catch (e) { continue; }
      if (!decoded || !decoded.url) continue;

      const isDash = decoded.url.indexOf(".mpd") >= 0;
      const tagParts = ["VidFast"];
      if (item.name) tagParts.push(item.name);
      tagParts.push(isDash ? "DASH" : "HLS");
      if (decoded["4kAvailable"]) tagParts.push("4K");
      if (item.description) tagParts.push(item.description);
      const tagLine = tagParts.join(" • ");

      const subs = Array.isArray(decoded.tracks)
        ? decoded.tracks.filter((t) => t && t.file).map((t) => ({ language: t.label || "Subtitle", url: t.file }))
        : [];

      streams.push({
        name: "VidFast" + (item.name ? " " + item.name : ""),
        title: [titleLine, tagLine].join("\n"),
        size: [titleLine, tagLine].join("\n"),
        description: [titleLine, tagLine].join("\n"),
        url: decoded.url,
        headers: {
          "Referer": "https://vidfast.vc/",
          "User-Agent": USER_AGENT
        },
        subtitles: subs,
        behaviorHints: { bingeGroup: "vidfast-" + (item.name || i) }
      });
    }

    console.log("[VidFast] " + streams.length + " playable streams");
    return streams;
  });
}

module.exports = { getStreams, onSettings };
