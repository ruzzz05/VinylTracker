import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSpotifyArtist, pickDiscogsArtist } from '../js/artists.js';

test('Spotify: elige el artista con el mismo nombre (el más popular) y su imagen mediana', () => {
  const items = [
    { name: 'Nirvana Tribute', popularity: 90, images: [{ url: 'https://x/t' }] },
    { name: 'Nirvana', popularity: 40, images: [{ url: 'https://x/small-book' }, { url: 'https://x/mid-book' }] },
    { name: 'NIRVANA', popularity: 80, images: [{ url: 'https://x/big' }, { url: 'https://x/mid' }, { url: 'https://x/sm' }] }
  ];
  assert.equal(pickSpotifyArtist(items, 'Nirvana'), 'https://x/mid');
  assert.equal(pickSpotifyArtist(items, 'Los Delinqüentes'), null);
  assert.equal(pickSpotifyArtist([{ name: 'Rosalía', images: [{ url: 'https://x/r' }] }], 'Rosalia'), 'https://x/r');   // acentos
  assert.equal(pickSpotifyArtist([{ name: 'Sin foto', images: [] }], 'Sin foto'), null);
  assert.equal(pickSpotifyArtist(undefined, 'X'), null);
});

test('Discogs: mismo nombre, mejor sin "(2)", y sin imágenes vacías', () => {
  const results = [
    { title: 'Nirvana (2)', cover_image: 'https://i.discogs.com/otra' },
    { title: 'Nirvana', cover_image: 'https://st.discogs.com/abc/images/spacer.gif', thumb: '' },
    { title: 'Nirvana (10)', thumb: 'https://i.discogs.com/diez' }
  ];
  assert.equal(pickDiscogsArtist(results, 'Nirvana'), 'https://i.discogs.com/otra');   // el principal no tiene foto: se usa el siguiente
  assert.equal(pickDiscogsArtist([{ title: 'Vetusta Morla', cover_image: 'https://i.discogs.com/v' }, { title: 'Pucho (3)', cover_image: 'https://i.discogs.com/p' }], 'Vetusta Morla'), 'https://i.discogs.com/v');
  assert.equal(pickDiscogsArtist([{ title: 'Otro', cover_image: 'https://i.discogs.com/o' }], 'Nirvana'), null);
});
