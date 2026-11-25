import test from 'node:test';
import assert from 'node:assert/strict';
import { indexConcerts, eventsFor, mergeEvents, groupByMonth, filterCountry, artistNames } from '../js/concerts.js';
import { topArtists, buildStats } from '../js/stats.js';

// [id, nombre, fecha, hora, estado, sala, ciudad, país, url, artistas]
const DATA = { generated: '2026-11-20T05:00:00+00:00', countries: ['ES', 'PT'], events: [
  ['a', 'Coldplay Madrid', '2026-12-05', '21:00', 'ok', 'WiZink', 'Madrid', 'ES', 'https://tm/a', ['Coldplay']],
  ['b', 'Tributo a Coldplay', '2026-12-01', '20:00', 'ok', 'Sala', 'Bilbao', 'ES', 'https://tm/b', ['Coldplay Tribute Band']],
  ['d', 'Festival', '2027-02-01', '', 'postponed', 'Parque', 'Lisboa', 'PT', 'https://tm/d', ['Muse', 'COLDPLAY']],
  ['e', 'Rosalía', '2027-01-10', '22:00', 'ok', 'Palau', 'Barcelona', 'ES', 'https://tm/e', ['Rosalía']]
] };

test('eventsFor: nombre exacto (sin acentos ni mayúsculas); los tributos no cuentan', () => {
  const idx = indexConcerts(DATA);
  assert.deepEqual(eventsFor(idx, 'Coldplay').map(e => e.id).sort(), ['a', 'd']);
  assert.deepEqual(eventsFor(idx, 'rosalia').map(e => e.id), ['e']);
  assert.deepEqual(eventsFor(idx, 'Nadie'), []);
  assert.deepEqual(eventsFor(indexConcerts(null), 'X'), []);
  const d = eventsFor(idx, 'Coldplay').find(e => e.id === 'd');
  assert.deepEqual(d.others, ['Muse']); assert.equal(d.artist, 'Coldplay'); assert.equal(d.status, 'postponed');
});

test('mergeEvents: ordena por fecha y no repite el mismo evento de dos artistas', () => {
  const idx = indexConcerts(DATA);
  const all = mergeEvents([eventsFor(idx, 'Coldplay'), eventsFor(idx, 'Muse'), eventsFor(idx, 'Rosalía')]);
  assert.deepEqual(all.map(e => e.id), ['a', 'e', 'd']);
  assert.deepEqual(all[2].also, ['Muse']);
});

test('groupByMonth y filterCountry', () => {
  const idx = indexConcerts(DATA);
  const all = mergeEvents([eventsFor(idx, 'Coldplay'), eventsFor(idx, 'Rosalía')]);
  assert.deepEqual(groupByMonth(all).map(([k, l]) => [k, l.length]), [['2026-12', 1], ['2027-01', 1], ['2027-02', 1]]);
  assert.deepEqual(filterCountry(all, 'PT').map(e => e.id), ['d']);
  assert.equal(filterCountry(all, '').length, 3);
});

test('artistNames: del historial o, sin él, de los álbumes de la API', () => {
  const api = { x: { artist: 'Y', points: 5 }, z: { artist: 'W', points: 9 }, q: { artist: 'V', points: 0 } };
  assert.deepEqual(artistNames({ stats: null, apiAlbums: api, months: 12, limit: 5, topArtists }), ['W', 'Y']);
  const row = (artist, n) => Array.from({ length: n }, (_, i) => ({ ts: `2026-11-${String(1 + i).padStart(2, '0')}T12:00:00Z`, ms_played: 200000,
    master_metadata_album_artist_name: artist, master_metadata_track_name: 't', master_metadata_album_album_name: 'al', spotify_track_uri: 'u' }));
  const S = buildStats([...row('A', 3), ...row('B', 8)]);
  assert.deepEqual(artistNames({ stats: S, apiAlbums: {}, months: 0, limit: 5, topArtists }), ['B', 'A']);
});

test('Bandsintown: se convierte al formato compacto y se une sin repetidos', async () => {
  const K = await import('../js/concerts.js');
  const ev = K.fromBandsintown('Muse', [
    { id: '1', datetime: '2027-05-10T21:00:00', title: '', venue: { name: 'WiZink', city: 'Madrid', country: 'Spain' }, offers: [{ url: 'https://t/1', status: 'available' }], lineup: ['Muse', 'Otro'] },
    { id: '2', datetime: 'raro' }]);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].slice(0, 9), ['bit1', 'Muse', '2027-05-10', '21:00', 'ok', 'WiZink', 'Madrid', 'ES', 'https://t/1']);
  const d = K.bandsintownData([ev, ev]);
  assert.equal(d.events.length, 1); assert.deepEqual(d.countries, ['ES']);
  assert.equal(K.eventsFor(K.indexConcerts(d), 'Muse').length, 1);
});
