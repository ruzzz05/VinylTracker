// Fichas y paneles (álbum, deseos, añadir, escáner): siempre se pueden cerrar y la app vuelve a ser usable.
// Cubre: Discogs que falla / no responde, muchas ofertas (ficha larga), pantalla pequeña, cerrar con el botón y tocando fuera.
// Requiere Playwright y `python tools/build_site.py --skip-stores`.  Uso: node tests/e2e/sheets.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const PORT = 8767, BASE = `http://127.0.0.1:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '-d', path.join(ROOT, '_site')], { stdio: 'ignore' });
process.on('exit', () => server.kill());
await new Promise(r => setTimeout(r, 800));

// Tiendas simuladas: Nevermind con MUCHAS ofertas (ficha larga) y Pure agotado
const items = [];
for (let i = 0; i < 12; i++) items.push([`Nirvana - Nevermind (Vinyl LP) edición ${i}`, 'Nirvana', 20 + i, i % 2, 'nirvana-nevermind-' + i, 0, '']);
const stores = {};
for (const n of ['Tienda A', 'Tienda B', 'Tienda C']) stores[n] = { base: `https://${n.replace(/\W/g, '').toLowerCase()}.example`, items };
writeFileSync(path.join(ROOT, '_site/data/stores.json'), JSON.stringify({ generated: new Date().toISOString(), stores }));

const CSV = 'Artist,Name,Image,Tags,Url\nRosalía,Motomami,,pop,\n';
const entry = (artist, album, n) => Array.from({ length: n }, (_, i) => ({
  ts: `2026-11-${String(1 + (i % 20)).padStart(2, '0')}T12:00:00Z`, ms_played: 200000, master_metadata_track_name: 't' + (i % 5),
  master_metadata_album_artist_name: artist, master_metadata_album_album_name: album, spotify_track_uri: 'spotify:track:' + album + (i % 5) }));
const HISTORY = [...entry('Nirvana', 'Nevermind', 40), ...entry('Delta Goodrem', 'Pure', 25), ...entry('Rosalía', 'Motomami', 15)];

const browser = await chromium.launch();
const errors = [];

// modo del servidor de Discogs simulado
let discogsMode = 'ok';       // ok | 401 | 500 | hang
async function newPage(device) {
  const ctx = await browser.newContext({ ...devices[device], locale: 'es-ES', permissions: [] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(device + ': ' + e.message));
  await ctx.route('https://ruzzz05.github.io/mi-app/**', r => r.fulfill({ status: 200, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: CSV }));
  await ctx.route('https://api.discogs.com/**', async r => {
    const cors = { 'access-control-allow-origin': '*' };
    if (discogsMode === 'hang') return;                                   // nunca responde
    if (discogsMode === '401') return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{}' });
    if (discogsMode === '500') return r.fulfill({ status: 500, headers: cors, contentType: 'application/json', body: '{}' });
    const u = decodeURIComponent(r.request().url());
    const body = u.includes('/marketplace/stats/') ? { lowest_price: { value: 19 }, num_for_sale: 3 } : { results: [{ id: 1, title: 'Nirvana - Nevermind', community: { have: 9, want: 1 } }] };
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route(/itunes\.apple\.com|i\.scdn\.co|api\.spotify\.com/, r => r.fulfill({ status: 404, body: '' }));
  await page.goto(BASE);
  // datos de escucha sembrados directamente (sin pasar por la importación)
  await page.evaluate(async history => {
    const { buildStats } = await import('./js/stats.js');
    const C = await import('./js/core.js');
    const store = await import('./js/storage.js');
    const { into } = C.aggregateHistory(C.normalizeEntries(history), {});
    await store.set('history', into); await store.set('stats', buildStats(history));
    localStorage.setItem('vt.tab', 'comprar'); localStorage.setItem('vt.buyView', 'sugeridos'); localStorage.setItem('vt.months', '0');
  }, HISTORY);
  await page.reload();
  await page.waitForSelector('.list .row');
  return { ctx, page };
}

// La app tiene que seguir usable: ficha cerrada, pestañas que responden, nada tapando la pantalla
async function assertUsable(page, label) {
  await page.waitForSelector('#sheet', { state: 'hidden', timeout: 3000 }).catch(() => { throw new Error(label + ': la ficha no se cerró'); });
  for (const tab of ['coleccion', 'ajustes', 'comprar']) {
    await page.click(`[data-tab=${tab}]`, { timeout: 3000 });
    assert.equal(await page.getAttribute(`[data-tab=${tab}]`, 'aria-current'), 'page', `${label}: la pestaña ${tab} no responde`);
  }
  const covered = await page.evaluate(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 3); return !!e && !!e.closest('#sheet'); });
  assert.ok(!covered, label + ': algo sigue tapando la pantalla');
}

// El botón «Cerrar» tiene que estar a la vista (dentro de la pantalla) y ser lo que se toca en ese punto
async function assertCloseReachable(page, label) {
  const btn = page.locator('.sheet .panel').getByText('Cerrar', { exact: true }).last();
  await btn.scrollIntoViewIfNeeded();
  const box = await btn.boundingBox(), vp = page.viewportSize();
  assert.ok(box && box.y >= 0 && box.y + box.height <= vp.height + 1 && box.x >= 0, `${label}: el botón Cerrar queda fuera de la pantalla (${JSON.stringify(box)})`);
  const hit = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e && e.textContent.trim(); }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  assert.equal(hit, 'Cerrar', `${label}: algo tapa el botón Cerrar (${hit})`);
}

