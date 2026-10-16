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
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var MAIN_URL = "https://new6.hdhub4u.cl";
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var TYPESENSE_URL = "https://search.hdhub4u.glass/collections/post/documents/search";
var DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000;
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Cookie": "xla=s4t",
  "Referer": MAIN_URL + "/"
};
var domainCacheTimestamp = 0;

function updateMainUrl(url) {
  MAIN_URL = url;
  HEADERS.Referer = url + "/";
}

// ============================================================
// UTILITIES
// ============================================================
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "Unknown";
  var k = 1024;
  var sizes = ["Bytes", "KB", "MB", "GB", "TB"];
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
  var input = String(value).replace(/=+$/, "");
  var output = "";
  var bc = 0, bs, buffer, idx = 0;
  while (buffer = input.charAt(idx++)) {
    buffer = BASE64_CHARS.indexOf(buffer);
    if (~buffer) {
      bs = bc % 4 ? bs * 64 + buffer : buffer;
      if (bc++ % 4) output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
    }
  }
  return output;
}
function cleanTitle(title) {
  var name = String(title || "").replace(/\.[a-zA-Z0-9]{2,4}$/, "");
  var normalized = name.replace(/WEB[-_. ]?DL/gi, "WEB-DL").replace(/WEB[-_. ]?RIP/gi, "WEBRIP")
    .replace(/H[ .]?265/gi, "H265").replace(/H[ .]?264/gi, "H264")
    .replace(/DDP[ .]?([0-9]\.[0-9])/gi, "DDP$1");
  var parts = normalized.split(/[\s_.]/);
  var keep = new Set(["WEB-DL","WEBRIP","BLURAY","HDRIP","DVDRIP","HDTV","CAM","TS","BRRIP","BDRIP",
    "H264","H265","X264","X265","HEVC","AVC","AAC","AC3","DTS","MP3","FLAC","DD","DDP","EAC3",
    "ATMOS","SDR","HDR","HDR10","HDR10+","DV","DOLBYVISION","NF","CR"]);
  var filtered = parts.map(function(p) {
    var u = p.toUpperCase();
    return keep.has(u) ? (u === "DOLBYVISION" ? "DV" : u) : null;
  }).filter(Boolean);
  return [...new Set(filtered)].join(" ");
}
function normalizeTitle(title) {
  if (!title) return "";
  return String(title).toLowerCase().replace(/\b(the|a|an)\b/g, "")
    .replace(/[:\-_]/g, " ").replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}
function calculateTitleSimilarity(t1, t2) {
  var n1 = normalizeTitle(t1), n2 = normalizeTitle(t2);
  if (n1 === n2) return 1;
  var w1 = n1.split(/\s+/).filter(function(w) { return w.length > 0; });
  var w2 = n2.split(/\s+/).filter(function(w) { return w.length > 0; });
  if (w1.length === 0 || w2.length === 0) return 0;
  var set1 = new Set(w1), set2 = new Set(w2);
  var intersection = w1.filter(function(w) { return set2.has(w); });
  var union = new Set([...w1, ...w2]);
  var jaccard = intersection.length / union.size;
  var extra = w2.filter(function(w) { return !set1.has(w); }).length;
  var score = jaccard - extra * 0.05;
  if (w1.every(function(w) { return set2.has(w); })) score += 0.2;
  return score;
}
function findBestTitleMatch(mediaInfo, searchResults, mediaType, season) {
  if (!searchResults || searchResults.length === 0) return null;
  var best = null, bestScore = 0;
  for (var i = 0; i < searchResults.length; i++) {
    var result = searchResults[i];
    var score = calculateTitleSimilarity(mediaInfo.title, result.title);
    if (mediaInfo.year && result.year) {
      var diff = Math.abs(mediaInfo.year - result.year);
      if (diff === 0) score += 0.2;
      else if (diff <= 1) score += 0.1;
      else if (diff > 5) score -= 0.3;
    }
    if (mediaType === "tv" && season) {
      var lower = result.title.toLowerCase();
      var patterns = ["season " + season, "s" + season, "season " + String(season).padStart(2, "0"), "s" + String(season).padStart(2, "0")];
      var hasSeason = patterns.some(function(p) { return lower.indexOf(p) >= 0; });
      var otherMatch = lower.match(/season\s*(\d+)|s(\d+)/i);
      if (otherMatch) {
        var found = parseInt(otherMatch[1] || otherMatch[2]);
        if (found !== season) score -= 0.8;
      }
      if (hasSeason) score += 0.5;
      else score -= 0.3;
    }
    if (result.title.toLowerCase().indexOf("2160p") >= 0 || result.title.toLowerCase().indexOf("4k") >= 0) score += 0.05;
    if (score > bestScore && score > 0.3) { bestScore = score; best = result; }
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
          if (newDomain !== MAIN_URL) {
            updateMainUrl(newDomain);
            domainCacheTimestamp = now;
          }
        }
      }
    } catch (error) {}
  });
}
function getCurrentDomain() {
  return __async(this, null, function* () {
    yield fetchAndUpdateDomain();
    return MAIN_URL;
  });
}
function getTMDBDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&append_to_response=external_ids";
    var response = yield fetch(url, { method: "GET", headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error("TMDB API error: " + response.status);
    var data = yield response.json();
    var title = mediaType === "tv" ? data.name : data.title;
    var releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
    var year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
    return { title: title, year: year, imdbId: (data.external_ids && data.external_ids.imdb_id) || null };
  });
}

