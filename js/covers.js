// Portadas de canciones y álbumes (también singles, que no pertenecen a ningún álbum).
// Orden: 1) la portada del álbum si ya la conocemos (API de Spotify, registro en vivo);
// 2) Spotify (si está conectado); 3) iTunes Search (público, sin cuenta, permite CORS).
// Se guardan en el móvil: cada una se consulta una sola vez (las que no aparecen se reintentan a los pocos días).
import { fold, tokens, albumKey } from './core.js';
import * as store from './storage.js';
import * as spotify from './spotify.js';
import { h, safeUrl } from './dom.js';
import { cachedImg } from './imgcache.js';

const TTL_HIT = 60 * 86400000, TTL_MISS = 3 * 86400000;

// iTunes da artworkUrl100 (100×100): se pide una versión mayor cambiando el tamaño de la dirección
export const bigArtwork = url => String(url || '').replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/300x300bb.$2');

const sameTokens = (a, b) => { const x = tokens(a).join(' '), y = tokens(b).join(' '); return !!x && x === y; };
const sameName = (a, b) => fold(a) === fold(b) || sameTokens(a, b);
const noParens = s => String(s || '').replace(/\s*[(\[].*[)\]]\s*$/, '');
const noSingle = s => noParens(String(s || '').replace(/\s+-\s+(single|ep)\s*$/i, ''));
const sameTitle = (a, b) => sameName(a, b) || sameName(noParens(a), noParens(b)) || sameName(noSingle(a), noSingle(b));

// ---------- elegir el resultado correcto (lógica pura) ----------
// iTunes (entity=song): la canción de ese artista; mejor si también coincide el álbum. -> url | null
export function pickSong(results, artist, track, album = '') {
  const cand = (results || []).filter(r => r.artworkUrl100 && sameName(r.artistName, artist) && sameTitle(r.trackName, track));
  if (!cand.length) return null;
  const al = album && tokens(album).length ? cand.find(r => sameTokens(noParens(r.collectionName), noParens(album))) : null;
  return bigArtwork((al || cand[0]).artworkUrl100);
}

// iTunes (entity=album): el álbum (o single / EP: «Título - Single») de ese artista. -> url | null
export function pickAlbum(results, artist, name) {
  const r = (results || []).find(x => x.artworkUrl100 && sameName(x.artistName, artist) && sameTitle(x.collectionName, name));
  return r ? bigArtwork(r.artworkUrl100) : null;
}

const spImg = images => ((images || [])[1] || (images || [])[0] || {}).url || null;

// Spotify (type=track): la canción de ese artista -> portada de su álbum / single
export function pickSpotifyTrack(items, artist, track) {
  for (const t of items || []) {
    if (!sameTitle(t.name, track) || !(t.artists || []).some(a => sameName(a.name, artist))) continue;
    const u = spImg((t.album || {}).images);
    if (u) return u;
  }
  return null;
}

// Spotify (type=album): el álbum / single de ese artista
export function pickSpotifyAlbum(items, artist, name) {
  for (const a of items || []) {
    if (!sameTitle(a.name, name) || !(a.artists || []).some(x => sameName(x.name, artist))) continue;
    const u = spImg(a.images);
    if (u) return u;
  }
  return null;
}

// Portadas de álbum que ya conocemos, por clave de álbum: { key: url }
export function knownCovers({ apiAlbums = {}, live = { entries: [] } } = {}) {
  const map = {};
  for (const [k, a] of Object.entries(apiAlbums)) if (a.image) map[k] = a.image;
  for (const e of live.entries || []) if (e.image && e.album) { const k = albumKey(e.artist, e.album); if (!map[k]) map[k] = e.image; }
  return map;
}

// ---------- red: caché + cola ----------
const mem = new Map();
const inflight = new Map();
let chain = Promise.resolve();
let cooldownUntil = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const itunes = async params => {
  await sleep(250);
  const r = await fetch('https://itunes.apple.com/search?' + new URLSearchParams({ limit: '10', country: 'ES', ...params }));
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).results || [];
};

