/*
 * VidLink.pro — standalone Nuvio provider.
 *
 * Direct API, no scraping:
 *   TMDB/MAL ID → AES-256-CBC encrypt → vidlink.pro/api/b →
 *   AES-256-CBC decrypt → m3u8 playlist + captions.
 *
 * Supports movie, TV, and anime (pass a `mal:123` ID for anime).
 * No mapper, no shared cache, no external decryption service.
 */

const API_URL  = "https://vidlink.pro/api/b";
const KEY_HEX  = "2de6e6ea13a9df9503b11a6117fd7e51941e04a0c223dfeacfe8a1dbb6c52783";
const UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT  = 15000;

function log(x){ console.log("[VidLink] " + x); }

/* ================= hex / base64 helpers ================= */

function hexToBytes(hex){
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes){
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

function base64Encode(str){
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let i = 0;
  const bytes = new TextEncoder().encode(str);
  while (i < bytes.length) {
    const b1 = bytes[i++];
    const b2 = i < bytes.length ? bytes[i++] : NaN;
    const b3 = i < bytes.length ? bytes[i++] : NaN;
    const e1 = b1 >> 2;
    const e2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4);
    const e3 = isNaN(b2) ? 64 : ((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6);
    const e4 = isNaN(b3) ? 64 : b3 & 63;
    out += chars[e1] + chars[e2] + (e3 === 64 ? "=" : chars[e3]) + (e4 === 64 ? "=" : chars[e4]);
  }
  return out;
}

function base64Decode(str){
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = {};
  for (let i = 0; i < chars.length; i++) lookup[chars[i]] = i;
  const cleaned = str.replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes = [];
  let i = 0;
  while (i < cleaned.length) {
    const e1 = lookup[cleaned[i++]];
    const e2 = lookup[cleaned[i++]];
    const e3 = lookup[cleaned[i++]];
    const e4 = lookup[cleaned[i++]];
    if (e1 === undefined || e2 === undefined) break;
    bytes.push((e1 << 2) | (e2 >> 4));
    if (e3 !== undefined && e3 !== 64) bytes.push(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 !== undefined && e4 !== 64) bytes.push(((e3 & 3) << 6) | e4);
  }
  return new Uint8Array(bytes);
}

/* ================= AES-256-CBC (pure JS) ================= */

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
(function initSBox(){
  const p = 1, q = 1;
  do {
    p = p ^ (p << 1) ^ (p & 0x80 ? 0x1B : 0);
    p &= 0xFF;
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xFF;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 0xFF;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
})();

function xtime(a){ return ((a << 1) ^ (a & 0x80 ? 0x1B : 0)) & 0xFF; }
function mul(a, b){
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xFF;
    if (hi) a ^= 0x1B;
    b >>= 1;
  }
  return p;
}

function keyExpansion(key){
  const Nk = 8;  // AES-256
  const Nr = 14;
  const w = new Uint8Array(4 * (Nr + 1) * 4);
  for (let i = 0; i < Nk * 4; i++) w[i] = key[i];
  let rcon = 1;
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let t = w.subarray((i - 1) * 4, i * 4);
    if (i % Nk === 0) {
      t = new Uint8Array([SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]]);
      rcon = xtime(rcon);
    } else if (i % Nk === 4) {
      t = new Uint8Array([SBOX[t[0]], SBOX[t[1]], SBOX[t[2]], SBOX[t[3]]]);
    }
    for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - Nk) * 4 + j] ^ t[j];
  }
  return { w, Nr };
}

function addRoundKey(state, w, round){
  for (let i = 0; i < 16; i++) state[i] ^= w[round * 16 + i];
}

function subBytes(state, box){
  for (let i = 0; i < 16; i++) state[i] = box[state[i]];
}

