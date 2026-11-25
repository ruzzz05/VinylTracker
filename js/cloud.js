// Copia en la nube (Firestore de mi-app, solo el dueño escribe): lista de deseos/comprados, registro en vivo,
// historial importado y ajustes. NO se suben los tokens ni claves (Spotify, Discogs, Ticketmaster).
// Cada pieza va comprimida (gzip + base64) en trozos de ≤ 700 000 caracteres (límite de Firestore: 1 MiB por documento).
import * as fb from './firebase.js';
import { prefs } from './storage.js';

export const CHUNK = 700000;
export const KEYS = ['wish', 'manual', 'live', 'history', 'prefs'];
export const PREF_KEYS = ['theme', 'months', 'rankView', 'buyView', 'tab', 'concMonths', 'conc.country', 'discogs.user', 'filter', 'rd.excluded', 'rd.months', 'rd.kind'];

export async function pack(obj) {
  const cs = new CompressionStream('gzip'), w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(JSON.stringify(obj))); w.close();
  const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function unpack(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream('gzip'), w = ds.writable.getWriter();
  w.write(u); w.close();
  return JSON.parse(await new Response(ds.readable).text());
}

export const split = (s, size = CHUNK) => { const out = []; for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size)); return out.length ? out : ['']; };

// Deseos: une lo local y lo de la nube. Si un disco está en los dos, gana "comprado"; si no, la comprobación más reciente.
export function mergeWish(local, cloud) {
  const by = new Map();
  for (const w of [...(cloud || []), ...(local || [])]) {
    const p = by.get(w.id);
    if (!p) { by.set(w.id, w); continue; }
    const pick = (p.status === 'bought') !== (w.status === 'bought') ? (p.status === 'bought' ? p : w) : ((w.checkedAt || 0) >= (p.checkedAt || 0) ? w : p);
    by.set(w.id, pick);
  }
  return [...by.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export const collectPrefs = () => Object.fromEntries(PREF_KEYS.map(k => [k, prefs.get(k, '')]).filter(([, v]) => v !== ''));
export const localAt = k => Number(prefs.get('cloud.at.' + k, '0'));
const setAt = (k, at) => prefs.set('cloud.at.' + k, String(at));

export const available = () => fb.isLoggedIn() && fb.isOwner();

// Sube una pieza. Los trozos primero y el documento "meta" al final: si se corta, la copia anterior sigue válida.
export async function pushKey(k, data) {
  const packed = await pack(data), parts = split(packed), at = Date.now();
  for (let i = 0; i < parts.length; i++) await fb.putFields(`vt-${k}-${i}`, { json: parts[i] });
  await fb.putFields(`vt-${k}`, { at, n: parts.length });
  setAt(k, at);
  return at;
}

// Baja una pieza -> { at, data } | null
export async function pullKey(k) {
  const meta = await fb.getFields(`vt-${k}`);
  if (!meta || !meta.n) return null;
  let s = '';
  for (let i = 0; i < meta.n; i++) { const c = await fb.getFields(`vt-${k}-${i}`); if (!c || typeof c.json !== 'string') throw new Error('Copia incompleta en la nube'); s += c.json; }
  return { at: meta.at, data: await unpack(s) };
}
