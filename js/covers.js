// Portadas de canciones. Orden: 1) la portada del álbum si ya la conocemos (API de Spotify, registro en vivo);
// 2) iTunes Search (público, sin clave ni cuenta, permite CORS). Se guardan en el móvil: cada canción se consulta una vez.
import { fold, tokens, albumKey } from './core.js';
import * as store from './storage.js';
import { h, safeUrl } from './dom.js';

const TTL_HIT = 60 * 86400000, TTL_MISS = 3 * 86400000;

// iTunes da artworkUrl100 (100×100): se pide una versión mayor cambiando el tamaño de la dirección
export const bigArtwork = url => String(url || '').replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/300x300bb.$2');

const sameTokens = (a, b) => { const x = tokens(a).join(' '), y = tokens(b).join(' '); return !!x && x === y; };
const sameName = (a, b) => fold(a) === fold(b) || sameTokens(a, b);
const noParens = s => String(s || '').replace(/\s*[(\[].*[)\]]\s*$/, '');

// De los resultados de iTunes (entity=song) elige la canción de ese artista; mejor si también coincide el álbum. -> url | null
export function pickSong(results, artist, track, album = '') {
  const cand = (results || []).filter(r => r.artworkUrl100
    && sameName(r.artistName, artist)
    && (sameName(r.trackName, track) || sameName(noParens(r.trackName), noParens(track))));
  if (!cand.length) return null;
  const al = album && tokens(album).length ? cand.find(r => sameTokens(noParens(r.collectionName), noParens(album))) : null;
  return bigArtwork((al || cand[0]).artworkUrl100);
}

// Portadas de álbum que ya conocemos, por clave de álbum: { key: url }
export function knownCovers({ apiAlbums = {}, live = { entries: [] } } = {}) {
  const map = {};
  for (const [k, a] of Object.entries(apiAlbums)) if (a.image) map[k] = a.image;
  for (const e of live.entries || []) if (e.image && e.album) { const k = albumKey(e.artist, e.album); if (!map[k]) map[k] = e.image; }
  return map;
}

// ---------- caché + cola ----------
const mem = new Map();
const inflight = new Map();
let chain = Promise.resolve();
let cooldownUntil = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchSong(t) {
  if (Date.now() < cooldownUntil) return undefined;
  try {
    await sleep(250);
    const q = new URLSearchParams({ entity: 'song', limit: '8', country: 'ES', term: `${t.artist} ${t.name}` });
    const r = await fetch('https://itunes.apple.com/search?' + q);
    if (!r.ok) throw new Error(String(r.status));
    return pickSong((await r.json()).results, t.artist, t.name, t.album) || '';
  } catch (e) { cooldownUntil = Date.now() + 60000; return undefined; }
}

// -> url | '' (sin portada) | undefined (no se pudo consultar ahora)
export function trackImage(t, known = {}) {
  const fromAlbum = t.album && known[albumKey(t.artist, t.album)];
  if (fromAlbum) return Promise.resolve(fromAlbum);
  const key = 'trkimg:' + fold(t.artist) + '|' + fold(t.name);
  if (mem.has(key)) return Promise.resolve(mem.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const c = await store.get(key);
    if (c && Date.now() - c.at < (c.url ? TTL_HIT : TTL_MISS)) { mem.set(key, c.url); return c.url; }
    if (navigator.onLine === false) return undefined;
    const url = await (chain = chain.then(() => fetchSong(t), () => fetchSong(t)));
    if (url !== undefined) { mem.set(key, url); await store.set(key, { url, at: Date.now() }); }
    return url;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Cuadrado con la inicial que se cambia por la portada cuando llega (solo si la imagen carga de verdad)
export function trackCover(t, known) {
  const wrap = h('div', { class: 'avwrap' }, h('div', { class: 'cover ph' }, (t.name || '?').trim().charAt(0).toUpperCase()));
  trackImage(t, known).then(url => {
    if (!url || safeUrl(url) === '#') return;
    const img = h('img', { class: 'cover', src: safeUrl(url), alt: '', referrerpolicy: 'no-referrer' });
    img.addEventListener('load', () => wrap.replaceChildren(img));
  }).catch(() => {});
  return wrap;
}