// ============================================================
// EXTRACTORS
// ============================================================
function getRedirectLinks(url) {
  return __async(this, null, function* () {
    try {
      var response = yield fetch(url, { headers: HEADERS });
      if (!response.ok) throw new Error("HTTP " + response.status);
      var doc = yield response.text();
      var regex = /s\s*\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=]+)['"]|ck\s*\(\s*['"]_wp_http_\d+['"]\s*,\s*['"]([^'"]+)['"]/g;
      var combinedString = "", match;
      while ((match = regex.exec(doc)) !== null) {
        var v = match[1] || match[2];
        if (v) combinedString += v;
      }
      if (!combinedString) {
        var rm = doc.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
        if (rm && rm[1]) {
          var newUrl = rm[1];
          if (newUrl !== url && newUrl.indexOf(url) < 0) return yield getRedirectLinks(newUrl);
        }
        return null;
      }
      var decodedString = atob(rot13(atob(atob(combinedString))));
      var jsonObject = JSON.parse(decodedString);
      var encodedUrl = atob(jsonObject.o || "").trim();
      if (encodedUrl) return encodedUrl;
      var data = atob(jsonObject.data || "").trim();
      var wpHttp = (jsonObject.blog_url || "").trim();
      if (wpHttp && data) {
        var directLinkResponse = yield fetch(wpHttp + "?re=" + data, { headers: HEADERS });
        var html = yield directLinkResponse.text();
        var $ = cheerio.load(html);
        return ($("body").text() || html).trim();
      }
      return null;
    } catch (e) { return null; }
  });
}
function vidStackExtractor(url) {
  return __async(this, null, function* () {
    try {
      var hash = url.split("#").pop().split("/").pop();
      var baseUrl = new URL(url).origin;
      var apiUrl = baseUrl + "/api/v1/video?id=" + hash;
      var response = yield fetch(apiUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) });
      var encoded = (yield response.text()).trim();
      var key = CryptoJS.enc.Utf8.parse("kiemtienmua911ca");
      var ivs = ["1234567890oiuytr", "0123456789abcdef"];
      for (var i = 0; i < ivs.length; i++) {
        try {
          var iv = CryptoJS.enc.Utf8.parse(ivs[i]);
          var decrypted = CryptoJS.AES.decrypt(
            { ciphertext: CryptoJS.enc.Hex.parse(encoded) },
            key,
            { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
          );
          var decText = decrypted.toString(CryptoJS.enc.Utf8);
          if (decText && decText.indexOf("source") >= 0) {
            var m = decText.match(/"source":"(.*?)"/);
            var m3u8 = m && m[1] && m[1].replace(/\\/g, "");
            if (m3u8) {
              return [{
                source: "Hubstream",
                quality: 1080,
                url: m3u8,
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
function hbLinksExtractor(url) {
  return __async(this, null, function* () {
    try {
      var response = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: url }) });
      var data = yield response.text();
      var $ = cheerio.load(data);
      var links = [...new Set($("h3 a, h5 a, div.entry-content p a, div.entry-content a").map(function(i, el) { return $(el).attr("href"); }).get().filter(Boolean))];
      var results = [];
      for (var i = 0; i < links.length; i++) {
        var r = yield loadExtractor(links[i], url);
        results.push(...r.map(function(l) { return __spreadProps(__spreadValues({}, l), { source: l.source + " Hblinks" }); }));
      }
      return results;
    } catch (e) { return []; }
  });
}
function pixelDrainExtractor(link) {
  return __async(this, null, function* () {
    try {
      var urlObj = new URL(link);
      var baseUrl = urlObj.protocol + "//" + urlObj.hostname;
      var m = link.match(/(?:file|u)\/([A-Za-z0-9]+)/);
      var fileId = (m && m[1]) || link.split("/").pop();
      if (!fileId) return [{ source: "Pixeldrain", quality: 0, url: link }];
      var finalUrl = link.indexOf("?download") >= 0 ? link : baseUrl + "/api/file/" + fileId + "?download";
      return [{ source: "Pixeldrain", quality: 0, url: finalUrl }];
    } catch (e) {
      return [{ source: "Pixeldrain", quality: 0, url: link }];
    }
  });
}
function streamTapeExtractor(link) {
  return __async(this, null, function* () {
    try {
      var url = new URL(link);
      url.hostname = "streamtape.com";
      var res = yield fetch(url.toString(), { headers: HEADERS });
      var data = yield res.text();
      var m1 = data.match(/document\.getElementById\('videolink'\)\.innerHTML = (.*?);/);
      var videoSrc = m1 && m1[1] && (m1[1].match(/'(\/\/streamtape\.com\/get_video[^']+)'/) || [])[1];
      if (!videoSrc) {
        var m2 = data.match(/'(\/\/streamtape\.com\/get_video[^']+)'/);
        videoSrc = m2 && m2[1];
      }
      return videoSrc ? [{ source: "StreamTape", quality: 720, url: "https:" + videoSrc }] : [];
    } catch (e) { return []; }
  });
}
function hubCloudExtractor(url, referer) {
  return __async(this, null, function* () {
    try {
      var currentUrl = url.replace("hubcloud.ink", "hubcloud.dad");
      var pageResponse = yield fetch(currentUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer }) });
      var pageData = yield pageResponse.text();
      var finalUrl = currentUrl;
      if (currentUrl.indexOf("hubcloud.php") < 0) {
        var nextHref = "";
        var $first = cheerio.load(pageData);
        var downloadBtn = $first("#download");
        if (downloadBtn.length) nextHref = downloadBtn.attr("href");
        else {
          var sm = pageData.match(/var url = '([^']*)'/);
          if (sm) nextHref = sm[1];
        }
        if (nextHref) {
          if (nextHref.indexOf("http") !== 0) {
            var urlObj = new URL(currentUrl);
            nextHref = urlObj.protocol + "//" + urlObj.hostname + "/" + nextHref.replace(/^\//, "");
          }
          finalUrl = nextHref;
          var secondResponse = yield fetch(finalUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: currentUrl }) });
          pageData = yield secondResponse.text();
        }
      }
      var $ = cheerio.load(pageData);
      var size = $("i#size").text().trim();
      var header = $("div.card-header").text().trim();
      var qm = header.match(/(\d{3,4})[pP]/);
      var quality = qm ? parseInt(qm[1]) : 1080;
      var headerDetails = cleanTitle(header);
      var labelExtras = (headerDetails ? "[" + headerDetails + "]" : "") + (size ? "[" + size + "]" : "");
      var sizeInBytes = 0;
      var sm2 = size.match(/([\d.]+)\s*(GB|MB|KB)/i);
      if (sm2) {
        var mults = { GB: Math.pow(1024, 3), MB: Math.pow(1024, 2), KB: 1024 };
        sizeInBytes = parseFloat(sm2[1]) * (mults[sm2[2].toUpperCase()] || 0);
      }
      var links = [];
      var elements = $("a.btn").get();
      for (var i = 0; i < elements.length; i++) {
        var element = elements[i];
        var link = $(element).attr("href");
        var text = $(element).text().toLowerCase();
        var fileName = header || headerDetails || "Unknown";
        if (!link) continue;

        if (text.indexOf("download file") >= 0 || text.indexOf("fsl server") >= 0 || text.indexOf("s3 server") >= 0 ||
            text.indexOf("fslv2") >= 0 || text.indexOf("mega server") >= 0 || link.indexOf("r2.dev") >= 0) {
          var label = "HubCloud";
          if (link.indexOf("r2.dev") >= 0) label = "Direct R2";
          else if (link.indexOf("workers.dev") >= 0) label = "ZipDisk";
          else if (text.indexOf("fsl server") >= 0) label = "HubCloud - FSL";
          else if (text.indexOf("s3 server") >= 0) label = "HubCloud - S3";
          else if (text.indexOf("fslv2") >= 0) label = "HubCloud - FSLv2";
          else if (text.indexOf("mega server") >= 0) label = "HubCloud - Mega";
          links.push({ source: label + " " + labelExtras, quality: quality, url: link, size: sizeInBytes, fileName: fileName });
        } else if (text.indexOf("buzzserver") >= 0) {
          try {
            var buzzResp = yield fetch(link + "/download", { method: "GET", headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: link }), redirect: "manual" });
            var dlink = buzzResp.headers.get("hx-redirect") || buzzResp.headers.get("HX-Redirect");
            if (!dlink && buzzResp.url && buzzResp.url !== link + "/download") dlink = buzzResp.url;
            if (dlink) links.push({ source: "HubCloud - BuzzServer " + labelExtras, quality: quality, url: dlink, size: sizeInBytes, fileName: fileName });
          } catch (e) {}
        } else if (text.indexOf("10gbps") >= 0 || link.indexOf("hubcloud.cx") >= 0) {
          var targetUrl = link;
          if (link.indexOf("hubcloud.cx") < 0) {
            try {
              var resp = yield fetch(link, { method: "GET", redirect: "manual" });
              var loc = resp.headers.get("location");
              if (loc && loc.indexOf("link=") >= 0) targetUrl = loc.substring(loc.indexOf("link=") + 5);
            } catch (e) {}
          }
          links.push({ source: "HubCloud - 10Gbps " + labelExtras, quality: quality, url: targetUrl, size: sizeInBytes, fileName: fileName });
        } else if (text.indexOf("zipdisk") >= 0 || link.indexOf("workers.dev") >= 0) {
          links.push({ source: "ZipDisk Server " + labelExtras, quality: quality, url: link, size: sizeInBytes, fileName: fileName });
        } else if (link.indexOf("pixeldra") >= 0) {
          var pdResults = yield pixelDrainExtractor(link);
          for (var j = 0; j < pdResults.length; j++) {
            links.push(__spreadProps(__spreadValues({}, pdResults[j]), { source: pdResults[j].source + " " + labelExtras, size: sizeInBytes, fileName: fileName }));
          }
        } else if (link.indexOf("magnet:") < 0 && link.indexOf("http") === 0) {
          var extracted = yield loadExtractor(link, finalUrl);
          for (var k = 0; k < extracted.length; k++) {
            links.push(__spreadProps(__spreadValues({}, extracted[k]), { quality: extracted[k].quality || quality }));
          }
        }
      }
      return links;
    } catch (e) { return []; }
  });
}
function hubCdnExtractor(url, referer) {
  return __async(this, null, function* () {
    try {
      var response = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer }) });
      var data = yield response.text();
      var $ = cheerio.load(data);
      var scriptContent = "";
      $("script").each(function(i, el) {
        var html = $(el).html();
        if (html && html.indexOf("reurl") >= 0) scriptContent = html;
      });
      if (scriptContent) {
        var m = scriptContent.match(/reurl\s*=\s*["']([^"']+)["']/);
        if (m && m[1]) {
          var reurlVal = m[1];
          if (reurlVal.indexOf("?r=") >= 0) {
            var queryPart = reurlVal.split("?r=").pop();
            try {
              var decoded = atob(queryPart);
              var m3u8Link = decoded.substring(decoded.lastIndexOf("link=") + 5);
              if (m3u8Link && m3u8Link.indexOf("http") === 0) return [{ source: "HubCdn", quality: 1080, url: m3u8Link }];
            } catch (e) {}
          } else if (reurlVal.indexOf("link=") >= 0) {
            var m3u8Link2 = reurlVal.split("link=").pop();
            if (m3u8Link2 && m3u8Link2.indexOf("http") === 0) return [{ source: "HubCdn", quality: 1080, url: m3u8Link2 }];
          } else if (reurlVal.indexOf("http") === 0) {
            return [{ source: "HubCdn", quality: 1080, url: reurlVal }];
          }
        }
      }
      var encodedMatch = data.match(/r=([A-Za-z0-9+/=]+)/);
      if (encodedMatch && encodedMatch[1]) {
        try {
          var decoded2 = atob(encodedMatch[1]);
          var m3u8Link3 = decoded2.substring(decoded2.lastIndexOf("link=") + 5);
          if (m3u8Link3 && m3u8Link3.indexOf("http") === 0) return [{ source: "HubCdn", quality: 1080, url: m3u8Link3 }];
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
      var isRedirect = url.indexOf("?id=") >= 0
        || hostname.indexOf("techyboy4u") >= 0
        || hostname.indexOf("gadgetsweb.xyz") >= 0
        || hostname.indexOf("cryptoinsights.site") >= 0
        || hostname.indexOf("bloggingvector") >= 0
        || hostname.indexOf("ampproject.org") >= 0;
      if (isRedirect) {
        var finalLink = yield getRedirectLinks(url);
        if (finalLink && finalLink !== url) return yield loadExtractor(finalLink, url);
        return [];
      }
      if (hostname.indexOf("hubcloud") >= 0) return yield hubCloudExtractor(url, referer);
      if (hostname.indexOf("hubcdn") >= 0) return yield hubCdnExtractor(url, referer);
      if (hostname.indexOf("hblinks") >= 0 || hostname.indexOf("hubstream.dad") >= 0) return yield hbLinksExtractor(url);
      if (hostname.indexOf("hubstream") >= 0 || hostname.indexOf("vidstack") >= 0) return yield vidStackExtractor(url);
      if (hostname.indexOf("pixeldrain") >= 0) return yield pixelDrainExtractor(url);
      if (hostname.indexOf("streamtape") >= 0) return yield streamTapeExtractor(url);
      if (hostname.indexOf("hdstream4u") >= 0) return [{ source: "HdStream4u", quality: 1080, url: url }];
      if (hostname.indexOf("hubdrive") >= 0) {
        var res = yield fetch(url, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer }) });
        var data = yield res.text();
        var href = cheerio.load(data)(".btn.btn-primary.btn-user.btn-success1.m-1").attr("href");
        if (href) return yield loadExtractor(href, url);
      }
      return [];
    } catch (e) { return []; }
  });
}

