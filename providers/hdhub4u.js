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

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var MAIN_URL = "https://new8.hdhub4u.cl";
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000;
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Cookie": "xla=s4t",
  "Referer": MAIN_URL + "/"
};
var domainCacheTimestamp = 0;

function updateMainUrl(url) { MAIN_URL = url; HEADERS.Referer = url + "/"; }
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "Unknown";
  var k = 1024, sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
function rot13(value) {
  return String(value || "").replace(/[a-zA-Z]/g, function(c) {
    return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
  });
}
var BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function atob(value) {
  if (!value) return "";
  var input = String(value).replace(/=+$/, ""), output = "", bc = 0, bs, buffer, idx = 0;
  while (buffer = input.charAt(idx++)) {
    buffer = BASE64_CHARS.indexOf(buffer);
    if (~buffer) { bs = bc % 4 ? bs * 64 + buffer : buffer; if (bc++ % 4) output += String.fromCharCode(255 & bs >> (-2 * bc & 6)); }
  }
  return output;
}
function cleanTitle(title) {
  var name = String(title || "").replace(/\.[a-zA-Z0-9]{2,4}$/, "");
  var normalized = name.replace(/WEB[-_. ]?DL/gi, "WEB-DL").replace(/WEB[-_. ]?RIP/gi, "WEBRIP")
    .replace(/H[ .]?265/gi, "H265").replace(/H[ .]?264/gi, "H264");
  var parts = normalized.split(/[\s_.]/);
  var keep = new Set(["WEB-DL","WEBRIP","BLURAY","HDRIP","DVDRIP","HDTV","CAM","TS","BRRIP","BDRIP",
    "H264","H265","X264","X265","HEVC","AVC","AAC","AC3","DTS","MP3","FLAC","DD","DDP","EAC3",
    "ATMOS","SDR","HDR","HDR10","HDR10+","DV","DOLBYVISION","NF","CR"]);
  return [...new Set(parts.map(function(p) { var u = p.toUpperCase(); return keep.has(u) ? (u === "DOLBYVISION" ? "DV" : u) : null; }).filter(Boolean))].join(" ");
}
function normalizeTitle(title) {
  if (!title) return "";
  return String(title).toLowerCase().replace(/\b(the|a|an)\b/g, "").replace(/[:\-_]/g, " ").replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}
