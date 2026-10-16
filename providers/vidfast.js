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
// SETTINGS — clean labels, ordered from best to worst quality
// ============================================================
function onSettings() {
  return [
    { type: "toggle", key: "auto",  name: "auto",  label: "Auto",  default: true  },
    { type: "toggle", key: "q2160", name: "q2160", label: "2160p", default: false },
    { type: "toggle", key: "q1440", name: "q1440", label: "1440p", default: false },
    { type: "toggle", key: "q1080", name: "q1080", label: "1080p", default: true  },
    { type: "toggle", key: "q720",  name: "q720",  label: "720p",  default: false },
    { type: "toggle", key: "q480",  name: "q480",  label: "480p",  default: false }
  ];
}

function resolveSettings(input) {
  const out = { auto: true, q2160: false, q1440: false, q1080: true, q720: false, q480: false };
  try {
    let s = input;
    if (!s && typeof globalThis !== "undefined") s = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!s && typeof global !== "undefined") s = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!s && typeof window !== "undefined") s = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (!s) return out;

    const keys = ["auto", "q2160", "q1440", "q1080", "q720", "q480"];
    const present = keys.filter(function (k) { return s[k] !== undefined; });
    if (!present.length) return out;

    keys.forEach(function (k) {
      let v = s[k];
      if (typeof v === "object" && v !== null) v = v.value !== undefined ? v.value : v.key;
      if (v === true || v === "true" || v === "on" || v === "yes" || v === 1 || v === "1") out[k] = true;
      else if (v === false || v === "false" || v === "off" || v === "no" || v === 0 || v === "0") out[k] = false;
    });

    if (!out.auto && !out.q2160 && !out.q1440 && !out.q1080 && !out.q720 && !out.q480) out.auto = true;
  } catch (e) { console.log("[VidFast] settings parse: " + e.message); }
  return out;
}

// ============================================================
// HELPERS
// ============================================================
function parseHlsVariants(masterUrl, text) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;

    const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
    const height = resMatch ? parseInt(resMatch[1]) : 0;

    const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
    const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;

    let codec = "";
    const codecMatch = line.match(/CODECS="([^"]+)"/i);
    if (codecMatch) {
      const c = codecMatch[1].toLowerCase();
      if (c.indexOf("avc") >= 0) codec = "H.264";
      else if (c.indexOf("hev1") >= 0 || c.indexOf("hvc1") >= 0) codec = "H.265";
      else if (c.indexOf("av01") >= 0) codec = "AV1";
      else if (c.indexOf("vp9") >= 0) codec = "VP9";
    }

    let uri = null;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (l && l.charAt(0) !== "#") { uri = l; break; }
    }
    if (!uri) continue;

    let absolute;
    if (uri.indexOf("http") === 0) absolute = uri;
    else {
      const slash = masterUrl.lastIndexOf("/");
      const base = slash >= 0 ? masterUrl.substring(0, slash + 1) : masterUrl;
      if (uri.charAt(0) === "/") {
        try { absolute = new URL(uri, masterUrl).toString(); }
        catch (e) { absolute = base + uri.replace(/^\//, ""); }
      } else absolute = base + uri;
    }

    variants.push({ height: height, bandwidth: bandwidth, codec: codec, url: absolute });
  }
  variants.sort(function (a, b) {
    if (b.bandwidth !== a.bandwidth) return b.bandwidth - a.bandwidth;
    return b.height - a.height;
  });
  return variants;
}

// Bucket a real playlist height into a toggle tier.
// Real height is preserved for the label — boundaries only decide
// which toggle controls it.
function tierOf(height) {
  if (height >= 1900) return "q2160";  // 2160p, 2140p, 2000p
  if (height >= 1200) return "q1440";  // 1600p, 1440p, 1280p
  if (height >= 900)  return "q1080";  // 1080p, 1050p, 900p
  if (height >= 600)  return "q720";   // 720p, 704p, 640p
  if (height >= 400)  return "q480";   // 480p, 426p, 400p
  return null;
}

function cleanDesc(desc) {
  if (!desc) return "";
  return String(desc).replace(/,\s*4K\?/i, "").replace(/\s*4K\?\s*$/i, "").trim();
}