// ============================================================
// SEARCH + SCRAPE
// ============================================================
function search(query) {
  return __async(this, null, function* () {
    var today = (new Date()).toISOString().split("T")[0];
    var searchUrl = TYPESENSE_URL + "?q=" + encodeURIComponent(query) + "&query_by=post_title,category&query_by_weights=4,2&sort_by=sort_by_date:desc&limit=15&highlight_fields=none&use_cache=true&page=1&analytics_tag=" + today;
    var response = yield fetch(searchUrl, { headers: HEADERS });
    var data = yield response.json();
    if (!data || !data.hits) return [];
    return data.hits.map(function(hit) {
      var doc = hit.document;
      var title = doc.post_title;
      var yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
      var year = yearMatch ? parseInt(yearMatch[1] || yearMatch[2]) : null;
      var url = doc.permalink;
      if (url && url.indexOf("/") === 0) url = MAIN_URL + url;
      return { title: title, url: url, poster: doc.post_thumbnail, year: year };
    });
  });
}
function getDownloadLinks(mediaUrl) {
  return __async(this, null, function* () {
    var domain = yield getCurrentDomain();
    if (mediaUrl.indexOf("hdhub4u.") >= 0) {
      try {
        var urlObj = new URL(mediaUrl);
        var domainObj = new URL(domain);
        urlObj.hostname = domainObj.hostname;
        mediaUrl = urlObj.toString();
      } catch (e) {}
    }
    var response = yield fetch(mediaUrl, { headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: domain + "/" }) });
    var data = yield response.text();
    var $ = cheerio.load(data);
    var typeRaw = $("h1.page-title span").text();
    var isMovie = typeRaw.toLowerCase().indexOf("movie") >= 0;

    if (isMovie) {
      var qualityLinks = $("h3 a, h4 a").filter(function(i, el) { return $(el).text().match(/480|720|1080|2160|4K/i); });
      var bodyLinks = $(".page-body > div a").filter(function(i, el) {
        var href = $(el).attr("href");
        return href && (href.indexOf("hdstream4u") >= 0 || href.indexOf("hubstream") >= 0);
      });
      var initialLinks = [...new Set([
        ...qualityLinks.map(function(i, el) { return $(el).attr("href"); }).get(),
        ...bodyLinks.map(function(i, el) { return $(el).attr("href"); }).get()
      ])];
      var results = [];
      for (var i = 0; i < initialLinks.length; i++) {
        var r = yield loadExtractor(initialLinks[i], mediaUrl);
        results.push(...r);
      }
      var seen = new Set();
      var unique = results.filter(function(l) {
        if (!l.url || l.url.indexOf(".zip") >= 0) return false;
        if (seen.has(l.url)) return false;
        seen.add(l.url);
        return true;
      });
      return { finalLinks: unique, isMovie: true };
    } else {
      // TV — collect per-episode
      var episodeLinksMap = new Map();
      var directLinkBlocks = [];
      $("h3, h4").each(function(i, element) {
        var $el = $(element);
        var text = $el.text();
        var anchors = $el.find("a");
        var links = anchors.map(function(j, a) { return $(a).attr("href"); }).get();
        var isDirect = anchors.get().some(function(a) { return $(a).text().match(/1080|720|4K|2160/i); });
        if (isDirect) { directLinkBlocks.push(...links); return; }
        var epMatch = text.match(/(?:EPiSODE\s*(\d+)|E(\d+))/i);
        if (epMatch) {
          var epNum = parseInt(epMatch[1] || epMatch[2]);
          if (!episodeLinksMap.has(epNum)) episodeLinksMap.set(epNum, []);
          episodeLinksMap.get(epNum).push(...links);
          var nextElement = $el.next();
          while (nextElement.length && nextElement.get(0).tagName !== "hr") {
            var sibLinks = nextElement.find("a[href]").map(function(j, a) { return $(a).attr("href"); }).get();
            episodeLinksMap.get(epNum).push(...sibLinks);
            nextElement = nextElement.next();
          }
        }
      });
      // Process direct blocks
      for (var dbi = 0; dbi < directLinkBlocks.length; dbi++) {
        try {
          var resolvedUrl = yield getRedirectLinks(directLinkBlocks[dbi]);
          if (!resolvedUrl) continue;
          var blockRes = yield fetch(resolvedUrl, { headers: HEADERS });
          var blockData = yield blockRes.text();
          var $$ = cheerio.load(blockData);
          $$("h5 a, h4 a, h3 a").each(function(i, el) {
            var linkText = $$(el).text();
            var linkHref = $$(el).attr("href");
            var epMatch2 = linkText.match(/Episode\s*(\d+)/i);
            if (epMatch2 && linkHref) {
              var epN = parseInt(epMatch2[1]);
              if (!episodeLinksMap.has(epN)) episodeLinksMap.set(epN, []);
              episodeLinksMap.get(epN).push(linkHref);
            }
          });
        } catch (e) {}
      }
      var initialLinks2 = [];
      episodeLinksMap.forEach(function(links, epNum) {
        var uniqueLinks = [...new Set(links)];
        uniqueLinks.forEach(function(link) { initialLinks2.push({ url: link, episode: epNum }); });
      });
      var results2 = [];
      for (var li = 0; li < initialLinks2.length; li++) {
        try {
          var ext = yield loadExtractor(initialLinks2[li].url, mediaUrl);
          for (var ei = 0; ei < ext.length; ei++) {
            results2.push(__spreadProps(__spreadValues({}, ext[ei]), { episode: initialLinks2[li].episode }));
          }
        } catch (e) {}
      }
      var seen2 = new Set();
      var unique2 = results2.filter(function(l) {
        if (!l.url || l.url.indexOf(".zip") >= 0) return false;
        if (seen2.has(l.url)) return false;
        seen2.add(l.url);
        return true;
      });
      return { finalLinks: unique2, isMovie: false };
    }
  });
}

