// Firebase por REST (sin SDK): login con usuario/contraseña y lectura de tu colección en Firestore.
// Misma cuenta y mismo proyecto que mi-app. Nunca se guarda la contraseña, solo el token de renovación.
import { config } from './config.js';
import { isOwner as isOwnerUid, splitExtras, whyInvalid, lostAlbums, nextBackup } from './core.js';
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
  return { json: f.json && typeof f.json.stringValue === 'string' ? f.json.stringValue : '', updateTime: doc.updateTime || '' };
}

// Resumen de un disco no válido (para enseñarlo y guardarlo en la caché)
const badInfo = list => list.map(b => ({ artist: String((b.album && b.album.artist) || ''), name: String((b.album && b.album.name) || ''), why: b.why }));

// Copia de seguridad de la última lista buena: si un disco desaparece de la nube (otra app o dispositivo pisó el documento), se avisa y se puede restaurar
const lite = a => ({ id: a.id, artist: String(a.artist || ''), name: String(a.name || '') });
async function track(rawNow) {
  const prev = ((await store.get('extrasBackup')) || {}).albums || [];
  const { backup, lost } = nextBackup(prev, rawNow);
  await store.set('extrasBackup', { at: Date.now(), albums: backup });
  return lost.map(lite);
}

// Discos añadidos desde mi-app (documento vinilos/coleccion). Devuelve { albums, bad, lost, at, fromCache }.
// `bad` = los que hay en la nube pero no se pueden mostrar (con el motivo); nunca se borran.
// `lost` = los que estaban antes y ya no están.
export async function readExtras({ force = false } = {}) {
  const cached = await store.get('extras');
  if (!force && cached && Date.now() - cached.at < TTL) return { albums: cached.albums, bad: cached.bad || [], lost: cached.lost || [], at: cached.at, fromCache: true };
  const doc = await fetchDoc();
  const sp = doc ? splitExtras(doc.json) : { ok: [], bad: [], raw: [], corrupt: false };
  const bad = badInfo(sp.bad);
  if (sp.corrupt) bad.push({ artist: '', name: '(todo el documento)', why: 'no se puede leer: está dañado' });
  const lost = sp.corrupt ? ((await store.get('extras')) || {}).lost || [] : await track(sp.raw);
  const at = Date.now();
  await store.set('extras', { at, albums: sp.ok, bad, lost });
  return { albums: sp.ok, bad, lost, at, fromCache: false };
}

export const uid = () => prefs.get('fb.uid');
export const isOwner = () => isLoggedIn() && isOwnerUid(uid(), config.ownerUid);

// Escribe la lista SOLO si nadie ha cambiado el documento desde que se leyó (precondición de Firestore). -> hora | null (alguien lo cambió)
async function putList(nextRaw, doc) {
  const at = Date.now();
  const body = { fields: { updatedAt: { integerValue: String(at) }, json: { stringValue: JSON.stringify({ albums: nextRaw }) } } };
  const cond = doc ? (doc.updateTime ? '&currentDocument.updateTime=' + encodeURIComponent(doc.updateTime) : '') : '&currentDocument.exists=false';
  const r = await fetch(DOC_URL + '?updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=json' + cond, {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + await idToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (r.ok) return at;
  const txt = await r.text().catch(() => '');
  if ([400, 409, 412].includes(r.status) && /FAILED_PRECONDITION|ABORTED|already exists/i.test(txt)) return null;
  throw new Error(r.status === 403 ? 'Firestore respondió 403 (tu cuenta no es la del dueño o faltan las reglas)' : 'Firestore respondió ' + r.status);
}

// Lee, cambia y escribe. Si mientras tanto otra app o dispositivo cambió el documento, vuelve a leer y a aplicar el cambio (hasta 5 veces), en vez de pisar lo suyo.
// `change(raw)` -> nueva lista | null (si no hay nada que escribir)
async function updateList(change) {
  for (let i = 0; i < 5; i++) {
    const doc = await fetchDoc();
    const sp = doc ? splitExtras(doc.json) : { ok: [], bad: [], raw: [], corrupt: false };
    if (sp.corrupt) throw new Error('El documento de discos en la nube está dañado; no lo sobrescribo para no perder nada.');
    const nextRaw = change(sp.raw);
    if (!nextRaw) return { sp, raw: sp.raw, at: Date.now() };
    const at = await putList(nextRaw, doc);
    if (at !== null) return { sp, raw: nextRaw, at };
    await new Promise(r => setTimeout(r, 150 * (i + 1)));
  }
  throw new Error('Alguien ha cambiado la lista a la vez. Vuelve a intentarlo.');
}

// Resultado común de una escritura: lo que se ve, lo que no se puede mostrar y lo desaparecido
async function finish({ sp, raw, at }) {
  const ids = new Set(raw.map(a => a && a.id));
  const albums = raw.filter(a => !whyInvalid(a) && ids.has(a.id));
  const bad = badInfo(splitExtras(JSON.stringify({ albums: raw })).bad);
  const lost = await track(raw);
  await store.set('extras', { at, albums, bad, lost });
  return { albums, bad, lost, at };
}

// Solo el dueño. Conserva TODO lo que hubiera, también lo que esta app no sabe mostrar.
export async function addAlbum(album) {
  if (!isOwner()) throw new Error('Solo el dueño puede añadir discos.');
  return finish(await updateList(raw => (raw.some(a => a && a.id === album.id) ? null : raw.concat(album))));
}

// Vuelve a poner en la nube los discos que desaparecieron (los de la copia de seguridad que ya no están)
export async function restoreLost() {
  if (!isOwner()) throw new Error('Solo el dueño puede restaurar discos.');
  const backup = ((await store.get('extrasBackup')) || {}).albums || [];
  return finish(await updateList(raw => { const lost = lostAlbums(backup, raw); return lost.length ? raw.concat(lost) : null; }));
}

// «Ignorar»: lo que hay ahora en la nube pasa a ser la lista buena (porque lo quitaste a propósito)
export async function acceptCurrent() {
  const doc = await fetchDoc();
  const sp = doc ? splitExtras(doc.json) : { ok: [], bad: [], raw: [], corrupt: false };
  if (sp.corrupt) throw new Error('El documento está dañado; no lo doy por bueno.');
  await store.set('extrasBackup', { at: Date.now(), albums: sp.raw.filter(a => a && a.id) });
  return finish({ sp, raw: sp.raw, at: Date.now() });
}

export async function cachedExtras() {
  const c = await store.get('extras');
  return c ? { albums: c.albums, bad: c.bad || [], lost: c.lost || [], at: c.at } : null;
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
