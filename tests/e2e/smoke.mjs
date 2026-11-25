// Prueba de humo en un iPhone virtual, con Spotify/Discogs/Firebase simulados.
// Requiere Playwright y `python tools/build_site.py`.  Uso: node tests/e2e/smoke.mjs [carpeta-capturas]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SHOTS = process.argv[2] || path.join(ROOT, '_shots');
mkdirSync(SHOTS, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1', '-d', path.join(ROOT, '_site')], { stdio: 'ignore' });
process.on('exit', () => server.kill());
await new Promise(r => setTimeout(r, 800));
const BASE = 'http://127.0.0.1:8765/';
const STORES_FILE = path.join(ROOT, '_site/data/stores.json');
const writeStores = available => writeFileSync(STORES_FILE, JSON.stringify({ generated: new Date().toISOString(), stores: { Apparell: { base: 'https://apparell.example',
  items: [['Delta Goodrem - Pure (Vinyl LP)', 'Delta Goodrem', 22, available, 'delta-goodrem-pure', 0, '']] } } }));
writeStores(0);

const CSV = 'Artist,Name,Image,Tags,Url\nAbhir, ULTRASWAN,,r&b, https://open.spotify.com/album/2Gzdlis2gby7peCvJ0Poif?si=x\nRosalía,Motomami,,pop,\n';
const entry = (artist, album, n, month = '2026-10') => Array.from({ length: n }, (_, i) => ({
  ts: `${month}-${String(1 + (i % 27)).padStart(2, '0')}T12:00:00Z`, ms_played: 200000, master_metadata_track_name: 't' + (i % 5),
  master_metadata_album_artist_name: artist, master_metadata_album_album_name: album, spotify_track_uri: 'spotify:track:' + album + (i % 5) }));
const HISTORY = [...entry('Nirvana', 'Nevermind', 40), ...entry('Delta Goodrem', 'Pure', 25), ...entry('Abhir', 'ULTRASWAN', 20),
  ...entry('Rosalía', 'Motomami (Deluxe)', 15), ...entry('Radiohead', 'OK Computer', 12), ...entry('Viejo', 'Antiguo', 30, '2024-01')];
writeFileSync(path.join(SHOTS, 'history.json'), JSON.stringify(HISTORY));

const OWNER = 'eFXlrMGYWIRQkAkzLr5ex5J4aS13';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
let discogsCalls = 0;
const plAdded = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'es-ES' });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') console.log('console.error:', m.text()); });

