import test from 'node:test';
import assert from 'node:assert/strict';
import { forgotten, monthsAgo, parsePlaylistItems, playlistTracks } from '../js/rediscover.js';

const NOW = new Date(2026, 10, 25);       // 25 nov 2026
const S = {
  artists: {
    Viejo: { plays: 100, months: { '2024-01': [600000, 60], '2024-02': [300000, 40] } },
    Reciente: { plays: 200, months: { '2026-11': [900000, 200] } },
    Poco: { plays: 3, months: { '2023-01': [10000, 3] } },
    'Medio Año': { plays: 50, months: { '2026-05': [100000, 50] } }
  },
  tracks: {
    a: { a: 'Viejo', n: 'Tema 1', al: 'Al', plays: 40, months: { '2024-01': [100, 40] } },
    b: { a: 'Viejo', n: 'Tema 2', al: 'Al', plays: 30, months: { '2024-02': [100, 30] } },
    c: { a: 'Viejo', n: 'Tema 3', al: 'Al', plays: 20, months: { '2024-02': [100, 20] } },
    d: { a: 'Viejo', n: 'Tema 4', al: 'Al', plays: 10, months: { '2024-02': [100, 10] } },
    e: { a: 'Reciente', n: 'Hoy', al: '', plays: 200, months: { '2026-11': [100, 200] } }
  }
};

test('monthsAgo', () => {
  assert.equal(monthsAgo('2026-11', NOW), 0); assert.equal(monthsAgo('2026-05', NOW), 6); assert.equal(monthsAgo('2024-01', NOW), 34);
});

test('forgotten (artistas): mucho escuchado hace tiempo, sin lo reciente ni lo poco escuchado', () => {
  const l = forgotten(S, { kind: 'artists', now: NOW });
  assert.deepEqual(l.map(r => r.name), ['Viejo', 'Medio Año']);
  assert.equal(l[0].last, '2024-02'); assert.equal(l[0].peak, '2024-01'); assert.equal(l[0].ago, 33);
  assert.deepEqual(forgotten(S, { kind: 'artists', now: NOW, silent: 12 }).map(r => r.name), ['Viejo']);
});

test('forgotten: artistas excluidos (sin acentos ni mayúsculas) y sus canciones', () => {
  assert.deepEqual(forgotten(S, { kind: 'artists', now: NOW, excluded: ['VIEJO'] }).map(r => r.name), ['Medio Año']);
  assert.deepEqual(forgotten(S, { kind: 'tracks', now: NOW, excluded: ['viejo'], minWeight: 1 }).map(r => r.name), []);
  assert.deepEqual(forgotten(S, { kind: 'tracks', now: NOW, minWeight: 25 }).map(r => r.name), ['Tema 1', 'Tema 2']);
});

test('playlists: la fecha de «añadida» cuenta como última escucha y suman peso', () => {
  const items = [
    { added_at: '2023-05-10T10:00:00Z', track: { name: 'Canción A', uri: 'spotify:track:1', artists: [{ name: 'Perdido' }], album: { name: 'Disco' } } },
    { added_at: '2023-06-01T10:00:00Z', track: { name: 'Canción B', uri: 'spotify:track:2', artists: [{ name: 'Perdido' }], album: { name: 'Disco' } } },
    { added_at: '2023-06-01T10:00:00Z', track: { name: 'Canción C', uri: 'spotify:track:3', artists: [{ name: 'Perdido' }] } },
    { added_at: '2023-06-01T10:00:00Z', track: null },
    { added_at: '2023-06-01T10:00:00Z', track: { name: 'Local', is_local: true, artists: [{ name: 'X' }] } },
    { added_at: '2023-06-01T10:00:00Z', track: { name: 'Episodio', type: 'episode' } },
    { added_at: '2026-11-01T10:00:00Z', track: { name: 'Hoy', uri: 'spotify:track:9', artists: [{ name: 'Reciente' }] } }
  ];
  const pl = parsePlaylistItems(items);
  assert.equal(pl.length, 4);
  assert.deepEqual(pl[0], { a: 'Perdido', n: 'Canción A', al: 'Disco', u: 'spotify:track:1', t: '2023-05' });
  const l = forgotten(S, { kind: 'artists', now: NOW, plist: pl, minWeight: 10 });
  const p = l.find(r => r.name === 'Perdido');
  assert.ok(p && p.inPlaylist && p.last === '2023-06' && p.weight === 15);
  assert.ok(!l.some(r => r.name === 'Reciente'));
  // un artista del historial que además está en la playlist: gana la fecha más reciente
  const viejo = forgotten(S, { kind: 'artists', now: NOW, plist: [{ a: 'Viejo', n: 'X', al: '', u: '', t: '2025-01' }] }).find(r => r.name === 'Viejo');
  assert.equal(viejo.last, '2025-01');
  const t = forgotten(S, { kind: 'tracks', now: NOW, plist: pl, minWeight: 4 }).find(r => r.name === 'Canción A');
  assert.equal(t.uri, 'spotify:track:1');
  assert.deepEqual(parsePlaylistItems(undefined), []);
});

test('playlistTracks: 3 canciones top de cada artista, o las propias canciones', () => {
  const list = forgotten(S, { kind: 'artists', now: NOW });
  const tr = playlistTracks(S, list, { kind: 'artists' });
  assert.deepEqual(tr.map(t => t.name), ['Tema 1', 'Tema 2', 'Tema 3']);
  const own = playlistTracks(S, forgotten(S, { kind: 'tracks', now: NOW, minWeight: 1 }), { kind: 'tracks', maxTracks: 2 });
  assert.equal(own.length, 2);
});
