import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvents, mergeEvents, groupByMonth, filterCountry, artistNames } from '../js/concerts.js';
import { topArtists, buildStats } from '../js/stats.js';

const ev = (id, name, date, acts, { cc = 'ES', city = 'Madrid', status = 'onsale', time = '21:00:00' } = {}) => ({
  id, name, url: 'https://tm/' + id, images: [{ url: 'https://i/s.jpg', width: 100 }, { url: 'https://i/m.jpg', width: 640 }],
  dates: { start: { localDate: date, localTime: time }, status: { code: status } },
  _embedded: { attractions: acts.map(name => ({ name })), venues: [{ name: 'WiZink', city: { name: city }, country: { countryCode: cc, name: 'País' } }] }
});
const json = { _embedded: { events: [
  ev('a', 'Coldplay Madrid', '2026-12-05', ['Coldplay']),
  ev('b', 'Tributo a Coldplay', '2026-12-01', ['Coldplay Tribute Band']),
  ev('c', 'Cancelado', '2026-12-02', ['Coldplay'], { status: 'cancelled' }),
  ev('d', 'Festival', '2027-02-01', ['Muse', 'COLDPLAY'], { cc: 'PT', city: 'Lisboa', status: 'rescheduled' }),
  { id: 'e', name: 'Sin fecha', dates: {}, _embedded: { attractions: [{ name: 'Coldplay' }] } }
] } };

test('parseEvents: solo el artista, sin cancelados ni sin fecha', () => {
  const r = parseEvents(json, 'Coldplay');
  assert.deepEqual(r.map(e => e.id), ['a', 'd']);
  assert.equal(r[0].time, '21:00'); assert.equal(r[0].venue, 'WiZink'); assert.equal(r[0].image, 'https://i/m.jpg');
  assert.equal(r[1].status, 'postponed'); assert.deepEqual(r[1].others, ['Muse']);
  assert.deepEqual(parseEvents({}, 'X'), []); assert.deepEqual(parseEvents(null, 'X'), []);
});

test('mergeEvents: ordena por fecha y no repite el mismo evento de dos artistas', () => {
  const a = parseEvents(json, 'Coldplay');
  const m = parseEvents({ _embedded: { events: [json._embedded.events[3], ev('z', 'Muse solo', '2026-11-30', ['Muse'])] } }, 'Muse');
  const all = mergeEvents([a, m]);
  assert.deepEqual(all.map(e => e.id), ['z', 'a', 'd']);
  assert.deepEqual(all[2].also, ['Muse']);
});

test('groupByMonth y filterCountry', () => {
  const all = mergeEvents([parseEvents(json, 'Coldplay')]);
  assert.deepEqual(groupByMonth(all).map(([k, l]) => [k, l.length]), [['2026-12', 1], ['2027-02', 1]]);
  assert.deepEqual(filterCountry(all, 'PT').map(e => e.id), ['d']);
  assert.equal(filterCountry(all, '').length, 2);
});

test('artistNames: del historial o, sin él, de los álbumes de la API', () => {
  const row = (artist, n) => Array.from({ length: n }, (_, i) => ({ ts: `2026-11-${String(1 + i).padStart(2, '0')}T12:00:00Z`, ms_played: 200000,
    master_metadata_album_artist_name: artist, master_metadata_track_name: 't', master_metadata_album_album_name: 'al', spotify_track_uri: 'u' }));
  const S = buildStats([...row('A', 3), ...row('B', 8)]);
  const api = { x: { artist: 'Y', points: 5 }, z: { artist: 'W', points: 9 }, q: { artist: 'V', points: 0 } };
  assert.deepEqual(artistNames({ stats: null, apiAlbums: api, months: 12, limit: 5, topArtists }), ['W', 'Y']);
  assert.deepEqual(artistNames({ stats: null, apiAlbums: api, months: 12, limit: 1, topArtists }), ['W']);
  assert.deepEqual(artistNames({ stats: S, apiAlbums: {}, months: 0, limit: 5, topArtists }), ['B', 'A']);
  assert.deepEqual(artistNames({ stats: S, apiAlbums: {}, months: 0, limit: 1, topArtists }), ['B']);
});
