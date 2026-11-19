// Lógica pura de VinylTracker (sin red ni DOM). Se prueba con `node --test tests/`.

const STOP = new Set([
  'the', 'a', 'an', 'el', 'la', 'los', 'las', 'de', 'del', 'and', 'y', 'of', 'vinilo', 'vinyl', 'lp', 'cd', '2lp',
  'remastered', 'remaster', 'deluxe', 'edition', 'edicion', 'version', 'anniversary', 'expanded', 'reissue'
]);

export const fold = s =>
  String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ');

export function cleanAlbum(name) {
  let n = String(name || '').replace(/[([][^)\]]*[)\]]/g, ' ');
  n = n.replace(/\s-\s.*(remaster|deluxe|edition|version|anniversary).*$/i, ' ');
  return n.trim();
}

export const tokens = s => (fold(s).match(/[a-z0-9]+/g) || []).filter(t => !STOP.has(t));

export const albumKey = (artist, album) => tokens(artist).join(' ') + '|' + tokens(cleanAlbum(album)).join(' ');

export function overlap(needle, haystack) {
  if (!needle.length) return 0;
  return needle.filter(t => haystack.has(t)).length / needle.length;
}

// ---------- CSV (el de mi-app: Artist,Name,Image,Tags,Url) ----------
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

export function spotifyAlbumId(url) {
  const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?album\/([A-Za-z0-9]{22})/.exec(String(url || ''));
  return m ? m[1] : '';
}

// Colección de mi-app: CSV (+ discos añadidos desde la app, que vienen de Firestore)
export function parseCollectionCsv(text, imageBase = '') {
  const rows = parseCsv(text);
  const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
  const col = n => head.indexOf(n);
  const out = [];
  for (const r of rows) {
    const artist = (r[col('artist')] || '').trim();
    const name = (r[col('name')] || '').trim();
    if (!artist || !name) continue;
    const img = (r[col('image')] || '').trim();
    const url = (r[col('url')] || '').trim();
    out.push({
      artist, name,
      image: /^https?:/.test(img) ? img : img ? imageBase + img : '',
      tags: (r[col('tags')] || '').split('|').map(t => t.trim()).filter(Boolean),
      url, id: spotifyAlbumId(url)
    });
  }
  return out;
}

export function mergeCollection(base, extras) {
  const seen = new Set(base.map(a => a.id).filter(Boolean));
  const out = base.slice();
  for (const e of extras || []) {
    if (!e || !e.artist || !e.name) continue;
    if (e.id && seen.has(e.id)) continue;
    out.push({ artist: e.artist, name: e.name, image: e.image || '', tags: e.tags || [], url: e.url || '', year: e.year || null, id: e.id || '', extra: true });
  }
  return out;
}

export function ownedIndex(collection) {
  const ids = new Set(), keys = new Set();
  for (const a of collection) {
    if (a.id) ids.add(a.id);
    keys.add(albumKey(a.artist, a.name));
  }
  return { ids, keys };
}

export const isOwned = (album, idx) =>
  !!idx && ((album.id && idx.ids.has(album.id)) || idx.keys.has(album.key || albumKey(album.artist, album.name)));

// ---------- Historial de Spotify ----------
export const MIN_MS = 30000;

// Reduce entradas del export a { key: {artist,name,id,months:{'YYYY-MM':{ms,plays}}, tracks:[..]} }
export function aggregateHistory(entries, into = {}) {
  let used = 0, skipped = 0;
  for (const e of entries) {
    const artist = e.master_metadata_album_artist_name, name = e.master_metadata_album_album_name;
    if (!artist || !name || !e.ts) { skipped++; continue; }
    const k = albumKey(artist, name);
    const a = into[k] || (into[k] = { artist, name, id: '', months: {}, tracks: [] });
    const m = String(e.ts).slice(0, 7);
    const cell = a.months[m] || (a.months[m] = { ms: 0, plays: 0 });
    const ms = e.ms_played || 0;
    cell.ms += ms;
    if (ms >= MIN_MS) { cell.plays++; used++; }
    const t = e.spotify_track_uri || e.master_metadata_track_name;
    if (t && a.tracks.length < 60 && !a.tracks.includes(t)) a.tracks.push(t);
  }
  return { into, used, skipped };
}

