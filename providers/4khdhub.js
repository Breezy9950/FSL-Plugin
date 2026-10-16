"use strict";

var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop)) __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop)) __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

var cheerio = require("cheerio-without-node-native");
var CryptoJS = require("crypto-js");

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var TYPESENSE_URL = "https://search.hdhub4u.glass/collections/post/documents/search";
var BASE_URL = "https://4khdhub.one";

var DOMAIN_CACHE = { url: BASE_URL, altUrl: "https://new8.hdhub4u.cl", ts: 0 };

var HEADERS = {
  "User-Agent": USER_AGENT,
  "Cookie": "xla=s4t",
  "Referer": BASE_URL + "/"
};

// Mapping: toggle key -> substrings to match against link.source
var SOURCE_MATCH = {
  s_fsl:        ["FSL", "Direct R2"],
  s_s3:         ["S3"],
  s_fslv2:      ["FSLv2"],
  s_mega:       ["Mega"],
  s_buzz:       ["BuzzServer"],
  s_10gbps:     ["10Gbps"],
  s_zipdisk:    ["ZipDisk"],
  s_pixeldrain: ["Pixeldrain"],
  s_hubcdn:     ["HubCdn"],
  s_hubstream:  ["Hubstream"],
  s_streamtape: ["StreamTape"],
  s_hblinks:    ["Hblinks"]
};

// ============================================================
// UTILITIES
// ============================================================
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const retries = options.retries !== void 0 ? options.retries : 2;
    const delay = options.delay !== void 0 ? options.delay : 1e3;
    for (let i = 0; i <= retries; i++) {
      try {
        const response = yield fetch(url, {
          method: options.method || "GET",
          headers: __spreadValues(__spreadValues({}, HEADERS), options.headers || {}),
          body: options.body,
          redirect: options.redirect
        });
        if (!response.ok && !options.allowFail) throw new Error("HTTP " + response.status);
        return yield response.text();
      } catch (err) {
        console.log("[4KHDHub] Request failed for " + url + ": " + err.message + (i < retries ? ", retrying..." : ""));
      }
      if (i < retries) yield new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
    }
    return null;
  });
}

