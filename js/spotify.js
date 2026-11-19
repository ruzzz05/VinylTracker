// Spotify: login PKCE (sin client secret) y lecturas. Todo desde el navegador.
import { config } from './config.js';
import { albumKey } from './core.js';
import { prefs } from './storage.js';

const AUTH = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

export const clientId = () => prefs.get('spotify.client', config.spotifyClientId);

export async function startLogin() {
  const verifier = rand(48), state = rand(12);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  prefs.set('spotify.pending', JSON.stringify({ verifier, state, redirect: redirectUri(), at: Date.now() }));
  const q = new URLSearchParams({
    client_id: clientId(), response_type: 'code', redirect_uri: redirectUri(), scope: config.spotifyScopes,
    state, code_challenge_method: 'S256', code_challenge: challenge
  });
  location.href = `${AUTH}/authorize?${q}`;
}

// Acepta la URL completa (o solo la parte ?code=...&state=...) y canjea el código por tokens
export async function finishLogin(urlOrQuery) {
  const raw = String(urlOrQuery || '').trim();
  const qs = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw.replace(/^#/, ''));
  if (qs.get('error')) throw new Error('Spotify rechazó el acceso: ' + qs.get('error'));
  const pend = JSON.parse(prefs.get('spotify.pending', 'null'));
  if (!pend) throw new Error('No hay un login en curso en este dispositivo. Pulsa "Conectar Spotify" otra vez.');
  if (qs.get('state') !== pend.state || !qs.get('code')) throw new Error('Respuesta de Spotify no válida o caducada.');
  const tok = await tokenRequest({
    grant_type: 'authorization_code', code: qs.get('code'), redirect_uri: pend.redirect,
    client_id: clientId(), code_verifier: pend.verifier
  });
  saveToken(tok);
  prefs.del('spotify.pending');
}

async function tokenRequest(body) {
  const r = await fetch(`${AUTH}/api/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body)
  });
  if (!r.ok) throw new Error('Spotify no dio el acceso (' + r.status + ')');
  return r.json();
}

function saveToken(t) {
  const prev = JSON.parse(prefs.get('spotify.token', '{}'));
  prefs.set('spotify.token', JSON.stringify({
    access: t.access_token, refresh: t.refresh_token || prev.refresh,
    exp: Date.now() + (t.expires_in || 3600) * 1000 - 60000
  }));
}

export const isConnected = () => !!JSON.parse(prefs.get('spotify.token', '{}')).refresh;
export const disconnect = () => { prefs.del('spotify.token'); prefs.del('spotify.pending'); };

async function token() {
  const t = JSON.parse(prefs.get('spotify.token', '{}'));
  if (!t.refresh) throw new Error('Spotify no está conectado.');
  if (Date.now() < t.exp) return t.access;
  saveToken(await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId() }));
  return JSON.parse(prefs.get('spotify.token')).access;
}

async function get(path, params) {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: 'Bearer ' + await token() } });
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
