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

test('parseSpotifyAlbum: web, con idioma/parámetros y URI', () => {
  const id = '2Gzdlis2gby7peCvJ0Poif';
  assert.equal(C.parseSpotifyAlbum(`https://open.spotify.com/intl-es/album/${id}?si=abc`).id, id);
  assert.equal(C.parseSpotifyAlbum(`spotify:album:${id}`).url, `https://open.spotify.com/album/${id}`);
  assert.equal(C.parseSpotifyAlbum('https://open.spotify.com/track/' + id), null);
  assert.equal(C.parseSpotifyAlbum(42), null);
});

test('normalizeTags: minúsculas, sin repetidos, máximo 8', () => {
  assert.deepEqual(C.normalizeTags('Rap, trap | RAP'), ['rap', 'trap']);
  assert.equal(C.normalizeTags('a,b,c,d,e,f,g,h,i,j').length, 8);
});

test('newAlbum valida enlace, nombre, artista y portada https', () => {
  const ok = { spotifyUrl: 'https://open.spotify.com/album/2Gzdlis2gby7peCvJ0Poif', name: ' X ', artist: 'Y', image: 'https://i.scdn.co/a.jpg', tags: 'Rap', year: '2020', now: 5 };
  const r = C.newAlbum(ok);
  assert.ok(r.ok); assert.equal(r.album.name, 'X'); assert.deepEqual(r.album.tags, ['rap']); assert.equal(r.album.year, 2020); assert.equal(r.album.addedAt, 5);
  assert.equal(C.newAlbum({ ...ok, image: 'http://x/a.jpg' }).ok, false);
  assert.equal(C.newAlbum({ ...ok, artist: ' ' }).ok, false);
  assert.equal(C.newAlbum({ ...ok, spotifyUrl: 'hola' }).ok, false);
});

test('parseExtras solo acepta discos bien formados; isOwner', () => {
  const id = '2Gzdlis2gby7peCvJ0Poif';
  const good = { id, artist: 'A', name: 'B', image: 'https://x/y.jpg', tags: [], url: 'https://open.spotify.com/album/' + id };
  assert.equal(C.parseExtras(JSON.stringify({ albums: [good, { ...good, id: 'corto' }, { ...good, image: '' }] })).length, 1);
  assert.deepEqual(C.parseExtras('no json'), []);
  assert.ok(C.isOwner('u1', 'u1')); assert.ok(!C.isOwner('u1', 'u2')); assert.ok(!C.isOwner('', ''));
});

test('filterWall: buscador, estilo y orden; allTags', () => {
  const l = [{ artist: 'Zeta', name: 'Uno', tags: ['rap'] }, { artist: 'Álvaro', name: 'Dos', tags: ['pop', 'rap'] }, { artist: 'Beta', name: 'Tres', tags: [] }];
  assert.deepEqual(C.filterWall(l, '', '').map(a => a.name), ['Dos', 'Tres', 'Uno']);
  assert.deepEqual(C.filterWall(l, 'alvaro', '').map(a => a.name), ['Dos']);
  assert.deepEqual(C.filterWall(l, '', 'rap').map(a => a.name), ['Dos', 'Uno']);
  assert.deepEqual(C.allTags(l), ['pop', 'rap']);
});

test('syncStatus: mismos estados y prioridad que mi-app', () => {
  const now = 1_000_000_000;
  assert.equal(C.syncStatus({ online: false, now }).state, 'offline');
  assert.equal(C.syncStatus({ online: false, syncing: true, now }).state, 'offline');   // sin conexión manda sobre todo
  assert.equal(C.syncStatus({ syncing: true, error: 'x', now }).state, 'syncing');
  assert.equal(C.syncStatus({ error: 'Firestore respondió 403', lastSyncAt: now - 5000, now }).state, 'error');
  assert.equal(C.syncStatus({ dirty: true, now }).state, 'pending');
  const ok = C.syncStatus({ lastSyncAt: now - 5 * 60000, now });
  assert.equal(ok.state, 'ok'); assert.match(ok.detail, /hace 5 min/);
  assert.equal(C.syncStatus({ now }).state, 'unknown');
  assert.equal(C.syncStatus({ lastSyncAt: now + 99999, now }).detail, 'Última sincronización: hace un momento');
});