await ctx.route('https://ruzzz05.github.io/mi-app/apps/vinilos/musica.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: CSV }));
await ctx.route('https://identitytoolkit.googleapis.com/**', r => json(r, { idToken: 'tok', refreshToken: 'ref', localId: OWNER, expiresIn: '3600' }));
const mk = (id, artist, name) => ({ id, artist, name, image: 'https://i.scdn.co/' + id + '.jpg', tags: ['rock'], url: 'https://open.spotify.com/album/' + id });
// Un disco en la nube con formato no válido (portada http): debe avisarse y NO borrarse al añadir otro
const malo = { ...mk('BBBBBBBBBBBBBBBBBBBBBB', 'Roto', 'Disco roto'), image: 'http://inseguro/x.jpg' };
let cloud = JSON.stringify({ albums: [mk('AAAAAAAAAAAAAAAAAAAAAA', 'Radiohead', 'OK Computer'), malo] });
let patched = null;
const vt = new Map();           // documentos vt-… de la copia en la nube
await ctx.route('https://firestore.googleapis.com/**', r => {
  const m = /\/vinilos\/(vt-[^?]+)/.exec(r.request().url());
  if (m) {
    if (r.request().method() === 'PATCH') { vt.set(m[1], JSON.parse(r.request().postData()).fields); return json(r, {}); }
    return vt.has(m[1]) ? json(r, { fields: vt.get(m[1]) }) : json(r, {}, 404);
  }
  if (r.request().method() === 'PATCH') { patched = JSON.parse(r.request().postData()); cloud = patched.fields.json.stringValue; return json(r, {}); }
  return json(r, { fields: { updatedAt: { integerValue: '1' }, json: { stringValue: cloud } } });
});
await ctx.route('https://open.spotify.com/oembed**', r => json(r, { title: 'Nuevo Disco', thumbnail_url: 'https://i.scdn.co/nuevo.jpg' }));
await ctx.route('https://itunes.apple.com/**', r => {
  const u = new URL(r.request().url());
  const term = u.searchParams.get('term') || '';
  if (u.searchParams.get('entity') === 'song') {
    return json(r, { results: [{ artistName: 'Nirvana', trackName: term.replace(/^Nirvana /, ''), collectionName: 'Nevermind', artworkUrl100: 'https://i.scdn.co/trk/100x100bb.jpg' }] });
  }
  if (u.searchParams.get('entity') === 'album' && /Delta/.test(term)) {
    return json(r, { results: [{ artistName: 'Delta Goodrem', collectionName: 'Pure - Single', artworkUrl100: 'https://i.scdn.co/pure/100x100bb.jpg' }] });
  }
  return json(r, { results: [{ artistName: 'Artista Nuevo', collectionName: 'Nuevo Disco', releaseDate: '2024-05-01T00:00:00Z', primaryGenreName: 'Rap' }] });
});
await ctx.route('https://api.discogs.com/**', r => {
  discogsCalls++;
  const u = decodeURIComponent(r.request().url()).replace(/\+/g, ' ');
  if (u.includes('barcode=4006381333931')) {
    return json(r, { results: [{ id: 444, title: 'Artista Raro - Disco Raro', year: '2019', country: 'ES', label: ['Sello Raro'], format: ['Vinyl', 'LP'], genre: ['Electronic'], style: ['Ambient', 'Drone'],
      cover_image: 'https://i.scdn.co/raro.jpg', community: { have: 3, want: 1 } }] });
  }
  if (u.includes('barcode=')) {
    return json(r, { results: u.includes('5901234123457') ? [{ id: 333, title: 'Rosalía - Motomami', year: '2022', country: 'EU', label: ['Columbia'], format: ['Vinyl', 'LP', 'Album'], community: { have: 5, want: 1 } }] : [] });
  }
  if (u.includes('/database/search')) {
    const all = [{ id: 111, title: 'Nirvana - Nevermind', community: { have: 900, want: 50 } },
      { id: 222, title: 'Delta Goodrem - Pure', community: { have: 3, want: 1 } }];
    return json(r, { results: all.filter(x => u.includes('artist=' + x.title.split(' - ')[0])) });
  }
  if (u.includes('/marketplace/stats/')) return json(r, { lowest_price: { currency: 'EUR', value: 19 }, num_for_sale: 36 });
  return json(r, { minimum: '€1', median: '€2', maximum: '€3' });
});
// Imagen de 1x1 píxel para las fotos de prueba
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let pureHits = 0;
await ctx.route('https://i.scdn.co/**', r => { if (/\/pure\//.test(r.request().url())) pureHits++; return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
await ctx.route('https://accounts.spotify.com/authorize**', r => {
  const u = new URL(r.request().url());
  r.fulfill({ status: 302, headers: { location: `${BASE}?code=CODE&state=${u.searchParams.get('state')}` } });
});
await ctx.route('https://accounts.spotify.com/api/token', r => json(r, { access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
// Lo recién escuchado en Spotify (se amplía durante la prueba)
const recentItem = (name, minsAgo) => ({ played_at: new Date(Date.now() - minsAgo * 60000).toISOString(),
  track: { name, uri: 'spotify:track:' + name, duration_ms: 180000, artists: [{ name: 'Nirvana' }], album: { id: 'AL9', name: 'Nevermind', images: [] } } });
let recent = [recentItem('En vivo 1', 5)];
await ctx.route('https://api.spotify.com/v1/**', r => {
  const u = r.request().url();
  const alb = (id, name, artist) => ({ id, name, artists: [{ name: artist }], images: [], album_type: 'album', total_tracks: 10 });
  if (/\/v1\/albums\/[A-Za-z0-9]{22}/.test(u)) return json(r, { id: '7yyRTcZmCiyzzJlNzGC9Ol', name: 'Álbum Completo', release_date: '2021-03-05', label: 'Sello Spotify', total_tracks: 12, album_type: 'album',
    artists: [{ id: 'ART1', name: 'Artista Completo' }], images: [{ url: 'https://i.scdn.co/full-64', width: 64 }, { url: 'https://i.scdn.co/full-640', width: 640 }] });
  if (/\/v1\/artists\/ART1/.test(u)) return json(r, { id: 'ART1', name: 'Artista Completo', genres: ['indie pop', 'bedroom pop'] });
  if (r.request().method() === 'POST' && /\/me\/playlists/.test(u)) return json(r, { id: 'NEWPL', external_urls: { spotify: 'https://open.spotify.com/playlist/NEWPL' } });
  if (r.request().method() === 'POST' && /\/playlists\/NEWPL\/tracks/.test(u)) { plAdded.push(...JSON.parse(r.request().postData()).uris); return json(r, { snapshot_id: 'x' }); }
  if (/\/me\/playlists/.test(u)) return json(r, { items: [{ id: 'PL1', name: 'playlist 01', tracks: { total: 3 }, owner: { display_name: 'yo' } }], next: null });
  if (/\/playlists\/PL1\/tracks/.test(u)) return json(r, { total: 3, next: null, items: [
    { added_at: '2023-05-10T10:00:00Z', track: { name: 'Canción Perdida A', uri: 'spotify:track:LOST1', artists: [{ name: 'Artista Perdido' }], album: { name: 'Disco Perdido' } } },
    { added_at: '2023-06-10T10:00:00Z', track: { name: 'Canción Perdida B', uri: 'spotify:track:LOST2', artists: [{ name: 'Artista Perdido' }], album: { name: 'Disco Perdido' } } },
    { added_at: '2023-06-11T10:00:00Z', track: { name: 'Otra', uri: 'spotify:track:LOST3', artists: [{ name: 'Artista Perdido' }], album: { name: 'Disco Perdido' } } }] });
  if (u.includes('/search') && /type=track/.test(u)) return json(r, { tracks: { items: [{ name: 'tema 0', uri: 'spotify:track:FOUND', artists: [{ name: 'Viejo' }], album: { images: [] } }] } });
  if (u.includes('/me/top/tracks')) return json(r, { items: [{ album: alb('s1', 'La Deriva', 'Vetusta Morla') }, { album: alb('s2', 'Nevermind', 'Nirvana') }] });
  if (u.includes('/search')) return json(r, { artists: { items: [{ name: 'Nirvana', popularity: 80, images: [{ url: 'https://i.scdn.co/art-big' }, { url: 'https://i.scdn.co/art-mid' }] }] } });
  if (u.includes('recently-played')) return json(r, { items: recent });
  if (u.includes('currently-playing')) return json(r, { is_playing: true, progress_ms: 60000, currently_playing_type: 'track',
    item: { name: 'Tema en directo', uri: 'spotify:track:live', duration_ms: 240000, artists: [{ name: 'Nirvana' }], album: { id: 'AL9', name: 'Nevermind', images: [] } } });
  return json(r, { items: [{ album: alb('s3', 'Guardado', 'Alguien') }], next: null });
});

await page.goto(BASE);
await page.waitForSelector('.empty');
await page.screenshot({ path: path.join(SHOTS, '1-vacio.png') });

// Ajustes: login de mi-app
await page.click('[data-tab=ajustes]');
await page.fill('input[autocomplete=username]', 'ruzz05');
await page.fill('input[type=password][autocomplete=current-password]', 'secreto');
await page.click('text=Iniciar sesión');
await page.waitForSelector('text=Sesión iniciada como');
assert.equal(await page.evaluate(() => localStorage.getItem('vt.fb.refresh')), 'ref');
assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('secreto'), 'la contraseña no debe guardarse');

// Importar historial (.json)
await page.setInputFiles('input[type=file]', path.join(SHOTS, 'history.json'));
await page.click('text=Importar');
await page.waitForSelector('.row');
const rows = await page.$$eval('.row .t b', els => els.map(e => e.textContent));
assert.equal(rows[0], 'Nevermind');
await page.screenshot({ path: path.join(SHOTS, '2-ranking.png') });
const owned = await page.$$eval('.row .own', els => els.length);
assert.ok(owned >= 3, 'ULTRASWAN (csv, por id), Motomami (csv, por nombre) y OK Computer (nube): ' + owned);
// Álbumes/singles sin portada guardada: se buscan solos (Delta Goodrem · Pure es un single)
await page.waitForFunction(() => [...document.querySelectorAll('.row')].some(r => /Pure/.test(r.textContent) && r.querySelector('img.cover')), null, { timeout: 20000 });
// y las portadas no se vuelven a descargar al cambiar de pestaña
await page.waitForTimeout(800);
const hits0 = pureHits;
for (const t of ['coleccion', 'ajustes', 'ranking', 'coleccion', 'ranking']) { await page.click('[data-tab=' + t + ']'); await page.waitForTimeout(150); }
await page.waitForFunction(() => [...document.querySelectorAll('.row')].some(r => /Pure/.test(r.textContent) && r.querySelector('img.cover')), null, { timeout: 5000 });
assert.ok(pureHits - hits0 <= 1, 'la portada se descargó de nuevo al cambiar de pestaña: ' + (pureHits - hits0));
await page.click('.seg >> text=Todo');
assert.ok((await page.$$('.row')).length >= 5);

// Estadísticas: Artistas, Canciones y Estadísticas salen del historial importado
const view = name => page.click(`.seg button:has-text("${name}")`);
await view('Artistas');
await page.waitForSelector('.row.static');
assert.ok((await page.$$('.row.static')).length >= 5, 'faltan artistas');
assert.match(await page.textContent('#view'), /Nirvana/);
await view('Canciones');
await page.waitForSelector('.row.static');
assert.ok((await page.$$('.row.static')).length >= 5, 'faltan canciones');
// Estadísticas: una sola página con el periodo, el tiempo, una gráfica y los tops
await page.click('[data-tab=stats]');
await page.waitForSelector('.hero .big');
{
  const t = await page.textContent('#view');
  for (const x of ['Reproducciones', 'Artistas', 'Minutos por mes', 'Canciones', 'Álbumes']) assert.ok(t.includes(x), 'falta: ' + x);
  const bad = /.{0,40}(NaN|undefined|null|Infinity).{0,40}/.exec(t); assert.ok(!bad, 'valores inválidos en las estadísticas: «' + (bad && bad[0]) + '»');
}
assert.equal((await page.$$('.cc')).length, 1, 'debe salir una gráfica de columnas');
assert.equal((await page.$$('.subnav')).length, 0, 'ya no hay sub-páginas');
assert.ok((await page.$$('.card.st .row.static')).length >= 6, 'faltan los tops');
await page.locator('.cc-col').nth(11).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);                     // el scroll oculta el globo: se espera a que termine antes de tocar
await page.click('.cc-col >> nth=11');
await page.waitForSelector('.tip:not([hidden])');
assert.match(await page.textContent('.tip'), /min|h/);
await page.setViewportSize({ width: 393, height: 2200 }); await page.waitForTimeout(250);
await page.screenshot({ path: path.join(SHOTS, '2b-estadisticas.png') });
await page.setViewportSize({ width: 393, height: 664 });
// otro periodo: con «1 mes» la gráfica pasa a ser por día
await page.click('.seg button:has-text("1 mes")');
await page.waitForSelector('text=Minutos por día');
await page.click('.seg button:has-text("Todo")');
// «Ver todo» abre la lista completa en Ranking
await page.click('.cardhead:has-text("Artistas") .linkbtn');
await page.waitForSelector('.seg button[aria-pressed=true]:has-text("Artistas")');
await page.click('[data-tab=ranking]');
await view('Álbumes');
await page.waitForSelector('.row:not(.static)');


// Comprar: ofertas de tienda (datos locales) + Discogs simulado
await page.click('[data-tab=comprar]');
await page.waitForSelector('.list .row');
const comprarTxt = await page.textContent('#view');
assert.ok(!/Coste de comprar|Buscar precios en Discogs/.test(comprarTxt), 'ya no debe haber total en euros ni cálculo en bloque');
assert.equal((await page.$$('#view .big')).length, 0);
await page.screenshot({ path: path.join(SHOTS, '3-comprar.png') });
// La ficha sí consulta el precio de un disco concreto en Discogs
await page.click('.row >> nth=0');
await page.waitForSelector('.sheet .panel');
await page.click('#dlook');
await page.waitForSelector('text=Copia más barata');
assert.ok(discogsCalls > 0);
await page.screenshot({ path: path.join(SHOTS, '5-ficha.png') });
await page.click('.sheet >> text=Cerrar');

// «Con precio»: además de las tiendas, se consultan los precios de Discogs (de uno en uno) y salen en la lista
await page.evaluate(() => localStorage.setItem('vt.discogs.token', 'tok'));
await page.reload();
await page.click('[data-tab=comprar]');
await page.waitForSelector('.list .row');
discogsCalls = 0;
await page.click('.chip:has-text("Con precio")');
await page.waitForFunction(() => /19,00/.test(document.querySelector('#view').textContent), null, { timeout: 30000 });
for (let i = 0; i < 60 && !discogsCalls; i++) await page.waitForTimeout(250);
assert.ok(discogsCalls > 0, 'debe consultar Discogs al elegir «Con precio»');
await page.waitForFunction(() => !/Consultando precios/.test(document.querySelector('#view').textContent), null, { timeout: 60000 });
assert.ok((await page.$$('.list .row')).length >= 1);
assert.match(await page.textContent('#view'), /19,00/);
await page.screenshot({ path: path.join(SHOTS, '3a-con-precio.png') });
await page.click('.chip:has-text("Todos")');

// ---------- Deseos y comprados ----------
await page.click('[data-tab=comprar]');
await page.click('.seg button:has-text("Deseos")');
await page.waitForSelector('text=Aquí van los vinilos que quieres');
// a mano
await page.click('text=+ Añadir vinilo');
await page.click('summary:has-text("a mano")');
await page.fill('.sheet input[placeholder="Artista"]', 'Delta Goodrem');
await page.fill('.sheet input[placeholder="Álbum"]', 'Pure');
await page.click('.sheet >> text=Añadir álbum');
await page.waitForSelector('.sheet', { state: 'hidden' });
await page.waitForSelector('.row.wrow:has-text("Pure")');
assert.match(await page.textContent('.row.wrow'), /No disponible ahora/);
await page.screenshot({ path: path.join(SHOTS, '3b-deseos.png') });
// código de barras: la cámara no existe en la prueba, se escribe a mano (primero uno mal)
await page.evaluate(() => localStorage.setItem('vt.discogs.token', 'tok'));
await page.click('text=Escanear código');
await page.fill('.sheet input[placeholder^="o escríbelo"]', '5901234123458');
await page.click('.sheet >> text=Buscar código');
await page.waitForSelector('.sheet >> text=no es válido');
await page.fill('.sheet input[placeholder^="o escríbelo"]', '5901234123457');
await page.click('.sheet >> text=Buscar código');
await page.waitForSelector('.rescard');
assert.match(await page.textContent('.rescard'), /Motomami/);
assert.match(await page.textContent('.rescard'), /Ya está en tu colección/);
await page.screenshot({ path: path.join(SHOTS, '3c-codigo.png') });
await page.click('.rescard >> text=Esta edición');
await page.waitForSelector('.rescard >> text=Añadido');
await page.click('.sheet >> text=Cerrar');
await page.waitForSelector('.row.wrow:has-text("Motomami")');
assert.match(await page.textContent('#view'), /Edición/);
// copia en la nube: la lista de deseos se sube sola (comprimida) y se puede recuperar
await page.waitForFunction(() => true);
await page.waitForTimeout(5600);
assert.ok(vt.has('vt-wish') && vt.has('vt-wish-0'), 'la lista de deseos debe subirse a Firestore');
assert.ok(!JSON.stringify([...vt]).includes('tok'), 'no se suben tokens');
// borrar los datos locales de deseos y recargar: se recuperan de la nube
await page.evaluate(() => new Promise(res => { const r = indexedDB.open('vinyltracker', 1); r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').delete('wishlist'); t.oncomplete = () => res(); }; }));
await page.reload();
await page.waitForSelector('.row.wrow:has-text("Pure")');
await page.waitForSelector('.row.wrow:has-text("Motomami")');
// aviso: Pure pasa a estar en stock en la tienda
writeStores(1);
await page.reload();
await page.waitForSelector('#toast:not([hidden])');
assert.match(await page.textContent('#toast'), /Pure.*ya disponible en Apparell/);
await page.waitForSelector('.tabs .badge');
assert.equal((await page.textContent('.tabs .badge')).trim(), '1');         // solo Pure (en stock en tienda): las copias de Discogs de Motomami no cuentan
await page.waitForSelector('.row.wrow:has-text("Pure") .chip.ok');
// marcar como comprado desde la ficha de un álbum sugerido: sale de las sugerencias y NO entra en la colección
await page.click('.seg button:has-text("Sugeridos")');
await page.waitForSelector('.list .row');
assert.match(await page.textContent('.list .row >> nth=0'), /Nevermind/);
await page.click('.list .row >> nth=0');
await page.click('.sheet >> text=✓ Ya lo compré');
await page.waitForSelector('.sheet >> text=Comprado (fuera de la colección)');
await page.click('.sheet >> text=Cerrar');
assert.ok(!/Nevermind/.test(await page.textContent('#view')), 'lo comprado debe salir de las sugerencias');
await page.click('.seg button:has-text("Comprados")');
await page.waitForSelector('.row.wrow:has-text("Nevermind")');
await page.screenshot({ path: path.join(SHOTS, '3d-comprados.png') });
await page.click('.seg button:has-text("Sugeridos")');

// ---------- Conciertos ----------
const CONC = path.join(ROOT, '_site/data/concerts.json');
const ce = (id, date, cc, city, acts) => [id, acts[0] + ' en directo', date, '21:00', 'ok', 'Sala X', city, cc, 'https://tm.example/' + id, acts];
await page.click('[data-tab=conciertos]');
await page.waitForSelector('text=Todavía no hay datos de conciertos');
writeFileSync(CONC, JSON.stringify({ generated: new Date().toISOString(), countries: ['ES', 'PT'], events: [
  ce('e2', '2027-04-02', 'PT', 'Lisboa', ['Nirvana']), ce('e1', '2027-03-12', 'ES', 'Madrid', ['Nirvana', 'Foo Fighters']), ce('e0', '2027-03-01', 'ES', 'Bilbao', ['Nirvana Tribute']) ] }));
await page.click('text=Volver a mirar');
await page.waitForSelector('.crow');
assert.equal((await page.$$('.crow')).length, 1, 'por defecto solo España y sin el tributo');
assert.match(await page.textContent('.crow'), /Madrid/);
assert.match(await page.textContent('.crow'), /Foo Fighters/);
await page.selectOption('select[aria-label="País"]', '');
assert.equal((await page.$$('.crow')).length, 2);
assert.match(await page.textContent('#view'), /marzo de 2027/i);
assert.ok(!/NaN|undefined|null/.test(await page.textContent('#view')));
await page.screenshot({ path: path.join(SHOTS, '3e-conciertos.png') });
await page.selectOption('select[aria-label="País"]', 'ES');

// Colección: 2 del CSV + 1 de la nube, como pared de portadas
await page.click('[data-tab=coleccion]');
await page.waitForSelector('.wall .tile');
assert.equal((await page.$$('.wall .tile')).length, 3);
assert.match(await page.textContent('.counter'), /3 vinilos/);
// El disco no válido no se muestra, pero se avisa y se explica
assert.match(await page.textContent('#view'), /1 disco en la nube que no se puede mostrar/);
await page.click('text=Ver cuáles y por qué');
await page.waitForSelector('.sheet .panel');
assert.match(await page.textContent('.sheet .panel'), /Disco roto.*Roto|portada no es una dirección https válida/s);
await page.click('.sheet >> text=Cerrar');
// Menú de la colección: sin recuento ni valor de Discogs, con el punto de sincronización
assert.equal((await page.textContent('#status')).trim(), '', 'la cabecera no debe enseñar el recuento');
assert.ok(!/en mi-app|añadidos|Valor en Discogs|Calcular valor/.test(await page.textContent('#view')), 'sobra texto en el menú de la colección');
assert.equal(await page.getAttribute('#sync-dot', 'data-state'), 'ok');
await page.click('#sync-btn');
await page.waitForFunction(() => document.querySelector('#sync-dot')?.dataset.state === 'ok' && !document.querySelector('#sync-btn')?.disabled);
await page.click('#sync-dot');
await page.waitForSelector('#toast:not([hidden])');
assert.match(await page.textContent('#toast'), /Sincronizado\. Última sincronización/);
await page.screenshot({ path: path.join(SHOTS, '6-coleccion.png') });
// Buscador y filtro por estilo
await page.fill('input[type=search]', 'rosal');
assert.equal((await page.$$('.wall .tile')).length, 1);
await page.fill('input[type=search]', '');
await page.selectOption('select[aria-label="Filtrar por estilo"]', 'rock');
assert.equal((await page.$$('.wall .tile')).length, 1);          // solo OK Computer (nube) tiene "rock"
await page.selectOption('select[aria-label="Filtrar por estilo"]', '');
// Regresión: la ficha de un disco sin enlace (Motomami) no debe enseñar "null"
await page.click('button.tile');
await page.waitForSelector('.sheet .panel');
assert.ok(!/null/.test(await page.textContent('.sheet .panel')), 'la ficha enseña "null"');
await page.click('.sheet >> text=Cerrar');
// Disco aleatorio
await page.click('text=Disco aleatorio');
await page.waitForSelector('.sheet .panel h2');
await page.click('.sheet >> text=Cerrar');
// Dueño: añadir disco (Spotify oEmbed + iTunes simulados) y comprobar lo escrito en Firestore
await page.click('text=+ Añadir disco');
await page.fill('.sheet input[type=url]', 'https://open.spotify.com/album/5K79FLRUCSysQnVESLcTdb?si=x');
await page.fill('.sheet input[type=url]', 'https://open.spotify.com/album/2Gzdlis2gby7peCvJ0Poif');
await page.waitForSelector('.sheet >> text=ya está en tu colección');
await page.fill('.sheet input[type=url]', 'https://open.spotify.com/album/5K79FLRUCSysQnVESLcTdb?si=x');
await page.waitForSelector('.sheet .sug');
await page.click('.sheet .sug');
await page.click('.sheet >> text=Guardar disco');
await page.waitForSelector('.sheet', { state: 'hidden' });
assert.ok(patched && patched.fields.json.stringValue.includes('Nuevo Disco') && patched.fields.json.stringValue.includes('Artista Nuevo'), 'no se escribió en Firestore');
assert.ok(patched.fields.json.stringValue.includes('OK Computer'), 'se pisó lo que había en la nube');
assert.ok(patched.fields.json.stringValue.includes('Disco roto'), 'al añadir se borró un disco que la app no sabía mostrar');
await page.waitForSelector('.wall .tile');
assert.equal((await page.$$('.wall .tile')).length, 4);
await page.screenshot({ path: path.join(SHOTS, '6b-tras-anadir.png') });

// ---------- Añadir a la colección: a mano, por código de barras (editando etiquetas antes de guardar) y editar / quitar ----------
page.on('dialog', d => d.accept());
await page.click('[data-tab=coleccion]');
await page.waitForSelector('.wall .tile');
const tiles0 = (await page.$$('.wall .tile')).length;
patched = null;
// a mano
await page.click('text=+ Añadir disco');
await page.fill('.sheet input[placeholder="Nombre del álbum"]', 'Disco Manual');
await page.fill('.sheet input[placeholder="Artista"]', 'Artista Manual');
await page.fill('.sheet input[placeholder^="Año"]', '2020');
await page.fill('.sheet input[placeholder="rap, trap"]', 'jazz, lofi');
assert.match(await page.textContent('.sheet'), /Se guardará en este dispositivo/);
await page.click('.sheet >> text=Guardar disco');
await page.waitForSelector('.sheet', { state: 'hidden' });
await page.waitForSelector('.wall .tile:has-text("Disco Manual")');
assert.equal((await page.$$('.wall .tile')).length, tiles0 + 1);
assert.equal(patched, null, 'un disco manual no debe tocar el documento de mi-app');
assert.match(await page.textContent('.counter'), new RegExp(`${tiles0 + 1} vinilos`));
// código de barras desde la colección: primero el formulario (etiquetas de Discogs), luego se edita y se guarda
await page.click('.actions >> text=Escanear código');
await page.fill('.sheet input[placeholder^="o escríbelo"]', '4006381333931');
await page.click('.sheet >> text=Buscar código');
await page.waitForSelector('.rescard');
assert.ok(!(await page.textContent('.rescard')).includes('Cualquier edición'), 'en la colección solo se ofrece añadir');
await page.click('.rescard >> text=Añadir a la colección');
await page.waitForSelector('.sheet input[placeholder="Nombre del álbum"]');
assert.equal(await page.inputValue('.sheet input[placeholder="Nombre del álbum"]'), 'Disco Raro');
assert.equal(await page.inputValue('.sheet input[placeholder="Artista"]'), 'Artista Raro');
assert.equal(await page.inputValue('.sheet input[placeholder^="Año"]'), '2019');
assert.equal(await page.inputValue('.sheet input[placeholder="rap, trap"]'), 'ambient, drone, electronic');
assert.equal(await page.inputValue('.sheet input[placeholder^="Portada"]'), 'https://i.scdn.co/raro.jpg');
await page.screenshot({ path: path.join(SHOTS, '6c-formulario-codigo.png') });
await page.fill('.sheet input[placeholder="rap, trap"]', 'ambient, drone, favorito');          // se editan las etiquetas antes de guardar
await page.click('.sheet >> text=Guardar disco');
await page.waitForSelector('.wall .tile:has-text("Disco Raro")');
assert.equal((await page.$$('.wall .tile')).length, tiles0 + 2);
assert.equal(patched, null);
// la copia en la nube recibe los discos manuales
await page.waitForTimeout(5600);
assert.ok(vt.has('vt-manual') && vt.has('vt-manual-0'), 'los discos manuales deben subirse a la copia de la nube');
// filtro por una etiqueta nueva
await page.selectOption('select[aria-label="Filtrar por estilo"]', 'favorito');
assert.equal((await page.$$('.wall .tile')).length, 1);
await page.selectOption('select[aria-label="Filtrar por estilo"]', '');
// editar etiquetas de un disco manual
await page.click('.wall .tile:has-text("Disco Manual")');
await page.waitForSelector('.sheet .panel');
assert.match(await page.textContent('.sheet .panel'), /jazz/);
await page.click('.sheet >> text=Editar etiquetas y datos');
await page.fill('.sheet input[placeholder="rap, trap"]', 'jazz, lofi, vinilo azul');
await page.click('.sheet >> text=Guardar cambios');
await page.waitForSelector('.sheet', { state: 'hidden' });
await page.click('.wall .tile:has-text("Disco Manual")');
assert.match(await page.textContent('.sheet .panel'), /vinilo azul/);
// quitar
await page.click('.sheet >> text=Quitar');
await page.waitForSelector('.sheet', { state: 'hidden' });
assert.equal((await page.$$('.wall .tile:has-text("Disco Manual")')).length, 0);
assert.equal((await page.$$('.wall .tile')).length, tiles0 + 1);


// Spotify: login PKCE simulado
await page.click('[data-tab=ajustes]');
// Enlace para hacer el login en Safari (cuando Spotify se queda en bucle en la app instalada)
await page.click('summary:has-text("en bucle")');
await page.click('text=Conseguir enlace para Safari');
assert.match(await page.inputValue('textarea[readonly]'), /^https:\/\/accounts\.spotify\.com\/authorize\?/);
await page.click('text=Conectar Spotify');
await page.waitForFunction(() => localStorage.getItem('vt.spotify.token'), null, { timeout: 15000 });
await page.waitForSelector('.row');
await page.screenshot({ path: path.join(SHOTS, '7-tras-spotify.png') });

// En vivo: "Ahora suena", barra de estado y registro que crece al actualizar
await page.waitForSelector('#live-dot[data-state="ok"]');
await page.waitForSelector('.nowcard');
assert.match(await page.textContent('.nowcard'), /Tema en directo/);
assert.match(await page.textContent('.nowcard'), /Suena ahora/);
await page.screenshot({ path: path.join(SHOTS, '7b-en-vivo.png') });
recent = [recentItem('En vivo 2', 1), ...recent];                       // acabas de escuchar otra canción
await page.click('#live-refresh');
await page.waitForFunction(() => document.querySelector('#live-dot')?.dataset.state === 'ok' && !document.querySelector('#live-refresh')?.disabled);
await page.click('[data-tab=ajustes]');
await page.waitForSelector('text=En vivo: 2 reproducciones guardadas');
await page.click('[data-tab=stats]');
await page.waitForSelector('.hero .big');
const hoy = await page.textContent('.tiles');
assert.match(hoy, /Reproducciones/);
assert.ok(!/NaN|undefined|null/.test(await page.textContent('#view')));
await page.click('[data-tab=ranking]');
// Fotos de artista (Spotify conectado): Nirvana debe cambiar la inicial por su foto
await page.click('.seg button:has-text("Artistas")');
await page.waitForSelector('.row.static .avwrap img.cover.round');
assert.equal((await page.$$('.row.static .avwrap img.cover.round')).length, 1, 'solo Nirvana tiene foto en la prueba');
assert.ok((await page.$$('.row.static .avwrap .cover.ph.round')).length >= 3, 'los demás conservan la inicial');
await page.screenshot({ path: path.join(SHOTS, '7c-artistas-fotos.png') });
// Portadas de canciones: las pone iTunes (simulado) cuando el álbum no trae portada
await page.click('.seg button:has-text("Canciones")');
await page.waitForSelector('.row.static .avwrap img.cover', { timeout: 20000 });
assert.ok((await page.$$('.row.static .avwrap img.cover')).length >= 1, 'las canciones deben tener portada');
await page.screenshot({ path: path.join(SHOTS, '7d-canciones-portadas.png') });
await page.click('.seg button:has-text("Álbumes")');



// Enlace de Spotify con Spotify conectado: la API da año, sello, portada grande y estilos del artista; se guarda en mi-app
await page.click('[data-tab=coleccion]');
await page.waitForSelector('.wall .tile');
patched = null;
await page.click('text=+ Añadir disco');
await page.fill('.sheet input[type=url][placeholder^="Opcional"]', 'https://open.spotify.com/album/7yyRTcZmCiyzzJlNzGC9Ol?si=abc');
await page.waitForFunction(() => document.querySelector('.sheet input[placeholder="Nombre del álbum"]').value === 'Álbum Completo');
assert.equal(await page.inputValue('.sheet input[placeholder="Artista"]'), 'Artista Completo');
assert.equal(await page.inputValue('.sheet input[placeholder^="Año"]'), '2021');
assert.equal(await page.inputValue('.sheet input[placeholder="rap, trap"]'), 'indie pop, bedroom pop');
assert.equal(await page.inputValue('.sheet input[placeholder^="Portada"]'), 'https://i.scdn.co/full-640');
assert.match(await page.textContent('.sheet'), /Sello Spotify/);
assert.match(await page.textContent('.sheet'), /Se guardará en tu colección de mi-app/);
await page.click('.sheet >> text=Guardar disco');
await page.waitForSelector('.sheet', { state: 'hidden' });
assert.ok(patched && patched.fields.json.stringValue.includes('Álbum Completo') && patched.fields.json.stringValue.includes('"year":2021') && patched.fields.json.stringValue.includes('bedroom pop'), 'no se guardó con toda la info en mi-app');
await page.screenshot({ path: path.join(SHOTS, '7e-spotify-completo.png') });
await page.click('[data-tab=ranking]');

// ---------- Olvidados: artistas / canciones que escuchaste mucho y hace tiempo que no suenan ----------
await page.click('[data-tab=ranking]');
await page.click('.seg button:has-text("Olvidados")');
await page.waitForSelector('.frow');
assert.match(await page.textContent('#view'), /Viejo/);                           // 30 reproducciones en enero de 2024
assert.ok(!/Nirvana/.test(await page.textContent('.list')), 'lo que suena ahora no es un olvidado');
// playlist como fuente (fechas de «añadida»)
await page.click('text=Elegir playlists');
await page.waitForSelector('.sheet >> text=playlist 01');
await page.check('.sheet input[type=checkbox]');
await page.click('.sheet >> text=Importar las marcadas');
await page.waitForSelector('.sheet', { state: 'hidden' });
await page.waitForSelector('.frow:has-text("Artista Perdido")');
assert.match(await page.textContent('.frow:has-text("Artista Perdido")'), /en playlist/);
// el botón de crear playlist queda siempre a la vista (barra fija abajo), sin tener que bajar por la lista
{ const box = await page.locator('.fabbar .btn').boundingBox(), vp = page.viewportSize();
  assert.ok(box && box.y >= 0 && box.y + box.height <= vp.height - 50, 'el botón de crear playlist no está a la vista: ' + JSON.stringify(box)); }
await page.screenshot({ path: path.join(SHOTS, '7f-olvidados.png') });
// «No»: se oculta y queda en la lista de excluidos (y se puede volver a incluir)
await page.click('.frow:has-text("Viejo") >> text=No');
await page.waitForFunction(() => !/Viejo/.test(document.querySelector('.list').textContent));
await page.click('summary:has-text("Artistas excluidos")');
assert.match(await page.textContent('details.dt'), /Viejo/);
await page.click('details.dt .chip:has-text("Viejo")');
await page.waitForSelector('.frow:has-text("Viejo")');
await page.click('.frow:has-text("Viejo") >> text=No');
// crear una playlist con lo que se ve
await page.click('text=Crear playlist con esto');
await page.waitForSelector('.sheet >> text=Playlist creada');
assert.ok(plAdded.includes('spotify:track:LOST1'), 'las canciones de la playlist usan su uri: ' + plAdded);
await page.click('.sheet >> text=Cerrar');
// canciones
await page.locator('.seg').nth(1).getByText('Canciones', { exact: true }).click();          // el segundo selector es el de Olvidados (el primero es el de las vistas del ranking)
await page.waitForSelector('.frow');
assert.ok(!/Viejo/.test(await page.textContent('.list')), 'sus canciones también quedan ocultas');
assert.match(await page.textContent('#view'), /Canción Perdida/);
await page.locator('.seg').nth(1).getByText('Artistas', { exact: true }).click();
await page.click('.seg button:has-text("Álbumes")');

// Vuelta de Spotify a una ventana SIN el intento guardado (iPhone: vuelve a Safari, no a la app):
// debe enseñar "Casi listo" y CONSERVAR el código en la dirección para poder copiarla
const ctx2 = await browser.newContext({ ...devices['iPhone 14'], locale: 'es-ES' });
const p2 = await ctx2.newPage();
p2.setDefaultTimeout(15000);
await p2.goto(BASE + '?code=ABC123&state=XYZ');
await p2.waitForSelector('text=Casi listo');
assert.ok(p2.url().includes('code=ABC123'), 'la dirección perdió el código');
assert.ok((await p2.inputValue('textarea')).includes('code=ABC123'));
await p2.screenshot({ path: path.join(SHOTS, '8-casi-listo.png') });
await ctx2.close();

// Paquete básico de Spotify ("Datos de la cuenta"): sin álbumes, pero con artistas, canciones y estadísticas
const basic = Array.from({ length: 30 }, (_, i) => ({ endTime: `2026-11-${String(1 + (i % 18)).padStart(2, '0')} 21:${String(10 + i).padStart(2, '0')}`,
  artistName: i % 3 ? 'Nirvana' : 'Delta Goodrem', trackName: 'tema ' + (i % 5), msPlayed: 180000 }));
writeFileSync(path.join(SHOTS, 'StreamingHistory_music_0.json'), JSON.stringify(basic));
const ctx3 = await browser.newContext({ ...devices['iPhone 14'], locale: 'es-ES' });
await ctx3.route('https://ruzzz05.github.io/mi-app/**', r => r.fulfill({ status: 200, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: CSV }));
const p3 = await ctx3.newPage();
p3.setDefaultTimeout(15000);
await p3.goto(BASE);
await p3.click('[data-tab=ajustes]');
await p3.setInputFiles('input[type=file]', path.join(SHOTS, 'StreamingHistory_music_0.json'));
await p3.click('text=Importar');
await p3.waitForSelector('.hero .big');                                     // salta a Estadísticas porque no hay álbumes
{ const t3 = await p3.textContent('#view'); const m3 = /.{0,60}(NaN|undefined|null).{0,60}/.exec(t3); assert.ok(!m3, 'valores inválidos: «' + (m3 && m3[0]) + '»'); }
await p3.click('[data-tab=ranking]');
await p3.click('.seg button:has-text("Artistas")');
await p3.waitForSelector('.row.static');
assert.match(await p3.textContent('#view'), /Nirvana/);
await p3.click('.seg button:has-text("Álbumes")');
await p3.waitForSelector('text=no trae nombres de álbum');
await ctx3.close();

// Importar zips problemáticos: el mensaje explica la causa y el zip cortado SÍ se importa
writeFileSync(path.join(SHOTS, 'texto.zip'), 'esto no es un zip, solo texto');
writeFileSync(path.join(SHOTS, 'vacio.zip'), '');
writeFileSync(path.join(SHOTS, 'roto.zip'), Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('basura sin sentido que no es un zip de verdad'.repeat(5))]));
const ctx4 = await browser.newContext({ ...devices['iPhone 14'], locale: 'es-ES' });
await ctx4.route('https://ruzzz05.github.io/mi-app/**', r => r.fulfill({ status: 200, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: CSV }));
const p4 = await ctx4.newPage();
p4.setDefaultTimeout(15000);
await p4.goto(BASE);
await p4.click('[data-tab=ajustes]');
for (const [file, texto] of [['texto.zip', /no empieza como un zip/], ['vacio.zip', /vacío/], ['roto.zip', /dañado o incompleto/]]) {
  await p4.setInputFiles('input[type=file]', path.join(SHOTS, file));
  await p4.click('text=Importar');
  await p4.waitForFunction(re => new RegExp(re).test(document.querySelector('#toast')?.textContent || ''), texto.source);
}
// Botón de actualizar: sin versión nueva dice que ya tienes la última
await p4.click('text=Buscar actualización');
await p4.waitForFunction(() => /última versión/.test(document.querySelector('#toast')?.textContent || ''));
await p4.setInputFiles('input[type=file]', path.join(ROOT, 'tests', 'spotify-truncated.zip'));    // cortado, como el de Spotify
await p4.click('text=Importar');
await p4.waitForFunction(() => /Historial importado: 2 álbumes/.test(document.querySelector('#toast')?.textContent || ''));
await ctx4.close();

assert.deepEqual(errors, []);
console.log('OK: flujo completo, capturas en', SHOTS);
await browser.close();
server.kill();
