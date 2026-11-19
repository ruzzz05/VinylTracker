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
let cloud = JSON.stringify({ albums: [mk('AAAAAAAAAAAAAAAAAAAAAA', 'Radiohead', 'OK Computer')] });
let patched = null;
await ctx.route('https://firestore.googleapis.com/**', r => {
  if (r.request().method() === 'PATCH') { patched = JSON.parse(r.request().postData()); cloud = patched.fields.json.stringValue; return json(r, {}); }
  return json(r, { fields: { updatedAt: { integerValue: '1' }, json: { stringValue: cloud } } });
});
await ctx.route('https://open.spotify.com/oembed**', r => json(r, { title: 'Nuevo Disco', thumbnail_url: 'https://i.scdn.co/nuevo.jpg' }));
await ctx.route('https://itunes.apple.com/**', r => json(r, { results: [{ artistName: 'Artista Nuevo', collectionName: 'Nuevo Disco', releaseDate: '2024-05-01T00:00:00Z', primaryGenreName: 'Rap' }] }));
await ctx.route('https://api.discogs.com/**', r => {
  discogsCalls++;
  const u = decodeURIComponent(r.request().url()).replace(/\+/g, ' ');
  if (u.includes('/database/search')) {
    const all = [{ id: 111, title: 'Nirvana - Nevermind', community: { have: 900, want: 50 } },
      { id: 222, title: 'Delta Goodrem - Pure', community: { have: 3, want: 1 } }];
    return json(r, { results: all.filter(x => u.includes('artist=' + x.title.split(' - ')[0])) });
  }
  if (u.includes('/marketplace/stats/')) return json(r, { lowest_price: { currency: 'EUR', value: 19 }, num_for_sale: 36 });
  return json(r, { minimum: '€1', median: '€2', maximum: '€3' });
});
await ctx.route('https://i.scdn.co/**', r => r.abort());
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
  if (u.includes('/me/top/tracks')) return json(r, { items: [{ album: alb('s1', 'La Deriva', 'Vetusta Morla') }, { album: alb('s2', 'Nevermind', 'Nirvana') }] });
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
await view('Estadísticas');
await page.waitForSelector('.hero .big');
assert.equal((await page.$$('.cc')).length, 2, 'deben salir las dos gráficas de columnas');
assert.ok((await page.$$('.hm-c')).length >= 168, 'falta el mapa de calor');
await page.click('.cc-col >> nth=11');
await page.waitForSelector('.tip:not([hidden])');
assert.match(await page.textContent('.tip'), /min|h/);
const stxt = await page.textContent('#view');
for (const t of ['Minutos por mes', 'Minutos por día', 'Cuándo escuchas', 'Récords y rachas', 'Cómo escuchas', 'Tu vinilo y tu Spotify', 'Curiosidades de plato', 'Tu colección'])
  assert.ok(stxt.includes(t), 'falta la tarjeta: ' + t);
{ const bad = /.{0,40}(NaN|undefined|null|Infinity).{0,40}/.exec(stxt); assert.ok(!bad, 'valores inválidos en las estadísticas: «' + (bad && bad[0]) + '»'); }
// captura larga de toda la pantalla de estadísticas (para revisarla a ojo)
await page.setViewportSize({ width: 393, height: 3400 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, '2b-estadisticas-larga.png') });
await page.setViewportSize({ width: 393, height: 664 });
await view('Álbumes');
await page.waitForSelector('.row:not(.static)');


// Comprar: ofertas de tienda (datos locales) + Discogs simulado
await page.click('[data-tab=comprar]');
await page.waitForSelector('.card .big');
await page.screenshot({ path: path.join(SHOTS, '3-comprar-antes.png') });
await page.click('text=Buscar precios en Discogs');
await page.waitForFunction(() => !document.querySelector('.bar'), null, { timeout: 60000 });
assert.ok(discogsCalls > 0);
await page.screenshot({ path: path.join(SHOTS, '4-comprar.png') });
await page.click('.row >> nth=0');
await page.waitForSelector('.sheet .panel');
await page.screenshot({ path: path.join(SHOTS, '5-ficha.png') });
await page.click('.sheet >> text=Cerrar');

// Colección: 2 del CSV + 1 de la nube, como pared de portadas
await page.click('[data-tab=coleccion]');
await page.waitForSelector('.wall .tile');
assert.equal((await page.$$('.wall .tile')).length, 3);
assert.match(await page.textContent('.counter'), /3 vinilos/);
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
await page.waitForSelector('.wall .tile');
assert.equal((await page.$$('.wall .tile')).length, 4);
await page.screenshot({ path: path.join(SHOTS, '6b-tras-anadir.png') });

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
await page.click('[data-tab=ranking]');
await page.click('.seg button:has-text("Estadísticas")');
await page.waitForSelector('.hero .big');
const hoy = await page.textContent('.tiles');
assert.match(hoy, /Hoy/);
assert.ok(!/NaN|undefined|null/.test(await page.textContent('#view')));
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
await p3.waitForSelector('.hero .big');                                   // salta a Estadísticas porque no hay álbumes
assert.ok(!/NaN|undefined|null/.test(await p3.textContent('#view')));
await p3.click('.seg button:has-text("Artistas")');
await p3.waitForSelector('.row.static');
assert.match(await p3.textContent('#view'), /Nirvana/);
await p3.click('.seg button:has-text("Álbumes")');
await p3.waitForSelector('text=no trae nombres de álbum');
await ctx3.close();

assert.deepEqual(errors, []);
console.log('OK: flujo completo, capturas en', SHOTS);
await browser.close();
server.kill();
