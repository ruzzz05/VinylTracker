// Almacenamiento local: IndexedDB (datos grandes) con respaldo en memoria. Nada sale del dispositivo.
const DB = 'vinyltracker', STORE = 'kv';
const mem = new Map();
let dbp;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(() => null);
    // IndexedDB puede quedarse colgada (p. ej. bloqueada por otra pestaña): pasados 4 s se usa solo la memoria
    dbp = Promise.race([dbp, new Promise(res => setTimeout(() => res(null), 4000))]);
  }
  return dbp;
}

const tx = (d, mode, fn) => new Promise((res, rej) => {
  const t = d.transaction(STORE, mode);
  const req = fn(t.objectStore(STORE));
  t.oncomplete = () => res(req && req.result);
  t.onerror = () => rej(t.error);
});

export async function get(key, fallback = null) {
  const d = await db();
  if (!d) return mem.has(key) ? mem.get(key) : fallback;
  try { const v = await tx(d, 'readonly', s => s.get(key)); return v === undefined ? fallback : v; }
  catch (e) { return fallback; }
}

export async function set(key, value) {
  const d = await db();
  if (!d) { mem.set(key, value); return; }
  try { await tx(d, 'readwrite', s => s.put(value, key)); } catch (e) { mem.set(key, value); }
}

export async function del(key) {
  const d = await db();
  if (!d) { mem.delete(key); return; }
  try { await tx(d, 'readwrite', s => s.delete(key)); } catch (e) { mem.delete(key); }
}

export async function clearAll() {
  const d = await db();
  mem.clear();
  if (d) await tx(d, 'readwrite', s => s.clear());
}

// Ajustes pequeños (localStorage), con try/catch por si el navegador lo bloquea
export const prefs = {
  get(k, f = '') { try { const v = localStorage.getItem('vt.' + k); return v === null ? f : v; } catch (e) { return f; } },
  set(k, v) { try { localStorage.setItem('vt.' + k, v); } catch (e) { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem('vt.' + k); } catch (e) { /* */ } }
};
