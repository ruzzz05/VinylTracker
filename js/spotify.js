// Spotify: login PKCE (sin client secret) y lecturas. Todo desde el navegador.
import { config } from './config.js';
import { albumKey } from './core.js';
import { prefs } from './storage.js';
import { parseNowPlaying, parseRecent } from './live.js';

const AUTH = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

export const clientId = () => prefs.get('spotify.client', config.spotifyClientId);

const PENDING_KEY = 'spotify.pending';
const PENDING_TTL = 30 * 60 * 1000;

// Intentos de conexión recientes (varios a la vez: pulsar "Conectar" otra vez NO invalida el anterior)
function pendings() {
  let list;
  try { list = JSON.parse(prefs.get(PENDING_KEY, '[]')); } catch (e) { list = []; }
  return (Array.isArray(list) ? list : []).filter(p => p && p.state && Date.now() - p.at < PENDING_TTL);
}

// Crea el intento de conexión (se guarda aquí) y devuelve la dirección de autorización de Spotify
export async function buildLoginUrl() {
  const verifier = rand(48), state = rand(12);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  prefs.set(PENDING_KEY, JSON.stringify(pendings().slice(-4).concat({ verifier, state, redirect: redirectUri(), at: Date.now() })));
  const q = new URLSearchParams({
    client_id: clientId(), response_type: 'code', redirect_uri: redirectUri(), scope: config.spotifyScopes,
    state, code_challenge_method: 'S256', code_challenge: challenge
  });
  return `${AUTH}/authorize?${q}`;
}

export async function startLogin() {
  location.href = await buildLoginUrl();
}

