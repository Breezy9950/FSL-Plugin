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
          headers: Object.assign({ "User-Agent": USER_AGENT, "Accept": "*/*" }, options.headers || {})
        });
        const text = yield response.text();
        console.log("[Videasy] HTTP " + response.status + " " + url + " (len=" + text.length + ")");
        if (response.status < 200 || response.status >= 400) return null;
        return text;
      } catch (err) {
        console.log("[Videasy] Request failed for " + url + ": " + err.message + (i < retries ? ", retrying (" + (i + 1) + "/" + retries + ")..." : ""));
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
      console.log("[Videasy] TMDB request failed: " + error.message);
      return null;
    }
  });
}

// ============================================================
// Videasy keystream — pure JS port of the Kotlin implementation
// ============================================================
function mix(v) {
  v = v | 0;
  v = (v ^ (v >>> 16)) | 0;
  v = Math.imul(v, -2048144789) | 0;
  v = (v ^ (v >>> 13)) | 0;
  v = Math.imul(v, -1028477387) | 0;
  return (v ^ (v >>> 16)) | 0;
}
function rotl(x, n) { n &= 31; return ((x << n) | (x >>> (32 - n))) | 0; }
function fnv(str) {
  let h = -2128831035 | 0;
  for (let i = 0; i < str.length; i++) h = Math.imul((h ^ str.charCodeAt(i)) | 0, 16777619) | 0;
  return mix(h);
}
function keyStream(seed, mediaId, length) {
  const table = new Array(61).fill(0);
  const present = new Array(61).fill(false);
  const golden = -1640531527 | 0;
  let state = mix(fnv(seed) ^ mix((mediaId ^ golden) | 0));
  for (let round = 0; round < 8; round++) {
    const index = (state >>> 0) % 61;
    state = rotl((state + golden) | 0, 7 + (7 & round));
    table[index] = (state ^ mix(state)) | 0;
    present[index] = true;
    state = mix((state + index) | 0);
  }
  let acc = mix((-1515870811 ^ state) | 0);
  const out = new Uint8Array(length);
  let pos = 0, counter = 0;
  while (pos < length) {
    const index = (acc >>> 0) % 61;
    const value = present[index] ? table[index] : 0;
    const mixed = (value ^ Math.imul(golden, counter + 1)) | 0;
    let next = (acc ^ mixed) | 0;
    next = (rotl((next + acc) | 0, index & 31) ^ rotl(acc, Math.imul(index, 7) & 31)) | 0;
    acc = mix((next + golden) | 0);
    table[index] = acc;
    present[index] = true;
    for (let shift = 0; shift <= 24; shift += 8) {
      if (pos < length) out[pos++] = (acc >>> shift) & 0xff;
    }
    counter++;
  }
  return out;
}

function base64DecodeURLSafe(s) {
  s = String(s).trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  s = s.replace(/[^A-Za-z0-9+/=]/g, "");
  let out = "", bc = 0, bs, buffer, i = 0;
  while ((buffer = s.charAt(i++))) {
    buffer = chars.indexOf(buffer);
    if (~buffer) {
      bs = bc % 4 ? bs * 64 + buffer : buffer;
      if (bc++ % 4) out += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
  }
  const bytes = new Uint8Array(out.length);
  for (let j = 0; j < out.length; j++) bytes[j] = out.charCodeAt(j);
  return bytes;
}

function utf8Decode(bytes) {
  let out = "", i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) out += String.fromCharCode(b);
    else if ((b & 0xe0) === 0xc0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if ((b & 0xf0) === 0xe0) out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else if ((b & 0xf8) === 0xf0) {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const s = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (s >> 10), 0xdc00 + (s & 0x3ff));
    }
  }
  return out;
}

function decryptVideasyPayload(encoded, seed, mediaId) {
  const bytes = base64DecodeURLSafe(encoded);
  const key = keyStream(seed, parseInt(mediaId) | 0, bytes.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i] ^ key[i];
  // Must start with "mvm1"
  if (!(bytes.length >= 4 && bytes[0] === 0x6d && bytes[1] === 0x76 && bytes[2] === 0x6d && bytes[3] === 0x31)) {
    throw new Error("payload header mismatch");
  }
  return utf8Decode(bytes.subarray(4));
}

// ============================================================
// SETTINGS
// ============================================================
function onSettings() { return []; }

