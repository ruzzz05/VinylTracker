// Datos de un álbum a partir de Spotify (API) o Discogs, para rellenar el formulario de «Añadir disco» (lógica pura).
import { parseSpotifyAlbum } from './core.js';

const MAX_TAGS = 8, MAX_TAG = 24;

// Géneros/estilos -> etiquetas en minúsculas, sin repetidos, máximo 8 (como las de la colección)
export function genreTags(...lists) {
  const out = [];
  for (const g of lists.flat()) {
    const t = String(g || '').trim().toLowerCase().slice(0, MAX_TAG);
    if (t && !out.includes(t)) out.push(t);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

const biggest = images => [...(images || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
const yearOf = d => { const y = String(d || '').slice(0, 4); return /^\d{4}$/.test(y) ? Number(y) : null; };

// /albums/{id} y /artists/{id} de la API de Spotify -> todo lo que sirve para la colección
export function spotifyInfo(album, artist) {
  if (!album || !album.id) return null;
  const main = (album.artists || [])[0] || {};
  const img = biggest(album.images);
  const sp = parseSpotifyAlbum('https://open.spotify.com/album/' + album.id);
  return {
    source: 'spotify', id: album.id, spotifyUrl: sp ? sp.url : '', name: album.name || '', artist: main.name || '', artistId: main.id || '',
    year: yearOf(album.release_date), image: img ? img.url : '', label: album.label || '', tracks: album.total_tracks || 0,
    type: album.album_type || '', tags: genreTags(album.genres || [], (artist && artist.genres) || [])
  };
}

// Resultado de Discogs (ya pasado por parseDiscogsResult) -> info
export const discogsInfo = r => ({
  source: 'discogs', name: r.name, artist: r.artist, year: /^\d{4}$/.test(String(r.year)) ? Number(r.year) : null,
  image: r.image || '', label: r.label || '', tags: r.tags || [], barcode: r.barcode || '', spotifyUrl: ''
});