// Suma los meses dentro de la ventana (months = nº de meses hacia atrás, 0 = todo)
export function windowStats(a, months, now = new Date()) {
  let ms = 0, plays = 0, last = '';
  const cutoff = months
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1)).toISOString().slice(0, 7)
    : '';
  for (const [m, c] of Object.entries(a.months)) {
    if (cutoff && m < cutoff) continue;
    ms += c.ms; plays += c.plays;
    if (m > last) last = m;
  }
  return { minutes: Math.round(ms / 6000) / 10, plays, last };
}

// ---------- Ranking (historial + API) ----------
// sources.api: { key: {artist,name,id,image,points,saved} }
export function buildRanking({ history = {}, api = {}, months = 12, now = new Date() }) {
  const map = new Map();
  const get = (k, a) => {
    if (!map.has(k)) map.set(k, { key: k, artist: a.artist, name: a.name, id: a.id || '', image: a.image || '',
      minutes: 0, plays: 0, points: 0, saved: false, last: '', from: new Set() });
    return map.get(k);
  };
  for (const [k, a] of Object.entries(history)) {
    const s = windowStats(a, months, now);
    if (!s.plays && !s.minutes) continue;
    const r = get(k, a);
    r.minutes = s.minutes; r.plays = s.plays; r.last = s.last; r.from.add('historial');
  }
  for (const [k, a] of Object.entries(api)) {
    const r = get(k, a);
    r.id = r.id || a.id || ''; r.image = r.image || a.image || '';
    r.points = a.points || 0; r.saved = !!a.saved; r.from.add(a.saved && !a.points ? 'guardado' : 'api');
  }
  const hasHistory = Object.keys(history).length > 0;
  const list = [...map.values()].map(r => ({ ...r, from: [...r.from] }));
  // Con historial manda el tiempo escuchado; sin él, los puntos de la API
  list.sort((x, y) => hasHistory
    ? (y.minutes - x.minutes) || (y.points - x.points)
    : (y.points - x.points) || (Number(y.saved) - Number(x.saved)));
  return list.filter(r => hasHistory ? r.minutes > 0 || r.points > 0 : r.points > 0 || r.saved);
}

// ---------- Tiendas (data/stores.json generado en CI) ----------
// item: [title, vendor, price, available(0/1), handle, preorder(0/1), releaseDate]
export function indexStores(data) {
  const out = [];
  for (const [store, s] of Object.entries((data && data.stores) || {})) {
    const origin = new URL(s.base).origin;
    for (const it of s.items) {
      const [title, vendor, price, available, handle, preorder, release] = it;
      out.push({
        store, title, price, available: !!available, preorder: !!preorder, release: release || '',
        url: `${origin}/products/${handle}`,
        toks: new Set(tokens(`${title} ${vendor} ${String(handle).replace(/-/g, ' ')}`))
      });
    }
  }
  return out;
}

export function matchStores(album, index, { minAlbum = 0.99, minArtist = 0.5 } = {}) {
  const a = tokens(album.artist), b = tokens(cleanAlbum(album.name));
  return index
    .filter(p => overlap(b, p.toks) >= minAlbum && overlap(a, p.toks) >= minArtist)
    .map(({ toks, ...rest }) => rest)
    .sort((x, y) => (y.available || y.preorder) - (x.available || x.preorder) || x.price - y.price);
}

export const fnacUrl = album =>
  'https://www.fnac.es/SearchResult/ResultList.aspx?Search=' +
  encodeURIComponent(`${album.artist} ${cleanAlbum(album.name)} vinilo`).replace(/%20/g, '+');

// ---------- Discogs ----------
export function pickRelease(results, artist, album) {
  const a = tokens(artist), b = tokens(cleanAlbum(album));
  let best = null, bestScore = 0;
  for (const r of results || []) {
    const t = new Set(tokens(r.title || ''));
    const have = Math.min((r.community && r.community.have) || 0, 100000);
    const s = overlap(b, t) * 0.6 + overlap(a, t) * 0.4 + have / 1e7;
    if (s > bestScore) { best = r; bestScore = s; }
  }
  return best && bestScore >= 0.75 ? best : null;
}

