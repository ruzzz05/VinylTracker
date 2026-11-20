// Firebase por REST (sin SDK): login con usuario/contraseña y lectura de tu colección en Firestore.
// Misma cuenta y mismo proyecto que mi-app. Nunca se guarda la contraseña, solo el token de renovación.
import { config } from './config.js';
import { isOwner as isOwnerUid, parseExtras } from './core.js';
import * as store from './storage.js';
import { prefs } from './storage.js';

const KEY = config.firebase.apiKey;
const TTL = 24 * 3600 * 1000;   // como en mi-app: como mucho una lectura al día, salvo que se fuerce

const usernameToEmail = u => String(u).trim().toLowerCase() + config.authEmailDomain;
const MESSAGES = {
  INVALID_LOGIN_CREDENTIALS: 'Usuario o contraseña incorrectos.',
  INVALID_PASSWORD: 'Usuario o contraseña incorrectos.',
  EMAIL_NOT_FOUND: 'Usuario o contraseña incorrectos.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Demasiados intentos. Espera un momento.'
};

async function post(url, body, form) {
  const r = await fetch(url, form
    ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = (j.error && j.error.message) || '';
    if (/referer/i.test(code)) throw new Error('Firebase no permite esta dirección: añade este sitio a las restricciones de la clave de API.');
    throw new Error(MESSAGES[code.split(' ')[0]] || 'No se pudo iniciar sesión (' + (code || r.status) + ').');
  }
  return j;
}

export async function login(username, password) {
  const j = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`,
    { email: usernameToEmail(username), password, returnSecureToken: true });
  prefs.set('fb.user', String(username).trim().toLowerCase());
  prefs.set('fb.refresh', j.refreshToken);
  prefs.set('fb.uid', j.localId);
  prefs.set('fb.id', JSON.stringify({ token: j.idToken, exp: Date.now() + Number(j.expiresIn) * 1000 - 60000 }));
}

export const user = () => prefs.get('fb.user');
export const isLoggedIn = () => !!prefs.get('fb.refresh');
export function logout() { ['fb.user', 'fb.refresh', 'fb.uid', 'fb.id'].forEach(k => prefs.del(k)); }

async function idToken() {
  const cur = JSON.parse(prefs.get('fb.id', 'null'));
  if (cur && Date.now() < cur.exp) return cur.token;
  const refresh = prefs.get('fb.refresh');
  if (!refresh) throw new Error('Inicia sesión primero.');
  const j = await post(`https://securetoken.googleapis.com/v1/token?key=${KEY}`,
    { grant_type: 'refresh_token', refresh_token: refresh }, true);
  prefs.set('fb.refresh', j.refresh_token);
  prefs.set('fb.id', JSON.stringify({ token: j.id_token, exp: Date.now() + Number(j.expires_in) * 1000 - 60000 }));
  return j.id_token;
}

const DOC_URL = `https://firestore.googleapis.com/v1/projects/${config.firebase.projectId}/databases/(default)/documents/${config.firestoreDoc}`;

// Lee el documento tal cual está en la nube -> { json } | null (si todavía no existe)
async function fetchDoc() {
  const r = await fetch(DOC_URL, { headers: { Authorization: 'Bearer ' + await idToken() } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(r.status === 403 ? 'Firestore respondió 403 (¿reglas o cuenta incorrecta?)' : 'Firestore respondió ' + r.status);
  const doc = await r.json();
  const f = doc.fields || {};
  return f.json && typeof f.json.stringValue === 'string' ? { json: f.json.stringValue } : null;
}

// Discos añadidos desde mi-app (documento vinilos/coleccion). Devuelve [] si no hay ninguno.
export async function readExtras({ force = false } = {}) {
  const cached = await store.get('extras');
  if (!force && cached && Date.now() - cached.at < TTL) return { albums: cached.albums, at: cached.at, fromCache: true };
  const doc = await fetchDoc();
  const albums = doc ? parseExtras(doc.json) : [];
  const at = Date.now();
  await store.set('extras', { at, albums });
  return { albums, at, fromCache: false };
}

export const uid = () => prefs.get('fb.uid');
export const isOwner = () => isLoggedIn() && isOwnerUid(uid(), config.ownerUid);

// Solo el dueño. Lee el documento justo antes de escribir (así no se pisa lo de otro dispositivo);
// las reglas de Firestore son las que impiden de verdad que otra cuenta escriba.
export async function addAlbum(album) {
  if (!isOwner()) throw new Error('Solo el dueño puede añadir discos.');
  const doc = await fetchDoc();
  const list = doc ? parseExtras(doc.json) : [];
  const next = list.some(a => a.id === album.id) ? list : list.concat(album);
  const at = Date.now();
  const body = { fields: { updatedAt: { integerValue: String(at) }, json: { stringValue: JSON.stringify({ albums: next }) } } };
  const r = await fetch(DOC_URL + '?updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=json', {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + await idToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(r.status === 403 ? 'Firestore respondió 403 (tu cuenta no es la del dueño o faltan las reglas)' : 'Firestore respondió ' + r.status);
  await store.set('extras', { at, albums: next });
  return { albums: next, at };
}

export async function cachedExtras() {
  const c = await store.get('extras');
  return c ? { albums: c.albums, at: c.at } : null;
}

// ---------- Documentos genéricos de la copia en la nube (colección vinilos, documentos vt-…) ----------
const DOCS = `https://firestore.googleapis.com/v1/projects/${config.firebase.projectId}/databases/(default)/documents/vinilos/`;
const fail = r => new Error(r.status === 403 ? 'Firestore respondió 403: tus reglas no dejan escribir ahí (ver Ajustes → Copia en la nube)' : 'Firestore respondió ' + r.status);

// -> { at, n, json } | null. `fields` es un objeto plano { campo: número | texto }
export async function getFields(name) {
  const r = await fetch(DOCS + name, { headers: { Authorization: 'Bearer ' + await idToken() } });
  if (r.status === 404) return null;
  if (!r.ok) throw fail(r);
  const f = (await r.json()).fields || {};
  const out = {};
  for (const [k, v] of Object.entries(f)) out[k] = v.integerValue !== undefined ? Number(v.integerValue) : v.stringValue;
  return out;
}

export async function putFields(name, obj) {
  if (!isOwner()) throw new Error('Solo el dueño puede guardar la copia en la nube.');
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
  const mask = Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fetch(`${DOCS}${name}?${mask}`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + await idToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  if (!r.ok) throw fail(r);
}