test('relativeTime', () => {
  const now = 10 * 86400000;
  assert.equal(C.relativeTime(now - 2 * 3600000, now), 'hace 2 h');
  assert.equal(C.relativeTime(now - 86400000, now), 'hace 1 día');
  assert.equal(C.relativeTime(now - 3 * 86400000, now), 'hace 3 días');
  assert.equal(C.relativeTime(0, now), '');
});

test('albumKey ignora los espacios y la puntuación entre palabras (Diego 900 = Diego900)', () => {
  assert.equal(C.albumKey('Diego 900', 'La Espalda del Sol'), C.albumKey('Diego900', 'La Espalda Del Sol'));
  assert.equal(C.albumKey('C. Tangana', 'Avida Dollars'), C.albumKey('C.Tangana', 'avida dollars'));
  assert.notEqual(C.albumKey('Diego 900', 'A'), C.albumKey('Diego 800', 'A'));
  assert.equal(C.artistKey('Eladio Carrión'), C.artistKey('ELADIO CARRION'));
});

test('rekeyHistory migra claves antiguas (con espacios) y junta duplicados', () => {
  const old = {
    'diego 900|la espalda del sol': { artist: 'Diego 900', name: 'La Espalda del Sol', id: '', months: { '2026-01': { ms: 100, plays: 1 } }, tracks: ['a'] },
    'diego900|la espalda del sol': { artist: 'Diego900', name: 'La Espalda Del Sol', id: '', months: { '2026-01': { ms: 50, plays: 1 } }, tracks: ['b'] }
  };
  const k = C.rekeyHistory(old);
  assert.deepEqual(Object.keys(k), ['diego900|espaldasol']);                 // «la» y «del» no cuentan
  assert.equal(k['diego900|espaldasol'].months['2026-01'].ms, 150);
  const a = C.rekeyApi({ 'xy z|c': { artist: 'Xy Z', name: 'Disco', points: 3, saved: false }, 'xyz|c': { artist: 'XyZ', name: 'Disco', points: 5, saved: true } });
  assert.equal(Object.keys(a).length, 1); assert.equal(Object.values(a)[0].points, 5); assert.equal(Object.values(a)[0].saved, true);
});

test('lector de zip: recupera los archivos completos de un zip CORTADO (sin directorio central, como el que da Spotify en flujo)', async () => {
  const buf = readFileSync(new URL('./spotify-truncated.zip', import.meta.url));
  const entries = await readSpotifyZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(entries.length, 50);                                                      // 30 de 2025 + 20 de 2026; el PDF cortado se descarta
  assert.equal(entries[0].master_metadata_album_artist_name, 'Nirvana');
  assert.equal(entries[49].master_metadata_album_artist_name, 'Radiohead');
  await assert.rejects(() => readSpotifyZip(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer), /No parece un \.zip válido/);
});

test('minArtistPlays: fuera artistas con una sola reproducción', async () => {
  const { minArtistPlays } = await import('../js/core.js');
  const l = [{ artist: 'A', plays: 1 }, { artist: 'B', plays: 1 }, { artist: 'b', plays: 1 }, { artist: 'C', plays: 0 }];
  assert.deepEqual(minArtistPlays(l).map(r => r.artist), ['B', 'b', 'C']);
});

test('el id de un deseo conserva el formato antiguo (los deseos guardados no se rompen)', async () => {
  const { wishId } = await import('../js/wishlist.js');
  assert.equal(wishId({ kind: 'album', artist: 'Diego 900', name: 'La Espalda del Sol' }), 'a|diego 900|espalda sol');
  assert.equal(wishId({ kind: 'release', discogsId: 123, artist: 'x', name: 'y' }), 'r123');
  assert.notEqual(C.albumKey('Diego 900', 'La Espalda del Sol'), C.legacyAlbumKey('Diego 900', 'La Espalda del Sol'));
});

