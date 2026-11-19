import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../js/core.js';
import { readSpotifyZip } from '../js/zip.js';

test('albumKey une ediciones y acentos', () => {
  assert.equal(C.albumKey('Rosalía', 'Motomami (Deluxe)'), C.albumKey('Rosalia', 'MOTOMAMI'));
  assert.equal(C.cleanAlbum('Abbey Road - 2019 Remaster'), 'Abbey Road');
});

test('parseCollectionCsv: comillas, espacios, imágenes relativas y id de Spotify', () => {
  const csv = 'Artist,Name,Image,Tags,Url\nAbhir, ULTRASWAN,https://x/y.jpg, r&b|trap, https://open.spotify.com/album/2Gzdlis2gby7peCvJ0Poif?si=abc\n' +
    'C. Tangana,"Bien:(, el disco",img/bien.jpg,rap|pop,\n';
  const rows = C.parseCollectionCsv(csv, 'https://b/img/');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'ULTRASWAN');
  assert.equal(rows[0].id, '2Gzdlis2gby7peCvJ0Poif');
  assert.deepEqual(rows[0].tags, ['r&b', 'trap']);
  assert.equal(rows[1].name, 'Bien:(, el disco');
  assert.equal(rows[1].image, 'https://b/img/img/bien.jpg');
});

test('isOwned por id de Spotify o por nombre normalizado', () => {
  const idx = C.ownedIndex([{ artist: 'Abhir', name: 'ULTRASWAN', id: 'AAA' }, { artist: 'Rosalía', name: 'Motomami', id: '' }]);
  assert.ok(C.isOwned({ id: 'AAA', artist: 'x', name: 'y' }, idx));
  assert.ok(C.isOwned({ id: 'ZZZ', artist: 'ROSALIA', name: 'Motomami (Deluxe)' }, idx));
  assert.ok(!C.isOwned({ id: 'ZZZ', artist: 'Nirvana', name: 'Nevermind' }, idx));
});

test('mergeCollection no duplica por id', () => {
  const out = C.mergeCollection([{ artist: 'A', name: 'B', id: '1' }], [{ artist: 'A', name: 'B', id: '1' }, { artist: 'C', name: 'D', id: '2' }]);
  assert.equal(out.length, 2);
  assert.ok(out[1].extra);
});

test('historial: ventana por meses y ranking', () => {
  const mk = (ts, ms = 200000) => ({ ts, ms_played: ms, master_metadata_album_artist_name: 'Nirvana',
    master_metadata_album_album_name: 'Nevermind', master_metadata_track_name: 't' });
  const { into, used, skipped } = C.aggregateHistory([mk('2026-11-01T10:00:00Z'), mk('2026-11-02T10:00:00Z'), mk('2025-01-01T10:00:00Z'),
    mk('2026-11-03T10:00:00Z', 5000), { ts: '2026-11-03T10:00:00Z', ms_played: 9 }]);
  assert.equal(used, 3); assert.equal(skipped, 1);
  const now = new Date('2026-11-19T00:00:00Z');
  const a = into['nirvana|nevermind'];
  assert.equal(C.windowStats(a, 1, now).plays, 2);        // solo noviembre
  assert.equal(C.windowStats(a, 12, now).plays, 2);       // enero 2025 queda fuera
  assert.equal(C.windowStats(a, 0, now).plays, 3);        // todo
  const r = C.buildRanking({ history: into, api: {}, months: 12, now });
  assert.equal(r[0].plays, 2);
});

test('ranking sin historial usa puntos de la API; con historial manda el tiempo', () => {
  const api = { 'a|x': { artist: 'A', name: 'X', points: 5 }, 'b|y': { artist: 'B', name: 'Y', points: 9 }, 'c|z': { artist: 'C', name: 'Z', points: 0, saved: true } };
  assert.deepEqual(C.buildRanking({ api }).map(r => r.key), ['b|y', 'a|x', 'c|z']);
  const history = { 'a|x': { artist: 'A', name: 'X', months: { '2026-11': { ms: 600000, plays: 3 } } } };
  assert.equal(C.buildRanking({ history, api, now: new Date('2026-11-19') })[0].key, 'a|x');
});

const stores = { stores: { 'Tienda': { base: 'https://t.test/collections/vinilos', items: [
  ['Nevermind - Vinilo', 'Nirvana', 31.99, 1, 'nirvana-nevermind-vinilo', 0, ''],
  ['Nevermind - Vinilo (Edición exclusiva)', 'Nirvana', 40, 0, 'nirvana-nevermind-excl', 1, '2027-03-05'],
  ['Pure - Vinilo', 'Delta Goodrem', 29.99, 1, 'delta-pure', 0, '']] } } };

test('matchStores: artista y álbum, orden por disponibilidad y precio', () => {
  const idx = C.indexStores(stores);
  const hits = C.matchStores({ artist: 'Nirvana', name: 'Nevermind (Remastered)' }, idx);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].price, 31.99);
  assert.equal(hits[0].url, 'https://t.test/products/nirvana-nevermind-vinilo');
  assert.equal(hits[1].release, '2027-03-05');
  assert.equal(C.matchStores({ artist: 'Nirvana', name: 'Pure' }, idx).length, 0);
});

test('bestOffer / estimate', () => {
  const offers = [{ price: 40, available: false, preorder: false }, { price: 35, available: true, preorder: false }];
  assert.equal(C.bestOffer(offers).price, 35);
  assert.equal(C.estimate({ discogs: { lowest: 20 } }, []), 20);
  assert.equal(C.estimate({ discogs: { lowest: 20 } }, offers), 35);
  assert.equal(C.estimate({}, []), null);
});

test('pickRelease elige la más popular y rechaza otras', () => {
  const res = [{ id: 1, title: 'Nirvana - Nevermind', community: { have: 10 } }, { id: 2, title: 'Nirvana - Nevermind', community: { have: 5000 } },
    { id: 3, title: 'Otro - Cosa', community: { have: 99999 } }];
  assert.equal(C.pickRelease(res, 'Nirvana', 'Nevermind (Deluxe)').id, 2);
  assert.equal(C.pickRelease(res, 'Nadie', 'Nada'), null);
});

test('fnacUrl', () => {
  assert.match(C.fnacUrl({ artist: 'Rosalía', name: 'Motomami (Deluxe)' }), /Search=Rosal%C3%ADa\+Motomami\+vinilo$/);
});

test('lector de zip del export de Spotify (deflate real)', async () => {
  const buf = readFileSync(new URL('./spotify-sample.zip', import.meta.url));
  const entries = await readSpotifyZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(entries.length, 3);
  assert.equal(entries[0].master_metadata_album_album_name, 'Nevermind');
});
