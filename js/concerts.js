// Conciertos próximos de tus artistas más escuchados.
// Un GitHub Action descarga cada día los conciertos de música de Ticketmaster (con la clave guardada como secreto del repo)
// y los publica en data/concerts.json; aquí se cruzan en el móvil con tus artistas. Ni la clave ni tus datos de escucha salen del dispositivo.
// Las funciones puras se prueban con `node --test tests/`.
import { fold, tokens } from './core.js';

export const COUNTRY_NAMES = { ES: 'España', PT: 'Portugal', FR: 'Francia', DE: 'Alemania', GB: 'Reino Unido', IT: 'Italia', NL: 'Países Bajos', US: 'Estados Unidos' };

const keysOf = name => [fold(name), tokens(name).join(' ')].filter(Boolean);

// Fichero del servidor -> índice { nombre normalizado: [eventos] }
export function indexConcerts(data) {
  const idx = new Map();
  for (const c of (data && data.events) || []) {
    const [id, title, date, time, status, venue, city, country, url, acts] = c;
    const ev = { id, title, date, time, status, venue, city, country, url, acts };
    for (const k of new Set(acts.flatMap(keysOf))) (idx.get(k) || idx.set(k, []).get(k)).push(ev);
  }
  return idx;
}

// Eventos de un artista (por nombre exacto, sin acentos ni mayúsculas; los tributos no coinciden)
export function eventsFor(idx, artist) {
  const seen = new Set(), out = [];
  for (const k of keysOf(artist)) for (const e of idx.get(k) || []) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ ...e, artist, others: e.acts.filter(n => !keysOf(n).some(x => keysOf(artist).includes(x))).slice(0, 3) });
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

// ---------- Bandsintown (alternativa sin clave de Ticketmaster; se consulta desde el móvil, artista a artista) ----------
const CC = { spain: 'ES', españa: 'ES', portugal: 'PT', france: 'FR', francia: 'FR', germany: 'DE', alemania: 'DE', 'united kingdom': 'GB', uk: 'GB', 'reino unido': 'GB',
  italy: 'IT', italia: 'IT', netherlands: 'NL', 'the netherlands': 'NL', 'united states': 'US', usa: 'US', belgium: 'BE', ireland: 'IE', switzerland: 'CH' };

// Respuesta de Bandsintown para un artista -> eventos en el mismo formato compacto que el fichero de Ticketmaster
export function fromBandsintown(artist, list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    const dt = String((e && e.datetime) || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(dt)) continue;
    const v = e.venue || {};
    const country = String(v.country || '');
    const offer = (e.offers || []).find(o => o && o.url);
    const sold = (e.offers || []).some(o => /sold/i.test(o.status || ''));
    out.push([ 'bit' + (e.id || dt + artist), e.title || artist, dt.slice(0, 10), dt.slice(11, 16) === '00:00' ? '' : dt.slice(11, 16), sold ? 'offsale' : 'ok',
      v.name || '', v.city || '', CC[country.toLowerCase()] || (/^[A-Z]{2}$/.test(country) ? country : ''), (offer && offer.url) || e.url || '',
      [artist, ...(e.lineup || []).filter(n => n && n !== artist)].slice(0, 8) ]);
  }
  return out;
}

// Une las listas de varios artistas en el formato del fichero de Ticketmaster ({ countries, events, generated })
export function bandsintownData(perArtist, now = new Date()) {
  const seen = new Set(), events = [];
  for (const e of perArtist.flat()) if (!seen.has(e[0])) { seen.add(e[0]); events.push(e); }
  events.sort((a, b) => (a[2] + a[3]).localeCompare(b[2] + b[3]));
  return { generated: now.toISOString(), source: 'Bandsintown', countries: [...new Set(events.map(e => e[7]).filter(Boolean))].sort(), events };
}
