// Conciertos próximos de tus artistas más escuchados, con la API Discovery de Ticketmaster
// (gratis, con clave propia: developer.ticketmaster.com; permite llamarla desde el navegador).
// Las funciones puras (parseo, orden, filtros) se prueban con `node --test tests/`.
import { fold, tokens } from './core.js';
import * as store from './storage.js';
import { prefs } from './storage.js';

const API = 'https://app.ticketmaster.com/discovery/v2/events.json';
const TTL = 12 * 3600 * 1000;

export const hasKey = () => !!prefs.get('tm.key');
export const COUNTRIES = [['ES', 'España'], ['PT', 'Portugal'], ['FR', 'Francia'], ['DE', 'Alemania'], ['GB', 'Reino Unido'], ['IT', 'Italia'], ['NL', 'Países Bajos'], ['US', 'Estados Unidos'], ['', 'Todos los países']];

const sameArtist = (a, b) => fold(a) === fold(b) || (tokens(a).length > 0 && tokens(a).join(' ') === tokens(b).join(' '));

// Respuesta de Ticketmaster -> [{ id, artist, title, date, time, status, venue, city, country, url, image }]
// Solo eventos donde el artista figura de verdad entre los "attractions" (la búsqueda por texto trae ruido: tributos, homenajes…).
export function parseEvents(json, artist) {
  const list = (json && json._embedded && json._embedded.events) || [];
  const out = [];
  for (const e of list) {
    const start = (e.dates && e.dates.start) || {};
    const date = start.localDate;
    if (!date) continue;
    const code = ((e.dates.status || {}).code || '').toLowerCase();
    if (code === 'cancelled' || code === 'canceled') continue;
    const emb = e._embedded || {};
    const acts = (emb.attractions || []).map(a => a.name);
    if (!acts.some(n => sameArtist(n, artist))) continue;
    const v = (emb.venues || [])[0] || {};
    const img = (e.images || []).filter(i => i.url).sort((x, y) => Math.abs((x.width || 0) - 640) - Math.abs((y.width || 0) - 640))[0];
    out.push({
      id: e.id, artist, title: e.name || artist, date, time: (start.localTime || '').slice(0, 5),
      status: code === 'postponed' || code === 'rescheduled' ? 'postponed' : code === 'offsale' ? 'offsale' : 'ok',
      venue: v.name || '', city: (v.city || {}).name || '', country: (v.country || {}).countryCode || '', countryName: (v.country || {}).name || '',
      url: e.url || '', image: img ? img.url : '',
      others: acts.filter(n => !sameArtist(n, artist)).slice(0, 3)
    });
  }
  return out;
}

// Une los de varios artistas: sin repetidos (un mismo festival sale por cada artista) y por fecha
export function mergeEvents(perArtist) {
  const seen = new Map();
  for (const evs of perArtist) for (const e of evs) {
    const prev = seen.get(e.id);
    if (prev) { if (!prev.also.includes(e.artist) && prev.artist !== e.artist) prev.also.push(e.artist); continue; }
    seen.set(e.id, { ...e, also: [] });
  }
  return [...seen.values()].sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')) || a.artist.localeCompare(b.artist));
}

// [['2026-12', [eventos]], …] en orden
export function groupByMonth(events) {
  const m = new Map();
  for (const e of events) { const k = e.date.slice(0, 7); (m.get(k) || m.set(k, []).get(k)).push(e); }
  return [...m.entries()];
}

export const filterCountry = (events, cc) => (cc ? events.filter(e => e.country === cc) : events);

export const monthLabel = key => {
  const [y, m] = key.split('-').map(Number);
  const t = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Top de artistas para buscar: del historial si lo hay; si no, de los álbumes de la API de Spotify
export function artistNames({ stats, apiAlbums, months, limit, topArtists, now = new Date() }) {
  if (stats) return topArtists(stats, months, now, limit).map(a => a.name);
  const by = {};
  for (const a of Object.values(apiAlbums || {})) by[a.artist] = (by[a.artist] || 0) + (a.points || 0);
  return Object.entries(by).filter(([, p]) => p > 0).sort((x, y) => y[1] - x[1]).slice(0, limit).map(([n]) => n);
}

// ---------- red ----------
let chain = Promise.resolve();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(artist, key) {
  const q = new URLSearchParams({ apikey: key, keyword: artist, classificationName: 'music', size: '50', sort: 'date,asc', locale: '*',
    startDateTime: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
  const r = await fetch(`${API}?${q}`);
  if (r.status === 401) { const e = new Error('Ticketmaster rechazó la clave. Revísala en Ajustes.'); e.code = 'key'; throw e; }
  if (r.status === 429) { const e = new Error('Ticketmaster pide calma (demasiadas consultas). Prueba en un minuto.'); e.code = 'rate'; throw e; }
  if (!r.ok) throw new Error('Ticketmaster respondió ' + r.status);
  return r.json();
}

// -> eventos del artista (todos los países; el filtro se aplica después, así cambiar de país no vuelve a consultar). Con caché de 12 h.
export function artistEvents(artist, { force = false } = {}) {
  const ck = 'conc:' + fold(artist);
  const run = async () => {
    const c = await store.get(ck);
    if (!force && c && Date.now() - c.at < TTL) return c.events;
    const key = prefs.get('tm.key');
    if (!key) throw Object.assign(new Error('Falta la clave de Ticketmaster.'), { code: 'key' });
    await sleep(260);                                  // límite de Ticketmaster: 5 consultas por segundo
    const events = parseEvents(await request(artist, key), artist);
    await store.set(ck, { at: Date.now(), events });
    return events;
  };
  return (chain = chain.then(run, run));
}