function calculateTitleSimilarity(t1, t2) {
  var n1 = normalizeTitle(t1), n2 = normalizeTitle(t2);
  if (n1 === n2) return 1;
  var w1 = n1.split(/\s+/).filter(function(w) { return w.length > 0; });
  var w2 = n2.split(/\s+/).filter(function(w) { return w.length > 0; });
  if (!w1.length || !w2.length) return 0;
  var set1 = new Set(w1), set2 = new Set(w2);
  var inter = w1.filter(function(w) { return set2.has(w); });
  var union = new Set([...w1, ...w2]);
  var score = inter.length / union.size - w2.filter(function(w) { return !set1.has(w); }).length * 0.05;
  if (w1.every(function(w) { return set2.has(w); })) score += 0.2;
  return score;
}
function findBestTitleMatch(mediaInfo, results, mediaType, season) {
  if (!results || !results.length) return null;
  var best = null, bestScore = 0;
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var score = calculateTitleSimilarity(mediaInfo.title, r.title);
    if (mediaInfo.year && r.year) {
      var diff = Math.abs(mediaInfo.year - r.year);
      if (diff === 0) score += 0.2; else if (diff <= 1) score += 0.1; else if (diff > 5) score -= 0.3;
    }
    if (mediaType === "tv" && season) {
      var lower = r.title.toLowerCase();
      var other = lower.match(/season\s*(\d+)|s(\d+)/i);
      if (other) { var found = parseInt(other[1] || other[2]); if (found !== season) score -= 0.8; else score += 0.5; }
    }
    if (score > bestScore && score > 0.3) { bestScore = score; best = r; }
  }
  return best;
}
function fetchAndUpdateDomain() {
  return __async(this, null, function* () {
    var now = Date.now();
    if (now - domainCacheTimestamp < DOMAIN_CACHE_TTL) return;
    try {
      var response = yield fetch(DOMAINS_URL, { method: "GET", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
      if (response.ok) {
        var data = yield response.json();
        if (data && data.HDHUB4u) {
          var newDomain = data.HDHUB4u;
          if (newDomain !== MAIN_URL) { updateMainUrl(newDomain); domainCacheTimestamp = now; }
        }
      }
    } catch (e) {}
  });
}
function getCurrentDomain() {
  return __async(this, null, function* () { yield fetchAndUpdateDomain(); return MAIN_URL; });
}
function getTMDBDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    var response = yield fetch(url, { method: "GET", headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error("TMDB API error: " + response.status);
    var data = yield response.json();
    var title = mediaType === "tv" ? data.name : data.title;
    var releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
    return { title: title, year: releaseDate ? parseInt(releaseDate.split("-")[0]) : null };
  });
}

// ============================================================
// SEARCH — HTML (WordPress /?s=) with levenshtein match
// ============================================================
function levenshtein(a, b) {
  if (a === b) return 0;
  var n = a.length, m = b.length;
  if (!n) return m; if (!m) return n;
  var d = [];
  for (var i = 0; i <= n; i++) { d[i] = [i]; }
  for (var j = 0; j <= m; j++) { d[0][j] = j; }
  for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) {
    d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a.charAt(i-1) === b.charAt(j-1) ? 0 : 1));
  }
  return d[n][m];
}
function searchHtml(query, mediaInfo, mediaType, season) {
  return __async(this, null, function* () {
    var domain = yield getCurrentDomain();
    var url = domain + "/?s=" + encodeURIComponent(query);
    var response = yield fetch(url, { headers: HEADERS });
    var html = yield response.text();
    var $ = cheerio.load(html);
    var candidates = [];
    $(".movie-card, article, .post").each(function(i, el) {
      var $el = $(el);
      var titleEl = $el.find(".movie-card-title, h2, h3, .entry-title").first();
      var title = titleEl.text().trim();
      var href = $el.find("a").first().attr("href") || titleEl.find("a").attr("href") || $el.attr("href");
      if (!title || !href) return;
      var yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
      if (href.indexOf("http") !== 0) href = domain + (href.charAt(0) === "/" ? "" : "/") + href;
      candidates.push({ title: title.replace(/\[.*?\]/g, "").trim(), url: href, year: yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null });
    });
    var best = findBestTitleMatch(mediaInfo, candidates, mediaType, season);
    return best || candidates[0] || null;
  });
}