// ============================================================
// SETTINGS
// ============================================================
function onSettings() {
  return [
    {
      type: "select",
      key: "sort",
      name: "sort",
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
  var s = { sortBy: "quality" };
  try {
    var settings = input;
    if (!settings && typeof globalThis !== "undefined") settings = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!settings && typeof global !== "undefined") settings = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!settings && typeof window !== "undefined") settings = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (settings) {
      var rawSort = settings.sort || settings.sortBy || settings.sort_by || "";
      if (typeof rawSort === "object" && rawSort !== null) rawSort = rawSort.value || rawSort.key || "";
      var normSort = String(rawSort).toLowerCase().trim();
      if (normSort === "size" || normSort === "largest") s.sortBy = "size";
    }
  } catch (e) {}
  return s;
}

// ============================================================
// RELEASE INFO
// ============================================================
function parseReleaseInfo(releaseTitle) {
  var t = String(releaseTitle || "");
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
  var codecBits = [];
  if (/truehd[\s._-]*7\.1/i.test(t)) codecBits.push("TrueHD 7.1");
  else if (/ddp[\s._-]*5\.1|eac3/i.test(t)) codecBits.push("DDP5.1");
  else if (/dd[\s._-]*5\.1|(?:^|[._\- ])ac3(?:[._\- ]|$)/i.test(t)) codecBits.push("DD5.1");
  else if (/\baac\b/i.test(t)) codecBits.push("AAC");
  if (/\batmos\b/i.test(t)) codecBits.push("Atmos");
  if (typeTag) info.audio.push(typeTag);
  for (var i = 0; i < codecBits.length; i++) info.audio.push(codecBits[i]);
  return info;
}

