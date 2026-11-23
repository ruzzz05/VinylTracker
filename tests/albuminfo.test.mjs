import test from 'node:test';
import assert from 'node:assert/strict';
import { genreTags, spotifyInfo, discogsInfo } from '../js/albuminfo.js';
import { parseDiscogsResult } from '../js/wishlist.js';

test('genreTags: minúsculas, sin repetidos y máximo 8', () => {
  assert.deepEqual(genreTags(['Pop Rap', 'Trap'], ['Hip Hop', 'pop rap']), ['pop rap', 'trap', 'hip hop']);
  assert.equal(genreTags(Array.from({ length: 20 }, (_, i) => 'g' + i)).length, 8);
  assert.deepEqual(genreTags(undefined, null, ['', '  ']), []);
});

test('spotifyInfo: nombre, artista, año, portada grande, sello, canciones y estilos del artista', () => {
  const album = { id: '2Gzdlis2gby7peCvJ0Poif', name: 'ULTRASWAN', release_date: '2023-05-12', label: 'Sello', total_tracks: 14, album_type: 'album',
    artists: [{ id: 'A1', name: 'Abhir' }], images: [{ url: 'https://s/300', width: 300 }, { url: 'https://s/640', width: 640 }, { url: 'https://s/64', width: 64 }] };
  const i = spotifyInfo(album, { genres: ['Indian R&B', 'desi pop'] });
  assert.deepEqual({ ...i }, { source: 'spotify', id: '2Gzdlis2gby7peCvJ0Poif', spotifyUrl: 'https://open.spotify.com/album/2Gzdlis2gby7peCvJ0Poif', name: 'ULTRASWAN',
    artist: 'Abhir', artistId: 'A1', year: 2023, image: 'https://s/640', label: 'Sello', tracks: 14, type: 'album', tags: ['indian r&b', 'desi pop'] });
  assert.equal(spotifyInfo(null), null);
  assert.equal(spotifyInfo({ id: '2Gzdlis2gby7peCvJ0Poif', release_date: '1999' }).year, 1999);
  assert.equal(spotifyInfo({ id: '2Gzdlis2gby7peCvJ0Poif', release_date: '' }).year, null);
});

test('Discogs: estilos primero y luego géneros -> etiquetas', () => {
  const p = parseDiscogsResult({ id: 5, title: 'Rosalía - Motomami', year: '2022', label: ['Columbia'], format: ['Vinyl', 'LP'], genre: ['Latin', 'Pop'], style: ['Reggaeton'], cover_image: 'https://i.discogs.com/m.jpg' });
  assert.deepEqual(p.tags, ['reggaeton', 'latin', 'pop']);
  const i = discogsInfo(p);
  assert.equal(i.year, 2022); assert.equal(i.image, 'https://i.discogs.com/m.jpg'); assert.equal(i.label, 'Columbia');
});