// Rank for sorting: Auto first, then quality tiers high→low
function rankOf(tier) {
  if (tier === "auto")  return 0;
  if (tier === "q2160") return 1;
  if (tier === "q1440") return 2;
  if (tier === "q1080") return 3;
  if (tier === "q720")  return 4;
  if (tier === "q480")  return 5;
  return 9;
}

// Invisible Unicode Variation Selector prefixes — force Nuvio to keep
// our order regardless of what its own sorter does. Same technique the
// 4KHDHub scraper uses.
function invisiblePrefix(index) {
  if (index < 16)  return String.fromCodePoint(0xFE00 + index);          // VS1..VS16
  if (index < 256) return String.fromCodePoint(0xE0100 + (index - 16));  // VS17..VS256
  return "";
}

// ============================================================
// MAIN
// ============================================================
function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const resolved = resolveSettings(settings);
    console.log("[VidFast] auto=" + resolved.auto + " 2160=" + resolved.q2160 + " 1440=" + resolved.q1440 + " 1080=" + resolved.q1080 + " 720=" + resolved.q720 + " 480=" + resolved.q480);

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

    const s1Resp = yield req(API + "/enc-vidfast?text=" + encodeURIComponent(pageToken) + "&stage=1");
    if (s1Resp.status < 200 || s1Resp.status >= 400) { console.log("[VidFast] Stage1 HTTP " + s1Resp.status); return []; }
    let s1; try { s1 = JSON.parse(s1Resp.text); } catch (e) { return []; }
    if (s1.status !== 200 || !s1.result) { console.log("[VidFast] Stage1 status " + s1.status); return []; }
    const stage1Url = s1.result.stage1;
    const csrf1 = s1.result.token;

    const stageHeaders = {
      "Referer": "https://vidfast.vc/",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-Token": csrf1
    };
    const s1Post = yield req(stage1Url, { method: "POST", headers: stageHeaders });
    if (s1Post.status < 200 || s1Post.status >= 400) { console.log("[VidFast] Stage1-POST HTTP " + s1Post.status); return []; }
    const stageText = s1Post.text.trim();
    if (!stageText) { console.log("[VidFast] Stage1-POST empty"); return []; }

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
      const serverDesc = cleanDesc(item.description);

      const subs = Array.isArray(decoded.tracks)
        ? decoded.tracks.filter(function (t) { return t && t.file; }).map(function (t) { return { language: t.label || "Subtitle", url: t.file }; })
        : [];

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

      if (resolved.auto) {
        entries.push({ label: "Auto", url: decoded.url, codec: "", rank: rankOf("auto") });
      }

      if (isHls && variants.length) {
        for (let k = 0; k < variants.length; k++) {
          const v = variants[k];
          const tier = tierOf(v.height);
          if (!tier || !resolved[tier]) continue;
          const label = v.height ? (v.height + "p") : ("Q" + (k + 1));
          entries.push({ label: label, url: v.url, codec: v.codec, rank: rankOf(tier) });
        }
      }

      // If nothing matched the user's toggles, skip this server entirely
      if (!entries.length) {
        console.log("[VidFast] Skipping " + serverName + " — no matching qualities");
        continue;
      }

      for (let k = 0; k < entries.length; k++) {
        const e = entries[k];

        const tagParts = [serverName, e.label];
        if (e.codec) tagParts.push(e.codec);
        if (serverDesc) tagParts.push(serverDesc);
        const tagLine = tagParts.join(" • ");

        streams.push({
          name: serverName + " " + e.label,
          title: [titleLine, tagLine].join("\n"),
          size: [titleLine, tagLine].join("\n"),
          description: [titleLine, tagLine].join("\n"),
          url: e.url,
          headers: streamHeaders,
          subtitles: subs,
          behaviorHints: { bingeGroup: "vidfast-" + serverName + "-" + e.label },
          __rank: e.rank
        });
      }
    }

    // Sort by quality tier — Auto first, then 2160p, 1440p, 1080p, 720p, 480p.
    // Stable sort keeps servers in original order within each tier.
    streams.sort(function (a, b) { return a.__rank - b.__rank; });

    // Apply invisible Unicode prefixes so Nuvio's own sorter can't reorder them.
    for (let i = 0; i < streams.length; i++) {
      streams[i].name = invisiblePrefix(i) + streams[i].name;
      delete streams[i].__rank;
    }

    console.log("[VidFast] " + streams.length + " streams emitted");
    return streams;
  });
}

module.exports = { getStreams, onSettings };
