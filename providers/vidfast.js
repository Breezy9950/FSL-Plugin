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

// ============================================================
// SETTINGS
// ============================================================
function onSettings() {
  return [
    {
      type: "select",
      key: "mode",
      name: "mode",
      label: "Quality Mode",
      options: [
        { label: "Split qualities (one stream per quality — for stock Nuvio)", value: "split" },
        { label: "Auto only (single stream, use player's picker)", value: "auto" },
        { label: "Both (Auto + every quality)", value: "both" }
      ],
      default: "split"
    }
  ];
}

function resolveSettings(input) {
  const s = { mode: "split" };
  try {
    let settings = input;
    if (!settings && typeof globalThis !== "undefined") settings = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!settings && typeof global !== "undefined") settings = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!settings && typeof window !== "undefined") settings = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (settings) {
      let m = settings.mode || settings.qualityMode || settings.quality_mode || "";
      if (typeof m === "object" && m !== null) m = m.value || m.key || "";
      const norm = String(m).toLowerCase().trim();
      if (norm === "auto" || norm === "split" || norm === "both") s.mode = norm;
    }
  } catch (e) { console.log("[VidFast] settings parse error: " + e.message); }
  return s;
}

// ============================================================
// HLS MASTER PARSING
// ============================================================
function parseHlsVariants(masterUrl, text) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;

    // Resolution — pull exact height, no remapping
    const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
    const height = resMatch ? parseInt(resMatch[1]) : 0;

    // Bandwidth — bits per second
    const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
    const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;

    // Codec — for "H.264" style tags
    let codec = "";
    const codecMatch = line.match(/CODECS="([^"]+)"/i);
    if (codecMatch) {
      const c = codecMatch[1].toLowerCase();
      if (c.indexOf("avc") >= 0) codec = "H.264";
      else if (c.indexOf("hev1") >= 0 || c.indexOf("hvc1") >= 0) codec = "H.265";
      else if (c.indexOf("av01") >= 0) codec = "AV1";
      else if (c.indexOf("vp9") >= 0) codec = "VP9";
    }

    // URI on the next non-comment line
    let uri = null;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (l && l.charAt(0) !== "#") { uri = l; break; }
    }
    if (!uri) continue;

    let absolute;
    if (uri.indexOf("http") === 0) {
      absolute = uri;
    } else {
      const slash = masterUrl.lastIndexOf("/");
      const base = slash >= 0 ? masterUrl.substring(0, slash + 1) : masterUrl;
      if (uri.charAt(0) === "/") {
        try { absolute = new URL(uri, masterUrl).toString(); }
        catch (e) { absolute = base + uri.replace(/^\//, ""); }
      } else {
        absolute = base + uri;
      }
    }

    variants.push({ height: height, bandwidth: bandwidth, codec: codec, url: absolute });
  }
  // Sort high → low by bandwidth (fallback to height)
  variants.sort(function (a, b) {
    if (b.bandwidth !== a.bandwidth) return b.bandwidth - a.bandwidth;
    return b.height - a.height;
  });
  return variants;
}

function formatMbps(bps) {
  if (!bps) return "";
  return (bps / 1000000).toFixed(1) + " Mbps";
}

// ============================================================
// MAIN
// ============================================================
function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const resolved = resolveSettings(settings);
    console.log("[VidFast] Mode: " + resolved.mode);

    const tmdb = yield getTmdbDetails(tmdbId, type);
    if (!tmdb) return [];
    const isMovie = type === "movie";

    const pageUrl = isMovie
      ? "https://vidfast.vc/movie/" + tmdbId + "/"
      : "https://vidfast.vc/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1) + "/";

    const page = yield req(pageUrl);
    if (page.status < 200 || page.status >= 400) { console.log("[VidFast] Page HTTP " + page.status); return []; }

    const tokenMatch = page.text.match(/\\"(?:en|token)\\":\\"([^"\\]+)\\"/);
    if (!tokenMatch) { console.log("[VidFast] Page token not found"); return []; }
    const pageToken = tokenMatch[1];

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

    const seSuffix = !isMovie && season && episode
      ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
      : "";
    const titleLine = tmdb.title + " (" + tmdb.year + ")" + seSuffix;

    const streams = [];

    for (let i = 0; i < servers.length; i++) {
      const item = servers[i];
      if (!item || !item.data) continue;
      const url = streamBase + "/" + item.data;
      const enc = yield req(url, { method: "POST", headers: apiHeaders });
      if (enc.status < 200 || enc.status >= 400) continue;
      let decoded;
      try { decoded = yield decVidFast(enc.text); }
      catch (e) { continue; }
      if (!decoded || !decoded.url) continue;

      const streamHeaders = {
        "Referer": "https://vidfast.vc/",
        "User-Agent": USER_AGENT
      };
      const isDash = decoded.url.indexOf(".mpd") >= 0;
      const isHls = !isDash && decoded.url.indexOf(".m3u8") >= 0;
      const serverName = item.name || ("S" + (i + 1));
      const serverDesc = item.description || "";
      const is4k = !!decoded["4kAvailable"];

      const subs = Array.isArray(decoded.tracks)
        ? decoded.tracks.filter(function (t) { return t && t.file; }).map(function (t) { return { language: t.label || "Subtitle", url: t.file }; })
        : [];

      // Parse the master playlist to see actual variants
      let variants = [];
      if (isHls) {
        try {
          const mResp = yield req(decoded.url, { headers: streamHeaders });
          if (mResp.status >= 200 && mResp.status < 400 && mResp.text.indexOf("#EXTM3U") === 0) {
            variants = parseHlsVariants(decoded.url, mResp.text);
          }
        } catch (e) { console.log("[VidFast] master parse failed on " + serverName + ": " + e.message); }
      }

      const entries = [];

      if (isDash) {
        // DASH: no split possible, emit as-is
        entries.push({ label: "DASH", detail: "", url: decoded.url });
      } else if (!isHls || !variants.length) {
        // Single-quality HLS (no variants) or non-m3u8: emit as-is
        entries.push({ label: "Auto", detail: "", url: decoded.url });
      } else {
        // Multi-variant HLS
        if (resolved.mode === "auto" || resolved.mode === "both") {
          entries.push({ label: "Auto", detail: "", url: decoded.url });
        }
        if (resolved.mode === "split" || resolved.mode === "both") {
          for (let k = 0; k < variants.length; k++) {
            const v = variants[k];
            const label = v.height ? (v.height + "p") : ("Q" + (k + 1));
            const detailParts = [];
            if (v.codec) detailParts.push(v.codec);
            if (v.bandwidth) detailParts.push(formatMbps(v.bandwidth));
            entries.push({ label: label, detail: detailParts.join(" · "), url: v.url });
          }
        }
      }

      for (let k = 0; k < entries.length; k++) {
        const e = entries[k];
        const tagParts = ["VidFast", serverName, e.label];
        if (e.detail) tagParts.push(e.detail);
        if (is4k) tagParts.push("4K Available");
        if (serverDesc) tagParts.push(serverDesc);
        const tagLine = tagParts.join(" • ");

        streams.push({
          name: "VidFast " + serverName + " " + e.label,
          title: [titleLine, tagLine].join("\n"),
          size: [titleLine, tagLine].join("\n"),
          description: [titleLine, tagLine].join("\n"),
          url: e.url,
          headers: streamHeaders,
          subtitles: subs,
          behaviorHints: { bingeGroup: "vidfast-" + serverName }
        });
      }
    }

    console.log("[VidFast] " + streams.length + " streams emitted");
    return streams;
  });
}

module.exports = { getStreams, onSettings };