function shiftRows(state){
  let t = state[1]; state[1] = state[5]; state[5] = state[9]; state[9] = state[13]; state[13] = t;
  t = state[2]; state[2] = state[10]; state[10] = t; t = state[6]; state[6] = state[14]; state[14] = t;
  t = state[3]; state[3] = state[15]; state[15] = state[11]; state[11] = state[7]; state[7] = t;
}

function invShiftRows(state){
  let t = state[13]; state[13] = state[9]; state[9] = state[5]; state[5] = state[1]; state[1] = t;
  t = state[2]; state[2] = state[10]; state[10] = t; t = state[6]; state[6] = state[14]; state[14] = t;
  t = state[3]; state[3] = state[7]; state[7] = state[11]; state[11] = state[15]; state[15] = t;
}

function mixColumns(state){
  for (let i = 0; i < 4; i++) {
    const a = state[i * 4], b = state[i * 4 + 1], c = state[i * 4 + 2], d = state[i * 4 + 3];
    state[i * 4] = mul(a, 2) ^ mul(b, 3) ^ c ^ d;
    state[i * 4 + 1] = a ^ mul(b, 2) ^ mul(c, 3) ^ d;
    state[i * 4 + 2] = a ^ b ^ mul(c, 2) ^ mul(d, 3);
    state[i * 4 + 3] = mul(a, 3) ^ b ^ c ^ mul(d, 2);
  }
}

function invMixColumns(state){
  for (let i = 0; i < 4; i++) {
    const a = state[i * 4], b = state[i * 4 + 1], c = state[i * 4 + 2], d = state[i * 4 + 3];
    state[i * 4] = mul(a, 14) ^ mul(b, 11) ^ mul(c, 13) ^ mul(d, 9);
    state[i * 4 + 1] = mul(a, 9) ^ mul(b, 14) ^ mul(c, 11) ^ mul(d, 13);
    state[i * 4 + 2] = mul(a, 13) ^ mul(b, 9) ^ mul(c, 14) ^ mul(d, 11);
    state[i * 4 + 3] = mul(a, 11) ^ mul(b, 13) ^ mul(c, 9) ^ mul(d, 14);
  }
}

function encryptBlock(input, w, Nr){
  const state = new Uint8Array(input);
  addRoundKey(state, w, 0);
  for (let round = 1; round < Nr; round++) {
    subBytes(state, SBOX);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, w, round);
  }
  subBytes(state, SBOX);
  shiftRows(state);
  addRoundKey(state, w, Nr);
  return state;
}

