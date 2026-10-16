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
    try { const r = yield fetch(url); const d = yield r.json();
      return isSeries
        ? { title: d.name, year: d.first_air_date ? parseInt(d.first_air_date.split("-")[0]) : 0 }
        : { title: d.title, year: d.release_date ? parseInt(d.release_date.split("-")[0]) : 0 };
    } catch (e) { return null; }
  });
}

function decryptEncDec(encrypted) {
  return __async(this, null, function* () {
    const r = yield req(API + "/dec-vidfast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: encrypted })
    });
    if (r.status < 200 || r.status >= 400) {
      throw new Error("dec-vidfast HTTP " + r.status + " body=" + r.text.substring(0, 150));
    }
    let j;
    try { j = JSON.parse(r.text); } catch (e) {
      throw new Error("dec-vidfast not JSON: " + r.text.substring(0, 150));
    }
    if (j.status !== 200) {
      throw new Error("dec-vidfast status=" + j.status + " error=" + (j.error || "unknown"));
    }
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
      ? "https://vidfast.vc/movie/" + tmdbId + "/"
      : "https://vidfast.vc/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1) + "/";

    const page = yield req(pageUrl);
    if (page.status < 200 || page.status >= 400) throw new Error("VidFast: page HTTP " + page.status);

    const tokenMatch = page.text.match(/\\"(?:en|token)\\":\\"([^"\\]+)\\"/);
    if (!tokenMatch) throw new Error("VidFast: page token not found (len=" + page.text.length + ")");
    const pageToken = tokenMatch[1];

    // === STEP 1: stage 1 → get stage1 URL + CSRF1 ===
    const s1Resp = yield req(API + "/enc-vidfast?text=" + encodeURIComponent(pageToken) + "&stage=1");
    if (s1Resp.status < 200 || s1Resp.status >= 400) throw new Error("stage1 HTTP " + s1Resp.status);
    let s1;
    try { s1 = JSON.parse(s1Resp.text); } catch (e) { throw new Error("stage1 not JSON"); }
    if (s1.status !== 200 || !s1.result) throw new Error("stage1 status=" + s1.status);
    const stage1Url = s1.result.stage1;
    const csrf1 = s1.result.token;

    // === STEP 2: POST stage1 URL → encrypted text ===
    const stageHeaders = {
      "User-Agent": USER_AGENT,
      "Referer": "https://vidfast.vc/",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-Token": csrf1
    };
    const s1Post = yield req(stage1Url, { method: "POST", headers: stageHeaders });
    if (s1Post.status < 200 || s1Post.status >= 400) throw new Error("stage1-POST HTTP " + s1Post.status);
    const encryptedStageToken = s1Post.text.trim();
    if (!encryptedStageToken) throw new Error("stage1-POST returned empty");

    // === STEP 3: stage 2 with the encrypted text → servers/stream URLs + CSRF2 ===
    const s2Resp = yield req(API + "/enc-vidfast?text=" + encodeURIComponent(encryptedStageToken) + "&stage=2");
    if (s2Resp.status < 200 || s2Resp.status >= 400) throw new Error("stage2 HTTP " + s2Resp.status);
    let s2;
    try { s2 = JSON.parse(s2Resp.text); } catch (e) { throw new Error("stage2 not JSON"); }
    if (s2.status !== 200 || !s2.result) throw new Error("stage2 status=" + s2.status);
    const serversUrl = s2.result.servers;
    const streamBase = s2.result.stream;
    const csrf2 = s2.result.token;

    const apiHeaders = {
      "User-Agent": USER_AGENT,
      "Referer": "https://vidfast.vc/",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-Token": csrf2
    };

    // === STEP 4: POST servers URL → encrypted server list ===
    const srvResp = yield req(serversUrl, { method: "POST", headers: apiHeaders });
    if (srvResp.status < 200 || srvResp.status >= 400) throw new Error("servers HTTP " + srvResp.status + " body=" + srvResp.text.substring(0, 100));

    // === STEP 5: decrypt server list ===
    const servers = yield decryptEncDec(srvResp.text);
    if (!Array.isArray(servers) || !servers.length) {
      throw new Error("servers not array or empty (type=" + typeof servers + ")");
    }

    // === STEP 6: iterate servers, POST stream/{data} → decrypt → final URL ===
    for (let i = 0; i < servers.length; i++) {
      const item = servers[i];
      if (!item || !item.data) continue;
      const streamUrl = streamBase + "/" + item.data + "/";
      const streamResp = yield req(streamUrl, { method: "POST", headers: apiHeaders });
      if (streamResp.status < 200 || streamResp.status >= 400) continue;

      let decoded;
      try { decoded = yield decryptEncDec(streamResp.text); }
      catch (e) { continue; }
      if (!decoded || typeof decoded !== "object") continue;

      const finalUrl = decoded.url || decoded.file || decoded.stream;
      if (!finalUrl) continue;

      const seSuffix = !isMovie && season && episode
        ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
        : "";
      const titleLine = tmdbDetails.title + " (" + tmdbDetails.year + ")" + seSuffix;
      const isDash = finalUrl.indexOf(".mpd") >= 0;
      const tagLine = "VidFast • " + (isDash ? "DASH" : "HLS") + " • H.264";
      const description = [titleLine, tagLine].join("\n");

      const subtitles = Array.isArray(decoded.tracks)
        ? decoded.tracks.filter((t) => t && (t.file || t.url))
            .map((t) => ({ language: t.label || t.language || "Subtitle", url: t.file || t.url }))
        : [];

      return [{
        name: "VidFast",
        title: description,
        size: description,
        description: description,
        url: finalUrl,
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": "https://vidfast.vc/"
        },
        subtitles: subtitles,
        behaviorHints: { bingeGroup: "vidfast-" + (isDash ? "dash" : "hls") }
      }];
    }

    throw new Error("VidFast: no playable server among " + servers.length);
  });
}

module.exports = { getStreams, onSettings };
