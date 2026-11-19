// Diseño en iPhone: la barra inferior pegada al borde, sin moverse, y el arreglo del alto de iOS (app instalada).
// Requiere Playwright y `python tools/build_site.py`.  Uso: node tests/e2e/layout.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const server = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1', '-d', path.join(ROOT, '_site')], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const BASE = 'http://127.0.0.1:8766/';
const csv = 'Artist,Name,Image,Tags,Url\n' + Array.from({ length: 80 }, (_, i) => `Artista ${i},Disco ${i},,rock,`).join('\n');
const browser = await chromium.launch();

async function open({ standalone }) {
  // Reproduce el fallo de iOS: la ventana mide 793 de alto, pero la pantalla es de 852
  const ctx = await browser.newContext({ viewport: { width: 393, height: 793 }, screen: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'es-ES' });
  if (standalone) await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await ctx.route('https://ruzzz05.github.io/mi-app/**', r => r.fulfill({ status: 200, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: csv }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(BASE);
  await page.$eval('[data-tab=coleccion]', e => e.click());
  await page.waitForSelector('.wall .tile');
  return { ctx, page };
}
const bar = page => page.$eval('.tabs', e => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; });

// 1) App instalada con el alto de iOS recortado: la barra debe llegar al final de la PANTALLA (852), sin hueco
{
  const { ctx, page } = await open({ standalone: true });
  await page.waitForTimeout(400);
  const b = await bar(page);
  assert.equal(b.bottom, 852, 'con el fix, la barra debe llegar al borde inferior de la pantalla: ' + JSON.stringify(b));
  const b0 = b;
  await page.$eval('#view', e => { e.scrollTop = 900; });
  // (la ventana de la prueba sí está recortada a 793, por eso se pulsa por código)
  for (const t of ['ranking', 'comprar', 'ajustes', 'coleccion']) {
    await page.$eval(`[data-tab=${t}]`, e => e.click());
    assert.deepEqual(await bar(page), b0, 'la barra se movió al tocar ' + t);
  }
  await ctx.close();
}

// 2) Navegador normal (no instalada): no se toca nada, la barra queda en el borde de la ventana (793)
{
  const { ctx, page } = await open({ standalone: false });
  const b = await bar(page);
  assert.equal(b.bottom, 793, 'sin instalar no debe cambiar el alto: ' + JSON.stringify(b));
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-h')), '');
  const b0 = b;
  await page.$eval('#view', e => { e.scrollTop = 900; });
  await page.evaluate(() => window.scrollTo(0, 500));
  assert.deepEqual(await bar(page), b0);
  assert.equal(await page.evaluate(() => scrollY), 0);
  for (const t of ['ranking', 'comprar', 'ajustes', 'coleccion']) {
    await page.tap(`[data-tab=${t}]`);
    assert.deepEqual(await bar(page), b0);
    assert.equal(await page.$eval('#view', e => e.scrollTop), 0);
  }
  assert.ok(await page.$eval('meta[name=viewport]', e => /user-scalable=no/.test(e.content)));
  await ctx.close();
}

console.log('OK layout');
await browser.close();
server.kill();