function decryptBlock(input, w, Nr){
  const state = new Uint8Array(input);
  addRoundKey(state, w, Nr);
  for (let round = Nr - 1; round >= 1; round--) {
    invShiftRows(state);
    subBytes(state, INV_SBOX);
    addRoundKey(state, w, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  subBytes(state, INV_SBOX);
  addRoundKey(state, w, 0);
  return state;
}

function aesCbcEncrypt(plaintext, key, iv){
  const { w, Nr } = keyExpansion(key);
  const padLen = 16 - (plaintext.length % 16);
  const padded = new Uint8Array(plaintext.length + padLen);
  padded.set(plaintext);
  for (let i = plaintext.length; i < padded.length; i++) padded[i] = padLen;
  let prev = iv;
  const out = new Uint8Array(padded.length);
  for (let i = 0; i < padded.length; i += 16) {
    const block = new Uint8Array(16);
    for (let j = 0; j < 16; j++) block[j] = padded[i + j] ^ prev[j];
    const enc = encryptBlock(block, w, Nr);
    out.set(enc, i);
    prev = enc;
  }
  return out;
}

function aesCbcDecrypt(ciphertext, key, iv){
  const { w, Nr } = keyExpansion(key);
  const out = new Uint8Array(ciphertext.length);
  let prev = iv;
  for (let i = 0; i < ciphertext.length; i += 16) {
    const block = ciphertext.subarray(i, i + 16);
    const dec = decryptBlock(block, w, Nr);
    for (let j = 0; j < 16; j++) out[i + j] = dec[j] ^ prev[j];
    prev = block;
  }
  // strip PKCS#7 padding
  const pad = out[out.length - 1];
  if (pad > 0 && pad <= 16) return out.subarray(0, out.length - pad);
  return out;
}

/* ================= VidLink crypto ================= */

const KEY = hexToBytes(KEY_HEX).subarray(0, 32);

function encryptId(id){
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const enc = aesCbcEncrypt(new TextEncoder().encode(id), KEY, iv);
  return base64Encode(bytesToHex(iv) + ":" + bytesToHex(enc));
}

function decryptResponse(data){
  const parts = String(data).split(":");
  if (parts.length !== 2) throw new Error("bad encrypted response");
  const iv = hexToBytes(parts[0]);
  const enc = hexToBytes(parts[1]);
  const dec = aesCbcDecrypt(enc, KEY, iv);
  return new TextDecoder().decode(dec);
}

/* ================= fetch ================= */

async function vidlinkFetch(url){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/plain, */*" },
      signal: c.signal
    });
    if (!r || !r.ok) return null;
    const text = await r.text();
    return text;
  } catch (e) {
    log("fetch failed: " + e.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* ================= resolver ================= */

async function resolveVidLink(rawId, mediaType, season, episode, dub){
  const id = String(rawId || "").trim();
  if (!id) throw new Error("no id");

  let type, encodedId;

  if (id.startsWith("mal:") || id.startsWith("anime:")) {
    type = "anime";
    const malId = id.replace(/^(mal|anime):/, "");
    encodedId = encryptId(malId);
    const dubParam = dub ? "dub" : "sub";
    const url = `${API_URL}/anime/${encodedId}/${episode}/${dubParam}`;
    log("anime url=" + url.slice(0, 80));
    const enc = await vidlinkFetch(url);
    if (!enc) return null;
    return JSON.parse(decryptResponse(enc));
  }

  if (mediaType === "movie") {
    type = "movie";
    encodedId = encryptId(id);
    const url = `${API_URL}/movie/${encodedId}`;
    log("movie url=" + url.slice(0, 80));
    const enc = await vidlinkFetch(url);
    if (!enc) return null;
    return JSON.parse(decryptResponse(enc));
  }

  // tv
  type = "tv";
  encodedId = encryptId(id);
  const url = `${API_URL}/tv/${encodedId}/${season || 1}/${episode || 1}`;
  log("tv url=" + url.slice(0, 80));
  const enc = await vidlinkFetch(url);
  if (!enc) return null;
  return JSON.parse(decryptResponse(enc));
}

/* ================= Nuvio interface ================= */

async function getStreams(tmdbId, mediaType, season, episode, settings){
  try {
    mediaType = String(mediaType || "tv").toLowerCase();
    const id = String(tmdbId || "").trim();
    if (!id) return [];

    const s = Number(season) || 1;
    const e = Number(episode) || 1;
    const dub = !!(settings && settings.dub === true);

    const data = await resolveVidLink(id, mediaType, s, e, dub);
    if (!data || !data.stream || !data.stream.playlist) {
      log("no stream in response");
      return [];
    }

    const stream = data.stream;
    const captions = Array.isArray(stream.captions) ? stream.captions : [];

    const subtitles = captions.map(c => ({
      url: String(c.url || c.id || ""),
      name: String(c.language || "English"),
      language: String(c.language || "en").toLowerCase().slice(0, 2),
      format: String(c.type || "vtt"),
      default: false
    })).filter(x => x.url);

    return [{
      name: "VidLink",
      title: (mediaType === "movie" ? "Movie" : "Episode " + e) + " [VidLink]",
      url: String(stream.playlist),
      quality: "auto",
      headers: {
        "User-Agent": UA,
        "Referer": "https://vidlink.pro/"
      },
      subtitles: subtitles,
      provider: "vidlink",
      type: "hls"
    }];
  } catch (e) {
    log("ERROR " + (e && e.message || e));
    return [];
  }
}

module.exports = { getStreams };
