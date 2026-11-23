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

// Sin espacios entre palabras: así "Diego 900" y "Diego900" (o "C. Tangana" y "C.Tangana") son el mismo artista
export const artistKey = artist => tokens(artist).join('');
// Formato antiguo (palabras separadas por espacios): se conserva para los identificadores YA guardados (deseos, copia en la nube)
export const legacyAlbumKey = (artist, album) => tokens(artist).join(' ') + '|' + tokens(cleanAlbum(album)).join(' ');
export const albumKey = (artist, album) => artistKey(artist) + '|' + tokens(cleanAlbum(album)).join('');

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
    out.push({ artist: e.artist, name: e.name, image: e.image || '', tags: e.tags || [], url: e.url || '', year: e.year || null, id: e.id || '', extra: true, manual: !!e.manual });
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

export const corteInglesUrl = album =>
  'https://www.elcorteingles.es/search-nwx/1/?s=' + encodeURIComponent(`${album.artist} ${cleanAlbum(album.name)} vinilo`).replace(/%20/g, '+') + '&stype=text_box';

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
// Por qué un disco guardado en la nube no se acepta ('' = es válido)
export function whyInvalid(a) {
  if (!isObj(a)) return 'no es un disco';
  if (typeof a.id !== 'string' || !new RegExp('^' + SPOTIFY_ID + '$').test(a.id)) return 'su id de Spotify no es válido';
  if (typeof a.artist !== 'string' || !a.artist) return 'no tiene artista';
  if (typeof a.name !== 'string' || !a.name) return 'no tiene nombre';
  if (!validImage(a.image)) return 'su portada no es una dirección https válida';
  if (!Array.isArray(a.tags)) return 'sus estilos no están bien guardados';
  if (a.url !== 'https://open.spotify.com/album/' + a.id) return 'su enlace de Spotify no coincide con el id';
  return '';
}
export const validStored = a => !whyInvalid(a);