test('splitExtras separa discos válidos de no válidos (con el motivo) y conserva todo tal cual', () => {
  const id = '2Gzdlis2gby7peCvJ0Poif';
  const good = { id, artist: 'A', name: 'B', image: 'https://x/y.jpg', tags: [], url: 'https://open.spotify.com/album/' + id };
  const text = JSON.stringify({ albums: [good, { ...good, image: 'http://x/y.jpg' }, { ...good, id: 'corto', url: '' }, { ...good, name: '' }, { ...good, tags: 'rap' }, { ...good, url: 'https://otro' }, 'basura'] });
  const r = C.splitExtras(text);
  assert.equal(r.ok.length, 1); assert.equal(r.raw.length, 7); assert.equal(r.bad.length, 6);
  assert.deepEqual(r.bad.map(b => b.why), ['su portada no es una dirección https válida', 'su id de Spotify no es válido', 'no tiene nombre', 'sus estilos no están bien guardados', 'su enlace de Spotify no coincide con el id', 'no es un disco']);
  assert.equal(C.parseExtras(text).length, 1);                              // parseExtras sigue igual
  assert.equal(C.splitExtras('{{no json').corrupt, true);
  assert.equal(C.splitExtras('').corrupt, false); assert.deepEqual(C.splitExtras(JSON.stringify({ albums: [] })).raw, []);
});

test('corteInglesUrl: búsqueda con artista, álbum limpio y «vinilo»', () => {
  const u = C.corteInglesUrl({ artist: 'Rosalía', name: 'Motomami (Deluxe)' });
  assert.match(u, /^https:\/\/www\.elcorteingles\.es\/search-nwx\/1\/\?s=Rosal%C3%ADa\+Motomami\+vinilo&stype=text_box$/);
});

test('makeManual: valida y completa un disco añadido a mano', () => {
  const ok = C.makeManual({ name: ' Nevermind ', artist: 'Nirvana', year: '1991', tags: 'Grunge, rock, GRUNGE', image: 'https://i.discogs.com/x.jpg', now: 1000 });
  assert.equal(ok.ok, true);
  assert.deepEqual({ ...ok.album, id: '' }, { id: '', artist: 'Nirvana', name: 'Nevermind', image: 'https://i.discogs.com/x.jpg', tags: ['grunge', 'rock'], url: '', year: 1991, addedAt: 1000, manual: true });
  assert.match(ok.album.id, /^m/);
  assert.equal(C.makeManual({ name: '', artist: 'A' }).ok, false);
  assert.equal(C.makeManual({ name: 'N', artist: '' }).ok, false);
  assert.equal(C.makeManual({ name: 'N', artist: 'A', image: 'http://x/a.jpg' }).ok, false);          // portada solo https
  assert.equal(C.makeManual({ name: 'N', artist: 'A', image: '' }).ok, true);                       // sin portada vale
  assert.equal(C.makeManual({ name: 'N', artist: 'A', spotifyUrl: 'https://youtube.com/x' }).ok, false);
  const sp = C.makeManual({ name: 'N', artist: 'A', spotifyUrl: 'https://open.spotify.com/album/2Gzdlis2gby7peCvJ0Poif?si=x' });
  assert.equal(sp.album.url, 'https://open.spotify.com/album/2Gzdlis2gby7peCvJ0Poif');
  assert.equal(C.makeManual({ name: 'N', artist: 'A', year: 'x' }).album.year, null);
});

test('mergeCollection conserva la marca de disco manual', () => {
  const m = C.makeManual({ name: 'N', artist: 'A' }).album;
  const out = C.mergeCollection([], [m]);
  assert.equal(out[0].manual, true); assert.equal(out[0].extra, true);
});