// Valor de referencia: oferta de tienda disponible/en preventa más barata; si no, Discogs
export function bestOffer(offers) {
  const live = (offers || []).filter(o => o.price != null && (o.available || o.preorder));
  const pool = live.length ? live : (offers || []).filter(o => o.price != null);
  return pool.length ? pool.reduce((m, o) => (o.price < m.price ? o : m)) : null;
}

export function estimate(album, offers) {
  const o = bestOffer(offers);
  if (o && (o.available || o.preorder)) return o.price;
  return album.discogs && album.discogs.lowest != null ? album.discogs.lowest : null;
}

export const money = (v, cur = 'EUR') =>
  v == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).format(v);

// ---------- Alta de discos (misma lógica que la app Vinilos de mi-app) ----------
const SPOTIFY_ID = '[A-Za-z0-9]{22}';
const MAX_TAGS = 8, MAX_TAG = 24, MAX_NAME = 120, MAX_ARTIST = 80, MAX_IMAGE = 600;

// Enlace de álbum de Spotify (web, con idioma o parámetros, o URI spotify:album:...) -> { id, url } | null
export function parseSpotifyAlbum(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  let m = t.match(new RegExp('^spotify:album:(' + SPOTIFY_ID + ')$'));
  if (!m) m = t.match(new RegExp('^https?://open\\.spotify\\.com/(?:intl-[a-z-]+/)?album/(' + SPOTIFY_ID + ')(?:[/?#].*)?$'));
  return m ? { id: m[1], url: 'https://open.spotify.com/album/' + m[1] } : null;
}

// "Rap, trap | RAP" -> ['rap', 'trap']
export function normalizeTags(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const raw of text.split(/[,|]/)) {
    const t = raw.trim().toLowerCase().slice(0, MAX_TAG);
    if (t && !out.includes(t)) out.push(t);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

const cleanText = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const validImage = u => typeof u === 'string' && /^https:\/\/\S+$/.test(u) && u.length <= MAX_IMAGE;
const cleanYear = y => { const n = Number(y); return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null; };

export function newAlbum({ spotifyUrl, name, artist, image, tags, year, now }) {
  const sp = parseSpotifyAlbum(spotifyUrl);
  if (!sp) return { ok: false, error: 'Eso no es un enlace de álbum de Spotify.' };
  const n = cleanText(name, MAX_NAME), a = cleanText(artist, MAX_ARTIST);
  if (!n) return { ok: false, error: 'Falta el nombre del álbum.' };
  if (!a) return { ok: false, error: 'Falta el artista.' };
  if (!validImage(image)) return { ok: false, error: 'La portada no es válida.' };
  return { ok: true, album: { id: sp.id, artist: a, name: n, image, tags: Array.isArray(tags) ? tags : normalizeTags(tags),
    url: sp.url, year: cleanYear(year), addedAt: now || Date.now() } };
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export function validStored(a) {
  return isObj(a) && typeof a.id === 'string' && new RegExp('^' + SPOTIFY_ID + '$').test(a.id) &&
    typeof a.artist === 'string' && !!a.artist && typeof a.name === 'string' && !!a.name &&
    validImage(a.image) && Array.isArray(a.tags) && a.url === 'https://open.spotify.com/album/' + a.id;
}

// Lo que viene de la nube: solo se aceptan discos bien formados
export function parseExtras(text) {
  if (typeof text !== 'string') return [];
  let v;
  try { v = JSON.parse(text); } catch (e) { return []; }
  return isObj(v) && Array.isArray(v.albums) ? v.albums.filter(validStored) : [];
}

export const isOwner = (uid, ownerUid) => typeof uid === 'string' && !!uid && uid === ownerUid;

export const allTags = list => [...new Set(list.flatMap(a => a.tags || []).filter(Boolean))].sort();

// Filtro de la pared (buscador + estilo) y orden por artista y álbum
export function filterWall(list, query, tag) {
  const q = fold(query);
  return list
    .filter(a => (!q || fold(a.artist).includes(q) || fold(a.name).includes(q)) && (!tag || (a.tags || []).includes(tag)))
    .sort((x, y) => fold(x.artist).localeCompare(fold(y.artist), 'es') || fold(x.name).localeCompare(fold(y.name), 'es'));
}
