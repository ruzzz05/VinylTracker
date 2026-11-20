// Caché de imágenes: al cambiar de pantalla las portadas no se vuelven a descargar ni parpadean.
// 1) En memoria: las que ya se vieron se pintan al instante (sin "carga perezosa" ni cuadrado con la inicial).
// 2) En el móvil (IndexedDB): se guardan hasta MAX imágenes, así siguen ahí al volver a abrir la app o sin conexión.
// Si el servidor de la imagen no permite descargarla (CORS), simplemente se usa la dirección original.
import * as store from './storage.js';
import { h, safeUrl } from './dom.js';

const MAX = 600, MAX_BYTES = 1.5e6;
const mem = new Map();            // url -> objectURL
const seen = new Set();           // urls que ya se vieron cargadas
const pending = new Set();
let idx = [];

export async function preload() {
  idx = (await store.get('imgidx', [])) || [];
  await Promise.all(idx.map(async u => {
    const b = await store.get('img:' + u);
    if (b instanceof Blob) { mem.set(u, URL.createObjectURL(b)); seen.add(u); }
  }));
}

export const resolve = url => mem.get(url) || url;
export const isCached = url => mem.has(url) || seen.has(url);

async function keep(url) {
  if (mem.has(url) || pending.has(url) || !/^https?:\/\//i.test(url) || navigator.onLine === false) return;
  pending.add(url);
  try {
    const r = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer', cache: 'force-cache' });
    if (!r.ok) return;
    const blob = await r.blob();
    if (!/^image\//.test(blob.type) || blob.size > MAX_BYTES) return;
    await store.set('img:' + url, blob);
    idx = idx.filter(u => u !== url); idx.push(url);
    while (idx.length > MAX) { const old = idx.shift(); await store.del('img:' + old); const o = mem.get(old); if (o) { URL.revokeObjectURL(o); mem.delete(old); } }
    await store.set('imgidx', idx);
    mem.set(url, URL.createObjectURL(blob));
  } catch (e) { /* sin CORS o sin red: se usa la dirección original */ }
  finally { pending.delete(url); }
}

// <img> con portada (lazy:false para imágenes que se cargan sin estar aún en pantalla). Si ya se vio, sale al instante; si falla, llama a onFail.
export function cachedImg(url, { cls = '', onFail, onLoad, lazy = true } = {}) {
  const u = safeUrl(url), known = isCached(u);
  const img = h('img', { class: cls, src: resolve(u), alt: '', referrerpolicy: 'no-referrer', decoding: known ? 'sync' : 'async', loading: known || !lazy ? null : 'lazy' });
  img.addEventListener('load', () => { seen.add(u); keep(u); if (onLoad) onLoad(img); });
  if (onFail) img.addEventListener('error', () => onFail(img));
  return img;
}