// kind 'track': { artist, name, album? } · kind 'album': { artist, name }  (un single cuenta como álbum)
async function fetchCover(kind, t) {
  if (Date.now() < cooldownUntil) return undefined;
  try {
    if (spotify.isConnected()) {
      try {
        const u = kind === 'track' ? pickSpotifyTrack(await spotify.searchTrack(t.artist, t.name), t.artist, t.name)
          : pickSpotifyAlbum(await spotify.searchAlbum(t.artist, t.name), t.artist, t.name);
        if (u) return u;
      } catch (e) { /* Spotify falla: se prueba con iTunes */ }
    }
    const term = `${t.artist} ${t.name}`;
    if (kind === 'track') {
      const u = pickSong(await itunes({ entity: 'song', term }), t.artist, t.name, t.album);
      if (u) return u;
      if (t.album) { const a = pickAlbum(await itunes({ entity: 'album', term: `${t.artist} ${t.album}` }), t.artist, t.album); if (a) return a; }
      return '';
    }
    const a = pickAlbum(await itunes({ entity: 'album', term }), t.artist, t.name);
    if (a) return a;
    return pickSong(await itunes({ entity: 'song', term }), t.artist, t.name) || '';      // un single suele estar solo como «canción»
  } catch (e) { cooldownUntil = Date.now() + 60000; return undefined; }
}

// -> url | '' (sin portada) | undefined (no se pudo consultar ahora)
function cover(kind, t, known = {}) {
  const fromAlbum = kind === 'track' ? t.album && known[albumKey(t.artist, t.album)] : known[albumKey(t.artist, t.name)];
  if (fromAlbum) return Promise.resolve(fromAlbum);
  const key = `cov2:${kind}:${fold(t.artist)}|${fold(t.name)}`;
  if (mem.has(key)) return Promise.resolve(mem.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const c = await store.get(key);
    if (c && Date.now() - c.at < (c.url ? TTL_HIT : TTL_MISS)) { mem.set(key, c.url); return c.url; }
    if (navigator.onLine === false) return undefined;
    const url = await (chain = chain.then(() => fetchCover(kind, t), () => fetchCover(kind, t)));
    if (url !== undefined) { mem.set(key, url); await store.set(key, { url, at: Date.now() }); }
    return url;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
export const trackImage = (t, known) => cover('track', t, known);
export const albumImage = (a, known) => cover('album', a, known);

// Resultado ya conocido en esta sesión (sin red): url | '' | undefined
export const peekCover = (kind, t) => mem.get(`cov2:${kind}:${fold(t.artist)}|${fold(t.name)}`);

// ---------- elementos ----------
// Cuadrado con la inicial que se cambia por la portada cuando llega; si ya se conoce, sale al instante.
function coverBox(kind, t, known, { cls = '', wrapCls = 'avwrap', url = '' } = {}) {
  const letter = (t.name || t.artist || '?').trim().charAt(0).toUpperCase();
  const ph = () => h('div', { class: 'cover ph ' + cls }, letter);
  const wrap = h('div', { class: wrapCls });
  const img = u => cachedImg(u, { cls: 'cover ' + cls, onFail: () => wrap.replaceChildren(ph()) });
  const sync = url || (kind === 'track' ? t.album && known && known[albumKey(t.artist, t.album)] : known && known[albumKey(t.artist, t.name)]) || peekCover(kind, t);
  if (sync && safeUrl(sync) !== '#') { wrap.append(img(sync)); return wrap; }
  wrap.append(ph());
  cover(kind, t, known).then(u => {
    if (!u || safeUrl(u) === '#') return;
    const el = cachedImg(u, { cls: 'cover ' + cls, lazy: false });
    el.addEventListener('load', () => wrap.replaceChildren(el));      // solo se cambia si la imagen carga de verdad
  }).catch(() => {});
  return wrap;
}
export const trackCover = (t, known) => coverBox('track', t, known);
// Álbum o single (también los que no tienen portada guardada)
export const albumCover = (a, known, cls = '') => coverBox('album', a, known, { cls, wrapCls: 'covwrap', url: a.image });
