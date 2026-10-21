/*
 * Anikoto Nuvio provider. (Self-Contained)
 */
const BASE="https://anikototv.to";
const AJAX=BASE+"/ajax";
const TMDB_BASE="https://api.themoviedb.org/3";
const TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
const ARM_BASE="https://arm.haglund.dev/api/v2";
const ANILIST_URL="https://graphql.anilist.co";
const UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
const AJAX_HEADERS={
  "Referer":BASE+"/",
  "X-Requested-With":"XMLHttpRequest",
  "User-Agent":UA,
  "Accept":"*/*"
};
const SERVER_BUDGET_MS=4000;
const EXTRACT_TIMEOUT_MS=4000;
const SERVER_RESOLVE_TIMEOUT_MS=4000;

function log(x){console.log("[Anikoto] "+x);}

/* ================= self-contained fetch helpers ================= */
async function req(url, options, timeout){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout || 12000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch(e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url, options, timeout){
  const r = await req(url, options, timeout);
  if(!r || !r.ok) return "";
  try { return await r.text(); } catch(e) { return ""; }
}

async function getJson(url, options, timeout){
  const r = await req(url, options, timeout);
  if(!r || !r.ok) return null;
  try { return await r.json(); } catch(e) { return null; }
}
/* ================================================================ */

/* ================= self-contained cache ================= */
class TTLCache{
  constructor(){ this.m = new Map(); }
  get(k){
    const x = this.m.get(k);
    if(!x) return undefined;
    if(x.e <= Date.now()){ this.m.delete(k); return undefined; }
    return x.v;
  }
  set(k, v, ttl){ this.m.set(k, {v: v, e: Date.now() + ttl}); return v; }
  delete(k){ this.m.delete(k); }
}
const CACHE = new TTLCache();

async function memo(key, ttl, fn){
  const hit = CACHE.get(key);
  if(hit !== undefined) return await Promise.resolve(hit);
  const p = Promise.resolve().then(fn);
  CACHE.set(key, p, ttl);
  try{
    const v = await p;
    if(v === null || v === undefined) CACHE.delete(key);
    else CACHE.set(key, v, ttl);
    return v;
  }catch(e){
    CACHE.delete(key);
    throw e;
  }
}

/* ================= anikoto-specific concurrency ================= */
async function settle(tasks,limit){
  limit=limit||4;
  const out=[];
  const queue=tasks.slice();
  async function worker(){
    while(queue.length){
      const task=queue.shift();
      try{out.push(await task());}catch(e){}
    }
  }
  const n=Math.min(Math.max(1,limit),queue.length);
  const arr=[];
  for(let i=0;i<n;i++)arr.push(worker());
  await Promise.all(arr);
  return out;
}

/* ================= HTML parsing ================= */
function decodeEntities(s){
  return String(s||"")
    .replace(/&#x([0-9a-f]+);?/gi,function(_,h){return String.fromCharCode(parseInt(h,16));})
    .replace(/&#(\d+);?/g,function(_,n){return String.fromCharCode(Number(n));})
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&apos;/gi,"'")
    .replace(/&#39;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">");
}
function parseAttrs(raw){
  const a={};
  const re=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while((m=re.exec(raw||""))){
    const k=String(m[1]||"").toLowerCase();
    if(!k||k==="div"||k==="a"||k==="img"||k==="span"||k==="ul"||k==="li"||k==="script")continue;
    a[k]=decodeEntities(m[2]!==undefined?m[2]:m[3]!==undefined?m[3]:m[4]!==undefined?m[4]:"");
  }
  return a;
}
function parseHTML(html){
  const root={tag:"#root",attrs:{},children:[],text:""};
  const stack=[root];
  const src=String(html||"").replace(/<!--[\s\S]*?-->/g,"");
  const token=/<\/?[^>]+>|[^<]+/g;
  let m;
  while((m=token.exec(src))){
    const t=m[0];
    const parent=stack[stack.length-1];
    if(t[0]!=="<"){parent.children.push({tag:"#text",attrs:{},children:[],text:decodeEntities(t)});continue;}
    if(/^<\s*\//.test(t)){
      const name=(t.match(/^<\s*\/\s*([^\s>]+)/)||[])[1];
      if(!name)continue;
      for(let i=stack.length-1;i>0;i--){
        if(stack[i].tag===String(name).toLowerCase()){stack.length=i;break;}
      }
      continue;
    }
    if(/^<\s*!/.test(t)||/^<\s*\?/.test(t))continue;
    const mm=t.match(/^<\s*([^\s/>]+)/);
    if(!mm)continue;
    const tag=String(mm[1]).toLowerCase();
    const selfClosing=/\/\s*>$/.test(t)||/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag);
    const node={tag:tag,attrs:parseAttrs(t.slice(mm[0].length,-(selfClosing?2:1))),children:[],text:""};
    parent.children.push(node);
    if(!selfClosing)stack.push(node);
  }
  return root;
}
function all(root,selector){
  const out=[];
  const sel=String(selector||"").trim();
  const am=sel.match(/^\[([^\]=]+)\]$/);
  if(am){
    const key=am[1].toLowerCase();
    (function visitAttr(n){
      if(!n)return;
      if(n.tag!=="#text"&&Object.prototype.hasOwnProperty.call(n.attrs,key))out.push(n);
      const cs=n.children||[];
      for(let i=0;i<cs.length;i++)visitAttr(cs[i]);
    })(root);
    return out;
  }
  const m=sel.match(/^([a-z0-9_-]+)?(?:#([a-z0-9_-]+))?(?:\.([a-z0-9_.-]+))?$/i);
  if(!m)return out;
  const tag=m[1]&&m[1].toLowerCase();
  const id=m[2];
  const classes=(m[3]||"").split(".").filter(Boolean);
  function visit(n){
    if(!n)return;
    if(n.tag!=="#text"){
      const okTag=!tag||n.tag===tag;
      const okId=!id||String(n.attrs.id||"")===id;
      const cs=String(n.attrs.class||"").split(/\s+/);
      let okClass=true;
      for(let i=0;i<classes.length;i++)if(cs.indexOf(classes[i])<0){okClass=false;break;}
      if(okTag&&okId&&okClass)out.push(n);
    }
    const kids=n.children||[];
    for(let i=0;i<kids.length;i++)visit(kids[i]);
  }
  visit(root);
  return out;
}
function first(root,selector){return all(root,selector)[0]||null;}
function attr(n,k){return n&&n.attrs?String(n.attrs[String(k).toLowerCase()]||""):"";}
function nodeText(n){
  if(!n)return"";
  if(n.tag==="#text")return n.text||"";
  return (n.children||[]).map(nodeText).join(" ");
}
function directChildren(n){return (n&&n.children||[]).filter(function(x){return x&&x.tag!=="#text";});}

/* ================= CLIENT-SIDE MAPPER ================= */
function cleanTitle(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function mapperLookup(rawId, season = 1, episode = 1) {
  let id = String(rawId);
  let mediaType = "tv";
  
  if (id.includes(":")) {
    const parts = id.split(":");
    mediaType = parts[0];
    id = parts[1];
  } else if (id.startsWith("tt")) {
    mediaType = "imdb";
  }

  let tmdbId = null;
  let anilistId = null;

  try {
    if (mediaType === "tvdb") {
      const arm = await getJson(`${ARM_BASE}/thetvdb?id=${id}`);
      if (Array.isArray(arm) && arm[0]?.themoviedb) tmdbId = arm[0].themoviedb;
    } else if (mediaType === "anilist") {
      anilistId = id;
      const arm = await getJson(`${ARM_BASE}/anilist?id=${id}`);
      if (Array.isArray(arm) && arm[0]?.themoviedb) tmdbId = arm[0].themoviedb;
    } else if (mediaType === "imdb") {
      const find = await getJson(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
      if (find?.tv_results?.length > 0) tmdbId = find.tv_results[0].id;
      else if (find?.movie_results?.length > 0) { tmdbId = find.movie_results[0].id; mediaType = "movie"; }
    } else {
      tmdbId = id;
    }
  } catch (e) {}

  if (!tmdbId && anilistId) {
    return { malId: null, malEpisode: episode, title: "", titles: [], anilistId };
  }
  if (!tmdbId) return null;

  let airDate = null;
  let episodeTitle = null;
  let showTitle = "";

  try {
    if (mediaType === "movie") {
      const tmdb = await getJson(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
      if (tmdb) {
        airDate = tmdb.release_date;
        showTitle = tmdb.title || tmdb.original_title;
      }
    } else {
      const [show, ep] = await Promise.all([
        getJson(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`),
        getJson(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`)
      ]);
      if (show) showTitle = show.name || show.original_name;
      if (ep) {
        airDate = ep.air_date;
        episodeTitle = ep.name;
      }
    }
  } catch (e) {}

  if (!showTitle) return null;

  const query = `query($search:String){Page(perPage:20){media(search:$search,type:ANIME){id idMal title{romaji english} startDate{year month day} endDate{year month day} episodes streamingEpisodes{title}}}}`;
  const aniRes = await getJson(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { search: showTitle } })
  });

  const candidates = aniRes?.data?.Page?.media || [];
  let bestCandidate = null;

  if (airDate) {
    const targetDate = new Date(airDate);
    for (const anime of candidates) {
      const s = anime.startDate;
      if (!s.year || !s.month || !s.day) continue;
      const start = new Date(s.year, s.month - 1, s.day);
      
      if (anime.endDate && anime.endDate.year) {
        const e = anime.endDate;
        const end = new Date(e.year, (e.month || 12) - 1, e.day || 31);
        end.setDate(end.getDate() + 3);
        if (targetDate >= start && targetDate <= end) { bestCandidate = anime; break; }
      } else {
        if (targetDate >= start) { bestCandidate = anime; break; }
      }
    }
  }

  if (!bestCandidate) bestCandidate = candidates[0];
  if (!bestCandidate) return null;

  let targetEpisode = episode;
  const maxEpisodes = bestCandidate.episodes || 0;

  if (season > 1 || (maxEpisodes > 0 && episode > maxEpisodes)) {
    let titleMatchFound = false;
    if (episodeTitle && bestCandidate.streamingEpisodes?.length > 0) {
      const cleanTgt = cleanTitle(episodeTitle);
      for (let i = 0; i < bestCandidate.streamingEpisodes.length; i++) {
        const cleanAl = cleanTitle(bestCandidate.streamingEpisodes[i].title);
        if (cleanTgt && cleanAl && (cleanAl.includes(cleanTgt) || cleanTgt.includes(cleanAl))) {
          targetEpisode = i + 1;
          titleMatchFound = true;
          break;
        }
      }
    }
    if (!titleMatchFound && season > 1) {
      targetEpisode = episode + ((season - 1) * 12); 
    }
  }

  return {
    malId: bestCandidate.idMal ? String(bestCandidate.idMal) : null,
    malEpisode: targetEpisode,
    title: bestCandidate.title.english || bestCandidate.title.romaji,
    titles: [bestCandidate.title.english, bestCandidate.title.romaji].filter(Boolean),
    anilistId: String(bestCandidate.id)
  };
}

/* ================= TMDB ================= */
async function tmdbInfo(tmdbId,mediaType){
  const type=mediaType==="movie"?"movie":"tv";
  const url=TMDB_BASE+"/"+type+"/"+encodeURIComponent(tmdbId)+"?api_key="+TMDB_API_KEY+"&language=en-US";
  return await getJson(url,{headers:{"Accept":"application/json","User-Agent":UA}},6000);
}

/* ================= title matching ================= */
function normalizeTitle(s){
  let x=String(s||"").toLowerCase().replace(/&/g,"and");
  try{x=x.normalize("NFKD").replace(/[\u0300-\u036f]/g,"");}catch(e){}
  return x.replace(/[^a-z0-9]+/g,"").trim();
}
function searchTitleBase(s){
  return String(s||"").split(":")[0].replace(/\b(?:season|saison)\s*\d+\b/ig,"").replace(/\b\d+(?:st|nd|rd|th)\s+season\b/ig,"").trim();
}
function titleSeason(s){
  const x=String(s||"");
  let m=x.match(/\bseason\s*([0-9]+)\b/i);            if(m)return Number(m[1]);
  m=x.match(/\b([0-9]+)(?:st|nd|rd|th)\s*season\b/i); if(m)return Number(m[1]);
  m=x.match(/\bsaison\s*([0-9]+)\b/i);                if(m)return Number(m[1]);
  m=x.match(/\bs([0-9]{1,2})(?:\b|[-\s])/i);          if(m)return Number(m[1]);
  m=x.match(/\b(ii|iii|iv|vi|vii|viii)\b/i);
  if(m)return {ii:2,iii:3,iv:4,vi:6,vii:7,viii:8}[m[1].toLowerCase()]||null;
  return null;
}
function cardScore(card,targets,base,season){
  const ct=normalizeTitle(card.name);
  const cb=normalizeTitle(base);
  let best=0;
  for(let i=0;i<targets.length;i++){
    const nt=normalizeTitle(targets[i]);
    if(!nt)continue;
    if(ct===nt)best=Math.max(best,1000);
    else if(ct.indexOf(nt)>=0||nt.indexOf(ct)>=0)best=Math.max(best,800);
    else{
      const nb=normalizeTitle(searchTitleBase(targets[i]));
      if(nb&&(ct===nb||ct.indexOf(nb)>=0||nb.indexOf(ct)>=0))best=Math.max(best,650);
    }
  }
  if(cb&&ct===cb)best=Math.max(best,900);

  const explicit=titleSeason(card.name);
  if(explicit!==null){
    if(explicit===season)best+=200;
    else best-=1500;
  }else if(season>1){
    const cleanBase = normalizeTitle(String(base).replace(/\b(?:season|saison)\s*\d+\b/ig, "").replace(/\b\d+(?:st|nd|rd|th)\s+season\b/ig, "").trim());
    if(cleanBase && (ct === cleanBase || ct.indexOf(cleanBase) >= 0 || cleanBase.indexOf(ct) >= 0)) {
      best -= 5000;
    }
  }else if(season===1&&/\b(?:season|saison)\s*\d+\b/i.test(card.name)){
    best-=700;
  }
  return best;
}

/* ================= anikoto search pipeline ================= */
function parseSearchCards(html){
  const root=parseHTML(html);
  const container=first(root,"div.scaff.items");
  if(!container)return [];
  const direct=directChildren(container);
  const out=[];
  const seen={};
  for(let i=0;i<direct.length;i++){
    const item=direct[i];
    let card=item;
    let href=attr(card,"href");
    if(!href){
      const a=first(card,"a");
      if(!a)continue;
      href=attr(a,"href");
    }
    if(!href||seen[href])continue;
    const titleNode=first(card,".name.d-title");
    const name=decodeEntities(nodeText(titleNode||card)).replace(/\s+/g," ").trim();
    if(!name)continue;
    const img=first(card,"img");
    seen[href]=1;
    out.push({name:name,href:href,img:attr(img,"src")||""});
  }
  if(!out.length){
    const links=all(container,"a");
    for(let i=0;i<links.length;i++){
      const a=links[i];
      const href=attr(a,"href");
      if(!href||seen[href])continue;
      const titleNode=first(a,".name.d-title");
      const name=decodeEntities(nodeText(titleNode||a)).replace(/\s+/g," ").trim();
      if(!name)continue;
      const img=first(a,"img");
      seen[href]=1;
      out.push({name:name,href:href,img:attr(img,"src")||""});
    }
  }
  return out;
}

async function search(query){
  const q=String(query||"").trim();
  if(!q)return [];
  const key="anikoto:search:"+normalizeTitle(q);
  const hit=CACHE.get(key);
  if(hit!==undefined){ log("SEARCH CACHE HIT "+q); return await Promise.resolve(hit); }
  log("SEARCH CACHE MISS "+q);
  const started=Date.now();
  const d=await getJson(AJAX+"/anime/search?keyword="+encodeURIComponent(q),{headers:AJAX_HEADERS},5000);
  const html=d&&d.result&&d.result.html;
  if(!html)return [];
  const cards=parseSearchCards(html);
  log("SEARCH "+q+" results="+cards.length+" "+(Date.now()-started)+"ms");
  if(cards.length)CACHE.set(key,cards,600000);
  return cards;
}
function absoluteUrl(href){
  try{return new URL(href,BASE+"/").toString();}catch(e){return BASE+(String(href||"").charAt(0)==="/"?href:"/"+href);}
}
async function findAnime(target,season){
  const rawQueries=[target.title].concat(target.titles||[]).filter(Boolean);
  const queries=[];
  for(let i=0;i<rawQueries.length;i++){
    const q=String(rawQueries[i]);
    queries.push(q);
    const b=searchTitleBase(q);
    if(b&&b!==q)queries.push(b);
  }
  const unique=[];
  const seenQ={};
  for(let i=0;i<queries.length;i++){
    const t=queries[i].trim();
    if(!t||seenQ[t])continue;
    seenQ[t]=1;
    unique.push(t);
  }
  if(!unique.length)return null;

  const firstCards=await search(unique[0]);
  let allCards=firstCards.slice();
  const seen={};
  const deduped=[];
  for(let i=0;i<allCards.length;i++){
    const c=allCards[i];
    const k=String(c.href);
    if(!seen[k]){seen[k]=1;deduped.push(c);}
  }
  let scored=deduped.map(function(c){return {c:c,score:cardScore(c,unique,target.title,season)};})
    .filter(function(x){return x.score>0;}).sort(function(a,b){return b.score-a.score;});
  if(scored[0]&&scored[0].score>=700){
    log("ANIME FAST MATCH "+scored[0].c.name+" score="+scored[0].score);
    return scored[0].c;
  }

  const rest=unique.slice(1,6);
  if(!rest.length)return scored[0]?scored[0].c:null;
  const tasks=rest.map(function(q){return function(){return search(q);};});
  const results=await settle(tasks,rest.length);
  for(let i=0;i<results.length;i++){
    const rs=results[i]||[];
    for(let j=0;j<rs.length;j++){
      const c=rs[j];
      const key=String(c.href);
      if(!seen[key]){seen[key]=1;deduped.push(c);}
    }
  }
  if(!deduped.length)return null;
  scored=deduped.map(function(c){return {c:c,score:cardScore(c,unique,target.title,season)};})
    .filter(function(x){return x.score>0;}).sort(function(a,b){return b.score-a.score;});
  const best=scored[0];
  if(!best)return null;
  log("ANIME MATCH "+best.c.name+" score="+best.score);
  return best.c;
}

async function getAnimeId(animeUrl){
  const key="anikoto:animeid:"+animeUrl;
  return await memo(key,600000,async function(){
    const started=Date.now();
    const html=await getText(animeUrl,{headers:AJAX_HEADERS},6000);
    if(!html)return null;
    const root=parseHTML(html);
    const watch=first(root,"div#watch-main");
    const id=attr(watch,"data-id").trim();
    if(!id){log("ANIME ID NOT FOUND");return null;}
    log("ANIME ID "+id+" "+(Date.now()-started)+"ms");
    return id;
  });
}
async function getEpisodes(animeId){
  const key="anikoto:episodes:"+animeId;
  return await memo(key,600000,async function(){
    const started=Date.now();
    const d=await getJson(AJAX+"/episode/list/"+encodeURIComponent(animeId)+"?vrf=",{headers:AJAX_HEADERS},6000);
    const html=d&&d.result;
    if(!html)return [];
    const root=parseHTML(html);
    const box=first(root,"div.episodes");
    if(!box)return [];
    const out=[];
    const seen={};
    const links=all(box,"a");
    for(let i=0;i<links.length;i++){
      const a=links[i];
      const id=attr(a,"data-ids").trim();
      const num=Number(attr(a,"data-num"));
      if(!id||!Number.isInteger(num)||num<1||seen[id])continue;
      seen[id]=1;
      out.push({
        episodeId:id,
        episodeNumber:num,
        malId:attr(a,"data-mal").trim(),
        hasDub:attr(a,"data-dub")==="1",
        title:attr(a,"title").trim(),
        href:attr(a,"href").trim()
      });
    }
    out.sort(function(a,b){return a.episodeNumber-b.episodeNumber;});
    log("EPISODES="+out.length+" "+(Date.now()-started)+"ms");
    return out;
  });
}
async function getServerList(episodeId){
  const key="anikoto:servers:"+episodeId;
  return await memo(key,120000,async function(){
    const started=Date.now();
    const d=await getJson(AJAX+"/server/list?servers="+encodeURIComponent(episodeId),{headers:AJAX_HEADERS},5000);
    const html=d&&d.result;
    if(!html)return [];
    const root=parseHTML(html);
    const out=[];
    const groups=all(root,"div.servers");
    for(let gi=0;gi<groups.length;gi++){
      const group=groups[gi];
      const groupKids=directChildren(group);
      const groupName=nodeText(groupKids[0]||group).replace(/\s+/g," ").trim();
      const types=all(group,"div.type");
      for(let ti=0;ti<types.length;ti++){
        const type=types[ti];
        const rawType=attr(type,"data-type").toLowerCase();
        const dataType=rawType.indexOf("dub")>=0?"dub":"sub";
        const items=all(type,"[data-link-id]");
        for(let ii=0;ii<items.length;ii++){
          const item=items[ii];
          const linkId=attr(item,"data-link-id").trim();
          if(!linkId)continue;
          const serverName=nodeText(item).replace(/\s+/g," ").trim();
          out.push({srv_name:serverName||"Anikoto",link_id:linkId,group_name:groupName,dataType:dataType});
        }
      }
    }
    if(!out.length){
      const items=all(root,"[data-link-id]");
      for(let i=0;i<items.length;i++){
        const item=items[i];
        const linkId=attr(item,"data-link-id").trim();
        if(!linkId)continue;
        const serverName=nodeText(item).replace(/\s+/g," ").trim();
        out.push({srv_name:serverName||"Anikoto",link_id:linkId,group_name:"",dataType:"sub"});
      }
    }
    log("SERVERS="+out.length+" "+(Date.now()-started)+"ms");
    return out;
  });
}

/* ================= crypto ================= */
function b64dec(s){
  s=String(s||"").replace(/-/g,"+").replace(/_/g,"/");
  s+="=".repeat((4-s.length%4)%4);
  const abc="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const o=[];
  let bits=0,v=0;
  for(let i=0;i<s.length;i++){
    const c=s.charAt(i);
    if(c==="=")break;
    const n=abc.indexOf(c);
    if(n<0)continue;
    v=(v<<6)|n;
    bits+=6;
    if(bits>=8){
      bits-=8;
      o.push((v>>bits)&255);
    }
  }
  return new Uint8Array(o);
}
function utf8(a){
  let s="";
  for(let i=0;i<a.length;){
    const c=a[i++];
    if(c<128)s+=String.fromCharCode(c);
    else if(c<224)s+=String.fromCharCode(((c&31)<<6)|(a[i++]&63));
    else if(c<240)s+=String.fromCharCode(((c&15)<<12)|((a[i++]&63)<<6)|(a[i++]&63));
    else{
      const cp=((c&7)<<18)|((a[i++]&63)<<12)|((a[i++]&63)<<6)|(a[i++]&63);
      const z=cp-65536;
      s+=String.fromCharCode(55296+(z>>10),56320+(z&1023));
    }
  }
  return s;
}
function utf8enc(s){
  const e=encodeURIComponent(String(s));
  const a=[];
  for(let i=0;i<e.length;){
    if(e.charAt(i)==="%"){
      a.push(parseInt(e.slice(i+1,i+3),16));
      i+=3;
    }else a.push(e.charCodeAt(i++));
  }
  return new Uint8Array(a);
}
function b64url(a){
  const abc="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const u=a instanceof Uint8Array?a:new Uint8Array(a);
  const o=[];
  for(let i=0;i<u.length;i+=3){
    const x=u[i];
    const y=i+1<u.length?u[i+1]:0;
    const z=i+2<u.length?u[i+2]:0;
    o.push(abc[x>>2],abc[((x&3)<<4)|(y>>4)],i+1<u.length?abc[((y&15)<<2)|(z>>6)]:"=",i+2<u.length?abc[z&63]:"=");
  }
  return o.join("").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

const AES_SBOX=[99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
const AES_ISBOX=[82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37,114,248,246,100,134,104,152,22,212,164,92,204,93,101,182,146,108,112,72,80,253,237,185,218,94,21,70,87,167,141,157,132,144,216,171,0,140,188,211,10,247,228,88,5,184,179,69,6,208,44,30,143,202,63,15,2,193,175,189,3,1,19,138,107,58,145,17,65,79,103,220,234,151,242,207,206,240,180,230,115,150,172,116,34,231,173,53,133,226,249,55,232,28,117,223,110,71,241,26,113,29,41,197,137,111,183,98,14,170,24,190,27,252,86,62,75,198,210,121,32,154,219,192,254,120,205,90,244,31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125];
const AES_RCON=[0,1,2,4,8,16,32,64,128,27,54,108,216,171,77];
function aesX(a,b){
  let r=0;
  for(let i=0;i<8;i++){
    if(b&1)r^=a;
    const h=a&128;
    a=(a<<1)&255;
    if(h)a^=27;
    b>>=1;
  }
  return r;
}
function aesKey(key){
  const k=new Uint8Array(240);
  k.set(key);
  const bytes=key.length;
  let i=bytes,temp=new Uint8Array(4),r=1;
  while(i<240){
    for(let j=0;j<4;j++)temp[j]=k[i-4+j];
    if(i%bytes===0){
      const t=temp[0];
      temp[0]=AES_SBOX[temp[1]];
      temp[1]=AES_SBOX[temp[2]];
      temp[2]=AES_SBOX[temp[3]];
      temp[3]=AES_SBOX[t];
      temp[0]^=AES_RCON[r++];
    }else if(bytes===32&&i%bytes===16){
      for(let j=0;j<4;j++)temp[j]=AES_SBOX[temp[j]];
    }
    for(let j=0;j<4;j++){
      k[i]=k[i-bytes]^temp[j];
      i++;
    }
  }
  return k;
}
function aesAdd(s,k,r){
  const o=r*16;
  for(let i=0;i<16;i++)s[i]^=k[o+i];
}
function aesInvShift(s){
  const t=s.slice();
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)s[4*c+r]=t[4*((c-r+4)%4)+r];
}
function aesInvSub(s){
  for(let i=0;i<16;i++)s[i]=AES_ISBOX[s[i]];
}
function aesInvMix(s){
  for(let c=0;c<4;c++){
    const i=4*c,a=s[i],b=s[i+1],d=s[i+2],e=s[i+3];
    s[i]=aesX(a,14)^aesX(b,11)^aesX(d,13)^aesX(e,9);
    s[i+1]=aesX(a,9)^aesX(b,14)^aesX(d,11)^aesX(e,13);
    s[i+2]=aesX(a,13)^aesX(b,9)^aesX(d,14)^aesX(e,11);
    s[i+3]=aesX(a,11)^aesX(b,13)^aesX(d,9)^aesX(e,14);
  }
}
function aesDecBlock(block,key){
  const s=new Uint8Array(block);
  const k=aesKey(key);
  const nr=key.length===16?10:14;
  aesAdd(s,k,nr);
  aesInvShift(s);
  aesInvSub(s);
  for(let r=nr-1;r>0;r--){
    aesAdd(s,k,r);
    aesInvMix(s);
    aesInvShift(s);
    aesInvSub(s);
  }
  aesAdd(s,k,0);
  return s;
}
function aesCbcDec(data,key,iv){
  if(data.length%16)throw new Error("Invalid AES ciphertext");
  const o=new Uint8Array(data.length);
  let prev=iv.slice();
  for(let p=0;p<data.length;p+=16){
    const b=aesDecBlock(data.slice(p,p+16),key);
    for(let i=0;i<16;i++)o[p+i]=b[i]^prev[i];
    prev=data.slice(p,p+16);
  }
  const pad=o[o.length-1];
  if(!pad||pad>16)throw new Error("Invalid PKCS7 padding");
  for(let i=o.length-pad;i<o.length;i++)if(o[i]!==pad)throw new Error("Invalid PKCS7 padding");
  return o.slice(0,o.length-pad);
}

const SHA_K=[1116352408,1899447441,3049327441,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162072063,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,3382418951,666307205,773529912,1294757372,1396183700,1695183700,2177026350,2456956037,2730485921,2820302411,3259734187,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873772,1779033703,1839830562,2092067163,2281173324,2358390877,2454569567,2730485921,2820302411];
const SHA_H=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];

function sha256(m){
  const a=m instanceof Uint8Array?m:utf8enc(m);
  const l=a.length;
  const n=((l+9+63)>>6)<<6;
  const b=new Uint8Array(n);
  b.set(a);
  b[l]=128;
  const bits=l*8;
  for(let i=0;i<8;i++)b[n-1-i]=(bits/Math.pow(2,8*i))&255;
  let h=SHA_H.slice();
  const w=new Uint32Array(64);
  for(let p=0;p<n;p+=64){
    for(let i=0;i<16;i++)w[i]=(b[p+4*i]<<24)|(b[p+4*i+1]<<16)|(b[p+4*i+2]<<8)|b[p+4*i+3];
    for(let i=16;i<64;i++){
      const x=w[i-15],y=w[i-2];
      const s0=((x>>>7)|(x<<25))^((x>>>18)|(x<<14))^(x>>>3);
      const s1=((y>>>17)|(y<<15))^((y>>>19)|(y<<13))^(y>>>10);
      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
    }
    const a0=h[0],a1=h[1],a2=h[2],a3=h[3],a4=h[4],a5=h[5],a6=h[6],a7=h[7];
    let A=a0,B=a1,C=a2,D=a3,E=a4,F=a5,G=a6,H=a7;
    for(let i=0;i<64;i++){
      const S1=((E>>>6)|(E<<26))^((E>>>11)|(E<<21))^((E>>>25)|(E<<7));
      const ch=(E&F)^(~E&G);
      const t1=(H+S1+ch+SHA_K[i]+w[i])>>>0;
      const S0=((A>>>2)|(A<<30))^((A>>>13)|(A<<19))^((A>>>22)|(A<<10));
      const maj=(A&B)^(A&C)^(B&C);
      const t2=(S0+maj)>>>0;
      H=G;G=F;F=E;E=(D+t1)>>>0;
      D=C;C=B;B=A;A=(t1+t2)>>>0;
    }
    h[0]=(h[0]+A)>>>0;
    h[1]=(h[1]+B)>>>0;
    h[2]=(h[2]+C)>>>0;
    h[3]=(h[3]+D)>>>0;
    h[4]=(h[4]+E)>>>0;
    h[5]=(h[5]+F)>>>0;
    h[6]=(h[6]+G)>>>0;
    h[7]=(h[7]+H)>>>0;
  }
  const o=new Uint8Array(32);
  for(let i=0;i<8;i++){
    o[4*i]=h[i]>>>24;
    o[4*i+1]=h[i]>>>16;
    o[4*i+2]=h[i]>>>8;
    o[4*i+3]=h[i];
  }
  return o;
}
function hmac256(key,msg){
  let k=utf8enc(key);
  let m=msg instanceof Uint8Array?msg:utf8enc(msg);
  if(k.length>64)k=sha256(k);
  const p=new Uint8Array(64),q=new Uint8Array(64);
  p.fill(54);q.fill(92);
  for(let i=0;i<k.length;i++){p[i]^=k[i];q[i]^=k[i];}
  const z=new Uint8Array(64+m.length);
  z.set(p);z.set(m,64);
  const ih=sha256(z);
  const z2=new Uint8Array(64+ih.length);
  z2.set(q);z2.set(ih,64);
  return sha256(z2);
}

/* ================= extractor helpers ================= */
function sourceFile(r){
  const enc=r&&r.enc;
  if(typeof enc==="string"&&enc){
    try{
      const k=new Uint8Array(32);
      k.set(utf8enc("i?LMTAx0Q6,:}50U"));
      const iv=utf8enc("W0;27ToaUpl_P%'c");
      const p=aesCbcDec(b64dec(enc),k,iv);
      const o=JSON.parse(utf8(p));
      if(o&&typeof o.file==="string"&&o.file)return o.file;
    }catch(e){
      log("Megaplay decrypt failed: "+e.message);
    }
  }
  const s=r&&r.sources;
  if(s&&!Array.isArray(s)&&typeof s.file==="string")return s.file;
  if(Array.isArray(s)&&s.length&&s[0]&&typeof s[0].file==="string")return s[0].file;
  return null;
}
function signMegaplay(u){
  try{
    const x=new URL(u);
    const m=x.pathname.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
    if(!m)return u;
    const p=utf8enc(Math.floor(Date.now()/1000)+90+"|"+m[1].toLowerCase()+"/"+m[2].toLowerCase());
    const sig=hmac256("MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s",p);
    const q=x.search?x.search+"&":"?";
    return x.href.split("?")[0]+q+"token="+b64url(p)+"."+b64url(sig);
  }catch(e){
    log("Megaplay signing failed: "+e.message);
    return u;
  }
}
function subFormat(u,d){
  const a=["srt","vtt","ass"];
  const x=String(d||"").toLowerCase().replace(/^\./,"");
  if(a.indexOf(x)>=0)return x;
  try{
    const p=new URL(u).pathname.split(".").pop().toLowerCase();
    return a.indexOf(p)>=0?p:"vtt";
  }catch(e){return "vtt";}
}
function streamHeaders(ref,origin){
  return {"Referer":ref,"Origin":origin,"User-Agent":UA,"Accept":"*/*"};
}
function cleanStreamUrl(u){return String(u||"").replace(/\\/g,"").trim();}

async function extractVidtube(u,server){
  const h=await getText(u,{headers:AJAX_HEADERS},EXTRACT_TIMEOUT_MS);
  if(!h)return null;
  const r=parseHTML(h);
  const p=first(r,"#megaplay-player");
  const id=attr(p,"data-id").trim();
  if(!id)return null;
  const z=new URL(u);
  const parts=z.pathname.split("/").filter(Boolean);
  const type=parts[parts.length-1];
  if(!type)return null;
  const d=await getJson(
    "https://vidtube.site/stream/getSourcesNew?id="+encodeURIComponent(id)+"&type="+encodeURIComponent(type),
    {headers:{"X-Requested-With":"XMLHttpRequest","Referer":"https://vidtube.site/","Origin":"https://vidtube.site","User-Agent":UA,"Accept":"*/*"}},
    EXTRACT_TIMEOUT_MS
  );
  const playlist=d&&d.sources&&d.sources.file;
  if(!playlist)return null;
  const tr=Array.isArray(d&&d.tracks)?d.tracks:[];
  let sub=null;
  for(let i=0;i<tr.length;i++){
    const x=tr[i];
    if(x&&x.kind==="captions"&&String(x.lang||"").toLowerCase()==="english"){sub=x.file;break;}
  }
  if(!sub){
    for(let i=0;i<tr.length;i++){
      const x=tr[i];
      if(x&&x.kind==="captions"&&x.default===true){sub=x.file;break;}
    }
  }
  sub=cleanStreamUrl(sub);
  return {
    name:server||"vidtube",
    title:(server||"vidtube")+" [multi-quality]",
    url:cleanStreamUrl(playlist),
    quality:"multi-quality",
    headers:streamHeaders("https://vidtube.site/","https://vidtube.site"),
    subtitle:sub||"",
    subtitleFormat:sub?"vtt":"",
    subtitles:sub?[{url:sub,name:"English",language:"en",format:"vtt",default:true,headers:streamHeaders("https://vidtube.site/","https://vidtube.site")}]:[],
    backup:false
  };
}

async function extractMegaplay(u,server){
  const h=await getText(u,{headers:AJAX_HEADERS},EXTRACT_TIMEOUT_MS);
  if(!h)return null;
  const r=parseHTML(h);
  const p=first(r,"#megaplay-player");
  const id=attr(p,"data-id").trim();
  if(!id)return null;
  const page=new URL(u);
  const sec=page.searchParams&&page.searchParams.get("s");
  const epHeaders={"X-Requested-With":"XMLHttpRequest","Referer":u,"Origin":page.origin,"User-Agent":UA,"Accept":"*/*"};
  const buildUrl=function(ep){
    let q=page.origin+"/stream/"+ep+"?id="+encodeURIComponent(id);
    if(sec)q+="&s="+encodeURIComponent(sec);
    return q;
  };
  const attempts=await Promise.allSettled([
    getJson(buildUrl("getSources"),{headers:epHeaders},EXTRACT_TIMEOUT_MS),
    getJson(buildUrl("getSourcesNew"),{headers:epHeaders},EXTRACT_TIMEOUT_MS)
  ]);
  let source=null,file=null;
  for(let i=0;i<attempts.length;i++){
    const a=attempts[i];
    if(a.status!=="fulfilled")continue;
    const f=sourceFile(a.value);
    if(f){source=a.value;file=cleanStreamUrl(f);break;}
  }
  if(!file||!source)return null;
  const tr=Array.isArray(source.tracks)?source.tracks:[];
  let en=null;
  for(let i=0;i<tr.length;i++){
    const x=tr[i];
    if(x&&x.kind==="captions"&&String(x.label||"").toLowerCase()==="english"){en=x;break;}
  }
  if(!en){
    for(let i=0;i<tr.length;i++){
      const x=tr[i];
      if(x&&x.kind==="captions"&&x.default===true){en=x;break;}
    }
  }
  const sub=cleanStreamUrl(en&&en.file);
  const fmt=sub?subFormat(sub,en&&en.format):"";
  const signed=signMegaplay(file);
  log("Megaplay source resolved; signed playback URL generated");
  return {
    name:server||"Megaplay",
    title:(server||"Megaplay")+" [multi-quality]",
    url:signed,
    quality:"multi-quality",
    headers:streamHeaders("https://megaplay.buzz/","https://megaplay.buzz/"),
    subtitle:sub||"",
    subtitleFormat:fmt,
    subtitles:sub?[{url:sub,name:"English",language:"en",format:fmt||"vtt",default:true,headers:streamHeaders("https://megaplay.buzz/","https://megaplay.buzz/")}]:[],
    backup:false
  };
}

async function extractHost(u,server){
  try{
    const h=new URL(u).hostname.toLowerCase().split(".")[0];
    if(h==="vidtube")return await extractVidtube(u,server);
    if(h==="megaplay")return await extractMegaplay(u,server);
    log("Unsupported extractor host: "+h);
    return null;
  }catch(e){
    log("Extractor "+(server||"unknown")+" failed: "+String(e&&e.message||e));
    return null;
  }
}
function validMediaUrl(u){
  try{
    const x=new URL(String(u||""));
    return x.protocol==="http:"||x.protocol==="https:";
  }catch(e){return false;}
}
function streamType(u){
  const x=String(u||"").toLowerCase();
  if(x.indexOf(".m3u8")>=0)return "m3u8";
  if(x.indexOf(".mpd")>=0)return "mpd";
  return "unknown";
}

/* ================= Nuvio settings ================= */
function getSetting(settings,names,fallback){
  if(!settings||typeof settings!=="object")return fallback;
  for(let i=0;i<names.length;i++){
    const n=names[i];
    if(Object.prototype.hasOwnProperty.call(settings,n)&&settings[n]!==undefined&&settings[n]!==null)return settings[n];
  }
  return fallback;
}
function modes(settings){
  const sub=getSetting(settings,["sub","Sub","subtitle"],true)!==false;
  const dub=getSetting(settings,["dub","Dub"],false)===true;
  const out=[];
  if(sub)out.push(false);
  if(dub)out.push(true);
  return out.length?out:[false];
}
function qualitySetting(settings){
  return String(getSetting(settings,["quality","Quality"],"multi-quality")||"multi-quality");
}

/* ================= server resolution ================= */
async function resolveOneServer(server,quality,state){
  const serverStarted=Date.now();
  const link=server&&server.link_id;
  if(!link)return null;
  const d=await getJson(AJAX+"/server?get="+encodeURIComponent(link),{headers:AJAX_HEADERS},SERVER_RESOLVE_TIMEOUT_MS);
  const streamUrl=String(d&&d.result&&d.result.url||"").trim();
  if(!streamUrl)return null;

  if(state.seenUrls&&state.seenUrls[streamUrl]){
    log("SKIP DUPLICATE "+String(server.srv_name||"Anikoto"));
    return null;
  }
  state.seenUrls=state.seenUrls||{};
  state.seenUrls[streamUrl]=1;

  log("SERVER RESOLVE "+String(server.srv_name||"Anikoto")+" "+(Date.now()-serverStarted)+"ms");
  let host="";
  try{host=new URL(streamUrl).hostname.toLowerCase().split(".")[0];}catch(e){}
  log("HOST="+(host||"unknown"));
  const extractStarted=Date.now();
  const stream=await extractHost(streamUrl,quality,String(server.srv_name||"Anikoto"));
  log("EXTRACT "+(host||"unknown")+" "+(Date.now()-extractStarted)+"ms");
  if(!stream)return null;
  stream.title="Anikoto "+(server.dataType==="dub"?"DUB":"SUB")+" - "+(server.srv_name||"Anikoto");
  stream.name="Anikoto ["+(server.dataType==="dub"?"DUB":"SUB")+"] "+(server.srv_name||"Anikoto");
  stream.provider="anikoto";
  stream.type=streamType(stream.url);
  if(!state.firstStreamLogged){
    state.firstStreamLogged=true;
    log("TIME TO FIRST STREAM "+(Date.now()-state.firstStart)+"ms");
  }
  return stream;
}

async function resolveServers(servers,quality){
  const started=Date.now();
  const state={firstStart:started,firstStreamLogged:false,seenUrls:{}};
  const results=[];
  const seen={};
  const tasks=servers.map(function(server){
    return async function(){
      try{
        const stream=await resolveOneServer(server,quality,state);
        if(stream&&validMediaUrl(stream.url)&&!seen[stream.url]){
          seen[stream.url]=1;
          results.push(stream);
        }
      }catch(e){}
    };
  });
  const workers=settle(tasks,Math.min(servers.length,12));
  let timer=null;
  const budgetPromise=new Promise(function(resolve){
    timer=setTimeout(resolve,SERVER_BUDGET_MS);
  });
  await Promise.race([workers,budgetPromise]);
  if(timer!==null){clearTimeout(timer);timer=null;}
  log("SERVER/EXTRACTION TOTAL "+(Date.now()-started)+"ms collected="+results.length+"/"+servers.length);
  return results;
}

async function resolveMode(episodeId,isDub,quality){
  const allServers=await getServerList(episodeId);
  let servers=allServers.filter(function(x){return x.dataType===(isDub?"dub":"sub");});
  if(!servers.length&&!isDub&&allServers.length){
    log("SUB EMPTY, FALLING BACK TO DUB");
    servers=allServers.filter(function(x){return x.dataType==="dub";});
  }
  if(!servers.length&&isDub&&allServers.length){
    servers=allServers.filter(function(x){return x.dataType==="sub";});
  }
  if(!servers.length)return [];
  return await resolveServers(servers,quality);
}

/* ================= pipeline ================= */
async function runPipeline(target,season,episode,isMovie,settings){
  const anime=await findAnime(target,season);
  if(!anime){log("ANIME MATCH FAILED for "+((target&&target.title)||"?"));return [];}
  const animeUrl=absoluteUrl(anime.href);
  const animeId=await getAnimeId(animeUrl);
  if(!animeId)return [];
  const episodes=await getEpisodes(animeId);
  if(isMovie){
    if(episodes.length!==1){
      log("MOVIE EXPECTED 1 EPISODE GOT "+episodes.length+" REJECT");
      return [];
    }
  }
  let episodeMatch=null;
  if(isMovie){
    episodeMatch=episodes[0];
  }else{
    episodeMatch=episodes.find(function(x){return x.episodeNumber===episode;});
    if(!episodeMatch){log("EPISODE MATCH FAILED E"+episode);return [];}
  }
  log("EPISODE MATCH E"+episodeMatch.episodeNumber+" ID="+episodeMatch.episodeId);
  const modesList=modes(settings);
  if(!isMovie&&modesList.indexOf(true)>=0&&!episodeMatch.hasDub){
    log("DUB REQUESTED BUT EPISODE HAS NO DUB");
    if(modesList.length===1)return [];
  }
  const q=qualitySetting(settings);
  const modeResults=await Promise.all(modesList.map(function(isDub){return resolveMode(episodeMatch.episodeId,isDub,q);}));
  const flat=[];
  for(let i=0;i<modeResults.length;i++)for(let j=0;j<modeResults[i].length;j++)flat.push(modeResults[i][j]);
  const seen={};
  const out=[];
  for(let i=0;i<flat.length;i++){
    const st=flat[i];
    if(!st||!st.url||seen[st.url])continue;
    seen[st.url]=1;
    out.push(st);
  }
  return out;
}

/* ================= prefixed content ID -> TMDB ================= */
const ID_CACHE=globalThis.__NUVIO_ID_CACHE__||(globalThis.__NUVIO_ID_CACHE__=new Map());
const ID_CACHE_TTL=1*60*60*1000;

function parseContentId(raw){
  const s=String(raw||"").trim();
  const m=s.match(/^([a-z]+):(.+)$/i);
  if(!m){
    if(/^tt\d+$/i.test(s))return{type:"imdb",id:s,raw:s};
    if(/^\d+$/.test(s))return{type:"tmdb",id:s,raw:s};
    return{type:"raw",id:s,raw:s};
  }
  const prefix=m[1].toLowerCase(),body=m[2].trim();
  if(prefix==="tmdb")return{type:"tmdb",id:body,raw:s};
  if(prefix==="mal")return{type:"mal",id:body,raw:s};
  if(prefix==="kitsu")return{type:"kitsu",id:body,raw:s};
  if(prefix==="anilist")return{type:"anilist",id:body,raw:s};
  if(prefix==="imdb")return{type:"imdb",id:body,raw:s};
  return{type:"raw",id:body,raw:s};
}
function idCacheGet(k){const x=ID_CACHE.get(k);if(x&&x.expires>Date.now())return x.value;if(x)ID_CACHE.delete(k);return undefined;}
function idCacheSet(k,v){if(v)ID_CACHE.set(k,{value:v,expires:Date.now()+ID_CACHE_TTL});return v||null;}
function pickId(v){return Array.isArray(v)?(v[0]!=null?String(v[0]).trim():null):(v!=null?String(v).trim():null);}
function pickTmdb(x,hintType){
  if(!x)return null;
  const movie=pickId(x.themoviedb_movie||x.movie||x.tmdb_movie);
  const tv=pickId(x.themoviedb_tv||x.tv||x.tmdb_tv);
  if(hintType==="movie"&&movie)return{tmdbId:movie,type:"movie"};
  if(hintType==="tv"&&tv)return{tmdbId:tv,type:"tv"};
  if(movie)return{tmdbId:movie,type:"movie"};
  if(tv)return{tmdbId:tv,type:"tv"};
  const single=pickId(x.themoviedb||x.themoviedb_id||x.tmdb||x.tmdb_id);
  if(single)return{tmdbId:single,type:hintType==="movie"?"movie":"tv"};
  return null;
}

async function malToTmdb(malId,hintType){
  const key="mal:"+malId+":"+hintType;
  const c=idCacheGet(key);if(c!==undefined)return c;
  const value=await (async()=>{
    try{
      const r=await getJson("https://api.ani.zip/mappings?mal_id="+encodeURIComponent(malId),{headers:{"Accept":"application/json","User-Agent":UA}},5000);
      const m=r&&r.mappings;
      if(m){
        const id=pickId(m.themoviedb_id||m.themoviedb||m.tmdb_id);
        if(id&&/^\d+$/.test(id)){
          const mt=String(m.type||"").toLowerCase();
          const type=mt==="movie"?"movie":(mt==="tv"||mt==="ona"||mt==="ova"||mt==="special"?"tv":(hintType==="movie"?"movie":"tv"));
          return{tmdbId:id,type,via:"anizip"};
        }
      }
    }catch(e){}
    try{
      const ar=await getJson("https://arm.haglund.dev/api/v2/myanimelist?id="+encodeURIComponent(malId),{headers:{"Accept":"application/json","User-Agent":UA}},5000);
      if(Array.isArray(ar)){
        for(const x of ar){
          const hit=pickTmdb(x,hintType);
          if(hit)return Object.assign(hit,{via:"arm"});
        }
      }
    }catch(e){}
    return null;
  })();
  return idCacheSet(key,value);
}

async function kitsuToTmdb(kitsuId,hintType){
  const key="kitsu:"+kitsuId+":"+hintType;
  const c=idCacheGet(key);if(c!==undefined)return c;
  const value=await (async()=>{
    try{
      const r=await getJson(
        "https://kitsu.io/api/edge/anime/"+encodeURIComponent(kitsuId)+"/mappings",
        {headers:{"Accept":"application/vnd.api+json","User-Agent":UA}},
        6000
      );
      const data=Array.isArray(r&&r.data)?r.data:[];
      let movieId=null,tvId=null,malId=null;
      for(const x of data){
        const a=x&&x.attributes||{};
        const site=String(a.externalSite||"").toLowerCase();
        const eid=String(a.externalId||"").trim();
        if(!/^\d+$/.test(eid))continue;
        if(site==="themoviedb/movie"&&!movieId)movieId=eid;
        else if(site==="themoviedb/tv"&&!tvId)tvId=eid;
        else if(site==="myanimelist/anime"&&!malId)malId=eid;
      }
      if(hintType==="movie"&&movieId)return{tmdbId:movieId,type:"movie",via:"kitsu-mapping"};
      if(hintType==="tv"&&tvId)return{tmdbId:tvId,type:"tv",via:"kitsu-mapping"};
      if(movieId)return{tmdbId:movieId,type:"movie",via:"kitsu-mapping"};
      if(tvId)return{tmdbId:tvId,type:"tv",via:"kitsu-mapping"};
      if(malId){
        const c2=await malToTmdb(malId,hintType);
        if(c2)return Object.assign(c2,{via:"kitsu-mal-"+c2.via});
      }
    }catch(e){}
    return null;
  })();
  return idCacheSet(key,value);
}

async function anilistToTmdb(anilistId,hintType){
  const key="anilist:"+anilistId+":"+hintType;
  const c=idCacheGet(key);if(c!==undefined)return c;
  const value=await (async()=>{
    try{
      const ar=await getJson("https://arm.haglund.dev/api/v2/anilist?id="+encodeURIComponent(anilistId),{headers:{"Accept":"application/json","User-Agent":UA}},5000);
      if(Array.isArray(ar)){
        for(const x of ar){
          const hit=pickTmdb(x,hintType);
          if(hit)return Object.assign(hit,{via:"arm"});
        }
      }
    }catch(e){}
    try{
      const r=await req("https://graphql.anilist.co",{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json","User-Agent":UA},
        body:JSON.stringify({query:"query($id:Int){Media(id:$id,type:ANIME){idMal}}",variables:{id:Number(anilistId)}})
      },6000);
      if(r&&r.ok){
        const d=await r.json();
        const idMal=d&&d.data&&d.data.Media&&d.data.Media.idMal;
        if(idMal)return await malToTmdb(String(idMal),hintType);
      }
    }catch(e){}
    return null;
  })();
  return idCacheSet(key,value);
}

async function resolveInputId(rawId,mediaType){
  const parsed=parseContentId(rawId);
  if(!parsed.id)return null;
  if(parsed.type==="tmdb")return{tmdbId:parsed.id,type:mediaType,source:"tmdb"};
  if(parsed.type==="imdb")return{tmdbId:parsed.id,type:mediaType,source:"imdb"};
  if(parsed.type==="mal"){
    const c=await malToTmdb(parsed.id,mediaType);
    return c?{tmdbId:c.tmdbId,type:c.type||mediaType,source:"mal",via:c.via}:null;
  }
  if(parsed.type==="kitsu"){
    const c=await kitsuToTmdb(parsed.id,mediaType);
    return c?{tmdbId:c.tmdbId,type:c.type||mediaType,source:"kitsu",via:c.via}:null;
  }
  if(parsed.type==="anilist"){
    const c=await anilistToTmdb(parsed.id,mediaType);
    return c?{tmdbId:c.tmdbId,type:c.type||mediaType,source:"anilist",via:c.via}:null;
  }
  if(/^\d+$/.test(parsed.id))return{tmdbId:parsed.id,type:mediaType,source:"tmdb"};
  return null;
}

/* ================= Nuvio interface ================= */
async function getStreams(tmdbId,mediaType,season,episode,settings){
  try{
    mediaType=mediaType||"tv";
    season=season==null?1:Number(season);
    episode=episode==null?1:Number(episode);
    settings=settings||{};
    let type=String(mediaType).toLowerCase();
    if(type!=="tv"&&type!=="movie")return [];
    const rawId=String(tmdbId||"").trim();
    if(!rawId)return [];
    const resolved=await resolveInputId(rawId,type);
    if(!resolved){log("ID RESOLVE FAILED "+rawId);return [];}
    const id=resolved.tmdbId;
    if(resolved.type==="tv"||resolved.type==="movie")type=resolved.type;
    if(resolved.source!=="tmdb")log(resolved.source.toUpperCase()+"->TMDB raw="+rawId+" tmdb="+id+" type="+type+" via="+(resolved.via||"?"));
    const s=Number(season)||1;
    const e=Number(episode)||1;
    const isMovie=type==="movie";
    const key="anikoto:streams:"+id+":"+type+":"+s+":"+e+":"+JSON.stringify(settings);
    const hit=CACHE.get(key);
    if(hit!==undefined){
      log("STREAM CACHE HIT key="+key+" cacheSize="+CACHE.m.size);
      return await Promise.resolve(hit);
    }
    log("STREAM CACHE MISS key="+key+" cacheSize="+CACHE.m.size);
    const p=(async function(){
      const started=Date.now();
      log("REQUEST TMDB="+id+" type="+type+" S"+s+"E"+e);
      if(isMovie){
        const info=await tmdbInfo(id,"movie");
        if(!info||!info.title){log("MOVIE TMDB LOOKUP FAILED TMDB="+id);return [];}
        const titles=[info.title];
        if(info.original_title)titles.push(info.original_title);
        const target={title:info.title,titles:titles};
        log("MOVIE NATIVE TMDB="+id+" title="+info.title);
        const streams=await runPipeline(target,1,1,true,settings);
        log("MOVIE DONE streams="+streams.length+" time="+(Date.now()-started)+"ms");
        return streams;
      }

      const mapperPromise=(async()=>{
        const mapperStarted=Date.now();
        let mapping=null;
        try{mapping=await mapperLookup(id,s,e);}catch(err){log("MAPPER ERROR "+(err&&err.message||err));}
        log("MAPPER "+(Date.now()-mapperStarted)+"ms");
        return mapping;
      })();
      const tmdbNativePromise=(async()=>{
        const info=await tmdbInfo(id,"tv");
        if(!info||!info.name)return null;
        const titles=[info.name];
        if(info.original_name)titles.push(info.original_name);
        return {title:info.name,titles:titles};
      })();

      const mapping=await mapperPromise;
      if(mapping&&mapping.malEpisode>=1){
        log("MAPPING HIT MAL="+mapping.malId+" E"+mapping.malEpisode);
        const target={title:mapping.title,titles:mapping.titles||[]};
        const mapped=await runPipeline(target,s,mapping.malEpisode,false,settings);
        if(mapped.length){
          log("MAPPED PATH OK streams="+mapped.length);
          return mapped;
        }
        log("MAPPED RESOLUTION FAILED FALLING BACK NATIVE");
      }else{
        log("MAPPING MISS");
      }

      const target=await tmdbNativePromise;
      if(!target){log("TMDB TV LOOKUP FAILED TMDB="+id);return [];}
      const native=await runPipeline(target,s,e,false,settings);
      log("NATIVE TV DONE streams="+native.length+" time="+(Date.now()-started)+"ms");
      return native;
    })();
    const STREAM_CACHE_TTL=120000;
    CACHE.set(key,p,STREAM_CACHE_TTL);
    try{
      const v=await p;
      if(v&&v.length)return CACHE.set(key,v,STREAM_CACHE_TTL);
      CACHE.delete(key);
      return v;
    }catch(e){
      CACHE.delete(key);
      log("ERROR "+String(e&&e.message||e));
      return [];
    }
  }catch(e){
    log("FATAL "+String(e&&e.message||e));
    return [];
  }
}

module.exports={getStreams};
