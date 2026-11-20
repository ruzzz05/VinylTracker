import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSong, bigArtwork, knownCovers } from '../js/covers.js';

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
  assert.deepEqual(m, { 'nirvana|nevermind': 'https://i/n.jpg', 'radiohead|ok computer': 'https://i/ok.jpg' });
  assert.deepEqual(knownCovers(), {});
});