// ¿Esta dirección trae el código de vuelta de Spotify?
export const hasCode = urlOrQuery => /[?&#]code=/.test(String(urlOrQuery || '')) || /^code=/.test(String(urlOrQuery || '').trim());

// Acepta la URL completa (o solo la parte ?code=...&state=...) y canjea el código por tokens
export async function finishLogin(urlOrQuery) {
  const raw = String(urlOrQuery || '').trim();
  const qs = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw.replace(/^#/, ''));
  if (qs.get('error')) throw new Error('Spotify rechazó el acceso: ' + qs.get('error'));
  if (!qs.get('code')) throw new Error('Esa dirección no contiene el código de Spotify (?code=…). Copia la que aparece justo después de aceptar, sin recortarla.');
  const pend = pendings().find(p => p.state === qs.get('state'));
  if (!pend) throw new Error('No encuentro ese intento de conexión en este dispositivo (o pasaron más de 30 minutos). Pulsa "Conectar Spotify" y pega la dirección nueva.');
  const tok = await tokenRequest({
    grant_type: 'authorization_code', code: qs.get('code'), redirect_uri: pend.redirect,
    client_id: clientId(), code_verifier: pend.verifier
  });
  saveToken(tok);
  prefs.del(PENDING_KEY);
}

async function tokenRequest(body) {
  const r = await fetch(`${AUTH}/api/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body)
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    if (j.error === 'invalid_grant') {
      throw new Error('El código de Spotify ya se usó o caducó (dura pocos minutos y sirve una sola vez). Pulsa "Conectar Spotify" y pega la dirección nueva enseguida.');
    }
    if (j.error === 'invalid_client') throw new Error('Spotify no reconoce el Client ID. Revisa que sea el de tu app.');
    throw new Error('Spotify no dio el acceso (' + r.status + (j.error_description ? ': ' + j.error_description : '') + ')');
  }
  return r.json();
}

function saveToken(t) {
  const prev = JSON.parse(prefs.get('spotify.token', '{}'));
  prefs.set('spotify.token', JSON.stringify({
    access: t.access_token, refresh: t.refresh_token || prev.refresh, scope: t.scope || prev.scope || '',
    exp: Date.now() + (t.expires_in || 3600) * 1000 - 60000
  }));
}

export const isConnected = () => !!JSON.parse(prefs.get('spotify.token', '{}')).refresh;
export const disconnect = () => { prefs.del('spotify.token'); prefs.del(PENDING_KEY); };

async function token() {
  const t = JSON.parse(prefs.get('spotify.token', '{}'));
  if (!t.refresh) throw new Error('Spotify no está conectado.');
  if (Date.now() < t.exp) return t.access;
  saveToken(await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId() }));
  return JSON.parse(prefs.get('spotify.token')).access;
}

async function get(path, params) {
  let r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: 'Bearer ' + await token() } });
  if (r.status === 429) {          // demasiadas peticiones seguidas: se espera lo que pide Spotify (máx. 8 s) y se reintenta una vez
    const wait = Math.min(8, Number(r.headers.get('Retry-After')) || 2);
    await new Promise(res => setTimeout(res, wait * 1000));
    r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: 'Bearer ' + await token() } });
  }
  if (r.status === 401 || r.status === 403) throw new Error('Spotify rechazó la petición (' + r.status + '). Vuelve a conectar la cuenta.');
  if (!r.ok) throw new Error('Spotify respondió ' + r.status);
  return r.json();
}

const cover = a => ((a.images || [])[1] || (a.images || [])[0] || {}).url || '';

// Álbumes desde la API: tops (corto/medio/largo plazo), recientes y guardados. Devuelve {key: {...}}
export async function loadApiAlbums(progress = () => {}) {
  const out = {};
  const add = (alb, points = 0, saved = false) => {
    if (!alb || (alb.album_type === 'single' && (alb.total_tracks || 0) < 3)) return;
    const artist = alb.artists && alb.artists[0] ? alb.artists[0].name : '';
    if (!artist) return;
    const k = albumKey(artist, alb.name);
    const a = out[k] || (out[k] = { artist, name: alb.name, id: alb.id, image: cover(alb), points: 0, saved: false });
    a.points += points;
    a.saved = a.saved || saved;
    a.image = a.image || cover(alb);
  };
  const ranges = [['short_term', 3], ['medium_term', 2], ['long_term', 1]];
  for (const [range, w] of ranges) {
    progress(`Tus tops (${range.replace('_term', '')})…`);
    for (const offset of [0, 49]) {
      const d = await get('/me/top/tracks', { time_range: range, limit: 50, offset });
      d.items.forEach((t, i) => add(t.album, Math.round(w * (100 - offset - i) / 10)));
    }
  }
  progress('Reproducciones recientes…');
  const rec = await get('/me/player/recently-played', { limit: 50 });
  rec.items.forEach(it => add(it.track.album, 1));
  progress('Álbumes guardados…');
  for (let offset = 0; offset < 500; offset += 50) {
    const d = await get('/me/albums', { limit: 50, offset });
    d.items.forEach(it => add(it.album, 0, true));
    if (!d.next) break;
  }
  return out;
}

// ---------- En vivo ----------
// Últimas canciones escuchadas (Spotify guarda como mucho 50). `afterMs`: solo las posteriores a esa marca.
export async function fetchRecent(afterMs = 0) {
  const params = { limit: 50 };
  if (afterMs) params.after = String(afterMs);
  return parseRecent((await get('/me/player/recently-played', params)).items);
}

// Lo que suena ahora mismo. null si no suena nada; lanza { code: 'scope' } si falta el permiso (hay que reconectar)
export async function fetchNowPlaying() {
  const r = await fetch(`${API}/me/player/currently-playing`, { headers: { Authorization: 'Bearer ' + await token() } });
  if (r.status === 204) return null;
  if (r.status === 401 || r.status === 403) { const e = new Error('Falta el permiso de "lo que suena ahora": vuelve a conectar Spotify.'); e.code = 'scope'; throw e; }
  if (!r.ok) throw new Error('Spotify respondió ' + r.status);
  return parseNowPlaying(await r.json());
}

// Búsqueda de artistas por nombre (para su foto)
export async function searchArtist(name) {
  const d = await get('/search', { q: `artist:"${String(name).replace(/"/g, '')}"`, type: 'artist', limit: 5 });
  return (d.artists && d.artists.items) || [];
}

// Búsqueda de canciones y álbumes (también singles) para sus portadas
const q = x => String(x).replace(/"/g, '');
export async function searchTrack(artist, track) {
  return ((await get('/search', { q: `track:"${q(track)}" artist:"${q(artist)}"`, type: 'track', limit: 5 })).tracks || {}).items || [];
}
// Búsqueda libre (sin filtros de campo), para los singles y títulos raros que la búsqueda estricta no encuentra
export async function searchLoose(artist, name, type) {
  const r = await get('/search', { q: `${q(artist)} ${q(name)}`, type, limit: 10 });
  return ((type === 'album' ? r.albums : r.tracks) || {}).items || [];
}
export async function searchAlbum(artist, name) {
  return ((await get('/search', { q: `album:"${q(name)}" artist:"${q(artist)}"`, type: 'album', limit: 5 })).albums || {}).items || [];
}

// Datos completos de un álbum y de su artista (año, sello, estilos…) para «Añadir disco»
export const fetchAlbum = id => get('/albums/' + encodeURIComponent(id), {});
export const fetchArtist = id => get('/artists/' + encodeURIComponent(id), {});

// ---------- Playlists (hace falta reconectar Spotify una vez para dar el permiso) ----------
const scopeErr = () => Object.assign(new Error('Falta el permiso de playlists: ve a Ajustes → Spotify y pulsa «Reconectar».'), { code: 'scope' });

async function call(method, path, { params, body } = {}) {
  const q = params ? '?' + new URLSearchParams(params) : '';
  const r = await fetch(API + path + q, { method, headers: { Authorization: 'Bearer ' + await token(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 || r.status === 403) {
    const msg = ((await r.json().catch(() => ({}))).error || {}).message || '';
    const granted = JSON.parse(prefs.get('spotify.token', '{}')).scope;
    if (r.status === 401 || (granted && !/playlist-modify/.test(granted))) throw scopeErr();            // de verdad falta el permiso: reconectar lo arregla
    throw Object.assign(new Error(`Spotify rechazó la petición (403${msg ? ': ' + msg : ''}). Con el permiso ya concedido, suele ser porque la app de Spotify está en modo desarrollo y tu cuenta no está añadida como usuario, o la cuenta dueña de la app no es Premium.`), { status: 403 });
  }
  if (r.status === 404) throw Object.assign(new Error('Spotify no encontró eso (404).'), { status: 404 });
  if (!r.ok) throw new Error('Spotify respondió ' + r.status);
  return r.status === 204 ? {} : r.json();
}

// Tus playlists -> [{ id, name, total, owner }]
export async function myPlaylists() {
  const out = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const d = await call('GET', '/me/playlists', { params: { limit: 50, offset } });
    for (const p of d.items || []) if (p) out.push({ id: p.id, name: p.name || '(sin nombre)', total: ((p.tracks || p.items || {}).total) || 0, owner: (p.owner || {}).display_name || '' });
    if (!d.next) break;
  }
  return out;
}

// Canciones de una playlist (en bruto, de 100 en 100; hasta 5000). Si /tracks no responde, prueba /items.
export async function playlistItems(id, progress = () => {}) {
  const out = [];
  let base = `/playlists/${encodeURIComponent(id)}/tracks`;
  for (let offset = 0; offset < 5000; offset += 100) {
    let d;
    try { d = await call('GET', base, { params: { limit: 100, offset, fields: 'items(added_at,track(name,uri,type,is_local,artists(name),album(name))),next,total' } }); }
    catch (e) { if (e.status === 404 && offset === 0 && base.endsWith('/tracks')) { base = `/playlists/${encodeURIComponent(id)}/items`; offset -= 100; continue; } throw e; }
    out.push(...(d.items || []));
    progress(out.length, d.total || out.length);
    if (!d.next) break;
  }
  return out;
}

export async function createPlaylist(name, description) {
  try { return await call('POST', '/me/playlists', { body: { name, description, public: false } }); }
  catch (e) {
    if (e.status !== 403 && e.status !== 404) throw e;
    const me = await call('GET', '/me');           // ruta antigua: POST /users/{id}/playlists
    return call('POST', `/users/${encodeURIComponent(me.id)}/playlists`, { body: { name, description, public: false } });
  }
}

// Quita (deja de seguir) una playlist; sirve para borrar la que se acaba de crear si al final no hay canciones
export async function dropPlaylist(id) { try { await call('DELETE', `/playlists/${encodeURIComponent(id)}/followers`); } catch (e) { /* si no se puede, queda vacía */ } }

export async function addToPlaylist(id, uris) {
  for (let i = 0; i < uris.length; i += 100) await call('POST', `/playlists/${encodeURIComponent(id)}/tracks`, { body: { uris: uris.slice(i, i + 100) } });
}

// URI de una canción buscándola por nombre y artista (null si no aparece)
// Primero la búsqueda estricta y, si no da nada, una libre (títulos con símbolos o comillas). Solo se acepta una canción del mismo artista.
export async function findTrackUri(artist, name) {
  const n = String(name).toLowerCase(), a = String(artist).toLowerCase();
  const byArtist = t => (t.artists || []).some(x => String(x.name).toLowerCase() === a);
  const pick = items => items.find(t => String(t.name).toLowerCase() === n && byArtist(t)) || items.find(byArtist) || null;
  let hit = pick(await searchTrack(artist, name).catch(e => { if (/rechaz|429/.test(e.message)) throw e; return []; }));
  if (!hit) hit = pick(await searchLoose(artist, name, 'track'));
  return hit ? hit.uri : null;
}
