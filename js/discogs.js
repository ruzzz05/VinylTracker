// Discogs: precios de mercado en vinilo. Su API permite CORS, así que se llama directo.
import { cleanAlbum, pickRelease } from './core.js';
import * as store from './storage.js';
import { prefs } from './storage.js';

const API = 'https://api.discogs.com';
const TTL = 12 * 3600 * 1000;
let last = 0;

export const hasToken = () => !!prefs.get('discogs.token');

async function call(path, params = {}) {
  const wait = (hasToken() ? 1100 : 2600) - (Date.now() - last);   // límite: 60/min con token, 25/min sin él
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const headers = hasToken() ? { Authorization: 'Discogs token=' + prefs.get('discogs.token') } : {};
  let r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers });
  if (r.status === 429) { await new Promise(res => setTimeout(res, 8000)); r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers }); }
  if (r.status === 401 || r.status === 403) throw new Error('Discogs rechazó el token (' + r.status + ')');
  if (!r.ok) throw new Error('Discogs respondió ' + r.status);
  return r.json();
}

// Lectura de la caché sin red (undefined si no hay)
export async function peek(album, currency = 'EUR') {
  const c = await store.get(`discogs:${currency}:${album.key}`);
  return c && Date.now() - c.at < TTL ? c.v : undefined;
}

// -> { id, url, lowest, forSale, have, want } | { none: true }
export async function lookup(album, currency = 'EUR') {
  const ck = `discogs:${currency}:${album.key}`;
  const cached = await store.get(ck);
  if (cached && Date.now() - cached.at < TTL) return cached.v;
  const res = await call('/database/search', {
    type: 'release', format: 'Vinyl', artist: album.artist, release_title: cleanAlbum(album.name), per_page: 15
  });
  const hit = pickRelease(res.results, album.artist, album.name);
  let v = { none: true };
  if (hit) {
    const st = await call(`/marketplace/stats/${hit.id}`, { curr_abbr: currency });
    const lp = st.lowest_price;
    v = {
      id: hit.id, url: `https://www.discogs.com/release/${hit.id}`,
      lowest: lp && typeof lp === 'object' ? lp.value : lp ?? null,
      forSale: st.num_for_sale ?? null,
      have: hit.community && hit.community.have, want: hit.community && hit.community.want
    };
  }
  await store.set(ck, { at: Date.now(), v });
  return v;
}

// Búsqueda de artistas por nombre (para su foto). Solo devuelve imágenes con token.
export async function searchArtist(name) {
  return (await call('/database/search', { type: 'artist', q: name, per_page: 5 })).results || [];
}

// Edición concreta: copias a la venta y precio más bajo. -> { forSale, lowest, at }
export async function releaseStats(id, currency = 'EUR') {
  const st = await call(`/marketplace/stats/${id}`, { curr_abbr: currency });
  const lp = st.lowest_price;
  return { forSale: st.num_for_sale ?? 0, lowest: lp && typeof lp === 'object' ? lp.value : lp ?? null, at: Date.now() };
}

// Búsqueda libre de ediciones en vinilo (para la lista de deseos). Discogs exige token para buscar.
export async function searchReleases(q) {
  return (await call('/database/search', { type: 'release', format: 'Vinyl', q, per_page: 20 })).results || [];
}

// Por código de barras (cualquier formato; los vinilos salen primero al ordenar)
export async function searchBarcode(code) {
  return (await call('/database/search', { type: 'release', barcode: code, per_page: 20 })).results || [];
}
