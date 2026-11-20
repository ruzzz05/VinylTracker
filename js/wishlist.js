// Lista de deseos y comprados (lógica pura, sin red ni DOM). Se prueba con `node --test tests/`.
//
// Un elemento puede ser:
//   · kind 'album'   → un álbum en cualquier edición (se vigila en las tiendas)
//   · kind 'release' → una edición concreta de Discogs (se vigila además su mercado)
// status 'wanted' = lo quiero; 'bought' = ya lo compré (NO entra en la colección: solo se anota y deja de salir como sugerencia).
import { albumKey, legacyAlbumKey, matchStores } from './core.js';

export const wishId = ({ kind, discogsId, artist, name }) => (kind === 'release' && discogsId ? 'r' + discogsId : 'a|' + legacyAlbumKey(artist, name));   // formato antiguo a propósito: los deseos ya guardados (y su copia en la nube) llevan ese id

export function makeWish({ kind = 'album', artist, name, image = '', discogsId = 0, barcode = '', detail = '', now = Date.now() }) {
  artist = String(artist || '').trim().slice(0, 80); name = String(name || '').trim().slice(0, 120);
  if (!artist || !name) return null;
  if (kind === 'release' && !discogsId) kind = 'album';
  const w = { kind, artist, name, image: String(image || ''), discogsId: kind === 'release' ? Number(discogsId) : 0, barcode: String(barcode || ''),
    detail: String(detail || ''), addedAt: now, status: 'wanted', boughtAt: 0, price: null,
    notified: null,           // null = todavía sin primera comprobación (no avisa de lo que ya estaba)
    checkedAt: 0, dg: null };
  w.id = wishId(w);
  return w;
}

export const find = (list, id) => list.find(w => w.id === id);

// Añade al principio. Si ya existe (mismo id) no duplica; devuelve { list, item, dup }
export function addWish(list, w) {
  const dup = find(list, w.id);
  if (dup) return { list, item: dup, dup: true };
  return { list: [w, ...list], item: w, dup: false };
}

export const removeWish = (list, id) => list.filter(w => w.id !== id);

// Marca como comprado (si no estaba en la lista, lo apunta directamente como comprado)
export function markBought(list, w, { price = null, now = Date.now() } = {}) {
  const p = price === '' || price == null || !Number.isFinite(Number(price)) ? null : Number(price);
  const done = { ...(find(list, w.id) || w), status: 'bought', boughtAt: now, price: p };
  return find(list, w.id) ? list.map(x => (x.id === w.id ? done : x)) : [done, ...list];
}

export const unbuy = (list, id) => list.map(w => (w.id === id ? { ...w, status: 'wanted', boughtAt: 0, price: null } : w));

// Claves de álbum (artista|álbum) de lo comprado / deseado, para ocultarlo o marcarlo en las sugerencias
const keysOf = (list, status) => new Set(list.filter(w => w.status === status).map(w => albumKey(w.artist, w.name)));
export const boughtKeys = list => keysOf(list, 'bought');
export const wantedKeys = list => keysOf(list, 'wanted');

// ---------- avisos ----------
// Ofertas de tienda con stock o preventa para este elemento
export const liveOffers = (w, storeIndex) => matchStores(w, storeIndex || []).filter(o => o.available || o.preorder);

// Qué está "disponible" ahora: claves 'tienda:URL' y 'discogs' (hay copias a la venta)
export function liveKeys(w, offers, dg) {
  return [...offers.map(o => 'store:' + o.url), ...(dg && dg.forSale > 0 ? ['discogs'] : [])];
}

// Comprueba un elemento. Devuelve { item, fresh } donde `fresh` son las claves que acaban de aparecer.
// Primera comprobación: solo anota lo que ya había (sin avisar). Lo que deja de estar y vuelve, avisa otra vez.
export function checkItem(w, { storeIndex, dg, now = Date.now() }) {
  const offers = liveOffers(w, storeIndex);
  const dgNow = dg === undefined ? w.dg : dg;      // undefined = no se consultó Discogs esta vez: se conserva lo último
  const live = liveKeys(w, offers, dgNow);
  const firstDg = w.dg == null;                    // primera vez que se mira Discogs: se anota, sin avisar de lo que ya estaba a la venta
  const fresh = w.notified === null ? [] : live.filter(k => !w.notified.includes(k) && !(k === 'discogs' && firstDg));
  return { item: { ...w, notified: live, dg: dgNow, checkedAt: now }, fresh, offers };
}

// Recorre la lista de deseos (no los comprados). -> { list, alerts: [{ item, fresh, offers }] }
export function checkAll(list, { storeIndex, dgMap = {}, now = Date.now() }) {
  const alerts = [];
  const out = list.map(w => {
    if (w.status !== 'wanted') return w;
    const r = checkItem(w, { storeIndex, dg: dgMap[w.id], now });
    if (r.fresh.length) alerts.push({ item: r.item, fresh: r.fresh, offers: r.offers });
    return r.item;
  });
  return { list: out, alerts };
}

// Texto corto del aviso para el toast / la notificación
export function alertText(a) {
  const where = [];
  for (const o of a.offers.filter(o => a.fresh.includes('store:' + o.url))) where.push(`${o.store}${o.preorder && !o.available ? ' (preventa)' : ''}`);
  if (a.fresh.includes('discogs')) where.push('Discogs');
  return `${a.item.name} · ${a.item.artist}: ya disponible en ${[...new Set(where)].join(', ')}`;
}

// ¿Hay que volver a mirar Discogs? (cada 6 h como mucho) y solo para los deseados
export const DG_TTL = 6 * 3600 * 1000;
export const needsDiscogs = (w, now = Date.now()) => w.status === 'wanted' && (!w.dg || now - (w.dg.at || 0) > DG_TTL);

// ---------- Discogs: resultados de búsqueda -> datos compactos ----------
export function parseDiscogsResult(r) {
  const title = String(r.title || '');
  const i = title.indexOf(' - ');
  const artist = (i > 0 ? title.slice(0, i) : '').replace(/\s\(\d+\)$/, '');
  const name = i > 0 ? title.slice(i + 3) : title;
  const fmt = [].concat(r.format || []).map(String);
  const label = [].concat(r.label || [])[0] || '';
  const extra = fmt.filter(f => !/^(vinyl|album)$/i.test(f)).slice(0, 4).join(', ');
  const detail = [r.year, r.country, label, extra].filter(Boolean).join(' · ');
  const image = [r.cover_image, r.thumb].find(u => u && !/spacer\.gif/.test(u)) || '';
  return { discogsId: Number(r.id) || 0, artist, name, year: r.year || '', country: r.country || '', label, detail, image,
    isVinyl: fmt.some(f => /vinyl|^lp$/i.test(f)), barcode: [].concat(r.barcode || [])[0] || '' };
}

// Vinilos primero, y dentro de ellos los que más gente tiene (suelen ser la edición "normal")
export function sortResults(results) {
  return (results || []).map((raw, i) => ({ r: parseDiscogsResult(raw), i, have: Number((raw.community || {}).have) || 0 }))
    .filter(x => x.r.discogsId && x.r.name)
    .sort((x, y) => (y.r.isVinyl - x.r.isVinyl) || (y.have - x.have) || (x.i - y.i)).map(x => x.r);
}