// ============================================================
// REDIRECT + EXTRACTORS
// ============================================================
function getRedirectLinks(url) {
  return __async(this, null, function* () {
    try {
      var response = yield fetch(url, { headers: HEADERS });
      if (!response.ok) throw new Error("HTTP " + response.status);
      var doc = yield response.text();
      var regex = /s\s*\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]|ck\s*\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/g;
      var combined = "", m;
      while ((m = regex.exec(doc)) !== null) { var v = m[1] || m[2]; if (v) combined += v; }
      if (!combined) {
        var rm = doc.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
        if (rm && rm[1] && rm[1] !== url && rm[1].indexOf(url) < 0) return yield getRedirectLinks(rm[1]);
        return null;
      }
      var decoded = atob(rot13(atob(atob(combined))));
      var jsonObject = JSON.parse(decoded);
      var encodedUrl = atob(jsonObject.o || "").trim();
      if (encodedUrl) return encodedUrl;
      var data = atob(jsonObject.data || "").trim();
      var wpHttp = (jsonObject.blog_url || "").trim();
      if (wpHttp && data) {
        var dlr = yield fetch(wpHttp + "?re=" + data, { headers: HEADERS });
        var html = yield dlr.text();
        var $ = cheerio.load(html);
        return ($("body").text() || html).trim();
      }
      return null;
    } catch (e) { return null; }
  });
}
function pixelDrainExtractor(link) {
  return __async(this, null, function* () {
    try {
      var u = new URL(link);
      var base = u.protocol + "//" + u.hostname;
      var m = link.match(/(?:file|u)\/([A-Za-z0-9]+)/);
      var fileId = (m && m[1]) || link.split("/").pop();
      if (!fileId) return [{ source: "Pixeldrain", quality: 0, url: link }];
      return [{ source: "Pixeldrain", quality: 0, url: link.indexOf("?download") >= 0 ? link : base + "/api/file/" + fileId + "?download" }];
    } catch (e) { return [{ source: "Pixeldrain", quality: 0, url: link }]; }
  });
}
function streamTapeExtractor(link) {
  return __async(this, null, function* () {
    try {
      var url = new URL(link); url.hostname = "streamtape.com";
      var res = yield fetch(url.toString(), { headers: HEADERS });
      var data = yield res.text();
      var m1 = data.match(/document\.getElementById\('videolink'\)\.innerHTML = (.*?);/);
      var src = m1 && m1[1] && (m1[1].match(/'(\/\/streamtape\.com\/get_video[^']+)'/) || [])[1];
      if (!src) { var m2 = data.match(/'(\/\/streamtape\.com\/get_video[^']+)'/); src = m2 && m2[1]; }
      return src ? [{ source: "StreamTape", quality: 720, url: "https:" + src }] : [];
    } catch (e) { return []; }
  });
}
function hbLinksExtractor(url) {
  return __async(this, null, function* () {
    try {
      var res = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) });
      var data = yield res.text();
      var $ = cheerio.load(data);
      var links = [...new Set($("h3 a, h5 a, div.entry-content p a, div.entry-content a").map(function(i, el) { return $(el).attr("href"); }).get().filter(Boolean))];
      var results = [];
      for (var i = 0; i < links.length; i++) {
        var r = yield loadExtractor(links[i], url);
        results.push(...r.map(function(x) { return __spreadProps(__spreadValues({}, x), { source: x.source + " Hblinks" }); }));
      }
      return results;
    } catch (e) { return []; }
  });
}
function hubCloudExtractor(url, referer) {
  return __async(this, null, function* () {
    try {
      var currentUrl = url.replace("hubcloud.ink", "hubcloud.dad");
      var pres = yield fetch(currentUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer }) });
      var pageData = yield pres.text();
      var finalUrl = currentUrl;
      if (currentUrl.indexOf("hubcloud.php") < 0) {
        var nextHref = "";
        var $first = cheerio.load(pageData);
        var btn = $first("#download");
        if (btn.length) nextHref = btn.attr("href");
        else { var sm = pageData.match(/var url = '([^']*)'/); if (sm) nextHref = sm[1]; }
        if (nextHref) {
          if (nextHref.indexOf("http") !== 0) {
            var u = new URL(currentUrl);
            nextHref = u.protocol + "//" + u.hostname + "/" + nextHref.replace(/^\//, "");
          }
          finalUrl = nextHref;
          var sres = yield fetch(finalUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: currentUrl }) });
          pageData = yield sres.text();
        }
      }
      var $ = cheerio.load(pageData);
      var size = $("i#size").text().trim();
      var header = $("div.card-header").text().trim();
      var qm = header.match(/(\d{3,4})[pP]/);
      var quality = qm ? parseInt(qm[1]) : 1080;
      var headerDetails = cleanTitle(header);
      var sizeInBytes = 0;
      var sm2 = size.match(/([\d.]+)\s*(GB|MB|KB)/i);
      if (sm2) { var mults = { GB: Math.pow(1024, 3), MB: Math.pow(1024, 2), KB: 1024 }; sizeInBytes = parseFloat(sm2[1]) * (mults[sm2[2].toUpperCase()] || 0); }
      var links = [];
      var els = $("a.btn").get();
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var link = $(el).attr("href");
        var text = $(el).text().toLowerCase();
        if (!link) continue;
        if (text.indexOf("download file") >= 0 || text.indexOf("fsl server") >= 0 || text.indexOf("s3 server") >= 0 ||
            text.indexOf("fslv2") >= 0 || text.indexOf("mega server") >= 0 || link.indexOf("r2.dev") >= 0 || link.indexOf("r2.cloudflarestorage.com") >= 0) {
          var label = "HubCloud";
          if (link.indexOf("r2.dev") >= 0 || link.indexOf("r2.cloudflarestorage.com") >= 0) label = "Direct R2";
          else if (text.indexOf("fsl server") >= 0) label = "FSL";
          else if (text.indexOf("s3 server") >= 0) label = "S3";
          else if (text.indexOf("fslv2") >= 0) label = "FSLv2";
          else if (text.indexOf("mega server") >= 0) label = "Mega";
          links.push({ source: label, quality: quality, url: link, size: sizeInBytes, fileName: header });
        } else if (text.indexOf("buzzserver") >= 0) {
          try {
            var br = yield fetch(link + "/download", { method: "GET", headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: link }), redirect: "manual" });
            var dl = br.headers.get("hx-redirect") || br.headers.get("HX-Redirect");
            if (!dl && br.url && br.url !== link + "/download") dl = br.url;
            if (dl) links.push({ source: "BuzzServer", quality: quality, url: dl, size: sizeInBytes, fileName: header });
          } catch (e) {}
        } else if (text.indexOf("10gbps") >= 0 || link.indexOf("hubcloud.cx") >= 0) {
          var target = link;
          if (link.indexOf("hubcloud.cx") < 0) {
            try {
              var rr = yield fetch(link, { method: "GET", redirect: "manual" });
              var loc = rr.headers.get("location");
              if (loc && loc.indexOf("link=") >= 0) target = loc.substring(loc.indexOf("link=") + 5);
            } catch (e) {}
          }
          links.push({ source: "10Gbps", quality: quality, url: target, size: sizeInBytes, fileName: header });
        } else if (text.indexOf("zipdisk") >= 0 || link.indexOf("workers.dev") >= 0) {
          links.push({ source: "ZipDisk", quality: quality, url: link, size: sizeInBytes, fileName: header });
        } else if (link.indexOf("pixeldra") >= 0) {
          var pdr = yield pixelDrainExtractor(link);
          for (var k = 0; k < pdr.length; k++) links.push(__spreadProps(__spreadValues({}, pdr[k]), { size: sizeInBytes, fileName: header }));
        } else if (link.indexOf("magnet:") < 0 && link.indexOf("http") === 0) {
          var ext = yield loadExtractor(link, finalUrl);
          for (var j = 0; j < ext.length; j++) links.push(__spreadProps(__spreadValues({}, ext[j]), { quality: ext[j].quality || quality }));
        }
      }
      return links;
    } catch (e) { return []; }
  });
}
function hubCdnExtractor(url, referer) {
  return __async(this, null, function* () {
    try {
      var res = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer }) });
      var data = yield res.text();
      var $ = cheerio.load(data);
      var scriptContent = "";
      $("script").each(function(i, el) { var h = $(el).html(); if (h && h.indexOf("reurl") >= 0) scriptContent = h; });
      if (scriptContent) {
        var m = scriptContent.match(/reurl\s*=\s*["']([^"']+)["']/);
        if (m && m[1]) {
          var rv = m[1];
          if (rv.indexOf("?r=") >= 0) {
            var qp = rv.split("?r=").pop();
            try {
              var dec = atob(qp);
              var m3 = dec.substring(dec.lastIndexOf("link=") + 5);
              if (m3 && m3.indexOf("http") === 0) return [{ source: "HubCdn", quality: 1080, url: m3 }];
            } catch (e) {}
          } else if (rv.indexOf("link=") >= 0) {
            var m3b = rv.split("link=").pop();
            if (m3b && m3b.indexOf("http") === 0) return [{ source: "HubCdn", quality: 1080, url: m3b }];
          } else if (rv.indexOf("http") === 0) return [{ source: "HubCdn", quality: 1080, url: rv }];
        }
      }
      var em = data.match(/r=([A-Za-z0-9+/=]+)/);
      if (em && em[1]) {
        try {
          var dec2 = atob(em[1]);
          var m3c = dec2.substring(dec2.lastIndexOf("link=") + 5);
          if (m3c && m3c.indexOf("http") === 0) return [{ source: "HubCdn", quality: 1080, url: m3c }];
        } catch (e) {}
      }
      return [];
    } catch (e) { return []; }
  });
}
function loadExtractor(_0) {
  return __async(this, arguments, function* (url, referer) {
    referer = referer || MAIN_URL;
    try {
      var hostname = new URL(url).hostname;
      var isRedirect = url.indexOf("?id=") >= 0 || hostname.indexOf("techyboy4u") >= 0 || hostname.indexOf("gadgetsweb") >= 0 ||
        hostname.indexOf("cryptoinsights") >= 0 || hostname.indexOf("bloggingvector") >= 0 || hostname.indexOf("greenmotors") >= 0 ||
        hostname.indexOf("ampproject") >= 0;
      if (isRedirect) {
        var finalLink = yield getRedirectLinks(url);
        if (finalLink && finalLink !== url) return yield loadExtractor(finalLink, url);
        return [];
      }
      if (hostname.indexOf("hubcloud") >= 0) return yield hubCloudExtractor(url, referer);
      if (hostname.indexOf("hubcdn") >= 0) return yield hubCdnExtractor(url, referer);
      if (hostname.indexOf("hblinks") >= 0 || hostname.indexOf("hubstream.dad") >= 0) return yield hbLinksExtractor(url);
      if (hostname.indexOf("pixeldrain") >= 0) return yield pixelDrainExtractor(url);
      if (hostname.indexOf("streamtape") >= 0) return yield streamTapeExtractor(url);
      if (hostname.indexOf("hdstream4u") >= 0) return [{ source: "HdStream4u", quality: 1080, url: url }];
      if (hostname.indexOf("hubdrive") >= 0) {
        var r = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer }) });
        var data = yield r.text();
        var href = cheerio.load(data)(".btn.btn-primary.btn-user.btn-success1.m-1").attr("href");
        if (href) return yield loadExtractor(href, url);
      }
      return [];
    } catch (e) { return []; }
  });
}
function getDownloadLinks(mediaUrl) {
  return __async(this, null, function* () {
    var domain = yield getCurrentDomain();
    if (mediaUrl.indexOf("hdhub4u.") >= 0) {
      try {
        var u = new URL(mediaUrl); var d = new URL(domain);
        u.hostname = d.hostname; mediaUrl = u.toString();
      } catch (e) {}
    }
    var res = yield fetch(mediaUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: domain + "/" }) });
    var data = yield res.text();
    var $ = cheerio.load(data);
    var isMovie = $("h1.page-title span").text().toLowerCase().indexOf("movie") >= 0;

    if (isMovie) {
      var ql = $("h3 a, h4 a").filter(function(i, el) { return $(el).text().match(/480|720|1080|2160|4K/i); });
      var bl = $(".page-body > div a").filter(function(i, el) {
        var href = $(el).attr("href");
        return href && (href.indexOf("hdstream4u") >= 0 || href.indexOf("hubstream") >= 0);
      });
      var initial = [...new Set([...ql.map(function(i, el) { return $(el).attr("href"); }).get(), ...bl.map(function(i, el) { return $(el).attr("href"); }).get()])];
      var all = [];
      for (var i = 0; i < initial.length; i++) { var r = yield loadExtractor(initial[i], mediaUrl); all.push(...r); }
      var seen = new Set();
      return { finalLinks: all.filter(function(l) { if (!l.url || l.url.indexOf(".zip") >= 0) return false; if (seen.has(l.url)) return false; seen.add(l.url); return true; }), isMovie: true };
    } else {
      var map = new Map();
      $("h3, h4").each(function(i, element) {
        var $el = $(element); var text = $el.text();
        var anchors = $el.find("a");
        var links = anchors.map(function(j, a) { return $(a).attr("href"); }).get();
        var epMatch = text.match(/(?:EPiSODE\s*(\d+)|E(\d+))/i);
        if (epMatch) {
          var ep = parseInt(epMatch[1] || epMatch[2]);
          if (!map.has(ep)) map.set(ep, []);
          map.get(ep).push(...links);
          var next = $el.next();
          while (next.length && next.get(0).tagName !== "hr") {
            map.get(ep).push(...next.find("a[href]").map(function(j, a) { return $(a).attr("href"); }).get());
            next = next.next();
          }
        }
      });
      var initial2 = [];
      map.forEach(function(links, ep) { [...new Set(links)].forEach(function(l) { initial2.push({ url: l, episode: ep }); }); });
      var all2 = [];
      for (var k = 0; k < initial2.length; k++) {
        try {
          var ext = yield loadExtractor(initial2[k].url, mediaUrl);
          for (var m2 = 0; m2 < ext.length; m2++) all2.push(__spreadProps(__spreadValues({}, ext[m2]), { episode: initial2[k].episode }));
        } catch (e) {}
      }
      var seen2 = new Set();
      return { finalLinks: all2.filter(function(l) { if (!l.url || l.url.indexOf(".zip") >= 0) return false; if (seen2.has(l.url)) return false; seen2.add(l.url); return true; }), isMovie: false };
    }
  });
}
function parseReleaseInfo(t) {
  t = String(t || "");
  var info = { source: "", codec: "", hdr: "", dv: false, audio: [] };
  if (/bluray|blu-ray|bdrip|brrip/i.test(t)) info.source = "BluRay";
  else if (/web-?dl|webrip/i.test(t)) info.source = "WEB-DL";
  else if (/hdtv/i.test(t)) info.source = "HDTV";
  if (/x265|h\.?265|hevc/i.test(t)) info.codec = "H.265";
  else if (/x264|h\.?264|avc/i.test(t)) info.codec = "H.264";
  if (/hdr10\+/i.test(t)) info.hdr = "HDR10+";
  else if (/hdr10/i.test(t)) info.hdr = "HDR10";
  else if (/\bhdr\b/i.test(t)) info.hdr = "HDR";
  if (/dolby.?vision|dovi|(?:^|[._\-\[ ])dv(?:[._\-\] ]|$)/i.test(t)) info.dv = true;
  var typeTag = "";
  if (/\bhindi\b/i.test(t) || /\bmulti[\s._-]?audio\b/i.test(t)) typeTag = "Multi";
  else if (/\bdual[\s._-]?audio\b/i.test(t)) typeTag = "Dual-Audio";
  var bits = [];
  if (/truehd[\s._-]*7\.1/i.test(t)) bits.push("TrueHD 7.1");
  else if (/ddp[\s._-]*5\.1|eac3/i.test(t)) bits.push("DDP5.1");
  else if (/dd[\s._-]*5\.1|(?:^|[._\- ])ac3(?:[._\- ]|$)/i.test(t)) bits.push("DD5.1");
  else if (/\baac\b/i.test(t)) bits.push("AAC");
  if (/\batmos\b/i.test(t)) bits.push("Atmos");
  if (typeTag) info.audio.push(typeTag);
  for (var i = 0; i < bits.length; i++) info.audio.push(bits[i]);
  return info;
}