function atobSafe(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let str = String(input || "").replace(/=+$/, "");
  if (str.length % 4 === 1) return "";
  let output = "";
  for (let bc = 0, bs, buffer, i = 0; (buffer = str.charAt(i++)); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    buffer = chars.indexOf(buffer);
  }
  return output;
}
function rot13(value) {
  return String(value || "").replace(/[a-zA-Z]/g, function (c) {
    return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
  });
}
function parseBytes(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const match = String(val).match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
  if (!match) return 0;
  const multipliers = { GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024, TB: 1024 ** 4 };
  return parseFloat(match[1]) * (multipliers[match[2].toUpperCase()] || 0);
}
function formatBytes(val) {
  if (!val || val === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  let i = Math.floor(Math.log(val) / Math.log(k));
  if (i < 0) i = 0;
  return parseFloat((val / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
function normalizeTitle(t) {
  if (!t) return "";
  return String(t).toLowerCase().replace(/\b(the|a|an)\b/g, "").replace(/[:\-_]/g, " ").replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}
function titleSimilarity(t1, t2) {
  const n1 = normalizeTitle(t1), n2 = normalizeTitle(t2);
  if (n1 === n2) return 1;
  const w1 = n1.split(/\s+/).filter(Boolean);
  const w2 = n2.split(/\s+/).filter(Boolean);
  if (!w1.length || !w2.length) return 0;
  const set1 = new Set(w1), set2 = new Set(w2);
  const intersection = w1.filter((w) => set2.has(w));
  const union = new Set([...w1, ...w2]);
  let score = intersection.length / union.size;
  if (w1.every((w) => set2.has(w))) score += 0.2;
  score -= w2.filter((w) => !set1.has(w)).length * 0.05;
  return score;
}
function cleanTitle(title) {
  if (!title) return "";
  let name = String(title).replace(/\.[a-zA-Z0-9]{2,4}$/, "");
  const normalized = name.replace(/WEB[-_. ]?DL/gi, "WEB-DL").replace(/WEB[-_. ]?RIP/gi, "WEBRIP")
    .replace(/H[ .]?265/gi, "H265").replace(/H[ .]?264/gi, "H264");
  const parts = normalized.split(/[\s_.]/);
  const keep = new Set(["WEB-DL","WEBRIP","BLURAY","HDRIP","DVDRIP","HDTV","CAM","TS","BRRIP","BDRIP",
    "H264","H265","X264","X265","HEVC","AVC","AAC","AC3","DTS","MP3","FLAC","DD","DDP","EAC3",
    "ATMOS","SDR","HDR","HDR10","HDR10+","DV","DOLBYVISION","NF","CR"]);
  return [...new Set(parts.map((p) => p.toUpperCase()).filter((p) => keep.has(p)))].join(" ");
}

// ============================================================
// SETTINGS — 12 extractor toggles + sort
// ============================================================
function onSettings() {
  return [
    { type: "toggle", key: "s_fsl",        label: "FSL / Direct R2", default: true },
    { type: "toggle", key: "s_s3",         label: "S3",             default: true },
    { type: "toggle", key: "s_fslv2",      label: "FSLv2",          default: true },
    { type: "toggle", key: "s_mega",       label: "Mega",           default: true },
    { type: "toggle", key: "s_buzz",       label: "BuzzServer",     default: true },
    { type: "toggle", key: "s_10gbps",     label: "10Gbps",         default: true },
    { type: "toggle", key: "s_zipdisk",    label: "ZipDisk",        default: true },
    { type: "toggle", key: "s_pixeldrain", label: "Pixeldrain",     default: true },
    { type: "toggle", key: "s_hubcdn",     label: "HubCdn",         default: true },
    { type: "toggle", key: "s_hubstream",  label: "Hubstream",      default: true },
    { type: "toggle", key: "s_streamtape", label: "StreamTape",     default: true },
    { type: "toggle", key: "s_hblinks",    label: "Hblinks",        default: true },
    {
      type: "select",
      key: "sort",
      label: "Sort By",
      options: [
        { label: "Quality first (4K → 1080p → 720p)", value: "quality" },
        { label: "Size first (largest file on top)", value: "size" }
      ],
      default: "quality"
    }
  ];
}
function resolveSettings(input) {
  const out = {
    s_fsl: true, s_s3: true, s_fslv2: true, s_mega: true,
    s_buzz: true, s_10gbps: true, s_zipdisk: true, s_pixeldrain: true,
    s_hubcdn: true, s_hubstream: true, s_streamtape: true, s_hblinks: true,
    sortBy: "quality"
  };
  try {
    let settings = input;
    if (!settings && typeof globalThis !== "undefined") settings = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!settings && typeof global !== "undefined") settings = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!settings && typeof window !== "undefined") settings = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (!settings) return out;

    const toggleKeys = Object.keys(SOURCE_MATCH);
    for (const key of toggleKeys) {
      if (settings[key] === undefined) continue;
      let v = settings[key];
      if (typeof v === "object" && v !== null) v = v.value !== undefined ? v.value : v.key;
      if (v === true || v === "true" || v === "on" || v === "yes" || v === 1 || v === "1") out[key] = true;
      else if (v === false || v === "false" || v === "off" || v === "no" || v === 0 || v === "0") out[key] = false;
    }

    let rawSort = settings.sort || settings.sortBy || settings.sort_by || "";
    if (typeof rawSort === "object" && rawSort !== null) rawSort = rawSort.value || rawSort.key || "";
    const normSort = String(rawSort).toLowerCase().trim();
    if (normSort === "size" || normSort === "largest") out.sortBy = "size";
  } catch (e) { console.log("[4KHDHub] settings parse error: " + e.message); }
  return out;
}

// ============================================================
// TMDB + DOMAIN
// ============================================================
function getTmdbDetails(tmdbId, type) {
  return __async(this, null, function* () {
    const isSeries = type === "series" || type === "tv";
    const endpoint = isSeries ? "tv" : "movie";
    const url = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    try {
      const r = yield fetch(url);
      const d = yield r.json();
      if (isSeries) return { title: d.name, year: d.first_air_date ? parseInt(d.first_air_date.split("-")[0]) : 0 };
      return { title: d.title, year: d.release_date ? parseInt(d.release_date.split("-")[0]) : 0 };
    } catch (e) { return null; }
  });
}
function fetchLatestDomain() {
  return __async(this, null, function* () {
    const now = Date.now();
    if (now - DOMAIN_CACHE.ts < 36e5) return DOMAIN_CACHE;
    try {
      const r = yield fetch(DOMAINS_URL, { headers: { "User-Agent": USER_AGENT } });
      const data = yield r.json();
      if (data) {
        if (data["4khdhub"]) DOMAIN_CACHE.url = data["4khdhub"];
        if (data["HDHUB4u"]) DOMAIN_CACHE.altUrl = data["HDHUB4u"];
        DOMAIN_CACHE.ts = now;
      }
    } catch (e) {}
    return DOMAIN_CACHE;
  });
}

// ============================================================
// SEARCH
// ============================================================
function searchTypesense(query) {
  return __async(this, null, function* () {
    const today = (new Date()).toISOString().split("T")[0];
    const url = TYPESENSE_URL + "?q=" + encodeURIComponent(query)
      + "&query_by=post_title,category&query_by_weights=4,2"
      + "&sort_by=sort_by_date:desc&limit=15&highlight_fields=none&use_cache=true&page=1"
      + "&analytics_tag=" + today;
    const text = yield fetchText(url, { headers: { "Accept": "application/json" } });
    if (!text) return [];
    let data; try { data = JSON.parse(text); } catch (e) { return []; }
    if (!data || !data.hits) return [];
    const domain = yield fetchLatestDomain();
    return data.hits.map((hit) => {
      const doc = hit.document;
      const title = doc.post_title || "";
      const yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
      let url = doc.permalink || "";
      if (url.startsWith("/")) url = domain.url + url;
      return { title, url, year: yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null };
    });
  });
}
function findBestMatch(mediaInfo, results, isSeries, season) {
  if (!results || !results.length) return null;
  let best = null, bestScore = 0;
  for (const r of results) {
    let score = titleSimilarity(mediaInfo.title, r.title);
    if (mediaInfo.year && r.year) {
      const diff = Math.abs(mediaInfo.year - r.year);
      if (diff === 0) score += 0.2;
      else if (diff <= 1) score += 0.1;
      else if (diff > 5) score -= 0.3;
    }
    if (isSeries && season) {
      const lower = r.title.toLowerCase();
      const other = lower.match(/season\s*(\d+)|s(\d+)/i);
      if (other) {
        const found = parseInt(other[1] || other[2]);
        if (found !== season) score -= 0.8;
        else score += 0.5;
      }
    }
    if (score > bestScore && score > 0.3) { bestScore = score; best = r; }
  }
  return best;
}

// ============================================================
// REDIRECT DECODER
// ============================================================
function getRedirectLinks(url) {
  return __async(this, null, function* () {
    try {
      const doc = yield fetchText(url);
      if (!doc) return null;
      const regex = /s\s*\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]|ck\s*\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/g;
      let combined = "", m;
      while ((m = regex.exec(doc)) !== null) {
        const v = m[1] || m[2];
        if (v) combined += v;
      }
      if (!combined) {
        const rm = doc.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
        if (rm && rm[1] && rm[1] !== url && rm[1].indexOf(url) < 0) {
          return yield getRedirectLinks(rm[1]);
        }
        return null;
      }
      const decoded = atobSafe(rot13(atobSafe(atobSafe(combined))));
      const obj = JSON.parse(decoded);
      const encodedUrl = atobSafe(obj.o || "").trim();
      if (encodedUrl) return encodedUrl;
      const data = atobSafe(obj.data || "").trim();
      const blogUrl = (obj.blog_url || "").trim();
      if (blogUrl && data) {
        const resp = yield fetchText(blogUrl + "?re=" + encodeURIComponent(data));
        const $ = cheerio.load(resp || "");
        return ($("body").text() || resp).trim();
      }
      return null;
    } catch (e) { return null; }
  });
}

// ============================================================
// HOSTER EXTRACTORS
// ============================================================
function pixelDrainExtractor(link) {
  return __async(this, null, function* () {
    try {
      const u = new URL(link);
      const baseUrl = u.protocol + "//" + u.hostname;
      const fileId = (link.match(/(?:file|u)\/([A-Za-z0-9]+)/) || [])[1] || link.split("/").pop();
      if (!fileId) return [{ source: "Pixeldrain", quality: 0, url: link }];
      const finalUrl = link.indexOf("?download") >= 0 ? link : baseUrl + "/api/file/" + fileId + "?download";
      return [{ source: "Pixeldrain", quality: 0, url: finalUrl }];
    } catch (e) {
      return [{ source: "Pixeldrain", quality: 0, url: link }];
    }
  });
}
function streamTapeExtractor(link) {
  return __async(this, null, function* () {
    try {
      const u = new URL(link);
      u.hostname = "streamtape.com";
      const data = yield fetchText(u.toString());
      if (!data) return [];
      let videoSrc = (data.match(/document\.getElementById\('videolink'\)\.innerHTML = (.*?);/) || [])[1];
      let match = videoSrc && videoSrc.match(/'(\/\/streamtape\.com\/get_video[^']+)'/);
      if (!match) {
        const m2 = data.match(/'(\/\/streamtape\.com\/get_video[^']+)'/);
        if (m2) match = m2;
      }
      return match ? [{ source: "StreamTape", quality: 720, url: "https:" + match[1] }] : [];
    } catch (e) { return []; }
  });
}
function hbLinksExtractor(url) {
  return __async(this, null, function* () {
    try {
      const data = yield fetchText(url, { headers: { "Referer": url } });
      if (!data) return [];
      const $ = cheerio.load(data);
      const links = [...new Set($("h3 a, h5 a, div.entry-content p a, div.entry-content a").map((i, el) => $(el).attr("href")).get().filter(Boolean))];
      const results = [];
      for (const l of links) {
        const r = yield loadExtractor(l, url);
        results.push(...r.map((x) => __spreadProps(__spreadValues({}, x), { source: x.source + " Hblinks" })));
      }
      return results;
    } catch (e) { return []; }
  });
}
function hubCdnExtractor(url, referer) {
  return __async(this, null, function* () {
    try {
      const data = yield fetchText(url, { headers: { "Referer": referer } });
      if (!data) return [];
      const $ = cheerio.load(data);
      let scriptContent = "";
      $("script").each((i, el) => {
        const html = $(el).html();
        if (html && html.indexOf("reurl") >= 0) scriptContent = html;
      });
      if (scriptContent) {
        const m = scriptContent.match(/reurl\s*=\s*["']([^"']+)["']/);
        if (m) {
          const val = m[1];
          if (val.indexOf("?r=") >= 0) {
            const decoded = atobSafe(val.split("?r=").pop());
            const m3u8 = decoded.substring(decoded.lastIndexOf("link=") + 5);
            if (m3u8 && m3u8.indexOf("http") === 0) return [{ source: "HubCdn", quality: 1080, url: m3u8 }];
          } else if (val.indexOf("link=") >= 0) {
            const m3u8 = val.split("link=").pop();
            if (m3u8 && m3u8.indexOf("http") === 0) return [{ source: "HubCdn", quality: 1080, url: m3u8 }];
          } else if (val.indexOf("http") === 0) {
            return [{ source: "HubCdn", quality: 1080, url: val }];
          }
        }
      }
      const encM = data.match(/r=([A-Za-z0-9+/=]+)/);
      if (encM) {
        const decoded = atobSafe(encM[1]);
        const m3u8 = decoded.substring(decoded.lastIndexOf("link=") + 5);
        if (m3u8 && m3u8.indexOf("http") === 0) return [{ source: "HubCdn", quality: 1080, url: m3u8 }];
      }
      return [];
    } catch (e) { return []; }
  });
}
function vidStackExtractor(url) {
  return __async(this, null, function* () {
    try {
      const hash = url.split("#").pop().split("/").pop();
      const baseUrl = new URL(url).origin;
      const apiUrl = baseUrl + "/api/v1/video?id=" + hash;
      const encoded = (yield fetchText(apiUrl, { headers: { "Referer": url } })).trim();
      const key = CryptoJS.enc.Utf8.parse("kiemtienmua911ca");
      const ivs = ["1234567890oiuytr", "0123456789abcdef"];
      for (const ivStr of ivs) {
        try {
          const iv = CryptoJS.enc.Utf8.parse(ivStr);
          const decrypted = CryptoJS.AES.decrypt(
            { ciphertext: CryptoJS.enc.Hex.parse(encoded) },
            key,
            { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
          );
          const decText = decrypted.toString(CryptoJS.enc.Utf8);
          if (decText && decText.indexOf("source") >= 0) {
            const m3u8 = (decText.match(/"source":"(.*?)"/) || [])[1];
            if (m3u8) {
              return [{
                source: "Hubstream",
                quality: 1080,
                url: m3u8.replace(/\\/g, ""),
                headers: { "Referer": url, "Origin": url.split("/").pop() }
              }];
            }
          }
        } catch (e) {}
      }
      return [];
    } catch (e) { return []; }
  });
}
function hubCloudExtractor(url, referer) {
  return __async(this, null, function* () {
    try {
      let currentUrl = url.replace("hubcloud.ink", "hubcloud.dad");
      let pageData = yield fetchText(currentUrl, { headers: { "Referer": referer } });
      if (!pageData) return [];
      let finalUrl = currentUrl;
      if (currentUrl.indexOf("hubcloud.php") < 0) {
        let nextHref = "";
        const $first = cheerio.load(pageData);
        const downloadBtn = $first("#download");
        if (downloadBtn.length) nextHref = downloadBtn.attr("href");
        else {
          const m = pageData.match(/var url ?= ?'([^']*)'/);
          if (m) nextHref = m[1];
        }
        if (nextHref) {
          if (nextHref.indexOf("http") !== 0) {
            const u = new URL(currentUrl);
            nextHref = u.protocol + "//" + u.hostname + "/" + nextHref.replace(/^\//, "");
          }
          finalUrl = nextHref;
          pageData = yield fetchText(finalUrl, { headers: { "Referer": currentUrl } });
          if (!pageData) return [];
        }
      }
      const $ = cheerio.load(pageData);
      const sizeText = $("i#size").text().trim();
      const headerText = $("div.card-header").text().trim();
      const qm = headerText.match(/(\d{3,4})[pP]/);
      const quality = qm ? parseInt(qm[1]) : 1080;
      const sizeBytes = parseBytes(sizeText);
      const links = [];

      const anchors = $("a.btn").get();
      for (const el of anchors) {
        const href = $(el).attr("href") || "";
        const text = $(el).text().toLowerCase();
        if (!href) continue;

        if (text.indexOf("download file") >= 0 || text.indexOf("fsl server") >= 0 ||
            text.indexOf("s3 server") >= 0 || text.indexOf("fslv2") >= 0 ||
            text.indexOf("mega server") >= 0 || href.indexOf("r2.dev") >= 0 ||
            href.indexOf("r2.cloudflarestorage.com") >= 0) {
          let label = "FSL";
          if (href.indexOf("r2.dev") >= 0 || href.indexOf("r2.cloudflarestorage.com") >= 0) label = "Direct R2";
          else if (href.indexOf("workers.dev") >= 0) label = "ZipDisk";
          else if (text.indexOf("fsl server") >= 0) label = "FSL";
          else if (text.indexOf("s3 server") >= 0) label = "S3";
          else if (text.indexOf("fslv2") >= 0) label = "FSLv2";
          else if (text.indexOf("mega server") >= 0) label = "Mega";
          links.push({ source: label, quality, url: href, size: sizeBytes, title: headerText });
        } else if (text.indexOf("buzzserver") >= 0) {
          try {
            const buzzResp = yield fetch(href + "/download", {
              method: "GET",
              headers: __spreadValues(__spreadValues({}, HEADERS), { "Referer": href }),
              redirect: "manual"
            });
            let dlink = buzzResp.headers.get("hx-redirect") || buzzResp.headers.get("HX-Redirect");
            if (!dlink && buzzResp.url && buzzResp.url !== href + "/download") dlink = buzzResp.url;
            if (dlink) links.push({ source: "BuzzServer", quality, url: dlink, size: sizeBytes, title: headerText });
          } catch (e) {}
        } else if (text.indexOf("10gbps") >= 0 || href.indexOf("hubcloud.cx") >= 0) {
          let target = href;
          if (href.indexOf("hubcloud.cx") < 0) {
            try {
              const resp = yield fetch(href, { method: "GET", redirect: "manual", headers: HEADERS });
              const loc = resp.headers.get("location");
              if (loc && loc.indexOf("link=") >= 0) target = loc.substring(loc.indexOf("link=") + 5);
            } catch (e) {}
          }
          links.push({ source: "10Gbps", quality, url: target, size: sizeBytes, title: headerText });
        } else if (text.indexOf("zipdisk") >= 0 || href.indexOf("workers.dev") >= 0) {
          links.push({ source: "ZipDisk", quality, url: href, size: sizeBytes, title: headerText });
        } else if (href.indexOf("pixeldra") >= 0) {
          const results = yield pixelDrainExtractor(href);
          for (const r of results) links.push(__spreadProps(__spreadValues({}, r), { quality, size: sizeBytes, title: headerText }));
        } else if (href.indexOf("magnet:") < 0 && href.indexOf("http") === 0) {
          const extracted = yield loadExtractor(href, finalUrl);
          for (const x of extracted) links.push(__spreadProps(__spreadValues({}, x), { quality: x.quality || quality, size: x.size || sizeBytes, title: x.title || headerText }));
        }
      }
      return links;
    } catch (e) { return []; }
  });
}
function loadExtractor(url, referer) {
  return __async(this, null, function* () {
    try {
      const hostname = new URL(url).hostname;
      const isRedirect = url.indexOf("?id=") >= 0
        || hostname.indexOf("techyboy4u") >= 0
        || hostname.indexOf("gadgetsweb") >= 0
        || hostname.indexOf("cryptoinsights") >= 0
        || hostname.indexOf("bloggingvector") >= 0
        || hostname.indexOf("greenmotors") >= 0
        || hostname.indexOf("ampproject") >= 0;
      if (isRedirect) {
        const finalLink = yield getRedirectLinks(url);
        if (finalLink && finalLink !== url) return yield loadExtractor(finalLink, url);
        return [];
      }
      if (hostname.indexOf("hubcloud") >= 0) return yield hubCloudExtractor(url, referer);
      if (hostname.indexOf("hubcdn") >= 0) return yield hubCdnExtractor(url, referer);
      if (hostname.indexOf("hblinks") >= 0 || hostname.indexOf("hubstream.dad") >= 0) return yield hbLinksExtractor(url);
      if (hostname.indexOf("hubstream") >= 0 || hostname.indexOf("vidstack") >= 0) return yield vidStackExtractor(url);
      if (hostname.indexOf("pixeldrain") >= 0) return yield pixelDrainExtractor(url);
      if (hostname.indexOf("streamtape") >= 0) return yield streamTapeExtractor(url);
      if (hostname.indexOf("hubdrive") >= 0) {
        const data = yield fetchText(url, { headers: { "Referer": referer } });
        if (data) {
          const href = cheerio.load(data)(".btn.btn-primary.btn-user.btn-success1.m-1").attr("href");
          if (href) return yield loadExtractor(href, url);
        }
      }
      return [];
    } catch (e) { return []; }
  });
}

// ============================================================
// MAIN
// ============================================================
function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const resolved = resolveSettings(settings);

    // Build list of substrings the user wants kept
    const enabledPatterns = [];
    for (const key of Object.keys(SOURCE_MATCH)) {
      if (resolved[key]) {
        for (const p of SOURCE_MATCH[key]) enabledPatterns.push(p);
      }
    }
    console.log("[4KHDHub] Enabled patterns: " + enabledPatterns.join(", "));

    // If user disabled everything, return empty (no point scraping)
    if (!enabledPatterns.length) {
      console.log("[4KHDHub] All extractors disabled — returning empty");
      return [];
    }

    const tmdb = yield getTmdbDetails(tmdbId, type);
    if (!tmdb) return [];
    const isSeries = type === "series" || type === "tv";

    const query = isSeries && season ? tmdb.title + " Season " + season : tmdb.title;
    const searchResults = yield searchTypesense(query);
    if (!searchResults.length) { console.log("[4KHDHub] No search results"); return []; }
    const best = findBestMatch(tmdb, searchResults, isSeries, season);
    const selected = best || searchResults[0];
    console.log("[4KHDHub] Selected: " + selected.title + " -> " + selected.url);

    const pageHtml = yield fetchText(selected.url, { headers: { "Referer": BASE_URL + "/" } });
    if (!pageHtml) return [];
    const $ = cheerio.load(pageHtml);

    const candidateUrls = new Set();

    $(".download-item").each((_, el) => {
      $(el).find("a").each((_, a) => {
        const href = $(a).attr("href") || "";
        if (href && href.indexOf("http") === 0) candidateUrls.add(href);
      });
    });
    $("h3 a, h4 a").each((_, a) => {
      const txt = $(a).text();
      const href = $(a).attr("href") || "";
      if (href && /480|720|1080|2160|4K/i.test(txt)) candidateUrls.add(href);
    });
    $(".page-body > div a").each((_, a) => {
      const href = $(a).attr("href") || "";
      if (href && (href.indexOf("hdstream4u") >= 0 || href.indexOf("hubstream") >= 0)) candidateUrls.add(href);
    });

    console.log("[4KHDHub] Candidates: " + candidateUrls.size);
    if (!candidateUrls.size) return [];

    const allLinks = [];
    for (const url of candidateUrls) {
      try {
        const links = yield loadExtractor(url, selected.url);
        for (const l of links) allLinks.push(l);
      } catch (e) {}
    }
    console.log("[4KHDHub] Extracted: " + allLinks.length);

    // Dedupe by URL
    const seen = new Set();
    const unique = [];
    for (const l of allLinks) {
      if (!l.url || seen.has(l.url)) continue;
      seen.add(l.url);
      unique.push(l);
    }

    // Filter by enabled extractors
    const visible = unique.filter((l) => {
      const src = String(l.source || "");
      return enabledPatterns.some((p) => src.indexOf(p) >= 0);
    });
    console.log("[4KHDHub] After extractor filter: " + visible.length + "/" + unique.length);

    if (!visible.length) return [];

    const seSuffix = isSeries && season && episode
      ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
      : "";
    const titleLine = tmdb.title + " (" + tmdb.year + ")" + seSuffix;

    const streams = visible.map((link) => {
      const height = link.quality || 0;
      const qualityShort = height === 2160 ? "4K" : height ? height + "p" : "";
      const info = parseReleaseInfo(link.title || "");

      const tagParts = [];
      if (link.source) tagParts.push(link.source);
      if (info.source) tagParts.push(info.source);
      if (info.codec) tagParts.push(info.codec);
      if (info.hdr) tagParts.push(info.hdr);
      if (info.dv) tagParts.push("DV");
      const tagLine = tagParts.join(" • ");

      const sizeLine = link.size ? formatBytes(link.size) : "";
      const audioLine = info.audio.length ? "Audio: " + info.audio.join(", ") : "";

      const lines = [titleLine];
      if (tagLine) lines.push(tagLine);
      if (sizeLine && sizeLine !== "0 B") lines.push(sizeLine);
      if (audioLine) lines.push(audioLine);
      const description = lines.join("\n");

      const baseName = qualityShort ? "4KHDHub " + qualityShort : "4KHDHub";

      const obj = {
        name: baseName,
        title: description,
        size: description,
        description: description,
        url: link.url,
        __qr: height,
        __sb: link.size || 0,
        behaviorHints: { bingeGroup: "4khdhub-" + link.source }
      };
      if (link.headers && Object.keys(link.headers).length) obj.headers = link.headers;
      return obj;
    });

    if (resolved.sortBy === "size") {
      streams.sort((a, b) => b.__sb - a.__sb);
    } else {
      streams.sort((a, b) => {
        if (b.__qr !== a.__qr) return b.__qr - a.__qr;
        return b.__sb - a.__sb;
      });
    }

    for (let i = 0; i < streams.length; i++) {
      let prefix = "";
      if (i < 16) prefix = String.fromCodePoint(0xFE00 + i);
      else if (i < 256) prefix = String.fromCodePoint(0xE0100 + (i - 16));
      streams[i].name = prefix + streams[i].name;
      delete streams[i].__qr;
      delete streams[i].__sb;
    }
    return streams;
  });
}