// ============================================================
// MAIN
// ============================================================
function getStreams(tmdbId, mediaType, season, episode, settings) {
  return __async(this, null, function* () {
    mediaType = mediaType || "movie";
    var resolved = resolveSettings(settings);
    try {
      var mediaInfo = yield getTMDBDetails(tmdbId, mediaType);
      var searchQuery = mediaType === "tv" && season ? mediaInfo.title + " Season " + season : mediaInfo.title;
      var searchResults = yield search(searchQuery);
      if (searchResults.length === 0) return [];
      var bestMatch = findBestTitleMatch(mediaInfo, searchResults, mediaType, season);
      var selectedMedia = bestMatch || searchResults[0];

      var result = yield getDownloadLinks(selectedMedia.url);
      var finalLinks = result.finalLinks;
      var filteredLinks = finalLinks;
      if (mediaType === "tv" && episode !== null && episode !== undefined) {
        filteredLinks = finalLinks.filter(function(link) { return link.episode === episode; });
      }

      var seSuffix = mediaType === "tv" && season && episode
        ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
        : "";
      var titleLine = mediaInfo.title + " (" + mediaInfo.year + ")" + seSuffix;

      var streams = filteredLinks.map(function(link) {
        var qualityStr = "";
        if (typeof link.quality === "number" && link.quality > 0) {
          if (link.quality >= 2160) qualityStr = "4K";
          else qualityStr = link.quality + "p";
        } else if (typeof link.quality === "string") {
          qualityStr = link.quality;
        }

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
        if (sizeLine && sizeLine !== "0 B" && sizeLine !== "Unknown") lines.push(sizeLine);
        if (audioLine) lines.push(audioLine);
        var description = lines.join("\n");

        var baseName = qualityStr ? "HDHub4u " + qualityStr : "HDHub4u";

        var obj = {
          name: baseName,
          title: description,
          size: description,
          description: description,
          url: link.url,
          __qr: link.quality || 0,
          __sb: link.size || 0,
          behaviorHints: { bingeGroup: "hdhub4u-" + link.source }
        };
        if (link.headers && Object.keys(link.headers).length > 0) obj.headers = link.headers;
        return obj;
      });

      if (resolved.sortBy === "size") {
        streams.sort(function(a, b) { return b.__sb - a.__sb; });
      } else {
        streams.sort(function(a, b) {
          if (b.__qr !== a.__qr) return b.__qr - a.__qr;
          return b.__sb - a.__sb;
        });
      }

      for (var i = 0; i < streams.length; i++) {
        var r = streams[i];
        var prefix = "";
        if (i < 16) prefix = String.fromCodePoint(0xFE00 + i);
        else if (i < 256) prefix = String.fromCodePoint(0xE0100 + (i - 16));
        r.name = prefix + r.name;
        delete r.__qr;
        delete r.__sb;
      }
      return streams;
    } catch (error) {
      return [];
    }
  });
}

module.exports = { getStreams, onSettings };