for (const device of ['iPhone 14', 'iPhone SE']) {
  const { ctx, page } = await newPage(device);
  const tag = device + ' · ';

  // ---- ficha de álbum desde Comprar: con Discogs en cada estado
  for (const mode of ['ok', '401', '500', 'hang']) {
    discogsMode = mode;
    await page.click('[data-tab=comprar]');
    await page.waitForSelector('.list .row');
    await page.click('.list .row >> nth=0');
    await page.waitForSelector('.sheet .panel');
    const lbl = `${tag}ficha (Discogs ${mode})`;
    await page.waitForSelector('.sheet .panel >> text=Dónde comprarlo');
    if (await page.$('#dlook')) { await page.click('#dlook'); await page.waitForTimeout(mode === 'hang' ? 300 : 800); }
    await assertCloseReachable(page, lbl);
    await page.locator('.sheet .panel').getByText('Cerrar', { exact: true }).last().click();
    await assertUsable(page, lbl);
    // lo mismo cerrando tocando fuera de la ficha
    await page.click('.list .row >> nth=0');
    await page.waitForSelector('.sheet .panel');
    if (await page.$('#dlook')) await page.click('#dlook');
    await page.mouse.click(vpCenterX(page), 6);
    await assertUsable(page, lbl + ' (tocando fuera)');
  }
  discogsMode = 'ok';

  // ---- ficha desde el Ranking
  await page.click('[data-tab=ranking]');
  await page.waitForSelector('.row:not(.static)');
  await page.click('.row:not(.static) >> nth=0');
  await page.waitForSelector('.sheet .panel');
  await assertCloseReachable(page, tag + 'ficha del ranking');
  await page.locator('.sheet .panel').getByText('Cerrar', { exact: true }).last().click();
  await assertUsable(page, tag + 'ficha del ranking');

  // ---- «Lo quiero» / «Ya lo compré» y cerrar
  await page.click('[data-tab=comprar]');
  await page.click('.list .row >> nth=0');
  await page.waitForSelector('.sheet .panel');
  await page.click('.sheet >> text=♡ Lo quiero');
  await page.waitForSelector('.sheet >> text=En tu lista de deseos');
  await assertCloseReachable(page, tag + 'ficha tras «Lo quiero»');
  await page.locator('.sheet .panel').getByText('Cerrar', { exact: true }).last().click();
  await assertUsable(page, tag + 'ficha tras «Lo quiero»');

  // ---- ficha de un deseo, «Añadir vinilo» y «Escanear código» (la cámara está denegada)
  await page.click('.seg button:has-text("Deseos")');
  await page.waitForSelector('.row.wrow');
  await page.click('.row.wrow >> nth=0');
  await page.waitForSelector('.sheet .panel');
  await assertCloseReachable(page, tag + 'ficha de deseo');
  await page.locator('.sheet .panel').getByText('Cerrar', { exact: true }).last().click();
  await assertUsable(page, tag + 'ficha de deseo');
  for (const [btn, name] of [['+ Añadir vinilo', 'añadir'], ['Escanear código', 'escáner']]) {
    await page.click('[data-tab=comprar]');
    await page.click('.seg button:has-text("Deseos")');
    await page.click(`.actions >> text=${btn}`);
    await page.waitForSelector('.sheet .panel');
    await page.waitForTimeout(400);
    await assertCloseReachable(page, `${tag}${name}`);
    await page.locator('.sheet .panel').getByText('Cerrar', { exact: true }).last().click();
    await assertUsable(page, `${tag}${name}`);
  }

  // ---- Colección: disco aleatorio
  await page.click('[data-tab=coleccion]');
  await page.waitForSelector('.wall .tile');
  await page.click('text=Disco aleatorio');
  await page.waitForSelector('.sheet .panel');
  await assertCloseReachable(page, tag + 'disco aleatorio');
  await page.locator('.sheet .panel').getByText('Cerrar', { exact: true }).last().click();
  await assertUsable(page, tag + 'disco aleatorio');
  await ctx.close();
}

// ---- almacenamiento del navegador colgado (IndexedDB que nunca responde): la app arranca igual y se puede usar
{
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'es-ES' });
  await ctx.addInitScript(() => { indexedDB.open = () => ({}); });             // nunca llama a onsuccess / onerror
  await ctx.route('https://ruzzz05.github.io/mi-app/**', r => r.fulfill({ status: 200, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: CSV }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push('IDB colgada: ' + e.message));
  await page.goto(BASE);
  await page.waitForSelector('#view .empty, #view .list, #view .wall', { timeout: 15000 });
  await page.click('[data-tab=coleccion]');
  await page.waitForSelector('.wall .tile');
  await page.click('text=Disco aleatorio');
  await page.waitForSelector('.sheet .panel');
  await page.click('.sheet-x');
  await assertUsable(page, 'IndexedDB colgada');
  await ctx.close();
}

function vpCenterX(page) { return page.viewportSize().width / 2; }

assert.deepEqual(errors, []);
console.log('OK sheets');
await browser.close();
server.kill();