// ============================================================
// RELEASE INFO PARSER
// ============================================================
function parseReleaseInfo(releaseTitle) {
  const t = String(releaseTitle || "");
  const info = { source: "", codec: "", hdr: "", dv: false, audio: [] };
  if (/bluray|blu-ray|bdrip|brrip/i.test(t)) info.source = "BluRay";
  else if (/web-?dl|webrip/i.test(t)) info.source = "WEB-DL";
  else if (/hdtv/i.test(t)) info.source = "HDTV";
  if (/x265|h\.?265|hevc/i.test(t)) info.codec = "H.265";
  else if (/x264|h\.?264|avc/i.test(t)) info.codec = "H.264";
  if (/hdr10\+/i.test(t)) info.hdr = "HDR10+";
  else if (/hdr10/i.test(t)) info.hdr = "HDR10";
  else if (/\bhdr\b/i.test(t)) info.hdr = "HDR";
  if (/dolby.?vision|dovi|(?:^|[._\-\[ ])dv(?:[._\-\] ]|$)/i.test(t)) info.dv = true;

  let typeTag = "";
  if (/\bhindi\b/i.test(t) || /\bmulti[\s._-]?audio\b/i.test(t)) typeTag = "Multi";
  else if (/\bdual[\s._-]?audio\b/i.test(t)) typeTag = "Dual-Audio";

  const codecBits = [];
  if (/truehd[\s._-]*7\.1/i.test(t)) codecBits.push("TrueHD 7.1");
  else if (/ddp[\s._-]*5\.1|eac3/i.test(t)) codecBits.push("DDP5.1");
  else if (/dd[\s._-]*5\.1|(?:^|[._\- ])ac3(?:[._\- ]|$)/i.test(t)) codecBits.push("DD5.1");
  else if (/\baac\b/i.test(t)) codecBits.push("AAC");
  if (/\batmos\b/i.test(t)) codecBits.push("Atmos");

  if (typeTag) info.audio.push(typeTag);
  for (const c of codecBits) info.audio.push(c);
  return info;
}

module.exports = { getStreams, onSettings };