function getStreams(tmdbId, mediaType, season, episode, settings) {
  return __async(this, null, function* () {
    mediaType = mediaType || "movie";
    try {
      var mediaInfo = yield getTMDBDetails(tmdbId, mediaType);
      var query = mediaType === "tv" && season ? mediaInfo.title + " Season " + season : mediaInfo.title;
      var selected = yield searchHtml(query, mediaInfo, mediaType, season);
      if (!selected) return [];

      var result = yield getDownloadLinks(selected.url);
      var finalLinks = result.finalLinks;
      if (mediaType === "tv" && episode !== null && episode !== undefined) {
        finalLinks = finalLinks.filter(function(l) { return l.episode === episode; });
      }

      var seSuffix = mediaType === "tv" && season && episode ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0") : "";
      var titleLine = mediaInfo.title + " (" + mediaInfo.year + ")" + seSuffix;

      var streams = finalLinks.map(function(link) {
        var q = link.quality || 0;
        var qStr = q >= 2160 ? "4K" : q ? q + "p" : "";
        var info = parseReleaseInfo(link.fileName || "");
        var tagParts = [];
        if (link.source) tagParts.push(link.source);
        if (info.source) tagParts.push(info.source);
        if (info.codec) tagParts.push(info.codec);
        if (info.hdr) tagParts.push(info.hdr);
        if (info.dv) tagParts.push("DV");
        var tagLine = tagParts.join(" • ");
        var sizeLine = link.size ? formatBytes(link.size) : "";
        var audioLine = info.audio.length ? "Audio: " + info.audio.join(", ") : "";
        var lines = [titleLine];
        if (tagLine) lines.push(tagLine);
        if (sizeLine && sizeLine !== "Unknown") lines.push(sizeLine);
        if (audioLine) lines.push(audioLine);
        var description = lines.join("\n");
        var obj = {
          name: qStr ? "HDHub4u " + qStr : "HDHub4u",
          title: description, size: description, description: description,
          url: link.url, __qr: q, __sb: link.size || 0,
          behaviorHints: { bingeGroup: "hdhub4u-" + link.source }
        };
        if (link.headers && Object.keys(link.headers).length) obj.headers = link.headers;
        return obj;
      });

      streams.sort(function(a, b) { if (b.__qr !== a.__qr) return b.__qr - a.__qr; return b.__sb - a.__sb; });
      for (var i = 0; i < streams.length; i++) {
        var prefix = i < 16 ? String.fromCodePoint(0xFE00 + i) : String.fromCodePoint(0xE0100 + (i - 16));
        streams[i].name = prefix + streams[i].name;
        delete streams[i].__qr;
        delete streams[i].__sb;
      }
      return streams;
    } catch (e) { return []; }
  });
}

module.exports = { getStreams };