// ============================================================
// MAIN
// ============================================================
function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const tmdbDetails = yield getTmdbDetails(tmdbId, type);
    if (!tmdbDetails) return [];
    const { title, year } = tmdbDetails;
    const isSeries = type === "series" || type === "tv";
    const isMovie = type === "movie";
    const mediaType = isMovie ? "movie" : "tv";

    const videasyHeaders = {
      "Referer": "https://player.videasy.to/",
      "Origin": "https://player.videasy.to",
      "Accept": "application/json, text/plain, */*"
    };

    // Step 1: get seed
    const seedUrl = "https://api.speedracelight.com/seed?mediaId=" + encodeURIComponent(tmdbId);
    console.log("[Videasy] Seed request: " + seedUrl);
    const seedText = yield fetchText(seedUrl, { headers: videasyHeaders });
    if (!seedText) { console.log("[Videasy] Seed fetch failed"); return []; }

    let seed;
    try { seed = JSON.parse(seedText).seed; }
    catch (e) { console.log("[Videasy] Seed is not JSON: " + seedText.substring(0, 200)); return []; }
    if (!seed) { console.log("[Videasy] No seed in response"); return []; }
    console.log("[Videasy] Seed: " + seed);

    // Step 2: build sources query
    const params = "mediaType=" + mediaType
      + "&tmdbId=" + encodeURIComponent(tmdbId)
      + (!isMovie ? "&seasonId=" + (season || 1) + "&episodeId=" + (episode || 1) : "")
      + "&enc=2&seed=" + encodeURIComponent(seed);

    // Step 3: try each source path
    const paths = ["cdn", "m4uhd", "lamovie"];
    let data = null;
    for (const p of paths) {
      const url = "https://api.speedracelight.com/" + p + "/sources-with-title?" + params;
      console.log("[Videasy] Trying path '" + p + "': " + url);
      const encText = yield fetchText(url, { headers: videasyHeaders });
      if (!encText) continue;
      try {
        const decrypted = decryptVideasyPayload(encText, seed, tmdbId);
        data = JSON.parse(decrypted);
        console.log("[Videasy] Decrypted " + p + " payload: " + decrypted.substring(0, 200));
        if (data && data.sources && data.sources.length) break;
        data = null;
      } catch (e) {
        console.log("[Videasy] Path '" + p + "' decrypt failed: " + e.message);
      }
    }

    if (!data) { console.log("[Videasy] All source paths failed"); return []; }

    const sources = data.sources || [];
    if (!sources.length) { console.log("[Videasy] No sources in decrypted payload"); return []; }

    const qualities = sources
      .filter((s) => s && s.url)
      .map((s) => {
        const label = s.quality || "Auto";
        const heightMatch = String(label).match(/\d{3,4}/);
        return { label: label, url: s.url, height: heightMatch ? parseInt(heightMatch[0]) : 0 };
      })
      .sort((a, b) => b.height - a.height);

    if (!qualities.length) { console.log("[Videasy] No usable quality URLs"); return []; }

    const playlist = data.playlist || qualities[0].url;
    const subtitles = (data.subtitles || [])
      .filter((s) => s && s.url)
      .map((s) => ({ language: s.language || s.lang || "Subtitle", url: s.url }));

    console.log("[Videasy] Playlist: " + playlist + " (" + qualities.length + " qualities, " + subtitles.length + " subs)");

    // ---- Description — same multi-line format as 4KHDHub ----
    const seSuffix = isSeries && season && episode
      ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
      : "";
    const titleLine = title + " (" + year + ")" + seSuffix;

    const maxHeight = qualities[0].height || 0;
    const qualityShort = maxHeight === 2160 ? "4K" : maxHeight ? maxHeight + "p" : "";

    const tagParts = ["Videasy"];
    tagParts.push(playlist.indexOf(".mpd") >= 0 ? "DASH" : "HLS");
    tagParts.push("H.264");
    if (subtitles.length) tagParts.push(subtitles.length + " Subs");
    const tagLine = tagParts.join(" • ");

    const lines = [titleLine];
    if (tagLine) lines.push(tagLine);
    const description = lines.join("\n");

    const baseName = qualityShort ? "Videasy " + qualityShort : "Videasy";

    return [{
      name: baseName,
      title: description,
      size: description,
      description: description,
      url: playlist,
      headers: videasyHeaders,
      subtitles: subtitles,
      qualities: qualities.map((q) => ({ label: q.label, url: q.url, height: q.height })),
      behaviorHints: { bingeGroup: "videasy-" + (playlist.indexOf(".mpd") >= 0 ? "dash" : "hls") }
    }];
  });
}

module.exports = { getStreams, onSettings };
