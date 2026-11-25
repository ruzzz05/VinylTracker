// «Olvidados»: artistas y canciones que escuchaste mucho y hace tiempo que no suenan (lógica pura, sin red ni DOM).
// Las playlists importadas de Spotify también cuentan: su fecha de «añadida» sirve de última vez que lo escuchaste
// (útil si una playlist tuya es, más o menos, todo lo que escuchas en orden). Se prueba con `node --test tests/`.
import { fold } from './core.js';

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

// Meses enteros desde 'YYYY-MM' hasta hoy (0 = este mes)
export function monthsAgo(key, now = new Date()) {
  const [y, m] = String(key).split('-').map(Number);
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
}

// De un elemento de /playlists/{id}/tracks -> { a, n, al, u, t } | null (descarta episodios, archivos locales y huecos)
export function parsePlaylistItems(items) {
  const out = [];
  for (const it of items || []) {
    const t = it && (it.track || it.item);
    if (!t || t.is_local || t.type === 'episode' || !t.name) continue;
    const artist = (t.artists || [])[0];
    if (!artist || !artist.name) continue;
    out.push({ a: artist.name, n: t.name, al: (t.album || {}).name || '', u: t.uri || '', t: String(it.added_at || '').slice(0, 7) });
  }
  return out;
}

// Mejor mes (el de más minutos) y último mes con escucha, a partir de months { 'YYYY-MM': [ms, plays] }
function span(months) {
  let last = '', peak = '', best = -1;
  for (const [k, c] of Object.entries(months || {})) {
    if (!(c[0] > 0 || c[1] > 0)) continue;
    if (k > last) last = k;
    if (c[0] > best) { best = c[0]; peak = k; }
  }
  return { last, peak };
}

const PL_WEIGHT = 5;      // cada canción en una playlist cuenta como 5 reproducciones

// kind 'artists' | 'tracks'. plist: canciones de las playlists elegidas (parsePlaylistItems). excluded: nombres de artista a ocultar.
export function forgotten(S, { kind = 'artists', silent = 6, minWeight = 12, excluded = [], plist = [], now = new Date(), limit = 60 } = {}) {
  const ex = new Set(excluded.map(fold));
  const rows = new Map();
  const add = (id, base) => { const r = rows.get(id); if (r) return r; rows.set(id, base); return base; };

  if (kind === 'artists') {
    for (const [name, a] of Object.entries((S && S.artists) || {})) {
      const sp = span(a.months);
      add(fold(name), { name, artist: name, plays: a.plays || 0, last: sp.last, peak: sp.peak, pl: 0, plLast: '' });
    }
    for (const p of plist) {
      const r = add(fold(p.a), { name: p.a, artist: p.a, plays: 0, last: '', peak: '', pl: 0, plLast: '' });
      r.pl++; if (p.t > r.plLast) r.plLast = p.t;
    }
  } else {
    for (const t of Object.values((S && S.tracks) || {})) {
      const sp = span(t.months);
      add(fold(t.a) + '|' + fold(t.n), { name: t.n, artist: t.a, album: t.al || '', plays: t.plays || 0, last: sp.last, peak: sp.peak, pl: 0, plLast: '', uri: '' });
    }
    for (const p of plist) {
      const r = add(fold(p.a) + '|' + fold(p.n), { name: p.n, artist: p.a, album: p.al, plays: 0, last: '', peak: '', pl: 0, plLast: '', uri: '' });
      r.pl++; if (p.t > r.plLast) r.plLast = p.t; if (p.u) r.uri = p.u;
    }
  }

  const out = [];
  for (const r of rows.values()) {
    if (ex.has(fold(r.artist))) continue;
    const last = [r.last, r.plLast].filter(Boolean).sort().pop();
    if (!last) continue;
    const ago = monthsAgo(last, now);
    const weight = r.plays + PL_WEIGHT * r.pl;
    if (ago < silent || weight < minWeight) continue;
    out.push({ ...r, last, ago, weight, inPlaylist: r.pl > 0 });
  }
  // lo que más escuchaste primero; a igualdad, lo que lleva más tiempo sin sonar
  return out.sort((x, y) => (y.weight - x.weight) || (y.ago - x.ago)).slice(0, limit);
}

// Canciones para una playlist a partir de la lista de olvidados.
// kind 'tracks': las propias canciones; 'artists': las 3 más escuchadas de cada uno de los primeros artistas.
export function playlistTracks(S, list, { kind = 'artists', plist = [], maxTracks = 45 } = {}) {
  if (kind === 'tracks') return list.slice(0, maxTracks).map(r => ({ artist: r.artist, name: r.name, uri: r.uri || '' }));
  const out = [];
  const byArtist = new Map();
  for (const t of Object.values((S && S.tracks) || {})) (byArtist.get(fold(t.a)) || byArtist.set(fold(t.a), []).get(fold(t.a))).push({ artist: t.a, name: t.n, plays: t.plays || 0, uri: '' });
  for (const p of plist) (byArtist.get(fold(p.a)) || byArtist.set(fold(p.a), []).get(fold(p.a))).push({ artist: p.a, name: p.n, plays: 1, uri: p.u });
  for (const r of list) {
    const seen = new Set();
    const tracks = (byArtist.get(fold(r.artist)) || []).sort((x, y) => y.plays - x.plays).filter(t => !seen.has(fold(t.name)) && seen.add(fold(t.name))).slice(0, 3);
    out.push(...tracks);
    if (out.length >= maxTracks) break;
  }
  return out.slice(0, maxTracks);
}