// Separa los discos del documento de la nube: válidos, no válidos (con el motivo) y todos tal cual (raw).
// corrupt = el texto no se puede leer como JSON (en ese caso NO se debe reescribir el documento).
export function splitExtras(text) {
  let v;
  try { v = JSON.parse(text); } catch (e) { return { ok: [], bad: [], raw: [], corrupt: typeof text === 'string' && text.trim() !== '' }; }
  const raw = isObj(v) && Array.isArray(v.albums) ? v.albums : [];
  const ok = [], bad = [];
  for (const a of raw) { const why = whyInvalid(a); if (why) bad.push({ album: a, why }); else ok.push(a); }
  return { ok, bad, raw, corrupt: false };
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

// ---------- Estado de sincronización (mismas reglas y textos que mi-app) ----------
// "hace 5 min", "hace 2 h", "hace 3 días". Vacío si no hay hora; una hora futura cuenta como ahora.
export function relativeTime(ts, now) {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diff = Math.max(0, now - ts);
  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  if (diff < MIN) return 'hace un momento';
  if (diff < HOUR) return 'hace ' + Math.floor(diff / MIN) + ' min';
  if (diff < DAY) return 'hace ' + Math.floor(diff / HOUR) + ' h';
  const days = Math.floor(diff / DAY);
  return 'hace ' + days + (days === 1 ? ' día' : ' días');
}

// Prioridad: sin conexión, sincronizando, error, cambios sin subir, sincronizado, sin sincronizar todavía.
export function syncStatus({ online = true, syncing = false, error = '', dirty = false, lastSyncAt = 0, now = Date.now() } = {}) {
  const last = relativeTime(lastSyncAt, now);
  const lastText = last ? 'Última sincronización: ' + last : 'Todavía no se ha sincronizado en este dispositivo.';
  if (!online) return { state: 'offline', label: 'Sin conexión', detail: dirty ? 'Tienes cambios sin subir; se subirán solos cuando vuelva la conexión. ' + lastText : 'No hay conexión. ' + lastText };
  if (syncing) return { state: 'syncing', label: 'Sincronizando…', detail: 'Comprobando tus datos.' };
  if (error) return { state: 'error', label: 'Error al sincronizar', detail: error + ' ' + lastText };
  if (dirty) return { state: 'pending', label: 'Cambios sin subir', detail: 'Se subirán en unos segundos. ' + lastText };
  if (last) return { state: 'ok', label: 'Sincronizado', detail: lastText };
  return { state: 'unknown', label: 'Sin sincronizar todavía', detail: lastText };
}

// El paquete básico de Spotify ("Datos de la cuenta", StreamingHistory_music_*.json) trae
// { endTime: "2026-05-01 10:20" (UTC), artistName, trackName, msPlayed } y NO trae álbum.
// Se convierte al formato del historial ampliado para poder usar las mismas estadísticas.
export function normalizeEntries(entries) {
  return entries.map(e => {
    if (e && e.endTime && e.artistName !== undefined) {
      const iso = String(e.endTime).trim().replace(' ', 'T');
      return {
        ts: /Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : (iso.length === 16 ? iso + ':00Z' : iso + 'Z'),
        ms_played: e.msPlayed || 0,
        master_metadata_album_artist_name: e.artistName || null,
        master_metadata_track_name: e.trackName || null,
        master_metadata_album_album_name: null
      };
    }
    return e;
  });
}

// Une dos historiales por álbum ({ key: {artist, name, id, months, tracks} }), sumando los meses
export function mergeHistory(a, b) {
  const out = { ...(a || {}) };
  for (const [k, h] of Object.entries(b || {})) {
    const o = out[k];
    if (!o) { out[k] = h; continue; }
    const months = { ...o.months };
    for (const [m, c] of Object.entries(h.months)) months[m] = months[m] ? { ms: months[m].ms + c.ms, plays: months[m].plays + c.plays } : { ...c };
    out[k] = { ...o, id: o.id || h.id, months, tracks: [...new Set([...(o.tracks || []), ...(h.tracks || [])])].slice(0, 60) };
  }
  return out;
}

// Las claves guardadas por versiones anteriores llevaban espacios: se recalculan al cargar
export function rekeyHistory(h) {
  const out = {};
  for (const v of Object.values(h || {})) {
    const k = albumKey(v.artist, v.name);
    out[k] = out[k] ? mergeHistory({ [k]: out[k] }, { [k]: v })[k] : v;
  }
  return out;
}
export function rekeyApi(a) {
  const out = {};
  for (const v of Object.values(a || {})) {
    const k = albumKey(v.artist, v.name), o = out[k];
    out[k] = o ? { ...o, points: Math.max(o.points || 0, v.points || 0), saved: o.saved || v.saved } : v;
  }
  return out;
}

// Quita lo de artistas con una sola reproducción (una canción suelta). Lo que solo viene de la API de Spotify (sin reproducciones contadas) se conserva.
export function minArtistPlays(list, min = 2) {
  const by = new Map();
  for (const r of list) by.set(fold(r.artist), (by.get(fold(r.artist)) || 0) + (r.plays || 0));
  return list.filter(r => !r.plays && !by.get(fold(r.artist)) ? true : by.get(fold(r.artist)) >= min);
}

// ---------- Discos añadidos a mano o por código de barras (no llevan id de Spotify, así que no pueden ir al documento de mi-app) ----------
// Se guardan en el dispositivo y en la copia de la nube de VinylTracker. -> { ok, album } | { ok: false, error }
export function makeManual({ name, artist, year, tags, image, spotifyUrl, id, now }) {
  const n = cleanText(name, MAX_NAME), a = cleanText(artist, MAX_ARTIST);
  if (!n) return { ok: false, error: 'Falta el nombre del álbum.' };
  if (!a) return { ok: false, error: 'Falta el artista.' };
  const img = cleanText(image, MAX_IMAGE);
  if (img && !validImage(img)) return { ok: false, error: 'La portada debe ser una dirección https.' };
  const sp = spotifyUrl && String(spotifyUrl).trim() ? parseSpotifyAlbum(spotifyUrl) : null;
  if (spotifyUrl && String(spotifyUrl).trim() && !sp) return { ok: false, error: 'Ese enlace no es de un álbum de Spotify.' };
  return { ok: true, album: { id: id || 'm' + (now || Date.now()).toString(36) + Math.random().toString(36).slice(2, 6), artist: a, name: n, image: img,
    tags: Array.isArray(tags) ? tags : normalizeTags(tags), url: sp ? sp.url : '', year: cleanYear(year), addedAt: now || Date.now(), manual: true } };
}
