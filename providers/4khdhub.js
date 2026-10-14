"use strict";

const BASE_URL      = "https://4khdhub.click";
const TMDB_API_KEY  = "439c478a771f35c05022f9feabcca01c";
const USER_AGENT    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
const DOMAINS_URL   = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";

const domainCache = { url: BASE_URL, ts: 0 };

/* ============================================================
 * FETCH
 * ============================================================ */

async function fetchLatestDomain() {
  const now = Date.now();
  if (now - domainCache.ts < 3600000) return domainCache.url;
  try {
    const response = await fetch(DOMAINS_URL);
    const data = await response.json();
    if (data && data["4khdhub"]) {
      domainCache.url = data["4khdhub"];
      domainCache.ts = now;
    }
  } catch (e) {}
  return domainCache.url;
}

async function fetchText(url, options) {
  options = options || {};
  const retries = options.retries !== undefined ? options.retries : 2;
  const delay   = options.delay   !== undefined ? options.delay   : 1000;
  for (let i = 0; i <= retries; i++) {
    try {
      const headers = Object.assign({ "User-Agent": USER_AGENT }, options.headers || {});
      const response = await fetch(url, { headers: headers });
      return await response.text();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.log("[4KHDHub] Request failed for " + url + ": " + msg + (i < retries ? ", retrying (" + (i + 1) + "/" + retries + ")..." : ""));
    }
    if (i < retries) await new Promise(function (r) { setTimeout(r, delay * Math.pow(2, i)); });
  }
  return null;
}

async function getTmdbDetails(tmdbId, type) {
  const isSeries = type === "series" || type === "tv";
  const endpoint = isSeries ? "tv" : "movie";
  const url = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (isSeries) return { title: data.name, year: data.first_air_date ? parseInt(data.first_air_date.split("-")[0]) : 0 };
    return { title: data.title, year: data.release_date ? parseInt(data.release_date.split("-")[0]) : 0 };
  } catch (error) {
    console.log("[4KHDHub] TMDB request failed: " + error.message);
    return null;
  }
}

/* ============================================================
 * HTML HELPERS (pure regex, no cheerio)
 * ============================================================ */

function attrValue(attrs, name) {
  const dq = new RegExp("\\b" + name + "\\s*=\\s*\"([^\"]*)\"").exec(attrs);
  if (dq) return dq[1];
  const sq = new RegExp("\\b" + name + "\\s*=\\s*'([^']*)'").exec(attrs);
  return sq ? sq[1] : "";
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]*>/g, "")).trim();
}

function findAnchors(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({
      attrs: m[1],
      inner: m[2],
      href: attrValue(m[1], "href"),
      text: stripTags(m[2])
    });
  }
  return out;
}

function classText(html, className) {
  const re = new RegExp("class\\s*=\\s*[\"'][^\"']*\\b" + className + "\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)(?=<[a-z/]|$)", "i");
  const m = re.exec(html);
  if (!m) return "";
  return stripTags(m[1]);
}

function splitByClass(html, className) {
  const out = [];
  const tagRe = /<[a-z][a-z0-9]*\b[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>/gi;
  const positions = [];
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const classes = m[1].split(/\s+/);
    if (classes.indexOf(className) >= 0) positions.push(m.index);
  }
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : html.length;
    out.push(html.slice(start, end));
  }
  return out;
}

/* ============================================================
 * PRIMITIVES
 * ============================================================ */

function atob(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let str = String(input).replace(/=+$/, "");
  if (str.length % 4 === 1) throw new Error("'atob' failed");
  let output = "";
  for (let bc = 0, bs, buffer, i = 0; (buffer = str.charAt(i++)); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    buffer = chars.indexOf(buffer);
  }
  return output;
}

function rot13Cipher(str) {
  return str.replace(/[a-zA-Z]/g, function (c) {
    return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
  });
}

