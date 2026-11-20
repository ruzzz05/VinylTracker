import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSong, pickAlbum, pickSpotifyTrack, pickSpotifyAlbum, bigArtwork, knownCovers } from '../js/covers.js';

const r = (artistName, trackName, collectionName, art = 'https://is1.mzstatic.com/image/thumb/Music/x/100x100bb.jpg') => ({ artistName, trackName, collectionName, artworkUrl100: art });

test('bigArtwork: pide una imagen mayor', () => {
  assert.equal(bigArtwork('https://is1.mzstatic.com/a/100x100bb.jpg'), 'https://is1.mzstatic.com/a/300x300bb.jpg');
  assert.equal(bigArtwork('https://x/otra.png'), 'https://x/otra.png');
});

test('pickSong: mismo artista y canción; prefiere el mismo álbum; ignora versiones de otros', () => {
  const list = [
    r('Nirvana Tribute', 'Smells Like Teen Spirit', 'Tributo', 'https://x/tributo/100x100bb.jpg'),
    r('Nirvana', 'Smells Like Teen Spirit', 'Greatest Hits', 'https://x/hits/100x100bb.jpg'),
    r('Nirvana', 'Smells Like Teen Spirit', 'Nevermind (Remastered)', 'https://x/never/100x100bb.jpg')
  ];
  assert.equal(pickSong(list, 'Nirvana', 'Smells Like Teen Spirit', 'Nevermind'), 'https://x/never/300x300bb.jpg');
  assert.equal(pickSong(list, 'Nirvana', 'Smells Like Teen Spirit', ''), 'https://x/hits/300x300bb.jpg');
  assert.equal(pickSong(list, 'Nirvana', 'Otra canción'), null);
  assert.equal(pickSong([r('Rosalía', 'DESPECHÁ', 'Motomami')], 'Rosalia', 'Despecha'), 'https://is1.mzstatic.com/image/thumb/Music/x/300x300bb.jpg');
  assert.equal(pickSong([r('Nirvana', 'Hola (feat. X)', 'A')], 'Nirvana', 'Hola'), 'https://is1.mzstatic.com/image/thumb/Music/x/300x300bb.jpg');
  assert.equal(pickSong([{ artistName: 'Nirvana', trackName: 'X' }], 'Nirvana', 'X'), null);   // sin portada
  assert.equal(pickSong(undefined, 'a', 'b'), null);
});

test('knownCovers: de la API y del registro en vivo', () => {
  const m = knownCovers({ apiAlbums: { 'nirvana|nevermind': { image: 'https://i/n.jpg' }, 'x|y': { image: '' } },
    live: { entries: [{ artist: 'Radiohead', album: 'OK Computer', image: 'https://i/ok.jpg' }, { artist: 'Nirvana', album: 'Nevermind', image: 'https://i/otra.jpg' }] } });
  assert.deepEqual(m, { 'nirvana|nevermind': 'https://i/n.jpg', 'radiohead|okcomputer': 'https://i/ok.jpg' });
  assert.deepEqual(knownCovers(), {});
});

test('pickAlbum: álbumes y también singles / EP («Título - Single»)', () => {
  const list = [
    { artistName: 'Delta Goodrem', collectionName: 'Pure - Single', artworkUrl100: 'https://x/pure/100x100bb.jpg' },
    { artistName: 'Otro', collectionName: 'Pure', artworkUrl100: 'https://x/otro/100x100bb.jpg' },
    { artistName: 'Rosalía', collectionName: 'Motomami (Deluxe)', artworkUrl100: 'https://x/moto/100x100bb.jpg' }
  ];
  assert.equal(pickAlbum(list, 'Delta Goodrem', 'Pure'), 'https://x/pure/300x300bb.jpg');
  assert.equal(pickAlbum(list, 'Rosalia', 'MOTOMAMI'), 'https://x/moto/300x300bb.jpg');
  assert.equal(pickAlbum(list, 'Delta Goodrem', 'Impure'), null);
  assert.equal(pickAlbum(undefined, 'a', 'b'), null);
});

test('pickSong: singles (el álbum se llama como la canción)', () => {
  const r = [{ artistName: 'Delta Goodrem', trackName: 'Pure', collectionName: 'Pure - Single', artworkUrl100: 'https://x/p/100x100bb.jpg' }];
  assert.equal(pickSong(r, 'Delta Goodrem', 'Pure', 'Pure'), 'https://x/p/300x300bb.jpg');
});

test('Spotify: elige canción / álbum del artista y la imagen mediana', () => {
  const imgs = [{ url: 'https://s/big' }, { url: 'https://s/mid' }];
  assert.equal(pickSpotifyTrack([{ name: 'Pure', artists: [{ name: 'Otro' }], album: { images: imgs } },
    { name: 'Pure', artists: [{ name: 'Delta Goodrem' }, { name: 'X' }], album: { images: imgs } }], 'Delta Goodrem', 'Pure'), 'https://s/mid');
  assert.equal(pickSpotifyTrack([{ name: 'Pure', artists: [{ name: 'Otro' }], album: { images: imgs } }], 'Delta Goodrem', 'Pure'), null);
  assert.equal(pickSpotifyAlbum([{ name: 'Pure - Single', artists: [{ name: 'Delta Goodrem' }], images: imgs }], 'Delta Goodrem', 'Pure'), 'https://s/mid');
  assert.equal(pickSpotifyAlbum([{ name: 'Pure', artists: [{ name: 'Delta Goodrem' }], images: [] }], 'Delta Goodrem', 'Pure'), null);
  assert.equal(pickSpotifyTrack(undefined, 'a', 'b'), null);
});
