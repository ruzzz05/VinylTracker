// Registro en vivo (lógica pura): lo que Spotify da como "escuchado recientemente" (las últimas 50 canciones)
// se va guardando y se suma a las estadísticas. Sin red ni DOM; se prueba con `node --test tests/`.

const pickImage = images => ((images || [])[1] || (images || [])[0] || {}).url || '';
export const liveKey = e => e.ts + '|' + e.uri;
const ms = ts => Date.parse(ts);

// Respuesta de /me/player/recently-played -> entradas compactas
export function parseRecent(items) {
  return (items || []).map(it => {
    const t = it.track || {}, al = t.album || {};
    const artist = t.artists && t.artists[0] && t.artists[0].name;
    if (!artist || !t.name || !it.played_at) return null;
    return { ts: it.played_at, ms: t.duration_ms || 0, artist, track: t.name, album: al.name || '', albumId: al.id || '', image: pickImage(al.images), uri: t.uri || '' };
  }).filter(Boolean);
}

export const emptyLive = () => ({ entries: [], cursor: 0, at: 0, gap: false });

// Suma entradas nuevas: sin repetidas y sin las que ya trae el historial importado (importedLastTs).
// Devuelve { live, fresh }. `gap` avisa de un posible hueco: llegaron las 50 canciones enteras, nuevas.
export function mergeLive(live, incoming, importedLastTs = 0) {
  const keys = new Set(live.entries.map(liveKey));
  const fresh = [];
  for (const e of incoming) {
    const k = liveKey(e);
    if (keys.has(k) || (importedLastTs && ms(e.ts) <= importedLastTs)) continue;
    keys.add(k); fresh.push(e);
  }
  const entries = live.entries.concat(fresh).sort((a, b) => ms(a.ts) - ms(b.ts)).slice(-20000);
  const newest = incoming.reduce((m, e) => Math.max(m, ms(e.ts)), live.cursor || 0);
  return { live: { ...live, entries, cursor: newest, gap: incoming.length >= 50 && !!live.cursor && fresh.length >= 50 }, fresh };
}

// Al importar un historial, lo que ya cubre deja de hacer falta en el registro en vivo (así no se cuenta dos veces)
export const pruneLive = (live, lastTs) => ({ ...live, entries: live.entries.filter(e => ms(e.ts) > lastTs) });

// Formato del historial ampliado, para reutilizar buildStats / aggregateHistory
export const toEntries = live => live.entries.map(e => ({
  ts: e.ts, ms_played: e.ms, master_metadata_album_artist_name: e.artist, master_metadata_track_name: e.track,
  master_metadata_album_album_name: e.album, spotify_track_uri: e.uri
}));

// Respuesta de /me/player/currently-playing -> lo que suena ahora (null si nada o si no es música)
export function parseNowPlaying(j) {
  if (!j || !j.item || (j.currently_playing_type && j.currently_playing_type !== 'track')) return null;
  const t = j.item, al = t.album || {};
  const artist = t.artists && t.artists[0] && t.artists[0].name;
  if (!artist || !t.name) return null;
  return { playing: !!j.is_playing, title: t.name, artist, album: al.name || '', albumId: al.id || '', image: pickImage(al.images),
    progress: j.progress_ms || 0, duration: t.duration_ms || 0, uri: t.uri || '' };
}