function levenshteinDistance(s, t) {
  if (s === t) return 0;
  const n = s.length, m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const d = [];
  for (let i = 0; i <= n; i++) { d[i] = []; d[i][0] = i; }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
  }
  return d[n][m];
}

function parseBytes(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const match = val.match(/^([0-9.]+)\s*([a-zA-Z]+)$/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  let multiplier = 1;
  if (unit.indexOf("k") === 0) multiplier = 1024;
  else if (unit.indexOf("m") === 0) multiplier = 1024 * 1024;
  else if (unit.indexOf("g") === 0) multiplier = 1024 * 1024 * 1024;
  else if (unit.indexOf("t") === 0) multiplier = 1024 * 1024 * 1024 * 1024;
  return num * multiplier;
}

function formatBytes(val) {
  if (val === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  let i = Math.floor(Math.log(val) / Math.log(k));
  if (i < 0) i = 0;
  return parseFloat((val / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/* ============================================================
 * SETTINGS
 * ============================================================ */

function onSettings() {
  return [
    {
      type: "select",
      key: "source",
      name: "source",
      label: "Preferred Source",
      options: [
        { label: "FSL",              value: "fsl" },
        { label: "HubCloud 10Gbps",  value: "hubcloud" },
        { label: "Direct R2",        value: "r2" },
        { label: "ZipDisk",          value: "zipdisk" },
        { label: "All Sources",      value: "all" }
      ],
      default: "fsl"
    },
    {
      type: "select",
      key: "sort",
      name: "sort",
      label: "Sort By",
      options: [
        { label: "Quality first (4K → 1080p → 720p)", value: "quality" },
        { label: "Size first (largest file on top)",  value: "size" }
      ],
      default: "quality"
    }
  ];
}

function resolveSettings(input) {
  const LABEL_MAP = {
    fsl: "FSL",
    hubcloud: "HubCloud 10Gbps",
    "hubcloud 10gbps": "HubCloud 10Gbps",
    r2: "Direct R2",
    "direct r2": "Direct R2",
    zipdisk: "ZipDisk Server",
    "zipdisk server": "ZipDisk Server",
    hblinks: "Hblinks Direct",
    "hblinks direct": "Hblinks Direct",
    all: null,
    any: null
  };
  let s = { sourceLabel: "FSL", sortBy: "quality" };
  try {
    let settings = input;
    if (!settings && typeof globalThis !== "undefined") settings = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!settings && typeof global !== "undefined")     settings = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!settings && typeof window !== "undefined")     settings = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (settings) {
      let rawSrc = settings.source || settings.src || settings.preferred_source || "";
      if (typeof rawSrc === "object" && rawSrc !== null) rawSrc = rawSrc.value || rawSrc.key || "";
      const normSrc = String(rawSrc).toLowerCase().trim();
      if (normSrc && LABEL_MAP.hasOwnProperty(normSrc)) s.sourceLabel = LABEL_MAP[normSrc];

      let rawSort = settings.sort || settings.sortBy || settings.sort_by || "";
      if (typeof rawSort === "object" && rawSort !== null) rawSort = rawSort.value || rawSort.key || "";
      const normSort = String(rawSort).toLowerCase().trim();
      if (normSort === "size" || normSort === "largest") s.sortBy = "size";
      else s.sortBy = "quality";
    }
  } catch (e) {
    console.log("[4KHDHub] settings parse error: " + e.message);
  }
  return s;
}

/* ============================================================
 * RELEASE INFO
 * ============================================================ */

function parseReleaseInfo(releaseTitle) {
  const t = String(releaseTitle || "");
  const info = { source: "", codec: "", hdr: "", dv: false, audio: [] };
  if (/bluray|blu-ray|bdrip|brrip/i.test(t)) info.source = "BluRay";
  else if (/web-?dl|webrip/i.test(t))        info.source = "WEB-DL";
  else if (/hdtv/i.test(t))                  info.source = "HDTV";
  if (/x265|h\.?265|hevc/i.test(t))          info.codec = "H.265";
  else if (/x264|h\.?264|avc/i.test(t))      info.codec = "H.264";
  if (/hdr10\+/i.test(t))                    info.hdr = "HDR10+";
  else if (/hdr10/i.test(t))                 info.hdr = "HDR10";
  else if (/\bhdr\b/i.test(t))               info.hdr = "HDR";
  if (/dolby.?vision|dovi|(?:^|[._\-\[ ])dv(?:[._\-\] ]|$)/i.test(t)) info.dv = true;

  let typeTag = "";
  if (/\bhindi\b/i.test(t) || /\bmulti[\s._-]?audio\b/i.test(t)) typeTag = "Multi";
  else if (/\bdual[\s._-]?audio\b/i.test(t))                     typeTag = "Dual-Audio";

  const codecBits = [];
  if (/truehd[\s._-]*7\.1/i.test(t))                 codecBits.push("TrueHD 7.1");
  else if (/ddp[\s._-]*5\.1|eac3/i.test(t))          codecBits.push("DDP5.1");
  else if (/dd[\s._-]*5\.1|(?:^|[._\- ])ac3(?:[._\- ]|$)/i.test(t)) codecBits.push("DD5.1");
  else if (/\baac\b/i.test(t))                       codecBits.push("AAC");
  if (/\batmos\b/i.test(t))                          codecBits.push("Atmos");

  if (typeTag) info.audio.push(typeTag);
  for (const c of codecBits) info.audio.push(c);
  return info;
}

/* ============================================================
 * PAGE FETCH + REDIRECT RESOLUTION
 * ============================================================ */

async function fetchPageUrl(name, year, isSeries) {
  const domain = await fetchLatestDomain();
  const searchUrl = domain + "/?s=" + encodeURIComponent(name + " " + year);
  console.log("[4KHDHub] Search Request URL: " + searchUrl);
  const html = await fetchText(searchUrl);
  if (!html) { console.log("[4KHDHub] Search failed: No HTML response"); return null; }

  const targetType = isSeries ? "Series" : "Movies";
  const anchors = findAnchors(html);
  const matching = [];

  for (const a of anchors) {
    const fmt = classText(a.inner, "movie-card-format");
    if (!fmt) continue;
    if (fmt.indexOf(targetType) < 0) continue;

    const metaText = classText(a.inner, "movie-card-meta");
    const cardYear = parseInt(metaText);
    if (isNaN(cardYear) || Math.abs(cardYear - year) > 1) continue;

    const cardTitle = classText(a.inner, "movie-card-title").replace(/\[.*?]/g, "").trim();
    const distance = levenshteinDistance(cardTitle.toLowerCase(), name.toLowerCase());
    if (distance >= 5) continue;

    let href = a.href;
    if (href && href.indexOf("http") !== 0) {
      href = domain + (href.charAt(0) === "/" ? "" : "/") + href;
    }
    if (href) matching.push(href);
  }

  return matching.length > 0 ? matching[0] : null;
}

async function resolveRedirectUrl(redirectUrl) {
  if (redirectUrl.indexOf("hubcloud.") >= 0 || redirectUrl.indexOf("hubdrive.") >= 0) return redirectUrl;
  const redirectHtml = await fetchText(redirectUrl);
  if (!redirectHtml) return redirectUrl;
  try {
    const redirectDataMatch = redirectHtml.match(/'o','(.*?)'/);
    if (!redirectDataMatch) return redirectUrl;
    const step1 = atob(redirectDataMatch[1]);
    const step2 = atob(step1);
    const step3 = rot13Cipher(step2);
    const step4 = atob(step3);
    const redirectData = JSON.parse(step4);
    if (redirectData && redirectData.o) return atob(redirectData.o);
  } catch (e) {
    console.log("[4KHDHub] Error resolving redirect: " + e.message);
  }
  return redirectUrl;
}

/* ============================================================
 * EXTRACTION
 * ============================================================ */

async function extractSourceResults(itemHtml) {
  const sizeMatch = itemHtml.match(/([\d.]+ ?[GM]B)/);
  const heightMatch = itemHtml.match(/\d{3,}p/);
  const title = classText(itemHtml, "file-title") || classText(itemHtml, "episode-file-title");
  let height = heightMatch ? parseInt(heightMatch[0]) : 0;
  if (height === 0 && (title.indexOf("4K") >= 0 || itemHtml.indexOf("4K") >= 0 || itemHtml.indexOf("4k") >= 0)) height = 2160;
  const meta = { bytes: sizeMatch ? parseBytes(sizeMatch[1]) : 0, height: height, title: title };

  const anchors = findAnchors(itemHtml);

  for (const a of anchors) {
    if (a.href && (a.href.indexOf("hblinks") >= 0 || a.href.indexOf("hubstream.dad") >= 0)) {
      return { url: new URL(a.href, BASE_URL).toString(), meta: meta, extractor: "hblinks" };
    }
  }

  for (const a of anchors) {
    if (!a.href) continue;
    if (a.text.indexOf("HubCloud") >= 0 || a.href.indexOf("hubcloud.") >= 0 || a.href.indexOf("hubcloud/") >= 0) {
      const resolved = await resolveRedirectUrl(a.href);
      return { url: resolved, meta: meta };
    }
  }

  for (const a of anchors) {
    if (!a.href) continue;
    if (a.text.indexOf("HubDrive") >= 0 || a.href.indexOf("hubdrive.") >= 0 || a.href.indexOf("hubdrive/") >= 0) {
      const resolvedDrive = await resolveRedirectUrl(a.href);
      if (resolvedDrive) {
        const driveHtml = await fetchText(resolvedDrive);
        if (driveHtml) {
          const innerAnchors = findAnchors(driveHtml);
          for (const inner of innerAnchors) {
            if (!inner.href) continue;
            if (inner.text.indexOf("HubCloud") >= 0 || inner.href.indexOf("hubcloud.") >= 0 || inner.href.indexOf("hubcloud/") >= 0) {
              return { url: inner.href, meta: meta };
            }
          }
        }
      }
    }
  }

  return null;
}

async function extractHubCloud(hubCloudUrl, baseMeta) {
  if (!hubCloudUrl) return [];
  const redirectHtml = await fetchText(hubCloudUrl, { headers: { Referer: hubCloudUrl } });
  if (!redirectHtml) return [];
  const redirectUrlMatch = redirectHtml.match(/var url ?= ?'(.*?)'/);
  if (!redirectUrlMatch) return [];
  const finalLinksUrl = redirectUrlMatch[1];
  const linksHtml = await fetchText(finalLinksUrl, { headers: { Referer: hubCloudUrl } });
  if (!linksHtml) return [];

  const results = [];
  const sizeMatch = linksHtml.match(/id="size"[^>]*>([^<]+)</i);
  const titleMatch = linksHtml.match(/<title>([^<]+)<\/title>/i);
  const sizeText = sizeMatch ? stripTags(sizeMatch[1]) : "";
  const titleText = titleMatch ? stripTags(titleMatch[1]) : "";
  const currentMeta = Object.assign({}, baseMeta, {
    bytes: parseBytes(sizeText) || baseMeta.bytes,
    title: titleText || baseMeta.title
  });

  const anchors = findAnchors(linksHtml);
  for (const a of anchors) {
    if (!a.href) continue;
    const text = a.text;
    const href = a.href;
    if (text.indexOf("10Gbps") >= 0 || text.indexOf("PixelServer") >= 0 || href.indexOf("hubcloud.cx") >= 0) {
      results.push({ source: "HubCloud 10Gbps", url: href, meta: currentMeta });
    } else if (text.indexOf("Download File") >= 0 || href.indexOf("r2.dev") >= 0) {
      results.push({ source: "Direct R2", url: href, meta: currentMeta });
    } else if (text.indexOf("ZipDisk") >= 0 || href.indexOf("workers.dev") >= 0) {
      results.push({ source: "ZipDisk Server", url: href, meta: currentMeta });
    } else if (text.indexOf("FSL") >= 0) {
      results.push({ source: "FSL", url: href, meta: currentMeta });
    }
  }
  return results;
}

async function extractHblinks(hblinksUrl, baseMeta, depth) {
  depth = depth || 0;
  if (!hblinksUrl || depth > 2) return [];
  try {
    const html = await fetchText(hblinksUrl, { headers: { Referer: hblinksUrl } });
    if (!html) return [];

    const seenLinks = {};
    const orderedLinks = [];
    const anchors = findAnchors(html);
    for (const a of anchors) {
      if (!a.href) continue;
      if (seenLinks[a.href]) continue;
      seenLinks[a.href] = 1;
      orderedLinks.push(a.href);
    }

    const results = [];
    for (const rawLink of orderedLinks) {
      try {
        const absoluteLink = new URL(rawLink, hblinksUrl).toString();
        const resolvedLink = await resolveRedirectUrl(absoluteLink);
        const link = resolvedLink || absoluteLink;
        const hostname = new URL(link).hostname.toLowerCase();

        if (hostname.indexOf("hblinks") >= 0 || hostname.indexOf("hubstream.dad") >= 0) {
          const nested = await extractHblinks(link, baseMeta, depth + 1);
          for (const n of nested) results.push(n);
        } else if (hostname.indexOf("hubcloud") >= 0) {
          const cloud = await extractHubCloud(link, baseMeta);
          for (const n of cloud) results.push(n);
        } else if (hostname.indexOf("hubdrive") >= 0) {
          const driveHtml = await fetchText(link, { headers: { Referer: hblinksUrl } });
          if (driveHtml) {
            const innerAnchors = findAnchors(driveHtml);
            for (const inner of innerAnchors) {
              if (!inner.href) continue;
              if (inner.text.indexOf("HubCloud") >= 0 || inner.href.indexOf("hubcloud.") >= 0 || inner.href.indexOf("hubcloud/") >= 0) {
                const cloud = await extractHubCloud(new URL(inner.href, link).toString(), baseMeta);
                for (const n of cloud) results.push(n);
                break;
              }
            }
          }
        } else if (/\.(m3u8|mpd|mp4|mkv)(?:$|\?)/i.test(link)) {
          results.push({ source: "Hblinks Direct", url: link, meta: baseMeta });
        }
      } catch (e) {}
    }
    return results;
  } catch (e) {
    return [];
  }
}

/* ============================================================
 * MAIN
 * ============================================================ */

async function getStreams(tmdbId, type, season, episode, settings) {
  const resolved = resolveSettings(settings);
  console.log("[4KHDHub] Preferred source: " + (resolved.sourceLabel || "all") + " | Sort: " + resolved.sortBy);

  const tmdbDetails = await getTmdbDetails(tmdbId, type);
  if (!tmdbDetails) return [];
  const title = tmdbDetails.title;
  const year  = tmdbDetails.year;
  const isSeries = type === "series" || type === "tv";

  const pageUrl = await fetchPageUrl(title, year, isSeries);
  if (!pageUrl) { console.log("[4KHDHub] Page not found"); return []; }
  const html = await fetchText(pageUrl);
  if (!html) return [];

  const itemsToProcess = [];
  if (isSeries && season && episode) {
    const seasonStr  = "S" + String(season).padStart(2, "0");
    const episodeStr = "Episode-" + String(episode).padStart(2, "0");
    const episodeItems = splitByClass(html, "episode-item");
    for (const epItem of episodeItems) {
      const titleText = classText(epItem, "episode-title");
      if (titleText.indexOf(seasonStr) < 0) continue;
      const downloadItems = splitByClass(epItem, "episode-download-item");
      for (const item of downloadItems) {
        if (stripTags(item).indexOf(episodeStr) >= 0) itemsToProcess.push(item);
      }
    }
  } else {
    const downloadItems = splitByClass(html, "download-item");
    for (const item of downloadItems) itemsToProcess.push(item);
  }
  console.log("[4KHDHub] Processing " + itemsToProcess.length + " items");

  const seSuffix = isSeries && season && episode
    ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
    : "";
  const titleLine = title + " (" + year + ")" + seSuffix;

  const streamPromises = itemsToProcess.map(async function (item) {
    try {
      const sourceResult = await extractSourceResults(item);
      if (!sourceResult || !sourceResult.url) return [];
      let extractedLinks;
      if (sourceResult.extractor === "hblinks") extractedLinks = await extractHblinks(sourceResult.url, sourceResult.meta);
      else extractedLinks = await extractHubCloud(sourceResult.url, sourceResult.meta);

      return extractedLinks.map(function (link) {
        const height = sourceResult.meta.height || 0;
        const qualityShort = height === 2160 ? "4K" : height ? height + "p" : "";

        const info = parseReleaseInfo(link.meta.title);

        const tagParts = [];
        if (link.source)   tagParts.push(link.source);
        if (info.source)   tagParts.push(info.source);
        if (info.codec)    tagParts.push(info.codec);
        if (info.hdr)      tagParts.push(info.hdr);
        if (info.dv)       tagParts.push("DV");
        const tagLine = tagParts.join(" • ");

        const sizeLine = formatBytes(link.meta.bytes || 0);
        const audioLine = info.audio.length ? "Audio: " + info.audio.join(", ") : "";

        const lines = [titleLine];
        if (tagLine) lines.push(tagLine);
        if (sizeLine && sizeLine !== "0 B") lines.push(sizeLine);
        if (audioLine) lines.push(audioLine);
        const description = lines.join("\n");

        const baseName = qualityShort ? "4KHDHub " + qualityShort : "4KHDHub";

        return {
          name: baseName,
          title: description,
          size: description,
          description: description,
          url: link.url,
          __qr: height,
          __sb: link.meta.bytes || 0,
          behaviorHints: { bingeGroup: "4khdhub-" + link.source }
        };
      });
    } catch (err) {
      console.log("[4KHDHub] Item processing error: " + err.message);
      return [];
    }
  });

  const results = await Promise.all(streamPromises);
  const flat = [];
  for (const r of results) for (const x of r) flat.push(x);

  const visible = resolved.sourceLabel
    ? flat.filter(function (r) { return r.behaviorHints && r.behaviorHints.bingeGroup === "4khdhub-" + resolved.sourceLabel; })
    : flat;
  console.log("[4KHDHub] Filter (" + (resolved.sourceLabel || "all") + "): " + visible.length + "/" + flat.length);

  const seenKeys = {};
  const deduped = [];
  for (const r of visible) {
    const key = (r.description || "").replace(/\n/g, "|");
    if (seenKeys[key]) continue;
    seenKeys[key] = 1;
    deduped.push(r);
  }
  console.log("[4KHDHub] After dedupe: " + deduped.length + "/" + visible.length + " kept");

  if (resolved.sortBy === "size") {
    deduped.sort(function (a, b) { return b.__sb - a.__sb; });
  } else {
    deduped.sort(function (a, b) {
      if (b.__qr !== a.__qr) return b.__qr - a.__qr;
      return b.__sb - a.__sb;
    });
  }

  for (let i = 0; i < deduped.length; i++) {
    const r = deduped[i];
    let prefix = "";
    if (i < 16) prefix = String.fromCodePoint(0xFE00 + i);
    else if (i < 256) prefix = String.fromCodePoint(0xE0100 + (i - 16));
    r.name = prefix + r.name;
    delete r.__qr;
    delete r.__sb;
  }
  return deduped;
}

module.exports = { getStreams, onSettings };
