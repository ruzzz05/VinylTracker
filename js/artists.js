// Fotos de artista. Spotify primero (si está conectado) y Discogs como respaldo (necesita tu token).
// Se guardan en el móvil: cada artista se consulta una sola vez (los que no tienen foto, se reintentan a los pocos días).
import { fold, tokens } from './core.js';
import * as store from './storage.js';
import * as spotify from './spotify.js';
import * as discogs from './discogs.js';
import { h, safeUrl } from './dom.js';
import { cachedImg } from './imgcache.js';

const TTL_HIT = 30 * 86400000, TTL_MISS = 3 * 86400000;

// ---------- elegir el resultado correcto (lógica pura) ----------
const sameTokens = (a, b) => { const x = tokens(a), y = tokens(b); return x.length > 0 && x.length === y.length && x.every(t => y.includes(t)); };

// Spotify: el artista con el mismo nombre (el más popular si hay varios); null si no hay uno claro
export function pickSpotifyArtist(items, name) {
  const exact = (items || []).filter(a => fold(a.name) === fold(name) || sameTokens(a.name, name));
  if (!exact.length) return null;
  exact.sort((x, y) => (y.popularity || 0) - (x.popularity || 0));
  const imgs = exact.find(a => (a.images || []).length)?.images;
  return imgs ? (imgs[1] || imgs[0]).url : null;
}

// Discogs: mismo nombre, mejor sin "(2)" de desambiguación; sin las imágenes vacías (spacer.gif)
export function pickDiscogsArtist(results, name) {
  const clean = t => String(t || '').replace(/\s\(\d+\)$/, '');
  const exact = (results || []).filter(r => fold(clean(r.title)) === fold(name) || sameTokens(clean(r.title), name));
  exact.sort((x, y) => /\(\d+\)$/.test(x.title) - /\(\d+\)$/.test(y.title));
  for (const r of exact) {
    const url = [r.cover_image, r.thumb].find(u => u && !/spacer\.gif/.test(u));
    if (url) return url;
  }
  return null;
}

// ---------- caché + cola ----------
const mem = new Map();
const inflight = new Map();
let chain = Promise.resolve();
let cooldownUntil = 0;

export const canFetchImages = () => spotify.isConnected() || discogs.hasToken();

async function fetchOne(name) {
  if (Date.now() < cooldownUntil) return undefined;            // Spotify/Discogs pidieron calma: no insistir
  try {
    if (spotify.isConnected()) {
      try { const u = pickSpotifyArtist(await spotify.searchArtist(name), name); if (u) return u; }
      catch (e) { if (!discogs.hasToken()) throw e; }          // si Spotify falla, se prueba con Discogs
    }
    if (discogs.hasToken()) return pickDiscogsArtist(await discogs.searchArtist(name), name) || '';
    return '';
  } catch (e) { cooldownUntil = Date.now() + 60000; return undefined; }
}

// -> url | '' (sin foto) | undefined (no se pudo consultar ahora)
export function artistImage(name) {
  const key = 'artimg:' + fold(name);
  if (mem.has(key)) return Promise.resolve(mem.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const c = await store.get(key);
    if (c && Date.now() - c.at < (c.url ? TTL_HIT : TTL_MISS)) { mem.set(key, c.url); return c.url; }
    if (!canFetchImages()) return undefined;
    const url = await (chain = chain.then(() => fetchOne(name), () => fetchOne(name)));
    if (url !== undefined) { mem.set(key, url); await store.set(key, { url, at: Date.now() }); }
    return url;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ---------- avatar (círculo con la inicial; se cambia por la foto cuando llega) ----------
export function artistAvatar(name) {
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  const ph = () => h('div', { class: 'cover ph round' }, letter);
  const wrap = h('div', { class: 'avwrap' });
  const known = mem.get('artimg:' + fold(name));                 // ya resuelto en esta sesión: la foto sale al instante
  if (known && safeUrl(known) !== '#') { wrap.append(cachedImg(known, { cls: 'cover round', onFail: () => wrap.replaceChildren(ph()) })); return wrap; }
  wrap.append(ph());
  artistImage(name).then(url => {
    if (!url || safeUrl(url) === '#') return;
    const img = cachedImg(url, { cls: 'cover round', lazy: false });
    img.addEventListener('load', () => wrap.replaceChildren(img));          // solo se cambia si la imagen carga de verdad
  }).catch(() => {});
  return wrap;
}
