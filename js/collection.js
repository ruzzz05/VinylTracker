// Tu colección de vinilos de mi-app: CSV público + discos añadidos (Firestore).
import { config } from './config.js';
import { mergeCollection, parseCollectionCsv } from './core.js';
import * as store from './storage.js';

export async function loadBase({ force = false } = {}) {
  const cached = await store.get('collection.csv');
  if (!force && cached && Date.now() - cached.at < 3600 * 1000) return cached.rows;
  try {
    const r = await fetch(config.miApp.base + config.miApp.csv, { cache: 'no-store' });
    if (!r.ok) throw new Error('mi-app respondió ' + r.status);
    const rows = parseCollectionCsv(await r.text(), config.miApp.base + config.miApp.images);
    await store.set('collection.csv', { at: Date.now(), rows });
    return rows;
  } catch (e) {
    if (cached) return cached.rows;     // sin conexión: la última copia
    throw e;
  }
}

export const combine = (base, extras) => mergeCollection(base, extras);
